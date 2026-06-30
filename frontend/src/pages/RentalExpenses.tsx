import { useCallback, useEffect, useState, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { LoadingSkeleton } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import { Plus, Upload } from 'lucide-react';

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

const EXPENSE_CATEGORIES = [
  'repairs', 'utilities', 'management', 'insurance', 'taxes', 'maintenance', 'cam', 'other'
];

const CAT_COLORS: Record<string, string> = {
  repairs: '#3B82F6', utilities: '#8B5CF6', management: '#EC4899',
  insurance: '#F59E0B', taxes: '#10B981', maintenance: '#06B6D4',
  cam: '#F97316', other: '#64748B',
};

const TOOLTIP_STYLE = { contentStyle: { background: '#1E2A4A', border: '1px solid #2A3158', borderRadius: '0.5rem' } };

export default function RentalExpenses() {
  const [data, setData] = useState<ExpenseResponse | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ company_id: '', property_id: '', category: '', amount: '', date: '', description: '' });

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
      const res = await api.get<ExpenseResponse>('/api/rentals/expenses-summary', { params });
      setData(res.data);
    } catch {
      setError('Failed to load expenses. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [filterCompany]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_id || !formData.amount || !formData.date || !formData.category) return;
    try {
      await api.post('/api/rentals/expenses', {
        company_id: formData.company_id,
        property_id: formData.property_id,
        category: formData.category,
        amount: parseFloat(formData.amount),
        expense_date: formData.date,
        description: formData.description,
      });
      setFormData({ company_id: '', property_id: '', category: '', amount: '', date: '', description: '' });
      setShowForm(false);
      fetchData();
    } catch {
      setError('Failed to add expense.');
    }
  };

  const trendData = useMemo(() => {
    if (!data?.items) return [];
    const byMonth: Record<string, number> = {};
    data.items.forEach(item => {
      const month = item.expense_date.substring(0, 7);
      byMonth[month] = (byMonth[month] || 0) + item.amount;
    });
    return Object.entries(byMonth)
      .sort(([m1], [m2]) => m1.localeCompare(m2))
      .slice(-6)
      .map(([month, amount]) => ({ month, amount: parseFloat(amount.toFixed(2)) }));
  }, [data]);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F1F5F9' }}>Expenses</h1>
          <p className="text-sm mt-0.5" style={{ color: '#64748B' }}>Track and analyze all property expenses</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowForm(!showForm)}
            style={{ background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)', color: 'white' }}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg font-medium"
          >
            <Plus size={14} /> Add Expense
          </button>
          <button
            style={{ background: '#1E2A4A', border: '1px solid #2A3158', color: '#60A5FA' }}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg font-medium hover:bg-white/5"
          >
            <Upload size={14} /> Import Excel
          </button>
        </div>
      </div>

      {/* Add Expense Form */}
      {showForm && (
        <div className="p-4 rounded-lg" style={{ background: '#0F1830', border: '1px solid #2A3158' }}>
          <form onSubmit={handleAddExpense} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <select
                value={formData.company_id}
                onChange={(e) => setFormData({ ...formData, company_id: e.target.value })}
                style={{ background: '#1E2A4A', color: '#F1F5F9', borderColor: '#2A3158' }}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select Company</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                style={{ background: '#1E2A4A', color: '#F1F5F9', borderColor: '#2A3158' }}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select Category</option>
                {EXPENSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                style={{ background: '#1E2A4A', color: '#F1F5F9', borderColor: '#2A3158' }}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Amount"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                style={{ background: '#1E2A4A', color: '#F1F5F9', borderColor: '#2A3158' }}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                style={{ background: '#1E2A4A', color: '#F1F5F9', borderColor: '#2A3158' }}
                className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{ color: '#64748B', borderColor: '#2A3158' }}
                className="px-3 py-2 border rounded-lg text-sm font-medium hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{ background: '#10B981', color: 'white' }}
                className="px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-600"
              >
                Add Expense
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-lg" style={{ background: '#0F1830', border: '1px solid #2A3158' }}>
        <span className="text-xs font-semibold" style={{ color: '#64748B' }}>COMPANY</span>
        <select
          value={filterCompany}
          onChange={(e) => setFilterCompany(e.target.value)}
          style={{ background: '#1E2A4A', color: '#F1F5F9', borderColor: '#2A3158' }}
          className="px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton rows={8} />
      ) : error ? (
        <div className="p-4 rounded-lg" style={{ background: '#7F1D1D', color: '#FECACA', borderLeft: '4px solid #F87171' }}>
          {error}
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label="This Month" value={fmtUSD(data.kpis.total_this_month)} accent />
            <KpiCard label="All Time" value={fmtUSD(data.kpis.total_all_time)} />
            <KpiCard label="Top Category" value={data.kpis.most_expensive_category ?? '—'} />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Expense by Category Donut */}
            <Card title="Expense by Category">
              {data.by_category.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={data.by_category}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="amount"
                    >
                      {data.by_category.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={CAT_COLORS[entry.category] || '#64748B'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => fmtUSD(value)} {...TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#64748B' }}>No data</div>
              )}
            </Card>

            {/* Expense by Company Bar Chart */}
            <Card title="Expense by Company">
              {data.items.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={Array.from(
                      new Map(
                        data.items.map(item => [
                          item.company_name || 'Unknown',
                          (data.items.filter(i => i.company_name === item.company_name).reduce((sum, i) => sum + i.amount, 0))
                        ])
                      ).entries()
                    ).map(([name, total]) => ({ name, amount: total }))}
                  >
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94A3B8' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: number) => fmtUSD(value)} {...TOOLTIP_STYLE} />
                    <Bar dataKey="amount" fill="#3B82F6" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#64748B' }}>No data</div>
              )}
            </Card>

            {/* Expense Trend */}
            <Card title="Expense Trend — 6 Months">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={trendData}>
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94A3B8' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value: number) => fmtUSD(value)} {...TOOLTIP_STYLE} />
                    <Line type="monotone" dataKey="amount" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981', r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-60 flex items-center justify-center" style={{ color: '#64748B' }}>No trend data</div>
              )}
            </Card>
          </div>

          {/* Expenses Table */}
          <Card title="All Expenses">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: '#2A3158' }}>
                    {['Date', 'Company', 'Category', 'Amount', 'Description'].map(h => (
                      <th key={h} className="py-2 px-3 font-medium text-left" style={{ color: '#64748B' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="border-b" style={{ borderColor: '#1E2A4A' }}>
                      <td className="py-2 px-3" style={{ color: '#F1F5F9' }}>{r.expense_date}</td>
                      <td className="py-2 px-3" style={{ color: '#94A3B8' }}>{r.company_name || '—'}</td>
                      <td className="py-2 px-3">
                        <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ background: CAT_COLORS[r.category] || '#64748B', color: 'white', opacity: 0.8 }}>
                          {r.category}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-medium" style={{ color: '#10B981' }}>{fmtUSD(r.amount)}</td>
                      <td className="py-2 px-3" style={{ color: '#64748B' }}>{r.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
