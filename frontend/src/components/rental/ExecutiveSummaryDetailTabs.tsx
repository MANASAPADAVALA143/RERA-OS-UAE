import React, { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import type { LoanRow, PortfolioSummary, UnitRow } from '../../hooks/useRentalCfoData';
import type { FinRow } from '../../utils/executiveSummaryFinRows';
import type { ParsedFinancials } from '../../utils/rentalKpiEngine';
import { unionYears } from '../../utils/cfoMultiYearTrendData';
import CfoMultiYearTrendCharts from './CfoMultiYearTrendCharts';

interface ArMonth { month: string; billed: number; collected: number; }

const P = {
  pageBg: '#F7F1E6', cardBg: '#FBF6EE', border: '#E8DEC8',
  gold: '#D4AF37', text: '#1C1917', muted: '#78716C',
  green: '#15803D', amber: '#F2C14E', red: '#C0392B', teal: '#0F766E',
} as const;

const CARD: React.CSSProperties = {
  background: P.cardBg, border: `1px solid ${P.border}`,
  borderRadius: 12, padding: '20px 24px',
};

const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthSortKey(m: string): number {
  const [mon, yr] = m.split(/[\s-]/);
  return (Number(yr) || 0) * 100 + (MNAMES.indexOf(mon) + 1);
}

function fmt(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function pct(v: number, d = 1): string { return `${v.toFixed(d)}%`; }

function KpiTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const display = value === '—' ? 'Not available' : value;
  return (
    <div style={{ ...CARD, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: display === 'Not available' ? P.muted : (color ?? P.text), fontVariantNumeric: 'tabular-nums lining-nums' }}>{display}</div>
      {sub && <div style={{ fontSize: 12, color: P.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>{children}</div>
  );
}

function NA({ msg = 'Not available — data not yet configured' }: { msg?: string }) {
  return (
    <div style={{ ...CARD, textAlign: 'center', padding: '40px 24px', color: P.muted, fontSize: 13 }}>{msg}</div>
  );
}

function yFmt(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// TAB 2 ΓÇô INCOME STATEMENT
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
const REVENUE_CATS = new Set(['rental income', 'services', 'other income', 'income']);

function isRevenueLine(row: FinRow): boolean {
  const cat = (row.category ?? '').toLowerCase();
  const acct = row.account.toLowerCase();
  if (REVENUE_CATS.has(cat)) return true;
  if (acct.startsWith('rent') || acct.includes('rental income')) return true;
  return false;
}

export function IncomeStatementTab({
  finRows,
  arData,
  activeFins = [],
}: {
  finRows: FinRow[];
  arData: ArMonth[];
  activeFins?: ParsedFinancials[];
}) {
  const dataRows = finRows.filter(r => !r.isSectionHeader && !r.isTotal);

  const monthlyAgg = useMemo(() => {
    const map = new Map<string, { revenue: number; expenses: number }>();
    for (const r of dataRows) {
      if (!map.has(r.month)) map.set(r.month, { revenue: 0, expenses: 0 });
      const entry = map.get(r.month)!;
      if (isRevenueLine(r)) entry.revenue += r.amount;
      else entry.expenses += Math.abs(r.amount);
    }
    return [...map.entries()]
      .sort((a, b) => monthSortKey(a[0]) - monthSortKey(b[0]))
      .map(([month, v]) => ({
        month: month.split(' ')[0],
        revenue: v.revenue || 0,
        expenses: v.expenses || 0,
        noi: v.revenue - v.expenses,
      }));
  }, [dataRows]);

  // Fallback: use AR data for revenue if no P&L
  const chartData = useMemo(() => {
    if (monthlyAgg.length > 0) return monthlyAgg;
    return [...arData]
      .sort((a, b) => monthSortKey(a.month) - monthSortKey(b.month))
      .map(d => ({ month: d.month.split(' ')[0], revenue: d.billed, expenses: 0, noi: d.billed }));
  }, [monthlyAgg, arData]);

  // Latest month summary
  const latest = chartData[chartData.length - 1];

  // Category breakdown from P&L
  const catBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of dataRows) {
      if (isRevenueLine(r)) continue;
      const cat = r.category || 'Other';
      map.set(cat, (map.get(cat) ?? 0) + Math.abs(r.amount));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [dataRows]);

  const DONUT_COLORS = [P.gold, P.teal, P.green, P.red, P.amber, '#8B7355', '#A0937D', '#C4A882'];

  const expensePieYear = useMemo(() => {
    const years = unionYears(activeFins);
    return years[years.length - 1];
  }, [activeFins]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary KPIs */}
      {latest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <KpiTile label="Revenue (Latest Month)" value={fmt(latest.revenue)} color={P.green} />
          <KpiTile label="Expenses (Latest Month)" value={fmt(latest.expenses)} color={P.red} />
          <KpiTile label="NOI (Latest Month)" value={fmt(latest.noi)} color={latest.noi >= 0 ? P.green : P.red} />
        </div>
      )}

      {/* Revenue + NOI trend */}
      <div style={CARD}>
        <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 16 }}>
          Monthly Revenue &amp; NOI
          {monthlyAgg.length === 0 && <span style={{ fontSize: 11, color: P.muted, marginLeft: 8 }}>Showing billed AR as revenue proxy</span>}
        </div>
        {chartData.length === 0 ? <NA msg="Upload P&L financials to see income statement trend" /> : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: P.muted }}
                interval={chartData.length > 18 ? 5 : chartData.length > 12 ? 2 : 0} />
              <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: P.muted }} width={64} />
              <Tooltip
                contentStyle={{ background: P.cardBg, border: `1px solid ${P.border}`, borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, n: string) => [fmt(v), n]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" name="Revenue" fill={`${P.teal}80`} radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill={`${P.red}60`} radius={[3, 3, 0, 0]} />
              <Line dataKey="noi" name="NOI" stroke={P.gold} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Expense category breakdown */}
      {catBreakdown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={CARD}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 16 }}>Expense Categories</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {catBreakdown.map(([cat, amt], i) => {
                const total = catBreakdown.reduce((s, [, a]) => s + a, 0);
                const w = total > 0 ? (amt / total) * 100 : 0;
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: P.text, marginBottom: 3 }}>
                      <span>{cat}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtK(amt)}</span>
                    </div>
                    <div style={{ height: 6, background: P.border, borderRadius: 3 }}>
                      <div style={{ height: '100%', width: `${w}%`, background: DONUT_COLORS[i % DONUT_COLORS.length], borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={CARD}>
            <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 16 }}>Cost Structure</div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={catBreakdown.map(([name, value]) => ({ name, value }))}
                  dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                  label={({ name, percent }) => `${name.slice(0, 12)} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {catBreakdown.map((_, i) => (
                    <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: P.cardBg, border: `1px solid ${P.border}`, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {catBreakdown.length === 0 && chartData.length > 0 && (
        <NA msg="Upload categorized P&L data to see expense breakdown" />
      )}

      {activeFins.length > 0 && (
        <>
          <SectionTitle>Multi-Year Income Statement Trends</SectionTitle>
          <CfoMultiYearTrendCharts
            fins={activeFins}
            selectedYear={expensePieYear}
            enableDrill={activeFins.length === 1}
            showPeriodNote
          />
        </>
      )}
    </div>
  );
}

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// TAB 3 ΓÇô BALANCE SHEET
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
export function BalanceSheetTab({
  loans, arData,
}: {
  loans: LoanRow[];
  arData: ArMonth[];
}) {
  const totalDebt = loans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);

  // AR outstanding as proxy for receivables
  const arOutstanding = useMemo(() => {
    if (!arData.length) return 0;
    const sorted = [...arData].sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
    const m = sorted[0];
    return Math.max(0, m.billed - m.collected);
  }, [arData]);

  const assetData = [
    { name: 'Accounts Receivable', value: arOutstanding },
    ...(arOutstanding === 0 ? [] : []),
  ].filter(d => d.value > 0);

  const capitalData = totalDebt > 0
    ? [{ name: 'Total Debt', value: totalDebt }]
    : [];

  const COLORS = [P.teal, P.gold, P.green, P.red];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ ...CARD, background: `${P.amber}22`, border: `1px solid ${P.amber}` }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={16} color={P.amber} style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: P.text }}>
            <strong>Estimated data only.</strong> Cash, property valuations, and equity are not tracked in the current system.
            Items below are sourced from available data (AR summary and Loan Tracker). A full balance sheet requires linking a GL system.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <KpiTile label="Accounts Receivable (Est.)" value={arOutstanding > 0 ? fmt(arOutstanding) : 'ΓÇö'} sub="Latest month billed ΓêÆ collected" />
        <KpiTile label="Total Debt" value={totalDebt > 0 ? fmt(totalDebt) : 'ΓÇö'} color={P.red} sub={`${loans.length} loan${loans.length !== 1 ? 's' : ''}`} />
        <KpiTile label="Cash / Property Value" value="Not available" color={P.muted} sub="Link GL to populate" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>Asset Composition</div>
          {assetData.length === 0 ? (
            <NA msg="No asset data available ΓÇö upload AR data to see receivables" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={assetData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {assetData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: P.cardBg, border: `1px solid ${P.border}`, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>Capital Structure</div>
          {capitalData.length === 0 ? (
            <NA msg="No loan data available" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={capitalData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={({ name }) => name} labelLine={false}>
                    {capitalData.map((_, i) => <Cell key={i} fill={[P.red, P.teal][i]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: P.cardBg, border: `1px solid ${P.border}`, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ fontSize: 11, color: P.muted, textAlign: 'center', marginTop: 4 }}>
                * Equity not tracked ΓÇö only debt shown. Link GL for complete capital structure.
              </div>
            </>
          )}
        </div>
      </div>

      {/* Loan detail table */}
      {loans.length > 0 && (
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 16 }}>Loan Detail</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${P.border}` }}>
                {['Property / Entity', 'Balance', 'Rate', 'EMI / mo', 'Maturity'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, color: P.muted, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loans.map((l, i) => {
                const rate = (l.loan_interest_rate ?? 0) * 100;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${P.border}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{(l as any).company_name ?? `Loan ${i + 1}`}</td>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{fmtK(l.loan_balance_as_of ?? 0)}</td>
                    <td style={{ padding: '8px 10px', color: rate > 6.5 ? P.red : P.text }}>{pct(rate)}</td>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{l.loan_emi ? fmtK(l.loan_emi) : 'ΓÇö'}</td>
                    <td style={{ padding: '8px 10px', color: P.muted }}>{l.loan_maturity_date ?? 'ΓÇö'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// TAB 4 ΓÇô CASH FLOW
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
export function CashFlowTab({
  loans, arData, finRows,
}: {
  loans: LoanRow[];
  arData: ArMonth[];
  finRows: FinRow[];
}) {
  const monthlyEmi = useMemo(() => loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0), [loans]);

  // Net income from P&L (latest month)
  const latestNoi = useMemo(() => {
    const dataRows = finRows.filter(r => !r.isSectionHeader && !r.isTotal);
    const months = [...new Set(dataRows.map(r => r.month))].sort((a, b) => monthSortKey(b) - monthSortKey(a));
    if (!months.length) return null;
    const m = months[0];
    const mRows = dataRows.filter(r => r.month === m);
    let rev = 0; let exp = 0;
    for (const r of mRows) {
      if (isRevenueLine(r)) rev += r.amount;
      else exp += Math.abs(r.amount);
    }
    return { month: m, revenue: rev, expenses: exp, noi: rev - exp };
  }, [finRows]);

  // AR collected trend = operating cash proxy
  const cfTrend = useMemo(() => {
    return [...arData]
      .sort((a, b) => monthSortKey(a.month) - monthSortKey(b.month))
      .slice(-12)
      .map(d => ({
        month: d.month.split(' ')[0],
        operating: d.collected,   // Actual collected = real cash in
        financing: -monthlyEmi,   // EMI payments (estimated)
        net: d.collected - monthlyEmi,
      }));
  }, [arData, monthlyEmi]);

  const latestCf = cfTrend[cfTrend.length - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ ...CARD, background: `${P.teal}18`, border: `1px solid ${P.teal}40` }}>
        <div style={{ fontSize: 13, color: P.text }}>
          <strong>Data labeling:</strong> Operating CF uses <em>actual collected rent</em> from AR records.
          Financing CF uses <em>estimated EMI</em> from Loan Tracker (actual disbursements not tracked).
          Investing activities are <strong>not available</strong> ΓÇö no capital expenditure tracking in the current system.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KpiTile
          label="Operating CF (Latest ┬╖ Actual)"
          value={latestCf ? fmt(latestCf.operating) : 'ΓÇö'}
          sub="Collected rent ┬╖ actual"
          color={P.green}
        />
        <KpiTile
          label="Financing CF (Estimated)"
          value={monthlyEmi > 0 ? fmt(-monthlyEmi) : 'ΓÇö'}
          sub="Monthly EMI outflow ┬╖ estimated"
          color={P.red}
        />
        <KpiTile
          label="Investing CF"
          value="Not available"
          sub="Link CapEx tracking to populate"
          color={P.muted}
        />
      </div>

      <div style={CARD}>
        <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 4 }}>
          Operating vs Financing ΓÇö Last 12 Months
        </div>
        <div style={{ fontSize: 11, color: P.muted, marginBottom: 16 }}>
          Operating = actual collected ┬╖ Financing = estimated EMI ┬╖ Net = Operating + Financing
        </div>
        {cfTrend.length === 0 ? <NA msg="No AR data available" /> : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={cfTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: P.muted }} />
              <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: P.muted }} width={64} />
              <Tooltip
                contentStyle={{ background: P.cardBg, border: `1px solid ${P.border}`, borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, n: string) => [fmt(v), n]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="operating" name="Operating (Actual)" fill={`${P.teal}80`} radius={[3, 3, 0, 0]} />
              <Bar dataKey="financing" name="Financing (Est.)" fill={`${P.red}60`} radius={[3, 3, 0, 0]} />
              <Line dataKey="net" name="Net Cash Flow" stroke={P.gold} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {latestNoi && (
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 12 }}>P&amp;L ΓåÆ NOI Bridge (Latest: {latestNoi.month})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Revenue', value: latestNoi.revenue, color: P.green },
              { label: 'Operating Expenses', value: -latestNoi.expenses, color: P.red },
              { label: 'Net Operating Income', value: latestNoi.noi, color: latestNoi.noi >= 0 ? P.green : P.red, bold: true },
              { label: 'Financing Outflows (EMI ┬╖ Est.)', value: -monthlyEmi, color: P.amber },
              { label: 'Estimated Free Cash Flow', value: latestNoi.noi - monthlyEmi, color: (latestNoi.noi - monthlyEmi) >= 0 ? P.green : P.red, bold: true },
            ].map((row, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', background: i % 2 === 0 ? P.pageBg : 'transparent', borderRadius: 6 }}>
                <span style={{ fontSize: 13, fontWeight: row.bold ? 700 : 400, color: P.text }}>{row.label}</span>
                <span style={{ fontSize: 14, fontWeight: row.bold ? 700 : 600, color: row.color, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(row.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
// TAB 5 ΓÇô ACTION PLAN
// ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
const MARKET_RATE = 0.065;

interface Flag {
  severity: 'critical' | 'warning' | 'ok';
  title: string;
  detail: string;
  metric: string;
  target: string;
}

function FlagCard({ flag }: { flag: Flag }) {
  const colors = {
    critical: { bg: `${P.red}18`, border: P.red, icon: <AlertTriangle size={16} color={P.red} /> },
    warning:  { bg: `${P.amber}22`, border: P.amber, icon: <AlertTriangle size={16} color={P.amber} /> },
    ok:       { bg: `${P.green}18`, border: P.green, icon: <CheckCircle size={16} color={P.green} /> },
  }[flag.severity];

  return (
    <div style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
        {colors.icon}
        <div style={{ fontSize: 14, fontWeight: 700, color: P.text }}>{flag.title}</div>
      </div>
      <div style={{ fontSize: 13, color: P.text, marginBottom: 8, paddingLeft: 26 }}>{flag.detail}</div>
      <div style={{ display: 'flex', gap: 16, paddingLeft: 26 }}>
        <span style={{ fontSize: 11, color: P.muted }}>Current: <strong style={{ color: P.text }}>{flag.metric}</strong></span>
        <span style={{ fontSize: 11, color: P.muted }}>Target: <strong style={{ color: P.text }}>{flag.target}</strong></span>
      </div>
    </div>
  );
}

export function ActionPlanTab({
  portfolio, loans, arData, units,
}: {
  portfolio: PortfolioSummary | null;
  loans: LoanRow[];
  arData: ArMonth[];
  units: UnitRow[];
}) {
  const occupancy = (portfolio?.occupancy_pct ?? 0) * 100;
  const totalBilled = arData.reduce((s, r) => s + r.billed, 0);
  const totalCollected = arData.reduce((s, r) => s + r.collected, 0);
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;
  const realizationRate = collectionRate; // same metric

  const aboveMarketLoans = loans.filter(l => (l.loan_interest_rate ?? 0) > MARKET_RATE);
  const monthlyEmi = loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0);
  const noi = portfolio?.noi_this_month ?? 0;
  const dscr = monthlyEmi > 0 && noi > 0 ? (noi / 12) / monthlyEmi : null;

  // Vacancy days proxy from units
  const vacantUnits = units.filter((u: any) => (u.status ?? '').toLowerCase().includes('vacant'));
  const avgDaysVacant = vacantUnits.length > 0
    ? vacantUnits.reduce((s: number, u: any) => s + (u.days_vacant ?? 30), 0) / vacantUnits.length
    : null;

  const flags: Flag[] = [];

  if (occupancy > 0 && occupancy < 75) {
    flags.push({ severity: 'critical', title: 'Low Occupancy Alert', metric: pct(occupancy), target: 'ΓëÑ 95%',
      detail: 'Occupancy is critically low. Review vacant unit marketing, pricing, and lease conversion pipeline immediately.' });
  } else if (occupancy > 0 && occupancy < 95) {
    flags.push({ severity: 'warning', title: 'Occupancy Below Target', metric: pct(occupancy), target: 'ΓëÑ 95%',
      detail: 'Occupancy is below target. Consider incentive programs or pricing adjustments for vacant units.' });
  } else if (occupancy >= 95) {
    flags.push({ severity: 'ok', title: 'Occupancy on Target', metric: pct(occupancy), target: 'ΓëÑ 95%',
      detail: 'Portfolio occupancy is healthy and above the target threshold.' });
  }

  if (collectionRate > 0 && collectionRate < 95) {
    flags.push({ severity: collectionRate < 80 ? 'critical' : 'warning', title: 'Collection Rate Below Target',
      metric: pct(collectionRate), target: 'ΓëÑ 95%',
      detail: 'Rent collection is lagging. Follow up on outstanding AR and consider security deposit policy review.' });
  } else if (collectionRate >= 95) {
    flags.push({ severity: 'ok', title: 'Collection Rate on Target', metric: pct(collectionRate), target: 'ΓëÑ 95%',
      detail: 'Collection rate is healthy.' });
  }

  if (aboveMarketLoans.length > 0) {
    flags.push({ severity: 'warning', title: 'Refinancing Opportunity',
      metric: `${aboveMarketLoans.length} loan${aboveMarketLoans.length !== 1 ? 's' : ''} above ${pct(MARKET_RATE * 100)}`,
      target: `Γëñ ${pct(MARKET_RATE * 100)}`,
      detail: `${aboveMarketLoans.map(l => `${(l as any).company_name ?? 'Loan'} @ ${pct((l.loan_interest_rate ?? 0) * 100)}`).join(', ')}. Consider refinancing at current market rates.` });
  }

  if (dscr !== null && dscr < 1.25) {
    flags.push({ severity: dscr < 1.0 ? 'critical' : 'warning', title: 'DSCR Below Threshold',
      metric: `${dscr.toFixed(2)}x`, target: 'ΓëÑ 1.25x',
      detail: dscr < 1.0
        ? 'NOI does not cover debt service. Cash flow is negative after loan payments ΓÇö immediate action required.'
        : 'DSCR is below the lender-standard 1.25x threshold. Reduce expenses or increase revenue to improve coverage.' });
  }

  if (avgDaysVacant !== null && avgDaysVacant > 45) {
    flags.push({ severity: 'warning', title: 'High Average Days Vacant',
      metric: `${avgDaysVacant.toFixed(0)} days`, target: 'Γëñ 30 days',
      detail: 'Vacant units are sitting longer than the target threshold, increasing effective vacancy cost.' });
  }

  const critical = flags.filter(f => f.severity === 'critical');
  const warnings = flags.filter(f => f.severity === 'warning');
  const oks = flags.filter(f => f.severity === 'ok');

  const metrics = [
    { label: 'Occupancy Rate', value: occupancy > 0 ? pct(occupancy) : 'ΓÇö', target: 'ΓëÑ 95%', ok: occupancy >= 95 },
    { label: 'Collection Rate', value: collectionRate > 0 ? pct(collectionRate) : 'ΓÇö', target: 'ΓëÑ 95%', ok: collectionRate >= 95 },
    { label: 'Realization Rate', value: realizationRate > 0 ? pct(realizationRate) : 'ΓÇö', target: 'ΓëÑ 95%', ok: realizationRate >= 95 },
    { label: 'DSCR', value: dscr !== null ? `${dscr.toFixed(2)}x` : 'ΓÇö', target: 'ΓëÑ 1.25x', ok: (dscr ?? 0) >= 1.25 },
    { label: 'Avg Days Vacant', value: avgDaysVacant !== null ? `${avgDaysVacant.toFixed(0)} days` : 'ΓÇö', target: 'Γëñ 30 days', ok: (avgDaysVacant ?? 0) <= 30 },
    { label: 'Loans Above Market Rate', value: `${aboveMarketLoans.length} of ${loans.length}`, target: '0', ok: aboveMarketLoans.length === 0 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Health scorecard */}
      <div style={CARD}>
        <SectionTitle>Portfolio Health Metrics</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {metrics.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 14px', background: P.pageBg, borderRadius: 8, border: `1px solid ${P.border}` }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: m.value === 'ΓÇö' ? P.muted : (m.ok ? P.green : P.red), fontVariantNumeric: 'tabular-nums' }}>
                  {m.value}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: P.muted }}>Target</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: P.muted }}>{m.target}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Flags */}
      {critical.length > 0 && (
        <div>
          <SectionTitle>Critical ΓÇö Immediate Action Required</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {critical.map((f, i) => <FlagCard key={i} flag={f} />)}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div>
          <SectionTitle>Warnings ΓÇö Review Recommended</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {warnings.map((f, i) => <FlagCard key={i} flag={f} />)}
          </div>
        </div>
      )}

      {oks.length > 0 && (
        <div>
          <SectionTitle>On Track</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {oks.map((f, i) => <FlagCard key={i} flag={f} />)}
          </div>
        </div>
      )}

      {flags.length === 0 && (
        <div style={{ ...CARD, textAlign: 'center', padding: '40px 24px' }}>
          <CheckCircle size={32} color={P.green} style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: P.text }}>No action items ΓÇö upload data to generate flags</div>
          <div style={{ fontSize: 13, color: P.muted, marginTop: 4 }}>
            Upload AR data, P&L financials, and configure loans to see rule-based recommendations.
          </div>
        </div>
      )}
    </div>
  );
}