"""KPI Sanity Check — admin-only audit API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.tenancy import UserRole
from services.kpi_sanity_check import (
    format_console_report,
    get_latest_audit_run,
    run_tenant_audit,
)

router = APIRouter(prefix="/api/admin/kpi-sanity", tags=["kpi-sanity"])


def require_kpi_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Gate KPI sanity tools — platform_admin, owner, or allowlisted emails."""
    if current_user.role == UserRole.platform_admin:
        return current_user
    if current_user.role == UserRole.owner:
        return current_user
    allowed = {
        e.strip().lower()
        for e in (settings.kpi_admin_emails or "").split(",")
        if e.strip()
    }
    if current_user.email and current_user.email.lower() in allowed:
        return current_user
    raise HTTPException(status_code=403, detail="KPI Sanity Check is restricted to admin users.")


@router.get("/access")
def check_access(current_user: CurrentUser = Depends(require_kpi_admin)):
    return {"allowed": True, "email": current_user.email, "role": current_user.role.value}


@router.post("/run")
def run_audit(
    period: str | None = Query(None, description="MoM, YTD, TTM, or omit for single month"),
    month: int = Query(6, ge=1, le=12),
    year: int = Query(2026, ge=2000, le=2100),
    company_id: str | None = Query(None),
    current_user: CurrentUser = Depends(require_kpi_admin),
    db: Session = Depends(get_db),
):
    if period and period not in ("MoM", "YTD", "TTM"):
        raise HTTPException(status_code=400, detail="period must be MoM, YTD, TTM, or omitted")
    return run_tenant_audit(
        db,
        current_user.tenant_id,
        period=period,
        month=month,
        year=year,
        company_id=company_id,
        triggered_by=current_user.email or "admin",
    )


@router.get("/latest")
def latest_audit(
    current_user: CurrentUser = Depends(require_kpi_admin),
    db: Session = Depends(get_db),
):
    data = get_latest_audit_run(db, current_user.tenant_id)
    if not data:
        return {"message": "No audit runs yet. Click Run Check."}
    return data


@router.get("/report.txt")
def latest_report_text(
    current_user: CurrentUser = Depends(require_kpi_admin),
    db: Session = Depends(get_db),
):
    data = get_latest_audit_run(db, current_user.tenant_id)
    if not data:
        return {"report": "No audit runs yet."}
    return {"report": format_console_report(data)}
