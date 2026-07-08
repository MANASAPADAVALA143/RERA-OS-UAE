import {
  aggregateKpiDataList,
  calcKpisFromMonthlyKey,
  getAvailableKeys,
  type ParsedFinancials,
} from './rentalKpiEngine';
import { getTrailingMonthKeys } from './periodWindow';
import { estimateDsoFromBuckets } from '../components/rental/QbArAgingUploadPanel';

const AP_WEIGHTS = [0, 15, 45, 75] as const;

export interface MarginTrendPoint {
  month: string;
  full: string;
  noiMargin: number | null;
  netMargin: number | null;
  expenseRatio: number | null;
}

export interface CashCyclePoint {
  month: string;
  dso: number | null;
  dpo: number | null;
  ccc: number | null;
}

export interface AgingTrendBuckets {
  month: string;
  current?: number;
  days_1_30?: number;
  days_31_60?: number;
  days_61_90?: number;
  days_91_plus?: number;
  days_60_plus?: number;
  total?: number;
}

/** Weighted DPO from QB AP aging buckets (mirrors backend qb_ap_aging_latest). */
export function estimateDpoFromBuckets(
  t: Pick<AgingTrendBuckets, 'current' | 'days_1_30' | 'days_31_60' | 'days_60_plus'> | null | undefined,
): number | null {
  if (!t) return null;
  const vals = [t.current ?? 0, t.days_1_30 ?? 0, t.days_31_60 ?? 0, t.days_60_plus ?? 0];
  const pos = vals.map(v => Math.max(0, v));
  const total = pos.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const weighted = pos.reduce((s, v, i) => s + v * AP_WEIGHTS[i], 0) / total;
  return Math.round(weighted);
}

function trendMonthLabel(m: string): string {
  const parts = m.split(/[-\s]/);
  return parts[0]?.slice(0, 3) ?? m;
}

function trendSortKey(m: string): number {
  const parts = m.split(/[-\s]/);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = mon.indexOf(parts[0] ?? '');
  const yr = parseInt(parts[1] ?? '0', 10);
  return (yr || 0) * 100 + (mi >= 0 ? mi + 1 : 0);
}

/** NOI / Net Income / Expense ratio margins per month from uploaded P&L. */
export function buildMarginTrend(
  fins: ParsedFinancials[],
  endMonth: number,
  endYear: number,
  count = 12,
): MarginTrendPoint[] {
  const keys = getTrailingMonthKeys(endMonth, endYear, count);
  return keys.map(key => {
    const views = fins
      .map(f => (getAvailableKeys(f).includes(key) ? calcKpisFromMonthlyKey(f, key) : null))
      .filter((v): v is NonNullable<typeof v> => v !== null);
    if (!views.length) {
      return { month: key.split(' ')[0], full: key, noiMargin: null, netMargin: null, expenseRatio: null };
    }
    const k = aggregateKpiDataList(views);
    const rev = k.totalRevenue;
    if (rev <= 0) {
      return { month: key.split(' ')[0], full: key, noiMargin: null, netMargin: null, expenseRatio: null };
    }
    return {
      month: key.split(' ')[0],
      full: key,
      noiMargin: (k.noi / rev) * 100,
      netMargin: (k.netIncome / rev) * 100,
      expenseRatio: (k.totalExpenses / rev) * 100,
    };
  });
}

/** DSO · DPO · CCC (DSO − DPO; DIO N/A for rentals) from QB aging snapshot trends. */
export function buildCashCycleTrend(
  arTrend: AgingTrendBuckets[],
  apTrend: AgingTrendBuckets[],
): CashCyclePoint[] {
  const monthSet = new Set<string>();
  arTrend.forEach(t => monthSet.add(t.month));
  apTrend.forEach(t => monthSet.add(t.month));
  const months = [...monthSet].sort((a, b) => trendSortKey(a) - trendSortKey(b));

  return months.map(month => {
    const ar = arTrend.find(t => t.month === month);
    const ap = apTrend.find(t => t.month === month);
    const dso = ar ? estimateDsoFromBuckets(ar) : null;
    const dpo = ap ? estimateDpoFromBuckets(ap) : null;
    const ccc = dso != null && dpo != null ? dso - dpo : null;
    return { month: trendMonthLabel(month), dso, dpo, ccc };
  });
}

export function hasMarginTrendData(points: MarginTrendPoint[]): boolean {
  return points.some(p => p.noiMargin != null || p.netMargin != null || p.expenseRatio != null);
}

export function hasCashCycleData(points: CashCyclePoint[]): boolean {
  return points.some(p => p.dso != null || p.dpo != null);
}
