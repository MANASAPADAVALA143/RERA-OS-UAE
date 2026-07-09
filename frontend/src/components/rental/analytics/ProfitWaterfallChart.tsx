import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import type { WaterfallRow } from '../../../utils/rentalAnalyticsCharts';
import { fmtAnalyticsCurrency } from '../../../utils/rentalAnalyticsCharts';

export function ProfitWaterfallChart({ data }: { data: WaterfallRow[] }) {
  return (
    <div style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Profitability Waterfall</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Gross rental income through net income for selected period</div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ left: 12, right: 12, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716C' }} interval={0} angle={-12} textAnchor="end" height={56} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => fmtAnalyticsCurrency(v)} width={60} />
          <Tooltip
            formatter={(v: number, name: string) => name === 'invisible' ? null : [fmtAnalyticsCurrency(v), 'Amount']}
            labelFormatter={l => String(l)}
          />
          <Bar dataKey="invisible" stackId="wf" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="bar" stackId="wf" radius={[4, 4, 0, 0]} isAnimationActive={false} name="Amount">
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
