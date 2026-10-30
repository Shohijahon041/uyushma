import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ContractStatus, ContractType, Prisma } from "@prisma/client";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { money } from "../../common/money/money";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { CreateContractDto, TerminateContractDto } from "./dto/contract.dto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException("Sana noto'g'ri");
  return date;
}

function serializeContract<
  T extends {
    monthlyRate: Prisma.Decimal | null;
    [key: string]: unknown;
  },
>(contract: T) {
  return {
    ...contract,
    monthlyRate: contract.monthlyRate ? contract.monthlyRate.toFixed(2) : null,
  };
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const items = await tx.contract.findMany({
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include: {
          vehicle: { select: { id: true, plateNumber: true, model: true } },
          owner: { select: { id: true, fullName: true } },
          tariff: { select: { id: true, name: true, scope: true } },
          _count: { select: { payments: true } },
        },
      });
      return { items: items.map(serializeContract) };
    });
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateContractDto,
    ip: string | null,
  ) {
    if (!UUID_RE.test(dto.vehicleId) || !UUID_RE.test(dto.ownerId)) {
      throw new BadRequestException("ID noto'g'ri");
    }
    const startDate = parseDate(dto.startDate);
    const endDate = dto.endDate ? parseDate(dto.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new BadRequestException("Tugash sanasi boshlanish sanasidan keyin bo'lishi kerak");
    }

    let monthlyRate: Prisma.Decimal | null = null;
    if (dto.monthlyRate !== undefined) {
      monthlyRate = money(dto.monthlyRate);
      if (monthlyRate.lt(0)) throw new BadRequestException("Oylik to'lov manfiy bo'lmaydi");
    }
    if ((dto.type === ContractType.LEASE || dto.type === ContractType.SERVICE) && !monthlyRate?.gt(0)) {
      throw new BadRequestException("Ijara/xizmat shartnomasi uchun oylik to'lov majburiy");
    }
    if (dto.type === ContractType.SELF_USE && monthlyRate?.gt(0)) {
      throw new BadRequestException("O'zida saqlash shartnomasida oylik to'lov bo'lmaydi");
    }

    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const vehicle = await tx.vehicle.findFirst({
        where: { id: dto.vehicleId, status: { not: "INACTIVE" } },
      });
      if (!vehicle) throw new BadRequestException("Avtomobil topilmadi");
      if (vehicle.ownerId !== dto.ownerId) {
        throw new BadRequestException(
          "Shartnoma egasi avtomobilning ro'yxatdagi egasi bilan mos kelmaydi",
        );
      }

      if (dto.tariffId) {
        const tariff = await tx.tariff.findFirst({
          where: { id: dto.tariffId, isActive: true },
        });
        if (!tariff) throw new BadRequestException("Faol tarif topilmadi");
      }

      const contract = await tx.contract.create({
        data: {
          tenantId: actor.tenantId,
          vehicleId: dto.vehicleId,
          ownerId: dto.ownerId,
          tariffId: dto.tariffId ?? null,
          createdById: actor.userId,
          type: dto.type,
          status: ContractStatus.DRAFT,
          startDate,
          endDate,
          monthlyRate,
          notes: dto.notes?.trim() || null,
        },
        include: {
          vehicle: { select: { id: true, plateNumber: true, model: true } },
          owner: { select: { id: true, fullName: true } },
          tariff: { select: { id: true, name: true, scope: true } },
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "contract.created",
        entityType: "Contract",
        entityId: contract.id,
        metadata: {
          type: contract.type,
          vehicleId: contract.vehicleId,
          ownerId: contract.ownerId,
          monthlyRate: monthlyRate?.toFixed(2) ?? null,
        },
        ip,
      });
      return serializeContract(contract);
    });
  }

  async activate(actor: AuthenticatedUser, id: string, ip: string | null) {
    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        const contract = await tx.contract.findFirst({
          where: { id },
          include: { vehicle: true, tariff: true },
        });
        if (!contract) throw new NotFoundException("Shartnoma topilmadi");
        if (contract.status === ContractStatus.ACTIVE) {
          throw new BadRequestException("Shartnoma allaqachon faol");
        }
        if (contract.status === ContractStatus.TERMINATED) {
          throw new BadRequestException("Bekor qilingan shartnomani faollashtirib bo'lmaydi");
        }
        if (contract.vehicle.status === "INACTIVE") {
          throw new BadRequestException("Avtomobil faol emas");
        }
        if (contract.tariff && !contract.tariff.isActive) {
          throw new BadRequestException("Shartnomadagi tarif faol emas");
        }
        if (contract.endDate && contract.endDate < new Date()) {
          throw new BadRequestException("Tugash sanasi o'tgan shartnoma faollashtirilmaydi");
        }

        const otherActive = await tx.contract.count({
          where: { vehicleId: contract.vehicleId, status: "ACTIVE", id: { not: id } },
        });
        if (otherActive > 0) {
          throw new ConflictException("Bu avtomobilda allaqachon faol shartnoma bor");
        }

        const updated = await tx.contract.update({
          where: { id },
          data: { status: ContractStatus.ACTIVE },
          include: {
            vehicle: { select: { id: true, plateNumber: true, model: true } },
            owner: { select: { id: true, fullName: true } },
            tariff: { select: { id: true, name: true, scope: true } },
          },
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "contract.activated",
          entityType: "Contract",
          entityId: id,
          metadata: { vehicleId: contract.vehicleId },
          ip,
        });
        return serializeContract(updated);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu avtomobilda allaqachon faol shartnoma bor");
      }
      throw error;
    }
  }

  async terminate(
    actor: AuthenticatedUser,
    id: string,
    dto: TerminateContractDto,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const contract = await tx.contract.findFirst({ where: { id } });
      if (!contract) throw new NotFoundException("Shartnoma topilmadi");
      if (contract.status === ContractStatus.TERMINATED) {
        throw new BadRequestException("Shartnoma allaqachon bekor qilingan");
      }
      const endDate = dto.endDate ? parseDate(dto.endDate) : parseDate(
        new Date().toISOString().slice(0, 10),
      );
      if (endDate < contract.startDate) {
        throw new BadRequestException("Tugash sanasi boshlanish sanasidan oldin bo'lmaydi");
      }

      const updated = await tx.contract.update({
        where: { id },
        data: {
          status: ContractStatus.TERMINATED,
          endDate,
          notes: dto.reason ? `${contract.notes ?? ""}\n[bekor: ${dto.reason}]`.trim() : contract.notes,
        },
        include: {
          vehicle: { select: { id: true, plateNumber: true, model: true } },
          owner: { select: { id: true, fullName: true } },
          tariff: { select: { id: true, name: true, scope: true } },
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "contract.terminated",
        entityType: "Contract",
        entityId: id,
        metadata: {
          endDate: endDate.toISOString().slice(0, 10),
          reason: dto.reason ?? null,
        },
        ip,
      });
      return serializeContract(updated);
    });
  }
}
