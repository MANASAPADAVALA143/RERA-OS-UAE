import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { ComplianceDoc } from '../../contexts/PropertyDevContext';
import { FileText, Upload, CheckCircle2, AlertCircle, Clock, XCircle, Plus, X } from 'lucide-react';

const STATUS_CONFIG: Record<ComplianceDoc['status'], { color: string; icon: typeof CheckCircle2; bg: string }> = {
  Valid: { color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle2 },
  'Expiring Soon': { color: 'text-amber-700', bg: 'bg-amber-100', icon: Clock },
  Expired: { color: 'text-red-700', bg: 'bg-red-100', icon: XCircle },
  Missing: { color: 'text-gray-600', bg: 'bg-gray-100', icon: AlertCircle },
  Pending: { color: 'text-blue-700', bg: 'bg-blue-100', icon: Clock },
};

export default function PD12Documents() {
  const { docs, setDocs } = usePropDev();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ type: '', counterparty: '', issueDate: '', expiryDate: '' });
  const [filter, setFilter] = useState<ComplianceDoc['status'] | 'all'>('all');

  const visible = filter === 'all' ? docs : docs.filter(d => d.status === filter);

  const counts = {
    Valid: docs.filter(d => d.status === 'Valid').length,
    'Expiring Soon': docs.filter(d => d.status === 'Expiring Soon').length,
    Expired: docs.filter(d => d.status === 'Expired').length,
    Missing: docs.filter(d => d.status === 'Missing').length,
    Pending: docs.filter(d => d.status === 'Pending').length,
  };

  function addDoc() {
    if (!form.type || !form.counterparty || !form.issueDate) return;
    const newDoc: ComplianceDoc = {
      id: `d-${Date.now()}`,
      type: form.type,
      property: 'Celina Ventures',
      counterparty: form.counterparty,
      issueDate: form.issueDate,
      expiryDate: form.expiryDate || null,
      status: 'Pending',
      fileUrl: null,
    };
    setDocs([...docs, newDoc]);
    setShowModal(false);
    setForm({ type: '', counterparty: '', issueDate: '', expiryDate: '' });
  }

  function updateStatus(id: string, status: ComplianceDoc['status']) {
    setDocs(docs.map(d => d.id === id ? { ...d, status } : d));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Documents & Compliance</h2>
          <p className="text-sm text-gray-500 mt-0.5">Legal, title, and regulatory document tracker</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={15} /> Add Document
        </button>
      </div>

      {/* Status Filter Pills */}
      <div className="flex flex-wrap gap-3">
        {(Object.keys(STATUS_CONFIG) as ComplianceDoc['status'][]).map(s => {
          const cfg = STATUS_CONFIG[s];
          const Icon = cfg.icon;
          return (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? 'all' : s)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                filter === s
                  ? `${cfg.bg} ${cfg.color} border-current ring-2 ring-offset-1`
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={12} />
              {s}
              <span className="bg-white/60 px-1.5 py-0.5 rounded-full">{counts[s] ?? 0}</span>
            </button>
          );
        })}
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} className="text-xs text-blue-600 hover:underline px-2">Clear</button>
        )}
      </div>

      {/* Alerts */}
      {(counts['Expired'] > 0 || counts['Expiring Soon'] > 0) && (
        <div className="space-y-2">
          {docs.filter(d => d.status === 'Expired').map(d => (
            <div key={d.id} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              <XCircle size={15} className="shrink-0" />
              <strong>{d.type}</strong> ({d.counterparty}) expired on {d.expiryDate} — renewal required
            </div>
          ))}
          {docs.filter(d => d.status === 'Expiring Soon').map(d => (
            <div key={d.id} className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <Clock size={15} className="shrink-0" />
              <strong>{d.type}</strong> ({d.counterparty}) expiring on {d.expiryDate} — action needed
            </div>
          ))}
        </div>
      )}

      {/* Documents Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                {['Document Type', 'Property', 'Counterparty', 'Issue Date', 'Expiry Date', 'Status', 'File', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(doc => {
                const cfg = STATUS_CONFIG[doc.status];
                const Icon = cfg.icon;
                return (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-gray-400 shrink-0" />
                        <span className="font-medium text-gray-900">{doc.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{doc.property}</td>
                    <td className="px-4 py-3 text-gray-600">{doc.counterparty}</td>
                    <td className="px-4 py-3 text-gray-500">{doc.issueDate}</td>
                    <td className="px-4 py-3 text-gray-500">{doc.expiryDate ?? 'No expiry'}</td>
                    <td className="px-4 py-3">
                      <select
                        value={doc.status}
                        onChange={e => updateStatus(doc.id, e.target.value as ComplianceDoc['status'])}
                        className={`px-2 py-1 rounded-full text-xs font-medium border cursor-pointer focus:outline-none ${cfg.bg} ${cfg.color}`}
                      >
                        {Object.keys(STATUS_CONFIG).map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {doc.fileUrl ? (
                        <a href={doc.fileUrl} className="text-blue-600 text-xs hover:underline">View</a>
                      ) : (
                        <span className="text-xs text-gray-400">No file</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                        <Upload size={12} /> Upload
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No documents match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t bg-gray-50 text-xs text-gray-500">
          {docs.length} documents total · {counts['Valid']} valid · {counts['Expired']} expired · {counts['Missing']} missing
        </div>
      </div>

      {/* Add Document Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900">Add Document</h3>
              <button onClick={() => setShowModal(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
            </div>
            <div className="p-5 space-y-4">
              {[
                { label: 'Document Type', key: 'type', placeholder: 'e.g. NOC - Electricity' },
                { label: 'Counterparty', key: 'counterparty', placeholder: 'e.g. Oncor Electric' },
                { label: 'Issue Date', key: 'issueDate', placeholder: '', type: 'date' },
                { label: 'Expiry Date (optional)', key: 'expiryDate', placeholder: '', type: 'date' },
              ].map(({ label, key, placeholder, type = 'text' }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm({ ...form, [key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={addDoc} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add Document</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
