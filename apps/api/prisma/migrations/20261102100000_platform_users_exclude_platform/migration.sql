-- Super admin platforma tenantida yashaydi; platforma tenant foydalanuvchilari
-- korxonalar ro'yxatida ko'rinmasligi kerak (app_platform_companies bilan bir xil).

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
    u.id, u."tenantId", c.name, c.slug, u."fullName", u.phone,
    u.role::text, u."isActive", u."isSuperAdmin", u."twoFactorEnabled",
    u."lastLoginAt", u."createdAt"
  FROM "User" u
  JOIN "Company" c ON c.id = u."tenantId"
  WHERE NOT c."isPlatform"
  ORDER BY c.name, u."isActive" DESC, u."fullName";
$$;

REVOKE ALL ON FUNCTION app_platform_users() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT EXECUTE ON FUNCTION app_platform_users() TO uyushma_app;
  END IF;
END
$$;
