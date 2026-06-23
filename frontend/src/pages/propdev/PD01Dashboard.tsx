import { usePropDev } from '../../contexts/PropertyDevContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { DollarSign, Home, TrendingUp, Banknote, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

const fmt = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(2)}M`
    : `$${n.toLocaleString()}`;

const STATUS_COLORS: Record<string, string> = {
  sold: '#16A34A',
  contracted: '#2563EB',
  reserved: '#D97706',
  available: '#6B7280',
  cancelled: '#DC2626',
  legal_pending: '#7C3AED',
};

const STATUS_LABELS: Record<string, string> = {
  sold: 'Sold',
  contracted: 'Contracted',
  reserved: 'Reserved',
  available: 'Available',
  cancelled: 'Cancelled',
  legal_pending: 'Legal Pending',
};

export default function PD01Dashboard() {
  const { lots, properties, loans, capitalCalls, customers } = usePropDev();
  const prop = properties[0];

  const totalRevenue = lots
    .filter(l => l.status === 'sold')
    .reduce((s, l) => s + (l.salePrice ?? 0), 0);

  const lotsSold = lots.filter(l => l.status === 'sold').length;
  const lotsContracted = lots.filter(l => l.status === 'contracted').length;

  const totalCost = prop.landCost + prop.hardCost + prop.softCost + prop.titleCharges
    + prop.otherCharges + prop.propertyTax + prop.loanProcessing
    + prop.professionalCharges + prop.legalFees + prop.interestOnLoan;

  const managementFee = prop.saleConsideration * prop.managementFeeRate;
  const commission = prop.saleConsideration * prop.commissionRate;
  const netProfit = prop.saleConsideration - totalCost - managementFee - commission;
  const grossMargin = ((netProfit / prop.saleConsideration) * 100).toFixed(1);

  const overdueCalls = capitalCalls.filter(c => c.status === 'Overdue' || c.status === 'Partial');
  const activeLoans = loans.filter(l => l.status === 'Active');
  const totalLoanBalance = activeLoans.reduce((s, l) => s + l.balance, 0);

  const bouncedCustomers = customers.filter(c =>
    c.installments.some(i => i.status === 'bounced' || i.status === 'overdue')
  );

  // Pie chart data
  const statusGroups: Record<string, number> = {};
  lots.forEach(l => { statusGroups[l.status] = (statusGroups[l.status] ?? 0) + 1; });
  const pieData = Object.entries(statusGroups).map(([status, count]) => ({
    name: STATUS_LABELS[status] ?? status,
    value: count,
    color: STATUS_COLORS[status] ?? '#9CA3AF',
  }));

  const kpis = [
    { label: 'Revenue Booked', value: fmt(totalRevenue), sub: `${lotsSold} lots sold`, icon: DollarSign, color: 'bg-green-50 text-green-700 border-green-200' },
    { label: 'Lots Contracted', value: `${lotsContracted}`, sub: 'Awaiting close', icon: Home, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Projected Net Profit', value: fmt(netProfit), sub: `${grossMargin}% margin`, icon: TrendingUp, color: 'bg-purple-50 text-purple-700 border-purple-200' },
    { label: 'Total Loan Balance', value: fmt(totalLoanBalance), sub: `${activeLoans.length} active loans`, icon: Banknote, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ];

  const alerts = [
    ...overdueCalls.map(c => ({
      type: 'warning' as const,
      msg: `Capital call overdue — ${c.partnerName} owes $${(c.totalDue - c.received).toLocaleString()}`,
    })),
    ...bouncedCustomers.map(c => ({
      type: 'error' as const,
      msg: `Payment issue — ${c.name} (Lot ${c.lotNo}) has bounced/overdue installment`,
    })),
    { type: 'info' as const, msg: 'NOC - Water expiring Jun 30, 2025 — renew with Celina Water Dept' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{prop.name}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{prop.address} · {prop.totalLots} lots · {prop.totalAcres} acres</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, sub, icon: Icon, color }) => (
          <div key={label} className={`rounded-xl border p-4 ${color}`}>
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} />
              <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
            </div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs mt-1 opacity-75">{sub}</p>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-start gap-3 p-3 rounded-lg text-sm border ${
              a.type === 'error' ? 'bg-red-50 border-red-200 text-red-800'
              : a.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}>
              {a.type === 'error' ? <AlertCircle size={16} className="mt-0.5 shrink-0" />
               : a.type === 'warning' ? <AlertCircle size={16} className="mt-0.5 shrink-0" />
               : <Clock size={16} className="mt-0.5 shrink-0" />}
              {a.msg}
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lot Status Donut */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Lot Status Breakdown</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v} lots`, '']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Sales Bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Monthly Revenue</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={prop.monthlyData} barSize={28}>
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
              <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Lot Summary Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Lot Progress Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Status', 'Count', 'List Value', 'Sale Value', 'Remaining'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Object.entries(statusGroups).map(([status, count]) => {
                const lotsByStatus = lots.filter(l => l.status === status);
                const listVal = lotsByStatus.reduce((s, l) => s + l.listPrice, 0);
                const saleVal = lotsByStatus.reduce((s, l) => s + (l.salePrice ?? 0), 0);
                const remaining = listVal - saleVal;
                return (
                  <tr key={status} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLORS[status] }} />
                        {STATUS_LABELS[status] ?? status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{count}</td>
                    <td className="px-4 py-3 text-right">${listVal.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-700">${saleVal.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{remaining > 0 ? `$${remaining.toLocaleString()}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold">TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{lots.length}</td>
                <td className="px-4 py-3 text-right font-bold">${lots.reduce((s,l) => s + l.listPrice, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-bold text-green-300">${lots.reduce((s,l) => s + (l.salePrice ?? 0), 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-bold text-gray-300">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Recent Closings */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-600" />
          <h3 className="font-semibold text-gray-800">Recent Closings</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {lots.filter(l => l.status === 'sold').slice(0, 5).map(l => (
            <div key={l.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50">
              <div>
                <span className="font-medium text-gray-900">{l.lotNo}</span>
                <span className="text-gray-400 mx-2">·</span>
                <span className="text-gray-600">{l.buyerName}</span>
              </div>
              <div className="text-right">
                <p className="font-semibold text-green-700">${(l.salePrice ?? 0).toLocaleString()}</p>
                <p className="text-xs text-gray-400">{l.closeDate}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
