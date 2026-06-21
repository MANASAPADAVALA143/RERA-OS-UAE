"""Apply lightweight schema patches for columns added after initial deploy."""
from sqlalchemy import inspect, text


PROJECT_COLUMNS = {
    "project_code": "VARCHAR(50)",
    "contract_value": "NUMERIC(16, 2)",
    "total_project_cost": "NUMERIC(16, 2)",
}

COST_TRADE_COLUMNS = {
    "csi_division_code": "VARCHAR(20)",
    "division_label": "VARCHAR(255)",
    "vendor_name": "VARCHAR(255)",
}


def _add_missing_columns(engine, table: str, columns: dict[str, str]) -> None:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns(table)}
    with engine.begin() as conn:
        for name, col_type in columns.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}"))


def apply_schema_patches(engine) -> None:
    _add_missing_columns(engine, "projects", PROJECT_COLUMNS)
    _add_missing_columns(engine, "cost_trades", COST_TRADE_COLUMNS)
