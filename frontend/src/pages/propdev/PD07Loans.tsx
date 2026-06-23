import { useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Loan } from '../../contexts/PropertyDevContext';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Landmark, Mail, Phone, Calendar, TrendingDown, AlertTriangle, CheckCircle2 } from 'lucide-react';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

function buildAmortizationSchedule(loan: Loan, months = 12) {
  const monthlyRate = loan.interestRate / 100 / 12;
  let balance = loan.balance;
  const rows = [];
  for (let i = 1; i <= months; i++) {
    const interest = balance * monthlyRate;
    const principal = loan.emi - interest;
    balance = Math.max(0, balance - principal);
    rows.push({ month: `M${i}`, interest: Math.round(interest), principal: Math.round(principal), balance: Math.round(balance) });
    if (balance === 0) break;
  }
  return rows;
}

const STATUS_COLORS: Record<Loan['status'], string> = {
  Active: 'bg-green-100 text-green-700',
  'Paid Off': 'bg-gray-100 text-gray-500',
  'In Default': 'bg-red-100 text-red-700',
};

// ── DSCR Gauge ───────────────────────────────────────────────────────────────

function DscrGauge({ dscr }: { dscr: number }) {
  const label = dscr >= 1.25 ? 'Strong' : dscr >= 1.0 ? 'Adequate' : 'Below Min';
  const color = dscr >= 1.25 ? 'text-green-700' : dscr >= 1.0 ? 'text-amber-700' : 'text-red-700';
  const barWidth = Math.min(100, (dscr / 2) * 100);
  const barColor = dscr >= 1.25 ? 'bg-green-500' : dscr >= 1.0 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide">DSCR</span>
        <span className={`text-lg font-bold ${color}`}>{dscr.toFixed(2)}x · {label}</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barWidth}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>0x</span><span>1.0x (min)</span><span>1.25x (target)</span><span>2x+</span>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        {dscr < 1.0
          ? '⚠️ Debt service NOT covered by NOI — immediate refinancing or capital injection needed.'
          : dscr < 1.25
            ? 'Marginal coverage — monitor closely and boost collections.'
            : 'Healthy coverage — loan well-serviced from operating income.'}
      </p>
    </div>
  );
}

// ── Refinancing Recommendation ───────────────────────────────────────────────

function RefinancingRecommendation({ loans }: { loans: Loan[] }) {
  const MARKET_RATE = 6.5;
  const highRateLoans = loans.filter(l => l.interestRate > MARKET_RATE && l.status === 'Active');

  const monthlySavings = useMemo(() => {
    return highRateLoans.reduce((s, l) => {
      const currentMonthlyInterest = (l.balance * l.interestRate) / 100 / 12;
      const newMonthlyInterest = (l.balance * MARKET_RATE) / 100 / 12;
      return s + (currentMonthlyInterest - newMonthlyInterest);
    }, 0);
  }, [highRateLoans]);

  if (highRateLoans.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
        <CheckCircle2 size={16} className="shrink-0" />
        No refinancing needed — all active loans are at or below market rate ({MARKET_RATE}%).
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <TrendingDown size={20} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-amber-800">Refinancing Opportunity Identified</h4>
          <p className="text-sm text-amber-700 mt-1">
            {highRateLoans.length} loan{highRateLoans.length > 1 ? 's' : ''} above market rate ({MARKET_RATE}%):
            {' '}{highRateLoans.map(l => `${l.bank} @ ${l.interestRate}%`).join(', ')}.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-amber-600 mb-0.5">Current Avg Rate</p>
              <p className="font-bold text-amber-800">
                {(highRateLoans.reduce((s,l)=>s+l.interestRate,0)/highRateLoans.length).toFixed(2)}%
              </p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-amber-600 mb-0.5">Market Rate</p>
              <p className="font-bold text-green-700">{MARKET_RATE}%</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-amber-600 mb-0.5">Est. Monthly Saving</p>
              <p className="font-bold text-green-700">{fmt(monthlySavings)}</p>
            </div>
          </div>
          <p className="text-xs text-amber-600 mt-2">
            Annual savings potential: <strong>{fmt(monthlySavings * 12)}</strong>. Initiate refinancing conversations now — allow 60–90 days for processing.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── EMI Tracker (This Month) ─────────────────────────────────────────────────

function EmiTracker({ loans }: { loans: Loan[] }) {
  const today = new Date();
  const dayOfMonth = today.getDate();

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800">EMI Tracker — This Month</h3>
        <p className="text-xs text-gray-400 mt-0.5">Today is the {dayOfMonth}{dayOfMonth === 1 ? 'st' : dayOfMonth === 2 ? 'nd' : dayOfMonth === 3 ? 'rd' : 'th'}</p>
      </div>
      <div className="divide-y divide-gray-100">
        {loans.filter(l => l.status === 'Active').map(loan => {
          const isPaid = dayOfMonth > loan.emiDate + 2;
          const isDue = dayOfMonth >= loan.emiDate && !isPaid;
          const isUpcoming = dayOfMonth < loan.emiDate;
          return (
            <div key={loan.id} className={`flex items-center justify-between px-4 py-3 ${isDue ? 'bg-amber-50' : ''}`}>
              <div>
                <p className="text-sm font-medium text-gray-900">{loan.bank}</p>
                <p className="text-xs text-gray-400">Due on {loan.emiDate}{loan.emiDate === 1 ? 'st' : 'th'} · A/c {loan.accountNo.slice(-4)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-gray-900">{fmt(loan.emi)}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  isPaid ? 'bg-green-100 text-green-700' :
                  isDue ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {isPaid ? 'Paid' : isDue ? 'Due Now' : `Due on ${loan.emiDate}th`}
                </span>
              </div>
            </div>
          );
        })}
        <div className="flex justify-between px-4 py-3 bg-gray-50">
          <span className="font-bold text-gray-900 text-sm">Total Monthly EMI</span>
          <span className="font-bold text-red-600">{fmt(loans.filter(l=>l.status==='Active').reduce((s,l)=>s+l.emi,0))}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD07Loans() {
  const { loans, properties, customers } = usePropDev();
  const p = properties[0];

  const totalBalance = loans.reduce((s, l) => s + l.balance, 0);
  const totalEMI = loans.reduce((s, l) => s + l.emi, 0);
  const totalSanctioned = loans.reduce((s, l) => s + l.amount, 0);

  // DSCR = NOI / Annual Debt Service
  const monthlyCollections = customers.reduce((s, c) => s + c.collected, 0) / 6;
  const annualDebtService = totalEMI * 12;
  const noi = (monthlyCollections - (p ? p.cashAvailable * 0.01 : 0)) * 12;
  const portfolioDscr = annualDebtService > 0 ? noi / annualDebtService : 99;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Loan Tracker</h2>
        <p className="text-sm text-gray-500 mt-0.5">DSCR analysis, refinancing opportunities and amortization</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Loans',       value: `${loans.filter(l=>l.status==='Active').length}`,  sub: `of ${loans.length} total`           },
          { label: 'Total Sanctioned',   value: fmt(totalSanctioned),                               sub: 'original loan amount'               },
          { label: 'Total Outstanding',  value: fmt(totalBalance),                                  sub: fmt(totalSanctioned - totalBalance) + ' repaid' },
          { label: 'Monthly EMI Burden', value: fmt(totalEMI),                                      sub: fmt(totalEMI * 12) + '/year'          },
        ].map(({ label, value, sub }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Portfolio DSCR */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-3">Portfolio DSCR</h3>
        <DscrGauge dscr={Math.max(0.1, portfolioDscr)} />
      </div>

      {/* Refinancing Recommendation */}
      <RefinancingRecommendation loans={loans} />

      {/* EMI Tracker */}
      <EmiTracker loans={loans} />

      {/* Per-Loan Cards */}
      {loans.map(loan => {
        const schedule = buildAmortizationSchedule(loan, 12);
        const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
        const ltv = loan.amount > 0 ? ((loan.balance / loan.amount) * 100).toFixed(1) : '—';
        const loanNoi = monthlyCollections * 12 / Math.max(1, loans.length);
        const loanDscr = (loan.emi * 12) > 0 ? loanNoi / (loan.emi * 12) : 99;

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
                  { label: 'Loan Amount',   value: fmt(loan.amount)         },
                  { label: 'Outstanding',   value: fmt(loan.balance)        },
                  { label: 'Rate',          value: `${loan.interestRate}% p.a.` },
                  { label: 'Monthly EMI',   value: fmt(loan.emi)            },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-blue-300 uppercase">{label}</p>
                    <p className="font-bold text-white">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Loan Details */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700 text-sm">Loan Details</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Company',     loan.company     ],
                    ['Loan Date',   loan.loanDate    ],
                    ['Maturity',    loan.maturityDate ],
                    ['EMI Date',    `${loan.emiDate}${loan.emiDate===1?'st':'th'}`],
                    ['LTV',         `${ltv}%`        ],
                    ['Repaid',      fmt(loan.amount - loan.balance)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-gray-400">{k}</p>
                      <p className="font-medium text-gray-900">{v}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-1.5 text-sm">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lender Contact</p>
                  <div className="flex items-center gap-2 text-gray-600"><Landmark size={12}/>{loan.lenderName}</div>
                  <div className="flex items-center gap-2 text-blue-600"><Mail size={12}/>{loan.lenderEmail}</div>
                  <div className="flex items-center gap-2 text-gray-600"><Phone size={12}/>{loan.lenderPhone}</div>
                  <div className="flex items-center gap-2 text-gray-600"><Calendar size={12}/>EMI due {loan.emiDate}{loan.emiDate===1?'st':'th'}</div>
                </div>
              </div>

              {/* DSCR */}
              <div>
                <h4 className="font-semibold text-gray-700 text-sm mb-3">Loan DSCR</h4>
                <DscrGauge dscr={Math.max(0.1, loanDscr)} />
                {loan.interestRate > 6.5 && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    <AlertTriangle size={12} className="inline mr-1" />
                    Rate {loan.interestRate}% above market 6.5% — est. saving {fmt((loan.balance * (loan.interestRate - 6.5) / 100) / 12)}/month if refinanced.
                  </div>
                )}
              </div>

              {/* Amortization Chart */}
              <div>
                <h4 className="font-semibold text-gray-700 text-sm mb-3">12-Month Balance Trend</h4>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={schedule}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                    <Line type="monotone" dataKey="balance" stroke="#2563EB" strokeWidth={2} dot={false} name="Balance" />
                    <Line type="monotone" dataKey="interest" stroke="#DC2626" strokeWidth={1.5} dot={false} name="Interest" />
                  </LineChart>
                </ResponsiveContainer>
                <p className="text-xs text-gray-400 mt-1">Est. 12-month interest: {fmt(totalInterest)}</p>
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
