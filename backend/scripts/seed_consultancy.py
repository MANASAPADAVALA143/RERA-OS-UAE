"""
Seed a demo Consultancy & Outsourcing company with 3 years of financials
(P&L / Balance Sheet / Cash Flow) and a client invoice book.

Idempotent — replaces the demo company's rows on each run.

Run from backend/:
    python scripts/seed_consultancy.py
    python scripts/seed_consultancy.py --tenant-id <uuid>

Headline figures (FY2025): revenue $2.40M, payroll $1.75M, net income $280K.
3-year trend 2023-2025. Balance sheet balances. 8 clients with AR aging.
"""
import argparse
import sys
import uuid
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main  # noqa: F401,E402  — registers all models so relationships resolve

from database import SessionLocal  # noqa: E402
from models.tenancy import TenantUser  # noqa: E402
from models.consultancy.company import ConsultancyCompany  # noqa: E402
from models.consultancy.financial_upload import ConsultancyFinancialUpload  # noqa: E402
from models.consultancy.invoice import ConsultancyInvoice  # noqa: E402
from services.local_auth import DEMO_EMAIL  # noqa: E402

COMPANY_NAME = "Meridian Advisory Partners"
YEARS = [2023, 2024, 2025]


def _row(label, v2023, v2024, v2025, *, indent=0, total=False, header=False, net_income=False):
    return {
        "label": label,
        "values": {"2023": v2023, "2024": v2024, "2025": v2025},
        "indent": indent,
        "isTotal": total,
        "isSectionHeader": header,
        "isNetIncome": net_income,
    }


PL_DATA = [
    _row("Income", 0, 0, 0, header=True),
    _row("Consulting Fees", 1_480_000, 1_700_000, 1_930_000, indent=1),
    _row("Outsourced Staffing", 300_000, 340_000, 385_000, indent=1),
    _row("Other Income", 70_000, 80_000, 85_000, indent=1),
    _row("Total Income", 1_850_000, 2_120_000, 2_400_000, total=True),
    _row("Expenses", 0, 0, 0, header=True),
    _row("Consulting Staff Salaries", 1_180_000, 1_310_000, 1_450_000, indent=1),
    _row("Employee Benefits & Payroll Tax", 240_000, 270_000, 300_000, indent=1),
    _row("Office Rent Expense", 96_000, 100_000, 108_000, indent=1),
    _row("Software & Subscriptions", 44_000, 58_000, 72_000, indent=1),
    _row("Professional Services", 35_000, 44_000, 55_000, indent=1),
    _row("Travel & Marketing", 42_000, 60_000, 75_000, indent=1),
    _row("Other G&A", 38_000, 50_000, 60_000, indent=1),
    _row("Total Expenses", 1_675_000, 1_892_000, 2_120_000, total=True),
    _row("Net Income", 175_000, 228_000, 280_000, total=True, net_income=True),
]

# Balance sheet — each year balances (Assets = Liabilities + Equity).
BS_DATA = [
    _row("Assets", 0, 0, 0, header=True),
    _row("Bank Accounts", 430_000, 520_000, 640_000, indent=1),
    _row("Accounts Receivable", 250_000, 300_000, 355_000, indent=1),
    _row("Prepaid Expenses", 30_000, 38_000, 45_000, indent=1),
    _row("Fixed Assets, net", 150_000, 170_000, 180_000, indent=1),
    _row("Total Assets", 860_000, 1_028_000, 1_220_000, total=True),
    _row("Liabilities", 0, 0, 0, header=True),
    _row("Accounts Payable", 70_000, 84_000, 96_000, indent=1),
    _row("Accrued Payroll", 105_000, 120_000, 138_000, indent=1),
    _row("Deferred Revenue", 80_000, 100_000, 120_000, indent=1),
    _row("Bank Loan", 293_000, 212_000, 146_000, indent=1),
    _row("Total Liabilities", 548_000, 516_000, 500_000, total=True),
    _row("Equity", 0, 0, 0, header=True),
    _row("Retained Earnings", 312_000, 512_000, 720_000, indent=1),
    _row("Total Equity", 312_000, 512_000, 720_000, total=True),
    _row("Total Liabilities & Equity", 860_000, 1_028_000, 1_220_000, total=True),
]

CF_DATA = [
    _row("Operating Activities", 0, 0, 0, header=True),
    _row("Net Income", 175_000, 228_000, 280_000, indent=1),
    _row("Depreciation", 30_000, 35_000, 40_000, indent=1),
    _row("Change in Working Capital", -35_000, -40_000, -26_000, indent=1),
    _row("Cash from Operations", 170_000, 223_000, 294_000, total=True),
    _row("Investing Activities", 0, 0, 0, header=True),
    _row("Capital Expenditure", -25_000, -30_000, -35_000, indent=1),
    _row("Cash from Investing", -25_000, -30_000, -35_000, total=True),
    _row("Financing Activities", 0, 0, 0, header=True),
    _row("Loan Repayment", -60_000, -81_000, -50_000, indent=1),
    _row("Dividends Paid", -60_000, -80_000, -120_000, indent=1),
    _row("Cash from Financing", -120_000, -161_000, -170_000, total=True),
    _row("Net Change in Cash", 25_000, 32_000, 89_000, total=True),
]

# (client, invoice_date, amount, collected_amount, collected_date, standard_rate_amount)
INVOICES = [
    ("Emaar Properties PJSC",    "2026-03-15", 130_000, 130_000, "2026-04-10", 140_000),
    ("Emaar Properties PJSC",    "2026-06-20", 145_000, 145_000, "2026-07-18", 150_000),
    ("Emaar Properties PJSC",    "2026-08-20",  80_000,      0, None,           88_000),
    ("Aldar Investments",        "2026-04-05", 120_000, 120_000, "2026-05-06", 128_000),
    ("Aldar Investments",        "2026-07-01", 110_000,  98_000, "2026-08-12", 118_000),
    ("Aldar Investments",        "2026-08-05",  75_000,   8_000, "2026-08-30",  80_000),
    ("DAMAC Group",              "2026-05-10",  95_000,  95_000, "2026-06-15", 102_000),
    ("DAMAC Group",              "2026-07-10",  66_000,      0, None,           72_000),
    ("Majid Al Futtaim Holding", "2026-06-18",  90_000,  90_000, "2026-07-20",  96_000),
    ("Majid Al Futtaim Holding", "2026-08-25",  38_000,  10_000, "2026-08-31",  40_000),
    ("Meraas Holding",           "2026-05-22",  72_000,  72_000, "2026-06-28",  78_000),
    ("Meraas Holding",           "2026-07-25",  38_000,  12_000, "2026-08-20",  42_000),
    ("Nakheel PJSC",             "2026-06-15",  34_000,      0, None,           38_000),
    ("Sobha Realty",             "2026-08-18",  12_000,      0, None,           14_000),
    ("Binghatti Developers",     "2026-05-20",  12_000,      0, None,           14_000),
    ("Binghatti Developers",     "2026-02-14",  41_000,  41_000, "2026-03-20",  44_000),
]


def _resolve_tenant_id(explicit):
    if explicit:
        return uuid.UUID(str(explicit))
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            sys.exit(f"No demo tenant for {DEMO_EMAIL}. Start the API once to bootstrap it.")
        return user.tenant_id
    finally:
        db.close()


def seed(tenant_id=None):
    tid = _resolve_tenant_id(tenant_id)
    db = SessionLocal()
    try:
        company = db.query(ConsultancyCompany).filter(
            ConsultancyCompany.tenant_id == tid,
            ConsultancyCompany.name == COMPANY_NAME,
        ).first()
        if not company:
            company = ConsultancyCompany(tenant_id=tid, name=COMPANY_NAME, cash_available=640_000, status="active")
            db.add(company)
            db.flush()
        else:
            company.cash_available = 640_000

        db.query(ConsultancyFinancialUpload).filter(
            ConsultancyFinancialUpload.tenant_id == tid,
            ConsultancyFinancialUpload.company_id == company.id,
        ).delete()
        db.add(ConsultancyFinancialUpload(
            tenant_id=tid, company_id=company.id, company_name=COMPANY_NAME,
            filename="seed_consultancy.py", date_range="FY2023–FY2025",
            years=YEARS, periods=[],
            pl_data=PL_DATA, bs_data=BS_DATA, cf_data=CF_DATA,
            uploaded_by="seed",
        ))

        db.query(ConsultancyInvoice).filter(
            ConsultancyInvoice.tenant_id == tid,
            ConsultancyInvoice.company_id == company.id,
        ).delete()
        for client, inv_date, amount, collected, coll_date, std_rate in INVOICES:
            d = date.fromisoformat(inv_date)
            db.add(ConsultancyInvoice(
                tenant_id=tid, company_id=company.id,
                client_name=client, invoice_date=d, amount=amount,
                due_date=date(d.year, d.month, 28),
                collected_amount=collected,
                collected_date=date.fromisoformat(coll_date) if coll_date else None,
                standard_rate_amount=std_rate, uploaded_by="seed",
            ))

        db.commit()
        billed = sum(i[2] for i in INVOICES)
        collected = sum(i[3] for i in INVOICES)
        clients = len({i[0] for i in INVOICES})
        print(f"  seeded: {COMPANY_NAME} — FY2025 revenue $2.40M, net income $280K")
        print(f"  invoices: {len(INVOICES)} across {clients} clients — "
              f"${billed:,.0f} billed / ${collected:,.0f} collected / ${billed - collected:,.0f} open")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", default=None)
    args = parser.parse_args()
    seed(args.tenant_id)
