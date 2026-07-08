"""CFO Dashboard (Financials tab) KPI audit for Calculations Review."""
from __future__ import annotations

from typing import Any

from services.kpi_audit_types import KpiCheckRow
from services.rental_kpi_engine import KpiData, calc_kpis

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


def _snapshot_rows(fin: dict) -> list[dict[str, Any]]:
    years = fin.get("years") or []
    rows: list[dict[str, Any]] = []
    for y in years:
        k = calc_kpis(fin, int(y))
        margin = (k.net_income / k.total_revenue * 100) if k.total_revenue > 0 else 0.0
        rows.append({
            "year": int(y),
            "revenue": k.total_revenue,
            "expenses": k.total_expenses,
            "net_income": k.net_income,
            "cash": k.cash,
            "margin": margin,
            "rental_income": k.rental_income,
            "other_income": k.other_income,
            "services": max(0.0, k.total_revenue - k.rental_income - k.other_income),
        })
    return rows


def _expense_pie_slices(k: KpiData) -> list[tuple[str, float]]:
    known = (
        k.interest_expense + k.property_tax + k.hoa_fees + k.legal_fees
        + k.management_fee + k.utilities + k.repairs
    )
    other = max(0.0, k.total_expenses - known)
    slices = [
        ("Interest Paid", k.interest_expense),
        ("Property Tax", k.property_tax),
        ("HOA Fees", k.hoa_fees),
        ("Legal Fees", k.legal_fees),
        ("Mgmt Fee", k.management_fee),
        ("Utilities", k.utilities),
        ("Repairs", k.repairs),
        ("Other", other),
    ]
    return [(name, val) for name, val in slices if val > 0]


def _row(
    *,
    kpi: str,
    section: str,
    formula: str,
    inputs_detail: dict[str, Any],
    substitution: str,
    value: float | None,
    display: str,
    exact: bool = False,
) -> KpiCheckRow:
    return KpiCheckRow(
        kpi=kpi,
        section=section,
        formula=formula,
        raw_inputs=inputs_detail,
        inputs_detail=inputs_detail,
        substitution=substitution,
        sources=[{"field": k, "source": "r_financial_uploads P&L/BS annual columns"} for k in inputs_detail],
        canonical_value=value,
        canonical_display=display,
        displayed_value=value,
        displayed_display=display,
        difference=0.0 if value is not None else None,
        difference_pct=0.0 if value is not None else None,
        status="MATCH" if value is not None else "INSUFFICIENT_DATA",
        notes="CFO Dashboard chart — recomputed from uploaded financials (same engine as UI)",
    )


def audit_company_cfo_dashboard(
    fin: dict,
    *,
    selected_year: int | None = None,
) -> list[KpiCheckRow]:
    """Audit CFO Dashboard metrics — mirrors RentalFinancials.tsx CFOTab."""
    years = fin.get("years") or []
    if not years:
        return []

    snapshots = _snapshot_rows(fin)
    last_year = snapshots[-1]["year"]
    sel_year = selected_year if selected_year in [r["year"] for r in snapshots] else last_year
    sel_k = calc_kpis(fin, sel_year)

    rows: list[KpiCheckRow] = []
    section_trends = "CFO Dashboard — Multi-Year Trends"

    # Net Income Trajectory
    ni_lines = "\n".join(f"  {r['year']}: {_fmt_currency(r['net_income'])}" for r in snapshots)
    rows.append(_row(
        kpi="Net Income Trajectory",
        section=section_trends,
        formula="Net Income per FY year from P&L → 'Net Income' row (annual column)",
        inputs_detail={str(r["year"]): _fmt_currency(r["net_income"]) for r in snapshots},
        substitution=f"Per uploaded FY column:\n{ni_lines}",
        value=snapshots[-1]["net_income"],
        display=_fmt_currency(snapshots[-1]["net_income"]),
        exact=True,
    ))

    # Expense Ratio Trend
    ratio_lines = "\n".join(
        f"  {r['year']}: {_fmt_currency(r['expenses'])} / {_fmt_currency(r['revenue'])} × 100 = {_fmt_pct(r['expenses'] / r['revenue'] * 100 if r['revenue'] else 0)}"
        for r in snapshots
    )
    latest_ratio = (
        snapshots[-1]["expenses"] / snapshots[-1]["revenue"] * 100
        if snapshots[-1]["revenue"] > 0 else 0.0
    )
    rows.append(_row(
        kpi="Expense Ratio Trend",
        section=section_trends,
        formula="Total Expenses / Total Revenue × 100 per FY year",
        inputs_detail={
            f"{r['year']} Revenue": _fmt_currency(r["revenue"]) for r in snapshots
        } | {
            f"{r['year']} Expenses": _fmt_currency(r["expenses"]) for r in snapshots
        },
        substitution=f"Per year:\n{ratio_lines}",
        value=latest_ratio,
        display=_fmt_pct(latest_ratio),
    ))

    # Revenue vs Expenses
    rev_lines = "\n".join(
        f"  {r['year']}: Revenue {_fmt_currency(r['revenue'])} | Expenses {_fmt_currency(r['expenses'])}"
        for r in snapshots
    )
    rows.append(_row(
        kpi="Revenue vs Expenses",
        section=section_trends,
        formula="Revenue = P&L 'Total for Income' (or fallback sum); Expenses = P&L 'Total for Expenses'",
        inputs_detail={f"{r['year']}": f"Rev {_fmt_currency(r['revenue'])} · Exp {_fmt_currency(r['expenses'])}" for r in snapshots},
        substitution=f"Bar chart values per year:\n{rev_lines}",
        value=snapshots[-1]["revenue"],
        display=f"Rev {_fmt_currency(snapshots[-1]['revenue'])} / Exp {_fmt_currency(snapshots[-1]['expenses'])}",
    ))

    # Cash Balance Trend
    cash_lines = "\n".join(
        f"  {r['year']}: {_fmt_currency(r['cash'])} (BS year-end, not summed)"
        for r in snapshots
    )
    rows.append(_row(
        kpi="Cash Balance Trend (Bank Accounts)",
        section=section_trends,
        formula="BS 'Total for Bank Accounts' (or sum bank/checking/savings lines) — FY year-end point-in-time balance",
        inputs_detail={str(r["year"]): _fmt_currency(r["cash"]) for r in snapshots},
        substitution=f"NOT summed across months — ending balance per FY:\n{cash_lines}",
        value=snapshots[-1]["cash"],
        display=_fmt_currency(snapshots[-1]["cash"]),
        exact=True,
    ))

    # Revenue Breakdown by Year
    section_rev = "CFO Dashboard — Revenue Breakdown"
    for label, key in [("Rental Income", "rental_income"), ("Other Income", "other_income"), ("Services", "services")]:
        lines = "\n".join(f"  {r['year']}: {_fmt_currency(r[key])}" for r in snapshots)
        rows.append(_row(
            kpi=f"Revenue Breakdown — {label}",
            section=section_rev,
            formula={
                "Rental Income": "P&L rental/services income lines (annual FY column)",
                "Other Income": "P&L 'Other Income' row",
                "Services": "max(0, Total Revenue − Rental Income − Other Income)",
            }[label],
            inputs_detail={str(r["year"]): _fmt_currency(r[key]) for r in snapshots},
            substitution=f"Stacked bar per year:\n{lines}",
            value=snapshots[-1][key],
            display=_fmt_currency(snapshots[-1][key]),
            exact=True,
        ))

    # Expense Breakdown (selected year pie)
    section_exp = f"CFO Dashboard — Expense Breakdown ({sel_year})"
    for name, val in _expense_pie_slices(sel_k):
        rows.append(_row(
            kpi=f"Expense Breakdown — {name}",
            section=section_exp,
            formula=(
                f"{name} from P&L expense lines for FY {sel_year}; "
                "'Other' = Total Expenses minus named categories"
            ),
            inputs_detail={
                "FY Year": str(sel_year),
                "Total Expenses": _fmt_currency(sel_k.total_expenses),
                name: _fmt_currency(val),
            },
            substitution=f"{name} ({sel_year}) = {_fmt_currency(val)}",
            value=val,
            display=_fmt_currency(val),
            exact=True,
        ))

    # Summary tiles
    section_summary = "CFO Dashboard — Summary Tiles"
    avg_margin = sum(r["margin"] for r in snapshots) / len(snapshots) if snapshots else 0.0
    margin_lines = "\n".join(
        f"  {r['year']}: {_fmt_currency(r['net_income'])} / {_fmt_currency(r['revenue'])} × 100 = {_fmt_pct(r['margin'])}"
        for r in snapshots
    )

    rows.append(_row(
        kpi=f"Latest Net Income ({last_year})",
        section=section_summary,
        formula="Net Income for the latest FY year in uploaded financials",
        inputs_detail={"Latest FY": str(last_year), "Net Income": _fmt_currency(snapshots[-1]["net_income"])},
        substitution=f"Latest year {last_year} Net Income = {_fmt_currency(snapshots[-1]['net_income'])}",
        value=snapshots[-1]["net_income"],
        display=_fmt_currency(snapshots[-1]["net_income"]),
        exact=True,
    ))

    rows.append(_row(
        kpi="Avg Profit Margin",
        section=section_summary,
        formula="Average of (Net Income / Total Revenue × 100) across all uploaded FY years",
        inputs_detail={str(r["year"]): _fmt_pct(r["margin"]) for r in snapshots},
        substitution=f"Per-year margins:\n{margin_lines}\nAverage = {_fmt_pct(avg_margin)}",
        value=avg_margin,
        display=_fmt_pct(avg_margin),
    ))

    rows.append(_row(
        kpi=f"Latest Cash Position ({last_year})",
        section=section_summary,
        formula="Bank account balance for latest FY year (same as Cash Balance Trend year-end)",
        inputs_detail={"Latest FY": str(last_year), "Cash": _fmt_currency(snapshots[-1]["cash"])},
        substitution=f"Latest year {last_year} Cash = {_fmt_currency(snapshots[-1]['cash'])}",
        value=snapshots[-1]["cash"],
        display=_fmt_currency(snapshots[-1]["cash"]),
        exact=True,
    ))

    return rows
