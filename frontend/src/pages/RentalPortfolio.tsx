import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ScatterChart, Scatter, CartesianGrid, ReferenceLine } from 'recharts';
import { Calendar, Filter, RefreshCw, AlertCircle, TrendingUp, TrendingDown, DollarSign, Users, Home, AlertTriangle, Building2, CreditCard, TrendingUpIcon, Zap } from 'lucide-react';
import api from '../services/api';
import { fmtUSD, fmtPct } from '../components/ProtectedRoute';

interface PortfolioData {
  occupancy_pct: number;
  collected_this_month: number;
  billed_this_month: number;
  noi_this_month: number;
  gross_potential_rent: number;
  vacancy_loss: number;
  vacant_units: number;
  total_units: number;
  arrears_total: number;
  by_company: any[];
  income_trend: any[];
  arrears_aging: Record<string, number>;
}

interface CompanySummary {
  company_name: string;
  noi_this_month: number;
  gross_potential_rent: number;
  occupancy_pct: number;
  vacant_units: number;
}

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6'];
const TOOLTIP_STYLE = { contentStyle: { background: '#1E2A4A', border: '1px solid #3A4170', color: '#F1F5F9', borderRadius: 8 } };

interface StyledKpiProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  borderColor: string;
  iconBgColor: string;
}

function StyledKpiCard({ icon, label, value, sub, borderColor, iconBgColor }: StyledKpiProps) {
  return (
    <div style={{
      background: '#0F1629',
      border: `1px solid #1E2942`,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: '10px',
      padding: '20px',
      display: 'flex',
      gap: '16px',
      alignItems: 'flex-start',
    }}>
      <div style={{
        background: iconBgColor,
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: '#F1F5F9',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '12px', color: '#94A3B8', fontWeight: 500, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {label}
        </div>
        <div style={{ fontSize: '28px', fontWeight: 700, color: '#F1F5F9', fontFamily: 'monospace', marginBottom: '4px' }}>
          {value}
        </div>
        <div style={{ fontSize: '12px', color: '#64748B' }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

export default function RentalPortfolio() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedCompany, setSelectedCompany] = useState('all');
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get<PortfolioData>(`/api/rentals/portfolio-summary?month=${selectedMonth}`);
      setData(res.data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load portfolio data', err);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading || !data) return <div className="p-6" style={{ color: '#94A3B8' }}>Loading portfolio...</div>;

  const filteredCompanies = selectedCompany === 'all' ? data.by_company : data.by_company.filter(c => c.company_id === selectedCompany);
  const collectionRate = data.billed_this_month > 0 ? (data.collected_this_month / data.billed_this_month) * 100 : 0;
  // NOI margin: cap at 100% since NOI should never exceed gross potential rent for a healthy property
  const noiMargin = Math.min(100, data.gross_potential_rent > 0 ? (data.noi_this_month / data.gross_potential_rent) * 100 : 0);
  // DSO: handle zero collected amount
  const dso = data.collected_this_month > 0 && data.arrears_total > 0 ? (data.arrears_total / data.collected_this_month) * 30 : 0;

  return (
    <div className="space-y-6 p-6" style={{ background: 'transparent' }}>
      {/* ─────── TOP BAR ─────── */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: '#F1F5F9' }}>Rental Portfolio Dashboard</h1>
          <p className="text-sm mt-1" style={{ color: '#64748B' }}>Executive overview of portfolio performance</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2" style={{ background: '#1E2A4A', border: '1px solid #2A3158', padding: '8px 12px', borderRadius: '8px' }}>
            <Calendar size={16} style={{ color: '#60A5FA' }} />
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ background: 'transparent', color: '#F1F5F9', border: 'none', fontSize: '14px' }} />
          </div>
          <button style={{ background: '#1E2A4A', border: '1px solid #2A3158', color: '#60A5FA', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <Filter size={14} className="inline mr-1" /> Filters
          </button>
          <button onClick={() => fetchData()} style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: '12px' }}>
            <RefreshCw size={14} className="inline mr-1" /> Last updated: {lastUpdated.toLocaleTimeString()}
          </button>
        </div>
      </div>

      {/* ─────── ROW 1: KPI CARDS ─────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StyledKpiCard
          icon={<Building2 size={20} />}
          label="Occupancy Rate"
          value={fmtPct(data.occupancy_pct)}
          sub={`${data.total_units - data.vacant_units} / ${data.total_units} units`}
          borderColor="#10B981"
          iconBgColor="rgba(16, 185, 129, 0.15)"
        />
        <StyledKpiCard
          icon={<DollarSign size={20} />}
          label="Rent Collected"
          value={fmtUSD(data.collected_this_month)}
          sub={`${collectionRate.toFixed(1)}% collection rate`}
          borderColor="#3B82F6"
          iconBgColor="rgba(59, 130, 246, 0.15)"
        />
        <StyledKpiCard
          icon={<TrendingUp size={20} />}
          label="NOI This Month"
          value={fmtUSD(data.noi_this_month)}
          sub={`${noiMargin.toFixed(1)}% margin`}
          borderColor="#3B82F6"
          iconBgColor="rgba(59, 130, 246, 0.15)"
        />
        <StyledKpiCard
          icon={<AlertTriangle size={20} />}
          label="Vacancy Loss"
          value={fmtUSD(data.vacancy_loss)}
          sub={`${data.vacant_units} vacant units`}
          borderColor="#EF4444"
          iconBgColor="rgba(239, 68, 68, 0.15)"
        />
        <StyledKpiCard
          icon={<AlertCircle size={20} />}
          label="Arrears Outstanding"
          value={fmtUSD(data.arrears_total)}
          sub={`${dso.toFixed(0)} days overdue`}
          borderColor="#F59E0B"
          iconBgColor="rgba(245, 158, 11, 0.15)"
        />
        <StyledKpiCard
          icon={<Users size={20} />}
          label="Partner Share Payable"
          value={fmtUSD(Math.round(data.noi_this_month * 0.25))}
          sub="of current NOI"
          borderColor="#8B5CF6"
          iconBgColor="rgba(139, 92, 246, 0.15)"
        />
      </div>

      {/* ─────── ROW 2: INCOME TREND + NOI BY COMPANY ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div style={{ background: '#0F1629', border: '1px solid #1E2942', borderRadius: '10px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#F1F5F9', marginBottom: '16px' }}>Income Trend (Last 6 Months)</h3>
          {data.income_trend && data.income_trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.income_trend.slice(-6)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2A3158" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ paddingTop: '16px' }} />
                <Line type="monotone" dataKey="collected" stroke="#10B981" name="Collected" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="billed" stroke="#60A5FA" name="Gross Potential" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
              No historical data available
            </div>
          )}
        </div>

        <div style={{ background: '#0F1629', border: '1px solid #1E2942', borderRadius: '10px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#F1F5F9', marginBottom: '16px' }}>NOI by Company</h3>
          {filteredCompanies.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={filteredCompanies.slice(0, 6)}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2A3158" />
                <XAxis dataKey="company_name" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUSD(v)} {...TOOLTIP_STYLE} />
                <Bar dataKey="noi_this_month" fill="#3B82F6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8' }}>
              No company data available
            </div>
          )}
        </div>
      </div>

      {/* ─────── ROW 3: OCCUPANCY GAUGE + VACANT UNITS + ARREARS ─────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div style={{ background: '#0F1629', border: '1px solid #1E2942', borderRadius: '10px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#F1F5F9', marginBottom: '20px' }}>Occupancy vs Target</h3>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', fontWeight: 'bold', color: data.occupancy_pct >= 0.95 ? '#10B981' : '#F59E0B', fontFamily: 'monospace' }}>
              {fmtPct(data.occupancy_pct)}
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '12px' }}>
              {data.occupancy_pct >= 0.95 ? '✓ Above 95% target' : '⚠ Below 95% target'}
            </div>
          </div>
        </div>

        <div style={{ background: '#0F1629', border: '1px solid #1E2942', borderRadius: '10px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#F1F5F9', marginBottom: '16px' }}>Occupied vs Vacant</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={[{ name: 'Occupied', value: data.total_units - data.vacant_units }, { name: 'Vacant', value: data.vacant_units }]} cx="50%" cy="50%" innerRadius={60} outerRadius={80} dataKey="value">
                <Cell fill="#10B981" />
                <Cell fill="#EF4444" />
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#0F1629', border: '1px solid #1E2942', borderRadius: '10px', padding: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#F1F5F9', marginBottom: '16px' }}>Arrears by Age</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={[
              { bucket: 'Current', amount: data.arrears_aging.current || 0, fill: '#10B981' },
              { bucket: '1-30d', amount: data.arrears_aging['1_30'] || 0, fill: '#F59E0B' },
              { bucket: '31-60d', amount: data.arrears_aging['31_60'] || 0, fill: '#F97316' },
              { bucket: '60+d', amount: (data.arrears_aging['61_90'] || 0) + (data.arrears_aging['90_plus'] || 0), fill: '#EF4444' },
            ]} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11, fill: '#94A3B8' }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis dataKey="bucket" type="category" tick={{ fontSize: 11, fill: '#94A3B8' }} />
              <Tooltip formatter={(v: number) => fmtUSD(v)} {...TOOLTIP_STYLE} />
              <Bar dataKey="amount" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─────── ROW 5: ATTENTION PANEL ─────── */}
      <div style={{ background: '#0F1629', border: '1px solid #1E2942', borderRadius: '10px', padding: '20px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#F1F5F9', marginBottom: '16px' }}>Attention Now</h3>
        <div className="space-y-2">
          {data.occupancy_pct < 0.9 && (
            <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5', padding: '12px', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <AlertTriangle size={18} />
              <span>{data.vacant_units} vacant unit(s) — below occupancy target</span>
            </div>
          )}
          {data.arrears_total > data.gross_potential_rent * 0.1 && (
            <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5', padding: '12px', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <AlertTriangle size={18} />
              <span>Arrears exceeding 10% of GPR — {fmtUSD(data.arrears_total)}</span>
            </div>
          )}
          {collectionRate < 95 && (
            <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#FCD34D', padding: '12px', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <AlertCircle size={18} />
              <span>Collection rate {collectionRate.toFixed(1)}% — below 95% target</span>
            </div>
          )}
          {data.by_company.filter(c => c.occupancy_pct < 0.85).length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#FCD34D', padding: '12px', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <AlertCircle size={18} />
              <span>{data.by_company.filter(c => c.occupancy_pct < 0.85).length} company(ies) below 85% occupancy</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
