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
import { generatePassword } from "../platform/platform.service";
import { CreateUserDto, ResetUserPasswordDto, UpdateUserDto } from "./dto/user.dto";
import type { AuthenticatedUser } from "../../common/auth/auth.types";

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };
const PHONE_TAKEN = "Bu telefon raqam allaqachon ro'yxatdan o'tgan";

const USER_VIEW = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
} as const;

function isPhoneConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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
          ...USER_VIEW,
          twoFactorEnabled: true,
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

    const password = dto.password ?? generatePassword();
    const passwordHash = await hash(password, ARGON_OPTIONS);
    try {
      const user = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
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

        const created = await tx.user.create({
          data: {
            tenantId: actor.tenantId,
            phone: dto.phone,
            passwordHash,
            fullName: dto.fullName.trim(),
            role: dto.role,
          },
          select: USER_VIEW,
        });
        await this.audit.record(tx, {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "user.created",
          entityType: "User",
          entityId: created.id,
          metadata: { role: created.role, phone: created.phone },
          ip,
        });
        return created;
      });
      return { user, password };
    } catch (error) {
      if (isPhoneConflict(error)) throw new ConflictException(PHONE_TAKEN);
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

    try {
      return await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
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
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            ...(dto.role !== undefined ? { role: dto.role } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
          select: USER_VIEW,
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
          metadata: { changes: { ...dto } as Prisma.InputJsonObject },
          ip,
        });
        return user;
      });
    } catch (error) {
      if (isPhoneConflict(error)) throw new ConflictException(PHONE_TAKEN);
      throw error;
    }
  }

  /** Parolni unutgan xodimga yangi parol beriladi; uning barcha sessiyalari yopiladi. */
  async resetPassword(
    actor: AuthenticatedUser,
    id: string,
    dto: ResetUserPasswordDto,
    ip: string | null,
  ) {
    if (id === actor.userId) {
      throw new BadRequestException("O'z parolingizni sozlamalar bo'limida o'zgartiring");
    }
    const password = dto.password ?? generatePassword();
    const passwordHash = await hash(password, ARGON_OPTIONS);
    const user = await this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const target = await tx.user.findFirst({ where: { id } });
      if (!target) throw new NotFoundException("Foydalanuvchi topilmadi");
      if (target.role === UserRole.OWNER && actor.role !== UserRole.OWNER) {
        throw new ForbiddenException("Kompaniya egasining parolini faqat egasi tiklay oladi");
      }
      const updated = await tx.user.update({
        where: { id },
        data: { passwordHash },
        select: USER_VIEW,
      });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "user.password_reset",
        entityType: "User",
        entityId: id,
        ip,
      });
      return updated;
    });
    return { user, password };
  }
}
