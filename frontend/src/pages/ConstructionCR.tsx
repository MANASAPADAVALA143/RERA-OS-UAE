import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Calendar, ChevronRight, Plus } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD } from '../components/ProtectedRoute';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CRSummary {
  total_pending_cost_impact: number;
  total_approved_cost_impact: number;
  open_count: number;
  missing_due_date: number;
  count_by_status: Record<string, number>;
  total_count: number;
}

interface CRListItem {
  id: string;
  project_id: string;
  co_number: string;
  subject: string;
  status: string;
  csi_division_code: string | null;
  trade_name: string | null;
  requested_by: string | null;
  due_date: string | null;
  net_cost_impact: number;
  task_line_count: number;
}

interface TaskLine {
  id: string;
  change_order_id: string;
  division: string | null;
  subdivision: string | null;
  task: string | null;
  scope: string | null;
  original_value: number;
  cost_impact: number;
  revised_sched_value: number;
  action: string | null;
  orig_start_date: string | null;
  orig_end_date: string | null;
  orig_duration_days: number | null;
  revised_start_date: string | null;
  revised_end_date: string | null;
  revised_duration_days: number | null;
  schedule_impact_days: number | null;
  created_by: string | null;
  created_at: string;
}

interface CRDetail {
  id: string;
  project_id: string;
  co_number: string;
  subject: string;
  description: string | null;
  status: string;
  csi_division_code: string | null;
  trade_name: string | null;
  requested_by: string | null;
  created_by: string | null;
  due_date: string | null;
  request_date: string | null;
  approval_date: string | null;
  type_of_reference: string | null;
  approver: string | null;
  attached_cr: string | null;
  gc_superintendent: string | null;
  reason_code: string | null;
  requested_amount: number;
  approved_amount: number | null;
  net_cost_impact: number;
  net_schedule_impact_days: number;
  created_at: string;
  updated_at: string;
  task_lines: TaskLine[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDays(n: number | null | undefined) {
  if (n == null) return '—';
  if (n === 0) return '—';
  return n > 0 ? `+${n}d` : `${n}d`;
}

function CostImpactCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-gray-400">—</span>;
  if (value > 0)
    return <span className="text-red-600 font-medium">+{fmtUSD(value)}</span>;
  return <span className="text-green-600 font-medium">−{fmtUSD(Math.abs(value))}</span>;
}

function SchedImpactCell({ value }: { value: number | null | undefined }) {
  const v = value ?? 0;
  if (v === 0) return <span className="text-gray-400">—</span>;
  if (v > 0) return <span className="text-amber-600 font-medium">+{v}d</span>;
  return <span className="text-green-600 font-medium">{v}d</span>;
}

function statusColor(status: string) {
  switch (status) {
    case 'approved': return 'green';
    case 'rejected': return 'red';
    case 'pending_approval': return 'yellow';
    case 'submitted': return 'blue';
    default: return 'gray';
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const BLANK_FORM = {
  co_number: '',
  subject: '',
  description: '',
  csi_division_code: '',
  trade_name: '',
  requested_amount: '',
  requested_by: '',
  due_date: '',
  type_of_reference: '',
  approver: '',
  gc_superintendent: '',
  reason_code: '',
  request_date: '',
};

const BLANK_LINE = {
  division: '',
  subdivision: '',
  task: '',
  scope: '',
  original_value: '',
  cost_impact: '',
  action: '',
  orig_start_date: '',
  orig_end_date: '',
  orig_duration_days: '',
  revised_start_date: '',
  revised_end_date: '',
  revised_duration_days: '',
  schedule_impact_days: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function HeaderField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm font-medium text-charcoal">{value || '—'}</p>
    </div>
  );
}

function NetImpactBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-gray-400 text-lg font-semibold">$0</span>;
  const color = value > 0 ? 'text-red-600' : 'text-green-600';
  const prefix = value > 0 ? '+' : '−';
  return <span className={`${color} text-lg font-semibold`}>{prefix}{fmtUSD(Math.abs(value))}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// List View
// ─────────────────────────────────────────────────────────────────────────────

interface ListViewProps {
  projectId: string;
  onSelect: (id: string) => void;
}

function CRListView({ projectId, onSelect }: ListViewProps) {
  const { canWrite } = useAuth();
  const [items, setItems] = useState<CRListItem[]>([]);
  const [summary, setSummary] = useState<CRSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [sortCol, setSortCol] = useState<keyof CRListItem>('co_number');
  const [sortAsc, setSortAsc] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/real-estate/change-requests?project_id=${projectId}`);
      setItems(res.data.items ?? []);
      setSummary(res.data.summary ?? null);
    } catch {
      setError('Failed to load change requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId]);

  const sorted = [...items].sort((a, b) => {
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  const toggleSort = (col: keyof CRListItem) => {
    if (sortCol === col) setSortAsc((p) => !p);
    else { setSortCol(col); setSortAsc(true); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/real-estate/change-requests', {
        project_id: projectId,
        co_number: form.co_number,
        subject: form.subject,
        description: form.description || null,
        csi_division_code: form.csi_division_code || null,
        trade_name: form.trade_name || null,
        requested_amount: parseFloat(form.requested_amount || '0'),
        requested_by: form.requested_by || null,
        due_date: form.due_date || null,
        type_of_reference: form.type_of_reference || null,
        approver: form.approver || null,
        gc_superintendent: form.gc_superintendent || null,
        reason_code: form.reason_code || null,
        request_date: form.request_date || null,
      });
      setForm({ ...BLANK_FORM });
      setShowForm(false);
      load();
    } catch {
      alert('Failed to create change request.');
    } finally {
      setSaving(false);
    }
  };

  const Th = ({ col, label }: { col: keyof CRListItem; label: string }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      onClick={() => toggleSort(col)}
    >
      {label}{sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  );

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Total CRs" value={String(summary.total_count)} />
          <KpiCard label="Open" value={String(summary.open_count)} />
          <KpiCard label="Pending Exposure" value={fmtUSD(summary.total_pending_cost_impact)} accent />
          <KpiCard label="Approved Impact" value={fmtUSD(summary.total_approved_cost_impact)} />
        </div>
      )}

      {summary && summary.missing_due_date > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {summary.missing_due_date} change request{summary.missing_due_date !== 1 ? 's are' : ' is'} missing a due date.
        </div>
      )}

      <Card title="Change Requests" actions={
        canWrite && !showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-light"
          >
            <Plus className="h-4 w-4" /> New CR
          </button>
        ) : undefined
      }>
        {/* Create form */}
        {showForm && canWrite && (
          <form onSubmit={handleCreate} className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 space-y-3">
            <p className="text-sm font-medium text-charcoal mb-1">New Change Request</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <input required placeholder="CR #" value={form.co_number}
                onChange={(e) => setForm({ ...form, co_number: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input required placeholder="Subject" value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm col-span-1 sm:col-span-2" />
              <input placeholder="CSI division code" value={form.csi_division_code}
                onChange={(e) => setForm({ ...form, csi_division_code: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="Trade name" value={form.trade_name}
                onChange={(e) => setForm({ ...form, trade_name: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="number" step="0.01" placeholder="Requested amount" value={form.requested_amount}
                onChange={(e) => setForm({ ...form, requested_amount: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="Requested by" value={form.requested_by}
                onChange={(e) => setForm({ ...form, requested_by: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="date" placeholder="Due date" value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="Approver" value={form.approver}
                onChange={(e) => setForm({ ...form, approver: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="GC superintendent" value={form.gc_superintendent}
                onChange={(e) => setForm({ ...form, gc_superintendent: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="Type of reference" value={form.type_of_reference}
                onChange={(e) => setForm({ ...form, type_of_reference: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="date" placeholder="Request date" value={form.request_date}
                onChange={(e) => setForm({ ...form, request_date: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <textarea placeholder="Description" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm col-span-1 sm:col-span-3 resize-none" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
                {saving ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setForm({ ...BLANK_FORM }); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading && (
          <div className="space-y-2 py-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        )}
        {error && <p className="text-red-500 text-sm py-4">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-gray-400 text-center py-10">No change requests yet.</p>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th col="co_number" label="CR #" />
                  <Th col="subject" label="Subject" />
                  <Th col="status" label="Status" />
                  <Th col="trade_name" label="Trade" />
                  <Th col="requested_by" label="Requested by" />
                  <Th col="due_date" label="Due date" />
                  <Th col="net_cost_impact" label="Net cost impact" />
                  <Th col="task_line_count" label="Lines" />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((cr) => (
                  <tr
                    key={cr.id}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => onSelect(cr.id)}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs font-medium text-charcoal whitespace-nowrap">{cr.co_number}</td>
                    <td className="px-3 py-2.5 text-charcoal max-w-xs truncate">{cr.subject}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        cr.status === 'approved' ? 'bg-green-100 text-green-700'
                        : cr.status === 'rejected' ? 'bg-red-100 text-red-700'
                        : cr.status === 'pending_approval' ? 'bg-yellow-100 text-yellow-700'
                        : cr.status === 'submitted' ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                      }`}>
                        {statusLabel(cr.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{cr.trade_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{cr.requested_by ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {cr.due_date
                        ? <span className="flex items-center gap-1 text-gray-600"><Calendar className="h-3 w-3" />{fmtDate(cr.due_date)}</span>
                        : <span className="text-amber-500 text-xs font-medium">Missing</span>
                      }
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <CostImpactCell value={safe(cr.net_cost_impact)} />
                    </td>
                    <td className="px-3 py-2.5 text-center text-gray-500">{cr.task_line_count}</td>
                    <td className="px-3 py-2.5 text-gray-400">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail View
// ─────────────────────────────────────────────────────────────────────────────

interface DetailViewProps {
  coId: string;
  onBack: () => void;
}

function CRDetailView({ coId, onBack }: DetailViewProps) {
  const { canWrite } = useAuth();
  const [cr, setCR] = useState<CRDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLineForm, setShowLineForm] = useState(false);
  const [lineForm, setLineForm] = useState({ ...BLANK_LINE });
  const [savingLine, setSavingLine] = useState(false);
  const [deletingLine, setDeletingLine] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/real-estate/change-requests/${coId}`);
      setCR(res.data);
    } catch {
      setError('Failed to load change request.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [coId]);

  const handleAddLine = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingLine(true);
    try {
      await api.post(`/api/real-estate/change-requests/${coId}/task-lines`, {
        division: lineForm.division || null,
        subdivision: lineForm.subdivision || null,
        task: lineForm.task || null,
        scope: lineForm.scope || null,
        original_value: parseFloat(lineForm.original_value || '0'),
        cost_impact: parseFloat(lineForm.cost_impact || '0'),
        action: lineForm.action || null,
        orig_start_date: lineForm.orig_start_date || null,
        orig_end_date: lineForm.orig_end_date || null,
        orig_duration_days: lineForm.orig_duration_days ? parseInt(lineForm.orig_duration_days) : null,
        revised_start_date: lineForm.revised_start_date || null,
        revised_end_date: lineForm.revised_end_date || null,
        revised_duration_days: lineForm.revised_duration_days ? parseInt(lineForm.revised_duration_days) : null,
        schedule_impact_days: lineForm.schedule_impact_days ? parseInt(lineForm.schedule_impact_days) : null,
      });
      setLineForm({ ...BLANK_LINE });
      setShowLineForm(false);
      load();
    } catch {
      alert('Failed to add task line.');
    } finally {
      setSavingLine(false);
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!confirm('Delete this task line?')) return;
    setDeletingLine(lineId);
    try {
      await api.delete(`/api/real-estate/change-requests/${coId}/task-lines/${lineId}`);
      load();
    } catch {
      alert('Failed to delete task line.');
    } finally {
      setDeletingLine(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 py-4">
        {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
      </div>
    );
  }
  if (error) return <p className="text-red-500 text-sm py-6">{error}</p>;
  if (!cr) return null;

  return (
    <div className="space-y-5">
      {/* Back link */}
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-charcoal transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to list
      </button>

      {/* Header block */}
      <Card title={
        <span className="flex items-center gap-3">
          <span className="font-mono text-sm text-gray-500">{cr.co_number}</span>
          <span>{cr.subject}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            cr.status === 'approved' ? 'bg-green-100 text-green-700'
            : cr.status === 'rejected' ? 'bg-red-100 text-red-700'
            : cr.status === 'pending_approval' ? 'bg-yellow-100 text-yellow-700'
            : cr.status === 'submitted' ? 'bg-blue-100 text-blue-700'
            : 'bg-gray-100 text-gray-600'
          }`}>
            {statusLabel(cr.status)}
          </span>
        </span>
      }>
        {/* Net impact banner */}
        <div className="flex items-center gap-6 mb-5 pb-4 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Net Cost Impact</p>
            <NetImpactBadge value={cr.net_cost_impact} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Net Schedule Impact</p>
            <span className={`text-lg font-semibold ${cr.net_schedule_impact_days > 0 ? 'text-amber-600' : cr.net_schedule_impact_days < 0 ? 'text-green-600' : 'text-gray-400'}`}>
              {cr.net_schedule_impact_days === 0 ? '—' : fmtDays(cr.net_schedule_impact_days)}
            </span>
          </div>
          {cr.task_lines.length === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              Net impact sourced from legacy amount field — add task lines for item-level detail.
            </p>
          )}
        </div>

        {/* Header fields grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
          <HeaderField label="Trade" value={cr.trade_name} />
          <HeaderField label="CSI Division" value={cr.csi_division_code} />
          <HeaderField label="Requested by" value={cr.requested_by} />
          <HeaderField label="Approver" value={cr.approver} />
          <HeaderField label="GC Superintendent" value={cr.gc_superintendent} />
          <HeaderField label="Type of Reference" value={cr.type_of_reference} />
          <HeaderField label="Attached CR" value={cr.attached_cr} />
          <HeaderField label="Reason Code" value={cr.reason_code} />
          <HeaderField label="Request Date" value={fmtDate(cr.request_date)} />
          <HeaderField label="Due Date" value={cr.due_date ? fmtDate(cr.due_date) : undefined} />
          <HeaderField label="Approval Date" value={fmtDate(cr.approval_date)} />
          <HeaderField label="Created by" value={cr.created_by} />
          <div className="col-span-2 sm:col-span-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Requested Amount</p>
            <p className="text-sm font-medium text-charcoal">{fmtUSD(cr.requested_amount)}</p>
          </div>
          {cr.approved_amount != null && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Approved Amount</p>
              <p className="text-sm font-medium text-green-700">{fmtUSD(cr.approved_amount)}</p>
            </div>
          )}
          {cr.description && (
            <div className="col-span-2 sm:col-span-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Description</p>
              <p className="text-sm text-charcoal whitespace-pre-wrap">{cr.description}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Task Lines */}
      <Card title="Task Lines" actions={
        canWrite && !showLineForm ? (
          <button
            onClick={() => setShowLineForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-light"
          >
            <Plus className="h-4 w-4" /> Add Line
          </button>
        ) : undefined
      }>
        {/* Add line form */}
        {showLineForm && canWrite && (
          <form onSubmit={handleAddLine} className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 space-y-3">
            <p className="text-sm font-medium text-charcoal mb-1">New Task Line</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input placeholder="Division" value={lineForm.division}
                onChange={(e) => setLineForm({ ...lineForm, division: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="Subdivision" value={lineForm.subdivision}
                onChange={(e) => setLineForm({ ...lineForm, subdivision: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input placeholder="Task description" value={lineForm.task}
                onChange={(e) => setLineForm({ ...lineForm, task: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm col-span-1 sm:col-span-2" />
              <select value={lineForm.scope} onChange={(e) => setLineForm({ ...lineForm, scope: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Scope…</option>
                <option value="in_scope">In Scope</option>
                <option value="out_of_scope">Out of Scope</option>
                <option value="tbd">TBD</option>
              </select>
              <select value={lineForm.action} onChange={(e) => setLineForm({ ...lineForm, action: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">Action…</option>
                <option value="add">Add</option>
                <option value="delete">Delete</option>
                <option value="revise">Revise</option>
                <option value="no_change">No Change</option>
              </select>
              <input type="number" step="0.01" placeholder="Original value" value={lineForm.original_value}
                onChange={(e) => setLineForm({ ...lineForm, original_value: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="number" step="0.01" placeholder="Cost impact (neg = saving)" value={lineForm.cost_impact}
                onChange={(e) => setLineForm({ ...lineForm, cost_impact: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <p className="text-xs text-gray-500 col-span-1 sm:col-span-4 mt-1 mb-0 -mb-1">Original schedule</p>
              <input type="date" placeholder="Orig start" value={lineForm.orig_start_date}
                onChange={(e) => setLineForm({ ...lineForm, orig_start_date: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="date" placeholder="Orig end" value={lineForm.orig_end_date}
                onChange={(e) => setLineForm({ ...lineForm, orig_end_date: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="number" placeholder="Orig duration (days)" value={lineForm.orig_duration_days}
                onChange={(e) => setLineForm({ ...lineForm, orig_duration_days: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <p className="text-xs text-gray-500 col-span-1 sm:col-span-4 mt-1 -mb-1">Revised schedule</p>
              <input type="date" placeholder="Revised start" value={lineForm.revised_start_date}
                onChange={(e) => setLineForm({ ...lineForm, revised_start_date: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="date" placeholder="Revised end" value={lineForm.revised_end_date}
                onChange={(e) => setLineForm({ ...lineForm, revised_end_date: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="number" placeholder="Revised duration (days)" value={lineForm.revised_duration_days}
                onChange={(e) => setLineForm({ ...lineForm, revised_duration_days: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="number" placeholder="Schedule impact (days)" value={lineForm.schedule_impact_days}
                onChange={(e) => setLineForm({ ...lineForm, schedule_impact_days: e.target.value })}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={savingLine}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
                {savingLine ? 'Adding…' : 'Add Line'}
              </button>
              <button type="button" onClick={() => { setShowLineForm(false); setLineForm({ ...BLANK_LINE }); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        )}

        {cr.task_lines.length === 0 ? (
          <p className="text-gray-400 text-center py-8 text-sm">
            No task lines yet.{canWrite ? ' Click "Add Line" to break this CR into item-level detail.' : ''}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] text-sm w-full">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Division</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Subdivision</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap min-w-[180px]">Task</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Scope</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Original value</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Cost impact</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Revised value</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Action</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Orig start</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Orig end</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Orig dur.</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Rev. start</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Rev. end</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Sched Δ</th>
                  {canWrite && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cr.task_lines.map((line) => (
                  <tr key={line.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{line.division ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{line.subdivision ?? '—'}</td>
                    <td className="px-3 py-2.5 text-charcoal">{line.task ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {line.scope ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          line.scope === 'in_scope' ? 'bg-green-100 text-green-700'
                          : line.scope === 'out_of_scope' ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {line.scope.replace(/_/g, ' ')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap font-mono">{fmtUSD(line.original_value)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap font-mono">
                      <CostImpactCell value={safe(line.cost_impact)} />
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700 whitespace-nowrap font-mono">{fmtUSD(line.revised_sched_value)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {line.action ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          line.action === 'add' ? 'bg-blue-100 text-blue-700'
                          : line.action === 'delete' ? 'bg-red-100 text-red-700'
                          : line.action === 'revise' ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {line.action.replace(/_/g, ' ')}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(line.orig_start_date)}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(line.orig_end_date)}</td>
                    <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                      {line.orig_duration_days != null ? `${line.orig_duration_days}d` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(line.revised_start_date)}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(line.revised_end_date)}</td>
                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                      <SchedImpactCell value={line.schedule_impact_days} />
                    </td>
                    {canWrite && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteLine(line.id)}
                          disabled={deletingLine === line.id}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                        >
                          {deletingLine === line.id ? '…' : 'Delete'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {cr.task_lines.length > 0 && (
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td className="px-3 py-2 text-xs font-medium text-gray-500" colSpan={4}>Totals</td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-medium text-charcoal whitespace-nowrap">
                      {fmtUSD(cr.task_lines.reduce((s, l) => s + safe(l.original_value), 0))}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap font-mono">
                      <CostImpactCell value={safe(cr.net_cost_impact)} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-medium text-charcoal whitespace-nowrap">
                      {fmtUSD(cr.task_lines.reduce((s, l) => s + safe(l.revised_sched_value), 0))}
                    </td>
                    <td colSpan={6} />
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      <SchedImpactCell value={cr.net_schedule_impact_days} />
                    </td>
                    {canWrite && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Revised Value = Original + Cost Impact. Net cost impact is summed across all task lines; schedule impact is net additive.
        </p>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component — routes between list and detail view
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

export default function ConstructionCR({ projectId }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <ErrorBoundary>
      {selectedId === null ? (
        <CRListView projectId={projectId} onSelect={setSelectedId} />
      ) : (
        <CRDetailView coId={selectedId} onBack={() => setSelectedId(null)} />
      )}
    </ErrorBoundary>
  );
}
