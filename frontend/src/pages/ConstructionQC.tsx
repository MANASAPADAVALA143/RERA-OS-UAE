import { useEffect, useState } from 'react';
import { CheckCircle, Plus, XCircle } from 'lucide-react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';
import { fmtPct } from '../components/ProtectedRoute';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SovOption {
  id: string;
  label: string;
  code: string | null;
}

interface QCRecord {
  id: string;
  project_id: string;
  linked_sov_id: string | null;
  linked_sov_label: string | null;
  linked_sov_code: string | null;
  qc_date: string | null;
  start_date: string | null;
  end_date: string | null;
  pct_complete: number | null;
  qc_performed_by: string | null;
  notes: string | null;
  materials_notes: string | null;
  status: 'passed' | 'failed' | 'pending';
  created_by: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  passed: { label: 'Passed', bg: 'bg-green-100', text: 'text-green-700' },
  failed: { label: 'Failed', bg: 'bg-red-100', text: 'text-red-700' },
  pending: { label: 'Pending', bg: 'bg-yellow-100', text: 'text-yellow-700' },
};

function StatusPillInline({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
}

const BLANK_FORM = {
  linked_sov_id: '',
  qc_date: '',
  start_date: '',
  end_date: '',
  pct_complete: '',
  qc_performed_by: '',
  notes: '',
  materials_notes: '',
  status: 'pending',
};

// ─────────────────────────────────────────────────────────────────────────────
// Inline status change control
// ─────────────────────────────────────────────────────────────────────────────

function InlineStatusChange({
  qcId,
  currentStatus,
  onChanged,
}: {
  qcId: string;
  currentStatus: string;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const change = async (status: string) => {
    setSaving(true);
    setOpen(false);
    try {
      await api.put(`/api/real-estate/quality-checks/${qcId}`, { status });
      onChanged();
    } catch {
      alert('Failed to update status.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="text-xs text-primary hover:underline disabled:opacity-50 whitespace-nowrap"
      >
        {saving ? 'Saving…' : 'Change status…'}
      </button>
      {open && (
        <div className="absolute z-10 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[130px]">
          {(['passed', 'failed', 'pending'] as const).filter(s => s !== currentStatus).map((s) => (
            <button
              key={s}
              onClick={() => change(s)}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 text-charcoal"
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function ConstructionQC({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth();
  const [items, setItems] = useState<QCRecord[]>([]);
  const [sovOptions, setSovOptions] = useState<SovOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { project_id: projectId };
      if (filterStatus) params.status = filterStatus;
      const [qcRes, sovRes] = await Promise.all([
        api.get('/api/real-estate/quality-checks', { params }),
        api.get('/api/real-estate/costs/sov/' + projectId),
      ]);
      setItems(qcRes.data.items ?? []);
      // Build SOV options from the SOV detail endpoint
      const subs: SovOption[] = (sovRes.data.subcontractor_sovs ?? []).map((r: any) => ({
        id: r.id,
        label: r.trade_name || r.division_label || r.csi_division_code || 'Unknown',
        code: r.csi_division_code,
      }));
      if (sovRes.data.master_sov) {
        subs.unshift({ id: sovRes.data.master_sov.id, label: 'Master SOV', code: null });
      }
      setSovOptions(subs);
    } catch {
      setError('Failed to load quality checks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId, filterStatus]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/real-estate/quality-checks', {
        project_id: projectId,
        linked_sov_id: form.linked_sov_id || null,
        qc_date: form.qc_date || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        pct_complete: form.pct_complete ? parseFloat(form.pct_complete) : null,
        qc_performed_by: form.qc_performed_by || null,
        notes: form.notes || null,
        materials_notes: form.materials_notes || null,
        status: form.status,
      });
      setForm({ ...BLANK_FORM });
      setShowForm(false);
      load();
    } catch {
      alert('Failed to create quality check.');
    } finally {
      setSaving(false);
    }
  };

  const passed = items.filter(i => i.status === 'passed').length;
  const failed = items.filter(i => i.status === 'failed').length;
  const pending = items.filter(i => i.status === 'pending').length;

  return (
    <ErrorBoundary>
      <div className="space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total</p>
            <p className="text-2xl font-bold text-charcoal">{items.length}</p>
          </div>
          <div className="bg-white border border-green-200 rounded-xl px-4 py-3">
            <p className="text-xs text-green-600 uppercase tracking-wide mb-1">Passed</p>
            <p className="text-2xl font-bold text-green-700">{passed}</p>
          </div>
          <div className="bg-white border border-red-200 rounded-xl px-4 py-3">
            <p className="text-xs text-red-500 uppercase tracking-wide mb-1">Failed</p>
            <p className="text-2xl font-bold text-red-600">{failed}</p>
          </div>
          <div className="bg-white border border-yellow-200 rounded-xl px-4 py-3">
            <p className="text-xs text-yellow-600 uppercase tracking-wide mb-1">Pending</p>
            <p className="text-2xl font-bold text-yellow-700">{pending}</p>
          </div>
        </div>

        <Card
          title="Quality Checks"
          actions={
            <div className="flex items-center gap-3">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">All statuses</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
              {canWrite && !showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-light"
                >
                  <Plus className="h-4 w-4" /> New QC
                </button>
              )}
            </div>
          }
        >
          {/* Create form */}
          {showForm && canWrite && (
            <form onSubmit={handleCreate} className="border border-gray-200 rounded-lg p-4 mb-4 bg-gray-50 space-y-3">
              <p className="text-sm font-medium text-charcoal">New Quality Check</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="col-span-1 sm:col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">Linked SOV / Division</label>
                  <select value={form.linked_sov_id} onChange={(e) => setForm({ ...form, linked_sov_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="">— None —</option>
                    {sovOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.code ? `${s.code} · ` : ''}{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="pending">Pending</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">QC Date</label>
                  <input type="date" value={form.qc_date} onChange={(e) => setForm({ ...form, qc_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Work Period Start</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Work Period End</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Work % Complete (e.g. 0.75)</label>
                  <input type="number" step="0.01" min="0" max="1" placeholder="0.00 – 1.00"
                    value={form.pct_complete} onChange={(e) => setForm({ ...form, pct_complete: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">QC Performed By</label>
                  <input placeholder="Name" value={form.qc_performed_by}
                    onChange={(e) => setForm({ ...form, qc_performed_by: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="col-span-1 sm:col-span-3">
                  <label className="text-xs text-gray-500 mb-1 block">Notes</label>
                  <textarea rows={2} placeholder="Observation notes…" value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
                </div>
                <div className="col-span-1 sm:col-span-3">
                  <label className="text-xs text-gray-500 mb-1 block">Materials / Spec Notes</label>
                  <textarea rows={2} placeholder="Materials used, spec references…" value={form.materials_notes}
                    onChange={(e) => setForm({ ...form, materials_notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
                </div>
              </div>
              <div className="flex gap-2">
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
            <div className="space-y-2 py-2">{[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}</div>
          )}
          {error && <p className="text-red-500 text-sm py-4">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="text-gray-400 text-center py-10">No quality checks yet.</p>
          )}
          {!loading && !error && items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Linked SOV</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">QC Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Start Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">End Date</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">% Complete</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Performed By</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide min-w-[200px]">Notes</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((qc) => (
                    <tr key={qc.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 whitespace-nowrap">
                        {qc.linked_sov_label ? (
                          <span className="text-charcoal font-medium">
                            {qc.linked_sov_code && <span className="text-gray-400 font-mono text-xs mr-1">{qc.linked_sov_code}</span>}
                            {qc.linked_sov_label}
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">{fmtDate(qc.qc_date)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">{fmtDate(qc.start_date)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">{fmtDate(qc.end_date)}</td>
                      <td className="px-3 py-3 text-center text-gray-700">
                        {qc.pct_complete != null ? fmtPct(qc.pct_complete) : '—'}
                      </td>
                      <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{qc.qc_performed_by ?? '—'}</td>
                      <td className="px-3 py-3">
                        {qc.notes && <p className="text-sm text-charcoal">{qc.notes}</p>}
                        {qc.materials_notes && (
                          <p className="text-xs text-gray-500 mt-0.5 italic">{qc.materials_notes}</p>
                        )}
                        {!qc.notes && !qc.materials_notes && <span className="text-gray-400">—</span>}
                        {qc.created_by && (
                          <p className="text-xs text-gray-400 mt-1">Created by {qc.created_by}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1.5">
                          <StatusPillInline status={qc.status} />
                          {canWrite && (
                            <InlineStatusChange qcId={qc.id} currentStatus={qc.status} onChanged={load} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </ErrorBoundary>
  );
}
