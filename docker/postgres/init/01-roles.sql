-- Local/staging bootstrap only. Production credentials are managed separately.
-- The application must NOT connect as the table owner or a superuser:
-- otherwise PostgreSQL Row Level Security is bypassed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uyushma_app') THEN
    CREATE ROLE uyushma_app
      LOGIN
      PASSWORD 'uyushma_app'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS;
  ELSE
    ALTER ROLE uyushma_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

CREATE DATABASE uyushma_test OWNER postgres;

\connect uyushma
GRANT CONNECT ON DATABASE uyushma TO uyushma_app;
GRANT USAGE ON SCHEMA public TO uyushma_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uyushma_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO uyushma_app;

\connect uyushma_test
GRANT CONNECT ON DATABASE uyushma_test TO uyushma_app;
GRANT USAGE ON SCHEMA public TO uyushma_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uyushma_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO uyushma_app;
