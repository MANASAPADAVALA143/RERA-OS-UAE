import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { Period } from '../utils/periodWindow';
import { getPeriodKeys } from '../utils/periodWindow';
import {
  apiResponseToParsedFinancials,
  buildExportKpiSets,
  calcKpisFromMonthlyKey,
  getAvailableKeys,
  resolveKpiViewForPeriod,
  type ExportKpiItem,
  type KpiData,
  type ParsedFinancials,
} from '../utils/rentalKpiEngine';
import { collectKpiAlerts, buildExceptionRows, type AnalyticsAlert, type ExceptionRow } from '../utils/rentalAnalyticsBullets';

export interface CompanyOption {
  id: string;
  company_name: string;
}

export interface MonthlyTrendPoint {
  month: string;
  revenue: number;
  expenses: number;
  noi: number;
  cash: number;
}

export interface PropertySlice {
  id: string;
  name: string;
  revenue: number;
  expenses: number;
  noi: number;
}

export interface AnalyticsSnapshot {
  companyId: string;
  companyName: string;
  fin: ParsedFinancials | null;
  k: KpiData | null;
  kPrev: KpiData | null;
  label: string;
  sets: ReturnType<typeof buildExportKpiSets> | null;
  allItems: ExportKpiItem[];
  occupancyPct?: number;
  collectionRate?: number;
}

function flattenKpiSets(sets: ReturnType<typeof buildExportKpiSets>): ExportKpiItem[] {
  return [...sets.profitability, ...sets.balanceSheet, ...sets.occupancy, ...sets.pricing, ...sets.returns];
}

export function useRentalAnalyticsData(period: Period | null, pMonth: number, pYear: number) {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [financials, setFinancials] = useState<Record<string, ParsedFinancials>>({});
  const [portfolioOps, setPortfolioOps] = useState<Record<string, { occupancy?: number; collection?: number }>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const coRes = await api.get<CompanyOption[]>('/api/rentals/companies');
      const list = Array.isArray(coRes.data) ? coRes.data : [];
      setCompanies(list);

      const monthParam = `${pYear}-${String(pMonth).padStart(2, '0')}`;
      const [finResults, portRes] = await Promise.all([
        Promise.all(
          list.map(async co => {
            try {
              const res = await api.get<Record<string, unknown>>(`/api/rentals/financials/${co.id}`);
              return { id: co.id, fin: apiResponseToParsedFinancials(res.data as Parameters<typeof apiResponseToParsedFinancials>[0]) };
            } catch {
              return { id: co.id, fin: null };
            }
          }),
        ),
        api.get<{ companies?: { id: string; occupancy_pct?: number; collection_rate?: number }[] }>(
          `/api/rentals/portfolio-summary?month=${monthParam}`,
        ).catch(() => ({ data: { companies: [] } } as { data: { companies?: { id: string; occupancy_pct?: number; collection_rate?: number }[] } })),
      ]);

      const finMap: Record<string, ParsedFinancials> = {};
      for (const r of finResults) {
        if (r.fin) finMap[r.id] = r.fin;
      }
      setFinancials(finMap);

      const opsMap: Record<string, { occupancy?: number; collection?: number }> = {};
      for (const c of portRes.data?.companies ?? []) {
        if (c.id) opsMap[c.id] = { occupancy: c.occupancy_pct, collection: c.collection_rate };
      }
      setPortfolioOps(opsMap);
    } finally {
      setLoading(false);
    }
  }, [pMonth, pYear]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedCompanyId && companies.length) {
      setSelectedCompanyId(companies[0].id);
    }
  }, [companies, selectedCompanyId]);

  const buildSnapshot = useCallback((companyId: string): AnalyticsSnapshot | null => {
    const fin = financials[companyId];
    const co = companies.find(c => c.id === companyId);
    if (!fin || !co) return { companyId, companyName: co?.company_name ?? '', fin: null, k: null, kPrev: null, label: '', sets: null, allItems: [] };

    const view = period
      ? resolveKpiViewForPeriod(fin, period, pMonth, pYear)
      : resolveKpiViewForPeriod(fin, null as unknown as Period, pMonth, pYear);

    const ops = portfolioOps[companyId];
    const sets = buildExportKpiSets(view.k, view.kPrev, {
      occupancyPct: ops?.occupancy,
      collectionRate: ops?.collection,
    });

    return {
      companyId,
      companyName: co.company_name,
      fin,
      k: view.k,
      kPrev: view.kPrev,
      label: view.label,
      sets,
      allItems: flattenKpiSets(sets),
      occupancyPct: ops?.occupancy,
      collectionRate: ops?.collection,
    };
  }, [financials, companies, portfolioOps, period, pMonth, pYear]);

  const selected = useMemo(
    () => (selectedCompanyId ? buildSnapshot(selectedCompanyId) : null),
    [selectedCompanyId, buildSnapshot],
  );

  const ttmTrend = useMemo((): MonthlyTrendPoint[] => {
    if (!selected?.fin) return [];
    const keys = getPeriodKeys('TTM', pMonth, pYear).filter(k => getAvailableKeys(selected.fin!).includes(k));
    return keys.map(key => {
      const m = calcKpisFromMonthlyKey(selected.fin!, key);
      return { month: key, revenue: m.totalRevenue, expenses: m.totalExpenses, noi: m.noi, cash: m.cash };
    });
  }, [selected, pMonth, pYear]);

  const alerts = useMemo((): AnalyticsAlert[] => {
    if (!selected?.sets || !selected.k) return [];
    return collectKpiAlerts(selected.allItems, selected.k);
  }, [selected]);

  const propertySlices = useMemo((): PropertySlice[] => {
    return companies
      .map(co => {
        const snap = buildSnapshot(co.id);
        if (!snap?.k) return null;
        return {
          id: co.id,
          name: co.company_name,
          revenue: snap.k.totalRevenue,
          expenses: snap.k.totalExpenses,
          noi: snap.k.noi,
        };
      })
      .filter((x): x is PropertySlice => x !== null && (x.revenue !== 0 || x.noi !== 0));
  }, [companies, buildSnapshot]);

  const exceptionRows = useMemo((): ExceptionRow[] => {
    const rows = companies.map(co => {
      const snap = buildSnapshot(co.id);
      return { id: co.id, company_name: co.company_name, items: snap?.allItems ?? [] };
    });
    return buildExceptionRows(rows);
  }, [companies, buildSnapshot]);

  const allSnapshots = useMemo(
    () => companies.map(co => buildSnapshot(co.id)).filter((s): s is AnalyticsSnapshot => s !== null),
    [companies, buildSnapshot],
  );

  return {
    companies,
    selectedCompanyId,
    setSelectedCompanyId,
    selected,
    ttmTrend,
    alerts,
    propertySlices,
    exceptionRows,
    allSnapshots,
    loading,
    refresh: load,
  };
}
