"""
AR/AP aging router — periodic manual entry from entity aging reports.
Not auto-derived from individual invoices/bills.
"""
import uuid
from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.rentals.ar_ap import RentalPayable, RentalReceivable
from models.rentals.models import RentalCompany, RentalUnit
from services.ar_ap_calculations import ap_total, ar_total, net_working_capital, rent_past_due_pct
from services.rental_calculations import company_summary

router = APIRouter(prefix="/api/rentals", tags=["rentals-arap"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _rec_dict(r: RentalReceivable) -> dict:
    return {
        "id":             str(r.id),
        "company_id":     str(r.company_id),
        "as_of_date":     r.as_of_date.isoformat(),
        "current_amount": float(r.current_amount),
        "days_1_30":      float(r.days_1_30),
        "days_31_60":     float(r.days_31_60),
        "days_61_90":     float(r.days_61_90),
        "days_90_plus":   float(r.days_90_plus),
    }


def _pay_dict(p: RentalPayable) -> dict:
    return {
        "id":             str(p.id),
        "company_id":     str(p.company_id),
        "vendor_id":      str(p.vendor_id),
        "as_of_date":     p.as_of_date.isoformat(),
        "current_amount": float(p.current_amount),
        "days_1_30":      float(p.days_1_30),
        "days_31_60":     float(p.days_31_60),
        "days_60_plus":   float(p.days_60_plus),
    }


def _agg_payables(payables: list[RentalPayable]) -> dict:
    """Sum AP buckets across multiple payable records (e.g., multiple vendors for one company)."""
    agg = {"current_amount": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_60_plus": 0.0}
    for p in payables:
        agg["current_amount"] += float(p.current_amount)
        agg["days_1_30"]      += float(p.days_1_30)
        agg["days_31_60"]     += float(p.days_31_60)
        agg["days_60_plus"]   += float(p.days_60_plus)
    return agg


def _latest_receivable(recs: list[RentalReceivable]) -> RentalReceivable | None:
    """Return the most recent (by as_of_date) receivable record."""
    if not recs:
        return None
    return max(recs, key=lambda r: r.as_of_date)


def _latest_payables_per_vendor(pays: list[RentalPayable]) -> list[RentalPayable]:
    """For each (company_id, vendor_id) pair, keep only the most recent record."""
    by_vendor: dict[tuple, RentalPayable] = {}
    for p in pays:
        key = (str(p.company_id), str(p.vendor_id))
        if key not in by_vendor or p.as_of_date > by_vendor[key].as_of_date:
            by_vendor[key] = p
    return list(by_vendor.values())


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ReceivableCreate(BaseModel):
    company_id: str
    as_of_date: str
    current_amount: float = 0.0
    days_1_30: float = 0.0
    days_31_60: float = 0.0
    days_61_90: float = 0.0
    days_90_plus: float = 0.0


class ReceivableUpdate(BaseModel):
    as_of_date: Optional[str] = None
    current_amount: Optional[float] = None
    days_1_30: Optional[float] = None
    days_31_60: Optional[float] = None
    days_61_90: Optional[float] = None
    days_90_plus: Optional[float] = None


class PayableCreate(BaseModel):
    company_id: str
    vendor_id: str
    as_of_date: str
    current_amount: float = 0.0
    days_1_30: float = 0.0
    days_31_60: float = 0.0
    days_60_plus: float = 0.0


class PayableUpdate(BaseModel):
    as_of_date: Optional[str] = None
    current_amount: Optional[float] = None
    days_1_30: Optional[float] = None
    days_31_60: Optional[float] = None
    days_60_plus: Optional[float] = None


# ── AR (Receivables) endpoints ────────────────────────────────────────────────

@router.get("/ar-ap/receivables")
def list_receivables(
    company_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(RentalReceivable).filter(
        RentalReceivable.tenant_id == current_user.tenant_id
    )
    if company_id:
        q = q.filter(RentalReceivable.company_id == uuid.UUID(company_id))
    recs = q.order_by(RentalReceivable.as_of_date.desc()).all()
    return [_rec_dict(r) for r in recs]


@router.post("/ar-ap/receivables", status_code=201)
def create_receivable(
    body: ReceivableCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    company = db.query(RentalCompany).filter(
        RentalCompany.id == uuid.UUID(body.company_id),
        RentalCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    rec = RentalReceivable(
        tenant_id=current_user.tenant_id,
        company_id=uuid.UUID(body.company_id),
        as_of_date=date.fromisoformat(body.as_of_date),
        current_amount=body.current_amount,
        days_1_30=body.days_1_30,
        days_31_60=body.days_31_60,
        days_61_90=body.days_61_90,
        days_90_plus=body.days_90_plus,
        created_by=current_user.email,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return _rec_dict(rec)


@router.put("/ar-ap/receivables/{rec_id}")
def update_receivable(
    rec_id: uuid.UUID,
    body: ReceivableUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    rec = db.query(RentalReceivable).filter(
        RentalReceivable.id == rec_id,
        RentalReceivable.tenant_id == current_user.tenant_id,
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Record not found")

    data = body.model_dump(exclude_none=True)
    if "as_of_date" in data:
        rec.as_of_date = date.fromisoformat(data.pop("as_of_date"))
    for field, val in data.items():
        setattr(rec, field, val)
    db.commit()
    db.refresh(rec)
    return _rec_dict(rec)


@router.delete("/ar-ap/receivables/{rec_id}", status_code=204)
def delete_receivable(
    rec_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    rec = db.query(RentalReceivable).filter(
        RentalReceivable.id == rec_id,
        RentalReceivable.tenant_id == current_user.tenant_id,
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(rec)
    db.commit()


# ── AP (Payables) endpoints ───────────────────────────────────────────────────

@router.get("/ar-ap/payables")
def list_payables(
    company_id: Optional[str] = None,
    vendor_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(RentalPayable).filter(
        RentalPayable.tenant_id == current_user.tenant_id
    )
    if company_id:
        q = q.filter(RentalPayable.company_id == uuid.UUID(company_id))
    if vendor_id:
        q = q.filter(RentalPayable.vendor_id == uuid.UUID(vendor_id))
    pays = q.order_by(RentalPayable.as_of_date.desc()).all()
    return [_pay_dict(p) for p in pays]


@router.post("/ar-ap/payables", status_code=201)
def create_payable(
    body: PayableCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    company = db.query(RentalCompany).filter(
        RentalCompany.id == uuid.UUID(body.company_id),
        RentalCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    pay = RentalPayable(
        tenant_id=current_user.tenant_id,
        company_id=uuid.UUID(body.company_id),
        vendor_id=uuid.UUID(body.vendor_id),
        as_of_date=date.fromisoformat(body.as_of_date),
        current_amount=body.current_amount,
        days_1_30=body.days_1_30,
        days_31_60=body.days_31_60,
        days_60_plus=body.days_60_plus,
        created_by=current_user.email,
    )
    db.add(pay)
    db.commit()
    db.refresh(pay)
    return _pay_dict(pay)


@router.put("/ar-ap/payables/{pay_id}")
def update_payable(
    pay_id: uuid.UUID,
    body: PayableUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pay = db.query(RentalPayable).filter(
        RentalPayable.id == pay_id,
        RentalPayable.tenant_id == current_user.tenant_id,
    ).first()
    if not pay:
        raise HTTPException(status_code=404, detail="Record not found")

    data = body.model_dump(exclude_none=True)
    if "as_of_date" in data:
        pay.as_of_date = date.fromisoformat(data.pop("as_of_date"))
    for field, val in data.items():
        setattr(pay, field, val)
    db.commit()
    db.refresh(pay)
    return _pay_dict(pay)


@router.delete("/ar-ap/payables/{pay_id}", status_code=204)
def delete_payable(
    pay_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pay = db.query(RentalPayable).filter(
        RentalPayable.id == pay_id,
        RentalPayable.tenant_id == current_user.tenant_id,
    ).first()
    if not pay:
        raise HTTPException(status_code=404, detail="Record not found")
    db.delete(pay)
    db.commit()


# ── Portfolio view ────────────────────────────────────────────────────────────

@router.get("/ar-ap/portfolio")
def arap_portfolio(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Portfolio-wide AR/AP rollup across all companies.
    Uses the most recent as_of_date snapshot per company for AR,
    and most recent per (company, vendor) for AP.
    """
    companies = db.query(RentalCompany).filter(
        RentalCompany.tenant_id == current_user.tenant_id
    ).order_by(RentalCompany.company_name).all()

    all_recs = db.query(RentalReceivable).filter(
        RentalReceivable.tenant_id == current_user.tenant_id
    ).all()
    all_pays = db.query(RentalPayable).filter(
        RentalPayable.tenant_id == current_user.tenant_id
    ).all()

    # Group by company
    recs_by_co: dict[str, list[RentalReceivable]] = defaultdict(list)
    for r in all_recs:
        recs_by_co[str(r.company_id)].append(r)

    pays_by_co: dict[str, list[RentalPayable]] = defaultdict(list)
    for p in all_pays:
        pays_by_co[str(p.company_id)].append(p)

    # GPR per company for rent_past_due_pct
    units_by_co: dict[str, list] = defaultdict(list)
    all_units = db.query(RentalUnit).filter(
        RentalUnit.tenant_id == current_user.tenant_id
    ).all()
    for u in all_units:
        units_by_co[str(u.company_id)].append(u)

    entities = []
    port_ar  = {"current_amount": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_90_plus": 0.0}
    port_ap  = {"current_amount": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_60_plus": 0.0}
    port_ar_total = 0.0
    port_ap_total = 0.0
    port_gpr = 0.0

    for co in companies:
        cid = str(co.id)
        latest_rec = _latest_receivable(recs_by_co.get(cid, []))
        latest_pays = _latest_payables_per_vendor(pays_by_co.get(cid, []))
        ap_agg = _agg_payables(latest_pays)

        ar_d = {"current_amount": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_90_plus": 0.0}
        if latest_rec:
            ar_d = {
                "current_amount": float(latest_rec.current_amount),
                "days_1_30":      float(latest_rec.days_1_30),
                "days_31_60":     float(latest_rec.days_31_60),
                "days_61_90":     float(latest_rec.days_61_90),
                "days_90_plus":   float(latest_rec.days_90_plus),
            }

        ar_t = ar_total(ar_d)
        ap_t = ap_total(ap_agg)
        gpr  = sum(float(u.monthly_rent) for u in units_by_co.get(cid, []))

        # Accumulate portfolio totals
        for k in port_ar:
            port_ar[k] += ar_d.get(k, 0.0)
        for k in port_ap:
            port_ap[k] += ap_agg.get(k, 0.0)
        port_ar_total += ar_t
        port_ap_total += ap_t
        port_gpr += gpr

        entities.append({
            "company_id":   cid,
            "company_name": co.company_name,
            "as_of_date":   latest_rec.as_of_date.isoformat() if latest_rec else None,
            "ar": ar_d,
            "ap": ap_agg,
            "ar_total":     ar_t,
            "ap_total":     ap_t,
            "nwc":          net_working_capital(ar_t, ap_t),
            "rent_past_due_pct": rent_past_due_pct(ar_d, gpr),
        })

    port_past_due = sum(port_ar.get(k, 0.0) for k in ("days_1_30", "days_31_60", "days_61_90", "days_90_plus"))
    return {
        "entities": entities,
        "portfolio_totals": {
            "ar": port_ar,
            "ap": port_ap,
            "ar_total":    round(port_ar_total, 2),
            "ap_total":    round(port_ap_total, 2),
            "nwc":         round(net_working_capital(port_ar_total, port_ap_total), 2),
            "rent_past_due_pct": round(port_past_due / port_gpr, 4) if port_gpr else None,
        },
    }


# ── Company-scoped AR/AP detail ───────────────────────────────────────────────

@router.get("/companies/{company_id}/ar-ap")
def company_arap(
    company_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    company = db.query(RentalCompany).filter(
        RentalCompany.id == company_id,
        RentalCompany.tenant_id == current_user.tenant_id,
    ).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    recs  = db.query(RentalReceivable).filter(
        RentalReceivable.tenant_id == current_user.tenant_id,
        RentalReceivable.company_id == company_id,
    ).order_by(RentalReceivable.as_of_date.desc()).all()

    pays  = db.query(RentalPayable).filter(
        RentalPayable.tenant_id == current_user.tenant_id,
        RentalPayable.company_id == company_id,
    ).order_by(RentalPayable.as_of_date.desc()).all()

    units = db.query(RentalUnit).filter(
        RentalUnit.tenant_id == current_user.tenant_id,
        RentalUnit.company_id == company_id,
    ).all()
    gpr = sum(float(u.monthly_rent) for u in units)

    latest_rec  = _latest_receivable(recs)
    latest_pays = _latest_payables_per_vendor(pays)
    ap_agg      = _agg_payables(latest_pays)

    ar_d = {"current_amount": 0.0, "days_1_30": 0.0, "days_31_60": 0.0, "days_61_90": 0.0, "days_90_plus": 0.0}
    if latest_rec:
        ar_d = {
            "current_amount": float(latest_rec.current_amount),
            "days_1_30":      float(latest_rec.days_1_30),
            "days_31_60":     float(latest_rec.days_31_60),
            "days_61_90":     float(latest_rec.days_61_90),
            "days_90_plus":   float(latest_rec.days_90_plus),
        }

    ar_t = ar_total(ar_d)
    ap_t = ap_total(ap_agg)

    return {
        "company_id":        str(company_id),
        "company_name":      company.company_name,
        "ar": ar_d,
        "ap": ap_agg,
        "ar_total":          ar_t,
        "ap_total":          ap_t,
        "nwc":               net_working_capital(ar_t, ap_t),
        "rent_past_due_pct": rent_past_due_pct(ar_d, gpr),
        "ar_history":        [_rec_dict(r) for r in recs],
        "ap_records":        [_pay_dict(p) for p in pays],
    }
