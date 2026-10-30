import { Injectable } from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { TenantPrismaService, TenantTx } from "../../common/prisma/tenant-prisma.service";

export interface AuditInput {
  tenantId: string;
  actorUserId?: string | null;
  actorType?: "USER" | "SYSTEM" | "INTEGRATION";
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /** Must be called inside the same transaction as the audited mutation. */
  async record(tx: TenantTx, input: AuditInput): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorType ?? (input.actorUserId ? "USER" : "SYSTEM"),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata,
        ip: input.ip ?? null,
      },
    });
  }

  async list(
    tenantId: string,
    query: {
      page: number;
      pageSize: number;
      entityType?: string;
      action?: string;
    },
  ) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            actorUserId: true,
            actorType: true,
            action: true,
            entityType: true,
            entityId: true,
            metadata: true,
            ip: true,
            createdAt: true,
          },
        }),
        tx.auditLog.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }
}

export const AUDIT_READ_ROLES: UserRole[] = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
];
