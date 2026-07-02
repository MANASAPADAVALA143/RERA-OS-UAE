import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Line, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend,
} from 'recharts';
import api from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonthlyDetail {
  month: string;
  billed: number;
  collected: number;
  outstanding: number;
  collection_rate: number;
  data_source: 'rent_receivable' | 'pl_fallback';
  recon_flag: { rent_receivable: number; pl: number; diff_pct: number } | null;
}

interface CompanySummary {
  company_id: string;
  company_name: string;
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  billed_per_month: number;
  vacancy_loss_per_month: number;
  last_sync_month: string | null;
  has_rent_receivable: boolean;
  has_pl_data: boolean;
  monthly: MonthlyDetail[];
  latest_month: string | null;
  latest_collected: number;
  latest_outstanding: number;
  latest_rate: number;
  pl_lines_unmatched: string[];
}

interface ArSummaryResponse {
  companies: CompanySummary[];
  portfolio: {
    total_billed: number;
    total_collected: number;
    total_outstanding: number;
    collection_rate: number;
    vacancy_loss: number;
    occupied_units: number;
    total_units: number;
  };
  monthly_trend: { month: string; billed: number; collected: number }[];
  available_months: string[];
  unmatched_lines: { company: string; label: string }[];
  generated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$  = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtK  = (v: number) => `$${(Math.abs(v) / 1000).toFixed(0)}K`;
const pct   = (v: number) => `${Math.min(v, 999).toFixed(1)}%`;
const short = (m: string) => m.replace(/-\d{4}$/, '');

const STATUS_COLORS = ['#22A06B','#F2C94C','#F5A623','#D9534F','#2F80ED','#8B5CF6','#EC4899','#06B6D4','#D4AF37'];

function getStatus(rate: number, collected: number): { label: string; bg: string; color: string } {
  if (collected === 0) return { label: 'Zero-Pay', bg: '#FEE2E2', color: '#991B1B' };
  if (rate >= 95)      return { label: 'Paid',     bg: '#DCFCE7', color: '#166534' };
  if (rate >= 85)      return { label: 'Partial',  bg: '#FEF3C7', color: '#92400E' };
  return                      { label: 'Low',      bg: '#FEE2E2', color: '#991B1B' };
}

const SEL = { fontSize: 12, border: '1px solid #E8DEC8', borderRadius: 6, padding: '5px 10px', background: '#FBF6EE', color: '#374151', cursor: 'pointer' } as const;
const CARD = { background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: 16 } as const;

// ── Billed-vs-Collected custom tooltip ───────────────────────────────────────
function BvcTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const row       = payload[0]?.payload ?? {};
  const billed    = row.billed    ?? 0;
  const collected = row.collected ?? 0;
  const gap       = Math.max(0, billed - collected);
  const realPct   = billed > 0 ? (collected / billed * 100).toFixed(1) : null;
  const byCompany: { name: string; collected: number }[] = row.byCompany ?? [];
  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 14px', fontSize: 12, maxWidth: 260, fontVariantNumeric: 'tabular-nums lining-nums' }}>
      <p style={{ fontWeight: 700, color: '#1C1917', marginBottom: 8 }}>{row.full ?? row.month}</p>
      <p style={{ color: '#4E79A7' }}>Billed: {fmt$(billed)}</p>
      <p style={{ color: '#22A06B' }}>Collected: {fmt$(collected)}</p>
      <p style={{ color: '#B91C1C' }}>Gap: {fmt$(gap)}</p>
      {realPct !== null && <p style={{ color: '#78716C', marginTop: 3 }}>Realization: {realPct}%</p>}
      {byCompany.length > 1 && (
        <div style={{ marginTop: 8, borderTop: '1px solid #E8DEC8', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...byCompany].sort((a, b) => b.collected - a.collected).map(c => (
            <p key={c.name} style={{ fontSize: 11, color: '#6B6B6B' }}>{c.name}: {fmt$(c.collected)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RentalArDashboard() {
  // raw data from API — always ALL companies for the selected month
  const [rawData,  setRawData]  = useState<ArSummaryResponse | null>(null);
  const [loading,  setLoading]  = useState(true);

  // filters — month triggers API refetch, company is client-side only
  const [selMonth,  setSelMonth]  = useState('');   // '' = All Months
  const [selCoId,   setSelCoId]   = useState('');   // '' = All Companies
  const [statusFlt, setStatusFlt] = useState('All');
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [chartMonth, setChartMonth] = useState(''); // click-to-filter from chart

  // Fetch when month changes (company filter is client-side)
  useEffect(() => {
    setLoading(true);
    const params = selMonth ? `?month=${selMonth}` : '';
    api.get<ArSummaryResponse>(`/api/rentals/ar-summary${params}`)
      .then(r => setRawData(r.data))
      .catch(() => setRawData(null))
      .finally(() => setLoading(false));
  }, [selMonth]);

  // All companies always available for dropdown (from unfiltered response)
  const allCompanies = rawData?.companies ?? [];
  const availMonths  = rawData?.available_months ?? [];

  // ── Client-side company filter ────────────────────────────────────────────
  const companies = useMemo(
    () => selCoId ? allCompanies.filter(c => c.company_id === selCoId) : allCompanies,
    [allCompanies, selCoId],
  );

  // ── KPI aggregates from filtered companies ────────────────────────────────
  const port = useMemo(() => {
    if (!companies.length) return null;
    const totalBilled    = companies.reduce((s, c) => s + c.billed_per_month, 0);
    const totalCollected = companies.reduce((s, c) => s + c.latest_collected, 0);
    const totalOutstanding = Math.max(0, totalBilled - totalCollected);
    const rate = totalBilled > 0 ? totalCollected / totalBilled * 100 : 0;
    const vacLoss = companies.reduce((s, c) => s + c.vacancy_loss_per_month, 0);
    const occupied = companies.reduce((s, c) => s + c.occupied_units, 0);
    const total    = companies.reduce((s, c) => s + c.total_units, 0);
    return { totalBilled, totalCollected, totalOutstanding, rate, vacLoss, occupied, total };
  }, [companies]);

  // ── Trend — month-wise aggregated from filtered companies ─────────────────
  const trendData = useMemo(() => {
    const map = new Map<string, { billed: number; collected: number; byCompany: { name: string; collected: number }[] }>();
    for (const co of companies) {
      for (const m of co.monthly) {
        const existing = map.get(m.month);
        if (!existing) {
          map.set(m.month, { billed: 0, collected: 0, byCompany: [] });
        }
        const e = map.get(m.month)!;
        e.billed    += m.billed;
        e.collected += m.collected;
        if (m.collected > 0) e.byCompany.push({ name: co.company_name, collected: m.collected });
      }
    }
    const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const sorted = [...map.entries()].sort(([a],[b]) => {
      const [am, ay] = a.split('-'); const [bm, by] = b.split('-');
      return (parseInt(ay)-parseInt(by)) || (MNAMES.indexOf(am)-MNAMES.indexOf(bm));
    });
    return sorted.map(([m, v]) => ({
      month: short(m), full: m,
      billed: v.billed, collected: v.collected,
      byCompany: v.byCompany,
      // stacked area series: transparent base up to collected, red fill for the gap
      collectedBase: v.collected,
      gapFill: Math.max(0, v.billed - v.collected),
    }));
  }, [companies]);

  // ── Outstanding AR by company ─────────────────────────────────────────────
  const outstandingData = useMemo(() =>
    [...companies]
      .filter(c => c.latest_outstanding > 0)
      .sort((a, b) => b.latest_outstanding - a.latest_outstanding)
      .map(c => ({ company: c.company_name.length > 16 ? c.company_name.slice(0,14)+'…' : c.company_name, ar: c.latest_outstanding, full: c.company_name })),
    [companies],
  );

  // ── Month × Company detail rows ───────────────────────────────────────────
  const detailRows = useMemo(() => {
    const rows: Array<{
      company_name: string; month: string; occupied: number; total: number;
      billed: number; collected: number; outstanding: number; rate: number;
      data_source: string; has_data: boolean;
    }> = [];

    for (const co of companies) {
      if (co.monthly.length === 0) {
        rows.push({
          company_name: co.company_name, month: selMonth || '—',
          occupied: co.occupied_units, total: co.total_units,
          billed: co.billed_per_month, collected: 0,
          outstanding: co.billed_per_month, rate: 0,
          data_source: 'none', has_data: false,
        });
      } else {
        for (const m of co.monthly) {
          rows.push({
            company_name: co.company_name, month: m.month,
            occupied: co.occupied_units, total: co.total_units,
            billed: m.billed, collected: m.collected,
            outstanding: m.outstanding, rate: m.collection_rate,
            data_source: m.data_source, has_data: true,
          });
        }
      }
    }
    return rows;
  }, [companies, selMonth]);

  const filteredRows = useMemo(() => {
    return detailRows.filter(r => {
      if (chartMonth && r.month !== chartMonth && r.month !== short(chartMonth)) return false;
      if (statusFlt === 'All') return true;
      return getStatus(r.rate, r.collected).label === statusFlt;
    });
  }, [detailRows, statusFlt, chartMonth]);

  // Overall realization % across all trend months
  const realizationPct = useMemo(() => {
    const tb = trendData.reduce((s, d) => s + d.billed, 0);
    const tc = trendData.reduce((s, d) => s + d.collected, 0);
    return tb > 0 ? tc / tb * 100 : null;
  }, [trendData]);

  // ── Recon flags ───────────────────────────────────────────────────────────
  const reconFlags = useMemo(() =>
    companies.flatMap(c =>
      c.monthly.flatMap(m =>
        m.recon_flag ? [{ company: c.company_name, month: m.month, ...m.recon_flag }] : [],
      ),
    ), [companies],
  );

  // ── Source counts ─────────────────────────────────────────────────────────
  const srcSummary = useMemo(() => ({
    rr:   allCompanies.filter(c => c.has_rent_receivable).length,
    pl:   allCompanies.filter(c => !c.has_rent_receivable && c.has_pl_data).length,
    none: allCompanies.filter(c => !c.has_rent_receivable && !c.has_pl_data).length,
  }), [allCompanies]);

  const selCoName = allCompanies.find(c => c.company_id === selCoId)?.company_name ?? '';

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  const kpis = port ? [
    {
      label: 'Total Billed / Month',
      value: fmt$(port.totalBilled),
      sub: `${port.occupied} occupied units · registry`,
      border: '#2F80ED',
    },
    {
      label: selMonth ? `Collected · ${selMonth}` : 'Collected (Latest Mo)',
      value: fmt$(port.totalCollected),
      sub: `${pct(port.rate)} collection rate`,
      border: '#22A06B',
    },
    {
      label: 'Outstanding AR',
      value: fmt$(port.totalOutstanding),
      sub: `${companies.filter(c => c.latest_outstanding > 0).length} companies with gaps`,
      border: '#D9534F',
    },
    {
      label: 'Collection Rate',
      value: pct(port.rate),
      sub: port.rate >= 95 ? '✅ On Target' : '⚠️ Below 95% target',
      border: port.rate >= 95 ? '#22A06B' : '#F5A623',
    },
    {
      label: 'Vacancy Loss / Month',
      value: fmt$(port.vacLoss),
      sub: `${port.total - port.occupied} vacant / notice units`,
      border: '#D9534F',
    },
    {
      label: 'Total Units',
      value: String(port.total),
      sub: `${port.occupied} occupied · ${port.total - port.occupied} vacant`,
      border: '#2F80ED',
    },
    {
      label: 'Zero-Pay Companies',
      value: String(companies.filter(c => c.billed_per_month > 0 && c.latest_collected === 0).length),
      sub: companies.filter(c => c.billed_per_month > 0 && c.latest_collected === 0).map(c => c.company_name).join(', ') || 'None',
      border: '#D9534F',
    },
    {
      label: 'Best Performer',
      value: [...companies].sort((a, b) => b.latest_rate - a.latest_rate)[0]?.company_name ?? '—',
      sub: (() => {
        const b = [...companies].filter(c => c.latest_collected > 0).sort((a, b) => b.latest_rate - a.latest_rate)[0];
        return b ? `${pct(b.latest_rate)} · ${fmt$(b.latest_collected)}` : 'No data yet';
      })(),
      border: '#22A06B',
    },
  ] : [];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 20, background: '#F5F0E8', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Spinner */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8 }}>
          <div style={{ width: 16, height: 16, border: '2px solid #E8DEC8', borderTopColor: '#D4AF37', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 12, color: '#78716C' }}>Loading AR data…</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* Source banner */}
      {!loading && !!rawData && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#14532D' }}>
            ✅ Live data from registry · Billed = occupied units monthly rent
          </span>
          <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
            {srcSummary.rr   > 0 && <span style={{ color: '#166534' }}>🔵 {srcSummary.rr} co. via Rent Receivable upload</span>}
            {srcSummary.pl   > 0 && <span style={{ color: '#92400E' }}>🟡 {srcSummary.pl} co. via P&L fallback</span>}
            {srcSummary.none > 0 && <span style={{ color: '#9CA3AF' }}>⚪ {srcSummary.none} co. no collection data yet</span>}
          </div>
        </div>
      )}

      {/* ── FILTER BAR ─────────────────────────────────────────────────── */}
      <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5C5043' }}>Filter:</span>

        {/* Month — triggers API refetch */}
        <select value={selMonth} onChange={e => { setSelMonth(e.target.value); setSelCoId(''); }} style={SEL}>
          <option value="">All Months</option>
          {availMonths.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        {/* Company — client-side only, never triggers refetch */}
        <select value={selCoId} onChange={e => setSelCoId(e.target.value)} style={SEL}>
          <option value="">All Companies</option>
          {allCompanies.map(c => (
            <option key={c.company_id} value={c.company_id}>{c.company_name}</option>
          ))}
        </select>

        {/* Active chips */}
        {selMonth && (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', gap: 4 }}>
            📅 {selMonth}
            <button onClick={() => setSelMonth('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
          </span>
        )}
        {selCoId && (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', gap: 4 }}>
            🏢 {selCoName}
            <button onClick={() => setSelCoId('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF' }}>
          {companies.length} / {allCompanies.length} companies · {port?.total ?? 0} units · {port?.occupied ?? 0} occupied
          {selCoId && <span style={{ color: '#D4AF37', marginLeft: 6 }}>← Company filtered (client-side)</span>}
        </span>
      </div>

      {/* No data */}
      {!loading && !rawData && (
        <div style={{ ...CARD, textAlign: 'center', padding: '40px 24px' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#5C5043', marginBottom: 8 }}>No AR data available yet</p>
          <p style={{ fontSize: 12, color: '#9CA3AF' }}>Add units to companies in the Company Registry, then upload a Rent Receivable Excel.</p>
        </div>
      )}

      {/* ── 8 KPI TILES ─────────────────────────────────────────────────── */}
      {!!port && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 8 }}>
          {kpis.map((t, i) => (
            <div key={i} style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 12px', borderLeft: `3px solid ${t.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 5, lineHeight: 1.2 }}>{t.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#262626', fontFamily: 'monospace' }}>{t.value}</div>
              <div style={{ fontSize: 10, marginTop: 4, color: '#6B6B6B', lineHeight: 1.3 }}>{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── TREND + COLLECTION RATE ──────────────────────────────────────── */}
      {!!port && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Billed vs Collected dual-line trend */}
          <div style={CARD}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#262626' }}>
                Billed vs Collected — {selCoName || 'All Companies'}
              </div>
              {realizationPct !== null && (
                <div style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                  background: realizationPct >= 95 ? 'rgba(34,160,107,0.12)' : realizationPct >= 80 ? 'rgba(242,193,78,0.18)' : 'rgba(217,83,79,0.12)',
                  color:      realizationPct >= 95 ? '#065F46' : realizationPct >= 80 ? '#92400E' : '#991B1B',
                  border: `1px solid ${realizationPct >= 95 ? 'rgba(34,160,107,0.3)' : realizationPct >= 80 ? 'rgba(242,193,78,0.4)' : 'rgba(217,83,79,0.3)'}`,
                  fontVariantNumeric: 'tabular-nums lining-nums', flexShrink: 0 }}>
                  {realizationPct.toFixed(1)}% realization
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
              {trendData.length > 0
                ? `${trendData[0].full} → ${trendData[trendData.length - 1].full} · ${trendData.length} months`
                : 'No collection data yet — upload Rent Receivable Excel'}
            </div>

            {chartMonth && (
              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' }}>
                  Table filtered: {chartMonth}
                </span>
                <button onClick={() => setChartMonth('')} style={{ fontSize: 11, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Clear
                </button>
              </div>
            )}

            {trendData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart
                    data={trendData}
                    margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                    onClick={(e) => {
                      const full = e?.activePayload?.[0]?.payload?.full;
                      if (full) setChartMonth(prev => prev === full ? '' : full);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      axisLine={false} tickLine={false}
                      interval={Math.max(1, Math.floor(trendData.length / 10))}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      tickFormatter={(v: number) => v === 0 ? '$0' : v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`}
                      axisLine={false} tickLine={false} width={44}
                      tickCount={6}
                    />
                    <Tooltip content={<BvcTooltip />} />
                    {/* Under-collection fill: stacked transparent base + red gap */}
                    <Area type="monotone" dataKey="collectedBase" stackId="gap" fill="transparent" stroke="none" legendType="none" />
                    <Area type="monotone" dataKey="gapFill"       stackId="gap" fill="rgba(235,87,87,0.12)" stroke="none" legendType="none" />
                    <Line type="monotone" dataKey="billed"    name="Billed"    stroke="#4E79A7" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 1.5, stroke: '#4E79A7', fill: '#fff' }} />
                    <Line type="monotone" dataKey="collected" name="Collected" stroke="#22A06B" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 1.5, stroke: '#22A06B', fill: '#fff' }} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 20, marginTop: 10, alignItems: 'center' }}>
                  {[['#4E79A7','Billed'],['#22A06B','Collected']].map(([c,l]) => (
                    <span key={l} style={{ fontSize: 12, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
                      <span style={{ width: 20, height: 3, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 10, background: 'rgba(235,87,87,0.25)', borderRadius: 2, display: 'inline-block' }} />Under-collection
                  </span>
                  <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' }}>Click month to filter table ↓</span>
                </div>
              </>
            ) : (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: 12, color: '#9CA3AF' }}>Upload Rent Receivable data to see trend</p>
              </div>
            )}
          </div>

          {/* Collection rate by company */}
          <div style={CARD}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Collection rate by company</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
              {selMonth || 'Latest available month'} · collected vs billed from registry
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 240 }}>
              {allCompanies.map((co, idx) => {
                // Use filtered company data when company is selected, else original
                const src = selCoId ? companies.find(c => c.company_id === co.company_id) : co;
                const rate = src?.latest_rate ?? 0;
                const coll = src?.latest_collected ?? 0;
                const bill = src?.billed_per_month ?? 0;
                const pill = getStatus(rate, coll);
                const isSelected = selCoId === co.company_id;
                return (
                  <div key={co.company_id}
                    style={{ opacity: selCoId && !isSelected ? 0.4 : 1, cursor: 'pointer' }}
                    onClick={() => setSelCoId(isSelected ? '' : co.company_id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, color: isSelected ? '#1C1917' : '#374151', fontWeight: isSelected ? 700 : 500 }}>
                        {co.company_name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#6B6B6B' }}>
                          {fmt$(coll)} / {fmt$(bill)}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: pill.bg, color: pill.color }}>
                          {rate > 0 ? pct(rate) : pill.label}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 7, background: '#E8DEC8', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        width: `${Math.min(100, rate)}%`,
                        background: STATUS_COLORS[idx % STATUS_COLORS.length],
                        transition: 'width 0.4s',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 10 }}>💡 Click a company to filter the whole dashboard</div>
          </div>
        </div>
      )}

      {/* ── OUTSTANDING AR BY COMPANY ─────────────────────────────────────── */}
      {!!port && outstandingData.length > 0 && (
        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Outstanding AR by company</div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>
            Billed (registry) − Collected · {selMonth || 'latest month'}
          </div>
          <ResponsiveContainer width="100%" height={Math.max(120, outstandingData.length * 34)}>
            <BarChart data={outstandingData} layout="vertical" margin={{ top: 0, right: 90, bottom: 0, left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8DEC8" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} />
              <YAxis dataKey="company" type="category" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number, _, p) => [fmt$(v), `${p.payload?.full} · Outstanding`]} />
              <Bar dataKey="ar" radius={[0,4,4,0]} label={{ position: 'right', fontSize: 10, fill: '#6b7280', formatter: (v: number) => fmt$(v) }}>
                {outstandingData.map((_, i) => <Cell key={i} fill={['#D9534F','#F5A623','#F2C94C'][Math.min(i, 2)]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!!port && outstandingData.length === 0 && companies.some(c => c.latest_collected > 0) && (
        <div style={{ ...CARD, textAlign: 'center', color: '#22A06B', fontSize: 13, fontWeight: 600 }}>
          ✅ No outstanding AR — all companies current
        </div>
      )}

      {/* ── COMPANY × MONTH DETAIL TABLE ─────────────────────────────────── */}
      {!!port && (
        <div style={{ background: '#fff', border: '1px solid #E8DEC8', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1C1917' }}>
                Collection detail — {selCoName || 'All Companies'} · {chartMonth || selMonth || 'All Months'}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                Every company × every month · billed from registry · collected from Rent Receivable or P&L
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['All','Zero-Pay','Partial','Paid','Low'].map(f => (
                <button key={f} onClick={() => setStatusFlt(f)} style={{
                  fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid',
                  borderColor: statusFlt === f ? '#1C1917' : '#E8DEC8',
                  background:  statusFlt === f ? '#1C1917' : 'transparent',
                  color:       statusFlt === f ? '#fff'    : '#6B6B6B',
                  cursor: 'pointer',
                }}>{f}</button>
              ))}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F7F1E6' }}>
                  {['Company','Month','Occ/Total','Billed/Mo','Collected','Outstanding','Rate','Source','Status'].map(h => (
                    <th key={h} style={{
                      textAlign: ['Company','Source','Status'].includes(h) ? 'left' : 'right',
                      padding: '8px 10px', fontSize: 10, fontWeight: 600,
                      color: '#5C5043', textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 28, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
                      No data for this filter.
                      {srcSummary.none > 0 && ` Upload Rent Receivable Excel to populate ${srcSummary.none} companies.`}
                    </td>
                  </tr>
                ) : filteredRows.map((row, i) => {
                  const pill = getStatus(row.rate, row.collected);
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #F0EBE3', background: i % 2 === 0 ? '#FDFAF6' : '#fff' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500, color: '#1C1917', whiteSpace: 'nowrap' }}>{row.company_name}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6B6B6B', fontFamily: 'monospace', fontSize: 11 }}>{row.month}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6B6B6B' }}>{row.occupied}/{row.total}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#374151' }}>{fmt$(row.billed)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#166534', fontWeight: 500 }}>{fmt$(row.collected)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: row.outstanding > 0 ? '#991B1B' : '#166534' }}>
                        {row.outstanding > 0 ? fmt$(row.outstanding) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                        color: row.rate >= 95 ? '#166534' : row.rate >= 85 ? '#92400E' : '#991B1B' }}>
                        {row.has_data ? pct(row.rate) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {row.has_data ? (
                          <span style={{
                            fontSize: 9, padding: '2px 6px', borderRadius: 20,
                            background: row.data_source === 'rent_receivable' ? '#EFF6FF' : '#FEFCE8',
                            color:      row.data_source === 'rent_receivable' ? '#1E40AF' : '#92400E',
                          }}>
                            {row.data_source === 'rent_receivable' ? 'Rent Rcv' : 'P&L'}
                          </span>
                        ) : (
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280' }}>No data</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: pill.bg, color: pill.color }}>
                          {pill.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#F7F1E6', borderTop: '2px solid #E8DEC8' }}>
                    <td colSpan={3} style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, color: '#1C1917' }}>TOTAL ({filteredRows.length} rows)</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.billed, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#166534' }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.collected, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#991B1B' }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.outstanding, 0))}
                    </td>
                    <td colSpan={3} style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      {(() => {
                        const tb = filteredRows.reduce((s,r)=>s+r.billed,0);
                        const tc = filteredRows.reduce((s,r)=>s+r.collected,0);
                        return tb > 0 ? pct(tc/tb*100) : '—';
                      })()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── RECON FLAGS ──────────────────────────────────────────────────── */}
      {reconFlags.length > 0 && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 10 }}>
            ⚠️ {reconFlags.length} Reconciliation Flag{reconFlags.length > 1 ? 's' : ''} — Rent Receivable vs P&L differ &gt; 2%
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 8 }}>
            {reconFlags.map((f, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #FCD34D', borderRadius: 6, padding: '10px 12px', fontSize: 11 }}>
                <div style={{ fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>{f.company} · {f.month}</div>
                <div style={{ color: '#2F80ED' }}>Rent Receivable: {fmt$(f.rent_receivable)}</div>
                <div style={{ color: '#92400E' }}>P&L: {fmt$(f.pl)}</div>
                <div style={{ color: '#D9534F', fontWeight: 600, marginTop: 2 }}>Δ {f.diff_pct}% difference</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── UNMATCHED P&L LINES ──────────────────────────────────────────── */}
      {(rawData?.unmatched_lines?.length ?? 0) > 0 && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#9A3412' }}>
              ⚠️ {rawData!.unmatched_lines.length} Unmatched P&L line{rawData!.unmatched_lines.length !== 1 ? 's' : ''} — unit label not found in registry
            </div>
            <button onClick={() => setShowUnmatched(v => !v)} style={{ fontSize: 11, color: '#9A3412', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              {showUnmatched ? 'Hide' : 'Show all'}
            </button>
          </div>
          {showUnmatched && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {rawData!.unmatched_lines.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, fontSize: 11, background: '#fff', border: '1px solid #FDBA74', borderRadius: 6, padding: '6px 10px' }}>
                  <span style={{ fontWeight: 600, color: '#7C3AED', minWidth: 130 }}>{u.company}</span>
                  <span style={{ color: '#374151', fontFamily: 'monospace' }}>{u.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
