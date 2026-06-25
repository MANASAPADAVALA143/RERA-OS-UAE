import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { LoadingSkeleton, type Column } from '../components/ui/Table';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

interface LeaseRow extends Record<string, unknown> {
  id: string;
  unit_number: string | null;
  company_id: string | null;
  company_name: string | null;
  tenant_name: string | null;
  lease_start: string | null;
  lease_end: string | null;
  days_until_expiry: number | null;
  status: string;
  deposit_amount: number | null;
  escalation_pct_annual: number | null;
}

interface CompanyOption {
  id: string;
  company_name: string;
}

interface LeasesResponse {
  leases: LeaseRow[];
  expiry_pipeline: { days_30: number; days_60: number; days_90: number };
}

const STATUS_PILL: Record<string, string> = {
  active:       'bg-green-100 text-green-800',
  notice_given: 'bg-amber-100 text-amber-800',
  expired:      'bg-gray-100 text-gray-800',
  renewed:      'bg-blue-100 text-blue-800',
};

export default function RentalLeases() {
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [pipeline, setPipeline] = useState({ days_30: 0, days_60: 0, days_90: 0 });
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await api.get<CompanyOption[]>('/api/rentals/companies');
      setCompanies(res.data);
    } catch {
      // ignore
    }
  }, []);

  const fetchLeases = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (filterCompany) params.company_id = filterCompany;
      const res = await api.get<LeasesResponse>('/api/rentals/leases', { params });
      const data = res.data;
      if (Array.isArray(data)) {
        // backend returns [] when company filter yields no units
        setLeases([]);
      } else {
        setLeases(data?.leases ?? []);
        if (data?.expiry_pipeline) setPipeline(data.expiry_pipeline);
      }
    } catch {
      setError('Failed to load leases.');
    } finally {
      setLoading(false);
    }
  }, [filterCompany]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { fetchLeases(); }, [fetchLeases]);

  const columns: Column<LeaseRow>[] = [
    { key: 'unit_number',  label: 'Unit',    sortValue: (r) => r.unit_number ?? '' },
    { key: 'company_name', label: 'Company', sortValue: (r) => r.company_name ?? '' },
    { key: 'tenant_name',  label: 'Tenant',  sortValue: (r) => r.tenant_name ?? '' },
    { key: 'lease_start',  label: 'Start',   sortValue: (r) => r.lease_start ?? '' },
    { key: 'lease_end',    label: 'End',     sortValue: (r) => r.lease_end ?? '' },
    {
      key: 'days_until_expiry', label: 'Days Left',
      render: (r) => {
        const d = r.days_until_expiry;
        if (d == null) return '—';
        return (
          <span className={d <= 30 ? 'text-red-600 font-medium' : d <= 60 ? 'text-amber-600 font-medium' : ''}>
            {d}d
          </span>
        );
      },
      sortValue: (r) => r.days_until_expiry ?? 9999,
    },
    {
      key: 'status', label: 'Status',
      render: (r) => (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[r.status] ?? 'bg-gray-100 text-gray-800'}`}>
          {r.status.replace(/_/g, ' ')}
        </span>
      ),
      sortValue: (r) => r.status,
    },
    {
      key: 'deposit_amount', label: 'Deposit',
      render: (r) => r.deposit_amount != null ? fmtUSD(r.deposit_amount) : '—',
      sortValue: (r) => r.deposit_amount ?? 0,
    },
    {
      key: 'escalation_pct_annual', label: 'Escalation',
      render: (r) => r.escalation_pct_annual != null ? fmtPct(r.escalation_pct_annual) : '—',
      sortValue: (r) => r.escalation_pct_annual ?? 0,
    },
  ];

  const rowClass = (r: LeaseRow) => {
    const d = r.days_until_expiry;
    if (d != null && d >= 0 && d <= 30) return 'bg-red-50';
    if (d != null && d >= 0 && d <= 60) return 'bg-amber-50';
    return '';
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Leases</h1>

      <div className="flex gap-3">
        <select
          value={filterCompany}
          onChange={(e) => setFilterCompany(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
      </div>

      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <Card title={`Leases (${leases.length})`}>
          {leases.length === 0 ? (
            <p className="text-gray-500 text-sm py-4 text-center">No leases found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    {columns.map(c => <th key={c.key} className="py-2 px-2 font-medium">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {leases.map((r) => (
                    <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50 ${rowClass(r)}`}>
                      {columns.map(c => (
                        <td key={c.key} className="py-2 px-2">
                          {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title="Expiry Pipeline">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-4 bg-red-50 rounded-xl">
            <p className="text-2xl font-bold text-red-700">{pipeline.days_30}</p>
            <p className="text-sm text-red-600">Expiring in 30 days</p>
          </div>
          <div className="p-4 bg-amber-50 rounded-xl">
            <p className="text-2xl font-bold text-amber-700">{pipeline.days_60}</p>
            <p className="text-sm text-amber-600">Expiring in 60 days</p>
          </div>
          <div className="p-4 bg-blue-50 rounded-xl">
            <p className="text-2xl font-bold text-blue-700">{pipeline.days_90}</p>
            <p className="text-sm text-blue-600">Expiring in 90 days</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
