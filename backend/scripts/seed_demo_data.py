"""
One-shot demo-data seeder for all four modules.

Runs every module's existing seed routine against the demo tenant so a fresh
database shows realistic numbers everywhere (no $0, no blank charts):

  * Rental & Lease   — scripts/seed_rentals.seed()
  * Construction/Dev  — scripts/seed_scottsdale_project.seed_scottsdale()
                        + pay applications, expenses, loans, task schedule
  * Property Dev      — routers/propdev/seed_wwbg.seed_wwbg()  (WWBG land deal)
  * Consultancy       — no DB seed needed; the Consultancy module ships with
                        deterministic in-app demo data (frontend context).

Usage (from backend/):
    python scripts/seed_demo_data.py
    python scripts/seed_demo_data.py --tenant-id <uuid>

Idempotent: each underlying seed skips or replaces its own rows.
"""
import argparse
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Importing main registers every SQLAlchemy model so cross-module
# relationships (e.g. Project -> Unit) resolve during seeding.
import main  # noqa: F401,E402

from database import SessionLocal  # noqa: E402
from middleware.auth import CurrentUser  # noqa: E402
from models.tenancy import TenantUser, UserRole  # noqa: E402
from services.local_auth import DEMO_EMAIL  # noqa: E402


def _resolve_tenant_id(explicit: str | None) -> str:
    if explicit:
        return explicit
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            sys.exit(
                f"No demo tenant found for {DEMO_EMAIL}. Start the API once to "
                "bootstrap it, or pass --tenant-id explicitly."
            )
        return str(user.tenant_id)
    finally:
        db.close()


def main_seed() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", default=None, help="Target tenant UUID (defaults to the demo tenant)")
    args = parser.parse_args()

    tenant_id = _resolve_tenant_id(args.tenant_id)
    print(f"Seeding demo data for tenant {tenant_id}\n")

    # ── Rental & Lease ────────────────────────────────────────────────────────
    print("Rental & Lease ...")
    from scripts.seed_rentals import seed as seed_rentals
    seed_rentals()

    # ── Construction / Development ────────────────────────────────────────────
    print("\nConstruction / Development ...")
    from scripts.seed_scottsdale_project import seed_scottsdale
    seed_scottsdale(uuid.UUID(str(tenant_id)), replace=True)
    from scripts.seed_pay_apps_expenses import seed as seed_pay_apps
    seed_pay_apps()
    from scripts.seed_loans import seed as seed_loans
    seed_loans()
    from scripts.seed_task_schedule import seed as seed_tasks
    seed_tasks()

    # ── Property Dev ─────────────────────────────────────────────────────────
    print("\nProperty Dev (WWBG land deal) ...")
    from routers.propdev.seed_wwbg import seed_wwbg
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        fake_user = CurrentUser(
            user_id=str(user.supabase_user_id) if user else "seed-script",
            tenant_id=uuid.UUID(str(tenant_id)),
            role=UserRole.owner,
            email=DEMO_EMAIL,
        )
        result = seed_wwbg(current_user=fake_user, db=db)
        print(f"  {result['status']}: {result['company']} — "
              f"loan balance ${result['loan_balance']:,.0f}, {result['partners_added']} partners")
    finally:
        db.close()

    print("\nDone. Consultancy needs no DB seed — it ships with in-app demo data.")


if __name__ == "__main__":
    main_seed()
