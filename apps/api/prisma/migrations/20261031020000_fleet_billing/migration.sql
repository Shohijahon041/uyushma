-- ============================================================================
-- Haydovchilar, oylik reja va kunlik to'lovlar.
-- Har bir jadval tenantga tegishli, RLS bilan himoyalangan. Moliyaviy tarix
-- uchun runtime rolga DELETE berilmaydi.
-- ============================================================================

CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "DriverPaymentMethod" AS ENUM ('CASH', 'CARD');

ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Vehicle" ADD COLUMN "monthlyFee" DECIMAL(18,2) NOT NULL DEFAULT 0;

CREATE TABLE "Driver" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "fullName" VARCHAR(160) NOT NULL,
  "phone" VARCHAR(32) NOT NULL,
  "licenseNumber" VARCHAR(60),
  "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
  "telegramChatId" BIGINT,
  "telegramUsername" VARCHAR(64),
  "telegramLinkedAt" TIMESTAMP(3),
  "telegramLinkTokenHash" VARCHAR(64),
  "telegramLinkExpiresAt" TIMESTAMP(3),
  "notes" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleAssignment" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VehicleMonthlyPlan" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "periodStart" DATE NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "note" VARCHAR(300),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleMonthlyPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverPayment" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "driverId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "monthlyPlanId" UUID,
  "amount" DECIMAL(18,2) NOT NULL,
  "method" "DriverPaymentMethod" NOT NULL,
  "periodStart" DATE NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" VARCHAR(20) NOT NULL DEFAULT 'PANEL',
  "note" VARCHAR(300),
  "receivedById" UUID,
  "idempotencyKey" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Driver_telegramChatId_key" ON "Driver"("telegramChatId");
CREATE UNIQUE INDEX "Driver_telegramLinkTokenHash_key" ON "Driver"("telegramLinkTokenHash");
CREATE INDEX "Driver_tenantId_status_idx" ON "Driver"("tenantId", "status");
CREATE INDEX "Driver_tenantId_fullName_idx" ON "Driver"("tenantId", "fullName");
CREATE UNIQUE INDEX "Driver_tenantId_phone_key" ON "Driver"("tenantId", "phone");
CREATE UNIQUE INDEX "Driver_id_tenantId_key" ON "Driver"("id", "tenantId");

CREATE INDEX "VehicleAssignment_tenantId_vehicleId_endDate_idx" ON "VehicleAssignment"("tenantId", "vehicleId", "endDate");
CREATE INDEX "VehicleAssignment_tenantId_driverId_endDate_idx" ON "VehicleAssignment"("tenantId", "driverId", "endDate");
CREATE UNIQUE INDEX "VehicleAssignment_id_tenantId_key" ON "VehicleAssignment"("id", "tenantId");
-- Bir avtomobil va bir haydovchida faqat bitta ochiq biriktirish.
CREATE UNIQUE INDEX "VehicleAssignment_open_vehicle_key" ON "VehicleAssignment"("tenantId", "vehicleId") WHERE "endDate" IS NULL;
CREATE UNIQUE INDEX "VehicleAssignment_open_driver_key" ON "VehicleAssignment"("tenantId", "driverId") WHERE "endDate" IS NULL;

CREATE INDEX "VehicleMonthlyPlan_tenantId_periodStart_idx" ON "VehicleMonthlyPlan"("tenantId", "periodStart");
CREATE INDEX "VehicleMonthlyPlan_tenantId_driverId_periodStart_idx" ON "VehicleMonthlyPlan"("tenantId", "driverId", "periodStart");
CREATE UNIQUE INDEX "VehicleMonthlyPlan_tenantId_vehicleId_periodStart_key" ON "VehicleMonthlyPlan"("tenantId", "vehicleId", "periodStart");
CREATE UNIQUE INDEX "VehicleMonthlyPlan_id_tenantId_key" ON "VehicleMonthlyPlan"("id", "tenantId");

CREATE INDEX "DriverPayment_tenantId_paidAt_idx" ON "DriverPayment"("tenantId", "paidAt");
CREATE INDEX "DriverPayment_tenantId_driverId_periodStart_idx" ON "DriverPayment"("tenantId", "driverId", "periodStart");
CREATE INDEX "DriverPayment_tenantId_vehicleId_periodStart_idx" ON "DriverPayment"("tenantId", "vehicleId", "periodStart");
CREATE UNIQUE INDEX "DriverPayment_tenantId_idempotencyKey_key" ON "DriverPayment"("tenantId", "idempotencyKey");
CREATE UNIQUE INDEX "DriverPayment_id_tenantId_key" ON "DriverPayment"("id", "tenantId");

ALTER TABLE "Driver" ADD CONSTRAINT "Driver_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleAssignment" ADD CONSTRAINT "VehicleAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VehicleMonthlyPlan" ADD CONSTRAINT "VehicleMonthlyPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleMonthlyPlan" ADD CONSTRAINT "VehicleMonthlyPlan_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleMonthlyPlan" ADD CONSTRAINT "VehicleMonthlyPlan_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverPayment" ADD CONSTRAINT "DriverPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverPayment" ADD CONSTRAINT "DriverPayment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverPayment" ADD CONSTRAINT "DriverPayment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverPayment" ADD CONSTRAINT "DriverPayment_monthlyPlanId_fkey" FOREIGN KEY ("monthlyPlanId") REFERENCES "VehicleMonthlyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverPayment" ADD CONSTRAINT "DriverPayment_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Bir tenant ichidagi bog'lanishlar (cross-tenant reference imkonsiz).
ALTER TABLE "VehicleAssignment"
  ADD CONSTRAINT "VehicleAssignment_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleAssignment"
  ADD CONSTRAINT "VehicleAssignment_driver_tenant_fkey"
  FOREIGN KEY ("driverId", "tenantId") REFERENCES "Driver"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleMonthlyPlan"
  ADD CONSTRAINT "VehicleMonthlyPlan_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VehicleMonthlyPlan"
  ADD CONSTRAINT "VehicleMonthlyPlan_driver_tenant_fkey"
  FOREIGN KEY ("driverId", "tenantId") REFERENCES "Driver"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverPayment"
  ADD CONSTRAINT "DriverPayment_driver_tenant_fkey"
  FOREIGN KEY ("driverId", "tenantId") REFERENCES "Driver"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverPayment"
  ADD CONSTRAINT "DriverPayment_vehicle_tenant_fkey"
  FOREIGN KEY ("vehicleId", "tenantId") REFERENCES "Vehicle"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverPayment"
  ADD CONSTRAINT "DriverPayment_plan_tenant_fkey"
  FOREIGN KEY ("monthlyPlanId", "tenantId") REFERENCES "VehicleMonthlyPlan"("id", "tenantId")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'Driver', 'VehicleAssignment', 'VehicleMonthlyPlan', 'DriverPayment'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%s ON %I USING ("tenantId" = app_current_tenant_id()) WITH CHECK ("tenantId" = app_current_tenant_id())',
      lower(t), t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Bot: haydovchi chatini token orqali bog'lash va keyin tenantni aniqlash.
-- Faqat identifikatorlar qaytariladi, biznes ma'lumoti emas.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_resolve_driver_chat(p_chat_id bigint)
RETURNS TABLE (tenant_id uuid, driver_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d."tenantId", d.id
  FROM "Driver" d
  JOIN "Company" c ON c.id = d."tenantId" AND c.status = 'ACTIVE'
  WHERE d."telegramChatId" = p_chat_id AND d.status = 'ACTIVE'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_consume_driver_link_token(
  p_token_hash text,
  p_chat_id bigint,
  p_username text DEFAULT NULL
)
RETURNS TABLE (tenant_id uuid, driver_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_driver uuid;
BEGIN
  -- Bitta chat faqat bitta haydovchiga bog'lanadi.
  UPDATE "Driver"
  SET "telegramChatId" = NULL,
      "telegramUsername" = NULL,
      "telegramLinkedAt" = NULL,
      "updatedAt" = now()
  WHERE "telegramChatId" = p_chat_id;

  DELETE FROM "TelegramAccount" WHERE "chatId" = p_chat_id;

  UPDATE "Driver"
  SET "telegramChatId" = p_chat_id,
      "telegramUsername" = p_username,
      "telegramLinkedAt" = now(),
      "telegramLinkTokenHash" = NULL,
      "telegramLinkExpiresAt" = NULL,
      "updatedAt" = now()
  WHERE "telegramLinkTokenHash" = p_token_hash
    AND "telegramLinkExpiresAt" > now()
    AND status = 'ACTIVE'
  RETURNING "tenantId", id INTO v_tenant, v_driver;

  IF v_tenant IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_tenant, v_driver;
END;
$$;

-- ---------------------------------------------------------------------------
-- Super admin: platforma bo'ylab kompaniyalar ro'yxati va holatini boshqarish.
-- API faqat isSuperAdmin foydalanuvchi uchun chaqiradi.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_platform_companies()
RETURNS TABLE (
  id uuid,
  slug varchar,
  name varchar,
  status text,
  created_at timestamptz,
  user_count int,
  vehicle_count int,
  driver_count int,
  payment_count int,
  collected_total numeric,
  plan_id varchar,
  subscription_status text,
  period_end date,
  last_sync_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id,
    c.slug,
    c.name,
    c.status::text,
    c."createdAt",
    (SELECT count(*)::int FROM "User" u WHERE u."tenantId" = c.id AND u."isActive"),
    (SELECT count(*)::int FROM "Vehicle" v WHERE v."tenantId" = c.id),
    (SELECT count(*)::int FROM "Driver" d WHERE d."tenantId" = c.id),
    (SELECT count(*)::int FROM "DriverPayment" p WHERE p."tenantId" = c.id),
    (SELECT COALESCE(sum(p.amount), 0)::numeric FROM "DriverPayment" p WHERE p."tenantId" = c.id),
    s."planId",
    s.status::text,
    s."currentPeriodEnd",
    (SELECT max(ec."lastSyncAt") FROM "ExternalConnection" ec WHERE ec."tenantId" = c.id)
  FROM "Company" c
  LEFT JOIN LATERAL (
    SELECT sub."planId", sub.status, sub."currentPeriodEnd"
    FROM "Subscription" sub
    WHERE sub."tenantId" = c.id AND sub.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')
    ORDER BY sub."createdAt" DESC
    LIMIT 1
  ) s ON true
  ORDER BY c."createdAt" DESC;
$$;

CREATE OR REPLACE FUNCTION app_set_company_status(p_company_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'Invalid company status';
  END IF;
  UPDATE "Company"
  SET status = p_status::"CompanyStatus", "updatedAt" = now()
  WHERE id = p_company_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION app_resolve_driver_chat(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_consume_driver_link_token(text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_platform_companies() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_set_company_status(uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT SELECT, INSERT, UPDATE ON
      "Driver", "VehicleAssignment", "VehicleMonthlyPlan", "DriverPayment"
    TO uyushma_app;
    REVOKE DELETE ON
      "Driver", "VehicleAssignment", "VehicleMonthlyPlan", "DriverPayment"
    FROM uyushma_app;

    GRANT EXECUTE ON FUNCTION app_resolve_driver_chat(bigint) TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_consume_driver_link_token(text, bigint, text) TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_platform_companies() TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_set_company_status(uuid, text) TO uyushma_app;
  END IF;
END
$$;
