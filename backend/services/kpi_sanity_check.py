"""KPI sanity check — recompute from raw P&L/BS and compare to live UI display logic."""
from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy.orm import Session

from models.rentals.models import RentalCompany, RentalFinancialUpload
from services.rental_kpi_engine import (
    KpiData,
    fin_upload_to_dict,
    get_available_keys,
    resolve_kpi_view,
    resolve_kpi_view_for_period,
)

Status = Literal["MATCH", "MISMATCH", "CHECK_LOGIC", "INSUFFICIENT_DATA"]

DEFAULT_TOLERANCE_PCT = 0.5


@dataclass
class KpiCheckRow:
    kpi: str
    section: str
    formula: str
    raw_inputs: dict[str, Any]
    canonical_value: float | None
    canonical_display: str
    displayed_value: float | None
    displayed_display: str
    difference: float | None
    difference_pct: float | None
    status: Status
    notes: str = ""


@dataclass
class CompanyAuditResult:
    company_id: str
    company_name: str
    period_label: str
    has_data: bool
    summary_status: Status
    rows: list[KpiCheckRow] = field(default_factory=list)
    mismatch_count: int = 0
    check_logic_count: int = 0


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
    if n is None or n <= 0:
        return "N/A"
    return f"{n:.{d}f}x"


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


def _raw_inputs(k: KpiData, k_prev: KpiData | None) -> dict[str, Any]:
    return {
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
        "Buildings / Property Value": _fmt_currency(k.buildings),
        "Long-term Loans": _fmt_currency(k.long_term_loans),
        "Total Assets": _fmt_currency(k.total_assets),
        "Total Liabilities": _fmt_currency(k.total_liabilities),
        "Equity": _fmt_currency(k.equity),
        "Cash": _fmt_currency(k.cash),
        "Prior Period Revenue": _fmt_currency(k_prev.total_revenue) if k_prev else "N/A",
    }


def _canonical_metrics(k: KpiData, k_prev: KpiData | None) -> dict[str, float | None]:
    rev_g = None
    if k_prev and k_prev.total_revenue > 0:
        rev_g = ((k.total_revenue - k_prev.total_revenue) / k_prev.total_revenue) * 100
    ebitda = k.noi + k.depreciation
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
        "Debt-to-Equity": (k.total_liabilities / k.equity) if k.equity > 0 else None,
        "Cash Balance": k.cash,
        "Debt-to-Asset": (k.total_liabilities / k.total_assets) * 100 if k.total_assets > 0 else None,
        "Equity Ratio": (k.equity / k.total_assets) * 100 if k.total_assets > 0 else None,
        "DSCR (Est.)": (k.noi / (k.interest_expense * 1.2)) if k.interest_expense > 0 else None,
        "EBITDA Margin": _pct(ebitda, k.total_revenue),
        "ROA": _pct(k.net_income, k.total_assets),
        "ROE": _pct(k.net_income, k.equity),
        "Cap Rate": _pct(k.noi, k.buildings),
    }


def _displayed_metrics_kpi_tab(k: KpiData, k_prev: KpiData | None) -> dict[str, float | None]:
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
        "Debt-to-Equity": (k.total_liabilities / k.equity) if k.equity > 0 else 0.0,
        "Cash Balance": k.cash,
        "Debt-to-Asset": (k.total_liabilities / k.total_assets * 100) if k.total_assets > 0 else 0.0,
        "Equity Ratio": (k.equity / k.total_assets * 100) if k.total_assets > 0 else 0.0,
        "DSCR (Est.)": (k.noi / (k.interest_expense * 1.2)) if k.interest_expense > 0 else 0.0,
        "EBITDA Margin": _pct(k.noi + k.depreciation, k.total_revenue),
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
    {"kpi": "Debt-to-Equity", "section": "Balance Sheet", "formula": "Total Liabilities / Equity"},
    {"kpi": "Cash Balance", "section": "Balance Sheet", "formula": "Sum of bank account balances (BS)", "exact": True},
    {"kpi": "Debt-to-Asset", "section": "Balance Sheet", "formula": "Total Liabilities / Total Assets × 100"},
    {"kpi": "Equity Ratio", "section": "Balance Sheet", "formula": "Equity / Total Assets × 100"},
    {"kpi": "DSCR (Est.)", "section": "Financial Ratios",
     "formula": "NOI / (Interest Paid × 1.2) — N/A when interest = $0"},
    {"kpi": "EBITDA Margin", "section": "Financial Ratios",
     "formula": "(NOI + Depreciation) / Total Revenue × 100"},
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


def audit_company_financials(
    fin: dict,
    *,
    company_id: str,
    company_name: str,
    period: str | None = None,
    month: int = 6,
    year: int = 2026,
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

    canonical = _canonical_metrics(k, k_prev)
    displayed = _displayed_metrics_kpi_tab(k, k_prev)
    raw = _raw_inputs(k, k_prev)
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

        diff_abs, diff_pct = _diff(c_val, d_val)
        status = _status_compare(
            c_val, d_val, tolerance_pct=DEFAULT_TOLERANCE_PCT, exact=exact, check_logic=check_logic,
        )

        rows.append(KpiCheckRow(
            kpi=name,
            section=meta["section"],
            formula=meta["formula"],
            raw_inputs=raw,
            canonical_value=c_val,
            canonical_display=_format_kpi_value(name, c_val),
            displayed_value=d_val,
            displayed_display=_format_kpi_value(name, d_val if not (check_logic and d_val == 0) else d_val),
            difference=diff_abs,
            difference_pct=diff_pct,
            status=status,
            notes=notes,
        ))

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
    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tenant_id).all()
    if company_id:
        companies = [c for c in companies if str(c.id) == company_id]

    uploads = {
        str(u.company_id): u
        for u in db.query(RentalFinancialUpload).filter(RentalFinancialUpload.tenant_id == tenant_id).all()
    }

    results: list[CompanyAuditResult] = []
    for co in companies:
        upload = uploads.get(str(co.id))
        if not upload or not upload.pl_data:
            results.append(CompanyAuditResult(
                company_id=str(co.id),
                company_name=co.company_name,
                period_label="—",
                has_data=False,
                summary_status="INSUFFICIENT_DATA",
            ))
            continue
        fin = fin_upload_to_dict(upload)
        results.append(audit_company_financials(
            fin,
            company_id=str(co.id),
            company_name=co.company_name,
            period=period,
            month=month,
            year=year,
        ))

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
