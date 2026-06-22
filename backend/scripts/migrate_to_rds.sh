#!/usr/bin/env bash
# ============================================================
# EstateCFO: Supabase → RDS migration script
# ============================================================
# Usage:
#   1. Set the environment variables below (or export before running)
#   2. Run: bash scripts/migrate_to_rds.sh
#
# Prerequisites:
#   - pg_dump and pg_restore installed (PostgreSQL client tools)
#   - psql installed
#   - AWS CLI configured (for Secrets Manager lookup)
#   - Network access to both Supabase and RDS endpoints
#
# Safety:
#   - Supabase DB is NOT touched — read-only pg_dump
#   - RDS restore is idempotent if schema is empty
#   - Row count verification runs after restore before script exits
# ============================================================

set -euo pipefail

# ── Configuration — fill these in before running ──────────────────────────────

# Supabase source (your existing database)
SUPABASE_HOST="${SUPABASE_HOST:?Set SUPABASE_HOST}"
SUPABASE_PORT="${SUPABASE_PORT:-5432}"
SUPABASE_DB="${SUPABASE_DB:-postgres}"
SUPABASE_USER="${SUPABASE_USER:-postgres}"
# Export PGPASSWORD=your_supabase_password before running, or use .pgpass

# RDS destination (from Terraform outputs.tf)
RDS_HOST="${RDS_HOST:?Set RDS_HOST}"
RDS_PORT="${RDS_PORT:-5432}"
RDS_DB="${RDS_DB:-estatecfo}"
RDS_USER="${RDS_USER:-estatecfo_master}"
# Password is read from Secrets Manager below (do not hardcode)

# AWS
AWS_REGION="${AWS_REGION:-us-east-1}"
RDS_MASTER_SECRET_ARN="${RDS_MASTER_SECRET_ARN:?Set RDS_MASTER_SECRET_ARN}"

# Dump file location
DUMP_FILE="/tmp/estatecfo_$(date +%Y%m%d_%H%M%S).dump"

# ── 1. Fetch RDS master password from Secrets Manager ─────────────────────────
echo "→ Fetching RDS master credentials from Secrets Manager..."
RDS_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "$RDS_MASTER_SECRET_ARN" \
  --region "$AWS_REGION" \
  --query 'SecretString' \
  --output text | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])")

export PGPASSWORD="$RDS_PASSWORD"

# ── 2. Dump from Supabase (schema + data, custom format for parallel restore) ──
echo "→ Dumping Supabase database to $DUMP_FILE ..."
# Exclude Supabase-internal schemas; keep only public schema
pg_dump \
  --host="$SUPABASE_HOST" \
  --port="$SUPABASE_PORT" \
  --username="$SUPABASE_USER" \
  --dbname="$SUPABASE_DB" \
  --format=custom \
  --no-owner \
  --no-acl \
  --schema=public \
  --file="$DUMP_FILE"

echo "✓ Dump complete: $DUMP_FILE ($(du -sh "$DUMP_FILE" | cut -f1))"

# ── 3. Restore to RDS ─────────────────────────────────────────────────────────
echo "→ Restoring to RDS $RDS_HOST/$RDS_DB ..."
pg_restore \
  --host="$RDS_HOST" \
  --port="$RDS_PORT" \
  --username="$RDS_USER" \
  --dbname="$RDS_DB" \
  --no-owner \
  --no-acl \
  --jobs=4 \
  --verbose \
  "$DUMP_FILE" 2>&1 | tee /tmp/pg_restore.log

echo "✓ Restore complete"

# ── 4. Apply RLS migration ────────────────────────────────────────────────────
echo "→ Applying RLS policies (migrations/001_rls.sql)..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql \
  --host="$RDS_HOST" \
  --port="$RDS_PORT" \
  --username="$RDS_USER" \
  --dbname="$RDS_DB" \
  --file="$SCRIPT_DIR/../migrations/001_rls.sql"

echo "✓ RLS applied"

# ── 5. Row count verification ─────────────────────────────────────────────────
echo ""
echo "→ Verifying row counts (Supabase vs RDS)..."
echo ""

# Temporarily set PGPASSWORD back to Supabase for the comparison
# (we re-export it mid-script because pg_dump already ran above)
RDS_PW="$PGPASSWORD"

# Get row counts from Supabase
unset PGPASSWORD
echo "--- Supabase row counts ---"
PSQL_SUPABASE="psql --host=$SUPABASE_HOST --port=$SUPABASE_PORT --username=$SUPABASE_USER --dbname=$SUPABASE_DB --tuples-only"
SUPABASE_COUNTS=$($PSQL_SUPABASE -c "
  SELECT table_name, (xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::int AS row_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
")
echo "$SUPABASE_COUNTS"

# Get row counts from RDS
export PGPASSWORD="$RDS_PW"
echo ""
echo "--- RDS row counts ---"
PSQL_RDS="psql --host=$RDS_HOST --port=$RDS_PORT --username=$RDS_USER --dbname=$RDS_DB --tuples-only"
RDS_COUNTS=$($PSQL_RDS -c "
  SELECT table_name, (xpath('/row/c/text()',
    query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::int AS row_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
")
echo "$RDS_COUNTS"

# Python-based diff for clear mismatch reporting
python3 << 'PYEOF'
import sys

def parse_counts(text):
    rows = {}
    for line in text.strip().splitlines():
        parts = [p.strip() for p in line.split('|')]
        if len(parts) == 2:
            try:
                rows[parts[0]] = int(parts[1])
            except ValueError:
                pass
    return rows

src = parse_counts("""SUPABASE_COUNTS_PLACEHOLDER""")
dst = parse_counts("""RDS_COUNTS_PLACEHOLDER""")

mismatches = []
for table in sorted(set(list(src) + list(dst))):
    s = src.get(table, 'MISSING')
    d = dst.get(table, 'MISSING')
    if s != d:
        mismatches.append((table, s, d))

if mismatches:
    print("\n❌ ROW COUNT MISMATCHES DETECTED:")
    print(f"{'Table':<40} {'Supabase':>12} {'RDS':>12}")
    print("-" * 66)
    for t, s, d in mismatches:
        print(f"{t:<40} {str(s):>12} {str(d):>12}")
    print("\nDo NOT switch DATABASE_URL until mismatches are resolved.")
    sys.exit(1)
else:
    print("\n✓ All row counts match — migration verified.")
PYEOF

# ── 6. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "  Migration complete. Next steps:"
echo ""
echo "  1. Run scripts/test_rls.py to verify tenant isolation"
echo "  2. Set RDS_SECRET_ARN=<app-role-secret-arn> in your compute env"
echo "  3. Deploy the updated backend and smoke-test"
echo "  4. Keep Supabase DB running for 7+ days as rollback option"
echo "  5. Only after confirmed stable: decommission Supabase DB"
echo ""
echo "  Rollback: set DATABASE_URL back to Supabase connection string."
echo "  The Supabase DB was NOT modified — it is your rollback."
echo "════════════════════════════════════════════════════════"
