import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';

interface VacantUnit extends Record<string, unknown> {
  id: string;
  unit_number: string;
  company_name: string | null;
  property_name: string | null;
  days_vacant: number | null;
  monthly_rent: number;
  status_changed_at: string | null;
}

export default function RentalVacancy() {
  const [units, setUnits] = useState<VacantUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<VacantUnit[]>('/api/rentals/units', { params: { status: 'vacant' } });
      setUnits(res.data);
    } catch {
      setError('Failed to load vacant units.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const totalVacancyLoss = units.reduce((s, u) => s + u.monthly_rent, 0);
  const avgDaysVacant = units.length > 0
    ? units.reduce((s, u) => s + (u.days_vacant ?? 0), 0) / units.length
    : 0;

  // Vacancy loss by company
  const byCompany: Record<string, number> = {};
  units.forEach(u => {
    const k = u.company_name ?? 'Unknown';
    byCompany[k] = (byCompany[k] ?? 0) + u.monthly_rent;
  });
  const chartData = Object.entries(byCompany).map(([name, loss]) => ({ name: name.length > 14 ? name.slice(0, 12) + '…' : name, loss }));

  const columns: Column<VacantUnit>[] = [
    { key: 'unit_number', label: 'Unit', sortValue: (r) => r.unit_number },
    { key: 'company_name', label: 'Company', sortValue: (r) => r.company_name ?? '' },
    { key: 'property_name', label: 'Property', sortValue: (r) => r.property_name ?? '' },
    { key: 'days_vacant', label: 'Days Vacant', render: (r) => r.days_vacant != null ? `${r.days_vacant}d` : '—', sortValue: (r) => r.days_vacant ?? 0 },
    { key: 'monthly_rent', label: 'Rent Lost/Month', render: (r) => fmtUSD(r.monthly_rent), sortValue: (r) => r.monthly_rent },
    { key: 'status_changed_at', label: 'Vacant Since', sortValue: (r) => r.status_changed_at ?? '' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Vacancy & Loss</h1>

      {loading ? <LoadingSkeleton rows={6} /> : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <KpiCard label="Total Vacant Units" value={String(units.length)} />
            <KpiCard label="Monthly Vacancy Loss" value={fmtUSD(totalVacancyLoss)} accent />
            <KpiCard label="Avg Days Vacant" value={avgDaysVacant > 0 ? `${avgDaysVacant.toFixed(0)}d` : '—'} />
          </div>

          <Card title="Vacant Units">
            <Table columns={columns} data={units} emptyMessage="No vacant units" defaultSortKey="days_vacant" defaultSortDir="desc" />
          </Card>

          {chartData.length > 0 && (
            <Card title="Vacancy Loss by Company">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} />
                  <Bar dataKey="loss" fill="#1E3A8A" name="Vacancy Loss" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
