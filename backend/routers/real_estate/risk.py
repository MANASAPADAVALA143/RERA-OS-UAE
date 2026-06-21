from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.entity import Project
from models.real_estate.reit_rental import ReitAsset
from models.real_estate.risk import ClaimStatus, LitigationClaim, TaxEvent, TaxEventStatus, VendorContractor
from services.real_estate_calculations import litigation_exposure_summary, vendor_concentration

router = APIRouter(prefix="/api/real-estate/risk", tags=["real-estate"])


@router.get("/vendor-concentration")
def get_vendor_concentration(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    vendors = db.query(VendorContractor).filter(VendorContractor.tenant_id == current_user.tenant_id).all()
    vendor_values = {}
    total = 0.0
    for v in vendors:
        committed = sum(
            float(p.total_saleable_sqft or 0) * 150
            for p in v.projects
            if p.tenant_id == current_user.tenant_id
        )
        vendor_values[v.vendor_name] = committed
        total += committed
    return vendor_concentration(vendor_values, total)


@router.get("/litigation")
def list_litigation(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    claims = db.query(LitigationClaim).filter(LitigationClaim.tenant_id == current_user.tenant_id).all()
    claim_data = [
        {
            "id": str(c.id),
            "claim_description": c.claim_description,
            "claim_type": c.claim_type.value,
            "claimant_name": c.claimant_name,
            "exposure_amount": float(c.exposure_amount),
            "probability_weighted_reserve": float(c.probability_weighted_reserve),
            "status": c.status.value,
            "filed_date": c.filed_date.isoformat() if c.filed_date else None,
        }
        for c in claims
    ]
    return {"claims": claim_data, "summary": litigation_exposure_summary(claim_data)}


@router.get("/tax-events")
def list_tax_events(
    upcoming_days: int = Query(default=60),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cutoff = date.today() + timedelta(days=upcoming_days)
    events = (
        db.query(TaxEvent)
        .filter(
            TaxEvent.tenant_id == current_user.tenant_id,
            TaxEvent.deadline_date.isnot(None),
            TaxEvent.deadline_date <= cutoff,
            TaxEvent.status == TaxEventStatus.pending,
        )
        .order_by(TaxEvent.deadline_date)
        .all()
    )
    return [
        {
            "id": str(e.id),
            "event_type": e.event_type.value,
            "event_date": e.event_date.isoformat() if e.event_date else None,
            "deadline_date": e.deadline_date.isoformat() if e.deadline_date else None,
            "amount": float(e.amount) if e.amount else None,
            "status": e.status.value,
            "notes": e.notes,
            "days_until_deadline": (e.deadline_date - date.today()).days if e.deadline_date else None,
        }
        for e in events
    ]


@router.get("/insurance-coverage")
def insurance_coverage_flags(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    renewal_threshold = today + timedelta(days=30)
    flags = []

    projects = db.query(Project).filter(Project.tenant_id == current_user.tenant_id).all()
    for p in projects:
        if p.insurance_renewal_date and p.insurance_renewal_date <= renewal_threshold:
            flags.append({"type": "project", "id": str(p.id), "name": p.project_name, "issue": "renewal_soon", "renewal_date": p.insurance_renewal_date.isoformat()})
        if (p.flood_zone or p.wildfire_risk_zone or p.hurricane_zone) and not p.insurance_coverage_amount:
            flags.append({"type": "project", "id": str(p.id), "name": p.project_name, "issue": "missing_coverage_in_risk_zone"})

    assets = db.query(ReitAsset).filter(ReitAsset.tenant_id == current_user.tenant_id).all()
    for a in assets:
        if a.insurance_renewal_date and a.insurance_renewal_date <= renewal_threshold:
            flags.append({"type": "reit_asset", "id": str(a.id), "name": a.asset_name, "issue": "renewal_soon", "renewal_date": a.insurance_renewal_date.isoformat()})

    return flags
