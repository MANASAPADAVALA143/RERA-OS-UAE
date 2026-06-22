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
            ("Palm Residency",          "123 Palm Ave, Miami FL",       "residential"),
            ("Maple Gardens",           "45 Maple St, Orlando FL",      "residential"),
            ("Sunset Villas",           "88 Sunset Blvd, Tampa FL",     "residential"),
            ("Cedar Heights",           "200 Cedar Rd, Jacksonville FL","residential"),
            ("Oak Park Residences",     "12 Oak Park Dr, Boca Raton FL","residential"),
            ("Willow Creek Apts",       "77 Willow Ln, Sarasota FL",    "residential"),
            ("Heritage Homes",          "5 Heritage Way, Naples FL",    "residential"),
            ("Lakefront Suites",        "300 Lake Shore Dr, Clearwater FL","residential"),
            ("Greenview Flats",         "19 Greenview Ct, Fort Myers FL","residential"),
            ("Riverside Court",         "55 Riverside Rd, Pensacola FL","residential"),
        ]

        # unit configs: (unit_number, status, monthly_rent, status_changed_at_offset_days)
        # Per company — 6 units each
        # occupied = None offset (lease is current)
        # vacant = offset days since vacant
        # notice = ongoing

        UNIT_CONFIGS = [
            # C1 Palm Residency — 5 occupied, 1 vacant
            [("A-101","occupied",2400,None),("A-102","occupied",2250,None),("A-103","occupied",2600,None),
             ("A-104","occupied",2350,None),("A-105","occupied",2500,None),("A-106","vacant",2200,45)],
            # C2 Maple Gardens — 6 occupied
            [("B-101","occupied",2300,None),("B-102","occupied",2450,None),("B-103","occupied",2150,None),
             ("B-104","occupied",2550,None),("B-105","occupied",2400,None),("B-106","occupied",2250,None)],
            # C3 Sunset Villas — 4 occupied, 1 vacant, 1 notice
            [("C-101","occupied",2700,None),("C-102","occupied",2600,None),("C-103","vacant",2500,20),
             ("C-104","occupied",2650,None),("C-105","notice",2800,None),("C-106","occupied",2750,None)],
            # C4 Cedar Heights — 5 occupied, 1 notice
            [("D-101","occupied",2200,None),("D-102","occupied",2350,None),("D-103","occupied",2100,None),
             ("D-104","notice",2400,None),("D-105","occupied",2300,None),("D-106","occupied",2250,None)],
            # C5 Oak Park — 6 occupied
            [("E-101","occupied",2600,None),("E-102","occupied",2550,None),("E-103","occupied",2700,None),
             ("E-104","occupied",2650,None),("E-105","occupied",2500,None),("E-106","occupied",2750,None)],
            # C6 Willow Creek — 4 occupied, 1 vacant, 1 notice
            [("F-101","occupied",2450,None),("F-102","vacant",2300,30),("F-103","occupied",2400,None),
             ("F-104","occupied",2350,None),("F-105","notice",2500,None),("F-106","occupied",2450,None)],
            # C7 Heritage Homes — 5 occupied, 1 vacant
            [("G-101","occupied",2800,None),("G-102","occupied",2750,None),("G-103","vacant",2600,15),
             ("G-104","occupied",2700,None),("G-105","occupied",2650,None),("G-106","occupied",2800,None)],
            # C8 Lakefront Suites — 6 occupied
            [("H-101","occupied",2500,None),("H-102","occupied",2600,None),("H-103","occupied",2450,None),
             ("H-104","occupied",2550,None),("H-105","occupied",2400,None),("H-106","occupied",2500,None)],
            # C9 Greenview Flats — 4 occupied, 1 vacant, 1 notice
            [("I-101","occupied",2150,None),("I-102","occupied",2200,None),("I-103","vacant",2100,60),
             ("I-104","notice",2250,None),("I-105","occupied",2300,None),("I-106","occupied",2200,None)],
            # C10 Riverside Court — 5 occupied, 1 notice
            [("J-101","occupied",2350,None),("J-102","occupied",2400,None),("J-103","occupied",2300,None),
             ("J-104","occupied",2450,None),("J-105","notice",2500,None),("J-106","occupied",2350,None)],
        ]

        TENANT_NAMES = [
            ["Alice Johnson","Bob Martinez","Carol Lee","David Kim","Eve Patel"],
            ["Frank Chen","Grace Osei","Henry Walsh","Ivy Sharma","Jack Brown","Karen Liu"],
            ["Liam Torres","Mia Nguyen","Noah Davis","Olivia Taylor","Paul Robinson"],
            ["Quinn Smith","Rachel Green","Sam White","Tina Adams","Uma Scott","Victor Reed"],
            ["Wendy Hill","Xander Barnes","Yara Flores","Zoe Morris","Aaron King","Beth Clark"],
            ["Carlos Diaz","Diana Singh","Ethan Ross","Fiona Burke","Gina Parks"],
            ["Hugo Grant","Iris Fox","Jason Cole","Kelly Stone","Leo Chan","Maya Patel"],
            ["Nina Walsh","Omar Jafri","Priya Mehta","Raj Kumar","Sara Lim","Tom Evans"],
            ["Uma Rajan","Vijay Nair","Wanda Cruz","Xavier Hunt","Yuna Park"],
            ["Zara Ahmed","Aryan Shah","Bela Kapoor","Chris Wong","Dana Miller"],
        ]

        OWNERSHIP = [
            [("Arun Mehta",0.60,"general_partner"),("Priya Shah",0.40,"limited_partner")],
            [("Arun Mehta",0.50,"general_partner"),("Ravi Kumar",0.50,"limited_partner")],
            [("Priya Shah",0.70,"general_partner"),("Ravi Kumar",0.30,"limited_partner")],
            [("Arun Mehta",0.40,"general_partner"),("Priya Shah",0.30,"limited_partner"),("Ravi Kumar",0.30,"limited_partner")],
            [("Priya Shah",0.40,"limited_partner"),("Vikram Singh",0.60,"general_partner")],
            [("Ravi Kumar",0.50,"general_partner"),("Vikram Singh",0.50,"limited_partner")],
            [("Arun Mehta",0.50,"limited_partner"),("Vikram Singh",0.50,"general_partner")],
            [("Ravi Kumar",0.60,"general_partner"),("Vikram Singh",0.40,"limited_partner")],
            [("Arun Mehta",0.45,"limited_partner"),("Priya Shah",0.55,"general_partner")],
            [("Ravi Kumar",0.65,"general_partner"),("Vikram Singh",0.35,"limited_partner")],
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
            (0, 0, 1),  # Palm A-101 — May unpaid (0-30)
            (1, 1, 1),  # Maple B-102 — May unpaid (0-30)
            (3, 2, 1),  # Cedar D-103 — May unpaid (0-30)
            (4, 0, 2),  # Oak E-101 — Apr unpaid (31-60)
            (5, 3, 2),  # Willow F-104 — Apr unpaid (31-60)
            (6, 1, 3),  # Heritage G-102 — Mar unpaid (61-90)
            (7, 4, 3),  # Lakefront H-105 — Mar unpaid (61-90)
            (9, 0, 5),  # Riverside J-101 — Jan unpaid (90+)
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
        print(f"Seeded 10 companies, 10 properties, {total_units} units ({total_occupied} occupied/notice, {total_vacant} vacant)")
        print(f"  6 months of invoices + collections seeded, {len(ARREARS_UNITS)} units with arrears")
        print(f"  60 expense records, 21 ownership records (4 partners across 10 companies)")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
