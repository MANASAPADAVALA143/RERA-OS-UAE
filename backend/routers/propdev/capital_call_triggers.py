"""Auto-generated capital call triggers that aren't tied to a bulk-import
router of their own (see routers/propdev/lot_reinvestments.py for the lot
reinvestment trigger, which fires from its own create endpoint instead).

Unrealised G/L per entity is computed on the frontend (it already has the
period-scoped FMV/Book Value via kpisById -- see
frontend/src/utils/propDevCompanyOverview.ts), so this endpoint takes the
already-computed figures rather than recomputing them server-side, and just
owns the materiality/duplicate-guard/insert logic
(services/propdev_capital_call_triggers.py).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, require_write_access
from models.propdev.company import PropDevCompany
from services.propdev_capital_call_triggers import insert_unrealised_loss_capital_call

router = APIRouter(prefix="/api/propdev/capital-calls", tags=["propdev"])


class UnrealisedLossTriggerRequest(BaseModel):
    company_id: str
    unrealised_gl: float
    book_value: float


@router.post("/unrealised-loss")
def trigger_unrealised_loss_capital_call(
    req: UnrealisedLossTriggerRequest,
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
        trigger = insert_unrealised_loss_capital_call(
            db=db,
            tenant_id=current_user.tenant_id,
            company_id=company.id,
            unrealised_gl=req.unrealised_gl,
            book_value=req.book_value,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc))

    return {
        "capital_call_triggered": trigger is not None,
        "capital_call_amount": trigger.capital_call_amount if trigger else None,
    }
