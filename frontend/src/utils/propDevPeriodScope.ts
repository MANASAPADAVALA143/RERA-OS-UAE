/**
 * Align Prop Dev statement line items to the CFO period window (Month / YTD)
 * so YoY Detail tables use the same amounts as Multi-Year Snapshot KPIs.
 */
import type { YearSnapshotPeriodAnchor } from './cfoMultiYearTrendData';
import type { PDFinancialsLike, PDFinItemLike } from './propDevCfoTrendData';
import { periodKeysForPropDevYear } from './propDevPeriodKpis';
import { yearVal } from './finItemYearUtils';

export type PropDevStatementFlowMode = 'flow' | 'stock';

/** Key B/S totals — never overwrite annual with incomplete monthly stubs. */
function isProtectedStockTotalLabel(label: string): boolean {
  return /^total\s+(for\s+)?(assets|liabilities|land|fixed\s+assets?|bank|other\s+assets?)$/i.test(label.trim())
    || /^total\s+(assets|liabilities)$/i.test(label.trim())
    || /^land$/i.test(label.trim());
}

/** Tiny incomplete monthly stubs only (historic Montechino ~$11k). */
const PROTECTED_STOCK_STUB_ABS = 50_000;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthSortFromKey(k: string): number {
  const parts = k.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  const mi = MONTH_ABBR.indexOf(parts[0] ?? '') + 1;
  const yi = parseInt(parts[1] ?? '', 10);
  if (!mi || !Number.isFinite(yi)) return 0;
  return yi * 100 + mi;
}

function itemHasLaterMonthThanPeriod(
  mv: Record<string, number>,
  year: number,
  month: number,
): boolean {
  const endSort = year * 100 + month;
  return Object.keys(mv).some(k => {
    const sort = monthSortFromKey(k);
    return sort > endSort && Math.floor(sort / 100) === year;
  });
}

/**
 * Rewrite `values[anchor.year]` from monthly cells for the active period.
 * - flow (P&L / CF): sum months in the window
 * - stock (Balance Sheet): take the period-end month balance
 * Rows with no monthly keys for the window keep their annual value (YoY ledger).
 */
export function scopeStatementItemsToPeriod<T extends PDFinItemLike>(
  items: T[],
  fin: PDFinancialsLike,
  anchor: YearSnapshotPeriodAnchor | null | undefined,
  mode: PropDevStatementFlowMode,
): T[] {
  if (!anchor?.period || !items.length) return items;
  const keys = periodKeysForPropDevYear(fin, anchor.year, anchor);
  if (!keys?.length) return items;
  const y = anchor.year;

  return items.map(item => {
    const mv = item.monthlyValues;
    if (!mv) return item;
    const hasPeriodKeys = keys.some(k => Object.prototype.hasOwnProperty.call(mv, k));
    if (!hasPeriodKeys) {
      // Upload has only later months (e.g. Jun) than the selected end (Mar) —
      // do not keep annual for this year (annual is usually that later close).
      if (mode === 'stock' && itemHasLaterMonthThanPeriod(mv, y, anchor.month)) {
        return { ...item, values: { ...item.values, [y]: 0 } };
      }
      return item;
    }

    const annual = yearVal(item.values, y);

    if (mode === 'stock') {
      // Last non-zero month in the selected window (handles sparse Mar cells).
      let endVal = 0;
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]!;
        const v = mv[k];
        if (v != null && Math.abs(v) > 0.005) {
          endVal = v;
          break;
        }
      }
      const absAnnual = Math.abs(annual);
      const absEnd = Math.abs(endVal);

      // Protected B/S totals: always honor the selected period-end month when it looks
      // like a real balance. Only keep annual when the month cell is a tiny stub
      // (≪ $50k) — never when Mar is merely smaller than a later June/H1 annual column
      // (that bug painted Mar YTD with June figures).
      if (isProtectedStockTotalLabel(item.label) && absAnnual > 0.005) {
        if (absEnd > 0.005 && absEnd < PROTECTED_STOCK_STUB_ABS) {
          return item; // stub month — keep annual
        }
        if (absEnd > 0.005) {
          return { ...item, values: { ...item.values, [y]: endVal } };
        }
        return item;
      }

      if (absEnd > 0.005) {
        return { ...item, values: { ...item.values, [y]: endVal } };
      }
      if (annual !== 0) return item;
      return { ...item, values: { ...item.values, [y]: 0 } };
    }

    const scoped = keys.reduce((s, k) => s + (mv[k] ?? 0), 0);

    // Flow (P&L / CF): if every period month is empty but the annual ledger has a
    // balance, keep annual (QBO often leaves Total rows blank in monthly columns).
    if (scoped === 0 && annual !== 0) {
      const anyNonZeroMonth = keys.some(k => Math.abs(mv[k] ?? 0) > 0.005);
      if (!anyNonZeroMonth) return item;
    }

    return {
      ...item,
      values: { ...item.values, [y]: scoped },
    };
  });
}

export function scopePropDevFinToPeriod(
  fin: PDFinancialsLike,
  anchor: YearSnapshotPeriodAnchor | null | undefined,
): PDFinancialsLike {
  if (!anchor?.period) return fin;
  return {
    ...fin,
    pl: scopeStatementItemsToPeriod(fin.pl, fin, anchor, 'flow'),
    bs: scopeStatementItemsToPeriod(fin.bs, fin, anchor, 'stock'),
    cf: scopeStatementItemsToPeriod(fin.cf ?? [], fin, anchor, 'flow'),
  };
}
