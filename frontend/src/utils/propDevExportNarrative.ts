/**
 * Strategy & Recommendations narrative for the Property Dev PDF export — same
 * { commentary, actions } shape as Rentals' generateSectionStrategyPlan, but rule-based
 * off development-entity metrics (LTLV, capital call coverage, cash runway) instead of
 * occupancy / vacancy / collections.
 */
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import { pickFocusSnapshot, type PropDevBoardExportPayload } from './gatherPropDevBoardExportData';

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export function generatePropDevStrategyPlan(data: PropDevBoardExportPayload): SectionStrategyPlan {
  const lines: string[] = [];
  const actions: string[] = [];

  const lastBs = pickFocusSnapshot(data.bsSnapshots, data.focusYear);
  const lastPl = pickFocusSnapshot(data.plSnapshots, data.focusYear);
  const lastCf = pickFocusSnapshot(data.cfSnapshots, data.focusYear);
  const hasOperatingBurn = (lastCf?.operatingCf ?? 0) < 0;
  const cashBalance = lastBs?.cash ?? lastCf?.closingCash ?? 0;

  if (lastBs?.ltlv != null) {
    if (lastBs.ltlv > 75) {
      lines.push(`Loan-to-Land-Value is elevated at ${lastBs.ltlv.toFixed(1)}% (outstanding debt ${fmtUsd(data.totalDebt)} against land value ${fmtUsd(data.landValue ?? 0)}) — limited headroom for further draws without additional equity.`);
      actions.push(`Action: Review draw schedule and consider a partner capital call before the next disbursement. Owner: Finance.`);
    } else if (lastBs.ltlv < 40) {
      lines.push(`Loan-to-Land-Value is conservative at ${lastBs.ltlv.toFixed(1)}%, leaving headroom for additional construction financing if the project timeline requires it.`);
    } else {
      lines.push(`Loan-to-Land-Value sits at ${lastBs.ltlv.toFixed(1)}%, within a typical development-phase range.`);
    }
  }

  const covRatio = data.capitalCallCoverage?.ratio;
  if (data.capitalCallCoverage && !data.capitalCallCoverage.dataGap && covRatio != null) {
    const cov = data.capitalCallCoverage;
    if (cov.status === 'Review') {
      lines.push(`Capital Call Coverage is ${covRatio.toFixed(1)}x — uncalled partner capital (${fmtUsd(cov.uncalled ?? 0)}) does not comfortably cover upcoming EMI obligations (${fmtUsd(cov.obligations)} over 6 months).`);
      actions.push(`Action: Issue a capital call to rebuild coverage above 1.0x before the next EMI cycle. Owner: Managing Partner.`);
    } else if (cov.status === 'Monitor') {
      lines.push(`Capital Call Coverage is ${covRatio.toFixed(1)}x — adequate for now but worth monitoring against upcoming EMI obligations (${fmtUsd(cov.obligations)}).`);
    } else if (cov.status === 'Healthy') {
      lines.push(`Capital Call Coverage is healthy at ${covRatio.toFixed(1)}x — uncalled partner capital comfortably covers upcoming EMI obligations.`);
    }
  }

  // Strategy text must follow the corrected current-period CF, not a stale positive-CF
  // signal. Only treat runway as N/A when the current period is actually cash-flow positive.
  if (hasOperatingBurn) {
    if (data.cashRunway.months != null && data.cashRunway.months < 6) {
      lines.push(`At the current burn rate (${fmtUsd(data.cashRunway.avgMonthlyBurn)}/mo), cash covers approximately ${data.cashRunway.months.toFixed(1)} months of holding costs.`);
      actions.push(`Action: Line up additional funding (capital call, lot sale, or draw) within the next quarter to extend runway. Owner: Finance.`);
    } else if (data.cashRunway.months != null) {
      lines.push(`Cash runway is approximately ${data.cashRunway.months.toFixed(1)} months at the current burn rate — no near-term funding gap identified.`);
    } else {
      lines.push(`The current period shows operating cash burn (${fmtUsd(lastCf?.operatingCf ?? 0)}) with closing cash of ${fmtUsd(cashBalance)}; confirm near-term funding capacity against upcoming holding costs and EMI obligations.`);
      actions.push(`Action: Recheck near-term funding sources (capital call, lot sale, or draw) because the entity is burning cash this period. Owner: Finance.`);
    }
  } else if (data.cashRunway.months != null) {
    lines.push(`Cash runway is approximately ${data.cashRunway.months.toFixed(1)} months at the current burn rate — no near-term funding gap identified.`);
  }

  if (data.overdueCapitalCalls.length > 0) {
    const total = data.overdueCapitalCalls.reduce((s, c) => s + c.amountDue, 0);
    lines.push(`${data.overdueCapitalCalls.length} capital call(s) are overdue, totaling ${fmtUsd(total)} across ${new Set(data.overdueCapitalCalls.map(c => c.partnerName)).size} partner(s).`);
    actions.push(`Action: Follow up on overdue capital calls (${fmtUsd(total)} outstanding) before relying on additional financing. Owner: Investor Relations.`);
  }

  if (lastPl && lastPl.netInc < 0) {
    lines.push(`Net income is negative for the current period (${fmtUsd(lastPl.netInc)}) — typical for a pre-revenue development entity during the holding/entitlement phase, not a standalone profitability concern.`);
  }

  const highRate = data.loanRows.filter(l => l.rate > 8.5).sort((a, b) => b.rate - a.rate)[0];
  if (highRate) {
    lines.push(`${highRate.bank} carries the highest rate on the loan register at ${highRate.rate.toFixed(2)}% (balance ${fmtUsd(highRate.balance)}).`);
    actions.push(`Action: Evaluate refinancing the ${highRate.bank} loan given its above-market rate. Owner: Finance.`);
  }

  if (!lines.length) {
    lines.push('Insufficient data to generate a strategy narrative for this period — upload P&L, Balance Sheet, and Loan Tracker data to enable Strategy & Recommendations.');
  }

  return {
    commentary: lines.join(' '),
    actions: actions.length
      ? actions
      : hasOperatingBurn
        ? ['Monitor cash burn and funding sources closely this period.']
        : ['No immediate action items — continue routine monitoring.'],
  };
}
