import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface Project {
  id: string;
  project_name: string;
  status: string;
  total_units: number | null;
}

interface Unit extends Record<string, unknown> {
  id: string;
  unit_number: string;
  unit_type: string;
  sqft: number | null;
  status: string;
  list_price: number;
  achieved_sale_price: number | null;
  days_on_market: number | null;
  margin_pct: number;
  margin_amount: number;
  total_allocated_cost: number;
}

interface ProjectDetail {
  unit_summary: Record<string, number>;
  total_units: number | null;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildSalesVelocity(units: Unit[]) {
  const now = new Date();
  const months: { month: string; sold: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, sold: 0 });
  }
  units.filter((u) => u.status === 'closed').forEach((u, idx) => {
    const dom = safe(u.days_on_market);
    const bucket = Math.min(5, Math.floor(dom / 30));
    const targetIdx = 5 - bucket;
    if (targetIdx >= 0 && targetIdx < months.length) months[targetIdx].sold += 1;
    else months[months.length - 1 - (idx % 6)].sold += 1;
  });
  return months;
}

function buildAgingBuckets(units: Unit[]) {
  const buckets = [
    { range: '0–30 days', count: 0 },
    { range: '31–60 days', count: 0 },
    { range: '61–90 days', count: 0 },
    { range: '90+ days', count: 0 },
  ];
  units
    .filter((u) => ['available', 'reserved', 'under_contract'].includes(u.status))
    .forEach((u) => {
      const dom = safe(u.days_on_market);
      if (dom <= 30) buckets[0].count += 1;
      else if (dom <= 60) buckets[1].count += 1;
      else if (dom <= 90) buckets[2].count += 1;
      else buckets[3].count += 1;
    });
  return buckets;
}

export default function Development() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    const { data } = await api.get<Project[]>('/api/real-estate/projects', {
      params: { status: 'selling' },
    });
    const list = data.length ? data : (await api.get<Project[]>('/api/real-estate/projects')).data;
    setProjects(list);
    if (list.length && !projectId) setProjectId(list[0].id);
  }, [projectId]);

  const fetchUnits = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    try {
      const [unitsRes, detailRes] = await Promise.all([
        api.get<Unit[]>(`/api/real-estate/projects/${pid}/units`),
        api.get<ProjectDetail>(`/api/real-estate/projects/${pid}`),
      ]);
      setUnits(unitsRes.data);
      setDetail(detailRes.data);
    } catch {
      setUnits([]);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);
  useEffect(() => { if (projectId) fetchUnits(projectId); }, [projectId, fetchUnits]);

  const salesVelocity = useMemo(() => buildSalesVelocity(units), [units]);
  const agingBuckets = useMemo(() => buildAgingBuckets(units), [units]);

  const closedCount = units.filter((u) => u.status === 'closed').length;
  const availableCount = units.filter((u) => u.status === 'available').length;
  const avgMargin = units.length
    ? units.reduce((s, u) => s + safe(u.margin_pct), 0) / units.length
    : 0;
  const totalRevenue = units
    .filter((u) => u.status === 'closed')
    .reduce((s, u) => s + safe(u.achieved_sale_price), 0);

  const unitColumns: Column<Unit>[] = [
    { key: 'unit_number', label: 'Unit', sortValue: (r) => r.unit_number },
    { key: 'unit_type', label: 'Type', render: (r) => r.unit_type.replace(/_/g, ' ') },
    { key: 'sqft', label: 'Sq Ft', render: (r) => (r.sqft ? r.sqft.toLocaleString() : '—'), sortValue: (r) => safe(r.sqft) },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'list_price', label: 'List Price', render: (r) => fmtUSD(r.list_price), sortValue: (r) => safe(r.list_price) },
    { key: 'achieved_sale_price', label: 'Sale Price', render: (r) => fmtUSD(r.achieved_sale_price), sortValue: (r) => safe(r.achieved_sale_price) },
    { key: 'margin_pct', label: 'Margin', render: (r) => fmtPct(r.margin_pct), sortValue: (r) => safe(r.margin_pct) },
    { key: 'days_on_market', label: 'DOM', render: (r) => (r.days_on_market ?? '—'), sortValue: (r) => safe(r.days_on_market) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-charcoal">Development</h1>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-accent"
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.project_name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Total Units" value={String(safe(detail?.total_units ?? units.length))} />
            <KpiCard label="Closed" value={String(closedCount)} sub={`${availableCount} available`} />
            <KpiCard label="Avg Margin" value={fmtPct(avgMargin)} />
            <KpiCard label="Revenue (Closed)" value={fmtUSD(totalRevenue)} accent />
          </div>

          {detail?.unit_summary && Object.keys(detail.unit_summary).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(detail.unit_summary).map(([status, count]) => (
                <span key={status} className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 rounded-full text-sm">
                  <StatusPill status={status} />
                  <span className="font-medium">{count}</span>
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ErrorBoundary>
              <Card title="Sales Velocity (6 mo)">
                {salesVelocity.every((m) => m.sold === 0) ? (
                  <p className="text-gray-400 text-center py-8">No closed sales yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={salesVelocity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="sold" stroke="#3B82F6" strokeWidth={2} dot={{ fill: '#1E3A8A' }} name="Units Sold" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </ErrorBoundary>

            <ErrorBoundary>
              <Card title="Inventory Aging">
                {agingBuckets.every((b) => b.count === 0) ? (
                  <p className="text-gray-400 text-center py-8">No unsold inventory</p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={agingBuckets}>
                      <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1E3A8A" name="Units" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </ErrorBoundary>
          </div>

          <ErrorBoundary>
            <Card title="Unit Inventory">
              <Table columns={unitColumns} data={units} emptyMessage="No units for this project" />
            </Card>
          </ErrorBoundary>
        </>
      )}
    </div>
  );
}
