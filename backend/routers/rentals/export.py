"""
CFO Dashboard Excel export endpoint.
Numbers sourced from the same app calculations used in the live UI — not recomputed.
"""
from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.loan import Loan
from models.rentals.ar_ap import RentalPayable, RentalReceivable
from models.rentals.models import RentalCompany, RentalExpense, RentalInvoice, RentalUnit
from services.ar_ap_calculations import ap_total, ar_total, net_working_capital
from services.excel_export import build_cfo_dashboard_workbook
from services.lender_calculations import dscr as calc_dscr, ltv_current as calc_ltv
from services.rental_calculations import company_summary

router = APIRouter(prefix="/api/rentals/export", tags=["rentals-export"])

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _loan_risk_dict(loan: Loan) -> dict:
    bal      = float(loan.loan_balance_as_of) if loan.loan_balance_as_of is not None else None
    noi_ann  = float(loan.noi_annual) if loan.noi_annual is not None else None
    prop_val = float(loan.current_property_value) if loan.current_property_value is not None else None
    annual_ds = float(loan.loan_emi) * 12 if loan.loan_emi is not None else None
    return {
        "company_name":       loan.company_name,
        "property_name":      loan.property_name,
        "loan_balance_as_of": bal,
        "dscr":               calc_dscr(noi_ann, annual_ds),
        "ltv_current":        calc_ltv(bal, prop_val),
    }


@router.get("/cfo-dashboard")
def export_cfo_dashboard(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id

    # ── Pull data from the same sources the live UI uses ─────────────────────

    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).order_by(RentalCompany.company_name).all()
    all_units = db.query(RentalUnit).filter(RentalUnit.tenant_id == tid).all()
    all_invoices = db.query(RentalInvoice).filter(RentalInvoice.tenant_id == tid).all()
    all_expenses = db.query(RentalExpense).filter(RentalExpense.tenant_id == tid).all()
    all_loans    = db.query(Loan).filter(Loan.tenant_id == tid).all()

    # AR/AP snapshots
    all_recs  = db.query(RentalReceivable).filter(RentalReceivable.tenant_id == tid).all()
    all_pays  = db.query(RentalPayable).filter(RentalPayable.tenant_id == tid).all()

    # ── Build per-company AR/AP dicts (most-recent snapshot) ─────────────────

    recs_by_co: dict[str, list] = defaultdict(list)
    for r in all_recs:
        recs_by_co[str(r.company_id)].append(r)

    pays_by_co: dict[str, list] = defaultdict(list)
    for p in all_pays:
        pays_by_co[str(p.company_id)].append(p)

    def _latest_rec(lst):
        return max(lst, key=lambda r: r.as_of_date) if lst else None

    def _agg_pays(lst):
        latest = {}
        for p in lst:
            k = str(p.vendor_id)
            if k not in latest or p.as_of_date > latest[k].as_of_date:
                latest[k] = p
        agg = {"current_amount": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_60_plus": 0.0}
        for p in latest.values():
            agg["current_amount"] += float(p.current_amount)
            agg["days_1_30"]      += float(p.days_1_30)
            agg["days_31_60"]     += float(p.days_31_60)
            agg["days_60_plus"]   += float(p.days_60_plus)
        return agg

    # ── Compute portfolio summary using the shared calculation function ───────

    units_by_co: dict[str, list] = defaultdict(list)
    for u in all_units:
        units_by_co[str(u.company_id)].append({"status": u.status.value, "monthly_rent": float(u.monthly_rent), "status_changed_at": u.status_changed_at})

    units_dict: dict[str, str] = {str(u.id): str(u.company_id) for u in all_units}
    inv_by_co: dict[str, list] = defaultdict(list)
    for inv in all_invoices:
        co_id = units_dict.get(str(inv.unit_id), "")
        inv_by_co[co_id].append({
            "amount_billed": float(inv.amount_billed),
            "billing_period": inv.billing_period.isoformat() if inv.billing_period else None,
            "collections": [{"amount_collected": float(c.amount_collected), "collected_date": c.collected_date.isoformat()} for c in inv.collections],
        })

    exp_by_co: dict[str, list] = defaultdict(list)
    for e in all_expenses:
        exp_by_co[str(e.company_id)].append({"amount": float(e.amount), "expense_date": e.expense_date.isoformat() if e.expense_date else None, "category": e.category.value})

    # Portfolio-level totals
    port_summary: dict = {"total_units": 0, "occupied_units": 0, "vacant_units": 0,
                          "gross_potential_rent": 0.0, "vacancy_loss": 0.0,
                          "billed_this_month": 0.0, "collected_this_month": 0.0,
                          "arrears_total": 0.0, "total_expense_this_month": 0.0, "noi_this_month": 0.0}

    entities_for_export = []
    for co in companies:
        cid = str(co.id)
        co_units = units_by_co.get(cid, [])
        co_invs  = inv_by_co.get(cid, [])
        co_exps  = exp_by_co.get(cid, [])
        summ = company_summary(co_units, co_invs, co_exps)

        # AR/AP for this company
        lr = _latest_rec(recs_by_co.get(cid, []))
        ar_d = {
            "current_amount": float(lr.current_amount) if lr else 0.0,
            "days_1_30":      float(lr.days_1_30) if lr else 0.0,
            "days_31_60":     float(lr.days_31_60) if lr else 0.0,
            "days_61_90":     float(lr.days_61_90) if lr else 0.0,
            "days_90_plus":   float(lr.days_90_plus) if lr else 0.0,
        }
        ap_d = _agg_pays(pays_by_co.get(cid, []))

        entities_for_export.append({
            "company_name": co.company_name,
            "ar": ar_d,
            "ap": ap_d,
            "ar_total": ar_total(ar_d),
            "ap_total": ap_total(ap_d),
        })

        for k in ("total_units", "occupied_units", "vacant_units"):
            port_summary[k] += summ[k]
        for k in ("gross_potential_rent", "vacancy_loss", "billed_this_month",
                  "collected_this_month", "arrears_total", "total_expense_this_month", "noi_this_month"):
            port_summary[k] = round(port_summary[k] + summ[k], 2)

    if port_summary["total_units"]:
        port_summary["occupancy_pct"] = round(port_summary["occupied_units"] / port_summary["total_units"], 4)
    else:
        port_summary["occupancy_pct"] = 0.0

    # OpEx breakdown by category (all companies, all time — this month would require filtering)
    cat_totals: dict[str, float] = defaultdict(float)
    for e in all_expenses:
        cat_totals[e.category.value] += float(e.amount)
    expense_breakdown = [{"category": cat, "amount": round(amt, 2)} for cat, amt in sorted(cat_totals.items(), key=lambda x: -x[1])]

    # Loans with computed DSCR/LTV
    loans_for_export = [_loan_risk_dict(l) for l in all_loans]

    # ── Build workbook ────────────────────────────────────────────────────────
    xlsx_bytes = build_cfo_dashboard_workbook(
        portfolio=port_summary,
        entities=entities_for_export,
        expense_breakdown=expense_breakdown,
        loans=loans_for_export,
    )

    from datetime import date
    filename = f"RERA_OS_Dashboard_{date.today().isoformat()}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type=_XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
