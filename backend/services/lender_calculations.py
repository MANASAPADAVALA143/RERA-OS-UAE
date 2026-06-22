"""Shared DSCR/LTV calculations — used by Loan Tracker (Construction + Rental)."""
from __future__ import annotations


def dscr(noi_annual: float | None, annual_debt_service: float | None) -> float | None:
    """DSCR = NOI / annual debt service. Returns None if either value is missing or debt service is 0."""
    if noi_annual is None or annual_debt_service is None:
        return None
    if annual_debt_service == 0:
        return None
    return round(noi_annual / annual_debt_service, 4)


def ltv_current(loan_balance: float | None, current_property_value: float | None) -> float | None:
    """Current LTV = outstanding balance / current property value. Returns None if value is 0 or missing."""
    if loan_balance is None or current_property_value is None:
        return None
    if current_property_value == 0:
        return None
    return round(loan_balance / current_property_value, 4)


def dscr_status(dscr_value: float | None, covenant_min: float = 1.20) -> str | None:
    """'below_covenant' if dscr < covenant_min, else 'healthy'. None if no DSCR data."""
    if dscr_value is None:
        return None
    return "below_covenant" if dscr_value < covenant_min else "healthy"
