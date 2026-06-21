import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.permitting import Permit, PermitStatus, PermitType
from services.real_estate_calculations import permit_days_pending

router = APIRouter(prefix="/api/real-estate/permits", tags=["real-estate"])


class PermitCreate(BaseModel):
    project_id: str
    permit_type: str
    issuing_authority: str | None = None
    budgeted_cost: float = 0
    actual_cost: float = 0
    status: str = "not_started"
    is_blocking: bool = False
    application_date: date | None = None
    target_approval_date: date | None = None


def _permit_row(p: Permit):
    computed = permit_days_pending(p.application_date, p.target_approval_date, p.actual_approval_date)
    return {
        "id": str(p.id),
        "project_id": str(p.project_id),
        "permit_type": p.permit_type.value,
        "issuing_authority": p.issuing_authority,
        "budgeted_cost": float(p.budgeted_cost),
        "actual_cost": float(p.actual_cost),
        "status": p.status.value,
        "is_blocking": p.is_blocking,
        "application_date": p.application_date.isoformat() if p.application_date else None,
        "target_approval_date": p.target_approval_date.isoformat() if p.target_approval_date else None,
        "actual_approval_date": p.actual_approval_date.isoformat() if p.actual_approval_date else None,
        **computed,
    }


@router.get("")
def list_permits(
    project_id: str | None = None,
    status: str | None = None,
    is_blocking: bool | None = None,
    is_overdue: bool | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Permit).filter(Permit.tenant_id == current_user.tenant_id)
    if project_id:
        q = q.filter(Permit.project_id == uuid.UUID(project_id))
    if status:
        q = q.filter(Permit.status == PermitStatus(status))
    if is_blocking is not None:
        q = q.filter(Permit.is_blocking == is_blocking)

    rows = [_permit_row(p) for p in q.all()]
    if is_overdue is not None:
        rows = [r for r in rows if r["is_overdue"] == is_overdue]
    return rows


@router.get("/at-risk")
def permits_at_risk(
    project_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Permit).filter(
        Permit.tenant_id == current_user.tenant_id,
        Permit.is_blocking == True,  # noqa: E712
        Permit.actual_approval_date.is_(None),
    )
    if project_id:
        q = q.filter(Permit.project_id == uuid.UUID(project_id))

    today = date.today()
    threshold = today + timedelta(days=14)
    at_risk = []
    for p in q.all():
        row = _permit_row(p)
        overdue = row["is_overdue"]
        near_deadline = p.target_approval_date and p.target_approval_date <= threshold
        if overdue or near_deadline:
            at_risk.append(row)
    return at_risk


@router.post("")
def create_permit(
    body: PermitCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    permit = Permit(
        tenant_id=current_user.tenant_id,
        project_id=uuid.UUID(body.project_id),
        permit_type=PermitType(body.permit_type),
        issuing_authority=body.issuing_authority,
        budgeted_cost=body.budgeted_cost,
        actual_cost=body.actual_cost,
        status=PermitStatus(body.status),
        is_blocking=body.is_blocking,
        application_date=body.application_date,
        target_approval_date=body.target_approval_date,
        created_by=current_user.user_id,
    )
    db.add(permit)
    db.commit()
    db.refresh(permit)
    return _permit_row(permit)
