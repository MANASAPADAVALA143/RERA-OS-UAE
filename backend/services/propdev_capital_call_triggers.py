"""Auto-generates a capital call (propdev_capital_calls, one row per active
partner, matching the existing manual/Excel-import shape -- see
services/propdev_lot_reinvestment.py for why) when an entity's Unrealised
Gain/(Loss) = FMV - Book Value goes materially negative.

Deliberately a backend service, not something computed only on the frontend,
so the materiality/duplicate-guard rules are visible in one place and
directly unit-testable.

Two guards keep this from generating call noise:
  1. Materiality floor -- a $1 unrealised loss from BS rounding shouldn't
     spawn a call. Gated on the GREATER of a fixed dollar floor or a % of
     Book Value, so it scales with entity size.
  2. Duplicate guard -- while an unrealised_loss call is still open
     (Pending/Outstanding) for an entity, re-triggering (e.g. on every
     financials re-upload while the entity stays underwater) does not
     insert a second one.
"""
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.company import PropDevCompany
from models.propdev.partner import PropDevPartner
from models.propdev.partner_capital_contribution import PropDevPartnerCapitalContribution

MATERIALITY_DOLLAR_FLOOR = 5_000.0
MATERIALITY_PCT_OF_BOOK_VALUE = 0.02

OPEN_STATUSES = ("Pending", "Outstanding", "Partial")


@dataclass
class PartnerSplit:
    partner_id: uuid.UUID
    share_percent: float
    amount: float


@dataclass
class CapitalCallTrigger:
    cash_needed: float
    capital_call_amount: float
    splits: list[PartnerSplit]


def _split_amount_across_partners(
    amount: float, partners: list[tuple[uuid.UUID, float]],
) -> list[PartnerSplit]:
    """Normalizes against the sum of share_percent rather than assuming it
    already totals exactly 100 -- partner records can drift."""
    active = [(pid, pct) for pid, pct in partners if pct]
    total_pct = sum(pct for _, pct in active)
    splits: list[PartnerSplit] = []
    for partner_id, pct in active:
        weight = (pct / total_pct) if total_pct > 0 else (1 / len(active) if active else 0)
        splits.append(PartnerSplit(partner_id=partner_id, share_percent=pct, amount=round(amount * weight, 2)))
    return splits


def compute_unrealised_loss_trigger(
    unrealised_gl: float,
    book_value: float,
    partners: list[tuple[uuid.UUID, float]],
) -> CapitalCallTrigger | None:
    """Pure function, no DB access.

    Returns None when there's no loss, or the loss doesn't clear the
    materiality floor (max($5,000, 2% of Book Value)). Otherwise returns the
    full loss amount and its per-partner split.
    """
    if unrealised_gl >= 0:
        return None

    loss = abs(unrealised_gl)
    threshold = max(MATERIALITY_DOLLAR_FLOOR, abs(book_value) * MATERIALITY_PCT_OF_BOOK_VALUE)
    if loss <= threshold:
        return None

    splits = _split_amount_across_partners(loss, partners)
    return CapitalCallTrigger(cash_needed=loss, capital_call_amount=loss, splits=splits)


def has_open_unrealised_loss_call(db: Session, tenant_id: uuid.UUID, company_id: uuid.UUID) -> bool:
    return db.query(PropDevCapitalCall).filter(
        PropDevCapitalCall.tenant_id == tenant_id,
        PropDevCapitalCall.company_id == company_id,
        PropDevCapitalCall.source_type == "unrealised_loss",
        PropDevCapitalCall.status.in_(OPEN_STATUSES),
    ).first() is not None


def insert_unrealised_loss_capital_call(
    db: Session,
    tenant_id: uuid.UUID,
    company_id: uuid.UUID,
    unrealised_gl: float,
    book_value: float,
) -> CapitalCallTrigger | None:
    """Computes the trigger and, if warranted, inserts one propdev_capital_calls
    row per active partner (source_type='unrealised_loss') plus a matching
    propdev_partner_capital_contributions row per partner. Skips entirely
    (returns None, no insert) if a call for this entity+source is already open.
    Commits once at the end.
    """
    company = db.query(PropDevCompany).filter(
        PropDevCompany.id == company_id, PropDevCompany.tenant_id == tenant_id,
    ).first()
    if not company:
        raise ValueError(f"Company {company_id} not found for tenant {tenant_id}")

    partners = db.query(PropDevPartner).filter(
        PropDevPartner.company_id == company_id,
        PropDevPartner.status != "Exited",
    ).all()
    partner_pairs = [(p.id, float(p.share_percent or 0)) for p in partners]

    trigger = compute_unrealised_loss_trigger(unrealised_gl, book_value, partner_pairs)
    if trigger is None:
        return None

    if has_open_unrealised_loss_call(db, tenant_id, company_id):
        return None

    partners_by_id = {p.id: p for p in partners}
    reason = f"Auto-generated: Unrealised loss on {company.name}"
    for split in trigger.splits:
        partner = partners_by_id[split.partner_id]
        call = PropDevCapitalCall(
            tenant_id=tenant_id,
            company_id=company_id,
            partner_id=partner.id,
            period=date.today().strftime("%b %Y"),
            share_percent=split.share_percent,
            total_call_amount=trigger.capital_call_amount,
            partner_share=split.amount,
            old_dues=0,
            total_due=split.amount,
            amount_received=0,
            received_date=None,
            due_date=date.today(),
            # Not "Pending" -- propdev_capital_calls.status is a fixed union
            # (Paid/Partial/Outstanding/Overdue) that both the frontend type and
            # STATUS_BADGE lookup depend on; "Pending" would render as a blank
            # badge. "Pending" lives on the contribution row instead, which has
            # no such existing constraint. Same convention as the lot
            # reinvestment trigger (services/propdev_lot_reinvestment.py).
            status="Outstanding",
            source_type="unrealised_loss",
            source_id=None,
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
    return trigger
