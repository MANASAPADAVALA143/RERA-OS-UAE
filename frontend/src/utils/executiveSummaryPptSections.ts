/**
 * Section-scoped data for CEO Board Review PPT — mirrors live app pages (single source of truth).
 */
import type { LoanRow, PortfolioSummary, CompanyRow } from '../hooks/useRentalCfoData';
import type { QBAgingLatest } from '../components/rental/QbArAgingUploadPanel';
import {
  creditBalanceFromBuckets,
  estimateDsoFromBuckets,
  flooredBucketsForChart,
  overdue30PlusFromBuckets,
  overdue60PlusFromBuckets,
  overdue90PlusFromBuckets,
} from '../components/rental/QbArAgingUploadPanel';
import type { FinRow } from './executiveSummaryFinRows';
import {
  aggregateKpiDataList,
  calcKpis,
  calcKpisFromMonthlyKey,
  debtRatiosFromLoanTracker,
  fmtKpiCurrency,
  fmtKpiPct,
  fmtKpiX,
  getAvailableKeys,
  type KpiData,
  type ParsedFinancials,
} from './rentalKpiEngine';
import { buildYearSnapshots, expensePieFromKpi, type YearSnapshot } from './cfoMultiYearTrendData';
import { getTrailingMonthKeys } from './periodWindow';

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return 'Data not available';
  if (n === 0) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : 'Data not available';
}

const REVENUE_CATS = new Set(['rental income', 'services', 'other income', 'income']);

function isRevenueLine(row: FinRow): boolean {
  const cat = (row.category ?? '').toLowerCase();
  const acct = row.account.toLowerCase();
  if (REVENUE_CATS.has(cat)) return true;
  return acct.startsWith('rent') || acct.includes('rental income');
}

function monthSortKey(m: string): number {
  const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [mon, yr] = m.split(/[\s-]/);
  return (Number(yr) || 0) * 100 + (MNAMES.indexOf(mon) + 1);
}

export interface IncomeStatementSection {
  available: boolean;
  sourceNote: string;
  latestRevenue: string;
  latestExpenses: string;
  latestNoi: string;
  monthlyTrend: { month: string; revenue: number; expenses: number; noi: number }[];
  expenseCategories: { name: string; value: number }[];
  yearSnapshots: YearSnapshot[];
}

export interface BalanceSheetSection {
  available: boolean;
  sourceNote: string;
  totalAssets: string;
  totalLiabilities: string;
  equity: string;
  cashBalance: string;
  debtToEquity: string;
  debtToAsset: string;
  assetComposition: { name: string; value: number }[];
  capitalStructure: { name: string; value: number }[];
}

export interface CashFlowSection {
  available: boolean;
  sourceNote: string;
  operatingCf: string;
  financingCf: string;
  investingCf: string;
  cashTrend: { month: string; cash: number }[];
  operatingVsFinancing: { month: string; operating: number; financing: number }[];
}

export interface RentalPortfolioSection {
  available: boolean;
  sourceNote: string;
  occupancy: string;
  collected: string;
  collectionRate: string;
  vacancyLoss: string;
  arOutstanding: string;
  noiMargin: string;
  gprTrend: { month: string; gpr: number; collected: number; occupancy: number | null }[];
}

export interface ExpensesSection {
  available: boolean;
  sourceNote: string;
  trendEndLabel: string;
  trend6Mo: { month: string; amount: number }[];
  breakdown: { name: string; value: number }[];
}

export interface ArDashboardSection {
  available: boolean;
  sourceNote: string;
  dso: string;
  overdue30: string;
  overdue60: string;
  overdue90: string;
  creditBalance: string;
  agingChart: { label: string; amount: number }[];
}

/** Monthly P&L trend — NOI uses interest add-back (Financials KPI engine). */
export function buildIncomeStatementSection(
  fins: ParsedFinancials[],
  month: number,
  year: number,
): IncomeStatementSection {
  if (!fins.length) {
    return {
      available: false,
      sourceNote: 'Data not available — see Rentals → Financials',
      latestRevenue: 'Data not available',
      latestExpenses: 'Data not available',
      latestNoi: 'Data not available',
      monthlyTrend: [],
      expenseCategories: [],
      yearSnapshots: [],
    };
  }

  const keys = getTrailingMonthKeys(month, year, 12);
  const monthlyTrend = keys.map(key => {
    const views = fins
      .map(f => (getAvailableKeys(f).includes(key) ? calcKpisFromMonthlyKey(f, key) : null))
      .filter((v): v is KpiData => v !== null);
    const k = views.length ? aggregateKpiDataList(views) : null;
    return {
      month: key.split(' ')[0],
      revenue: k?.totalRevenue ?? 0,
      expenses: k?.totalExpenses ?? 0,
      noi: k?.noi ?? 0,
    };
  }).filter(r => r.revenue > 0 || r.expenses > 0 || r.noi !== 0);

  const latestKey = keys[keys.length - 1];
  const latestViews = fins
    .map(f => (getAvailableKeys(f).includes(latestKey) ? calcKpisFromMonthlyKey(f, latestKey) : null))
    .filter((v): v is KpiData => v !== null);
  const latestK = latestViews.length ? aggregateKpiDataList(latestViews) : null;

  const selYear = fins[0]?.years.includes(year) ? year : fins[0]?.years[fins[0].years.length - 1];
  const annualK = selYear
    ? aggregateKpiDataList(
        fins.filter(f => f.years.includes(selYear)).map(f => calcKpis(f, selYear)),
      )
    : null;

  const pieK = annualK ?? latestK;
  const expenseCategories = pieK ? expensePieFromKpi(pieK) : [];

  return {
    available: Boolean(latestK || monthlyTrend.length),
    sourceNote: 'Rentals → Financials · P&L (NOI = Revenue − Expenses + Interest Paid)',
    latestRevenue: latestK ? fmtKpiCurrency(latestK.totalRevenue) : 'Data not available',
    latestExpenses: latestK ? fmtKpiCurrency(latestK.totalExpenses) : 'Data not available',
    latestNoi: latestK ? fmtKpiCurrency(latestK.noi) : 'Data not available',
    monthlyTrend,
    expenseCategories,
    yearSnapshots: buildYearSnapshots(fins),
  };
}

export function buildBalanceSheetSection(
  k: KpiData | null,
  totalDebt: number | null,
  scopedLoans: LoanRow[],
): BalanceSheetSection {
  if (!k || k.totalAssets <= 0) {
    return {
      available: false,
      sourceNote: 'Data not available — see Rentals → Financials → Balance Sheet',
      totalAssets: 'Data not available',
      totalLiabilities: 'Data not available',
      equity: 'Data not available',
      cashBalance: 'Data not available',
      debtToEquity: 'N/A — no loan data',
      debtToAsset: 'N/A — no loan data',
      assetComposition: [],
      capitalStructure: [],
    };
  }

  const { debtToEquity, debtToAsset } = debtRatiosFromLoanTracker(
    scopedLoans.length > 0 ? (totalDebt ?? 0) : null,
    k,
  );

  const assetComposition = [
    { name: 'Buildings', value: k.buildings },
    { name: 'Cash', value: k.cash },
    { name: 'Other Assets', value: Math.max(0, k.totalAssets - k.buildings - k.cash) },
  ].filter(a => a.value > 0);

  const capitalStructure = [
    ...(totalDebt != null && totalDebt > 0 ? [{ name: 'Total Debt (Loans)', value: totalDebt }] : []),
    { name: 'Equity', value: Math.max(0, k.equity) },
    { name: 'Other Liabilities', value: Math.max(0, k.totalLiabilities - (totalDebt ?? 0)) },
  ].filter(a => a.value > 0);

  return {
    available: true,
    sourceNote: 'Rentals → Financials · Balance Sheet · Debt ratios from Loan Tracker',
    totalAssets: fmtKpiCurrency(k.totalAssets),
    totalLiabilities: fmtKpiCurrency(k.totalLiabilities),
    equity: fmtKpiCurrency(k.equity),
    cashBalance: fmtKpiCurrency(k.cash),
    debtToEquity: debtToEquity != null ? fmtKpiX(debtToEquity, 1) : 'N/A — no loan data',
    debtToAsset: debtToAsset != null ? fmtKpiPct(debtToAsset) : 'N/A — no loan data',
    assetComposition,
    capitalStructure,
  };
}

function sumCfLine(fins: ParsedFinancials[], pat: RegExp, key: string): number {
  let sum = 0;
  for (const fin of fins) {
    for (const item of fin.cf) {
      if (!pat.test(item.label)) continue;
      const v = item.monthlyValues?.[key] ?? item.values[Object.keys(item.values).map(Number).sort((a, b) => b - a)[0] ?? 0] ?? 0;
      sum += v;
    }
  }
  return sum;
}

export function buildCashFlowSection(
  fins: ParsedFinancials[],
  arData: { month: string; collected: number }[],
  loans: LoanRow[],
  month: number,
  year: number,
  cashTrend: { month: string; cash: number }[],
): CashFlowSection {
  const keys = getTrailingMonthKeys(month, year, 12);
  const latestKey = keys[keys.length - 1];
  const monthlyEmi = loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0);

  let ocf = sumCfLine(fins, /operating/i, latestKey);
  let fcf = sumCfLine(fins, /financing/i, latestKey);
  let icf = sumCfLine(fins, /investing/i, latestKey);
  let fromCfStatement = fins.some(f => f.cf.length > 0) && (ocf !== 0 || fcf !== 0 || icf !== 0);

  if (!fromCfStatement) {
    const ar = arData.find(a => a.month === latestKey);
    ocf = ar?.collected ?? 0;
    fcf = monthlyEmi > 0 ? -monthlyEmi : 0;
    icf = 0;
  }

  const operatingVsFinancing = keys.map(key => {
    const ar = arData.find(a => a.month === key);
    const op = fromCfStatement ? sumCfLine(fins, /operating/i, key) : (ar?.collected ?? 0);
    const fin = fromCfStatement ? sumCfLine(fins, /financing/i, key) : (monthlyEmi > 0 ? -monthlyEmi : 0);
    return { month: key.split(' ')[0], operating: op, financing: fin };
  }).filter(r => r.operating !== 0 || r.financing !== 0);

  const hasData = cashTrend.length > 0 || operatingVsFinancing.length > 0 || ocf !== 0;

  return {
    available: hasData,
    sourceNote: fromCfStatement
      ? 'Rentals → Financials · Cash Flow statement'
      : 'Operating CF = collected rent (AR) · Financing CF = estimated EMI — see Executive Summary → Cash Flow',
    operatingCf: ocf !== 0 || arData.length ? fmtUsd(ocf) : 'Data not available',
    financingCf: fcf !== 0 || monthlyEmi > 0 ? fmtUsd(fcf) : 'Data not available',
    investingCf: icf !== 0 ? fmtUsd(icf) : 'Not tracked',
    cashTrend,
    operatingVsFinancing,
  };
}

export function buildRentalPortfolioSection(
  registryOps: {
    occupancyPct: number | null;
    collected: number | null;
    vacancyLoss: number | null;
    arrears: number | null;
  },
  collectionRate: number,
  k: KpiData | null,
  gprTrend: RentalPortfolioSection['gprTrend'],
): RentalPortfolioSection {
  const noiM = k && k.totalRevenue > 0 ? (k.noi / k.totalRevenue) * 100 : null;
  return {
    available: registryOps.occupancyPct != null || gprTrend.some(t => t.gpr > 0),
    sourceNote: 'Rentals → Rental Portfolio Overview · NOI Margin from Financials P&L',
    occupancy: registryOps.occupancyPct != null ? pct(registryOps.occupancyPct) : 'Data not available',
    collected: registryOps.collected != null ? fmtUsd(registryOps.collected) : 'Data not available',
    collectionRate: collectionRate > 0 ? pct(collectionRate) : 'Data not available',
    vacancyLoss: registryOps.vacancyLoss != null ? fmtUsd(registryOps.vacancyLoss) : 'Data not available',
    arOutstanding: registryOps.arrears != null ? fmtUsd(registryOps.arrears) : 'Data not available',
    noiMargin: noiM != null ? pct(noiM) : 'Data not available — upload Financials P&L',
    gprTrend,
  };
}

/** 6-month expense trend anchored to selected period — mirrors Expenses page rolling window. */
export function buildExpensesSection(
  finRows: FinRow[],
  k: KpiData | null,
  month: number,
  year: number,
): ExpensesSection {
  const keys = getTrailingMonthKeys(month, year, 6);
  const trendEndLabel = keys[keys.length - 1] ?? `${month}/${year}`;

  const trend6Mo = keys.map(key => {
    const rows = finRows.filter(r => r.month === key && !r.isSectionHeader && !r.isTotal && !isRevenueLine(r));
    const amount = rows.reduce((s, r) => s + Math.abs(r.amount), 0);
    return { month: key.split(' ')[0], amount };
  });

  const hasTrend = trend6Mo.some(t => t.amount > 0);
  const breakdown = k ? expensePieFromKpi(k) : [];

  const catMap = new Map<string, number>();
  for (const r of finRows.filter(x => !x.isSectionHeader && !x.isTotal && !isRevenueLine(x))) {
    if (!keys.includes(r.month)) continue;
    const cat = r.account.length > 24 ? (r.category ?? 'Other') : r.account;
    catMap.set(cat, (catMap.get(cat) ?? 0) + Math.abs(r.amount));
  }
  const fromRows = [...catMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    available: hasTrend || breakdown.length > 0 || fromRows.length > 0,
    sourceNote: 'Rentals → Expenses · 6-month window ending selected period',
    trendEndLabel,
    trend6Mo: hasTrend ? trend6Mo : [],
    breakdown: breakdown.length ? breakdown : fromRows,
  };
}

export function buildArDashboardSection(
  qbAr: QBAgingLatest | null,
  entityId: string | 'portfolio',
  companies: CompanyRow[],
): ArDashboardSection {
  if (!qbAr?.has_data) {
    return {
      available: false,
      sourceNote: 'Data not available — see Rentals → AR Dashboard',
      dso: 'Data not available',
      overdue30: 'Data not available',
      overdue60: 'Data not available',
      overdue90: 'Data not available',
      creditBalance: 'Data not available',
      agingChart: [],
    };
  }

  const totals = entityId === 'portfolio'
    ? qbAr.portfolio_totals
    : qbAr.by_company.find(c => c.company_id === entityId) ?? qbAr.portfolio_totals;

  const credit = totals?.credit_balance ?? creditBalanceFromBuckets(totals);
  const dsoVal = qbAr.dso_estimate ?? estimateDsoFromBuckets(totals);
  const buckets = flooredBucketsForChart(totals);

  return {
    available: true,
    sourceNote: 'Rentals → AR Dashboard · QB AR Aging (zero-floored buckets)',
    dso: dsoVal != null ? `${dsoVal} days` : (credit > 0 ? 'N/A (credit balance only)' : 'Data not available'),
    overdue30: fmtUsd(overdue30PlusFromBuckets(totals)),
    overdue60: fmtUsd(overdue60PlusFromBuckets(totals)),
    overdue90: fmtUsd(overdue90PlusFromBuckets(totals)),
    creditBalance: credit > 0 ? fmtUsd(credit) : '$0',
    agingChart: [
      { label: 'Current', amount: buckets.Current },
      { label: '1-30', amount: buckets['1-30'] },
      { label: '31-60', amount: buckets['31-60'] },
      { label: '61-90', amount: buckets['61-90'] },
      { label: '91+', amount: buckets['91+'] },
    ].filter(b => b.amount > 0),
  };
}
