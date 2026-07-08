import type { LoanRow } from '../hooks/useRentalCfoData';

export type EmiPaymentStatus = 'Current' | 'Due' | 'Overdue' | 'Unknown';

/** EMI due-date calendar status — Loan Tracker has no payment-confirmation field. */
export function deriveEmiPaymentStatus(loan: LoanRow, asOf: Date = new Date()): EmiPaymentStatus {
  if (!loan.loan_emi || loan.loan_emi <= 0) return 'Unknown';
  if (loan.loan_emi_day == null || loan.loan_emi_day < 1) return 'Unknown';
  const today = asOf.getDate();
  const emiDay = loan.loan_emi_day;
  const GRACE_DAYS = 5;
  if (today < emiDay) return 'Current';
  if (today <= emiDay + GRACE_DAYS) return 'Due';
  return 'Overdue';
}

export function emiDueDateLabel(loan: LoanRow, asOf: Date = new Date()): string {
  if (loan.loan_emi_day == null) return '—';
  const d = new Date(asOf.getFullYear(), asOf.getMonth(), Math.min(loan.loan_emi_day, 28));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface EmiStatusRow {
  loanName: string;
  lender: string;
  outstanding: string;
  emiAmount: string;
  emiDueDate: string;
  paymentStatus: EmiPaymentStatus;
  interestRate: string;
  maturityDate: string;
  isOverdue: boolean;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return 'Data not available';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function buildEmiStatusRows(loans: LoanRow[]): EmiStatusRow[] {
  const now = new Date();
  return loans.map(l => {
    const status = deriveEmiPaymentStatus(l, now);
    return {
      loanName: l.property_name || l.company_name,
      lender: l.loan_bank_name || '—',
      outstanding: fmtUsd(l.loan_balance_as_of ?? 0),
      emiAmount: l.loan_emi ? fmtUsd(l.loan_emi) : 'Data not available',
      emiDueDate: emiDueDateLabel(l, now),
      paymentStatus: status,
      interestRate: l.loan_interest_rate != null
        ? `${(l.loan_interest_rate * 100).toFixed(2)}%`
        : '—',
      maturityDate: l.loan_maturity_date
        ? new Date(l.loan_maturity_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : '—',
      isOverdue: status === 'Overdue',
    };
  });
}

export const EMI_STATUS_DISCLAIMER =
  'Payment status is derived from EMI due day vs. today (Loan Tracker). Actual payment confirmation is not tracked — verify against bank statements.';
