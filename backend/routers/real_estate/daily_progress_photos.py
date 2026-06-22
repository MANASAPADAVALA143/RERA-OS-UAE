import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.daily_progress_photo import DailyProgressPhoto, DailyProgressPhotoEntry
from models.real_estate.entity import Project
from services import storage

router = APIRouter(prefix="/api/real-estate/daily-progress-photos", tags=["real-estate"])


def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.tenant_id == tenant_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _photo_dict(photo: DailyProgressPhoto) -> dict:
    return {
        "id": str(photo.id),
        "entry_id": str(photo.entry_id),
        "file_reference": photo.file_reference,
        "image_url": storage.get_url(photo.file_reference),
        "caption": photo.caption,
        "uploaded_at": photo.uploaded_at.isoformat(),
    }


def _entry_dict(entry: DailyProgressPhotoEntry) -> dict:
    return {
        "id": str(entry.id),
        "project_id": str(entry.project_id),
        "entry_date": entry.entry_date.isoformat(),
        "uploaded_by": entry.uploaded_by,
        "created_at": entry.created_at.isoformat(),
        "photo_count": len(entry.photos),
        "photos": [_photo_dict(p) for p in entry.photos],
    }


def _get_or_create_entry(
    db: Session, tenant_id, project_id: uuid.UUID, entry_date: date, uploaded_by: str | None
) -> DailyProgressPhotoEntry:
    """Upsert: return existing entry for this (project, date) or create a new one."""
    entry = (
        db.query(DailyProgressPhotoEntry)
        .options(selectinload(DailyProgressPhotoEntry.photos))
        .filter(
            DailyProgressPhotoEntry.tenant_id == tenant_id,
            DailyProgressPhotoEntry.project_id == project_id,
            DailyProgressPhotoEntry.entry_date == entry_date,
        )
        .first()
    )
    if entry:
        return entry
    entry = DailyProgressPhotoEntry(
        tenant_id=tenant_id,
        project_id=project_id,
        entry_date=entry_date,
        uploaded_by=uploaded_by,
    )
    db.add(entry)
    db.flush()  # get the id without committing
    return entry


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/latest")
def get_latest_entry(
    project_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Most recent date's entry + photos — used by Overview preview strip."""
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    entry = (
        db.query(DailyProgressPhotoEntry)
        .options(selectinload(DailyProgressPhotoEntry.photos))
        .filter(
            DailyProgressPhotoEntry.tenant_id == current_user.tenant_id,
            DailyProgressPhotoEntry.project_id == pid,
        )
        .order_by(DailyProgressPhotoEntry.entry_date.desc())
        .first()
    )
    if not entry:
        return {"entry": None}
    return {"entry": _entry_dict(entry)}


@router.get("")
def list_entries(
    project_id: str,
    date: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 30,   # default: 30 most recent date groups
    offset: int = 0,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Date-grouped gallery, most recent first. Supports pagination."""
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    q = (
        db.query(DailyProgressPhotoEntry)
        .options(selectinload(DailyProgressPhotoEntry.photos))
        .filter(
            DailyProgressPhotoEntry.tenant_id == current_user.tenant_id,
            DailyProgressPhotoEntry.project_id == pid,
        )
    )
    if date:
        q = q.filter(DailyProgressPhotoEntry.entry_date == date)
    if date_from:
        q = q.filter(DailyProgressPhotoEntry.entry_date >= date_from)
    if date_to:
        q = q.filter(DailyProgressPhotoEntry.entry_date <= date_to)
    total = q.count()
    entries = q.order_by(DailyProgressPhotoEntry.entry_date.desc()).offset(offset).limit(limit).all()
    return {
        "entries": [_entry_dict(e) for e in entries],
        "total_entries": total,
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(entries) < total,
    }


@router.post("/upload")
async def upload_photos(
    project_id: str = Form(...),
    entry_date: str = Form(...),  # YYYY-MM-DD
    caption: str | None = Form(default=None),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """Upload one photo to the entry for the given date. Creates the entry if it
    doesn't exist yet; adds to it if it does (no duplicate date entries)."""
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)
    try:
        parsed_date = date.fromisoformat(entry_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="entry_date must be YYYY-MM-DD")
    suffix = Path(file.filename or "photo.jpg").suffix.lower() or ".jpg"
    filename = f"{uuid.uuid4().hex}{suffix}"
    contents = await file.read()
    storage.put_file(contents, filename, content_type=file.content_type or "image/jpeg")
    entry = _get_or_create_entry(db, current_user.tenant_id, pid, parsed_date, current_user.email)
    photo = DailyProgressPhoto(
        tenant_id=current_user.tenant_id,
        entry_id=entry.id,
        file_reference=filename,
        caption=caption,
    )
    db.add(photo)
    db.commit()
    # Reload with relationships
    db.refresh(entry)
    entry = (
        db.query(DailyProgressPhotoEntry)
        .options(selectinload(DailyProgressPhotoEntry.photos))
        .filter(DailyProgressPhotoEntry.id == entry.id)
        .first()
    )
    return _entry_dict(entry)


@router.delete("/{photo_id}", status_code=204)
def delete_photo(
    photo_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    photo = db.query(DailyProgressPhoto).filter(
        DailyProgressPhoto.id == photo_id,
        DailyProgressPhoto.tenant_id == current_user.tenant_id,
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    storage.delete_file(photo.file_reference)
    db.delete(photo)
    db.commit()
