"""Lot Reinvestment Tracker (propdev_lot_reinvestments) service layer.

Auto-generates a capital call (propdev_capital_calls, one row per active
partner -- matching the existing manual/Excel-import shape, which is already
partner-scoped rather than entity-level) plus a propdev_partner_capital_
contributions row per partner, whenever a new lot reinvestment round exceeds
cash on hand + undrawn loan facility.

Deliberately a backend service, not a DB trigger, so the shortfall math is
visible in application code and directly unit-testable -- see
compute_capital_call_trigger() below and
backend/tests/test_propdev_lot_reinvestment_trigger.py.
"""
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.company import PropDevCompany
from models.propdev.lot_reinvestment import PropDevLotReinvestment
from models.propdev.partner import PropDevPartner
from models.propdev.partner_capital_contribution import PropDevPartnerCapitalContribution


@dataclass
class PartnerSplit:
    partner_id: uuid.UUID
    share_percent: float
    amount: float


@dataclass
class CapitalCallTrigger:
    cash_needed: float
    cash_available: float
    capital_call_amount: float
    splits: list[PartnerSplit]


def compute_capital_call_trigger(
    reinvestment_amount: float,
    cash_on_hand: float,
    undrawn_loan_facility: float,
    partners: list[tuple[uuid.UUID, float]],
) -> CapitalCallTrigger | None:
    """Pure function, no DB access, so the shortfall math is directly testable.

    partners: list of (partner_id, share_percent 0-100) for active partners only
    (caller is responsible for excluding Exited partners).

    Returns None when cash on hand + undrawn facility already covers the
    reinvestment -- no call needed. Otherwise returns the shortfall and its
    per-partner split (normalized against the sum of share_percent, not
    assumed to already total exactly 100 -- partner records can drift).
    """
    cash_available = cash_on_hand + undrawn_loan_facility
    capital_call_amount = max(0.0, reinvestment_amount - cash_available)
    if capital_call_amount <= 0:
        return None

    active = [(pid, pct) for pid, pct in partners if pct]
    total_pct = sum(pct for _, pct in active)
    splits: list[PartnerSplit] = []
    for partner_id, pct in active:
        weight = (pct / total_pct) if total_pct > 0 else (1 / len(active) if active else 0)
        splits.append(PartnerSplit(
            partner_id=partner_id,
            share_percent=pct,
            amount=round(capital_call_amount * weight, 2),
        ))

    return CapitalCallTrigger(
        cash_needed=reinvestment_amount,
        cash_available=cash_available,
        capital_call_amount=capital_call_amount,
        splits=splits,
    )


def resolve_undrawn_loan_facility(company: PropDevCompany) -> float:
    """PropDev loans (models/propdev/loan.py) are simple fully-disbursed term
    loans against land -- there's no committed-vs-drawn revolving facility
    concept here (unlike models/real_estate/financing.py's FinancingFacility,
    a different module). Always 0 today; kept as its own function so a future
    facility concept only needs to change here, not every call site."""
    return 0.0


def create_lot_reinvestment(
    db: Session,
    tenant_id: uuid.UUID,
    company_id: uuid.UUID,
    period: str,
    capital_raised: float,
    deployed_to_lots: float,
    deployed_to_improvements: float,
    reinvestment_amount: float,
    expected_return_per_lot: float | None = None,
    notes: str | None = None,
) -> tuple[PropDevLotReinvestment, CapitalCallTrigger | None]:
    """Inserts the lot reinvestment row, then auto-generates a capital call (and
    its per-partner contribution rows) if cash on hand + undrawn facility can't
    cover reinvestment_amount. Everything commits in one transaction -- the
    reinvestment and any triggered call/contributions land together or not at all.
    """
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == company_id, PropDevCompany.tenant_id == tenant_id,
    ).first()
    if not company:
        raise ValueError(f"Company {company_id} not found for tenant {tenant_id}")

    reinvestment = PropDevLotReinvestment(
        tenant_id=tenant_id,
        company_id=company_id,
        period=period,
        capital_raised=capital_raised,
        deployed_to_lots=deployed_to_lots,
        deployed_to_improvements=deployed_to_improvements,
        expected_return_per_lot=expected_return_per_lot,
        notes=notes,
    )
    db.add(reinvestment)
    db.flush()  # assign reinvestment.id before it's used as source_id / in the reason text

    cash_on_hand = float(company.cash_available or 0)
    undrawn = resolve_undrawn_loan_facility(company)

    partners = db.query(PropDevPartner).filter(
        PropDevPartner.company_id == company_id,
        PropDevPartner.status != "Exited",
    ).all()
    partner_pairs = [(p.id, float(p.share_percent or 0)) for p in partners]

    trigger = compute_capital_call_trigger(reinvestment_amount, cash_on_hand, undrawn, partner_pairs)

    if trigger is not None:
        partners_by_id = {p.id: p for p in partners}
        reason = f"Auto-generated: Lot reinvestment #{reinvestment.id} — {period}"
        for split in trigger.splits:
            partner = partners_by_id[split.partner_id]
            call = PropDevCapitalCall(
                tenant_id=tenant_id,
                company_id=company_id,
                partner_id=partner.id,
                period=period,
                share_percent=split.share_percent,
                total_call_amount=trigger.capital_call_amount,
                partner_share=split.amount,
                old_dues=0,
                total_due=split.amount,
                amount_received=0,
                received_date=None,
                due_date=date.today(),
                status="Outstanding",
                source_type="lot_reinvestment",
                source_id=reinvestment.id,
                reason=reason,
            )
            db.add(call)
            db.flush()  # assign call.id before the contribution row references it

            db.add(PropDevPartnerCapitalContribution(
                tenant_id=tenant_id,
                capital_call_id=call.id,
                partner_id=partner.id,
                this_call_amount=split.amount,
                status="Pending",
            ))

    db.commit()
    db.refresh(reinvestment)
    return reinvestment, trigger
