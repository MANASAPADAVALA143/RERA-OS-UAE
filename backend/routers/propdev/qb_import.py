"""
POST /api/propdev/import-quickbooks
Accepts 1-4 QuickBooks Excel exports (Balance Sheet, P&L, Loans, Cash Flow).
Auto-detects file type from content / filename.
Upserts company yearly JSON + scalar fields + loan record.
"""
from __future__ import annotations

import datetime
import re
from io import BytesIO
from typing import Any, Optional

import openpyxl
from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session
from sqlalchemy import text

from database import get_db
from middleware.auth import CurrentUser, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.loan import PropDevLoan

router = APIRouter(prefix="/api/propdev", tags=["propdev"])


# ── Low-level helpers ─────────────────────────────────────────────────────────

def _find_year_header(rows: list[tuple]) -> tuple[int, dict[str, int]]:
    """Return (row_index, {year_str: col_index}) for first row with 3+ years."""
    for i, row in enumerate(rows):
        ymap: dict[str, int] = {}
        for j, v in enumerate(row):
            s = str(v or "").strip()
            if s.isdigit() and 2015 <= int(s) <= 2035:
                ymap[s] = j
        if len(ymap) >= 3:
            return i, ymap
    return -1, {}


def _row_vals(row: tuple, ymap: dict[str, int]) -> dict[str, float]:
    """Extract {year: float_value} for a data row."""
    out: dict[str, float] = {}
    for yr, col in ymap.items():
        v = row[col] if col < len(row) else None
        try:
            out[yr] = float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            out[yr] = 0.0
    return out


def _load_rows(content: bytes) -> list[tuple]:
    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    ws = wb.active
    return list(ws.iter_rows(values_only=True))


def _label(row: tuple) -> str:
    return str(row[0] or "").strip()


def _contains(row_label: str, *keywords: str) -> bool:
    ll = row_label.lower()
    return any(k in ll for k in keywords)


# ── File type detection ───────────────────────────────────────────────────────

def detect_qb_type(content: bytes, filename: str) -> str:
    """Return 'bs' | 'pl' | 'loan' | 'cf' | 'unknown'."""
    fn = filename.lower().replace(" ", "_")

    # Filename hints (fast path)
    if any(x in fn for x in ["balance_sheet", "_bs.", "_bs_", "bs.xlsx"]):
        return "bs"
    if any(x in fn for x in ["profit", "p_l.", "p&l", "_pl.", "income_stmt"]):
        return "pl"
    if "loan" in fn:
        return "loan"
    if any(x in fn for x in ["cash_flow", "cashflow", "_cf.", "cf.xlsx"]):
        return "cf"

    # Content scan
    try:
        rows = _load_rows(content)
        snippet = " ".join(str(v or "") for row in rows[:12] for v in row).lower()
        if "balance sheet" in snippet:
            return "bs"
        if "profit and loss" in snippet or "profit & loss" in snippet:
            return "pl"
        if "statement of cash flows" in snippet or "operating activities" in snippet:
            return "cf"
        # Loan table: header row with "loan amount" or "loan bank"
        for row in rows[:5]:
            h = " ".join(str(v or "") for v in row).lower()
            if "loan amount" in h or "loan bank" in h or ("loan" in h and "maturity" in h):
                return "loan"
    except Exception:
        pass
    return "unknown"


# ── Balance Sheet parser ──────────────────────────────────────────────────────

def parse_bs(content: bytes) -> dict[str, Any]:
    rows = _load_rows(content)
    company_name = str(rows[0][0] or "").strip() if rows else ""
    hdr_idx, ymap = _find_year_header(rows)
    if not ymap:
        return {}

    years = sorted(ymap.keys())
    ybs: dict[str, dict] = {yr: {
        "cash": 0.0, "land": 0.0, "improvements": 0.0,
        "interest_capitalised": 0.0, "total_assets": 0.0,
        "loan_balance": 0.0, "total_liabilities": 0.0,
    } for yr in years}

    for row in rows[hdr_idx + 1:]:
        if not row or row[0] is None:
            continue
        lbl = _label(row)
        if not lbl:
            continue
        vals = _row_vals(row, ymap)

        if _contains(lbl, "total for bank accounts", "total checking", "total bank accounts"):
            for yr, v in vals.items():
                if v: ybs[yr]["cash"] = abs(v)

        elif _contains(lbl, "great plains bank") and "loan" not in lbl.lower():
            for yr, v in vals.items():
                if v and not ybs[yr]["cash"]: ybs[yr]["cash"] = abs(v)

        elif lbl.upper() in ("WWBL", "WWBG LAND") or _contains(lbl, "total for land", "total land"):
            for yr, v in vals.items():
                if v: ybs[yr]["land"] = abs(v)

        elif lbl.lower() == "improvements":
            for yr, v in vals.items():
                ybs[yr]["improvements"] = abs(v)

        elif _contains(lbl, "interest capitalised", "capitalized interest", "interest capitalized"):
            for yr, v in vals.items():
                ybs[yr]["interest_capitalised"] = abs(v)

        elif _contains(lbl, "total assets", "total fixed assets") and "total fixed" not in lbl.lower():
            for yr, v in vals.items():
                if v: ybs[yr]["total_assets"] = max(ybs[yr]["total_assets"], abs(v))

        elif _contains(lbl, "greater plains bank", "plains bank loan") and "total" not in lbl.lower():
            for yr, v in vals.items():
                if v: ybs[yr]["loan_balance"] = abs(v)

        elif lbl.lower() in ("loan payable", "notes payable") or _contains(lbl, "total loan payable", "total notes payable"):
            for yr, v in vals.items():
                if v: ybs[yr]["loan_balance"] = abs(v)

        elif _contains(lbl, "total liabilities"):
            for yr, v in vals.items():
                if v: ybs[yr]["total_liabilities"] = abs(v)

    return {"company_name": company_name, "yearly_bs": ybs, "years": years}


# ── P&L parser ───────────────────────────────────────────────────────────────

_PL_CATEGORY_MAP: list[tuple[str, str]] = [
    ("business loan interest", "interest_on_loan"),
    ("interest paid", "interest_on_loan"),
    ("interest expense", "interest_on_loan"),
    ("property tax", "property_tax"),
    ("engineering cost", "hard_cost"),
    ("engineering", "hard_cost"),
    ("land survey", "hard_cost"),
    ("appraisal fee", "soft_cost"),
    ("appraisal", "soft_cost"),
    ("book keeping", "professional_charges"),
    ("bookkeeping", "professional_charges"),
    ("consulting service", "professional_charges"),
    ("professional service", "professional_charges"),
    ("legal & professional", "legal_fees"),
    ("legal and professional", "legal_fees"),
    ("legal fee", "legal_fees"),
    ("escrow", "title_charges"),
    ("title", "title_charges"),
    ("loan processing", "loan_processing"),
    ("management fee", "other_charges"),
    ("bank fee", "other_charges"),
    ("membership", "other_charges"),
    ("insurance", "other_charges"),
]

def _map_expense_category(label: str) -> str:
    ll = label.lower()
    for kw, field in _PL_CATEGORY_MAP:
        if kw in ll:
            return field
    return "other_charges"


def parse_pl(content: bytes) -> dict[str, Any]:
    rows = _load_rows(content)
    company_name = str(rows[0][0] or "").strip() if rows else ""
    hdr_idx, ymap = _find_year_header(rows)
    if not ymap:
        return {}

    years = sorted(ymap.keys())

    # Per-year P&L accumulators
    ypl: dict[str, dict] = {yr: {
        "net_income": 0.0, "total_expenses": 0.0,
        "revenue": 0.0, "other_income": 0.0,
        "expenses_by_category": {},
    } for yr in years}

    # Per-category totals across all years (for scalar company fields)
    all_year_totals: dict[str, float] = {}

    in_expenses = False

    for row in rows[hdr_idx + 1:]:
        if not row or row[0] is None:
            continue
        lbl = _label(row)
        if not lbl:
            continue
        ll = lbl.lower()
        vals = _row_vals(row, ymap)

        # Section markers
        if ll == "expenses":
            in_expenses = True
            continue
        if ll in ("income", "other income", "gross profit", "other expense"):
            in_expenses = False
            continue

        if ll == "net income":
            for yr, v in vals.items():
                ypl[yr]["net_income"] = v
            continue

        if _contains(lbl, "total for expenses", "total expenses"):
            for yr, v in vals.items():
                ypl[yr]["total_expenses"] = abs(v)
            continue

        if _contains(lbl, "other income"):
            for yr, v in vals.items():
                ypl[yr]["other_income"] = abs(v)
            continue

        if in_expenses and not _contains(lbl, "total for", "total expense"):
            cat = _map_expense_category(lbl)
            for yr, v in vals.items():
                v_abs = abs(v)
                if v_abs:
                    ypl[yr]["expenses_by_category"][cat] = (
                        ypl[yr]["expenses_by_category"].get(cat, 0.0) + v_abs
                    )
                    all_year_totals[cat] = all_year_totals.get(cat, 0.0) + v_abs

    return {
        "company_name": company_name,
        "yearly_pl": ypl,
        "all_year_totals": all_year_totals,
        "years": years,
    }


# ── Cash Flow parser ──────────────────────────────────────────────────────────

def parse_cf(content: bytes) -> dict[str, Any]:
    rows = _load_rows(content)
    company_name = str(rows[0][0] or "").strip() if rows else ""
    hdr_idx, ymap = _find_year_header(rows)
    if not ymap:
        return {}

    years = sorted(ymap.keys())
    ycf: dict[str, dict] = {yr: {
        "operating": 0.0, "investing": 0.0,
        "financing": 0.0, "net_change": 0.0,
        "partner_investments": 0.0,
    } for yr in years}

    section = "operating"  # track which CF section we're in

    for row in rows[hdr_idx + 1:]:
        if not row or row[0] is None:
            continue
        lbl = _label(row)
        if not lbl:
            continue
        ll = lbl.lower()
        vals = _row_vals(row, ymap)

        # Section detection
        if _contains(lbl, "operating activities", "net cash from operating",
                     "net cash provided by operating", "net cash used in operating"):
            if "net cash" in ll:
                for yr, v in vals.items():
                    if v: ycf[yr]["operating"] = v
            else:
                section = "operating"
            continue

        if _contains(lbl, "investing activities", "net cash from investing",
                     "net cash provided by investing", "net cash used in investing"):
            if "net cash" in ll:
                for yr, v in vals.items():
                    if v: ycf[yr]["investing"] = v
            else:
                section = "investing"
            continue

        if _contains(lbl, "financing activities", "net cash from financing",
                     "net cash provided by financing", "net cash used in financing"):
            if "net cash" in ll:
                for yr, v in vals.items():
                    if v: ycf[yr]["financing"] = v
            else:
                section = "financing"
            continue

        if _contains(lbl, "net increase", "net decrease", "net change in cash",
                     "net increase (decrease)"):
            for yr, v in vals.items():
                if v: ycf[yr]["net_change"] = v
            continue

        if ll == "net income" and section == "operating":
            for yr, v in vals.items():
                if v and not ycf[yr]["operating"]:
                    ycf[yr]["operating"] = v
            continue

        # Partner/member contributions (financing)
        if _contains(lbl, "partner contribution", "member contribution",
                     "capital contribution", "partner investment"):
            for yr, v in vals.items():
                if abs(v): ycf[yr]["partner_investments"] = abs(v)
            continue

    # Fill missing net_change from operating + investing + financing
    for yr in years:
        cf = ycf[yr]
        if not cf["net_change"] and any([cf["operating"], cf["investing"], cf["financing"]]):
            cf["net_change"] = cf["operating"] + cf["investing"] + cf["financing"]

    return {"company_name": company_name, "yearly_cf": ycf, "years": years}


# ── Loan table parser ─────────────────────────────────────────────────────────

def _clean_num(v: Any) -> float:
    """Parse '$2,336,000' or 0.0425 or '4.25%' → float."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[$,\s]", "", str(v)).strip()
    s = s.rstrip("%")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_date(v: Any) -> Optional[datetime.date]:
    if v is None:
        return None
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.date() if isinstance(v, datetime.datetime) else v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y"):
        try:
            return datetime.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_loans(content: bytes) -> list[dict[str, Any]]:
    rows = _load_rows(content)
    if not rows:
        return []

    # Find header row (contains "Loan" and "Amount" or "Bank")
    hdr_row_idx = 0
    for i, row in enumerate(rows[:10]):
        h = " ".join(str(v or "") for v in row).lower()
        if "loan amount" in h or ("loan" in h and "bank" in h):
            hdr_row_idx = i
            break

    headers = [str(v or "").strip().lower() for v in rows[hdr_row_idx]]

    def col(keywords: list[str]) -> int:
        for kw in keywords:
            for j, h in enumerate(headers):
                if kw in h:
                    return j
        return -1

    c_bank     = col(["loan bank", "bank name", "bank"])
    c_date     = col(["loan date"])
    c_acc      = col(["loan acc", "acc no", "account no"])
    c_amount   = col(["loan amount"])
    c_rate     = col(["interest rate", "loan interest"])
    c_emi      = col(["loan emi", " emi"])
    c_maturity = col(["maturity date", "maturity"])
    c_balance  = col(["loan balance", "balance"])
    c_emi_day  = col(["emi date", "emi day"])

    loans: list[dict] = []
    for row in rows[hdr_row_idx + 1:]:
        if not row or not any(row):
            continue
        # Skip rows that look like header repeats
        if str(row[0] or "").lower() in ("sl no", "sl", "#", ""):
            continue

        def get(c: int) -> Any:
            return row[c] if 0 <= c < len(row) else None

        bank = str(get(c_bank) or "").strip()
        if not bank or bank.lower() in ("bank", "loan bank name"):
            continue

        rate = _clean_num(get(c_rate))
        if rate > 1:  # 4.25 → 0.0425
            rate = rate / 100.0

        emi_day_raw = str(get(c_emi_day) or "15").strip()
        emi_day_clean = re.sub(r"[^0-9]", "", emi_day_raw)
        emi_day = int(emi_day_clean) if emi_day_clean else 15

        loans.append({
            "bank":          bank,
            "loan_date":     _parse_date(get(c_date)),
            "account_no":    str(get(c_acc) or "").strip() or None,
            "loan_amount":   _clean_num(get(c_amount)),
            "balance":       _clean_num(get(c_balance)),
            "interest_rate": rate,
            "emi":           _clean_num(get(c_emi)),
            "maturity_date": _parse_date(get(c_maturity)),
            "emi_day":       emi_day,
        })

    return loans


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/import-quickbooks")
async def import_quickbooks(
    files: list[UploadFile] = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """
    Accept 1-4 QuickBooks export files (BS, P&L, Loans, CF).
    Auto-detect, parse, and upsert into propdev_companies + loans.
    """
    # ── Ensure new columns exist ──────────────────────────────────────────────
    for ddl in [
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS interest_capitalised NUMERIC(16,2) DEFAULT 0 NOT NULL",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS improvements NUMERIC(16,2) DEFAULT 0 NOT NULL",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS yearly_pl JSONB",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS yearly_bs JSONB",
        "ALTER TABLE propdev_companies ADD COLUMN IF NOT EXISTS yearly_cf JSONB",
    ]:
        try:
            db.execute(text(ddl))
            db.commit()
        except Exception:
            db.rollback()

    # ── Parse each uploaded file ──────────────────────────────────────────────
    parsed: dict[str, Any] = {"bs": {}, "pl": {}, "cf": {}, "loan": []}
    file_summary: list[dict] = []

    for uf in files:
        content = await uf.read()
        ftype = detect_qb_type(content, uf.filename or "")

        if ftype == "bs":
            result = parse_bs(content)
            if result:
                parsed["bs"] = result
                years = result.get("years", [])
                accounts_found = sum(
                    1 for k in ("cash", "land", "improvements", "interest_capitalised",
                                "total_assets", "loan_balance", "total_liabilities")
                    for yr in years
                    if result["yearly_bs"].get(yr, {}).get(k, 0)
                )
                file_summary.append({
                    "file": uf.filename,
                    "type": "Balance Sheet",
                    "status": "✅",
                    "detail": f"{len(years)} years parsed ({', '.join(years)}), {accounts_found} account values extracted",
                })
            else:
                file_summary.append({"file": uf.filename, "type": "Balance Sheet", "status": "⚠️", "detail": "Could not find year headers"})

        elif ftype == "pl":
            result = parse_pl(content)
            if result:
                parsed["pl"] = result
                years = result.get("years", [])
                cats = len(result.get("all_year_totals", {}))
                file_summary.append({
                    "file": uf.filename,
                    "type": "P&L",
                    "status": "✅",
                    "detail": f"{len(years)} years parsed, {cats} expense categories found",
                })
            else:
                file_summary.append({"file": uf.filename, "type": "P&L", "status": "⚠️", "detail": "Could not find year headers"})

        elif ftype == "cf":
            result = parse_cf(content)
            if result:
                parsed["cf"] = result
                years = result.get("years", [])
                investing_rows = sum(
                    1 for yr in years
                    if abs(result["yearly_cf"].get(yr, {}).get("investing", 0)) > 0
                )
                file_summary.append({
                    "file": uf.filename,
                    "type": "Cash Flow",
                    "status": "✅",
                    "detail": f"{len(years)} years parsed, {investing_rows} investing activity years found",
                })
            else:
                file_summary.append({"file": uf.filename, "type": "Cash Flow", "status": "⚠️", "detail": "Could not find year headers"})

        elif ftype == "loan":
            loans = parse_loans(content)
            parsed["loan"] = loans
            file_summary.append({
                "file": uf.filename,
                "type": "Loans",
                "status": "✅",
                "detail": f"{len(loans)} loan record{'s' if len(loans) != 1 else ''} imported",
            })

        else:
            file_summary.append({"file": uf.filename, "type": "Unknown", "status": "❓", "detail": "Could not detect file type"})

    # ── Determine company name ────────────────────────────────────────────────
    company_name = (
        parsed.get("bs", {}).get("company_name")
        or parsed.get("pl", {}).get("company_name")
        or parsed.get("cf", {}).get("company_name")
        or "Imported Company"
    )
    # Clean up QuickBooks company name (may include "LLC" etc.)
    raw_name = company_name.strip()

    # ── Upsert company ────────────────────────────────────────────────────────
    company = db.query(PropDevCompany).filter(
        PropDevCompany.tenant_id == current_user.tenant_id,
        PropDevCompany.name.ilike(f"%{raw_name[:6]}%"),
    ).first()

    if not company:
        company = PropDevCompany(
            tenant_id=current_user.tenant_id,
            name=raw_name,
            property_name=raw_name,
            total_lots=1,
            sale_consideration=0.0,
            land_cost=0.0, hard_cost=0.0, soft_cost=0.0,
            title_charges=0.0, other_charges=0.0, property_tax=0.0,
            loan_processing=0.0, professional_charges=0.0,
            legal_fees=0.0, interest_on_loan=0.0, cash_available=0.0,
        )
        db.add(company)
        db.flush()

    # Apply BS data
    bs_data = parsed.get("bs", {})
    if bs_data:
        ybs = bs_data.get("yearly_bs", {})
        company.yearly_bs = ybs
        # Use latest available year for scalars
        latest_yr = max(ybs.keys()) if ybs else None
        if latest_yr:
            ly = ybs[latest_yr]
            company.land_cost           = ly.get("land", company.land_cost)
            company.improvements        = ly.get("improvements", 0.0)
            company.interest_capitalised = ly.get("interest_capitalised", 0.0)
            company.cash_available      = ly.get("cash", company.cash_available)

    # Apply P&L data
    pl_data = parsed.get("pl", {})
    if pl_data:
        ypl = pl_data.get("yearly_pl", {})
        company.yearly_pl = ypl
        totals = pl_data.get("all_year_totals", {})
        if totals:
            company.interest_on_loan     = totals.get("interest_on_loan", company.interest_on_loan)
            company.property_tax         = totals.get("property_tax", company.property_tax)
            company.hard_cost            = totals.get("hard_cost", company.hard_cost)
            company.soft_cost            = totals.get("soft_cost", company.soft_cost)
            company.professional_charges = totals.get("professional_charges", company.professional_charges)
            company.legal_fees           = totals.get("legal_fees", company.legal_fees)
            company.title_charges        = totals.get("title_charges", company.title_charges)
            company.loan_processing      = totals.get("loan_processing", company.loan_processing)
            company.other_charges        = totals.get("other_charges", company.other_charges)

    # Apply CF data
    cf_data = parsed.get("cf", {})
    if cf_data:
        company.yearly_cf = cf_data.get("yearly_cf", {})

    db.flush()
    cid = company.id

    # Apply Loan data
    loan_records = parsed.get("loan", [])
    if loan_records:
        for ln in company.loans:
            db.delete(ln)
        db.flush()
        for lr in loan_records:
            db.add(PropDevLoan(
                tenant_id     = current_user.tenant_id,
                company_id    = cid,
                bank          = lr["bank"],
                loan_date     = lr.get("loan_date"),
                account_no    = lr.get("account_no"),
                loan_amount   = lr.get("loan_amount", 0.0),
                balance       = lr.get("balance", 0.0),
                interest_rate = lr.get("interest_rate", 0.0),
                emi           = lr.get("emi", 0.0),
                maturity_date = lr.get("maturity_date"),
                emi_day       = lr.get("emi_day", 15),
                lender_name   = lr["bank"],
                emi_status    = "Current",
            ))

    db.commit()

    # ── Build KPI summary for response ───────────────────────────────────────
    kpis: dict[str, Any] = {}
    if bs_data:
        ybs = bs_data.get("yearly_bs", {})
        if ybs:
            latest = ybs.get(max(ybs.keys()), {})
            kpis["land"]             = latest.get("land", 0)
            kpis["cash"]             = latest.get("cash", 0)
            kpis["loan_balance"]     = latest.get("loan_balance", 0)
            kpis["total_assets"]     = latest.get("total_assets", 0)
            kpis["improvements"]     = latest.get("improvements", 0)
            kpis["interest_capitalised"] = latest.get("interest_capitalised", 0)
            if kpis["land"] and kpis["loan_balance"]:
                kpis["ltv_pct"] = round(kpis["loan_balance"] / kpis["land"] * 100, 1)

    return {
        "status": "success",
        "company": raw_name,
        "company_id": str(cid),
        "files_processed": file_summary,
        "kpis": kpis,
    }
