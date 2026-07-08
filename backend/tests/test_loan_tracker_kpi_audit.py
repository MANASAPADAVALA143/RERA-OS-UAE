"""Tests for Loan Tracker KPI audit — mirrors RentalLoanTracker.tsx formulas."""
from services.loan_tracker_kpi_audit import compute_loan_tracker_kpis


def _loan(**kw) -> dict:
    base = {
        "company_name": "Test LLC",
        "property_name": "Building A",
        "loan_bank_name": "Chase",
        "loan_amount": 100_000.0,
        "loan_balance_as_of": None,
        "loan_interest_rate": None,
        "loan_emi": None,
        "loan_maturity_date": None,
        "noi_annual": None,
        "current_property_value": None,
    }
    base.update(kw)
    return base


def test_portfolio_emi_and_weighted_rate():
    loans = [
        _loan(loan_balance_as_of=1_000_000, loan_interest_rate=0.06, loan_emi=5_000),
        _loan(property_name="B", loan_balance_as_of=500_000, loan_interest_rate=0.04, loan_emi=2_500),
    ]
    k = compute_loan_tracker_kpis(loans)
    assert k["portfolio"] == 1_500_000
    assert k["emi"] == 7_500
    # (1M*0.06 + 500K*0.04) / 1.5M = 0.05333...
    assert abs(k["w_avg"] - 0.0533333333) < 1e-6


def test_balance_falls_back_to_loan_amount():
    loans = [_loan(loan_amount=250_000)]
    k = compute_loan_tracker_kpis(loans)
    assert k["portfolio"] == 250_000


def test_portfolio_dscr():
    loans = [
        _loan(loan_balance_as_of=1_000_000, loan_emi=10_000, noi_annual=150_000),
        _loan(property_name="B", loan_balance_as_of=500_000, loan_emi=5_000, noi_annual=50_000),
    ]
    k = compute_loan_tracker_kpis(loans)
    # NOI 200k / debt service (15k*12=180k)
    assert k["total_noi"] == 200_000
    assert k["total_debt_service"] == 180_000
    assert abs(k["portfolio_dscr"] - 200_000 / 180_000) < 1e-6


def test_avg_ltv_and_concentration():
    loans = [
        _loan(
            loan_balance_as_of=800_000,
            current_property_value=1_000_000,
            loan_bank_name="Bank A",
            property_name="Tower 1",
        ),
        _loan(
            property_name="Tower 2",
            loan_balance_as_of=200_000,
            current_property_value=400_000,
            loan_bank_name="Bank B",
        ),
    ]
    k = compute_loan_tracker_kpis(loans)
    assert k["avg_ltv"] == 65.0  # (80% + 50%) / 2
    assert k["top_building"] == "Tower 1"
    assert k["top_building_pct"] == 80.0
    assert k["top_lender_pct"] == 80.0
