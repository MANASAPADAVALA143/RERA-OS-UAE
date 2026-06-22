import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.construction_cost import CostTrade
from models.real_estate.entity import Project
from models.real_estate.quality_check import QCStatus, QualityCheck

router = APIRouter(prefix="/api/real-estate/quality-checks", tags=["real-estate"])


def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.tenant_id == tenant_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _require_qc(db: Session, tenant_id, qc_id: uuid.UUID) -> QualityCheck:
    qc = (
        db.query(QualityCheck)
        .options(joinedload(QualityCheck.linked_sov))
        .filter(QualityCheck.id == qc_id, QualityCheck.tenant_id == tenant_id)
        .first()
    )
    if not qc:
        raise HTTPException(status_code=404, detail="Quality check not found")
    return qc


def _sov_label(sov: CostTrade | None) -> str | None:
    if not sov:
        return None
    if sov.division_label:
        return sov.division_label
    return sov.trade_name.value.replace("_", " ").title()


def _qc_dict(qc: QualityCheck) -> dict:
    return {
        "id": str(qc.id),
        "project_id": str(qc.project_id),
        "linked_sov_id": str(qc.linked_sov_id) if qc.linked_sov_id else None,
        "linked_sov_label": _sov_label(qc.linked_sov) if qc.linked_sov_id else None,
        "linked_sov_code": qc.linked_sov.csi_division_code if qc.linked_sov else None,
        "qc_date": qc.qc_date.isoformat() if qc.qc_date else None,
        "start_date": qc.start_date.isoformat() if qc.start_date else None,
        "end_date": qc.end_date.isoformat() if qc.end_date else None,
        "pct_complete": float(qc.pct_complete) if qc.pct_complete is not None else None,
        "qc_performed_by": qc.qc_performed_by,
        "notes": qc.notes,
        "materials_notes": qc.materials_notes,
        "status": qc.status.value,
        "created_by": qc.created_by,
        "created_at": qc.created_at.isoformat(),
        "updated_at": qc.updated_at.isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class QCCreate(BaseModel):
    project_id: str
    linked_sov_id: str | None = None
    qc_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None
    pct_complete: float | None = None
    qc_performed_by: str | None = None
    notes: str | None = None
    materials_notes: str | None = None
    status: str = "pending"


class QCUpdate(BaseModel):
    linked_sov_id: str | None = None
    qc_date: date | None = None
    start_date: date | None = None
    end_date: date | None = None
    pct_complete: float | None = None
    qc_performed_by: str | None = None
    notes: str | None = None
    materials_notes: str | None = None
    status: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_quality_checks(
    project_id: str,
    linked_sov_id: str | None = None,
    status: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    q = (
        db.query(QualityCheck)
        .options(joinedload(QualityCheck.linked_sov))
        .filter(QualityCheck.tenant_id == current_user.tenant_id, QualityCheck.project_id == pid)
    )
    if linked_sov_id:
        q = q.filter(QualityCheck.linked_sov_id == uuid.UUID(linked_sov_id))
    if status:
        try:
            q = q.filter(QualityCheck.status == QCStatus(status))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    qcs = q.order_by(QualityCheck.qc_date.desc().nullslast()).all()
    return {"items": [_qc_dict(qc) for qc in qcs]}


@router.post("")
def create_quality_check(
    body: QCCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(body.project_id)
    _require_project(db, current_user.tenant_id, pid)
    try:
        status = QCStatus(body.status)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    # Validate linked_sov_id belongs to this tenant's project
    sov_id = None
    if body.linked_sov_id:
        sov_id = uuid.UUID(body.linked_sov_id)
        sov = db.query(CostTrade).filter(CostTrade.id == sov_id, CostTrade.tenant_id == current_user.tenant_id).first()
        if not sov:
            raise HTTPException(status_code=404, detail="SOV trade not found")
    qc = QualityCheck(
        tenant_id=current_user.tenant_id,
        project_id=pid,
        linked_sov_id=sov_id,
        qc_date=body.qc_date,
        start_date=body.start_date,
        end_date=body.end_date,
        pct_complete=body.pct_complete,
        qc_performed_by=body.qc_performed_by,
        notes=body.notes,
        materials_notes=body.materials_notes,
        status=status,
        created_by=current_user.email,
    )
    db.add(qc)
    db.commit()
    db.refresh(qc)
    return _qc_dict(_require_qc(db, current_user.tenant_id, qc.id))


@router.put("/{qc_id}")
def update_quality_check(
    qc_id: uuid.UUID,
    body: QCUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    qc = _require_qc(db, current_user.tenant_id, qc_id)
    if body.linked_sov_id is not None:
        sov_id = uuid.UUID(body.linked_sov_id) if body.linked_sov_id else None
        if sov_id:
            sov = db.query(CostTrade).filter(CostTrade.id == sov_id, CostTrade.tenant_id == current_user.tenant_id).first()
            if not sov:
                raise HTTPException(status_code=404, detail="SOV trade not found")
        qc.linked_sov_id = sov_id
    if body.qc_date is not None:
        qc.qc_date = body.qc_date
    if body.start_date is not None:
        qc.start_date = body.start_date
    if body.end_date is not None:
        qc.end_date = body.end_date
    if body.pct_complete is not None:
        qc.pct_complete = body.pct_complete
    if body.qc_performed_by is not None:
        qc.qc_performed_by = body.qc_performed_by
    if body.notes is not None:
        qc.notes = body.notes
    if body.materials_notes is not None:
        qc.materials_notes = body.materials_notes
    if body.status is not None:
        try:
            qc.status = QCStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
    db.commit()
    db.refresh(qc)
    return _qc_dict(_require_qc(db, current_user.tenant_id, qc.id))
