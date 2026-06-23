import { usePropDev } from '../../contexts/PropertyDevContext';
import CompanyComparisonPanel from '../../components/propdev/CompanyComparisonPanel';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { ArrowUp, ArrowDown, TrendingUp, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';

const money = (n: number) => n >= 1_000_000 ? `$${(n/1_000_000).toFixed(2)}M` : `$${n.toLocaleString()}`;

const STATUS_COLORS: Record<string, string> = {
  sold: '#16A34A', contracted: '#2563EB', reserved: '#D97706',
  available: '#6B7280', cancelled: '#DC2626', legal_pending: '#7C3AED',
};

export default function PD01Dashboard() {
  const { lots, properties, loans, capitalCalls, customers, companies, isConsolidated, setSelectedCompanyId } = usePropDev();
  const p = properties[0];

  const soldLots = lots.filter(l => l.status === 'sold');
  const contractedLots = lots.filter(l => l.status === 'contracted');
  const availableLots = lots.filter(l => l.status === 'available');
  const totalRevenue = soldLots.reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalLoanBalance = loans.reduce((s, l) => s + l.balance, 0);
  const overdueCalls = capitalCalls.filter(c => c.status === 'Overdue' || c.status === 'Partial');
  const overdueCapital = overdueCalls.reduce((s, c) => s + c.totalDue - c.received, 0);
  const pendingDistributions = 380000;

  const totalCost = p ? p.landCost + p.hardCost + p.softCost + p.titleCharges + p.otherCharges
    + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan : 0;
  const netProfit = p ? p.saleConsideration - totalCost - p.saleConsideration * 0.09 - p.saleConsideration * 0.045 : 0;
  const grossMargin = p && p.saleConsideration > 0
    ? ((netProfit / p.saleConsideration) * 100).toFixed(1) : '0';

  const kpis = [
    { label: 'Lots Sold', value: soldLots.length.toString(), sub: `of ${lots.length} total`, trend: 'up', good: true },
    { label: 'Lots Remaining', value: availableLots.length.toString(), sub: 'available', trend: 'down', good: false },
    { label: 'Gross Sales', value: money(totalRevenue), sub: 'realized', trend: 'up', good: true },
    { label: 'Net Margin', value: `${grossMargin}%`, sub: 'projected', trend: 'up', good: parseFloat(grossMargin) >= 35 },
    { label: 'Loan Balance', value: money(totalLoanBalance), sub: `${loans.length} loans`, trend: 'down', good: false },
    { label: 'Capital Due', value: money(overdueCapital), sub: 'overdue calls', trend: overdueCapital > 0 ? 'up' : 'flat', good: overdueCapital === 0 },
    { label: 'Cash Avail', value: money(p?.cashAvailable ?? 0), sub: 'on hand', trend: 'flat', good: true },
    { label: 'Distrib Pending', value: money(pendingDistributions), sub: 'to partners', trend: 'up', good: false },
  ];

  // Pie chart
  const statusGroups: Record<string, number> = {};
  lots.forEach(l => { statusGroups[l.status] = (statusGroups[l.status] ?? 0) + 1; });
  const pieData = Object.entries(statusGroups).map(([s, v]) => ({
    name: s.replace('_', ' '), value: v, color: STATUS_COLORS[s] ?? '#9CA3AF',
  }));

  // Monthly revenue trend
  const monthlyData = p?.monthlyData ?? [];

  // Alerts
  const alerts = [
    ...overdueCalls.map(c => ({
      level: 'critical' as const,
      msg: `Capital call overdue — ${c.partnerName}: $${(c.totalDue - c.received).toLocaleString()} outstanding`,
    })),
    ...customers.filter(c => c.installments.some(i => i.status === 'bounced')).map(c => ({
      level: 'critical' as const,
      msg: `Bounced payment — ${c.name} (Lot ${c.lotNo}): $${(c.contractValue - c.collected).toLocaleString()} pending`,
    })),
    ...loans.filter(l => l.interestRate > 8).map(l => ({
      level: 'high' as const,
      msg: `High rate loan — ${l.bank} at ${l.interestRate}% — refinancing opportunity`,
    })),
    { level: 'watch' as const, msg: 'NOC - Water expiring in <30 days for 1 property — action needed' },
    availableLots.length > 15
      ? { level: 'watch' as const, msg: `${availableLots.length} lots still available — pricing strategy review recommended` }
      : null,
  ].filter(Boolean) as { level: string; msg: string }[];

  const ALERT_STYLES = {
    critical: 'bg-red-50 border-red-200 text-red-800',
    high: 'bg-orange-50 border-orange-200 text-orange-800',
    watch: 'bg-amber-50 border-amber-200 text-amber-800',
  };
  const ALERT_ICONS = {
    critical: <AlertCircle size={14} className="shrink-0" />,
    high: <AlertCircle size={14} className="shrink-0" />,
    watch: <Clock size={14} className="shrink-0" />,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{p?.name ?? 'Portfolio'}</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {p?.address} · {lots.length} lots · {p?.totalAcres?.toFixed(1)} acres
        </p>
      </div>

      {/* 8-KPI Pills */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        {kpis.map(({ label, value, sub, trend, good }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-3 text-center hover:border-blue-300 transition-colors">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1 truncate">{label}</p>
            <p className="text-base font-bold text-gray-900 truncate">{value}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              {trend === 'up' && <ArrowUp size={10} className={good ? 'text-green-500' : 'text-red-500'} />}
              {trend === 'down' && <ArrowDown size={10} className={good ? 'text-red-500' : 'text-green-500'} />}
              <p className="text-xs text-gray-400 truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-500" /> Action Required
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
            {alerts.slice(0, 6).map((a, i) => (
              <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${ALERT_STYLES[a.level as keyof typeof ALERT_STYLES]}`}>
                {ALERT_ICONS[a.level as keyof typeof ALERT_ICONS]}
                {a.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4 Charts (2x2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Chart 1: Monthly Revenue Trend */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Monthly Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthlyData} barSize={22}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
              <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 2: Inventory Funnel / Pie */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Inventory Status</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="45%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}>
                {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v} lots`, '']} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 3: Lot Sales Velocity */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Sales Velocity (lots/month)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={monthlyData}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="lotsSold" stroke="#16A34A" strokeWidth={2} dot={{ r: 4 }} name="Lots Sold" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Chart 4: Revenue vs Cost */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Revenue vs Cost vs Profit</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              layout="vertical"
              data={[
                { name: 'Sale Revenue', value: p?.saleConsideration ?? 0 },
                { name: 'Total Cost', value: totalCost },
                { name: 'Net Profit', value: netProfit },
              ]}
              barSize={18}
            >
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1_000_000).toFixed(1)}M`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={85} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {[0, 1, 2].map(i => (
                  <Cell key={i} fill={i === 0 ? '#2563EB' : i === 1 ? '#DC2626' : '#16A34A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Lot Status Summary Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Lot Progress by Status</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Status', 'Count', '%', 'List Value', 'Sale Value', 'Notes'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Object.entries(statusGroups).map(([status, count]) => {
                const group = lots.filter(l => l.status === status);
                const listVal = group.reduce((s, l) => s + l.listPrice, 0);
                const saleVal = group.reduce((s, l) => s + (l.salePrice ?? 0), 0);
                return (
                  <tr key={status} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[status] }} />
                        <span className="capitalize">{status.replace('_', ' ')}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{count}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{((count / lots.length) * 100).toFixed(0)}%</td>
                    <td className="px-4 py-3 text-right">${listVal.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-700">{saleVal > 0 ? `$${saleVal.toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {status === 'contracted' ? `${(count / lots.length * 100).toFixed(0)}% in pipeline` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold">TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{lots.length}</td>
                <td className="px-4 py-3 text-right">100%</td>
                <td className="px-4 py-3 text-right font-bold">${lots.reduce((s,l) => s+l.listPrice,0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-bold text-green-300">${lots.reduce((s,l) => s+(l.salePrice??0),0).toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Recent closings */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100 flex items-center gap-2">
          <CheckCircle2 size={15} className="text-green-600" />
          <h3 className="font-semibold text-gray-800">Recent Closings</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {lots.filter(l => l.status === 'sold').slice(0, 6).map(l => (
            <div key={l.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50">
              <div>
                <span className="font-medium">{l.lotNo}</span>
                <span className="text-gray-400 mx-2">·</span>
                <span className="text-gray-600">{l.buyerName}</span>
                {isConsolidated && <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{l.companyId}</span>}
              </div>
              <div className="text-right">
                <p className="font-semibold text-green-700">${(l.salePrice ?? 0).toLocaleString()}</p>
                <p className="text-xs text-gray-400">{l.closeDate}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Company Comparison (consolidated only) */}
      <CompanyComparisonPanel
        title="Portfolio Company Dashboard"
        columns={[
          { label: 'Revenue', getValue: c => c.property.saleConsideration, higherIsBetter: true },
          { label: 'Lots Sold', getValue: c => c.lots.filter(l => l.status === 'sold').length, higherIsBetter: true },
          { label: 'Lots Left', getValue: c => c.lots.filter(l => l.status === 'available').length, higherIsBetter: false },
          { label: 'Cash', getValue: c => c.property.cashAvailable, higherIsBetter: true },
          { label: 'Loan Bal', getValue: c => c.loans.reduce((s, l) => s + l.balance, 0), higherIsBetter: false },
        ]}
        onCompanyClick={() => {}}
      />
    </div>
  );
}
