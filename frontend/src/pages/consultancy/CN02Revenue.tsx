import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { useConsultancy, consultancyMoney as money } from '../../contexts/ConsultancyContext';

export default function CN02Revenue() {
  const { serviceLines, clients, current, nonRecurringRevenue } = useConsultancy();

  const recurring = clients.reduce((s, c) => s + c.annualFee, 0);
  const mix = [
    { name: 'Recurring client fees', value: recurring },
    { name: 'Non-recurring / project', value: nonRecurringRevenue },
  ];

  const slChart = serviceLines.map(s => ({
    name: s.name,
    revenue: s.revenue,
    margin: Math.round(s.revenue * s.marginPct / 100),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Revenue & Clients</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          FY2025 revenue {money(current.revenue)} — {money(recurring)} recurring + {money(nonRecurringRevenue)} project work
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue', value: money(current.revenue) },
          { label: 'Recurring Base', value: money(recurring) },
          { label: 'Recurring %', value: `${((recurring / current.revenue) * 100).toFixed(0)}%` },
          { label: 'Avg Client Fee', value: money(Math.round(recurring / clients.length)) },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-xl font-bold text-gray-900">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Revenue & Contribution Margin by Service Line</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={slChart} layout="vertical" margin={{ left: 40 }} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Bar dataKey="revenue" name="Revenue" fill="#6366F1" radius={[0, 3, 3, 0]} />
              <Bar dataKey="margin" name="Contribution" fill="#16A34A" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Recurring vs Project Revenue</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={mix} barSize={60}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Bar dataKey="value" name="Revenue" radius={[4, 4, 0, 0]}>
                <Cell fill="#6366F1" />
                <Cell fill="#A5B4FC" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Client Roster</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Client', 'Industry', 'Service Line', 'Annual Fee', 'YTD Billed', 'Realized %', 'Last Invoice', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...clients].sort((a, b) => b.annualFee - a.annualFee).map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.industry}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.serviceLine}</td>
                  <td className="px-4 py-3 text-right font-semibold">{money(c.annualFee)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{money(c.ytdBilled)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{((c.ytdBilled / c.annualFee) * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3 text-right text-gray-500">{c.lastInvoice}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      c.status === 'Active' ? 'bg-green-100 text-green-700'
                      : c.status === 'On Hold' ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold">TOTAL</td>
                <td /><td />
                <td className="px-4 py-3 text-right font-bold">{money(recurring)}</td>
                <td className="px-4 py-3 text-right font-bold">{money(clients.reduce((s, c) => s + c.ytdBilled, 0))}</td>
                <td /><td /><td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
