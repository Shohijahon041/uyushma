import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { money } from "../../common/money/money";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { currentPeriodStart, effectiveMonthlyFee } from "../drivers/billing";
import { CreateVehicleDto, UpdateVehicleDto } from "./dto/vehicle.dto";

@Injectable()
export class VehiclesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, includeInactive: boolean) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.vehicle.findMany({
        where: includeInactive ? {} : { status: { not: "INACTIVE" } },
        orderBy: { plateNumber: "asc" },
        include: {
          owner: { select: { id: true, fullName: true } },
          route: { select: { id: true, name: true, monthlyPlan: true } },
          contracts: {
            where: { status: "ACTIVE" },
            select: { id: true, type: true, startDate: true },
          },
          externalVehicles: {
            take: 1,
            select: {
              provider: true,
              garageNumber: true,
              routeName: true,
              routeNumber: true,
              licenseNumber: true,
              licenseExpiresAt: true,
            },
          },
          assignments: {
            where: { endDate: null },
            take: 1,
            select: {
              id: true,
              startDate: true,
              driver: { select: { id: true, fullName: true, phone: true } },
            },
          },
        },
      });
      return { items };
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateVehicleDto, ip: string | null) {
    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        const owner = await tx.user.findFirst({
          where: { id: dto.ownerId, isActive: true },
        });
        if (!owner) throw new BadRequestException("Avtomobil egasi topilmadi");

        const subscription = await tx.subscription.findFirst({
          where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
          include: { plan: true },
        });
        if (!subscription) {
          throw new BadRequestException("Faol obuna topilmadi");
        }
        // Plan quota covers vehicles the company manages by hand; the provider
        // fleet (e-tender/autopark) is mirrored separately and must not block
        // onboarding of the company's own records.
        const activeVehicles = await tx.vehicle.count({
          where: { status: { not: "INACTIVE" }, externalVehicles: { none: {} } },
        });
        if (activeVehicles >= subscription.plan.maxVehicles) {
          throw new BadRequestException(
            `Obuna rejasi ${subscription.plan.maxVehicles} avtomobil bilan cheklangan`,
          );
        }

        const vehicle = await tx.vehicle.create({
          data: {
            tenantId: actor.tenantId,
            ownerId: dto.ownerId,
            plateNumber: dto.plateNumber,
            model: dto.model.trim(),
            capacity: dto.capacity,
            status: dto.status ?? "ACTIVE",
          },
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "vehicle.created",
          entityType: "Vehicle",
          entityId: vehicle.id,
          metadata: { plateNumber: vehicle.plateNumber, model: vehicle.model },
          ip,
        });
        return vehicle;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu davlat raqami kompaniyada allaqachon mavjud");
      }
      throw error;
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateVehicleDto,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const existing = await tx.vehicle.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException("Avtomobil topilmadi");

      const activeContracts = await tx.contract.count({
        where: { vehicleId: id, status: "ACTIVE" },
      });
      if (dto.status === "INACTIVE" && activeContracts > 0) {
        throw new BadRequestException(
          "Faol shartnomasi bor avtomobilni faolsizlantirib bo'lmaydi",
        );
      }

      const monthlyFee =
        dto.monthlyFee !== undefined ? money(dto.monthlyFee) : undefined;
      if (monthlyFee && monthlyFee.lt(0)) {
        throw new BadRequestException("Oylik summa manfiy bo'lishi mumkin emas");
      }

      if (dto.routeId) {
        const route = await tx.route.findFirst({ where: { id: dto.routeId } });
        if (!route) throw new BadRequestException("Yo'nalish topilmadi");
      }

      const vehicle = await tx.vehicle.update({
        where: { id },
        include: { route: { select: { monthlyPlan: true } } },
        data: {
          ...(dto.routeId !== undefined ? { routeId: dto.routeId } : {}),
          ...(dto.model !== undefined ? { model: dto.model.trim() } : {}),
          ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(monthlyFee !== undefined ? { monthlyFee } : {}),
        },
      });
      if (monthlyFee !== undefined || dto.routeId !== undefined) {
        // Joriy oy plani hali yopilmagan bo'lsa, yangi normaga moslanadi.
        await tx.vehicleMonthlyPlan.updateMany({
          where: { vehicleId: id, periodStart: currentPeriodStart() },
          data: { amount: effectiveMonthlyFee(vehicle) },
        });
      }
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "vehicle.updated",
        entityType: "Vehicle",
        entityId: id,
        metadata: {
          changes: dto as Prisma.InputJsonObject,
          reason: dto.reason ?? null,
        },
        ip,
      });
      return vehicle;
    });
  }
}
