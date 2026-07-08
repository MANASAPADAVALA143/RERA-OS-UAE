"""Tests for company_expense_excel_import — synthetic data only."""
import io

import openpyxl

from services.company_expense_excel_import import (
    parse_company_expense_workbook,
    parse_month_header,
)


def _workbook_bytes(rows: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    for r_idx, row in enumerate(rows, start=1):
        for c_idx, val in enumerate(row, start=1):
            ws.cell(row=r_idx, column=c_idx, value=val)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_month_header_formats():
    assert parse_month_header("Dec 2021") == "Dec 2021"
    assert parse_month_header("Jan-2022") == "Jan 2022"
    assert parse_month_header("2022-01") == "Jan 2022"


def test_company_expense_matrix():
    rows = [
        ["Company", "Dec 2021", "Jan 2022", "Feb 2022", "Dec 2022"],
        ["Alpha LLC", None, None, None, 1200.50],
        ["Beta Holdings", 85, 90.25, 0, 100],
        ["", 10, 20, 30, 40],
        ["Total", 100, 200, 300, 400],
    ]
    parsed = parse_company_expense_workbook(_workbook_bytes(rows))
    assert len(parsed.companies) == 2
    by_name = {c.company: c.monthly_totals for c in parsed.companies}
    assert by_name["Alpha LLC"]["Dec 2022"] == 1200.50
    assert by_name["Beta Holdings"]["Dec 2021"] == 85.0
    assert by_name["Beta Holdings"]["Jan 2022"] == 90.25
    assert "Feb 2022" not in by_name["Beta Holdings"]
    assert parsed.month_columns == ["Dec 2021", "Jan 2022", "Feb 2022", "Dec 2022"]


def test_indian_number_format():
    rows = [
        ["Company Name", "Dec 2022"],
        ["Gamma Corp", "1,25,000.00"],
    ]
    parsed = parse_company_expense_workbook(_workbook_bytes(rows))
    assert len(parsed.companies) == 1
    assert parsed.companies[0].monthly_totals["Dec 2022"] == 125000.0
