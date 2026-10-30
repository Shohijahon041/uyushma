import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { money } from "../../common/money/money";
import { TenantPrismaService, TenantTx } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsQueueService } from "../notifications/notifications.queue";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import {
  addMonths,
  currentPeriodStart,
  debtByKey,
  effectiveMonthlyFee,
  formatPeriod,
  monthState,
  monthsBetween,
  parseDateOnly,
  parsePeriod,
  periodStartFor,
  tashkentDayRange,
  todayDateOnly,
  toCents,
} from "./billing";
import {
  AssignDriverDto,
  CreateDriverDto,
  CreateDriverPaymentDto,
  UnassignDriverDto,
  UpdateDriverDto,
  UpdateMonthlyPlanDto,
} from "./dto/driver.dto";
import {
  DRIVER_DOCUMENT_FIELDS,
  DriverDocumentField,
  DriverPhotoKind,
  TELEGRAM_FILE_ID,
  documentsView,
  normalizeDocumentValue,
} from "./documents";

const LINK_TTL_MS = 15 * 60 * 1000;
const DEBT_WINDOW_MONTHS = 36;

function sum(value: Prisma.Decimal | null | undefined): number {
  return value ? Number(value) : 0;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function serializePlan(plan: {
  amount: Prisma.Decimal;
  [key: string]: unknown;
}) {
  return { ...plan, amount: plan.amount.toFixed(2) };
}

function serializePayment<
  T extends { amount: Prisma.Decimal; [key: string]: unknown },
>(payment: T) {
  return { ...payment, amount: payment.amount.toFixed(2) };
}

@Injectable()
export class DriversService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsQueueService,
  ) {}

  // -------------------------------------------------------------------------
  // Haydovchilar
  // -------------------------------------------------------------------------

  async list(tenantId: string, query?: string) {
    const search = query?.trim();
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const drivers = await tx.driver.findMany({
        where: search
          ? {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                {
                  assignments: {
                    some: {
                      endDate: null,
                      vehicle: {
                        plateNumber: { contains: search, mode: "insensitive" },
                      },
                    },
                  },
                },
              ],
            }
          : {},
        orderBy: [{ status: "asc" }, { fullName: "asc" }],
        take: 500,
        include: {
          assignments: {
            where: { endDate: null },
            take: 1,
            include: {
              vehicle: {
                select: {
                  id: true,
                  plateNumber: true,
                  model: true,
                  monthlyFee: true,
                  route: { select: { id: true, name: true, monthlyPlan: true } },
                },
              },
            },
          },
        },
      });

      const period = currentPeriodStart();
      const ids = drivers.map((driver) => driver.id);
      const [plans, payments, planTotals, paymentTotals] = await Promise.all([
        tx.vehicleMonthlyPlan.findMany({
          where: { driverId: { in: ids }, periodStart: period },
          select: { driverId: true, amount: true },
        }),
        tx.driverPayment.findMany({
          where: { driverId: { in: ids }, periodStart: period },
          select: { driverId: true, amount: true },
        }),
        tx.vehicleMonthlyPlan.groupBy({
          by: ["driverId", "periodStart"],
          where: { driverId: { in: ids } },
          _sum: { amount: true },
        }),
        tx.driverPayment.groupBy({
          by: ["driverId", "periodStart"],
          where: { driverId: { in: ids } },
          _sum: { amount: true },
        }),
      ]);

      const due = new Map<string, number>();
      for (const plan of plans) {
        due.set(plan.driverId, (due.get(plan.driverId) ?? 0) + sum(plan.amount));
      }
      const paid = new Map<string, number>();
      for (const payment of payments) {
        paid.set(
          payment.driverId,
          (paid.get(payment.driverId) ?? 0) + sum(payment.amount),
        );
      }
      const totalDebt = debtByKey(
        planTotals.map((row) => ({
          key: row.driverId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
        paymentTotals.map((row) => ({
          key: row.driverId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
      );

      return {
        items: drivers.map((driver) => {
          const assignment = driver.assignments[0] ?? null;
          const dueMonth = due.get(driver.id) ?? 0;
          const paidMonth = paid.get(driver.id) ?? 0;
          return {
            id: driver.id,
            fullName: driver.fullName,
            phone: driver.phone,
            licenseNumber: driver.licenseNumber,
            status: driver.status,
            notes: driver.notes,
            telegram: {
              linked: driver.telegramChatId !== null,
              username: driver.telegramUsername,
              linkedAt: driver.telegramLinkedAt,
            },
            vehicle: assignment
              ? {
                  id: assignment.vehicle.id,
                  plateNumber: assignment.vehicle.plateNumber,
                  model: assignment.vehicle.model,
                  monthlyFee: effectiveMonthlyFee(assignment.vehicle).toFixed(2),
                  routeName: assignment.vehicle.route?.name ?? null,
                  assignedSince: assignment.startDate,
                }
              : null,
            month: {
              period: formatPeriod(period),
              due: dueMonth.toFixed(2),
              paid: paidMonth.toFixed(2),
              debt: Math.max(0, dueMonth - paidMonth).toFixed(2),
              surplus: Math.max(0, paidMonth - dueMonth).toFixed(2),
            },
            totalDebt: ((totalDebt.get(driver.id) ?? 0) / 100).toFixed(2),
          };
        }),
      };
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateDriverDto, ip: string | null) {
    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        const driver = await tx.driver.create({
          data: {
            tenantId: actor.tenantId,
            fullName: dto.fullName,
            phone: dto.phone,
            licenseNumber: dto.licenseNumber?.trim() || null,
            notes: dto.notes?.trim() || null,
          },
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "driver.created",
          entityType: "Driver",
          entityId: driver.id,
          metadata: { fullName: driver.fullName, phone: driver.phone },
          ip,
        });
        return { driver };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Bu telefon raqami bilan haydovchi mavjud");
      }
      throw error;
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateDriverDto,
    ip: string | null,
  ) {
    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        const existing = await tx.driver.findFirst({ where: { id } });
        if (!existing) throw new NotFoundException("Haydovchi topilmadi");
        const driver = await tx.driver.update({
          where: { id },
          data: {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            ...(dto.licenseNumber !== undefined
              ? { licenseNumber: dto.licenseNumber.trim() || null }
              : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
            ...(dto.status !== undefined ? { status: dto.status } : {}),
          },
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "driver.updated",
          entityType: "Driver",
          entityId: driver.id,
          metadata: { fields: Object.keys(dto) },
          ip,
        });
        return { driver };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Bu telefon raqami bilan haydovchi mavjud");
      }
      throw error;
    }
  }

  async profile(tenantId: string, id: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const driver = await tx.driver.findFirst({
        where: { id },
        include: {
          assignments: {
            orderBy: { startDate: "desc" },
            include: {
              vehicle: {
                select: { id: true, plateNumber: true, model: true, monthlyFee: true, route: { select: { id: true, name: true, monthlyPlan: true } } },
              },
            },
          },
        },
      });
      if (!driver) throw new NotFoundException("Haydovchi topilmadi");

      const current = driver.assignments.find((row) => row.endDate === null) ?? null;
      const period = currentPeriodStart();
      const windowStart = addMonths(period, -(DEBT_WINDOW_MONTHS - 1));

      const [plans, payments, recentPayments] = await Promise.all([
        tx.vehicleMonthlyPlan.findMany({
          where: { driverId: id, periodStart: { gte: windowStart } },
          orderBy: { periodStart: "desc" },
        }),
        tx.driverPayment.findMany({
          where: { driverId: id, periodStart: { gte: windowStart } },
          orderBy: { paidAt: "desc" },
        }),
        tx.driverPayment.findMany({
          where: { driverId: id },
          orderBy: { paidAt: "desc" },
          take: 20,
          include: {
            vehicle: { select: { id: true, plateNumber: true, model: true } },
          },
        }),
      ]);

      // Qarz oy bo'yicha — avval planlar/paymentlarni oy kaliti bilan yig'amiz.
      const debt = debtByKey(
        plans.map((plan) => ({
          key: plan.vehicleId,
          periodStart: plan.periodStart,
          amount: sum(plan.amount),
        })),
        payments.map((payment) => ({
          key: payment.vehicleId,
          periodStart: payment.periodStart,
          amount: sum(payment.amount),
        })),
      );

      const periods = new Set<string>();
      for (const plan of plans) periods.add(formatPeriod(plan.periodStart));
      for (const payment of payments) periods.add(formatPeriod(payment.periodStart));
      periods.add(formatPeriod(period));

      const months = Array.from(periods)
        .sort((a, b) => b.localeCompare(a))
        .map((month) => {
          const start = parsePeriod(month)!;
          const due = plans
            .filter((plan) => formatPeriod(plan.periodStart) === month)
            .reduce((total, plan) => total + sum(plan.amount), 0);
          const paid = payments
            .filter((payment) => formatPeriod(payment.periodStart) === month)
            .reduce((total, payment) => total + sum(payment.amount), 0);
          return {
            month,
            due: due.toFixed(2),
            paid: paid.toFixed(2),
            debt: Math.max(0, due - paid).toFixed(2),
            surplus: Math.max(0, paid - due).toFixed(2),
            planCount: plans.filter((plan) => formatPeriod(plan.periodStart) === month)
              .length,
            start,
          };
        })
        .map(({ start: _start, ...row }) => row);

      const totalDebt = Array.from(debt.values()).reduce((total, value) => total + value, 0);

      return {
        driver: {
          id: driver.id,
          fullName: driver.fullName,
          phone: driver.phone,
          licenseNumber: driver.licenseNumber,
          status: driver.status,
          notes: driver.notes,
          telegram: {
            linked: driver.telegramChatId !== null,
            username: driver.telegramUsername,
            linkedAt: driver.telegramLinkedAt,
            firstName: driver.telegramFirstName,
            lastName: driver.telegramLastName,
            hasPhoto: driver.telegramPhotoFileId !== null,
          },
          ...documentsView(driver),
          createdAt: driver.createdAt,
        },
        currentVehicle: current
          ? {
              assignmentId: current.id,
              vehicleId: current.vehicle.id,
              plateNumber: current.vehicle.plateNumber,
              model: current.vehicle.model,
              monthlyFee: effectiveMonthlyFee(current.vehicle).toFixed(2),
              routeName: current.vehicle.route?.name ?? null,
              assignedSince: current.startDate,
            }
          : null,
        currentMonth: (() => {
          const state = monthState(
            plans.map((plan) => ({
              key: plan.driverId,
              periodStart: plan.periodStart,
              amount: sum(plan.amount),
            })),
            payments.map((payment) => ({
              key: payment.driverId,
              periodStart: payment.periodStart,
              amount: sum(payment.amount),
            })),
            driver.id,
            period,
          );
          return {
            period: formatPeriod(period),
            due: state.due.toFixed(2),
            paid: state.paid.toFixed(2),
            debt: state.debt.toFixed(2),
            surplus: state.surplus.toFixed(2),
          };
        })(),
        totalDebt: (totalDebt / 100).toFixed(2),
        months,
        assignments: driver.assignments.map((assignment) => ({
          id: assignment.id,
          vehicle: assignment.vehicle,
          startDate: assignment.startDate,
          endDate: assignment.endDate,
        })),
        payments: recentPayments.map(serializePayment),
      };
    });
  }

  async createTelegramLink(actor: AuthenticatedUser, id: string, ip: string | null) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const driver = await tx.driver.findFirst({ where: { id } });
      if (!driver) throw new NotFoundException("Haydovchi topilmadi");
      await tx.driver.update({
        where: { id },
        data: {
          telegramLinkTokenHash: hashToken(token),
          telegramLinkExpiresAt: expiresAt,
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "driver.telegram_link_created",
        entityType: "Driver",
        entityId: id,
        metadata: { expiresAt: expiresAt.toISOString() },
        ip,
      });
    });
    return { code: token, expiresAt };
  }

  // -------------------------------------------------------------------------
  // Avtomobil biriktirish va oylik plan
  // -------------------------------------------------------------------------

  async assign(
    actor: AuthenticatedUser,
    driverId: string,
    dto: AssignDriverDto,
    ip: string | null,
  ) {
    const startDate = dto.startDate ? parseDateOnly(dto.startDate) : todayDateOnly();
    if (!startDate) throw new BadRequestException("Boshlanish sanasi noto'g'ri");
    const monthlyAmount =
      dto.monthlyAmount !== undefined ? money(dto.monthlyAmount) : null;
    if (monthlyAmount && monthlyAmount.lt(0)) {
      throw new BadRequestException("Oylik summa manfiy bo'lishi mumkin emas");
    }

    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const [driver, vehicle] = await Promise.all([
        tx.driver.findFirst({ where: { id: driverId, status: "ACTIVE" } }),
        tx.vehicle.findFirst({
          where: { id: dto.vehicleId },
          include: { route: { select: { monthlyPlan: true } } },
        }),
      ]);
      if (!driver) throw new NotFoundException("Faol haydovchi topilmadi");
      if (!vehicle) throw new NotFoundException("Avtomobil topilmadi");

      const previousForVehicle = await tx.vehicleAssignment.findFirst({
        where: { vehicleId: vehicle.id, endDate: null },
      });
      const previousForDriver = await tx.vehicleAssignment.findFirst({
        where: { driverId: driver.id, endDate: null },
      });

      if (
        previousForVehicle &&
        previousForDriver &&
        previousForVehicle.id === previousForDriver.id
      ) {
        // Allaqachon shu juftlik biriktirilgan — faqat oylik plan yangilanadi.
      } else {
        await this.closeAssignment(tx, previousForVehicle, startDate);
        await this.closeAssignment(tx, previousForDriver, startDate);
      }

      const alreadyAssigned =
        previousForVehicle?.id !== undefined &&
        previousForDriver?.id !== undefined &&
        previousForVehicle.id === previousForDriver.id;

      let assignmentId = previousForVehicle?.id ?? null;
      if (!alreadyAssigned) {
        const assignment = await tx.vehicleAssignment.create({
          data: {
            tenantId: actor.tenantId,
            vehicleId: vehicle.id,
            driverId: driver.id,
            startDate,
            createdById: actor.userId,
          },
        });
        assignmentId = assignment.id;
      }

      const fee = monthlyAmount ?? effectiveMonthlyFee(vehicle);
      if (monthlyAmount) {
        await tx.vehicle.update({
          where: { id: vehicle.id },
          data: { monthlyFee: monthlyAmount },
        });
      }

      // Boshlangan oydan joriy oygacha plan yaratiladi (24 oydan uzoqqa emas).
      const period = currentPeriodStart();
      const firstMonth = periodStartFor(startDate);
      const earliest = addMonths(period, -23);
      const from = firstMonth < earliest ? earliest : firstMonth;
      const rows = monthsBetween(from, period).map((month) => ({
        tenantId: actor.tenantId,
        vehicleId: vehicle.id,
        driverId: driver.id,
        periodStart: month,
        amount: fee,
      }));
      if (rows.length > 0) {
        await tx.vehicleMonthlyPlan.createMany({ data: rows, skipDuplicates: true });
      }
      if (monthlyAmount) {
        await tx.vehicleMonthlyPlan.updateMany({
          where: {
            vehicleId: vehicle.id,
            periodStart: period,
          },
          data: { amount: monthlyAmount, driverId: driver.id },
        });
      }

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "driver.assigned",
        entityType: "VehicleAssignment",
        entityId: assignmentId,
        metadata: {
          driverId: driver.id,
          vehicleId: vehicle.id,
          startDate: startDate.toISOString().slice(0, 10),
          monthlyAmount: monthlyAmount?.toFixed(2) ?? null,
        },
        ip,
      });

      return {
        assignmentId,
        driverId: driver.id,
        vehicleId: vehicle.id,
        startDate,
        monthlyFee: fee.toFixed(2),
      };
    });
  }

  private async closeAssignment(
    tx: TenantTx,
    assignment: { id: string; startDate: Date } | null,
    startDate: Date,
  ) {
    if (!assignment) return;
    const previousDay = addDays(startDate, -1);
    const endDate =
      previousDay.getTime() >= assignment.startDate.getTime()
        ? previousDay
        : assignment.startDate;
    await tx.vehicleAssignment.update({
      where: { id: assignment.id },
      data: { endDate },
    });
  }

  async unassign(
    actor: AuthenticatedUser,
    driverId: string,
    dto: UnassignDriverDto,
    ip: string | null,
  ) {
    const endDate = dto.endDate ? parseDateOnly(dto.endDate) : todayDateOnly();
    if (!endDate) throw new BadRequestException("Tugash sanasi noto'g'ri");
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const assignment = await tx.vehicleAssignment.findFirst({
        where: { driverId, endDate: null },
      });
      if (!assignment) throw new NotFoundException("Faol biriktirish topilmadi");
      if (endDate.getTime() < assignment.startDate.getTime()) {
        throw new BadRequestException("Tugash sanasi boshlanishdan oldin bo'lishi mumkin emas");
      }
      const updated = await tx.vehicleAssignment.update({
        where: { id: assignment.id },
        data: { endDate },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "driver.unassigned",
        entityType: "VehicleAssignment",
        entityId: assignment.id,
        metadata: { endDate: endDate.toISOString().slice(0, 10) },
        ip,
      });
      return { assignment: updated };
    });
  }

  async updatePlan(
    actor: AuthenticatedUser,
    planId: string,
    dto: UpdateMonthlyPlanDto,
    ip: string | null,
  ) {
    const amount = money(dto.amount);
    if (amount.lt(0)) throw new BadRequestException("Summa manfiy bo'lishi mumkin emas");
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const plan = await tx.vehicleMonthlyPlan.findFirst({ where: { id: planId } });
      if (!plan) throw new NotFoundException("Oylik plan topilmadi");
      const updated = await tx.vehicleMonthlyPlan.update({
        where: { id: planId },
        data: { amount, note: dto.note?.trim() || plan.note },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "monthly_plan.updated",
        entityType: "VehicleMonthlyPlan",
        entityId: planId,
        metadata: { from: plan.amount.toFixed(2), to: amount.toFixed(2) },
        ip,
      });
      return { plan: serializePlan(updated) };
    });
  }

  // -------------------------------------------------------------------------
  // Kunlik to'lovlar va hisobotlar
  // -------------------------------------------------------------------------

  async daily(tenantId: string, dateRaw?: string, query?: string) {
    const date = dateRaw ? parseDateOnly(dateRaw) : todayDateOnly();
    if (!date) throw new BadRequestException("Sana noto'g'ri");
    const period = periodStartFor(date);
    const search = query?.trim();
    const day = tashkentDayRange(date);

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const assignments = await tx.vehicleAssignment.findMany({
        where: {
          startDate: { lte: date },
          OR: [{ endDate: null }, { endDate: { gte: date } }],
        },
        include: {
          driver: {
            select: { id: true, fullName: true, phone: true, status: true },
          },
          vehicle: {
            select: {
              id: true,
              plateNumber: true,
              model: true,
              monthlyFee: true,
              status: true,
              route: { select: { id: true, name: true, monthlyPlan: true } },
            },
          },
        },
        orderBy: { vehicle: { plateNumber: "asc" } },
      });

      const matches = (row: (typeof assignments)[number]) =>
        !search ||
        row.vehicle.plateNumber.toLowerCase().includes(search.toLowerCase()) ||
        row.vehicle.model.toLowerCase().includes(search.toLowerCase()) ||
        row.driver.fullName.toLowerCase().includes(search.toLowerCase()) ||
        row.driver.phone.includes(search) ||
        (row.vehicle.route?.name.toLowerCase().includes(search.toLowerCase()) ?? false);
      const filtered = assignments.filter(matches);
      const vehicleIds = filtered.map((row) => row.vehicle.id);

      // Joriy oy planlari avtomatik tayyorlanadi (yangi oy boshlanganda).
      const planRows = filtered
        .filter((row) => effectiveMonthlyFee(row.vehicle).gt(0))
        .map((row) => ({
          tenantId,
          vehicleId: row.vehicle.id,
          driverId: row.driver.id,
          periodStart: period,
          amount: effectiveMonthlyFee(row.vehicle),
        }));
      if (planRows.length > 0) {
        await tx.vehicleMonthlyPlan.createMany({ data: planRows, skipDuplicates: true });
      }

      const [plans, monthPayments, todayPayments, planTotals, paymentTotals] =
        await Promise.all([
          tx.vehicleMonthlyPlan.findMany({
            where: { vehicleId: { in: vehicleIds }, periodStart: period },
            select: { id: true, vehicleId: true, amount: true, driverId: true },
          }),
          tx.driverPayment.findMany({
            where: { vehicleId: { in: vehicleIds }, periodStart: period },
            select: { vehicleId: true, amount: true, method: true },
          }),
          tx.driverPayment.findMany({
            where: { paidAt: { gte: day.from, lt: day.to } },
            include: {
              driver: { select: { id: true, fullName: true, phone: true } },
              vehicle: { select: { id: true, plateNumber: true, model: true } },
              receivedBy: { select: { id: true, fullName: true } },
            },
            orderBy: { paidAt: "desc" },
          }),
          tx.vehicleMonthlyPlan.groupBy({
            by: ["vehicleId", "periodStart"],
            where: { vehicleId: { in: vehicleIds } },
            _sum: { amount: true },
          }),
          tx.driverPayment.groupBy({
            by: ["vehicleId", "periodStart"],
            where: { vehicleId: { in: vehicleIds } },
            _sum: { amount: true },
          }),
        ]);

      const dueMap = new Map<string, number>();
      const planIdMap = new Map<string, string>();
      for (const plan of plans) {
        dueMap.set(plan.vehicleId, (dueMap.get(plan.vehicleId) ?? 0) + sum(plan.amount));
        planIdMap.set(plan.vehicleId, plan.id);
      }
      const paidMap = new Map<string, number>();
      for (const payment of monthPayments) {
        paidMap.set(
          payment.vehicleId,
          (paidMap.get(payment.vehicleId) ?? 0) + sum(payment.amount),
        );
      }
      const todayMap = new Map<string, number>();
      for (const payment of todayPayments) {
        todayMap.set(
          payment.vehicleId,
          (todayMap.get(payment.vehicleId) ?? 0) + sum(payment.amount),
        );
      }
      const totalDebt = debtByKey(
        planTotals.map((row) => ({
          key: row.vehicleId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
        paymentTotals.map((row) => ({
          key: row.vehicleId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
      );

      const items = filtered.map((row) => {
        const due = dueMap.get(row.vehicle.id) ?? 0;
        const paid = paidMap.get(row.vehicle.id) ?? 0;
        return {
          vehicleId: row.vehicle.id,
          plateNumber: row.vehicle.plateNumber,
          model: row.vehicle.model,
          vehicleStatus: row.vehicle.status,
          monthlyFee: effectiveMonthlyFee(row.vehicle).toFixed(2),
          route: row.vehicle.route
            ? { id: row.vehicle.route.id, name: row.vehicle.route.name }
            : null,
          assignmentId: row.id,
          assignedSince: row.startDate,
          driver: row.driver,
          planId: planIdMap.get(row.vehicle.id) ?? null,
          month: {
            period: formatPeriod(period),
            due: due.toFixed(2),
            paid: paid.toFixed(2),
            debt: Math.max(0, due - paid).toFixed(2),
            surplus: Math.max(0, paid - due).toFixed(2),
          },
          paidToday: (todayMap.get(row.vehicle.id) ?? 0).toFixed(2),
          totalDebt: ((totalDebt.get(row.vehicle.id) ?? 0) / 100).toFixed(2),
        };
      });

      items.sort((a, b) => {
        const debt = Number(b.month.debt) - Number(a.month.debt);
        return debt !== 0 ? debt : a.plateNumber.localeCompare(b.plateNumber);
      });

      const summary = {
        vehicles: items.length,
        withDriver: items.filter((item) => item.driver).length,
        expected: items.reduce((total, item) => total + Number(item.month.due), 0).toFixed(2),
        paidMonth: items.reduce((total, item) => total + Number(item.month.paid), 0).toFixed(2),
        debtMonth: items.reduce((total, item) => total + Number(item.month.debt), 0).toFixed(2),
        collectedToday: todayPayments
          .reduce((total, payment) => total + sum(payment.amount), 0)
          .toFixed(2),
        paymentsToday: todayPayments.length,
        totalDebt: items.reduce((total, item) => total + Number(item.totalDebt), 0).toFixed(2),
      };

      return {
        date: date.toISOString().slice(0, 10),
        period: formatPeriod(period),
        summary,
        items,
        payments: todayPayments.map(serializePayment),
        unassignedVehicles: await tx.vehicle.count({
          where: {
            status: { not: "INACTIVE" },
            assignments: { none: { endDate: null } },
          },
        }),
      };
    });
  }

  async createPayment(
    actor: AuthenticatedUser,
    dto: CreateDriverPaymentDto,
    idempotencyKey: string,
    ip: string | null,
  ) {
    const amount = money(dto.amount);
    if (amount.lte(0)) throw new BadRequestException("Summa noldan katta bo'lishi kerak");
    const now = new Date();
    let paidAt: Date;
    let paidDate: Date;
    if (dto.paidAt && /^\d{4}-\d{2}-\d{2}$/.test(dto.paidAt.trim())) {
      const day = parseDateOnly(dto.paidAt);
      if (!day) throw new BadRequestException("To'lov sanasi noto'g'ri");
      paidDate = day;
      paidAt =
        day.getTime() === todayDateOnly(now).getTime()
          ? now
          : new Date(tashkentDayRange(day).from.getTime() + 12 * 60 * 60 * 1000);
    } else {
      paidAt = dto.paidAt ? new Date(dto.paidAt) : now;
      if (Number.isNaN(paidAt.getTime())) {
        throw new BadRequestException("To'lov sanasi noto'g'ri");
      }
      paidDate = todayDateOnly(paidAt);
    }
    if (paidAt.getTime() > now.getTime() + 5 * 60 * 1000) {
      throw new BadRequestException("Kelajakdagi sana bilan to'lov qabul qilinmaydi");
    }
    const key = idempotencyKey.trim();
    if (key && !/^[A-Za-z0-9_.:-]{8,120}$/.test(key)) {
      throw new BadRequestException(
        "Idempotency-Key sarlavhasi 8-120 belgidan iborat bo'lishi kerak",
      );
    }
    const period = periodStartFor(paidAt);

    try {
      const result = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        if (key) {
          const existing = await tx.driverPayment.findFirst({
            where: { idempotencyKey: key },
            include: {
              driver: { select: { id: true, fullName: true } },
              vehicle: { select: { id: true, plateNumber: true } },
            },
          });
          if (existing) {
            if (existing.vehicleId !== dto.vehicleId || !existing.amount.eq(amount)) {
              throw new ConflictException("Idempotency-Key boshqa to'lov bilan ishlatilgan");
            }
            return { payment: serializePayment(existing), idempotentReplay: true };
          }
        }

        const vehicle = await tx.vehicle.findFirst({
          where: { id: dto.vehicleId },
          include: { route: { select: { monthlyPlan: true } } },
        });
        if (!vehicle) throw new NotFoundException("Avtomobil topilmadi");
        const fee = effectiveMonthlyFee(vehicle);

        const assignment = await tx.vehicleAssignment.findFirst({
          where: {
            vehicleId: vehicle.id,
            startDate: { lte: paidDate },
            OR: [{ endDate: null }, { endDate: { gte: paidDate } }],
          },
          include: { driver: { select: { id: true, fullName: true } } },
        });
        if (!assignment) {
          throw new BadRequestException(
            "Bu avtomobilga haydovchi biriktirilmagan. Avval haydovchini biriktiring.",
          );
        }
        if (dto.driverId && dto.driverId !== assignment.driverId) {
          throw new BadRequestException(
            "Tanlangan haydovchi bu avtomobilga biriktirilmagan",
          );
        }

        let plan = await tx.vehicleMonthlyPlan.findFirst({
          where: { vehicleId: vehicle.id, periodStart: period },
        });
        if (!plan && fee.gt(0)) {
          plan = await tx.vehicleMonthlyPlan.create({
            data: {
              tenantId: actor.tenantId,
              vehicleId: vehicle.id,
              driverId: assignment.driverId,
              periodStart: period,
              amount: fee,
            },
          });
        }

        const created = await tx.driverPayment.create({
          data: {
            tenantId: actor.tenantId,
            driverId: assignment.driverId,
            vehicleId: vehicle.id,
            monthlyPlanId: plan?.id ?? null,
            amount,
            method: dto.method,
            periodStart: period,
            paidAt,
            source: "PANEL",
            note: dto.note?.trim() || null,
            receivedById: actor.userId,
            idempotencyKey: key || null,
          },
          include: {
            driver: { select: { id: true, fullName: true, phone: true } },
            vehicle: { select: { id: true, plateNumber: true, model: true } },
            receivedBy: { select: { id: true, fullName: true } },
          },
        });

        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "driver_payment.created",
          entityType: "DriverPayment",
          entityId: created.id,
          metadata: {
            driverId: created.driverId,
            vehicleId: created.vehicleId,
            amount: created.amount.toFixed(2),
            method: created.method,
            period: formatPeriod(period),
          },
          ip,
        });

        const [dueRow, paidRow] = await Promise.all([
          tx.vehicleMonthlyPlan.findFirst({
            where: { vehicleId: vehicle.id, periodStart: period },
            select: { amount: true },
          }),
          tx.driverPayment.aggregate({
            where: { vehicleId: vehicle.id, periodStart: period },
            _sum: { amount: true },
          }),
        ]);
        const due = sum(dueRow?.amount);
        const paid = sum(paidRow._sum.amount);

        return {
          payment: serializePayment(created),
          month: {
            period: formatPeriod(period),
            due: due.toFixed(2),
            paid: paid.toFixed(2),
            debt: Math.max(0, due - paid).toFixed(2),
          },
          idempotentReplay: false,
        };
      });

      if (!result.idempotentReplay && "month" in result && result.month) {
        const p = result.payment as {
          id: string;
          driverId: string;
          vehicleId: string;
          amount: string;
          paidAt: unknown;
          method: string;
          vehicle?: { plateNumber?: string };
          driver?: { fullName?: string };
        };
        await this.notifications.enqueue({
          tenantId: actor.tenantId,
          type: "driver.payment_received",
          dedupeKey: `driver_pay_${p.id}`,
          occurredAt:
            typeof p.paidAt === "string"
              ? p.paidAt
              : p.paidAt instanceof Date
                ? p.paidAt.toISOString()
                : new Date().toISOString(),
          data: {
            driverPaymentId: p.id,
            driverId: p.driverId,
            vehicleId: p.vehicleId,
            amount: p.amount,
            plateNumber: p.vehicle?.plateNumber,
            driverName: p.driver?.fullName,
            receivedByName: actor.fullName,
            method: p.method,
            paidMonth: result.month.period,
            paidTotal: result.month.paid,
            debtAmount: result.month.debt,
          },
        });
      }

      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Bu to'lov allaqachon saqlangan");
      }
      throw error;
    }
  }

  async listPayments(
    tenantId: string,
    query: {
      from?: string;
      to?: string;
      q?: string;
      driverId?: string;
      limit?: string;
    },
  ) {
    const take = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
    const from = query.from ? parseDateOnly(query.from) : null;
    const to = query.to ? parseDateOnly(query.to) : null;
    if ((query.from && !from) || (query.to && !to)) {
      throw new BadRequestException("Sana noto'g'ri");
    }
    const search = query.q?.trim();

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.driverPayment.findMany({
        where: {
          ...(from ? { paidAt: { gte: tashkentDayRange(from).from } } : {}),
          ...(to ? { paidAt: { lt: tashkentDayRange(to).to } } : {}),
          ...(query.driverId ? { driverId: query.driverId } : {}),
          ...(search
            ? {
                OR: [
                  { driver: { fullName: { contains: search, mode: "insensitive" } } },
                  { driver: { phone: { contains: search } } },
                  { vehicle: { plateNumber: { contains: search, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        orderBy: { paidAt: "desc" },
        take,
        include: {
          driver: { select: { id: true, fullName: true, phone: true } },
          vehicle: { select: { id: true, plateNumber: true, model: true } },
          receivedBy: { select: { id: true, fullName: true } },
        },
      });
      const total = items.reduce((sumValue, item) => sumValue + Number(item.amount), 0);
      const cash = items
        .filter((item) => item.method === "CASH")
        .reduce((sumValue, item) => sumValue + Number(item.amount), 0);
      const card = items
        .filter((item) => item.method === "CARD")
        .reduce((sumValue, item) => sumValue + Number(item.amount), 0);
      return {
        items: items.map(serializePayment),
        totals: {
          count: items.length,
          amount: total.toFixed(2),
          cash: cash.toFixed(2),
          card: card.toFixed(2),
        },
      };
    });
  }

  async report(tenantId: string, monthRaw?: string) {
    const period = monthRaw ? parsePeriod(monthRaw) : currentPeriodStart();
    if (!period) throw new BadRequestException("Oy noto'g'ri (YYYY-MM)");

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const plans = await tx.vehicleMonthlyPlan.findMany({
        where: { periodStart: period },
        include: {
          driver: { select: { id: true, fullName: true, phone: true } },
          vehicle: { select: { id: true, plateNumber: true, model: true } },
        },
      });
      const payments = await tx.driverPayment.groupBy({
        by: ["driverId"],
        where: { periodStart: period },
        _sum: { amount: true },
        _count: { _all: true },
      });
      const paidMap = new Map(
        payments.map((row) => [row.driverId, sum(row._sum.amount)]),
      );
      const countMap = new Map(
        payments.map((row) => [row.driverId, row._count._all]),
      );

      const planTotals = await tx.vehicleMonthlyPlan.groupBy({
        by: ["driverId", "periodStart"],
        _sum: { amount: true },
      });
      const paymentTotals = await tx.driverPayment.groupBy({
        by: ["driverId", "periodStart"],
        _sum: { amount: true },
      });
      const debt = debtByKey(
        planTotals.map((row) => ({
          key: row.driverId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
        paymentTotals.map((row) => ({
          key: row.driverId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
      );

      const rows = plans.map((plan) => {
        const paid = paidMap.get(plan.driverId) ?? 0;
        const due = sum(plan.amount);
        return {
          planId: plan.id,
          driver: plan.driver,
          vehicle: plan.vehicle,
          due: due.toFixed(2),
          paid: paid.toFixed(2),
          debt: Math.max(0, due - paid).toFixed(2),
          surplus: Math.max(0, paid - due).toFixed(2),
          payments: countMap.get(plan.driverId) ?? 0,
          totalDebt: ((debt.get(plan.driverId) ?? 0) / 100).toFixed(2),
        };
      });

      return {
        month: formatPeriod(period),
        rows,
        totals: {
          due: rows.reduce((total, row) => total + Number(row.due), 0).toFixed(2),
          paid: rows.reduce((total, row) => total + Number(row.paid), 0).toFixed(2),
          debt: rows.reduce((total, row) => total + Number(row.debt), 0).toFixed(2),
          totalDebt: rows
            .reduce((total, row) => total + Number(row.totalDebt), 0)
            .toFixed(2),
        },
      };
    });
  }

  async search(tenantId: string, query?: string) {
    const search = query?.trim();
    if (!search) return { drivers: [], vehicles: [] };
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [drivers, vehicles] = await Promise.all([
        tx.driver.findMany({
          where: {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          },
          take: 8,
          orderBy: { fullName: "asc" },
          include: {
            assignments: {
              where: { endDate: null },
              take: 1,
              include: {
                vehicle: { select: { id: true, plateNumber: true, model: true } },
              },
            },
          },
        }),
        tx.vehicle.findMany({
          where: {
            OR: [
              { plateNumber: { contains: search, mode: "insensitive" } },
              { model: { contains: search, mode: "insensitive" } },
            ],
          },
          take: 8,
          orderBy: { plateNumber: "asc" },
          include: {
            assignments: {
              where: { endDate: null },
              take: 1,
              include: {
                driver: { select: { id: true, fullName: true, phone: true } },
              },
            },
          },
        }),
      ]);
      return {
        drivers: drivers.map((driver) => ({
          id: driver.id,
          fullName: driver.fullName,
          phone: driver.phone,
          vehicle: driver.assignments[0]?.vehicle ?? null,
        })),
        vehicles: vehicles.map((vehicle) => ({
          id: vehicle.id,
          plateNumber: vehicle.plateNumber,
          model: vehicle.model,
          monthlyFee: vehicle.monthlyFee.toFixed(2),
          driver: vehicle.assignments[0]?.driver ?? null,
        })),
      };
    });
  }

  /** Bot uchun: chatId bo'yicha haydovchi profilining qisqa ko'rinishi. */
  async botDriverProfile(tenantId: string, driverId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const driver = await tx.driver.findFirst({
        where: { id: driverId, status: "ACTIVE" },
        include: {
          assignments: {
            where: { endDate: null },
            take: 1,
            include: {
              vehicle: {
                select: {
                  id: true,
                  plateNumber: true,
                  model: true,
                  monthlyFee: true,
                  route: { select: { id: true, name: true, monthlyPlan: true } },
                },
              },
            },
          },
        },
      });
      if (!driver) throw new NotFoundException("Haydovchi topilmadi");
      const period = currentPeriodStart();
      const windowStart = addMonths(period, -(DEBT_WINDOW_MONTHS - 1));
      const [dueRow, paidRow, planTotals, paymentTotals, payments] =
        await Promise.all([
          tx.vehicleMonthlyPlan.findMany({
            where: { driverId, periodStart: period },
            select: { amount: true },
          }),
          tx.driverPayment.findMany({
            where: { driverId, periodStart: period },
            select: { amount: true, method: true },
          }),
          tx.vehicleMonthlyPlan.groupBy({
            by: ["driverId", "periodStart"],
            where: { driverId, periodStart: { gte: windowStart } },
            _sum: { amount: true },
          }),
          tx.driverPayment.groupBy({
            by: ["driverId", "periodStart"],
            where: { driverId, periodStart: { gte: windowStart } },
            _sum: { amount: true },
          }),
          tx.driverPayment.findMany({
            where: { driverId },
            orderBy: { paidAt: "desc" },
            take: 5,
            include: {
              vehicle: { select: { plateNumber: true } },
            },
          }),
        ]);

      const due = dueRow.reduce((total, row) => total + sum(row.amount), 0);
      const paid = paidRow.reduce((total, row) => total + sum(row.amount), 0);
      const debt = debtByKey(
        planTotals.map((row) => ({
          key: row.driverId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
        paymentTotals.map((row) => ({
          key: row.driverId,
          periodStart: row.periodStart,
          amount: sum(row._sum.amount),
        })),
      );
      const totalDebt = debt.get(driverId) ?? 0;
      const vehicle = driver.assignments[0]?.vehicle ?? null;

      return {
        fullName: driver.fullName,
        phone: driver.phone,
        companyName: (
          await tx.company.findFirst({ select: { name: true } })
        )?.name ?? null,
        vehicle: vehicle
          ? {
              plateNumber: vehicle.plateNumber,
              model: vehicle.model,
              monthlyFee: effectiveMonthlyFee(vehicle).toFixed(2),
              routeName: vehicle.route?.name ?? null,
            }
          : null,
        month: {
          period: formatPeriod(period),
          due: due.toFixed(2),
          paid: paid.toFixed(2),
          debt: Math.max(0, due - paid).toFixed(2),
        },
        totalDebt: (totalDebt / 100).toFixed(2),
        payments: payments.map((payment) => ({
          id: payment.id,
          amount: payment.amount.toFixed(2),
          method: payment.method,
          paidAt: payment.paidAt,
          plateNumber: payment.vehicle.plateNumber,
        })),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Hujjatlar (passport, guvohnoma) va Telegram profili
  // -------------------------------------------------------------------------

  async documents(tenantId: string, driverId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const driver = await tx.driver.findFirst({ where: { id: driverId } });
      if (!driver) throw new NotFoundException("Haydovchi topilmadi");
      return documentsView(driver);
    });
  }

  /** Bir nechta hujjat maydonini birga yangilaydi (panel yoki bot). */
  async updateDocuments(
    tenantId: string,
    driverId: string,
    changes: Partial<Record<DriverDocumentField, string | null>>,
    actor: { userId: string | null; source: "PANEL" | "BOT" },
    ip: string | null,
  ) {
    const data: Partial<Record<DriverDocumentField, string | Date | null>> = {};
    for (const field of DRIVER_DOCUMENT_FIELDS) {
      if (changes[field] !== undefined) {
        data[field] = normalizeDocumentValue(field, changes[field]);
      }
    }
    const fields = Object.keys(data);
    if (fields.length === 0) throw new BadRequestException("O'zgartirish yo'q");

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.driver.findFirst({ where: { id: driverId } });
      if (!existing) throw new NotFoundException("Haydovchi topilmadi");
      const driver = await tx.driver.update({
        where: { id: driverId },
        data: data as Prisma.DriverUncheckedUpdateInput,
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: actor.userId,
        actorType: actor.source === "BOT" ? "INTEGRATION" : "USER",
        action: "driver.documents_updated",
        entityType: "Driver",
        entityId: driverId,
        metadata: { fields, source: actor.source },
        ip,
      });
      return documentsView(driver);
    });
  }

  /** Telegram ulanganda ism, username va profil rasmi haydovchi profiliga qo'shiladi. */
  async syncTelegramProfile(
    tenantId: string,
    driverId: string,
    profile: {
      username?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      photoFileId?: string | null;
    },
  ) {
    const photo =
      profile.photoFileId && TELEGRAM_FILE_ID.test(profile.photoFileId)
        ? profile.photoFileId
        : undefined;
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      await tx.driver.update({
        where: { id: driverId },
        data: {
          ...(profile.username !== undefined
            ? { telegramUsername: profile.username?.slice(0, 64) || null }
            : {}),
          ...(profile.firstName !== undefined
            ? { telegramFirstName: profile.firstName?.slice(0, 64) || null }
            : {}),
          ...(profile.lastName !== undefined
            ? { telegramLastName: profile.lastName?.slice(0, 64) || null }
            : {}),
          ...(photo ? { telegramPhotoFileId: photo } : {}),
        },
      });
      return { ok: true };
    });
  }

  async photoFileId(tenantId: string, driverId: string, kind: DriverPhotoKind) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const driver = await tx.driver.findFirst({
        where: { id: driverId },
        select: {
          telegramPhotoFileId: true,
          passportPhotoFileId: true,
          licensePhotoFileId: true,
        },
      });
      if (!driver) throw new NotFoundException("Haydovchi topilmadi");
      const fileId =
        kind === "telegram"
          ? driver.telegramPhotoFileId
          : kind === "passport"
            ? driver.passportPhotoFileId
            : driver.licensePhotoFileId;
      if (!fileId) throw new NotFoundException("Rasm yo'q");
      return fileId;
    });
  }
}
