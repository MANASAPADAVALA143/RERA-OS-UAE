import uuid
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.construction_cost import CostTrade
from models.real_estate.entity import Project
from models.real_estate.inspection import Inspection, InspectionStatus, InspectionType

router = APIRouter(prefix="/api/real-estate/inspections", tags=["real-estate"])


def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.tenant_id == tenant_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _require_inspection(db: Session, tenant_id, insp_id: uuid.UUID) -> Inspection:
    insp = (
        db.query(Inspection)
        .options(joinedload(Inspection.linked_sov))
        .filter(Inspection.id == insp_id, Inspection.tenant_id == tenant_id)
        .first()
    )
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return insp


def _sov_breadcrumb(sov: CostTrade | None) -> str | None:
    if not sov:
        return None
    parts = []
    if sov.csi_division_code:
        parts.append(sov.csi_division_code)
    label = sov.division_label or sov.trade_name.value.replace("_", " ").title()
    if label:
        parts.append(label)
    return " - ".join(parts) if parts else None


def _insp_dict(insp: Inspection) -> dict:
    return {
        "id": str(insp.id),
        "project_id": str(insp.project_id),
        "inspection_number": insp.inspection_number,
        "title": insp.title,
        "linked_sov_id": str(insp.linked_sov_id) if insp.linked_sov_id else None,
        "linked_sov_label": _sov_breadcrumb(insp.linked_sov) if insp.linked_sov else None,
        "inspection_type": insp.inspection_type.value,
        "status": insp.status.value,
        "inspection_date": insp.inspection_date.isoformat() if insp.inspection_date else None,
        "performed_by_org": insp.performed_by_org,
        "performed_by_internal": insp.performed_by_internal,
        "notes": insp.notes,
        "created_by": insp.created_by,
        "created_at": insp.created_at.isoformat(),
        "updated_at": insp.updated_at.isoformat(),
    }


def _next_inspection_number(db: Session, tenant_id, project_id: uuid.UUID) -> str:
    """Generate next project-scoped inspection number, e.g. INSP-001."""
    count = (
        db.query(func.count(Inspection.id))
        .filter(Inspection.tenant_id == tenant_id, Inspection.project_id == project_id)
        .scalar()
    ) or 0
    return f"INSP-{count + 1:03d}"


def _build_summary(inspections: list[Inspection]) -> dict:
    total = len(inspections)
    counts = {s.value: 0 for s in InspectionStatus}
    for insp in inspections:
        counts[insp.status.value] += 1

    def pct(n: int) -> float:
        return round(n / total * 100, 1) if total > 0 else 0.0

    return {
        "total": total,
        "open": counts["open"],
        "scheduled": counts["scheduled"],
        "passed": counts["passed"],
        "failed": counts["failed"],
        "pct_open": pct(counts["open"]),
        "pct_scheduled": pct(counts["scheduled"]),
        "pct_passed": pct(counts["passed"]),
        "pct_failed": pct(counts["failed"]),
    }


def _build_groups(inspections: list[Inspection]) -> list[dict]:
    """Group inspections by linked_sov_id, sorted by group count desc."""
    groups: dict[str, dict] = {}
    for insp in inspections:
        key = str(insp.linked_sov_id) if insp.linked_sov_id else "__none__"
        if key not in groups:
            groups[key] = {
                "linked_sov_id": str(insp.linked_sov_id) if insp.linked_sov_id else None,
                "linked_sov_label": _sov_breadcrumb(insp.linked_sov) if insp.linked_sov else "Unlinked",
                "count": 0,
                "inspections": [],
            }
        groups[key]["count"] += 1
        groups[key]["inspections"].append(_insp_dict(insp))
    return sorted(groups.values(), key=lambda g: g["count"], reverse=True)


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class InspectionCreate(BaseModel):
    project_id: str
    title: str
    linked_sov_id: str | None = None
    inspection_type: str = "other"
    status: str = "open"
    inspection_date: date | None = None
    performed_by_org: str | None = None
    performed_by_internal: str | None = None
    notes: str | None = None


class InspectionUpdate(BaseModel):
    title: str | None = None
    linked_sov_id: str | None = None
    inspection_type: str | None = None
    status: str | None = None
    inspection_date: date | None = None
    performed_by_org: str | None = None
    performed_by_internal: str | None = None
    notes: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_inspections(
    project_id: str,
    status: str | None = None,
    inspection_type: str | None = None,
    linked_sov_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    q = (
        db.query(Inspection)
        .options(joinedload(Inspection.linked_sov))
        .filter(Inspection.tenant_id == current_user.tenant_id, Inspection.project_id == pid)
    )
    if status:
        try:
            q = q.filter(Inspection.status == InspectionStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    if inspection_type:
        try:
            q = q.filter(Inspection.inspection_type == InspectionType(inspection_type))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid inspection_type: {inspection_type}")
    if linked_sov_id:
        q = q.filter(Inspection.linked_sov_id == uuid.UUID(linked_sov_id))
    inspections = q.order_by(Inspection.inspection_number).all()
    return {
        "summary": _build_summary(inspections),
        "groups": _build_groups(inspections),
        "inspection_types": [t.value for t in InspectionType],
    }


@router.get("/{insp_id}")
def get_inspection(
    insp_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _insp_dict(_require_inspection(db, current_user.tenant_id, insp_id))


@router.post("")
def create_inspection(
    body: InspectionCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(body.project_id)
    _require_project(db, current_user.tenant_id, pid)
    try:
        insp_type = InspectionType(body.inspection_type)
        status = InspectionStatus(body.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    sov_id = None
    if body.linked_sov_id:
        sov_id = uuid.UUID(body.linked_sov_id)
        sov = db.query(CostTrade).filter(CostTrade.id == sov_id, CostTrade.tenant_id == current_user.tenant_id).first()
        if not sov:
            raise HTTPException(status_code=404, detail="SOV trade not found")
    insp_number = _next_inspection_number(db, current_user.tenant_id, pid)
    insp = Inspection(
        tenant_id=current_user.tenant_id,
        project_id=pid,
        inspection_number=insp_number,
        title=body.title,
        linked_sov_id=sov_id,
        inspection_type=insp_type,
        status=status,
        inspection_date=body.inspection_date,
        performed_by_org=body.performed_by_org,
        performed_by_internal=body.performed_by_internal,
        notes=body.notes,
        created_by=current_user.email,
    )
    db.add(insp)
    db.commit()
    db.refresh(insp)
    return _insp_dict(_require_inspection(db, current_user.tenant_id, insp.id))


@router.put("/{insp_id}")
def update_inspection(
    insp_id: uuid.UUID,
    body: InspectionUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    insp = _require_inspection(db, current_user.tenant_id, insp_id)
    if body.title is not None:
        insp.title = body.title
    if body.linked_sov_id is not None:
        sov_id = uuid.UUID(body.linked_sov_id) if body.linked_sov_id else None
        if sov_id:
            sov = db.query(CostTrade).filter(CostTrade.id == sov_id, CostTrade.tenant_id == current_user.tenant_id).first()
            if not sov:
                raise HTTPException(status_code=404, detail="SOV trade not found")
        insp.linked_sov_id = sov_id
    if body.inspection_type is not None:
        try:
            insp.inspection_type = InspectionType(body.inspection_type)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid inspection_type: {body.inspection_type}")
    if body.status is not None:
        try:
            insp.status = InspectionStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    if body.inspection_date is not None:
        insp.inspection_date = body.inspection_date
    if body.performed_by_org is not None:
        insp.performed_by_org = body.performed_by_org
    if body.performed_by_internal is not None:
        insp.performed_by_internal = body.performed_by_internal
    if body.notes is not None:
        insp.notes = body.notes
    db.commit()
    db.refresh(insp)
    return _insp_dict(_require_inspection(db, current_user.tenant_id, insp.id))
