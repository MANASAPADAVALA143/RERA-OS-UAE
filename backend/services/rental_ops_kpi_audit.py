"""Rental Portfolio Overview + AR Dashboard KPI audit for Calculations Review."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from models.rentals.models import RentalCompany
from models.rentals.qb_ar_aging import QBArAgingRow, QBArAgingSnapshot
from services.kpi_audit_types import KpiCheckRow
from services.qb_dso import credit_balance_from_buckets, estimate_dso_from_buckets, positive_ar_total
from services.rental_calculations import company_summary

DEFAULT_TOLERANCE_PCT = 0.5


def _status_compare(
    canonical: float | None,
    displayed: float | None,
    *,
    tolerance_pct: float = DEFAULT_TOLERANCE_PCT,
    exact: bool = False,
    check_logic: bool = False,
) -> str:
    if check_logic:
        return "CHECK_LOGIC"
    if canonical is None and displayed is None:
        return "MATCH"
    if canonical is None or displayed is None:
        return "MISMATCH"
    if exact:
        return "MATCH" if abs(canonical - displayed) < 0.01 else "MISMATCH"
    diff = abs(canonical - displayed)
    base = max(abs(canonical), abs(displayed), 1e-9)
    pct = (diff / base) * 100
    return "MATCH" if pct <= tolerance_pct else "MISMATCH"


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


def _fmt_days(n: float | None) -> str:
    if n is None:
        return "N/A"
    return f"{int(round(n))} days"


def _month_keys(month: int, year: int) -> tuple[str, str]:
    selected = f"{year}-{month:02d}"
    abbrev = datetime.strptime(selected, "%Y-%m").strftime("%b-%Y")
    return selected, abbrev


def load_qb_aging_by_company(db: Session, tenant_id) -> dict[str, dict[str, float]]:
    """Latest QB AR snapshot totals per matched company_id."""
    latest = (
        db.query(QBArAgingSnapshot)
        .filter(QBArAgingSnapshot.tenant_id == tenant_id)
        .order_by(QBArAgingSnapshot.as_of_date.desc())
        .first()
    )
    if not latest:
        return {}

    rows = db.query(QBArAgingRow).filter(QBArAgingRow.snapshot_id == latest.id).all()
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.matched_company_id:
            groups[str(r.matched_company_id)].append(r)

    out: dict[str, dict[str, float]] = {}
    for cid, rlist in groups.items():
        totals = {
            "current": round(sum(float(r.current_amount) for r in rlist), 2),
            "days_1_30": round(sum(float(r.days_1_30) for r in rlist), 2),
            "days_31_60": round(sum(float(r.days_31_60) for r in rlist), 2),
            "days_61_90": round(sum(float(r.days_61_90) for r in rlist), 2),
            "days_91_plus": round(sum(float(r.days_91_plus) for r in rlist), 2),
            "total": round(sum(float(r.total) for r in rlist), 2),
        }
        totals["credit_balance"] = credit_balance_from_buckets(totals)
        totals["positive_ar_total"] = positive_ar_total(totals)
        totals["overdue"] = round(
            max(0, totals["days_1_30"]) + max(0, totals["days_31_60"])
            + max(0, totals["days_61_90"]) + max(0, totals["days_91_plus"]), 2,
        )
        out[cid] = totals
    return out


def load_qb_portfolio_totals(db: Session, tenant_id) -> dict[str, float] | None:
    by_co = load_qb_aging_by_company(db, tenant_id)
    if not by_co:
        return None
    keys = ("current", "days_1_30", "days_31_60", "days_61_90", "days_91_plus", "total")
    totals = {k: round(sum(t[k] for t in by_co.values()), 2) for k in keys}
    totals["credit_balance"] = credit_balance_from_buckets(totals)
    totals["positive_ar_total"] = positive_ar_total(totals)
    totals["overdue"] = round(
        max(0, totals["days_1_30"]) + max(0, totals["days_31_60"])
        + max(0, totals["days_61_90"]) + max(0, totals["days_91_plus"]), 2,
    )
    return totals


def _company_ops_summary(db: Session, tenant_id, company: RentalCompany, cur_month: str, month_abbrev: str) -> dict:
    from routers.rentals.router import (
        _apply_collected_fallback,
        _load_company_data,
        _unit_dict,
    )

    today = date.today()
    units, inv_dicts, exp_dicts = _load_company_data(company.id, tenant_id, db)
    inv_by_unit: dict[str, list] = defaultdict(list)
    for inv in inv_dicts:
        inv_by_unit[inv["unit_id"]].append(inv)
    unit_dicts = [_unit_dict(u, inv_by_unit.get(str(u.id), []), today) for u in units]
    summ = company_summary(unit_dicts, inv_dicts, exp_dicts, today, cur_month=cur_month)
    _apply_collected_fallback(summ, company, month_abbrev, db, tenant_id)
    return summ


def _dso_row(
    *,
    kpi: str,
    section: str,
    qb_totals: dict[str, float] | None,
) -> KpiCheckRow:
    if not qb_totals:
        return KpiCheckRow(
            kpi=kpi,
            section=section,
            formula=(
                "Weighted DSO: (Current×0 + 1–30×15 + 31–60×45 + 61–90×75 + 91+×105) "
                "÷ positive AR only; credits zero-floored"
            ),
            raw_inputs={},
            inputs_detail={"QB AR Aging": "not uploaded"},
            substitution="Upload QB AR Aging to compute DSO",
            sources=[{"field": "QB AR Aging", "source": "qb_ar_aging_snapshots + qb_ar_aging_rows"}],
            canonical_value=None,
            canonical_display="N/A",
            displayed_value=None,
            displayed_display="N/A",
            difference=None,
            difference_pct=None,
            status="INSUFFICIENT_DATA",
            notes="No QB AR Aging snapshot for this scope",
        )

    cur = max(0.0, qb_totals.get("current", 0))
    d130 = max(0.0, qb_totals.get("days_1_30", 0))
    d3160 = max(0.0, qb_totals.get("days_31_60", 0))
    d6190 = max(0.0, qb_totals.get("days_61_90", 0))
    d91p = max(0.0, qb_totals.get("days_91_plus", 0))
    credit = credit_balance_from_buckets(qb_totals)
    pos_total = positive_ar_total(qb_totals)
    c_dso = estimate_dso_from_buckets(qb_totals)
    d_dso = float(round(c_dso)) if c_dso is not None else None

    inputs = {
        "Current (pos)": _fmt_currency(cur),
        "1–30 (pos)": _fmt_currency(d130),
        "31–60 (pos)": _fmt_currency(d3160),
        "61–90 (pos)": _fmt_currency(d6190),
        "91+ (pos)": _fmt_currency(d91p),
        "Positive AR total": _fmt_currency(pos_total),
        "Credit balance (excluded)": _fmt_currency(credit) if credit > 0 else "$0",
    }
    subst = (
        f"Step 1 — Zero-floor negative buckets; credit excluded = {_fmt_currency(credit)}\n"
        f"Step 2 — Positive AR = {_fmt_currency(pos_total)}\n"
        f"Step 3 — Weighted = ({_fmt_currency(cur)}×0 + {_fmt_currency(d130)}×15 + "
        f"{_fmt_currency(d3160)}×45 + {_fmt_currency(d6190)}×75 + {_fmt_currency(d91p)}×105) "
        f"/ {_fmt_currency(pos_total)}\n"
        f"         = {_fmt_days(c_dso)}"
    )
    if pos_total <= 0 and credit > 0:
        subst += "\nAll AR is credit — DSO shows N/A on dashboard"

    status = _status_compare(c_dso, d_dso, exact=True) if c_dso is not None else (
        "MATCH" if d_dso is None else "MISMATCH"
    )
    notes = ""
    if credit > 0:
        notes = f"Includes {_fmt_currency(credit)} in credit balances — excluded from DSO calc"

    return KpiCheckRow(
        kpi=kpi,
        section=section,
        formula=(
            "(Current×0 + 1–30×15 + 31–60×45 + 61–90×75 + 91+×105) ÷ sum of positive buckets; "
            "negative buckets treated as $0"
        ),
        raw_inputs=inputs,
        inputs_detail=inputs,
        substitution=subst,
        sources=[
            {"field": "QB buckets", "source": "qb_ar_aging_rows (latest snapshot)"},
            {"field": "DSO engine", "source": "backend/services/qb_dso.py"},
        ],
        canonical_value=c_dso,
        canonical_display=_fmt_days(c_dso),
        displayed_value=d_dso,
        displayed_display=_fmt_days(d_dso),
        difference=abs(c_dso - d_dso) if c_dso is not None and d_dso is not None else None,
        difference_pct=None,
        status=status,
        notes=notes,
    )


def _credit_balance_row(qb_totals: dict[str, float] | None, section: str) -> KpiCheckRow | None:
    if not qb_totals:
        return None
    credit = credit_balance_from_buckets(qb_totals)
    if credit <= 0:
        return None
    return KpiCheckRow(
        kpi="Credit Balance",
        section=section,
        formula="Sum of |negative bucket amounts| across Current, 1–30, 31–60, 61–90, 91+",
        raw_inputs={"Credit balance": _fmt_currency(credit)},
        inputs_detail={"Credit balance": _fmt_currency(credit)},
        substitution=f"Credit Balance = sum(abs(negative buckets)) = {_fmt_currency(credit)}",
        sources=[{"field": "QB AR Aging", "source": "qb_ar_aging_rows"}],
        canonical_value=credit,
        canonical_display=_fmt_currency(credit),
        displayed_value=credit,
        displayed_display=_fmt_currency(credit),
        difference=0.0,
        difference_pct=0.0,
        status="MATCH",
        notes="Excluded from Arrears Days / DSO calculation",
    )


def audit_company_rental_ops(
    db: Session,
    tenant_id,
    company: RentalCompany,
    *,
    month: int,
    year: int,
    qb_by_company: dict[str, dict[str, float]],
) -> list[KpiCheckRow]:
    cur_month, month_abbrev = _month_keys(month, year)
    summ = _company_ops_summary(db, tenant_id, company, cur_month, month_abbrev)
    qb = qb_by_company.get(str(company.id))

    occ_pct = (summ["occupancy_pct"] * 100) if summ["total_units"] else None
    coll_rate = (
        (summ["collected_this_month"] / summ["billed_this_month"] * 100)
        if summ["billed_this_month"] > 0 else None
    )
    outstanding = max(0.0, summ["billed_this_month"] - summ["collected_this_month"])

    rows: list[KpiCheckRow] = []

    def _ops_row(
        kpi: str, section: str, formula: str, c_val: float | None, d_val: float | None,
        display_fn, inputs: dict, subst: str, sources: list[dict[str, str]], exact: bool = False,
    ) -> None:
        diff = abs(c_val - d_val) if c_val is not None and d_val is not None else None
        rows.append(KpiCheckRow(
            kpi=kpi,
            section=section,
            formula=formula,
            raw_inputs=inputs,
            inputs_detail=inputs,
            substitution=subst,
            sources=sources,
            canonical_value=c_val,
            canonical_display=display_fn(c_val),
            displayed_value=d_val,
            displayed_display=display_fn(d_val),
            difference=diff,
            difference_pct=None,
            status=_status_compare(c_val, d_val, exact=exact),
        ))

    _ops_row(
        "Collected This Month",
        "Rental Portfolio Overview",
        "Rent Receivable monthly_rent_data[month] (primary); else P&L income; else invoice collections",
        summ["collected_this_month"],
        summ["collected_this_month"],
        _fmt_currency,
        {
            "Month": month_abbrev,
            "monthly_rent_data": str((company.monthly_rent_data or {}).get(month_abbrev, "—")),
            "Billed": _fmt_currency(summ["billed_this_month"]),
        },
        f"Collected = {_fmt_currency(summ['collected_this_month'])} for {month_abbrev}",
        [
            {"field": "monthly_rent_data", "source": "r_companies.monthly_rent_data"},
            {"field": "rent_history", "source": "r_units.rent_history"},
        ],
        exact=True,
    )
    _ops_row(
        "Occupancy Rate",
        "Rental Portfolio Overview",
        "Occupied Units ÷ Total Units × 100",
        occ_pct,
        occ_pct,
        _fmt_pct,
        {
            "Occupied": str(summ["occupied_units"]),
            "Total": str(summ["total_units"]),
        },
        f"Occupancy = {summ['occupied_units']} / {summ['total_units']} × 100 = {_fmt_pct(occ_pct)}",
        [{"field": "units", "source": "r_units.status / registry counts"}],
    )
    _ops_row(
        "Collection Rate",
        "Rental Portfolio Overview",
        "Collected This Month ÷ Billed This Month × 100",
        coll_rate,
        coll_rate,
        _fmt_pct,
        {
            "Collected": _fmt_currency(summ["collected_this_month"]),
            "Billed": _fmt_currency(summ["billed_this_month"]),
        },
        (
            f"Collection Rate = {_fmt_currency(summ['collected_this_month'])} / "
            f"{_fmt_currency(summ['billed_this_month'])} × 100 = {_fmt_pct(coll_rate)}"
            if coll_rate is not None else "N/A — no billed amount"
        ),
        [{"field": "collected / billed", "source": "portfolio-summary engine"}],
    )
    _ops_row(
        "Outstanding AR",
        "AR Dashboard",
        "max(0, Billed − Collected) for selected month",
        outstanding,
        outstanding,
        _fmt_currency,
        {
            "Billed": _fmt_currency(summ["billed_this_month"]),
            "Collected": _fmt_currency(summ["collected_this_month"]),
        },
        f"Outstanding = max(0, {_fmt_currency(summ['billed_this_month'])} − {_fmt_currency(summ['collected_this_month'])})",
        [{"field": "billed / collected", "source": "registry + Rent Receivable"}],
        exact=True,
    )
    _ops_row(
        "Vacancy Loss",
        "Rental Portfolio Overview",
        "Sum of vacant-unit rent or company vacancy_loss from Rent Receivable sync",
        summ["vacancy_loss"],
        summ["vacancy_loss"],
        _fmt_currency,
        {"Vacant units": str(summ["vacant_units"])},
        f"Vacancy Loss = {_fmt_currency(summ['vacancy_loss'])}",
        [{"field": "vacancy_loss", "source": "r_units + r_companies.vacancy_loss"}],
        exact=True,
    )

    rows.append(_dso_row(
        kpi="Arrears Days Outstanding",
        section="Rental Portfolio Overview",
        qb_totals=qb,
    ))
    rows.append(_dso_row(
        kpi="Est. Days to Collect",
        section="AR Dashboard",
        qb_totals=qb,
    ))

    cr = _credit_balance_row(qb, "Rental Portfolio Overview")
    if cr:
        rows.append(cr)
        ar_cr = KpiCheckRow(
            kpi=cr.kpi,
            section="AR Dashboard",
            formula=cr.formula,
            raw_inputs=cr.raw_inputs,
            inputs_detail=cr.inputs_detail,
            substitution=cr.substitution,
            sources=cr.sources,
            canonical_value=cr.canonical_value,
            canonical_display=cr.canonical_display,
            displayed_value=cr.displayed_value,
            displayed_display=cr.displayed_display,
            difference=cr.difference,
            difference_pct=cr.difference_pct,
            status=cr.status,
            notes=cr.notes,
        )
        rows.append(ar_cr)

    if qb:
        overdue = qb.get("overdue", 0)
        rows.append(KpiCheckRow(
            kpi="Overdue AR (30+)",
            section="AR Dashboard",
            formula="Sum of positive 1–30 + 31–60 + 61–90 + 91+ QB buckets",
            raw_inputs={"Overdue": _fmt_currency(overdue)},
            inputs_detail={"Overdue": _fmt_currency(overdue)},
            substitution=f"Overdue (30+) = {_fmt_currency(overdue)}",
            sources=[{"field": "QB aging", "source": "qb_ar_aging_rows"}],
            canonical_value=overdue,
            canonical_display=_fmt_currency(overdue),
            displayed_value=overdue,
            displayed_display=_fmt_currency(overdue),
            difference=0.0,
            difference_pct=0.0,
            status="MATCH",
        ))

    return rows


def audit_portfolio_rental_ops(
    db: Session,
    tenant_id,
    companies: list[RentalCompany],
    *,
    month: int,
    year: int,
    qb_portfolio: dict[str, float] | None,
) -> list[KpiCheckRow]:
    """Portfolio-wide Rental Overview + AR Dashboard KPIs."""
    cur_month, month_abbrev = _month_keys(month, year)
    from collections import defaultdict as _dd
    from routers.rentals.router import (
        _apply_collected_fallback,
        _load_company_data,
        _unit_dict,
    )

    today = date.today()
    all_units: list[dict] = []
    all_inv: list[dict] = []
    all_exp: list[dict] = []
    total_collected = 0.0

    for co in companies:
        units, inv_dicts, exp_dicts = _load_company_data(co.id, tenant_id, db)
        inv_by_unit: dict[str, list] = _dd(list)
        for inv in inv_dicts:
            inv_by_unit[inv["unit_id"]].append(inv)
        unit_dicts = [_unit_dict(u, inv_by_unit.get(str(u.id), []), today) for u in units]
        summ = company_summary(unit_dicts, inv_dicts, exp_dicts, today, cur_month=cur_month)
        _apply_collected_fallback(summ, co, month_abbrev, db, tenant_id)
        total_collected += summ["collected_this_month"]
        all_units.extend(unit_dicts)
        all_inv.extend(inv_dicts)
        all_exp.extend(exp_dicts)

    port = company_summary(all_units, all_inv, all_exp, today, cur_month=cur_month)
    if port["collected_this_month"] == 0.0 and total_collected > 0:
        port["collected_this_month"] = round(total_collected, 2)

    rows: list[KpiCheckRow] = []
    occ_pct = (port["occupancy_pct"] * 100) if port["total_units"] else None
    rows.append(KpiCheckRow(
        kpi="Collected This Month (Portfolio)",
        section="Rental Portfolio Overview",
        formula="Sum of per-company collected for selected month",
        raw_inputs={"Month": month_abbrev, "Collected": _fmt_currency(port["collected_this_month"])},
        inputs_detail={"Collected": _fmt_currency(port["collected_this_month"])},
        substitution=f"Portfolio Collected = {_fmt_currency(port['collected_this_month'])}",
        sources=[{"field": "companies", "source": "r_companies.monthly_rent_data rollup"}],
        canonical_value=port["collected_this_month"],
        canonical_display=_fmt_currency(port["collected_this_month"]),
        displayed_value=port["collected_this_month"],
        displayed_display=_fmt_currency(port["collected_this_month"]),
        difference=0.0,
        difference_pct=0.0,
        status="MATCH",
    ))
    rows.append(KpiCheckRow(
        kpi="Occupancy Rate (Portfolio)",
        section="Rental Portfolio Overview",
        formula="Portfolio occupied ÷ total units × 100",
        raw_inputs={"Occupied": str(port["occupied_units"]), "Total": str(port["total_units"])},
        inputs_detail={"Occupancy": _fmt_pct(occ_pct)},
        substitution=f"Occupancy = {port['occupied_units']}/{port['total_units']}×100",
        sources=[{"field": "units", "source": "r_units across portfolio"}],
        canonical_value=occ_pct,
        canonical_display=_fmt_pct(occ_pct),
        displayed_value=occ_pct,
        displayed_display=_fmt_pct(occ_pct),
        difference=0.0,
        difference_pct=0.0,
        status="MATCH",
    ))
    rows.append(_dso_row(
        kpi="Arrears Days Outstanding (Portfolio)",
        section="Rental Portfolio Overview",
        qb_totals=qb_portfolio,
    ))
    rows.append(_dso_row(
        kpi="Est. Days to Collect (Portfolio)",
        section="AR Dashboard",
        qb_totals=qb_portfolio,
    ))
    cr = _credit_balance_row(qb_portfolio, "Rental Portfolio Overview")
    if cr:
        rows.append(cr)
    return rows
