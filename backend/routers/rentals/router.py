"""Rentals module router — all endpoints under /api/rentals/"""
from __future__ import annotations

import csv
import io
import uuid
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import SessionLocal
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.rentals.models import (
    RentalCollection,
    RentalCompany,
    RentalExpense,
    RentalExpenseCategory,
    RentalInvoice,
    RentalLease,
    RentalOwnership,
    RentalPartnerRole,
    RentalProp,
    RentalTenant,
    RentalUnit,
)
from services.rental_calculations import (
    arrears_aging,
    company_summary,
    days_vacant,
    distribute_to_partners,
    income_trend,
    lease_expiry_pipeline,
    unit_arrears,
)

router = APIRouter(prefix="/api/rentals", tags=["rentals"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── helpers ──────────────────────────────────────────────────────────────────

def _inv_dict(inv: RentalInvoice) -> dict:
    return {
        "id": str(inv.id),
        "unit_id": str(inv.unit_id),
        "lease_id": str(inv.lease_id),
        "billing_period": inv.billing_period.isoformat() if inv.billing_period else None,
        "amount_billed": float(inv.amount_billed),
        "collections": [
            {
                "id": str(c.id),
                "amount_collected": float(c.amount_collected),
                "collected_date": c.collected_date.isoformat() if c.collected_date else None,
            }
            for c in inv.collections
        ],
    }


def _unit_dict(u: RentalUnit, inv_list: list[dict] | None = None, today: date | None = None) -> dict:
    today = today or date.today()
    arrears = unit_arrears(inv_list or [])
    tenant = next((t for t in u.r_tenants if t.is_current), None)
    active_lease = next(
        (l for l in sorted(u.leases, key=lambda x: x.lease_end, reverse=True) if l.status in ("active", "notice_given")),
        None,
    )
    return {
        "id": str(u.id),
        "company_id": str(u.company_id),
        "property_id": str(u.property_id),
        "company_name": u.company.company_name if u.company else "",
        "property_name": u.property.property_name if u.property else "",
        "unit_number": u.unit_number,
        "status": u.status.value,
        "monthly_rent": float(u.monthly_rent),
        "status_changed_at": u.status_changed_at.isoformat() if u.status_changed_at else None,
        "days_vacant": days_vacant(u.status.value, u.status_changed_at, today),
        "tenant_name": tenant.tenant_name if tenant else None,
        "tenant_email": tenant.tenant_email if tenant else None,
        "lease_end": active_lease.lease_end.isoformat() if active_lease else None,
        "lease_status": active_lease.status.value if active_lease else None,
        "arrears": arrears,
    }


def _lease_dict(l: RentalLease) -> dict:
    today = date.today()
    days_left = (l.lease_end - today).days if l.lease_end else None
    return {
        "id": str(l.id),
        "unit_id": str(l.unit_id),
        "unit_number": l.unit.unit_number if l.unit else "",
        "company_name": l.unit.company.company_name if l.unit and l.unit.company else "",
        "company_id": str(l.unit.company_id) if l.unit else "",
        "property_name": l.unit.property.property_name if l.unit and l.unit.property else "",
        "tenant_name": l.rtenant.tenant_name if l.rtenant else None,
        "lease_start": l.lease_start.isoformat() if l.lease_start else None,
        "lease_end": l.lease_end.isoformat() if l.lease_end else None,
        "days_until_expiry": days_left,
        "status": l.status.value,
        "escalation_pct_annual": float(l.escalation_pct_annual) if l.escalation_pct_annual else None,
        "deposit_amount": float(l.deposit_amount) if l.deposit_amount else None,
        "notice_period_days": l.notice_period_days,
        "lock_in_end_date": l.lock_in_end_date.isoformat() if l.lock_in_end_date else None,
    }


def _expense_dict(e: RentalExpense) -> dict:
    return {
        "id": str(e.id),
        "company_id": str(e.company_id),
        "property_id": str(e.property_id),
        "company_name": e.company.company_name if e.company else "",
        "property_name": e.property.property_name if e.property else "",
        "expense_date": e.expense_date.isoformat() if e.expense_date else None,
        "category": e.category.value,
        "amount": float(e.amount),
        "description": e.description,
    }


def _load_company_data(company_id: uuid.UUID, tid: uuid.UUID, db: Session) -> tuple:
    """Returns (units, all_invoices_with_collections, expenses) for a company."""
    units = (
        db.query(RentalUnit)
        .filter(RentalUnit.tenant_id == tid, RentalUnit.company_id == company_id)
        .all()
    )
    unit_ids = [u.id for u in units]
    invoices = (
        db.query(RentalInvoice)
        .filter(RentalInvoice.tenant_id == tid, RentalInvoice.unit_id.in_(unit_ids))
        .all()
    ) if unit_ids else []
    inv_dicts = [_inv_dict(i) for i in invoices]
    expenses = (
        db.query(RentalExpense)
        .filter(RentalExpense.tenant_id == tid, RentalExpense.company_id == company_id)
        .all()
    )
    exp_dicts = [_expense_dict(e) for e in expenses]
    return units, inv_dicts, exp_dicts


# ── portfolio summary ─────────────────────────────────────────────────────────

@router.get("/portfolio-summary")
def get_portfolio_summary(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()

    all_units_dicts: list[dict] = []
    all_inv_dicts: list[dict] = []
    all_exp_dicts: list[dict] = []
    by_company: list[dict] = []

    all_leases_raw: list[RentalLease] = []

    for co in companies:
        units, inv_dicts, exp_dicts = _load_company_data(co.id, tid, db)
        inv_by_unit: dict[str, list[dict]] = defaultdict(list)
        for inv in inv_dicts:
            inv_by_unit[inv["unit_id"]].append(inv)

        unit_dicts = [_unit_dict(u, inv_by_unit.get(str(u.id), []), today) for u in units]
        summ = company_summary(unit_dicts, inv_dicts, exp_dicts, today)

        all_units_dicts.extend(unit_dicts)
        all_inv_dicts.extend(inv_dicts)
        all_exp_dicts.extend(exp_dicts)

        leases = db.query(RentalLease).filter(
            RentalLease.tenant_id == tid,
            RentalLease.unit_id.in_([u.id for u in units]),
        ).all()
        all_leases_raw.extend(leases)

        by_company.append({
            "company_id": str(co.id),
            "company_name": co.company_name,
            **summ,
        })

    portfolio = company_summary(all_units_dicts, all_inv_dicts, all_exp_dicts, today)
    aging = arrears_aging(all_inv_dicts, today)
    trend = income_trend(all_inv_dicts, all_exp_dicts, months=6)
    expiry = lease_expiry_pipeline([_lease_dict(l) for l in all_leases_raw], today, window_days=90)

    # attention_now
    attention: list[dict] = []
    vacant_count = sum(1 for u in all_units_dicts if u["status"] == "vacant")
    if vacant_count:
        co_with_vacant = len({u["company_id"] for u in all_units_dicts if u["status"] == "vacant"})
        attention.append({"type": "vacant", "message": f"{vacant_count} vacant unit(s) across {co_with_vacant} company(ies)", "severity": "warning"})

    expiring_60 = [l for l in expiry if l.get("days_until_expiry", 999) <= 60]
    if expiring_60:
        attention.append({"type": "lease_expiry", "message": f"{len(expiring_60)} lease(s) expire within 60 days", "severity": "attention"})

    aging_31_plus = sum(v for k, v in aging.items() if k != "0_30")
    if aging_31_plus > 0:
        attention.append({"type": "arrears_aging", "message": f"${aging_31_plus:,.0f} in arrears older than 30 days", "severity": "warning"})

    low_occ = [c for c in by_company if c["occupancy_pct"] < 0.75]
    if low_occ:
        attention.append({"type": "low_occupancy", "message": f"{len(low_occ)} company(ies) below 75% occupancy", "severity": "attention"})

    return {
        **portfolio,
        "by_company": by_company,
        "arrears_aging": aging,
        "income_trend": trend,
        "lease_expiry_pipeline": expiry,
        "attention_now": attention,
    }


# ── companies ─────────────────────────────────────────────────────────────────

@router.get("/companies/count")
def count_companies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.query(RentalCompany).filter(RentalCompany.tenant_id == current_user.tenant_id).count()
    return {"count": n}


@router.get("/companies")
def list_companies(
    fmt: str = Query(None, alias="format"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()
    result = []
    for co in companies:
        units, inv_dicts, exp_dicts = _load_company_data(co.id, tid, db)
        inv_by_unit: dict[str, list[dict]] = defaultdict(list)
        for inv in inv_dicts:
            inv_by_unit[inv["unit_id"]].append(inv)
        unit_dicts = [_unit_dict(u, inv_by_unit.get(str(u.id), []), today) for u in units]
        summ = company_summary(unit_dicts, inv_dicts, exp_dicts, today)
        props = db.query(RentalProp).filter(RentalProp.company_id == co.id).all()
        result.append({
            "id": str(co.id),
            "company_name": co.company_name,
            "property_name": props[0].property_name if props else "",
            "property_count": len(props),
            **summ,
        })
    if fmt == "csv":
        output = io.StringIO()
        if result:
            writer = csv.DictWriter(output, fieldnames=result[0].keys())
            writer.writeheader()
            writer.writerows(result)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=occupancy_report.csv"},
        )
    return result


@router.post("/companies", status_code=201)
def create_company(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = RentalCompany(
        tenant_id=current_user.tenant_id,
        company_name=body["company_name"],
        created_by=current_user.email,
    )
    db.add(co)
    db.commit()
    db.refresh(co)
    return {"id": str(co.id), "company_name": co.company_name}


@router.patch("/companies/{company_id}/status")
def toggle_company_status(
    company_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = db.query(RentalCompany).filter(
        RentalCompany.id == company_id,
        RentalCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(404, "Company not found")
    co.status = body.get("status", "active")
    db.commit()
    return {"id": str(co.id), "status": co.status}


@router.put("/companies/{company_id}")
def update_company(
    company_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = db.query(RentalCompany).filter(
        RentalCompany.id == company_id,
        RentalCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(404, "Company not found")
    if "company_name" in body:
        co.company_name = body["company_name"]
    db.commit()
    db.refresh(co)
    return {"id": str(co.id), "company_name": co.company_name}


@router.delete("/companies/{company_id}", status_code=204)
def delete_company(
    company_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    co = db.query(RentalCompany).filter(
        RentalCompany.id == company_id,
        RentalCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(404, "Company not found")
    db.delete(co)
    db.commit()


@router.get("/companies/{company_id}/dashboard")
def company_dashboard(
    company_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    co = db.query(RentalCompany).filter(RentalCompany.id == company_id, RentalCompany.tenant_id == tid).first()
    if not co:
        raise HTTPException(404, "Company not found")

    units, inv_dicts, exp_dicts = _load_company_data(co.id, tid, db)
    inv_by_unit: dict[str, list[dict]] = defaultdict(list)
    for inv in inv_dicts:
        inv_by_unit[inv["unit_id"]].append(inv)
    unit_dicts = [_unit_dict(u, inv_by_unit.get(str(u.id), []), today) for u in units]
    summ = company_summary(unit_dicts, inv_dicts, exp_dicts, today)
    trend = income_trend(inv_dicts, exp_dicts, months=6)

    exp_by_cat: dict[str, float] = defaultdict(float)
    for e in exp_dicts:
        exp_by_cat[e["category"]] += e["amount"]
    expense_breakdown = [{"category": k, "amount": round(v, 2)} for k, v in exp_by_cat.items()]

    ownership_rows = db.query(RentalOwnership).filter(
        RentalOwnership.tenant_id == tid, RentalOwnership.company_id == co.id,
    ).all()
    own_dicts = [
        {"partner_name": o.partner_name, "ownership_pct": float(o.ownership_pct), "role": o.role.value}
        for o in ownership_rows
    ]
    partner_distribution = distribute_to_partners(summ["noi_this_month"], own_dicts)

    props = db.query(RentalProp).filter(RentalProp.company_id == co.id).all()

    return {
        "id": str(co.id),
        "company_name": co.company_name,
        "property_name": props[0].property_name if props else "",
        "property_count": len(props),
        **summ,
        "income_trend": trend,
        "expense_breakdown": expense_breakdown,
        "units": unit_dicts,
        "ownership": own_dicts,
        "partner_distribution": partner_distribution,
    }


# ── suites (properties) ───────────────────────────────────────────────────────

@router.get("/suites")
def list_suites(
    company_id: str = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    q = db.query(RentalProp).filter(RentalProp.tenant_id == tid)
    if company_id:
        q = q.filter(RentalProp.company_id == uuid.UUID(company_id))
    suites = q.order_by(RentalProp.property_name).all()
    return [
        {
            "id": str(s.id),
            "company_id": str(s.company_id),
            "property_name": s.property_name,
            "address": s.address,
            "property_type": s.property_type,
            "unit_count": len(s.units),
        }
        for s in suites
    ]


@router.post("/suites", status_code=201)
def create_suite(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    cid = uuid.UUID(body["company_id"])
    co = db.query(RentalCompany).filter(
        RentalCompany.id == cid,
        RentalCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not co:
        raise HTTPException(404, "Company not found")
    s = RentalProp(
        tenant_id=current_user.tenant_id,
        company_id=cid,
        property_name=body["property_name"],
        address=body.get("address"),
        property_type=body.get("property_type"),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": str(s.id), "property_name": s.property_name, "company_id": str(s.company_id)}


@router.put("/suites/{suite_id}")
def update_suite(
    suite_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    s = db.query(RentalProp).filter(
        RentalProp.id == suite_id,
        RentalProp.tenant_id == current_user.tenant_id,
    ).first()
    if not s:
        raise HTTPException(404, "Suite not found")
    if "property_name" in body and body["property_name"]:
        s.property_name = body["property_name"]
    if "address" in body:
        s.address = body["address"] or None
    if "property_type" in body:
        s.property_type = body["property_type"] or None
    db.commit()
    db.refresh(s)
    return {"id": str(s.id), "property_name": s.property_name}


@router.delete("/suites/{suite_id}", status_code=204)
def delete_suite(
    suite_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    s = db.query(RentalProp).filter(
        RentalProp.id == suite_id,
        RentalProp.tenant_id == current_user.tenant_id,
    ).first()
    if not s:
        raise HTTPException(404, "Suite not found")

    # Cascade delete in FK dependency order:
    # collections → invoices → leases → tenants → units → expenses → suite
    unit_ids = [u.id for u in s.units]
    if unit_ids:
        invoices = db.query(RentalInvoice).filter(RentalInvoice.unit_id.in_(unit_ids)).all()
        for inv in invoices:
            db.query(RentalCollection).filter(RentalCollection.invoice_id == inv.id).delete(synchronize_session=False)
        db.query(RentalInvoice).filter(RentalInvoice.unit_id.in_(unit_ids)).delete(synchronize_session=False)
        db.query(RentalLease).filter(RentalLease.unit_id.in_(unit_ids)).delete(synchronize_session=False)
        db.query(RentalTenant).filter(RentalTenant.unit_id.in_(unit_ids)).delete(synchronize_session=False)
    db.query(RentalExpense).filter(RentalExpense.property_id == suite_id).delete(synchronize_session=False)
    db.query(RentalUnit).filter(RentalUnit.property_id == suite_id).delete(synchronize_session=False)
    db.delete(s)
    db.commit()


# ── units ─────────────────────────────────────────────────────────────────────

@router.get("/units")
def list_units(
    company_id: str = Query(None),
    status: str = Query(None),
    fmt: str = Query(None, alias="format"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    q = db.query(RentalUnit).filter(RentalUnit.tenant_id == tid)
    if company_id:
        try:
            q = q.filter(RentalUnit.company_id == uuid.UUID(company_id))
        except ValueError:
            pass
    if status:
        q = q.filter(RentalUnit.status == status)
    units = q.all()

    unit_ids = [u.id for u in units]
    invoices = db.query(RentalInvoice).filter(
        RentalInvoice.tenant_id == tid, RentalInvoice.unit_id.in_(unit_ids)
    ).all() if unit_ids else []
    inv_by_unit: dict[str, list[dict]] = defaultdict(list)
    for inv in invoices:
        inv_by_unit[str(inv.unit_id)].append(_inv_dict(inv))

    result = [_unit_dict(u, inv_by_unit.get(str(u.id), []), today) for u in units]

    if fmt == "csv":
        output = io.StringIO()
        if result:
            fields = ["unit_number", "company_name", "property_name", "status", "tenant_name", "lease_end", "monthly_rent", "arrears", "days_vacant"]
            writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(result)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=rent_roll.csv"},
        )
    return result


@router.post("/units", status_code=201)
def create_unit(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    u = RentalUnit(
        tenant_id=current_user.tenant_id,
        property_id=uuid.UUID(body["property_id"]),
        company_id=uuid.UUID(body["company_id"]),
        unit_number=body["unit_number"],
        status=body.get("status", "vacant"),
        monthly_rent=float(body["monthly_rent"]),
        status_changed_at=date.fromisoformat(body["status_changed_at"]) if body.get("status_changed_at") else None,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"id": str(u.id)}


@router.put("/units/{unit_id}")
def update_unit(
    unit_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    u = db.query(RentalUnit).filter(RentalUnit.id == unit_id, RentalUnit.tenant_id == current_user.tenant_id).first()
    if not u:
        raise HTTPException(404)
    for field in ("unit_number", "status", "monthly_rent"):
        if field in body:
            setattr(u, field, body[field])
    if "status_changed_at" in body:
        u.status_changed_at = date.fromisoformat(body["status_changed_at"]) if body["status_changed_at"] else None
    db.commit()
    return {"id": str(u.id)}


@router.delete("/units/{unit_id}", status_code=204)
def delete_unit(
    unit_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    u = db.query(RentalUnit).filter(RentalUnit.id == unit_id, RentalUnit.tenant_id == current_user.tenant_id).first()
    if not u:
        raise HTTPException(404)
    db.delete(u)
    db.commit()


# ── leases ────────────────────────────────────────────────────────────────────

@router.get("/leases")
def list_leases(
    company_id: str = Query(None),
    fmt: str = Query(None, alias="format"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    q = db.query(RentalLease).filter(RentalLease.tenant_id == tid)
    if company_id:
        try:
            cid = uuid.UUID(company_id)
            unit_ids = [u.id for u in db.query(RentalUnit).filter(RentalUnit.tenant_id == tid, RentalUnit.company_id == cid).all()]
            if unit_ids:
                q = q.filter(RentalLease.unit_id.in_(unit_ids))
            else:
                return []
        except ValueError:
            pass
    leases = q.all()
    result = [_lease_dict(l) for l in leases]
    expiry_30 = sum(1 for l in result if l["days_until_expiry"] is not None and 0 <= l["days_until_expiry"] <= 30)
    expiry_60 = sum(1 for l in result if l["days_until_expiry"] is not None and 0 <= l["days_until_expiry"] <= 60)
    expiry_90 = sum(1 for l in result if l["days_until_expiry"] is not None and 0 <= l["days_until_expiry"] <= 90)

    if fmt == "csv":
        output = io.StringIO()
        if result:
            fields = ["unit_number", "company_name", "tenant_name", "lease_start", "lease_end", "days_until_expiry", "status", "deposit_amount", "escalation_pct_annual"]
            writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(result)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=lease_expiry.csv"},
        )
    return {
        "leases": result,
        "expiry_pipeline": {"days_30": expiry_30, "days_60": expiry_60, "days_90": expiry_90},
    }


@router.post("/leases", status_code=201)
def create_lease(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    l = RentalLease(
        tenant_id=current_user.tenant_id,
        unit_id=uuid.UUID(body["unit_id"]),
        r_tenant_id=uuid.UUID(body["r_tenant_id"]) if body.get("r_tenant_id") else None,
        lease_start=date.fromisoformat(body["lease_start"]),
        lease_end=date.fromisoformat(body["lease_end"]),
        escalation_pct_annual=float(body["escalation_pct_annual"]) if body.get("escalation_pct_annual") else None,
        deposit_amount=float(body["deposit_amount"]) if body.get("deposit_amount") else None,
        notice_period_days=int(body["notice_period_days"]) if body.get("notice_period_days") else None,
        lock_in_end_date=date.fromisoformat(body["lock_in_end_date"]) if body.get("lock_in_end_date") else None,
        status=body.get("status", "active"),
    )
    db.add(l)
    db.commit()
    db.refresh(l)
    return {"id": str(l.id)}


@router.put("/leases/{lease_id}")
def update_lease(
    lease_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    l = db.query(RentalLease).filter(RentalLease.id == lease_id, RentalLease.tenant_id == current_user.tenant_id).first()
    if not l:
        raise HTTPException(404)
    if "status" in body:
        l.status = body["status"]
    if "lease_end" in body:
        l.lease_end = date.fromisoformat(body["lease_end"])
    db.commit()
    return {"id": str(l.id)}


# ── collections ───────────────────────────────────────────────────────────────

@router.get("/collections")
def list_collections(
    company_id: str = Query(None),
    month: str = Query(None),  # YYYY-MM, defaults to current month
    fmt: str = Query(None, alias="format"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    cur_month = month if month else today.strftime("%Y-%m")
    q = db.query(RentalInvoice).filter(RentalInvoice.tenant_id == tid)
    if company_id:
        try:
            cid = uuid.UUID(company_id)
            unit_ids = [u.id for u in db.query(RentalUnit).filter(RentalUnit.tenant_id == tid, RentalUnit.company_id == cid).all()]
            if unit_ids:
                q = q.filter(RentalInvoice.unit_id.in_(unit_ids))
            else:
                return {"items": [], "summary": {}}
        except ValueError:
            pass
    # Filter invoices to the selected billing month
    invoices = [i for i in q.all() if str(i.billing_period)[:7] == cur_month]
    inv_dicts = [_inv_dict(i) for i in invoices]

    items = []
    for inv in invoices:
        d = _inv_dict(inv)
        collected = sum(c["amount_collected"] for c in d["collections"])
        balance = max(0.0, d["amount_billed"] - collected)
        status_str = "paid" if balance == 0 else ("partial" if collected > 0 else "unpaid")
        unit = inv.unit
        items.append({
            **d,
            "unit_number": unit.unit_number if unit else "",
            "company_name": unit.company.company_name if unit and unit.company else "",
            "company_id": str(unit.company_id) if unit else "",
            "amount_collected": collected,
            "balance": balance,
            "collection_status": status_str,
        })

    total_billed = sum(i["amount_billed"] for i in items)
    total_collected = sum(i["amount_collected"] for i in items)
    total_arrears = sum(i["balance"] for i in items)
    collection_rate = total_collected / total_billed if total_billed else 0.0
    aging = arrears_aging(inv_dicts, today)

    if fmt == "csv":
        output = io.StringIO()
        if items:
            fields = ["unit_number", "company_name", "billing_period", "amount_billed", "amount_collected", "balance", "collection_status"]
            writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(items)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=arrears_aging.csv"},
        )
    return {
        "items": items,
        "month": cur_month,
        "summary": {
            "total_billed": round(total_billed, 2),
            "total_collected": round(total_collected, 2),
            "total_arrears": round(total_arrears, 2),
            "collection_rate": round(collection_rate, 4),
        },
        "arrears_aging": aging,
    }


@router.post("/invoices", status_code=201)
def create_invoice(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    inv = RentalInvoice(
        tenant_id=current_user.tenant_id,
        unit_id=uuid.UUID(body["unit_id"]),
        lease_id=uuid.UUID(body["lease_id"]),
        billing_period=date.fromisoformat(body["billing_period"]),
        amount_billed=float(body["amount_billed"]),
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return {"id": str(inv.id)}


@router.post("/collections", status_code=201)
def create_collection(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    col = RentalCollection(
        tenant_id=current_user.tenant_id,
        invoice_id=uuid.UUID(body["invoice_id"]),
        amount_collected=float(body["amount_collected"]),
        collected_date=date.fromisoformat(body["collected_date"]),
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    return {"id": str(col.id)}


# ── expenses ──────────────────────────────────────────────────────────────────

@router.get("/expenses")
def list_expenses(
    company_id: str = Query(None),
    category: str = Query(None),
    fmt: str = Query(None, alias="format"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    q = db.query(RentalExpense).filter(RentalExpense.tenant_id == tid)
    if company_id:
        try:
            q = q.filter(RentalExpense.company_id == uuid.UUID(company_id))
        except ValueError:
            pass
    if category:
        try:
            q = q.filter(RentalExpense.category == RentalExpenseCategory(category))
        except ValueError:
            pass
    expenses = q.order_by(RentalExpense.expense_date.desc()).all()
    result = [_expense_dict(e) for e in expenses]

    if fmt == "csv":
        output = io.StringIO()
        if result:
            writer = csv.DictWriter(output, fieldnames=result[0].keys())
            writer.writeheader()
            writer.writerows(result)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=expenses.csv"},
        )
    return result


@router.post("/expenses", status_code=201)
def create_expense(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    e = RentalExpense(
        tenant_id=current_user.tenant_id,
        property_id=uuid.UUID(body["property_id"]),
        company_id=uuid.UUID(body["company_id"]),
        expense_date=date.fromisoformat(body["expense_date"]),
        category=RentalExpenseCategory(body["category"]),
        amount=float(body["amount"]),
        description=body.get("description"),
        created_by=current_user.email,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return {"id": str(e.id)}


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(
    expense_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    e = db.query(RentalExpense).filter(RentalExpense.id == expense_id, RentalExpense.tenant_id == current_user.tenant_id).first()
    if not e:
        raise HTTPException(404)
    db.delete(e)
    db.commit()


# ── ownership ─────────────────────────────────────────────────────────────────

@router.get("/ownership")
def list_ownership(
    fmt: str = Query(None, alias="format"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    rows = db.query(RentalOwnership).filter(RentalOwnership.tenant_id == tid).all()

    # collect NOI per company
    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()
    co_noi: dict[str, float] = {}
    for co in companies:
        units, inv_dicts, exp_dicts = _load_company_data(co.id, tid, db)
        inv_by_unit: dict[str, list[dict]] = defaultdict(list)
        for inv in inv_dicts:
            inv_by_unit[inv["unit_id"]].append(inv)
        unit_dicts = [_unit_dict(u, inv_by_unit.get(str(u.id), []), today) for u in units]
        summ = company_summary(unit_dicts, inv_dicts, exp_dicts, today)
        co_noi[str(co.id)] = summ["noi_this_month"]

    # group by partner
    by_partner: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        noi = co_noi.get(str(row.company_id), 0.0)
        by_partner[row.partner_name].append({
            "ownership_id": str(row.id),
            "company_id": str(row.company_id),
            "company_name": row.company.company_name if row.company else "",
            "ownership_pct": float(row.ownership_pct),
            "role": row.role.value,
            "noi_this_month": noi,
            "noi_share": round(noi * float(row.ownership_pct), 2),
        })

    result = []
    for partner_name, holdings in by_partner.items():
        total_share = round(sum(h["noi_share"] for h in holdings), 2)
        result.append({
            "partner_name": partner_name,
            "company_count": len(holdings),
            "total_noi_share": total_share,
            "holdings": holdings,
        })

    if fmt == "csv":
        flat = []
        for p in result:
            for h in p["holdings"]:
                flat.append({"partner_name": p["partner_name"], **h})
        output = io.StringIO()
        if flat:
            writer = csv.DictWriter(output, fieldnames=flat[0].keys())
            writer.writeheader()
            writer.writerows(flat)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=partner_distribution.csv"},
        )
    return result


@router.post("/ownership", status_code=201)
def create_ownership(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    o = RentalOwnership(
        tenant_id=current_user.tenant_id,
        company_id=uuid.UUID(body["company_id"]),
        partner_name=body["partner_name"],
        ownership_pct=float(body["ownership_pct"]),
        role=RentalPartnerRole(body.get("role", "limited_partner")),
    )
    db.add(o)
    db.commit()
    db.refresh(o)
    return {"id": str(o.id)}


# ── vacancy ───────────────────────────────────────────────────────────────────

@router.get("/vacancy")
def vacancy_summary(
    fmt: str = Query(None, alias="format"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    today = date.today()
    units = db.query(RentalUnit).filter(
        RentalUnit.tenant_id == tid, RentalUnit.status == "vacant"
    ).all()

    result = []
    for u in units:
        dv = days_vacant(u.status.value, u.status_changed_at, today)
        result.append({
            "id": str(u.id),
            "unit_number": u.unit_number,
            "company_name": u.company.company_name if u.company else "",
            "company_id": str(u.company_id),
            "property_name": u.property.property_name if u.property else "",
            "monthly_rent": float(u.monthly_rent),
            "status_changed_at": u.status_changed_at.isoformat() if u.status_changed_at else None,
            "days_vacant": dv,
        })

    by_company: dict[str, float] = defaultdict(float)
    for r in result:
        by_company[r["company_name"]] += r["monthly_rent"]

    total_loss = sum(r["monthly_rent"] for r in result)
    avg_days = round(sum(r["days_vacant"] or 0 for r in result) / len(result), 1) if result else 0

    if fmt == "csv":
        output = io.StringIO()
        if result:
            writer = csv.DictWriter(output, fieldnames=result[0].keys())
            writer.writeheader()
            writer.writerows(result)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=vacancy_loss.csv"},
        )
    return {
        "vacant_units": result,
        "summary": {
            "count": len(result),
            "total_vacancy_loss": round(total_loss, 2),
            "avg_days_vacant": avg_days,
        },
        "loss_by_company": [{"company_name": k, "vacancy_loss": round(v, 2)} for k, v in by_company.items()],
    }
