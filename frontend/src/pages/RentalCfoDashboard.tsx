import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line, ComposedChart,
} from 'recharts';
import api from '../services/api';
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import { LoadingSkeleton } from '../components/ui/Table';

const fmt$ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

interface FinItem {
  label: string;
  values: Record<number, number>;
  indent: number;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
}

interface FinData {
  companyName: string;
  years: number[];
  pl: FinItem[];
  bs: FinItem[];
  cf: FinItem[];
}

function getYValue(items: FinItem[], pattern: RegExp, year: number): number {
  const item = items.find(it => pattern.test(it.label));
  return item?.values[year] ?? 0;
}

function sumItems(items: FinItem[], pattern: RegExp, year: number): number {
  return items
    .filter(it => pattern.test(it.label))
    .reduce((s, it) => s + (it.values[year] ?? 0), 0);
}

export default function RentalCfoDashboard() {
  const [fin, setFin] = useState<FinData | null>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [coRes, portfolioRes] = await Promise.all([
          api.get('/api/rentals/companies'),
          api.get('/api/rentals/portfolio-summary'),
        ]);

        const cos = coRes.data || [];
        setCompanies(cos);

        if (cos.length > 0) {
          const mainCo = cos[0];
          try {
            const finRes = await api.get(`/api/rentals/financials/${mainCo.id}`);
            setFin(finRes.data);
            if (finRes.data?.years?.length > 0) {
              setSelectedYear(finRes.data.years[finRes.data.years.length - 1]);
            }
          } catch {
            console.warn('No financials data for primary company');
          }
        }
      } catch (err) {
        console.error('Error fetching CFO data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) return <LoadingSkeleton rows={8} />;
  if (!fin) return <div className="p-6 text-gray-500">No financial data available. Upload CASH_FLOWS.xlsx on the Financials page.</div>;

  const years = fin.years;
  const pl = fin.pl;
  const bs = fin.bs;

  // ── Data Series ───────────────────────────────────────────────────────────────

  // 1. Net Income Trajectory
  const niTrajectory = years.map(y => ({
    year: y,
    netIncome: getYValue(pl, /^net\s+income$/i, y),
  }));

  // 2. Revenue vs Expenses Combo
  const revExpCombo = years.map(y => {
    const revenue = Math.abs(getYValue(pl, /^total\s+(revenue|income)$/i, y) || sumItems(pl, /revenue|rental\s+income/i, y));
    const expenses = Math.abs(sumItems(pl, /expense/i, y));
    return { year: y, Revenue: revenue, Expenses: expenses };
  });

  // 3. Expense Ratio Trend
  const expRatioTrend = years.map(y => {
    const revenue = Math.abs(getYValue(pl, /^total\s+(revenue|income)$/i, y) || sumItems(pl, /revenue|rental\s+income/i, y));
    const expenses = Math.abs(sumItems(pl, /expense/i, y));
    const ratio = revenue > 0 ? (expenses / revenue) : 0;
    return { year: y, ratio: ratio * 100 };
  });

  // 4. Cash Balance Trend
  const cashTrend = years.map(y => ({
    year: y,
    cash: getYValue(bs, /^total\s+for\s+bank\s+accounts$/i, y) || sumItems(bs, /^bank|checking|savings/i, y),
  }));

  // 5. Year Insights
  const getYearInsight = (year: number) => {
    const revenue = Math.abs(getYValue(pl, /^total\s+(revenue|income)$/i, year) || sumItems(pl, /revenue|rental\s+income/i, year));
    const expenses = Math.abs(sumItems(pl, /expense/i, year));
    const netIncome = getYValue(pl, /^net\s+income$/i, year);
    const cash = getYValue(bs, /^total\s+for\s+bank\s+accounts$/i, year) || sumItems(bs, /^bank|checking|savings/i, year);
    const margin = revenue > 0 ? (netIncome / revenue) * 100 : 0;

    let insight = '';
    let icon: React.ReactNode = null;
    let color = 'text-gray-600';

    if (margin > 20) {
      insight = `Strong profitability: ${margin.toFixed(1)}% net margin. Revenue of ${fmt$(revenue)} with controlled expenses.`;
      icon = <CheckCircle2 size={20} className="text-green-600" />;
      color = 'text-green-700';
    } else if (margin > 10) {
      insight = `Healthy margins at ${margin.toFixed(1)}%. Watch expense growth relative to ${fmt$(revenue)} revenue.`;
      icon = <TrendingUp size={20} className="text-blue-600" />;
      color = 'text-blue-700';
    } else if (revenue > 0) {
      insight = `Low profitability (${margin.toFixed(1)}% margin). Expenses of ${fmt$(expenses)} consume ${((expenses/revenue)*100).toFixed(1)}% of revenue — prioritize cost reduction.`;
      icon = <AlertCircle size={20} className="text-amber-600" />;
      color = 'text-amber-700';
    } else {
      insight = 'No revenue recorded for this year.';
      icon = <AlertCircle size={20} className="text-red-600" />;
      color = 'text-red-700';
    }

    return { insight, icon, color, revenue, expenses, netIncome, margin, cash };
  };

  const yearInsight = selectedYear ? getYearInsight(selectedYear) : null;

  const PIE_COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981'];

  return (
    <div className="space-y-8 -m-6 p-6" style={{ background: 'transparent' }}>
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: '#B8860B' }}>CFO VIEW</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">CFO Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">{fin.companyName} · Financial Overview 2021–2026</p>
      </div>

      {/* Year Selector */}
      <div className="flex gap-2 flex-wrap">
        {years.map(y => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            style={{
              background: selectedYear === y ? '#3B82F6' : '#F3F4F6',
              color: selectedYear === y ? '#FFFFFF' : '#374151',
              border: '1px solid ' + (selectedYear === y ? '#3B82F6' : '#D1D5DB'),
            }}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-all hover:shadow-md"
          >
            {y}
          </button>
        ))}
      </div>

      {/* Selected Year Insight Card */}
      {yearInsight && (
        <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px' }}>
          <div className="flex gap-4 items-start">
            {yearInsight.icon}
            <div className="flex-1">
              <h3 className={`font-bold text-lg ${yearInsight.color}`}>{selectedYear} Financial Snapshot</h3>
              <p className="text-sm text-gray-700 mt-2">{yearInsight.insight}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase">Revenue</p>
                  <p className="text-lg font-bold text-gray-900">{fmt$(yearInsight.revenue)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase">Expenses</p>
                  <p className="text-lg font-bold text-gray-900">{fmt$(yearInsight.expenses)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase">Net Income</p>
                  <p className="text-lg font-bold text-gray-900">{fmt$(yearInsight.netIncome)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase">Cash (Bank)</p>
                  <p className="text-lg font-bold text-gray-900">{fmt$(yearInsight.cash)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Net Income Trajectory */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-bold text-gray-900 mb-4">Net Income Trajectory</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={niTrajectory} margin={{ left: 0, right: 10, top: 5, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt$(v)} />
              <Line type="monotone" dataKey="netIncome" stroke="#10B981" strokeWidth={2} dot={{ fill: '#10B981' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Expense Ratio Trend */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-bold text-gray-900 mb-4">Expense Ratio Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={expRatioTrend} margin={{ left: 0, right: 10, top: 5, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line type="monotone" dataKey="ratio" stroke="#F59E0B" strokeWidth={2} dot={{ fill: '#F59E0B' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue vs Expenses Combo */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-bold text-gray-900 mb-4">Revenue vs Expenses</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={revExpCombo} margin={{ left: 0, right: 10, top: 5, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt$(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Cash Balance Trend */}
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-bold text-gray-900 mb-4">Cash Balance Trend (Bank Accounts)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={cashTrend} margin={{ left: 0, right: 10, top: 5, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt$(v)} />
              <Line type="monotone" dataKey="cash" stroke="#8B5CF6" strokeWidth={2} dot={{ fill: '#8B5CF6' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Summary Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {years.length > 0 && (() => {
          const latestYear = years[years.length - 1];
          const prevYear = years.length > 1 ? years[years.length - 2] : null;
          const latestNI = getYValue(pl, /^net\s+income$/i, latestYear);
          const prevNI = prevYear ? getYValue(pl, /^net\s+income$/i, prevYear) : 0;
          const niChange = prevNI !== 0 ? ((latestNI - prevNI) / Math.abs(prevNI)) * 100 : 0;

          return (
            <>
              <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px' }}>
                <p className="text-xs text-gray-600 uppercase font-semibold">Latest Net Income ({latestYear})</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{fmt$(latestNI)}</p>
                <p className={`text-xs mt-2 ${niChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {niChange > 0 ? '↑' : '↓'} {Math.abs(niChange).toFixed(1)}% vs {prevYear}
                </p>
              </div>
              <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px' }}>
                <p className="text-xs text-gray-600 uppercase font-semibold">Avg Profit Margin</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {(() => {
                    const margins = years.map(y => {
                      const rev = Math.abs(getYValue(pl, /^total\s+(revenue|income)$/i, y) || sumItems(pl, /revenue|rental\s+income/i, y));
                      const ni = getYValue(pl, /^net\s+income$/i, y);
                      return rev > 0 ? (ni / rev) * 100 : 0;
                    });
                    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
                    return `${avg.toFixed(1)}%`;
                  })()}
                </p>
              </div>
              <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px' }}>
                <p className="text-xs text-gray-600 uppercase font-semibold">Latest Cash Position</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{fmt$(getYValue(bs, /^total\s+for\s+bank\s+accounts$/i, latestYear) || sumItems(bs, /^bank|checking|savings/i, latestYear))}</p>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
