"""
Import handler for Entities_Capital_Contribution.xlsx format.
Each sheet = one company. Two sections per sheet:
  1. Expense breakdown (Particulars / Amount / Per Month)
  2. Partner capital call table (Partner, % Share, Old Dues, New Call, Total, Received, Balance)
"""
import uuid
from datetime import date
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
import openpyxl

from database import get_db
from middleware.auth import CurrentUser, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.expense import PropDevExpense
from models.propdev.financial_upload import PropDevFinancialUpload
from models.propdev.partner import PropDevPartner
from services.propdev_capital_call_parser import (
    CompanyCandidate,
    block_to_dict,
    call_status,
    parse_workbook,
)

router = APIRouter(prefix="/api/propdev", tags=["propdev"])

SKIP_SHEETS = {
    'SUMMARY', 'ANNEXURE I', 'ANNEXURE II', 'CAPITAL CALLS',
    'LOAN SHEET', 'EXPENSE DASHBOARD', 'LOT INVENTORY', 'CASH POSITION',
}

SKIP_ROW_NAMES = {'total', 'total estimated exp', 'grand total', '', 'sl no'}


def _to_float(val) -> float:
    try:
        return float(val) if val is not None else 0.0
    except (ValueError, TypeError):
        return 0.0


def parse_company_sheet(sheet_name: str, ws) -> dict:
    rows = list(ws.iter_rows(values_only=True))

    result = {
        'company': sheet_name,
        'period': None,
        'expenses': [],
        'capital_calls': [],
    }

    # ── Step 1: Find period title ───────────────────────────────────────────────
    for row in rows[:6]:
        for cell in row:
            s = str(cell or '').strip()
            if s and any(k in s.lower() for k in ('capital call', 'contribution', 'mortgage', 'call from')):
                result['period'] = s
                break
        if result['period']:
            break

    # ── Step 2: Find expense section ────────────────────────────────────────────
    expense_start = None
    for i, row in enumerate(rows):
        first = str(row[0] or '').lower().strip()
        if first in ('particulars', 'expenses', 'expense'):
            expense_start = i + 1
            break
        # PQR LLC offset — header in col B
        if len(row) > 1 and str(row[1] or '').lower().strip() in ('particulars', 'expenses'):
            expense_start = i + 1
            break

    if expense_start is not None:
        for row in rows[expense_start:]:
            name = str(row[0] or '').strip()
            # PQR LLC has data in col B
            if not name and len(row) > 1:
                name = str(row[1] or '').strip()
            if not name or name.lower() in SKIP_ROW_NAMES:
                if name.lower().startswith('total'):
                    break
                continue
            # Amount: first numeric value > 0 after the name column
            amount = 0.0
            for v in row[1:]:
                a = _to_float(v)
                if a > 0:
                    amount = a
                    break
            result['expenses'].append({'particulars': name, 'amount': amount})

    # ── Step 3: Find partner / capital call section ─────────────────────────────
    partner_header_row = None
    partner_start = None
    for i, row in enumerate(rows):
        row_text = ' '.join(str(c or '').lower() for c in row)
        if 'shareholding' in row_text or ('partner' in row_text and ('receivable' in row_text or 'call' in row_text)):
            partner_header_row = i
            partner_start = i + 1
            break

    if partner_start is not None:
        for row in rows[partner_start:]:
            vals = list(row)

            # Get partner name — skip leading serial number
            name = None
            name_col = 0
            for j, v in enumerate(vals):
                s = str(v or '').strip()
                if s and s.lower() not in SKIP_ROW_NAMES and not (s.isdigit() and j == 0):
                    name = s
                    name_col = j
                    break
                if s.isdigit() and j == 0:
                    # next col is partner name
                    if len(vals) > 1 and vals[1]:
                        name = str(vals[1]).strip()
                        name_col = 1
                    break

            if not name or name.lower() in SKIP_ROW_NAMES:
                continue

            # Collect all numeric values after name column
            nums = []
            for v in vals[name_col + 1:]:
                try:
                    nums.append(float(v))
                except (ValueError, TypeError):
                    nums.append(None)

            # Share % — first number between 0 and 1 (decimal) or 1–100 (pct)
            share_pct = 0.0
            for n in nums:
                if n is None:
                    continue
                if 0 < n <= 1:
                    share_pct = round(n * 100, 4)
                    break
                if 1 < n <= 100:
                    share_pct = n
                    break

            # Extract amounts: old_dues, new_call, total, received, balance
            real_nums = [n for n in nums if n is not None and n != share_pct / 100 and n != share_pct]
            old_dues     = real_nums[0] if len(real_nums) > 0 else 0.0
            new_call     = real_nums[1] if len(real_nums) > 1 else 0.0
            total_due    = real_nums[2] if len(real_nums) > 2 else old_dues + new_call
            received     = real_nums[4] if len(real_nums) > 4 else 0.0
            balance      = real_nums[5] if len(real_nums) > 5 else total_due - received

            if total_due <= 0 and new_call <= 0:
                continue

            status = 'Paid' if balance <= 0 else ('Partial' if received > 0 else 'Outstanding')

            result['capital_calls'].append({
                'partner_name': name,
                'share_percent': share_pct,
                'old_dues': max(0.0, old_dues),
                'new_call': new_call,
                'total_due': total_due,
                'amount_received': max(0.0, received),
                'balance': balance,
                'status': status,
            })

    return result


def _company_candidates(db: Session, tenant_id) -> list[CompanyCandidate]:
    return [
        CompanyCandidate(
            id=str(company.id),
            name=company.name,
            property_name=company.property_name or "",
            address=company.address or "",
        )
        for company in db.query(PropDevCompany).filter(
            PropDevCompany.tenant_id == tenant_id
        ).all()
    ]


def _get_or_create_company(db: Session, tenant_id, block) -> PropDevCompany | None:
    if block.company_id:
        return db.query(PropDevCompany).filter(
            PropDevCompany.id == uuid.UUID(block.company_id),
            PropDevCompany.tenant_id == tenant_id,
        ).first()
    if block.company_name and block.attribution_confidence in {"high", "medium"}:
        existing = db.query(PropDevCompany).filter(
            PropDevCompany.tenant_id == tenant_id,
            PropDevCompany.name == block.company_name,
        ).first()
        if existing:
            return existing
        company = PropDevCompany(
            tenant_id=tenant_id,
            name=block.company_name,
            property_name=block.property_name or block.company_name,
            address="",
            total_lots=0,
            sale_consideration=0,
            land_cost=0,
            hard_cost=0,
            soft_cost=0,
            title_charges=0,
            other_charges=0,
            property_tax=0,
            loan_processing=0,
            professional_charges=0,
            legal_fees=0,
            interest_on_loan=0,
            cash_available=0,
        )
        db.add(company)
        db.flush()
        block.company_id = str(company.id)
        return company
    return None


def _fit_share_pct(value: float) -> float:
    """Numeric(6,4) on partners/calls allows at most 99.9999 — clamp 100% + round."""
    try:
        n = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return round(min(max(n, 0.0), 99.9999), 4)


def _upsert_partner(db: Session, tenant_id, company: PropDevCompany, row) -> PropDevPartner:
    share = _fit_share_pct(row.share_percent)
    partner = db.query(PropDevPartner).filter(
        PropDevPartner.company_id == company.id,
        PropDevPartner.name == row.partner_name,
    ).first()
    if not partner:
        partner = PropDevPartner(
            tenant_id=tenant_id,
            company_id=company.id,
            name=row.partner_name,
            partner_type="Class A",
            share_percent=share,
            capital_contributed=row.amount_received,
            distributions_received=0,
            preferred_return=0,
            status="Active",
        )
        db.add(partner)
        db.flush()
    else:
        if share:
            partner.share_percent = share
        partner.capital_contributed = float(partner.capital_contributed or 0) + row.amount_received
    return partner


def _route_property_pl(db: Session, tenant_id, block, filename: str, uploaded_by: str) -> bool:
    company = _get_or_create_company(db, tenant_id, block)
    if not company or not block.pl_rows:
        return False
    year = block.call_date.year if block.call_date else date.today().year
    pl_data = []
    for row in block.pl_rows:
        total = sum(float(v or 0) for v in row["values"].values())
        label = row["label"]
        pl_data.append({
            "label": label,
            "values": {str(year): total},
            "monthlyValues": {},
            "indent": 0,
            "isTotal": _norm_label(label).startswith("total"),
            "isSectionHeader": False,
            "isNetIncome": "net profit" in _norm_label(label) or "net income" in _norm_label(label),
            "sourcePropertyValues": row["values"],
        })
    existing = db.query(PropDevFinancialUpload).filter(
        PropDevFinancialUpload.tenant_id == tenant_id,
        PropDevFinancialUpload.company_id == company.id,
    ).first()
    if existing:
        existing.company_name = company.name
        existing.filename = filename
        existing.date_range = f"Property P&L routed from {block.sheet_name}"
        existing.years = sorted(set((existing.years or []) + [year]))
        existing.pl_data = pl_data
        existing.uploaded_by = uploaded_by
    else:
        db.add(PropDevFinancialUpload(
            tenant_id=tenant_id,
            company_id=company.id,
            company_name=company.name,
            filename=filename,
            date_range=f"Property P&L routed from {block.sheet_name}",
            years=[year],
            periods=[],
            pl_data=pl_data,
            bs_data=[],
            cf_data=[],
            uploaded_by=uploaded_by,
        ))
    return True


def _norm_label(value: str) -> str:
    return " ".join(str(value or "").lower().replace("_", " ").split())


def _parse_report(result) -> dict:
    called = sum(
        block.computed_totals.get("called", 0)
        for block in result.capital_call_blocks
        if block.company_id or block.attribution_confidence in {"high", "medium"}
    )
    received = sum(
        block.computed_totals.get("received", 0)
        for block in result.capital_call_blocks
        if block.company_id or block.attribution_confidence in {"high", "medium"}
    )
    balance = sum(
        block.computed_totals.get("balance", 0)
        for block in result.capital_call_blocks
        if block.company_id or block.attribution_confidence in {"high", "medium"}
    )
    return {
        "detected_blocks": len(result.blocks),
        "capital_call_blocks": len(result.capital_call_blocks),
        "expense_builder_blocks": len(result.expense_builder_blocks),
        "property_pl_blocks": len(result.property_pl_blocks),
        "unknown_blocks": len(result.unknown_blocks),
        "totals": {
            "called": round(called, 2),
            "received": round(received, 2),
            "outstanding": round(balance, 2),
            "called_minus_received": round(called - received, 2),
        },
        "manual_review": result.manual_review,
        "company_preview": result.company_preview,
        "blocks": [block_to_dict(block) for block in result.blocks],
    }


@router.post("/import-capital-contributions/preview")
async def preview_capital_contributions(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    """Parse only — never writes. Use company_preview to verify sheet ↔ company ↔ latest period."""
    content = await file.read()
    result = parse_workbook(
        content,
        _company_candidates(db, current_user.tenant_id),
    )
    return {
        "status": "preview",
        "message": (
            "Preview only — existing Capital Call records were NOT modified. "
            "Review company_preview, then POST /import-capital-contributions with confirm=true."
        ),
        **_parse_report(result),
    }


@router.post("/import-capital-contributions")
async def import_capital_contributions(
    file: UploadFile = File(...),
    confirm: bool = Form(False),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    content = await file.read()
    parsed = parse_workbook(
        content,
        _company_candidates(db, current_user.tenant_id),
    )
    report = _parse_report(parsed)

    if not confirm:
        # Safety gate: never delete/overwrite until explicit confirmation.
        return {
            "status": "preview_required",
            "message": (
                "Import blocked — pass confirm=true after reviewing the Preview summary. "
                "Existing Capital Call records were NOT deleted or overwritten."
            ),
            **report,
        }

    affected_companies: dict[uuid.UUID, PropDevCompany] = {}
    imported_calls = 0
    imported_expenses = 0
    routed_pl_blocks = 0

    try:
        # Resolve attribution before deleting anything. Ambiguous blocks stay in
        # the report and are never silently assigned.
        for block in parsed.capital_call_blocks + parsed.expense_builder_blocks:
            company = _get_or_create_company(db, current_user.tenant_id, block)
            if company:
                affected_companies[company.id] = company

        # Idempotent re-import: replace only capital-call rows for companies
        # confidently represented in this workbook.
        for company_id in affected_companies:
            db.query(PropDevCapitalCall).filter(
                PropDevCapitalCall.tenant_id == current_user.tenant_id,
                PropDevCapitalCall.company_id == company_id,
            ).delete(synchronize_session=False)
            db.query(PropDevExpense).filter(
                PropDevExpense.tenant_id == current_user.tenant_id,
                PropDevExpense.company_id == company_id,
                PropDevExpense.category == "Capital Call Justification",
            ).delete(synchronize_session=False)

        for block in parsed.capital_call_blocks:
            company = _get_or_create_company(db, current_user.tenant_id, block)
            if not company:
                continue
            block_total = block.computed_totals.get("called", 0)
            period_label = (
                (block.period_label or block.title or "Imported Capital Call")[:100]
            )
            for row in block.rows:
                partner = _upsert_partner(
                    db, current_user.tenant_id, company, row
                )
                status, due_date = call_status(
                    row.amount_called,
                    row.amount_received,
                    row.balance,
                    block.call_date,
                    row.received_date,
                )
                db.add(PropDevCapitalCall(
                    tenant_id=current_user.tenant_id,
                    company_id=company.id,
                    partner_id=partner.id,
                    period=period_label,
                    share_percent=_fit_share_pct(row.share_percent),
                    total_call_amount=block_total,
                    partner_share=row.amount_called,
                    old_dues=row.old_dues,
                    total_due=(
                        row.total_due
                        if getattr(row, "total_due", 0) and row.total_due > 0
                        else (row.old_dues + row.amount_called)
                    ),
                    amount_received=row.amount_received,
                    received_date=row.received_date,
                    due_date=due_date,
                    status=status,
                ))
                imported_calls += 1

        for block in parsed.expense_builder_blocks:
            company = _get_or_create_company(db, current_user.tenant_id, block)
            if not company:
                continue
            # expense_date is NOT NULL on propdev_expenses — use call date or today
            expense_date = block.call_date or date.today()
            for expense in block.expense_rows:
                db.add(PropDevExpense(
                    tenant_id=current_user.tenant_id,
                    company_id=company.id,
                    expense_date=expense_date,
                    expense_type=(expense.get("category") or "Other")[:255],
                    category="Capital Call Justification",
                    vendor=(block.linked_call_title or block.title or company.name)[:255],
                    amount=expense["amount"],
                    status="Planned",
                ))
                imported_expenses += 1

        for block in parsed.property_pl_blocks:
            if _route_property_pl(
                db,
                current_user.tenant_id,
                block,
                file.filename or "capital-calls.xlsx",
                current_user.email,
            ):
                routed_pl_blocks += 1

        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=(
                "Import failed due to invalid/missing required fields "
                "(often expense date or share %). Check company sheet names match Company Registry, then retry."
            ),
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Database error while importing capital calls: {exc.__class__.__name__}",
        ) from exc
    except Exception:
        db.rollback()
        raise

    return {
        "status": "success",
        "imported": len(affected_companies),
        "capital_call_rows_imported": imported_calls,
        "expense_rows_imported": imported_expenses,
        "property_pl_blocks_routed": routed_pl_blocks,
        **report,
    }
