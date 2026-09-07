import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import { isActivePropDevLoan, resolveLandValue } from './propDevLoanMetrics';

const LENDER_MIN_DSCR = 1.25;

export interface AmortizationRow {
  paymentNum: number;
  date: string;
  openingBalance: number;
  emi: number;
  principal: number;
  interest: number;
  closingBalance: number;
  cumulativeInterest: number;
}

/** Standard amortization walk from today's balance/rate/EMI. Stops early if EMI can't cover interest. */
export function computeAmortizationSchedule(loan: Loan, months = 360, startDate = new Date()): AmortizationRow[] {
  const monthlyRate = (loan.interestRate || 0) / 100 / 12;
  let balance = loan.balance || 0;
  let cumulativeInterest = 0;
  const rows: AmortizationRow[] = [];
  for (let i = 1; i <= months && balance > 0.5; i++) {
    const interest = balance * monthlyRate;
    let principal = (loan.emi || 0) - interest;
    if (principal <= 0) break; // EMI doesn't cover interest — schedule can't amortize
    if (principal > balance) principal = balance;
    const opening = balance;
    balance = Math.max(0, balance - principal);
    cumulativeInterest += interest;
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i);
    rows.push({
      paymentNum: i,
      date: d.toISOString().slice(0, 10),
      openingBalance: opening,
      emi: loan.emi || 0,
      principal,
      interest,
      closingBalance: balance,
      cumulativeInterest,
    });
  }
  return rows;
}

export interface PayoffResult {
  outstandingPrincipal: number;
  accruedInterest: number;
  accruedDays: number;
  prepaymentPenalty: number;
  totalPayoff: number;
  asOfDate: string;
}

export function computePayoff(loan: Loan, payoffDate: Date, penaltyPct: number, lastPaymentDate?: Date | null): PayoffResult {
  const outstandingPrincipal = loan.balance || 0;
  const dailyRate = (loan.interestRate || 0) / 100 / 365;
  const anchor = lastPaymentDate ?? new Date(payoffDate.getFullYear(), payoffDate.getMonth(), loan.emiDate || 1);
  const accruedDays = Math.max(0, Math.round((payoffDate.getTime() - anchor.getTime()) / 86400000));
  const accruedInterest = outstandingPrincipal * dailyRate * accruedDays;
  const prepaymentPenalty = outstandingPrincipal * (penaltyPct / 100);
  return {
    outstandingPrincipal,
    accruedInterest,
    accruedDays,
    prepaymentPenalty,
    totalPayoff: outstandingPrincipal + accruedInterest + prepaymentPenalty,
    asOfDate: payoffDate.toISOString().slice(0, 10),
  };
}

export type DscrStatus = 'Strong' | 'Adequate' | 'Thin' | 'Coverage Gap' | 'No debt';

export function dscrStatusFor(dscr: number | null): DscrStatus {
  if (dscr == null) return 'No debt';
  if (dscr > 1.5) return 'Strong';
  if (dscr >= 1.25) return 'Adequate';
  if (dscr >= 1.0) return 'Thin';
  return 'Coverage Gap';
}

export interface DscrRow {
  entityId: string;
  entityName: string;
  annualNoi: number | null;
  annualDebtService: number;
  dscr: number | null;
  status: DscrStatus;
  cushion: number | null;
}

export function computeDscrRows(companies: CompanyData[], allLoans: Loan[], noiById: Record<string, number | null>): DscrRow[] {
  return companies.map(c => {
    const loans = allLoans.filter(l => l.companyId === c.id && isActivePropDevLoan(l));
    const annualDebtService = loans.reduce((s, l) => s + (l.emi || 0), 0) * 12;
    const annualNoi = noiById[c.id] ?? null;
    const dscr = annualNoi != null && annualDebtService > 0 ? annualNoi / annualDebtService : null;
    return {
      entityId: c.id, entityName: c.name, annualNoi, annualDebtService,
      dscr, status: dscrStatusFor(annualDebtService > 0 ? dscr : null),
      cushion: annualNoi != null ? annualNoi - annualDebtService : null,
    };
  }).filter(r => allLoans.some(l => l.companyId === r.entityId));
}

export interface RefinanceRow {
  loanId: string;
  entityName: string;
  lender: string;
  currentRate: number;
  marketRate: number;
  rateDiffBps: number;
  outstanding: number;
  monthlySavings: number;
  annualSavings: number;
  breakEvenMonths: number | null;
}

export function computeRefinancingRows(companies: CompanyData[], allLoans: Loan[], marketRate: number): RefinanceRow[] {
  return allLoans
    .filter(l => isActivePropDevLoan(l) && (l.interestRate || 0) > marketRate)
    .map(l => {
      const rateDiff = (l.interestRate || 0) - marketRate;
      const monthlySavings = (rateDiff / 100 / 12) * l.balance;
      const annualSavings = monthlySavings * 12;
      const refinanceCost = l.balance * 0.02;
      const breakEvenMonths = monthlySavings > 0 ? refinanceCost / monthlySavings : null;
      const company = companies.find(c => c.id === l.companyId);
      return {
        loanId: l.id,
        entityName: company?.name ?? l.company,
        lender: l.bank,
        currentRate: l.interestRate || 0,
        marketRate,
        rateDiffBps: Math.round(rateDiff * 100),
        outstanding: l.balance || 0,
        monthlySavings, annualSavings, breakEvenMonths,
      };
    })
    .sort((a, b) => b.annualSavings - a.annualSavings);
}

export interface SensitivityRow {
  entityId: string;
  entityName: string;
  currentEmi: number;
  newEmi: number;
  changeAmount: number;
  currentDscr: number | null;
  newDscr: number | null;
  impactStatus: DscrStatus;
}

export function computeSensitivityRows(
  companies: CompanyData[], allLoans: Loan[], noiById: Record<string, number | null>, rateChangePct: number,
): SensitivityRow[] {
  return companies.map(c => {
    const loans = allLoans.filter(l => l.companyId === c.id && isActivePropDevLoan(l));
    if (!loans.length) return null;
    const currentEmi = loans.reduce((s, l) => s + (l.emi || 0), 0);
    // Re-derive EMI at the shifted rate using the same principal/remaining-EMI relationship:
    // newEmi ≈ currentEmi × (newRate / currentRate) applied per-loan on interest-only proxy is imprecise,
    // so recompute per loan via the standard annuity formula holding remaining term implied by current EMI.
    const newEmi = loans.reduce((s, l) => {
      const rate = l.interestRate || 0;
      const newRate = Math.max(0.1, rate + rateChangePct);
      if (!l.balance || !l.emi) return s + (l.emi || 0);
      const monthlyRateOld = rate / 100 / 12;
      const monthlyRateNew = newRate / 100 / 12;
      // Solve remaining term n from current EMI, then reapply to get new EMI at same n.
      const n = monthlyRateOld > 0 && l.emi > l.balance * monthlyRateOld
        ? Math.log(l.emi / (l.emi - l.balance * monthlyRateOld)) / Math.log(1 + monthlyRateOld)
        : 120; // fallback: 10y remaining if unsolvable
      const nSafe = Number.isFinite(n) && n > 0 ? n : 120;
      const newLoanEmi = monthlyRateNew > 0
        ? (l.balance * monthlyRateNew) / (1 - Math.pow(1 + monthlyRateNew, -nSafe))
        : l.balance / nSafe;
      return s + (Number.isFinite(newLoanEmi) ? newLoanEmi : l.emi);
    }, 0);
    const annualNoi = noiById[c.id] ?? null;
    const currentDscr = annualNoi != null && currentEmi > 0 ? annualNoi / (currentEmi * 12) : null;
    const newDscr = annualNoi != null && newEmi > 0 ? annualNoi / (newEmi * 12) : null;
    return {
      entityId: c.id, entityName: c.name, currentEmi, newEmi,
      changeAmount: newEmi - currentEmi, currentDscr, newDscr,
      impactStatus: dscrStatusFor(newDscr),
    };
  }).filter((r): r is SensitivityRow => r !== null);
}

export interface DebtCapacityRow {
  entityId: string;
  entityName: string;
  currentNoi: number | null;
  currentDebtService: number;
  currentDscr: number | null;
  maxDebtService: number | null;
  debtHeadroom: number | null;
  maxAdditionalLoanDscr: number | null;
  ltlvHeadroom: number | null;
  actualCapacity: number | null;
}

export function computeDebtCapacityRows(
  companies: CompanyData[], allLoans: Loan[], noiById: Record<string, number | null>, marketRate: number,
): DebtCapacityRow[] {
  return companies.map(c => {
    const loans = allLoans.filter(l => l.companyId === c.id && isActivePropDevLoan(l));
    const currentDebtService = loans.reduce((s, l) => s + (l.emi || 0), 0) * 12;
    const currentOutstanding = loans.reduce((s, l) => s + (l.balance || 0), 0);
    const annualNoi = noiById[c.id] ?? null;
    const currentDscr = annualNoi != null && currentDebtService > 0 ? annualNoi / currentDebtService : null;
    const maxDebtService = annualNoi != null ? annualNoi / LENDER_MIN_DSCR : null;
    const debtHeadroom = maxDebtService != null ? maxDebtService - currentDebtService : null;
    const maxAdditionalLoanDscr = debtHeadroom != null && debtHeadroom > 0
      ? (debtHeadroom * 12) / (marketRate / 100)
      : (debtHeadroom != null ? 0 : null);
    const landValue = resolveLandValue(c);
    const ltlvHeadroom = landValue != null ? Math.max(0, landValue * 0.75 - currentOutstanding) : null;
    const actualCapacity = maxAdditionalLoanDscr != null && ltlvHeadroom != null
      ? Math.min(maxAdditionalLoanDscr, ltlvHeadroom)
      : (maxAdditionalLoanDscr ?? ltlvHeadroom);
    return {
      entityId: c.id, entityName: c.name, currentNoi: annualNoi, currentDebtService, currentDscr,
      maxDebtService, debtHeadroom, maxAdditionalLoanDscr, ltlvHeadroom, actualCapacity,
    };
  });
}
