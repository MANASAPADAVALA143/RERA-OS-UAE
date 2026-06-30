import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import {
  AlertTriangle, Camera, Clock, FileText, RefreshCw, ChevronRight,
} from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';
import { useConstructionNav, ALL_TABS, type Tab } from '../contexts/ConstructionNavContext';
import ConstructionSOV from './ConstructionSOV';
import ConstructionCR from './ConstructionCR';
import ConstructionWorkLog from './ConstructionWorkLog';
import ConstructionQC from './ConstructionQC';
import ConstructionInspections from './ConstructionInspections';
import ConstructionDocuments from './ConstructionDocuments';
import ConstructionPayApplications from './ConstructionPayApplications';
import ConstructionExpenses from './ConstructionExpenses';
import ConstructionTaskSchedule from './ConstructionTaskSchedule';
import ConstructionLoanTracker from './ConstructionLoanTracker';
import PD10Receivables from './propdev/PD10Receivables';
import { PropertyDevProvider } from '../contexts/PropertyDevContext';

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface Project {
  id: string;
  project_name: string;
  project_code?: string | null;
  project_type?: string | null;
  status: string;
  city?: string | null;
  state?: string | null;
  contract_value?: number | null;
  total_project_cost?: number | null;
  total_saleable_sqft?: number | null;
  target_completion_date?: string | null;
  start_date?: string | null;
  created_by?: string | null;
  description?: string | null;
  creator_role?: string | null;
  working_days?: string | null;
}

interface LatestPhotosEntry {
  id: string;
  entry_date: string;
  photo_count: number;
  photos: { id: string; file_reference: string; caption: string | null }[];
}

interface CostTrade extends Record<string, unknown> {
  id: string;
  trade_name: string;
  csi_division_code?: string | null;
  division_label?: string | null;
  vendor_name?: string | null;
  budgeted_cost: number;
  actual_cost_to_date: number;
  committed_cost: number;
  pct_complete: number;
  overrun_pct: number;
  status: string;
}

interface Permit extends Record<string, unknown> {
  id: string;
  permit_type: string;
  status: string;
  is_blocking: boolean;
  is_overdue: boolean;
  days_pending: number;
  days_overdue: number;
  target_approval_date: string | null;
}

interface ChangeOrder extends Record<string, unknown> {
  id: string;
  co_number: string;
  title: string;
  status: string;
  requested_amount: number;
  approved_amount: number | null;
  csi_division_code: string | null;
  impact_on_schedule_days: number | null;
}

interface ScheduleTask extends Record<string, unknown> {
  id: string;
  task_name: string;
  vendor_name: string | null;
  planned_end: string | null;
  pct_complete: number;
  status: string;
  is_critical: boolean;
  days_late: number;
  is_late: boolean;
}

interface ComplianceDoc extends Record<string, unknown> {
  id: string;
  vendor_name: string;
  doc_type: string;
  doc_name: string | null;
  status: string;
  expiry_date: string | null;
  is_blocking: boolean;
}

interface FinancialSnapshot extends Record<string, unknown> {
  id: string;
  period_start: string | null;
  period_end: string | null;
  received_from_owner: number;
  paid_to_subcontractors: number;
  other_expenses: number;
  retainage_held: number;
  retainage_receivable: number;
  net_realized_cash: number;
  created_at: string;
}

interface FinancialsData {
  latest: FinancialSnapshot | null;
  history: FinancialSnapshot[];
}

interface ROIAssumptions {
  total_project_cost: number | null;
  equity_pct: number | null;
  debt_pct: number | null;
  interest_rate_annual: number | null;
  construction_months: number | null;
  exit_strategy: string;
  stabilized_noi: number | null;
  exit_cap_rate: number | null;
  selling_costs_pct: number;
  configured: boolean;
}

interface ROISummary {
  configured: boolean;
  roi?: number | null;
  moic?: number | null;
  irr?: number | null;
  irr_is_simplified?: boolean;
  irr_note?: string;
  net_profit?: number | null;
  exit_value?: number | null;
  net_sale_proceeds?: number | null;
  equity_invested?: number | null;
  is_estimate?: boolean;
  estimate_note?: string;
  message?: string;
}

interface AttentionItem {
  id: string;
  category: 'permit' | 'cost' | 'schedule' | 'compliance';
  title: string;
  context: string;
  tab: Tab;
}

const EMPTY_SNAPSHOT_FORM = {
  period_start: '',
  period_end: '',
  received_from_owner: '',
  paid_to_subcontractors: '',
  other_expenses: '',
  retainage_held: '',
  retainage_receivable: '',
};

const EMPTY_ASSUMPTIONS_FORM = {
  total_project_cost: '',
  equity_pct: '',
  debt_pct: '',
  interest_rate_annual: '',
  construction_months: '',
  exit_strategy: 'forward_sale',
  stabilized_noi: '',
  exit_cap_rate: '',
  selling_costs_pct: '0.025',
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components for the Overview mission-control layout
// ─────────────────────────────────────────────────────────────────────────────

function BulletBar({ fill, target, label }: { fill: number; target: number | null; label: string }) {
  const fillPct = Math.min(1, Math.max(0, fill)) * 100;
  const targetPct = target != null ? Math.min(1, Math.max(0, target)) * 100 : null;
  const ahead = target != null && fill >= target;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-charcoal">{label}</span>
        {targetPct != null && (
          <span className={`text-xs font-medium ${ahead ? 'text-green-700' : 'text-amber-700'}`}>
            {ahead ? '▲ Ahead of schedule' : '▼ Behind schedule'} ({targetPct.toFixed(1)}% elapsed)
          </span>
        )}
      </div>
      <div className="relative h-6 bg-gray-100 rounded-full overflow-visible">
        {/* Fill bar */}
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${fillPct}%` }}
        />
        {/* Target marker */}
        {targetPct != null && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-charcoal"
            style={{ left: `${targetPct}%` }}
          >
            <span className="absolute -top-5 left-1 text-xs text-charcoal whitespace-nowrap font-medium">
              Target
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function StackedBar({
  paid, retainage, committed, total,
}: { paid: number; retainage: number; committed: number; total: number }) {
  if (total <= 0) return <p className="text-sm text-gray-400">No contract value data</p>;
  const paidPct = Math.min(100, (paid / total) * 100);
  const retainagePct = Math.min(100 - paidPct, (retainage / total) * 100);
  const committedPct = Math.min(100 - paidPct - retainagePct, (committed / total) * 100);
  return (
    <div>
      <div className="flex h-6 w-full rounded-full overflow-hidden bg-gray-100">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${paidPct}%` }}
          title={`Paid: ${fmtUSD(paid)}`}
        />
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${retainagePct}%` }}
          title={`Retainage: ${fmtUSD(retainage)}`}
        />
        <div
          className="h-full bg-blue-400 transition-all opacity-70"
          style={{ width: `${committedPct}%` }}
          title={`Committed: ${fmtUSD(committed)}`}
        />
      </div>
      <div className="flex gap-4 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary inline-block" />Paid</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-accent inline-block" />Retainage</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 opacity-70 inline-block" />Committed</span>
      </div>
    </div>
  );
}

function StatCell({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${valueClass ?? 'text-charcoal'}`}>{value}</p>
    </div>
  );
}

const ATTENTION_ICONS: Record<AttentionItem['category'], React.ReactNode> = {
  permit: <FileText size={14} />,
  cost: <AlertTriangle size={14} />,
  schedule: <Clock size={14} />,
  compliance: <FileText size={14} />,
};
const ATTENTION_COLORS: Record<AttentionItem['category'], string> = {
  permit: 'border-red-300 bg-red-50',
  cost: 'border-amber-300 bg-amber-50',
  schedule: 'border-amber-300 bg-amber-50',
  compliance: 'border-red-300 bg-red-50',
};
const ATTENTION_TEXT: Record<AttentionItem['category'], string> = {
  permit: 'text-red-800',
  cost: 'text-amber-900',
  schedule: 'text-amber-900',
  compliance: 'text-red-800',
};

function AttentionCard({ item, onNavigate }: { item: AttentionItem; onNavigate: (t: Tab) => void }) {
  return (
    <button
      onClick={() => onNavigate(item.tab)}
      className={`text-left p-3 rounded-lg border ${ATTENTION_COLORS[item.category]} hover:opacity-90 transition-opacity w-full`}
    >
      <p className={`text-sm font-semibold flex items-center gap-1 ${ATTENTION_TEXT[item.category]}`}>
        {ATTENTION_ICONS[item.category]}
        {item.title}
      </p>
      <p className="text-xs text-gray-600 mt-1">{item.context}</p>
      <p className="text-xs text-gray-400 mt-1 flex items-center gap-0.5">
        View details <ChevronRight size={10} />
      </p>
    </button>
  );
}

function VendorHeatmap({ docs }: { docs: ComplianceDoc[] }) {
  const docTypes = Array.from(new Set(docs.map((d) => d.doc_type))).sort();
  const vendorMap = new Map<string, Map<string, string>>();
  for (const d of docs) {
    if (!vendorMap.has(d.vendor_name)) vendorMap.set(d.vendor_name, new Map());
    vendorMap.get(d.vendor_name)!.set(d.doc_type, d.status);
  }

  const hasIssue = (statusMap: Map<string, string>) =>
    Array.from(statusMap.values()).some((s) => s !== 'approved' && s !== 'compliant');

  const vendorsWithIssues = Array.from(vendorMap.entries()).filter(([, m]) => hasIssue(m));
  const fullyCompliantCount = vendorMap.size - vendorsWithIssues.length;

  if (vendorsWithIssues.length === 0) {
    return <p className="text-sm text-green-700">All vendors are fully compliant.</p>;
  }

  const cellColor = (status: string | undefined) => {
    if (!status) return 'bg-gray-100 text-gray-400';
    if (status === 'approved' || status === 'compliant') return 'bg-green-100 text-green-800';
    if (status === 'missing') return 'bg-red-100 text-red-800';
    if (status === 'expired') return 'bg-red-100 text-red-800';
    return 'bg-amber-100 text-amber-800';
  };

  const cellLabel = (status: string | undefined) => {
    if (!status) return '—';
    if (status === 'approved' || status === 'compliant') return '✓';
    if (status === 'missing') return 'Missing';
    if (status === 'expired') return 'Expired';
    return status.replace(/_/g, ' ');
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className="text-left py-1 pr-3 text-gray-500 font-medium">Vendor</th>
            {docTypes.map((dt) => (
              <th key={dt} className="text-center py-1 px-2 text-gray-500 font-medium capitalize">
                {dt.replace(/_/g, ' ').replace('certificate of insurance', 'COI')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vendorsWithIssues.map(([vendor, statusMap]) => (
            <tr key={vendor} className="border-t border-gray-100">
              <td className="py-1.5 pr-3 text-charcoal font-medium max-w-[140px] truncate" title={vendor}>
                {vendor}
              </td>
              {docTypes.map((dt) => {
                const s = statusMap.get(dt);
                return (
                  <td key={dt} className="py-1.5 px-2 text-center">
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${cellColor(s)}`}>
                      {cellLabel(s)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {fullyCompliantCount > 0 && (
        <p className="text-xs text-gray-400 mt-2">+{fullyCompliantCount} vendor{fullyCompliantCount !== 1 ? 's' : ''} fully compliant</p>
      )}
    </div>
  );
}

function ScheduleDelayChart({ tasks, onViewAll }: { tasks: ScheduleTask[]; onViewAll: () => void }) {
  const lateTasks = [...tasks]
    .filter((t) => t.is_late && safe(t.days_late) > 0)
    .sort((a, b) => safe(b.days_late) - safe(a.days_late));

  const displayTasks = lateTasks.slice(0, 7);
  const remaining = lateTasks.length - displayTasks.length;

  if (displayTasks.length === 0) {
    return <p className="text-sm text-green-700">No tasks currently behind schedule.</p>;
  }

  const chartData = displayTasks.map((t) => ({
    name: t.task_name.length > 28 ? t.task_name.slice(0, 26) + '…' : t.task_name,
    days_late: safe(t.days_late),
    status: t.days_late > 30 ? 'critical' : 'late',
  }));

  return (
    <div>
      <ResponsiveContainer width="100%" height={Math.max(180, displayTasks.length * 32 + 40)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
        >
          <XAxis
            type="number"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${v}d`}
            domain={[0, 'dataMax']}
          />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
          <Tooltip formatter={(v: number) => [`${v} days late`, 'Days Late']} />
          <Bar dataKey="days_late" radius={[0, 3, 3, 0]} maxBarSize={20}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.status === 'critical' ? '#DC2626' : '#F59E0B'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {remaining > 0 && (
        <button
          onClick={onViewAll}
          className="text-xs text-accent hover:text-accent-dark flex items-center gap-0.5 mt-1"
        >
          +{remaining} more late task{remaining !== 1 ? 's' : ''} <ChevronRight size={11} />
        </button>
      )}
    </div>
  );
}

function CostExposureChart({ trades }: { trades: CostTrade[] }) {
  if (trades.length === 0) return <p className="text-sm text-gray-400 text-center py-8">No division data</p>;

  const sorted = [...trades].sort((a, b) => safe(b.overrun_pct) - safe(a.overrun_pct));

  const chartData = sorted.map((t) => ({
    name: (t.division_label || t.trade_name).replace(/_/g, ' ').slice(0, 22),
    budgeted: safe(t.budgeted_cost),
    exposure: safe(t.actual_cost_to_date) + safe(t.committed_cost),
    status: t.status,
  }));

  const statusColor = (status: string) => {
    if (status === 'over_budget') return '#DC2626';
    if (status === 'watch') return '#F59E0B';
    return '#D4AF37';
  };

  return (
    <ResponsiveContainer width="100%" height={Math.max(260, trades.length * 30 + 60)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 80, left: 8, bottom: 4 }}
      >
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={160} />
        <Tooltip formatter={(v: number) => fmtUSD(v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="budgeted" name="Budgeted" fill="#B8962E" radius={[0, 3, 3, 0]} maxBarSize={12} />
        <Bar dataKey="exposure" name="Actual + Committed" radius={[0, 3, 3, 0]} maxBarSize={12}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={statusColor(entry.status)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority-ranked attention items across all categories
// ─────────────────────────────────────────────────────────────────────────────

function buildAttentionItems(
  permits: Permit[],
  trades: CostTrade[],
  tasks: ScheduleTask[],
  vendorGaps: { vendor_name: string }[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  // 1. Blocking + overdue permits (highest priority)
  for (const p of permits.filter((p) => p.is_blocking && p.is_overdue)) {
    items.push({
      id: `permit-${p.id}`,
      category: 'permit',
      title: `Blocking permit overdue: ${p.permit_type.replace(/_/g, ' ')}`,
      context: `${p.days_overdue} day${p.days_overdue !== 1 ? 's' : ''} overdue${p.target_approval_date ? ` (target: ${p.target_approval_date})` : ''}`,
      tab: 'costs',
    });
  }

  // 2. Over-budget cost divisions (sorted by overrun_pct desc = worst first)
  const overBudget = [...trades]
    .filter((t) => t.status === 'over_budget')
    .sort((a, b) => safe(b.overrun_pct) - safe(a.overrun_pct));
  for (const t of overBudget) {
    const label = t.division_label || t.trade_name.replace(/_/g, ' ');
    const overAmt = safe(t.actual_cost_to_date) + safe(t.committed_cost) - safe(t.budgeted_cost);
    items.push({
      id: `trade-ob-${t.id}`,
      category: 'cost',
      title: `Over budget: ${label}`,
      context: `${fmtPct(t.overrun_pct)} over contract value (${fmtUSD(overAmt)} excess exposure)`,
      tab: 'costs',
    });
  }

  // 3. Late schedule tasks (sorted by days_late desc)
  const lateTasks = [...tasks]
    .filter((t) => t.is_late && safe(t.days_late) > 0)
    .sort((a, b) => safe(b.days_late) - safe(a.days_late));
  for (const t of lateTasks) {
    items.push({
      id: `sched-${t.id}`,
      category: 'schedule',
      title: `Late task: ${t.task_name}`,
      context: `${t.days_late} day${t.days_late !== 1 ? 's' : ''} behind schedule`,
      tab: 'schedule',
    });
  }

  // 4. Vendors with zero compliant docs
  for (const v of vendorGaps) {
    items.push({
      id: `vendor-${v.vendor_name}`,
      category: 'compliance',
      title: `No compliant docs: ${v.vendor_name}`,
      context: 'Zero compliant documents on file',
      tab: 'compliance',
    });
  }

  // 5. Watch cost divisions
  const watchTrades = [...trades]
    .filter((t) => t.status === 'watch')
    .sort((a, b) => safe(b.overrun_pct) - safe(a.overrun_pct));
  for (const t of watchTrades) {
    const label = t.division_label || t.trade_name.replace(/_/g, ' ');
    items.push({
      id: `trade-w-${t.id}`,
      category: 'cost',
      title: `Watch: ${label}`,
      context: `${fmtPct(t.overrun_pct)} variance from contract value`,
      tab: 'costs',
    });
  }

  return items.slice(0, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule elapsed calculation
// ─────────────────────────────────────────────────────────────────────────────

function calcScheduleElapsed(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const nowMs = Date.now();
  if (endMs <= startMs) return null;
  return Math.max(0, Math.min(1, (nowMs - startMs) / (endMs - startMs)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function Construction() {
  const { canWrite } = useAuth();
  const { tab, setTab, projectId, setProjectId, setProjects: ctxSetProjects } = useConstructionNav();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [trades, setTrades] = useState<CostTrade[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [coSummary, setCoSummary] = useState({ pending_exposure: 0, approved_total: 0 });
  const [scheduleTasks, setScheduleTasks] = useState<ScheduleTask[]>([]);
  const [scheduleSummary, setScheduleSummary] = useState({ late_tasks: 0, max_days_late: 0 });
  const [complianceDocs, setComplianceDocs] = useState<ComplianceDoc[]>([]);
  const [vendorGaps, setVendorGaps] = useState<{ vendor_name: string }[]>([]);
  const [cashData, setCashData] = useState<FinancialsData>({ latest: null, history: [] });
  const [roiAssumptions, setRoiAssumptions] = useState<ROIAssumptions | null>(null);
  const [roiSummary, setRoiSummary] = useState<ROISummary | null>(null);
  const [snapshotForm, setSnapshotForm] = useState(EMPTY_SNAPSHOT_FORM);
  const [assumptionsForm, setAssumptionsForm] = useState(EMPTY_ASSUMPTIONS_FORM);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [savingAssumptions, setSavingAssumptions] = useState(false);
  const [finMsg, setFinMsg] = useState('');
  const [latestPhotosEntry, setLatestPhotosEntry] = useState<LatestPhotosEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [summary, setSummary] = useState({
    total_budgeted: 0,
    total_actual: 0,
    total_committed: 0,
    overall_overrun_pct: 0,
    overall_status: 'on_track',
  });

  const fetchProjects = useCallback(async () => {
    const { data } = await api.get<Project[]>('/api/real-estate/projects', {
      params: { status: 'under_construction' },
    });
    const list = data.length ? data : (await api.get<Project[]>('/api/real-estate/projects')).data;
    setProjects(list);
    ctxSetProjects(list.map((p) => ({ id: p.id, project_name: p.project_name, project_code: p.project_code ?? null })));
    if (list.length && !projectId) setProjectId(list[0].id);
  }, [projectId, setProjectId, ctxSetProjects]);

  const fetchProjectData = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    try {
      const [
        tradesRes, permitsRes, summaryRes,
        coRes, schedRes, compRes, finRes, assumpRes, roiRes, latestPhotosRes,
      ] = await Promise.all([
        api.get<CostTrade[]>('/api/real-estate/costs/trades', { params: { project_id: pid } }),
        api.get<Permit[]>('/api/real-estate/permits', { params: { project_id: pid } }),
        api.get<{
          total_budgeted: number;
          total_actual: number;
          total_committed: number;
          overall_overrun_pct: number;
          overall_status: string;
        }>(`/api/real-estate/costs/summary/${pid}`),
        api.get<{ items: ChangeOrder[]; summary: { pending_exposure: number; approved_total: number } }>(
          '/api/real-estate/construction/change-orders', { params: { project_id: pid } },
        ),
        api.get<{ items: ScheduleTask[]; summary: { late_tasks: number; max_days_late: number } }>(
          '/api/real-estate/construction/schedule-tasks', { params: { project_id: pid } },
        ),
        api.get<{ items: ComplianceDoc[]; summary: { vendors_with_gaps: { vendor_name: string }[] } }>(
          '/api/real-estate/construction/compliance-docs', { params: { project_id: pid } },
        ),
        api.get<{ latest: FinancialSnapshot | null; history: FinancialSnapshot[] }>(
          `/api/real-estate/construction/projects/${pid}/financials`,
        ),
        api.get<ROIAssumptions>(`/api/real-estate/construction/projects/${pid}/roi-assumptions`),
        api.get<ROISummary>(`/api/real-estate/construction/projects/${pid}/roi-summary`),
        api.get<{ entry: LatestPhotosEntry | null }>('/api/real-estate/daily-progress-photos/latest', { params: { project_id: pid } }),
      ]);
      setTrades(tradesRes.data);
      setPermits(permitsRes.data);
      setSummary({
        total_budgeted: summaryRes.data.total_budgeted,
        total_actual: summaryRes.data.total_actual,
        total_committed: summaryRes.data.total_committed ?? 0,
        overall_overrun_pct: summaryRes.data.overall_overrun_pct,
        overall_status: summaryRes.data.overall_status,
      });
      setChangeOrders(coRes.data.items);
      setCoSummary(coRes.data.summary);
      setScheduleTasks(schedRes.data.items);
      setScheduleSummary(schedRes.data.summary);
      setComplianceDocs(compRes.data.items);
      setVendorGaps(compRes.data.summary.vendors_with_gaps);
      setCashData({ latest: finRes.data.latest, history: finRes.data.history });
      setRoiAssumptions(assumpRes.data);
      setRoiSummary(roiRes.data);
      const a = assumpRes.data;
      setAssumptionsForm({
        total_project_cost: a.total_project_cost != null ? String(a.total_project_cost) : '',
        equity_pct: a.equity_pct != null ? String(a.equity_pct) : '',
        debt_pct: a.debt_pct != null ? String(a.debt_pct) : '',
        interest_rate_annual: a.interest_rate_annual != null ? String(a.interest_rate_annual) : '',
        construction_months: a.construction_months != null ? String(a.construction_months) : '',
        exit_strategy: a.exit_strategy || 'forward_sale',
        stabilized_noi: a.stabilized_noi != null ? String(a.stabilized_noi) : '',
        exit_cap_rate: a.exit_cap_rate != null ? String(a.exit_cap_rate) : '',
        selling_costs_pct: a.selling_costs_pct != null ? String(a.selling_costs_pct) : '0.025',
      });
      setLatestPhotosEntry(latestPhotosRes.data.entry ?? null);
      setLastRefreshed(new Date());
    } catch {
      setTrades([]);
      setPermits([]);
      setChangeOrders([]);
      setScheduleTasks([]);
      setComplianceDocs([]);
      setCashData({ latest: null, history: [] });
      setRoiAssumptions(null);
      setRoiSummary(null);
      setLatestPhotosEntry(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => {
    if (projectId) {
      setSelectedProject(projects.find((p) => p.id === projectId) || null);
      fetchProjectData(projectId);
    }
  }, [projectId, projects, fetchProjectData]);

  // ── Derived values for the overview ───────────────────────────────────────

  const totalBudget = trades.reduce((s, t) => s + safe(t.budgeted_cost), 0);
  const weightedComplete = totalBudget > 0
    ? trades.reduce((s, t) => s + safe(t.pct_complete) * safe(t.budgeted_cost), 0) / totalBudget
    : 0;

  const scheduleElapsed = calcScheduleElapsed(
    selectedProject?.start_date,
    selectedProject?.target_completion_date,
  );

  const contractValue = safe(selectedProject?.contract_value);
  const cashLatest = cashData.latest;
  const amtPaid = safe(cashLatest?.paid_to_subcontractors);
  const retainageHeld = cashLatest != null ? cashLatest.retainage_held : null;
  const totalCompleted = amtPaid + safe(retainageHeld);
  const balanceToFinish = contractValue > 0 ? contractValue - totalCompleted : null;
  const costImpact = safe(coSummary.approved_total);

  const attentionItems = buildAttentionItems(permits, trades, scheduleTasks, vendorGaps);

  const coColumns: Column<ChangeOrder>[] = [
    { key: 'co_number', label: 'CO #', sortValue: (r) => r.co_number },
    { key: 'title', label: 'Title', sortValue: (r) => r.title },
    { key: 'csi_division_code', label: 'CSI', render: (r) => r.csi_division_code || '—' },
    { key: 'requested_amount', label: 'Requested', render: (r) => fmtUSD(r.requested_amount), sortValue: (r) => safe(r.requested_amount) },
    { key: 'approved_amount', label: 'Approved', render: (r) => (r.approved_amount != null ? fmtUSD(r.approved_amount) : '—'), sortValue: (r) => safe(r.approved_amount) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'impact_on_schedule_days', label: 'Schedule Impact', render: (r) => (r.impact_on_schedule_days != null ? `${r.impact_on_schedule_days}d` : '—') },
  ];

  const scheduleColumns: Column<ScheduleTask>[] = [
    { key: 'task_name', label: 'Task', sortValue: (r) => r.task_name },
    { key: 'vendor_name', label: 'Vendor', render: (r) => r.vendor_name || '—' },
    { key: 'planned_end', label: 'Planned End', render: (r) => r.planned_end || '—' },
    { key: 'pct_complete', label: '% Complete', render: (r) => fmtPct(r.pct_complete), sortValue: (r) => safe(r.pct_complete) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.is_late ? 'late' : r.status} /> },
    { key: 'days_late', label: 'Days Late', render: (r) => (r.is_late ? `${r.days_late}d` : '—'), sortValue: (r) => safe(r.days_late) },
    { key: 'is_critical', label: 'Critical', render: (r) => (r.is_critical ? 'Yes' : '—') },
  ];

  const complianceColumns: Column<ComplianceDoc>[] = [
    { key: 'vendor_name', label: 'Vendor', sortValue: (r) => r.vendor_name },
    { key: 'doc_type', label: 'Doc Type', render: (r) => r.doc_type.replace(/_/g, ' ') },
    { key: 'doc_name', label: 'Document', render: (r) => r.doc_name || '—' },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'expiry_date', label: 'Expiry', render: (r) => r.expiry_date || '—' },
    { key: 'is_blocking', label: 'Blocking', render: (r) => (r.is_blocking ? 'Yes' : '—') },
  ];

  const handleSaveSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setSavingSnapshot(true);
    setFinMsg('');
    try {
      await api.post(`/api/real-estate/construction/projects/${projectId}/financials`, {
        period_start: snapshotForm.period_start || null,
        period_end: snapshotForm.period_end || null,
        received_from_owner: parseFloat(snapshotForm.received_from_owner) || 0,
        paid_to_subcontractors: parseFloat(snapshotForm.paid_to_subcontractors) || 0,
        other_expenses: parseFloat(snapshotForm.other_expenses) || 0,
        retainage_held: parseFloat(snapshotForm.retainage_held) || 0,
        retainage_receivable: parseFloat(snapshotForm.retainage_receivable) || 0,
      });
      setSnapshotForm(EMPTY_SNAPSHOT_FORM);
      setFinMsg('Snapshot saved.');
      fetchProjectData(projectId);
    } catch (err: unknown) {
      setFinMsg(err instanceof Error ? err.message : 'Failed to save snapshot.');
    } finally {
      setSavingSnapshot(false);
    }
  };

  const handleSaveAssumptions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    setSavingAssumptions(true);
    setFinMsg('');
    try {
      const { data } = await api.put<ROIAssumptions>(
        `/api/real-estate/construction/projects/${projectId}/roi-assumptions`,
        {
          total_project_cost: assumptionsForm.total_project_cost ? parseFloat(assumptionsForm.total_project_cost) : null,
          equity_pct: assumptionsForm.equity_pct ? parseFloat(assumptionsForm.equity_pct) : null,
          debt_pct: assumptionsForm.debt_pct ? parseFloat(assumptionsForm.debt_pct) : null,
          interest_rate_annual: assumptionsForm.interest_rate_annual ? parseFloat(assumptionsForm.interest_rate_annual) : null,
          construction_months: assumptionsForm.construction_months ? parseInt(assumptionsForm.construction_months, 10) : null,
          exit_strategy: assumptionsForm.exit_strategy,
          stabilized_noi: assumptionsForm.stabilized_noi ? parseFloat(assumptionsForm.stabilized_noi) : null,
          exit_cap_rate: assumptionsForm.exit_cap_rate ? parseFloat(assumptionsForm.exit_cap_rate) : null,
          selling_costs_pct: parseFloat(assumptionsForm.selling_costs_pct) || 0.025,
        },
      );
      setRoiAssumptions(data);
      const roiRes = await api.get<ROISummary>(`/api/real-estate/construction/projects/${projectId}/roi-summary`);
      setRoiSummary(roiRes.data);
      setFinMsg('Assumptions saved.');
    } catch (err: unknown) {
      setFinMsg(err instanceof Error ? err.message : 'Failed to save assumptions.');
    } finally {
      setSavingAssumptions(false);
    }
  };

  const snapshotColumns: Column<FinancialSnapshot>[] = [
    { key: 'period_end', label: 'Period End', render: (r) => r.period_end || '—', sortValue: (r) => r.period_end || '' },
    { key: 'received_from_owner', label: 'Received', render: (r) => fmtUSD(r.received_from_owner), sortValue: (r) => safe(r.received_from_owner) },
    { key: 'paid_to_subcontractors', label: 'Paid Subs', render: (r) => fmtUSD(r.paid_to_subcontractors), sortValue: (r) => safe(r.paid_to_subcontractors) },
    { key: 'other_expenses', label: 'Other', render: (r) => fmtUSD(r.other_expenses), sortValue: (r) => safe(r.other_expenses) },
    { key: 'net_realized_cash', label: 'Net Realized', render: (r) => fmtUSD(r.net_realized_cash), sortValue: (r) => safe(r.net_realized_cash) },
    { key: 'retainage_held', label: 'Retainage Held', render: (r) => fmtUSD(r.retainage_held), sortValue: (r) => safe(r.retainage_held) },
    { key: 'retainage_receivable', label: 'Retainage Recv.', render: (r) => fmtUSD(r.retainage_receivable), sortValue: (r) => safe(r.retainage_receivable) },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Mobile only: project + section selects (sidebar is hidden on small screens) */}
      <div className="md:hidden flex flex-col sm:flex-row gap-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-accent"
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_code ? `${p.project_code} — ` : ''}{p.project_name}
            </option>
          ))}
        </select>
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as Tab)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-accent"
        >
          {ALL_TABS.map(({ id, label }) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════════════════
              OVERVIEW TAB — Mission-Control Layout
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'overview' && selectedProject && (
            <div className="space-y-6">

              {/* Section 1: Header */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedProject.project_code && (
                      <span className="text-sm font-medium text-gray-500 font-mono">
                        {selectedProject.project_code}
                      </span>
                    )}
                    <h2 className="text-xl font-bold text-charcoal">{selectedProject.project_name}</h2>
                    <StatusPill status={selectedProject.status} />
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {[
                      selectedProject.project_type?.replace(/_/g, ' '),
                      selectedProject.created_by,
                      [selectedProject.city, selectedProject.state].filter(Boolean).join(', '),
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400 shrink-0">
                  {lastRefreshed && <span>Last synced {lastRefreshed.toLocaleTimeString()}</span>}
                  <button
                    onClick={() => fetchProjectData(projectId)}
                    className="p-1 rounded hover:text-accent hover:bg-gray-100 transition-colors"
                    title="Refresh data"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              </div>

              {/* Section 1b: Identity block */}
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-3">
                  {selectedProject.project_code && (
                    <div className="flex gap-3">
                      <span className="text-sm text-gray-500 w-32 shrink-0">Project No.</span>
                      <span className="text-sm font-medium text-charcoal font-mono">{selectedProject.project_code}</span>
                    </div>
                  )}
                  {selectedProject.description && (
                    <div className="flex gap-3 sm:col-span-2">
                      <span className="text-sm text-gray-500 w-32 shrink-0">Description</span>
                      <span className="text-sm text-charcoal">{selectedProject.description}</span>
                    </div>
                  )}
                  {selectedProject.project_type && (
                    <div className="flex gap-3">
                      <span className="text-sm text-gray-500 w-32 shrink-0">Type</span>
                      <span className="text-sm text-charcoal capitalize">{selectedProject.project_type.replace(/_/g, ' ')}</span>
                    </div>
                  )}
                  {selectedProject.creator_role && (
                    <div className="flex gap-3">
                      <span className="text-sm text-gray-500 w-32 shrink-0">Creator Role</span>
                      <span className="text-sm text-charcoal">{selectedProject.creator_role}</span>
                    </div>
                  )}
                  {(selectedProject.city || selectedProject.state) && (
                    <div className="flex gap-3">
                      <span className="text-sm text-gray-500 w-32 shrink-0">Location</span>
                      <span className="text-sm text-charcoal">{[selectedProject.city, selectedProject.state].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  {(selectedProject.start_date || selectedProject.target_completion_date) && (
                    <div className="flex gap-3">
                      <span className="text-sm text-gray-500 w-32 shrink-0">Schedule</span>
                      <span className="text-sm text-charcoal">
                        {selectedProject.start_date ?? '—'} → {selectedProject.target_completion_date ?? '—'}
                      </span>
                    </div>
                  )}
                  {selectedProject.working_days && (
                    <div className="flex gap-3">
                      <span className="text-sm text-gray-500 w-32 shrink-0">Working Days</span>
                      <span className="text-sm text-charcoal">{selectedProject.working_days}</span>
                    </div>
                  )}
                  <div className="flex gap-3">
                    <span className="text-sm text-gray-500 w-32 shrink-0">Budget</span>
                    <span className="text-sm text-charcoal">
                      {selectedProject.contract_value != null
                        ? fmtUSD(selectedProject.contract_value)
                        : 'No contract value set for this project'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: Project progress + Financial progress */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Left: Project Progress (bullet bar) */}
                <Card title="Project Progress">
                  <div className="pt-6 pb-2">
                    <BulletBar
                      fill={weightedComplete}
                      target={scheduleElapsed}
                      label={`${(weightedComplete * 100).toFixed(1)}% complete (weighted by contract value)`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-5 border-t border-gray-100 pt-4">
                    <StatCell label="Completed" value={fmtPct(weightedComplete)} />
                    <StatCell label="Pending" value={fmtPct(Math.max(0, 1 - weightedComplete))} />
                    {scheduleElapsed == null && (
                      <p className="col-span-2 text-xs text-gray-400">
                        Schedule dates not set — target marker unavailable.
                      </p>
                    )}
                  </div>
                </Card>

                {/* Right: Financial Progress (stacked bar) */}
                <Card title="Financial Progress">
                  {contractValue <= 0 ? (
                    <p className="text-sm text-gray-400 py-4">No contract value set for this project.</p>
                  ) : (
                    <>
                      <div className="pt-2 pb-2">
                        <StackedBar
                          paid={amtPaid}
                          retainage={retainageHeld ?? 0}
                          committed={summary.total_committed}
                          total={contractValue}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-5 border-t border-gray-100 pt-4">
                        <StatCell label="Contract Value" value={fmtUSD(contractValue)} />
                        <StatCell label="Total Completed" value={cashLatest ? fmtUSD(totalCompleted) : '—'} />
                        <StatCell
                          label="Balance to Finish"
                          value={balanceToFinish != null ? fmtUSD(balanceToFinish) : '—'}
                        />
                        <StatCell label="Amount Paid" value={cashLatest ? fmtUSD(amtPaid) : '—'} />
                        <StatCell
                          label="Retainage"
                          value={retainageHeld != null ? fmtUSD(retainageHeld) : 'not tracked'}
                          valueClass={retainageHeld == null ? 'text-gray-400' : undefined}
                        />
                        <StatCell
                          label="Cost Impact (Approved COs)"
                          value={fmtUSD(costImpact)}
                          valueClass={costImpact > 0 ? 'text-red-600' : undefined}
                        />
                      </div>
                      {!cashLatest && (
                        <p className="text-xs text-gray-400 mt-3">No financial snapshot recorded yet — paid / retainage figures unavailable.</p>
                      )}
                    </>
                  )}
                </Card>
              </div>

              {/* Section 3: Attention Required */}
              {attentionItems.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-5">
                  <h3 className="font-semibold text-red-800 flex items-center gap-2 mb-3 text-sm">
                    <AlertTriangle size={15} />
                    Attention Required — top {attentionItems.length} issue{attentionItems.length !== 1 ? 's' : ''} across all categories
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {attentionItems.map((item) => (
                      <AttentionCard key={item.id} item={item} onNavigate={setTab} />
                    ))}
                  </div>
                </div>
              )}

              {/* Section 3b: Daily progress photos preview */}
              {latestPhotosEntry && latestPhotosEntry.photos.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4 text-gray-500" />
                      <h3 className="text-sm font-semibold text-charcoal">
                        Daily Progress Photos
                        <span className="ml-2 text-gray-400 font-normal">{latestPhotosEntry.entry_date}</span>
                      </h3>
                    </div>
                    <button
                      onClick={() => setTab('documents')}
                      className="text-xs text-accent hover:text-accent-dark flex items-center gap-0.5"
                    >
                      View all <ChevronRight size={11} />
                    </button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {latestPhotosEntry.photos.slice(0, 8).map((photo) => (
                      <img
                        key={photo.id}
                        src={`${(import.meta.env.VITE_API_BASE_URL as string | undefined) || ''}/uploads/${photo.file_reference}`}
                        alt={photo.caption || 'Progress photo'}
                        className="h-20 w-20 object-cover rounded-lg shrink-0 border border-gray-100 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setTab('documents')}
                        title={photo.caption ?? undefined}
                      />
                    ))}
                    {latestPhotosEntry.photo_count > 8 && (
                      <button
                        onClick={() => setTab('documents')}
                        className="h-20 w-20 shrink-0 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 hover:border-accent hover:text-accent transition-colors"
                      >
                        <span className="text-sm font-semibold">+{latestPhotosEntry.photo_count - 8}</span>
                        <span className="text-xs mt-0.5">more</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Section 4: Vendor compliance heatmap + Schedule delay */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card title="Vendor Compliance">
                  <ErrorBoundary>
                    <VendorHeatmap docs={complianceDocs} />
                  </ErrorBoundary>
                </Card>

                <Card title="Schedule Delay Ranking">
                  <ErrorBoundary>
                    <ScheduleDelayChart
                      tasks={scheduleTasks}
                      onViewAll={() => setTab('schedule')}
                    />
                  </ErrorBoundary>
                </Card>
              </div>

              {/* Section 5: Division cost exposure */}
              <Card title="Division Cost Exposure — sorted worst variance first">
                <ErrorBoundary>
                  <CostExposureChart trades={trades} />
                </ErrorBoundary>
              </Card>

              {/* Section 6: Change orders summary + link */}
              <Card title="Change Orders">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="grid grid-cols-3 gap-6">
                    <StatCell label="Total" value={String(changeOrders.length)} />
                    <StatCell label="Pending Exposure" value={fmtUSD(coSummary.pending_exposure)} />
                    <StatCell label="Approved Total" value={fmtUSD(coSummary.approved_total)} />
                  </div>
                  <button
                    onClick={() => setTab('change_orders')}
                    className="flex items-center gap-1 text-sm text-accent hover:text-accent-dark shrink-0"
                  >
                    View all change orders <ChevronRight size={14} />
                  </button>
                </div>
              </Card>
            </div>
          )}

          {tab === 'overview' && !selectedProject && (
            <p className="text-gray-400 text-center py-12">Select a project to view the dashboard.</p>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              COSTS & SOV TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'costs' && (
            <ErrorBoundary>
              <ConstructionSOV projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              PAY APPLICATIONS TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'pay_applications' && (
            <ErrorBoundary>
              <ConstructionPayApplications projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              EXPENSES TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'expenses' && (
            <ErrorBoundary>
              <ConstructionExpenses projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              CHANGE ORDERS TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'change_orders' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard label="Change Orders" value={String(changeOrders.length)} />
                <KpiCard label="Pending Exposure" value={fmtUSD(coSummary.pending_exposure)} accent />
                <KpiCard label="Approved Total" value={fmtUSD(coSummary.approved_total)} />
              </div>
              <ErrorBoundary>
                <Card title="Change Orders">
                  <Table columns={coColumns} data={changeOrders} emptyMessage="No change orders for this project" />
                </Card>
              </ErrorBoundary>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TASK SCHEDULE TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'task_schedule' && (
            <ErrorBoundary>
              <ConstructionTaskSchedule projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              SCHEDULE TAB (executive late-task exception view — unchanged)
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'schedule' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard label="Tracked Tasks" value={String(scheduleTasks.length)} />
                <KpiCard label="Late Tasks" value={String(scheduleSummary.late_tasks)} accent={scheduleSummary.late_tasks > 0} />
                <KpiCard label="Max Days Late" value={scheduleSummary.max_days_late > 0 ? `${scheduleSummary.max_days_late}d` : '—'} />
              </div>
              {scheduleSummary.late_tasks > 0 && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <Clock className="text-amber-600 shrink-0" size={20} />
                  <p className="text-sm text-amber-800">
                    {scheduleSummary.late_tasks} task(s) behind schedule
                    {scheduleSummary.max_days_late > 0 ? ` — worst slip ${scheduleSummary.max_days_late} days` : ''}.
                  </p>
                </div>
              )}
              <ErrorBoundary>
                <Card title="Schedule Health">
                  <Table columns={scheduleColumns} data={scheduleTasks} emptyMessage="No schedule tasks for this project" />
                </Card>
              </ErrorBoundary>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              LOAN TRACKER TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'loan_tracker' && (
            <ErrorBoundary>
              <ConstructionLoanTracker />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              COMPLIANCE TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'compliance' && (
            <>
              {vendorGaps.length > 0 && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <FileText className="text-red-600 shrink-0" size={20} />
                  <div>
                    <p className="font-medium text-red-800">Vendor compliance gaps</p>
                    <ul className="text-sm text-red-700 mt-1 list-disc list-inside">
                      {vendorGaps.map((v) => (
                        <li key={v.vendor_name}>{v.vendor_name} — no compliant documents on file</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <ErrorBoundary>
                <Card title="Compliance Center">
                  <Table columns={complianceColumns} data={complianceDocs} emptyMessage="No compliance documents for this project" />
                </Card>
              </ErrorBoundary>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              CHANGE REQUESTS TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'change_requests' && (
            <ErrorBoundary>
              <ConstructionCR projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              WORK LOG TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'work_log' && (
            <ErrorBoundary>
              <ConstructionWorkLog projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              QUALITY CHECK TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'quality_check' && (
            <ErrorBoundary>
              <ConstructionQC projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              INSPECTIONS TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'inspections' && (
            <ErrorBoundary>
              <ConstructionInspections projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              DOCUMENTS TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'documents' && (
            <ErrorBoundary>
              <ConstructionDocuments projectId={projectId} />
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              RECEIVABLES TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'receivables' && (
            <ErrorBoundary>
              <PropertyDevProvider>
                <PD10Receivables />
              </PropertyDevProvider>
            </ErrorBoundary>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              FINANCIALS & ROI TAB
          ══════════════════════════════════════════════════════════════════ */}
          {tab === 'financials' && (
            <>
              <ErrorBoundary>
                <Card title="Realized Cash Position">
                  <p className="text-sm text-gray-500 mb-4">
                    Cash-basis view — independent of accrual Cost Trades. A project can show fine budget variance while cash-negative if billing lags collection.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                    <KpiCard
                      label="Net Realized Cash"
                      value={cashLatest ? fmtUSD(cashLatest.net_realized_cash) : '—'}
                      accent
                      sub={cashLatest?.period_end ? `Period ending ${cashLatest.period_end}` : 'No snapshot yet'}
                    />
                    <KpiCard label="Retainage Held" value={cashLatest ? fmtUSD(cashLatest.retainage_held) : '—'} />
                    <KpiCard label="Retainage Receivable" value={cashLatest ? fmtUSD(cashLatest.retainage_receivable) : '—'} />
                  </div>

                  {canWrite && (
                    <form onSubmit={handleSaveSnapshot} className="border-t border-gray-100 pt-4 space-y-3">
                      <p className="text-sm font-medium text-charcoal">Log New Snapshot</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <input type="date" value={snapshotForm.period_start} onChange={(e) => setSnapshotForm({ ...snapshotForm, period_start: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Period start" />
                        <input type="date" required value={snapshotForm.period_end} onChange={(e) => setSnapshotForm({ ...snapshotForm, period_end: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Period end" />
                        <input type="number" step="0.01" placeholder="Received from owner" value={snapshotForm.received_from_owner}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, received_from_owner: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" step="0.01" placeholder="Paid to subcontractors" value={snapshotForm.paid_to_subcontractors}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, paid_to_subcontractors: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" step="0.01" placeholder="Other expenses" value={snapshotForm.other_expenses}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, other_expenses: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" step="0.01" placeholder="Retainage held" value={snapshotForm.retainage_held}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, retainage_held: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        <input type="number" step="0.01" placeholder="Retainage receivable" value={snapshotForm.retainage_receivable}
                          onChange={(e) => setSnapshotForm({ ...snapshotForm, retainage_receivable: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                      </div>
                      <button type="submit" disabled={savingSnapshot}
                        className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
                        {savingSnapshot ? 'Saving…' : 'Save Snapshot'}
                      </button>
                    </form>
                  )}

                  {cashData.history.length > 0 && (
                    <div className="mt-6 pt-4 border-t border-gray-100">
                      <p className="text-sm font-medium text-charcoal mb-3">Snapshot History</p>
                      <Table columns={snapshotColumns} data={cashData.history} emptyMessage="No snapshots" />
                    </div>
                  )}
                </Card>
              </ErrorBoundary>

              {canWrite && (
                <ErrorBoundary>
                  <Card title="ROI Assumptions">
                    <button
                      type="button"
                      onClick={() => setAssumptionsOpen(!assumptionsOpen)}
                      className="text-sm text-accent hover:text-accent-dark mb-3"
                    >
                      {assumptionsOpen ? 'Hide assumptions form' : 'Edit assumptions'}
                    </button>
                    {assumptionsOpen && (
                      <form onSubmit={handleSaveAssumptions} className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          <input type="number" step="0.01" placeholder="Total project cost" value={assumptionsForm.total_project_cost}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, total_project_cost: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          <input type="number" step="0.0001" placeholder="Equity % (e.g. 0.40)" value={assumptionsForm.equity_pct}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, equity_pct: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          <input type="number" step="0.0001" placeholder="Debt % (e.g. 0.60)" value={assumptionsForm.debt_pct}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, debt_pct: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          <input type="number" step="0.0001" placeholder="Interest rate (annual)" value={assumptionsForm.interest_rate_annual}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, interest_rate_annual: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          <input type="number" step="1" placeholder="Construction months" value={assumptionsForm.construction_months}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, construction_months: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          <select value={assumptionsForm.exit_strategy} onChange={(e) => setAssumptionsForm({ ...assumptionsForm, exit_strategy: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                            <option value="forward_sale">Forward Sale</option>
                            <option value="hold_as_reit" disabled>Hold as REIT (coming soon)</option>
                            <option value="build_to_suit_sale" disabled>Build-to-Suit Sale (coming soon)</option>
                          </select>
                          <input type="number" step="0.01" placeholder="Stabilized NOI" value={assumptionsForm.stabilized_noi}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, stabilized_noi: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          <input type="number" step="0.0001" placeholder="Exit cap rate (e.g. 0.0675)" value={assumptionsForm.exit_cap_rate}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, exit_cap_rate: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                          <input type="number" step="0.0001" placeholder="Selling costs %" value={assumptionsForm.selling_costs_pct}
                            onChange={(e) => setAssumptionsForm({ ...assumptionsForm, selling_costs_pct: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                        </div>
                        <button type="submit" disabled={savingAssumptions}
                          className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
                          {savingAssumptions ? 'Saving…' : 'Save Assumptions'}
                        </button>
                      </form>
                    )}
                  </Card>
                </ErrorBoundary>
              )}

              {finMsg && <p className="text-sm text-gray-600">{finMsg}</p>}

              <ErrorBoundary>
                <Card title="ROI Summary">
                  {!roiSummary?.configured ? (
                    <p className="text-gray-400 text-center py-8">
                      {canWrite
                        ? 'Set up ROI assumptions above to see return projections.'
                        : 'ROI assumptions have not been configured for this project.'}
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
                        <KpiCard label="ROI" value={roiSummary.roi != null ? fmtPct(roiSummary.roi) : '—'} accent />
                        <KpiCard label="MOIC" value={roiSummary.moic != null ? `${roiSummary.moic.toFixed(2)}x` : '—'} />
                        <KpiCard label="Net Profit" value={roiSummary.net_profit != null ? fmtUSD(roiSummary.net_profit) : '—'} />
                        <KpiCard label="Exit Value" value={roiSummary.exit_value != null ? fmtUSD(roiSummary.exit_value) : '—'} />
                        <KpiCard label="Net Sale Proceeds" value={roiSummary.net_sale_proceeds != null ? fmtUSD(roiSummary.net_sale_proceeds) : '—'} />
                      </div>
                      {roiSummary.irr != null && (
                        <div className="p-3 bg-transparent rounded-lg text-sm">
                          <p className="font-medium text-charcoal">
                            Simplified IRR (single cash-flow estimate): {fmtPct(roiSummary.irr)}
                          </p>
                          <p className="text-gray-500 mt-1">{roiSummary.irr_note}</p>
                        </div>
                      )}
                      {roiSummary.estimate_note && (
                        <p className="text-xs text-gray-400 mt-3">{roiSummary.estimate_note}</p>
                      )}
                    </>
                  )}
                </Card>
              </ErrorBoundary>
            </>
          )}
        </>
      )}
    </div>
  );
}
