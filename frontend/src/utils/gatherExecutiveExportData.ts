/**
 * Gathers Executive Summary export payload from live dashboard data sources.
 * All KPI values flow through rentalKpiEngine — no independent recalculation.
 */
import api from '../services/api';
import { type Period, periodChipText } from '../utils/periodWindow';
import type { PortfolioSummary, LoanRow, CompanyRow } from '../hooks/useRentalCfoData';
import {
  apiResponseToParsedFinancials, resolveKpiViewForPeriod, aggregateKpiDataList,
  buildExportKpiSets, fmtKpiCurrency, fmtKpiPct, type ParsedFinancials, type KpiData,
  type ExportKpiItem,
} from './rentalKpiEngine';
import type { ExecExportPayload, ExecOverviewKpi, LoanExportRow } from './executiveSummaryPpt';
import { buildLoanScheduleKpis } from './executiveSummaryLoans';

interface ArMonth { month: string; billed: number; collected: number; }

interface FinRow {
  month: string; account: string; amount: number;
  category?: string; isSectionHeader?: boolean; isTotal?: boolean;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return 'Data not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : 'Data not available';
}

async function loadFinancials(companyIds: string[]): Promise<ParsedFinancials[]> {
  const results = await Promise.all(
    companyIds.map(id =>
      api.get(`/api/rentals/financials/${id}`)
        .then(r => apiResponseToParsedFinancials(r.data))
        .catch(() => null),
    ),
  );
  return results.filter((f): f is ParsedFinancials => f !== null && f.pl.length > 0);
}

function resolvePortfolioKpi(
  fins: ParsedFinancials[],
  period: Period | null,
  month: number,
  year: number,
): { k: KpiData; kPrev: KpiData | null; label: string } {
  const views = fins.map(f => resolveKpiViewForPeriod(f, period, month, year));
  const k = aggregateKpiDataList(views.map(v => v.k));
  const prevList = views.map(v => v.kPrev).filter((p): p is KpiData => p !== null);
  const kPrev = prevList.length > 0 ? aggregateKpiDataList(prevList) : null;
  const label = views[0]?.label ?? `FY ${year}`;
  return { k, kPrev, label };
}

function finStatementLines(fin: ParsedFinancials | null, sheet: 'pl' | 'bs' | 'cf', year: number): { label: string; value: string }[] {
  const items = fin ? fin[sheet] : [];
  if (!items.length) return [];
  return items
    .filter(i => !i.isSectionHeader && (i.values[year] !== 0 || i.isTotal))
    .slice(0, 16)
    .map(i => ({
      label: i.label,
      value: fmtUsd(i.values[year] ?? 0),
    }));
}

function buildLoanRows(loans: LoanRow[]): { rows: LoanExportRow[]; summary: ExportKpiItem[] } {
  return buildLoanScheduleKpis(loans);
}

function buildActionItems(
  portfolio: PortfolioSummary | null,
  loans: LoanRow[],
  collectionRate: number,
): { severity: string; title: string; detail: string }[] {
  const items: { severity: string; title: string; detail: string }[] = [];
  if (portfolio) {
    if (portfolio.occupancy_pct * 100 < 85) {
      items.push({ severity: 'critical', title: 'Low Occupancy', detail: `Occupancy at ${pct(portfolio.occupancy_pct * 100)} — target ≥95%` });
    }
    if (collectionRate > 0 && collectionRate < 80) {
      items.push({ severity: 'critical', title: 'Collection Rate Below Target', detail: `Collection rate ${pct(collectionRate)} — target ≥95%` });
    }
    if (portfolio.arrears_total > 0) {
      items.push({ severity: 'warning', title: 'AR Outstanding', detail: `${fmtUsd(portfolio.arrears_total)} in arrears across portfolio` });
    }
  }
  const highRateLoans = loans.filter(l => (l.loan_interest_rate ?? 0) > 0.065);
  if (highRateLoans.length > 0) {
    items.push({
      severity: 'warning', title: 'High-Rate Loans',
      detail: `${highRateLoans.length} loan(s) above 6.5% — review refinancing options`,
    });
  }
  if (items.length === 0) {
    items.push({ severity: 'ok', title: 'Portfolio On Track', detail: 'No critical flags from current data' });
  }
  return items;
}

export interface GatherExportOptions {
  entityId: string | 'portfolio';
  entityLabel: string;
  period: Period | null;
  month: number;
  year: number;
  companies: CompanyRow[];
  portfolio: PortfolioSummary | null;
  loans: LoanRow[];
  arData: ArMonth[];
  finRows: FinRow[];
}

export async function gatherExecutiveExportPayload(opts: GatherExportOptions): Promise<ExecExportPayload> {
  const { entityId, entityLabel, period, month, year, companies, portfolio, loans, arData, finRows } = opts;

  const periodLabel = period
    ? periodChipText(period, month, year)
    : `Latest · ${year}`;

  const companyIds = entityId === 'portfolio'
    ? companies.map(c => c.id)
    : [entityId];

  const scopedCompanies = entityId === 'portfolio'
    ? companies
    : companies.filter(c => c.id === entityId);

  const scopedLoans = entityId === 'portfolio'
    ? loans
    : loans.filter(l => scopedCompanies.some(c => c.company_name === l.company_name));

  const scopedPortfolio = entityId === 'portfolio'
    ? portfolio
    : (() => {
        const co = scopedCompanies[0];
        if (!co) return null;
        return {
          total_units: co.total_units,
          occupied_units: co.occupied_units,
          vacant_units: co.vacant_units,
          occupancy_pct: co.occupancy_pct,
          collected_this_month: co.collected_this_month,
          billed_this_month: co.billed_this_month,
          noi_this_month: co.noi_this_month,
          gross_potential_rent: co.gross_potential_rent,
          total_expense_this_month: co.total_expense_this_month,
          vacancy_loss: Math.max(0, co.gross_potential_rent - co.collected_this_month),
          arrears_total: co.arrears_total,
          by_company: [co],
        } as PortfolioSummary;
      })();

  const totalBilled = arData.reduce((s, r) => s + r.billed, 0);
  const totalCollected = arData.reduce((s, r) => s + r.collected, 0);
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;

  const fins = await loadFinancials(companyIds);
  const primaryFin = fins[0] ?? null;
  const finYear = primaryFin?.years.includes(year)
    ? year
    : primaryFin?.years[primaryFin.years.length - 1] ?? year;

  const { k, kPrev } = fins.length > 0
    ? resolvePortfolioKpi(fins, period, month, year)
    : { k: null as KpiData | null, kPrev: null as KpiData | null };

  const ops = {
    occupancyPct: scopedPortfolio?.occupancy_pct != null ? scopedPortfolio.occupancy_pct * 100 : undefined,
    collectionRate: collectionRate > 0 ? collectionRate : undefined,
    vacancyRate: scopedPortfolio ? (1 - scopedPortfolio.occupancy_pct) * 100 : undefined,
    totalUnits: scopedPortfolio?.total_units,
    avgDaysVacant: undefined,
  };

  const kpiSets = k
    ? buildExportKpiSets(k, kPrev, ops)
    : {
        profitability: [], balanceSheet: [], occupancy: [], pricing: [], returns: [],
      };

  const overviewKpis: ExecOverviewKpi[] = [
    { label: 'Gross Potential Rent', value: fmtUsd(scopedPortfolio?.gross_potential_rent ?? k?.totalRevenue ?? 0) },
    { label: 'Total Collected', value: fmtUsd(scopedPortfolio?.collected_this_month ?? k?.totalRevenue ?? 0) },
    { label: 'Net Operating Income', value: fmtUsd(k?.noi ?? scopedPortfolio?.noi_this_month ?? 0) },
    { label: 'Occupancy Rate', value: scopedPortfolio ? pct(scopedPortfolio.occupancy_pct * 100) : 'Data not available' },
    { label: 'Vacancy Loss', value: fmtUsd(scopedPortfolio?.vacancy_loss ?? 0) },
    { label: 'Total Expenses', value: fmtUsd(k?.totalExpenses ?? scopedPortfolio?.total_expense_this_month ?? 0) },
    { label: 'Collection Rate', value: collectionRate > 0 ? pct(collectionRate) : 'Data not available' },
    { label: 'Total Debt', value: fmtUsd(scopedLoans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0)) },
  ];

  const { rows: loanRows, summary: loanSummary } = buildLoanRows(scopedLoans);

  // Income statement from fin rows or KPI data
  const incomeStatementLines: { label: string; value: string }[] = k
    ? [
        { label: 'Total Revenue', value: fmtKpiCurrency(k.totalRevenue) },
        { label: 'Total Expenses', value: fmtKpiCurrency(k.totalExpenses) },
        { label: 'Net Operating Income', value: fmtKpiCurrency(k.noi) },
        { label: 'Net Income', value: fmtKpiCurrency(k.netIncome) },
        { label: 'Interest Expense', value: fmtKpiCurrency(k.interestExpense) },
        { label: 'Rental Income', value: fmtKpiCurrency(k.rentalIncome) },
      ]
    : finStatementLines(primaryFin, 'pl', finYear);

  const balanceSheetLines: { label: string; value: string }[] = k
    ? [
        { label: 'Total Assets', value: fmtKpiCurrency(k.totalAssets) },
        { label: 'Total Liabilities', value: fmtKpiCurrency(k.totalLiabilities) },
        { label: 'Equity', value: fmtKpiCurrency(k.equity) },
        { label: 'Cash', value: fmtKpiCurrency(k.cash) },
        { label: 'Buildings / Property', value: fmtKpiCurrency(k.buildings) },
        { label: 'Long-Term Loans', value: fmtKpiCurrency(k.longTermLoans) },
      ]
    : finStatementLines(primaryFin, 'bs', finYear);

  const cashFlowLines = finStatementLines(primaryFin, 'cf', finYear);

  return {
    entityLabel,
    periodLabel,
    generatedAt: new Date().toLocaleString(),
    overviewKpis,
    profitability: kpiSets.profitability,
    balanceSheet: kpiSets.balanceSheet,
    occupancy: kpiSets.occupancy,
    pricing: kpiSets.pricing,
    returns: kpiSets.returns,
    loans: loanRows,
    loanSummary,
    incomeStatementLines,
    balanceSheetLines,
    cashFlowLines,
    actionItems: buildActionItems(scopedPortfolio, scopedLoans, collectionRate),
  };
}
