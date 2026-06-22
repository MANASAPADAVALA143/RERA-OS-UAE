import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useRentalPortfolio, computeEntityMetrics, sumMetrics } from '../contexts/RentalPortfolioContext';
import { useRentalNav } from '../contexts/RentalNavContext';

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const pct = (n: number | null) => (n == null ? '—' : (n * 100).toFixed(1) + '%');
const x2 = (n: number | null) => (n == null ? '—' : n.toFixed(2) + 'x');

function dscrColor(v: number | null) {
  if (v == null) return '#6b7280';
  if (v >= 1.30) return '#16a34a';
  if (v >= 1.10) return '#d97706';
  return '#dc2626';
}

function KpiBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="rounded-xl p-5 text-white" style={{ backgroundColor: color }}>
      <p className="text-xs uppercase tracking-wider opacity-80">{label}</p>
      <p className="text-2xl font-bold font-mono mt-1">{value}</p>
      {sub && <p className="text-xs opacity-70 mt-1">{sub}</p>}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr className={bold ? 'border-t border-gray-300' : ''}>
      <td className={`py-1.5 text-sm ${bold ? 'font-bold text-gray-900' : 'text-gray-600'}`}>{label}</td>
      <td className={`py-1.5 text-sm text-right font-mono ${bold ? 'font-bold text-gray-900' : 'text-gray-800'}`}>{value}</td>
    </tr>
  );
}

function generateNarrative(port: ReturnType<typeof sumMetrics>, entityCount: number, occupancy: number): string {
  const dscrStr = port.dscr != null ? port.dscr.toFixed(2) + 'x' : 'N/A';
  const occStr = (occupancy * 100).toFixed(1) + '%';
  const noiStr = $(port.noi);
  const cfStr = $(port.cash_flow);
  const ltvStr = port.ltv != null ? (port.ltv * 100).toFixed(1) + '%' : 'N/A';

  const p1 = `The portfolio of ${entityCount} rental ${entityCount === 1 ? 'entity' : 'entities'} generated net operating income of ${noiStr} against an effective gross income of ${$(port.egi)}, reflecting an OpEx ratio of ${port.egi > 0 ? ((port.total_opex / port.egi) * 100).toFixed(1) : '0'}%. Portfolio occupancy stands at ${occStr}, with gross potential rent of ${$(port.gpr)}. After debt service, pre-tax cash flow is ${cfStr}, supported by a portfolio DSCR of ${dscrStr}.`;

  let p2 = `Risk assessment: `;
  const flags: string[] = [];
  if (port.dscr != null && port.dscr < 1.20) flags.push(`DSCR of ${dscrStr} is below the 1.20x covenant threshold — review debt service coverage immediately`);
  if (port.ltv != null && port.ltv > 0.75) flags.push(`average LTV of ${ltvStr} exceeds 75% — refinancing headroom is limited`);
  if (port.cash_flow < 0) flags.push(`negative pre-tax cash flow of ${cfStr} requires capital injection or expense reduction`);
  if (occupancy < 0.90) flags.push(`occupancy below 90% is compressing effective gross income — prioritise leasing`);
  if (flags.length === 0) flags.push('portfolio metrics are within acceptable ranges — monitor DSCR and occupancy quarterly');
  p2 += flags.join('; ') + '. ';
  p2 += 'Review AR aging for entities past 31 days and issue cure notices where necessary.';

  return p1 + '\n\n' + p2;
}

export default function RentalCfoDashboard() {
  const { portfolio } = useRentalPortfolio();
  const { setTab } = useRentalNav();
  const [showNarrative, setShowNarrative] = useState(false);

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

  const { entities } = portfolio;
  const port = sumMetrics(entities);
  const totalUnits = entities.reduce((s, e) => s + e.units, 0);
  const totalDebt  = entities.reduce((s, e) => s + e.loan_balance, 0);
  const totalValue = entities.reduce((s, e) => s + e.property_value, 0);
  const memberEquity = totalValue - totalDebt;
  const weightedOcc = totalUnits > 0
    ? entities.reduce((s, e) => s + e.occupancy_pct * e.units, 0) / totalUnits
    : 0;

  const opexCategories = [
    { category: 'Management', amount: entities.reduce((s, e) => s + e.management_fee, 0) },
    { category: 'Maintenance', amount: entities.reduce((s, e) => s + e.maintenance, 0) },
    { category: 'Utilities', amount: entities.reduce((s, e) => s + e.utilities, 0) },
    { category: 'Insurance', amount: entities.reduce((s, e) => s + e.insurance, 0) },
    { category: 'Property Tax', amount: entities.reduce((s, e) => s + e.property_taxes, 0) },
    { category: 'Other', amount: entities.reduce((s, e) => s + e.other_opex, 0) },
  ].filter(c => c.amount > 0);

  const noiByEntity = entities.map(e => ({
    name: e.entity_name.split(' ').slice(0, 2).join(' '),
    noi: Math.round(computeEntityMetrics(e).noi),
  }));

  const narrative = generateNarrative(port, entities.length, weightedOcc);

  return (
    <div className="space-y-8" style={{ fontFamily: 'Georgia, serif' }}>
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-wider font-sans" style={{ color: '#B8860B' }}>CFO Portfolio View</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Portfolio Dashboard</h1>
        <p className="text-sm text-gray-500 font-sans mt-1">{portfolio.fileName} · {entities.length} entities · {totalUnits} units</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" style={{ fontFamily: 'sans-serif' }}>
        <KpiBox label="Net Operating Income" value={$(port.noi)} sub="Annual" color="#166534" />
        <KpiBox label="Portfolio Occupancy" value={pct(weightedOcc)} sub="Weighted avg" color="#92400e" />
        <KpiBox label="DSCR" value={x2(port.dscr)} sub="NOI / Debt service" color={dscrColor(port.dscr)} />
        <KpiBox label="Pre-Tax Cash Flow" value={$(port.cash_flow)} sub="After debt service" color="#1e1b4b" />
      </div>

      {/* Section 01 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Metrics table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-sans uppercase tracking-wider mb-3" style={{ color: '#B8860B' }}>01</p>
          <h2 className="text-lg font-bold text-gray-900 mb-4">Portfolio Position</h2>
          <table className="w-full">
            <tbody>
              <Row label="Gross potential rent"        value={$(port.gpr)} />
              <Row label="Vacancy & credit loss"       value={`(${$(port.vacancy)})`} />
              <Row label="Other income"                value={$(entities.reduce((s,e)=>s+e.other_income_annual,0))} />
              <Row label="Effective gross income"      value={$(port.egi)} bold />
              <Row label="Total operating expenses"    value={`(${$(port.total_opex)})`} />
              <Row label="OpEx ratio"                  value={port.egi > 0 ? pct(port.total_opex / port.egi) : '—'} />
              <Row label="Net operating income"        value={$(port.noi)} bold />
              <Row label="Cap rate"                    value={pct(port.cap_rate)} />
              <Row label="Total debt service"          value={`(${$(entities.reduce((s,e)=>s+e.debt_service_annual,0))})`} />
              <Row label="DSCR"                        value={x2(port.dscr)} />
              <Row label="Pre-tax cash flow"           value={$(port.cash_flow)} bold />
              <Row label="Portfolio value"             value={$(totalValue)} />
              <Row label="Total bank debt"             value={$(totalDebt)} />
              <Row label="Member equity"               value={$(memberEquity)} />
              <Row label="Average LTV"                 value={pct(port.ltv)} />
            </tbody>
          </table>
        </div>

        {/* NOI bar chart */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-4">NOI by Entity</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={noiByEntity} margin={{ left: 10, right: 10, top: 5, bottom: 20 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: 'sans-serif' }} angle={-20} textAnchor="end" />
              <YAxis tick={{ fontSize: 10, fontFamily: 'monospace' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [$(v), 'NOI']} />
              <Bar dataKey="noi" radius={[4, 4, 0, 0]}>
                {noiByEntity.map((_, i) => <Cell key={i} fill="#B8860B" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* OpEx composition */}
      {opexCategories.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-lg font-bold text-gray-900 mb-4">OpEx Composition</h2>
          <table className="w-full">
            <thead>
              <tr className="text-xs font-sans text-gray-500 border-b border-gray-200">
                <th className="text-left pb-2">Category</th>
                <th className="text-right pb-2">% of Total</th>
                <th className="text-right pb-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {opexCategories.map(c => (
                <tr key={c.category} className="border-b border-gray-100">
                  <td className="py-2 text-sm text-gray-700">{c.category}</td>
                  <td className="py-2 text-sm text-right font-mono">
                    {port.total_opex > 0 ? ((c.amount / port.total_opex) * 100).toFixed(1) : '0'}%
                  </td>
                  <td className="py-2 text-sm text-right font-mono">{$(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Narrative */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">AI Narrative</h2>
          {!showNarrative && (
            <button onClick={() => setShowNarrative(true)}
              className="text-sm font-sans bg-[#0E3B36] text-white px-4 py-1.5 rounded-lg hover:bg-[#1A5249]">
              Generate Summary
            </button>
          )}
        </div>
        {showNarrative && (
          <>
            <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {narrative}
            </div>
            <p className="text-xs text-gray-400 font-sans mt-2 italic">
              Figures illustrative; not audited financial or tax advice.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
