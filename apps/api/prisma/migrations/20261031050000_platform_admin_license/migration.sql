-- Korxona egasi bilan oylik to'lov asosidagi shartnoma va super admin uchun platforma funksiyalari.

-- Shartnomadagi oylik summa; bo'sh bo'lsa tarif narxi qo'llanadi.
ALTER TABLE "Subscription" ADD COLUMN "monthlyFee" DECIMAL(18,2);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_monthlyFee_check" CHECK ("monthlyFee" IS NULL OR "monthlyFee" >= 0);

CREATE TABLE "LicenseContract" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "number" VARCHAR(40) NOT NULL,
  "planId" VARCHAR(40) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'UZS',
  "signedAt" DATE NOT NULL,
  "note" VARCHAR(500),
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LicenseContract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LicenseContract_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "LicenseContract_number_key" ON "LicenseContract"("number");
CREATE INDEX "LicenseContract_tenantId_signedAt_idx" ON "LicenseContract"("tenantId", "signedAt");

ALTER TABLE "LicenseContract"
  ADD CONSTRAINT "LicenseContract_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LicenseContract"
  ADD CONSTRAINT "LicenseContract_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LicenseContract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LicenseContract" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_licensecontract ON "LicenseContract"
  USING ("tenantId" = app_current_tenant_id())
  WITH CHECK ("tenantId" = app_current_tenant_id());

-- ---------------------------------------------------------------------------
-- Kompaniyalar ro'yxati: shartnoma bo'yicha oylik summa va qarzdorlik.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS app_platform_companies();
CREATE FUNCTION app_platform_companies()
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
  monthly_fee numeric,
  has_contract boolean,
  unpaid_count int,
  unpaid_total numeric,
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
    COALESCE(s."monthlyFee", pl."monthlyPrice"),
    s."monthlyFee" IS NOT NULL,
    (SELECT count(*)::int FROM "SubscriptionInvoice" si
      WHERE si."tenantId" = c.id AND si.status IN ('OPEN', 'OVERDUE')),
    (SELECT COALESCE(sum(si.amount), 0)::numeric FROM "SubscriptionInvoice" si
      WHERE si."tenantId" = c.id AND si.status IN ('OPEN', 'OVERDUE')),
    (SELECT max(ec."lastSyncAt") FROM "ExternalConnection" ec WHERE ec."tenantId" = c.id)
  FROM "Company" c
  LEFT JOIN LATERAL (
    SELECT sub."planId", sub.status, sub."currentPeriodEnd", sub."monthlyFee"
    FROM "Subscription" sub
    WHERE sub."tenantId" = c.id AND sub.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE')
    ORDER BY sub."createdAt" DESC
    LIMIT 1
  ) s ON true
  LEFT JOIN "Plan" pl ON pl.id = s."planId"
  ORDER BY c."createdAt" DESC;
$$;

-- Platformadagi barcha foydalanuvchilar (parol xeshi va 2FA siri qaytarilmaydi).
CREATE OR REPLACE FUNCTION app_platform_users()
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  company_name varchar,
  company_slug varchar,
  email varchar,
  full_name varchar,
  phone varchar,
  role text,
  is_active boolean,
  is_super_admin boolean,
  two_factor_enabled boolean,
  last_login_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    u.id, u."tenantId", c.name, c.slug, u.email, u."fullName", u.phone,
    u.role::text, u."isActive", u."isSuperAdmin", u."twoFactorEnabled",
    u."lastLoginAt", u."createdAt"
  FROM "User" u
  JOIN "Company" c ON c.id = u."tenantId"
  ORDER BY c.name, u."isActive" DESC, u."fullName";
$$;

CREATE OR REPLACE FUNCTION app_platform_license_contracts()
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  company_name varchar,
  number varchar,
  plan_id varchar,
  amount numeric,
  currency varchar,
  signed_at date,
  note varchar,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    l.id, l."tenantId", c.name, l.number, l."planId", l.amount, l.currency,
    l."signedAt", l.note, l."createdAt"
  FROM "LicenseContract" l
  JOIN "Company" c ON c.id = l."tenantId"
  ORDER BY l."signedAt" DESC, l."createdAt" DESC;
$$;

-- Kompaniya kodi band yoki yo'qligini tekshirish (RLS ostida boshqa tenant ko'rinmaydi).
CREATE OR REPLACE FUNCTION app_company_slug_taken(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM "Company" WHERE slug = lower(p_slug));
$$;

REVOKE ALL ON FUNCTION app_platform_companies() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_platform_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_platform_license_contracts() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_company_slug_taken(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "LicenseContract" TO uyushma_app;
    REVOKE DELETE ON "LicenseContract" FROM uyushma_app;
    GRANT EXECUTE ON FUNCTION app_platform_companies() TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_platform_users() TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_platform_license_contracts() TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_company_slug_taken(text) TO uyushma_app;
  END IF;
END
$$;
