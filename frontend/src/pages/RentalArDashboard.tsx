import { useState, useMemo, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Building2, AlertTriangle,
  Shield, Percent, Upload,
} from 'lucide-react';

// ── Data ──────────────────────────────────────────────────────────────────────
interface Company {
  name: string;
  suite: string;
  monthly: number[];
  ytd: number;
  avg: number;
  status: string;
  trend: string;
  zeroUnits: string[];
  issues: string[];
}

interface ARData {
  companies: Company[];
  months: string[];
  totalMonthly: number[];
  grandTotal: number;
  portfolioAvg: number;
}

const INITIAL_DATA: ARData = {
  companies: [
    {
      name: 'ZYC LLC', suite: 'ZYC LLC',
      monthly: [15850, 15800, 15900, 15975, 16000, 15150],
      ytd: 94675, avg: 15779,
      status: 'stable', trend: 'flat',
      zeroUnits: [], issues: [],
    },
    {
      name: 'DEC LLC', suite: 'DEC LLC Suite 123',
      monthly: [13275, 12975, 11385, 16819, 12790, 14844],
      ytd: 82088, avg: 13681,
      status: 'watch', trend: 'volatile',
      zeroUnits: [],
      issues: ['Apr spike +$5,434 — classify as rent vs deposit'],
    },
    {
      name: 'KLI LLC', suite: 'KLI LLC',
      monthly: [11975, 13975, 11175, 10848, 11225, 10500],
      ytd: 69698, avg: 11616,
      status: 'watch', trend: 'declining',
      zeroUnits: [],
      issues: ['Jan→Jun decline of $1,475 (12.3%) — review leases'],
    },
    {
      name: 'ACD LLC', suite: 'ACD LLC',
      monthly: [10325, 10125, 10518, 9675, 9874, 9855],
      ytd: 60372, avg: 10062,
      status: 'watch', trend: 'slight_decline',
      zeroUnits: [],
      issues: ['Apr dip to $9,675 — below $10K threshold'],
    },
    {
      name: 'BNC LLC', suite: 'BNC LLC Suite 123',
      monthly: [8380, 7535, 8335, 6785, 6785, 7885],
      ytd: 45705, avg: 7618,
      status: 'critical', trend: 'volatile',
      zeroUnits: ['Unit B,C', 'Unit K', 'Unit Q', 'Unit R'],
      issues: ['5 units showing $0 all 6 months — vacancy or non-collection'],
    },
    {
      name: 'FJH LLC', suite: 'FJH LLC',
      monthly: [7475, 7475, 7875, 7875, 7875, 7105],
      ytd: 45680, avg: 7613,
      status: 'stable', trend: 'flat',
      zeroUnits: [],
      issues: ['Jun dip to $7,105 — $770 below May'],
    },
    {
      name: 'NHJ LLC', suite: 'NHJ LLC',
      monthly: [6000, 6030, 5280, 6030, 6030, 6030],
      ytd: 35400, avg: 5900,
      status: 'stable', trend: 'flat',
      zeroUnits: [],
      issues: ['Mar partial payment $5,280 vs usual $6,030'],
    },
    {
      name: 'ABC LLC', suite: 'ABC LLC Suite 123',
      monthly: [5575, 5575, 5575, 5575, 5575, 4025],
      ytd: 31900, avg: 5317,
      status: 'critical', trend: 'declining',
      zeroUnits: ['Unit A (Jun)'],
      issues: ['Jun dropped 28% — $1,550 shortfall vs prior months'],
    },
    {
      name: 'XYZ LLC', suite: 'XYZ LLC',
      monthly: [4200, 4650, 4650, 3850, 3850, 5345],
      ytd: 26545, avg: 4424,
      status: 'watch', trend: 'recovering',
      zeroUnits: [],
      issues: ['Apr–May dip to $3,850 — recovered in Jun'],
    },
    {
      name: 'TOWN Houses', suite: 'Town Houses (Multi-LLC)',
      monthly: [0, 0, 0, 0, 0, 0],
      ytd: 0, avg: 0,
      status: 'no_data', trend: 'pending',
      zeroUnits: [],
      issues: ['Town Houses data not yet captured in this file'],
    },
  ],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  totalMonthly: [83055, 84140, 80693, 83432, 80004, 80739],
  grandTotal: 492063,
  portfolioAvg: 82011,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number) => {
  if (v === 0) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
};

const statusBadgeCls = (s: string) => {
  const map: Record<string, string> = {
    stable: 'bg-green-100 text-green-700',
    watch: 'bg-amber-100 text-amber-700',
    critical: 'bg-red-100 text-red-700',
    declining: 'bg-red-100 text-red-700',
    recovering: 'bg-blue-100 text-blue-700',
    no_data: 'bg-gray-100 text-gray-500',
    volatile: 'bg-orange-100 text-orange-700',
    slight_decline: 'bg-amber-100 text-amber-700',
    flat: 'bg-green-100 text-green-700',
  };
  return map[s] || 'bg-gray-100 text-gray-500';
};

const borderByCls = (s: string) => {
  if (s === 'critical') return 'border-red-200';
  if (s === 'watch' || s === 'declining' || s === 'slight_decline') return 'border-amber-200';
  if (s === 'stable' || s === 'recovering' || s === 'flat') return 'border-green-100';
  return 'border-gray-100';
};

// ── Main Component ─────────────────────────────────────────────────────────────
export default function RentalArDashboard() {
  const [arData, setArData] = useState<ARData>(INITIAL_DATA);
  const [sortCol, setSortCol] = useState<'ytd' | 'avg' | 'name' | number>('ytd');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCompany, setFilterCompany] = useState('All Companies');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // KPI calculations
  const portfolioTotal = arData.companies.reduce((s, c) => s + c.ytd, 0);
  const portfolioAvgMonthly = portfolioTotal / 6;
  const topPerformer = [...arData.companies].sort((a, b) => b.ytd - a.ytd)[0];
  const totalZeroUnits = arData.companies.reduce((s, c) => s + c.zeroUnits.length, 0);
  const bottomPerformer = [...arData.companies].filter(c => c.ytd > 0).sort((a, b) => a.ytd - b.ytd)[0];
  const junVsJan = arData.totalMonthly[5] - arData.totalMonthly[0];

  // Sorted + filtered companies
  const sortedCompanies = useMemo(() => {
    let list = arData.companies;
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus);
    if (filterCompany !== 'All Companies') list = list.filter(c => c.name === filterCompany);
    return [...list].sort((a, b) => {
      const av = sortCol === 'name' ? a.name : sortCol === 'ytd' ? a.ytd : sortCol === 'avg' ? a.avg : typeof sortCol === 'number' ? a.monthly[sortCol] : 0;
      const bv = sortCol === 'name' ? b.name : sortCol === 'ytd' ? b.ytd : sortCol === 'avg' ? b.avg : typeof sortCol === 'number' ? b.monthly[sortCol] : 0;
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [arData, sortCol, sortDir, filterStatus, filterCompany]);

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const thCls = (col: typeof sortCol) =>
    `text-left py-2 px-2 text-[10px] font-normal text-gray-400 cursor-pointer select-none whitespace-nowrap hover:text-gray-700 ${sortCol === col ? 'text-blue-600' : ''}`;

  const isLow = (c: Company, i: number) => c.monthly[i] < c.avg * 0.9;
  const isHigh = (c: Company, i: number) => c.monthly[i] > c.avg * 1.1;

  // Monthly bar chart data
  const barData = arData.months.map((m, i) => ({
    month: m,
    total: arData.totalMonthly[i],
  }));
  const avgLine = portfolioAvgMonthly;

  // Upload handler (stub — parses and replaces state)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Future: parse XLSX with same logic as PropDev parser
    alert(`File "${file.name}" received. XLSX parsing will update AR data automatically.`);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Hero tiles config
  const tiles = [
    {
      icon: <DollarSign size={15} />, label: 'Total Billed YTD', value: fmt(portfolioTotal),
      sub: 'Jan – Jun 2026', accent: 'bg-blue-500', iBg: 'bg-blue-50', iCol: 'text-blue-700',
    },
    {
      icon: <TrendingUp size={15} />, label: 'Avg Monthly Portfolio', value: fmt(Math.round(portfolioAvgMonthly)),
      sub: 'Per month avg', accent: 'bg-green-500', iBg: 'bg-green-50', iCol: 'text-green-700',
    },
    {
      icon: <Building2 size={15} />, label: 'Top Performer', value: topPerformer?.name ?? '—',
      sub: `YTD ${fmt(topPerformer?.ytd ?? 0)}`, accent: 'bg-green-500', iBg: 'bg-green-50', iCol: 'text-green-700',
    },
    {
      icon: <AlertTriangle size={15} />, label: 'Zero-Pay Units', value: String(totalZeroUnits),
      sub: 'BNC LLC (4) + ABC LLC (1)', accent: 'bg-red-500', iBg: 'bg-red-50', iCol: 'text-red-700',
    },
    {
      icon: <TrendingDown size={15} />, label: 'Lowest Performer', value: bottomPerformer?.name ?? '—',
      sub: `YTD ${fmt(bottomPerformer?.ytd ?? 0)}`, accent: 'bg-amber-400', iBg: 'bg-amber-50', iCol: 'text-amber-700',
    },
    {
      icon: junVsJan >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />,
      label: 'Jun vs Jan Variance',
      value: `${junVsJan >= 0 ? '+' : ''}${fmt(Math.abs(junVsJan))}`,
      sub: junVsJan < 0 ? 'Portfolio declined' : 'Portfolio grew',
      accent: junVsJan >= 0 ? 'bg-green-500' : 'bg-amber-400',
      iBg: junVsJan >= 0 ? 'bg-green-50' : 'bg-amber-50',
      iCol: junVsJan >= 0 ? 'text-green-700' : 'text-amber-700',
    },
  ];

  return (
    <div className="space-y-3 p-4">

      {/* 1 — DARK HEADER */}
      <div style={{ background: '#1a2332', borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ color: '#fff', fontSize: '14px', fontWeight: 500 }}>AR Dashboard — Rent Receivables 2026</div>
          <div style={{ color: '#8899aa', fontSize: '10px', marginTop: '2px' }}>
            10 Companies · ABC LLC · BNC LLC · DEC LLC · XYZ LLC · ZYC LLC · ACD LLC · NHJ LLC · FJH LLC · KLI LLC · Town Houses · Jan–Jun 2026
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <select
            value={filterCompany}
            onChange={e => setFilterCompany(e.target.value)}
            className="text-xs border border-gray-600 bg-gray-700 text-gray-300 rounded px-2 py-1"
          >
            <option>All Companies</option>
            {arData.companies.map(c => <option key={c.name}>{c.name}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="text-xs border border-gray-600 bg-gray-700 text-gray-300 rounded px-2 py-1"
          >
            <option value="all">All Status</option>
            <option value="stable">Stable</option>
            <option value="watch">Watch</option>
            <option value="critical">Critical</option>
          </select>
          <button className="text-xs bg-blue-700 text-white px-3 py-1 rounded border border-blue-600 hover:bg-blue-600">
            Export
          </button>
        </div>
      </div>

      {/* 2 — KPI HERO TILES */}
      <div className="grid grid-cols-6 gap-2">
        {tiles.map((t, i) => (
          <div key={i} className="bg-white rounded-xl p-3 border border-gray-100 relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-[3px] ${t.accent}`} />
            <div className={`w-7 h-7 rounded-lg ${t.iBg} flex items-center justify-center mb-2 mt-1`}>
              <span className={t.iCol}>{t.icon}</span>
            </div>
            <div className="text-base font-mono font-semibold leading-none text-gray-900 truncate">{t.value}</div>
            <div className="text-[10px] text-gray-400 mt-1">{t.label}</div>
            <div className="text-[9px] text-gray-400 mt-1 truncate">{t.sub}</div>
          </div>
        ))}
      </div>

      {/* 3 — MAIN TABLE + RIGHT PANELS */}
      <div className="grid grid-cols-5 gap-3">

        {/* LEFT — Sortable Table */}
        <div className="col-span-3 bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-50">
            <div className="text-sm font-medium text-gray-800">Company Collection Table</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Click column headers to sort · Red = below avg · Green = above avg</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className={thCls('name')} onClick={() => handleSort('name')}>#</th>
                  <th className={thCls('name')} onClick={() => handleSort('name')}>Company {sortCol === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  {arData.months.map((m, i) => (
                    <th key={m} className={thCls(i)} onClick={() => handleSort(i)}>{m} {sortCol === i ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  ))}
                  <th className={thCls('ytd')} onClick={() => handleSort('ytd')}>YTD {sortCol === 'ytd' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  <th className={thCls('avg')} onClick={() => handleSort('avg')}>Avg/Mo {sortCol === 'avg' ? (sortDir === 'asc' ? '↑' : '↓') : ''}</th>
                  <th className="text-left py-2 px-2 text-[10px] font-normal text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedCompanies.map((c, rank) => (
                  <tr key={c.name} className="hover:bg-gray-50/60">
                    <td className="py-1.5 px-2 text-gray-300 text-[10px]">{rank + 1}</td>
                    <td className="py-1.5 px-2 font-medium text-gray-800 whitespace-nowrap">{c.name}</td>
                    {c.monthly.map((v, i) => (
                      <td
                        key={i}
                        className={`py-1.5 px-2 text-right font-mono ${
                          v === 0 ? 'text-gray-300' : isHigh(c, i) ? 'text-green-700 font-medium' : isLow(c, i) ? 'text-red-600' : 'text-gray-700'
                        }`}
                      >
                        {v === 0 ? '—' : `$${(v / 1000).toFixed(1)}K`}
                      </td>
                    ))}
                    <td className="py-1.5 px-2 text-right font-mono font-medium text-gray-900">{fmt(c.ytd)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-gray-500">{fmt(c.avg)}</td>
                    <td className="py-1.5 px-2">
                      <span className={`text-[8px] px-1.5 py-0.5 rounded-full ${statusBadgeCls(c.status)}`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
                {/* TOTAL row */}
                <tr className="bg-gray-50 font-medium border-t border-gray-200">
                  <td className="py-2 px-2 text-[10px] text-gray-400" />
                  <td className="py-2 px-2 text-gray-800 text-xs">TOTAL</td>
                  {arData.totalMonthly.map((v, i) => (
                    <td key={i} className="py-2 px-2 text-right font-mono text-gray-800">${(v / 1000).toFixed(1)}K</td>
                  ))}
                  <td className="py-2 px-2 text-right font-mono text-gray-900 font-semibold">{fmt(portfolioTotal)}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-600">{fmt(Math.round(portfolioAvgMonthly))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT — Two stacked cards */}
        <div className="col-span-2 flex flex-col gap-3">

          {/* Card 1 — Monthly Portfolio Trend */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex-1">
            <div className="text-sm font-medium text-gray-800 mb-0.5">Monthly Portfolio Trend</div>
            <div className="text-[10px] text-gray-400 mb-3">Total collected Jan–Jun 2026</div>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={barData} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#999' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '0.5px solid #e5e7eb' }}
                  formatter={(v: number) => [fmt(v), 'Total']}
                />
                <ReferenceLine y={avgLine} stroke="#94a3b8" strokeDasharray="3 2" />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 8, fill: '#666', formatter: (v: number) => fmt(v) }}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.total >= avgLine ? '#22c55e' : '#fbbf24'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Card 2 — Collection Share */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex-1">
            <div className="text-sm font-medium text-gray-800 mb-0.5">Collection Share by Company</div>
            <div className="text-[10px] text-gray-400 mb-3">% of YTD portfolio total</div>
            <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '160px' }}>
              {[...arData.companies]
                .filter(c => c.ytd > 0)
                .sort((a, b) => b.ytd - a.ytd)
                .map((c, i) => {
                  const pct = portfolioTotal > 0 ? (c.ytd / portfolioTotal) * 100 : 0;
                  const barCol = i < 3 ? 'bg-green-500' : i < 6 ? 'bg-blue-500' : 'bg-amber-400';
                  return (
                    <div key={c.name} className="flex items-center gap-2">
                      <div className="text-[10px] text-gray-600 w-14 truncate shrink-0">{c.name}</div>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${barCol} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="text-[10px] text-gray-500 w-8 text-right shrink-0">{pct.toFixed(1)}%</div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {/* 4 — COMPANY MICRO-CARDS GRID */}
      <div className="grid grid-cols-5 gap-2">
        {arData.companies.map(c => {
          const maxV = Math.max(...c.monthly, 1);
          return (
            <div key={c.name} className={`bg-white rounded-xl p-3 border ${borderByCls(c.status)}`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="text-xs font-medium text-gray-800">{c.name}</div>
                  <div className="text-[9px] text-gray-400 truncate">{c.suite}</div>
                </div>
                <span className={`text-[8px] px-1.5 py-0.5 rounded-full shrink-0 ml-1 ${statusBadgeCls(c.status)}`}>{c.status}</span>
              </div>
              <div className="flex gap-3 mb-2">
                <div>
                  <div className="text-sm font-mono font-medium text-gray-900">{fmt(c.ytd)}</div>
                  <div className="text-[9px] text-gray-400">YTD Total</div>
                </div>
                <div>
                  <div className="text-sm font-mono text-gray-600">{fmt(c.avg)}</div>
                  <div className="text-[9px] text-gray-400">Avg/Mo</div>
                </div>
              </div>
              {/* Mini sparkline bars */}
              <div className="flex items-end gap-0.5 h-8">
                {c.monthly.map((v, i) => {
                  const h = maxV > 0 ? (v / maxV) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm"
                      style={{ height: `${Math.max(h, v > 0 ? 8 : 0)}%`, background: v < c.avg ? '#fab219' : '#2a78d6' }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                {['J', 'F', 'M', 'A', 'M', 'J'].map(m => (
                  <span key={m} className="text-[8px] text-gray-300 flex-1 text-center">{m}</span>
                ))}
              </div>
              {c.issues.length > 0 && (
                <div className="mt-2 text-[8px] text-amber-700 bg-amber-50 rounded p-1.5 leading-relaxed">
                  ⚠ {c.issues[0]}
                </div>
              )}
              {c.zeroUnits.length > 0 && (
                <div className="mt-1 text-[8px] text-red-700 bg-red-50 rounded p-1.5">
                  🔴 Zero-pay: {c.zeroUnits.join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 5 — AR ALERT BANNER */}
      <div className="bg-red-50 border border-red-200 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
          <span className="text-xs font-medium text-red-800">AR Action Required — 3 Critical, 3 Watch</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { level: 'critical', co: 'BNC LLC', msg: '5 zero-pay units (B,C · K · Q · R) showing $0 all 6 months. Monthly loss ~$3,200. Investigate vacancy vs non-collection.' },
            { level: 'critical', co: 'ABC LLC', msg: 'Jun collection dropped 28% — $4,025 vs $5,575 Jan–May. $1,550 shortfall. Unit A or EFG unpaid. Follow up before Jul billing.' },
            { level: 'critical', co: 'DEC LLC', msg: 'Apr spike $16,819 (+48% vs Mar). Likely deposit/back-rent included. Needs ledger classification to avoid distorted trend.' },
            { level: 'watch', co: 'KLI LLC', msg: 'Consistent 12.3% decline Jan→Jun ($11,975 → $10,500). Review lease renewals and unit vacancies.' },
            { level: 'watch', co: 'NHJ LLC', msg: 'Mar partial payment $5,280 vs $6,000+ all other months. Unit A,B,C,G paid $1,950 vs usual $2,700.' },
            { level: 'good', co: 'ZYC LLC', msg: 'Best performer — $15,150–$16,000 range with lowest variance. Use as benchmark for portfolio targets.' },
          ].map((a, i) => (
            <div
              key={i}
              className={`text-[9px] leading-relaxed rounded-lg p-2 ${
                a.level === 'critical' ? 'bg-red-100 text-red-800' : a.level === 'watch' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'
              }`}
            >
              <span className="font-medium">{a.level === 'critical' ? '🔴' : a.level === 'watch' ? '🟡' : '✅'} {a.co}</span>
              <br />
              {a.msg}
            </div>
          ))}
        </div>
      </div>

      {/* 6 — UPLOAD SECTION */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Upload className="w-4 h-4 text-gray-400" />
          <div className="text-sm font-medium text-gray-700">Update AR Data</div>
        </div>
        <div className="text-xs text-gray-400 mb-3">
          Upload new Rent_Receivable_Sheet.xlsx — all company sheets parsed automatically
        </div>
        <button
          className="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Excel File
        </button>
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileUpload} />
      </div>
    </div>
  );
}
