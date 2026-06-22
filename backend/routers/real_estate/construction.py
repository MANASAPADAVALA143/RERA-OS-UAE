import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.construction_extended import (
    ChangeOrder,
    ComplianceDoc,
    ExitStrategy,
    ProjectFinancials,
    ProjectROIAssumptions,
    ScheduleTask,
    ScheduleTaskStatus,
)
from models.real_estate.entity import Project
from services.construction_roi import (
    project_roi_forward_sale,
    realized_cash_position,
    simple_project_irr,
)
from services.real_estate_calculations import schedule_task_late_days, validate_task_status_consistency

router = APIRouter(prefix="/api/real-estate/construction", tags=["real-estate"])


def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.tenant_id == tenant_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _change_order_dict(co: ChangeOrder) -> dict:
    return {
        "id": str(co.id),
        "project_id": str(co.project_id),
        "co_number": co.co_number,
        "title": co.title,
        "description": co.description,
        "csi_division_code": co.csi_division_code,
        "trade_name": co.trade_name,
        "requested_amount": float(co.requested_amount),
        "approved_amount": float(co.approved_amount) if co.approved_amount is not None else None,
        "status": co.status.value,
        "reason_code": co.reason_code,
        "request_date": co.request_date.isoformat() if co.request_date else None,
        "approval_date": co.approval_date.isoformat() if co.approval_date else None,
        "impact_on_schedule_days": co.impact_on_schedule_days,
    }


def _schedule_task_dict(task: ScheduleTask) -> dict:
    late = schedule_task_late_days(task.planned_end, task.actual_end, task.pct_complete)

    planned_days = task.planned_duration_days
    if planned_days is None and task.planned_start and task.planned_end:
        planned_days = (task.planned_end - task.planned_start).days

    actual_days = None
    if task.actual_start and task.actual_end:
        actual_days = (task.actual_end - task.actual_start).days

    pct = float(task.pct_complete)
    consistency = validate_task_status_consistency(task.status.value, pct, task.actual_end)

    return {
        "id": str(task.id),
        "project_id": str(task.project_id),
        "task_name": task.task_name,
        "vendor_name": task.vendor_name,
        "division": task.division,
        "line_item_code": task.line_item_code,
        "line_item_name": task.line_item_name,
        "planned_start": task.planned_start.isoformat() if task.planned_start else None,
        "planned_end": task.planned_end.isoformat() if task.planned_end else None,
        "planned_duration_days": planned_days,
        "actual_start": task.actual_start.isoformat() if task.actual_start else None,
        "actual_end": task.actual_end.isoformat() if task.actual_end else None,
        "actual_duration_days": actual_days,
        "pct_complete": pct,
        "status": task.status.value,
        "status_override_reason": task.status_override_reason,
        "is_critical": task.is_critical,
        "is_milestone": task.is_milestone,
        "notes": task.notes,
        "has_inconsistency": not consistency["valid"],
        "inconsistency_detail": consistency.get("detail"),
        **late,
    }


def _compliance_doc_dict(doc: ComplianceDoc) -> dict:
    return {
        "id": str(doc.id),
        "project_id": str(doc.project_id),
        "vendor_name": doc.vendor_name,
        "doc_type": doc.doc_type,
        "doc_name": doc.doc_name,
        "status": doc.status.value,
        "issue_date": doc.issue_date.isoformat() if doc.issue_date else None,
        "expiry_date": doc.expiry_date.isoformat() if doc.expiry_date else None,
        "is_blocking": doc.is_blocking,
        "notes": doc.notes,
    }


def _snapshot_dict(snap: ProjectFinancials) -> dict:
    cash = realized_cash_position(
        snap.received_from_owner,
        snap.paid_to_subcontractors,
        snap.other_expenses,
        snap.retainage_held,
        snap.retainage_receivable,
    )
    return {
        "id": str(snap.id),
        "project_id": str(snap.project_id),
        "period_start": snap.period_start.isoformat() if snap.period_start else None,
        "period_end": snap.period_end.isoformat() if snap.period_end else None,
        "received_from_owner": float(snap.received_from_owner),
        "paid_to_subcontractors": float(snap.paid_to_subcontractors),
        "other_expenses": float(snap.other_expenses),
        "retainage_held": float(snap.retainage_held),
        "retainage_receivable": float(snap.retainage_receivable),
        "created_at": snap.created_at.isoformat(),
        "created_by": snap.created_by,
        **cash,
    }


def _assumptions_dict(row: ProjectROIAssumptions | None, project: Project) -> dict:
    if not row:
        return {
            "project_id": str(project.id),
            "total_project_cost": float(project.total_project_cost) if project.total_project_cost else None,
            "equity_pct": None,
            "debt_pct": None,
            "interest_rate_annual": None,
            "construction_months": None,
            "exit_strategy": ExitStrategy.forward_sale.value,
            "stabilized_noi": None,
            "exit_cap_rate": None,
            "selling_costs_pct": 0.025,
            "configured": False,
        }
    return {
        "project_id": str(row.project_id),
        "total_project_cost": float(row.total_project_cost) if row.total_project_cost is not None else None,
        "equity_pct": float(row.equity_pct) if row.equity_pct is not None else None,
        "debt_pct": float(row.debt_pct) if row.debt_pct is not None else None,
        "interest_rate_annual": float(row.interest_rate_annual) if row.interest_rate_annual is not None else None,
        "construction_months": row.construction_months,
        "exit_strategy": row.exit_strategy.value,
        "stabilized_noi": float(row.stabilized_noi) if row.stabilized_noi is not None else None,
        "exit_cap_rate": float(row.exit_cap_rate) if row.exit_cap_rate is not None else None,
        "selling_costs_pct": float(row.selling_costs_pct),
        "updated_at": row.updated_at.isoformat(),
        "configured": _assumptions_complete(row),
    }


def _assumptions_complete(row: ProjectROIAssumptions) -> bool:
    if not row.total_project_cost or row.equity_pct is None or row.debt_pct is None:
        return False
    if row.exit_strategy == ExitStrategy.forward_sale:
        return bool(row.stabilized_noi and row.exit_cap_rate)
    return True


class FinancialSnapshotCreate(BaseModel):
    period_start: date | None = None
    period_end: date | None = None
    received_from_owner: float = 0
    paid_to_subcontractors: float = 0
    other_expenses: float = 0
    retainage_held: float = 0
    retainage_receivable: float = 0


class ROIAssumptionsUpdate(BaseModel):
    total_project_cost: float | None = None
    equity_pct: float | None = None
    debt_pct: float | None = None
    interest_rate_annual: float | None = None
    construction_months: int | None = None
    exit_strategy: str = ExitStrategy.forward_sale.value
    stabilized_noi: float | None = None
    exit_cap_rate: float | None = None
    selling_costs_pct: float = Field(default=0.025)


@router.get("/change-orders")
def list_change_orders(
    project_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    rows = (
        db.query(ChangeOrder)
        .filter(ChangeOrder.tenant_id == current_user.tenant_id, ChangeOrder.project_id == pid)
        .order_by(ChangeOrder.co_number)
        .all()
    )
    items = [_change_order_dict(co) for co in rows]
    pending = sum(
        float(co.requested_amount)
        for co in rows
        if co.status.value in ("submitted", "pending_approval")
    )
    approved = sum(float(co.approved_amount or 0) for co in rows if co.status.value == "approved")
    return {
        "items": items,
        "summary": {
            "pending_exposure": round(pending, 2),
            "approved_total": round(approved, 2),
            "count": len(items),
        },
    }


@router.get("/schedule-tasks")
def list_schedule_tasks(
    project_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    rows = (
        db.query(ScheduleTask)
        .filter(ScheduleTask.tenant_id == current_user.tenant_id, ScheduleTask.project_id == pid)
        .order_by(ScheduleTask.planned_end)
        .all()
    )
    items = [_schedule_task_dict(t) for t in rows]
    late_count = sum(1 for i in items if i["is_late"])
    max_late = max((i["days_late"] for i in items), default=0)
    return {
        "items": items,
        "summary": {
            "total_tasks": len(items),
            "late_tasks": late_count,
            "max_days_late": max_late,
        },
    }


class TaskScheduleCreate(BaseModel):
    task_name: str
    vendor_name: str | None = None
    division: str | None = None
    line_item_code: str | None = None
    line_item_name: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    planned_duration_days: int | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    pct_complete: float = 0.0
    status: str = "not_started"
    is_critical: bool = False
    is_milestone: bool = False
    notes: str | None = None


class TaskScheduleUpdate(BaseModel):
    task_name: str | None = None
    vendor_name: str | None = None
    division: str | None = None
    line_item_code: str | None = None
    line_item_name: str | None = None
    planned_start: date | None = None
    planned_end: date | None = None
    planned_duration_days: int | None = None
    actual_start: date | None = None
    actual_end: date | None = None
    pct_complete: float | None = None
    status: str | None = None
    is_critical: bool | None = None
    is_milestone: bool | None = None
    notes: str | None = None
    # Override action — requires reason; bypasses status consistency check
    override_reason: str | None = None


@router.get("/projects/{project_id}/task-schedule")
def get_task_schedule(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Task schedule grouped by division. The same underlying ScheduleTask rows
    power the existing /schedule-tasks late-task exception view — no data fork.
    """
    _require_project(db, current_user.tenant_id, project_id)
    rows = (
        db.query(ScheduleTask)
        .filter(ScheduleTask.tenant_id == current_user.tenant_id, ScheduleTask.project_id == project_id)
        .order_by(ScheduleTask.division.nulls_last(), ScheduleTask.planned_start.nulls_last(), ScheduleTask.task_name)
        .all()
    )

    items = [_schedule_task_dict(t) for t in rows]

    # Group by division
    groups: dict[str, list] = {}
    for item in items:
        key = item["division"] or "— Unassigned —"
        groups.setdefault(key, []).append(item)

    grouped = [
        {
            "division": div,
            "task_count": len(tasks),
            "completed_count": sum(1 for t in tasks if t["status"] == "complete"),
            "in_progress_count": sum(1 for t in tasks if t["status"] == "in_progress"),
            "late_count": sum(1 for t in tasks if t["is_late"]),
            "inconsistency_count": sum(1 for t in tasks if t["has_inconsistency"]),
            "tasks": tasks,
        }
        for div, tasks in groups.items()
    ]

    total_inconsistencies = sum(1 for i in items if i["has_inconsistency"])
    return {
        "project_id": str(project_id),
        "summary": {
            "total_tasks": len(items),
            "completed": sum(1 for i in items if i["status"] == "complete"),
            "in_progress": sum(1 for i in items if i["status"] == "in_progress"),
            "not_started": sum(1 for i in items if i["status"] == "not_started"),
            "late": sum(1 for i in items if i["is_late"]),
            "inconsistencies": total_inconsistencies,
        },
        "groups": grouped,
    }


@router.post("/projects/{project_id}/task-schedule", status_code=201)
def create_task_schedule_item(
    project_id: uuid.UUID,
    body: TaskScheduleCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    _require_project(db, current_user.tenant_id, project_id)

    try:
        status_val = ScheduleTaskStatus(body.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")

    # Validate consistency — reject 'complete' with bad data unless override is set
    if status_val == ScheduleTaskStatus.complete:
        check = validate_task_status_consistency(body.status, body.pct_complete, body.actual_end)
        if not check["valid"]:
            raise HTTPException(status_code=422, detail=check["detail"])

    task = ScheduleTask(
        tenant_id=current_user.tenant_id,
        project_id=project_id,
        task_name=body.task_name,
        vendor_name=body.vendor_name,
        division=body.division,
        line_item_code=body.line_item_code,
        line_item_name=body.line_item_name,
        planned_start=body.planned_start,
        planned_end=body.planned_end,
        planned_duration_days=body.planned_duration_days,
        actual_start=body.actual_start,
        actual_end=body.actual_end,
        pct_complete=body.pct_complete,
        status=status_val,
        is_critical=body.is_critical,
        is_milestone=body.is_milestone,
        notes=body.notes,
        created_by=current_user.email,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _schedule_task_dict(task)


@router.put("/task-schedule/{task_id}")
def update_task_schedule_item(
    task_id: uuid.UUID,
    body: TaskScheduleUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    task = (
        db.query(ScheduleTask)
        .filter(ScheduleTask.id == task_id, ScheduleTask.tenant_id == current_user.tenant_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update = body.model_dump(exclude_none=True)

    # Handle override_reason path — sets status to 'override' and logs reason
    if "override_reason" in update:
        reason = update.pop("override_reason", "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="override_reason must not be empty when using Override Status")
        task.status = ScheduleTaskStatus.override
        task.status_override_reason = reason
    elif "status" in update:
        try:
            new_status = ScheduleTaskStatus(update["status"])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {update['status']}")

        pct = float(update.get("pct_complete", task.pct_complete))
        actual_end = update.get("actual_end", task.actual_end)
        if new_status == ScheduleTaskStatus.complete:
            check = validate_task_status_consistency("complete", pct, actual_end)
            if not check["valid"]:
                raise HTTPException(status_code=422, detail=check["detail"])
        task.status = new_status
        # Clear previous override reason when status explicitly re-set to a normal value
        if new_status != ScheduleTaskStatus.override:
            task.status_override_reason = None

    for field in ("task_name", "vendor_name", "division", "line_item_code", "line_item_name", "notes"):
        if field in update:
            setattr(task, field, update[field])
    for date_field in ("planned_start", "planned_end", "actual_start", "actual_end"):
        if date_field in update:
            setattr(task, date_field, update[date_field])
    for num_field in ("pct_complete", "planned_duration_days"):
        if num_field in update:
            setattr(task, num_field, update[num_field])
    for bool_field in ("is_critical", "is_milestone"):
        if bool_field in update:
            setattr(task, bool_field, update[bool_field])

    db.commit()
    db.refresh(task)
    return _schedule_task_dict(task)


@router.delete("/task-schedule/{task_id}", status_code=204)
def delete_task_schedule_item(
    task_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    task = (
        db.query(ScheduleTask)
        .filter(ScheduleTask.id == task_id, ScheduleTask.tenant_id == current_user.tenant_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()


@router.get("/compliance-docs")
def list_compliance_docs(
    project_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    rows = (
        db.query(ComplianceDoc)
        .filter(ComplianceDoc.tenant_id == current_user.tenant_id, ComplianceDoc.project_id == pid)
        .order_by(ComplianceDoc.vendor_name, ComplianceDoc.doc_type)
        .all()
    )
    items = [_compliance_doc_dict(d) for d in rows]
    vendors = {}
    for doc in rows:
        vendors.setdefault(doc.vendor_name, {"compliant": 0, "total": 0})
        vendors[doc.vendor_name]["total"] += 1
        if doc.status.value == "compliant":
            vendors[doc.vendor_name]["compliant"] += 1

    vendor_gaps = [
        {"vendor_name": name, "compliant_count": v["compliant"], "total_count": v["total"]}
        for name, v in vendors.items()
        if v["compliant"] == 0
    ]
    return {
        "items": items,
        "summary": {
            "total_docs": len(items),
            "missing_or_expired": sum(1 for i in items if i["status"] in ("missing", "expired")),
            "vendors_with_gaps": vendor_gaps,
        },
    }


@router.get("/projects/{project_id}/financials")
def get_project_financials(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require_project(db, current_user.tenant_id, project_id)
    rows = (
        db.query(ProjectFinancials)
        .filter(
            ProjectFinancials.tenant_id == current_user.tenant_id,
            ProjectFinancials.project_id == project_id,
        )
        .order_by(ProjectFinancials.created_at.desc())
        .all()
    )
    history = [_snapshot_dict(r) for r in rows]
    latest = history[0] if history else None
    return {
        "project_id": str(project_id),
        "project_code": project.project_code,
        "project_name": project.project_name,
        "latest": latest,
        "history": history,
    }


@router.post("/projects/{project_id}/financials")
def create_financial_snapshot(
    project_id: uuid.UUID,
    body: FinancialSnapshotCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    _require_project(db, current_user.tenant_id, project_id)
    snap = ProjectFinancials(
        tenant_id=current_user.tenant_id,
        project_id=project_id,
        period_start=body.period_start,
        period_end=body.period_end,
        received_from_owner=body.received_from_owner,
        paid_to_subcontractors=body.paid_to_subcontractors,
        other_expenses=body.other_expenses,
        retainage_held=body.retainage_held,
        retainage_receivable=body.retainage_receivable,
        created_by=current_user.email,
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return _snapshot_dict(snap)


@router.get("/projects/{project_id}/roi-assumptions")
def get_roi_assumptions(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require_project(db, current_user.tenant_id, project_id)
    row = (
        db.query(ProjectROIAssumptions)
        .filter(
            ProjectROIAssumptions.tenant_id == current_user.tenant_id,
            ProjectROIAssumptions.project_id == project_id,
        )
        .first()
    )
    return _assumptions_dict(row, project)


@router.put("/projects/{project_id}/roi-assumptions")
def upsert_roi_assumptions(
    project_id: uuid.UUID,
    body: ROIAssumptionsUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    _require_project(db, current_user.tenant_id, project_id)

    if body.equity_pct is not None and body.debt_pct is not None:
        pct_sum = float(body.equity_pct) + float(body.debt_pct)
        if abs(pct_sum - 1.0) > 0.001:
            raise HTTPException(
                status_code=400,
                detail=f"equity_pct and debt_pct must sum to 1.0 (got {pct_sum:.4f})",
            )

    try:
        exit_strategy = ExitStrategy(body.exit_strategy)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid exit_strategy: {body.exit_strategy}") from exc

    row = (
        db.query(ProjectROIAssumptions)
        .filter(
            ProjectROIAssumptions.tenant_id == current_user.tenant_id,
            ProjectROIAssumptions.project_id == project_id,
        )
        .first()
    )
    if not row:
        row = ProjectROIAssumptions(
            tenant_id=current_user.tenant_id,
            project_id=project_id,
        )
        db.add(row)

    row.total_project_cost = body.total_project_cost
    row.equity_pct = body.equity_pct
    row.debt_pct = body.debt_pct
    row.interest_rate_annual = body.interest_rate_annual
    row.construction_months = body.construction_months
    row.exit_strategy = exit_strategy
    row.stabilized_noi = body.stabilized_noi
    row.exit_cap_rate = body.exit_cap_rate
    row.selling_costs_pct = body.selling_costs_pct
    row.updated_by = current_user.email

    db.commit()
    db.refresh(row)
    project = _require_project(db, current_user.tenant_id, project_id)
    return _assumptions_dict(row, project)


@router.get("/projects/{project_id}/roi-summary")
def get_roi_summary(
    project_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _require_project(db, current_user.tenant_id, project_id)
    row = (
        db.query(ProjectROIAssumptions)
        .filter(
            ProjectROIAssumptions.tenant_id == current_user.tenant_id,
            ProjectROIAssumptions.project_id == project_id,
        )
        .first()
    )

    if not row or not _assumptions_complete(row):
        return {"project_id": str(project_id), "configured": False}

    if row.exit_strategy != ExitStrategy.forward_sale:
        return {
            "project_id": str(project_id),
            "configured": False,
            "message": f"ROI calculation not yet implemented for exit_strategy '{row.exit_strategy.value}'",
        }

    result = project_roi_forward_sale(
        total_project_cost=row.total_project_cost,
        equity_pct=row.equity_pct,
        debt_pct=row.debt_pct,
        interest_rate_annual=row.interest_rate_annual or 0,
        construction_months=row.construction_months or 0,
        stabilized_noi=row.stabilized_noi,
        exit_cap_rate=row.exit_cap_rate,
        selling_costs_pct=row.selling_costs_pct,
    )

    if result.get("error"):
        return {"project_id": str(project_id), "configured": False, "message": result["error"]}

    irr = simple_project_irr(
        result.get("equity_invested"),
        row.construction_months,
        result.get("net_sale_proceeds"),
    )

    return {
        "project_id": str(project_id),
        "configured": True,
        "exit_strategy": row.exit_strategy.value,
        "roi": result.get("roi"),
        "moic": result.get("moic"),
        "irr": irr,
        "irr_is_simplified": True,
        "irr_note": (
            "Simplified IRR assumes one equity outflow at start and one exit inflow — "
            "not a substitute for a full quarterly cash flow model."
        ),
        "net_profit": result.get("net_profit"),
        "exit_value": result.get("exit_value"),
        "net_sale_proceeds": result.get("net_sale_proceeds"),
        "equity_invested": result.get("equity_invested"),
        "debt_drawn": result.get("debt_drawn"),
        "interest_during_construction": result.get("interest_during_construction"),
        "selling_costs": result.get("selling_costs"),
        "is_estimate": result.get("is_estimate"),
        "estimate_note": result.get("estimate_note"),
    }
