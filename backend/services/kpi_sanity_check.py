"""KPI sanity check — recompute from raw P&L/BS and compare to live UI display logic."""
from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from models.rentals.models import RentalCompany, RentalFinancialUpload
from services.kpi_audit_types import CompanyAuditResult, KpiCheckRow, Status
from services.rental_kpi_engine import (
    KpiData,
    fin_upload_to_dict,
    get_available_keys,
    resolve_kpi_view,
    resolve_kpi_view_for_period,
)

DEFAULT_TOLERANCE_PCT = 0.5


def _fmt_currency(n: float) -> str:
    if not n:
        return "$0"
    abs_n = abs(n)
    if abs_n >= 1_000_000:
        s = f"${abs_n / 1_000_000:.2f}M"
    elif abs_n >= 1_000:
        s = f"${abs_n / 1_000:.1f}K"
    else:
        s = f"${abs_n:,.0f}"
    return f"({s})" if n < 0 else s


def _fmt_pct(n: float | None, d: int = 1) -> str:
    if n is None:
        return "N/A"
    return f"{n:.{d}f}%"


def _fmt_x(n: float | None, d: int = 2) -> str:
    if n is None:
        return "N/A"
    return f"{n:.{d}f}x"


def _debt_to_equity(total_debt: float | None, k: KpiData) -> float | None:
    """Interest-bearing debt / Equity from Loan Tracker; N/A when no loan data or equity = 0."""
    if total_debt is None:
        return None
    if k.equity == 0:
        return None
    return total_debt / k.equity


def _debt_to_asset(total_debt: float | None, k: KpiData) -> float | None:
    """Total Debt / Total Assets × 100 from Loan Tracker; N/A when no loan data."""
    if total_debt is None:
        return None
    if k.total_assets <= 0:
        return None
    return (total_debt / k.total_assets) * 100


def _pct(num: float, den: float) -> float | None:
    return (num / den) * 100 if den > 0 else None


def _diff(a: float | None, b: float | None) -> tuple[float | None, float | None]:
    if a is None or b is None:
        return None, None
    d = abs(a - b)
    base = max(abs(a), abs(b), 1e-9)
    return d, (d / base) * 100


def _status_compare(
    canonical: float | None,
    displayed: float | None,
    *,
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
    exact: bool = False,
    check_logic: bool = False,
) -> Status:
    if check_logic:
        return "CHECK_LOGIC"
    if canonical is None and displayed is None:
        return "MATCH"
    if canonical is None or displayed is None:
        return "MISMATCH"
    if exact:
        return "MATCH" if abs(canonical - displayed) < 0.01 else "MISMATCH"
    _, pct = _diff(canonical, displayed)
    if pct is None:
        return "MISMATCH"
    return "MATCH" if pct <= tolerance_pct else "MISMATCH"


def _raw_inputs(k: KpiData, k_prev: KpiData | None, total_debt: float | None = None) -> dict[str, Any]:
    raw = {
        "Total Revenue": _fmt_currency(k.total_revenue),
        "Total Expenses": _fmt_currency(k.total_expenses),
        "Net Income": _fmt_currency(k.net_income),
        "NOI": _fmt_currency(k.noi),
        "NOI formula": "Total Revenue − Total Expenses + Interest Paid (interest add-back)",
        "Interest Paid": _fmt_currency(k.interest_expense),
        "Depreciation": _fmt_currency(k.depreciation),
        "Rental Income": _fmt_currency(k.rental_income),
        "Management Fee": _fmt_currency(k.management_fee),
        "Repairs": _fmt_currency(k.repairs),
        "Buildings / Property Value": _fmt_currency(k.buildings) if k.buildings > 0 else "missing",
        "Long-term Loans": _fmt_currency(k.long_term_loans),
        "Total Assets": _fmt_currency(k.total_assets),
        "Total Liabilities": _fmt_currency(k.total_liabilities),
        "Equity": _fmt_currency(k.equity),
        "Cash": _fmt_currency(k.cash),
        "Prior Period Revenue": _fmt_currency(k_prev.total_revenue) if k_prev else "N/A",
    }
    if total_debt is not None:
        raw["Total Debt (Loan Tracker)"] = _fmt_currency(total_debt)
    else:
        raw["Total Debt (Loan Tracker)"] = "N/A — no loan data"
    return raw


FIELD_SOURCES: dict[str, str] = {
    "Total Revenue": "r_financial_uploads.pl_data → 'Total for Income' row",
    "Total Expenses": "r_financial_uploads.pl_data → 'Total for Expenses' row",
    "Net Income": "r_financial_uploads.pl_data → 'Net Income' row",
    "Interest Paid": "r_financial_uploads.pl_data → 'Total for Interest Paid' / interest lines",
    "Depreciation": "r_financial_uploads.pl_data → depreciation expense lines",
    "Rental Income": "r_financial_uploads.pl_data → rental / services income lines",
    "Management Fee": "r_financial_uploads.pl_data → management fee lines",
    "Repairs": "r_financial_uploads.pl_data → repairs / maintenance lines",
    "Buildings / Property Value": "r_financial_uploads.bs_data → Buildings / Property & Equipment row",
    "Long-term Loans": "r_financial_uploads.bs_data → 'Total for Long-term Liabilities' row",
    "Total Debt (Loan Tracker)": "loans table → Σ loan_balance_as_of (Loan Tracker portfolio total)",
    "Total Assets": "r_financial_uploads.bs_data → 'Total for Assets' row",
    "Total Liabilities": "r_financial_uploads.bs_data → 'Total for Liabilities' row",
    "Equity": "r_financial_uploads.bs_data → 'Total for Equity' row",
    "Cash": "r_financial_uploads.bs_data → 'Total for Bank Accounts' / cash lines",
    "Prior Period Revenue": "r_financial_uploads.pl_data → prior period 'Total for Income'",
    "NOI": "derived: Total Revenue − Total Expenses + Interest Paid",
}


def _kpi_field_keys(name: str) -> list[str]:
    mapping: dict[str, list[str]] = {
        "NOI Margin": ["Total Revenue", "Total Expenses", "Interest Paid", "NOI"],
        "Net Income Margin": ["Total Revenue", "Net Income"],
        "Revenue Growth YoY": ["Total Revenue", "Prior Period Revenue"],
        "Expense Ratio": ["Total Expenses", "Total Revenue"],
        "Rental Income %": ["Rental Income", "Total Revenue"],
        "Interest Coverage": ["NOI", "Interest Paid"],
        "Mgmt Fee %": ["Management Fee", "Total Revenue"],
        "Repair % of Revenue": ["Repairs", "Total Revenue"],
        "LTV": ["Long-term Loans", "Buildings / Property Value"],
        "Asset/Liability Ratio": ["Total Assets", "Total Liabilities"],
        "Debt-to-Equity": ["Total Debt (Loan Tracker)", "Equity"],
        "Cash Balance": ["Cash"],
        "Debt-to-Asset": ["Total Debt (Loan Tracker)", "Total Assets"],
        "Equity Ratio": ["Equity", "Total Assets"],
        "DSCR (Est.)": ["NOI", "Interest Paid"],
        "EBITDA Margin": ["NOI", "Total Revenue"],
        "ROA": ["Net Income", "Total Assets"],
        "ROE": ["Net Income", "Equity"],
        "Cap Rate": ["NOI", "Buildings / Property Value"],
    }
    return mapping.get(name, [])


def _kpi_inputs_detail(name: str, raw: dict[str, Any]) -> dict[str, Any]:
    return {key: raw[key] for key in _kpi_field_keys(name) if key in raw}


def _kpi_sources(name: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for key in _kpi_field_keys(name):
        src = FIELD_SOURCES.get(key, "derived from uploaded financials")
        rows.append({"field": key, "source": src})
    return rows


def _substitution_steps(
    name: str, k: KpiData, k_prev: KpiData | None, c_val: float | None,
    *, total_debt: float | None = None,
) -> str:
    rev = _fmt_currency(k.total_revenue)
    exp = _fmt_currency(k.total_expenses)
    intr = _fmt_currency(k.interest_expense)
    noi = _fmt_currency(k.noi)
    ni = _fmt_currency(k.net_income)

    if name == "NOI Margin":
        return (
            f"Step 1 — NOI = Total Revenue − Total Expenses + Interest Paid\n"
            f"         = {rev} − {exp} + {intr} = {noi}\n"
            f"Step 2 — NOI Margin = NOI / Total Revenue × 100\n"
            f"         = {noi} / {rev} × 100 = {_fmt_pct(c_val)}"
        )
    if name == "Net Income Margin":
        return f"Net Income Margin = Net Income / Total Revenue × 100\n= {ni} / {rev} × 100 = {_fmt_pct(c_val)}"
    if name == "Revenue Growth YoY":
        if not k_prev or k_prev.total_revenue <= 0:
            return "Revenue Growth YoY = N/A (no prior period revenue)"
        prev = _fmt_currency(k_prev.total_revenue)
        curr = _fmt_currency(k.total_revenue)
        return (
            f"Revenue Growth YoY = (Current − Prior) / Prior × 100\n"
            f"= ({curr} − {prev}) / {prev} × 100 = {_fmt_pct(c_val)}"
        )
    if name == "Expense Ratio":
        return f"Expense Ratio = Total Expenses / Total Revenue × 100\n= {exp} / {rev} × 100 = {_fmt_pct(c_val)}"
    if name == "Rental Income %":
        rent = _fmt_currency(k.rental_income)
        return f"Rental Income % = Rental Income / Total Revenue × 100\n= {rent} / {rev} × 100 = {_fmt_pct(c_val)}"
    if name == "Interest Coverage":
        if k.interest_expense <= 0:
            return f"Interest Coverage = N/A because Interest Paid = {intr} (denominator is zero)"
        return f"Interest Coverage = NOI / Interest Paid\n= {noi} / {intr} = {_fmt_x(c_val)}"
    if name == "Mgmt Fee %":
        mgmt = _fmt_currency(k.management_fee)
        return f"Mgmt Fee % = Management Fee / Total Revenue × 100\n= {mgmt} / {rev} × 100 = {_fmt_pct(c_val)}"
    if name == "Repair % of Revenue":
        rep = _fmt_currency(k.repairs)
        return f"Repair % of Revenue = Repairs / Total Revenue × 100\n= {rep} / {rev} × 100 = {_fmt_pct(c_val)}"
    if name == "LTV":
        bldg = _fmt_currency(k.buildings) if k.buildings > 0 else "missing"
        loans = _fmt_currency(k.long_term_loans)
        if k.buildings <= 0:
            return f"LTV = N/A because Buildings / Property Value is missing (loans = {loans})"
        return f"LTV = Long-term Loans / Buildings × 100\n= {loans} / {bldg} × 100 = {_fmt_pct(c_val)}"
    if name == "Asset/Liability Ratio":
        assets = _fmt_currency(k.total_assets)
        liab = _fmt_currency(k.total_liabilities)
        return f"Asset/Liability Ratio = Total Assets / Total Liabilities\n= {assets} / {liab} = {_fmt_x(c_val)}"
    if name == "Debt-to-Equity":
        debt = _fmt_currency(total_debt) if total_debt is not None else "N/A — no loan data"
        eq = _fmt_currency(k.equity)
        if total_debt is None:
            return (
                "Debt-to-Equity = Total Debt (Loan Tracker) / Equity\n"
                f"Total Debt = {debt} — ratio is N/A (do not fall back to Total Liabilities)"
            )
        if k.equity == 0:
            return f"Debt-to-Equity = N/A because Equity = $0\nTotal Debt = {debt}"
        if k.equity < 0:
            return (
                f"Debt-to-Equity = Total Debt / Equity\n"
                f"= {debt} / {eq} = {_fmt_x(c_val, 1)}\n"
                f"(negative equity — ratio is negative; balance sheet is underwater)"
            )
        return f"Debt-to-Equity = Total Debt / Equity\n= {debt} / {eq} = {_fmt_x(c_val, 1)}"
    if name == "Cash Balance":
        return f"Cash Balance = sum of bank / cash accounts on balance sheet\n= {_fmt_currency(k.cash)}"
    if name == "Debt-to-Asset":
        debt = _fmt_currency(total_debt) if total_debt is not None else "N/A — no loan data"
        assets = _fmt_currency(k.total_assets)
        if total_debt is None:
            return (
                "Debt-to-Asset = Total Debt / Total Assets × 100\n"
                f"Total Debt = {debt} — ratio is N/A (do not fall back to Total Liabilities)"
            )
        return f"Debt-to-Asset = Total Debt / Total Assets × 100\n= {debt} / {assets} × 100 = {_fmt_pct(c_val)}"
    if name == "Equity Ratio":
        eq = _fmt_currency(k.equity)
        assets = _fmt_currency(k.total_assets)
        return f"Equity Ratio = Equity / Total Assets × 100\n= {eq} / {assets} × 100 = {_fmt_pct(c_val)}"
    if name == "DSCR (Est.)":
        if k.interest_expense <= 0:
            return f"DSCR (Est.) = N/A because Interest Paid = {intr}"
        debt_svc = _fmt_currency(k.interest_expense * 1.2)
        return f"DSCR (Est.) = NOI / (Interest Paid × 1.2)\n= {noi} / {debt_svc} = {_fmt_x(c_val)}"
    if name == "EBITDA Margin":
        return (
            "EBITDA ≡ NOI in this system (depreciation is below the NOI line and excluded)\n"
            f"EBITDA Margin = NOI / Total Revenue × 100 = {noi} / {rev} × 100 = {_fmt_pct(c_val)}"
        )
    if name == "ROA":
        assets = _fmt_currency(k.total_assets)
        return f"ROA = Net Income / Total Assets × 100\n= {ni} / {assets} × 100 = {_fmt_pct(c_val)}"
    if name == "ROE":
        eq = _fmt_currency(k.equity)
        return f"ROE = Net Income / Equity × 100\n= {ni} / {eq} × 100 = {_fmt_pct(c_val)}"
    if name == "Cap Rate":
        bldg = _fmt_currency(k.buildings) if k.buildings > 0 else "missing"
        if k.buildings <= 0:
            return f"Cap Rate = N/A because Buildings / Property Value is missing (NOI = {noi})"
        return f"Cap Rate = NOI / Buildings × 100\n= {noi} / {bldg} × 100 = {_fmt_pct(c_val)}"
    return ""


def _canonical_metrics(k: KpiData, k_prev: KpiData | None, *, total_debt: float | None = None) -> dict[str, float | None]:
    rev_g = None
    if k_prev and k_prev.total_revenue > 0:
        rev_g = ((k.total_revenue - k_prev.total_revenue) / k_prev.total_revenue) * 100
    return {
        "NOI Margin": _pct(k.noi, k.total_revenue),
        "Net Income Margin": _pct(k.net_income, k.total_revenue),
        "Revenue Growth YoY": rev_g,
        "Expense Ratio": _pct(k.total_expenses, k.total_revenue),
        "Rental Income %": _pct(k.rental_income, k.total_revenue),
        "Interest Coverage": (k.noi / k.interest_expense) if k.interest_expense > 0 else None,
        "Mgmt Fee %": _pct(k.management_fee, k.total_revenue),
        "Repair % of Revenue": _pct(k.repairs, k.total_revenue),
        "LTV": (k.long_term_loans / k.buildings) * 100 if k.buildings > 0 else None,
        "Asset/Liability Ratio": (k.total_assets / k.total_liabilities) if k.total_liabilities > 0 else None,
        "Debt-to-Equity": _debt_to_equity(total_debt, k),
        "Cash Balance": k.cash,
        "Debt-to-Asset": _debt_to_asset(total_debt, k),
        "Equity Ratio": (k.equity / k.total_assets) * 100 if k.total_assets > 0 else None,
        "DSCR (Est.)": (k.noi / (k.interest_expense * 1.2)) if k.interest_expense > 0 else None,
        "EBITDA Margin": _pct(k.noi, k.total_revenue),
        "ROA": _pct(k.net_income, k.total_assets),
        "ROE": _pct(k.net_income, k.equity),
        "Cap Rate": _pct(k.noi, k.buildings),
    }


def _displayed_metrics_kpi_tab(
    k: KpiData, k_prev: KpiData | None, *, total_debt: float | None = None,
) -> dict[str, float | None]:
    """Simulates RentalFinancials.tsx KPITab — known divergences from canonical engine."""
    rev_g = None
    if k_prev and k_prev.total_revenue > 0:
        rev_g = ((k.total_revenue - k_prev.total_revenue) / k_prev.total_revenue) * 100
    return {
        "NOI Margin": (k.noi / k.total_revenue * 100) if k.total_revenue > 0 else 0.0,
        "Net Income Margin": (k.net_income / k.total_revenue * 100) if k.total_revenue > 0 else 0.0,
        "Revenue Growth YoY": rev_g if rev_g is not None else 0.0,
        "Expense Ratio": (k.total_expenses / k.total_revenue * 100) if k.total_revenue > 0 else 0.0,
        "Rental Income %": (k.rental_income / k.total_revenue * 100) if k.total_revenue > 0 else 0.0,
        # BUG: shows 0.00x when interest=0 instead of N/A
        "Interest Coverage": (k.noi / k.interest_expense) if k.interest_expense > 0 else 0.0,
        "Mgmt Fee %": (k.management_fee / k.total_revenue * 100) if k.total_revenue > 0 else 0.0,
        "Repair % of Revenue": (k.repairs / k.total_revenue * 100) if k.total_revenue > 0 else 0.0,
        "LTV": (k.long_term_loans / k.buildings * 100) if k.buildings > 0 else 0.0,
        "Asset/Liability Ratio": (k.total_assets / k.total_liabilities) if k.total_liabilities > 0 else 0.0,
        "Debt-to-Equity": _debt_to_equity(total_debt, k),
        "Cash Balance": k.cash,
        "Debt-to-Asset": _debt_to_asset(total_debt, k),
        "Equity Ratio": (k.equity / k.total_assets * 100) if k.total_assets > 0 else 0.0,
        "DSCR (Est.)": (k.noi / (k.interest_expense * 1.2)) if k.interest_expense > 0 else 0.0,
        "EBITDA Margin": _pct(k.noi, k.total_revenue),
        "ROA": _pct(k.net_income, k.total_assets),
        "ROE": _pct(k.net_income, k.equity),
        "Cap Rate": _pct(k.noi, k.buildings),
    }


KPI_META: list[dict[str, Any]] = [
    {"kpi": "NOI Margin", "section": "Profitability",
     "formula": "NOI / Total Revenue × 100; NOI = Total Revenue − Total Expenses + Interest Paid"},
    {"kpi": "Net Income Margin", "section": "Profitability", "formula": "Net Income / Total Revenue × 100"},
    {"kpi": "Revenue Growth YoY", "section": "Profitability",
     "formula": "(Current Revenue − Prior Revenue) / Prior Revenue × 100"},
    {"kpi": "Expense Ratio", "section": "Profitability", "formula": "Total Expenses / Total Revenue × 100"},
    {"kpi": "Rental Income %", "section": "Rental Performance", "formula": "Rental Income / Total Revenue × 100"},
    {"kpi": "Interest Coverage", "section": "Rental Performance",
     "formula": "NOI / Interest Paid — N/A when Interest Paid = $0"},
    {"kpi": "Mgmt Fee %", "section": "Rental Performance", "formula": "Management Fee / Total Revenue × 100"},
    {"kpi": "Repair % of Revenue", "section": "Rental Performance", "formula": "Repairs / Total Revenue × 100"},
    {"kpi": "LTV", "section": "Balance Sheet",
     "formula": "Long-term Loans / Buildings × 100 — N/A when building value missing"},
    {"kpi": "Asset/Liability Ratio", "section": "Balance Sheet", "formula": "Total Assets / Total Liabilities"},
    {"kpi": "Debt-to-Equity", "section": "Balance Sheet",
     "formula": "Total Debt (Loan Tracker) / Equity — N/A when no loan data or Equity = $0"},
    {"kpi": "Cash Balance", "section": "Balance Sheet", "formula": "Sum of bank account balances (BS)", "exact": True},
    {"kpi": "Debt-to-Asset", "section": "Balance Sheet",
     "formula": "Total Debt (Loan Tracker) / Total Assets × 100 — N/A when no loan data"},
    {"kpi": "Equity Ratio", "section": "Balance Sheet", "formula": "Equity / Total Assets × 100"},
    {"kpi": "DSCR (Est.)", "section": "Financial Ratios",
     "formula": "NOI / (Interest Paid × 1.2) — N/A when interest = $0"},
    {"kpi": "EBITDA Margin", "section": "Financial Ratios",
     "formula": "NOI / Total Revenue × 100 (EBITDA ≡ NOI — no depreciation add-back)"},
    {"kpi": "ROA", "section": "Financial Ratios", "formula": "Net Income / Total Assets × 100"},
    {"kpi": "ROE", "section": "Financial Ratios", "formula": "Net Income / Equity × 100"},
    {"kpi": "Cap Rate", "section": "Financial Ratios", "formula": "NOI / Buildings × 100"},
]


def _format_kpi_value(name: str, value: float | None) -> str:
    if value is None:
        return "N/A"
    if name == "Cash Balance":
        return _fmt_currency(value)
    if name in ("Interest Coverage", "Asset/Liability Ratio", "Debt-to-Equity", "DSCR (Est.)"):
        return _fmt_x(value, 2 if name != "Debt-to-Equity" else 1)
    return _fmt_pct(value)


def _load_company_total_debt(
    db: Session,
    tenant_id,
    company_name: str,
    *,
    month: int,
    year: int,
) -> float | None:
    """Σ loan_balance_as_of — same source as Loan Tracker 'Total Loan Portfolio'."""
    from services.loan_tracker_kpi_audit import compute_loan_tracker_kpis, load_registry_rental_loan_dicts

    balance_period = f"{year}-{month:02d}"
    loans = load_registry_rental_loan_dicts(
        db, tenant_id, balance_period=balance_period, company_names={company_name},
    )
    if not loans:
        return None
    return compute_loan_tracker_kpis(loans)["total_outstanding"]


def _append_ebitda_noi_cross_check(
    rows: list[KpiCheckRow],
    canonical: dict[str, float | None],
    displayed: dict[str, float | None],
    k: KpiData,
) -> None:
    """Flag CHECK_LOGIC if EBITDA Margin ever diverges from NOI Margin."""
    noi_m = canonical.get("NOI Margin")
    ebitda_m = canonical.get("EBITDA Margin")
    d_noi = displayed.get("NOI Margin")
    d_ebitda = displayed.get("EBITDA Margin")

    def _aligned(a: float | None, b: float | None) -> bool:
        if a is None and b is None:
            return True
        if a is None or b is None:
            return False
        return abs(a - b) < 0.01

    canonical_ok = _aligned(noi_m, ebitda_m)
    displayed_ok = _aligned(d_noi, d_ebitda)
    status: Status = "MATCH" if canonical_ok and displayed_ok else "CHECK_LOGIC"
    notes = ""
    if not canonical_ok:
        notes = (
            f"Canonical NOI Margin ({_fmt_pct(noi_m)}) ≠ EBITDA Margin ({_fmt_pct(ebitda_m)}) — "
            "EBITDA should equal NOI in this system"
        )
    elif not displayed_ok:
        notes = (
            f"Displayed NOI Margin ({_fmt_pct(d_noi)}) ≠ EBITDA Margin ({_fmt_pct(d_ebitda)})"
        )

    rows.append(KpiCheckRow(
        kpi="EBITDA = NOI Margin (cross-check)",
        section="Financial Ratios",
        formula="EBITDA Margin must equal NOI Margin (EBITDA ≡ NOI; no depreciation add-back)",
        raw_inputs={
            "NOI Margin": _fmt_pct(noi_m),
            "EBITDA Margin": _fmt_pct(ebitda_m),
            "NOI": _fmt_currency(k.noi),
            "Total Revenue": _fmt_currency(k.total_revenue),
        },
        inputs_detail={
            "NOI Margin": _fmt_pct(noi_m),
            "EBITDA Margin": _fmt_pct(ebitda_m),
        },
        substitution=(
            f"NOI Margin = {_fmt_pct(noi_m)}\n"
            f"EBITDA Margin = {_fmt_pct(ebitda_m)}\n"
            "These must match because depreciation is excluded from NOI and must not be added back."
        ),
        sources=[
            {"field": "NOI Margin", "source": "derived: NOI / Total Revenue"},
            {"field": "EBITDA Margin", "source": "derived: NOI / Total Revenue (same as NOI Margin)"},
        ],
        canonical_value=noi_m,
        canonical_display=_fmt_pct(noi_m),
        displayed_value=d_ebitda,
        displayed_display=_fmt_pct(d_ebitda),
        difference=abs(noi_m - ebitda_m) if noi_m is not None and ebitda_m is not None else None,
        difference_pct=0.0 if canonical_ok else 100.0,
        status=status,
        notes=notes,
    ))


def audit_company_financials(
    fin: dict,
    *,
    company_id: str,
    company_name: str,
    period: str | None = None,
    month: int = 6,
    year: int = 2026,
    total_debt: float | None = None,
) -> CompanyAuditResult:
    available = get_available_keys(fin)
    pl = fin.get("pl") or []
    if not pl and not (fin.get("years") or []):
        return CompanyAuditResult(
            company_id=company_id,
            company_name=company_name,
            period_label="—",
            has_data=False,
            summary_status="INSUFFICIENT_DATA",
        )

    if period:
        k, k_prev, label = resolve_kpi_view_for_period(fin, period, month, year)
    else:
        k, k_prev, label = resolve_kpi_view(fin, year, month if available else None)

    canonical = _canonical_metrics(k, k_prev, total_debt=total_debt)
    displayed = _displayed_metrics_kpi_tab(k, k_prev, total_debt=total_debt)
    raw = _raw_inputs(k, k_prev, total_debt)
    rows: list[KpiCheckRow] = []

    for meta in KPI_META:
        name = meta["kpi"]
        c_val = canonical.get(name)
        d_val = displayed.get(name)
        exact = meta.get("exact", False)

        check_logic = False
        notes = ""
        if name == "Interest Coverage" and k.interest_expense <= 0:
            if d_val == 0.0 and c_val is None:
                check_logic = True
                notes = "Live KPI card shows 0.00x but canonical engine shows N/A when Interest Paid = $0"
        if name == "LTV" and k.buildings <= 0:
            if d_val == 0.0 and c_val is None:
                check_logic = True
                notes = "LTV should be 'Not available' when building value is missing, not 0%"
        if name == "DSCR (Est.)" and k.interest_expense <= 0:
            if d_val == 0.0 and c_val is None:
                check_logic = True
                notes = "DSCR should be N/A when interest = $0"
        if name == "Revenue Growth YoY" and k_prev is None:
            if d_val == 0.0 and c_val is None:
                check_logic = True
                notes = "Revenue Growth should be N/A when no prior period exists"
        if name == "Debt-to-Equity" and total_debt is None:
            if d_val not in (None, 0.0) and c_val is None:
                check_logic = True
                notes = "Debt-to-Equity should be N/A when Loan Tracker has no loan data (not Total Liabilities)"
        if name == "Debt-to-Asset" and total_debt is None:
            if d_val not in (None, 0.0) and c_val is None:
                check_logic = True
                notes = "Debt-to-Asset should be N/A when Loan Tracker has no loan data"
        if name == "Debt-to-Equity" and k.equity < 0 and c_val is not None:
            check_logic = True
            notes = (
                f"Negative equity ({_fmt_currency(k.equity)}) — D/E is {_fmt_x(c_val, 1)}; "
                "review distressed balance sheet"
            )

        diff_abs, diff_pct = _diff(c_val, d_val)
        status = _status_compare(
            c_val, d_val, tolerance_pct=DEFAULT_TOLERANCE_PCT, exact=exact, check_logic=check_logic,
        )

        rows.append(KpiCheckRow(
            kpi=name,
            section=meta["section"],
            formula=meta["formula"],
            raw_inputs=raw,
            inputs_detail=_kpi_inputs_detail(name, raw),
            substitution=_substitution_steps(name, k, k_prev, c_val, total_debt=total_debt),
            sources=_kpi_sources(name),
            canonical_value=c_val,
            canonical_display=_format_kpi_value(name, c_val),
            displayed_value=d_val,
            displayed_display=_format_kpi_value(name, d_val if not (check_logic and d_val == 0) else d_val),
            difference=diff_abs,
            difference_pct=diff_pct,
            status=status,
            notes=notes,
        ))

    _append_ebitda_noi_cross_check(rows, canonical, displayed, k)

    mismatch_count = sum(1 for r in rows if r.status == "MISMATCH")
    check_logic_count = sum(1 for r in rows if r.status == "CHECK_LOGIC")
    if mismatch_count:
        summary = "MISMATCH"
    elif check_logic_count:
        summary = "CHECK_LOGIC"
    else:
        summary = "MATCH"

    return CompanyAuditResult(
        company_id=company_id,
        company_name=company_name,
        period_label=label,
        has_data=True,
        summary_status=summary,
        rows=rows,
        mismatch_count=mismatch_count,
        check_logic_count=check_logic_count,
    )


def _merge_audit_rows(financial: CompanyAuditResult, ops_rows: list[KpiCheckRow]) -> CompanyAuditResult:
    """Append Rental Overview + AR Dashboard rows; widen has_data when ops exist."""
    if not ops_rows:
        return financial
    all_rows = financial.rows + ops_rows
    mismatch_count = sum(1 for r in all_rows if r.status == "MISMATCH")
    check_logic_count = sum(1 for r in all_rows if r.status == "CHECK_LOGIC")
    has_data = financial.has_data or any(
        r.status != "INSUFFICIENT_DATA" for r in ops_rows
    )
    if mismatch_count:
        summary = "MISMATCH"
    elif check_logic_count:
        summary = "CHECK_LOGIC"
    elif not has_data:
        summary = "INSUFFICIENT_DATA"
    else:
        summary = "MATCH"
    return CompanyAuditResult(
        company_id=financial.company_id,
        company_name=financial.company_name,
        period_label=financial.period_label,
        has_data=has_data,
        summary_status=summary,
        rows=all_rows,
        mismatch_count=mismatch_count,
        check_logic_count=check_logic_count,
    )


def _loan_tracker_imports():
    from services.loan_tracker_kpi_audit import (
        audit_company_loan_tracker,
        audit_portfolio_loan_tracker,
    )
    return audit_company_loan_tracker, audit_portfolio_loan_tracker


def _rental_ops_imports():
    from services.rental_ops_kpi_audit import (
        audit_company_rental_ops,
        audit_portfolio_rental_ops,
        load_qb_aging_by_company,
        load_qb_portfolio_totals,
    )
    return (
        audit_company_rental_ops,
        audit_portfolio_rental_ops,
        load_qb_aging_by_company,
        load_qb_portfolio_totals,
    )


def _cfo_dashboard_imports():
    from services.cfo_dashboard_kpi_audit import audit_company_cfo_dashboard
    return audit_company_cfo_dashboard


def run_tenant_audit(
    db: Session,
    tenant_id,
    *,
    period: str | None = None,
    month: int = 6,
    year: int = 2026,
    company_id: str | None = None,
    triggered_by: str = "manual",
) -> dict:
    (
        audit_company_rental_ops,
        audit_portfolio_rental_ops,
        load_qb_aging_by_company,
        load_qb_portfolio_totals,
    ) = _rental_ops_imports()
    audit_company_loan_tracker, audit_portfolio_loan_tracker = _loan_tracker_imports()
    audit_company_cfo_dashboard = _cfo_dashboard_imports()

    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tenant_id).all()
    if company_id:
        companies = [c for c in companies if str(c.id) == company_id]

    uploads = {
        str(u.company_id): u
        for u in db.query(RentalFinancialUpload).filter(RentalFinancialUpload.tenant_id == tenant_id).all()
    }

    qb_by_company = load_qb_aging_by_company(db, tenant_id)
    qb_portfolio = load_qb_portfolio_totals(db, tenant_id)

    results: list[CompanyAuditResult] = []
    for co in companies:
        upload = uploads.get(str(co.id))
        if not upload or not upload.pl_data:
            fin_result = CompanyAuditResult(
                company_id=str(co.id),
                company_name=co.company_name,
                period_label="—",
                has_data=False,
                summary_status="INSUFFICIENT_DATA",
            )
        else:
            fin = fin_upload_to_dict(upload)
            total_debt = _load_company_total_debt(
                db, tenant_id, co.company_name, month=month, year=year,
            )
            fin_result = audit_company_financials(
                fin,
                company_id=str(co.id),
                company_name=co.company_name,
                period=period,
                month=month,
                year=year,
                total_debt=total_debt,
            )
        ops_rows = audit_company_rental_ops(
            db, tenant_id, co, month=month, year=year, qb_by_company=qb_by_company,
        )
        loan_rows = audit_company_loan_tracker(
            db, tenant_id, co, month=month, year=year,
        )
        cfo_rows = (
            audit_company_cfo_dashboard(fin, selected_year=year)
            if upload and upload.pl_data
            else []
        )
        if fin_result.period_label == "—" and (ops_rows or loan_rows or cfo_rows):
            fin_result.period_label = datetime.strptime(
                f"{year}-{month:02d}", "%Y-%m",
            ).strftime("%b-%Y")
        merged = _merge_audit_rows(fin_result, ops_rows)
        merged = _merge_audit_rows(merged, loan_rows)
        results.append(_merge_audit_rows(merged, cfo_rows))

    portfolio_ops_rows = audit_portfolio_rental_ops(
        db, tenant_id, companies, month=month, year=year, qb_portfolio=qb_portfolio,
    )
    portfolio_loan_rows = audit_portfolio_loan_tracker(
        db, tenant_id, month=month, year=year,
    )

    total_mismatch = sum(r.mismatch_count for r in results)
    total_check = sum(r.check_logic_count for r in results)
    companies_with_data = sum(1 for r in results if r.has_data)

    run_id = str(uuid.uuid4())
    payload = {
        "run_id": run_id,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "triggered_by": triggered_by,
        "period": period,
        "month": month,
        "year": year,
        "summary": {
            "companies_total": len(results),
            "companies_with_data": companies_with_data,
            "total_mismatches": total_mismatch,
            "total_check_logic": total_check,
        },
        "portfolio_ops_rows": [asdict(row) for row in portfolio_ops_rows],
        "portfolio_loan_rows": [asdict(row) for row in portfolio_loan_rows],
        "companies": [_company_to_dict(r) for r in results],
    }

    _save_audit_run(db, tenant_id, run_id, payload, triggered_by)
    return payload


def _company_to_dict(r: CompanyAuditResult) -> dict:
    return {
        "company_id": r.company_id,
        "company_name": r.company_name,
        "period_label": r.period_label,
        "has_data": r.has_data,
        "summary_status": r.summary_status,
        "mismatch_count": r.mismatch_count,
        "check_logic_count": r.check_logic_count,
        "rows": [asdict(row) for row in r.rows],
    }


def _save_audit_run(db: Session, tenant_id, run_id: str, payload: dict, triggered_by: str) -> None:
    from models.rentals.kpi_audit import KpiAuditRun

    row = KpiAuditRun(
        id=uuid.UUID(run_id),
        tenant_id=tenant_id,
        triggered_by=triggered_by,
        results_json=payload,
    )
    db.add(row)
    db.commit()


def get_company_audit_from_db(
    db: Session,
    tenant_id,
    company_id: str,
    *,
    period: str | None = None,
    month: int = 6,
    year: int = 2026,
) -> dict:
    """Run audit for a single company — used by in-app Admin tab and KPI expand."""
    co = (
        db.query(RentalCompany)
        .filter(RentalCompany.tenant_id == tenant_id, RentalCompany.id == company_id)
        .first()
    )
    if not co:
        raise ValueError("Company not found")

    (
        audit_company_rental_ops,
        _audit_portfolio_rental_ops,
        load_qb_aging_by_company,
        _load_qb_portfolio_totals,
    ) = _rental_ops_imports()
    audit_company_loan_tracker, _audit_portfolio_loan_tracker = _loan_tracker_imports()
    audit_company_cfo_dashboard = _cfo_dashboard_imports()

    upload = (
        db.query(RentalFinancialUpload)
        .filter(
            RentalFinancialUpload.tenant_id == tenant_id,
            RentalFinancialUpload.company_id == company_id,
        )
        .first()
    )
    if not upload or not upload.pl_data:
        result = CompanyAuditResult(
            company_id=str(co.id),
            company_name=co.company_name,
            period_label="—",
            has_data=False,
            summary_status="INSUFFICIENT_DATA",
        )
    else:
        fin = fin_upload_to_dict(upload)
        total_debt = _load_company_total_debt(
            db, tenant_id, co.company_name, month=month, year=year,
        )
        result = audit_company_financials(
            fin,
            company_id=str(co.id),
            company_name=co.company_name,
            period=period,
            month=month,
            year=year,
            total_debt=total_debt,
        )
    qb_by_company = load_qb_aging_by_company(db, tenant_id)
    ops_rows = audit_company_rental_ops(
        db, tenant_id, co, month=month, year=year, qb_by_company=qb_by_company,
    )
    loan_rows = audit_company_loan_tracker(
        db, tenant_id, co, month=month, year=year,
    )
    cfo_rows = (
        audit_company_cfo_dashboard(fin, selected_year=year)
        if upload and upload.pl_data
        else []
    )
    if result.period_label == "—" and (ops_rows or loan_rows or cfo_rows):
        result.period_label = datetime.strptime(
            f"{year}-{month:02d}", "%Y-%m",
        ).strftime("%b-%Y")
    result = _merge_audit_rows(_merge_audit_rows(result, ops_rows), loan_rows)
    result = _merge_audit_rows(result, cfo_rows)
    return _company_to_dict(result)


def get_latest_audit_run(db: Session, tenant_id) -> dict | None:
    from models.rentals.kpi_audit import KpiAuditRun

    row = (
        db.query(KpiAuditRun)
        .filter(KpiAuditRun.tenant_id == tenant_id)
        .order_by(KpiAuditRun.run_at.desc())
        .first()
    )
    return row.results_json if row else None


def format_console_report(payload: dict) -> str:
    lines = [
        "=" * 72,
        f"KPI Cross-Check Report — {payload.get('run_at', '')}",
        f"Triggered by: {payload.get('triggered_by', '')}",
        f"Period: {payload.get('period') or 'monthly'} {payload.get('month')}/{payload.get('year')}",
        "-" * 72,
    ]
    summary = payload.get("summary", {})
    lines.append(
        f"Companies: {summary.get('companies_with_data', 0)}/{summary.get('companies_total', 0)} with data | "
        f"Mismatches: {summary.get('total_mismatches', 0)} | Logic checks: {summary.get('total_check_logic', 0)}",
    )
    lines.append("")

    all_rows: list[tuple[str, dict]] = []
    for co in payload.get("companies", []):
        for row in co.get("rows", []):
            if row.get("status") != "MATCH":
                all_rows.append((co.get("company_name", ""), row))

    all_rows.sort(key=lambda x: (0 if x[1].get("status") == "MISMATCH" else 1, x[0], x[1].get("kpi", "")))

    if not all_rows:
        lines.append("All KPIs MATCH across companies with financial data.")
    else:
        lines.append(f"{'Company':<22} {'KPI':<22} {'Status':<14} {'Canonical':<12} {'Displayed':<12} Diff")
        lines.append("-" * 72)
        for co_name, row in all_rows:
            lines.append(
                f"{co_name[:21]:<22} {row.get('kpi','')[:21]:<22} {row.get('status',''):<14} "
                f"{row.get('canonical_display','')[:11]:<12} {row.get('displayed_display','')[:11]:<12} "
                f"{row.get('difference_pct') or '—'}",
            )
            if row.get("notes"):
                lines.append(f"  → {row['notes']}")

    lines.append("=" * 72)
    return "\n".join(lines)
