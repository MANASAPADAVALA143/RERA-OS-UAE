import type { CompanyData, Partner, Property, YearlyPL } from '../contexts/PropertyDevContext';

export type ProfitDataSource = 'yearly_pl' | 'property_estimate' | 'none';

export interface EntityAnnualPL {
  year: string;
  revenue: number;
  landCost: number;
  devExpenses: number;
  commission: number;
  netProfit: number;
  dataSource: ProfitDataSource;
}

export interface PartnerProfitWaterfall {
  year: string;
  revenue: number;
  landCost: number;
  devExpenses: number;
  commission: number;
  netProfit: number;
  partnerShare: number;
  prefReturn: number;
  netDistribution: number;
  distributed: number;
  dataSource: ProfitDataSource;
  steps: { step: string; value: number; fill: string }[];
}

const DEV_CATEGORIES = [
  'hard_cost', 'soft_cost', 'professional_charges', 'legal_fees', 'title_charges',
] as const;

function sumCategories(cats: Record<string, number>, keys: readonly string[]): number {
  return keys.reduce((s, k) => s + (cats[k] ?? 0), 0);
}

function latestYearlyPL(prop: Property): { year: string; pl: YearlyPL } | null {
  if (!prop.yearlyPL || Object.keys(prop.yearlyPL).length === 0) return null;
  const years = Object.keys(prop.yearlyPL).sort();
  const year = years[years.length - 1];
  return { year, pl: prop.yearlyPL[year] };
}

export function entityAnnualPL(company: CompanyData): EntityAnnualPL {
  const prop = company.property;
  const latest = latestYearlyPL(prop);

  if (latest) {
    const { year, pl } = latest;
    const cats = pl.expenses_by_category ?? {};
    const otherIncome = pl.other_income ?? 0;
    let revenue = (pl.revenue ?? 0) + otherIncome;
    const totalExp = pl.total_expenses ?? 0;
    if (revenue <= 0 && (pl.net_income ?? 0) !== 0 && totalExp > 0) {
      revenue = (pl.net_income ?? 0) + totalExp;
    }

    const landCost = cats.land_cost ?? prop.landCost ?? 0;
    const devFromCats = sumCategories(cats, DEV_CATEGORIES);
    const devExpenses = devFromCats > 0
      ? devFromCats
      : (prop.hardCost ?? 0) + (prop.softCost ?? 0)
        + (prop.titleCharges ?? 0) + (prop.professionalCharges ?? 0) + (prop.legalFees ?? 0);

    const commission = (prop.commission && prop.commission > 0)
      ? prop.commission
      : (cats.commission ?? 0) || revenue * (prop.commissionRate ?? 0);

    let netProfit = pl.net_income ?? 0;
    const computed = revenue - landCost - devExpenses - commission;
    if (netProfit === 0 && (revenue > 0 || totalExp > 0)) {
      netProfit = computed;
    }

    return { year, revenue, landCost, devExpenses, commission, netProfit, dataSource: 'yearly_pl' };
  }

  const revenue = prop.saleConsideration ?? 0;
  if (revenue <= 0) {
    return { year: '', revenue: 0, landCost: 0, devExpenses: 0, commission: 0, netProfit: 0, dataSource: 'none' };
  }

  const landCost = prop.landCost ?? 0;
  const devExpenses = (prop.hardCost ?? 0) + (prop.softCost ?? 0);
  const commission = prop.commission ?? revenue * (prop.commissionRate ?? 0.03);
  const netProfit = revenue - landCost - devExpenses - commission;
  return { year: '', revenue, landCost, devExpenses, commission, netProfit, dataSource: 'property_estimate' };
}

export interface EntityCostBreakdown {
  year: string;
  landCost: number;
  hardCost: number;
  softCost: number;
  otherCosts: number;
  commission: number;
  totalProjectCost: number;
  plRevenue: number;
  dataSource: ProfitDataSource;
}

const OTHER_COST_CATEGORIES = [
  'professional_charges', 'legal_fees', 'title_charges', 'other_charges',
] as const;

function propertyOtherCosts(prop: Property): number {
  return (prop.titleCharges ?? 0) + (prop.otherCharges ?? 0) + (prop.propertyTax ?? 0)
    + (prop.loanProcessing ?? 0) + (prop.professionalCharges ?? 0) + (prop.legalFees ?? 0)
    + (prop.interestOnLoan ?? 0);
}

/** Land / hard / soft / other — same P&L source as partner profit waterfall. */
export function entityCostBreakdown(company: CompanyData): EntityCostBreakdown {
  const prop = company.property;
  const latest = latestYearlyPL(prop);

  if (latest) {
    const { year, pl } = latest;
    const cats = pl.expenses_by_category ?? {};
    const landCost = Number(cats.land_cost ?? prop.landCost ?? 0);
    const hardCost = Number(cats.hard_cost ?? prop.hardCost ?? 0);
    const softCost = Number(cats.soft_cost ?? prop.softCost ?? 0);
    const otherFromCats = sumCategories(cats, OTHER_COST_CATEGORIES);
    const otherCosts = otherFromCats > 0 ? otherFromCats : propertyOtherCosts(prop);
    const plRevenue = (pl.revenue ?? 0) + (pl.other_income ?? 0);
    const commission = (prop.commission && prop.commission > 0)
      ? prop.commission
      : Number(cats.commission ?? 0) || plRevenue * (prop.commissionRate ?? 0);
    const totalProjectCost = landCost + hardCost + softCost + otherCosts;
    return {
      year, landCost, hardCost, softCost, otherCosts, commission, totalProjectCost, plRevenue,
      dataSource: 'yearly_pl',
    };
  }

  const landCost = prop.landCost ?? 0;
  const hardCost = prop.hardCost ?? 0;
  const softCost = prop.softCost ?? 0;
  const otherCosts = propertyOtherCosts(prop);
  const plRevenue = prop.saleConsideration ?? 0;
  const commission = prop.commission ?? plRevenue * (prop.commissionRate ?? 0.03);
  const totalProjectCost = landCost + hardCost + softCost + otherCosts;
  const dataSource: ProfitDataSource = plRevenue > 0 || totalProjectCost > 0 ? 'property_estimate' : 'none';
  return {
    year: '', landCost, hardCost, softCost, otherCosts, commission, totalProjectCost, plRevenue, dataSource,
  };
}

export function aggregatePerformanceCosts(companies: CompanyData[]): EntityCostBreakdown {
  if (companies.length === 0) {
    return {
      year: '', landCost: 0, hardCost: 0, softCost: 0, otherCosts: 0, commission: 0,
      totalProjectCost: 0, plRevenue: 0, dataSource: 'none',
    };
  }
  const rows = companies.map(entityCostBreakdown);
  let dataSource: ProfitDataSource = 'none';
  if (rows.some(r => r.dataSource === 'yearly_pl')) dataSource = 'yearly_pl';
  else if (rows.some(r => r.dataSource === 'property_estimate')) dataSource = 'property_estimate';

  return {
    year: rows.map(r => r.year).filter(Boolean).sort().pop() ?? '',
    landCost: rows.reduce((s, r) => s + r.landCost, 0),
    hardCost: rows.reduce((s, r) => s + r.hardCost, 0),
    softCost: rows.reduce((s, r) => s + r.softCost, 0),
    otherCosts: rows.reduce((s, r) => s + r.otherCosts, 0),
    commission: rows.reduce((s, r) => s + r.commission, 0),
    totalProjectCost: rows.reduce((s, r) => s + r.totalProjectCost, 0),
    plRevenue: rows.reduce((s, r) => s + r.plRevenue, 0),
    dataSource,
  };
}

export function partnerShareOfProfitFromAnnualPL(company: CompanyData, sharePercent: number): number {
  if (sharePercent <= 0) return 0;
  const epl = entityAnnualPL(company);
  return epl.netProfit * (sharePercent / 100);
}

export function buildPartnerProfitWaterfall(
  partnerName: string,
  instances: Partner[],
  companiesMap: Record<string, CompanyData>,
  totalDistributed: number,
): PartnerProfitWaterfall {
  let revenue = 0;
  let landCost = 0;
  let devExpenses = 0;
  let commission = 0;
  let netProfit = 0;
  let dataSource: ProfitDataSource = 'none';
  let year = '';

  for (const p of instances) {
    const co = companiesMap[p.companyId];
    if (!co) continue;
    const epl = entityAnnualPL(co);
    const pct = p.sharePercent / 100;
    revenue += epl.revenue * pct;
    landCost += epl.landCost * pct;
    devExpenses += epl.devExpenses * pct;
    commission += epl.commission * pct;
    netProfit += epl.netProfit * pct;
    if (epl.dataSource === 'yearly_pl') dataSource = 'yearly_pl';
    else if (epl.dataSource === 'property_estimate' && dataSource === 'none') dataSource = 'property_estimate';
    if (epl.year) year = epl.year;
  }

  const prefObligation = instances.reduce(
    (s, p) => s + p.capitalContributed * (p.preferredReturn / 100),
    0,
  );

  let prefReturn = 0;
  let partnerShare = 0;
  let netDistribution = 0;

  if (netProfit > 0) {
    prefReturn = Math.min(prefObligation, netProfit);
    partnerShare = Math.max(0, netProfit - prefReturn);
    netDistribution = Math.max(0, netProfit - totalDistributed);
  }

  const steps = [
    { step: 'Total Revenue', value: revenue, fill: '#2563EB' },
    { step: 'Land Cost', value: -landCost, fill: '#DC2626' },
    { step: 'Dev Expenses', value: -devExpenses, fill: '#DC2626' },
    { step: 'Commission', value: -commission, fill: '#DC2626' },
    { step: 'Net Profit', value: netProfit, fill: '#16A34A' },
    { step: `${partnerName} Share`, value: partnerShare, fill: '#7C3AED' },
    { step: 'Pref Return', value: prefReturn, fill: '#D97706' },
    { step: 'Net Distribution', value: netDistribution, fill: '#047857' },
  ];

  return {
    year,
    revenue,
    landCost,
    devExpenses,
    commission,
    netProfit,
    partnerShare,
    prefReturn,
    netDistribution,
    distributed: totalDistributed,
    dataSource,
    steps,
  };
}
