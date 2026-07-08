"""Tests for rent_receivable_parser — synthetic data only."""
import io

import openpyxl

from services.rent_receivable_parser import (
    expand_unit_match_names,
    parse_rent_receivable_file,
    safe_float,
)


def _workbook_bytes(sheet_rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Test Co"
    for r_idx, row in enumerate(sheet_rows, start=1):
        for c_idx, val in enumerate(row, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_duplicate_suite_and_unit_columns_with_rent_parses(tmp_path):
    """Layout where col A and B carry the same property name but rent exists."""
    rows = [
        ["SUITE NAMES", "Name Of the Unit", "Jan-2026", "Sec Dep", "Feb-2026", "Sec Dep"],
        ["Property Alpha", "Property Alpha", 2401.70, None, 2401.70, None],
        ["Property Beta", "Property Beta", 1750.00, None, 1750.00, None],
    ]
    path = tmp_path / "dup_cols.xlsx"
    path.write_bytes(_workbook_bytes(rows))

    result = parse_rent_receivable_file(str(path), target_month="Jan-2026")
    assert "Test Co" in result["companies"]
    units = result["companies"]["Test Co"]["units"]
    assert len(units) == 2
    assert units[0]["name"] == "Property Alpha"
    assert units[0]["current_amount"] == 2401.70


def test_split_suite_and_unit_columns_parses(tmp_path):
    """Standard layout: suite in A, short unit label in B."""
    rows = [
        ["SUITE NAMES", "Name Of the Unit", "Jan-2026", "Sec Dep", "Feb-2026", "Sec Dep"],
        ["Building One LLC", "Unit A", 600.00, None, 600.00, None],
        ["Building One LLC", "Unit B", 775.00, None, 775.00, None],
    ]
    path = tmp_path / "split_cols.xlsx"
    path.write_bytes(_workbook_bytes(rows))

    result = parse_rent_receivable_file(str(path), target_month="Jan-2026")
    units = result["companies"]["Test Co"]["units"]
    assert len(units) == 2
    assert units[0]["name"] == "Unit A"
    assert units[0]["suite"] == "Building One LLC"


def test_unit_name_only_in_column_a_parses(tmp_path):
    """When col B is empty, fall back to col A for the unit name."""
    rows = [
        ["SUITE NAMES", "Name Of the Unit", "Jan-2026", "Sec Dep"],
        ["Property Gamma", None, 900.00, None],
    ]
    path = tmp_path / "col_a_only.xlsx"
    path.write_bytes(_workbook_bytes(rows))

    result = parse_rent_receivable_file(str(path), target_month="Jan-2026")
    units = result["companies"]["Test Co"]["units"]
    assert len(units) == 1
    assert units[0]["name"] == "Property Gamma"


def test_skips_rent_and_sec_dep_summary_rows(tmp_path):
    """RENT / SEC DEP footer rows on some templates must not become units."""
    rows = [
        ["SUITE NAMES", "Name Of the Unit", "Jan-2026", "Sec Dep", "Feb-2026", "Sec Dep"],
        ["Suite 1", "Unit A", 850.00, None, 850.00, None],
        ["Suite 1", "Unit B", 700.00, None, 700.00, None],
        [None, "RENT", 1050.00, None, 1050.00, None],
        [None, "SEC DEP", None, 1593.00, None, 1593.00],
    ]
    path = tmp_path / "skip_summary.xlsx"
    path.write_bytes(_workbook_bytes(rows))

    result = parse_rent_receivable_file(str(path), target_month="Jan-2026")
    units = result["companies"]["Test Co"]["units"]
    assert len(units) == 2
    assert {u["name"] for u in units} == {"Unit A", "Unit B"}


def test_safe_float_parses_currency_strings():
    assert safe_float("$800.00") == 800.0
    assert safe_float("2,401.70") == 2401.70
    assert safe_float("($100.00)") == -100.0
    assert safe_float(None) == 0.0
    assert safe_float("'$1,575.00") == 1575.0
    assert safe_float("$875.00") == 875.0


def test_expand_unit_match_names_splits_combined_labels():
    assert expand_unit_match_names("Unit K, L") == ["Unit K, L", "Unit K", "Unit L"]
    assert expand_unit_match_names("Unit A") == ["Unit A"]


def test_parses_dollar_string_rent_cells(tmp_path):
    rows = [
        ["Name Of the Unit", "Jan-2026", "Sec Dep", "Jun-2026", "Sec Dep"],
        ["Unit A", "$850.00", None, "$900.00", None],
    ]
    path = tmp_path / "currency.xlsx"
    path.write_bytes(_workbook_bytes(rows))

    result = parse_rent_receivable_file(str(path), target_month="Jun-2026")
    units = result["companies"]["Test Co"]["units"]
    assert len(units) == 1
    assert units[0]["current_amount"] == 900.0
    assert units[0]["is_vacant"] is False


def test_skips_suite_names_rents_and_security_deposit_rows(tmp_path):
    """Column-header repeats and income summary rows must not become units."""
    rows = [
        ["SUITE NAMES", "Name Of the Unit", "Jan-2026", "Sec Dep", "Jun-2026", "Sec Dep"],
        ["2414 Marsh", "Unit G", 880.00, None, 880.00, None],
        ["2414 Marsh", "Unit H", 880.00, None, 880.00, None],
        ["SUITE NAMES", "SUITE NAMES", None, None, None, None],
        [None, "Rents", 6030.00, None, 6030.00, None],
        [None, "Security Deposit", None, 2009.00, None, 2009.00],
    ]
    path = tmp_path / "skip_headers.xlsx"
    path.write_bytes(_workbook_bytes(rows))

    result = parse_rent_receivable_file(str(path), target_month="Jun-2026")
    units = result["companies"]["Test Co"]["units"]
    assert len(units) == 2
    assert {u["name"] for u in units} == {"Unit G", "Unit H"}
