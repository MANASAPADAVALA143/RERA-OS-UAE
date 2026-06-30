import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';

interface ExpenseRow extends Record<string, unknown> {
  id: string;
  expense_date: string;
  company_name: string | null;
  property_name: string | null;
  category: string;
  amount: number;
  description: string | null;
}

interface CategoryAmount {
  category: string;
  amount: number;
}

interface ExpenseResponse {
  kpis: { total_this_month: number; total_all_time: number; most_expensive_category: string | null };
  items: ExpenseRow[];
  by_category: CategoryAmount[];
}

interface CompanyOption {
  id: string;
  company_name: string;
}

const CAT_PILL: Record<string, string> = {
  management:  'bg-blue-100 text-blue-800',
  maintenance: 'bg-amber-100 text-amber-800',
  utilities:   'bg-cyan-100 text-cyan-800',
  cam:         'bg-purple-100 text-purple-800',
  repairs:     'bg-orange-100 text-orange-800',
  tax:         'bg-red-100 text-red-800',
  insurance:   'bg-green-100 text-green-800',
  other:       'bg-gray-100 text-gray-800',
};

const CAT_COLORS = ['#1E3A8A', '#3B82F6', '#4BA892', '#1D4ED8', '#6ECABB', '#8FD5C4', '#ef4444', '#f97316'];

export default function RentalExpenses() {
  const [data, setData] = useState<ExpenseResponse | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
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
      const params: Record<string, string> = {};
      if (filterCompany) params.company_id = filterCompany;
      if (filterCategory) params.category = filterCategory;
      const res = await api.get<ExpenseResponse>('/api/rentals/expenses', { params });
      setData(res.data);
    } catch {
      setError('Failed to load expenses.');
    } finally {
      setLoading(false);
    }
  }, [filterCompany, filterCategory]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Expenses</h1>

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
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Categories</option>
          {Object.keys(CAT_PILL).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {loading ? <LoadingSkeleton rows={8} /> : error ? (
        <p className="text-red-600">{error}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-3 gap-4">
            <KpiCard label="This Month" value={fmtUSD(data.kpis.total_this_month)} accent />
            <KpiCard label="All Time" value={fmtUSD(data.kpis.total_all_time)} />
            <KpiCard label="Top Category" value={data.kpis.most_expensive_category ?? '—'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Expenses">
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 px-2 font-medium">Date</th>
                      <th className="py-2 px-2 font-medium">Company</th>
                      <th className="py-2 px-2 font-medium">Category</th>
                      <th className="py-2 px-2 font-medium">Amount</th>
                      <th className="py-2 px-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="py-2 px-2">{r.expense_date}</td>
                        <td className="py-2 px-2">{r.company_name || '—'}</td>
                        <td className="py-2 px-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CAT_PILL[r.category] ?? 'bg-gray-100 text-gray-800'}`}>
                            {r.category}
                          </span>
                        </td>
                        <td className="py-2 px-2 font-medium">{fmtUSD(r.amount)}</td>
                        <td className="py-2 px-2 text-gray-500">{r.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="By Category">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.by_category} layout="vertical">
                  <XAxis type="number" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="category" width={80} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => fmtUSD(v)} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {data.by_category.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
