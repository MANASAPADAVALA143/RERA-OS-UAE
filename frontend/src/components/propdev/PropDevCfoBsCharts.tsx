import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { PropDevBsSnapshot } from '../../utils/propDevCfoTrendData';
import { formatRatioNA } from '../../utils/propDevCfoTrendData';

const CFO_TT = {
  contentStyle: { background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 8, fontSize: 13, color: '#1C1917' },
  labelStyle: { color: '#57534E', fontWeight: 600, fontSize: 13 },
  itemStyle: { color: '#1C1917', fontSize: 13 },
};

const fmt = (n: number): string => {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(2)}M` : abs >= 1_000 ? `$${(abs / 1_000).toFixed(1)}K` : `$${abs.toLocaleString()}`;
  return n < 0 ? `(${s})` : s;
};

const fmtFull = (n: number): string => {
  if (n === 0) return '—';
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
};

export interface PropDevCfoBsChartsProps {
  snapshots: PropDevBsSnapshot[];
  selectedYear: number;
  onYearSelect?: (y: number) => void;
  companyName?: string;
}

export default function PropDevCfoBsCharts({
  snapshots,
  selectedYear,
  onYearSelect,
  companyName,
}: PropDevCfoBsChartsProps) {
  const costBasisTrend = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    yearNum: s.year,
    Land: s.landValue,
    'Improvements / WIP': s.improvementsWip,
    'Total Cost Basis': s.totalFixedAssets,
  })), [snapshots]);

  const ltlvTrend = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    yearNum: s.year,
    ltlv: s.ltlv,
  })), [snapshots]);

  const assetsVsDebt = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    yearNum: s.year,
    'Total Assets': s.totalAssets,
    'Total Debt': s.totalDebt,
  })), [snapshots]);

  const equityTrend = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    yearNum: s.year,
    equity: s.equity,
  })), [snapshots]);

  const assetComp = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    Land: s.landValue,
    Improvements: s.improvementsWip,
    Cash: s.cash,
    Other: s.otherAssets,
  })), [snapshots]);

  if (!snapshots.length) {
    return (
      <div style={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 12, padding: '32px 24px', textAlign: 'center', color: '#78716C', fontSize: 13 }}>
        No Balance Sheet data — upload a B/S file or import entity financials to see development BS trends.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#DDE0FA', color: '#78716C', padding: '8px 16px', fontSize: 13, fontWeight: 700 }}>
          Multi-Year BS Snapshot{companyName ? ` — ${companyName}` : ''}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#DDE0FA' }}>
                {['Year', 'Land Value', 'Improvements/WIP', 'Fixed Assets', 'Cash', 'Total Assets', 'Total Debt', 'Equity / Partner Capital', 'LTLV'].map(h => (
                  <th key={h} style={{ fontSize: 11, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', textAlign: h === 'Year' ? 'left' : 'right', padding: '8px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((r, i) => (
                <tr key={r.year} style={{ background: r.year === selectedYear ? '#EDE5D8' : i % 2 === 0 ? '#F7F8FA' : '#FFFFFF', borderTop: '1px solid #E8E9ED' }}>
                  <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: r.year === selectedYear ? 700 : 500 }}>{r.yearLabel}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.landValue)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.improvementsWip)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.totalFixedAssets)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#2F80ED' }}>{r.cash > 0 ? fmt(r.cash) : '—'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.totalAssets)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#B91C1C' }} title={r.debtAsOfNote}>{fmt(r.totalDebt)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.equity)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{formatRatioNA(r.ltlv, '%')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11, color: '#A8A29E', margin: '8px 16px 12px', lineHeight: 1.4 }}>
          Total Debt = Balance Sheet <strong>Total for Liabilities</strong>. Equity = Total Assets − Total Debt (computed from these columns, not a separate equity line). LTLV = Total Debt ÷ Land Value. Hover debt cells for the as-of source.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Cost Basis Trend</p>
          <p style={{ fontSize: 11, color: '#A8A29E', margin: '0 0 8px' }}>Land + Improvements/Capital WIP — total capital deployed into the project.</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={costBasisTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}
              onClick={(d: { activePayload?: { payload: { yearNum?: number } }[] }) => {
                const y = d?.activePayload?.[0]?.payload?.yearNum;
                if (y != null) onYearSelect?.(y);
              }}
              style={{ cursor: onYearSelect ? 'pointer' : 'default' }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: '#78716C' }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} {...CFO_TT} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="Land" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Improvements / WIP" stroke="#5B5FEF" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Total Cost Basis" stroke="#166534" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Loan-to-Land-Value Trend</p>
          <p style={{ fontSize: 11, color: '#A8A29E', margin: '0 0 8px' }}>Total Debt ÷ Land Value — informational only, not benchmarked to rental targets.</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={ltlvTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={v => `${(v as number).toFixed(0)}%`} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => (v != null && Number.isFinite(v) ? `${v.toFixed(1)}%` : 'N/A')} {...CFO_TT} />
              <Line type="monotone" dataKey="ltlv" stroke="#B45309" strokeWidth={2} dot={{ r: 4, fill: '#B45309' }} name="LTLV %" connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Assets vs Debt</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={assetsVsDebt} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} {...CFO_TT} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Total Assets" fill="#5B5FEF" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Total Debt" fill="#C0392B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Equity / Capital Contributed Trend</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={equityTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} {...CFO_TT} />
              <Line type="monotone" dataKey="equity" stroke="#166534" strokeWidth={2} dot={{ r: 4 }} name="Partner Capital / Equity" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }} className="lg:col-span-2">
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Asset Composition by Year</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={assetComp} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} {...CFO_TT} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Land" stackId="a" fill="#4F46E5" />
              <Bar dataKey="Improvements" stackId="a" fill="#5B5FEF" />
              <Bar dataKey="Cash" stackId="a" fill="#2F80ED" />
              <Bar dataKey="Other" stackId="a" fill="#A8A29E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
