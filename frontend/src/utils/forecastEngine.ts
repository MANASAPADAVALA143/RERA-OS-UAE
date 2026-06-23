// forecastEngine.ts — EstateCFO provisional P&L forecasting engine

export interface ForecastInputs {
  // Lots
  totalLots: number;
  soldLots: number;           // status === 'sold' | 'contracted'
  actualRevenue: number;      // sum of salePrice for sold/contracted lots
  avgListPrice: number;       // avg listPrice across all lots (used as provisional per-lot price)
  lotPriceOverride?: number;  // slider override — replaces avgListPrice for unsold lots

  // Costs (actuals for sold lots; budget for unsold)
  landCost: number;
  hardCost: number;
  softCost: number;
  titleCharges: number;
  otherCharges: number;
  propertyTax: number;
  loanProcessing: number;
  professionalCharges: number;
  legalFees: number;
  interestOnLoan: number;
  managementFeeRate: number;  // e.g. 0.09
  commissionRate: number;     // e.g. 0.03
  commission?: number | null; // explicit amount if set

  // Partners
  partners: Array<{
    name: string;
    sharePercent: number;
    capitalContributed: number;
    distributionsReceived: number;
    preferredReturn: number; // annual %, e.g. 8
  }>;

  // Loans
  loans: Array<{ balance: number; interestRate: number }>;
}

export interface WaterfallStep {
  step: string;
  totalAmount: number;
  partners: Array<{ name: string; amount: number; cumulative: number }>;
}

export interface ForecastResult {
  // Revenue
  actualRevenue: number;
  provisionalRevenue: number;
  totalRevenue: number;
  perLotRevenue: number;
  remainingLots: number;

  // Costs
  totalCosts: number;
  costBreakdown: Record<string, number>;
  managementFee: number;
  commissionAmount: number;

  // Interest
  annualInterest: number;

  // Profit
  netProfit: number;
  grossMarginPct: number;
  perLotProfit: number;

  // Completion-weighted costs (budget × remaining%)
  completionPct: number;
  weightedCosts: Record<string, number>;

  // Partner waterfall
  waterfallSteps: WaterfallStep[];
  partnerNetDistributions: Array<{ name: string; net: number; roiPct: number }>;

  // Break-even
  breakEvenLots: number;           // lots needed to break even
  breakEvenRevenuePerLot: number;  // price/lot to break even with current count
  breakEvenTotalRevenue: number;   // total revenue at break-even

  // Sales velocity (months to sell all at current pace)
  salesVelocityMonthsToComplete: number;
}

export function runForecast(inp: ForecastInputs): ForecastResult {
  // ── Step 1: Revenue ──────────────────────────────────────────────────────────
  const remainingLots = inp.totalLots - inp.soldLots;
  const provPricePerLot = inp.lotPriceOverride ?? inp.avgListPrice;
  const provisionalRevenue = remainingLots * provPricePerLot;
  const totalRevenue = inp.actualRevenue + provisionalRevenue;
  const perLotRevenue = inp.totalLots > 0 ? totalRevenue / inp.totalLots : 0;

  // ── Step 2: Completion % ────────────────────────────────────────────────────
  const completionPct = inp.totalLots > 0 ? inp.soldLots / inp.totalLots : 0;

  // ── Step 3: Costs (completion-weighted) ────────────────────────────────────
  // For each budget cost: actual portion = cost × completionPct (already incurred)
  // provisional portion = cost × (1 - completionPct) (still to be incurred)
  // Total = full budget amount regardless — weighted by how much sold
  const costKeys = [
    'hardCost', 'softCost', 'titleCharges', 'otherCharges',
    'propertyTax', 'loanProcessing', 'professionalCharges',
    'legalFees', 'interestOnLoan',
  ] as const;

  const weightedCosts: Record<string, number> = {};
  let devExpenseTotal = 0;
  for (const k of costKeys) {
    const v = inp[k] as number;
    // Scale to full project (budget may be partial); use as-is
    weightedCosts[k] = v;
    devExpenseTotal += v;
  }

  // ── Step 4: Management fee & commission ────────────────────────────────────
  const managementFee = inp.landCost * inp.managementFeeRate;
  const commissionAmount = inp.commission != null
    ? inp.commission
    : totalRevenue * inp.commissionRate;

  // ── Step 5: Total costs & net profit ───────────────────────────────────────
  const totalCosts = inp.landCost + devExpenseTotal + managementFee + commissionAmount;
  const netProfit = totalRevenue - totalCosts;
  const grossMarginPct = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const perLotProfit = inp.totalLots > 0 ? netProfit / inp.totalLots : 0;

  const costBreakdown: Record<string, number> = {
    landCost: inp.landCost,
    ...weightedCosts,
    managementFee,
    commissionAmount,
  };

  // ── Step 6: Interest (annual on outstanding loan balances) ─────────────────
  const annualInterest = inp.loans.reduce(
    (s, l) => s + l.balance * (l.interestRate / 100),
    0
  );

  // ── Step 7: Partner waterfall ──────────────────────────────────────────────
  // Available pool = netProfit (if positive)
  let pool = Math.max(0, netProfit);
  const waterfallSteps: WaterfallStep[] = [];
  const cumulative: Record<string, number> = {};
  inp.partners.forEach(p => { cumulative[p.name] = 0; });

  // Step 7a: Return of capital
  const capitalStep: WaterfallStep = {
    step: 'Return of Capital',
    totalAmount: 0,
    partners: [],
  };
  for (const p of inp.partners) {
    const outstanding = Math.max(0, p.capitalContributed - p.distributionsReceived);
    const paid = Math.min(outstanding, pool);
    pool -= paid;
    cumulative[p.name] += paid;
    capitalStep.partners.push({ name: p.name, amount: paid, cumulative: cumulative[p.name] });
    capitalStep.totalAmount += paid;
  }
  waterfallSteps.push(capitalStep);

  // Step 7b: Preferred return (annual % on contributed capital)
  const prefStep: WaterfallStep = {
    step: 'Preferred Return',
    totalAmount: 0,
    partners: [],
  };
  for (const p of inp.partners) {
    const prefTotal = p.capitalContributed * (p.preferredReturn / 100);
    const alreadyPaid = Math.max(0, p.distributionsReceived - p.capitalContributed);
    const prefDue = Math.max(0, prefTotal - alreadyPaid);
    const paid = Math.min(prefDue, pool);
    pool -= paid;
    cumulative[p.name] += paid;
    prefStep.partners.push({ name: p.name, amount: paid, cumulative: cumulative[p.name] });
    prefStep.totalAmount += paid;
  }
  waterfallSteps.push(prefStep);

  // Step 7c: Equity split (by sharePercent)
  const equityStep: WaterfallStep = {
    step: 'Equity Split',
    totalAmount: pool,
    partners: [],
  };
  const totalPct = inp.partners.reduce((s, p) => s + p.sharePercent, 0) || 100;
  for (const p of inp.partners) {
    const share = pool * (p.sharePercent / totalPct);
    cumulative[p.name] += share;
    equityStep.partners.push({ name: p.name, amount: share, cumulative: cumulative[p.name] });
  }
  waterfallSteps.push(equityStep);

  // Net distributions
  const partnerNetDistributions = inp.partners.map(p => {
    const net = cumulative[p.name];
    const roiPct = p.capitalContributed > 0
      ? ((net / p.capitalContributed) * 100)
      : 0;
    return { name: p.name, net, roiPct };
  });

  // ── Step 8: Break-even ────────────────────────────────────────────────────
  // Fixed costs per lot (land + management fee portion + weighted dev costs)
  const fixedCosts = totalCosts - commissionAmount; // commission is variable
  const commRateEff = totalRevenue > 0 ? commissionAmount / totalRevenue : inp.commissionRate;
  // Break-even revenue: R - commRateEff×R - fixedCosts = 0 → R = fixedCosts / (1 - commRateEff)
  const breakEvenTotalRevenue = (1 - commRateEff) > 0
    ? fixedCosts / (1 - commRateEff)
    : fixedCosts;
  const breakEvenRevenuePerLot = inp.totalLots > 0
    ? breakEvenTotalRevenue / inp.totalLots
    : 0;
  const breakEvenLots = provPricePerLot > 0
    ? Math.ceil(breakEvenTotalRevenue / provPricePerLot)
    : inp.totalLots;

  // Sales velocity: months to clear remaining lots
  // Assume current pace = soldLots sold over 6 months (placeholder; adjust if timeline known)
  const soldPerMonth = inp.soldLots > 0 ? inp.soldLots / 6 : 1;
  const salesVelocityMonthsToComplete = remainingLots > 0
    ? remainingLots / soldPerMonth
    : 0;

  return {
    actualRevenue: inp.actualRevenue,
    provisionalRevenue,
    totalRevenue,
    perLotRevenue,
    remainingLots,

    totalCosts,
    costBreakdown,
    managementFee,
    commissionAmount,

    annualInterest,

    netProfit,
    grossMarginPct,
    perLotProfit,

    completionPct,
    weightedCosts,

    waterfallSteps,
    partnerNetDistributions,

    breakEvenLots,
    breakEvenRevenuePerLot,
    breakEvenTotalRevenue,

    salesVelocityMonthsToComplete,
  };
}
