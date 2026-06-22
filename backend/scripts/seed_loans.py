"""
Seed Loan Tracker demo data.
Run from backend/:  python scripts/seed_loans.py
Idempotent — skips if already seeded.
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import models.tenancy  # noqa
import models.real_estate.entity  # noqa
import models.real_estate.permitting  # noqa
import models.real_estate.construction_cost  # noqa
import models.real_estate.construction_extended  # noqa
import models.real_estate.work_log  # noqa
import models.real_estate.quality_check  # noqa
import models.real_estate.inspection  # noqa
import models.real_estate.daily_progress_photo  # noqa
import models.real_estate.unit  # noqa
import models.real_estate.financing  # noqa
import models.real_estate.reit_rental  # noqa
import models.real_estate.pipeline  # noqa
import models.real_estate.risk  # noqa
import models.real_estate.pay_application  # noqa
import models.real_estate.expense  # noqa
import models.real_estate.loan  # noqa
import models.reit.property  # noqa
import models.reit.unit  # noqa
import models.reit.financials  # noqa

from database import Base, SessionLocal, engine
from models.real_estate.entity import Entity
from models.real_estate.loan import Loan
from models.tenancy import TenantUser
from services.local_auth import DEMO_EMAIL

Base.metadata.create_all(bind=engine)


def seed():
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            print("ERROR: Demo user not found.")
            sys.exit(1)

        tid = user.tenant_id

        if db.query(Loan).filter(Loan.tenant_id == tid).count():
            print("Loans already seeded. Skipping.")
            return

        entities = db.query(Entity).filter(Entity.tenant_id == tid).order_by(Entity.entity_name).all()
        e1 = entities[0] if len(entities) > 0 else None
        e2 = entities[1] if len(entities) > 1 else e1

        def e1id():
            return e1.id if e1 else None

        def e2id():
            return e2.id if e2 else None

        def e1name():
            return e1.entity_name if e1 else "Lone Star Development LLC"

        def e2name():
            return e2.entity_name if e2 else "Summit Properties LP"

        loans = [
            # ── Eastside Lofts – Construction Loan ───────────────────────────
            Loan(
                tenant_id=tid,
                entity_id=e1id(),
                company_name=e1name(),
                property_name="Eastside Lofts Phase 1",
                loan_bank_name="Wells Fargo Bank",
                loan_date=date(2023, 9, 15),
                loan_account_no="WF8834512901",
                loan_amount=14_500_000.00,
                loan_interest_rate=0.0750,
                loan_emi=108_750.00,
                lender_name="James Harrington",
                lender_email="j.harrington@wellsfargo.com",
                lender_phone="(512) 555-0201",
                loan_maturity_date=date(2026, 9, 15),
                loan_balance_as_of=11_320_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=15,
                loan_deduction_bank_account="Chase Business Checking ****4821",
                created_by=DEMO_EMAIL,
            ),
            # ── Eastside Lofts – Mezzanine Debt ─────────────────────────────
            Loan(
                tenant_id=tid,
                entity_id=e1id(),
                company_name=e1name(),
                property_name="Eastside Lofts Phase 1",
                loan_bank_name="Silvergate Capital",
                loan_date=date(2023, 10, 1),
                loan_account_no="SG20231001EL",
                loan_amount=2_800_000.00,
                loan_interest_rate=0.1050,
                loan_emi=29_400.00,
                lender_name="Patricia Okonkwo",
                lender_email="p.okonkwo@silvergatecap.com",
                lender_phone="(737) 555-0318",
                loan_maturity_date=date(2026, 7, 1),
                loan_balance_as_of=2_100_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=1,
                loan_deduction_bank_account="Chase Business Checking ****4821",
                created_by=DEMO_EMAIL,
            ),
            # ── Eastside Lofts – Equipment / Crane Lease Loan ───────────────
            Loan(
                tenant_id=tid,
                entity_id=e1id(),
                company_name=e1name(),
                property_name="Eastside Lofts Phase 1",
                loan_bank_name="Caterpillar Financial",
                loan_date=date(2024, 2, 10),
                loan_account_no="CAT20240210TX",
                loan_amount=480_000.00,
                loan_interest_rate=0.0625,
                loan_emi=9_312.00,
                lender_name="Carlos Mendez",
                lender_email="c.mendez@catfinancial.com",
                lender_phone="(800) 555-0456",
                loan_maturity_date=date(2026, 2, 10),
                loan_balance_as_of=132_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=10,
                loan_deduction_bank_account="Wells Fargo Operating ****7732",
                created_by=DEMO_EMAIL,
            ),
            # ── Riverfront Residences – Permanent Loan ───────────────────────
            Loan(
                tenant_id=tid,
                entity_id=e2id(),
                company_name=e2name(),
                property_name="Riverfront Residences",
                loan_bank_name="JPMorgan Chase Bank",
                loan_date=date(2022, 8, 1),
                loan_account_no="JP7734209811",
                loan_amount=9_200_000.00,
                loan_interest_rate=0.0595,
                loan_emi=54_870.00,
                lender_name="Sandra Liu",
                lender_email="s.liu@jpmorgan.com",
                lender_phone="(214) 555-0712",
                loan_maturity_date=date(2032, 8, 1),
                loan_balance_as_of=8_460_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=1,
                loan_deduction_bank_account="JPMorgan Operating ****5519",
                created_by=DEMO_EMAIL,
            ),
            # ── Riverfront Residences – Bridge Loan (maturing soon — within 90 days) ─
            Loan(
                tenant_id=tid,
                entity_id=e2id(),
                company_name=e2name(),
                property_name="Riverfront Residences",
                loan_bank_name="Texan Community Bank",
                loan_date=date(2024, 6, 20),
                loan_account_no="TCB2024062001",
                loan_amount=1_750_000.00,
                loan_interest_rate=0.0825,
                loan_emi=14_359.00,
                lender_name="Michael Torres",
                lender_email="m.torres@texanbank.com",
                lender_phone="(972) 555-0993",
                loan_maturity_date=date(2026, 8, 20),   # within 90 days of 2026-06-21
                loan_balance_as_of=1_540_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=20,
                loan_deduction_bank_account="Texan Checking ****3301",
                created_by=DEMO_EMAIL,
            ),
            # ── Riverfront Residences – Solar / Green Energy Loan ────────────
            Loan(
                tenant_id=tid,
                entity_id=e2id(),
                company_name=e2name(),
                property_name="Riverfront Residences",
                loan_bank_name="Frost Bank",
                loan_date=date(2024, 3, 5),
                loan_account_no="FB20240305RR",
                loan_amount=620_000.00,
                loan_interest_rate=0.0475,
                loan_emi=5_208.00,
                lender_name="Angela Reyes",
                lender_email="a.reyes@frostbank.com",
                lender_phone="(210) 555-0622",
                loan_maturity_date=date(2034, 3, 5),
                loan_balance_as_of=571_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=5,
                loan_deduction_bank_account="Frost Business Checking ****8870",
                created_by=DEMO_EMAIL,
            ),
            # ── Corporate HQ – Office Lease Financing ───────────────────────
            Loan(
                tenant_id=tid,
                entity_id=e1id(),
                company_name=e1name(),
                property_name="Corporate HQ — Downtown Austin",
                loan_bank_name="Bank of America",
                loan_date=date(2021, 11, 1),
                loan_account_no="BOA9920118847",
                loan_amount=3_100_000.00,
                loan_interest_rate=0.0550,
                loan_emi=23_870.00,
                lender_name="Robert Kim",
                lender_email="r.kim@bankofamerica.com",
                lender_phone="(512) 555-0445",
                loan_maturity_date=date(2031, 11, 1),
                loan_balance_as_of=2_290_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=12,
                loan_deduction_bank_account="BofA Operating ****2241",
                created_by=DEMO_EMAIL,
            ),
            # ── Land Parcel – Raw Land Acquisition Loan ──────────────────────
            Loan(
                tenant_id=tid,
                entity_id=e2id(),
                company_name=e2name(),
                property_name="Mueller District Land Parcel",
                loan_bank_name="Texas Capital Bank",
                loan_date=date(2025, 1, 20),
                loan_account_no="TCB2025012044",
                loan_amount=5_400_000.00,
                loan_interest_rate=0.0790,
                loan_emi=None,   # interest-only during land hold
                lender_name="Derek Nguyen",
                lender_email="d.nguyen@texascapital.com",
                lender_phone="(512) 555-0880",
                loan_maturity_date=date(2027, 1, 20),
                loan_balance_as_of=5_400_000.00,
                loan_balance_as_of_date=date(2026, 4, 30),
                loan_emi_day=20,
                loan_deduction_bank_account="Texas Capital Checking ****6614",
                created_by=DEMO_EMAIL,
            ),
        ]

        for loan in loans:
            db.add(loan)
        db.commit()
        print(f"Seeded {len(loans)} loans.")
        print("  Note: Riverfront Bridge Loan matures 2026-08-20 — within 90 days of today for demo.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
