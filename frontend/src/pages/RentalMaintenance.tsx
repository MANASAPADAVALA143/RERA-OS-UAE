import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Building2, Wrench } from 'lucide-react';
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function RentalMaintenance() {
  const [response, setResponse] = useState<MaintResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const [filterCompany,  setFilterCompany]  = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get<MaintResponse>('/api/rentals/maintenance')
      .then(r => setResponse(r.data))
      .catch(() => setError('Failed to load maintenance data.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
        <p className="text-sm text-gray-500 mt-0.5">Work orders from maintenance log · All properties</p>
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
          <p className="text-sm text-gray-400 mt-1">Add a work order from the company dashboard → Maintenance tab</p>
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
