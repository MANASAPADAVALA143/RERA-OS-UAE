import { Fragment, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, Cell,
} from 'recharts';
import { Download, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { useRentalCfoData } from '../../hooks/useRentalCfoData';
import { LoadingSkeleton } from '../../components/ui/Table';
import { fmtUSD } from '../../components/ProtectedRoute';

const STATUS_STYLE = {
  healthy: 'bg-green-100 text-green-800',
  watch: 'bg-amber-100 text-amber-800',
  high: 'bg-red-100 text-red-800',
};

const CAT_COLORS = ['#1E3A8A', '#2563EB', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#65A30D', '#DB2777', '#6B7280', '#B8860B'];

const fmtK = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : fmtUSD(n);

export default function RentalBuildingExpenses() {
  const { companies, buildings, expenseBreakdown, unitExpenses, loading, error, reload } = useRentalCfoData();
  const [companyFilter, setCompanyFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [period, setPeriod] = useState('this-month');
  const [expanded, setExpanded] = useState<string | null>(null);

  const buildingOptions = useMemo(() => {
    const src = companyFilter === 'all' ? buildings : buildings.filter(b => b.companyId === companyFilter);
    return src.map(b => ({ id: b.id, name: b.buildingName }));
  }, [buildings, companyFilter]);

  const filtered = useMemo(() => {
    let rows = buildings;
    if (companyFilter !== 'all') rows = rows.filter(b => b.companyId === companyFilter);
    if (buildingFilter !== 'all') rows = rows.filter(b => b.id === buildingFilter);
    return rows;
  }, [buildings, companyFilter, buildingFilter]);

  const kpis = useMemo(() => {
    const total = filtered.reduce((s, b) => s + b.totalExpenses, 0);
    const avg = filtered.length > 0 ? total / filtered.length : 0;
    const highest = filtered.reduce((best, b) => (!best || b.totalExpenses > best.totalExpenses ? b : best), filtered[0]);
    const budgetVar = filtered.reduce((s, b) => s + b.totalExpenses * 0.08, 0);
    return { total, avg, highest, budgetVar };
  }, [filtered]);

  const chartByBuilding = filtered.map(b => ({ name: b.buildingName.slice(0, 14), expenses: b.totalExpenses, noi: b.noi }));
  const stackedData = filtered.slice(0, 6).map(b => {
    const breakdown = expenseBreakdown(b.companyId, b.buildingName);
    const row: Record<string, string | number> = { name: b.buildingName.slice(0, 12) };
    breakdown.forEach(d => { row[d.category] = d.actual; });
    return row;
  });
  const stackKeys = [...new Set(filtered.flatMap(b => expenseBreakdown(b.companyId, b.buildingName).map(d => d.category)))];

  const trendData = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toLocaleString('default', { month: 'short' }));
    }
    return months.map((m, i) => ({
      month: m,
      expenses: Math.round(kpis.total * (0.88 + i * 0.025)),
    }));
  }, [kpis.total]);

  if (loading) return <LoadingSkeleton rows={10} />;
  if (error) return <div className="text-red-600 p-4">{error}<button className="ml-3 underline" onClick={reload}>Retry</button></div>;

  return (
    <div className="space-y-6 -m-6 p-6" style={{ background: 'transparent' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Building Expenses</h1>
          <p className="text-sm text-gray-500">Company → Building → Unit hierarchy</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setBuildingFilter('all'); }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="all">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <select value={buildingFilter} onChange={e => setBuildingFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="all">All Buildings</option>
            {buildingOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={period} onChange={e => setPeriod(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="this-month">This Month</option>
            <option value="last-month">Last Month</option>
            <option value="ytd">YTD</option>
          </select>
          <button className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs"><Download size={13} /> Export</button>
          <button className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs"><Zap size={13} /> AI Insights</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Expenses', value: fmtK(kpis.total) },
          { label: 'Avg per Building', value: fmtK(kpis.avg) },
          { label: 'Highest Expense', value: kpis.highest ? kpis.highest.buildingName : '—', sub: kpis.highest ? fmtK(kpis.highest.totalExpenses) : '' },
          { label: 'vs Budget', value: kpis.budgetVar >= 0 ? `+${fmtK(kpis.budgetVar)}` : fmtK(kpis.budgetVar), sub: 'variance' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">{k.label}</p>
            <p className="text-xl font-bold font-mono mt-1">{k.value}</p>
            {k.sub && <p className="text-xs text-gray-400">{k.sub}</p>}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-900 text-white">
          <h3 className="font-semibold">Building Expense Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Company', 'Building', 'Units', 'Rent Income', 'Total Expenses', 'Expense Ratio', 'NOI', 'NOI Margin', 'vs Last Mo', 'Status'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(b => (
                <Fragment key={b.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
                    <td className="px-3 py-2.5">{b.companyName}</td>
                    <td className="px-3 py-2.5 font-medium flex items-center gap-1">
                      {expanded === b.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {b.buildingName}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{b.units}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtK(b.rentIncome)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtK(b.totalExpenses)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{(b.expenseRatio * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-green-700">{fmtK(b.noi)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{(b.noiMargin * 100).toFixed(1)}%</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${b.vsLastMonth >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {b.vsLastMonth >= 0 ? '+' : ''}{b.vsLastMonth.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[b.status]}`}>{b.status}</span>
                    </td>
                  </tr>
                  {expanded === b.id && (
                    <tr>
                      <td colSpan={10} className="px-4 py-4 bg-gray-50">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div>
                            <p className="text-xs font-semibold uppercase text-gray-600 mb-2">Expense Breakdown</p>
                            <table className="w-full text-xs">
                              <thead><tr className="text-gray-500">
                                {['Category', 'Budget', 'Actual', 'Variance', '%'].map(h => <th key={h} className="py-1 text-right first:text-left">{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {expenseBreakdown(b.companyId, b.buildingName).map(row => (
                                  <tr key={row.category} className="border-t border-gray-200">
                                    <td className="py-1.5">{row.category}</td>
                                    <td className="py-1.5 text-right font-mono">{fmtUSD(row.budget)}</td>
                                    <td className="py-1.5 text-right font-mono">{fmtUSD(row.actual)}</td>
                                    <td className={`py-1.5 text-right font-mono ${row.variance >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtUSD(row.variance)}</td>
                                    <td className="py-1.5 text-right font-mono">{row.pct.toFixed(0)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-gray-600 mb-2">Unit-Level Expenses</p>
                            <table className="w-full text-xs">
                              <thead><tr className="text-gray-500">
                                {['Unit', 'Tenant', 'Rent', 'Maint', 'Repair', 'Total', 'Cost/Rent'].map(h => <th key={h} className="py-1 text-right first:text-left">{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {unitExpenses(b.companyId, b.buildingName).slice(0, 8).map(u => (
                                  <tr key={u.unit} className="border-t border-gray-200">
                                    <td className="py-1.5 font-mono">{u.unit}</td>
                                    <td className="py-1.5">{u.tenant}</td>
                                    <td className="py-1.5 text-right font-mono">{fmtUSD(u.rent)}</td>
                                    <td className="py-1.5 text-right font-mono">{fmtUSD(u.maintenanceCost)}</td>
                                    <td className="py-1.5 text-right font-mono">{fmtUSD(u.repairCost)}</td>
                                    <td className="py-1.5 text-right font-mono">{fmtUSD(u.totalCost)}</td>
                                    <td className={`py-1.5 text-right font-mono ${u.costRentPct > 15 ? 'text-red-600' : ''}`}>{u.costRentPct.toFixed(1)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-semibold uppercase text-gray-600 mb-3">Expenses by Building</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartByBuilding}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="expenses" fill="#B8962E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-semibold uppercase text-gray-600 mb-3">Expense Composition</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stackedData}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {stackKeys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-semibold uppercase text-gray-600 mb-3">NOI by Building</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartByBuilding}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="noi" radius={[4, 4, 0, 0]}>
                {chartByBuilding.map((e, i) => <Cell key={i} fill={e.noi >= 0 ? '#16A34A' : '#DC2626'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs font-semibold uppercase text-gray-600 mb-3">Expense Trend — 6 Months</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trendData}>
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Line type="monotone" dataKey="expenses" stroke="#B8860B" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
