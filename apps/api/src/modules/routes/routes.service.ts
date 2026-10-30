import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { money } from "../../common/money/money";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { currentPeriodStart } from "../drivers/billing";
import { CreateRouteDto, UpdateRouteDto } from "./dto/route.dto";

function serializeRoute<
  T extends { distanceKm: Prisma.Decimal; monthlyPlan: Prisma.Decimal },
>(route: T) {
  return {
    ...route,
    distanceKm: route.distanceKm.toFixed(2),
    monthlyPlan: route.monthlyPlan.toFixed(2),
  };
}

@Injectable()
export class RoutesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.route.findMany({
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        include: {
          _count: { select: { tariffs: true, vehicles: true } },
        },
      });
      return { items: items.map(serializeRoute) };
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateRouteDto, ip: string | null) {
    const distance = money(dto.distanceKm);
    if (distance.lte(0)) throw new BadRequestException("Masofa noldan katta bo'lishi kerak");
    const monthlyPlan = dto.monthlyPlan !== undefined ? money(dto.monthlyPlan) : money(0);

    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        const route = await tx.route.create({
          data: {
            tenantId: actor.tenantId,
            name: dto.name.trim(),
            origin: dto.origin.trim(),
            destination: dto.destination.trim(),
            distanceKm: distance,
            monthlyPlan,
          },
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "route.created",
          entityType: "Route",
          entityId: route.id,
          metadata: {
            name: route.name,
            distanceKm: route.distanceKm.toFixed(2),
            monthlyPlan: route.monthlyPlan.toFixed(2),
          },
          ip,
        });
        return serializeRoute(route);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu nomdagi yo'nalish allaqachon mavjud");
      }
      throw error;
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateRouteDto,
    ip: string | null,
  ) {
    const distance = dto.distanceKm !== undefined ? money(dto.distanceKm) : undefined;
    if (distance && distance.lte(0)) {
      throw new BadRequestException("Masofa noldan katta bo'lishi kerak");
    }
    const monthlyPlan =
      dto.monthlyPlan !== undefined ? money(dto.monthlyPlan) : undefined;

    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const existing = await tx.route.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException("Yo'nalish topilmadi");

      const route = await tx.route.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.origin !== undefined ? { origin: dto.origin.trim() } : {}),
          ...(dto.destination !== undefined ? { destination: dto.destination.trim() } : {}),
          ...(distance !== undefined ? { distanceKm: distance } : {}),
          ...(monthlyPlan !== undefined ? { monthlyPlan } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      let affectedPlans = 0;
      if (monthlyPlan !== undefined) {
        // Shaxsiy normasi yo'q avtomobillarning joriy oy plani yangi qiymatga moslanadi.
        const updated = await tx.vehicleMonthlyPlan.updateMany({
          where: {
            periodStart: currentPeriodStart(),
            vehicle: { routeId: id, monthlyFee: 0 },
          },
          data: { amount: monthlyPlan },
        });
        affectedPlans = updated.count;
      }

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "route.updated",
        entityType: "Route",
        entityId: id,
        metadata: {
          changes: dto as Prisma.InputJsonObject,
          ...(monthlyPlan !== undefined
            ? { previousMonthlyPlan: existing.monthlyPlan.toFixed(2), affectedPlans }
            : {}),
        },
        ip,
      });
      return { ...serializeRoute(route), affectedPlans };
    });
  }
}
