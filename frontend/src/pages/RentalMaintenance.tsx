import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, CheckCircle, RefreshCw } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import { useAuth } from '../contexts/AuthContext';

interface RepeatIssue { unit_id: string; unit_number: string | null; category: string; count: number }
interface MaintenanceSummary {
  open_count: number;
  in_progress_count: number;
  overdue_count: number;
  avg_days_to_close: number;
  cost_this_month: number;
  repeat_issues: RepeatIssue[];
}

interface MaintRequest {
  id: string;
  unit_id: string;
  unit_number: string;
  company_name: string;
  property_name: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  reported_by: string | null;
  reported_date: string | null;
  vendor_name: string | null;
  target_completion_date: string | null;
  actual_completion_date: string | null;
  cost: number | null;
  days_open: number;
  is_overdue: boolean;
  sla_status: string;
  sla_target_days: number;
}

const PRIORITY_PILL: Record<string, string> = {
  emergency: 'bg-red-600 text-white',
  high:      'bg-red-100 text-red-800',
  medium:    'bg-amber-100 text-amber-800',
  low:       'bg-gray-100 text-gray-700',
};

const STATUS_PILL: Record<string, string> = {
  open:        'bg-blue-100 text-blue-800',
  assigned:    'bg-purple-100 text-purple-800',
  in_progress: 'bg-amber-100 text-amber-800',
  completed:   'bg-green-100 text-green-800',
  closed:      'bg-gray-100 text-gray-700',
};

const SLA_PILL: Record<string, string> = {
  overdue:  'bg-red-100 text-red-700',
  at_risk:  'bg-amber-100 text-amber-700',
  on_time:  'bg-green-100 text-green-700',
  closed:   'bg-gray-100 text-gray-600',
};

const CATEGORIES = ['plumbing','electrical','hvac','appliance','structural','pest_control','general','other'];
const STATUSES   = ['open','assigned','in_progress','completed','closed'];
const PRIORITIES = ['low','medium','high','emergency'];

const BLANK_FORM = {
  unit_id: '', title: '', description: '', category: 'general',
  priority: 'medium', reported_by: '', reported_date: '',
};

export default function RentalMaintenance() {
  const { canWrite } = useAuth();
  const [summary, setSummary] = useState<MaintenanceSummary | null>(null);
  const [items, setItems] = useState<MaintRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editVendor, setEditVendor] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filterStatus)   params.status   = filterStatus;
      if (filterPriority) params.priority = filterPriority;
      const res = await api.get<{ summary: MaintenanceSummary; items: MaintRequest[] }>(
        '/api/rentals/maintenance', { params }
      );
      setSummary(res.data.summary);
      setItems(res.data.items);
    } catch {
      setError('Failed to load maintenance data');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterPriority]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/rentals/maintenance', {
        ...form,
        reported_date: form.reported_date || new Date().toISOString().slice(0, 10),
      });
      setForm({ ...BLANK_FORM });
      setShowForm(false);
      fetchData();
    } catch {
      alert('Failed to create request');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      await api.put(`/api/rentals/maintenance/${id}`, {
        status: editStatus,
        vendor_name: editVendor || null,
        ...(editStatus === 'completed' ? { actual_completion_date: new Date().toISOString().slice(0, 10) } : {}),
      });
      setEditId(null);
      fetchData();
    } catch {
      alert('Failed to update request');
    }
  };

  // repeat issue unit IDs for quick lookup
  const repeatUnitIds = new Set((summary?.repeat_issues ?? []).map(r => r.unit_id));

  if (loading) return <LoadingSkeleton />;
  if (error)   return <p className="text-red-500 p-4">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Work orders across all properties</p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90"
          >
            + New Request
          </button>
        )}
      </div>

      {/* KPI strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiCard label="Open"            value={String(summary.open_count)}            />
          <KpiCard label="In Progress"     value={String(summary.in_progress_count)}     />
          <KpiCard label="Overdue"         value={String(summary.overdue_count)} accent={summary.overdue_count > 0} />
          <KpiCard label="Avg Days to Close" value={`${summary.avg_days_to_close}d`}     />
          <KpiCard label="Cost This Month" value={fmtUSD(summary.cost_this_month)}       />
        </div>
      )}

      {/* Repeat issues banner */}
      {summary && summary.repeat_issues.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Repeat Issues Detected</p>
            <ul className="mt-1 space-y-0.5">
              {summary.repeat_issues.map((ri, i) => (
                <li key={i} className="text-sm text-amber-700">
                  Unit <strong>{ri.unit_number}</strong> — {ri.count} {ri.category} requests in last 90 days
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* New Request Form */}
      {showForm && canWrite && (
        <Card title="New Maintenance Request">
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Unit ID</label>
              <input
                required value={form.unit_id}
                onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}
                placeholder="Paste unit UUID"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
              <input
                required value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_',' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reported By</label>
              <input value={form.reported_by} onChange={e => setForm(f => ({ ...f, reported_by: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Reported Date</label>
              <input type="date" value={form.reported_date} onChange={e => setForm(f => ({ ...f, reported_date: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div className="md:col-span-2 flex gap-3">
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50">
                {saving ? 'Saving…' : 'Create Request'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
          <option value="">All Priorities</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={fetchData} className="flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Table */}
      <Card title={`Work Orders (${items.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200">
                {['Unit','Company','Title','Category','Priority','Status','Reported','Vendor','SLA','Cost',''].map(h => (
                  <th key={h} className="py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 && (
                <tr><td colSpan={11} className="py-8 text-center text-gray-400">No requests found</td></tr>
              )}
              {items.map(req => (
                <tr key={req.id} className={req.is_overdue ? 'bg-red-50' : ''}>
                  <td className="py-3 px-3 font-mono font-medium whitespace-nowrap">
                    {req.unit_number}
                    {repeatUnitIds.has(req.unit_id) && (
                      <span title="Repeat issue on this unit" className="ml-1 text-amber-500">⚠</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap text-xs">{req.company_name}</td>
                  <td className="py-3 px-3 max-w-[200px] truncate" title={req.title}>{req.title}</td>
                  <td className="py-3 px-3 text-gray-600 capitalize whitespace-nowrap text-xs">{req.category.replace('_',' ')}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_PILL[req.priority] || 'bg-gray-100 text-gray-700'}`}>
                      {req.priority}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_PILL[req.status] || 'bg-gray-100'}`}>
                      {req.status.replace('_',' ')}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap text-xs">{req.reported_date}</td>
                  <td className="py-3 px-3 text-gray-600 text-xs">{req.vendor_name || '—'}</td>
                  <td className="py-3 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SLA_PILL[req.sla_status] || 'bg-gray-100'}`}>
                      {req.sla_status === 'overdue' ? `${req.days_open}d overdue` :
                       req.sla_status === 'at_risk'  ? 'at risk' :
                       req.sla_status === 'closed'   ? 'closed'  : `${req.days_open}d / ${req.sla_target_days}d`}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right whitespace-nowrap text-xs">{req.cost != null ? fmtUSD(req.cost) : '—'}</td>
                  <td className="py-3 px-3">
                    {canWrite && editId !== req.id && (
                      <button
                        onClick={() => { setEditId(req.id); setEditStatus(req.status); setEditVendor(req.vendor_name || ''); }}
                        className="text-xs text-accent hover:underline"
                      >Edit</button>
                    )}
                    {canWrite && editId === req.id && (
                      <div className="flex flex-col gap-1 min-w-[140px]">
                        <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                          className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent">
                          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                        </select>
                        <input placeholder="Vendor" value={editVendor} onChange={e => setEditVendor(e.target.value)}
                          className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent" />
                        <div className="flex gap-1">
                          <button onClick={() => handleUpdate(req.id)}
                            className="px-2 py-1 bg-accent text-white rounded text-xs hover:bg-accent/90">Save</button>
                          <button onClick={() => setEditId(null)}
                            className="px-2 py-1 border rounded text-xs text-gray-600 hover:bg-gray-50">✕</button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* SLA legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> On Time</span>
        <span className="flex items-center gap-1"><Clock size={12} className="text-amber-500" /> At Risk (1 day left)</span>
        <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-red-500" /> Overdue — SLA targets: Emergency 1d · High 3d · Medium 7d · Low 14d</span>
      </div>
    </div>
  );
}
