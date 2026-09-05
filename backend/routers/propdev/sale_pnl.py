"""Property Dev Sale P&L (propdev_sale_pnl) -- provisional / actual entity
sale P&L records feeding the Partner ROI tab's Net Profit/Loss figure.
See services/propdev_sale_pnl.py for the totals formula and the
actual-over-provisional view logic.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.sale_pnl import PropDevSalePnl
from services.propdev_sale_pnl import compute_sale_pnl_totals, get_current_sale_pnl

router = APIRouter(prefix="/api/propdev/sale-pnl", tags=["propdev"])


def _to_dict(row: PropDevSalePnl, label: str) -> dict:
    totals = compute_sale_pnl_totals(row)
    return {
        "id": str(row.id),
        "company_id": str(row.company_id),
        "status": row.status,
        "label": label,
        "sale_consideration": float(row.sale_consideration),
        "total_lots": row.total_lots,
        "land_cost": float(row.land_cost),
        "hard_cost": float(row.hard_cost),
        "soft_cost": float(row.soft_cost),
        "title_company_charges": float(row.title_company_charges),
        "other_charges": float(row.other_charges),
        "property_tax": float(row.property_tax),
        "loan_processing_charges": float(row.loan_processing_charges),
        "professional_charges": float(row.professional_charges),
        "legal_fees": float(row.legal_fees),
        "interest_on_mortgage_loan": float(row.interest_on_mortgage_loan),
        "management_fee_pct": float(row.management_fee_pct),
        "sale_commission_note": row.sale_commission_note,
        "sale_commission_amount": float(row.sale_commission_amount),
        "total_expenses_excl_land_comm_mgmt": totals.total_expenses_excl_land_comm_mgmt,
        "management_fee_amount": totals.management_fee_amount,
        "total_expenses_excl_land": totals.total_expenses_excl_land,
        "total_expenses": totals.total_expenses,
        "net_profit_loss": totals.net_profit_loss,
        "net_profit_ratio": totals.net_profit_ratio,
        "locked_at": row.locked_at.isoformat() if row.locked_at else None,
        "created_at": row.created_at.isoformat(),
    }


@router.get("/{company_id}")
def get_current_sale_pnl_endpoint(
    company_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == uuid.UUID(company_id),
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(404, "Company not found")

    row, label = get_current_sale_pnl(db, current_user.tenant_id, company.id)
    if not row:
        return {"company_id": company_id, "status": None, "label": None}
    return _to_dict(row, label)


class SalePnlRequest(BaseModel):
    company_id: str
    status: str = Field(pattern="^(provisional|actual)$")
    sale_consideration: float = Field(ge=0, default=0)
    total_lots: int | None = None
    land_cost: float = Field(ge=0, default=0)
    hard_cost: float = Field(ge=0, default=0)
    soft_cost: float = Field(ge=0, default=0)
    title_company_charges: float = Field(ge=0, default=0)
    other_charges: float = Field(ge=0, default=0)
    property_tax: float = Field(ge=0, default=0)
    loan_processing_charges: float = Field(ge=0, default=0)
    professional_charges: float = Field(ge=0, default=0)
    legal_fees: float = Field(ge=0, default=0)
    interest_on_mortgage_loan: float = Field(ge=0, default=0)
    management_fee_pct: float = Field(ge=0, default=0)
    sale_commission_note: str | None = None
    sale_commission_amount: float = Field(ge=0, default=0)


@router.post("", status_code=201)
def create_sale_pnl_endpoint(
    req: SalePnlRequest,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == uuid.UUID(req.company_id),
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(404, "Company not found")

    row = PropDevSalePnl(
        tenant_id=current_user.tenant_id,
        company_id=company.id,
        status=req.status,
        sale_consideration=req.sale_consideration,
        total_lots=req.total_lots,
        land_cost=req.land_cost,
        hard_cost=req.hard_cost,
        soft_cost=req.soft_cost,
        title_company_charges=req.title_company_charges,
        other_charges=req.other_charges,
        property_tax=req.property_tax,
        loan_processing_charges=req.loan_processing_charges,
        professional_charges=req.professional_charges,
        legal_fees=req.legal_fees,
        interest_on_mortgage_loan=req.interest_on_mortgage_loan,
        management_fee_pct=req.management_fee_pct,
        sale_commission_note=req.sale_commission_note,
        sale_commission_amount=req.sale_commission_amount,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "An actual sale P&L already exists for this entity")
    db.refresh(row)

    label = "Actual" if row.status == "actual" else "Projected"
    return _to_dict(row, label)
