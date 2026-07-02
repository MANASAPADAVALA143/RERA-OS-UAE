-- ============================================================
-- EstateCFO Migration 002: AI audit-log enrichment
-- ============================================================
-- Adds ai_model and purpose columns to audit_logs so every
-- Bedrock call can be traced back to which model was used and
-- why it was invoked (DPDP/NDA audit trail requirement).
--
-- Safety notes:
--   • ADD COLUMN with a default value on a non-empty table in
--     Postgres 11+ is an INSTANT operation (metadata-only when
--     the column is nullable or has a server default stored in
--     the catalog). Both new columns are nullable VARCHAR, so
--     the ALTER TABLE acquires only a brief ShareUpdateExclusiveLock
--     — non-blocking in production even on large tables.
--   • Run against STAGING first. Verify with:
--       SELECT column_name FROM information_schema.columns
--       WHERE table_name = 'audit_logs';
--   • Re-running is safe: IF NOT EXISTS guards prevent errors.
--
-- Run:
--   psql "host=<rds-endpoint> dbname=estatecfo user=estatecfo_master" \
--     -f migrations/002_audit_log_ai_fields.sql
-- ============================================================

BEGIN;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS ai_model VARCHAR(100),
  ADD COLUMN IF NOT EXISTS purpose  VARCHAR(255);

-- Confirm the columns now exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'ai_model'
  ) THEN
    RAISE EXCEPTION 'Migration 002 failed: ai_model column not found after ALTER';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'purpose'
  ) THEN
    RAISE EXCEPTION 'Migration 002 failed: purpose column not found after ALTER';
  END IF;

  RAISE NOTICE 'Migration 002: audit_logs.ai_model and .purpose verified';
END $$;

COMMIT;
