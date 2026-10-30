-- ============================================================================
-- Payment provider accounts, Payme transaction mirror, refunds, merchant
-- reconciliation and notification delivery log.
-- ============================================================================

ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

CREATE TYPE "PaymentProvider" AS ENUM ('PAYME', 'CUSTOM_HMAC');
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROVIDER_PENDING', 'PROCESSED', 'FAILED');
CREATE TYPE "ReconciliationStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "PaymentProviderAccount" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "login" VARCHAR(80) NOT NULL,
  "merchantId" VARCHAR(80) NOT NULL,
  "secretEncrypted" VARCHAR(1000) NOT NULL,
  "webhookSecretEncrypted" VARCHAR(1000),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProviderAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentProviderAccount_tenantId_provider_key"
  ON "PaymentProviderAccount" ("tenantId", "provider");
CREATE UNIQUE INDEX "PaymentProviderAccount_id_tenantId_key"
  ON "PaymentProviderAccount" ("id", "tenantId");
CREATE INDEX "PaymentProviderAccount_tenantId_isActive_idx"
  ON "PaymentProviderAccount" ("tenantId", "isActive");

CREATE TABLE "PaymentProviderTransaction" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "externalId" VARCHAR(80) NOT NULL,
  "state" INTEGER NOT NULL,
  "amountTiyin" BIGINT NOT NULL,
  "reason" INTEGER,
  "createTime" BIGINT NOT NULL,
  "performTime" BIGINT,
  "cancelTime" BIGINT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentProviderTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentProviderTransaction_tenantId_provider_externalId_key"
  ON "PaymentProviderTransaction" ("tenantId", "provider", "externalId");
CREATE UNIQUE INDEX "PaymentProviderTransaction_id_tenantId_key"
  ON "PaymentProviderTransaction" ("id", "tenantId");
CREATE INDEX "PaymentProviderTransaction_tenantId_paymentId_idx"
  ON "PaymentProviderTransaction" ("tenantId", "paymentId");
CREATE INDEX "PaymentProviderTransaction_tenantId_createTime_idx"
  ON "PaymentProviderTransaction" ("tenantId", "createTime");

CREATE TABLE "PaymentRefund" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "requestedById" UUID,
  "amount" DECIMAL(18,2) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "provider" "PaymentProvider",
  "externalRef" VARCHAR(160),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentRefund_id_tenantId_key"
  ON "PaymentRefund" ("id", "tenantId");
CREATE INDEX "PaymentRefund_tenantId_paymentId_status_idx"
  ON "PaymentRefund" ("tenantId", "paymentId", "status");
CREATE INDEX "PaymentRefund_tenantId_createdAt_idx"
  ON "PaymentRefund" ("tenantId", "createdAt");

CREATE TABLE "PaymentReconciliation" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "status" "ReconciliationStatus" NOT NULL DEFAULT 'RUNNING',
  "checkedCount" INTEGER NOT NULL DEFAULT 0,
  "matchedCount" INTEGER NOT NULL DEFAULT 0,
  "missingLocalCount" INTEGER NOT NULL DEFAULT 0,
  "missingRemoteCount" INTEGER NOT NULL DEFAULT 0,
  "amountMismatchCount" INTEGER NOT NULL DEFAULT 0,
  "difference" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "details" JSONB,
  "error" VARCHAR(500),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentReconciliation_id_tenantId_key"
  ON "PaymentReconciliation" ("id", "tenantId");
CREATE INDEX "PaymentReconciliation_tenantId_provider_createdAt_idx"
  ON "PaymentReconciliation" ("tenantId", "provider", "createdAt");

CREATE TABLE "NotificationLog" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "event" VARCHAR(80) NOT NULL,
  "jobId" VARCHAR(160),
  "recipients" INTEGER NOT NULL DEFAULT 0,
  "sent" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(30) NOT NULL,
  "error" VARCHAR(500),
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationLog_id_tenantId_key"
  ON "NotificationLog" ("id", "tenantId");
CREATE INDEX "NotificationLog_tenantId_createdAt_idx"
  ON "NotificationLog" ("tenantId", "createdAt");

CREATE INDEX "Payment_tenantId_provider_externalRef_idx"
  ON "Payment" ("tenantId", "provider", "externalRef");

ALTER TABLE "PaymentProviderAccount"
  ADD CONSTRAINT "PaymentProviderAccount_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentProviderTransaction"
  ADD CONSTRAINT "PaymentProviderTransaction_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentProviderTransaction"
  ADD CONSTRAINT "PaymentProviderTransaction_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentProviderTransaction"
  ADD CONSTRAINT "PaymentProviderTransaction_payment_tenant_fkey"
  FOREIGN KEY ("paymentId", "tenantId") REFERENCES "Payment"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_payment_tenant_fkey"
  FOREIGN KEY ("paymentId", "tenantId") REFERENCES "Payment"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_requester_tenant_fkey"
  FOREIGN KEY ("requestedById", "tenantId") REFERENCES "User"("id", "tenantId")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentReconciliation"
  ADD CONSTRAINT "PaymentReconciliation_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation for every new tenant-owned table.
DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY[
    'PaymentProviderAccount', 'PaymentProviderTransaction', 'PaymentRefund',
    'PaymentReconciliation', 'NotificationLog'
  ];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%s ON %I USING ("tenantId" = app_current_tenant_id()) WITH CHECK ("tenantId" = app_current_tenant_id())',
      lower(t), t
    );
  END LOOP;
END
$$;

-- Pre-auth resolver used by the Payme webhook. It discloses the tenant id for
-- a payment only, never business data, and is revoked from PUBLIC.
CREATE OR REPLACE FUNCTION app_resolve_payment_tenant(p_payment_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT "tenantId" FROM "Payment" WHERE id = p_payment_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app_resolve_payment_tenant(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "PaymentProviderAccount", "PaymentProviderTransaction", "PaymentRefund",
      "PaymentReconciliation", "NotificationLog" TO uyushma_app;

    -- Financial history is append-only for the application role.
    REVOKE DELETE ON "PaymentProviderTransaction", "PaymentRefund", "PaymentReconciliation"
      FROM uyushma_app;

    GRANT EXECUTE ON FUNCTION app_resolve_payment_tenant(uuid) TO uyushma_app;
  END IF;
END
$$;
