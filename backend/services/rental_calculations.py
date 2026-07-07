"""Pure rental calculation functions — no DB access."""
from __future__ import annotations
from datetime import date, timedelta
from collections import defaultdict


def _f(v) -> float:
    if v is None:
        return 0.0
    return float(v)


def unit_arrears(invoices: list[dict]) -> float:
    """Sum of max(0, billed - collected) per invoice."""
    total = 0.0
    for inv in invoices:
        collected = sum(_f(c["amount_collected"]) for c in inv.get("collections", []))
        total += max(0.0, _f(inv["amount_billed"]) - collected)
    return round(total, 2)


def days_vacant(status: str, status_changed_at, today: date | None = None) -> int | None:
    today = today or date.today()
    if status != "vacant" or status_changed_at is None:
        return None
    if isinstance(status_changed_at, str):
        status_changed_at = date.fromisoformat(status_changed_at)
    return max(0, (today - status_changed_at).days)


def company_summary(
    units: list[dict],
    invoices_with_collections: list[dict],
    expenses: list[dict],
    today: date | None = None,
    cur_month: str | None = None,
) -> dict:
    today = today or date.today()
    cur_month = cur_month or today.strftime("%Y-%m")

    total = len(units)
    occupied = sum(1 for u in units if u["status"] == "occupied")
    # vacant = all units that are not occupied (notice, reserved, truly vacant, etc.)
    vacant_count = total - occupied
    notice_count = sum(1 for u in units if u["status"] == "notice")
    gross_potential = sum(_f(u["monthly_rent"]) for u in units)
    # vacancy_loss uses only units explicitly marked vacant (not notice/reserved)
    vacancy_loss = sum(_f(u["monthly_rent"]) for u in units if u["status"] == "vacant")

    billed_this_month = sum(
        _f(inv["amount_billed"])
        for inv in invoices_with_collections
        if str(inv.get("billing_period", ""))[:7] == cur_month
    )
    collected_this_month = 0.0
    for inv in invoices_with_collections:
        for col in inv.get("collections", []):
            if str(col.get("collected_date", ""))[:7] == cur_month:
                collected_this_month += _f(col["amount_collected"])

    arrears_total = unit_arrears(invoices_with_collections)
    expense_this_month = sum(
        _f(e["amount"])
        for e in expenses
        if str(e.get("expense_date", ""))[:7] == cur_month
    )
    noi = round(collected_this_month - expense_this_month, 2)

    return {
        "total_units": total,
        "occupied_units": occupied,
        "vacant_units": vacant_count,
        "notice_units": notice_count,
        "occupancy_pct": round(occupied / total, 4) if total else 0.0,
        "gross_potential_rent": round(gross_potential, 2),
        "vacancy_loss": round(vacancy_loss, 2),
        "billed_this_month": round(billed_this_month, 2),
        "collected_this_month": round(collected_this_month, 2),
        "arrears_total": arrears_total,
        "total_expense_this_month": round(expense_this_month, 2),
        "noi_this_month": noi,
    }


def arrears_aging(invoices_with_collections: list[dict], today: date | None = None) -> dict:
    """Age each unpaid invoice independently into buckets based on days overdue.

    Buckets:
    - current: rent due this month but not yet late (0-0 days past due date)
    - 1_30: 1-30 days past the due date
    - 31_60: 31-60 days past the due date
    - 61_90: 61-90 days past the due date
    - 90_plus: 90+ days past the due date

    Due date is assumed to be the 1st of the billing month (e.g., June rent due June 1).
    Each unpaid month ages independently — May and June unpaid balances are bucketed separately.
    """
    today = today or date.today()
    buckets: dict[str, float] = {"current": 0.0, "1_30": 0.0, "31_60": 0.0, "61_90": 0.0, "90_plus": 0.0}

    for inv in invoices_with_collections:
        collected = sum(_f(c["amount_collected"]) for c in inv.get("collections", []))
        owed = max(0.0, _f(inv["amount_billed"]) - collected)
        if owed <= 0:
            continue

        try:
            bp_str = str(inv.get("billing_period", ""))
            bp = date.fromisoformat(bp_str) if bp_str else None
        except (ValueError, TypeError):
            bp = None
        if not bp:
            continue

        due_date = bp.replace(day=1)
        days_past_due = (today - due_date).days

        if days_past_due <= 0:
            buckets["current"] += owed
        elif days_past_due <= 30:
            buckets["1_30"] += owed
        elif days_past_due <= 60:
            buckets["31_60"] += owed
        elif days_past_due <= 90:
            buckets["61_90"] += owed
        else:
            buckets["90_plus"] += owed

    return {k: round(v, 2) for k, v in buckets.items()}


def lease_expiry_pipeline(leases: list[dict], today: date | None = None, window_days: int = 90) -> list[dict]:
    today = today or date.today()
    cutoff = today + timedelta(days=window_days)
    result = []
    for lse in leases:
        try:
            le = date.fromisoformat(str(lse["lease_end"]))
        except (TypeError, ValueError):
            continue
        if today <= le <= cutoff:
            result.append({**lse, "days_until_expiry": (le - today).days})
    return sorted(result, key=lambda x: x["days_until_expiry"])


def distribute_to_partners(noi: float, ownership_rows: list[dict]) -> list[dict]:
    is_shortfall = noi < 0
    return [
        {
            "partner_name": row["partner_name"],
            "ownership_pct": _f(row["ownership_pct"]),
            "role": row.get("role"),
            "noi_share": round(noi * _f(row["ownership_pct"]), 2),
            "is_shortfall": is_shortfall,
        }
        for row in ownership_rows
    ]


def income_trend(
    invoices_with_collections: list[dict],
    expenses: list[dict],
    months: int = 6,
    end_month: str | None = None,
) -> list[dict]:
    billed_by: dict[str, float] = defaultdict(float)
    collected_by: dict[str, float] = defaultdict(float)
    expense_by: dict[str, float] = defaultdict(float)

    for inv in invoices_with_collections:
        bp = str(inv.get("billing_period", ""))[:7]
        if not bp:
            continue
        billed_by[bp] += _f(inv["amount_billed"])
        for col in inv.get("collections", []):
            cm = str(col.get("collected_date", ""))[:7]
            if cm:
                collected_by[cm] += _f(col["amount_collected"])

    for exp in expenses:
        m = str(exp.get("expense_date", ""))[:7]
        if m:
            expense_by[m] += _f(exp["amount"])

    if end_month:
        try:
            y, mo = int(end_month[:4]), int(end_month[5:7])
            cursor = date(y, mo, 1)
        except (ValueError, IndexError):
            cursor = date.today().replace(day=1)
        month_keys: list[str] = []
        d = cursor
        for _ in range(months):
            month_keys.append(d.strftime("%Y-%m"))
            d = date(d.year - 1, 12, 1) if d.month == 1 else date(d.year, d.month - 1, 1)
        month_keys.reverse()
        all_months = month_keys
    else:
        all_months = sorted(set(list(billed_by.keys()) + list(expense_by.keys())))[-months:]
    return [
        {
            "month": m,
            "billed": round(billed_by.get(m, 0.0), 2),
            "collected": round(collected_by.get(m, 0.0), 2),
            "expense": round(expense_by.get(m, 0.0), 2),
            "noi": round(collected_by.get(m, 0.0) - expense_by.get(m, 0.0), 2),
        }
        for m in all_months
    ]
