import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from middleware.auth import CurrentUser, get_current_user, require_write_access
from models.real_estate.entity import Project
from models.real_estate.expense import ExpenseCategory, PaymentMode, ProjectExpense
from services import storage

router = APIRouter(prefix="/api/real-estate/expenses", tags=["real-estate"])


def _require_project(db: Session, tenant_id, project_id: uuid.UUID) -> Project:
    p = db.query(Project).filter(Project.id == project_id, Project.tenant_id == tenant_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


def _expense_dict(e: ProjectExpense) -> dict:
    return {
        "id": str(e.id),
        "project_id": str(e.project_id),
        "expense_date": e.expense_date.isoformat(),
        "category": e.category.value,
        "division": e.division,
        "subdivision": e.subdivision,
        "line_item": e.line_item,
        "expense_type": e.expense_type,
        "currency": e.currency,
        "amount": float(e.amount),
        "payable_to": e.payable_to,
        "mode_of_payment": e.mode_of_payment.value if e.mode_of_payment else None,
        "description": e.description,
        "receipt_file_reference": e.receipt_file_reference,
        "receipt_url": storage.get_url(e.receipt_file_reference) if e.receipt_file_reference else None,
        "created_by": e.created_by,
        "created_at": e.created_at.isoformat(),
        "updated_at": e.updated_at.isoformat(),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_expenses(
    project_id: str,
    category: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)

    q = db.query(ProjectExpense).filter(
        ProjectExpense.tenant_id == current_user.tenant_id,
        ProjectExpense.project_id == pid,
    )
    if category:
        try:
            q = q.filter(ProjectExpense.category == ExpenseCategory(category))
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid category: {category}")
    expenses = q.order_by(ProjectExpense.expense_date.desc(), ProjectExpense.created_at.desc()).all()

    items = [_expense_dict(e) for e in expenses]

    total = sum(i["amount"] for i in items if i["category"] == "expense")
    total_refunds = sum(i["amount"] for i in items if i["category"] == "refund")
    total_recurring = sum(i["amount"] for i in items if i["category"] == "recurring_expense")

    # This-month
    now = datetime.utcnow()
    this_month = sum(
        i["amount"] for i in items
        if i["expense_date"][:7] == f"{now.year:04d}-{now.month:02d}"
        and i["category"] != "refund"
    )

    by_division: dict[str, float] = {}
    for i in items:
        if i["category"] != "refund" and i["division"]:
            by_division[i["division"]] = round(by_division.get(i["division"], 0.0) + i["amount"], 2)

    return {
        "summary": {
            "count": len(items),
            "total_expenses": round(total, 2),
            "total_refunds": round(total_refunds, 2),
            "total_recurring": round(total_recurring, 2),
            "this_month": round(this_month, 2),
            "by_division": by_division,
        },
        "items": items,
    }


@router.post("", status_code=201)
async def create_expense(
    # multipart form fields (all required unless marked optional)
    project_id: str = Form(...),
    expense_date: str = Form(...),
    category: str = Form(...),
    amount: float = Form(...),
    payable_to: str = Form(...),
    description: str = Form(...),
    division: Optional[str] = Form(None),
    subdivision: Optional[str] = Form(None),
    line_item: Optional[str] = Form(None),
    expense_type: Optional[str] = Form(None),
    currency: str = Form("USD"),
    mode_of_payment: Optional[str] = Form(None),
    receipt: Optional[UploadFile] = File(None),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    pid = uuid.UUID(project_id)
    _require_project(db, current_user.tenant_id, pid)

    try:
        cat = ExpenseCategory(category)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid category: {category}")

    mode = None
    if mode_of_payment:
        try:
            mode = PaymentMode(mode_of_payment)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid mode_of_payment: {mode_of_payment}")

    # Store receipt if provided — key stored as "receipts/{uuid}.ext", URL resolved at read time
    receipt_ref = None
    if receipt and receipt.filename:
        ext = Path(receipt.filename).suffix or ".pdf"
        key = f"receipts/{uuid.uuid4().hex}{ext}"
        content = await receipt.read()
        storage.put_file(content, key, content_type=receipt.content_type or "application/octet-stream")
        receipt_ref = key

    expense = ProjectExpense(
        tenant_id=current_user.tenant_id,
        project_id=pid,
        expense_date=date.fromisoformat(expense_date),
        category=cat,
        division=division or None,
        subdivision=subdivision or None,
        line_item=line_item or None,
        expense_type=expense_type or None,
        currency=currency or "USD",
        amount=amount,
        payable_to=payable_to,
        mode_of_payment=mode,
        description=description,
        receipt_file_reference=receipt_ref,
        created_by=current_user.email,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return _expense_dict(expense)


@router.patch("/{expense_id}")
def update_expense(
    expense_id: uuid.UUID,
    # We accept JSON body for patch (no file upload on PATCH for simplicity)
    body: dict,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    exp = db.query(ProjectExpense).filter(
        ProjectExpense.id == expense_id, ProjectExpense.tenant_id == current_user.tenant_id
    ).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Expense not found")

    str_fields = ("division", "subdivision", "line_item", "expense_type", "currency", "payable_to", "description")
    for f in str_fields:
        if f in body:
            setattr(exp, f, body[f])

    if "expense_date" in body:
        exp.expense_date = date.fromisoformat(body["expense_date"])
    if "amount" in body:
        exp.amount = float(body["amount"])
    if "category" in body:
        try:
            exp.category = ExpenseCategory(body["category"])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid category: {body['category']}")
    if "mode_of_payment" in body:
        try:
            exp.mode_of_payment = PaymentMode(body["mode_of_payment"]) if body["mode_of_payment"] else None
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid mode_of_payment: {body['mode_of_payment']}")

    db.commit()
    db.refresh(exp)
    return _expense_dict(exp)


@router.delete("/{expense_id}", status_code=204)
def delete_expense(
    expense_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    exp = db.query(ProjectExpense).filter(
        ProjectExpense.id == expense_id, ProjectExpense.tenant_id == current_user.tenant_id
    ).first()
    if not exp:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(exp)
    db.commit()
