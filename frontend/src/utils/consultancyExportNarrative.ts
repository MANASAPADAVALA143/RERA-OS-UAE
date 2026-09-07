/**
 * Strategy & Recommendations narrative for the Consultancy PDF export — same
 * { commentary, actions } shape as Rentals'/Property Dev's generators, rule-based off
 * Payroll % of Revenue, AR Days, cash-vs-payroll coverage, and Loans & Advances growth.
 */
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import type { ConsultancyBoardExportPayload } from './gatherConsultancyBoardExportData';

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function generateConsultancyStrategyPlan(data: ConsultancyBoardExportPayload): SectionStrategyPlan {
  const lines: string[] = [];
  const actions: string[] = [];
  const last = data.snapshots[data.snapshots.length - 1];
  const prev = data.snapshots.length > 1 ? data.snapshots[data.snapshots.length - 2] : null;

  if (!last) {
    return { commentary: 'Insufficient data to generate a strategy narrative — upload P&L, Balance Sheet, and Cash Flow to enable Strategy & Recommendations.', actions: ['Upload financials for this company.'] };
  }

  if (last.payrollPctRev != null) {
    if (last.payrollPctRev > 80) {
      lines.push(`Payroll is ${last.payrollPctRev.toFixed(1)}% of revenue — critically high, leaving almost no margin after direct staffing cost.`);
      actions.push('Action: Review billing rates vs payroll cost per deployed employee immediately. Owner: Finance.');
    } else if (last.payrollPctRev > 70) {
      lines.push(`Payroll is ${last.payrollPctRev.toFixed(1)}% of revenue — above the typical 70% threshold for healthy staffing margins.`);
      actions.push('Action: Review billing rates vs payroll cost per deployed employee. Owner: Finance.');
    } else {
      lines.push(`Payroll is ${last.payrollPctRev.toFixed(1)}% of revenue — within a healthy range.`);
    }
  }

  const arDays = last.rev > 0 ? (last.ar / last.rev) * 365 : null;
  if (arDays != null) {
    if (arDays > 90) {
      lines.push(`AR Days are ${arDays.toFixed(0)} — collections are lagging well behind billing.`);
      actions.push('Action: Follow up on aged invoices immediately; consider tightening client payment terms. Owner: Collections.');
    } else if (arDays > 60) {
      lines.push(`AR Days are ${arDays.toFixed(0)} — slower than the 60-day target.`);
      actions.push('Action: Review AR aging and follow up on overdue client invoices. Owner: Collections.');
    }
  }

  const monthlyPayroll = last.payroll / 12;
  const cashMonths = monthlyPayroll > 0 ? last.cash / monthlyPayroll : null;
  if (cashMonths != null) {
    if (cashMonths < 1) {
      lines.push(`Cash on hand covers only ${cashMonths.toFixed(1)} months of payroll — an immediate funding risk.`);
      actions.push('Action: Secure emergency funding or accelerate collections before the next payroll cycle. Owner: Finance.');
    } else if (cashMonths < 3) {
      lines.push(`Cash on hand covers ${cashMonths.toFixed(1)} months of payroll — below the 3-month target reserve.`);
      actions.push('Action: Build cash reserves to cover at least 3 months of payroll. Owner: Finance.');
    } else {
      lines.push(`Cash on hand covers ${cashMonths.toFixed(1)} months of payroll — a healthy buffer.`);
    }
  }

  if (prev && prev.rev > 0 && prev.loansAdvances > 0) {
    const revGrowth = (last.rev - prev.rev) / prev.rev;
    const loanGrowth = (last.loansAdvances - prev.loansAdvances) / prev.loansAdvances;
    if (loanGrowth > revGrowth + 0.1) {
      lines.push(`Loans & Advances grew ${(loanGrowth * 100).toFixed(1)}% vs revenue growth of ${(revGrowth * 100).toFixed(1)}% — related-party financing is outpacing the business.`);
      actions.push('Action: Confirm loans & advances growth is temporary, not structural reliance on financing to cover payroll. Owner: Finance.');
    }
  }

  if (last.netInc < 0) {
    lines.push(`Net income is negative (${fmtUsd(last.netInc)}) for the latest period.`);
  }

  return {
    commentary: lines.join(' '),
    actions: actions.length ? actions : ['No immediate action items — continue routine monitoring.'],
  };
}
