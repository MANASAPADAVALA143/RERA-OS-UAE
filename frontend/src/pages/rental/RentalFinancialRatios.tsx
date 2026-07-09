import { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, ReferenceLine, Cell,
  ComposedChart,
} from 'recharts';
import { Info } from 'lucide-react';
import { api } from '../../services/api';
import { BulletChartStrip } from '../../components/shared/BulletChartStrip';
import type { BulletDef, BulletStatus } from '../../components/shared/BulletChartStrip';
import { ParchmentKpiTile } from '../../components/ui/ParchmentKpiTile';
import { useKpiAdminAccess } from '../../hooks/useKpiAdminAccess';
import { useCompanyKpiAudit } from '../../hooks/useCompanyKpiAudit';
import { KpiBreakdownPanel } from '../../components/admin/KpiBreakdownPanel';
import type { KpiAuditRow } from '../../types/kpiAudit';
import { debtRatiosFromLoanTracker, ebitdaMarginPct } from '../../utils/rentalKpiEngine';

/** Maps Financial Ratios page card names → kpi_sanity_check KPI names */
const CARD_TO_AUDIT_KPI: Record<string, string> = {
  'NOI Margin': 'NOI Margin',
  'Net Profit Margin': 'Net Income Margin',
  'Operating Expense Ratio': 'Expense Ratio',
  'Return on Assets': 'ROA',
  'Return on Equity': 'ROE',
  'EBITDA Margin': 'EBITDA Margin',
  'Interest Coverage': 'Interest Coverage',
  'Debt-to-Equity': 'Debt-to-Equity',
  'Debt-to-Asset Ratio': 'Debt-to-Asset',
  'Equity Ratio': 'Equity Ratio',
  'DSCR': 'DSCR (Est.)',
  'Loan-to-Value (LTV)': 'LTV',
};

type RatioTab = 'Profitability' | 'Liquidity' | 'Solvency' | 'Rental KPIs' | 'Cost of Capital';
type StatusType = BulletStatus;

interface RatioCard {
  name: string;
  formula: string;
  value: string;
  benchmark: string;
  status: StatusType;
  statusLabel: string;
  note?: string;
  spark?: number[];
}

// Parchment palette for ratio cards
const S: Record<StatusType, { borderColor: string; bg: string; pillBg: string; pillColor: string }> = {
  good:     { borderColor: '#166534', bg: '#F4FFF3', pillBg: '#166534', pillColor: '#fff' },
  watch:    { borderColor: '#F5A623', bg: '#FFFBF0', pillBg: '#F5A623', pillColor: '#fff' },
  critical: { borderColor: '#B91C1C', bg: '#FFF0F0', pillBg: '#B91C1C', pillColor: '#fff' },
  monitor:  { borderColor: '#F2994A', bg: '#FFF7EE', pillBg: '#F2994A', pillColor: '#fff' },
  info:     { borderColor: '#2F80ED', bg: '#F0F6FF', pillBg: '#2F80ED', pillColor: '#fff' },
};

interface FinItem { label: string; values: Record<number, number>; indent: number; isTotal: boolean; isSectionHeader: boolean; isNetIncome: boolean; }
interface LiveFin { company_name: string; filename: string; date_range: string; years: number[]; pl: FinItem[]; bs: FinItem[]; cf: FinItem[]; uploaded_at: string; }
interface CoOption { id: string; company_name: string; }

function getYV(items: FinItem[], pat: RegExp, year: number): number {
  return items.find(i => pat.test(i.label))?.values[year] ?? 0;
}
function sumI(items: FinItem[], pat: RegExp, year: number): number {
  return items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label)).reduce((s, i) => s + (i.values[year] ?? 0), 0);
}
function fmtV(n: number) { if (n === 0) return '—'; const a = Math.abs(n); const s = a >= 1_000_000 ? `$${(a/1_000_000).toFixed(2)}M` : a >= 1_000 ? `$${(a/1_000).toFixed(0)}K` : `$${a.toFixed(0)}`; return n < 0 ? `(${s})` : s; }

function LiveDataPanel({ fin, activeYear, totalDebt }: { fin: LiveFin; activeYear?: number; totalDebt?: number | null }) {
  const lastY = activeYear && fin.years.includes(activeYear) ? activeYear : fin.years[fin.years.length - 1];
  const lastYIdx = fin.years.indexOf(lastY);
  const prevY = lastYIdx > 0 ? fin.years[lastYIdx - 1] : null;
  const pl = fin.pl; const bs = fin.bs;
  const totalRevenue = getYV(pl,/^total\s+(for\s+)?income$/i,lastY) || sumI(pl,/income|revenue|rent/i,lastY);
  const totalExpenses = getYV(pl,/^total\s+(for\s+)?expenses?$/i,lastY);
  const netIncome = getYV(pl,/^net\s+income$/i,lastY);
  const interestExpense = Math.abs(sumI(pl,/interest/i,lastY));
  const noi = totalRevenue - totalExpenses + interestExpense;
  const totalAssets = getYV(bs,/^total\s+(for\s+)?assets$/i,lastY);
  const totalLiabilities = getYV(bs,/^total\s+(for\s+)?liabilities$/i,lastY);
  const equity = getYV(bs,/^total\s+(for\s+)?equity$/i,lastY);
  const cash = getYV(bs,/^total\s+(for\s+)?bank/i,lastY) || sumI(bs,/^bank|checking|savings/i,lastY);
  const buildings = Math.abs(
    getYV(bs,/^buildings$/i,lastY) ||
    getYV(bs,/^property\s*(and|&)?\s*equipment/i,lastY) ||
    getYV(bs,/^fixed\s*assets/i,lastY) ||
    getYV(bs,/^land\s*(and|&)?\s*buildings/i,lastY) ||
    getYV(bs,/^real\s+estate/i,lastY)
  );
  const loans = Math.abs(getYV(bs,/^total\s+for\s+long.term/i,lastY) || sumI(bs,/long.term.*loan/i,lastY));
  const kLike = {
    noi, totalRevenue, netIncome, totalExpenses, interestExpense, equity, totalAssets,
    totalLiabilities, rentalIncome: 0, managementFee: 0, repairs: 0, cash, buildings,
    longTermLoans: loans, depreciation: 0, securityDeposits: 0, legalFees: 0,
    utilities: 0, hoa: 0, propertyTax: 0, insurance: 0, accumDep: 0, otherOpex: 0,
  };
  const noiM = totalRevenue > 0 ? noi / totalRevenue * 100 : 0;
  const netM = totalRevenue > 0 ? netIncome / totalRevenue * 100 : 0;
  const ltv = buildings > 0 ? loans / buildings * 100 : 0;
  const { debtToEquity: dte } = debtRatiosFromLoanTracker(totalDebt ?? null, kLike);
  const iCov = interestExpense > 0 ? noi / interestExpense : 0;
  const expR = totalRevenue > 0 ? totalExpenses / totalRevenue * 100 : 0;

  const trendRows = fin.years.map(y => {
    const rev = getYV(pl,/^total\s+(for\s+)?income$/i,y) || sumI(pl,/income|revenue|rent/i,y);
    const exp = getYV(pl,/^total\s+(for\s+)?expenses?$/i,y);
    const ni = getYV(pl,/^net\s+income$/i,y);
    const ie = Math.abs(sumI(pl,/interest/i,y));
    const n = rev - exp + ie;
    return { year: String(y), NOI: n, Revenue: rev, 'Net Income': ni, 'NOI Margin %': rev > 0 ? +(n/rev*100).toFixed(1) : 0 };
  });

  const prevRevenue = prevY ? (getYV(pl,/^total\s+(for\s+)?income$/i,prevY) || sumI(pl,/income|revenue|rent/i,prevY)) : null;
  const revGrowth = prevRevenue && prevRevenue > 0 ? ((totalRevenue - prevRevenue)/prevRevenue*100) : null;

  const metrics = [
    { label: 'NOI Margin', value: noiM > 0 ? `${noiM.toFixed(1)}%` : '—', accent: true, warn: false },
    { label: 'Net Margin', value: `${netM.toFixed(1)}%`, warn: netM < 0 },
    { label: 'Revenue', value: fmtV(totalRevenue) },
    { label: 'NOI', value: fmtV(noi), warn: noi < 0 },
    { label: 'LTV', value: ltv > 0 ? `${ltv.toFixed(1)}%` : buildings === 0 ? 'No bldg value' : '—', warn: ltv > 85 },
    { label: 'Int. Coverage', value: iCov > 0 ? `${iCov.toFixed(2)}x` : '—', warn: iCov > 0 && iCov < 1.2 },
    { label: 'D/E Ratio', value: dte != null ? `${dte.toFixed(1)}x` : '— no loan data', warn: dte != null && dte > 6 },
    { label: 'Expense Ratio', value: expR > 0 ? `${expR.toFixed(1)}%` : '—', warn: expR > 70 },
    { label: 'Cash', value: fmtV(cash), warn: cash <= 0 },
    { label: 'Total Assets', value: fmtV(totalAssets) },
    { label: 'Equity', value: fmtV(equity), warn: equity <= 0 },
    { label: 'Revenue Growth', value: revGrowth !== null ? `${revGrowth >= 0 ? '+' : ''}${revGrowth.toFixed(1)}%` : 'N/A', warn: revGrowth !== null && revGrowth < 0 },
  ];

  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: 20 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#92400E' }}>
            Live Data — {fin.company_name}
          </span>
          <p style={{ fontSize: 12, color: '#A8A29E', marginTop: 4 }}>
            {fin.filename} · Latest year: <strong style={{ color: '#1C1917' }}>{lastY}</strong> · {fin.years.length} years of data
          </p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {fin.years.map(y => (
            <span key={y} style={{
              fontSize: 11, background: '#F7F1E6', color: '#78716C',
              border: '1px solid #E8DEC8', borderRadius: 20, padding: '3px 10px', fontWeight: 600,
            }}>
              {y}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {metrics.map(m => (
          <ParchmentKpiTile
            key={m.label}
            label={m.label}
            value={m.value}
            accent={'accent' in m && m.accent}
            warn={'warn' in m && m.warn}
            compact
          />
        ))}
      </div>

      {trendRows.length >= 2 && (
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Multi-Year P&amp;L Trend</p>
          <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 12 }}>Revenue, NOI, and Net Income across all available years</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendRows} margin={{ left: 20, right: 10, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: '#78716C' }} />
              <YAxis tickFormatter={v => fmtV(v as number)} tick={{ fontSize: 10, fill: '#78716C' }} />
              <Tooltip
                formatter={(v: number) => fmtV(v)}
                contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: '#78716C' }} />
              <Line type="monotone" dataKey="Revenue" stroke="#D4AF37" strokeWidth={2} dot={{ r: 3, fill: '#D4AF37' }} />
              <Line type="monotone" dataKey="NOI" stroke="#B8860B" strokeWidth={2} dot={{ r: 3, fill: '#B8860B' }} />
              <Line type="monotone" dataKey="Net Income" stroke="#8B6914" strokeWidth={1.5} strokeDasharray="5 3" dot={{ r: 3, fill: '#8B6914' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Bullet-chart helpers ─────────────────────────────────────────────────────

const BULLET_DEFS: BulletDef[] = [
  {
    names: ['Net Profit Margin'],
    benchmark: 25, unit: '%', reversed: false, max: 80,
    // value may be "-4.8% (NOI: 39.0%)" — use the NOI portion for the bullet
    extract: v => { const m = v.match(/NOI[:\s]+([0-9.]+)%/i); return m ? parseFloat(m[1]) : Math.max(0, parseFloat(v) || 0); },
  },
  { names: ['Operating Expense Ratio'], benchmark: 60, unit: '%', reversed: true,  max: 130, extract: v => Math.abs(parseFloat(v)) || 0 },
  { names: ['Return on Assets'],        benchmark: 4,  unit: '%', reversed: false, max: 12,  extract: v => parseFloat(v) || 0 },
  { names: ['Return on Equity'],        benchmark: 8,  unit: '%', reversed: false, max: 20,  extract: v => parseFloat(v) || 0 },
  { names: ['EBITDA Margin'],           benchmark: 45, unit: '%', reversed: false, max: 80,  extract: v => parseFloat(v) || 0 },
  { names: ['NOI Margin'],              benchmark: 35, unit: '%', reversed: false, max: 80,  extract: v => parseFloat(v) || 0 },
  { names: ['Cash-on-Cash Return'],     benchmark: 7,  unit: '%', reversed: false, max: 20,  extract: v => parseFloat(v) || 0 },
  { names: ['Gross Rent Multiplier', 'Gross Rent Multiple'],
    benchmark: 14, unit: 'x', reversed: true, max: 22, extract: v => parseFloat(v) || 0 },
];

function BulletStripForRatios({ cards, defs = BULLET_DEFS }: { cards: RatioCard[]; defs?: BulletDef[] }) {
  return <BulletChartStrip cards={cards} defs={defs} />;
}

// ── Profitability trend helpers ───────────────────────────────────────────────

type ProfPt  = { label: string; npm: number | null; ebitda: number | null; noi: number | null };
type RetPt   = { label: string; roa: number | null; roe: number | null;  coc: number | null  };

function buildTrendFromSparks(cards: RatioCard[]): { profTrend: ProfPt[]; retTrend: RetPt[] } {
  const get = (name: string) => cards.find(c => c.name === name || c.name.includes(name));
  const sparks = {
    npm:    get('Net Profit Margin')?.spark,
    ebitda: get('EBITDA Margin')?.spark,
    noi:    get('NOI Margin')?.spark,
    roa:    get('Return on Assets')?.spark,
    roe:    get('Return on Equity')?.spark,
    coc:    get('Cash-on-Cash Return')?.spark,
  };
  const len = Math.max(...Object.values(sparks).map(s => s?.length ?? 0));
  if (len < 2) return { profTrend: [], retTrend: [] };
  const labels = len === 4 ? ['T−3', 'T−2', 'T−1', 'Latest'] : Array.from({ length: len }, (_, i) => i === len - 1 ? 'Latest' : `T−${len - 1 - i}`);
  return {
    profTrend: labels.map((label, i) => ({ label, npm: sparks.npm?.[i] ?? null, ebitda: sparks.ebitda?.[i] ?? null, noi: sparks.noi?.[i] ?? null })),
    retTrend:  labels.map((label, i) => ({ label, roa: sparks.roa?.[i] ?? null, roe: sparks.roe?.[i] ?? null, coc: sparks.coc?.[i] ?? null })),
  };
}

function buildTrendFromLive(fin: LiveFin): { profTrend: ProfPt[]; retTrend: RetPt[] } {
  const { pl, bs, years } = fin;
  const yv = (items: FinItem[], pat: RegExp, y: number) => items.find(i => pat.test(i.label))?.values[y] ?? 0;
  const si = (items: FinItem[], pat: RegExp, y: number) =>
    items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label)).reduce((s, i) => s + (i.values[y] ?? 0), 0);
  return {
    profTrend: years.map(y => {
      const rev = yv(pl, /^total\s+(for\s+)?income$/i, y) || si(pl, /income|revenue|rent/i, y);
      const exp = yv(pl, /^total\s+(for\s+)?expenses?$/i, y);
      const ni  = yv(pl, /^net\s+income$/i, y);
      const ie  = Math.abs(si(pl, /interest/i, y));
      const dep = Math.abs(si(pl, /depreciation|amortization/i, y));
      const noi = rev - exp + ie;
      return {
        label:  String(y),
        npm:    rev > 0 ? +(ni / rev * 100).toFixed(1) : null,
        ebitda: rev > 0 ? +(noi / rev * 100).toFixed(1) : null,
        noi:    rev > 0 ? +(noi / rev * 100).toFixed(1) : null,
      };
    }),
    retTrend: years.map(y => {
      const ni    = yv(pl, /^net\s+income$/i, y);
      const assets = yv(bs, /^total\s+(for\s+)?assets$/i, y);
      const eq     = yv(bs, /^total\s+(for\s+)?equity$/i, y);
      return {
        label: String(y),
        roa: assets > 0 ? +(ni / assets * 100).toFixed(1) : null,
        roe: eq     > 0 ? +(ni / eq    * 100).toFixed(1) : null,
        coc: null,
      };
    }),
  };
}

const EMPTY_CHART = (
  <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 12, textAlign: 'center' }}>
    Upload multi-year P&L to populate historical trend
  </div>
);

function ProfTrendChart({ data }: { data: ProfPt[] }) {
  if (data.length < 2) return EMPTY_CHART;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} width={38} />
        <Tooltip contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v?.toFixed(1)}%`]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="noi"    name="NOI Margin"        stroke="#166534" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="ebitda" name="EBITDA Margin"     stroke="#D4AF37" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="npm"    name="Net Profit Margin" stroke="#1C1917" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RetTrendChart({ data }: { data: RetPt[] }) {
  if (data.length < 2) return EMPTY_CHART;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} width={38} />
        <Tooltip contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v?.toFixed(1)}%`]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="roa" name="Return on Assets" stroke="#0F766E" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="roe" name="Return on Equity" stroke="#4E79A7" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="coc" name="Cash-on-Cash"     stroke="#F2C14E" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Data will be fetched from API instead of hardcoded
const DEFAULT_CO_DATA: any[] = [];
const DEFAULT_TREND_DATA = [
  { year: '—', noiMargin: 0, netProfitMargin: 0 },
];
const DEFAULT_LOAN_DATA: any[] = [];

const fmt$ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function Spark({ data, color = '#B8860B' }: { data: number[]; color?: string }) {
  const pts = data.map((v, i) => ({ v, i }));
  return (
    <div className="h-7 w-full mt-2 opacity-60">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={pts} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RatioCardComp({
  card,
  auditRow,
  showBreakdown,
  expanded,
  onToggleExpand,
}: {
  card: RatioCard;
  auditRow?: KpiAuditRow | null;
  showBreakdown?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const st = S[card.status];
  return (
    <div>
      <div style={{
        position: 'relative',
        background: st.bg,
        borderLeft: `4px solid ${st.borderColor}`,
        borderRadius: 6,
        padding: '10px 12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
      }}>
        {showBreakdown && auditRow && (
          <button
            type="button"
            onClick={onToggleExpand}
            title="Show calculation breakdown (admin)"
            style={{
              position: 'absolute', top: 6, right: 6, width: 22, height: 22,
              borderRadius: '50%', border: '1px solid #E8DEC8', background: '#fff',
              color: '#78716C', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Info size={12} />
          </button>
        )}
        <div style={{ fontSize: 11, fontWeight: 600, color: '#262626', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.2 }}>{card.name}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#262626', fontFamily: 'monospace', margin: '4px 0 4px' }}>{card.value}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#6B6B6B' }}>Benchmark: {card.benchmark}</span>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: st.pillBg, color: st.pillColor }}>{card.statusLabel}</span>
        </div>
      </div>
      {showBreakdown && expanded && auditRow && <KpiBreakdownPanel row={auditRow} compact />}
    </div>
  );
}

interface CardGridAuditProps {
  rowsByKpi?: Map<string, KpiAuditRow>;
  showBreakdown?: boolean;
  expandedKpi?: string | null;
  onToggleKpi?: (name: string) => void;
}

function CardGrid({ cards, rowsByKpi, showBreakdown, expandedKpi, onToggleKpi }: { cards: RatioCard[] } & CardGridAuditProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
      {cards.map(c => {
        const auditName = CARD_TO_AUDIT_KPI[c.name];
        const auditRow = auditName ? rowsByKpi?.get(auditName) : undefined;
        return (
          <RatioCardComp
            key={c.name}
            card={c}
            auditRow={auditRow}
            showBreakdown={showBreakdown && !!auditRow}
            expanded={auditName ? expandedKpi === auditName : false}
            onToggleExpand={auditName ? () => onToggleKpi?.(auditName) : undefined}
          />
        );
      })}
    </div>
  );
}

const PROFITABILITY: RatioCard[] = [
  { name: 'Net Profit Margin',       formula: 'Net Income / Revenue',      value: '-4.8% (NOI: 39.0%)',  benchmark: '>25% NOI',   status: 'good',    statusLabel: '🟢 Good',         spark: [33.2, 35.8, 37.1, 39.0], note: 'Net margin negative due to depreciation; NOI margin strong' },
  { name: 'Gross Profit Margin',     formula: 'Gross Profit / Revenue',    value: '100%',                benchmark: 'n/a rental', status: 'good',    statusLabel: '🟢 Rental Model', note: 'No COGS in pure rental business — all revenue is gross profit' },
  { name: 'Operating Expense Ratio', formula: 'Total OpEx / Gross Revenue',value: '104.8%',              benchmark: '<60%',       status: 'monitor', statusLabel: '⚠️ High (loans)', note: 'High due to mortgage interest; OpEx ex-debt = 60.9%' },
  { name: 'Return on Assets',        formula: 'Net Income / Total Assets', value: '3.2%',               benchmark: '>4%',        status: 'watch',   statusLabel: '🟡 Watch',        spark: [2.1, 2.6, 2.9, 3.2] },
  { name: 'Return on Equity',        formula: 'Net Income / Equity',       value: '8.1%',               benchmark: '>8%',        status: 'good',    statusLabel: '🟢 On Track',     spark: [5.8, 6.7, 7.4, 8.1] },
  { name: 'EBITDA Margin',           formula: 'EBITDA / Revenue',          value: '54.2%',              benchmark: '>45%',       status: 'good',    statusLabel: '🟢 Strong',       spark: [48.1, 50.4, 52.3, 54.2] },
  { name: 'NOI Margin',              formula: 'NOI / Gross Revenue',       value: '39.0%',              benchmark: '>35%',       status: 'good',    statusLabel: '🟢 Strong',       spark: [33.2, 35.8, 37.1, 39.0] },
  { name: 'Cash-on-Cash Return',     formula: 'Pre-tax CF / Equity',       value: '6.8%',               benchmark: '>7%',        status: 'watch',   statusLabel: '🟡 Watch',        spark: [5.2, 5.9, 6.4, 6.8] },
  { name: 'Gross Rent Multiplier',   formula: 'Property Value / Ann. Rent',value: '11.2x',             benchmark: '<14x',       status: 'good',    statusLabel: '🟢 Good' },
];

const LIQUIDITY: RatioCard[] = [
  { name: 'Current Ratio',            formula: 'Current Assets / Current Liabilities', value: '3.86x',    benchmark: '>1.5x',    status: 'good', statusLabel: '🟢 Strong',   spark: [2.9, 3.2, 3.5, 3.86] },
  { name: 'Quick Ratio',              formula: '(CA − Inventory) / CL',                value: '3.86x',    benchmark: '>1.0x',    status: 'good', statusLabel: '🟢 Strong',   note: 'No inventory in rental — same as current ratio' },
  { name: 'Cash Ratio',               formula: 'Cash & Bank / Current Liabilities',    value: '0.57x',    benchmark: '>0.2x',    status: 'good', statusLabel: '🟢 Adequate', spark: [0.38, 0.44, 0.51, 0.57] },
  { name: 'Operating Cash Flow Ratio',formula: 'OCF / Current Liabilities',            value: '1.24x',    benchmark: '>1.0x',    status: 'good', statusLabel: '🟢 Good',     spark: [0.96, 1.05, 1.14, 1.24] },
  { name: 'Days Cash on Hand',        formula: 'Cash / Daily OpEx',                    value: '84 days',  benchmark: '>60 days', status: 'good', statusLabel: '🟢 Healthy',  spark: [61, 68, 76, 84] },
  { name: 'Working Capital',          formula: 'Current Assets − Current Liabilities', value: '$209,178', benchmark: 'Positive', status: 'good', statusLabel: '🟢 Positive',  spark: [156000, 174000, 191000, 209178] },
];

const SOLVENCY: RatioCard[] = [
  { name: 'Debt-to-Equity',       formula: 'Total Debt / Equity',         value: '11.3x',   benchmark: '<5x RE',  status: 'monitor', statusLabel: '⚠️ High',          note: 'Normal for leveraged RE — focus on DSCR instead' },
  { name: 'Debt-to-Asset Ratio',  formula: 'Total Debt / Total Assets',   value: '91.9%',   benchmark: '<80%',    status: 'monitor', statusLabel: '⚠️ Leveraged',      note: 'Typical for leveraged residential RE portfolio' },
  { name: 'Equity Ratio',         formula: 'Equity / Total Assets',       value: '8.1%',    benchmark: '>20%',    status: 'monitor', statusLabel: '⚠️ Low Equity',     note: 'Building equity through paydown — early portfolio phase' },
  { name: 'Interest Coverage',    formula: 'EBIT / Interest Expense',     value: '0.92x',   benchmark: '>1.5x',   status: 'monitor', statusLabel: '⚠️ Tight',          note: 'Includes depreciation; cash NOI coverage is 1.24x (DSCR)', spark: [0.74, 0.81, 0.88, 0.92] },
  { name: 'DSCR',                 formula: 'NOI / Total Debt Service',    value: '1.24x',   benchmark: '>1.25x',  status: 'watch',   statusLabel: '🟡 At Floor',       spark: [1.18, 1.20, 1.22, 1.24] },
  { name: 'Loan-to-Value (LTV)',  formula: 'Mortgage / Property Value',   value: '84.8%',   benchmark: '<80%',    status: 'monitor', statusLabel: '⚠️ High LTV',       spark: [87.4, 86.8, 85.9, 84.8] },
  { name: 'Net Debt',             formula: 'Total Debt − Cash',           value: '$9.55M',  benchmark: 'Monitor', status: 'info',    statusLabel: 'ℹ️ Monitor',        note: 'Mortgage-heavy; declining as principal paid down' },
  { name: 'Debt Service Ratio',   formula: 'Debt Service / NOI',          value: '80.6%',   benchmark: '<65%',    status: 'critical',statusLabel: '🔴 High',           spark: [85.8, 84.1, 82.0, 80.6] },
  { name: 'Fixed Charge Coverage',formula: '(NOI + Fixed) / Fixed Chgs',  value: '1.18x',   benchmark: '>1.25x',  status: 'watch',   statusLabel: '🟡 Borderline',     spark: [1.08, 1.11, 1.15, 1.18] },
];

const RENTAL_KPIS: RatioCard[] = [
  { name: 'Occupancy Rate',         formula: 'Occupied / Total Units',      value: '83.3%',    benchmark: '>90%',      status: 'watch',    statusLabel: '🟡 Below Target', spark: [79.2, 81.7, 82.5, 83.3] },
  { name: 'Economic Occupancy',     formula: 'Rent Collected / Gross Pot.',  value: '88.4%',    benchmark: '>92%',      status: 'watch',    statusLabel: '🟡 Below',        spark: [83.1, 85.4, 87.0, 88.4] },
  { name: 'Rent Collection Rate',   formula: 'Collected / Billed',           value: '88.4%',    benchmark: '>95%',      status: 'watch',    statusLabel: '🟡 Below Target', spark: [84.6, 86.2, 87.5, 88.4] },
  { name: 'Vacancy Rate',           formula: 'Vacant / Total Units',         value: '16.7%',    benchmark: '<10%',      status: 'critical', statusLabel: '🔴 High',         spark: [20.8, 18.3, 17.5, 16.7] },
  { name: 'Loss to Lease',          formula: '(Market − Actual) / Market',  value: '3.1%',     benchmark: '<5%',       status: 'good',     statusLabel: '🟢 Controlled',   spark: [4.8, 4.1, 3.6, 3.1] },
  { name: 'Avg Days Vacant',        formula: 'Avg days between tenants',     value: '~28 days', benchmark: '<21 days',  status: 'watch',    statusLabel: '🟡 Watch',        spark: [36, 33, 30, 28] },
  { name: 'Rent per Sq Ft',         formula: 'Avg Rent / Avg SqFt',          value: '$1.57/sf', benchmark: '>$1.50',    status: 'good',     statusLabel: '🟢 Good',         spark: [1.42, 1.48, 1.53, 1.57] },
  { name: 'Revenue per Unit',       formula: 'Total Rev / Total Units',      value: '$1,591/mo',benchmark: '>$1,500',   status: 'good',     statusLabel: '🟢 Good',         spark: [1440, 1502, 1551, 1591] },
  { name: 'Expense per Unit',       formula: 'Total OpEx / Occupied Units',  value: '$956/mo',  benchmark: '<$1,000',   status: 'good',     statusLabel: '🟢 Controlled',   spark: [1024, 998, 974, 956] },
  { name: 'Cap Rate',               formula: 'NOI / Property Value',         value: '4.7%',     benchmark: '4–6% AZ',   status: 'good',     statusLabel: '🟢 Market',       spark: [4.1, 4.3, 4.5, 4.7] },
  { name: 'Price / Rent Ratio',     formula: 'Prop Value / Annual Rent',     value: '17.8x',    benchmark: '<20x',      status: 'good',     statusLabel: '🟢 Reasonable' },
  { name: 'EGIM',                   formula: 'Prop Value / EGI',             value: '9.3x',     benchmark: '<12x',      status: 'good',     statusLabel: '🟢 Acceptable',   note: 'Effective Gross Income Multiplier' },
];

const COST_RATIOS: RatioCard[] = [
  { name: 'WACC',                  formula: 'Wtd Avg Cost of Capital',      value: '6.82%',   benchmark: '<8%',         status: 'good',    statusLabel: '🟢 Good',          spark: [7.21, 7.05, 6.94, 6.82] },
  { name: 'Cost of Debt',          formula: 'Interest / Total Debt',        value: '5.84%',   benchmark: '<7%',         status: 'good',    statusLabel: '🟢 Acceptable',    spark: [5.92, 5.90, 5.87, 5.84] },
  { name: 'Cost of Equity',        formula: 'Required return on equity',    value: '12.0%',   benchmark: '10–14% RE',   status: 'good',    statusLabel: '🟢 Market Rate',   note: 'Assumed; CAPM-based estimate for residential RE' },
  { name: 'Return vs WACC',        formula: 'Cap Rate − WACC',              value: '-2.12%',  benchmark: 'Positive',    status: 'monitor', statusLabel: '⚠️ Negative',      note: 'Property appreciation offsets current income shortfall' },
  { name: 'Economic Value Added',  formula: 'NOI − (WACC × Assets)',        value: '-$349K',  benchmark: 'Positive',    status: 'monitor', statusLabel: '⚠️ Below WACC',    note: 'Leverage amplifies returns — appreciation drives equity' },
  { name: 'Spread (Cap−WACC)',     formula: 'Cap Rate − WACC',              value: '-2.12%',  benchmark: 'Positive',    status: 'monitor', statusLabel: '⚠️ Negative Sprd',  note: 'Positive spread = value creation over cost of capital' },
  { name: 'Avg Mortgage Rate',     formula: 'Wtd avg fixed rate',           value: '5.84%',   benchmark: 'Market',      status: 'good',    statusLabel: '🟢 Fixed',         note: 'All loans on fixed rates — insulated from rate rises' },
  { name: 'Avg Remaining Term',    formula: 'Avg years to maturity',        value: '22 years',benchmark: '>15 yrs',     status: 'good',    statusLabel: '🟢 Long-term' },
  { name: 'Balloon Risk',          formula: 'Loans maturing <3 years',      value: '2 loans', benchmark: 'None',         status: 'monitor', statusLabel: '⚠️ Monitor',       note: 'Review loan maturity schedule — begin refi planning 3 years prior to maturity' },
];

// ── Dynamic ratio builder from uploaded financial data ─────────────────────────

function fmtPct(n: number, dec = 1) { return `${n.toFixed(dec)}%`; }
function fmtX(n: number, dec = 2)   { return `${n.toFixed(dec)}x`; }
function fmtDollar(n: number) {
  const a = Math.abs(n); const s = a >= 1_000_000 ? `$${(a/1_000_000).toFixed(2)}M` : a >= 1_000 ? `$${(a/1_000).toFixed(0)}K` : `$${a.toFixed(0)}`;
  return n < 0 ? `(${s})` : s;
}

function calcAllRatios(
  fin: LiveFin,
  activeYear?: number,
  totalDebt?: number | null,
): { profitability: RatioCard[]; liquidity: RatioCard[]; solvency: RatioCard[] } {
  const pl = fin.pl; const bs = fin.bs; const cf = fin.cf;
  const lastY = activeYear && fin.years.includes(activeYear) ? activeYear : fin.years[fin.years.length - 1];

  // Helpers
  const yv = (items: FinItem[], pat: RegExp, y: number) =>
    items.find(i => pat.test(i.label))?.values[y] ?? 0;
  const si = (items: FinItem[], pat: RegExp, y: number) =>
    items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label)).reduce((s, i) => s + (i.values[y] ?? 0), 0);

  // P&L figures (last year)
  const rev   = yv(pl,/^total\s+(for\s+)?income$/i,lastY) || yv(pl,/^gross\s+profit$/i,lastY) || si(pl,/income|revenue|rent/i,lastY);
  const exp   = yv(pl,/^total\s+(for\s+)?expenses?$/i,lastY) || Math.abs(si(pl,/^total\s+expenses/i,lastY));
  const ni    = yv(pl,/^net\s+income$/i,lastY);
  const intEx = Math.abs(yv(pl,/^total\s+for\s+interest\s+paid$/i,lastY) || si(pl,/interest/i,lastY));
  const depAm = Math.abs(si(pl,/depreciation|amortization/i,lastY));
  // Always derive NOI as (revenue − expenses + interest-add-back) — same formula as calcKpis in
  // RentalFinancials.tsx. Ignoring QBO's explicit "Net Operating Income" row because QBO defines
  // it as post-interest (revenue − ALL expenses including interest = $88.56K), which produces
  // a different NOI than the real-estate convention (pre-interest = $161K).
  const noi   = rev - exp + intEx;

  // BS figures
  const totalAssets = yv(bs,/^total\s+(for\s+)?assets$/i,lastY);
  const totalLiab   = yv(bs,/^total\s+(for\s+)?liabilities$/i,lastY) || yv(bs,/^total\s+for\s+liabilities\s+and\s+equity$/i,lastY);
  const equity      = yv(bs,/^total\s+(for\s+)?equity$/i,lastY);
  const cash        = yv(bs,/^total\s+(for\s+)?bank/i,lastY) || si(bs,/^bank|checking|savings|prosperity/i,lastY);
  const currAssets  = yv(bs,/^total\s+for\s+current\s+assets$/i,lastY) || yv(bs,/^total\s+current\s+assets$/i,lastY) || (cash + Math.abs(si(bs,/receivable/i,lastY)));
  const currLiab    = yv(bs,/^total\s+for\s+current\s+liabilities$/i,lastY) || yv(bs,/^total\s+current\s+liabilities$/i,lastY) || Math.abs(si(bs,/payable/i,lastY));
  const buildings   = Math.abs(
    yv(bs,/^buildings$/i,lastY) ||
    yv(bs,/^property\s*(and|&)?\s*equipment/i,lastY) ||
    yv(bs,/^fixed\s*assets/i,lastY) ||
    yv(bs,/^land\s*(and|&)?\s*buildings/i,lastY) ||
    yv(bs,/^real\s+estate/i,lastY)
  );
  const loans       = Math.abs(yv(bs,/^total\s+for\s+long.term\s+liabilities$/i,lastY) || si(bs,/long.term.*loan|loan\s+from|independent\s+bank/i,lastY));

  // CF figures
  const ocf = yv(cf,/^net\s+cash.*operating/i,lastY) || yv(cf,/^net\s+income$/i,lastY);

  // Sparklines across years
  const spark = (fn: (y: number) => number) => fin.years.slice(-4).map(fn);

  // Ratios
  const kLike = {
    noi, totalRevenue: rev, netIncome: ni, totalExpenses: exp, interestExpense: intEx,
    equity, totalAssets, totalLiabilities: totalLiab, rentalIncome: 0, managementFee: 0,
    repairs: 0, cash, buildings, longTermLoans: loans, depreciation: depAm,
    securityDeposits: 0, legalFees: 0, utilities: 0, hoa: 0, propertyTax: 0,
    insurance: 0, accumDep: 0, otherOpex: 0,
  };
  const noiM   = rev > 0 ? noi / rev * 100 : 0;
  const netM   = rev > 0 ? ni / rev * 100 : 0;
  const expR   = rev > 0 ? exp / rev * 100 : 0;
  const ebitdaM = ebitdaMarginPct(kLike) ?? 0;
  const roa    = totalAssets > 0 ? ni / totalAssets * 100 : 0;
  const roe    = equity > 0 ? ni / equity * 100 : 0;
  const grm    = rev > 0 ? (totalAssets > 0 ? totalAssets / rev : 0) : 0;

  const currR  = currLiab > 0 ? currAssets / currLiab : 0;
  const cashR  = currLiab > 0 ? cash / currLiab : 0;
  const ocfR   = currLiab > 0 ? Math.abs(ocf) / currLiab : 0;
  const wc     = currAssets - currLiab;
  const daysOp = exp > 0 ? (cash / (exp / 365)) : 0;

  const { debtToEquity: dte, debtToAsset: dta } = debtRatiosFromLoanTracker(totalDebt ?? null, kLike);
  const equR   = totalAssets > 0 ? equity / totalAssets * 100 : 0;
  const iCov   = intEx > 0 ? noi / intEx : 0;
  const ltv    = buildings > 0 ? loans / buildings * 100 : 0;
  const netDebt = loans - cash;
  const dscr   = (intEx > 0 || loans > 0) ? noi / (intEx * 1.2) : 0;

  const pill = (good: boolean, watch: boolean): { status: RatioCard['status']; label: string } => ({
    status: good ? 'good' : watch ? 'watch' : 'critical',
    label: good ? '✓ Good' : watch ? '⚠ Watch' : '✗ Review',
  });

  const profitability: RatioCard[] = [
    { name: 'NOI Margin',              formula: 'NOI / Revenue',             value: noiM ? fmtPct(noiM) : '—',    benchmark: '>35%',   ...pill(noiM>=35, noiM>=20),   spark: spark(y => { const r = yv(pl,/^total\s+(for\s+)?income$/i,y)||si(pl,/income|revenue|rent/i,y); const e = yv(pl,/^total\s+(for\s+)?expenses?$/i,y); const ie = Math.abs(si(pl,/interest/i,y)); const n = r-e+ie; return r>0?n/r*100:0; }) },
    { name: 'Net Profit Margin',       formula: 'Net Income / Revenue',      value: rev>0 ? fmtPct(netM) : '—',   benchmark: '>10%',   ...pill(netM>=10, netM>=0) },
    { name: 'Operating Expense Ratio', formula: 'Total OpEx / Revenue',      value: rev>0 ? fmtPct(expR) : '—',   benchmark: '<60%',   ...pill(expR<=60, expR<=85) },
    { name: 'EBITDA Margin',           formula: 'NOI / Revenue (EBITDA ≡ NOI)', value: rev>0 ? fmtPct(ebitdaM) : '—',benchmark: '>45%',   ...pill(ebitdaM>=45, ebitdaM>=30) },
    { name: 'Return on Assets',        formula: 'Net Income / Total Assets', value: totalAssets>0 ? fmtPct(roa) : '—', benchmark: '>4%', ...pill(roa>=4, roa>=2) },
    { name: 'Return on Equity',        formula: 'Net Income / Equity',       value: equity>0 ? fmtPct(roe) : '—', benchmark: '>8%',   ...pill(roe>=8, roe>=4) },
    { name: 'Revenue',                 formula: 'Total Income',              value: fmtDollar(rev),                benchmark: 'Trend',  status: 'info', statusLabel: 'ℹ Info', spark: spark(y => yv(pl,/^total\s+(for\s+)?income$/i,y)||si(pl,/income|revenue|rent/i,y)) },
    { name: 'Net Income',              formula: 'Revenue − Expenses',        value: fmtDollar(ni),                 benchmark: 'Positive', ...pill(ni>0, ni>-5000) },
    { name: 'Gross Rent Multiple',     formula: 'Asset Value / Ann. Revenue',value: grm > 0 ? fmtX(grm,1) : '—', benchmark: '<14x',   ...pill(grm>0&&grm<14, grm<18) },
  ];

  const liquidity: RatioCard[] = [
    { name: 'Current Ratio',             formula: 'Current Assets / CL',        value: currR>0 ? fmtX(currR) : '—',  benchmark: '>1.5x',    ...pill(currR>=1.5, currR>=1.0),  spark: spark(y => { const ca = yv(bs,/^total\s+for\s+current\s+assets/i,y)||yv(bs,/^total\s+current\s+assets/i,y); const cl = yv(bs,/^total\s+for\s+current\s+liab/i,y)||yv(bs,/^total\s+current\s+liab/i,y); return cl>0?ca/cl:0; }) },
    { name: 'Cash Ratio',                formula: 'Cash / Current Liabilities', value: cashR>0 ? fmtX(cashR) : '—',  benchmark: '>0.2x',    ...pill(cashR>=0.2, cashR>=0.1) },
    { name: 'Operating CF Ratio',        formula: 'OCF / Current Liabilities',  value: ocfR>0 ? fmtX(ocfR) : '—',   benchmark: '>1.0x',    ...pill(ocfR>=1.0, ocfR>=0.5) },
    { name: 'Working Capital',           formula: 'Current Assets − CL',        value: fmtDollar(wc),                 benchmark: 'Positive', ...pill(wc>0, wc>-10000), spark: spark(y => { const ca = yv(bs,/^total\s+for\s+current\s+assets/i,y)||yv(bs,/^total\s+current\s+assets/i,y); const cl = yv(bs,/^total\s+for\s+current\s+liab/i,y)||yv(bs,/^total\s+current\s+liab/i,y); return ca-cl; }) },
    { name: 'Cash & Bank Balance',       formula: 'Total Bank Accounts',        value: fmtDollar(cash),               benchmark: 'Positive', ...pill(cash>50000, cash>10000), spark: spark(y => yv(bs,/^total\s+(for\s+)?bank/i,y)||si(bs,/^bank|checking|savings|prosperity/i,y)) },
    { name: 'Days Cash on Hand',         formula: 'Cash / Daily OpEx',          value: daysOp>0 ? `${daysOp.toFixed(0)} days` : '—', benchmark: '>60 days', ...pill(daysOp>=60, daysOp>=30) },
  ];

  const solvency: RatioCard[] = [
    { name: 'Debt-to-Equity',     formula: 'Total Debt (Loan Tracker) / Equity', value: dte != null ? fmtX(dte, 1) : '— no loan data', benchmark: '<5x RE', ...pill(dte != null && dte <= 3, dte != null && dte <= 6) },
    { name: 'Debt-to-Asset',      formula: 'Total Debt / Total Assets',    value: dta != null ? fmtPct(dta) : '— no loan data', benchmark: '<80%', ...pill(dta != null && dta <= 70, dta != null && dta <= 85) },
    { name: 'Equity Ratio',       formula: 'Equity / Total Assets',         value: totalAssets>0 ? fmtPct(equR) : '—', benchmark: '>20%', ...pill(equR>=20, equR>=10) },
    { name: 'Interest Coverage',  formula: 'NOI / Interest Expense',        value: intEx>0 ? fmtX(iCov) : '—',    benchmark: '>1.5x',   ...pill(iCov>=1.5, iCov>=1.0), spark: spark(y => { const r = yv(pl,/^total\s+(for\s+)?income$/i,y)||si(pl,/income|revenue|rent/i,y); const e = yv(pl,/^total\s+(for\s+)?expenses?$/i,y); const ie = Math.abs(si(pl,/interest/i,y)); return ie>0?(r-e+ie)/ie:0; }) },
    { name: 'LTV',                formula: 'Mortgage / Property Value',     value: buildings>0 ? fmtPct(ltv) : 'No bldg value', benchmark: '<80%',  ...pill(ltv<=70, ltv<=85), spark: spark(y => { const b = Math.abs(yv(bs,/^buildings$/i,y)||yv(bs,/^property\s*(and|&)?\s*equipment/i,y)||yv(bs,/^fixed\s*assets/i,y)||yv(bs,/^land\s*(and|&)?\s*buildings/i,y)||yv(bs,/^real\s+estate/i,y)); const l = Math.abs(yv(bs,/^total\s+for\s+long.term/i,y)||si(bs,/long.term.*loan|loan\s+from|independent\s+bank/i,y)); return b>0?l/b*100:0; }) },
    { name: 'Net Debt',           formula: 'Long-term Loans − Cash',       value: fmtDollar(netDebt),              benchmark: 'Monitor', status: 'info', statusLabel: 'ℹ Info' },
    { name: 'DSCR (Est.)',        formula: 'NOI / (Interest × 1.2)',        value: dscr>0 ? fmtX(dscr) : '—',     benchmark: '>1.25x',  ...pill(dscr>=1.25, dscr>=1.0) },
    { name: 'Total Assets',       formula: 'Balance Sheet Total',           value: fmtDollar(totalAssets),          benchmark: 'Trend',   status: 'info', statusLabel: 'ℹ Info' },
    { name: 'Equity',             formula: "Owner's Net Worth",             value: fmtDollar(equity),               benchmark: 'Positive', ...pill(equity>0, equity>-10000) },
  ];

  return { profitability, liquidity, solvency };
}

// ── Tab components ─────────────────────────────────────────────────────────────

function ProfitabilityTab({ coData, trendData, liveCards, liveFin, auditProps }: {
  coData: any[]; trendData: any[]; liveCards?: RatioCard[]; liveFin?: LiveFin;
} & { auditProps?: CardGridAuditProps }) {
  const cards = liveCards ?? PROFITABILITY;
  const { profTrend, retTrend } = liveFin ? buildTrendFromLive(liveFin) : buildTrendFromSparks(cards);

  return (
    <div className="space-y-6">
      <CardGrid cards={cards} {...auditProps} />

      {/* ── NEW: Benchmark bullet-chart strip ──────────────────────────── */}
      <BulletStripForRatios cards={cards} />

      {/* ── NEW: Trend charts ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917' }}>Profitability Trend</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3, marginBottom: 16 }}>
            NOI Margin · EBITDA Margin · Net Profit Margin over time
          </div>
          <ProfTrendChart data={profTrend} />
        </div>
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917' }}>Returns Trend</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3, marginBottom: 16 }}>
            Return on Assets · Return on Equity · Cash-on-Cash Return
          </div>
          <RetTrendChart data={retTrend} />
        </div>
      </div>
    </div>
  );
}

/* ── Liquidity & Cash: bullet definitions ── */
const LIQUIDITY_BULLET_DEFS: BulletDef[] = [
  { names: ['Current Ratio'],
    benchmark: 1.5, unit: 'x', reversed: false, max: 5,
    extract: v => parseFloat(v) || 0 },
  { names: ['Quick Ratio'],
    benchmark: 1.0, unit: 'x', reversed: false, max: 5,
    extract: v => parseFloat(v) || 0 },
  { names: ['Cash Ratio'],
    benchmark: 0.2, unit: 'x', reversed: false, max: 1.5,
    extract: v => parseFloat(v) || 0 },
  { names: ['Operating Cash Flow Ratio', 'Operating CF Ratio'],
    benchmark: 1.0, unit: 'x', reversed: false, max: 3,
    extract: v => parseFloat(v) || 0 },
  { names: ['Days Cash on Hand'],
    benchmark: 60, unit: 'd', reversed: false, max: 120,
    extract: v => parseFloat(v) || 0 },
  { names: ['Working Capital'],
    benchmark: 0, unit: 'k', reversed: false, max: 400,
    extract: v => {
      const neg = v.includes('(');
      const raw = parseFloat(v.replace(/[$,()KkMm]/g, '')) || 0;
      const scaled = v.includes('M') || v.includes('m') ? raw * 1000 : v.includes('K') || v.includes('k') ? raw : raw / 1000;
      return neg ? 0 : scaled;
    }},
];

type LiqPt = { label: string; currR: number; quickR: number; cashR: number; ocfR: number; daysC: number; wc: number; ca?: number; cl?: number };
type WcRow  = { label: string; invisible: number; bar: number; fill: string };

function buildLiqTrendFromSparks(cards: RatioCard[]): { liqTrend: LiqPt[]; cashTrend: { label: string; days: number }[]; wcData: WcRow[] } {
  const g = (name: string) => cards.find(c => c.name === name);
  const sp = (c?: RatioCard) => (c?.spark ?? []).map(Number);
  const currSp = sp(g('Current Ratio'));
  const cashSp = sp(g('Cash Ratio'));
  const ocfSp  = sp(g('Operating Cash Flow Ratio') ?? g('Operating CF Ratio'));
  const dcSp   = sp(g('Days Cash on Hand'));
  const n      = Math.max(currSp.length, cashSp.length, ocfSp.length, dcSp.length, 1);
  const labels = ['T-3', 'T-2', 'T-1', 'Latest'].slice(-n);
  const liqTrend: LiqPt[] = labels.map((label, i) => ({
    label, currR: currSp[i] ?? NaN, quickR: currSp[i] ?? NaN,
    cashR: cashSp[i] ?? NaN, ocfR: ocfSp[i] ?? NaN, daysC: dcSp[i] ?? NaN, wc: NaN,
  }));
  const cashTrend = dcSp.map((days, i) => ({ label: labels[i] ?? `T-${dcSp.length - i}`, days }));
  const currRv = parseFloat(g('Current Ratio')?.value ?? '3.86') || 3.86;
  const wcV    = parseFloat((g('Working Capital')?.value ?? '$209178').replace(/[$,()]/g, '')) || 209178;
  const cl     = wcV / (currRv - 1);
  const ca     = cl * currRv;
  const wcData: WcRow[] = [
    { label: 'Curr. Assets',  invisible: 0,              bar: Math.round(ca),  fill: '#0F766E' },
    { label: '− Liabilities', invisible: Math.round(wcV), bar: Math.round(cl),  fill: '#C0392B' },
    { label: 'Working Cap.',  invisible: 0,              bar: Math.round(wcV), fill: '#166534' },
  ];
  return { liqTrend, cashTrend, wcData };
}

function buildLiqTrendFromLive(fin: LiveFin): { liqTrend: LiqPt[]; cashTrend: { label: string; days: number }[]; wcData: WcRow[] } {
  const { pl, bs, years } = fin;
  const yv = (items: FinItem[], pat: RegExp, y: number) => items.find(i => pat.test(i.label))?.values[y] ?? 0;
  const si = (items: FinItem[], pat: RegExp, y: number) =>
    items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label)).reduce((s, i) => s + (i.values[y] ?? 0), 0);
  const pts: LiqPt[] = years.map(y => {
    const cash = Math.abs(yv(bs, /^total\s+for\s+bank/i, y)) || Math.abs(si(bs, /bank|checking|savings|cash/i, y));
    const ca   = Math.abs(yv(bs, /^total\s+for\s+current\s+assets/i, y)) || (cash + Math.abs(si(bs, /receivable/i, y)));
    const cl   = Math.abs(yv(bs, /^total\s+for\s+current\s+liab/i, y)) || Math.abs(si(bs, /payable/i, y));
    const exp  = Math.abs(yv(pl, /^total.*expense/i, y));
    const ocf  = yv(pl, /^net\s+income/i, y);
    return {
      label: String(y), currR: cl > 0 ? ca / cl : 0, quickR: cl > 0 ? ca / cl : 0,
      cashR: cl > 0 ? cash / cl : 0, ocfR: cl > 0 ? Math.abs(ocf) / cl : 0,
      daysC: exp > 0 ? cash / (exp / 365) : 0, wc: ca - cl, ca, cl,
    };
  });
  const cashTrend = pts.map(p => ({ label: p.label, days: Math.round(p.daysC) }));
  const last = pts[pts.length - 1] ?? { ca: 0, cl: 0, wc: 0 };
  const wc = Math.max(0, last.wc ?? 0);
  const wcData: WcRow[] = [
    { label: 'Curr. Assets',  invisible: 0,              bar: Math.round(last.ca ?? 0), fill: '#0F766E' },
    { label: '− Liabilities', invisible: Math.round(wc), bar: Math.round(last.cl ?? 0), fill: '#C0392B' },
    { label: 'Working Cap.',  invisible: 0,              bar: Math.round(wc),            fill: '#166534' },
  ];
  return { liqTrend: pts, cashTrend, wcData };
}

const LIQ_PANEL = { background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '16px 20px' } as const;
const LIQ_H3    = { fontSize: 13, color: '#1C1917', fontWeight: 600, marginBottom: 16 } as const;

function LiqRatiosTrendChart({ data }: { data: LiqPt[] }) {
  if (!data.length) return null;
  const LINES: { key: keyof LiqPt; label: string; color: string }[] = [
    { key: 'currR',  label: 'Current Ratio',  color: '#0F766E' },
    { key: 'quickR', label: 'Quick Ratio',    color: '#D4AF37' },
    { key: 'cashR',  label: 'Cash Ratio',     color: '#C0392B' },
    { key: 'ocfR',   label: 'OCF Ratio',      color: '#4E79A7' },
  ];
  return (
    <div style={LIQ_PANEL}>
      <h3 style={LIQ_H3}>Liquidity Ratios — Trend</h3>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => `${v}x`} width={36} />
          <Tooltip formatter={(v: number, name: string) => [`${(+v).toFixed(2)}x`, name]} contentStyle={{ fontSize: 11 }} />
          <ReferenceLine y={1.5} stroke="#0F766E" strokeDasharray="4 2" strokeWidth={1} />
          <ReferenceLine y={1.0} stroke="#C0392B" strokeDasharray="4 2" strokeWidth={1} />
          {LINES.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key as string} name={l.label}
              stroke={l.color} strokeWidth={2} dot={{ r: 3, fill: l.color }}
              activeDot={{ r: 5, strokeWidth: 1.5, stroke: l.color, fill: '#fff' }}
              connectNulls />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {LINES.map(l => (
          <span key={l.key} style={{ fontSize: 11, color: '#57534E', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 20, height: 2, background: l.color, borderRadius: 1 }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function DaysCashChart({ data }: { data: { label: string; days: number }[] }) {
  const colored = data.map(d => ({ ...d, fill: d.days < 30 ? '#C0392B' : d.days < 60 ? '#F2C94C' : '#166534' }));
  return (
    <div style={LIQ_PANEL}>
      <h3 style={LIQ_H3}>Days Cash on Hand — Runway</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={colored} margin={{ left: 0, right: 48, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => `${v}d`} width={36} domain={[0, 'auto']} />
          <Tooltip formatter={(v: number) => [`${v} days`, 'Days Cash on Hand']} contentStyle={{ fontSize: 11 }} />
          <ReferenceLine y={60} stroke="#D4AF37" strokeDasharray="5 3" strokeWidth={1.5}
            label={{ value: '60d floor', position: 'right', fontSize: 9, fill: '#B8860B' }} />
          <ReferenceLine y={30} stroke="#C0392B" strokeDasharray="4 2" strokeWidth={1}
            label={{ value: '30d min', position: 'right', fontSize: 9, fill: '#C0392B' }} />
          <Bar dataKey="days" name="Days Cash" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {colored.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: '#57534E' }}>
        {[['#166534', '> 60 days'], ['#F2C94C', '30–60 days'], ['#C0392B', '< 30 days']].map(([bg, label]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ background: bg, display: 'inline-block', width: 10, height: 10, borderRadius: 2 }} />{label}
          </span>
        ))}
      </div>
    </div>
  );
}

function WcCompositionChart({ data }: { data: WcRow[] }) {
  const fmt = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${n.toLocaleString()}`;
  return (
    <div style={LIQ_PANEL}>
      <h3 style={LIQ_H3}>Working Capital Composition — Waterfall</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ left: 20, right: 20, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`} width={52} />
          <Tooltip
            formatter={(v: number, name: string) => name === 'invisible' ? (null as any) : [fmt(v), 'Amount']}
            labelFormatter={l => String(l)}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="invisible" stackId="wf" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="bar" stackId="wf" radius={[4, 4, 0, 0]} isAnimationActive={false} name="Amount">
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: '#57534E' }}>
        {[['#0F766E', 'Current Assets'], ['#C0392B', 'Current Liabilities'], ['#166534', 'Working Capital']].map(([bg, label]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ background: bg, display: 'inline-block', width: 10, height: 10, borderRadius: 2 }} />{label}
          </span>
        ))}
      </div>
    </div>
  );
}

function LiquidityTab({ coData: _coData, liveCards, liveFin, auditProps }: {
  coData: any[]; liveCards?: RatioCard[]; liveFin?: LiveFin;
} & { auditProps?: CardGridAuditProps }) {
  const cards = liveCards ?? LIQUIDITY;
  const { liqTrend, cashTrend, wcData } = liveFin
    ? buildLiqTrendFromLive(liveFin)
    : buildLiqTrendFromSparks(cards);
  return (
    <div className="space-y-6">
      <CardGrid cards={cards} {...auditProps} />
      <BulletStripForRatios cards={cards} defs={LIQUIDITY_BULLET_DEFS} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LiqRatiosTrendChart data={liqTrend} />
        <DaysCashChart data={cashTrend} />
      </div>
      <WcCompositionChart data={wcData} />
    </div>
  );
}

function SolvencyTab({ coData, liveCards, auditProps }: {
  coData: any[]; liveCards?: RatioCard[];
} & { auditProps?: CardGridAuditProps }) {
  const cards = liveCards ?? SOLVENCY;
  return (
    <div className="space-y-6">
      <CardGrid cards={cards} {...auditProps} />

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex gap-2 items-start">
          <span className="text-blue-500 text-lg shrink-0">ℹ️</span>
          <div>
            <p className="text-sm font-semibold text-blue-900">CFO Note: High leverage ratios are EXPECTED for residential rental portfolios.</p>
            <p className="text-xs text-blue-700 mt-1">
              The key metrics to watch are DSCR (&gt;1.25x) and LTV (&lt;80%). Focus on NOI improvement to create buffer.
              Leverage ratios will naturally decline as mortgages amortize.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 style={{ fontSize: 13, color: '#262626', fontWeight: 600, marginBottom: 16 }}>DSCR vs Interest Coverage by Company</h3>
        {coData.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-gray-500">No company data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            {(() => { const dscrData = coData.filter(d => d.dscr > 0 || d.icr > 0); return (
            <ComposedChart data={dscrData} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}x`} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(2)}x`]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={1.25} stroke="#166534" strokeDasharray="4 2" label={{ value: '1.25x DSCR floor', position: 'right', fontSize: 9, fill: '#166534' }} />
              <ReferenceLine y={1.5}  stroke="#B8860B" strokeDasharray="4 2" label={{ value: '1.5x ICR benchmark', position: 'right', fontSize: 9, fill: '#B8860B' }} />
              <Bar dataKey="dscr" name="DSCR" radius={[3, 3, 0, 0]}>
                {dscrData.map((d, i) => (
                  <Cell key={i} fill={d.dscr >= 1.25 ? '#166534' : d.dscr >= 1.0 ? '#F5A623' : '#B91C1C'} />
                ))}
              </Bar>
              <Bar dataKey="icr"  name="Interest Coverage" fill="#B8860B" radius={[3, 3, 0, 0]} />
            </ComposedChart>); })()}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function RentalKPIsTab({ coData }: { coData: any[] }) {
  return (
    <div className="space-y-6">
      <CardGrid cards={RENTAL_KPIS} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 style={{ fontSize: 13, color: '#262626', fontWeight: 600, marginBottom: 16 }}>Occupancy Rate by Company vs 90% Target</h3>
          {coData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-gray-500">No company data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              {(() => { const occData = coData.filter(d => d.occ > 0); return (
              <BarChart data={occData} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[60, 100]} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Occupancy']} />
                <ReferenceLine y={90} stroke="#B91C1C" strokeDasharray="4 2" label={{ value: '90% target', position: 'right', fontSize: 9, fill: '#B91C1C' }} />
                <Bar dataKey="occ" name="Occupancy %" radius={[3, 3, 0, 0]}>
                  {occData.map((d, i) => (
                    <Cell key={i} fill={d.occ >= 90 ? '#166534' : d.occ >= 75 ? '#F5A623' : '#B91C1C'} />
                  ))}
                </Bar>
              </BarChart>); })()}
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 style={{ fontSize: 13, color: '#262626', fontWeight: 600, marginBottom: 16 }}>Revenue per Unit vs Expense per Unit</h3>
          {coData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-gray-500">No company data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={coData.filter(d => d.revUnit > 0 || d.expUnit > 0)} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v: number) => [fmt$(v)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="revUnit" name="Revenue / Unit"  fill="#2F80ED" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expUnit" name="Expense / Unit"  fill="#F2994A" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function CostOfCapitalTab({ loanData }: { loanData: any[] }) {
  return (
    <div className="space-y-6">
      <CardGrid cards={COST_RATIOS} />

      {/* Loan Schedule Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>Loan Schedule — All Rental Companies</h3>
        </div>
        {loanData.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-500">No loans found for rental companies</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: '#EFE0C8' }}>
                  {['Company','Loan Amount','Rate','Monthly Pmt','Balance','LTV','Maturity','Status'].map(h => (
                    <th key={h} style={{ fontSize: 11, fontWeight: 600, color: '#5C5043', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 12px', textAlign: h === 'Company' ? 'left' : 'center' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loanData.map(l => (
                  <tr key={l.company} className="hover:bg-gray-50">
                    <td style={{ fontSize: 12, fontWeight: 500, color: '#262626', padding: '8px 12px', whiteSpace: 'nowrap' }}>{l.company}</td>
                    <td style={{ fontSize: 12, color: '#262626', fontFamily: 'monospace', padding: '8px 12px', textAlign: 'right' }}>{fmt$(l.amount)}</td>
                    <td style={{ fontSize: 12, color: l.rate > 7 ? '#B91C1C' : l.rate > 5.5 ? '#F5A623' : '#166534', fontFamily: 'monospace', fontWeight: 600, padding: '8px 12px', textAlign: 'center' }}>{l.rate.toFixed(2)}%</td>
                    <td style={{ fontSize: 12, color: '#262626', fontFamily: 'monospace', padding: '8px 12px', textAlign: 'right' }}>{fmt$(l.payment)}</td>
                    <td style={{ fontSize: 12, color: '#262626', fontFamily: 'monospace', padding: '8px 12px', textAlign: 'right' }}>{fmt$(l.balance)}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 600, padding: '8px 12px', textAlign: 'center', color: l.ltv === null ? '#B0B0B0' : l.ltv > 80 ? '#B91C1C' : l.ltv > 60 ? '#F5A623' : '#166534' }}>
                      {l.ltv === null ? 'N/A' : `${l.ltv.toFixed(1)}%`}
                    </td>
                    <td style={{ fontSize: 12, color: '#262626', padding: '8px 12px', textAlign: 'center' }}>{l.maturity}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: l.highLtv ? '#FFF3CD' : '#D4EDDA', color: l.highLtv ? '#92400E' : '#155724' }}>
                        {l.highLtv ? 'High LTV' : 'Acceptable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CFO Insights */}
      <div className="space-y-3">
        {loanData.length > 0 && [
          { icon: '💡', text: 'Review active loans and refinancing opportunities at current market rates.' },
          { icon: '💡', text: 'Monitor loans approaching maturity dates and plan refinancing strategy in advance.' },
          { icon: '💡', text: 'Track LTV ratios — lower LTV unlocks better refinancing rates and covenant relief.' },
        ].map((item, i) => (
          <div key={i} className="flex gap-3 items-start bg-amber-50 border border-amber-200 rounded-xl p-4">
            <span className="text-base shrink-0">{item.icon}</span>
            <p className="text-sm text-amber-900">{item.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const RATIO_TABS: RatioTab[] = ['Profitability', 'Liquidity', 'Solvency', 'Rental KPIs', 'Cost of Capital'];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const NOW = new Date();

export default function RentalFinancialRatios() {
  const { isKpiAdmin } = useKpiAdminAccess();
  const [activeTab, setActiveTab] = useState<RatioTab>('Profitability');
  const [companies, setCompanies] = useState<CoOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [expandedKpi, setExpandedKpi] = useState<string | null>(null);
  const [liveData, setLiveData] = useState<LiveFin | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [coData, setCoData] = useState<any[]>([]);
  const [loanData, setLoanData] = useState<any[]>([]);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(NOW.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(NOW.getMonth() + 1);

  const { rowsByKpi } = useCompanyKpiAudit({
    companyId: selectedId || null,
    month: selectedMonth,
    year: selectedYear,
    enabled: isKpiAdmin && !!selectedId,
  });

  const auditProps: CardGridAuditProps = {
    rowsByKpi,
    showBreakdown: isKpiAdmin && !!selectedId,
    expandedKpi,
    onToggleKpi: (name) => setExpandedKpi(prev => prev === name ? null : name),
  };

  // Available years: from liveData if present, else current year ± 4
  const availableYears = liveData?.years.length
    ? [...liveData.years].sort((a, b) => b - a)
    : Array.from({ length: 5 }, (_, i) => NOW.getFullYear() - i);

  useEffect(() => {
    api.get<CoOption[]>('/api/rentals/companies')
      .then(res => setCompanies(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, []);

  // Fetch real company data, loans, and calculate metrics
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoadingData(true);
        const periodParams = `?year=${selectedYear}&month=${selectedMonth}`;
        const [companiesRes, portfolioRes, loansRes] = await Promise.all([
          api.get<any[]>('/api/rentals/companies'),
          api.get<any>(`/api/rentals/portfolio-summary${periodParams}`),
          api.get<any>('/api/real-estate/loans'),
        ]);

        const companyList = Array.isArray(companiesRes.data) ? companiesRes.data : [];
        const portfolio = portfolioRes.data || {};
        const loansResp = loansRes.data || {};

        // Build company data from portfolio
        const newCoData = (portfolio.by_company || []).map((c: any) => ({
          name: c.company_name || c.company_id,
          occ: c.occupancy_pct ? c.occupancy_pct * 100 : 0,
          revUnit: c.rent_per_unit || 0,
          expUnit: c.expense_per_unit || 0,
          dscr: c.dscr || 0,
          icr: c.icr || 0,
          currRatio: c.current_ratio || 0,
          noiMargin: c.noi_margin || 0,
        }));
        setCoData(newCoData);

        // Build loan data from real loans
        const newLoanData = (loansResp.items || [])
          .filter((l: any) => l.context_type === 'rental')
          .map((l: any) => ({
            company: l.company_name,
            amount: l.loan_amount || 0,
            rate: ((l.loan_interest_rate || 0) < 1 ? (l.loan_interest_rate || 0) * 100 : (l.loan_interest_rate || 0)),
            payment: l.loan_emi || 0,
            balance: l.loan_balance_as_of || 0,
            ltv: l.loan_balance_as_of && l.current_property_value
              ? (l.loan_balance_as_of / l.current_property_value) * 100
              : (l.ltv_current ? ((l.ltv_current < 1 ? l.ltv_current * 100 : l.ltv_current)) : null),
            maturity: l.loan_maturity_date ? new Date(l.loan_maturity_date).getFullYear() : '—',
            highLtv: (l.ltv_current || 0) > 0.8,
          }));
        setLoanData(newLoanData);

        // For trend data, we'd need historical data - for now show empty state
        setTrendData([]);
      } catch (err) {
        console.error('Error fetching financial data:', err);
        setCoData([]);
        setLoanData([]);
        setTrendData([]);
      } finally {
        setLoadingData(false);
      }
    };
    fetchData();
  }, [selectedYear, selectedMonth]);

  useEffect(() => {
    if (!selectedId) { setLiveData(null); return; }
    setLoadingLive(true);
    api.get<LiveFin>(`/api/rentals/financials/${selectedId}`)
      .then(res => setLiveData(res.data))
      .catch(() => setLiveData(null))
      .finally(() => setLoadingLive(false));
  }, [selectedId]);

  const selectedCompanyName = companies.find(c => c.id === selectedId)?.company_name;
  const selectedTotalDebt = useMemo(() => {
    if (!selectedCompanyName) return null;
    const scoped = loanData.filter(l => l.company === selectedCompanyName);
    if (scoped.length === 0) return null;
    return scoped.reduce((s, l) => s + (l.balance ?? 0), 0);
  }, [loanData, selectedCompanyName]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: '#B8860B' }}>FINANCIALS & RISK</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Financial Ratios & Analysis</h1>
        <p className="text-sm text-gray-500 mt-1">Rental Portfolio — Solvency, Profitability, Liquidity &amp; Rental KPIs</p>
      </div>

      {/* Company + Period selectors */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="">All Companies (Portfolio Benchmarks)</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>

        {/* Year picker */}
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg border border-amber-300 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          style={{ minWidth: 80 }}
        >
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {/* Month picker */}
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(Number(e.target.value))}
          className="px-3 py-1.5 rounded-lg border border-amber-300 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
          style={{ minWidth: 80 }}
        >
          {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>

        <span style={{ fontSize: 11, color: '#92400E', background: '#FFF7EE', border: '1px solid #F2994A', borderRadius: 6, padding: '3px 8px' }}>
          {MONTHS[selectedMonth - 1]} {selectedYear}
        </span>
        {selectedId && !liveData && !loadingLive && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            No financials uploaded for this company — go to Financials to upload P&amp;L/BS/CF
          </span>
        )}
        {loadingLive && <span className="text-xs text-gray-400">Loading live data…</span>}
      </div>

      {/* Live data panel — shown when company has uploaded financials */}
      {liveData && <LiveDataPanel fin={liveData} activeYear={selectedYear} totalDebt={selectedTotalDebt} />}

      {/* Live data badge */}
      {liveData && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#92400E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>● Live Data Active</span>
          <span style={{ fontSize: 12, color: '#78716C' }}>
            Ratio cards below are calculated from <strong style={{ color: '#1C1917' }}>{liveData.company_name}</strong>
            {' · '}year <strong style={{ color: '#1C1917' }}>{liveData.years.includes(selectedYear) ? selectedYear : liveData.years[liveData.years.length - 1]}</strong>
            {' · '}{MONTHS[selectedMonth - 1]} {selectedYear}
          </span>
        </div>
      )}
      {!selectedId && (
        <div style={{ background: '#FFF7EE', border: '1px solid #F2994A', borderRadius: 8, padding: '8px 14px' }}>
          <span style={{ fontSize: 12, color: '#92400E' }}>Select a company above to show ratio cards calculated from their actual uploaded P&L + Balance Sheet data.</span>
        </div>
      )}

      {/* Portfolio benchmark tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {RATIO_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              fontSize: 13, fontWeight: activeTab === tab ? 600 : 500,
              color: activeTab === tab ? '#92400E' : '#6B6B6B',
              borderBottom: activeTab === tab ? '2px solid #92400E' : '2px solid transparent',
              padding: '8px 16px', marginBottom: -1, background: 'none',
              whiteSpace: 'nowrap', transition: 'color 0.15s',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {(() => {
        const liveRatios = liveData ? calcAllRatios(liveData, selectedYear, selectedTotalDebt) : null;
        return (
          <div>
            {activeTab === 'Profitability'   && <ProfitabilityTab coData={coData} trendData={trendData} liveCards={liveRatios?.profitability} liveFin={liveData ?? undefined} auditProps={auditProps} />}
            {activeTab === 'Liquidity'       && <LiquidityTab coData={coData} liveCards={liveRatios?.liquidity} liveFin={liveData ?? undefined} auditProps={auditProps} />}
            {activeTab === 'Solvency'        && <SolvencyTab coData={coData} liveCards={liveRatios?.solvency} auditProps={auditProps} />}
            {activeTab === 'Rental KPIs'     && <RentalKPIsTab coData={coData} />}
            {activeTab === 'Cost of Capital' && <CostOfCapitalTab loanData={loanData} />}
          </div>
        );
      })()}
    </div>
  );
}
