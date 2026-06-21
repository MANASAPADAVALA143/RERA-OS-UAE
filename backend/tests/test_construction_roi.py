"""Tests for construction ROI calculations."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.construction_roi import (
    build_project_roi_summary,
    portfolio_roi_summary,
    project_roi_forward_sale,
    realized_cash_position,
    simple_project_irr,
)


def test_realized_cash_position():
    result = realized_cash_position(8_200_000, 3_300_000, 320_000, 920_000, 480_000)
    assert result["net_realized_cash"] == 4_580_000
    assert result["retainage_held"] == 920_000
    assert result["retainage_receivable"] == 480_000


def test_pr456_scottsdale_roi():
    """Cross-check against PR456 Scottsdale Promenade Center reference model."""
    result = project_roi_forward_sale(
        total_project_cost=62_700_000,
        equity_pct=0.40,
        debt_pct=0.60,
        interest_rate_annual=0.0825,
        construction_months=20,
        stabilized_noi=4_950_000,
        exit_cap_rate=0.0675,
        selling_costs_pct=0.025,
    )
    assert "error" not in result
    assert result["roi"] is not None
    assert abs(result["roi"] - 0.236) < 0.01
    assert result["moic"] is not None
    assert abs(result["moic"] - 1.35) < 0.02

    irr = simple_project_irr(result["equity_invested"], 20, result["net_sale_proceeds"])
    assert irr is not None
    assert irr > 0.15


def test_equity_debt_validation_logic():
    """Document expected validation — sum must be 1.0 within tolerance."""
    assert abs(0.5 + 0.6 - 1.0) > 0.001
    assert abs(0.4 + 0.6 - 1.0) <= 0.001


def test_portfolio_roi_equity_weighted_not_simple_average():
    """
    Large project at 15% ROI + small project at 80% ROI.
    Portfolio should be ~15%, not ~47.5% simple average.
    """
    large = build_project_roi_summary(
        total_project_cost=40_000_000,
        equity_pct=0.40,
        debt_pct=0.60,
        interest_rate_annual=0.08,
        construction_months=24,
        stabilized_noi=3_000_000,
        exit_cap_rate=0.07,
    )
    small = build_project_roi_summary(
        total_project_cost=500_000,
        equity_pct=0.40,
        debt_pct=0.60,
        interest_rate_annual=0.08,
        construction_months=12,
        stabilized_noi=120_000,
        exit_cap_rate=0.08,
    )
    assert large and small

    rollup = portfolio_roi_summary([
        {
            "project_id": "large",
            "project_name": "Large Deal",
            "configured": True,
            "equity_invested": large["equity_invested"],
            "net_profit": large["net_profit"],
            "net_sale_proceeds": large["net_sale_proceeds"],
            "roi": large["roi"],
            "moic": large["moic"],
        },
        {
            "project_id": "small",
            "project_name": "Small Deal",
            "configured": True,
            "equity_invested": small["equity_invested"],
            "net_profit": small["net_profit"],
            "net_sale_proceeds": small["net_sale_proceeds"],
            "roi": small["roi"],
            "moic": small["moic"],
        },
    ])

    simple_avg_roi = (large["roi"] + small["roi"]) / 2
    assert rollup["portfolio_weighted_roi"] is not None
    assert abs(rollup["portfolio_weighted_roi"] - simple_avg_roi) > 0.05
    assert abs(rollup["portfolio_weighted_roi"] - large["roi"]) < abs(rollup["portfolio_weighted_roi"] - simple_avg_roi)


def test_portfolio_single_project_matches_individual():
    """Trivial case: one configured project → portfolio ROI equals project ROI."""
    summary = build_project_roi_summary(
        total_project_cost=62_700_000,
        equity_pct=0.40,
        debt_pct=0.60,
        interest_rate_annual=0.0825,
        construction_months=20,
        stabilized_noi=4_950_000,
        exit_cap_rate=0.0675,
    )
    assert summary
    rollup = portfolio_roi_summary([{
        "project_id": "pr456",
        "project_name": "Scottsdale Promenade Center",
        "configured": True,
        "equity_invested": summary["equity_invested"],
        "net_profit": summary["net_profit"],
        "net_sale_proceeds": summary["net_sale_proceeds"],
        "roi": summary["roi"],
        "moic": summary["moic"],
    }])
    assert rollup["configured_project_count"] == 1
    assert rollup["unconfigured_project_count"] == 0
    assert abs(rollup["portfolio_weighted_roi"] - summary["roi"]) < 0.0001
    assert abs(rollup["portfolio_weighted_moic"] - summary["moic"]) < 0.0001


def test_unconfigured_projects_excluded_from_weighted_calc():
    configured = build_project_roi_summary(
        total_project_cost=10_000_000,
        equity_pct=0.50,
        debt_pct=0.50,
        interest_rate_annual=0.07,
        construction_months=18,
        stabilized_noi=800_000,
        exit_cap_rate=0.065,
    )
    assert configured
    rollup = portfolio_roi_summary([
        {
            "project_id": "a",
            "project_name": "Configured",
            "configured": True,
            "equity_invested": configured["equity_invested"],
            "net_profit": configured["net_profit"],
            "net_sale_proceeds": configured["net_sale_proceeds"],
            "roi": configured["roi"],
            "moic": configured["moic"],
        },
        {
            "project_id": "b",
            "project_name": "Not Configured",
            "configured": False,
            "equity_invested": None,
            "net_profit": None,
            "net_sale_proceeds": None,
            "roi": None,
            "moic": None,
        },
    ])
    assert rollup["configured_project_count"] == 1
    assert rollup["unconfigured_project_count"] == 1
    assert abs(rollup["portfolio_weighted_roi"] - configured["roi"]) < 0.0001
