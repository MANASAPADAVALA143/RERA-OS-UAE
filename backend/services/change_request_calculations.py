"""
Change Request (CR) calculation functions.

Legacy fallback rule: if a ChangeOrder has no task_lines (created before this
section existed), net_cost_impact falls back to the CR's single approved_amount
or requested_amount field so historical records never silently show $0.
"""


def _to_f(v) -> float:
    if v is None:
        return 0.0
    return float(v)


def change_order_line_revised_value(original_value: float, cost_impact: float) -> float:
    """Revised Sched. Value = original + cost impact."""
    return _to_f(original_value) + _to_f(cost_impact)


def change_order_net_cost_impact(task_lines: list, legacy_amount: float | None = None) -> float:
    """
    Sum of cost_impact across task lines for one CR.
    Falls back to legacy_amount when task_lines is empty, so pre-existing
    ChangeOrder records (with no task lines) keep their original dollar value.
    """
    if not task_lines:
        return _to_f(legacy_amount)
    return sum(_to_f(getattr(line, "cost_impact", None) if hasattr(line, "cost_impact") else line.get("cost_impact")) for line in task_lines)


def change_order_net_schedule_impact(task_lines: list) -> int:
    """Net schedule impact in days across all task lines (can be negative)."""
    return sum(
        int(getattr(line, "schedule_impact_days", None) or line.get("schedule_impact_days") or 0)
        for line in task_lines
    )


def change_order_list_summary(cr_rows: list[dict]) -> dict:
    """
    Portfolio-level CR summary for the list/landing view.
    Each cr_row must already have net_cost_impact pre-computed
    (using the legacy-fallback rule above).
    """
    pending_statuses = {"submitted", "pending_approval", "draft"}
    total_pending = sum(
        _to_f(r.get("net_cost_impact"))
        for r in cr_rows
        if r.get("status") in pending_statuses
    )
    total_approved = sum(
        _to_f(r.get("net_cost_impact"))
        for r in cr_rows
        if r.get("status") == "approved"
    )
    open_count = sum(1 for r in cr_rows if r.get("status") not in ("approved", "rejected"))
    missing_due_date = sum(1 for r in cr_rows if not r.get("due_date"))

    count_by_status: dict[str, int] = {}
    for r in cr_rows:
        s = r.get("status", "unknown")
        count_by_status[s] = count_by_status.get(s, 0) + 1

    return {
        "total_pending_cost_impact": round(total_pending, 2),
        "total_approved_cost_impact": round(total_approved, 2),
        "open_count": open_count,
        "missing_due_date": missing_due_date,
        "count_by_status": count_by_status,
        "total_count": len(cr_rows),
    }
