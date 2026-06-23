import { useMemo, useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Loan, CompanyData } from '../../contexts/PropertyDevContext';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
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

const DSCR_BADGE_STYLE = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  grey: 'bg-gray-100 text-gray-600',
} as const;

function loanDscrBadge(dscr: number): keyof typeof DSCR_BADGE_STYLE {
  if (dscr >= 1.25) return 'green';
  if (dscr >= 1.0) return 'amber';
  return 'red';
}

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

// ── Loan Register ─────────────────────────────────────────────────────────────

function LoanRegister({ loans, monthlyCollections }: { loans: Loan[]; monthlyCollections: number }) {
  const loanCount = Math.max(1, loans.length);
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-900 text-white"><h3 className="font-semibold">Loan Register</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              {['Company', 'Building', 'Bank', 'Loan Amount', 'Rate', 'EMI', 'Outstanding', 'Maturity', 'EMI Day', 'DSCR', 'Status'].map(h => (
                <th key={h} className="px-3 py-2.5 text-right first:text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loans.map(loan => {
              const loanDscr = (loan.emi * 12) > 0 ? (monthlyCollections * 12 / loanCount) / (loan.emi * 12) : 99;
              const st = loanDscrBadge(loanDscr);
              return (
                <tr key={loan.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5">{loan.company}</td>
                  <td className="px-3 py-2.5">{loan.property}</td>
                  <td className="px-3 py-2.5">{loan.bank}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(loan.amount)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{loan.interestRate.toFixed(2)}%</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(loan.emi)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(loan.balance)}</td>
                  <td className="px-3 py-2.5 text-right text-xs">{loan.maturityDate}</td>
                  <td className="px-3 py-2.5 text-right">{loan.emiDate}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{loanDscr > 50 ? '∞' : `${loanDscr.toFixed(2)}x`}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${DSCR_BADGE_STYLE[st]}`}>{st}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loans.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No loans found</p>}
      </div>
    </div>
  );
}

// ── Section 1: Company-wise Loan KPI Cards ────────────────────────────────────

function CompanyLoanCards({ companies, marketRate }: { companies: CompanyData[]; marketRate: number }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-gray-900">Loan Position — By Company</h3>
        <p className="text-sm text-gray-500 mt-0.5">Click any card to expand loan details</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {companies.map(company => {
          const activeLoans = company.loans.filter(l => l.status === 'Active');
          if (activeLoans.length === 0) return null;
          const totalBalance = activeLoans.reduce((s, l) => s + l.balance, 0);
          const totalEMI    = activeLoans.reduce((s, l) => s + l.emi, 0);
          const weightedRate = totalBalance > 0
            ? activeLoans.reduce((s, l) => s + l.interestRate * l.balance, 0) / totalBalance : 0;
          const nextEmiDate      = Math.min(...activeLoans.map(l => l.emiDate));
          const earliestMaturity = [...activeLoans].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))[0]?.maturityDate;
          const monthlyCollections = company.customers.reduce((s, c) => s + c.collected, 0) / 6;
          const dscr = totalEMI * 12 > 0 ? (monthlyCollections * 12) / (totalEMI * 12) : 99;
          const isAboveMarket  = weightedRate > marketRate;
          const isLowDscr      = dscr < 1.0;
          const now = new Date();
          const matDate = earliestMaturity ? new Date(earliestMaturity) : null;
          const daysToMaturity = matDate ? Math.round((matDate.getTime() - now.getTime()) / 86400000) : null;
          const isMaturingSoon = daysToMaturity !== null && daysToMaturity < 90 && daysToMaturity > 0;
          const borderColor = isLowDscr ? 'border-red-400'
            : (isAboveMarket || isMaturingSoon) ? 'border-amber-400' : 'border-green-400';
          const isExpanded = expandedId === company.id;
          const annualSaving = isAboveMarket ? Math.round(totalBalance * (weightedRate - marketRate) / 100) : 0;

          return (
            <div key={company.id} className={`bg-white rounded-xl border-2 ${borderColor} overflow-hidden`}>
              <button
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : company.id)}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-gray-900 text-sm leading-tight">{company.name}</p>
                  <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs mb-3">
                  {[
                    ['Loans',       `${activeLoans.length} active`],
                    ['Outstanding', fmt(totalBalance)],
                    ['Avg Rate',    `${weightedRate.toFixed(2)}%`],
                    ['Monthly EMI', fmt(totalEMI)],
                    ['Next EMI',    `${nextEmiDate}th`],
                    ['Matures',     earliestMaturity ?? '—'],
                  ].map(([k, v]) => (
                    <div key={k}><span className="text-gray-400">{k}: </span><span className="font-medium text-gray-700">{v}</span></div>
                  ))}
                </div>
                <div className="flex items-center justify-between py-2 border-t border-gray-100">
                  <span className="text-xs text-gray-400">DSCR</span>
                  <span className={`text-sm font-bold ${dscr >= 1.25 ? 'text-green-700' : dscr >= 1.0 ? 'text-amber-700' : 'text-red-700'}`}>
                    {dscr > 50 ? '∞' : dscr.toFixed(2)}x {dscr >= 1.25 ? '✅' : dscr >= 1.0 ? '⚠️' : '🔴'}
                  </span>
                </div>
                <div className="space-y-1 mt-1">
                  {isLowDscr      && <p className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">🔴 DSCR below 1.0 — debt not covered by income</p>}
                  {isAboveMarket  && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">🟠 Rate {weightedRate.toFixed(1)}% &gt; market {marketRate}% — saves {fmt(annualSaving)}/yr</p>}
                  {isMaturingSoon && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">🟡 Loan matures in {daysToMaturity} days — begin refinancing</p>}
                  {!isLowDscr && !isAboveMarket && !isMaturingSoon && <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">🟢 All metrics healthy</p>}
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-gray-200 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-400 uppercase">
                      <tr>{['Bank','Amount','Rate','EMI','Balance','Next EMI','End Date','Status'].map(h => (
                        <th key={h} className="px-3 py-2 text-right first:text-left whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {company.loans.map(l => (
                        <tr key={l.id} className={`hover:bg-gray-50 ${l.interestRate > marketRate ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-3 py-2 font-medium">{l.bank}</td>
                          <td className="px-3 py-2 text-right">{fmt(l.amount)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${l.interestRate > marketRate ? 'text-amber-700' : 'text-gray-700'}`}>{l.interestRate}%</td>
                          <td className="px-3 py-2 text-right">{fmt(l.emi)}</td>
                          <td className="px-3 py-2 text-right">{fmt(l.balance)}</td>
                          <td className="px-3 py-2 text-right">{l.emiDate}th</td>
                          <td className="px-3 py-2 text-right">{l.maturityDate}</td>
                          <td className="px-3 py-2 text-right"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[l.status]}`}>{l.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 2: Daily EMI Calendar ─────────────────────────────────────────────

function EmiCalendar({ companies }: { companies: CompanyData[] }) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const todayDay = today.getDate();

  const emiByDay: Record<number, { company: string; bank: string; accountNo: string; amount: number }[]> = {};
  companies.forEach(c =>
    c.loans.filter(l => l.status === 'Active').forEach(l => {
      const d = l.emiDate;
      if (!emiByDay[d]) emiByDay[d] = [];
      emiByDay[d].push({ company: l.company, bank: l.bank, accountNo: l.accountNo, amount: l.emi });
    })
  );

  const allActive = companies.flatMap(c => c.loans.filter(l => l.status === 'Active'));
  const totalMonthlyEMI = allActive.reduce((s, l) => s + l.emi, 0);
  const thisWeekDays = Array.from({ length: 7 }, (_, i) => todayDay - today.getDay() + i).filter(d => d >= 1 && d <= daysInMonth);
  const thisWeekEMI = thisWeekDays.reduce((s, d) => s + (emiByDay[d] ?? []).reduce((ss, e) => ss + e.amount, 0), 0);
  const todayEMI = (emiByDay[todayDay] ?? []).reduce((s, e) => s + e.amount, 0);

  const calendarCells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);

  const bankMap: Record<string, { bank: string; companies: string[]; monthlyEMI: number; outstanding: number; rates: number[] }> = {};
  companies.forEach(c => c.loans.filter(l => l.status === 'Active').forEach(l => {
    if (!bankMap[l.bank]) bankMap[l.bank] = { bank: l.bank, companies: [], monthlyEMI: 0, outstanding: 0, rates: [] };
    bankMap[l.bank].monthlyEMI  += l.emi;
    bankMap[l.bank].outstanding += l.balance;
    bankMap[l.bank].rates.push(l.interestRate);
    if (!bankMap[l.bank].companies.includes(l.company)) bankMap[l.bank].companies.push(l.company);
  }));
  const bankRows = Object.values(bankMap).sort((a, b) => b.outstanding - a.outstanding);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900">Daily EMI Calendar — All Companies</h3>
        <p className="text-sm text-gray-500 mt-0.5">Bank-wise EMI deductions across portfolio</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Today's EMI deductions", value: fmt(todayEMI) },
          { label: 'This week total',         value: fmt(thisWeekEMI) },
          { label: 'This month total',        value: fmt(totalMonthlyEMI) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className="text-xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 bg-blue-900 text-white">
          <h4 className="font-semibold">{monthName}</h4>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((day, idx) => {
              if (day === null) return <div key={`e${idx}`} />;
              const hasEmi  = !!emiByDay[day];
              const isToday = day === todayDay;
              const isPast  = day < todayDay;
              const dayAmt  = (emiByDay[day] ?? []).reduce((s, e) => s + e.amount, 0);
              return (
                <button
                  key={day}
                  onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                  className={`relative rounded-lg p-1 text-center min-h-[52px] flex flex-col items-center justify-start transition-colors
                    ${isToday ? 'bg-blue-600 text-white' : hasEmi ? 'bg-blue-50 hover:bg-blue-100 cursor-pointer' : 'hover:bg-gray-50'}
                    ${selectedDay === day ? 'ring-2 ring-blue-500' : ''}`}
                >
                  <span className={`text-xs font-medium ${isToday ? 'text-white' : isPast && !hasEmi ? 'text-gray-300' : 'text-gray-700'}`}>{day}</span>
                  {hasEmi && (
                    <>
                      <div className="flex gap-0.5 mt-0.5">
                        {Array.from({ length: Math.min(emiByDay[day].length, 3) }).map((_, i) => (
                          <div key={i} className={`w-1.5 h-1.5 rounded-full ${isToday ? 'bg-white' : 'bg-blue-500'}`} />
                        ))}
                      </div>
                      <span className={`text-[9px] mt-0.5 leading-tight ${isToday ? 'text-blue-100' : 'text-blue-600'}`}>
                        {fmt(dayAmt)}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {selectedDay !== null && (emiByDay[selectedDay] ?? []).length > 0 && (
            <div className="mt-4 border border-blue-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-blue-900 text-white text-sm font-medium">
                EMI Due — {selectedDay}{[,'st','nd','rd'][selectedDay] ?? 'th'} {monthName}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
                  <tr>{['Company','Bank','Account','Amount','Status'].map(h => (
                    <th key={h} className="px-3 py-2 text-right first:text-left">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(emiByDay[selectedDay] ?? []).map((item, i) => {
                    const status = selectedDay < todayDay ? '✅ Paid' : selectedDay === todayDay ? '⏳ Due Today' : '📅 Upcoming';
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{item.company}</td>
                        <td className="px-3 py-2 text-gray-600">{item.bank}</td>
                        <td className="px-3 py-2 text-gray-400 text-xs">{item.accountNo}</td>
                        <td className="px-3 py-2 text-right font-bold">{fmt(item.amount)}</td>
                        <td className="px-3 py-2 text-right">{status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h4 className="font-semibold text-gray-800">Bank-Wise EMI Summary</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
              <tr>{['Bank','Companies','Monthly EMI','Outstanding','Avg Rate','Status'].map(h => (
                <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bankRows.map(row => {
                const avgRate = row.rates.reduce((s, r) => s + r, 0) / row.rates.length;
                return (
                  <tr key={row.bank} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.bank}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[140px] truncate">{row.companies.join(', ')}</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(row.monthlyEMI)}</td>
                    <td className="px-4 py-3 text-right">{fmt(row.outstanding)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${avgRate > 6.5 ? 'text-amber-700' : 'text-green-700'}`}>{avgRate.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${avgRate > 6.5 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {avgRate > 6.5 ? 'Above Market' : 'Optimal'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-4 py-3 font-bold">TOTAL</td>
                <td className="px-4 py-3 text-xs text-gray-400">{bankRows.length} banks</td>
                <td className="px-4 py-3 text-right font-bold">{fmt(bankRows.reduce((s,r) => s+r.monthlyEMI, 0))}</td>
                <td className="px-4 py-3 text-right font-bold">{fmt(bankRows.reduce((s,r) => s+r.outstanding, 0))}</td>
                <td className="px-4 py-3 text-right font-bold">
                  {(bankRows.reduce((s,r) => s + r.rates.reduce((ss,rr)=>ss+rr,0), 0) /
                    Math.max(1, bankRows.reduce((s,r) => s+r.rates.length, 0))).toFixed(2)}%
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Section 3: Bank Rate Intelligence ─────────────────────────────────────────

function BankRateIntelligence({ companies }: { companies: CompanyData[] }) {
  const [marketRate, setMarketRate] = useState(6.5);
  const [calc, setCalc] = useState({ balance: '', currentRate: '', targetRate: '6.5' });

  const allLoans = companies.flatMap(c => c.loans.filter(l => l.status === 'Active'));

  const bankMap: Record<string, { bank: string; loans: Loan[]; totalDebt: number; monthlyEMI: number; weightedRate: number }> = {};
  allLoans.forEach(l => {
    if (!bankMap[l.bank]) bankMap[l.bank] = { bank: l.bank, loans: [], totalDebt: 0, monthlyEMI: 0, weightedRate: 0 };
    bankMap[l.bank].loans.push(l);
    bankMap[l.bank].totalDebt  += l.balance;
    bankMap[l.bank].monthlyEMI += l.emi;
  });
  Object.values(bankMap).forEach(row => {
    row.weightedRate = row.totalDebt > 0
      ? row.loans.reduce((s,l) => s + l.interestRate * l.balance, 0) / row.totalDebt : 0;
  });
  const bankRows = Object.values(bankMap).sort((a,b) => b.totalDebt - a.totalDebt);

  const highRateLoans = allLoans.filter(l => l.interestRate > marketRate);
  const monthlySavingTotal = highRateLoans.reduce((s,l) => s + l.balance*(l.interestRate-marketRate)/100/12, 0);
  const totalOutstanding = allLoans.reduce((s,l) => s+l.balance, 0);
  const weightedAvgRate = totalOutstanding > 0
    ? allLoans.reduce((s,l) => s+l.interestRate*l.balance, 0) / totalOutstanding : 0;
  const bestRateBank = bankRows.length > 0 ? bankRows.reduce((b,r) => r.weightedRate < b.weightedRate ? r : b, bankRows[0]) : null;
  const refLoans = [...highRateLoans]
    .sort((a,b) => b.balance*(b.interestRate-marketRate) - a.balance*(a.interestRate-marketRate))
    .slice(0, 5);

  const calcBal  = parseFloat(calc.balance)      || 0;
  const calcCurR = parseFloat(calc.currentRate)  || 0;
  const calcTgtR = parseFloat(calc.targetRate)   || marketRate;
  const emiFormula = (bal: number, rate: number) =>
    bal > 0 && rate > 0 ? (bal*(rate/100/12)) / (1 - Math.pow(1+rate/100/12, -240)) : 0;
  const calcCurEMI  = emiFormula(calcBal, calcCurR);
  const calcNewEMI  = emiFormula(calcBal, calcTgtR);
  const calcSaving  = Math.max(0, calcCurEMI - calcNewEMI);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">🏦 Bank Rate Intelligence</h3>
          <p className="text-sm text-gray-500 mt-0.5">Strategic insights on refinancing opportunities</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Market Rate Benchmark:</label>
          <input type="number" step="0.1" value={marketRate}
            onChange={e => setMarketRate(parseFloat(e.target.value)||6.5)}
            className="w-16 border rounded-lg px-2 py-1 text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h4 className="font-semibold text-gray-800">Current Rates by Bank</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
              <tr>{['Bank','Loans','Total Debt','Current Rate','Market Rate','Above Market?','Annual Saving','Recommendation'].map(h => (
                <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bankRows.map(row => {
                const above = row.weightedRate > marketRate;
                const annSave = above ? Math.round(row.totalDebt*(row.weightedRate-marketRate)/100) : 0;
                return (
                  <tr key={row.bank} className={`hover:bg-gray-50 ${above ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{row.bank}</td>
                    <td className="px-4 py-3 text-right">{row.loans.length}</td>
                    <td className="px-4 py-3 text-right">{fmt(row.totalDebt)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${above ? 'text-red-600' : 'text-green-700'}`}>{row.weightedRate.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-gray-500">{marketRate.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right">{above ? <span className="text-red-600 font-medium">+{(row.weightedRate-marketRate).toFixed(2)}%</span> : <span className="text-green-600">✓</span>}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{annSave > 0 ? fmt(annSave) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${above ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {above ? '↓ REFINANCE' : '✓ OPTIMAL'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        {bestRateBank && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-bold text-blue-900 mb-1">💡 INSIGHT 1 — BEST RATE BANK</p>
            <p className="text-sm text-blue-800"><strong>{bestRateBank.bank}</strong> offers the lowest weighted rate at <strong>{bestRateBank.weightedRate.toFixed(2)}%</strong> across <strong>{bestRateBank.loans.length} loan{bestRateBank.loans.length>1?'s':''}</strong> totaling <strong>{fmt(bestRateBank.totalDebt)}</strong>. Consider consolidating higher-rate loans here.</p>
          </div>
        )}
        <div className={`border rounded-xl p-4 space-y-3 ${highRateLoans.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <p className={`text-sm font-bold mb-1 ${highRateLoans.length > 0 ? 'text-amber-900' : 'text-green-900'}`}>💡 INSIGHT 2 — REFINANCING OPPORTUNITY</p>
          {highRateLoans.length > 0 ? (
            <>
              <p className="text-sm text-amber-800"><strong>{highRateLoans.length} loan{highRateLoans.length>1?'s':''}</strong> above market rate ({marketRate}%) totaling <strong>{fmt(highRateLoans.reduce((s,l)=>s+l.balance,0))}</strong>. Refinancing saves <strong>{fmt(monthlySavingTotal)}/month</strong> | <strong>{fmt(monthlySavingTotal*12)}/year</strong>.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-amber-100 text-amber-700 uppercase">
                    <tr>{['Company','Bank','Cur Rate','Target','Mo Saving','Yr Saving','Action'].map(h => <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {refLoans.map(l => {
                      const ms = Math.round(l.balance*(l.interestRate-marketRate)/100/12);
                      return (
                        <tr key={l.id}>
                          <td className="px-3 py-1.5 font-medium">{l.company}</td>
                          <td className="px-3 py-1.5">{l.bank}</td>
                          <td className="px-3 py-1.5 text-right text-red-700 font-medium">{l.interestRate}%</td>
                          <td className="px-3 py-1.5 text-right text-green-700">{marketRate.toFixed(1)}%</td>
                          <td className="px-3 py-1.5 text-right">{fmt(ms)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{fmt(ms*12)}</td>
                          <td className="px-3 py-1.5 text-right"><span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium">Refinance</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-green-800">All loans at or below market rate ({marketRate}%). No refinancing needed.</p>
          )}
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-bold text-gray-900 mb-2">💡 INSIGHT 3 — RATE TREND</p>
          <p className="text-sm text-gray-700 mb-2">Weighted avg portfolio rate is <strong>{weightedAvgRate.toFixed(2)}%</strong> vs market <strong>{marketRate}%</strong>. {refLoans.length > 0 ? 'Priority refinancing order (by annual saving):' : 'All loans at or below market rate.'}</p>
          {refLoans.length > 0 && (
            <ol className="space-y-1">{refLoans.map((l, i) => (
              <li key={l.id} className="text-sm text-gray-700">
                <strong>{i+1}.</strong> {l.company} · {l.bank} @ <span className="text-red-600 font-medium">{l.interestRate}%</span> — saves <strong>{fmt(Math.round(l.balance*(l.interestRate-marketRate)/100))}/yr</strong>
              </li>
            ))}</ol>
          )}
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-bold text-green-900 mb-2">💡 INSIGHT 4 — BEST BANK TO APPROACH</p>
          <div className="space-y-1 text-sm text-green-800">
            {bankRows.slice(0,3).map((b,i) => (
              <p key={b.bank}><strong>{b.bank}</strong> — {b.weightedRate.toFixed(2)}% avg rate · {fmt(b.totalDebt)} total · {b.loans.length} loan{b.loans.length>1?'s':''}{i===0?' (largest lender)':''}</p>
            ))}
            {bestRateBank && <p className="mt-1 font-medium">Best rate: <strong>{bestRateBank.bank}</strong> @ {bestRateBank.weightedRate.toFixed(2)}% — ideal for consolidation.</p>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-800 mb-4">Refinancing Calculator</h4>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {[
            { label:'Outstanding Balance ($)', key:'balance' as const, placeholder:'1,500,000' },
            { label:'Current Rate (%)',         key:'currentRate' as const, placeholder:'7.5' },
            { label:'Target Rate (%)',          key:'targetRate' as const, placeholder:'6.5' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs text-gray-500 block mb-1">{label}</label>
              <input type="number" value={calc[key]} placeholder={placeholder}
                onChange={e => setCalc(p => ({ ...p, [key]: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
        {calcBal > 0 && calcCurR > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-green-50 rounded-xl">
            {[
              { label:'Current EMI',   value:fmt(Math.round(calcCurEMI)),  color:'text-red-700' },
              { label:'New EMI',       value:fmt(Math.round(calcNewEMI)),  color:'text-green-700' },
              { label:'Monthly Saving',value:fmt(Math.round(calcSaving)),  color:'text-green-700' },
              { label:'Annual Saving', value:fmt(Math.round(calcSaving*12)),color:'text-green-800 font-bold' },
            ].map(({ label, value, color }) => (
              <div key={label}><p className="text-xs text-gray-500 mb-0.5">{label}</p><p className={`text-lg font-bold ${color}`}>{value}</p></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section 4: Cash Position + EMI Alerts ─────────────────────────────────────

function CashPositionAlerts({ companies }: { companies: CompanyData[] }) {
  const [cashPositions, setCashPositions] = useState<Record<string, { amount: number; date: string; bank: string }>>(() =>
    Object.fromEntries(companies.map(c => [c.id, { amount: c.property.cashAvailable, date: new Date().toISOString().split('T')[0], bank: 'Operating Account' }]))
  );
  const [formCompanyId, setFormCompanyId] = useState(companies[0]?.id ?? '');
  const [formCash,      setFormCash]      = useState('');
  const [formBank,      setFormBank]      = useState('');
  const today = new Date().toISOString().split('T')[0];

  function updateCash() {
    if (!formCompanyId || !formCash) return;
    setCashPositions(prev => ({ ...prev, [formCompanyId]: { amount: parseFloat(formCash.replace(/,/g,''))||0, date: today, bank: formBank || 'Operating Account' } }));
    setFormCash(''); setFormBank('');
  }

  interface AlertItem { id: string; severity: 'critical'|'warning'|'watch'; company: string; message: string; detail: string; actions: string[]; }
  const alerts: AlertItem[] = [];
  companies.forEach(c => {
    const pos = cashPositions[c.id];
    const monthlyEMI = c.loans.filter(l=>l.status==='Active').reduce((s,l)=>s+l.emi,0);
    const cash = pos?.amount ?? 0;
    const ratio = monthlyEMI > 0 ? cash/monthlyEMI : 99;
    const daysSince = pos?.date ? Math.round((new Date().getTime()-new Date(pos.date).getTime())/86400000) : 0;
    if (ratio < 1 && monthlyEMI > 0)
      alerts.push({ id:`crit-${c.id}`, severity:'critical', company:c.name, message:`Cash covers only ${ratio.toFixed(1)} months of EMI`, detail:`Cash: ${fmt(cash)} | Monthly EMI: ${fmt(monthlyEMI)}`, actions:['Update Cash','View Loans'] });
    else if (ratio < 3 && monthlyEMI > 0)
      alerts.push({ id:`warn-${c.id}`, severity:'warning', company:c.name, message:`Cash covers ${ratio.toFixed(1)} months of EMI`, detail:`Consider capital call or lot sale to boost liquidity`, actions:['Issue Capital Call','View Lots'] });
    if (daysSince >= 7)
      alerts.push({ id:`stale-${c.id}`, severity:'watch', company:c.name, message:`Cash position not updated since ${pos?.date ?? 'unknown'}`, detail:`${daysSince} days since last update`, actions:['Update Now'] });
  });

  const sevCfg = {
    critical: { bg:'bg-red-50',    border:'border-l-red-500',    icon:'🔴', color:'text-red-700'    },
    warning:  { bg:'bg-amber-50',  border:'border-l-amber-500',  icon:'🟠', color:'text-amber-700'  },
    watch:    { bg:'bg-yellow-50', border:'border-l-yellow-400', icon:'🟡', color:'text-yellow-700' },
  };

  return (
    <div className="space-y-5">
      <div><h3 className="text-lg font-bold text-gray-900">💵 Cash Position & EMI Alert System</h3></div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-800 mb-4">Update Cash Position</h4>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Company</label>
            <select value={formCompanyId} onChange={e => setFormCompanyId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Cash Available ($)</label>
            <input type="text" value={formCash} onChange={e => setFormCash(e.target.value)} placeholder="e.g. 450,000"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Bank Account</label>
            <input type="text" value={formBank} onChange={e => setFormBank(e.target.value)} placeholder="Operating Account"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={updateCash} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Update</button>
        </div>
        <p className="text-xs text-gray-400 mt-2">As of date: {today} (auto-filled)</p>
      </div>

      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-red-900 text-white"><h4 className="font-semibold">🔔 ACTIVE ALERTS ({alerts.length})</h4></div>
          <div className="divide-y divide-gray-100">
            {alerts.map(alert => {
              const cfg = sevCfg[alert.severity];
              return (
                <div key={alert.id} className={`p-4 ${cfg.bg} border-l-4 ${cfg.border}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${cfg.color}`}>{cfg.icon} {alert.company} — {alert.message}</p>
                      <p className={`text-xs mt-0.5 ${cfg.color} opacity-80`}>{alert.detail}</p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      {alert.actions.map(a => (
                        <button key={a} className="text-xs px-2 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 whitespace-nowrap">{a}</button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h4 className="font-semibold text-gray-800">Cash vs EMI Dashboard</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
              <tr>{['Company','Cash Available','Monthly EMI','Cash/EMI Ratio','Months Covered','Last Updated','Status'].map(h => (
                <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {companies.map(c => {
                const pos = cashPositions[c.id];
                const monthlyEMI = c.loans.filter(l=>l.status==='Active').reduce((s,l)=>s+l.emi,0);
                const cash = pos?.amount ?? 0;
                const ratio = monthlyEMI > 0 ? cash/monthlyEMI : 99;
                const daysSince = pos?.date ? Math.round((new Date().getTime()-new Date(pos.date).getTime())/86400000) : 0;
                const sc = ratio > 6 ? 'bg-green-100 text-green-700' : ratio > 3 ? 'bg-amber-100 text-amber-700' : ratio > 1 ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700';
                const sl = ratio > 6 ? '🟢 Safe' : ratio > 3 ? '🟡 Monitor' : ratio > 1 ? '🟠 Warning' : '🔴 Critical';
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(cash)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(monthlyEMI)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{ratio > 50 ? '∞' : ratio.toFixed(1)}x</td>
                    <td className="px-4 py-3 text-right">{ratio > 50 ? '∞' : ratio.toFixed(1)} mo</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {daysSince === 0 ? 'Today' : `${daysSince}d ago`}{daysSince >= 7 && <span className="text-amber-600 ml-1">⚠️</span>}
                    </td>
                    <td className="px-4 py-3 text-right"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sc}`}>{sl}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Section 5: 90-Day Cash Flow Forecast ─────────────────────────────────────

function CashFlowForecast({ companies }: { companies: CompanyData[] }) {
  const today = new Date();
  const monthLabels = [0,1,2].map(offset => {
    const d = new Date(today.getFullYear(), today.getMonth()+offset, 1);
    return d.toLocaleDateString('en-US', { month:'short', year:'numeric' });
  });

  const forecasts = companies.map(c => {
    const monthlyEMI  = c.loans.filter(l=>l.status==='Active').reduce((s,l)=>s+l.emi,0);
    const monthly$Col = c.customers.reduce((s,cust)=>s+cust.collected,0)/6;
    let cash = c.property.cashAvailable;
    return {
      company: c.name,
      rows: monthLabels.map(month => {
        const closing = cash - monthlyEMI + monthly$Col;
        const row = { month, openingCash:Math.round(cash), emiDue:Math.round(monthlyEMI), collections:Math.round(monthly$Col), closingCash:Math.round(closing), isNegative:closing<0 };
        cash = closing; return row;
      }),
    };
  });

  const portRows = monthLabels.map((month, mi) => ({
    month,
    openingCash:  forecasts.reduce((s,f)=>s+f.rows[mi].openingCash,0),
    emiDue:       forecasts.reduce((s,f)=>s+f.rows[mi].emiDue,0),
    collections:  forecasts.reduce((s,f)=>s+f.rows[mi].collections,0),
    closingCash:  forecasts.reduce((s,f)=>s+f.rows[mi].closingCash,0),
    isNegative:   false,
  }));
  portRows.forEach(r => { r.isNegative = r.closingCash < 0; });

  const chartData = monthLabels.map((month, i) => ({
    month, cash:portRows[i].closingCash, emi:portRows[i].emiDue, collections:portRows[i].collections,
  }));

  const negForecast = forecasts.find(f => f.rows.some(r => r.isNegative));

  const forecastTable = (rows: typeof forecasts[0]['rows'], label: string, dark = false) => (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-100 ${dark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <h4 className={`font-semibold text-sm ${dark ? 'text-white' : 'text-gray-700'}`}>{label}</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-xs uppercase bg-gray-50">
            <tr>{['Month','Opening Cash','EMI Due','Collections','Closing Cash','Status'].map(h => (
              <th key={h} className="px-4 py-2 text-right first:text-left">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr key={row.month} className={row.isNegative ? 'bg-red-50' : 'hover:bg-gray-50'}>
                <td className="px-4 py-2 font-medium text-gray-900">{row.month}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(row.openingCash)}</td>
                <td className="px-4 py-2 text-right font-mono text-red-600">({fmt(row.emiDue)})</td>
                <td className="px-4 py-2 text-right font-mono text-green-700">+{fmt(row.collections)}</td>
                <td className={`px-4 py-2 text-right font-bold font-mono ${row.isNegative ? 'text-red-700' : 'text-gray-900'}`}>{fmt(row.closingCash)}</td>
                <td className="px-4 py-2 text-right">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.isNegative ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {row.isNegative ? '🔴 Shortfall' : '🟢 OK'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900">90-Day Cash & EMI Outlook</h3>
        <p className="text-sm text-gray-500 mt-0.5">Combined cash position and EMI obligations for next 3 months</p>
      </div>

      {negForecast && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4">
          <p className="text-sm font-bold text-red-700">🔴 Cash shortfall projected for {negForecast.rows.find(r=>r.isNegative)?.month}:</p>
          <p className="text-sm text-red-600 mt-1">
            {negForecast.company} needs additional {fmt(Math.abs(negForecast.rows.find(r=>r.isNegative)?.closingCash??0))}.
            Options: <strong>Capital call</strong> | <strong>Lot sale</strong> | <strong>Bridge loan</strong> | <strong>Defer distribution</strong>
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-700 text-sm mb-3">Portfolio Cash vs EMI — 3 Month View</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="month" tick={{ fontSize:12 }} />
            <YAxis tick={{ fontSize:11 }} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} />
            <Tooltip formatter={(v:number)=>[`$${v.toLocaleString()}`,'']} />
            <Legend />
            <Bar dataKey="cash"        fill="#16A34A" name="Closing Cash"  radius={[4,4,0,0]} />
            <Bar dataKey="emi"         fill="#DC2626" name="EMI Due"       radius={[4,4,0,0]} />
            <Bar dataKey="collections" fill="#2563EB" name="Collections"   radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {forecasts.slice(0,5).map(f => forecastTable(f.rows, f.company))}
      {forecastTable(portRows, 'Portfolio Total', true)}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD07Loans() {
  const { loans, properties, customers, companies } = usePropDev();
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

      <LoanRegister loans={loans} monthlyCollections={monthlyCollections} />

      <CompanyLoanCards companies={companies} marketRate={6.5} />

      {/* Refinancing Recommendation */}
      <RefinancingRecommendation loans={loans} />

      <EmiCalendar companies={companies} />

      {/* EMI Tracker */}
      <EmiTracker loans={loans} />

      {/* ── Per-Loan Cards ── */}
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

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* NEW SECTIONS — added below existing Active Loans content      */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <BankRateIntelligence companies={companies} />
      <CashPositionAlerts   companies={companies} />
      <CashFlowForecast     companies={companies} />
    </div>
  );
}
