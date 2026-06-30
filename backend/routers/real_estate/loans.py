import uuid
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.entity import Entity
from models.real_estate.loan import Loan
from services.lender_calculations import dscr as calc_dscr, dscr_status, ltv_current as calc_ltv

router = APIRouter(prefix="/api/real-estate/loans", tags=["real-estate"])


def _mask_account(acct: str | None) -> str | None:
    if not acct:
        return None
    tail = acct[-4:] if len(acct) >= 4 else acct
    return f"****{tail}"


def _loan_dict(loan: Loan, *, masked: bool = True) -> dict:
    noi_ann  = float(loan.noi_annual) if loan.noi_annual is not None else None
    annual_ds = float(loan.loan_emi) * 12 if loan.loan_emi is not None else None
    bal      = float(loan.loan_balance_as_of) if loan.loan_balance_as_of is not None else None
    prop_val = float(loan.current_property_value) if loan.current_property_value is not None else None
    dscr_val = calc_dscr(noi_ann, annual_ds)
    ltv_val  = calc_ltv(bal, prop_val)
    return {
        "id": str(loan.id),
        "entity_id": str(loan.entity_id) if loan.entity_id else None,
        "company_name": loan.company_name,
        "property_name": loan.property_name,
        "loan_bank_name": loan.loan_bank_name,
        "loan_date": loan.loan_date.isoformat() if loan.loan_date else None,
        "loan_account_no": _mask_account(loan.loan_account_no) if masked else loan.loan_account_no,
        "loan_amount": float(loan.loan_amount),
        "loan_interest_rate": float(loan.loan_interest_rate) if loan.loan_interest_rate is not None else None,
        "loan_emi": float(loan.loan_emi) if loan.loan_emi is not None else None,
        "lender_name": loan.lender_name,
        "lender_email": loan.lender_email,
        "lender_phone": loan.lender_phone,
        "loan_maturity_date": loan.loan_maturity_date.isoformat() if loan.loan_maturity_date else None,
        "loan_balance_as_of": bal,
        "loan_balance_as_of_date": loan.loan_balance_as_of_date.isoformat() if loan.loan_balance_as_of_date else None,
        "loan_emi_day": loan.loan_emi_day,
        "loan_deduction_bank_account": loan.loan_deduction_bank_account,
        "noi_annual": noi_ann,
        "current_property_value": prop_val,
        "context_type": getattr(loan, "context_type", "construction") or "construction",
        "dscr": dscr_val,
        "ltv_current": ltv_val,
        "dscr_status": dscr_status(dscr_val),
        "created_by": loan.created_by,
        "created_at": loan.created_at.isoformat(),
    }


# ── Pydantic models ───────────────────────────────────────────────────────────

class LoanCreate(BaseModel):
    entity_id: Optional[str] = None
    company_name: str
    property_name: str
    loan_bank_name: str
    loan_date: Optional[str] = None
    loan_account_no: Optional[str] = None
    loan_amount: float
    loan_interest_rate: Optional[float] = None
    loan_emi: Optional[float] = None
    lender_name: Optional[str] = None
    lender_email: Optional[str] = None
    lender_phone: Optional[str] = None
    loan_maturity_date: Optional[str] = None
    loan_balance_as_of: Optional[float] = None
    loan_balance_as_of_date: Optional[str] = None
    loan_emi_day: Optional[int] = None
    loan_deduction_bank_account: Optional[str] = None
    noi_annual: Optional[float] = None
    current_property_value: Optional[float] = None
    context_type: Optional[str] = "construction"


class LoanUpdate(BaseModel):
    company_name: Optional[str] = None
    property_name: Optional[str] = None
    loan_bank_name: Optional[str] = None
    loan_date: Optional[str] = None
    loan_account_no: Optional[str] = None
    loan_amount: Optional[float] = None
    loan_interest_rate: Optional[float] = None
    loan_emi: Optional[float] = None
    lender_name: Optional[str] = None
    lender_email: Optional[str] = None
    lender_phone: Optional[str] = None
    loan_maturity_date: Optional[str] = None
    loan_balance_as_of: Optional[float] = None
    loan_balance_as_of_date: Optional[str] = None
    loan_emi_day: Optional[int] = None
    loan_deduction_bank_account: Optional[str] = None
    noi_annual: Optional[float] = None
    current_property_value: Optional[float] = None
    context_type: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_loans(
    company_name: Optional[str] = None,
    property_name: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Loan).filter(Loan.tenant_id == current_user.tenant_id)
    if company_name:
        q = q.filter(Loan.company_name.ilike(f"%{company_name}%"))
    if property_name:
        q = q.filter(Loan.property_name.ilike(f"%{property_name}%"))

    loans = q.order_by(Loan.loan_maturity_date.asc().nullslast()).all()

    today = date.today()
    cutoff_90 = today + timedelta(days=90)

    total_amount = sum(float(l.loan_amount) for l in loans)
    total_balance = sum(float(l.loan_balance_as_of) for l in loans if l.loan_balance_as_of is not None)
    total_emi = sum(float(l.loan_emi) for l in loans if l.loan_emi is not None)
    maturing_90 = sum(
        1 for l in loans
        if l.loan_maturity_date and today <= l.loan_maturity_date <= cutoff_90
    )

    return {
        "summary": {
            "count": len(loans),
            "total_loan_amount": round(total_amount, 2),
            "total_outstanding_balance": round(total_balance, 2),
            "total_monthly_emi": round(total_emi, 2),
            "maturing_in_90_days": maturing_90,
        },
        "items": [_loan_dict(l, masked=True) for l in loans],
    }


@router.get("/{loan_id}/reveal-account")
def reveal_account(
    loan_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the full (unmasked) account number for a specific loan."""
    loan = db.query(Loan).filter(
        Loan.id == loan_id, Loan.tenant_id == current_user.tenant_id
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    return {"loan_account_no": loan.loan_account_no}


@router.post("", status_code=201)
def create_loan(
    body: LoanCreate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    if body.entity_id:
        entity = db.query(Entity).filter(
            Entity.id == uuid.UUID(body.entity_id),
            Entity.tenant_id == current_user.tenant_id,
        ).first()
        if not entity:
            raise HTTPException(status_code=404, detail="Entity not found")

    loan = Loan(
        tenant_id=current_user.tenant_id,
        entity_id=uuid.UUID(body.entity_id) if body.entity_id else None,
        company_name=body.company_name,
        property_name=body.property_name,
        loan_bank_name=body.loan_bank_name,
        loan_date=date.fromisoformat(body.loan_date) if body.loan_date else None,
        loan_account_no=body.loan_account_no,
        loan_amount=body.loan_amount,
        loan_interest_rate=body.loan_interest_rate,
        loan_emi=body.loan_emi,
        lender_name=body.lender_name,
        lender_email=body.lender_email,
        lender_phone=body.lender_phone,
        loan_maturity_date=date.fromisoformat(body.loan_maturity_date) if body.loan_maturity_date else None,
        loan_balance_as_of=body.loan_balance_as_of,
        loan_balance_as_of_date=date.fromisoformat(body.loan_balance_as_of_date) if body.loan_balance_as_of_date else None,
        loan_emi_day=body.loan_emi_day,
        loan_deduction_bank_account=body.loan_deduction_bank_account,
        noi_annual=body.noi_annual,
        current_property_value=body.current_property_value,
        context_type=body.context_type or "construction",
        created_by=current_user.email,
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return _loan_dict(loan, masked=False)


@router.put("/{loan_id}")
def update_loan(
    loan_id: uuid.UUID,
    body: LoanUpdate,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    loan = db.query(Loan).filter(
        Loan.id == loan_id, Loan.tenant_id == current_user.tenant_id
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    data = body.model_dump(exclude_none=True)
    for field in (
        "company_name", "property_name", "loan_bank_name", "loan_account_no",
        "loan_amount", "loan_interest_rate", "loan_emi",
        "lender_name", "lender_email", "lender_phone",
        "loan_balance_as_of", "loan_emi_day", "loan_deduction_bank_account",
        "noi_annual", "current_property_value", "context_type",
    ):
        if field in data:
            setattr(loan, field, data[field])
    for date_field in ("loan_date", "loan_maturity_date", "loan_balance_as_of_date"):
        if date_field in data:
            v = data[date_field]
            setattr(loan, date_field, date.fromisoformat(v) if v else None)

    db.commit()
    db.refresh(loan)
    return _loan_dict(loan, masked=False)


@router.delete("/{loan_id}", status_code=204)
def delete_loan(
    loan_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    loan = db.query(Loan).filter(
        Loan.id == loan_id, Loan.tenant_id == current_user.tenant_id
    ).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    db.delete(loan)
    db.commit()


# ── Excel bulk import ─────────────────────────────────────────────────────────

def _parse_num(v) -> float | None:
    if v is None:
        return None
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except ValueError:
        return None


def _parse_date(v) -> date | None:
    if v is None:
        return None
    if hasattr(v, "date"):
        return v.date()
    s = str(v).strip()
    for fmt in ("%m-%d-%Y", "%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            from datetime import datetime as _dt
            return _dt.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_emi_day(v) -> int | None:
    import re
    if v is None:
        return None
    digits = re.sub(r"[^0-9]", "", str(v))
    return int(digits) if digits else None


@router.post("/import-excel", status_code=201)
async def import_loans_excel(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """
    Parse an Excel file with loan data and bulk-insert rows.

    Expected columns (by position, 0-indexed):
      0  Sl No.
      1  Company Name
      2  Property Name
      3  Loan Bank Name
      4  Loan Date          (MM-DD-YYYY or date cell)
      5  Loan Amount        ($1,399,000.00 or numeric)
      6  Loan Interest Rate (4.25% or 0.0425 or 4.25)
      7  Loan EMI           ($8,710.47 or numeric)
      8  Lender Name
      9  Loan Maturity Date
      10 Loan Balance as of …
      11 Loan EMI Day       (14th, 9th, 29th, or plain integer)
      12 Loan Deduction Bank Account
    """
    import openpyxl
    from io import BytesIO

    content = await file.read()
    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
    ws = wb.active

    SKIP_KEYWORDS = {
        "company name", "company", "sl no", "sl no.", "sl", "#",
        "property name", "loan bank", "lender", "loan amount",
    }

    created = 0
    skipped_rows: list[int] = []

    for row_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
        # Normalize first few cells to detect header / empty rows
        col1 = str(row[1] if len(row) > 1 else "").strip().lower()
        if not col1 or col1 in SKIP_KEYWORDS:
            continue

        company = str(row[1] or "").strip() if len(row) > 1 else ""
        if not company:
            continue

        property_name = str(row[2] or "").strip() if len(row) > 2 else company
        bank_name = str(row[3] or "").strip() if len(row) > 3 else ""
        loan_date = _parse_date(row[4]) if len(row) > 4 else None
        loan_amount = _parse_num(row[5]) if len(row) > 5 else None
        if not loan_amount:
            skipped_rows.append(row_idx)
            continue

        # Interest rate: handle both "4.25%" and "4.25" (as %), and "0.0425" (as decimal)
        rate_raw = _parse_num(row[6]) if len(row) > 6 else None
        if rate_raw is not None:
            loan_interest_rate = rate_raw / 100 if rate_raw > 1 else rate_raw
        else:
            loan_interest_rate = None

        loan_emi = _parse_num(row[7]) if len(row) > 7 else None
        lender_name = str(row[8] or "").strip() if len(row) > 8 else None
        maturity_date = _parse_date(row[9]) if len(row) > 9 else None
        loan_balance = _parse_num(row[10]) if len(row) > 10 else None
        loan_emi_day = _parse_emi_day(row[11]) if len(row) > 11 else None
        deduction_acct = str(row[12] or "").strip() if len(row) > 12 else None

        loan = Loan(
            tenant_id=current_user.tenant_id,
            company_name=company,
            property_name=property_name,
            loan_bank_name=bank_name or "—",
            loan_date=loan_date,
            loan_amount=loan_amount,
            loan_interest_rate=loan_interest_rate,
            loan_emi=loan_emi,
            lender_name=lender_name or None,
            loan_maturity_date=maturity_date,
            loan_balance_as_of=loan_balance,
            loan_balance_as_of_date=date.today(),
            loan_emi_day=loan_emi_day,
            loan_deduction_bank_account=deduction_acct or None,
            context_type="rental",
            created_by=current_user.email,
        )
        db.add(loan)
        created += 1

    db.commit()
    return {
        "created": created,
        "skipped_rows": skipped_rows,
        "message": f"Imported {created} loan(s) successfully.",
    }
