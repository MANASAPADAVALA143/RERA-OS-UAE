import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ── Static data ───────────────────────────────────────────────────────────────
const tiles = [
  {
    label: 'Total Rent Billed\n(YTD)',
    value: '$104,747',
    sub: 'Jan–Jun 2026 · All suites',
    valueColor: 'text-blue-600',
    subColor: 'text-gray-400',
    accent: 'bg-blue-500',
  },
  {
    label: 'Collected\n(Estimated)',
    value: '$92,180',
    sub: '↑ 88.0% collection rate',
    valueColor: 'text-green-600',
    subColor: 'text-green-500',
    accent: 'bg-green-500',
  },
  {
    label: 'Outstanding AR',
    value: '$12,567',
    sub: '↑ From 4 units — action needed',
    valueColor: 'text-red-500',
    subColor: 'text-red-400',
    accent: 'bg-red-500',
  },
  {
    label: 'Vacancy Loss',
    value: '$8,250',
    sub: 'Unit A (S123), Unit N,O (S789)',
    valueColor: 'text-amber-600',
    subColor: 'text-amber-500',
    accent: 'bg-amber-400',
  },
  {
    label: 'Monthly Run Rate',
    value: '$24,480',
    sub: 'Jun 2026 · All suites',
    valueColor: 'text-green-600',
    subColor: 'text-gray-400',
    accent: 'bg-green-500',
  },
  {
    label: 'Security Deposits\nHeld',
    value: '$6,900',
    sub: 'Unit 402 (S456) — 2 months',
    valueColor: 'text-amber-600',
    subColor: 'text-amber-500',
    accent: 'bg-amber-400',
  },
];

const suites = [
  { name: 'Suite 123', sub: 'Units A B C D EFG · 6 units', amount: '$5,575/mo', pct: 98, color: 'bg-green-500', badgeBg: 'bg-green-100', badgeText: 'text-green-700' },
  { name: 'Suite 456', sub: 'Units 401 402 · 2 units',     amount: '$6,158/mo', pct: 78, color: 'bg-amber-400', badgeBg: 'bg-amber-100', badgeText: 'text-amber-700' },
  { name: 'Suite 789', sub: 'Units A–W · 15 units',        amount: '$15,665/mo', pct: 94, color: 'bg-green-500', badgeBg: 'bg-green-100', badgeText: 'text-green-700' },
  { name: 'Town Houses', sub: 'Multi-LLC · 12 units',      amount: '$34,158/mo', pct: 81, color: 'bg-red-500',   badgeBg: 'bg-red-100',   badgeText: 'text-red-700' },
];

const agingRows = [
  { unit: 'Unit A',   suite: 'S123',  amt: '$850',   age: 'Jun',     status: 'Vacant',  statusBg: 'bg-red-100',   statusText: 'text-red-600'   },
  { unit: 'Unit 402', suite: 'S456',  amt: '$2,000', age: '31d',     status: 'Sec Dep', statusBg: 'bg-amber-100', statusText: 'text-amber-700' },
  { unit: 'Unit I',   suite: 'S789',  amt: '$400',   age: 'Partial', status: 'Partial', statusBg: 'bg-amber-100', statusText: 'text-amber-700' },
  { unit: 'PPP LLC',  suite: 'Town',  amt: '$3,100', age: '60d+',    status: 'Overdue', statusBg: 'bg-red-100',   statusText: 'text-red-600'   },
  { unit: 'LPO LLC',  suite: 'Town',  amt: '$3,500', age: '60d+',    status: 'Overdue', statusBg: 'bg-red-100',   statusText: 'text-red-600'   },
];

const barValues = [24480, 27530, 25338, 27398, 0, 0];
const barData = [
  { month: 'Jan', value: 24480 },
  { month: 'Feb', value: 27530 },
  { month: 'Mar', value: 25338 },
  { month: 'Apr', value: 27398 },
  { month: 'May', value: 0 },
  { month: 'Jun', value: 0 },
];

const kpiList = [
  'Collection rate %', 'Outstanding AR $',
  'Vacancy loss $',    'Aging buckets',
  'Suite-level trend', 'Security deposits',
  'Partial payments',  'LLC-level tracking',
  'Monthly run rate',  'Overdue alerts',
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function RentalArDashboard() {
  return (
    <div className="p-6 bg-gray-50 min-h-screen">

      {/* Page title */}
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">AR Dashboard</h1>
        <p className="text-sm text-gray-500">Accounts receivable — rent collection tracking</p>
      </div>

      {/* ROW 1 — 6 KPI Tiles */}
      <div className="grid grid-cols-6 gap-3 mb-4">
        {tiles.map((t, i) => (
          <div key={i} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-[3px] rounded-t-xl ${t.accent}`} />
            <div className="text-xs text-gray-500 font-medium leading-tight mb-2 whitespace-pre-line">{t.label}</div>
            <div className={`text-2xl font-mono font-medium ${t.valueColor}`}>{t.value}</div>
            <div className={`text-xs mt-1 ${t.subColor}`}>{t.sub}</div>
          </div>
        ))}
      </div>

      {/* ROW 2 — 3-column main row */}
      <div className="grid grid-cols-3 gap-4">

        {/* LEFT — Suite-level Collection Summary */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-1">Suite-level collection summary</div>
          <div className="text-xs text-gray-400 mb-4">Monthly rent billed vs collected</div>

          {suites.map(suite => (
            <div key={suite.name} className="mb-4 last:mb-0">
              <div className="flex justify-between items-start mb-1.5">
                <div>
                  <div className="text-sm font-medium text-gray-800">{suite.name}</div>
                  <div className="text-xs text-gray-400">{suite.sub}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-medium text-green-600">{suite.amount}</div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${suite.badgeBg} ${suite.badgeText}`}>
                    {suite.pct}% collected
                  </span>
                </div>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full ${suite.color} rounded-full transition-all`} style={{ width: `${suite.pct}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* CENTER — Aging Analysis */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-1">Aging analysis</div>
          <div className="text-xs text-gray-400 mb-3">Outstanding AR by days overdue</div>

          {/* Segmented color bar */}
          <div className="flex h-2.5 rounded-full overflow-hidden mb-2 gap-0.5">
            <div className="bg-green-500 rounded-l-full" style={{ width: '52%' }} />
            <div className="bg-amber-400" style={{ width: '22%' }} />
            <div className="bg-orange-500" style={{ width: '16%' }} />
            <div className="bg-red-500 rounded-r-full" style={{ width: '10%' }} />
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-4">
            {[
              { color: 'bg-green-500',  label: 'Current 52%' },
              { color: 'bg-amber-400',  label: '1–30d 22%'   },
              { color: 'bg-orange-500', label: '31–60d 16%'  },
              { color: 'bg-red-500',    label: '60d+ 10%'    },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-sm ${l.color}`} />
                <span className="text-[10px] text-gray-500">{l.label}</span>
              </div>
            ))}
          </div>

          {/* Aging table */}
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-gray-400 font-normal">Unit</th>
                <th className="text-left pb-2 text-gray-400 font-normal">Suite</th>
                <th className="text-left pb-2 text-gray-400 font-normal">Amount</th>
                <th className="text-left pb-2 text-gray-400 font-normal">Age</th>
                <th className="text-left pb-2 text-gray-400 font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {agingRows.map(row => (
                <tr key={row.unit} className="hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-700">{row.unit}</td>
                  <td className="py-2 text-gray-400">{row.suite}</td>
                  <td className={`py-2 font-mono font-medium ${row.statusBg === 'bg-red-100' ? 'text-red-500' : 'text-amber-600'}`}>{row.amt}</td>
                  <td className={`py-2 ${row.statusBg === 'bg-red-100' ? 'text-red-500' : 'text-amber-600'}`}>{row.age}</td>
                  <td className="py-2">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${row.statusBg} ${row.statusText}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* RIGHT — Monthly Trend + KPI List */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-1">Monthly collection trend</div>
          <div className="text-xs text-gray-400 mb-3">Jan → Jun 2026 · All suites</div>

          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={barData} margin={{ top: 15, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(v: number) => v > 0 ? `$${(v / 1000).toFixed(1)}K` : '—'}
                contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '0.5px solid #e5e7eb' }}
              />
              <Bar dataKey="value" radius={[3, 3, 0, 0]} minPointSize={4}>
                {barValues.map((v, i) => (
                  <Cell key={i} fill={v === 0 ? '#fbbf24' : '#3b82f6'} fillOpacity={v === 0 ? 0.5 : 0.9} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Warning */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4 mt-2">
            <div className="text-[10px] font-medium text-amber-800 mb-1">May &amp; Jun partially recorded</div>
            <div className="text-[9px] text-amber-700 leading-relaxed">
              Town Houses data shows $0 for May–Jun — entries may still be pending. Suite 789 May = $15,665 confirmed.
            </div>
          </div>

          {/* KPI checklist */}
          <div className="text-xs font-medium text-gray-700 mb-2">KPIs this data covers</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {kpiList.map(kpi => (
              <div key={kpi} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                <div className="w-3 h-3 rounded-sm bg-green-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-2 h-2 text-green-600" fill="none" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 4l2 2 4-4" />
                  </svg>
                </div>
                {kpi}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
