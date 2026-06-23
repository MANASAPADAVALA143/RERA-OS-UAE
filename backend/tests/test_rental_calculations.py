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
