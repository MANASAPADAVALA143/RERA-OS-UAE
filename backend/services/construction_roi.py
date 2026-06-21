"""Construction financials & ROI calculations — pure functions, no DB access."""


def _f(val) -> float:
    if val is None:
        return 0.0
    return float(val)


def realized_cash_position(
    received,
    paid_subs,
    other_expenses,
    retainage_held,
    retainage_receivable,
) -> dict:
    """Cash-basis view, independent of accrual-basis Cost Trades data."""
    retainage_held = _f(retainage_held)
    retainage_receivable = _f(retainage_receivable)
    net_realized_cash = _f(received) - _f(paid_subs) - _f(other_expenses)
    return {
        "net_realized_cash": round(net_realized_cash, 2),
        "retainage_held": round(retainage_held, 2),
        "retainage_receivable": round(retainage_receivable, 2),
    }


def project_roi_forward_sale(
    total_project_cost,
    equity_pct,
    debt_pct,
    interest_rate_annual,
    construction_months,
    stabilized_noi,
    exit_cap_rate,
    selling_costs_pct=0.025,
) -> dict:
    """
    Underwritten return for a build-to-sell commercial project exiting via
    forward sale at a market cap rate on stabilized NOI.
    """
    total_project_cost = _f(total_project_cost)
    equity_pct = _f(equity_pct)
    debt_pct = _f(debt_pct)
    interest_rate_annual = _f(interest_rate_annual)
    construction_months = int(construction_months or 0)
    stabilized_noi = _f(stabilized_noi)
    exit_cap_rate = _f(exit_cap_rate)
    selling_costs_pct = _f(selling_costs_pct)

    if not exit_cap_rate or exit_cap_rate <= 0:
        return {"error": "exit_cap_rate must be set and positive"}

    if not total_project_cost or total_project_cost <= 0:
        return {"error": "total_project_cost must be set and positive"}

    equity_invested = total_project_cost * equity_pct
    debt_drawn = total_project_cost * debt_pct

    avg_outstanding_pct = 0.55
    interest_during_construction = (
        debt_drawn * avg_outstanding_pct * interest_rate_annual * (construction_months / 12)
        if construction_months > 0
        else 0.0
    )

    exit_value = stabilized_noi / exit_cap_rate if stabilized_noi else None
    if exit_value is None:
        return {"error": "stabilized_noi must be set for forward_sale"}

    selling_costs = exit_value * selling_costs_pct
    net_sale_proceeds = exit_value - selling_costs - debt_drawn
    net_profit = net_sale_proceeds - equity_invested - interest_during_construction

    roi = (net_profit / equity_invested) if equity_invested else None
    moic = (net_sale_proceeds / equity_invested) if equity_invested else None

    return {
        "equity_invested": round(equity_invested, 2),
        "debt_drawn": round(debt_drawn, 2),
        "interest_during_construction": round(interest_during_construction, 2),
        "exit_value": round(exit_value, 2),
        "selling_costs": round(selling_costs, 2),
        "net_sale_proceeds": round(net_sale_proceeds, 2),
        "net_profit": round(net_profit, 2),
        "roi": round(roi, 4) if roi is not None else None,
        "moic": round(moic, 4) if moic is not None else None,
        "is_estimate": True,
        "estimate_note": (
            "Interest during construction uses an average-outstanding-balance approximation, "
            "not an actual draw schedule."
        ),
    }


def simple_project_irr(equity_invested, construction_months, net_sale_proceeds):
    """Simplified IRR: one equity outflow at t=0, one inflow at exit."""
    equity_invested = _f(equity_invested)
    net_sale_proceeds = _f(net_sale_proceeds)
    construction_months = int(construction_months or 0)

    if not equity_invested or equity_invested <= 0:
        return None
    years = construction_months / 12
    if years <= 0:
        return None
    moic = net_sale_proceeds / equity_invested
    if moic <= 0:
        return None
    return round(moic ** (1 / years) - 1, 4)


def roi_assumptions_complete(
    total_project_cost,
    equity_pct,
    debt_pct,
    exit_strategy: str = "forward_sale",
    stabilized_noi=None,
    exit_cap_rate=None,
) -> bool:
    if not total_project_cost or equity_pct is None or debt_pct is None:
        return False
    if exit_strategy == "forward_sale":
        return bool(stabilized_noi and exit_cap_rate)
    return True


def build_project_roi_summary(
    total_project_cost,
    equity_pct,
    debt_pct,
    interest_rate_annual,
    construction_months,
    exit_strategy: str = "forward_sale",
    stabilized_noi=None,
    exit_cap_rate=None,
    selling_costs_pct=0.025,
) -> dict | None:
    """Compute ROI summary from assumptions. Returns None if not configured or unsupported strategy."""
    if not roi_assumptions_complete(
        total_project_cost, equity_pct, debt_pct, exit_strategy, stabilized_noi, exit_cap_rate
    ):
        return None

    if exit_strategy != "forward_sale":
        return None

    result = project_roi_forward_sale(
        total_project_cost=total_project_cost,
        equity_pct=equity_pct,
        debt_pct=debt_pct,
        interest_rate_annual=interest_rate_annual or 0,
        construction_months=construction_months or 0,
        stabilized_noi=stabilized_noi,
        exit_cap_rate=exit_cap_rate,
        selling_costs_pct=selling_costs_pct,
    )
    if result.get("error"):
        return None

    irr = simple_project_irr(
        result.get("equity_invested"),
        construction_months,
        result.get("net_sale_proceeds"),
    )

    return {
        "configured": True,
        "roi": result.get("roi"),
        "moic": result.get("moic"),
        "irr": irr,
        "net_profit": result.get("net_profit"),
        "exit_value": result.get("exit_value"),
        "net_sale_proceeds": result.get("net_sale_proceeds"),
        "equity_invested": result.get("equity_invested"),
        "debt_drawn": result.get("debt_drawn"),
    }


def portfolio_roi_summary(project_roi_list: list) -> dict:
    """
    Equity-weighted portfolio rollup: total profit / total equity invested,
    NOT a simple average of per-project ROI percentages.
    """
    configured = [
        p for p in project_roi_list
        if p.get("configured", True) and p.get("equity_invested")
    ]
    unconfigured_count = len(project_roi_list) - len(configured)

    if not configured:
        return {
            "configured_project_count": 0,
            "unconfigured_project_count": unconfigured_count,
            "portfolio_weighted_roi": None,
            "portfolio_weighted_moic": None,
            "total_equity_invested": 0,
            "total_net_profit": 0,
            "by_project": [],
        }

    total_equity = sum(float(p["equity_invested"]) for p in configured)
    total_profit = sum(float(p["net_profit"]) for p in configured if p.get("net_profit") is not None)
    total_proceeds = sum(
        float(p.get("net_sale_proceeds", p.get("net_proceeds", 0)))
        for p in configured
    )

    portfolio_roi = (total_profit / total_equity) if total_equity else None
    portfolio_moic = (total_proceeds / total_equity) if total_equity else None

    by_project = sorted(
        [
            {
                "project_id": p["project_id"],
                "project_name": p["project_name"],
                "project_code": p.get("project_code"),
                "equity_invested": p["equity_invested"],
                "roi": p.get("roi"),
                "moic": p.get("moic"),
                "net_profit": p.get("net_profit"),
            }
            for p in configured
        ],
        key=lambda x: (x["roi"] if x["roi"] is not None else -999),
        reverse=True,
    )

    return {
        "configured_project_count": len(configured),
        "unconfigured_project_count": unconfigured_count,
        "portfolio_weighted_roi": round(portfolio_roi, 4) if portfolio_roi is not None else None,
        "portfolio_weighted_moic": round(portfolio_moic, 4) if portfolio_moic is not None else None,
        "total_equity_invested": round(total_equity, 2),
        "total_net_profit": round(total_profit, 2),
        "by_project": by_project,
    }


# Backward-compatible alias
portfolio_roi_rollup = portfolio_roi_summary
