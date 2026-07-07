#!/usr/bin/env python3
"""Run KPI cross-check for all companies — independent recompute vs live display logic.

Usage:
  cd backend
  python scripts/kpi_cross_check.py
  python scripts/kpi_cross_check.py --period YTD --month 6 --year 2026
  python scripts/kpi_cross_check.py --output reports/kpi_audit.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import Base, SessionLocal, engine
from models.tenancy import Tenant
from services.kpi_sanity_check import format_console_report, run_tenant_audit

# Ensure models are registered
import models.rentals.kpi_audit  # noqa: F401
import models.rentals.models  # noqa: F401


def main() -> int:
    parser = argparse.ArgumentParser(description="KPI cross-check for all rental companies")
    parser.add_argument("--period", choices=["MoM", "YTD", "TTM"], default=None)
    parser.add_argument("--month", type=int, default=6)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--tenant-id", default=None, help="UUID; defaults to first tenant")
    parser.add_argument("--output", default=None, help="Save JSON report to path")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        Base.metadata.create_all(bind=engine)

        tid = args.tenant_id
        if not tid:
            tenant = db.query(Tenant).first()
            if not tenant:
                print("No tenants in database.")
                return 1
            tid = str(tenant.id)

        payload = run_tenant_audit(
            db,
            tid,
            period=args.period,
            month=args.month,
            year=args.year,
            triggered_by="script",
        )
        report = format_console_report(payload)
        print(report)

        if args.output:
            out = Path(args.output)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            txt_path = out.with_suffix(".txt")
            txt_path.write_text(report, encoding="utf-8")
            print(f"\nSaved: {out} and {txt_path}")

        summary = payload.get("summary", {})
        return 1 if summary.get("total_mismatches", 0) or summary.get("total_check_logic", 0) else 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
