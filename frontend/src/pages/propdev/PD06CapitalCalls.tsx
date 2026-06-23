import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { CapitalCall } from '../../contexts/PropertyDevContext';
import { Plus, X } from 'lucide-react';

const STATUS_COLORS: Record<CapitalCall['status'], string> = {
  Paid: 'bg-green-100 text-green-700',
  Partial: 'bg-amber-100 text-amber-700',
  Outstanding: 'bg-blue-100 text-blue-700',
  Overdue: 'bg-red-100 text-red-700',
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function PD06CapitalCalls() {
  const { capitalCalls, setCapitalCalls, partners } = usePropDev();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ period: '', partnerId: '', totalCallAmount: '', receivedDate: '' });

  const periods = [...new Set(capitalCalls.map(c => c.period))];

  const totalCalled = capitalCalls.reduce((s, c) => s + c.totalDue, 0);
  const totalReceived = capitalCalls.reduce((s, c) => s + c.received, 0);
  const totalOutstanding = totalCalled - totalReceived;

  function addCall() {
    const partner = partners.find(p => p.id === form.partnerId);
    if (!partner || !form.period || !form.totalCallAmount) return;
    const totalAmt = parseFloat(form.totalCallAmount.replace(/,/g, ''));
    const share = (partner.sharePercent / 100) * totalAmt;
    const newCall: CapitalCall = {
      id: `cc-${Date.now()}`,
      period: form.period,
      partnerId: partner.id,
      partnerName: partner.name,
      sharePercent: partner.sharePercent,
      totalCallAmount: totalAmt,
      partnerShare: share,
      oldDues: 0,
      totalDue: share,
      received: 0,
      receivedDate: null,
      status: 'Outstanding',
    };
    setCapitalCalls([...capitalCalls, newCall]);
    setShowModal(false);
    setForm({ period: '', partnerId: '', totalCallAmount: '', receivedDate: '' });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Capital Calls</h2>
          <p className="text-sm text-gray-500 mt-0.5">Partner capital contribution schedule and tracking</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={15} /> New Capital Call
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Called', value: fmt(totalCalled), color: 'text-gray-900' },
          { label: 'Total Received', value: fmt(totalReceived), color: 'text-green-700' },
          { label: 'Outstanding', value: fmt(totalOutstanding), color: totalOutstanding > 0 ? 'text-red-600' : 'text-gray-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Per-period tables */}
      {periods.map(period => {
        const periodCalls = capitalCalls.filter(c => c.period === period);
        const pTotal = periodCalls.reduce((s, c) => s + c.totalDue, 0);
        const pReceived = periodCalls.reduce((s, c) => s + c.received, 0);
        return (
          <div key={period} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 bg-blue-900 text-white flex justify-between items-center">
              <h3 className="font-semibold">Capital Call — {period}</h3>
              <span className="text-sm text-blue-200">
                Total: {fmt(pTotal)} · Received: {fmt(pReceived)} · Outstanding: {fmt(pTotal - pReceived)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    {['Partner', 'Share %', 'Total Call', 'Partner Share', 'Old Dues', 'Total Due', 'Received', 'Received Date', 'Balance', 'Status'].map(h => (
                      <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {periodCalls.map(c => {
                    const balance = c.totalDue - c.received;
                    return (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{c.partnerName}</td>
                        <td className="px-4 py-3 text-right">{c.sharePercent}%</td>
                        <td className="px-4 py-3 text-right">{fmt(c.totalCallAmount)}</td>
                        <td className="px-4 py-3 text-right">{fmt(c.partnerShare)}</td>
                        <td className="px-4 py-3 text-right text-orange-600">{c.oldDues > 0 ? fmt(c.oldDues) : '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmt(c.totalDue)}</td>
                        <td className="px-4 py-3 text-right text-green-700">{fmt(c.received)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{c.receivedDate ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-600">{balance > 0 ? fmt(balance) : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status]}`}>
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-900 text-white">
                    <td className="px-4 py-3 font-bold" colSpan={5}>TOTAL</td>
                    <td className="px-4 py-3 text-right font-bold">{fmt(pTotal)}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-300">{fmt(pReceived)}</td>
                    <td />
                    <td className="px-4 py-3 text-right font-bold text-red-300">{fmt(pTotal - pReceived)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}

      {/* Add Capital Call Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900">New Capital Call</h3>
              <button onClick={() => setShowModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Jan–Jun 2026" value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Partner</label>
                <select className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.partnerId} onChange={e => setForm({ ...form, partnerId: e.target.value })}>
                  <option value="">Select partner…</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sharePercent}%)</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Total Call Amount ($)</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. 145000" value={form.totalCallAmount} onChange={e => setForm({ ...form, totalCallAmount: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={addCall} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add Call</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
