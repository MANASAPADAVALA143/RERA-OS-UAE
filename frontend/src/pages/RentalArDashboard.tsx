import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import api from '../services/api';

// ── Month labels ──────────────────────────────────────────────────────────────
const MONTHS_ORDER = [
  'Jan-2026','Feb-2026','Mar-2026','Apr-2026','May-2026','Jun-2026',
  'Jul-2026','Aug-2026','Sep-2026','Oct-2026','Nov-2026','Dec-2026',
];

// ── Synced company shape (from /api/rentals/companies) ───────────────────────
interface SyncedCompany {
  id: string;
  company_name: string;
  sync_collected: number | null;
  sync_vacancy_loss: number | null;
  sync_gross_potential: number | null;
  sync_occupied_units: number | null;
  sync_total_units: number | null;
  last_sync_month: string | null;
  monthly_rent_data: Record<string, number> | null;
}

// ── Static fallback data (used when no sync available) ────────────────────────
const STATIC_TREND = [
  { month: 'Jan', billed: 83055, collected: 79102 },
  { month: 'Feb', billed: 84140, collected: 80853 },
  { month: 'Mar', billed: 80693, collected: 77465 },
  { month: 'Apr', billed: 83432, collected: 82190 },
  { month: 'May', billed: 80004, collected: 74804 },
  { month: 'Jun', billed: 80739, collected: 75246 },
];

const STATIC_AGING_DATA = [
  { bucket: 'Current', amount: 12167 },
  { bucket: '1–30d',   amount: 5148  },
  { bucket: '31–60d',  amount: 3742  },
  { bucket: '60d+',    amount: 2346  },
];
const AGING_FILL = ['#22c55e', '#f59e0b', '#f97316', '#ef4444'];

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
    buckets?: Record<string, number>;
  }>;
  generated_at: string;
}

const EXCEPTIONS = [
  { co:'BNC LLC',  unit:'Unit B,C',     suite:'S123',  exp:1600,  coll:0,     bal:9600,  months:'All 6',   deposit:'None on file',  status:'Zero-Pay',   sc:'r' },
  { co:'BNC LLC',  unit:'Unit K',       suite:'S123',  exp:800,   coll:0,     bal:4800,  months:'All 6',   deposit:'None on file',  status:'Zero-Pay',   sc:'r' },
  { co:'BNC LLC',  unit:'Unit Q',       suite:'S123',  exp:730,   coll:0,     bal:4380,  months:'All 6',   deposit:'None on file',  status:'Zero-Pay',   sc:'r' },
  { co:'BNC LLC',  unit:'Unit R',       suite:'S123',  exp:1800,  coll:0,     bal:10800, months:'All 6',   deposit:'None on file',  status:'Zero-Pay',   sc:'r' },
  { co:'ABC LLC',  unit:'Unit A',       suite:'S123',  exp:850,   coll:4250,  bal:850,   months:'Jun only',deposit:'$1,275 held',   status:'Partial',    sc:'a' },
  { co:'ABC LLC',  unit:'Unit EFG',     suite:'S123',  exp:3100,  coll:15500, bal:1550,  months:'Jun only',deposit:'$4,650 held',   status:'Partial',    sc:'a' },
  { co:'DEC LLC',  unit:'Apr spike',    suite:'S123',  exp:13275, coll:16819, bal:0,     months:'Apr',     deposit:'N/A',           status:'Reclassify', sc:'b' },
  { co:'XYZ LLC',  unit:'Multiple',     suite:'All',   exp:4500,  coll:3850,  bal:1300,  months:'Apr–May', deposit:'Partial',       status:'Partial',    sc:'a' },
  { co:'NHJ LLC',  unit:'Unit A,B,C,G', suite:'NHJ',  exp:2700,  coll:1950,  bal:750,   months:'Mar',     deposit:'$4,050 held',   status:'Partial',    sc:'a' },
  { co:'KLI LLC',  unit:'Portfolio',    suite:'All',   exp:11975, coll:10500, bal:1475,  months:'Trending',deposit:'Varies',        status:'Declining',  sc:'a' },
];

const fmtK = (v: number) => `$${Math.round(Math.abs(v) / 1000)}K`;
const fmtDollar = (v: number) => `$${Math.round(v).toLocaleString()}`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function RentalArDashboard() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [companies, setCompanies] = useState<SyncedCompany[]>([]);
  const [arAgingData, setArAgingData] = useState<ArAgingDetail | null>(null);

  useEffect(() => {
    api.get<SyncedCompany[]>('/api/rentals/companies')
      .then(r => setCompanies(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get<ArAgingDetail>('/api/rentals/ar-aging-detail')
      .then(r => setArAgingData(r.data))
      .catch(() => setArAgingData(null));
  }, []);

  const hasSyncedData = useMemo(
    () => companies.some(c => c.last_sync_month),
    [companies],
  );

  const lastSyncMonth = useMemo(
    () => companies.find(c => c.last_sync_month)?.last_sync_month ?? '',
    [companies],
  );

  // Format aging data for display
  const agingData = useMemo(() => {
    if (!arAgingData) return STATIC_AGING_DATA;
    const { portfolio_buckets } = arAgingData;
    return [
      { bucket: 'Current', amount: portfolio_buckets.current },
      { bucket: '1–30d', amount: portfolio_buckets['1_30'] },
      { bucket: '31–60d', amount: portfolio_buckets['31_60'] },
      { bucket: '60d+', amount: portfolio_buckets['61_90'] + portfolio_buckets['90_plus'] },
    ];
  }, [arAgingData]);

  // Calculate percentages for aging buckets
  const agingPercentages = useMemo(() => {
    const total = agingData.reduce((sum, d) => sum + d.amount, 0);
    return agingData.map(d => ({
      ...d,
      pct: total > 0 ? ((d.amount / total) * 100).toFixed(0) + '%' : '0%',
    }));
  }, [agingData]);

  const synced = useMemo(
    () => companies.filter(c => c.last_sync_month),
    [companies],
  );

  // Portfolio-level aggregates
  const totalBilled    = useMemo(() => synced.reduce((a, c) => a + (c.sync_gross_potential ?? 0), 0), [synced]);
  const totalCollected = useMemo(() => synced.reduce((a, c) => a + (c.sync_collected ?? 0), 0), [synced]);
  const totalOutstanding = useMemo(() => totalBilled - totalCollected, [totalBilled, totalCollected]);
  const collectionRate   = useMemo(() => totalBilled > 0 ? (totalCollected / totalBilled * 100) : 0, [totalBilled, totalCollected]);

  // Trend data — use last 6 non-zero months from monthly_rent_data
  const trendData = useMemo(() => {
    if (!hasSyncedData) return STATIC_TREND;
    const monthMap = new Map<string, number>();
    for (const co of synced) {
      if (!co.monthly_rent_data) continue;
      for (const [m, amt] of Object.entries(co.monthly_rent_data)) {
        monthMap.set(m, (monthMap.get(m) ?? 0) + (amt as number));
      }
    }
    const billedPerMonth = totalBilled; // use gross_potential as flat billed line
    return MONTHS_ORDER
      .filter(m => (monthMap.get(m) ?? 0) > 0)
      .slice(-6)
      .map(m => ({
        month: m.replace('-2026', ''),
        billed: billedPerMonth,
        collected: monthMap.get(m) ?? 0,
      }));
  }, [hasSyncedData, synced, totalBilled]);

  // Outstanding AR per company (gross_potential - collected)
  const outstandingData = useMemo(() => {
    if (!hasSyncedData) return [
      { company: 'BNC LLC', ar: 8250 },
      { company: 'ABC LLC', ar: 5550 },
      { company: 'DEC LLC', ar: 4690 },
      { company: 'KLI LLC', ar: 3150 },
      { company: 'XYZ LLC', ar: 1350 },
      { company: 'ACD LLC', ar: 413  },
    ];
    return synced
      .map(c => ({
        company: c.company_name,
        ar: Math.max(0, (c.sync_gross_potential ?? 0) - (c.sync_collected ?? 0)),
      }))
      .filter(d => d.ar > 0)
      .sort((a, b) => b.ar - a.ar)
      .slice(0, 8);
  }, [hasSyncedData, synced]);

  // Collection rate per company
  const collectionRateData = useMemo(() => {
    if (!hasSyncedData) return [
      { name: 'ZYC LLC', collected: 94675,  pct: 100  },
      { name: 'ACD LLC', collected: 59959,  pct: 99.3 },
      { name: 'FJH LLC', collected: 44950,  pct: 98.4 },
      { name: 'NHJ LLC', collected: 34650,  pct: 97.9 },
      { name: 'KLI LLC', collected: 66548,  pct: 95.5 },
      { name: 'XYZ LLC', collected: 25195,  pct: 94.9 },
      { name: 'DEC LLC', collected: 77398,  pct: 94.3 },
      { name: 'ABC LLC', collected: 26350,  pct: 82.6 },
      { name: 'BNC LLC', collected: 37455,  pct: 81.9 },
    ];
    return synced
      .map(c => ({
        name: c.company_name,
        collected: c.sync_collected ?? 0,
        pct: (c.sync_gross_potential ?? 0) > 0
          ? parseFloat(((c.sync_collected ?? 0) / (c.sync_gross_potential ?? 1) * 100).toFixed(1))
          : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [hasSyncedData, synced]);

  // Best performer
  const bestPerformer = useMemo(
    () => collectionRateData.length > 0 ? collectionRateData[0].name : 'ZYC LLC',
    [collectionRateData],
  );

  // KPI tiles (dynamic when synced)
  const kpiTiles = hasSyncedData ? [
    { label: 'Total Billed (Month)',   value: fmtDollar(totalBilled),         sub: `${lastSyncMonth} · ${synced.length} companies`,         valueColor: 'text-blue-600',  subColor: 'text-gray-400',   accent: 'bg-blue-500'  },
    { label: 'Collected (Month)',      value: fmtDollar(totalCollected),       sub: `↑ ${collectionRate.toFixed(1)}% collection rate`,        valueColor: 'text-green-600', subColor: 'text-green-500',  accent: 'bg-green-500' },
    { label: 'Outstanding AR',         value: fmtDollar(totalOutstanding),     sub: `${outstandingData.length} companies with gaps`,          valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
    { label: 'Collection Rate',        value: `${collectionRate.toFixed(1)}%`, sub: `Target ≥ 95% · ${collectionRate >= 95 ? 'On Track' : 'Below Target'}`, valueColor: collectionRate >= 95 ? 'text-green-600' : 'text-amber-600', subColor: collectionRate >= 95 ? 'text-green-500' : 'text-amber-500', accent: collectionRate >= 95 ? 'bg-green-500' : 'bg-amber-400' },
    { label: 'Vacancy Loss',           value: fmtDollar(synced.reduce((a, c) => a + (c.sync_vacancy_loss ?? 0), 0)), sub: 'Vacant units estimated rent',  valueColor: 'text-amber-600', subColor: 'text-amber-500',  accent: 'bg-amber-400' },
    { label: 'Total Units (Synced)',   value: String(synced.reduce((a, c) => a + (c.sync_total_units ?? 0), 0)),     sub: `${synced.reduce((a, c) => a + (c.sync_occupied_units ?? 0), 0)} occupied`, valueColor: 'text-blue-600', subColor: 'text-gray-400', accent: 'bg-blue-500' },
    { label: 'Avg Days Outstanding',   value: '38 days',                       sub: 'Based on prior data',            valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
    { label: 'Best Performer',         value: bestPerformer,                   sub: `${collectionRateData[0]?.pct ?? 0}% collection rate`,   valueColor: 'text-green-600', subColor: 'text-green-500',  accent: 'bg-green-500' },
  ] : [
    { label: 'Total Rent Billed YTD',  value: '$492,063', sub: 'Jan–Jun 2026 · All 10 companies',  valueColor: 'text-blue-600',  subColor: 'text-gray-400',   accent: 'bg-blue-500'  },
    { label: 'Collected (Est.)',        value: '$468,660', sub: '↑ 95.2% collection rate',          valueColor: 'text-green-600', subColor: 'text-green-500',  accent: 'bg-green-500' },
    { label: 'Outstanding AR',         value: '$23,403',  sub: '↑ 5 companies with gaps',          valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
    { label: 'Collection Rate',        value: '95.2%',    sub: 'Target ≥ 95% · Borderline',        valueColor: 'text-amber-600', subColor: 'text-amber-500',  accent: 'bg-amber-400' },
    { label: 'Zero-Pay Units',         value: '5 Units',  sub: 'BNC LLC · B,C · K · Q · R',       valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
    { label: 'Security Deposits Held', value: '$6,900',   sub: 'Unit 402 S456 · 2 months',         valueColor: 'text-amber-600', subColor: 'text-amber-500',  accent: 'bg-amber-400' },
    { label: 'Avg Days Outstanding',   value: '38 days',  sub: 'PPP LLC 60d+ · LPO LLC 60d+',     valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
    { label: 'Best Performer',         value: 'ZYC LLC',  sub: '$94,675 YTD · Lowest variance',   valueColor: 'text-green-600', subColor: 'text-green-500',  accent: 'bg-green-500' },
  ];

  // Derive live exceptions from synced company data (post-upload)
  const syncedExceptions = useMemo(() => {
    if (!hasSyncedData) return null;
    return synced
      .filter(c => (c.sync_gross_potential ?? 0) > 0 || (c.sync_vacancy_loss ?? 0) > 0)
      .map(c => {
        const gross     = c.sync_gross_potential ?? 0;
        const collected = c.sync_collected ?? 0;
        const outstanding = Math.max(0, gross - collected);
        const vacLoss   = c.sync_vacancy_loss ?? 0;
        const occ       = c.sync_occupied_units ?? 0;
        const total     = c.sync_total_units ?? 0;
        const pct       = gross > 0 ? (collected / gross * 100) : 100;
        const status    = outstanding === 0 ? 'Paid' : pct >= 95 ? 'Partial' : pct === 0 ? 'Zero-Pay' : pct < 85 ? 'Declining' : 'Partial';
        return { co: c.company_name, month: c.last_sync_month ?? '', gross, collected, outstanding, vacLoss, occ, total, pct: Math.round(pct * 10) / 10, status };
      })
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [hasSyncedData, synced]);

  // Only show static exceptions for companies that still exist in the system
  const validCompanyNames = new Set(companies.map(c => c.company_name));
  const exceptionsForValidCompanies = EXCEPTIONS.filter(e => validCompanyNames.has(e.co));

  const filteredExceptions = activeFilter === 'All'
    ? exceptionsForValidCompanies
    : exceptionsForValidCompanies.filter(r => r.status === activeFilter);

  const filteredSyncedExceptions = useMemo(() => {
    if (!syncedExceptions) return null;
    if (activeFilter === 'All') return syncedExceptions;
    return syncedExceptions.filter(r => r.status === activeFilter);
  }, [syncedExceptions, activeFilter]);

  return (
    <div className="p-5 bg-gray-50 min-h-screen space-y-4">

      {/* Sync banner */}
      {hasSyncedData && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <div className="text-xs font-semibold text-emerald-800">
            ✅ Live data — Synced from Rent Receivable Excel · {lastSyncMonth}
          </div>
          <div className="text-[10px] text-emerald-600">KPIs, trend chart, AR by company updated automatically</div>
        </div>
      )}

      {/* 1 — FILTER BAR */}
      <div className="flex items-center gap-3 bg-white rounded-xl p-3 border border-gray-100 shadow-sm">
        <span className="text-xs text-gray-500 font-medium">Filter:</span>
        <select className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700">
          <option>All Months</option>
          {['Jan 2026','Feb 2026','Mar 2026','Apr 2026','May 2026','Jun 2026'].map(m => <option key={m}>{m}</option>)}
        </select>
        <select className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700">
          <option>All Companies</option>
          {companies.length > 0
            ? companies.map(c => <option key={c.id}>{c.company_name}</option>)
            : ['ABC LLC','BNC LLC','DEC LLC','XYZ LLC','ZYC LLC','ACD LLC','NHJ LLC','FJH LLC','KLI LLC','TOWN Houses'].map(c => <option key={c}>{c}</option>)
          }
        </select>
        <select className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700">
          <option>All Units</option>
          <option>Paying</option>
          <option>Zero-Pay</option>
          <option>Partial</option>
          <option>Overdue</option>
        </select>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {hasSyncedData
              ? `${lastSyncMonth} · ${synced.length} Companies · Live sync`
              : 'Jan–Jun 2026 · 10 Companies · 9 sheets parsed'}
          </span>
        </div>
      </div>

      {/* 2 — 8 KPI TILES */}
      <div className="grid grid-cols-8 gap-2">
        {kpiTiles.map((t, i) => (
          <div key={i} className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-[3px] ${t.accent}`} />
            <div className="text-[10px] text-gray-400 leading-tight mb-1.5 mt-1">{t.label}</div>
            <div className={`text-lg font-mono font-medium leading-none ${t.valueColor}`}>{t.value}</div>
            <div className={`text-[9px] mt-1 leading-tight ${t.subColor}`}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* 3 — TREND + AGING (50/50) */}
      <div className="grid grid-cols-2 gap-4">

        {/* Billed vs Collected Trend */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">Billed vs collected by month</div>
          <div className="text-xs text-gray-400 mb-3">
            {hasSyncedData ? `Portfolio total · Last 6 months · ${lastSyncMonth} sync` : 'Portfolio total · Jan–Jun 2026'}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} width={38} />
              <Tooltip
                contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '0.5px solid #e5e7eb' }}
                formatter={(v: number, n: string) => [`$${v.toLocaleString()}`, n === 'billed' ? 'Billed' : 'Collected']}
              />
              <Bar dataKey="billed"    name="billed"    fill="#D4AF37" opacity={0.75} radius={[3, 3, 0, 0]} />
              <Bar dataKey="collected" name="collected" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm inline-block opacity-75" style={{ background: '#D4AF37' }} />Billed
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Collected
            </span>
          </div>
        </div>

        {/* Aging Stacked Bar — Real data from backend */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">AR aging by bucket</div>
          <div className="text-xs text-gray-400 mb-3">Outstanding balance distribution {arAgingData ? `(Total: $${arAgingData.total_ar.toLocaleString()})` : ''}</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={agingData} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 45 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f5f5f5" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} />
              <YAxis dataKey="bucket" type="category" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: '11px', borderRadius: '8px' }}
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Outstanding']}
              />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                {agingData.map((_, i) => <Cell key={i} fill={AGING_FILL[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-4 gap-1 mt-3">
            {agingPercentages.map(a => (
              <div key={a.bucket} className="text-center">
                <div className={`h-1 ${['bg-green-500', 'bg-amber-400', 'bg-orange-500', 'bg-red-500'][agingPercentages.indexOf(a)]} rounded-full mb-1`} />
                <div className="text-[9px] text-gray-500">{a.bucket}</div>
                <div className="text-[10px] font-mono font-medium text-gray-700">{a.pct}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4 — OUTSTANDING AR + COLLECTION % (50/50) */}
      <div className="grid grid-cols-2 gap-4">

        {/* Outstanding AR by Company */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">Outstanding AR by company</div>
          <div className="text-xs text-gray-400 mb-3">
            {hasSyncedData ? `Gross potential − collected · ${lastSyncMonth}` : 'Sorted by balance owed'}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={outstandingData} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 75 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f5f5f5" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} />
              <YAxis dataKey="company" type="category" tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: '11px', borderRadius: '8px' }}
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Outstanding AR']}
              />
              <Bar dataKey="ar" radius={[0, 4, 4, 0]}
                label={{ position: 'right', fontSize: 9, fill: '#6b7280', formatter: (v: number) => `$${v.toLocaleString()}` }}>
                {outstandingData.map((_, i) => (
                  <Cell key={i} fill={i < 2 ? '#ef4444' : i < 4 ? '#f59e0b' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Collection Rate by Company */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">Collection rate by company</div>
          <div className="text-xs text-gray-400 mb-4">
            {hasSyncedData ? `${lastSyncMonth} collected vs gross potential` : 'YTD collected vs billed'}
          </div>
          <div className="space-y-2.5">
            {collectionRateData.map(co => (
              <div key={co.name}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-700 font-medium">{co.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">${co.collected.toLocaleString()}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      co.pct >= 95 ? 'bg-green-100 text-green-700'
                      : co.pct >= 85 ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-600'
                    }`}>
                      {co.pct}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      co.pct >= 95 ? 'bg-green-500' : co.pct >= 85 ? 'bg-amber-400' : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, co.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 5 — EXCEPTION TABLE */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">
              {hasSyncedData ? 'Collection summary by company' : 'Exception matrix — units requiring action'}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {hasSyncedData
                ? `Live data from ${lastSyncMonth} · Gross potential vs collected · vacancy loss`
                : 'All units with zero payment, partial payment, or overdue balance'}
            </div>
          </div>
          <div className="flex gap-2">
            {(hasSyncedData ? ['All', 'Zero-Pay', 'Partial', 'Paid', 'Declining'] : ['All', 'Zero-Pay', 'Partial', 'Overdue', 'Declining']).map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${
                  activeFilter === f
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          {hasSyncedData && filteredSyncedExceptions ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-2 px-3 text-gray-400 font-normal rounded-l-lg">Company</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-normal">Month</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Units Occ/Total</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Gross Potential</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Collected</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Outstanding</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Vac Loss</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-normal rounded-r-lg">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSyncedExceptions.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-gray-400 text-xs">No exceptions for this filter</td></tr>
                ) : filteredSyncedExceptions.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50/50">
                    <td className="py-2 px-3 font-medium text-gray-800">{row.co}</td>
                    <td className="py-2 px-3 text-gray-500">{row.month}</td>
                    <td className="py-2 px-3 text-right font-mono text-gray-600">{row.occ} / {row.total}</td>
                    <td className="py-2 px-3 text-right font-mono text-gray-600">{fmtDollar(row.gross)}</td>
                    <td className="py-2 px-3 text-right font-mono text-green-600">{fmtDollar(row.collected)}</td>
                    <td className={`py-2 px-3 text-right font-mono font-medium ${row.outstanding > 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {row.outstanding > 0 ? fmtDollar(row.outstanding) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-amber-600">{row.vacLoss > 0 ? fmtDollar(row.vacLoss) : '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${
                        row.status === 'Zero-Pay' ? 'bg-red-100 text-red-700'
                        : row.status === 'Declining' ? 'bg-amber-100 text-amber-700'
                        : row.status === 'Paid' ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                      }`}>
                        {row.status} · {row.pct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left py-2 px-3 text-gray-400 font-normal rounded-l-lg">Company</th>
                <th className="text-left py-2 px-3 text-gray-400 font-normal">Unit</th>
                <th className="text-left py-2 px-3 text-gray-400 font-normal">Suite</th>
                <th className="text-right py-2 px-3 text-gray-400 font-normal">Expected/Mo</th>
                <th className="text-right py-2 px-3 text-gray-400 font-normal">Collected</th>
                <th className="text-right py-2 px-3 text-gray-400 font-normal">Balance</th>
                <th className="text-right py-2 px-3 text-gray-400 font-normal">Months Affected</th>
                <th className="text-left py-2 px-3 text-gray-400 font-normal">Deposit Cover</th>
                <th className="text-left py-2 px-3 text-gray-400 font-normal rounded-r-lg">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredExceptions.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50/50">
                  <td className="py-2 px-3 font-medium text-gray-800">{row.co}</td>
                  <td className="py-2 px-3 text-gray-600">{row.unit}</td>
                  <td className="py-2 px-3 text-gray-400">{row.suite}</td>
                  <td className="py-2 px-3 text-right font-mono text-gray-600">${row.exp.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right font-mono text-green-600">${row.coll.toLocaleString()}</td>
                  <td className={`py-2 px-3 text-right font-mono font-medium ${row.bal > 0 ? 'text-red-500' : 'text-green-600'}`}>
                    ${row.bal.toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-500">{row.months}</td>
                  <td className="py-2 px-3 text-gray-500 text-[10px]">{row.deposit}</td>
                  <td className="py-2 px-3">
                    <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${
                      row.sc === 'r' ? 'bg-red-100 text-red-700'
                      : row.sc === 'a' ? 'bg-amber-100 text-amber-700'
                      : row.sc === 'b' ? 'bg-blue-100 text-blue-700'
                      : 'bg-green-100 text-green-700'
                    }`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </div>

      {/* DETAILED AR AGING BY UNIT + MONTH */}
      {arAgingData && arAgingData.unit_detail.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">AR Aging Detail — Per Unit & Month</div>
          <div className="text-xs text-gray-400 mb-3">Each invoice ages independently by days past due date</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Company</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Unit</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Billing Month</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">Amount Owed</th>
                  <th className="text-right py-2 px-3 text-gray-600 font-medium">Days Past Due</th>
                  <th className="text-left py-2 px-3 text-gray-600 font-medium">Aging Bucket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {arAgingData.unit_detail
                  .filter(d => d.billing_month !== 'UNIT_TOTAL')
                  .sort((a, b) => {
                    // Sort by company, then unit, then month descending
                    if (a.company_name !== b.company_name) return a.company_name.localeCompare(b.company_name);
                    if (a.unit_number !== b.unit_number) return a.unit_number.localeCompare(b.unit_number);
                    return (b.billing_month || '').localeCompare(a.billing_month || '');
                  })
                  .slice(0, 50)
                  .map((row, i) => {
                    const bucketColors: Record<string, string> = {
                      'current': 'bg-green-100 text-green-700',
                      '1_30': 'bg-amber-100 text-amber-700',
                      '31_60': 'bg-orange-100 text-orange-700',
                      '61_90': 'bg-orange-200 text-orange-800',
                      '90_plus': 'bg-red-100 text-red-700',
                    };
                    return (
                      <tr key={i} className="hover:bg-gray-50/50">
                        <td className="py-2 px-3 text-gray-800 font-medium">{row.company_name}</td>
                        <td className="py-2 px-3 text-gray-700">{row.unit_number}</td>
                        <td className="py-2 px-3 text-gray-600">{row.billing_month}</td>
                        <td className="py-2 px-3 text-right font-mono text-red-600">${(row.owed || 0).toLocaleString()}</td>
                        <td className="py-2 px-3 text-right font-mono text-gray-600">{row.days_past_due !== undefined ? `${row.days_past_due}d` : '—'}</td>
                        <td className="py-2 px-3">
                          {row.bucket && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${bucketColors[row.bucket] || 'bg-gray-100 text-gray-700'}`}>
                              {row.bucket === 'current' ? 'Current' : row.bucket === '1_30' ? '1–30d' : row.bucket === '31_60' ? '31–60d' : row.bucket === '61_90' ? '61–90d' : '90+d'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-400 mt-3">
            💡 <strong>Verification Example:</strong> If ABC LLC Unit D has both May and June 2026 unpaid rent, you will see TWO separate rows here — one for May in an older bucket (e.g., 61–90d) and one for June in a newer bucket (e.g., 31–60d) — because each month ages independently from its due date (the 1st of that month).
          </div>
        </div>
      )}

    </div>
  );
}
