import { useState, useEffect, useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import CompanyComparisonPanel from '../../components/propdev/CompanyComparisonPanel';
import { Edit3, TrendingUp, AlertTriangle, CheckCircle, Info, Zap } from 'lucide-react';
import { runForecast } from '../../utils/forecastEngine';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pct = (n: number, total: number) => total ? `${((n / total) * 100).toFixed(1)}%` : '—';
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ── EditableRow ────────────────────────────────────────────────────────────────
interface EditableRowProps {
  label: string;
  value: number;
  indent?: boolean;
  onChange: (v: number) => void;
  saleConsideration: number;
  totalLots: number;
  provisional?: number; // blue column
  viewMode: 'actual' | 'provisional' | 'combined';
}
function EditableRow({ label, value, indent, onChange, saleConsideration, totalLots, provisional, viewMode }: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(Math.round(value)));
  const total = viewMode === 'actual' ? value : viewMode === 'provisional' ? (provisional ?? value) : value + (provisional ?? 0);
  const showProv = viewMode === 'combined' || viewMode === 'provisional';
  return (
    <tr className="border-t border-gray-50 hover:bg-gray-50 group">
      <td className={`px-5 py-2.5 text-gray-700 ${indent ? 'pl-10' : ''}`}>{label}</td>
      <td className="px-5 py-2.5 text-right text-green-800 font-medium">
        {editing ? (
          <input autoFocus className="w-28 border rounded px-2 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={raw} onChange={e => setRaw(e.target.value)}
            onBlur={() => { const v = parseFloat(raw.replace(/,/g,'')); if (!isNaN(v)) onChange(v); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(raw.replace(/,/g,'')); if (!isNaN(v)) onChange(v); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
          />
        ) : (
          <button className="flex items-center justify-end gap-1 w-full hover:text-blue-600" onClick={() => { setRaw(String(Math.round(value))); setEditing(true); }}>
            {fmt(value)}
            <Edit3 size={11} className="opacity-0 group-hover:opacity-50" />
          </button>
        )}
      </td>
      {showProv && (
        <td className="px-5 py-2.5 text-right text-blue-600 italic text-sm">
          {provisional != null ? fmt(provisional) : '—'}
        </td>
      )}
      <td className="px-5 py-2.5 text-right text-gray-900 font-semibold">{fmt(total)}</td>
      <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{fmt(total / totalLots)}</td>
      <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{pct(total, saleConsideration)}</td>
    </tr>
  );
}

// ── FixedRow (non-editable) ────────────────────────────────────────────────────
function FixedRow({ label, value, indent, saleConsideration, totalLots, provisional, viewMode }: Omit<EditableRowProps, 'onChange'>) {
  const showProv = viewMode === 'combined' || viewMode === 'provisional';
  const total = viewMode === 'actual' ? value : viewMode === 'provisional' ? (provisional ?? value) : value + (provisional ?? 0);
  return (
    <tr className="border-t border-gray-50 hover:bg-gray-50">
      <td className={`px-5 py-2.5 text-gray-700 ${indent ? 'pl-10' : ''}`}>{label}</td>
      <td className="px-5 py-2.5 text-right text-green-800 font-medium">{fmt(value)}</td>
      {showProv && <td className="px-5 py-2.5 text-right text-blue-600 italic text-sm">{provisional != null ? fmt(provisional) : '—'}</td>}
      <td className="px-5 py-2.5 text-right text-gray-900 font-semibold">{fmt(total)}</td>
      <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{fmt(total / totalLots)}</td>
      <td className="px-5 py-2.5 text-right text-gray-500 text-xs">{pct(total, saleConsideration)}</td>
    </tr>
  );
}

// ── SubtotalRow ────────────────────────────────────────────────────────────────
function SubtotalRow({ label, value, viewMode, provisional, saleConsideration, totalLots }: { label: string; value: number; viewMode: string; provisional?: number; saleConsideration: number; totalLots: number }) {
  const showProv = viewMode === 'combined' || viewMode === 'provisional';
  const total = viewMode === 'actual' ? value : viewMode === 'provisional' ? (provisional ?? value) : value + (provisional ?? 0);
  return (
    <tr className="bg-gray-100 border-t border-gray-200">
      <td className="px-5 py-2.5 font-semibold text-gray-800">{label}</td>
      <td className="px-5 py-2.5 text-right font-semibold text-green-800">{fmt(value)}</td>
      {showProv && <td className="px-5 py-2.5 text-right font-semibold text-blue-600 italic">{provisional != null ? fmt(provisional) : '—'}</td>}
      <td className="px-5 py-2.5 text-right font-bold">{fmt(total)}</td>
      <td className="px-5 py-2.5 text-right text-xs text-gray-500">{fmt(total / totalLots)}</td>
      <td className="px-5 py-2.5 text-right text-xs text-gray-500">{pct(total, saleConsideration)}</td>
    </tr>
  );
}

// ── Insight Card ───────────────────────────────────────────────────────────────
function InsightCard({ icon, color, title, body }: { icon: React.ReactNode; color: string; title: string; body: string }) {
  return (
    <div className={`rounded-xl border-l-4 ${color} bg-white p-4 shadow-sm`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div>
          <p className="text-sm font-semibold text-gray-800">{title}</p>
          <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PD02DealPL() {
  const { companies } = usePropDev();

  // Company selector — always pick a single company (never "all")
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  useEffect(() => {
    if (companies.length > 0 && !selectedCompanyId) {
      setSelectedCompanyId(companies[0].id);
    }
  }, [companies, selectedCompanyId]);

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) ?? companies[0];
  const p = selectedCompany?.property;
  const companyLots = selectedCompany?.lots ?? [];
  const companyPartners = selectedCompany?.partners ?? [];
  const companyLoans = selectedCompany?.loans ?? [];

  const costsFromProperty = (prop: typeof p) => ({
    hardCost: prop?.hardCost ?? 120000,
    softCost: prop?.softCost ?? 85000,
    titleCharges: prop?.titleCharges ?? 42000,
    otherCharges: prop?.otherCharges ?? 18000,
    propertyTax: prop?.propertyTax ?? 26514,
    loanProcessing: prop?.loanProcessing ?? 12000,
    professionalCharges: prop?.professionalCharges ?? 9000,
    legalFees: prop?.legalFees ?? 15000,
    interestOnLoan: prop?.interestOnLoan ?? 108000,
  });

  const [costs, setCosts] = useState(() => costsFromProperty(p));
  useEffect(() => { if (p) setCosts(costsFromProperty(p)); }, [p?.id]);

  const [viewMode, setViewMode] = useState<'actual' | 'provisional' | 'combined'>('combined');
  const [lotPriceSlider, setLotPriceSlider] = useState<number | null>(null);
  const [aiAdvice, setAiAdvice] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  if (!p) return <div className="p-4 text-gray-500">No data</div>;

  const totalLots = companyLots.length || p.totalLots;
  const soldLots = companyLots.filter(l => l.status === 'sold' || l.status === 'contracted');
  const soldCount = soldLots.length;
  const actualRevenue = soldLots.reduce((s, l) => s + (l.salePrice ?? l.listPrice), 0);
  const avgListPrice = companyLots.length > 0
    ? companyLots.reduce((s, l) => s + l.listPrice, 0) / companyLots.length
    : (p.saleConsideration / totalLots);
  const provPricePerLot = lotPriceSlider ?? avgListPrice;

  // ── Forecast ─────────────────────────────────────────────────────────────────
  const forecast = useMemo(() => runForecast({
    totalLots,
    soldLots: soldCount,
    actualRevenue,
    avgListPrice,
    lotPriceOverride: lotPriceSlider ?? undefined,
    landCost: p.landCost,
    ...costs,
    managementFeeRate: p.managementFeeRate,
    commissionRate: p.commissionRate,
    commission: p.commission,
    partners: companyPartners.map(pt => ({
      name: pt.name,
      sharePercent: pt.sharePercent,
      capitalContributed: pt.capitalContributed,
      distributionsReceived: pt.distributionsReceived,
      preferredReturn: pt.preferredReturn,
    })),
    loans: companyLoans.map(ln => ({ balance: ln.balance, interestRate: ln.interestRate })),
  }), [totalLots, soldCount, actualRevenue, avgListPrice, lotPriceSlider, p, costs, companyPartners, companyLoans]);

  // Actual-only calc (no provisional)
  const actualTotalCosts = p.landCost + Object.values(costs).reduce((s, v) => s + v, 0) + p.landCost * p.managementFeeRate + (p.commission ?? p.saleConsideration * p.commissionRate);
  const actualNetProfit = p.saleConsideration - actualTotalCosts;
  const actualMargin = p.saleConsideration > 0 ? (actualNetProfit / p.saleConsideration * 100) : 0;

  // Columns for table headers
  const showProv = viewMode === 'combined' || viewMode === 'provisional';
  const colSpanDetails = showProv ? 6 : 5;

  // Management fee & commission
  const managementFee = p.landCost * p.managementFeeRate;
  const commission = p.commission ?? (p.saleConsideration * p.commissionRate);

  type CostKey = keyof typeof costs;
  const setField = (key: CostKey) => (v: number) => setCosts(prev => ({ ...prev, [key]: v }));

  // Total other (editable costs)
  const totalOther = Object.values(costs).reduce((s, v) => s + v, 0);

  // For the provisional column (remaining lots × budget cost / totalLots)
  const remainFrac = totalLots > 0 ? forecast.remainingLots / totalLots : 0;
  const provCosts: Record<string, number> = {};
  for (const [k, v] of Object.entries(costs)) {
    provCosts[k] = v * remainFrac;
  }
  const provManagementFee = managementFee * remainFrac;
  const provCommission = commission * remainFrac;
  const provTotalOther = Object.values(provCosts).reduce((s, v) => s + v, 0);

  // Revenue display
  const displayRevenue = viewMode === 'actual' ? p.saleConsideration
    : viewMode === 'provisional' ? forecast.provisionalRevenue
    : forecast.totalRevenue;

  // ── Strategic Insights ──────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const cards = [];
    const marginOk = forecast.grossMarginPct >= 30;
    const beLotsLeft = forecast.breakEvenLots - soldCount;

    cards.push({
      icon: marginOk ? <CheckCircle size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-amber-600" />,
      color: marginOk ? 'border-green-500' : 'border-amber-500',
      title: marginOk ? `Strong margin at ${fmtPct(forecast.grossMarginPct)}` : `Margin pressure — ${fmtPct(forecast.grossMarginPct)}`,
      body: marginOk
        ? `Net profit of ${fmt(forecast.netProfit)} across ${totalLots} lots. Consider banking profit on early lots and selectively holding premium blocks.`
        : `Margin below 30% threshold. Review commission structure or target price uplift of ${fmt(forecast.breakEvenRevenuePerLot - provPricePerLot)} per lot.`,
    });

    cards.push({
      icon: <TrendingUp size={16} className="text-blue-600" />,
      color: 'border-blue-500',
      title: `Break-even at ${forecast.breakEvenLots} lots sold`,
      body: beLotsLeft > 0
        ? `Need ${beLotsLeft} more lot${beLotsLeft !== 1 ? 's' : ''} to break even. At current pace, ~${forecast.salesVelocityMonthsToComplete.toFixed(0)} months to clear remaining ${forecast.remainingLots} lots.`
        : `Break-even already achieved. Every additional lot sold at current price adds ${fmt(provPricePerLot * (1 - p.commissionRate))} to profit.`,
    });

    cards.push({
      icon: <Info size={16} className="text-purple-600" />,
      color: 'border-purple-500',
      title: 'Partner capital fully returned?',
      body: (() => {
        const totalCapital = companyPartners.reduce((s, pt) => s + pt.capitalContributed, 0);
        const totalDist = companyPartners.reduce((s, pt) => s + pt.distributionsReceived, 0);
        const pct2 = totalCapital > 0 ? (totalDist / totalCapital * 100).toFixed(0) : '0';
        return `${pct2}% of partner capital returned (${fmt(totalDist)} of ${fmt(totalCapital)}). Waterfall allocates ${fmt(forecast.waterfallSteps[0]?.totalAmount ?? 0)} for capital recovery from projected profit.`;
      })(),
    });

    cards.push({
      icon: <AlertTriangle size={16} className={forecast.annualInterest > forecast.netProfit * 0.3 ? 'text-red-500' : 'text-gray-400'} />,
      color: forecast.annualInterest > forecast.netProfit * 0.3 ? 'border-red-500' : 'border-gray-300',
      title: `Annual interest: ${fmt(forecast.annualInterest)}`,
      body: `Loan interest represents ${forecast.netProfit > 0 ? fmtPct(forecast.annualInterest / forecast.netProfit * 100) : 'N/A'} of projected net profit. ${forecast.annualInterest > forecast.netProfit * 0.3 ? 'Consider accelerating lot sales to reduce carrying cost.' : 'Interest load is manageable relative to project returns.'}`,
    });

    cards.push({
      icon: <Zap size={16} className="text-indigo-600" />,
      color: 'border-indigo-500',
      title: `Price lever: +5% adds ${fmt(forecast.remainingLots * provPricePerLot * 0.05)}`,
      body: `Raising lot price by 5% on ${forecast.remainingLots} unsold lots adds ~${fmt(forecast.remainingLots * provPricePerLot * 0.05)} in revenue. Net margin would improve to ~${fmtPct(forecast.grossMarginPct + 3.5)} assuming fixed costs unchanged.`,
    });

    return cards;
  }, [forecast, soldCount, totalLots, companyPartners, p, provPricePerLot]);

  // ── Scenario comparison ─────────────────────────────────────────────────────
  const scenarios = [-10, 0, 5, 10].map(diffPct => {
    const adjPrice = provPricePerLot * (1 + diffPct / 100);
    const rev = actualRevenue + forecast.remainingLots * adjPrice;
    const comm = p.commission ?? (rev * p.commissionRate);
    const mgmt = p.landCost * p.managementFeeRate;
    const np = rev - p.landCost - totalOther - mgmt - comm;
    return { label: diffPct === 0 ? 'Current' : diffPct > 0 ? `+${diffPct}%` : `${diffPct}%`, revenue: fmt(rev), netProfit: fmt(np), margin: fmtPct(rev > 0 ? np / rev * 100 : 0), active: diffPct === 0 };
  });

  // ── AI Advisor ──────────────────────────────────────────────────────────────
  async function fetchAiAdvice() {
    setAiLoading(true);
    setAiAdvice('');
    try {
      const resp = await fetch('/api/propdev/deal-advisor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          totalRevenue: forecast.totalRevenue,
          totalCost: forecast.totalCosts,
          netProfit: forecast.netProfit,
          grossMargin: forecast.grossMarginPct,
          totalLots,
          soldLots: soldCount,
          breakEvenLots: forecast.breakEvenLots,
          annualInterest: forecast.annualInterest,
          partnerCount: companyPartners.length,
        }),
      });
      if (!resp.ok) throw new Error(`Server error ${resp.status}`);
      const data = await resp.json();
      setAiAdvice(data.advice ?? 'No response');
    } catch (e) {
      setAiAdvice(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Deal P&L</h2>
          <p className="text-xs text-gray-400 mt-0.5">Click any expense to edit · provisional figures in blue italic</p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          {/* Company selector */}
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
          >
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {/* View mode */}
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={viewMode}
            onChange={e => setViewMode(e.target.value as typeof viewMode)}
          >
            <option value="combined">Combined (Actual + Provisional)</option>
            <option value="actual">Actual Only</option>
            <option value="provisional">Provisional Only</option>
          </select>
        </div>
      </div>

      {/* Provisional badge */}
      {viewMode !== 'actual' && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-sm text-blue-700 font-medium">Provisional Forecast Active</span>
          <span className="text-xs text-blue-500 ml-1">— {forecast.remainingLots} of {totalLots} lots unsold · provisional figures in <em>blue italic</em></span>
        </div>
      )}

      {/* Lot Price Slider */}
      {viewMode !== 'actual' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">Provisional Lot Price</span>
            <span className="text-sm font-bold text-blue-700">{fmt(provPricePerLot)} / lot</span>
          </div>
          <input
            type="range"
            min={Math.round(avgListPrice * 0.7)}
            max={Math.round(avgListPrice * 1.5)}
            step={1000}
            value={lotPriceSlider ?? avgListPrice}
            onChange={e => setLotPriceSlider(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{fmt(avgListPrice * 0.7)} (−30%)</span>
            <span className="text-gray-500">{fmt(avgListPrice)} (list)</span>
            <span>{fmt(avgListPrice * 1.5)} (+50%)</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="bg-blue-50 rounded-lg p-2">
              <p className="text-xs text-gray-500">Projected Revenue</p>
              <p className="text-sm font-bold text-blue-700">{fmt(forecast.totalRevenue)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-2">
              <p className="text-xs text-gray-500">Net Profit</p>
              <p className={`text-sm font-bold ${forecast.netProfit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(forecast.netProfit)}</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-2">
              <p className="text-xs text-gray-500">Net Margin</p>
              <p className={`text-sm font-bold ${forecast.grossMarginPct >= 30 ? 'text-purple-700' : 'text-amber-600'}`}>{fmtPct(forecast.grossMarginPct)}</p>
            </div>
          </div>
          {lotPriceSlider !== null && (
            <button onClick={() => setLotPriceSlider(null)} className="mt-2 text-xs text-gray-400 underline hover:text-gray-600">Reset to list price</button>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Actual Revenue', value: fmt(actualRevenue), sub: `${soldCount} lots sold`, color: 'text-green-700' },
          { label: viewMode === 'actual' ? 'Total Revenue' : 'Projected Revenue', value: fmt(viewMode === 'actual' ? p.saleConsideration : forecast.totalRevenue), sub: viewMode === 'actual' ? `${totalLots} lots` : `${forecast.remainingLots} lots remaining`, color: 'text-blue-700' },
          { label: 'Net Profit (Projected)', value: fmt(forecast.netProfit), sub: fmtPct(forecast.grossMarginPct) + ' margin', color: forecast.netProfit >= 0 ? 'text-green-700' : 'text-red-700' },
          { label: 'Break-even at', value: `${forecast.breakEvenLots} lots`, sub: `${fmt(forecast.breakEvenRevenuePerLot)}/lot`, color: soldCount >= forecast.breakEvenLots ? 'text-green-700' : 'text-amber-700' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* P&L Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500 w-[38%]">Particulars</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-green-600">Actual</th>
                {showProv && <th className="px-5 py-3 text-right text-xs uppercase text-blue-600 italic">Provisional</th>}
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-700 font-bold">Total</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Per Lot</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">% of Sale</th>
              </tr>
            </thead>
            <tbody>
              {/* A. INCOME */}
              <tr className="bg-blue-900 text-white"><td className="px-5 py-2.5 font-bold" colSpan={colSpanDetails}>A. INCOME</td></tr>
              <FixedRow
                label={`Sale Consideration (all lots) · ${soldCount} sold / ${totalLots} total`}
                value={actualRevenue || p.saleConsideration}
                provisional={forecast.provisionalRevenue}
                indent
                onChange={() => {}}
                saleConsideration={forecast.totalRevenue || p.saleConsideration}
                totalLots={totalLots}
                viewMode={viewMode}
              />
              <tr className="h-1"><td colSpan={colSpanDetails} /></tr>

              {/* B. COST OF LAND */}
              <tr className="bg-blue-900 text-white"><td className="px-5 py-2.5 font-bold" colSpan={colSpanDetails}>B. COST OF LAND</td></tr>
              <FixedRow
                label="Land Cost"
                value={p.landCost}
                provisional={0}
                indent
                onChange={() => {}}
                saleConsideration={forecast.totalRevenue || p.saleConsideration}
                totalLots={totalLots}
                viewMode={viewMode}
              />
              <tr className="h-1"><td colSpan={colSpanDetails} /></tr>

              {/* C. OTHER EXPENSES */}
              <tr className="bg-blue-900 text-white"><td className="px-5 py-2.5 font-bold" colSpan={colSpanDetails}>C. OTHER EXPENSES</td></tr>
              {([
                ['hardCost', 'Hard Cost (Development)'],
                ['softCost', 'Soft Cost (Design/Permits)'],
                ['titleCharges', 'Title Company Charges'],
                ['otherCharges', 'Other Charges'],
                ['propertyTax', 'Property Tax'],
                ['loanProcessing', 'Loan Processing Charges'],
                ['professionalCharges', 'Professional Charges'],
                ['legalFees', 'Legal Fees'],
                ['interestOnLoan', 'Interest on Mortgage Loan'],
              ] as [CostKey, string][]).map(([key, label]) => (
                <EditableRow
                  key={key}
                  label={label}
                  value={costs[key]}
                  provisional={provCosts[key]}
                  indent
                  onChange={setField(key)}
                  saleConsideration={forecast.totalRevenue || p.saleConsideration}
                  totalLots={totalLots}
                  viewMode={viewMode}
                />
              ))}
              <SubtotalRow label="Total Expenses (excl. Land & Commission)" value={totalOther} provisional={provTotalOther} viewMode={viewMode} saleConsideration={forecast.totalRevenue || p.saleConsideration} totalLots={totalLots} />

              {/* Management Fee */}
              <FixedRow
                label={`Management Fee (${(p.managementFeeRate*100).toFixed(0)}% of Land Cost — Note 4)`}
                value={managementFee}
                provisional={provManagementFee}
                indent
                onChange={() => {}}
                saleConsideration={forecast.totalRevenue || p.saleConsideration}
                totalLots={totalLots}
                viewMode={viewMode}
              />

              {/* Commission */}
              <FixedRow
                label={p.commission != null ? 'Sale Commission (6% lot 1 + 3% others — Note 2)' : `Sale Commission (${(p.commissionRate*100).toFixed(1)}% of Sale)`}
                value={commission}
                provisional={provCommission}
                indent
                onChange={() => {}}
                saleConsideration={forecast.totalRevenue || p.saleConsideration}
                totalLots={totalLots}
                viewMode={viewMode}
              />

              <SubtotalRow
                label="Total Expenses"
                value={actualTotalCosts}
                provisional={forecast.totalCosts - actualTotalCosts}
                viewMode={viewMode}
                saleConsideration={forecast.totalRevenue || p.saleConsideration}
                totalLots={totalLots}
              />
              <tr className="h-2"><td colSpan={colSpanDetails} /></tr>
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-5 py-4 font-bold text-base">NET PROFIT / LOSS</td>
                <td className={`px-5 py-4 text-right font-bold ${actualNetProfit >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(actualNetProfit)}</td>
                {showProv && <td className={`px-5 py-4 text-right font-bold italic ${forecast.netProfit >= 0 ? 'text-blue-300' : 'text-red-300'}`}>{fmt(forecast.netProfit - actualNetProfit)}</td>}
                <td className={`px-5 py-4 text-right font-bold text-xl ${forecast.netProfit >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(forecast.netProfit)}</td>
                <td className="px-5 py-4 text-right font-bold text-gray-300">{fmt(forecast.netProfit / totalLots)}</td>
                <td className="px-5 py-4 text-right font-bold text-gray-300">{fmtPct(forecast.grossMarginPct)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Partner Waterfall */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Partner Distribution Waterfall</h3>
          <span className="text-xs text-gray-400">Pool: {fmt(Math.max(0, forecast.netProfit))}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-5 py-3 text-left">Waterfall Step</th>
                {companyPartners.map(pt => (
                  <th key={pt.id} className="px-5 py-3 text-right">{pt.name}</th>
                ))}
                <th className="px-5 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {forecast.waterfallSteps.map((step, si) => (
                <tr key={step.step} className={si % 2 === 0 ? 'bg-gray-50' : ''}>
                  <td className="px-5 py-3 font-medium text-gray-700">{step.step}</td>
                  {step.partners.map(sp => (
                    <td key={sp.name} className="px-5 py-3 text-right text-gray-900">{fmt(sp.amount)}</td>
                  ))}
                  <td className="px-5 py-3 text-right font-semibold">{fmt(step.totalAmount)}</td>
                </tr>
              ))}
              {/* Net row */}
              <tr className="bg-blue-50 border-t-2 border-blue-200">
                <td className="px-5 py-3 font-bold text-gray-800">Total Distribution</td>
                {forecast.partnerNetDistributions.map(d => (
                  <td key={d.name} className="px-5 py-3 text-right font-bold text-blue-700">{fmt(d.net)}</td>
                ))}
                <td className="px-5 py-3 text-right font-bold text-blue-700">
                  {fmt(forecast.partnerNetDistributions.reduce((s, d) => s + d.net, 0))}
                </td>
              </tr>
              {/* ROI row */}
              <tr className="bg-green-50">
                <td className="px-5 py-3 text-sm font-medium text-gray-600">ROI on Capital</td>
                {forecast.partnerNetDistributions.map(d => (
                  <td key={d.name} className="px-5 py-3 text-right text-sm font-semibold text-green-700">{fmtPct(d.roiPct)}</td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Break-even Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          {
            label: 'Break-even Lots',
            value: `${forecast.breakEvenLots} / ${totalLots}`,
            sub: soldCount >= forecast.breakEvenLots ? '✓ Already achieved' : `${forecast.breakEvenLots - soldCount} more lots needed`,
            color: soldCount >= forecast.breakEvenLots ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200',
            textColor: soldCount >= forecast.breakEvenLots ? 'text-green-700' : 'text-amber-700',
          },
          {
            label: 'Break-even Price / Lot',
            value: fmt(forecast.breakEvenRevenuePerLot),
            sub: provPricePerLot >= forecast.breakEvenRevenuePerLot
              ? `Current ${fmt(provPricePerLot)} is above B/E`
              : `Need ${fmt(forecast.breakEvenRevenuePerLot - provPricePerLot)} more / lot`,
            color: provPricePerLot >= forecast.breakEvenRevenuePerLot ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200',
            textColor: provPricePerLot >= forecast.breakEvenRevenuePerLot ? 'text-green-700' : 'text-red-700',
          },
          {
            label: 'Time to Sell Out',
            value: forecast.salesVelocityMonthsToComplete > 0
              ? `~${Math.ceil(forecast.salesVelocityMonthsToComplete)} months`
              : 'Fully sold',
            sub: `At ~${(soldCount / 6).toFixed(1)} lots/month pace`,
            color: 'bg-blue-50 border-blue-200',
            textColor: 'text-blue-700',
          },
        ].map(({ label, value, sub, color, textColor }) => (
          <div key={label} className={`rounded-xl border p-5 ${color}`}>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
            <p className="text-xs text-gray-500 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Strategic Insights */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Strategic Insights</h3>
          <button
            onClick={fetchAiAdvice}
            disabled={aiLoading}
            className="flex items-center gap-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Zap size={12} />
            {aiLoading ? 'Thinking…' : 'AI Strategic Advisor'}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {insights.map((ins, i) => (
            <InsightCard key={i} {...ins} />
          ))}
        </div>
        {aiAdvice && (
          <div className="mt-4 bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-indigo-700 mb-2 flex items-center gap-1">
              <Zap size={12} /> AI Strategic Advisor
            </p>
            <p className="text-sm text-indigo-900 leading-relaxed whitespace-pre-wrap">{aiAdvice}</p>
          </div>
        )}
      </div>

      {/* Scenario Comparison */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Scenario Analysis — Lot Price Sensitivity</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Scenario', 'Projected Revenue', 'Net Profit', 'Net Margin'].map(h => (
                  <th key={h} className="px-5 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scenarios.map(s => (
                <tr key={s.label} className={`hover:bg-gray-50 ${s.active ? 'bg-blue-50' : ''}`}>
                  <td className="px-5 py-3 font-medium">{s.label} {s.active && <span className="ml-1 text-xs text-blue-600">active</span>}</td>
                  <td className="px-5 py-3 text-right">{s.revenue}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${parseFloat(s.netProfit.replace(/[^0-9.-]/g,'')) < 0 ? 'text-red-600' : 'text-green-700'}`}>{s.netProfit}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${parseFloat(s.margin) >= 30 ? 'text-green-700' : 'text-amber-700'}`}>{s.margin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-unit metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Net Profit / Lot', value: fmt(forecast.netProfit / totalLots) },
          { label: 'Net Profit / Acre', value: p.totalAcres > 0 ? fmt(forecast.netProfit / p.totalAcres) : '—' },
          { label: 'Net Profit / Sq Ft', value: companyLots.length > 0 ? `$${(forecast.netProfit / companyLots.reduce((s,l) => s+l.sizeSqft,0)).toFixed(2)}` : '—' },
          { label: 'Land Cost / Lot', value: fmt(p.landCost / totalLots) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className="text-lg font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Consolidated comparison */}
      <CompanyComparisonPanel
        title="P&L Comparison — All Companies"
        columns={[
          { label: 'Revenue', getValue: c => c.property.saleConsideration },
          { label: 'Land Cost', getValue: c => c.property.landCost, higherIsBetter: false },
          { label: 'Net Margin', getValue: c => {
              const prop = c.property;
              const tot = prop.hardCost + prop.softCost + prop.titleCharges + prop.otherCharges
                + prop.propertyTax + prop.loanProcessing + prop.professionalCharges + prop.legalFees + prop.interestOnLoan;
              const mgmt = prop.landCost * prop.managementFeeRate;
              const comm = prop.commission ?? (prop.saleConsideration * prop.commissionRate);
              const np = prop.saleConsideration - prop.landCost - tot - mgmt - comm;
              return prop.saleConsideration > 0 ? (np / prop.saleConsideration) * 100 : 0;
            },
            format: v => `${v.toFixed(1)}%`,
          },
        ]}
      />
    </div>
  );
}
