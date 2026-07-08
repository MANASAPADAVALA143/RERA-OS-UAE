import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { FinItem, ParsedFinancials } from '../../utils/rentalKpiEngine';
import {
  buildYearSnapshots,
  expensePieFromKpi,
  unionYears,
} from '../../utils/cfoMultiYearTrendData';

const CFO_TT = {
  contentStyle: { background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13, color: '#1C1917' },
  labelStyle: { color: '#57534E', fontWeight: 600, fontSize: 13 },
  itemStyle: { color: '#1C1917', fontSize: 13 },
};

const PIE_COLORS = ['#D4AF37', '#C0392B', '#166534', '#F2994A', '#8B6914', '#A8A29E', '#C08B40', '#78716C'];

const OPEX_LINE_PATTERNS: Record<string, RegExp> = {
  'Management Fee': /management\s+fee/i,
  Interest: /interest\s+on\s+loan|interest\s+paid|^interest$/i,
  'Property Tax': /property\s+tax|rates\s+&\s+taxes/i,
  Repairs: /repair|maintenance|cleaning/i,
  Utilities: /utilities|electricity|internet|water/i,
  'HOA Fees': /^hoa/i,
  'Legal Fees': /legal|accounting\s+fee/i,
};

const PIE_TO_OPEX_KEY: Record<string, string> = {
  'Interest Paid': 'Interest',
  'Property Tax': 'Property Tax',
  'HOA Fees': 'HOA Fees',
  'Legal Fees': 'Legal Fees',
  'Mgmt Fee': 'Management Fee',
  Utilities: 'Utilities',
  Repairs: 'Repairs',
  Other: 'Other',
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

function plLinesForDrill(
  pl: FinItem[],
  pattern: RegExp,
  useAnnualYear: number,
): { label: string; amount: number }[] {
  return pl
    .filter(i => !i.isSectionHeader && !i.isTotal && !i.isNetIncome && pattern.test(i.label))
    .map(i => ({ label: i.label, amount: Math.abs(i.values[useAnnualYear] ?? 0) }))
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

function DrillPanel({
  title, rows, onClear,
}: {
  title: string;
  rows: { label: string; amount: number }[];
  onClear: () => void;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '14px 16px', marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#92400E', margin: 0 }}>{title}</p>
        <button type="button" onClick={onClear} style={{ fontSize: 12, color: '#D4AF37', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', padding: 0 }}>
          × clear drill-down
        </button>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#A8A29E' }}>No matching P&amp;L line items for this selection.</p>
      ) : (
        <table className="w-full" style={{ fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(253,230,138,0.4)' }}>
                <td style={{ padding: '6px 8px', color: '#57534E' }}>{r.label}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmtFull(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ padding: '8px 8px', fontWeight: 700, color: '#92400E' }}>Total</td>
              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: '#92400E' }}>{fmtFull(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

export interface CfoMultiYearTrendChartsProps {
  fins: ParsedFinancials[];
  /** FY year for expense pie — defaults to latest uploaded year. */
  selectedYear?: number;
  onYearSelect?: (year: number) => void;
  enableDrill?: boolean;
  showPeriodNote?: boolean;
}

export default function CfoMultiYearTrendCharts({
  fins,
  selectedYear: selectedYearProp,
  onYearSelect,
  enableDrill = false,
  showPeriodNote = false,
}: CfoMultiYearTrendChartsProps) {
  const [drillAnnualCat, setDrillAnnualCat] = useState<string | null>(null);
  const snapshots = useMemo(() => buildYearSnapshots(fins), [fins]);
  const years = useMemo(() => unionYears(fins), [fins]);
  const selectedYear = selectedYearProp ?? years[years.length - 1] ?? new Date().getFullYear();
  const selectedSnapshot = snapshots.find(r => r.year === selectedYear) ?? snapshots[snapshots.length - 1];
  const expPie = selectedSnapshot ? expensePieFromKpi(selectedSnapshot.kpi) : [];
  const drillFin = enableDrill && fins.length === 1 ? fins[0] : null;

  const niTrajectory = snapshots.map(r => ({ year: String(r.year), netIncome: r.netIncome }));
  const expRatioTrend = snapshots.map(r => ({ year: String(r.year), ratio: r.revenue > 0 ? (r.expenses / r.revenue) * 100 : 0 }));
  const revExpCombo = snapshots.map(r => ({ year: String(r.year), Revenue: r.revenue, Expenses: r.expenses }));
  const cashTrend = snapshots.map(r => ({ year: String(r.year), cash: r.cash }));
  const revChart = snapshots.map(r => ({
    year: String(r.year),
    'Rental Income': r.rentalIncome,
    'Other Income': r.otherIncome,
    Services: r.services,
  }));

  if (!snapshots.length) {
    return (
      <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '32px 24px', textAlign: 'center', color: '#78716C', fontSize: 13 }}>
        Upload P&amp;L financials to see multi-year income statement trends.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {showPeriodNote && (
        <p style={{ fontSize: 12, color: '#78716C', margin: 0 }}>
          Annual FY trends across all uploaded years — not affected by the MoM / YTD / TTM period filter above.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Net Income Trajectory</p>
          {onYearSelect && <p className="cfo-chart-hint" style={{ fontSize: 11, color: '#A8A29E', margin: '0 0 8px' }}>Click a point to jump to that year</p>}
          <ResponsiveContainer width="100%" height={210}>
            <LineChart
              data={niTrajectory}
              margin={{ left: 0, right: 10, top: 5, bottom: 5 }}
              onClick={(d: { activeLabel?: string }) => {
                const y = parseInt(String(d?.activeLabel ?? ''), 10);
                if (!isNaN(y)) onYearSelect?.(y);
              }}
              style={{ cursor: onYearSelect ? 'pointer' : 'default' }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#78716C' }} />
              <YAxis tick={{ fontSize: 11, fill: '#78716C' }} tickFormatter={v => fmt(v as number)} />
              <Tooltip formatter={(v: number) => [fmtFull(v), 'Net Income']} {...CFO_TT} />
              <Line type="monotone" dataKey="netIncome" stroke="#22C55E" strokeWidth={2} dot={{ fill: '#22C55E', r: 4 }} activeDot={{ r: 6, fill: '#22C55E' }} name="Net Income" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Expense Ratio Trend</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={expRatioTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${(v as number).toFixed(0)}%`} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line type="monotone" dataKey="ratio" stroke="#F59E0B" strokeWidth={2} dot={{ fill: '#F59E0B', r: 4 }} activeDot={{ r: 6, fill: '#F59E0B' }} name="Expense %" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Revenue vs Expenses</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={revExpCombo} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmt(v as number)} />
              <Tooltip formatter={(v: number) => fmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Cash Balance Trend (Bank Accounts)</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={cashTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmt(v as number)} />
              <Tooltip formatter={(v: number) => fmtFull(v)} />
              <Line type="monotone" dataKey="cash" stroke="#8B5CF6" strokeWidth={2} dot={{ fill: '#8B5CF6', r: 4 }} activeDot={{ r: 6, fill: '#8B5CF6' }} name="Cash" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Revenue Breakdown by Year</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={revChart} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Rental Income" stackId="a" fill="#D4AF37" />
              <Bar dataKey="Other Income" stackId="a" fill="#B8860B" />
              <Bar dataKey="Services" stackId="a" fill="#8B6914" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Expense Breakdown ({selectedYear})</p>
          {enableDrill && <p className="cfo-chart-hint" style={{ fontSize: 11, color: '#A8A29E', margin: '0 0 8px' }}>Click a segment to drill into P&amp;L expense lines</p>}
          {drillAnnualCat && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: '#D4AF37', color: '#fff' }}>{drillAnnualCat}</span>
              <button type="button" onClick={() => setDrillAnnualCat(null)} style={{ fontSize: 12, color: '#A8A29E', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>× clear</button>
            </div>
          )}
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie
                data={expPie}
                cx="50%"
                cy="50%"
                outerRadius={75}
                dataKey="value"
                onClick={enableDrill ? (d) => setDrillAnnualCat(prev => prev === d.name ? null : String(d.name)) : undefined}
                style={{ cursor: enableDrill ? 'pointer' : 'default' }}
              >
                {expPie.map((e, i) => (
                  <Cell
                    key={i}
                    fill={PIE_COLORS[i % PIE_COLORS.length]}
                    opacity={drillAnnualCat && drillAnnualCat !== e.name ? 0.35 : 1}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(v: number, name: string) => [fmtFull(v), name]} {...CFO_TT} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12, color: '#57534E' }} />
            </PieChart>
          </ResponsiveContainer>
          {drillFin && drillAnnualCat && (
            <DrillPanel
              title={`Expense drill-down · ${drillAnnualCat} (${selectedYear})`}
              rows={plLinesForDrill(
                drillFin.pl,
                OPEX_LINE_PATTERNS[PIE_TO_OPEX_KEY[drillAnnualCat] ?? drillAnnualCat] ?? /expense|fee|cost|repair|utility|tax|interest|insurance|depreciation/i,
                selectedYear,
              )}
              onClear={() => setDrillAnnualCat(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
