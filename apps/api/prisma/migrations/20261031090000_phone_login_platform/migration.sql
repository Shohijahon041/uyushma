-- Login telefon raqam + parol orqali; super admin korxona emas, alohida platforma tenantida.

ALTER TABLE "Company" ADD COLUMN "isPlatform" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Company_single_platform_key" ON "Company"("isPlatform") WHERE "isPlatform";

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- Mavjud raqamlarni +998XXXXXXXXX ko'rinishiga keltirish.
UPDATE "User"
SET phone = CASE
  WHEN length(regexp_replace(phone, '\D', '', 'g')) = 9 THEN '+998' || regexp_replace(phone, '\D', '', 'g')
  WHEN length(regexp_replace(phone, '\D', '', 'g')) = 12 THEN '+' || regexp_replace(phone, '\D', '', 'g')
  ELSE NULLIF(trim(phone), '')
END
WHERE phone IS NOT NULL;

-- Telefon butun platformada yagona: login korxona kodisiz ishlaydi.
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- Login vaqtida tenantni telefon orqali topish (RLS ostida boshqa tenant ko'rinmaydi).
CREATE OR REPLACE FUNCTION app_resolve_tenant_by_phone(p_phone text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u."tenantId"
  FROM "User" u
  JOIN "Company" c ON c.id = u."tenantId"
  WHERE u.phone = p_phone AND c.status = 'ACTIVE'
  LIMIT 1;
$$;

-- Platforma tenanti korxonalar ro'yxatiga kirmaydi.
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
  WHERE NOT c."isPlatform"
  ORDER BY c."createdAt" DESC;
$$;

DROP FUNCTION IF EXISTS app_platform_users();
CREATE FUNCTION app_platform_users()
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  company_name varchar,
  company_slug varchar,
  full_name varchar,
  phone varchar,
  role text,
  is_active boolean,
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
    u.id, u."tenantId", c.name, c.slug, u."fullName", u.phone,
    u.role::text, u."isActive", u."twoFactorEnabled",
    u."lastLoginAt", u."createdAt"
  FROM "User" u
  JOIN "Company" c ON c.id = u."tenantId"
  WHERE NOT c."isPlatform"
  ORDER BY c.name, u."isActive" DESC, u."fullName";
$$;

REVOKE ALL ON FUNCTION app_resolve_tenant_by_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_platform_companies() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_platform_users() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT EXECUTE ON FUNCTION app_resolve_tenant_by_phone(text) TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_platform_companies() TO uyushma_app;
    GRANT EXECUTE ON FUNCTION app_platform_users() TO uyushma_app;
  END IF;
END
$$;
