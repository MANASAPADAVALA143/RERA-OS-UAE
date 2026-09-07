"""Property Dev property tax records — upload + list (used by Properties → Calculations tab)."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.propdev.property_tax import PropDevPropertyTax
from services.propdev_tax_import import import_propdev_property_tax_from_excel

router = APIRouter(prefix="/api/propdev/property-tax", tags=["propdev"])


def _tax_dict(t: PropDevPropertyTax) -> dict:
    return {
        "id": str(t.id),
        "company_id": str(t.company_id) if t.company_id else None,
        "entity_name": t.entity_name,
        "property_address": t.property_address,
        "tax_year": t.tax_year,
        "tax_amount": float(t.tax_amount),
        "tax_with_penalty": float(t.tax_with_penalty),
        "penalty_amount": round(float(t.tax_with_penalty) - float(t.tax_amount), 2),
        "paid_amount": float(t.paid_amount),
        "balance": float(t.balance),
        "payment_date": t.payment_date.isoformat() if t.payment_date else None,
        "payment_status": t.payment_status,
    }


@router.get("")
def list_property_tax(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(PropDevPropertyTax).filter(
        PropDevPropertyTax.tenant_id == current_user.tenant_id,
    ).order_by(PropDevPropertyTax.entity_name.asc()).all()
    return {"items": [_tax_dict(t) for t in rows]}


@router.post("/upload", status_code=201)
async def upload_property_tax(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(400, "No file received")
    lower = file.filename.lower()
    if not lower.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Upload an Excel workbook (.xlsx)")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty")

    result = import_propdev_property_tax_from_excel(db, current_user.tenant_id, content)
    if result["imported"] == 0:
        raise HTTPException(400, result["message"])
    return result
