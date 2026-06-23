"""
Import handler for Entities_Capital_Contribution.xlsx format.
Each sheet = one company. Two sections per sheet:
  1. Expense breakdown (Particulars / Amount / Per Month)
  2. Partner capital call table (Partner, % Share, Old Dues, New Call, Total, Received, Balance)
"""
import uuid
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
import openpyxl

from database import get_db
from middleware.auth import CurrentUser, require_write_access
from models.propdev.company import PropDevCompany
from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.expense import PropDevExpense
from models.propdev.partner import PropDevPartner

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


@router.post("/import-capital-contributions")
async def import_capital_contributions(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_write_access()),
    db: Session = Depends(get_db),
):
    content = await file.read()
    wb = openpyxl.load_workbook(BytesIO(content), data_only=True)

    results = []
    errors = []

    for sheet_name in wb.sheetnames:
        if sheet_name.upper() in SKIP_SHEETS:
            continue

        print(f"[CAPITAL IMPORT] Processing sheet: {sheet_name}")
        try:
            ws = wb[sheet_name]
            data = parse_company_sheet(sheet_name, ws)

            # Find or create company
            company = db.query(PropDevCompany).filter(
                PropDevCompany.tenant_id == current_user.tenant_id,
                PropDevCompany.name == sheet_name,
            ).first()

            if not company:
                company = PropDevCompany(
                    tenant_id=current_user.tenant_id,
                    name=sheet_name,
                    property_name=sheet_name,
                    address='', total_lots=0,
                    sale_consideration=0, land_cost=0, hard_cost=0, soft_cost=0,
                    title_charges=0, other_charges=0, property_tax=0,
                    loan_processing=0, professional_charges=0, legal_fees=0,
                    interest_on_loan=0, cash_available=0,
                )
                db.add(company)
                db.flush()
                print(f"[CAPITAL IMPORT] Created new company: {sheet_name}")

            # Clear old capital calls and expenses for this company
            db.query(PropDevCapitalCall).filter(
                PropDevCapitalCall.company_id == company.id
            ).delete()
            db.query(PropDevExpense).filter(
                PropDevExpense.company_id == company.id
            ).delete()

            # Find or create a placeholder partner for each capital call
            for cc in data['capital_calls']:
                partner = db.query(PropDevPartner).filter(
                    PropDevPartner.company_id == company.id,
                    PropDevPartner.name == cc['partner_name'],
                ).first()
                if not partner:
                    partner = PropDevPartner(
                        tenant_id=current_user.tenant_id,
                        company_id=company.id,
                        name=cc['partner_name'],
                        partner_type='Class A',
                        share_percent=cc['share_percent'],
                        capital_contributed=cc['amount_received'],
                        distributions_received=0,
                        preferred_return=0,
                        status='Active',
                    )
                    db.add(partner)
                    db.flush()

                db.add(PropDevCapitalCall(
                    tenant_id=current_user.tenant_id,
                    company_id=company.id,
                    partner_id=partner.id,
                    period=data['period'] or 'Current Period',
                    share_percent=cc['share_percent'],
                    total_call_amount=cc['total_due'],
                    partner_share=cc['total_due'],
                    old_dues=cc['old_dues'],
                    total_due=cc['total_due'],
                    amount_received=cc['amount_received'],
                    status=cc['status'],
                ))

            # Import expenses
            for exp in data['expenses']:
                db.add(PropDevExpense(
                    tenant_id=current_user.tenant_id,
                    company_id=company.id,
                    expense_type=exp['particulars'],
                    category='Operating',
                    vendor='',
                    amount=exp['amount'],
                    status='Paid',
                ))

            db.commit()
            results.append({
                'company': sheet_name,
                'period': data['period'],
                'partners': len(data['capital_calls']),
                'expenses': len(data['expenses']),
            })
            print(f"[CAPITAL IMPORT] Done: {sheet_name} — {len(data['capital_calls'])} partners, {len(data['expenses'])} expenses")

        except Exception as e:
            print(f"[CAPITAL IMPORT] ERROR on {sheet_name}: {e}")
            db.rollback()
            errors.append({'company': sheet_name, 'error': str(e)})
            continue

    return {
        'status': 'success',
        'imported': len(results),
        'results': results,
        'errors': errors,
    }
