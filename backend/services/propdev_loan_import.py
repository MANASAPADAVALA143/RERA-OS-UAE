"""Import Property Dev loans from Bank Loan Information Excel."""
from __future__ import annotations

import uuid

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from models.propdev.company import PropDevCompany
from models.propdev.loan import PropDevLoan
from services.loan_excel_import import (
    ParsedLoanRow,
    _balance_for_period,
    _collect_balance_periods,
    dedupe_parsed_loan_rows,
    parse_loan_workbook,
)


def _match_propdev_company(db: Session, tenant_id: uuid.UUID, name: str) -> PropDevCompany | None:
    needle = name.strip()
    if not needle:
        return None
    return db.query(PropDevCompany).filter(
        PropDevCompany.tenant_id == tenant_id,
        or_(
            func.lower(func.trim(PropDevCompany.name)) == needle.lower(),
            PropDevCompany.name.ilike(f"%{needle}%"),
        ),
    ).first()


def import_propdev_loans_from_excel(
    db: Session,
    tenant_id: uuid.UUID,
    content: bytes,
    *,
    balance_period: str | None = None,
) -> dict:
    parsed_result = parse_loan_workbook(content, entity_scope="all", sheet_scope="bank_loan_only")
    parsed, _deduped = dedupe_parsed_loan_rows(parsed_result.rows)
    if not parsed:
        return {
            "created": 0,
            "companies_updated": [],
            "skipped_rows": [],
            "balance_periods": parsed_result.balance_periods,
            "message": (
                "No loan rows found on the Bank Loan Information / Business Banks and Loan Information "
                "sheet. Expected columns: Entity Name (or Company Name), Property Name, Loan Bank Name, "
                "Loan Amount, Interest Rate, EMI, Maturity Date, Balance. "
                "Company names must match Property Dev registry entities."
            ),
        }

    period = balance_period
    file_periods = _collect_balance_periods(parsed)
    if file_periods:
        if not period or period not in file_periods:
            period = file_periods[-1]

    matched: list[tuple[PropDevCompany, ParsedLoanRow]] = []
    errors: list[str] = []
    for row in parsed:
        company = _match_propdev_company(db, tenant_id, row.company)
        if not company:
            errors.append(
                f"Row {row.row_num}: company '{row.company}' not in Property Dev registry — skipped"
            )
            continue
        matched.append((company, row))

    if not matched:
        return {
            "created": 0,
            "companies_updated": [],
            "skipped_rows": errors,
            "skipped_registry": len(errors),
            "balance_periods": parsed_result.balance_periods,
            "message": "No loans imported — no rows matched Property Dev companies. Add entities in Company Registry first.",
        }

    companies_touched: dict[uuid.UUID, PropDevCompany] = {}
    for company, _row in matched:
        companies_touched[company.id] = company

    for company in companies_touched.values():
        for ln in company.loans:
            db.delete(ln)
    db.flush()

    created = 0
    for company, row in matched:
        bal, _bal_date = _balance_for_period(row, period)
        balance = bal if bal is not None else row.loan_amount
        rate = row.loan_interest_rate or 0.0
        # Prefer Excel Property Name; fall back to company registry property, then entity name.
        prop_name = (row.property_name or "").strip()
        if not prop_name or prop_name.lower() == company.name.lower():
            reg = (company.property_name or "").strip()
            prop_name = reg or company.name
        # Keep registry property in sync when it was blank.
        if not (company.property_name or "").strip() and prop_name:
            company.property_name = prop_name
        db.add(PropDevLoan(
            tenant_id=tenant_id,
            company_id=company.id,
            bank=row.bank_name,
            property_name=prop_name,
            loan_date=row.loan_date,
            account_no=row.account_no,
            loan_amount=row.loan_amount,
            balance=balance or 0.0,
            interest_rate=rate,
            emi=row.loan_emi or 0.0,
            maturity_date=row.maturity_date,
            emi_day=row.loan_emi_day or 15,
            lender_name=row.lender_name or row.bank_name,
            lender_email=row.lender_email,
            lender_phone=row.lender_phone,
            emi_status="Current",
        ))
        created += 1

    db.commit()

    company_names = sorted({c.name for c in companies_touched.values()})
    sheets = sorted({r.sheet for _, r in matched if r.sheet})
    msg = f"Imported {created} loan(s) across {len(company_names)} entit{'y' if len(company_names) == 1 else 'ies'}."
    if sheets:
        msg += f" Sheets: {', '.join(sheets)}."
    if errors:
        msg += f" Skipped {len(errors)} row(s) not in registry."

    return {
        "created": created,
        "companies_updated": company_names,
        "skipped_rows": errors[:20],
        "skipped_registry": len(errors),
        "balance_periods": parsed_result.balance_periods,
        "balance_period_used": period,
        "sheets_parsed": sheets,
        "message": msg,
    }
