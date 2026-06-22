"""
Seed Task Schedule demo data for existing demo projects.
Run from backend/:  python scripts/seed_task_schedule.py
Idempotent — skips if division column already seeded.
"""
import sys
import uuid
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
import models.reit.property  # noqa
import models.reit.unit  # noqa
import models.reit.financials  # noqa

from database import SessionLocal
from models.real_estate.construction_extended import ScheduleTask, ScheduleTaskStatus
from models.real_estate.entity import Project
from models.tenancy import TenantUser
from services.local_auth import DEMO_EMAIL


def seed():
    db = SessionLocal()
    try:
        user = db.query(TenantUser).filter(TenantUser.email == DEMO_EMAIL).first()
        if not user:
            print("ERROR: Demo user not found.")
            sys.exit(1)

        tid = user.tenant_id
        projects = db.query(Project).filter(Project.tenant_id == tid).order_by(Project.project_name).all()
        proj1 = next((p for p in projects if "Eastside" in p.project_name), projects[0])
        proj2 = next((p for p in projects if "Riverfront" in p.project_name and p.id != proj1.id), proj1)

        # Check if already seeded with division data
        already = db.query(ScheduleTask).filter(
            ScheduleTask.tenant_id == tid,
            ScheduleTask.project_id == proj1.id,
            ScheduleTask.division.isnot(None),
        ).count()
        if already:
            print(f"Task schedule division data already seeded ({already} rows). Skipping.")
            return

        # Update any existing tasks with division info; then add detailed new ones
        existing = db.query(ScheduleTask).filter(
            ScheduleTask.tenant_id == tid,
            ScheduleTask.project_id == proj1.id,
        ).all()
        for t in existing:
            t.division = "General Conditions"
            t.line_item_name = t.task_name
        db.flush()

        # ── Eastside Lofts detailed task schedule ───────────────────────────
        tasks_p1 = [
            # (division, code, name, vendor, ps, pe, as_, ae, pct, status, is_crit)
            ("General Conditions",   "1.10.1",  "Mobilization & Site Setup",        "Lone Star GC",           date(2024,3,1),  date(2024,3,15), date(2024,3,1),  date(2024,3,14), 1.0,  "complete",    False),
            ("General Conditions",   "1.10.2",  "Temporary Fencing & Signage",      "Lone Star GC",           date(2024,3,1),  date(2024,3,10), date(2024,3,1),  date(2024,3,9),  1.0,  "complete",    False),
            ("General Conditions",   "1.40.1",  "Owner / Architect Meetings",       "Dwell Architecture",     date(2024,3,1),  date(2026,6,30), date(2024,3,1),  None,            0.75, "in_progress", False),
            ("Sitework & Demolition","2.10.1",  "Site Clearing & Grubbing",         "Texas Earth Moving LLC", date(2024,3,10), date(2024,3,25), date(2024,3,10), date(2024,3,24), 1.0,  "complete",    True),
            ("Sitework & Demolition","2.10.2",  "Mass Excavation",                  "Texas Earth Moving LLC", date(2024,3,25), date(2024,4,15), date(2024,3,26), date(2024,4,17), 1.0,  "complete",    True),
            ("Sitework & Demolition","2.10.3",  "Utility Trenching & Rough Grading","Texas Earth Moving LLC", date(2024,4,15), date(2024,4,30), date(2024,4,16), date(2024,5,3),  1.0,  "complete",    True),
            ("Concrete",             "3.10.1",  "Form & Pour Foundation Mat Slab",  "Apex Concrete",          date(2024,5,1),  date(2024,5,20), date(2024,5,2),  date(2024,5,22), 1.0,  "complete",    True),
            ("Concrete",             "3.10.2",  "Perimeter Grade Beams",            "Apex Concrete",          date(2024,5,20), date(2024,6,5),  date(2024,5,21), date(2024,6,7),  1.0,  "complete",    True),
            ("Concrete",             "3.10.3",  "Level 1 Elevated Slab",            "Apex Concrete",          date(2024,6,10), date(2024,7,5),  date(2024,6,12), date(2024,7,9),  1.0,  "complete",    True),
            ("Concrete",             "3.10.4",  "Level 2 Elevated Slab",            "Apex Concrete",          date(2024,7,10), date(2024,8,5),  date(2024,7,12), date(2024,8,8),  1.0,  "complete",    True),
            ("Concrete",             "3.10.5",  "Level 3 Elevated Slab",            "Apex Concrete",          date(2024,8,10), date(2024,9,5),  date(2024,8,11), None,            0.90, "in_progress", True),
            ("Structural Steel",     "5.10.1",  "Steel Erection — Frame Floors 1-2","Ironclad Structural",    date(2024,7,1),  date(2024,8,15), date(2024,7,2),  date(2024,8,16), 1.0,  "complete",    True),
            ("Structural Steel",     "5.10.2",  "Steel Erection — Frame Floors 3-4","Ironclad Structural",    date(2024,8,20), date(2024,10,1), date(2024,8,22), None,            0.65, "in_progress", True),
            ("Structural Steel",     "5.13.5",  "Erection of All Steel Members / Materials","Ironclad Structural",date(2024,9,15), date(2024,11,1), None,            None,            0.0,  "not_started", True),
            ("Masonry",              "4.10.1",  "CMU Foundation Walls",             "Austin Masonry Co.",     date(2024,5,15), date(2024,6,10), date(2024,5,16), date(2024,6,12), 1.0,  "complete",    False),
            ("Masonry",              "4.10.2",  "Brick Veneer — Exterior Elevations","Austin Masonry Co.",    date(2024,9,1),  date(2024,11,15),None,            None,            0.0,  "not_started", False),
            ("Thermal & Moisture",   "7.10.1",  "Below-Grade Waterproofing",        "Tremco Systems",         date(2024,5,25), date(2024,6,15), date(2024,5,26), date(2024,6,16), 1.0,  "complete",    False),
            ("Thermal & Moisture",   "7.10.2",  "Spray Foam Insulation — Exterior", "Foam Masters LLC",       date(2024,10,1), date(2024,11,1), None,            None,            0.0,  "not_started", False),
            ("Mechanical",           "15.10.1", "Rough-In HVAC Ductwork — L1-L2",  "BlueSky MEP",            date(2024,8,1),  date(2024,9,15), date(2024,8,5),  date(2024,9,20), 1.0,  "complete",    False),
            ("Mechanical",           "15.10.2", "Rough-In HVAC Ductwork — L3-L4",  "BlueSky MEP",            date(2024,9,20), date(2024,11,15),date(2024,9,22), None,            0.40, "in_progress", False),
            ("Electrical",           "16.10.1", "Underground Conduit & Service Entrance","BlueSky MEP",       date(2024,4,20), date(2024,5,15), date(2024,4,21), date(2024,5,17), 1.0,  "complete",    False),
            ("Electrical",           "16.10.2", "Rough-In Wiring — L1-L2",         "BlueSky MEP",            date(2024,8,15), date(2024,9,30), date(2024,8,17), date(2024,10,3), 1.0,  "complete",    False),
            ("Electrical",           "16.10.3", "Rough-In Wiring — L3-L4",         "BlueSky MEP",            date(2024,10,5), date(2024,11,30),None,            None,            0.0,  "not_started", False),
            # Intentionally inconsistent row — completed status but pct < 100% to demonstrate flag
            ("Finishes",             "9.10.1",  "Drywall Hang & Tape — L1",        "ProFinish Drywall",      date(2024,10,1), date(2024,11,15),date(2024,10,3), None,            0.45, "complete",    False),
        ]

        for (div, code, name, vendor, ps, pe, as_, ae, pct, status, is_crit) in tasks_p1:
            db.add(ScheduleTask(
                tenant_id=tid,
                project_id=proj1.id,
                task_name=name,
                vendor_name=vendor,
                division=div,
                line_item_code=code,
                line_item_name=name,
                planned_start=ps,
                planned_end=pe,
                actual_start=as_,
                actual_end=ae,
                pct_complete=pct,
                status=ScheduleTaskStatus(status),
                is_critical=is_crit,
                is_milestone=False,
                created_by="demo@estatecfo.com",
            ))

        # ── Riverfront Residences (shorter set) ─────────────────────────────
        tasks_p2 = [
            ("General Conditions",   "1.10.1",  "Site Mobilization",                "Summit Construction",    date(2023,1,15), date(2023,1,28), date(2023,1,15), date(2023,1,27), 1.0, "complete",    False),
            ("Sitework & Demolition","2.10.1",  "Demolition & Site Prep",           "Dallas Demo Inc.",       date(2023,1,28), date(2023,2,15), date(2023,1,30), date(2023,2,14), 1.0, "complete",    True),
            ("Concrete",             "3.10.1",  "Foundation Slab on Grade",         "Dallas Concrete LLC",    date(2023,2,20), date(2023,3,15), date(2023,2,21), date(2023,3,16), 1.0, "complete",    True),
            ("Structural Steel",     "5.10.1",  "Structural Frame — All Buildings", "Ironclad Structural",    date(2023,3,20), date(2023,6,1),  date(2023,3,22), date(2023,6,3),  1.0, "complete",    True),
            ("Masonry",              "4.10.1",  "Brick & Stone Veneer",             "Hill Country Stone",     date(2023,6,15), date(2023,8,31), date(2023,6,17), date(2023,9,5),  1.0, "complete",    False),
            ("Thermal & Moisture",   "7.10.1",  "Roof Membrane & Flashing",         "Premier Roofing",        date(2023,8,1),  date(2023,9,15), date(2023,8,3),  date(2023,9,14), 1.0, "complete",    False),
            ("Mechanical",           "15.10.1", "HVAC Installation",                "Dallas MEP Group",       date(2023,9,1),  date(2023,11,30),date(2023,9,3),  date(2023,12,5), 1.0, "complete",    False),
            ("Electrical",           "16.10.1", "Full Electrical Rough-In",         "Dallas MEP Group",       date(2023,9,1),  date(2023,12,1), date(2023,9,3),  date(2023,12,3), 1.0, "complete",    False),
            ("Finishes",             "9.10.1",  "Interior Finishes — All Units",    "ProFinish Drywall",      date(2023,12,1), date(2024,2,28), date(2023,12,3), date(2024,3,5),  1.0, "complete",    False),
            ("Finishes",             "9.10.2",  "Tile & Flooring Installation",     "Daltile Distribution",   date(2024,1,15), date(2024,3,31), date(2024,1,17), date(2024,4,2),  1.0, "complete",    False),
        ]

        for (div, code, name, vendor, ps, pe, as_, ae, pct, status, is_crit) in tasks_p2:
            db.add(ScheduleTask(
                tenant_id=tid,
                project_id=proj2.id,
                task_name=name,
                vendor_name=vendor,
                division=div,
                line_item_code=code,
                line_item_name=name,
                planned_start=ps,
                planned_end=pe,
                actual_start=as_,
                actual_end=ae,
                pct_complete=pct,
                status=ScheduleTaskStatus(status),
                is_critical=is_crit,
                is_milestone=False,
                created_by="demo@estatecfo.com",
            ))

        db.commit()
        n = len(tasks_p1) + len(tasks_p2)
        print(f"Seeded {n} task schedule entries across 2 projects.")
        print("  Note: one row (Drywall Hang — L1) is intentionally inconsistent for demo.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
