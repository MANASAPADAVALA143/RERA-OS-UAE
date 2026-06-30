import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend, ReferenceLine, Cell,
  ComposedChart,
} from 'recharts';
import { api } from '../../services/api';

type RatioTab = 'Profitability' | 'Liquidity' | 'Solvency' | 'Rental KPIs' | 'Cost of Capital';
type StatusType = 'good' | 'watch' | 'critical' | 'monitor' | 'info';

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

const S: Record<StatusType, { border: string; bg: string; pill: string }> = {
  good:     { border: 'border-l-green-500',  bg: 'bg-green-50',  pill: 'bg-green-100 text-green-800'   },
  watch:    { border: 'border-l-amber-500',  bg: 'bg-amber-50',  pill: 'bg-amber-100 text-amber-800'   },
  critical: { border: 'border-l-red-500',    bg: 'bg-red-50',    pill: 'bg-red-100 text-red-800'       },
  monitor:  { border: 'border-l-orange-500', bg: 'bg-orange-50', pill: 'bg-orange-100 text-orange-800' },
  info:     { border: 'border-l-blue-500',   bg: 'bg-blue-50',   pill: 'bg-blue-100 text-blue-800'     },
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

function LiveDataPanel({ fin }: { fin: LiveFin }) {
  const lastY = fin.years[fin.years.length - 1];
  const prevY = fin.years.length >= 2 ? fin.years[fin.years.length - 2] : null;
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
  const buildings = Math.abs(getYV(bs,/^buildings$/i,lastY));
  const loans = Math.abs(getYV(bs,/^total\s+for\s+long.term/i,lastY) || sumI(bs,/long.term.*loan/i,lastY));
  const noiM = totalRevenue > 0 ? noi / totalRevenue * 100 : 0;
  const netM = totalRevenue > 0 ? netIncome / totalRevenue * 100 : 0;
  const ltv = buildings > 0 ? loans / buildings * 100 : 0;
  const dte = equity > 0 ? totalLiabilities / equity : 0;
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
    { label: 'NOI Margin', value: noiM > 0 ? `${noiM.toFixed(1)}%` : '—', status: noiM>=35?'good':noiM>=20?'watch':'critical' as const },
    { label: 'Net Margin', value: `${netM.toFixed(1)}%`, status: netM>=10?'good':netM>=0?'watch':'monitor' as const },
    { label: 'Revenue', value: fmtV(totalRevenue), status: 'info' as const },
    { label: 'NOI', value: fmtV(noi), status: noi>=0?'good':'critical' as const },
    { label: 'LTV', value: ltv > 0 ? `${ltv.toFixed(1)}%` : '—', status: ltv<=75?'good':ltv<=85?'watch':'monitor' as const },
    { label: 'Int. Coverage', value: iCov > 0 ? `${iCov.toFixed(2)}x` : '—', status: iCov>=2?'good':iCov>=1.2?'watch':'critical' as const },
    { label: 'D/E Ratio', value: dte > 0 ? `${dte.toFixed(1)}x` : '—', status: dte<=3?'good':dte<=6?'watch':'monitor' as const },
    { label: 'Expense Ratio', value: expR > 0 ? `${expR.toFixed(1)}%` : '—', status: expR<=70?'good':expR<=85?'watch':'critical' as const },
    { label: 'Cash', value: fmtV(cash), status: cash>10000?'good':cash>0?'watch':'critical' as const },
    { label: 'Total Assets', value: fmtV(totalAssets), status: 'info' as const },
    { label: 'Equity', value: fmtV(equity), status: equity>0?'good':'critical' as const },
    { label: 'Revenue Growth', value: revGrowth !== null ? `${revGrowth>=0?'+':''}${revGrowth.toFixed(1)}%` : 'N/A', status: revGrowth===null?'info':revGrowth>=3?'good':revGrowth>=0?'watch':'critical' as const },
  ];
  const colors: Record<string,string> = { good:'border-green-500 bg-green-50 text-green-800', watch:'border-amber-500 bg-amber-50 text-amber-800', critical:'border-red-500 bg-red-50 text-red-800', monitor:'border-orange-500 bg-orange-50 text-orange-800', info:'border-blue-500 bg-blue-50 text-blue-800' };

  return (
    <div className="bg-white rounded-2xl border border-emerald-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Live Data — {fin.company_name}</span>
          <p className="text-xs text-gray-400 mt-0.5">{fin.filename} · Latest year: <strong>{lastY}</strong> · {fin.years.length} years of data</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {fin.years.map(y => <span key={y} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">{y}</span>)}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {metrics.map(m => (
          <div key={m.label} className={`border-l-4 rounded-lg px-3 py-2 ${colors[m.status]}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{m.label}</p>
            <p className="text-sm font-bold font-mono mt-0.5">{m.value}</p>
          </div>
        ))}
      </div>

      {trendRows.length >= 2 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Multi-Year P&amp;L Trend</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={trendRows} margin={{ left: 20, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => fmtV(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmtV(v)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="Revenue" stroke="#2E75B6" strokeWidth={2} dot />
              <Line type="monotone" dataKey="NOI" stroke="#70AD47" strokeWidth={2} dot />
              <Line type="monotone" dataKey="Net Income" stroke="#ED7D31" strokeWidth={1.5} strokeDasharray="5 3" dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
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

function RatioCardComp({ card }: { card: RatioCard }) {
  const st = S[card.status];
  return (
    <div className={`rounded-lg p-4 shadow-sm border-l-4 ${st.border} ${st.bg}`}>
      <div className="text-xs text-gray-600 uppercase tracking-wide font-semibold leading-tight">{card.name}</div>
      <div className="text-[10px] text-gray-400 font-mono mt-0.5 mb-2 leading-tight">{card.formula}</div>
      <div className="text-xl font-bold font-mono text-gray-900">{card.value}</div>
      <div className="flex items-center justify-between mt-2 gap-1 flex-wrap">
        <span className="text-[10px] text-gray-500">Benchmark: {card.benchmark}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${st.pill}`}>{card.statusLabel}</span>
      </div>
      {card.spark && <Spark data={card.spark} />}
      {card.note && <div className="text-[10px] text-gray-400 mt-1 italic leading-tight">{card.note}</div>}
    </div>
  );
}

function CardGrid({ cards }: { cards: RatioCard[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map(c => <RatioCardComp key={c.name} card={c} />)}
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
  { name: 'Balloon Risk',          formula: 'Loans maturing <3 years',      value: '2 loans', benchmark: 'None',         status: 'monitor', statusLabel: '⚠️ Monitor',       note: 'Pinnacle I (2046) and Riverview (2046) — begin refi planning 2043' },
];

function ProfitabilityTab({ coData, trendData }: { coData: any[]; trendData: any[] }) {
  const displayTrend = trendData.length > 0 ? trendData : [{ year: 'No data', noiMargin: 0, netProfitMargin: 0 }];
  return (
    <div className="space-y-6">
      <CardGrid cards={PROFITABILITY} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Portfolio Margin Trend</h3>
          {displayTrend[0].year === 'No data' ? (
            <div className="h-[200px] flex items-center justify-center text-gray-500">No historical data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={displayTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="noiMargin"        name="NOI Margin %"         stroke="#1a3a2a" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="netProfitMargin"  name="Net Profit Margin %"  stroke="#B8860B" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">NOI Margin by Company</h3>
          {coData.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center text-gray-500">No company data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={coData} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'NOI Margin']} />
                <ReferenceLine y={25} stroke="#dc2626" strokeDasharray="4 2" label={{ value: '25% benchmark', position: 'right', fontSize: 9, fill: '#dc2626' }} />
                <Bar dataKey="noiMargin" name="NOI Margin %" radius={[3, 3, 0, 0]}>
                  {coData.map((d, i) => <Cell key={i} fill={d.noiMargin > 20 ? '#16a34a' : d.noiMargin >= 15 ? '#d97706' : '#dc2626'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function LiquidityTab({ coData }: { coData: any[] }) {
  return (
    <div className="space-y-6">
      <CardGrid cards={LIQUIDITY} />
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-4">Current Ratio by Company — benchmark 1.5x</h3>
        {coData.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-gray-500">No company data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={coData} layout="vertical" margin={{ left: 60, right: 40, top: 5, bottom: 5 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}x`} domain={[0, 6]} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(2)}x`, 'Current Ratio']} />
              <ReferenceLine x={1.5} stroke="#dc2626" strokeDasharray="4 2" label={{ value: '1.5x min', position: 'top', fontSize: 9, fill: '#dc2626' }} />
              <Bar dataKey="currRatio" name="Current Ratio" radius={[0, 3, 3, 0]}>
                {coData.map((d, i) => <Cell key={i} fill={d.currRatio >= 1.5 ? '#1a3a2a' : '#dc2626'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function SolvencyTab({ coData }: { coData: any[] }) {
  return (
    <div className="space-y-6">
      <CardGrid cards={SOLVENCY} />

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
        <h3 className="text-sm font-bold text-gray-900 mb-4">DSCR vs Interest Coverage by Company</h3>
        {coData.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-gray-500">No company data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={coData} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}x`} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(2)}x`]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={1.25} stroke="#16a34a" strokeDasharray="4 2" label={{ value: '1.25x DSCR floor', position: 'right', fontSize: 9, fill: '#16a34a' }} />
              <ReferenceLine y={1.5}  stroke="#B8860B" strokeDasharray="4 2" label={{ value: '1.5x ICR benchmark', position: 'right', fontSize: 9, fill: '#B8860B' }} />
              <Bar dataKey="dscr" name="DSCR"             fill="#1a3a2a" radius={[3, 3, 0, 0]} />
              <Bar dataKey="icr"  name="Interest Coverage" fill="#B8860B" radius={[3, 3, 0, 0]} />
            </ComposedChart>
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
          <h3 className="text-sm font-bold text-gray-900 mb-4">Occupancy Rate by Company vs 90% Target</h3>
          {coData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-gray-500">No company data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={coData} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[60, 100]} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'Occupancy']} />
                <ReferenceLine y={90} stroke="#dc2626" strokeDasharray="4 2" label={{ value: '90% target', position: 'right', fontSize: 9, fill: '#dc2626' }} />
                <Bar dataKey="occ" name="Occupancy %" fill="#1a3a2a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Revenue per Unit vs Expense per Unit</h3>
          {coData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-gray-500">No company data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={coData} margin={{ left: 0, right: 5, top: 5, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <Tooltip formatter={(v: number) => [fmt$(v)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="revUnit" name="Revenue / Unit"  fill="#1a3a2a" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expUnit" name="Expense / Unit"  fill="#B8860B" radius={[3, 3, 0, 0]} />
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
          <h3 className="text-sm font-bold text-gray-900">Loan Schedule — All Rental Companies</h3>
        </div>
        {loanData.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-500">No loans found for rental companies</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Company</th>
                  <th className="text-right px-3 py-3">Loan Amount</th>
                  <th className="text-center px-3 py-3">Rate</th>
                  <th className="text-right px-3 py-3">Monthly Pmt</th>
                  <th className="text-right px-3 py-3">Balance</th>
                  <th className="text-center px-3 py-3">LTV</th>
                  <th className="text-center px-3 py-3">Maturity</th>
                  <th className="text-center px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loanData.map(l => (
                  <tr key={l.company} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-xs font-medium text-gray-900 whitespace-nowrap">{l.company}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmt$(l.amount)}</td>
                    <td className="px-3 py-3 text-center font-mono text-xs">{l.rate.toFixed(2)}%</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmt$(l.payment)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs">{fmt$(l.balance)}</td>
                    <td className={`px-3 py-3 text-center font-mono text-xs font-semibold ${l.ltv > 86 ? 'text-amber-700' : 'text-green-700'}`}>
                      {l.ltv.toFixed(1)}%
                    </td>
                    <td className="px-3 py-3 text-center text-gray-600 text-xs">{l.maturity}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${l.highLtv ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                        {l.highLtv ? '🟡 High LTV' : '🟢 Acceptable'}
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

export default function RentalFinancialRatios() {
  const [activeTab, setActiveTab] = useState<RatioTab>('Profitability');
  const [companies, setCompanies] = useState<CoOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [liveData, setLiveData] = useState<LiveFin | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [coData, setCoData] = useState<any[]>([]);
  const [loanData, setLoanData] = useState<any[]>([]);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

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
        // Fetch companies and portfolio summary for metrics
        const [companiesRes, portfolioRes, loansRes] = await Promise.all([
          api.get<any[]>('/api/rentals/companies'),
          api.get<any>('/api/rentals/portfolio-summary'),
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
            rate: l.loan_interest_rate || 0,
            payment: l.loan_emi || 0,
            balance: l.loan_balance_as_of || 0,
            ltv: l.ltv_current || 0,
            maturity: l.loan_maturity_date ? new Date(l.loan_maturity_date).getFullYear() : '—',
            highLtv: (l.ltv_current || 0) > 86,
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
  }, []);

  useEffect(() => {
    if (!selectedId) { setLiveData(null); return; }
    setLoadingLive(true);
    api.get<LiveFin>(`/api/rentals/financials/${selectedId}`)
      .then(res => setLiveData(res.data))
      .catch(() => setLiveData(null))
      .finally(() => setLoadingLive(false));
  }, [selectedId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-wider" style={{ color: '#B8860B' }}>FINANCIALS & RISK</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Financial Ratios & Analysis</h1>
        <p className="text-sm text-gray-500 mt-1">Rental Portfolio — Solvency, Profitability, Liquidity &amp; Rental KPIs</p>
      </div>

      {/* Company selector */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="">All Companies (Portfolio Benchmarks)</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        {selectedId && !liveData && !loadingLive && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            No financials uploaded for this company — go to Financials to upload P&amp;L/BS/CF
          </span>
        )}
        {loadingLive && <span className="text-xs text-gray-400">Loading live data…</span>}
      </div>

      {/* Live data panel — shown when company has uploaded financials */}
      {liveData && <LiveDataPanel fin={liveData} />}

      {/* Portfolio benchmark tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {RATIO_TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'Profitability'    && <ProfitabilityTab coData={coData} trendData={trendData} />}
        {activeTab === 'Liquidity'        && <LiquidityTab coData={coData} />}
        {activeTab === 'Solvency'         && <SolvencyTab coData={coData} />}
        {activeTab === 'Rental KPIs'      && <RentalKPIsTab coData={coData} />}
        {activeTab === 'Cost of Capital'  && <CostOfCapitalTab loanData={loanData} />}
      </div>
    </div>
  );
}
