import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import { occupancyStats } from '../utils/occupancyStats';

interface UnitRow extends Record<string, unknown> {
  id: string;
  unit_number: string;
  company_id: string;
  company_name: string | null;
  property_name: string | null;
  status: string;
  monthly_rent: number;
  tenant_name: string | null;
  lease_end: string | null;
  arrears: number;
  days_vacant: number | null;
}

interface CompanyOption {
  id: string;
  company_name: string;
}

const STATUS_PILL: Record<string, string> = {
  occupied: 'bg-green-100 text-green-800',
  vacant: 'bg-red-100 text-red-800',
  notice: 'bg-amber-100 text-amber-800',
  reserved: 'bg-blue-100 text-blue-800',
  maintenance_hold: 'bg-gray-100 text-gray-800',
};

export default function RentalUnits() {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filterCompany) params.company_id = filterCompany;
      if (filterStatus) params.status = filterStatus;
      const res = await api.get<UnitRow[]>('/api/rentals/units', { params });
      setUnits(res.data);
    } catch {
      setError('Failed to load units.');
    } finally {
      setLoading(false);
    }
  }, [filterCompany, filterStatus]);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await api.get<CompanyOption[]>('/api/rentals/companies');
      setCompanies(res.data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { fetchUnits(); }, [fetchUnits]);

  const { occupied: occupiedCount, vacant: vacantCount } = useMemo(
    () => occupancyStats(units),
    [units],
  );
  const totalArrears = useMemo(() => units.reduce((s, u) => s + (u.arrears ?? 0), 0), [units]);

  const columns: Column<UnitRow>[] = [
    { key: 'unit_number', label: 'Unit No.', sortValue: (r) => r.unit_number },
    { key: 'company_name', label: 'Company', sortValue: (r) => r.company_name ?? '' },
    { key: 'property_name', label: 'Property', sortValue: (r) => r.property_name ?? '' },
    {
      key: 'status', label: 'Status',
      render: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[r.status] ?? 'bg-gray-100 text-gray-800'}`}>
          {r.status}
        </span>
      ),
      sortValue: (r) => r.status,
    },
    {
      key: 'tenant_name', label: 'Tenant',
      render: (r) => r.status === 'vacant' && r.days_vacant != null
        ? <span className="text-gray-400 text-xs">— ({r.days_vacant}d vacant)</span>
        : (r.tenant_name ?? '—'),
      sortValue: (r) => r.tenant_name ?? '',
    },
    { key: 'lease_end', label: 'Lease End', sortValue: (r) => r.lease_end ?? '' },
    { key: 'monthly_rent', label: 'Monthly Rent', render: (r) => fmtUSD(r.monthly_rent), sortValue: (r) => r.monthly_rent },
    {
      key: 'arrears', label: 'Arrears',
      render: (r) => r.arrears > 0 ? <span className="text-red-600 font-medium">{fmtUSD(r.arrears)}</span> : '—',
      sortValue: (r) => r.arrears,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Units</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterCompany}
          onChange={(e) => setFilterCompany(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Statuses</option>
          <option value="occupied">Occupied</option>
          <option value="vacant">Vacant</option>
          <option value="notice">Notice</option>
          <option value="reserved">Reserved</option>
          <option value="maintenance_hold">Maintenance Hold</option>
        </select>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Showing Units" value={String(units.length)} />
        <KpiCard label="Occupied" value={String(occupiedCount)} />
        <KpiCard label="Vacant" value={String(vacantCount)} />
        <KpiCard label="Total Arrears" value={fmtUSD(totalArrears)} />
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <Card title="Units">
          <Table columns={columns} data={units} emptyMessage="No units found" defaultSortKey="unit_number" />
        </Card>
      )}
    </div>
  );
}
