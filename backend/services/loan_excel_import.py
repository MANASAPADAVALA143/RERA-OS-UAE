"""Parse loan Excel uploads — flexible headers, multiple sheets, registry name matching."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models.real_estate.loan import Loan
from models.rentals.models import RentalCompany, RentalProp

# Column header aliases → canonical field (match longer / specific aliases first in _map_headers)
_COL_ALIASES: dict[str, tuple[str, ...]] = {
    "company": ("company name", "company", "entity name", "business name", "entity"),
    "property": ("property name", "property", "building", "suite", "suite name", "building name"),
    "bank": ("loan bank name", "bank name", "bank", "lender bank", "loan bank"),
    "loan_date": ("loan date", "origination date", "start date"),
    "loan_amount": ("loan amount", "sanctioned amount", "disbursed amount", "principal", "original amount"),
    "rate": ("loan interest rate", "interest rate", "int rate", "interest %", "rate %", "rate"),
    "emi": ("loan emi", "monthly emi", "monthly payment", "monthly p&i", "p&i payment", "emi", "payment"),
    "lender_name": ("lender name", "contact name", "loan officer", "relationship manager"),
    "maturity": (
        "loan maturity date", "loan maurity date", "maturity date", "maturity", "maurity",
        "due date", "loan end date",
    ),
    "balance": (
        "loan balance as of", "loan balance", "outstanding balance", "balance outstanding",
        "current balance", "outstanding", "principal balance", "balance",
    ),
    "emi_day": ("loan emi date", "loan emi day", "monthly emi date", "emi date", "emi day", "payment day", "due day"),
    "deduction_acct": ("loan deduction bank account", "deduction account", "payment account"),
    "noi_annual": ("noi annual", "annual noi", "noi"),
    "property_value": ("property value", "current property value", "market value", "appraised value"),
}

# Sheets that are NOT bank mortgage registers (intercompany transfers, personal loans, etc.)
_SKIP_SHEET_NAMES = frozenset({
    "loan info", "personal loans issued", "personal loans", "sheet1",
})

_SKIP_SHEET_SUBSTRINGS = ("closed", "personal loan")

_SKIP_ROW = frozenset({
    "company name", "company", "sl no", "sl no.", "sl", "#",
    "property name", "loan bank", "lender", "loan amount", "total",
})


@dataclass
class ParsedLoanRow:
    company: str
    property_name: str
    bank_name: str
    loan_date: date | None
    loan_amount: float
    loan_interest_rate: float | None
    loan_emi: float | None
    lender_name: str | None
    maturity_date: date | None
    loan_balance: float | None
    loan_emi_day: int | None
    deduction_acct: str | None
    noi_annual: float | None
    property_value: float | None
    sheet: str
    row_num: int


def _norm_header(cell: Any) -> str:
    return re.sub(r"\s+", " ", str(cell or "").strip().lower())


def _valid_company_name(name: str) -> bool:
    s = name.strip()
    if not s or _norm_header(s) in _SKIP_ROW:
        return False
    if re.fullmatch(r"[\d.,$]+", s):
        return False
    return True


def _parse_num(v: Any) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace("$", "").replace(",", "")
    if not s or s in ("-", "—", "n/a", "na"):
        return None
    if s.endswith("%"):
        try:
            return float(s[:-1].strip())
        except ValueError:
            return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(v: Any) -> date | None:
    if v is None:
        return None
    if hasattr(v, "date"):
        return v.date()
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%m-%d-%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%b %d, %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    m = re.search(r"(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})", s)
    if m:
        return _parse_date(m.group(1))
    return None


def _parse_emi_day(v: Any) -> int | None:
    if v is None:
        return None
    digits = re.sub(r"[^0-9]", "", str(v))
    if not digits:
        return None
    d = int(digits)
    return d if 1 <= d <= 31 else None


def _map_headers(header_row: tuple) -> dict[str, int]:
    mapping: dict[str, int] = {}
    normalized = [_norm_header(c) for c in header_row]
    used_cols: set[int] = set()
    field_order = sorted(
        _COL_ALIASES.keys(),
        key=lambda f: max(len(a) for a in _COL_ALIASES[f]),
        reverse=True,
    )
    for field in field_order:
        aliases = _COL_ALIASES[field]
        for idx, h in enumerate(normalized):
            if not h or idx in used_cols:
                continue
            if h in aliases or any(a in h for a in aliases if len(a) > 4):
                mapping[field] = idx
                used_cols.add(idx)
                break
    return mapping


def _cell(row: tuple, col_map: dict[str, int], field: str, fallback: int | None = None) -> Any:
    if field in col_map and col_map[field] < len(row):
        return row[col_map[field]]
    if fallback is not None and fallback < len(row):
        return row[fallback]
    return None


def _is_bank_loan_sheet(col_map: dict[str, int]) -> bool:
    """Require a real bank-loan register layout (not intercompany 'LOAN INFO' sheets)."""
    return (
        "company" in col_map
        and "loan_amount" in col_map
        and "bank" in col_map
        and "property" in col_map
    )


def _find_header_row(rows: list[tuple]) -> tuple[int, dict[str, int]] | None:
    for i, row in enumerate(rows[:25]):
        if not row:
            continue
        labels = [_norm_header(c) for c in row if c is not None and str(c).strip()]
        if not labels:
            continue
        has_company = any("company" in x or x in ("entity", "business name") for x in labels)
        has_amount = any("loan amount" in x or "principal" in x or "sanctioned" in x for x in labels)
        if has_company and has_amount:
            col_map = _map_headers(row)
            if _is_bank_loan_sheet(col_map):
                return i, col_map
    return None


def _parse_row_mapped(
    row: tuple, col_map: dict[str, int], sheet: str, row_num: int, sheet_company: str | None = None,
) -> ParsedLoanRow | None:
    company_raw = _cell(row, col_map, "company")
    company = str(company_raw or "").strip() or (sheet_company or "").strip()
    if not _valid_company_name(company):
        return None
    loan_amount = _parse_num(_cell(row, col_map, "loan_amount"))
    if not loan_amount or loan_amount <= 0:
        return None
    rate_raw = _parse_num(_cell(row, col_map, "rate"))
    rate = rate_raw / 100 if rate_raw is not None and rate_raw > 1 else rate_raw
    prop = str(_cell(row, col_map, "property") or "").strip() or company
    bank = str(_cell(row, col_map, "bank") or "").strip()
    if not bank or bank == "—":
        return None
    return ParsedLoanRow(
        company=company,
        property_name=prop,
        bank_name=bank,
        loan_date=_parse_date(_cell(row, col_map, "loan_date")),
        loan_amount=loan_amount,
        loan_interest_rate=rate,
        loan_emi=_parse_num(_cell(row, col_map, "emi")),
        lender_name=str(_cell(row, col_map, "lender_name") or "").strip() or None,
        maturity_date=_parse_date(_cell(row, col_map, "maturity")),
        loan_balance=_parse_num(_cell(row, col_map, "balance")),
        loan_emi_day=_parse_emi_day(_cell(row, col_map, "emi_day")),
        deduction_acct=str(_cell(row, col_map, "deduction_acct") or "").strip() or None,
        noi_annual=_parse_num(_cell(row, col_map, "noi_annual")),
        property_value=_parse_num(_cell(row, col_map, "property_value")),
        sheet=sheet,
        row_num=row_num,
    )


def parse_loan_workbook(content: bytes) -> list[ParsedLoanRow]:
    import openpyxl

    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    out: list[ParsedLoanRow] = []
    sheet_order = sorted(
        wb.worksheets,
        key=lambda ws: 0 if _norm_header(ws.title) == "bank loan information" else 1,
    )

    for ws in sheet_order:
        title_norm = _norm_header(ws.title)
        if title_norm in _SKIP_SHEET_NAMES or any(s in title_norm for s in _SKIP_SHEET_SUBSTRINGS):
            continue
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        header = _find_header_row(rows)
        if not header:
            continue
        hdr_idx, col_map = header
        sheet_company = (
            ws.title.strip()
            if ws.title and _norm_header(ws.title) not in ("loans", "loan register", "closed_loans")
            else None
        )
        for row_num, row in enumerate(rows[hdr_idx + 1:], start=hdr_idx + 2):
            parsed = _parse_row_mapped(row, col_map, ws.title, row_num, sheet_company)
            if parsed:
                out.append(parsed)
    return out


def _match_registry_names(
    db: Session, tid, company: str, property_name: str,
) -> tuple[str, str]:
    co = db.query(RentalCompany).filter(
        RentalCompany.tenant_id == tid,
        or_(
            func.lower(func.trim(RentalCompany.company_name)) == company.lower().strip(),
            RentalCompany.company_name.ilike(f"%{company.strip()}%"),
        ),
    ).first()
    if not co:
        return company, property_name

    canon_co = co.company_name
    prop = property_name.strip()
    if not prop:
        suite = db.query(RentalProp).filter(RentalProp.company_id == co.id).first()
        return canon_co, suite.property_name if suite else canon_co

    suite = db.query(RentalProp).filter(
        RentalProp.company_id == co.id,
        or_(
            func.lower(func.trim(RentalProp.property_name)) == prop.lower(),
            RentalProp.property_name.ilike(f"%{prop}%"),
        ),
    ).first()
    return canon_co, suite.property_name if suite else prop


def import_rental_loans_from_excel(
    db: Session,
    tid,
    content: bytes,
    created_by: str | None,
) -> dict:
    parsed = parse_loan_workbook(content)
    if not parsed:
        return {
            "created": 0,
            "skipped_rows": [],
            "message": (
                "No bank loan rows found. Use the 'Bank Loan Information' sheet with columns: "
                "Company Name, Property Name, Loan Bank Name, Loan Amount, Interest Rate, EMI, "
                "Maturity Date, Balance."
            ),
            "error": "no_rows",
        }

    for row in parsed:
        row.company, row.property_name = _match_registry_names(
            db, tid, row.company, row.property_name,
        )

    companies_in_file = {p.company for p in parsed}
    sheets_used = sorted({p.sheet for p in parsed})
    existing = db.query(Loan).filter(
        Loan.tenant_id == tid,
        Loan.context_type == "rental",
    ).all()
    for old in existing:
        db.delete(old)
    db.flush()

    created = 0
    for p in parsed:
        db.add(Loan(
            tenant_id=tid,
            company_name=p.company,
            property_name=p.property_name,
            loan_bank_name=p.bank_name,
            loan_date=p.loan_date,
            loan_amount=p.loan_amount,
            loan_interest_rate=p.loan_interest_rate,
            loan_emi=p.loan_emi,
            lender_name=p.lender_name,
            loan_maturity_date=p.maturity_date,
            loan_balance_as_of=p.loan_balance,
            loan_balance_as_of_date=date.today(),
            loan_emi_day=p.loan_emi_day,
            loan_deduction_bank_account=p.deduction_acct,
            noi_annual=p.noi_annual,
            current_property_value=p.property_value,
            context_type="rental",
            created_by=created_by,
        ))
        created += 1

    db.commit()
    return {
        "created": created,
        "skipped_rows": [],
        "companies_updated": sorted(companies_in_file),
        "sheets_parsed": sheets_used,
        "message": f"Imported {created} loan(s) from {', '.join(sheets_used)}.",
    }
