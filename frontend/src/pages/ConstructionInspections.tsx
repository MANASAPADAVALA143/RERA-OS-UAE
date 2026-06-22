import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ClipboardCheck, Plus } from 'lucide-react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { useAuth } from '../contexts/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface InspectionSummary {
  total: number;
  open: number;
  scheduled: number;
  passed: number;
  failed: number;
  pct_open: number;
  pct_scheduled: number;
  pct_passed: number;
  pct_failed: number;
}

interface InspectionRow {
  id: string;
  inspection_number: string;
  title: string;
  linked_sov_id: string | null;
  linked_sov_label: string | null;
  inspection_type: string;
  status: string;
  inspection_date: string | null;
  performed_by_org: string | null;
  performed_by_internal: string | null;
  notes: string | null;
}

interface InspectionGroup {
  linked_sov_id: string | null;
  linked_sov_label: string | null;
  count: number;
  inspections: InspectionRow[];
}

interface SovOption {
  id: string;
  label: string;
  code: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function typeLabel(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const STATUS_META: Record<string, { bg: string; text: string; label: string }> = {
  open:      { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Open' },
  scheduled: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Scheduled' },
  passed:    { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Passed' },
  failed:    { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Failed' },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: status };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
}

const INSPECTION_TYPES = [
  'structural', 'plumbing', 'electrical', 'mechanical', 'fire_protection',
  'building_envelope', 'concrete', 'soil_foundation', 'accessibility',
  'energy_code', 'special', 'fire_life_safety', 'final', 'other',
];

const BLANK_FORM = {
  title: '',
  linked_sov_id: '',
  inspection_type: 'other',
  status: 'open',
  inspection_date: '',
  performed_by_org: '',
  performed_by_internal: '',
  notes: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────────────────────

function KpiBlock({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${color}`}>
      <p className="text-xs uppercase tracking-wide font-medium mb-1 opacity-70">{label}</p>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs mt-0.5 opacity-60">{pct.toFixed(1)}%</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Group row (collapsible)
// ─────────────────────────────────────────────────────────────────────────────

const LARGE_GROUP_THRESHOLD = 8;

function GroupSection({ group }: { group: InspectionGroup }) {
  const [expanded, setExpanded] = useState(group.count <= LARGE_GROUP_THRESHOLD);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Group header */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="flex items-center gap-3">
          <span className="font-medium text-charcoal">{group.linked_sov_label ?? 'Unlinked'}</span>
          <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
            {group.count} inspection{group.count !== 1 ? 's' : ''}
          </span>
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {/* Inspection rows */}
      {expanded && (
        <div className="divide-y divide-gray-100">
          {group.inspections.map((insp) => (
            <div key={insp.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-start gap-3 flex-wrap">
                <span className="font-mono text-xs text-gray-400 mt-0.5 shrink-0">{insp.inspection_number}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-charcoal">{insp.title}</p>
                  {insp.linked_sov_label && (
                    <p className="text-xs text-gray-400 mt-0.5">{insp.linked_sov_label}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mt-1.5">
                    <StatusBadge status={insp.status} />
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {typeLabel(insp.inspection_type)}
                    </span>
                    {insp.inspection_date && (
                      <span className="text-xs text-gray-500">{fmtDate(insp.inspection_date)}</span>
                    )}
                  </div>
                  {(insp.performed_by_org || insp.performed_by_internal) && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      {insp.performed_by_org && (
                        <p className="text-xs text-gray-500">
                          <span className="text-gray-400">External: </span>{insp.performed_by_org}
                        </p>
                      )}
                      {insp.performed_by_internal && (
                        <p className="text-xs text-gray-500">
                          <span className="text-gray-400">Internal: </span>{insp.performed_by_internal}
                        </p>
                      )}
                    </div>
                  )}
                  {insp.notes && (
                    <p className="text-xs text-gray-500 mt-1 italic">{insp.notes}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

export default function ConstructionInspections({ projectId }: { projectId: string }) {
  const { canWrite } = useAuth();
  const [summary, setSummary] = useState<InspectionSummary | null>(null);
  const [groups, setGroups] = useState<InspectionGroup[]>([]);
  const [allTypes, setAllTypes] = useState<string[]>([]);
  const [sovOptions, setSovOptions] = useState<SovOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { project_id: projectId };
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.inspection_type = filterType;
      const [inspRes, sovRes] = await Promise.all([
        api.get('/api/real-estate/inspections', { params }),
        api.get('/api/real-estate/costs/sov/' + projectId),
      ]);
      setSummary(inspRes.data.summary ?? null);
      setGroups(inspRes.data.groups ?? []);
      setAllTypes(inspRes.data.inspection_types ?? INSPECTION_TYPES);
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
      setError('Failed to load inspections.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projectId, filterStatus, filterType]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/real-estate/inspections', {
        project_id: projectId,
        title: form.title,
        linked_sov_id: form.linked_sov_id || null,
        inspection_type: form.inspection_type,
        status: form.status,
        inspection_date: form.inspection_date || null,
        performed_by_org: form.performed_by_org || null,
        performed_by_internal: form.performed_by_internal || null,
        notes: form.notes || null,
      });
      setForm({ ...BLANK_FORM });
      setShowForm(false);
      load();
    } catch {
      alert('Failed to create inspection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="space-y-5">
        {/* KPI strip — computed counts and percentages, capped at 100% */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 col-span-1">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total</p>
              <p className="text-2xl font-bold text-charcoal">{summary.total}</p>
            </div>
            <KpiBlock label="Open"      count={summary.open}      pct={summary.pct_open}      color="border-blue-200 bg-blue-50 text-blue-800" />
            <KpiBlock label="Scheduled" count={summary.scheduled} pct={summary.pct_scheduled} color="border-purple-200 bg-purple-50 text-purple-800" />
            <KpiBlock label="Passed"    count={summary.passed}    pct={summary.pct_passed}    color="border-green-200 bg-green-50 text-green-800" />
            <KpiBlock label="Failed"    count={summary.failed}    pct={summary.pct_failed}    color="border-red-200 bg-red-50 text-red-800" />
          </div>
        )}

        {/* Filter bar + New button */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="scheduled">Scheduled</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">All Types</option>
            {allTypes.map((t) => (
              <option key={t} value={t}>{typeLabel(t)}</option>
            ))}
          </select>
          {canWrite && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary-light"
            >
              <Plus className="h-4 w-4" /> New Inspection
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && canWrite && (
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
            <form onSubmit={handleCreate} className="space-y-3">
              <p className="text-sm font-medium text-charcoal">New Inspection</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="col-span-1 sm:col-span-2 lg:col-span-3">
                  <label className="text-xs text-gray-500 mb-1 block">Title</label>
                  <input required placeholder="e.g. BLDG-2 Plumbing Top Out Inspection"
                    value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
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
                  <label className="text-xs text-gray-500 mb-1 block">Type</label>
                  <select value={form.inspection_type} onChange={(e) => setForm({ ...form, inspection_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    {allTypes.map((t) => (
                      <option key={t} value={t}>{typeLabel(t)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                    <option value="open">Open</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="passed">Passed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Inspection Date</label>
                  <input type="date" value={form.inspection_date}
                    onChange={(e) => setForm({ ...form, inspection_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="text-xs text-gray-500 mb-1 block">External Inspector / Org</label>
                  <input placeholder="e.g. ECS Southwest, LLP - Stephen Mereby"
                    value={form.performed_by_org} onChange={(e) => setForm({ ...form, performed_by_org: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Internal Coordinator</label>
                  <input placeholder="Internal team member"
                    value={form.performed_by_internal} onChange={(e) => setForm({ ...form, performed_by_internal: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div className="col-span-1 sm:col-span-3">
                  <label className="text-xs text-gray-500 mb-1 block">Notes</label>
                  <textarea rows={2} placeholder="Inspection notes…" value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-light disabled:opacity-50">
                  {saving ? 'Creating…' : 'Create Inspection'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setForm({ ...BLANK_FORM }); }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        )}
        {error && <p className="text-red-500 text-sm py-4">{error}</p>}
        {!loading && !error && groups.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <ClipboardCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No inspections yet.</p>
          </div>
        )}

        {/* Grouped list */}
        {!loading && !error && groups.length > 0 && (
          <div className="space-y-3">
            {groups.map((group) => (
              <GroupSection key={group.linked_sov_id ?? '__none__'} group={group} />
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
