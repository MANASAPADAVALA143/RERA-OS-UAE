"""
EstateCFO — RLS isolation test.

Connects DIRECTLY to the RDS Postgres as the app role (estatecfo_app)
and verifies that Row-Level Security is enforced at the database level,
independent of application code.

Tests:
  1. With tenant_id set   → sees only that tenant's rows
  2. Without tenant_id    → sees zero rows (not an error, not all rows)
  3. With wrong tenant_id → sees zero rows from the other tenant

This is the test the spec calls "5b" — the proof that RLS actually works.

Usage:
    RDS_APP_URL="postgresql+psycopg2://estatecfo_app:pw@host/estatecfo" \\
    python scripts/test_rls.py

Or set RDS_SECRET_ARN and the script fetches credentials automatically.
"""
from __future__ import annotations

import os
import sys
import uuid

# ── Table to test (has tenant_id, gets meaningful row counts) ─────────────────
TEST_TABLE = "tenant_users"  # always has at least one row per tenant
# You can override: TEST_TABLE = "audit_logs"


def get_conn(dsn: str):
    import psycopg2
    return psycopg2.connect(dsn)


def count_rows(cur, table: str) -> int:
    cur.execute(f"SELECT COUNT(*) FROM public.{table}")   # noqa: S608
    return cur.fetchone()[0]


def resolve_app_url() -> str:
    direct = os.environ.get("RDS_APP_URL", "")
    if direct:
        return direct

    arn = os.environ.get("RDS_SECRET_ARN", "")
    if not arn:
        sys.exit(
            "Set RDS_APP_URL (connection URL for the estatecfo_app role) "
            "or RDS_SECRET_ARN to auto-fetch credentials."
        )
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
    from services.secrets_manager import build_database_url_from_secret
    url = build_database_url_from_secret(arn)
    if not url:
        sys.exit(f"Could not build URL from {arn}")
    return url


def get_tenant_ids(master_url: str) -> list[str]:
    """Fetch tenant IDs via the master connection (bypasses RLS)."""
    import psycopg2
    conn = psycopg2.connect(master_url)
    try:
        cur = conn.cursor()
        cur.execute("SELECT id FROM public.tenants LIMIT 3")
        return [str(row[0]) for row in cur.fetchall()]
    finally:
        conn.close()


def main() -> None:
    app_url = resolve_app_url()
    master_url = os.environ.get(
        "RDS_MASTER_URL",
        os.environ.get("DATABASE_URL", app_url),  # fallback
    )

    print("EstateCFO RLS Test")
    print("=" * 60)
    print(f"App role URL: {app_url.split('@')[1] if '@' in app_url else app_url}")
    print(f"Test table:   {TEST_TABLE}")
    print()

    # Fetch real tenant IDs to test with
    print("Fetching tenant IDs from master connection...")
    tenant_ids = get_tenant_ids(master_url)
    if not tenant_ids:
        sys.exit("No tenants in database — run seed scripts first.")

    tenant_a = tenant_ids[0]
    tenant_b = tenant_ids[1] if len(tenant_ids) > 1 else None
    print(f"Tenant A: {tenant_a}")
    print(f"Tenant B: {tenant_b or '(only one tenant)'}")
    print()

    failures: list[str] = []
    conn = get_conn(app_url)
    conn.autocommit = False

    try:
        # ── Test 1: No tenant_id set → expect 0 rows ────────────────────────
        print("Test 1: Query WITHOUT setting app.current_tenant_id")
        try:
            cur = conn.cursor()
            # Deliberately do NOT set the tenant context
            n = count_rows(cur, TEST_TABLE)
            if n == 0:
                print(f"  ✓ PASS — returned 0 rows (RLS blocked correctly)")
            else:
                msg = f"  ✗ FAIL — returned {n} rows without tenant context (RLS not enforced!)"
                print(msg)
                failures.append(msg)
        except Exception as e:
            # Some Postgres configs raise an error on missing setting — also acceptable
            if "current_setting" in str(e).lower() or "unrecognized" in str(e).lower():
                print(f"  ✓ PASS — query raised an error (RLS blocked via missing setting): {e}")
            else:
                msg = f"  ✗ FAIL — unexpected error: {e}"
                print(msg)
                failures.append(msg)
        finally:
            conn.rollback()

        # ── Test 2: Set tenant A → see only tenant A's rows ─────────────────
        print(f"\nTest 2: Query with app.current_tenant_id = Tenant A")
        cur = conn.cursor()
        cur.execute("SET LOCAL app.current_tenant_id = %s", (tenant_a,))
        count_a = count_rows(cur, TEST_TABLE)
        print(f"  Tenant A row count: {count_a}")
        if count_a > 0:
            print(f"  ✓ PASS — Tenant A sees {count_a} row(s)")
        else:
            msg = f"  ✗ FAIL — Tenant A sees 0 rows (should see at least their own data)"
            print(msg)
            failures.append(msg)
        conn.rollback()

        # ── Test 3: Isolation between tenants ────────────────────────────────
        if tenant_b:
            print(f"\nTest 3: Tenant B cannot see Tenant A's rows")
            cur = conn.cursor()
            cur.execute("SET LOCAL app.current_tenant_id = %s", (tenant_b,))
            count_b_sees_a = count_rows(cur, TEST_TABLE)
            # Verify count_b_sees_a is NOT the same as count_a rows
            # (Since Tenant B's count refers only to B's rows, not A's)
            cur.execute("SET LOCAL app.current_tenant_id = %s", (tenant_a,))
            count_a_rows = count_rows(cur, TEST_TABLE)
            conn.rollback()

            cur = conn.cursor()
            cur.execute("SET LOCAL app.current_tenant_id = %s", (tenant_b,))
            count_b_rows = count_rows(cur, TEST_TABLE)
            conn.rollback()

            # The cross-check: if Tenant B set as context returns different count than A
            # and neither can see the other's rows, test passes
            if count_a_rows != count_b_rows or count_b_rows > 0:
                print(f"  Tenant A rows: {count_a_rows}, Tenant B rows: {count_b_rows}")

            # Try: set Tenant A context, look for Tenant B's rows
            cur = conn.cursor()
            cur.execute("SET LOCAL app.current_tenant_id = %s", (tenant_a,))
            cur.execute(
                f"SELECT COUNT(*) FROM public.{TEST_TABLE} WHERE tenant_id = %s",  # noqa: S608
                (tenant_b,)
            )
            cross_count = cur.fetchone()[0]
            conn.rollback()

            if cross_count == 0:
                print(f"  ✓ PASS — Tenant A context sees 0 of Tenant B's rows (cross-tenant blocked)")
            else:
                msg = f"  ✗ FAIL — Tenant A context can see {cross_count} of Tenant B's rows!"
                print(msg)
                failures.append(msg)
        else:
            print("\nTest 3: Skipped (only one tenant in database)")

        # ── Test 4: Bogus UUID → 0 rows ───────────────────────────────────────
        print(f"\nTest 4: Query with a nonexistent tenant_id → expect 0 rows")
        cur = conn.cursor()
        fake_id = str(uuid.uuid4())
        cur.execute("SET LOCAL app.current_tenant_id = %s", (fake_id,))
        n_fake = count_rows(cur, TEST_TABLE)
        conn.rollback()
        if n_fake == 0:
            print(f"  ✓ PASS — bogus tenant_id returns 0 rows")
        else:
            msg = f"  ✗ FAIL — bogus tenant_id returned {n_fake} rows!"
            print(msg)
            failures.append(msg)

    finally:
        conn.close()

    # ── Summary ────────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    if failures:
        print(f"❌ {len(failures)} test(s) FAILED:")
        for f in failures:
            print(f"   {f}")
        print()
        print("RLS is NOT fully enforced. Do not deploy to production.")
        sys.exit(1)
    else:
        print("✓ All RLS tests passed.")
        print("  Database-level tenant isolation is confirmed.")


if __name__ == "__main__":
    main()
