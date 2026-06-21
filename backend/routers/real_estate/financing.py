import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.construction_cost import CostTrade
from models.real_estate.financing import DebtDrawdown, FinancingFacility
from services.real_estate_calculations import capital_available_now, covenant_headroom, debt_maturity_bucket

router = APIRouter(prefix="/api/real-estate/financing", tags=["real-estate"])


def _facility_row(f: FinancingFacility):
    headroom = covenant_headroom(f.ltv_current_pct, f.ltv_covenant_pct, f.dscr_current, f.dscr_covenant_min)
    return {
        "id": str(f.id),
        "entity_id": str(f.entity_id),
        "project_id": str(f.project_id) if f.project_id else None,
        "facility_type": f.facility_type.value,
        "lender_or_investor_name": f.lender_or_investor_name,
        "committed_amount": float(f.committed_amount),
        "drawn_amount": float(f.drawn_amount),
        "undrawn_available": float(f.undrawn_available),
        "interest_rate_annual": float(f.interest_rate_annual) if f.interest_rate_annual else None,
        "rate_type": f.rate_type.value if f.rate_type else None,
        "maturity_date": f.maturity_date.isoformat() if f.maturity_date else None,
        "is_in_default": f.is_in_default,
        **headroom,
    }


@router.get("/facilities")
def list_facilities(
    project_id: str | None = None,
    entity_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(FinancingFacility).filter(FinancingFacility.tenant_id == current_user.tenant_id)
    if project_id:
        q = q.filter(FinancingFacility.project_id == uuid.UUID(project_id))
    if entity_id:
        q = q.filter(FinancingFacility.entity_id == uuid.UUID(entity_id))
    return [_facility_row(f) for f in q.all()]


@router.get("/maturity-ladder")
def maturity_ladder(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    facilities = (
        db.query(FinancingFacility)
        .filter(FinancingFacility.tenant_id == current_user.tenant_id)
        .all()
    )
    buckets: dict[str, float] = defaultdict(float)
    for f in facilities:
        bucket = debt_maturity_bucket(f.maturity_date)
        buckets[bucket] += float(f.committed_amount)
    return dict(buckets)


@router.get("/capital-available")
def get_capital_available(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    facilities = (
        db.query(FinancingFacility)
        .filter(FinancingFacility.tenant_id == current_user.tenant_id)
        .all()
    )
    data = [
        {
            "id": str(f.id),
            "facility_type": f.facility_type.value,
            "lender_or_investor_name": f.lender_or_investor_name,
            "undrawn_available": float(f.undrawn_available),
            "is_in_default": f.is_in_default,
        }
        for f in facilities
    ]
    return capital_available_now(data)


@router.get("/draw-schedule/{facility_id}")
def draw_schedule(
    facility_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    facility = (
        db.query(FinancingFacility)
        .filter(FinancingFacility.id == facility_id, FinancingFacility.tenant_id == current_user.tenant_id)
        .first()
    )
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")

    drawdowns = (
        db.query(DebtDrawdown)
        .filter(DebtDrawdown.facility_id == facility.id)
        .order_by(DebtDrawdown.draw_date)
        .all()
    )

    budgeted_spend = 0.0
    if facility.project_id:
        trades = db.query(CostTrade).filter(CostTrade.project_id == facility.project_id).all()
        budgeted_spend = sum(float(t.budgeted_cost) for t in trades)

    return {
        "facility_id": str(facility.id),
        "drawn_amount": float(facility.drawn_amount),
        "budgeted_construction_spend": budgeted_spend,
        "drawdowns": [
            {
                "draw_date": d.draw_date.isoformat(),
                "draw_amount": float(d.draw_amount),
                "cumulative_drawn_after": float(d.cumulative_drawn_after),
                "purpose": d.purpose,
            }
            for d in drawdowns
        ],
    }
