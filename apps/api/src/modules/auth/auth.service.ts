import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma, User, UserRole } from "@prisma/client";
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { TenantPrismaService, TenantTx } from "../../common/prisma/tenant-prisma.service";
import { EncryptionService } from "../../common/crypto/encryption.service";
import { deviceLabel } from "../../common/auth/device";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from "../../common/auth/totp";
import { AuditService } from "../audit/audit.service";
import { EmailService } from "./email.service";
import {
  DisableTwoFactorDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterCompanyDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyTwoFactorDto,
} from "./dto/auth.dto";
import type { RefreshTokenPayload } from "../../common/auth/auth.types";

const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const MFA_TOKEN_TTL_SECONDS = 5 * 60;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export interface SessionMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

export interface AuthUserView {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  emailVerifiedAt: Date | null;
  twoFactorEnabled: boolean;
}

interface CompanyView {
  id: string;
  name: string;
  slug: string;
}

export interface AuthResult extends AuthTokens {
  user: AuthUserView;
  company: CompanyView;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  expiresIn: number;
}

export type RegistrationResult =
  | AuthResult
  | { verificationRequired: true; user: AuthUserView; company: CompanyView };

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash = "";

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly email: EmailService,
  ) {}

  private get requireEmailVerification(): boolean {
    return this.config.get<boolean>("REQUIRE_EMAIL_VERIFICATION", false);
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash("timing-equalizer-not-a-real-password", ARGON_OPTIONS);
  }

  // -------------------------------------------------------------------------
  // Registration and login
  // -------------------------------------------------------------------------

  async register(
    dto: RegisterCompanyDto,
    meta: SessionMeta,
  ): Promise<RegistrationResult> {
    const tenantId = randomUUID();
    const slug = dto.companySlug.toLowerCase();
    const passwordHash = await hash(dto.password, ARGON_OPTIONS);
    const today = startOfToday();
    const requireVerification = this.requireEmailVerification;
    const sessionId = randomUUID();
    let verificationToken: string | null = null;

    try {
      const result = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
        const plan = await tx.plan.findUnique({ where: { id: "START" } });
        if (!plan || !plan.isActive) {
          throw new ServiceUnavailableException(
            "Obuna rejalari sozlanmagan. Administrator bilan bog'laning.",
          );
        }

        const company = await tx.company.create({
          data: { id: tenantId, slug, name: dto.companyName.trim() },
        });
        const user = await tx.user.create({
          data: {
            tenantId,
            email: dto.email,
            passwordHash,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            role: UserRole.OWNER,
            emailVerifiedAt: requireVerification ? null : new Date(),
          },
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

        if (requireVerification) {
          verificationToken = await this.createEmailToken(tx, user);
        }

        await this.audit.record(tx, {
          tenantId,
          actorUserId: user.id,
          action: "auth.company_registered",
          entityType: "Company",
          entityId: tenantId,
          metadata: { slug, plan: plan.id, verificationRequired: requireVerification },
          ip: meta.ip,
        });

        if (requireVerification) {
          return {
            verificationRequired: true as const,
            user: this.toUserView(user),
            company: { id: company.id, name: company.name, slug: company.slug },
          };
        }

        const tokens = await this.issueTokens(tx, user, {
          sessionId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
        return {
          ...tokens,
          user: this.toUserView(user),
          company: { id: company.id, name: company.name, slug: company.slug },
        };
      });

      if ("verificationRequired" in result && verificationToken) {
        await this.sendVerificationEmail(
          { to: dto.email, fullName: dto.fullName, companySlug: dto.companySlug },
          verificationToken,
        );
      }
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(
          "Bu kompaniya kodi yoki email allaqachon ro'yxatdan o'tgan",
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto, meta: SessionMeta): Promise<AuthResult | MfaChallenge> {
    const tenantId = await this.tenantPrisma.resolveTenantIdBySlug(dto.companySlug);
    if (!tenantId) {
      await verify(this.dummyHash, dto.password).catch(() => false);
      throw new UnauthorizedException("Kompaniya kodi, email yoki parol xato");
    }

    const result = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email } },
      });
      if (!user) {
        await verify(this.dummyHash, dto.password).catch(() => false);
        return null;
      }
      const valid = await verify(user.passwordHash, dto.password).catch(() => false);
      if (!valid || !user.isActive) {
        return null;
      }
      if (this.requireEmailVerification && !user.emailVerifiedAt) {
        return { kind: "unverified" as const };
      }

      if (user.twoFactorEnabled && user.twoFactorSecret) {
        await this.audit.record(tx, {
          tenantId,
          actorUserId: user.id,
          action: "auth.mfa_challenged",
          entityType: "User",
          entityId: user.id,
          ip: meta.ip,
        });
        return { kind: "mfa" as const, userId: user.id };
      }

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: user.id,
        action: "auth.login",
        entityType: "User",
        entityId: user.id,
        ip: meta.ip,
      });
      const tokens = await this.issueTokens(tx, user, {
        sessionId: randomUUID(),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const company = await tx.company.findUniqueOrThrow({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true },
      });
      return { kind: "ok" as const, result: { ...tokens, user: this.toUserView(user), company } };
    });

    if (!result) {
      throw new UnauthorizedException("Kompaniya kodi, email yoki parol xato");
    }
    if (result.kind === "unverified") {
      throw new ForbiddenException(
        "Email manzilingiz tasdiqlanmagan. Pochtangizga yuborilgan havolani oching.",
      );
    }
    if (result.kind === "mfa") {
      return {
        mfaRequired: true,
        mfaToken: await this.signMfaToken(result.userId, tenantId),
        expiresIn: MFA_TOKEN_TTL_SECONDS,
      };
    }
    return result.result;
  }

  async verifyTwoFactor(
    dto: VerifyTwoFactorDto,
    meta: SessionMeta,
  ): Promise<AuthResult> {
    let payload: { sub: string; tenantId: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(dto.mfaToken, {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
        audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
      });
    } catch {
      throw new UnauthorizedException("Tasdiqlash seansi muddati tugagan. Qayta kiring.");
    }
    if (payload.typ !== "mfa" || !payload.sub || !payload.tenantId) {
      throw new UnauthorizedException("Tasdiqlash tokeni yaroqsiz");
    }
    if (!dto.code && !dto.recoveryCode) {
      throw new BadRequestException("Kod yoki tiklash kodi kiritilishi kerak");
    }

    const result = await this.tenantPrisma.withTenant(payload.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: payload.sub, isActive: true },
      });
      if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return null;

      let verified = false;
      let usedRecovery: string | null = null;
      if (dto.code) {
        try {
          verified = verifyTotp(
            this.encryption.decrypt(user.twoFactorSecret),
            dto.code,
          );
        } catch {
          verified = false;
        }
      }
      if (!verified && dto.recoveryCode) {
        const candidate = this.encryption.hmac(
          normalizeRecoveryCode(dto.recoveryCode),
          `recovery:${user.id}`,
        );
        const codes = this.recoveryHashes(user.twoFactorRecoveryCodes);
        if (codes.some((stored) => this.encryption.safeEqualHex(stored, candidate))) {
          verified = true;
          usedRecovery = candidate;
        }
      }
      if (!verified) return null;

      if (usedRecovery) {
        const remaining = this.recoveryHashes(user.twoFactorRecoveryCodes).filter(
          (stored) => stored !== usedRecovery,
        );
        await tx.user.update({
          where: { id: user.id },
          data: { twoFactorRecoveryCodes: remaining },
        });
      }
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: payload.tenantId,
        actorUserId: user.id,
        action: usedRecovery ? "auth.mfa_recovery_used" : "auth.mfa_verified",
        entityType: "User",
        entityId: user.id,
        ip: meta.ip,
      });
      const tokens = await this.issueTokens(tx, user, {
        sessionId: randomUUID(),
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const company = await tx.company.findUniqueOrThrow({
        where: { id: payload.tenantId },
        select: { id: true, name: true, slug: true },
      });
      return { ...tokens, user: this.toUserView(user), company };
    });

    if (!result) {
      throw new UnauthorizedException("Tasdiqlash kodi yaroqsiz");
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Two-factor management
  // -------------------------------------------------------------------------

  async setupTwoFactor(
    tenantId: string,
    userId: string,
    ip: string | null,
  ): Promise<{ secret: string; otpauthUri: string }> {
    const secret = generateTotpSecret();
    const encrypted = this.encryption.encrypt(secret);
    const email = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { id: userId } });
      if (user.twoFactorEnabled) {
        throw new BadRequestException("Ikki bosqichli tasdiqlash allaqachon yoqilgan");
      }
      await tx.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: encrypted },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: user.id,
        action: "auth.2fa_setup_started",
        entityType: "User",
        entityId: user.id,
        ip,
      });
      return user.email;
    });
    return {
      secret,
      otpauthUri: totpUri(secret, email),
    };
  }

  async enableTwoFactor(
    tenantId: string,
    userId: string,
    code: string,
    ip: string | null,
  ): Promise<{ enabled: true; recoveryCodes: string[] }> {
    const recoveryCodes = generateRecoveryCodes();
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { id: userId } });
      if (user.twoFactorEnabled) {
        throw new BadRequestException("Ikki bosqichli tasdiqlash allaqachon yoqilgan");
      }
      if (!user.twoFactorSecret) {
        throw new BadRequestException("Avval 2FA sozlamasini boshlang");
      }
      let secret: string;
      try {
        secret = this.encryption.decrypt(user.twoFactorSecret);
      } catch {
        throw new BadRequestException("2FA sozlamasi buzilgan. Qaytadan boshlang.");
      }
      if (!verifyTotp(secret, code)) {
        throw new BadRequestException("Kod xato. Authenticator ilovasidagi kodni kiriting.");
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorRecoveryCodes: recoveryCodes.map((item) =>
            this.encryption.hmac(normalizeRecoveryCode(item), `recovery:${user.id}`),
          ),
        },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: user.id,
        action: "auth.2fa_enabled",
        entityType: "User",
        entityId: user.id,
        ip,
      });
    });
    return { enabled: true, recoveryCodes };
  }

  async disableTwoFactor(
    tenantId: string,
    userId: string,
    dto: DisableTwoFactorDto,
    ip: string | null,
  ): Promise<{ enabled: false }> {
    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { id: userId } });
      if (!user.twoFactorEnabled) {
        throw new BadRequestException("Ikki bosqichli tasdiqlash yoqilmagan");
      }
      const passwordValid = await verify(user.passwordHash, dto.password).catch(() => false);
      if (!passwordValid) {
        throw new UnauthorizedException("Parol xato");
      }
      let verified = false;
      if (dto.code && user.twoFactorSecret) {
        try {
          verified = verifyTotp(this.encryption.decrypt(user.twoFactorSecret), dto.code);
        } catch {
          verified = false;
        }
      }
      if (!verified && dto.recoveryCode) {
        const candidate = this.encryption.hmac(
          normalizeRecoveryCode(dto.recoveryCode),
          `recovery:${user.id}`,
        );
        verified = this.recoveryHashes(user.twoFactorRecoveryCodes).some((stored) =>
          this.encryption.safeEqualHex(stored, candidate),
        );
      }
      if (!verified) {
        throw new BadRequestException("Tasdiqlash kodi yaroqsiz");
      }
      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorRecoveryCodes: Prisma.DbNull,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: user.id,
        action: "auth.2fa_disabled",
        entityType: "User",
        entityId: user.id,
        ip,
      });
    });
    return { enabled: false };
  }

  // -------------------------------------------------------------------------
  // Password reset and email verification
  // -------------------------------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto, ip: string | null): Promise<{ sent: true }> {
    const tenantId = await this.tenantPrisma.resolveTenantIdBySlug(dto.companySlug);
    if (!tenantId) {
      await verify(this.dummyHash, "constant-time-placeholder").catch(() => false);
      return { sent: true };
    }

    const outcome = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email } },
      });
      if (!user || !user.isActive) return null;
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      const token = randomToken();
      await tx.passwordResetToken.create({
        data: {
          tenantId,
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: user.id,
        action: "auth.password_reset_requested",
        entityType: "User",
        entityId: user.id,
        ip,
      });
      const company = await tx.company.findUniqueOrThrow({
        where: { id: tenantId },
        select: { slug: true },
      });
      return { user, token, slug: company.slug };
    });

    if (outcome) {
      await this.sendPasswordResetEmail(outcome.user, outcome.slug, outcome.token);
    }
    return { sent: true };
  }

  async resetPassword(dto: ResetPasswordDto, ip: string | null): Promise<{ reset: true }> {
    const tenantId = await this.tenantPrisma.resolveTenantIdBySlug(dto.companySlug);
    if (!tenantId) throw new BadRequestException("Havola yaroqsiz yoki muddati tugagan");

    const passwordHash = await hash(dto.password, ARGON_OPTIONS);
    const user = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash: sha256(dto.token) },
      });
      if (
        !token ||
        token.tenantId !== tenantId ||
        token.usedAt ||
        token.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException("Havola yaroqsiz yoki muddati tugagan");
      }
      const target = await tx.user.findFirst({
        where: { id: token.userId, isActive: true },
      });
      if (!target) throw new BadRequestException("Foydalanuvchi topilmadi");

      await tx.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      });
      const updated = await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash,
          emailVerifiedAt: target.emailVerifiedAt ?? new Date(),
        },
      });
      // A password reset invalidates every device session.
      await tx.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "password_reset" },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: target.id,
        action: "auth.password_reset",
        entityType: "User",
        entityId: target.id,
        ip,
      });
      return updated;
    });

    await this.email
      .sendSecurityAlert({
        to: user.email,
        fullName: user.fullName,
        action: "parol tiklandi",
        ip,
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `Xavfsizlik xabari yuborilmadi: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    return { reset: true };
  }

  async verifyEmail(dto: VerifyEmailDto, ip: string | null): Promise<{ verified: true }> {
    const tenantId = await this.tenantPrisma.resolveTenantIdBySlug(dto.companySlug);
    if (!tenantId) throw new BadRequestException("Havola yaroqsiz yoki muddati tugagan");

    await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const token = await tx.emailVerificationToken.findUnique({
        where: { tokenHash: sha256(dto.token) },
      });
      if (
        !token ||
        token.tenantId !== tenantId ||
        token.usedAt ||
        token.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException("Havola yaroqsiz yoki muddati tugagan");
      }
      await tx.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      });
      await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: token.userId,
        action: "auth.email_verified",
        entityType: "User",
        entityId: token.userId,
        ip,
      });
    });
    return { verified: true };
  }

  async resendVerification(dto: ForgotPasswordDto): Promise<{ sent: true }> {
    const tenantId = await this.tenantPrisma.resolveTenantIdBySlug(dto.companySlug);
    if (!tenantId) return { sent: true };

    const outcome = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email } },
      });
      if (!user || !user.isActive || user.emailVerifiedAt) return null;
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      const token = await this.createEmailToken(tx, user);
      const company = await tx.company.findUniqueOrThrow({
        where: { id: tenantId },
        select: { slug: true },
      });
      return { user, token, slug: company.slug };
    });

    if (outcome) {
      await this.sendVerificationEmail(
        {
          to: outcome.user.email,
          fullName: outcome.user.fullName,
          companySlug: outcome.slug,
        },
        outcome.token,
      );
    }
    return { sent: true };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async listSessions(tenantId: string, userId: string, currentSessionId?: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.refreshToken.findMany({
        where: {
          userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: "desc" },
        take: 100,
        select: {
          sessionId: true,
          deviceLabel: true,
          userAgent: true,
          ip: true,
          lastUsedAt: true,
          createdAt: true,
          expiresAt: true,
        },
      });
      const seen = new Set<string>();
      const items = [];
      for (const row of rows) {
        if (seen.has(row.sessionId)) continue;
        seen.add(row.sessionId);
        items.push({
          id: row.sessionId,
          deviceLabel: row.deviceLabel,
          userAgent: row.userAgent,
          ip: row.ip,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          current: row.sessionId === currentSessionId,
        });
      }
      return { items };
    });
  }

  async revokeSession(
    tenantId: string,
    userId: string,
    sessionId: string,
    ip: string | null,
  ): Promise<{ revoked: true }> {
    const updated = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { tenantId, userId, sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "user_revoked" },
      });
      if (result.count === 0) return false;
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: "auth.session_revoked",
        entityType: "RefreshToken",
        entityId: sessionId,
        ip,
      });
      return true;
    });
    if (!updated) throw new NotFoundException("Sessiya topilmadi");
    return { revoked: true };
  }

  async revokeOtherSessions(
    tenantId: string,
    userId: string,
    currentSessionId: string | undefined,
    ip: string | null,
  ): Promise<{ revoked: number }> {
    const count = await this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: {
          tenantId,
          userId,
          revokedAt: null,
          ...(currentSessionId ? { sessionId: { not: currentSessionId } } : {}),
        },
        data: { revokedAt: new Date(), revokedReason: "user_revoked_others" },
      });
      await this.audit.record(tx, {
        tenantId,
        actorUserId: userId,
        action: "auth.other_sessions_revoked",
        entityType: "User",
        entityId: userId,
        metadata: { revoked: result.count },
        ip,
      });
      return result.count;
    });
    return { revoked: count };
  }

  // -------------------------------------------------------------------------
  // Token lifecycle
  // -------------------------------------------------------------------------

  async refresh(dto: RefreshDto, meta: SessionMeta): Promise<AuthResult> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(dto.refreshToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
        issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
        audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
      });
    } catch {
      throw new UnauthorizedException("Refresh token yaroqsiz");
    }
    if (payload.typ !== "refresh" || !payload.sub || !payload.tenantId) {
      throw new UnauthorizedException("Refresh token turi noto'g'ri");
    }
    if (!payload.sessionId) {
      throw new UnauthorizedException("Sessiya ma'lumoti yo'q. Qayta kiring.");
    }

    const tokenHash = sha256(dto.refreshToken);
    const outcome = await this.tenantPrisma.withTenant(payload.tenantId, async (tx) => {
      const stored = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (
        !stored ||
        stored.userId !== payload.sub ||
        stored.sessionId !== payload.sessionId
      ) {
        return { kind: "invalid" as const };
      }

      if (stored.revokedAt) {
        // Reuse of a rotated token: assume theft, revoke the whole session family.
        await tx.refreshToken.updateMany({
          where: { userId: stored.userId, sessionId: stored.sessionId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: "reuse_detected" },
        });
        await this.audit.record(tx, {
          tenantId: payload.tenantId,
          actorUserId: stored.userId,
          action: "auth.refresh_token_reuse",
          entityType: "RefreshToken",
          entityId: stored.id,
          ip: meta.ip,
        });
        return { kind: "reuse" as const };
      }

      if (stored.expiresAt.getTime() <= Date.now()) {
        await tx.refreshToken.update({
          where: { id: stored.id },
          data: { revokedAt: new Date(), revokedReason: "expired" },
        });
        return { kind: "expired" as const };
      }

      const user = await tx.user.findFirst({
        where: { id: stored.userId, isActive: true },
      });
      const company = await tx.company.findFirst({
        where: { id: payload.tenantId, status: "ACTIVE" },
        select: { id: true, name: true, slug: true },
      });
      if (!user || !company) {
        return { kind: "invalid" as const };
      }

      const tokens = await this.issueTokens(tx, user, {
        sessionId: stored.sessionId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: {
          revokedAt: new Date(),
          revokedReason: "rotated",
          replacedByHash: sha256(tokens.refreshToken),
          lastUsedAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        tenantId: payload.tenantId,
        actorUserId: user.id,
        action: "auth.token_refreshed",
        entityType: "User",
        entityId: user.id,
        ip: meta.ip,
      });
      return {
        kind: "ok" as const,
        result: { ...tokens, user: this.toUserView(user), company },
      };
    });

    if (outcome.kind !== "ok") {
      throw new UnauthorizedException("Sessiya muddati tugagan. Qayta kiring.");
    }
    return outcome.result;
  }

  async logout(refreshToken: string, ip: string | null): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
        issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
        audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
      });
    } catch {
      return; // Do not reveal whether the token was valid.
    }
    if (payload.typ !== "refresh") return;

    const tokenHash = sha256(refreshToken);
    await this.tenantPrisma.withTenant(payload.tenantId, async (tx) => {
      const stored = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored) return;
      if (stored.revokedAt) return;
      await tx.refreshToken.updateMany({
        where: {
          userId: stored.userId,
          sessionId: payload.sessionId ?? stored.sessionId,
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedReason: "logout" },
      });
      await this.audit.record(tx, {
        tenantId: payload.tenantId,
        actorUserId: stored.userId,
        action: "auth.logout",
        entityType: "User",
        entityId: stored.userId,
        ip,
      });
    });
  }

  async me(tenantId: string, userId: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findFirstOrThrow({
        where: { id: userId, isActive: true },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          isSuperAdmin: true,
          emailVerifiedAt: true,
          twoFactorEnabled: true,
          lastLoginAt: true,
          createdAt: true,
          company: { select: { id: true, name: true, slug: true, status: true } },
        },
      });
      return user;
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async signMfaToken(userId: string, tenantId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, tenantId, typ: "mfa" },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
        audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
        expiresIn: MFA_TOKEN_TTL_SECONDS,
      },
    );
  }

  private async createEmailToken(tx: TenantTx, user: User): Promise<string> {
    const token = randomToken();
    await tx.emailVerificationToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    });
    return token;
  }

  private async sendVerificationEmail(
    input: { to: string; fullName: string; companySlug: string },
    token: string,
  ): Promise<void> {
    try {
      await this.email.sendVerification({ ...input, token });
    } catch (error) {
      this.logger.warn(
        `Tasdiqlash xati yuborilmadi: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async sendPasswordResetEmail(
    user: User,
    companySlug: string,
    token: string,
  ): Promise<void> {
    try {
      await this.email.sendPasswordReset({
        to: user.email,
        fullName: user.fullName,
        companySlug,
        token,
      });
    } catch (error) {
      this.logger.warn(
        `Parol tiklash xati yuborilmadi: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async issueTokens(
    tx: TenantTx,
    user: Pick<User, "id" | "tenantId" | "role">,
    session: { sessionId: string; ip: string | null; userAgent: string | null },
  ): Promise<AuthTokens> {
    const accessTtl = this.config.get<number>("ACCESS_TOKEN_TTL_SECONDS", 900);
    const refreshTtl = this.config.get<number>("REFRESH_TOKEN_TTL_SECONDS", 2_592_000);

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        tenantId: user.tenantId,
        typ: "access",
        role: user.role,
        sessionId: session.sessionId,
      },
      {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
        audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
        expiresIn: accessTtl,
      },
    );

    const refreshToken = await this.jwt.signAsync(
      {
        sub: user.id,
        tenantId: user.tenantId,
        typ: "refresh",
        sessionId: session.sessionId,
        jti: randomUUID(),
      },
      {
        secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
        issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
        audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
        expiresIn: refreshTtl,
      },
    );

    await tx.refreshToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        sessionId: session.sessionId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
        userAgent: session.userAgent,
        ip: session.ip,
        deviceLabel: deviceLabel(session.userAgent),
      },
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: accessTtl,
      refreshTokenExpiresIn: refreshTtl,
    };
  }

  private recoveryHashes(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private toUserView(user: User): AuthUserView {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt,
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }
}
