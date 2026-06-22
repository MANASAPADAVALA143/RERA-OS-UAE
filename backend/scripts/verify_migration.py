"""
EstateCFO — Post-migration row-count verifier.

Connects to both Supabase (source) and RDS (destination) and compares
row counts for every table in the public schema. Exits 1 if any mismatch.

Usage:
    python scripts/verify_migration.py

Environment variables:
    SUPABASE_URL     — full psycopg2 connection URL for the Supabase DB
    RDS_SECRET_ARN   — Secrets Manager ARN for the RDS master credentials
                       (or set DATABASE_URL for a direct URL)
    AWS_REGION       — default: us-east-1
"""
from __future__ import annotations

import os
import sys
from typing import Dict


def get_row_counts(conn_str: str, label: str) -> Dict[str, int]:
    """Return {table_name: row_count} for all base tables in public schema."""
    import psycopg2

    conn = psycopg2.connect(conn_str)
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        tables = [row[0] for row in cur.fetchall()]

        counts: Dict[str, int] = {}
        for table in tables:
            cur.execute(f"SELECT COUNT(*) FROM public.{table}")  # noqa: S608
            counts[table] = cur.fetchone()[0]

        print(f"\n{label} — {len(tables)} tables")
        return counts
    finally:
        conn.close()


def resolve_rds_url() -> str:
    """Resolve RDS connection URL from Secrets Manager or direct env var."""
    direct = os.environ.get("DATABASE_URL", "")
    if direct:
        return direct

    arn = os.environ.get("RDS_SECRET_ARN", "")
    if not arn:
        sys.exit("Set DATABASE_URL or RDS_SECRET_ARN to connect to RDS.")

    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from services.secrets_manager import build_database_url_from_secret
    url = build_database_url_from_secret(arn)
    if not url:
        sys.exit(f"Could not build RDS URL from secret {arn}")
    return url


def main() -> None:
    supabase_url = os.environ.get("SUPABASE_URL", "")
    if not supabase_url:
        sys.exit("Set SUPABASE_URL to the Supabase connection string.")

    rds_url = resolve_rds_url()

    print("Connecting to Supabase...")
    source = get_row_counts(supabase_url, "Supabase (source)")

    print("Connecting to RDS...")
    dest = get_row_counts(rds_url, "RDS (destination)")

    # Compare
    all_tables = sorted(set(list(source) + list(dest)))
    mismatches: list[tuple] = []

    print(f"\n{'Table':<45} {'Supabase':>10} {'RDS':>10} {'Match':>6}")
    print("-" * 75)
    for table in all_tables:
        s = source.get(table, "MISSING")
        d = dest.get(table, "MISSING")
        match = "✓" if s == d else "✗ MISMATCH"
        print(f"{table:<45} {str(s):>10} {str(d):>10} {match:>6}")
        if s != d:
            mismatches.append((table, s, d))

    print("-" * 75)
    if mismatches:
        print(f"\n❌ {len(mismatches)} mismatch(es) found. Do NOT switch traffic to RDS yet.")
        for table, s, d in mismatches:
            print(f"   {table}: Supabase={s}, RDS={d}")
        sys.exit(1)
    else:
        print(f"\n✓ All {len(all_tables)} tables match. Migration verified.")
        print("  Safe to update RDS_SECRET_ARN and redeploy the backend.")


if __name__ == "__main__":
    main()
