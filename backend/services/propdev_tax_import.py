"""Import Property Dev property tax records from Excel."""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from io import BytesIO

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models.propdev.company import PropDevCompany
from models.propdev.property_tax import PropDevPropertyTax

# Maps normalized header text -> internal field name. First match wins per column.
_HEADER_ALIASES: dict[str, str] = {
    "entityname": "entity_name",
    "entity": "entity_name",
    "companyname": "entity_name",
    "propertyaddress": "property_address",
    "address": "property_address",
    "paidamount": "paid_amount",
    "balance": "balance",
    "paymentdate": "payment_date",
    "paymentstatus": "payment_status",
    "status": "payment_status",
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def _match_propdev_company(db: Session, tenant_id: uuid.UUID, name: str) -> PropDevCompany | None:
    needle = name.strip()
    if not needle:
        return None
    return db.query(PropDevCompany).filter(
        PropDevCompany.tenant_id == tenant_id,
        or_(
            func.lower(func.trim(PropDevCompany.name)) == needle.lower(),
            PropDevCompany.name.ilike(f"%{needle}%"),
        ),
    ).first()


def _parse_num(v) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace("$", "").replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def _parse_date(v) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%m-%d-%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _find_header(rows: list[tuple]) -> tuple[int, dict[str, int], int | None] | None:
    """Locate the header row and map field -> column index. Returns (row_idx, col_map, tax_year_col)."""
    for idx, row in enumerate(rows[:5]):
        col_map: dict[str, int] = {}
        tax_year_col = None
        tax_with_penalty_col = None
        for ci, cell in enumerate(row):
            if cell is None:
                continue
            norm = _norm(cell)
            if not norm:
                continue
            if norm in _HEADER_ALIASES:
                col_map[_HEADER_ALIASES[norm]] = ci
                continue
            # "2025 Tax with Penalty" / "2025 With Penalty" -> tax_with_penalty (check before bare year)
            if "penalty" in norm:
                tax_with_penalty_col = ci
                continue
            # A bare 4-digit year column ("2025") is the base tax amount for that year.
            m = re.fullmatch(r"(20\d{2})", norm)
            if m:
                tax_year_col = ci
                col_map["_tax_year_value"] = int(m.group(1))
                col_map["tax_amount"] = ci
        if tax_with_penalty_col is not None:
            col_map["tax_with_penalty"] = tax_with_penalty_col
        if "entity_name" in col_map and ("tax_amount" in col_map or "tax_with_penalty" in col_map):
            return idx, col_map, tax_year_col
    return None


def import_propdev_property_tax_from_excel(
    db: Session,
    tenant_id: uuid.UUID,
    content: bytes,
) -> dict:
    import openpyxl

    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"imported": 0, "errors": [], "message": "Workbook is empty."}

    header = _find_header(rows)
    if not header:
        return {
            "imported": 0,
            "errors": [],
            "message": (
                "Could not find a header row with 'Entity Name' and a tax-year column "
                "(e.g. '2025', '2025 Tax with Penalty'). Expected columns: SL No, Entity Name, "
                "Property Address, <Year>, <Year> Tax with Penalty, Paid Amount, Balance, "
                "Payment Date, Payment Status."
            ),
        }
    hdr_idx, col_map, _tax_year_col = header
    tax_year = col_map.pop("_tax_year_value", None)

    imported = 0
    errors: list[str] = []
    matched_entities: set[str] = set()

    for row_num, row in enumerate(rows[hdr_idx + 1:], start=hdr_idx + 2):
        def cell(field: str):
            ci = col_map.get(field)
            return row[ci] if ci is not None and ci < len(row) else None

        entity_name = str(cell("entity_name") or "").strip()
        if not entity_name:
            continue

        tax_amount = _parse_num(cell("tax_amount"))
        tax_with_penalty = _parse_num(cell("tax_with_penalty")) or tax_amount
        if tax_amount == 0 and tax_with_penalty == 0:
            continue

        company = _match_propdev_company(db, tenant_id, entity_name)
        if not company:
            errors.append(f"Row {row_num}: entity '{entity_name}' not in Property Dev registry — imported unlinked")
        else:
            matched_entities.add(company.name)

        db.add(PropDevPropertyTax(
            tenant_id=tenant_id,
            company_id=company.id if company else None,
            entity_name=company.name if company else entity_name,
            property_address=str(cell("property_address") or "").strip() or None,
            tax_year=tax_year,
            tax_amount=tax_amount,
            tax_with_penalty=tax_with_penalty,
            paid_amount=_parse_num(cell("paid_amount")),
            balance=_parse_num(cell("balance")),
            payment_date=_parse_date(cell("payment_date")),
            payment_status=str(cell("payment_status") or "").strip() or None,
        ))
        imported += 1

    if imported == 0:
        return {"imported": 0, "errors": errors, "message": "No property tax rows found in the workbook."}

    db.commit()

    msg = f"Imported {imported} property tax record(s) across {len(matched_entities)} matched entit{'y' if len(matched_entities) == 1 else 'ies'}."
    if errors:
        msg += f" {len(errors)} row(s) did not match a registry entity (imported unlinked)."

    return {
        "imported": imported,
        "errors": errors[:20],
        "matched_entities": sorted(matched_entities),
        "message": msg,
    }
