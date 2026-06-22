import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.construction_extended import (
    ChangeOrder,
    ChangeOrderStatus,
    ChangeOrderTaskLine,
    TaskLineAction,
    TaskLineScope,
)
from models.real_estate.entity import Project
from services.change_request_calculations import (
    change_order_line_revised_value,
    change_order_list_summary,
    change_order_net_cost_impact,
    change_order_net_schedule_impact,
)

router = APIRouter(prefix="/api/real-estate/change-requests", tags=["real-estate"])


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.tenant_id == tenant_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _require_co(db: Session, tenant_id, co_id: uuid.UUID) -> ChangeOrder:
    co = (
        db.query(ChangeOrder)
        .options(selectinload(ChangeOrder.task_lines))
        .filter(ChangeOrder.id == co_id, ChangeOrder.tenant_id == tenant_id)
        .first()
    )
    if not co:
        raise HTTPException(status_code=404, detail="Change request not found")
    return co


def _legacy_amount(co: ChangeOrder) -> float:
    """Fallback cost impact for CRs with no task lines."""
    if co.status == ChangeOrderStatus.approved and co.approved_amount is not None:
        return float(co.approved_amount)
    return float(co.requested_amount)


def _line_dict(line: ChangeOrderTaskLine) -> dict:
    orig_val = float(line.original_value)
    impact = float(line.cost_impact)
    return {
        "id": str(line.id),
        "change_order_id": str(line.change_order_id),
        "division": line.division,
        "subdivision": line.subdivision,
        "task": line.task,
        "scope": line.scope.value if line.scope else None,
        "original_value": orig_val,
        "cost_impact": impact,
        "revised_sched_value": change_order_line_revised_value(orig_val, impact),
        "action": line.action.value if line.action else None,
        "orig_start_date": line.orig_start_date.isoformat() if line.orig_start_date else None,
        "orig_end_date": line.orig_end_date.isoformat() if line.orig_end_date else None,
        "orig_duration_days": line.orig_duration_days,
        "revised_start_date": line.revised_start_date.isoformat() if line.revised_start_date else None,
        "revised_end_date": line.revised_end_date.isoformat() if line.revised_end_date else None,
        "revised_duration_days": line.revised_duration_days,
        "schedule_impact_days": line.schedule_impact_days,
        "created_by": line.created_by,
        "created_at": line.created_at.isoformat(),
    }


def _co_summary_dict(co: ChangeOrder) -> dict:
    """Light dict for the list view — no full task line payload."""
    net_impact = change_order_net_cost_impact(co.task_lines, _legacy_amount(co))
    return {
        "id": str(co.id),
        "project_id": str(co.project_id),
        "co_number": co.co_number,
        "subject": co.title,
        "status": co.status.value,
        "csi_division_code": co.csi_division_code,
        "trade_name": co.trade_name,
        "requested_by": co.requested_by,
        "due_date": co.due_date.isoformat() if co.due_date else None,
        "net_cost_impact": round(net_impact, 2),
        "task_line_count": len(co.task_lines),
    }


def _co_detail_dict(co: ChangeOrder) -> dict:
    """Full dict for the detail view — includes all header fields and task lines."""
    lines = [_line_dict(ln) for ln in co.task_lines]
    net_impact = change_order_net_cost_impact(co.task_lines, _legacy_amount(co))
    net_sched = change_order_net_schedule_impact(co.task_lines)
    return {
        "id": str(co.id),
        "project_id": str(co.project_id),
        "co_number": co.co_number,
        "subject": co.title,
        "description": co.description,
        "status": co.status.value,
        "csi_division_code": co.csi_division_code,
        "trade_name": co.trade_name,
        "requested_by": co.requested_by,
        "created_by": co.created_by,
        "due_date": co.due_date.isoformat() if co.due_date else None,
        "request_date": co.request_date.isoformat() if co.request_date else None,
        "approval_date": co.approval_date.isoformat() if co.approval_date else None,
        "type_of_reference": co.type_of_reference,
        "approver": co.approver,
        "attached_cr": co.attached_cr,
        "gc_superintendent": co.gc_superintendent,
        "reason_code": co.reason_code,
        "requested_amount": float(co.requested_amount),
        "approved_amount": float(co.approved_amount) if co.approved_amount is not None else None,
        "net_cost_impact": round(net_impact, 2),
        "net_schedule_impact_days": net_sched,
        "created_at": co.created_at.isoformat(),
        "updated_at": co.updated_at.isoformat(),
        "task_lines": lines,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class ChangeRequestCreate(BaseModel):
    project_id: str
    co_number: str
    subject: str
    description: str | None = None
    status: str = "draft"
    csi_division_code: str | None = None
    trade_name: str | None = None
    requested_amount: float = 0
    requested_by: str | None = None
    due_date: date | None = None
    type_of_reference: str | None = None
    approver: str | None = None
    attached_cr: str | None = None
    gc_superintendent: str | None = None
    reason_code: str | None = None
    request_date: date | None = None


class ChangeRequestUpdate(BaseModel):
    subject: str | None = None
    description: str | None = None
    status: str | None = None
    csi_division_code: str | None = None
    trade_name: str | None = None
    requested_amount: float | None = None
    approved_amount: float | None = None
    requested_by: str | None = None
    due_date: date | None = None
    type_of_reference: str | None = None
    approver: str | None = None
    attached_cr: str | None = None
    gc_superintendent: str | None = None
    reason_code: str | None = None
    request_date: date | None = None
    approval_date: date | None = None


class TaskLineCreate(BaseModel):
    division: str | None = None
    subdivision: str | None = None
    task: str | None = None
    scope: str | None = None
    original_value: float = 0
    cost_impact: float = 0
    action: str | None = None
    orig_start_date: date | None = None
    orig_end_date: date | None = None
    orig_duration_days: int | None = None
    revised_start_date: date | None = None
    revised_end_date: date | None = None
    revised_duration_days: int | None = None
    schedule_impact_days: int | None = None


class TaskLineUpdate(TaskLineCreate):
    pass


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_change_requests(
    project_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    cos = (
        db.query(ChangeOrder)
        .options(selectinload(ChangeOrder.task_lines))
        .filter(ChangeOrder.tenant_id == current_user.tenant_id, ChangeOrder.project_id == pid)
        .order_by(ChangeOrder.co_number)
        .all()
    )
    items = [_co_summary_dict(co) for co in cos]
    return {
        "items": items,
        "summary": change_order_list_summary(items),
    }


@router.get("/{co_id}")
def get_change_request(
    co_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    co = _require_co(db, current_user.tenant_id, co_id)
    return _co_detail_dict(co)


@router.post("")
def create_change_request(
    body: ChangeRequestCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(body.project_id)
    _require_project(db, current_user.tenant_id, pid)
    try:
        status = ChangeOrderStatus(body.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    co = ChangeOrder(
        tenant_id=current_user.tenant_id,
        project_id=pid,
        co_number=body.co_number,
        title=body.subject,
        description=body.description,
        status=status,
        csi_division_code=body.csi_division_code,
        trade_name=body.trade_name,
        requested_amount=body.requested_amount,
        requested_by=body.requested_by,
        due_date=body.due_date,
        type_of_reference=body.type_of_reference,
        approver=body.approver,
        attached_cr=body.attached_cr,
        gc_superintendent=body.gc_superintendent,
        reason_code=body.reason_code,
        request_date=body.request_date,
        created_by=current_user.email,
    )
    db.add(co)
    db.commit()
    db.refresh(co)
    return _co_detail_dict(co)


@router.put("/{co_id}")
def update_change_request(
    co_id: uuid.UUID,
    body: ChangeRequestUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = _require_co(db, current_user.tenant_id, co_id)
    if body.subject is not None:
        co.title = body.subject
    if body.description is not None:
        co.description = body.description
    if body.status is not None:
        try:
            co.status = ChangeOrderStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    if body.csi_division_code is not None:
        co.csi_division_code = body.csi_division_code
    if body.trade_name is not None:
        co.trade_name = body.trade_name
    if body.requested_amount is not None:
        co.requested_amount = body.requested_amount
    if body.approved_amount is not None:
        co.approved_amount = body.approved_amount
    if body.requested_by is not None:
        co.requested_by = body.requested_by
    if body.due_date is not None:
        co.due_date = body.due_date
    if body.type_of_reference is not None:
        co.type_of_reference = body.type_of_reference
    if body.approver is not None:
        co.approver = body.approver
    if body.attached_cr is not None:
        co.attached_cr = body.attached_cr
    if body.gc_superintendent is not None:
        co.gc_superintendent = body.gc_superintendent
    if body.reason_code is not None:
        co.reason_code = body.reason_code
    if body.request_date is not None:
        co.request_date = body.request_date
    if body.approval_date is not None:
        co.approval_date = body.approval_date
    db.commit()
    db.refresh(co)
    return _co_detail_dict(co)


@router.post("/{co_id}/task-lines")
def add_task_line(
    co_id: uuid.UUID,
    body: TaskLineCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = _require_co(db, current_user.tenant_id, co_id)
    scope = TaskLineScope(body.scope) if body.scope else None
    action = TaskLineAction(body.action) if body.action else None
    line = ChangeOrderTaskLine(
        tenant_id=current_user.tenant_id,
        change_order_id=co.id,
        division=body.division,
        subdivision=body.subdivision,
        task=body.task,
        scope=scope,
        original_value=body.original_value,
        cost_impact=body.cost_impact,
        action=action,
        orig_start_date=body.orig_start_date,
        orig_end_date=body.orig_end_date,
        orig_duration_days=body.orig_duration_days,
        revised_start_date=body.revised_start_date,
        revised_end_date=body.revised_end_date,
        revised_duration_days=body.revised_duration_days,
        schedule_impact_days=body.schedule_impact_days,
        created_by=current_user.email,
    )
    db.add(line)
    db.commit()
    db.refresh(co)
    return _co_detail_dict(co)


@router.put("/{co_id}/task-lines/{line_id}")
def update_task_line(
    co_id: uuid.UUID,
    line_id: uuid.UUID,
    body: TaskLineUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = _require_co(db, current_user.tenant_id, co_id)
    line = next((ln for ln in co.task_lines if ln.id == line_id), None)
    if not line:
        raise HTTPException(status_code=404, detail="Task line not found")
    if body.division is not None:
        line.division = body.division
    if body.subdivision is not None:
        line.subdivision = body.subdivision
    if body.task is not None:
        line.task = body.task
    if body.scope is not None:
        line.scope = TaskLineScope(body.scope)
    line.original_value = body.original_value
    line.cost_impact = body.cost_impact
    if body.action is not None:
        line.action = TaskLineAction(body.action)
    line.orig_start_date = body.orig_start_date
    line.orig_end_date = body.orig_end_date
    line.orig_duration_days = body.orig_duration_days
    line.revised_start_date = body.revised_start_date
    line.revised_end_date = body.revised_end_date
    line.revised_duration_days = body.revised_duration_days
    line.schedule_impact_days = body.schedule_impact_days
    db.commit()
    db.refresh(co)
    return _co_detail_dict(co)


@router.delete("/{co_id}/task-lines/{line_id}", status_code=204)
def delete_task_line(
    co_id: uuid.UUID,
    line_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = _require_co(db, current_user.tenant_id, co_id)
    line = next((ln for ln in co.task_lines if ln.id == line_id), None)
    if not line:
        raise HTTPException(status_code=404, detail="Task line not found")
    db.delete(line)
    db.commit()
