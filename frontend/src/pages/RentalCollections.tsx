import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

interface InvoiceRow extends Record<string, unknown> {
  id: string;
  unit_number: string | null;
  company_name: string | null;
  billing_period: string;
  amount_billed: number;
  amount_collected: number;
}

interface CompanyOption {
  id: string;
  company_name: string;
}

interface ArrearsAging {
  '0_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
}

interface CollectionsResponse {
  kpis: { total_billed: number; total_collected: number; collection_rate: number; total_arrears: number };
  items: InvoiceRow[];
  arrears_aging: ArrearsAging;
  month: string;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export default function RentalCollections() {
  const [data, setData] = useState<CollectionsResponse | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterMonth, setFilterMonth] = useState(currentMonth());
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { month: filterMonth };
      if (filterCompany) params.company_id = filterCompany;
      const res = await api.get<CollectionsResponse>('/api/rentals/collections', { params });
      setData(res.data);
    } catch {
      setError('Failed to load collections.');
    } finally {
      setLoading(false);
    }
  }, [filterCompany, filterMonth]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const agingData = data ? [
    { bucket: '0–30d',  amount: data.arrears_aging['0_30'] },
    { bucket: '31–60d', amount: data.arrears_aging['31_60'] },
    { bucket: '61–90d', amount: data.arrears_aging['61_90'] },
    { bucket: '90+d',   amount: data.arrears_aging['90_plus'] },
  ] : [];

  const shortfall = data ? data.kpis.total_billed - data.kpis.total_collected : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Collections</h1>

      <div className="flex flex-wrap gap-3 items-center">
        {/* Month picker */}
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 font-medium">Month</label>
          <input
            type="month"
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={filterCompany}
          onChange={(e) => setFilterCompany(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        {filterMonth !== currentMonth() && (
          <button
            onClick={() => setFilterMonth(currentMonth())}
            className="text-xs text-primary underline"
          >
            Back to current month
          </button>
        )}
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : error ? (
        <p className="text-red-600">{error}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Total Billed" value={fmtUSD(data.kpis.total_billed)} sub={filterMonth} />
            <KpiCard label="Total Collected" value={fmtUSD(data.kpis.total_collected)} accent sub={`of ${fmtUSD(data.kpis.total_billed)} billed`} />
            <KpiCard label="Collection Rate" value={fmtPct(data.kpis.collection_rate)} sub={shortfall > 0 ? `${fmtUSD(shortfall)} uncollected` : 'Fully collected'} />
            <KpiCard label="Total Arrears" value={fmtUSD(data.kpis.total_arrears)} />
          </div>

          <Card title={`Invoice Collections — ${filterMonth}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 px-2 font-medium">Unit</th>
                    <th className="py-2 px-2 font-medium">Company</th>
                    <th className="py-2 px-2 font-medium">Billing Month</th>
                    <th className="py-2 px-2 font-medium">Billed</th>
                    <th className="py-2 px-2 font-medium">Collected</th>
                    <th className="py-2 px-2 font-medium">Balance</th>
                    <th className="py-2 px-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 ? (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-400">No invoices for {filterMonth}</td></tr>
                  ) : data.items.map((r) => {
                    const bal = r.amount_billed - r.amount_collected;
                    const st = bal <= 0 ? 'paid' : r.amount_collected > 0 ? 'partial' : 'unpaid';
                    const stClass = bal <= 0 ? 'bg-green-100 text-green-800' : r.amount_collected > 0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800';
                    return (
                      <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${bal > 0 ? 'bg-amber-50/40' : ''}`}>
                        <td className="py-2 px-2 font-mono">{r.unit_number || '—'}</td>
                        <td className="py-2 px-2">{r.company_name || '—'}</td>
                        <td className="py-2 px-2">{r.billing_period}</td>
                        <td className="py-2 px-2">{fmtUSD(r.amount_billed)}</td>
                        <td className="py-2 px-2">{fmtUSD(r.amount_collected)}</td>
                        <td className="py-2 px-2">{bal > 0 ? <span className="text-red-600 font-medium">{fmtUSD(bal)}</span> : '—'}</td>
                        <td className="py-2 px-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stClass}`}>{st}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Arrears Aging Breakdown">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={agingData}>
                <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} />
                <Bar dataKey="amount" fill="#ef4444" name="Arrears" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </>
      ) : null}
    </div>
  );
}
