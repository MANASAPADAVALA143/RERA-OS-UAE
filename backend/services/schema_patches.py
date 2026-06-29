"""Apply lightweight schema patches for columns added after initial deploy."""
import logging
from sqlalchemy import inspect, text

log = logging.getLogger(__name__)


PROJECT_COLUMNS = {
    "project_code": "VARCHAR(50)",
    "contract_value": "NUMERIC(16, 2)",
    "total_project_cost": "NUMERIC(16, 2)",
    "description": "VARCHAR(2000)",
    "creator_role": "VARCHAR(255)",
    "working_days": "VARCHAR(255)",
}

COST_TRADE_COLUMNS = {
    "csi_division_code": "VARCHAR(20)",
    "division_label": "VARCHAR(255)",
    "vendor_name": "VARCHAR(255)",
    "sov_type": "VARCHAR(50)",
    "sov_status": "VARCHAR(50)",
    "sov_start_date": "DATE",
    "sov_end_date": "DATE",
    # AIA G702/G703 billing detail fields
    "prior_period_completed": "NUMERIC(14, 2)",
    "current_period_completed": "NUMERIC(14, 2)",
    "stored_materials": "NUMERIC(14, 2) DEFAULT 0",
    "retainage_pct": "NUMERIC(5, 4)",
}


def _add_missing_columns(engine, table: str, columns: dict[str, str]) -> None:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return
    existing = {c["name"].lower() for c in insp.get_columns(table)}
    for name, col_type in columns.items():
        if name.lower() not in existing:
            # Each column gets its own transaction — one failure won't block others.
            # IF NOT EXISTS is belt-and-suspenders against race conditions.
            try:
                with engine.begin() as conn:
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {name} {col_type}"
                    ))
                log.info("schema patch: added %s.%s (%s)", table, name, col_type)
            except Exception as exc:
                log.warning("schema patch failed %s.%s: %s", table, name, exc)


CHANGE_ORDER_COLUMNS = {
    "requested_by": "VARCHAR(255)",
    "due_date": "DATE",
    "type_of_reference": "VARCHAR(255)",
    "approver": "VARCHAR(255)",
    "attached_cr": "VARCHAR(255)",
    "gc_superintendent": "VARCHAR(255)",
}


SCHEDULE_TASK_COLUMNS = {
    "division": "VARCHAR(255)",
    "line_item_code": "VARCHAR(50)",
    "line_item_name": "VARCHAR(255)",
    "planned_duration_days": "INTEGER",
    "status_override_reason": "TEXT",
}


LOAN_COLUMNS = {
    "noi_annual":             "NUMERIC(16, 2)",
    "current_property_value": "NUMERIC(16, 2)",
    "context_type":           "VARCHAR(20) DEFAULT 'construction'",
}


COMPANY_STATUS_COLUMNS = {
    "status": "VARCHAR(20) DEFAULT 'active'",
}


RENTAL_COMPANY_COLUMNS = {
    "collected_this_month":  "NUMERIC(14, 2)",
    "vacancy_loss":          "NUMERIC(14, 2)",
    "monthly_rent_data":     "JSONB",
    "gross_potential_rent":  "NUMERIC(14, 2) DEFAULT 0",
    "last_sync_month":       "VARCHAR(20)",
    "last_sync_date":        "TIMESTAMP",
    "occupied_units":        "INTEGER DEFAULT 0",
    "total_units":           "INTEGER DEFAULT 0",
}

RENTAL_UNIT_COLUMNS = {
    "rent_history": "JSONB",
    "vacancy_loss": "NUMERIC(14, 2) DEFAULT 0",
}


def apply_schema_patches(engine) -> None:
    _add_missing_columns(engine, "projects", PROJECT_COLUMNS)
    _add_missing_columns(engine, "cost_trades", COST_TRADE_COLUMNS)
    _add_missing_columns(engine, "change_orders", CHANGE_ORDER_COLUMNS)
    _add_missing_columns(engine, "schedule_tasks", SCHEDULE_TASK_COLUMNS)
    _add_missing_columns(engine, "loans", LOAN_COLUMNS)
    # Add status column to existing company tables (safe idempotent patch)
    _add_missing_columns(engine, "r_companies", COMPANY_STATUS_COLUMNS)
    _add_missing_columns(engine, "propdev_companies", COMPANY_STATUS_COLUMNS)
    # Rent Receivable upload sync columns
    _add_missing_columns(engine, "r_companies", RENTAL_COMPANY_COLUMNS)
    _add_missing_columns(engine, "r_units", RENTAL_UNIT_COLUMNS)
