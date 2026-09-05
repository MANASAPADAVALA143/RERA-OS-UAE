/**
 * Property Dev Executive Summary bands — same visual pattern as Rentals'
 * ExecutiveSummarySixBands.tsx (BandShell/KpiTile/ChartCard/CompositionDonut), rebuilt
 * locally since those helpers aren't exported, but Property Dev-appropriate content:
 * Command Center Snapshot, Development Performance, Finance & Profitability, Loan & Risk.
 */
import type { ReactElement, ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ParchmentKpiTile } from '../ui/ParchmentKpiTile';
import { PT, PT_FONT, PT_CARD } from '../../utils/parchmentTypography';
import { pickFocusSnapshot, type PropDevBoardExportPayload } from '../../utils/gatherPropDevBoardExportData';

const P = {
  gold: PT.gold, teal: PT.teal, green: PT.green, red: PT.red,
  amber: '#F2C14E', blue: PT.blue, border: PT.border,
};
const DONUT_COLORS = [P.gold, P.teal, P.green, P.blue, P.amber, P.red, '#7C3AED', '#64748B'];
const CHART_TICK = PT_FONT.chartTick;
const CHART_TOOLTIP = PT_FONT.tooltip;
const CHART_LEGEND = { wrapperStyle: PT_FONT.legend };

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) n = 0;
  if (n < 0) {
    return `(${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n))})`;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const body = `${Math.abs(n).toFixed(1)}%`;
  return n < 0 ? `(${body})` : body;
}

function BandShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
      <div style={{ borderBottom: `1px solid ${P.border}`, paddingBottom: 10 }}>
        <h2 style={PT_FONT.sectionTitle}>{title}</h2>
        {subtitle && <p style={PT_FONT.sectionSubtitle}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function KpiGrid({ children, columns }: { children: ReactNode; columns?: number }) {
  const n = columns ?? (Array.isArray(children) ? children.length : 1);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 16, width: '100%' }}>
      {children}
    </div>
  );
}

function ChartCard({ title, subtitle, children, height = 220 }: {
  title: string; subtitle?: string; children: ReactElement; height?: number;
}) {
  return (
    <div style={PT_CARD}>
      <p style={PT_FONT.chartTitle}>{title}</p>
      {subtitle && <p style={PT_FONT.chartSubtitle}>{subtitle}</p>}
      {!subtitle && <div style={{ marginBottom: 12 }} />}
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function DataGap({ message }: { message: string }) {
  return (
    <div style={{ ...PT_CARD, padding: '28px 20px', textAlign: 'center', color: PT.mutedLight, fontSize: 13, lineHeight: 1.5 }}>
      {message}
    </div>
  );
}

function CompositionDonut({ data, title, subtitle, emptyMessage }: {
  data: { name: string; value: number }[]; title: string; subtitle?: string; emptyMessage: string;
}) {
  if (!data.length) return <DataGap message={emptyMessage} />;
  return (
    <ChartCard title={title} subtitle={subtitle} height={200}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
        <Legend {...CHART_LEGEND} />
      </PieChart>
    </ChartCard>
  );
}

export default function PropDevExecutiveSummaryBands({ data }: { data: PropDevBoardExportPayload }) {
  const lastBs = pickFocusSnapshot(data.bsSnapshots, data.focusYear);
  const lastPl = pickFocusSnapshot(data.plSnapshots, data.focusYear);
  const lastCf = pickFocusSnapshot(data.cfSnapshots, data.focusYear);

  const land = Math.max(0, lastBs?.landValue ?? 0, data.landValue ?? 0);
  const improvements = Math.max(0, lastBs?.improvementsWip ?? 0);
  const cash = Math.max(0, lastBs?.cash ?? 0);
  const totalAssets = Math.max(0, lastBs?.totalAssets ?? 0);
  const fixedOrLand = Math.max(0, lastBs?.totalFixedAssets ?? 0, land + improvements);
  let other = Math.max(0, lastBs?.otherAssets ?? 0);
  if (other <= 0 && totalAssets > 0) {
    other = Math.max(0, totalAssets - cash - fixedOrLand);
  }
  let assetDonut = [
    { name: 'Land', value: land },
    { name: 'Improvements / WIP', value: improvements },
    { name: 'Cash', value: cash },
    { name: 'Other', value: other },
  ].filter(s => s.value > 0);
  if (!assetDonut.length && totalAssets > 0) {
    assetDonut = [{ name: 'Total Assets', value: totalAssets }];
  }
  let debtDonut = data.loanRows.map(l => ({ name: l.bank, value: l.balance })).filter(s => s.value > 0);
  if (!debtDonut.length && data.totalDebt > 0) {
    debtDonut = [{ name: 'Total Debt (B/S)', value: data.totalDebt }];
  }
  const expenseDonut = Object.entries(data.latestExpenseCategories)
    .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Command Center Snapshot */}
      <BandShell title="Command Center Snapshot" subtitle="Balance Sheet · Loan Tracker · Ownership">
        <KpiGrid columns={5}>
          <ParchmentKpiTile label="Land Value" value={fmtUsd(data.landValue ?? 0)} />
          <ParchmentKpiTile label="Total Assets" value={fmtUsd(lastBs?.totalAssets ?? 0)} />
          {/* Debt + LTLV both from B/S snapshot so tiles cannot diverge (Loan Tracker vs liabilities). */}
          <ParchmentKpiTile label="Total Debt" value={fmtUsd(lastBs?.totalDebt ?? data.totalDebt)} warn={(lastBs?.totalDebt ?? data.totalDebt) > 0} />
          <ParchmentKpiTile label="LTLV" value={fmtPct(lastBs?.ltlv ?? null)} sub="Loan-to-Land-Value" accent />
          <ParchmentKpiTile label="Monthly EMI" value={fmtUsd(data.totalMonthlyEmi)} sub={`${data.loanRows.length} active loan(s)`} />
        </KpiGrid>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <CompositionDonut data={assetDonut} title="Asset Composition" emptyMessage="Upload a Balance Sheet to see asset composition." />
          <CompositionDonut
            data={debtDonut}
            title="Debt by Lender"
            subtitle={data.loanRows.some(l => l.balance > 0) ? 'Outstanding balances' : 'From Balance Sheet'}
            emptyMessage="No active loans on the Loan Tracker yet."
          />
        </div>
      </BandShell>

      {/* Development Performance */}
      <BandShell title="Development Performance" subtitle="Cost Basis · Cash Runway · Capital Call Coverage">
        <KpiGrid columns={4}>
          <ParchmentKpiTile label="Cash Runway" value={data.cashRunway.label} warn={data.cashRunway.months != null && data.cashRunway.months < 6} />
          <ParchmentKpiTile label="Avg Monthly Burn" value={fmtUsd(data.cashRunway.avgMonthlyBurn)} />
          <ParchmentKpiTile
            label="Capital Call Coverage"
            value={data.capitalCallCoverage?.dataGap ? 'N/A' : data.capitalCallCoverage?.ratio != null ? `${data.capitalCallCoverage.ratio.toFixed(1)}x` : '—'}
            sub={
              data.capitalCallCoverage?.dataGap
                ? 'Needs capital calls or committed capital'
                : data.capitalCallCoverage?.source === 'capital-calls'
                  ? `${data.capitalCallCoverage.status ?? ''} · from capital calls`.trim()
                  : data.capitalCallCoverage?.status
            }
            warn={data.capitalCallCoverage?.status === 'Review'}
          />
          <ParchmentKpiTile
            label="Uncalled Partner Capital"
            value={data.capitalCallCoverage?.dataGap || data.capitalCallCoverage?.uncalled == null
              ? '—'
              : fmtUsd(data.capitalCallCoverage.uncalled)}
            sub={
              data.capitalCallCoverage?.dataGap
                ? 'committed − contributed'
                : data.capitalCallCoverage?.source === 'capital-calls'
                  ? 'Open capital-call dues'
                  : undefined
            }
          />
        </KpiGrid>
        {data.bsSnapshots.length > 1 ? (
          <ChartCard title="Cost Basis Trend" subtitle="Land + Improvements/WIP by year" height={240}>
            <ComposedChart data={data.bsSnapshots.map(s => ({ year: String(s.year), land: s.landValue, improvements: s.improvementsWip, ltlv: s.ltlv ?? 0 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Bar dataKey="land" name="Land" fill={P.gold} radius={[3, 3, 0, 0]} />
              <Bar dataKey="improvements" name="Improvements/WIP" fill={P.teal} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="ltlv" name="LTLV %" stroke={P.red} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartCard>
        ) : (
          <DataGap message="Upload Balance Sheets for at least 2 years to see the Cost Basis Trend." />
        )}
      </BandShell>

      {/* Finance & Profitability */}
      <BandShell title="Finance & Profitability" subtitle="P&L · Balance Sheet">
        <KpiGrid columns={6}>
          <ParchmentKpiTile label="Revenue" value={fmtUsd(lastPl?.rev ?? 0)} />
          <ParchmentKpiTile label="Expenses" value={fmtUsd(lastPl?.exp ?? 0)} />
          <ParchmentKpiTile label="Net Income" value={fmtUsd(lastPl?.netInc ?? 0)} warn={(lastPl?.netInc ?? 0) < 0} accent />
          <ParchmentKpiTile label="NOI" value={fmtUsd(lastPl?.noi ?? 0)} />
          <ParchmentKpiTile label="Net Margin" value={fmtPct(lastPl?.margin ?? null)} />
          <ParchmentKpiTile label="Cash Balance" value={fmtUsd(lastBs?.cash ?? 0)} warn={(lastBs?.cash ?? 0) <= 0} />
        </KpiGrid>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {data.plSnapshots.length > 1 ? (
            <ChartCard title="Revenue · Expenses · NOI" subtitle="By year" height={240}>
              <ComposedChart data={data.plSnapshots.map(s => ({ year: s.yearLabel, rev: s.rev, exp: s.exp, noi: s.noi }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                <XAxis dataKey="year" tick={CHART_TICK} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
                <Tooltip contentStyle={CHART_TOOLTIP} />
                <Legend {...CHART_LEGEND} />
                <Bar dataKey="rev" name="Revenue" fill={P.gold} radius={[3, 3, 0, 0]} />
                <Bar dataKey="exp" name="Expenses" fill={P.red} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="noi" name="NOI" stroke={P.green} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ChartCard>
          ) : (
            <DataGap message="Upload P&L for at least 2 years to see the Revenue/Expenses/NOI trend." />
          )}
          <CompositionDonut data={expenseDonut} title="Expense Breakdown" subtitle={lastPl?.yearLabel} emptyMessage="Upload a P&L to see expense breakdown." />
        </div>
      </BandShell>

      {/* Loan & Risk */}
      <BandShell title="Loan & Risk" subtitle="Loan Tracker · Cash Flow">
        {data.loanRows.length === 0 ? (
          <DataGap message="Upload loans to the Loan Tracker to see Loan & Risk metrics." />
        ) : (
          <>
            <KpiGrid columns={4}>
              <ParchmentKpiTile label="Total Outstanding" value={fmtUsd(data.totalDebt)} />
              <ParchmentKpiTile label="Total Monthly EMI" value={fmtUsd(data.totalMonthlyEmi)} />
              <ParchmentKpiTile
                label="Highest Rate"
                value={data.loanRows.length ? `${[...data.loanRows].sort((a, b) => b.rate - a.rate)[0].rate.toFixed(2)}%` : '—'}
                sub={data.loanRows.length ? [...data.loanRows].sort((a, b) => b.rate - a.rate)[0].bank : undefined}
              />
              <ParchmentKpiTile label="Active Loans" value={String(data.loanRows.length)} />
            </KpiGrid>
            {data.cfSnapshots.length > 1 && (
              <ChartCard title="Net Cash Flow by Year" height={200}>
                <BarChart data={data.cfSnapshots.map(s => ({ year: s.yearLabel, net: s.netCashFlow }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.border} vertical={false} />
                  <XAxis dataKey="year" tick={CHART_TICK} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
                  <Tooltip contentStyle={CHART_TOOLTIP} />
                  <Bar dataKey="net" name="Net Cash Flow" radius={[3, 3, 0, 0]}>
                    {data.cfSnapshots.map((s, i) => <Cell key={i} fill={s.netCashFlow >= 0 ? P.green : P.red} />)}
                  </Bar>
                </BarChart>
              </ChartCard>
            )}
          </>
        )}
        {data.overdueCapitalCalls.length > 0 && (
          <div style={{ ...PT_CARD, borderColor: '#FCA5A5', background: '#FEF2F2' }}>
            <p style={{ ...PT_FONT.chartTitle, color: '#B91C1C' }}>
              {data.overdueCapitalCalls.length} overdue capital call(s) — {fmtUsd(data.overdueCapitalCalls.reduce((s, c) => s + c.amountDue, 0))} outstanding
            </p>
          </div>
        )}
      </BandShell>

      {lastCf && (
        <p style={{ ...PT_FONT.bodyMuted, margin: 0, fontStyle: 'italic' }}>
          Closing cash for {lastCf.yearLabel}: {fmtUsd(lastCf.closingCash)}
        </p>
      )}
    </div>
  );
}
