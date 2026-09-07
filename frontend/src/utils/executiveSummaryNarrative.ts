import type { LoanRow, PortfolioSummary } from '../hooks/useRentalCfoData';
import type { KpiData } from './rentalKpiEngine';
import type { RiskActionRow } from './executiveSummaryActionRules';
import { buildEmiStatusRows } from './executiveSummaryEmi';
import type { CeoBoardExportPayload } from './executiveSummaryPpt';
import type {
  ArDashboardSection,
  BalanceSheetSection,
  CashFlowSection,
  ExpensesSection,
  IncomeStatementSection,
  RentalPortfolioSection,
} from './executiveSummaryPptSections';

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function parseUsd(s: string | undefined): number | null {
  if (!s || /not available|data not/i.test(s)) return null;
  const n = Number(String(s).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n !== 0 ? n : (String(s).includes('$0') ? 0 : null);
}

function parsePct(s: string | undefined): number | null {
  if (!s || /not available|data not/i.test(s)) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export interface SlideNarratives {
  portfolioSnapshot: string;
  rentalPerformance: string;
  incomeStatement: string;
  balanceSheet: string;
  cashFlow: string;
  rentalPortfolio: string;
  expenses: string;
  arDashboard: string;
  loanPortfolio: string;
  debtRisk: string;
  ownership: string;
  /** @deprecated */
  financialPerformance: string;
  /** @deprecated */
  cashPosition: string;
  /** @deprecated */
  propertyProfitability: string;
  /** @deprecated */
  riskActionItems: string;
}

export function generateSlideNarratives(params: {
  payload: Pick<
    CeoBoardExportPayload,
    | 'portfolioSnapshot'
    | 'rentalPerformance'
    | 'financialPerformance'
    | 'cashPosition'
    | 'loanPortfolio'
    | 'debtRisk'
    | 'ownership'
    | 'propertyProfitability'
    | 'riskActionTable'
    | 'incomeStatement'
    | 'balanceSheet'
    | 'cashFlow'
    | 'rentalPortfolio'
    | 'expenses'
    | 'arDashboard'
  >;
  k: KpiData | null;
  kPrev: KpiData | null;
  loans: LoanRow[];
}): SlideNarratives {
  const { payload, k, kPrev, loans } = params;
  return {
    portfolioSnapshot: narratePortfolioSnapshot(payload.portfolioSnapshot),
    rentalPerformance: narrateRentalPerformance(payload.rentalPerformance),
    incomeStatement: narrateIncomeStatement(payload.incomeStatement, k, kPrev),
    balanceSheet: narrateBalanceSheet(payload.balanceSheet),
    cashFlow: narrateCashFlow(payload.cashFlow),
    rentalPortfolio: narrateRentalPortfolio(payload.rentalPortfolio),
    expenses: narrateExpenses(payload.expenses),
    arDashboard: narrateArDashboard(payload.arDashboard),
    loanPortfolio: narrateLoanPortfolio(payload.loanPortfolio),
    debtRisk: narrateDebtRisk(payload.debtRisk, loans),
    ownership: narrateOwnership(payload.ownership),
    financialPerformance: narrateFinancialPerformance(payload.financialPerformance, k, kPrev),
    cashPosition: narrateCashPosition(payload.cashPosition, k),
    propertyProfitability: narratePropertyProfitability(payload.propertyProfitability),
    riskActionItems: narrateRiskActionItems(payload.riskActionTable),
  };
}

export function generateActionPlanCommentary(rows: RiskActionRow[]): string {
  return narrateRiskActionItems(rows);
}

function narrateIncomeStatement(isec: IncomeStatementSection, k: KpiData | null, kPrev: KpiData | null): string {
  const parts: string[] = [];
  if (isec.available) {
    parts.push(`Latest period shows revenue of ${isec.latestRevenue}, expenses of ${isec.latestExpenses}, and NOI of ${isec.latestNoi} (P&L with interest add-back).`);
    if (k && kPrev && k.totalRevenue > 0 && kPrev.totalRevenue > 0) {
      const m = (k.noi / k.totalRevenue) * 100;
      const pm = (kPrev.noi / kPrev.totalRevenue) * 100;
      parts.push(`NOI margin moved to ${pct(m)} from ${pct(pm)} vs prior period.`);
    }
  } else {
    parts.push('Upload P&L on Rentals → Financials to populate income statement metrics.');
  }
  return parts.slice(0, 2).join(' ');
}

function narrateBalanceSheet(bs: BalanceSheetSection): string {
  if (!bs.available) return 'Balance sheet data not available — upload BS on Rentals → Financials.';
  const parts = [
    `Assets ${bs.totalAssets}, liabilities ${bs.totalLiabilities}, equity ${bs.equity}, cash ${bs.cashBalance}.`,
    `Leverage: D/E ${bs.debtToEquity}, D/A ${bs.debtToAsset} (debt numerator from Loan Tracker, not total liabilities).`,
  ];
  return parts.join(' ');
}

function narrateCashFlow(cf: CashFlowSection): string {
  if (!cf.available) return 'Cash flow not available — upload CF statement or AR/Loan Tracker for proxies.';
  return `Operating CF ${cf.operatingCf}, financing CF ${cf.financingCf}, investing ${cf.investingCf}. ${cf.sourceNote}`;
}

function narrateRentalPortfolio(rp: RentalPortfolioSection): string {
  const parts: string[] = [];
  if (rp.occupancy !== 'Data not available') {
    parts.push(`Occupancy ${rp.occupancy} with ${rp.collected} collected (${rp.collectionRate} collection rate).`);
  }
  if (rp.noiMargin !== 'Data not available — upload Financials P&L') {
    parts.push(`NOI margin ${rp.noiMargin} from Financials P&L — not rent-receivable derived.`);
  }
  if (parseUsd(rp.arOutstanding) != null && parseUsd(rp.arOutstanding)! > 0) {
    parts.push(`Outstanding AR ${rp.arOutstanding} warrants collection follow-up.`);
  }
  return parts.slice(0, 3).join(' ') || 'See Rentals → Rental Portfolio Overview.';
}

function narrateExpenses(ex: ExpensesSection): string {
  if (!ex.available) return 'Expense trend not available — see Rentals → Expenses.';
  const total = ex.trend6Mo.reduce((s, t) => s + t.amount, 0);
  const avg = ex.trend6Mo.length ? total / ex.trend6Mo.length : 0;
  return `Six-month expense window ending ${ex.trendEndLabel} averages ${fmtUsd(avg)} per month from P&L line detail.`;
}

function narrateArDashboard(ar: ArDashboardSection): string {
  if (!ar.available) return 'Upload QB AR Aging on Rentals → AR Dashboard for DSO and aging metrics.';
  const parts = [`DSO ${ar.dso}`, `30+ overdue ${ar.overdue30}`, `90+ overdue ${ar.overdue90}`];
  if (ar.creditBalance !== '$0') parts.push(`credit balance ${ar.creditBalance} excluded from DSO`);
  return parts.join(' · ') + '.';
}

function narratePortfolioSnapshot(ps: CeoBoardExportPayload['portfolioSnapshot']): string {
  const parts: string[] = [];
  const total = Number(ps.totalUnits);
  const occupied = Number(ps.occupiedUnits);
  const hasUnits = Number.isFinite(total) && total > 0;

  if (hasUnits) {
    const occ = (occupied / total) * 100;
    parts.push(
      `The portfolio comprises ${total} units at ${pct(occ)} physical occupancy (${occupied} leased), establishing the operating scale for this review.`,
    );
  } else {
    parts.push('Unit count is not yet established in Company Registry — loading registry data remains a priority to anchor portfolio oversight.');
  }

  const debt = parseUsd(ps.totalDebt);
  if (debt != null && debt > 0) {
    parts.push(
      `Outstanding loan exposure totals ${fmtUsd(debt)} across ${ps.loanCount} facilit${ps.loanCount === 1 ? 'y' : 'ies'}, framing the leverage context for asset-level decisions.`,
    );
  }

  if (hasUnits && ps.unitsByCompany.length > 1) {
    const sorted = [...ps.unitsByCompany].sort((a, b) => b.units - a.units);
    const top = sorted[0];
    const share = (top.units / total) * 100;
    if (share >= 35) {
      parts.push(
        `${top.name} represents ${pct(share)} of unit count, creating meaningful concentration that warrants dedicated leasing and capital attention.`,
      );
    }
  } else if (parseUsd(ps.marketValue) != null && parseUsd(ps.marketValue)! > 0) {
    parts.push(`Estimated portfolio value of ${ps.marketValue} (${ps.marketValueSource}) supports collateral and refinancing discussions this cycle.`);
  }

  return parts.slice(0, 3).join(' ');
}

function narrateRentalPerformance(rp: CeoBoardExportPayload['rentalPerformance']): string {
  const parts: string[] = [];
  const occ = parsePct(rp.occupancy);
  const vacLoss = parseUsd(rp.vacancyLoss);
  const collRate = parsePct(rp.collectionRate);
  const TARGET_OCC = 95;

  if (occ != null) {
    const gap = TARGET_OCC - occ;
    if (gap > 0) {
      parts.push(
        `Physical occupancy at ${pct(occ)} remains ${pct(gap)} below our ${TARGET_OCC}% operating target${vacLoss != null && vacLoss > 0 ? `, translating to roughly ${fmtUsd(vacLoss)} in vacancy loss this period` : ''}.`,
      );
    } else {
      parts.push(`Physical occupancy at ${pct(occ)} meets our ${TARGET_OCC}% operating target, supporting revenue stability heading into the quarter.`);
    }
  }

  if (collRate != null) {
    if (collRate < 95) {
      parts.push(
        `Collection rate of ${pct(collRate)} signals tenant payment discipline below target and warrants accelerated receivables follow-up.`,
      );
    } else {
      parts.push(`Collection rate of ${pct(collRate)} reflects solid tenant payment discipline and supports predictable cash conversion.`);
    }
  } else if (parseUsd(rp.collected) != null) {
    parts.push(`Collected rent of ${rp.collected} against ${rp.gpr} GPR defines the period's revenue capture profile.`);
  }

  const ar = parseUsd(rp.arOutstanding);
  if (ar != null && ar > 0 && parts.length < 3) {
    parts.push(`${fmtUsd(ar)} in outstanding receivables remains on the watch list for near-term collection action.`);
  }

  if (!parts.length) {
    return 'Rental operating metrics are not yet available from Company Registry — upload registry sync data to enable occupancy and collection commentary.';
  }
  return parts.slice(0, 3).join(' ');
}

function narrateFinancialPerformance(
  fp: CeoBoardExportPayload['financialPerformance'],
  k: KpiData | null,
  kPrev: KpiData | null,
): string {
  if (!fp.available || !k || k.totalRevenue <= 0) {
    return 'P&L financials are not loaded for this period — upload company financials to enable margin and waterfall commentary for the board.';
  }

  const parts: string[] = [];
  const noiM = (k.noi / k.totalRevenue) * 100;
  const netM = (k.netIncome / k.totalRevenue) * 100;

  let marginLead = `NOI Margin stands at ${pct(noiM)}`;
  if (kPrev && kPrev.totalRevenue > 0) {
    const prevNoiM = (kPrev.noi / kPrev.totalRevenue) * 100;
    const delta = noiM - prevNoiM;
    if (Math.abs(delta) >= 0.3) {
      marginLead += `, ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} points vs prior period`;
    }
  }
  marginLead += ', reflecting the net revenue-to-expense outcome in uploaded P&L.';
  parts.push(marginLead);

  const revShare = k.rentalIncome / k.totalRevenue;
  const expRatio = (k.totalExpenses / k.totalRevenue) * 100;
  if (revShare > 0.7) {
    parts.push(
      `Revenue is predominantly rental-driven (${pct(revShare * 100)} of total income), with operating expenses at ${pct(expRatio)} of revenue — the primary levers on margin expansion.`,
    );
  } else if (expRatio > 0) {
    parts.push(
      `Operating expenses at ${pct(expRatio)} of revenue remain the dominant margin variable alongside revenue mix in the P&L waterfall.`,
    );
  }

  if (k.interestExpense > 0) {
    const intPct = (k.interestExpense / k.totalRevenue) * 100;
    const noiToNet = noiM - netM;
    if (noiToNet > 1) {
      parts.push(
        `Interest expense (${pct(intPct)} of revenue) compresses Net Income Margin to ${pct(netM)}, a ${pct(noiToNet)} gap that refinancing or NOI improvement can address.`,
      );
    } else {
      parts.push(`Net Income Margin of ${pct(netM)} reflects interest and below-the-line items relative to ${pct(noiM)} NOI Margin.`);
    }
  }

  return parts.slice(0, 3).join(' ');
}

function narrateCashPosition(
  cp: CeoBoardExportPayload['cashPosition'],
  k: KpiData | null,
): string {
  const parts: string[] = [];
  const cash = k?.cash ?? parseUsd(cp.balance);

  if (cash != null && cash > 0) {
    parts.push(`Cash balance of ${cp.balance} provides the liquidity anchor for near-term obligations and opportunistic capital deployment.`);
    if (cp.runwayNote && !/not calculable|not available/i.test(cp.runwayNote)) {
      parts.push(cp.runwayNote.replace(/^Cash covers/, 'This balance covers').replace(/\.$/, ', offering a measurable cushion against debt service pressure.'));
    }
  } else {
    parts.push('Cash balance is not available on the uploaded balance sheet — treasury visibility requires a current BS upload.');
  }

  if (cp.trend.length >= 2) {
    const first = cp.trend[0].cash;
    const last = cp.trend[cp.trend.length - 1].cash;
    if (first > 0 && last !== first) {
      const dir = last > first ? 'improved' : 'declined';
      const chg = Math.abs(((last - first) / first) * 100);
      parts.push(
        `Cash has ${dir} ${chg.toFixed(0)}% over the ${cp.trend.length}-month trend, ${dir === 'improved' ? 'strengthening' : 'tightening'} liquidity heading into the coming quarter.`,
      );
    }
  } else if (k && k.totalExpenses > 0 && cash != null && cash > 0) {
    const moOpex = k.totalExpenses / 12;
    if (moOpex > 0) {
      const months = cash / moOpex;
      parts.push(`At current expense run-rate, cash approximates ${months.toFixed(1)} months of operating coverage — a key board liquidity reference.`);
    }
  }

  return parts.slice(0, 3).join(' ') || 'Cash position data is limited for this period.';
}

function narrateLoanPortfolio(lp: CeoBoardExportPayload['loanPortfolio']): string {
  if (!lp.available) {
    return 'Loan portfolio data is not loaded — upload Loan Tracker records to enable debt exposure and EMI status commentary.';
  }

  const parts: string[] = [];
  parts.push(
    `Total debt exposure of ${lp.totalDebt} across ${lp.loanCount} loan${lp.loanCount === '1' ? '' : 's'} frames the portfolio's refinancing and covenant management priorities.`,
  );

  const overdue = lp.emiRows.filter(e => e.isOverdue || /overdue/i.test(e.paymentStatus));
  const due = lp.emiRows.filter(e => !e.isOverdue && /due/i.test(e.paymentStatus));
  if (overdue.length > 0) {
    parts.push(
      `${overdue.length} EMI obligation${overdue.length === 1 ? '' : 's'} flagged Overdue on the calendar schedule — treasury confirmation is required; actual bank payment confirmation is not tracked in Loan Tracker.`,
    );
  } else if (due.length > 0) {
    parts.push(
      `${due.length} EMI${due.length === 1 ? '' : 's'} due this cycle on calendar schedule; no Overdue flags at generation time (payment confirmation not tracked in-system).`,
    );
  }

  const dscr = parseFloat(lp.portfolioDscr);
  if (Number.isFinite(dscr) && dscr > 0) {
    if (dscr < 1.2) {
      parts.push(`Portfolio DSCR of ${lp.portfolioDscr} sits below the 1.2× covenant reference and warrants refinancing or NOI improvement discussion.`);
    } else {
      parts.push(`Portfolio DSCR of ${lp.portfolioDscr} remains within covenant headroom, though property-level dispersion should be monitored.`);
    }
  }

  return parts.slice(0, 3).join(' ');
}

function narrateDebtRisk(
  dr: CeoBoardExportPayload['debtRisk'],
  loans: LoanRow[],
): string {
  if (!dr.available) {
    return 'Debt risk analytics require Loan Tracker balances and property values — upload loan data to enable DSCR and maturity commentary.';
  }

  const parts: string[] = [];
  const belowCovenant = dr.dscrByProperty.filter(d => d.dscr > 0 && d.dscr < 1.2);
  if (belowCovenant.length > 0) {
    const names = belowCovenant.slice(0, 2).map(d => d.name).join(', ');
    parts.push(
      `${belowCovenant.length} propert${belowCovenant.length === 1 ? 'y' : 'ies'} (${names}${belowCovenant.length > 2 ? ', …' : ''}) sit below the 1.2× DSCR covenant — each warrants advance refinancing or NOI remediation planning.`,
    );
  } else if (dr.dscrByProperty.length > 0) {
    parts.push('Property-level DSCR profiles are at or above the 1.2× covenant reference on current loan data, though individual dispersion merits monitoring.');
  }

  const nearTerm = dr.maturityBuckets.find(b => /≤12|12 mo/i.test(b.label));
  if (nearTerm && nearTerm.amount > 0) {
    parts.push(
      `${fmtUsd(nearTerm.amount)} across ${nearTerm.count} loan${nearTerm.count === 1 ? '' : 's'} matures within 12 months — refinancing outreach should begin now to preserve optionality.`,
    );
  } else {
    const now = new Date();
    const in12 = new Date(now);
    in12.setMonth(in12.getMonth() + 12);
    const maturing = loans.filter(l => l.loan_maturity_date && new Date(l.loan_maturity_date) <= in12);
    if (maturing.length > 0) {
      const bal = maturing.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);
      parts.push(`${maturing.length} facilities (${fmtUsd(bal)}) mature within 12 months and require proactive refinancing planning.`);
    }
  }

  const highLtv = dr.ltvByProperty.filter(l => l.ltv > 75);
  if (highLtv.length > 0 && parts.length < 3) {
    parts.push(`${highLtv.length} asset${highLtv.length === 1 ? '' : 's'} exceed${highLtv.length === 1 ? 's' : ''} 75% LTV, elevating lender risk and narrowing refinancing flexibility.`);
  }

  return parts.slice(0, 3).join(' ') || 'Debt risk metrics are loaded; no covenant breaches flagged on current data.';
}

function narrateOwnership(ow: CeoBoardExportPayload['ownership']): string {
  if (!ow.available) {
    return 'Ownership data is not uploaded — add partner holdings on Rentals → Ownership to enable capital base and ROI commentary.';
  }

  const parts: string[] = [];
  parts.push(
    `The capital base comprises ${ow.totalPartners} partner${ow.totalPartners === '1' ? '' : 's'} with ${ow.totalCapital} contributed and ${ow.totalEquity} in reported equity — the foundation for return attribution this period.`,
  );

  const avgRoi = parsePct(ow.avgRoi);
  if (avgRoi != null) {
    parts.push(
      `Weighted average partner ROI of ${ow.avgRoi} ${avgRoi >= 8 ? 'reflects acceptable return on contributed capital' : 'sits below typical target returns and merits portfolio performance review'}.`,
    );
  }

  if (ow.partnerSlices.length > 0) {
    const total = ow.partnerSlices.reduce((s, p) => s + p.value, 0);
    const top = [...ow.partnerSlices].sort((a, b) => b.value - a.value)[0];
    if (total > 0 && top) {
      const share = (top.value / total) * 100;
      if (share >= 30) {
        parts.push(`${top.name} holds ${pct(share)} of equity concentration — the largest single-partner exposure in the ownership structure.`);
      }
    }
  }

  return parts.slice(0, 3).join(' ');
}

function narratePropertyProfitability(
  pp: CeoBoardExportPayload['propertyProfitability'],
): string {
  if (!pp.available || !pp.rows.length) {
    return 'Per-property profitability requires Company Registry and financial linkage — upload ownership and financials to rank NOI contributors.';
  }

  const ranked = [...pp.rows]
    .map(r => ({
      name: r.property,
      noi: r.noiDollars ?? 0,
      margin: r.noiMarginPct,
      occ: r.occupancyPct,
      flagged: r.flagged,
    }))
    .sort((a, b) => (b.noi || b.margin || 0) - (a.noi || a.margin || 0));

  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  const parts: string[] = [];

  if (top) {
    const topDesc = top.noi > 0
      ? `${top.name} leads NOI contribution at ${fmtUsd(top.noi)}`
      : `${top.name} leads on NOI margin at ${top.margin != null ? pct(top.margin) : '—'}`;
    parts.push(`${topDesc}, anchoring portfolio earnings this period.`);
  }

  if (bottom && bottom.name !== top?.name) {
    let weak = `${bottom.name} is the weakest performer`;
    if (bottom.margin != null && bottom.margin < 15) {
      weak += ` at ${pct(bottom.margin)} NOI margin, suggesting expense structure pressure`;
    }
    if (bottom.occ != null && bottom.occ < 85) {
      weak += bottom.margin != null && bottom.margin < 15 ? ' compounded by sub-85% occupancy' : ` with occupancy at ${pct(bottom.occ)}`;
    }
    weak += ' — targeted operational review is warranted.';
    parts.push(weak);
  }

  const flagged = pp.rows.filter(r => r.flagged);
  if (flagged.length > 0) {
    parts.push(`${flagged.length} propert${flagged.length === 1 ? 'y' : 'ies'} flagged on margin, DSCR, or arrears thresholds — see detail table below for board action.`);
  }

  return parts.slice(0, 3).join(' ');
}

function narrateRiskActionItems(rows: RiskActionRow[]): string {
  if (!rows.length) {
    return 'No critical risk flags triggered portfolio rules this period — leadership focus can remain on proactive leasing, collection, and refinancing discipline.';
  }

  const parts: string[] = [];
  const critical = rows.filter(r => r.severity === 'critical');
  const warning = rows.filter(r => r.severity === 'warning');
  const issues = new Set(rows.map(r => r.issue.split('—')[0].trim()));

  parts.push(
    `${rows.length} action item${rows.length === 1 ? '' : 's'} require leadership decision this period${critical.length > 0 ? `, including ${critical.length} critical` : ''}${warning.length > 0 ? ` and ${warning.length} warning-level` : ''} flags.`,
  );

  if (issues.size <= 4) {
    parts.push(`Primary risk categories: ${[...issues].slice(0, 4).join('; ')} — each tied to a named owner and due date in the table below.`);
  } else {
    parts.push(`Risk spread spans ${issues.size} issue categories — prioritize critical items for board resolution this cycle.`);
  }

  if (critical.length > 0) {
    const sample = critical.slice(0, 2).map(r => r.property).join(', ');
    parts.push(`Critical attention: ${sample}${critical.length > 2 ? ', and others' : ''} — deferral increases covenant and cash-flow exposure.`);
  }

  return parts.slice(0, 3).join(' ');
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
  incomeStatement?: IncomeStatementSection;
  rentalPortfolio?: RentalPortfolioSection;
  arDashboard?: ArDashboardSection;
  debtRisk?: CeoBoardExportPayload['debtRisk'];
}): string[] {
  const {
    riskRows, loans, portfolio, collectionRate, arOverdue90, k,
    incomeStatement, rentalPortfolio, arDashboard, debtRisk,
  } = params;
  const bullets: string[] = [];
  const critical = riskRows.filter(r => r.severity === 'critical');

  const lowDscr = loans.filter(l => {
    const d = l.dscr ?? (l.noi_annual && l.loan_emi ? (l.noi_annual / 12) / l.loan_emi : null);
    return d != null && d < 1.2;
  });
  if (lowDscr.length > 0) {
    const names = lowDscr.slice(0, 2).map(l => (l.property_name || l.company_name).split(' ')[0]).join(', ');
    const worst = Math.min(...lowDscr.map(l => l.dscr ?? 99));
    bullets.push(
      `Refinance or raise NOI on ${lowDscr.length} propert${lowDscr.length === 1 ? 'y' : 'ies'} (${names}${lowDscr.length > 2 ? ', …' : ''}) — DSCR as low as ${worst.toFixed(2)}× vs 1.2× covenant.`,
    );
  }

  if (portfolio && portfolio.occupancy_pct * 100 < 95) {
    const vac = portfolio.vacant_units;
    const occ = portfolio.occupancy_pct * 100;
    bullets.push(
      `Lease-up ${vac} vacant unit${vac !== 1 ? 's' : ''} — occupancy ${pct(occ)} vs 95% target; vacancy loss on Rental Portfolio slide drives revenue gap.`,
    );
  }

  if (collectionRate > 0 && collectionRate < 95) {
    bullets.push(
      `Accelerate collections — rate ${pct(collectionRate)} vs 95% target${arOverdue90 > 0 ? `; AR Dashboard shows ${fmtUsd(arOverdue90)} in 90+ day balances` : ''}.`,
    );
  } else if (arOverdue90 > 0) {
    bullets.push(
      `AR Dashboard: ${fmtUsd(arOverdue90)} in 90+ day arrears (credit balances excluded) — assign owner follow-up this cycle.`,
    );
  }

  if (rentalPortfolio?.noiMargin && parsePct(rentalPortfolio.noiMargin) != null && parsePct(rentalPortfolio.noiMargin)! < 20) {
    bullets.push(
      `NOI margin ${rentalPortfolio.noiMargin} (Financials P&L) is below 20% target — align operating expense review with Expenses slide trend.`,
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
    bullets.push(`Income Statement NOI margin ${pct((k.noi / k.totalRevenue) * 100)} below 20% — expense lines on Expenses slide warrant board review.`);
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
    const top = critical[0];
    bullets.push(
      `Immediate priority: ${top.property} — ${top.issue} (${top.kpi}); ${critical.length} critical item${critical.length !== 1 ? 's' : ''} on Action Plan slide.`,
    );
  }

  if (debtRisk?.maturityBuckets?.some(b => b.label === '≤12 mo' && b.count > 0) && bullets.length < 5) {
    const b = debtRisk.maturityBuckets.find(x => x.label === '≤12 mo')!;
    bullets.push(`Debt Risk slide: ${fmtUsd(b.amount)} across ${b.count} loan${b.count !== 1 ? 's' : ''} maturing ≤12 months — initiate refinance planning.`);
  }

  if (!bullets.length) {
    bullets.push('Portfolio metrics are within target ranges — maintain current leasing, collection, and debt service discipline.');
    bullets.push('Continue monthly financial close and QB aging uploads to preserve board-ready reporting.');
  }

  return bullets.slice(0, 5);
}

/**
 * Ported from the EstateCFO reference app — section-level Strategy & Recommendations
 * for PDF exports (Property Dev / Consultancy section export). Additive only; no
 * existing narrative function above this point is touched.
 */
export interface SectionStrategyPlan {
  commentary: string;
  actions: string[];
}

const TARGET_OCC = 95;
const TARGET_COLL = 95;

function sectionActionFromText(text: string): string {
  const m = text.match(/Action:\s*(.+?)\s*Owner:/i);
  return m ? m[1].trim() : text;
}

/** Section-level Strategy & Recommendations for polished PDF exports. */
export function generateSectionStrategyPlan(
  sectionId: string,
  params: {
    payload: Pick<
      CeoBoardExportPayload,
      | 'rentalPortfolio'
      | 'rentalPerformance'
      | 'expenses'
      | 'arDashboard'
      | 'incomeStatement'
      | 'balanceSheet'
      | 'cashFlow'
      | 'ownership'
      | 'loanPortfolio'
      | 'debtRisk'
      | 'portfolioSnapshot'
    >;
    slideNarratives: SlideNarratives;
    strategicRecommendations: string[];
    collectionRate: number;
    portfolio: PortfolioSummary | null;
    vacantUnits?: number;
  },
): SectionStrategyPlan {
  const {
    payload, slideNarratives, strategicRecommendations, collectionRate, portfolio, vacantUnits,
  } = params;
  const rp = payload.rentalPortfolio;
  const perf = payload.rentalPerformance;
  const actions: string[] = [];

  if (sectionId === 'overview' || sectionId === 'vacancy' || sectionId === 'units') {
    const occ = parsePct(perf.occupancy) ?? parsePct(rp.occupancy);
    const coll = parsePct(perf.collectionRate) ?? parsePct(rp.collectionRate);
    const vacLoss = perf.vacancyLoss ?? rp.vacancyLoss;
    const vac = vacantUnits ?? portfolio?.vacant_units ?? 0;
    const parts: string[] = [];

    if (occ != null) {
      const gap = TARGET_OCC - occ;
      if (gap > 0) {
        parts.push(
          `Occupancy at ${pct(occ)} remains ${pct(gap)} below our ${TARGET_OCC}% operating target, leaving ${vacLoss} in vacancy loss this period.`,
        );
        if (vac > 0) {
          actions.push(`Prioritize lease-up on the ${vac} vacant unit${vac !== 1 ? 's' : ''} highlighted in the chart above.`);
        }
      } else {
        parts.push(`Physical occupancy at ${pct(occ)} meets the ${TARGET_OCC}% operating target, supporting revenue stability.`);
      }
    }

    if (coll != null) {
      if (coll < TARGET_COLL) {
        parts.push(
          `Collection rate of ${pct(coll)} falls short of the typical ${TARGET_COLL}%+ target — review AR aging for units driving this gap before addressing pricing.`,
        );
        actions.push('Assign AR owner to clear 30+ day balances within 30 days.');
      } else {
        parts.push(`Collection rate of ${pct(coll)} reflects solid tenant payment discipline.`);
      }
    }

    const ar = parseUsd(perf.arOutstanding) ?? parseUsd(rp.arOutstanding);
    if (ar != null && ar > 0 && parts.length < 3) {
      parts.push(`${fmtUsd(ar)} in outstanding receivables warrants near-term collection follow-up.`);
    }

    if (!parts.length) {
      parts.push(slideNarratives.rentalPortfolio || slideNarratives.rentalPerformance);
    }

    if (!actions.length) {
      const occOk = occ != null && occ >= TARGET_OCC;
      const collOk = coll != null && coll >= TARGET_COLL;
      if (occOk && collOk) {
        actions.push('Portfolio operating metrics are on track — maintain leasing velocity and collection discipline.');
        actions.push('Shift focus to renewal rent optimization on stabilized units.');
      } else {
        strategicRecommendations
          .filter(b => /OCCUPANCY|COLLECTIONS/i.test(b))
          .slice(0, 2)
          .forEach(b => actions.push(sectionActionFromText(b)));
      }
    }

    return { commentary: parts.slice(0, 3).join(' '), actions: actions.slice(0, 4) };
  }

  if (sectionId === 'expenses') {
    const commentary = slideNarratives.expenses;
    strategicRecommendations
      .filter(b => /PROFITABILITY|EXPENSE/i.test(b))
      .slice(0, 2)
      .forEach(b => actions.push(sectionActionFromText(b)));
    if (!actions.length && payload.expenses.available) {
      actions.push('Hold OPEX flat-to-down vs revenue; reinvest only where NOI uplift is underwritten.');
    }
    if (!actions.length) {
      actions.push('Upload P&L expense detail on Rentals → Expenses to enable category-level action items.');
    }
    return { commentary, actions: actions.slice(0, 4) };
  }

  if (sectionId === 'ar-dashboard') {
    const commentary = slideNarratives.arDashboard;
    if (collectionRate > 0 && collectionRate < TARGET_COLL) {
      actions.push(`Accelerate collections — portfolio rate ${pct(collectionRate)} vs ${TARGET_COLL}% target.`);
    }
    const od90 = parseUsd(payload.arDashboard.overdue90);
    if (od90 != null && od90 > 0) {
      actions.push(`Clear ${payload.arDashboard.overdue90} in 90+ day AR before approving rent increases.`);
    }
    strategicRecommendations
      .filter(b => /COLLECTIONS|RISK/i.test(b))
      .slice(0, 2)
      .forEach(b => actions.push(sectionActionFromText(b)));
    if (!actions.length && payload.arDashboard.available) {
      actions.push('AR aging is within normal ranges — maintain monthly QB aging uploads.');
    }
    return { commentary, actions: actions.slice(0, 4) };
  }

  if (sectionId === 'financials') {
    const commentary = slideNarratives.incomeStatement;
    strategicRecommendations
      .filter(b => /PROFITABILITY/i.test(b))
      .slice(0, 3)
      .forEach(b => actions.push(sectionActionFromText(b)));
    if (!actions.length) {
      actions.push('Validate margin trend vs prior period before approving capex this quarter.');
    }
    return { commentary, actions: actions.slice(0, 4) };
  }

  if (sectionId === 'ownership') {
    return {
      commentary: slideNarratives.ownership,
      actions: strategicRecommendations.filter(b => /OWNERSHIP/i.test(b)).map(sectionActionFromText).slice(0, 4),
    };
  }

  if (sectionId === 'loan-tracker') {
    return {
      commentary: slideNarratives.loanPortfolio,
      actions: strategicRecommendations.filter(b => /LEVERAGE|DEBT|RISK/i.test(b)).map(sectionActionFromText).slice(0, 4),
    };
  }

  if (sectionId === 'financial-ratios') {
    const parts = [
      slideNarratives.balanceSheet,
      payload.incomeStatement.available ? `NOI margin ${payload.incomeStatement.noiMargin}.` : '',
    ].filter(Boolean);
    return {
      commentary: parts.slice(0, 2).join(' '),
      actions: strategicRecommendations.filter(b => /LEVERAGE|PROFITABILITY/i.test(b)).map(sectionActionFromText).slice(0, 4),
    };
  }

  const narrativeKey = sectionId as keyof SlideNarratives;
  const commentary = (slideNarratives[narrativeKey] as string | undefined)
    ?? 'Section metrics loaded from live dashboard data.';
  if (!actions.length) {
    actions.push('Continue monthly data uploads to preserve board-ready reporting.');
  }
  return { commentary, actions: actions.slice(0, 4) };
}
