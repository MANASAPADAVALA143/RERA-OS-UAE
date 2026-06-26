import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

// ── Static data ───────────────────────────────────────────────────────────────
const KPI_TILES = [
  { label: 'Total Rent Billed YTD',    value: '$492,063', sub: 'Jan–Jun 2026 · All 10 companies',  valueColor: 'text-blue-600',  subColor: 'text-gray-400',   accent: 'bg-blue-500'  },
  { label: 'Collected (Est.)',          value: '$468,660', sub: '↑ 95.2% collection rate',          valueColor: 'text-green-600', subColor: 'text-green-500',  accent: 'bg-green-500' },
  { label: 'Outstanding AR',           value: '$23,403',  sub: '↑ 5 companies with gaps',          valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
  { label: 'Collection Rate',          value: '95.2%',    sub: 'Target ≥ 95% · Borderline',        valueColor: 'text-amber-600', subColor: 'text-amber-500',  accent: 'bg-amber-400' },
  { label: 'Zero-Pay Units',           value: '5 Units',  sub: 'BNC LLC · B,C · K · Q · R',       valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
  { label: 'Security Deposits Held',   value: '$6,900',   sub: 'Unit 402 S456 · 2 months',         valueColor: 'text-amber-600', subColor: 'text-amber-500',  accent: 'bg-amber-400' },
  { label: 'Avg Days Outstanding',     value: '38 days',  sub: 'PPP LLC 60d+ · LPO LLC 60d+',     valueColor: 'text-red-500',   subColor: 'text-red-400',    accent: 'bg-red-500'   },
  { label: 'Best Performer',           value: 'ZYC LLC',  sub: '$94,675 YTD · Lowest variance',   valueColor: 'text-green-600', subColor: 'text-green-500',  accent: 'bg-green-500' },
];

const TREND_DATA = [
  { month: 'Jan', billed: 83055, collected: 79102 },
  { month: 'Feb', billed: 84140, collected: 80853 },
  { month: 'Mar', billed: 80693, collected: 77465 },
  { month: 'Apr', billed: 83432, collected: 82190 },
  { month: 'May', billed: 80004, collected: 74804 },
  { month: 'Jun', billed: 80739, collected: 75246 },
];

const AGING_DATA = [
  { bucket: 'Current', amount: 12167 },
  { bucket: '1–30d',   amount: 5148  },
  { bucket: '31–60d',  amount: 3742  },
  { bucket: '60d+',    amount: 2346  },
];
const AGING_FILL = ['#22c55e', '#f59e0b', '#f97316', '#ef4444'];

const OUTSTANDING_DATA = [
  { company: 'BNC LLC', ar: 8250 },
  { company: 'ABC LLC', ar: 5550 },
  { company: 'DEC LLC', ar: 4690 },
  { company: 'KLI LLC', ar: 3150 },
  { company: 'XYZ LLC', ar: 1350 },
  { company: 'ACD LLC', ar: 413  },
];

const COLLECTION_RATE = [
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

const WATERFALL_DATA = [
  { name: 'Rent Billed',    value: 80739  },
  { name: 'Vacancy Loss',   value: -8250  },
  { name: 'Zero-Pay Units', value: -3200  },
  { name: 'Partial Pmts',   value: -1750  },
  { name: 'Collected',      value: 67539  },
  { name: 'Outstanding',    value: -13200 },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function RentalArDashboard() {
  const [activeFilter, setActiveFilter] = useState('All');

  const filteredExceptions = activeFilter === 'All'
    ? EXCEPTIONS
    : EXCEPTIONS.filter(r => r.status === activeFilter || (activeFilter === 'Zero-Pay' && r.status === 'Zero-Pay'));

  return (
    <div className="p-5 bg-gray-50 min-h-screen space-y-4">

      {/* 1 — FILTER BAR */}
      <div className="flex items-center gap-3 bg-white rounded-xl p-3 border border-gray-100 shadow-sm">
        <span className="text-xs text-gray-500 font-medium">Filter:</span>
        <select className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700">
          <option>All Months</option>
          {['Jan 2026','Feb 2026','Mar 2026','Apr 2026','May 2026','Jun 2026'].map(m => <option key={m}>{m}</option>)}
        </select>
        <select className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700">
          <option>All Companies</option>
          {['ABC LLC','BNC LLC','DEC LLC','XYZ LLC','ZYC LLC','ACD LLC','NHJ LLC','FJH LLC','KLI LLC','TOWN Houses'].map(c => <option key={c}>{c}</option>)}
        </select>
        <select className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700">
          <option>All Units</option>
          <option>Paying</option>
          <option>Zero-Pay</option>
          <option>Partial</option>
          <option>Overdue</option>
        </select>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-400">Jan–Jun 2026 · 10 Companies · 9 sheets parsed</span>
          <button className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">Upload New Data</button>
        </div>
      </div>

      {/* 2 — 8 KPI TILES */}
      <div className="grid grid-cols-8 gap-2">
        {KPI_TILES.map((t, i) => (
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
          <div className="text-xs text-gray-400 mb-3">Portfolio total · Jan–Jun 2026</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={TREND_DATA} margin={{ top: 10, right: 10, bottom: 0, left: 0 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
              <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={v => `$${Math.round((v as number) / 1000)}K`} axisLine={false} tickLine={false} width={38} />
              <Tooltip
                contentStyle={{ fontSize: '11px', borderRadius: '8px', border: '0.5px solid #e5e7eb' }}
                formatter={(v: number, n: string) => [`$${v.toLocaleString()}`, n === 'billed' ? 'Billed' : 'Collected']}
              />
              <Bar dataKey="billed"    name="billed"    fill="#3b82f6" opacity={0.6} radius={[3, 3, 0, 0]} />
              <Bar dataKey="collected" name="collected" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block opacity-60" />Billed
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" />Collected
            </span>
          </div>
        </div>

        {/* Aging Stacked Bar */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">AR aging by bucket</div>
          <div className="text-xs text-gray-400 mb-3">Outstanding balance distribution</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={AGING_DATA} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 45 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f5f5f5" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={v => `$${Math.round((v as number) / 1000)}K`} axisLine={false} tickLine={false} />
              <YAxis dataKey="bucket" type="category" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: '11px', borderRadius: '8px' }}
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Outstanding']}
              />
              <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                {AGING_DATA.map((_, i) => <Cell key={i} fill={AGING_FILL[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-4 gap-1 mt-3">
            {[
              { label: 'Current', pct: '52%', color: 'bg-green-500'  },
              { label: '1–30d',   pct: '22%', color: 'bg-amber-400'  },
              { label: '31–60d',  pct: '16%', color: 'bg-orange-500' },
              { label: '60d+',    pct: '10%', color: 'bg-red-500'    },
            ].map(a => (
              <div key={a.label} className="text-center">
                <div className={`h-1 ${a.color} rounded-full mb-1`} />
                <div className="text-[9px] text-gray-500">{a.label}</div>
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
          <div className="text-xs text-gray-400 mb-3">Sorted by balance owed</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={OUTSTANDING_DATA} layout="vertical" margin={{ top: 0, right: 60, bottom: 0, left: 65 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f5f5f5" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={v => `$${Math.round((v as number) / 1000)}K`} axisLine={false} tickLine={false} />
              <YAxis dataKey="company" type="category" tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ fontSize: '11px', borderRadius: '8px' }}
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Outstanding AR']}
              />
              <Bar dataKey="ar" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 9, fill: '#6b7280', formatter: (v: number) => `$${v.toLocaleString()}` }}>
                {OUTSTANDING_DATA.map((_, i) => (
                  <Cell key={i} fill={i < 2 ? '#ef4444' : i < 4 ? '#f59e0b' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Collection Rate by Company */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-sm font-semibold text-gray-800 mb-0.5">Collection rate by company</div>
          <div className="text-xs text-gray-400 mb-4">YTD collected vs billed</div>
          <div className="space-y-2.5">
            {COLLECTION_RATE.map(co => (
              <div key={co.name}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-700 font-medium">{co.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gray-500">${co.collected.toLocaleString()}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${co.pct >= 95 ? 'bg-green-100 text-green-700' : co.pct >= 85 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
                      {co.pct}%
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${co.pct >= 95 ? 'bg-green-500' : co.pct >= 85 ? 'bg-amber-400' : 'bg-red-500'}`}
                    style={{ width: `${co.pct}%` }}
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
            <div className="text-sm font-semibold text-gray-800">Exception matrix — units requiring action</div>
            <div className="text-xs text-gray-400 mt-0.5">All units with zero payment, partial payment, or overdue balance</div>
          </div>
          <div className="flex gap-2">
            {['All', 'Zero-Pay', 'Partial', 'Overdue', 'Declining'].map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${activeFilter === f ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
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
                  <td className={`py-2 px-3 text-right font-mono font-medium ${row.bal > 0 ? 'text-red-500' : 'text-green-600'}`}>${row.bal.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right text-gray-500">{row.months}</td>
                  <td className="py-2 px-3 text-gray-500 text-[10px]">{row.deposit}</td>
                  <td className="py-2 px-3">
                    <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full ${row.sc === 'r' ? 'bg-red-100 text-red-700' : row.sc === 'a' ? 'bg-amber-100 text-amber-700' : row.sc === 'b' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6 — WATERFALL CHART */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
        <div className="text-sm font-semibold text-gray-800 mb-0.5">Revenue waterfall — Jun 2026</div>
        <div className="text-xs text-gray-400 mb-3">Billed → Vacancy loss → Security adjustments → Collected → Outstanding</div>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={WATERFALL_DATA} margin={{ top: 15, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f5" />
            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={v => `$${Math.round(Math.abs(v as number) / 1000)}K`} axisLine={false} tickLine={false} width={38} />
            <Tooltip
              contentStyle={{ fontSize: '11px', borderRadius: '8px' }}
              formatter={(v: number) => [`${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString()}`, '']}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {WATERFALL_DATA.map((d, i) => (
                <Cell key={i} fill={d.value > 50000 ? '#3b82f6' : d.value > 0 ? '#22c55e' : d.value > -3000 ? '#f59e0b' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

    </div>
  );
}
