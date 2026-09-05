import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { CompanyData, Loan } from '../../contexts/PropertyDevContext';
import type { PropDevCfSnapshot } from '../../utils/propDevCfoTrendData';
import { computeCashRunwayHero, formatCashRunwayCell } from '../../utils/propDevCfoTrendData';
import type { YearSnapshotPeriodAnchor } from '../../utils/cfoMultiYearTrendData';
import {
  computeCapitalCallCoverage,
  coverageStatusColors,
  formatCoverageRatio,
} from '../../utils/propDevLoanMetrics';

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

export interface PropDevCfoCfChartsProps {
  snapshots: PropDevCfSnapshot[];
  selectedYear: number;
  onYearSelect?: (y: number) => void;
  company: CompanyData | null | undefined;
  allLoans: Loan[];
  companyName?: string;
  periodAnchor?: YearSnapshotPeriodAnchor | null;
  pMonth?: number;
  pYear?: number;
}

export default function PropDevCfoCfCharts({
  snapshots,
  selectedYear,
  onYearSelect,
  company,
  allLoans,
  companyName,
  periodAnchor = null,
  pMonth,
  pYear,
}: PropDevCfoCfChartsProps) {
  const runway = useMemo(
    () => computeCashRunwayHero(snapshots, company, selectedYear),
    [snapshots, company, selectedYear],
  );
  const coverage = useMemo(
    () => (company ? computeCapitalCallCoverage(company, 6, allLoans) : null),
    [company, allLoans],
  );
  const covColors = coverage ? coverageStatusColors(coverage.status) : coverageStatusColors('N/A');

  const burnTrend = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    yearNum: s.year,
    burn: s.monthlyBurnRate > 0 ? -s.monthlyBurnRate : 0,
  })), [snapshots]);

  const closingCashTrend = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    yearNum: s.year,
    closingCash: s.closingCash,
  })), [snapshots]);

  const cfCompare = useMemo(() => snapshots.map(s => ({
    year: s.yearLabel,
    Operating: s.operatingCf,
    Investing: s.investingCf,
    Financing: s.financingCf,
  })), [snapshots]);

  if (!snapshots.length) {
    return (
      <div style={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 12, padding: '32px 24px', textAlign: 'center', color: '#78716C', fontSize: 13 }}>
        No Cash Flow data — import entity yearly CF or upload financial statements to see development cash flow trends.
      </div>
    );
  }

  const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {periodAnchor && pMonth && pYear && (
        <p className="text-xs text-gray-500 mb-0">
          {periodAnchor.period === 'Month'
            ? `${pYear} reflects ${MNAMES[pMonth - 1]} ${pYear} only; prior years show full fiscal year totals. Cash balance is as of that month.`
            : `${pYear} reflects YTD through ${MNAMES[pMonth - 1]} only; prior years show full fiscal year totals. Cash balance is as of that month.`}
        </p>
      )}
      {/* Hero KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={{ background: 'linear-gradient(135deg, #1C1917 0%, #44403C 100%)', borderRadius: 12, padding: '20px 24px', color: '#FFFFFF' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5B5FEF', margin: '0 0 8px' }}>Cash Runway</p>
          <p style={{ fontSize: 36, fontWeight: 800, margin: '0 0 4px', lineHeight: 1 }}>
            {runway.months != null
              ? <>{runway.months.toFixed(1)}<span style={{ fontSize: 18, fontWeight: 600, marginLeft: 4 }}>months</span></>
              : 'N/A'}
            </p>
          <p style={{ fontSize: 13, color: '#D6D3D1', margin: 0, lineHeight: 1.4 }}>
            {runway.label}
            {runway.avgMonthlyBurn > 0 && (
              <> · Avg burn ${Math.round(runway.avgMonthlyBurn).toLocaleString()}/mo (trailing {Math.min(6, snapshots.length)} yr)</>
            )}
          </p>
          <p style={{ fontSize: 12, color: '#A8A29E', margin: '8px 0 0' }}>Cash balance: {fmtFull(runway.cashBalance)}</p>
        </div>

        <div style={{ background: '#FFFFFF', border: '2px solid #5B5FEF', borderRadius: 12, padding: '20px 24px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#78716C', margin: '0 0 8px' }}>Capital Call Coverage</p>
          {coverage?.dataGap ? (
            <>
              <p style={{ fontSize: 22, fontWeight: 700, color: '#92400E', margin: '0 0 8px' }}>Data gap</p>
              <p style={{ fontSize: 13, color: '#57534E', margin: 0, lineHeight: 1.45 }}>
                No partner <strong>committed capital</strong> and no open <strong>capital calls</strong>.
                Add commitment amounts or capital-call dues to calculate coverage vs EMI obligations.
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 36, fontWeight: 800, margin: '0 0 4px', lineHeight: 1, color: '#1C1917' }}>
                {formatCoverageRatio(coverage?.ratio ?? null)}
              </p>
              <p style={{ fontSize: 13, color: '#57534E', margin: '0 0 8px' }}>
                {coverage?.source === 'capital-calls' ? 'Open capital-call dues' : 'Uncalled capital'}{' '}
                {coverage?.uncalled != null ? fmtFull(coverage.uncalled) : '—'} ÷ EMI obligations {fmtFull(coverage?.obligations ?? 0)} (6 mo)
              </p>
              <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${covColors.badge}`}>
                {coverage?.status ?? 'N/A'}
              </span>
            </>
          )}
        </div>
      </div>

      <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#DDE0FA', color: '#57534E', padding: '10px 16px', fontSize: 14, fontWeight: 700 }}>
          Multi-Year CF Snapshot{companyName ? ` — ${companyName}` : ''}
        </div>
        <p style={{ fontSize: 12, color: '#78716C', margin: '8px 16px 0', lineHeight: 1.4 }}>
          Negative Operating CF is <strong>expected</strong> during the holding phase (holding-cost burn, not a rental NOI shortfall).
        </p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: '#DDE0FA' }}>
                {['Year', 'Operating CF', 'Financing CF', 'Investing CF', 'Net CF', 'Opening Cash', 'Closing Cash', 'Monthly Burn', 'Cash Runway'].map(h => (
                  <th key={h} style={{ fontSize: 11, fontWeight: 600, color: '#57534E', textTransform: 'uppercase', textAlign: h === 'Year' ? 'left' : 'right', padding: '10px 12px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((r, i) => (
                <tr key={r.year} style={{ background: r.year === selectedYear ? '#EDE5D8' : i % 2 === 0 ? '#F7F8FA' : '#FFFFFF', borderTop: '1px solid #E8E9ED' }}>
                  <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: r.year === selectedYear ? 700 : 500 }}>{r.yearLabel}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#57534E' }}>{fmt(r.operatingCf)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.financingCf)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{fmt(r.investingCf)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{fmt(r.netCashFlow)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{r.openingCash !== 0 ? fmt(r.openingCash) : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#2F80ED' }}>{r.closingCash !== 0 ? fmt(r.closingCash) : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#57534E' }}>{r.monthlyBurnRate > 0 ? fmt(r.monthlyBurnRate) : '—'}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{formatCashRunwayCell(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Burn Rate Trend</p>
          <p style={{ fontSize: 11, color: '#A8A29E', margin: '0 0 8px' }}>Monthly operating burn — negative is normal during development holding.</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={burnTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtFull(Math.abs(v))} {...CFO_TT} />
              <Line type="monotone" dataKey="burn" stroke="#78716C" strokeWidth={2} dot={{ r: 4, fill: '#78716C' }} name="Monthly Burn" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Cumulative Cash Trend (Closing Balance)</p>
          <p style={{ fontSize: 11, color: '#A8A29E', margin: '0 0 8px' }}>Point-in-time year-end balance — not summed across months.</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={closingCashTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}
              onClick={(d: { activePayload?: { payload: { yearNum?: number } }[] }) => {
                const y = d?.activePayload?.[0]?.payload?.yearNum;
                if (y != null) onYearSelect?.(y);
              }}
              style={{ cursor: onYearSelect ? 'pointer' : 'default' }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} {...CFO_TT} />
              <Line type="monotone" dataKey="closingCash" stroke="#2F80ED" strokeWidth={2} dot={{ r: 4 }} name="Closing Cash" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FFFFFF', border: '0.5px solid #E8E9ED', borderRadius: 8, padding: 16 }} className="lg:col-span-2">
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>CF Category Comparison</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={cfCompare} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
              <XAxis dataKey="year" tick={{ fontSize: 9 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} {...CFO_TT} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Operating" fill="#78716C" />
              <Bar dataKey="Investing" fill="#166534" />
              <Bar dataKey="Financing" fill="#5B5FEF" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
