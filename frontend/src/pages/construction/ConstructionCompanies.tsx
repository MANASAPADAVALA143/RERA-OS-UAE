import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, HardHat } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

interface ConstructionCo {
  id: string;
  company_name: string;
  project_name: string | null;
  project_type: string | null;
  contract_value: number;
  start_date: string | null;
  end_date: string | null;
  status: string;
}

const PROJECT_TYPES = ['Residential', 'Commercial', 'Infrastructure', 'Industrial'];

interface Toast { id: number; msg: string; ok: boolean }
let _tid = 0;

export default function ConstructionCompanies() {
  const { canWrite } = useAuth();
  const [companies, setCompanies] = useState<ConstructionCo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ConstructionCo | null>(null);
  const [form, setForm] = useState({ company_name: '', project_name: '', project_type: '', contract_value: '', start_date: '', end_date: '' });
  const [saving, setSaving] = useState(false);

  // Inline rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState('');

  function push(msg: string, ok = true) {
    const id = ++_tid;
    setToasts(p => [...p, { id, msg, ok }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<ConstructionCo[]>('/api/real-estate/construction/companies');
      setCompanies(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load construction companies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openAdd() {
    setEditing(null);
    setForm({ company_name: '', project_name: '', project_type: '', contract_value: '', start_date: '', end_date: '' });
    setShowModal(true);
  }

  function openEdit(c: ConstructionCo) {
    setEditing(c);
    setForm({
      company_name: c.company_name,
      project_name: c.project_name ?? '',
      project_type: c.project_type ?? '',
      contract_value: c.contract_value ? String(c.contract_value) : '',
      start_date: c.start_date ?? '',
      end_date: c.end_date ?? '',
    });
    setShowModal(true);
  }

  function closeModal() { setShowModal(false); setEditing(null); setSaving(false); }

  async function handleSave() {
    if (!form.company_name.trim()) return;
    setSaving(true);
    const payload = {
      company_name: form.company_name.trim(),
      project_name: form.project_name.trim() || undefined,
      project_type: form.project_type || undefined,
      contract_value: form.contract_value ? Number(form.contract_value) : undefined,
      start_date: form.start_date || undefined,
      end_date: form.end_date || undefined,
    };
    try {
      if (editing) {
        await api.put(`/api/real-estate/construction/companies/${editing.id}`, payload);
        push('Company updated');
      } else {
        await api.post('/api/real-estate/construction/companies', payload);
        push('Company added');
      }
      closeModal();
      load();
    } catch {
      push('Failed to save company', false);
      setSaving(false);
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    try {
      await api.put(`/api/real-estate/construction/companies/${id}`, { company_name: editName.trim() });
      setEditingId(null);
      push('Company renamed');
      load();
    } catch {
      push('Failed to rename', false);
    }
  }

  async function handleDelete() {
    if (!deletingId) return;
    try {
      await api.delete(`/api/real-estate/construction/companies/${deletingId}`);
      setDeletingId(null);
      push('Company deleted');
      load();
    } catch {
      push('Failed to delete', false);
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Construction Companies</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage construction firms and projects</p>
        </div>
        {canWrite && (
          <button onClick={openAdd}
            className="flex items-center gap-2 bg-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">
            <Plus size={14} /> Add Company
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          </div>
        ) : companies.length === 0 ? (
          <div className="text-center py-20">
            <HardHat size={36} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No construction companies yet.</p>
            {canWrite && (
              <button onClick={openAdd}
                className="mt-4 text-sm bg-primary text-white px-4 py-2 rounded-lg hover:bg-primary/90">
                + Add Company
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Company Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Project</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Type</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Contract Value</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">End Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  {canWrite && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {companies.map((c, i) => (
                  <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {editingId === c.id ? (
                        <div className="flex items-center gap-1">
                          <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(c.id); if (e.key === 'Escape') setEditingId(null); }}
                            className="text-sm border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                          <button onClick={() => handleRename(c.id)} className="text-blue-600"><Check size={13} /></button>
                          <button onClick={() => setEditingId(null)} className="text-gray-400"><X size={13} /></button>
                        </div>
                      ) : (
                        <span className="cursor-pointer hover:text-blue-600 transition-colors"
                          title="Double-click to rename"
                          onDoubleClick={() => { setEditingId(c.id); setEditName(c.company_name); }}>
                          {c.company_name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.project_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.project_type || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-700 font-mono">
                      {c.contract_value ? `$${Number(c.contract_value).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.end_date || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium
                        ${(c.status ?? 'active') === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.status === 'inactive' ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(c)}
                            className="p-1.5 text-gray-400 hover:text-primary hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => { setDeletingId(c.id); setDeletingName(c.company_name); }}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
             onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-800">{editing ? 'Edit Company' : 'Add Construction Company'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-3 overflow-y-auto">
              {[
                { name: 'company_name', label: 'Company Name', required: true, type: 'text', placeholder: 'e.g. Apex Builders LLC' },
                { name: 'project_name', label: 'Project Name', type: 'text', placeholder: 'e.g. Downtown Tower Phase 1' },
                { name: 'contract_value', label: 'Contract Value ($)', type: 'number', placeholder: '0' },
                { name: 'start_date', label: 'Start Date', type: 'date', placeholder: '' },
                { name: 'end_date', label: 'End Date', type: 'date', placeholder: '' },
              ].map(f => (
                <div key={f.name}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <input
                    type={f.type}
                    value={form[f.name as keyof typeof form]}
                    onChange={e => setForm(p => ({ ...p, [f.name]: e.target.value }))}
                    placeholder={f.placeholder}
                    autoFocus={f.name === 'company_name'}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Project Type</label>
                <select value={form.project_type} onChange={e => setForm(p => ({ ...p, project_type: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Select…</option>
                  {PROJECT_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-5 flex-shrink-0">
              <button onClick={closeModal}
                className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.company_name.trim()}
                className="flex-1 flex items-center justify-center gap-2 text-sm bg-primary text-white py-2.5 rounded-xl hover:bg-primary/90 font-medium disabled:opacity-50">
                {saving ? 'Saving…' : <><Check size={14} />{editing ? 'Save Changes' : 'Add Company'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <p className="text-sm text-gray-600 mb-1">Delete <span className="font-semibold">"{deletingName}"</span>?</p>
            <p className="text-xs text-red-500 mb-5">This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingId(null)}
                className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete}
                className="flex-1 text-sm bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 font-medium">Yes, Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 space-y-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm text-white font-medium pointer-events-auto
              ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}>
            {t.ok ? <Check size={14} /> : <X size={14} />} {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
