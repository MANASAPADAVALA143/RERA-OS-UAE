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


def _widen_share_percent_columns(engine) -> None:
    """NUMERIC(6,4) cannot store 100% — widen to allow full ownership percentages."""
    insp = inspect(engine)
    for table in ("propdev_partners", "propdev_capital_calls"):
        if table not in insp.get_table_names():
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    f"ALTER TABLE {table} ALTER COLUMN share_percent TYPE NUMERIC(8, 4)"
                ))
            log.info("schema patch: widened %s.share_percent to NUMERIC(8,4)", table)
        except Exception as exc:
            log.warning("schema patch widen %s.share_percent: %s", table, exc)


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
    "balance_by_month":       "JSONB",
    "maturity_checklist":     "JSONB",
    "refinancing_status":     "VARCHAR(30)",
    "refinancing_notes":      "VARCHAR(1000)",
}


COMPANY_STATUS_COLUMNS = {
    "status": "VARCHAR(20) DEFAULT 'active'",
}


RENTAL_COMPANY_COLUMNS = {
    "collected_this_month":  "NUMERIC(14, 2)",
    "vacancy_loss":          "NUMERIC(14, 2)",
    "monthly_rent_data":     "JSONB",
    "monthly_expense_data":  "JSONB",
    "gross_potential_rent":  "NUMERIC(14, 2) DEFAULT 0",
    "last_sync_month":       "VARCHAR(20)",
    "last_sync_date":        "TIMESTAMP",
    "occupied_units":        "INTEGER DEFAULT 0",
    "total_units":           "INTEGER DEFAULT 0",
}

RENTAL_UNIT_COLUMNS = {
    "rent_history": "JSONB",
    "vacancy_loss": "NUMERIC(14, 2) DEFAULT 0",
    "area_sf": "NUMERIC(10, 2)",
    "agreed_lease_amount": "NUMERIC(10, 2)",
    "payment_status": "VARCHAR(20)",
    "lease_term_raw": "VARCHAR(255)",
    "unit_register_at": "TIMESTAMP",
    "lease_action_status": "VARCHAR(50)",
}

OWNERSHIP_COLUMNS = {
    "property_id": "UUID",
    "property_name": "VARCHAR(255)",
    "property_address": "VARCHAR(500)",
    "entity_structure": "VARCHAR(100)",
    "entity_line": "VARCHAR(100)",
    "cost_basis": "NUMERIC(16, 2)",
    "book_value": "NUMERIC(16, 2)",
    "existing_debt": "NUMERIC(16, 2)",
    "capital_contributed": "NUMERIC(16, 2)",
}


PARTNER_OWNERSHIP_COLUMNS = {
    "entity_name": "VARCHAR(255)",
    "property_name": "VARCHAR(255)",
    "property_address": "VARCHAR(500)",
    "entity_line": "VARCHAR(100)",
    "cost_basis": "NUMERIC(16, 2)",
    "book_value": "NUMERIC(16, 2)",
    "fair_market_value": "NUMERIC(16, 2)",
    "existing_debt": "NUMERIC(16, 2)",
    "capital_contributed_estimated": "BOOLEAN DEFAULT FALSE",
}


PROPDEV_LOAN_COLUMNS = {
    "property_name": "VARCHAR(255)",
}

PROPDEV_LOAN_MANAGEMENT_COLUMNS = {
    "insurance_expiry_date": "DATE",
    "refinancing_status": "VARCHAR(50) DEFAULT 'Not Started'",
    "refinancing_notes": "VARCHAR(2000)",
    "loan_purpose": "VARCHAR(100)",
    "maturity_checklist": "JSONB",
}

PROPDEV_FIN_UPLOAD_COLUMNS = {
    "pl_filename": "VARCHAR(255)",
    "bs_filename": "VARCHAR(255)",
    "cf_filename": "VARCHAR(255)",
}

TENANT_COLUMNS = {
    "ai_narrative_enabled": "BOOLEAN NOT NULL DEFAULT TRUE",
}


PROPERTY_PROFILE_COLUMNS = {
    # Identity
    "city": "VARCHAR(120)",
    "state": "VARCHAR(60)",
    "zip_code": "VARCHAR(20)",
    "county": "VARCHAR(120)",
    "legal_description": "VARCHAR(2000)",
    # Land details
    "land_use_type": "VARCHAR(50)",
    "zoning": "VARCHAR(100)",
    "current_status": "VARCHAR(50)",
    # Ownership history
    "previous_owner_name": "VARCHAR(255)",
    "previous_owner_entity": "VARCHAR(255)",
    "acquisition_date": "DATE",
    "acquisition_price": "NUMERIC(16, 2)",
    "acquisition_type": "VARCHAR(50)",
    "title_company": "VARCHAR(255)",
    "deed_reference": "VARCHAR(255)",
    # Tax information
    "tax_parcel_id": "VARCHAR(100)",
    "property_tax_annual": "NUMERIC(16, 2)",
    "tax_assessment_year": "INTEGER",
    "tax_assessed_value": "NUMERIC(16, 2)",
    "tax_exemptions": "VARCHAR(500)",
    "tax_due_date": "DATE",
}

CAPITAL_CALL_SOURCE_COLUMNS = {
    "source_type": "VARCHAR(20) DEFAULT 'manual'",
    "source_id": "UUID",
    "reason": "VARCHAR(500)",
}


def apply_schema_patches(engine) -> None:
    _add_missing_columns(engine, "tenants", TENANT_COLUMNS)
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
    _add_missing_columns(engine, "r_ownership", OWNERSHIP_COLUMNS)
    _add_missing_columns(engine, "propdev_partners", PARTNER_OWNERSHIP_COLUMNS)
    _add_missing_columns(engine, "propdev_loans", PROPDEV_LOAN_COLUMNS)
    _add_missing_columns(engine, "propdev_loans", PROPDEV_LOAN_MANAGEMENT_COLUMNS)
    _add_missing_columns(engine, "propdev_financial_uploads", PROPDEV_FIN_UPLOAD_COLUMNS)
    _add_missing_columns(engine, "propdev_companies", PROPERTY_PROFILE_COLUMNS)
    _add_missing_columns(engine, "propdev_capital_calls", CAPITAL_CALL_SOURCE_COLUMNS)
    _widen_share_percent_columns(engine)
