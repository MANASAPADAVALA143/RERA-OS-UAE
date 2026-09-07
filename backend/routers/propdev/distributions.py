"""Property Dev Distribution Waterfall — per-event distribution records
(propdev_distributions). Manual-entry only: bulk Excel import still writes
the legacy distributions_received running total on propdev_partners
(Annexure II's "Distributed ($)" column has no date/period/action, so it
can't populate this table cleanly). If the Excel template ever adds
per-event distribution columns, that's the trigger to revisit sending
bulk-import data here too.

distribution_action ("reinvest"|"payout") is required at entry time, since
there is no prior entry flow to stay backward-compatible with.
"""
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.partner import PropDevPartner
from models.propdev.distribution import PropDevDistribution

router = APIRouter(prefix="/api/propdev/distributions", tags=["propdev"])

VALID_ACTIONS = {"reinvest", "payout"}


def _to_dict(d: PropDevDistribution) -> dict:
    return {
        "id": str(d.id),
        "company_id": str(d.company_id),
        "partner_id": str(d.partner_id),
        "partner_name": d.partner.name if d.partner else "",
        "period": d.period,
        "distribution_date": d.distribution_date.isoformat() if d.distribution_date else None,
        "amount": float(d.amount),
        "distribution_action": d.distribution_action,
        "notes": d.notes,
    }


@router.get("")
def list_distributions(
    company_id: str | None = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(PropDevDistribution).options(selectinload(PropDevDistribution.partner)).filter(
        PropDevDistribution.tenant_id == current_user.tenant_id,
    )
    if company_id:
        q = q.filter(PropDevDistribution.company_id == uuid.UUID(company_id))
    rows = q.order_by(PropDevDistribution.distribution_date.desc().nullslast()).all()
    return {"items": [_to_dict(d) for d in rows]}


class CreateDistributionRequest(BaseModel):
    company_id: str
    partner_id: str
    period: str
    distribution_date: date | None = None
    amount: float = Field(gt=0)
    distribution_action: str
    notes: str | None = None


@router.post("", status_code=201)
def create_distribution(
    req: CreateDistributionRequest,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    if req.distribution_action not in VALID_ACTIONS:
        raise HTTPException(400, f"distribution_action must be one of {sorted(VALID_ACTIONS)}")

    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == uuid.UUID(req.company_id),
        PropDevCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(404, "Company not found")

    partner = db.query(PropDevPartner).filter(
        PropDevPartner.id == uuid.UUID(req.partner_id),
        PropDevPartner.company_id == company.id,
    ).first()
    if not partner:
        raise HTTPException(404, "Partner not found for this company")

    dist = PropDevDistribution(
        tenant_id=current_user.tenant_id,
        company_id=company.id,
        partner_id=partner.id,
        period=req.period,
        distribution_date=req.distribution_date,
        amount=req.amount,
        distribution_action=req.distribution_action,
        notes=req.notes,
    )
    db.add(dist)

    # Keep the legacy running total in sync so existing Partner ROI Summary /
    # Ownership tab reads (which sum distributions_received directly, not via
    # this table) stay correct without needing their own migration.
    partner.distributions_received = float(partner.distributions_received or 0) + req.amount

    db.commit()
    db.refresh(dist)
    return _to_dict(dist)


@router.delete("/{distribution_id}")
def delete_distribution(
    distribution_id: str,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    dist = db.query(PropDevDistribution).filter(
        PropDevDistribution.id == uuid.UUID(distribution_id),
        PropDevDistribution.tenant_id == current_user.tenant_id,
    ).first()
    if not dist:
        raise HTTPException(404, "Distribution not found")

    partner = db.query(PropDevPartner).filter(PropDevPartner.id == dist.partner_id).first()
    if partner:
        partner.distributions_received = max(0.0, float(partner.distributions_received or 0) - float(dist.amount))

    db.delete(dist)
    db.commit()
    return {"status": "deleted"}
