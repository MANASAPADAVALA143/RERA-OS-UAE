import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useConsultancy, consultancyMoney as money } from '../../contexts/ConsultancyContext';

const PIE_COLORS = ['#6366F1', '#2563EB', '#7C3AED', '#0891B2', '#16A34A'];

export default function CN01Dashboard() {
  const {
    years, current, serviceLines, monthly, clients, engagements,
    headcount, revenuePerHead, netMarginPct, totalAR,
  } = useConsultancy();

  const prior = years[years.length - 2];
  const revGrowth = ((current.revenue - prior.revenue) / prior.revenue) * 100;
  const niGrowth = ((current.netIncome - prior.netIncome) / prior.netIncome) * 100;

  const kpis = [
    { label: 'Revenue 2025',  value: money(current.revenue),   sub: `${revGrowth.toFixed(1)}% YoY`, up: true,  good: true },
    { label: 'Net Income',    value: money(current.netIncome),  sub: `${niGrowth.toFixed(1)}% YoY`,  up: true,  good: true },
    { label: 'Net Margin',    value: `${netMarginPct}%`,        sub: 'of revenue',                   up: true,  good: netMarginPct >= 10 },
    { label: 'Payroll',       value: money(current.payroll),    sub: `${((current.payroll / current.revenue) * 100).toFixed(0)}% of rev`, up: false, good: false },
    { label: 'Headcount',     value: `${headcount}`,            sub: 'consultants',                  up: true,  good: true },
    { label: 'Revenue / Head',value: money(revenuePerHead),     sub: 'productivity',                 up: true,  good: true },
    { label: 'Total AR',      value: money(totalAR),            sub: `${clients.length} clients`,    up: false, good: false },
    { label: 'Active Clients',value: `${clients.filter(c => c.status === 'Active').length}`, sub: 'of ' + clients.length, up: true, good: true },
  ];

  const yearChart = years.map(y => ({
    year: `${y.year}`,
    Revenue: y.revenue,
    'Net Income': y.netIncome,
  }));

  const monthChart = monthly.map(m => ({ month: m.month.replace(' 25', ''), revenue: m.revenue, cost: m.cost }));

  const pieData = serviceLines.map((s, i) => ({ name: s.name, value: s.revenue, color: PIE_COLORS[i % PIE_COLORS.length] }));

  const topClients = [...clients].sort((a, b) => b.annualFee - a.annualFee).slice(0, 6);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Consultancy — Command Center</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Advisory · Tax · Audit practice — FY2025 · {headcount} consultants · {clients.length} clients
        </p>
      </div>

      {/* KPI pills */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        {kpis.map(({ label, value, sub, up, good }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-3 text-center hover:border-indigo-300 transition-colors">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1 truncate">{label}</p>
            <p className="text-base font-bold text-gray-900 truncate">{value}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              {up ? <ArrowUp size={10} className={good ? 'text-green-500' : 'text-red-500'} />
                  : <ArrowDown size={10} className={good ? 'text-red-500' : 'text-green-500'} />}
              <p className="text-xs text-gray-400 truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Monthly Billings — 2025</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthChart} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Bar dataKey="revenue" name="Billings" fill="#6366F1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="cost" name="Delivery cost" fill="#C7D2FE" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Revenue vs Net Income — 3-Year</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={yearChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Revenue" stroke="#6366F1" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Net Income" stroke="#16A34A" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Revenue by Service Line</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="45%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={2}>
                {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Engagement Realization</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={engagements.map(e => ({
              name: e.client.split(' ')[0],
              realization: +((e.budgetHours / Math.max(1, e.actualHours)) * 100).toFixed(0),
            }))} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[0, 130]} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="realization" name="Realization %" radius={[3, 3, 0, 0]}>
                {engagements.map((e, i) => {
                  const r = (e.budgetHours / Math.max(1, e.actualHours)) * 100;
                  return <Cell key={i} fill={r >= 100 ? '#16A34A' : r >= 90 ? '#D97706' : '#DC2626'} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top clients table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Top Clients by Annual Fee</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Client', 'Industry', 'Service Line', 'Annual Fee', 'YTD Billed', 'Open AR', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topClients.map(c => {
                const ar = c.arCurrent + c.ar30 + c.ar60 + c.ar90;
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{c.industry}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{c.serviceLine}</td>
                    <td className="px-4 py-3 text-right font-semibold">{money(c.annualFee)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{money(c.ytdBilled)}</td>
                    <td className="px-4 py-3 text-right text-indigo-700">{money(ar)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === 'Active' ? 'bg-green-100 text-green-700'
                        : c.status === 'On Hold' ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
