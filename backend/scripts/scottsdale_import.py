"""
Transform, verify, and persist PR456 Scottsdale Promenade Center data.

Raw package shape (PR456_full_data_package.json) → seed dict → DB tables.
"""
from __future__ import annotations

import json
import uuid
from datetime import date
from pathlib import Path

from services.construction_roi import build_project_roi_summary

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
RAW_PACKAGE_PATH = DATA_DIR / "PR456_full_data_package.json"
EXCEL_DEFAULT_PATH = DATA_DIR / "PR456_Scottsdale_Promenade_Center.xlsx"

CANONICAL_ADDRESS = "8350 E Raintree Dr"
STALE_ADDRESS_MARKERS = ("8420 E Via de Ventura", "Via de Ventura")
PROJECT_CODE = "PR456"

SOV_TOTAL_EXPECTED = 41_160_000
FULL_PROJECT_COST = 62_732_000
EXPECTED_ROI = 0.236
EXPECTED_MOIC = 1.349
ROI_TOLERANCE = 0.005

EXPECTED_COUNTS = {
    "divisions": 17,
    "permits": 9,
    "change_orders": 4,
    "schedule_tasks": 6,
    "compliance_docs": 11,
}

# CSI division -> TradeName enum (validated against models.real_estate.construction_cost.TradeName).
# Division 06 (Wood/Plastics): no exact enum — closest match is framing_structural.
# Division 14 (Conveying Systems): elevators enum member exists and is the correct mapping.
DIVISION_TRADE_MAP: dict[str, str] = {
    "01": "general_conditions_overhead",
    "02": "site_work_excavation",
    "03": "foundation",
    "04": "exterior_envelope",
    "05": "framing_structural",
    "06": "framing_structural",
    "07": "exterior_envelope",
    "08": "exterior_envelope",
    "09": "interior_finishes",
    "10": "interior_finishes",
    "14": "elevators",
    "21": "fire_protection_sprinklers",
    "22": "plumbing_rough_finish",
    "23": "hvac",
    "26": "electrical_rough_finish",
    "31": "site_work_excavation",
    "32": "landscaping_site_amenities",
}

CO_STATUS_MAP = {
    "signed": "approved",
    "approval_pending": "pending_approval",
    "submitted": "submitted",
    "draft": "draft",
    "approved": "approved",
    "pending_approval": "pending_approval",
    "rejected": "rejected",
}

COMPLIANCE_STATUS_MAP = {
    "approved": "compliant",
    "expired": "expired",
    "missing": "missing",
    "pending": "pending",
    "compliant": "compliant",
}

DOC_TYPE_MAP = {
    "certificate_of_insurance": "coi_general_liability",
    "license": "contractor_license",
    "safety": "osha_safety_plan",
    "w9": "w9",
}


def load_raw_package(path: Path | None = None) -> dict:
    path = path or RAW_PACKAGE_PATH
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _csi_code(division_number: str) -> str:
    num = division_number.strip().zfill(2)
    return f"{num} 00 00"


def _validate_trade_name(name: str, division_label: str) -> str:
    from models.real_estate.construction_cost import TradeName
    try:
        TradeName(name)
    except ValueError as exc:
        raise ValueError(
            f"Invalid trade_name '{name}' for division '{division_label}' — "
            f"must be a TradeName enum member"
        ) from exc
    return name


def derive_schedule_status(task: dict) -> str:
    """Derive ScheduleTask.status from source fields (no status column in PR456 JSON)."""
    if task.get("actual_start") and task.get("actual_end"):
        return "complete"
    if task.get("days_late") and int(task["days_late"]) > 0:
        return "late"
    if task.get("actual_start"):
        return "in_progress"
    return "not_started"


def derive_pct_complete(task: dict) -> float:
    # Rough default when only start date is known — not a precise figure from source data.
    if task.get("actual_start") and task.get("actual_end"):
        return 1.0
    if task.get("actual_start"):
        return 0.5
    return 0.0


def _co_title(description: str, max_len: int = 255) -> str:
    desc = (description or "").strip()
    if len(desc) <= max_len:
        return desc or "Change order"
    return desc[: max_len - 3] + "..."


def transform_raw_to_seed(raw: dict) -> dict:
    """Convert PR456_full_data_package.json into the internal seed dict for DB persist."""
    master = raw["project_master"]
    sov_total = sum(float(d["contract_value"]) for d in raw["divisions"])

    divisions = []
    for div in raw["divisions"]:
        div_num = str(div["division_number"]).zfill(2)
        trade = DIVISION_TRADE_MAP.get(div_num)
        if not trade:
            raise ValueError(f"No TradeName mapping for division {div_num} ({div['division_name']})")
        _validate_trade_name(trade, div["division_name"])
        divisions.append({
            "csi_division_code": _csi_code(div_num),
            "division_label": div["division_name"],
            "trade_name": trade,
            "vendor_name": div.get("vendor_name"),
            "budgeted_cost": float(div["contract_value"]),
            "actual_cost_to_date": float(div["actual_cost_to_date"]),
            "committed_cost": float(div["committed_cost"]),
            "pct_complete": float(div["pct_complete"]),
        })

    change_orders = []
    for co in raw["change_orders"]:
        status_key = co["status"]
        db_status = CO_STATUS_MAP.get(status_key, status_key)
        cost = float(co["cost_impact"])
        approved = cost if db_status == "approved" else co.get("approved_amount")
        change_orders.append({
            "co_number": co["change_request_number"],
            "title": _co_title(co["description"]),
            "description": co["description"],
            "requested_amount": cost,
            "approved_amount": float(approved) if approved is not None else None,
            "status": db_status,
            "request_date": co.get("created_date"),
            "approval_date": co.get("approval_date"),
            "impact_on_schedule_days": co.get("schedule_impact_days"),
        })

    schedule_tasks = []
    for task in raw["schedule_tasks"]:
        status = derive_schedule_status(task)
        pct = derive_pct_complete(task)
        schedule_tasks.append({
            "task_name": task["task_name"],
            "vendor_name": task.get("vendor_name"),
            "planned_start": task.get("planned_start"),
            "planned_end": task.get("planned_end"),
            "actual_start": task.get("actual_start"),
            "actual_end": task.get("actual_end"),
            "pct_complete": pct,
            "status": status,
            "is_critical": bool(task.get("days_late", 0) and int(task["days_late"]) >= 30),
            "is_milestone": False,
        })

    compliance_docs = []
    for doc in raw.get("compliance_docs", []):
        doc_type_raw = doc.get("document_type") or doc.get("doc_type", "")
        compliance_docs.append({
            "vendor_name": doc["vendor_name"],
            "doc_type": DOC_TYPE_MAP.get(doc_type_raw, doc_type_raw),
            "doc_name": doc.get("doc_name") or doc_type_raw.replace("_", " ").title(),
            "status": COMPLIANCE_STATUS_MAP.get(doc.get("status", ""), doc.get("status", "missing")),
            "expiry_date": doc.get("expiration_date") or doc.get("expiry_date"),
            "is_blocking": doc.get("is_blocking", doc.get("status") in ("expired", "missing")),
        })

    fin = raw.get("financials") or {}
    financial_snapshots = []
    if fin:
        financial_snapshots.append({
            "period_start": fin.get("period_start"),
            "period_end": fin.get("period_end"),
            "received_from_owner": fin["received_from_owner"],
            "paid_to_subcontractors": abs(float(fin["paid_to_subcontractors"])),
            "other_expenses": abs(float(fin["other_expenses"])),
            "retainage_held": fin.get("retainage_held", 0),
            "retainage_receivable": fin.get("retainage_receivable", 0),
        })

    roi_raw = raw.get("roi_summary") or raw.get("roi_assumptions") or {}
    roi_assumptions = {
        "total_project_cost": float(roi_raw.get("total_project_cost", FULL_PROJECT_COST)),
        "equity_pct": float(roi_raw.get("equity_pct", 0.4)),
        "debt_pct": float(roi_raw.get("debt_pct", 0.6)),
        "interest_rate_annual": float(roi_raw.get("interest_rate_annual", 0.0825)),
        "construction_months": int(roi_raw.get("construction_months", 20)),
        "exit_strategy": roi_raw.get("exit_strategy", "forward_sale"),
        "stabilized_noi": float(roi_raw.get("stabilized_noi", 4_950_000)),
        "exit_cap_rate": float(roi_raw.get("exit_cap_rate", 0.0675)),
        "selling_costs_pct": float(roi_raw.get("selling_costs_pct", 0.025)),
    }

    project_master = {
        "project_code": master["project_code"],
        "project_name": master["project_name"],
        "project_type": master.get("project_type", "commercial_for_sale"),
        "address": master["address"],
        "city": master["city"],
        "state": master["state"],
        "zip_code": master["zip_code"],
        "county": master.get("county"),
        "total_saleable_sqft": master.get("total_saleable_sqft"),
        "total_land_acres": master.get("total_land_acres"),
        "status": master.get("status", "under_construction"),
        "start_date": master.get("start_date"),
        "target_completion_date": master.get("target_completion_date"),
        "contract_value": sov_total,
        "total_project_cost": roi_assumptions["total_project_cost"],
        "entity_business_line": "construction",
    }

    return {
        "project_master": project_master,
        "divisions": divisions,
        "permits": raw.get("permits", []),
        "change_orders": change_orders,
        "schedule_tasks": schedule_tasks,
        "compliance_docs": compliance_docs,
        "financial_snapshots": financial_snapshots,
        "roi_assumptions": roi_assumptions,
        "_meta": {
            "sov_total": sov_total,
            "source_contract_value_in_master": master.get("contract_value"),
        },
    }


def verify_seed_data(seed: dict, *, expected_roi: float = EXPECTED_ROI, expected_moic: float = EXPECTED_MOIC) -> dict:
    """
    Assert SOV total and recomputed ROI/MOIC match reference values.
    Returns computed summary for logging. Raises ValueError on mismatch.
    """
    sov_total = sum(d["budgeted_cost"] for d in seed["divisions"])
    if abs(sov_total - SOV_TOTAL_EXPECTED) > 100:
        raise ValueError(
            f"SOV total mismatch: got {sov_total}, expected ~{SOV_TOTAL_EXPECTED:,} — "
            "check that full project cost wasn't accidentally imported into CostTrade rows"
        )

    roi = seed["roi_assumptions"]
    if abs(float(roi["total_project_cost"]) - FULL_PROJECT_COST) > 1:
        raise ValueError(
            f"total_project_cost ${roi['total_project_cost']:,.0f} != expected ${FULL_PROJECT_COST:,.0f}"
        )

    result = build_project_roi_summary(
        total_project_cost=roi["total_project_cost"],
        equity_pct=roi["equity_pct"],
        debt_pct=roi["debt_pct"],
        interest_rate_annual=roi["interest_rate_annual"],
        construction_months=roi["construction_months"],
        exit_strategy=roi["exit_strategy"],
        stabilized_noi=roi["stabilized_noi"],
        exit_cap_rate=roi["exit_cap_rate"],
        selling_costs_pct=roi.get("selling_costs_pct", 0.025),
    )
    if result.get("error"):
        raise ValueError(f"ROI calculation failed: {result['error']}")

    computed_roi = result["roi"]
    computed_moic = result["moic"]
    if abs(computed_roi - expected_roi) > ROI_TOLERANCE:
        raise ValueError(
            f"ROI mismatch: got {computed_roi}, expected ~{expected_roi} — "
            "check equity/debt pct and total_project_cost for swapped or wrong values"
        )
    if abs(computed_moic - expected_moic) > ROI_TOLERANCE:
        raise ValueError(
            f"MOIC mismatch: got {computed_moic}, expected ~{expected_moic}"
        )

    return {
        "sov_total": sov_total,
        "roi": computed_roi,
        "moic": computed_moic,
        "net_profit": result.get("net_profit"),
        "equity_invested": result.get("equity_invested"),
    }


def verify_seed_counts(seed: dict) -> None:
    for key, expected in EXPECTED_COUNTS.items():
        actual = len(seed[key])
        if actual != expected:
            raise ValueError(f"Expected {expected} {key}, got {actual}")


def prepare_seed_from_raw(raw_path: Path | None = None) -> dict:
    raw = load_raw_package(raw_path)
    seed = transform_raw_to_seed(raw)
    verify_seed_counts(seed)
    verify_seed_data(seed)
    return seed


def _parse_date(val: str | None) -> date | None:
    if not val:
        return None
    return date.fromisoformat(val)


def cascade_delete_project(db, project_id: uuid.UUID) -> None:
    from models.real_estate.construction_cost import CostTrade
    from models.real_estate.construction_extended import (
        ChangeOrder,
        ComplianceDoc,
        ProjectFinancials,
        ProjectROIAssumptions,
        ScheduleTask,
    )
    from models.real_estate.entity import Project
    from models.real_estate.permitting import Permit

    db.query(ComplianceDoc).filter(ComplianceDoc.project_id == project_id).delete()
    db.query(ScheduleTask).filter(ScheduleTask.project_id == project_id).delete()
    db.query(ChangeOrder).filter(ChangeOrder.project_id == project_id).delete()
    db.query(ProjectFinancials).filter(ProjectFinancials.project_id == project_id).delete()
    db.query(ProjectROIAssumptions).filter(ProjectROIAssumptions.project_id == project_id).delete()
    db.query(CostTrade).filter(CostTrade.project_id == project_id).delete()
    db.query(Permit).filter(Permit.project_id == project_id).delete()
    project = db.query(Project).filter(Project.id == project_id).first()
    if project:
        db.delete(project)
    db.flush()


def purge_stale_scottsdale_projects(db, tenant_id: uuid.UUID) -> list[str]:
    """
    Remove unverified placeholder Scottsdale projects (e.g. 8420 E Via de Ventura)
    so only canonical PR456 remains after import.
    """
    from models.real_estate.entity import Project

    removed = []
    candidates = (
        db.query(Project)
        .filter(Project.tenant_id == tenant_id)
        .filter(Project.project_name.ilike("%Scottsdale Promenade%"))
        .all()
    )
    for project in candidates:
        addr = project.address or ""
        is_canonical = (
            project.project_code == PROJECT_CODE
            and addr.strip() == CANONICAL_ADDRESS
        )
        is_stale = any(marker in addr for marker in STALE_ADDRESS_MARKERS)
        if is_stale or (project.project_code == PROJECT_CODE and not is_canonical and addr):
            cascade_delete_project(db, project.id)
            removed.append(f"{project.project_code} @ {addr} (id={project.id})")
    return removed


def final_state_check(db, tenant_id: uuid.UUID, project_id: uuid.UUID, seed: dict, checks: dict) -> dict:
    """Step 7 verification — fail loudly if post-import state is wrong."""
    from models.real_estate.construction_cost import CostTrade, TradeName
    from models.real_estate.construction_extended import (
        ChangeOrder,
        ComplianceDoc,
        ProjectFinancials,
        ProjectROIAssumptions,
        ScheduleTask,
    )
    from models.real_estate.entity import Project
    from models.real_estate.permitting import Permit

    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.tenant_id == tenant_id)
        .first()
    )
    if not project:
        raise ValueError(f"Project {project_id} not found after import")

    scottsdale_count = (
        db.query(Project)
        .filter(Project.tenant_id == tenant_id, Project.project_name.ilike("%Scottsdale Promenade%"))
        .count()
    )
    if scottsdale_count != 1:
        raise ValueError(
            f"Expected exactly 1 Scottsdale Promenade project, found {scottsdale_count}"
        )

    if float(project.contract_value or 0) != SOV_TOTAL_EXPECTED:
        raise ValueError(
            f"projects.contract_value = {project.contract_value}, expected {SOV_TOTAL_EXPECTED}"
        )

    roi_row = (
        db.query(ProjectROIAssumptions)
        .filter(ProjectROIAssumptions.project_id == project_id)
        .first()
    )
    if not roi_row or float(roi_row.total_project_cost or 0) != FULL_PROJECT_COST:
        raise ValueError(
            f"roi_assumptions.total_project_cost = "
            f"{getattr(roi_row, 'total_project_cost', None)}, expected {FULL_PROJECT_COST}"
        )

    counts = {
        "divisions": db.query(CostTrade).filter(CostTrade.project_id == project_id).count(),
        "permits": db.query(Permit).filter(Permit.project_id == project_id).count(),
        "change_orders": db.query(ChangeOrder).filter(ChangeOrder.project_id == project_id).count(),
        "schedule_tasks": db.query(ScheduleTask).filter(ScheduleTask.project_id == project_id).count(),
        "compliance_docs": db.query(ComplianceDoc).filter(ComplianceDoc.project_id == project_id).count(),
        "financial_snapshots": db.query(ProjectFinancials).filter(ProjectFinancials.project_id == project_id).count(),
    }
    for key, expected in EXPECTED_COUNTS.items():
        if counts[key] != expected:
            raise ValueError(f"Post-import {key} count {counts[key]} != expected {expected}")

    trades = db.query(CostTrade).filter(CostTrade.project_id == project_id).all()
    for t in trades:
        if t.trade_name is None:
            raise ValueError(f"CostTrade {t.id} has null trade_name")
        TradeName(t.trade_name.value)

    summary = {
        "project_id": str(project_id),
        "project_code": project.project_code,
        "address": project.address,
        "contract_value": float(project.contract_value),
        "total_project_cost": float(roi_row.total_project_cost),
        "roi_verified": checks["roi"],
        "moic_verified": checks["moic"],
        "sov_verified": checks["sov_total"],
        "scottsdale_project_count": scottsdale_count,
        **counts,
    }
    return summary


def persist_scottsdale(db, tenant_id: uuid.UUID, seed: dict, replace: bool = True) -> uuid.UUID:
    """Insert PR456 project and all child rows. Caller manages commit."""
    from models.real_estate.construction_cost import CostTrade, TradeName
    from models.real_estate.construction_extended import (
        ChangeOrder,
        ChangeOrderStatus,
        ComplianceDoc,
        ComplianceDocStatus,
        ExitStrategy,
        ProjectFinancials,
        ProjectROIAssumptions,
        ScheduleTask,
        ScheduleTaskStatus,
    )
    from models.real_estate.entity import BusinessLine, Entity, EntityType, Project, ProjectStatus, ProjectType
    from models.real_estate.permitting import Permit, PermitStatus, PermitType
    from models.tenancy import Tenant

    master = seed["project_master"]
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise ValueError(f"Tenant {tenant_id} not found")

    stale_removed = purge_stale_scottsdale_projects(db, tenant_id)
    for msg in stale_removed:
        print(f"  Purged stale project: {msg}")

    existing = (
        db.query(Project)
        .filter(Project.tenant_id == tenant_id, Project.project_code == master["project_code"])
        .first()
    )
    if existing and not replace:
        print(f"Scottsdale project already seeded ({existing.id}). Use --replace to reload.")
        return existing.id

    if existing and replace:
        cascade_delete_project(db, existing.id)

    entity = (
        db.query(Entity)
        .filter(Entity.tenant_id == tenant_id, Entity.business_line == BusinessLine.construction)
        .first()
    )
    if not entity:
        holding = Entity(
            tenant_id=tenant_id,
            entity_name="Summit Holdings LLC",
            entity_type=EntityType.Parent,
            business_line=BusinessLine.holding,
            formation_state="DE",
            is_active=True,
        )
        db.add(holding)
        db.flush()
        entity = Entity(
            tenant_id=tenant_id,
            entity_name="Summit Construction AZ LLC",
            entity_type=EntityType.LLC,
            business_line=BusinessLine.construction,
            parent_entity_id=holding.id,
            formation_state="AZ",
            is_active=True,
        )
        db.add(entity)
        db.flush()

    project = Project(
        tenant_id=tenant_id,
        entity_id=entity.id,
        project_code=master["project_code"],
        project_name=master["project_name"],
        project_type=ProjectType(master["project_type"]),
        address=master["address"],
        city=master["city"],
        state=master["state"],
        zip_code=master["zip_code"],
        county=master.get("county"),
        total_saleable_sqft=master.get("total_saleable_sqft"),
        total_land_acres=master.get("total_land_acres"),
        status=ProjectStatus(master["status"]),
        start_date=_parse_date(master.get("start_date")),
        target_completion_date=_parse_date(master.get("target_completion_date")),
        contract_value=master["contract_value"],
        total_project_cost=master["total_project_cost"],
        flood_zone=master.get("flood_zone", False) if "flood_zone" in master else False,
        wildfire_risk_zone=master.get("wildfire_risk_zone", False),
        hurricane_zone=master.get("hurricane_zone", False),
        insurance_coverage_amount=master.get("insurance_coverage_amount", 9_200_000),
    )
    db.add(project)
    db.flush()

    for div in seed["divisions"]:
        db.add(CostTrade(
            tenant_id=tenant_id,
            project_id=project.id,
            trade_name=TradeName(div["trade_name"]),
            csi_division_code=div["csi_division_code"],
            division_label=div["division_label"],
            vendor_name=div.get("vendor_name"),
            budgeted_cost=div["budgeted_cost"],
            actual_cost_to_date=div["actual_cost_to_date"],
            committed_cost=div["committed_cost"],
            pct_complete=div["pct_complete"],
            last_updated_date=date.today(),
        ))

    for p in seed["permits"]:
        db.add(Permit(
            tenant_id=tenant_id,
            project_id=project.id,
            permit_type=PermitType(p["permit_type"]),
            issuing_authority=p["issuing_authority"],
            budgeted_cost=p.get("budgeted_cost", 0),
            actual_cost=p.get("actual_cost"),
            status=PermitStatus(p["status"]),
            is_blocking=p.get("is_blocking", False),
            application_date=_parse_date(p.get("application_date")),
            target_approval_date=_parse_date(p.get("target_approval_date")),
            actual_approval_date=_parse_date(p.get("actual_approval_date")),
            notes=p.get("notes"),
        ))

    for co in seed["change_orders"]:
        db.add(ChangeOrder(
            tenant_id=tenant_id,
            project_id=project.id,
            co_number=co["co_number"],
            title=co["title"],
            description=co.get("description"),
            csi_division_code=co.get("csi_division_code"),
            trade_name=co.get("trade_name"),
            requested_amount=co["requested_amount"],
            approved_amount=co.get("approved_amount"),
            status=ChangeOrderStatus(co["status"]),
            reason_code=co.get("reason_code"),
            request_date=_parse_date(co.get("request_date")),
            approval_date=_parse_date(co.get("approval_date")),
            impact_on_schedule_days=co.get("impact_on_schedule_days"),
        ))

    for task in seed["schedule_tasks"]:
        db.add(ScheduleTask(
            tenant_id=tenant_id,
            project_id=project.id,
            task_name=task["task_name"],
            vendor_name=task.get("vendor_name"),
            planned_start=_parse_date(task.get("planned_start")),
            planned_end=_parse_date(task.get("planned_end")),
            actual_start=_parse_date(task.get("actual_start")),
            actual_end=_parse_date(task.get("actual_end")),
            pct_complete=task["pct_complete"],
            status=ScheduleTaskStatus(task["status"]),
            is_critical=task.get("is_critical", False),
            is_milestone=task.get("is_milestone", False),
            notes=task.get("notes"),
        ))

    for doc in seed["compliance_docs"]:
        db.add(ComplianceDoc(
            tenant_id=tenant_id,
            project_id=project.id,
            vendor_name=doc["vendor_name"],
            doc_type=doc["doc_type"],
            doc_name=doc.get("doc_name"),
            status=ComplianceDocStatus(doc["status"]),
            issue_date=_parse_date(doc.get("issue_date")),
            expiry_date=_parse_date(doc.get("expiry_date")),
            is_blocking=doc.get("is_blocking", False),
            notes=doc.get("notes"),
        ))

    for snap in seed.get("financial_snapshots", []):
        db.add(ProjectFinancials(
            tenant_id=tenant_id,
            project_id=project.id,
            period_start=_parse_date(snap.get("period_start")),
            period_end=_parse_date(snap.get("period_end")),
            received_from_owner=snap["received_from_owner"],
            paid_to_subcontractors=snap["paid_to_subcontractors"],
            other_expenses=snap["other_expenses"],
            retainage_held=snap.get("retainage_held", 0),
            retainage_receivable=snap.get("retainage_receivable", 0),
        ))

    roi = seed.get("roi_assumptions")
    if roi:
        db.add(ProjectROIAssumptions(
            tenant_id=tenant_id,
            project_id=project.id,
            total_project_cost=roi["total_project_cost"],
            equity_pct=roi["equity_pct"],
            debt_pct=roi["debt_pct"],
            interest_rate_annual=roi["interest_rate_annual"],
            construction_months=roi["construction_months"],
            exit_strategy=ExitStrategy(roi["exit_strategy"]),
            stabilized_noi=roi["stabilized_noi"],
            exit_cap_rate=roi["exit_cap_rate"],
            selling_costs_pct=roi.get("selling_costs_pct", 0.025),
        ))

    db.commit()
    db.refresh(project)
    return project.id
