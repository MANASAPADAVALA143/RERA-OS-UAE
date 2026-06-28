import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';
import { useRentalNav } from '../contexts/RentalNavContext';

interface PortfolioSummary {
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_pct: number;
  gross_potential_rent: number;
  billed_this_month: number;
  collected_this_month: number;
  noi_this_month: number;
  arrears_total: number;
  vacancy_loss: number;
  total_expense_this_month: number;
  partner_share_payable: number;
  by_company: CompanySummary[];
  arrears_aging: ArrearsAging;
  income_trend: TrendPoint[];
  lease_expiry_pipeline: LeaseExpiry[];
  attention_now: AttentionItem[];
}

interface CompanySummary {
  company_id: string;
  company_name: string;
  occupancy_pct: number;
  noi_this_month: number;
  occupied_units: number;
  total_units: number;
  collected_this_month: number;
}

interface ArrearsAging {
  '0_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
}

interface TrendPoint {
  month: string;
  billed: number;
  collected: number;
  expense: number;
  noi: number;
}

interface LeaseExpiry {
  lease_end: string;
  days_until_expiry: number;
  unit_number: string | null;
  company_name: string | null;
  tenant_name: string | null;
}

interface AttentionItem {
  type: string;
  message: string;
  severity: 'warning' | 'attention';
}

export default function RentalOverview() {
  const { setTab } = useRentalNav();
  const [data, setData] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<PortfolioSummary>('/api/rentals/portfolio-summary');
      setData(res.data);
    } catch {
      setError('Failed to load portfolio summary.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) return <LoadingSkeleton rows={10} />;
  if (error || !data) return (
    <div className="text-red-600 p-4">{error || 'No data'}<button className="ml-4 underline" onClick={fetch}>Retry</button></div>
  );

  const now = new Date();
  const periodLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  const agingData = [
    { bucket: '0–30d',  amount: data.arrears_aging['0_30'] },
    { bucket: '31–60d', amount: data.arrears_aging['31_60'] },
    { bucket: '61–90d', amount: data.arrears_aging['61_90'] },
    { bucket: '90+d',   amount: data.arrears_aging['90_plus'] },
  ];

  const companyOccupancy = data.by_company.map(c => ({
    name: c.company_name.length > 14 ? c.company_name.slice(0, 12) + '…' : c.company_name,
    occupancy_pct: parseFloat((c.occupancy_pct * 100).toFixed(1)),
  }));

  const companyNOI = data.by_company.map(c => ({
    name: c.company_name.length > 14 ? c.company_name.slice(0, 12) + '…' : c.company_name,
    noi: c.noi_this_month,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-charcoal">Rental Portfolio — Overview</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{periodLabel}</span>
          <button
            onClick={() => setTab('portfolio-upload')}
            className="flex items-center gap-2 text-xs bg-green-700 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 font-medium transition-colors"
          >
            📊 Sync Rent Data
          </button>
        </div>
      </div>

      {/* 8-tile KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <KpiCard label="Occupancy Rate" value={fmtPct(data.occupancy_pct)} sub={`${data.occupied_units} / ${data.total_units} units`} accent />
          <div className="text-[10px] text-amber-600 mt-1 px-1">
            ⚠ Upload Rent Receivable Excel to sync latest data
          </div>
        </div>
        <KpiCard label="Occupied / Vacant" value={`${data.occupied_units} / ${data.vacant_units}`} sub={`${data.total_units} total units`} />
        <KpiCard label="Collected This Month" value={fmtUSD(data.collected_this_month)} sub={`of ${fmtUSD(data.billed_this_month)} billed`} accent />
        <KpiCard label="NOI This Month" value={fmtUSD(data.noi_this_month)} sub={`Expenses: ${fmtUSD(data.total_expense_this_month)}`} />
        <KpiCard label="Gross Potential Rent" value={fmtUSD(data.gross_potential_rent)} />
        <KpiCard label="Vacancy Loss" value={fmtUSD(data.vacancy_loss)} sub={`${data.vacant_units} vacant units`} />
        <KpiCard label="Arrears Outstanding" value={fmtUSD(data.arrears_total)} />
        <KpiCard label="Partner Share Payable" value={fmtUSD(data.partner_share_payable)} />
      </div>

      {/* Attention Now */}
      {data.attention_now.length > 0 && (
        <Card title="Attention Now">
          <div className="space-y-2">
            {data.attention_now.map((item, i) => (
              <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                item.severity === 'warning' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  item.severity === 'warning' ? 'bg-red-200 text-red-900' : 'bg-amber-200 text-amber-900'
                }`}>{item.severity === 'warning' ? 'WARNING' : 'ATTENTION'}</span>
                {item.message}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Charts 2×2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Occupancy by Company">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={companyOccupancy}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Bar dataKey="occupancy_pct" fill="#0E3B36" name="Occupancy %" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Income vs Expense — 6 Months">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.income_trend}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Legend />
              <Line type="monotone" dataKey="collected" stroke="#2F8F7A" name="Collected" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="expense" stroke="#ef4444" name="Expense" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Arrears Aging">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={agingData}>
              <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="amount" fill="#ef4444" name="Arrears" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="NOI by Company">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={companyNOI}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} />
              <Bar dataKey="noi" fill="#2F8F7A" name="NOI" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Lease expiry pipeline */}
      {data.lease_expiry_pipeline.length > 0 && (
        <Card title="Upcoming Lease Expirations (next 90 days)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-2 px-2 font-medium">Unit</th>
                  <th className="py-2 px-2 font-medium">Company</th>
                  <th className="py-2 px-2 font-medium">Tenant</th>
                  <th className="py-2 px-2 font-medium">Lease End</th>
                  <th className="py-2 px-2 font-medium">Days Left</th>
                </tr>
              </thead>
              <tbody>
                {data.lease_expiry_pipeline.map((l, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${l.days_until_expiry <= 30 ? 'bg-red-50' : l.days_until_expiry <= 60 ? 'bg-amber-50' : ''}`}>
                    <td className="py-2 px-2">{l.unit_number || '—'}</td>
                    <td className="py-2 px-2">{l.company_name || '—'}</td>
                    <td className="py-2 px-2">{l.tenant_name || '—'}</td>
                    <td className="py-2 px-2">{l.lease_end}</td>
                    <td className="py-2 px-2 font-medium">{l.days_until_expiry}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
