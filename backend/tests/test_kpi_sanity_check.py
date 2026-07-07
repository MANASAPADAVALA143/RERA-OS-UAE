"""Tests for rental KPI engine and sanity check logic."""
from services.kpi_sanity_check import audit_company_financials
from services.rental_kpi_engine import calc_kpis, resolve_kpi_view


def _sample_fin() -> dict:
    return {
        "years": [2025, 2026],
        "periods": ["Jun 2026"],
        "pl": [
            {"label": "Total for Income", "values": {2026: 2_000_000}, "monthlyValues": {"Jun 2026": 2_000_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Expenses", "values": {2026: 1_500_000}, "monthlyValues": {"Jun 2026": 1_500_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Interest Paid", "values": {2026: 0}, "monthlyValues": {"Jun 2026": 0},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Net Income", "values": {2026: 500_000}, "monthlyValues": {"Jun 2026": 500_000},
             "indent": 0, "isTotal": False, "isSectionHeader": False, "isNetIncome": True},
            {"label": "Rent - Unit A", "values": {2026: 1_800_000}, "monthlyValues": {"Jun 2026": 1_800_000},
             "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Management Fee", "values": {2026: 50_000}, "monthlyValues": {"Jun 2026": 50_000},
             "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Repairs", "values": {2026: 30_000}, "monthlyValues": {"Jun 2026": 30_000},
             "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False},
        ],
        "bs": [
            {"label": "Total for Assets", "values": {2026: 5_000_000}, "monthlyValues": {"Jun 2026": 5_000_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Liabilities", "values": {2026: 3_000_000}, "monthlyValues": {"Jun 2026": 3_000_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Equity", "values": {2026: 2_000_000}, "monthlyValues": {"Jun 2026": 2_000_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Bank Accounts", "values": {2026: 120_000}, "monthlyValues": {"Jun 2026": 120_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Buildings", "values": {2026: 4_000_000}, "monthlyValues": {"Jun 2026": 4_000_000},
             "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Long-term Liabilities", "values": {2026: 2_500_000}, "monthlyValues": {"Jun 2026": 2_500_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
        ],
        "cf": [],
    }


def test_noi_excludes_interest_add_back():
    k, _, _ = resolve_kpi_view(_sample_fin(), 2026, 6)
    assert k.total_revenue == 2_000_000
    assert k.noi == 500_000  # 2M - 1.5M + 0 interest


def test_interest_coverage_zero_flags_check_logic():
    result = audit_company_financials(
        _sample_fin(),
        company_id="test-co",
        company_name="Test Co",
        month=6,
        year=2026,
    )
    ic_row = next(r for r in result.rows if r.kpi == "Interest Coverage")
    assert ic_row.canonical_display == "N/A"
    assert ic_row.displayed_display == "0.00x" or ic_row.displayed_value == 0.0
    assert ic_row.status == "CHECK_LOGIC"


def test_breakdown_fields_populated():
    result = audit_company_financials(
        _sample_fin(),
        company_id="test-co",
        company_name="Test Co",
        month=6,
        year=2026,
    )
    noi_row = next(r for r in result.rows if r.kpi == "NOI Margin")
    assert noi_row.substitution
    assert "NOI =" in noi_row.substitution
    assert noi_row.inputs_detail.get("Total Revenue")
    assert len(noi_row.sources) >= 2
