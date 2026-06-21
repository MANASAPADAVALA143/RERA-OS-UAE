import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

const CHART_COLORS = ['#0E3B36', '#2F8F7A', '#4BA892', '#1A5249'];
const safe = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? 0 : n);

interface RentalProperty extends Record<string, unknown> {
  id: string;
  property_name: string;
  city: string;
  state: string;
  property_type: string;
  total_units: number;
  occupied_units: number;
  occupancy_pct: number;
  monthly_rent_billed: number;
  monthly_rent_collected: number;
  avg_dso_days: number;
  pct: number;
}

interface AtRiskProperty {
  id: string;
  property_name: string;
  avg_dso_days: number;
  occupancy_pct: number;
}

export default function Rental() {
  const [properties, setProperties] = useState<RentalProperty[]>([]);
  const [atRisk, setAtRisk] = useState<AtRiskProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [propsRes, atRiskRes] = await Promise.all([
        api.get<RentalProperty[]>('/api/real-estate/rental/properties'),
        api.get<AtRiskProperty[]>('/api/real-estate/rental/at-risk'),
      ]);
      setProperties(propsRes.data);
      setAtRisk(atRiskRes.data);
    } catch {
      setError('Failed to load rental data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const avgCollection = properties.length
    ? properties.reduce((s, p) => s + safe(p.pct), 0) / properties.length
    : 0;
  const totalBilled = properties.reduce((s, p) => s + safe(p.monthly_rent_billed), 0);
  const totalCollected = properties.reduce((s, p) => s + safe(p.monthly_rent_collected), 0);
  const avgOccupancy = properties.length
    ? properties.reduce((s, p) => s + safe(p.occupancy_pct), 0) / properties.length
    : 0;

  const collectionChart = properties.map((p) => ({
    name: p.property_name.length > 16 ? `${p.property_name.slice(0, 14)}…` : p.property_name,
    efficiency: safe(p.pct) * 100,
  }));

  const occupancyChart = properties.map((p) => ({
    name: p.property_name,
    value: safe(p.occupancy_pct) * 100,
  }));

  const propertyColumns: Column<RentalProperty>[] = [
    { key: 'property_name', label: 'Property', sortValue: (r) => r.property_name },
    { key: 'city', label: 'Location', render: (r) => `${r.city}, ${r.state}` },
    { key: 'property_type', label: 'Type', render: (r) => r.property_type.replace(/_/g, ' ') },
    { key: 'total_units', label: 'Units', sortValue: (r) => safe(r.total_units) },
    { key: 'occupancy_pct', label: 'Occupancy', render: (r) => fmtPct(r.occupancy_pct), sortValue: (r) => safe(r.occupancy_pct) },
    { key: 'monthly_rent_billed', label: 'Billed', render: (r) => fmtUSD(r.monthly_rent_billed), sortValue: (r) => safe(r.monthly_rent_billed) },
    { key: 'monthly_rent_collected', label: 'Collected', render: (r) => fmtUSD(r.monthly_rent_collected), sortValue: (r) => safe(r.monthly_rent_collected) },
    { key: 'pct', label: 'Collection Eff.', render: (r) => fmtPct(r.pct), sortValue: (r) => safe(r.pct) },
    { key: 'avg_dso_days', label: 'Avg DSO', render: (r) => `${safe(r.avg_dso_days).toFixed(0)}d`, sortValue: (r) => safe(r.avg_dso_days) },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-charcoal">Rental & Lease</h1>
        <LoadingSkeleton rows={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-charcoal">Rental & Lease</h1>
        <p className="text-red-600">{error}</p>
        <button onClick={fetchData} className="px-4 py-2 bg-primary text-white rounded-lg text-sm">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Rental & Lease</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Properties" value={String(properties.length)} />
        <KpiCard label="Avg Collection" value={fmtPct(avgCollection)} accent />
        <KpiCard label="Avg Occupancy" value={fmtPct(avgOccupancy)} />
        <KpiCard label="Monthly Collected" value={fmtUSD(totalCollected)} sub={`of ${fmtUSD(totalBilled)} billed`} />
      </div>

      {atRisk.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="text-red-600 shrink-0" size={20} />
          <div>
            <p className="font-medium text-red-800">{atRisk.length} propert{atRisk.length === 1 ? 'y' : 'ies'} at risk</p>
            <ul className="text-sm text-red-700 mt-1 list-disc list-inside">
              {atRisk.map((p) => (
                <li key={p.id}>
                  {p.property_name} — DSO {safe(p.avg_dso_days).toFixed(0)}d, occupancy {fmtPct(p.occupancy_pct)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <ErrorBoundary>
        <Card title="Properties">
          <Table columns={propertyColumns} data={properties} emptyMessage="No rental properties" />
        </Card>
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ErrorBoundary>
          <Card title="Collection Efficiency by Property">
            {collectionChart.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No property data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={collectionChart}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Bar dataKey="efficiency" fill="#2F8F7A" name="Collection %" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </ErrorBoundary>

        <ErrorBoundary>
          <Card title="Occupancy Mix">
            {occupancyChart.length === 0 || occupancyChart.every((d) => d.value === 0) ? (
              <p className="text-gray-400 text-center py-8">No occupancy data</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={occupancyChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value.toFixed(0)}%`}>
                    {occupancyChart.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </ErrorBoundary>
      </div>
    </div>
  );
}
