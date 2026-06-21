"""Shared helpers for REIT routers."""
import uuid
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.reit.financials import ReitLoan, ReitOperatingExpense
from models.reit.property import ReitProperty, ReitPropertyStatus
from models.reit.unit import ReitUnit
from services.reit_calculations import (
    days_vacant,
    financial_strength,
    property_occupancy,
    property_pl_summary,
    unit_rental_loss,
)


def require_property(db: Session, tenant_id, property_id: uuid.UUID) -> ReitProperty:
    prop = (
        db.query(ReitProperty)
        .filter(ReitProperty.id == property_id, ReitProperty.tenant_id == tenant_id)
        .first()
    )
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    return prop


def property_dict(p: ReitProperty) -> dict:
    return {
        "id": str(p.id),
        "property_code": p.property_code,
        "property_name": p.property_name,
        "address": p.address,
        "city": p.city,
        "state": p.state,
        "zip_code": p.zip_code,
        "asset_class": p.asset_class.value,
        "total_units": p.total_units,
        "acquisition_date": p.acquisition_date.isoformat() if p.acquisition_date else None,
        "acquisition_price": float(p.acquisition_price) if p.acquisition_price is not None else None,
        "current_market_value_estimate": float(p.current_market_value_estimate) if p.current_market_value_estimate is not None else None,
        "current_market_value_as_of": p.current_market_value_as_of.isoformat() if p.current_market_value_as_of else None,
        "green_certification": p.green_certification.value if p.green_certification else None,
        "insurance_coverage_amount": float(p.insurance_coverage_amount) if p.insurance_coverage_amount is not None else None,
        "insurance_renewal_date": p.insurance_renewal_date.isoformat() if p.insurance_renewal_date else None,
        "min_buffer_target": float(p.min_buffer_target),
        "status": p.status.value,
    }


def loan_dict(loan: ReitLoan | None) -> dict | None:
    if not loan:
        return None
    return {
        "id": str(loan.id),
        "lender_name": loan.lender_name,
        "original_loan_amount": float(loan.original_loan_amount),
        "current_principal_balance": float(loan.current_principal_balance),
        "interest_rate_annual": float(loan.interest_rate_annual),
        "rate_type": loan.rate_type.value,
        "origination_date": loan.origination_date.isoformat() if loan.origination_date else None,
        "maturity_date": loan.maturity_date.isoformat() if loan.maturity_date else None,
        "amortization_years": loan.amortization_years,
        "monthly_principal": float(loan.monthly_principal),
        "monthly_interest": float(loan.monthly_interest),
        "ltv_at_origination": float(loan.ltv_at_origination) if loan.ltv_at_origination is not None else None,
    }


def unit_rows(db: Session, tenant_id, property_id: uuid.UUID, today: date | None = None) -> list[dict]:
    today = today or date.today()
    units = (
        db.query(ReitUnit)
        .filter(ReitUnit.tenant_id == tenant_id, ReitUnit.property_id == property_id)
        .order_by(ReitUnit.unit_number)
        .all()
    )
    rows = []
    for u in units:
        status = u.status.value
        rows.append({
            "id": str(u.id),
            "unit_number": u.unit_number,
            "unit_type": u.unit_type,
            "sqft": float(u.sqft) if u.sqft is not None else None,
            "market_rent": float(u.market_rent),
            "status": status,
            "tenant_name": u.tenant_name,
            "actual_rent": float(u.actual_rent) if u.actual_rent is not None else None,
            "lease_start": u.lease_start.isoformat() if u.lease_start else None,
            "lease_end": u.lease_end.isoformat() if u.lease_end else None,
            "status_changed_at": u.status_changed_at.isoformat() if u.status_changed_at else None,
            "rental_loss_monthly": round(unit_rental_loss(u.market_rent, u.actual_rent, status), 2),
            "days_vacant": days_vacant(status, u.status_changed_at, today),
        })
    return rows


def latest_opex_period(db: Session, tenant_id, property_id: uuid.UUID) -> date | None:
    row = (
        db.query(ReitOperatingExpense.period_month)
        .filter(
            ReitOperatingExpense.tenant_id == tenant_id,
            ReitOperatingExpense.property_id == property_id,
        )
        .order_by(ReitOperatingExpense.period_month.desc())
        .first()
    )
    return row[0] if row else None


def opex_rows_for_period(db: Session, tenant_id, property_id: uuid.UUID, period: date) -> list[dict]:
    rows = (
        db.query(ReitOperatingExpense)
        .filter(
            ReitOperatingExpense.tenant_id == tenant_id,
            ReitOperatingExpense.property_id == property_id,
            ReitOperatingExpense.period_month == period,
        )
        .all()
    )
    return [
        {
            "id": str(r.id),
            "period_month": r.period_month.isoformat(),
            "category": r.category.value,
            "sub_head": r.sub_head,
            "monthly_amount": float(r.monthly_amount),
        }
        for r in rows
    ]


def compute_property_snapshot(db: Session, prop: ReitProperty, period: date | None = None) -> dict:
    period = period or latest_opex_period(db, prop.tenant_id, prop.id)
    units = unit_rows(db, prop.tenant_id, prop.id)
    unit_dicts = [
        {
            "market_rent": u["market_rent"],
            "actual_rent": u["actual_rent"],
            "status": u["status"],
        }
        for u in units
    ]
    opex = opex_rows_for_period(db, prop.tenant_id, prop.id, period) if period else []
    loan = db.query(ReitLoan).filter(ReitLoan.property_id == prop.id).first()
    loan_d = loan_dict(loan)

    occ = property_occupancy(unit_dicts)
    pl = property_pl_summary(unit_dicts, opex, loan_d) if period else {}
    strength = financial_strength(property_dict(prop), pl.get("net_operating_income", 0), loan_d) if pl else {}

    return {
        "property_id": str(prop.id),
        "property_code": prop.property_code,
        "property_name": prop.property_name,
        "asset_class": prop.asset_class.value,
        "period_month": period.isoformat() if period else None,
        "occupied_units": occ["occupied_units"],
        "total_units": occ["total_units"],
        "occupancy_pct": occ["occupancy_pct"],
        "market_value": float(prop.current_market_value_estimate) if prop.current_market_value_estimate else None,
        **pl,
        **{k: strength.get(k) for k in (
            "cap_rate_on_current_value", "dscr", "dscr_status", "current_ltv", "equity_value", "annual_noi"
        )},
        "cap_rate": strength.get("cap_rate_on_current_value"),
    }


def active_properties_query(db: Session, tenant_id, status: str | None = None, asset_class: str | None = None):
    q = db.query(ReitProperty).filter(ReitProperty.tenant_id == tenant_id)
    if status:
        q = q.filter(ReitProperty.status == ReitPropertyStatus(status))
    else:
        q = q.filter(ReitProperty.status != ReitPropertyStatus.sold)
    if asset_class:
        from models.reit.property import ReitPropertyAssetClass
        q = q.filter(ReitProperty.asset_class == ReitPropertyAssetClass(asset_class))
    return q.order_by(ReitProperty.property_name)
