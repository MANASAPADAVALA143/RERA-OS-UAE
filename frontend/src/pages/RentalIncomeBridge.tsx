import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { useRentalPortfolio, sumMetrics } from '../contexts/RentalPortfolioContext';
import { useRentalNav } from '../contexts/RentalNavContext';

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const pct = (n: number, total: number) => total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '—';

interface BridgeRowProps { label: string; value: number; negative?: boolean; bold?: boolean; divider?: boolean }
function BridgeRow({ label, value, negative = false, bold = false, divider = false }: BridgeRowProps) {
  return (
    <tr className={divider ? 'border-t-2 border-gray-300' : ''}>
      <td className={`py-2 pr-4 text-sm ${bold ? 'font-bold text-gray-900' : 'text-gray-600'}`} style={bold ? { fontFamily: 'Georgia,serif' } : {}}>
        {label}
      </td>
      <td className={`py-2 text-right text-sm font-mono ${bold ? 'font-bold text-gray-900' : negative ? 'text-red-700' : 'text-gray-800'}`}>
        {negative ? `(${$(Math.abs(value))})` : $(value)}
      </td>
    </tr>
  );
}

function AlertBox({ entities, arAp }: { entities: { entity_name: string; gpr: number; pastDue: number }[]; arAp: typeof entities }) {
  const flagged = entities.filter(e => e.gpr > 0 && (e.pastDue / e.gpr) > 0.15);
  if (flagged.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <p className="text-sm font-semibold text-amber-800 mb-2">Collections Alert</p>
      <ul className="space-y-1">
        {flagged.map(e => (
          <li key={e.entity_name} className="text-sm text-amber-700">
            <span className="font-medium">{e.entity_name}</span> — prioritise notices / pay-or-quit
            <span className="text-xs ml-2 text-amber-500">({pct(e.pastDue, e.gpr)} past due)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RentalIncomeBridge() {
  const { portfolio } = useRentalPortfolio();
  const { setTab } = useRentalNav();

  if (!portfolio.loaded || portfolio.entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-500 text-sm">No portfolio data loaded yet.</p>
        <button onClick={() => setTab('portfolio-upload')}
          className="bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#1A5249]">
          ← Upload Portfolio Data
        </button>
      </div>
    );
  }

  const { entities, arAp } = portfolio;
  const port = sumMetrics(entities);
  const totalDS = entities.reduce((s, e) => s + e.debt_service_annual, 0);

  const bridgeData = [
    { name: 'Gross Rent', value: port.gpr },
    { name: 'Eff. Income', value: port.egi },
    { name: 'NOI', value: port.noi },
    { name: 'Cash Flow', value: port.cash_flow },
  ];

  const opexBreakdown = [
    { category: 'Management', amount: entities.reduce((s, e) => s + e.management_fee, 0) },
    { category: 'Maintenance', amount: entities.reduce((s, e) => s + e.maintenance, 0) },
    { category: 'Utilities', amount: entities.reduce((s, e) => s + e.utilities, 0) },
    { category: 'Insurance', amount: entities.reduce((s, e) => s + e.insurance, 0) },
    { category: 'Property Tax', amount: entities.reduce((s, e) => s + e.property_taxes, 0) },
    { category: 'Other', amount: entities.reduce((s, e) => s + e.other_opex, 0) },
  ].filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);

  // AR/AP summary
  const totalAr = arAp.reduce((s, r) => s + r.ar_current + r.ar_1_30 + r.ar_31_60 + r.ar_61_90 + r.ar_90_plus, 0);
  const totalAp = arAp.reduce((s, r) => s + r.ap_current + r.ap_1_30 + r.ap_31_60 + r.ap_60_plus, 0);
  const totalPastDue31 = arAp.reduce((s, r) => s + r.ar_31_60 + r.ar_61_90 + r.ar_90_plus, 0);
  const nwc = totalAr - totalAp;

  const entityArData = entities.map(e => {
    const ar = arAp.find(r => r.entity_name.toLowerCase().includes(e.entity_name.toLowerCase().split(' ')[0]));
    const arTotal = ar ? ar.ar_current + ar.ar_1_30 + ar.ar_31_60 + ar.ar_61_90 + ar.ar_90_plus : 0;
    const pastDue = ar ? ar.ar_31_60 + ar.ar_61_90 + ar.ar_90_plus : 0;
    const apTotal = ar ? ar.ap_current + ar.ap_1_30 + ar.ap_31_60 + ar.ap_60_plus : 0;
    const gprMonthly = (e.units * e.rent_per_unit_mo);
    return { entity_name: e.entity_name, ar: arTotal, pastDue, ap: apTotal, nwc: arTotal - apTotal, gpr: gprMonthly };
  });

  return (
    <div className="space-y-8" style={{ fontFamily: 'Georgia, serif' }}>
      <div>
        <p className="text-xs uppercase tracking-wider font-sans" style={{ color: '#B8860B' }}>02</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Rent to Cash Flow</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Bridge table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Income Statement Bridge</h2>
          <table className="w-full">
            <tbody>
              <BridgeRow label="Gross potential rent"     value={port.gpr} />
              <BridgeRow label="Less: vacancy & credit loss" value={port.vacancy} negative />
              <BridgeRow label="Other income"             value={entities.reduce((s,e)=>s+e.other_income_annual,0)} />
              <BridgeRow label="Effective gross income"   value={port.egi} bold divider />
              <BridgeRow label="Less: operating expense"  value={port.total_opex} negative />
              <BridgeRow label="Net operating income"     value={port.noi} bold divider />
              <BridgeRow label="Less: debt service"       value={totalDS} negative />
              <BridgeRow label="Pre-tax cash flow"        value={port.cash_flow} bold divider />
            </tbody>
          </table>
        </div>

        {/* Waterfall bar chart */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Rent to Cash Flow</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={bridgeData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: 'sans-serif' }} />
              <YAxis tick={{ fontSize: 10, fontFamily: 'monospace' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [$(v)]} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="value" position="top" formatter={(v: number) => `$${(v/1000).toFixed(0)}k`} style={{ fontSize: 10, fontFamily: 'monospace' }} />
                {bridgeData.map((d, i) => <Cell key={i} fill={d.value < 0 ? '#dc2626' : '#B8860B'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* OpEx horizontal bars */}
      {opexBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Operating Expense Composition</h2>
          <p className="text-sm text-gray-400 font-sans mb-4">Where the operating dollar goes</p>
          <div className="space-y-3">
            {opexBreakdown.map(c => (
              <div key={c.category}>
                <div className="flex justify-between text-xs font-sans text-gray-600 mb-1">
                  <span>{c.category}</span>
                  <span className="font-mono">{$(c.amount)} · {pct(c.amount, port.total_opex)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: pct(c.amount, port.total_opex), backgroundColor: '#B8860B' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AR/AP summary cards */}
      {arAp.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-sans">
            {[
              { label: 'Total Receivable', val: $(totalAr) },
              { label: 'Total Payable', val: $(totalAp) },
              { label: 'Net Working Capital', val: $(nwc), red: nwc < 0 },
              { label: 'Rent Past Due 31+', val: totalAr > 0 ? pct(totalPastDue31, totalAr) : '—', red: (totalAr > 0 && totalPastDue31 / totalAr > 0.15) },
            ].map(k => (
              <div key={k.label} className={`rounded-xl p-4 border ${k.red ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                <p className="text-xs text-gray-500">{k.label}</p>
                <p className={`text-xl font-bold font-mono mt-1 ${k.red ? 'text-red-700' : 'text-gray-900'}`}>{k.val}</p>
              </div>
            ))}
          </div>

          {/* Entity AR/AP table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Entity AR & AP</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm font-sans">
                <thead>
                  <tr className="bg-gray-800 text-white text-xs">
                    <th className="px-3 py-2 text-left">Entity</th>
                    <th className="px-3 py-2 text-right">AR Total</th>
                    <th className="px-3 py-2 text-right">Past Due 31+</th>
                    <th className="px-3 py-2 text-right">AP Total</th>
                    <th className="px-3 py-2 text-right">Net WC</th>
                  </tr>
                </thead>
                <tbody>
                  {entityArData.map((r, i) => {
                    const highPastDue = r.gpr > 0 && r.pastDue / r.gpr > 0.15;
                    return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2 font-medium">{r.entity_name}</td>
                        <td className="px-3 py-2 text-right font-mono">{$(r.ar)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${highPastDue ? 'text-red-700 font-semibold' : ''}`}>{$(r.pastDue)}</td>
                        <td className="px-3 py-2 text-right font-mono">{$(r.ap)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${r.nwc < 0 ? 'text-red-700' : 'text-green-800'}`}>{$(r.nwc)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <AlertBox entities={entityArData} arAp={[]} />
        </>
      )}
    </div>
  );
}
