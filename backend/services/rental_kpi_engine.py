"""Rentals financial KPI engine — mirrors frontend/src/utils/rentalKpiEngine.ts."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_MNAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass
class KpiData:
    total_revenue: float = 0.0
    total_expenses: float = 0.0
    net_income: float = 0.0
    noi: float = 0.0
    rental_income: float = 0.0
    other_income: float = 0.0
    interest_expense: float = 0.0
    property_tax: float = 0.0
    management_fee: float = 0.0
    hoa_fees: float = 0.0
    legal_fees: float = 0.0
    utilities: float = 0.0
    repairs: float = 0.0
    total_assets: float = 0.0
    total_liabilities: float = 0.0
    equity: float = 0.0
    cash: float = 0.0
    buildings: float = 0.0
    accum_dep: float = 0.0
    long_term_loans: float = 0.0
    security_deposits: float = 0.0
    depreciation: float = 0.0


def _pl(fin: dict) -> list[dict]:
    return fin.get("pl") or fin.get("pl_data") or []


def _bs(fin: dict) -> list[dict]:
    return fin.get("bs") or fin.get("bs_data") or []


def _cf(fin: dict) -> list[dict]:
    return fin.get("cf") or fin.get("cf_data") or []


def get_available_keys(fin: dict) -> list[str]:
    periods = fin.get("periods") or []
    if periods:
        return sort_period_keys(periods)
    key_set: set[str] = set()
    for item in _pl(fin):
        mv = item.get("monthlyValues") or item.get("monthly_values") or {}
        key_set.update(mv.keys())
    return sort_period_keys(list(key_set))


def sort_period_keys(keys: list[str]) -> list[str]:
    def sort_key(k: str) -> tuple[int, int]:
        parts = k.split(" ", 1)
        if len(parts) != 2:
            return (9999, 99)
        mon, yr = parts[0], parts[1]
        try:
            return (int(yr), _MNAMES.index(mon))
        except ValueError:
            return (9999, 99)

    return sorted(keys, key=sort_key)


def _get_yv(items: list[dict], pattern: re.Pattern[str], year: int) -> float:
    for item in items:
        if pattern.search(item.get("label", "")):
            return float((item.get("values") or {}).get(year) or (item.get("values") or {}).get(str(year)) or 0)
    return 0.0


def _sum_i(items: list[dict], pattern: re.Pattern[str], year: int) -> float:
    total = 0.0
    for item in items:
        if item.get("isSectionHeader") or item.get("is_section_header"):
            continue
        if item.get("isTotal") or item.get("is_total"):
            continue
        if pattern.search(item.get("label", "")):
            total += float((item.get("values") or {}).get(year) or (item.get("values") or {}).get(str(year)) or 0)
    return total


def _get_mv(items: list[dict], pattern: re.Pattern[str], key: str) -> float:
    for item in items:
        if pattern.search(item.get("label", "")):
            mv = item.get("monthlyValues") or item.get("monthly_values") or {}
            return float(mv.get(key) or 0)
    return 0.0


def _sum_mv(items: list[dict], pattern: re.Pattern[str], key: str) -> float:
    total = 0.0
    for item in items:
        if item.get("isSectionHeader") or item.get("is_section_header"):
            continue
        if item.get("isTotal") or item.get("is_total"):
            continue
        if pattern.search(item.get("label", "")):
            mv = item.get("monthlyValues") or item.get("monthly_values") or {}
            total += float(mv.get(key) or 0)
    return total


def calc_monthly_kpis(pl: list[dict], key: str) -> dict[str, float]:
    total_revenue = (
        _get_mv(pl, re.compile(r"^total\s+for\s+income$", re.I), key)
        or _get_mv(pl, re.compile(r"^total\s+income$", re.I), key)
        or _get_mv(pl, re.compile(r"^gross\s+profit$", re.I), key)
        or _sum_mv(pl, re.compile(r"income|revenue|rent", re.I), key)
    )
    total_expenses = (
        _get_mv(pl, re.compile(r"^total\s+for\s+expenses?$", re.I), key)
        or _get_mv(pl, re.compile(r"^total\s+expenses?$", re.I), key)
    )
    net_income = _get_mv(pl, re.compile(r"^net\s+income$", re.I), key)
    interest = abs(
        _get_mv(pl, re.compile(r"^total\s+for\s+interest\s+paid$", re.I), key)
        or _sum_mv(pl, re.compile(r"^interest\s+on\s+loan|^interest\s+paid$", re.I), key)
    )
    depreciation = abs(_sum_mv(pl, re.compile(r"depreciation|amortization", re.I), key))
    rent_income = (
        _get_mv(pl, re.compile(r"^total\s+for\s+rental\s+income$", re.I), key)
        or _get_mv(pl, re.compile(r"^total\s+for\s+services$", re.I), key)
        or _sum_mv(pl, re.compile(r"^rent\s+-|^rental\s+income$", re.I), key)
    )
    other_income = _get_mv(pl, re.compile(r"^other\s+income$", re.I), key)
    repairs = abs(_sum_mv(pl, re.compile(r"repair|maintenance|cleaning", re.I), key))
    utilities = abs(
        _get_mv(pl, re.compile(r"^total\s+for\s+utilities$", re.I), key)
        or _sum_mv(pl, re.compile(r"electricity|internet|utilities|water", re.I), key)
    )
    hoa = abs(
        _get_mv(pl, re.compile(r"^total\s+for\s+hoa\s+expenses$", re.I), key)
        or _sum_mv(pl, re.compile(r"^hoa", re.I), key)
    )
    property_tax = abs(
        _get_mv(pl, re.compile(r"^total\s+for\s+rates\s+&\s+taxes$", re.I), key)
        or _sum_mv(pl, re.compile(r"property\s+tax", re.I), key)
    )
    management = abs(_sum_mv(pl, re.compile(r"management\s+fee", re.I), key))
    legal = abs(
        _get_mv(pl, re.compile(r"^total\s+for\s+legal", re.I), key)
        or _sum_mv(pl, re.compile(r"legal|accounting\s+fee", re.I), key)
    )
    insurance = abs(_sum_mv(pl, re.compile(r"insurance", re.I), key))
    noi = total_revenue - total_expenses + interest
    return {
        "total_revenue": total_revenue,
        "total_expenses": total_expenses,
        "net_income": net_income,
        "interest": interest,
        "depreciation": depreciation,
        "noi": noi,
        "rent_income": rent_income,
        "other_income": other_income,
        "repairs": repairs,
        "utilities": utilities,
        "hoa": hoa,
        "property_tax": property_tax,
        "management": management,
        "legal": legal,
        "insurance": insurance,
    }


def sum_kpis_over_keys(pl: list[dict], keys: list[str]) -> dict[str, float]:
    totals = {
        "total_revenue": 0.0, "total_expenses": 0.0, "net_income": 0.0,
        "interest": 0.0, "depreciation": 0.0, "rent_income": 0.0, "other_income": 0.0,
        "repairs": 0.0, "utilities": 0.0, "hoa": 0.0, "property_tax": 0.0,
        "management": 0.0, "legal": 0.0, "insurance": 0.0,
    }
    for k in keys:
        m = calc_monthly_kpis(pl, k)
        for key in totals:
            totals[key] += m[key]
    totals["noi"] = totals["total_revenue"] - totals["total_expenses"] + totals["interest"]
    return totals


def calc_kpis(fin: dict, year: int) -> KpiData:
    pl, bs = _pl(fin), _bs(fin)
    total_revenue = (
        _get_yv(pl, re.compile(r"^total\s+for\s+income$", re.I), year)
        or _get_yv(pl, re.compile(r"^total\s+income$", re.I), year)
        or _get_yv(pl, re.compile(r"^gross\s+profit$", re.I), year)
        or _sum_i(pl, re.compile(r"income|revenue|rent", re.I), year)
    )
    total_expenses = (
        _get_yv(pl, re.compile(r"^total\s+for\s+expenses?$", re.I), year)
        or _get_yv(pl, re.compile(r"^total\s+expenses?$", re.I), year)
    )
    net_income = _get_yv(pl, re.compile(r"^net\s+income$", re.I), year)
    noi_row = _get_yv(pl, re.compile(r"^net\s+operating\s+income$", re.I), year)
    interest_expense = abs(
        _get_yv(pl, re.compile(r"^total\s+for\s+interest\s+paid$", re.I), year)
        or _sum_i(pl, re.compile(r"^interest\s+on\s+loan|^interest\s+paid$", re.I), year)
    )
    depreciation = abs(_sum_i(pl, re.compile(r"depreciation|amortization", re.I), year))
    noi = noi_row or (total_revenue - total_expenses + interest_expense)
    rental_income = (
        _get_yv(pl, re.compile(r"^total\s+for\s+rental\s+income$", re.I), year)
        or _get_yv(pl, re.compile(r"^total\s+for\s+services$", re.I), year)
        or _sum_i(pl, re.compile(r"^rent\s+-|^rental\s+income$", re.I), year)
    )
    other_income = _get_yv(pl, re.compile(r"^other\s+income$", re.I), year)
    property_tax = abs(
        _get_yv(pl, re.compile(r"^total\s+for\s+rates\s+&\s+taxes$", re.I), year)
        or _sum_i(pl, re.compile(r"property\s+tax", re.I), year)
    )
    management_fee = abs(_sum_i(pl, re.compile(r"management\s+fee", re.I), year))
    hoa_fees = abs(
        _get_yv(pl, re.compile(r"^total\s+for\s+hoa\s+expenses$", re.I), year)
        or _sum_i(pl, re.compile(r"^hoa", re.I), year)
    )
    legal_fees = abs(
        _get_yv(pl, re.compile(r"^total\s+for\s+legal", re.I), year)
        or _sum_i(pl, re.compile(r"legal|accounting\s+fee", re.I), year)
    )
    utilities = abs(
        _get_yv(pl, re.compile(r"^total\s+for\s+utilities$", re.I), year)
        or _sum_i(pl, re.compile(r"electricity|internet|utilities|water", re.I), year)
    )
    repairs = abs(_sum_i(pl, re.compile(r"repair|maintenance|cleaning", re.I), year))
    total_assets = (
        _get_yv(bs, re.compile(r"^total\s+for\s+assets$", re.I), year)
        or _get_yv(bs, re.compile(r"^total\s+assets$", re.I), year)
    )
    total_liabilities = (
        _get_yv(bs, re.compile(r"^total\s+for\s+liabilities$", re.I), year)
        or _get_yv(bs, re.compile(r"^total\s+liabilities$", re.I), year)
        or _get_yv(bs, re.compile(r"^total\s+for\s+long.term\s+liabilities$", re.I), year)
        + abs(_get_yv(bs, re.compile(r"^total\s+for\s+current\s+liabilities$", re.I), year))
    )
    equity = (
        _get_yv(bs, re.compile(r"^total\s+for\s+equity$", re.I), year)
        or _get_yv(bs, re.compile(r"^total\s+equity$", re.I), year)
    )
    cash = (
        _get_yv(bs, re.compile(r"^total\s+for\s+bank\s+accounts$", re.I), year)
        or _sum_i(bs, re.compile(r"^bank\s+of\s+america|^great\s+plains|^prosperity|checking|savings", re.I), year)
    )
    buildings = abs(
        _get_yv(bs, re.compile(r"^buildings$", re.I), year)
        or _get_yv(bs, re.compile(r"^property\s*(and|&)?\s*equipment", re.I), year)
        or _get_yv(bs, re.compile(r"^fixed\s*assets", re.I), year)
        or _get_yv(bs, re.compile(r"^land\s*(and|&)?\s*buildings", re.I), year)
        or _get_yv(bs, re.compile(r"^real\s+estate", re.I), year)
    )
    accum_dep = _get_yv(bs, re.compile(r"accumulated\s+dep", re.I), year)
    long_term_loans = abs(
        _get_yv(bs, re.compile(r"^total\s+for\s+long.term\s+liabilities$", re.I), year)
        or _sum_i(bs, re.compile(r"^loan\s+from\s+gpb|^independent\s+bank|^loan\s+a\/c", re.I), year)
    )
    security_deposits = abs(
        _get_yv(bs, re.compile(r"^total\s+for\s+security\s+deposit$", re.I), year)
        or _sum_i(bs, re.compile(r"security\s+deposit", re.I), year)
    )
    return KpiData(
        total_revenue=total_revenue, total_expenses=total_expenses, net_income=net_income,
        noi=noi, rental_income=rental_income, other_income=other_income,
        interest_expense=interest_expense, property_tax=property_tax,
        management_fee=management_fee, hoa_fees=hoa_fees, legal_fees=legal_fees,
        utilities=utilities, repairs=repairs, total_assets=total_assets,
        total_liabilities=total_liabilities, equity=equity, cash=cash,
        buildings=buildings, accum_dep=accum_dep, long_term_loans=long_term_loans,
        security_deposits=security_deposits, depreciation=depreciation,
    )


def calc_kpis_from_monthly_key(fin: dict, key: str) -> KpiData:
    pl, bs = _pl(fin), _bs(fin)
    m = calc_monthly_kpis(pl, key)
    year = int(key.split()[-1]) if key.split() else 0
    annual_bs = calc_kpis(fin, year)
    # BS monthly if available, else annual snapshot
    total_assets = (
        _get_mv(bs, re.compile(r"^total\s+for\s+assets$", re.I), key)
        or _get_mv(bs, re.compile(r"^total\s+assets$", re.I), key)
        or annual_bs.total_assets
    )
    total_liabilities = (
        _get_mv(bs, re.compile(r"^total\s+for\s+liabilities$", re.I), key)
        or _get_mv(bs, re.compile(r"^total\s+liabilities$", re.I), key)
        or annual_bs.total_liabilities
    )
    equity = (
        _get_mv(bs, re.compile(r"^total\s+for\s+equity$", re.I), key)
        or _get_mv(bs, re.compile(r"^total\s+equity$", re.I), key)
        or annual_bs.equity
    )
    cash = (
        _get_mv(bs, re.compile(r"^total\s+for\s+bank\s+accounts$", re.I), key)
        or _sum_mv(bs, re.compile(r"^bank\s+of\s+america|^great\s+plains|^prosperity|checking|savings", re.I), key)
        or annual_bs.cash
    )
    buildings = abs(
        _get_mv(bs, re.compile(r"^buildings$", re.I), key)
        or _get_mv(bs, re.compile(r"^property\s*(and|&)?\s*equipment", re.I), key)
        or annual_bs.buildings
    )
    long_term_loans = abs(
        _get_mv(bs, re.compile(r"^total\s+for\s+long.term\s+liabilities$", re.I), key)
        or _sum_mv(bs, re.compile(r"^loan\s+from\s+gpb|^independent\s+bank|^loan\s+a\/c", re.I), key)
        or annual_bs.long_term_loans
    )
    return KpiData(
        total_revenue=m["total_revenue"], total_expenses=m["total_expenses"],
        net_income=m["net_income"], noi=m["noi"], rental_income=m["rent_income"],
        other_income=m["other_income"], interest_expense=m["interest"],
        property_tax=m["property_tax"], management_fee=m["management"],
        hoa_fees=m["hoa"], legal_fees=m["legal"], utilities=m["utilities"],
        repairs=m["repairs"], total_assets=total_assets, total_liabilities=total_liabilities,
        equity=equity, cash=cash, buildings=buildings, accum_dep=annual_bs.accum_dep,
        long_term_loans=long_term_loans, security_deposits=annual_bs.security_deposits,
        depreciation=m["depreciation"],
    )


def get_period_keys(period: str, month: int, year: int) -> list[str]:
    if period == "MoM":
        prev_month = 12 if month == 1 else month - 1
        prev_year = year - 1 if month == 1 else year
        return [f"{_MNAMES[prev_month - 1]} {prev_year}", f"{_MNAMES[month - 1]} {year}"]
    if period == "YTD":
        return [f"{_MNAMES[i]} {year}" for i in range(month)]
    # TTM
    keys = []
    for i in range(12):
        offset = month - 1 - (11 - i)
        m_idx = offset % 12
        y = year + offset // 12
        keys.append(f"{_MNAMES[m_idx]} {y}")
    return keys


def _period_aggregate_to_kpi(fin: dict, agg: dict[str, float], bs_key: str) -> KpiData:
    bs_k = calc_kpis_from_monthly_key(fin, bs_key)
    return KpiData(
        total_revenue=agg["total_revenue"], total_expenses=agg["total_expenses"],
        net_income=agg["net_income"], noi=agg["noi"], rental_income=agg["rent_income"],
        other_income=agg["other_income"], interest_expense=agg["interest"],
        property_tax=agg["property_tax"], management_fee=agg["management"],
        hoa_fees=agg["hoa"], legal_fees=agg["legal"], utilities=agg["utilities"],
        repairs=agg["repairs"], total_assets=bs_k.total_assets,
        total_liabilities=bs_k.total_liabilities, equity=bs_k.equity, cash=bs_k.cash,
        buildings=bs_k.buildings, accum_dep=bs_k.accum_dep,
        long_term_loans=bs_k.long_term_loans, security_deposits=bs_k.security_deposits,
        depreciation=agg["depreciation"],
    )


def resolve_kpi_view(
    fin: dict,
    kpi_year: int,
    kpi_month: int | None,
) -> tuple[KpiData, KpiData | None, str]:
    available = get_available_keys(fin)
    years = fin.get("years") or []
    year = kpi_year if kpi_year in years else (years[-1] if years else kpi_year)

    if kpi_month and available:
        key = f"{_MNAMES[kpi_month - 1]} {kpi_year}"
        if key in available:
            k = calc_kpis_from_monthly_key(fin, key)
            prev_year_key = f"{_MNAMES[kpi_month - 1]} {kpi_year - 1}"
            prev_month_key = f"{_MNAMES[11] if kpi_month == 1 else _MNAMES[kpi_month - 2]} {kpi_year - 1 if kpi_month == 1 else kpi_year}"
            k_prev = None
            if prev_year_key in available:
                k_prev = calc_kpis_from_monthly_key(fin, prev_year_key)
            elif prev_month_key in available:
                k_prev = calc_kpis_from_monthly_key(fin, prev_month_key)
            elif (kpi_year - 1) in years:
                k_prev = calc_kpis(fin, kpi_year - 1)
            return k, k_prev, key

    k = calc_kpis(fin, year)
    prev_years = [y for y in years if y < year]
    k_prev = calc_kpis(fin, prev_years[-1]) if prev_years else None
    return k, k_prev, f"FY {year}"


def resolve_kpi_view_for_period(
    fin: dict,
    period: str | None,
    p_month: int,
    p_year: int,
) -> tuple[KpiData, KpiData | None, str]:
    if not period:
        return resolve_kpi_view(fin, p_year, p_month)

    keys = get_period_keys(period, p_month, p_year)
    available = get_available_keys(fin)
    keys = [k for k in keys if k in available]
    if not keys:
        return resolve_kpi_view(fin, p_year, p_month)

    agg = sum_kpis_over_keys(_pl(fin), keys)
    bs_key = keys[-1]
    k = _period_aggregate_to_kpi(fin, agg, bs_key)

    if period == "MoM" and len(keys) >= 2 and keys[0] in available:
        k_prev = calc_kpis_from_monthly_key(fin, keys[0])
        label = f"{keys[-1]} vs {keys[0]}"
    elif period == "YTD":
        k_prev = None
        label = f"YTD Jan–{_MNAMES[p_month - 1]} {p_year}"
    else:
        k_prev = None
        label = f"TTM ending {_MNAMES[p_month - 1]} {p_year}"

    return k, k_prev, label


def fin_upload_to_dict(row: Any) -> dict:
    return {
        "company_name": row.company_name,
        "years": row.years or [],
        "periods": row.periods or [],
        "pl": row.pl_data or [],
        "bs": row.bs_data or [],
        "cf": row.cf_data or [],
    }
