import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.reit.financials import ReitLoan, ReitOperatingExpense, ReitOwnership, ReitOpexCategory, ReitPartnerRole, ReitRateType
from routers.reit._helpers import (
    compute_property_snapshot,
    latest_opex_period,
    loan_dict,
    opex_rows_for_period,
    property_dict,
    require_property,
    unit_rows,
)
from services.reit_calculations import (
    distribute_to_partners,
    financial_strength,
    property_pl_summary as calc_pl,
)

router = APIRouter(prefix="/api/reit", tags=["reit"])


class OpexLineCreate(BaseModel):
    category: str
    sub_head: str
    monthly_amount: float


class OpexPeriodCreate(BaseModel):
    period_month: date
    lines: list[OpexLineCreate]


class LoanCreate(BaseModel):
    lender_name: str
    original_loan_amount: float
    current_principal_balance: float
    interest_rate_annual: float
    rate_type: str
    origination_date: date | None = None
    maturity_date: date | None = None
    amortization_years: int | None = None
    monthly_principal: float
    monthly_interest: float
    ltv_at_origination: float | None = None


class OwnershipRow(BaseModel):
    partner_name: str
    role: str
    ownership_pct: float = Field(..., ge=0, le=1)
    capital_contributed: float | None = None
    preferred_return_pct: float | None = None


class OwnershipBulk(BaseModel):
    rows: list[OwnershipRow]


def _parse_period(period: str | None, db: Session, tenant_id, property_id: uuid.UUID) -> date:
    if period:
        try:
            parts = period.split("-")
            return date(int(parts[0]), int(parts[1]), 1)
        except (ValueError, IndexError) as exc:
            raise HTTPException(status_code=400, detail="period must be YYYY-MM") from exc
    latest = latest_opex_period(db, tenant_id, property_id)
    if not latest:
        raise HTTPException(status_code=404, detail="No operating expense period found")
    return latest


def _load_pl_context(db: Session, tenant_id, property_id: uuid.UUID, period: date) -> tuple[list, list, dict | None]:
    units = unit_rows(db, tenant_id, property_id)
    unit_dicts = [{"market_rent": u["market_rent"], "actual_rent": u["actual_rent"], "status": u["status"]} for u in units]
    opex = opex_rows_for_period(db, tenant_id, property_id, period)
    loan = db.query(ReitLoan).filter(ReitLoan.property_id == property_id, ReitLoan.tenant_id == tenant_id).first()
    return unit_dicts, opex, loan_dict(loan)


@router.get("/properties/{property_id}/pl-summary")
def get_pl_summary(
    property_id: uuid.UUID,
    period: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    prop = require_property(db, current_user.tenant_id, property_id)
    period_date = _parse_period(period, db, current_user.tenant_id, property_id)
    unit_dicts, opex, loan_d = _load_pl_context(db, current_user.tenant_id, property_id, period_date)
    return {
        "property_id": str(property_id),
        "period_month": period_date.isoformat(),
        **calc_pl(unit_dicts, opex, loan_d),
    }


@router.get("/properties/{property_id}/opex")
def get_opex(
    property_id: uuid.UUID,
    period: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    require_property(db, current_user.tenant_id, property_id)
    period_date = _parse_period(period, db, current_user.tenant_id, property_id)
    return {
        "period_month": period_date.isoformat(),
        "lines": opex_rows_for_period(db, current_user.tenant_id, property_id, period_date),
    }


@router.post("/properties/{property_id}/opex")
def post_opex(
    property_id: uuid.UUID,
    body: OpexPeriodCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    require_property(db, current_user.tenant_id, property_id)
    period = date(body.period_month.year, body.period_month.month, 1)
    existing = (
        db.query(ReitOperatingExpense)
        .filter(
            ReitOperatingExpense.tenant_id == current_user.tenant_id,
            ReitOperatingExpense.property_id == property_id,
            ReitOperatingExpense.period_month == period,
        )
        .count()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Expense rows already exist for this period")

    created = []
    for line in body.lines:
        row = ReitOperatingExpense(
            tenant_id=current_user.tenant_id,
            property_id=property_id,
            period_month=period,
            category=ReitOpexCategory(line.category),
            sub_head=line.sub_head,
            monthly_amount=line.monthly_amount,
        )
        db.add(row)
        created.append(row)
    db.commit()
    return {
        "period_month": period.isoformat(),
        "lines": opex_rows_for_period(db, current_user.tenant_id, property_id, period),
    }


@router.get("/properties/{property_id}/loan")
def get_loan(
    property_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    require_property(db, current_user.tenant_id, property_id)
    loan = db.query(ReitLoan).filter(ReitLoan.property_id == property_id).first()
    return loan_dict(loan)


@router.post("/properties/{property_id}/loan")
def create_loan(
    property_id: uuid.UUID,
    body: LoanCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    require_property(db, current_user.tenant_id, property_id)
    existing = db.query(ReitLoan).filter(ReitLoan.property_id == property_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Loan already exists for this property")
    loan = ReitLoan(
        tenant_id=current_user.tenant_id,
        property_id=property_id,
        lender_name=body.lender_name,
        original_loan_amount=body.original_loan_amount,
        current_principal_balance=body.current_principal_balance,
        interest_rate_annual=body.interest_rate_annual,
        rate_type=ReitRateType(body.rate_type),
        origination_date=body.origination_date,
        maturity_date=body.maturity_date,
        amortization_years=body.amortization_years,
        monthly_principal=body.monthly_principal,
        monthly_interest=body.monthly_interest,
        ltv_at_origination=body.ltv_at_origination,
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return loan_dict(loan)


@router.put("/properties/{property_id}/loan")
def update_loan(
    property_id: uuid.UUID,
    body: LoanCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    require_property(db, current_user.tenant_id, property_id)
    loan = db.query(ReitLoan).filter(ReitLoan.property_id == property_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    loan.lender_name = body.lender_name
    loan.original_loan_amount = body.original_loan_amount
    loan.current_principal_balance = body.current_principal_balance
    loan.interest_rate_annual = body.interest_rate_annual
    loan.rate_type = ReitRateType(body.rate_type)
    loan.origination_date = body.origination_date
    loan.maturity_date = body.maturity_date
    loan.amortization_years = body.amortization_years
    loan.monthly_principal = body.monthly_principal
    loan.monthly_interest = body.monthly_interest
    loan.ltv_at_origination = body.ltv_at_origination
    db.commit()
    return loan_dict(loan)


@router.get("/properties/{property_id}/ownership")
def get_ownership(
    property_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    prop = require_property(db, current_user.tenant_id, property_id)
    rows = (
        db.query(ReitOwnership)
        .filter(ReitOwnership.property_id == property_id, ReitOwnership.tenant_id == current_user.tenant_id)
        .all()
    )
    ownership = [
        {
            "id": str(r.id),
            "partner_name": r.partner_name,
            "role": r.role.value,
            "ownership_pct": float(r.ownership_pct),
            "capital_contributed": float(r.capital_contributed) if r.capital_contributed is not None else None,
            "preferred_return_pct": float(r.preferred_return_pct) if r.preferred_return_pct is not None else None,
        }
        for r in rows
    ]
    snap = compute_property_snapshot(db, prop)
    cfads = snap.get("cash_flow_after_debt_service", 0) or 0
    distributions = distribute_to_partners(cfads, ownership)
    return {
        "ownership": ownership,
        "cash_flow_after_debt_service": cfads,
        "distributions": distributions,
        "is_shortfall": cfads < 0,
    }


@router.post("/properties/{property_id}/ownership")
def replace_ownership(
    property_id: uuid.UUID,
    body: OwnershipBulk,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    require_property(db, current_user.tenant_id, property_id)
    total_pct = sum(r.ownership_pct for r in body.rows)
    if abs(total_pct - 1.0) > 0.001:
        raise HTTPException(status_code=400, detail=f"ownership_pct must sum to 1.0 (got {total_pct:.4f})")

    db.query(ReitOwnership).filter(
        ReitOwnership.property_id == property_id,
        ReitOwnership.tenant_id == current_user.tenant_id,
    ).delete()

    for row in body.rows:
        db.add(
            ReitOwnership(
                tenant_id=current_user.tenant_id,
                property_id=property_id,
                partner_name=row.partner_name,
                role=ReitPartnerRole(row.role),
                ownership_pct=row.ownership_pct,
                capital_contributed=row.capital_contributed,
                preferred_return_pct=row.preferred_return_pct,
            )
        )
    db.commit()
    return get_ownership(property_id, db, current_user)


@router.put("/properties/{property_id}/ownership")
def update_ownership(
    property_id: uuid.UUID,
    body: OwnershipBulk,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    return replace_ownership(property_id, body, db, current_user)


@router.get("/properties/{property_id}/financial-strength")
def get_financial_strength(
    property_id: uuid.UUID,
    period: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    prop = require_property(db, current_user.tenant_id, property_id)
    period_date = _parse_period(period, db, current_user.tenant_id, property_id)
    unit_dicts, opex, loan_d = _load_pl_context(db, current_user.tenant_id, property_id, period_date)
    pl = calc_pl(unit_dicts, opex, loan_d)
    return financial_strength(property_dict(prop), pl["net_operating_income"], loan_d)
