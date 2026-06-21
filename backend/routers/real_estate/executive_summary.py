from datetime import date, timedelta
from collections import Counter

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user
from models.real_estate.construction_cost import CostTrade
from models.real_estate.construction_extended import ProjectROIAssumptions
from models.real_estate.entity import Project, ProjectStatus
from models.real_estate.financing import FinancingFacility
from models.real_estate.pipeline import LandParcel, LandParcelStatus
from models.real_estate.reit_rental import ReitAsset, RentalProperty
from models.real_estate.risk import ClaimStatus, LitigationClaim, TaxEvent, TaxEventStatus, VendorContractor
from models.real_estate.unit import Unit, UnitStatus
from routers.real_estate import permits as permits_router
from services.construction_roi import build_project_roi_summary, portfolio_roi_summary
from services.real_estate_calculations import (
    capital_available_now,
    cost_overrun,
    covenant_headroom,
    debt_maturity_bucket,
    rent_collection_efficiency,
    reit_metrics,
    vendor_concentration,
)

router = APIRouter(prefix="/api/real-estate/executive-summary", tags=["real-estate"])


@router.get("")
def executive_summary(
    litigation_threshold: float = Query(default=250000),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()

    units = db.query(Unit).filter(Unit.tenant_id == tid).all()
    project_sales = sum(float(u.achieved_sale_price or 0) for u in units if u.status == UnitStatus.closed)
    reit_assets = db.query(ReitAsset).filter(ReitAsset.tenant_id == tid).all()
    reit_income = sum(float(a.annual_rental_income) for a in reit_assets)
    rentals = db.query(RentalProperty).filter(RentalProperty.tenant_id == tid).all()
    rental_income = sum(float(r.monthly_rent_collected) * 12 for r in rentals)

    consolidated_revenue = project_sales + reit_income + rental_income
    reit_expenses = sum(float(a.annual_operating_expenses) for a in reit_assets)
    rental_maintenance = sum(float(r.monthly_maintenance_cost) * 12 for r in rentals)
    consolidated_profit = consolidated_revenue - reit_expenses - rental_maintenance

    facilities = db.query(FinancingFacility).filter(FinancingFacility.tenant_id == tid).all()
    cap_data = capital_available_now([
        {"id": str(f.id), "facility_type": f.facility_type.value, "lender_or_investor_name": f.lender_or_investor_name,
         "undrawn_available": float(f.undrawn_available), "is_in_default": f.is_in_default}
        for f in facilities
    ])

    projects = db.query(Project).filter(Project.tenant_id == tid).all()
    order_book = sum(float(p.total_saleable_sqft or 0) * 350 for p in projects if p.status.value in ("under_construction", "selling"))
    unsold_units = len([u for u in units if u.status in (UnitStatus.available, UnitStatus.reserved, UnitStatus.unreleased)])

    total_reit_value = sum(float(a.current_market_value or a.current_book_value) for a in reit_assets)
    weighted_ltv = sum(float(a.ltv_pct) * float(a.current_market_value or a.current_book_value) for a in reit_assets) / total_reit_value if total_reit_value else 0
    reit_summary = reit_metrics(total_reit_value, weighted_ltv, reit_income, units_outstanding=max(len(reit_assets), 1))

    rental_efficiencies = [rent_collection_efficiency(r.monthly_rent_billed, r.monthly_rent_collected) for r in rentals]
    avg_collection = sum(e["pct"] for e in rental_efficiencies) / len(rental_efficiencies) if rental_efficiencies else 0

    alerts = []

    at_risk_permits = permits_router.permits_at_risk(None, current_user, db)
    for p in at_risk_permits[:5]:
        alerts.append({"severity": "red", "type": "permit_at_risk", "message": f"Blocking permit {p['permit_type']} is at risk", "route": "/construction"})

    trades = db.query(CostTrade).filter(CostTrade.tenant_id == tid).all()
    for t in trades:
        o = cost_overrun(t.budgeted_cost, t.actual_cost_to_date, t.committed_cost)
        if o["status"] == "over_budget":
            alerts.append({"severity": "red", "type": "cost_overrun", "message": f"{t.trade_name.value} is over budget ({o['overrun_pct']:.1%})", "route": "/construction"})
        elif o["status"] == "watch":
            alerts.append({"severity": "amber", "type": "cost_watch", "message": f"{t.trade_name.value} cost watch ({o['overrun_pct']:.1%})", "route": "/construction"})

    for f in facilities:
        h = covenant_headroom(f.ltv_current_pct, f.ltv_covenant_pct, f.dscr_current, f.dscr_covenant_min)
        if h["breach_risk"] == "breach":
            alerts.append({"severity": "red", "type": "covenant_breach", "message": f"Covenant breach risk on facility with {f.lender_or_investor_name}", "route": "/capital-risk"})
        elif h["breach_risk"] == "watch":
            alerts.append({"severity": "amber", "type": "covenant_watch", "message": f"Covenant watch on facility", "route": "/capital-risk"})
        bucket = debt_maturity_bucket(f.maturity_date, today)
        if bucket in ("0-30_days", "31-60_days", "61-90_days"):
            alerts.append({"severity": "amber", "type": "debt_maturity", "message": f"Debt maturing in {bucket.replace('_', ' ')}", "route": "/capital-risk"})

    for r in rentals:
        occ = (r.occupied_units / r.total_units) if r.total_units else 0
        if float(r.avg_dso_days) > 45 or occ < 0.85:
            alerts.append({"severity": "red", "type": "rental_at_risk", "message": f"Rental property {r.property_name} at risk", "route": "/rental"})

    tax_events = db.query(TaxEvent).filter(TaxEvent.tenant_id == tid, TaxEvent.status == TaxEventStatus.pending).all()
    for e in tax_events:
        if e.deadline_date and e.deadline_date <= today + timedelta(days=60):
            alerts.append({"severity": "amber", "type": "tax_deadline", "message": f"Tax deadline: {e.event_type.value}", "route": "/capital-risk"})

    vendors = db.query(VendorContractor).filter(VendorContractor.tenant_id == tid).all()
    v_vals = {v.vendor_name: sum(float(p.total_saleable_sqft or 0) * 150 for p in v.projects) for v in vendors}
    vc = vendor_concentration(v_vals, sum(v_vals.values()))
    if vc["concentration_risk"]:
        alerts.append({"severity": "red", "type": "vendor_concentration", "message": f"Vendor {vc['top_vendor']} exceeds 25% concentration", "route": "/capital-risk"})

    claims = db.query(LitigationClaim).filter(LitigationClaim.tenant_id == tid).all()
    for c in claims:
        if c.status.value in ("open", "in_litigation") and float(c.exposure_amount) > litigation_threshold:
            alerts.append({"severity": "red", "type": "litigation", "message": f"Open litigation exposure ${float(c.exposure_amount):,.0f}", "route": "/capital-risk"})

    parcels = db.query(LandParcel).filter(LandParcel.tenant_id == tid).all()
    status_counts = Counter(p.status.value for p in parcels)
    pipeline_value = sum(
        float(p.projected_acquisition_cost or 0) * float(p.projected_project_irr or 0)
        for p in parcels if p.status in (LandParcelStatus.under_contract, LandParcelStatus.due_diligence)
    )

    roce = (consolidated_profit / total_reit_value * 100) if total_reit_value > 0 else 0

    active_statuses = {ProjectStatus.under_construction, ProjectStatus.selling}
    active_projects = [p for p in projects if p.status in active_statuses]

    assumptions_rows = (
        db.query(ProjectROIAssumptions)
        .filter(ProjectROIAssumptions.tenant_id == tid)
        .all()
    )
    assumptions_by_project = {a.project_id: a for a in assumptions_rows}

    project_roi_list = []
    for project in active_projects:
        assumptions = assumptions_by_project.get(project.id)
        summary = None
        if assumptions:
            summary = build_project_roi_summary(
                total_project_cost=assumptions.total_project_cost,
                equity_pct=assumptions.equity_pct,
                debt_pct=assumptions.debt_pct,
                interest_rate_annual=assumptions.interest_rate_annual,
                construction_months=assumptions.construction_months,
                exit_strategy=assumptions.exit_strategy.value,
                stabilized_noi=assumptions.stabilized_noi,
                exit_cap_rate=assumptions.exit_cap_rate,
                selling_costs_pct=assumptions.selling_costs_pct,
            )
        project_roi_list.append({
            "project_id": str(project.id),
            "project_name": project.project_name,
            "project_code": project.project_code,
            "configured": bool(summary),
            "equity_invested": summary["equity_invested"] if summary else None,
            "net_profit": summary["net_profit"] if summary else None,
            "net_sale_proceeds": summary["net_sale_proceeds"] if summary else None,
            "roi": summary["roi"] if summary else None,
            "moic": summary["moic"] if summary else None,
        })

    portfolio_roi = portfolio_roi_summary(project_roi_list)

    return {
        "as_of": today.isoformat(),
        "financial_health": {
            "consolidated_revenue": round(consolidated_revenue, 2),
            "consolidated_operating_profit": round(consolidated_profit, 2),
            "capital_available_now": cap_data["total"],
            "capital_breakdown": cap_data["breakdown"],
            "group_roce_pct": round(roce, 2),
        },
        "segment_scale": {
            "construction_order_book": round(order_book, 2),
            "development_units_unsold": unsold_units,
            "reit_nav": reit_summary["nav"],
            "reit_distribution_yield": reit_summary["distribution_yield"],
            "rental_collection_efficiency": round(avg_collection, 4),
        },
        "revenue_mix": {
            "construction": round(project_sales * 0.4, 2),
            "development": round(project_sales * 0.6, 2),
            "reit": round(reit_income, 2),
            "rental": round(rental_income, 2),
        },
        "alerts": sorted(alerts, key=lambda a: 0 if a["severity"] == "red" else 1),
        "pipeline_snapshot": {
            "by_status": dict(status_counts),
            "irr_weighted_pipeline_value": round(pipeline_value, 2),
        },
        "portfolio_roi": portfolio_roi,
    }
