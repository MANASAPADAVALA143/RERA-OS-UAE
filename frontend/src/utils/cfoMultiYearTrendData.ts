import {
  aggregateKpiDataList,
  calcKpis,
  calcKpisFromMonthlyKey,
  calcKpisYtdThroughMonth,
  getAvailableKeys,
  type KpiData,
  type ParsedFinancials,
} from './rentalKpiEngine';
import { opexChartLabel } from './rentalExpenseUtils';
import { getPeriodFilterKeys, monthKeyFromParts, type Period } from './periodWindow';

const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface YearSnapshotPeriodAnchor {
  month: number;
  year: number;
  period?: Period;
}

export function anchorPeriodKeys(
  fin: ParsedFinancials,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): string[] {
  const available = getAvailableKeys(fin);
  if (anchor && year === anchor.year) {
    return getPeriodFilterKeys(anchor.period ?? 'YTD', anchor.month, anchor.year)
      .filter(k => available.includes(k));
  }
  return available.filter(k => k.endsWith(` ${year}`));
}

/**
 * Balance-sheet month key for multi-year charts: December for a complete historical year,
 * or the last month in a capped anchor window (YTD / Month / YoY). Never sums months.
 */
export function periodEndBalanceKey(
  fin: ParsedFinancials,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): string | null {
  const keys = anchorPeriodKeys(fin, year, anchor);
  if (!keys.length) {
    return getAvailableKeys(fin).filter(k => k.endsWith(` ${year}`)).pop() ?? null;
  }
  if (anchor && year === anchor.year) {
    return keys[keys.length - 1];
  }
  const decKey = monthKeyFromParts(12, year);
  if (keys.includes(decKey)) return decKey;
  return keys[keys.length - 1];
}

/** Point-in-time cash (Bank Accounts) as of period end — same rule as Cash Balance KPI. */
export function cashBalanceAtPeriodEnd(
  fin: ParsedFinancials,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const key = periodEndBalanceKey(fin, year, anchor);
  if (!key) return calcKpis(fin, year).cash;
  return calcKpisFromMonthlyKey(fin, key).cash;
}

export interface YearSnapshot {
  year: number;
  /** X-axis label — includes YTD suffix for the anchored year when period filter is active. */
  yearLabel: string;
  revenue: number;
  expenses: number;
  netIncome: number;
  noi: number;
  cash: number;
  margin: number;
  rentalIncome: number;
  otherIncome: number;
  services: number;
  kpi: KpiData;
}

export function unionYears(fins: ParsedFinancials[]): number[] {
  const set = new Set<number>();
  for (const fin of fins) fin.years.forEach(y => set.add(y));
  return [...set].sort((a, b) => a - b);
}

export function yearSnapshotLabel(year: number, anchor?: YearSnapshotPeriodAnchor | null): string {
  if (anchor && year === anchor.year) {
    if (anchor.period === 'Month') {
      return `${MNAMES[anchor.month - 1]} ${anchor.year}`;
    }
    return `${year} (YTD through ${MNAMES[anchor.month - 1]})`;
  }
  // Prior years: year only — no "(Full Year)" (clips in YoY / snapshot headers).
  return String(year);
}

/** Snapshot / PDF year column: "2023", or "Mar 2026" for month-scoped current year. */
export function compactSnapshotYearLabel(y: { year: number; yearLabel?: string }): string {
  const label = (y.yearLabel || '').trim();
  if (/^[A-Za-z]{3}\s+\d{4}$/.test(label)) return label;
  return String(y.year);
}

function kpisForSnapshotYear(
  fin: ParsedFinancials,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): KpiData {
  if (anchor && year === anchor.year) {
    if (anchor.period === 'Month') {
      const key = monthKeyFromParts(anchor.month, anchor.year);
      const available = getAvailableKeys(fin);
      if (available.includes(key)) return calcKpisFromMonthlyKey(fin, key);
      return calcKpis(fin, year);
    }
    // YTD and YoY both cap the anchor (current) year at the selected month —
    // YoY additionally compares this window against the same window last year.
    return calcKpisYtdThroughMonth(fin, year, anchor.month) ?? calcKpis(fin, year);
  }
  return calcKpis(fin, year);
}

/** Per-year aggregation for multi-year CFO charts; anchor year uses YTD through selected month. */
export function buildYearSnapshots(
  fins: ParsedFinancials[],
  anchor?: YearSnapshotPeriodAnchor | null,
): YearSnapshot[] {
  if (!fins.length) return [];
  return unionYears(fins).map(y => {
    const scoped = fins.filter(f => f.years.includes(y));
    const perCo = scoped.map(f => kpisForSnapshotYear(f, y, anchor));
    const kk = aggregateKpiDataList(perCo);
    // Cash is a stock — always take period-end balance (not a summed flow).
    const cash = scoped.reduce((s, f) => s + cashBalanceAtPeriodEnd(f, y, anchor), 0);
    return {
      year: y,
      yearLabel: yearSnapshotLabel(y, anchor),
      revenue: kk.totalRevenue,
      expenses: kk.totalExpenses,
      netIncome: kk.netIncome,
      noi: kk.noi,
      cash,
      margin: kk.totalRevenue > 0 ? (kk.netIncome / kk.totalRevenue) * 100 : 0,
      rentalIncome: kk.rentalIncome,
      otherIncome: kk.otherIncome,
      services: Math.max(0, kk.totalRevenue - kk.rentalIncome - kk.otherIncome),
      kpi: { ...kk, cash },
    };
  });
}

export function expensePieFromKpi(k: KpiData, companyName?: string) {
  return [
    { name: 'Interest Paid', value: k.interestExpense },
    { name: 'Property Tax', value: k.propertyTax },
    { name: 'HOA Fees', value: k.hoaFees },
    { name: 'Legal Fees', value: k.legalFees },
    { name: 'Mgmt Fee', value: k.managementFee },
    { name: 'Utilities', value: k.utilities },
    { name: 'Repairs', value: k.repairs },
    {
      name: opexChartLabel('Other', companyName),
      value: Math.max(
        0,
        k.totalExpenses
          - k.interestExpense
          - k.propertyTax
          - k.hoaFees
          - k.legalFees
          - k.managementFee
          - k.utilities
          - k.repairs,
      ),
    },
  ].filter(e => e.value > 0);
}
