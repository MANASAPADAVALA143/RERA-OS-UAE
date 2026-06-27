import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, X, Check, Search,
  Building2, Home, Landmark, HardHat,
} from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

// ── types ─────────────────────────────────────────────────────────────────────

type ModuleId = 'rental' | 'propdev' | 'reit' | 'construction';

interface Company extends Record<string, unknown> {
  id: string;
  company_name: string;
  status?: string;
}

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  required?: boolean;
  options?: string[];
}

interface ModuleDef {
  id: ModuleId;
  label: string;
  icon: typeof Building2;
  endpoint: string;
  fields: FieldDef[];
  tableCols: string[];
  rowCells: (c: Company) => (string | number | null)[];
  normalise: (raw: unknown) => Company[];
  toPayload: (form: Record<string, string>) => Record<string, unknown>;
}

// ── small toast ───────────────────────────────────────────────────────────────

interface Toast { id: number; msg: string; ok: boolean }
let _tid = 0;

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, ok = true) => {
    const id = ++_tid;
    setToasts(p => [...p, { id, msg, ok }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

// ── modal ─────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ── module definitions ────────────────────────────────────────────────────────

const MODULES: ModuleDef[] = [
  {
    id: 'rental',
    label: 'Rental & Lease',
    icon: Home,
    endpoint: '/api/rentals/companies',
    fields: [
      { name: 'company_name',  label: 'Company Name',   type: 'text',   required: true },
      { name: 'property_type', label: 'Property Type',  type: 'select',
        options: ['Apartment Complex', 'Multifamily Townhome', 'Garden Apartment', 'Single Family Rental', 'Loft Apartment', 'Commercial'] },
      { name: 'total_units',   label: 'Total Units',    type: 'number' },
    ],
    tableCols: ['Company Name', 'Property Type', 'Units', 'Status'],
    rowCells: (c) => [
      c.company_name,
      (c.property_type as string) || '—',
      (c.total_units as number) ?? '—',
      null,
    ],
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        company_name: (r.company_name as string) ?? '',
        property_type: r.property_type as string,
        total_units: r.total_units,
        status: (r.status as string) ?? 'active',
      }));
    },
    toPayload: (f) => ({
      company_name: f.company_name,
      property_type: f.property_type || undefined,
      total_units: f.total_units ? Number(f.total_units) : undefined,
      status: f.status || 'active',
    }),
  },
  {
    id: 'propdev',
    label: 'Property Dev',
    icon: Building2,
    endpoint: '/api/propdev/companies',
    fields: [
      { name: 'name',          label: 'Company Name',  type: 'text',   required: true },
      { name: 'property_name', label: 'Project / Property', type: 'text' },
      { name: 'project_type',  label: 'Project Type',  type: 'select',
        options: ['Land Development', 'Residential', 'Commercial', 'Mixed Use'] },
      { name: 'total_lots',    label: 'Total Lots',    type: 'number' },
    ],
    tableCols: ['Company Name', 'Project / Property', 'Type', 'Lots', 'Status'],
    rowCells: (c) => [
      c.company_name,
      (c.property_name as string) || '—',
      (c.project_type as string) || '—',
      (c.total_lots as number) ?? '—',
      null,
    ],
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        company_name: (r.name as string) ?? '',
        property_name: r.property_name as string,
        project_type: r.project_type as string,
        total_lots: r.total_lots,
        status: (r.status as string) ?? 'active',
        _raw_name: r.name,
      }));
    },
    toPayload: (f) => ({
      name: f.name,
      property_name: f.property_name || '',
      project_type: f.project_type || undefined,
      total_lots: f.total_lots ? Number(f.total_lots) : undefined,
      status: f.status || 'active',
    }),
  },
  {
    id: 'reit',
    label: 'REIT',
    icon: Landmark,
    endpoint: '/api/reit/companies',
    fields: [
      { name: 'company_name', label: 'Company Name', type: 'text', required: true },
      { name: 'fund_name',    label: 'Fund Name',    type: 'text' },
      { name: 'asset_class',  label: 'Asset Class',  type: 'select',
        options: ['Multifamily', 'Office', 'Retail', 'Industrial', 'Mixed'] },
      { name: 'aum',          label: 'AUM ($)',      type: 'number' },
    ],
    tableCols: ['Company Name', 'Fund', 'Asset Class', 'AUM', 'Status'],
    rowCells: (c) => [
      c.company_name,
      (c.fund_name as string) || '—',
      (c.asset_class as string) || '—',
      (c.aum as number) ? `$${Number(c.aum).toLocaleString()}` : '—',
      null,
    ],
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        company_name: (r.company_name as string) ?? '',
        fund_name: r.fund_name as string,
        asset_class: r.asset_class as string,
        aum: r.aum,
        status: (r.status as string) ?? 'active',
      }));
    },
    toPayload: (f) => ({
      company_name: f.company_name,
      fund_name: f.fund_name || undefined,
      asset_class: f.asset_class || undefined,
      aum: f.aum ? Number(f.aum) : undefined,
      status: f.status || 'active',
    }),
  },
  {
    id: 'construction',
    label: 'Construction',
    icon: HardHat,
    endpoint: '/api/real-estate/construction/companies',
    fields: [
      { name: 'company_name',   label: 'Company Name',      type: 'text',   required: true },
      { name: 'project_name',   label: 'Project Name',      type: 'text' },
      { name: 'project_type',   label: 'Project Type',      type: 'select',
        options: ['Residential', 'Commercial', 'Infrastructure', 'Industrial'] },
      { name: 'contract_value', label: 'Contract Value ($)', type: 'number' },
      { name: 'start_date',     label: 'Start Date',        type: 'date' },
      { name: 'end_date',       label: 'End Date',          type: 'date' },
    ],
    tableCols: ['Company Name', 'Project', 'Type', 'Contract Value', 'End Date', 'Status'],
    rowCells: (c) => [
      c.company_name,
      (c.project_name as string) || '—',
      (c.project_type as string) || '—',
      (c.contract_value as number) ? `$${Number(c.contract_value).toLocaleString()}` : '—',
      (c.end_date as string) || '—',
      null,
    ],
    normalise: (raw) => {
      const arr = Array.isArray(raw) ? raw : (raw as { companies?: unknown[] }).companies ?? [];
      return (arr as Record<string, unknown>[]).map(r => ({
        id: r.id as string,
        company_name: (r.company_name as string) ?? '',
        project_name: r.project_name as string,
        project_type: r.project_type as string,
        contract_value: r.contract_value,
        start_date: r.start_date as string,
        end_date: r.end_date as string,
        status: (r.status as string) ?? 'active',
      }));
    },
    toPayload: (f) => ({
      company_name: f.company_name,
      project_name: f.project_name || undefined,
      project_type: f.project_type || undefined,
      contract_value: f.contract_value ? Number(f.contract_value) : undefined,
      start_date: f.start_date || undefined,
      end_date: f.end_date || undefined,
      status: f.status || 'active',
    }),
  },
];

// ── status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, onClick }: { status: string; onClick: () => void }) {
  const active = !status || status === 'active';
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors cursor-pointer
        ${active
          ? 'bg-green-100 text-green-700 hover:bg-green-200'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        }`}
    >
      {active ? 'Active' : 'Inactive'}
    </button>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

interface Props { embedded?: boolean }

export default function CompanyRegistry({ embedded = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { canWrite } = useAuth();
  const { toasts, push } = useToast();

  const initTab = (searchParams.get('tab') as ModuleId | null) ?? 'rental';
  const [activeId, setActiveId] = useState<ModuleId>(
    MODULES.some(m => m.id === initTab) ? initTab : 'rental'
  );

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'add' | 'edit' | 'delete' | null>(null);
  const [target, setTarget] = useState<Company | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const mod = MODULES.find(m => m.id === activeId)!;

  const load = useCallback(async () => {
    setLoading(true);
    setCompanies([]);
    try {
      const res = await api.get(mod.endpoint);
      setCompanies(mod.normalise(res.data));
    } catch {
      push(`Failed to load ${mod.label} companies`, false);
    } finally {
      setLoading(false);
    }
  }, [mod, push]);

  useEffect(() => { load(); }, [load]);

  function switchTab(id: ModuleId) {
    setActiveId(id);
    setSearch('');
    setSearchParams({ tab: id }, { replace: true });
  }

  // ── form helpers ────────────────────────────────────────────────────────────

  function initForm(co?: Company) {
    if (!co) {
      const blank: Record<string, string> = { status: 'active' };
      mod.fields.forEach(f => { blank[f.name] = ''; });
      setForm(blank);
    } else {
      const filled: Record<string, string> = {};
      mod.fields.forEach(f => {
        const v = co[f.name];
        filled[f.name] = v != null ? String(v) : '';
      });
      filled.status = (co.status as string) ?? 'active';
      if (activeId === 'propdev') filled.name = (co.company_name as string) ?? '';
      setForm(filled);
    }
    setErrors({});
  }

  function openAdd() { initForm(); setTarget(null); setModal('add'); }
  function openEdit(c: Company) { initForm(c); setTarget(c); setModal('edit'); }
  function openDelete(c: Company) { setTarget(c); setModal('delete'); }
  function close() { setModal(null); setTarget(null); setSaving(false); }

  function validate() {
    const errs: Record<string, string> = {};
    mod.fields.filter(f => f.required).forEach(f => {
      if (!form[f.name]?.trim()) errs[f.name] = `${f.label} is required`;
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const isEdit = modal === 'edit' && !!target;
    const url = isEdit ? `${mod.endpoint}/${target!.id}` : mod.endpoint;
    const method = isEdit ? 'put' : 'post';
    try {
      await api[method](url, mod.toPayload(form));
      push(isEdit ? 'Company updated' : 'Company added');
      close();
      load();
    } catch {
      push('Failed to save company', false);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!target) return;
    try {
      await api.delete(`${mod.endpoint}/${target.id}`);
      push('Company deleted');
      close();
      load();
    } catch {
      push('Failed to delete company', false);
      close();
    }
  }

  async function toggleStatus(c: Company) {
    const newStatus = c.status === 'inactive' ? 'active' : 'inactive';
    try {
      await api.patch(`${mod.endpoint}/${c.id}/status`, { status: newStatus });
      setCompanies(prev => prev.map(x => x.id === c.id ? { ...x, status: newStatus } : x));
    } catch {
      push('Failed to update status', false);
    }
  }

  // ── filtered list ───────────────────────────────────────────────────────────

  const filtered = companies.filter(c => {
    const q = search.toLowerCase();
    return (c.company_name ?? '').toLowerCase().includes(q)
      || Object.values(c).some(v => typeof v === 'string' && v.toLowerCase().includes(q));
  });

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header — hidden when embedded inside Settings */}
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Company Registry</h1>
          <p className="text-sm text-gray-500 mt-1">Add, edit, and manage companies across all modules.</p>
        </div>
      )}

      {/* Module tabs */}
      <div className="flex gap-1 bg-white border border-gray-100 shadow-sm rounded-xl p-1 w-fit">
        {MODULES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => switchTab(id)}
            className={`flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg font-medium transition-all
              ${activeId === id ? 'bg-gray-900 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Search + Add */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${mod.label}…`}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl bg-white
                       focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{filtered.length} companies</span>
          {canWrite && (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 bg-gray-900 text-white text-sm px-4 py-2
                         rounded-xl hover:bg-gray-800 font-medium transition-colors"
            >
              <Plus size={14} /> Add Company
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Building2 size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-500">
              {search ? 'No companies match your search' : `No ${mod.label} companies yet`}
            </p>
            {!search && canWrite && (
              <button onClick={openAdd}
                className="mt-4 text-sm bg-gray-900 text-white px-4 py-2 rounded-xl hover:bg-gray-800">
                + Add Company
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
                  {mod.tableCols.map(col => (
                    <th key={col} className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {col}
                    </th>
                  ))}
                  {canWrite && (
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((c, idx) => {
                  const cells = mod.rowCells(c);
                  return (
                    <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-400">{idx + 1}</td>
                      {cells.map((cell, ci) => (
                        <td key={ci} className={`px-4 py-3 ${ci === 0 ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
                          {cell === null
                            ? <StatusBadge status={c.status ?? 'active'} onClick={() => canWrite && toggleStatus(c)} />
                            : cell}
                        </td>
                      ))}
                      {canWrite && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(c)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                              title="Edit"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => openDelete(c)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ADD / EDIT MODAL */}
      {(modal === 'add' || modal === 'edit') && (
        <Modal title={modal === 'add' ? `Add ${mod.label} Company` : 'Edit Company'} onClose={close}>
          <div className="space-y-3">
            {mod.fields.map(f => (
              <div key={f.name}>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {f.type === 'select' ? (
                  <select
                    value={form[f.name] ?? ''}
                    onChange={e => { setForm(p => ({ ...p, [f.name]: e.target.value })); setErrors(p => ({ ...p, [f.name]: '' })); }}
                    className={`w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white
                      ${errors[f.name] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                  >
                    <option value="">Select…</option>
                    {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type={f.type}
                    value={form[f.name] ?? ''}
                    onChange={e => { setForm(p => ({ ...p, [f.name]: e.target.value })); setErrors(p => ({ ...p, [f.name]: '' })); }}
                    placeholder={`Enter ${f.label.toLowerCase()}`}
                    className={`w-full text-sm border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30
                      ${errors[f.name] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                  />
                )}
                {errors[f.name] && <p className="text-xs text-red-500 mt-0.5">{errors[f.name]}</p>}
              </div>
            ))}

            {/* Status */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <div className="flex gap-2">
                {['active', 'inactive'].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, status: s }))}
                    className={`flex-1 text-xs py-2 rounded-xl border font-medium capitalize transition-colors
                      ${(form.status ?? 'active') === s
                        ? s === 'active' ? 'bg-green-600 text-white border-green-600' : 'bg-gray-700 text-white border-gray-700'
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                      }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-5">
            <button onClick={close}
              className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 text-sm bg-gray-900 text-white py-2.5 rounded-xl hover:bg-gray-800 font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : <><Check size={14} />{modal === 'add' ? 'Add Company' : 'Save Changes'}</>}
            </button>
          </div>
        </Modal>
      )}

      {/* DELETE CONFIRM */}
      {modal === 'delete' && target && (
        <Modal title="Delete Company" onClose={close}>
          <div className="text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Trash2 size={20} className="text-red-500" />
            </div>
            <p className="text-sm text-gray-600 mb-1">
              Delete <span className="font-semibold text-gray-800">"{target.company_name}"</span>?
            </p>
            <p className="text-xs text-red-500 mb-5 leading-relaxed">
              This will permanently delete this company and all its associated data. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={close}
                className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 text-sm bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 font-medium">
                Yes, Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* TOAST STACK */}
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
