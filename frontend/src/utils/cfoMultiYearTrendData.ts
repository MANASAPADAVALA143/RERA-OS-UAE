import {
  aggregateKpiDataList,
  calcKpis,
  type KpiData,
  type ParsedFinancials,
} from './rentalKpiEngine';

export interface YearSnapshot {
  year: number;
  revenue: number;
  expenses: number;
  netIncome: number;
  noi: number;
  cash: number;
  margin: number;
  rentalIncome: number;
  otherIncome: number;
  services: number;
  kpi: KpiData;
}

export function unionYears(fins: ParsedFinancials[]): number[] {
  const set = new Set<number>();
  for (const fin of fins) fin.years.forEach(y => set.add(y));
  return [...set].sort((a, b) => a - b);
}

/** Same per-year aggregation as Financials → CFO Dashboard (calcKpis per company, summed for portfolio). */
export function buildYearSnapshots(fins: ParsedFinancials[]): YearSnapshot[] {
  if (!fins.length) return [];
  return unionYears(fins).map(y => {
    const perCo = fins.filter(f => f.years.includes(y)).map(f => calcKpis(f, y));
    const kk = aggregateKpiDataList(perCo);
    return {
      year: y,
      revenue: kk.totalRevenue,
      expenses: kk.totalExpenses,
      netIncome: kk.netIncome,
      noi: kk.noi,
      cash: kk.cash,
      margin: kk.totalRevenue > 0 ? (kk.netIncome / kk.totalRevenue) * 100 : 0,
      rentalIncome: kk.rentalIncome,
      otherIncome: kk.otherIncome,
      services: Math.max(0, kk.totalRevenue - kk.rentalIncome - kk.otherIncome),
      kpi: kk,
    };
  });
}

export function expensePieFromKpi(k: KpiData) {
  return [
    { name: 'Interest Paid', value: k.interestExpense },
    { name: 'Property Tax', value: k.propertyTax },
    { name: 'HOA Fees', value: k.hoaFees },
    { name: 'Legal Fees', value: k.legalFees },
    { name: 'Mgmt Fee', value: k.managementFee },
    { name: 'Utilities', value: k.utilities },
    { name: 'Repairs', value: k.repairs },
    {
      name: 'Other',
      value: Math.max(
        0,
        k.totalExpenses
          - k.interestExpense
          - k.propertyTax
          - k.hoaFees
          - k.legalFees
          - k.managementFee
          - k.utilities
          - k.repairs,
      ),
    },
  ].filter(e => e.value > 0);
}
