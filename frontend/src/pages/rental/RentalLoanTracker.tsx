import { useMemo, useState } from 'react';
import { Download, Zap, CheckCircle2, TrendingDown } from 'lucide-react';
import { useRentalCfoData, dscrStatus } from '../../hooks/useRentalCfoData';
import { LoadingSkeleton } from '../../components/ui/Table';
import { fmtUSD } from '../../components/ProtectedRoute';

const MARKET_RATE = 0.065;
const fmtK = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : fmtUSD(n);

const DSCR_STYLE = { green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', grey: 'bg-gray-100 text-gray-600' };

export default function RentalLoanTracker() {
  const { companies, buildings, loans, loading, error, reload } = useRentalCfoData();
  const [companyFilter, setCompanyFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('all');

  const buildingOptions = useMemo(() => {
    const names = new Set(loans.map(l => l.property_name));
    return [...names].sort();
  }, [loans]);

  const filtered = useMemo(() => {
    let rows = loans;
    if (companyFilter !== 'all') {
      const co = companies.find(c => c.id === companyFilter);
      if (co) rows = rows.filter(l => l.company_name === co.company_name);
    }
    if (buildingFilter !== 'all') rows = rows.filter(l => l.property_name === buildingFilter);
    return rows;
  }, [loans, companyFilter, buildingFilter, companies]);

  const kpis = useMemo(() => {
    const portfolio = filtered.reduce((s, l) => s + (l.loan_balance_as_of ?? l.loan_amount), 0);
    const emi = filtered.reduce((s, l) => s + (l.loan_emi ?? 0), 0);
    const rates = filtered.filter(l => l.loan_interest_rate != null);
    const wAvg = rates.length > 0
      ? rates.reduce((s, l) => s + (l.loan_interest_rate ?? 0) * (l.loan_balance_as_of ?? l.loan_amount), 0) /
        rates.reduce((s, l) => s + (l.loan_balance_as_of ?? l.loan_amount), 0)
      : 0;
    const nextMat = filtered
      .filter(l => l.loan_maturity_date)
      .sort((a, b) => (a.loan_maturity_date ?? '').localeCompare(b.loan_maturity_date ?? ''))[0];
    return { portfolio, emi, wAvg, nextMat };
  }, [filtered]);

  const highRateLoans = filtered.filter(l => (l.loan_interest_rate ?? 0) > MARKET_RATE);
  const monthlySavings = highRateLoans.reduce((s, l) => {
    const bal = l.loan_balance_as_of ?? l.loan_amount;
    return s + bal * ((l.loan_interest_rate ?? 0) - MARKET_RATE) / 12;
  }, 0);

  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  const dscrHealth = useMemo(() => buildings.map(b => {
    const bLoans = loans.filter(l => l.company_name === b.companyName && l.property_name === b.buildingName);
    const debtService = bLoans.reduce((s, l) => s + (l.loan_emi ?? 0) * 12, 0);
    const noiAnnual = b.noi * 12;
    const dscr = debtService > 0 ? noiAnnual / debtService : null;
    const st = dscrStatus(dscr);
    return {
      building: b.buildingName,
      noi: noiAnnual,
      debtService,
      dscr,
      status: st,
      recommendation: st === 'red' ? 'Reduce debt or boost NOI' : st === 'amber' ? 'Monitor closely' : 'Healthy coverage',
    };
  }), [buildings, loans]);

  if (loading) return <LoadingSkeleton rows={10} />;
  if (error) return <div className="text-red-600 p-4">{error}<button className="ml-3 underline" onClick={reload}>Retry</button></div>;

  return (
    <div className="space-y-6 -m-6 p-6" style={{ background: '#FAFAF7' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Loan Tracker</h1>
          <p className="text-sm text-gray-500">Rental property debt portfolio</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setBuildingFilter('all'); }}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="all">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <select value={buildingFilter} onChange={e => setBuildingFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="all">All Buildings</option>
            {buildingOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs"><Download size={13} /> Export</button>
          <button className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs"><Zap size={13} /> AI Insights</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Loan Portfolio', value: fmtK(kpis.portfolio) },
          { label: 'Total Monthly EMI', value: fmtK(kpis.emi) },
          { label: 'Weighted Avg Rate', value: `${(kpis.wAvg * 100).toFixed(2)}%` },
          { label: 'Next Maturity', value: kpis.nextMat?.loan_maturity_date ?? '—', sub: kpis.nextMat?.property_name },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">{k.label}</p>
            <p className="text-xl font-bold font-mono mt-1">{k.value}</p>
            {k.sub && <p className="text-xs text-gray-400 truncate">{k.sub}</p>}
          </div>
        ))}
      </div>

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
              {filtered.map(l => {
                const st = dscrStatus(l.dscr);
                return (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5">{l.company_name}</td>
                    <td className="px-3 py-2.5">{l.property_name}</td>
                    <td className="px-3 py-2.5">{l.loan_bank_name}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtK(l.loan_amount)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{l.loan_interest_rate != null ? `${(l.loan_interest_rate * 100).toFixed(2)}%` : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{l.loan_emi != null ? fmtUSD(l.loan_emi) : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtK(l.loan_balance_as_of ?? l.loan_amount)}</td>
                    <td className="px-3 py-2.5 text-right text-xs">{l.loan_maturity_date ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">{l.loan_emi_day ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{l.dscr != null ? `${l.dscr.toFixed(2)}x` : '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${DSCR_STYLE[st]}`}>{st}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No loans found for rental portfolio</p>}
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-gray-800 mb-3">EMI Calendar — {today.toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
            const dueLoans = filtered.filter(l => l.loan_emi_day === d);
            if (dueLoans.length === 0) return <div key={d} className="w-8 h-8 text-xs text-gray-300 flex items-center justify-center">{d}</div>;
            const overdue = d < dayOfMonth;
            const dueSoon = d >= dayOfMonth && d <= dayOfMonth + 3;
            const color = overdue ? 'bg-red-500 text-white' : dueSoon ? 'bg-amber-400 text-white' : 'bg-green-600 text-white';
            return (
              <div key={d} className="relative group">
                <div className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center ${color}`}>{d}</div>
                <div className="hidden group-hover:block absolute z-10 top-9 left-0 bg-gray-900 text-white text-xs rounded p-2 whitespace-nowrap">
                  {dueLoans.map(l => <div key={l.id}>{l.loan_bank_name}: {fmtUSD(l.loan_emi ?? 0)}</div>)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {highRateLoans.length > 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <TrendingDown size={20} className="text-amber-600 shrink-0" />
            <div>
              <h4 className="font-semibold text-amber-800">Refinancing Opportunity</h4>
              <p className="text-sm text-amber-700 mt-1">
                {highRateLoans.length} loan(s) above market rate ({(MARKET_RATE * 100).toFixed(1)}%).
                Est. monthly savings: <strong>{fmtUSD(monthlySavings)}</strong> ({fmtUSD(monthlySavings * 12)}/yr).
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
          <CheckCircle2 size={16} /> All loans at or below market rate ({(MARKET_RATE * 100).toFixed(1)}%).
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-900 text-white"><h3 className="font-semibold">Building DSCR Health</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                {['Building', 'NOI (Annual)', 'Debt Service', 'DSCR', 'Status', 'Recommendation'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {dscrHealth.map(row => (
                <tr key={row.building} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 font-medium">{row.building}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtK(row.noi)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtK(row.debtService)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.dscr != null ? `${row.dscr.toFixed(2)}x` : '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${DSCR_STYLE[row.status]}`}>{row.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs text-gray-600">{row.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
