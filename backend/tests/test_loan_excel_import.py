"""Tests for loan_excel_import — synthetic data only."""
import io

import openpyxl

from services.loan_excel_import import parse_loan_workbook


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


def test_header_based_import():
    rows = [
        ["Sl No.", "Company Name", "Property Name", "Loan Bank Name", "Loan Date",
         "Loan Amount", "Loan Interest Rate", "Loan EMI", "Lender Name",
         "Loan Maturity Date", "Loan Balance", "Loan EMI Day"],
        [1, "Entity Alpha LLC", "Building One", "First Bank", "01-15-2022",
         500000, "5.25%", 3200, "Jane Doe", "01-15-2032", 480000, 15],
    ]
    parsed = parse_loan_workbook(_workbook_bytes({"Loans": rows}))
    assert len(parsed) == 1
    assert parsed[0].company == "Entity Alpha LLC"
    assert parsed[0].property_name == "Building One"
    assert parsed[0].loan_amount == 500000
    assert parsed[0].loan_interest_rate == 0.0525
    assert parsed[0].loan_emi == 3200


def test_legacy_positional_import():
    """Legacy layout without header row — use a named sheet (not Sheet1)."""
    rows = [
        [1, "Entity Beta LLC", "Suite 100", "Metro Bank", "03-01-2020",
         "$1,200,000.00", "4.25%", "$8,500.00", "John Smith",
         "03-01-2030", "$1,100,000.00", "1st"],
    ]
    parsed = parse_loan_workbook(_workbook_bytes({"Active Loans": rows}))
    assert len(parsed) == 0  # no header row — legacy path removed; header-based only


def test_sheet_title_used_when_company_column_empty():
    rows = [
        ["Sl No.", "Company Name", "Property Name", "Loan Bank Name", "Loan Date",
         "Loan Amount", "Loan Interest Rate", "Loan EMI", "Lender Name",
         "Loan Maturity Date", "Loan Balance", "Loan EMI Day"],
        [1, "", "Building Two", "Second Bank", "06-01-2021",
         750000, 6.0, 4500, "Alex Kim", "06-01-2031", 700000, 1],
    ]
    parsed = parse_loan_workbook(_workbook_bytes({"Gamma Holdings LLC": rows}))
    assert len(parsed) == 1
    assert parsed[0].company == "Gamma Holdings LLC"
    assert parsed[0].property_name == "Building Two"
