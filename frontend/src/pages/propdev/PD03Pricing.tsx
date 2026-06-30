import { useState, useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Lot } from '../../contexts/PropertyDevContext';
import { AlertTriangle, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';
import { calculateBreakEven, getZone } from '../../utils/breakEvenCalculator';

const STATUS_COLORS: Record<Lot['status'], string> = {
  sold: 'bg-green-100 text-green-700',
  contracted: 'bg-blue-100 text-blue-700',
  reserved: 'bg-amber-100 text-amber-700',
  available: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
  legal_pending: 'bg-purple-100 text-purple-700',
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

function zoneColor(margin: number | null): string {
  if (margin === null) return 'bg-gray-100 text-gray-400';
  if (margin < 0)   return 'bg-red-600 text-white';
  if (margin < 10)  return 'bg-orange-300 text-orange-900';
  if (margin < 20)  return 'bg-amber-200 text-amber-800';
  return 'bg-green-100 text-green-800';
}

function lotMargin(lot: Lot, breakEvenPerLot: number, priceAdj: number): number | null {
  if (lot.status === 'sold' && lot.salePrice)
    return ((lot.salePrice - breakEvenPerLot) / lot.salePrice) * 100;
  const adj = lot.listPrice * (1 + priceAdj / 100);
  return adj > 0 ? ((adj - breakEvenPerLot) / adj) * 100 : null;
}

// ── Single company's lot heatmap cells ────────────────────────────────────────
function LotCells({ lots, breakEvenPerLot, priceAdj }: {
  lots: Lot[];
  breakEvenPerLot: number;
  priceAdj: number;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hovered = hoveredId ? lots.find(l => l.id === hoveredId) : null;

  return (
    <div className="space-y-2">
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))' }}>
        {lots.map(lot => {
          const m = lotMargin(lot, breakEvenPerLot, priceAdj);
          const adjPrice = lot.listPrice * (1 + priceAdj / 100);
          return (
            <div
              key={lot.id}
              onMouseEnter={() => setHoveredId(lot.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`relative rounded-lg p-1.5 cursor-pointer border transition-all text-center ${zoneColor(m)} ${
                hoveredId === lot.id ? 'scale-110 shadow-lg z-10' : ''
              } ${m !== null && m < 0 ? 'ring-2 ring-red-600' : ''}`}
            >
              <div className="text-xs font-bold truncate">{lot.lotNo}</div>
              <div className="text-xs">{m !== null ? `${m.toFixed(0)}%` : lot.status.slice(0, 4)}</div>

              {/* Hover tooltip */}
              {hoveredId === lot.id && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 w-48 bg-gray-900 text-white rounded-xl p-3 text-xs shadow-xl text-left pointer-events-none">
                  <p className="font-bold mb-1">Lot {lot.lotNo} — Block {lot.block}</p>
                  <p>Size: {lot.sizeSqft.toLocaleString()} sqft</p>
                  <p>List: {fmt(lot.listPrice)}{priceAdj !== 0 ? ` → ${fmt(adjPrice)}` : ''}</p>
                  <p>B/E: {fmt(breakEvenPerLot)}</p>
                  <p className={m !== null && m < 0 ? 'text-red-400 font-bold' : m !== null && m < 20 ? 'text-amber-400' : 'text-green-400'}>
                    Margin: {m !== null ? `${m.toFixed(1)}%` : 'N/A'}
                  </p>
                  <p>Status: {lot.status.replace('_', ' ')}</p>
                  {lot.salePrice && <p>Sold: {fmt(lot.salePrice)}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline tooltip for small screens / overflow */}
      {hovered && (() => {
        const m = lotMargin(hovered, breakEvenPerLot, priceAdj);
        return (
          <div className="md:hidden bg-gray-900 text-white rounded-xl p-3 text-sm space-y-0.5">
            <p className="font-bold">Lot {hovered.lotNo} — Block {hovered.block}</p>
            <p>Margin: {m !== null ? `${m.toFixed(1)}%` : 'N/A'}</p>
          </div>
        );
      })()}
    </div>
  );
}

// ── Zone legend ────────────────────────────────────────────────────────────────
function ZoneLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-600 inline-block" /> 🔴 Danger — below basic cost</span>
      <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-orange-300 inline-block" /> 🟠 Risk — 0–10%</span>
      <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-200 inline-block" /> 🟡 Caution — 10–20%</span>
      <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-100 inline-block" /> 🟢 Profit — 20%+</span>
    </div>
  );
}

// ── Per-company summary row ────────────────────────────────────────────────────
function CompanySummaryRow({ lots, breakEvenPerLot, priceAdj }: {
  lots: Lot[];
  breakEvenPerLot: number;
  priceAdj: number;
}) {
  const margins = lots.map(l => lotMargin(l, breakEvenPerLot, priceAdj)).filter((m): m is number => m !== null);
  const avgMargin = margins.length > 0 ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
  const danger   = margins.filter(m => m < 0).length;
  const risk     = margins.filter(m => m >= 0 && m < 10).length;
  const caution  = margins.filter(m => m >= 10 && m < 20).length;
  const profit   = margins.filter(m => m >= 20).length;
  const best  = margins.length > 0 ? Math.max(...margins) : null;
  const worst = margins.length > 0 ? Math.min(...margins) : null;

  return (
    <div className="flex flex-wrap gap-3 px-3 py-2 bg-gray-50 border-t border-gray-200 text-xs rounded-b-lg">
      <span><span className="text-gray-500">Avg margin:</span> <strong className={avgMargin < 20 ? 'text-amber-700' : 'text-green-700'}>{fmtPct(avgMargin)}</strong></span>
      {danger  > 0 && <span className="text-red-600 font-medium">{danger} 🔴 Danger</span>}
      {risk    > 0 && <span className="text-orange-600 font-medium">{risk} 🟠 Risk</span>}
      {caution > 0 && <span className="text-amber-600 font-medium">{caution} 🟡 Caution</span>}
      {profit  > 0 && <span className="text-green-700 font-medium">{profit} 🟢 Profit</span>}
      {best  !== null && <span><span className="text-gray-500">Best:</span> <strong className="text-green-700">{fmtPct(best)}</strong></span>}
      {worst !== null && <span><span className="text-gray-500">Worst:</span> <strong className={worst < 0 ? 'text-red-600' : 'text-amber-700'}>{fmtPct(worst)}</strong></span>}
    </div>
  );
}

// ── 3-Level Break-Even Cards ──────────────────────────────────────────────────
function BreakEvenCards({ be }: { be: ReturnType<typeof calculateBreakEven> }) {
  const [expanded, setExpanded] = useState(false);
  const cards = [
    { title: 'Basic Break-Even', subtitle: 'Direct costs only', value: be.basicBreakEven, detail: 'Land + Hard + Soft + All charges + Mgmt fee + Commission', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', badge: 'bg-red-100 text-red-700' },
    { title: 'Capitalised Break-Even', subtitle: '+ Financing costs', value: be.capitalisedBreakEven, detail: `Basic + Total interest capitalised (${fmt(be.totalInterestCapitalised)})`, bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-700' },
    { title: 'Partnership Break-Even', subtitle: '+ 8% preferred return', value: be.partnershipBreakEven, detail: `Capitalised + Min partner return ${fmt(be.minPartnerReturn)} (8% of capital)`, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-700' },
  ];
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800">Break-Even Analysis — 3 Levels</h3>
          <p className="text-xs text-gray-400 mt-0.5">Price your lots above Partnership Break-Even to cover all costs + partner return</p>
        </div>
        <button onClick={() => setExpanded(x => !x)} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {expanded ? 'Hide' : 'Show'} calculation
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-gray-100">
        {cards.map(c => (
          <div key={c.title} className={`${c.bg} p-5`}>
            <p className={`text-xs font-bold uppercase tracking-wide ${c.text} mb-1`}>{c.title}</p>
            <p className={`text-2xl font-black ${c.text}`}>{fmt(c.value)}</p>
            <p className="text-xs text-gray-500 mt-1">{c.subtitle}</p>
            <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${c.badge}`}>per lot</span>
          </div>
        ))}
      </div>
      {expanded && (
        <div className="p-5 bg-gray-50 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Calculation breakdown:</p>
          <div className="grid grid-cols-2 gap-x-8 text-xs">
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Total Direct Costs</span><span className="font-semibold">{fmt(be.directCosts)}</span></div>
              <p className="text-gray-400">(land, hard, soft, title, tax, legal, interest)</p>
              <div className="flex justify-between mt-1"><span className="text-gray-500">Management Fee</span><span className="font-semibold">{fmt(be.managementFee)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Sale Commission</span><span className="font-semibold">{fmt(be.commissionAmount)}</span></div>
              <div className="flex justify-between border-t border-gray-300 pt-1 font-bold"><span>Basic Total</span><span>{fmt(be.basicTotalCost)}</span></div>
              <div className="flex justify-between text-gray-400"><span>÷ Total Lots</span><span>= {fmt(be.basicBreakEven)}/lot</span></div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">+ Total Financing Interest</span><span className="font-semibold">{fmt(be.totalInterestCapitalised)}</span></div>
              <div className="flex justify-between border-t border-gray-300 pt-1 font-bold"><span>Capitalised Total</span><span>{fmt(be.capitalisedTotalCost)}</span></div>
              <div className="flex justify-between text-gray-400"><span>÷ lots</span><span>= {fmt(be.capitalisedBreakEven)}/lot</span></div>
              <div className="mt-2 flex justify-between"><span className="text-gray-500">+ Min Partner Return (8%)</span><span className="font-semibold">{fmt(be.minPartnerReturn)}</span></div>
              <div className="flex justify-between border-t border-gray-300 pt-1 font-bold"><span>Partnership Total</span><span>{fmt(be.partnershipTotalCost)}</span></div>
              <div className="flex justify-between text-gray-400"><span>÷ lots</span><span>= {fmt(be.partnershipBreakEven)}/lot</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PD03Pricing() {
  const { lots, setLots, properties, partners, loans, uploadHistory, selectedCompanyId, companies } = usePropDev();
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [filter, setFilter] = useState<Lot['status'] | 'all'>('all');
  const [priceAdj, setPriceAdj] = useState(0);
  const [viewMode, setViewMode] = useState<'table' | 'heatmap'>('heatmap');
  const [heatmapCompanyId, setHeatmapCompanyId] = useState<'all' | string>('all');
  const [collapsedCompanies, setCollapsedCompanies] = useState<Set<string>>(new Set());

  const p = properties[0];

  // ── Per-company break-even ─────────────────────────────────────────────────
  const companyBE = useMemo(() => {
    return companies.map(c => {
      const totalLoan = c.loans.reduce((s, l) => s + l.amount, 0);
      const avgRate   = totalLoan > 0
        ? c.loans.reduce((s, l) => s + l.interestRate * l.amount, 0) / totalLoan
        : 7.5;
      const be = calculateBreakEven({
        landCost: c.property.landCost,
        hardCost: c.property.hardCost,
        softCost: c.property.softCost,
        titleCharges: c.property.titleCharges,
        otherCharges: c.property.otherCharges,
        propertyTax: c.property.propertyTax,
        loanProcessing: c.property.loanProcessing,
        professionalCharges: c.property.professionalCharges,
        legalFees: c.property.legalFees,
        interestOnLoan: c.property.interestOnLoan,
        managementFeeRate: c.property.managementFeeRate,
        commissionRate: c.property.commissionRate,
        commission: c.property.commission,
        totalLots: c.lots.length || c.property.totalLots,
        partnerCapital: c.partners.reduce((s, x) => s + x.capitalContributed, 0),
        preferredReturnRate: 0.08,
        loanAmount: totalLoan,
        loanRatePercent: avgRate,
        loanTenureMonths: 24,
      });
      // Per-lot margins for stats
      const margins = c.lots
        .map(lot => lotMargin(lot, be.basicBreakEven, priceAdj))
        .filter((m): m is number => m !== null);
      const avgMargin    = margins.length > 0 ? margins.reduce((a, b) => a + b) / margins.length : 0;
      const profitCount  = margins.filter(m => m >= 20).length;
      const profitPct    = c.lots.length > 0 ? (profitCount / c.lots.length) * 100 : 0;
      return { company: c, be, avgMargin, profitPct, margins };
    });
  }, [companies, priceAdj]);

  // ── Current company break-even (for existing KPIs/alerts) ─────────────────
  const be = useMemo(() => {
    if (!p) return null;
    const totalLoanAmount = loans.reduce((s, l) => s + l.amount, 0);
    const avgLoanRate = loans.length > 0
      ? loans.reduce((s, l) => s + l.interestRate * l.amount, 0) / Math.max(1, totalLoanAmount)
      : 7.5;
    return calculateBreakEven({
      landCost: p.landCost, hardCost: p.hardCost, softCost: p.softCost,
      titleCharges: p.titleCharges, otherCharges: p.otherCharges, propertyTax: p.propertyTax,
      loanProcessing: p.loanProcessing, professionalCharges: p.professionalCharges,
      legalFees: p.legalFees, interestOnLoan: p.interestOnLoan,
      managementFeeRate: p.managementFeeRate, commissionRate: p.commissionRate, commission: p.commission,
      totalLots: lots.length || p.totalLots,
      partnerCapital: partners.reduce((s, x) => s + x.capitalContributed, 0),
      preferredReturnRate: 0.08, loanAmount: loans.reduce((s, l) => s + l.amount, 0),
      loanRatePercent: avgLoanRate, loanTenureMonths: 24,
    });
  }, [p, lots.length, partners, loans]);

  const basicBE   = be?.basicBreakEven ?? 0;
  const partnerBE = be?.partnershipBreakEven ?? 0;

  const visible = filter === 'all' ? lots : lots.filter(l => l.status === filter);
  const availableLots  = lots.filter(l => l.status === 'available');
  const belowPartnerBE = availableLots.filter(l => l.listPrice * (1 + priceAdj / 100) < partnerBE);
  const belowBasicBE   = availableLots.filter(l => l.listPrice * (1 + priceAdj / 100) < basicBE);

  const avgList       = lots.reduce((s, l) => s + l.listPrice, 0) / Math.max(1, lots.length);
  const reproPrice    = useMemo(() => Math.ceil(partnerBE * 1.15 / 1000) * 1000, [partnerBE]);
  const latestUpload  = uploadHistory.find(u => u.companyId === selectedCompanyId);

  function toggleCollapse(companyId: string) {
    setCollapsedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(companyId)) next.delete(companyId); else next.add(companyId);
      return next;
    });
  }

  function savePrice(id: string) {
    const val = parseFloat(editPrice.replace(/,/g, ''));
    if (!isNaN(val) && val > 0)
      setLots(lots.map(l => l.id === id ? { ...l, listPrice: val } : l));
    setEditId(null);
  }

  function applyAdjToAll() {
    setLots(lots.map(l => ({
      ...l,
      listPrice: l.status === 'available' ? Math.round(l.listPrice * (1 + priceAdj / 100)) : l.listPrice,
    })));
    setPriceAdj(0);
  }

  // Heatmap title & active company data
  const activeCompanyBE = heatmapCompanyId === 'all'
    ? null
    : companyBE.find(cb => cb.company.id === heatmapCompanyId) ?? null;

  const sortedByMargin = [...companyBE].sort((a, b) => b.avgMargin - a.avgMargin);
  const bestCompanyId  = sortedByMargin[0]?.company.id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Lot Pricing Matrix</h2>
          <p className="text-sm text-gray-500 mt-0.5">3-level break-even · Heatmap by zone · Repricing recommendations</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setViewMode('heatmap')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${viewMode === 'heatmap' ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Heatmap</button>
          <button onClick={() => setViewMode('table')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>Table</button>
        </div>
      </div>

      {latestUpload && (
        <div className="text-xs text-gray-400 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
          Data source: <strong>{latestUpload.fileName}</strong> · uploaded {new Date(latestUpload.uploadDate).toLocaleDateString()}
        </div>
      )}

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Avg List Price',    value: fmt(avgList),                                 sub: 'across all lots' },
          { label: 'Basic Break-Even',  value: be ? fmt(be.basicBreakEven) : '—',            sub: 'direct costs only' },
          { label: 'Partnership B/E',   value: be ? fmt(be.partnershipBreakEven) : '—',      sub: '+8% preferred return', color: 'text-amber-700' },
          { label: 'Below Partn. B/E',  value: `${belowPartnerBE.length}`,                   sub: `of ${availableLots.length} available`, color: belowPartnerBE.length > 0 ? 'text-red-600' : 'text-green-600' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* 3-Level Break-Even Cards */}
      {be && <BreakEvenCards be={be} />}

      {/* Zone alerts */}
      {belowBasicBE.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex gap-3">
          <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">🔴 DANGER — {belowBasicBE.length} lot{belowBasicBE.length > 1 ? 's' : ''} priced below basic cost recovery</p>
            <p className="text-sm text-red-700 mt-0.5">Lots: {belowBasicBE.map(l => l.lotNo).join(', ')} — selling below {fmt(basicBE)} means a guaranteed loss.</p>
          </div>
        </div>
      )}
      {belowPartnerBE.length > 0 && belowBasicBE.length === 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex gap-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800">🟡 CAUTION — {belowPartnerBE.length} lot{belowPartnerBE.length > 1 ? 's' : ''} below Partnership break-even</p>
            <p className="text-sm text-amber-700 mt-0.5">Partners won't receive their 8% preferred return. Minimum: {fmt(partnerBE)} per lot.</p>
          </div>
        </div>
      )}

      {/* Repricing Recommendation */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <TrendingUp size={20} className="text-blue-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-blue-800">Repricing Recommendation</p>
          <p className="text-sm text-blue-700 mt-0.5">
            Target <strong>{fmt(reproPrice)}</strong>/lot (Partnership B/E + 15% buffer). For {availableLots.length} available lots: total list value <strong>{fmt(reproPrice * availableLots.length)}</strong>.
          </p>
        </div>
      </div>

      {/* Price Adjustment Scenario Slider */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-gray-800">Price Scenario Slider</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Applying to:{' '}
              <strong className="text-gray-700">
                {heatmapCompanyId === 'all'
                  ? 'All Companies'
                  : companies.find(c => c.id === heatmapCompanyId)?.name ?? 'Selected Company'}
              </strong>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold ${priceAdj > 0 ? 'text-green-700' : priceAdj < 0 ? 'text-red-600' : 'text-gray-600'}`}>
              {priceAdj > 0 ? '+' : ''}{priceAdj}%
            </span>
            {priceAdj !== 0 && (
              <button onClick={applyAdjToAll} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                Apply to Available Lots
              </button>
            )}
          </div>
        </div>
        <input type="range" min={-20} max={20} step={1} value={priceAdj}
          onChange={e => setPriceAdj(Number(e.target.value))}
          className="w-full accent-blue-600" />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>-20% (Stressed)</span><span>0% (Base)</span><span>+20% (Optimistic)</span>
        </div>
        {priceAdj !== 0 && (
          <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Adjusted Avg Price</p>
              <p className="font-bold">{fmt(avgList * (1 + priceAdj / 100))}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Adjusted Total (avail)</p>
              <p className="font-bold">{fmt(availableLots.reduce((s, l) => s + l.listPrice, 0) * (1 + priceAdj / 100))}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Below Partnership B/E</p>
              <p className={`font-bold ${belowPartnerBE.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{belowPartnerBE.length} lots</p>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          LOT ZONE HEATMAP
      ══════════════════════════════════════════════════════════════ */}
      {viewMode === 'heatmap' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Heatmap header + company filter */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-800">
                  Lot Zone Heatmap
                  {heatmapCompanyId !== 'all' && activeCompanyBE && (
                    <span className="text-gray-500 font-normal"> — {activeCompanyBE.company.name}</span>
                  )}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {heatmapCompanyId === 'all'
                    ? `${companies.reduce((s, c) => s + c.lots.length, 0)} lots across ${companies.length} companies · colored by zone vs each company's basic break-even`
                    : activeCompanyBE
                      ? `${activeCompanyBE.company.lots.length} lots · Avg margin ${fmtPct(activeCompanyBE.avgMargin)} · B/E ${fmt(activeCompanyBE.be.basicBreakEven)}/lot`
                      : ''
                  }
                </p>
              </div>

              {/* Company selector */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500 text-xs whitespace-nowrap">Showing lots for:</span>
                <select
                  value={heatmapCompanyId}
                  onChange={e => setHeatmapCompanyId(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="all">All Companies</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Zone legend */}
            <div className="mt-3">
              <ZoneLegend />
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* ── ALL COMPANIES grouped view ───────────────────────────── */}
            {heatmapCompanyId === 'all' && companyBE.map(({ company, be: cbe, avgMargin }) => {
              const isCollapsed = collapsedCompanies.has(company.id);
              const margins = company.lots
                .map(lot => lotMargin(lot, cbe.basicBreakEven, priceAdj))
                .filter((m): m is number => m !== null);
              const profitLots = margins.filter(m => m >= 20).length;

              return (
                <div key={company.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  {/* Company group header */}
                  <button
                    onClick={() => toggleCollapse(company.id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:opacity-90 transition-opacity"
                    style={{ backgroundColor: '#1E3A8A' }}
                  >
                    <div className="flex items-center gap-3">
                      {isCollapsed
                        ? <ChevronRight size={14} className="text-green-300" />
                        : <ChevronDown  size={14} className="text-green-300" />
                      }
                      <span className="font-semibold text-white text-sm">{company.name}</span>
                      <span className="text-green-300 text-xs">({company.lots.length} lots)</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-green-200">
                        Avg margin: <strong className={avgMargin >= 20 ? 'text-green-300' : avgMargin >= 10 ? 'text-yellow-300' : 'text-red-300'}>{fmtPct(avgMargin)}</strong>
                      </span>
                      <span className="text-green-300">{profitLots}/{company.lots.length} 🟢 Profit</span>
                      <span className="text-green-400 text-xs">B/E {fmt(cbe.basicBreakEven)}/lot</span>
                    </div>
                  </button>

                  {/* Lots grid */}
                  {!isCollapsed && (
                    <div className="p-3">
                      <LotCells lots={company.lots} breakEvenPerLot={cbe.basicBreakEven} priceAdj={priceAdj} />
                    </div>
                  )}

                  {/* Summary row */}
                  {!isCollapsed && (
                    <CompanySummaryRow lots={company.lots} breakEvenPerLot={cbe.basicBreakEven} priceAdj={priceAdj} />
                  )}
                </div>
              );
            })}

            {/* ── SINGLE COMPANY view ───────────────────────────────────── */}
            {heatmapCompanyId !== 'all' && activeCompanyBE && (
              <div className="space-y-3">
                <LotCells
                  lots={activeCompanyBE.company.lots}
                  breakEvenPerLot={activeCompanyBE.be.basicBreakEven}
                  priceAdj={priceAdj}
                />
                <CompanySummaryRow
                  lots={activeCompanyBE.company.lots}
                  breakEvenPerLot={activeCompanyBE.be.basicBreakEven}
                  priceAdj={priceAdj}
                />
              </div>
            )}
          </div>

          {/* ── CROSS-COMPANY COMPARISON TABLE ───────────────────────────────── */}
          <div className="border-t border-gray-200">
            <div className="px-4 pt-4 pb-2">
              <h4 className="text-sm font-semibold text-gray-800">Cross-Company Comparison</h4>
              <p className="text-xs text-gray-400 mt-0.5">Sorted by avg margin · 🥇 best performing</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5 text-left">Company</th>
                    <th className="px-4 py-2.5 text-center">Lots</th>
                    <th className="px-4 py-2.5 text-right">Avg Margin</th>
                    <th className="px-4 py-2.5 text-right">% in Profit Zone</th>
                    <th className="px-4 py-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedByMargin.map(({ company, avgMargin, profitPct }, i) => {
                    const isBest = company.id === bestCompanyId;
                    const status = avgMargin >= 30 ? '🟢' : avgMargin >= 20 ? '🟡' : avgMargin >= 10 ? '🟠' : '🔴';
                    return (
                      <tr
                        key={company.id}
                        className={`hover:bg-gray-50 cursor-pointer ${heatmapCompanyId === company.id ? 'bg-blue-50' : ''}`}
                        onClick={() => setHeatmapCompanyId(prev => prev === company.id ? 'all' : company.id)}
                      >
                        <td className="px-4 py-2.5 font-medium text-gray-900">
                          {isBest && <span className="mr-1">🥇</span>}
                          {company.name}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-600">{company.lots.length}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          <span className={avgMargin >= 20 ? 'text-green-700' : avgMargin >= 10 ? 'text-amber-600' : 'text-red-600'}>
                            {fmtPct(avgMargin)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-20 bg-gray-200 rounded-full h-1.5">
                              <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${Math.min(profitPct, 100)}%` }} />
                            </div>
                            <span className="text-gray-700 text-xs w-8 text-right">{profitPct.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center text-lg">{status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2 text-xs text-gray-400 border-t">Click a row to filter heatmap to that company · click again to return to All Companies</p>
          </div>
        </div>
      )}

      {/* Table */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Pricing Table</h3>
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as typeof filter)}
              className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Lots</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="contracted">Contracted</option>
              <option value="sold">Sold</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  {['Lot #', 'Block', 'Size (sqft)', 'List Price', 'Basic B/E', 'Partner B/E', 'Margin %', 'Zone', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(lot => {
                  const adjPrice = lot.listPrice * (1 + priceAdj / 100);
                  const effectivePrice = lot.status === 'sold' ? (lot.salePrice ?? adjPrice) : adjPrice;
                  const m = effectivePrice > 0 ? ((effectivePrice - basicBE) / effectivePrice) * 100 : null;
                  const zone = be ? getZone(effectivePrice, be) : null;
                  return (
                    <tr key={lot.id} className={`hover:bg-gray-50 ${m !== null && m < 0 ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{lot.lotNo}</td>
                      <td className="px-4 py-3 text-right">{lot.block}</td>
                      <td className="px-4 py-3 text-right">{lot.sizeSqft.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right">
                        {editId === lot.id ? (
                          <input autoFocus
                            className="w-28 border rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={editPrice}
                            onChange={e => setEditPrice(e.target.value)}
                            onBlur={() => savePrice(lot.id)}
                            onKeyDown={e => { if (e.key === 'Enter') savePrice(lot.id); if (e.key === 'Escape') setEditId(null); }}
                          />
                        ) : (
                          <span className="cursor-pointer hover:text-blue-600 font-medium"
                            onClick={() => { setEditId(lot.id); setEditPrice(String(lot.listPrice)); }}>
                            {fmt(lot.listPrice)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">{fmt(basicBE)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">{fmt(partnerBE)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${m === null ? 'text-gray-400' : m < 0 ? 'text-red-600' : m < 15 ? 'text-amber-600' : 'text-green-700'}`}>
                          {m !== null ? `${m.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{zone && <span className="text-xs font-medium">{zone.label}</span>}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[lot.status]}`}>
                          {lot.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-1" />
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-900 text-white text-sm">
                  <td className="px-4 py-3 font-bold" colSpan={3}>TOTAL ({visible.length} lots)</td>
                  <td className="px-4 py-3 text-right font-bold">{fmt(visible.reduce((s, l) => s + l.listPrice, 0))}</td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-gray-400 border-t">Click any list price to edit · Zone = vs Partnership B/E</p>
        </div>
      )}
    </div>
  );
}
