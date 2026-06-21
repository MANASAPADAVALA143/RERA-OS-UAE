import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface PortfolioSummary {
  total_properties: number;
  total_units: number;
  portfolio_occupancy_pct: number | null;
  total_noi: number;
  portfolio_weighted_cap_rate: number | null;
  portfolio_weighted_dscr: number | null;
  properties_below_dscr_covenant: { property_id: string; property_name: string; dscr: number | null }[];
  by_property: PropertyRow[];
}

interface PropertyRow extends Record<string, unknown> {
  property_id: string;
  property_code?: string;
  property_name: string;
  asset_class: string;
  occupancy_pct: number | null;
  noi: number | null;
  dscr: number | null;
  dscr_status: string | null;
  cash_flow_after_debt_service: number | null;
}

export default function Reit() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<PortfolioSummary>('/api/reit/portfolio-summary');
      setSummary(data);
    } catch {
      setError('Failed to load REIT portfolio data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const columns: Column<PropertyRow>[] = [
    { key: 'property_name', label: 'Property', sortValue: (r) => r.property_name },
    { key: 'asset_class', label: 'Class', render: (r) => (r.asset_class || '').replace(/_/g, ' ') },
    { key: 'occupancy_pct', label: 'Occupancy', render: (r) => (r.occupancy_pct != null ? fmtPct(r.occupancy_pct) : '—'), sortValue: (r) => safe(r.occupancy_pct) },
    { key: 'noi', label: 'NOI (mo)', render: (r) => (r.noi != null ? fmtUSD(r.noi) : '—'), sortValue: (r) => safe(r.noi) },
    {
      key: 'dscr',
      label: 'DSCR',
      render: (r) => (
        <span className="flex items-center gap-2">
          {r.dscr != null ? `${safe(r.dscr).toFixed(2)}x` : '—'}
          {r.dscr_status === 'below_covenant' && <StatusPill status="danger" />}
          {r.dscr_status === 'healthy' && <StatusPill status="healthy" />}
        </span>
      ),
      sortValue: (r) => safe(r.dscr),
    },
    { key: 'cash_flow_after_debt_service', label: 'CFADS', render: (r) => (r.cash_flow_after_debt_service != null ? fmtUSD(r.cash_flow_after_debt_service) : '—'), sortValue: (r) => safe(r.cash_flow_after_debt_service) },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-charcoal">REIT Portfolio</h1>
        <LoadingSkeleton rows={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-charcoal">REIT Portfolio</h1>
        <p className="text-red-600">{error}</p>
        <button type="button" onClick={fetchData} className="px-4 py-2 bg-primary text-white rounded-lg text-sm">Retry</button>
      </div>
    );
  }

  const covenantAlerts = summary?.properties_below_dscr_covenant || [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">REIT Portfolio</h1>

      {covenantAlerts.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="text-red-600 shrink-0" size={20} />
          <div>
            <p className="font-medium text-red-800">
              {covenantAlerts.length} propert{covenantAlerts.length === 1 ? 'y' : 'ies'} below DSCR covenant (1.20x)
            </p>
            <ul className="text-sm text-red-700 mt-1 list-disc list-inside">
              {covenantAlerts.map((a) => (
                <li key={a.property_id}>
                  {a.property_name}
                  {a.dscr != null ? ` — DSCR ${a.dscr.toFixed(2)}x` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Total Properties" value={String(summary?.total_properties ?? 0)} accent />
        <KpiCard label="Portfolio Occupancy" value={summary?.portfolio_occupancy_pct != null ? fmtPct(summary.portfolio_occupancy_pct) : '—'} />
        <KpiCard label="Total NOI (Monthly)" value={fmtUSD(summary?.total_noi)} />
        <KpiCard
          label="Weighted Cap Rate"
          value={summary?.portfolio_weighted_cap_rate != null ? fmtPct(summary.portfolio_weighted_cap_rate) : '—'}
          sub="Value-weighted"
        />
        <KpiCard
          label="Weighted DSCR"
          value={summary?.portfolio_weighted_dscr != null ? `${summary.portfolio_weighted_dscr.toFixed(2)}x` : '—'}
          sub="Debt-service-weighted"
        />
      </div>

      <ErrorBoundary>
        <Card title="Properties">
          <Table
            columns={columns}
            data={summary?.by_property || []}
            emptyMessage="No REIT properties — seed RP001 to get started"
            onRowClick={(row) => navigate(`/reit/${row.property_id}`)}
          />
        </Card>
      </ErrorBoundary>
    </div>
  );
}
