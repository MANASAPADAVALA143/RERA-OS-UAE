import { useState, useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Lot } from '../../contexts/PropertyDevContext';
import { AlertTriangle, TrendingUp } from 'lucide-react';

const STATUS_COLORS: Record<Lot['status'], string> = {
  sold: 'bg-green-100 text-green-700',
  contracted: 'bg-blue-100 text-blue-700',
  reserved: 'bg-amber-100 text-amber-700',
  available: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
  legal_pending: 'bg-purple-100 text-purple-700',
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

// ── Heatmap cell color based on margin % ───────────────────────────────────

function marginColor(margin: number | null): string {
  if (margin === null) return 'bg-gray-100 text-gray-400';
  if (margin < 0)  return 'bg-red-600 text-white';
  if (margin < 10) return 'bg-red-200 text-red-800';
  if (margin < 20) return 'bg-amber-200 text-amber-800';
  if (margin < 30) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}

// ── Lot Heatmap ─────────────────────────────────────────────────────────────

function LotHeatmap({ lots, breakEvenPerLot, priceAdj }: {
  lots: Lot[];
  breakEvenPerLot: number;
  priceAdj: number;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hovered = hoveredId ? lots.find(l => l.id === hoveredId) : null;

  const adjustedPrice = (lot: Lot) => lot.listPrice * (1 + priceAdj / 100);
  const margin = (lot: Lot) => {
    if (lot.status === 'sold' && lot.salePrice) {
      return ((lot.salePrice - breakEvenPerLot) / lot.salePrice) * 100;
    }
    const adj = adjustedPrice(lot);
    return adj > 0 ? ((adj - breakEvenPerLot) / adj) * 100 : null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-600 inline-block" /> Below break-even</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-red-200 inline-block" /> 0–10% margin</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-amber-200 inline-block" /> 10–20%</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-yellow-100 inline-block" /> 20–30%</span>
        <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-green-100 inline-block" /> 30%+</span>
      </div>

      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))' }}>
        {lots.map(lot => {
          const m = margin(lot);
          const isBelow = m !== null && m < 0;
          return (
            <div
              key={lot.id}
              onMouseEnter={() => setHoveredId(lot.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`relative rounded-lg p-1.5 cursor-pointer border transition-all text-center ${marginColor(m)} ${
                hoveredId === lot.id ? 'scale-110 shadow-lg z-10' : ''
              } ${isBelow ? 'ring-2 ring-red-600' : ''}`}
            >
              <div className="text-xs font-bold truncate">{lot.lotNo}</div>
              <div className="text-xs">{m !== null ? `${m.toFixed(0)}%` : lot.status.slice(0,4)}</div>
            </div>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hovered && (() => {
        const m = margin(hovered);
        const adjPrice = adjustedPrice(hovered);
        return (
          <div className="bg-gray-900 text-white rounded-xl p-4 text-sm space-y-1">
            <p className="font-bold">Lot {hovered.lotNo} — Block {hovered.block}</p>
            <p>Size: {hovered.sizeSqft.toLocaleString()} sqft</p>
            <p>List Price: {fmt(hovered.listPrice)}{priceAdj !== 0 ? ` → ${fmt(adjPrice)} (adjusted)` : ''}</p>
            <p>Break-even: {fmt(breakEvenPerLot)}</p>
            <p className={m !== null && m < 0 ? 'text-red-400 font-bold' : 'text-green-400'}>
              Margin: {m !== null ? `${m.toFixed(1)}%` : 'N/A'}
            </p>
            <p>Status: {hovered.status}</p>
            {hovered.salePrice && <p>Sold for: {fmt(hovered.salePrice)}</p>}
          </div>
        );
      })()}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function PD03Pricing() {
  const { lots, setLots, properties } = usePropDev();
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [filter, setFilter] = useState<Lot['status'] | 'all'>('all');
  const [priceAdj, setPriceAdj] = useState(0);
  const [viewMode, setViewMode] = useState<'table' | 'heatmap'>('heatmap');

  const p = properties[0];
  const totalCost = p
    ? p.landCost + p.hardCost + p.softCost + p.titleCharges + p.otherCharges +
      p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan
    : 0;
  const breakEvenPerLot = lots.length > 0 ? totalCost / lots.length : 0;
  const managementFee = p ? p.saleConsideration * 0.09 : 0;
  const commission = p ? p.saleConsideration * 0.045 : 0;
  const fullBreakEvenPerLot = lots.length > 0
    ? (totalCost + managementFee + commission) / lots.length
    : 0;

  const visible = filter === 'all' ? lots : lots.filter(l => l.status === filter);
  const availableLots = lots.filter(l => l.status === 'available');
  const belowBreakEven = availableLots.filter(l => l.listPrice * (1 + priceAdj / 100) < fullBreakEvenPerLot);

  const avgList = lots.reduce((s, l) => s + l.listPrice, 0) / Math.max(1, lots.length);
  const totalListValue = lots.reduce((s, l) => s + l.listPrice, 0);

  const reproPrice = useMemo(() => {
    return Math.ceil(fullBreakEvenPerLot * 1.25 / 1000) * 1000;
  }, [fullBreakEvenPerLot]);

  function savePrice(id: string) {
    const val = parseFloat(editPrice.replace(/,/g, ''));
    if (!isNaN(val) && val > 0) {
      setLots(lots.map(l => l.id === id ? { ...l, listPrice: val } : l));
    }
    setEditId(null);
  }

  function applyAdjToAll() {
    setLots(lots.map(l => ({
      ...l,
      listPrice: l.status === 'available' ? Math.round(l.listPrice * (1 + priceAdj / 100)) : l.listPrice,
    })));
    setPriceAdj(0);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Lot Pricing Matrix</h2>
          <p className="text-sm text-gray-500 mt-0.5">Heatmap, break-even analysis and repricing recommendations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('heatmap')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${viewMode === 'heatmap' ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Heatmap
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Table
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Avg List Price',   value: fmt(avgList),             sub: 'across all lots'              },
          { label: 'Break-Even / Lot', value: fmt(fullBreakEvenPerLot), sub: 'incl. fees & commissions'     },
          { label: 'Below Break-Even', value: `${belowBreakEven.length}`, sub: `of ${availableLots.length} available lots`, color: belowBreakEven.length > 0 ? 'text-red-600' : 'text-green-600' },
          { label: 'Total List Value', value: fmt(totalListValue),       sub: `${lots.length} lots`          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Below break-even alert */}
      {belowBreakEven.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex gap-3">
          <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800">
              {belowBreakEven.length} lot{belowBreakEven.length > 1 ? 's' : ''} priced below break-even at current scenario
            </p>
            <p className="text-sm text-red-700 mt-0.5">
              Lots: {belowBreakEven.map(l => l.lotNo).join(', ')} — minimum viable price is {fmt(fullBreakEvenPerLot)} per lot.
            </p>
          </div>
        </div>
      )}

      {/* Repricing Recommendation */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <TrendingUp size={20} className="text-blue-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-blue-800">Repricing Recommendation</p>
          <p className="text-sm text-blue-700 mt-0.5">
            Target price of <strong>{fmt(reproPrice)}</strong> per lot achieves a 25% gross margin above break-even cost.
            For {availableLots.length} available lots, this represents total list value of <strong>{fmt(reproPrice * availableLots.length)}</strong>.
          </p>
        </div>
      </div>

      {/* Price Adjustment Scenario Slider */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Price Scenario Slider</h3>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold ${priceAdj > 0 ? 'text-green-700' : priceAdj < 0 ? 'text-red-600' : 'text-gray-600'}`}>
              {priceAdj > 0 ? '+' : ''}{priceAdj}%
            </span>
            {priceAdj !== 0 && (
              <button onClick={applyAdjToAll}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                Apply to Available Lots
              </button>
            )}
          </div>
        </div>
        <input
          type="range" min={-20} max={20} step={1} value={priceAdj}
          onChange={e => setPriceAdj(Number(e.target.value))}
          className="w-full accent-blue-600"
        />
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
              <p className="font-bold">{fmt(availableLots.reduce((s,l)=>s+l.listPrice,0) * (1 + priceAdj / 100))}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">Below Break-Even</p>
              <p className={`font-bold ${belowBreakEven.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {belowBreakEven.length} lots
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Heatmap */}
      {viewMode === 'heatmap' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Lot Margin Heatmap</h3>
          <LotHeatmap lots={lots} breakEvenPerLot={fullBreakEvenPerLot} priceAdj={priceAdj} />
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
                  {['Lot #', 'Block', 'Size (sqft)', 'List Price', 'Break-Even', 'Margin %', 'Sale Price', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(lot => {
                  const adjPrice = lot.listPrice * (1 + priceAdj / 100);
                  const effectivePrice = lot.status === 'sold' ? (lot.salePrice ?? adjPrice) : adjPrice;
                  const m = effectivePrice > 0 ? ((effectivePrice - fullBreakEvenPerLot) / effectivePrice) * 100 : null;
                  const isAlert = m !== null && m < 0;
                  return (
                    <tr key={lot.id} className={`hover:bg-gray-50 ${isAlert ? 'bg-red-50' : ''}`}>
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
                      <td className="px-4 py-3 text-right text-gray-500">{fmt(fullBreakEvenPerLot)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${isAlert ? 'text-red-600' : m !== null && m < 20 ? 'text-amber-600' : 'text-green-700'}`}>
                          {m !== null ? `${m.toFixed(1)}%` : '—'}
                        </span>
                        {isAlert && <AlertTriangle size={12} className="inline-block ml-1 text-red-600" />}
                      </td>
                      <td className="px-4 py-3 text-right text-green-700">
                        {lot.salePrice ? fmt(lot.salePrice) : '—'}
                      </td>
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
                  <td className="px-4 py-3 text-right font-bold">{fmt(visible.reduce((s,l)=>s+l.listPrice,0))}</td>
                  <td className="px-4 py-3 text-right">{fmt(fullBreakEvenPerLot * visible.length)}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-gray-400 border-t">Click any list price to edit inline · Red = below break-even</p>
        </div>
      )}
    </div>
  );
}
