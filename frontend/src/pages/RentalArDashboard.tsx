import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, Legend,
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

const fmtK   = (v: number) => `$${(Math.abs(v) / 1000).toFixed(0)}K`;
const fmt$   = (v: number) => `$${Math.round(v).toLocaleString()}`;
const pct    = (v: number) => `${v.toFixed(1)}%`;
const short  = (m: string) => m.replace(/-\d{4}$/, '');   // "Jan-2026" → "Jan"

const AGING_FILL = ['#22A06B', '#F2C94C', '#F5A623', '#D9534F'];
const BAR_COLORS = ['#2F80ED','#22A06B','#F2C94C','#F5A623','#8B5CF6','#EC4899','#06B6D4','#D4AF37','#EF4444'];

function statusPill(rate: number, collected: number) {
  if (collected === 0) return { label: 'Zero-Pay', bg: '#FEE2E2', color: '#991B1B' };
  if (rate >= 95)      return { label: 'Paid',     bg: '#DCFCE7', color: '#166534' };
  if (rate >= 85)      return { label: 'Partial',  bg: '#FEF3C7', color: '#92400E' };
  return                      { label: 'Low',      bg: '#FEE2E2', color: '#991B1B' };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RentalArDashboard() {
  const [arData,   setArData]   = useState<ArSummaryResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [selMonth, setSelMonth] = useState('');          // '' = All Months
  const [selCo,    setSelCo]    = useState('');          // '' = All Companies
  const [statusFilter, setStatusFilter] = useState('All');
  const [showUnmatched, setShowUnmatched] = useState(false);

  // Fetch whenever month or company filter changes
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selMonth) params.set('month', selMonth);
    if (selCo)    params.set('company_id', selCo);
    api.get<ArSummaryResponse>(`/api/rentals/ar-summary?${params.toString()}`)
      .then(r => setArData(r.data))
      .catch(() => setArData(null))
      .finally(() => setLoading(false));
  }, [selMonth, selCo]);

  const port      = arData?.portfolio;
  const companies = arData?.companies ?? [];
  const months    = arData?.available_months ?? [];

  // KPI values — straight from filtered API response
  const kpis = port ? [
    {
      label: 'Total Billed / Month',
      value: fmt$(port.total_billed),
      sub: `${port.occupied_units} occupied units · registry`,
      border: '#2F80ED',
    },
    {
      label: selMonth ? `Collected · ${short(selMonth)}` : 'Collected (Latest Mo)',
      value: fmt$(port.total_collected),
      sub: port.total_billed > 0 ? `${pct(port.collection_rate)} collection rate` : 'No data yet',
      border: '#22A06B',
    },
    {
      label: 'Outstanding AR',
      value: fmt$(port.total_outstanding),
      sub: `${companies.filter(c => c.latest_outstanding > 0).length} companies with gaps`,
      border: '#D9534F',
    },
    {
      label: 'Collection Rate',
      value: pct(port.collection_rate),
      sub: port.collection_rate >= 95 ? '✅ On Target' : '⚠️ Below 95% target',
      border: port.collection_rate >= 95 ? '#22A06B' : '#F5A623',
    },
    {
      label: 'Vacancy Loss / Month',
      value: fmt$(port.vacancy_loss),
      sub: `${port.total_units - port.occupied_units} vacant / notice units`,
      border: '#D9534F',
    },
    {
      label: 'Total Units',
      value: String(port.total_units),
      sub: `${port.occupied_units} occupied · ${port.total_units - port.occupied_units} vacant`,
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
      value: [...companies].sort((a,b) => b.latest_rate - a.latest_rate)[0]?.company_name ?? '—',
      sub: (() => { const b = [...companies].sort((a,b) => b.latest_rate - a.latest_rate)[0]; return b ? `${pct(b.latest_rate)} · ${fmt$(b.latest_collected)}` : ''; })(),
      border: '#22A06B',
    },
  ] : [];

  // Trend chart
  const trendData = useMemo(() =>
    (arData?.monthly_trend ?? []).map(d => ({ ...d, month: short(d.month) })),
    [arData],
  );

  // Outstanding AR bar chart
  const outstandingData = useMemo(() =>
    [...companies]
      .filter(c => c.latest_outstanding > 0)
      .sort((a, b) => b.latest_outstanding - a.latest_outstanding)
      .map(c => ({ company: c.company_name, ar: c.latest_outstanding })),
    [companies],
  );

  // Month-wise detail table rows: per company per month
  const monthTableRows = useMemo(() => {
    const rows: Array<{
      company_name: string; month: string; billed: number;
      collected: number; outstanding: number; rate: number;
      data_source: string; has_data: boolean;
    }> = [];

    for (const co of companies) {
      if (co.monthly.length === 0) {
        // Company has no collected data — show one row per selected month or just a placeholder
        rows.push({
          company_name: co.company_name,
          month: selMonth || '—',
          billed: co.billed_per_month,
          collected: 0,
          outstanding: co.billed_per_month,
          rate: 0,
          data_source: 'none',
          has_data: false,
        });
      } else {
        for (const m of co.monthly) {
          rows.push({
            company_name: co.company_name,
            month: m.month,
            billed: m.billed,
            collected: m.collected,
            outstanding: m.outstanding,
            rate: m.collection_rate,
            data_source: m.data_source,
            has_data: true,
          });
        }
      }
    }
    return rows;
  }, [companies, selMonth]);

  // Filter the table rows
  const filteredRows = useMemo(() => {
    return monthTableRows.filter(r => {
      if (selMonth && r.month !== selMonth && r.has_data) return false;
      const pill = statusPill(r.rate, r.collected);
      if (statusFilter !== 'All' && pill.label !== statusFilter) return false;
      return true;
    });
  }, [monthTableRows, selMonth, statusFilter]);

  // Recon flags
  const reconFlags = useMemo(() =>
    companies.flatMap(c =>
      c.monthly.flatMap(m =>
        m.recon_flag ? [{ company: c.company_name, month: m.month, ...m.recon_flag }] : [],
      ),
    ), [companies],
  );

  const hasData = !!port;

  const sourceSummary = useMemo(() => ({
    rr:   companies.filter(c => c.has_rent_receivable).length,
    pl:   companies.filter(c => !c.has_rent_receivable && c.has_pl_data).length,
    none: companies.filter(c => !c.has_rent_receivable && !c.has_pl_data).length,
  }), [companies]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '20px', background: '#F5F0E8', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Loading spinner */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8 }}>
          <div style={{ width: 16, height: 16, border: '2px solid #E8DEC8', borderTopColor: '#D4AF37', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 12, color: '#78716C' }}>Loading AR data…</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* Source banner */}
      {!loading && hasData && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#14532D' }}>
            ✅ Live data from registry · Billed = occupied units monthly rent
          </span>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#166534' }}>
            {sourceSummary.rr   > 0 && <span>🔵 {sourceSummary.rr} co. via Rent Receivable upload</span>}
            {sourceSummary.pl   > 0 && <span>🟡 {sourceSummary.pl} co. via P&L fallback</span>}
            {sourceSummary.none > 0 && <span style={{ color: '#9CA3AF' }}>⚪ {sourceSummary.none} co. no collection data yet</span>}
          </div>
        </div>
      )}

      {/* ── FILTER BAR ─────────────────────────────────────────────────── */}
      <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5C5043' }}>Filter:</span>

        {/* Month dropdown — populated from API available_months */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>Month</span>
          <select
            value={selMonth}
            onChange={e => setSelMonth(e.target.value)}
            style={{ fontSize: 12, border: '1px solid #E8DEC8', borderRadius: 6, padding: '5px 10px', background: '#FBF6EE', color: '#374151', cursor: 'pointer' }}
          >
            <option value="">All Months</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Company dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>Company</span>
          <select
            value={selCo}
            onChange={e => setSelCo(e.target.value)}
            style={{ fontSize: 12, border: '1px solid #E8DEC8', borderRadius: 6, padding: '5px 10px', background: '#FBF6EE', color: '#374151', cursor: 'pointer' }}
          >
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.company_id} value={c.company_id}>{c.company_name}</option>)}
          </select>
        </div>

        {/* Active filter chips */}
        {(selMonth || selCo) && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {selMonth && (
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' }}>
                {selMonth} ×
                <button onClick={() => setSelMonth('')} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontSize: 10 }}>✕</button>
              </span>
            )}
            {selCo && (
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' }}>
                {companies.find(c => c.company_id === selCo)?.company_name}
                <button onClick={() => setSelCo('')} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontSize: 10 }}>✕</button>
              </span>
            )}
          </div>
        )}

        <div style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF' }}>
          {companies.length} companies · {port?.total_units ?? 0} units · {port?.occupied_units ?? 0} occupied
        </div>
      </div>

      {/* No data */}
      {!loading && !hasData && (
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 10, padding: '40px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#5C5043', marginBottom: 8 }}>No AR data available yet</p>
          <p style={{ fontSize: 12, color: '#9CA3AF' }}>
            Add units to companies in the Company Registry, then upload a Rent Receivable Excel to populate this dashboard.
          </p>
        </div>
      )}

      {/* ── 8 KPI TILES ─────────────────────────────────────────────────── */}
      {hasData && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 8 }}>
          {kpis.map((t, i) => (
            <div key={i} style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 12px', borderLeft: `3px solid ${t.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#6B6B6B', marginBottom: 6 }}>{t.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#262626', fontFamily: 'monospace' }}>{t.value}</div>
              <div style={{ fontSize: 10, marginTop: 4, color: '#6B6B6B', lineHeight: 1.3 }}>{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── TREND + COMPANY COLLECTION RATE ─────────────────────────────── */}
      {hasData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Billed vs Collected trend */}
          <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>
              Billed vs Collected {selCo ? `— ${companies.find(c => c.company_id === selCo)?.company_name}` : '— Portfolio'}
            </div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>
              {trendData.length > 0 ? `${trendData[0].month} → ${trendData[trendData.length-1].month}` : 'No data with actual collections yet'}
            </div>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendData} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8DEC8" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={38} />
                  <Tooltip
                    contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '1px solid #E8DEC8' }}
                    formatter={(v: number, n: string) => [fmt$(v), n === 'billed' ? 'Billed' : 'Collected']}
                  />
                  <Bar dataKey="billed"    fill="#D4AF37" opacity={0.6} radius={[3,3,0,0]} name="billed" />
                  <Bar dataKey="collected" fill="#22A06B" radius={[3,3,0,0]} name="collected" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: 12, color: '#9CA3AF' }}>
                  Upload Rent Receivable data to see trend
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <span style={{ fontSize: 10, color: '#6B6B6B', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#D4AF37', opacity: 0.6, display: 'inline-block' }} /> Billed
              </span>
              <span style={{ fontSize: 10, color: '#6B6B6B', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: '#22A06B', display: 'inline-block' }} /> Collected
              </span>
            </div>
          </div>

          {/* Collection rate bars per company */}
          <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Collection rate by company</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 16 }}>
              {selMonth ? selMonth : 'Latest available month'} · collected vs billed
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 240 }}>
              {companies.map(co => {
                const pill = statusPill(co.latest_rate, co.latest_collected);
                return (
                  <div key={co.company_id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>{co.company_name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#6B6B6B' }}>
                          {fmt$(co.latest_collected)} / {fmt$(co.billed_per_month)}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: pill.bg, color: pill.color }}>
                          {co.latest_rate > 0 ? pct(co.latest_rate) : pill.label}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 7, background: '#E8DEC8', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4, transition: 'width 0.4s',
                        width: `${Math.min(100, co.latest_rate)}%`,
                        background: co.latest_rate >= 95 ? '#22A06B' : co.latest_rate >= 85 ? '#F5A623' : '#D9534F',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── OUTSTANDING AR BY COMPANY ────────────────────────────────────── */}
      {hasData && outstandingData.length > 0 && (
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Outstanding AR by company</div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>Billed (registry) − Collected · {selMonth || 'latest month'}</div>
          <ResponsiveContainer width="100%" height={Math.max(160, outstandingData.length * 34)}>
            <BarChart data={outstandingData} layout="vertical" margin={{ top: 0, right: 80, bottom: 0, left: 110 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8DEC8" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} />
              <YAxis dataKey="company" type="category" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: '11px', borderRadius: '8px' }} formatter={(v: number) => [fmt$(v), 'Outstanding AR']} />
              <Bar dataKey="ar" radius={[0,4,4,0]} label={{ position: 'right', fontSize: 10, fill: '#6b7280', formatter: (v: number) => fmt$(v) }}>
                {outstandingData.map((_, i) => <Cell key={i} fill={AGING_FILL[Math.min(i, AGING_FILL.length - 1)]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── MONTH × COMPANY DETAIL TABLE ────────────────────────────────── */}
      {hasData && (
        <div style={{ background: '#fff', border: '1px solid #E8DEC8', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1C1917' }}>
                Collection detail — {selCo ? companies.find(c => c.company_id === selCo)?.company_name : 'All Companies'} · {selMonth || 'All Months'}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                Company × Month · billed from unit registry · collected from Rent Receivable or P&L
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['All', 'Zero-Pay', 'Partial', 'Paid', 'Low'].map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  style={{
                    fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid',
                    borderColor: statusFilter === f ? '#1C1917' : '#E8DEC8',
                    background:  statusFilter === f ? '#1C1917' : 'transparent',
                    color:       statusFilter === f ? '#fff' : '#6B6B6B',
                    cursor: 'pointer',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F7F1E6' }}>
                  {['Company', 'Month', 'Occupied/Total', 'Billed/Mo', 'Collected', 'Outstanding', 'Rate', 'Source', 'Status'].map(h => (
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
                      No data for this filter. Upload Rent Receivable Excel to populate collected figures.
                    </td>
                  </tr>
                ) : filteredRows.map((row, i) => {
                  const pill = statusPill(row.rate, row.collected);
                  const co = companies.find(c => c.company_name === row.company_name);
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #F0EBE3', background: i % 2 === 0 ? '#FDFAF6' : '#fff' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500, color: '#1C1917', whiteSpace: 'nowrap' }}>{row.company_name}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6B6B6B', fontFamily: 'monospace', fontSize: 11 }}>{row.month}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6B6B6B' }}>
                        {co ? `${co.occupied_units}/${co.total_units}` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#374151' }}>{fmt$(row.billed)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#166534', fontWeight: 500 }}>{fmt$(row.collected)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: row.outstanding > 0 ? '#991B1B' : '#166534' }}>
                        {row.outstanding > 0 ? fmt$(row.outstanding) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: row.rate >= 95 ? '#166534' : row.rate >= 85 ? '#92400E' : '#991B1B' }}>
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
                    <td colSpan={3} style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, color: '#1C1917' }}>TOTAL</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#374151' }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.billed, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#166534' }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.collected, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#991B1B' }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.outstanding, 0))}
                    </td>
                    <td colSpan={3} style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#374151' }}>
                      {(() => {
                        const tb = filteredRows.reduce((s,r) => s+r.billed, 0);
                        const tc = filteredRows.reduce((s,r) => s+r.collected, 0);
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

      {/* ── RECONCILIATION FLAGS ─────────────────────────────────────────── */}
      {reconFlags.length > 0 && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 10 }}>
            ⚠️ Reconciliation Flags — Rent Receivable vs P&L differ by &gt; 2%
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 8 }}>
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
      {(arData?.unmatched_lines?.length ?? 0) > 0 && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#9A3412' }}>
              ⚠️ {arData!.unmatched_lines.length} Unmatched P&L line{arData!.unmatched_lines.length !== 1 ? 's' : ''} — unit label not found in registry
            </div>
            <button onClick={() => setShowUnmatched(v => !v)} style={{ fontSize: 11, color: '#9A3412', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              {showUnmatched ? 'Hide' : 'Show all'}
            </button>
          </div>
          {showUnmatched && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {arData!.unmatched_lines.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, fontSize: 11, background: '#fff', border: '1px solid #FDBA74', borderRadius: 6, padding: '6px 10px' }}>
                  <span style={{ fontWeight: 600, color: '#7C3AED', minWidth: 120 }}>{u.company}</span>
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
