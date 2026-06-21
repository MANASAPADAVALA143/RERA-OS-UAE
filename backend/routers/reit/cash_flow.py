import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.reit.financials import ReitCashFlowWeek
from routers.reit._helpers import require_property
from services.reit_calculations import thirteen_week_forecast

router = APIRouter(prefix="/api/reit", tags=["reit"])


class CashFlowWeekRow(BaseModel):
    week_number: int = Field(..., ge=1, le=13)
    week_start_date: date
    opening_balance: float
    inflows: float
    outflows: float
    alert_note: str | None = None


class CashFlowBulk(BaseModel):
    weeks: list[CashFlowWeekRow]


@router.get("/properties/{property_id}/cash-flow-13week")
def get_cash_flow(
    property_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    prop = require_property(db, current_user.tenant_id, property_id)
    weeks = (
        db.query(ReitCashFlowWeek)
        .filter(
            ReitCashFlowWeek.property_id == property_id,
            ReitCashFlowWeek.tenant_id == current_user.tenant_id,
        )
        .order_by(ReitCashFlowWeek.week_number)
        .all()
    )
    week_dicts = [
        {
            "id": str(w.id),
            "week_number": w.week_number,
            "week_start_date": w.week_start_date.isoformat(),
            "opening_balance": float(w.opening_balance),
            "inflows": float(w.inflows),
            "outflows": float(w.outflows),
            "alert_note": w.alert_note,
        }
        for w in weeks
    ]
    return {
        "min_buffer_target": float(prop.min_buffer_target),
        "weeks": thirteen_week_forecast(week_dicts, float(prop.min_buffer_target)),
    }


@router.post("/properties/{property_id}/cash-flow-13week")
def upsert_cash_flow(
    property_id: uuid.UUID,
    body: CashFlowBulk,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    prop = require_property(db, current_user.tenant_id, property_id)
    if len(body.weeks) != 13:
        raise HTTPException(status_code=400, detail="Exactly 13 weeks required")

    db.query(ReitCashFlowWeek).filter(
        ReitCashFlowWeek.property_id == property_id,
        ReitCashFlowWeek.tenant_id == current_user.tenant_id,
    ).delete()

    for w in body.weeks:
        db.add(
            ReitCashFlowWeek(
                tenant_id=current_user.tenant_id,
                property_id=property_id,
                week_number=w.week_number,
                week_start_date=w.week_start_date,
                opening_balance=w.opening_balance,
                inflows=w.inflows,
                outflows=w.outflows,
                alert_note=w.alert_note,
            )
        )
    db.commit()
    return get_cash_flow(property_id, db, current_user)
