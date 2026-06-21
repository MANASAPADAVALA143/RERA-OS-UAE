"""
Seed RP001 — Desert Vista Townhomes REIT income property from JSON.

Usage:
  cd backend
  python scripts/seed_reit_property.py --tenant-id <uuid>
  python scripts/seed_reit_property.py --tenant-id <uuid> --replace
"""
import argparse
import json
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import SessionLocal
from models.reit.financials import (
    ReitCashFlowWeek,
    ReitLoan,
    ReitOperatingExpense,
    ReitOpexCategory,
    ReitOwnership,
    ReitPartnerRole,
    ReitRateType,
)
from models.reit.property import (
    ReitGreenCertification,
    ReitProperty,
    ReitPropertyAssetClass,
    ReitPropertyStatus,
)
from models.reit.unit import ReitUnit, ReitUnitStatus
from models.tenancy import Tenant
from services.rp001_verify import verify_rp001_metrics

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "desert_vista_rp001.json"


def _parse_date(val: str | None) -> date | None:
    if not val:
        return None
    return date.fromisoformat(val)


def load_data() -> dict:
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)


def require_tenant(db, tenant_id: uuid.UUID) -> Tenant:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        print(f"ERROR: Tenant {tenant_id} not found.")
        sys.exit(1)
    return tenant


def delete_existing(db, tenant_id: uuid.UUID, property_code: str) -> None:
    prop = (
        db.query(ReitProperty)
        .filter(ReitProperty.tenant_id == tenant_id, ReitProperty.property_code == property_code)
        .first()
    )
    if not prop:
        return
    pid = prop.id
    db.query(ReitCashFlowWeek).filter(ReitCashFlowWeek.property_id == pid).delete()
    db.query(ReitOwnership).filter(ReitOwnership.property_id == pid).delete()
    db.query(ReitLoan).filter(ReitLoan.property_id == pid).delete()
    db.query(ReitOperatingExpense).filter(ReitOperatingExpense.property_id == pid).delete()
    db.query(ReitUnit).filter(ReitUnit.property_id == pid).delete()
    db.delete(prop)
    db.commit()


def seed_property(db, tenant_id: uuid.UUID, data: dict, replace: bool) -> ReitProperty:
    if replace:
        delete_existing(db, tenant_id, data["property_code"])

    existing = (
        db.query(ReitProperty)
        .filter(ReitProperty.tenant_id == tenant_id, ReitProperty.property_code == data["property_code"])
        .first()
    )
    if existing:
        print(f"Property {data['property_code']} already exists (id={existing.id}). Use --replace to recreate.")
        return existing

    prop = ReitProperty(
        tenant_id=tenant_id,
        property_code=data["property_code"],
        property_name=data["property_name"],
        address=data.get("address"),
        city=data.get("city"),
        state=data.get("state"),
        zip_code=data.get("zip_code"),
        asset_class=ReitPropertyAssetClass(data["asset_class"]),
        total_units=data["total_units"],
        acquisition_date=_parse_date(data.get("acquisition_date")),
        acquisition_price=data.get("acquisition_price"),
        current_market_value_estimate=data.get("current_market_value_estimate"),
        current_market_value_as_of=_parse_date(data.get("current_market_value_as_of")),
        green_certification=ReitGreenCertification(data["green_certification"]) if data.get("green_certification") else None,
        insurance_coverage_amount=data.get("insurance_coverage_amount"),
        insurance_renewal_date=_parse_date(data.get("insurance_renewal_date")),
        min_buffer_target=data.get("min_buffer_target", 15000),
        status=ReitPropertyStatus(data.get("status", "active")),
        created_by="seed_reit_property.py",
    )
    db.add(prop)
    db.flush()

    for u in data["units"]:
        db.add(
            ReitUnit(
                tenant_id=tenant_id,
                property_id=prop.id,
                unit_number=u["unit_number"],
                unit_type=u["unit_type"],
                sqft=u.get("sqft"),
                market_rent=u["market_rent"],
                status=ReitUnitStatus(u["status"]),
                tenant_name=u.get("tenant_name"),
                actual_rent=u.get("actual_rent"),
                lease_start=_parse_date(u.get("lease_start")),
                lease_end=_parse_date(u.get("lease_end")),
                status_changed_at=_parse_date(u.get("status_changed_at")),
            )
        )

    period = _parse_date(data["opex_period"])
    for line in data["operating_expenses"]:
        db.add(
            ReitOperatingExpense(
                tenant_id=tenant_id,
                property_id=prop.id,
                period_month=period,
                category=ReitOpexCategory(line["category"]),
                sub_head=line["sub_head"],
                monthly_amount=line["monthly_amount"],
            )
        )

    loan = data["loan"]
    db.add(
        ReitLoan(
            tenant_id=tenant_id,
            property_id=prop.id,
            lender_name=loan["lender_name"],
            original_loan_amount=loan["original_loan_amount"],
            current_principal_balance=loan["current_principal_balance"],
            interest_rate_annual=loan["interest_rate_annual"],
            rate_type=ReitRateType(loan["rate_type"]),
            origination_date=_parse_date(loan.get("origination_date")),
            maturity_date=_parse_date(loan.get("maturity_date")),
            amortization_years=loan.get("amortization_years"),
            monthly_principal=loan["monthly_principal"],
            monthly_interest=loan["monthly_interest"],
            ltv_at_origination=loan.get("ltv_at_origination"),
        )
    )

    for row in data["ownership"]:
        db.add(
            ReitOwnership(
                tenant_id=tenant_id,
                property_id=prop.id,
                partner_name=row["partner_name"],
                role=ReitPartnerRole(row["role"]),
                ownership_pct=row["ownership_pct"],
                capital_contributed=row.get("capital_contributed"),
                preferred_return_pct=row.get("preferred_return_pct"),
            )
        )

    for w in data["cash_flow_weeks"]:
        db.add(
            ReitCashFlowWeek(
                tenant_id=tenant_id,
                property_id=prop.id,
                week_number=w["week_number"],
                week_start_date=_parse_date(w["week_start_date"]),
                opening_balance=w["opening_balance"],
                inflows=w["inflows"],
                outflows=w["outflows"],
                alert_note=w.get("alert_note"),
            )
        )

    db.commit()
    db.refresh(prop)
    return prop


def verify(prop_data: dict, units: list, opex: list, loan: dict) -> None:
    result = verify_rp001_metrics(raise_on_fail=True)
    print("\n--- Verification ---")
    print(f"Occupancy: {result['occupied_units']}/{result['total_units']} = {result['occupancy_pct']:.1%}")
    print(f"Opex (monthly): ${result['opex_total']:,.2f}")
    print(f"EGI (monthly): ${result['egi']:,.2f}")
    print(f"NOI (monthly): ${result['noi']:,.2f}")
    print(f"DSCR: {result['dscr']:.2f}x ({result['dscr_status']})")
    print(f"CFADS: ${result['cfads']:,.2f}")


def main():
    parser = argparse.ArgumentParser(description="Seed RP001 Desert Vista Townhomes")
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()

    tenant_id = uuid.UUID(args.tenant_id)
    data = load_data()
    db = SessionLocal()
    try:
        require_tenant(db, tenant_id)
        prop = seed_property(db, tenant_id, data, args.replace)
        print(f"Seeded {data['property_code']} — {data['property_name']} (id={prop.id})")
        verify({}, [], [], {})
    finally:
        db.close()


if __name__ == "__main__":
    main()
