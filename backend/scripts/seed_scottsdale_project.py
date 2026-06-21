"""
Seed PR456 Scottsdale Promenade Center from canonical package JSON.

Source of truth: backend/data/PR456_full_data_package.json
(Replaces unverified placeholder seed — do not maintain a separate JSON file.)

Usage:
  cd backend
  python scripts/seed_scottsdale_project.py --tenant-id <uuid>
  python scripts/seed_scottsdale_project.py --tenant-id <uuid> --no-replace
"""
import argparse
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from scripts.scottsdale_import import (
    final_state_check,
    persist_scottsdale,
    prepare_seed_from_raw,
    verify_seed_data,
)


def seed_scottsdale(tenant_id: uuid.UUID, replace: bool = True) -> uuid.UUID:
    seed = prepare_seed_from_raw()
    db = SessionLocal()
    try:
        project_id = persist_scottsdale(db, tenant_id, seed, replace=replace)
        checks = verify_seed_data(seed)
        summary = final_state_check(db, tenant_id, project_id, seed, checks)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    master = seed["project_master"]
    print(f"Seeded {master['project_name']} ({master['project_code']}) -> {project_id}")
    print(f"  Address: {master['address']}")
    print(f"  SOV: ${summary['contract_value']:,.0f} | ROI: {summary['roi_verified']:.1%} | "
          f"MOIC: {summary['moic_verified']:.2f}x")
    print(f"  Counts: {summary['divisions']} divisions, {summary['permits']} permits, "
          f"{summary['change_orders']} COs, {summary['schedule_tasks']} schedule, "
          f"{summary['compliance_docs']} compliance")
    return project_id


def main():
    parser = argparse.ArgumentParser(description="Seed PR456 Scottsdale Promenade Center")
    parser.add_argument("--tenant-id", required=True, help="Tenant UUID")
    parser.add_argument(
        "--replace",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Replace existing PR456 / purge stale placeholder (default: true)",
    )
    args = parser.parse_args()
    seed_scottsdale(uuid.UUID(args.tenant_id), replace=args.replace)


if __name__ == "__main__":
    main()
