/**
 * Calculation / analysis layer under Financial Ratio cards — shared Rentals + Prop Dev.
 * Cards first, then benchmark bullets + trend charts (mirrors Rentals Financial Ratios tabs).
 */
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ComposedChart, ReferenceLine,
} from 'recharts';
import { BulletChartStrip, type BulletDef } from '../shared/BulletChartStrip';
import { RatioCardGrid } from './RatioCardGrid';
import type { FinItem, LiveFin, RatioCard } from '../../utils/financialRatioCalc';

const PANEL = { background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 12, padding: '20px 24px' } as const;
const LIQ_PANEL = { background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 12, padding: '16px 20px' } as const;
const LIQ_H3 = { fontSize: 13, color: '#1C1917', fontWeight: 600, marginBottom: 16 } as const;

const EMPTY_CHART = (
  <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 12, textAlign: 'center' }}>
    Upload multi-year P&amp;L to populate historical trend
  </div>
);

const PROF_BULLET_DEFS: BulletDef[] = [
  {
    names: ['Net Profit Margin'],
    benchmark: 25, unit: '%', reversed: false, max: 80,
    extract: v => { const m = v.match(/NOI[:\s]+([0-9.]+)%/i); return m ? parseFloat(m[1]) : Math.max(0, parseFloat(v) || 0); },
  },
  { names: ['Operating Expense Ratio'], benchmark: 60, unit: '%', reversed: true, max: 130, extract: v => Math.abs(parseFloat(v)) || 0 },
  { names: ['Return on Assets'], benchmark: 4, unit: '%', reversed: false, max: 12, extract: v => parseFloat(v) || 0 },
  { names: ['Return on Equity'], benchmark: 8, unit: '%', reversed: false, max: 20, extract: v => parseFloat(v) || 0 },
  { names: ['EBITDA Margin'], benchmark: 45, unit: '%', reversed: false, max: 80, extract: v => parseFloat(v) || 0 },
  { names: ['NOI Margin'], benchmark: 35, unit: '%', reversed: false, max: 80, extract: v => parseFloat(v) || 0 },
  { names: ['Gross Rent Multiplier', 'Gross Rent Multiple'],
    benchmark: 14, unit: 'x', reversed: true, max: 22, extract: v => parseFloat(v) || 0 },
];

const LIQUIDITY_BULLET_DEFS: BulletDef[] = [
  { names: ['Current Ratio'], benchmark: 1.5, unit: 'x', reversed: false, max: 5, extract: v => parseFloat(v) || 0 },
  { names: ['Quick Ratio'], benchmark: 1.0, unit: 'x', reversed: false, max: 5, extract: v => parseFloat(v) || 0 },
  { names: ['Cash Ratio'], benchmark: 0.2, unit: 'x', reversed: false, max: 1.5, extract: v => parseFloat(v) || 0 },
  { names: ['Operating Cash Flow Ratio', 'Operating CF Ratio'],
    benchmark: 1.0, unit: 'x', reversed: false, max: 3, extract: v => parseFloat(v) || 0 },
  { names: ['Days Cash on Hand'], benchmark: 60, unit: 'd', reversed: false, max: 120, extract: v => parseFloat(v) || 0 },
  {
    names: ['Working Capital'],
    benchmark: 0, unit: 'k', reversed: false, max: 400,
    extract: v => {
      const neg = v.includes('(');
      const raw = parseFloat(v.replace(/[$,()KkMm]/g, '')) || 0;
      const scaled = v.includes('M') || v.includes('m') ? raw * 1000 : v.includes('K') || v.includes('k') ? raw : raw / 1000;
      return neg ? 0 : scaled;
    },
  },
];

type ProfPt = { label: string; npm: number | null; ebitda: number | null; noi: number | null };
type RetPt = { label: string; roa: number | null; roe: number | null; coc: number | null };
type LiqPt = { label: string; currR: number; quickR: number; cashR: number; ocfR: number; daysC: number; wc: number; ca?: number; cl?: number };
type WcRow = { label: string; invisible: number; bar: number; fill: string };

function yv(items: FinItem[], pat: RegExp, y: number) {
  return items.find(i => pat.test(i.label))?.values[y] ?? 0;
}
function si(items: FinItem[], pat: RegExp, y: number) {
  return items
    .filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label))
    .reduce((s, i) => s + (i.values[y] ?? 0), 0);
}

function buildTrendFromLive(fin: LiveFin): { profTrend: ProfPt[]; retTrend: RetPt[] } {
  const { pl, bs, years } = fin;
  return {
    profTrend: years.map(y => {
      const rev = yv(pl, /^total\s+(for\s+)?income$/i, y) || si(pl, /income|revenue|rent|sales/i, y);
      const exp = yv(pl, /^total\s+(for\s+)?expenses?$/i, y);
      const ni = yv(pl, /^net\s+income$/i, y);
      const ie = Math.abs(si(pl, /interest/i, y));
      const noi = rev - exp + ie;
      return {
        label: String(y),
        npm: rev > 0 ? +(ni / rev * 100).toFixed(1) : null,
        ebitda: rev > 0 ? +(noi / rev * 100).toFixed(1) : null,
        noi: rev > 0 ? +(noi / rev * 100).toFixed(1) : null,
      };
    }),
    retTrend: years.map(y => {
      const ni = yv(pl, /^net\s+income$/i, y);
      const assets = yv(bs, /^total\s+(for\s+)?assets$/i, y);
      const eq = yv(bs, /^total\s+(for\s+)?equity$/i, y);
      return {
        label: String(y),
        roa: assets > 0 ? +(ni / assets * 100).toFixed(1) : null,
        roe: eq > 0 ? +(ni / eq * 100).toFixed(1) : null,
        coc: null,
      };
    }),
  };
}

function buildLiqTrendFromLive(fin: LiveFin): { liqTrend: LiqPt[]; cashTrend: { label: string; days: number }[]; wcData: WcRow[] } {
  const { pl, bs, years } = fin;
  const pts: LiqPt[] = years.map(y => {
    const cash = Math.abs(yv(bs, /^total\s+for\s+bank/i, y)) || Math.abs(si(bs, /bank|checking|savings|cash/i, y));
    const ca = Math.abs(yv(bs, /^total\s+for\s+current\s+assets/i, y)) || (cash + Math.abs(si(bs, /receivable/i, y)));
    const cl = Math.abs(yv(bs, /^total\s+for\s+current\s+liab/i, y)) || Math.abs(si(bs, /payable/i, y));
    const exp = Math.abs(yv(pl, /^total.*expense/i, y));
    const ocf = yv(pl, /^net\s+income/i, y);
    return {
      label: String(y),
      currR: cl > 0 ? ca / cl : 0,
      quickR: cl > 0 ? ca / cl : 0,
      cashR: cl > 0 ? cash / cl : 0,
      ocfR: cl > 0 ? Math.abs(ocf) / cl : 0,
      daysC: exp > 0 ? cash / (exp / 365) : 0,
      wc: ca - cl,
      ca,
      cl,
    };
  });
  const cashTrend = pts.map(p => ({ label: p.label, days: Math.round(p.daysC) }));
  const last = pts[pts.length - 1] ?? { ca: 0, cl: 0, wc: 0 };
  const wc = Math.max(0, last.wc ?? 0);
  const wcData: WcRow[] = [
    { label: 'Curr. Assets', invisible: 0, bar: Math.round(last.ca ?? 0), fill: '#0F766E' },
    { label: '− Liabilities', invisible: Math.round(wc), bar: Math.round(last.cl ?? 0), fill: '#C0392B' },
    { label: 'Working Cap.', invisible: 0, bar: Math.round(wc), fill: '#166534' },
  ];
  return { liqTrend: pts, cashTrend, wcData };
}

function fmtPctBracket(n: number, decimals = 1): string {
  const abs = Math.abs(n).toFixed(decimals);
  return n < 0 ? `(${abs}%)` : `${abs}%`;
}

function ProfTrendChart({ data }: { data: ProfPt[] }) {
  if (data.length < 2) return EMPTY_CHART;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => fmtPctBracket(v as number, 0)} axisLine={false} tickLine={false} width={42} />
        <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [fmtPctBracket(v)]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="noi" name="NOI Margin" stroke="#166534" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="ebitda" name="EBITDA Margin" stroke="#5B5FEF" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="npm" name="Net Profit Margin" stroke="#1C1917" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RetTrendChart({ data }: { data: RetPt[] }) {
  if (data.length < 2) return EMPTY_CHART;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} width={38} />
        <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${v?.toFixed(1)}%`]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="roa" name="Return on Assets" stroke="#0F766E" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="roe" name="Return on Equity" stroke="#4E79A7" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="coc" name="Cash-on-Cash" stroke="#F2C14E" strokeWidth={2} dot={{ r: 3 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

function LiqRatiosTrendChart({ data }: { data: LiqPt[] }) {
  if (!data.length) return null;
  const LINES: { key: keyof LiqPt; label: string; color: string }[] = [
    { key: 'currR', label: 'Current Ratio', color: '#0F766E' },
    { key: 'quickR', label: 'Quick Ratio', color: '#5B5FEF' },
    { key: 'cashR', label: 'Cash Ratio', color: '#C0392B' },
    { key: 'ocfR', label: 'OCF Ratio', color: '#4E79A7' },
  ];
  return (
    <div style={LIQ_PANEL}>
      <h3 style={LIQ_H3}>Liquidity Ratios — Trend</h3>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" />
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
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => `${v}d`} width={36} domain={[0, 'auto']} />
          <Tooltip formatter={(v: number) => [`${v} days`, 'Days Cash on Hand']} contentStyle={{ fontSize: 11 }} />
          <ReferenceLine y={60} stroke="#5B5FEF" strokeDasharray="5 3" strokeWidth={1.5}
            label={{ value: '60d floor', position: 'right', fontSize: 9, fill: '#4F46E5' }} />
          <Bar dataKey="days" name="Days Cash" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {colored.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
          <CartesianGrid strokeDasharray="3 3" stroke="#E8E9ED" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#78716C' }} />
          <YAxis tick={{ fontSize: 10, fill: '#78716C' }} tickFormatter={v => v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`} width={52} />
          <Tooltip
            formatter={(v: number, name: string) => name === 'invisible' ? (null as unknown as string) : [fmt(v), 'Amount']}
            contentStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="invisible" stackId="wf" fill="transparent" isAnimationActive={false} legendType="none" />
          <Bar dataKey="bar" stackId="wf" radius={[4, 4, 0, 0]} isAnimationActive={false} name="Amount">
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProfitabilityAnalysis({ cards, liveFin }: { cards: RatioCard[]; liveFin?: LiveFin | null }) {
  const { profTrend, retTrend } = liveFin ? buildTrendFromLive(liveFin) : { profTrend: [], retTrend: [] };
  return (
    <div className="space-y-6">
      <RatioCardGrid cards={cards} />
      <BulletChartStrip cards={cards} defs={PROF_BULLET_DEFS} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div style={PANEL}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917' }}>Profitability Trend</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3, marginBottom: 16 }}>
            NOI Margin · EBITDA Margin · Net Profit Margin over time
          </div>
          <ProfTrendChart data={profTrend} />
        </div>
        <div style={PANEL}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1C1917' }}>Returns Trend</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3, marginBottom: 16 }}>
            Return on Assets · Return on Equity
          </div>
          <RetTrendChart data={retTrend} />
        </div>
      </div>
    </div>
  );
}

export function LiquidityAnalysis({ cards, liveFin }: { cards: RatioCard[]; liveFin?: LiveFin | null }) {
  const { liqTrend, cashTrend, wcData } = liveFin
    ? buildLiqTrendFromLive(liveFin)
    : { liqTrend: [], cashTrend: [], wcData: [] };
  return (
    <div className="space-y-6">
      <RatioCardGrid cards={cards} />
      <BulletChartStrip cards={cards} defs={LIQUIDITY_BULLET_DEFS} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LiqRatiosTrendChart data={liqTrend} />
        <DaysCashChart data={cashTrend} />
      </div>
      {wcData.length > 0 && <WcCompositionChart data={wcData} />}
    </div>
  );
}

export function SolvencyAnalysis({
  cards,
  coData,
  noteTitle = 'CFO Note: Elevated leverage is common for land / development holds.',
  noteBody = 'Watch DSCR (>1.25x) and LTLV vs Land Value. Carry costs and interest dominate hold-phase P&Ls until sales start.',
}: {
  cards: RatioCard[];
  coData?: { name: string; dscr: number; icr: number }[];
  noteTitle?: string;
  noteBody?: string;
}) {
  const chartData = (coData ?? []).filter(d => d.dscr > 0 || d.icr > 0);
  return (
    <div className="space-y-6">
      <RatioCardGrid cards={cards} />
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex gap-2 items-start">
          <span className="text-blue-500 text-lg shrink-0">ℹ️</span>
          <div>
            <p className="text-sm font-semibold text-blue-900">{noteTitle}</p>
            <p className="text-xs text-blue-700 mt-1">{noteBody}</p>
          </div>
        </div>
      </div>
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 style={{ fontSize: 13, color: '#262626', fontWeight: 600, marginBottom: 16 }}>DSCR vs Interest Coverage</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}x`} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(2)}x`]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={1.25} stroke="#166534" strokeDasharray="4 2" label={{ value: '1.25x DSCR floor', position: 'right', fontSize: 9, fill: '#166534' }} />
              <Bar dataKey="dscr" name="DSCR" radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.dscr >= 1.25 ? '#166534' : d.dscr >= 1.0 ? '#F5A623' : '#B91C1C'} />
                ))}
              </Bar>
              <Bar dataKey="icr" name="Interest Coverage" fill="#4F46E5" radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/** Build Cost of Capital cards from loan tracker (Cost of Debt, avg term, balloon risk). */
export function buildCostOfCapitalCards(loans: {
  balance: number;
  interestRate: number;
  maturityDate?: string | null;
  status?: string;
}[]): RatioCard[] {
  const active = loans.filter(l => (l.status ?? 'Active') === 'Active' && (l.balance ?? 0) > 0);
  const totalBal = active.reduce((s, l) => s + l.balance, 0);
  const wAvg = totalBal > 0
    ? active.reduce((s, l) => s + l.interestRate * l.balance, 0) / totalBal
    : 0;
  const now = Date.now();
  const yearsLeft = active
    .map(l => {
      if (!l.maturityDate) return null;
      const ms = new Date(l.maturityDate).getTime() - now;
      return ms > 0 ? ms / (365.25 * 24 * 3600 * 1000) : 0;
    })
    .filter((n): n is number => n != null);
  const avgTerm = yearsLeft.length ? yearsLeft.reduce((a, b) => a + b, 0) / yearsLeft.length : 0;
  const balloon = active.filter(l => {
    if (!l.maturityDate) return false;
    const yrs = (new Date(l.maturityDate).getTime() - now) / (365.25 * 24 * 3600 * 1000);
    return yrs >= 0 && yrs < 3;
  }).length;
  const costEquity = 12;
  const equityWeight = 0.4;
  const debtWeight = 0.6;
  const wacc = totalBal > 0 ? wAvg * debtWeight + costEquity * equityWeight : costEquity;
  const pill = (good: boolean, watch: boolean): Pick<RatioCard, 'status' | 'statusLabel'> =>
    good ? { status: 'good', statusLabel: '🟢 Good' }
      : watch ? { status: 'watch', statusLabel: '🟡 Watch' }
        : { status: 'monitor', statusLabel: '⚠️ Monitor' };

  return [
    { name: 'WACC (Est.)', formula: 'Wtd Avg Cost of Capital', value: totalBal > 0 ? `${wacc.toFixed(2)}%` : '—', benchmark: '<10%', ...pill(wacc < 10, wacc < 12), note: 'Blended 60% debt / 40% equity @ 12% CoE' },
    { name: 'Cost of Debt', formula: 'Interest / Total Debt (Loan Tracker)', value: totalBal > 0 ? `${wAvg.toFixed(2)}%` : '—', benchmark: '<8%', ...pill(wAvg < 7, wAvg < 8.5) },
    { name: 'Cost of Equity', formula: 'Required return on equity', value: `${costEquity.toFixed(1)}%`, benchmark: '10–14% RE', status: 'info', statusLabel: 'ℹ Assumed', note: 'Assumed for prop-dev equity; CAPM not applied' },
    { name: 'Avg Mortgage Rate', formula: 'Wtd avg fixed rate', value: totalBal > 0 ? `${wAvg.toFixed(2)}%` : '—', benchmark: 'Market', ...pill(wAvg <= 7, wAvg <= 8.5) },
    { name: 'Avg Remaining Term', formula: 'Avg years to maturity', value: avgTerm > 0 ? `${avgTerm.toFixed(0)} years` : '—', benchmark: '>5 yrs', ...pill(avgTerm >= 5, avgTerm >= 2) },
    { name: 'Balloon Risk', formula: 'Loans maturing <3 years', value: `${balloon} loan${balloon === 1 ? '' : 's'}`, benchmark: 'None', ...pill(balloon === 0, balloon <= 1), note: balloon > 0 ? 'Begin refinance planning ahead of maturity' : undefined },
  ];
}
