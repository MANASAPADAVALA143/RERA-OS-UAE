import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { AlertCircle } from 'lucide-react';
import { useConsultancy, consultancyMoney as money } from '../../contexts/ConsultancyContext';

const BUCKET_COLORS = ['#16A34A', '#D97706', '#F97316', '#DC2626'];

export default function CN05Receivables() {
  const { clients, arAging, totalAR, current } = useConsultancy();

  // DSO ≈ AR / revenue * 365
  const dso = Math.round(totalAR / current.revenue * 365);
  const overdue = arAging.slice(1).reduce((s, b) => s + b.amount, 0);
  const pct90 = arAging[3].amount / totalAR * 100;

  const byClient = [...clients]
    .map(c => ({
      name: c.name,
      current: c.arCurrent, d30: c.ar30, d60: c.ar60, d90: c.ar90,
      total: c.arCurrent + c.ar30 + c.ar60 + c.ar90,
    }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Accounts Receivable — Aging</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {money(totalAR)} outstanding across {byClient.length} clients · DSO {dso} days
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total AR', value: money(totalAR), tone: 'text-gray-900' },
          { label: 'Overdue (>Current)', value: money(overdue), tone: 'text-amber-700' },
          { label: '61–90+ Days', value: money(arAging[3].amount), tone: 'text-red-600' },
          { label: 'DSO', value: `${dso} days`, tone: dso > 60 ? 'text-red-600' : 'text-green-700' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {pct90 > 5 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border bg-red-50 border-red-200 text-red-800 text-xs">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          {pct90.toFixed(0)}% of receivables are 61–90+ days overdue — escalate collections on DAMAC Group, Nakheel PJSC and Binghatti Developers.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">AR by Aging Bucket</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={arAging} barSize={48}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Bar dataKey="amount" name="Amount" radius={[4, 4, 0, 0]}>
                {arAging.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">AR by Client (stacked)</h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={byClient.map(c => ({ ...c, name: c.name.split(' ')[0] }))} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Bar dataKey="current" stackId="a" name="Current" fill="#16A34A" />
              <Bar dataKey="d30" stackId="a" name="1–30" fill="#D97706" />
              <Bar dataKey="d60" stackId="a" name="31–60" fill="#F97316" />
              <Bar dataKey="d90" stackId="a" name="61–90+" fill="#DC2626" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Aging Detail by Client</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Client', 'Current', '1–30', '31–60', '61–90+', 'Total', 'Last Invoice'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byClient.map(c => {
                const client = clients.find(x => x.name === c.name)!;
                return (
                  <tr key={c.name} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{c.current ? money(c.current) : '—'}</td>
                    <td className="px-4 py-3 text-right text-amber-700">{c.d30 ? money(c.d30) : '—'}</td>
                    <td className="px-4 py-3 text-right text-orange-600">{c.d60 ? money(c.d60) : '—'}</td>
                    <td className="px-4 py-3 text-right text-red-600">{c.d90 ? money(c.d90) : '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">{money(c.total)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{client.lastInvoice}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold">TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{money(arAging[0].amount)}</td>
                <td className="px-4 py-3 text-right font-bold">{money(arAging[1].amount)}</td>
                <td className="px-4 py-3 text-right font-bold">{money(arAging[2].amount)}</td>
                <td className="px-4 py-3 text-right font-bold">{money(arAging[3].amount)}</td>
                <td className="px-4 py-3 text-right font-bold">{money(totalAR)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
