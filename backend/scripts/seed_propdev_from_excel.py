"""Seed PropDev data from EstateCFO_12Companies_SampleDataFINAL.xlsx into RDS.
Run from backend/: python scripts/seed_propdev_from_excel.py [path_to_xlsx]
Default path: C:/Users/HCSUSER/Downloads/EstateCFO_12Companies_SampleDataFINAL.xlsx
Pass --clear to wipe existing PropDev data first.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import models.tenancy  # noqa
import models.propdev.company  # noqa
import models.propdev.lot  # noqa
import models.propdev.partner  # noqa
import models.propdev.loan  # noqa
import models.propdev.capital_call  # noqa
import models.propdev.expense  # noqa

from database import Base, SessionLocal, engine
from models.propdev.company import PropDevCompany
from models.propdev.lot import PropDevLot
from models.propdev.partner import PropDevPartner
from models.propdev.loan import PropDevLoan
from models.propdev.capital_call import PropDevCapitalCall
from models.propdev.expense import PropDevExpense
from models.tenancy import TenantUser
from services.local_auth import DEMO_EMAIL

# Import parsing functions from the existing excel_import router
from routers.propdev.excel_import import (
    parse_excel_file,
    extract_summary_data,
    extract_expense_data,
    extract_deal_pl_data,
    extract_loan_data,
    extract_partner_data,
    extract_capital_calls,
    extract_lot_data,
)

Base.metadata.create_all(bind=engine)

EXCEL_PATH = r"C:\Users\HCSUSER\Downloads\EstateCFO_12Companies_SampleDataFINAL.xlsx"


def seed(excel_path: str = EXCEL_PATH, clear: bool = False):
    print(f"Reading Excel: {excel_path}")
    with open(excel_path, "rb") as f:
        content = f.read()

    sheets = parse_excel_file(content)
    print(f"Sheets found: {list(sheets.keys())}")

    summary_data = extract_summary_data(sheets.get("SUMMARY", []))
    expense_data, expense_totals = extract_expense_data(sheets.get("Expense Dashboard", []))
    deal_pl_data = extract_deal_pl_data(sheets.get("Annexure I", []))
    loan_data = extract_loan_data(sheets.get("Loan Sheet", []))
    partner_data = extract_partner_data(sheets.get("Annexure II", []))
    capital_call_data = extract_capital_calls(sheets.get("Capital Calls", []), partner_data)
    lot_data = extract_lot_data(sheets.get("Lot Inventory", []))

    print(f"Companies in Excel: {list(summary_data.keys())}")

    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            print(f"ERROR: Demo user {DEMO_EMAIL} not found in DB. Ensure app has started at least once.")
            return

        tenant_id = user.tenant_id
        print(f"Using tenant_id: {tenant_id}")

        if clear:
            print("Clearing existing PropDev data...")
            existing = db.query(PropDevCompany).filter(PropDevCompany.tenant_id == tenant_id).all()
            for co in existing:
                for lot in co.lots: db.delete(lot)
                for p in co.partners: db.delete(p)
                for ln in co.loans: db.delete(ln)
                for cc in co.capital_calls: db.delete(cc)
                for exp in co.expenses: db.delete(exp)
                db.delete(co)
            db.commit()
            print(f"Cleared {len(existing)} existing companies.")

        created = 0
        total = len(summary_data)

        for idx, (company_name, summary) in enumerate(summary_data.items(), 1):
            print(f"[{idx}/{total}] Importing: {company_name}")
            try:
                pl_data = deal_pl_data.get(company_name, {})
                exp_totals = expense_totals.get(company_name, {})

                land_cost = float(pl_data.get("land_cost", 0) or 0)
                hard_cost = float(pl_data.get("hard_cost", 0) or exp_totals.get("hard_cost", 0))
                soft_cost = float(pl_data.get("soft_cost", 0) or exp_totals.get("soft_cost", 0))
                title_charges = float(pl_data.get("title_charges", 0) or exp_totals.get("title_charges", 0))
                other_charges = float(pl_data.get("other_charges", 0) or exp_totals.get("other_charges", 0))
                property_tax = float(pl_data.get("property_tax", 0) or exp_totals.get("property_tax", 0))
                loan_processing = float(pl_data.get("loan_processing", 0) or exp_totals.get("loan_processing", 0))
                professional_charges = float(pl_data.get("professional_charges", 0) or exp_totals.get("professional_charges", 0))
                legal_fees = float(pl_data.get("legal_fees", 0) or exp_totals.get("legal_fees", 0))
                interest_on_loan = float(pl_data.get("interest_on_loan", 0) or exp_totals.get("interest_on_loan", 0))

                company = db.query(PropDevCompany).filter(
                    PropDevCompany.tenant_id == tenant_id,
                    PropDevCompany.name == company_name,
                ).first()

                if company:
                    company.property_name = summary.get("property_name", "") or company.property_name
                    company.total_lots = summary.get("total_lots", 0) or company.total_lots
                    company.sale_consideration = float(summary.get("sale_consideration", 0))
                    company.land_cost = land_cost
                    company.hard_cost = hard_cost
                    company.soft_cost = soft_cost
                    company.title_charges = title_charges
                    company.other_charges = other_charges
                    company.property_tax = property_tax
                    company.loan_processing = loan_processing
                    company.professional_charges = professional_charges
                    company.legal_fees = legal_fees
                    company.interest_on_loan = interest_on_loan
                    for lot in company.lots: db.delete(lot)
                    for p in company.partners: db.delete(p)
                    for ln in company.loans: db.delete(ln)
                    for cc in company.capital_calls: db.delete(cc)
                    for exp in company.expenses: db.delete(exp)
                    db.flush()
                else:
                    company = PropDevCompany(
                        tenant_id=tenant_id,
                        name=company_name,
                        property_name=summary.get("property_name", ""),
                        address="",
                        total_lots=summary.get("total_lots", 0),
                        sale_consideration=float(summary.get("sale_consideration", 0)),
                        land_cost=land_cost,
                        hard_cost=hard_cost,
                        soft_cost=soft_cost,
                        title_charges=title_charges,
                        other_charges=other_charges,
                        property_tax=property_tax,
                        loan_processing=loan_processing,
                        professional_charges=professional_charges,
                        legal_fees=legal_fees,
                        interest_on_loan=interest_on_loan,
                        cash_available=0,
                    )
                    db.add(company)
                db.flush()

                for lot in lot_data.get(company_name, []):
                    db.add(PropDevLot(
                        tenant_id=tenant_id,
                        company_id=company.id,
                        lot_no=lot.get("lot_no", ""),
                        block=lot.get("block", ""),
                        size_sqft=float(lot.get("size_sqft", 0)),
                        list_price=float(lot.get("list_price", 0)),
                        sale_price=lot.get("sale_price"),
                        status=lot.get("status", "available"),
                        buyer_name=lot.get("buyer_name"),
                        contract_date=lot.get("contract_date"),
                        close_date=lot.get("close_date"),
                    ))

                partners_by_name = {}
                for partner in partner_data.get(company_name, []):
                    p = PropDevPartner(
                        tenant_id=tenant_id,
                        company_id=company.id,
                        name=partner.get("name", ""),
                        partner_type=partner.get("partner_type", "Class A"),
                        share_percent=float(partner.get("share_percent", 0)),
                        capital_contributed=float(partner.get("capital_contributed", 0)),
                        distributions_received=float(partner.get("distributions_received", 0)),
                        preferred_return=float(partner.get("preferred_return", 0)),
                        status=partner.get("status", "Active"),
                    )
                    db.add(p)
                    db.flush()
                    partners_by_name[partner.get("name", "")] = p.id

                for loan in loan_data.get(company_name, []):
                    db.add(PropDevLoan(
                        tenant_id=tenant_id,
                        company_id=company.id,
                        bank=loan.get("bank", ""),
                        loan_date=loan.get("loan_date"),
                        account_no=loan.get("account_no"),
                        loan_amount=float(loan.get("loan_amount", 0)),
                        balance=float(loan.get("balance", 0)),
                        interest_rate=float(loan.get("interest_rate", 0)),
                        emi=float(loan.get("emi", 0)),
                        maturity_date=loan.get("maturity_date"),
                        emi_day=int(loan.get("emi_day", 15)),
                        lender_name=loan.get("lender_name"),
                        lender_email=loan.get("lender_email"),
                        lender_phone=loan.get("lender_phone"),
                        bank_account=loan.get("bank_account"),
                        emi_status=loan.get("emi_status", "Current"),
                    ))

                for call in capital_call_data.get(company_name, []):
                    partner_id = partners_by_name.get(call.get("partner_name", ""))
                    if partner_id:
                        db.add(PropDevCapitalCall(
                            tenant_id=tenant_id,
                            company_id=company.id,
                            partner_id=partner_id,
                            period=call.get("period", ""),
                            share_percent=float(call.get("share_percent", 0)),
                            total_call_amount=float(call.get("total_call_amount", 0)),
                            partner_share=float(call.get("partner_share", 0)),
                            old_dues=float(call.get("old_dues", 0)),
                            total_due=float(call.get("total_due", 0)),
                            amount_received=float(call.get("amount_received", 0)),
                            status=call.get("status", "Outstanding"),
                        ))

                for expense in expense_data.get(company_name, []):
                    db.add(PropDevExpense(
                        tenant_id=tenant_id,
                        company_id=company.id,
                        expense_date=expense.get("expense_date"),
                        expense_type=expense.get("expense_type", ""),
                        category=expense.get("category", ""),
                        vendor=expense.get("vendor", ""),
                        invoice_no=expense.get("invoice_no"),
                        amount=float(expense.get("amount", 0)),
                        status=expense.get("status", "Paid"),
                    ))

                db.commit()
                print(f"  ✓ {company_name} imported (lots={len(lot_data.get(company_name, []))}, partners={len(partner_data.get(company_name, []))}, loans={len(loan_data.get(company_name, []))})")
                created += 1

            except Exception as e:
                print(f"  ✗ ERROR for {company_name}: {e}")
                db.rollback()

        print(f"\nDone: {created}/{total} companies imported into PropDev.")

    finally:
        db.close()


if __name__ == "__main__":
    excel_path = EXCEL_PATH
    clear = False
    for arg in sys.argv[1:]:
        if arg == "--clear":
            clear = True
        elif not arg.startswith("--"):
            excel_path = arg

    seed(excel_path=excel_path, clear=clear)
