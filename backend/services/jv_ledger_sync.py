"""Sync PropDev JV Ledger partners into Rentals ownership positions."""
from __future__ import annotations

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.company import PropDevCompany
from models.propdev.partner import PropDevPartner
from models.rentals.models import RentalCompany, RentalOwnership, RentalPartnerRole, RentalProp


def _norm_pct(raw: float) -> float:
    return raw / 100 if raw > 1 else raw


def _role_from_type(partner_type: str) -> RentalPartnerRole:
    t = (partner_type or "").strip().lower()
    if "gp" in t or "general" in t:
        return RentalPartnerRole.general_partner
    if "sole" in t or "100" in t:
        return RentalPartnerRole.sole_owner
    return RentalPartnerRole.limited_partner


def _match_rental_company(db: Session, tid, name: str) -> RentalCompany | None:
    n = name.strip()
    if not n:
        return None
    return db.query(RentalCompany).filter(
        RentalCompany.tenant_id == tid,
        or_(
            func.lower(func.trim(RentalCompany.company_name)) == n.lower(),
            RentalCompany.company_name.ilike(f"%{n}%"),
        ),
    ).first()


def _match_rental_property(db: Session, company_id, name: str) -> RentalProp | None:
    prop = (name or "").strip()
    if not prop:
        return None
    return db.query(RentalProp).filter(
        RentalProp.company_id == company_id,
        or_(
            func.lower(func.trim(RentalProp.property_name)) == prop.lower(),
            RentalProp.property_name.ilike(f"%{prop}%"),
        ),
    ).first()


def _company_debt(db: Session, company: PropDevCompany) -> float:
    total = 0.0
    for loan in company.loans:
        total += float(loan.balance or 0)
    return total


def sync_jv_ledger_to_ownership(db: Session, tid, *, replace: bool = False) -> dict:
    """Copy PropDev partner positions into r_ownership.

    Matches PropDev company ``name`` to Rentals ``company_name`` in Company Registry.
    When ``replace`` is True, clears existing rental ownership rows first (same as Excel import).
    """
    partners = (
        db.query(PropDevPartner)
        .filter(PropDevPartner.tenant_id == tid)
        .all()
    )
    if not partners:
        return {
            "synced_count": 0,
            "errors": ["No JV Ledger partners found in PropDev."],
            "error": "no_rows",
        }

    errors: list[str] = []
    to_upsert: list[RentalOwnership] = []

    for partner in partners:
        pd_co: PropDevCompany | None = partner.company
        if not pd_co:
            errors.append(f"Partner '{partner.name}': missing PropDev company")
            continue

        rental_co = _match_rental_company(db, tid, pd_co.name)
        if not rental_co:
            errors.append(
                f"Partner '{partner.name}': PropDev company '{pd_co.name}' not found in Rentals Company Registry",
            )
            continue

        suite = _match_rental_property(db, rental_co.id, pd_co.property_name)
        pct = _norm_pct(float(partner.share_percent))
        cap = float(partner.capital_contributed or 0)
        debt_share = _company_debt(db, pd_co) * pct

        to_upsert.append(RentalOwnership(
            tenant_id=tid,
            company_id=rental_co.id,
            property_id=suite.id if suite else None,
            partner_name=partner.name,
            property_name=suite.property_name if suite else (pd_co.property_name or pd_co.name),
            property_address=pd_co.address,
            entity_structure=partner.partner_type,
            ownership_pct=pct,
            role=_role_from_type(partner.partner_type),
            cost_basis=cap if cap > 0 else None,
            book_value=cap if cap > 0 else None,
            existing_debt=debt_share if debt_share > 0 else None,
            capital_contributed=cap if cap > 0 else None,
        ))

    if not to_upsert:
        return {
            "synced_count": 0,
            "errors": errors or ["No partners could be matched to Rentals companies."],
            "error": "no_rows",
        }

    if replace:
        for old in db.query(RentalOwnership).filter(RentalOwnership.tenant_id == tid).all():
            db.delete(old)
        db.flush()
        for rec in to_upsert:
            db.add(rec)
    else:
        for rec in to_upsert:
            existing = db.query(RentalOwnership).filter(
                RentalOwnership.tenant_id == tid,
                RentalOwnership.company_id == rec.company_id,
                RentalOwnership.partner_name == rec.partner_name,
                RentalOwnership.property_name == rec.property_name,
            ).first()
            if existing:
                existing.ownership_pct = rec.ownership_pct
                existing.role = rec.role
                existing.entity_structure = rec.entity_structure
                existing.property_id = rec.property_id
                existing.property_address = rec.property_address
                existing.cost_basis = rec.cost_basis
                existing.book_value = rec.book_value
                existing.existing_debt = rec.existing_debt
                existing.capital_contributed = rec.capital_contributed
            else:
                db.add(rec)

    db.commit()

    capital_calls = db.query(PropDevCapitalCall).filter(PropDevCapitalCall.tenant_id == tid).count()

    return {
        "synced_count": len(to_upsert),
        "jv_partners": len(partners),
        "capital_call_rows": capital_calls,
        "errors": errors,
        "message": f"Synced {len(to_upsert)} ownership position(s) from JV Ledger.",
    }
