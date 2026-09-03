import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { useConsultancy, consultancyMoney as money } from '../../contexts/ConsultancyContext';

const COLORS = ['#6366F1', '#2563EB', '#7C3AED', '#0891B2'];

export default function CN04Payroll() {
  const { team, current, headcount, years } = useConsultancy();

  const cost = (g: typeof team[number]) => g.headcount * g.avgSalary;
  const totalCost = team.reduce((s, g) => s + cost(g), 0);

  const pie = team.map((g, i) => ({ name: g.grade, value: cost(g), color: COLORS[i % COLORS.length] }));

  const payrollTrend = years.map(y => ({
    year: `${y.year}`,
    Payroll: y.payroll,
    Revenue: y.revenue,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Payroll & Team</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {headcount} consultants · {money(current.payroll)} annual payroll · {((current.payroll / current.revenue) * 100).toFixed(0)}% of revenue
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Payroll', value: money(totalCost) },
          { label: 'Headcount', value: `${headcount}` },
          { label: 'Avg Cost / Head', value: money(Math.round(totalCost / headcount)) },
          { label: 'Blended Utilization', value: `${Math.round(team.reduce((s, g) => s + g.utilizationPct * g.headcount, 0) / headcount)}%` },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{k.label}</p>
            <p className="text-xl font-bold text-gray-900">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Payroll Cost by Grade</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pie} dataKey="value" cx="45%" cy="50%" innerRadius={45} outerRadius={72} paddingAngle={2}>
                {pie.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-800 text-sm mb-3">Payroll vs Revenue — 3-Year</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={payrollTrend} barSize={22}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1_000_000).toFixed(1)}M`} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Revenue" fill="#6366F1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Payroll" fill="#F97316" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Team by Grade</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Grade', 'Headcount', 'Avg Salary', 'Total Cost', 'Utilization', 'Bill Rate', 'Cost %'].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {team.map(g => (
                <tr key={g.grade} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{g.grade}</td>
                  <td className="px-4 py-3 text-right">{g.headcount}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{money(g.avgSalary)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{money(cost(g))}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{g.utilizationPct}%</td>
                  <td className="px-4 py-3 text-right text-gray-700">${g.billRate}/hr</td>
                  <td className="px-4 py-3 text-right text-gray-500">{((cost(g) / totalCost) * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold">TOTAL</td>
                <td className="px-4 py-3 text-right font-bold">{headcount}</td>
                <td />
                <td className="px-4 py-3 text-right font-bold">{money(totalCost)}</td>
                <td /><td /><td className="px-4 py-3 text-right">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
