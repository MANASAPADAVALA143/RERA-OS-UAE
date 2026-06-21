from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_role
from models.audit_log import AuditLog
from models.tenancy import Tenant
from routers.real_estate.executive_summary import executive_summary
from services.llm_client import invoke_narrative

router = APIRouter(prefix="/api/real-estate/ai", tags=["real-estate-ai"])


class ExplainOverrunRequest(BaseModel):
    trade_id: str


class CompareParcelsRequest(BaseModel):
    parcel_ids: list[str]


def _get_tenant_ai_enabled(db: Session, tenant_id) -> bool:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    return tenant.ai_narrative_enabled if tenant else False


def _log_ai_call(db: Session, tenant_id, user_id: str, action: str, endpoint: str, success: bool):
    log = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        endpoint=endpoint,
        success=success,
    )
    db.add(log)
    db.commit()


@router.post("/morning-briefing")
def morning_briefing(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    summary = executive_summary(250000, current_user, db)
    fh = summary["financial_health"]
    top_alerts = summary["alerts"][:3]

    payload = {
        "consolidated_revenue": fh["consolidated_revenue"],
        "consolidated_operating_profit": fh["consolidated_operating_profit"],
        "capital_available": fh["capital_available_now"],
        "top_alerts": [{"type": a["type"], "message": a["message"], "severity": a["severity"]} for a in top_alerts],
    }

    fallback_text = (
        f"Portfolio revenue is ${fh['consolidated_revenue']:,.0f} with operating profit of "
        f"${fh['consolidated_operating_profit']:,.0f}. Capital available now: ${fh['capital_available_now']:,.0f}. "
        f"Top priority: {top_alerts[0]['message'] if top_alerts else 'No critical alerts today.'}"
    )

    if not _get_tenant_ai_enabled(db, current_user.tenant_id):
        return {"briefing_text": fallback_text, "generated_at": datetime.now(timezone.utc).isoformat(), "fallback_used": True}

    prompt = (
        "You are a CFO briefing assistant. Given this real estate portfolio summary JSON, "
        "write a 4-6 sentence morning briefing in plain English, prioritizing the most urgent item first. "
        "No markdown, no bullet points, conversational but precise, always state the actual numbers given, "
        f"never invent numbers not present in the input JSON.\n\n{payload}"
    )
    result = invoke_narrative(prompt)
    _log_ai_call(db, current_user.tenant_id, current_user.user_id, "ai_morning_briefing", "/api/real-estate/ai/morning-briefing", result["success"])

    if result["success"]:
        return {"briefing_text": result["text"], "generated_at": datetime.now(timezone.utc).isoformat(), "fallback_used": False}
    return {"briefing_text": fallback_text, "generated_at": datetime.now(timezone.utc).isoformat(), "fallback_used": True}


@router.post("/explain-overrun")
def explain_overrun(
    body: ExplainOverrunRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from uuid import UUID
    from models.real_estate.construction_cost import CostTrade
    from services.real_estate_calculations import cost_overrun

    trade = db.query(CostTrade).filter(CostTrade.id == UUID(body.trade_id), CostTrade.tenant_id == current_user.tenant_id).first()
    if not trade:
        return {"explanation": "Trade not found.", "fallback_used": True}

    overrun = cost_overrun(trade.budgeted_cost, trade.actual_cost_to_date, trade.committed_cost)
    payload = {
        "trade_name": trade.trade_name.value,
        "budgeted": float(trade.budgeted_cost),
        "actual": float(trade.actual_cost_to_date),
        "committed": float(trade.committed_cost),
        **overrun,
    }
    fallback = (
        f"{trade.trade_name.value} is {overrun['status']} with {overrun['overrun_pct']:.1%} variance. "
        f"Budget ${float(trade.budgeted_cost):,.0f}, actual ${float(trade.actual_cost_to_date):,.0f}, "
        f"committed ${float(trade.committed_cost):,.0f}. Review subcontractor invoices and pending POs."
    )

    if not _get_tenant_ai_enabled(db, current_user.tenant_id):
        return {"explanation": fallback, "fallback_used": True}

    prompt = f"Explain this construction cost variance in 2-3 sentences with a suggested next action. Data: {payload}"
    result = invoke_narrative(prompt, max_tokens=200)
    _log_ai_call(db, current_user.tenant_id, current_user.user_id, "ai_explain_overrun", "/api/real-estate/ai/explain-overrun", result["success"])

    return {"explanation": result["text"] if result["success"] else fallback, "fallback_used": not result["success"]}


@router.post("/compare-parcels")
def compare_parcels(
    body: CompareParcelsRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from uuid import UUID
    from models.real_estate.pipeline import LandParcel

    parcels = []
    for pid in body.parcel_ids[:3]:
        p = db.query(LandParcel).filter(LandParcel.id == UUID(pid), LandParcel.tenant_id == current_user.tenant_id).first()
        if p:
            parcels.append({
                "status": p.status.value,
                "projected_irr": float(p.projected_project_irr) if p.projected_project_irr else None,
                "projected_cost": float(p.projected_acquisition_cost) if p.projected_acquisition_cost else None,
                "projected_units_or_sqft": float(p.projected_units_or_sqft) if p.projected_units_or_sqft else None,
                "target_close": p.target_close_date.isoformat() if p.target_close_date else None,
            })

    missing_irr = any(p["projected_irr"] is None for p in parcels)
    fallback = "Compare projected IRR, acquisition cost, and target close dates across selected parcels. "
    if missing_irr:
        fallback += "Note: one or more parcels are missing IRR data."
    if len(parcels) >= 2:
        best = max(parcels, key=lambda x: x["projected_irr"] or 0)
        fallback += f" Highest projected IRR: {best['projected_irr']:.1%}." if best["projected_irr"] else ""

    if not _get_tenant_ai_enabled(db, current_user.tenant_id):
        return {"narrative": fallback, "fallback_used": True}

    prompt = (
        "Given this land parcel comparison table, write a short recommendation framed as "
        "'if I had to pick one to prioritize, here's the trade-off'. Present as one input to the decision, "
        f"not a final answer. Flag missing IRR data.\n\n{parcels}"
    )
    result = invoke_narrative(prompt, max_tokens=250)
    _log_ai_call(db, current_user.tenant_id, current_user.user_id, "ai_compare_parcels", "/api/real-estate/ai/compare-parcels", result["success"])

    return {"narrative": result["text"] if result["success"] else fallback, "fallback_used": not result["success"]}


@router.get("/audit-log")
def ai_audit_log(
    current_user: CurrentUser = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == current_user.tenant_id)
        .order_by(AuditLog.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {"date": l.created_at.isoformat(), "feature": l.action, "success": l.success, "endpoint": l.endpoint}
        for l in logs
    ]
