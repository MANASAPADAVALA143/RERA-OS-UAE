"""Seed Rentals Maintenance + Unit Inspection demo data.
Run from backend/: python scripts/seed_maintenance.py
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
import models.rentals.maintenance  # noqa
import models.rentals.unit_inspection  # noqa

from database import Base, SessionLocal, engine
from models.rentals.maintenance import (
    MaintenanceCategory, MaintenancePriority, MaintenanceRequest, MaintenanceStatus,
)
from models.rentals.unit_inspection import (
    ChecklistCondition, UnitConditionScore, UnitInspection,
    UnitInspectionChecklistItem, UnitInspectionType,
)
from models.rentals.models import RentalCompany, RentalUnit
from models.tenancy import TenantUser
from services.local_auth import DEMO_EMAIL

Base.metadata.create_all(bind=engine)

TODAY = date(2026, 6, 21)

DEFAULT_CHECKLIST = [
    "Walls & Paint",
    "Flooring",
    "Ceiling",
    "Windows & Blinds",
    "Kitchen Appliances",
    "Plumbing Fixtures",
    "Bathroom",
    "Electrical Outlets",
    "HVAC / AC Unit",
    "Doors & Locks",
]


def seed():
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            print("ERROR: Demo user not found.")
            sys.exit(1)

        tid = user.tenant_id

        if db.query(MaintenanceRequest).filter(MaintenanceRequest.tenant_id == tid).count():
            print("Maintenance already seeded. Skipping.")
            return

        units = db.query(RentalUnit).filter(RentalUnit.tenant_id == tid).all()
        if not units:
            print("ERROR: No rental units found. Run seed_rentals.py first.")
            sys.exit(1)

        # Pick specific units for interesting data
        # Use first 12 units for maintenance requests
        maint_units = units[:12]

        MAINT_DATA = [
            # (unit_idx, title, category, priority, status, days_ago_reported, vendor, cost, completed_days_ago)
            (0,  "Water leak under kitchen sink",    "plumbing",    "high",      "completed", 25, "AquaFix Plumbing",     380.0, 22),
            (0,  "Kitchen faucet dripping again",    "plumbing",    "medium",    "open",       3, None,                   None,  None),   # REPEAT ISSUE same unit+category
            (1,  "AC not cooling — unit running hot","hvac",        "emergency", "completed", 18, "CoolAir HVAC",         640.0, 16),
            (2,  "Bedroom ceiling light flickering", "electrical",  "medium",    "in_progress",7, "Bright Spark Electric",None,  None),
            (3,  "Dishwasher not draining",          "appliance",   "medium",    "open",       5, None,                   None,  None),
            (4,  "Pest sighting — cockroaches",      "pest_control","high",      "assigned",   2, "BugBusters Pest Ctrl", None,  None),
            (5,  "Window seal broken — drafty",      "structural",  "low",       "open",      10, None,                   None,  None),
            (6,  "Bathroom exhaust fan not working", "general",     "low",       "completed", 30, "HandyPro Services",    120.0, 27),
            (7,  "AC thermostat unresponsive",       "hvac",        "high",      "open",       1, None,                   None,  None),   # HIGH priority 1 day old = at_risk
            (8,  "Oven burner not igniting",         "appliance",   "medium",    "in_progress",4, "AppliancePro",         None,  None),
            (9,  "Water pressure very low",          "plumbing",    "medium",    "assigned",   6, "AquaFix Plumbing",     None,  None),
            (10, "Mold spotted in bathroom corner",  "structural",  "high",      "open",       8, None,                   None,  None),
            (11, "Front door lock stiff",            "general",     "low",       "completed", 45, "HandyPro Services",    85.0,  42),
            # Emergency overdue example — high priority open > 3 days
            (3,  "Main breaker tripping repeatedly", "electrical",  "high",      "open",       8, None,                   None,  None),  # OVERDUE
        ]

        for idx, (ui, title, cat, pri, sta, days_ago, vendor, cost, comp_days_ago) in enumerate(MAINT_DATA):
            if ui >= len(maint_units):
                continue
            unit = maint_units[ui]
            reported = TODAY - timedelta(days=days_ago)
            completed = (TODAY - timedelta(days=comp_days_ago)) if comp_days_ago else None

            req = MaintenanceRequest(
                tenant_id=tid,
                unit_id=unit.id,
                property_id=unit.property_id,
                title=title,
                category=MaintenanceCategory(cat),
                priority=MaintenancePriority(pri),
                status=MaintenanceStatus(sta),
                reported_by="Property Manager" if idx % 3 else "Tenant",
                reported_date=reported,
                vendor_name=vendor,
                target_completion_date=reported + timedelta(days={"emergency":1,"high":3,"medium":7,"low":14}[pri]),
                actual_completion_date=completed,
                cost=cost,
                created_by=DEMO_EMAIL,
            )
            db.add(req)

        db.flush()

        # Unit inspections — move-in + move-out for 3 units, periodic for 2 more
        insp_units = units[:5]

        # Move-in inspection (excellent condition) for unit 0
        lease = insp_units[0].leases[0] if insp_units[0].leases else None
        mi = UnitInspection(
            tenant_id=tid,
            unit_id=insp_units[0].id,
            lease_id=lease.id if lease else None,
            inspection_type=UnitInspectionType.move_in,
            inspection_date=date(2024, 7, 1),
            performed_by="Property Manager",
            condition_score=UnitConditionScore.excellent,
            notes="Unit in pristine condition. All appliances functioning. Fresh paint.",
            created_by=DEMO_EMAIL,
        )
        db.add(mi)
        db.flush()
        for item in DEFAULT_CHECKLIST:
            db.add(UnitInspectionChecklistItem(
                tenant_id=tid, inspection_id=mi.id,
                item_name=item, condition=ChecklistCondition.ok,
            ))

        # Move-out inspection (fair condition) for same unit + lease
        mo = UnitInspection(
            tenant_id=tid,
            unit_id=insp_units[0].id,
            lease_id=lease.id if lease else None,
            inspection_type=UnitInspectionType.move_out,
            inspection_date=date(2026, 6, 15),
            performed_by="Property Manager",
            condition_score=UnitConditionScore.fair,
            notes="Minor scuffs on living room wall. Carpet stain in bedroom. Appliances OK.",
            created_by=DEMO_EMAIL,
        )
        db.add(mo)
        db.flush()
        checklist_conds = [
            ChecklistCondition.damaged,  # Walls
            ChecklistCondition.needs_cleaning,  # Flooring
            ChecklistCondition.ok,
            ChecklistCondition.ok,
            ChecklistCondition.ok,
            ChecklistCondition.ok,
            ChecklistCondition.needs_cleaning,  # Bathroom
            ChecklistCondition.ok,
            ChecklistCondition.ok,
            ChecklistCondition.ok,
        ]
        for item, cond in zip(DEFAULT_CHECKLIST, checklist_conds):
            note = "Scuff marks visible" if cond == ChecklistCondition.damaged else None
            db.add(UnitInspectionChecklistItem(
                tenant_id=tid, inspection_id=mo.id,
                item_name=item, condition=cond, notes=note,
            ))

        # Move-in for unit 1 (good condition)
        lease1 = insp_units[1].leases[0] if insp_units[1].leases else None
        mi2 = UnitInspection(
            tenant_id=tid,
            unit_id=insp_units[1].id,
            lease_id=lease1.id if lease1 else None,
            inspection_type=UnitInspectionType.move_in,
            inspection_date=date(2024, 7, 1),
            performed_by="Sarah Collins",
            condition_score=UnitConditionScore.good,
            notes="Unit in good shape. Minor wear on kitchen cabinet doors.",
            created_by=DEMO_EMAIL,
        )
        db.add(mi2)
        db.flush()
        for item in DEFAULT_CHECKLIST:
            cond = ChecklistCondition.damaged if item == "Kitchen Appliances" else ChecklistCondition.ok
            db.add(UnitInspectionChecklistItem(
                tenant_id=tid, inspection_id=mi2.id,
                item_name=item, condition=cond,
                notes="Cabinet door hinge loose" if cond == ChecklistCondition.damaged else None,
            ))

        # Periodic inspection for unit 2
        pi = UnitInspection(
            tenant_id=tid,
            unit_id=insp_units[2].id,
            lease_id=None,
            inspection_type=UnitInspectionType.periodic,
            inspection_date=date(2026, 3, 15),
            performed_by="Property Manager",
            condition_score=UnitConditionScore.good,
            notes="Routine 6-month check. All systems OK. AC filter replaced.",
            created_by=DEMO_EMAIL,
        )
        db.add(pi)
        db.flush()
        for item in DEFAULT_CHECKLIST:
            db.add(UnitInspectionChecklistItem(
                tenant_id=tid, inspection_id=pi.id,
                item_name=item, condition=ChecklistCondition.ok,
            ))

        # Needs-repair inspection for unit 3
        nr = UnitInspection(
            tenant_id=tid,
            unit_id=insp_units[3].id,
            lease_id=None,
            inspection_type=UnitInspectionType.periodic,
            inspection_date=date(2026, 5, 1),
            performed_by="Sarah Collins",
            condition_score=UnitConditionScore.needs_repair,
            notes="Bathroom grout cracking. Bedroom window latch broken. Needs attention.",
            created_by=DEMO_EMAIL,
        )
        db.add(nr)
        db.flush()
        needs_repair_conds = {
            "Bathroom": ChecklistCondition.damaged,
            "Windows & Blinds": ChecklistCondition.damaged,
            "Plumbing Fixtures": ChecklistCondition.needs_cleaning,
        }
        for item in DEFAULT_CHECKLIST:
            cond = needs_repair_conds.get(item, ChecklistCondition.ok)
            db.add(UnitInspectionChecklistItem(
                tenant_id=tid, inspection_id=nr.id,
                item_name=item, condition=cond,
            ))

        db.commit()
        print(f"Seeded {len(MAINT_DATA)} maintenance requests (incl. 1 repeat issue on unit 0, 1 overdue high-priority)")
        print(f"Seeded 4 unit inspections (move-in, move-out, 2x periodic) with full checklists")
        print(f"NOTE: Unit 0 has both move-in (2024-07-01, excellent) and move-out (2026-06-15, fair) — comparison available")

    finally:
        db.close()


if __name__ == "__main__":
    seed()
