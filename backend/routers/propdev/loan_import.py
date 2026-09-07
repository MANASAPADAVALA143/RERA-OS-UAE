"""Import Property Dev loans from Excel (Bank Loan Information format)."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, require_write_access
from models.propdev.loan import PropDevLoan
from services.propdev_loan_import import import_propdev_loans_from_excel

router = APIRouter(prefix="/api/propdev", tags=["propdev"])


def _get_loan(db: Session, loan_id: str, tenant_id) -> PropDevLoan:
    lid = uuid.UUID(loan_id)
    loan = db.query(PropDevLoan).filter(
        PropDevLoan.id == lid,
        PropDevLoan.tenant_id == tenant_id,
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return loan


@router.patch("/loans/{loan_id}/refinancing")
def update_loan_refinancing(
    loan_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    loan = _get_loan(db, loan_id, current_user.tenant_id)
    if "refinancing_status" in body:
        loan.refinancing_status = body["refinancing_status"] or "Not Started"
    if "refinancing_notes" in body:
        loan.refinancing_notes = body["refinancing_notes"]
    db.commit()
    return {
        "id": str(loan.id),
        "refinancing_status": loan.refinancing_status,
        "refinancing_notes": loan.refinancing_notes,
    }


@router.patch("/loans/{loan_id}/insurance")
def update_loan_insurance(
    loan_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    loan = _get_loan(db, loan_id, current_user.tenant_id)
    raw = body.get("insurance_expiry_date")
    loan.insurance_expiry_date = datetime.fromisoformat(raw).date() if raw else None
    db.commit()
    return {
        "id": str(loan.id),
        "insurance_expiry_date": loan.insurance_expiry_date.isoformat() if loan.insurance_expiry_date else None,
    }


@router.patch("/loans/{loan_id}/checklist")
def update_loan_checklist(
    loan_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    loan = _get_loan(db, loan_id, current_user.tenant_id)
    loan.maturity_checklist = body.get("maturity_checklist") or {}
    db.commit()
    return {"id": str(loan.id), "maturity_checklist": loan.maturity_checklist}


@router.patch("/loans/{loan_id}/purpose")
def update_loan_purpose(
    loan_id: str,
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    loan = _get_loan(db, loan_id, current_user.tenant_id)
    loan.loan_purpose = body.get("loan_purpose") or None
    db.commit()
    return {"id": str(loan.id), "loan_purpose": loan.loan_purpose}


@router.post("/import-loans")
async def import_loans_excel(
    file: UploadFile = File(...),
    balance_period: str | None = Query(None, description="YYYY-MM balance column to use when file has monthly balances"),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(400, "No file received")

    lower = file.filename.lower()
    if lower.endswith(".xls") and not lower.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Legacy .xls format is not supported. Save as .xlsx and upload again.")
    if not lower.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Upload an Excel workbook (.xlsx)")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty")

    result = import_propdev_loans_from_excel(
        db,
        current_user.tenant_id,
        content,
        balance_period=balance_period,
    )
    if result["created"] == 0:
        raise HTTPException(400, result["message"])
    return result
