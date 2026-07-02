import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PieChart, Pie,
} from 'recharts';
import { X } from 'lucide-react';
import api from '../services/api';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';
import { useRentalNav } from '../contexts/RentalNavContext';

// ── palette & style constants ─────────────────────────────────────────────────

const C_TEAL  = '#18B7A0';
const C_GREEN = '#26A65B';
const C_AMBER = '#F2C14E';
const C_RED   = '#E76F6F';
const C_GOLD  = '#D4AF37';
const C_CARD  = '#FBF6EE';
const C_BORD  = '#E8DEC8';
const OCCUPANCY_TARGET = 92; // percent

const CARD: React.CSSProperties = {
  background: C_CARD,
  border: '1px solid #E8DEC8',
  borderRadius: 12,
  padding: '16px 18px',
};

const KPI_LBL: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: '#78716C', marginBottom: 4,
};

const KPI_VAL_PRI: React.CSSProperties = {
  fontSize: 32, fontWeight: 700, color: '#1C1917', lineHeight: 1.1,
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const KPI_VAL_SEC: React.CSSProperties = {
  fontSize: 28, fontWeight: 700, color: '#1C1917', lineHeight: 1.1,
  fontVariantNumeric: 'tabular-nums lining-nums',
};

const KPI_HELP: React.CSSProperties = {
  fontSize: 12, fontWeight: 400, color: '#A8A29E', marginTop: 4,
};

const TAB_NUM: React.CSSProperties = { fontVariantNumeric: 'tabular-nums lining-nums' };

const TICK  = { fill: '#6B6B6B', fontSize: 12 };
const TT    = {
  contentStyle: { background: C_CARD, border: `1px solid ${C_BORD}`, color: '#262626', borderRadius: 8, fontSize: 13 },
  labelStyle:   { color: '#5A4B35', fontWeight: 600 },
};

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
  arrears_aging: Record<string, number>;
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

// ── small helpers ─────────────────────────────────────────────────────────────

function short(name: string, max = 14): string {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

function riskFlag(c: CompanySummary): { label: string; color: string; bg: string } {
  if (c.arrears_total > 10000 || c.occupancy_pct < 0.70)
    return { label: 'HIGH',   color: '#B91C1C', bg: 'rgba(231,111,111,0.15)' };
  if (c.arrears_total > 2000  || c.occupancy_pct < 0.85)
    return { label: 'MEDIUM', color: '#92400E', bg: 'rgba(242,193,78,0.18)'  };
  return   { label: 'LOW',    color: '#166534', bg: 'rgba(38,166,91,0.14)'   };
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

// ── inline KPI tiles ──────────────────────────────────────────────────────────

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 80, H = 28;
  const coords = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - ((v - min) / range) * (H - 4) - 2,
  }));
  const pts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  return (
    <svg width={W} height={H} style={{ display: 'block', marginTop: 6, opacity: 0.75 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={3} fill={color} />
    </svg>
  );
}

function PriTile({
  label, value, sub, accent, warn, sparkline, gold,
}: { label: string; value: string; sub?: string; accent?: string; warn?: boolean; sparkline?: number[]; gold?: boolean }) {
  const col = gold ? '#fff' : warn ? C_RED : (accent ?? '#1C1917');
  return (
    <div style={{
      ...CARD,
      background: gold ? 'linear-gradient(135deg,#D4AF37,#B8860B)' : CARD.background,
      border: gold ? '1px solid #B8860B' : CARD.border,
    }} className="ov-tile">
      <div style={{ ...KPI_LBL, color: gold ? 'rgba(255,255,255,0.8)' : KPI_LBL.color }}>{label}</div>
      <div style={{ ...KPI_VAL_PRI, color: col }}>{value}</div>
      {sub && <div style={{ ...KPI_HELP, color: gold ? 'rgba(255,255,255,0.7)' : KPI_HELP.color }}>{sub}</div>}
      {sparkline && sparkline.length >= 2 && <MiniSparkline values={sparkline} color={gold ? 'rgba(255,255,255,0.8)' : col === '#1C1917' ? C_GOLD : col} />}
    </div>
  );
}

function SecTile({
  label, value, sub, warn, na,
}: { label: string; value: string; sub?: string; warn?: boolean; na?: boolean }) {
  return (
    <div style={CARD} className="ov-tile">
      <div style={KPI_LBL}>{label}</div>
      <div style={{ ...KPI_VAL_SEC, color: na ? '#B0B0B0' : (warn ? C_RED : '#1F1F1F') }}>{value}</div>
      {sub && <div style={{ ...KPI_HELP, color: na ? '#C0C0C0' : '#7A7A7A' }}>{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={CARD}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 16 }}>{title}</h3>
      {children}
    </div>
  );
}

// ── SELECT styles ─────────────────────────────────────────────────────────────

const SEL_STYLE: React.CSSProperties = {
  background: '#F7F5F0', border: `1px solid ${C_BORD}`, color: '#1C1917',
  borderRadius: '0.5rem', padding: '0.375rem 0.75rem', fontSize: '0.875rem',
};

// ── main component ────────────────────────────────────────────────────────────

export default function RentalOverview() {
  const { setTab } = useRentalNav();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedMonth = searchParams.get('month')   || serverMonth();
  const selectedCoId  = searchParams.get('company') || '';

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
    if (isFirstLoad.current) { isFirstLoad.current = false; setLoading(true); }
    fetchData(selectedMonth);
  }, [fetchData, selectedMonth]);

  // ── URL param helpers ──────────────────────────────────────────────────────

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

  const collectedSource = selectedCo?.collected_source ?? data?.collected_source ?? '';
  const hasPartnerData  = data?.has_partner_data ?? true;

  const kpis = useMemo(() => {
    if (!data) return null;
    const base = selectedCo ?? data;
    return {
      total_units:              (base as CompanySummary).total_units              ?? data.total_units,
      occupied_units:           (base as CompanySummary).occupied_units           ?? data.occupied_units,
      vacant_units:             (base as CompanySummary).vacant_units             ?? data.vacant_units,
      occupancy_pct:            base.occupancy_pct,
      collected_this_month:     base.collected_this_month,
      billed_this_month:        base.billed_this_month,
      noi_this_month:           base.noi_this_month,
      gross_potential_rent:     base.gross_potential_rent,
      vacancy_loss:             base.vacancy_loss,
      arrears_total:            base.arrears_total,
      total_expense_this_month: base.total_expense_this_month,
      partner_share_payable:    data.partner_share_payable ?? 0,
    };
  }, [data, selectedCo]);

  // ── secondary KPI values ───────────────────────────────────────────────────

  const sec = useMemo(() => {
    if (!kpis || !data) return null;
    const billed   = kpis.billed_this_month;
    const collected= kpis.collected_this_month;
    const collRate = billed > 0 ? (collected / billed) * 100 : null;
    const avgRent  = kpis.occupied_units > 0 ? kpis.gross_potential_rent / kpis.occupied_units : null;
    const noiMgn   = collected > 0 ? (kpis.noi_this_month / collected) * 100 : null;
    const sortedByOcc = [...data.by_company]
      .filter(c => c.total_units > 0)
      .sort((a, b) => b.occupancy_pct - a.occupancy_pct);
    const best  = sortedByOcc[0];
    const worst = sortedByOcc[sortedByOcc.length - 1];
    return { collRate, avgRent, noiMgn, best, worst };
  }, [kpis, data]);

  // ── chart data ─────────────────────────────────────────────────────────────

  // Occupancy by company bar chart
  const occupancyChartData = useMemo(() => {
    if (!data) return [];
    return data.by_company.map(c => ({
      name: short(c.company_name, 13),
      company_id: c.company_id,
      occupancy_pct: parseFloat((c.occupancy_pct * 100).toFixed(1)),
    }));
  }, [data]);

  // Income trend with GPR overlay
  const trendData = useMemo(() => {
    if (!data) return [];
    const syncTarget = selectedCoId
      ? syncCompanies.filter(c => c.id === selectedCoId)
      : syncCompanies;
    if (syncTarget.some(c => c.monthly_rent_data)) {
      const map = new Map<string, number>();
      for (const co of syncTarget) {
        if (!co.monthly_rent_data) continue;
        for (const [m, amt] of Object.entries(co.monthly_rent_data))
          map.set(m, (map.get(m) ?? 0) + (amt as number));
      }
      const pts = MONTHS_ORDER
        .filter(m => (map.get(m) ?? 0) > 0)
        .slice(-6)
        .map(m => ({ month: m, collected: map.get(m) ?? 0, billed: 0, expense: 0, noi: 0 }));
      if (pts.length > 0) return pts;
    }
    return data.income_trend;
  }, [data, selectedCoId, syncCompanies]);

  // Add GPR as a flat reference line to the trend
  const trendWithGpr = useMemo(() => {
    const gpr = kpis?.gross_potential_rent ?? 0;
    return trendData.map(d => ({ ...d, gpr }));
  }, [trendData, kpis]);

  // Vacancy loss by company — horizontal bar
  const vacancyByCompany = useMemo(() => {
    if (!data) return [];
    const source = selectedCo ? [selectedCo] : data.by_company;
    return [...source]
      .filter(c => c.vacancy_loss > 0)
      .sort((a, b) => b.vacancy_loss - a.vacancy_loss)
      .map(c => ({ name: short(c.company_name), company_id: c.company_id, loss: c.vacancy_loss }));
  }, [data, selectedCo]);

  // Avg rent per unit by company — horizontal bar
  const avgRentByCompany = useMemo(() => {
    if (!data) return [];
    const source = selectedCo ? [selectedCo] : data.by_company;
    return [...source]
      .filter(c => c.total_units > 0)
      .map(c => ({ name: short(c.company_name), avg_rent: c.gross_potential_rent / c.total_units, company_id: c.company_id }))
      .sort((a, b) => b.avg_rent - a.avg_rent);
  }, [data, selectedCo]);

  // Occupied vs Vacant donut
  const occupiedVacantData = useMemo(() => {
    if (!kpis) return [];
    return [
      { name: 'Occupied', value: kpis.occupied_units,   fill: C_GREEN },
      { name: 'Vacant',   value: kpis.vacant_units,     fill: C_RED   },
    ];
  }, [kpis]);

  // Top risk companies (by combined arrears + vacancy_loss)
  const riskCompanies = useMemo(() => {
    if (!data) return [];
    const source = selectedCo ? [selectedCo] : data.by_company;
    return [...source]
      .filter(c => c.arrears_total > 0 || c.vacancy_loss > 0 || c.occupancy_pct < 0.85)
      .sort((a, b) => (b.arrears_total + b.vacancy_loss) - (a.arrears_total + a.vacancy_loss))
      .slice(0, 8);
  }, [data, selectedCo]);

  // Sparkline data: last 6 collected values and NOI values from trend
  const sparkCollected = useMemo(() => trendData.map(d => d.collected).filter(v => v > 0), [trendData]);
  const sparkNoi       = useMemo(() => trendData.map(d => d.noi).filter((_, i, arr) => arr.length > 0), [trendData]);

  // Sync banner
  const lastSyncMonth = useMemo(() => {
    if (selectedCoId) return syncCompanies.find(c => c.id === selectedCoId)?.last_sync_month ?? '';
    return syncCompanies.find(c => c.last_sync_month)?.last_sync_month ?? '';
  }, [syncCompanies, selectedCoId]);

  const monthLabel = MONTH_OPTIONS.find(o => o.value === selectedMonth)?.label ?? selectedMonth;

  // Chart click
  function handleBarClick(payload: { company_id?: string } | undefined) {
    if (!payload?.company_id) return;
    if (selectedCoId === payload.company_id) clearCompany();
    else setCompany(payload.company_id);
  }

  // ── loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 rounded w-64 animate-pulse" style={{ background: '#F7F5F0' }} />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonKpi key={i} />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonKpi key={i} />)}
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
        <button className="ml-4 underline" style={{ color: C_GOLD }} onClick={() => fetchData(selectedMonth)}>
          Retry
        </button>
      </div>
    );
  }

  // Occupancy gauge values
  const occPct      = kpis.occupancy_pct * 100;
  const gaugeColor  = occPct >= OCCUPANCY_TARGET ? C_GREEN : occPct >= OCCUPANCY_TARGET - 10 ? C_AMBER : C_RED;

  // Arrears aging — check if any real data exists
  const agingData = [
    { bucket: 'Current', amount: data.arrears_aging['current'] ?? data.arrears_aging['0_30'] ?? 0 },
    { bucket: '1–30d',   amount: data.arrears_aging['1_30']   ?? data.arrears_aging['0_30']  ?? 0 },
    { bucket: '31–60d',  amount: data.arrears_aging['31_60']  ?? 0 },
    { bucket: '61–90d',  amount: data.arrears_aging['61_90']  ?? 0 },
    { bucket: '90+d',    amount: data.arrears_aging['90_plus']?? 0 },
  ];
  const hasAgingData = agingData.some(d => d.amount > 0);

  return (
    <div className="space-y-5">
      <style>{`
        .ov-tile { transition: transform 0.14s ease, box-shadow 0.14s ease; }
        .ov-tile:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.08) !important; }
        .ov-row-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6B6B6B; }
        .ov-section-title { font-size: 16px; font-weight: 600; color: #3A2F1F; margin-bottom: 10px; }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1C1917', lineHeight: 1.2 }}>
            Rental Portfolio Overview
          </h1>
          <p style={{ fontSize: 13, fontWeight: 400, color: '#A8A29E', marginTop: 3 }}>
            Portfolio drill-down · {monthLabel}
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

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl"
        style={{ background: '#F0EDE5', border: `1px solid ${C_BORD}` }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12, fontWeight: 500, color: '#3A3A3A' }}>PERIOD</span>
          <select value={selectedMonth} onChange={e => setMonth(e.target.value)} style={SEL_STYLE}>
            {MONTH_OPTIONS.map(o => (
              <option key={o.value} value={o.value} style={{ background: '#F7F5F0' }}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12, fontWeight: 500, color: '#3A3A3A' }}>COMPANY</span>
          <select value={selectedCoId} onChange={e => setCompany(e.target.value)} style={SEL_STYLE}>
            <option value="" style={{ background: '#F7F5F0' }}>All Companies</option>
            {data.by_company.map(c => (
              <option key={c.company_id} value={c.company_id} style={{ background: '#F7F5F0' }}>{c.company_name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {selectedCoId && selectedCoName ? (
            <>
              <span className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid #3B82F6', color: C_GOLD }}>
                Viewing: {selectedCoName}
              </span>
              <button onClick={clearCompany} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#F87171' }}>
                <X size={11} /> Reset
              </button>
            </>
          ) : (
            <span className="text-xs" style={{ color: '#A8A29E' }}>All Companies · {data.by_company.length} entities</span>
          )}
          {fetching && <span className="text-xs animate-pulse" style={{ color: C_GOLD }}>Loading…</span>}
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

      {/* ── PRIMARY KPI row ─────────────────────────────────────────────────── */}
      {fetching ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonKpi key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <PriTile gold
            label="Occupancy Rate"
            value={fmtPct(kpis.occupancy_pct)}
            sub={`${kpis.occupied_units} / ${kpis.total_units} units`}
          />
          <PriTile
            label="Occupied / Vacant"
            value={`${kpis.occupied_units} / ${kpis.vacant_units}`}
            sub={`${kpis.total_units} total units`}
          />
          <PriTile
            label="Collected This Month"
            value={fmtUSD(kpis.collected_this_month)}
            sub={
              collectedSource === 'pl_fallback'
                ? `from P&L · ${kpis.billed_this_month > 0 ? `of ${fmtUSD(kpis.billed_this_month)} billed` : monthLabel}`
                : kpis.billed_this_month > 0 ? `of ${fmtUSD(kpis.billed_this_month)} billed` : monthLabel
            }
            accent={C_TEAL}
            sparkline={sparkCollected}
          />
          <PriTile
            label="NOI This Month"
            value={fmtUSD(kpis.noi_this_month)}
            sub={
              collectedSource === 'pl_fallback'
                ? `from P&L · Exp: ${fmtUSD(kpis.total_expense_this_month)}`
                : `Expenses: ${fmtUSD(kpis.total_expense_this_month)}`
            }
            warn={kpis.noi_this_month < 0}
            sparkline={sparkNoi}
          />
          <PriTile
            label="Gross Potential Rent"
            value={fmtUSD(kpis.gross_potential_rent)}
            sub="If all units occupied"
          />
          <PriTile
            label="Vacancy Loss"
            value={fmtUSD(kpis.vacancy_loss)}
            sub={`${kpis.vacant_units} vacant unit${kpis.vacant_units !== 1 ? 's' : ''}`}
            warn={kpis.vacancy_loss > 0}
          />
        </div>
      )}

      {/* ── SECONDARY KPI row ────────────────────────────────────────────────── */}
      {!fetching && sec && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <SecTile
            label="Collection Rate"
            value={sec.collRate !== null ? `${sec.collRate.toFixed(1)}%` : '—'}
            sub={kpis.billed_this_month > 0 ? `of ${fmtUSD(kpis.billed_this_month)} billed` : 'No billing data'}
            warn={sec.collRate !== null && sec.collRate < 90}
            na={sec.collRate === null}
          />
          <SecTile
            label="Avg Rent / Unit"
            value={sec.avgRent !== null ? fmtUSD(sec.avgRent) : '—'}
            sub={`${kpis.occupied_units} occupied units`}
          />
          <SecTile
            label="Arrears Days Outstanding"
            value="Not available"
            sub="Awaiting aging data"
            na
          />
          <SecTile
            label="Vacant > 30 Days"
            value="Not available"
            sub="Vacancy date not tracked"
            na
          />
          <SecTile
            label="NOI Margin"
            value={sec.noiMgn !== null ? `${sec.noiMgn.toFixed(1)}%` : '—'}
            sub="NOI ÷ Revenue"
            warn={sec.noiMgn !== null && sec.noiMgn < 0}
            na={sec.noiMgn === null}
          />
          <SecTile
            label="Best / Worst (Occ.)"
            value={
              sec.best && sec.worst && data.by_company.length > 1
                ? `${(sec.best.occupancy_pct * 100).toFixed(0)}% / ${(sec.worst.occupancy_pct * 100).toFixed(0)}%`
                : data.by_company.length > 0
                  ? `${(data.by_company[0].occupancy_pct * 100).toFixed(0)}%`
                  : '—'
            }
            sub={
              sec.best && sec.worst && data.by_company.length > 1
                ? `${short(sec.best.company_name, 12)} · ${short(sec.worst.company_name, 12)}`
                : 'by occupancy rate'
            }
          />
        </div>
      )}

      {/* ── Partner Share (full-width secondary) ─────────────────────────────── */}
      {!fetching && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SecTile
            label="Arrears Outstanding"
            value={fmtUSD(kpis.arrears_total)}
            sub="Billed − Collected (open)"
            warn={kpis.arrears_total > 5000}
          />
          <SecTile
            label="Partner Share Payable"
            value={hasPartnerData ? fmtUSD(kpis.partner_share_payable) : '—'}
            sub={!hasPartnerData ? 'Partner data not yet configured' : 'NOI × ownership %'}
            na={!hasPartnerData}
          />
          <div /> {/* spacer */}
          <div /> {/* spacer */}
        </div>
      )}

      {/* ── Attention Now ────────────────────────────────────────────────────── */}
      {data.attention_now.length > 0 && (
        <div style={CARD}>
          <h3 className="ov-section-title">Attention Now</h3>
          <div className="space-y-2">
            {data.attention_now.map((item, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
                style={item.severity === 'warning'
                  ? { background: '#FCEAEA', border: '1px solid rgba(239,68,68,0.30)', color: '#8B3A3A' }
                  : { background: '#FDF3D9', border: '1px solid rgba(242,193,78,0.45)', color: '#6B4F1A' }}>
                <span className="shrink-0 px-2 py-0.5 rounded-full"
                  style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                    ...(item.severity === 'warning'
                      ? { background: 'rgba(192,57,43,0.12)', color: '#C0392B' }
                      : { background: 'rgba(138,97,22,0.12)',  color: '#8A6116' }),
                  }}>
                  {item.severity === 'warning' ? 'WARNING' : 'ATTENTION'}
                </span>
                {item.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TWO LARGE CHARTS ─────────────────────────────────────────────────── */}
      {!fetching && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Chart 1: Occupancy vs Target gauge */}
          <ChartCard title={`Occupancy Rate vs ${OCCUPANCY_TARGET}% Target`}>
            <div style={{ position: 'relative' }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Occupied', value: occPct },
                      { name: 'Gap',      value: 100 - occPct },
                    ]}
                    cx="50%" cy="85%"
                    startAngle={180} endAngle={0}
                    innerRadius={75} outerRadius={105}
                    dataKey="value"
                    stroke="none"
                  >
                    <Cell fill={gaugeColor} />
                    <Cell fill={`${C_BORD}88`} />
                  </Pie>
                  {/* Target marker at OCCUPANCY_TARGET% */}
                  <Pie
                    data={[
                      { name: 'target-left',  value: OCCUPANCY_TARGET },
                      { name: 'target-mark',  value: 1 },
                      { name: 'target-right', value: 99 - OCCUPANCY_TARGET },
                    ]}
                    cx="50%" cy="85%"
                    startAngle={180} endAngle={0}
                    innerRadius={70} outerRadius={112}
                    dataKey="value"
                    stroke="none"
                  >
                    <Cell fill="transparent" />
                    <Cell fill="#3A2F1F" />
                    <Cell fill="transparent" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 36, fontWeight: 700, color: gaugeColor, ...TAB_NUM }}>
                  {occPct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 12, color: '#7A7A7A', marginTop: 2 }}>
                  {kpis.occupied_units} / {kpis.total_units} units · Target {OCCUPANCY_TARGET}%
                </div>
              </div>
            </div>
            <div className="flex justify-center gap-6 mt-3">
              {[
                { label: `≥ ${OCCUPANCY_TARGET}% Healthy`, color: C_GREEN },
                { label: `${OCCUPANCY_TARGET - 10}–${OCCUPANCY_TARGET}% Watch`, color: C_AMBER },
                { label: `< ${OCCUPANCY_TARGET - 10}% Risk`, color: C_RED },
              ].map(s => (
                <span key={s.label} style={{ fontSize: 11, color: '#6B6B6B', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                  {s.label}
                </span>
              ))}
            </div>
          </ChartCard>

          {/* Chart 2: Collected vs GPR trend */}
          <ChartCard title={selectedCoName ? `Collected vs GPR — ${selectedCoName}` : 'Collected vs Gross Potential (6 months)'}>
            {trendWithGpr.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={trendWithGpr}>
                  <XAxis dataKey="month" tick={{ ...TICK, fontSize: 10 }} />
                  <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={TICK} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#6B6B6B' }} />
                  <Line type="monotone" dataKey="gpr" name="Gross Potential"
                    stroke={C_GOLD} strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                  <Line type="monotone" dataKey="collected" name="Collected"
                    stroke={C_TEAL} strokeWidth={2.5} dot={{ r: 3, fill: C_TEAL }} />
                  {trendWithGpr.some(d => d.expense > 0) && (
                    <Line type="monotone" dataKey="expense" name="Expenses"
                      stroke={C_RED} strokeWidth={1.5} dot={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40" style={{ color: '#B0B0B0', fontSize: 13 }}>
                No trend data available yet
              </div>
            )}
          </ChartCard>
        </div>
      )}

      {/* ── THREE MEDIUM CHARTS ───────────────────────────────────────────────── */}
      {!fetching && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Chart 3: Vacancy Loss by Company */}
          <ChartCard title="Vacancy Loss by Company">
            {vacancyByCompany.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart layout="vertical" data={vacancyByCompany}
                  margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={TICK} />
                  <YAxis type="category" dataKey="name" width={84} tick={{ ...TICK, fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                  <Bar dataKey="loss" name="Vacancy Loss" radius={[0, 4, 4, 0]}>
                    {vacancyByCompany.map((_, idx) => <Cell key={idx} fill={C_RED} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <span style={{ fontSize: 28 }}>✅</span>
                <span style={{ fontSize: 13, color: C_GREEN, fontWeight: 600 }}>No vacancy loss</span>
                <span style={{ fontSize: 12, color: '#7A7A7A' }}>All units occupied</span>
              </div>
            )}
          </ChartCard>

          {/* Chart 4: Occupied vs Vacant donut */}
          <ChartCard title="Occupied vs Vacant Units">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={occupiedVacantData} cx="50%" cy="50%"
                  innerRadius={52} outerRadius={78} paddingAngle={2} dataKey="value" stroke="none">
                  {occupiedVacantData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Tooltip formatter={(v: number) => `${v} units`} {...TT} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-6 mt-1">
              <span style={{ fontSize: 13, color: C_GREEN, ...TAB_NUM }}>
                ● {kpis.occupied_units} Occupied
              </span>
              <span style={{ fontSize: 13, color: C_RED, ...TAB_NUM }}>
                ● {kpis.vacant_units} Vacant
              </span>
            </div>
          </ChartCard>

          {/* Chart 5: Avg Rent by Company */}
          <ChartCard title="Avg Rent per Unit by Company">
            {avgRentByCompany.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart layout="vertical" data={avgRentByCompany}
                  margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
                  <XAxis type="number" tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`} tick={TICK} />
                  <YAxis type="category" dataKey="name" width={84} tick={{ ...TICK, fontSize: 10 }} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                  <Bar dataKey="avg_rent" name="Avg Rent" radius={[0, 4, 4, 0]}>
                    {avgRentByCompany.map((_, idx) => <Cell key={idx} fill={C_GOLD} opacity={idx % 2 === 0 ? 1 : 0.72} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40" style={{ color: '#B0B0B0', fontSize: 13 }}>
                No unit data available
              </div>
            )}
          </ChartCard>
        </div>
      )}

      {/* ── Arrears Aging (Chart 6) ───────────────────────────────────────────── */}
      {!fetching && (
        <ChartCard title="Arrears Aging by Bucket">
          {hasAgingData ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={agingData}>
                <XAxis dataKey="bucket" tick={TICK} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={TICK} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                <Bar dataKey="amount" name="Arrears" fill={C_RED} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span style={{ fontSize: 32, opacity: 0.4 }}>📊</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#9B9B9B' }}>Awaiting aging data upload</span>
              <span style={{ fontSize: 12, color: '#B5B5B5', maxWidth: 320, textAlign: 'center' }}>
                Arrears aging buckets (Current / 1–30d / 31–60d / 61–90d / 90+d) will appear here
                once aging data is uploaded from the AR system.
              </span>
            </div>
          )}
        </ChartCard>
      )}

      {/* ── Top Risk Companies table (Chart 7 / Exception table) ─────────────── */}
      {!fetching && riskCompanies.length > 0 && (
        <div style={CARD}>
          <h3 className="ov-section-title">Top Risk Companies</h3>
          <p style={{ fontSize: 12, color: '#7A7A7A', marginBottom: 12 }}>
            Ranked by combined arrears + vacancy exposure · Arrears days require aging data upload
          </p>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C_BORD}` }}>
                  {['Company', 'Arrears', 'Vacancy Loss', 'Occupancy', 'Arrears Days', 'Risk'].map(h => (
                    <th key={h} className="py-2 px-3 text-left"
                      style={{ fontSize: 13, fontWeight: 600, color: '#5A4B35' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {riskCompanies.map((c, i) => {
                  const flag = riskFlag(c);
                  const occColor = c.occupancy_pct >= 0.92 ? C_GREEN : c.occupancy_pct >= 0.82 ? C_AMBER : C_RED;
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C_BORD}22` }}
                      className="hover:bg-[rgba(0,0,0,0.02)] cursor-pointer"
                      onClick={() => setCompany(c.company_id)}>
                      <td className="py-2.5 px-3" style={{ fontWeight: 500, color: '#262626' }}>{c.company_name}</td>
                      <td className="py-2.5 px-3" style={{ ...TAB_NUM, color: c.arrears_total > 5000 ? C_RED : '#262626' }}>
                        {fmtUSD(c.arrears_total)}
                      </td>
                      <td className="py-2.5 px-3" style={{ ...TAB_NUM, color: c.vacancy_loss > 0 ? C_RED : '#6B6B6B' }}>
                        {c.vacancy_loss > 0 ? fmtUSD(c.vacancy_loss) : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span style={{ ...TAB_NUM, color: occColor, fontWeight: 600 }}>
                          {(c.occupancy_pct * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2.5 px-3" style={{ color: '#B0B0B0', fontSize: 13 }}>
                        Awaiting aging data
                      </td>
                      <td className="py-2.5 px-3">
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                          color: flag.color, background: flag.bg,
                        }}>
                          {flag.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Occupancy by Company bar (existing, retained) ─────────────────────── */}
      {!fetching && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ChartCard title={selectedCoName ? `Occupancy — ${selectedCoName}` : 'Occupancy by Company'}>
            {!selectedCoId && (
              <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 8 }}>Click a bar to drill into that company</p>
            )}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={occupancyChartData}
                onClick={d => handleBarClick(d?.activePayload?.[0]?.payload)}
                style={{ cursor: 'pointer' }}>
                <XAxis dataKey="name" tick={{ ...TICK, fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={TICK} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} {...TT} />
                <Bar dataKey="occupancy_pct" name="Occupancy %" radius={[4, 4, 0, 0]}>
                  {occupancyChartData.map((entry, idx) => {
                    const statusColor = entry.occupancy_pct >= OCCUPANCY_TARGET ? C_GREEN
                      : entry.occupancy_pct >= OCCUPANCY_TARGET - 10 ? C_AMBER : C_RED;
                    return (
                      <Cell key={idx} fill={statusColor}
                        opacity={selectedCoId && selectedCoId !== entry.company_id ? 0.35 : 1} />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* NOI by Company */}
          <ChartCard title={selectedCoName ? `NOI — ${selectedCoName}` : 'NOI by Company'}>
            {!selectedCoId && (
              <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 8 }}>Click a bar to drill into that company</p>
            )}
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={(() => {
                if (!data) return [];
                return data.by_company.map(c => ({
                  name: short(c.company_name, 13),
                  company_id: c.company_id,
                  noi: c.noi_this_month,
                }));
              })()}
                onClick={d => handleBarClick(d?.activePayload?.[0]?.payload)}
                style={{ cursor: 'pointer' }}>
                <XAxis dataKey="name" tick={{ ...TICK, fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={TICK} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} {...TT} />
                <Bar dataKey="noi" name="NOI" radius={[4, 4, 0, 0]}>
                  {data.by_company.map((entry, idx) => (
                    <Cell key={idx}
                      fill={entry.noi_this_month < 0 ? C_RED : C_TEAL}
                      opacity={selectedCoId && selectedCoId !== entry.company_id ? 0.35 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* ── Lease expiry pipeline ─────────────────────────────────────────────── */}
      {data.lease_expiry_pipeline.length > 0 && (
        <div style={CARD}>
          <h3 className="ov-section-title">Upcoming Lease Expirations (next 90 days)</h3>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ fontSize: 14, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C_BORD}` }}>
                  {['Unit', 'Company', 'Tenant', 'Lease End', 'Days Left'].map(h => (
                    <th key={h} className="py-2 px-3 text-left"
                      style={{ fontSize: 13, fontWeight: 600, color: '#5A4B35' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.lease_expiry_pipeline
                  .filter(l => !selectedCoName || l.company_name === selectedCoName)
                  .map((l, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C_BORD}22` }}>
                      <td className="py-2.5 px-3" style={{ color: '#262626' }}>{l.unit_number || '—'}</td>
                      <td className="py-2.5 px-3" style={{ color: '#5A4B35' }}>{l.company_name || '—'}</td>
                      <td className="py-2.5 px-3" style={{ color: '#5A4B35' }}>{l.tenant_name || '—'}</td>
                      <td className="py-2.5 px-3" style={{ color: '#5A4B35', ...TAB_NUM }}>{l.lease_end}</td>
                      <td className="py-2.5 px-3" style={{
                        fontWeight: 600, ...TAB_NUM,
                        color: l.days_until_expiry <= 30 ? C_RED : l.days_until_expiry <= 60 ? C_AMBER : '#5A4B35',
                      }}>
                        {l.days_until_expiry}d
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
