import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { BulletChartStrip } from '../../../components/shared/BulletChartStrip';
import { CASH_DEBT_BULLET_DEFS, exportItemsToBulletCards } from '../../../utils/rentalAnalyticsBullets';
import { fmtAnalyticsCurrency, shortMonthLabel } from '../../../utils/rentalAnalyticsCharts';
import type { AnalyticsSnapshot, MonthlyTrendPoint } from '../../../hooks/useRentalAnalyticsData';

function CashTrendChart({ data }: { data: MonthlyTrendPoint[] }) {
  const chartData = data.map(d => ({ month: shortMonthLabel(d.month), cash: d.cash }));
  return (
    <div style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Cash Balance Trend</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Point-in-time balance per month (not summed)</div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => fmtAnalyticsCurrency(v)} width={64} />
          <Tooltip formatter={(v: number) => fmtAnalyticsCurrency(v)} />
          <Line type="monotone" dataKey="cash" stroke="#7C3AED" strokeWidth={2.5} dot={{ r: 3, fill: '#7C3AED' }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function LeverageTable({ selected }: { selected: AnalyticsSnapshot }) {
  const k = selected.k!;
  const rows = [
    {
      metric: 'Asset / Liability Ratio',
      item: selected.sets!.balanceSheet.find(i => i.label === 'Asset / Liability Ratio'),
      gap: k.totalLiabilities <= 0 ? 'Total liabilities missing or zero on balance sheet' : null,
    },
    {
      metric: 'Debt-to-Equity',
      item: selected.sets!.balanceSheet.find(i => i.label === 'Debt-to-Equity'),
      gap: k.equity === 0 ? 'Equity is zero — ratio undefined' : k.equity < 0 ? `Negative equity (${fmtAnalyticsCurrency(k.equity)})` : null,
    },
    {
      metric: 'LTV',
      item: selected.sets!.balanceSheet.find(i => i.label === 'LTV'),
      gap: k.buildings <= 0 ? 'LTV: building value not found in balance sheet' : null,
    },
  ];

  return (
    <div style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: 12, padding: '20px 24px', overflowX: 'auto' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 16 }}>Leverage Ratios</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #E2E8F0', textAlign: 'left' }}>
            {['Metric', 'Value', 'Status', 'Target', 'Data Notes'].map(h => (
              <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#78716C', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.metric} style={{ borderBottom: '1px solid rgba(232,222,200,0.6)' }}>
              <td style={{ padding: '10px 12px', fontWeight: 500, color: '#1C1917' }}>{r.metric}</td>
              <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{r.item?.value ?? '—'}</td>
              <td style={{ padding: '10px 12px' }}>{r.item?.statusLabel ?? '—'}</td>
              <td style={{ padding: '10px 12px', color: '#78716C' }}>{r.item?.benchmark ?? '—'}</td>
              <td style={{ padding: '10px 12px', color: r.gap ? '#B45309' : '#78716C', fontSize: 12 }}>
                {r.gap ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsCashDebt({
  selected, ttmTrend,
}: {
  selected: AnalyticsSnapshot | null;
  ttmTrend: MonthlyTrendPoint[];
}) {
  if (!selected?.sets) {
    return <p style={{ color: '#78716C', fontSize: 14 }}>Select a company with financial data to view cash & debt analytics.</p>;
  }

  const bulletCards = exportItemsToBulletCards([
    ...selected.sets.balanceSheet.filter(i => i.label === 'DSCR (Est.)'),
    ...selected.sets.profitability.filter(i => i.label === 'Interest Coverage'),
  ]);

  return (
    <div className="space-y-6">
      <p style={{ fontSize: 13, color: '#78716C' }}>
        Cash & debt · <strong style={{ color: '#1C1917' }}>{selected.label}</strong>
      </p>
      <CashTrendChart data={ttmTrend} />
      <BulletChartStrip
        cards={bulletCards}
        defs={CASH_DEBT_BULLET_DEFS}
        title="Debt Service Benchmarks"
        subtitle="DSCR vs &gt;1.25x target · Interest Coverage vs &gt;1.5x target"
      />
      <LeverageTable selected={selected} />
    </div>
  );
}
