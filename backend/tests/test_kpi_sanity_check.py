"""Tests for rental KPI engine and sanity check logic."""
from services.kpi_sanity_check import audit_company_financials
from services.rental_kpi_engine import calc_kpis, resolve_kpi_view, resolve_kpi_view_for_period


def _mom_sample_fin() -> dict:
    """Feb + Mar 2026 monthly P&L — regression case for MoM summing bug."""
    def pl_row(label: str, feb: float, mar: float, **kw) -> dict:
        return {
            "label": label,
            "values": {2026: feb + mar},
            "monthlyValues": {"Feb 2026": feb, "Mar 2026": mar},
            "indent": 0,
            "isTotal": True,
            "isSectionHeader": False,
            "isNetIncome": False,
            **kw,
        }

    return {
        "years": [2026],
        "periods": ["Feb 2026", "Mar 2026"],
        "pl": [
            pl_row("Total for Income", 7475.0, 7875.0),
            pl_row("Total for Expenses", 5656.82, 6121.70),
            pl_row("Total for Interest Paid", 3577.71, 4116.06),
            {"label": "Net Income", "values": {2026: 0}, "monthlyValues": {"Feb 2026": 0, "Mar 2026": 0},
             "indent": 0, "isTotal": False, "isSectionHeader": False, "isNetIncome": True},
        ],
        "bs": [
            {"label": "Total for Assets", "values": {2026: 100_000}, "monthlyValues": {"Feb 2026": 100_000, "Mar 2026": 100_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Liabilities", "values": {2026: 50_000}, "monthlyValues": {"Feb 2026": 50_000, "Mar 2026": 50_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Equity", "values": {2026: 50_000}, "monthlyValues": {"Feb 2026": 50_000, "Mar 2026": 50_000},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Buildings", "values": {2026: 80_000}, "monthlyValues": {"Feb 2026": 80_000, "Mar 2026": 80_000},
             "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False},
        ],
        "cf": [],
    }


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


def test_mom_uses_current_month_only_not_sum():
    fin = _mom_sample_fin()
    k, k_prev, label = resolve_kpi_view_for_period(fin, "MoM", 3, 2026)
    assert label == "Mar 2026"
    assert k.total_revenue == 7875.0
    assert k.total_expenses == 6121.70
    assert k.interest_expense == 4116.06
    assert abs(k.noi - 5869.36) < 0.02
    assert k_prev is not None
    assert k_prev.total_revenue == 7475.0
    assert k_prev.total_expenses == 5656.82


def test_mom_audit_noi_margin_march_only():
    result = audit_company_financials(
        _mom_sample_fin(),
        company_id="co",
        company_name="Co",
        period="MoM",
        month=3,
        year=2026,
    )
    noi_row = next(r for r in result.rows if r.kpi == "NOI Margin")
    assert noi_row.inputs_detail.get("Total Revenue") == "$7.9K"
    assert noi_row.inputs_detail.get("Total Expenses") == "$6.1K"
    assert abs(noi_row.canonical_value - 74.53) < 0.1


def test_ytd_still_sums_months():
    fin = _mom_sample_fin()
    fin["pl"].append({
        "label": "Jan income",
        "values": {2026: 1000},
        "monthlyValues": {"Jan 2026": 1000.0, "Feb 2026": 0, "Mar 2026": 0},
        "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False,
    })
    fin["periods"] = ["Jan 2026", "Feb 2026", "Mar 2026"]
    k, _, label = resolve_kpi_view_for_period(fin, "YTD", 3, 2026)
    assert "YTD" in label
    assert k.total_revenue > 7875.0  # includes Jan + Feb + Mar


def test_debt_to_equity_negative_equity():
    fin = {
        "years": [2026],
        "periods": ["Mar 2026"],
        "pl": [],
        "bs": [
            {"label": "Total for Liabilities", "values": {2026: 606_600},
             "monthlyValues": {"Mar 2026": 606_600},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Equity", "values": {2026: -142_200},
             "monthlyValues": {"Mar 2026": -142_200},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Total for Assets", "values": {2026: 464_400},
             "monthlyValues": {"Mar 2026": 464_400},
             "indent": 0, "isTotal": True, "isSectionHeader": False, "isNetIncome": False},
            {"label": "Buildings", "values": {2026: 500_000},
             "monthlyValues": {"Mar 2026": 500_000},
             "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False},
        ],
        "cf": [],
    }
    result = audit_company_financials(
        fin, company_id="co", company_name="Co", month=3, year=2026,
        total_debt=606_600,
    )
    dte_row = next(r for r in result.rows if r.kpi == "Debt-to-Equity")
    assert dte_row.canonical_value is not None
    assert abs(dte_row.canonical_value - (-4.27)) < 0.05
    assert dte_row.canonical_display == "-4.3x"
    assert dte_row.status in ("MATCH", "CHECK_LOGIC")
    assert dte_row.status != "MISMATCH"


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


def test_calc_monthly_kpis_noi_uses_pl_income_minus_expenses_plus_interest():
  """Portfolio Overview NOI must match Financials: revenue - expenses + interest."""
  from services.rental_kpi_engine import calc_monthly_kpis

  pl = [
      {"label": "Total for Income", "monthlyValues": {"Jun 2026": 10_000}},
      {"label": "Total for Expenses", "monthlyValues": {"Jun 2026": 6_000}},
      {"label": "Interest Paid", "monthlyValues": {"Jun 2026": 500}},
  ]
  k = calc_monthly_kpis(pl, "Jun 2026")
  assert k["total_revenue"] == 10_000
  assert k["total_expenses"] == 6_000
  assert k["interest"] == 500
  assert k["noi"] == 4_500
  assert k["noi"] / k["total_revenue"] * 100 == 45.0


def test_cfo_dashboard_audit_includes_chart_metrics():
    from services.cfo_dashboard_kpi_audit import audit_company_cfo_dashboard

    fin = _sample_fin()
    rows = audit_company_cfo_dashboard(fin, selected_year=2026)
    kpis = {r.kpi for r in rows}
    assert "Net Income Trajectory" in kpis
    assert "Expense Ratio Trend" in kpis
    assert "Revenue vs Expenses" in kpis
    assert "Cash Balance Trend (Bank Accounts)" in kpis
    assert "Revenue Breakdown — Rental Income" in kpis
    assert "Latest Net Income (2026)" in kpis
    assert "Avg Profit Margin" in kpis
    assert "Latest Cash Position (2026)" in kpis

    ni_row = next(r for r in rows if r.kpi == "Latest Net Income (2026)")
    assert ni_row.canonical_value == 500_000
    assert ni_row.status == "MATCH"

    cash_row = next(r for r in rows if r.kpi == "Latest Cash Position (2026)")
    assert cash_row.canonical_value == 120_000

    margin_row = next(r for r in rows if r.kpi == "Avg Profit Margin")
    assert margin_row.canonical_value == 12.5  # 2025 has no P&L values (0%) + 2026 at 25%

    exp_rows = [r for r in rows if r.section.startswith("CFO Dashboard — Expense Breakdown")]
    assert any(r.kpi == "Expense Breakdown — Mgmt Fee" for r in exp_rows)


def test_cfo_dashboard_merged_into_financial_audit():
    from services.cfo_dashboard_kpi_audit import audit_company_cfo_dashboard
    from services.kpi_sanity_check import _merge_audit_rows

    fin_result = audit_company_financials(
        _sample_fin(),
        company_id="test-co",
        company_name="Test Co",
        month=6,
        year=2026,
    )
    cfo_rows = audit_company_cfo_dashboard(_sample_fin(), selected_year=2026)
    merged = _merge_audit_rows(fin_result, cfo_rows)
    assert any(r.kpi == "Net Income Trajectory" for r in merged.rows)
    assert merged.has_data


def test_ebitda_margin_equals_noi_margin():
    fin = _sample_fin()
    fin["pl"].append({
        "label": "Depreciation", "values": {2026: 80_000}, "monthlyValues": {"Jun 2026": 80_000},
        "indent": 1, "isTotal": False, "isSectionHeader": False, "isNetIncome": False,
    })
    result = audit_company_financials(
        fin, company_id="co", company_name="Co", month=6, year=2026,
    )
    noi_row = next(r for r in result.rows if r.kpi == "NOI Margin")
    ebitda_row = next(r for r in result.rows if r.kpi == "EBITDA Margin")
    assert noi_row.canonical_value == 25.0
    assert ebitda_row.canonical_value == 25.0
    assert abs(noi_row.canonical_value - ebitda_row.canonical_value) < 0.01

    cross = next(r for r in result.rows if r.kpi == "EBITDA = NOI Margin (cross-check)")
    assert cross.status == "MATCH"


def test_debt_ratios_use_loan_tracker_not_total_liabilities():
    fin = _sample_fin()
    total_liab = 3_000_000
    total_debt = 2_000_000
    equity = 2_000_000
    assets = 5_000_000

    result_old_style = total_liab / equity
    result_new = total_debt / equity
    assert result_new < result_old_style

    result = audit_company_financials(
        fin, company_id="co", company_name="Co", month=6, year=2026,
        total_debt=total_debt,
    )
    dte_row = next(r for r in result.rows if r.kpi == "Debt-to-Equity")
    dta_row = next(r for r in result.rows if r.kpi == "Debt-to-Asset")
    assert abs(dte_row.canonical_value - 1.0) < 0.01
    assert abs(dta_row.canonical_value - 40.0) < 0.01
    assert "Total Debt (Loan Tracker)" in dte_row.inputs_detail


def test_debt_ratios_na_without_loan_data():
    result = audit_company_financials(
        _sample_fin(), company_id="co", company_name="Co", month=6, year=2026,
        total_debt=None,
    )
    dte_row = next(r for r in result.rows if r.kpi == "Debt-to-Equity")
    dta_row = next(r for r in result.rows if r.kpi == "Debt-to-Asset")
    assert dte_row.canonical_value is None
    assert dta_row.canonical_value is None
    assert dte_row.canonical_display == "N/A"
