"""
Schedule of Values (SOV) calculation functions.

Schema note: billed_to_date is sourced from CostTrade.actual_cost_to_date,
which represents costs invoiced by subcontractors to date. This is the closest
proxy available in the current schema. A dedicated billed_to_date field would
allow billing to differ from cost (e.g. billing lag or pay-when-paid terms),
and is worth adding as a future schema enhancement.

cost_impact per trade is computed at query time from ChangeOrders with
matching csi_division_code and approved status — it is NOT stored on CostTrade.
"""


def _to_f(v) -> float:
    if v is None:
        return 0.0
    return float(v)


def sov_billing_status(
    contract_amount: float,
    pct_complete: float,
    billed_to_date: float,
    cost_impact: float = 0.0,
) -> dict:
    """
    Compute earned vs billed position for one SOV line.

    earned_to_date   = contract_amount * pct_complete
    balance_to_finish = (contract_amount + cost_impact) * (1 - pct_complete)
    billing_variance  = earned - billed  (positive → underbilled, negative → overbilled)
    billing_variance_pct = billing_variance / earned (None when earned = 0)
    status: 'underbilled' | 'overbilled' | 'aligned' | 'no_data'
    """
    contract_amount = _to_f(contract_amount)
    pct_complete = _to_f(pct_complete)
    billed_to_date = _to_f(billed_to_date)
    cost_impact = _to_f(cost_impact)

    earned_to_date = contract_amount * pct_complete
    balance_to_finish = (contract_amount + cost_impact) * (1.0 - pct_complete)
    billing_variance = earned_to_date - billed_to_date

    if earned_to_date == 0:
        billing_variance_pct = None
        status = "no_data"
    else:
        billing_variance_pct = billing_variance / earned_to_date
        if billing_variance_pct > 0.05:
            status = "underbilled"
        elif billing_variance_pct < -0.05:
            status = "overbilled"
        else:
            status = "aligned"

    return {
        "earned_to_date": round(earned_to_date, 2),
        "billed_to_date": round(billed_to_date, 2),
        "balance_to_finish": round(balance_to_finish, 2),
        "billing_variance": round(billing_variance, 2),
        "billing_variance_pct": round(billing_variance_pct, 4) if billing_variance_pct is not None else None,
        "billing_status": status,
    }


def sov_exceptions(sov_list: list[dict]) -> list[dict]:
    """
    Prioritized attention list across all SOV rows.

    Priority order (highest first):
    1. Missing dates AND pct_complete > 0  — progress without schedule baseline
    2. Blank/untitled SOV name            — data-integrity blocker
    3. Overbilled (most negative billing_variance_pct first)
    4. Underbilled by > 10%              — lost cash flow
    5. Nonzero cost_impact              — unexplained cost exposure

    Returns only genuine issues; does NOT pad to a minimum count.
    """
    issues: list[tuple[int, float, dict]] = []

    for sov in sov_list:
        sov_id = sov.get("id", "")
        name = (sov.get("division_label") or sov.get("trade_name") or "").strip()
        pct = _to_f(sov.get("pct_complete"))
        start = sov.get("sov_start_date")
        end = sov.get("sov_end_date")
        billing_variance_pct = sov.get("billing_variance_pct")
        billing_status = sov.get("billing_status", "no_data")
        cost_impact = _to_f(sov.get("cost_impact"))

        # 1. Missing dates with progress
        if pct > 0 and (not start or not end):
            issues.append((1, -pct, {
                "type": "missing_dates",
                "sov_id": sov_id,
                "sov_name": name or "Untitled SOV",
                "message": f"{round(pct * 100, 1)}% complete but no schedule dates set — "
                           "progress has no baseline to track against",
            }))

        # 2. Untitled / blank name
        if not name:
            issues.append((2, 0.0, {
                "type": "untitled",
                "sov_id": sov_id,
                "sov_name": "Untitled SOV",
                "message": "SOV name is blank — blocks downstream billing and reporting",
            }))

        # 3. Overbilled (negative billing_variance_pct)
        if billing_status == "overbilled" and billing_variance_pct is not None:
            issues.append((3, billing_variance_pct, {  # lower pct = worse = sorts first
                "type": "overbilled",
                "sov_id": sov_id,
                "sov_name": name or "Untitled SOV",
                "message": f"Overbilled by {abs(round(billing_variance_pct * 100, 1))}% "
                           f"— billed exceeds earned value, review pay application",
            }))

        # 4. Underbilled by > 10%
        if billing_status == "underbilled" and billing_variance_pct is not None and billing_variance_pct > 0.10:
            issues.append((4, -billing_variance_pct, {  # higher pct = worse = sorts first
                "type": "underbilled",
                "sov_id": sov_id,
                "sov_name": name or "Untitled SOV",
                "message": f"Underbilled by {round(billing_variance_pct * 100, 1)}% "
                           f"— cash flow at risk, submit pay application",
            }))

        # 5. Nonzero cost impact
        if cost_impact != 0:
            issues.append((5, -abs(cost_impact), {
                "type": "cost_impact",
                "sov_id": sov_id,
                "sov_name": name or "Untitled SOV",
                "message": f"${abs(cost_impact):,.0f} cost impact from change orders — "
                           "verify balance reflects adjusted contract value",
            }))

    issues.sort(key=lambda x: (x[0], x[1]))
    return [item for _, _, item in issues[:5]]


def sov_portfolio_summary(sov_list: list[dict]) -> dict:
    """
    Portfolio-level SOV totals. Returns combined plus master/sub split.
    """
    def _sum(items: list[dict], key: str) -> float:
        return round(sum(_to_f(i.get(key)) for i in items), 2)

    def _summarize(items: list[dict]) -> dict:
        total_contract = _sum(items, "contract_amount")
        total_earned = _sum(items, "earned_to_date")
        total_billed = _sum(items, "billed_to_date")
        underbilled_items = [i for i in items if i.get("billing_status") == "underbilled"]
        overbilled_items = [i for i in items if i.get("billing_status") == "overbilled"]
        return {
            "total_contract_value": total_contract,
            "total_earned": total_earned,
            "total_billed": total_billed,
            "total_underbilled": round(sum(max(0.0, _to_f(i.get("billing_variance"))) for i in underbilled_items), 2),
            "total_overbilled": round(sum(abs(min(0.0, _to_f(i.get("billing_variance")))) for i in overbilled_items), 2),
            "count_missing_dates": sum(
                1 for i in items
                if _to_f(i.get("pct_complete")) > 0 and (not i.get("sov_start_date") or not i.get("sov_end_date"))
            ),
            "count_pending_approval": sum(
                1 for i in items
                if (i.get("sov_status") or "draft") not in ("approved",)
            ),
        }

    master = [s for s in sov_list if (s.get("sov_type") or "subcontractor") == "master"]
    subs = [s for s in sov_list if (s.get("sov_type") or "subcontractor") != "master"]

    return {
        "combined": _summarize(sov_list),
        "master": _summarize(master),
        "subcontractors": _summarize(subs),
    }
