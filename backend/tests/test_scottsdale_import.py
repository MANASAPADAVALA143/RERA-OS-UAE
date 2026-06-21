"""Verify PR456 Scottsdale import transform and ROI assertions."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.scottsdale_import import (
    EXPECTED_MOIC,
    EXPECTED_ROI,
    SOV_TOTAL_EXPECTED,
    derive_pct_complete,
    derive_schedule_status,
    load_raw_package,
    prepare_seed_from_raw,
    transform_raw_to_seed,
    verify_seed_data,
)


def test_pr456_sov_total():
    seed = prepare_seed_from_raw()
    assert seed["project_master"]["contract_value"] == SOV_TOTAL_EXPECTED
    assert seed["project_master"]["total_project_cost"] == 62_732_000
    assert seed["project_master"]["address"] == "8350 E Raintree Dr"
    assert seed["project_master"]["contract_value"] != seed["project_master"]["total_project_cost"]


def test_pr456_roi_recompute_matches_reference():
    seed = prepare_seed_from_raw()
    checks = verify_seed_data(seed, expected_roi=EXPECTED_ROI, expected_moic=EXPECTED_MOIC)
    assert abs(checks["roi"] - EXPECTED_ROI) < 0.005
    assert abs(checks["moic"] - EXPECTED_MOIC) < 0.005


def test_pr456_seventeen_divisions_valid_trade_names():
    raw = load_raw_package()
    seed = transform_raw_to_seed(raw)
    assert len(seed["divisions"]) == 17
    from models.real_estate.construction_cost import TradeName
    for div in seed["divisions"]:
        TradeName(div["trade_name"])
        assert div["budgeted_cost"] > 0


def test_schedule_derivation():
    complete = {
        "actual_start": "2026-01-10",
        "actual_end": "2026-01-25",
        "days_late": 0,
    }
    assert derive_schedule_status(complete) == "complete"
    assert derive_pct_complete(complete) == 1.0

    late = {"actual_start": None, "actual_end": None, "days_late": 31}
    assert derive_schedule_status(late) == "late"
    assert derive_pct_complete(late) == 0.0

    in_progress = {"actual_start": "2026-05-22", "actual_end": None, "days_late": 12}
    assert derive_schedule_status(in_progress) == "late"
    assert derive_pct_complete(in_progress) == 0.5


def test_financial_snapshot_inputs_only():
    seed = prepare_seed_from_raw()
    assert len(seed["financial_snapshots"]) == 1
    snap = seed["financial_snapshots"][0]
    assert snap["paid_to_subcontractors"] > 0
    assert "net_realized_cash" not in snap
