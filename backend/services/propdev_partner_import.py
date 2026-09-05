"""Import Property Dev partners from the same Asset Protection workbook as Rentals Ownership."""
from __future__ import annotations

import uuid

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.company import PropDevCompany
from models.propdev.distribution import PropDevDistribution
from models.propdev.partner import PropDevPartner
from services.ownership_excel_import import ParsedOwnershipRow, parse_ownership_workbook
from services.partner_capital import resolve_capital_contributed


def _normalize_share_percent(pct: float) -> float:
    """Store as 0–100 percentage (PropDev frontend convention)."""
    if pct <= 0:
        return 0.0
    if pct <= 1:
        pct = pct * 100.0
    return round(min(pct, 100.0), 4)


def _partner_type(row: ParsedOwnershipRow) -> str:
    structure = (row.entity_structure or "").strip()
    line = (row.entity_line or "").strip()
    label = structure or (line if line != "Rental" or not structure else line) or "Class A"
    return label[:50]


def _match_propdev_company(
    db: Session,
    tenant_id: uuid.UUID,
    entity_name: str,
    property_name: str | None = None,
) -> PropDevCompany | None:
    """Match Property Dev Company Registry — same idea as Rentals ownership company match."""
    needle = entity_name.strip()
    if not needle:
        return None
    base = db.query(PropDevCompany).filter(PropDevCompany.tenant_id == tenant_id)
    company = base.filter(
        func.lower(func.trim(PropDevCompany.name)) == needle.lower(),
    ).first()
    if company:
        return company
    company = base.filter(PropDevCompany.name.ilike(f"%{needle}%")).first()
    if company:
        return company
    prop = (property_name or "").strip()
    if prop:
        return base.filter(
            or_(
                func.lower(func.trim(PropDevCompany.property_name)) == prop.lower(),
                PropDevCompany.property_name.ilike(f"%{prop}%"),
            ),
        ).first()
    return None


def import_propdev_partners_from_excel(db: Session, tenant_id: uuid.UUID, content: bytes) -> dict:
    """Mirror ``import_ownership_from_excel`` — parse, match registry, replace-all, return summary."""
    parsed_result = parse_ownership_workbook(content, entity_scope="propdev")
    parsed = parsed_result.rows
    if not parsed:
        sheets_hint = (
            f" Sheets scanned: {', '.join(parsed_result.sheets_parsed)}."
            if parsed_result.sheets_parsed else ""
        )
        hint = (
            "No rows with Entity = Construction, Development, Holding, Prop Dev, or Partner found. "
            "Upload the Asset Protection workbook and include all three register tabs — "
            "Personal Entities, Partnership Entities (Family), and Partnership Entities. "
            "Property Dev imports development / partner lines only (Rental/Land/Personal rows are skipped)."
            if parsed_result.has_entity_line_column
            else "No partner rows found."
        )
        return {
            "imported_count": 0,
            "partners_imported": 0,
            "skipped_non_propdev": parsed_result.skipped_non_rental,
            "skipped_non_rental": parsed_result.skipped_non_rental,
            "sheets_parsed": parsed_result.sheets_parsed,
            "errors": [
                f"{hint}{sheets_hint} Expected columns: Entity, Entity Name, Owned By, "
                "Property Address, Property Name, Ownership %, Entity Structure, "
                "Cost Basis, Book Value, Fair Market Value, Existing Debt, Capital Contributed (optional), "
                "Distributions Received (optional).",
            ],
            "error": "no_rows",
        }

    errors: list[str] = []
    company_names: set[str] = set()

    # Upsert by (company_id, lower(name)) instead of delete-all-then-insert: once a partner
    # has a Capital Call or Distribution recorded against it, hard-deleting that partner row
    # violates the FK on propdev_capital_calls.partner_id / propdev_distributions.partner_id
    # (no ON DELETE CASCADE) and crashes the whole import with a 500. Updating in place
    # preserves the id those child rows point to.
    existing_by_key: dict[tuple[uuid.UUID, str], PropDevPartner] = {
        (p.company_id, p.name.strip().lower()): p
        for p in db.query(PropDevPartner).filter(PropDevPartner.tenant_id == tenant_id).all()
    }
    seen_keys: set[tuple[uuid.UUID, str]] = set()
    imported = 0

    for row in parsed:
        company = _match_propdev_company(db, tenant_id, row.entity_name, row.property_name)
        if not company:
            errors.append(
                f"Row {row.row_num}: company '{row.entity_name}' not found in Property Dev Company Registry"
            )
            continue
        company_names.add(company.name)
        capital, capital_estimated = resolve_capital_contributed(
            explicit=row.capital_contributed,
            cost_basis=row.cost_basis,
            existing_debt=row.existing_debt,
            book_value=row.book_value,
        )
        distributions = float(row.distributions_received or 0)
        share = _normalize_share_percent(row.ownership_pct)
        key = (company.id, row.partner_name.strip().lower())
        seen_keys.add(key)
        rec = existing_by_key.get(key)
        if rec is None:
            rec = PropDevPartner(tenant_id=tenant_id, company_id=company.id, name=row.partner_name)
            db.add(rec)
            existing_by_key[key] = rec
        rec.partner_type = _partner_type(row)
        rec.share_percent = share or 100.0
        rec.capital_contributed = capital
        rec.capital_contributed_estimated = capital_estimated
        rec.distributions_received = distributions
        rec.status = "Active"
        rec.entity_name = row.entity_name
        rec.property_name = row.property_name or row.entity_name
        rec.property_address = row.property_address
        rec.entity_line = row.entity_line
        rec.cost_basis = row.cost_basis
        rec.book_value = row.book_value
        rec.fair_market_value = row.fair_market_value
        rec.existing_debt = row.existing_debt
        imported += 1

    if imported == 0:
        db.rollback()
        return {
            "imported_count": 0,
            "partners_imported": 0,
            "skipped_non_propdev": parsed_result.skipped_non_rental,
            "skipped_non_rental": parsed_result.skipped_non_rental,
            "sheets_parsed": parsed_result.sheets_parsed,
            "errors": errors or ["No rows could be matched to companies in Property Dev Company Registry."],
            "error": "no_rows",
        }

    # Remove partners that are no longer in this file -- but only if nothing points at them.
    skipped_fk = 0
    for key, rec in existing_by_key.items():
        if key in seen_keys or rec.id is None:
            continue
        has_calls = db.query(PropDevCapitalCall.id).filter(PropDevCapitalCall.partner_id == rec.id).first()
        has_dist = db.query(PropDevDistribution.id).filter(PropDevDistribution.partner_id == rec.id).first()
        if has_calls or has_dist:
            skipped_fk += 1
            continue
        db.delete(rec)

    db.commit()

    companies = sorted(company_names)
    msg = f"Imported {imported} Property Dev partner position(s)."
    if skipped_fk:
        msg += f" Kept {skipped_fk} prior partner(s) with recorded Capital Calls/Distributions not in this file."
    if parsed_result.sheets_parsed:
        msg += f" Sheets: {', '.join(parsed_result.sheets_parsed)}."
    if parsed_result.skipped_non_rental:
        msg += (
            f" Skipped {parsed_result.skipped_non_rental} row(s) where Entity is not "
            "Construction / Development / Holding / Prop Dev / Partner."
        )
    if errors:
        msg += f" Skipped {len(errors)} row(s) not in Company Registry."

    return {
        "imported_count": imported,
        "partners_imported": imported,
        "companies_updated": len(companies),
        "companies": companies,
        "skipped_non_propdev": parsed_result.skipped_non_rental,
        "skipped_non_rental": parsed_result.skipped_non_rental,
        "sheets_parsed": parsed_result.sheets_parsed,
        "errors": errors,
        "message": msg,
    }
