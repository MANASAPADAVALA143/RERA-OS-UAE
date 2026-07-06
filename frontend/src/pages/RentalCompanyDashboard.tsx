import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';
import {
  type FinItem,
  ONE_TIME_CAT,
  classifyLabel, flattenItems,
  buildCategoryTotals, buildMonthlyExpense, buildMonthlyRevenue,
  EXP_PALETTE,
} from '../utils/rentalExpenseUtils';

interface Props {
  companyId: string;
}

// ── flat interface matches actual API response shape ──────────────────────────
interface DashboardData {
  id: string;
  company_name: string;
  property_name: string | null;
  property_count: number;
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_pct: number;
  billed_this_month: number;
  collected_this_month: number;
  arrears_total: number;
  noi_this_month: number;
  total_expense_this_month: number;
  income_trend: TrendPoint[];
  expense_breakdown: CategoryAmount[];
  units: UnitDetail[];
  ownership: OwnershipRow[];
  partner_distribution: PartnerShare[];
}

interface TrendPoint   { month: string; billed: number; collected: number; expense: number; noi: number }
interface CategoryAmount { category: string; amount: number }
interface UnitDetail   { id: string; unit_number: string; status: string; monthly_rent: number; tenant_name: string | null; lease_end: string | null; arrears: number }
interface OwnershipRow { partner_name: string; ownership_pct: number; role: string }
interface PartnerShare { partner_name: string; ownership_pct: number; role: string; noi_share: number; is_shortfall: boolean }

interface MaintItem {
  id: string; unit_number: string; title: string; category: string;
  priority: string; status: string; reported_date: string;
  vendor_name: string | null; cost: number | null;
  sla_status: string; is_overdue: boolean; days_open: number;
}

// ── pill maps ─────────────────────────────────────────────────────────────────
const STATUS_PILL: Record<string, string> = {
  occupied:         'bg-green-100 text-green-800',
  vacant:           'bg-red-100 text-red-800',
  notice:           'bg-amber-100 text-amber-800',
  reserved:         'bg-blue-100 text-blue-800',
  maintenance_hold: 'bg-gray-100 text-gray-800',
};

const PRIORITY_PILL: Record<string, string> = {
  emergency: 'bg-red-100 text-red-800',
  high:      'bg-orange-100 text-orange-800',
  medium:    'bg-amber-100 text-amber-800',
  low:       'bg-gray-100 text-gray-600',
};

const SLA_PILL: Record<string, string> = {
  overdue:  'bg-red-100 text-red-800',
  at_risk:  'bg-amber-100 text-amber-800',
  on_time:  'bg-green-100 text-green-800',
  closed:   'bg-gray-100 text-gray-600',
};

type DashTab = 'overview' | 'leases' | 'maintenance';

const TABS: { id: DashTab; label: string }[] = [
  { id: 'overview',     label: 'Overview'     },
  { id: 'leases',       label: 'Rentals'      },
  { id: 'maintenance',  label: 'Maintenance'  },
];

// ── Unit filter + table sub-component ────────────────────────────────────────
function UnitFilterBar({ units }: { units: UnitDetail[] }) {
  const [statusFilter, setStatusFilter] = useState('');
  const filtered = statusFilter ? units.filter(u => u.status === statusFilter) : units;
  const statusCounts = units.reduce<Record<string, number>>((acc, u) => {
    acc[u.status] = (acc[u.status] ?? 0) + 1; return acc;
  }, {});

  return (
    <div className="space-y-3">
      {/* status filter pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: '',                label: `All (${units.length})` },
          { key: 'occupied',        label: `Occupied (${statusCounts['occupied'] ?? 0})` },
          { key: 'vacant',          label: `Vacant (${statusCounts['vacant'] ?? 0})` },
          { key: 'notice',          label: `Notice (${statusCounts['notice'] ?? 0})` },
          { key: 'reserved',        label: `Reserved (${statusCounts['reserved'] ?? 0})` },
          { key: 'maintenance_hold',label: `Maint. Hold (${statusCounts['maintenance_hold'] ?? 0})` },
        ].filter(o => o.key === '' || statusCounts[o.key]).map(o => (
          <button key={o.key} onClick={() => setStatusFilter(o.key)}
            className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
              statusFilter === o.key
                ? 'bg-[#0E3B36] text-white border-[#0E3B36]'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
      {/* table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="py-2 px-2 font-medium">Unit</th>
              <th className="py-2 px-2 font-medium">Status</th>
              <th className="py-2 px-2 font-medium">Tenant</th>
              <th className="py-2 px-2 font-medium">Lease End</th>
              <th className="py-2 px-2 font-medium">Monthly Rent</th>
              <th className="py-2 px-2 font-medium">Arrears</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-2 px-2 font-mono">{u.unit_number}</td>
                <td className="py-2 px-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    u.status === 'occupied'         ? 'bg-green-100 text-green-800' :
                    u.status === 'vacant'           ? 'bg-red-100 text-red-800' :
                    u.status === 'notice'           ? 'bg-amber-100 text-amber-800' :
                    u.status === 'reserved'         ? 'bg-blue-100 text-blue-800' :
                    u.status === 'maintenance_hold' ? 'bg-gray-100 text-gray-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>{u.status.replace(/_/g, ' ')}</span>
                </td>
                <td className="py-2 px-2">{u.tenant_name || '—'}</td>
                <td className="py-2 px-2">{u.lease_end || '—'}</td>
                <td className="py-2 px-2 font-mono">{fmtUSD(u.monthly_rent)}</td>
                <td className="py-2 px-2">
                  {u.arrears > 0
                    ? <span className="text-red-600 font-medium font-mono">{fmtUSD(u.arrears)}</span>
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── month selector helpers ────────────────────────────────────────────────────
function buildMonthOptions(count = 24) {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    opts.push({ value, label });
  }
  return opts;
}
const MONTH_OPTS = buildMonthOptions(24);
const THIS_MONTH = MONTH_OPTS[0].value;

export default function RentalCompanyDashboard({ companyId }: Props) {
  const [selectedMonth, setSelectedMonth] = useState(THIS_MONTH);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dashTab, setDashTab] = useState<DashTab>('overview');
  const [maintenance, setMaintenance] = useState<MaintItem[] | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [pl, setPl] = useState<FinItem[] | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dashRes, finRes] = await Promise.allSettled([
        api.get<DashboardData>(`/api/rentals/companies/${companyId}/dashboard?month=${selectedMonth}`),
        api.get<{ company_name: string; pl: FinItem[] }>(`/api/rentals/financials/${companyId}`),
      ]);
      if (dashRes.status === 'fulfilled') setData(dashRes.value.data);
      else setError('Failed to load company dashboard.');
      if (finRes.status === 'fulfilled') setPl(finRes.value.data.pl ?? []);
    } finally {
      setLoading(false);
    }
  }, [companyId, selectedMonth]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Derive expense breakdown from P&L using the same category-matcher as the Expenses tab.
  // Falls back to the API field if no P&L upload exists.
  const localExpBreakdown = useMemo((): CategoryAmount[] => {
    if (!pl?.length) return data?.expense_breakdown ?? [];
    const totals = buildCategoryTotals(pl);
    return Object.entries(totals)
      .map(([category, amount]) => ({ category, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount);
  }, [pl, data?.expense_breakdown]);

  // Monthly expense totals from P&L (normalised to "Mon YYYY" keys).
  const plMonthExp = useMemo(() => pl?.length ? buildMonthlyExpense(pl) : {}, [pl]);

  // Monthly revenue (billed) totals from P&L.
  const plMonthBilled = useMemo(() => pl?.length ? buildMonthlyRevenue(pl) : {}, [pl]);

  // Merge P&L billed/expense into the API income_trend (which has correct collected values).
  const enrichedTrend = useMemo(() => {
    if (!data) return [];
    return data.income_trend.map(pt => {
      const norm = pt.month.replace(/-/g, ' ');
      return {
        ...pt,
        billed:  plMonthBilled[norm] ?? plMonthBilled[pt.month] ?? pt.billed,
        expense: plMonthExp[norm]    ?? plMonthExp[pt.month]    ?? pt.expense,
      };
    });
  }, [data, plMonthBilled, plMonthExp]);

  // Lazy-load maintenance on first visit to that tab
  useEffect(() => {
    if (dashTab === 'maintenance' && maintenance === null) {
      setSubLoading(true);
      api.get<{ items: MaintItem[] }>(`/api/rentals/maintenance?company_id=${companyId}`)
        .then(r => setMaintenance(r.data.items))
        .catch(() => setMaintenance([]))
        .finally(() => setSubLoading(false));
    }
  }, [dashTab, companyId, maintenance]);

  if (loading) return <LoadingSkeleton rows={8} />;
  if (error || !data) return <div className="text-red-600 p-4">{error || 'No data'}</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-charcoal">{data.company_name}</h2>
          <p className="text-sm text-gray-500">
            {data.property_name} · {data.total_units} units · {data.occupied_units} occupied · {data.vacant_units} vacant
          </p>
        </div>
        {/* Month / Year selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-sans text-gray-500 whitespace-nowrap">Viewing month</label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-sans bg-white focus:outline-none focus:ring-2 focus:ring-[#0E3B36] cursor-pointer"
          >
            {MONTH_OPTS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {loading && <span className="text-xs text-gray-400 font-sans">Loading…</span>}
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setDashTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              dashTab === t.id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ──────────────────────────────────────────────────────── */}
      {dashTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Occupancy"       value={fmtPct(data.occupancy_pct)}           sub={`${data.occupied_units} / ${data.total_units} units`} accent />
            <KpiCard label="Occupied / Vacant" value={`${data.occupied_units} / ${data.vacant_units}`} sub={`${data.total_units} total units`} />
            <KpiCard label="Rent Collected"  value={fmtUSD(data.collected_this_month)}    sub={`of ${fmtUSD(data.billed_this_month)} due`} />
            <KpiCard label="Arrears"         value={fmtUSD(data.arrears_total)} />
            <KpiCard label="NOI This Month"  value={fmtUSD(data.noi_this_month)}          sub={`Exp: ${fmtUSD(data.total_expense_this_month)}`} accent />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Income Trend — 6 Months">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={enrichedTrend}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="billed"    stroke="#D4AF37" name="Billed"    strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="collected" stroke="#22A06B" name="Collected" strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="expense"   stroke="#EB5757" name="Expense"   strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Expense Breakdown">
              {localExpBreakdown.length === 0 ? (
                <p className="text-gray-400 text-center py-10">No expense data — upload a P&amp;L to see breakdown</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart margin={{ top: 20, right: 12, bottom: 72, left: 12 }}>
                    <Pie
                      data={localExpBreakdown}
                      dataKey="amount"
                      nameKey="category"
                      cx="50%" cy="52%" innerRadius={42} outerRadius={72} paddingAngle={2}
                    >
                      {localExpBreakdown.map((_, i) => (
                        <Cell key={i} fill={EXP_PALETTE[i % EXP_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtUSD(v)} />
                    <Legend
                      verticalAlign="bottom"
                      align="center"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 11, lineHeight: '16px', paddingTop: 4 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          <Card title={`Unit Occupancy — ${MONTH_OPTS.find(o => o.value === selectedMonth)?.label ?? selectedMonth}`}>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 font-sans">
              Unit status and tenant data reflect the <strong>current state</strong> in the registry — not a historical snapshot for the selected month. KPI tiles above (Collected, NOI, Billed) are correctly filtered by month.
            </p>
            <UnitFilterBar units={data.units} />
          </Card>

          <Card title="Ownership & Partner NOI Share">
            <div className="space-y-3">
              {data.partner_distribution.map((p, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">
                      {p.partner_name}{' '}
                      <span className="text-gray-400 font-normal text-xs">({p.role.replace(/_/g, ' ')})</span>
                    </span>
                    <span className={p.is_shortfall ? 'text-red-600' : 'text-green-700'}>{fmtUSD(p.noi_share)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${(p.ownership_pct * 100).toFixed(1)}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">{(p.ownership_pct * 100).toFixed(1)}% ownership</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── RENTALS ───────────────────────────────────────────────────────── */}
      {dashTab === 'leases' && (
        <Card title="Active Rentals">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 px-2 font-medium">Unit</th>
                  <th className="py-2 px-2 font-medium">Tenant</th>
                  <th className="py-2 px-2 font-medium">Status</th>
                  <th className="py-2 px-2 font-medium">Monthly Rent</th>
                  <th className="py-2 px-2 font-medium">Lease End</th>
                  <th className="py-2 px-2 font-medium">Arrears</th>
                </tr>
              </thead>
              <tbody>
                {data.units
                  .filter(u => u.tenant_name || u.status === 'occupied' || u.status === 'notice')
                  .map(u => (
                    <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 px-2 font-mono">{u.unit_number}</td>
                      <td className="py-2 px-2">{u.tenant_name || '—'}</td>
                      <td className="py-2 px-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[u.status] ?? 'bg-gray-100 text-gray-800'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="py-2 px-2">{fmtUSD(u.monthly_rent)}</td>
                      <td className="py-2 px-2">
                        {u.lease_end
                          ? <span className={new Date(u.lease_end) < new Date(Date.now() + 90 * 86400000) ? 'text-amber-600 font-medium' : ''}>
                              {u.lease_end}
                            </span>
                          : '—'}
                      </td>
                      <td className="py-2 px-2">
                        {u.arrears > 0
                          ? <span className="text-red-600 font-medium">{fmtUSD(u.arrears)}</span>
                          : '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {data.units.filter(u => u.tenant_name || u.status === 'occupied' || u.status === 'notice').length === 0 && (
              <p className="text-gray-400 text-center py-8 text-sm">No active leases</p>
            )}
          </div>
        </Card>
      )}

      {/* ── MAINTENANCE ───────────────────────────────────────────────────── */}
      {dashTab === 'maintenance' && (
        <Card title="Maintenance Requests">
          {subLoading ? (
            <LoadingSkeleton rows={4} />
          ) : !maintenance || maintenance.length === 0 ? (
            <p className="text-gray-400 text-center py-8 text-sm">No maintenance requests</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 px-2 font-medium">Unit</th>
                    <th className="py-2 px-2 font-medium">Title</th>
                    <th className="py-2 px-2 font-medium">Category</th>
                    <th className="py-2 px-2 font-medium">Priority</th>
                    <th className="py-2 px-2 font-medium">Status</th>
                    <th className="py-2 px-2 font-medium">SLA</th>
                    <th className="py-2 px-2 font-medium">Days Open</th>
                    <th className="py-2 px-2 font-medium">Vendor</th>
                    <th className="py-2 px-2 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenance.map(m => (
                    <tr key={m.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 px-2 font-mono">{m.unit_number}</td>
                      <td className="py-2 px-2 max-w-[180px] truncate">{m.title}</td>
                      <td className="py-2 px-2 capitalize">{m.category.replace(/_/g, ' ')}</td>
                      <td className="py-2 px-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PRIORITY_PILL[m.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                          {m.priority}
                        </span>
                      </td>
                      <td className="py-2 px-2 capitalize">{m.status.replace(/_/g, ' ')}</td>
                      <td className="py-2 px-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SLA_PILL[m.sla_status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {m.sla_status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-2">{m.days_open ?? '—'}</td>
                      <td className="py-2 px-2">{m.vendor_name || '—'}</td>
                      <td className="py-2 px-2">{m.cost != null ? fmtUSD(m.cost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
