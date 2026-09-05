/**
 * Property Dev portfolio → Export PDF (All Companies).
 * Same board-pack styling as single-entity Financials PDF, but each company
 * shows subtotals / multi-year snapshot only — no YoY line-item detail.
 */
import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import type { Period } from './periodWindow';
import type { SectionPdfBlock, SectionPdfKpi, SectionPdfPayload } from './gatherSectionPdfData';
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import type { PDFinancialsLike } from './propDevCfoTrendData';
import { buildPropDevBoardExportPayload, pickFocusSnapshot } from './gatherPropDevBoardExportData';
import { propDevPeriodAnchor } from './propDevPeriodKpis';
import { enrichPropDevFinWithCf } from './propDevYearlyFinancials';
import { sumActivePropDevLoanBalances } from './propDevLoanMetrics';
import { svgHorizontalBarChart } from './sectionPdfCharts';
import {
  buildPropDevPortfolioOverviewBlocks, buildCapitalStructureBlocks, buildPropertyTaxTrackerBlocks,
} from './gatherPropDevSectionPdfData';
import { propDevCompanyOverviewKpis, type PropDevCompanyOverviewKpis } from './propDevCompanyOverview';
import { scopePropDevFinToPeriod } from './propDevPeriodScope';
import type { PropDevPropertyTaxRow } from './propDevCostBasisCalculations';

const GOLD = '#5B5FEF';
const RED = '#B91C1C';
const GREEN = '#166534';

export interface PropDevPortfolioEntitySummary {
  companyId: string;
  companyName: string;
  propertyName: string;
  hasFinancials: boolean;
  focusYear: number | null;
  focusYearLabel: string;
  rev: number;
  exp: number;
  netInc: number;
  noi: number;
  margin: number | null;
  totalAssets: number;
  totalDebt: number;
  cash: number;
  equity: number;
  ltlv: number | null;
  landValue: number;
  operatingCf: number;
  netCashFlow: number;
  loanBalance: number;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtUsdAcct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 0) {
    return `(${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n))})`;
  }
  return fmtUsd(n);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const body = `${Math.abs(n).toFixed(1)}%`;
  return n < 0 ? `(${body})` : body;
}

function buildEntitySummary(
  company: CompanyData,
  fin: PDFinancialsLike | null | undefined,
  allLoans: Loan[],
  period: Period | null,
  pMonth: number,
  pYear: number,
  selectedYear: number,
  periodLabel: string,
): PropDevPortfolioEntitySummary {
  const loanBalance = sumActivePropDevLoanBalances(
    allLoans.filter(l => l.companyId === company.id),
  );
  const base: PropDevPortfolioEntitySummary = {
    companyId: company.id,
    companyName: company.name,
    propertyName: company.property?.name ?? '',
    hasFinancials: false,
    focusYear: null,
    focusYearLabel: '—',
    rev: 0,
    exp: 0,
    netInc: 0,
    noi: 0,
    margin: null,
    totalAssets: 0,
    totalDebt: 0,
    cash: 0,
    equity: 0,
    ltlv: null,
    landValue: company.property?.landCost ?? 0,
    operatingCf: 0,
    netCashFlow: 0,
    loanBalance,
  };
  if (!fin || (!fin.pl.length && !fin.bs.length && !(fin.cf?.length))) return base;

  const enriched = enrichPropDevFinWithCf(fin, company);
  // Match screen portfolio cards + buildEntityBlocks: period year is pYear.
  const anchor = propDevPeriodAnchor(period, pMonth, pYear);
  const payload = buildPropDevBoardExportPayload(
    enriched,
    company,
    allLoans,
    anchor,
    selectedYear,
    periodLabel,
  );
  const lastPl = pickFocusSnapshot(payload.plSnapshots, payload.focusYear);
  const lastBs = pickFocusSnapshot(payload.bsSnapshots, payload.focusYear);
  const lastCf = pickFocusSnapshot(payload.cfSnapshots, payload.focusYear);

  return {
    ...base,
    hasFinancials: true,
    focusYear: lastPl?.year ?? lastBs?.year ?? payload.focusYear,
    focusYearLabel: lastPl?.yearLabel ?? lastBs?.yearLabel ?? String(payload.focusYear ?? selectedYear),
    rev: lastPl?.rev ?? 0,
    exp: lastPl?.exp ?? 0,
    netInc: lastPl?.netInc ?? 0,
    noi: lastPl?.noi ?? 0,
    margin: lastPl?.margin ?? null,
    totalAssets: lastBs?.totalAssets ?? 0,
    totalDebt: lastBs?.totalDebt ?? payload.totalDebt,
    cash: lastBs?.cash ?? 0,
    equity: lastBs?.equity ?? 0,
    ltlv: lastBs?.ltlv ?? null,
    landValue: lastBs?.landValue ?? company.property?.landCost ?? 0,
    operatingCf: lastCf?.operatingCf ?? 0,
    netCashFlow: lastCf?.netCashFlow ?? 0,
  };
}

function buildPortfolioStrategy(entities: PropDevPortfolioEntitySummary[]): SectionStrategyPlan {
  const withFin = entities.filter(e => e.hasFinancials);
  const lossN = withFin.filter(e => e.netInc < 0).length;
  const totalRev = withFin.reduce((s, e) => s + e.rev, 0);
  const totalNi = withFin.reduce((s, e) => s + e.netInc, 0);
  const actions: string[] = [];
  if (lossN > 0) {
    actions.push(`Review ${lossN} entit${lossN === 1 ? 'y' : 'ies'} with negative Net Income in the focus period.`);
  }
  if (withFin.length < entities.length) {
    actions.push(`Upload or sync financials for ${entities.length - withFin.length} entit${entities.length - withFin.length === 1 ? 'y' : 'ies'} missing statements.`);
  }
  if (!actions.length) {
    actions.push('Maintain period-close uploads so portfolio subtotals stay aligned with entity YoY detail.');
  }
  return {
    commentary: [
      `${withFin.length} of ${entities.length} entities with P&L or Balance Sheet data.`,
      `Portfolio revenue ${fmtUsd(totalRev)}; Net Income ${fmtUsdAcct(totalNi)} (focus period per entity).`,
      'Each section below mirrors the single-entity CFO pack but omits line-item YoY detail.',
    ].join(' '),
    actions,
  };
}

function buildEntityBlocks(
  company: CompanyData,
  fin: PDFinancialsLike | null | undefined,
  summary: PropDevPortfolioEntitySummary,
  allLoans: Loan[],
  period: Period | null,
  pMonth: number,
  pYear: number,
  selectedYear: number,
  periodLabel: string,
  pageBreakBefore: boolean,
): SectionPdfBlock[] {
  if (!summary.hasFinancials || !fin) {
    return [{
      heading: summary.companyName,
      pageBreakBefore,
      forcePageBreak: pageBreakBefore,
      kpis: [
        { label: 'Status', value: 'No financials', sub: summary.propertyName || 'Upload P&L / B/S on Financials' },
        { label: 'Active Loans', value: fmtUsd(summary.loanBalance), accent: summary.loanBalance > 0 ? RED : undefined },
      ],
    }];
  }

  const enriched = enrichPropDevFinWithCf(fin, company);
  const anchor = propDevPeriodAnchor(period, pMonth, pYear);
  const payload = buildPropDevBoardExportPayload(
    enriched,
    company,
    allLoans,
    anchor,
    selectedYear,
    periodLabel,
  );
  const lastPl = pickFocusSnapshot(payload.plSnapshots, payload.focusYear);
  const lastBs = pickFocusSnapshot(payload.bsSnapshots, payload.focusYear);
  const lastCf = pickFocusSnapshot(payload.cfSnapshots, payload.focusYear);

  const blocks: SectionPdfBlock[] = [{
    heading: summary.companyName,
    pageBreakBefore,
    forcePageBreak: pageBreakBefore,
    kpis: [
      { label: 'Revenue', value: fmtUsd(lastPl?.rev ?? 0), sub: lastPl?.yearLabel },
      { label: 'Expenses', value: fmtUsd(lastPl?.exp ?? 0) },
      { label: 'Net Income', value: fmtUsdAcct(lastPl?.netInc ?? 0), accent: (lastPl?.netInc ?? 0) < 0 ? RED : GREEN },
      { label: 'NOI', value: fmtUsdAcct(lastPl?.noi ?? 0) },
      { label: 'Total Assets', value: fmtUsd(lastBs?.totalAssets ?? 0) },
      { label: 'Total Debt', value: fmtUsd(lastBs?.totalDebt ?? 0), accent: (lastBs?.totalDebt ?? 0) > 0 ? RED : undefined },
      { label: 'Cash', value: fmtUsd(lastBs?.cash ?? 0) },
      { label: 'LTLV', value: fmtPct(lastBs?.ltlv ?? null) },
      { label: 'Operating CF', value: fmtUsdAcct(lastCf?.operatingCf ?? 0) },
      { label: 'Net Cash Flow', value: fmtUsdAcct(lastCf?.netCashFlow ?? 0) },
    ],
  }];

  if (payload.plSnapshots.length) {
    blocks.push({
      heading: `${summary.companyName} — Multi-Year P&L Snapshot`,
      tables: [{
        title: 'P&L Subtotals',
        headers: ['Year', 'Revenue', 'Expenses', 'Net Income', 'NOI', 'Margin %'],
        rows: payload.plSnapshots.map(s => [
          s.yearLabel,
          fmtUsd(s.rev),
          fmtUsd(s.exp),
          fmtUsdAcct(s.netInc),
          fmtUsdAcct(s.noi),
          fmtPct(s.margin),
        ]),
        negativeLastCol: true,
        keepTogether: true,
      }],
    });
  }

  if (payload.bsSnapshots.length) {
    blocks.push({
      heading: `${summary.companyName} — Multi-Year Balance Sheet Snapshot`,
      tables: [{
        title: 'Balance Sheet Subtotals',
        headers: ['Year', 'Total Assets', 'Total Debt', 'Equity', 'Cash', 'LTLV %'],
        rows: payload.bsSnapshots.map(s => [
          s.yearLabel,
          fmtUsd(s.totalAssets),
          fmtUsd(s.totalDebt),
          fmtUsd(s.equity),
          fmtUsd(s.cash),
          fmtPct(s.ltlv),
        ]),
        keepTogether: true,
      }],
    });
  }

  if (payload.cfSnapshots.length) {
    blocks.push({
      heading: `${summary.companyName} — Multi-Year Cash Flow Snapshot`,
      tables: [{
        title: 'Cash Flow Subtotals',
        headers: ['Year', 'Operating CF', 'Investing CF', 'Financing CF', 'Net Cash Flow', 'Closing Cash'],
        rows: payload.cfSnapshots.map(s => [
          s.yearLabel,
          fmtUsdAcct(s.operatingCf),
          fmtUsdAcct(s.investingCf),
          fmtUsdAcct(s.financingCf),
          fmtUsdAcct(s.netCashFlow),
          fmtUsd(s.closingCash),
        ]),
        negativeLastCol: true,
        keepTogether: true,
      }],
    });
  }

  return blocks;
}

export function buildPropDevPortfolioPdfPayload(input: {
  companies: CompanyData[];
  financialsById: Record<string, PDFinancialsLike>;
  allLoans: Loan[];
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
  periodLabel: string;
  /** Properties → Calculations → Property Tax Tracker data, portfolio-wide. */
  taxRows?: PropDevPropertyTaxRow[];
  generatedAt?: string;
}): SectionPdfPayload {
  const entities = input.companies.map(c =>
    buildEntitySummary(
      c,
      input.financialsById[c.id],
      input.allLoans,
      input.period,
      input.pMonth,
      input.pYear,
      input.selectedYear,
      input.periodLabel,
    ),
  );
  const withFin = entities.filter(e => e.hasFinancials);
  const totalRev = withFin.reduce((s, e) => s + e.rev, 0);
  const totalNi = withFin.reduce((s, e) => s + e.netInc, 0);

  const revChart = withFin
    .filter(e => Math.abs(e.rev) > 0)
    .sort((a, b) => b.rev - a.rev)
    .slice(0, 12)
    .map((e, i) => ({
      label: e.companyName.length > 22 ? `${e.companyName.slice(0, 20)}…` : e.companyName,
      value: Math.abs(e.rev),
      color: [GOLD, GREEN, '#0F766E', '#1F6FEB', '#F5A623', RED][i % 6],
    }));

  // Same rich Portfolio Overview / Capital Structure / Property Tax Tracker sections
  // as the single-entity CFO Dashboard export, aggregated across every company here
  // instead of scoped to one. Per-company P&L/BS/CF stays subtotals-only below (entity
  // detail blocks) -- line-item statement labels aren't guaranteed to line up across
  // differently-structured entities, so this deliberately doesn't try to merge them.
  const exportAnchorYear = input.period ? input.pYear : input.selectedYear;
  const periodAnchor = propDevPeriodAnchor(input.period, input.pMonth, input.pYear);
  const kpisById: Record<string, PropDevCompanyOverviewKpis> = {};
  for (const c of input.companies) {
    const cFin = input.financialsById[c.id] ?? null;
    const scopedCFin = cFin ? scopePropDevFinToPeriod(cFin, periodAnchor) : cFin;
    kpisById[c.id] = propDevCompanyOverviewKpis(c, scopedCFin, input.allLoans, exportAnchorYear);
  }
  const richPortfolioBlocks = buildPropDevPortfolioOverviewBlocks(input.companies, kpisById, input.allLoans);
  const capitalStructureBlocks = buildCapitalStructureBlocks(input.companies, kpisById);
  const taxBlocks = buildPropertyTaxTrackerBlocks(input.taxRows ?? []);

  const financialsSummaryBlock: SectionPdfBlock = {
    heading: 'Portfolio Financials Summary',
    pageBreakBefore: true,
    forcePageBreak: true,
    kpis: [
      { label: 'Entities', value: String(input.companies.length) },
      { label: 'With Financials', value: String(withFin.length) },
      { label: 'Portfolio Revenue', value: fmtUsd(totalRev), sub: input.periodLabel },
      { label: 'Portfolio Net Income', value: fmtUsdAcct(totalNi), accent: totalNi < 0 ? RED : GREEN },
    ],
    charts: revChart.length
      ? [{
        title: 'Revenue by Entity (focus period)',
        subtitle: input.periodLabel,
        svg: svgHorizontalBarChart(revChart, {
          width: 620,
          height: Math.max(160, revChart.length * 26 + 48),
          valueFormat: 'money',
        }),
      }]
      : [],
    chartsLayout: 'stack',
  };

  if (capitalStructureBlocks[0]) { capitalStructureBlocks[0].pageBreakBefore = true; capitalStructureBlocks[0].forcePageBreak = true; }
  if (taxBlocks[0]) { taxBlocks[0].pageBreakBefore = true; taxBlocks[0].forcePageBreak = true; }

  const entityBlocks: SectionPdfBlock[] = [];
  input.companies.forEach((c, i) => {
    const summary = entities[i];
    entityBlocks.push(
      ...buildEntityBlocks(
        c,
        input.financialsById[c.id],
        summary,
        input.allLoans,
        input.period,
        input.pMonth,
        input.pYear,
        input.selectedYear,
        input.periodLabel,
        true,
      ),
    );
  });

  const strategy = buildPortfolioStrategy(entities);

  return {
    tab: 'propdev-portfolio-financials',
    sectionTitle: 'Portfolio Financials',
    fileSectionName: 'PortfolioFinancials',
    entityLabel: `All Companies (${input.companies.length})`,
    periodLabel: input.periodLabel,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    strategy,
    sourceNote: 'Property Dev → Financials · All Companies · subtotals only (no line-item YoY)',
    kpis: [],
    charts: [],
    blocks: [...richPortfolioBlocks, financialsSummaryBlock, ...capitalStructureBlocks, ...taxBlocks, ...entityBlocks],
    liveParityNotes: [
      'Portfolio Overview / Capital Structure / Property Tax mirror the same sections on the single-entity CFO Dashboard export, aggregated across all companies.',
      'Per-entity P&L / B/S / CF stays subtotals only — export a single entity for full line-item YoY tables.',
    ],
  };
}
