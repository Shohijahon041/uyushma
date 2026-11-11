import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, WaybillStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { CreateWaybillDto } from "./dto/create-waybill.dto";
import { UpdateWaybillDto } from "./dto/update-waybill.dto";
import { CloseWaybillDto } from "./dto/close-waybill.dto";
import { QueryWaybillDto } from "./dto/query-waybill.dto";

@Injectable()
export class WaybillsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: QueryWaybillDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.WaybillWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
    };

    if (query.date) {
      where.date = new Date(query.date);
    } else if (query.from || query.to) {
      where.date = {};
      if (query.from) where.date.gte = new Date(query.from);
      if (query.to) where.date.lte = new Date(query.to);
    }

    if (query.q) {
      const q = query.q.trim();
      where.OR = [
        { number: { contains: q, mode: "insensitive" } },
        { driver: { fullName: { contains: q, mode: "insensitive" } } },
        { driver: { phone: { contains: q } } },
        { vehicle: { plateNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.waybill.findMany({
          where,
          include: {
            driver: {
              select: {
                id: true,
                fullName: true,
                phone: true,
                licenseNumber: true,
              },
            },
            vehicle: {
              select: {
                id: true,
                plateNumber: true,
                model: true,
                owner: {
                  select: {
                    id: true,
                    fullName: true,
                    phone: true,
                  },
                },
              },
            },
            route: {
              select: {
                id: true,
                name: true,
                origin: true,
                destination: true,
              },
            },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          skip,
          take: limit,
        }),
        tx.waybill.count({ where }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };
    });
  }

  async stats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [todayTotal, active, completed, cancelled, medicalPassed] = await Promise.all([
        tx.waybill.count({
          where: { tenantId, date: today },
        }),
        tx.waybill.count({
          where: { tenantId, status: WaybillStatus.ACTIVE },
        }),
        tx.waybill.count({
          where: { tenantId, status: WaybillStatus.COMPLETED, date: today },
        }),
        tx.waybill.count({
          where: { tenantId, status: WaybillStatus.CANCELLED, date: today },
        }),
        tx.waybill.count({
          where: { tenantId, date: today, medicalPassed: true, technicalPassed: true },
        }),
      ]);

      return {
        todayTotal,
        active,
        completed,
        cancelled,
        medicalPassed,
      };
    });
  }

  async nextNumber(tenantId: string): Promise<{ nextNumber: string }> {
    const currentYear = new Date().getFullYear().toString().slice(-2);
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const count = await tx.waybill.count({
        where: {
          tenantId,
          number: { startsWith: `PV-${currentYear}-` },
        },
      });
      const nextSeq = String(count + 1).padStart(4, "0");
      return { nextNumber: `PV-${currentYear}-${nextSeq}` };
    });
  }

  async getById(tenantId: string, id: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const waybill = await tx.waybill.findUnique({
        where: { id_tenantId: { id, tenantId } },
        include: {
          company: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          driver: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              licenseNumber: true,
              licenseExpiresAt: true,
            },
          },
          vehicle: {
            select: {
              id: true,
              plateNumber: true,
              model: true,
              capacity: true,
              owner: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                },
              },
            },
          },
          route: {
            select: {
              id: true,
              name: true,
              origin: true,
              destination: true,
              distanceKm: true,
            },
          },
        },
      });

      if (!waybill) {
        throw new NotFoundException("Yo'l varaqasi topilmadi");
      }
      return waybill;
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateWaybillDto, ip: string | null) {
    const tenantId = actor.tenantId;

    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [driver, vehicle] = await Promise.all([
        tx.driver.findUnique({
          where: { id_tenantId: { id: dto.driverId, tenantId } },
        }),
        tx.vehicle.findUnique({
          where: { id_tenantId: { id: dto.vehicleId, tenantId } },
        }),
      ]);

      if (!driver) throw new NotFoundException("Haydovchi topilmadi");
      if (!vehicle) throw new NotFoundException("Avtomobil topilmadi");

      let number = dto.number?.trim();
      if (!number) {
        const currentYear = new Date().getFullYear().toString().slice(-2);
        const count = await tx.waybill.count({
          where: { tenantId, number: { startsWith: `PV-${currentYear}-` } },
        });
        number = `PV-${currentYear}-${String(count + 1).padStart(4, "0")}`;
      }

      const existing = await tx.waybill.findUnique({
        where: { tenantId_number: { tenantId, number } },
      });
      if (existing) {
        throw new ConflictException(`Ushbu raqamli (${number}) yo'l varaqasi allaqachon mavjud`);
      }

      const publicToken = randomBytes(24).toString("hex");
      const date = new Date(dto.date);
      const validUntil = dto.validUntil
        ? new Date(dto.validUntil)
        : new Date(date.getTime() + 24 * 60 * 60 * 1000);

      const departureTime = dto.departureTime ? new Date(dto.departureTime) : new Date();

      // Transport egasiga / transportga amaldagi boshqaruvchi haydovchini biriktirish
      if (dto.assignDriver !== false) {
        const activeAssignment = await tx.vehicleAssignment.findFirst({
          where: {
            vehicleId: dto.vehicleId,
            endDate: null,
          },
        });
        if (!activeAssignment || activeAssignment.driverId !== dto.driverId) {
          if (activeAssignment) {
            await tx.vehicleAssignment.update({
              where: { id: activeAssignment.id },
              data: { endDate: date },
            });
          }
          const driverPrev = await tx.vehicleAssignment.findFirst({
            where: {
              driverId: dto.driverId,
              endDate: null,
            },
          });
          if (driverPrev && driverPrev.id !== activeAssignment?.id) {
            await tx.vehicleAssignment.update({
              where: { id: driverPrev.id },
              data: { endDate: date },
            });
          }
          await tx.vehicleAssignment.create({
            data: {
              tenantId,
              vehicleId: dto.vehicleId,
              driverId: dto.driverId,
              startDate: date,
              createdById: actor.userId,
            },
          });
        }
      }

      const waybill = await tx.waybill.create({
        data: {
          tenantId,
          number,
          status: WaybillStatus.ACTIVE,
          date,
          validUntil,
          driverId: dto.driverId,
          vehicleId: dto.vehicleId,
          routeId: dto.routeId ?? vehicle.routeId,

          medicalPassed: dto.medicalPassed ?? true,
          medicalDoctorName: dto.medicalDoctorName,
          medicalCheckedAt: dto.medicalCheckedAt ? new Date(dto.medicalCheckedAt) : new Date(),
          medicalNotes: dto.medicalNotes ?? "Sog'lom, safarga ruxsat berildi",

          technicalPassed: dto.technicalPassed ?? true,
          mechanicName: dto.mechanicName,
          technicalCheckedAt: dto.technicalCheckedAt ? new Date(dto.technicalCheckedAt) : new Date(),
          technicalNotes: dto.technicalNotes ?? "Texnik soz holatda, yo'lga chiqishga ruxsat",

          startOdometer: dto.startOdometer,
          departureTime,

          fuelType: dto.fuelType ?? "METAN",
          fuelBefore: dto.fuelBefore !== undefined ? new Prisma.Decimal(dto.fuelBefore) : null,
          fuelGiven: dto.fuelGiven !== undefined ? new Prisma.Decimal(dto.fuelGiven) : null,

          dispatcherName: dto.dispatcherName,
          specialNotes: dto.specialNotes,
          publicToken,
        },
        include: {
          driver: true,
          vehicle: {
            include: {
              owner: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                },
              },
            },
          },
          route: true,
        },
      });

      await this.audit.record(tx, {
        tenantId,
        actorUserId: actor.userId,
        action: "waybill.created",
        entityType: "Waybill",
        entityId: waybill.id,
        ip,
        metadata: { number, driverId: dto.driverId, vehicleId: dto.vehicleId },
      });

      return waybill;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateWaybillDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.waybill.findUnique({
        where: { id_tenantId: { id, tenantId } },
      });
      if (!existing) throw new NotFoundException("Yo'l varaqasi topilmadi");

      const data: Prisma.WaybillUpdateInput = {};
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.number !== undefined) data.number = dto.number.trim();
      if (dto.date !== undefined) data.date = new Date(dto.date);
      if (dto.validUntil !== undefined) data.validUntil = new Date(dto.validUntil);
      if (dto.medicalPassed !== undefined) data.medicalPassed = dto.medicalPassed;
      if (dto.medicalDoctorName !== undefined) data.medicalDoctorName = dto.medicalDoctorName;
      if (dto.medicalCheckedAt !== undefined) data.medicalCheckedAt = new Date(dto.medicalCheckedAt);
      if (dto.medicalNotes !== undefined) data.medicalNotes = dto.medicalNotes;
      if (dto.technicalPassed !== undefined) data.technicalPassed = dto.technicalPassed;
      if (dto.mechanicName !== undefined) data.mechanicName = dto.mechanicName;
      if (dto.technicalCheckedAt !== undefined) data.technicalCheckedAt = new Date(dto.technicalCheckedAt);
      if (dto.technicalNotes !== undefined) data.technicalNotes = dto.technicalNotes;
      if (dto.startOdometer !== undefined) data.startOdometer = dto.startOdometer;
      if (dto.endOdometer !== undefined) data.endOdometer = dto.endOdometer;
      if (dto.departureTime !== undefined) data.departureTime = new Date(dto.departureTime);
      if (dto.returnTime !== undefined) data.returnTime = new Date(dto.returnTime);
      if (dto.fuelType !== undefined) data.fuelType = dto.fuelType;
      if (dto.fuelBefore !== undefined) data.fuelBefore = new Prisma.Decimal(dto.fuelBefore);
      if (dto.fuelGiven !== undefined) data.fuelGiven = new Prisma.Decimal(dto.fuelGiven);
      if (dto.fuelAfter !== undefined) data.fuelAfter = new Prisma.Decimal(dto.fuelAfter);
      if (dto.dispatcherName !== undefined) data.dispatcherName = dto.dispatcherName;
      if (dto.specialNotes !== undefined) data.specialNotes = dto.specialNotes;

      const startKm = dto.startOdometer ?? existing.startOdometer;
      const endKm = dto.endOdometer ?? existing.endOdometer;
      if (startKm !== null && endKm !== null && endKm >= startKm) {
        data.distanceKm = endKm - startKm;
      }

      const updated = await tx.waybill.update({
        where: { id_tenantId: { id, tenantId } },
        data,
      });

      await this.audit.record(tx, {
        tenantId,
        actorUserId: actor.userId,
        action: "waybill.updated",
        entityType: "Waybill",
        entityId: id,
        ip,
        metadata: { changes: Object.keys(dto) },
      });

      return updated;
    });
  }

  async close(
    tenantId: string,
    id: string,
    dto: CloseWaybillDto,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.waybill.findUnique({
        where: { id_tenantId: { id, tenantId } },
      });
      if (!existing) throw new NotFoundException("Yo'l varaqasi topilmadi");
      if (existing.status === WaybillStatus.COMPLETED) {
        throw new BadRequestException("Ushbu yo'l varaqasi allaqachon yakunlangan");
      }

      const returnTime = dto.returnTime ? new Date(dto.returnTime) : new Date();
      let distanceKm: number | null = null;
      if (existing.startOdometer !== null && dto.endOdometer >= existing.startOdometer) {
        distanceKm = dto.endOdometer - existing.startOdometer;
      }

      const updated = await tx.waybill.update({
        where: { id_tenantId: { id, tenantId } },
        data: {
          status: WaybillStatus.COMPLETED,
          returnTime,
          endOdometer: dto.endOdometer,
          distanceKm,
          fuelAfter: dto.fuelAfter !== undefined ? new Prisma.Decimal(dto.fuelAfter) : null,
          specialNotes: dto.specialNotes
            ? `${existing.specialNotes ?? ""}\n${dto.specialNotes}`.trim()
            : existing.specialNotes,
        },
      });

      await this.audit.record(tx, {
        tenantId,
        actorUserId: actor.userId,
        action: "waybill.closed",
        entityType: "Waybill",
        entityId: id,
        ip,
        metadata: { endOdometer: dto.endOdometer, distanceKm },
      });

      return updated;
    });
  }

  async cancel(
    tenantId: string,
    id: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.waybill.findUnique({
        where: { id_tenantId: { id, tenantId } },
      });
      if (!existing) throw new NotFoundException("Yo'l varaqasi topilmadi");

      const updated = await tx.waybill.update({
        where: { id_tenantId: { id, tenantId } },
        data: {
          status: WaybillStatus.CANCELLED,
          specialNotes: reason
            ? `${existing.specialNotes ?? ""}\n[BEKOR QILINDI]: ${reason}`.trim()
            : existing.specialNotes,
        },
      });

      await this.audit.record(tx, {
        tenantId,
        actorUserId: actor.userId,
        action: "waybill.cancelled",
        entityType: "Waybill",
        entityId: id,
        ip,
        metadata: { reason },
      });

      return updated;
    });
  }

  async getPublicWaybill(token: string) {
    const raw: any[] = await this.prisma.$queryRaw`
      SELECT * FROM app_get_public_waybill(${token})
    `;
    if (!raw || raw.length === 0) {
      return null;
    }
    return raw[0];
  }

  async generateQrBuffer(token: string, webOrigin: string): Promise<Buffer> {
    const url = `${webOrigin.replace(/\/$/, "")}/uz/verify/putyovka/${token}`;
    return QRCode.toBuffer(url, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 400,
      color: {
        dark: "#1e293b",
        light: "#ffffff",
      },
    });
  }

  async getDriverActiveWaybill(tenantId: string, driverId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const waybill = await tx.waybill.findFirst({
        where: {
          tenantId,
          driverId,
          status: { in: [WaybillStatus.ACTIVE, WaybillStatus.ISSUED] },
        },
        include: {
          vehicle: {
            include: {
              owner: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                },
              },
            },
          },
          route: true,
          company: true,
        },
        orderBy: { date: "desc" },
      });
      return waybill;
    });
  }
}
