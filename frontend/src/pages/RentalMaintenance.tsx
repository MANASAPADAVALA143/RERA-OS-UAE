import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Building2, Wrench, PlusCircle, X } from 'lucide-react';
import api from '../services/api';

// ── Types (match backend _req_dict shape) ────────────────────────────────────
interface MaintItem {
  id: string;
  unit_id: string;
  unit_number: string;
  company_name: string;
  property_name: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  reported_by: string | null;
  reported_date: string | null;
  vendor_name: string | null;
  target_completion_date: string | null;
  actual_completion_date: string | null;
  cost: number | null;
  sla_status: string;
  days_open: number | null;
}

interface MaintSummary {
  total: number;
  open: number;
  in_progress: number;
  completed: number;
  overdue: number;
  at_risk: number;
  total_cost: number;
}

interface MaintResponse {
  summary: MaintSummary;
  items: MaintItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

const CATEGORY_COLORS: Record<string, string> = {
  landscaping:      '#70AD47',
  hvac:             '#2E75B6',
  pool_maintenance: '#00B0F0',
  plumbing:         '#7030A0',
  electrical:       '#FF0000',
  cleaning:         '#FFC000',
  general:          '#808080',
  pest_control:     '#ED7D31',
  security:         '#1F3864',
  roofing:          '#C55A11',
  painting:         '#9E480E',
  appliance:        '#44546A',
  structural:       '#833C11',
  flooring:         '#538135',
  other:            '#A6A6A6',
};

function catColor(cat: string) {
  return CATEGORY_COLORS[cat.toLowerCase().replace(/\s+/g, '_')] ?? '#888';
}

function capitalize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'completed'  ? 'bg-green-100  text-green-700  border-green-200'  :
    status === 'in_progress'? 'bg-blue-100   text-blue-700   border-blue-200'   :
    status === 'closed'     ? 'bg-gray-100   text-gray-600   border-gray-200'   :
                              'bg-orange-100 text-orange-700  border-orange-200';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {capitalize(status)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls =
    priority === 'emergency'? 'bg-red-200    text-red-800'   :
    priority === 'high'     ? 'bg-red-100    text-red-600'   :
    priority === 'medium'   ? 'bg-yellow-100 text-yellow-700':
                              'bg-gray-100   text-gray-500';
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{priority}</span>;
}

function SlaBadge({ status }: { status: string }) {
  const cls =
    status === 'overdue' ? 'bg-red-100    text-red-700'   :
    status === 'at_risk' ? 'bg-amber-100  text-amber-700' :
    status === 'on_time' ? 'bg-green-100  text-green-700' :
                           'bg-gray-100   text-gray-500';
  return <span className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>{capitalize(status)}</span>;
}

// ── Company Card ──────────────────────────────────────────────────────────────
function CompanyCard({ company, items }: { company: string; items: MaintItem[] }) {
  const totalSpend = items.reduce((s, w) => s + (w.cost ?? 0), 0);
  const open       = items.filter(w => w.status === 'open').length;
  const inProg     = items.filter(w => w.status === 'in_progress').length;
  const done       = items.filter(w => w.status === 'completed' || w.status === 'closed').length;

  const catMap: Record<string, { cost: number; count: number }> = {};
  for (const wo of items) {
    const k = wo.category;
    if (!catMap[k]) catMap[k] = { cost: 0, count: 0 };
    catMap[k].cost  += wo.cost ?? 0;
    catMap[k].count += 1;
  }
  const cats    = Object.entries(catMap).sort((a, b) => b[1].cost - a[1].cost);
  const maxCost = cats[0]?.[1].cost || 1;
  const vendors = [...new Set(items.map(w => w.vendor_name).filter(Boolean))];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0 mt-0.5">
            <Building2 size={16} className="text-green-700" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm leading-tight">{company}</p>
            <p className="text-xs text-gray-500 mt-0.5">{items[0]?.property_name || company} · {items.length} work order{items.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
        {[
          { label: 'Total Work Orders', value: String(items.length) },
          { label: 'Open Issues',       value: String(open), red: open > 0 },
          { label: 'Total Spend',       value: totalSpend > 0 ? fmt(totalSpend) : '—' },
        ].map(t => (
          <div key={t.label} className="bg-white px-4 py-3 text-center">
            <p className={`text-lg font-bold ${('red' in t && t.red) ? 'text-red-600' : 'text-gray-900'}`}>{t.value}</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-tight">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Expense by Category */}
        {cats.some(([, { cost }]) => cost > 0) && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Spend by Category</p>
            <div className="space-y-2">
              {cats.map(([cat, { cost, count }]) => (
                <div key={cat} className="flex items-center gap-2">
                  <div className="w-24 shrink-0">
                    <p className="text-xs text-gray-700 truncate" title={capitalize(cat)}>{capitalize(cat)}</p>
                  </div>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${(cost / maxCost) * 100}%`, backgroundColor: catColor(cat) }} />
                  </div>
                  <span className="text-xs text-gray-700 font-mono w-16 text-right shrink-0">{cost > 0 ? fmt(cost) : '—'}</span>
                  <span className="text-xs text-gray-400 w-12 text-right shrink-0">{count} order{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status breakdown */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Status</p>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">✅ Done: {done}</span>
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">🔄 In Progress: {inProg}</span>
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 font-medium">⚠️ Open: {open}</span>
          </div>
        </div>

        {/* Work order list */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Work Orders</p>
          <div className="space-y-1">
            {items.slice(0, 15).map(wo => (
              <div key={wo.id} className="flex flex-wrap items-center gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-gray-600 flex-1 font-medium min-w-0 truncate" title={wo.title}>{wo.title}</span>
                <span className="text-gray-400 shrink-0">{capitalize(wo.category)}</span>
                <PriorityBadge priority={wo.priority} />
                <StatusPill status={wo.status} />
                <SlaBadge status={wo.sla_status} />
                {wo.cost != null && <span className="font-mono text-gray-700 w-14 text-right shrink-0">{fmt(wo.cost)}</span>}
              </div>
            ))}
            {items.length > 15 && (
              <p className="text-xs text-gray-400 pt-1">+{items.length - 15} more work orders</p>
            )}
          </div>
        </div>

        {/* Vendors */}
        {vendors.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Vendors</p>
            <p className="text-xs text-gray-400">{vendors.join(' · ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Portfolio stacked bar ─────────────────────────────────────────────────────
function CategoryStackedBar({ items }: { items: MaintItem[] }) {
  const totals: Record<string, number> = {};
  for (const wo of items) {
    if (wo.cost) totals[wo.category] = (totals[wo.category] ?? 0) + wo.cost;
  }
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-4">Spend by Category — Portfolio</p>
      <div className="flex h-8 rounded-lg overflow-hidden">
        {sorted.map(([cat, cost]) => {
          const w = (cost / grandTotal) * 100;
          return (
            <div key={cat} className="flex items-center justify-center relative"
              style={{ width: `${w}%`, backgroundColor: catColor(cat) }}
              title={`${capitalize(cat)}: ${fmt(cost)} (${w.toFixed(1)}%)`}>
              {w > 8 && <span className="text-white text-xs font-medium truncate px-1">{w.toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {sorted.map(([cat, cost]) => (
          <div key={cat} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: catColor(cat) }} />
            <span className="text-xs text-gray-600">{capitalize(cat)}</span>
            <span className="text-xs text-gray-400 font-mono">{fmt(cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Add Work Order panel ──────────────────────────────────────────────────────

interface UnitOption { id: string; unit_number: string; company_name: string; property_name: string | null; }

const CATEGORIES = [
  'landscaping','hvac','pool_maintenance','plumbing','electrical',
  'cleaning','general','pest_control','security','roofing',
  'painting','appliance','structural','flooring','other',
];
const PRIORITIES = ['low','medium','high','emergency'];

const INPUT = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white';
const LABEL = 'block text-xs font-semibold text-gray-600 mb-1';

interface WorkOrderDraft {
  unit_id: string;
  title: string;
  category: string;
  priority: string;
  reported_by: string;
  reported_date: string;
  vendor_name: string;
  target_completion_date: string;
  cost: string;
  description: string;
}

const EMPTY_DRAFT: WorkOrderDraft = {
  unit_id: '', title: '', category: 'general', priority: 'medium',
  reported_by: '', reported_date: new Date().toISOString().slice(0, 10),
  vendor_name: '', target_completion_date: '', cost: '', description: '',
};

function AddWorkOrderPanel({
  units, onClose, onSaved,
}: { units: UnitOption[]; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft]       = useState<WorkOrderDraft>(EMPTY_DRAFT);
  const [saving, setSaving]     = useState(false);
  const [formErr, setFormErr]   = useState('');

  const set = (k: keyof WorkOrderDraft, v: string) => setDraft(d => ({ ...d, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.unit_id) { setFormErr('Please select a unit.'); return; }
    if (!draft.title.trim()) { setFormErr('Title is required.'); return; }
    setFormErr('');
    setSaving(true);
    try {
      await api.post('/api/rentals/maintenance', {
        unit_id:                draft.unit_id,
        title:                  draft.title.trim(),
        category:               draft.category,
        priority:               draft.priority,
        status:                 'open',
        reported_by:            draft.reported_by || undefined,
        reported_date:          draft.reported_date || undefined,
        vendor_name:            draft.vendor_name  || undefined,
        target_completion_date: draft.target_completion_date || undefined,
        cost:                   draft.cost ? parseFloat(draft.cost) : undefined,
        description:            draft.description || undefined,
      });
      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setFormErr(msg ?? 'Failed to save work order. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Panel */}
      <div className="w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add Work Order</h2>
            <p className="text-xs text-gray-400 mt-0.5">Creates a new maintenance request</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 flex flex-col px-5 py-5 space-y-4">
          {/* Unit */}
          <div>
            <label className={LABEL}>Unit <span className="text-red-500">*</span></label>
            <select value={draft.unit_id} onChange={e => set('unit_id', e.target.value)} className={INPUT} required>
              <option value="">— Select unit —</option>
              {units.map(u => (
                <option key={u.id} value={u.id}>
                  {u.unit_number} — {u.company_name}{u.property_name ? ` · ${u.property_name}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className={LABEL}>Title / Issue <span className="text-red-500">*</span></label>
            <input type="text" value={draft.title} onChange={e => set('title', e.target.value)}
              className={INPUT} placeholder="e.g. AC unit not cooling Unit 3B" required />
          </div>

          {/* Category + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Category</label>
              <select value={draft.category} onChange={e => set('category', e.target.value)} className={INPUT}>
                {CATEGORIES.map(c => <option key={c} value={c}>{capitalize(c)}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL}>Priority</label>
              <select value={draft.priority} onChange={e => set('priority', e.target.value)} className={INPUT}>
                {PRIORITIES.map(p => <option key={p} value={p}>{capitalize(p)}</option>)}
              </select>
            </div>
          </div>

          {/* Reported by + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Reported By</label>
              <input type="text" value={draft.reported_by} onChange={e => set('reported_by', e.target.value)}
                className={INPUT} placeholder="Tenant or staff name" />
            </div>
            <div>
              <label className={LABEL}>Reported Date</label>
              <input type="date" value={draft.reported_date} onChange={e => set('reported_date', e.target.value)} className={INPUT} />
            </div>
          </div>

          {/* Vendor + Target date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Vendor / Contractor</label>
              <input type="text" value={draft.vendor_name} onChange={e => set('vendor_name', e.target.value)}
                className={INPUT} placeholder="e.g. ABC Plumbing" />
            </div>
            <div>
              <label className={LABEL}>Target Completion</label>
              <input type="date" value={draft.target_completion_date} onChange={e => set('target_completion_date', e.target.value)} className={INPUT} />
            </div>
          </div>

          {/* Cost */}
          <div>
            <label className={LABEL}>Estimated / Actual Cost ($)</label>
            <input type="number" min="0" step="0.01" value={draft.cost} onChange={e => set('cost', e.target.value)}
              className={INPUT} placeholder="0.00" />
          </div>

          {/* Description */}
          <div>
            <label className={LABEL}>Description / Notes</label>
            <textarea value={draft.description} onChange={e => set('description', e.target.value)}
              className={INPUT} rows={3} placeholder="Details, location, tenant complaint, etc." />
          </div>

          {formErr && (
            <div className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: '#FCEAEA', color: '#8B3A3A' }}>
              {formErr}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 sticky bottom-0 bg-white pb-4">
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-60"
              style={{ background: saving ? '#6B9E6B' : '#2D6A2D' }}>
              {saving ? 'Saving…' : 'Save Work Order'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RentalMaintenance() {
  const [response, setResponse] = useState<MaintResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [showForm, setShowForm] = useState(false);
  const [units,    setUnits]    = useState<UnitOption[]>([]);

  const [filterCompany,  setFilterCompany]  = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');

  // Fetch available units for the work-order form
  useEffect(() => {
    api.get<UnitOption[]>('/api/rentals/units')
      .then(r => setUnits(r.data))
      .catch(() => {/* units list optional */});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.get<MaintResponse>('/api/rentals/maintenance')
      .then(r => {
        const d = r.data;
        if (d && Array.isArray(d.items)) {
          setResponse(d);
        } else {
          // API returned unexpected shape — treat as empty
          setResponse({ summary: { total:0,open:0,in_progress:0,completed:0,overdue:0,at_risk:0,total_cost:0 }, items: [] });
        }
      })
      .catch(err => {
        console.error('[Maintenance] API error:', err?.response?.status, err?.response?.data ?? err?.message);
        setError(`Failed to load maintenance data. ${err?.response?.status ? `(${err.response.status})` : ''}`);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const allItems = response?.items ?? [];

  const companies = useMemo(() => [...new Set(allItems.map(i => i.company_name))].sort(), [allItems]);
  const categories = useMemo(() => [...new Set(allItems.map(i => i.category))].sort(), [allItems]);

  const filtered = useMemo(() => {
    return allItems.filter(i => {
      if (filterCompany  && i.company_name !== filterCompany)  return false;
      if (filterCategory && i.category     !== filterCategory) return false;
      if (filterStatus   && i.status       !== filterStatus)   return false;
      return true;
    });
  }, [allItems, filterCompany, filterCategory, filterStatus]);

  // Group filtered items by company
  const byCompany = useMemo(() => {
    const map: Record<string, MaintItem[]> = {};
    for (const item of filtered) {
      if (!map[item.company_name]) map[item.company_name] = [];
      map[item.company_name].push(item);
    }
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // Summary stats
  const summary = useMemo(() => ({
    total:   filtered.length,
    open:    filtered.filter(i => i.status === 'open').length,
    inProg:  filtered.filter(i => i.status === 'in_progress').length,
    done:    filtered.filter(i => i.status === 'completed' || i.status === 'closed').length,
    spend:   filtered.reduce((s, i) => s + (i.cost ?? 0), 0),
  }), [filtered]);

  if (loading) return (
    <div className="space-y-5">
      <div className="h-8 w-48 bg-gray-100 animate-pulse rounded" />
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 bg-gray-100 animate-pulse rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-64 bg-gray-100 animate-pulse rounded-xl" />
        ))}
      </div>
    </div>
  );

  if (error) return (
    <div className="p-4 text-red-600">{error}
      <button onClick={load} className="ml-3 underline text-sm">Retry</button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Slide-in form panel */}
      {showForm && (
        <AddWorkOrderPanel
          units={units}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); load(); }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Work orders from maintenance log · All properties</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white shrink-0"
          style={{ background: '#2D6A2D' }}>
          <PlusCircle size={15} /> Add Work Order
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-600 bg-white">
          <option value="">All Companies</option>
          {companies.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-600 bg-white">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{capitalize(c)}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-600 bg-white">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="closed">Closed</option>
        </select>

        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Empty state */}
      {allItems.length === 0 ? (
        <div className="text-center py-20">
          <Wrench size={40} className="mx-auto text-gray-300 mb-4" />
          <p className="text-lg font-medium text-gray-500">No maintenance work orders yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-5">Click <strong>Add Work Order</strong> above to log your first request.</p>
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: '#2D6A2D' }}>
            <PlusCircle size={15} /> Add Work Order
          </button>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Total Work Orders', value: summary.total,             color: 'text-gray-900',   bg: 'bg-gray-50'   },
              { label: 'Open',              value: summary.open,              color: 'text-orange-600', bg: 'bg-orange-50' },
              { label: 'In Progress',       value: summary.inProg,            color: 'text-blue-600',   bg: 'bg-blue-50'   },
              { label: 'Completed',         value: summary.done,              color: 'text-green-600',  bg: 'bg-green-50'  },
              { label: 'Total Spend',       value: fmt(summary.spend),        color: 'text-gray-900',   bg: 'bg-white'     },
            ].map(t => (
              <div key={t.label} className={`${t.bg} rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-center`}>
                <p className={`text-2xl font-bold ${t.color}`}>{t.value}</p>
                <p className="text-xs text-gray-500 mt-1">{t.label}</p>
              </div>
            ))}
          </div>

          {/* Category stacked bar */}
          <CategoryStackedBar items={filtered} />

          {/* Per-company cards */}
          {byCompany.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-sm">No work orders match the current filters.</p>
            </div>
          ) : (
            <div className={`grid gap-4 ${byCompany.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
              {byCompany.map(([company, items]) => (
                <CompanyCard key={company} company={company} items={items} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
