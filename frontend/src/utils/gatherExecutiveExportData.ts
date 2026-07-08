/**
 * Gathers CEO Board Review PPT payload from all live dashboard sources.
 * Single source of truth: rentalKpiEngine, Loan Tracker, Ownership API, AR/AP aging.
 */
import api from '../services/api';
import { type Period, periodChipText, getTrailingMonthKeys } from './periodWindow';
import type { PortfolioSummary, LoanRow, CompanyRow, UnitRow } from '../hooks/useRentalCfoData';
import type { OwnerRow } from '../hooks/useExecutiveSummaryData';
import type { QBAgingLatest } from '../components/rental/QbArAgingUploadPanel';
import { overdue90PlusFromBuckets } from '../components/rental/QbArAgingUploadPanel';
import {
  apiResponseToParsedFinancials, resolveKpiViewForPeriod, aggregateKpiDataList,
  buildExportKpiSets, calcKpisFromMonthlyKey, getAvailableKeys,
  fmtKpiCurrency, type ParsedFinancials, type KpiData, type ExportKpiItem,
} from './rentalKpiEngine';
import type { CeoBoardExportPayload } from './executiveSummaryPpt';
import { buildLoanScheduleKpis } from './executiveSummaryLoans';
import {
  resolvePortfolioMarketValue, buildMarketValueComposition, buildDebtComposition,
} from './executiveSummaryPortfolio';
import { buildEmiStatusRows, EMI_STATUS_DISCLAIMER } from './executiveSummaryEmi';
import { buildRiskActionRows } from './executiveSummaryActionRules';
import { generateExecutiveNarrative, generateStrategicRecommendations, generateSlideNarratives } from './executiveSummaryNarrative';
import { aggregateRegistryOps, buildRegistryTrend } from './executiveSummaryRegistry';

const CAP_RATE = 0.055;

interface ArMonth { month: string; billed: number; collected: number; }

interface FinRow {
  month: string; account: string; amount: number;
  category?: string;
}

interface QbApAgingLatest {
  has_data: boolean;
  dpo_estimate?: number | null;
  trend: { month: string }[];
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return 'Data not available';
  if (n === 0) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : 'Data not available';
}

async function loadFinancials(companyIds: string[]): Promise<ParsedFinancials[]> {
  const listRes = await api.get<{ company_id: string }[]>('/api/rentals/financials').catch(() => ({ data: [] }));
  const uploadIds = (listRes.data ?? []).map(r => r.company_id);
  const idsToFetch = [...new Set([...companyIds, ...uploadIds])];
  const results = await Promise.all(
    idsToFetch.map(id =>
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

function buildWaterfall(k: KpiData, portfolio: PortfolioSummary | null): { label: string; value: string }[] {
  const gpr = portfolio?.gross_potential_rent ?? k.totalRevenue;
  const vacancy = portfolio?.vacancy_loss ?? Math.max(0, gpr - (portfolio?.collected_this_month ?? k.rentalIncome));
  const effectiveRent = gpr - vacancy;
  const opex = k.totalExpenses;
  const noi = k.noi;
  const interest = k.interestExpense;
  const netIncome = k.netIncome;
  return [
    { label: 'Gross Potential Rent (GPR)', value: fmtUsd(gpr) },
    { label: 'Less: Vacancy Loss', value: `(${fmtUsd(vacancy)})` },
    { label: 'Effective Rent', value: fmtUsd(effectiveRent) },
    { label: 'Less: Operating Expenses', value: `(${fmtUsd(opex)})` },
    { label: 'Net Operating Income (NOI)', value: fmtUsd(noi) },
    { label: 'Less: Interest Expense', value: `(${fmtUsd(interest)})` },
    { label: 'Net Income', value: fmtUsd(netIncome) },
  ];
}

function buildCashTrend(fins: ParsedFinancials[], month: number, year: number): { month: string; cash: number }[] {
  const keys = getTrailingMonthKeys(month, year, 12);
  return keys.map(key => {
    const views = fins
      .map(f => (getAvailableKeys(f).includes(key) ? calcKpisFromMonthlyKey(f, key) : null))
      .filter((v): v is KpiData => v !== null);
    const cash = views.length ? aggregateKpiDataList(views).cash : 0;
    return { month: key.split(' ')[0], cash };
  }).filter(r => r.cash !== 0);
}

function buildFinancialTrend(
  fins: ParsedFinancials[],
  month: number,
  year: number,
): { month: string; revenue: number; expenses: number; noi: number }[] {
  const keys = getTrailingMonthKeys(month, year, 12);
  return keys.map(key => {
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
  }).filter(r => r.revenue > 0 || r.expenses > 0 || r.noi > 0);
}

function buildOwnershipKpis(ownership: OwnerRow[], companies: CompanyRow[], totalDebt: number, marketValue: number) {
  if (!ownership.length) {
    return {
      available: false,
      totalPartners: '—',
      totalCapital: '—',
      totalEquity: '—',
      avgRoi: '—',
      partnerSlices: [] as { name: string; value: number }[],
      roiByPartner: [] as { name: string; roi: number }[],
    };
  }
  const gprByCo = new Map(companies.map(c => [c.company_name, c.gross_potential_rent]));
  let totalCapital = 0;
  let totalCost = 0;
  const partnerSlices: { name: string; value: number }[] = [];
  const roiByPartner: { name: string; roi: number }[] = [];

  for (const p of ownership) {
    let partnerMv = 0;
    let partnerCap = 0;
    for (const h of p.holdings) {
      const gpr = gprByCo.get(h.company_name) ?? 0;
      const mv = gpr > 0 ? ((gpr * 12) / CAP_RATE) * h.ownership_pct : (h.book_value ?? h.cost_basis ?? 0);
      partnerMv += mv;
      partnerCap += h.capital_contributed ?? h.cost_basis ?? 0;
    }
    totalCapital += partnerCap;
    totalCost += p.holdings.reduce((s, h) => s + (h.cost_basis ?? 0), 0);
    partnerSlices.push({ name: p.partner_name.split(' ')[0], value: Math.round(partnerMv) });
    const roi = partnerCap > 0 ? ((partnerMv - partnerCap) / partnerCap) * 100 : 0;
    roiByPartner.push({ name: p.partner_name.split(' ')[0], roi });
  }

  const totalEquity = marketValue > 0 ? marketValue - totalDebt : 0;
  const avgRoi = totalCost > 0 && totalEquity > 0
    ? `${(((totalEquity - totalCost) / totalCost) * 100).toFixed(1)}%`
    : 'Data not available';

  return {
    available: true,
    totalPartners: String(ownership.length),
    totalCapital: fmtUsd(totalCapital),
    totalEquity: totalEquity > 0 ? fmtUsd(totalEquity) : 'Data not available',
    avgRoi,
    partnerSlices: partnerSlices.filter(s => s.value > 0),
    roiByPartner: roiByPartner.sort((a, b) => b.roi - a.roi),
  };
}

export interface PropertyProfitRow {
  property: string;
  occupancy: string;
  noiMargin: string;
  dscr: string;
  arrears: string;
  flagged: boolean;
  /** Numeric fields for charts (not display strings). */
  occupancyPct: number | null;
  noiMarginPct: number | null;
  noiDollars: number | null;
}

function buildPropertyRows(
  companies: CompanyRow[],
  loans: LoanRow[],
  ownership: OwnerRow[],
): PropertyProfitRow[] {
  const rows: PropertyProfitRow[] = [];
  const seen = new Set<string>();

  for (const co of companies) {
    if (seen.has(co.company_name)) continue;
    seen.add(co.company_name);
    const loan = loans.find(l => l.company_name === co.company_name);
    const rev = co.gross_potential_rent || co.collected_this_month;
    const noiM = rev > 0 ? (co.noi_this_month / rev) * 100 : null;
    const dscr = loan?.dscr ?? null;
    const flagged = (noiM != null && noiM < 15) || (dscr != null && dscr < 1.1) || co.arrears_total > rev * 2;
    rows.push({
      property: co.company_name,
      occupancy: co.total_units > 0 ? pct(co.occupancy_pct * 100) : '—',
      noiMargin: noiM != null ? pct(noiM) : '—',
      dscr: dscr != null ? `${dscr.toFixed(2)}x` : '—',
      arrears: co.arrears_total > 0 ? fmtUsd(co.arrears_total) : '$0',
      flagged,
      occupancyPct: co.total_units > 0 ? co.occupancy_pct * 100 : null,
      noiMarginPct: noiM,
      noiDollars: co.noi_this_month ?? null,
    });
  }

  for (const l of loans) {
    const key = l.property_name || l.company_name;
    if (seen.has(key)) continue;
    seen.add(key);
    const dscr = l.dscr ?? (l.noi_annual && l.loan_emi ? (l.noi_annual / 12) / l.loan_emi : null);
    const monthlyNoi = l.noi_annual != null ? l.noi_annual / 12 : null;
    rows.push({
      property: key,
      occupancy: '—',
      noiMargin: '—',
      dscr: dscr != null ? `${dscr.toFixed(2)}x` : '—',
      arrears: '—',
      flagged: dscr != null && dscr < 1.1,
      occupancyPct: null,
      noiMarginPct: null,
      noiDollars: monthlyNoi,
    });
  }

  if (!rows.length && ownership.length) {
    for (const p of ownership) {
      for (const h of p.holdings) {
        const name = h.property_name || h.company_name;
        if (seen.has(name)) continue;
        seen.add(name);
        rows.push({
          property: name, occupancy: '—', noiMargin: '—', dscr: '—', arrears: '—', flagged: false,
          occupancyPct: null, noiMarginPct: null, noiDollars: h.noi_this_month ?? null,
        });
      }
    }
  }

  return rows;
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
  units: UnitRow[];
  arData: ArMonth[];
  finRows: FinRow[];
}

export async function gatherCeoBoardExportPayload(opts: GatherExportOptions): Promise<CeoBoardExportPayload> {
  const { entityId, entityLabel, period, month, year, companies, portfolio, loans, arData, units } = opts;

  const periodLabel = period ? periodChipText(period, month, year) : `Latest · ${year}`;

  const companyIds = entityId === 'portfolio' ? companies.map(c => c.id) : [entityId];
  const scopedCompanies = entityId === 'portfolio' ? companies : companies.filter(c => c.id === entityId);
  const scopedLoans = entityId === 'portfolio'
    ? loans
    : loans.filter(l => scopedCompanies.some(c => c.company_name === l.company_name));

  const scopedPortfolio = entityId === 'portfolio' ? portfolio : (() => {
    const co = scopedCompanies[0];
    if (!co) return null;
    return {
      total_units: co.total_units, occupied_units: co.occupied_units, vacant_units: co.vacant_units,
      occupancy_pct: co.occupancy_pct, collected_this_month: co.collected_this_month,
      billed_this_month: co.billed_this_month, noi_this_month: co.noi_this_month,
      gross_potential_rent: co.gross_potential_rent, total_expense_this_month: co.total_expense_this_month,
      vacancy_loss: Math.max(0, co.gross_potential_rent - co.collected_this_month),
      arrears_total: co.arrears_total, by_company: [co],
    } as PortfolioSummary;
  })();

  const registryOps = aggregateRegistryOps(scopedCompanies, units, entityId, month, year);

  const [fins, ownRes, arAgingRes, apAgingRes] = await Promise.all([
    loadFinancials(companyIds),
    api.get<OwnerRow[]>('/api/rentals/ownership').catch(() => ({ data: [] as OwnerRow[] })),
    api.get<QBAgingLatest>('/api/rentals/ar-ap/qb-aging/latest').catch(() => ({ data: null })),
    api.get<QbApAgingLatest>('/api/rentals/ar-ap/qb-ap-aging/latest').catch(() => ({ data: null })),
  ]);

  const ownership = Array.isArray(ownRes.data) ? ownRes.data : [];
  const qbAr = arAgingRes.data;
  const arOverdue90 = qbAr?.portfolio_totals
    ? overdue90PlusFromBuckets(qbAr.portfolio_totals)
    : 0;

  const totalBilled = arData.reduce((s, r) => s + r.billed, 0);
  const totalCollected = arData.reduce((s, r) => s + r.collected, 0);
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : (qbAr ? 0 : 0);

  const { k, kPrev } = fins.length > 0
    ? resolvePortfolioKpi(fins, period, month, year)
    : { k: null as KpiData | null, kPrev: null as KpiData | null };

  const ops = {
    occupancyPct: registryOps.occupancyPct ?? undefined,
    collectionRate: collectionRate > 0 ? collectionRate : undefined,
    vacancyRate: registryOps.occupancyPct != null ? (100 - registryOps.occupancyPct) : undefined,
    totalUnits: registryOps.totalUnits || scopedPortfolio?.total_units,
  };

  const kpiSets = k ? buildExportKpiSets(k, kPrev, ops) : {
    profitability: [] as ExportKpiItem[], balanceSheet: [] as ExportKpiItem[],
    occupancy: [] as ExportKpiItem[], pricing: [] as ExportKpiItem[], returns: [] as ExportKpiItem[],
  };

  const portfolioGpr = registryOps.grossPotentialRent
    ?? scopedPortfolio?.gross_potential_rent
    ?? scopedCompanies.reduce((s, c) => s + (c.gross_potential_rent ?? 0), 0);
  const mvResult = resolvePortfolioMarketValue({
    loans: scopedLoans,
    buildingsFromFinancials: k?.buildings ?? 0,
    companies: scopedCompanies,
    ownership,
    portfolioGpr,
  });
  const totalDebt = scopedLoans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);
  const cash = k?.cash ?? 0;

  const flaggedCount = scopedLoans.filter(l => {
    const d = l.dscr ?? (l.noi_annual && l.loan_emi ? (l.noi_annual / 12) / l.loan_emi : null);
    const bal = l.loan_balance_as_of ?? 0;
    const val = l.current_property_value ?? l.loan_amount ?? 0;
    return (d != null && d < 1.2) || (val > 0 && bal / val > 0.75);
  }).length;

  const riskRows = buildRiskActionRows({
    portfolio: scopedPortfolio, companies: scopedCompanies, loans: scopedLoans,
    units, k, collectionRate, ownership, arOverdue90,
  });

  const { summary: loanSummary } = buildLoanScheduleKpis(scopedLoans);
  const emiRows = buildEmiStatusRows(scopedLoans);

  const now = new Date();
  const in12 = new Date(now);
  in12.setMonth(in12.getMonth() + 12);
  const in24 = new Date(now);
  in24.setMonth(in24.getMonth() + 24);

  const maturityBuckets = [
    { label: '≤12 mo', amount: 0, count: 0 },
    { label: '12–24 mo', amount: 0, count: 0 },
    { label: '>24 mo', amount: 0, count: 0 },
  ];
  for (const l of scopedLoans) {
    if (!l.loan_maturity_date) continue;
    const d = new Date(l.loan_maturity_date);
    const bal = l.loan_balance_as_of ?? 0;
    if (d <= in12) { maturityBuckets[0].amount += bal; maturityBuckets[0].count += 1; }
    else if (d <= in24) { maturityBuckets[1].amount += bal; maturityBuckets[1].count += 1; }
    else { maturityBuckets[2].amount += bal; maturityBuckets[2].count += 1; }
  }

  const dscrByProperty = scopedLoans.map(l => ({
    name: (l.property_name || l.company_name).slice(0, 16),
    dscr: l.dscr ?? (l.noi_annual && l.loan_emi ? (l.noi_annual / 12) / l.loan_emi : 0),
  })).filter(r => r.dscr > 0);

  const ltvByProperty = scopedLoans.map(l => {
    const bal = l.loan_balance_as_of ?? 0;
    const val = l.current_property_value ?? l.loan_amount ?? 0;
    return { name: (l.property_name || l.company_name).slice(0, 16), ltv: val > 0 ? (bal / val) * 100 : 0 };
  }).filter(r => r.ltv > 0);

  const occPct = registryOps.occupancyPct;
  const registryTrend = buildRegistryTrend(scopedCompanies, entityId, occPct, 6);
  const gprTrend = registryTrend.length
    ? registryTrend.map(p => ({ month: p.month, gpr: p.gpr, collected: p.collected, occupancy: p.occupancy }))
    : getTrailingMonthKeys(month, year, 6).map(m => {
      const ar = arData.find(a => a.month === m);
      return {
        month: m.split(' ')[0],
        gpr: ar?.billed ?? 0,
        collected: ar?.collected ?? 0,
        occupancy: occPct,
      };
    });

  const monthlyEmi = scopedLoans.reduce((s, l) => s + (l.loan_emi ?? 0), 0);
  const runwayMonths = monthlyEmi > 0 && cash > 0 ? (cash / monthlyEmi).toFixed(1) : null;

  const ownershipKpis = buildOwnershipKpis(ownership, scopedCompanies, totalDebt, mvResult.value);

  const propertyRows = buildPropertyRows(scopedCompanies, scopedLoans, ownership);

  const portfolioSnapshot = {
    totalUnits: registryOps.totalUnits > 0 ? String(registryOps.totalUnits) : 'Data not available — see Company Registry',
    occupiedUnits: registryOps.occupiedUnits > 0 ? String(registryOps.occupiedUnits) : 'Data not available',
    vacantUnits: registryOps.vacantUnits,
    marketValue: mvResult.value > 0 ? fmtUsd(mvResult.value) : 'Data not available — see Loan Tracker / Financials',
    marketValueSource: mvResult.label,
    totalDebt: fmtUsd(totalDebt),
    loanCount: scopedLoans.length,
    unitsByCompany: scopedCompanies.map(c => ({ name: c.company_name.split(' ')[0], units: c.total_units })),
    assetComposition: buildMarketValueComposition({ companies: scopedCompanies, loans: scopedLoans, ownership }),
    debtComposition: buildDebtComposition(scopedLoans),
  };

  const rentalPerformance = {
    occupancy: occPct != null ? pct(occPct) : 'Data not available',
    gpr: fmtUsd(registryOps.grossPotentialRent ?? k?.totalRevenue ?? 0),
    collected: fmtUsd(registryOps.collected ?? 0),
    vacancyLoss: fmtUsd(registryOps.vacancyLoss ?? 0),
    collectionRate: collectionRate > 0 ? pct(collectionRate) : 'Data not available',
    arOutstanding: fmtUsd(registryOps.arrears ?? scopedPortfolio?.arrears_total ?? qbAr?.portfolio_totals?.total ?? 0),
    gprTrend,
  };

  const financialPerformance = {
    available: Boolean(k),
    profitability: kpiSets.profitability,
    waterfall: k ? buildWaterfall(k, scopedPortfolio) : [],
    trend: buildFinancialTrend(fins, month, year),
    noi: k ? fmtKpiCurrency(k.noi) : 'Data not available',
    sourceNote: k ? 'From Financials P&L (interest add-back applied)' : 'Upload P&L on Rentals → Financials',
  };

  const cashPosition = {
    balance: k ? fmtKpiCurrency(k.cash) : 'Data not available — see Financials Balance Sheet',
    trend: buildCashTrend(fins, month, year),
    runwayNote: runwayMonths
      ? `Cash covers ~${runwayMonths} months of loan EMI at current balance.`
      : monthlyEmi > 0 ? 'Cash runway not calculable — upload balance sheet cash.' : 'No EMI data on Loan Tracker.',
  };

  const loanPortfolio = {
    available: scopedLoans.length > 0,
    summary: loanSummary,
    totalDebt: fmtUsd(totalDebt),
    loanCount: String(scopedLoans.length),
    portfolioDscr: k && k.interestExpense > 0 ? `${(k.noi / (k.interestExpense * 1.2)).toFixed(2)}x` : 'Data not available',
    interestCoverage: k && k.interestExpense > 0 ? `${(k.noi / k.interestExpense).toFixed(2)}x` : 'Data not available',
    emiRows,
    emiDisclaimer: EMI_STATUS_DISCLAIMER,
    worstDscr: [...dscrByProperty].sort((a, b) => a.dscr - b.dscr).slice(0, 5),
  };

  const debtRisk = {
    available: scopedLoans.length > 0,
    dscrByProperty,
    ltvByProperty,
    maturityBuckets: maturityBuckets.filter(b => b.count > 0),
  };

  const propertyProfitability = {
    available: propertyRows.length > 0,
    rows: propertyRows,
  };

  const slideNarratives = generateSlideNarratives({
    payload: {
      portfolioSnapshot,
      rentalPerformance,
      financialPerformance,
      cashPosition,
      loanPortfolio,
      debtRisk,
      ownership: ownershipKpis,
      propertyProfitability,
      riskActionTable: riskRows,
    },
    k,
    kPrev,
    loans: scopedLoans,
  });

  return {
    entityLabel,
    periodLabel,
    generatedAt: new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }),

    executiveNarrative: generateExecutiveNarrative({
      k, kPrev, portfolio: scopedPortfolio, loans: scopedLoans, collectionRate,
      marketValue: mvResult.value, totalDebt, cash, flaggedPropertyCount: flaggedCount, arOverdue90,
    }),

    portfolioSnapshot,

    rentalPerformance,

    financialPerformance,

    cashPosition,

    loanPortfolio,

    debtRisk,

    ownership: ownershipKpis,

    propertyProfitability,

    riskActionTable: riskRows,

    slideNarratives,

    strategicRecommendations: generateStrategicRecommendations({
      riskRows, loans: scopedLoans, portfolio: scopedPortfolio, collectionRate, arOverdue90, k,
    }),
  };
}

/** @deprecated use gatherCeoBoardExportPayload */
export async function gatherExecutiveExportPayload(opts: GatherExportOptions) {
  const p = await gatherCeoBoardExportPayload(opts);
  return p;
}
