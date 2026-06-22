"""Pure AR/AP calculation functions — no DB access."""
from __future__ import annotations


def _f(v) -> float:
    if v is None:
        return 0.0
    return float(v)


def ar_total(receivable: dict) -> float:
    return round(sum(_f(receivable.get(k, 0)) for k in (
        "current_amount", "days_1_30", "days_31_60", "days_61_90", "days_90_plus"
    )), 2)


def ap_total(payable: dict) -> float:
    return round(sum(_f(payable.get(k, 0)) for k in (
        "current_amount", "days_1_30", "days_31_60", "days_60_plus"
    )), 2)


def net_working_capital(total_ar: float, total_ap: float) -> float:
    return round(total_ar - total_ap, 2)


def rent_past_due_pct(ar_record: dict, monthly_gpr: float) -> float | None:
    """
    (AR past-current buckets) / monthly GPR.
    Matches source workbook's 'Rent past due (% of monthly)' metric.
    Returns None if GPR is 0.
    """
    if monthly_gpr == 0:
        return None
    past_due = sum(_f(ar_record.get(k, 0)) for k in (
        "days_1_30", "days_31_60", "days_61_90", "days_90_plus"
    ))
    return round(past_due / monthly_gpr, 4)
