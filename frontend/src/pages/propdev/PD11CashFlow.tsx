import { usePropDev } from '../../contexts/PropertyDevContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

const fmt = (n: number) => n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString()})` : `$${Math.round(n).toLocaleString()}`;
const fmtAbs = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString()}`;

export default function PD11CashFlow() {
  const { properties, lots, loans, expenses, customers } = usePropDev();
  const p = properties[0];

  // Monthly cash flow: combine monthly lot sales and fixed expenses
  const monthlyRevenue = p.monthlyData;
  const fixedMonthlyExpense = expenses.reduce((s, e) => s + e.amount, 0);

  const monthlyCashFlow = monthlyRevenue.map(m => ({
    month: m.month,
    inflow: m.revenue,
    outflow: fixedMonthlyExpense,
    net: m.revenue - fixedMonthlyExpense,
  }));

  // Cash flow statement sections
  const totalRevenue = lots.filter(l => l.status === 'sold').reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalEMI = loans.reduce((s, l) => s + l.emi * 6, 0); // 6 months
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0) * 6;
  const partnerContributions = 1181212; // sum of all partner contributions
  const distributions = 60000;

  const operatingCF = totalRevenue - totalExpenses;
  const financingCF = partnerContributions - totalEMI - distributions;
  const netCF = operatingCF + financingCF;

  const customerCollections = customers.reduce((s, c) => s + c.collected, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Cash Flow Statement</h2>
        <p className="text-sm text-gray-500 mt-0.5">Project-level cash flows — {p.name}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Inflows', value: fmtAbs(totalRevenue + partnerContributions), color: 'text-green-700' },
          { label: 'Total Outflows', value: fmtAbs(totalExpenses + totalEMI + distributions), color: 'text-red-600' },
          { label: 'Net Cash Flow', value: fmtAbs(netCF), color: netCF >= 0 ? 'text-green-700' : 'text-red-600' },
          { label: 'Cash on Hand', value: fmtAbs(p.cashAvailable), color: 'text-blue-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Monthly Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">Monthly Cash Flow (6-Month View)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyCashFlow} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(Math.abs(v)/1000).toFixed(0)}K`} />
            <Tooltip formatter={(v: number) => [`$${Math.abs(v).toLocaleString()}`, '']} />
            <Legend />
            <Bar dataKey="inflow" name="Inflow" fill="#16A34A" radius={[4, 4, 0, 0]} barSize={24} />
            <Bar dataKey="outflow" name="Outflow" fill="#DC2626" radius={[4, 4, 0, 0]} barSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cash Flow Statement */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Particulars</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Amount</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody>
              {/* Operating */}
              <tr className="bg-blue-900 text-white">
                <td className="px-5 py-2.5 font-bold" colSpan={3}>A. OPERATING ACTIVITIES</td>
              </tr>
              {[
                { label: 'Lot Sale Receipts', amount: totalRevenue, note: `${lots.filter(l=>l.status==='sold').length} lots closed` },
                { label: 'Customer Installments Collected', amount: customerCollections, note: 'Per installment schedule' },
                { label: 'Operating Expenses', amount: -totalExpenses, note: '6 months admin + tax' },
              ].map(({ label, amount, note }) => (
                <tr key={label} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 pl-10 text-gray-700">{label}</td>
                  <td className={`px-5 py-3 text-right font-medium ${amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(amount)}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">{note}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-3 font-semibold">Net Operating Cash Flow</td>
                <td className={`px-5 py-3 text-right font-bold ${operatingCF >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(operatingCF)}</td>
                <td />
              </tr>

              {/* Financing */}
              <tr className="bg-blue-900 text-white">
                <td className="px-5 py-2.5 font-bold" colSpan={3}>B. FINANCING ACTIVITIES</td>
              </tr>
              {[
                { label: 'Partner Capital Contributions', amount: partnerContributions, note: 'All partners combined' },
                { label: 'Loan EMI Payments (6 months)', amount: -totalEMI, note: `ABC BANK + FNB` },
                { label: 'Distributions to Partners', amount: -distributions, note: 'GP Holdings + Celina LP' },
              ].map(({ label, amount, note }) => (
                <tr key={label} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 pl-10 text-gray-700">{label}</td>
                  <td className={`px-5 py-3 text-right font-medium ${amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(amount)}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">{note}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-3 font-semibold">Net Financing Cash Flow</td>
                <td className={`px-5 py-3 text-right font-bold ${financingCF >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(financingCF)}</td>
                <td />
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-5 py-4 font-bold text-base">NET CASH FLOW  (A + B)</td>
                <td className={`px-5 py-4 text-right font-bold text-lg ${netCF >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(netCF)}</td>
                <td />
              </tr>
              <tr className="bg-gray-800 text-white">
                <td className="px-5 py-3 text-sm">Cash Available on Hand</td>
                <td className="px-5 py-3 text-right font-semibold text-blue-300">${p.cashAvailable.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Expense Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Recurring Expense Breakdown (Monthly)</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {expenses.map(e => (
            <div key={e.particulars} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-gray-50">
              <div>
                <span className="font-medium text-gray-900">{e.particulars}</span>
                <span className="ml-2 px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{e.category}</span>
              </div>
              <span className="font-semibold text-gray-700">${e.amount.toLocaleString()}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50">
            <span className="font-bold text-gray-900">Total Monthly Expenses</span>
            <span className="font-bold text-red-600">${expenses.reduce((s,e) => s+e.amount, 0).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
