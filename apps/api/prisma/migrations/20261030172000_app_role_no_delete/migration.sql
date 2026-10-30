-- The API never hard-deletes tenant or financial history. Revoking DELETE from
-- the runtime role protects against accidental destructive queries and makes
-- data retention a deliberate, admin-only operation.
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    FOR t IN
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
      EXECUTE format('REVOKE DELETE ON %I FROM uyushma_app', t);
    END LOOP;
  END IF;
END
$$;
