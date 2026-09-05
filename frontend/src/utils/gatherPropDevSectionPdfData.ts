/**
 * Builds the Property Dev "Export PDF" board pack — same SectionPdfBlock/SectionPdfPayload
 * shapes as Rentals' buildCfoDashboardBoardBlocks (gatherSectionPdfData.ts), so it reuses
 * the exact same generic renderer (sectionPdfHtml.ts) and chart builders (sectionPdfCharts.ts).
 * Sections are Property Dev-appropriate (Land/LTLV/EMI/Capital Calls) rather than
 * occupancy/GPR/vacancy.
 *
 * Scopes mirror Rentals Financials Export PDF dropdown (CFO / P&L / BS / CF / Combined).
 */
import type {
  SectionPdfAlert, SectionPdfBlock, SectionPdfKpi, SectionPdfPayload, SectionPdfTable,
} from './gatherSectionPdfData';
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import { pickFocusSnapshot, type PropDevBoardExportPayload } from './gatherPropDevBoardExportData';
import type { PDFinancialsLike, PDFinItemLike } from './propDevCfoTrendData';
import { clubPartnerInvestmentCfRows } from './propDevYearlyFinancials';
import {
  isIntercompanyLoanLabel,
  isDroppedStatementLineLabel,
  sanitizeStatementLineLabel,
  tidyPropDevStatementRows,
  sortPropDevPlExpenseRowsByAmount,
  isTaxesPaidBoardLineLabel,
  rowHasMeaningfulYearAmount,
  isMajorPropDevStatementBanner,
  ensureTaxesPaidFoldedIntoPropertyTaxes,
} from './finItemYearUtils';
import {
  svgBarChart, svgDoughnut, svgHorizontalBarChart, svgLineChart, svgMultiBarLineChart, svgSignedGroupedBarChart,
} from './sectionPdfCharts';
import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import { propDevPortfolioOverview, type PropDevCompanyOverviewKpis } from './propDevCompanyOverview';
import {
  sumActiveMonthlyEmi, isActivePropDevLoan, resolveLandValue,
  computeCapitalCallCoverage, formatCoverageRatio,
} from './propDevLoanMetrics';
import { groupTaxByEntity, type PropDevPropertyTaxRow } from './propDevCostBasisCalculations';

// Multi-category chart palette (Debt by Lender, Expense/Revenue Breakdown) — gold,
// navy, and muted blue/purple/amber/teal for distinguishing many arbitrary categories.
// Deliberately excludes red/green: those are reserved for negative/positive financial
// semantics elsewhere (Total Debt, Debt vs Equity, LTLV) and must never appear here,
// where they'd misread as "bad"/"good" on a category that's neither.
const CHART_COLORS = ['#C9A84C', '#1A1A2E', '#2E4C8A', '#6B4E8E', '#C08A2E', '#3E7C8C', '#B8962E', '#6B6B6B'];

export type PropDevFinancialsPdfScope =
  | 'cfo-dashboard'
  | 'income-statement'
  | 'balance-sheet'
  | 'cash-flow'
  | 'combined';

export const PROPDEV_FINANCIALS_PDF_SCOPE_OPTIONS: { id: PropDevFinancialsPdfScope; label: string }[] = [
  { id: 'cfo-dashboard', label: 'CFO Dashboard (+ Snapshot / P&L / BS / CF)' },
  { id: 'income-statement', label: 'Income Statement' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'combined', label: 'Combined (All)' },
];

const SCOPE_TITLES: Record<PropDevFinancialsPdfScope, string> = {
  'cfo-dashboard': 'CFO Dashboard',
  'income-statement': 'Income Statement',
  'balance-sheet': 'Balance Sheet',
  'cash-flow': 'Cash Flow',
  combined: 'Financials Combined',
};

const SCOPE_FILES: Record<PropDevFinancialsPdfScope, string> = {
  'cfo-dashboard': 'CFODashboard',
  'income-statement': 'IncomeStatement',
  'balance-sheet': 'BalanceSheet',
  'cash-flow': 'CashFlow',
  combined: 'FinancialsCombined',
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
  // Accounting-style negatives for all companies: ($1,234) not -$1,234.
  return n < 0 ? `(${abs})` : abs;
}

/** Alias — same accounting brackets as fmtUsd (kept for call-site clarity). */
function fmtUsdAcct(n: number): string {
  return fmtUsd(n);
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const body = `${Math.abs(n).toFixed(1)}%`;
  return n < 0 ? `(${body})` : body;
}

function topEntries(rec: Record<string, number>, n = 8): { label: string; value: number }[] {
  return Object.entries(rec)
    .map(([label, value]) => ({ label, value: Math.abs(Number(value) || 0) }))
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

function yearVal(values: Record<number | string, number> | undefined, y: number): number {
  if (!values) return 0;
  const raw = values[y] ?? values[String(y) as unknown as number];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && String(raw).trim() !== '') {
    const n = Number(String(raw).replace(/[,$]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function yearsWithNonZeroValues(items: PDFinItemLike[]): number[] {
  const ys = new Set<number>();
  for (const item of items) {
    for (const k of Object.keys(item.values ?? {})) {
      const n = Number(k);
      if (!Number.isFinite(n) || n < 1990 || n > 2100) continue;
      if (yearVal(item.values, n) !== 0) ys.add(n);
    }
  }
  return [...ys].sort((a, b) => a - b);
}

function normStatementLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowHasYearAmount(item: PDFinItemLike, years: number[]): boolean {
  return years.some(y => yearVal(item.values, y) !== 0);
}

/** Income structure rows stay visible with — even when every year is $0. */
function keepZeroYoyIncomeRow(item: PDFinItemLike): boolean {
  const label = item.label.trim();
  if (item.isSectionHeader && /^(income|other\s+income)$/i.test(label)) return true;
  if (/^income$/i.test(label) || /^other\s+income$/i.test(label)) return true;
  return false;
}

/**
 * Drop section headers that have no amount-bearing children before the next header.
 * After clubbing (Advertising, Sale of Property, …) orphan banners look like blank rows.
 */
function dropOrphanYoySectionHeaders(
  items: PDFinItemLike[],
  years: number[],
): PDFinItemLike[] {
  if (!items.length) return items;
  const keep = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!isStatementHeaderRow(item)) {
      keep.add(i);
      continue;
    }
    let hasChild = false;
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j]!;
      if (isStatementHeaderRow(next)) break;
      if (next.isNetIncome) {
        hasChild = true;
        break;
      }
      if (years.some(y => Math.abs(yearVal(next.values, y)) > 0.005)) {
        hasChild = true;
        break;
      }
    }
    if (hasChild) keep.add(i);
  }
  return items.filter((_, i) => keep.has(i));
}

/** All-zero Gross Profit rows add noise for land-holding entities — drop them. */
function isZeroGrossProfitRow(item: PDFinItemLike, years: number[]): boolean {
  if (!/^(total\s+for\s+)?gross\s+profit$/i.test(item.label.trim())) return false;
  return !years.some(y => yearVal(item.values, y) !== 0);
}

/** Section headers / bare category labels should never print $0 in the PDF. */
function isStatementHeaderRow(item: PDFinItemLike): boolean {
  if (item.isTotal || item.isNetIncome) return false;
  const hasAmount = Object.keys(item.values ?? {}).some(k => {
    const y = Number(k);
    return Number.isFinite(y) && Math.abs(yearVal(item.values, y)) > 0.005;
  });
  // Rolled-up category lines keep amounts even if the header flag is missing.
  if (hasAmount) return false;
  return isMajorPropDevStatementBanner(item.label);
}

/** QuickBooks footer/meta lines that should never appear in statement tables. */
function isStatementJunkRow(item: PDFinItemLike): boolean {
  const label = item.label.replace(/\s+/g, ' ').trim();
  if (!label) return true;
  if (isDroppedStatementLineLabel(label)) return true;
  if (/accrual\s+basis|cash\s+basis/i.test(label)) return true;
  if (/\bGMT\s*[+-]?\s*\d/i.test(label)) return true;
  if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(label) && /\d{4}/.test(label)) return true;
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b.+\d{4}.+\d{1,2}:\d{2}/i.test(label)) return true;
  if (/^\d{1,2}:\d{2}\s*(am|pm)\b/i.test(label)) return true;
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(label)) return true;
  if (/^\d{4}[\s\-]/.test(label)) return true;
  return false;
}

function intercompanyLoanHasActivity(item: PDFinItemLike): boolean {
  return Object.keys(item.values ?? {}).some(k => {
    const y = Number(k);
    return Number.isFinite(y) && yearVal(item.values, y) !== 0;
  });
}

/**
 * Full YoY line-item table — same rules as Construction CFO PDF (detail lines + headers/
 * totals/net). Previously Prop Dev kept only totals, which produced "Total for …" only.
 */
function buildYoyTable(
  items: PDFinItemLike[],
  years: number[],
  title: string,
): SectionPdfTable | null {
  // Always club CF partner detail lines here so no export path can miss it.
  const source = /cash\s*flow/i.test(title)
    ? clubPartnerInvestmentCfRows(items as Parameters<typeof clubPartnerInvestmentCfRows>[0])
    : items;
  if (!source.length) return null;
  const cleaned = source.filter(i => !isStatementJunkRow(i));
  if (!cleaned.length) return null;

  const activeYears = (years.length ? years : yearsWithNonZeroValues(cleaned))
    .filter(y => cleaned.some(i => !isStatementHeaderRow(i) && yearVal(i.values, y) !== 0));
  if (!activeYears.length) return null;

  // Tidy first (club partner sections / duplicates, drop empty bands + $0 lines).
  const sheet: 'pl' | 'bs' | 'cf' | undefined = /cash\s*flow/i.test(title)
    ? 'cf'
    : /balance\s*sheet/i.test(title)
      ? 'bs'
      : /p\s*&\s*l|profit|income\s+statement/i.test(title)
        ? 'pl'
        : undefined;
  // Prop Dev keeps full QBO detail (all non-zero lines). Rental board clubbing stays on tidyStatementRows.
  // Guarantee: never let "Taxes paid" survive next to "Property taxes" in the exported table.
  const tidied = ensureTaxesPaidFoldedIntoPropertyTaxes(tidyPropDevStatementRows(cleaned, activeYears, sheet));
  // Final gate: no line that would print only "—" across every year column.
  const filtered = tidied.filter(item => {
    if (isZeroGrossProfitRow(item, activeYears)) return false;
    if (item.isNetIncome) return true;
    if (isMajorPropDevStatementBanner(item.label) || keepZeroYoyIncomeRow(item)) return true;
    if ((/balance\s*sheet|cash\s*flow/i.test(title)) && isIntercompanyLoanLabel(item.label)) {
      return intercompanyLoanHasActivity(item);
    }
    return rowHasMeaningfulYearAmount(item, activeYears);
  });
  if (!filtered.length) return null;

  const labelsWithData = new Set(
    filtered
      .filter(i => !isStatementHeaderRow(i) && rowHasMeaningfulYearAmount(i, activeYears))
      .map(i => normStatementLabel(i.label)),
  );
  const deduped = dropOrphanYoySectionHeaders(
    filtered.filter(item => {
      if (!isStatementHeaderRow(item)) return true;
      return !labelsWithData.has(normStatementLabel(item.label));
    }),
    activeYears,
  ).filter(item => {
    if (item.isNetIncome) return true;
    if (isMajorPropDevStatementBanner(item.label)) return true;
    return rowHasMeaningfulYearAmount(item, activeYears);
  });
  if (!deduped.length) return null;

  const ordered = sheet === 'pl'
    ? sortPropDevPlExpenseRowsByAmount(deduped, activeYears, { synthesizeMissingPinned: false })
      .filter(i => !isTaxesPaidBoardLineLabel(i.label))
    : deduped;
  if (!ordered.length) return null;

  const rowKinds: SectionPdfTable['rowKinds'] = [];
  const rows = ordered.map(item => {
    const header = isStatementHeaderRow(item);
    rowKinds!.push(
      item.isNetIncome ? 'net'
        : item.isTotal || /^total\s+for\b/i.test(item.label.trim()) ? 'total'
          : header ? 'header'
            : 'detail',
    );
    const amounts = activeYears.map(y => {
      // Match Properties: section banners blank; zero amounts show $0 (not —).
      if (header) return '';
      const v = yearVal(item.values, y);
      return v === 0 ? '$0' : fmtUsdAcct(v);
    });
    const indent = Math.min(item.indent ?? 0, 2);
    const label = `${'  '.repeat(indent)}${sanitizeStatementLineLabel(item.label)}`;
    return [label, ...amounts];
  });
  return { title, headers: ['Line Item', ...activeYears.map(String)], rows, rowKinds };
}

/** Split long YoY statement tables — exact Construction pattern (no mid-table canvas cuts). */
function paginateYoyTable(table: SectionPdfTable, rowsPerPage = 22): SectionPdfTable[] {
  if (table.rows.length <= rowsPerPage) {
    return [{ ...table, keepTogether: true }];
  }
  const pages: SectionPdfTable[] = [];
  for (let start = 0; start < table.rows.length; start += rowsPerPage) {
    const end = start + rowsPerPage;
    pages.push({
      ...table,
      keepTogether: true,
      rows: table.rows.slice(start, end),
      rowKinds: table.rowKinds?.slice(start, end),
    });
  }
  return pages;
}

/**
 * Construction parity: every P&L / BS / CF page chunk starts on a forced fresh page.
 * Do NOT emit one giant table-wide block — the PDF slicer will cut mid-Equity and leave blanks.
 */
function pushYoyStatementBlocks(
  blocks: SectionPdfBlock[],
  table: SectionPdfTable | null,
): void {
  if (!table) return;
  const pages = paginateYoyTable(table, 22);
  pages.forEach((page, idx) => {
    blocks.push({
      heading: idx === 0
        ? `${table.title} — YoY Detail`
        : `${table.title} — YoY Detail (continued)`,
      pageBreakBefore: true,
      forcePageBreak: true,
      tables: [page],
    });
  });
}

/** Construction-style pack: P&L YoY → BS YoY → CF YoY, each force-broken onto its own page(s). */
function buildStatementYoyPack(
  data: PropDevBoardExportPayload,
  fin: PDFinancialsLike,
): SectionPdfBlock[] {
  // Prefer period-scoped ledger so YoY Detail matches Multi-Year Snapshot / Command Center.
  const src = data.scopedFin ?? fin;
  const blocks: SectionPdfBlock[] = [];
  pushYoyStatementBlocks(
    blocks,
    buildYoyTable(src.pl, yearsWithNonZeroValues(src.pl), `P&L Statement — ${data.entityLabel}`),
  );
  pushYoyStatementBlocks(
    blocks,
    buildYoyTable(src.bs, yearsWithNonZeroValues(src.bs), `Balance Sheet — ${data.entityLabel}`),
  );

  const cfRows = clubPartnerInvestmentCfRows(Array.isArray(src.cf) ? src.cf : []);
  let cfYoy = buildYoyTable(
    cfRows,
    yearsWithNonZeroValues(cfRows),
    `Cash Flow Statement — ${data.entityLabel}`,
  );
  if (!cfYoy && cfRows.length) {
    const nonzero = yearsWithNonZeroValues(cfRows);
    const fallbackYears = nonzero.length ? nonzero : data.years;
    if (fallbackYears.length) {
      const cleaned = cfRows.filter(i => !isStatementJunkRow(i));
      const rowKinds: SectionPdfTable['rowKinds'] = [];
      const rows = cleaned.map(item => {
        const header = isStatementHeaderRow(item);
        const isTot = item.isTotal || /^total\s+for\b/i.test(item.label.trim());
        rowKinds!.push(
          item.isNetIncome || /net\s+cash|net\s+(increase|decrease|change)/i.test(item.label)
            ? 'net'
            : isTot ? 'total' : header ? 'header' : 'detail',
        );
        return [
          `${'  '.repeat(Math.min(item.indent ?? 0, 2))}${item.label}`,
          ...fallbackYears.map(y => {
            if (header) return '';
            const v = yearVal(item.values, y);
            return v === 0 ? '$0' : fmtUsdAcct(v);
          }),
        ];
      });
      if (rows.length) {
        cfYoy = {
          title: `Cash Flow Statement — ${data.entityLabel}`,
          headers: ['Line Item', ...fallbackYears.map(String)],
          rows,
          rowKinds,
        };
      }
    }
  }
  // Last resort: multi-year CF snapshots (uploaded summary / yearlyCF / derived) so we
  // never show "not uploaded" when CFO charts already have cash-flow numbers.
  if (!cfYoy && data.cfSnapshots.length) {
    const years = data.cfSnapshots.map(s => s.year);
    const labels: Array<{ label: string; pick: (s: (typeof data.cfSnapshots)[0]) => number; kind: 'detail' | 'net' }> = [
      { label: 'Operating Cash Flow', pick: s => s.operatingCf, kind: 'detail' },
      { label: 'Investing Cash Flow', pick: s => s.investingCf, kind: 'detail' },
      { label: 'Financing Cash Flow', pick: s => s.financingCf, kind: 'detail' },
      { label: 'Net Change in Cash', pick: s => s.netCashFlow, kind: 'net' },
      { label: 'Opening Cash', pick: s => s.openingCash, kind: 'detail' },
      { label: 'Closing Cash', pick: s => s.closingCash, kind: 'detail' },
    ];
    cfYoy = {
      title: `Cash Flow Statement — ${data.entityLabel}`,
      headers: ['Line Item', ...years.map(String)],
      rows: labels.map(row => [
        row.label,
        ...data.cfSnapshots.map(s => {
          const v = row.pick(s);
          return v === 0 ? '$0' : fmtUsdAcct(v);
        }),
      ]),
      rowKinds: labels.map(r => r.kind),
    };
  }
  if (cfYoy) {
    pushYoyStatementBlocks(blocks, cfYoy);
  } else {
    blocks.push({
      heading: 'Cash Flow Statement — YoY Detail',
      pageBreakBefore: true,
      forcePageBreak: true,
      tables: [{
        title: 'Cash Flow Statement',
        headers: ['Note'],
        rows: [['No Cash Flow statement uploaded for this company. Use Upload Cash Flow on Financials.']],
      }],
    });
  }
  return blocks;
}

/**
 * Portfolio-wide Executive Summary snapshot — prepended as page 1 of the CFO Dashboard PDF.
 * Mirrors PDPortfolioOverviewTab.tsx's KPI row + Portfolio Summary table, using the same
 * safe `tables:[{headers,rows}]` shape as Multi-Year Snapshot / Loan Register (proven to
 * render correctly at 816px) rather than the wide-alert-table pattern used elsewhere.
 */
/** Mirrors PDPortfolioOverviewTab.tsx's aggregateCapitalCalls — same "as it as" figures. */
function aggregatePortfolioCapitalCalls(companies: CompanyData[]): {
  companyId: string; name: string; totalCalled: number; received: number;
  outstanding: number; overdueAmount: number; overdueCount: number;
}[] {
  return companies
    .map(c => {
      const calls = c.capitalCalls ?? [];
      const totalCalled = calls.reduce((s, cc) => s + (cc.totalDue || 0), 0);
      const received = calls.reduce((s, cc) => s + (cc.received || 0), 0);
      const overdue = calls.filter(cc => cc.status === 'Overdue');
      return {
        companyId: c.id,
        name: c.name,
        totalCalled,
        received,
        outstanding: totalCalled - received,
        overdueAmount: overdue.reduce((s, cc) => s + (cc.totalDue - cc.received), 0),
        overdueCount: overdue.length,
      };
    })
    .filter(r => r.totalCalled > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}

/** Mirrors PDPortfolioOverviewTab.tsx's aggregatePartners — top 10 by total capital. */
function aggregatePortfolioPartners(companies: CompanyData[]): {
  name: string; entityCount: number; totalCapital: number; avgShare: number;
}[] {
  const byName = new Map<string, { capital: number; shareSum: number; count: number; companies: Set<string> }>();
  for (const c of companies) {
    for (const p of c.partners) {
      if ((p.status as string) === 'Exited') continue;
      const key = p.name.trim();
      if (!key) continue;
      const cur = byName.get(key) ?? { capital: 0, shareSum: 0, count: 0, companies: new Set<string>() };
      cur.capital += p.capitalContributed || 0;
      cur.shareSum += p.sharePercent || 0;
      cur.count += 1;
      cur.companies.add(c.id);
      byName.set(key, cur);
    }
  }
  return [...byName.entries()]
    .map(([name, v]) => ({
      name,
      entityCount: v.companies.size,
      totalCapital: v.capital,
      avgShare: v.count ? v.shareSum / v.count : 0,
    }))
    .sort((a, b) => b.totalCapital - a.totalCapital)
    .slice(0, 10);
}

export function buildPropDevPortfolioOverviewBlocks(
  companies: CompanyData[],
  kpisById: Record<string, PropDevCompanyOverviewKpis>,
  allLoans: Loan[],
): SectionPdfBlock[] {
  const rows = companies
    .map(c => ({ c, kpis: kpisById[c.id] }))
    .filter((r): r is { c: CompanyData; kpis: PropDevCompanyOverviewKpis } => !!r.kpis);
  if (!rows.length) return [];

  // Headings below say "All Entities" — only true when there actually are several.
  // When this export is scoped to one entity, label these with its name instead so
  // the page doesn't claim portfolio-wide coverage it isn't showing.
  const scopeLabel = companies.length === 1 ? companies[0].name : 'All Entities';
  const scopeLabelLower = companies.length === 1 ? companies[0].name : 'all entities';

  const summary = propDevPortfolioOverview(rows);
  const totalBank = rows.reduce((s, { kpis }) => s + (kpis.cash ?? 0), 0);
  // Per-company EMI (same fallback used in the table below) — never the raw flat
  // `allLoans` sum, which undercounts when a company's loans live only on c.loans.
  const emiByCompany = rows.map(({ c }) =>
    sumActiveMonthlyEmi(c.loans?.length ? c.loans : allLoans.filter(l => l.companyId === c.id)));
  const totalEmi = emiByCompany.reduce((s, v) => s + v, 0);

  // Same fallback as the EMI calc above — the flat `allLoans` array can be missing
  // loans that only live on a company's own `c.loans`, which silently reduced these
  // "all entities" tables down to whichever single company happened to be present
  // in the flat list. Build the portfolio-wide loan list per-company instead.
  const portfolioLoans = companies.flatMap(c =>
    (c.loans?.length ? c.loans : allLoans.filter(l => l.companyId === c.id)));
  const activeLoans = portfolioLoans.filter(isActivePropDevLoan);

  // Lender Concentration — same per-entity/per-lender % breakdown as the live screen,
  // flattened into one table (the PDF renderer has no per-entity bar-chart groups).
  const lenderConcentrationRows = companies
    .map(c => {
      const byLender = new Map<string, number>();
      for (const l of activeLoans.filter(l2 => l2.companyId === c.id)) {
        byLender.set(l.bank, (byLender.get(l.bank) ?? 0) + (l.balance || 0));
      }
      const totalDebt = [...byLender.values()].reduce((s, v) => s + v, 0);
      return [...byLender.entries()]
        .map(([bank, amt]) => ({ entity: c.name, bank, amt, pct: totalDebt > 0 ? (amt / totalDebt) * 100 : 0 }))
        .sort((a, b) => b.amt - a.amt);
    })
    .flat()
    .sort((a, b) => b.pct - a.pct);

  const capitalCallRows = aggregatePortfolioCapitalCalls(companies);
  const capitalCallTotals = capitalCallRows.reduce((acc, r) => ({
    totalCalled: acc.totalCalled + r.totalCalled,
    received: acc.received + r.received,
    outstanding: acc.outstanding + r.outstanding,
    overdueCount: acc.overdueCount + r.overdueCount,
  }), { totalCalled: 0, received: 0, outstanding: 0, overdueCount: 0 });

  const topPartners = aggregatePortfolioPartners(companies);

  const blocks: SectionPdfBlock[] = [{
    heading: 'Executive Summary — Portfolio Overview',
    kpis: [
      { label: 'Total Land Value', value: fmtUsd(summary.totalLand) },
      { label: 'Total Market Value', value: fmtUsd(summary.totalMarketValue) },
      { label: 'Total Bank', value: fmtUsd(totalBank) },
      { label: 'Total Debt', value: fmtUsd(summary.totalDebt), accent: '#7C3AED' },
      { label: 'Total Loan Outstanding', value: fmtUsd(summary.totalLoanOutstanding), accent: '#6D28D9' },
      { label: 'Total Monthly EMI', value: fmtUsd(totalEmi) },
      { label: 'Portfolio LTLV', value: fmtPct(summary.avgLtlv) },
    ],
    tables: [{
      title: `Portfolio Summary — ${rows.length} entit${rows.length === 1 ? 'y' : 'ies'}`,
      headers: ['Entity', 'Land', 'Market', 'Bank', 'Debt', 'Loan O/S', 'Partners', 'EMI'],
      rows: rows.map(({ c, kpis }, i) => [
        c.name,
        fmtUsd(kpis.landValue ?? 0),
        kpis.fmv != null ? fmtUsd(kpis.fmv) : '—',
        fmtUsd(kpis.cash ?? 0),
        fmtUsd(kpis.loanBalance),
        kpis.loanOutstanding != null ? fmtUsd(kpis.loanOutstanding) : '—',
        String(kpis.partners.length),
        fmtUsd(emiByCompany[i] ?? 0),
      ]),
      keepTogether: false,
    }],
  }];

  if (lenderConcentrationRows.length) {
    blocks.push({
      heading: 'Lender Concentration',
      // Soft break only — forcing a fresh page here left large blank bands once
      // Portfolio Overview was scoped to a single entity (this table is often
      // just 1-2 rows now). pageBreakBefore still prefers a new page once the
      // current page is substantially filled; it just won't force an early one.
      pageBreakBefore: true,
      tables: [{
        title: `Lender Concentration — ${scopeLabelLower}`,
        headers: ['Entity', 'Lender', 'Outstanding', '% of Entity Debt'],
        rows: lenderConcentrationRows.map(r => [r.entity, r.bank, fmtUsd(r.amt), fmtPct(r.pct)]),
        keepTogether: false,
      }],
    });
  }

  if (activeLoans.length) {
    // Same "Company, Property, Bank, Loan Amount, Rate, EMI, Outstanding, Maturity,
    // EMI Day, Call Coverage, Status" columns as the live Loan Register (PD07Loans.tsx)
    // -- this table was missing Property / Loan Amount / EMI Day / Call Coverage.
    const companyById = new Map(companies.map(c => [c.id, c]));
    // Mirrors PD07Loans.tsx's COVERAGE_WINDOW_MONTHS (3) -- not exported from
    // propDevLoanMetrics.ts, so inlined here to match.
    const coverageByCompany = new Map(
      companies.map(c => [c.id, computeCapitalCallCoverage(c, 3, allLoans)]),
    );
    blocks.push({
      heading: 'Loan Portfolio',
      pageBreakBefore: true,
      tables: [{
        title: `Loan Portfolio — ${scopeLabelLower}`,
        headers: ['Company', 'Property', 'Bank', 'Loan Amount', 'Rate', 'EMI', 'Outstanding', 'Maturity', 'EMI Day', 'Call Coverage', 'Status'],
        // 11 columns of mostly short text (not a label + N-numeric-year-columns
        // financial statement) -- dense/textCols avoid the table-wide heuristic
        // squeezing Property/Bank/Status until values overlap. Explicit widths
        // (sum to 100) keep the table inside the page instead of auto-layout
        // overflowing and clipping the rightmost columns.
        dense: true,
        textCols: [1, 2, 10],
        // Company, Property, Bank, Loan Amount, Rate, EMI, Outstanding, Maturity, EMI Day, Call Coverage, Status
        colWidthPct: [13, 13, 9, 9, 6, 8, 9, 8, 7, 9, 9],
        rows: activeLoans.map(l => {
          const days = l.maturityDate ? Math.round((new Date(l.maturityDate).getTime() - Date.now()) / 86400000) : null;
          const status = days == null ? 'Active' : days < 0 ? 'Overdue' : days < 90 ? 'Pending' : 'Active';
          const company = companyById.get(l.companyId);
          const propertyLabel = (l.property || company?.property.name || '—').trim() || '—';
          const coverage = coverageByCompany.get(l.companyId);
          return [
            l.company, propertyLabel, l.bank, fmtUsd(l.amount), `${l.interestRate.toFixed(2)}%`, fmtUsd(l.emi),
            fmtUsd(l.balance),
            l.maturityDate ? new Date(l.maturityDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—',
            String(l.emiDate ?? '—'),
            coverage?.dataGap ? 'N/A' : formatCoverageRatio(coverage?.ratio ?? null),
            status,
          ];
        }),
        keepTogether: false,
      }],
    });
  }

  if (capitalCallRows.length) {
    blocks.push({
      heading: `Capital Calls — ${scopeLabel}`,
      pageBreakBefore: true,
      tables: [{
        title: `Capital Calls — ${scopeLabelLower}`,
        headers: ['Entity', 'Total Called', 'Received', 'Outstanding', 'Overdue'],
        rows: [
          ...capitalCallRows.map(r => [
            r.name, fmtUsd(r.totalCalled), fmtUsd(r.received), fmtUsd(r.outstanding),
            r.overdueCount > 0 ? `${r.overdueCount} · ${fmtUsd(r.overdueAmount)}` : 'None',
          ]),
          ['Portfolio Total', fmtUsd(capitalCallTotals.totalCalled), fmtUsd(capitalCallTotals.received), fmtUsd(capitalCallTotals.outstanding), String(capitalCallTotals.overdueCount)],
        ],
        rowKinds: [...capitalCallRows.map(() => 'detail' as const), 'total' as const],
        keepTogether: false,
      }],
    });
  }

  if (topPartners.length) {
    blocks.push({
      heading: companies.length === 1 ? `Top Partners — ${scopeLabel}` : 'Top Partners by Total Capital Across All Entities',
      pageBreakBefore: true,
      tables: [{
        title: 'Top partners by total capital',
        headers: ['Partner', 'Entities', 'Total Capital', 'Avg Share'],
        rows: topPartners.map(p => [p.name, String(p.entityCount), fmtUsd(p.totalCapital), fmtPct(p.avgShare)]),
        keepTogether: false,
      }],
    });
  }

  return blocks;
}

/**
 * Capital Structure — mirrors PDCapitalStructureTab.tsx Section A (Share Capital
 * Breakdown) "as is", portfolio-wide across all entities with a per-entity
 * breakdown table (same rows as the live stacked bar chart). Sections B
 * (Distribution Waterfall) and C (Partner ROI Summary) are left out of the
 * export — they're manual-entry/API-backed, not derived from the export payload.
 */
export function buildCapitalStructureBlocks(
  companies: CompanyData[],
  kpisById: Record<string, PropDevCompanyOverviewKpis>,
): SectionPdfBlock[] {
  if (!companies.length) return [];

  let classA = 0, classB = 0, bankDebt = 0, capitalRaised = 0;
  const perEntity = companies.map(c => {
    let entityClassA = 0, entityClassB = 0;
    for (const p of c.partners ?? []) {
      if ((p.status as string) === 'Exited') continue;
      if (p.type === 'Class A') entityClassA += p.capitalContributed || 0;
      else entityClassB += p.capitalContributed || 0;
    }
    const entityBankDebt = kpisById[c.id]?.loanBalance ?? 0;
    classA += entityClassA;
    classB += entityClassB;
    bankDebt += entityBankDebt;
    capitalRaised += kpisById[c.id]?.partnerInvestments ?? 0;
    return { name: c.name, classA: entityClassA, classB: entityClassB, bankDebt: entityBankDebt, total: entityClassA + entityClassB + entityBankDebt };
  });
  const shareCapital = classA + classB;
  const capitalStack = capitalRaised + bankDebt;

  return [{
    heading: 'Capital Structure — Share Capital Breakdown',
    kpis: [
      { label: 'Capital Raised', value: fmtUsd(capitalRaised), sub: 'B/S Total for Partner Investments' },
      { label: 'Class A (GP/Promoter)', value: fmtUsd(classA) },
      { label: 'Class B (LP Partners)', value: fmtUsd(classB) },
      { label: 'Bank Debt', value: fmtUsd(bankDebt), accent: '#7C3AED' },
      { label: 'Total Capital Stack', value: fmtUsd(capitalStack), sub: 'Share Capital + Bank' },
    ],
    tables: [{
      title: `Share Capital by Entity — ${companies.length} entit${companies.length === 1 ? 'y' : 'ies'}`,
      headers: ['Entity', 'Class A', 'Class B', 'Bank Debt', 'Total'],
      rows: [
        ...perEntity.map(r => [r.name, fmtUsd(r.classA), fmtUsd(r.classB), fmtUsd(r.bankDebt), fmtUsd(r.total)]),
        ['Portfolio Total', fmtUsd(classA), fmtUsd(classB), fmtUsd(bankDebt), fmtUsd(shareCapital + bankDebt)],
      ],
      rowKinds: [...perEntity.map(() => 'detail' as const), 'total' as const],
      keepTogether: false,
    }],
  }];
}

/**
 * Entity Dashboard — mirrors the Entity Dashboard tab (PDEntityDashboardTab.tsx) on the
 * Entity Executive Summary page "as is": command center KPIs,
 * Property details, Financial snapshot, Loan register, Cash flow,
 * Ownership — partner investments, Balance sheet snapshot.
 */
function buildEntityDashboardBlocks(
  data: PropDevBoardExportPayload,
  company: CompanyData | undefined,
  kpis: PropDevCompanyOverviewKpis | undefined,
): SectionPdfBlock[] {
  if (!company) return [];
  const p = company.property;
  const land = resolveLandValue(company) ?? data.landValue ?? 0;
  const improvements = p.improvements ?? (kpis?.costBasis != null ? kpis.costBasis - land : null);
  const activePartners = company.partners.filter(pt => pt.status !== 'Exited');
  // Falls back to the Ownership sheet's Property Address (per-partner, imported via
  // Annexure/Ownership upload) when the Property Profile itself has no address on
  // file — same fallback as the live Entity Dashboard tab (PDEntityDashboardTab.tsx).
  const location =
    [p.city, p.state].filter(Boolean).join(', ')
    || p.address
    || activePartners.find(pt => pt.propertyAddress)?.propertyAddress
    || '—';
  const outstanding = data.loanRows.reduce((s, l) => s + l.balance, 0);

  const lastBs = pickFocusSnapshot(data.bsSnapshots, data.focusYear);
  const lastPl = pickFocusSnapshot(data.plSnapshots, data.focusYear);
  const lastCf = pickFocusSnapshot(data.cfSnapshots, data.focusYear);

  const financialSnapshotRows: string[][] = [];
  if ((lastPl?.rev ?? 0) !== 0) financialSnapshotRows.push(['Revenue', fmtUsd(lastPl?.rev ?? 0)]);
  financialSnapshotRows.push(
    ['Total expenses', fmtUsd(lastPl?.exp ?? 0)],
    ['Gross profit', fmtUsdAcct((lastPl?.rev ?? 0) - (lastPl?.exp ?? 0))],
    ['Interest paid', fmtUsd(lastPl?.interest ?? 0)],
    ['Net income', fmtUsdAcct(lastPl?.netInc ?? 0)],
    ['Net margin', fmtPct(lastPl?.margin ?? null)],
    ['Bank', fmtUsd(lastBs?.cash ?? 0)],
    ['Cash runway', data.cashRunway.label],
  );

  return [{
    heading: `Entity Dashboard — ${company.name}`,
    kpis: [
      { label: 'Land Value', value: fmtUsd(land) },
      { label: 'Total Assets', value: fmtUsd(lastBs?.totalAssets ?? 0) },
      { label: 'Total Debt', value: fmtUsd(lastBs?.totalDebt ?? data.totalDebt), accent: '#7C3AED' },
      { label: 'LTLV', value: fmtPct(lastBs?.ltlv ?? kpis?.ltlv ?? null), accent: '#C9A84C' },
      { label: 'Monthly EMI', value: fmtUsd(data.totalMonthlyEmi) },
    ],
    tables: [
      {
        title: `Property Details — ${p.name || company.name}`,
        headers: ['Field', 'Value'],
        rows: [
          ['Location', location],
          ['Acres', p.totalAcres > 0 ? `${p.totalAcres} acres` : '—'],
          ['Land cost', fmtUsd(land)],
          ['Improvements', improvements != null ? fmtUsd(improvements) : '—'],
          ['Total debt', fmtUsd(outstanding)],
          ['LTLV', fmtPct(kpis?.ltlv ?? null)],
          ['Previous owner', p.previousOwnerName || '—'],
          ['Tax payable', p.propertyTaxAnnual != null ? fmtUsd(p.propertyTaxAnnual) : '—'],
          ['Partners', activePartners.length > 0 ? `${activePartners.length} investors` : '—'],
          ['Status', p.currentStatus || '—'],
        ],
        keepTogether: true,
        headerStyle: 'navy',
      },
      {
        title: 'Financial Snapshot',
        headers: ['Field', 'Value'],
        rows: financialSnapshotRows,
        keepTogether: true,
        headerStyle: 'navy',
      },
      {
        title: 'Loan Register',
        headers: ['Lender', 'Outstanding', 'Rate', 'EMI', 'Maturity'],
        rows: data.loanRows.length
          ? data.loanRows.map(l => [l.bank, fmtUsd(l.balance), `${l.rate.toFixed(2)}%`, fmtUsd(l.emi), l.maturityDate || '—'])
          : [['No active loans', '—', '—', '—', '—']],
        keepTogether: true,
        headerStyle: 'navy',
      },
      {
        title: 'Cash Flow',
        headers: ['Field', 'Value'],
        rows: [
          ['Operating CF', fmtUsdAcct(lastCf?.operatingCf ?? 0)],
          ['Investing CF', fmtUsdAcct(lastCf?.investingCf ?? 0)],
          ['Financing CF', fmtUsdAcct(lastCf?.financingCf ?? 0)],
          ['Net cash change', fmtUsdAcct(lastCf?.netCashFlow ?? 0)],
          ['Closing cash', fmtUsd(lastCf?.closingCash ?? lastBs?.cash ?? 0)],
        ],
        keepTogether: true,
        headerStyle: 'navy',
      },
      {
        // Share % derived from actual capital contributed (capital call sheet), not the
        // imported sharePercent field -- that column is frequently blank per-partner on
        // the source Excel even when Capital is populated. Mirrors PDEntityDashboardTab.tsx.
        title: 'Ownership — Partner Investments',
        headers: ['Partner', 'Capital', 'Share'],
        rows: (() => {
          if (!activePartners.length) return [['No partners on file', '—', '—']];
          const totalPartnerCapital = activePartners.reduce((s, pt) => s + pt.capitalContributed, 0);
          const withShare = activePartners.map(pt => ({
            pt,
            share: totalPartnerCapital > 0 ? (pt.capitalContributed / totalPartnerCapital) * 100 : pt.sharePercent,
          }));
          return withShare
            .sort((a, b) => b.share - a.share)
            .map(({ pt, share }) => [pt.name, fmtUsd(pt.capitalContributed), `${share.toFixed(share % 1 === 0 ? 0 : 2)}%`]);
        })(),
        keepTogether: true,
        headerStyle: 'navy',
      },
      {
        title: 'Balance Sheet Snapshot',
        headers: ['Field', 'Value'],
        rows: [
          ['Bank', fmtUsd(lastBs?.cash ?? 0)],
          ['Land', fmtUsd(lastBs?.landValue ?? 0)],
          ['Improvements/WIP', fmtUsd(lastBs?.improvementsWip ?? 0)],
          ['Other assets', fmtUsd(lastBs?.otherAssets ?? 0)],
          ['Total assets', fmtUsd(lastBs?.totalAssets ?? 0)],
          ['Total debt', fmtUsd(lastBs?.totalDebt ?? 0)],
          ['Total equity', fmtUsd(lastBs?.equity ?? 0)],
          ['Total L + E', fmtUsd((lastBs?.totalDebt ?? 0) + (lastBs?.equity ?? 0))],
        ],
        keepTogether: true,
      },
    ],
  }];
}

/**
 * Acquisition Flow — mirrors PDAcquisitionFlowTab.tsx Sections A (Land Acquisition
 * Summary) and C (Fair Value vs Book Value) "as is", for the currently selected
 * entity. Section D (Capital Call Trigger Panel) is left out of the export.
 */
function buildAcquisitionFlowBlocks(
  company: CompanyData | undefined,
  kpis: PropDevCompanyOverviewKpis | undefined,
): SectionPdfBlock[] {
  if (!company) return [];
  const p = company.property;
  const rawLandCost = p.landCost;
  const landCost = rawLandCost != null && rawLandCost > 0 ? rawLandCost : (kpis?.landValue ?? null);
  // Book Value = Balance Sheet Land + Improvements (kpis.bookValue) -- not Land +
  // Acquisition Costs. Acquisition Costs itself is dropped from this section.
  const bookValue = kpis?.bookValue ?? null;

  const bankFunded = kpis?.loanOutstanding ?? kpis?.loanBalance ?? 0;
  const equityFunded = bookValue != null ? Math.max(0, bookValue - bankFunded) : null;
  const ltvAtAcquisition = bookValue && bookValue > 0 ? (bankFunded / bookValue) * 100 : null;

  const currentLandValue = kpis?.landValue ?? null;
  const unrealisedGain = currentLandValue != null && bookValue != null ? currentLandValue - bookValue : null;
  const ltvNow = currentLandValue && currentLandValue > 0 ? ((kpis?.loanBalance ?? 0) / currentLandValue) * 100 : null;

  return [{
    heading: `Acquisition Flow — ${company.name}`,
    kpis: [
      { label: 'Land Cost', value: fmtUsd(landCost ?? 0) },
      { label: 'Book Value', value: fmtUsd(bookValue ?? 0), sub: 'Land + Improvements (Balance Sheet)' },
      { label: 'Funded by Equity', value: fmtUsd(equityFunded ?? 0) },
      { label: 'Funded by Bank', value: fmtUsd(bankFunded), accent: '#7C3AED' },
      { label: 'LTV at Acquisition', value: fmtPct(ltvAtAcquisition), accent: '#C9A84C' },
    ],
    tables: [
      {
        title: 'Fair Value vs Book Value',
        headers: ['Field', 'Value'],
        rows: [
          ['Current Land Value (FV)', fmtUsd(currentLandValue ?? 0)],
          ['Book Value', fmtUsd(bookValue ?? 0)],
          ['Unrealised Gain / (Loss)', fmtUsdAcct(unrealisedGain ?? 0)],
          ['LTV Now', fmtPct(ltvNow)],
        ],
        keepTogether: true,
      },
    ],
  }];
}

/** Properties → Calculations → Property Tax Tracker — mirrors PDPropertiesCalculationsTab.tsx
 * Section 1 "as it as": KPI strip + Property Tax — By Entity table. */
export function buildPropertyTaxTrackerBlocks(taxRows: PropDevPropertyTaxRow[]): SectionPdfBlock[] {
  if (!taxRows.length) return [];
  const groups = groupTaxByEntity(taxRows);
  const totalTax = taxRows.reduce((s, r) => s + r.tax_amount, 0);
  const totalWithPenalty = taxRows.reduce((s, r) => s + r.tax_with_penalty, 0);
  const totalPaid = taxRows.reduce((s, r) => s + r.paid_amount, 0);
  const totalBalance = taxRows.reduce((s, r) => s + r.balance, 0);
  const entitiesWithTax = new Set(taxRows.map(r => r.entity_name)).size;
  const propertiesWithBalance = taxRows.filter(r => r.balance > 0).length;

  const rows: string[][] = [];
  const rowKinds: SectionPdfTable['rowKinds'] = [];
  for (const g of groups) {
    // g.totalTax is actually the with-penalty sum (see groupTaxByEntity) — compute the
    // plain tax subtotal separately so it lands under the right "Tax" column instead of
    // leaving "W/Penalty" blank and putting the with-penalty figure under "Tax".
    const groupTax = g.rows.reduce((s, r) => s + r.tax_amount, 0);
    rows.push([
      `${g.entityName} — ${g.rows.length} propert${g.rows.length === 1 ? 'y' : 'ies'}`,
      fmtUsd(groupTax), fmtUsd(g.totalTax), fmtUsd(g.totalPaid), fmtUsd(g.totalBalance), '', '',
    ]);
    rowKinds.push('header');
    for (const r of g.rows) {
      rows.push([
        `  ${r.property_address ?? '—'}`,
        fmtUsd(r.tax_amount),
        // Plain amount only — the inline "(+$X penalty)" suffix used on-screen doesn't
        // fit this column's fixed, no-wrap width in the PDF and gets clipped; the
        // Total With Penalty KPI card and this row's group subtotal already surface it.
        fmtUsd(r.tax_with_penalty),
        fmtUsd(r.paid_amount),
        r.balance > 0 ? fmtUsd(r.balance) : 'Cleared',
        r.payment_date || '—',
        r.payment_status || '—',
      ]);
      rowKinds.push('detail');
    }
  }
  rows.push(['PORTFOLIO TOTAL', fmtUsd(totalTax), fmtUsd(totalWithPenalty), fmtUsd(totalPaid), fmtUsd(totalBalance), '', '']);
  rowKinds.push('total');

  return [{
    heading: 'Property Tax Tracker',
    kpis: [
      { label: 'Total Tax', value: fmtUsd(totalTax), sub: `${taxRows.length} propert${taxRows.length === 1 ? 'y' : 'ies'} across ${entitiesWithTax} entit${entitiesWithTax === 1 ? 'y' : 'ies'}` },
      { label: 'Total With Penalty', value: fmtUsd(totalWithPenalty), accent: '#F5A623', sub: totalWithPenalty > totalTax ? `${fmtUsd(totalWithPenalty - totalTax)} in penalties` : 'Including late payment penalties' },
      { label: 'Total Paid', value: fmtUsd(totalPaid), accent: '#5BB5A2', sub: `${fmtPct(totalWithPenalty > 0 ? (totalPaid / totalWithPenalty) * 100 : 0)} of total with penalty` },
      { label: 'Total Balance Outstanding', value: fmtUsd(totalBalance), accent: totalBalance > 0 ? '#7C3AED' : undefined, sub: `${propertiesWithBalance} properties with balance` },
    ],
    tables: [{
      title: 'Property Tax — By Entity',
      headers: ['Property / Entity', 'Tax', 'W/Penalty', 'Paid', 'Balance', 'Payment Date', 'Status'],
      rows,
      rowKinds,
      keepTogether: false,
    }],
  }];
}

function buildCommandCenterBlocks(data: PropDevBoardExportPayload): SectionPdfBlock[] {
  const lastBs = pickFocusSnapshot(data.bsSnapshots, data.focusYear);
  // Same size for both Command Center donuts so Asset Composition matches Debt by Lender.
  const commandDonutOpts = { width: 300, height: 210 };
  const snapCharts = [];

  // Victoria has Land / Improvements / Cash line items; other companies often only have
  // Total Assets (or land on the company record). Always try to render a composition donut
  // whenever we have any asset signal — not only when Land/Cash labels matched.
  const land = Math.max(0, lastBs?.landValue ?? 0, data.landValue ?? 0);
  const improvements = Math.max(0, lastBs?.improvementsWip ?? 0);
  const cash = Math.max(0, lastBs?.cash ?? 0);
  const totalAssets = Math.max(0, lastBs?.totalAssets ?? 0);
  const fixedOrLand = Math.max(0, lastBs?.totalFixedAssets ?? 0, land + improvements);
  let other = Math.max(0, lastBs?.otherAssets ?? 0);
  if (other <= 0 && totalAssets > 0) {
    other = Math.max(0, totalAssets - cash - fixedOrLand);
  }
  let assetSlices = [
    { label: 'Land', value: land, color: '#C9A84C' },
    { label: 'Improvements / WIP', value: improvements, color: '#2E4C8A' },
    { label: 'Cash', value: cash, color: '#1B6B3A' },
    { label: 'Other', value: other, color: '#E8DEC8' },
  ].filter(s => s.value > 0);
  if (!assetSlices.length && totalAssets > 0) {
    assetSlices = [{ label: 'Total Assets', value: totalAssets, color: '#C9A84C' }];
  }
  if (assetSlices.length) {
    snapCharts.push({
      title: 'Asset Composition',
      subtitle: `As of ${lastBs?.yearLabel ?? data.periodLabel}`,
      svg: svgDoughnut(assetSlices, commandDonutOpts),
    });
  }

  // Debt by Lender: prefer Loan Tracker rows (Victoria). When a company has B/S debt
  // but no tracker loans (Texas North, Particulars uploads), still show a donut.
  let debtSlices = data.loanRows
    .slice(0, 8)
    .filter(l => l.balance > 0)
    .map((l, i) => ({
      label: l.bank, value: l.balance, color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  if (!debtSlices.length && data.totalDebt > 0) {
    debtSlices = [{
      label: 'Total Debt (B/S)',
      value: data.totalDebt,
      color: CHART_COLORS[0],
    }];
  }
  if (debtSlices.length) {
    snapCharts.push({
      title: 'Debt by Lender',
      subtitle: data.loanRows.some(l => l.balance > 0)
        ? 'Outstanding balances'
        : 'From Balance Sheet',
      svg: svgDoughnut(debtSlices, commandDonutOpts),
    });
  }
  return [{
    heading: 'Command Center Snapshot',
    kpis: [
      { label: 'Land Value', value: fmtUsd(land) },
      { label: 'Total Assets', value: fmtUsd(lastBs?.totalAssets ?? 0) },
      // Debt + LTLV from the same B/S snapshot — never Loan Tracker when B/S liabilities exist.
      { label: 'Total Debt', value: fmtUsd(lastBs?.totalDebt ?? data.totalDebt), accent: '#8B0000' },
      {
        label: 'LTLV',
        value: fmtPct(
          lastBs?.ltlv
          ?? (land > 0 && (lastBs?.totalDebt ?? data.totalDebt) > 0
            ? ((lastBs?.totalDebt ?? data.totalDebt) / land) * 100
            : null),
        ),
        sub: 'Loan-to-Land-Value',
        accent: '#C9A84C',
      },
      { label: 'Cash', value: fmtUsd(lastBs?.cash ?? 0) },
      { label: 'Monthly EMI', value: fmtUsd(data.totalMonthlyEmi), sub: `${data.loanRows.length} active loan(s)` },
    ],
    charts: snapCharts,
    chartsLayout: 'grid',
  }];
}

function buildDevelopmentPerformanceBlocks(data: PropDevBoardExportPayload): SectionPdfBlock[] {
  const devCharts = [];
  if (data.bsSnapshots.length > 1) {
    devCharts.push({
      title: 'Cost Basis Trend',
      subtitle: 'Land + Improvements/WIP by year',
      svg: svgMultiBarLineChart(
        data.bsSnapshots.map(s => String(s.year)),
        [
          { name: 'Land', values: data.bsSnapshots.map(s => s.landValue), color: '#C9A84C' },
          { name: 'Improvements/WIP', values: data.bsSnapshots.map(s => s.improvementsWip), color: '#2E4C8A' },
        ],
        { name: 'LTLV %', values: data.bsSnapshots.map(s => s.ltlv ?? 0), color: '#4A90C2' },
        { width: 520, height: 220 },
      ),
    });
  }
  const cov = data.capitalCallCoverage;
  return [{
    heading: 'Development Performance',
    pageBreakBefore: true,
    kpis: [
      { label: 'Cash Runway', value: data.cashRunway.label, accent: data.cashRunway.months != null && data.cashRunway.months < 6 ? '#8B0000' : undefined },
      { label: 'Avg Monthly Burn', value: fmtUsd(data.cashRunway.avgMonthlyBurn) },
      {
        label: 'Capital Call Coverage',
        value: cov?.dataGap ? 'N/A' : cov?.ratio != null ? `${cov.ratio.toFixed(1)}x` : '—',
        sub: cov?.dataGap
          ? 'Needs capital calls or committed capital'
          : cov?.source === 'capital-calls'
            ? `${cov.status ?? ''} · from capital calls`.trim()
            : cov?.status,
        accent: cov?.dataGap ? '#92400E' : undefined,
      },
      {
        label: 'Uncalled Partner Capital',
        value: cov?.dataGap || cov?.uncalled == null ? '—' : fmtUsd(cov.uncalled),
        sub: cov?.dataGap
          ? 'committed − contributed'
          : cov?.source === 'capital-calls'
            ? 'Open capital-call dues'
            : 'committed − contributed',
      },
    ],
    charts: devCharts,
    chartsLayout: 'grid',
  }];
}

function buildFinanceProfitabilityBlocks(data: PropDevBoardExportPayload): SectionPdfBlock[] {
  const lastPl = pickFocusSnapshot(data.plSnapshots, data.focusYear);
  const finCharts = [];
  if (data.plSnapshots.length > 1) {
    finCharts.push({
      title: 'Revenue vs Expenses vs NOI',
      svg: svgMultiBarLineChart(
        data.plSnapshots.map(s => String(s.year)),
        [
          { name: 'Revenue', values: data.plSnapshots.map(s => s.rev), color: '#C9A84C' },
          { name: 'Expenses', values: data.plSnapshots.map(s => s.exp), color: '#2E4C8A' },
        ],
        { name: 'NOI', values: data.plSnapshots.map(s => s.noi), color: '#4A90C2' },
        { width: 520, height: 220 },
      ),
    });
  }
  return [{
    heading: 'Finance & Profitability',
    pageBreakBefore: true,
    kpis: [
      { label: 'Revenue', value: fmtUsd(lastPl?.rev ?? 0) },
      { label: 'Expenses', value: fmtUsd(lastPl?.exp ?? 0) },
      { label: 'Net Income', value: fmtUsdAcct(lastPl?.netInc ?? 0), accent: (lastPl?.netInc ?? 0) < 0 ? '#8B0000' : '#1B6B3A' },
      { label: 'NOI', value: fmtUsdAcct(lastPl?.noi ?? 0) },
      { label: 'Net Margin', value: fmtPct(lastPl?.margin ?? null) },
      { label: 'Interest', value: fmtUsd(lastPl?.interest ?? 0) },
    ],
    charts: finCharts,
    chartsLayout: 'grid',
  }];
}

/** Early Multi-Year Snapshot — mirrors Construction CFO PDF placement (right after hero KPIs). */
function buildMultiYearFinancialSnapshotBlocks(data: PropDevBoardExportPayload): SectionPdfBlock[] {
  if (!data.plSnapshots.length) return [];
  return [{
    heading: 'Multi-Year Financial Snapshot',
    // Flow under prior content — do not force a blank half-page.
    tables: [{
      title: `Multi-Year Financial Snapshot — ${data.entityLabel}`,
      headers: ['Year', 'Revenue', 'Op. Income', 'Other Income', 'Expenses', 'Net Income', 'NOI', 'Margin %'],
      rows: data.plSnapshots.map(s => [
        s.yearLabel, fmtUsd(s.rev), fmtUsd(s.operatingRev), fmtUsd(s.otherRev),
        fmtUsd(s.exp), fmtUsdAcct(s.netInc), fmtUsdAcct(s.noi), fmtPct(s.margin),
      ]),
      rowKinds: data.plSnapshots.map(() => 'detail' as const),
      negativeLastCol: true,
      keepTogether: true,
    }],
  }];
}

function buildIncomeStatementBlocks(
  data: PropDevBoardExportPayload,
  fin: PDFinancialsLike,
  opts?: { pageBreakBefore?: boolean; includeMultiYearSnapshot?: boolean; includeYoy?: boolean },
): SectionPdfBlock[] {
  const blocks: SectionPdfBlock[] = [];
  const lastPl = pickFocusSnapshot(data.plSnapshots, data.focusYear);
  const plCharts = [];
  const expCats = topEntries(data.latestExpenseCategories);
  // Only show breakdown when there is real period spend (avoids empty doughnut card).
  if (expCats.length && (lastPl?.exp ?? 0) > 0) {
    plCharts.push({
      title: 'Expense Breakdown',
      subtitle: lastPl?.yearLabel,
      // A dominant expense category creates a nearly full-circle SVG arc that
      // html2canvas can omit. Bars are reliable and expose category dollars.
      svg: svgHorizontalBarChart(
        expCats.map((c, i) => ({ label: c.label, value: c.value, color: CHART_COLORS[i % CHART_COLORS.length] })),
        { width: 650, height: Math.max(180, expCats.length * 24 + 60), valueFormat: 'money', labelChars: 28 },
      ),
    });
  }
  const revCats = topEntries(data.latestRevenueCategories);
  if (revCats.length && (lastPl?.rev ?? 0) > 0) {
    plCharts.push({
      title: 'Revenue Breakdown',
      subtitle: lastPl?.yearLabel,
      // Same as Expense Breakdown: doughnut arcs often blank in html2canvas PDFs.
      svg: svgHorizontalBarChart(
        revCats.map((c, i) => ({ label: c.label, value: c.value, color: CHART_COLORS[i % CHART_COLORS.length] })),
        { width: 650, height: Math.max(180, revCats.length * 24 + 60), valueFormat: 'money', labelChars: 28 },
      ),
    });
  }
  blocks.push({
    heading: 'P&L Statement',
    pageBreakBefore: opts?.pageBreakBefore,
    forcePageBreak: opts?.pageBreakBefore === true,
    kpis: [
      { label: 'Revenue', value: fmtUsd(lastPl?.rev ?? 0) },
      { label: 'Expenses', value: fmtUsd(lastPl?.exp ?? 0) },
      { label: 'Net Income', value: fmtUsdAcct(lastPl?.netInc ?? 0), accent: (lastPl?.netInc ?? 0) < 0 ? '#8B0000' : '#1B6B3A' },
    ],
    charts: plCharts,
    chartsLayout: 'grid',
  });

  if (opts?.includeMultiYearSnapshot !== false) {
    blocks.push(...buildMultiYearFinancialSnapshotBlocks(data));
  }

  if (opts?.includeYoy !== false) {
    const src = data.scopedFin ?? fin;
    const plYoyTable = buildYoyTable(
      src.pl,
      yearsWithNonZeroValues(src.pl),
      `P&L Statement — ${data.entityLabel}`,
    );
    pushYoyStatementBlocks(blocks, plYoyTable);
  }
  return blocks;
}

function buildBalanceSheetBlocks(
  data: PropDevBoardExportPayload,
  fin: PDFinancialsLike,
  opts?: { pageBreakBefore?: boolean; includeYoy?: boolean },
): SectionPdfBlock[] {
  const blocks: SectionPdfBlock[] = [];
  const lastBs = pickFocusSnapshot(data.bsSnapshots, data.focusYear);
  const bsCharts = [];
  if (data.bsSnapshots.length > 1) {
    bsCharts.push({
      title: 'Total Assets Trajectory',
      svg: svgLineChart(
        data.bsSnapshots.map(s => String(s.year)),
        [{ name: 'Total Assets', values: data.bsSnapshots.map(s => s.totalAssets), color: '#C9A84C' }],
        { width: 520, height: 200 },
      ),
    });
    bsCharts.push({
      title: 'Debt vs Equity',
      svg: svgMultiBarLineChart(
        data.bsSnapshots.map(s => String(s.year)),
        [
          { name: 'Debt', values: data.bsSnapshots.map(s => s.totalDebt), color: '#2E4C8A' },
          { name: 'Equity', values: data.bsSnapshots.map(s => s.equity), color: '#4A90C2' },
        ],
        { name: 'LTLV %', values: data.bsSnapshots.map(s => s.ltlv ?? 0), color: '#C9A84C' },
        { width: 520, height: 200 },
      ),
    });
  }
  blocks.push({
    heading: 'Balance Sheet',
    pageBreakBefore: opts?.pageBreakBefore,
    forcePageBreak: opts?.pageBreakBefore === true,
    kpis: [
      { label: 'Total Assets', value: fmtUsd(lastBs?.totalAssets ?? 0) },
      { label: 'Total Debt', value: fmtUsd(lastBs?.totalDebt ?? 0), accent: '#8B0000' },
      { label: 'Equity', value: fmtUsd(lastBs?.equity ?? 0) },
      { label: 'LTLV', value: fmtPct(lastBs?.ltlv ?? null) },
    ],
    charts: bsCharts,
    chartsLayout: 'grid',
    // Keep snapshot under charts (same block) — no forced blank page.
    tables: data.bsSnapshots.length ? [{
      title: `Multi-Year Balance Sheet Snapshot — ${data.entityLabel}`,
      headers: ['Year', 'Land', 'Improvements/WIP', 'Cash', 'Total Assets', 'Total Debt', 'Equity', 'LTLV %'],
      rows: data.bsSnapshots.map(s => [
        s.yearLabel, fmtUsd(s.landValue), fmtUsd(s.improvementsWip), fmtUsd(s.cash),
        fmtUsd(s.totalAssets), fmtUsd(s.totalDebt), fmtUsd(s.equity), fmtPct(s.ltlv),
      ]),
      keepTogether: true,
    }] : undefined,
  });

  if (opts?.includeYoy !== false) {
    const src = data.scopedFin ?? fin;
    const bsYoyTable = buildYoyTable(
      src.bs,
      yearsWithNonZeroValues(src.bs),
      `Balance Sheet — ${data.entityLabel}`,
    );
    pushYoyStatementBlocks(blocks, bsYoyTable);
  }
  return blocks;
}

function buildCashFlowBlocks(
  data: PropDevBoardExportPayload,
  fin: PDFinancialsLike,
  opts?: { pageBreakBefore?: boolean; includeYoy?: boolean },
): SectionPdfBlock[] {
  const blocks: SectionPdfBlock[] = [];
  const src = data.scopedFin ?? fin;
  const cfRows = clubPartnerInvestmentCfRows(Array.isArray(src.cf) ? src.cf : []);
  const hasCf = cfRows.length > 0 || data.cfSnapshots.some(s =>
    s.netCashFlow !== 0 || s.operatingCf !== 0 || s.closingCash !== 0,
  );

  if (!hasCf) {
    if (opts?.includeYoy !== false) {
      blocks.push({
        heading: 'Cash Flow',
        pageBreakBefore: opts?.pageBreakBefore,
        forcePageBreak: opts?.pageBreakBefore === true,
        tables: [{
          title: 'Cash Flow',
          headers: ['Note'],
          rows: [['No Cash Flow statement uploaded for this company. Use Upload Cash Flow on Financials.']],
        }],
      });
    }
    return blocks;
  }

  const lastCf = pickFocusSnapshot(data.cfSnapshots, data.focusYear);
  const lastBs = pickFocusSnapshot(data.bsSnapshots, data.focusYear);
  const lastYear = data.focusYear ?? src.years[src.years.length - 1];

  const cfRowVal = (re: RegExp): number | null => {
    const row = cfRows.find(i => re.test(i.label));
    if (!row) return null;
    return yearVal(row.values, lastYear);
  };
  /** Prefer a non-zero statement line; fall back to snapshot (QBO nets / cash bridge). */
  const cfKpi = (re: RegExp, snap: number | undefined): number => {
    const fromRow = cfRowVal(re);
    if (fromRow != null && Math.abs(fromRow) > 0.005) return fromRow;
    if (snap != null && Math.abs(snap) > 0.005) return snap;
    return fromRow ?? snap ?? 0;
  };
  // KPI cards should match YoY Detail when that column has amounts; otherwise use
  // CF snapshots (QBO "Net cash provided by…" / cash bridge) so YTD cards are not stuck at $0.
  const operatingCfKpi = cfKpi(/Operating Cash Flow/i, lastCf?.operatingCf);
  const investingCfKpi = cfKpi(/Investing Cash Flow/i, lastCf?.investingCf);
  const financingCfKpi = cfKpi(/Financing Cash Flow/i, lastCf?.financingCf);
  const netCashFlowKpi = cfKpi(/Net Change in Cash/i, lastCf?.netCashFlow);
  const cfCharts = [];
  if (data.cfSnapshots.length > 1) {
    cfCharts.push({
      title: 'Net Cash Flow Trajectory',
      svg: svgSignedGroupedBarChart(
        data.cfSnapshots.map(s => String(s.year)),
        [{ name: 'Net Cash Flow', values: data.cfSnapshots.map(s => s.netCashFlow), color: '#1A1A2E' }],
        { title: 'Net Cash Flow', width: 520, height: 200 },
      ),
    });
    cfCharts.push({
      title: 'Cumulative Cash Trend',
      svg: svgLineChart(
        data.cfSnapshots.map(s => String(s.year)),
        [{ name: 'Closing Cash', values: data.cfSnapshots.map(s => s.closingCash), color: '#1B6B3A' }],
        { width: 520, height: 200 },
      ),
    });
  }
  blocks.push({
    heading: 'Cash Flow',
    pageBreakBefore: opts?.pageBreakBefore,
    forcePageBreak: opts?.pageBreakBefore === true,
    kpis: [
      { label: 'Operating CF', value: fmtUsdAcct(operatingCfKpi), accent: operatingCfKpi < 0 ? '#8B0000' : '#1B6B3A' },
      { label: 'Investing CF', value: fmtUsdAcct(investingCfKpi) },
      { label: 'Financing CF', value: fmtUsdAcct(financingCfKpi) },
      { label: 'Net Cash Flow', value: fmtUsdAcct(netCashFlowKpi), accent: netCashFlowKpi < 0 ? '#8B0000' : '#1B6B3A' },
      { label: 'Closing Cash', value: fmtUsd(lastBs?.cash ?? lastCf?.closingCash ?? 0) },
      { label: 'Cash Runway', value: data.cashRunway.label },
    ],
    charts: cfCharts,
    chartsLayout: 'grid',
    // Keep snapshot under charts (same block) — no forced blank page.
    tables: data.cfSnapshots.length ? [{
      title: `Multi-Year Cash Flow Snapshot — ${data.entityLabel}`,
      headers: ['Year', 'Operating', 'Investing', 'Financing', 'Net Change', 'Opening Cash', 'Closing Cash'],
      rows: data.cfSnapshots.map(s => [
        s.yearLabel, fmtUsdAcct(s.operatingCf), fmtUsdAcct(s.investingCf), fmtUsdAcct(s.financingCf),
        fmtUsdAcct(s.netCashFlow), fmtUsd(s.openingCash), fmtUsd(s.closingCash),
      ]),
      rowKinds: data.cfSnapshots.map(() => 'detail' as const),
      negativeLastCol: true,
      keepTogether: true,
    }] : undefined,
  });

  if (opts?.includeYoy !== false) {
    let cfYoyTable = buildYoyTable(
      cfRows,
      yearsWithNonZeroValues(cfRows),
      `Cash Flow Statement — ${data.entityLabel}`,
    );
    if (!cfYoyTable && cfRows.length) {
      const nonzero = yearsWithNonZeroValues(cfRows);
      const fallbackYears = nonzero.length ? nonzero : data.years;
      if (fallbackYears.length) {
        const cleaned = cfRows.filter(i => !isStatementJunkRow(i));
        const rowKinds: SectionPdfTable['rowKinds'] = [];
        const rows = cleaned.map(item => {
          const header = isStatementHeaderRow(item);
          const isTot = item.isTotal || /^total\s+for\b/i.test(item.label.trim());
          rowKinds!.push(
            item.isNetIncome || /net\s+cash|net\s+(increase|decrease|change)/i.test(item.label)
              ? 'net'
              : isTot ? 'total' : header ? 'header' : 'detail',
          );
          return [
            `${'  '.repeat(Math.min(item.indent ?? 0, 2))}${item.label}`,
            ...fallbackYears.map(y => {
              if (header) return '';
              const v = yearVal(item.values, y);
              return v === 0 ? '$0' : fmtUsdAcct(v);
            }),
          ];
        });
        if (rows.length) {
          cfYoyTable = {
            title: `Cash Flow Statement — ${data.entityLabel}`,
            headers: ['Line Item', ...fallbackYears.map(String)],
            rows,
            rowKinds,
          };
        }
      }
    }
    pushYoyStatementBlocks(blocks, cfYoyTable);
  }
  return blocks;
}

function buildLoanBlocks(data: PropDevBoardExportPayload): SectionPdfBlock[] {
  if (!data.loanRows.length) return [];
  const highestRate = [...data.loanRows].sort((a, b) => b.rate - a.rate)[0];
  return [{
    heading: 'Loan & EMI Detail',
    pageBreakBefore: true,
    forcePageBreak: true,
    kpis: [
      { label: 'Total Outstanding', value: fmtUsd(data.totalDebt) },
      { label: 'Total Monthly EMI', value: fmtUsd(data.totalMonthlyEmi) },
      { label: 'Highest Rate', value: highestRate ? `${highestRate.rate.toFixed(2)}% (${highestRate.bank})` : '—' },
      { label: 'Active Loans', value: String(data.loanRows.length) },
    ],
    tables: [{
      title: 'Loan Register (as on April 2026)',
      headers: ['Lender', 'Loan Amount', 'Rate', 'EMI', 'Outstanding', 'Maturity', 'Status'],
      rows: data.loanRows.map(l => [
        l.bank, fmtUsd(l.amount), `${l.rate.toFixed(2)}%`, fmtUsd(l.emi), fmtUsd(l.balance), l.maturityDate || '—', l.status,
      ]),
    }],
  }];
}

function buildActionRequiredBlocks(data: PropDevBoardExportPayload): SectionPdfBlock[] {
  const lastBs = pickFocusSnapshot(data.bsSnapshots, data.focusYear);
  const lastPl = pickFocusSnapshot(data.plSnapshots, data.focusYear);
  const alerts: SectionPdfAlert[] = [];
  if (data.overdueCapitalCalls.length) {
    const total = data.overdueCapitalCalls.reduce((s, c) => s + c.amountDue, 0);
    alerts.push({
      severity: 'critical',
      title: 'Overdue Capital Calls',
      text: `${data.overdueCapitalCalls.length} capital call(s) overdue totaling ${fmtUsd(total)}.`,
    });
  }
  if (data.cashRunway.months != null && data.cashRunway.months < 6) {
    alerts.push({
      severity: 'warning',
      title: 'Low Cash Runway',
      text: `Cash covers approximately ${data.cashRunway.months.toFixed(1)} months at current burn.`,
    });
  }
  if (lastBs?.ltlv != null && lastBs.ltlv > 75) {
    alerts.push({
      severity: 'warning',
      title: 'Elevated LTLV',
      text: `Loan-to-Land-Value is ${fmtPct(lastBs.ltlv)} — limited headroom for further draws.`,
    });
  }
  if (lastPl && lastPl.rev > 0) {
    const margin = lastPl.margin ?? (lastPl.rev !== 0 ? (lastPl.netInc / lastPl.rev) * 100 : null);
    if (margin != null && margin < 0) {
      alerts.push({
        severity: 'critical',
        title: 'Negative Net Margin',
        text: `Net Income of ${fmtUsdAcct(lastPl.netInc)} on ${fmtUsd(lastPl.rev)} revenue (${fmtPct(margin)}).`,
      });
    }
  }
  // Surface live CFO insights that weren't already covered by the rules above.
  for (const insight of data.insights.slice(0, 6)) {
    const text = insight.text?.trim();
    if (!text) continue;
    if (alerts.some(a => a.text === text)) continue;
    const severity: SectionPdfAlert['severity'] =
      /critical|overdue|negative|breach/i.test(text) ? 'critical'
        : /warning|low|elevated|monitor/i.test(text) ? 'warning'
          : 'info';
    alerts.push({
      severity,
      title: severity === 'critical' ? 'CFO Insight' : severity === 'warning' ? 'Watch Item' : 'Insight',
      text,
    });
  }
  if (!alerts.length) return [];
  return [{ heading: 'Action Required', pageBreakBefore: true, forcePageBreak: true, alerts }];
}

/** Optional portfolio-wide context — when provided, prepends Portfolio Overview + Property Details pages. */
export interface PropDevFinancialsPdfPortfolioCtx {
  company?: CompanyData;
  activePartnerCount?: number;
  companies: CompanyData[];
  kpisById: Record<string, PropDevCompanyOverviewKpis>;
  allLoans: Loan[];
  /** Properties → Calculations → Property Tax Tracker data, portfolio-wide. */
  taxRows?: PropDevPropertyTaxRow[];
}

export function buildPropDevCfoDashboardBoardBlocks(
  data: PropDevBoardExportPayload,
  fin: PDFinancialsLike,
  portfolioCtx?: PropDevFinancialsPdfPortfolioCtx,
): SectionPdfBlock[] {
  const leadPages: SectionPdfBlock[] = [];
  if (portfolioCtx) {
    // This export is always anchored to one selected entity (the CFO Dashboard
    // header/filename both name it) -- so every lead page must scope to that entity
    // alone, not the full portfolio. Portfolio Overview / Capital Structure / Property
    // Tax previously always used the full company list here regardless of selection,
    // which put all-entities data (Lender Concentration, Loan Portfolio, Capital
    // Calls, Top Partners, Share Capital by Entity) inside a single-entity report.
    const scopedCompanies = portfolioCtx.company ? [portfolioCtx.company] : portfolioCtx.companies;
    const scopedTaxRows = portfolioCtx.company
      ? (portfolioCtx.taxRows ?? []).filter(r => r.company_id === portfolioCtx.company!.id || r.entity_name === portfolioCtx.company!.name)
      : (portfolioCtx.taxRows ?? []);
    const portfolioBlocks = buildPropDevPortfolioOverviewBlocks(scopedCompanies, portfolioCtx.kpisById, portfolioCtx.allLoans);
    const capitalStructureBlocks = buildCapitalStructureBlocks(scopedCompanies, portfolioCtx.kpisById);
    const acquisitionFlowBlocks = buildAcquisitionFlowBlocks(
      portfolioCtx.company,
      portfolioCtx.company ? portfolioCtx.kpisById[portfolioCtx.company.id] : undefined,
    );
    const taxBlocks = buildPropertyTaxTrackerBlocks(scopedTaxRows);
    // First lead page flows naturally (it IS page 1); every section after prefers a
    // fresh page — including the first Capital Structure page, the first Acquisition
    // Flow page, and the first Property Tax page. Soft (pageBreakBefore) rather than
    // forced: with Portfolio Overview now scoped to a single entity, several of these
    // lead sections are only a few rows, and forcing an unconditional break left
    // large blank bands on sparsely filled pages. pageBreakBefore still starts a new
    // page once the current one is substantially filled, it just won't force an
    // early, mostly-empty one.
    if (capitalStructureBlocks[0]) { capitalStructureBlocks[0].pageBreakBefore = true; }
    if (acquisitionFlowBlocks[0]) { acquisitionFlowBlocks[0].pageBreakBefore = true; }
    if (taxBlocks[0]) { taxBlocks[0].pageBreakBefore = true; }
    leadPages.push(...portfolioBlocks, ...capitalStructureBlocks, ...acquisitionFlowBlocks, ...taxBlocks);
  }
  const commandCenterBlocks = buildCommandCenterBlocks(data);
  if (portfolioCtx && commandCenterBlocks[0]) {
    commandCenterBlocks[0].pageBreakBefore = true;
    commandCenterBlocks[0].forcePageBreak = true;
  }
  // Construction parity: dashboard charts first, then P&L / BS / CF YoY each on forced pages.
  return [
    ...leadPages,
    ...commandCenterBlocks,
    ...buildMultiYearFinancialSnapshotBlocks(data),
    ...buildDevelopmentPerformanceBlocks(data),
    ...buildFinanceProfitabilityBlocks(data),
    ...buildIncomeStatementBlocks(data, fin, {
      pageBreakBefore: true, includeMultiYearSnapshot: false, includeYoy: false,
    }),
    ...buildBalanceSheetBlocks(data, fin, { pageBreakBefore: true, includeYoy: false }),
    ...buildCashFlowBlocks(data, fin, { pageBreakBefore: true, includeYoy: false }),
    ...buildStatementYoyPack(data, fin),
    ...buildLoanBlocks(data),
    ...buildActionRequiredBlocks(data),
  ];
}

function buildScopeBlocks(
  data: PropDevBoardExportPayload,
  fin: PDFinancialsLike,
  scope: Exclude<PropDevFinancialsPdfScope, 'combined'>,
  portfolioCtx?: PropDevFinancialsPdfPortfolioCtx,
): SectionPdfBlock[] {
  if (scope === 'cfo-dashboard') return buildPropDevCfoDashboardBoardBlocks(data, fin, portfolioCtx);
  if (scope === 'income-statement') {
    return [
      ...buildFinanceProfitabilityBlocks(data),
      ...buildIncomeStatementBlocks(data, fin),
    ];
  }
  if (scope === 'balance-sheet') return buildBalanceSheetBlocks(data, fin);
  return buildCashFlowBlocks(data, fin);
}

export function buildPropDevFinancialsScopePayload(
  data: PropDevBoardExportPayload,
  fin: PDFinancialsLike,
  strategy: SectionStrategyPlan,
  scope: PropDevFinancialsPdfScope,
  portfolioCtx?: PropDevFinancialsPdfPortfolioCtx,
): SectionPdfPayload {
  const baseMeta = {
    entityLabel: data.entityLabel,
    periodLabel: data.periodLabel,
    generatedAt: data.generatedAt,
    strategy,
  };

  if (scope === 'combined') {
    // Full board pack once (CFO already includes Snapshot + P&L + BS + CF + loans/actions).
    return {
      ...baseMeta,
      tab: 'propdev-financials-combined',
      sectionTitle: SCOPE_TITLES.combined,
      fileSectionName: SCOPE_FILES.combined,
      sourceNote: 'Property Dev → Financials · Combined (CFO / P&L / BS / CF)',
      kpis: [] as SectionPdfKpi[],
      charts: [],
      blocks: buildPropDevCfoDashboardBoardBlocks(data, fin, portfolioCtx),
      liveParityNotes: PROPDEV_FINANCIALS_PDF_SCOPE_OPTIONS.filter(o => o.id !== 'combined').map(o => o.label),
    };
  }

  const blocks = buildScopeBlocks(data, fin, scope, portfolioCtx);
  return {
    ...baseMeta,
    tab: `propdev-${scope}`,
    sectionTitle: SCOPE_TITLES[scope],
    fileSectionName: SCOPE_FILES[scope],
    sourceNote: `Property Dev → Financials · ${SCOPE_TITLES[scope]}`,
    kpis: [] as SectionPdfKpi[],
    charts: [],
    blocks,
  };
}

export function buildPropDevSectionPdfPayload(
  data: PropDevBoardExportPayload,
  blocks: SectionPdfBlock[],
  strategy: SectionStrategyPlan,
): SectionPdfPayload {
  return {
    tab: 'propdev-cfo-dashboard',
    sectionTitle: 'CFO Dashboard',
    fileSectionName: 'CFODashboard',
    entityLabel: data.entityLabel,
    periodLabel: data.periodLabel,
    generatedAt: data.generatedAt,
    sourceNote: 'Property Dev → Financials · CFO Dashboard',
    kpis: [] as SectionPdfKpi[],
    charts: [],
    blocks,
    strategy,
  };
}
