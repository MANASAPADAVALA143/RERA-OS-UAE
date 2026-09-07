/**
 * Period-scoped billed / collected / collection rate from /api/rentals/ar-summary.
 * Same window math as RentalArDashboard.
 *
 * Collection Rate = Collected ÷ Billed (GPR denominator for the same period).
 * AR Outstanding for Rental Performance comes from QB aging (see qbAgingMetrics),
 * not from billed − collected.
 */
import { getPeriodFilterKeys, type Period } from './periodWindow';
import type { ArSummaryResponse } from '../hooks/useExecutiveSummaryData';

export interface ArSummaryPeriodMetrics {
  billed: number;
  collected: number;
  /** Period billed − collected (not the aging-report stock). */
  outstanding: number;
  rate: number;
}

/** Rent Receivable uses "Jan-2026"; PeriodToggle uses "Jan 2026". */
function arMonthToKey(m: string): string {
  return m.includes('-') ? m.replace('-', ' ') : m;
}

/**
 * Period-scoped billed / collected / rate from AR Summary.
 * YTD = Jan → selected month; Month = selected month only.
 */
export function metricsFromArSummary(
  arSummary: ArSummaryResponse | null | undefined,
  entityId: string,
  period: Period | null,
  month: number,
  year: number,
): ArSummaryPeriodMetrics | null {
  const companies = arSummary?.companies;
  if (!companies?.length) return null;

  const cos = entityId === 'portfolio'
    ? companies
    : companies.filter(c => c.company_id === entityId);
  if (!cos.length) return null;

  const periodKeys = period
    ? new Set(getPeriodFilterKeys(period, month, year))
    : null;

  let billed = 0;
  let collected = 0;

  for (const co of cos) {
    const monthly = co.monthly ?? [];
    if (periodKeys) {
      const rows = monthly.filter(m => periodKeys.has(arMonthToKey(m.month)));
      billed += rows.reduce((s, r) => s + (r.billed ?? 0), 0);
      collected += rows.reduce((s, r) => s + (r.collected ?? 0), 0);
    } else {
      billed += co.billed_per_month ?? 0;
      collected += co.latest_collected ?? 0;
    }
  }

  // No rows in window — do not fall back to portfolio lifetime / all-months totals.
  if (billed <= 0 && collected <= 0) return null;

  const outstanding = Math.max(0, billed - collected);
  const rate = billed > 0 ? (collected / billed) * 100 : 0;
  return { billed, collected, outstanding, rate };
}
