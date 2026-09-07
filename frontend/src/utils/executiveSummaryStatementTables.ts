/**
 * Full P&L / BS / CF line-item tables for CEO Board Review PPT — mirrors RentalFinancials FinTable logic.
 */
import type { FinItem, ParsedFinancials } from './rentalKpiEngine';
import {
  anchorPeriodKeys,
  unionYears,
  yearSnapshotLabel,
  type YearSnapshotPeriodAnchor,
} from './cfoMultiYearTrendData';
import { getPeriodFilterKeys, getTrailingMonthKeys, type Period } from './periodWindow';
import { tidyStatementRows } from './finItemYearUtils';

export interface StatementTableRow {
  label: string;
  amount: number;
  indent: number;
  isSectionHeader: boolean;
  isTotal: boolean;
  isNetIncome: boolean;
}

export interface YearlyStatementBlock {
  year: number;
  /** Display header — e.g. "2026 (YTD through Mar)" when period-capped. */
  yearLabel: string;
  rows: StatementTableRow[];
}

function normLabel(label: string): string {
  return label.trim().toLowerCase();
}

function valueForPeriodItem(
  item: FinItem,
  periodKeys: string[],
  sheet: 'pl' | 'bs' | 'cf',
  year: number,
): number {
  if (periodKeys.length > 0) {
    const hasMonthly = periodKeys.some(k => item.monthlyValues?.[k] != null);
    if (hasMonthly) {
      if (sheet === 'bs') {
        const lastKey = periodKeys[periodKeys.length - 1];
        return item.monthlyValues?.[lastKey] ?? 0;
      }
      return periodKeys.reduce((s, k) => s + (item.monthlyValues?.[k] ?? 0), 0);
    }
  }
  return item.values[year] ?? 0;
}

function itemsForSheet(fin: ParsedFinancials, sheet: 'pl' | 'bs' | 'cf'): FinItem[] {
  const raw = sheet === 'pl' ? fin.pl : sheet === 'bs' ? fin.bs : fin.cf;
  return tidyStatementRows(raw, fin.years, sheet);
}

function normMonthKey(k: string): string {
  return k.replace(/-/g, ' ');
}

function valueForYearItem(
  item: FinItem,
  sheet: 'pl' | 'bs' | 'cf',
  year: number,
  yearKeys: string[],
  opts?: { anchoredYear?: boolean },
): number {
  const keys = yearKeys.map(normMonthKey);
  const monthly = item.monthlyValues ?? {};
  const hasAnyMonthlyForYear = Object.keys(monthly).some(k => k.endsWith(` ${year}`));
  const hasInWindow = keys.some(k => monthly[k] != null);

  if (keys.length > 0 && (hasInWindow || (sheet === 'bs' && hasAnyMonthlyForYear))) {
    if (sheet === 'bs') {
      // Walk keys reverse to find last month with a value in the window.
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]!;
        if (monthly[k] != null) return monthly[k] ?? 0;
      }
      return 0;
    }
    return keys.reduce((s, k) => s + (monthly[k] ?? 0), 0);
  }

  // Anchor year with a monthly ledger must not fall back to full-year annual totals.
  if (opts?.anchoredYear && hasAnyMonthlyForYear) return 0;

  return item.values[year] ?? 0;
}

function hasMeaningfulRows(rows: StatementTableRow[]): boolean {
  return rows.some(r => !r.isSectionHeader && r.amount !== 0);
}

/** Consolidated statement for one year — portfolio sums matching labels across all companies. */
export function buildStatementLineItemsForYear(
  fins: ParsedFinancials[],
  year: number,
  sheet: 'pl' | 'bs' | 'cf',
  anchor?: YearSnapshotPeriodAnchor | null,
): StatementTableRow[] {
  const withData = fins.filter(f => f.years.includes(year) && itemsForSheet(f, sheet).length > 0);
  if (!withData.length) return [];

  // Tidy each company independently (Bank Accounts / AR / LeezaSpace / etc.), then union labels.
  const tidiedByFin = withData.map(fin => ({ fin, items: itemsForSheet(fin, sheet) }));
  const templates: FinItem[] = [];
  const seen = new Set<string>();
  for (const { items } of tidiedByFin) {
    for (const item of items) {
      const key = normLabel(item.label);
      if (seen.has(key)) continue;
      seen.add(key);
      templates.push(item);
    }
  }

  const anchoredYear = Boolean(anchor && year === anchor.year);

  return templates.map(template => {
    let amount = 0;
    for (const { fin, items } of tidiedByFin) {
      const match = items.find(i => normLabel(i.label) === normLabel(template.label));
      if (match) {
        amount += valueForYearItem(
          match,
          sheet,
          year,
          anchorPeriodKeys(fin, year, anchor),
          { anchoredYear },
        );
      }
    }
    return {
      label: template.label,
      amount,
      indent: template.indent,
      isSectionHeader: template.isSectionHeader,
      isTotal: template.isTotal,
      isNetIncome: template.isNetIncome,
    };
  });
}

/**
 * All years with data — consolidated P&L / BS / CF for CEO Board Review slides.
 * When `anchor` is set, the anchor year is capped to the selected Month/YTD/YoY window
 * (e.g. YTD through Mar); prior years stay full-year.
 */
export function buildYearlyConsolidatedStatements(
  fins: ParsedFinancials[],
  sheet: 'pl' | 'bs' | 'cf',
  anchor?: YearSnapshotPeriodAnchor | null,
): YearlyStatementBlock[] {
  if (!fins.length) return [];
  return unionYears(fins)
    .map(year => ({
      year,
      yearLabel: yearSnapshotLabel(year, anchor),
      rows: buildStatementLineItemsForYear(fins, year, sheet, anchor),
    }))
    .filter(block => hasMeaningfulRows(block.rows));
}

/** Build statement rows for the selected period — sums matching labels across all companies. */
export function buildStatementLineItems(
  fins: ParsedFinancials[],
  period: Period | null,
  month: number,
  year: number,
  sheet: 'pl' | 'bs' | 'cf',
): { rows: StatementTableRow[]; periodLabel: string } {
  const periodKeys = period
    ? getPeriodFilterKeys(period, month, year)
    : getTrailingMonthKeys(month, year, 1);
  const periodLabel = periodKeys.length === 1
    ? periodKeys[0]
    : periodKeys.length > 1
      ? `${periodKeys[0]} – ${periodKeys[periodKeys.length - 1]}`
      : `FY ${year}`;

  const withData = fins.filter(f => itemsForSheet(f, sheet).length > 0);
  if (!withData.length) return { rows: [], periodLabel };

  const tidiedByFin = withData.map(fin => ({ fin, items: itemsForSheet(fin, sheet) }));
  const templates: FinItem[] = [];
  const seen = new Set<string>();
  for (const { items } of tidiedByFin) {
    for (const item of items) {
      const key = normLabel(item.label);
      if (seen.has(key)) continue;
      seen.add(key);
      templates.push(item);
    }
  }

  const rows: StatementTableRow[] = templates.map(template => {
    let amount = 0;
    for (const { items } of tidiedByFin) {
      const match = items.find(i => normLabel(i.label) === normLabel(template.label));
      if (match) {
        amount += valueForPeriodItem(match, periodKeys, sheet, year);
      }
    }
    return {
      label: template.label,
      amount,
      indent: template.indent,
      isSectionHeader: template.isSectionHeader,
      isTotal: template.isTotal,
      isNetIncome: template.isNetIncome,
    };
  });

  return { rows, periodLabel };
}

export function formatStatementAmount(val: number): string {
  if (val === 0) return '$0';
  const abs = Math.abs(val);
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(abs);
  return val < 0 ? `(${formatted})` : formatted;
}

function indentPrefix(indent: number): string {
  if (indent > 4) return '      ';
  if (indent > 1) return '    ';
  return '';
}

/** PPT table rows: [line item label, amount] */
export function statementRowsToPptTable(rows: StatementTableRow[]): string[][] {
  return rows.map(r => [
    `${indentPrefix(r.indent)}${r.label}`,
    formatStatementAmount(r.amount),
  ]);
}

export const STATEMENT_ROWS_PER_SLIDE = 22;

export function paginateStatementRows(rows: StatementTableRow[]): StatementTableRow[][] {
  if (!rows.length) return [];
  const pages: StatementTableRow[][] = [];
  for (let i = 0; i < rows.length; i += STATEMENT_ROWS_PER_SLIDE) {
    pages.push(rows.slice(i, i + STATEMENT_ROWS_PER_SLIDE));
  }
  return pages;
}
