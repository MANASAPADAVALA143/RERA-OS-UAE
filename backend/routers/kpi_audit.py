"""KPI Sanity Check — internal reviewer API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, require_kpi_reviewer
from services.kpi_sanity_check import (
    format_console_report,
    get_company_audit_from_db,
    get_latest_audit_run,
    run_tenant_audit,
)

router = APIRouter(prefix="/api/admin/kpi-sanity", tags=["kpi-sanity"])


@router.get("/access")
def check_access(current_user: CurrentUser = Depends(require_kpi_reviewer)):
    return {"allowed": True, "email": current_user.email, "role": current_user.role.value}


@router.post("/run")
def run_audit(
    period: str | None = Query(None, description="MoM, YTD, TTM, or omit for single month"),
    month: int = Query(6, ge=1, le=12),
    year: int = Query(2026, ge=2000, le=2100),
    company_id: str | None = Query(None),
    current_user: CurrentUser = Depends(require_kpi_reviewer),
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


@router.get("/company/{company_id}")
def company_audit(
    company_id: str,
    period: str | None = Query(None, description="MoM, YTD, TTM, or omit for single month"),
    month: int = Query(6, ge=1, le=12),
    year: int = Query(2026, ge=2000, le=2100),
    current_user: CurrentUser = Depends(require_kpi_reviewer),
    db: Session = Depends(get_db),
):
    """In-app calculation breakdown for one company — internal reviewers only."""
    if period and period not in ("MoM", "YTD", "TTM"):
        raise HTTPException(status_code=400, detail="period must be MoM, YTD, TTM, or omitted")
    try:
        return get_company_audit_from_db(
            db,
            current_user.tenant_id,
            company_id,
            period=period,
            month=month,
            year=year,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/latest")
def latest_audit(
    current_user: CurrentUser = Depends(require_kpi_reviewer),
    db: Session = Depends(get_db),
):
    data = get_latest_audit_run(db, current_user.tenant_id)
    if not data:
        return {"message": "No audit runs yet. Click Run Check."}
    return data


@router.get("/report.txt")
def latest_report_text(
    current_user: CurrentUser = Depends(require_kpi_reviewer),
    db: Session = Depends(get_db),
):
    data = get_latest_audit_run(db, current_user.tenant_id)
    if not data:
        return {"report": "No audit runs yet."}
    return {"report": format_console_report(data)}
