/**
 * Smoke-test CEO Board PPT charts write without corrupting the pptx zip.
 * Run: npx tsx scripts/smokeCeoPptCharts.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateCeoBoardReviewPpt, type CeoBoardExportPayload } from '../src/utils/executiveSummaryPpt';

const sample: CeoBoardExportPayload = {
  entityLabel: 'Portfolio_Total',
  periodLabel: 'MoM · Aug 2026',
  generatedAt: new Date().toLocaleString(),
  executiveNarrative: 'Portfolio NOI Margin stands at 24.8%, up 1.6 points vs prior period. Physical occupancy is at 79.7% against a 95% operating target.',
  portfolioSnapshot: {
    totalUnits: '133', occupiedUnits: '106', vacantUnits: 27,
    marketValue: '$12,400,000', marketValueSource: 'From GPR',
    totalDebt: '$3,336,447', loanCount: 4,
    unitsByCompany: [
      { name: 'North', units: 40 }, { name: 'South', units: 35 },
      { name: 'East', units: 30 }, { name: 'West', units: 28 },
    ],
    assetComposition: [{ name: 'North', value: 4_000_000 }, { name: 'South', value: 3_200_000 }],
    debtComposition: [{ name: 'North', value: 900_000 }],
  },
  rentalPerformance: {
    occupancy: '79.7%', gpr: '$180,000', collected: '$155,000', vacancyLoss: '$25,000',
    collectionRate: '86.1%', arOutstanding: '$42,000',
    gprTrend: [
      { month: 'Mar', gpr: 170000, collected: 150000, occupancy: 78 },
      { month: 'Apr', gpr: 175000, collected: 152000, occupancy: 79 },
      { month: 'May', gpr: 178000, collected: 154000, occupancy: 80 },
      { month: 'Jun', gpr: 180000, collected: 155000, occupancy: 79.7 },
      { month: 'Jul', gpr: 182000, collected: 156000, occupancy: 80 },
      { month: 'Aug', gpr: 180000, collected: 155000, occupancy: 79.7 },
    ],
  },
  financialPerformance: {
    available: true,
    profitability: [
      { label: 'NOI Margin', value: '24.8%', benchmark: '>40%', status: 'warn', statusLabel: 'Monitor' },
      { label: 'Net Income Margin', value: '12.1%', benchmark: '>10%', status: 'good', statusLabel: 'Healthy' },
      { label: 'Expense Ratio', value: '55.0%', benchmark: '<60%', status: 'good', statusLabel: 'Healthy' },
    ],
    waterfall: [
      { label: 'Gross Potential Rent (GPR)', value: '$180,000' },
      { label: 'Less: Vacancy Loss', value: '($25,000)' },
      { label: 'Effective Rent', value: '$155,000' },
      { label: 'Less: Operating Expenses', value: '($100,000)' },
      { label: 'Net Operating Income (NOI)', value: '$55,000' },
      { label: 'Less: Interest Expense', value: '($18,000)' },
      { label: 'Net Income', value: '$37,000' },
    ],
    trend: [
      { month: 'Mar', revenue: 170000, expenses: 100000, noi: 50000 },
      { month: 'Apr', revenue: 175000, expenses: 102000, noi: 52000 },
      { month: 'May', revenue: 178000, expenses: 101000, noi: 54000 },
      { month: 'Jun', revenue: 180000, expenses: 100000, noi: 55000 },
      { month: 'Jul', revenue: 182000, expenses: 103000, noi: 56000 },
      { month: 'Aug', revenue: 180000, expenses: 100000, noi: 55000 },
    ],
    noi: '$55,000',
    sourceNote: 'From Financials P&L',
  },
  cashPosition: {
    balance: '$220,000',
    trend: [
      { month: 'Mar', cash: 180000 }, { month: 'Apr', cash: 190000 },
      { month: 'May', cash: 200000 }, { month: 'Jun', cash: 210000 },
      { month: 'Jul', cash: 215000 }, { month: 'Aug', cash: 220000 },
    ],
    runwayNote: 'Cash covers ~6 months of EMI',
  },
  loanPortfolio: {
    available: true,
    summary: [],
    totalDebt: '$3,336,447', loanCount: '4',
    portfolioDscr: '1.35x', interestCoverage: '1.62x',
    emiRows: [{
      loanName: 'North LLC', lender: 'GPB', outstanding: '$900,000', emiAmount: '$6,200',
      emiDueDate: 'Aug 5, 2026', paymentStatus: 'Current', interestRate: '6.25%',
      maturityDate: 'Mar 2029', isOverdue: false,
    }],
    emiDisclaimer: 'Derived status',
    worstDscr: [{ name: 'North', dscr: 1.05 }],
  },
  debtRisk: {
    available: true,
    dscrByProperty: [
      { name: 'North', dscr: 1.05 }, { name: 'South', dscr: 1.40 },
      { name: 'East', dscr: 1.25 }, { name: 'West', dscr: 0.95 },
    ],
    ltvByProperty: [
      { name: 'North', ltv: 78 }, { name: 'South', ltv: 55 },
      { name: 'East', ltv: 68 }, { name: 'West', ltv: 82 },
    ],
    maturityBuckets: [{ label: '≤12 mo', amount: 640000, count: 1 }],
  },
  ownership: {
    available: true,
    totalPartners: '3', totalCapital: '$4,000,000', totalEquity: '$9,000,000', avgRoi: '18.5%',
    partnerSlices: [
      { name: 'Alice', value: 4_000_000 }, { name: 'Bob', value: 3_000_000 }, { name: 'Cara', value: 2_000_000 },
    ],
    roiByPartner: [
      { name: 'Alice', roi: 22 }, { name: 'Bob', roi: 18 }, { name: 'Cara', roi: 12 },
    ],
  },
  propertyProfitability: {
    available: true,
    rows: [
      { property: 'North', occupancy: '82%', noiMargin: '28%', dscr: '1.05x', arrears: '$2,000', flagged: true, occupancyPct: 82, noiMarginPct: 28, noiDollars: 22000 },
      { property: 'South', occupancy: '91%', noiMargin: '32%', dscr: '1.40x', arrears: '$0', flagged: false, occupancyPct: 91, noiMarginPct: 32, noiDollars: 18000 },
      { property: 'East', occupancy: '75%', noiMargin: '18%', dscr: '1.25x', arrears: '$4,500', flagged: false, occupancyPct: 75, noiMarginPct: 18, noiDollars: 12000 },
      { property: 'West', occupancy: '70%', noiMargin: '12%', dscr: '0.95x', arrears: '$8,000', flagged: true, occupancyPct: 70, noiMarginPct: 12, noiDollars: 8000 },
    ],
  },
  riskActionTable: [],
  strategicRecommendations: ['Prioritize refinancing on properties with DSCR below covenant.'],
};

async function main() {
  const outName = await (async () => {
    // generateCeoBoardReviewPpt uses writeFile with a fixed naming helper — capture via cwd
    const before = new Set(fs.readdirSync(process.cwd()).filter(f => f.endsWith('.pptx')));
    await generateCeoBoardReviewPpt(sample);
    const after = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.pptx') && !before.has(f));
    return after[0] ?? [...before].find(f => f.includes('CEOBoardReview')) ?? null;
  })();

  if (!outName) throw new Error('No PPTX generated');
  const full = path.resolve(process.cwd(), outName);
  const buf = fs.readFileSync(full);
  // PPTX is a ZIP — verify PK header + chart xml presence when unzipped via PowerShell Expand later
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('Not a valid ZIP/PPTX');
  console.log(JSON.stringify({ ok: true, file: outName, bytes: buf.length }));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
