"""
Seed sample Pay Applications and Expenses for existing demo projects.
Run from backend/:  python scripts/seed_pay_apps_expenses.py

Idempotent — skips if data already exists for those projects.
"""
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Import all models so SQLAlchemy can resolve forward-reference relationships
import models.tenancy  # noqa: F401
import models.audit_log  # noqa: F401
import models.real_estate.entity  # noqa: F401
import models.real_estate.permitting  # noqa: F401
import models.real_estate.construction_cost  # noqa: F401
import models.real_estate.construction_extended  # noqa: F401
import models.real_estate.work_log  # noqa: F401
import models.real_estate.quality_check  # noqa: F401
import models.real_estate.inspection  # noqa: F401
import models.real_estate.daily_progress_photo  # noqa: F401
import models.real_estate.unit  # noqa: F401
import models.real_estate.financing  # noqa: F401
import models.real_estate.reit_rental  # noqa: F401
import models.real_estate.pipeline  # noqa: F401
import models.real_estate.risk  # noqa: F401
import models.real_estate.pay_application  # noqa: F401
import models.real_estate.expense  # noqa: F401
import models.reit.property  # noqa: F401
import models.reit.unit  # noqa: F401
import models.reit.financials  # noqa: F401

from database import SessionLocal
from models.real_estate.entity import Project
from models.real_estate.expense import ExpenseCategory, PaymentMode, ProjectExpense
from models.real_estate.pay_application import PayAppStatus, PayApplication
from models.tenancy import Tenant, TenantUser
from services.local_auth import DEMO_EMAIL


def _compute(prev, curr, stored, ret_pct, prev_pmts):
    total = prev + curr + stored
    ret = round(total * ret_pct, 2)
    less = round(total - ret, 2)
    return {
        "total_completed_stored": round(total, 2),
        "retainage_amount": ret,
        "total_less_retainage": less,
        "current_payment_due": round(less - prev_pmts, 2),
    }


def seed():
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            print("ERROR: Demo tenant not found. Start the app once so it auto-seeds, then run this script.")
            sys.exit(1)

        tid = user.tenant_id
        projects = db.query(Project).filter(Project.tenant_id == tid).order_by(Project.project_name).all()
        if not projects:
            print("ERROR: No projects found for demo tenant.")
            sys.exit(1)

        # Use first two projects
        proj1 = next((p for p in projects if "Eastside" in p.project_name), projects[0])
        proj2 = next((p for p in projects if "Riverfront" in p.project_name or len(projects) > 1 and p.id != proj1.id), proj1)

        # Skip if already seeded
        existing = db.query(PayApplication).filter(PayApplication.tenant_id == tid, PayApplication.project_id == proj1.id).count()
        if existing:
            print(f"Pay applications already seeded ({existing} found). Skipping.")
        else:
            _seed_pay_apps(db, tid, proj1, proj2)

        existing_exp = db.query(ProjectExpense).filter(ProjectExpense.tenant_id == tid, ProjectExpense.project_id == proj1.id).count()
        if existing_exp:
            print(f"Expenses already seeded ({existing_exp} found). Skipping.")
        else:
            _seed_expenses(db, tid, proj1, proj2)

        db.commit()
        print("\nSeed complete.")

        pa_count = db.query(PayApplication).filter(PayApplication.tenant_id == tid).count()
        exp_count = db.query(ProjectExpense).filter(ProjectExpense.tenant_id == tid).count()
        print(f"  pay_applications: {pa_count}")
        print(f"  project_expenses: {exp_count}")

    finally:
        db.close()


def _seed_pay_apps(db, tid, proj1, proj2):
    print(f"Seeding pay applications for {proj1.project_name} and {proj2.project_name}...")

    subcontractors = [
        ("Apex Concrete & Foundation LLC",   950_000),
        ("Ironclad Structural Steel Co.",    1_250_000),
        ("BlueSky MEP Systems Inc.",         2_100_000),
        ("Summit Framing & Carpentry",        875_000),
        ("ProFinish Drywall & Painting",      540_000),
        ("Premier Roofing Systems",           480_000),
        ("ClearView Glass & Glazing",         310_000),
        ("EverGreen Landscaping & Civil",     275_000),
    ]

    apps = [
        # (subcontractor_idx, app_no, period_start, period_end, prev_pct, curr_pct, stored, ret_pct, prev_pmts_pct, status)
        # Eastside Lofts — proj1
        (0, "001", date(2024,  4,  1), date(2024,  4, 30),    0,   180_000,  12_000, 0.10,       0, PayAppStatus.paid,      proj1),
        (0, "002", date(2024,  5,  1), date(2024,  5, 31),  180_000, 210_000,   8_000, 0.10,  192_000, PayAppStatus.paid,      proj1),
        (0, "003", date(2024,  6,  1), date(2024,  6, 30),  390_000, 220_000,   5_000, 0.10,  354_000, PayAppStatus.approved,  proj1),
        (1, "001", date(2024,  6,  1), date(2024,  6, 30),       0,  380_000,  45_000, 0.10,       0, PayAppStatus.paid,      proj1),
        (1, "002", date(2024,  7,  1), date(2024,  7, 31),  380_000, 420_000,  20_000, 0.10,  378_000, PayAppStatus.approved,  proj1),
        (2, "001", date(2024,  8,  1), date(2024,  8, 31),       0,  320_000,   0,     0.10,       0, PayAppStatus.submitted,  proj1),
        (3, "001", date(2024,  9,  1), date(2024,  9, 30),       0,  210_000,  18_000, 0.10,       0, PayAppStatus.submitted,  proj1),
        (4, "001", date(2024, 10,  1), date(2024, 10, 31),       0,  125_000,   0,     0.10,       0, PayAppStatus.draft,      proj1),
        # Riverfront Residences — proj2
        (0, "001", date(2023,  3,  1), date(2023,  3, 31),       0,  190_000,  14_000, 0.10,       0, PayAppStatus.paid,      proj2),
        (0, "002", date(2023,  4,  1), date(2023,  4, 30),  190_000, 200_000,   0,     0.10,  183_600, PayAppStatus.paid,      proj2),
        (1, "001", date(2023,  5,  1), date(2023,  5, 31),       0,  460_000,  55_000, 0.10,       0, PayAppStatus.paid,      proj2),
        (2, "001", date(2023,  7,  1), date(2023,  7, 31),       0,  490_000,   0,     0.10,       0, PayAppStatus.paid,      proj2),
        (5, "001", date(2023,  9,  1), date(2023,  9, 30),       0,  480_000,   0,     0.10,       0, PayAppStatus.approved,  proj2),
        (6, "001", date(2023, 11,  1), date(2023, 11, 30),       0,  310_000,   0,     0.10,       0, PayAppStatus.paid,      proj2),
        (7, "001", date(2024,  1,  1), date(2024,  1, 31),       0,  275_000,   8_000, 0.10,       0, PayAppStatus.rejected,  proj2),
        (7, "002", date(2024,  2,  1), date(2024,  2, 29),       0,  275_000,   8_000, 0.10,       0, PayAppStatus.approved,  proj2),
    ]

    for sub_idx, app_no, ps, pe, prev, curr, stored, ret, prev_pmts, status, proj in apps:
        name, sched = subcontractors[sub_idx]
        comp = _compute(prev, curr, stored, ret, prev_pmts)
        db.add(PayApplication(
            tenant_id=tid,
            project_id=proj.id,
            pay_app_number=app_no,
            subcontractor_name=name,
            period_start=ps,
            period_end=pe,
            scheduled_value=sched,
            prev_completed=prev,
            curr_completed=curr,
            stored_materials=stored,
            retainage_pct=ret,
            previous_payments=prev_pmts,
            status=status,
            submitted_date=pe + timedelta(days=5) if status != PayAppStatus.draft else None,
            approved_date=pe + timedelta(days=15) if status in (PayAppStatus.approved, PayAppStatus.paid) else None,
            notes=None,
            created_by="demo@estatecfo.com",
            **comp,
        ))
    print(f"  Added {len(apps)} pay applications.")


def _seed_expenses(db, tid, proj1, proj2):
    print(f"Seeding expenses for {proj1.project_name} and {proj2.project_name}...")

    rows = [
        # (project, expense_date, category, division, subdivision, line_item, expense_type, amount, payable_to, mode, description)
        (proj1, date(2024, 4,  5), ExpenseCategory.expense,          "General Conditions",      "Temporary Site Facilities", "Field Office - Utilities",  "Utilities",    2_840.00,  "Austin Energy",            PaymentMode.ach,         "Monthly electricity for site trailer & field office"),
        (proj1, date(2024, 4, 10), ExpenseCategory.expense,          "General Conditions",      "Temporary Site Facilities", "Portable Toilets",          "Rental",         785.00,  "Lone Star Sanitation Co.", PaymentMode.check,       "Portable restroom rental — April"),
        (proj1, date(2024, 4, 15), ExpenseCategory.expense,          "Sitework & Demolition",   "Earthwork",                 "Topsoil Import",            "Materials",    18_500.00, "Texas Dirt & Gravel LLC",  PaymentMode.check,       "Import 120 CY topsoil for grading per plan"),
        (proj1, date(2024, 5,  2), ExpenseCategory.expense,          "Concrete",                "Cast-in-Place Concrete",    "Pump Truck Rental",         "Rental",        3_200.00, "Southwest Concrete Pumps", PaymentMode.ach,         "Pump truck rental for Level 2 deck pour"),
        (proj1, date(2024, 5, 12), ExpenseCategory.expense,          "Concrete",                "Cast-in-Place Concrete",    "Form Lumber",               "Materials",     7_650.00, "Home Depot Pro",           PaymentMode.credit_card, "2x10 lumber & plywood for slab formwork"),
        (proj1, date(2024, 5, 20), ExpenseCategory.refund,           "General Conditions",      "Temporary Site Facilities", "Field Office - Utilities",  "Utilities",      420.00,  "Austin Energy",            PaymentMode.ach,         "Utility deposit refund — project account"),
        (proj1, date(2024, 6,  1), ExpenseCategory.recurring_expense,"General Conditions",      "Project Insurance",         "Builder's Risk Premium",    "Insurance",    4_125.00,  "Zurich Insurance",         PaymentMode.wire,        "Monthly builder's risk insurance — June 2024"),
        (proj1, date(2024, 6,  8), ExpenseCategory.expense,          "Masonry",                 "Unit Masonry",              "Brick Materials",           "Materials",    22_400.00, "Texas Masonry Supply",     PaymentMode.check,       "Modular brick delivery — Phase 1 exterior"),
        (proj1, date(2024, 6, 18), ExpenseCategory.expense,          "Structural Steel",        "Structural Steel Framing",  "Steel Erection Labor",      "Labor",        31_500.00, "Ironclad Structural Steel Co.", PaymentMode.wire,   "Extra labor — accelerated schedule per CO #3"),
        (proj1, date(2024, 7,  3), ExpenseCategory.expense,          "General Conditions",      "Project Management",        "Architect Site Visit",      "Professional", 1_850.00,  "Dwell Architecture PLLC",  PaymentMode.ach,         "RFI site visit — Level 3 stair layout"),
        (proj1, date(2024, 7, 15), ExpenseCategory.recurring_expense,"General Conditions",      "Project Insurance",         "Builder's Risk Premium",    "Insurance",    4_125.00,  "Zurich Insurance",         PaymentMode.wire,        "Monthly builder's risk insurance — July 2024"),
        (proj1, date(2024, 8,  2), ExpenseCategory.expense,          "Thermal & Moisture",      "Insulation",                "Spray Foam Insulation",     "Materials",    14_900.00, "Foam Masters LLC",         PaymentMode.check,       "Open-cell spray foam — exterior stud walls"),
        (proj1, date(2024, 8, 20), ExpenseCategory.expense,          "Mechanical",              "HVAC Systems",              "Ductwork Materials",        "Materials",    19_350.00, "BlueSky MEP Systems Inc.", PaymentMode.ach,         "Flex duct & grilles — Floors 2-4"),
        (proj1, date(2024, 9, 10), ExpenseCategory.expense,          "Electrical",              "Electrical Systems",        "Panel Upgrade Fee",         "Utilities",     3_500.00, "Austin Energy",            PaymentMode.wire,        "Utility upgrade fee — 400A service entrance"),
        (proj2, date(2023, 3, 10), ExpenseCategory.expense,          "General Conditions",      "Temporary Site Facilities", "Field Office - Utilities",  "Utilities",    1_960.00,  "Oncor Electric",           PaymentMode.ach,         "Site trailer electricity — March"),
        (proj2, date(2023, 3, 22), ExpenseCategory.expense,          "Sitework & Demolition",   "Site Clearing",             "Tree Removal",              "Labor",        8_200.00,  "Precision Tree Service",   PaymentMode.check,       "Remove 14 protected trees per approved plan"),
        (proj2, date(2023, 4,  5), ExpenseCategory.expense,          "Concrete",                "Cast-in-Place Concrete",    "Ready-Mix Concrete",        "Materials",   28_400.00,  "Texas Ready Mix Inc.",     PaymentMode.wire,        "Pool & driveway pads — 185 CY"),
        (proj2, date(2023, 4, 18), ExpenseCategory.recurring_expense,"General Conditions",      "Project Insurance",         "Builder's Risk Premium",    "Insurance",    3_875.00,  "Nationwide Insurance",     PaymentMode.wire,        "Monthly builder's risk insurance — April 2023"),
        (proj2, date(2023, 5,  2), ExpenseCategory.expense,          "Structural Steel",        "Structural Steel Framing",  "Structural Drawings Rev",   "Professional", 2_400.00,  "LMK Engineering PLLC",    PaymentMode.ach,         "Structural drawing revision for cantilevered balcony"),
        (proj2, date(2023, 6, 15), ExpenseCategory.expense,          "Masonry",                 "Unit Masonry",              "Stone Veneer Materials",    "Materials",   16_800.00,  "Hill Country Stone LLC",   PaymentMode.check,       "Limestone veneer — building facades A & B"),
        (proj2, date(2023, 8, 20), ExpenseCategory.expense,          "Thermal & Moisture",      "Waterproofing",             "Below-Grade Waterproofing", "Materials",    9_750.00,  "Tremco Sealants",          PaymentMode.ach,         "Waterproofing membrane — below-grade parking"),
        (proj2, date(2023, 9,  5), ExpenseCategory.refund,           "General Conditions",      "Temporary Site Facilities", "Dumpster Deposit",          "Deposit",       750.00,   "Dallas Waste Solutions",   PaymentMode.check,       "Dumpster deposit refund — project closeout"),
        (proj2, date(2023,10, 12), ExpenseCategory.expense,          "Finishes",                "Interior Finishes",         "Tile & Flooring Materials", "Materials",   41_200.00,  "Daltile Distribution",     PaymentMode.wire,        "Porcelain tile — all 32 unit bathrooms & kitchens"),
        (proj2, date(2023,11, 30), ExpenseCategory.expense,          "General Conditions",      "Project Management",        "Final Inspection Fee",      "Professional", 1_200.00,  "City of Dallas",           PaymentMode.check,       "Certificate of Occupancy inspection fee"),
    ]

    for proj, exp_date, cat, div, subdiv, li, etype, amt, payable, mode, desc in rows:
        db.add(ProjectExpense(
            tenant_id=tid,
            project_id=proj.id,
            expense_date=exp_date,
            category=cat,
            division=div,
            subdivision=subdiv,
            line_item=li,
            expense_type=etype,
            amount=amt,
            payable_to=payable,
            mode_of_payment=mode,
            description=desc,
            currency="USD",
            created_by="demo@estatecfo.com",
        ))
    print(f"  Added {len(rows)} expense entries.")


if __name__ == "__main__":
    seed()
