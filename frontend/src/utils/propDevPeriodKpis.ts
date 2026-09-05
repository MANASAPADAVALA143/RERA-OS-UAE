import { getPeriodFilterKeys, type Period } from './periodWindow';
import { getPropDevAvailableKeys, type PDFinancialsLike, type PDFinItemLike } from './propDevCfoTrendData';
import { getPropDevRevenueForYear, type PropDevRevenueYearBreakdown } from './propDevRevenueBreakdown';
import { yearSnapshotLabel, type YearSnapshotPeriodAnchor } from './cfoMultiYearTrendData';
import { KPI_MIN_DENOMINATOR, safeRatioPct } from './rentalExpenseUtils';
import { labelMatches } from './propDevStatementLabels';
import { yearVal } from './finItemYearUtils';

const ACTIVITY_EPS = 0.005;

export interface PropDevKpiRow {
  rev: number;
  operatingRev: number;
  otherRev: number;
  exp: number;
  netInc: number;
  noi: number;
  interest: number;
  cash: number;
  /** Null when revenue is below KPI_MIN_DENOMINATOR (ratio undefined). */
  margin: number | null;
}

export interface PropDevYearSnapshot extends PropDevKpiRow {
  year: number;
  yearLabel: string;
  expenseRatio: number | null;
  revenueCategories: Record<string, number>;
  /** Traceability for Revenue column — which P&L lines produced rev. */
  revenueContributingLines: Array<{ label: string; amount: number; bucket: 'operating' | 'other' }>;
}

function pdYV(items: PDFinItemLike[], pat: RegExp, year: number): number {
  return yearVal(items.find(i => labelMatches(i.label, pat))?.values, year);
}

function pdSumI(items: PDFinItemLike[], pat: RegExp, year: number): number {
  return items
    .filter(i => !i.isSectionHeader && !i.isTotal && labelMatches(i.label, pat))
    .reduce((s, i) => s + yearVal(i.values, year), 0);
}

function sumMonthly(items: PDFinItemLike[], pat: RegExp, keys: string[]): number {
  return items
    .filter(i => !i.isSectionHeader && !i.isTotal && labelMatches(i.label, pat))
    .reduce((total, i) => {
      if (!i.monthlyValues) return total;
      return total + keys.reduce((s, k) => s + (i.monthlyValues![k] ?? 0), 0);
    }, 0);
}

/** Sum one matched row across months — includes Total / Net Income rows (isTotal). */
function monthlyRowTotal(items: PDFinItemLike[], pat: RegExp, keys: string[]): number {
  const item = items.find(i => !i.isSectionHeader && labelMatches(i.label, pat));
  if (!item?.monthlyValues) return 0;
  return keys.reduce((s, k) => s + (item.monthlyValues![k] ?? 0), 0);
}

function yvMonthly(items: PDFinItemLike[], pat: RegExp, key: string): number {
  const item = items.find(i => labelMatches(i.label, pat));
  return Math.abs(item?.monthlyValues?.[key] ?? 0);
}

/** Interest expense lines only — excludes Interest Income / capitalised interest. */
function isInterestExpenseLabel(label: string): boolean {
  if (!/interest/i.test(label)) return false;
  if (/income|earned|receiv|capitali[sz]ed/i.test(label)) return false;
  return true;
}

function readInterestExpense(
  items: PDFinItemLike[],
  year: number,
  periodKeys?: string[],
): number {
  // Exclude totals: otherwise we double-count (e.g. "Interest Expense" total
  // plus the underlying "Interest on Bank Loan" detail).
  const rows = items.filter(i => !i.isSectionHeader && !i.isTotal && isInterestExpenseLabel(i.label));
  if (periodKeys?.length) {
    const fromMonths = rows.reduce((total, i) => {
      if (!i.monthlyValues) return total;
      return total + periodKeys.reduce((s, k) => s + (i.monthlyValues![k] ?? 0), 0);
    }, 0);
    if (fromMonths !== 0) return fromMonths;
  }
  return rows.reduce((s, i) => s + yearVal(i.values, year), 0);
}

export function periodKeysForPropDevYear(
  fin: PDFinancialsLike,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): string[] | undefined {
  if (!anchor || year !== anchor.year || !anchor.period) return undefined;
  const available = getPropDevAvailableKeys(fin);
  const normalize = (k: string) => k.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const availableNorm = new Map(available.map(k => [normalize(k), k]));
  const wanted = getPeriodFilterKeys(anchor.period, anchor.month, anchor.year);
  const keys = wanted
    .map(k => availableNorm.get(normalize(k)))
    .filter((k): k is string => Boolean(k));
  if (keys.length) return keys;

  // No exact Jan…selected-month columns — use any uploaded months in that year
  // on or before the selected month (never later months like June when Mar is selected).
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const endSort = anchor.year * 100 + anchor.month;
  const fallback = available.filter(k => {
    const parts = normalize(k).split(' ');
    const mi = months.indexOf(parts[0] ?? '') + 1;
    const yi = parseInt(parts[1] ?? '', 10);
    if (!mi || !Number.isFinite(yi) || yi !== anchor.year) return false;
    return yi * 100 + mi <= endSort;
  });
  return fallback.length ? fallback : undefined;
}

export function pdKpisForScope(
  fin: PDFinancialsLike,
  year: number,
  periodKeys?: string[],
  revBd?: PropDevRevenueYearBreakdown,
): PropDevKpiRow {
  const p = fin.pl;
  const b = fin.bs;
  const revenue = revBd ?? getPropDevRevenueForYear(fin, year, periodKeys);
  const rev = revenue.totalRev;
  const operatingRev = revenue.operatingTotal;

  // Prefer Total for Expenses / COGS total rows. Development uploads often put spend under
  // "Total for Cost of Goods Sold" with no "Total for Expenses" — that used to leave Expenses=$0
  // while Revenue and Net Income were populated (Montechino-style inconsistency).
  const readExpenseTotal = (keys?: string[]) => {
    if (keys?.length) {
      const operating = Math.abs(
        monthlyRowTotal(p, /^total\s+for\s+(operating\s+)?expenses?$/i, keys)
        || monthlyRowTotal(p, /^total\s+(operating\s+)?expenses?$/i, keys)
        || monthlyRowTotal(p, /^total\s+for\s+(cost\s+of\s+(goods|sales)|cogs)/i, keys)
        || monthlyRowTotal(p, /^total\s+(cost\s+of\s+(goods|sales)|cogs)/i, keys)
        || monthlyRowTotal(p, /^total\s+costs?$/i, keys),
      );
      const other = Math.abs(
        monthlyRowTotal(p, /^total\s+for\s+other\s+expenses?$/i, keys)
        || monthlyRowTotal(p, /^total\s+other\s+expenses?$/i, keys),
      );
      return operating + other;
    }
    const operating = Math.abs(
      pdYV(p, /^total\s+for\s+(operating\s+)?expenses?$/i, year)
      || pdYV(p, /^total\s+(operating\s+)?expenses?$/i, year)
      || pdYV(p, /^total\s+for\s+(cost\s+of\s+(goods|sales)|cogs)/i, year)
      || pdYV(p, /^total\s+(cost\s+of\s+(goods|sales)|cogs)/i, year)
      || pdYV(p, /^total\s+costs?$/i, year),
    );
    const other = Math.abs(
      pdYV(p, /^total\s+for\s+other\s+expenses?$/i, year)
      || pdYV(p, /^total\s+other\s+expenses?$/i, year),
    );
    return operating + other;
  };
  let exp = readExpenseTotal(periodKeys);
  if (periodKeys?.length && exp === 0) {
    // Monthly Total cells often blank — use the same annual ledger amount YoY Detail shows.
    exp = readExpenseTotal(undefined);
  }
  if (exp === 0 && periodKeys?.length) {
    // Last resort: operating / COGS detail months (exclude income lines).
    exp = Math.abs(sumMonthly(
      p,
      /expense|cogs|cost of|fee|tax|charge|insurance|legal|accounting|survey|escrow|membership|consult|interest/i,
      periodKeys,
    ));
  }
  if (exp === 0) {
    // Annual detail sum when no Total row exists (Particulars / thin QBO exports).
    exp = Math.abs(
      p.filter(i =>
        !i.isSectionHeader
        && !i.isTotal
        && !i.isNetIncome
        && !/income|revenue|gross\s+profit|net\s+income|net\s+profit/i.test(i.label)
        && /expense|cogs|cost of|fee|tax|charge|insurance|legal|accounting|interest|depreciation|amort/i.test(i.label),
      ).reduce((s, i) => s + Math.abs(yearVal(i.values, year)), 0),
    );
  }

  // Bottom-line Net Income from P&L — never "Net Operating Income".
  // Also matches Particulars formats: "Net Profit/(Loss)", "Profit for the year".
  let netInc = periodKeys?.length
    ? (
      monthlyRowTotal(p, /^net\s+income$/i, periodKeys)
      || monthlyRowTotal(p, /^net\s+profit/i, periodKeys)
      || monthlyRowTotal(p, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i, periodKeys)
    )
    : (
      pdYV(p, /^net\s+income$/i, year)
      || pdYV(p, /^net\s+profit/i, year)
      || pdYV(p, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i, year)
    );
  if (!periodKeys?.length) {
    const candidates = p.filter(i =>
      i.isNetIncome
      || labelMatches(i.label, /^net\s+income$/i)
      || labelMatches(i.label, /^net\s+profit/i)
      || labelMatches(i.label, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i),
    );
    const niItem =
      candidates.find(i => labelMatches(i.label, /^net\s+income$/i) && !/operating/i.test(i.label))
      ?? candidates.find(i => labelMatches(i.label, /^net\s+profit/i) && !/operating/i.test(i.label))
      ?? candidates[candidates.length - 1];
    if (niItem) netInc = yearVal(niItem.values, year);
  }
  // Period mode: prefer annual Net Income ledger when monthly NI cells are blank —
  // never invent a loss via rev − inflated expenses when a Net Income row exists.
  if (periodKeys?.length && netInc === 0) {
    const candidates = p.filter(i =>
      i.isNetIncome
      || labelMatches(i.label, /^net\s+income$/i)
      || labelMatches(i.label, /^net\s+profit/i)
      || labelMatches(i.label, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i),
    );
    const niItem =
      candidates.find(i => labelMatches(i.label, /^net\s+income$/i) && !/operating/i.test(i.label))
      ?? candidates.find(i => labelMatches(i.label, /^net\s+profit/i) && !/operating/i.test(i.label))
      ?? candidates[candidates.length - 1];
    if (niItem) netInc = yearVal(niItem.values, year);
    else {
      netInc = pdYV(p, /^net\s+income$/i, year)
        || pdYV(p, /^net\s+profit/i, year)
        || pdYV(p, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i, year);
    }
  }
  if (periodKeys?.length && netInc === 0 && (rev !== 0 || exp !== 0)) {
    netInc = rev - exp;
  }
  // Annual ledger path (PDF / scoped snapshots): still derive NI when the row is missing.
  if (!periodKeys?.length && netInc === 0 && (Math.abs(rev) > ACTIVITY_EPS || Math.abs(exp) > ACTIVITY_EPS)) {
    netInc = rev - exp;
  }
  // Force Expenses to reconcile with Net Income when Other Expenses / COGS were missed
  // (Montechino: Rev $14.36M − Exp $13.84M ≠ NI ($711K)).
  if (Math.abs(rev) > ACTIVITY_EPS) {
    const impliedExp = rev - netInc;
    if (Math.abs(impliedExp - exp) > Math.max(1_000, Math.abs(rev) * 0.01)) {
      exp = Math.abs(impliedExp);
    }
  }

  // Interest expense only — never Interest Income, never EMI×6 property seed.
  const interest = Math.abs(readInterestExpense(p, year, periodKeys));

  // Prefer the P&L "Net Operating Income" row (same as Financials KPI cards).
  // NOI line label varies across uploads (QuickBooks vs Particulars) e.g.
  // "Net Operating Income", "Net Operating Income (NOI)".
  // If we fail to match, we fall back to derived NOI and can re-inflate the chart.
  const noiItem = p.find(
    i =>
      labelMatches(i.label, /net\s+operating\s+income/i)
      || labelMatches(i.label, /\bnoi\b/i),
  );
  let noiRow: number | null = null;
  if (noiItem) {
    if (periodKeys?.length) {
      if (noiItem.monthlyValues) {
        const monthSum = periodKeys.reduce((s, k) => s + (noiItem.monthlyValues![k] ?? 0), 0);
        // Blank monthly NOI → annual ledger (same rule as Net Income / Expenses).
        noiRow = monthSum !== 0 || !Object.prototype.hasOwnProperty.call(noiItem.values, year)
          ? monthSum
          : (noiItem.values[year] ?? 0);
      }
    } else if (Object.prototype.hasOwnProperty.call(noiItem.values, year)) {
      noiRow = noiItem.values[year] ?? 0;
    }
  }
  // Do NOT add interest back — that inflated the NOI chart (~$59k) when Interest was
  // wrong (EMI×6) or expenses already excluded interest.
  const derivedNoi = (operatingRev !== 0 || exp !== 0) ? operatingRev - exp : 0;
  const noi = noiRow != null ? noiRow : derivedNoi;

  let cash = 0;
  if (periodKeys?.length) {
    const endKey = periodKeys[periodKeys.length - 1];
    cash = yvMonthly(b, /^total\s+for\s+bank/i, endKey)
      || yvMonthly(b, /^bank\s+accounts?$/i, endKey)
      || yvMonthly(b, /cash\s+and\s+bank|bank\s+balances?/i, endKey)
      || yvMonthly(b, /^cash$/i, endKey);
    if (Math.abs(cash) <= ACTIVITY_EPS) {
      cash = Math.abs(sumMonthly(
        b.filter(i => !/loan|mortgage|payable|receivable|interest|od\b|overdraft/i.test(i.label)),
        /cash\s+and\s+bank|bank\s+balances?|^bank\b|checking/i,
        [endKey],
      ));
    }
    if (Math.abs(cash) <= ACTIVITY_EPS) {
      cash = pdYV(b, /^total\s+for\s+bank/i, year)
        || pdYV(b, /^bank\s+accounts?$/i, year)
        || pdYV(b, /cash\s+and\s+bank/i, year)
        || pdYV(b, /bank\s+balances?/i, year)
        || pdYV(b, /^cash$/i, year);
    }
  } else {
    cash = pdYV(b, /^total\s+for\s+bank/i, year)
      || pdYV(b, /^bank\s+accounts?$/i, year)
      || pdYV(b, /cash\s+and\s+bank/i, year)
      || pdYV(b, /bank\s+balances?/i, year)
      || pdYV(b, /^cash$/i, year);
  }

  const margin = safeRatioPct(netInc, rev, KPI_MIN_DENOMINATOR);

  return { rev, operatingRev, otherRev: revenue.otherIncome, exp, netInc, noi, interest, cash, margin };
}

/** True when any non-header line has a non-zero amount for `year` (annual or monthly). */
export function propDevItemHasYearActivity(item: PDFinItemLike, year: number): boolean {
  if (item.isSectionHeader) return false;
  if (Math.abs(item.values[year] ?? 0) > ACTIVITY_EPS) return true;
  if (!item.monthlyValues) return false;
  const suffix = ` ${year}`;
  return Object.entries(item.monthlyValues).some(
    ([k, v]) => k.endsWith(suffix) && Math.abs(v) > ACTIVITY_EPS,
  );
}

export function propDevStatementHasYearActivity(
  items: PDFinItemLike[] | undefined,
  year: number,
): boolean {
  return (items ?? []).some(i => propDevItemHasYearActivity(i, year));
}

/** Years with any P&L / BS / CF activity — drops empty stubs (e.g. 2010–2020 ghosts). */
export function propDevActiveYears(fin: PDFinancialsLike): number[] {
  return fin.years.filter(y =>
    propDevStatementHasYearActivity(fin.pl, y)
    || propDevStatementHasYearActivity(fin.bs, y)
    || propDevStatementHasYearActivity(fin.cf, y),
  );
}

/**
 * Keep years from the first active through the last active (preserves mid-span empty
 * years like a zero P&L between two real years). Drops leading/trailing empty stubs.
 */
export function propDevYearsSpanningActivity(
  years: number[],
  hasActivity: (year: number) => boolean,
): number[] {
  let first = -1;
  let last = -1;
  for (let i = 0; i < years.length; i++) {
    if (!hasActivity(years[i])) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return [];
  return years.slice(first, last + 1);
}

/** Drop empty leading/trailing years from uploaded/API financials. */
export function pruneInactivePropDevYears<T extends PDFinancialsLike>(fin: T): T {
  const kept = propDevYearsSpanningActivity(fin.years, y =>
    propDevStatementHasYearActivity(fin.pl, y)
    || propDevStatementHasYearActivity(fin.bs, y)
    || propDevStatementHasYearActivity(fin.cf, y),
  );
  if (kept.length === fin.years.length) return fin;
  return { ...fin, years: kept };
}

/** Per-year rows for CFO P&L — anchor year uses Month/YTD/TTM window when period is active. */
export type PropDevSnapshotOpts = {
  /**
   * When true, read `values[year]` only (no monthly re-sum).
   * Use after `scopePropDevFinToPeriod` so Multi-Year Snapshot / Command Center
   * match YoY Detail for the in-progress (anchor) year.
   */
  annualLedger?: boolean;
};

export function buildPropDevYearSnapshots(
  fin: PDFinancialsLike,
  anchor?: YearSnapshotPeriodAnchor | null,
  opts?: PropDevSnapshotOpts,
): PropDevYearSnapshot[] {
  // P&L snapshot: span first→last year with P&L activity so empty pre-data years
  // (e.g. 2010–2020 after that input was removed) do not appear as dash rows.
  const years = propDevYearsSpanningActivity(fin.years, y =>
    propDevStatementHasYearActivity(fin.pl, y),
  );
  return years.map(year => {
    const periodKeys = opts?.annualLedger
      ? undefined
      : periodKeysForPropDevYear(fin, year, anchor);
    const revBd = getPropDevRevenueForYear(fin, year, periodKeys);
    const kk = pdKpisForScope(fin, year, periodKeys, revBd);
    return {
      year,
      yearLabel: yearSnapshotLabel(year, anchor),
      ...kk,
      expenseRatio: safeRatioPct(kk.exp, kk.rev, KPI_MIN_DENOMINATOR),
      revenueCategories: revBd.categories,
      revenueContributingLines: revBd.contributingLines,
    };
  });
}

export function propDevPeriodAnchor(
  period: Period | null,
  month: number,
  year: number,
): YearSnapshotPeriodAnchor | null {
  return period ? { month, year, period } : null;
}

/**
 * Focus year for hero KPIs / PDF cards — match the on-screen pie & Command Center:
 * period-anchor year first, else selected year, else the last year with activity.
 */
export function resolvePropDevFocusYear(
  availableYears: number[],
  anchorYear?: number | null,
  selectedYear?: number | null,
): number | null {
  if (!availableYears.length) return anchorYear ?? selectedYear ?? null;
  if (anchorYear != null && availableYears.includes(anchorYear)) return anchorYear;
  if (selectedYear != null && availableYears.includes(selectedYear)) return selectedYear;
  return availableYears[availableYears.length - 1] ?? null;
}

export function pickFocusSnapshot<T extends { year: number }>(
  snapshots: T[],
  focusYear: number | null | undefined,
): T | null {
  if (!snapshots.length) return null;
  if (focusYear != null) {
    const hit = snapshots.find(s => s.year === focusYear);
    if (hit) return hit;
  }
  return snapshots[snapshots.length - 1] ?? null;
}
