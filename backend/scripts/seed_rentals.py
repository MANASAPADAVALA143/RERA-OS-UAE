"""Seed Rentals module demo data.
Run from backend/: python scripts/seed_rentals.py
Idempotent — skips if already seeded.
"""
import sys
from datetime import date, timedelta
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
import models.rentals.models  # noqa

from database import Base, SessionLocal, engine
from models.rentals.models import (
    RentalCollection, RentalCompany, RentalExpense, RentalExpenseCategory,
    RentalInvoice, RentalLease, RentalLeaseStatus, RentalOwnership,
    RentalPartnerRole, RentalProp, RentalTenant, RentalUnit, RentalUnitStatus,
)
from models.tenancy import TenantUser
from services.local_auth import DEMO_EMAIL

Base.metadata.create_all(bind=engine)

TODAY = date(2026, 6, 21)


def seed():
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            print("ERROR: Demo user not found.")
            sys.exit(1)

        tid = user.tenant_id

        if db.query(RentalCompany).filter(RentalCompany.tenant_id == tid).count():
            print("Rentals already seeded. Skipping.")
            return

        COMPANIES = [
            ("Marina Heights Residences", "Marina Walk, Dubai Marina, Dubai", "residential"),
            ("Palm Vista Apartments",     "Palm Jumeirah Crescent, Dubai",    "residential"),
            ("Business Bay Tower",          "Sheikh Zayed Rd, Business Bay, Dubai", "mixed_use"),
            ("JBR Coastal Suites",          "The Walk, JBR, Dubai",             "residential"),
        ]

        UNIT_CONFIGS = [
            # Marina Heights — 5 occupied, 1 vacant
            [("M-101","occupied",12500,None),("M-102","occupied",11800,None),("M-103","occupied",13200,None),
             ("M-104","occupied",12100,None),("M-105","occupied",12800,None),("M-106","vacant",11500,45)],
            # Palm Vista — 5 occupied, 1 notice
            [("P-201","occupied",18500,None),("P-202","occupied",19200,None),("P-203","occupied",17800,None),
             ("P-204","occupied",18800,None),("P-205","notice",19500,None),("P-206","occupied",18200,None)],
            # Business Bay — 4 occupied, 1 vacant, 1 notice
            [("B-301","occupied",14200,None),("B-302","occupied",13800,None),("B-303","vacant",13500,20),
             ("B-304","occupied",14500,None),("B-305","notice",15000,None),("B-306","occupied",14100,None)],
            # JBR Coastal — 6 occupied
            [("J-401","occupied",16200,None),("J-402","occupied",15800,None),("J-403","occupied",16500,None),
             ("J-404","occupied",16000,None),("J-405","occupied",15500,None),("J-406","occupied",16800,None)],
        ]

        TENANT_NAMES = [
            ["Layla Al Mansoori","Omar Hassan","Fatima Rahman","James Cooper","Sara Malik"],
            ["Ahmed Farouk","Priya Nair","Daniel Brooks","Meera Kapoor","Hassan Ali","Nina Petrova"],
            ["Ravi Sharma","Emily Chen","Khalid Ibrahim","Sophie Laurent","Marcus Lee"],
            ["Yasmin Okonkwo","Tom Bradley","Aisha Khan","Lucas Fernandez","Olivia Grant","Noah Singh"],
        ]

        OWNERSHIP = [
            [("Gulf Horizon Partners",0.60,"general_partner"),("Emirates Capital LLC",0.40,"limited_partner")],
            [("Gulf Horizon Partners",0.55,"general_partner"),("Marina RE Holdings",0.45,"limited_partner")],
            [("Emirates Capital LLC",0.50,"general_partner"),("Dubai Creek Investors",0.50,"limited_partner")],
            [("Marina RE Holdings",0.65,"general_partner"),("Dubai Creek Investors",0.35,"limited_partner")],
        ]

        EXPENSE_DATA = [
            ("management","management fee",300),
            ("maintenance","plumbing repair",450),
            ("utilities","common area electricity",200),
            ("cam","parking lot cleaning",150),
            ("repairs","AC unit service",380),
            ("insurance","quarterly premium",600),
        ]

        # arrears units — indexes into the flat unit list (company_idx * 6 + unit_idx)
        # (company_idx, unit_idx, overdue_months)
        # overdue_months = how many months back the unpaid invoice is
        # 1 month back (May 2026) => 0-30 days overdue on June 21
        # 2 months back (Apr 2026) => 31-60
        # 3 months back (Mar 2026) => 61-90
        # 5 months back (Jan 2026) => 90+
        ARREARS_UNITS = [
            (0, 0, 1),  # Marina M-101 — May unpaid (0-30)
            (1, 1, 1),  # Palm P-202 — May unpaid (0-30)
            (2, 2, 2),  # Business Bay B-303 — Apr unpaid (31-60)
            (3, 4, 3),  # JBR J-405 — Mar unpaid (61-90)
        ]
        arrears_set = {(co_i, u_i): mo for co_i, u_i, mo in ARREARS_UNITS}

        BILLING_MONTHS = [
            date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1),
            date(2026, 4, 1), date(2026, 5, 1), date(2026, 6, 1),
        ]

        companies_db = []
        for co_idx, (co_name, address, ptype) in enumerate(COMPANIES):
            co = RentalCompany(tenant_id=tid, company_name=co_name, created_by=DEMO_EMAIL)
            db.add(co)
            db.flush()

            prop = RentalProp(
                tenant_id=tid, company_id=co.id,
                property_name=co_name, address=address, property_type=ptype,
            )
            db.add(prop)
            db.flush()

            tenant_names = TENANT_NAMES[co_idx]
            tn_idx = 0

            for unit_idx, (unit_no, status_str, rent, vac_days) in enumerate(UNIT_CONFIGS[co_idx]):
                sc_at = TODAY - timedelta(days=vac_days) if vac_days else None
                unit = RentalUnit(
                    tenant_id=tid,
                    property_id=prop.id,
                    company_id=co.id,
                    unit_number=unit_no,
                    status=RentalUnitStatus(status_str),
                    monthly_rent=rent,
                    status_changed_at=sc_at,
                )
                db.add(unit)
                db.flush()

                if status_str in ("occupied", "notice"):
                    tname = tenant_names[tn_idx] if tn_idx < len(tenant_names) else f"Tenant {co_idx}-{unit_idx}"
                    tn_idx += 1
                    rt = RentalTenant(
                        tenant_id=tid, unit_id=unit.id,
                        tenant_name=tname,
                        tenant_email=f"{tname.lower().replace(' ','.')}{co_idx}@example.com",
                        tenant_phone=f"(555) {100+co_idx:03d}-{1000+unit_idx:04d}",
                        is_current=True,
                    )
                    db.add(rt)
                    db.flush()

                    # lease dates
                    lease_start = date(2024, 7, 1)
                    if status_str == "notice":
                        lease_end = date(2026, 7, 31)  # expiring within 90 days
                        l_status = RentalLeaseStatus.notice_given
                    else:
                        # vary lease ends: some far, 2 expiring in <90 days per group
                        if unit_idx == 0 and co_idx in (2, 7):
                            lease_end = date(2026, 8, 31)  # ~70 days
                            l_status = RentalLeaseStatus.active
                        else:
                            lease_end = date(2027, 6, 30)
                            l_status = RentalLeaseStatus.active

                    lease = RentalLease(
                        tenant_id=tid,
                        unit_id=unit.id,
                        r_tenant_id=rt.id,
                        lease_start=lease_start,
                        lease_end=lease_end,
                        escalation_pct_annual=0.05,
                        deposit_amount=float(rent) * 2,
                        notice_period_days=30,
                        lock_in_end_date=date(2025, 7, 1),
                        status=l_status,
                    )
                    db.add(lease)
                    db.flush()

                    # invoices for 6 months
                    arrears_month = arrears_set.get((co_idx, unit_idx))
                    for bp in BILLING_MONTHS:
                        inv = RentalInvoice(
                            tenant_id=tid,
                            unit_id=unit.id,
                            lease_id=lease.id,
                            billing_period=bp,
                            amount_billed=float(rent),
                        )
                        db.add(inv)
                        db.flush()

                        # Determine if this invoice should have partial/no collection
                        months_back = (TODAY.year - bp.year) * 12 + (TODAY.month - bp.month)
                        if arrears_month and months_back == arrears_month:
                            # partial collection — leave 40% unpaid
                            col = RentalCollection(
                                tenant_id=tid,
                                invoice_id=inv.id,
                                amount_collected=round(float(rent) * 0.60, 2),
                                collected_date=bp + timedelta(days=5),
                            )
                            db.add(col)
                        else:
                            # fully paid
                            col = RentalCollection(
                                tenant_id=tid,
                                invoice_id=inv.id,
                                amount_collected=float(rent),
                                collected_date=bp + timedelta(days=3),
                            )
                            db.add(col)

            # expenses — 6 per company, staggered across months
            months_cycle = [date(2026, 1, 15), date(2026, 2, 15), date(2026, 3, 15),
                            date(2026, 4, 15), date(2026, 5, 15), date(2026, 6, 10)]
            for exp_i, (cat, desc, base_amt) in enumerate(EXPENSE_DATA):
                amt = base_amt + co_idx * 15  # slight variation
                e = RentalExpense(
                    tenant_id=tid,
                    property_id=prop.id,
                    company_id=co.id,
                    expense_date=months_cycle[exp_i],
                    category=RentalExpenseCategory(cat),
                    amount=float(amt),
                    description=desc,
                    created_by=DEMO_EMAIL,
                )
                db.add(e)

            # ownership
            for pname, pct, role_str in OWNERSHIP[co_idx]:
                own = RentalOwnership(
                    tenant_id=tid,
                    company_id=co.id,
                    partner_name=pname,
                    ownership_pct=pct,
                    role=RentalPartnerRole(role_str),
                )
                db.add(own)

            companies_db.append(co)

        db.commit()

        # summary
        total_units = sum(len(cfg) for cfg in UNIT_CONFIGS)
        total_occupied = sum(sum(1 for u in cfg if u[1] in ("occupied", "notice")) for cfg in UNIT_CONFIGS)
        total_vacant = sum(sum(1 for u in cfg if u[1] == "vacant") for cfg in UNIT_CONFIGS)
        print(f"Seeded {len(COMPANIES)} companies, {len(COMPANIES)} properties, {total_units} units ({total_occupied} occupied/notice, {total_vacant} vacant)")
        print(f"  6 months of invoices + collections seeded, {len(ARREARS_UNITS)} units with arrears")
        print(f"  {len(COMPANIES) * len(EXPENSE_DATA)} expense records, {sum(len(o) for o in OWNERSHIP)} ownership records")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
