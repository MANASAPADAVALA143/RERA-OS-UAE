"""REIT income-property calculations — pure functions, no DB access."""
from datetime import date


def unit_rental_loss(market_rent, actual_rent, status) -> float:
    market_rent = float(market_rent or 0)
    if status == "occupied" and actual_rent:
        return max(market_rent - float(actual_rent), 0)
    if status in ("vacant", "renovation_hold"):
        return market_rent
    return 0.0


def days_vacant(status, status_changed_at, today=None) -> int | None:
    if status not in ("vacant", "renovation_hold"):
        return None
    if not status_changed_at:
        return None
    today = today or date.today()
    if isinstance(status_changed_at, str):
        status_changed_at = date.fromisoformat(status_changed_at)
    return (today - status_changed_at).days


def property_occupancy(units: list) -> dict:
    total = len(units)
    occupied = sum(1 for u in units if u.get("status") == "occupied")
    return {
        "occupied_units": occupied,
        "total_units": total,
        "occupancy_pct": (occupied / total) if total else None,
    }


def property_pl_summary(units: list, opex_rows: list, loan: dict | None) -> dict:
    gross_potential_rent = sum(float(u["market_rent"]) for u in units)
    vacancy_loss = sum(
        float(u["market_rent"]) for u in units if u.get("status") in ("vacant", "renovation_hold")
    )
    concession_loss = sum(
        max(float(u["market_rent"]) - float(u.get("actual_rent") or 0), 0)
        for u in units
        if u.get("status") == "occupied"
    )
    effective_gross_income = gross_potential_rent - vacancy_loss - concession_loss

    total_opex = sum(
        float(r["monthly_amount"])
        for r in opex_rows
        if r.get("category") != "debt_service"
    )
    noi = effective_gross_income - total_opex

    monthly_interest = float(loan["monthly_interest"]) if loan else 0.0
    monthly_principal = float(loan["monthly_principal"]) if loan else 0.0
    total_debt_service = monthly_interest + monthly_principal
    cash_flow_after_debt_service = noi - total_debt_service

    noi_margin = (noi / effective_gross_income) if effective_gross_income else None

    return {
        "gross_potential_rent": round(gross_potential_rent, 2),
        "vacancy_loss": round(vacancy_loss, 2),
        "concession_loss": round(concession_loss, 2),
        "effective_gross_income": round(effective_gross_income, 2),
        "total_operating_expenses": round(total_opex, 2),
        "net_operating_income": round(noi, 2),
        "debt_service_interest": round(monthly_interest, 2),
        "debt_service_principal": round(monthly_principal, 2),
        "total_debt_service": round(total_debt_service, 2),
        "cash_flow_after_debt_service": round(cash_flow_after_debt_service, 2),
        "noi_margin_pct": round(noi_margin, 4) if noi_margin is not None else None,
    }


def financial_strength(property_row: dict, noi_monthly: float, loan: dict | None) -> dict:
    market_value = property_row.get("current_market_value_estimate")
    annual_noi = float(noi_monthly or 0) * 12

    cap_rate = (annual_noi / float(market_value)) if market_value else None

    principal_balance = float(loan["current_principal_balance"]) if loan else None
    total_debt_service = (
        float(loan["monthly_principal"]) + float(loan["monthly_interest"]) if loan else None
    )
    dscr = (float(noi_monthly) / total_debt_service) if total_debt_service else None
    ltv = (principal_balance / float(market_value)) if (principal_balance and market_value) else None
    equity_value = (
        float(market_value) - principal_balance if (market_value and principal_balance is not None) else None
    )

    appreciation = None
    appreciation_pct = None
    acq = property_row.get("acquisition_price")
    if market_value and acq:
        appreciation = float(market_value) - float(acq)
        appreciation_pct = appreciation / float(acq)

    dscr_covenant_min = 1.20
    dscr_status = None
    if dscr is not None:
        dscr_status = "below_covenant" if dscr < dscr_covenant_min else "healthy"

    return {
        "annual_noi": round(annual_noi, 2),
        "cap_rate_on_current_value": round(cap_rate, 4) if cap_rate is not None else None,
        "dscr": round(dscr, 4) if dscr is not None else None,
        "dscr_status": dscr_status,
        "current_ltv": round(ltv, 4) if ltv is not None else None,
        "equity_value": round(equity_value, 2) if equity_value is not None else None,
        "value_appreciation": round(appreciation, 2) if appreciation is not None else None,
        "value_appreciation_pct": round(appreciation_pct, 4) if appreciation_pct is not None else None,
    }


def distribute_to_partners(cash_flow_after_debt_service: float, ownership_rows: list) -> list:
    is_shortfall = cash_flow_after_debt_service < 0
    return [
        {
            "partner_name": p["partner_name"],
            "role": p.get("role"),
            "ownership_pct": float(p["ownership_pct"]),
            "amount": round(float(cash_flow_after_debt_service) * float(p["ownership_pct"]), 2),
            "is_shortfall": is_shortfall,
        }
        for p in ownership_rows
    ]


def cash_flow_week_status(closing_balance, min_buffer_target: float) -> str:
    if closing_balance < min_buffer_target * 0.5:
        return "red"
    if closing_balance < min_buffer_target:
        return "amber"
    return "green"


def thirteen_week_forecast(weeks: list, min_buffer_target: float) -> list:
    results = []
    running_balance = None
    for w in sorted(weeks, key=lambda x: x["week_number"]):
        net = float(w["inflows"]) - float(w["outflows"])
        closing = float(w["opening_balance"]) + net
        opening_mismatch = (
            running_balance is not None and abs(float(w["opening_balance"]) - running_balance) > 0.01
        )
        results.append({
            **w,
            "net_cash_flow": round(net, 2),
            "closing_balance": round(closing, 2),
            "status": cash_flow_week_status(closing, min_buffer_target),
            "opening_mismatch": opening_mismatch,
        })
        running_balance = closing
    return results


def portfolio_summary_aggregate(property_snapshots: list) -> dict:
    """
    property_snapshots: list of per-property computed dicts with occupancy, pl, strength.
    Occupancy is unit-count weighted. Cap rate is value-weighted. DSCR is debt-service-weighted.
    """
    if not property_snapshots:
        return {
            "total_properties": 0,
            "total_units": 0,
            "portfolio_occupancy_pct": None,
            "total_gross_potential_rent": 0,
            "total_effective_gross_income": 0,
            "total_noi": 0,
            "total_cash_flow_after_debt_service": 0,
            "portfolio_weighted_cap_rate": None,
            "portfolio_weighted_dscr": None,
            "properties_below_dscr_covenant": [],
            "by_property": [],
        }

    total_units = sum(p.get("total_units", 0) for p in property_snapshots)
    occupied_units = sum(p.get("occupied_units", 0) for p in property_snapshots)

    total_gpr = sum(p.get("gross_potential_rent", 0) for p in property_snapshots)
    total_egi = sum(p.get("effective_gross_income", 0) for p in property_snapshots)
    total_noi = sum(p.get("net_operating_income", 0) for p in property_snapshots)
    total_cfads = sum(p.get("cash_flow_after_debt_service", 0) for p in property_snapshots)

    # Cap rate weighted by current market value
    cap_num = sum(
        (p.get("cap_rate") or 0) * (p.get("market_value") or 0)
        for p in property_snapshots
        if p.get("cap_rate") is not None and p.get("market_value")
    )
    cap_den = sum(p.get("market_value") or 0 for p in property_snapshots if p.get("market_value"))
    weighted_cap = (cap_num / cap_den) if cap_den else None

    # DSCR weighted by total monthly debt service (not a simple average of DSCR %)
    dscr_num = sum(
        (p.get("dscr") or 0) * (p.get("total_debt_service") or 0)
        for p in property_snapshots
        if p.get("dscr") is not None and p.get("total_debt_service")
    )
    dscr_den = sum(p.get("total_debt_service") or 0 for p in property_snapshots if p.get("total_debt_service"))
    weighted_dscr = (dscr_num / dscr_den) if dscr_den else None

    below_covenant = [
        {"property_id": p["property_id"], "property_name": p["property_name"], "dscr": p.get("dscr")}
        for p in property_snapshots
        if p.get("dscr_status") == "below_covenant"
    ]

    by_property = sorted(
        [
            {
                "property_id": p["property_id"],
                "property_code": p.get("property_code"),
                "property_name": p["property_name"],
                "asset_class": p.get("asset_class"),
                "occupancy_pct": p.get("occupancy_pct"),
                "noi": p.get("net_operating_income"),
                "dscr": p.get("dscr"),
                "dscr_status": p.get("dscr_status"),
                "cash_flow_after_debt_service": p.get("cash_flow_after_debt_service"),
            }
            for p in property_snapshots
        ],
        key=lambda x: x["property_name"],
    )

    return {
        "total_properties": len(property_snapshots),
        "total_units": total_units,
        "portfolio_occupancy_pct": round(occupied_units / total_units, 4) if total_units else None,
        "total_gross_potential_rent": round(total_gpr, 2),
        "total_effective_gross_income": round(total_egi, 2),
        "total_noi": round(total_noi, 2),
        "total_cash_flow_after_debt_service": round(total_cfads, 2),
        "portfolio_weighted_cap_rate": round(weighted_cap, 4) if weighted_cap is not None else None,
        "portfolio_weighted_dscr": round(weighted_dscr, 4) if weighted_dscr is not None else None,
        "properties_below_dscr_covenant": below_covenant,
        "by_property": by_property,
    }
