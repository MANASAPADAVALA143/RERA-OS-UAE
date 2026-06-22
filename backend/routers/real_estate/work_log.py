import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.entity import Project
from models.real_estate.work_log import SiteCondition, WorkLogEntry, WorkLogImage, WorkLogNote, WorkLogStatus
from services import storage

router = APIRouter(prefix="/api/real-estate/work-log", tags=["real-estate"])


def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.tenant_id == tenant_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _require_entry(db: Session, tenant_id, entry_id: uuid.UUID) -> WorkLogEntry:
    e = (
        db.query(WorkLogEntry)
        .options(selectinload(WorkLogEntry.images), selectinload(WorkLogEntry.notes))
        .filter(WorkLogEntry.id == entry_id, WorkLogEntry.tenant_id == tenant_id)
        .first()
    )
    if not e:
        raise HTTPException(status_code=404, detail="Work log entry not found")
    return e


def _entry_dict(entry: WorkLogEntry) -> dict:
    return {
        "id": str(entry.id),
        "project_id": str(entry.project_id),
        "report_date": entry.report_date,
        "status": entry.status.value,
        "site_condition": entry.site_condition.value,
        "created_by": entry.created_by,
        "created_at": entry.created_at.isoformat(),
        "updated_at": entry.updated_at.isoformat(),
        "image_count": len(entry.images),
        "images": [
            {
                "id": str(img.id),
                "file_reference": img.file_reference,
                "image_url": storage.get_url(img.file_reference),
                "caption": img.caption,
                "uploaded_at": img.uploaded_at.isoformat(),
            }
            for img in entry.images
        ],
        "notes": [
            {
                "id": str(n.id),
                "sequence_number": n.sequence_number,
                "trade_or_crew": n.trade_or_crew,
                "narrative": n.narrative,
                "created_at": n.created_at.isoformat(),
            }
            for n in sorted(entry.notes, key=lambda x: x.sequence_number)
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class WorkLogEntryCreate(BaseModel):
    project_id: str
    report_date: str          # YYYY-MM-DD
    status: str = "open"
    site_condition: str = "sunny"


class WorkLogNoteCreate(BaseModel):
    sequence_number: int | None = None  # auto-assigned as max+1 if omitted
    trade_or_crew: str | None = None
    narrative: str


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_entries(
    project_id: str,
    date: str | None = None,       # filter to a single date (YYYY-MM-DD)
    date_from: str | None = None,  # inclusive range start
    date_to: str | None = None,    # inclusive range end
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    q = (
        db.query(WorkLogEntry)
        .options(selectinload(WorkLogEntry.images), selectinload(WorkLogEntry.notes))
        .filter(WorkLogEntry.tenant_id == current_user.tenant_id, WorkLogEntry.project_id == pid)
    )
    if date:
        q = q.filter(WorkLogEntry.report_date == date)
    if date_from:
        q = q.filter(WorkLogEntry.report_date >= date_from)
    if date_to:
        q = q.filter(WorkLogEntry.report_date <= date_to)
    entries = q.order_by(WorkLogEntry.report_date.desc()).all()
    return {"entries": [_entry_dict(e) for e in entries]}


@router.post("")
def create_entry(
    body: WorkLogEntryCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(body.project_id)
    _require_project(db, current_user.tenant_id, pid)
    try:
        status = WorkLogStatus(body.status)
        condition = SiteCondition(body.site_condition)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    entry = WorkLogEntry(
        tenant_id=current_user.tenant_id,
        project_id=pid,
        report_date=body.report_date,
        status=status,
        site_condition=condition,
        created_by=current_user.email,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    # Reload with relationships
    return _entry_dict(_require_entry(db, current_user.tenant_id, entry.id))


@router.post("/{entry_id}/images")
async def upload_image(
    entry_id: uuid.UUID,
    caption: str | None = Form(default=None),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    entry = _require_entry(db, current_user.tenant_id, entry_id)
    suffix = Path(file.filename or "image.jpg").suffix.lower() or ".jpg"
    filename = f"{uuid.uuid4().hex}{suffix}"
    contents = await file.read()
    storage.put_file(contents, filename, content_type=file.content_type or "image/jpeg")
    img = WorkLogImage(
        tenant_id=current_user.tenant_id,
        work_log_entry_id=entry.id,
        file_reference=filename,
        caption=caption,
    )
    db.add(img)
    db.commit()
    return _entry_dict(_require_entry(db, current_user.tenant_id, entry.id))


@router.post("/{entry_id}/notes")
def add_note(
    entry_id: uuid.UUID,
    body: WorkLogNoteCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    entry = _require_entry(db, current_user.tenant_id, entry_id)
    # Auto-assign sequence_number as max existing + 1 if not provided
    if body.sequence_number is not None:
        seq = body.sequence_number
    else:
        existing_seqs = [n.sequence_number for n in entry.notes]
        seq = (max(existing_seqs) + 1) if existing_seqs else 1
    note = WorkLogNote(
        tenant_id=current_user.tenant_id,
        work_log_entry_id=entry.id,
        sequence_number=seq,
        trade_or_crew=body.trade_or_crew,
        narrative=body.narrative,
    )
    db.add(note)
    db.commit()
    return _entry_dict(_require_entry(db, current_user.tenant_id, entry.id))


@router.delete("/{entry_id}/notes/{note_id}", status_code=204)
def delete_note(
    entry_id: uuid.UUID,
    note_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    entry = _require_entry(db, current_user.tenant_id, entry_id)
    note = next((n for n in entry.notes if n.id == note_id), None)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()


@router.delete("/{entry_id}/images/{image_id}", status_code=204)
def delete_image(
    entry_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    entry = _require_entry(db, current_user.tenant_id, entry_id)
    img = next((i for i in entry.images if i.id == image_id), None)
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    storage.delete_file(img.file_reference)
    db.delete(img)
    db.commit()
