/**
 * Cross-entity Prop Dev current-period reconciliation:
 * summary/KPI cards vs YoY Detail (+ loan maturity / missing-BS flags).
 * Used by the in-app Validate All button (authenticated session) and the CLI script.
 */
import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import { buildPropDevBoardExportPayload, pickFocusSnapshot } from './gatherPropDevBoardExportData';
import type { PropDevUploadedFinancials } from './propDevFinancialApi';
import { matchYearValue } from './propDevStatementLabels';
import { pdKpisForScope, propDevPeriodAnchor } from './propDevPeriodKpis';
import { getPropDevRevenueForYear } from './propDevRevenueBreakdown';
import { resolveCompanyUploadedFinancials, resolvePropDevCfItems } from './propDevYearlyFinancials';
import type { Period } from './periodWindow';

export type PropDevValidationMismatch = {
  entity: string;
  area: 'Balance Sheet' | 'P&L' | 'Cash Flow' | 'Cross-Statement' | 'Loan Register' | 'Data Import';
  metric: string;
  summary: string;
  detail: string;
  note?: string;
};

export type PropDevValidationReport = {
  period: Period;
  month: number;
  year: number;
  checked: number;
  skipped: string[];
  mismatches: PropDevValidationMismatch[];
};

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
}

function approxEqual(a: number, b: number, tolerance = 1): boolean {
  return Math.abs(a - b) <= tolerance;
}

function pushIfMismatch(
  out: PropDevValidationMismatch[],
  entity: string,
  area: PropDevValidationMismatch['area'],
  metric: string,
  summaryValue: number,
  detailValue: number,
  note?: string,
  tolerance = 1,
) {
  if (approxEqual(summaryValue, detailValue, tolerance)) return;
  out.push({
    entity,
    area,
    metric,
    summary: fmtMoney(summaryValue),
    detail: fmtMoney(detailValue),
    note,
  });
}

function readNetIncome(items: PropDevUploadedFinancials['pl'], year: number): number {
  return matchYearValue(items, /^net\s+income$/i, year)
    || matchYearValue(items, /^net\s+profit/i, year)
    || matchYearValue(items, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i, year);
}

function readBsCash(items: PropDevUploadedFinancials['bs'], year: number): number {
  return Math.abs(
    matchYearValue(items, /^total\s+for\s+bank/i, year)
    || matchYearValue(items, /cash\s+and\s+bank/i, year)
    || matchYearValue(items, /bank\s+balances?/i, year)
    || matchYearValue(items, /^cash$/i, year),
  );
}

function readBsAssets(items: PropDevUploadedFinancials['bs'], year: number): number {
  const total = Math.abs(
    matchYearValue(items, /^total\s+for\s+assets$/i, year)
    || matchYearValue(items, /^total\s+assets$/i, year),
  );
  if (total > 0) return total;
  const fa = Math.abs(
    matchYearValue(items, /fixed\s+assets?/i, year)
    || matchYearValue(items, /property\s*,?\s*plant\s+and\s+equipment/i, year),
  );
  return fa + readBsCash(items, year);
}

function readBsDebt(items: PropDevUploadedFinancials['bs'], year: number): number {
  return Math.abs(
    matchYearValue(items, /^total\s+for\s+liabilities$/i, year)
    || matchYearValue(items, /^total\s+liabilities$/i, year)
    || matchYearValue(items, /^long\s*[- ]?term\s+loans?$/i, year),
  );
}

function readBsEquity(items: PropDevUploadedFinancials['bs'], year: number, assets: number, debt: number): number {
  const row = matchYearValue(items, /^total\s+for\s+equity$/i, year)
    || matchYearValue(items, /^total\s+equity$/i, year);
  return row !== 0 ? row : assets - debt;
}

function readCfValue(items: PropDevUploadedFinancials['cf'] | undefined, year: number, re: RegExp): number {
  return matchYearValue(items ?? [], re, year);
}

function isPastMaturity(dateStr: string | undefined, asOf: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < asOf.getTime();
}

export function validatePropDevEntityCurrentPeriod(opts: {
  company: CompanyData;
  fin: PropDevUploadedFinancials;
  allLoans: Loan[];
  period?: Period;
  month?: number;
  year?: number;
  asOf?: Date;
}): PropDevValidationMismatch[] {
  const asOf = opts.asOf ?? new Date();
  const period = opts.period ?? 'YTD';
  const month = opts.month ?? (asOf.getMonth() + 1);
  const year = opts.year ?? asOf.getFullYear();
  const company = opts.company;
  const mismatches: PropDevValidationMismatch[] = [];

  const selectedYear = opts.fin.years.includes(year) ? year : opts.fin.years[opts.fin.years.length - 1];
  const anchor = propDevPeriodAnchor(period, month, selectedYear);
  const payload = buildPropDevBoardExportPayload(
    opts.fin,
    company,
    opts.allLoans,
    anchor,
    selectedYear,
    `${period} through ${month}/${selectedYear}`,
  );
  const scoped = payload.scopedFin;
  const lastBs = pickFocusSnapshot(payload.bsSnapshots, payload.focusYear);
  const lastPl = pickFocusSnapshot(payload.plSnapshots, payload.focusYear);
  const lastCf = pickFocusSnapshot(payload.cfSnapshots, payload.focusYear);
  const targetYear = payload.focusYear
    ?? (scoped.years.includes(selectedYear) ? selectedYear : scoped.years[scoped.years.length - 1]);

  const bsAssetsDetail = readBsAssets(scoped.bs, targetYear);
  const bsDebtDetail = readBsDebt(scoped.bs, targetYear);
  const bsCashDetail = readBsCash(scoped.bs, targetYear);
  const bsEquityDetail = readBsEquity(scoped.bs, targetYear, bsAssetsDetail, bsDebtDetail);

  pushIfMismatch(mismatches, company.name, 'Balance Sheet', 'Total Assets', lastBs?.totalAssets ?? 0, bsAssetsDetail);
  pushIfMismatch(mismatches, company.name, 'Balance Sheet', 'Total Debt', lastBs?.totalDebt ?? 0, bsDebtDetail);
  pushIfMismatch(mismatches, company.name, 'Balance Sheet', 'Cash', lastBs?.cash ?? 0, bsCashDetail);
  pushIfMismatch(mismatches, company.name, 'Balance Sheet', 'Equity', lastBs?.equity ?? 0, bsEquityDetail);

  const plRevenueDetail = getPropDevRevenueForYear(scoped, targetYear, undefined).totalRev;
  const plExpensesDetail = Math.abs(
    matchYearValue(scoped.pl, /^total\s+for\s+(operating\s+)?expenses?$/i, targetYear)
    || matchYearValue(scoped.pl, /^total\s+(operating\s+)?expenses?$/i, targetYear)
    || matchYearValue(scoped.pl, /^total\s+for\s+(cost\s+of\s+(goods|sales)|cogs)/i, targetYear)
    || matchYearValue(scoped.pl, /^total\s+(cost\s+of\s+(goods|sales)|cogs)/i, targetYear)
    || matchYearValue(scoped.pl, /^total\s+costs?$/i, targetYear)
    || (Math.abs(plRevenueDetail) > 0
      ? Math.abs(plRevenueDetail - readNetIncome(scoped.pl, targetYear))
      : 0),
  );
  const plNetIncomeDetail = readNetIncome(scoped.pl, targetYear);
  const plNoiDetail = pdKpisForScope(scoped, targetYear, undefined).noi;

  pushIfMismatch(mismatches, company.name, 'P&L', 'Revenue', lastPl?.rev ?? 0, plRevenueDetail);
  pushIfMismatch(mismatches, company.name, 'P&L', 'Expenses', lastPl?.exp ?? 0, plExpensesDetail);
  pushIfMismatch(mismatches, company.name, 'P&L', 'Net Income', lastPl?.netInc ?? 0, plNetIncomeDetail);
  pushIfMismatch(mismatches, company.name, 'P&L', 'NOI', lastPl?.noi ?? 0, plNoiDetail);

  // Impossible triad: large Revenue, $0 Expenses, Net Income ≠ Revenue.
  if (
    Math.abs(lastPl?.rev ?? 0) > 1
    && Math.abs(lastPl?.exp ?? 0) <= 1
    && Math.abs((lastPl?.netInc ?? 0) - (lastPl?.rev ?? 0)) > 1
  ) {
    mismatches.push({
      entity: company.name,
      area: 'P&L',
      metric: 'Revenue / Expenses / Net Income identity',
      summary: `Rev ${fmtMoney(lastPl?.rev ?? 0)} · Exp ${fmtMoney(lastPl?.exp ?? 0)}`,
      detail: `Net Income ${fmtMoney(lastPl?.netInc ?? 0)}`,
      note: 'Expenses card is blank while Net Income does not equal Revenue — expense total/COGS mapping failed.',
    });
  }

  const cfRows = resolvePropDevCfItems(scoped, company);
  const cfOperatingDetail = readCfValue(cfRows, targetYear, /Operating Cash Flow/i);
  const cfInvestingDetail = readCfValue(cfRows, targetYear, /Investing Cash Flow/i);
  const cfFinancingDetail = readCfValue(cfRows, targetYear, /Financing Cash Flow/i);
  const cfNetChangeDetail = readCfValue(cfRows, targetYear, /Net Change in Cash/i);

  // Snapshot builder vs YoY Detail CF rows — catches stale current-period CF cards.
  pushIfMismatch(mismatches, company.name, 'Cash Flow', 'Operating CF', lastCf?.operatingCf ?? 0, cfOperatingDetail);
  pushIfMismatch(mismatches, company.name, 'Cash Flow', 'Investing CF', lastCf?.investingCf ?? 0, cfInvestingDetail);
  pushIfMismatch(mismatches, company.name, 'Cash Flow', 'Financing CF', lastCf?.financingCf ?? 0, cfFinancingDetail);
  pushIfMismatch(mismatches, company.name, 'Cash Flow', 'Net Cash Flow', lastCf?.netCashFlow ?? 0, cfNetChangeDetail);
  pushIfMismatch(mismatches, company.name, 'Cash Flow', 'Closing Cash', lastCf?.closingCash ?? 0, bsCashDetail);

  if (!approxEqual(bsCashDetail, lastCf?.closingCash ?? 0, 1)) {
    mismatches.push({
      entity: company.name,
      area: 'Cross-Statement',
      metric: 'BS Cash vs CF Closing Cash',
      summary: fmtMoney(bsCashDetail),
      detail: fmtMoney(lastCf?.closingCash ?? 0),
    });
  }

  if (!approxEqual(plNetIncomeDetail, cfOperatingDetail, 1) && (cfOperatingDetail !== 0 || plNetIncomeDetail !== 0)) {
    mismatches.push({
      entity: company.name,
      area: 'Cross-Statement',
      metric: 'P&L Net Income vs CF Operating CF',
      summary: fmtMoney(plNetIncomeDetail),
      detail: fmtMoney(cfOperatingDetail),
      note: 'Flag only — some entities intentionally diverge when CF has adjustments.',
    });
  }

  const bsAllZero = approxEqual(lastBs?.landValue ?? 0, 0)
    && approxEqual(lastBs?.totalAssets ?? 0, 0)
    && approxEqual(lastBs?.totalDebt ?? 0, 0)
    && approxEqual(lastBs?.cash ?? 0, 0)
    && approxEqual(lastBs?.equity ?? 0, 0);
  const otherActivity = !approxEqual(lastPl?.rev ?? 0, 0)
    || !approxEqual(lastPl?.netInc ?? 0, 0)
    || !approxEqual(cfOperatingDetail, 0)
    || !approxEqual(cfNetChangeDetail, 0);
  if (bsAllZero && otherActivity) {
    mismatches.push({
      entity: company.name,
      area: 'Data Import',
      metric: 'Balance Sheet all zero while other modules active',
      summary: 'All summary BS metrics = $0',
      detail: `P&L/CF activity present for ${targetYear}`,
      note: 'Likely missing BS import / join rather than a calculation bug.',
    });
  }

  for (const loan of company.loans) {
    if (loan.status !== 'Active') continue;
    if (!isPastMaturity(loan.maturityDate, asOf)) continue;
    mismatches.push({
      entity: company.name,
      area: 'Loan Register',
      metric: `${loan.bank || 'Loan'} maturity/status`,
      summary: `Active · ${loan.maturityDate || 'no maturity'}`,
      detail: `Past maturity as of ${asOf.toISOString().slice(0, 10)}`,
      note: 'Should be Matured or Review Required instead of routine Active.',
    });
  }

  return mismatches;
}

export function validatePropDevPortfolioCurrentPeriod(opts: {
  companies: CompanyData[];
  financialsByCompanyId: Record<string, PropDevUploadedFinancials | null | undefined>;
  allLoans: Loan[];
  period?: Period;
  month?: number;
  year?: number;
}): PropDevValidationReport {
  const asOf = new Date();
  const period = opts.period ?? 'YTD';
  const month = opts.month ?? (asOf.getMonth() + 1);
  const year = opts.year ?? asOf.getFullYear();
  const mismatches: PropDevValidationMismatch[] = [];
  const skipped: string[] = [];
  let checked = 0;

  for (const company of opts.companies) {
    const apiFin = opts.financialsByCompanyId[company.id] ?? null;
    const fin = resolveCompanyUploadedFinancials(company, apiFin);
    if (!fin || (!fin.pl.length && !fin.bs.length && !(fin.cf?.length ?? 0))) {
      skipped.push(company.name);
      continue;
    }
    checked += 1;
    try {
      mismatches.push(...validatePropDevEntityCurrentPeriod({
        company,
        fin,
        allLoans: opts.allLoans,
        period,
        month,
        year,
        asOf,
      }));
    } catch (err) {
      mismatches.push({
        entity: company.name,
        area: 'Data Import',
        metric: 'Validation runtime error',
        summary: 'Could not validate entity',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { period, month, year, checked, skipped, mismatches };
}

export function formatPropDevValidationReport(report: PropDevValidationReport): string {
  const lines: string[] = [
    `Prop Dev validation — ${report.period} through ${report.month}/${report.year}`,
    `Checked: ${report.checked} · Skipped (no financials): ${report.skipped.length}`,
  ];
  if (report.skipped.length) lines.push(`Skipped: ${report.skipped.join(', ')}`);
  lines.push('');
  if (!report.mismatches.length) {
    lines.push('No mismatches found.');
    return lines.join('\n');
  }
  const byEntity = new Map<string, PropDevValidationMismatch[]>();
  for (const row of report.mismatches) {
    const bucket = byEntity.get(row.entity) ?? [];
    bucket.push(row);
    byEntity.set(row.entity, bucket);
  }
  for (const [entity, rows] of byEntity.entries()) {
    lines.push(`## ${entity}`);
    for (const row of rows) {
      const tail = row.note ? ` | ${row.note}` : '';
      lines.push(`- [${row.area}] ${row.metric}: summary=${row.summary} | detail=${row.detail}${tail}`);
    }
    lines.push('');
  }
  lines.push(`Total mismatches: ${report.mismatches.length}`);
  return lines.join('\n');
}
