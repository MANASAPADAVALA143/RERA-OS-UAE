-- ============================================================
-- EstateCFO: Row-Level Security (RLS) — defense-in-depth layer
-- ============================================================
-- Run ONCE against the RDS PostgreSQL instance after pg_restore.
-- This script is idempotent: re-running it is safe.
--
-- What this does:
--   1. Creates the app-role DB user (estatecfo_app) with least-privilege.
--      The FastAPI backend connects as this user — never as the master user.
--   2. Grants the app role SELECT/INSERT/UPDATE/DELETE on all tables.
--   3. Enables RLS + FORCE RLS on every tenant-scoped table.
--   4. Creates a single policy per table: rows are visible/writable only
--      where tenant_id matches current_setting('app.current_tenant_id').
--
-- Tables EXCLUDED from RLS (auth infrastructure, no tenant_id):
--   tenants, tenant_users
--   (these are looked up by the auth system before tenant_id is known)
--
-- HOW TO RUN:
--   psql "host=<rds-endpoint> port=5432 dbname=estatecfo user=estatecfo_master" \
--     -f migrations/001_rls.sql
-- ============================================================

BEGIN;

-- ── Step 1: Create the least-privilege app role ───────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'estatecfo_app') THEN
    CREATE ROLE estatecfo_app WITH LOGIN;
    RAISE NOTICE 'Created role estatecfo_app';
  ELSE
    RAISE NOTICE 'Role estatecfo_app already exists — skipping creation';
  END IF;
END $$;

-- Grant connect to the database
GRANT CONNECT ON DATABASE estatecfo TO estatecfo_app;
GRANT USAGE ON SCHEMA public TO estatecfo_app;

-- Grant DML on all existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estatecfo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estatecfo_app;

-- Ensure future tables also get grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO estatecfo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO estatecfo_app;


-- ── Step 2: Enable RLS on every tenant-scoped table ───────────────────────────
-- Dynamic approach: find all tables in public schema that have a tenant_id column,
-- excluding auth tables that don't need tenant isolation.

DO $$
DECLARE
  tbl text;
  excluded_tables text[] := ARRAY['tenants', 'tenant_users'];
BEGIN
  FOR tbl IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON c.table_name = t.table_name
      AND c.table_schema = t.table_schema
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name != ALL(excluded_tables)
    ORDER BY c.table_name
  LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- FORCE RLS: prevents the table owner connection from bypassing the policy.
    -- Without this, a bug that connects as the wrong role could see all rows.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);

    -- Drop and recreate the policy idempotently
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
    EXECUTE format($$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    $$, tbl);

    RAISE NOTICE 'RLS enabled on table: %', tbl;
  END LOOP;
END $$;


-- ── Step 3: Verify — list all tables where RLS is now active ─────────────────
SELECT
  schemaname,
  tablename,
  rowsecurity   AS rls_enabled,
  forcerls      AS force_rls
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = true
ORDER BY tablename;


COMMIT;

-- ── Post-run checklist ────────────────────────────────────────────────────────
-- After running this script:
--
-- 1. Update the Secrets Manager secret "estatecfo/prod/rds-app" with the
--    new password for estatecfo_app:
--
--      ALTER ROLE estatecfo_app WITH PASSWORD 'your-strong-password';
--
--      aws secretsmanager put-secret-value \
--        --secret-id estatecfo/prod/rds-app \
--        --secret-string '{
--          "username": "estatecfo_app",
--          "password": "your-strong-password",
--          "host": "<rds-endpoint>",
--          "port": 5432,
--          "dbname": "estatecfo"
--        }'
--
-- 2. Set RDS_SECRET_ARN in your compute environment to the ARN of the
--    "estatecfo/prod/rds-app" secret (output by Terraform).
--
-- 3. Run scripts/test_rls.py to verify isolation at the database level.
