"""Parse loan Excel uploads — flexible headers, multiple sheets, registry name matching."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models.real_estate.loan import Loan
from models.rentals.models import RentalCompany, RentalProp

_COMPANY_HEADERS = frozenset({"entity name", "company name", "company"})
_ENTITY_LINE_HEADERS = frozenset({
    "entity", "business line", "line of business", "entity line", "business unit",
})

_COL_ALIASES: dict[str, tuple[str, ...]] = {
    "property": ("property name", "property", "building", "suite", "suite name", "building name"),
    "bank": ("loan bank name", "bank name", "bank", "lender bank", "loan bank"),
    "account_no": ("loan acc no", "loan account no", "account no", "account number", "loan ac no"),
    "loan_date": ("loan date", "origination date", "start date"),
    "loan_amount": ("loan amount", "sanctioned amount", "disbursed amount", "principal", "original amount"),
    "rate": ("loan interest rate", "interest rate", "int rate", "interest %", "rate %"),
    "emi": ("loan emi", "monthly emi", "monthly payment", "monthly p&i", "p&i payment", "emi", "payment"),
    "lender_name": ("lender name", "contact name", "loan officer", "relationship manager"),
    "maturity": (
        "loan maturity date", "loan maurity date", "maturity date", "maturity", "maurity",
        "due date", "loan end date",
    ),
    "balance": (
        "loan balance as of", "loan balance", "outstanding balance", "balance outstanding",
        "current balance", "outstanding", "principal balance",
    ),
    "emi_day": ("loan emi date", "loan emi day", "monthly emi date", "emi date", "emi day", "payment day", "due day"),
    "deduction_acct": ("loan deduction bank account", "deduction account", "payment account"),
    "noi_annual": ("noi annual", "annual noi", "noi"),
    "property_value": ("property value", "current property value", "market value", "appraised value"),
}

_SKIP_SHEET_NAMES = frozenset({
    "loan info", "personal loans issued", "personal loans", "sheet1",
})

_SKIP_SHEET_SUBSTRINGS = ("closed", "personal loan")

_SKIP_ROW = frozenset({
    "company name", "entity name", "company", "sl no", "sl no.", "sl", "#",
    "property name", "loan bank", "lender", "loan amount", "total", "entity",
})

_NON_RENTAL_ENTITY_TOKENS = (
    "construction", "development", "holding", "reit", "prop dev", "property dev",
)

_MONTH_NAMES = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_MONTH_HEADER_RE = re.compile(
    r"(?i)(?:(?:loan\s+)?balance\s+)?"
    r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    r"[\s\-_/]*"
    r"(\d{4})"
)


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
    account_no: str | None
    balance_by_month: dict[str, float] = field(default_factory=dict)
    sheet: str = ""
    row_num: int = 0


@dataclass
class ParseLoanWorkbookResult:
    rows: list[ParsedLoanRow]
    balance_periods: list[str]
    skipped_non_rental: int
    has_entity_line_column: bool


def _norm_header(cell: Any) -> str:
    return re.sub(r"\s+", " ", str(cell or "").strip().lower())


def is_rental_entity_line(val: Any) -> bool:
    if val is None or not str(val).strip():
        return True
    key = _norm_header(val)
    if not key:
        return True
    if any(token in key for token in _NON_RENTAL_ENTITY_TOKENS):
        return False
    if "rental" in key:
        return True
    if key in ("rentals", "property management", "real estate rental", "rental portfolio"):
        return True
    return False


def _valid_company_name(name: str) -> bool:
    s = name.strip()
    if not s or _norm_header(s) in _SKIP_ROW:
        return False
    if re.fullmatch(r"[\d.,$]+", s):
        return False
    if _norm_header(s) in _ENTITY_LINE_HEADERS:
        return False
    return True


def _date_period_from_balance_header(header: str) -> str | None:
    """Extract YYYY-MM from headers like 'Loan Balance as on 04/30/2026'."""
    m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", str(header or ""))
    if not m:
        return None
    mo, _day, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if yr < 100:
        yr += 2000
    if 1 <= mo <= 12:
        return f"{yr:04d}-{mo:02d}"
    return None


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


def _month_key_from_header(header: str) -> str | None:
    h = _norm_header(header)
    if not h:
        return None
    m_iso = re.fullmatch(r"(\d{4})[-/](\d{1,2})", h)
    if m_iso:
        y, mo = int(m_iso.group(1)), int(m_iso.group(2))
        if 1 <= mo <= 12:
            return f"{y:04d}-{mo:02d}"
    m = _MONTH_HEADER_RE.search(h)
    if m:
        mon_token = m.group(1)[:3].lower()
        year = int(m.group(2))
        month = _MONTH_NAMES.get(mon_token)
        if month:
            return f"{year:04d}-{month:02d}"
    m2 = re.search(
        r"(?i)(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-_/]+(\d{4})",
        h,
    )
    if m2:
        month = _MONTH_NAMES.get(m2.group(1)[:3].lower())
        if month:
            return f"{int(m2.group(2)):04d}-{month:02d}"
    return None


def _map_headers(header_row: tuple) -> tuple[dict[str, int], dict[str, int]]:
    labels = [_norm_header(c) for c in header_row]
    has_entity_name_col = any(h in _COMPANY_HEADERS for h in labels if h)

    mapping: dict[str, int] = {}
    for idx, cell in enumerate(header_row):
        h = _norm_header(cell)
        if not h:
            continue
        if h in _COMPANY_HEADERS:
            mapping["company"] = idx
            continue
        if h in _ENTITY_LINE_HEADERS:
            if h == "entity" and not has_entity_name_col:
                mapping["company"] = idx
            else:
                mapping["entity_line"] = idx
            continue
        for fld, aliases in _COL_ALIASES.items():
            if fld in mapping:
                continue
            if h in aliases or any(a in h for a in aliases if len(a) > 4):
                mapping[fld] = idx
                break

    used = set(mapping.values())
    monthly: dict[str, int] = {}
    for idx, cell in enumerate(header_row):
        if idx in used:
            continue
        key = _month_key_from_header(str(cell or ""))
        if key:
            monthly[key] = idx
    return mapping, monthly


def _cell(row: tuple, col_map: dict[str, int], field: str, fallback: int | None = None) -> Any:
    if field in col_map and col_map[field] < len(row):
        return row[col_map[field]]
    if fallback is not None and fallback < len(row):
        return row[fallback]
    return None


def _is_bank_loan_sheet(col_map: dict[str, int]) -> bool:
    return "company" in col_map and "loan_amount" in col_map and "bank" in col_map


def _find_header_row(rows: list[tuple]) -> tuple[int, dict[str, int], dict[str, int]] | None:
    for i, row in enumerate(rows[:25]):
        if not row:
            continue
        labels = [_norm_header(c) for c in row if c is not None and str(c).strip()]
        if not labels:
            continue
        has_entity_name = any(x in _COMPANY_HEADERS for x in labels)
        has_legacy_entity = "entity" in labels and not has_entity_name
        has_company = has_entity_name or has_legacy_entity or any("company" in x for x in labels)
        has_amount = any(
            "loan amount" in x or "principal" in x or "sanctioned" in x or x == "amount"
            for x in labels
        )
        has_bank = any("bank" in x or "lender" in x for x in labels)
        if has_company and has_amount and has_bank:
            col_map, monthly = _map_headers(row)
            if _is_bank_loan_sheet(col_map):
                return i, col_map, monthly
    return None


def _parse_row_mapped(
    row: tuple,
    col_map: dict[str, int],
    monthly_cols: dict[str, int],
    header_row: tuple,
    sheet: str,
    row_num: int,
    *,
    filter_entity_line: bool,
    sheet_company: str | None = None,
) -> ParsedLoanRow | None:
    entity_line_raw = _cell(row, col_map, "entity_line") if "entity_line" in col_map else None
    if filter_entity_line and not is_rental_entity_line(entity_line_raw):
        return None

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

    balance_by_month: dict[str, float] = {}
    for period, idx in monthly_cols.items():
        if idx < len(row):
            val = _parse_num(row[idx])
            if val is not None:
                balance_by_month[period] = val

    static_balance = _parse_num(_cell(row, col_map, "balance"))
    if static_balance is not None:
        balance_hdr = ""
        if "balance" in col_map and col_map["balance"] < len(header_row):
            balance_hdr = str(header_row[col_map["balance"]] or "")
        period_key = _date_period_from_balance_header(balance_hdr)
        if period_key:
            balance_by_month[period_key] = static_balance

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
        loan_balance=static_balance,
        loan_emi_day=_parse_emi_day(_cell(row, col_map, "emi_day")),
        deduction_acct=str(_cell(row, col_map, "deduction_acct") or "").strip() or None,
        noi_annual=_parse_num(_cell(row, col_map, "noi_annual")),
        property_value=_parse_num(_cell(row, col_map, "property_value")),
        account_no=str(_cell(row, col_map, "account_no") or "").strip() or None,
        balance_by_month=balance_by_month,
        sheet=sheet,
        row_num=row_num,
    )


def _collect_balance_periods(rows: list[ParsedLoanRow]) -> list[str]:
    keys: set[str] = set()
    for row in rows:
        keys.update(row.balance_by_month.keys())
    return sorted(keys)


def _balance_for_period(row: ParsedLoanRow, period: str | None) -> tuple[float | None, date | None]:
    if period and period in row.balance_by_month:
        y, m = period.split("-")
        return row.balance_by_month[period], date(int(y), int(m), 1)
    if row.loan_balance is not None:
        return row.loan_balance, date.today()
    if row.balance_by_month:
        latest = max(row.balance_by_month.keys())
        y, m = latest.split("-")
        return row.balance_by_month[latest], date(int(y), int(m), 1)
    return None, None


def parse_loan_workbook(content: bytes) -> ParseLoanWorkbookResult:
    import openpyxl

    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    out: list[ParsedLoanRow] = []
    skipped_non_rental = 0
    has_entity_line = False
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
        hdr_idx, col_map, monthly_cols = header
        header_row = rows[hdr_idx]
        filter_entity_line = "entity_line" in col_map
        if filter_entity_line:
            has_entity_line = True
        sheet_company = (
            ws.title.strip()
            if ws.title and _norm_header(ws.title) not in ("loans", "loan register", "closed_loans", "bank loan information")
            else None
        )
        for row_num, row in enumerate(rows[hdr_idx + 1:], start=hdr_idx + 2):
            if filter_entity_line:
                entity_line_raw = _cell(row, col_map, "entity_line")
                if not is_rental_entity_line(entity_line_raw):
                    if _cell(row, col_map, "company") or _parse_num(_cell(row, col_map, "loan_amount")):
                        skipped_non_rental += 1
                    continue
            parsed = _parse_row_mapped(
                row, col_map, monthly_cols, header_row, ws.title, row_num,
                filter_entity_line=False,
                sheet_company=sheet_company,
            )
            if parsed:
                out.append(parsed)

    return ParseLoanWorkbookResult(
        rows=out,
        balance_periods=_collect_balance_periods(out),
        skipped_non_rental=skipped_non_rental,
        has_entity_line_column=has_entity_line,
    )


def _match_company(db: Session, tid, name: str) -> RentalCompany | None:
    return db.query(RentalCompany).filter(
        RentalCompany.tenant_id == tid,
        or_(
            func.lower(func.trim(RentalCompany.company_name)) == name.lower().strip(),
            RentalCompany.company_name.ilike(f"%{name.strip()}%"),
        ),
    ).first()


def _match_property(db: Session, company_id, name: str) -> RentalProp | None:
    prop = name.strip()
    if not prop:
        return None
    return db.query(RentalProp).filter(
        RentalProp.company_id == company_id,
        or_(
            func.lower(func.trim(RentalProp.property_name)) == prop.lower(),
            RentalProp.property_name.ilike(f"%{prop}%"),
        ),
    ).first()


def _resolve_registry_names(
    db: Session, tid, company: str, property_name: str,
) -> tuple[str, str] | None:
    co = _match_company(db, tid, company)
    if not co:
        return None
    canon_co = co.company_name
    prop = property_name.strip()
    if not prop:
        suite = db.query(RentalProp).filter(RentalProp.company_id == co.id).first()
        return canon_co, suite.property_name if suite else canon_co
    suite = _match_property(db, co.id, prop)
    return canon_co, suite.property_name if suite else prop


def import_rental_loans_from_excel(
    db: Session,
    tid,
    content: bytes,
    created_by: str | None,
    *,
    balance_period: str | None = None,
) -> dict:
    parsed_result = parse_loan_workbook(content)
    parsed = parsed_result.rows
    if not parsed:
        return {
            "created": 0,
            "skipped_rows": [],
            "skipped_non_rental": parsed_result.skipped_non_rental,
            "balance_periods": parsed_result.balance_periods,
            "message": (
                "No bank loan rows found. Use the 'Bank Loan Information' sheet with columns: "
                "Entity Name (or Company Name), Property Name, Loan Bank Name, Loan Amount, "
                "Interest Rate, EMI, Maturity Date, Balance. Set Entity = Rental when present."
            ),
            "error": "no_rows",
        }

    period = balance_period
    file_periods = _collect_balance_periods(parsed)
    if file_periods:
        if not period or period not in file_periods:
            period = file_periods[-1]

    errors: list[str] = []
    matched: list[ParsedLoanRow] = []
    for row in parsed:
        resolved = _resolve_registry_names(db, tid, row.company, row.property_name)
        if not resolved:
            errors.append(
                f"Row {row.row_num}: company '{row.company}' not found in Company Registry — skipped"
            )
            continue
        row.company, row.property_name = resolved
        matched.append(row)

    if not matched:
        return {
            "created": 0,
            "skipped_rows": errors,
            "skipped_non_rental": parsed_result.skipped_non_rental,
            "skipped_registry": len(errors),
            "balance_periods": parsed_result.balance_periods,
            "message": (
                "No loans imported — no rows matched Company Registry rental companies."
            ),
            "error": "no_rows",
        }

    companies_in_file = {p.company for p in matched}
    sheets_used = sorted({p.sheet for p in matched})
    existing = db.query(Loan).filter(
        Loan.tenant_id == tid,
        Loan.context_type == "rental",
    ).all()
    for old in existing:
        db.delete(old)
    db.flush()

    created = 0
    for p in matched:
        bal, bal_date = _balance_for_period(p, period)
        db.add(Loan(
            tenant_id=tid,
            company_name=p.company,
            property_name=p.property_name,
            loan_bank_name=p.bank_name,
            loan_account_no=p.account_no,
            loan_date=p.loan_date,
            loan_amount=p.loan_amount,
            loan_interest_rate=p.loan_interest_rate,
            loan_emi=p.loan_emi,
            lender_name=p.lender_name,
            loan_maturity_date=p.maturity_date,
            loan_balance_as_of=bal,
            loan_balance_as_of_date=bal_date,
            loan_emi_day=p.loan_emi_day,
            loan_deduction_bank_account=p.deduction_acct,
            noi_annual=p.noi_annual,
            current_property_value=p.property_value,
            balance_by_month=p.balance_by_month or None,
            context_type="rental",
            created_by=created_by,
        ))
        created += 1

    db.commit()
    skip_msg = (
        f" Skipped {parsed_result.skipped_non_rental} non-rental row(s)."
        if parsed_result.skipped_non_rental
        else ""
    )
    registry_msg = (
        f" Skipped {len(errors)} row(s) not in Company Registry."
        if errors
        else ""
    )
    period_msg = f" Balance as of {period}." if period else ""
    return {
        "created": created,
        "skipped_rows": errors,
        "skipped_non_rental": parsed_result.skipped_non_rental,
        "skipped_registry": len(errors),
        "balance_periods": parsed_result.balance_periods,
        "balance_period_used": period,
        "companies_updated": sorted(companies_in_file),
        "sheets_parsed": sheets_used,
        "message": f"Imported {created} loan(s) for {len(companies_in_file)} registry company(ies).{skip_msg}{registry_msg}{period_msg}",
    }
