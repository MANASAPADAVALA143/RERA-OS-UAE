"""
AR/AP aging router — periodic manual entry + QB AR/AP Aging Detail upload.
"""
import os
import tempfile
import uuid
from collections import defaultdict
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.rentals.ar_ap import RentalPayable, RentalReceivable
from models.rentals.models import RentalCompany, RentalLease, RentalUnit
from models.rentals.qb_ar_aging import QBArAgingRow, QBArAgingSnapshot
from models.rentals.qb_ap_aging import QBApAgingRow, QBApAgingSnapshot
from models.rentals.vendor import RentalVendor
from services.ar_ap_calculations import ap_total, ar_total, net_working_capital, rent_past_due_pct
from services.qb_ar_aging_parser import match_row_to_unit, parse_qb_ar_aging
from services.qb_ap_aging_parser import match_vendor, normalize_vendor_name, parse_qb_ap_aging
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


def _enrich_aging_preview_rows(
    parse_result: dict,
    *,
    companies: list,
    units_by_co: dict,
    force_company_id: Optional[str] = None,
) -> tuple[list, list, list, list]:
    """Return (preview_rows, matched_names, unmatched_list, credit_rows)."""
    co_list = companies
    if force_company_id:
        co_list = [c for c in companies if c["id"] == force_company_id]
        if not co_list:
            raise HTTPException(status_code=400, detail=f"Unknown company_id: {force_company_id}")

    co_name = co_list[0]["company_name"] if force_company_id and co_list else ""

    matched, unmatched = [], []
    preview_rows = []
    for row in parse_result["rows"]:
        uid, cid = match_row_to_unit(row, units_by_co, co_list if force_company_id else companies)
        if force_company_id and cid is None:
            cid = force_company_id
            if not row.get("building"):
                row = {**row, "building": co_name}
        enriched = {
            **row,
            "matched_unit_id": uid,
            "matched_company_id": cid,
            "is_unmatched": uid is None,
        }
        preview_rows.append(enriched)
        if uid is None:
            unmatched.append({
                "customer": row["customer"],
                "unit_ref": row.get("unit_ref"),
                "building": row.get("building", ""),
                "company_id": cid,
            })
        else:
            matched.append(row["customer"])

    credit_rows = [
        {
            "customer": r["customer"],
            "has_credit": True,
            "days_61_90": r["days_61_90"],
            "days_91_plus": r["days_91_plus"],
        }
        for r in preview_rows if r["has_credit"]
    ]
    return preview_rows, matched, unmatched, credit_rows


def _portfolio_totals_from_rows(preview_rows: list) -> dict:
    return {
        "current":      round(sum(r["current"]      for r in preview_rows), 2),
        "days_1_30":    round(sum(r["days_1_30"]    for r in preview_rows), 2),
        "days_31_60":   round(sum(r["days_31_60"]   for r in preview_rows), 2),
        "days_61_90":   round(sum(r["days_61_90"]   for r in preview_rows), 2),
        "days_91_plus": round(sum(r["days_91_plus"]  for r in preview_rows), 2),
        "total":        round(sum(r["total"]         for r in preview_rows), 2),
    }


@router.post("/ar-ap/qb-aging/preview")
async def qb_aging_preview(
    file: UploadFile = File(...),
    as_of_date: str  = Form(...),           # ISO date "2026-06-30"
    snapshot_month: str = Form(""),         # "Jun-2026" display label
    company_id: str = Form(""),             # optional — company-wise aging file
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

    force_cid = company_id.strip() or None
    preview_rows, matched, unmatched, credit_rows = _enrich_aging_preview_rows(
        result, companies=co_list, units_by_co=units_by_co, force_company_id=force_cid,
    )

    totals = _portfolio_totals_from_rows(preview_rows)

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
        "credit_rows":     credit_rows,
        "skipped_subtotals": result["skipped_subtotals"],
        "portfolio_totals":  totals,
        "company_id":      force_cid,
    }


@router.post("/ar-ap/qb-aging/preview-batch")
async def qb_aging_preview_batch(
    files: List[UploadFile] = File(...),
    company_ids: List[str] = Form(...),
    as_of_date: str = Form(...),
    snapshot_month: str = Form(""),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """
    Parse multiple company-wise AR Aging Summary files in one preview.
    Each file is paired with a company_id (same order). Use empty company_id for portfolio-wide QB export.
    """
    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required.")
    if len(company_ids) != len(files):
        raise HTTPException(
            status_code=400,
            detail=f"company_ids length ({len(company_ids)}) must match files ({len(files)}).",
        )

    tid = current_user.tenant_id
    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()
    all_units = db.query(RentalUnit).filter(RentalUnit.tenant_id == tid).all()
    co_list = [{"id": str(c.id), "company_name": c.company_name} for c in companies]
    units_by_co: dict[str, list] = defaultdict(list)
    for u in all_units:
        units_by_co[str(u.company_id)].append({
            "id": str(u.id), "unit_number": u.unit_number, "company_id": str(u.company_id)
        })

    all_preview_rows: list = []
    all_matched: list = []
    all_unmatched: list = []
    all_credit: list = []
    skipped_subtotals = 0
    file_summaries = []
    errors = []

    for upload, cid_raw in zip(files, company_ids):
        force_cid = cid_raw.strip() or None
        if force_cid and force_cid not in {c["id"] for c in co_list}:
            errors.append(f"{upload.filename}: unknown company")
            continue

        contents = await upload.read()
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
        try:
            with os.fdopen(tmp_fd, "wb") as fh:
                fh.write(contents)
            result = parse_qb_ar_aging(tmp_path)
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        if result.get("error"):
            errors.append(f"{upload.filename}: {result['error']}")
            continue

        skipped_subtotals += result.get("skipped_subtotals", 0)
        rows, matched, unmatched, credit_rows = _enrich_aging_preview_rows(
            result, companies=co_list, units_by_co=units_by_co, force_company_id=force_cid,
        )
        all_preview_rows.extend(rows)
        all_matched.extend(matched)
        all_unmatched.extend(unmatched)
        all_credit.extend(credit_rows)

        co_label = next((c["company_name"] for c in co_list if c["id"] == force_cid), "Portfolio")
        file_summaries.append({
            "filename": upload.filename,
            "company_id": force_cid,
            "company_name": co_label,
            "row_count": len(rows),
        })

    if errors and not all_preview_rows:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    if not snapshot_month:
        try:
            d = date.fromisoformat(as_of_date)
            snapshot_month = d.strftime("%b-%Y")
        except ValueError:
            snapshot_month = as_of_date

    totals = _portfolio_totals_from_rows(all_preview_rows)

    return {
        "as_of_date": as_of_date,
        "snapshot_month": snapshot_month,
        "rows": all_preview_rows,
        "row_count": len(all_preview_rows),
        "matched_count": len(all_matched),
        "unmatched_count": len(all_unmatched),
        "unmatched": all_unmatched,
        "credit_rows": all_credit,
        "skipped_subtotals": skipped_subtotals,
        "portfolio_totals": totals,
        "file_summaries": file_summaries,
        "parse_errors": errors,
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

    from services.qb_dso import (
        credit_balance_from_buckets,
        estimate_dso_from_buckets,
        positive_ar_total,
    )

    def _enrich_totals(raw: dict) -> dict:
        enriched = {**raw}
        enriched["credit_balance"] = credit_balance_from_buckets(raw)
        enriched["positive_ar_total"] = positive_ar_total(raw)
        return enriched

    port_totals = _enrich_totals(_sum_rows(rows))
    port_totals["overdue"] = round(
        max(0, port_totals["days_1_30"]) + max(0, port_totals["days_31_60"]) +
        max(0, port_totals["days_61_90"]) + max(0, port_totals["days_91_plus"]), 2
    )

    dso_estimate = estimate_dso_from_buckets(port_totals)

    # By-company breakdown (matched rows only)
    co_groups: dict[str, list] = defaultdict(list)
    for r in rows:
        if r.matched_company_id:
            co_groups[str(r.matched_company_id)].append(r)

    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()
    co_map = {str(c.id): c.company_name for c in companies}

    by_company = []
    for cid, crows in co_groups.items():
        s = _enrich_totals(_sum_rows(crows))
        s["overdue"] = round(
            max(0, s["days_1_30"]) + max(0, s["days_31_60"]) +
            max(0, s["days_61_90"]) + max(0, s["days_91_plus"]), 2
        )
        by_company.append({
            "company_id":   cid,
            "company_name": co_map.get(cid, cid),
            "dso_estimate": estimate_dso_from_buckets(s),
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
        s["overdue"] = round(
            max(0, s["days_1_30"]) + max(0, s["days_31_60"]) +
            max(0, s["days_61_90"]) + max(0, s["days_91_plus"]), 2
        )
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


@router.get("/ar-ap/qb-aging/tenants")
def qb_aging_tenants(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return tenant-level rows from the most recent QB AR Aging snapshot.
    Enriches each row with lease_end from RentalLease where a unit match exists.
    Last payment date is not captured in the QB AR Aging export — reported honestly as null.
    """
    tid = current_user.tenant_id
    latest = (
        db.query(QBArAgingSnapshot)
        .filter(QBArAgingSnapshot.tenant_id == tid)
        .order_by(QBArAgingSnapshot.as_of_date.desc())
        .first()
    )
    if not latest:
        return {"has_data": False, "rows": [], "snapshot_month": None}

    rows = (
        db.query(QBArAgingRow)
        .filter(QBArAgingRow.snapshot_id == latest.id)
        .all()
    )

    # Build lease_end map: unit_id → latest active lease_end
    unit_ids = [r.matched_unit_id for r in rows if r.matched_unit_id]
    lease_map: dict[str, str] = {}
    if unit_ids:
        leases = (
            db.query(RentalLease)
            .filter(
                RentalLease.unit_id.in_(unit_ids),
                RentalLease.tenant_id == tid,
            )
            .order_by(RentalLease.lease_end.desc())
            .all()
        )
        for lse in leases:
            uid = str(lse.unit_id)
            if uid not in lease_map:
                lease_map[uid] = lse.lease_end.isoformat()

    result = []
    for r in rows:
        uid = str(r.matched_unit_id) if r.matched_unit_id else None
        lease_end = lease_map.get(uid) if uid else None

        current   = float(r.current_amount)
        d130      = float(r.days_1_30)
        d3160     = float(r.days_31_60)
        d6190     = float(r.days_61_90)
        d91p      = float(r.days_91_plus)
        total     = float(r.total)
        overdue   = round(d130 + d3160 + d6190 + d91p, 2)

        if d6190 > 0 or d91p > 0:
            action_status = "Review"
        elif d3160 > 0:
            action_status = "Monitor"
        else:
            action_status = "Current"

        result.append({
            "customer":           r.customer_name,
            "unit_ref":           r.unit_ref or "—",
            "building":           r.building_name,
            "lease_end":          lease_end,          # None → "Not tracked" on frontend
            "last_payment_date":  None,               # Not in QB AR Aging export
            "current":            current,
            "days_1_30":          d130,
            "days_31_60":         d3160,
            "days_61_90":         d6190,
            "days_91_plus":       d91p,
            "total":              total,
            "overdue":            overdue,
            "has_credit":         r.has_credit,
            "is_unmatched":       r.is_unmatched,
            "matched_company_id": str(r.matched_company_id) if r.matched_company_id else None,
            "action_status":      action_status,
        })

    return {
        "has_data":       True,
        "snapshot_month": latest.snapshot_month,
        "rows":           result,
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


# ══════════════════════════════════════════════════════════════════════════════
#  QB AP AGING DETAIL BY VENDOR — upload endpoints
# ══════════════════════════════════════════════════════════════════════════════

def _ap_snapshot_dict(s: QBApAgingSnapshot) -> dict:
    return {
        "id":             str(s.id),
        "as_of_date":     s.as_of_date.isoformat(),
        "snapshot_month": s.snapshot_month,
        "uploaded_at":    s.uploaded_at.isoformat(),
        "uploaded_by":    s.uploaded_by,
        "row_count":      s.row_count,
        "matched_count":  s.matched_count,
        "seeded_count":   s.seeded_count,
    }


@router.post("/ar-ap/qb-ap-aging/preview")
def qb_ap_aging_preview(
    file: UploadFile = File(...),
    as_of_date: str  = Form(...),
    snapshot_month: str = Form(""),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Parse a QB AP Aging Detail by Vendor Excel file and return a preview.
    Shows which vendors will be matched vs. seeded (newly created).
    Does NOT write to the database.
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name

    try:
        result = parse_qb_ap_aging(tmp_path)
    finally:
        os.unlink(tmp_path)

    if result["error"]:
        raise HTTPException(status_code=422, detail=result["error"])

    tid = current_user.tenant_id

    # Load existing vendors for matching
    existing_vendors = db.query(RentalVendor).filter(RentalVendor.tenant_id == tid).all()
    vendor_list = [{"id": str(v.id), "vendor_name": v.vendor_name} for v in existing_vendors]

    matched, to_seed = [], []
    preview_rows = []

    # Track which names would be seeded (de-duplicate across rows)
    seeded_names: dict[str, str] = {}  # normalized_name -> display_name

    for row in result["rows"]:
        vid = match_vendor(row["vendor_name"], vendor_list)
        if vid:
            matched.append(row["vendor_name"])
            preview_rows.append({**row, "vendor_id": vid, "was_seeded": False})
        else:
            norm = normalize_vendor_name(row["vendor_name"])
            if norm not in seeded_names:
                seeded_names[norm] = row["vendor_name"]
                to_seed.append(row["vendor_name"])
            preview_rows.append({**row, "vendor_id": None, "was_seeded": True})

    credit_rows = [r for r in preview_rows if r["has_credit"]]

    totals = {
        "current":     round(sum(r["current"]     for r in preview_rows), 2),
        "days_1_30":   round(sum(r["days_1_30"]   for r in preview_rows), 2),
        "days_31_60":  round(sum(r["days_31_60"]  for r in preview_rows), 2),
        "days_60_plus":round(sum(r["days_60_plus"]for r in preview_rows), 2),
        "total":       round(sum(r["total"]        for r in preview_rows), 2),
    }
    totals["overdue"] = round(totals["days_1_30"] + totals["days_31_60"] + totals["days_60_plus"], 2)

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
        "seeded_count":    len(to_seed),
        "vendors_to_seed": to_seed,
        "credit_rows":     [{"vendor_name": r["vendor_name"], "has_credit": True,
                              "days_31_60": r["days_31_60"], "days_60_plus": r["days_60_plus"]}
                             for r in credit_rows],
        "skipped_subtotals": result["skipped_subtotals"],
        "portfolio_totals":  totals,
    }


@router.post("/ar-ap/qb-ap-aging/confirm", status_code=201)
def qb_ap_aging_confirm(
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """
    Persist QB AP Aging snapshot + rows.
    Seeds new r_vendors records for unmatched vendor names.
    Also upserts r_payables so AP Dashboard/Vendor Risk show live data.
    """
    as_of_date_str = body.get("as_of_date", "")
    snapshot_month = body.get("snapshot_month", "")
    rows_data: list = body.get("rows", [])

    try:
        as_of = date.fromisoformat(as_of_date_str)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid as_of_date — use YYYY-MM-DD")

    tid = current_user.tenant_id

    # ── Step 1: seed new vendors ──────────────────────────────────────────────
    existing_vendors = db.query(RentalVendor).filter(RentalVendor.tenant_id == tid).all()
    vendor_map: dict[str, uuid.UUID] = {
        normalize_vendor_name(v.vendor_name): v.id for v in existing_vendors
    }

    seeded_ids: dict[str, uuid.UUID] = {}
    for r in rows_data:
        if r.get("was_seeded"):
            norm = normalize_vendor_name(r["vendor_name"])
            if norm not in vendor_map and norm not in seeded_ids:
                new_v = RentalVendor(
                    tenant_id=tid,
                    vendor_name=r["vendor_name"],
                    created_by=current_user.email,
                )
                db.add(new_v)
                db.flush()
                vendor_map[norm] = new_v.id
                seeded_ids[norm] = new_v.id

    matched_count = sum(1 for r in rows_data if not r.get("was_seeded"))
    seeded_count  = len(seeded_ids)

    # ── Step 2: create snapshot ───────────────────────────────────────────────
    snapshot = QBApAgingSnapshot(
        tenant_id      = tid,
        as_of_date     = as_of,
        snapshot_month = snapshot_month or as_of.strftime("%b-%Y"),
        uploaded_by    = current_user.email,
        row_count      = len(rows_data),
        matched_count  = matched_count,
        seeded_count   = seeded_count,
    )
    db.add(snapshot)
    db.flush()

    # ── Step 3: save rows + upsert r_payables ────────────────────────────────
    # Load companies for payable association (use first company as default if only one)
    companies = db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).all()
    default_co_id = companies[0].id if len(companies) == 1 else None

    for r in rows_data:
        norm = normalize_vendor_name(r["vendor_name"])
        vid = vendor_map.get(norm)
        if vid is None:
            # Shouldn't happen — just in case
            continue

        row = QBApAgingRow(
            snapshot_id    = snapshot.id,
            tenant_id      = tid,
            vendor_name    = r["vendor_name"],
            current_amount = float(r.get("current",      0)),
            days_1_30      = float(r.get("days_1_30",    0)),
            days_31_60     = float(r.get("days_31_60",   0)),
            days_60_plus   = float(r.get("days_60_plus", 0)),
            total          = float(r.get("total",         0)),
            has_credit     = bool(r.get("has_credit",    False)),
            vendor_id      = vid,
            was_seeded     = bool(r.get("was_seeded",    False)),
        )
        db.add(row)

        # Upsert r_payables so AP Dashboard picks up the data immediately
        if default_co_id:
            existing_pay = db.query(RentalPayable).filter(
                RentalPayable.tenant_id  == tid,
                RentalPayable.company_id == default_co_id,
                RentalPayable.vendor_id  == vid,
                RentalPayable.as_of_date == as_of,
            ).first()
            if existing_pay:
                existing_pay.current_amount = float(r.get("current",      0))
                existing_pay.days_1_30      = float(r.get("days_1_30",    0))
                existing_pay.days_31_60     = float(r.get("days_31_60",   0))
                existing_pay.days_60_plus   = float(r.get("days_60_plus", 0))
            else:
                db.add(RentalPayable(
                    tenant_id      = tid,
                    company_id     = default_co_id,
                    vendor_id      = vid,
                    as_of_date     = as_of,
                    current_amount = float(r.get("current",      0)),
                    days_1_30      = float(r.get("days_1_30",    0)),
                    days_31_60     = float(r.get("days_31_60",   0)),
                    days_60_plus   = float(r.get("days_60_plus", 0)),
                    created_by     = current_user.email,
                ))

    db.commit()
    db.refresh(snapshot)
    return {
        "message":  f"Saved {len(rows_data)} rows — {seeded_count} vendors seeded — snapshot {snapshot.snapshot_month}",
        "snapshot": _ap_snapshot_dict(snapshot),
        "seeded_vendor_count": seeded_count,
        "matched_vendor_count": matched_count,
    }


@router.get("/ar-ap/qb-ap-aging/snapshots")
def qb_ap_aging_snapshots(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    snaps = (
        db.query(QBApAgingSnapshot)
        .filter(QBApAgingSnapshot.tenant_id == current_user.tenant_id)
        .order_by(QBApAgingSnapshot.as_of_date.desc())
        .all()
    )
    return [_ap_snapshot_dict(s) for s in snaps]


@router.get("/ar-ap/qb-ap-aging/latest")
def qb_ap_aging_latest(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tid = current_user.tenant_id
    snapshots = (
        db.query(QBApAgingSnapshot)
        .filter(QBApAgingSnapshot.tenant_id == tid)
        .order_by(QBApAgingSnapshot.as_of_date.desc())
        .all()
    )

    if not snapshots:
        return {"has_data": False, "snapshot_count": 0, "portfolio_totals": None,
                "by_vendor": [], "credit_rows": [], "trend": [], "trend_ready": False}

    latest = snapshots[0]
    rows = db.query(QBApAgingRow).filter(QBApAgingRow.snapshot_id == latest.id).all()

    def _sum_ap(rlist):
        return {
            "current":     round(sum(float(r.current_amount) for r in rlist), 2),
            "days_1_30":   round(sum(float(r.days_1_30)      for r in rlist), 2),
            "days_31_60":  round(sum(float(r.days_31_60)     for r in rlist), 2),
            "days_60_plus":round(sum(float(r.days_60_plus)   for r in rlist), 2),
            "total":       round(sum(float(r.total)           for r in rlist), 2),
        }

    port = _sum_ap(rows)
    port["overdue"] = round(port["days_1_30"] + port["days_31_60"] + port["days_60_plus"], 2)

    # DPO estimate: weighted by bucket midpoints (0, 15, 45, 75d)
    tot_bal = port["total"]
    if tot_bal > 0:
        dpo_est = round((
            port["current"]     *  0 +
            port["days_1_30"]   * 15 +
            port["days_31_60"]  * 45 +
            port["days_60_plus"]* 75
        ) / tot_bal, 1)
    else:
        dpo_est = None

    # Per-vendor breakdown
    by_vendor = []
    for r in rows:
        s = {
            "vendor_id":   str(r.vendor_id) if r.vendor_id else None,
            "vendor_name": r.vendor_name,
            "was_seeded":  r.was_seeded,
            "current":     float(r.current_amount),
            "days_1_30":   float(r.days_1_30),
            "days_31_60":  float(r.days_31_60),
            "days_60_plus":float(r.days_60_plus),
            "total":       float(r.total),
            "has_credit":  r.has_credit,
        }
        s["overdue"] = round(s["days_1_30"] + s["days_31_60"] + s["days_60_plus"], 2)
        by_vendor.append(s)
    by_vendor.sort(key=lambda x: x["overdue"], reverse=True)

    credit_rows = [v for v in by_vendor if v["has_credit"]]

    # Trend
    trend = []
    for snap in reversed(snapshots):
        snap_rows = db.query(QBApAgingRow).filter(QBApAgingRow.snapshot_id == snap.id).all()
        s = _sum_ap(snap_rows)
        s["overdue"] = round(s["days_1_30"] + s["days_31_60"] + s["days_60_plus"], 2)
        s["month"] = snap.snapshot_month
        s["as_of_date"] = snap.as_of_date.isoformat()
        trend.append(s)

    return {
        "has_data":        True,
        "snapshot_count":  len(snapshots),
        "latest_snapshot": _ap_snapshot_dict(latest),
        "portfolio_totals": port,
        "dpo_estimate":    dpo_est,
        "by_vendor":       by_vendor,
        "credit_rows":     credit_rows,
        "trend":           trend,
        "trend_ready":     len(snapshots) >= 3,
    }


@router.delete("/ar-ap/qb-ap-aging/snapshots/{snap_id}", status_code=204)
def delete_qb_ap_snapshot(
    snap_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    snap = db.query(QBApAgingSnapshot).filter(
        QBApAgingSnapshot.id == snap_id,
        QBApAgingSnapshot.tenant_id == current_user.tenant_id,
    ).first()
    if not snap:
        raise HTTPException(404)
    db.delete(snap)
    db.commit()
