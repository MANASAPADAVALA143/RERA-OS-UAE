import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { AlertTriangle, CheckCircle, TrendingUp, Download } from 'lucide-react';
import PeriodToggle from '../components/shared/PeriodToggle';
import ExecSummaryExportModal from '../components/rental/ExecSummaryExportModal';
import { type Period, getPeriodKeys } from '../utils/periodWindow';
import { useRentalCfoData } from '../hooks/useRentalCfoData';

// ─── palette ─────────────────────────────────────────────────────────────────
const P = {
  pageBg: '#F7F1E6', cardBg: '#FBF6EE', border: '#E8DEC8',
  gold: '#D4AF37', text: '#1C1917', muted: '#78716C',
  green: '#15803D', amber: '#F2C14E', red: '#C0392B', teal: '#0F766E',
} as const;

const CARD: React.CSSProperties = {
  background: P.cardBg, border: `1px solid ${P.border}`,
  borderRadius: 12, padding: '20px 24px',
};

// ─── helpers ─────────────────────────────────────────────────────────────────
const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function monthSortKey(m: string): number {
  const [mon, yr] = m.split(' ');
  return (Number(yr) || 0) * 100 + (MNAMES.indexOf(mon) + 1);
}

function fmt(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v);
}

function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function pct(v: number, d = 1): string { return `${v.toFixed(d)}%`; }

// ─── interfaces ──────────────────────────────────────────────────────────────
interface FinRow {
  month: string; account: string; amount: number;
  category?: string; isSectionHeader?: boolean;
  isTotal?: boolean; children?: unknown[];
}

interface ArMonth { month: string; billed: number; collected: number; }
interface OwnerRow {
  partner_name: string; total_noi_share: number;
  holdings: { company_name: string; ownership_pct: number; noi_share: number }[];
}

// ─── KPI tile ────────────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{ ...CARD, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? P.text, fontVariantNumeric: 'tabular-nums lining-nums' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: P.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── section heading ─────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>
      {children}
    </div>
  );
}

function NA({ msg = 'Not available — data not yet configured' }: { msg?: string }) {
  return (
    <div style={{ ...CARD, textAlign: 'center', padding: '40px 24px', color: P.muted, fontSize: 13 }}>
      {msg}
    </div>
  );
}

// ─── Y-axis compact formatter ─────────────────────────────────────────────────
function yFmt(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 – EXECUTIVE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function Tab1({
  portfolio, loans, arData, ownership, companies,
  period, month, year,
}: {
  portfolio: ReturnType<typeof useRentalCfoData>['portfolio'];
  loans: ReturnType<typeof useRentalCfoData>['loans'];
  arData: ArMonth[];
  ownership: OwnerRow[];
  companies: ReturnType<typeof useRentalCfoData>['companies'];
  period: Period | null; month: number; year: number;
}) {
  // Revenue KPIs
  const grossRevenue = portfolio?.gross_potential_rent ?? 0;
  const totalCollected = portfolio?.collected_this_month ?? 0;
  const noi = portfolio?.noi_this_month ?? 0;
  const occupancy = portfolio?.occupancy_pct ?? 0;
  const vacancyLoss = portfolio?.vacancy_loss ?? 0;
  const totalExpenses = portfolio?.total_expense_this_month ?? 0;

  // AR outstanding = latest month billed - collected
  const latestAr = useMemo(() => {
    if (!arData.length) return 0;
    const sorted = [...arData].sort((a, b) => monthSortKey(b.month) - monthSortKey(a.month));
    const m = sorted[0];
    return Math.max(0, m.billed - m.collected);
  }, [arData]);

  // Collection rate = avg collected/billed over trend
  const collectionRate = useMemo(() => {
    if (!arData.length) return 0;
    const totalB = arData.reduce((s, r) => s + r.billed, 0);
    const totalC = arData.reduce((s, r) => s + r.collected, 0);
    return totalB > 0 ? (totalC / totalB) * 100 : 0;
  }, [arData]);

  // Debt summary
  const totalDebt = useMemo(() => loans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0), [loans]);
  const avgRate = useMemo(() => {
    if (!loans.length) return 0;
    return loans.reduce((s, l) => s + (l.loan_interest_rate ?? 0), 0) / loans.length;
  }, [loans]);
  const nextMaturity = useMemo(() => {
    const dates = loans
      .filter(l => l.loan_maturity_date)
      .map(l => l.loan_maturity_date as string)
      .sort();
    return dates[0] ?? null;
  }, [loans]);

  // Partner distributions
  const totalPartnerNoi = useMemo(() => ownership.reduce((s, o) => s + o.total_noi_share, 0), [ownership]);
  const partnerSub = useMemo(() => {
    if (!ownership.length) return '';
    return ownership.slice(0, 2).map(o => `${o.partner_name}: ${fmt(o.total_noi_share)}`).join(' · ');
  }, [ownership]);

  // Trend chart: Revenue vs Expenses
  const trendData = useMemo(() => {
    const sorted = [...arData].sort((a, b) => monthSortKey(a.month) - monthSortKey(b.month));
    return sorted.map(d => ({
      month: d.month.split(' ')[0],
      billed: d.billed,
      collected: d.collected,
    }));
  }, [arData]);

  const collRateColor = collectionRate >= 95 ? P.green : collectionRate >= 80 ? P.amber : P.red;
  const occColor = occupancy >= 95 ? P.green : occupancy >= 75 ? P.amber : P.red;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Row 1 – Revenue KPIs */}
      <div>
        <SectionTitle>Revenue &amp; Performance</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <KpiTile label="Gross Potential Rent" value={grossRevenue > 0 ? fmt(grossRevenue) : '—'} />
          <KpiTile label="Total Collected" value={totalCollected > 0 ? fmt(totalCollected) : '—'} color={P.green} />
          <KpiTile label="Net Operating Income" value={noi !== 0 ? fmt(noi) : '—'} color={noi > 0 ? P.green : P.red} />
          <KpiTile label="Occupancy Rate" value={occupancy > 0 ? pct(occupancy) : '—'} color={occColor} sub={occupancy > 0 ? `Target ≥ 95%` : undefined} />
          <KpiTile label="Vacancy Loss" value={vacancyLoss > 0 ? fmt(vacancyLoss) : '—'} color={vacancyLoss > 0 ? P.red : P.muted} />
        </div>
      </div>

      {/* Row 2 – Risk KPIs */}
      <div>
        <SectionTitle>Risk &amp; Obligations</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <KpiTile label="Total Expenses" value={totalExpenses > 0 ? fmt(totalExpenses) : '—'} />
          <KpiTile label="AR Outstanding" value={latestAr > 0 ? fmt(latestAr) : '—'} color={P.amber} sub="Latest month gap" />
          <KpiTile label="Collection Rate" value={collectionRate > 0 ? pct(collectionRate) : '—'} color={collRateColor} sub="Avg over trend" />
          <KpiTile
            label="Total Debt"
            value={totalDebt > 0 ? fmtK(totalDebt) : '—'}
            sub={loans.length > 0 ? `Avg ${pct(avgRate * 100)} · Next maturity ${nextMaturity ?? 'N/A'}` : undefined}
          />
          <KpiTile
            label="Partner NOI Share"
            value={ownership.length > 0 ? fmt(totalPartnerNoi) : '—'}
            sub={ownership.length > 0 ? partnerSub : 'Not available'}
          />
        </div>
      </div>

      {/* Row 3 – Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Billed vs Collected trend */}
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 16 }}>Billed vs Collected Trend</div>
          {trendData.length === 0 ? (
            <div style={{ color: P.muted, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>No AR data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: P.muted }}
                  interval={trendData.length > 18 ? 5 : trendData.length > 12 ? 2 : 0} />
                <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: P.muted }} width={64} />
                <Tooltip
                  contentStyle={{ background: P.cardBg, border: `1px solid ${P.border}`, borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, n: string) => [fmt(v), n === 'billed' ? 'Billed' : 'Collected']}
                />
                <Bar dataKey="billed" name="Billed" fill={P.border} radius={[3, 3, 0, 0]} />
                <Line dataKey="collected" name="Collected" stroke={P.green} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Loan portfolio breakdown */}
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 16 }}>Loan Portfolio</div>
          {loans.length === 0 ? (
            <NA msg="No loan data available" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflowY: 'auto' }}>
              {loans.map((l, i) => {
                const bal = l.loan_balance_as_of ?? 0;
                const rate = (l.loan_interest_rate ?? 0) * 100;
                const rateColor = rate > 6.5 ? P.red : rate > 5 ? P.amber : P.green;
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', background: P.pageBg, borderRadius: 8, border: `1px solid ${P.border}` }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: P.text }}>
                        {(l as any).company_name ?? `Loan ${i + 1}`}
                      </div>
                      <div style={{ fontSize: 11, color: P.muted }}>
                        Due {l.loan_maturity_date ?? 'N/A'} · EMI {l.loan_emi ? fmtK(l.loan_emi) : 'N/A'}/mo
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: P.text, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtK(bal)}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: rateColor }}>{pct(rate)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Partner distributions */}
      {ownership.length > 0 && (
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 16 }}>Partner Distributions — NOI Share</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {ownership.map((o, i) => (
              <div key={i} style={{ padding: '14px 16px', background: P.pageBg, borderRadius: 8, border: `1px solid ${P.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: P.text }}>{o.partner_name}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: P.gold, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(o.total_noi_share)}
                </div>
                <div style={{ fontSize: 11, color: P.muted, marginTop: 4 }}>
                  {o.holdings.length} holding{o.holdings.length !== 1 ? 's' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 – INCOME STATEMENT
// ═══════════════════════════════════════════════════════════════════════════════
const REVENUE_CATS = new Set(['rental income', 'services', 'other income', 'income']);

function isRevenueLine(row: FinRow): boolean {
  const cat = (row.category ?? '').toLowerCase();
  const acct = row.account.toLowerCase();
  if (REVENUE_CATS.has(cat)) return true;
  if (acct.startsWith('rent') || acct.includes('rental income')) return true;
  return false;
}

function Tab2({ finRows, arData }: { finRows: FinRow[]; arData: ArMonth[] }) {
  const dataRows = finRows.filter(r => !r.isSectionHeader && !r.isTotal && !r.children);

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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 – BALANCE SHEET
// ═══════════════════════════════════════════════════════════════════════════════
function Tab3({
  loans, arData,
}: {
  loans: ReturnType<typeof useRentalCfoData>['loans'];
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
        <KpiTile label="Accounts Receivable (Est.)" value={arOutstanding > 0 ? fmt(arOutstanding) : '—'} sub="Latest month billed − collected" />
        <KpiTile label="Total Debt" value={totalDebt > 0 ? fmt(totalDebt) : '—'} color={P.red} sub={`${loans.length} loan${loans.length !== 1 ? 's' : ''}`} />
        <KpiTile label="Cash / Property Value" value="Not available" color={P.muted} sub="Link GL to populate" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={CARD}>
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 8 }}>Asset Composition</div>
          {assetData.length === 0 ? (
            <NA msg="No asset data available — upload AR data to see receivables" />
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
                * Equity not tracked — only debt shown. Link GL for complete capital structure.
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
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{l.loan_emi ? fmtK(l.loan_emi) : '—'}</td>
                    <td style={{ padding: '8px 10px', color: P.muted }}>{l.loan_maturity_date ?? '—'}</td>
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

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4 – CASH FLOW
// ═══════════════════════════════════════════════════════════════════════════════
function Tab4({
  loans, arData, finRows,
}: {
  loans: ReturnType<typeof useRentalCfoData>['loans'];
  arData: ArMonth[];
  finRows: FinRow[];
}) {
  const monthlyEmi = useMemo(() => loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0), [loans]);

  // Net income from P&L (latest month)
  const latestNoi = useMemo(() => {
    const dataRows = finRows.filter(r => !r.isSectionHeader && !r.isTotal && !r.children);
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
          Investing activities are <strong>not available</strong> — no capital expenditure tracking in the current system.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KpiTile
          label="Operating CF (Latest · Actual)"
          value={latestCf ? fmt(latestCf.operating) : '—'}
          sub="Collected rent · actual"
          color={P.green}
        />
        <KpiTile
          label="Financing CF (Estimated)"
          value={monthlyEmi > 0 ? fmt(-monthlyEmi) : '—'}
          sub="Monthly EMI outflow · estimated"
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
          Operating vs Financing — Last 12 Months
        </div>
        <div style={{ fontSize: 11, color: P.muted, marginBottom: 16 }}>
          Operating = actual collected · Financing = estimated EMI · Net = Operating + Financing
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
          <div style={{ fontSize: 14, fontWeight: 700, color: P.text, marginBottom: 12 }}>P&amp;L → NOI Bridge (Latest: {latestNoi.month})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { label: 'Revenue', value: latestNoi.revenue, color: P.green },
              { label: 'Operating Expenses', value: -latestNoi.expenses, color: P.red },
              { label: 'Net Operating Income', value: latestNoi.noi, color: latestNoi.noi >= 0 ? P.green : P.red, bold: true },
              { label: 'Financing Outflows (EMI · Est.)', value: -monthlyEmi, color: P.amber },
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

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 – ACTION PLAN
// ═══════════════════════════════════════════════════════════════════════════════
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

function Tab5({
  portfolio, loans, arData, units,
}: {
  portfolio: ReturnType<typeof useRentalCfoData>['portfolio'];
  loans: ReturnType<typeof useRentalCfoData>['loans'];
  arData: ArMonth[];
  units: ReturnType<typeof useRentalCfoData>['units'];
}) {
  const occupancy = portfolio?.occupancy_pct ?? 0;
  const totalBilled = arData.reduce((s, r) => s + r.billed, 0);
  const totalCollected = arData.reduce((s, r) => s + r.collected, 0);
  const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;
  const realizationRate = collectionRate; // same metric

  const aboveMarketLoans = loans.filter(l => (l.loan_interest_rate ?? 0) > MARKET_RATE);
  const monthlyEmi = loans.reduce((s, l) => s + (l.loan_emi ?? 0), 0);
  const noi = portfolio?.noi_total ?? 0;
  const dscr = monthlyEmi > 0 && noi > 0 ? (noi / 12) / monthlyEmi : null;

  // Vacancy days proxy from units
  const vacantUnits = units.filter((u: any) => (u.status ?? '').toLowerCase().includes('vacant'));
  const avgDaysVacant = vacantUnits.length > 0
    ? vacantUnits.reduce((s: number, u: any) => s + (u.days_vacant ?? 30), 0) / vacantUnits.length
    : null;

  const flags: Flag[] = [];

  if (occupancy > 0 && occupancy < 75) {
    flags.push({ severity: 'critical', title: 'Low Occupancy Alert', metric: pct(occupancy), target: '≥ 95%',
      detail: 'Occupancy is critically low. Review vacant unit marketing, pricing, and lease conversion pipeline immediately.' });
  } else if (occupancy > 0 && occupancy < 95) {
    flags.push({ severity: 'warning', title: 'Occupancy Below Target', metric: pct(occupancy), target: '≥ 95%',
      detail: 'Occupancy is below target. Consider incentive programs or pricing adjustments for vacant units.' });
  } else if (occupancy >= 95) {
    flags.push({ severity: 'ok', title: 'Occupancy on Target', metric: pct(occupancy), target: '≥ 95%',
      detail: 'Portfolio occupancy is healthy and above the target threshold.' });
  }

  if (collectionRate > 0 && collectionRate < 95) {
    flags.push({ severity: collectionRate < 80 ? 'critical' : 'warning', title: 'Collection Rate Below Target',
      metric: pct(collectionRate), target: '≥ 95%',
      detail: 'Rent collection is lagging. Follow up on outstanding AR and consider security deposit policy review.' });
  } else if (collectionRate >= 95) {
    flags.push({ severity: 'ok', title: 'Collection Rate on Target', metric: pct(collectionRate), target: '≥ 95%',
      detail: 'Collection rate is healthy.' });
  }

  if (aboveMarketLoans.length > 0) {
    flags.push({ severity: 'warning', title: 'Refinancing Opportunity',
      metric: `${aboveMarketLoans.length} loan${aboveMarketLoans.length !== 1 ? 's' : ''} above ${pct(MARKET_RATE * 100)}`,
      target: `≤ ${pct(MARKET_RATE * 100)}`,
      detail: `${aboveMarketLoans.map(l => `${(l as any).company_name ?? 'Loan'} @ ${pct((l.loan_interest_rate ?? 0) * 100)}`).join(', ')}. Consider refinancing at current market rates.` });
  }

  if (dscr !== null && dscr < 1.25) {
    flags.push({ severity: dscr < 1.0 ? 'critical' : 'warning', title: 'DSCR Below Threshold',
      metric: `${dscr.toFixed(2)}x`, target: '≥ 1.25x',
      detail: dscr < 1.0
        ? 'NOI does not cover debt service. Cash flow is negative after loan payments — immediate action required.'
        : 'DSCR is below the lender-standard 1.25x threshold. Reduce expenses or increase revenue to improve coverage.' });
  }

  if (avgDaysVacant !== null && avgDaysVacant > 45) {
    flags.push({ severity: 'warning', title: 'High Average Days Vacant',
      metric: `${avgDaysVacant.toFixed(0)} days`, target: '≤ 30 days',
      detail: 'Vacant units are sitting longer than the target threshold, increasing effective vacancy cost.' });
  }

  const critical = flags.filter(f => f.severity === 'critical');
  const warnings = flags.filter(f => f.severity === 'warning');
  const oks = flags.filter(f => f.severity === 'ok');

  const metrics = [
    { label: 'Occupancy Rate', value: occupancy > 0 ? pct(occupancy) : '—', target: '≥ 95%', ok: occupancy >= 95 },
    { label: 'Collection Rate', value: collectionRate > 0 ? pct(collectionRate) : '—', target: '≥ 95%', ok: collectionRate >= 95 },
    { label: 'Realization Rate', value: realizationRate > 0 ? pct(realizationRate) : '—', target: '≥ 95%', ok: realizationRate >= 95 },
    { label: 'DSCR', value: dscr !== null ? `${dscr.toFixed(2)}x` : '—', target: '≥ 1.25x', ok: (dscr ?? 0) >= 1.25 },
    { label: 'Avg Days Vacant', value: avgDaysVacant !== null ? `${avgDaysVacant.toFixed(0)} days` : '—', target: '≤ 30 days', ok: (avgDaysVacant ?? 0) <= 30 },
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
                <div style={{ fontSize: 16, fontWeight: 700, color: m.value === '—' ? P.muted : (m.ok ? P.green : P.red), fontVariantNumeric: 'tabular-nums' }}>
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
          <SectionTitle>Critical — Immediate Action Required</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {critical.map((f, i) => <FlagCard key={i} flag={f} />)}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div>
          <SectionTitle>Warnings — Review Recommended</SectionTitle>
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
          <div style={{ fontSize: 16, fontWeight: 700, color: P.text }}>No action items — upload data to generate flags</div>
          <div style={{ fontSize: 13, color: P.muted, marginTop: 4 }}>
            Upload AR data, P&L financials, and configure loans to see rule-based recommendations.
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { id: 'overview',   label: 'Executive Overview' },
  { id: 'income',     label: 'Income Statement'   },
  { id: 'balance',    label: 'Balance Sheet'      },
  { id: 'cashflow',   label: 'Cash Flow'          },
  { id: 'actions',    label: 'Action Plan'        },
] as const;

type TabId = typeof TABS[number]['id'];

export default function RentalExecutiveSummary() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [period, setPeriod] = useState<Period | null>(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showExportModal, setShowExportModal] = useState(false);

  // Main data hook
  const { companies, loans, portfolio, units } = useRentalCfoData();

  // AR summary
  const [arData, setArData] = useState<ArMonth[]>([]);
  useEffect(() => {
    fetch('/api/rentals/ar-summary')
      .then(r => r.ok ? r.json() : [])
      .then((data: Record<string, { billed: number; collected: number }>) => {
        const arr: ArMonth[] = Object.entries(data).map(([month, v]) => ({
          month, billed: v.billed ?? 0, collected: v.collected ?? 0,
        }));
        setArData(arr);
      })
      .catch(() => {});
  }, []);

  // Ownership / partner data
  const [ownership, setOwnership] = useState<OwnerRow[]>([]);
  useEffect(() => {
    fetch('/api/rentals/ownership')
      .then(r => r.ok ? r.json() : [])
      .then(setOwnership)
      .catch(() => {});
  }, []);

  // P&L financials for all companies
  const [finRows, setFinRows] = useState<FinRow[]>([]);
  useEffect(() => {
    if (!companies.length) return;
    Promise.all(
      companies.map((c: any) =>
        fetch(`/api/rentals/financials/${c.id}`)
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    ).then(results => setFinRows((results as FinRow[][]).flat()));
  }, [companies]);

  // Available period keys from AR data
  const availableKeys = useMemo(() => arData.map(d => d.month), [arData]);

  // Period-filtered AR data
  const filteredAr = useMemo(() => {
    if (!period) return arData;
    const keys = new Set(getPeriodKeys(period, month, year));
    return arData.filter(d => keys.has(d.month));
  }, [arData, period, month, year]);

  // Period-filtered fin rows
  const filteredFin = useMemo(() => {
    if (!period) return finRows;
    const keys = new Set(getPeriodKeys(period, month, year));
    return finRows.filter(r => keys.has(r.month));
  }, [finRows, period, month, year]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return (
    <div style={{ background: P.pageBg, minHeight: '100vh', padding: 0 }}>
      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; }
          button { display: none !important; }
        }
      `}</style>

      {showExportModal && (
        <ExecSummaryExportModal
          companies={companies}
          portfolio={portfolio}
          loans={loans}
          arData={filteredAr}
          finRows={filteredFin}
          period={period}
          month={month}
          year={year}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: P.text, margin: 0 }}>Executive Summary</h1>
          <div style={{ fontSize: 13, color: P.muted, marginTop: 4 }}>Portfolio-wide financial overview across all companies</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PeriodToggle
            period={period} month={month} year={year}
            onChange={(p, m, y) => { setPeriod(p); setMonth(m); setYear(y); }}
            availableKeys={availableKeys}
          />
          <button
            onClick={() => setShowExportModal(true)}
            title="Download multi-section Executive Summary PowerPoint"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: `linear-gradient(135deg, ${P.gold}, #B8860B)`, border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
            <Download size={14} />
            Download PPT
          </button>
          <button
            onClick={handlePrint}
            title="Export to PDF via browser print"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: P.cardBg, border: `1px solid ${P.border}`, borderRadius: 8,
              fontSize: 13, fontWeight: 600, color: P.text, cursor: 'pointer' }}>
            Export PDF
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24,
        background: P.cardBg, border: `1px solid ${P.border}`, borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '7px 20px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
            background: activeTab === t.id ? P.gold : 'transparent',
            color: activeTab === t.id ? P.text : P.muted,
            transition: 'all 0.15s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <Tab1
          portfolio={portfolio} loans={loans} arData={filteredAr}
          ownership={ownership} companies={companies}
          period={period} month={month} year={year}
        />
      )}
      {activeTab === 'income' && (
        <Tab2 finRows={filteredFin} arData={filteredAr} />
      )}
      {activeTab === 'balance' && (
        <Tab3 loans={loans} arData={filteredAr} />
      )}
      {activeTab === 'cashflow' && (
        <Tab4 loans={loans} arData={filteredAr} finRows={filteredFin} />
      )}
      {activeTab === 'actions' && (
        <Tab5 portfolio={portfolio} loans={loans} arData={filteredAr} units={units} />
      )}
    </div>
  );
}
