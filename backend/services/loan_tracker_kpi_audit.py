"""Loan Tracker KPI audit for Calculations Review — mirrors RentalLoanTracker.tsx."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from models.real_estate.loan import Loan
from models.rentals.models import RentalCompany
from routers.real_estate.loans import _loan_dict
from services.kpi_audit_types import KpiCheckRow


def _fmt_currency(n: float | None) -> str:
    if n is None:
        return "N/A"
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


def _fmt_pct_decimal(rate: float | None, d: int = 2) -> str:
    if rate is None:
        return "N/A"
    return f"{rate * 100:.{d}f}%"


def _fmt_ratio(n: float | None, d: int = 2) -> str:
    if n is None:
        return "N/A"
    return f"{n:.{d}f}x"


def _fmt_months(n: float | None) -> str:
    if n is None:
        return "N/A"
    return f"{int(round(n))}mo"


def _balance(loan: dict[str, Any]) -> float:
    bal = loan.get("loan_balance_as_of")
    if bal is not None:
        return float(bal)
    return 0.0


def load_registry_rental_loan_dicts(
    db: Session,
    tenant_id,
    *,
    balance_period: str | None = None,
    company_names: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Rental loans scoped to Company Registry — same filter as Loan Tracker UI."""
    if company_names is None:
        companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tenant_id).all()
        company_names = {c.company_name for c in companies if c.company_name}

    q = db.query(Loan).filter(Loan.tenant_id == tenant_id, Loan.context_type == "rental")
    loans = q.all()
    if company_names:
        loans = [ln for ln in loans if ln.company_name in company_names]
    return [_loan_dict(ln, balance_period=balance_period) for ln in loans]


def compute_loan_tracker_kpis(loans: list[dict[str, Any]]) -> dict[str, Any]:
    """Canonical KPI bundle — matches frontend kpis + extKpis useMemos."""
    now = date.today()

    portfolio = sum(_balance(l) for l in loans)
    emi = sum(float(l.get("loan_emi") or 0) for l in loans)

    rated = [l for l in loans if l.get("loan_interest_rate") is not None]
    rate_bal_sum = sum(_balance(l) for l in rated)
    w_avg = (
        sum(float(l["loan_interest_rate"]) * _balance(l) for l in rated) / rate_bal_sum
        if rate_bal_sum > 0 else None
    )

    with_mat = [l for l in loans if l.get("loan_maturity_date")]
    next_mat = min(with_mat, key=lambda l: l["loan_maturity_date"]) if with_mat else None

    total_outstanding = portfolio
    loans_with_maturity = [l for l in loans if l.get("loan_maturity_date")]
    w_term_num = 0.0
    w_term_den = 0.0
    for l in loans_with_maturity:
        bal = _balance(l)
        mat = date.fromisoformat(l["loan_maturity_date"])
        months = max(0, (mat.year - now.year) * 12 + mat.month - now.month)
        w_term_num += months * bal
        w_term_den += bal
    weighted_avg_term = w_term_num / w_term_den if w_term_den > 0 else None

    in12: list[dict] = []
    for l in loans_with_maturity:
        mat = date.fromisoformat(l["loan_maturity_date"])
        months = (mat.year - now.year) * 12 + mat.month - now.month
        if 0 <= months <= 12:
            in12.append(l)
    maturing_count = len(in12)
    maturing_amt = sum(_balance(l) for l in in12)

    ltv_loans = [l for l in loans if l.get("current_property_value") and float(l["current_property_value"]) > 0]
    avg_ltv = (
        sum(_balance(l) / float(l["current_property_value"]) * 100 for l in ltv_loans) / len(ltv_loans)
        if ltv_loans else None
    )

    total_debt_service = sum(float(l.get("loan_emi") or 0) * 12 for l in loans)
    noi_loans = [l for l in loans if l.get("noi_annual") and float(l["noi_annual"]) > 0]
    total_noi = sum(float(l["noi_annual"]) for l in noi_loans)
    portfolio_dscr = total_noi / total_debt_service if total_debt_service > 0 and total_noi > 0 else None

    by_building: dict[str, float] = {}
    by_lender: dict[str, float] = {}
    for l in loans:
        bal = _balance(l)
        by_building[l["property_name"]] = by_building.get(l["property_name"], 0) + bal
        by_lender[l["loan_bank_name"]] = by_lender.get(l["loan_bank_name"], 0) + bal

    max_building = max(by_building.items(), key=lambda x: x[1]) if by_building else None
    max_lender = max(by_lender.items(), key=lambda x: x[1]) if by_lender else None
    top_building_pct = max_building[1] / total_outstanding * 100 if total_outstanding > 0 and max_building else None
    top_lender_pct = max_lender[1] / total_outstanding * 100 if total_outstanding > 0 and max_lender else None

    return {
        "portfolio": round(portfolio, 2),
        "emi": round(emi, 2),
        "w_avg": w_avg,
        "next_mat": next_mat,
        "total_outstanding": round(total_outstanding, 2),
        "weighted_avg_term": weighted_avg_term,
        "maturing_count": maturing_count,
        "maturing_amt": round(maturing_amt, 2),
        "avg_ltv": avg_ltv,
        "ltv_count": len(ltv_loans),
        "loan_count": len(loans),
        "portfolio_dscr": portfolio_dscr,
        "total_noi": round(total_noi, 2),
        "total_debt_service": round(total_debt_service, 2),
        "top_building": max_building[0] if max_building else "",
        "top_building_pct": top_building_pct,
        "top_lender": max_lender[0] if max_lender else "",
        "top_lender_pct": top_lender_pct,
    }


def _loan_row(
    *,
    kpi: str,
    section: str,
    formula: str,
    value: float | None,
    display_fn,
    inputs: dict[str, str],
    subst: str,
    sources: list[dict[str, str]],
    notes: str = "",
) -> KpiCheckRow:
    disp = display_fn(value)
    return KpiCheckRow(
        kpi=kpi,
        section=section,
        formula=formula,
        raw_inputs=inputs,
        inputs_detail=inputs,
        substitution=subst,
        sources=sources,
        canonical_value=value,
        canonical_display=disp,
        displayed_value=value,
        displayed_display=disp,
        difference=0.0 if value is not None else None,
        difference_pct=0.0 if value is not None else None,
        status="MATCH" if value is not None else "INSUFFICIENT_DATA",
        notes=notes,
    )


def _kpi_rows_from_bundle(
    bundle: dict[str, Any],
    *,
    section: str,
    scope_label: str,
    balance_period: str | None,
    loan_count: int,
) -> list[KpiCheckRow]:
    period_note = balance_period or "latest stored balance"
    base_inputs = {
        "Loans in scope": str(loan_count),
        "Balance period": period_note,
    }
    src = [
        {"field": "loans", "source": "loans table (context_type=rental)"},
        {"field": "balance", "source": "balance_by_month or loan_balance_as_of"},
        {"field": "registry filter", "source": "r_companies.company_name"},
    ]

    rows: list[KpiCheckRow] = []

    rows.append(_loan_row(
        kpi=f"Total Loan Portfolio ({scope_label})",
        section=section,
        formula="Σ loan_balance_as_of for selected balance period (matches Excel balance column)",
        value=bundle["portfolio"],
        display_fn=_fmt_currency,
        inputs={**base_inputs, "Σ balance": _fmt_currency(bundle["portfolio"])},
        subst=f"Portfolio = sum(balance or amount) = {_fmt_currency(bundle['portfolio'])}",
        sources=src,
    ))
    rows.append(_loan_row(
        kpi=f"Total Monthly EMI ({scope_label})",
        section=section,
        formula="Σ loan_emi (missing EMI treated as $0)",
        value=bundle["emi"],
        display_fn=_fmt_currency,
        inputs={**base_inputs, "Σ EMI": _fmt_currency(bundle["emi"])},
        subst=f"Monthly EMI = {_fmt_currency(bundle['emi'])}",
        sources=src,
    ))
    if bundle["w_avg"] is not None:
        rows.append(_loan_row(
            kpi=f"Weighted Avg Rate ({scope_label})",
            section=section,
            formula="Σ (interest_rate × balance) ÷ Σ balance; rate stored as decimal",
            value=bundle["w_avg"],
            display_fn=_fmt_pct_decimal,
            inputs={**base_inputs, "Weighted rate": _fmt_pct_decimal(bundle["w_avg"])},
            subst=(
                f"Wtd Avg = Σ(rate × balance) / Σ(balance) = {_fmt_pct_decimal(bundle['w_avg'])}"
            ),
            sources=src,
        ))
    else:
        rows.append(KpiCheckRow(
            kpi=f"Weighted Avg Rate ({scope_label})",
            section=section,
            formula="Σ (interest_rate × balance) ÷ Σ balance",
            raw_inputs=base_inputs,
            inputs_detail=base_inputs,
            substitution="No loans with interest rate — cannot compute",
            sources=src,
            canonical_value=None,
            canonical_display="N/A",
            displayed_value=None,
            displayed_display="N/A",
            difference=None,
            difference_pct=None,
            status="INSUFFICIENT_DATA",
        ))

    if bundle["portfolio_dscr"] is not None:
        rows.append(_loan_row(
            kpi=f"Portfolio DSCR ({scope_label})",
            section=section,
            formula="Σ noi_annual ÷ Σ (loan_emi × 12); loans without NOI excluded from numerator",
            value=bundle["portfolio_dscr"],
            display_fn=_fmt_ratio,
            inputs={
                **base_inputs,
                "Annual NOI": _fmt_currency(bundle["total_noi"]),
                "Annual debt service": _fmt_currency(bundle["total_debt_service"]),
            },
            subst=(
                f"DSCR = {_fmt_currency(bundle['total_noi'])} / "
                f"{_fmt_currency(bundle['total_debt_service'])} = {_fmt_ratio(bundle['portfolio_dscr'])}"
            ),
            sources=src,
        ))

    if bundle["weighted_avg_term"] is not None:
        rows.append(_loan_row(
            kpi=f"Wtd Avg Remaining Term ({scope_label})",
            section=section,
            formula="Σ (months_to_maturity × balance) ÷ Σ balance; maturity months floored at 0",
            value=bundle["weighted_avg_term"],
            display_fn=_fmt_months,
            inputs={**base_inputs, "Weighted term": _fmt_months(bundle["weighted_avg_term"])},
            subst=f"Wtd term = {_fmt_months(bundle['weighted_avg_term'])} (~{bundle['weighted_avg_term'] / 12:.1f} yrs)",
            sources=src,
        ))

    rows.append(_loan_row(
        kpi=f"Maturing ≤12 Months ({scope_label})",
        section=section,
        formula="Count and sum of balances for loans with maturity in [0, 12] months from today",
        value=float(bundle["maturing_count"]),
        display_fn=lambda v: f"{int(v or 0)} loan(s), {_fmt_currency(bundle['maturing_amt'])}",
        inputs={
            **base_inputs,
            "Count": str(bundle["maturing_count"]),
            "Amount": _fmt_currency(bundle["maturing_amt"]),
        },
        subst=f"{bundle['maturing_count']} loan(s) · {_fmt_currency(bundle['maturing_amt'])}",
        sources=src,
    ))

    if bundle["avg_ltv"] is not None:
        rows.append(_loan_row(
            kpi=f"Avg LTV ({scope_label})",
            section=section,
            formula="Average of (balance ÷ current_property_value × 100) for loans with property value",
            value=bundle["avg_ltv"],
            display_fn=lambda v: f"{v:.1f}%" if v is not None else "N/A",
            inputs={
                **base_inputs,
                "Loans with value": f"{bundle['ltv_count']} of {bundle['loan_count']}",
                "Avg LTV": f"{bundle['avg_ltv']:.1f}%",
            },
            subst=f"Avg LTV = mean(balance/value×100) = {bundle['avg_ltv']:.1f}%",
            sources=src,
        ))

    if bundle["top_building_pct"] is not None:
        rows.append(_loan_row(
            kpi=f"Top Building Concentration ({scope_label})",
            section=section,
            formula="Largest building balance ÷ total portfolio × 100",
            value=bundle["top_building_pct"],
            display_fn=lambda v: f"{v:.0f}%" if v is not None else "N/A",
            inputs={
                **base_inputs,
                "Largest building": bundle["top_building"],
                "Share": f"{bundle['top_building_pct']:.0f}%",
            },
            subst=f"{bundle['top_building']} = {bundle['top_building_pct']:.0f}% of portfolio",
            sources=src,
        ))

    if bundle["top_lender_pct"] is not None:
        rows.append(_loan_row(
            kpi=f"Top Lender Concentration ({scope_label})",
            section=section,
            formula="Largest lender balance ÷ total portfolio × 100",
            value=bundle["top_lender_pct"],
            display_fn=lambda v: f"{v:.0f}%" if v is not None else "N/A",
            inputs={
                **base_inputs,
                "Largest lender": bundle["top_lender"],
                "Share": f"{bundle['top_lender_pct']:.0f}%",
            },
            subst=f"{bundle['top_lender']} = {bundle['top_lender_pct']:.0f}% of portfolio",
            sources=src,
        ))

    if bundle["next_mat"]:
        nm = bundle["next_mat"]
        rows.append(KpiCheckRow(
            kpi=f"Next Maturity ({scope_label})",
            section=section,
            formula="Earliest loan_maturity_date among scoped loans",
            raw_inputs={
                **base_inputs,
                "Property": nm.get("property_name", "—"),
                "Date": nm.get("loan_maturity_date", "—"),
            },
            inputs_detail={
                "Next maturity": nm.get("loan_maturity_date", "—"),
                "Property": nm.get("property_name", "—"),
            },
            substitution=f"Next = {nm.get('loan_maturity_date')} ({nm.get('property_name')})",
            sources=src,
            canonical_value=None,
            canonical_display=nm.get("loan_maturity_date", "—"),
            displayed_value=None,
            displayed_display=nm.get("loan_maturity_date", "—"),
            difference=None,
            difference_pct=None,
            status="MATCH",
        ))

    return rows


def audit_portfolio_loan_tracker(
    db: Session,
    tenant_id,
    *,
    month: int,
    year: int,
) -> list[KpiCheckRow]:
    balance_period = f"{year}-{month:02d}"
    loans = load_registry_rental_loan_dicts(db, tenant_id, balance_period=balance_period)
    if not loans:
        return [KpiCheckRow(
            kpi="Loan Tracker",
            section="Loan Tracker",
            formula="Import rental loans via Loan Tracker (Company Registry entities only)",
            raw_inputs={"Balance period": balance_period},
            inputs_detail={"Loans": "0"},
            substitution="No rental loans in registry scope",
            sources=[{"field": "loans", "source": "loans table"}],
            canonical_value=None,
            canonical_display="N/A",
            displayed_value=None,
            displayed_display="N/A",
            difference=None,
            difference_pct=None,
            status="INSUFFICIENT_DATA",
            notes="Upload Bank Loan Information Excel or add loans manually",
        )]

    bundle = compute_loan_tracker_kpis(loans)
    return _kpi_rows_from_bundle(
        bundle,
        section="Loan Tracker",
        scope_label="Portfolio",
        balance_period=balance_period,
        loan_count=len(loans),
    )


def audit_company_loan_tracker(
    db: Session,
    tenant_id,
    company: RentalCompany,
    *,
    month: int,
    year: int,
) -> list[KpiCheckRow]:
    balance_period = f"{year}-{month:02d}"
    loans = load_registry_rental_loan_dicts(
        db, tenant_id, balance_period=balance_period, company_names={company.company_name},
    )
    if not loans:
        return []

    bundle = compute_loan_tracker_kpis(loans)
    return _kpi_rows_from_bundle(
        bundle,
        section="Loan Tracker",
        scope_label=company.company_name,
        balance_period=balance_period,
        loan_count=len(loans),
    )
