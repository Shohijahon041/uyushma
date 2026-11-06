-- Super admin soni barcha tenantlar bo'ylab sanalishi kerak: RLS ostida
-- tx.user.count() faqat joriy korxonani ko'radi va oxirgi super adminni
-- noto'g'ri "yagona" deb hisoblaydi.
CREATE OR REPLACE FUNCTION app_active_super_admin_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM "User"
  WHERE "isSuperAdmin" IS TRUE AND "isActive" IS TRUE;
$$;

REVOKE ALL ON FUNCTION app_active_super_admin_count() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT EXECUTE ON FUNCTION app_active_super_admin_count() TO uyushma_app;
  END IF;
END
$$;
