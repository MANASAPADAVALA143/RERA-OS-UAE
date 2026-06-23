import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Lot } from '../../contexts/PropertyDevContext';

const STATUS_COLORS: Record<Lot['status'], string> = {
  sold: 'bg-green-100 text-green-700',
  contracted: 'bg-blue-100 text-blue-700',
  reserved: 'bg-amber-100 text-amber-700',
  available: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
  legal_pending: 'bg-purple-100 text-purple-700',
};

export default function PD03Pricing() {
  const { lots, setLots } = usePropDev();
  const [editId, setEditId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [filter, setFilter] = useState<Lot['status'] | 'all'>('all');

  const visible = filter === 'all' ? lots : lots.filter(l => l.status === filter);

  const avgList = lots.reduce((s, l) => s + l.listPrice, 0) / lots.length;
  const minList = Math.min(...lots.map(l => l.listPrice));
  const maxList = Math.max(...lots.map(l => l.listPrice));
  const totalListValue = lots.reduce((s, l) => s + l.listPrice, 0);

  function savePrice(id: string) {
    const val = parseFloat(editPrice.replace(/,/g, ''));
    if (!isNaN(val) && val > 0) {
      setLots(lots.map(l => l.id === id ? { ...l, listPrice: val } : l));
    }
    setEditId(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Lot Pricing Matrix</h2>
          <p className="text-sm text-gray-500 mt-0.5">List prices and premium adjustments per lot</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>Filter:</span>
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
            <option value="legal_pending">Legal Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Avg List Price', value: `$${Math.round(avgList).toLocaleString()}` },
          { label: 'Min Price', value: `$${minList.toLocaleString()}` },
          { label: 'Max Price', value: `$${maxList.toLocaleString()}` },
          { label: 'Total List Value', value: `$${totalListValue.toLocaleString()}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-lg font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Pricing Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Lot #', 'Block', 'Size (sqft)', 'Size (acres)', 'List Price', 'Sale Price', 'Discount', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(lot => {
                const discount = lot.salePrice ? lot.listPrice - lot.salePrice : 0;
                const discountPct = lot.salePrice
                  ? `${((discount / lot.listPrice) * 100).toFixed(1)}%`
                  : '—';
                return (
                  <tr key={lot.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{lot.lotNo}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{lot.block}</td>
                    <td className="px-4 py-3 text-right">{lot.sizeSqft.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{lot.sizeAcres}</td>
                    <td className="px-4 py-3 text-right">
                      {editId === lot.id ? (
                        <input
                          autoFocus
                          className="w-28 border rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={editPrice}
                          onChange={e => setEditPrice(e.target.value)}
                          onBlur={() => savePrice(lot.id)}
                          onKeyDown={e => { if (e.key === 'Enter') savePrice(lot.id); if (e.key === 'Escape') setEditId(null); }}
                        />
                      ) : (
                        <span
                          className="cursor-pointer hover:text-blue-600 font-medium"
                          onClick={() => { setEditId(lot.id); setEditPrice(String(lot.listPrice)); }}
                          title="Click to edit"
                        >
                          ${lot.listPrice.toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-green-700">
                      {lot.salePrice ? `$${lot.salePrice.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {discount > 0 ? `($${discount.toLocaleString()})` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[lot.status]}`}>
                        {lot.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">{discountPct}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white text-sm">
                <td className="px-4 py-3 font-bold" colSpan={4}>TOTAL ({visible.length} lots)</td>
                <td className="px-4 py-3 text-right font-bold">
                  ${visible.reduce((s, l) => s + l.listPrice, 0).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-bold text-green-300">
                  ${visible.reduce((s, l) => s + (l.salePrice ?? 0), 0).toLocaleString()}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-gray-400 border-t">Click any list price to edit inline.</p>
      </div>
    </div>
  );
}
