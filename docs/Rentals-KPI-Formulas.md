# Rentals KPI Formula Sheet

Reference for KPI calculations across **Rental Overview**, **Financials KPI Dashboard**, **CFO Dashboard**, and **CFO Portfolio**.

---

## A) Rental Overview (operational dashboard)

**Data source:** unit registry, invoices, collections, expenses, QB AR Aging upload

| Card Label | Formula |
|---|---|
| **Occupancy Rate** | `Occupied Units ÷ Total Units × 100` |
| **Occupied / Vacant** | `Occupied Units` and `Vacant Units` (vacant = total − occupied) |
| **Collected This Month** | Sum of collections where `collected_date` = selected month |
| **NOI This Month** | `Collected This Month − Total Expense This Month` |
| **Gross Potential Rent** | Sum of all unit `monthly_rent` |
| **Vacancy Loss** | Sum of `monthly_rent` for units with status = `vacant` only |
| **Collection Rate** | `Collected This Month ÷ Billed This Month × 100` |
| **Avg Rent / Unit** | `Gross Potential Rent ÷ Occupied Units` |
| **Arrears Days Outstanding** | Weighted DSO from QB aging buckets: `(Current×0 + 1–30×15 + 31–60×45 + 61–90×75 + 90+×105) ÷ Total` |
| **Vacant > 30 Days** | `NA` (vacancy date not tracked yet) |
| **NOI Margin** | `NOI This Month ÷ Collected This Month × 100` |
| **Best / Worst (Occ.)** | Highest and lowest company occupancy % |
| **Arrears Outstanding** | Sum of `max(0, Billed − Collected)` per invoice |
| **Partner Share Payable** | `NOI × ownership %` for limited/silent partners (only if NOI > 0) |

### AR section (Overview)

| Item | Formula |
|---|---|
| **Arrears Aging buckets** | Unpaid amount per invoice aged from billing month due date (1st of month) into Current / 1–30 / 31–60 / 61–90 / 90+ |
| **Top Risk Companies** | Ranked by `Arrears + Vacancy Loss`; flagged if arrears > $2k, occupancy < 85%, or high arrears |
| **Company filter** | Uses per-company QB aging totals when uploaded |

**Backend reference:** `backend/services/rental_calculations.py` (`company_summary`, `arrears_aging`, `unit_arrears`)

---

## B) Financials → KPI Dashboard (P&L / Balance Sheet)

**Data source:** uploaded QuickBooks financials (`CASH_FLOWS.xlsx`)  
**Frontend reference:** `frontend/src/utils/rentalKpiEngine.ts`, `frontend/src/pages/RentalFinancials.tsx` (KPITab)

### Base inputs (from P&L / BS)

| Input | Formula |
|---|---|
| **Total Revenue** | `Total Income` row, else sum of income/revenue/rent lines |
| **Total Expenses** | `Total Expenses` row |
| **Net Income** | `Net Income` row |
| **NOI** | `Net Operating Income` row, else `Total Revenue − Total Expenses + Interest Expense` |
| **Interest Expense** | Interest paid lines (absolute value) |
| **Rental Income** | Rental income / services lines |
| **Management Fee** | Management fee lines |
| **Repairs** | Repair / maintenance / cleaning lines |
| **Buildings** | Buildings / property & equipment from balance sheet |
| **Long-term Loans** | Long-term liabilities / loan accounts |
| **Cash** | Total bank accounts |
| **Total Assets / Liabilities / Equity** | Balance sheet totals |

### Profitability KPIs

| Card Label | Formula | Target |
|---|---|---|
| **NOI Margin** | `NOI ÷ Total Revenue × 100` | > 40% |
| **Net Income Margin** | `Net Income ÷ Total Revenue × 100` | > 10% |
| **Revenue Growth YoY** | `(Current Revenue − Prior Revenue) ÷ Prior Revenue × 100` | > 3% |
| **Expense Ratio** | `Total Expenses ÷ Total Revenue × 100` | < 70% |

### Rental performance KPIs

| Card Label | Formula | Target |
|---|---|---|
| **Rental Income %** | `Rental Income ÷ Total Revenue × 100` | > 80% |
| **Interest Coverage** | `NOI ÷ Interest Expense` | > 2.0x |
| **Mgmt Fee %** | `Management Fee ÷ Total Revenue × 100` | < 10% |
| **Repair % of Revenue** | `Repairs ÷ Total Revenue × 100` | < 5% |

### Balance sheet KPIs

| Card Label | Formula | Target |
|---|---|---|
| **LTV (Loans / Building)** | `Long-term Loans ÷ Buildings × 100` | < 75% |
| **Asset / Liability Ratio** | `Total Assets ÷ Total Liabilities` | > 1.5x |
| **Debt-to-Equity** | `Total Liabilities ÷ Equity` | < 2.0x |
| **Cash Balance** | Bank account total from balance sheet | > $10K |
| **Debt-to-Asset %** | `Total Liabilities ÷ Total Assets × 100` | < 80% |
| **Equity Ratio %** | `Equity ÷ Total Assets × 100` | > 20% |
| **Net Debt** | `Long-term Loans − Cash` | Monitor |
| **DSCR (Est.)** | `NOI ÷ (Interest Expense × 1.2)` | > 1.25x |

### Occupancy KPIs (when ops data is linked)

| Card Label | Formula | Target |
|---|---|---|
| **Occupancy Rate** | From registry occupancy % | > 95% |
| **Economic Occupancy / Rent Collection Rate** | `Collected ÷ Billed × 100` | > 95% |
| **Vacancy Rate** | `100 − Occupancy Rate` | < 5% |
| **Cap Rate** | `NOI ÷ Buildings × 100` | > 5% |
| **Revenue per Unit** | `Total Revenue ÷ Total Units` | Trend |
| **Expense per Unit** | `Total Expenses ÷ Total Units` | Trend |

---

## C) CFO Dashboard (Financial Overview — P&L charts)

**Data source:** first company’s uploaded financials  
**Route:** Rentals → CFO Dashboard  
**Frontend reference:** `frontend/src/pages/RentalCfoDashboard.tsx`

| Metric / Chart | Formula |
|---|---|
| **Revenue** | `Total Revenue` or sum of revenue/rental income lines |
| **Expenses** | Sum of expense lines |
| **Net Income** | `Net Income` row |
| **Net Margin** | `Net Income ÷ Revenue × 100` |
| **Expense Ratio Trend** | `Expenses ÷ Revenue × 100` by year |
| **Cash (Bank)** | `Total Bank Accounts` from balance sheet |
| **Net Income Trajectory** | Net Income by year |
| **Latest Net Income change** | `(Latest NI − Prior NI) ÷ \|Prior NI\| × 100` |
| **Avg Profit Margin** | Average of yearly `(Net Income ÷ Revenue × 100)` |

---

## D) CFO Portfolio (strategic portfolio view)

**Data source:** companies, expenses, units, loans, portfolio summary  
**Route:** Rentals → CFO Portfolio  
**Frontend reference:** `frontend/src/pages/rental/RentalCfoPortfolio.tsx`, `frontend/src/hooks/useRentalCfoData.ts`

### Top KPI tiles

| Card Label | Formula |
|---|---|
| **NOI** | `Collected This Month − Total Expenses` (filtered companies) |
| **Occupancy** | `Occupied Units ÷ Total Units` |
| **Collection Rate** | `Collected ÷ Billed` |
| **Expense Ratio** | `Total Expenses ÷ Gross Potential Rent` |
| **DSCR** | `(NOI × 12) ÷ (Total Monthly EMI × 12)` |
| **Cash Position** | `NOI − Total Monthly EMI` |
| **Rent Growth** | Currently static placeholder (`+2.4%`) |
| **Vacancy Cost** | Portfolio `vacancy_loss` |

### Portfolio Health Score (out of 100)

| Component | Max Points | Formula |
|---|---|---|
| **Occupancy** | 25 | `min(25, Occupancy % × 25)` |
| **Collections** | 25 | `min(25, Collection Rate × 25)`; if no billing data → 15 |
| **Expense Control** | 25 | 25 if expense ratio < 30%; 18 if < 45%; else 10 |
| **Debt Coverage** | 25 | 25 if DSCR > 1.25; 18 if ≥ 1.0; 12 if no loan data; else 8 |

**Total Health Score** = sum of the 4 components (averaged across filtered companies)

### Company Comparison Matrix

| Column | Formula |
|---|---|
| **Occupancy** | Company occupancy % |
| **NOI** | `Collected − Expenses` for the month |
| **Exp Ratio** | `Expenses ÷ Gross Potential Rent` |
| **DSCR** | `(NOI × 12) ÷ (Company EMI × 12)` |
| **Cash** | `NOI − Company EMI` |
| **Score** | Same health score formula above |
| **Flag** | Score < 70 or DSCR < 1.0 |

### Building-level (Building Expenses view)

| Metric | Formula |
|---|---|
| **Rent Income** | `Collected` (or GPR if no collection) |
| **Total Expenses** | Sum of building expenses for current month |
| **NOI** | `Rent Income − Total Expenses` |
| **Expense Ratio** | `Total Expenses ÷ Rent Income` |
| **NOI Margin** | `NOI ÷ Rent Income` |
| **Status** | Healthy if ratio < 30%; Watch if ≤ 45%; High if > 45% |

---

## G) Financial Ratios page

**Route:** Rentals → Financial Ratios  
**Frontend reference:** `frontend/src/pages/rental/RentalFinancialRatios.tsx`

### Profitability ratios

| Ratio | Formula | Benchmark |
|---|---|---|
| **NOI Margin** | `NOI ÷ Revenue × 100` | > 35% |
| **Net Profit Margin** | `Net Income ÷ Revenue × 100` | > 10% |
| **Operating Expense Ratio** | `Total OpEx ÷ Revenue × 100` | < 60% |
| **EBITDA Margin** | `EBITDA ÷ Revenue × 100` | > 45% |
| **Return on Assets (ROA)** | `Net Income ÷ Total Assets × 100` | > 4% |
| **Return on Equity (ROE)** | `Net Income ÷ Equity × 100` | > 8% |
| **Gross Rent Multiple** | `Asset Value ÷ Annual Revenue` | < 14x |
| **Cash-on-Cash Return** | `Pre-tax Cash Flow ÷ Equity × 100` | > 7% |

Where:
- `NOI = Revenue − Expenses + Interest Expense`
- `EBITDA = NOI + Depreciation + Amortization`

### Liquidity ratios

| Ratio | Formula | Benchmark |
|---|---|---|
| **Current Ratio** | `Current Assets ÷ Current Liabilities` | > 1.5x |
| **Quick Ratio** | `(Current Assets − Inventory) ÷ Current Liabilities` | > 1.0x |
| **Cash Ratio** | `Cash & Bank ÷ Current Liabilities` | > 0.2x |
| **Operating CF Ratio** | `Operating Cash Flow ÷ Current Liabilities` | > 1.0x |
| **Working Capital** | `Current Assets − Current Liabilities` | Positive |
| **Days Cash on Hand** | `Cash ÷ (Annual OpEx ÷ 365)` | > 60 days |

### Solvency / leverage ratios

| Ratio | Formula | Benchmark |
|---|---|---|
| **Debt-to-Equity** | `Total Liabilities ÷ Equity` | < 5x (RE) |
| **Debt-to-Asset** | `Total Liabilities ÷ Total Assets × 100` | < 80% |
| **Equity Ratio** | `Equity ÷ Total Assets × 100` | > 20% |
| **Interest Coverage** | `NOI ÷ Interest Expense` | > 1.5x |
| **LTV** | `Mortgage / Long-term Loans ÷ Property Value (Buildings) × 100` | < 80% |
| **Net Debt** | `Long-term Loans − Cash` | Monitor |
| **DSCR** | `NOI ÷ Total Debt Service` (est: `NOI ÷ Interest × 1.2`) | > 1.25x |
| **Debt Service Ratio** | `Debt Service ÷ NOI × 100` | < 65% |
| **Fixed Charge Coverage** | `(NOI + Fixed Charges) ÷ Fixed Charges` | > 1.25x |

### Occupancy & pricing ratios

| Ratio | Formula | Benchmark |
|---|---|---|
| **Occupancy Rate** | `Occupied Units ÷ Total Units × 100` | > 90% |
| **Economic Occupancy** | `Rent Collected ÷ Gross Potential × 100` | > 92% |
| **Rent Collection Rate** | `Collected ÷ Billed × 100` | > 95% |
| **Vacancy Rate** | `Vacant Units ÷ Total Units × 100` | < 10% |
| **Loss to Lease** | `(Market Rent − Actual Rent) ÷ Market Rent × 100` | < 5% |
| **Avg Days Vacant** | Average days between tenants | < 21–30 days |
| **Rent per Sq Ft** | `Average Rent ÷ Average Sq Ft` | Market |
| **Revenue per Unit** | `Total Revenue ÷ Total Units` | Trend |
| **Expense per Unit** | `Total OpEx ÷ Occupied Units` | < $1,000/mo |
| **Cap Rate** | `NOI ÷ Property Value × 100` | 4–6% (market) |
| **Price / Rent Ratio** | `Property Value ÷ Annual Rent` | < 20x |
| **EGIM** | `Property Value ÷ Effective Gross Income` | < 12x |

### Returns / cost of capital

| Ratio | Formula |
|---|---|
| **WACC** | Weighted average cost of debt and equity |
| **Cost of Debt** | `Interest Expense ÷ Total Debt × 100` |
| **Cost of Equity** | Required return on equity (CAPM estimate) |
| **Return vs WACC** | `Portfolio Return − WACC` |
| **Spread (Cap − WACC)** | `Cap Rate − WACC` |

---

## H) AR Dashboard

**Route:** Rentals → AR Dashboard  
**Frontend reference:** `frontend/src/pages/RentalArDashboard.tsx`

| KPI | Formula |
|---|---|
| **Total Billed / Month** | Sum of billed rent from registry (occupied units) |
| **Collected (Latest Mo)** | Sum of Rent Receivable collections for selected month |
| **Outstanding AR** | `Billed − Collected` (open balance) |
| **Collection Rate** | `Collected ÷ Billed × 100` |
| **Vacancy Loss / Month** | Sum of rent for vacant/notice units from registry |
| **Zero-Pay Companies** | Companies with billed > 0 and collected = 0 |
| **Partial-Pay Companies** | `0 < Collected < Billed` |
| **Month-End Shortfall** | `Billed − Collected` for selected month |
| **Occupied — Billing Gap** | Occupied units with vs without billing data |
| **Top 5 by Outstanding AR** | Companies ranked by highest open AR |
| **DSO (Arrears Days)** | Weighted bucket formula (same as Overview) |

**Collection detail table (per company × month):**
- **Billed** = registry occupied-unit rent
- **Collected** = Rent Receivable upload (or P&L fallback)
- **Outstanding** = `Billed − Collected`
- **Rate** = `Collected ÷ Billed × 100`
- **Status:** Zero-Pay (0%), Partial (<100%), Paid (≥95%), Low (<85%)

---

## I) Quick reference — core definitions

```
Occupancy %     = Occupied Units / Total Units
Collection Rate = Collected / Billed
NOI (Ops)       = Collected − Expenses
NOI (Financial) = Revenue − Expenses + Interest
Vacancy Loss    = Rent from vacant units only
Arrears         = Sum of (Billed − Collected), minimum 0
DSCR            = Annual NOI / Annual Debt Service (EMI × 12)
```

---

## J) Code locations

| Area | Primary files |
|---|---|
| Operational KPIs (backend) | `backend/services/rental_calculations.py`, `backend/routers/rentals/router.py` |
| Overview UI | `frontend/src/pages/RentalOverview.tsx` |
| Financial KPI engine | `frontend/src/utils/rentalKpiEngine.ts` |
| Financials KPI tab | `frontend/src/pages/RentalFinancials.tsx` |
| CFO Dashboard | `frontend/src/pages/RentalCfoDashboard.tsx` |
| CFO Portfolio | `frontend/src/pages/rental/RentalCfoPortfolio.tsx` |
| CFO data hook | `frontend/src/hooks/useRentalCfoData.ts` |
| Financial Ratios | `frontend/src/pages/rental/RentalFinancialRatios.tsx` |
| Executive Summary / PPT export | `frontend/src/utils/executiveSummaryPpt.ts`, `frontend/src/utils/gatherExecutiveExportData.ts` |

---

*Last updated: July 2026*
