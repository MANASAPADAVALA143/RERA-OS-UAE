import { Fragment, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  ReferenceLine, Area, ComposedChart,
} from 'recharts';
import { Download, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { useRentalCfoData } from '../../hooks/useRentalCfoData';
import { build13WeekForecast, type ForecastAssumptions } from '../../utils/rental13WeekForecast';
import { LoadingSkeleton } from '../../components/ui/Table';
import { fmtUSD } from '../../components/ProtectedRoute';

const fmtK = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : fmtUSD(n);

const CASH_COLOR = { green: 'text-green-700 bg-green-50', amber: 'text-amber-700 bg-amber-50', red: 'text-red-700 bg-red-50' };

export default function Rental13WeekCashFlow() {
  const { companies, loans, portfolio, loading, error, reload } = useRentalCfoData();
  const [companyFilter, setCompanyFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'finance' | 'tech'>('finance');
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [assumptions, setAssumptions] = useState<ForecastAssumptions>({
    collectionRate: 0.95,
    expenseGrowthPct: 0.02,
    vacancyFactor: 0.05,
    openingCash: 250_000,
  });
  const [aiInsight, setAiInsight] = useState('');

  const filteredCo = useMemo(() =>
    companyFilter === 'all' ? companies : companies.filter(c => c.id === companyFilter),
  [companies, companyFilter]);

  const inputs = useMemo(() => {
    const gpr = filteredCo.reduce((s, c) => s + c.gross_potential_rent, 0);
    const expenses = filteredCo.reduce((s, c) => s + c.total_expense_this_month, 0);
    const emi = loans
      .filter(l => companyFilter === 'all' || filteredCo.some(c => c.company_name === l.company_name))
      .reduce((s, l) => s + (l.loan_emi ?? 0), 0);
    return {
      weeklyRentDue: (gpr / 4.33),
      weeklyOtherIncome: gpr * 0.02 / 4.33,
      weeklyEmi: emi / 4.33,
      weeklyOpex: expenses / 4.33,
      weeklyCapex: expenses * 0.05 / 4.33,
      assumptions,
    };
  }, [filteredCo, loans, companyFilter, assumptions]);

  const forecast = useMemo(() => build13WeekForecast(inputs), [inputs]);
  const bestCase = useMemo(() => build13WeekForecast({
    ...inputs,
    assumptions: { ...assumptions, collectionRate: 1.0, vacancyFactor: 0 },
  }), [inputs, assumptions]);
  const worstCase = useMemo(() => build13WeekForecast({
    ...inputs,
    assumptions: { ...assumptions, collectionRate: 0.85, vacancyFactor: 0.1 },
  }), [inputs, assumptions]);

  const chartData = forecast.weeks.map((w, i) => ({
    week: `W${w.week}`,
    forecast: w.closingCash,
    best: bestCase.weeks[i]?.closingCash,
    worst: worstCase.weeks[i]?.closingCash,
    isActual: w.isActual,
  }));

  function generateAnalysis() {
    setAiInsight(
      `Cash Flow Health: ${forecast.trend === 'Growing' ? 'Positive trajectory' : forecast.trend === 'Declining' ? 'Needs attention' : 'Stable'}.\n\n` +
      `Week(s) of concern: Week ${forecast.lowestWeek} at ${fmtUSD(forecast.lowestCash)}.\n\n` +
      `Recommendations: Maintain ${(assumptions.collectionRate * 100).toFixed(0)}% collection target; ` +
      `review EMI timing in weeks with negative net flow.\n\n` +
      `Cash runway: ${forecast.runwayMonths} months at current burn.\n\n` +
      `Action this week: Follow up on arrears totaling ${fmtUSD(portfolio?.arrears_total ?? 0)} across portfolio.`,
    );
  }

  if (loading) return <LoadingSkeleton rows={10} />;
  if (error) return <div className="text-red-600 p-4">{error}<button className="ml-3 underline" onClick={reload}>Retry</button></div>;

  return (
    <div className="space-y-6 -m-6 p-6" style={{ background: '#FAFAF7' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">13-Week Rolling Cash Flow Forecast</h1>
          <p className="text-sm text-gray-500">Weekly cash position — rental portfolio</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="all">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <select value={viewMode} onChange={e => setViewMode(e.target.value as 'finance' | 'tech')}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            <option value="finance">Finance Mode</option>
            <option value="tech">Tech Mode</option>
          </select>
          <button className="px-3 py-1.5 bg-green-800 text-white rounded-lg text-xs">Generate Forecast</button>
          <button className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs"><Download size={13} /> Export</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border-2 border-blue-200 p-5">
        <p className="text-xs uppercase text-blue-600 font-semibold">📊 13-Week Forecast Result</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
          <div><p className="text-xs text-gray-500">Closing Cash</p><p className="text-2xl font-bold font-mono text-blue-800">{fmtK(forecast.closingCash)}</p></div>
          <div><p className="text-xs text-gray-500">Confidence</p><p className="text-2xl font-bold">{forecast.confidence}</p></div>
          <div><p className="text-xs text-gray-500">Range</p><p className="text-lg font-mono">{fmtK(forecast.worstCaseClosing)} — {fmtK(forecast.bestCaseClosing)}</p></div>
          <div><p className="text-xs text-gray-500">Trend</p><p className="text-2xl font-bold">{forecast.trend} {forecast.trend === 'Growing' ? '↑' : forecast.trend === 'Declining' ? '↓' : '→'}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Cash Runway', value: `${forecast.runwayMonths} mo`, sub: 'at current burn' },
          { label: 'Lowest Point', value: fmtK(forecast.lowestCash), sub: `Week ${forecast.lowestWeek}` },
          { label: 'Collection Forecast', value: fmtK(forecast.totalCollections), sub: '13-week inflows' },
          { label: 'Total Obligations', value: fmtK(forecast.totalObligations), sub: 'EMI + expenses' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border p-4">
            <p className="text-xs text-gray-500 uppercase">{k.label}</p>
            <p className="text-xl font-bold font-mono">{k.value}</p>
            <p className="text-xs text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border p-4">
        <p className="text-xs font-semibold uppercase text-gray-600 mb-3">13-Week Cash Position</p>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData}>
            <XAxis dataKey="week" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => fmtUSD(v)} />
            <Legend />
            <ReferenceLine x="W4" stroke="#9CA3AF" strokeDasharray="4 2" label={{ value: 'Today', fontSize: 9 }} />
            <Area type="monotone" dataKey="worst" fill="#FEE2E2" stroke="none" name="Worst band" />
            <Area type="monotone" dataKey="best" fill="#DCFCE7" stroke="none" name="Best band" />
            <Line type="monotone" dataKey="forecast" stroke="#2563EB" strokeWidth={2.5} dot={false} name="Forecast" />
            <Line type="monotone" dataKey="best" stroke="#16A34A" strokeDasharray="4 2" strokeWidth={1.5} dot={false} name="Best Case" />
            <Line type="monotone" dataKey="worst" stroke="#DC2626" strokeDasharray="4 2" strokeWidth={1.5} dot={false} name="Worst Case" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-900 text-white"><h3 className="font-semibold">13-Week Forecast Table</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                {['Week', 'Start', 'Opening', '+ Collections', '+ Other', '− EMI', '− OpEx', '− CapEx', 'Net CF', 'Closing', ''].map(h => (
                  <th key={h} className="px-2 py-2 text-right first:text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {forecast.weeks.map(w => (
                <Fragment key={w.week}>
                  <tr
                    className={`hover:bg-gray-50 cursor-pointer ${w.isActual ? '' : 'italic text-blue-800'} ${CASH_COLOR[w.status]}`}
                    onClick={() => setExpandedWeek(expandedWeek === w.week ? null : w.week)}
                  >
                    <td className="px-2 py-2 font-medium flex items-center gap-1">
                      {expandedWeek === w.week ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      W{w.week}{w.isActual ? '' : '*'}
                    </td>
                    <td className="px-2 py-2">{w.startDate}</td>
                    <td className="px-2 py-2 text-right font-mono">{fmtK(w.openingCash)}</td>
                    <td className="px-2 py-2 text-right font-mono text-green-700">+{fmtK(w.rentCollections)}</td>
                    <td className="px-2 py-2 text-right font-mono text-green-700">+{fmtK(w.otherIncome)}</td>
                    <td className="px-2 py-2 text-right font-mono text-red-600">−{fmtK(w.emiPayments)}</td>
                    <td className="px-2 py-2 text-right font-mono text-red-600">−{fmtK(w.operatingExpenses)}</td>
                    <td className="px-2 py-2 text-right font-mono text-red-600">{w.capex > 0 ? `−${fmtK(w.capex)}` : '—'}</td>
                    <td className={`px-2 py-2 text-right font-mono font-semibold ${w.netCashFlow >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtK(w.netCashFlow)}</td>
                    <td className="px-2 py-2 text-right font-mono font-bold">{fmtK(w.closingCash)}</td>
                    <td className="px-2 py-2">{w.status === 'green' ? '✅' : w.status === 'amber' ? '⚠️' : '🔴'}</td>
                  </tr>
                  {expandedWeek === w.week && (
                    <tr>
                      <td colSpan={11} className="px-4 py-3 bg-gray-50 text-xs text-gray-600">
                        Rent due from {filteredCo.length} building(s) · EMI payments: {loans.length} loan(s) ·
                        Expected expenses: {fmtUSD(w.operatingExpenses)} · Net: {fmtUSD(w.netCashFlow)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          { label: 'Base Case', closing: forecast.closingCash, note: `${(assumptions.collectionRate * 100).toFixed(0)}% collect` },
          { label: 'Best Case', closing: bestCase.closingCash, note: '100% collect' },
          { label: 'Worst Case', closing: worstCase.closingCash, note: '85% collect' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border p-4 text-center">
            <p className="text-xs text-gray-500 uppercase">{s.label}</p>
            <p className="text-2xl font-bold font-mono mt-1">{fmtK(s.closing)}</p>
            <p className="text-xs text-gray-400">{s.note}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border">
        <button className="w-full flex items-center justify-between px-4 py-3 text-left" onClick={() => setShowAssumptions(!showAssumptions)}>
          <span className="font-semibold text-gray-800">Forecast Assumptions</span>
          {showAssumptions ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {showAssumptions && (
          <div className="px-4 pb-4 space-y-3 border-t">
            <p className="text-xs text-gray-500 pt-3">Rent collections based on lease schedule + historical collection rate. EMI from loan tracker. Expenses: 3-month average.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="text-sm">Collection rate (%)
                <input type="number" value={assumptions.collectionRate * 100} step={1}
                  onChange={e => setAssumptions(a => ({ ...a, collectionRate: Number(e.target.value) / 100 }))}
                  className="w-full border rounded-lg px-3 py-1.5 mt-1 font-mono" />
              </label>
              <label className="text-sm">Expense growth (%/mo)
                <input type="number" value={assumptions.expenseGrowthPct * 100} step={0.5}
                  onChange={e => setAssumptions(a => ({ ...a, expenseGrowthPct: Number(e.target.value) / 100 }))}
                  className="w-full border rounded-lg px-3 py-1.5 mt-1 font-mono" />
              </label>
              <label className="text-sm">Vacancy factor (%)
                <input type="number" value={assumptions.vacancyFactor * 100} step={1}
                  onChange={e => setAssumptions(a => ({ ...a, vacancyFactor: Number(e.target.value) / 100 }))}
                  className="w-full border rounded-lg px-3 py-1.5 mt-1 font-mono" />
              </label>
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-900 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-white">AI Cash Flow Insights</h3>
          <button onClick={generateAnalysis} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs"><Zap size={13} /> Generate Analysis</button>
        </div>
        {aiInsight ? <p className="text-sm text-gray-300 whitespace-pre-wrap">{aiInsight}</p> : <p className="text-sm text-gray-500">Click Generate to analyse forecast.</p>}
      </div>
    </div>
  );
}
