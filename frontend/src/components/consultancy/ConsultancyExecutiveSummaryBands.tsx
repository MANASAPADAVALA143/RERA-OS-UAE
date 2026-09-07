/**
 * Consultancy & Outsourcing Executive Summary bands — same visual pattern as
 * PropDevExecutiveSummaryBands.tsx, adapted to this segment's KPIs: Revenue Mix
 * (Sales/Services/Other), Payroll load, Cash/AR/Loans & Advances position.
 *
 * Redesigned onto the same premium system already shipped on PropDev's
 * Executive Summary and Rental's Overview/Calculations tabs: Fraunces section
 * titles, IBM Plex Sans/Mono body+data, rail-accented cards, no literal
 * red/green (navy for "good", purple for "risk/warn"). Scoped locally to this
 * file's own components -- ParchmentKpiTile and parchmentTypography.ts are
 * shared across many other pages, so they're left untouched; this file uses
 * its own KTile instead.
 */
import type { ReactElement } from 'react';
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PT } from '../../utils/parchmentTypography';
import type { ConsultancyBoardExportPayload } from '../../utils/gatherConsultancyBoardExportData';

const F_DISPLAY = "'Fraunces', Georgia, 'Times New Roman', serif";
const F_BODY = "'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif";
const F_MONO = "'IBM Plex Mono', 'SF Mono', Consolas, monospace";

// No-red/no-green: "good" reads navy, "risk/warn" reads purple, matching the
// convention already shipped on PropDev Executive Summary and Rental Overview.
const P = {
  gold: PT.gold, teal: PT.teal, green: '#1B3A6B', red: '#7C3AED',
  amber: '#F2C14E', blue: PT.blue, border: PT.border,
};
const DONUT_COLORS = [P.gold, P.teal, P.green, P.blue, P.amber, P.red, '#9B6BD9', '#64748B'];
const CARD_SHADOW = '0 1px 2px rgba(34,28,21,0.05), 0 6px 18px -10px rgba(28,25,23,0.22)';
const CHART_TICK = { fontSize: 11, fill: PT.mutedLight, fontFamily: F_BODY };
const CHART_TOOLTIP = { fontSize: 12, fontFamily: F_BODY, background: '#FFFFFF', border: `1px solid ${PT.border}`, borderRadius: 8 };
const CHART_LEGEND = { wrapperStyle: { fontSize: 12, fontFamily: F_BODY } };

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | null): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

function BandShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%', fontFamily: F_BODY }}>
      <div style={{ borderBottom: `1px solid ${P.border}`, paddingBottom: 10 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: PT.text, margin: 0, fontFamily: F_DISPLAY }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 12, color: PT.mutedLight, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function KpiGrid({ children, columns }: { children: React.ReactNode; columns?: number }) {
  const n = columns ?? (Array.isArray(children) ? children.length : 1);
  void n;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, width: '100%' }}>
      {children}
    </div>
  );
}

/** Local KPI tile — card, shadow, colored top rail, Plex Mono value. Same
 *  visual language as RentalOverview's PriTile, not the shared ParchmentKpiTile. */
function KTile({ label, value, warn, accent }: { label: string; value: string; warn?: boolean; accent?: boolean }) {
  const rail = warn ? P.red : accent ? P.gold : '#D8D2C2';
  const color = warn ? P.red : PT.text;
  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${P.border}`, borderRadius: 10,
      borderTop: `3px solid ${rail}`, padding: '14px 16px', boxShadow: CARD_SHADOW,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: PT.mutedLight, fontFamily: F_BODY }}>{label}</div>
      <div style={{ fontFamily: F_MONO, fontSize: 21, fontWeight: 600, marginTop: 6, color }}>{value}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, height = 220 }: {
  title: string; subtitle?: string; children: ReactElement; height?: number;
}) {
  return (
    <div style={{ background: '#FFFFFF', border: `1px solid ${P.border}`, borderRadius: 12, boxShadow: CARD_SHADOW, padding: '16px 18px' }}>
      <p style={{ fontSize: 15, fontWeight: 600, color: PT.text, margin: '0 0 4px', fontFamily: F_DISPLAY }}>{title}</p>
      {subtitle && <p style={{ fontSize: 12, color: PT.mutedLight, margin: '0 0 12px', fontFamily: F_BODY }}>{subtitle}</p>}
      {!subtitle && <div style={{ marginBottom: 12 }} />}
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function DataGap({ message }: { message: string }) {
  return (
    <div style={{
      background: '#FFFFFF', border: `1px solid ${P.border}`, borderRadius: 12, boxShadow: CARD_SHADOW,
      padding: '28px 20px', textAlign: 'center', color: PT.mutedLight, fontSize: 13, lineHeight: 1.5, fontFamily: F_BODY,
    }}>
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

export default function ConsultancyExecutiveSummaryBands({ data }: { data: ConsultancyBoardExportPayload }) {
  const last = data.snapshots[data.snapshots.length - 1] ?? null;

  const revenueMix = last
    ? [
        { name: 'Sales', value: last.salesRev },
        { name: 'Services', value: last.servicesRev },
        { name: 'Other', value: last.otherRev },
      ].filter(s => s.value > 0)
    : [];
  const opexBreakdown = last
    ? [
        { name: 'Payroll', value: last.payroll },
        { name: 'Other Opex', value: Math.max(0, last.exp - last.payroll) },
      ].filter(s => s.value > 0)
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Financial Snapshot */}
      <BandShell title="Financial Snapshot" subtitle="P&L · Balance Sheet">
        <KpiGrid columns={6}>
          <KTile label="Revenue" value={fmtUsd(last?.rev ?? 0)} accent />
          <KTile label="Net Income" value={fmtUsd(last?.netInc ?? 0)} warn={(last?.netInc ?? 0) < 0} />
          <KTile label="Payroll % of Revenue" value={fmtPct(last?.payrollPctRev ?? null)} warn={(last?.payrollPctRev ?? 0) > 70} />
          <KTile label="Cash" value={fmtUsd(last?.cash ?? 0)} warn={(last?.cash ?? 0) <= 0} />
          <KTile label="AR Balance" value={fmtUsd(last?.ar ?? 0)} />
          <KTile label="Loans & Advances" value={fmtUsd(last?.loansAdvances ?? 0)} />
        </KpiGrid>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <CompositionDonut data={revenueMix} title="Revenue Mix" subtitle="Sales / Services / Other" emptyMessage="Upload a P&L to see revenue mix." />
          <CompositionDonut data={opexBreakdown} title="Opex Breakdown" subtitle="Payroll isolated as the dominant slice" emptyMessage="Upload a P&L to see opex breakdown." />
        </div>
      </BandShell>

      {/* Profitability & Cash Position */}
      <BandShell title="Profitability & Cash Position" subtitle="Revenue vs Expenses · Cash / AR / Loans & Advances">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {data.snapshots.length > 1 ? (
            <ChartCard title="Revenue vs Expenses vs Net Income" height={240}>
              <ComposedChart data={data.snapshots.map(s => ({ year: String(s.year), rev: s.rev, exp: s.exp, netInc: s.netInc }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                <XAxis dataKey="year" tick={CHART_TICK} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
                <Tooltip contentStyle={CHART_TOOLTIP} />
                <Legend {...CHART_LEGEND} />
                <Bar dataKey="rev" name="Revenue" fill={P.gold} radius={[3, 3, 0, 0]} />
                <Bar dataKey="exp" name="Expenses" fill={P.red} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="netInc" name="Net Income" stroke={P.green} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ChartCard>
          ) : (
            <DataGap message="Upload P&L for at least 2 years to see the Revenue/Expenses/Net Income trend." />
          )}
          {data.snapshots.length > 1 ? (
            <ChartCard title="Cash / AR / Loans & Advances" height={240}>
              <LineChart data={data.snapshots.map(s => ({ year: String(s.year), cash: s.cash, ar: s.ar, loans: s.loansAdvances }))}>
                <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                <XAxis dataKey="year" tick={CHART_TICK} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
                <Tooltip contentStyle={CHART_TOOLTIP} />
                <Legend {...CHART_LEGEND} />
                <Line type="monotone" dataKey="cash" name="Cash" stroke={P.green} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="ar" name="AR" stroke={P.blue} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="loans" name="Loans & Advances" stroke={P.amber} strokeWidth={2} dot={false} />
              </LineChart>
            </ChartCard>
          ) : (
            <DataGap message="Upload Balance Sheet for at least 2 years to see the Cash/AR/Loans & Advances trend." />
          )}
        </div>
      </BandShell>
    </div>
  );
}
