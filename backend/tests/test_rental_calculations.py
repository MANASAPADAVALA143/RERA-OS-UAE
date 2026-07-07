"""Tests for rental_calculations."""
from services.rental_calculations import company_summary


def _unit(status: str, rent: float = 2000) -> dict:
    return {"status": status, "monthly_rent": rent}


def test_vacant_is_total_minus_occupied():
    units = (
        [_unit("occupied")] * 50
        + [_unit("vacant")] * 5
        + [_unit("notice")] * 3
        + [_unit("reserved")] * 2
    )
    result = company_summary(units, [], [])
    assert result["total_units"] == 60
    assert result["occupied_units"] == 50
    assert result["vacant_units"] == 10
    assert result["occupancy_pct"] == round(50 / 60, 4)


def test_occupancy_pct_zero_when_no_units():
    result = company_summary([], [], [])
    assert result["total_units"] == 0
    assert result["occupied_units"] == 0
    assert result["vacant_units"] == 0
    assert result["occupancy_pct"] == 0.0


def test_income_trend_anchors_to_end_month():
    from services.rental_calculations import income_trend

    inv = [
        {
            "billing_period": "2026-01-01",
            "amount_billed": 1000,
            "collections": [{"collected_date": "2026-01-15", "amount_collected": 900}],
        },
        {
            "billing_period": "2026-06-01",
            "amount_billed": 2000,
            "collections": [{"collected_date": "2026-06-15", "amount_collected": 1800}],
        },
    ]
    trend = income_trend(inv, [], months=6, end_month="2026-03")
    assert [t["month"] for t in trend] == [
        "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ]
    assert trend[-1]["collected"] == 0.0
    assert trend[3]["collected"] == 900.0
