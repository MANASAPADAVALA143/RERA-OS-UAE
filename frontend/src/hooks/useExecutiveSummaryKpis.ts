import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { Period } from '../utils/periodWindow';
import type { CompanyRow, LoanRow, PortfolioSummary } from './useRentalCfoData';
import {
  apiResponseToParsedFinancials,
  aggregateKpiDataList,
  buildExportKpiSets,
  getAvailableKeys,
  resolveKpiViewForPeriod,
  type ExportKpiItem,
  type KpiData,
  type ParsedFinancials,
} from '../utils/rentalKpiEngine';
import { buildLoanScheduleKpis } from '../utils/executiveSummaryLoans';

function resolvePortfolioKpi(
  fins: ParsedFinancials[],
  period: Period | null,
  month: number,
  year: number,
): { k: KpiData; kPrev: KpiData | null; label: string } | null {
  if (!fins.length) return null;
  const views = fins.map(f => resolveKpiViewForPeriod(f, period, month, year));
  const k = aggregateKpiDataList(views.map(v => v.k));
  const prevList = views.map(v => v.kPrev).filter((p): p is KpiData => p !== null);
  const kPrev = prevList.length > 0 ? aggregateKpiDataList(prevList) : null;
  const label = views[0]?.label ?? `FY ${year}`;
  return { k, kPrev, label };
}

function scopePortfolio(
  portfolio: PortfolioSummary | null,
  companies: CompanyRow[],
  entityId: string,
): PortfolioSummary | null {
  if (entityId === 'portfolio') return portfolio;
  const co = companies.find(c => c.id === entityId);
  if (!co) return null;
  return {
    total_units: co.total_units,
    occupied_units: co.occupied_units,
    vacant_units: co.vacant_units,
    occupancy_pct: co.occupancy_pct,
    collected_this_month: co.collected_this_month,
    billed_this_month: co.billed_this_month,
    noi_this_month: co.noi_this_month,
    gross_potential_rent: co.gross_potential_rent,
    total_expense_this_month: co.total_expense_this_month,
    vacancy_loss: Math.max(0, co.gross_potential_rent - co.collected_this_month),
    arrears_total: co.arrears_total,
    by_company: [co],
  };
}

export interface ExecutiveOverviewMetrics {
  grossPotentialRent: number | null;
  totalCollected: number | null;
  noi: number | null;
  occupancyPct: number | null;
  vacancyLoss: number | null;
  totalExpenses: number | null;
  arOutstanding: number | null;
  collectionRate: number | null;
  totalDebt: number | null;
  hasFinancials: boolean;
  periodLabel: string;
}

export function useExecutiveSummaryKpis(
  companies: CompanyRow[],
  portfolio: PortfolioSummary | null,
  loans: LoanRow[],
  entityId: string,
  period: Period | null,
  month: number,
  year: number,
  arCollectionRate: number,
) {
  const [parsedByCompany, setParsedByCompany] = useState<Record<string, ParsedFinancials>>({});
  const [finLoading, setFinLoading] = useState(false);

  const companyIds = useMemo(
    () => (entityId === 'portfolio' ? companies.map(c => c.id) : [entityId]),
    [companies, entityId],
  );

  useEffect(() => {
    if (!companies.length) return;
    let cancelled = false;
    (async () => {
      setFinLoading(true);
      const results = await Promise.all(
        companies.map(async co => {
          try {
            const res = await api.get<Parameters<typeof apiResponseToParsedFinancials>[0]>(
              `/api/rentals/financials/${co.id}`,
            );
            return { id: co.id, fin: apiResponseToParsedFinancials(res.data) };
          } catch {
            return { id: co.id, fin: null };
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, ParsedFinancials> = {};
      for (const r of results) {
        if (r.fin?.pl?.length) map[r.id] = r.fin;
      }
      setParsedByCompany(map);
      setFinLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companies]);

  const scopedPortfolio = useMemo(
    () => scopePortfolio(portfolio, companies, entityId),
    [portfolio, companies, entityId],
  );

  const scopedLoans = useMemo(() => {
    if (entityId === 'portfolio') return loans;
    const co = companies.find(c => c.id === entityId);
    if (!co) return [];
    return loans.filter(l => l.company_name === co.company_name);
  }, [loans, companies, entityId]);

  const activeFins = useMemo(
    () => companyIds.map(id => parsedByCompany[id]).filter((f): f is ParsedFinancials => Boolean(f)),
    [companyIds, parsedByCompany],
  );

  const kpiView = useMemo(
    () => resolvePortfolioKpi(activeFins, period, month, year),
    [activeFins, period, month, year],
  );

  const ops = useMemo(() => {
    const occ = scopedPortfolio?.occupancy_pct;
    const billed = scopedPortfolio?.billed_this_month ?? 0;
    const collected = scopedPortfolio?.collected_this_month ?? 0;
    const collRate = arCollectionRate > 0
      ? arCollectionRate
      : billed > 0 ? (collected / billed) * 100 : undefined;
    return {
      occupancyPct: occ != null ? occ * 100 : undefined,
      collectionRate: collRate,
      vacancyRate: occ != null ? (1 - occ) * 100 : undefined,
      totalUnits: scopedPortfolio?.total_units,
      avgDaysVacant: undefined,
    };
  }, [scopedPortfolio, arCollectionRate]);

  const kpiSets = useMemo(() => {
    if (!kpiView) {
      return { profitability: [], balanceSheet: [], occupancy: [], pricing: [], returns: [] as ExportKpiItem[] };
    }
    return buildExportKpiSets(kpiView.k, kpiView.kPrev, ops);
  }, [kpiView, ops]);

  const loanSchedule = useMemo(() => buildLoanScheduleKpis(scopedLoans), [scopedLoans]);

  const availableKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const fin of activeFins) {
      getAvailableKeys(fin).forEach(k => keys.add(k));
    }
    return [...keys];
  }, [activeFins]);

  const overview = useMemo((): ExecutiveOverviewMetrics => {
    const k = kpiView?.k ?? null;
    const p = scopedPortfolio;
    const hasFinancials = Boolean(k && (k.totalRevenue !== 0 || k.netIncome !== 0 || k.noi !== 0));

    return {
      grossPotentialRent: p?.gross_potential_rent ?? (hasFinancials ? k!.totalRevenue : null),
      totalCollected: p?.collected_this_month ?? (hasFinancials ? k!.totalRevenue : null),
      noi: hasFinancials ? k!.noi : (p?.noi_this_month ?? null),
      occupancyPct: p?.occupancy_pct != null ? p.occupancy_pct * 100 : null,
      vacancyLoss: p?.vacancy_loss ?? null,
      totalExpenses: hasFinancials ? k!.totalExpenses : (p?.total_expense_this_month ?? null),
      arOutstanding: p?.arrears_total ?? null,
      collectionRate: ops.collectionRate ?? null,
      totalDebt: scopedLoans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0) || null,
      hasFinancials,
      periodLabel: kpiView?.label ?? '',
    };
  }, [kpiView, scopedPortfolio, scopedLoans, ops.collectionRate]);

  return {
    kpiView,
    kpiSets,
    loanSchedule,
    scopedPortfolio,
    scopedLoans,
    parsedByCompany,
    activeFins,
    overview,
    availableKeys,
    loading: finLoading,
  };
}
