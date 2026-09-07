"""
Sale P&L computed totals + the actual-over-provisional view logic for the
Partner ROI tab. See models/propdev/sale_pnl.py for the row schema and the
provisional/actual design rationale.

Computed fields (total_expenses_excl_land_comm_mgmt, total_expenses_excl_land,
total_expenses, net_profit_loss, net_profit_ratio) are deliberately NOT stored
as DB-generated columns: this repo's test suite runs against in-memory SQLite
(see tests/test_propdev_*_trigger.py), and Postgres GENERATED ALWAYS AS columns
don't have a portable SQLite equivalent. Computing them here keeps one formula
in one place regardless of which DB is behind it, at the cost of the caller
needing to call compute_sale_pnl_totals() rather than reading a column.
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from models.propdev.sale_pnl import PropDevSalePnl


@dataclass
class SalePnlTotals:
    total_expenses_excl_land_comm_mgmt: float
    management_fee_amount: float
    total_expenses_excl_land: float
    total_expenses: float
    net_profit_loss: float
    net_profit_ratio: float | None  # None when sale_consideration <= 0


def compute_sale_pnl_totals(row: PropDevSalePnl) -> SalePnlTotals:
    dev_expenses = (
        float(row.hard_cost)
        + float(row.soft_cost)
        + float(row.title_company_charges)
        + float(row.other_charges)
        + float(row.property_tax)
        + float(row.loan_processing_charges)
        + float(row.professional_charges)
        + float(row.legal_fees)
        + float(row.interest_on_mortgage_loan)
    )
    # Management Fee base is Land Cost + Hard Cost + Soft Cost, NOT the full
    # itemized dev-expense sum above -- verified against the ABC Ventures LLC
    # reference P&L (9% x (land + hard + soft) = $517,793.84, which is what
    # reproduces that P&L's $910,059.33 Net Profit; 9% of the full dev_expenses
    # total above would give a different, wrong figure).
    management_fee_base = float(row.land_cost) + float(row.hard_cost) + float(row.soft_cost)
    management_fee_amount = management_fee_base * float(row.management_fee_pct)
    total_expenses_excl_land = dev_expenses + management_fee_amount + float(row.sale_commission_amount)
    total_expenses = total_expenses_excl_land + float(row.land_cost)
    net_profit_loss = float(row.sale_consideration) - total_expenses
    net_profit_ratio = (
        (net_profit_loss / float(row.sale_consideration)) * 100
        if float(row.sale_consideration) > 0
        else None
    )
    return SalePnlTotals(
        total_expenses_excl_land_comm_mgmt=dev_expenses,
        management_fee_amount=management_fee_amount,
        total_expenses_excl_land=total_expenses_excl_land,
        total_expenses=total_expenses,
        net_profit_loss=net_profit_loss,
        net_profit_ratio=net_profit_ratio,
    )


def get_current_sale_pnl(db: Session, tenant_id, company_id) -> tuple[PropDevSalePnl | None, str | None]:
    """Returns (row, label). Actual row wins if one exists (label "Actual");
    otherwise the most recently created provisional row is used (label
    "Projected"). Never blends the two. (None, None) if neither exists."""
    actual = db.query(PropDevSalePnl).filter(
        PropDevSalePnl.tenant_id == tenant_id,
        PropDevSalePnl.company_id == company_id,
        PropDevSalePnl.status == "actual",
    ).first()
    if actual:
        return actual, "Actual"

    provisional = db.query(PropDevSalePnl).filter(
        PropDevSalePnl.tenant_id == tenant_id,
        PropDevSalePnl.company_id == company_id,
        PropDevSalePnl.status == "provisional",
    ).order_by(PropDevSalePnl.created_at.desc()).first()
    if provisional:
        return provisional, "Projected"

    return None, None
