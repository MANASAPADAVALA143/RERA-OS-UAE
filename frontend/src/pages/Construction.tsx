import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { AlertTriangle, Clock, FileText, Sparkles } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

type Tab = 'costs' | 'change_orders' | 'schedule' | 'compliance' | 'financials';

const TABS: { id: Tab; label: string }[] = [
  { id: 'costs', label: 'Costs & SOV' },
  { id: 'change_orders', label: 'Change Orders' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'financials', label: 'Financials & ROI' },
];

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface Project {
  id: string;
  project_name: string;
  project_code?: string | null;
  status: string;
  city?: string | null;
  state?: string | null;
  contract_value?: number | null;
  total_project_cost?: number | null;
  total_saleable_sqft?: number | null;
  target_completion_date?: string | null;
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

export default function Construction() {
  const { canWrite } = useAuth();
  const [tab, setTab] = useState<Tab>('costs');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [trades, setTrades] = useState<CostTrade[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [atRiskPermits, setAtRiskPermits] = useState<Permit[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{ id: string; text: string } | null>(null);
  const [summary, setSummary] = useState({ total_budgeted: 0, total_actual: 0, overall_overrun_pct: 0, overall_status: 'on_track' });

  const fetchProjects = useCallback(async () => {
    const { data } = await api.get<Project[]>('/api/real-estate/projects', {
      params: { status: 'under_construction' },
    });
    const list = data.length ? data : (await api.get<Project[]>('/api/real-estate/projects')).data;
    setProjects(list);
    if (list.length && !projectId) setProjectId(list[0].id);
  }, [projectId]);

  const fetchProjectData = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    try {
      const [
        tradesRes, permitsRes, atRiskRes, summaryRes,
        coRes, schedRes, compRes, finRes, assumpRes, roiRes,
      ] = await Promise.all([
        api.get<CostTrade[]>('/api/real-estate/costs/trades', { params: { project_id: pid } }),
        api.get<Permit[]>('/api/real-estate/permits', { params: { project_id: pid } }),
        api.get<Permit[]>('/api/real-estate/permits/at-risk', { params: { project_id: pid } }),
        api.get<{ total_budgeted: number; total_actual: number; overall_overrun_pct: number; overall_status: string }>(
          `/api/real-estate/costs/summary/${pid}`,
        ),
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
      ]);
      setTrades(tradesRes.data);
      setPermits(permitsRes.data);
      setAtRiskPermits(atRiskRes.data);
      setSummary(summaryRes.data);
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
    } catch {
      setTrades([]);
      setPermits([]);
      setAtRiskPermits([]);
      setChangeOrders([]);
      setScheduleTasks([]);
      setComplianceDocs([]);
      setCashData({ latest: null, history: [] });
      setRoiAssumptions(null);
      setRoiSummary(null);
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

  const handleExplain = async (tradeId: string) => {
    setExplaining(tradeId);
    try {
      const { data } = await api.post<{ explanation: string }>('/api/real-estate/ai/explain-overrun', { trade_id: tradeId });
      setExplanation({ id: tradeId, text: data.explanation });
    } catch {
      setExplanation({ id: tradeId, text: 'Unable to generate explanation.' });
    } finally {
      setExplaining(null);
    }
  };

  const chartData = trades.map((t) => ({
    name: (t.division_label || t.trade_name).replace(/_/g, ' ').slice(0, 18),
    budgeted: safe(t.budgeted_cost),
    actual: safe(t.actual_cost_to_date),
    committed: safe(t.committed_cost),
  }));

  const tradeColumns: Column<CostTrade>[] = [
    {
      key: 'csi_division_code',
      label: 'CSI',
      render: (r) => r.csi_division_code || '—',
      sortValue: (r) => r.csi_division_code || '',
    },
    {
      key: 'division_label',
      label: 'Division',
      render: (r) => r.division_label || r.trade_name.replace(/_/g, ' '),
      sortValue: (r) => r.division_label || r.trade_name,
    },
    { key: 'vendor_name', label: 'Vendor', render: (r) => r.vendor_name || '—' },
    { key: 'budgeted_cost', label: 'Budget', render: (r) => fmtUSD(r.budgeted_cost), sortValue: (r) => safe(r.budgeted_cost) },
    { key: 'actual_cost_to_date', label: 'Actual', render: (r) => fmtUSD(r.actual_cost_to_date), sortValue: (r) => safe(r.actual_cost_to_date) },
    { key: 'committed_cost', label: 'Committed', render: (r) => fmtUSD(r.committed_cost), sortValue: (r) => safe(r.committed_cost) },
    { key: 'pct_complete', label: '% Complete', render: (r) => fmtPct(r.pct_complete), sortValue: (r) => safe(r.pct_complete) },
    { key: 'overrun_pct', label: 'Variance', render: (r) => fmtPct(r.overrun_pct), sortValue: (r) => safe(r.overrun_pct) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'actions',
      label: '',
      render: (r) =>
        (r.status === 'watch' || r.status === 'over_budget') ? (
          <button
            onClick={() => handleExplain(r.id)}
            disabled={explaining === r.id}
            className="flex items-center gap-1 text-xs text-accent hover:text-accent-dark disabled:opacity-50"
          >
            <Sparkles size={12} />
            {explaining === r.id ? '…' : 'Explain'}
          </button>
        ) : null,
    },
  ];

  const permitColumns: Column<Permit>[] = [
    { key: 'permit_type', label: 'Permit', render: (r) => r.permit_type.replace(/_/g, ' ') },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'is_blocking', label: 'Blocking', render: (r) => (r.is_blocking ? 'Yes' : 'No') },
    { key: 'days_pending', label: 'Days Pending', sortValue: (r) => safe(r.days_pending) },
    { key: 'is_overdue', label: 'Overdue', render: (r) => (r.is_overdue ? `${r.days_overdue}d` : '—') },
    { key: 'target_approval_date', label: 'Target Date', render: (r) => r.target_approval_date || '—' },
  ];

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

  const cashLatest = cashData.latest;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Construction</h1>
          {selectedProject && (
            <p className="text-sm text-gray-500 mt-1">
              {selectedProject.project_code && <span className="font-medium text-charcoal">{selectedProject.project_code} · </span>}
              {[selectedProject.city, selectedProject.state].filter(Boolean).join(', ')}
              {selectedProject.total_saleable_sqft ? ` · ${selectedProject.total_saleable_sqft.toLocaleString()} SF` : ''}
            </p>
          )}
        </div>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-accent min-w-[220px]"
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_code ? `${p.project_code} — ` : ''}{p.project_name}
            </option>
          ))}
        </select>
      </div>

      {(selectedProject?.contract_value || selectedProject?.total_project_cost) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {selectedProject.contract_value != null && (
            <KpiCard label="Contract Value (SOV)" value={fmtUSD(selectedProject.contract_value)} accent />
          )}
          {selectedProject.total_project_cost != null && (
            <KpiCard label="Total Project Cost" value={fmtUSD(selectedProject.total_project_cost)} />
          )}
          {roiSummary?.configured && roiSummary.roi != null && (
            <KpiCard label="Project ROI" value={fmtPct(roiSummary.roi)} sub={roiSummary.moic != null ? `MOIC ${roiSummary.moic.toFixed(2)}x` : undefined} />
          )}
          {cashLatest && (
            <KpiCard label="Net Realized Cash" value={fmtUSD(cashLatest.net_realized_cash)} sub={cashLatest.period_end ? `as of ${cashLatest.period_end}` : undefined} />
          )}
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-charcoal'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : (
        <>
          {tab === 'costs' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard label="Total Budget" value={fmtUSD(summary.total_budgeted)} />
                <KpiCard label="Actual to Date" value={fmtUSD(summary.total_actual)} />
                <KpiCard label="Overall Variance" value={fmtPct(summary.overall_overrun_pct)} sub={summary.overall_status.replace(/_/g, ' ')} />
              </div>

              {atRiskPermits.length > 0 && (
                <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <AlertTriangle className="text-red-600 shrink-0" size={20} />
                  <div>
                    <p className="font-medium text-red-800">{atRiskPermits.length} permit(s) at risk</p>
                    <ul className="text-sm text-red-700 mt-1 list-disc list-inside">
                      {atRiskPermits.map((p) => (
                        <li key={p.id}>{p.permit_type.replace(/_/g, ' ')} — {p.is_overdue ? `${p.days_overdue} days overdue` : 'deadline approaching'}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {explanation && (
                <Card title="AI Cost Explanation">
                  <p className="text-sm text-charcoal">{explanation.text}</p>
                  <button onClick={() => setExplanation(null)} className="text-xs text-gray-400 mt-2 hover:text-gray-600">Dismiss</button>
                </Card>
              )}

              <ErrorBoundary>
                <Card title="Cost Divisions (SOV)">
                  <Table columns={tradeColumns} data={trades} emptyMessage="No cost divisions for this project" />
                </Card>
              </ErrorBoundary>

              <ErrorBoundary>
                <Card title="Budget vs Actual by Division">
                  {chartData.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No division data</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                        <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} />
                        <Tooltip formatter={(v: number) => fmtUSD(v)} />
                        <Legend />
                        <Bar dataKey="budgeted" fill="#0E3B36" name="Budgeted" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="actual" fill="#2F8F7A" name="Actual" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="committed" fill="#4BA892" name="Committed" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </ErrorBoundary>

              <ErrorBoundary>
                <Card title="Permits">
                  <Table columns={permitColumns} data={permits} emptyMessage="No permits for this project" />
                </Card>
              </ErrorBoundary>
            </>
          )}

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
                        <div className="p-3 bg-surface rounded-lg text-sm">
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
