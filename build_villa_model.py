"""
Build Villa Construction Financial Model - Hyderabad Telangana
50 Villas | 3 Floors | Apr 2026 - Sep 2028 (30 months)
"""

import xlsxwriter
from datetime import datetime
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent / "financial_model"
OUTPUT = OUTPUT_DIR / "Villa_Construction_Financial_Model.xlsx"

NAVY, BLUE, GOLD, GREEN, RED = "#1B2A4A", "#2E75B6", "#FFC000", "#548235", "#C00000"
LIGHT, WHITE, INPUT, CALC, HEADER = "#D6E4F0", "#FFFFFF", "#FFFFCC", "#DAEEF3", "#1B2A4A"
INR = '"₹"#,##0'


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    wb = xlsxwriter.Workbook(str(OUTPUT), {"nan_inf_to_errors": True})
    C = {}  # named cell refs e.g. C["land"] -> "ASSUMPTIONS!$B$13"

    fmt = {}
    fmt["title"]    = wb.add_format({"bold": True, "font_size": 16, "font_color": WHITE,
                                      "bg_color": NAVY, "align": "center", "valign": "vcenter"})
    fmt["subtitle"] = wb.add_format({"bold": True, "font_size": 11, "font_color": NAVY, "bottom": 2})
    fmt["hdr"]      = wb.add_format({"bold": True, "font_color": WHITE, "bg_color": HEADER,
                                      "border": 1, "align": "center", "text_wrap": True})
    fmt["lbl"]      = wb.add_format({"bold": True, "bg_color": LIGHT, "border": 1})
    fmt["inp"]      = wb.add_format({"bg_color": INPUT, "border": 1, "num_format": "#,##0"})
    fmt["inp_pct"]  = wb.add_format({"bg_color": INPUT, "border": 1, "num_format": "0.0%"})
    fmt["inp_inr"]  = wb.add_format({"bg_color": INPUT, "border": 1, "num_format": INR})
    fmt["calc"]     = wb.add_format({"bg_color": CALC, "border": 1, "num_format": "#,##0"})
    fmt["calc_inr"] = wb.add_format({"bg_color": CALC, "border": 1, "num_format": INR})
    fmt["calc_pct"] = wb.add_format({"bg_color": CALC, "border": 1, "num_format": "0.0%"})
    fmt["txt"]      = wb.add_format({"border": 1})
    fmt["date"]     = wb.add_format({"border": 1, "num_format": "dd-mmm-yyyy"})
    fmt["kpi_lbl"]  = wb.add_format({"bold": True, "font_size": 11, "font_color": NAVY, "align": "center"})
    fmt["kpi_val"]  = wb.add_format({"bold": True, "font_size": 18, "font_color": BLUE,
                                      "align": "center", "num_format": INR})
    fmt["kpi_pct"]  = wb.add_format({"bold": True, "font_size": 18, "font_color": GREEN,
                                      "align": "center", "num_format": "0.0%"})
    fmt["note"]     = wb.add_format({"italic": True, "font_color": "#666666", "font_size": 9})

    def a_ref(key, row, col=1):
        C[key] = f"ASSUMPTIONS!${chr(65+col)}${row+1}"
        return C[key]

    # ══════════════════════════════════════════════════════════════════════
    # ASSUMPTIONS
    # ══════════════════════════════════════════════════════════════════════
    ws_a = wb.add_worksheet("ASSUMPTIONS")
    ws_a.set_column("A:A", 38)
    ws_a.set_column("B:D", 18)
    ws_a.merge_range("A1:D1", "VILLA CONSTRUCTION PROJECT - ASSUMPTIONS", fmt["title"])
    ws_a.write("A2", "Hyderabad, Telangana  |  50 Villas x 3 Floors  |  Apr 2026 - Sep 2028", fmt["note"])
    ws_a.write("D2", "Yellow = Input  |  Blue = Calculated", fmt["note"])

    row = 3
    def section(title):
        nonlocal row
        ws_a.merge_range(row, 0, row, 3, title, fmt["subtitle"])
        row += 1

    def write_input(key, label, val, fkey="inp", note=""):
        nonlocal row
        ws_a.write(row, 0, label, fmt["lbl"])
        f = fmt[fkey]
        if isinstance(val, str) and val.startswith("="):
            ws_a.write_formula(row, 1, val, f)
        elif isinstance(val, datetime):
            ws_a.write_datetime(row, 1, val, fmt["date"])
        else:
            ws_a.write(row, 1, val, f)
        a_ref(key, row)
        if note:
            ws_a.write(row, 3, note, fmt["note"])
        row += 1

    section("PROJECT PARAMETERS")
    write_input("villas",    "Number of Villas", 50)
    write_input("floors",    "Floors per Villa", 3)
    write_input("bua",       "Built-up Area per Villa (sq.ft)", 2100)
    write_input("total_bua", "Total Built-up Area (sq.ft)", f"={C['villas']}*{C['bua']}", "calc")
    write_input("start",     "Project Start Date", datetime(2026, 4, 1))
    write_input("end",       "Project End Date", datetime(2028, 9, 30))
    write_input("months",    "Project Duration (months)", 30)

    section("LAND & SITE")
    write_input("land", "Land Acquisition Cost (INR)", 50_000_000, "inp_inr")

    section("CONSTRUCTION COSTS")
    write_input("cost_sqft", "Construction Cost per sq.ft (INR)", 2800, "inp_inr")
    write_input("const",     "Total Construction Cost (INR)", f"={C['total_bua']}*{C['cost_sqft']}", "calc_inr")
    write_input("cont_pct",  "Contingency (% of Construction)", 0.05, "inp_pct")
    write_input("cont_amt",  "Contingency Amount (INR)", f"={C['const']}*{C['cont_pct']}", "calc_inr")

    section("PERMITS & APPROVALS")
    write_input("perm_pct", "Permits as % of Total Project Cost", 0.05, "inp_pct")
    write_input("perm_amt", "Permit Cost (INR) - see PERMITS tab", "=PERMITS!$B$21", "calc_inr")

    section("SALES & PRICING")
    write_input("price_lo",  "Sale Price - Low (INR/villa)", 7_000_000, "inp_inr")
    write_input("price_hi",  "Sale Price - High (INR/villa)", 11_000_000, "inp_inr")
    write_input("price_avg", "Average Sale Price (INR/villa)", f"=AVERAGE({C['price_lo']}:{C['price_hi']})", "calc_inr")

    section("UNIT MIX")
    ws_a.write(row, 0, "Villa Type", fmt["hdr"])
    ws_a.write(row, 1, "Units", fmt["hdr"])
    ws_a.write(row, 2, "Price (INR)", fmt["hdr"])
    ws_a.write(row, 3, "Revenue (INR)", fmt["hdr"])
    row += 1
    mix_start = row
    for typ, units, price in [("3BHK Standard", 20, 8_000_000),
                               ("3BHK Premium", 18, 10_000_000),
                               ("4BHK Luxury", 12, 11_500_000)]:
        ws_a.write(row, 0, typ, fmt["txt"])
        ws_a.write(row, 1, units, fmt["inp"])
        ws_a.write(row, 2, price, fmt["inp_inr"])
        ws_a.write_formula(row, 3, f"=B{row+1}*C{row+1}", fmt["calc_inr"])
        row += 1
    mix_end = row - 1
    ws_a.write(row, 0, "Total", fmt["lbl"])
    ws_a.write_formula(row, 1, f"=SUM(B{mix_start+1}:B{mix_end+1})", fmt["calc"])
    ws_a.write_formula(row, 3, f"=SUM(D{mix_start+1}:D{mix_end+1})", fmt["calc_inr"])
    C["mix_rev"] = f"ASSUMPTIONS!$D${row+1}"
    C["mix_units"] = f"ASSUMPTIONS!$B${row+1}"
    mix_tot_row = row
    row += 2

    write_input("total_rev", "Total Revenue (INR)", f"={C['mix_rev']}", "calc_inr", "From unit mix")

    section("PAYMENT COLLECTION SCHEDULE")
    ws_a.write(row, 0, "Milestone", fmt["hdr"])
    ws_a.write(row, 1, "% of Price", fmt["hdr"])
    ws_a.write(row, 2, "Timing (Month)", fmt["hdr"])
    row += 1
    for milestone, pct, month in [("Booking / Token", 0.10, 1), ("Agreement", 0.15, 3),
                                   ("Foundation", 0.15, 6), ("Slab 1", 0.15, 12),
                                   ("Slab 2", 0.15, 18), ("Finishing", 0.15, 24),
                                   ("Possession", 0.15, 30)]:
        ws_a.write(row, 0, milestone, fmt["txt"])
        ws_a.write(row, 1, pct, fmt["inp_pct"])
        ws_a.write(row, 2, month, fmt["inp"])
        row += 1
    row += 1

    section("FINANCING")
    write_input("debt_pct",  "Debt as % of Total Cost", 0.625, "inp_pct")
    write_input("int_rate",  "Interest Rate (p.a.)", 0.115, "inp_pct")
    write_input("tenor",     "Loan Tenor (years)", 5)
    write_input("grace",     "Moratorium / Grace (months)", 18)

    section("OPERATING")
    write_input("opex_pct",  "SG&A as % of Revenue", 0.03, "inp_pct")
    write_input("tax_rate",  "Corporate Tax Rate", 0.30, "inp_pct")
    write_input("discount",  "Discount Rate (for NPV)", 0.15, "inp_pct")

    section("TARGET METRICS")
    write_input("tgt_roi",  "Target ROI", 0.16, "inp_pct")
    write_input("tgt_irr",  "Target IRR", 0.20, "inp_pct")
    write_input("tgt_moic", "Target MOIC", 1.35)

    row += 1
    section("COST SUMMARY (Calculated)")
    write_input("total_cost", "Total Project Cost (INR)",
                f"={C['land']}+{C['const']}+{C['cont_amt']}+{C['perm_amt']}", "calc_inr")
    write_input("debt_amt",   "Total Debt (INR)", f"={C['total_cost']}*{C['debt_pct']}", "calc_inr")
    write_input("equity",     "Equity Contribution (INR)", f"={C['total_cost']}-{C['debt_amt']}", "calc_inr")
    write_input("net_profit", "Net Profit after Tax (INR)",
                f"=({C['total_rev']}-{C['total_cost']})*(1-{C['tax_rate']})", "calc_inr")

    # ══════════════════════════════════════════════════════════════════════
    # PERMITS
    # ══════════════════════════════════════════════════════════════════════
    ws_p = wb.add_worksheet("PERMITS")
    ws_p.set_column("A:A", 30)
    ws_p.set_column("B:G", 16)
    ws_p.merge_range("A1:G1", "PERMITS & APPROVALS TRACKER - Hyderabad / Telangana", fmt["title"])
    for c, h in enumerate(["Permit / Approval", "Budget (INR)", "Actual (INR)", "Variance (INR)",
                            "Status", "Applied Date", "Approved Date"]):
        ws_p.write(2, c, h, fmt["hdr"])

    permits = [
        ("GHMC Building Permission", 2_500_000, "Pending", datetime(2026, 4, 15)),
        ("RERA Registration", 500_000, "Pending", datetime(2026, 5, 1)),
        ("Fire NOC", 350_000, "Pending", datetime(2026, 8, 1)),
        ("Electricity (TSSPDCL) - LT Connection", 800_000, "Pending", datetime(2026, 6, 1)),
        ("Electricity - HT Line Extension", 1_200_000, "Pending", datetime(2026, 7, 1)),
        ("Electricity - Transformer Sub-station", 2_500_000, "Pending", datetime(2026, 9, 1)),
        ("Water (HMWSSB) Connection", 600_000, "Pending", datetime(2026, 6, 15)),
        ("Environmental Clearance", 400_000, "Pending", datetime(2026, 5, 15)),
        ("Airport Authority NOC (if applicable)", 200_000, "N/A", None),
        ("Labour License / BOCW", 150_000, "Pending", datetime(2026, 4, 1)),
    ]
    p_start = 3
    for i, (name, budget, status, applied) in enumerate(permits):
        r = p_start + i
        ws_p.write(r, 0, name, fmt["txt"])
        ws_p.write(r, 1, budget, fmt["inp_inr"])
        ws_p.write(r, 2, 0, fmt["inp_inr"])
        ws_p.write_formula(r, 3, f"=C{r+1}-B{r+1}", fmt["calc_inr"])
        ws_p.write(r, 4, status, fmt["inp"])
        if applied:
            ws_p.write_datetime(r, 5, applied, fmt["date"])

    p_end = p_start + len(permits) - 1
    p_tot = p_end + 2
    ws_p.write(p_tot, 0, "TOTAL PERMIT COST", fmt["lbl"])
    ws_p.write_formula(p_tot, 1, f"=SUM(B{p_start+1}:B{p_end+1})", fmt["calc_inr"])
    ws_p.write_formula(p_tot, 2, f"=SUM(C{p_start+1}:C{p_end+1})", fmt["calc_inr"])
    ws_p.write_formula(p_tot, 3, f"=C{p_tot+1}-B{p_tot+1}", fmt["calc_inr"])

    # ══════════════════════════════════════════════════════════════════════
    # SOV_CONSTRUCTION
    # ══════════════════════════════════════════════════════════════════════
    ws_s = wb.add_worksheet("SOV_CONSTRUCTION")
    ws_s.set_column("A:A", 32)
    ws_s.set_column("B:F", 16)
    ws_s.merge_range("A1:F1", "SCHEDULE OF VALUES - CONSTRUCTION (Trade-wise Budget)", fmt["title"])
    for c, h in enumerate(["Trade / Work Package", "Budget (INR)", "% of Const.",
                            "Planned Start", "Planned End", "Status"]):
        ws_s.write(2, c, h, fmt["hdr"])

    trades = [
        ("Site Development & Earthwork", 0.04, datetime(2026, 4, 1), datetime(2026, 6, 30)),
        ("RCC Structure (Foundation to Slab)", 0.28, datetime(2026, 5, 1), datetime(2027, 6, 30)),
        ("Masonry & Plastering", 0.12, datetime(2026, 10, 1), datetime(2027, 12, 31)),
        ("Electrical (Internal + External)", 0.10, datetime(2027, 1, 1), datetime(2028, 6, 30)),
        ("Plumbing & Sanitary", 0.08, datetime(2027, 1, 1), datetime(2028, 3, 31)),
        ("Flooring & Tiling", 0.09, datetime(2027, 7, 1), datetime(2028, 6, 30)),
        ("Doors, Windows & Aluminium", 0.07, datetime(2027, 4, 1), datetime(2028, 5, 31)),
        ("Painting (Internal + External)", 0.05, datetime(2028, 1, 1), datetime(2028, 8, 31)),
        ("HVAC / VRF (if applicable)", 0.04, datetime(2028, 2, 1), datetime(2028, 7, 31)),
        ("Landscaping & External Works", 0.05, datetime(2028, 4, 1), datetime(2028, 9, 30)),
        ("Elevator / Lift (if applicable)", 0.03, datetime(2027, 10, 1), datetime(2028, 6, 30)),
        ("Miscellaneous & Finishing", 0.05, datetime(2028, 3, 1), datetime(2028, 9, 30)),
    ]
    s_start = 3
    for i, (trade, pct, start, end) in enumerate(trades):
        r = s_start + i
        ws_s.write(r, 0, trade, fmt["txt"])
        ws_s.write_formula(r, 1, f"={C['const']}*{pct}", fmt["calc_inr"])
        ws_s.write(r, 2, pct, fmt["inp_pct"])
        ws_s.write_datetime(r, 3, start, fmt["date"])
        ws_s.write_datetime(r, 4, end, fmt["date"])
        ws_s.write(r, 5, "Planned", fmt["txt"])
    s_end = s_start + len(trades) - 1
    ws_s.write(s_end + 2, 0, "TOTAL SOV", fmt["lbl"])
    ws_s.write_formula(s_end + 2, 1, f"=SUM(B{s_start+1}:B{s_end+1})", fmt["calc_inr"])

    # ══════════════════════════════════════════════════════════════════════
    # SALES_REVENUE
    # ══════════════════════════════════════════════════════════════════════
    ws_r = wb.add_worksheet("SALES_REVENUE")
    ws_r.set_column("A:A", 22)
    ws_r.set_column("B:H", 14)
    ws_r.merge_range("A1:H1", "SALES & REVENUE - Unit Mix & Payment Collection", fmt["title"])

    ws_r.write("A3", "UNIT MIX", fmt["subtitle"])
    for c, h in enumerate(["Villa Type", "Units", "Price (INR)", "Revenue (INR)",
                            "Sold", "Unsold", "% Sold"]):
        ws_r.write(3, c, h, fmt["hdr"])
    for i in range(3):
        r = 4 + i
        src = mix_start + 1 + i
        ws_r.write_formula(r, 0, f"=ASSUMPTIONS!A{src+1}", fmt["txt"])
        ws_r.write_formula(r, 1, f"=ASSUMPTIONS!B{src+1}", fmt["calc"])
        ws_r.write_formula(r, 2, f"=ASSUMPTIONS!C{src+1}", fmt["calc_inr"])
        ws_r.write_formula(r, 3, f"=ASSUMPTIONS!D{src+1}", fmt["calc_inr"])
        ws_r.write(r, 4, 0, fmt["inp"])
        ws_r.write_formula(r, 5, f"=B{r+1}-E{r+1}", fmt["calc"])
        ws_r.write_formula(r, 6, f"=IF(B{r+1}=0,0,E{r+1}/B{r+1})", fmt["calc_pct"])
    ws_r.write(7, 0, "TOTAL", fmt["lbl"])
    ws_r.write_formula(7, 1, "=SUM(B5:B7)", fmt["calc"])
    ws_r.write_formula(7, 3, "=SUM(D5:D7)", fmt["calc_inr"])
    ws_r.write_formula(7, 4, "=SUM(E5:E7)", fmt["calc"])
    C["sales_rev"] = "SALES_REVENUE!$D$8"

    ws_r.write("A10", "PAYMENT COLLECTION BY QUARTER", fmt["subtitle"])
    for c, h in enumerate(["Quarter", "Period", "Booking", "Construction-Linked",
                            "Possession", "Total Collections", "Cumulative"]):
        ws_r.write(10, c, h, fmt["hdr"])

    quarters = [
        ("Q1 FY27", "Apr-Jun 2026"), ("Q2 FY27", "Jul-Sep 2026"), ("Q3 FY27", "Oct-Dec 2026"),
        ("Q4 FY27", "Jan-Mar 2027"), ("Q1 FY28", "Apr-Jun 2027"), ("Q2 FY28", "Jul-Sep 2027"),
        ("Q3 FY28", "Oct-Dec 2027"), ("Q4 FY28", "Jan-Mar 2028"), ("Q1 FY29", "Apr-Jun 2028"),
        ("Q2 FY29", "Jul-Sep 2028"),
    ]
    coll_w = [0.10, 0.12, 0.08, 0.10, 0.12, 0.12, 0.10, 0.10, 0.10, 0.06]
    q_start = 11
    for i, ((qn, period), w) in enumerate(zip(quarters, coll_w)):
        r = q_start + i
        ws_r.write(r, 0, qn, fmt["txt"])
        ws_r.write(r, 1, period, fmt["txt"])
        ws_r.write_formula(r, 2, f"={C['sales_rev']}*{w}*0.25", fmt["calc_inr"])
        ws_r.write_formula(r, 3, f"={C['sales_rev']}*{w}*0.60", fmt["calc_inr"])
        ws_r.write_formula(r, 4, f"={C['sales_rev']}*{w}*0.15", fmt["calc_inr"])
        ws_r.write_formula(r, 5, f"=SUM(C{r+1}:E{r+1})", fmt["calc_inr"])
        ws_r.write_formula(r, 6, f"=F{r+1}" if i == 0 else f"=G{r}+F{r+1}", fmt["calc_inr"])
    q_end = q_start + len(quarters) - 1

    # ══════════════════════════════════════════════════════════════════════
    # CASH_FLOW
    # ══════════════════════════════════════════════════════════════════════
    ws_c = wb.add_worksheet("CASH_FLOW")
    ws_c.set_column("A:A", 14)
    ws_c.set_column("B:K", 15)
    ws_c.merge_range("A1:K1", "QUARTERLY CASH FLOW WATERFALL - ROI / IRR / MOIC", fmt["title"])
    for c, h in enumerate(["Quarter", "Date", "Revenue Inflow", "Land Cost", "Construction",
                            "Permits", "SG&A", "Debt Drawdown", "Debt Service",
                            "Net Cash Flow", "Cumulative CF"]):
        ws_c.write(2, c, h, fmt["hdr"])

    cf_dates = [datetime(2026, 6, 30), datetime(2026, 9, 30), datetime(2026, 12, 31),
                datetime(2027, 3, 31), datetime(2027, 6, 30), datetime(2027, 9, 30),
                datetime(2027, 12, 31), datetime(2028, 3, 31), datetime(2028, 6, 30),
                datetime(2028, 9, 30)]
    land_w  = [0.50, 0.30, 0.10, 0.05, 0.05, 0, 0, 0, 0, 0]
    const_w = [0.02, 0.05, 0.08, 0.10, 0.12, 0.15, 0.15, 0.13, 0.12, 0.08]
    perm_w  = [0.20, 0.25, 0.20, 0.15, 0.10, 0.05, 0.05, 0, 0, 0]
    draw_w  = [0.05, 0.10, 0.12, 0.13, 0.15, 0.15, 0.12, 0.10, 0.05, 0.03]
    svc_w   = [0, 0, 0, 0, 0, 0.10, 0.15, 0.20, 0.30, 0.25]

    cf_start = 3
    for i, (qn, dt) in enumerate(zip([q[0] for q in quarters], cf_dates)):
        r = cf_start + i
        rev_row = q_start + i + 1
        ws_c.write(r, 0, qn, fmt["txt"])
        ws_c.write_datetime(r, 1, dt, fmt["date"])
        ws_c.write_formula(r, 2, f"=SALES_REVENUE!F{rev_row}", fmt["calc_inr"])
        ws_c.write_formula(r, 3, f"={C['land']}*{land_w[i]}", fmt["calc_inr"])
        ws_c.write_formula(r, 4, f"=({C['const']}+{C['cont_amt']})*{const_w[i]}", fmt["calc_inr"])
        ws_c.write_formula(r, 5, f"={C['perm_amt']}*{perm_w[i]}", fmt["calc_inr"])
        ws_c.write_formula(r, 6, f"=C{r+1}*{C['opex_pct']}", fmt["calc_inr"])
        ws_c.write_formula(r, 7, f"={C['debt_amt']}*{draw_w[i]}", fmt["calc_inr"])
        ws_c.write_formula(r, 8, f"={C['debt_amt']}*{C['int_rate']}/4*{svc_w[i]}", fmt["calc_inr"])
        ws_c.write_formula(r, 9,
            f"=C{r+1}+H{r+1}-D{r+1}-E{r+1}-F{r+1}-G{r+1}-I{r+1}", fmt["calc_inr"])
        ws_c.write_formula(r, 10, f"=J{r+1}" if i == 0 else f"=K{r}+J{r+1}", fmt["calc_inr"])
    cf_end = cf_start + len(quarters) - 1

    mr = cf_end + 3
    ws_c.write(mr, 0, "RETURNS METRICS", fmt["subtitle"])
    metrics = [
        ("Total Revenue",       f"=SUM(C{cf_start+1}:C{cf_end+1})", "calc_inr"),
        ("Total Project Cost",  f"={C['total_cost']}", "calc_inr"),
        ("Net Profit",          f"={C['net_profit']}", "calc_inr"),
        ("ROI (%)",             f"={C['net_profit']}/{C['total_cost']}", "calc_pct"),
        ("MOIC",                f"={C['sales_rev']}/{C['total_cost']}", "calc"),
        ("IRR (XIRR)",          f"=XIRR(J{cf_start+1}:J{cf_end+1},B{cf_start+1}:B{cf_end+1})", "calc_pct"),
        ("NPV",                 f"=NPV({C['discount']},J{cf_start+1}:J{cf_end+1})", "calc_inr"),
        ("DSCR (avg)",          f"=AVERAGE(IF(I{cf_start+1}:I{cf_end+1}=0,0,(C{cf_start+1}:C{cf_end+1}-G{cf_start+1}:G{cf_end+1})/I{cf_start+1}:I{cf_end+1}))", "calc"),
        ("LTV",                 f"={C['debt_amt']}/{C['sales_rev']}", "calc_pct"),
    ]
    for j, (label, formula, fkey) in enumerate(metrics):
        ws_c.write(mr + 1 + j, 0, label, fmt["lbl"])
        ws_c.write_formula(mr + 1 + j, 1, formula, fmt[fkey])

    C["cf_roi"]  = f"CASH_FLOW!$B${mr+4}"
    C["cf_moic"] = f"CASH_FLOW!$B${mr+5}"
    C["cf_irr"]  = f"CASH_FLOW!$B${mr+6}"
    C["cf_npv"]  = f"CASH_FLOW!$B${mr+7}"
    C["cf_dscr"] = f"CASH_FLOW!$B${mr+8}"
    C["cf_ltv"]  = f"CASH_FLOW!$B${mr+9}"
    C["cf_profit"] = f"CASH_FLOW!$B${mr+3}"

    # ══════════════════════════════════════════════════════════════════════
    # DASHBOARD
    # ══════════════════════════════════════════════════════════════════════
    ws_d = wb.add_worksheet("DASHBOARD")
    ws_d.set_column("A:A", 2)
    ws_d.set_column("B:E", 20)
    ws_d.set_column("F:I", 20)
    ws_d.merge_range("B2:I2", "VILLA CONSTRUCTION - EXECUTIVE DASHBOARD", fmt["title"])
    ws_d.write("B3", "Hyderabad Telangana  |  50 Villas  |  Apr 2026 - Sep 2028", fmt["note"])

    ws_d.merge_range("B5:E5", "CEO VIEW - Project Overview", fmt["subtitle"])
    for i, (label, formula, fkey) in enumerate([
        ("Total Revenue", C["sales_rev"], "calc_inr"),
        ("Total Project Cost", C["total_cost"], "calc_inr"),
        ("Net Profit", C["cf_profit"], "calc_inr"),
        ("Gross Margin %", f"={C['cf_profit']}/{C['sales_rev']}", "calc_pct"),
        ("Units Sold", "=SALES_REVENUE!E8", "calc"),
        ("Units Remaining", "=SALES_REVENUE!B8-SALES_REVENUE!E8", "calc"),
    ]):
        ws_d.write(6 + i, 1, label, fmt["kpi_lbl"])
        ws_d.write_formula(6 + i, 2, formula, fmt[fkey])

    ws_d.merge_range("F5:I5", "CFO VIEW - Financial Returns", fmt["subtitle"])
    for i, (label, formula, fkey) in enumerate([
        ("ROI", C["cf_roi"], "kpi_pct"),
        ("IRR (XIRR)", C["cf_irr"], "kpi_pct"),
        ("MOIC", C["cf_moic"], "kpi_val"),
        ("NPV", C["cf_npv"], "calc_inr"),
        ("DSCR", C["cf_dscr"], "kpi_val"),
        ("LTV", C["cf_ltv"], "kpi_pct"),
    ]):
        ws_d.write(6 + i, 6, label, fmt["kpi_lbl"])
        ws_d.write_formula(6 + i, 7, formula, fmt.get(fkey, fmt["kpi_val"]))

    ws_d.merge_range("B14:E14", "TARGET vs ACTUAL", fmt["subtitle"])
    ws_d.write("B15", "Metric", fmt["hdr"])
    ws_d.write("C15", "Target", fmt["hdr"])
    ws_d.write("D15", "Actual", fmt["hdr"])
    ws_d.write("E15", "Status", fmt["hdr"])
    for i, (metric, tgt, act, pct) in enumerate([
        ("ROI",  C["tgt_roi"],  C["cf_roi"],  True),
        ("IRR",  C["tgt_irr"],  C["cf_irr"],  True),
        ("MOIC", C["tgt_moic"], C["cf_moic"], False),
    ]):
        r = 15 + i
        ws_d.write(r, 1, metric, fmt["lbl"])
        ws_d.write_formula(r, 2, tgt, fmt["calc_pct"] if pct else fmt["calc"])
        ws_d.write_formula(r, 3, act, fmt["calc_pct"] if pct else fmt["calc"])
        ws_d.write_formula(r, 4, f'=IF(D{r+1}>=C{r+1},"On Track","Below Target")', fmt["txt"])

    chart_rev = wb.add_chart({"type": "column"})
    chart_rev.add_series({"name": "Revenue Inflow",
        "categories": f"=CASH_FLOW!$A${cf_start+1}:$A${cf_end+1}",
        "values": f"=CASH_FLOW!$C${cf_start+1}:$C${cf_end+1}", "fill": {"color": BLUE}})
    chart_rev.add_series({"name": "Construction Cost",
        "categories": f"=CASH_FLOW!$A${cf_start+1}:$A${cf_end+1}",
        "values": f"=CASH_FLOW!$E${cf_start+1}:$E${cf_end+1}", "fill": {"color": RED}})
    chart_rev.set_title({"name": "Quarterly Revenue vs Construction Spend"})
    chart_rev.set_y_axis({"num_format": INR})
    chart_rev.set_size({"width": 520, "height": 300})
    ws_d.insert_chart("B19", chart_rev)

    chart_cf = wb.add_chart({"type": "line"})
    chart_cf.add_series({"name": "Cumulative Cash Flow",
        "categories": f"=CASH_FLOW!$A${cf_start+1}:$A${cf_end+1}",
        "values": f"=CASH_FLOW!$K${cf_start+1}:$K${cf_end+1}",
        "line": {"color": GREEN, "width": 2.5}, "marker": {"type": "circle", "size": 5}})
    chart_cf.set_title({"name": "Cumulative Cash Flow"})
    chart_cf.set_y_axis({"num_format": INR})
    chart_cf.set_size({"width": 520, "height": 300})
    ws_d.insert_chart("F19", chart_cf)

    chart_mix = wb.add_chart({"type": "pie"})
    chart_mix.add_series({"name": "Unit Mix Revenue",
        "categories": "=SALES_REVENUE!$A$5:$A$7",
        "values": "=SALES_REVENUE!$D$5:$D$7"})
    chart_mix.set_title({"name": "Revenue by Villa Type"})
    chart_mix.set_size({"width": 400, "height": 300})
    ws_d.insert_chart("B36", chart_mix)

    chart_sov = wb.add_chart({"type": "bar"})
    chart_sov.add_series({"name": "Trade Budget",
        "categories": f"=SOV_CONSTRUCTION!$A${s_start+1}:$A${s_end+1}",
        "values": f"=SOV_CONSTRUCTION!$B${s_start+1}:$B${s_end+1}",
        "fill": {"color": GOLD}})
    chart_sov.set_title({"name": "Construction SOV by Trade"})
    chart_sov.set_size({"width": 520, "height": 350})
    ws_d.insert_chart("F36", chart_sov)

    # ══════════════════════════════════════════════════════════════════════
    # CEO_CFO_REPORT
    # ══════════════════════════════════════════════════════════════════════
    ws_e = wb.add_worksheet("CEO_CFO_REPORT")
    ws_e.set_column("A:A", 35)
    ws_e.set_column("B:D", 22)
    ws_e.merge_range("A1:D1", "CEO & CFO EXECUTIVE SUMMARY REPORT", fmt["title"])
    ws_e.write("A2", "Villa Construction Financial Model  |  Hyderabad, Telangana", fmt["note"])

    report = [
        ("PROJECT SNAPSHOT", [
            ("Project", "50 Luxury Villas - 3 Floors Each"),
            ("Location", "Hyderabad, Telangana"),
            ("Duration", "30 Months (Apr 2026 - Sep 2028)"),
            ("Total Built-up", f"={C['total_bua']}&\" sq.ft\""),
            ("Total Villas", f"={C['villas']}"),
        ]),
        ("FINANCIAL HIGHLIGHTS", [
            ("Total Revenue", f"={C['sales_rev']}"),
            ("Total Project Cost", f"={C['total_cost']}"),
            ("Land Cost", f"={C['land']}"),
            ("Construction Cost", f"={C['const']}"),
            ("Contingency", f"={C['cont_amt']}"),
            ("Permits & Approvals", "=PERMITS!$B$21"),
            ("Net Profit (after tax)", f"={C['net_profit']}"),
        ]),
        ("RETURNS ANALYSIS", [
            ("ROI", f"={C['cf_roi']}"),
            ("IRR (XIRR)", f"={C['cf_irr']}"),
            ("MOIC", f"={C['cf_moic']}"),
            ("NPV @ Discount Rate", f"={C['cf_npv']}"),
            ("DSCR (Average)", f"={C['cf_dscr']}"),
            ("LTV Ratio", f"={C['cf_ltv']}"),
        ]),
        ("FINANCING STRUCTURE", [
            ("Total Debt", f"={C['debt_amt']}"),
            ("Equity", f"={C['equity']}"),
            ("Debt / Equity Ratio", f"={C['debt_amt']}/{C['equity']}"),
            ("Interest Rate", f"={C['int_rate']}"),
            ("Loan Tenor", f"={C['tenor']}&\" years\""),
        ]),
        ("PERMITS STATUS (TSSPDCL / GHMC / RERA)", [
            ("GHMC Building Permission", "=PERMITS!$E$4"),
            ("RERA Registration", "=PERMITS!$E$5"),
            ("Fire NOC", "=PERMITS!$E$6"),
            ("TSSPDCL Electricity (LT)", "=PERMITS!$E$7"),
            ("TSSPDCL Electricity (HT)", "=PERMITS!$E$8"),
            ("Transformer Sub-station", "=PERMITS!$E$9"),
            ("Total Permit Budget", "=PERMITS!$B$21"),
        ]),
        ("RISK & RECOMMENDATIONS", [
            ("Pre-sales Target", "Achieve 25 villa bookings by Month 12 (50%)"),
            ("Cost Overrun Buffer", f"={C['cont_amt']}"),
            ("Permit Timeline Risk", "Monitor GHMC + TSSPDCL lead times (90-120 days)"),
            ("Interest Rate Sensitivity", "+100bps reduces IRR by approx 1.2%"),
            ("Go / No-Go", "Proceed if IRR > 18% and 40% pre-sales by Month 18"),
        ]),
    ]

    rpt = 4
    inr_labels = {"Revenue", "Cost", "Profit", "Debt", "Equity", "NPV", "Permit", "Buffer", "Contingency"}
    pct_labels = {"ROI", "IRR", "LTV", "Rate", "Ratio"}
    for section_title, items in report:
        ws_e.merge_range(rpt, 0, rpt, 3, section_title, fmt["subtitle"])
        rpt += 1
        ws_e.write(rpt, 0, "Item", fmt["hdr"])
        ws_e.write(rpt, 1, "Value", fmt["hdr"])
        rpt += 1
        for label, val in items:
            ws_e.write(rpt, 0, label, fmt["lbl"])
            if isinstance(val, str) and val.startswith("="):
                if any(k in label for k in pct_labels):
                    ws_e.write_formula(rpt, 1, val, fmt["calc_pct"])
                elif any(k in label for k in inr_labels):
                    ws_e.write_formula(rpt, 1, val, fmt["calc_inr"])
                else:
                    ws_e.write_formula(rpt, 1, val, fmt["calc"])
            else:
                ws_e.write(rpt, 1, val, fmt["txt"])
            rpt += 1
        rpt += 1

    # Tab order: DASHBOARD first
    ws_d.activate()
    order = {"DASHBOARD": 0, "ASSUMPTIONS": 1, "PERMITS": 2, "SOV_CONSTRUCTION": 3,
             "SALES_REVENUE": 4, "CASH_FLOW": 5, "CEO_CFO_REPORT": 6}
    wb.worksheets_objs.sort(key=lambda ws: order.get(ws.name, 99))

    wb.close()
    print(f"Created: {OUTPUT}")
    print(f"Size: {OUTPUT.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
