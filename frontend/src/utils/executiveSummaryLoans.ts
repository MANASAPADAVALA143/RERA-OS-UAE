import type { LoanRow } from '../hooks/useRentalCfoData';
import type { ExportKpiItem } from './rentalKpiEngine';

export interface LoanExportRow {
  company: string;
  bank: string;
  balance: string;
  rate: string;
  maturity: string;
  emi: string;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return 'Data not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : 'Data not available';
}

export function buildLoanScheduleKpis(loans: LoanRow[]): { rows: LoanExportRow[]; summary: ExportKpiItem[] } {
  if (!loans.length) {
    return {
      rows: [],
      summary: [
        { label: 'Avg Mortgage Rate', value: 'Data not available', benchmark: '<6.5%', status: 'info', statusLabel: 'Info' },
        { label: 'Avg Remaining Term', value: 'Data not available', benchmark: '>24 mo', status: 'info', statusLabel: 'Info' },
        { label: 'Balloon Risk', value: 'Data not available', benchmark: '0 ≤12mo', status: 'info', statusLabel: 'Info' },
      ],
    };
  }

  const avgRate = loans.reduce((s, l) => s + (l.loan_interest_rate ?? 0), 0) / loans.length * 100;
  const totalBal = loans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);
  const now = new Date();
  const in12mo = new Date(now);
  in12mo.setMonth(in12mo.getMonth() + 12);
  const balloonCount = loans.filter(l => {
    if (!l.loan_maturity_date) return false;
    return new Date(l.loan_maturity_date) <= in12mo;
  }).length;

  const withMaturity = loans.filter(l => l.loan_maturity_date);
  const avgTermMonths = withMaturity.length > 0
    ? withMaturity.reduce((s, l) => {
        const months = (new Date(l.loan_maturity_date!).getTime() - now.getTime()) / (30 * 24 * 3600 * 1000);
        return s + Math.max(0, months);
      }, 0) / withMaturity.length
    : 0;

  const rows: LoanExportRow[] = loans.map(l => ({
    company: l.company_name,
    bank: l.loan_bank_name,
    balance: fmtUsd(l.loan_balance_as_of ?? 0),
    rate: l.loan_interest_rate != null ? pct(l.loan_interest_rate * 100) : 'Data not available',
    maturity: l.loan_maturity_date ?? 'Data not available',
    emi: l.loan_emi ? fmtUsd(l.loan_emi) : 'Data not available',
  }));

  const summary: ExportKpiItem[] = [
    {
      label: 'Avg Mortgage Rate', value: pct(avgRate), benchmark: '<6.5%',
      status: avgRate <= 5 ? 'good' : avgRate <= 6.5 ? 'warn' : 'bad',
      statusLabel: avgRate <= 5 ? 'Healthy' : avgRate <= 6.5 ? 'Monitor' : 'Review',
    },
    {
      label: 'Avg Remaining Term',
      value: avgTermMonths > 0 ? `${Math.round(avgTermMonths)} mo` : 'Data not available',
      benchmark: '>24 mo',
      status: avgTermMonths >= 24 ? 'good' : avgTermMonths >= 12 ? 'warn' : 'bad',
      statusLabel: avgTermMonths >= 24 ? 'Healthy' : avgTermMonths >= 12 ? 'Monitor' : 'Review',
    },
    {
      label: 'Balloon Risk',
      value: `${balloonCount} loan${balloonCount !== 1 ? 's' : ''} ≤12mo`,
      benchmark: '0',
      status: balloonCount === 0 ? 'good' : balloonCount <= 2 ? 'warn' : 'bad',
      statusLabel: balloonCount === 0 ? 'Healthy' : balloonCount <= 2 ? 'Monitor' : 'Review',
    },
  ];

  return { rows, summary };
}
