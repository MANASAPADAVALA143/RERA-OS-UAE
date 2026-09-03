import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line,
} from 'recharts';
import { useConsultancy, consultancyMoney as money } from '../../contexts/ConsultancyContext';

export default function CN03PL() {
  const { years } = useConsultancy();

  const rows: { label: string; get: (y: typeof years[number]) => number; bold?: boolean; neg?: boolean }[] = [
    { label: 'Revenue', get: y => y.revenue, bold: true },
    { label: 'Payroll & benefits', get: y => -y.payroll, neg: true },
    { label: 'Other operating expenses', get: y => -y.otherOpex, neg: true },
    { label: 'Other income', get: y => y.otherIncome },
    { label: 'Net income', get: y => y.netIncome, bold: true },
  ];

  const chart = years.map(y => ({
    year: `${y.year}`,
    Revenue: y.revenue,
    Payroll: y.payroll,
    Opex: y.otherOpex,
    'Net Income': y.netIncome,
  }));

  const marginChart = years.map(y => ({
    year: `${y.year}`,
    'Net margin %': +((y.netIncome / y.revenue) * 100).toFixed(1),
    'Payroll ratio %': +((y.payroll / y.revenue) * 100).toFixed(1),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Profit & Loss</h2>
        <p className="text-sm text-gray-500 mt-0.5">Three-year trend — 2023 to 2025 (USD)</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Line item</th>
                {years.map(y => <th key={y.year} className="px-4 py-3 text-right">{y.year}</th>)}
                <th className="px-4 py-3 text-right">'23→'25</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const first = r.get(years[0]);
                const last = r.get(years[years.length - 1]);
                const delta = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0;
                return (
                  <tr key={r.label} className={r.bold ? 'font-semibold bg-gray-50/50' : ''}>
                    <td className="px-4 py-2.5 text-gray-700">{r.label}</td>
                    {years.map(y => {
                      const v = r.get(y);
                      return (
                        <td key={y.year} className={`px-4 py-2.5 text-right font-mono ${r.neg ? 'text-red-600' : 'text-gray-800'}`}>
                          {v < 0 ? `(${money(-v)})` : money(v)}
                        </td>
                      );
                    })}
                    <td className={`px-4 py-2.5 text-right ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Revenue, Cost & Net Income</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chart} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Revenue" fill="#6366F1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Payroll" fill="#F97316" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Opex" fill="#C7D2FE" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Net Income" fill="#16A34A" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Margin Trend</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={marginChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Net margin %" stroke="#16A34A" strokeWidth={2} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="Payroll ratio %" stroke="#F97316" strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
