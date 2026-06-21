"""RP001 Desert Vista — opex breakdown and P&L verification."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.rp001_verify import (
    EXPECTED_CFADS,
    EXPECTED_NOI,
    EXPECTED_OPEX,
    EXPECTED_DSCR,
    load_rp001_data,
    verify_rp001_metrics,
)


def test_rp001_opex_thirteen_lines_sum_to_6118():
    data = load_rp001_data()
    assert len(data["operating_expenses"]) == 13
    total = sum(l["monthly_amount"] for l in data["operating_expenses"])
    assert total == EXPECTED_OPEX


def test_rp001_noi_cfads_dscr_from_bottom_up_opex():
    result = verify_rp001_metrics()
    assert result["noi"] == EXPECTED_NOI
    assert result["cfads"] == EXPECTED_CFADS
    assert abs(result["dscr"] - EXPECTED_DSCR) < 0.005
    assert result["dscr_status"] == "below_covenant"
    assert result["occupied_units"] == 4
    assert result["total_units"] == 6
