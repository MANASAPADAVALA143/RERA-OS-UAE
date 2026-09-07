"""Property Dev Lot Reinvestment Tracker (propdev_lot_reinvestments).

Creating a reinvestment round auto-generates a capital call (propdev_capital_calls
+ propdev_partner_capital_contributions) when cash on hand + undrawn loan facility
can't cover the reinvestment amount -- see services/propdev_lot_reinvestment.py.
"""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.lot_reinvestment import PropDevLotReinvestment
from services.propdev_lot_reinvestment import create_lot_reinvestment

router = APIRouter(prefix="/api/propdev/lot-reinvestments", tags=["propdev"])


def _to_dict(r: PropDevLotReinvestment) -> dict:
    undeployed = float(r.capital_raised) - float(r.deployed_to_lots) - float(r.deployed_to_improvements)
    return {
        "id": str(r.id),
        "company_id": str(r.company_id),
        "period": r.period,
        "capital_raised": float(r.capital_raised),
        "deployed_to_lots": float(r.deployed_to_lots),
        "deployed_to_improvements": float(r.deployed_to_improvements),
        "undeployed": undeployed,
        "expected_return_per_lot": float(r.expected_return_per_lot) if r.expected_return_per_lot is not None else None,
        "board_approval_status": r.board_approval_status,
        "approval_date": r.approval_date.isoformat() if r.approval_date else None,
        "notes": r.notes,
    }


@router.get("")
def list_lot_reinvestments(
    company_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(PropDevLotReinvestment).filter(
        PropDevLotReinvestment.tenant_id == current_user.tenant_id,
    )
    if company_id:
        q = q.filter(PropDevLotReinvestment.company_id == uuid.UUID(company_id))
    rows = q.order_by(PropDevLotReinvestment.created_at.desc()).all()
    return {"items": [_to_dict(r) for r in rows]}


class CreateLotReinvestmentRequest(BaseModel):
    company_id: str
    period: str
    capital_raised: float = Field(ge=0)
    deployed_to_lots: float = Field(ge=0, default=0)
    deployed_to_improvements: float = Field(ge=0, default=0)
    # Amount actually needed for this reinvestment round -- may exceed capital_raised,
    # which is what triggers the auto capital call.
    reinvestment_amount: float = Field(gt=0)
    expected_return_per_lot: float | None = None
    notes: str | None = None


@router.post("", status_code=201)
def create_lot_reinvestment_endpoint(
    req: CreateLotReinvestmentRequest,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == uuid.UUID(req.company_id),
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(404, "Company not found")

    try:
        reinvestment, trigger = create_lot_reinvestment(
            db=db,
            tenant_id=current_user.tenant_id,
            company_id=company.id,
            period=req.period,
            capital_raised=req.capital_raised,
            deployed_to_lots=req.deployed_to_lots,
            deployed_to_improvements=req.deployed_to_improvements,
            reinvestment_amount=req.reinvestment_amount,
            expected_return_per_lot=req.expected_return_per_lot,
            notes=req.notes,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))

    result = _to_dict(reinvestment)
    result["capital_call_triggered"] = trigger is not None
    if trigger is not None:
        result["capital_call_amount"] = trigger.capital_call_amount
        result["cash_available"] = trigger.cash_available
    return result
