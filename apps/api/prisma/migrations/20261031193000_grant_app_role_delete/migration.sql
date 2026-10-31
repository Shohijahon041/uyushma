-- Grant DELETE privileges to uyushma_app for entity lifecycles managed by the application.
-- AuditLog remains immutable and Plan remains managed via schema migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uyushma_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uyushma_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uyushma_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO uyushma_app;

    -- Faqat AuditLog o'zgartirilmaydigan xavfsizlik arxividir
    REVOKE UPDATE, DELETE ON "AuditLog" FROM uyushma_app;
    -- Plan tizim rejalari bo'lib, faqat migratsiya orqali boshqariladi
    REVOKE INSERT, UPDATE, DELETE ON "Plan" FROM uyushma_app;
  END IF;
END
$$;
