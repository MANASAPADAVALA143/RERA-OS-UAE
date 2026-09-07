import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { usePropDev, type CompanyData } from '../contexts/PropertyDevContext';
import {
  apiFinToPropDevUploaded,
  PROPDEV_FIN_LS_KEY,
  type PropDevUploadedFinancials,
} from '../utils/propDevFinancialApi';
import {
  buildPropDevBsSnapshots,
  buildPropDevCfSnapshots,
} from '../utils/propDevCfoTrendData';
import { buildPropDevYearSnapshots, propDevPeriodAnchor } from '../utils/propDevPeriodKpis';
import { scopePropDevFinToPeriod } from '../utils/propDevPeriodScope';
import { propDevCompanyOverviewKpis } from '../utils/propDevCompanyOverview';
import { resolveCompanyUploadedFinancials } from '../utils/propDevYearlyFinancials';

export type PropDevFinLoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export function usePropDevCompanyFinancials(companyId: string | 'all') {
  const {
    companies, loans, ensureCompanyYearly,
    financialPeriod, financialMonth, financialYear,
  } = usePropDev();
  const [apiFin, setApiFin] = useState<PropDevUploadedFinancials | null>(null);
  const [loadState, setLoadState] = useState<PropDevFinLoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** True after yearly + API financials fetch attempt finishes (success or empty). */
  const [fetchDone, setFetchDone] = useState(false);
  const fetchGenRef = useRef(0);

  const company = useMemo(
    () => (companyId !== 'all' ? companies.find(c => c.id === companyId) : undefined),
    [companies, companyId],
  );

  const companyPresent = Boolean(company);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  useEffect(() => {
    if (companyId === 'all') {
      setApiFin(null);
      setLoadState('idle');
      setError(null);
      setFetchDone(false);
      return;
    }

    if (!companyPresent) {
      setLoadState('loading');
      setFetchDone(false);
      return;
    }

    const gen = ++fetchGenRef.current;
    let cancelled = false;
    setLoadState('loading');
    setError(null);
    setFetchDone(false);

    const run = async () => {
      try {
        const cached = localStorage.getItem(PROPDEV_FIN_LS_KEY(companyId));
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as PropDevUploadedFinancials;
            if (parsed?.pl?.length || parsed?.bs?.length || parsed?.cf?.length) {
              if (!cancelled && fetchGenRef.current === gen) setApiFin(parsed);
            }
          } catch {
            /* ignore corrupt cache */
          }
        }

        await ensureCompanyYearly(companyId);
        if (cancelled || fetchGenRef.current !== gen) return;

        try {
          const res = await api.get<{
            company_name: string;
            filename: string;
            years: number[];
            pl: PropDevUploadedFinancials['pl'];
            bs: PropDevUploadedFinancials['bs'];
            cf?: PropDevUploadedFinancials['cf'];
            pl_filename?: string | null;
            bs_filename?: string | null;
            cf_filename?: string | null;
            uploaded_at: string;
          }>(`/api/propdev/financials/${companyId}`);

          if (cancelled || fetchGenRef.current !== gen) return;

          if (res.data?.pl?.length || res.data?.bs?.length || res.data?.cf?.length) {
            const fetchedFin = apiFinToPropDevUploaded(res.data);
            setApiFin(fetchedFin);
            localStorage.setItem(PROPDEV_FIN_LS_KEY(companyId), JSON.stringify(fetchedFin));
          }
        } catch (err: unknown) {
          if (cancelled || fetchGenRef.current !== gen) return;
          const status = (err as { response?: { status?: number } })?.response?.status;
          if (status !== 404) {
            setLoadState('error');
            setError(
              status === 502 || status === 503 || status === 504 || !status
                ? 'API temporarily unavailable. Wait ~30s and retry.'
                : 'Could not load saved financials for this company.',
            );
            setFetchDone(true);
            return;
          }
        }

        if (!cancelled && fetchGenRef.current === gen) {
          setFetchDone(true);
        }
      } catch {
        if (!cancelled && fetchGenRef.current === gen) {
          setLoadState('error');
          setError('Could not load financial data for this company.');
          setFetchDone(true);
        }
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [companyId, companyPresent, reloadKey, ensureCompanyYearly]);

  // Settle ready/empty once fetch completes and company yearly data has applied
  useEffect(() => {
    if (companyId === 'all' || !company || !fetchDone) return;
    if (loadState === 'error') return;

    const resolved = resolveCompanyUploadedFinancials(company, apiFin);
    if (resolved) {
      setLoadState('ready');
      setError(null);
    } else {
      setLoadState('empty');
    }
  }, [company, apiFin, companyId, fetchDone, loadState]);

  const resolvedFin = useMemo(
    () => (company ? resolveCompanyUploadedFinancials(company, apiFin) : null),
    [company, apiFin],
  );

  // Match Financials CFO / PDF board pack: Month/YTD window written into values[year]
  // so Command Center B/S debt/cash/assets follow the period Balance Sheet (not Loan Tracker stubs).
  const periodAnchor = useMemo(
    () => propDevPeriodAnchor(financialPeriod, financialMonth, financialYear),
    [financialPeriod, financialMonth, financialYear],
  );

  const scopedFin = useMemo(
    () => (resolvedFin ? scopePropDevFinToPeriod(resolvedFin, periodAnchor) : null),
    [resolvedFin, periodAnchor],
  );

  const companyLoans = useMemo(() => {
    if (!company) return [] as typeof loans;
    return company.loans?.length
      ? company.loans
      : loans.filter(l => l.companyId === company.id);
  }, [company, loans]);

  const overviewKpis = useMemo(
    () => (company ? propDevCompanyOverviewKpis(company, scopedFin ?? resolvedFin, companyLoans) : null),
    [company, scopedFin, resolvedFin, companyLoans],
  );

  const selectedYear = useMemo(() => {
    if (periodAnchor?.year) return periodAnchor.year;
    if (resolvedFin?.years.length) return resolvedFin.years[resolvedFin.years.length - 1];
    return new Date().getFullYear();
  }, [resolvedFin, periodAnchor]);

  const bsSnapshots = useMemo(
    () => (scopedFin && company
      ? buildPropDevBsSnapshots(scopedFin, company, periodAnchor, {
          annualLedger: true,
          loans: companyLoans,
        })
      : []),
    [scopedFin, company, periodAnchor, companyLoans],
  );

  const cfSnapshots = useMemo(
    () => (scopedFin && company
      ? buildPropDevCfSnapshots(scopedFin, company, periodAnchor, { annualLedger: true })
      : []),
    [scopedFin, company, periodAnchor],
  );

  const plSnapshots = useMemo(
    () => (scopedFin
      ? buildPropDevYearSnapshots(scopedFin, periodAnchor, { annualLedger: true })
      : []),
    [scopedFin, periodAnchor],
  );

  return {
    company: company as CompanyData | undefined,
    companyId,
    resolvedFin,
    scopedFin,
    apiFin,
    loadState,
    error,
    reload,
    overviewKpis,
    selectedYear,
    bsSnapshots,
    cfSnapshots,
    plSnapshots,
    latestPl: plSnapshots.find(s => s.year === selectedYear) ?? plSnapshots[plSnapshots.length - 1],
    latestBs: bsSnapshots.find(s => s.year === selectedYear) ?? bsSnapshots[bsSnapshots.length - 1],
    latestCf: cfSnapshots.find(s => s.year === selectedYear) ?? cfSnapshots[cfSnapshots.length - 1],
    hasFinancialData: Boolean(resolvedFin),
  };
}
