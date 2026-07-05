"""
AR/AP aging router — periodic manual entry + QB AR Aging Detail upload.
"""
import os
import tempfile
import uuid
from collections import defaultdict
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.rentals.ar_ap import RentalPayable, RentalReceivable
from models.rentals.models import RentalCompany, RentalUnit
from models.rentals.qb_ar_aging import QBArAgingRow, QBArAgingSnapshot
from services.ar_ap_calculations import ap_total, ar_total, net_working_capital, rent_past_due_pct
from services.qb_ar_aging_parser import match_row_to_unit, parse_qb_ar_aging
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


# ══════════════════════════════════════════════════════════════════════════════
# QB AR AGING DETAIL — upload, preview, confirm, history, latest
# ══════════════════════════════════════════════════════════════════════════════

def _snapshot_dict(s: QBArAgingSnapshot) -> dict:
    return {
        "id":              str(s.id),
        "as_of_date":      s.as_of_date.isoformat(),
        "snapshot_month":  s.snapshot_month,
        "uploaded_at":     s.uploaded_at.isoformat(),
        "uploaded_by":     s.uploaded_by,
        "row_count":       s.row_count,
        "matched_count":   s.matched_count,
        "unmatched_count": s.unmatched_count,
    }


def _row_dict(r: QBArAgingRow) -> dict:
    return {
        "id":                 str(r.id),
        "building":           r.building_name,
        "customer":           r.customer_name,
        "unit_ref":           r.unit_ref,
        "current":            float(r.current_amount),
        "days_1_30":          float(r.days_1_30),
        "days_31_60":         float(r.days_31_60),
        "days_61_90":         float(r.days_61_90),
        "days_91_plus":       float(r.days_91_plus),
        "total":              float(r.total),
        "has_credit":         r.has_credit,
        "matched_unit_id":    str(r.matched_unit_id)    if r.matched_unit_id    else None,
        "matched_company_id": str(r.matched_company_id) if r.matched_company_id else None,
        "is_unmatched":       r.is_unmatched,
    }


@router.post("/ar-ap/qb-aging/preview")
async def qb_aging_preview(
    file: UploadFile = File(...),
    as_of_date: str  = Form(...),           # ISO date "2026-06-30"
    snapshot_month: str = Form(""),         # "Jun-2026" display label
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """
    Parse a QB AR Aging Detail Excel and return a preview with match results.
    Nothing is saved — call /confirm to persist.
    """
    contents = await file.read()
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
    try:
        with os.fdopen(tmp_fd, "wb") as fh:
            fh.write(contents)
        result = parse_qb_ar_aging(tmp_path)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    tid = current_user.tenant_id

    # Load all companies and units for matching
    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()
    all_units  = db.query(RentalUnit).filter(RentalUnit.tenant_id == tid).all()

    co_list = [{"id": str(c.id), "company_name": c.company_name} for c in companies]
    units_by_co: dict[str, list] = defaultdict(list)
    for u in all_units:
        units_by_co[str(u.company_id)].append({
            "id": str(u.id), "unit_number": u.unit_number, "company_id": str(u.company_id)
        })

    matched, unmatched = [], []
    preview_rows = []
    for row in result["rows"]:
        uid, cid = match_row_to_unit(row, units_by_co, co_list)
        enriched = {**row, "matched_unit_id": uid, "matched_company_id": cid, "is_unmatched": uid is None}
        preview_rows.append(enriched)
        if uid is None:
            unmatched.append({"customer": row["customer"], "unit_ref": row.get("unit_ref"), "building": row["building"]})
        else:
            matched.append(row["customer"])

    credit_rows = [r for r in preview_rows if r["has_credit"]]

    # Portfolio-level bucket totals
    totals = {
        "current":     sum(r["current"]     for r in preview_rows),
        "days_1_30":   sum(r["days_1_30"]   for r in preview_rows),
        "days_31_60":  sum(r["days_31_60"]  for r in preview_rows),
        "days_61_90":  sum(r["days_61_90"]  for r in preview_rows),
        "days_91_plus": sum(r["days_91_plus"] for r in preview_rows),
        "total":       sum(r["total"]        for r in preview_rows),
    }

    # Derive snapshot_month from as_of_date if not supplied
    if not snapshot_month:
        try:
            d = date.fromisoformat(as_of_date)
            snapshot_month = d.strftime("%b-%Y")
        except ValueError:
            snapshot_month = as_of_date

    return {
        "as_of_date":      as_of_date,
        "snapshot_month":  snapshot_month,
        "rows":            preview_rows,
        "row_count":       len(preview_rows),
        "matched_count":   len(matched),
        "unmatched_count": len(unmatched),
        "unmatched":       unmatched,
        "credit_rows":     [{"customer": r["customer"], "has_credit": True,
                              "days_61_90": r["days_61_90"], "days_91_plus": r["days_91_plus"]}
                             for r in credit_rows],
        "skipped_subtotals": result["skipped_subtotals"],
        "portfolio_totals":  totals,
    }


@router.post("/ar-ap/qb-aging/confirm", status_code=201)
def qb_aging_confirm(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """
    Persist a QB AR Aging snapshot from preview data.
    Each call creates a NEW snapshot (history preserved).
    """
    as_of_date_str  = body.get("as_of_date", "")
    snapshot_month  = body.get("snapshot_month", "")
    rows_data: list = body.get("rows", [])

    try:
        as_of = date.fromisoformat(as_of_date_str)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid as_of_date — use ISO format YYYY-MM-DD")

    tid = current_user.tenant_id

    matched_count   = sum(1 for r in rows_data if not r.get("is_unmatched"))
    unmatched_count = sum(1 for r in rows_data if r.get("is_unmatched"))

    snapshot = QBArAgingSnapshot(
        tenant_id       = tid,
        as_of_date      = as_of,
        snapshot_month  = snapshot_month or as_of.strftime("%b-%Y"),
        uploaded_by     = current_user.email,
        row_count       = len(rows_data),
        matched_count   = matched_count,
        unmatched_count = unmatched_count,
    )
    db.add(snapshot)
    db.flush()  # get snapshot.id before creating rows

    for r in rows_data:
        uid  = uuid.UUID(r["matched_unit_id"])    if r.get("matched_unit_id")    else None
        cid  = uuid.UUID(r["matched_company_id"]) if r.get("matched_company_id") else None
        row  = QBArAgingRow(
            snapshot_id        = snapshot.id,
            tenant_id          = tid,
            building_name      = r.get("building", ""),
            customer_name      = r.get("customer", ""),
            unit_ref           = r.get("unit_ref"),
            current_amount     = float(r.get("current", 0)),
            days_1_30          = float(r.get("days_1_30", 0)),
            days_31_60         = float(r.get("days_31_60", 0)),
            days_61_90         = float(r.get("days_61_90", 0)),
            days_91_plus       = float(r.get("days_91_plus", 0)),
            total              = float(r.get("total", 0)),
            has_credit         = bool(r.get("has_credit", False)),
            matched_unit_id    = uid,
            matched_company_id = cid,
            is_unmatched       = bool(r.get("is_unmatched", True)),
        )
        db.add(row)

    db.commit()
    db.refresh(snapshot)
    return {"message": f"Saved {len(rows_data)} rows — snapshot {snapshot.snapshot_month}", "snapshot": _snapshot_dict(snapshot)}


@router.get("/ar-ap/qb-aging/snapshots")
def qb_aging_snapshots(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all QB AR aging snapshots for this tenant, newest first."""
    snaps = (
        db.query(QBArAgingSnapshot)
        .filter(QBArAgingSnapshot.tenant_id == current_user.tenant_id)
        .order_by(QBArAgingSnapshot.as_of_date.desc())
        .all()
    )
    return [_snapshot_dict(s) for s in snaps]


@router.get("/ar-ap/qb-aging/latest")
def qb_aging_latest(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return aggregated aging data from the most recent snapshot.
    Also returns per-company breakdowns and trend history.
    """
    tid = current_user.tenant_id

    # All snapshots ordered newest-first
    snapshots = (
        db.query(QBArAgingSnapshot)
        .filter(QBArAgingSnapshot.tenant_id == tid)
        .order_by(QBArAgingSnapshot.as_of_date.desc())
        .all()
    )

    snapshot_count = len(snapshots)

    if not snapshots:
        return {
            "has_data": False,
            "snapshot_count": 0,
            "portfolio_totals": None,
            "by_company": [],
            "unmatched": [],
            "credit_rows": [],
            "trend": [],
            "trend_ready": False,
        }

    latest = snapshots[0]
    rows = (
        db.query(QBArAgingRow)
        .filter(QBArAgingRow.snapshot_id == latest.id)
        .all()
    )

    def _sum_rows(rlist):
        return {
            "current":     round(sum(float(r.current_amount) for r in rlist), 2),
            "days_1_30":   round(sum(float(r.days_1_30)      for r in rlist), 2),
            "days_31_60":  round(sum(float(r.days_31_60)     for r in rlist), 2),
            "days_61_90":  round(sum(float(r.days_61_90)     for r in rlist), 2),
            "days_91_plus": round(sum(float(r.days_91_plus)  for r in rlist), 2),
            "total":       round(sum(float(r.total)           for r in rlist), 2),
        }

    port_totals = _sum_rows(rows)
    port_totals["overdue"] = round(
        port_totals["days_1_30"] + port_totals["days_31_60"] +
        port_totals["days_61_90"] + port_totals["days_91_plus"], 2
    )

    # Weighted DSO estimate using bucket midpoints
    # Current=0d, 1-30=15d, 31-60=45d, 61-90=75d, 91+=105d
    total_bal = port_totals["total"]
    if total_bal > 0:
        weighted = (
            port_totals["current"]     * 0   +
            port_totals["days_1_30"]   * 15  +
            port_totals["days_31_60"]  * 45  +
            port_totals["days_61_90"]  * 75  +
            port_totals["days_91_plus"]* 105
        ) / total_bal
        dso_estimate = round(weighted, 1)
    else:
        dso_estimate = None

    # By-company breakdown (matched rows only)
    co_groups: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.matched_company_id:
            co_groups[str(r.matched_company_id)].append(r)

    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()
    co_map = {str(c.id): c.company_name for c in companies}

    by_company = []
    for cid, crows in co_groups.items():
        s = _sum_rows(crows)
        s["overdue"] = round(s["days_1_30"] + s["days_31_60"] + s["days_61_90"] + s["days_91_plus"], 2)
        by_company.append({
            "company_id":   cid,
            "company_name": co_map.get(cid, cid),
            **s,
        })
    by_company.sort(key=lambda x: x["overdue"], reverse=True)

    unmatched = [_row_dict(r) for r in rows if r.is_unmatched]
    credit_rows = [_row_dict(r) for r in rows if r.has_credit]

    # Trend: aggregate bucket totals per snapshot (all snapshots, not just latest)
    trend = []
    for snap in reversed(snapshots):  # oldest first
        snap_rows = db.query(QBArAgingRow).filter(QBArAgingRow.snapshot_id == snap.id).all()
        s = _sum_rows(snap_rows)
        s["overdue"] = round(s["days_1_30"] + s["days_31_60"] + s["days_61_90"] + s["days_91_plus"], 2)
        s["month"] = snap.snapshot_month
        s["as_of_date"] = snap.as_of_date.isoformat()
        trend.append(s)

    return {
        "has_data":        True,
        "snapshot_count":  snapshot_count,
        "latest_snapshot": _snapshot_dict(latest),
        "portfolio_totals": port_totals,
        "dso_estimate":    dso_estimate,
        "by_company":      by_company,
        "unmatched":       unmatched,
        "credit_rows":     credit_rows,
        "trend":           trend,
        "trend_ready":     snapshot_count >= 3,
    }


@router.delete("/ar-ap/qb-aging/snapshots/{snap_id}", status_code=204)
def delete_qb_snapshot(
    snap_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    snap = db.query(QBArAgingSnapshot).filter(
        QBArAgingSnapshot.id == snap_id,
        QBArAgingSnapshot.tenant_id == current_user.tenant_id,
    ).first()
    if not snap:
        raise HTTPException(404)
    db.delete(snap)
    db.commit()
