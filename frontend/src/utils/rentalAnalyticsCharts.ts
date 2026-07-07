import type { KpiData } from './rentalKpiEngine';

export interface WaterfallRow {
  label: string;
  invisible: number;
  bar: number;
  fill: string;
}

export function buildProfitWaterfall(k: KpiData): WaterfallRow[] {
  const gross = k.rentalIncome > 0 ? k.rentalIncome : k.totalRevenue;
  const opex = k.totalExpenses;
  const noi = k.noi;
  const interest = k.interestExpense;
  const net = k.netIncome;

  const afterGross = gross;
  const afterOpex = gross - opex;
  const afterInterest = afterOpex - interest;

  return [
    { label: 'Gross Rental Income', invisible: 0, bar: gross, fill: '#166534' },
    { label: 'Less Operating Expenses', invisible: afterOpex, bar: opex, fill: '#C0392B' },
    { label: 'NOI', invisible: 0, bar: noi, fill: '#0F766E' },
    { label: 'Less Interest Paid', invisible: afterInterest, bar: interest, fill: '#B45309' },
    { label: 'Net Income', invisible: 0, bar: net, fill: net >= 0 ? '#1D4ED8' : '#C0392B' },
  ];
}

export function fmtAnalyticsCurrency(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `$${(a / 1_000_000).toFixed(2)}M`
    : a >= 1_000 ? `$${(a / 1_000).toFixed(0)}K`
    : `$${a.toFixed(0)}`;
  return n < 0 ? `(${s})` : s;
}

export function shortMonthLabel(key: string): string {
  const [mon, yr] = key.split(' ');
  return `${mon?.slice(0, 3) ?? key} '${String(yr ?? '').slice(-2)}`;
}
