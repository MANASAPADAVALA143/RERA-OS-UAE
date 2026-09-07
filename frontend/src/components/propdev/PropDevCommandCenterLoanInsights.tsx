import { useMemo } from 'react';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { usePropDevLoanTrackerData, PROPDEV_MARKET_RATE } from '../../hooks/usePropDevLoanTrackerData';
import {
  cashEmiStatus,
  resolveCompanyMonthlyEmi,
} from '../../utils/propDevLoanMetrics';
import type { CompanyData } from '../../contexts/PropertyDevContext';

const money = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n).toLocaleString()}`;

const COMPANY_COLORS = ['#2563EB', '#16A34A', '#DC2626', '#D97706', '#7C3AED', '#059669'];

function rateColor(rate: number) {
  if (rate > 7.5) return '#DC2626';
  if (rate > 6.5) return '#D97706';
  return '#16A34A';
}

export default function PropDevCommandCenterLoanInsights({
  company,
  cashAvailable,
}: {
  company: CompanyData;
  cashAvailable: number | null;
}) {
  const {
    scopedLoans,
    activeLoans,
    scopeLabel,
    debtByProperty,
    kpis,
  } = usePropDevLoanTrackerData();

  const monthlyEmi = useMemo(
    () => resolveCompanyMonthlyEmi(company, scopedLoans),
    [company, scopedLoans],
  );

  const cash = cashAvailable ?? company.property.cashAvailable ?? 0;
  const coverage = monthlyEmi > 0 ? cash / monthlyEmi : null;
  const health = cashEmiStatus(cash, monthlyEmi);

  const donutData = useMemo(() => {
    if (activeLoans.length <= 1) {
      return debtByProperty.filter(d => d.value > 0).map((d, i) => ({
        name: d.label,
        value: d.value,
        color: COMPANY_COLORS[i % COMPANY_COLORS.length],
      }));
    }
    return activeLoans.map((l, i) => ({
      name: (l.property || l.bank).slice(0, 16),
      value: l.balance,
      color: COMPANY_COLORS[i % COMPANY_COLORS.length],
    })).filter(d => d.value > 0);
  }, [activeLoans, debtByProperty]);

  const rateBarData = useMemo(() => (
    [...activeLoans]
      .map(l => ({
        name: `${(l.property || l.bank).slice(0, 14)}`,
        rate: l.interestRate,
        balance: Math.round((l.balance ?? 0) / 1000),
        barColor: rateColor(l.interestRate),
      }))
      .sort((a, b) => b.rate - a.rate)
  ), [activeLoans]);

  const highest = rateBarData[0];
  const alertFlags: string[] = [];
  if ((kpis.wAvg ?? 0) > PROPDEV_MARKET_RATE) alertFlags.push('Rate above market');
  if (coverage != null && coverage < 3 && monthlyEmi > 0) alertFlags.push('Low cash coverage');
  activeLoans.forEach(l => {
    if (!l.maturityDate) return;
    const days = Math.floor((new Date(l.maturityDate).getTime() - Date.now()) / 86400000);
    if (days > 0 && days <= 90) alertFlags.push('Loan maturing soon');
  });

  if (!activeLoans.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No active loans for {scopeLabel}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider px-2">
          Loan &amp; EMI — {scopeLabel}
        </span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Outstanding Balance Breakdown</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={donutData} dataKey="value" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                {donutData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [money(v), 'Outstanding']} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Interest Rate by Loan</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart layout="vertical" data={rateBarData} barSize={14} margin={{ left: 8, right: 50 }}>
              <XAxis type="number" domain={[0, 12]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
              <Tooltip formatter={(v: number) => [`${v}%`, 'Rate']} />
              <Bar dataKey="rate" radius={[0, 3, 3, 0]}>
                {rateBarData.map((entry, i) => <Cell key={i} fill={entry.barColor} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border border-red-200 bg-red-50 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Highest Rate Loan</p>
          {highest ? (
            <>
              <p className="text-xl font-bold text-red-700">{highest.rate.toFixed(2)}%</p>
              <p className="text-sm text-gray-700 mt-1">{highest.name}</p>
            </>
          ) : <p className="text-gray-400 text-sm">No loans</p>}
        </div>
        <div className="border border-orange-200 bg-orange-50 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Monthly EMI Burden</p>
          <p className="text-xl font-bold text-orange-700">{money(monthlyEmi)}/mo</p>
          <p className="text-sm text-gray-600 mt-1">{money(monthlyEmi * 12)}/year</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">EMI Health Scorecard</h3>
          <p className="text-xs text-gray-500 mt-0.5">{scopeLabel}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Company', 'Loans', 'Avg Rate', 'Monthly EMI', 'Cash Available', 'Coverage', 'Health', 'Alerts'].map((h, i) => (
                  <th key={h} className={`px-4 py-3 ${i === 0 || i === 7 ? 'text-left' : 'text-right'} ${i === 6 ? 'text-center' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100">
                <td className="px-4 py-3 font-medium">{company.name}</td>
                <td className="px-4 py-3 text-center">{activeLoans.length}</td>
                <td className="px-4 py-3 text-right">{(kpis.wAvg ?? 0) > 0 ? `${(kpis.wAvg ?? 0).toFixed(2)}%` : '—'}</td>
                <td className="px-4 py-3 text-right text-orange-700 font-medium">{monthlyEmi > 0 ? money(monthlyEmi) : '—'}</td>
                <td className="px-4 py-3 text-right">{money(cash)}</td>
                <td className="px-4 py-3 text-right font-semibold">
                  {coverage != null ? `${coverage.toFixed(1)} mo` : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${health.badgeClass}`}>{health.label}</span>
                </td>
                <td className="px-4 py-3">
                  {alertFlags.length
                    ? alertFlags.map(f => (
                      <span key={f} className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 mr-1">{f}</span>
                    ))
                    : <span className="text-xs text-green-600">✓ No issues</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
