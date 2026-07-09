import { useCallback, useEffect, useState } from 'react';
import {
  Building, Building2, Home, Hotel, Warehouse, House,
  Store, Landmark, School, Factory, ArrowLeft, Plus, Trash2, Pencil, Check, X,
} from 'lucide-react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';
import { useRentalNav } from '../contexts/RentalNavContext';
import RentalCompanyDashboard from './RentalCompanyDashboard';

// ── flat interface matches actual API response shape ──────────────────────────
interface CompanyListItem {
  id: string;
  company_name: string;
  property_name: string;
  property_count: number;
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_pct: number;
  gross_potential_rent: number;
  billed_this_month: number;
  collected_this_month: number;
  arrears_total: number;
  noi_this_month: number;
  total_expense_this_month: number;
  sync_collected?: number | null;
  sync_occupied_units?: number | null;
  sync_total_units?: number | null;
  monthly_rent_data?: Record<string, number> | null;
}

function yyyymmToAbbrev(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${names[mi]}-${y}` : yyyymm;
}

/** Rent Receivable rollup for the selected month (matches Company Registry). */
function companyKpisForMonth(c: CompanyListItem, yyyymm: string) {
  const abbrev = yyyymmToAbbrev(yyyymm);
  const mrd = c.monthly_rent_data ?? {};
  const fromExcel = abbrev in mrd ? mrd[abbrev] : null;
  const collected = fromExcel ?? c.sync_collected ?? c.collected_this_month ?? 0;
  const expenses = c.total_expense_this_month ?? 0;
  const occ = (c.sync_total_units ?? 0) > 0
    ? { occupied: c.sync_occupied_units ?? c.occupied_units, total: c.sync_total_units ?? c.total_units }
    : { occupied: c.occupied_units, total: c.total_units };
  return {
    collected,
    noi: collected - expenses,
    occupied: occ.occupied,
    total: occ.total,
    fromRentReceivable: fromExcel != null || c.sync_collected != null,
  };
}

type IconComp = React.FC<{ size?: number | string; className?: string }>;

const COMPANY_STYLES: { Icon: IconComp; bg: string; text: string }[] = [
  { Icon: Building2, bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { Icon: Home,      bg: 'bg-blue-100',    text: 'text-blue-700'    },
  { Icon: Hotel,     bg: 'bg-amber-100',   text: 'text-amber-700'   },
  { Icon: Building,  bg: 'bg-indigo-100',  text: 'text-indigo-700'  },
  { Icon: House,     bg: 'bg-teal-100',    text: 'text-teal-900'    },
  { Icon: Warehouse, bg: 'bg-cyan-100',    text: 'text-cyan-700'    },
  { Icon: Landmark,  bg: 'bg-violet-100',  text: 'text-violet-700'  },
  { Icon: Store,     bg: 'bg-rose-100',    text: 'text-rose-700'    },
  { Icon: School,    bg: 'bg-orange-100',  text: 'text-orange-700'  },
  { Icon: Factory,   bg: 'bg-slate-100',   text: 'text-slate-700'   },
];

// Generate last 24 months + next 6 months for the selector
function buildMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = -24; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    opts.push({ value, label });
  }
  return opts;
}

const MONTH_OPTIONS = buildMonthOptions();
const currentMonthValue = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
};

export default function RentalCompanies() {
  const { selectedCompanyId, setSelectedCompanyId } = useRentalNav();
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prefersReduced, setPrefersReduced] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthValue);
  const [dashboardMonth, setDashboardMonth] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<CompanyListItem[]>('/api/rentals/companies', {
        params: { month: selectedMonth },
      });
      setCompanies(res.data);
    } catch {
      setError('Failed to load companies.');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await api.post('/api/rentals/companies', { company_name: newName.trim() });
      setNewName('');
      setShowAddForm(false);
      await fetchCompanies();
    } catch {
      setAddError('Failed to add company.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}" and all its data? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/rentals/companies/${id}`);
      await fetchCompanies();
    } catch {
      setError('Failed to delete company.');
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) { setEditingId(null); return; }
    setRenaming(true);
    try {
      await api.put(`/api/rentals/companies/${id}`, { company_name: editName.trim() });
      setEditingId(null);
      await fetchCompanies();
    } catch {
      setError('Failed to rename company.');
    } finally {
      setRenaming(false);
    }
  }

  if (selectedCompanyId) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setSelectedCompanyId(null); setDashboardMonth(null); }}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft size={16} /> Back to Companies
        </button>
        <RentalCompanyDashboard
          companyId={selectedCompanyId}
          initialMonth={dashboardMonth ?? selectedMonth}
        />
      </div>
    );
  }

  if (loading) return <LoadingSkeleton rows={6} />;
  if (error) return (
    <div className="text-red-700 p-4">
      {error}
      <button className="ml-4 underline" onClick={fetchCompanies}>Retry</button>
    </div>
  );

  return (
    <>
      {!prefersReduced && (
        <style>{`
          @keyframes fadeInCard {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0);   }
          }
        `}</style>
      )}
      <div className="space-y-6">
        {/* Header + Month selector + Add button */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-charcoal">Companies</h1>
          <div className="flex items-center gap-3 ml-auto">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              style={{
                padding: '6px 12px',
                border: '1px solid #E2E8F0',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                background: '#F1F5F9',
                color: '#1C1917',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {MONTH_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          <button
            onClick={() => { setShowAddForm(v => !v); setAddError(''); setNewName(''); }}
            className="flex items-center gap-2 bg-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={15} /> Add Company
          </button>
          </div>
        </div>

        {/* Add company form */}
        {showAddForm && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 shadow-sm">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="Company name (e.g. ABC LLC)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="bg-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-sm text-gray-500 hover:text-gray-700 px-2"
            >
              Cancel
            </button>
            {addError && <span className="text-xs text-red-700">{addError}</span>}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {companies.map((c, index) => {
            const style = COMPANY_STYLES[index % COMPANY_STYLES.length];
            const { Icon } = style;
            const kpis = companyKpisForMonth(c, selectedMonth);
            const occ = kpis.total > 0 ? kpis.occupied / kpis.total : 0;
            return (
              <div
                key={c.id}
                className={`transition-transform duration-150 ${prefersReduced ? '' : 'hover:scale-[1.05]'}`}
                style={prefersReduced ? {} : {
                  animation: `fadeInCard 0.25s ease ${index * 40}ms both`,
                }}
              >
                <Card>
                  <div className="space-y-3">
                    {/* Header: icon + name + unit badge */}
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl ${style.bg} flex-shrink-0`}>
                        <Icon size={22} className={style.text} />
                      </div>
                      <div className="flex-1 min-w-0">
                        {editingId === c.id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <input
                              autoFocus
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleRename(c.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              className="text-sm font-bold border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 w-full"
                            />
                            <button onClick={() => handleRename(c.id)} disabled={renaming}
                              className="text-blue-600 hover:text-blue-800 flex-shrink-0">
                              <Check size={13} />
                            </button>
                            <button onClick={() => setEditingId(null)}
                              className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <h3
                            className="font-bold text-primary truncate cursor-pointer hover:text-blue-600 transition-colors"
                            title="Double-click to rename"
                            onDoubleClick={e => { e.stopPropagation(); setEditingId(c.id); setEditName(c.company_name); }}
                          >
                            {c.company_name}
                          </h3>
                        )}
                        <p className="text-xs text-gray-400 truncate">{c.property_name}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        occ >= 0.9 ? 'bg-green-100 text-green-800'
                        : occ >= 0.75 ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                      }`}>
                        {kpis.occupied}/{kpis.total}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setEditingId(c.id); setEditName(c.company_name); }}
                        className="p-1 rounded hover:bg-blue-50 text-gray-300 hover:text-blue-500 transition-colors flex-shrink-0"
                        title="Rename company"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(c.id, c.company_name); }}
                        className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-700 transition-colors flex-shrink-0"
                        title="Delete company"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Occupancy bar */}
                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Occupancy</span>
                        <span>{fmtPct(occ)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${(occ * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </div>

                    {/* KPI row */}
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <div>
                        <p className="text-gray-400">Collected</p>
                        <p className="font-semibold">{fmtUSD(kpis.collected)}</p>
                        {kpis.fromRentReceivable && (
                          <p className="text-[10px] text-gray-400">Rent Receivable</p>
                        )}
                      </div>
                      <div>
                        <p className="text-gray-400">NOI</p>
                        <p className={`font-semibold ${kpis.noi < 0 ? 'text-red-700' : 'text-green-800'}`}>
                          {fmtUSD(kpis.noi)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Arrears</p>
                        <p className={`font-semibold ${c.arrears_total > 0 ? 'text-red-700' : 'text-gray-600'}`}>
                          {c.arrears_total > 0 ? fmtUSD(c.arrears_total) : '—'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => { setDashboardMonth(selectedMonth); setSelectedCompanyId(c.id); }}
                      className="w-full py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      View Dashboard →
                    </button>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
