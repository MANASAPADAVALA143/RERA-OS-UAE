import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { LoadingSkeleton } from '../ui/Table';
import { Calculator, Play } from 'lucide-react';
import { KpiStatusBadge } from './KpiStatusBadge';
import type { CompanyKpiAuditResult } from '../../types/kpiAudit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface AuditPayload {
  run_id?: string;
  run_at?: string;
  summary?: {
    companies_total: number;
    companies_with_data: number;
    total_mismatches: number;
    total_check_logic: number;
  };
  portfolio_ops_rows?: CompanyKpiAuditResult['rows'];
  companies?: CompanyKpiAuditResult[];
  message?: string;
}

interface Props {
  embedded?: boolean;
}

/** CA firm workspace — all companies, all KPI formulas, inputs, and match status. */
export function KpiCalculationsReviewPanel({ embedded }: Props) {
  const { profile, isKpiReviewer } = useAuth();
  const [companies, setCompanies] = useState<{ id: string; company_name: string }[]>([]);
  const [companyId, setCompanyId] = useState('all');
  const [period, setPeriod] = useState<string>('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  const [error, setError] = useState('');

  const loadCompanies = useCallback(async () => {
    const { data } = await api.get<{ id: string; company_name: string }[]>('/api/rentals/companies');
    setCompanies(Array.isArray(data) ? data : []);
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const { data } = await api.get<AuditPayload>('/api/admin/kpi-sanity/latest');
      if (!data.message) setPayload(data);
    } catch {
      /* no prior run */
    }
  }, []);

  useEffect(() => {
    if (!isKpiReviewer) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await api.get('/api/admin/kpi-sanity/access');
        if (cancelled) return;
        await Promise.all([loadCompanies(), loadLatest()]);
      } catch {
        /* access denied */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isKpiReviewer, loadCompanies, loadLatest]);

  const runCheck = async () => {
    setRunning(true);
    setError('');
    try {
      const params: Record<string, string | number> = { month, year };
      if (period) params.period = period;
      if (companyId !== 'all') params.company_id = companyId;
      const { data } = await api.post<AuditPayload>('/api/admin/kpi-sanity/run', null, { params });
      setPayload(data);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Calculation review run failed');
    } finally {
      setRunning(false);
    }
  };

  const displayedCompanies = useMemo(() => {
    if (!payload?.companies) return [];
    if (companyId === 'all') return payload.companies;
    return payload.companies.filter(c => c.company_id === companyId);
  }, [payload, companyId]);

  if (!isKpiReviewer) {
    return (
      <p className="text-sm text-gray-500 py-8 text-center">
        Calculations review is for CA firm internal reviewer accounts only.
      </p>
    );
  }

  if (loading) return <LoadingSkeleton rows={6} />;

  const summary = payload?.summary;

  return (
    <div className={`space-y-6 ${embedded ? '' : 'max-w-7xl mx-auto'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="text-amber-700" size={22} />
            <h1 className={`font-bold text-gray-900 ${embedded ? 'text-xl' : 'text-2xl'}`}>
              Calculations Review
            </h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Cross-check every KPI — formula, raw P&amp;L/BS inputs, step-by-step value, and live dashboard match status
            across all client companies before delivery. Includes <strong>Rental Portfolio Overview</strong> and{' '}
            <strong>AR Dashboard</strong> operational KPIs (collections, DSO, credit balances).
          </p>
          {profile?.email && (
            <p className="text-xs text-gray-400 mt-0.5">CA firm reviewer: {profile.email}</p>
          )}
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-700 text-white rounded-lg text-sm hover:bg-amber-800 disabled:opacity-50"
        >
          <Play size={14} />
          {running ? 'Running…' : companyId === 'all' ? 'Review All Companies' : 'Run Review'}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Company</label>
          <select
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm min-w-[200px]"
          >
            <option value="all">All Companies</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Period Window</label>
          <select value={period} onChange={e => setPeriod(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Single Month</option>
            <option value="MoM">MoM</option>
            <option value="YTD">YTD</option>
            <option value="TTM">TTM</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Month</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Year</label>
          <input
            type="number"
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border rounded-lg px-3 py-2 text-sm w-24"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Companies w/ data', `${summary.companies_with_data}/${summary.companies_total}`],
            ['Mismatches', String(summary.total_mismatches)],
            ['Logic flags', String(summary.total_check_logic)],
            ['Last run', payload?.run_at ? new Date(payload.run_at).toLocaleString() : '—'],
          ].map(([label, value]) => (
            <div key={label} className="bg-white border rounded-lg p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-lg font-semibold font-mono">{value}</p>
            </div>
          ))}
        </div>
      )}

      {companyId === 'all' && payload?.portfolio_ops_rows && payload.portfolio_ops_rows.length > 0 && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold text-base bg-slate-50">
            Portfolio — Rental Overview &amp; AR Dashboard
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-base leading-relaxed">
              <thead className="bg-gray-50 text-sm text-gray-600 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">KPI</th>
                  <th className="px-4 py-3 text-left">Formula</th>
                  <th className="px-4 py-3 text-left">Raw Inputs</th>
                  <th className="px-4 py-3 text-left">Substitution</th>
                  <th className="px-4 py-3 text-right">Calculated</th>
                  <th className="px-4 py-3 text-right">Live Display</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payload.portfolio_ops_rows.map(row => (
                  <tr key={`${row.section}-${row.kpi}`}>
                    <td className="px-4 py-3 font-medium whitespace-nowrap align-top">
                      <div className="text-base">{row.kpi}</div>
                      <div className="text-sm text-gray-500 mt-0.5">{row.section}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[220px] align-top text-[15px]">{row.formula}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[200px] align-top text-[15px]">
                      {Object.entries(row.inputs_detail || {}).map(([k, v]) => (
                        <div key={k}>{k}: {v}</div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[240px] whitespace-pre-wrap align-top font-mono text-sm">
                      {row.substitution || '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-green-800 align-top text-base">
                      {row.canonical_display}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold align-top text-base">
                      {row.displayed_display}
                    </td>
                    <td className="px-4 py-3 text-center align-top">
                      <KpiStatusBadge status={row.status} />
                      {row.notes && (
                        <p className="text-sm text-amber-800 mt-2 max-w-[180px] mx-auto">{row.notes}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {companyId === 'all' && payload?.companies && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold text-base">Portfolio Summary</div>
          <table className="w-full text-base">
            <thead className="bg-gray-50 text-sm text-gray-600 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Company</th>
                <th className="px-4 py-3 text-left">Period</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Mismatches</th>
                <th className="px-4 py-3 text-right">Logic Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payload.companies.map(co => (
                <tr
                  key={co.company_id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setCompanyId(co.company_id)}
                >
                  <td className="px-4 py-3 font-medium">{co.company_name}</td>
                  <td className="px-4 py-3 text-gray-600">{co.period_label}</td>
                  <td className="px-4 py-3 text-center"><KpiStatusBadge status={co.summary_status} /></td>
                  <td className="px-4 py-3 text-right font-mono">{co.mismatch_count}</td>
                  <td className="px-4 py-3 text-right font-mono">{co.check_logic_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {displayedCompanies.map(co => (
        <div key={co.company_id} className="bg-white border rounded-xl overflow-hidden">
          <div
            className={`px-4 py-3 border-b flex items-center justify-between ${
              co.summary_status === 'MATCH' ? 'bg-green-50'
                : co.summary_status === 'MISMATCH' ? 'bg-red-50' : 'bg-amber-50'
            }`}
          >
            <div>
              <h2 className="font-semibold text-lg">{co.company_name}</h2>
              <p className="text-sm text-gray-500">{co.period_label}</p>
            </div>
            <KpiStatusBadge status={co.summary_status} />
          </div>

          {!co.has_data ? (
            <p className="p-6 text-center text-gray-400 text-sm">
              No financial upload for this company — upload P&amp;L/BS under Financials first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-base leading-relaxed">
                <thead className="bg-gray-50 text-sm text-gray-600 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left">KPI</th>
                    <th className="px-4 py-3 text-left">Formula</th>
                    <th className="px-4 py-3 text-left">Raw Inputs</th>
                    <th className="px-4 py-3 text-left">Substitution</th>
                    <th className="px-4 py-3 text-right">Calculated</th>
                    <th className="px-4 py-3 text-right">Live Display</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {co.rows.map(row => (
                    <tr
                      key={row.kpi}
                      className={
                        row.status === 'MISMATCH' ? 'bg-red-50/60'
                          : row.status === 'CHECK_LOGIC' ? 'bg-amber-50/60' : ''
                      }
                    >
                      <td className="px-4 py-3 font-medium whitespace-nowrap align-top">
                        <div className="text-base">{row.kpi}</div>
                        <div className="text-sm text-gray-500 mt-0.5">{row.section}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-[220px] align-top text-[15px]">{row.formula}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px] align-top text-[15px]">
                        {Object.entries(row.inputs_detail || {}).map(([k, v]) => (
                          <div key={k}>{k}: {v}</div>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-[240px] whitespace-pre-wrap align-top font-mono text-sm">
                        {row.substitution || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-green-800 align-top text-base">
                        {row.canonical_display}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold align-top text-base">
                        {row.displayed_display}
                      </td>
                      <td className="px-4 py-3 text-center align-top">
                        <KpiStatusBadge status={row.status} />
                        {row.notes && (
                          <p className="text-sm text-amber-800 mt-2 max-w-[180px] mx-auto">{row.notes}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {!payload && !running && (
        <p className="text-center text-gray-400 text-sm py-8">
          Click &quot;Review All Companies&quot; to run the first calculation cross-check.
        </p>
      )}
    </div>
  );
}
