import { usePropDev } from '../../contexts/PropertyDevContext';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DC2626'];

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function PD05Partners() {
  const { partners, capitalCalls } = usePropDev();

  const totalCapital = partners.reduce((s, p) => s + p.capitalContributed, 0);
  const totalDistributed = partners.reduce((s, p) => s + p.distributionsReceived, 0);
  const undistributed = totalCapital - totalDistributed;

  const pieData = partners.map(p => ({
    name: p.name,
    value: p.sharePercent,
  }));

  const overdueByPartner = (partnerId: string) =>
    capitalCalls
      .filter(c => c.partnerId === partnerId && (c.status === 'Overdue' || c.status === 'Partial'))
      .reduce((s, c) => s + (c.totalDue - c.received), 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Partners / JV Ledger</h2>
        <p className="text-sm text-gray-500 mt-0.5">Equity structure, contributions and distributions</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: 'Partners', value: `${partners.length}` },
          { label: 'Total Capital Contributed', value: fmt(totalCapital) },
          { label: 'Total Distributions', value: fmt(totalDistributed) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Equity Pie */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Equity Split</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`${v}%`, 'Equity']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Partner Cards */}
        <div className="space-y-3">
          {partners.map((p, i) => {
            const overdue = overdueByPartner(p.id);
            return (
              <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                      style={{ background: COLORS[i % COLORS.length] }}>
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{p.name}</p>
                      <p className="text-xs text-gray-500">{p.type} · {p.sharePercent}% equity · {p.preferredReturn}% pref return</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>{p.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-400">Contributed</p>
                    <p className="font-semibold text-gray-900">{fmt(p.capitalContributed)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Distributed</p>
                    <p className="font-semibold text-green-700">{fmt(p.distributionsReceived)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Overdue Calls</p>
                    <p className={`font-semibold ${overdue > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {overdue > 0 ? fmt(overdue) : '—'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Partner Ledger Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Partner Ledger</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Partner', 'Type', 'Equity %', 'Pref Return', 'Capital Contributed', 'Distributions', 'Net Position', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {partners.map((p, i) => {
                const net = p.capitalContributed - p.distributionsReceived;
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                        <span className="font-medium">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700">{p.type}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">{p.sharePercent}%</td>
                    <td className="px-4 py-3 text-right">{p.preferredReturn}%</td>
                    <td className="px-4 py-3 text-right">{fmt(p.capitalContributed)}</td>
                    <td className="px-4 py-3 text-right text-green-700">{fmt(p.distributionsReceived)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(net)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        p.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>{p.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold" colSpan={4}>TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{fmt(totalCapital)}</td>
                <td className="px-4 py-3 text-right font-bold text-green-300">{fmt(totalDistributed)}</td>
                <td className="px-4 py-3 text-right font-bold">{fmt(totalCapital - totalDistributed)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
