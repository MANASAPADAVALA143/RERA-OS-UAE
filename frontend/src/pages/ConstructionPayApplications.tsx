import { useCallback, useEffect, useState } from 'react';
import { Plus, ChevronDown, ChevronUp, Trash2, ChevronRight } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { StatusPill } from '../components/ui/StatusPill';
import { useAuth } from '../contexts/AuthContext';
import { fmtUSD } from '../components/ProtectedRoute';

interface PayApp {
  id: string;
  pay_app_number: string;
  subcontractor_name: string;
  period_start: string | null;
  period_end: string;
  scheduled_value: number;
  prev_completed: number;
  curr_completed: number;
  stored_materials: number;
  total_completed_stored: number;
  retainage_pct: number;
  retainage_amount: number;
  total_less_retainage: number;
  previous_payments: number;
  current_payment_due: number;
  status: string;
  submitted_date: string | null;
  approved_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

interface Summary {
  count: number;
  total_billed: number;
  total_payment_due: number;
  by_status: Record<string, number>;
}

type SortKey = keyof PayApp;

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  paid: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const BLANK_FORM = {
  pay_app_number: '',
  subcontractor_name: '',
  period_start: '',
  period_end: '',
  scheduled_value: '',
  prev_completed: '',
  curr_completed: '',
  stored_materials: '',
  retainage_pct: '10',
  previous_payments: '',
  notes: '',
};

export default function ConstructionPayApplications({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canWrite = user?.role === 'admin' || user?.role === 'write';

  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<PayApp[]>([]);
  const [summary, setSummary] = useState<Summary>({ count: 0, total_billed: 0, total_payment_due: 0, by_status: {} });
  const [error, setError] = useState('');

  const [sortKey, setSortKey] = useState<SortKey>('period_end');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/real-estate/pay-applications', { params: { project_id: projectId } });
      setApps(res.data.items ?? []);
      setSummary(res.data.summary ?? { count: 0, total_billed: 0, total_payment_due: 0, by_status: {} });
    } catch {
      setError('Failed to load pay applications.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  const sorted = [...apps].sort((a, b) => {
    const av = a[sortKey]; const bv = b[sortKey];
    if (av == null) return 1; if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.pay_app_number.trim()) { setFormError('Pay App # is required.'); return; }
    if (!form.subcontractor_name.trim()) { setFormError('Subcontractor name is required.'); return; }
    if (!form.period_end) { setFormError('Period end date is required.'); return; }

    setSaving(true);
    try {
      await api.post('/api/real-estate/pay-applications', {
        project_id: projectId,
        pay_app_number: form.pay_app_number.trim(),
        subcontractor_name: form.subcontractor_name.trim(),
        period_start: form.period_start || null,
        period_end: form.period_end,
        scheduled_value: parseFloat(form.scheduled_value) || 0,
        prev_completed: parseFloat(form.prev_completed) || 0,
        curr_completed: parseFloat(form.curr_completed) || 0,
        stored_materials: parseFloat(form.stored_materials) || 0,
        retainage_pct: (parseFloat(form.retainage_pct) || 10) / 100,
        previous_payments: parseFloat(form.previous_payments) || 0,
        notes: form.notes.trim() || null,
      });
      setForm({ ...BLANK_FORM });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setFormError(err?.response?.data?.detail || 'Failed to create pay application.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    setStatusUpdating(id);
    try {
      await api.patch(`/api/real-estate/pay-applications/${id}`, { status });
      await load();
    } finally {
      setStatusUpdating(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this pay application?')) return;
    await api.delete(`/api/real-estate/pay-applications/${id}`);
    await load();
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronRight size={12} className="opacity-30 rotate-90" />;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  }

  function th(label: string, col: SortKey, align = 'left') {
    return (
      <th
        key={col}
        onClick={() => handleSort(col)}
        className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap text-${align}`}
      >
        <span className="inline-flex items-center gap-1">{label}<SortIcon col={col} /></span>
      </th>
    );
  }

  if (!projectId) return <p className="text-gray-400 text-sm">Select a project to view pay applications.</p>;

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Total Pay Apps" value={String(summary.count)} />
        <KpiCard label="Total Billed" value={fmtUSD(summary.total_billed)} />
        <KpiCard
          label="Pending Approval"
          value={String(summary.by_status['submitted'] ?? 0)}
          accent={(summary.by_status['submitted'] ?? 0) > 0}
        />
        <KpiCard label="Current Payment Due" value={fmtUSD(summary.total_payment_due)} accent={summary.total_payment_due > 0} />
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Table */}
      <Card
        title="Pay Applications"
        action={canWrite ? (
          <button
            onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus size={13} /> New Pay App
          </button>
        ) : undefined}
      >
        {/* Create Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">New Pay Application (AIA G702)</h3>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Pay App #</label>
                <input
                  value={form.pay_app_number}
                  onChange={e => setForm(f => ({ ...f, pay_app_number: e.target.value }))}
                  placeholder="001"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Subcontractor Name</label>
                <input
                  value={form.subcontractor_name}
                  onChange={e => setForm(f => ({ ...f, subcontractor_name: e.target.value }))}
                  placeholder="ABC Concrete Inc."
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Period Start</label>
                <input
                  type="date"
                  value={form.period_start}
                  onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Period End *</label>
                <input
                  type="date"
                  value={form.period_end}
                  onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Scheduled Value (D)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.scheduled_value}
                  onChange={e => setForm(f => ({ ...f, scheduled_value: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prev Completed (E)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.prev_completed}
                  onChange={e => setForm(f => ({ ...f, prev_completed: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">This Period (F)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.curr_completed}
                  onChange={e => setForm(f => ({ ...f, curr_completed: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Stored Materials (G3)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.stored_materials}
                  onChange={e => setForm(f => ({ ...f, stored_materials: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Retainage %</label>
                <input
                  type="number" step="0.1" min="0" max="100"
                  value={form.retainage_pct}
                  onChange={e => setForm(f => ({ ...f, retainage_pct: e.target.value }))}
                  placeholder="10"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Previous Payments (J)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.previous_payments}
                  onChange={e => setForm(f => ({ ...f, previous_payments: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowForm(false); setFormError(''); setForm({ ...BLANK_FORM }); }}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create Pay App'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : apps.length === 0 ? (
          <p className="text-center py-10 text-sm text-gray-400">No pay applications yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:-mx-6">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 w-8" />
                  {th('#', 'pay_app_number')}
                  {th('Subcontractor', 'subcontractor_name')}
                  {th('Period End', 'period_end')}
                  {th('Scheduled Value', 'scheduled_value', 'right')}
                  {th('Total Completed', 'total_completed_stored', 'right')}
                  {th('Retainage', 'retainage_amount', 'right')}
                  {th('Payment Due', 'current_payment_due', 'right')}
                  {th('Status', 'status')}
                  {canWrite && <th className="px-3 py-2 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(app => (
                  <>
                    <tr key={app.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setExpandedId(expandedId === app.id ? null : app.id)}
                          className="text-gray-400 hover:text-gray-700"
                        >
                          {expandedId === app.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-medium text-gray-700">{app.pay_app_number}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-800">{app.subcontractor_name}</td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{app.period_end}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{fmtUSD(app.scheduled_value)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{fmtUSD(app.total_completed_stored)}</td>
                      <td className="px-3 py-2.5 text-right text-amber-700">{fmtUSD(app.retainage_amount)}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{fmtUSD(app.current_payment_due)}</td>
                      <td className="px-3 py-2.5">
                        {canWrite ? (
                          <select
                            value={app.status}
                            disabled={statusUpdating === app.id}
                            onChange={e => handleStatusChange(app.id, e.target.value)}
                            className={`text-xs px-2 py-0.5 rounded-full border-0 font-medium ${STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600'}`}
                          >
                            {['draft', 'submitted', 'approved', 'paid', 'rejected'].map(s => (
                              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                          </span>
                        )}
                      </td>
                      {canWrite && (
                        <td className="px-3 py-2.5 text-center">
                          <button onClick={() => handleDelete(app.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                    {/* Expandable G702 detail drawer */}
                    {expandedId === app.id && (
                      <tr key={`${app.id}-drawer`} className="bg-slate-50">
                        <td colSpan={canWrite ? 10 : 9} className="px-6 py-4">
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            AIA G702 Detail — {app.subcontractor_name} / App #{app.pay_app_number}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-2 text-sm">
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">D. Scheduled Value</span>
                              <span className="font-medium">{fmtUSD(app.scheduled_value)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">E. Prev Completed</span>
                              <span className="font-medium">{fmtUSD(app.prev_completed)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">F. This Period</span>
                              <span className="font-medium">{fmtUSD(app.curr_completed)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">G3. Stored Materials</span>
                              <span className="font-medium">{fmtUSD(app.stored_materials)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">G. Total Completed</span>
                              <span className="font-semibold">{fmtUSD(app.total_completed_stored)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">H. Retainage ({(app.retainage_pct * 100).toFixed(1)}%)</span>
                              <span className="font-medium text-amber-700">{fmtUSD(app.retainage_amount)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">I. Total Less Retainage</span>
                              <span className="font-medium">{fmtUSD(app.total_less_retainage)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 pb-1">
                              <span className="text-gray-500">J. Previous Payments</span>
                              <span className="font-medium">{fmtUSD(app.previous_payments)}</span>
                            </div>
                            <div className="flex justify-between border-b-2 border-gray-400 pb-1 col-span-2 sm:col-span-2 font-semibold">
                              <span className="text-gray-700">K. Current Payment Due</span>
                              <span className="text-primary">{fmtUSD(app.current_payment_due)}</span>
                            </div>
                          </div>
                          {app.notes && (
                            <p className="mt-3 text-xs text-gray-500 italic">{app.notes}</p>
                          )}
                          <div className="mt-2 text-xs text-gray-400">
                            Period: {app.period_start ?? '—'} → {app.period_end}
                            {app.submitted_date && ` · Submitted: ${app.submitted_date}`}
                            {app.approved_date && ` · Approved: ${app.approved_date}`}
                            {app.created_by && ` · By: ${app.created_by}`}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
