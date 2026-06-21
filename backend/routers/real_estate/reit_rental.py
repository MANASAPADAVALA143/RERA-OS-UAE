from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.reit_rental import Lease, ReitAsset, RentalProperty
from services.real_estate_calculations import lease_tenant_concentration, reit_metrics, rent_collection_efficiency

router = APIRouter(prefix="/api/real-estate", tags=["real-estate"])


@router.get("/reit/assets")
def list_reit_assets(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assets = db.query(ReitAsset).filter(ReitAsset.tenant_id == current_user.tenant_id).all()
    result = []
    for a in assets:
        occupancy = (float(a.occupied_sqft) / float(a.total_rentable_sqft)) if a.total_rentable_sqft else 0
        result.append({
            "id": str(a.id),
            "asset_name": a.asset_name,
            "asset_class": a.asset_class.value,
            "city": a.city,
            "state": a.state,
            "current_market_value": float(a.current_market_value or a.current_book_value),
            "occupancy_pct": round(occupancy, 4),
            "cap_rate": float(a.cap_rate),
            "wale_years": float(a.wale_years),
            "ltv_pct": float(a.ltv_pct),
            "green_certification": a.green_certification.value if a.green_certification else "none",
            "annual_rental_income": float(a.annual_rental_income),
        })
    return result


@router.get("/reit/portfolio-summary")
def reit_portfolio_summary(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assets = db.query(ReitAsset).filter(ReitAsset.tenant_id == current_user.tenant_id).all()
    if not assets:
        return reit_metrics(0, 0, 0)

    total_value = sum(float(a.current_market_value or a.current_book_value) for a in assets)
    total_income = sum(float(a.annual_rental_income) for a in assets)
    weighted_ltv = sum(float(a.ltv_pct) * float(a.current_market_value or a.current_book_value) for a in assets) / total_value if total_value else 0
    weighted_occ = sum(
        (float(a.occupied_sqft) / float(a.total_rentable_sqft) if a.total_rentable_sqft else 0)
        * float(a.current_market_value or a.current_book_value)
        for a in assets
    ) / total_value if total_value else 0
    weighted_wale = sum(float(a.wale_years) * float(a.current_market_value or a.current_book_value) for a in assets) / total_value if total_value else 0

    metrics = reit_metrics(total_value, weighted_ltv, total_income, units_outstanding=len(assets))
    metrics["weighted_avg_occupancy"] = round(weighted_occ, 4)
    metrics["weighted_avg_wale"] = round(weighted_wale, 2)
    metrics["weighted_avg_ltv"] = round(weighted_ltv, 2)
    metrics["total_asset_value"] = round(total_value, 2)
    return metrics


@router.get("/reit/tenant-concentration")
def reit_tenant_concentration(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    leases = (
        db.query(Lease)
        .filter(Lease.tenant_id == current_user.tenant_id, Lease.reit_asset_id.isnot(None))
        .all()
    )
    lease_data = [
        {"tenant_name": l.tenant_name, "annual_rent": float(l.annual_rent), "tenant_industry": l.tenant_industry}
        for l in leases
    ]
    return lease_tenant_concentration(lease_data)


@router.get("/rental/properties")
def list_rental_properties(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    props = db.query(RentalProperty).filter(RentalProperty.tenant_id == current_user.tenant_id).all()
    result = []
    for p in props:
        eff = rent_collection_efficiency(p.monthly_rent_billed, p.monthly_rent_collected)
        occupancy = (p.occupied_units / p.total_units) if p.total_units else 0
        result.append({
            "id": str(p.id),
            "property_name": p.property_name,
            "city": p.city,
            "state": p.state,
            "property_type": p.property_type.value,
            "total_units": p.total_units,
            "occupied_units": p.occupied_units,
            "occupancy_pct": round(occupancy, 4),
            "monthly_rent_billed": float(p.monthly_rent_billed),
            "monthly_rent_collected": float(p.monthly_rent_collected),
            "avg_dso_days": float(p.avg_dso_days),
            **eff,
        })
    return result


@router.get("/rental/at-risk")
def rental_at_risk(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    props = db.query(RentalProperty).filter(RentalProperty.tenant_id == current_user.tenant_id).all()
    at_risk = []
    for p in props:
        occupancy = (p.occupied_units / p.total_units) if p.total_units else 0
        if float(p.avg_dso_days) > 45 or occupancy < 0.85:
            at_risk.append({
                "id": str(p.id),
                "property_name": p.property_name,
                "avg_dso_days": float(p.avg_dso_days),
                "occupancy_pct": round(occupancy, 4),
            })
    return at_risk
