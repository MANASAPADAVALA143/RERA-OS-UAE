import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import {
  isActivePropDevLoan, normalizeInterestRatePercent, resolveLandValue,
  portfolioLtlvPercent, sumActivePropDevLoanBalances, sumActiveMonthlyEmi,
} from './propDevLoanMetrics';
import type { PropDevCompanyOverviewKpis } from './propDevCompanyOverview';

const MARKET_RATE_PCT = 6.5;

export type HealthBadge = 'Active' | 'Pending' | 'Overdue';

export interface EntityHealth {
  entityId: string;
  name: string;
  initials: string;
  ltlvScore: number;
  cashCoverageScore: number;
  loanHealthScore: number;
  compositeScore: number;
  badge: HealthBadge;
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function badgeForScore(score: number): HealthBadge {
  if (score > 75) return 'Active';
  if (score >= 50) return 'Pending';
  return 'Overdue';
}

/** Avg monthly burn = latest available yearly P&L total_expenses / 12 (pre-revenue entities have no MTD expense-date ledger). */
export function monthlyBurnFor(c: CompanyData): number | null {
  const pl = c.property.yearlyPL;
  if (!pl) return null;
  const years = Object.keys(pl).sort();
  const latestY = years[years.length - 1];
  const row = latestY ? pl[latestY] : undefined;
  if (!row || !Number.isFinite(row.total_expenses) || row.total_expenses <= 0) return null;
  return row.total_expenses / 12;
}

function cashRunwayMonths(cash: number | null, burn: number | null): number | null {
  if (cash == null || burn == null || burn <= 0) return null;
  return cash / burn;
}

function ltlvScore(ltlv: number | null, hasLoan: boolean): number {
  if (!hasLoan) return 100;
  if (ltlv == null) return 50;
  if (ltlv < 50) return 100;
  if (ltlv < 70) return 70;
  if (ltlv < 80) return 40;
  return 10;
}

function cashCoverageScore(runway: number | null): number {
  if (runway == null) return 50;
  if (runway > 12) return 100;
  if (runway >= 6) return 70;
  if (runway >= 3) return 40;
  return 10;
}

function loanHealthScore(loans: Loan[]): number {
  const active = loans.filter(isActivePropDevLoan);
  if (!active.length) return 100;
  let score = 100;
  for (const l of active) {
    const rate = normalizeInterestRatePercent(l.interestRate);
    let s = 100;
    if (rate >= 8) s = 30;
    else if (rate >= 7) s = 60;
    else if (rate >= 6) s = 80;
    if (l.maturityDate) {
      const days = Math.round((new Date(l.maturityDate).getTime() - Date.now()) / 86400000);
      if (days >= 0 && days < 30) s -= 50;
      else if (days >= 0 && days < 90) s -= 30;
    }
    score = Math.min(score, Math.max(0, s));
  }
  return score;
}

export function computeEntityHealth(
  companies: CompanyData[],
  kpisById: Record<string, PropDevCompanyOverviewKpis>,
): EntityHealth[] {
  return companies.map(c => {
    const kpis = kpisById[c.id];
    const hasLoan = (c.loans ?? []).some(isActivePropDevLoan);
    const burn = monthlyBurnFor(c);
    const runway = cashRunwayMonths(kpis?.cash ?? null, burn);
    const lScore = ltlvScore(kpis?.ltlv ?? null, hasLoan);
    const cScore = cashCoverageScore(runway);
    const dScore = loanHealthScore(c.loans ?? []);
    const composite = (lScore * 0.40) + (cScore * 0.35) + (dScore * 0.25);
    return {
      entityId: c.id,
      name: c.name,
      initials: initialsFor(c.name),
      ltlvScore: Math.round(lScore),
      cashCoverageScore: Math.round(cScore),
      loanHealthScore: Math.round(dScore),
      compositeScore: Math.round(composite),
      badge: badgeForScore(composite),
    };
  });
}

export type PDAlertType =
  | 'loan_maturity' | 'high_ltlv' | 'low_cash_runway'
  | 'capital_call_overdue' | 'high_rate_loan' | 'lender_concentration' | 'negative_noi';

export const PD_ALERT_TYPE_STATUS: Record<PDAlertType, HealthBadge> = {
  loan_maturity: 'Overdue',
  high_ltlv: 'Overdue',
  low_cash_runway: 'Overdue',
  capital_call_overdue: 'Pending',
  high_rate_loan: 'Pending',
  lender_concentration: 'Pending',
  negative_noi: 'Pending',
};

export interface PDAlert {
  id: string;
  type: PDAlertType;
  status: HealthBadge;
  entity: string;
  entityId: string;
  description: string;
  amount: number | null;
  days: number | null;
  actionPrimary: string;
  actionSecondary: string;
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function buildPropDevAlerts(
  companies: CompanyData[],
  kpisById: Record<string, PropDevCompanyOverviewKpis>,
): PDAlert[] {
  const alerts: PDAlert[] = [];

  for (const c of companies) {
    const kpis = kpisById[c.id];
    const loans = (c.loans ?? []).filter(isActivePropDevLoan);

    // 1. Loan maturing <=90 days
    for (const l of loans) {
      if (!l.maturityDate) continue;
      const days = Math.round((new Date(l.maturityDate).getTime() - Date.now()) / 86400000);
      if (days < 0 || days > 90) continue;
      alerts.push({
        id: `loan_maturity:${l.id}`, type: 'loan_maturity', status: PD_ALERT_TYPE_STATUS.loan_maturity,
        entity: c.name, entityId: c.id,
        description: `${c.name} — ${l.bank} · ${fmtUsd(l.balance)} · ${days} days to maturity`,
        amount: l.balance, days,
        actionPrimary: 'Start refinancing', actionSecondary: 'View loan',
      });
    }

    // 2. High LTLV > 80%
    if (kpis?.ltlv != null && kpis.ltlv > 80) {
      const land = resolveLandValue(c);
      alerts.push({
        id: `high_ltlv:${c.id}`, type: 'high_ltlv', status: PD_ALERT_TYPE_STATUS.high_ltlv,
        entity: c.name, entityId: c.id,
        description: `${c.name} — LTLV ${kpis.ltlv.toFixed(0)}% · Loan: ${fmtUsd(kpis.loanBalance)} · Land: ${land != null ? fmtUsd(land) : '—'}`,
        amount: kpis.loanBalance, days: null,
        actionPrimary: 'View loan', actionSecondary: 'Update land value',
      });
    }

    // 3. Low cash runway < 3 months
    const burn = monthlyBurnFor(c);
    const runway = cashRunwayMonths(kpis?.cash ?? null, burn);
    if (runway != null && runway < 3) {
      alerts.push({
        id: `low_cash_runway:${c.id}`, type: 'low_cash_runway', status: PD_ALERT_TYPE_STATUS.low_cash_runway,
        entity: c.name, entityId: c.id,
        description: `${c.name} — ${fmtUsd(kpis?.cash ?? 0)} cash · ${fmtUsd(burn ?? 0)}/mo burn · est. ${runway.toFixed(1)} months runway`,
        amount: kpis?.cash ?? null, days: null,
        actionPrimary: 'Issue capital call', actionSecondary: 'View cash flow',
      });
    }

    // 4. Capital call outstanding > 30 days
    for (const cc of c.capitalCalls ?? []) {
      const outstanding = (cc.totalDue ?? 0) - (cc.received ?? 0);
      if (outstanding <= 0) continue;
      const dueDate = cc.dueDate ? new Date(cc.dueDate) : null;
      const daysSince = dueDate ? Math.round((Date.now() - dueDate.getTime()) / 86400000) : null;
      if (daysSince == null || daysSince < 30) continue;
      alerts.push({
        id: `capital_call_overdue:${cc.id}`, type: 'capital_call_overdue', status: PD_ALERT_TYPE_STATUS.capital_call_overdue,
        entity: c.name, entityId: c.id,
        description: `${c.name} — ${cc.partnerName} · ${fmtUsd(outstanding)} · ${daysSince} days outstanding`,
        amount: outstanding, days: daysSince,
        actionPrimary: 'Send reminder', actionSecondary: 'Mark received',
      });
    }

    // 5. High rate loan > 8%
    const highRate = loans.filter(l => normalizeInterestRatePercent(l.interestRate) > 8);
    for (const l of highRate) {
      const rate = normalizeInterestRatePercent(l.interestRate);
      const savings = (rate - MARKET_RATE_PCT) / 100 * l.balance / 12;
      alerts.push({
        id: `high_rate_loan:${l.id}`, type: 'high_rate_loan', status: PD_ALERT_TYPE_STATUS.high_rate_loan,
        entity: c.name, entityId: c.id,
        description: `${c.name} — ${l.bank} · ${rate.toFixed(2)}% — ${Math.round((rate - MARKET_RATE_PCT) * 100)}bps above market (${MARKET_RATE_PCT}%) · est. savings ${fmtUsd(Math.max(0, savings))}/mo`,
        amount: l.balance, days: null,
        actionPrimary: 'Review refinancing', actionSecondary: 'View loan',
      });
    }

    // 6. Lender concentration 100%
    const byLender = new Map<string, number>();
    for (const l of loans) byLender.set(l.bank, (byLender.get(l.bank) ?? 0) + (l.balance || 0));
    if (byLender.size === 1 && loans.length > 0) {
      const [bank, amt] = [...byLender.entries()][0];
      alerts.push({
        id: `lender_concentration:${c.id}`, type: 'lender_concentration', status: PD_ALERT_TYPE_STATUS.lender_concentration,
        entity: c.name, entityId: c.id,
        description: `${c.name} — 100% with ${bank} · ${fmtUsd(amt)} single lender risk`,
        amount: amt, days: null,
        actionPrimary: 'Diversify lenders', actionSecondary: 'Dismiss',
      });
    }

    // 7. Negative NOI
    if (kpis?.netIncome != null && kpis.netIncome < 0) {
      alerts.push({
        id: `negative_noi:${c.id}`, type: 'negative_noi', status: PD_ALERT_TYPE_STATUS.negative_noi,
        entity: c.name, entityId: c.id,
        description: `${c.name} — NOI (${fmtUsd(Math.abs(kpis.netIncome))}) · expenses exceeding revenue`,
        amount: kpis.netIncome, days: null,
        actionPrimary: 'View P&L', actionSecondary: 'Dismiss',
      });
    }
  }

  const statusRank: Record<HealthBadge, number> = { Overdue: 0, Pending: 1, Active: 2 };
  alerts.sort((a, b) => statusRank[a.status] - statusRank[b.status]);
  return alerts;
}

export interface CashBurnRow {
  entityId: string;
  name: string;
  cash: number | null;
  monthlyBurn: number | null;
  runwayMonths: number | null;
  emiBurden: number;
  ltlv: number | null;
  status: HealthBadge;
}

export function buildCashBurnRows(
  companies: CompanyData[],
  kpisById: Record<string, PropDevCompanyOverviewKpis>,
  allLoans: Loan[],
): CashBurnRow[] {
  return companies.map(c => {
    const kpis = kpisById[c.id];
    const burn = monthlyBurnFor(c);
    const runway = cashRunwayMonths(kpis?.cash ?? null, burn);
    const emi = sumActiveMonthlyEmi((c.loans?.length ? c.loans : allLoans.filter(l => l.companyId === c.id)));
    let status: HealthBadge = 'Active';
    if ((runway != null && runway < 6) || (kpis?.ltlv != null && kpis.ltlv > 80)) status = 'Overdue';
    else if ((runway != null && runway <= 12) || (kpis?.ltlv != null && kpis.ltlv >= 70)) status = 'Pending';
    if (runway != null && runway < 6) status = 'Overdue';
    return {
      entityId: c.id, name: c.name,
      cash: kpis?.cash ?? null, monthlyBurn: burn, runwayMonths: runway,
      emiBurden: emi, ltlv: kpis?.ltlv ?? null, status,
    };
  });
}

export interface PortfolioHeroStats {
  totalDebt: number;
  avgMonthlyBurn: number;
  capitalCallsDue: number;
}

export function buildPortfolioHeroStats(companies: CompanyData[], allLoans: Loan[]): PortfolioHeroStats {
  const totalDebt = sumActivePropDevLoanBalances(allLoans);
  const burns = companies.map(monthlyBurnFor).filter((b): b is number => b != null);
  const avgMonthlyBurn = burns.length ? burns.reduce((s, b) => s + b, 0) : 0;
  const capitalCallsDue = companies.reduce(
    (s, c) => s + (c.capitalCalls ?? []).reduce((s2, cc) => s2 + Math.max(0, (cc.totalDue ?? 0) - (cc.received ?? 0)), 0),
    0,
  );
  return { totalDebt, avgMonthlyBurn, capitalCallsDue };
}

export { portfolioLtlvPercent };
