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
import { aggregateRegistryOps } from '../utils/executiveSummaryRegistry';
import type { UnitRow } from './useRentalCfoData';

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
  registryMonth: string | null;
}

export function useExecutiveSummaryKpis(
  companies: CompanyRow[],
  portfolio: PortfolioSummary | null,
  loans: LoanRow[],
  units: UnitRow[],
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
    let cancelled = false;
    (async () => {
      setFinLoading(true);
      const listRes = await api.get<{ company_id: string }[]>('/api/rentals/financials').catch(() => ({ data: [] }));
      const uploadIds = (listRes.data ?? []).map(r => r.company_id);
      const idsToFetch = [...new Set([...companies.map(c => c.id), ...uploadIds])];
      if (!idsToFetch.length) {
        if (!cancelled) {
          setParsedByCompany({});
          setFinLoading(false);
        }
        return;
      }
      const results = await Promise.all(
        idsToFetch.map(async id => {
          try {
            const res = await api.get<Parameters<typeof apiResponseToParsedFinancials>[0]>(
              `/api/rentals/financials/${id}`,
            );
            return { id, fin: apiResponseToParsedFinancials(res.data) };
          } catch {
            return { id, fin: null };
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

  const registryOps = useMemo(
    () => aggregateRegistryOps(companies, units, entityId, month, year),
    [companies, units, entityId, month, year],
  );

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
    const occ = registryOps.occupancyPct;
    const billed = registryOps.billed ?? scopedPortfolio?.billed_this_month ?? 0;
    const collected = registryOps.collected ?? scopedPortfolio?.collected_this_month ?? 0;
    const collRate = arCollectionRate > 0
      ? arCollectionRate
      : billed > 0 ? (collected / billed) * 100
        : (registryOps.grossPotentialRent != null && registryOps.grossPotentialRent > 0 && collected > 0)
          ? (collected / registryOps.grossPotentialRent) * 100
          : undefined;
    return {
      occupancyPct: occ ?? undefined,
      collectionRate: collRate,
      vacancyRate: occ != null ? (100 - occ) : undefined,
      totalUnits: registryOps.totalUnits || scopedPortfolio?.total_units,
      avgDaysVacant: undefined,
    };
  }, [registryOps, scopedPortfolio, arCollectionRate]);

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
    const hasFinancials = activeFins.length > 0;
    const debtTotal = scopedLoans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);

    const gpr = registryOps.grossPotentialRent;
    const collected = registryOps.collected;
    const vacancyLoss = registryOps.vacancyLoss
      ?? (gpr != null && collected != null ? Math.max(0, gpr - collected) : null);

    return {
      grossPotentialRent: gpr,
      totalCollected: collected,
      noi: hasFinancials && k ? k.noi : null,
      occupancyPct: registryOps.occupancyPct,
      vacancyLoss,
      totalExpenses: hasFinancials && k ? k.totalExpenses : null,
      arOutstanding: registryOps.arrears ?? scopedPortfolio?.arrears_total ?? null,
      collectionRate: ops.collectionRate ?? null,
      totalDebt: scopedLoans.length > 0 ? debtTotal : null,
      hasFinancials,
      periodLabel: kpiView?.label ?? '',
      registryMonth: registryOps.registryMonth,
    };
  }, [kpiView, registryOps, scopedPortfolio, scopedLoans, ops.collectionRate, activeFins.length]);

  return {
    kpiView,
    kpiSets,
    loanSchedule,
    scopedPortfolio,
    scopedLoans,
    registryOps,
    parsedByCompany,
    activeFins,
    overview,
    availableKeys,
    loading: finLoading,
  };
}
