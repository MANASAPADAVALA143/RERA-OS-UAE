import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { LoadingSkeleton } from '../components/ui/Table';
import { AlertTriangle, CheckCircle2, Play, Shield, XCircle } from 'lucide-react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface KpiRow {
  kpi: string;
  section: string;
  formula: string;
  raw_inputs: Record<string, string>;
  canonical_value: number | null;
  canonical_display: string;
  displayed_value: number | null;
  displayed_display: string;
  difference: number | null;
  difference_pct: number | null;
  status: 'MATCH' | 'MISMATCH' | 'CHECK_LOGIC' | 'INSUFFICIENT_DATA';
  notes?: string;
}

interface CompanyResult {
  company_id: string;
  company_name: string;
  period_label: string;
  has_data: boolean;
  summary_status: string;
  mismatch_count: number;
  check_logic_count: number;
  rows: KpiRow[];
}

interface AuditPayload {
  run_id?: string;
  run_at?: string;
  summary?: {
    companies_total: number;
    companies_with_data: number;
    total_mismatches: number;
    total_check_logic: number;
  };
  companies?: CompanyResult[];
  message?: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'MATCH') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800"><CheckCircle2 size={12} /> MATCH</span>;
  }
  if (status === 'MISMATCH') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-800"><XCircle size={12} /> MISMATCH</span>;
  }
  if (status === 'CHECK_LOGIC') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-900"><AlertTriangle size={12} /> CHECK LOGIC</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">NO DATA</span>;
}

export default function KpiSanityCheck() {
  const { profile } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [companies, setCompanies] = useState<{ id: string; company_name: string }[]>([]);
  const [companyId, setCompanyId] = useState('all');
  const [period, setPeriod] = useState<string>('');
  const [month, setMonth] = useState(6);
  const [year, setYear] = useState(2026);
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
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await api.get('/api/admin/kpi-sanity/access');
        if (cancelled) return;
        setAllowed(true);
        await Promise.all([loadCompanies(), loadLatest()]);
      } catch {
        if (!cancelled) setAllowed(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadCompanies, loadLatest]);

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
      setError(typeof detail === 'string' ? detail : 'Audit run failed');
    } finally {
      setRunning(false);
    }
  };

  const displayedCompanies = useMemo(() => {
    if (!payload?.companies) return [];
    if (companyId === 'all') return payload.companies;
    return payload.companies.filter(c => c.company_id === companyId);
  }, [payload, companyId]);

  if (loading) return <LoadingSkeleton rows={6} />;
  if (allowed === false) return <Navigate to="/executive-summary" replace />;

  const summary = payload?.summary;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="text-indigo-700" size={22} />
            <h1 className="text-2xl font-bold text-gray-900">KPI Sanity Check</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Admin QA — recompute KPIs from raw P&amp;L/BS and compare to live dashboard display logic
          </p>
          {profile?.email && <p className="text-xs text-gray-400 mt-0.5">Signed in as {profile.email}</p>}
        </div>
        <button
          onClick={runCheck}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm hover:bg-indigo-800 disabled:opacity-50"
        >
          <Play size={14} /> {running ? 'Running…' : companyId === 'all' ? 'Check All Companies' : 'Run Check'}
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Company</label>
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} className="border rounded-lg px-3 py-2 text-sm min-w-[200px]">
            <option value="all">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
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
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm w-24" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Companies w/ data', `${summary.companies_with_data}/${summary.companies_total}`],
            ['Mismatches', String(summary.total_mismatches)],
            ['Logic checks', String(summary.total_check_logic)],
            ['Last run', payload?.run_at ? new Date(payload.run_at).toLocaleString() : '—'],
          ].map(([label, value]) => (
            <div key={label} className="bg-white border rounded-lg p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-lg font-semibold font-mono">{value}</p>
            </div>
          ))}
        </div>
      )}

      {companyId === 'all' && payload?.companies && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-semibold text-sm">All Companies Summary</div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Company</th>
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Mismatches</th>
                <th className="px-3 py-2 text-right">Logic Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payload.companies.map(co => (
                <tr key={co.company_id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setCompanyId(co.company_id)}>
                  <td className="px-3 py-2 font-medium">{co.company_name}</td>
                  <td className="px-3 py-2 text-gray-500">{co.period_label}</td>
                  <td className="px-3 py-2 text-center"><StatusBadge status={co.summary_status} /></td>
                  <td className="px-3 py-2 text-right font-mono">{co.mismatch_count}</td>
                  <td className="px-3 py-2 text-right font-mono">{co.check_logic_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {displayedCompanies.map(co => (
        <div key={co.company_id} className="bg-white border rounded-xl overflow-hidden">
          <div className={`px-4 py-3 border-b flex items-center justify-between ${co.summary_status === 'MATCH' ? 'bg-green-50' : co.summary_status === 'MISMATCH' ? 'bg-red-50' : 'bg-amber-50'}`}>
            <div>
              <h2 className="font-semibold">{co.company_name}</h2>
              <p className="text-xs text-gray-500">{co.period_label}</p>
            </div>
            <StatusBadge status={co.summary_status} />
          </div>

          {!co.has_data ? (
            <p className="p-6 text-center text-gray-400 text-sm">Insufficient data — no financial upload for this company</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">KPI</th>
                    <th className="px-3 py-2 text-left">Formula</th>
                    <th className="px-3 py-2 text-left">Raw Inputs (sample)</th>
                    <th className="px-3 py-2 text-right">Recomputed</th>
                    <th className="px-3 py-2 text-right">Live Display</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {co.rows.map(row => (
                    <tr key={row.kpi} className={row.status === 'MISMATCH' ? 'bg-red-50/60' : row.status === 'CHECK_LOGIC' ? 'bg-amber-50/60' : ''}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">
                        <div>{row.kpi}</div>
                        <div className="text-gray-400">{row.section}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-600 max-w-[200px]">{row.formula}</td>
                      <td className="px-3 py-2 text-gray-500 max-w-[220px]">
                        <div>Revenue: {row.raw_inputs['Total Revenue']}</div>
                        <div>Expenses: {row.raw_inputs['Total Expenses']}</div>
                        <div>Interest: {row.raw_inputs['Interest Paid']}</div>
                        <div>NOI: {row.raw_inputs['NOI']}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-green-800">{row.canonical_display}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{row.displayed_display}</td>
                      <td className="px-3 py-2 text-center">
                        <StatusBadge status={row.status} />
                        {row.notes && <p className="text-[10px] text-amber-800 mt-1 max-w-[140px]">{row.notes}</p>}
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
        <p className="text-center text-gray-400 text-sm py-8">Click &quot;Check All Companies&quot; to run the first audit.</p>
      )}
    </div>
  );
}
