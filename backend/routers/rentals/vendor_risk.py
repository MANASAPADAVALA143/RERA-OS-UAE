"""
Rental Vendor Risk router.
vendor_concentration() is imported from real_estate_calculations — shared, not duplicated.
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
from models.rentals.ar_ap import RentalPayable
from models.rentals.maintenance import MaintenanceRequest
from models.rentals.vendor import RentalVendor
from services.vendor_risk import vendor_risk_summary

router = APIRouter(prefix="/api/rentals", tags=["rentals-vendor-risk"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _vendor_dict(v: RentalVendor) -> dict:
    return {
        "id":                str(v.id),
        "vendor_name":       v.vendor_name,
        "vendor_category":   v.vendor_category.value if v.vendor_category else None,
        "contact_name":      v.contact_name,
        "contact_email":     v.contact_email,
        "contact_phone":     v.contact_phone,
        "last_payment_date": v.last_payment_date.isoformat() if v.last_payment_date else None,
        "created_at":        v.created_at.isoformat(),
    }


# ── Vendor CRUD ────────────────────────────────────────────────────────────────

class VendorCreate(BaseModel):
    vendor_name: str
    vendor_category: str = "other"
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    last_payment_date: Optional[str] = None


class VendorUpdate(BaseModel):
    vendor_name: Optional[str] = None
    vendor_category: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    last_payment_date: Optional[str] = None


@router.get("/vendors")
def list_vendors(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    vendors = db.query(RentalVendor).filter(
        RentalVendor.tenant_id == current_user.tenant_id
    ).order_by(RentalVendor.vendor_name).all()
    return [_vendor_dict(v) for v in vendors]


@router.post("/vendors", status_code=201)
def create_vendor(
    body: VendorCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    vendor = RentalVendor(
        tenant_id=current_user.tenant_id,
        vendor_name=body.vendor_name.strip(),
        vendor_category=body.vendor_category,
        contact_name=body.contact_name,
        contact_email=body.contact_email,
        contact_phone=body.contact_phone,
        last_payment_date=date.fromisoformat(body.last_payment_date) if body.last_payment_date else None,
        created_by=current_user.email,
    )
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return _vendor_dict(vendor)


@router.put("/vendors/{vendor_id}")
def update_vendor(
    vendor_id: uuid.UUID,
    body: VendorUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    vendor = db.query(RentalVendor).filter(
        RentalVendor.id == vendor_id,
        RentalVendor.tenant_id == current_user.tenant_id,
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    data = body.model_dump(exclude_none=True)
    if "last_payment_date" in data:
        vendor.last_payment_date = date.fromisoformat(data.pop("last_payment_date")) if data["last_payment_date"] else None
    for field, val in data.items():
        setattr(vendor, field, val)
    db.commit()
    db.refresh(vendor)
    return _vendor_dict(vendor)


@router.delete("/vendors/{vendor_id}", status_code=204)
def delete_vendor(
    vendor_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    vendor = db.query(RentalVendor).filter(
        RentalVendor.id == vendor_id,
        RentalVendor.tenant_id == current_user.tenant_id,
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    db.delete(vendor)
    db.commit()


# ── Vendor Risk Summary ────────────────────────────────────────────────────────

@router.get("/vendor-risk")
def vendor_risk(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Vendor risk summary: combines AP exposure per vendor with
    maintenance repeat-issue signals. Uses shared vendor_concentration()
    from real_estate_calculations — same function Construction uses.
    """
    vendors = db.query(RentalVendor).filter(
        RentalVendor.tenant_id == current_user.tenant_id
    ).all()

    # Latest AP per (company, vendor) — sum across companies for total exposure
    all_pays = db.query(RentalPayable).filter(
        RentalPayable.tenant_id == current_user.tenant_id
    ).all()

    # Keep most recent per (company, vendor)
    latest_pays: dict[str, RentalPayable] = {}
    for p in all_pays:
        key = f"{p.company_id}:{p.vendor_id}"
        if key not in latest_pays or p.as_of_date > latest_pays[key].as_of_date:
            latest_pays[key] = p

    # Sum AP exposure per vendor name (across all companies)
    vendor_names = {str(v.id): v.vendor_name for v in vendors}
    ap_by_vendor: dict[str, float] = defaultdict(float)
    for p in latest_pays.values():
        vname = vendor_names.get(str(p.vendor_id))
        if vname:
            ap_by_vendor[vname] += (
                float(p.current_amount) + float(p.days_1_30) +
                float(p.days_31_60) + float(p.days_60_plus)
            )
    total_ap = sum(ap_by_vendor.values())

    # Maintenance signals: open count + repeat issues per vendor_name
    maint_requests = db.query(MaintenanceRequest).filter(
        MaintenanceRequest.tenant_id == current_user.tenant_id,
        MaintenanceRequest.vendor_name.isnot(None),
    ).all()

    # Group maintenance by vendor_name (case-insensitive match)
    maint_by_vendor: dict[str, dict] = defaultdict(lambda: {"open_count": 0, "categories": []})
    for m in maint_requests:
        vname = (m.vendor_name or "").strip()
        if not vname:
            continue
        if m.status.value in ("open", "assigned", "in_progress"):
            maint_by_vendor[vname]["open_count"] += 1
        maint_by_vendor[vname]["categories"].append(m.category.value)

    # Repeat issues: same category appears >1 time for this vendor
    maint_signals: dict[str, dict] = {}
    for vname, data in maint_by_vendor.items():
        cats = data["categories"]
        cat_counts = defaultdict(int)
        for c in cats:
            cat_counts[c] += 1
        repeat = any(cnt > 1 for cnt in cat_counts.values())
        maint_signals[vname] = {"open_count": data["open_count"], "repeat_issues": repeat}

    vendor_dicts = [_vendor_dict(v) for v in vendors]
    risk_items   = vendor_risk_summary(vendor_dicts, dict(ap_by_vendor), maint_signals, total_ap)

    return {
        "total_ap": round(total_ap, 2),
        "vendor_count": len(vendors),
        "concentration_risk_count": sum(1 for i in risk_items if i["concentration_flag"]),
        "repeat_issue_count": sum(1 for i in risk_items if i["repeat_issues_flag"]),
        "items": risk_items,
    }
