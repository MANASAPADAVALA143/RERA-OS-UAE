import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  occupancy_pct?: number;
  collected_this_month?: number;
  billed_this_month?: number;
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

function opsFromCompanyRow(c: CompanyOption): { occupancy?: number; collection?: number } {
  const occupancy = c.occupancy_pct != null ? c.occupancy_pct * 100 : undefined;
  const collection =
    c.billed_this_month && c.billed_this_month > 0
      ? ((c.collected_this_month ?? 0) / c.billed_this_month) * 100
      : undefined;
  return { occupancy, collection };
}

async function fetchCompanyFinancials(companyId: string): Promise<ParsedFinancials | null> {
  try {
    const res = await api.get<Parameters<typeof apiResponseToParsedFinancials>[0]>(
      `/api/rentals/financials/${companyId}`,
    );
    return apiResponseToParsedFinancials(res.data);
  } catch {
    return null;
  }
}

export function useRentalAnalyticsData(period: Period | null, pMonth: number, pYear: number) {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [financials, setFinancials] = useState<Record<string, ParsedFinancials>>({});
  const [portfolioOps, setPortfolioOps] = useState<Record<string, { occupancy?: number; collection?: number }>>({});
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);
  const [loadingSelectedFin, setLoadingSelectedFin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const financialsRef = useRef(financials);
  financialsRef.current = financials;

  // Fast bootstrap: company list + portfolio ops (no per-company financials yet)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingBootstrap(true);
      setLoadError(null);
      try {
        const monthParam = `${pYear}-${String(pMonth).padStart(2, '0')}`;
        const [coRes, portRes] = await Promise.all([
          api.get<CompanyOption[]>('/api/rentals/companies'),
          api
            .get<{ by_company?: Array<{
              company_id: string;
              occupancy_pct?: number;
              collected_this_month?: number;
              billed_this_month?: number;
            }> }>(`/api/rentals/portfolio-summary?month=${monthParam}`)
            .catch(() => ({ data: { by_company: [] as Array<{
              company_id: string;
              occupancy_pct?: number;
              collected_this_month?: number;
              billed_this_month?: number;
            }> } })),
        ]);
        if (cancelled) return;

        const list = Array.isArray(coRes.data) ? coRes.data : [];
        setCompanies(list);
        setSelectedCompanyId(prev => prev ?? (list[0]?.id ?? null));

        const opsMap: Record<string, { occupancy?: number; collection?: number }> = {};
        for (const co of list) {
          opsMap[co.id] = opsFromCompanyRow(co);
        }
        for (const row of portRes.data?.by_company ?? []) {
          if (!row.company_id) continue;
          const billed = row.billed_this_month ?? 0;
          opsMap[row.company_id] = {
            occupancy: row.occupancy_pct != null ? row.occupancy_pct * 100 : opsMap[row.company_id]?.occupancy,
            collection: billed > 0
              ? ((row.collected_this_month ?? 0) / billed) * 100
              : opsMap[row.company_id]?.collection,
          };
        }
        setPortfolioOps(opsMap);
      } catch {
        if (!cancelled) setLoadError('Could not load analytics data. Please refresh the page.');
      } finally {
        if (!cancelled) setLoadingBootstrap(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pMonth, pYear]);

  // Selected company financials — load first so the page renders quickly
  useEffect(() => {
    if (!selectedCompanyId) return;
    if (financialsRef.current[selectedCompanyId]) return;

    let cancelled = false;
    (async () => {
      setLoadingSelectedFin(true);
      const fin = await fetchCompanyFinancials(selectedCompanyId);
      if (cancelled) return;
      if (fin) {
        setFinancials(prev => (prev[selectedCompanyId] ? prev : { ...prev, [selectedCompanyId]: fin }));
      }
      setLoadingSelectedFin(false);
    })();
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

  // Background: load remaining companies for property / exception views
  useEffect(() => {
    if (loadingBootstrap || companies.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const co of companies) {
        if (cancelled || co.id === selectedCompanyId) continue;
        const fin = await fetchCompanyFinancials(co.id);
        if (cancelled || !fin) continue;
        setFinancials(prev => (prev[co.id] ? prev : { ...prev, [co.id]: fin }));
      }
    })();
    return () => { cancelled = true; };
  }, [loadingBootstrap, companies, selectedCompanyId]);

  const loadFinancial = useCallback(async (companyId: string) => {
    if (financials[companyId]) return;
    const fin = await fetchCompanyFinancials(companyId);
    if (fin) setFinancials(prev => ({ ...prev, [companyId]: fin }));
  }, [financials]);

  const buildSnapshot = useCallback((companyId: string): AnalyticsSnapshot | null => {
    const fin = financials[companyId];
    const co = companies.find(c => c.id === companyId);
    if (!co) return null;
    if (!fin) {
      return {
        companyId, companyName: co.company_name, fin: null, k: null, kPrev: null,
        label: '', sets: null, allItems: [],
      };
    }

    const view = period
      ? resolveKpiViewForPeriod(fin, period, pMonth, pYear)
      : resolveKpiViewForPeriod(fin, null as unknown as Period, pMonth, pYear);

    const ops = portfolioOps[companyId] ?? opsFromCompanyRow(co);
    const sets = buildExportKpiSets(view.k, view.kPrev, {
      occupancyPct: ops.occupancy,
      collectionRate: ops.collection,
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
      occupancyPct: ops.occupancy,
      collectionRate: ops.collection,
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

  const loading = loadingBootstrap || (loadingSelectedFin && !selected?.fin);

  const refresh = useCallback(async () => {
    setFinancials({});
    setLoadingBootstrap(true);
    const monthParam = `${pYear}-${String(pMonth).padStart(2, '0')}`;
    try {
      const coRes = await api.get<CompanyOption[]>('/api/rentals/companies');
      const list = Array.isArray(coRes.data) ? coRes.data : [];
      setCompanies(list);
      const portRes = await api.get<{ by_company?: Array<{
        company_id: string; occupancy_pct?: number;
        collected_this_month?: number; billed_this_month?: number;
      }> }>(`/api/rentals/portfolio-summary?month=${monthParam}`).catch(() => ({ data: { by_company: [] } }));
      const opsMap: Record<string, { occupancy?: number; collection?: number }> = {};
      for (const co of list) opsMap[co.id] = opsFromCompanyRow(co);
      for (const row of portRes.data?.by_company ?? []) {
        if (!row.company_id) continue;
        const billed = row.billed_this_month ?? 0;
        opsMap[row.company_id] = {
          occupancy: row.occupancy_pct != null ? row.occupancy_pct * 100 : opsMap[row.company_id]?.occupancy,
          collection: billed > 0 ? ((row.collected_this_month ?? 0) / billed) * 100 : opsMap[row.company_id]?.collection,
        };
      }
      setPortfolioOps(opsMap);
    } finally {
      setLoadingBootstrap(false);
    }
  }, [pMonth, pYear]);

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
    loadError,
    loadFinancial,
    refresh,
  };
}
