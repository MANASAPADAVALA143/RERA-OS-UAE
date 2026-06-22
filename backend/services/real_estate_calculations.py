"""Pure calculation functions — no DB access."""
from datetime import date
from decimal import Decimal
from typing import Any


def _to_float(val) -> float:
    if val is None:
        return 0.0
    return float(val)


def permit_days_pending(
    application_date: date | None,
    target_approval_date: date | None,
    actual_approval_date: date | None,
    today: date | None = None,
) -> dict:
    today = today or date.today()
    if actual_approval_date:
        return {"days_pending": 0, "is_overdue": False, "days_overdue": 0}
    if not application_date:
        return {"days_pending": 0, "is_overdue": False, "days_overdue": 0}

    days_pending = (today - application_date).days
    is_overdue = False
    days_overdue = 0
    if target_approval_date and today > target_approval_date:
        is_overdue = True
        days_overdue = (today - target_approval_date).days

    return {"days_pending": days_pending, "is_overdue": is_overdue, "days_overdue": days_overdue}


def cost_overrun(budgeted, actual, committed) -> dict:
    """
    SOV variance: (total_exposure - budget) / budget where total_exposure = actual + committed.
    Negative overrun_pct means under budget (e.g. -0.035 = 3.5% under contract value).
    """
    budgeted = _to_float(budgeted)
    actual = _to_float(actual)
    committed = _to_float(committed)
    total_spent = actual + committed
    overrun_amount = total_spent - budgeted
    overrun_pct = (overrun_amount / budgeted) if budgeted > 0 else 0.0
    committed_exposure = budgeted - actual - committed

    if overrun_pct <= 0.05:
        status = "on_track"
    elif overrun_pct <= 0.10:
        status = "watch"
    else:
        status = "over_budget"

    return {
        "overrun_amount": round(overrun_amount, 2),
        "overrun_pct": round(overrun_pct, 4),
        "committed_exposure": round(committed_exposure, 2),
        "status": status,
    }


def unit_economics(
    allocated_land, allocated_construction, allocated_soft, list_price, achieved_sale_price
) -> dict:
    land = _to_float(allocated_land)
    construction = _to_float(allocated_construction)
    soft = _to_float(allocated_soft)
    list_p = _to_float(list_price)
    achieved = _to_float(achieved_sale_price) if achieved_sale_price else None

    total_allocated_cost = land + construction + soft
    if achieved and achieved > 0:
        sale_price = achieved
        price_source = "achieved_sale_price"
    else:
        sale_price = list_p
        price_source = "list_price"

    margin_amount = sale_price - total_allocated_cost
    margin_pct = (margin_amount / sale_price) if sale_price > 0 else 0.0

    return {
        "total_allocated_cost": round(total_allocated_cost, 2),
        "margin_amount": round(margin_amount, 2),
        "margin_pct": round(margin_pct, 4),
        "price_source": price_source,
    }


def covenant_headroom(current_ltv, ltv_covenant, current_dscr, dscr_covenant_min) -> dict:
    ltv = _to_float(current_ltv)
    ltv_cov = _to_float(ltv_covenant)
    dscr = _to_float(current_dscr)
    dscr_min = _to_float(dscr_covenant_min)

    ltv_headroom_pct = (ltv_cov - ltv) if ltv_cov else 0.0
    dscr_headroom = (dscr - dscr_min) if dscr_min else 0.0

    breach_risk = "none"
    if ltv_cov and ltv >= ltv_cov:
        breach_risk = "breach"
    elif dscr_min and dscr < dscr_min:
        breach_risk = "breach"
    elif ltv_cov and ltv >= (ltv_cov - 5):
        breach_risk = "watch"
    elif dscr_min and dscr < (dscr_min + 0.1):
        breach_risk = "watch"

    return {
        "ltv_headroom_pct": round(ltv_headroom_pct, 2),
        "dscr_headroom": round(dscr_headroom, 2),
        "breach_risk": breach_risk,
    }


def debt_maturity_bucket(maturity_date: date | None, today: date | None = None) -> str:
    today = today or date.today()
    if not maturity_date:
        return "180_plus_days"
    days = (maturity_date - today).days
    if days <= 30:
        return "0-30_days"
    if days <= 60:
        return "31-60_days"
    if days <= 90:
        return "61-90_days"
    if days <= 180:
        return "91-180_days"
    return "180_plus_days"


def reit_metrics(
    total_asset_value,
    weighted_avg_ltv,
    total_rental_income,
    ffo_payout_ratio=0.65,
    units_outstanding=1,
) -> dict:
    asset_val = _to_float(total_asset_value)
    ltv = _to_float(weighted_avg_ltv)
    income = _to_float(total_rental_income)
    payout = _to_float(ffo_payout_ratio)
    units = max(int(units_outstanding or 1), 1)

    nav = asset_val * (1 - ltv / 100) if ltv else asset_val
    ffo = income * payout
    distribution_yield = (ffo / asset_val) if asset_val > 0 else 0.0
    nav_per_unit = nav / units

    return {
        "nav": round(nav, 2),
        "ffo": round(ffo, 2),
        "distribution_yield": round(distribution_yield, 4),
        "nav_per_unit": round(nav_per_unit, 2),
    }


def rent_collection_efficiency(billed, collected) -> dict:
    billed = _to_float(billed)
    collected = _to_float(collected)
    pct = (collected / billed) if billed > 0 else 0.0
    vacancy_loss = billed - collected
    return {
        "pct": round(pct, 4),
        "vacancy_loss": round(vacancy_loss, 2),
        "billed": round(billed, 2),
        "collected": round(collected, 2),
    }


def lease_tenant_concentration(list_of_leases: list[dict], top_n: int = 5) -> dict:
    total_rent = sum(_to_float(l.get("annual_rent", 0)) for l in list_of_leases)
    if total_rent <= 0:
        return {"top_tenants": [], "top_n_pct": 0.0, "by_industry": {}}

    sorted_leases = sorted(list_of_leases, key=lambda x: _to_float(x.get("annual_rent", 0)), reverse=True)
    top = sorted_leases[:top_n]
    top_rent = sum(_to_float(l.get("annual_rent", 0)) for l in top)
    top_n_pct = top_rent / total_rent

    by_industry: dict[str, float] = {}
    for lease in list_of_leases:
        industry = lease.get("tenant_industry") or "Unknown"
        by_industry[industry] = by_industry.get(industry, 0) + _to_float(lease.get("annual_rent", 0))

    industry_pct = {k: round(v / total_rent, 4) for k, v in by_industry.items()}

    return {
        "top_tenants": [
            {
                "tenant_name": l.get("tenant_name"),
                "annual_rent": _to_float(l.get("annual_rent", 0)),
                "pct_of_total": round(_to_float(l.get("annual_rent", 0)) / total_rent, 4),
            }
            for l in top
        ],
        "top_n_pct": round(top_n_pct, 4),
        "by_industry": industry_pct,
    }


def vendor_concentration(vendor_committed_values: dict[str, float], total_committed: float) -> dict:
    total = _to_float(total_committed) or sum(_to_float(v) for v in vendor_committed_values.values())
    if total <= 0:
        return {"top_vendor": None, "top_vendor_pct": 0.0, "concentration_risk": False, "breakdown": []}

    sorted_vendors = sorted(vendor_committed_values.items(), key=lambda x: _to_float(x[1]), reverse=True)
    top_name, top_val = sorted_vendors[0]
    top_pct = _to_float(top_val) / total

    return {
        "top_vendor": top_name,
        "top_vendor_pct": round(top_pct, 4),
        "concentration_risk": top_pct > 0.25,
        "breakdown": [
            {"vendor_name": name, "committed": _to_float(val), "pct": round(_to_float(val) / total, 4)}
            for name, val in sorted_vendors
        ],
    }


def litigation_exposure_summary(claims: list[dict]) -> dict:
    total_exposure = sum(_to_float(c.get("exposure_amount", 0)) for c in claims)
    total_reserved = sum(_to_float(c.get("probability_weighted_reserve", 0)) for c in claims)
    by_status: dict[str, dict] = {}
    for c in claims:
        status = c.get("status", "open")
        if status not in by_status:
            by_status[status] = {"count": 0, "exposure": 0.0, "reserved": 0.0}
        by_status[status]["count"] += 1
        by_status[status]["exposure"] += _to_float(c.get("exposure_amount", 0))
        by_status[status]["reserved"] += _to_float(c.get("probability_weighted_reserve", 0))

    return {
        "total_exposure": round(total_exposure, 2),
        "total_reserved": round(total_reserved, 2),
        "by_status": by_status,
    }


def capital_available_now(facilities: list[dict]) -> dict:
    active_types = {"equity_commitment", "line_of_credit", "construction_loan"}
    total = 0.0
    breakdown = []
    for f in facilities:
        if f.get("is_in_default"):
            continue
        ftype = f.get("facility_type", "")
        undrawn = _to_float(f.get("undrawn_available", 0))
        if ftype in active_types and undrawn > 0:
            total += undrawn
            breakdown.append({
                "facility_id": f.get("id"),
                "lender": f.get("lender_or_investor_name"),
                "facility_type": ftype,
                "undrawn_available": undrawn,
            })

    return {"total": round(total, 2), "breakdown": breakdown}


def validate_period_completion(prior: float, current: float, earned_to_date: float) -> dict:
    """
    Validates that prior_period_completed + current_period_completed equals
    earned_to_date within a $1 rounding tolerance.

    Returns {"valid": True} on success.
    Returns {"valid": False, "detail": "..."} on failure — caller should
    raise HTTP 422 rather than silently accepting the drift.
    """
    prior = _to_float(prior)
    current = _to_float(current)
    earned = _to_float(earned_to_date)
    total = prior + current
    diff = abs(total - earned)
    if diff <= 1.0:
        return {"valid": True}
    return {
        "valid": False,
        "detail": (
            f"Prior ({prior:,.2f}) + This Period ({current:,.2f}) = {total:,.2f} "
            f"but Earned to Date = {earned:,.2f} "
            f"(${diff:,.2f} outside the $1 tolerance — data entry error)"
        ),
    }


def schedule_task_late_days(
    planned_end: date | None,
    actual_end: date | None,
    pct_complete: float,
    today: date | None = None,
) -> dict:
    today = today or date.today()
    if actual_end or (planned_end is None):
        return {"days_late": 0, "is_late": False}

    complete = _to_float(pct_complete)
    if complete >= 1.0:
        return {"days_late": 0, "is_late": False}

    if today <= planned_end:
        return {"days_late": 0, "is_late": False}

    days_late = (today - planned_end).days
    return {"days_late": days_late, "is_late": days_late > 0}


def validate_task_status_consistency(
    status: str,
    pct_done: float,
    actual_end: date | None,
) -> dict:
    """
    Guard against bad data: a task marked 'complete' with pct_done < 100% or
    no actual_end is inconsistent data, not a valid state. The only escape hatch
    is an explicit override with a logged reason — this function flags but never
    silently accepts the inconsistency.

    Returns {"valid": True} or {"valid": False, "detail": str, "flag": "status_pct_inconsistency"}
    """
    if status != "complete":
        return {"valid": True}

    issues = []
    pct = _to_float(pct_done)
    if pct < 0.999:
        issues.append(f"% Done is {pct * 100:.0f}% (must be 100% for Completed status)")
    if actual_end is None:
        issues.append("Actual End date is not set (required when status = Completed)")

    if issues:
        return {
            "valid": False,
            "flag": "status_pct_inconsistency",
            "detail": "; ".join(issues) + ". Use Override Status with a logged reason to force this state.",
        }
    return {"valid": True}
