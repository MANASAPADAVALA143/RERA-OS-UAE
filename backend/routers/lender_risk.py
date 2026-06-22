"""
Cross-module Lender Risk summary — pulls all loans (Construction + Rental context)
and returns portfolio-level DSCR/LTV with two-tier covenant warnings.
"""
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.loan import Loan
from services.lender_calculations import dscr as calc_dscr, dscr_status, ltv_current as calc_ltv

router = APIRouter(prefix="/api/lender-risk", tags=["lender-risk"])


def _loan_risk(loan: Loan) -> dict:
    annual_ds = float(loan.loan_emi) * 12 if loan.loan_emi is not None else None
    bal       = float(loan.loan_balance_as_of) if loan.loan_balance_as_of is not None else None
    noi_ann   = float(loan.noi_annual) if loan.noi_annual is not None else None
    prop_val  = float(loan.current_property_value) if loan.current_property_value is not None else None
    dscr_val  = calc_dscr(noi_ann, annual_ds)
    ltv_val   = calc_ltv(bal, prop_val)
    return {
        "id":                    str(loan.id),
        "company_name":          loan.company_name,
        "property_name":         loan.property_name,
        "loan_bank_name":        loan.loan_bank_name,
        "context_type":          getattr(loan, "context_type", "construction") or "construction",
        "loan_balance_as_of":    bal,
        "loan_maturity_date":    loan.loan_maturity_date.isoformat() if loan.loan_maturity_date else None,
        "loan_emi":              float(loan.loan_emi) if loan.loan_emi is not None else None,
        "noi_annual":            noi_ann,
        "current_property_value": prop_val,
        "dscr":                  dscr_val,
        "ltv_current":           ltv_val,
        "dscr_status":           dscr_status(dscr_val),
    }


@router.get("/summary")
def lender_risk_summary(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    loans = db.query(Loan).filter(Loan.tenant_id == current_user.tenant_id).all()
    items = [_loan_risk(l) for l in loans]

    # Sort all loans worst-DSCR-first; loans with no DSCR go to the end
    sorted_items = sorted(items, key=lambda x: (x["dscr"] is None, float(x["dscr"] or 9999)))

    total_debt = round(sum(float(i["loan_balance_as_of"] or 0) for i in items), 2)

    # Weighted average DSCR (weighted by outstanding balance)
    dscr_items = [i for i in items if i["dscr"] is not None and i["loan_balance_as_of"]]
    ltv_items  = [i for i in items if i["ltv_current"] is not None and i["loan_balance_as_of"]]
    w_dscr, w_ltv = None, None
    if dscr_items:
        denom = sum(float(i["loan_balance_as_of"]) for i in dscr_items)
        if denom:
            w_dscr = round(
                sum(i["dscr"] * float(i["loan_balance_as_of"]) for i in dscr_items) / denom, 4
            )
    if ltv_items:
        denom = sum(float(i["loan_balance_as_of"]) for i in ltv_items)
        if denom:
            w_ltv = round(
                sum(i["ltv_current"] * float(i["loan_balance_as_of"]) for i in ltv_items) / denom, 4
            )

    # Two-tier warning — matches source workbook's "below 1.00x" / "below 1.25x" pattern
    below_1_00x = [i for i in items if i["dscr"] is not None and i["dscr"] < 1.00]
    below_1_25x = [i for i in items if i["dscr"] is not None and i["dscr"] < 1.25]
    below_covenant = [i for i in items if i["dscr_status"] == "below_covenant"]  # < 1.20

    return {
        "total_debt":            total_debt,
        "total_loans":           len(items),
        "weighted_avg_dscr":     w_dscr,
        "weighted_avg_ltv":      w_ltv,
        "loans_below_1_00x": {
            "count": len(below_1_00x),
            "items": sorted(below_1_00x, key=lambda x: float(x["dscr"] or 0)),
        },
        "loans_below_1_25x": {
            "count": len(below_1_25x),
            "items": sorted(below_1_25x, key=lambda x: float(x["dscr"] or 0)),
        },
        "loans_below_dscr_covenant": {
            "count": len(below_covenant),
            "items": sorted(below_covenant, key=lambda x: float(x["dscr"] or 0)),
        },
        "all_loans": sorted_items,
    }
