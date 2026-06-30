import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, ChevronDown, ChevronRight, ChevronUp, Sparkles } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BudgetSummary {
  total_budget: number;
  total_actual: number;
  total_committed: number;
  count_over_budget: number;
  overall_variance_pct: number;
}

interface SovSummaryBucket {
  total_contract_value: number;
  total_earned: number;
  total_billed: number;
  total_underbilled: number;
  total_overbilled: number;
  count_missing_dates: number;
  count_pending_approval: number;
}

interface SovSummary {
  combined: SovSummaryBucket;
  master: SovSummaryBucket;
  subcontractors: SovSummaryBucket;
}

interface SovException {
  type: string;
  sov_id: string;
  sov_name: string;
  message: string;
}

interface SovRow {
  id: string;
  trade_name: string;
  division_label: string | null;
  csi_division_code: string | null;
  vendor_name: string | null;
  sov_type: string;
  sov_status: string;
  sov_start_date: string | null;
  sov_end_date: string | null;
  contract_amount: number;
  pct_complete: number;
  cost_impact: number;
  committed_cost: number;
  overrun_pct: number;
  created_by: string | null;
  created_at: string;
  earned_to_date: number;
  billed_to_date: number;
  balance_to_finish: number;
  billing_variance: number;
  billing_variance_pct: number | null;
  billing_status: string;
  variance_status: string;
  // AIA G702/G703 billing detail
  prior_period_completed: number | null;
  current_period_completed: number | null;
  stored_materials: number;
  retainage_pct: number | null;
}

interface AiaForm {
  prior_period_completed: string;
  current_period_completed: string;
  stored_materials: string;
  retainage_pct: string;
  editing: boolean;
}

interface SovData {
  project_id: string;
  project_code: string | null;
  project_name: string;
  budget_summary: BudgetSummary;
  summary: SovSummary;
  exceptions: SovException[];
  master_sov: SovRow | null;
  subcontractor_sovs: SovRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

function fmtDate(s: string | null | undefined) {
  if (!s) return null;
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return null;
  return [fmtDate(start), fmtDate(end)].filter(Boolean).join(' – ');
}

function fmtCreatedDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function InlineProgress({ pct }: { pct: number }) {
  const fill = Math.min(1, Math.max(0, pct)) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[48px]">
        <div className="h-full bg-accent rounded-full" style={{ width: `${fill}%` }} />
      </div>
      <span className="text-xs tabular-nums text-charcoal w-10 text-right">
        {(pct * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function CostImpactCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-gray-400 tabular-nums">—</span>;
  if (value > 0)
    return <span className="text-red-600 font-medium tabular-nums">+{fmtUSD(value)}</span>;
  return <span className="text-green-700 font-medium tabular-nums">−{fmtUSD(Math.abs(value))}</span>;
}

const EXCEPTION_ICONS: Record<string, React.ReactNode> = {
  missing_dates: <Calendar size={13} />,
  untitled:      <AlertTriangle size={13} />,
  overbilled:    <AlertTriangle size={13} />,
  underbilled:   <AlertTriangle size={13} />,
  cost_impact:   <AlertTriangle size={13} />,
};

const EXCEPTION_COLORS: Record<string, string> = {
  missing_dates: 'border-amber-300 bg-amber-50 text-amber-900',
  untitled:      'border-red-300 bg-red-50 text-red-900',
  overbilled:    'border-red-300 bg-red-50 text-red-900',
  underbilled:   'border-amber-300 bg-amber-50 text-amber-900',
  cost_impact:   'border-amber-300 bg-amber-50 text-amber-900',
};

function ExceptionPanel({
  exceptions,
}: {
  exceptions: SovException[];
}) {
  if (exceptions.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-amber-800 flex items-center gap-1.5 mb-3">
        <AlertTriangle size={14} className="text-amber-600" />
        Attention Required — {exceptions.length} item{exceptions.length !== 1 ? 's' : ''}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {exceptions.map((ex) => (
          <div
            key={`${ex.type}-${ex.sov_id}`}
            className={`p-3 rounded-lg border ${EXCEPTION_COLORS[ex.type] ?? 'border-gray-200 bg-gray-50'}`}
          >
            <p className="text-xs font-semibold flex items-center gap-1">
              {EXCEPTION_ICONS[ex.type]}
              {ex.sov_name}
            </p>
            <p className="text-xs mt-1 opacity-80">{ex.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiaBillingDrawer({
  row, form, canWrite, saving, msg,
  onFormChange, onSave, onEdit, onCancel,
}: {
  row: SovRow;
  form: AiaForm;
  canWrite: boolean;
  saving: boolean;
  msg: string;
  onFormChange: (f: AiaForm) => void;
  onSave: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const earnedToDate = safe(row.earned_to_date);

  const prior = form.prior_period_completed !== '' ? parseFloat(form.prior_period_completed) : null;
  const current = form.current_period_completed !== '' ? parseFloat(form.current_period_completed) : null;
  const liveSum = prior != null && current != null ? prior + current : null;
  const liveDiff = liveSum != null ? Math.abs(liveSum - earnedToDate) : null;
  const liveValid = liveDiff != null ? liveDiff <= 1 : true;

  return (
    <div className="bg-gray-50 border-t border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AIA G702/G703 Billing Detail</p>
        {canWrite && !form.editing && (
          <button onClick={onEdit} className="text-xs text-accent hover:text-accent-dark">Edit</button>
        )}
        {canWrite && form.editing && (
          <div className="flex gap-3">
            <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            <button
              onClick={onSave}
              disabled={saving || !liveValid}
              className="text-xs text-white bg-accent hover:bg-blue-700 px-2.5 py-1 rounded disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Previous Completed */}
        <div>
          <p className="text-xs text-gray-400 mb-1">Previous Completed</p>
          {form.editing ? (
            <input
              type="number" step="0.01" placeholder="0.00"
              value={form.prior_period_completed}
              onChange={(e) => onFormChange({ ...form, prior_period_completed: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-accent"
            />
          ) : (
            <p className="text-sm font-medium text-charcoal">
              {row.prior_period_completed != null ? fmtUSD(row.prior_period_completed) : <span className="text-gray-400 italic">Not set</span>}
            </p>
          )}
        </div>

        {/* This Period */}
        <div>
          <p className="text-xs text-gray-400 mb-1">This Period</p>
          {form.editing ? (
            <input
              type="number" step="0.01" placeholder="0.00"
              value={form.current_period_completed}
              onChange={(e) => onFormChange({ ...form, current_period_completed: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-accent"
            />
          ) : (
            <p className="text-sm font-medium text-charcoal">
              {row.current_period_completed != null ? fmtUSD(row.current_period_completed) : <span className="text-gray-400 italic">Not set</span>}
            </p>
          )}
        </div>

        {/* Stored Materials */}
        <div>
          <p className="text-xs text-gray-400 mb-1">Stored Materials</p>
          {form.editing ? (
            <input
              type="number" step="0.01" placeholder="0.00"
              value={form.stored_materials}
              onChange={(e) => onFormChange({ ...form, stored_materials: e.target.value })}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-accent"
            />
          ) : (
            <p className="text-sm font-medium text-charcoal">{fmtUSD(row.stored_materials ?? 0)}</p>
          )}
        </div>

        {/* Retainage % */}
        <div>
          <p className="text-xs text-gray-400 mb-1">Retainage %</p>
          {form.editing ? (
            <div className="flex items-center gap-1">
              <input
                type="number" step="0.1" min="0" max="100" placeholder="10"
                value={form.retainage_pct}
                onChange={(e) => onFormChange({ ...form, retainage_pct: e.target.value })}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-accent"
              />
              <span className="text-sm text-gray-400">%</span>
            </div>
          ) : (
            <p className="text-sm font-medium text-charcoal">
              {row.retainage_pct != null ? `${(row.retainage_pct * 100).toFixed(1)}%` : <span className="text-gray-400 italic">Not set</span>}
            </p>
          )}
        </div>
      </div>

      {/* Live validation feedback while editing */}
      {form.editing && liveSum != null && (
        <div className={`mt-3 text-xs flex items-start gap-1.5 ${liveValid ? 'text-green-700' : 'text-red-600'}`}>
          {liveValid
            ? `✓ Prior + This Period (${fmtUSD(liveSum)}) matches Earned to Date (${fmtUSD(earnedToDate)})`
            : `⚠ Prior + This Period = ${fmtUSD(liveSum)} — must equal Earned to Date ${fmtUSD(earnedToDate)} (within $1)`}
        </div>
      )}

      {/* Save result message */}
      {msg && (
        <p className={`mt-2 text-xs ${msg === 'Saved.' ? 'text-green-700' : 'text-red-600'}`}>{msg}</p>
      )}

      {/* Read-only summary line */}
      {!form.editing && row.prior_period_completed != null && row.current_period_completed != null && (
        <p className="mt-3 text-xs text-gray-400">
          Prior + This Period = {fmtUSD(row.prior_period_completed + row.current_period_completed)}
          {' '}· Earned to Date = {fmtUSD(earnedToDate)}
          {' '}· {Math.abs(row.prior_period_completed + row.current_period_completed - earnedToDate) <= 1
            ? <span className="text-green-700">✓ Balanced</span>
            : <span className="text-amber-600">⚠ Drift detected — edit to reconcile</span>}
        </p>
      )}
    </div>
  );
}

function MasterSOVCard({ sov }: { sov: SovRow }) {
  const name = sov.division_label || sov.trade_name.replace(/_/g, ' ') || 'Master SOV';
  const dateRange = fmtDateRange(sov.sov_start_date, sov.sov_end_date);
  const fillPct = Math.min(100, safe(sov.pct_complete) * 100);

  return (
    <div className="bg-transparent rounded-xl border border-gray-200 shadow-sm">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="font-semibold text-primary text-base">{name}</p>
          <p className="text-xs text-gray-400 mt-0.5">GC ↔ Owner · Master SOV</p>
        </div>
        <StatusPill status={sov.sov_status} />
      </div>
      <div className="p-5 space-y-4">
        {sov.created_by && (
          <p className="text-xs text-gray-500">
            Created by <span className="font-medium text-charcoal">{sov.created_by}</span>
            {' '}· {fmtCreatedDate(sov.created_at)}
          </p>
        )}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Completion</span>
            <span className="font-medium text-charcoal">{fillPct.toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${fillPct}%` }} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-1">
          <div>
            <p className="text-xs text-gray-500">Original</p>
            <p className="text-sm font-semibold text-charcoal mt-0.5">{fmtUSD(sov.contract_amount)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Earned</p>
            <p className="text-sm font-semibold text-charcoal mt-0.5">{fmtUSD(sov.earned_to_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Billed</p>
            <p className="text-sm font-semibold text-charcoal mt-0.5">{fmtUSD(sov.billed_to_date)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Balance</p>
            <p className="text-sm font-semibold text-charcoal mt-0.5">{fmtUSD(sov.balance_to_finish)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Dates</p>
            <p className="text-sm text-charcoal mt-0.5">
              {dateRange ?? <span className="text-gray-400 italic">No dates set</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

function makeAiaForm(row: SovRow): AiaForm {
  return {
    prior_period_completed: row.prior_period_completed != null ? String(row.prior_period_completed) : '',
    current_period_completed: row.current_period_completed != null ? String(row.current_period_completed) : '',
    stored_materials: String(row.stored_materials ?? 0),
    retainage_pct: row.retainage_pct != null ? String(row.retainage_pct * 100) : '',
    editing: false,
  };
}

export default function ConstructionSOV({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth();
  const [data, setData] = useState<SovData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{ id: string; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [aiaForms, setAiaForms] = useState<Record<string, AiaForm>>({});
  const [aiaSaving, setAiaSaving] = useState<Record<string, boolean>>({});
  const [aiaMsg, setAiaMsg] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string>('overrun_pct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await api.get<SovData>(`/api/real-estate/costs/sov/${projectId}`);
      setData(d);
    } catch {
      setError('Failed to load SOV data.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExplain = async (tradeId: string) => {
    setExplaining(tradeId);
    setExplanation(null);
    try {
      const { data: res } = await api.post<{ explanation: string }>(
        '/api/real-estate/ai/explain-overrun', { trade_id: tradeId },
      );
      setExplanation({ id: tradeId, text: res.explanation });
    } catch {
      setExplanation({ id: tradeId, text: 'Unable to generate explanation.' });
    } finally {
      setExplaining(null);
    }
  };

  const handleAiaSave = async (tradeId: string, form: AiaForm, earnedToDate: number) => {
    setAiaSaving((s) => ({ ...s, [tradeId]: true }));
    setAiaMsg((m) => ({ ...m, [tradeId]: '' }));
    const prior = form.prior_period_completed !== '' ? parseFloat(form.prior_period_completed) : null;
    const current = form.current_period_completed !== '' ? parseFloat(form.current_period_completed) : null;
    // Client-side pre-check so the user gets instant feedback
    if (prior != null && current != null) {
      const diff = Math.abs(prior + current - earnedToDate);
      if (diff > 1) {
        setAiaMsg((m) => ({
          ...m,
          [tradeId]: `Prior + This Period = ${fmtUSD(prior + current)} but Earned = ${fmtUSD(earnedToDate)} ($${diff.toFixed(2)} outside $1 tolerance)`,
        }));
        setAiaSaving((s) => ({ ...s, [tradeId]: false }));
        return;
      }
    }
    try {
      await api.patch(`/api/real-estate/costs/trades/${tradeId}/aia-billing`, {
        prior_period_completed: prior,
        current_period_completed: current,
        stored_materials: form.stored_materials !== '' ? parseFloat(form.stored_materials) : null,
        retainage_pct: form.retainage_pct !== '' ? parseFloat(form.retainage_pct) / 100 : null,
      });
      setAiaMsg((m) => ({ ...m, [tradeId]: 'Saved.' }));
      setAiaForms((f) => ({ ...f, [tradeId]: { ...f[tradeId], editing: false } }));
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed.';
      setAiaMsg((m) => ({ ...m, [tradeId]: msg }));
    } finally {
      setAiaSaving((s) => ({ ...s, [tradeId]: false }));
    }
  };

  if (!projectId) return <p className="text-gray-400 text-center py-12">Select a project.</p>;
  if (loading) return <LoadingSkeleton rows={5} />;
  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!data) return null;

  const bs = data.budget_summary;
  const subs = data.subcontractor_sovs;
  const missingDates = data.summary.combined.count_missing_dates;

  // ── Merged division table columns ────────────────────────────────────────

  const divColumns: Column<SovRow & Record<string, unknown>>[] = [
    {
      key: 'csi_division_code',
      label: 'CSI',
      render: (r) => <span className="text-xs font-mono text-gray-500">{r.csi_division_code || '—'}</span>,
      sortValue: (r) => r.csi_division_code || '',
    },
    {
      key: 'division_label',
      label: 'Division',
      render: (r) => {
        const name = r.division_label || r.trade_name.replace(/_/g, ' ');
        return <span className="font-medium text-sm text-charcoal whitespace-nowrap">{name}</span>;
      },
      sortValue: (r) => r.division_label || r.trade_name,
    },
    {
      key: 'vendor_name',
      label: 'Vendor',
      render: (r) => (
        r.vendor_name
          ? <span className="text-sm text-charcoal">{r.vendor_name}</span>
          : <span className="text-sm text-gray-400">—</span>
      ),
      sortValue: (r) => r.vendor_name || '',
    },
    {
      key: 'sov_status',
      label: 'Status',
      render: (r) => <StatusPill status={r.sov_status} />,
      sortValue: (r) => r.sov_status,
    },
    {
      key: 'contract_amount',
      label: 'Budget',
      render: (r) => <span className="tabular-nums text-sm">{fmtUSD(r.contract_amount)}</span>,
      sortValue: (r) => safe(r.contract_amount),
    },
    {
      key: 'billed_to_date',
      label: 'Actual',
      render: (r) => <span className="tabular-nums text-sm">{fmtUSD(r.billed_to_date)}</span>,
      sortValue: (r) => safe(r.billed_to_date),
    },
    {
      key: 'committed_cost',
      label: 'Committed',
      render: (r) => <span className="tabular-nums text-sm">{fmtUSD(r.committed_cost)}</span>,
      sortValue: (r) => safe(r.committed_cost),
    },
    {
      key: 'cost_impact',
      label: 'Cost Impact',
      render: (r) => <CostImpactCell value={safe(r.cost_impact)} />,
      sortValue: (r) => safe(r.cost_impact),
    },
    {
      key: 'pct_complete',
      label: '% Complete',
      render: (r) => <InlineProgress pct={safe(r.pct_complete)} />,
      sortValue: (r) => safe(r.pct_complete),
    },
    {
      key: 'balance_to_finish',
      label: 'Balance',
      render: (r) => <span className="tabular-nums text-sm">{fmtUSD(r.balance_to_finish)}</span>,
      sortValue: (r) => safe(r.balance_to_finish),
    },
    {
      key: 'overrun_pct',
      label: 'Variance',
      render: (r) => {
        const pct = safe(r.overrun_pct);
        const cls = pct > 0.05
          ? 'text-red-600 font-semibold'
          : pct < -0.01
          ? 'text-green-700'
          : 'text-gray-500';
        return <span className={`tabular-nums text-sm ${cls}`}>{fmtPct(pct)}</span>;
      },
      sortValue: (r) => safe(r.overrun_pct),
    },
    {
      key: 'variance_status',
      label: 'Financial Status',
      render: (r) => <StatusPill status={r.variance_status} />,
      sortValue: (r) => r.variance_status,
    },
    {
      key: 'dates',
      label: 'Dates',
      render: (r) => {
        const range = fmtDateRange(r.sov_start_date, r.sov_end_date);
        if (range) return <span className="text-xs text-charcoal whitespace-nowrap">{range}</span>;
        // Amber weight when there is real progress but no schedule baseline
        if (safe(r.pct_complete) > 0) {
          return <span className="text-xs text-amber-600 font-medium">No dates set</span>;
        }
        return <span className="text-xs text-gray-400 italic">No dates set</span>;
      },
      sortValue: (r) => r.sov_start_date || '',
    },
    {
      key: 'actions',
      label: '',
      render: (r) =>
        (r.variance_status === 'watch' || r.variance_status === 'over_budget') ? (
          <button
            onClick={() => handleExplain(r.id)}
            disabled={explaining === r.id}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-dark disabled:opacity-50 whitespace-nowrap"
          >
            <Sparkles size={12} />
            {explaining === r.id ? '…' : 'Explain'}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">

      {/* Section 1: KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Budget"          value={fmtUSD(bs.total_budget)} accent />
        <KpiCard label="Total Actual"          value={fmtUSD(bs.total_actual)} />
        <KpiCard label="Total Committed"       value={fmtUSD(bs.total_committed)} />
        <KpiCard
          label="Overall Variance"
          value={`${bs.overall_variance_pct > 0 ? '+' : ''}${bs.overall_variance_pct.toFixed(1)}%`}
          sub={bs.overall_variance_pct > 5 ? 'over budget' : bs.overall_variance_pct < -1 ? 'under budget' : 'on track'}
        />
        <KpiCard
          label="Divisions Over Budget"
          value={bs.count_over_budget > 0 ? String(bs.count_over_budget) : '—'}
          accent={bs.count_over_budget > 0}
        />
        <KpiCard
          label="Missing Dates"
          value={missingDates > 0 ? String(missingDates) : '—'}
        />
      </div>

      {/* Section 2: Attention Required */}
      {data.exceptions.length > 0 && (
        <ExceptionPanel exceptions={data.exceptions} />
      )}

      {/* AI explanation card — shown when an explain result is available */}
      {explanation && (
        <Card title="AI Cost Explanation">
          <p className="text-sm text-charcoal">{explanation.text}</p>
          <button
            onClick={() => setExplanation(null)}
            className="text-xs text-gray-400 mt-2 hover:text-gray-600"
          >
            Dismiss
          </button>
        </Card>
      )}

      {/* Section 3: Master SOV */}
      {data.master_sov ? (
        <div>
          <h3 className="text-sm font-semibold text-charcoal mb-2">Master SOV</h3>
          <MasterSOVCard sov={data.master_sov} />
        </div>
      ) : (
        <div className="text-sm text-gray-400 italic px-1">
          No Master SOV configured for this project — set <code>sov_type = &apos;master&apos;</code> on the GC↔Owner cost trade to surface it here.
        </div>
      )}

      {/* Section 4: Division table — merged Costs & SOV with expandable AIA drawer */}
      <ErrorBoundary>
        <Card title={`Cost Divisions (${subs.length})`}>
          {subs.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">No cost divisions for this project.</p>
          ) : (() => {
            // Sort
            const handleColSort = (col: Column<SovRow & Record<string, unknown>>) => {
              if (!col.sortValue) return;
              if (sortKey === col.key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
              else { setSortKey(col.key); setSortDir('asc'); }
            };
            const sortedSubs = [...subs].sort((a, b) => {
              const col = divColumns.find((c) => c.key === sortKey);
              if (!col?.sortValue) return 0;
              const av = col.sortValue(a as SovRow & Record<string, unknown>);
              const bv = col.sortValue(b as SovRow & Record<string, unknown>);
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              return sortDir === 'asc' ? cmp : -cmp;
            });

            const toggleExpand = (row: SovRow) => {
              if (expandedId === row.id) {
                setExpandedId(null);
              } else {
                setExpandedId(row.id);
                if (!aiaForms[row.id]) {
                  setAiaForms((f) => ({ ...f, [row.id]: makeAiaForm(row) }));
                }
              }
            };

            return (
              <>
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        {divColumns.map((col) => (
                          <th
                            key={col.key}
                            className={`py-3 px-2 font-medium whitespace-nowrap ${col.sortValue ? 'cursor-pointer select-none hover:text-primary' : ''}`}
                            onClick={() => handleColSort(col as Column<SovRow & Record<string, unknown>>)}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                            </span>
                          </th>
                        ))}
                        <th className="py-3 px-2 w-8" title="Expand AIA billing detail" />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSubs.map((row) => {
                        const isExpanded = expandedId === row.id;
                        const form = aiaForms[row.id];
                        return (
                          <>
                            <tr
                              key={row.id}
                              className={`border-b border-gray-50 hover:bg-gray-50/50 ${isExpanded ? 'bg-gray-50' : ''}`}
                            >
                              {divColumns.map((col) => (
                                <td key={col.key} className="py-3 px-2">
                                  {col.render
                                    ? col.render(row as SovRow & Record<string, unknown>)
                                    : String((row as Record<string, unknown>)[col.key] ?? '—')}
                                </td>
                              ))}
                              <td className="py-3 px-2">
                                <button
                                  onClick={() => toggleExpand(row)}
                                  className="text-gray-400 hover:text-accent transition-colors"
                                  title={isExpanded ? 'Collapse AIA billing' : 'Expand AIA billing'}
                                >
                                  {isExpanded ? <ChevronUp size={14} /> : <ChevronRight size={14} />}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && form && (
                              <tr key={`${row.id}-aia`}>
                                <td colSpan={divColumns.length + 1} className="p-0">
                                  <AiaBillingDrawer
                                    row={row}
                                    form={form}
                                    canWrite={canWrite}
                                    saving={!!aiaSaving[row.id]}
                                    msg={aiaMsg[row.id] ?? ''}
                                    onFormChange={(f) => setAiaForms((prev) => ({ ...prev, [row.id]: f }))}
                                    onSave={() => handleAiaSave(row.id, form, row.earned_to_date)}
                                    onEdit={() => setAiaForms((prev) => ({ ...prev, [row.id]: { ...form, editing: true } }))}
                                    onCancel={() => {
                                      setAiaForms((prev) => ({ ...prev, [row.id]: makeAiaForm(row) }));
                                      setAiaMsg((m) => ({ ...m, [row.id]: '' }));
                                    }}
                                  />
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 mt-3 border-t border-gray-100 pt-2 px-0">
                  Balance = (Budget + Cost Impact) × (1 − % complete). Click <ChevronRight size={11} className="inline" /> to expand AIA billing detail per division.
                  Default sort: highest variance first.
                </p>
              </>
            );
          })()}
        </Card>
      </ErrorBoundary>
    </div>
  );
}
