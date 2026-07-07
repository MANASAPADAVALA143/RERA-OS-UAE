import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from 'recharts';
import type { MonthlyTrendPoint } from '../../../hooks/useRentalAnalyticsData';
import { fmtAnalyticsCurrency, shortMonthLabel } from '../../../utils/rentalAnalyticsCharts';

export function RevenueExpNoiComboChart({ data }: { data: MonthlyTrendPoint[] }) {
  const chartData = data.map(d => ({
    month: shortMonthLabel(d.month),
    Revenue: d.revenue,
    Expenses: d.expenses,
    NOI: d.noi,
  }));

  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Revenue vs Expenses vs NOI</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Trailing 12 months — same underlying KPI data as KPI Dashboard</div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => fmtAnalyticsCurrency(v)} width={64} />
          <Tooltip formatter={(v: number) => fmtAnalyticsCurrency(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Revenue" fill="#3B82F6" radius={[3, 3, 0, 0]} barSize={18} />
          <Bar dataKey="Expenses" fill="#EF4444" radius={[3, 3, 0, 0]} barSize={18} />
          <Line type="monotone" dataKey="NOI" stroke="#0F766E" strokeWidth={2.5} dot={{ r: 3, fill: '#0F766E' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
