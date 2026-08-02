-- ---------------------------------------------------------------------------
-- Make row-level security actually enforcing.
--
-- Postgres SUPERUSERS BYPASS RLS. In development and CI the app connects as
-- `postgres`, so the tenant policies installed by the migration are present but
-- inert, and isolation rests on the Prisma tenant extension and the repository
-- layer -- both covered by tests/integration/tenant-isolation.test.ts.
--
-- In any deployment holding real client data, run this once and point the
-- application's DATABASE_URL at `salon_app`, keeping `postgres` (or another
-- owner role) for migrations via DIRECT_DATABASE_URL. RLS then becomes a third,
-- independent barrier: a leak would require the extension, the repository layer
-- AND the database policy to fail together.
--
-- Usage:
--   psql "$DIRECT_DATABASE_URL" -v app_password="'choose-a-real-password'" \
--        -f scripts/sql/app-role.sql
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salon_app') THEN
    CREATE ROLE salon_app LOGIN;
  END IF;
END $$;

ALTER ROLE salon_app WITH PASSWORD :app_password;

-- Explicitly NOT a superuser and NOT BYPASSRLS -- that is the entire point.
ALTER ROLE salon_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE CURRENT_CATALOG TO salon_app;
GRANT USAGE ON SCHEMA public TO salon_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salon_app;

-- Tables created by future migrations are granted automatically, so a new
-- migration cannot accidentally leave the app without access to a table.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salon_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO salon_app;

-- The migration history table must stay owner-only.
REVOKE ALL ON TABLE "_prisma_migrations" FROM salon_app;
