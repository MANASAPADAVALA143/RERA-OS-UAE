import { useState } from 'react';
import { useRentalPortfolio } from '../contexts/RentalPortfolioContext';

type Status = 'Pending' | 'In Progress' | 'Filed' | 'Paid';

interface ComplianceItem {
  id: number;
  obligation: string;
  due_date: string;
  scope: string;
  status: Status;
}

const STATUS_COLORS: Record<Status, string> = {
  'Pending':     'bg-gray-100 text-gray-700',
  'In Progress': 'bg-amber-100 text-amber-800',
  'Filed':       'bg-green-100 text-green-800',
  'Paid':        'bg-green-100 text-green-800',
};

const INITIAL_ITEMS: ComplianceItem[] = [
  { id: 1, obligation: 'Federal return Form 1065 + K-1s (or Sch E if disregarded)', due_date: 'Mar 15 / Apr 15', scope: 'Per EIN',      status: 'Pending' },
  { id: 2, obligation: 'Texas Franchise Tax + Public Information Report',            due_date: 'May 15',          scope: 'Per EIN',      status: 'Pending' },
  { id: 3, obligation: '1099-NEC / 1099-MISC to vendors',                           due_date: 'Jan 31',          scope: 'Per EIN',      status: 'Pending' },
  { id: 4, obligation: 'County property tax payment',                                due_date: 'Jan 31',          scope: 'Per property', status: 'Pending' },
  { id: 5, obligation: 'Business personal property rendition / protest',             due_date: 'Apr 15 / May 15', scope: 'Per property', status: 'Pending' },
  { id: 6, obligation: 'Form 1040 + Schedule E',                                    due_date: 'Apr 15',          scope: 'Couple',       status: 'Pending' },
  { id: 7, obligation: 'Federal estimated taxes',                                    due_date: 'Apr / Jun / Sep / Jan', scope: 'Couple', status: 'Pending' },
  { id: 8, obligation: 'Community-property / QJV election review',                  due_date: 'Annual',          scope: 'Per EIN',      status: 'Pending' },
];

const STRUCTURE_NOTES = [
  'Community property election (Rev. Proc. 2002-69) — disregarded entity / QJV → Schedule E filing.',
  'Separate EINs = separate ledgers, AR/AP sub-ledgers, franchise reports — maintain strict separation.',
  '1099 discipline — $600 threshold applies per payer entity, not across the portfolio.',
  'No Texas state income tax, but franchise tax + county property tax apply to each entity.',
  'Collections watch — entities 15%+ past due listed below; issue cure / pay-or-quit notices promptly.',
];

export default function RentalCompliance() {
  const [items, setItems] = useState<ComplianceItem[]>(INITIAL_ITEMS);
  const { portfolio } = useRentalPortfolio();

  function updateStatus(id: number, status: Status) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  }

  // Collections alert from AR data
  const flaggedEntities = portfolio.arAp.filter(r => {
    const arTotal = r.ar_current + r.ar_1_30 + r.ar_31_60 + r.ar_61_90 + r.ar_90_plus;
    const pastDue31 = r.ar_31_60 + r.ar_61_90 + r.ar_90_plus;
    return arTotal > 0 && pastDue31 / arTotal > 0.15;
  });

  const pending = items.filter(i => i.status === 'Pending').length;
  const inProgress = items.filter(i => i.status === 'In Progress').length;
  const complete = items.filter(i => i.status === 'Filed' || i.status === 'Paid').length;

  return (
    <div className="space-y-8 max-w-5xl" style={{ fontFamily: 'Georgia, serif' }}>
      <div>
        <p className="text-xs uppercase tracking-wider font-sans" style={{ color: '#7C3AED' }}>Compliance</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Texas Rental Portfolio</h1>
        <p className="text-sm text-gray-400 font-sans mt-1">Annual compliance obligations — update status as items are completed</p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-4 font-sans">
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
          <p className="text-xs text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-gray-700 font-mono mt-1">{pending}</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
          <p className="text-xs text-amber-700">In Progress</p>
          <p className="text-2xl font-bold text-amber-700 font-mono mt-1">{inProgress}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-200">
          <p className="text-xs text-green-800">Filed / Paid</p>
          <p className="text-2xl font-bold text-green-800 font-mono mt-1">{complete}</p>
        </div>
      </div>

      {/* Compliance table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="bg-gray-900 text-white text-xs">
              <th className="px-4 py-3 text-left">Obligation</th>
              <th className="px-4 py-3 text-left whitespace-nowrap">Due Date</th>
              <th className="px-4 py-3 text-left">Scope</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-4 py-3 text-gray-800">{item.obligation}</td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">{item.due_date}</td>
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{item.scope}</td>
                <td className="px-4 py-3">
                  <select
                    value={item.status}
                    onChange={e => updateStatus(item.id, e.target.value as Status)}
                    className={`text-xs font-medium rounded-full px-3 py-1 border-0 cursor-pointer ${STATUS_COLORS[item.status]}`}
                  >
                    {(['Pending', 'In Progress', 'Filed', 'Paid'] as Status[]).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Collections watch */}
      {flaggedEntities.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 font-sans">
          <p className="text-sm font-bold text-red-800 mb-2">Collections Watch — 15%+ Past Due</p>
          <ul className="space-y-1">
            {flaggedEntities.map(r => (
              <li key={r.entity_name} className="text-sm text-red-700">
                <span className="font-medium">{r.entity_name}</span> — issue cure notice / pay-or-quit
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Structure notes */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 font-sans">
        <p className="text-sm font-bold text-amber-900 mb-3">Structure Notes</p>
        <ul className="space-y-2">
          {STRUCTURE_NOTES.map((note, i) => (
            <li key={i} className="flex gap-2 text-sm text-amber-800">
              <span className="shrink-0 text-amber-500 mt-0.5">•</span>
              {note}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-gray-400 font-sans italic">
        Static reference content — not live data. Consult a licensed CPA or tax attorney for advice specific to your entities.
      </p>
    </div>
  );
}
