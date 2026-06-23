import { usePropDev } from '../../contexts/PropertyDevContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';

const fmt = (n: number) => n < 0 ? `($${Math.abs(Math.round(n)).toLocaleString()})` : `$${Math.round(n).toLocaleString()}`;
const fmtAbs = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString()}`;

// ── CEO Cash Today box ──────────────────────────────────────────────────────

function CashTodayBox({ cash, monthlyEmi, nextOutflow }: { cash: number; monthlyEmi: number; nextOutflow: string }) {
  const runway = monthlyEmi > 0 ? cash / monthlyEmi : 99;
  const status = runway < 1.5 ? 'critical' : runway < 3 ? 'watch' : 'safe';

  const config = {
    critical: { border: 'border-red-300',   bg: 'bg-red-50',   textMain: 'text-red-700',   icon: <AlertTriangle size={24} className="text-red-500" />,  label: '⚠️ CRITICAL'  },
    watch:    { border: 'border-amber-300', bg: 'bg-amber-50', textMain: 'text-amber-700', icon: <AlertTriangle size={24} className="text-amber-500" />, label: '⚡ WATCH'     },
    safe:     { border: 'border-green-300', bg: 'bg-green-50', textMain: 'text-green-700', icon: <CheckCircle2  size={24} className="text-green-500" />, label: '✓ SAFE'       },
  }[status];

  return (
    <div className={`rounded-2xl border-2 ${config.border} ${config.bg} p-6`}>
      <div className="flex items-center gap-3 mb-4">
        {config.icon}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Cash Available Today</p>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white border ${config.border} ${config.textMain}`}>{config.label}</span>
        </div>
      </div>
      <p className={`text-4xl font-black ${config.textMain}`}>{fmtAbs(cash)}</p>
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-500">Cash Runway</p>
          <p className={`text-xl font-bold ${config.textMain}`}>{runway.toFixed(1)} months</p>
          <p className="text-xs text-gray-400">at current EMI rate</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Next Major Outflow</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5">{nextOutflow}</p>
        </div>
      </div>
    </div>
  );
}

// ── 30/60/90-day Forward Panel ───────────────────────────────────────────────

function ForwardPanel({ label, collections, emi, calls, distributions }: {
  label: string;
  collections: number;
  emi: number;
  calls: number;
  distributions: number;
}) {
  const net = collections - emi - calls - distributions;
  const rows: [string, number, string][] = [
    ['+ Collections',      collections,   'text-green-700'],
    ['- EMI Payments',     -emi,          'text-red-600'  ],
    ['- Capital Calls',    -calls,        'text-red-600'  ],
    ['- Distributions',    -distributions,'text-amber-600'],
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-3">{label}</p>
      <div className="space-y-1.5">
        {rows.map(([lbl, val, cls]) => (
          <div key={lbl} className="flex justify-between text-sm">
            <span className="text-gray-600">{lbl}</span>
            <span className={`font-semibold ${cls}`}>{fmtAbs(val)}</span>
          </div>
        ))}
        <div className="pt-2 border-t border-gray-100 flex justify-between text-sm font-bold">
          <span>= NET</span>
          <span className={net >= 0 ? 'text-green-700' : 'text-red-600'}>{fmt(net)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD11CashFlow() {
  const { properties, lots, loans, expenses, customers, capitalCalls, partners } = usePropDev();
  const p = properties[0];

  const monthlyRevenue = p.monthlyData;
  const fixedMonthlyExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const monthlyCashFlow = monthlyRevenue.map(m => ({
    month: m.month,
    inflow: m.revenue,
    outflow: fixedMonthlyExpense,
    net: m.revenue - fixedMonthlyExpense,
  }));

  const totalRevenue = lots.filter(l => l.status === 'sold').reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalEMI = loans.reduce((s, l) => s + l.emi * 6, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0) * 6;
  const partnerContributions = partners.reduce((s, p) => s + p.capitalContributed, 0);
  const distributions = partners.reduce((s, p) => s + p.distributionsReceived, 0);

  const operatingCF = totalRevenue - totalExpenses;
  const financingCF = partnerContributions - totalEMI - distributions;
  const netCF = operatingCF + financingCF;

  const customerCollections = customers.reduce((s, c) => s + c.collected, 0);
  const monthlyEmi = loans.reduce((s, l) => s + l.emi, 0);
  const pendingCalls = capitalCalls.filter(c => c.status !== 'Paid').reduce((s, c) => s + c.totalDue - c.received, 0);

  const nextOutflow = monthlyEmi > 0
    ? `${fmt(monthlyEmi)}/month EMI (${loans.filter(l=>l.status==='Active')[0]?.emiDate ?? 15}th)`
    : 'No active loans';

  // 30/60/90-day projections — use realistic assumptions
  const mo30Collections = customerCollections * 0.15;
  const mo60Collections = customerCollections * 0.30;
  const mo90Collections = customerCollections * 0.50;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Cash Flow</h2>
        <p className="text-sm text-gray-500 mt-0.5">30/60/90-day forward view + runway indicator</p>
      </div>

      {/* CEO Cash Today */}
      <CashTodayBox cash={p.cashAvailable} monthlyEmi={monthlyEmi} nextOutflow={nextOutflow} />

      {/* 30/60/90-day Forward View */}
      <div>
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-blue-600" />
          Forward Cash Flow Projection
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ForwardPanel
            label="Next 30 Days"
            collections={mo30Collections}
            emi={monthlyEmi}
            calls={pendingCalls * 0.2}
            distributions={0}
          />
          <ForwardPanel
            label="Next 60 Days"
            collections={mo60Collections}
            emi={monthlyEmi * 2}
            calls={pendingCalls * 0.4}
            distributions={distributions * 0.1}
          />
          <ForwardPanel
            label="Next 90 Days"
            collections={mo90Collections}
            emi={monthlyEmi * 3}
            calls={pendingCalls * 0.6}
            distributions={distributions * 0.2}
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Inflows',  value: fmtAbs(totalRevenue + partnerContributions), color: 'text-green-700'                              },
          { label: 'Total Outflows', value: fmtAbs(totalExpenses + totalEMI + distributions), color: 'text-red-600'                          },
          { label: 'Net Cash Flow',  value: fmtAbs(netCF),   color: netCF >= 0 ? 'text-green-700' : 'text-red-600'                           },
          { label: 'Pending Calls',  value: fmtAbs(pendingCalls), color: pendingCalls > 0 ? 'text-amber-700' : 'text-green-600'              },
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
            <Bar dataKey="inflow"  name="Inflow"  fill="#16A34A" radius={[4,4,0,0]} barSize={24} />
            <Bar dataKey="outflow" name="Outflow" fill="#DC2626" radius={[4,4,0,0]} barSize={24} />
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
              <tr className="bg-blue-900 text-white">
                <td className="px-5 py-2.5 font-bold" colSpan={3}>A. OPERATING ACTIVITIES</td>
              </tr>
              {[
                { label: 'Lot Sale Receipts',                amount: totalRevenue,          note: `${lots.filter(l=>l.status==='sold').length} lots closed` },
                { label: 'Customer Installments Collected', amount: customerCollections,   note: 'Per installment schedule'  },
                { label: 'Operating Expenses',              amount: -totalExpenses,         note: '6 months admin + tax'      },
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

              <tr className="bg-blue-900 text-white">
                <td className="px-5 py-2.5 font-bold" colSpan={3}>B. FINANCING ACTIVITIES</td>
              </tr>
              {[
                { label: 'Partner Capital Contributions', amount: partnerContributions,        note: `${partners.length} partners`      },
                { label: 'Loan EMI Payments (6 months)', amount: -totalEMI,                   note: `${loans.filter(l=>l.status==='Active').length} active loans` },
                { label: 'Distributions to Partners',    amount: -distributions,              note: 'Already paid out'                 },
                { label: 'Capital Calls Pending',        amount: -pendingCalls,               note: 'Outstanding obligations'          },
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
                <td className="px-5 py-3 text-right font-semibold text-blue-300">{fmtAbs(p.cashAvailable)}</td>
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
            <span className="font-bold text-red-600">{fmtAbs(expenses.reduce((s,e) => s+e.amount, 0))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
