import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.entity import Project
from models.real_estate.pay_application import PayApplication, PayAppStatus

router = APIRouter(prefix="/api/real-estate/pay-applications", tags=["real-estate"])


def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.tenant_id == tenant_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _compute(body: dict) -> dict:
    """Derive G702 computed columns from raw inputs."""
    prev = float(body.get("prev_completed") or 0)
    curr = float(body.get("curr_completed") or 0)
    stored = float(body.get("stored_materials") or 0)
    total = prev + curr + stored
    ret_pct = float(body.get("retainage_pct") or 0.10)
    ret_amt = round(total * ret_pct, 2)
    total_less = round(total - ret_amt, 2)
    prev_pmts = float(body.get("previous_payments") or 0)
    current_due = round(total_less - prev_pmts, 2)
    return {
        "total_completed_stored": round(total, 2),
        "retainage_amount": ret_amt,
        "total_less_retainage": total_less,
        "current_payment_due": current_due,
    }


def _pay_app_dict(pa: PayApplication) -> dict:
    return {
        "id": str(pa.id),
        "project_id": str(pa.project_id),
        "pay_app_number": pa.pay_app_number,
        "subcontractor_name": pa.subcontractor_name,
        "period_start": pa.period_start.isoformat() if pa.period_start else None,
        "period_end": pa.period_end.isoformat(),
        "scheduled_value": float(pa.scheduled_value),
        "prev_completed": float(pa.prev_completed),
        "curr_completed": float(pa.curr_completed),
        "stored_materials": float(pa.stored_materials),
        "total_completed_stored": float(pa.total_completed_stored),
        "retainage_pct": float(pa.retainage_pct),
        "retainage_amount": float(pa.retainage_amount),
        "total_less_retainage": float(pa.total_less_retainage),
        "previous_payments": float(pa.previous_payments),
        "current_payment_due": float(pa.current_payment_due),
        "status": pa.status.value,
        "submitted_date": pa.submitted_date.isoformat() if pa.submitted_date else None,
        "approved_date": pa.approved_date.isoformat() if pa.approved_date else None,
        "notes": pa.notes,
        "created_by": pa.created_by,
        "created_at": pa.created_at.isoformat(),
    }


# ── Pydantic models ───────────────────────────────────────────────────────────

class PayAppCreate(BaseModel):
    project_id: str
    pay_app_number: str
    subcontractor_name: str
    period_start: Optional[str] = None
    period_end: str                              # required
    scheduled_value: float = 0.0
    prev_completed: float = 0.0
    curr_completed: float = 0.0
    stored_materials: float = 0.0
    retainage_pct: float = 0.10
    previous_payments: float = 0.0
    notes: Optional[str] = None


class PayAppUpdate(BaseModel):
    pay_app_number: Optional[str] = None
    subcontractor_name: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    scheduled_value: Optional[float] = None
    prev_completed: Optional[float] = None
    curr_completed: Optional[float] = None
    stored_materials: Optional[float] = None
    retainage_pct: Optional[float] = None
    previous_payments: Optional[float] = None
    status: Optional[str] = None
    submitted_date: Optional[str] = None
    approved_date: Optional[str] = None
    notes: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_pay_apps(
    project_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)

    apps = (
        db.query(PayApplication)
        .filter(PayApplication.tenant_id == current_user.tenant_id, PayApplication.project_id == pid)
        .order_by(PayApplication.period_end.desc(), PayApplication.pay_app_number)
        .all()
    )
    items = [_pay_app_dict(a) for a in apps]

    total_billed = sum(a["total_completed_stored"] for a in items)
    total_due = sum(a["current_payment_due"] for a in items)
    by_status: dict[str, int] = {}
    for a in items:
        by_status[a["status"]] = by_status.get(a["status"], 0) + 1

    return {
        "summary": {
            "count": len(items),
            "total_billed": round(total_billed, 2),
            "total_payment_due": round(total_due, 2),
            "by_status": by_status,
        },
        "items": items,
    }


@router.post("", status_code=201)
def create_pay_app(
    body: PayAppCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(body.project_id)
    _require_project(db, current_user.tenant_id, pid)

    computed = _compute(body.model_dump())
    pa = PayApplication(
        tenant_id=current_user.tenant_id,
        project_id=pid,
        pay_app_number=body.pay_app_number,
        subcontractor_name=body.subcontractor_name,
        period_start=date.fromisoformat(body.period_start) if body.period_start else None,
        period_end=date.fromisoformat(body.period_end),
        scheduled_value=body.scheduled_value,
        prev_completed=body.prev_completed,
        curr_completed=body.curr_completed,
        stored_materials=body.stored_materials,
        retainage_pct=body.retainage_pct,
        previous_payments=body.previous_payments,
        notes=body.notes,
        created_by=current_user.email,
        **computed,
    )
    db.add(pa)
    db.commit()
    db.refresh(pa)
    return _pay_app_dict(pa)


@router.patch("/{pay_app_id}")
def update_pay_app(
    pay_app_id: uuid.UUID,
    body: PayAppUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pa = db.query(PayApplication).filter(
        PayApplication.id == pay_app_id, PayApplication.tenant_id == current_user.tenant_id
    ).first()
    if not pa:
        raise HTTPException(status_code=404, detail="Pay application not found")

    update_data = body.model_dump(exclude_none=True)
    for field in ("pay_app_number", "subcontractor_name", "notes"):
        if field in update_data:
            setattr(pa, field, update_data[field])
    for date_field in ("period_start", "period_end", "submitted_date", "approved_date"):
        if date_field in update_data:
            setattr(pa, date_field, date.fromisoformat(update_data[date_field]) if update_data[date_field] else None)
    for num_field in ("scheduled_value", "prev_completed", "curr_completed", "stored_materials", "retainage_pct", "previous_payments"):
        if num_field in update_data:
            setattr(pa, num_field, update_data[num_field])
    if "status" in update_data:
        try:
            pa.status = PayAppStatus(update_data["status"])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {update_data['status']}")

    # Re-derive computed fields
    computed = _compute({
        "prev_completed": float(pa.prev_completed),
        "curr_completed": float(pa.curr_completed),
        "stored_materials": float(pa.stored_materials),
        "retainage_pct": float(pa.retainage_pct),
        "previous_payments": float(pa.previous_payments),
    })
    for k, v in computed.items():
        setattr(pa, k, v)

    db.commit()
    db.refresh(pa)
    return _pay_app_dict(pa)


@router.delete("/{pay_app_id}", status_code=204)
def delete_pay_app(
    pay_app_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pa = db.query(PayApplication).filter(
        PayApplication.id == pay_app_id, PayApplication.tenant_id == current_user.tenant_id
    ).first()
    if not pa:
        raise HTTPException(status_code=404, detail="Pay application not found")
    db.delete(pa)
    db.commit()
