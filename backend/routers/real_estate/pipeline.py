import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.pipeline import LandParcel, LandParcelStatus, MarketComp

router = APIRouter(prefix="/api/real-estate/pipeline", tags=["real-estate"])


class LandParcelCreate(BaseModel):
    parcel_name: str
    status: str
    city: str | None = None
    state: str | None = None
    acres: float | None = None
    projected_acquisition_cost: float | None = None
    projected_project_irr: float | None = None
    target_close_date: date | None = None


class MarketCompCreate(BaseModel):
    market_area: str
    comp_name: str
    comp_price_per_sqft: float | None = None
    comp_absorption_units_per_month: float | None = None
    prevailing_mortgage_rate_pct: float | None = None
    prevailing_cap_rate_pct: float | None = None
    project_id: str | None = None
    source_note: str | None = None


@router.get("/land")
def list_land_parcels(
    status: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(LandParcel).filter(LandParcel.tenant_id == current_user.tenant_id)
    if status:
        q = q.filter(LandParcel.status == LandParcelStatus(status))
    return [
        {
            "id": str(p.id),
            "parcel_name": p.parcel_name,
            "city": p.city,
            "state": p.state,
            "acres": float(p.acres) if p.acres else None,
            "status": p.status.value,
            "projected_acquisition_cost": float(p.projected_acquisition_cost) if p.projected_acquisition_cost else None,
            "projected_units_or_sqft": float(p.projected_units_or_sqft) if p.projected_units_or_sqft else None,
            "projected_project_irr": float(p.projected_project_irr) if p.projected_project_irr else None,
            "target_close_date": p.target_close_date.isoformat() if p.target_close_date else None,
        }
        for p in q.all()
    ]


@router.get("/market-comps")
def list_market_comps(
    market_area: str | None = None,
    project_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(MarketComp).filter(MarketComp.tenant_id == current_user.tenant_id)
    if market_area:
        q = q.filter(MarketComp.market_area.ilike(f"%{market_area}%"))
    if project_id:
        q = q.filter(MarketComp.project_id == uuid.UUID(project_id))
    return [
        {
            "id": str(c.id),
            "market_area": c.market_area,
            "comp_name": c.comp_name,
            "comp_price_per_sqft": float(c.comp_price_per_sqft) if c.comp_price_per_sqft else None,
            "comp_absorption_units_per_month": float(c.comp_absorption_units_per_month) if c.comp_absorption_units_per_month else None,
            "prevailing_mortgage_rate_pct": float(c.prevailing_mortgage_rate_pct) if c.prevailing_mortgage_rate_pct else None,
            "prevailing_cap_rate_pct": float(c.prevailing_cap_rate_pct) if c.prevailing_cap_rate_pct else None,
            "data_as_of_date": c.data_as_of_date.isoformat() if c.data_as_of_date else None,
            "source_note": c.source_note,
        }
        for c in q.all()
    ]


@router.post("/land")
def create_land_parcel(
    body: LandParcelCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    parcel = LandParcel(
        tenant_id=current_user.tenant_id,
        parcel_name=body.parcel_name,
        status=LandParcelStatus(body.status),
        city=body.city,
        state=body.state,
        acres=body.acres,
        projected_acquisition_cost=body.projected_acquisition_cost,
        projected_project_irr=body.projected_project_irr,
        target_close_date=body.target_close_date,
        created_by=current_user.user_id,
    )
    db.add(parcel)
    db.commit()
    db.refresh(parcel)
    return {"id": str(parcel.id)}


@router.post("/market-comps")
def create_market_comp(
    body: MarketCompCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    comp = MarketComp(
        tenant_id=current_user.tenant_id,
        market_area=body.market_area,
        comp_name=body.comp_name,
        comp_price_per_sqft=body.comp_price_per_sqft,
        comp_absorption_units_per_month=body.comp_absorption_units_per_month,
        prevailing_mortgage_rate_pct=body.prevailing_mortgage_rate_pct,
        prevailing_cap_rate_pct=body.prevailing_cap_rate_pct,
        project_id=uuid.UUID(body.project_id) if body.project_id else None,
        source_note=body.source_note,
        data_as_of_date=date.today(),
        created_by=current_user.user_id,
    )
    db.add(comp)
    db.commit()
    return {"id": str(comp.id)}
