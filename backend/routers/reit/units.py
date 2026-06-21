import uuid
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.reit.unit import ReitUnit, ReitUnitStatus
from routers.reit._helpers import require_property, unit_rows

router = APIRouter(prefix="/api/reit", tags=["reit"])


class UnitCreate(BaseModel):
    unit_number: str
    unit_type: str
    sqft: float | None = None
    market_rent: float
    status: str
    tenant_name: str | None = None
    actual_rent: float | None = None
    lease_start: date | None = None
    lease_end: date | None = None
    status_changed_at: date | None = None


class UnitUpdate(BaseModel):
    unit_number: str | None = None
    unit_type: str | None = None
    sqft: float | None = None
    market_rent: float | None = None
    status: str | None = None
    tenant_name: str | None = None
    actual_rent: float | None = None
    lease_start: date | None = None
    lease_end: date | None = None
    status_changed_at: date | None = None


def _unit_response(u: ReitUnit) -> dict:
    status = u.status.value
    from services.reit_calculations import days_vacant, unit_rental_loss
    return {
        "id": str(u.id),
        "property_id": str(u.property_id),
        "unit_number": u.unit_number,
        "unit_type": u.unit_type,
        "sqft": float(u.sqft) if u.sqft is not None else None,
        "market_rent": float(u.market_rent),
        "status": status,
        "tenant_name": u.tenant_name,
        "actual_rent": float(u.actual_rent) if u.actual_rent is not None else None,
        "lease_start": u.lease_start.isoformat() if u.lease_start else None,
        "lease_end": u.lease_end.isoformat() if u.lease_end else None,
        "status_changed_at": u.status_changed_at.isoformat() if u.status_changed_at else None,
        "rental_loss_monthly": round(unit_rental_loss(u.market_rent, u.actual_rent, status), 2),
        "days_vacant": days_vacant(status, u.status_changed_at),
    }


@router.get("/properties/{property_id}/units")
def list_units(
    property_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    require_property(db, current_user.tenant_id, property_id)
    return unit_rows(db, current_user.tenant_id, property_id)


@router.post("/properties/{property_id}/units")
def create_unit(
    property_id: uuid.UUID,
    body: UnitCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    require_property(db, current_user.tenant_id, property_id)
    unit = ReitUnit(
        tenant_id=current_user.tenant_id,
        property_id=property_id,
        unit_number=body.unit_number,
        unit_type=body.unit_type,
        sqft=body.sqft,
        market_rent=body.market_rent,
        status=ReitUnitStatus(body.status),
        tenant_name=body.tenant_name,
        actual_rent=body.actual_rent,
        lease_start=body.lease_start,
        lease_end=body.lease_end,
        status_changed_at=body.status_changed_at or date.today(),
    )
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return _unit_response(unit)


@router.put("/properties/{property_id}/units/{unit_id}")
def update_unit(
    property_id: uuid.UUID,
    unit_id: uuid.UUID,
    body: UnitUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    require_property(db, current_user.tenant_id, property_id)
    unit = (
        db.query(ReitUnit)
        .filter(
            ReitUnit.id == unit_id,
            ReitUnit.property_id == property_id,
            ReitUnit.tenant_id == current_user.tenant_id,
        )
        .first()
    )
    if not unit:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Unit not found")

    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"]:
        new_status = ReitUnitStatus(data["status"])
        if new_status != unit.status:
            unit.status_changed_at = data.pop("status_changed_at", None) or date.today()
        data["status"] = new_status
    for k, v in data.items():
        setattr(unit, k, v)
    db.commit()
    db.refresh(unit)
    return _unit_response(unit)
