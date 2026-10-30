import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TariffRuleOperation, TariffScope } from "@prisma/client";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { money } from "../../common/money/money";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { calculateTariff } from "./tariff.engine";
import { CalculateTariffDto, CreateTariffDto } from "./dto/tariff.dto";

function serializeTariff<
  T extends {
    baseAmount: Prisma.Decimal;
    pricePerKm: Prisma.Decimal;
    rules?: Array<{
      amount: Prisma.Decimal;
      [key: string]: unknown;
    }>;
    route?: { distanceKm: Prisma.Decimal; [key: string]: unknown } | null;
    [key: string]: unknown;
  },
>(tariff: T) {
  return {
    ...tariff,
    baseAmount: tariff.baseAmount.toFixed(2),
    pricePerKm: tariff.pricePerKm.toFixed(2),
    ...(tariff.rules
      ? {
          rules: tariff.rules.map((rule) => ({
            ...rule,
            amount: rule.amount.toFixed(2),
          })),
        }
      : {}),
    ...(tariff.route
      ? {
          route: {
            ...tariff.route,
            distanceKm: tariff.route.distanceKm.toFixed(2),
          },
        }
      : {}),
  };
}

@Injectable()
export class TariffsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.tariff.findMany({
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        include: {
          rules: { orderBy: [{ priority: "asc" }, { code: "asc" }] },
          route: true,
        },
      });
      return { items: items.map(serializeTariff) };
    });
  }

  async create(actor: AuthenticatedUser, dto: CreateTariffDto, ip: string | null) {
    const baseAmount = money(dto.baseAmount);
    const pricePerKm = money(dto.pricePerKm);
    if (baseAmount.lt(0) || pricePerKm.lt(0)) {
      throw new BadRequestException("Tarif summalari manfiy bo'lishi mumkin emas");
    }
    if (dto.scope === TariffScope.ROUTE && !dto.routeId) {
      throw new BadRequestException("Yo'nalish tarifi uchun routeId majburiy");
    }
    if (dto.scope !== TariffScope.ROUTE && dto.routeId) {
      throw new BadRequestException("Standart/individual tarifga routeId berilmaydi");
    }
    const rules = dto.rules ?? [];
    if (new Set(rules.map((rule) => rule.code)).size !== rules.length) {
      throw new BadRequestException("Tarif qoidalari kodlari takrorlanmasligi kerak");
    }

    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        if (dto.routeId) {
          const route = await tx.route.findFirst({
            where: { id: dto.routeId, isActive: true },
          });
          if (!route) throw new BadRequestException("Faol yo'nalish topilmadi");
        }

        const tariff = await tx.tariff.create({
          data: {
            tenantId: actor.tenantId,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            scope: dto.scope,
            routeId: dto.routeId ?? null,
            baseAmount,
            pricePerKm,
            createdById: actor.userId,
            rules: {
              create: rules.map((rule) => ({
                tenantId: actor.tenantId,
                code: rule.code,
                label: rule.label.trim(),
                operation: rule.operation,
                amount: money(rule.amount),
                priority: rule.priority,
              })),
            },
          },
          include: { rules: true, route: true },
        });

        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "tariff.created",
          entityType: "Tariff",
          entityId: tariff.id,
          metadata: {
            name: tariff.name,
            scope: tariff.scope,
            ruleCount: rules.length,
          },
          ip,
        });
        return serializeTariff(tariff);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu nomdagi tarif allaqachon mavjud");
      }
      throw error;
    }
  }

  async setActive(
    actor: AuthenticatedUser,
    id: string,
    isActive: boolean,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const existing = await tx.tariff.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException("Tarif topilmadi");
      const tariff = await tx.tariff.update({
        where: { id },
        data: { isActive },
        include: { rules: true, route: true },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "tariff.status_changed",
        entityType: "Tariff",
        entityId: id,
        metadata: { isActive },
        ip,
      });
      return serializeTariff(tariff);
    });
  }

  async calculate(
    tenantId: string,
    tariffId: string,
    dto: CalculateTariffDto,
  ) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const tariff = await tx.tariff.findFirst({
        where: { id: tariffId, isActive: true },
        include: {
          rules: { orderBy: [{ priority: "asc" }, { code: "asc" }] },
          route: true,
        },
      });
      if (!tariff) throw new NotFoundException("Faol tarif topilmadi");

      const distance =
        dto.distanceKm !== undefined
          ? money(dto.distanceKm)
          : tariff.route?.distanceKm ?? money(0);

      const result = calculateTariff({
        baseAmount: tariff.baseAmount,
        pricePerKm: tariff.pricePerKm,
        distanceKm: distance,
        rules: tariff.rules.map((rule) => ({
          code: rule.code,
          label: rule.label,
          operation: rule.operation as TariffRuleOperation,
          amount: rule.amount,
          priority: rule.priority,
        })),
      });

      return {
        tariffId: tariff.id,
        tariffName: tariff.name,
        ...result,
      };
    });
  }
}
