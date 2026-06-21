import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

const CHART_COLORS = ['#0E3B36', '#2F8F7A', '#4BA892', '#1A5249'];

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface Alert {
  severity: string;
  type: string;
  message: string;
  route: string;
}

interface ExecutiveData {
  as_of: string;
  financial_health: {
    consolidated_revenue: number;
    consolidated_operating_profit: number;
    capital_available_now: number;
    group_roce_pct: number;
  };
  segment_scale: {
    construction_order_book: number;
    development_units_unsold: number;
    reit_nav: number;
    reit_distribution_yield: number;
    rental_collection_efficiency: number;
  };
  revenue_mix: Record<string, number>;
  alerts: Alert[];
  pipeline_snapshot: {
    by_status: Record<string, number>;
    irr_weighted_pipeline_value: number;
  };
  portfolio_roi: {
    configured_project_count: number;
    unconfigured_project_count: number;
    portfolio_weighted_roi: number | null;
    portfolio_weighted_moic: number | null;
    total_equity_invested: number;
    total_net_profit: number;
    by_project: {
      project_id: string;
      project_code: string | null;
      project_name: string;
      equity_invested: number;
      roi: number | null;
      moic: number | null;
      net_profit: number | null;
    }[];
  };
}

interface Briefing {
  briefing_text: string;
  generated_at: string;
  fallback_used: boolean;
}

export default function ExecutiveSummary() {
  const [data, setData] = useState<ExecutiveData | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [error, setError] = useState('');
  const [dismissUnconfiguredNote, setDismissUnconfiguredNote] = useState(
    () => sessionStorage.getItem('estatecfo-dismiss-unconfigured-roi') === '1',
  );

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await api.get<ExecutiveData>('/api/real-estate/executive-summary');
      setData(res);
    } catch {
      setError('Failed to load executive summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const { data: res } = await api.post<Briefing>('/api/real-estate/ai/morning-briefing');
      setBriefing(res);
    } catch {
      setBriefing({ briefing_text: 'Unable to generate briefing.', generated_at: new Date().toISOString(), fallback_used: true });
    } finally {
      setBriefingLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchBriefing();
  }, [fetchSummary, fetchBriefing]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-charcoal">Executive Summary</h1>
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-charcoal">Executive Summary</h1>
        <p className="text-red-600">{error || 'No data available.'}</p>
        <button onClick={fetchSummary} className="px-4 py-2 bg-primary text-white rounded-lg text-sm">Retry</button>
      </div>
    );
  }

  const fh = data.financial_health;
  const seg = data.segment_scale;
  const revenueChart = Object.entries(data.revenue_mix || {}).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: safe(value),
  }));
  const pipelineChart = Object.entries(data.pipeline_snapshot?.by_status || {}).map(([status, count]) => ({
    status: status.replace(/_/g, ' '),
    count: safe(count),
  }));

  const portfolioRoi = data.portfolio_roi;
  const totalProjects = portfolioRoi
    ? portfolioRoi.configured_project_count + portfolioRoi.unconfigured_project_count
    : 0;
  const roiCaption = totalProjects
    ? `${portfolioRoi?.configured_project_count ?? 0} of ${totalProjects} projects`
    : undefined;

  const dismissNote = () => {
    sessionStorage.setItem('estatecfo-dismiss-unconfigured-roi', '1');
    setDismissUnconfiguredNote(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Executive Summary</h1>
          <p className="text-sm text-gray-500">As of {data.as_of}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Consolidated Revenue" value={fmtUSD(fh.consolidated_revenue)} accent />
        <KpiCard label="Operating Profit" value={fmtUSD(fh.consolidated_operating_profit)} />
        <KpiCard label="Capital Available" value={fmtUSD(fh.capital_available_now)} />
        <KpiCard label="Group ROCE" value={`${safe(fh.group_roce_pct).toFixed(1)}%`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Order Book" value={fmtUSD(seg.construction_order_book)} sub="Construction" />
        <KpiCard label="Unsold Units" value={String(safe(seg.development_units_unsold))} sub="Development" />
        <KpiCard label="REIT NAV" value={fmtUSD(seg.reit_nav)} sub={`Yield ${fmtPct(seg.reit_distribution_yield)}`} />
        <KpiCard label="Rental Collection" value={fmtPct(seg.rental_collection_efficiency)} sub="Portfolio avg" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Portfolio ROI (Equity-Weighted)"
          value={
            portfolioRoi?.portfolio_weighted_roi != null
              ? fmtPct(portfolioRoi.portfolio_weighted_roi)
              : 'Not yet configured'
          }
          accent={portfolioRoi?.portfolio_weighted_roi != null}
          sub={roiCaption}
        />
        <KpiCard
          label="Portfolio MOIC (Equity-Weighted)"
          value={
            portfolioRoi?.portfolio_weighted_moic != null
              ? `${portfolioRoi.portfolio_weighted_moic.toFixed(2)}x`
              : 'Not yet configured'
          }
          sub={portfolioRoi?.portfolio_weighted_moic != null ? roiCaption : undefined}
        />
        {portfolioRoi?.portfolio_weighted_roi != null && (
          <>
            <KpiCard label="Total Equity Invested" value={fmtUSD(portfolioRoi.total_equity_invested)} sub="Configured projects" />
            <KpiCard label="Total Net Profit (Underwritten)" value={fmtUSD(portfolioRoi.total_net_profit)} sub="Forward-sale model" />
          </>
        )}
      </div>

      <ErrorBoundary>
        <Card title="Morning Briefing">
          <div className="flex items-start gap-3">
            <Sparkles className="text-accent shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              {briefingLoading ? (
                <LoadingSkeleton rows={2} />
              ) : (
                <>
                  <p className="text-charcoal leading-relaxed">{briefing?.briefing_text || 'No briefing available.'}</p>
                  {briefing?.fallback_used && (
                    <p className="text-xs text-gray-400 mt-2">Rule-based summary (AI narrative disabled or unavailable)</p>
                  )}
                  {briefing?.generated_at && (
                    <p className="text-xs text-gray-400 mt-1">Generated {new Date(briefing.generated_at).toLocaleString()}</p>
                  )}
                </>
              )}
            </div>
            <button
              onClick={fetchBriefing}
              disabled={briefingLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent-dark disabled:opacity-50"
            >
              <RefreshCw size={14} className={briefingLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </Card>
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorBoundary>
          <Card title="Alerts">
            {!data.alerts?.length ? (
              <p className="text-gray-400 text-center py-6">No active alerts</p>
            ) : (
              <ul className="space-y-2">
                {data.alerts.map((a, i) => (
                  <li key={i} className={`flex items-start gap-2 p-3 rounded-lg ${a.severity === 'red' ? 'bg-red-50' : 'bg-amber-50'}`}>
                    <AlertTriangle size={16} className={a.severity === 'red' ? 'text-red-600' : 'text-amber-600'} />
                    <div className="flex-1">
                      <p className="text-sm text-charcoal">{a.message}</p>
                      <Link to={a.route} className="text-xs text-accent hover:underline">{a.type.replace(/_/g, ' ')} →</Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </ErrorBoundary>

        <ErrorBoundary>
          <Card title="Pipeline Snapshot">
            <div className="mb-4">
              <p className="text-sm text-gray-500">IRR-Weighted Pipeline Value</p>
              <p className="text-xl font-bold text-primary">{fmtUSD(data.pipeline_snapshot?.irr_weighted_pipeline_value)}</p>
            </div>
            {pipelineChart.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pipelineChart}>
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2F8F7A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-400 text-center py-8">No pipeline parcels</p>
            )}
          </Card>
        </ErrorBoundary>
      </div>

      <ErrorBoundary>
        <Card title="Returns by Project">
          {!portfolioRoi?.configured_project_count ? (
            <p className="text-gray-400 text-center py-6">
              No active projects with ROI assumptions. Configure assumptions under Construction → Financials & ROI.
            </p>
          ) : (
            <>
              {portfolioRoi.unconfigured_project_count > 0 && !dismissUnconfiguredNote && (
                <div className="flex items-start justify-between gap-3 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <p>
                    {portfolioRoi.unconfigured_project_count} project(s) don&apos;t have ROI assumptions entered yet
                    and are excluded from the portfolio figures above.
                  </p>
                  <button onClick={dismissNote} className="text-amber-700 hover:text-amber-900 shrink-0 text-xs underline">
                    Dismiss
                  </button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="py-2 pr-4">Project</th>
                      <th className="py-2 pr-4">Equity Invested</th>
                      <th className="py-2 pr-4">ROI</th>
                      <th className="py-2 pr-4">MOIC</th>
                      <th className="py-2">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioRoi.by_project.map((p) => (
                      <tr key={p.project_id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-2 pr-4">
                          <Link to="/construction" className="text-accent hover:underline">
                            {p.project_code ? `${p.project_code} — ` : ''}{p.project_name}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">{fmtUSD(p.equity_invested)}</td>
                        <td className="py-2 pr-4">{p.roi != null ? fmtPct(p.roi) : '—'}</td>
                        <td className="py-2 pr-4">{p.moic != null ? `${p.moic.toFixed(2)}x` : '—'}</td>
                        <td className="py-2">{p.net_profit != null ? fmtUSD(p.net_profit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Sorted by ROI (highest first). Portfolio KPIs use total profit ÷ total equity — not a simple average of project ROI percentages.
              </p>
            </>
          )}
        </Card>
      </ErrorBoundary>

      <ErrorBoundary>
        <Card title="Revenue Mix">
          {revenueChart.every((d) => d.value === 0) ? (
            <p className="text-gray-400 text-center py-8">No revenue data</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={revenueChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {revenueChart.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtUSD(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={revenueChart} layout="vertical">
                  <XAxis type="number" tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} />
                  <Bar dataKey="value" fill="#0E3B36" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </ErrorBoundary>
    </div>
  );
}
