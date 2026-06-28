import { useMemo, useState } from 'react';
import { RefreshCw, Building2 } from 'lucide-react';

// ── Static Data ───────────────────────────────────────────────────────────────
const MAINTENANCE_DATA = [
  {
    company: 'ABC LLC', property: 'ABC LLC Suite 123',
    city: 'Phoenix', state: 'AZ', units: 7,
    workOrders: [
      { id: 'WO-RP001-234', category: 'Landscaping',      status: 'completed',   vendor: 'AZ Maintenance Pro',       cost: 420, date: '2026-06-10', priority: 'medium' },
      { id: 'WO-RP001-235', category: 'Pool Maintenance', status: 'open',        vendor: 'Desert Pool Service',      cost: 380, date: '2026-06-21', priority: 'low'    },
      { id: 'WO-RP001-236', category: 'HVAC',             status: 'in_progress', vendor: 'Valley HVAC Services',     cost: 540, date: '2026-06-18', priority: 'high'   },
    ],
  },
  {
    company: 'BNC LLC', property: 'BNC LLC SUITE 123',
    city: 'Scottsdale', state: 'AZ', units: 13,
    workOrders: [
      { id: 'WO-RP002-112', category: 'Landscaping',      status: 'completed',   vendor: 'Desert Landscaping Co',    cost: 380, date: '2026-06-17', priority: 'high'   },
      { id: 'WO-RP002-113', category: 'Pool Maintenance', status: 'in_progress', vendor: 'Desert Pool Service',      cost: 290, date: '2026-06-16', priority: 'medium' },
      { id: 'WO-RP002-114', category: 'Plumbing',         status: 'open',        vendor: 'Sunstate Plumbing',        cost: 620, date: '2026-06-14', priority: 'high'   },
    ],
  },
  {
    company: 'DEC LLC', property: 'DEC LLC SUITE 123',
    city: 'Tempe', state: 'AZ', units: 19,
    workOrders: [
      { id: 'WO-RP003-089', category: 'General',          status: 'completed',   vendor: 'Metro Property Mgmt',      cost: 310, date: '2026-06-15', priority: 'medium' },
      { id: 'WO-RP003-090', category: 'Landscaping',      status: 'open',        vendor: 'Desert Landscaping Co',    cost: 480, date: '2026-06-12', priority: 'low'    },
    ],
  },
  {
    company: 'XYZ LLC', property: 'XYZ LLC SUITE 123',
    city: 'Gilbert', state: 'AZ', units: 6,
    workOrders: [
      { id: 'WO-RP004-201', category: 'Landscaping',      status: 'completed',   vendor: 'Desert Landscaping Co',    cost: 560, date: '2026-06-20', priority: 'high'   },
      { id: 'WO-RP004-202', category: 'Electrical',       status: 'open',        vendor: 'Southwest Electric',       cost: 740, date: '2026-06-19', priority: 'high'   },
      { id: 'WO-RP004-203', category: 'Cleaning',         status: 'completed',   vendor: 'Phoenix Cleaning Corp',    cost: 280, date: '2026-06-11', priority: 'low'    },
    ],
  },
  {
    company: 'ZYC LLC', property: 'ZYC LLC',
    city: 'Chandler', state: 'AZ', units: 20,
    workOrders: [
      { id: 'WO-RP005-044', category: 'Pool Maintenance', status: 'open',        vendor: 'Desert Pool Service',      cost: 420, date: '2026-06-21', priority: 'low'    },
      { id: 'WO-RP005-045', category: 'HVAC',             status: 'in_progress', vendor: 'Valley HVAC Services',     cost: 680, date: '2026-06-19', priority: 'high'   },
      { id: 'WO-RP005-046', category: 'Pest Control',     status: 'completed',   vendor: 'AZ Pest Control',          cost: 180, date: '2026-06-10', priority: 'low'    },
    ],
  },
  {
    company: 'ACD LLC', property: 'ACD LLC',
    city: 'Mesa', state: 'AZ', units: 14,
    workOrders: [
      { id: 'WO-RP006-178', category: 'General',          status: 'open',        vendor: 'AZ Maintenance Pro',       cost: 350, date: '2026-06-13', priority: 'medium' },
      { id: 'WO-RP006-179', category: 'Plumbing',         status: 'completed',   vendor: 'Sunstate Plumbing',        cost: 490, date: '2026-06-09', priority: 'medium' },
    ],
  },
  {
    company: 'NHJ LLC', property: 'NHJ LLC',
    city: 'Peoria', state: 'AZ', units: 8,
    workOrders: [
      { id: 'WO-RP007-056', category: 'Landscaping',      status: 'in_progress', vendor: 'Desert Landscaping Co',    cost: 410, date: '2026-06-18', priority: 'high'   },
      { id: 'WO-RP007-057', category: 'Pool Maintenance', status: 'open',        vendor: 'Desert Pool Service',      cost: 380, date: '2026-06-18', priority: 'low'    },
      { id: 'WO-RP007-058', category: 'Security',         status: 'completed',   vendor: 'Premier Security Systems', cost: 520, date: '2026-06-08', priority: 'medium' },
    ],
  },
  {
    company: 'FJH LLC', property: 'FJH LLC',
    city: 'Glendale', state: 'AZ', units: 8,
    workOrders: [
      { id: 'WO-RP008-321', category: 'General',          status: 'open',        vendor: 'Valley HVAC Services',     cost: 460, date: '2026-06-15', priority: 'high'   },
      { id: 'WO-RP008-322', category: 'Landscaping',      status: 'in_progress', vendor: 'Desert Landscaping Co',    cost: 390, date: '2026-06-10', priority: 'medium' },
      { id: 'WO-RP008-323', category: 'Cleaning',         status: 'completed',   vendor: 'Phoenix Cleaning Corp',    cost: 210, date: '2026-06-07', priority: 'low'    },
    ],
  },
  {
    company: 'KLI LLC', property: 'KLI LLC',
    city: 'Surprise', state: 'AZ', units: 15,
    workOrders: [
      { id: 'WO-RP009-099', category: 'HVAC',             status: 'completed',   vendor: 'Valley HVAC Services',     cost: 720, date: '2026-06-13', priority: 'high'   },
      { id: 'WO-RP009-100', category: 'Pest Control',     status: 'open',        vendor: 'AZ Pest Control',          cost: 160, date: '2026-06-11', priority: 'low'    },
    ],
  },
  {
    company: 'TOWN Houses', property: 'TOWN HOMES',
    city: 'Avondale', state: 'AZ', units: 12,
    workOrders: [
      { id: 'WO-RP010-067', category: 'Landscaping',      status: 'open',        vendor: 'Desert Landscaping Co',    cost: 440, date: '2026-06-19', priority: 'medium' },
      { id: 'WO-RP010-068', category: 'Electrical',       status: 'in_progress', vendor: 'Southwest Electric',       cost: 580, date: '2026-06-17', priority: 'high'   },
      { id: 'WO-RP010-069', category: 'Pool Maintenance', status: 'completed',   vendor: 'Desert Pool Service',      cost: 350, date: '2026-06-05', priority: 'low'    },
    ],
  },
];

const CATEGORY_COLORS: Record<string, string> = {
  'Landscaping':      '#70AD47',
  'HVAC':             '#2E75B6',
  'Pool Maintenance': '#00B0F0',
  'Plumbing':         '#7030A0',
  'Electrical':       '#FF0000',
  'Cleaning':         '#FFC000',
  'General':          '#808080',
  'Pest Control':     '#ED7D31',
  'Security':         '#1F3864',
};

const ALL_CATEGORIES = Object.keys(CATEGORY_COLORS);

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => '$' + n.toLocaleString('en-US');

function StatusPill({ status }: { status: string }) {
  const cls = status === 'completed'
    ? 'bg-green-100 text-green-700 border-green-200'
    : status === 'in_progress'
    ? 'bg-blue-100 text-blue-700 border-blue-200'
    : 'bg-orange-100 text-orange-700 border-orange-200';
  const label = status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>{label}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = priority === 'high' ? 'bg-red-100 text-red-600' : priority === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500';
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{priority}</span>;
}

// ── Company Card ──────────────────────────────────────────────────────────────
interface CompanyEntry { company: string; property: string; city: string; state: string; units: number; workOrders: typeof MAINTENANCE_DATA[0]['workOrders']; }

function CompanyCard({ entry, single }: { entry: CompanyEntry; single: boolean }) {
  const { company, property, city, state, units, workOrders } = entry;

  const totalSpend = workOrders.reduce((s, w) => s + w.cost, 0);
  const openCount  = workOrders.filter(w => w.status === 'open').length;
  const inProgCount = workOrders.filter(w => w.status === 'in_progress').length;
  const doneCount  = workOrders.filter(w => w.status === 'completed').length;

  // Category totals
  const catMap: Record<string, { cost: number; count: number }> = {};
  for (const wo of workOrders) {
    if (!catMap[wo.category]) catMap[wo.category] = { cost: 0, count: 0 };
    catMap[wo.category].cost  += wo.cost;
    catMap[wo.category].count += 1;
  }
  const cats = Object.entries(catMap).sort((a, b) => b[1].cost - a[1].cost);
  const maxCost = cats[0]?.[1].cost ?? 1;

  // Unique vendors
  const vendors = [...new Set(workOrders.map(w => w.vendor))];

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden ${single ? 'col-span-2' : ''}`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0 mt-0.5">
            <Building2 size={16} className="text-green-700" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm leading-tight">{company}</p>
            <p className="text-xs text-gray-500 mt-0.5">{property} · {city}, {state} · {units} units</p>
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-px bg-gray-100 border-b border-gray-100">
        {[
          { label: 'Total Work Orders', value: String(workOrders.length) },
          { label: 'Open Issues',       value: String(openCount),         red: openCount > 0 },
          { label: 'Total Spend',       value: fmt(totalSpend) },
        ].map(t => (
          <div key={t.label} className="bg-white px-4 py-3 text-center">
            <p className={`text-lg font-bold ${('red' in t && t.red) ? 'text-red-600' : 'text-gray-900'}`}>{t.value}</p>
            <p className="text-xs text-gray-500 mt-0.5 leading-tight">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Expense by Category */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Expense by Category</p>
          <div className="space-y-2">
            {cats.map(([cat, { cost, count }]) => (
              <div key={cat} className="flex items-center gap-2">
                <div className="w-24 shrink-0">
                  <p className="text-xs text-gray-700 truncate" title={cat}>{cat}</p>
                </div>
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(cost / maxCost) * 100}%`, backgroundColor: CATEGORY_COLORS[cat] ?? '#888' }}
                  />
                </div>
                <span className="text-xs text-gray-700 font-mono w-16 text-right shrink-0">{fmt(cost)}</span>
                <span className="text-xs text-gray-400 w-12 text-right shrink-0">{count} order{count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status breakdown */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Status Breakdown</p>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">
              ✅ Completed: {doneCount}
            </span>
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
              🔄 In Progress: {inProgCount}
            </span>
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 font-medium">
              ⚠️ Open: {openCount}
            </span>
          </div>
        </div>

        {/* Work order list (collapsible-style, always shown) */}
        {workOrders.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Work Orders</p>
            <div className="space-y-1">
              {workOrders.map(wo => (
                <div key={wo.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-gray-400 font-mono w-28 shrink-0">{wo.id}</span>
                  <span className="flex-1 text-gray-700">{wo.category}</span>
                  <PriorityBadge priority={wo.priority} />
                  <StatusPill status={wo.status} />
                  <span className="font-mono text-gray-700 w-14 text-right shrink-0">{fmt(wo.cost)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

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

// ── Category Stacked Bar ──────────────────────────────────────────────────────
function CategoryStackedBar({ data }: { data: typeof MAINTENANCE_DATA }) {
  const totals: Record<string, number> = {};
  for (const co of data) {
    for (const wo of co.workOrders) {
      totals[wo.category] = (totals[wo.category] ?? 0) + wo.cost;
    }
  }
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-4">Spend by Category — Portfolio</p>
      {/* Bar */}
      <div className="flex h-8 rounded-lg overflow-hidden">
        {sorted.map(([cat, cost]) => {
          const w = (cost / grandTotal) * 100;
          return (
            <div
              key={cat}
              className="flex items-center justify-center relative group"
              style={{ width: `${w}%`, backgroundColor: CATEGORY_COLORS[cat] ?? '#888' }}
              title={`${cat}: ${fmt(cost)} (${w.toFixed(1)}%)`}
            >
              {w > 8 && (
                <span className="text-white text-xs font-medium truncate px-1">
                  {w.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {sorted.map(([cat, cost]) => (
          <div key={cat} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: CATEGORY_COLORS[cat] ?? '#888' }} />
            <span className="text-xs text-gray-600">{cat}</span>
            <span className="text-xs text-gray-400 font-mono">{fmt(cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RentalMaintenance() {
  const [filterCompany,  setFilterCompany]  = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterDate,     setFilterDate]     = useState('all');
  const [refreshKey,     setRefreshKey]     = useState(0);

  const companyNames = MAINTENANCE_DATA.map(d => d.company);

  // Apply filters
  const filtered = useMemo(() => {
    const cutoff = (() => {
      const now = new Date('2026-06-25');
      if (filterDate === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0,10); }
      if (filterDate === '3m')    { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0,10); }
      if (filterDate === '6m')    { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0,10); }
      return null;
    })();

    return MAINTENANCE_DATA
      .filter(co => !filterCompany || co.company === filterCompany)
      .map(co => ({
        ...co,
        workOrders: co.workOrders.filter(wo => {
          if (filterCategory && wo.category !== filterCategory) return false;
          if (filterStatus   && wo.status   !== filterStatus)   return false;
          if (cutoff         && wo.date     < cutoff)           return false;
          return true;
        }),
      }))
      .filter(co => co.workOrders.length > 0);
  }, [filterCompany, filterCategory, filterStatus, filterDate, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Summary stats
  const summary = useMemo(() => {
    let total = 0, open = 0, inProg = 0, done = 0, spend = 0;
    for (const co of filtered) {
      for (const wo of co.workOrders) {
        total++;
        spend += wo.cost;
        if (wo.status === 'open')        open++;
        if (wo.status === 'in_progress') inProg++;
        if (wo.status === 'completed')   done++;
      }
    }
    return { total, open, inProg, done, spend };
  }, [filtered]);

  const singleCompany = filterCompany !== '' && filtered.length === 1;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
        <p className="text-sm text-gray-500 mt-0.5">Work orders grouped by company · All properties</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-600 bg-white">
          <option value="">All Companies</option>
          {companyNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-600 bg-white">
          <option value="">All Categories</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-600 bg-white">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>

        <select value={filterDate} onChange={e => setFilterDate(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-green-600 bg-white">
          <option value="all">All Time</option>
          <option value="month">This Month</option>
          <option value="3m">Last 3 Months</option>
          <option value="6m">Last 6 Months</option>
        </select>

        <button
          onClick={() => setRefreshKey(k => k + 1)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total Work Orders', value: summary.total, color: 'text-gray-900',   bg: 'bg-gray-50'     },
          { label: 'Open',              value: summary.open,  color: 'text-orange-600', bg: 'bg-orange-50'   },
          { label: 'In Progress',       value: summary.inProg,color: 'text-blue-600',   bg: 'bg-blue-50'     },
          { label: 'Completed',         value: summary.done,  color: 'text-green-600',  bg: 'bg-green-50'    },
          { label: 'Total Spend',       value: fmt(summary.spend), color: 'text-gray-900', bg: 'bg-white' },
        ].map(t => (
          <div key={t.label} className={`${t.bg} rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-center`}>
            <p className={`text-2xl font-bold ${t.color}`}>{t.value}</p>
            <p className="text-xs text-gray-500 mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Category stacked bar */}
      <CategoryStackedBar data={filtered} />

      {/* Company cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium">No work orders match the current filters.</p>
          <p className="text-sm mt-1">Try adjusting the Company, Category, or Status filter.</p>
        </div>
      ) : (
        <div className={`grid gap-4 ${singleCompany ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
          {filtered.map(entry => (
            <CompanyCard key={entry.company} entry={entry} single={singleCompany} />
          ))}
        </div>
      )}
    </div>
  );
}
