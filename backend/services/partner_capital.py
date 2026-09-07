"""Resolve partner Capital Contributed vs Cost Basis (equity vs acquisition cost)."""
from __future__ import annotations


def resolve_capital_contributed(
    *,
    explicit: float | None,
    cost_basis: float | None,
    existing_debt: float | None,
    book_value: float | None = None,
) -> tuple[float, bool]:
    """
    Return (capital_contributed, is_estimated).

    - Explicit Capital Contributed column → exact figure (not estimated).
    - Else estimate equity portion: Cost Basis − Existing Debt (≥ 0).
    - If no cost basis, fall back to 0 (not book value — book is current value, not cash in).
    """
    if explicit is not None and explicit > 0:
        return round(float(explicit), 2), False

    cb = float(cost_basis or 0)
    if cb <= 0:
        return 0.0, False

    debt = float(existing_debt or 0)
    estimated = max(0.0, cb - debt)
    return round(estimated, 2), True
