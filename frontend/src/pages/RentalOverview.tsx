import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PieChart, Pie,
} from 'recharts';
import { X } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';
import { useRentalNav } from '../contexts/RentalNavContext';

// ── constants ─────────────────────────────────────────────────────────────────

const MONTH_OPTIONS = [
  { value: '2026-01', label: 'January 2026' },
  { value: '2026-02', label: 'February 2026' },
  { value: '2026-03', label: 'March 2026' },
  { value: '2026-04', label: 'April 2026' },
  { value: '2026-05', label: 'May 2026' },
  { value: '2026-06', label: 'June 2026' },
  { value: '2026-07', label: 'July 2026' },
  { value: '2026-08', label: 'August 2026' },
  { value: '2026-09', label: 'September 2026' },
  { value: '2026-10', label: 'October 2026' },
  { value: '2026-11', label: 'November 2026' },
  { value: '2026-12', label: 'December 2026' },
];

const MONTHS_ORDER = [
  'Jan-2026','Feb-2026','Mar-2026','Apr-2026','May-2026','Jun-2026',
  'Jul-2026','Aug-2026','Sep-2026','Oct-2026','Nov-2026','Dec-2026',
];

function serverMonth(): string {
  // Default to the real current month based on server date
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface CompanySummary {
  company_id: string;
  company_name: string;
  occupancy_pct: number;
  noi_this_month: number;
  occupied_units: number;
  total_units: number;
  vacant_units: number;
  collected_this_month: number;
  billed_this_month: number;
  gross_potential_rent: number;
  vacancy_loss: number;
  arrears_total: number;
  total_expense_this_month: number;
  collected_source?: string;
}

interface PortfolioSummary {
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_pct: number;
  gross_potential_rent: number;
  billed_this_month: number;
  collected_this_month: number;
  noi_this_month: number;
  arrears_total: number;
  vacancy_loss: number;
  total_expense_this_month: number;
  partner_share_payable: number;
  has_partner_data: boolean;
  collected_source: string;
  by_company: CompanySummary[];
  arrears_aging: { '0_30': number; '31_60': number; '61_90': number; '90_plus': number };
  income_trend: { month: string; billed: number; collected: number; expense: number; noi: number }[];
  lease_expiry_pipeline: { lease_end: string; days_until_expiry: number; unit_number: string | null; company_name: string | null; tenant_name: string | null }[];
  attention_now: { type: string; message: string; severity: 'warning' | 'attention' }[];
}

interface SyncCompany {
  id: string;
  company_name: string;
  last_sync_month: string | null;
  monthly_rent_data: Record<string, number> | null;
  sync_collected: number | null;
  sync_gross_potential: number | null;
  sync_vacancy_loss: number | null;
  sync_occupied_units: number | null;
  sync_total_units: number | null;
}

// ── skeleton loaders ──────────────────────────────────────────────────────────

function SkeletonKpi() {
  return (
    <div className="rounded-xl p-5 animate-pulse" style={{ background: '#F7F5F0', border: '1px solid #DDD8CC' }}>
      <div className="h-3 rounded w-2/3 mb-3" style={{ background: '#DDD8CC' }} />
      <div className="h-7 rounded w-1/2" style={{ background: '#DDD8CC' }} />
    </div>
  );
}

function SkeletonChart() {
  return (
    <div className="rounded-xl p-5 animate-pulse" style={{ background: '#F7F5F0', border: '1px solid #DDD8CC' }}>
      <div className="h-4 rounded w-1/3 mb-4" style={{ background: '#DDD8CC' }} />
      <div className="h-52 rounded" style={{ background: '#DDD8CC' }} />
    </div>
  );
}

// ── tooltip style shared ──────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  contentStyle: { background: '#F7F5F0', border: '1px solid #DDD8CC', color: '#1C1917', borderRadius: 8 },
  labelStyle: { color: '#92400E' },
};

const TICK_STYLE = { fill: '#92400E', fontSize: 11 };
const SELECT_STYLE: React.CSSProperties = {
  background: '#F7F5F0', border: '1px solid #DDD8CC', color: '#1C1917',
  borderRadius: '0.5rem', padding: '0.375rem 0.75rem', fontSize: '0.875rem',
};

// ── main component ────────────────────────────────────────────────────────────

export default function RentalOverview() {
  const { setTab } = useRentalNav();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedMonth   = searchParams.get('month')   || serverMonth();
  const selectedCoId    = searchParams.get('company')  || '';

  const [data, setData]                   = useState<PortfolioSummary | null>(null);
  const [syncCompanies, setSyncCompanies] = useState<SyncCompany[]>([]);
  const [loading, setLoading]             = useState(true);
  const [fetching, setFetching]           = useState(false);
  const [error, setError]                 = useState('');
  const isFirstLoad = useRef(true);

  // ── data fetching ──────────────────────────────────────────────────────────

  const fetchData = useCallback(async (month: string) => {
    setFetching(true);
    setError('');
    try {
      const res = await api.get<PortfolioSummary>(`/api/rentals/portfolio-summary?month=${month}`);
      setData(res.data);
    } catch {
      setError('Failed to load portfolio summary.');
    } finally {
      setLoading(false);
      setFetching(false);
    }
    try {
      const coRes = await api.get<SyncCompany[]>('/api/rentals/companies');
      setSyncCompanies(Array.isArray(coRes.data) ? coRes.data : []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      setLoading(true);
    }
    fetchData(selectedMonth);
  }, [fetchData, selectedMonth]);

  // ── URL param setters ──────────────────────────────────────────────────────

  const setMonth = (m: string) =>
    setSearchParams(prev => { prev.set('month', m); prev.delete('company'); return new URLSearchParams(prev); });

  const setCompany = (id: string) =>
    setSearchParams(prev => { id ? prev.set('company', id) : prev.delete('company'); return new URLSearchParams(prev); });

  const clearCompany = () => setCompany('');

  // ── derived data ───────────────────────────────────────────────────────────

  const selectedCo = useMemo(
    () => (!selectedCoId || !data) ? null : data.by_company.find(c => c.company_id === selectedCoId) ?? null,
    [data, selectedCoId],
  );

  const selectedCoName = selectedCo?.company_name ?? '';

  // Data-source flag: respect per-company source when a company is filtered
  const collectedSource = selectedCo?.collected_source ?? data?.collected_source ?? '';
  const hasPartnerData  = data?.has_partner_data ?? true;

  // KPIs: company-filtered or portfolio-level
  const kpis = useMemo(() => {
    if (!data) return null;
    if (selectedCo) {
      return {
        total_units:             selectedCo.total_units ?? 0,
        occupied_units:          selectedCo.occupied_units ?? 0,
        vacant_units:            selectedCo.vacant_units ?? (selectedCo.total_units ?? 0) - (selectedCo.occupied_units ?? 0),
        occupancy_pct:           selectedCo.occupancy_pct ?? 0,
        collected_this_month:    selectedCo.collected_this_month ?? 0,
        billed_this_month:       selectedCo.billed_this_month ?? 0,
        noi_this_month:          selectedCo.noi_this_month ?? 0,
        gross_potential_rent:    selectedCo.gross_potential_rent ?? 0,
        vacancy_loss:            selectedCo.vacancy_loss ?? 0,
        arrears_total:           selectedCo.arrears_total ?? 0,
        total_expense_this_month: selectedCo.total_expense_this_month ?? 0,
        partner_share_payable:   data.partner_share_payable ?? 0,
      };
    }
    return {
      total_units:             data.total_units ?? 0,
      occupied_units:          data.occupied_units ?? 0,
      vacant_units:            data.vacant_units ?? 0,
      occupancy_pct:           data.occupancy_pct ?? 0,
      collected_this_month:    data.collected_this_month ?? 0,
      billed_this_month:       data.billed_this_month ?? 0,
      noi_this_month:          data.noi_this_month ?? 0,
      gross_potential_rent:    data.gross_potential_rent ?? 0,
      vacancy_loss:            data.vacancy_loss ?? 0,
      arrears_total:           data.arrears_total ?? 0,
      total_expense_this_month: data.total_expense_this_month ?? 0,
      partner_share_payable:   data.partner_share_payable ?? 0,
    };
  }, [data, selectedCo]);

  // Occupancy bar chart data — highlight selected company
  const occupancyChartData = useMemo(() => {
    if (!data) return [];
    return data.by_company.map(c => ({
      name: c.company_name.length > 13 ? c.company_name.slice(0, 11) + '…' : c.company_name,
      company_id: c.company_id,
      occupancy_pct: parseFloat((c.occupancy_pct * 100).toFixed(1)),
    }));
  }, [data]);

  // NOI bar chart data
  const noiChartData = useMemo(() => {
    if (!data) return [];
    return data.by_company.map(c => ({
      name: c.company_name.length > 13 ? c.company_name.slice(0, 11) + '…' : c.company_name,
      company_id: c.company_id,
      noi: c.noi_this_month,
    }));
  }, [data]);

  // Income trend — company-specific (from monthly_rent_data) or portfolio
  const trendData = useMemo(() => {
    if (!data) return [];
    const syncTarget = selectedCoId
      ? syncCompanies.filter(c => c.id === selectedCoId)
      : syncCompanies;

    if (syncTarget.some(c => c.monthly_rent_data)) {
      const map = new Map<string, number>();
      for (const co of syncTarget) {
        if (!co.monthly_rent_data) continue;
        for (const [m, amt] of Object.entries(co.monthly_rent_data)) {
          map.set(m, (map.get(m) ?? 0) + (amt as number));
        }
      }
      const points = MONTHS_ORDER
        .filter(m => (map.get(m) ?? 0) > 0)
        .slice(-6)
        .map(m => ({ month: m, collected: map.get(m) ?? 0, billed: 0, expense: 0, noi: 0 }));
      if (points.length > 0) return points;
    }
    return data.income_trend;
  }, [data, selectedCoId, syncCompanies]);

  // Sync banner info
  const lastSyncMonth = useMemo(() => {
    if (selectedCoId) return syncCompanies.find(c => c.id === selectedCoId)?.last_sync_month ?? '';
    return syncCompanies.find(c => c.last_sync_month)?.last_sync_month ?? '';
  }, [syncCompanies, selectedCoId]);

  const monthLabel = MONTH_OPTIONS.find(o => o.value === selectedMonth)?.label ?? selectedMonth;

  // Occupancy gauge data (0-100%)
  const occupancyGaugeData = useMemo(() => {
    if (!kpis) return [];
    return [{
      name: 'Occupancy',
      value: parseFloat((kpis.occupancy_pct * 100).toFixed(1)),
      fill: (kpis.occupancy_pct * 100) >= 80 ? '#10B981' : (kpis.occupancy_pct * 100) >= 60 ? '#F59E0B' : '#EF4444',
    }];
  }, [kpis]);

  // Occupied vs Vacant donut data
  const occupiedVacantData = useMemo(() => {
    if (!kpis) return [];
    return [
      { name: 'Occupied', value: kpis.occupied_units, fill: '#10B981' },
      { name: 'Vacant', value: kpis.vacant_units, fill: '#EF4444' },
    ];
  }, [kpis]);

  // Gross Potential Rent by company donut data
  const rentCompositionData = useMemo(() => {
    if (!data) return [];
    return data.by_company
      .filter(c => c.gross_potential_rent > 0)
      .map(c => ({
        name: c.company_name.length > 20 ? c.company_name.slice(0, 18) + '…' : c.company_name,
        value: c.gross_potential_rent,
      }))
      .sort((a, b) => b.value - a.value);
  }, [data]);

  // ── chart click handler ────────────────────────────────────────────────────

  function handleBarClick(payload: { company_id?: string } | undefined) {
    if (!payload?.company_id) return;
    if (selectedCoId === payload.company_id) clearCompany();
    else setCompany(payload.company_id);
  }

  // ── loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 rounded w-64 animate-pulse" style={{ background: '#F7F5F0' }} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonKpi key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonChart key={i} />)}
        </div>
      </div>
    );
  }

  if (error || !data || !kpis) {
    return (
      <div className="p-4" style={{ color: '#F87171' }}>
        {error || 'No data'}
        <button className="ml-4 underline" style={{ color: '#D4AF37' }} onClick={() => fetchData(selectedMonth)}>
          Retry
        </button>
      </div>
    );
  }

  const agingData = [
    { bucket: 'Current',  amount: data.arrears_aging['current'] ?? 0 },
    { bucket: '1–30d',    amount: data.arrears_aging['1_30'] ?? 0 },
    { bucket: '31–60d',   amount: data.arrears_aging['31_60'] ?? 0 },
    { bucket: '61–90d',   amount: data.arrears_aging['61_90'] ?? 0 },
    { bucket: '90+d',     amount: data.arrears_aging['90_plus'] ?? 0 },
  ];

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1C1917' }}>Rental Portfolio — Overview</h1>
          <p className="text-sm mt-0.5" style={{ color: '#A8A29E' }}>
            Power BI drill-down · {monthLabel}
          </p>
        </div>
        <button
          onClick={() => setTab('portfolio-upload')}
          style={{ background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', color: 'white' }}
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg font-medium"
        >
          📊 Sync Rent Data
        </button>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl" style={{ background: '#F0EDE5', border: '1px solid #DDD8CC' }}>
        {/* Month */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: '#A8A29E' }}>PERIOD</span>
          <select value={selectedMonth} onChange={e => setMonth(e.target.value)} style={SELECT_STYLE}>
            {MONTH_OPTIONS.map(o => (
              <option key={o.value} value={o.value} style={{ background: '#F7F5F0' }}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Company */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: '#A8A29E' }}>COMPANY</span>
          <select value={selectedCoId} onChange={e => setCompany(e.target.value)} style={SELECT_STYLE}>
            <option value="" style={{ background: '#F7F5F0' }}>All Companies</option>
            {data.by_company.map(c => (
              <option key={c.company_id} value={c.company_id} style={{ background: '#F7F5F0' }}>{c.company_name}</option>
            ))}
          </select>
        </div>

        {/* Active filter badge / entity count */}
        <div className="flex items-center gap-2 ml-auto">
          {selectedCoId && selectedCoName ? (
            <>
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid #3B82F6', color: '#D4AF37' }}
              >
                Viewing: {selectedCoName}
              </span>
              <button
                onClick={clearCompany}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#F87171' }}
              >
                <X size={11} /> Reset
              </button>
            </>
          ) : (
            <span className="text-xs" style={{ color: '#A8A29E' }}>
              All Companies · {data.by_company.length} entities
            </span>
          )}
          {fetching && (
            <span className="text-xs animate-pulse" style={{ color: '#D4AF37' }}>Loading…</span>
          )}
        </div>
      </div>

      {/* ── Sync banner ─────────────────────────────────────────────────────── */}
      {lastSyncMonth && (
        <div className="rounded-xl px-4 py-2.5 flex items-center gap-3"
          style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <span className="text-xs font-semibold" style={{ color: '#34D399' }}>
            ✅ Excel synced — {lastSyncMonth}
          </span>
          <span className="text-xs" style={{ color: '#6EE7B7' }}>
            Collected figures auto-loaded from rent receivable upload
          </span>
        </div>
      )}

      {/* ── 8 KPI tiles ─────────────────────────────────────────────────────── */}
      {fetching ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonKpi key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Occupancy Rate"
            value={fmtPct(kpis.occupancy_pct)}
            sub={`${kpis.occupied_units} / ${kpis.total_units} units`}
            accent
          />
          <KpiCard
            label="Occupied / Vacant"
            value={`${kpis.occupied_units} / ${kpis.vacant_units}`}
            sub={`${kpis.total_units} total units`}
          />
          <KpiCard
            label="Collected This Month"
            value={fmtUSD(kpis.collected_this_month)}
            sub={
              collectedSource === 'pl_fallback'
                ? `from P&L · ${kpis.billed_this_month > 0 ? `of ${fmtUSD(kpis.billed_this_month)} billed` : monthLabel}`
                : kpis.billed_this_month > 0
                  ? `of ${fmtUSD(kpis.billed_this_month)} billed`
                  : monthLabel
            }
            gradient="teal"
          />
          <KpiCard
            label="NOI This Month"
            value={fmtUSD(kpis.noi_this_month)}
            sub={
              collectedSource === 'pl_fallback'
                ? `from P&L · Exp: ${fmtUSD(kpis.total_expense_this_month)}`
                : `Expenses: ${fmtUSD(kpis.total_expense_this_month)}`
            }
            gradient="blue"
          />
          <KpiCard
            label="Gross Potential Rent"
            value={fmtUSD(kpis.gross_potential_rent)}
          />
          <KpiCard
            label="Vacancy Loss"
            value={fmtUSD(kpis.vacancy_loss)}
            sub={`${kpis.vacant_units} vacant units`}
          />
          <KpiCard
            label="Arrears Outstanding"
            value={fmtUSD(kpis.arrears_total)}
          />
          <KpiCard
            label="Partner Share Payable"
            value={hasPartnerData ? fmtUSD(kpis.partner_share_payable) : '—'}
            sub={!hasPartnerData ? 'Partner data not yet configured' : undefined}
          />
        </div>
      )}

      {/* ── Attention Now ────────────────────────────────────────────────────── */}
      {data.attention_now.length > 0 && (
        <Card title="Attention Now">
          <div className="space-y-2">
            {data.attention_now.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
                style={item.severity === 'warning'
                  ? { background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }
                  : { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#FCD34D' }
                }
              >
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={item.severity === 'warning'
                    ? { background: 'rgba(239,68,68,0.25)', color: '#FCA5A5' }
                    : { background: 'rgba(245,158,11,0.25)', color: '#FCD34D' }
                  }
                >
                  {item.severity === 'warning' ? 'WARNING' : 'ATTENTION'}
                </span>
                {item.message}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Charts 2×2 ──────────────────────────────────────────────────────── */}
      {fetching ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonChart key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Occupancy by Company */}
          <Card title={selectedCoName ? `Occupancy — ${selectedCoName}` : 'Occupancy by Company'}>
            {!selectedCoId && (
              <p className="text-xs mb-1" style={{ color: '#A8A29E' }}>
                Click a bar to drill into that company
              </p>
            )}
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={occupancyChartData}
                onClick={d => handleBarClick(d?.activePayload?.[0]?.payload)}
                style={{ cursor: 'pointer' }}
              >
                <XAxis dataKey="name" tick={{ ...TICK_STYLE, fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={TICK_STYLE} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} {...TOOLTIP_STYLE} />
                <Bar dataKey="occupancy_pct" name="Occupancy %" radius={[4, 4, 0, 0]}>
                  {occupancyChartData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={selectedCoId === entry.company_id ? '#D4AF37' : '#D4AF37'}
                      opacity={selectedCoId && selectedCoId !== entry.company_id ? 0.45 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Income trend */}
          <Card title={selectedCoName ? `Income Trend — ${selectedCoName}` : 'Income — 6 Months'}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData}>
                <XAxis dataKey="month" tick={{ ...TICK_STYLE, fontSize: 10 }} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={TICK_STYLE} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ color: '#92400E', fontSize: 12 }} />
                <Line type="monotone" dataKey="collected" stroke="#D4AF37" name="Collected" strokeWidth={2} dot={false} />
                {trendData.some(d => d.expense > 0) && (
                  <Line type="monotone" dataKey="expense" stroke="#EF4444" name="Expense" strokeWidth={2} dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Arrears aging */}
          <Card title="Arrears Aging">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={agingData}>
                <XAxis dataKey="bucket" tick={TICK_STYLE} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={TICK_STYLE} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} {...TOOLTIP_STYLE} />
                <Bar dataKey="amount" fill="#EF4444" name="Arrears" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* NOI by Company */}
          <Card title={selectedCoName ? `NOI Trend — ${selectedCoName}` : 'NOI by Company'}>
            {!selectedCoId && (
              <p className="text-xs mb-1" style={{ color: '#A8A29E' }}>
                Click a bar to drill into that company
              </p>
            )}
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={noiChartData}
                onClick={d => handleBarClick(d?.activePayload?.[0]?.payload)}
                style={{ cursor: 'pointer' }}
              >
                <XAxis dataKey="name" tick={{ ...TICK_STYLE, fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={TICK_STYLE} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} {...TOOLTIP_STYLE} />
                <Bar dataKey="noi" name="NOI" radius={[4, 4, 0, 0]}>
                  {noiChartData.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={selectedCoId === entry.company_id ? '#D4AF37' : '#D4AF37'}
                      opacity={selectedCoId && selectedCoId !== entry.company_id ? 0.45 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ── Additional Charts: Gauge + Donuts ─────────────────────────────────── */}
      {!fetching && data && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Occupancy Gauge */}
          <Card title="Occupancy Rate Gauge">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Occupied', value: kpis.occupancy_pct * 100 },
                    { name: 'Vacant', value: 100 - (kpis.occupancy_pct * 100) },
                  ]}
                  cx="50%"
                  cy="50%"
                  startAngle={180}
                  endAngle={0}
                  innerRadius={60}
                  outerRadius={90}
                  dataKey="value"
                >
                  <Cell fill={kpis.occupancy_pct >= 0.8 ? '#10B981' : kpis.occupancy_pct >= 0.6 ? '#F59E0B' : '#EF4444'} />
                  <Cell fill="#F7F5F0" />
                </Pie>
              </PieChart>
              <div className="text-center mt-4">
                <div className="text-3xl font-bold" style={{ color: '#1C1917' }}>
                  {(kpis.occupancy_pct * 100).toFixed(1)}%
                </div>
                <div className="text-xs" style={{ color: '#92400E' }}>
                  {kpis.occupied_units} of {kpis.total_units} units
                </div>
              </div>
            </ResponsiveContainer>
          </Card>

          {/* Occupied vs Vacant Donut */}
          <Card title="Occupied vs Vacant Units">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={occupiedVacantData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {occupiedVacantData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `${value} units`} {...TOOLTIP_STYLE} />
              </PieChart>
              <div className="text-center mt-2 space-y-1">
                <div style={{ color: '#10B981' }} className="text-sm">
                  ● {kpis.occupied_units} Occupied
                </div>
                <div style={{ color: '#EF4444' }} className="text-sm">
                  ● {kpis.vacant_units} Vacant
                </div>
              </div>
            </ResponsiveContainer>
          </Card>

          {/* Gross Potential Rent by Company Donut */}
          <Card title="Gross Potential Rent by Company">
            {rentCompositionData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={rentCompositionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {rentCompositionData.map((entry, index) => {
                        const colors = ['#D4AF37', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#06B6D4', '#EF4444'];
                        return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                      })}
                    </Pie>
                    <Tooltip formatter={(value: number) => fmtUSD(value)} {...TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-center mt-2 text-xs space-y-1" style={{ color: '#92400E' }}>
                  {rentCompositionData.slice(0, 3).map((item, i) => (
                    <div key={i}>{item.name}: {fmtUSD(item.value)}</div>
                  ))}
                  {rentCompositionData.length > 3 && (
                    <div>+{rentCompositionData.length - 3} more</div>
                  )}
                </div>
              </>
            ) : (
              <p style={{ color: '#92400E' }} className="text-center py-12">No data available</p>
            )}
          </Card>
        </div>
      )}

      {/* ── Lease expiry pipeline ────────────────────────────────────────────── */}
      {data.lease_expiry_pipeline.length > 0 && (
        <Card title="Upcoming Lease Expirations (next 90 days)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: '#DDD8CC' }}>
                  {['Unit', 'Company', 'Tenant', 'Lease End', 'Days Left'].map(h => (
                    <th key={h} className="py-2 px-2 font-medium" style={{ color: '#A8A29E' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.lease_expiry_pipeline
                  .filter(l => !selectedCoName || l.company_name === selectedCoName)
                  .map((l, i) => (
                    <tr key={i} className="border-b" style={{ borderColor: '#F7F5F0' }}>
                      <td className="py-2 px-2" style={{ color: '#1C1917' }}>{l.unit_number || '—'}</td>
                      <td className="py-2 px-2" style={{ color: '#92400E' }}>{l.company_name || '—'}</td>
                      <td className="py-2 px-2" style={{ color: '#92400E' }}>{l.tenant_name || '—'}</td>
                      <td className="py-2 px-2" style={{ color: '#92400E' }}>{l.lease_end}</td>
                      <td
                        className="py-2 px-2 font-medium"
                        style={{ color: l.days_until_expiry <= 30 ? '#F87171' : l.days_until_expiry <= 60 ? '#FCD34D' : '#92400E' }}
                      >
                        {l.days_until_expiry}d
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
