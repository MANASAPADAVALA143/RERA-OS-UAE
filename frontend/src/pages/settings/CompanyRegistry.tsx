import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X, Check, Building2, Home } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// ── types ─────────────────────────────────────────────────────────────────────

interface RentalCo {
  id: string;
  company_name: string;
}

interface PropDevCo {
  id: string;
  name: string;
  property_name: string;
}

type Module = 'rental' | 'propdev';

interface Toast {
  id: number;
  msg: string;
  ok: boolean;
}

// ── small toast ───────────────────────────────────────────────────────────────

let _toastId = 0;

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((msg: string, ok = true) => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, msg, ok }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  return { toasts, push };
}

// ── modal ─────────────────────────────────────────────────────────────────────

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

function Modal({ title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── confirmation dialog ───────────────────────────────────────────────────────

interface ConfirmProps {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDelete({ name, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Modal title="Delete Company" onClose={onCancel}>
      <p className="text-sm text-gray-600 mb-5">
        Delete <span className="font-semibold text-gray-800">"{name}"</span> and all its data?
        This cannot be undone.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700"
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

// ── rental companies tab ──────────────────────────────────────────────────────

function RentalTab({ push }: { push: (msg: string, ok?: boolean) => void }) {
  const { canWrite } = useAuth();
  const [companies, setCompanies] = useState<RentalCo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'add' | 'edit' | 'delete' | null>(null);
  const [target, setTarget] = useState<RentalCo | null>(null);
  const [formName, setFormName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<RentalCo[]>('/api/rentals/companies');
      setCompanies(res.data.map(c => ({ id: c.id, company_name: (c as { company_name: string }).company_name ?? (c as unknown as { name: string }).name })));
    } catch {
      push('Failed to load rental companies', false);
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setFormName(''); setModal('add'); }
  function openEdit(c: RentalCo) { setTarget(c); setFormName(c.company_name); setModal('edit'); }
  function openDelete(c: RentalCo) { setTarget(c); setModal('delete'); }
  function close() { setModal(null); setTarget(null); setSaving(false); }

  async function handleAdd() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/rentals/companies', { company_name: formName.trim() });
      push('Company added');
      close();
      load();
    } catch {
      push('Failed to add company', false);
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!target || !formName.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/rentals/companies/${target.id}`, { company_name: formName.trim() });
      push('Company updated');
      close();
      load();
    } catch {
      push('Failed to update company', false);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!target) return;
    try {
      await api.delete(`/api/rentals/companies/${target.id}`);
      push('Company deleted');
      close();
      load();
    } catch {
      push('Failed to delete company', false);
      close();
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{companies.length} companies</p>
        {canWrite && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} /> Add Company
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No rental companies yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Company Name</th>
                {canWrite && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {companies.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{c.company_name}</td>
                  {canWrite && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                          title="Rename"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => openDelete(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
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

      {modal === 'add' && (
        <Modal title="Add Rental Company" onClose={close}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                autoFocus
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="e.g. ABC LLC"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={close} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleAdd}
                disabled={saving || !formName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Adding…' : <><Check size={14} /> Add</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'edit' && target && (
        <Modal title="Rename Company" onClose={close}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                autoFocus
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEdit()}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={close} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleEdit}
                disabled={saving || !formName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : <><Check size={14} /> Save</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'delete' && target && (
        <ConfirmDelete name={target.company_name} onConfirm={handleDelete} onCancel={close} />
      )}
    </>
  );
}

// ── propdev companies tab ─────────────────────────────────────────────────────

interface PropDevListResponse {
  companies: PropDevCo[];
}

function PropDevTab({ push }: { push: (msg: string, ok?: boolean) => void }) {
  const { canWrite } = useAuth();
  const [companies, setCompanies] = useState<PropDevCo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'add' | 'edit' | 'delete' | null>(null);
  const [target, setTarget] = useState<PropDevCo | null>(null);
  const [formName, setFormName] = useState('');
  const [formProp, setFormProp] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PropDevListResponse>('/api/propdev/companies');
      const list = res.data.companies ?? [];
      setCompanies(list.map(c => ({ id: c.id, name: c.name, property_name: c.property_name })));
    } catch {
      push('Failed to load PropDev companies', false);
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => { load(); }, [load]);

  function openAdd() { setFormName(''); setFormProp(''); setModal('add'); }
  function openEdit(c: PropDevCo) { setTarget(c); setFormName(c.name); setFormProp(c.property_name ?? ''); setModal('edit'); }
  function openDelete(c: PropDevCo) { setTarget(c); setModal('delete'); }
  function close() { setModal(null); setTarget(null); setSaving(false); }

  async function handleAdd() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/propdev/companies', { name: formName.trim(), property_name: formProp.trim() });
      push('Company added');
      close();
      load();
    } catch {
      push('Failed to add company', false);
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!target || !formName.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/propdev/companies/${target.id}`, { name: formName.trim(), property_name: formProp.trim() });
      push('Company updated');
      close();
      load();
    } catch {
      push('Failed to update company', false);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!target) return;
    try {
      await api.delete(`/api/propdev/companies/${target.id}`);
      push('Company deleted');
      close();
      load();
    } catch {
      push('Failed to delete company', false);
      close();
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{companies.length} companies</p>
        {canWrite && (
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} /> Add Company
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No PropDev companies yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Company Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Property</th>
                {canWrite && <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {companies.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                  <td className="px-4 py-3 text-gray-500">{c.property_name || '—'}</td>
                  {canWrite && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => openDelete(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
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

      {modal === 'add' && (
        <Modal title="Add PropDev Company" onClose={close}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                autoFocus
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="e.g. Horizon Dev LLC"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Property Name <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                type="text"
                value={formProp}
                onChange={e => setFormProp(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="e.g. Sunset Acres Phase 1"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={close} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleAdd}
                disabled={saving || !formName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Adding…' : <><Check size={14} /> Add</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'edit' && target && (
        <Modal title="Edit Company" onClose={close}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                autoFocus
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Property Name</label>
              <input
                type="text"
                value={formProp}
                onChange={e => setFormProp(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEdit()}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={close} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleEdit}
                disabled={saving || !formName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : <><Check size={14} /> Save</>}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === 'delete' && target && (
        <ConfirmDelete name={target.name} onConfirm={handleDelete} onCancel={close} />
      )}
    </>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

const TABS: { id: Module; label: string; icon: typeof Building2 }[] = [
  { id: 'rental',  label: 'Rental & Lease',      icon: Home     },
  { id: 'propdev', label: 'Property Development', icon: Building2 },
];

export default function CompanyRegistry() {
  const [activeTab, setActiveTab] = useState<Module>('rental');
  const { toasts, push } = useToast();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Company Registry</h1>
        <p className="text-sm text-gray-500 mt-1">Add, rename, or remove companies across modules.</p>
      </div>

      {/* Module tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-charcoal'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {activeTab === 'rental'  && <RentalTab  push={push} />}
        {activeTab === 'propdev' && <PropDevTab push={push} />}
      </div>

      {/* Toast stack */}
      <div className="fixed bottom-6 right-6 space-y-2 z-50 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-xl shadow-lg text-sm text-white font-medium pointer-events-auto transition-all ${
              t.ok ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            {t.ok ? <Check size={14} className="inline mr-1.5" /> : <X size={14} className="inline mr-1.5" />}
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
