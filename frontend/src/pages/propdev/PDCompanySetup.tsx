import { useState, useEffect } from 'react';
import { Building2, Plus, Trash2, Check, X, AlertCircle, Upload } from 'lucide-react';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import api from '../../services/api';

interface CompanyRow {
  id: string;
  name: string;
  propertyName: string;
  totalLots: number;
  hasData: boolean;
}

export default function PDCompanySetup() {
  const { setTab } = usePropDevNav();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProperty, setNewProperty] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadCompanies() {
    try {
      const res = await api.get('/api/propdev/companies');
      const data = res.data;
      setCompanies(data.companies.map((c: any) => ({
        id: c.id,
        name: c.name,
        propertyName: c.property_name || '',
        totalLots: c.total_lots || 0,
        hasData: (c.sale_consideration || 0) > 0 || (c.total_lots || 0) > 0,
      })));
    } catch {
      setError('Failed to load companies');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCompanies(); }, []);

  async function handleAdd() {
    if (!newName.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/api/propdev/companies', { name: newName.trim(), property_name: newProperty.trim() });
      setNewName('');
      setNewProperty('');
      setAdding(false);
      setSuccess('Company added');
      setTimeout(() => setSuccess(''), 2000);
      await loadCompanies();
    } catch {
      setError('Failed to add company');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}" and all its data?`)) return;
    setError('');
    try {
      await api.delete(`/api/propdev/companies/${id}`);
      setSuccess('Deleted');
      setTimeout(() => setSuccess(''), 2000);
      await loadCompanies();
    } catch {
      setError('Failed to delete company');
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Company Registry</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Add all your company names here first, then upload the master Excel to link financial data.
          </p>
        </div>
        <button
          onClick={() => { setAdding(true); setError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
        >
          <Plus size={16} /> Add Company
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle size={15} className="shrink-0" /> {error}
          <button onClick={() => setError('')} className="ml-auto"><X size={14} /></button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <Check size={15} className="shrink-0" /> {success}
        </div>
      )}

      {/* Add row inline */}
      {adding && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <Building2 size={18} className="text-blue-600 shrink-0" />
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Company name (e.g. Sunstone Land Group LLC)"
            className="flex-1 px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          />
          <input
            value={newProperty}
            onChange={e => setNewProperty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Property name (optional)"
            className="w-52 px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            <Check size={15} /> Save
          </button>
          <button
            onClick={() => { setAdding(false); setNewName(''); setNewProperty(''); }}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Companies Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Company Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Property</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Lots</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Status</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">Del</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">Loading companies...</td>
              </tr>
            ) : companies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Building2 size={28} className="text-gray-300" />
                    <p className="text-gray-400 text-sm">No companies yet. Click "Add Company" to register your first company.</p>
                  </div>
                </td>
              </tr>
            ) : (
              companies.map((c, i) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-400">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-gray-400 shrink-0" />
                      <span className="font-medium text-gray-900 text-sm">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.propertyName || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700 font-medium">
                    {c.totalLots > 0 ? c.totalLots.toLocaleString() : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.hasData ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-green-100 text-green-700 rounded-full font-medium">
                        <Check size={11} /> Linked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-amber-50 text-amber-600 rounded-full border border-amber-200">
                        Awaiting Excel
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(c.id, c.name)}
                      className="p-1.5 text-red-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete company"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {companies.length > 0 && (
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={3} className="px-4 py-2 text-xs text-gray-400">
                  {companies.length} compan{companies.length === 1 ? 'y' : 'ies'} registered
                </td>
                <td className="px-4 py-2 text-xs text-right font-medium text-gray-600">
                  {companies.reduce((s, c) => s + c.totalLots, 0).toLocaleString()} total lots
                </td>
                <td colSpan={2} className="px-4 py-2 text-xs text-right text-gray-400">
                  {companies.filter(c => c.hasData).length} linked · {companies.filter(c => !c.hasData).length} pending
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Instruction card */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
        <h3 className="font-semibold text-blue-900 text-sm mb-2">How it works</h3>
        <ol className="space-y-1.5 text-sm text-blue-800">
          <li className="flex items-start gap-2">
            <span className="font-bold text-blue-500 shrink-0">1.</span>
            Add all 12 company names above (exact match with your Excel file names).
          </li>
          <li className="flex items-start gap-2">
            <span className="font-bold text-blue-500 shrink-0">2.</span>
            Go to Upload Data and upload the master Excel file.
          </li>
          <li className="flex items-start gap-2">
            <span className="font-bold text-blue-500 shrink-0">3.</span>
            The system matches company names and links all financial data automatically.
          </li>
        </ol>
        <button
          onClick={() => setTab('upload')}
          className="mt-4 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
        >
          <Upload size={14} /> Go to Upload Data
        </button>
      </div>
    </div>
  );
}
