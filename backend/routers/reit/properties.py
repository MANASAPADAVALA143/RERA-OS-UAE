import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.reit.property import (
    ReitGreenCertification,
    ReitProperty,
    ReitPropertyAssetClass,
    ReitPropertyStatus,
)
from routers.reit._helpers import (
    active_properties_query,
    compute_property_snapshot,
    property_dict,
    require_property,
)

router = APIRouter(prefix="/api/reit", tags=["reit"])


class PropertyCreate(BaseModel):
    property_code: str
    property_name: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    asset_class: str
    total_units: int = 0
    acquisition_date: date | None = None
    acquisition_price: float | None = None
    current_market_value_estimate: float | None = None
    current_market_value_as_of: date | None = None
    green_certification: str | None = None
    insurance_coverage_amount: float | None = None
    insurance_renewal_date: date | None = None
    min_buffer_target: float = 15000
    status: str = "active"


class PropertyUpdate(BaseModel):
    property_code: str | None = None
    property_name: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    asset_class: str | None = None
    total_units: int | None = None
    acquisition_date: date | None = None
    acquisition_price: float | None = None
    current_market_value_estimate: float | None = None
    current_market_value_as_of: date | None = None
    green_certification: str | None = None
    insurance_coverage_amount: float | None = None
    insurance_renewal_date: date | None = None
    min_buffer_target: float | None = None
    status: str | None = None


@router.get("/properties")
def list_properties(
    status: str | None = Query(None),
    asset_class: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    props = active_properties_query(db, current_user.tenant_id, status, asset_class).all()
    results = []
    for p in props:
        snap = compute_property_snapshot(db, p)
        results.append({
            **property_dict(p),
            "occupancy_pct": snap.get("occupancy_pct"),
            "net_operating_income": snap.get("net_operating_income"),
            "dscr": snap.get("dscr"),
            "dscr_status": snap.get("dscr_status"),
            "cash_flow_after_debt_service": snap.get("cash_flow_after_debt_service"),
        })
    return results


@router.get("/properties/{property_id}")
def get_property(
    property_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    prop = require_property(db, current_user.tenant_id, property_id)
    snap = compute_property_snapshot(db, prop)
    return {
        **property_dict(prop),
        "occupancy": {
            "occupied_units": snap.get("occupied_units"),
            "total_units": snap.get("total_units"),
            "occupancy_pct": snap.get("occupancy_pct"),
        },
        "financial_strength": {
            "annual_noi": snap.get("annual_noi"),
            "cap_rate_on_current_value": snap.get("cap_rate_on_current_value"),
            "dscr": snap.get("dscr"),
            "dscr_status": snap.get("dscr_status"),
            "current_ltv": snap.get("current_ltv"),
            "equity_value": snap.get("equity_value"),
        },
        "latest_period": snap.get("period_month"),
        "pl_summary": {
            k: snap.get(k)
            for k in (
                "gross_potential_rent", "vacancy_loss", "concession_loss",
                "effective_gross_income", "total_operating_expenses", "net_operating_income",
                "total_debt_service", "cash_flow_after_debt_service", "noi_margin_pct",
            )
            if snap.get(k) is not None
        },
    }


@router.post("/properties")
def create_property(
    body: PropertyCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    existing = (
        db.query(ReitProperty)
        .filter(
            ReitProperty.tenant_id == current_user.tenant_id,
            ReitProperty.property_code == body.property_code,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Property code already exists")

    prop = ReitProperty(
        tenant_id=current_user.tenant_id,
        property_code=body.property_code,
        property_name=body.property_name,
        address=body.address,
        city=body.city,
        state=body.state,
        zip_code=body.zip_code,
        asset_class=ReitPropertyAssetClass(body.asset_class),
        total_units=body.total_units,
        acquisition_date=body.acquisition_date,
        acquisition_price=body.acquisition_price,
        current_market_value_estimate=body.current_market_value_estimate,
        current_market_value_as_of=body.current_market_value_as_of,
        green_certification=ReitGreenCertification(body.green_certification) if body.green_certification else None,
        insurance_coverage_amount=body.insurance_coverage_amount,
        insurance_renewal_date=body.insurance_renewal_date,
        min_buffer_target=body.min_buffer_target,
        status=ReitPropertyStatus(body.status),
        created_by=current_user.email,
    )
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return property_dict(prop)


@router.put("/properties/{property_id}")
def update_property(
    property_id: uuid.UUID,
    body: PropertyUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_write_access()),
):
    prop = require_property(db, current_user.tenant_id, property_id)
    data = body.model_dump(exclude_unset=True)
    if "asset_class" in data and data["asset_class"]:
        data["asset_class"] = ReitPropertyAssetClass(data["asset_class"])
    if "status" in data and data["status"]:
        data["status"] = ReitPropertyStatus(data["status"])
    if "green_certification" in data and data["green_certification"]:
        data["green_certification"] = ReitGreenCertification(data["green_certification"])
    for k, v in data.items():
        setattr(prop, k, v)
    db.commit()
    db.refresh(prop)
    return property_dict(prop)
