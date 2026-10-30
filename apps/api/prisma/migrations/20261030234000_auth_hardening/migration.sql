-- ============================================================================
-- Auth hardening: email verification, password reset, TOTP 2FA and device
-- sessions. Additive migration; existing sessions are preserved.
-- ============================================================================

ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "twoFactorSecret" VARCHAR(1000),
  ADD COLUMN "twoFactorRecoveryCodes" JSONB;

-- Existing accounts were created before verification existed; do not lock
-- anybody out by retroactively marking them unverified.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

ALTER TABLE "RefreshToken"
  ADD COLUMN "sessionId" UUID,
  ADD COLUMN "revokedReason" VARCHAR(40),
  ADD COLUMN "userAgent" VARCHAR(512),
  ADD COLUMN "ip" VARCHAR(64),
  ADD COLUMN "deviceLabel" VARCHAR(80),
  ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT now();

UPDATE "RefreshToken" SET "sessionId" = "id" WHERE "sessionId" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "sessionId" SET NOT NULL;

CREATE INDEX "RefreshToken_tenantId_userId_sessionId_idx"
  ON "RefreshToken" ("tenantId", "userId", "sessionId");
CREATE INDEX "RefreshToken_tenantId_userId_revokedAt_idx"
  ON "RefreshToken" ("tenantId", "userId", "revokedAt");

CREATE TABLE "EmailVerificationToken" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key"
  ON "EmailVerificationToken" ("tokenHash");
CREATE UNIQUE INDEX "EmailVerificationToken_id_tenantId_key"
  ON "EmailVerificationToken" ("id", "tenantId");
CREATE INDEX "EmailVerificationToken_tenantId_userId_idx"
  ON "EmailVerificationToken" ("tenantId", "userId");

CREATE TABLE "PasswordResetToken" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"
  ON "PasswordResetToken" ("tokenHash");
CREATE UNIQUE INDEX "PasswordResetToken_id_tenantId_key"
  ON "PasswordResetToken" ("id", "tenantId");
CREATE INDEX "PasswordResetToken_tenantId_userId_idx"
  ON "PasswordResetToken" ("tenantId", "userId");

ALTER TABLE "EmailVerificationToken"
  ADD CONSTRAINT "EmailVerificationToken_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailVerificationToken"
  ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailVerificationToken"
  ADD CONSTRAINT "EmailVerificationToken_user_tenant_fkey"
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_user_tenant_fkey"
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security for the new tenant-owned tables.
ALTER TABLE "EmailVerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailVerificationToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_email_verification_token ON "EmailVerificationToken"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_password_reset_token ON "PasswordResetToken"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "EmailVerificationToken", "PasswordResetToken"
      TO uyushma_app;
  END IF;
END
$$;
