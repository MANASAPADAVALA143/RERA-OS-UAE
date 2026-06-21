import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.construction_cost import CostTrade, TradeName
from services.real_estate_calculations import cost_overrun

router = APIRouter(prefix="/api/real-estate/costs", tags=["real-estate"])


@router.get("/trades")
def list_cost_trades(
    project_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(CostTrade).filter(CostTrade.tenant_id == current_user.tenant_id)
    if project_id:
        q = q.filter(CostTrade.project_id == uuid.UUID(project_id))

    rows = []
    for t in q.all():
        overrun = cost_overrun(t.budgeted_cost, t.actual_cost_to_date, t.committed_cost)
        rows.append({
            "id": str(t.id),
            "project_id": str(t.project_id),
            "trade_name": t.trade_name.value,
            "csi_division_code": t.csi_division_code,
            "division_label": t.division_label,
            "vendor_name": t.vendor_name,
            "budgeted_cost": float(t.budgeted_cost),
            "actual_cost_to_date": float(t.actual_cost_to_date),
            "committed_cost": float(t.committed_cost),
            "pct_complete": float(t.pct_complete),
            "comparable_project_id": str(t.comparable_project_id) if t.comparable_project_id else None,
            "prior_period_actual_cost": float(t.prior_period_actual_cost) if t.prior_period_actual_cost else None,
            **overrun,
        })
    return rows


@router.get("/trades/comparison")
def trade_comparison(
    trade_name: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    trades = (
        db.query(CostTrade)
        .filter(
            CostTrade.tenant_id == current_user.tenant_id,
            CostTrade.trade_name == TradeName(trade_name),
            CostTrade.comparable_project_id.isnot(None),
        )
        .all()
    )
    return [
        {
            "project_id": str(t.project_id),
            "comparable_project_id": str(t.comparable_project_id),
            "actual_cost_to_date": float(t.actual_cost_to_date),
            "comparable_project_actual_cost": float(t.comparable_project_actual_cost) if t.comparable_project_actual_cost else None,
            "prior_period_actual_cost": float(t.prior_period_actual_cost) if t.prior_period_actual_cost else None,
        }
        for t in trades
    ]


@router.get("/summary/{project_id}")
def cost_summary(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    trades = (
        db.query(CostTrade)
        .filter(CostTrade.tenant_id == current_user.tenant_id, CostTrade.project_id == project_id)
        .all()
    )
    if not trades:
        return {"total_budgeted": 0, "total_actual": 0, "total_committed": 0, "overall_overrun_pct": 0, "flagged_trades": []}

    total_budgeted = sum(float(t.budgeted_cost) for t in trades)
    total_actual = sum(float(t.actual_cost_to_date) for t in trades)
    total_committed = sum(float(t.committed_cost) for t in trades)
    overall = cost_overrun(total_budgeted, total_actual, total_committed)

    flagged = []
    for t in trades:
        o = cost_overrun(t.budgeted_cost, t.actual_cost_to_date, t.committed_cost)
        if o["status"] in ("watch", "over_budget"):
            flagged.append({"trade_name": t.trade_name.value, **o})

    return {
        "total_budgeted": round(total_budgeted, 2),
        "total_actual": round(total_actual, 2),
        "total_committed": round(total_committed, 2),
        "overall_overrun_pct": overall["overrun_pct"],
        "overall_status": overall["status"],
        "flagged_trades": flagged,
    }
