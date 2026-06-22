"""Maintenance calculation functions — no DB access."""
from __future__ import annotations
from datetime import date, timedelta
from collections import defaultdict

# SLA targets in days — defined once so tenant-level config can override later
SLA_DAYS: dict[str, int] = {
    "emergency": 1,
    "high": 3,
    "medium": 7,
    "low": 14,
}


def maintenance_sla_status(
    priority: str,
    reported_date,
    target_completion_date,
    status: str,
    today: date | None = None,
) -> dict:
    today = today or date.today()
    if isinstance(reported_date, str):
        reported_date = date.fromisoformat(reported_date)
    days_open = (today - reported_date).days if reported_date else 0
    sla_target = SLA_DAYS.get(priority, 7)

    if status in ("completed", "closed"):
        return {
            "days_open": days_open,
            "is_overdue": False,
            "sla_status": "closed",
            "sla_target_days": sla_target,
        }

    deadline = reported_date + timedelta(days=sla_target) if reported_date else None
    is_overdue = deadline is not None and today > deadline
    at_risk = not is_overdue and deadline is not None and (deadline - today).days <= 1
    sla_label = "overdue" if is_overdue else ("at_risk" if at_risk else "on_time")

    return {
        "days_open": days_open,
        "is_overdue": is_overdue,
        "sla_status": sla_label,
        "sla_target_days": sla_target,
    }


def maintenance_summary(requests: list[dict], today: date | None = None) -> dict:
    today = today or date.today()
    cur_month = today.strftime("%Y-%m")

    open_count = sum(1 for r in requests if r["status"] == "open")
    in_progress_count = sum(1 for r in requests if r["status"] == "in_progress")
    overdue_count = sum(1 for r in requests if r.get("sla_status") == "overdue")

    completed = [
        r for r in requests
        if r["status"] in ("completed", "closed") and r.get("actual_completion_date")
    ]
    total_days = 0
    for r in completed:
        try:
            rd = date.fromisoformat(str(r["reported_date"]))
            cd = date.fromisoformat(str(r["actual_completion_date"]))
            total_days += (cd - rd).days
        except (TypeError, ValueError):
            pass
    avg_days_to_close = round(total_days / len(completed), 1) if completed else 0.0

    cost_this_month = sum(
        float(r.get("cost") or 0)
        for r in requests
        if r.get("actual_completion_date") and str(r["actual_completion_date"])[:7] == cur_month
    )

    unit_cat: dict = defaultdict(list)
    cutoff = today - timedelta(days=90)
    for r in requests:
        try:
            rd = date.fromisoformat(str(r["reported_date"]))
        except (TypeError, ValueError):
            continue
        if rd >= cutoff:
            key = (r.get("unit_id"), r.get("category"))
            unit_cat[key].append(r)

    repeat_issues = [
        {
            "unit_id": key[0],
            "unit_number": items[0].get("unit_number"),
            "category": key[1],
            "count": len(items),
        }
        for key, items in unit_cat.items()
        if len(items) >= 2
    ]

    return {
        "open_count": open_count,
        "in_progress_count": in_progress_count,
        "overdue_count": overdue_count,
        "avg_days_to_close": avg_days_to_close,
        "cost_this_month": round(cost_this_month, 2),
        "repeat_issues": repeat_issues,
    }
