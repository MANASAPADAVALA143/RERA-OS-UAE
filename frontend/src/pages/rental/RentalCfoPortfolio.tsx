import { useMemo, useState } from 'react';
import { Zap, AlertTriangle } from 'lucide-react';
import { useRentalCfoData } from '../../hooks/useRentalCfoData';
import { LoadingSkeleton } from '../../components/ui/Table';
import { fmtUSD, fmtPct } from '../../components/ProtectedRoute';

const fmtK = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : fmtUSD(n);

const QUICK_QUESTIONS = [
  'Which building needs attention?',
  'Should I raise rents?',
  'Is my debt sustainable?',
  'Where am I losing money?',
  "What's my cash runway?",
];

function healthScore(co: { occupancy_pct: number; collected_this_month: number; billed_this_month: number; total_expense_this_month: number; gross_potential_rent: number }, dscr: number | null): number {
  const occ = Math.min(25, co.occupancy_pct * 25);
  const coll = co.billed_this_month > 0 ? Math.min(25, (co.collected_this_month / co.billed_this_month) * 25) : 15;
  const expRatio = co.gross_potential_rent > 0 ? co.total_expense_this_month / co.gross_potential_rent : 0.5;
  const exp = expRatio < 0.3 ? 25 : expRatio < 0.45 ? 18 : 10;
  const debt = dscr == null ? 12 : dscr > 1.25 ? 25 : dscr >= 1.0 ? 18 : 8;
  return Math.round(occ + coll + exp + debt);
}

export default function RentalCfoPortfolio() {
  const { companies, buildings, loans, portfolio, loading, error, reload } = useRentalCfoData();
  const [companyFilter, setCompanyFilter] = useState('all');
  const [buildingFilter, setBuildingFilter] = useState('all');
  const [period, setPeriod] = useState('this-month');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');

  const filteredCompanies = useMemo(() => {
    if (selectedCompany) return companies.filter(c => c.id === selectedCompany);
    if (companyFilter !== 'all') return companies.filter(c => c.id === companyFilter);
    return companies;
  }, [companies, companyFilter, selectedCompany]);

  const portKpis = useMemo(() => {
    const co = filteredCompanies;
    const gpr = co.reduce((s, c) => s + c.gross_potential_rent, 0);
    const collected = co.reduce((s, c) => s + c.collected_this_month, 0);
    const billed = co.reduce((s, c) => s + c.billed_this_month, 0);
    const expenses = co.reduce((s, c) => s + c.total_expense_this_month, 0);
    const noi = collected - expenses;
    const units = co.reduce((s, c) => s + c.total_units, 0);
    const occupied = co.reduce((s, c) => s + c.occupied_units, 0);
    const occ = units > 0 ? occupied / units : 0;
    const collRate = billed > 0 ? collected / billed : 0;
    const expRatio = gpr > 0 ? expenses / gpr : 0;
    const emi = loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0);
    const noiAnnual = noi * 12;
    const dscr = emi * 12 > 0 ? noiAnnual / (emi * 12) : null;
    const vacancyCost = portfolio?.vacancy_loss ?? 0;
    return { noi, occ, collRate, expRatio, dscr, cash: noi - emi, rentGrowth: 2.4, vacancyCost, gpr, collected };
  }, [filteredCompanies, loans, portfolio]);

  const portfolioScore = useMemo(() => {
    if (!portfolio) return { total: 0, occ: 0, coll: 0, exp: 0, debt: 0 };
    const avg = filteredCompanies.length > 0
      ? filteredCompanies.reduce((s, c) => s + healthScore(c, portKpis.dscr), 0) / filteredCompanies.length
      : 0;
    return {
      total: Math.round(avg),
      occ: Math.round(portKpis.occ * 25),
      coll: Math.round(portKpis.collRate * 25),
      exp: portKpis.expRatio < 0.3 ? 25 : portKpis.expRatio < 0.45 ? 18 : 10,
      debt: portKpis.dscr != null && portKpis.dscr > 1.25 ? 25 : portKpis.dscr != null && portKpis.dscr >= 1.0 ? 18 : 8,
    };
  }, [filteredCompanies, portKpis, portfolio]);

  const matrix = useMemo(() => {
    return companies.map(co => {
      const coLoans = loans.filter(l => l.company_name === co.company_name);
      const emi = coLoans.reduce((s, l) => s + (l.loan_emi ?? 0), 0);
      const noiAnnual = co.noi_this_month * 12;
      const dscr = emi * 12 > 0 ? noiAnnual / (emi * 12) : null;
      const expRatio = co.gross_potential_rent > 0 ? co.total_expense_this_month / co.gross_potential_rent : 0;
      const score = healthScore(co, dscr);
      return {
        id: co.id,
        name: co.company_name,
        buildings: 1,
        units: co.total_units,
        occupancy: co.occupancy_pct,
        noi: co.noi_this_month,
        expRatio,
        dscr,
        cash: co.noi_this_month - emi,
        score,
        flag: score < 70 || (dscr != null && dscr < 1.0),
      };
    }).sort((a, b) => b.score - a.score);
  }, [companies, loans]);

  const overBudget = buildings.filter(b => b.expenseRatio > 0.35).slice(0, 3);
  const occPct = (portKpis.occ * 100).toFixed(0);
  const revAtOcc = portKpis.collected;
  const revAt95 = Math.round(portKpis.gpr * 0.95 * 0.95);

  function askAi(q: string) {
    const question = q || aiQuestion;
    if (!question) return;
    const ctx = `Portfolio: ${companies.length} companies, ${portKpis.occ * 100}% occupancy, NOI ${fmtUSD(portKpis.noi)}, DSCR ${portKpis.dscr?.toFixed(2) ?? 'N/A'}, collection rate ${(portKpis.collRate * 100).toFixed(1)}%.`;
    setAiAnswer(`Based on current data: ${ctx}\n\nRecommendation for "${question}": ${overBudget.length > 0 ? `Focus on ${overBudget[0].buildingName} (expense ratio ${(overBudget[0].expenseRatio * 100).toFixed(0)}%). ` : ''}${portKpis.dscr != null && portKpis.dscr < 1.25 ? 'Debt coverage is tight — prioritize collections. ' : 'Portfolio metrics are stable. '}Take one action this week: review ${matrix[0]?.flag ? 'flagged' : 'top'} company ${matrix.find(m => m.flag)?.name ?? matrix[0]?.name}.`);
  }

  if (loading) return <LoadingSkeleton rows={10} />;
  if (error) return <div className="text-red-600 p-4">{error}<button className="ml-3 underline" onClick={reload}>Retry</button></div>;

  const slicerClass = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs border transition-colors ${active ? 'bg-amber-100 border-amber-600 text-amber-900' : 'border-amber-300 text-gray-600 hover:bg-amber-50'}`;

  return (
    <div className="space-y-6 -m-6 p-6" style={{ background: 'transparent' }}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">CFO Portfolio</h1>
          <p className="text-sm text-gray-500">Strategic decisions · Power BI slicers</p>
        </div>
        <button className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs"><Zap size={13} /> AI Insights</button>
      </div>

      <div className="flex flex-wrap gap-2 p-3 bg-white rounded-xl border">
        <select value={companyFilter} onChange={e => { setCompanyFilter(e.target.value); setSelectedCompany(null); }}
          className={slicerClass(companyFilter !== 'all')}>
          <option value="all">Company: All</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select value={buildingFilter} onChange={e => setBuildingFilter(e.target.value)} className={slicerClass(buildingFilter !== 'all')}>
          <option value="all">Building: All</option>
          {buildings.map(b => <option key={b.id} value={b.id}>{b.buildingName}</option>)}
        </select>
        <select value={period} onChange={e => setPeriod(e.target.value)} className={slicerClass(period !== 'this-month')}>
          <option value="this-month">Period: This Month</option>
          <option value="last-month">Last Month</option>
          <option value="ytd">YTD</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-gray-900 text-white rounded-xl p-5">
          <p className="text-xs uppercase tracking-wider text-amber-400">Portfolio Health Score</p>
          <p className="text-5xl font-bold font-mono mt-2">{portfolioScore.total}<span className="text-2xl text-gray-400">/100</span></p>
          <div className="mt-4 space-y-2 text-sm">
            {[['Occupancy', portfolioScore.occ, 25], ['Collections', portfolioScore.coll, 25], ['Expense Control', portfolioScore.exp, 25], ['Debt Coverage', portfolioScore.debt, 25]].map(([l, v, max]) => (
              <div key={l as string}>
                <div className="flex justify-between text-xs text-gray-400"><span>{l}</span><span>{v}/{max}</span></div>
                <div className="h-1.5 bg-gray-700 rounded-full mt-1"><div className="h-full bg-amber-500 rounded-full" style={{ width: `${((v as number) / (max as number)) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-2 grid grid-cols-2 lg:grid-cols-4 gap-2">
          {[
            { label: 'NOI', value: fmtK(portKpis.noi) },
            { label: 'Occupancy', value: fmtPct(portKpis.occ) },
            { label: 'Collection Rate', value: fmtPct(portKpis.collRate) },
            { label: 'Expense Ratio', value: fmtPct(portKpis.expRatio) },
            { label: 'DSCR', value: portKpis.dscr != null ? `${portKpis.dscr.toFixed(2)}x` : '—' },
            { label: 'Cash Position', value: fmtK(portKpis.cash) },
            { label: 'Rent Growth', value: `+${portKpis.rentGrowth}%` },
            { label: 'Vacancy Cost', value: fmtK(portKpis.vacancyCost) },
          ].map(k => (
            <div key={k.label} className="bg-white rounded-lg border p-3">
              <p className="text-xs text-gray-500">{k.label}</p>
              <p className="text-lg font-bold font-mono text-gray-900">{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { title: 'Occupancy Strategy', body: `Current: ${occPct}% occupied. Revenue at ${occPct}%: ${fmtUSD(revAtOcc)}. Revenue at 95% (−5% rent): ${fmtUSD(revAt95)}.`, rec: revAt95 > revAtOcc ? `Reduce rent by 5% — adds ${fmtUSD(revAt95 - revAtOcc)}/month` : 'Hold rents — occupancy is strong.' },
          { title: 'Expense Control', body: overBudget.length > 0 ? `Top over-budget: ${overBudget.map(b => b.buildingName).join(', ')}` : 'All buildings within expense targets.', rec: overBudget[0] ? `Review ${overBudget[0].buildingName} maintenance & utilities` : 'Maintain current expense discipline.' },
          { title: 'Rent Optimization', body: `${filteredCompanies.filter(c => c.occupancy_pct > 0.9).length} companies above 90% occupancy — room for increases.`, rec: 'Increase rent 3–5% on long-tenancy units with below-market rates.' },
          { title: 'Debt Strategy', body: `${loans.filter(l => (l.loan_interest_rate ?? 0) > 0.065).length} loans above market rate (6.5%).`, rec: portKpis.dscr != null && portKpis.dscr < 1.25 ? 'Defer refinancing until NOI improves' : 'Evaluate refinancing on high-rate loans.' },
          { title: 'Cash Flow Position', body: `Cash this month: ${fmtUSD(portKpis.cash)}. In: ${fmtUSD(portKpis.collected)} rent. Out: ${fmtUSD(loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0) + filteredCompanies.reduce((s, c) => s + c.total_expense_this_month, 0))}.`, rec: portKpis.cash > 0 ? `Runway adequate — ${Math.round(portKpis.cash / Math.max(1, loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0)))} months at current burn` : 'Cash negative — accelerate collections' },
        ].map(p => (
          <div key={p.title} className="bg-white rounded-xl border p-4">
            <h4 className="font-semibold text-gray-800">{p.title}</h4>
            <p className="text-sm text-gray-600 mt-2">{p.body}</p>
            <p className="text-sm text-amber-800 font-medium mt-2 border-l-2 border-amber-500 pl-2">{p.rec}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-700"><h3 className="font-semibold text-white">Company Comparison Matrix</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-200">
            <thead className="text-xs text-gray-400 uppercase">
              <tr>
                {['Rank', 'Company', 'Buildings', 'Units', 'Occupancy', 'NOI', 'Exp Ratio', 'DSCR', 'Cash', 'Score', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, i) => (
                <tr key={row.id}
                  className={`border-t border-gray-800 cursor-pointer hover:bg-gray-800 ${selectedCompany === row.id ? 'bg-gray-800' : ''}`}
                  onClick={() => setSelectedCompany(selectedCompany === row.id ? null : row.id)}
                >
                  <td className="px-3 py-2.5">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-white">{row.name}</td>
                  <td className="px-3 py-2.5 text-right">{row.buildings}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.units}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtPct(row.occupancy)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmtK(row.noi)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{(row.expRatio * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.dscr != null ? `${row.dscr.toFixed(2)}x` : '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${row.cash < 0 ? 'text-red-400' : 'text-green-400'}`}>{fmtK(row.cash)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{row.score}</td>
                  <td className="px-3 py-2.5 text-center">{row.flag ? <AlertTriangle size={14} className="text-amber-400 inline" /> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-gray-800 mb-3">AI CFO Advisor</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          {QUICK_QUESTIONS.map(q => (
            <button key={q} onClick={() => askAi(q)}
              className="px-3 py-1.5 rounded-full text-xs border border-amber-400 text-amber-800 hover:bg-amber-50">
              {q}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={aiQuestion} onChange={e => setAiQuestion(e.target.value)} placeholder="Ask anything about portfolio..."
            className="flex-1 border rounded-lg px-3 py-2 text-sm" onKeyDown={e => e.key === 'Enter' && askAi('')} />
          <button onClick={() => askAi('')} className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm">Ask</button>
        </div>
        {aiAnswer && (
          <div className="mt-4 p-4 bg-gray-900 text-gray-200 rounded-lg text-sm whitespace-pre-wrap">{aiAnswer}</div>
        )}
      </div>
    </div>
  );
}
