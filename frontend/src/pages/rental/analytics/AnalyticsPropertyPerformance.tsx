import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Treemap,
} from 'recharts';
import type { PropertySlice } from '../../../hooks/useRentalAnalyticsData';
import { fmtAnalyticsCurrency } from '../../../utils/rentalAnalyticsCharts';

const TREEMAP_COLORS = ['#166534', '#0F766E', '#1D4ED8', '#7C3AED', '#B45309', '#C0392B', '#92400E'];

interface TreemapNodeProps {
  x?: number; y?: number; width?: number; height?: number;
  name?: string; size?: number; noi?: number; fill?: string;
}

function NoiTreemapContent(props: TreemapNodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, noi = 0, fill = '#166534' } = props;
  if (!name || width < 48 || height < 36) return null;
  const short = name.length > 16 ? `${name.slice(0, 14)}…` : name;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" strokeWidth={2} rx={4} />
      <text x={x + 6} y={y + 16} fill="#fff" fontSize={11} fontWeight={600}>{short}</text>
      <text x={x + 6} y={y + 30} fill="#ffffffcc" fontSize={10}>{fmtAnalyticsCurrency(noi)} NOI</text>
    </g>
  );
}

function PropertyColumnChart({ slices }: { slices: PropertySlice[] }) {
  const data = slices.map(s => ({
    name: s.name.length > 14 ? `${s.name.slice(0, 12)}…` : s.name,
    Income: s.revenue,
    Expenses: s.expenses,
  }));

  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Income vs Expense by Property</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Clustered columns per company/entity in portfolio</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => fmtAnalyticsCurrency(v)} width={64} />
          <Tooltip formatter={(v: number) => fmtAnalyticsCurrency(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Income" fill="#3B82F6" radius={[3, 3, 0, 0]} barSize={22} />
          <Bar dataKey="Expenses" fill="#EF4444" radius={[3, 3, 0, 0]} barSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function NoiTreemap({ slices }: { slices: PropertySlice[] }) {
  const data = useMemo(() =>
    slices
      .filter(s => s.noi !== 0)
      .map((s, i) => ({
        name: s.name,
        size: Math.max(Math.abs(s.noi), 1),
        noi: s.noi,
        fill: TREEMAP_COLORS[i % TREEMAP_COLORS.length],
      })),
  [slices]);

  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '20px 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Portfolio NOI Contribution</div>
      <div style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Treemap sized by NOI across properties/companies</div>
      {data.length === 0 ? (
        <p style={{ fontSize: 13, color: '#78716C' }}>No NOI data available for treemap.</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <Treemap
            data={data}
            dataKey="size"
            nameKey="name"
            stroke="#fff"
            content={<NoiTreemapContent />}
          />
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default function AnalyticsPropertyPerformance({
  propertySlices,
}: {
  propertySlices: PropertySlice[];
}) {
  const multi = propertySlices.length > 1;

  return (
    <div className="space-y-6">
      <p style={{ fontSize: 13, color: '#78716C' }}>
        Property performance across portfolio · {propertySlices.length} entit{propertySlices.length === 1 ? 'y' : 'ies'}
      </p>

      {multi ? (
        <>
          <PropertyColumnChart slices={propertySlices} />
          <NoiTreemap slices={propertySlices} />
        </>
      ) : propertySlices.length === 1 ? (
        <>
          <div style={{ background: '#F0F6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#1E40AF' }}>
            Single-entity portfolio — showing entity-level income vs expense and NOI contribution below.
          </div>
          <PropertyColumnChart slices={propertySlices} />
          <NoiTreemap slices={propertySlices} />
        </>
      ) : (
        <p style={{ color: '#78716C', fontSize: 14 }}>No property financial data available. Upload financials to enable property performance views.</p>
      )}
    </div>
  );
}
