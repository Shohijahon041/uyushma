import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { PrismaService } from "../../common/prisma/prisma.service";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService, type AuditInput } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import type {
  CreateLicenseContractDto,
  PlatformCreateCompanyDto,
  PlatformCreateUserDto,
  PlatformResetPasswordDto,
  PlatformSetSubscriptionDto,
  PlatformUpdateCompanyDto,
  PlatformUpdateUserDto,
  RecordSubscriptionPaymentDto,
} from "./dto/platform.dto";

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

const LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** Vaqtinchalik parol: 14 belgi, kamida bitta harf va raqam. */
export function generatePassword(length = 14): string {
  const alphabet = LETTERS + DIGITS;
  const chars = [LETTERS[randomInt(LETTERS.length)], DIGITS[randomInt(DIGITS.length)]];
  while (chars.length < length) chars.push(alphabet[randomInt(alphabet.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/['`ʻʼ’‘]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "korxona";
}

function dateOnly(value: string | Date): Date {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date;
  user_count: number;
  vehicle_count: number;
  driver_count: number;
  payment_count: number;
  collected_total: Prisma.Decimal;
  plan_id: string | null;
  subscription_status: string | null;
  period_end: Date | null;
  monthly_fee: Prisma.Decimal | null;
  has_contract: boolean | null;
  unpaid_count: number | null;
  unpaid_total: Prisma.Decimal | null;
  last_sync_at: Date | null;
}

interface UserRow {
  id: string;
  tenant_id: string;
  company_name: string;
  company_slug: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  is_super_admin: boolean;
  two_factor_enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

interface LicenseRow {
  id: string;
  tenant_id: string;
  company_name: string;
  number: string;
  plan_id: string;
  amount: Prisma.Decimal;
  currency: string;
  signed_at: Date;
  note: string | null;
  created_at: Date;
}

const USER_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  isSuperAdmin: true,
  twoFactorEnabled: true,
} as const;

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Super admin boshqa korxona tenantida ishlaganda audit FK (actor, tenant)
   * ruxsat bermaydi, shuning uchun yozuv PLATFORM sifatida, admin metadata'da saqlanadi.
   */
  private recordAudit(tx: Prisma.TransactionClient, actor: AuthenticatedUser, input: AuditInput) {
    if (input.tenantId === actor.tenantId) return this.audit.record(tx, input);
    const metadata =
      input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? (input.metadata as Prisma.InputJsonObject)
        : {};
    return this.audit.record(tx, {
      ...input,
      actorUserId: null,
      actorType: "PLATFORM",
      metadata: { ...metadata, platformAdmin: { id: actor.userId, phone: actor.phone } },
    });
  }

  private assertSuperAdmin(actor: AuthenticatedUser): void {
    if (!actor.isSuperAdmin) {
      throw new ForbiddenException("Bu bo'lim faqat super admin uchun");
    }
  }

  /** Platforma boshqaruv tenantini mijoz korxona sifatida o'zgartirib bo'lmaydi. */
  private async clientCompany(tx: Prisma.TransactionClient, companyId: string) {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company || company.isPlatform) throw new NotFoundException("Kompaniya topilmadi");
    return company;
  }

  private async freeSlug(base: string): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
      const taken = await this.prisma.$queryRaw<Array<{ taken: boolean }>>`
        SELECT app_company_slug_taken(${candidate}) AS taken
      `;
      if (!taken[0]?.taken) return candidate;
    }
    throw new ConflictException("Kompaniya kodi band, boshqa kod kiriting");
  }

  async overview(actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    const rows = await this.prisma.$queryRaw<CompanyRow[]>`
      SELECT * FROM app_platform_companies()
    `;
    const companies = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      createdAt: row.created_at,
      users: Number(row.user_count),
      vehicles: Number(row.vehicle_count),
      drivers: Number(row.driver_count),
      payments: Number(row.payment_count),
      collected: Number(row.collected_total ?? 0).toFixed(2),
      planId: row.plan_id,
      subscriptionStatus: row.subscription_status,
      periodEnd: row.period_end,
      monthlyFee: row.monthly_fee === null ? null : Number(row.monthly_fee).toFixed(2),
      hasContract: Boolean(row.has_contract),
      unpaidCount: Number(row.unpaid_count ?? 0),
      unpaidTotal: Number(row.unpaid_total ?? 0).toFixed(2),
      lastSyncAt: row.last_sync_at,
    }));

    return {
      companies,
      totals: {
        companies: companies.length,
        active: companies.filter((company) => company.status === "ACTIVE").length,
        suspended: companies.filter((company) => company.status === "SUSPENDED").length,
        contracts: companies.filter((company) => company.hasContract).length,
        monthlyRevenue: companies
          .filter((company) => company.hasContract)
          .reduce((total, company) => total + Number(company.monthlyFee ?? 0), 0)
          .toFixed(2),
        unpaid: companies
          .reduce((total, company) => total + Number(company.unpaidTotal), 0)
          .toFixed(2),
        users: companies.reduce((total, company) => total + company.users, 0),
        vehicles: companies.reduce((total, company) => total + company.vehicles, 0),
        drivers: companies.reduce((total, company) => total + company.drivers, 0),
        payments: companies.reduce((total, company) => total + company.payments, 0),
        collected: companies
          .reduce((total, company) => total + Number(company.collected), 0)
          .toFixed(2),
      },
    };
  }

  async setCompanyStatus(
    actor: AuthenticatedUser,
    companyId: string,
    status: string,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    if (status !== "ACTIVE" && status !== "SUSPENDED") {
      throw new BadRequestException("Holat faqat ACTIVE yoki SUSPENDED bo'ladi");
    }
    if (companyId === actor.tenantId && status === "SUSPENDED") {
      throw new BadRequestException("O'z kompaniyangizni to'xtatib bo'lmaydi");
    }
    const rows = await this.prisma.$queryRaw<Array<{ updated: boolean }>>`
      SELECT app_set_company_status(${companyId}::uuid, ${status}) AS updated
    `;
    if (!rows[0]?.updated) throw new NotFoundException("Kompaniya topilmadi");

    await this.tenantPrisma.withTenant(companyId, async (tx) => {
      await this.recordAudit(tx, actor, {
        tenantId: companyId,
        actorUserId: actor.userId,
        action: "platform.company_status_changed",
        entityType: "Company",
        entityId: companyId,
        metadata: { status },
        ip,
      });
    });
    return { updated: true, companyId, status };
  }

  // -------------------------------------------------------------------------
  // Foydalanuvchilar
  // -------------------------------------------------------------------------

  async users(actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    const rows = await this.prisma.$queryRaw<UserRow[]>`
      SELECT u.id, u."tenantId" AS tenant_id, c.name AS company_name, c.slug AS company_slug,
             u."fullName" AS full_name, u.phone, u.role::text, u."isActive" AS is_active,
             u."isSuperAdmin" AS is_super_admin, u."twoFactorEnabled" AS two_factor_enabled,
             u."lastLoginAt" AS last_login_at, u."createdAt" AS created_at
      FROM "User" u
      JOIN "Company" c ON c.id = u."tenantId"
      ORDER BY c.name, u."fullName"
    `;
    return {
      items: rows.map((row) => ({
        id: row.id,
        companyId: row.tenant_id,
        companyName: row.company_name,
        companySlug: row.company_slug,
        fullName: row.full_name,
        phone: row.phone,
        role: row.role,
        isActive: row.is_active,
        isSuperAdmin: row.is_super_admin ?? false,
        twoFactorEnabled: row.two_factor_enabled,
        lastLoginAt: row.last_login_at,
        createdAt: row.created_at,
      })),
    };
  }

  async createCompany(actor: AuthenticatedUser, dto: PlatformCreateCompanyDto, ip: string | null) {
    this.assertSuperAdmin(actor);
    let slug: string;
    if (dto.companySlug) {
      slug = dto.companySlug;
      const taken = await this.prisma.$queryRaw<Array<{ taken: boolean }>>`
        SELECT app_company_slug_taken(${slug}) AS taken
      `;
      if (taken[0]?.taken) throw new ConflictException("Bu kompaniya kodi band");
    } else {
      slug = await this.freeSlug(slugify(dto.companyName));
    }

    const password = dto.password ?? generatePassword();
    const passwordHash = await hash(password, ARGON_OPTIONS);
    const tenantId = randomUUID();
    const planId = dto.planId ?? "START";
    const today = dateOnly(new Date());

    try {
      const result = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        const plan = await tx.plan.findUnique({ where: { id: planId } });
        if (!plan || !plan.isActive) throw new BadRequestException("Tarif rejasi topilmadi");

        const company = await tx.company.create({
          data: { id: tenantId, slug, name: dto.companyName.trim() },
        });
        const owner = await tx.user.create({
          data: {
            tenantId,
            passwordHash,
            fullName: dto.ownerFullName.trim(),
            phone: dto.ownerPhone,
            role: UserRole.OWNER,
          },
          select: USER_SELECT,
        });
        await tx.subscription.create({
          data: {
            tenantId,
            planId: plan.id,
            status: "TRIAL",
            startDate: today,
            currentPeriodEnd: addDays(today, 14),
          },
        });
        await this.recordAudit(tx, actor, {
          tenantId,
          actorUserId: actor.userId,
          action: "platform.company_created",
          entityType: "Company",
          entityId: tenantId,
          metadata: { slug, plan: plan.id, ownerPhone: owner.phone },
          ip,
        });
        return { company: { id: company.id, name: company.name, slug: company.slug }, owner };
      });
      return { ...result, password };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu telefon raqam yoki kompaniya kodi allaqachon band");
      }
      throw error;
    }
  }

  async createUser(
    actor: AuthenticatedUser,
    companyId: string,
    dto: PlatformCreateUserDto,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    const password = dto.password ?? generatePassword();
    const passwordHash = await hash(password, ARGON_OPTIONS);
    try {
      const user = await this.tenantPrisma.withTenant(companyId, async (tx) => {
        const company = await this.clientCompany(tx, companyId);
        const created = await tx.user.create({
          data: {
            tenantId: companyId,
            passwordHash,
            fullName: dto.fullName.trim(),
            phone: dto.phone,
            role: dto.role,
          },
          select: USER_SELECT,
        });
        await this.recordAudit(tx, actor, {
          tenantId: companyId,
          actorUserId: actor.userId,
          action: "platform.user_created",
          entityType: "User",
          entityId: created.id,
          metadata: { role: created.role, phone: created.phone },
          ip,
        });
        return { ...created, companySlug: company.slug };
      });
      return { user, password };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu telefon raqam allaqachon ro'yxatdan o'tgan");
      }
      throw error;
    }
  }

  async updateUser(
    actor: AuthenticatedUser,
    companyId: string,
    userId: string,
    dto: PlatformUpdateUserDto,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    if (userId === actor.userId && dto.isActive === false) {
      throw new BadRequestException("O'zingizni bloklay olmaysiz");
    }
    if (userId === actor.userId && dto.role && dto.role !== actor.role) {
      throw new BadRequestException("O'z rolingizni o'zgartira olmaysiz");
    }
    if (userId === actor.userId && dto.isSuperAdmin === false) {
      throw new BadRequestException("O'zingizdan super admin huquqini olib tashlay olmaysiz");
    }
    try {
      return await this.tenantPrisma.withTenant(companyId, async (tx) => {
        await this.clientCompany(tx, companyId);
        const target = await tx.user.findFirst({ where: { id: userId } });
        if (!target) throw new NotFoundException("Foydalanuvchi topilmadi");

        if (dto.isSuperAdmin === false && target.isSuperAdmin) {
          const count = await tx.user.count({ where: { isSuperAdmin: true, isActive: true } });
          if (count <= 1) {
            throw new BadRequestException("Tizimda kamida bitta faol super admin qolishi shart");
          }
        }

        const user = await tx.user.update({
          where: { id: userId },
          data: {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
            ...(dto.role !== undefined ? { role: dto.role } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.isSuperAdmin !== undefined ? { isSuperAdmin: dto.isSuperAdmin } : {}),
          },
          select: USER_SELECT,
        });
        if (dto.isActive === false) {
          await tx.refreshToken.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        await this.recordAudit(tx, actor, {
          tenantId: companyId,
          actorUserId: actor.userId,
          action: "platform.user_updated",
          entityType: "User",
          entityId: userId,
          metadata: { changes: { ...dto } as Prisma.InputJsonObject },
          ip,
        });
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu telefon raqam allaqachon ro'yxatdan o'tgan");
      }
      throw error;
    }
  }

  async resetPassword(
    actor: AuthenticatedUser,
    companyId: string,
    userId: string,
    dto: PlatformResetPasswordDto,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    const password = dto.password ?? generatePassword();
    const passwordHash = await hash(password, ARGON_OPTIONS);
    const user = await this.tenantPrisma.withTenant(companyId, async (tx) => {
      await this.clientCompany(tx, companyId);
      const target = await tx.user.findFirst({ where: { id: userId } });
      if (!target) throw new NotFoundException("Foydalanuvchi topilmadi");
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          ...(dto.disableTwoFactor
            ? {
                twoFactorEnabled: false,
                twoFactorSecret: null,
                twoFactorRecoveryCodes: Prisma.DbNull,
              }
            : {}),
        },
        select: USER_SELECT,
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.recordAudit(tx, actor, {
        tenantId: companyId,
        actorUserId: actor.userId,
        action: "platform.user_password_reset",
        entityType: "User",
        entityId: userId,
        metadata: { disableTwoFactor: Boolean(dto.disableTwoFactor) },
        ip,
      });
      return updated;
    });
    return { user, password };
  }

  // -------------------------------------------------------------------------
  // Oylik to'lov asosidagi shartnomalar
  // -------------------------------------------------------------------------

  async listLicenses(actor: AuthenticatedUser) {
    this.assertSuperAdmin(actor);
    const rows = await this.prisma.$queryRaw<LicenseRow[]>`
      SELECT * FROM app_platform_license_contracts()
    `;
    return {
      items: rows.map((row) => ({
        id: row.id,
        companyId: row.tenant_id,
        companyName: row.company_name,
        number: row.number,
        planId: row.plan_id,
        amount: Number(row.amount).toFixed(2),
        currency: row.currency,
        signedAt: row.signed_at,
        note: row.note,
        createdAt: row.created_at,
      })),
    };
  }

  async createLicense(
    actor: AuthenticatedUser,
    companyId: string,
    dto: CreateLicenseContractDto,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    const number =
      dto.number ||
      `LIC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(2)
        .toString("hex")
        .toUpperCase()}`;
    try {
      return await this.tenantPrisma.withTenant(companyId, async (tx) => {
        await this.clientCompany(tx, companyId);
        const plan = await tx.plan.findUnique({ where: { id: dto.planId } });
        if (!plan) throw new BadRequestException("Tarif rejasi topilmadi");

        const contract = await tx.licenseContract.create({
          data: {
            tenantId: companyId,
            number,
            planId: plan.id,
            amount: new Prisma.Decimal(dto.amount),
            signedAt: dateOnly(dto.signedAt),
            note: dto.note || null,
            createdById: actor.userId,
          },
        });
        await this.applyContract(tx, companyId, plan.id, contract.amount);
        await this.recordAudit(tx, actor, {
          tenantId: companyId,
          actorUserId: actor.userId,
          action: "platform.license_created",
          entityType: "LicenseContract",
          entityId: contract.id,
          metadata: { number, plan: plan.id, monthlyFee: dto.amount },
          ip,
        });
        return { ...contract, amount: contract.amount.toFixed(2) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Bu shartnoma raqami band");
      }
      throw error;
    }
  }

  /** Shartnoma oylik summasi obunaga yoziladi; sinov muddati tugagach oylik hisob boshlanadi. */
  private async applyContract(
    tx: Prisma.TransactionClient,
    tenantId: string,
    planId: string,
    monthlyFee: Prisma.Decimal,
  ): Promise<void> {
    const subscription = await tx.subscription.findFirst({
      where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
      orderBy: { createdAt: "desc" },
    });
    if (subscription) {
      const trialRunning =
        subscription.status === "TRIAL" &&
        subscription.currentPeriodEnd !== null &&
        subscription.currentPeriodEnd >= dateOnly(new Date());
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          planId,
          monthlyFee,
          status: trialRunning ? "TRIAL" : subscription.status === "PAST_DUE" ? "PAST_DUE" : "ACTIVE",
          cancelAtPeriodEnd: false,
        },
      });
    } else {
      await tx.subscription.create({
        data: { tenantId, planId, monthlyFee, status: "ACTIVE", startDate: dateOnly(new Date()) },
      });
    }
  }

  /**
   * Oylik to'lovni qayd etadi: avval eng eski to'lanmagan hisoblar yopiladi,
   * qolgan oylar keyingi davrlar uchun oldindan to'langan hisob sifatida yoziladi.
   */
  async recordSubscriptionPayment(
    actor: AuthenticatedUser,
    companyId: string,
    dto: RecordSubscriptionPaymentDto,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    return this.tenantPrisma.withTenant(companyId, async (tx) => {
      await this.clientCompany(tx, companyId);
      const subscription = await tx.subscription.findFirst({
        where: { status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      });
      if (!subscription) throw new NotFoundException("Kompaniyada faol obuna topilmadi");
      const fee = subscription.monthlyFee ?? subscription.plan.monthlyPrice;

      const paid: Array<{ number: string; periodStart: Date; periodEnd: Date; amount: Prisma.Decimal }> = [];
      const unpaid = await tx.subscriptionInvoice.findMany({
        where: { subscriptionId: subscription.id, status: { in: ["OPEN", "OVERDUE"] } },
        orderBy: { periodStart: "asc" },
        take: dto.months,
      });
      for (const invoice of unpaid) {
        await tx.subscriptionInvoice.update({
          where: { id: invoice.id },
          data: { status: "PAID", paidAt },
        });
        paid.push(invoice);
      }

      const latest = await tx.subscriptionInvoice.findFirst({
        where: { subscriptionId: subscription.id },
        orderBy: { periodStart: "desc" },
      });
      const today = dateOnly(new Date());
      const coveredFrom =
        subscription.status === "TRIAL" && subscription.currentPeriodEnd && subscription.currentPeriodEnd >= today
          ? addDays(subscription.currentPeriodEnd, 1)
          : today;
      let start = monthStart(coveredFrom);
      if (latest && latest.periodEnd >= start) start = addDays(latest.periodEnd, 1);

      for (let i = paid.length; i < dto.months; i += 1) {
        const periodEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
        const invoice = await tx.subscriptionInvoice.create({
          data: {
            tenantId: companyId,
            subscriptionId: subscription.id,
            number: `SAAS-${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, "0")}-${companyId.slice(0, 8).toUpperCase()}`,
            periodStart: start,
            periodEnd,
            amount: fee,
            dueDate: start,
            status: "PAID",
            paidAt,
          },
        });
        paid.push(invoice);
        start = addDays(periodEnd, 1);
      }

      const lastPaid = await tx.subscriptionInvoice.findFirst({
        where: { subscriptionId: subscription.id, status: "PAID" },
        orderBy: { periodEnd: "desc" },
      });
      const stillUnpaid = await tx.subscriptionInvoice.count({
        where: { subscriptionId: subscription.id, status: { in: ["OPEN", "OVERDUE"] } },
      });
      let paidUntil = lastPaid?.periodEnd ?? subscription.currentPeriodEnd;
      if (subscription.currentPeriodEnd && paidUntil && subscription.currentPeriodEnd > paidUntil) {
        paidUntil = subscription.currentPeriodEnd;
      }
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: stillUnpaid > 0 ? "PAST_DUE" : "ACTIVE", currentPeriodEnd: paidUntil },
      });

      const total = paid.reduce((sum, invoice) => sum.add(invoice.amount), new Prisma.Decimal(0));
      await this.recordAudit(tx, actor, {
        tenantId: companyId,
        actorUserId: actor.userId,
        action: "platform.subscription_payment",
        entityType: "Subscription",
        entityId: subscription.id,
        metadata: {
          months: dto.months,
          invoices: paid.map((invoice) => invoice.number),
          total: total.toFixed(2),
          method: dto.paymentMethod ?? null,
          note: dto.note ?? null,
        },
        ip,
      });

      return {
        paidUntil,
        total: total.toFixed(2),
        invoices: paid.map((invoice) => ({
          number: invoice.number,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          amount: invoice.amount.toFixed(2),
        })),
      };
    });
  }

  async updateCompany(
    actor: AuthenticatedUser,
    companyId: string,
    dto: PlatformUpdateCompanyDto,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    return this.prisma.$transaction(async (tx) => {
      const company = await this.clientCompany(tx, companyId);

      const updateData: Prisma.CompanyUpdateInput = {};
      if (dto.name !== undefined) updateData.name = dto.name.trim();
      if (dto.slug !== undefined && dto.slug !== company.slug) {
        const slug = slugify(dto.slug);
        const existing = await tx.company.findFirst({ where: { slug, NOT: { id: companyId } } });
        if (existing) throw new ConflictException("Ushbu identifikator band");
        updateData.slug = slug;
      }
      if (dto.paymentCardNumber !== undefined) updateData.paymentCardNumber = dto.paymentCardNumber;
      if (dto.paymentCardHolder !== undefined) updateData.paymentCardHolder = dto.paymentCardHolder;
      if (dto.paymentCardBank !== undefined) updateData.paymentCardBank = dto.paymentCardBank;
      if (dto.paymentInstructions !== undefined) updateData.paymentInstructions = dto.paymentInstructions;

      const updated = await tx.company.update({
        where: { id: companyId },
        data: updateData,
      });

      await this.recordAudit(tx, actor, {
        tenantId: companyId,
        actorUserId: actor.userId,
        action: "platform.update_company",
        entityType: "Company",
        entityId: companyId,
        metadata: { old: { name: company.name, slug: company.slug }, updated: { ...dto } as Prisma.InputJsonObject },
        ip,
      });

      return updated;
    });
  }

  async deleteCompany(
    actor: AuthenticatedUser,
    companyId: string,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    if (companyId === actor.tenantId) {
      throw new BadRequestException("Super admin o'zining boshqaruv platforma korxonasini o'chira olmaydi");
    }

    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({
        where: { id: companyId },
      });
      if (!company || company.isPlatform) {
        throw new NotFoundException("Kompaniya topilmadi yoki uni o'chirish mumkin emas");
      }

      // 1. Tashqi integratsiya va keshlar
      await tx.externalSyncRun.deleteMany({ where: { tenantId: companyId } });
      await tx.externalRecord.deleteMany({ where: { tenantId: companyId } });
      await tx.externalVehicle.deleteMany({ where: { tenantId: companyId } });
      await tx.externalConnection.deleteMany({ where: { tenantId: companyId } });

      // 2. Haydovchilar va avtopark
      await tx.paymentSubmission.deleteMany({ where: { tenantId: companyId } });
      await tx.driverPayment.deleteMany({ where: { tenantId: companyId } });
      await tx.vehicleMonthlyPlan.deleteMany({ where: { tenantId: companyId } });
      await tx.vehicleAssignment.deleteMany({ where: { tenantId: companyId } });
      await tx.driver.deleteMany({ where: { tenantId: companyId } });

      // 3. To'lovlar, shartnomalar, tariflar
      await tx.paymentRefund.deleteMany({ where: { tenantId: companyId } });
      await tx.paymentReconciliation.deleteMany({ where: { tenantId: companyId } });
      await tx.paymentProviderTransaction.deleteMany({ where: { tenantId: companyId } });
      await tx.paymentProviderAccount.deleteMany({ where: { tenantId: companyId } });
      await tx.paymentWebhookEvent.deleteMany({ where: { tenantId: companyId } });
      await tx.payment.deleteMany({ where: { tenantId: companyId } });
      await tx.contract.deleteMany({ where: { tenantId: companyId } });
      await tx.tariffRule.deleteMany({ where: { tenantId: companyId } });
      await tx.tariff.deleteMany({ where: { tenantId: companyId } });
      await tx.vehicle.deleteMany({ where: { tenantId: companyId } });
      await tx.route.deleteMany({ where: { tenantId: companyId } });

      // 4. Obuna va litsenziyalar
      await tx.subscriptionInvoice.deleteMany({ where: { tenantId: companyId } });
      await tx.licenseContract.deleteMany({ where: { tenantId: companyId } });
      await tx.subscription.deleteMany({ where: { tenantId: companyId } });

      // 5. Aloqa, hujjatlar va audit loglar
      await tx.telegramLinkToken.deleteMany({ where: { tenantId: companyId } });
      await tx.telegramAccount.deleteMany({ where: { tenantId: companyId } });
      await tx.document.deleteMany({ where: { tenantId: companyId } });
      await tx.notificationLog.deleteMany({ where: { tenantId: companyId } });
      await tx.auditLog.deleteMany({ where: { tenantId: companyId } });

      // 6. Foydalanuvchilar va seanslar
      await tx.refreshToken.deleteMany({ where: { tenantId: companyId } });
      await tx.passwordResetToken.deleteMany({ where: { tenantId: companyId } });
      await tx.emailVerificationToken.deleteMany({ where: { tenantId: companyId } });
      await tx.user.deleteMany({ where: { tenantId: companyId } });

      // 7. Kompaniyani o'chirish
      await tx.company.delete({ where: { id: companyId } });

      await this.recordAudit(tx, actor, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "platform.delete_company",
        entityType: "Company",
        entityId: companyId,
        metadata: {
          name: company.name,
          slug: company.slug,
        },
        ip,
      });

      return { success: true };
    });
  }

  async setSubscription(
    actor: AuthenticatedUser,
    companyId: string,
    dto: PlatformSetSubscriptionDto,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    return this.prisma.$transaction(async (tx) => {
      const company = await this.clientCompany(tx, companyId);
      const sub = await tx.subscription.findFirst({ where: { tenantId: companyId } });
      if (!sub) throw new NotFoundException("Obuna topilmadi");

      const updateData: Prisma.SubscriptionUpdateInput = {};
      if (dto.status) updateData.status = dto.status;
      if (dto.planId) {
        const plan = await tx.plan.findUnique({ where: { id: dto.planId } });
        if (!plan) throw new BadRequestException("Reja topilmadi");
        updateData.plan = { connect: { id: dto.planId } };
      }
      if (dto.currentPeriodEnd) {
        updateData.currentPeriodEnd = new Date(dto.currentPeriodEnd);
      }
      if (dto.monthlyFee !== undefined) {
        updateData.monthlyFee = dto.monthlyFee ? new Prisma.Decimal(dto.monthlyFee) : null;
      }

      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: updateData,
        include: { plan: true },
      });

      await this.recordAudit(tx, actor, {
        tenantId: companyId,
        actorUserId: actor.userId,
        action: "platform.update_subscription",
        entityType: "Subscription",
        entityId: sub.id,
        metadata: { changes: { ...dto } as Prisma.InputJsonObject, companyName: company.name },
        ip,
      });

      return updated;
    });
  }

  async deleteUser(
    actor: AuthenticatedUser,
    companyId: string,
    userId: string,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    if (userId === actor.userId) {
      throw new BadRequestException("O'z hisobingizni o'chira olmaysiz");
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: userId, tenantId: companyId },
        include: { company: true },
      });
      if (!target) throw new NotFoundException("Foydalanuvchi topilmadi");

      if (target.isSuperAdmin) {
        const superAdminCount = await tx.user.count({ where: { isSuperAdmin: true, isActive: true } });
        if (superAdminCount <= 1) {
          throw new BadRequestException("Tizimdagi yagona faol super adminni o'chirib bo'lmaydi");
        }
      }

      const [vehicleCount, contractCount] = await Promise.all([
        tx.vehicle.count({ where: { ownerId: userId } }),
        tx.contract.count({ where: { ownerId: userId, status: "ACTIVE" } }),
      ]);
      if (vehicleCount > 0 || contractCount > 0) {
        throw new BadRequestException(
          `Foydalanuvchini o'chirib bo'lmaydi: unga ${vehicleCount} ta avtomobil yoki ${contractCount} ta faol shartnoma biriktirilgan.`,
        );
      }

      await tx.contract.updateMany({ where: { createdById: userId }, data: { createdById: actor.userId } });
      await tx.payment.updateMany({ where: { createdById: userId }, data: { createdById: actor.userId } });
      await tx.tariff.updateMany({ where: { createdById: userId }, data: { createdById: actor.userId } });
      await tx.vehicleAssignment.updateMany({ where: { createdById: userId }, data: { createdById: null } });
      await tx.driverPayment.updateMany({ where: { receivedById: userId }, data: { receivedById: null } });
      await tx.paymentSubmission.updateMany({ where: { reviewedById: userId }, data: { reviewedById: null } });
      await tx.document.updateMany({ where: { uploadedById: userId }, data: { uploadedById: actor.userId } });
      await tx.auditLog.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null } });

      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.telegramAccount.deleteMany({ where: { userId } });
      await tx.telegramLinkToken.deleteMany({ where: { userId } });

      await tx.user.delete({ where: { id: userId } });

      await this.recordAudit(tx, actor, {
        tenantId: companyId,
        actorUserId: actor.userId,
        action: "platform.delete_user",
        entityType: "User",
        entityId: userId,
        metadata: {
          fullName: target.fullName,
          phone: target.phone,
          role: target.role,
          companyName: target.company.name,
        },
        ip,
      });

      return { success: true };
    });
  }

  async deleteLicense(
    actor: AuthenticatedUser,
    companyId: string,
    licenseId: string,
    ip: string | null,
  ) {
    this.assertSuperAdmin(actor);
    return this.prisma.$transaction(async (tx) => {
      const license = await tx.licenseContract.findFirst({
        where: { id: licenseId, tenantId: companyId },
      });
      if (!license) throw new NotFoundException("Litsenziya shartnomasi topilmadi");

      await tx.licenseContract.delete({ where: { id: licenseId } });

      const remainingLicense = await tx.licenseContract.findFirst({
        where: { tenantId: companyId },
        orderBy: { signedAt: "desc" },
      });
      if (remainingLicense) {
        await tx.subscription.updateMany({
          where: { tenantId: companyId },
          data: { monthlyFee: remainingLicense.amount, planId: remainingLicense.planId },
        });
      } else {
        await tx.subscription.updateMany({
          where: { tenantId: companyId },
          data: { monthlyFee: null },
        });
      }

      await this.recordAudit(tx, actor, {
        tenantId: companyId,
        actorUserId: actor.userId,
        action: "platform.delete_license",
        entityType: "LicenseContract",
        entityId: licenseId,
        metadata: {
          number: license.number,
          planId: license.planId,
          amount: license.amount.toFixed(2),
        },
        ip,
      });

      return { success: true };
    });
  }
}
