import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Loan } from '../../contexts/PropertyDevContext';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Landmark, Mail, Phone, Calendar } from 'lucide-react';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

function buildAmortizationSchedule(loan: Loan, months = 12) {
  const monthlyRate = loan.interestRate / 100 / 12;
  let balance = loan.balance;
  const rows = [];
  for (let i = 1; i <= months; i++) {
    const interest = balance * monthlyRate;
    const principal = loan.emi - interest;
    balance = Math.max(0, balance - principal);
    rows.push({
      month: `M${i}`,
      interest: Math.round(interest),
      principal: Math.round(principal),
      balance: Math.round(balance),
    });
    if (balance === 0) break;
  }
  return rows;
}

const STATUS_COLORS: Record<Loan['status'], string> = {
  Active: 'bg-green-100 text-green-700',
  'Paid Off': 'bg-gray-100 text-gray-500',
  'In Default': 'bg-red-100 text-red-700',
};

export default function PD07Loans() {
  const { loans } = usePropDev();

  const totalBalance = loans.reduce((s, l) => s + l.balance, 0);
  const totalEMI = loans.reduce((s, l) => s + l.emi, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Loan Tracker</h2>
        <p className="text-sm text-gray-500 mt-0.5">Construction and acquisition loans with amortization</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Loans', value: `${loans.filter(l => l.status === 'Active').length}` },
          { label: 'Total Sanctioned', value: fmt(loans.reduce((s,l) => s + l.amount, 0)) },
          { label: 'Total Outstanding', value: fmt(totalBalance) },
          { label: 'Monthly EMI', value: fmt(totalEMI) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {loans.map(loan => {
        const schedule = buildAmortizationSchedule(loan, 12);
        const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
        const ltv = loan.amount > 0 ? ((loan.balance / loan.amount) * 100).toFixed(1) : '—';

        return (
          <div key={loan.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Loan Header */}
            <div className="bg-blue-900 text-white p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Landmark size={20} className="text-blue-300" />
                  <div>
                    <h3 className="font-bold text-lg">{loan.bank}</h3>
                    <p className="text-sm text-blue-200">{loan.property} · A/c: {loan.accountNo}</p>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[loan.status]}`}>
                  {loan.status}
                </span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                {[
                  { label: 'Loan Amount', value: fmt(loan.amount) },
                  { label: 'Outstanding', value: fmt(loan.balance) },
                  { label: 'Rate', value: `${loan.interestRate}% p.a.` },
                  { label: 'Monthly EMI', value: fmt(loan.emi) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-blue-300 uppercase">{label}</p>
                    <p className="font-bold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Loan Details */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700 text-sm">Loan Details</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Company', loan.company],
                    ['Loan Date', loan.loanDate],
                    ['Maturity Date', loan.maturityDate],
                    ['EMI Date', `${loan.emiDate}${loan.emiDate === 1 ? 'st' : 'th'} of month`],
                    ['LTV', `${ltv}%`],
                    ['Loan Repaid', fmt(loan.amount - loan.balance)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-gray-400">{k}</p>
                      <p className="font-medium text-gray-900">{v}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 p-3 bg-gray-50 rounded-lg space-y-2 text-sm">
                  <h5 className="font-semibold text-gray-700 text-xs uppercase tracking-wide">Lender Contact</h5>
                  <div className="flex items-center gap-2 text-gray-600"><Landmark size={13} />{loan.lenderName}</div>
                  <div className="flex items-center gap-2 text-blue-600"><Mail size={13} />{loan.lenderEmail}</div>
                  <div className="flex items-center gap-2 text-gray-600"><Phone size={13} />{loan.lenderPhone}</div>
                  <div className="flex items-center gap-2 text-gray-600"><Calendar size={13} />
                    EMI due: {loan.emiDate}{loan.emiDate === 1 ? 'st' : 'th'} each month
                  </div>
                </div>
              </div>

              {/* Amortization Chart */}
              <div>
                <h4 className="font-semibold text-gray-700 text-sm mb-3">12-Month Balance Trend</h4>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={schedule}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                    <Line type="monotone" dataKey="balance" stroke="#2563EB" strokeWidth={2} dot={false} name="Balance" />
                    <Line type="monotone" dataKey="interest" stroke="#DC2626" strokeWidth={1.5} dot={false} name="Interest" />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-2">
                  Est. 12-month interest: {fmt(totalInterest)}
                </p>
              </div>
            </div>

            {/* Mini Amortization Table */}
            <div className="border-t border-gray-100">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-400 uppercase">
                    <tr>
                      {['Month', 'EMI', 'Principal', 'Interest', 'Balance'].map(h => (
                        <th key={h} className="px-4 py-2 text-right first:text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {schedule.slice(0, 6).map(row => (
                      <tr key={row.month} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{row.month}</td>
                        <td className="px-4 py-2 text-right">{fmt(loan.emi)}</td>
                        <td className="px-4 py-2 text-right text-blue-600">{fmt(row.principal)}</td>
                        <td className="px-4 py-2 text-right text-red-500">{fmt(row.interest)}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{fmt(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
