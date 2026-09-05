import type { PDFinItemLike, PDFinancialsLike } from './propDevCfoTrendData';

export interface PropDevRevenueYearBreakdown {
  year: number;
  /** Operating income (Income section, above NOI). */
  operatingTotal: number;
  /** Non-operating income (Other Income section after NOI). */
  otherIncome: number;
  /** operatingTotal + otherIncome — matches snapshot Revenue column. */
  totalRev: number;
  /** Dynamic category → amount for chart segments. */
  categories: Record<string, number>;
  /** Traceability: which P&L lines contributed (for debug / UI tooltips). */
  contributingLines: Array<{ label: string; amount: number; bucket: 'operating' | 'other' }>;
}

const INCOME_HDR = /^income$/i;
const OTHER_INCOME_HDR = /^other\s+income$/i;
const EXPENSES_HDR = /^expenses?$/i;
const OTHER_EXPENSE_HDR = /^other\s+expense/i;
const COGS_HDR = /^cost\s+of\s+(goods|sales|services)/i;
const GROSS_PROFIT_RE = /^gross\s+profit$/i;
const NOI_RE = /^net\s+operating\s+income/i;
const NET_INCOME_RE = /^net\s+income$/i;
const TOTAL_FOR_INCOME_RE = /^total\s+for\s+income$/i;
const TOTAL_INCOME_RE = /^total\s+income$/i;
const TOTAL_FOR_OTHER_INCOME_RE = /^total\s+for\s+other\s+income$/i;
const TOTAL_OTHER_INCOME_RE = /^total\s+other\s+income$/i;
const NET_OTHER_INCOME_RE = /^net\s+other\s+income$/i;
const TOTAL_REVENUE_RE = /^total\s+(for\s+)?revenue$/i;

type Phase =
  | 'pre'
  | 'income'
  | 'cogs'
  | 'expenses'
  | 'post_noi'
  | 'other_income_section'
  | 'other_expense'
  | 'done';

function absAmt(n: number | undefined): number {
  return Math.abs(n ?? 0);
}

function isNoiRow(item: PDFinItemLike): boolean {
  return NOI_RE.test(item.label) || (Boolean(item.isNetIncome) && NOI_RE.test(item.label));
}

/** Rows that must never roll into operating revenue (QBO structural / subtotals). */
function isStructuralNonRevenue(ll: string): boolean {
  return (
    GROSS_PROFIT_RE.test(ll)
    || COGS_HDR.test(ll)
    || /^cost\s+of\s+/i.test(ll)
    || /^total\s+for\s+cost\s+of/i.test(ll)
  );
}

function isSkipInIncomeSection(item: PDFinItemLike, ll: string): boolean {
  if (item.isSectionHeader) return true;
  if (item.isTotal) return true;
  if (item.isNetIncome) return true;
  if (NET_INCOME_RE.test(ll)) return true;
  if (TOTAL_FOR_INCOME_RE.test(ll)) return true;
  if (TOTAL_INCOME_RE.test(ll)) return true;
  if (TOTAL_REVENUE_RE.test(ll)) return true;
  if (INCOME_HDR.test(ll)) return true;
  if (EXPENSES_HDR.test(ll)) return true;
  if (OTHER_EXPENSE_HDR.test(ll)) return true;
  if (isStructuralNonRevenue(ll)) return true;
  return false;
}

function isSkipInOtherIncomeSection(item: PDFinItemLike, ll: string): boolean {
  if (item.isSectionHeader) return true;
  if (item.isTotal) return true;
  if (TOTAL_FOR_OTHER_INCOME_RE.test(ll) || TOTAL_OTHER_INCOME_RE.test(ll)) return true;
  if (NET_OTHER_INCOME_RE.test(ll)) return true;
  if (item.isNetIncome) return true;
  if (NET_INCOME_RE.test(ll)) return true;
  if (EXPENSES_HDR.test(ll)) return true;
  if (OTHER_EXPENSE_HDR.test(ll)) return true;
  if (isStructuralNonRevenue(ll)) return true;
  return false;
}

/**
 * Parse Property Dev P&L into revenue sub-categories for a single year.
 * - Income section (above expenses / NOI): named line items (NOT Total for Income /
 *   Gross Profit / COGS — those are structural and may be $0 while Other Income exists).
 * - Other Income section (after NOI, before Net Income / Other Expense): rolled into
 *   "Other Income". This is intentionally separate from Total for Income / Gross Profit.
 * When periodKeys is set, sums monthlyValues across that window (Month/YTD/TTM).
 */
export function getPropDevRevenueForYear(
  fin: PDFinancialsLike,
  year: number,
  periodKeys?: string[],
): PropDevRevenueYearBreakdown {
  const itemAmt = (item: PDFinItemLike): number => {
    if (periodKeys?.length && item.monthlyValues) {
      const hasKeys = periodKeys.some(k => Object.prototype.hasOwnProperty.call(item.monthlyValues!, k));
      if (hasKeys) {
        const monthly = absAmt(periodKeys.reduce((s, k) => s + (item.monthlyValues![k] ?? 0), 0));
        if (monthly > 0) return monthly;
        // Monthly cells present but blank — fall back to annual ledger (same as YoY Detail).
        const annual = absAmt(item.values[year] ?? item.values[String(year) as unknown as number]);
        if (annual > 0) return annual;
        return 0;
      }
    }
    return absAmt(item.values[year] ?? item.values[String(year) as unknown as number]);
  };

  const operatingLines: Record<string, number> = {};
  const contributingLines: PropDevRevenueYearBreakdown['contributingLines'] = [];
  let operatingFromLines = 0;
  let otherFromLines = 0;
  let totalForIncome = 0;
  let totalForOtherIncome = 0;

  let phase: Phase = 'pre';

  for (const item of fin.pl) {
    const label = item.label.trim();
    const ll = label.toLowerCase();

    if (NET_INCOME_RE.test(ll)) {
      phase = 'done';
      break;
    }

    if (isNoiRow(item)) {
      phase = 'post_noi';
      continue;
    }

    if (OTHER_EXPENSE_HDR.test(ll)) {
      phase = 'other_expense';
      continue;
    }

    if (EXPENSES_HDR.test(ll)) {
      phase = 'expenses';
      continue;
    }

    if (COGS_HDR.test(ll)) {
      phase = 'cogs';
      continue;
    }

    if (GROSS_PROFIT_RE.test(ll)) {
      // Structural QBO subtotal — never count as revenue.
      continue;
    }

    if (TOTAL_FOR_INCOME_RE.test(ll) || (TOTAL_INCOME_RE.test(ll) && !TOTAL_FOR_OTHER_INCOME_RE.test(ll))) {
      totalForIncome = itemAmt(item);
      continue;
    }

    if (TOTAL_FOR_OTHER_INCOME_RE.test(ll) || TOTAL_OTHER_INCOME_RE.test(ll)) {
      totalForOtherIncome = itemAmt(item);
      continue;
    }

    if (INCOME_HDR.test(ll) && !OTHER_INCOME_HDR.test(ll)) {
      phase = 'income';
      continue;
    }

    if (phase === 'other_expense' || phase === 'cogs' || phase === 'expenses') {
      continue;
    }

    if (phase === 'post_noi' && OTHER_INCOME_HDR.test(ll)) {
      phase = 'other_income_section';
      // Header-only row: do not treat the section title itself as a cash line
      // unless QBO put a single amount on the "Other Income" label (rare).
      if (!item.isSectionHeader && !item.isTotal) {
        const amt = itemAmt(item);
        if (amt > 0) {
          otherFromLines += amt;
          contributingLines.push({ label, amount: amt, bucket: 'other' });
        }
      }
      continue;
    }

    if (phase === 'other_income_section') {
      if (TOTAL_FOR_OTHER_INCOME_RE.test(ll) || TOTAL_OTHER_INCOME_RE.test(ll)) {
        totalForOtherIncome = itemAmt(item);
        continue;
      }
      if (isSkipInOtherIncomeSection(item, ll)) continue;
      const amt = itemAmt(item);
      if (amt > 0) {
        otherFromLines += amt;
        contributingLines.push({ label, amount: amt, bucket: 'other' });
      }
      continue;
    }

    if (phase === 'post_noi') {
      // Between NOI and Other Income / Net Income: QBO often places Other Income
      // children without a clear section header. Count only non-structural amounts.
      if (isSkipInOtherIncomeSection(item, ll)) continue;
      const amt = itemAmt(item);
      if (amt > 0) {
        otherFromLines += amt;
        contributingLines.push({ label, amount: amt, bucket: 'other' });
      }
      continue;
    }

    if (phase === 'income') {
      if (isSkipInIncomeSection(item, ll)) continue;
      const amt = itemAmt(item);
      if (amt > 0) {
        operatingLines[label] = (operatingLines[label] ?? 0) + amt;
        operatingFromLines += amt;
        contributingLines.push({ label, amount: amt, bucket: 'operating' });
      }
      continue;
    }

    if (phase === 'pre') {
      if (isSkipInIncomeSection(item, ll)) continue;
      const amt = itemAmt(item);
      if (amt > 0) {
        operatingLines[label] = (operatingLines[label] ?? 0) + amt;
        operatingFromLines += amt;
        contributingLines.push({ label, amount: amt, bucket: 'operating' });
        phase = 'income';
      }
    }
  }

  // Prefer summed named lines when present; fall back to QBO section totals.
  // Note: Total for Income / Gross Profit may be $0 while Other Income is non-zero —
  // that is architecturally correct (Other Income sits below NOI).
  const operatingTotal = operatingFromLines > 0 ? operatingFromLines : totalForIncome;
  const otherIncome = totalForOtherIncome > 0 ? totalForOtherIncome : otherFromLines;

  const categories: Record<string, number> = {};

  if (operatingFromLines > 0) {
    for (const [name, amt] of Object.entries(operatingLines)) {
      if (amt > 0) categories[name] = amt;
    }
  } else if (operatingTotal > 0) {
    categories.Revenue = operatingTotal;
  }

  if (otherIncome > 0) {
    categories['Other Income'] = otherIncome;
  }

  let totalRev = Object.values(categories).reduce((s, v) => s + v, 0);
  const expectedTotal = operatingTotal + otherIncome;

  // Reconcile parsed segments with section totals (±$1 rounding).
  if (expectedTotal > 0 && Math.abs(totalRev - expectedTotal) > 1) {
    if (Object.keys(categories).length <= 1) {
      categories.Revenue = expectedTotal;
      delete categories['Other Income'];
      if (otherIncome > 0 && operatingTotal > 0) {
        if (operatingFromLines > 0) {
          for (const [name, amt] of Object.entries(operatingLines)) {
            if (amt > 0) categories[name] = amt;
          }
        } else if (operatingTotal > 0) {
          categories.Revenue = operatingTotal;
        }
        categories['Other Income'] = otherIncome;
      }
    }
    totalRev = Object.values(categories).reduce((s, v) => s + v, 0);
    if (Math.abs(totalRev - expectedTotal) > 1) {
      totalRev = expectedTotal;
    }
  }

  if (totalRev === 0 && expectedTotal > 0) {
    totalRev = expectedTotal;
  }

  // Chart segments must sum to totalRev — header-only or reconciled totals can leave categories empty.
  const catSum = Object.values(categories).reduce((s, v) => s + v, 0);
  if (totalRev > 0 && catSum < totalRev - 0.01) {
    categories.Revenue = (categories.Revenue ?? 0) + (totalRev - catSum);
  }
  if (totalRev > 0 && Object.keys(categories).length === 0) {
    categories.Revenue = totalRev;
  }

  // If we fell back to section totals with no line detail, expose them for traceability.
  if (contributingLines.length === 0) {
    if (operatingTotal > 0) {
      contributingLines.push({ label: 'Total for Income (section total)', amount: operatingTotal, bucket: 'operating' });
    }
    if (otherIncome > 0) {
      contributingLines.push({ label: 'Other Income (section total)', amount: otherIncome, bucket: 'other' });
    }
  }

  return { year, operatingTotal, otherIncome, totalRev, categories, contributingLines };
}

export interface PropDevRevenueChartSeries {
  categoryNames: string[];
  rows: Array<Record<string, number | string>>;
  /** True when multiple segments or a single named operating line (not generic "Revenue"). */
  useStacked: boolean;
}

export function buildPropDevRevenueChartSeries(fin: PDFinancialsLike): PropDevRevenueChartSeries {
  const yearBreakdowns = fin.years.map(y => getPropDevRevenueForYear(fin, y));

  const categorySet = new Set<string>();
  for (const yd of yearBreakdowns) {
    for (const name of Object.keys(yd.categories)) categorySet.add(name);
  }

  let categoryNames = [...categorySet];
  if (categoryNames.length === 0) categoryNames = ['Revenue'];

  const useStacked = categoryNames.length > 1
    || (categoryNames.length === 1 && categoryNames[0] !== 'Revenue');

  const rows = fin.years.map((y, i) => {
    const yd = yearBreakdowns[i];
    const row: Record<string, number | string> = {
      year: String(y),
      yearNum: y,
      rev: yd.totalRev,
    };
    for (const cat of categoryNames) {
      row[cat] = yd.categories[cat] ?? 0;
    }
    return row;
  });

  return { categoryNames, rows, useStacked };
}
