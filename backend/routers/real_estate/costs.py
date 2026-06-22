import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.construction_cost import CostTrade, TradeName
from models.real_estate.construction_extended import ChangeOrder
from models.real_estate.entity import Project
from services.real_estate_calculations import cost_overrun, validate_period_completion
from services.sov_calculations import sov_billing_status, sov_exceptions, sov_portfolio_summary

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


@router.get("/sov/{project_id}")
def get_sov(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Full Schedule of Values view for one project.

    billed_to_date is sourced from actual_cost_to_date (invoiced costs).
    cost_impact per trade is the sum of approved change order amounts
    whose csi_division_code matches the trade's csi_division_code.
    """
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.tenant_id == current_user.tenant_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    trades = (
        db.query(CostTrade)
        .filter(CostTrade.tenant_id == current_user.tenant_id, CostTrade.project_id == project_id)
        .order_by(CostTrade.csi_division_code.nulls_last(), CostTrade.created_at)
        .all()
    )

    approved_cos = (
        db.query(ChangeOrder)
        .filter(
            ChangeOrder.tenant_id == current_user.tenant_id,
            ChangeOrder.project_id == project_id,
            ChangeOrder.status == "approved",
        )
        .all()
    )

    # Build cost-impact lookup by CSI division code
    co_impact: dict[str, float] = {}
    for co in approved_cos:
        if co.csi_division_code and co.approved_amount:
            co_impact[co.csi_division_code] = co_impact.get(co.csi_division_code, 0.0) + float(co.approved_amount)

    def _trade_to_sov(t: CostTrade) -> dict:
        contract_amount = float(t.budgeted_cost)
        pct_complete = float(t.pct_complete)
        billed = float(t.actual_cost_to_date)
        impact = co_impact.get(t.csi_division_code or "", 0.0)
        billing = sov_billing_status(contract_amount, pct_complete, billed, impact)
        overrun = cost_overrun(contract_amount, billed, float(t.committed_cost))
        return {
            "id": str(t.id),
            "trade_name": t.trade_name.value,
            "division_label": t.division_label,
            "csi_division_code": t.csi_division_code,
            "vendor_name": t.vendor_name,
            "sov_type": t.sov_type or "subcontractor",
            "sov_status": t.sov_status or "draft",
            "sov_start_date": t.sov_start_date.isoformat() if t.sov_start_date else None,
            "sov_end_date": t.sov_end_date.isoformat() if t.sov_end_date else None,
            "contract_amount": contract_amount,
            "pct_complete": pct_complete,
            "cost_impact": round(impact, 2),
            "committed_cost": float(t.committed_cost),
            "created_by": t.created_by,
            "created_at": t.created_at.isoformat(),
            "variance_status": overrun["status"],
            # AIA G702/G703 billing detail
            "prior_period_completed": float(t.prior_period_completed) if t.prior_period_completed is not None else None,
            "current_period_completed": float(t.current_period_completed) if t.current_period_completed is not None else None,
            "stored_materials": float(t.stored_materials) if t.stored_materials is not None else 0.0,
            "retainage_pct": float(t.retainage_pct) if t.retainage_pct is not None else None,
            **billing,
        }

    sov_rows = [_trade_to_sov(t) for t in trades]
    master = next((r for r in sov_rows if r["sov_type"] == "master"), None)
    subs = [r for r in sov_rows if r["sov_type"] != "master"]
    exceptions = sov_exceptions(sov_rows)
    summary = sov_portfolio_summary(sov_rows)

    # Budget-centric KPI summary for the merged Costs & SOV section
    all_rows = sov_rows
    total_budget = sum(r["contract_amount"] for r in all_rows)
    total_actual = sum(r["billed_to_date"] for r in all_rows)
    total_committed = sum(r["committed_cost"] for r in all_rows)
    count_over_budget = sum(1 for r in all_rows if r["variance_status"] == "over_budget")
    overall_variance_pct = (
        round((total_actual + total_committed - total_budget) / total_budget * 100, 2)
        if total_budget > 0 else 0.0
    )
    budget_summary = {
        "total_budget": round(total_budget, 2),
        "total_actual": round(total_actual, 2),
        "total_committed": round(total_committed, 2),
        "count_over_budget": count_over_budget,
        "overall_variance_pct": overall_variance_pct,
    }

    return {
        "project_id": str(project_id),
        "project_code": project.project_code,
        "project_name": project.project_name,
        "budget_summary": budget_summary,
        "summary": summary,
        "exceptions": exceptions,
        "master_sov": master,
        "subcontractor_sovs": subs,
    }


# ── AIA Billing fields PATCH ─────────────────────────────────────────────────

class AIABillingUpdate(BaseModel):
    prior_period_completed: Optional[float] = None
    current_period_completed: Optional[float] = None
    stored_materials: Optional[float] = None
    retainage_pct: Optional[float] = None


@router.patch("/trades/{trade_id}/aia-billing")
def update_aia_billing(
    trade_id: uuid.UUID,
    body: AIABillingUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Update the AIA G702/G703 billing detail fields on a CostTrade.

    Validates that prior_period_completed + current_period_completed equals
    earned_to_date (contract_amount × pct_complete) within a $1 tolerance.
    Returns HTTP 422 if the validation fails rather than silently saving
    inconsistent data.
    """
    trade = (
        db.query(CostTrade)
        .filter(CostTrade.id == trade_id, CostTrade.tenant_id == current_user.tenant_id)
        .first()
    )
    if not trade:
        raise HTTPException(status_code=404, detail="Cost trade not found")

    prior = body.prior_period_completed
    current = body.current_period_completed

    # Only validate when both period fields are provided
    if prior is not None and current is not None:
        earned_to_date = float(trade.budgeted_cost) * float(trade.pct_complete)
        result = validate_period_completion(prior, current, earned_to_date)
        if not result["valid"]:
            raise HTTPException(status_code=422, detail=result["detail"])

    if prior is not None:
        trade.prior_period_completed = prior
    if current is not None:
        trade.current_period_completed = current
    if body.stored_materials is not None:
        trade.stored_materials = body.stored_materials
    if body.retainage_pct is not None:
        trade.retainage_pct = body.retainage_pct

    db.commit()
    db.refresh(trade)

    earned_to_date = float(trade.budgeted_cost) * float(trade.pct_complete)
    return {
        "id": str(trade.id),
        "prior_period_completed": float(trade.prior_period_completed) if trade.prior_period_completed is not None else None,
        "current_period_completed": float(trade.current_period_completed) if trade.current_period_completed is not None else None,
        "stored_materials": float(trade.stored_materials) if trade.stored_materials is not None else 0.0,
        "retainage_pct": float(trade.retainage_pct) if trade.retainage_pct is not None else None,
        "earned_to_date": round(earned_to_date, 2),
    }
