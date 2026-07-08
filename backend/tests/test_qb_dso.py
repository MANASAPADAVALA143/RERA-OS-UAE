"""Tests for QB AR Aging DSO — credit balances excluded portfolio-wide."""
from services.qb_dso import (
    credit_balance_from_buckets,
    estimate_dso_from_buckets,
    positive_ar_total,
)


def _totals(**kwargs):
    base = {
        "current": 0.0,
        "days_1_30": 0.0,
        "days_31_60": 0.0,
        "days_61_90": 0.0,
        "days_91_plus": 0.0,
    }
    base.update(kwargs)
    base["total"] = sum(base[k] for k in base if k != "total")
    return base


def test_normal_dso_unchanged():
    t = _totals(current=5000, days_1_30=3000)
    assert estimate_dso_from_buckets(t) == 5.6
    assert credit_balance_from_buckets(t) == 0.0
    assert positive_ar_total(t) == 8000.0


def test_credit_in_bucket_excluded_from_dso():
    """VR Estates-style case: large negative current would yield negative DSO before fix."""
    t = _totals(current=-8000, days_1_30=2000, days_31_60=1500)
    assert credit_balance_from_buckets(t) == 8000.0
    assert positive_ar_total(t) == 3500.0
    # (2000*15 + 1500*45) / 3500 = 27.86 → 27.9
    assert estimate_dso_from_buckets(t) == 27.9
    dso = estimate_dso_from_buckets(t)
    assert dso is not None and dso >= 0


def test_all_ar_is_credit_returns_none_dso():
    t = _totals(current=-500, days_1_30=-200)
    assert credit_balance_from_buckets(t) == 700.0
    assert positive_ar_total(t) == 0.0
    assert estimate_dso_from_buckets(t) is None


def test_mixed_credits_and_overdue_buckets():
    t = _totals(current=-1000, days_61_90=4000, days_91_plus=2000)
    assert credit_balance_from_buckets(t) == 1000.0
    assert positive_ar_total(t) == 6000.0
    # (4000*75 + 2000*105) / 6000 = 85
    assert estimate_dso_from_buckets(t) == 85.0


def test_negative_dso_scenario_corrected():
    """Reproduces portfolio bug: net-negative total produced negative DSO (e.g. -159 days)."""
    t = _totals(current=-15000, days_1_30=3000, days_31_60=2000, days_61_90=500)
    raw_total = t["total"]
    assert raw_total < 0
    # Old formula would use raw_total in denominator → negative DSO
    old_weighted = (
        t["current"] * 0 + t["days_1_30"] * 15 + t["days_31_60"] * 45
        + t["days_61_90"] * 75
    ) / raw_total
    assert old_weighted < 0
    # New formula: credits excluded
    dso = estimate_dso_from_buckets(t)
    assert dso is not None
    assert dso >= 0
    assert credit_balance_from_buckets(t) == 15000.0
