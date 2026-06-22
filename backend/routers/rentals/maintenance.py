"""Maintenance and Unit Inspection endpoints — /api/rentals/maintenance and /api/rentals/inspections"""
from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from services import storage
from models.rentals.maintenance import (
    MaintenanceCategory,
    MaintenancePriority,
    MaintenanceRequest,
    MaintenanceStatus,
)
from models.rentals.unit_inspection import (
    ChecklistCondition,
    UnitConditionScore,
    UnitInspection,
    UnitInspectionChecklistItem,
    UnitInspectionPhoto,
    UnitInspectionType,
)
from models.rentals.models import RentalUnit
from services.rental_maintenance import maintenance_sla_status, maintenance_summary

router = APIRouter(prefix="/api/rentals", tags=["rentals"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _req_dict(r: MaintenanceRequest, today: date | None = None) -> dict:
    today = today or date.today()
    sla = maintenance_sla_status(
        r.priority.value,
        r.reported_date,
        r.target_completion_date,
        r.status.value,
        today,
    )
    return {
        "id": str(r.id),
        "unit_id": str(r.unit_id),
        "property_id": str(r.property_id),
        "unit_number": r.unit.unit_number if r.unit else "",
        "company_name": r.unit.company.company_name if r.unit and r.unit.company else "",
        "property_name": r.property.property_name if r.property else "",
        "title": r.title,
        "description": r.description,
        "category": r.category.value,
        "priority": r.priority.value,
        "status": r.status.value,
        "reported_by": r.reported_by,
        "reported_date": r.reported_date.isoformat() if r.reported_date else None,
        "vendor_name": r.vendor_name,
        "target_completion_date": r.target_completion_date.isoformat() if r.target_completion_date else None,
        "actual_completion_date": r.actual_completion_date.isoformat() if r.actual_completion_date else None,
        "cost": float(r.cost) if r.cost else None,
        "linked_expense_id": str(r.linked_expense_id) if r.linked_expense_id else None,
        **sla,
    }


def _insp_dict(i: UnitInspection, include_detail: bool = False) -> dict:
    d: dict = {
        "id": str(i.id),
        "unit_id": str(i.unit_id),
        "unit_number": i.unit.unit_number if i.unit else "",
        "company_name": i.unit.company.company_name if i.unit and i.unit.company else "",
        "property_name": i.unit.property.property_name if i.unit and i.unit.property else "",
        "lease_id": str(i.lease_id) if i.lease_id else None,
        "inspection_type": i.inspection_type.value,
        "inspection_date": i.inspection_date.isoformat() if i.inspection_date else None,
        "performed_by": i.performed_by,
        "condition_score": i.condition_score.value,
        "notes": i.notes,
        "photo_count": len(i.photos),
        "checklist_count": len(i.checklist),
    }
    if include_detail:
        d["photos"] = [
            {
                "id": str(p.id),
                "file_reference": p.file_reference,
                "image_url": storage.get_url(p.file_reference),
                "caption": p.caption,
                "room_area": p.room_area,
            }
            for p in i.photos
        ]
        d["checklist"] = [
            {
                "id": str(c.id),
                "item_name": c.item_name,
                "condition": c.condition.value,
                "notes": c.notes,
            }
            for c in i.checklist
        ]
    return d


# ══════════════════════════════════════════════════════════════════════════════
# MAINTENANCE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/maintenance")
def list_maintenance(
    property_id: str = Query(None),
    company_id: str = Query(None),
    status: str = Query(None),
    priority: str = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    q = db.query(MaintenanceRequest).filter(MaintenanceRequest.tenant_id == tid)
    if company_id:
        try:
            cid = uuid.UUID(company_id)
            unit_ids = [
                u.id for u in db.query(RentalUnit).filter(
                    RentalUnit.company_id == cid, RentalUnit.tenant_id == tid
                ).all()
            ]
            if not unit_ids:
                return {"summary": maintenance_summary([], today), "items": []}
            q = q.filter(MaintenanceRequest.unit_id.in_(unit_ids))
        except ValueError:
            pass
    if property_id:
        try:
            q = q.filter(MaintenanceRequest.property_id == uuid.UUID(property_id))
        except ValueError:
            pass
    if status:
        try:
            q = q.filter(MaintenanceRequest.status == MaintenanceStatus(status))
        except ValueError:
            pass
    if priority:
        try:
            q = q.filter(MaintenanceRequest.priority == MaintenancePriority(priority))
        except ValueError:
            pass

    requests = q.order_by(MaintenanceRequest.reported_date.desc()).all()
    items = [_req_dict(r, today) for r in requests]
    summary = maintenance_summary(items, today)

    return {"summary": summary, "items": items}


@router.post("/maintenance", status_code=201)
def create_maintenance(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    unit = db.query(RentalUnit).filter(RentalUnit.id == uuid.UUID(body["unit_id"]), RentalUnit.tenant_id == tid).first()
    if not unit:
        raise HTTPException(404, "Unit not found")
    r = MaintenanceRequest(
        tenant_id=tid,
        unit_id=unit.id,
        property_id=unit.property_id,
        title=body["title"],
        description=body.get("description"),
        category=MaintenanceCategory(body["category"]),
        priority=MaintenancePriority(body["priority"]),
        status=MaintenanceStatus(body.get("status", "open")),
        reported_by=body.get("reported_by"),
        reported_date=date.fromisoformat(body.get("reported_date", date.today().isoformat())),
        vendor_name=body.get("vendor_name"),
        target_completion_date=date.fromisoformat(body["target_completion_date"]) if body.get("target_completion_date") else None,
        created_by=current_user.email,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _req_dict(r)


@router.put("/maintenance/{request_id}")
def update_maintenance(
    request_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    r = db.query(MaintenanceRequest).filter(
        MaintenanceRequest.id == request_id,
        MaintenanceRequest.tenant_id == current_user.tenant_id,
    ).first()
    if not r:
        raise HTTPException(404)

    for field in ("title", "description", "vendor_name", "reported_by"):
        if field in body:
            setattr(r, field, body[field])
    if "status" in body:
        r.status = MaintenanceStatus(body["status"])
    if "priority" in body:
        r.priority = MaintenancePriority(body["priority"])
    if "category" in body:
        r.category = MaintenanceCategory(body["category"])
    if "target_completion_date" in body:
        r.target_completion_date = date.fromisoformat(body["target_completion_date"]) if body["target_completion_date"] else None
    if "actual_completion_date" in body:
        r.actual_completion_date = date.fromisoformat(body["actual_completion_date"]) if body["actual_completion_date"] else None
    if "cost" in body:
        r.cost = float(body["cost"]) if body["cost"] is not None else None
    if "linked_expense_id" in body:
        r.linked_expense_id = uuid.UUID(body["linked_expense_id"]) if body["linked_expense_id"] else None

    db.commit()
    return _req_dict(r)


@router.delete("/maintenance/{request_id}", status_code=204)
def delete_maintenance(
    request_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    r = db.query(MaintenanceRequest).filter(
        MaintenanceRequest.id == request_id,
        MaintenanceRequest.tenant_id == current_user.tenant_id,
    ).first()
    if not r:
        raise HTTPException(404)
    db.delete(r)
    db.commit()


# ══════════════════════════════════════════════════════════════════════════════
# UNIT INSPECTION ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/units/{unit_id}/inspections")
def unit_inspections(
    unit_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    inspections = (
        db.query(UnitInspection)
        .filter(UnitInspection.unit_id == unit_id, UnitInspection.tenant_id == tid)
        .order_by(UnitInspection.inspection_date.desc())
        .all()
    )
    items = [_insp_dict(i, include_detail=True) for i in inspections]
    # pair move_in / move_out for comparison
    move_in = next((i for i in items if i["inspection_type"] == "move_in"), None)
    move_out = next((i for i in items if i["inspection_type"] == "move_out"), None)
    return {
        "inspections": items,
        "move_in_vs_move_out": {
            "move_in": move_in,
            "move_out": move_out,
            "has_comparison": move_in is not None and move_out is not None,
        },
    }


@router.get("/inspections")
def list_inspections(
    inspection_type: str = Query(None),
    condition_score: str = Query(None),
    property_id: str = Query(None),
    company_id: str = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    q = db.query(UnitInspection).filter(UnitInspection.tenant_id == tid)
    if inspection_type:
        try:
            q = q.filter(UnitInspection.inspection_type == UnitInspectionType(inspection_type))
        except ValueError:
            pass
    if condition_score:
        try:
            q = q.filter(UnitInspection.condition_score == UnitConditionScore(condition_score))
        except ValueError:
            pass
    if company_id:
        try:
            cid = uuid.UUID(company_id)
            unit_ids = [
                u.id for u in db.query(RentalUnit).filter(
                    RentalUnit.company_id == cid, RentalUnit.tenant_id == tid
                ).all()
            ]
            if not unit_ids:
                return []
            q = q.filter(UnitInspection.unit_id.in_(unit_ids))
        except ValueError:
            pass
    if property_id:
        try:
            pid = uuid.UUID(property_id)
            unit_ids = [
                u.id for u in db.query(RentalUnit).filter(
                    RentalUnit.property_id == pid, RentalUnit.tenant_id == tid
                ).all()
            ]
            if unit_ids:
                q = q.filter(UnitInspection.unit_id.in_(unit_ids))
            else:
                return []
        except ValueError:
            pass

    inspections = q.order_by(UnitInspection.inspection_date.desc()).all()
    return [_insp_dict(i) for i in inspections]


@router.get("/inspections/{inspection_id}")
def get_inspection(
    inspection_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    i = db.query(UnitInspection).filter(
        UnitInspection.id == inspection_id,
        UnitInspection.tenant_id == current_user.tenant_id,
    ).first()
    if not i:
        raise HTTPException(404)
    return _insp_dict(i, include_detail=True)


@router.post("/inspections", status_code=201)
def create_inspection(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    insp = UnitInspection(
        tenant_id=tid,
        unit_id=uuid.UUID(body["unit_id"]),
        lease_id=uuid.UUID(body["lease_id"]) if body.get("lease_id") else None,
        inspection_type=UnitInspectionType(body["inspection_type"]),
        inspection_date=date.fromisoformat(body["inspection_date"]),
        performed_by=body.get("performed_by"),
        condition_score=UnitConditionScore(body["condition_score"]),
        notes=body.get("notes"),
        created_by=current_user.email,
    )
    db.add(insp)
    db.flush()

    for item in body.get("checklist", []):
        ci = UnitInspectionChecklistItem(
            tenant_id=tid,
            inspection_id=insp.id,
            item_name=item["item_name"],
            condition=ChecklistCondition(item["condition"]),
            notes=item.get("notes"),
        )
        db.add(ci)

    db.commit()
    db.refresh(insp)
    return _insp_dict(insp, include_detail=True)


@router.put("/inspections/{inspection_id}")
def update_inspection(
    inspection_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    i = db.query(UnitInspection).filter(
        UnitInspection.id == inspection_id,
        UnitInspection.tenant_id == current_user.tenant_id,
    ).first()
    if not i:
        raise HTTPException(404)
    for field in ("performed_by", "notes"):
        if field in body:
            setattr(i, field, body[field])
    if "condition_score" in body:
        i.condition_score = UnitConditionScore(body["condition_score"])
    if "inspection_date" in body:
        i.inspection_date = date.fromisoformat(body["inspection_date"])
    db.commit()
    return _insp_dict(i, include_detail=True)


@router.post("/inspections/{inspection_id}/photos", status_code=201)
async def upload_inspection_photo(
    inspection_id: uuid.UUID,
    file: UploadFile = File(...),
    caption: str = Form(None),
    room_area: str = Form(None),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    insp = db.query(UnitInspection).filter(
        UnitInspection.id == inspection_id, UnitInspection.tenant_id == tid
    ).first()
    if not insp:
        raise HTTPException(404)

    ext = Path(file.filename or "photo.jpg").suffix or ".jpg"
    filename = f"rinsp_{uuid.uuid4().hex}{ext}"
    storage.put_file(await file.read(), filename, content_type=file.content_type or "image/jpeg")

    photo = UnitInspectionPhoto(
        tenant_id=tid,
        inspection_id=inspection_id,
        file_reference=filename,
        caption=caption,
        room_area=room_area,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return {
        "id": str(photo.id),
        "file_reference": photo.file_reference,
        "image_url": f"/uploads/{photo.file_reference}",
        "caption": photo.caption,
        "room_area": photo.room_area,
    }


@router.delete("/inspections/{inspection_id}/photos/{photo_id}", status_code=204)
def delete_inspection_photo(
    inspection_id: uuid.UUID,
    photo_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    p = db.query(UnitInspectionPhoto).filter(
        UnitInspectionPhoto.id == photo_id,
        UnitInspectionPhoto.inspection_id == inspection_id,
        UnitInspectionPhoto.tenant_id == current_user.tenant_id,
    ).first()
    if not p:
        raise HTTPException(404)
    storage.delete_file(p.file_reference)
    db.delete(p)
    db.commit()
