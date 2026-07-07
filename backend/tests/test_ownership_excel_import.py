"""Tests for ownership_excel_import — synthetic data only."""
import io

import openpyxl

from services.ownership_excel_import import build_import_template_bytes, parse_ownership_workbook


def _workbook_bytes(sheets: dict[str, list[list]]) -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title, rows in sheets.items():
        ws = wb.create_sheet(title)
        for r_idx, row in enumerate(rows, start=1):
            for c_idx, val in enumerate(row, start=1):
                ws.cell(row=r_idx, column=c_idx, value=val)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_ownership_template_columns():
    rows = [
        [
            "Entity Name", "Owned By", "Property Address", "Property Name",
            "Ownership %", "Entity Structure", "Cost Basis", "Book Value", "Existing Debt",
        ],
        [
            "Alpha LLC", "Partner A", "123 Main St", "Building One",
            0.25, "LLC", 500000, 480000, 300000,
        ],
        [
            "Alpha LLC", "Partner B", "123 Main St", "Building One",
            "75%", "LP", 1500000, 1440000, 900000,
        ],
    ]
    parsed = parse_ownership_workbook(_workbook_bytes({"Ownership": rows}))
    assert len(parsed) == 2
    assert parsed[0].entity_name == "Alpha LLC"
    assert parsed[0].partner_name == "Partner A"
    assert parsed[0].property_name == "Building One"
    assert parsed[0].ownership_pct == 0.25
    assert parsed[0].cost_basis == 500000
    assert parsed[1].ownership_pct == 0.75


def test_template_builder_has_expected_headers():
    content = build_import_template_bytes()
    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb.active
    headers = [ws.cell(row=1, column=c).value for c in range(1, 10)]
    assert headers[0] == "Entity Name"
    assert headers[1] == "Owned By"
    assert headers[3] == "Property Name"
    assert headers[8] == "Existing Debt"


def test_skips_rows_without_partner_or_entity():
    rows = [
        ["Entity Name", "Owned By", "Property Name", "Ownership %", "Cost Basis"],
        ["", "Partner A", "Building One", 0.5, 100000],
        ["Alpha LLC", "", "Building One", 0.5, 100000],
        ["TOTAL", "", "", "", ""],
    ]
    parsed = parse_ownership_workbook(_workbook_bytes({"Ownership": rows}))
    assert len(parsed) == 0
