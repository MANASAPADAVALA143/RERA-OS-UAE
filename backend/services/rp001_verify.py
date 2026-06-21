"""RP001 Desert Vista — canonical verification targets (bottom-up opex)."""
from __future__ import annotations

from pathlib import Path

import json

from services.reit_calculations import financial_strength, property_occupancy, property_pl_summary

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "desert_vista_rp001.json"

EXPECTED_EGI = 8_300
EXPECTED_OPEX = 6_118
EXPECTED_NOI = 2_182
EXPECTED_DEBT_SERVICE = 3_955.00  # 3355.58 + 599.42
EXPECTED_CFADS = -1_773
EXPECTED_DSCR = 0.5517  # NOI / debt service
EXPECTED_OCCUPIED = 4
EXPECTED_TOTAL_UNITS = 6
TOLERANCE_MONEY = 1.0
TOLERANCE_RATIO = 0.005


def load_rp001_data() -> dict:
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)


def rp001_calculation_context(data: dict | None = None) -> tuple[list, list, dict, dict]:
    data = data or load_rp001_data()
    units = data["units"]
    unit_dicts = [
        {"market_rent": u["market_rent"], "actual_rent": u.get("actual_rent"), "status": u["status"]}
        for u in units
    ]
    opex = [
        {"category": l["category"], "sub_head": l["sub_head"], "monthly_amount": l["monthly_amount"]}
        for l in data["operating_expenses"]
    ]
    loan = data["loan"]
    prop = {
        "current_market_value_estimate": data.get("current_market_value_estimate"),
        "acquisition_price": data.get("acquisition_price"),
    }
    return unit_dicts, opex, loan, prop


def verify_rp001_metrics(*, raise_on_fail: bool = True) -> dict:
    """
    Assert RP001 P&L metrics from the 13-line opex breakdown (total $6,118/mo).
    NOI = EGI $8,300 − opex $6,118 = $2,182 (bottom-up canonical target).
    """
    data = load_rp001_data()
    unit_dicts, opex, loan, prop = rp001_calculation_context(data)

    opex_total = sum(r["monthly_amount"] for r in opex)
    occ = property_occupancy(unit_dicts)
    pl = property_pl_summary(unit_dicts, opex, loan)
    strength = financial_strength(prop, pl["net_operating_income"], loan)

    errors = []
    if opex_total != EXPECTED_OPEX:
        errors.append(f"opex total {opex_total} != {EXPECTED_OPEX}")
    if abs(pl["effective_gross_income"] - EXPECTED_EGI) > TOLERANCE_MONEY:
        errors.append(f"EGI {pl['effective_gross_income']} != {EXPECTED_EGI}")
    if abs(pl["net_operating_income"] - EXPECTED_NOI) > TOLERANCE_MONEY:
        errors.append(f"NOI {pl['net_operating_income']} != {EXPECTED_NOI}")
    if abs(pl["cash_flow_after_debt_service"] - EXPECTED_CFADS) > TOLERANCE_MONEY:
        errors.append(f"CFADS {pl['cash_flow_after_debt_service']} != {EXPECTED_CFADS}")
    if strength["dscr"] is None or abs(strength["dscr"] - EXPECTED_DSCR) > TOLERANCE_RATIO:
        errors.append(f"DSCR {strength['dscr']} != ~{EXPECTED_DSCR}")
    if strength["dscr_status"] != "below_covenant":
        errors.append(f"dscr_status {strength['dscr_status']} != below_covenant")
    if occ["occupied_units"] != EXPECTED_OCCUPIED or occ["total_units"] != EXPECTED_TOTAL_UNITS:
        errors.append(f"occupancy {occ['occupied_units']}/{occ['total_units']} != 4/6")

    result = {
        "opex_total": opex_total,
        "egi": pl["effective_gross_income"],
        "noi": pl["net_operating_income"],
        "cfads": pl["cash_flow_after_debt_service"],
        "dscr": strength["dscr"],
        "dscr_status": strength["dscr_status"],
        "occupancy_pct": occ["occupancy_pct"],
        "occupied_units": occ["occupied_units"],
        "total_units": occ["total_units"],
    }

    if errors and raise_on_fail:
        raise ValueError("RP001 verification failed:\n  " + "\n  ".join(errors))

    result["ok"] = not errors
    result["errors"] = errors
    return result
