import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, LineChart, Line, ComposedChart,
} from 'recharts';
import api from '../services/api';
import { TrendingUp, AlertCircle, CheckCircle2 } from 'lucide-react';
import { LoadingSkeleton } from '../components/ui/Table';
import { apiResponseToParsedFinancials, calcKpis, type ParsedFinancials } from '../utils/rentalKpiEngine';

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

interface CompanyOption {
  id: string;
  company_name: string;
}

export default function RentalCfoDashboard() {
  const [fin, setFin] = useState<FinData | null>(null);
  const [parsedFin, setParsedFin] = useState<ParsedFinancials | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        setLoading(true);
        const coRes = await api.get('/api/rentals/companies');
        const cos: CompanyOption[] = coRes.data || [];
        setCompanies(cos);
        if (cos.length > 0) {
          setSelectedCompanyId(cos[0].id);
        }
      } catch (err) {
        console.error('Error fetching CFO companies:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCompanies();
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const finRes = await api.get(`/api/rentals/financials/${selectedCompanyId}`);
        if (cancelled) return;
        const raw = finRes.data;
        setFin(raw);
        setParsedFin(apiResponseToParsedFinancials(raw));
        if (raw?.years?.length > 0) {
          setSelectedYear(raw.years[raw.years.length - 1]);
        }
      } catch {
        if (!cancelled) {
          setFin(null);
          setParsedFin(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

  if (loading) return <LoadingSkeleton rows={8} />;
  if (!fin || !parsedFin) {
    return <div className="p-6 text-gray-500">No financial data available. Upload CASH_FLOWS.xlsx on the Financials page.</div>;
  }

  const years = fin.years;
  const kpisForYear = (y: number) => calcKpis(parsedFin, y);

  // ── Data Series ───────────────────────────────────────────────────────────────

  // 1. Net Income Trajectory
  const niTrajectory = years.map(y => ({
    year: y,
    netIncome: kpisForYear(y).netIncome,
  }));

  // 2. Revenue vs Expenses Combo — same calcKpis as KPI Dashboard
  const revExpCombo = years.map(y => {
    const k = kpisForYear(y);
    return { year: y, Revenue: k.totalRevenue, Expenses: k.totalExpenses };
  });

  // 3. Expense Ratio Trend
  const expRatioTrend = years.map(y => {
    const k = kpisForYear(y);
    const ratio = k.totalRevenue > 0 ? (k.totalExpenses / k.totalRevenue) * 100 : 0;
    return { year: y, ratio };
  });

  // 4. Cash Balance Trend
  const cashTrend = years.map(y => ({
    year: y,
    cash: kpisForYear(y).cash,
  }));

  // 5. Year Insights
  const getYearInsight = (year: number) => {
    const k = kpisForYear(year);
    const revenue = k.totalRevenue;
    const expenses = k.totalExpenses;
    const netIncome = k.netIncome;
    const cash = k.cash;
    const margin = revenue > 0 ? (netIncome / revenue) * 100 : 0;

    let insight = '';
    let icon: React.ReactNode = null;
    let color = 'text-gray-600';

    if (margin > 20) {
      insight = `Strong profitability: ${margin.toFixed(1)}% net margin. Revenue of ${fmt$(revenue)} with controlled expenses.`;
      icon = <CheckCircle2 size={20} className="text-green-800" />;
      color = 'text-green-800';
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
      icon = <AlertCircle size={20} className="text-red-700" />;
      color = 'text-red-700';
    }

    return { insight, icon, color, revenue, expenses, netIncome, margin, cash };
  };

  const yearInsight = selectedYear ? getYearInsight(selectedYear) : null;

  return (
    <div className="space-y-8 -m-6 p-6" style={{ background: 'transparent' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <p className="text-xs uppercase tracking-wider" style={{ color: '#B8860B' }}>CFO VIEW</p>
          <h1 className="text-3xl font-bold text-gray-900 mt-1">CFO Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">{fin.companyName} · Financial Overview {years[0]}–{years[years.length - 1]}</p>
        </div>
        {companies.length > 1 && (
          <select
            value={selectedCompanyId ?? ''}
            onChange={e => setSelectedCompanyId(e.target.value)}
            style={{
              fontSize: 13, padding: '8px 12px', borderRadius: 8,
              border: '1px solid #E8DEC8', background: '#FBF6EE', minWidth: 220,
            }}
          >
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        )}
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
                  <p className="text-xs text-gray-400 mt-0.5">Total for Income</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase">Expenses</p>
                  <p className="text-lg font-bold text-gray-900">{fmt$(yearInsight.expenses)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Total for Expenses</p>
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
          const latestNI = kpisForYear(latestYear).netIncome;
          const prevNI = prevYear ? kpisForYear(prevYear).netIncome : 0;
          const niChange = prevNI !== 0 ? ((latestNI - prevNI) / Math.abs(prevNI)) * 100 : 0;

          return (
            <>
              <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px' }}>
                <p className="text-xs text-gray-600 uppercase font-semibold">Latest Net Income ({latestYear})</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{fmt$(latestNI)}</p>
                <p className={`text-xs mt-2 ${niChange > 0 ? 'text-green-800' : 'text-red-700'}`}>
                  {niChange > 0 ? '↑' : '↓'} {Math.abs(niChange).toFixed(1)}% vs {prevYear}
                </p>
              </div>
              <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px' }}>
                <p className="text-xs text-gray-600 uppercase font-semibold">Avg Profit Margin</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {(() => {
                    const margins = years.map(y => {
                      const k = kpisForYear(y);
                      return k.totalRevenue > 0 ? (k.netIncome / k.totalRevenue) * 100 : 0;
                    });
                    const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
                    return `${avg.toFixed(1)}%`;
                  })()}
                </p>
              </div>
              <div style={{ background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '16px' }}>
                <p className="text-xs text-gray-600 uppercase font-semibold">Latest Cash Position</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">{fmt$(kpisForYear(latestYear).cash)}</p>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
