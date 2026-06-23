import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Lot } from '../../contexts/PropertyDevContext';
import { Search } from 'lucide-react';

const STATUS_COLORS: Record<Lot['status'], string> = {
  sold: 'bg-green-100 text-green-700 border-green-200',
  contracted: 'bg-blue-100 text-blue-700 border-blue-200',
  reserved: 'bg-amber-100 text-amber-700 border-amber-200',
  available: 'bg-gray-100 text-gray-600 border-gray-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  legal_pending: 'bg-purple-100 text-purple-700 border-purple-200',
};

const STATUS_LIST: Lot['status'][] = ['available', 'reserved', 'contracted', 'sold', 'legal_pending', 'cancelled'];

export default function PD04Inventory() {
  const { lots, setLots } = usePropDev();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<Lot['status'] | 'all'>('all');
  const [blockFilter, setBlockFilter] = useState('all');

  const blocks = [...new Set(lots.map(l => l.block))].sort();

  const visible = lots.filter(l => {
    const matchQ = q === '' || l.lotNo.toLowerCase().includes(q.toLowerCase())
      || (l.buyerName ?? '').toLowerCase().includes(q.toLowerCase());
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchBlock = blockFilter === 'all' || l.block === blockFilter;
    return matchQ && matchStatus && matchBlock;
  });

  function updateStatus(id: string, status: Lot['status']) {
    setLots(lots.map(l => l.id === id ? { ...l, status } : l));
  }

  const counts: Record<string, number> = {};
  lots.forEach(l => { counts[l.status] = (counts[l.status] ?? 0) + 1; });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Lot Inventory</h2>
        <p className="text-sm text-gray-500 mt-0.5">Track status of all 27 lots — click status to update</p>
      </div>

      {/* Status pills */}
      <div className="flex flex-wrap gap-3">
        {STATUS_LIST.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              statusFilter === s ? STATUS_COLORS[s] + ' ring-2 ring-offset-1' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s.replace('_', ' ')}
            <span className="bg-white/60 px-1.5 py-0.5 rounded-full text-xs">{counts[s] ?? 0}</span>
          </button>
        ))}
        {statusFilter !== 'all' && (
          <button onClick={() => setStatusFilter('all')} className="text-xs text-blue-600 hover:underline px-2">
            Clear filter
          </button>
        )}
      </div>

      {/* Search + block filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search lot # or buyer name…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <select
          value={blockFilter}
          onChange={e => setBlockFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Blocks</option>
          {blocks.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Lot #', 'Block', 'Size (sqft)', 'List Price', 'Sale Price', 'Buyer', 'Contract Date', 'Close Date', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(lot => (
                <tr key={lot.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{lot.lotNo}</td>
                  <td className="px-4 py-3 text-gray-600">{lot.block}</td>
                  <td className="px-4 py-3">{lot.sizeSqft.toLocaleString()}</td>
                  <td className="px-4 py-3">${lot.listPrice.toLocaleString()}</td>
                  <td className="px-4 py-3 text-green-700">
                    {lot.salePrice ? `$${lot.salePrice.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lot.buyerName ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{lot.contractDate ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{lot.closeDate ?? '—'}</td>
                  <td className="px-4 py-3">
                    <select
                      value={lot.status}
                      onChange={e => updateStatus(lot.id, e.target.value as Lot['status'])}
                      className={`px-2 py-1 rounded-full text-xs font-medium border cursor-pointer focus:outline-none ${STATUS_COLORS[lot.status]}`}
                    >
                      {STATUS_LIST.map(s => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No lots match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t bg-gray-50 flex justify-between text-xs text-gray-500">
          <span>Showing {visible.length} of {lots.length} lots</span>
          <span>Available: {counts['available'] ?? 0} · Contracted: {counts['contracted'] ?? 0} · Sold: {counts['sold'] ?? 0}</span>
        </div>
      </div>
    </div>
  );
}
