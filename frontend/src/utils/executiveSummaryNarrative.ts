import type { LoanRow, PortfolioSummary } from '../hooks/useRentalCfoData';
import type { KpiData } from './rentalKpiEngine';
import type { RiskActionRow } from './executiveSummaryActionRules';
import { buildEmiStatusRows } from './executiveSummaryEmi';

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function generateExecutiveNarrative(params: {
  k: KpiData | null;
  kPrev: KpiData | null;
  portfolio: PortfolioSummary | null;
  loans: LoanRow[];
  collectionRate: number;
  marketValue: number;
  totalDebt: number;
  cash: number;
  flaggedPropertyCount: number;
  arOverdue90: number;
}): string {
  const { k, kPrev, portfolio, loans, collectionRate, marketValue, totalDebt, cash, flaggedPropertyCount, arOverdue90 } = params;
  const parts: string[] = [];

  if (k && k.totalRevenue > 0) {
    const noiM = (k.noi / k.totalRevenue) * 100;
    let marginClause = `Portfolio NOI Margin stands at ${pct(noiM)}`;
    if (kPrev && kPrev.totalRevenue > 0) {
      const prevM = (kPrev.noi / kPrev.totalRevenue) * 100;
      const delta = noiM - prevM;
      marginClause += `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} points vs prior period`;
    }
    parts.push(`${marginClause}.`);
  } else if (portfolio?.noi_this_month) {
    parts.push(`Portfolio NOI this month is ${fmtUsd(portfolio.noi_this_month)} (from Company Registry / P&L).`);
  } else {
    parts.push('Financial performance data is limited — upload P&L on Rentals → Financials for full margin analysis.');
  }

  if (portfolio) {
    const occ = portfolio.occupancy_pct * 100;
    parts.push(`Physical occupancy is at ${pct(occ)} against a 95% operating target${portfolio.vacant_units > 0 ? `, with ${portfolio.vacant_units} vacant units` : ''}.`);
  }

  if (collectionRate > 0) {
    parts.push(`Collection rate is ${pct(collectionRate)}${collectionRate < 95 ? ' — below the 95% target' : ''}.`);
  }

  if (flaggedPropertyCount > 0) {
    parts.push(`${flaggedPropertyCount} propert${flaggedPropertyCount === 1 ? 'y is' : 'ies are'} flagged for review due to DSCR, LTV, vacancy, or arrears risk.`);
  } else if (loans.length > 0) {
    parts.push('No critical DSCR/LTV covenant flags on current loan data.');
  }

  if (cash > 0) {
    const cashClause = cash > totalDebt * 0.1 ? 'strong' : 'tight';
    parts.push(`Cash position is ${cashClause} at ${fmtUsd(cash)}.`);
  } else if (k) {
    parts.push('Cash balance not available on balance sheet for this period.');
  }

  const now = new Date();
  const in12 = new Date(now);
  in12.setMonth(in12.getMonth() + 12);
  const maturing = loans.filter(l => l.loan_maturity_date && new Date(l.loan_maturity_date) <= in12);
  const maturingBal = maturing.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);
  if (loans.length > 0) {
    parts.push(`${loans.length} loan${loans.length !== 1 ? 's' : ''} totaling ${fmtUsd(totalDebt)} outstanding${maturing.length > 0 ? `, with ${maturing.length} (${fmtUsd(maturingBal)}) maturing within 12 months` : ''}.`);
  }

  if (marketValue > 0) {
    parts.push(`Estimated portfolio value is ${fmtUsd(marketValue)}${totalDebt > 0 ? ` (${totalDebt / marketValue < 0.75 ? 'conservative' : 'elevated'} leverage)` : ''}.`);
  }

  if (arOverdue90 > 0) {
    parts.push(`AR aging shows ${fmtUsd(arOverdue90)} in 90+ day balances (credit balances excluded).`);
  }

  return parts.slice(0, 5).join(' ');
}

export function generateStrategicRecommendations(params: {
  riskRows: RiskActionRow[];
  loans: LoanRow[];
  portfolio: PortfolioSummary | null;
  collectionRate: number;
  arOverdue90: number;
  k: KpiData | null;
}): string[] {
  const { riskRows, loans, portfolio, collectionRate, arOverdue90, k } = params;
  const bullets: string[] = [];
  const critical = riskRows.filter(r => r.severity === 'critical');

  const lowDscr = loans.filter(l => {
    const d = l.dscr ?? (l.noi_annual && l.loan_emi ? (l.noi_annual / 12) / l.loan_emi : null);
    return d != null && d < 1.2;
  });
  if (lowDscr.length > 0) {
    bullets.push(
      `Prioritize refinancing or NOI improvement on ${lowDscr.length} propert${lowDscr.length === 1 ? 'y' : 'ies'} with DSCR below the 1.2× covenant threshold.`,
    );
  }

  if (portfolio && portfolio.occupancy_pct * 100 < 95) {
    const vac = portfolio.vacant_units;
    bullets.push(
      `Address vacancy on ${vac} unit${vac !== 1 ? 's' : ''} — occupancy at ${pct(portfolio.occupancy_pct * 100)} vs 95% target; review pricing and lease-up pipeline.`,
    );
  }

  if (collectionRate > 0 && collectionRate < 95) {
    bullets.push(
      `Review collection process — collection rate at ${pct(collectionRate)}. ${arOverdue90 > 0 ? `AR aging shows ${fmtUsd(arOverdue90)} in 90+ day arrears (excluding credit balances).` : 'Accelerate follow-up on outstanding tenant balances.'}`,
    );
  } else if (arOverdue90 > 0) {
    bullets.push(
      `Review collection process — AR aging shows ${fmtUsd(arOverdue90)} in 90+ day arrears (credit balances excluded).`,
    );
  }

  const overdueEmi = buildEmiStatusRows(loans).filter(e => e.isOverdue);
  if (overdueEmi.length > 0) {
    bullets.push(
      `Treasury action: ${overdueEmi.length} loan EMI${overdueEmi.length !== 1 ? 's' : ''} past due-date calendar — confirm payments and update Loan Tracker.`,
    );
  }

  const highLtv = loans.filter(l => {
    const bal = l.loan_balance_as_of ?? 0;
    const val = l.current_property_value ?? l.loan_amount ?? 0;
    return val > 0 && bal / val > 0.75;
  });
  if (highLtv.length > 0) {
    bullets.push(
      `Evaluate deleveraging or value-add capex on ${highLtv.length} high-LTV propert${highLtv.length === 1 ? 'y' : 'ies'} to reduce lender risk.`,
    );
  }

  if (k && k.totalRevenue > 0 && (k.noi / k.totalRevenue) * 100 < 20) {
    bullets.push('Conduct operating expense review — NOI margin below 20% target; align with Expenses page P&L totals.');
  }

  const maturing = loans.filter(l => {
    if (!l.loan_maturity_date) return false;
    const m = new Date(l.loan_maturity_date);
    const months = (m.getFullYear() - new Date().getFullYear()) * 12 + (m.getMonth() - new Date().getMonth());
    return months >= 0 && months <= 12;
  });
  if (maturing.length > 0) {
    const bal = maturing.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);
    bullets.push(
      `Begin refinance planning for ${maturing.length} loan${maturing.length !== 1 ? 's' : ''} (${fmtUsd(bal)}) maturing within 12 months.`,
    );
  }

  if (critical.length > 0 && bullets.length < 5) {
    bullets.push(`${critical.length} critical action item${critical.length !== 1 ? 's' : ''} require board attention this cycle — see Risk & Action Items slide.`);
  }

  if (!bullets.length) {
    bullets.push('Portfolio metrics are within target ranges — maintain current leasing, collection, and debt service discipline.');
    bullets.push('Continue monthly financial close and QB aging uploads to preserve board-ready reporting.');
  }

  return bullets.slice(0, 5);
}
