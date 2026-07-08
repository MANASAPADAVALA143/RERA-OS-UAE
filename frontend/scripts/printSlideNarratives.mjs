/** Print sample slide narratives for verification. Run: node scripts/printSlideNarratives.mjs */
import { generateSlideNarratives } from '../src/utils/executiveSummaryNarrative.ts';

const payload = {
  portfolioSnapshot: {
    totalUnits: '133', occupiedUnits: '106', vacantUnits: 27,
    marketValue: '$12,400,000', marketValueSource: 'From GPR cap rate',
    totalDebt: '$3,336,447', loanCount: 4,
    unitsByCompany: [
      { name: 'North', units: 40 }, { name: 'South', units: 35 },
      { name: 'East', units: 30 }, { name: 'West', units: 28 },
    ],
    assetComposition: [], debtComposition: [],
  },
  rentalPerformance: {
    occupancy: '79.7%', gpr: '$180,000', collected: '$155,000', vacancyLoss: '$25,000',
    collectionRate: '86.1%', arOutstanding: '$42,000',
    gprTrend: [{ month: 'Aug', gpr: 180000, collected: 155000, occupancy: 79.7 }],
  },
  financialPerformance: {
    available: true,
    profitability: [],
    waterfall: [],
    trend: [],
    noi: '$55,000',
    sourceNote: 'From Financials P&L',
  },
  cashPosition: {
    balance: '$220,000',
    trend: [
      { month: 'Mar', cash: 180000 }, { month: 'Aug', cash: 220000 },
    ],
    runwayNote: 'Cash covers ~6 months of loan EMI at current balance.',
  },
  loanPortfolio: {
    available: true,
    summary: [],
    totalDebt: '$3,336,447', loanCount: '4',
    portfolioDscr: '1.12x', interestCoverage: '1.62x',
    emiRows: [{
      loanName: 'West LLC', lender: 'GPB', outstanding: '$900,000', emiAmount: '$6,200',
      emiDueDate: 'Aug 5, 2026', paymentStatus: 'Overdue', interestRate: '6.25%',
      maturityDate: 'Mar 2029', isOverdue: true,
    }],
    emiDisclaimer: 'Disclaimer',
    worstDscr: [],
  },
  debtRisk: {
    available: true,
    dscrByProperty: [
      { name: 'North', dscr: 1.05 }, { name: 'West', dscr: 0.95 },
    ],
    ltvByProperty: [{ name: 'West', ltv: 82 }],
    maturityBuckets: [{ label: '≤12 mo', amount: 640000, count: 1 }],
  },
  ownership: {
    available: true,
    totalPartners: '3', totalCapital: '$4,000,000', totalEquity: '$9,000,000', avgRoi: '18.5%',
    partnerSlices: [
      { name: 'Alice', value: 4_000_000 }, { name: 'Bob', value: 3_000_000 },
    ],
    roiByPartner: [{ name: 'Alice', roi: 22 }],
  },
  propertyProfitability: {
    available: true,
    rows: [
      { property: 'South', occupancy: '91%', noiMargin: '32%', dscr: '1.40x', arrears: '$0', flagged: false, occupancyPct: 91, noiMarginPct: 32, noiDollars: 18000 },
      { property: 'West', occupancy: '70%', noiMargin: '12%', dscr: '0.95x', arrears: '$8,000', flagged: true, occupancyPct: 70, noiMarginPct: 12, noiDollars: 8000 },
    ],
  },
  riskActionTable: [
    { property: 'West', issue: 'Low DSCR', kpi: '0.95x', impact: 'Covenant breach risk', owner: 'CFO', dueDate: 'Sep 15', severity: 'critical' },
    { property: 'North', issue: 'High LTV', kpi: '78%', impact: 'Refinance pressure', owner: 'Asset Mgr', dueDate: 'Oct 1', severity: 'warning' },
  ],
};

const k = {
  totalRevenue: 180000, totalExpenses: 100000, netIncome: 37000, noi: 55000,
  rentalIncome: 155000, otherIncome: 25000, interestExpense: 18000,
  propertyTax: 0, managementFee: 0, hoaFees: 0, legalFees: 0, utilities: 0, repairs: 0,
  totalAssets: 0, totalLiabilities: 0, equity: 0, cash: 220000, buildings: 0,
  accumDep: 0, longTermLoans: 0, securityDeposits: 0,
};
const kPrev = { ...k, noi: 44640, totalRevenue: 170000 };

const n = generateSlideNarratives({ payload, k, kPrev, loans: [] });
console.log(JSON.stringify({
  slide4: n.rentalPerformance,
  slide5: n.financialPerformance,
  slide8: n.debtRisk,
  all: n,
}, null, 2));
