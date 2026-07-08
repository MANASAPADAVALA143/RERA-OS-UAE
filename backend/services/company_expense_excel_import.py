"""Parse company × month expense matrix Excel uploads."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models.rentals.models import RentalCompany

_COMPANY_HEADERS = frozenset({
    "company", "company name", "entity", "entity name", "business", "name",
})

_SKIP_ROW = frozenset({
    "company", "company name", "entity", "entity name", "total", "grand total",
    "subtotal", "sum", "sl no", "sl no.", "#",
})

_MONTH_NAMES = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

_MONTH_ABBREV = {v: k.capitalize() for k, v in _MONTH_NAMES.items()}

_MONTH_HEADER_RE = re.compile(
    r"(?i)(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
    r"[\s\-_/]*"
    r"(\d{4})"
)


@dataclass
class ParsedCompanyExpenses:
    company: str
    monthly_totals: dict[str, float] = field(default_factory=dict)
    row_num: int = 0


@dataclass
class ParseCompanyExpenseWorkbookResult:
    companies: list[ParsedCompanyExpenses]
    month_columns: list[str]
    skipped_rows: list[str] = field(default_factory=list)


def _norm_header(cell: Any) -> str:
    return re.sub(r"\s+", " ", str(cell or "").strip().lower())


def _parse_num(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("$", "").replace("₹", "")
    if not s or s in ("-", "—", "n/a", "na", ""):
        return None
    # Indian grouping (e.g. 1,25,000.00) — strip thousands separators
    if re.search(r"\d,\d{2},", s):
        s = s.replace(",", "")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def month_display_key(year: int, month: int) -> str:
    return f"{_MONTH_ABBREV[month]} {year}"


def parse_month_header(header: Any) -> str | None:
    """Return display key 'Mon YYYY' or None."""
    if header is None:
        return None
    if hasattr(header, "year") and hasattr(header, "month"):
        return month_display_key(int(header.year), int(header.month))

    h = str(header).strip()
    if not h:
        return None

    m_iso = re.fullmatch(r"(\d{4})[-/](\d{1,2})", h)
    if m_iso:
        y, mo = int(m_iso.group(1)), int(m_iso.group(2))
        if 1 <= mo <= 12:
            return month_display_key(y, mo)

    m = _MONTH_HEADER_RE.search(h)
    if m:
        mon_token = m.group(1)[:3].lower()
        year = int(m.group(2))
        month = _MONTH_NAMES.get(mon_token)
        if month:
            return month_display_key(year, month)

    for fmt in ("%b %Y", "%B %Y", "%b-%Y", "%B-%Y"):
        try:
            dt = datetime.strptime(h.replace("_", " ").replace("/", " "), fmt)
            return month_display_key(dt.year, dt.month)
        except ValueError:
            continue
    return None


def _valid_company_name(name: str) -> bool:
    s = name.strip()
    if not s or _norm_header(s) in _SKIP_ROW:
        return False
    if re.fullmatch(r"[\d.,$₹]+", s):
        return False
    return True


def _find_header_row(rows: list[tuple]) -> tuple[int, int, dict[str, int]] | None:
    """Return (row_idx, company_col, month_col_map display_key -> col_idx)."""
    for i, row in enumerate(rows[:30]):
        if not row:
            continue
        labels = [_norm_header(c) for c in row]
        company_col: int | None = None
        for idx, h in enumerate(labels):
            if h in _COMPANY_HEADERS or h == "company":
                company_col = idx
                break
        if company_col is None:
            company_col = 0

        month_cols: dict[str, int] = {}
        for idx, cell in enumerate(row):
            if idx == company_col:
                continue
            key = parse_month_header(cell)
            if key:
                month_cols[key] = idx

        if len(month_cols) >= 1:
            return i, company_col, month_cols
    return None


def parse_company_expense_workbook(content: bytes) -> ParseCompanyExpenseWorkbookResult:
    import openpyxl

    wb = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True)
    all_companies: dict[str, ParsedCompanyExpenses] = {}
    month_columns: set[str] = set()
    skipped: list[str] = []

    for sheet in wb.worksheets:
        rows = [tuple(r) for r in sheet.iter_rows(values_only=True)]
        if not rows:
            continue
        found = _find_header_row(rows)
        if not found:
            continue
        header_idx, company_col, month_cols = found
        month_columns.update(month_cols.keys())

        for row_num, row in enumerate(rows[header_idx + 1:], start=header_idx + 2):
            if not row or company_col >= len(row):
                continue
            company = str(row[company_col] or "").strip()
            if not _valid_company_name(company):
                continue

            totals: dict[str, float] = {}
            has_value = False
            for month_key, col_idx in month_cols.items():
                if col_idx >= len(row):
                    continue
                val = _parse_num(row[col_idx])
                if val is not None and val != 0:
                    totals[month_key] = round(abs(val), 2)
                    has_value = True

            if not has_value:
                skipped.append(company)
                continue

            if company in all_companies:
                all_companies[company].monthly_totals.update(totals)
            else:
                all_companies[company] = ParsedCompanyExpenses(
                    company=company, monthly_totals=totals, row_num=row_num,
                )

    sorted_months = sorted(month_columns, key=lambda k: (
        int(k.split()[-1]), _MONTH_NAMES.get(k.split()[0][:3].lower(), 0),
    ))
    return ParseCompanyExpenseWorkbookResult(
        companies=list(all_companies.values()),
        month_columns=sorted_months,
        skipped_rows=skipped,
    )


def _match_company(db: Session, tenant_id, name: str) -> RentalCompany | None:
    key = name.strip().lower()
    return db.query(RentalCompany).filter(
        RentalCompany.tenant_id == tenant_id,
        or_(
            func.trim(func.lower(RentalCompany.company_name)) == key,
            RentalCompany.company_name.ilike(f"%{name.strip()}%"),
        ),
    ).first()


def import_company_expenses_from_excel(
    db: Session,
    tenant_id,
    content: bytes,
    *,
    replace: bool = False,
) -> dict:
    parsed = parse_company_expense_workbook(content)
    if not parsed.companies:
        return {
            "error": "no_rows",
            "message": "No company expense rows found. Expected column A = company name, "
                       "remaining columns = month headers (e.g. Dec 2021, Jan 2022).",
        }

    updated: list[str] = []
    unmatched: list[str] = []

    for row in parsed.companies:
        company = _match_company(db, tenant_id, row.company)
        if not company:
            unmatched.append(row.company)
            continue

        if replace or not company.monthly_expense_data:
            company.monthly_expense_data = dict(row.monthly_totals)
        else:
            merged = dict(company.monthly_expense_data or {})
            merged.update(row.monthly_totals)
            company.monthly_expense_data = merged
        updated.append(company.company_name)

    db.commit()

    portfolio_totals: dict[str, float] = {}
    for row in parsed.companies:
        for m, v in row.monthly_totals.items():
            portfolio_totals[m] = round(portfolio_totals.get(m, 0) + v, 2)

    return {
        "updated_companies": updated,
        "unmatched_companies": unmatched,
        "skipped_empty_rows": parsed.skipped_rows,
        "month_columns": parsed.month_columns,
        "portfolio_monthly_totals": portfolio_totals,
        "companies_parsed": len(parsed.companies),
    }
