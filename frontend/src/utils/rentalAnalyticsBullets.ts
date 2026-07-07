/** Benchmark bullet definitions — mirrors KPI Dashboard (RentalFinancials KPITab). */
import type { BulletDef } from '../components/shared/BulletChartStrip';
import type { BulletCard, BulletStatus } from '../components/shared/BulletChartStrip';
import type { ExportKpiItem, KpiStatus } from './rentalKpiEngine';

export const PROFITABILITY_BULLET_DEFS: BulletDef[] = [
  { names: ['NOI Margin'], benchmark: 35, unit: '%', reversed: false, max: 80, extract: v => parseFloat(v) || 0 },
  { names: ['Net Income Margin'], benchmark: 25, unit: '%', reversed: false, max: 80, extract: v => parseFloat(v) || 0 },
  { names: ['Revenue Growth YoY'], benchmark: 0, unit: '%', reversed: false, max: 30, extract: v => Math.max(0, parseFloat(v.replace('+', '')) || 0) },
  { names: ['Expense Ratio'], benchmark: 60, unit: '%', reversed: true, max: 130, extract: v => parseFloat(v) || 0 },
];

export const RENTAL_PERF_BULLET_DEFS: BulletDef[] = [
  { names: ['Interest Coverage'], benchmark: 1.5, unit: 'x', reversed: false, max: 5, extract: v => parseFloat(v) || 0 },
  { names: ['Mgmt Fee %'], benchmark: 10, unit: '%', reversed: true, max: 25, extract: v => parseFloat(v) || 0 },
  { names: ['Repair % of Revenue'], benchmark: 10, unit: '%', reversed: true, max: 25, extract: v => parseFloat(v) || 0 },
];

export const CASH_DEBT_BULLET_DEFS: BulletDef[] = [
  { names: ['DSCR (Est.)'], benchmark: 1.25, unit: 'x', reversed: false, max: 3, extract: v => parseFloat(v) || 0 },
  { names: ['Interest Coverage'], benchmark: 1.5, unit: 'x', reversed: false, max: 5, extract: v => parseFloat(v) || 0 },
];

export const BALANCE_BULLET_DEFS: BulletDef[] = [
  { names: ['LTV'], benchmark: 75, unit: '%', reversed: true, max: 130, extract: v => parseFloat(v) || 0 },
  { names: ['Asset / Liability Ratio', 'Asset/Liability'], benchmark: 1.5, unit: 'x', reversed: false, max: 3, extract: v => parseFloat(v) || 0 },
  { names: ['Debt-to-Equity'], benchmark: 2, unit: 'x', reversed: true, max: 15, extract: v => parseFloat(v) || 0 },
];

export function kpiStatusToBullet(status: KpiStatus): BulletStatus {
  if (status === 'good') return 'good';
  if (status === 'warn') return 'watch';
  if (status === 'bad') return 'critical';
  return 'info';
}

export function exportItemsToBulletCards(items: ExportKpiItem[]): BulletCard[] {
  return items.map(i => ({
    name: i.label,
    value: i.value,
    status: kpiStatusToBullet(i.status),
  }));
}

export interface AnalyticsAlert {
  kpi: string;
  message: string;
  severity: 'warn' | 'bad' | 'info';
}

export function collectKpiAlerts(items: ExportKpiItem[], k: { buildings: number; equity: number; interestExpense: number }): AnalyticsAlert[] {
  const alerts: AnalyticsAlert[] = [];
  for (const item of items) {
    if (item.status === 'bad') {
      alerts.push({ kpi: item.label, message: `${item.label}: ${item.value} — Review (target ${item.benchmark})`, severity: 'bad' });
    } else if (item.status === 'warn') {
      alerts.push({ kpi: item.label, message: `${item.label}: ${item.value} — Monitor (target ${item.benchmark})`, severity: 'warn' });
    } else if (item.value === 'Data not available' || item.value === 'N/A') {
      alerts.push({ kpi: item.label, message: `${item.label}: N/A — missing or insufficient data`, severity: 'info' });
    }
  }
  if (k.buildings <= 0) {
    alerts.push({ kpi: 'LTV', message: 'LTV: property / building value missing in balance sheet', severity: 'info' });
  }
  if (k.equity < 0) {
    alerts.push({ kpi: 'Debt-to-Equity', message: `Debt-to-Equity: negative equity (${k.equity.toLocaleString()}) — distressed balance sheet`, severity: 'warn' });
  }
  if (k.equity === 0) {
    alerts.push({ kpi: 'Debt-to-Equity', message: 'Debt-to-Equity: N/A — equity is zero', severity: 'info' });
  }
  return alerts;
}

export interface ExceptionRow {
  companyId: string;
  companyName: string;
  kpi: string;
  value: string;
  status: string;
  benchmark: string;
  sortRank: number;
}

export function statusSortRank(status: KpiStatus): number {
  if (status === 'bad') return 0;
  if (status === 'warn') return 1;
  if (status === 'info') return 2;
  return 3;
}

export function buildExceptionRows(
  companies: { id: string; company_name: string; items: ExportKpiItem[] }[],
): ExceptionRow[] {
  const rows: ExceptionRow[] = [];
  for (const co of companies) {
    for (const item of co.items) {
      const marginVal = parseFloat(item.value.replace(/[^0-9.-]/g, ''));
      const isNegativeMargin =
        (item.label === 'NOI Margin' || item.label === 'Net Income Margin') &&
        Number.isFinite(marginVal) && marginVal < 0;
      const isException =
        item.status === 'bad' ||
        item.status === 'warn' ||
        item.value === 'Data not available' ||
        item.value === 'N/A' ||
        isNegativeMargin;
      if (!isException) continue;
      rows.push({
        companyId: co.id,
        companyName: co.company_name,
        kpi: item.label,
        value: item.value,
        status: item.statusLabel,
        benchmark: item.benchmark,
        sortRank: statusSortRank(item.status),
      });
    }
  }
  return rows.sort((a, b) => a.sortRank - b.sortRank || a.companyName.localeCompare(b.companyName));
}
