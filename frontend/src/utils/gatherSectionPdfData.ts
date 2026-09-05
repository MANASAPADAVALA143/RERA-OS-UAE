import type { RentalTab } from '../contexts/RentalNavContext';
import type { CeoBoardExportPayload } from './executiveSummaryPpt';
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import {
  formatStatementAmount,
  type StatementTableRow,
  type YearlyStatementBlock,
} from './executiveSummaryStatementTables';
import { isDroppedStatementLineLabel } from './finItemYearUtils';
import {
  isTraditionalTAccountBsCompany,
  partitionTraditionalTAccountBs,
  traditionalBsSideToPdfRows,
} from './rentalTraditionalBsFormat';
import type { Period } from './periodWindow';
import type { PdfTheme } from './pdfTheme';
import { compactSnapshotYearLabel } from './cfoMultiYearTrendData';
import { fmtMarginPctCapped } from './rentalKpiEngine';
import { buildUnitsPerformanceBundle, type UnitsPerfUnit } from './unitsPerformanceMetrics';
import {
  svgGroupedBarChart,
  svgLineChart,
  svgSignedLineChart,
  svgBarChart,
  svgComboBarLine,
  svgMultiBarLineChart,
  svgHorizontalBarChart,
  svgStackedBarChart,
  svgSignedGroupedBarChart,
  svgSignedStackedBarChart,
  svgDoughnut,
  svgOccupancyGauge,
} from './sectionPdfCharts';

export interface SectionPdfKpi {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}

export interface SectionPdfChart {
  title: string;
  subtitle?: string;
  svg: string;
}

export type SectionPdfRowKind = 'header' | 'total' | 'net' | 'detail';

export interface SectionPdfTable {
  title?: string;
  headers: string[];
  rows: string[][];
  /** Optional per-row kind for brown subtotal/header styling (CFO YoY tables). */
  rowKinds?: SectionPdfRowKind[];
  /** When true, any cell in the last column that starts with "(" is rendered in red (accounting negative format). */
  negativeLastCol?: boolean;
  /**
   * Keep this table on one PDF page (no mid-table row slicing). Used for Construction/
   * Prop Dev paginated P&L/BS/CF YoY page chunks.
   */
  keepTogether?: boolean;
  /** Navy title bar + navy/white column header row (Entity Dashboard "as it as" parity). */
  headerStyle?: 'navy';
  /** Column indices (0-based) to center-align instead of the default label-left/rest-right. */
  centerCols?: number[];
  /** Column indices (0-based, beyond column 0) that hold text rather than numbers -- left-aligned like col-label instead of the default right-aligned col-num. */
  textCols?: number[];
  /**
   * For many-column *register*-style tables (several short text columns, e.g. Loan
   * Portfolio's Company/Property/Bank/Status) rather than a financial statement's
   * one-label + N-numeric-year-columns shape. The `table-wide` heuristic that other
   * wide tables get force-splits width as (label col) + (N equal numeric cols,
   * nowrap) -- fine for a P&L's Year 1/Year 2/Year 3, but with several short text
   * columns it squeezes them until values overlap. `dense` uses auto column sizing
   * and lets every cell wrap instead.
   */
  dense?: boolean;
  /**
   * Explicit per-column width percentages for a `dense` table, must sum to 100 and
   * match `headers.length`. `table-layout: auto` lets a many-column table's total
   * width exceed its container (columns size to content, not to the page), which
   * silently clips the rightmost columns off a rasterized PDF page instead of
   * wrapping them -- so `dense` tables need fixed, explicit widths. Falls back to
   * an equal split across columns if omitted.
   */
  colWidthPct?: number[];
}

export interface SectionPdfAlert {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  text: string;
}

/** Named board-pack section with optional page break (CFO Dashboard PDF). */
export interface SectionPdfBlock {
  heading: string;
  pageBreakBefore?: boolean;
  /**
   * Always start this block on a new PDF page (even if the prior page is only
   * partly filled). Used for P&L / BS / CF statement sections.
   */
  forcePageBreak?: boolean;
  /** Default `grid` = 2 charts side-by-side (Trends & Breakdowns style). */
  chartsLayout?: 'grid' | 'stack';
  /** Default `stack` = full-width tables; `grid` = 2 tables side-by-side. */
  tablesLayout?: 'grid' | 'stack';
  kpis?: SectionPdfKpi[];
  charts?: SectionPdfChart[];
  tables?: SectionPdfTable[];
  alerts?: SectionPdfAlert[];
}

export interface SectionPdfPayload {
  /** Rental tab id, or a free-form id for non-Rental modules reusing this renderer (e.g. Property Dev). */
  tab: RentalTab | string;
  sectionTitle: string;
  fileSectionName: string;
  entityLabel: string;
  periodLabel: string;
  generatedAt: string;
  sourceNote: string;
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  /** Default `grid` = 2 charts side-by-side. `stack` = full width, for chart-dense tabs. */
  chartsLayout?: 'grid' | 'stack';
  /** Default `stack` = full-width tables; `grid` = 2 tables side-by-side (T-account BS). */
  tablesLayout?: 'grid' | 'stack';
  /** @deprecated prefer `tables` — kept for older call sites */
  table?: SectionPdfTable;
  tables?: SectionPdfTable[];
  alerts?: SectionPdfAlert[];
  /** Override default "Attention Now" alert section title. */
  alertsTitle?: string;
  /** When set, HTML renders these as distinct sections (page breaks + headers). */
  blocks?: SectionPdfBlock[];
  strategy: SectionStrategyPlan;
  /** Checklist of live-page blocks this PDF is meant to mirror (maintenance aid). */
  liveParityNotes?: string[];
  /** Visual theme override. Defaults to the parchment look when omitted. */
  theme?: PdfTheme;
}

/** Tabs with polished HTML-to-PDF export (not browser print). */
export const POLISHED_SECTION_PDF_TABS: RentalTab[] = [
  'overview',
  'expenses',
  'ar-dashboard',
  'financials',
  'ownership',
  'loan-tracker',
  'vacancy',
  'units',
  'financial-ratios',
];

export function isPolishedSectionPdfTab(tab: RentalTab): boolean {
  return POLISHED_SECTION_PDF_TABS.includes(tab);
}

const FILE_NAMES: Partial<Record<RentalTab, string>> = {
  overview: 'RentalPortfolioOverview',
  expenses: 'Expenses',
  'ar-dashboard': 'ARDashboard',
  financials: 'IncomeStatement',
  ownership: 'Ownership',
  'loan-tracker': 'LoanTracker',
  vacancy: 'VacancyLoss',
  units: 'Units',
  'financial-ratios': 'FinancialRatios',
};

const SECTION_TITLES: Partial<Record<RentalTab, string>> = {
  overview: 'Rental Portfolio Overview',
  expenses: 'Expenses',
  'ar-dashboard': 'AR Dashboard',
  financials: 'Income Statement',
  ownership: 'Ownership',
  'loan-tracker': 'Loan Portfolio & EMI',
  vacancy: 'Vacancy & Loss',
  units: 'Units — Rental Performance',
  'financial-ratios': 'Financial Ratios',
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.abs(n));
  // Accounting-style negatives for all rental companies: ($1,234) not -$1,234.
  return n < 0 ? `(${abs})` : abs;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

const CHART_COLORS = ['#5B5FEF', '#0F766E', '#166534', '#B91C1C', '#F5A623', '#1F6FEB'];

/** Human labels for the internal green/amber/red/grey DSCR status codes (loanDscrStatus). */
const DSCR_STATUS_LABEL: Record<string, string> = { green: 'Healthy', amber: 'Monitor', red: 'Critical', grey: 'No Data' };

export type FinancialsPdfScope =
  | 'cfo-dashboard'
  | 'profitability'
  | 'action-plan'
  | 'property-performance'
  | 'income-statement'
  | 'balance-sheet'
  | 'cash-flow'
  | 'combined';

export const FINANCIALS_PDF_SCOPE_OPTIONS: { id: FinancialsPdfScope; label: string }[] = [
  { id: 'cfo-dashboard', label: 'CFO Dashboard (+ Snapshot / P&L / BS / CF)' },
  { id: 'profitability', label: 'Profitability' },
  { id: 'action-plan', label: 'Action Plan' },
  { id: 'property-performance', label: 'Property Performance' },
  { id: 'income-statement', label: 'Income Statement' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'combined', label: 'Combined (All)' },
];

const FINANCIALS_SCOPE_TITLES: Record<FinancialsPdfScope, string> = {
  'cfo-dashboard': 'CFO Dashboard',
  profitability: 'Profitability',
  'action-plan': 'Action Plan',
  'property-performance': 'Property Performance',
  'income-statement': 'Income Statement',
  'balance-sheet': 'Balance Sheet',
  'cash-flow': 'Cash Flow',
  combined: 'Financials — Combined Report',
};

const FINANCIALS_SCOPE_FILES: Record<FinancialsPdfScope, string> = {
  'cfo-dashboard': 'CFODashboard',
  profitability: 'Profitability',
  'action-plan': 'ActionPlan',
  'property-performance': 'PropertyPerformance',
  'income-statement': 'IncomeStatement',
  'balance-sheet': 'BalanceSheet',
  'cash-flow': 'CashFlow',
  combined: 'FinancialsCombined',
};

export interface BuildSectionPdfOptions {
  financialsScope?: FinancialsPdfScope;
  /** Raw units (with rent_history) for Units PDF live parity. */
  units?: UnitsPerfUnit[];
  period?: Period | null;
  month?: number;
  year?: number;
  entityId?: string | 'portfolio';
}

function lineItemRows(rows: { indent?: number; label: string; amount: number; isSectionHeader?: boolean }[], max = 80): string[][] {
  return rows.slice(0, max).map(r => [
    `${'  '.repeat(r.indent ?? 0)}${r.label}`.slice(0, 52),
    r.isSectionHeader ? '' : fmtUsd(r.amount),
  ]);
}

function normStatementLabel(label: string): string {
  return label.trim().toLowerCase();
}

function yoyAmountCell(
  template: { label: string; isSectionHeader?: boolean },
  match: { amount: number; isSectionHeader?: boolean } | undefined,
): string {
  // Section headers stay blank; missing / zero amounts show $0 (not empty or —).
  if (template.isSectionHeader || match?.isSectionHeader) return '';
  if (!match) return '$0';
  return formatStatementAmount(match.amount);
}

/** Text-based backstop for isTotal — "Total for X" / "Total Assets" etc. — independent of
 * whatever isTotal/isSectionHeader flags the row happens to carry, since those flags are
 * computed once per label at parse time from indent/hasAny heuristics that can misfire on
 * hand-edited source workbooks (e.g. a detail line whose indentation looks header-shaped). */
function looksLikeTotalLabel(label: string): boolean {
  const norm = label.trim().toLowerCase();
  if (/^total\s+for\s+/.test(norm)) return true;
  if (/^total\s+(assets|liabilit(?:y|ies)|equity|income|expenses?|tax\s+expense)\b/.test(norm)) return true;
  if (/^net\s+cash\s+(provided by|used in)\s+(operating|investing|financing)\s+activities/.test(norm)) return true;
  if (/^net\s+(increase|decrease|change)\s+in\s+cash/.test(norm)) return true;
  return false;
}

/** Brown/subtotal rows only — "Total for …" / net income, always kept. A row only qualifies
 * as a bare category header (kept with a blank amount) when it is $0 in EVERY year — a real
 * category header never carries its own dollar amount; if any year shows a nonzero amount for
 * this label, it is a detail line that must be dropped, regardless of what its isSectionHeader
 * flag says (that flag is computed once per label from an indent heuristic that can misfire on
 * hand-edited source workbooks). */
function isYoySummaryRow(
  r: StatementTableRow,
  allYearAmounts: number[],
): boolean {
  if (isDroppedStatementLineLabel(r.label)) return false;
  if (r.isNetIncome) return true;
  if (r.isTotal || looksLikeTotalLabel(r.label)) return true;
  if (/^\d{4}[\s\-]/.test(r.label.trim())) return false; // year-prefixed sub-category, e.g. "2013 Fixed Assets"
  const everZero = allYearAmounts.every(a => a === 0);
  return r.isSectionHeader && everZero;
}

function rowKindForSummary(r: StatementTableRow): SectionPdfRowKind {
  if (r.isNetIncome) return 'net';
  if (r.isTotal) return 'total';
  return 'header';
}

/** YoY / snapshot year headers: year only (e.g. 2023); keep month labels like "Mar 2026". */
function compactYoyColumnHeader(y: { year: number; yearLabel?: string }): string {
  return compactSnapshotYearLabel(y);
}

/**
 * YoY year-column statement (mirrors live P&L year view) with brown subtotal/header rows only.
 * Prefer this over period Month/YTD single-amount line items for CFO board-pack PDF.
 */
function buildYoySubtotalTable(
  yearlyStatements: YearlyStatementBlock[],
  title: string,
): SectionPdfTable | null {
  if (!yearlyStatements.length) return null;

  const years = yearlyStatements.map(y => y.year);
  const byYear = new Map(
    yearlyStatements.map(ys => [
      ys.year,
      new Map(ys.rows.map(r => [normStatementLabel(r.label), r])),
    ]),
  );

  // Prefer latest year as label/order template (usually most complete chart of accounts).
  const primary = yearlyStatements[yearlyStatements.length - 1];
  const amountsFor = (label: string): number[] => years.map(y => byYear.get(y)?.get(normStatementLabel(label))?.amount ?? 0);
  const summaryRows = primary.rows
    .filter(template => isYoySummaryRow(template, amountsFor(template.label)))
    .filter(template => {
      if (template.isSectionHeader || template.isNetIncome) return true;
      return years.some(y => {
        const match = byYear.get(y)?.get(normStatementLabel(template.label));
        return !!match && !match.isSectionHeader && match.amount !== 0;
      });
    });
  if (!summaryRows.length) return null;

  const rowKinds: SectionPdfRowKind[] = [];
  const rows = summaryRows.map(template => {
    rowKinds.push(rowKindForSummary(template));
    const label = `${'  '.repeat(Math.min(template.indent, 2))}${template.label}`.slice(0, 48);
    const amounts = years.map(y => {
      const match = byYear.get(y)?.get(normStatementLabel(template.label));
      return yoyAmountCell(template, match);
    });
    return [label, ...amounts];
  });

  return {
    title,
    headers: ['Line Item', ...yearlyStatements.map(compactYoyColumnHeader)],
    rows,
    rowKinds,
  };
}

/**
 * Full YoY year-column statement (all mapped lines, not only subtotals).
 * Used by Rentals CFO board-pack to match Property/Construction export depth.
 */
/**
 * Drop a header row that has no real child data before the next header — same pattern used
 * in Property Dev (dropOrphanYoySectionHeaders) and Construction (dropOrphanHeaders). Fixes
 * case-duplicate headers like "Cost of Goods Sold" immediately followed by a blank
 * "Cost of goods sold" sub-row: the first has no children before the second header, so it's
 * dropped, leaving only the real one with data underneath it.
 */
function dropOrphanStatementHeaders(rows: StatementTableRow[]): StatementTableRow[] {
  if (!rows.length) return rows;
  const keep = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i]!;
    if (!item.isSectionHeader) {
      keep.add(i);
      continue;
    }
    let hasChild = false;
    for (let j = i + 1; j < rows.length; j++) {
      const next = rows[j]!;
      if (next.isSectionHeader) break;
      if (next.isNetIncome || next.amount !== 0) { hasChild = true; break; }
    }
    if (hasChild) keep.add(i);
  }
  return rows.filter((_, i) => keep.has(i));
}

function buildYoyDetailTable(
  yearlyStatements: YearlyStatementBlock[],
  title: string,
): SectionPdfTable | null {
  if (!yearlyStatements.length) return null;

  const years = yearlyStatements.map(y => y.year);
  const byYear = new Map(
    yearlyStatements.map(ys => [
      ys.year,
      new Map(ys.rows.map(r => [normStatementLabel(r.label), r])),
    ]),
  );

  const primary = yearlyStatements[yearlyStatements.length - 1];
  const detailRows = dropOrphanStatementHeaders(primary.rows)
    .filter(r => !isDroppedStatementLineLabel(r.label))
    .filter(r => !r.isSectionHeader || !/^\d{4}[\s\-]/.test(r.label.trim()));
  if (!detailRows.length) return null;

  // Drop lines that are $0 / blank in every year column (keep section headers + net income).
  const templates = detailRows.filter(template => {
    if (template.isSectionHeader || template.isNetIncome) return true;
    return years.some(y => {
      const match = byYear.get(y)?.get(normStatementLabel(template.label));
      return !!match && !match.isSectionHeader && match.amount !== 0;
    });
  });
  if (!templates.length) return null;

  const rowKinds: SectionPdfRowKind[] = [];
  const rows = templates.map(template => {
    rowKinds.push(template.isNetIncome ? 'net' : template.isTotal ? 'total' : template.isSectionHeader ? 'header' : 'detail');
    const label = `${'  '.repeat(Math.min(template.indent, 2))}${template.label}`.slice(0, 48);
    const amounts = years.map(y => {
      const match = byYear.get(y)?.get(normStatementLabel(template.label));
      return yoyAmountCell(template, match);
    });
    return [label, ...amounts];
  });

  return {
    title,
    headers: ['Line Item', ...yearlyStatements.map(compactYoyColumnHeader)],
    rows,
    rowKinds,
  };
}

/** Paginate P&L / BS / CF line items and pair them 2-across (same layout as Trends charts). */
function paginateLineItemsSideBySide(
  statements: Array<{ sectionName: string; table: SectionPdfTable }>,
  rowsPerPage = 26,
): SectionPdfBlock[] {
  type Page = { sectionName: string; table: SectionPdfTable };
  const pages: Page[] = [];
  for (const { sectionName, table } of statements) {
    const totalParts = Math.max(1, Math.ceil(table.rows.length / rowsPerPage));
    for (let part = 0; part < totalParts; part++) {
      const rows = table.rows.slice(part * rowsPerPage, (part + 1) * rowsPerPage);
      const rowKinds = table.rowKinds?.slice(part * rowsPerPage, (part + 1) * rowsPerPage);
      pages.push({
        sectionName,
        table: {
          ...table,
          title: totalParts > 1 ? `${table.title} (${part + 1}/${totalParts})` : table.title,
          rows,
          rowKinds,
        },
      });
    }
  }
  const blocks: SectionPdfBlock[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    const pair = pages.slice(i, i + 2);
    const heading = pair.length === 2
      ? `${pair[0].sectionName} & ${pair[1].sectionName} — Line Items`
      : `${pair[0].sectionName} — Line Items`;
    blocks.push({
      heading: i === 0 ? heading : `${heading} (continued)`,
      pageBreakBefore: true,
      tablesLayout: pair.length >= 2 ? 'grid' : 'stack',
      tables: pair.map(p => p.table),
    });
  }
  return blocks;
}

/** Full-width YoY summary pages (year columns are too wide for 2-across).
 *  Each of P&L / BS / CF starts on a new PDF page for every company export. */
function paginateYoySummaryStatements(
  statements: Array<{ sectionName: string; table: SectionPdfTable }>,
  rowsPerPage = 28,
): SectionPdfBlock[] {
  const blocks: SectionPdfBlock[] = [];
  for (const { sectionName, table } of statements) {
    const totalParts = Math.max(1, Math.ceil(table.rows.length / rowsPerPage));
    for (let part = 0; part < totalParts; part++) {
      const rows = table.rows.slice(part * rowsPerPage, (part + 1) * rowsPerPage);
      const rowKinds = table.rowKinds?.slice(part * rowsPerPage, (part + 1) * rowsPerPage);
      blocks.push({
        heading: totalParts > 1
          ? `${sectionName} — YoY Summary (${part + 1}/${totalParts})`
          : `${sectionName} — YoY Summary`,
        // First page of each statement always starts fresh; continuations prefer a break too.
        pageBreakBefore: true,
        forcePageBreak: part === 0,
        tablesLayout: 'stack',
        tables: [{
          ...table,
          title: totalParts > 1 ? `${table.title} (${part + 1}/${totalParts})` : table.title,
          rows,
          rowKinds,
        }],
      });
    }
  }
  return blocks;
}

function fmtSignedUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return fmtUsd(n);
}

function buildIncomeStatementPdfParts(data: CeoBoardExportPayload): {
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  tables: SectionPdfTable[];
  sourceNote: string;
} {
  const isec = data.incomeStatement;
  const kpis: SectionPdfKpi[] = [
    { label: 'Revenue', value: isec.periodRevenue },
    { label: 'Expenses', value: isec.periodExpenses },
    { label: 'NOI', value: isec.periodNoi, accent: '#166534' },
    { label: 'NOI Margin', value: isec.noiMargin },
    { label: 'Net Income Margin', value: isec.netIncomeMargin },
    { label: 'Expense Ratio', value: isec.expenseRatio },
  ];
  const charts: SectionPdfChart[] = [];
  if (isec.monthlyTrend.length) {
    charts.push({
      title: 'Revenue vs Expenses vs NOI',
      svg: svgGroupedBarChart(
        isec.monthlyTrend.map(t => t.month),
        [
          { name: 'Revenue', values: isec.monthlyTrend.map(t => t.revenue), color: '#5B5FEF' },
          { name: 'Expenses', values: isec.monthlyTrend.map(t => t.expenses), color: '#2E4C8A' },
          { name: 'NOI', values: isec.monthlyTrend.map(t => t.noi), color: '#4A90C2' },
        ],
        { title: 'P&L Monthly Trend', width: 520, height: 200 },
      ),
    });
  }
  if (isec.expenseCategories.length) {
    charts.push({
      title: 'Expense Mix',
      svg: svgDoughnut(
        isec.expenseCategories.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  const tables: SectionPdfTable[] = [];
  if (isec.lineItems.length) {
    tables.push({
      title: `Income Statement — ${isec.statementPeriodLabel}`,
      headers: ['Line Item', 'Amount'],
      rows: lineItemRows(isec.lineItems),
    });
  }
  if (data.financialPerformance.waterfall.length) {
    tables.push({
      title: 'NOI Waterfall',
      headers: ['Step', 'Amount'],
      rows: data.financialPerformance.waterfall.map(w => [w.label, w.value]),
    });
  }
  return { kpis, charts, tables, sourceNote: isec.sourceNote };
}

function pickTraditionalBsFocusRows(
  bs: CeoBoardExportPayload['balanceSheet'],
): { rows: StatementTableRow[]; yearLabel: string } | null {
  if (bs.yearlyStatements?.length) {
    const last = bs.yearlyStatements[bs.yearlyStatements.length - 1]!;
    if (last.rows.length) {
      return { rows: last.rows, yearLabel: String(last.year) };
    }
  }
  if (bs.lineItems?.length) {
    return { rows: bs.lineItems, yearLabel: bs.statementPeriodLabel || 'Amount' };
  }
  return null;
}

function buildTraditionalTAccountBsPdfTables(
  data: CeoBoardExportPayload,
): SectionPdfTable[] | null {
  if (!isTraditionalTAccountBsCompany({ entityLabel: data.entityLabel, companyName: data.entityLabel })) {
    return null;
  }
  const focus = pickTraditionalBsFocusRows(data.balanceSheet);
  if (!focus) return null;
  const parted = partitionTraditionalTAccountBs(focus.rows, focus.yearLabel);
  const left = traditionalBsSideToPdfRows(parted.liabilities);
  const right = traditionalBsSideToPdfRows(parted.assets);
  if (!left.rows.length && !right.rows.length) return null;
  const yearCol = parted.yearLabel || 'Total';
  return [
    {
      title: 'Liabilities',
      headers: ['Particulars', 'Amount', yearCol],
      rows: left.rows.length ? left.rows : [['—', '', '']],
      rowKinds: left.rowKinds.length ? left.rowKinds : ['detail'],
      keepTogether: true,
      negativeLastCol: true,
    },
    {
      title: 'Assets',
      headers: ['Particulars', 'Amount', yearCol],
      rows: right.rows.length ? right.rows : [['—', '', '']],
      rowKinds: right.rowKinds.length ? right.rowKinds : ['detail'],
      keepTogether: true,
      negativeLastCol: true,
    },
  ];
}

function buildBalanceSheetPdfParts(data: CeoBoardExportPayload): {
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  tables: SectionPdfTable[];
  tablesLayout?: 'grid' | 'stack';
  sourceNote: string;
} {
  const bs = data.balanceSheet;
  const kpis: SectionPdfKpi[] = [
    { label: 'Total Assets', value: bs.totalAssets },
    { label: 'Total Liabilities', value: bs.totalLiabilities },
    { label: 'Equity', value: bs.equity, accent: '#166534' },
    { label: 'Bank', value: bs.cashBalance },
    { label: 'LTV', value: bs.ltv },
    { label: 'Debt / Equity', value: bs.debtToEquity },
  ];
  const charts: SectionPdfChart[] = [];
  if (bs.assetComposition.length) {
    charts.push({
      title: 'Asset Composition',
      svg: svgDoughnut(
        bs.assetComposition.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  if (bs.capitalStructure.length) {
    charts.push({
      title: 'Capital Structure',
      svg: svgDoughnut(
        bs.capitalStructure.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[(i + 2) % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  const traditional = buildTraditionalTAccountBsPdfTables(data);
  if (traditional) {
    return {
      kpis,
      charts,
      tables: traditional,
      tablesLayout: 'grid',
      sourceNote: `${bs.sourceNote} · Traditional T-account Balance Sheet`,
    };
  }
  const tables: SectionPdfTable[] = [];
  if (bs.lineItems.length) {
    tables.push({
      title: `Balance Sheet — ${bs.statementPeriodLabel}`,
      headers: ['Line Item', 'Amount'],
      rows: lineItemRows(bs.lineItems),
    });
  }
  return { kpis, charts, tables, sourceNote: bs.sourceNote };
}

function buildCashFlowPdfParts(data: CeoBoardExportPayload): {
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  tables: SectionPdfTable[];
  sourceNote: string;
} {
  const cf = data.cashFlow;
  const kpis: SectionPdfKpi[] = [
    { label: 'Operating CF', value: cf.operatingCf, accent: '#166534' },
    { label: 'Financing CF', value: cf.financingCf },
    { label: 'Investing CF', value: cf.investingCf },
    { label: 'Net Cash Flow', value: cf.netCashFlow },
  ];
  const charts: SectionPdfChart[] = [];
  if (cf.cashTrend.length) {
    charts.push({
      title: 'Bank Trend',
      svg: svgLineChart(
        cf.cashTrend.map(t => t.month),
        [{ name: 'Bank', values: cf.cashTrend.map(t => t.cash), color: '#0F766E' }],
        { title: 'Bank Balance', width: 520, height: 200 },
      ),
    });
  }
  if (cf.operatingVsFinancing.length) {
    charts.push({
      title: 'Operating vs Financing',
      svg: svgGroupedBarChart(
        cf.operatingVsFinancing.map(t => t.month),
        [
          { name: 'Operating', values: cf.operatingVsFinancing.map(t => t.operating), color: '#166534' },
          { name: 'Financing', values: cf.operatingVsFinancing.map(t => t.financing), color: '#B91C1C' },
        ],
        { title: 'Cash Flow Mix', width: 520, height: 200 },
      ),
    });
  }
  const tables: SectionPdfTable[] = [];
  if (cf.yearlyStatements.length) {
    const yoy = buildYoyDetailTable(cf.yearlyStatements, 'Cash Flow — Year View (YoY Detail)');
    if (yoy) tables.push(yoy);
  } else if (cf.lineItems.length) {
    tables.push({
      title: `Cash Flow — ${cf.statementPeriodLabel}`,
      headers: ['Line Item', 'Amount'],
      rows: lineItemRows(cf.lineItems),
    });
  }
  return { kpis, charts, tables, sourceNote: cf.sourceNote };
}

function buildCfoDashboardPdfParts(data: CeoBoardExportPayload): {
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  tables: SectionPdfTable[];
  sourceNote: string;
} {
  const isec = data.incomeStatement;
  const bs = data.balanceSheet;
  const kpis: SectionPdfKpi[] = [
    { label: 'Revenue', value: isec.periodRevenue },
    { label: 'NOI', value: isec.periodNoi, accent: '#166534' },
    { label: 'NOI Margin', value: isec.noiMargin },
    { label: 'Bank', value: bs.cashBalance },
    { label: 'Total Debt', value: data.loanPortfolio.totalDebt },
    { label: 'DSCR', value: data.loanPortfolio.portfolioDscr },
  ];
  const charts: SectionPdfChart[] = [];
  if (isec.expenseCategories.length) {
    charts.push({
      title: 'Expense Mix',
      svg: svgDoughnut(
        isec.expenseCategories.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  if (isec.monthlyTrend.length) {
    const trend = isec.monthlyTrend.slice(-12);
    charts.push({
      title: 'Profitability Trend',
      svg: svgLineChart(
        trend.map(t => t.month),
        [
          { name: 'NOI', values: trend.map(t => t.noi), color: '#4A90C2' },
          { name: 'Revenue', values: trend.map(t => t.revenue), color: '#5B5FEF', dashed: true },
        ],
        { width: 520, height: 200 },
      ),
    });
  }
  return {
    kpis,
    charts,
    tables: [],
    sourceNote: 'Rentals → Financials · CFO Dashboard',
  };
}

/**
 * Board-ready CFO Dashboard PDF blocks — Portfolio Snapshot + Rental Performance +
 * Finance & Profitability (Executive Summary bands) then P&L / BS / CF financials.
 * Charts render 2-across; YoY subtotal tables are appended at the end.
 */
function buildCfoDashboardBoardBlocks(data: CeoBoardExportPayload): SectionPdfBlock[] {
  const isec = data.incomeStatement;
  const bs = data.balanceSheet;
  const cf = data.cashFlow;
  const ps = data.portfolioSnapshot;
  const rp = data.rentalPerformance;
  const fp = data.financialPerformance;
  const own = data.ownership;
  const yearSnapshots = isec.yearSnapshots ?? [];

  const occUnits = Number(ps.occupiedUnits) || 0;
  const vacUnits = ps.vacantUnits ?? 0;
  const totalUnits = Number(ps.totalUnits) || occUnits + vacUnits;

  const blocks: SectionPdfBlock[] = [];

  // ── Portfolio Snapshot (live Executive Summary band) ───────────────────────
  const snapCharts: SectionPdfChart[] = [];
  if (occUnits + vacUnits > 0) {
    snapCharts.push({
      title: 'Unit Mix',
      subtitle: 'Occupied vs vacant',
      svg: svgDoughnut(
        [
          { label: 'Occupied', value: Math.max(0, occUnits), color: '#5B5FEF' },
          { label: 'Vacant', value: Math.max(0, vacUnits), color: '#0F766E' },
        ].filter(s => s.value > 0),
        { width: 360 },
      ),
    });
  }
  if (ps.assetComposition.length) {
    snapCharts.push({
      title: 'Asset Composition',
      subtitle: 'By company / property',
      svg: svgDoughnut(
        ps.assetComposition.slice(0, 9).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  const debtSlices = (ps.debtComposition.length ? ps.debtComposition : (data.loanPortfolio.debtByBuilding ?? []))
    .slice(0, 8);
  if (debtSlices.length) {
    snapCharts.push({
      title: 'Debt by Property',
      subtitle: 'Outstanding balances',
      svg: svgDoughnut(
        debtSlices.map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  const showPartnerShare = Boolean(ps.partnerSharePayable);
  const hasPortfolioSignal = totalUnits > 0 || snapCharts.length > 0 || Boolean(ps.totalDebt && ps.totalDebt !== '—' && ps.totalDebt !== '$0');
  if (hasPortfolioSignal) {
    blocks.push({
      heading: 'Portfolio Snapshot',
      kpis: [
        { label: 'Total Units', value: totalUnits > 0 ? String(totalUnits) : '—', sub: totalUnits > 0 ? `${vacUnits} vacant` : undefined },
        {
          label: 'Occupied Units',
          value: occUnits > 0 ? String(occUnits) : '—',
          sub: rp.occupancy && !rp.occupancy.startsWith('Data') ? `${rp.occupancy} occupancy` : undefined,
          accent: '#5B5FEF',
        },
        {
          label: 'Total Loan Outstanding',
          value: ps.totalDebt,
          sub: ps.loanCount
            ? `${ps.loanCount} loan${ps.loanCount === 1 ? '' : 's'}${ps.loanBalanceAsOn ? ` (${ps.loanBalanceAsOn})` : ''}`
            : undefined,
        },
        { label: 'Monthly Rent', value: rp.occupiedRent ?? rp.gpr, sub: rp.occupiedRent != null ? 'Occupied units' : 'Gross Potential Rent' },
        {
          label: showPartnerShare ? 'Partner Share Payable' : 'Active Partners',
          value: showPartnerShare
            ? (ps.partnerSharePayable as string)
            : own.available
              ? own.totalPartners
              : '—',
          sub: showPartnerShare
            ? 'Limited / silent partner NOI share'
            : own.available && own.totalEquity && !own.totalEquity.startsWith('Data')
              ? `${own.totalEquity} total equity`
              : 'From Ownership',
        },
      ],
      charts: snapCharts,
      chartsLayout: 'grid',
    });
  }

  // ── Rental Performance ─────────────────────────────────────────────────────
  const rentalCharts: SectionPdfChart[] = [];
  const gprTrend = rp.gprTrend.filter(t => t.gpr > 0 || t.collected > 0).slice(-6);
  if (gprTrend.length) {
    rentalCharts.push({
      title: 'GPR vs Collected + Occupancy',
      subtitle: `6 mo trailing · ${data.periodLabel}`,
      svg: svgMultiBarLineChart(
        gprTrend.map(t => t.month),
        [
          { name: 'GPR', values: gprTrend.map(t => t.gpr), color: '#5B5FEF' },
          { name: 'Collected', values: gprTrend.map(t => t.collected), color: '#4A90C2' },
        ],
        {
          name: 'Occupancy %',
          values: gprTrend.map(t => t.occupancy ?? 0),
          color: '#0F766E',
        },
        { width: 520, height: 220 },
      ),
    });
  }
  const hasRentalSignal = rentalCharts.length > 0 || totalUnits > 0
    || (rp.gpr && rp.gpr !== '—' && rp.gpr !== '$0');
  if (hasRentalSignal) {
    blocks.push({
      heading: 'Rental Performance',
      pageBreakBefore: hasPortfolioSignal,
      kpis: [
        { label: 'Physical Occupancy', value: rp.occupancy },
        { label: 'GPR', value: rp.gpr },
        { label: 'Collected', value: rp.collected, accent: '#5B5FEF' },
        { label: 'Vacancy Loss', value: rp.vacancyLoss, accent: '#4F46E5' },
        { label: 'Collection Rate', value: rp.collectionRate },
        { label: 'AR Outstanding', value: rp.arOutstanding },
      ],
      charts: rentalCharts,
      chartsLayout: 'grid',
    });
  }

  // ── Finance & Profitability ────────────────────────────────────────────────
  const finCharts: SectionPdfChart[] = [];
  const finTrend = (fp.trend?.length ? fp.trend : isec.monthlyTrend).slice(-12);
  if (finTrend.length) {
    finCharts.push({
      title: 'Revenue · Expenses · NOI',
      subtitle: data.periodLabel,
      svg: svgMultiBarLineChart(
        finTrend.map(t => t.month),
        [
          { name: 'Revenue', values: finTrend.map(t => t.revenue), color: '#5B5FEF' },
          { name: 'Expenses', values: finTrend.map(t => t.expenses), color: '#2E4C8A' },
        ],
        { name: 'NOI', values: finTrend.map(t => t.noi), color: '#4A90C2' },
        { width: 520, height: 220 },
      ),
    });
  }
  blocks.push({
    heading: 'Finance & Profitability',
    pageBreakBefore: true,
    kpis: [
      { label: 'NOI', value: isec.periodNoi || fp.noi, accent: '#5B5FEF' },
      { label: 'NOI Margin', value: isec.noiMargin },
      { label: 'Net Income Margin', value: isec.netIncomeMargin },
      { label: 'Expense Ratio (OER)', value: isec.expenseRatio, accent: '#4F46E5' },
      { label: 'Bank Balance', value: bs.cashBalance || data.cashPosition.balance, sub: 'Point-in-time from balance sheet' },
      { label: 'Total Expenses', value: isec.periodExpenses },
    ],
    charts: finCharts,
    chartsLayout: 'grid',
  });

  // Collect statement line items — rendered last, 2-across
  const lineItemStatements: Array<{ sectionName: string; table: SectionPdfTable }> = [];

  // ── P&L Statement (charts + KPIs; line items deferred) ─────────────────────
  const plCharts: SectionPdfChart[] = [];
  if (isec.expenseCategories.length) {
    plCharts.push({
      title: 'Opex Breakdown',
      subtitle: 'Current P&L expense mix',
      svg: svgHorizontalBarChart(
        isec.expenseCategories.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 520, height: 250 },
      ),
    });
  }
  if (isec.monthlyTrend.length) {
    plCharts.push({
      title: 'Revenue vs Expenses vs NOI',
      subtitle: data.periodLabel,
      svg: svgMultiBarLineChart(
        isec.monthlyTrend.map(t => t.month),
        [
          { name: 'Revenue', values: isec.monthlyTrend.map(t => t.revenue), color: '#5B5FEF' },
          { name: 'Expenses', values: isec.monthlyTrend.map(t => t.expenses), color: '#2E4C8A' },
        ],
        { name: 'NOI', values: isec.monthlyTrend.map(t => t.noi), color: '#4A90C2' },
        { width: 520, height: 200 },
      ),
    });
  }
  if (isec.expenseCategories.length) {
    plCharts.push({
      title: 'Expense Breakdown',
      subtitle: 'Current period expense mix',
      svg: svgDoughnut(
        isec.expenseCategories.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  if (isec.yearlyStatements.length) {
    const yoy = buildYoyDetailTable(isec.yearlyStatements, 'Income Statement — Year View (YoY Detail)');
    if (yoy) {
      lineItemStatements.push({ sectionName: 'P&L Statement', table: yoy });
    }
  } else if (isec.lineItems.length) {
    // Fallback when yearly consolidation is unavailable
    const summary = isec.lineItems.filter(r => r.isSectionHeader || r.isTotal || r.isNetIncome);
    lineItemStatements.push({
      sectionName: 'P&L Statement',
      table: {
        title: `Income Statement — ${isec.statementPeriodLabel} (Subtotals)`,
        headers: ['Line Item', 'Amount'],
        rows: lineItemRows(summary.length ? summary : isec.lineItems, 100),
        rowKinds: (summary.length ? summary : isec.lineItems).slice(0, 100).map(r =>
          r.isNetIncome ? 'net' : r.isTotal ? 'total' : r.isSectionHeader ? 'header' : 'detail',
        ),
      },
    });
  }
  blocks.push({
    heading: 'P&L Statement',
    pageBreakBefore: true,
    forcePageBreak: true,
    kpis: [
      { label: 'Revenue', value: isec.periodRevenue },
      { label: 'Expenses', value: isec.periodExpenses },
      { label: 'NOI', value: isec.periodNoi, accent: '#166534' },
      { label: 'NOI Margin', value: isec.noiMargin },
    ],
    charts: plCharts,
    chartsLayout: 'grid',
    tables: lineItemStatements.some(s => s.sectionName === 'P&L Statement')
      ? undefined
      : [{ title: 'Income Statement', headers: ['Note'], rows: [[isec.unavailableMessage || 'No P&L line items uploaded']] }],
  });

  if (yearSnapshots.length) {
    blocks.push({
      heading: 'Multi-Year Financial Snapshot',
      pageBreakBefore: true,
      tables: [{
        title: `Multi-Year Financial Snapshot — ${data.entityLabel}`,
        headers: ['Year', 'Revenue', 'Expenses', 'Net Income', 'Bank', 'Net Margin %'],
        rows: yearSnapshots.map(y => [
          compactYoyColumnHeader(y),
          fmtUsd(y.revenue),
          fmtUsd(y.expenses),
          fmtSignedUsd(y.netIncome),
          y.cash > 0 ? fmtUsd(y.cash) : '—',
          Number.isFinite(y.margin) ? fmtMarginPctCapped(y.margin) : '—',
        ]),
      }],
    });
  }

  // ── Trend charts (P&L comeback set) ────────────────────────────────────────
  const trendCharts: SectionPdfChart[] = [];
  if (yearSnapshots.length) {
    trendCharts.push({
      title: 'Revenue vs Expenses vs Net Income',
      subtitle: 'Multi-year P&L trajectory',
      svg: svgMultiBarLineChart(
        yearSnapshots.map(y => y.yearLabel.slice(0, 12)),
        [
          { name: 'Revenue', values: yearSnapshots.map(y => y.revenue), color: '#5B5FEF' },
          { name: 'Expenses', values: yearSnapshots.map(y => y.expenses), color: '#2E4C8A' },
        ],
        { name: 'Net Income', values: yearSnapshots.map(y => y.netIncome), color: '#4A90C2' },
        { width: 520, height: 200 },
      ),
    });
    const bsSnapsForTrend = bs.bsSnapshots ?? [];
    if (bsSnapsForTrend.length) {
      trendCharts.push({
        title: 'Bank / AR / Loans & Advances',
        subtitle: 'Balance-sheet liquidity & financing',
        svg: svgMultiBarLineChart(
          bsSnapsForTrend.map(s => s.yearLabel.slice(0, 12)),
          [
            { name: 'Bank', values: bsSnapsForTrend.map(s => s.cash), color: '#166534' },
            { name: 'Current Assets', values: bsSnapsForTrend.map(s => s.currentAssets), color: '#2F80ED' },
          ],
          { name: 'Loans & Advances', values: bsSnapsForTrend.map(s => s.longTermDebt || s.totalDebt), color: '#5B5FEF' },
          { width: 520, height: 200 },
        ),
      });
    } else {
      trendCharts.push({
        title: 'Bank Balance Trend',
        svg: svgLineChart(
          yearSnapshots.map(y => y.yearLabel.slice(0, 12)),
          [{ name: 'Bank', values: yearSnapshots.map(y => y.cash), color: '#8B5CF6' }],
          { width: 520, height: 200 },
        ),
      });
    }
    trendCharts.push({
      title: 'Expense Ratio Trend',
      subtitle: 'Expenses ÷ Revenue %',
      svg: svgLineChart(
        yearSnapshots.map(y => y.yearLabel.slice(0, 12)),
        [{
          name: 'Expense Ratio %',
          values: yearSnapshots.map(y => (y.revenue > 0 ? (y.expenses / y.revenue) * 100 : 0)),
          color: '#F59E0B',
        }],
        { width: 520, height: 200 },
      ),
    });
    trendCharts.push({
      title: 'Revenue Breakdown by Year',
      svg: svgStackedBarChart(
        yearSnapshots.map(y => y.yearLabel.slice(0, 12)),
        [
          { name: 'Rental Income', values: yearSnapshots.map(y => y.rentalIncome), color: '#5B5FEF' },
          { name: 'Other Income', values: yearSnapshots.map(y => y.otherIncome), color: '#8B6914' },
          { name: 'Services', values: yearSnapshots.map(y => y.services), color: '#5C4A32' },
        ],
        { width: 520, height: 200 },
      ),
    });
  } else if (cf.cashTrend.length) {
    trendCharts.push({
      title: 'Bank Balance Trend',
      svg: svgLineChart(
        cf.cashTrend.map(t => t.month),
        [{ name: 'Bank', values: cf.cashTrend.map(t => t.cash), color: '#8B5CF6' }],
        { width: 520, height: 200 },
      ),
    });
  }
  if (trendCharts.length) {
    blocks.push({
      heading: 'Trends & Breakdowns',
      pageBreakBefore: true,
      charts: trendCharts,
      chartsLayout: 'grid',
    });
  }

  // ── Balance Sheet (charts + multi-year snapshot; line items deferred) ──────
  const bsSnapshots = bs.bsSnapshots ?? [];
  const bsCharts: SectionPdfChart[] = [];
  const selectedBs = bsSnapshots[bsSnapshots.length - 1];
  if (bsSnapshots.length) {
    bsCharts.push({
      title: 'Total Assets Trajectory',
      svg: svgLineChart(
        bsSnapshots.map(s => s.yearLabel.slice(0, 12)),
        [
          { name: 'Total Assets', values: bsSnapshots.map(s => s.totalAssets), color: '#5B5FEF' },
          { name: 'Total Liabilities', values: bsSnapshots.map(s => s.totalLiabilities), color: '#C0392B' },
        ],
        { width: 520, height: 200 },
      ),
    });
    bsCharts.push({
      title: 'Debt-to-Equity Trend',
      svg: svgLineChart(
        bsSnapshots.map(s => s.yearLabel.slice(0, 12)),
        [{ name: 'D/E (Debt ÷ Equity)', values: bsSnapshots.map(s => s.debtToEquity ?? 0), color: '#B45309' }],
        { width: 520, height: 200 },
      ),
    });
    bsCharts.push({
      title: 'Assets vs Liabilities',
      svg: svgGroupedBarChart(
        bsSnapshots.map(s => s.yearLabel.slice(0, 12)),
        [
          { name: 'Assets', values: bsSnapshots.map(s => s.totalAssets), color: '#5B5FEF' },
          { name: 'Liabilities', values: bsSnapshots.map(s => s.totalLiabilities), color: '#C0392B' },
        ],
        { width: 520, height: 200 },
      ),
    });
    bsCharts.push({
      title: 'Equity Trend',
      svg: svgLineChart(
        bsSnapshots.map(s => s.yearLabel.slice(0, 12)),
        [{ name: 'Equity', values: bsSnapshots.map(s => s.equity), color: '#166534' }],
        { width: 520, height: 200 },
      ),
    });
    bsCharts.push({
      title: 'Asset Composition by Year',
      svg: svgStackedBarChart(
        bsSnapshots.map(s => s.yearLabel.slice(0, 12)),
        [
          { name: 'Current Assets', values: bsSnapshots.map(s => s.currentAssets), color: '#5B5FEF' },
          { name: 'Fixed Assets', values: bsSnapshots.map(s => s.fixedAssets), color: '#8B6914' },
          { name: 'Other Assets', values: bsSnapshots.map(s => s.otherAssets), color: '#C4A882' },
        ],
        { width: 520, height: 200 },
      ),
    });
  }
  if (bs.assetComposition.length) {
    bsCharts.push({
      title: 'Asset Composition',
      svg: svgDoughnut(
        bs.assetComposition.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  if (selectedBs) {
    bsCharts.push({
      title: `Liability Breakdown (${selectedBs.yearLabel})`,
      svg: svgDoughnut(
        [
          { label: 'Current Liabilities', value: selectedBs.currentLiabilities, color: '#5B5FEF' },
          { label: 'Long-term Debt', value: selectedBs.longTermDebt, color: '#C0392B' },
          { label: 'Other Liabilities', value: selectedBs.otherLiabilities, color: '#166534' },
        ].filter(c => c.value > 0),
        { width: 360 },
      ),
    });
  } else if (bs.capitalStructure.length) {
    bsCharts.push({
      title: 'Capital Structure',
      svg: svgDoughnut(
        bs.capitalStructure.slice(0, 8).map((c, i) => ({
          label: c.name,
          value: c.value,
          color: CHART_COLORS[(i + 2) % CHART_COLORS.length],
        })),
        { width: 360 },
      ),
    });
  }
  const bsSnapshotTables: SectionPdfTable[] = [];
  if (bsSnapshots.length) {
    bsSnapshotTables.push({
      title: 'Multi-Year BS Snapshot',
      headers: ['Year', 'Total Assets', 'Total Liabilities', 'Equity', 'Bank', 'Current Assets', 'Current Liabilities', 'Current Ratio', 'Debt-to-Equity'],
      rows: bsSnapshots.map(r => [
        compactYoyColumnHeader(r),
        fmtUsd(r.totalAssets),
        fmtUsd(r.totalLiabilities),
        fmtSignedUsd(r.equity),
        r.cash > 0 ? fmtUsd(r.cash) : '—',
        fmtUsd(r.currentAssets),
        fmtUsd(r.currentLiabilities),
        r.currentRatio != null ? `${r.currentRatio.toFixed(2)}x` : '—',
        r.debtToEquity != null ? `${r.debtToEquity.toFixed(2)}x` : 'N/A',
      ]),
    });
  }
  if (bs.yearlyStatements.length || bs.lineItems.length) {
    const traditional = buildTraditionalTAccountBsPdfTables(data);
    if (traditional) {
      // 204 & 208 only — side-by-side Liabilities | Assets (skip YoY for this entity).
      if (bsSnapshotTables.length) {
        blocks.push({
          heading: 'Balance Sheet',
          pageBreakBefore: true,
          forcePageBreak: true,
          kpis: [
            { label: 'Total Assets', value: bs.totalAssets },
            { label: 'Total Liabilities', value: bs.totalLiabilities },
            { label: 'Equity', value: bs.equity, accent: '#166534' },
            { label: 'Bank', value: bs.cashBalance },
          ],
          charts: bsCharts,
          chartsLayout: 'grid',
          tables: bsSnapshotTables,
          tablesLayout: 'stack',
        });
        blocks.push({
          heading: 'Balance Sheet — T-Account',
          pageBreakBefore: true,
          forcePageBreak: true,
          tables: traditional,
          tablesLayout: 'grid',
        });
      } else {
        blocks.push({
          heading: 'Balance Sheet',
          pageBreakBefore: true,
          forcePageBreak: true,
          kpis: [
            { label: 'Total Assets', value: bs.totalAssets },
            { label: 'Total Liabilities', value: bs.totalLiabilities },
            { label: 'Equity', value: bs.equity, accent: '#166534' },
            { label: 'Bank', value: bs.cashBalance },
          ],
          charts: bsCharts,
          chartsLayout: 'grid',
          tables: traditional,
          tablesLayout: 'grid',
        });
      }
    } else if (bs.yearlyStatements.length) {
      const yoy = buildYoyDetailTable(bs.yearlyStatements, 'Balance Sheet — Year View (YoY Detail)');
      if (yoy) {
        lineItemStatements.push({ sectionName: 'Balance Sheet', table: yoy });
      }
      blocks.push({
        heading: 'Balance Sheet',
        pageBreakBefore: true,
        forcePageBreak: true,
        kpis: [
          { label: 'Total Assets', value: bs.totalAssets },
          { label: 'Total Liabilities', value: bs.totalLiabilities },
          { label: 'Equity', value: bs.equity, accent: '#166534' },
          { label: 'Bank', value: bs.cashBalance },
        ],
        charts: bsCharts,
        chartsLayout: 'grid',
        tables: bsSnapshotTables.length
          ? bsSnapshotTables
          : (lineItemStatements.some(s => s.sectionName === 'Balance Sheet')
            ? undefined
            : [{ title: 'Balance Sheet', headers: ['Note'], rows: [[bs.unavailableMessage || 'No Balance Sheet line items uploaded']] }]),
      });
    } else if (bs.lineItems.length) {
      const summary = bs.lineItems.filter(r => r.isSectionHeader || r.isTotal || r.isNetIncome);
      lineItemStatements.push({
        sectionName: 'Balance Sheet',
        table: {
          title: `Balance Sheet — ${bs.statementPeriodLabel} (Subtotals)`,
          headers: ['Line Item', 'Amount'],
          rows: lineItemRows(summary.length ? summary : bs.lineItems, 100),
          rowKinds: (summary.length ? summary : bs.lineItems).slice(0, 100).map(r =>
            r.isNetIncome ? 'net' : r.isTotal ? 'total' : r.isSectionHeader ? 'header' : 'detail',
          ),
        },
      });
      blocks.push({
        heading: 'Balance Sheet',
        pageBreakBefore: true,
        forcePageBreak: true,
        kpis: [
          { label: 'Total Assets', value: bs.totalAssets },
          { label: 'Total Liabilities', value: bs.totalLiabilities },
          { label: 'Equity', value: bs.equity, accent: '#166534' },
          { label: 'Bank', value: bs.cashBalance },
        ],
        charts: bsCharts,
        chartsLayout: 'grid',
        tables: bsSnapshotTables.length ? bsSnapshotTables : undefined,
      });
    }
  } else {
    blocks.push({
      heading: 'Balance Sheet',
      pageBreakBefore: true,
      forcePageBreak: true,
      kpis: [
        { label: 'Total Assets', value: bs.totalAssets },
        { label: 'Total Liabilities', value: bs.totalLiabilities },
        { label: 'Equity', value: bs.equity, accent: '#166534' },
        { label: 'Bank', value: bs.cashBalance },
      ],
      charts: bsCharts,
      chartsLayout: 'grid',
      tables: bsSnapshotTables.length
        ? bsSnapshotTables
        : [{ title: 'Balance Sheet', headers: ['Note'], rows: [[bs.unavailableMessage || 'No Balance Sheet line items uploaded']] }],
    });
  }

  // ── Cash Flow (charts + multi-year snapshot; line items deferred) ──────────
  const snaps = cf.cfSnapshots ?? [];
  const cfSnapshotTables: SectionPdfTable[] = [];
  if (snaps.length) {
    cfSnapshotTables.push({
      title: 'Multi-Year CF Snapshot',
      headers: [
        'Year', 'Operating CF', 'Investing CF', 'Financing CF',
        'Net CF', 'Opening Cash', 'Closing Cash', 'Mo. Burn', 'Runway',
      ],
      rows: snaps.map(s => {
        const burn = s.netCashFlow < 0
          ? Math.abs(s.netCashFlow) / 12
          : (s.openingCash > s.closingCash ? (s.openingCash - s.closingCash) / 12 : 0);
        const runway = burn > 0 && s.closingCash > 0 ? `${(s.closingCash / burn).toFixed(1)} mo` : '—';
        return [
          compactYoyColumnHeader(s),
          fmtSignedUsd(s.operatingCf),
          fmtSignedUsd(s.investingCf),
          fmtSignedUsd(s.financingCf),
          fmtSignedUsd(s.netCashFlow),
          s.openingCash !== 0 ? fmtSignedUsd(s.openingCash) : '—',
          s.closingCash !== 0 ? fmtSignedUsd(s.closingCash) : '—',
          burn > 0 ? fmtUsd(burn) : '—',
          runway,
        ];
      }),
    });
  }
  if (cf.yearlyStatements.length) {
    const yoy = buildYoyDetailTable(cf.yearlyStatements, 'Cash Flow — Year View (YoY Detail)');
    if (yoy) {
      lineItemStatements.push({ sectionName: 'Cash Flow', table: yoy });
    }
  } else if (cf.lineItems.length) {
    lineItemStatements.push({
      sectionName: 'Cash Flow',
      table: {
        title: `Cash Flow Statement — ${cf.statementPeriodLabel}`,
        headers: ['Line Item', 'Amount'],
        rows: lineItemRows(cf.lineItems, 120),
        rowKinds: cf.lineItems.slice(0, 120).map(r =>
          r.isNetIncome ? 'net' : r.isTotal ? 'total' : r.isSectionHeader ? 'header' : 'detail',
        ),
      },
    });
  }
  const cfCharts: SectionPdfChart[] = [];
  if (snaps.length >= 1) {
    cfCharts.push({
      title: 'Net Cash Flow Trajectory',
      svg: svgSignedLineChart(
        snaps.map(s => s.yearLabel.slice(0, 10)),
        [{ name: 'Net Cash Flow', values: snaps.map(s => s.netCashFlow), color: '#22C55E' }],
        { width: 520, height: 200 },
      ),
    });
    if (snaps.length >= 2) {
      cfCharts.push({
        title: 'Operating CF Margin Trend',
        svg: svgSignedLineChart(
          snaps.map(s => s.yearLabel.slice(0, 10)),
          [{ name: 'OCF ÷ Revenue %', values: snaps.map(s => s.operatingCfMargin ?? 0), color: '#0F766E' }],
          { width: 520, height: 200 },
        ),
      });
      cfCharts.push({
        title: 'CF Category Comparison',
        svg: svgSignedGroupedBarChart(
          snaps.map(s => s.yearLabel.slice(0, 10)),
          [
            { name: 'Operating', values: snaps.map(s => s.operatingCf), color: '#5B5FEF' },
            { name: 'Investing', values: snaps.map(s => s.investingCf), color: '#166534' },
            { name: 'Financing', values: snaps.map(s => s.financingCf), color: '#C0392B' },
          ],
          { width: 520, height: 200 },
        ),
      });
    }
    cfCharts.push({
      title: 'Cumulative Cash Trend (Closing Balance)',
      svg: svgLineChart(
        snaps.map(s => s.yearLabel.slice(0, 10)),
        [{ name: 'Closing Cash', values: snaps.map(s => s.closingCash), color: '#8B5CF6' }],
        { width: 520, height: 200 },
      ),
    });
  } else if (cf.cashTrend.length) {
    cfCharts.push({
      title: 'Cumulative Cash Trend (Closing Balance)',
      svg: svgLineChart(
        cf.cashTrend.map(t => t.month),
        [{ name: 'Closing Cash', values: cf.cashTrend.map(t => t.cash), color: '#8B5CF6' }],
        { width: 520, height: 200 },
      ),
    });
  } else if (yearSnapshots.some(y => y.cash > 0)) {
    // Fallback so consultancy / BS-only entities still show a cashflow page
    cfCharts.push({
      title: 'Bank Balance Trend (from Balance Sheet)',
      subtitle: 'Cash Flow statement not uploaded — showing BS bank balance',
      svg: svgLineChart(
        yearSnapshots.map(y => y.yearLabel.slice(0, 12)),
        [{ name: 'Bank', values: yearSnapshots.map(y => y.cash), color: '#8B5CF6' }],
        { width: 520, height: 200 },
      ),
    });
  }
  if (cf.cfSourceBreakdown?.some(r => r.values.length > 0)) {
    const sourceKeys = [...new Set(cf.cfSourceBreakdown.flatMap(r => r.values.map(v => v.name)))].slice(0, 8);
    cfCharts.push({
      title: 'CF Source Breakdown by Year',
      svg: svgSignedStackedBarChart(
        cf.cfSourceBreakdown.map(r => r.yearLabel.slice(0, 10)),
        sourceKeys.map((key, i) => ({
          name: key,
          values: cf.cfSourceBreakdown.map(r => r.values.find(v => v.name === key)?.value ?? 0),
          color: CHART_COLORS[i % CHART_COLORS.length],
        })),
        { width: 520, height: 200 },
      ),
    });
  }
  if (snaps.length) {
    cfCharts.push({
      title: `CF Breakdown (${snaps[snaps.length - 1].yearLabel})`,
      svg: svgDoughnut(
        [
          { label: 'Operating CF', value: Math.abs(snaps[snaps.length - 1].operatingCf), color: '#5B5FEF' },
          { label: 'Investing CF', value: Math.abs(snaps[snaps.length - 1].investingCf), color: '#166534' },
          { label: 'Financing CF', value: Math.abs(snaps[snaps.length - 1].financingCf), color: '#C0392B' },
        ].filter(c => c.value > 0),
        { width: 360 },
      ),
    });
  }
  blocks.push({
    heading: 'Cash Flow',
    pageBreakBefore: true,
    forcePageBreak: true,
    kpis: [
      { label: 'Operating CF', value: cf.operatingCf, accent: '#166534' },
      { label: 'Financing CF', value: cf.financingCf },
      { label: 'Investing CF', value: cf.investingCf },
      { label: 'Net Cash Flow', value: cf.netCashFlow },
    ],
    charts: cfCharts,
    chartsLayout: 'grid',
    tables: cfSnapshotTables.length
      ? cfSnapshotTables
      : (lineItemStatements.some(s => s.sectionName === 'Cash Flow')
        ? undefined
        : [{ title: 'Cash Flow', headers: ['Note'], rows: [[cf.unavailableMessage || 'No Cash Flow data uploaded']] }]),
  });

  // ── Statement YoY detail last (full-width year columns) ────────────────────
  if (lineItemStatements.length) {
    const yoyTables = lineItemStatements.filter(s => (s.table.headers?.length ?? 0) > 2);
    const periodTables = lineItemStatements.filter(s => (s.table.headers?.length ?? 0) <= 2);
    if (yoyTables.length) {
      blocks.push(...paginateYoySummaryStatements(yoyTables, 28));
    }
    if (periodTables.length) {
      blocks.push(...paginateLineItemsSideBySide(periodTables, 26));
    }
  }

  // ── Action Required last (after all financials; Strategy follows in HTML) ──
  const actionAlerts: SectionPdfAlert[] = (data.riskActionTable ?? []).slice(0, 8).map(r => ({
    severity: r.severity === 'critical' ? 'critical' : 'warning',
    title: r.issue || `${r.property} — Action`,
    text: [r.kpi, r.impact ? `Impact: ${r.impact}` : '', r.owner ? `Owner: ${r.owner}` : '']
      .filter(Boolean)
      .join(' · '),
  }));
  if (actionAlerts.length) {
    blocks.push({
      heading: 'Action Required',
      pageBreakBefore: true,
      alerts: actionAlerts,
    });
  }

  return blocks;
}

function buildProfitabilityPdfParts(data: CeoBoardExportPayload): {
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  tables: SectionPdfTable[];
  sourceNote: string;
} {
  const isec = data.incomeStatement;
  const bs = data.balanceSheet;
  const kpis: SectionPdfKpi[] = [
    { label: 'NOI', value: isec.periodNoi, accent: '#166534' },
    { label: 'NOI Margin', value: isec.noiMargin },
    { label: 'Net Income Margin', value: isec.netIncomeMargin },
    { label: 'Expense Ratio', value: isec.expenseRatio },
    { label: 'Bank', value: bs.cashBalance },
    { label: 'Debt / Equity', value: bs.debtToEquity },
  ];
  if (data.financialPerformance.profitability.length) {
    data.financialPerformance.profitability.slice(0, 4).forEach(p => {
      kpis.push({ label: p.label, value: p.value });
    });
  }
  const charts: SectionPdfChart[] = [];
  if (isec.monthlyTrend.length) {
    charts.push({
      title: 'Margin Drivers — Rev / Exp / NOI',
      svg: svgGroupedBarChart(
        isec.monthlyTrend.map(t => t.month),
        [
          { name: 'Revenue', values: isec.monthlyTrend.map(t => t.revenue), color: '#5B5FEF' },
          { name: 'Expenses', values: isec.monthlyTrend.map(t => t.expenses), color: '#2E4C8A' },
          { name: 'NOI', values: isec.monthlyTrend.map(t => t.noi), color: '#4A90C2' },
        ],
        { title: 'Profitability Trend', width: 520, height: 200 },
      ),
    });
  }
  const tables: SectionPdfTable[] = [];
  if (data.financialPerformance.waterfall.length) {
    tables.push({
      title: 'Profitability Waterfall',
      headers: ['Step', 'Amount'],
      rows: data.financialPerformance.waterfall.map(w => [w.label, w.value]),
    });
  }
  return {
    kpis: kpis.slice(0, 8),
    charts,
    tables,
    sourceNote: 'Rentals → Financials · Profitability',
  };
}

function buildActionPlanPdfParts(data: CeoBoardExportPayload): {
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  tables: SectionPdfTable[];
  alerts: SectionPdfAlert[];
  sourceNote: string;
} {
  const risks = data.riskActionTable;
  const critical = risks.filter(r => r.severity === 'critical').length;
  const warning = risks.filter(r => r.severity === 'warning').length;
  const kpis: SectionPdfKpi[] = [
    { label: 'Action Items', value: String(risks.length) },
    { label: 'Critical', value: String(critical), accent: critical ? '#B91C1C' : undefined },
    { label: 'Warnings', value: String(warning), accent: warning ? '#F5A623' : undefined },
    { label: 'Flagged Properties', value: String(data.propertyProfitability.rows.filter(r => r.flagged).length) },
  ];
  const alerts: SectionPdfAlert[] = risks.slice(0, 8).map(r => ({
    severity: r.severity === 'critical' ? 'critical' : 'warning',
    title: `${r.property} — ${r.issue}`,
    text: `${r.kpi} · Impact: ${r.impact} · Owner: ${r.owner} · Due: ${r.dueDate}`,
  }));
  const tables: SectionPdfTable[] = risks.length
    ? [{
        title: 'Risk / Action Register',
        headers: ['Property', 'Issue', 'KPI', 'Owner', 'Due'],
        rows: risks.slice(0, 15).map(r => [
          r.property.slice(0, 22),
          r.issue.slice(0, 28),
          r.kpi.slice(0, 18),
          r.owner.slice(0, 14),
          r.dueDate,
        ]),
      }]
    : [];
  return {
    kpis,
    charts: [],
    tables,
    alerts,
    sourceNote: 'Rentals → Financials · Action Plan',
  };
}

function buildPropertyPerformancePdfParts(data: CeoBoardExportPayload): {
  kpis: SectionPdfKpi[];
  charts: SectionPdfChart[];
  tables: SectionPdfTable[];
  sourceNote: string;
} {
  const rows = data.propertyProfitability.rows;
  const flagged = rows.filter(r => r.flagged).length;
  const kpis: SectionPdfKpi[] = [
    { label: 'Properties', value: String(rows.length) },
    { label: 'Flagged', value: String(flagged), accent: flagged ? '#B91C1C' : '#166534' },
    { label: 'Portfolio Occ.', value: data.rentalPerformance.occupancy },
    { label: 'Collection Rate', value: data.rentalPerformance.collectionRate },
  ];
  const charts: SectionPdfChart[] = [];
  const withMargin = rows.filter(r => r.noiMarginPct != null).slice(0, 10);
  if (withMargin.length) {
    charts.push({
      title: 'NOI Margin by Property',
      svg: svgBarChart(
        withMargin.map(r => r.property.slice(0, 12)),
        withMargin.map(r => r.noiMarginPct ?? 0),
        '#5B5FEF',
        { title: 'NOI Margin %', width: 520, height: 220 },
      ),
    });
  }
  const tables: SectionPdfTable[] = rows.length
    ? [{
        title: 'Property Performance',
        headers: ['Property', 'Occupancy', 'NOI Margin', 'DSCR', 'Arrears', 'Flag'],
        rows: rows.slice(0, 20).map(r => [
          r.property.slice(0, 28),
          r.occupancy,
          r.noiMargin,
          r.dscr,
          r.arrears,
          r.flagged ? 'Yes' : '',
        ]),
      }]
    : [];
  return {
    kpis,
    charts,
    tables,
    sourceNote: 'Rentals → Financials · Property Performance',
  };
}

function prefixParts(
  prefix: string,
  parts: { kpis: SectionPdfKpi[]; charts: SectionPdfChart[]; tables: SectionPdfTable[]; alerts?: SectionPdfAlert[] },
): { kpis: SectionPdfKpi[]; charts: SectionPdfChart[]; tables: SectionPdfTable[]; alerts: SectionPdfAlert[] } {
  return {
    kpis: parts.kpis.map(k => ({ ...k, label: `${prefix}: ${k.label}` })),
    charts: parts.charts.map(c => ({ ...c, title: `${prefix} — ${c.title}` })),
    tables: parts.tables.map(t => ({ ...t, title: t.title ? `${prefix} — ${t.title}` : prefix })),
    alerts: (parts.alerts ?? []).map(a => ({ ...a, title: `${prefix}: ${a.title}` })),
  };
}

function buildFinancialsScopePayload(
  data: CeoBoardExportPayload,
  strategy: SectionStrategyPlan,
  scope: FinancialsPdfScope,
): SectionPdfPayload {
  const baseMeta = {
    tab: 'financials' as RentalTab,
    entityLabel: data.entityLabel,
    periodLabel: data.periodLabel,
    generatedAt: data.generatedAt,
    strategy,
  };

  if (scope === 'income-statement') {
    const parts = buildIncomeStatementPdfParts(data);
    return {
      ...baseMeta,
      sectionTitle: FINANCIALS_SCOPE_TITLES[scope],
      fileSectionName: FINANCIALS_SCOPE_FILES[scope],
      sourceNote: parts.sourceNote,
      kpis: parts.kpis,
      charts: parts.charts,
      tables: parts.tables,
      liveParityNotes: ['P&L KPIs', 'Monthly trend', 'Expense mix', 'Line items'],
    };
  }

  if (scope === 'balance-sheet') {
    const parts = buildBalanceSheetPdfParts(data);
    return {
      ...baseMeta,
      sectionTitle: FINANCIALS_SCOPE_TITLES[scope],
      fileSectionName: FINANCIALS_SCOPE_FILES[scope],
      sourceNote: parts.sourceNote,
      kpis: parts.kpis,
      charts: parts.charts,
      tables: parts.tables,
      tablesLayout: parts.tablesLayout,
      strategy: {
        commentary: data.slideNarratives.balanceSheet,
        actions: strategy.actions,
      },
      liveParityNotes: ['BS KPIs', 'Asset mix', 'Capital structure', 'Line items'],
    };
  }

  if (scope === 'cash-flow') {
    const parts = buildCashFlowPdfParts(data);
    return {
      ...baseMeta,
      sectionTitle: FINANCIALS_SCOPE_TITLES[scope],
      fileSectionName: FINANCIALS_SCOPE_FILES[scope],
      sourceNote: parts.sourceNote,
      kpis: parts.kpis,
      charts: parts.charts,
      tables: parts.tables,
      strategy: {
        commentary: data.slideNarratives.cashFlow,
        actions: strategy.actions,
      },
      liveParityNotes: ['CF KPIs', 'Cash trend', 'Operating vs financing', 'Line items'],
    };
  }

  if (scope === 'cfo-dashboard') {
    const blocks = buildCfoDashboardBoardBlocks(data);
    const flatKpis = blocks[0]?.kpis ?? [];
    const flatCharts = blocks.flatMap(b => b.charts ?? []);
    const flatTables = blocks.flatMap(b => b.tables ?? []);
    return {
      ...baseMeta,
      sectionTitle: 'CFO Dashboard',
      fileSectionName: 'CFODashboard',
      sourceNote: 'Rentals → Executive Summary + Financials · CFO Dashboard board pack',
      kpis: flatKpis,
      charts: flatCharts,
      tables: flatTables,
      blocks,
      strategy: {
        commentary: [
          data.slideNarratives.portfolioSnapshot,
          data.slideNarratives.rentalPerformance,
          data.slideNarratives.incomeStatement,
          data.slideNarratives.balanceSheet,
          data.slideNarratives.cashFlow,
        ].filter(Boolean).join(' '),
        actions: strategy.actions,
      },
      liveParityNotes: [
        'Portfolio Snapshot KPIs + Unit Mix / Asset / Debt donuts',
        'Rental Performance KPIs + GPR vs Collected + Occupancy',
        'Finance & Profitability KPIs + Revenue · Expenses · NOI',
        'P&L / BS / CF charts + multi-year snapshots + YoY detail',
      ],
    };
  }

  if (scope === 'profitability') {
    const parts = buildProfitabilityPdfParts(data);
    return {
      ...baseMeta,
      sectionTitle: FINANCIALS_SCOPE_TITLES[scope],
      fileSectionName: FINANCIALS_SCOPE_FILES[scope],
      sourceNote: parts.sourceNote,
      kpis: parts.kpis,
      charts: parts.charts,
      tables: parts.tables,
      liveParityNotes: ['Margins', 'Waterfall', 'Trend chart'],
    };
  }

  if (scope === 'action-plan') {
    const parts = buildActionPlanPdfParts(data);
    return {
      ...baseMeta,
      sectionTitle: FINANCIALS_SCOPE_TITLES[scope],
      fileSectionName: FINANCIALS_SCOPE_FILES[scope],
      sourceNote: parts.sourceNote,
      kpis: parts.kpis,
      charts: parts.charts,
      tables: parts.tables,
      alerts: parts.alerts,
      strategy: {
        commentary: data.actionPlanCommentary || strategy.commentary,
        actions: [
          ...parts.alerts.slice(0, 3).map(a => a.title),
          ...strategy.actions,
        ].slice(0, 5),
      },
      liveParityNotes: ['Risk alerts', 'Action register'],
    };
  }

  if (scope === 'property-performance') {
    const parts = buildPropertyPerformancePdfParts(data);
    return {
      ...baseMeta,
      sectionTitle: FINANCIALS_SCOPE_TITLES[scope],
      fileSectionName: FINANCIALS_SCOPE_FILES[scope],
      sourceNote: parts.sourceNote,
      kpis: parts.kpis,
      charts: parts.charts,
      tables: parts.tables,
      strategy: {
        commentary: data.slideNarratives.propertyProfitability,
        actions: strategy.actions,
      },
      liveParityNotes: ['Property table', 'NOI margin bars'],
    };
  }

  // combined
  const scopes: Exclude<FinancialsPdfScope, 'combined'>[] = [
    'cfo-dashboard',
    'profitability',
    'action-plan',
    'property-performance',
    'income-statement',
    'balance-sheet',
    'cash-flow',
  ];
  const labels: Record<Exclude<FinancialsPdfScope, 'combined'>, string> = {
    'cfo-dashboard': 'CFO',
    profitability: 'Profitability',
    'action-plan': 'Action',
    'property-performance': 'Property',
    'income-statement': 'P&L',
    'balance-sheet': 'BS',
    'cash-flow': 'CF',
  };
  const kpis: SectionPdfKpi[] = [];
  const charts: SectionPdfChart[] = [];
  const tables: SectionPdfTable[] = [];
  const alerts: SectionPdfAlert[] = [];

  for (const s of scopes) {
    const single = buildFinancialsScopePayload(data, strategy, s);
    const prefixed = prefixParts(labels[s], {
      kpis: single.kpis,
      charts: single.charts,
      tables: single.tables ?? [],
      alerts: single.alerts,
    });
    // Keep combined KPI strip light — only first 2 from each section
    kpis.push(...prefixed.kpis.slice(0, 2));
    charts.push(...prefixed.charts);
    tables.push(...prefixed.tables);
    alerts.push(...prefixed.alerts);
  }

  return {
    ...baseMeta,
    sectionTitle: FINANCIALS_SCOPE_TITLES.combined,
    fileSectionName: FINANCIALS_SCOPE_FILES.combined,
    sourceNote: 'Rentals → Financials · Combined (CFO, Profitability, Action Plan, Property, P&L, BS, CF)',
    kpis: kpis.slice(0, 12),
    charts,
    tables,
    alerts: alerts.slice(0, 10),
    strategy: {
      commentary: [
        data.slideNarratives.incomeStatement,
        data.actionPlanCommentary,
      ].filter(Boolean).join(' '),
      actions: strategy.actions,
    },
    liveParityNotes: FINANCIALS_PDF_SCOPE_OPTIONS.filter(o => o.id !== 'combined').map(o => o.label),
  };
}

export function buildSectionPdfPayload(
  tab: RentalTab,
  data: CeoBoardExportPayload,
  strategy: SectionStrategyPlan,
  opts?: BuildSectionPdfOptions,
): SectionPdfPayload {
  const financialsScope = opts?.financialsScope ?? 'income-statement';
  const base = {
    tab,
    sectionTitle: tab === 'financials'
      ? FINANCIALS_SCOPE_TITLES[financialsScope]
      : (SECTION_TITLES[tab] ?? tab),
    fileSectionName: tab === 'financials'
      ? FINANCIALS_SCOPE_FILES[financialsScope]
      : (FILE_NAMES[tab] ?? tab.replace(/-/g, '')),
    entityLabel: data.entityLabel,
    periodLabel: data.periodLabel,
    generatedAt: data.generatedAt,
    strategy,
  };

  // ── Overview / Vacancy / Units ─────────────────────────────────────────────
  // LIVE PARITY CHECKLIST (Overview): primary KPIs · Collection Rate (collected÷billed) ·
  // AR Aging · Top Risk · Attention Now · Occ gauge · GPR vs Collected · Vacancy by Co ·
  // Occ/Vacant donut · Avg Rent by Co · Occ/NOI by Co · Lease expirations · Strategy.
  // Vacancy & Units use separate payloads — do NOT reuse Overview content blindly.
  if (tab === 'overview' || tab === 'vacancy' || tab === 'units') {
    const rp = data.rentalPortfolio;
    const perf = data.rentalPerformance;
    const ar = data.arDashboard;
    const metrics = perf.companyMetrics ?? [];
    const occNum = parseFloat(String(perf.occupancy).replace(/[^0-9.]/g, '')) || 0;
    const collNum = parseFloat(String(perf.collectionRate).replace(/[^0-9.]/g, '')) || 0;
    const collectedNum = parseFloat(String(perf.collected).replace(/[^0-9.-]/g, '')) || 0;
    const vacUnits = data.portfolioSnapshot.vacantUnits;
    const occUnits = Number(data.portfolioSnapshot.occupiedUnits) || 0;
    const totalUnits = Number(data.portfolioSnapshot.totalUnits) || occUnits + vacUnits;
    const avgOccRent = metrics.length
      ? metrics.reduce((s, m) => s + m.avgRent * m.occupied, 0) / Math.max(1, metrics.reduce((s, m) => s + m.occupied, 0))
      : (collectedNum > 0 && occUnits > 0 ? collectedNum / occUnits : null);

    const shortName = (n: string) => n.split(' ').slice(0, 2).join(' ').slice(0, 14);

    if (tab === 'vacancy') {
      const vacantRows = metrics
        .filter(m => m.vacant > 0 || m.vacancyLoss > 0)
        .sort((a, b) => b.vacancyLoss - a.vacancyLoss);
      const charts: SectionPdfChart[] = [];
      if (vacantRows.length) {
        charts.push({
          title: 'Vacancy Loss by Company',
          svg: svgBarChart(
            vacantRows.slice(0, 10).map(m => shortName(m.name)),
            vacantRows.slice(0, 10).map(m => m.vacancyLoss),
            '#B91C1C',
            { title: 'Vacancy Loss by Company', width: 520, height: 200 },
          ),
        });
      }
      return {
        ...base,
        sourceNote: 'Rentals → Vacancy & Loss',
        liveParityNotes: ['Vacant unit KPIs', 'Vacancy Loss by Company', 'Vacant company table'],
        kpis: [
          { label: 'Vacant Units', value: String(vacUnits), accent: '#B91C1C' },
          { label: 'Monthly Vacancy Loss', value: perf.vacancyLoss, accent: '#B91C1C' },
          { label: 'Occupancy', value: perf.occupancy },
          { label: 'Expected Rent (GPR)', value: perf.gpr },
        ],
        charts,
        tables: vacantRows.length
          ? [{
              title: 'Vacancy by Company',
              headers: ['Company', 'Vacant', 'Units', 'Occupancy', 'Vacancy Loss'],
              rows: vacantRows.slice(0, 12).map(m => [
                m.name.slice(0, 28),
                String(m.vacant),
                String(m.totalUnits),
                pct(m.occupancyPct),
                fmtUsd(m.vacancyLoss),
              ]),
            }]
          : undefined,
      };
    }

    if (tab === 'units') {
      const now = new Date();
      const up = buildUnitsPerformanceBundle(opts?.units ?? [], {
        period: opts?.period ?? null,
        month: opts?.month ?? now.getMonth() + 1,
        year: opts?.year ?? now.getFullYear(),
        entityId: opts?.entityId ?? 'portfolio',
      });
      const k = up.kpis;
      const charts: SectionPdfChart[] = [];

      if (up.crossSection.length) {
        charts.push({
          title: 'Lost Rent vs Occupancy by Unit',
          subtitle: 'Bars = vacancy loss · Line = occupancy %',
          svg: svgComboBarLine(
            up.crossSection.map(r => r.name),
            up.crossSection.map(r => r.lost),
            up.crossSection.map(r => r.occPct),
            { title: 'Lost Rent vs Occupancy', width: 520, height: 220 },
          ),
        });
      }
      if (up.monthlyTrend.length) {
        charts.push({
          title: 'Monthly Trend — Collected vs Expected',
          subtitle: data.periodLabel,
          svg: svgGroupedBarChart(
            up.monthlyTrend.map(t => t.month),
            [
              { name: 'Expected', values: up.monthlyTrend.map(t => t.expected), color: '#5B5FEF' },
              { name: 'Collected', values: up.monthlyTrend.map(t => t.collected), color: '#0F766E' },
            ],
            { title: 'Collected vs Expected', width: 520, height: 200 },
          ),
        });
      }
      if (up.buildingChart.length) {
        charts.push({
          title: 'By Building',
          subtitle: `${data.periodLabel} · Collected vs Expected`,
          svg: svgGroupedBarChart(
            up.buildingChart.slice(0, 8).map(b => b.name.slice(0, 14)),
            [
              { name: 'Expected', values: up.buildingChart.slice(0, 8).map(b => b.expected), color: '#5B5FEF' },
              { name: 'Collected', values: up.buildingChart.slice(0, 8).map(b => b.collected), color: '#0F766E' },
            ],
            { title: 'By Building', width: 520, height: 200 },
          ),
        });
      }
      charts.push({
        title: 'Occupancy Rate vs 92% Target',
        svg: svgOccupancyGauge(k.occRate * 100, 92, { title: 'Occupancy Rate vs 92% Target', width: 280, height: 160 }),
      });
      if (k.occupied + k.vacant > 0) {
        charts.push({
          title: 'Occupied vs Vacant Units',
          svg: svgDoughnut(
            [
              { label: 'Occupied', value: k.occupied, color: '#166534' },
              { label: 'Vacant', value: k.vacant, color: '#B91C1C' },
            ].filter(s => s.value > 0),
            { width: 360 },
          ),
        });
      }
      if (up.vacancyByCompany.length) {
        charts.push({
          title: 'Vacancy Loss by Company',
          svg: svgHorizontalBarChart(
            up.vacancyByCompany.map(r => ({ label: r.name.slice(0, 22), value: r.loss, color: '#5B5FEF' })),
            { width: 520, height: Math.max(160, up.vacancyByCompany.length * 28) },
          ),
        });
      }
      if (up.avgRentByCompany.length) {
        charts.push({
          title: 'Avg Rent per Unit by Company',
          svg: svgHorizontalBarChart(
            up.avgRentByCompany.map(r => ({ label: r.name.slice(0, 22), value: r.avgRent, color: '#5B5FEF' })),
            { width: 520, height: Math.max(160, up.avgRentByCompany.length * 28) },
          ),
        });
      }

      const tables: SectionPdfTable[] = [];
      if (up.topRisk.length) {
        tables.push({
          title: `Top Risk Units · ${up.topRisk.length} shown`,
          headers: ['Unit', 'Building', 'Occ Mo', 'Vac Mo', 'Collected', 'Expected', 'Lost', 'Occ %', 'Avg Rent', 'Trend', 'Action', 'Score'],
          rows: up.topRisk.map(r => [
            r.unit.slice(0, 18),
            r.building.slice(0, 22),
            String(r.occMonths),
            String(r.vacMonths),
            fmtUsd(r.collected),
            fmtUsd(r.expected),
            r.lost > 0 ? fmtUsd(r.lost) : '—',
            `${r.occPct}%`,
            r.avgRent > 0 ? fmtUsd(r.avgRent) : '—',
            r.trend,
            r.action,
            String(r.score),
          ]),
        });
      }
      if (up.buildingChart.length) {
        tables.push({
          title: 'By Building — Collected vs Expected',
          headers: ['Building', 'Collected', 'Expected', 'Lost'],
          rows: up.buildingChart.map(b => [
            b.name,
            fmtUsd(b.collected),
            fmtUsd(b.expected),
            fmtUsd(Math.max(0, b.expected - b.collected)),
          ]),
        });
      }

      return {
        ...base,
        sourceNote: 'Rentals → Units · LTM Performance',
        liveParityNotes: [
          '8 KPI cards (Occupied Units, Occupied Rent, Rent Receivable %, …)',
          'By Building chart + building name on Top Risk',
          'Top Risk Units table',
          'Strategic Insights alerts',
          'Occupancy gauge · Collected vs Expected · Vacancy by company',
        ],
        kpis: [
          { label: 'Total Units', value: String(k.totalUnits || '—'), sub: `${k.totalUnits} in scope` },
          { label: 'Occupied Units', value: String(k.occupied), sub: `${k.vacant} vacant`, accent: '#166534' },
          {
            label: 'Occupancy Rate',
            value: `${Math.round(k.occRate * 100)}%`,
            accent: k.occRate >= 0.92 ? '#166534' : k.occRate >= 0.82 ? '#5B5FEF' : '#B91C1C',
          },
          { label: 'Occupied Rent', value: fmtUsd(k.occupiedRent), sub: `${k.occupied} units · monthly rent`, accent: '#0F766E' },
          { label: 'Expected Rent', value: fmtUsd(k.expected), sub: 'Occupied Rent + Vacancy Loss' },
          { label: 'Vacancy Loss', value: fmtUsd(k.lost), sub: `${k.vacant} vacant · lease / registry`, accent: '#B91C1C' },
          {
            label: 'Rent Receivable %',
            value: k.receivablePct != null ? `${k.receivablePct.toFixed(1)}%` : '—',
            sub: 'outstanding vs. agreement rent',
            accent: k.receivablePct != null && k.receivablePct > 25 ? '#B91C1C' : undefined,
          },
          {
            label: 'Avg Occ Rent',
            value: k.avgOccRent != null ? fmtUsd(k.avgOccRent) : '—',
            sub: '/mo per occupied',
            accent: '#5B5FEF',
          },
        ],
        charts,
        tables,
        alerts: up.insights.length
          ? up.insights.map(i => ({ severity: i.severity, title: i.title, text: i.text }))
          : [{ severity: 'info' as const, title: 'No urgent issues', text: 'Portfolio within normal range.' }],
        alertsTitle: 'Strategic Insights',
      };
    }

    // ── Overview (full parity with live RentalOverview heroes) ───────────────
    const billedSub = perf.billed
      ? `of ${perf.billed} billed (same period)`
      : 'Collected ÷ GPR/Billed (same period)';

    const kpis: SectionPdfKpi[] = [
      { label: 'Occupancy Rate', value: perf.occupancy, sub: `${data.portfolioSnapshot.occupiedUnits} / ${data.portfolioSnapshot.totalUnits} units`, accent: '#166534' },
      { label: 'Rent Collected', value: perf.collected, sub: data.periodLabel, accent: '#0F766E' },
      { label: 'Expected Rent (GPR)', value: perf.gpr, sub: 'If all units occupied' },
      { label: 'Vacancy Loss', value: perf.vacancyLoss, sub: `${vacUnits} vacant unit${vacUnits !== 1 ? 's' : ''}`, accent: '#B91C1C' },
      { label: 'Collection Rate', value: perf.collectionRate, sub: billedSub, accent: collNum < 95 ? '#B91C1C' : '#166534' },
      { label: 'Avg Occ Rent', value: avgOccRent != null ? fmtUsd(avgOccRent) : '—', sub: '/mo per occupied', accent: '#5B5FEF' },
      { label: 'Outstanding AR', value: perf.arOutstanding, sub: 'QB A/R Aging TOTAL' },
      { label: 'NOI Margin (P&L)', value: rp.noiMargin, sub: 'From Financials P&L' },
    ];

    const charts: SectionPdfChart[] = [];
    const trend = perf.gprTrend.filter(t => t.gpr > 0 || t.collected > 0);

    charts.push({
      title: `Occupancy Rate vs 92% Target`,
      svg: svgOccupancyGauge(occNum, 92, { title: 'Occupancy Rate vs 92% Target', width: 280, height: 160 }),
    });

    if (occUnits + vacUnits > 0) {
      charts.push({
        title: 'Occupied vs Vacant Units',
        svg: svgDoughnut(
          [
            { label: 'Occupied', value: Math.max(0, occUnits), color: '#166534' },
            { label: 'Vacant', value: Math.max(0, vacUnits), color: '#B91C1C' },
          ].filter(s => s.value > 0),
          { width: 360 },
        ),
      });
    }

    if (trend.length) {
      charts.push({
        title: 'GPR vs Collected',
        subtitle: 'Monthly rent receivable trend',
        svg: svgGroupedBarChart(
          trend.map(t => t.month),
          [
            { name: 'GPR', values: trend.map(t => t.gpr), color: '#5B5FEF' },
            { name: 'Collected', values: trend.map(t => t.collected), color: '#4A90C2' },
          ],
          { title: 'GPR vs Collected', width: 520, height: 200 },
        ),
      });
      const lost = trend.map(t => Math.max(0, t.gpr - t.collected));
      charts.push({
        title: 'Lost Rent vs Occupancy',
        subtitle: 'Bars = vacancy loss · Line = occupancy %',
        svg: svgComboBarLine(
          trend.map(t => t.month),
          lost,
          trend.map(t => t.occupancy ?? occNum),
          { title: 'Lost Rent vs Occupancy', barLabel: 'Lost Rent', lineLabel: 'Occupancy %', width: 520, height: 200 },
        ),
      });
    }

    if (ar.agingChart.length) {
      charts.push({
        title: 'Arrears Aging by Bucket',
        subtitle: ar.sourceNote,
        svg: svgBarChart(
          ar.agingChart.map(b => b.label),
          ar.agingChart.map(b => b.amount),
          '#0F766E',
          { title: 'Arrears Aging by Bucket', width: 520, height: 200 },
        ),
      });
    }

    if (metrics.length) {
      charts.push({
        title: 'Vacancy Loss by Company',
        svg: svgBarChart(
          metrics.slice(0, 10).map(m => shortName(m.name)),
          metrics.slice(0, 10).map(m => m.vacancyLoss),
          '#B91C1C',
          { title: 'Vacancy Loss by Company', width: 520, height: 200 },
        ),
      });
      charts.push({
        title: 'Avg Rent per Unit by Company',
        svg: svgBarChart(
          metrics.slice(0, 10).map(m => shortName(m.name)),
          metrics.slice(0, 10).map(m => m.avgRent),
          '#5B5FEF',
          { title: 'Avg Rent / Unit', width: 520, height: 200 },
        ),
      });
      charts.push({
        title: 'Occupancy by Company',
        svg: svgBarChart(
          metrics.slice(0, 10).map(m => shortName(m.name)),
          metrics.slice(0, 10).map(m => m.occupancyPct),
          '#0F766E',
          { title: 'Occupancy %', width: 520, height: 200 },
        ),
      });
      charts.push({
        title: 'NOI by Company',
        svg: svgBarChart(
          metrics.slice(0, 10).map(m => shortName(m.name)),
          metrics.slice(0, 10).map(m => m.noi),
          '#166534',
          { title: 'NOI', width: 520, height: 200 },
        ),
      });
    }

    const riskSorted = [...metrics]
      .filter(m => m.arrears > 0 || m.vacancyLoss > 0 || m.occupancyPct < 85)
      .sort((a, b) => (b.arrears + b.vacancyLoss) - (a.arrears + a.vacancyLoss));

    const tables: SectionPdfTable[] = [];
    if (riskSorted.length) {
      tables.push({
        title: 'Top Risk Companies',
        headers: ['Company', 'Arrears', 'Vacancy Loss', 'Occupancy', 'Risk'],
        rows: riskSorted.slice(0, 10).map(m => {
          const risk = m.arrears > 10000 || m.occupancyPct < 70
            ? 'Critical'
            : m.arrears > 2000 || m.occupancyPct < 85
              ? 'Watch'
              : 'Monitor';
          return [
            m.name.slice(0, 28),
            fmtUsd(m.arrears),
            m.vacancyLoss > 0 ? fmtUsd(m.vacancyLoss) : '—',
            pct(m.occupancyPct),
            risk,
          ];
        }),
      });
    }

    const coRows = data.portfolioSnapshot.unitsByCompany.slice(0, 12);
    if (coRows.length) {
      tables.push({
        title: 'Data Summary — Units by Company',
        headers: ['Company', 'Units', 'Share'],
        rows: coRows.map(c => {
          const total = Number(data.portfolioSnapshot.totalUnits) || 1;
          return [c.name, String(c.units), pct((c.units / total) * 100)];
        }),
      });
    }

    const leases = perf.leaseExpirations ?? [];
    if (leases.length) {
      tables.push({
        title: 'Upcoming Lease Expirations (next 90 days)',
        headers: ['Unit', 'Company', 'Tenant', 'Lease End', 'Days Left'],
        rows: leases.map(l => [
          l.unit,
          l.company.slice(0, 22),
          l.tenant.slice(0, 20),
          l.leaseEnd,
          String(l.daysLeft),
        ]),
      });
    }

    const alerts: SectionPdfAlert[] = data.riskActionTable.slice(0, 8).map(r => ({
      severity: r.severity === 'critical' ? 'critical' : 'warning',
      title: r.issue,
      text: `${r.property}: ${r.kpi} · Impact: ${r.impact} · Owner: ${r.owner} · Due ${r.dueDate}`,
    }));

    return {
      ...base,
      sourceNote: rp.sourceNote,
      liveParityNotes: [
        'KPI strip', 'Collection Rate = collected÷billed', 'Occ gauge', 'Occ/Vacant donut',
        'GPR vs Collected', 'AR Aging', 'Vacancy/Avg Rent/Occ/NOI by company',
        'Top Risk', 'Attention Now', 'Lease expirations',
      ],
      kpis,
      charts,
      tables,
      alerts: alerts.length ? alerts : undefined,
    };
  }

  if (tab === 'expenses') {
    // LIVE: 7 KPIs, category bars, by-company, heatmap, YoY, full table.
    const ex = data.expenses;
    const kpis: SectionPdfKpi[] = ex.trend6Mo.length
      ? [
          { label: '6-Mo Avg Expense', value: fmtUsd(ex.trend6Mo.reduce((s, t) => s + t.amount, 0) / ex.trend6Mo.length), sub: `Ending ${ex.trendEndLabel}` },
          { label: 'Latest Month', value: fmtUsd(ex.trend6Mo[ex.trend6Mo.length - 1]?.amount ?? 0), sub: ex.trend6Mo[ex.trend6Mo.length - 1]?.month },
          { label: 'Categories', value: String(ex.breakdown.length), sub: 'P&L line detail' },
          { label: 'Top Category', value: ex.breakdown[0] ? fmtUsd(ex.breakdown[0].value) : '—', sub: ex.breakdown[0]?.name },
        ]
      : [{ label: 'Expenses', value: 'Data not available', sub: 'Upload P&L on Financials' }];

    const charts: SectionPdfChart[] = [];
    if (ex.trend6Mo.length) {
      charts.push({
        title: 'Expense Trend',
        subtitle: `6 months to ${ex.trendEndLabel}`,
        svg: svgLineChart(
          ex.trend6Mo.map(t => t.month),
          [{ name: 'Total Expenses', values: ex.trend6Mo.map(t => t.amount), color: '#5B5FEF' }],
          { title: `Expense Trend — ${ex.trendEndLabel}`, width: 520, height: 200 },
        ),
      });
    }
    const pie = ex.breakdown.slice(0, 6);
    if (pie.length) {
      charts.push({
        title: 'Expense Breakdown',
        subtitle: 'Top categories',
        svg: svgDoughnut(
          pie.map((p, i) => ({ label: p.name, value: p.value, color: CHART_COLORS[i % CHART_COLORS.length] })),
          { width: 360 },
        ),
      });
      charts.push({
        title: 'Expense by Category',
        svg: svgBarChart(
          pie.map(p => p.name.slice(0, 10)),
          pie.map(p => p.value),
          '#5B5FEF',
          { title: 'Top Categories', width: 520, height: 200 },
        ),
      });
    }

    return {
      ...base,
      sourceNote: ex.sourceNote,
      liveParityNotes: ['Expense KPIs', '6-mo trend', 'Category doughnut/bars', 'Category table'],
      kpis,
      charts,
      tables: ex.breakdown.length
        ? [{
            title: 'Expense Categories',
            headers: ['Category', 'Amount'],
            rows: ex.breakdown.slice(0, 12).map(b => [b.name.slice(0, 36), fmtUsd(b.value)]),
          }]
        : undefined,
    };
  }

  if (tab === 'ar-dashboard') {
    // LIVE: collection KPIs + heatmaps + QB aging. PDF: aging + collection KPIs from Overview sources.
    const ar = data.arDashboard;
    const perf = data.rentalPerformance;
    const kpis: SectionPdfKpi[] = [
      { label: 'Rent Collected', value: perf.collected, accent: '#0F766E' },
      { label: 'Collection Rate', value: perf.collectionRate, sub: perf.billed ? `of ${perf.billed} billed (same period)` : 'Collected ÷ GPR/Billed', accent: '#B91C1C' },
      { label: 'Outstanding AR', value: perf.arOutstanding, sub: 'QB A/R Aging TOTAL' },
      { label: 'Est. DSO', value: ar.dso, sub: 'Days to collect' },
      { label: 'Overdue AR (30+)', value: ar.overdue30, accent: '#B91C1C' },
      { label: 'Overdue AR (60+)', value: ar.overdue60 },
      { label: 'Overdue AR (90+)', value: ar.overdue90, accent: '#B91C1C' },
      { label: 'Credit Balance', value: ar.creditBalance, sub: 'Excluded from DSO' },
    ];
    const charts: SectionPdfChart[] = ar.agingChart.length
      ? [{
          title: 'AR Aging by Bucket',
          svg: svgBarChart(
            ar.agingChart.map(b => b.label),
            ar.agingChart.map(b => b.amount),
            '#0F766E',
            { title: 'AR Aging by Bucket', width: 520, height: 200 },
          ),
        }]
      : [];
    const metrics = perf.companyMetrics ?? [];
    if (metrics.some(m => m.arrears > 0)) {
      const top = [...metrics].sort((a, b) => b.arrears - a.arrears).slice(0, 10);
      charts.push({
        title: 'Outstanding AR by Company',
        svg: svgBarChart(
          top.map(m => m.name.split(' ').slice(0, 2).join(' ').slice(0, 12)),
          top.map(m => m.arrears),
          '#B91C1C',
          { title: 'AR by Company', width: 520, height: 200 },
        ),
      });
    }

    return {
      ...base,
      sourceNote: ar.sourceNote,
      liveParityNotes: ['Collection KPIs', 'DSO / overdue buckets', 'AR aging chart', 'AR by company'],
      kpis,
      charts,
    };
  }

  if (tab === 'financials') {
    return buildFinancialsScopePayload(data, strategy, financialsScope);
  }

  if (tab === 'ownership') {
    const ow = data.ownership;
    const kpis: SectionPdfKpi[] = [
      { label: 'Partners', value: ow.totalPartners },
      { label: 'Capital Contributed', value: ow.totalCapital },
      { label: 'Portfolio Value', value: ow.portfolioMarketValue },
      { label: 'Total Equity', value: ow.totalEquity },
      { label: 'Avg ROI', value: ow.avgRoi, accent: '#5B5FEF' },
    ];
    const charts: SectionPdfChart[] = [];
    if (ow.partnerSlices.length) {
      charts.push({
        title: 'Equity by Partner',
        svg: svgDoughnut(
          ow.partnerSlices.slice(0, 8).map((p, i) => ({ label: p.name, value: p.value, color: CHART_COLORS[i % CHART_COLORS.length] })),
          { width: 360 },
        ),
      });
    }
    if (ow.roiByPartner?.length) {
      charts.push({
        title: 'ROI by Partner',
        svg: svgBarChart(
          ow.roiByPartner.slice(0, 8).map(p => p.name.slice(0, 12)),
          ow.roiByPartner.slice(0, 8).map(p => p.roi),
          '#5B5FEF',
          { title: 'ROI %', width: 520, height: 200 },
        ),
      });
    }
    return {
      ...base,
      sourceNote: 'Rentals → Ownership',
      liveParityNotes: ['Partner KPIs', 'Equity doughnut', 'ROI bars', 'Partner equity table'],
      kpis,
      charts,
      tables: ow.partnerSlices.length
        ? [{
            title: 'Partners — Equity Share',
            headers: ['Partner', 'Equity'],
            rows: ow.partnerSlices.slice(0, 12).map(p => [p.name.slice(0, 32), fmtUsd(p.value)]),
          }]
        : undefined,
    };
  }

  if (tab === 'loan-tracker') {
    const lp = data.loanPortfolio;
    const dr = data.debtRisk;
    const rateVariance = lp.rateVariance ?? [];
    const marketRate = 6.5;
    const kpis: SectionPdfKpi[] = [
      { label: 'Total Debt', value: lp.totalDebt, sub: lp.loanBalanceAsOn ? `(${lp.loanBalanceAsOn})` : undefined },
      { label: 'Loan Count', value: lp.loanCount },
      { label: 'Total Monthly EMI', value: lp.monthlyEmi ?? '—' },
      { label: 'Weighted Avg Rate', value: lp.weightedAvgRate ?? '—' },
      { label: 'Next Maturity', value: lp.nextMaturity?.date ?? '—', sub: lp.nextMaturity?.property ?? 'No upcoming maturity' },
      { label: 'Portfolio DSCR', value: lp.portfolioDscr },
      { label: 'Interest Coverage', value: lp.interestCoverage },
      { label: 'Wtd Avg Remaining Term', value: lp.weightedAvgTermMonths != null ? `${Math.round(lp.weightedAvgTermMonths)} mo` : '—' },
      { label: 'Average LTV', value: lp.avgLtv ?? '—' },
    ];
    const charts: SectionPdfChart[] = [];
    if (lp.debtByBuilding?.length) {
      charts.push({
        title: 'Debt by Building',
        subtitle: 'Outstanding balance ranked highest to lowest',
        svg: svgHorizontalBarChart(
          lp.debtByBuilding.slice(0, 8).map((r, i) => ({
            label: r.name,
            value: r.value,
            color: i === 0 ? '#5B5FEF' : i === 1 ? '#F2C94C' : '#E8E9ED',
          })),
          { title: 'Debt by Building', width: 520, height: 240 },
        ),
      });
    }
    if (lp.emiByLender?.length) {
      charts.push({
        title: 'EMI Breakdown by Lender',
        svg: svgBarChart(
          lp.emiByLender.slice(0, 8).map(r => r.name.slice(0, 14)),
          lp.emiByLender.slice(0, 8).map(r => r.value),
          '#5B5FEF',
          { title: 'Monthly EMI', width: 520, height: 220 },
        ),
      });
    }
    if (dr.maturityBuckets.length) {
      charts.push({
        title: 'Maturity Ladder',
        subtitle: 'Debt maturing by bucket',
        svg: svgBarChart(
          dr.maturityBuckets.map(r => r.label),
          dr.maturityBuckets.map(r => r.amount),
          '#F5A623',
          { title: 'Maturity Ladder', width: 520, height: 220 },
        ),
      });
    }
    if (rateVariance.length) {
      charts.push({
        title: `Rate Variance vs Market (${marketRate.toFixed(1)}%)`,
        subtitle: 'Basis points above or below market benchmark',
        svg: svgSignedGroupedBarChart(
          rateVariance.slice(0, 8).map(r => r.name.slice(0, 14)),
          [{ name: 'Rate vs Market', values: rateVariance.slice(0, 8).map(r => r.bps), color: '#B91C1C' }],
          { title: 'Rate Variance (bps)', width: 520, height: 220 },
        ),
      });
    }
    if (dr.dscrByProperty.length) {
      charts.push({
        title: 'DSCR by Property',
        svg: svgBarChart(
          dr.dscrByProperty.slice(0, 10).map(r => r.name.slice(0, 12)),
          dr.dscrByProperty.slice(0, 10).map(r => r.dscr),
          '#0F766E',
          { title: 'DSCR', width: 520, height: 200 },
        ),
      });
    }
    if (dr.ltvByProperty.length) {
      charts.push({
        title: 'LTV by Property',
        svg: svgBarChart(
          dr.ltvByProperty.slice(0, 10).map(r => r.name.slice(0, 12)),
          dr.ltvByProperty.slice(0, 10).map(r => r.ltv),
          '#B91C1C',
          { title: 'LTV %', width: 520, height: 200 },
        ),
      });
    }
    const tables: SectionPdfTable[] = [];
    if (lp.loanRows?.length) {
      tables.push({
        title: `Loan Register — ${data.entityLabel} · ${data.periodLabel}`,
        headers: ['Company', 'Building', 'Lender', 'Loan Amount', 'Rate', 'EMI', 'Outstanding', 'Maturity', 'EMI Day', 'DSCR', 'Status'],
        rows: lp.loanRows.slice(0, 15).map(r => [
          r.company.slice(0, 20),
          r.building.slice(0, 20),
          r.lender.slice(0, 18),
          fmtUsd(r.loanAmount),
          r.rate != null ? `${(r.rate * 100).toFixed(2)}%` : '—',
          r.emi != null ? fmtUsd(r.emi) : '—',
          r.outstanding != null ? fmtUsd(r.outstanding) : '—',
          r.maturity ?? '—',
          r.emiDay != null ? String(r.emiDay) : '—',
          r.dscr != null ? `${r.dscr.toFixed(2)}x` : '—',
          DSCR_STATUS_LABEL[r.status] ?? r.status,
        ]),
      });
    }
    if (lp.emiRows.length) {
      tables.push({
        title: 'Loan EMI Schedule',
        headers: ['Loan', 'Lender', 'EMI', 'Status'],
        rows: lp.emiRows.slice(0, 15).map(r => [
          r.loanName.slice(0, 20),
          r.lender.slice(0, 18),
          r.emiAmount,
          r.paymentStatus,
        ]),
      });
    }
    const alerts: SectionPdfAlert[] = [];
    const highRateCount = rateVariance.filter(r => r.bps > 0).length;
    const estMonthlySavings = rateVariance
      .filter(r => r.bps > 0)
      .reduce((sum, r) => sum + (r.balance * (r.bps / 10000)) / 12, 0);
    if (highRateCount > 0) {
      alerts.push({
        severity: 'warning',
        title: 'Refinancing Opportunity',
        text: `${highRateCount} loan(s) above market rate (${marketRate.toFixed(1)}%). Estimated monthly savings: ${fmtUsd(estMonthlySavings)}.`,
      });
    }
    if ((lp.maturingCount ?? 0) > 0) {
      alerts.push({
        severity: 'critical',
        title: 'Near-Term Maturities',
        text: `${lp.maturingCount} loan(s) maturing within 12 months totaling ${lp.maturingAmount ?? '—'}.`,
      });
    }
    if (lp.topBuilding) {
      alerts.push({
        severity: lp.topBuilding.pct > 50 ? 'critical' : 'info',
        title: 'Building Concentration Risk',
        text: `${lp.topBuilding.name} represents ${pct(lp.topBuilding.pct)} of outstanding debt.`,
      });
    }
    if (lp.topLender) {
      alerts.push({
        severity: lp.topLender.pct > 60 ? 'critical' : 'info',
        title: 'Lender Concentration Risk',
        text: `${lp.topLender.name} represents ${pct(lp.topLender.pct)} of outstanding debt.`,
      });
    }
    return {
      ...base,
      sourceNote: 'Rentals → Loan Tracker',
      liveParityNotes: ['Debt KPIs', 'Rate / maturity / concentration metrics', 'Debt by building', 'EMI by lender', 'Maturity ladder', 'Rate variance', 'DSCR/LTV charts', 'Loan register', 'EMI schedule'],
      kpis,
      charts,
      chartsLayout: 'stack',
      tables,
      alerts: alerts.length ? alerts : undefined,
    };
  }

  if (tab === 'financial-ratios') {
    const bs = data.balanceSheet;
    const isec = data.incomeStatement;
    const kpis: SectionPdfKpi[] = [
      { label: 'Debt / Equity', value: bs.debtToEquity },
      { label: 'Debt / Assets', value: bs.debtToAsset },
      { label: 'LTV', value: bs.ltv },
      { label: 'NOI Margin', value: isec.noiMargin },
      { label: 'Expense Ratio', value: isec.expenseRatio },
      { label: 'Net Income Margin', value: isec.netIncomeMargin },
      { label: 'Bank', value: bs.cashBalance },
      { label: 'Equity', value: bs.equity },
    ];
    const charts: SectionPdfChart[] = [];
    if (isec.monthlyTrend.length) {
      charts.push({
        title: 'Revenue vs Expenses vs NOI',
        svg: svgGroupedBarChart(
          isec.monthlyTrend.map(t => t.month),
          [
            { name: 'Revenue', values: isec.monthlyTrend.map(t => t.revenue), color: '#5B5FEF' },
            { name: 'Expenses', values: isec.monthlyTrend.map(t => t.expenses), color: '#2E4C8A' },
            { name: 'NOI', values: isec.monthlyTrend.map(t => t.noi), color: '#4A90C2' },
          ],
          { title: 'P&L Trend', width: 520, height: 200 },
        ),
      });
    }
    return {
      ...base,
      sourceNote: 'Rentals → Financial Ratios',
      liveParityNotes: ['Solvency KPIs', 'Profitability margins', 'P&L trend chart'],
      kpis,
      charts,
    };
  }

  return {
    ...base,
    sourceNote: 'EstateCFO Rentals',
    kpis: [{ label: 'Section', value: base.sectionTitle }],
    charts: [],
  };
}

export function sectionPdfFileName(payload: SectionPdfPayload): string {
  const entity = payload.entityLabel.replace(/[^\w]+/g, '_').replace(/_+/g, '_');
  const period = payload.periodLabel.replace(/[^\w]+/g, '_').replace(/_+/g, '_');
  return `EstateCFO_${payload.fileSectionName}_${entity}_${period}.pdf`;
}
