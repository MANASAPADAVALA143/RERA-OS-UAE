import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
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
  unmatched_lines: { company: string; label: string }[];
  generated_at: string;
}

interface ArAgingDetail {
  portfolio_buckets: { current: number; '1_30': number; '31_60': number; '61_90': number; '90_plus': number };
  total_ar: number;
  unit_detail: Array<{
    unit_id: string;
    unit_number: string;
    company_name: string;
    billing_month: string;
    amount_billed?: number;
    amount_collected?: number;
    owed: number;
    days_past_due?: number;
    bucket?: string;
  }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtK = (v: number) => `$${Math.round(Math.abs(v) / 1000)}K`;
const fmtDollar = (v: number) => `$${Math.round(v).toLocaleString()}`;
const shortMonth = (m: string) => m.replace(/-\d{4}$/, '');  // "Jan-2026" → "Jan"

const AGING_FILL = ['#22A06B', '#F2C94C', '#F5A623', '#D9534F'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function RentalArDashboard() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [arSummary, setArSummary]       = useState<ArSummaryResponse | null>(null);
  const [arAgingData, setArAgingData]   = useState<ArAgingDetail | null>(null);
  const [loading, setLoading]           = useState(true);
  const [showUnmatched, setShowUnmatched] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<ArSummaryResponse>('/api/rentals/ar-summary')
      .then(r => setArSummary(r.data))
      .catch(() => setArSummary(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    api.get<ArAgingDetail>('/api/rentals/ar-aging-detail')
      .then(r => setArAgingData(r.data))
      .catch(() => setArAgingData(null));
  }, []);

  const port = arSummary?.portfolio;
  const companies = arSummary?.companies ?? [];

  // KPI tiles
  const bestCo = useMemo(() => {
    if (!companies.length) return null;
    return [...companies].sort((a, b) => b.latest_rate - a.latest_rate)[0];
  }, [companies]);

  const zeroPay = useMemo(
    () => companies.filter(c => c.billed_per_month > 0 && c.latest_collected === 0),
    [companies],
  );

  const kpiTiles = port ? [
    { label: 'Total Billed / Month',  value: fmtDollar(port.total_billed),       sub: `${port.occupied_units} occupied units · registry`,       leftBorder: '#2F80ED' },
    { label: 'Collected (Latest Mo)', value: fmtDollar(port.total_collected),     sub: `↑ ${port.collection_rate.toFixed(1)}% collection rate`,  leftBorder: '#22A06B' },
    { label: 'Outstanding AR',        value: fmtDollar(port.total_outstanding),   sub: `${companies.filter(c => c.latest_outstanding > 0).length} companies with gaps`, leftBorder: '#D9534F' },
    { label: 'Collection Rate',       value: `${port.collection_rate.toFixed(1)}%`, sub: `Target ≥ 95% · ${port.collection_rate >= 95 ? 'On Track' : 'Below Target'}`, leftBorder: '#F2994A' },
    { label: 'Vacancy Loss / Month',  value: fmtDollar(port.vacancy_loss),        sub: `${port.total_units - port.occupied_units} vacant / notice units`, leftBorder: '#D9534F' },
    { label: 'Total Units',           value: String(port.total_units),             sub: `${port.occupied_units} occupied · ${port.total_units - port.occupied_units} vacant`, leftBorder: '#2F80ED' },
    { label: 'Zero-Pay Companies',    value: String(zeroPay.length),               sub: zeroPay.map(c => c.company_name).join(', ') || 'None', leftBorder: '#D9534F' },
    { label: 'Best Performer',        value: bestCo?.company_name ?? '—',          sub: bestCo ? `${bestCo.latest_rate.toFixed(1)}% · ${fmtDollar(bestCo.latest_collected)} collected` : '', leftBorder: '#22A06B' },
  ] : [];

  // Trend chart — last 6 months
  const trendData = useMemo(() => {
    const trend = arSummary?.monthly_trend ?? [];
    return trend.slice(-6).map(d => ({ ...d, month: shortMonth(d.month) }));
  }, [arSummary]);

  // Outstanding AR by company (latest month)
  const outstandingData = useMemo(() =>
    [...companies]
      .filter(c => c.latest_outstanding > 0)
      .sort((a, b) => b.latest_outstanding - a.latest_outstanding)
      .slice(0, 8)
      .map(c => ({ company: c.company_name, ar: c.latest_outstanding })),
    [companies],
  );

  // Collection rate by company
  const collectionRateData = useMemo(() =>
    [...companies]
      .sort((a, b) => b.latest_rate - a.latest_rate)
      .map(c => ({ name: c.company_name, collected: c.latest_collected, pct: c.latest_rate })),
    [companies],
  );

  // Exception table — companies with outstanding > 0 or zero-pay
  const exceptionRows = useMemo(() => {
    const all = companies
      .filter(c => c.billed_per_month > 0)
      .map(c => {
        const pct = c.latest_rate;
        const status =
          c.latest_collected === 0 ? 'Zero-Pay'
          : pct >= 95  ? 'Paid'
          : pct >= 85  ? 'Partial'
          : pct < 50   ? 'Declining'
          : 'Partial';
        return { ...c, status };
      });
    if (activeFilter === 'All') return all;
    return all.filter(r => r.status === activeFilter);
  }, [companies, activeFilter]);

  // Reconciliation flags
  const reconFlags = useMemo(() =>
    companies.flatMap(c =>
      c.monthly.flatMap(m =>
        m.recon_flag ? [{ company: c.company_name, month: m.month, ...m.recon_flag }] : [],
      ),
    ),
    [companies],
  );

  // Aging display
  const agingData = useMemo(() => {
    if (!arAgingData) return null;
    const { portfolio_buckets: b } = arAgingData;
    return [
      { bucket: 'Current', amount: b.current },
      { bucket: '1–30d',   amount: b['1_30'] },
      { bucket: '31–60d',  amount: b['31_60'] },
      { bucket: '60d+',    amount: b['61_90'] + b['90_plus'] },
    ];
  }, [arAgingData]);

  const agingTotal = agingData?.reduce((s, d) => s + d.amount, 0) ?? 0;

  const hasData = !!port && (port.total_billed > 0 || port.total_collected > 0);

  // ── Data source legend ────────────────────────────────────────────────────

  const sourceSummary = useMemo(() => {
    const rr  = companies.filter(c => c.has_rent_receivable).length;
    const pl  = companies.filter(c => !c.has_rent_receivable && c.has_pl_data).length;
    const none = companies.filter(c => !c.has_rent_receivable && !c.has_pl_data).length;
    return { rr, pl, none };
  }, [companies]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-5 bg-gray-50 min-h-screen space-y-4">

      {/* Loading */}
      {loading && (
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8 }}>
          <div style={{ width:18, height:18, border:'2px solid #E8DEC8', borderTopColor:'#D4AF37', borderRadius:'50%', animation:'spin 0.8s linear infinite', flexShrink:0 }} />
          <span style={{ fontSize:13, color:'#78716C' }}>Loading AR data…</span>
          <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Data source banner */}
      {!loading && hasData && (
        <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:10, padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#14532D' }}>
            ✅ Live data from registry · Billed = occupied units monthly rent
          </div>
          <div style={{ display:'flex', gap:16, fontSize:11, color:'#166534' }}>
            {sourceSummary.rr  > 0 && <span>🔵 {sourceSummary.rr} co. via Rent Receivable upload</span>}
            {sourceSummary.pl  > 0 && <span>🟡 {sourceSummary.pl} co. via P&L fallback</span>}
            {sourceSummary.none > 0 && <span style={{ color:'#9CA3AF' }}>⚪ {sourceSummary.none} co. no collection data yet</span>}
          </div>
        </div>
      )}

      {/* No data state */}
      {!loading && !hasData && (
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:10, padding:'40px 24px', textAlign:'center' }}>
          <p style={{ fontSize:14, fontWeight:600, color:'#5C5043', marginBottom:8 }}>No AR data available yet</p>
          <p style={{ fontSize:12, color:'#9CA3AF' }}>
            Add units to companies in the Company Registry, then upload a Rent Receivable Excel or P&L financials to populate this dashboard.
          </p>
        </div>
      )}

      {/* 1 — FILTER BAR */}
      {hasData && (
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:'10px 14px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, fontWeight:500, color:'#262626' }}>Filter:</span>
          <select style={{ fontSize:12, border:'1px solid #E8DEC8', borderRadius:6, padding:'4px 8px', background:'#FBF6EE', color:'#374151' }}>
            <option>All Months</option>
            {[...new Set(companies.flatMap(c => c.monthly.map(m => m.month)))].sort().map(m => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select style={{ fontSize:12, border:'1px solid #E8DEC8', borderRadius:6, padding:'4px 8px', background:'#FBF6EE', color:'#374151' }}>
            <option>All Companies</option>
            {companies.map(c => <option key={c.company_id}>{c.company_name}</option>)}
          </select>
          <div style={{ marginLeft:'auto', fontSize:11, color:'#9CA3AF' }}>
            {companies.length} companies · {port?.total_units ?? 0} total units · {port?.occupied_units ?? 0} occupied
          </div>
        </div>
      )}

      {/* 2 — 8 KPI TILES */}
      {hasData && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:8 }}>
          {kpiTiles.map((t, i) => (
            <div key={i} style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:'10px 12px', borderLeft:`3px solid ${t.leftBorder}` }}>
              <div style={{ fontSize:11, fontWeight:600, textTransform:'uppercase', color:'#6B6B6B', lineHeight:1.3, marginBottom:6 }}>{t.label}</div>
              <div style={{ fontSize:18, fontWeight:700, color:'#262626', fontFamily:'monospace', lineHeight:1 }}>{t.value}</div>
              <div style={{ fontSize:10, marginTop:4, lineHeight:1.3, color:'#6B6B6B' }}>{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* 3 — TREND + AGING */}
      {hasData && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

          {/* Billed vs Collected */}
          <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#262626', marginBottom:2 }}>Billed vs Collected by month</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:12 }}>Portfolio total · last 6 months · billed from unit registry</div>
            {trendData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={trendData} margin={{ top:10, right:10, bottom:0, left:0 }} barCategoryGap="25%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E8DEC8" />
                    <XAxis dataKey="month" tick={{ fontSize:9, fill:'#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize:9, fill:'#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={38} />
                    <Tooltip
                      contentStyle={{ fontSize:'11px', borderRadius:'8px', border:'0.5px solid #E8DEC8' }}
                      formatter={(v: number, n: string) => [`$${v.toLocaleString()}`, n === 'billed' ? 'Billed' : 'Collected']}
                    />
                    <Bar dataKey="billed"    name="billed"    fill="#D4AF37" opacity={0.75} radius={[3,3,0,0]} />
                    <Bar dataKey="collected" name="collected" fill="#22A06B" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display:'flex', gap:16, marginTop:8 }}>
                  <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'#6B6B6B' }}>
                    <span style={{ width:10, height:10, borderRadius:2, background:'#D4AF37', opacity:0.75, display:'inline-block' }} />Billed
                  </span>
                  <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'#6B6B6B' }}>
                    <span style={{ width:10, height:10, borderRadius:2, background:'#22A06B', display:'inline-block' }} />Collected
                  </span>
                </div>
              </>
            ) : (
              <p style={{ fontSize:12, color:'#9CA3AF', textAlign:'center', paddingTop:40 }}>No monthly trend data yet</p>
            )}
          </div>

          {/* AR Aging — placeholder until invoice data provided */}
          <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#262626', marginBottom:2 }}>AR Aging by bucket</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:12 }}>Outstanding balance distribution</div>
            {agingData && agingTotal > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={agingData} layout="vertical" margin={{ top:0, right:40, bottom:0, left:45 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8DEC8" />
                    <XAxis type="number" tick={{ fontSize:9, fill:'#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} />
                    <YAxis dataKey="bucket" type="category" tick={{ fontSize:10, fill:'#6b7280' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize:'11px', borderRadius:'8px' }} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Outstanding']} />
                    <Bar dataKey="amount" radius={[0,4,4,0]}>
                      {agingData.map((_, i) => <Cell key={i} fill={AGING_FILL[i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4, marginTop:12 }}>
                  {agingData.map((a, idx) => (
                    <div key={a.bucket} style={{ textAlign:'center' }}>
                      <div style={{ height:3, borderRadius:2, background:AGING_FILL[idx], marginBottom:4 }} />
                      <div style={{ fontSize:9, color:'#9CA3AF' }}>{a.bucket}</div>
                      <div style={{ fontSize:10, fontFamily:'monospace', fontWeight:500, color:'#374151' }}>
                        {agingTotal > 0 ? `${(a.amount / agingTotal * 100).toFixed(0)}%` : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:180, gap:8 }}>
                <div style={{ fontSize:28, opacity:0.3 }}>📋</div>
                <p style={{ fontSize:12, color:'#B0A898', fontWeight:500 }}>Aging data not yet available</p>
                <p style={{ fontSize:10, color:'#C8C0B0', textAlign:'center', maxWidth:200 }}>
                  Invoice-level aging requires RentalInvoice records with due dates. Upload separately when ready.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4 — OUTSTANDING AR + COLLECTION RATE */}
      {hasData && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

          {/* Outstanding AR by company */}
          <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#262626', marginBottom:2 }}>Outstanding AR by company</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:12 }}>Billed (registry) − collected · latest month</div>
            {outstandingData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.max(180, outstandingData.length * 32)}>
                <BarChart data={outstandingData} layout="vertical" margin={{ top:0, right:60, bottom:0, left:80 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8DEC8" />
                  <XAxis type="number" tick={{ fontSize:9, fill:'#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} />
                  <YAxis dataKey="company" type="category" tick={{ fontSize:10, fill:'#374151' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize:'11px', borderRadius:'8px' }} formatter={(v: number) => [`$${v.toLocaleString()}`, 'Outstanding AR']} />
                  <Bar dataKey="ar" radius={[0,4,4,0]} label={{ position:'right', fontSize:9, fill:'#6b7280', formatter: (v: number) => `$${v.toLocaleString()}` }}>
                    {outstandingData.map((_, i) => <Cell key={i} fill={i < 2 ? '#D9534F' : i < 4 ? '#F5A623' : '#22A06B'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:180 }}>
                <p style={{ fontSize:12, color:'#9CA3AF' }}>No outstanding AR — all companies current ✓</p>
              </div>
            )}
          </div>

          {/* Collection rate by company */}
          <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'#262626', marginBottom:2 }}>Collection rate by company</div>
            <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:16 }}>Latest month collected vs billed</div>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {collectionRateData.map(co => (
                <div key={co.name}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <span style={{ fontSize:12, color:'#374151', fontWeight:500 }}>{co.name}</span>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:11, fontFamily:'monospace', color:'#6B6B6B' }}>${co.collected.toLocaleString()}</span>
                      <span style={{
                        fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:20,
                        background: co.pct >= 95 ? '#DCFCE7' : co.pct >= 90 ? '#FEF9C3' : '#FEE2E2',
                        color:      co.pct >= 95 ? '#166534' : co.pct >= 90 ? '#92400E' : '#991B1B',
                      }}>
                        {co.pct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div style={{ height:8, background:'#E8DEC8', borderRadius:4, overflow:'hidden' }}>
                    <div style={{
                      height:'100%', borderRadius:4,
                      background: co.pct >= 95 ? '#22A06B' : co.pct >= 85 ? '#F5A623' : '#D9534F',
                      width:`${Math.min(100, co.pct)}%`,
                      transition:'width 0.4s ease',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 5 — EXCEPTION TABLE */}
      {hasData && (
        <div style={{ background:'#fff', border:'1px solid #E8DEC8', borderRadius:10, padding:16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:'#1C1917' }}>Collection summary by company</div>
              <div style={{ fontSize:11, color:'#9CA3AF', marginTop:2 }}>
                Billed from unit registry · collected from {sourceSummary.rr > 0 ? 'Rent Receivable' : 'P&L'} · latest available month
              </div>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {['All', 'Zero-Pay', 'Partial', 'Paid', 'Declining'].map(f => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  style={{
                    fontSize:10, padding:'4px 10px', borderRadius:6, border:'1px solid',
                    borderColor: activeFilter === f ? '#1C1917' : '#E8DEC8',
                    background:  activeFilter === f ? '#1C1917' : 'transparent',
                    color:       activeFilter === f ? '#fff' : '#6B6B6B',
                    cursor:'pointer',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#F7F1E6' }}>
                  {['Company','Month','Units','Billed/Mo','Collected','Outstanding','Rate','Source','Status'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Company' || h === 'Source' || h === 'Status' ? 'left' : 'right', padding:'8px 10px', fontSize:10, fontWeight:600, color:'#5C5043', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exceptionRows.length === 0 ? (
                  <tr><td colSpan={9} style={{ padding:'24px', textAlign:'center', color:'#9CA3AF', fontSize:12 }}>No exceptions for this filter</td></tr>
                ) : exceptionRows.map((row, i) => (
                  <tr key={i} style={{ borderTop:'1px solid #F0EBE3', background: i % 2 === 0 ? '#FDFAF6' : '#fff' }}>
                    <td style={{ padding:'8px 10px', fontWeight:500, color:'#1C1917', whiteSpace:'nowrap' }}>{row.company_name}</td>
                    <td style={{ padding:'8px 10px', textAlign:'right', color:'#6B6B6B' }}>{row.latest_month ?? '—'}</td>
                    <td style={{ padding:'8px 10px', textAlign:'right', color:'#6B6B6B' }}>{row.occupied_units}/{row.total_units}</td>
                    <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', color:'#374151' }}>{fmtDollar(row.billed_per_month)}</td>
                    <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', color:'#166534' }}>{fmtDollar(row.latest_collected)}</td>
                    <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontWeight:600, color: row.latest_outstanding > 0 ? '#991B1B' : '#166534' }}>
                      {row.latest_outstanding > 0 ? fmtDollar(row.latest_outstanding) : '—'}
                    </td>
                    <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', color: row.latest_rate >= 95 ? '#166534' : row.latest_rate >= 85 ? '#92400E' : '#991B1B' }}>
                      {row.latest_rate.toFixed(1)}%
                    </td>
                    <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>
                      <span style={{
                        fontSize:9, padding:'2px 6px', borderRadius:20,
                        background: row.has_rent_receivable ? '#EFF6FF' : row.has_pl_data ? '#FEFCE8' : '#F3F4F6',
                        color:      row.has_rent_receivable ? '#1E40AF' : row.has_pl_data ? '#92400E' : '#6B7280',
                      }}>
                        {row.has_rent_receivable ? 'Rent Rcv' : row.has_pl_data ? 'P&L' : 'No data'}
                      </span>
                    </td>
                    <td style={{ padding:'8px 10px' }}>
                      <span style={{
                        fontSize:9, fontWeight:600, padding:'3px 8px', borderRadius:20,
                        background: row.status === 'Zero-Pay' ? '#FEE2E2' : row.status === 'Declining' ? '#FEF3C7' : row.status === 'Paid' ? '#DCFCE7' : '#FEF3C7',
                        color:      row.status === 'Zero-Pay' ? '#991B1B' : row.status === 'Declining' ? '#92400E' : row.status === 'Paid' ? '#166534' : '#92400E',
                      }}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6 — RECONCILIATION FLAGS */}
      {reconFlags.length > 0 && (
        <div style={{ background:'#FFFBEB', border:'1px solid #FCD34D', borderRadius:10, padding:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#92400E', marginBottom:10 }}>
            ⚠️ Reconciliation Flags — Rent Receivable vs P&L differ by {'>'} 2%
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:8 }}>
            {reconFlags.map((f, i) => (
              <div key={i} style={{ background:'#fff', border:'1px solid #FCD34D', borderRadius:6, padding:'10px 12px', fontSize:11 }}>
                <div style={{ fontWeight:600, color:'#1C1917', marginBottom:4 }}>{f.company} · {f.month}</div>
                <div style={{ color:'#2F80ED' }}>Rent Receivable: ${f.rent_receivable.toLocaleString()}</div>
                <div style={{ color:'#92400E' }}>P&L:             ${f.pl.toLocaleString()}</div>
                <div style={{ color:'#D9534F', fontWeight:600, marginTop:2 }}>Δ {f.diff_pct}% difference</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7 — UNMATCHED P&L LINES */}
      {(arSummary?.unmatched_lines?.length ?? 0) > 0 && (
        <div style={{ background:'#FFF7ED', border:'1px solid #FDBA74', borderRadius:10, padding:16 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:showUnmatched ? 12 : 0 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'#9A3412' }}>
              ⚠️ {arSummary!.unmatched_lines.length} Unmatched P&L line{arSummary!.unmatched_lines.length !== 1 ? 's' : ''} — unit label not found in registry
            </div>
            <button
              onClick={() => setShowUnmatched(v => !v)}
              style={{ fontSize:11, color:'#9A3412', background:'none', border:'none', cursor:'pointer', textDecoration:'underline' }}
            >
              {showUnmatched ? 'Hide' : 'Show all'}
            </button>
          </div>
          {showUnmatched && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {arSummary!.unmatched_lines.map((u, i) => (
                <div key={i} style={{ display:'flex', gap:12, fontSize:11, background:'#fff', border:'1px solid #FDBA74', borderRadius:6, padding:'6px 10px' }}>
                  <span style={{ fontWeight:600, color:'#7C3AED', minWidth:120 }}>{u.company}</span>
                  <span style={{ color:'#374151', fontFamily:'monospace' }}>{u.label}</span>
                </div>
              ))}
              <p style={{ fontSize:10, color:'#B45309', marginTop:4 }}>
                These rent lines exist in P&L but couldn't be matched to a unit in the Company Registry.
                Check unit names for typos or update the registry.
              </p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
