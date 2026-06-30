import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

type Tab = 'occupancy' | 'opex' | 'loan' | 'pl' | 'cash_flow';

const TABS: { id: Tab; label: string }[] = [
  { id: 'occupancy', label: 'Unit Occupancy' },
  { id: 'opex', label: 'Operating Expenses' },
  { id: 'loan', label: 'Loan & Ownership' },
  { id: 'pl', label: 'P&L Summary' },
  { id: 'cash_flow', label: '13-Week Cash Flow' },
];

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface PropertyDetail {
  id: string;
  property_code: string;
  property_name: string;
  city?: string;
  state?: string;
  asset_class: string;
  occupancy: { occupied_units: number; total_units: number; occupancy_pct: number | null };
  financial_strength: { dscr: number | null; dscr_status: string | null; cap_rate_on_current_value: number | null };
  latest_period?: string;
  pl_summary?: PlSummary;
}

interface UnitRow extends Record<string, unknown> {
  id: string;
  unit_number: string;
  unit_type: string;
  sqft: number | null;
  status: string;
  tenant_name: string | null;
  market_rent: number;
  actual_rent: number | null;
  rental_loss_monthly: number;
  lease_start: string | null;
  lease_end: string | null;
  days_vacant: number | null;
}

interface OpexLine {
  id: string;
  category: string;
  sub_head: string;
  monthly_amount: number;
}

interface PlSummary {
  gross_potential_rent: number;
  vacancy_loss: number;
  concession_loss: number;
  effective_gross_income: number;
  total_operating_expenses: number;
  net_operating_income: number;
  debt_service_interest: number;
  debt_service_principal: number;
  total_debt_service: number;
  cash_flow_after_debt_service: number;
  noi_margin_pct: number | null;
}

interface LoanData {
  lender_name: string;
  current_principal_balance: number;
  interest_rate_annual: number;
  rate_type: string;
  monthly_principal: number;
  monthly_interest: number;
  maturity_date: string | null;
}

interface OwnershipData {
  ownership: { partner_name: string; role: string; ownership_pct: number; capital_contributed: number | null }[];
  distributions: { partner_name: string; ownership_pct: number; amount: number; is_shortfall: boolean }[];
  cash_flow_after_debt_service: number;
  is_shortfall: boolean;
}

interface CashFlowWeek extends Record<string, unknown> {
  week_number: number;
  week_start_date: string;
  opening_balance: number;
  inflows: number;
  outflows: number;
  net_cash_flow: number;
  closing_balance: number;
  status: string;
  opening_mismatch: boolean;
  alert_note: string | null;
}

const OPEX_CATEGORIES = [
  'property_management', 'utilities', 'repairs_maintenance', 'insurance', 'taxes', 'administrative',
];

const STATUS_COLORS: Record<string, string> = {
  green: '#3B82F6',
  amber: '#D97706',
  red: '#DC2626',
};

export default function ReitPropertyDetail() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { canWrite } = useAuth();
  const [tab, setTab] = useState<Tab>('occupancy');
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [opexLines, setOpexLines] = useState<OpexLine[]>([]);
  const [pl, setPl] = useState<PlSummary | null>(null);
  const [loan, setLoan] = useState<LoanData | null>(null);
  const [ownership, setOwnership] = useState<OwnershipData | null>(null);
  const [cashFlow, setCashFlow] = useState<{ min_buffer_target: number; weeks: CashFlowWeek[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(OPEX_CATEGORIES));
  const [opexFormOpen, setOpexFormOpen] = useState(false);
  const [opexForm, setOpexForm] = useState({ period_month: '', category: 'property_management', sub_head: '', monthly_amount: '' });
  const [savingOpex, setSavingOpex] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError('');
    try {
      const [propRes, unitsRes, opexRes, plRes, loanRes, ownRes, cfRes] = await Promise.all([
        api.get<PropertyDetail>(`/api/reit/properties/${propertyId}`),
        api.get<UnitRow[]>(`/api/reit/properties/${propertyId}/units`),
        api.get<{ lines: OpexLine[] }>(`/api/reit/properties/${propertyId}/opex`),
        api.get<PlSummary>(`/api/reit/properties/${propertyId}/pl-summary`),
        api.get<LoanData | null>(`/api/reit/properties/${propertyId}/loan`),
        api.get<OwnershipData>(`/api/reit/properties/${propertyId}/ownership`),
        api.get<{ min_buffer_target: number; weeks: CashFlowWeek[] }>(`/api/reit/properties/${propertyId}/cash-flow-13week`),
      ]);
      setProperty(propRes.data);
      setUnits(unitsRes.data);
      setOpexLines(opexRes.data.lines);
      setPl(plRes.data);
      setLoan(loanRes.data);
      setOwnership(ownRes.data);
      setCashFlow(cfRes.data);
    } catch {
      setError('Failed to load property data.');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalRentalLoss = useMemo(
    () => units.reduce((s, u) => s + safe(u.rental_loss_monthly), 0),
    [units],
  );

  const opexByCategory = useMemo(() => {
    const map: Record<string, OpexLine[]> = {};
    for (const line of opexLines) {
      if (!map[line.category]) map[line.category] = [];
      map[line.category].push(line);
    }
    return map;
  }, [opexLines]);

  const unitColumns: Column<UnitRow>[] = [
    { key: 'unit_number', label: 'Unit', sortValue: (r) => r.unit_number },
    { key: 'unit_type', label: 'Type' },
    { key: 'sqft', label: 'Sq Ft', render: (r) => (r.sqft != null ? r.sqft.toLocaleString() : '—') },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'tenant_name', label: 'Tenant', render: (r) => r.tenant_name || '—' },
    { key: 'market_rent', label: 'Market Rent', render: (r) => fmtUSD(r.market_rent), sortValue: (r) => r.market_rent },
    { key: 'actual_rent', label: 'Actual Rent', render: (r) => (r.actual_rent != null ? fmtUSD(r.actual_rent) : '—') },
    { key: 'rental_loss_monthly', label: 'Rental Loss', render: (r) => fmtUSD(r.rental_loss_monthly), sortValue: (r) => r.rental_loss_monthly },
    { key: 'lease_start', label: 'Lease Start', render: (r) => r.lease_start || '—' },
    { key: 'lease_end', label: 'Lease End', render: (r) => r.lease_end || '—' },
    { key: 'days_vacant', label: 'Days Vacant', render: (r) => (r.days_vacant != null ? String(r.days_vacant) : '—') },
  ];

  const handleOpexSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!propertyId || !canWrite) return;
    setSavingOpex(true);
    try {
      const period = opexForm.period_month.slice(0, 7);
      await api.post(`/api/reit/properties/${propertyId}/opex`, {
        period_month: `${period}-01`,
        lines: [{
          category: opexForm.category,
          sub_head: opexForm.sub_head,
          monthly_amount: parseFloat(opexForm.monthly_amount),
        }],
      });
      setOpexFormOpen(false);
      await fetchAll();
    } catch {
      setError('Failed to save expense line.');
    } finally {
      setSavingOpex(false);
    }
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const cfChartData = (cashFlow?.weeks || []).map((w) => ({
    week: `W${w.week_number}`,
    net: w.net_cash_flow,
    closing: w.closing_balance,
  }));

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton rows={10} />
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="space-y-4">
        <Link to="/reit" className="text-sm text-accent hover:underline">← Back to portfolio</Link>
        <p className="text-red-600">{error || 'Property not found'}</p>
        <button type="button" onClick={fetchAll} className="px-4 py-2 bg-primary text-white rounded-lg text-sm">Retry</button>
      </div>
    );
  }

  const occ = property.occupancy;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/reit" className="text-sm text-accent hover:underline">← REIT Portfolio</Link>
        <h1 className="text-2xl font-bold text-charcoal mt-2">{property.property_name}</h1>
        <p className="text-sm text-gray-500">
          {property.property_code}
          {property.city ? ` · ${property.city}, ${property.state}` : ''}
          {' · '}
          {(property.asset_class || '').replace(/_/g, ' ')}
        </p>
      </div>

      {property.financial_strength.dscr_status === 'below_covenant' && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="text-red-600 shrink-0" size={20} />
          <p className="text-sm text-red-800">
            DSCR {safe(property.financial_strength.dscr).toFixed(2)}x is below the 1.20x lender covenant — debt service coverage at risk.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm rounded-t-lg transition-colors ${
              tab === t.id ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'occupancy' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard label="Occupied / Total" value={`${occ.occupied_units} / ${occ.total_units}`} accent />
            <KpiCard label="Occupancy" value={occ.occupancy_pct != null ? fmtPct(occ.occupancy_pct) : '—'} />
            <KpiCard
              label="Total Rental Loss"
              value={fmtUSD(totalRentalLoss)}
              sub={`${fmtUSD(totalRentalLoss * 12)} annualized`}
            />
          </div>
          <ErrorBoundary>
            <Card title="Unit Roll">
              <Table columns={unitColumns} data={units} emptyMessage="No units" />
            </Card>
          </ErrorBoundary>
        </>
      )}

      {tab === 'opex' && (
        <ErrorBoundary>
          <Card title={`Operating Expenses${property.latest_period ? ` — ${property.latest_period.slice(0, 7)}` : ''}`}>
            {canWrite && (
              <div className="mb-4">
                <button type="button" onClick={() => setOpexFormOpen(!opexFormOpen)} className="text-sm text-accent hover:underline">
                  {opexFormOpen ? 'Hide form' : 'Log this month\'s expenses'}
                </button>
                {opexFormOpen && (
                  <form onSubmit={handleOpexSubmit} className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <input type="month" required value={opexForm.period_month} onChange={(e) => setOpexForm({ ...opexForm, period_month: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    <select value={opexForm.category} onChange={(e) => setOpexForm({ ...opexForm, category: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                      {OPEX_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                    <input required placeholder="Sub-head" value={opexForm.sub_head} onChange={(e) => setOpexForm({ ...opexForm, sub_head: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    <input required type="number" step="0.01" placeholder="Amount" value={opexForm.monthly_amount}
                      onChange={(e) => setOpexForm({ ...opexForm, monthly_amount: e.target.value })}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    <button type="submit" disabled={savingOpex} className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">
                      {savingOpex ? 'Saving…' : 'Add line'}
                    </button>
                  </form>
                )}
              </div>
            )}
            <div className="space-y-2">
              {Object.entries(opexByCategory).map(([cat, lines]) => {
                const subtotal = lines.reduce((s, l) => s + l.monthly_amount, 0);
                const expanded = expandedCategories.has(cat);
                return (
                  <div key={cat} className="border border-gray-100 rounded-lg">
                    <button type="button" onClick={() => toggleCategory(cat)} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50">
                      <span className="flex items-center gap-2 font-medium capitalize text-charcoal">
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        {cat.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm font-medium">{fmtUSD(subtotal)}</span>
                    </button>
                    {expanded && (
                      <ul className="px-4 pb-3 space-y-1 text-sm text-gray-600">
                        {lines.map((l) => (
                          <li key={l.id} className="flex justify-between">
                            <span>{l.sub_head}</span>
                            <span>{fmtUSD(l.monthly_amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </ErrorBoundary>
      )}

      {tab === 'loan' && (
        <>
          <ErrorBoundary>
            <Card title="Loan Detail">
              {loan ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                  <div><p className="text-gray-500">Lender</p><p className="font-medium">{loan.lender_name}</p></div>
                  <div><p className="text-gray-500">Principal Balance</p><p className="font-medium">{fmtUSD(loan.current_principal_balance)}</p></div>
                  <div><p className="text-gray-500">Rate</p><p className="font-medium">{(loan.interest_rate_annual * 100).toFixed(2)}% {loan.rate_type}</p></div>
                  <div><p className="text-gray-500">Monthly P&I</p><p className="font-medium">{fmtUSD(loan.monthly_principal + loan.monthly_interest)}</p></div>
                  <div><p className="text-gray-500">Principal / Interest</p><p className="font-medium">{fmtUSD(loan.monthly_principal)} / {fmtUSD(loan.monthly_interest)}</p></div>
                  <div><p className="text-gray-500">Maturity</p><p className="font-medium">{loan.maturity_date || '—'}</p></div>
                </div>
              ) : (
                <p className="text-gray-400">No loan on file</p>
              )}
            </Card>
          </ErrorBoundary>

          {ownership?.is_shortfall && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="text-amber-600 shrink-0" size={20} />
              <div className="text-sm text-amber-900">
                <p className="font-medium">Operating shortfall — not a distribution</p>
                <p className="mt-1">
                  Cash flow after debt service is {fmtUSD(ownership.cash_flow_after_debt_service)} this period.
                  Amounts below represent each partner&apos;s pro-rata share of the capital call exposure, not cash paid out.
                </p>
              </div>
            </div>
          )}

          <ErrorBoundary>
            <Card title="Ownership & Partner Allocation">
              <Table
                columns={[
                  { key: 'partner_name', label: 'Partner', sortValue: (r) => r.partner_name },
                  { key: 'ownership_pct', label: 'Ownership', render: (r) => fmtPct(r.ownership_pct) },
                  {
                    key: 'amount',
                    label: ownership?.is_shortfall ? 'Shortfall Share' : 'Distribution',
                    render: (r) => fmtUSD(r.amount),
                    sortValue: (r) => r.amount,
                  },
                ]}
                data={ownership?.distributions || []}
                keyField="partner_name"
                emptyMessage="No ownership records"
              />
            </Card>
          </ErrorBoundary>
        </>
      )}

      {tab === 'pl' && pl && (
        <ErrorBoundary>
          <Card title="P&L Waterfall">
            <div className="max-w-lg space-y-2 text-sm">
              {[
                ['Gross Potential Rent', pl.gross_potential_rent, false],
                ['Less: Vacancy Loss', -pl.vacancy_loss, true],
                ['Less: Concession Loss', -pl.concession_loss, true],
                ['Effective Gross Income', pl.effective_gross_income, false],
                ['Less: Operating Expenses', -pl.total_operating_expenses, true],
                ['Net Operating Income', pl.net_operating_income, false],
                ['Less: Debt Service (Interest)', -pl.debt_service_interest, true],
                ['Less: Debt Service (Principal)', -pl.debt_service_principal, true],
                ['Cash Flow After Debt Service', pl.cash_flow_after_debt_service, false],
              ].map(([label, amount, indent]) => (
                <div
                  key={String(label)}
                  className={`flex justify-between py-2 border-b border-gray-50 ${indent ? 'pl-4 text-gray-600' : 'font-medium text-charcoal'}`}
                >
                  <span>{label}</span>
                  <span className={Number(amount) < 0 ? 'text-red-600' : ''}>{fmtUSD(Number(amount))}</span>
                </div>
              ))}
              {pl.noi_margin_pct != null && (
                <p className="text-gray-500 pt-2">NOI margin: {fmtPct(pl.noi_margin_pct)}</p>
              )}
            </div>
          </Card>
        </ErrorBoundary>
      )}

      {tab === 'cash_flow' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <KpiCard label="Min Buffer Target" value={fmtUSD(cashFlow?.min_buffer_target)} />
            <KpiCard
              label="Week 13 Closing"
              value={cashFlow?.weeks.length ? fmtUSD(cashFlow.weeks[cashFlow.weeks.length - 1].closing_balance) : '—'}
            />
          </div>
          <ErrorBoundary>
            <Card title="13-Week Forecast">
              <Table
                columns={[
                  { key: 'week_number', label: 'Week', sortValue: (r) => r.week_number },
                  { key: 'week_start_date', label: 'Start' },
                  { key: 'opening_balance', label: 'Opening', render: (r) => fmtUSD(r.opening_balance) },
                  { key: 'inflows', label: 'Inflows', render: (r) => fmtUSD(r.inflows) },
                  { key: 'outflows', label: 'Outflows', render: (r) => fmtUSD(r.outflows) },
                  { key: 'net_cash_flow', label: 'Net', render: (r) => fmtUSD(r.net_cash_flow) },
                  {
                    key: 'closing_balance',
                    label: 'Closing',
                    render: (r) => (
                      <span className="flex items-center gap-2">
                        {fmtUSD(r.closing_balance)}
                        {r.opening_mismatch && (
                          <span title="Opening balance does not match prior week closing">
                            <AlertTriangle size={14} className="text-amber-600" />
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => (
                      <span
                        className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                        style={{
                          backgroundColor: `${STATUS_COLORS[r.status] || '#6B7280'}22`,
                          color: STATUS_COLORS[r.status] || '#6B7280',
                        }}
                      >
                        {r.status}
                      </span>
                    ),
                  },
                  { key: 'alert_note', label: 'Note', render: (r) => r.alert_note || '—' },
                ]}
                data={cashFlow?.weeks || []}
                keyField="week_number"
                emptyMessage="No cash flow forecast"
              />
            </Card>
          </ErrorBoundary>
          {cfChartData.length > 0 && (
            <ErrorBoundary>
              <Card title="Cash Flow Chart">
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={cfChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="week" />
                    <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtUSD(v)} />
                    <Legend />
                    <Bar dataKey="net" name="Net Cash Flow" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="closing" name="Closing Balance" stroke="#1E3A8A" strokeWidth={2} dot />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>
            </ErrorBoundary>
          )}
        </>
      )}
    </div>
  );
}
