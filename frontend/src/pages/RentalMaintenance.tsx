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

const PARCH_CARD: React.CSSProperties = {
  background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, overflow: 'hidden',
};

function StatusPill({ status }: { status: string }) {
  const [bg, color, border] =
    status === 'completed'  ? ['rgba(38,166,91,0.10)',  '#065F46', '1px solid rgba(38,166,91,0.25)']  :
    status === 'in_progress'? ['rgba(59,130,246,0.10)', '#1D4ED8', '1px solid rgba(59,130,246,0.25)'] :
    status === 'closed'     ? ['rgba(120,113,108,0.10)','#57534E', '1px solid rgba(120,113,108,0.25)']:
                              ['rgba(234,88,12,0.10)',  '#C2410C', '1px solid rgba(234,88,12,0.25)'];
  return (
    <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, border, background: bg, color, fontWeight: 600 }}>
      {capitalize(status)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const [bg, color] =
    priority === 'emergency'? ['rgba(192,57,43,0.15)',  '#C0392B'] :
    priority === 'high'     ? ['rgba(239,68,68,0.10)',  '#B91C1C'] :
    priority === 'medium'   ? ['rgba(242,193,78,0.18)', '#92400E'] :
                              ['rgba(120,113,108,0.10)','#78716C'];
  return <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, background: bg, color, fontWeight: 600 }}>{priority}</span>;
}

function SlaBadge({ status }: { status: string }) {
  const [bg, color] =
    status === 'overdue' ? ['rgba(239,68,68,0.10)',  '#B91C1C'] :
    status === 'at_risk' ? ['rgba(242,193,78,0.18)', '#92400E'] :
    status === 'on_time' ? ['rgba(38,166,91,0.10)',  '#065F46'] :
                           ['rgba(120,113,108,0.10)','#78716C'];
  return <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 6, background: bg, color }}>{capitalize(status)}</span>;
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
    <div style={PARCH_CARD}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #E8DEC8', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(212,175,55,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Building2 size={16} style={{ color: '#92400E' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#1C1917', lineHeight: 1.2 }}>{company}</p>
          <p style={{ fontSize: 13, color: '#78716C', marginTop: 2 }}>{items[0]?.property_name || company} · {items.length} work order{items.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1px', background: '#E8DEC8', borderBottom: '1px solid #E8DEC8' }}>
        {[
          { label: 'Total Work Orders', value: String(items.length), red: false },
          { label: 'Open Issues',       value: String(open),         red: open > 0 },
          { label: 'Total Spend',       value: totalSpend > 0 ? fmt(totalSpend) : '—', red: false },
        ].map(t => (
          <div key={t.label} style={{ background: '#FBF6EE', padding: '12px 16px', textAlign: 'center' }}>
            <p style={{ fontSize: 28, fontWeight: 700, color: t.red ? '#B91C1C' : '#1C1917', fontVariantNumeric: 'tabular-nums lining-nums', lineHeight: 1.1 }}>{t.value}</p>
            <p style={{ fontSize: 13, color: '#78716C', marginTop: 3 }}>{t.label}</p>
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Expense by Category */}
        {cats.some(([, { cost }]) => cost > 0) && (
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Spend by Category</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {cats.map(([cat, { cost, count }]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 96, flexShrink: 0 }}>
                    <p style={{ fontSize: 13, color: '#1C1917', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={capitalize(cat)}>{capitalize(cat)}</p>
                  </div>
                  <div style={{ flex: 1, height: 10, background: '#E8DEC8', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 99, width: `${(cost / maxCost) * 100}%`, backgroundColor: catColor(cat) }} />
                  </div>
                  <span style={{ fontSize: 13, color: '#1C1917', fontVariantNumeric: 'tabular-nums lining-nums', width: 64, textAlign: 'right', flexShrink: 0 }}>{cost > 0 ? fmt(cost) : '—'}</span>
                  <span style={{ fontSize: 13, color: '#A8A29E', width: 56, textAlign: 'right', flexShrink: 0 }}>{count} order{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status breakdown */}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Status</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, padding: '3px 10px', borderRadius: 999, background: 'rgba(38,166,91,0.10)', color: '#065F46', fontWeight: 600 }}>Done: {done}</span>
            <span style={{ fontSize: 13, padding: '3px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.10)', color: '#1D4ED8', fontWeight: 600 }}>In Progress: {inProg}</span>
            <span style={{ fontSize: 13, padding: '3px 10px', borderRadius: 999, background: 'rgba(234,88,12,0.10)', color: '#C2410C', fontWeight: 600 }}>Open: {open}</span>
          </div>
        </div>

        {/* Work order list */}
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Work Orders</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {items.slice(0, 15).map((wo, i) => (
              <div key={wo.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '8px 0', borderBottom: i < Math.min(items.length, 15) - 1 ? '1px solid #F0EDE5' : 'none' }}>
                <span style={{ fontSize: 14, color: '#1C1917', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={wo.title}>{wo.title}</span>
                <span style={{ fontSize: 13, color: '#78716C', flexShrink: 0 }}>{capitalize(wo.category)}</span>
                <PriorityBadge priority={wo.priority} />
                <StatusPill status={wo.status} />
                <SlaBadge status={wo.sla_status} />
                {wo.cost != null && <span style={{ fontSize: 13, color: '#1C1917', fontVariantNumeric: 'tabular-nums lining-nums', width: 56, textAlign: 'right', flexShrink: 0 }}>{fmt(wo.cost)}</span>}
              </div>
            ))}
            {items.length > 15 && (
              <p style={{ fontSize: 13, color: '#A8A29E', paddingTop: 4 }}>+{items.length - 15} more work orders</p>
            )}
          </div>
        </div>

        {/* Vendors */}
        {vendors.length > 0 && (
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Vendors</p>
            <p style={{ fontSize: 13, color: '#A8A29E' }}>{vendors.join(' · ')}</p>
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
    <div style={{ ...PARCH_CARD, padding: 20 }}>
      <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 16 }}>Spend by Category — Portfolio</p>
      <div style={{ display: 'flex', height: 32, borderRadius: 8, overflow: 'hidden' }}>
        {sorted.map(([cat, cost]) => {
          const w = (cost / grandTotal) * 100;
          return (
            <div key={cat} className="flex items-center justify-center relative"
              style={{ width: `${w}%`, backgroundColor: catColor(cat) }}
              title={`${capitalize(cat)}: ${fmt(cost)} (${w.toFixed(1)}%)`}>
              {w > 8 && <span style={{ color: '#fff', fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px' }}>{w.toFixed(0)}%</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
        {sorted.map(([cat, cost]) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, backgroundColor: catColor(cat) }} />
            <span style={{ fontSize: 13, color: '#1C1917' }}>{capitalize(cat)}</span>
            <span style={{ fontSize: 13, color: '#78716C', fontVariantNumeric: 'tabular-nums lining-nums' }}>{fmt(cost)}</span>
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
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1C1917' }}>Maintenance</h1>
          <p style={{ fontSize: 13, color: '#78716C', marginTop: 2 }}>Work orders from maintenance log · All properties</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white shrink-0"
          style={{ background: '#2D6A2D' }}>
          <PlusCircle size={15} /> Add Work Order
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {[
          { val: filterCompany,  setVal: setFilterCompany,  options: [['','All Companies'], ...companies.map(n=>[n,n])] },
          { val: filterCategory, setVal: setFilterCategory, options: [['','All Categories'], ...categories.map(c=>[c,capitalize(c)])] },
          { val: filterStatus,   setVal: setFilterStatus,   options: [['','All Statuses'],['open','Open'],['in_progress','In Progress'],['completed','Completed'],['closed','Closed']] },
        ].map((f, i) => (
          <select key={i} value={f.val} onChange={e => f.setVal(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13, background: '#FBF6EE', color: '#1C1917', outline: 'none' }}>
            {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13, background: '#FBF6EE', color: '#78716C', cursor: 'pointer' }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Empty state */}
      {allItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Wrench size={40} style={{ margin: '0 auto 16px', color: '#D4C4A0' }} />
          <p style={{ fontSize: 16, fontWeight: 600, color: '#78716C' }}>No maintenance work orders yet</p>
          <p style={{ fontSize: 14, color: '#A8A29E', marginTop: 4, marginBottom: 20 }}>Click <strong>Add Work Order</strong> above to log your first request.</p>
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: '#2D6A2D' }}>
            <PlusCircle size={15} /> Add Work Order
          </button>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12 }}>
            {[
              { label: 'Total Work Orders', value: summary.total,      color: '#1C1917' },
              { label: 'Open',              value: summary.open,       color: summary.open > 0 ? '#C2410C' : '#1C1917' },
              { label: 'In Progress',       value: summary.inProg,     color: '#1D4ED8' },
              { label: 'Completed',         value: summary.done,       color: '#065F46' },
              { label: 'Total Spend',       value: fmt(summary.spend), color: '#1C1917' },
            ].map(t => (
              <div key={t.label} style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '12px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 28, fontWeight: 700, color: t.color, fontVariantNumeric: 'tabular-nums lining-nums', lineHeight: 1.1 }}>{t.value}</p>
                <p style={{ fontSize: 13, color: '#78716C', marginTop: 4 }}>{t.label}</p>
              </div>
            ))}
          </div>

          {/* Category stacked bar */}
          <CategoryStackedBar items={filtered} />

          {/* Per-company cards */}
          {byCompany.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ fontSize: 14, color: '#A8A29E' }}>No work orders match the current filters.</p>
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
