/** Orchestrates the Property Dev "Export PDF" — reuses Rentals' generic HTML/PDF renderer. */
import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import type { Period } from './periodWindow';
import { periodChipText } from './periodWindow';
import { downloadSectionPdf } from './sectionPdfExport';
import { buildPropDevBoardExportPayload } from './gatherPropDevBoardExportData';
import {
  buildPropDevFinancialsScopePayload,
  type PropDevFinancialsPdfScope,
  type PropDevFinancialsPdfPortfolioCtx,
} from './gatherPropDevSectionPdfData';
import { generatePropDevStrategyPlan } from './propDevExportNarrative';
import { propDevPeriodAnchor } from './propDevPeriodKpis';
import type { PDFinancialsLike } from './propDevCfoTrendData';
import { enrichPropDevFinWithCf } from './propDevYearlyFinancials';
import {
  buildPropDevCapitalCallsPdfPayload,
  type PropDevCapitalCallsPdfInput,
} from './gatherPropDevCapitalCallsPdfData';
import {
  buildPropDevOwnershipPdfPayload,
  type PropDevOwnershipPdfInput,
} from './gatherPropDevOwnershipPdfData';
import {
  buildPropDevLoansPdfPayload,
  type PropDevLoansPdfInput,
} from './gatherPropDevLoansPdfData';
import { buildPropDevPortfolioPdfPayload } from './gatherPropDevPortfolioPdfData';
import { buildPropDevPropertyProfilePdfPayload } from './gatherPropDevPropertyProfilePdfData';
import type { CompanyData } from '../contexts/PropertyDevContext';

const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function exportPropDevFinancialsPdf(ctx: {
  fin: PDFinancialsLike;
  company: CompanyData | undefined;
  allLoans: Loan[];
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
  scope?: PropDevFinancialsPdfScope;
  /** When provided (CFO Dashboard export), prepends Portfolio Overview + Property Details pages. */
  portfolioCtx?: PropDevFinancialsPdfPortfolioCtx;
}): Promise<void> {
  const scope = ctx.scope ?? 'cfo-dashboard';
  // Match Cash Flow tab: use uploaded CF, else company yearlyCF seed.
  const fin = enrichPropDevFinWithCf(ctx.fin, ctx.company);
  const anchor = propDevPeriodAnchor(ctx.period, ctx.pMonth, ctx.pYear);
  const periodLabel = ctx.period
    ? periodChipText(ctx.period, ctx.pMonth, ctx.pYear)
    : `FY ${ctx.selectedYear} · ${MNAMES[ctx.pMonth - 1]} ${ctx.pYear}`;

  const payload = buildPropDevBoardExportPayload(
    fin, ctx.company, ctx.allLoans, anchor, ctx.selectedYear, periodLabel,
  );
  const strategy = generatePropDevStrategyPlan(payload);
  // Always render from the period-scoped ledger so PDF YoY matches on-screen KPIs.
  const sectionPayload = buildPropDevFinancialsScopePayload(
    payload, payload.scopedFin, strategy, scope, ctx.portfolioCtx,
  );
  await downloadSectionPdf(sectionPayload);
}

/** All Companies portfolio view — same Portfolio Overview / Capital Structure / Property
 *  Tax sections as the single-entity CFO Dashboard export, aggregated across every
 *  company; per-entity P&L/BS/CF stays subtotals only (no YoY line-item detail). */
export async function exportPropDevPortfolioFinancialsPdf(ctx: {
  companies: CompanyData[];
  financialsById: Record<string, PDFinancialsLike>;
  allLoans: Loan[];
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
  taxRows?: import('./propDevCostBasisCalculations').PropDevPropertyTaxRow[];
}): Promise<void> {
  const periodLabel = ctx.period
    ? periodChipText(ctx.period, ctx.pMonth, ctx.pYear)
    : `FY ${ctx.selectedYear} · ${MNAMES[ctx.pMonth - 1]} ${ctx.pYear}`;
  const payload = buildPropDevPortfolioPdfPayload({
    companies: ctx.companies,
    financialsById: ctx.financialsById,
    allLoans: ctx.allLoans,
    period: ctx.period,
    pMonth: ctx.pMonth,
    pYear: ctx.pYear,
    selectedYear: ctx.selectedYear,
    periodLabel,
    taxRows: ctx.taxRows,
  });
  await downloadSectionPdf(payload);
}

/** Capital Calls page → Export PDF (same renderer as Financials). */
export async function exportPropDevCapitalCallsPdf(
  input: PropDevCapitalCallsPdfInput,
): Promise<void> {
  await downloadSectionPdf(buildPropDevCapitalCallsPdfPayload(input));
}

/** Ownership / Partners page → Export PDF. */
export async function exportPropDevOwnershipPdf(
  input: PropDevOwnershipPdfInput,
): Promise<void> {
  await downloadSectionPdf(buildPropDevOwnershipPdfPayload(input));
}

/** Loan Tracker page → Export PDF. */
export async function exportPropDevLoansPdf(
  input: PropDevLoansPdfInput,
): Promise<void> {
  await downloadSectionPdf(buildPropDevLoansPdfPayload(input));
}

/** Property Profile detail page → Export PDF. */
export async function exportPropDevPropertyProfilePdf(company: CompanyData): Promise<void> {
  await downloadSectionPdf(buildPropDevPropertyProfilePdfPayload(company));
}

/** Executive Summary → "Export Board Pack" (per-entity, client-side jsPDF — no server infra). */
export async function exportPropDevExecSummaryBoardPackPdf(params: {
  company: CompanyData;
  kpis: import('./propDevCompanyOverview').PropDevCompanyOverviewKpis | undefined;
  payload: import('./gatherPropDevBoardExportData').PropDevBoardExportPayload;
  allLoans: Loan[];
  periodLabel: string;
}): Promise<void> {
  const { buildPropDevExecSummaryBoardPackPdf } = await import('./gatherPropDevExecSummaryBoardPackPdfData');
  await downloadSectionPdf(buildPropDevExecSummaryBoardPackPdf(params));
}

/** @deprecated Prefer exportPropDevFinancialsPdf({ scope: 'cfo-dashboard' }) */
export async function exportPropDevCfoDashboardPdf(ctx: {
  fin: PDFinancialsLike;
  company: CompanyData | undefined;
  allLoans: Loan[];
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
}): Promise<void> {
  await exportPropDevFinancialsPdf({ ...ctx, scope: 'cfo-dashboard' });
}
