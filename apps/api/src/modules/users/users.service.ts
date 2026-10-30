import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateUserDto, UpdateUserDto } from "./dto/user.dto";
import type { AuthenticatedUser } from "../../common/auth/auth.types";

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const users = await tx.user.findMany({
        orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      return { items: users };
    });
  }

  /** Minimal owner list for contract/vehicle forms. */
  async owners(tenantId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => ({
      items: await tx.user.findMany({
        where: { isActive: true },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, role: true },
      }),
    }));
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateUserDto,
    ip: string | null,
  ) {
    if (dto.role === UserRole.OWNER && actor.role !== UserRole.OWNER) {
      throw new ForbiddenException("Faqat kompaniya egasi yangi egasi qo'sha oladi");
    }
    if (actor.role === UserRole.ADMIN && dto.role === UserRole.OWNER) {
      throw new ForbiddenException("Administrator egalik rolini bera olmaydi");
    }

    const passwordHash = await hash(dto.password, ARGON_OPTIONS);
    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
        const subscription = await tx.subscription.findFirst({
          where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
          include: { plan: true },
        });
        if (!subscription) {
          throw new ForbiddenException("Faol obuna topilmadi");
        }
        const activeUsers = await tx.user.count({ where: { isActive: true } });
        if (activeUsers >= subscription.plan.maxUsers) {
          throw new ForbiddenException(
            `Obuna rejasi ${subscription.plan.maxUsers} faol foydalanuvchi bilan cheklangan`,
          );
        }

        const user = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            email: dto.email,
            passwordHash,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            role: dto.role,
          },
          select: { id: true, email: true, fullName: true, role: true, isActive: true },
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "user.created",
          entityType: "User",
          entityId: user.id,
          metadata: { role: user.role, email: user.email },
          ip,
        });
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu email allaqachon kompaniyada mavjud");
      }
      throw error;
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
    ip: string | null,
  ) {
    if (id === actor.userId && dto.isActive === false) {
      throw new BadRequestException("O'zingizni faolsizlantira olmaysiz");
    }
    if (id === actor.userId && dto.role && dto.role !== actor.role) {
      throw new BadRequestException("O'z rolingizni o'zgartira olmaysiz");
    }

    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const target = await tx.user.findFirst({ where: { id } });
      if (!target) throw new NotFoundException("Foydalanuvchi topilmadi");
      if (target.role === UserRole.OWNER && actor.role !== UserRole.OWNER) {
        throw new ForbiddenException("Kompaniya egasini faqat egasi o'zgartira oladi");
      }
      if (dto.role === UserRole.OWNER && actor.role !== UserRole.OWNER) {
        throw new ForbiddenException("Egalik rolini berish mumkin emas");
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          isActive: true,
        },
      });

      if (dto.isActive === false) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "user.updated",
        entityType: "User",
        entityId: id,
        metadata: { changes: dto as Prisma.InputJsonObject },
        ip,
      });
      return user;
    });
  }
}
