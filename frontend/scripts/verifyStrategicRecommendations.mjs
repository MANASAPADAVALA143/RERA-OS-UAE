/**
 * Sample Strategic Decisions + Action Plan commentary from realistic mock flags.
 * Run: node scripts/verifyStrategicRecommendations.mjs
 */
import { generateStrategicRecommendations, generateActionPlanCommentary } from '../src/utils/executiveSummaryNarrative.ts';
import { buildRiskActionRows } from '../src/utils/executiveSummaryActionRules.ts';

const mockK = {
  totalRevenue: 180000, totalExpenses: 100000, netIncome: 37000, noi: 55000,
  rentalIncome: 155000, otherIncome: 25000, interestExpense: 18000,
  propertyTax: 0, managementFee: 0, hoaFees: 0, legalFees: 0, utilities: 0, repairs: 0,
  totalAssets: 5_000_000, totalLiabilities: 3_000_000, equity: 2_000_000, cash: 220000, buildings: 4_000_000,
  accumDep: 0, longTermLoans: 0, securityDeposits: 0, hoa: 0, insurance: 0, otherOpex: 0, depreciation: 0,
};

const portfolio = {
  total_units: 133, occupied_units: 106, vacant_units: 27,
  occupancy_pct: 0.797, gross_potential_rent: 180000, collected_this_month: 155000,
  vacancy_loss: 25000, arrears_total: 42000,
};

const loans = [
  { property_name: 'North Tower', company_name: 'North LLC', dscr: 1.05, noi_annual: 264000, loan_emi: 6200,
    loan_balance_as_of: 900000, current_property_value: 1150000, loan_maturity_date: '2026-11-15', loan_emi: 6200 },
  { property_name: 'West Plaza', company_name: 'West LLC', dscr: 0.95, noi_annual: 96000, loan_emi: 8400,
    loan_balance_as_of: 820000, current_property_value: 1000000, loan_maturity_date: '2029-03-01', loan_emi: 8400 },
  { property_name: 'South Commons', company_name: 'South LLC', dscr: 1.40, loan_balance_as_of: 600000,
    current_property_value: 1100000, loan_maturity_date: '2028-06-01', loan_emi: 5100 },
];

const riskRows = buildRiskActionRows({
  portfolio,
  companies: [],
  loans,
  units: [],
  k: mockK,
  collectionRate: 86.1,
  ownership: [],
  arOverdue90: 3000,
});

const strategic = generateStrategicRecommendations({
  riskRows,
  loans,
  portfolio,
  collectionRate: 86.1,
  arOverdue90: 3000,
  k: mockK,
  rentalPortfolio: { noiMargin: '30.6%' },
  arDashboard: { overdue90: '$3,000', dso: '32 days' },
  debtRisk: { maturityBuckets: [{ label: '≤12 mo', amount: 640000, count: 1 }] },
});

const commentary = generateActionPlanCommentary(riskRows);

console.log(JSON.stringify({
  actionPlanItemCount: riskRows.length,
  actionPlanCommentary: commentary,
  strategicDecisions: strategic,
}, null, 2));
