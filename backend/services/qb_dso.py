"""QB AR Aging — DSO and credit-balance helpers (portfolio-wide)."""
from __future__ import annotations

BUCKET_KEYS = ("current", "days_1_30", "days_31_60", "days_61_90", "days_91_plus")
BUCKET_WEIGHTS = (0, 15, 45, 75, 105)


def _bucket_values(totals: dict) -> list[float]:
    return [float(totals.get(k, 0) or 0) for k in BUCKET_KEYS]


def credit_balance_from_buckets(totals: dict) -> float:
    """Sum of absolute values of negative bucket amounts (overpayments / credits)."""
    return round(sum(abs(v) for v in _bucket_values(totals) if v < 0), 2)


def positive_bucket_values(totals: dict) -> list[float]:
    """Zero-floor each bucket — credits excluded from DSO weighting."""
    return [max(0.0, v) for v in _bucket_values(totals)]


def positive_ar_total(totals: dict) -> float:
    """Outstanding AR used as DSO denominator (positive buckets only)."""
    return round(sum(positive_bucket_values(totals)), 2)


def estimate_dso_from_buckets(totals: dict) -> float | None:
    """
    Weighted DSO from QB aging buckets.
    Negative bucket values are excluded (treated as $0) — never blended into days overdue.
    Returns None when no positive outstanding AR remains after zero-flooring.
    """
    pos = positive_bucket_values(totals)
    total_pos = sum(pos)
    if total_pos <= 0:
        return None
    weighted = sum(p * w for p, w in zip(pos, BUCKET_WEIGHTS)) / total_pos
    return round(weighted, 1)
