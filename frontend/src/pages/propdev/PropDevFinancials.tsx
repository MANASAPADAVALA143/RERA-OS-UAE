import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  CartesianGrid, ComposedChart, Area, ReferenceLine,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Upload, FileSpreadsheet, Building2, DollarSign, BarChart2, Percent, Shield, Home, Landmark, Settings } from 'lucide-react';

// ── Palette ──────────────────────────────────────────────────────────────────
const COLORS = ['#2E75B6','#70AD47','#ED7D31','#FFC000','#5A2D82','#C00000','#00B0F0','#FF0066','#00B050','#7030A0','#FF7C00','#003366'];
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtM = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`;
const fmtK = (n: number) => `$${(n / 1_000).toFixed(0)}K`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const short = (name: string) => name.split(' ').slice(0,2).join(' ');

// ── Company Data ─────────────────────────────────────────────────────────────
interface CompanyDatum {
  id: string; name: string; property: string; lots: number; sold: number;
  revenue: number; netIncome: number; land: number; hard: number; soft: number;
  interest: number; commission: number; title: number; mgmtFee: number;
  prof: number; legal: number; mktg: number; ga: number; insur: number;
  propTax: number; otherIncome: number;
}
const COMPANIES_DATA: CompanyDatum[] = [];

const TOTAL_REV = COMPANIES_DATA.reduce((s, c) => s + c.revenue, 0);

function calcRow(c: CompanyDatum) {
  const totalRev = c.revenue + c.otherIncome;
  const totalCOGS = c.land + c.hard + c.soft + c.interest + c.commission + c.title;
  const grossProfit = totalRev - totalCOGS;
  const totalOpex = c.mgmtFee + c.prof + c.legal + c.mktg + c.ga + c.insur + c.propTax;
  const noi = grossProfit - totalOpex;
  return { totalRev, totalCOGS, grossProfit, totalOpex, noi, netIncome: c.netIncome };
}

const TABS = ['P&L Statement','Balance Sheet','KPI Dashboard','CFO Dashboard','Partners & Distribution','Strategic Insights'] as const;
type TabType = typeof TABS[number];

// ── Balance Sheet data ────────────────────────────────────────────────────────
const BS_YEARS = [2022, 2023, 2024, 2025, 2026];
const BS = [
  { cash:[1.2,2.8,4.1,5.6,6.4], ar:[3.4,5.1,7.2,9.8,11.2], deposits:[0.6,0.6,0.6,0.6,0.6],
    land:[48.3,42.1,31.8,18.2,9.1], wip:[12.4,18.6,22.3,15.8,8.2], improv:[3.2,3.2,3.2,3.2,3.2],
    partnerLoans:[1.8,1.8,1.8,1.8,1.8],
    ap:[2.1,3.2,4.1,3.4,2.2], constLoans:[22.1,24.3,25.4,20.1,12.8], otherLiab:[0.7,0.7,0.7,0.5,0.4],
    partnerCap:[35.2,35.2,35.2,35.2,35.2], retained:[5.4,6.1,6.8,8.2,10.8], netIncomeEq:[5.4,4.7,-1.2,-12.4,-20.9],
  }
][0];

// ── KPI cards ─────────────────────────────────────────────────────────────────
type KpiStatus = 'green' | 'amber' | 'red';
interface Kpi { label: string; value: string; sub: string; status: KpiStatus; }
const KPIS: Kpi[] = [
  { label:'Total Portfolio Revenue', value:'$113.49M', sub:'↑ vs benchmark $100M', status:'green' },
  { label:'Revenue per Lot Sold',    value:'$420,890', sub:'↑ above $400K target', status:'green' },
  { label:'Sales Velocity',          value:'191/346 lots (55%)', sub:'⚠ 3 projects <40%', status:'amber' },
  { label:'Net Profit Margin',       value:'38.7%',   sub:'Target 30%+',           status:'green' },
  { label:'Gross Profit Margin',     value:'52.3%',   sub:'Target 40%+',           status:'green' },
  { label:'NOI Margin',              value:'35.2%',   sub:'Target 28%+',           status:'green' },
  { label:'Cash Available',          value:'$6.42M',  sub:'Minimum $2M floor',     status:'green' },
  { label:'Loan-to-Value (LTV)',     value:'42%',     sub:'Limit 60%',             status:'green' },
  { label:'Capital Calls Overdue',   value:'$75,500', sub:'6 partners overdue',    status:'red'   },
  { label:'Avg Days to Close',       value:'28 days', sub:'Target <30 days',       status:'green' },
  { label:'Interest Ratio',          value:'1.2%',    sub:'% of revenue',          status:'green' },
  { label:'Cost Overrun Risk',       value:'Low',     sub:'2 projects flagged',    status:'amber' },
];

// ── 13-week cash ──────────────────────────────────────────────────────────────
const CASH_13 = Array.from({length:13}, (_, i) => ({
  week: `Wk${i+1}`,
  balance: +(6.42 + i * 0.13 + (i % 3 === 2 ? -0.05 : 0)).toFixed(2),
}));

// ── Strategic insights ────────────────────────────────────────────────────────
interface Insight { id: number; priority: 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'; category: string; title: string; text: string; action: string; quad: string; }
const INSIGHTS: Insight[] = [
  { id:1,  priority:'CRITICAL', category:'Liquidity',          title:'Cash Runway: 1.1 Months',           text:'Current cash covers only 1.1 months of EMI ($17,645/mo). August shortfall of $16,732 due by Aug 10. No distributions possible until EMI is funded.',  action:'Initiate capital call or partner contribution to cover August EMI shortfall before Aug 10.',          quad:'UH' },
  { id:2,  priority:'HIGH',     category:'Partner Relations',  title:'Zero Distributions — 100% Capital at Risk', text:'$2,223,677 of partner capital is fully deployed with 0% returned. No distributions have been made to any of the 17 partners. Pre-sale phase only.',       action:'Prepare distribution waterfall memo for partners. Trigger upon first lot sale.',                     quad:'UH' },
  { id:3,  priority:'HIGH',     category:'Valuation',          title:'Break-Even Sale Price $4.86M',      text:'Partnership break-even (including 8% preferred return on $2.22M capital) requires lot sale proceeds of $4,862,551. Current cost basis is $3,892,736.',       action:'Confirm appraisal value vs break-even. Engage broker to assess market comparables.',                  quad:'UH' },
  { id:4,  priority:'MEDIUM',   category:'Profitability',      title:'4 of 6 Years Net Loss',             text:'WWBG reported net income only in 2024 ($79,584). All other years (2021-2023, 2025-2026) show net losses driven by interest and carrying costs.',               action:'Monitor 2026 expenses. Reduce discretionary spend. Capitalize interest to reduce current-year loss.', quad:'NH' },
  { id:5,  priority:'LOW',      category:'Financing',          title:'Loan Rate Below Market',            text:'Current loan rate is 4.25% (Greater Plains Bank) vs market rate of ~6.5%. No refinancing needed. Existing rate is favorable for carry period.',                action:'No action needed. Confirm rate lock expiry date and renegotiate 12 months before maturity.',          quad:'NL' },
  { id:6,  priority:'LOW',      category:'Concentration',      title:'Top 2 Partners Hold 21.11% Equity', text:'R Family Ltd (10.73%) and VRE (10.38%) together hold 21.11% of total equity. Remaining 15 partners average 5.25% each. Concentration is moderate.',          action:'No immediate action. Note for Phase 2 capital raise — consider diversifying lead partner exposure.',  quad:'NL' },
];

const CHECKLIST_ITEMS = [
  'Fund August EMI shortfall ($16,732) before Aug 10',
  'Send EMI status update to all 17 partners',
  'Confirm break-even appraisal with broker ($4,862,551)',
  'Prepare distribution waterfall memo (pre-sale template)',
  'Verify 4.25% loan rate lock expiry date with Greater Plains Bank',
  'CPA review: capitalize vs expense remaining 2026 interest',
];
const CHECKLIST_KEY = 'propdev_cfo_checklist';

// ── Helpers ───────────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: KpiStatus }) {
  if (status === 'green') return <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">✓ On Track</span>;
  if (status === 'amber') return <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">⚠ Monitor</span>;
  return <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">✗ Action Needed</span>;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const border = kpi.status === 'green' ? 'border-green-500 bg-green-50' : kpi.status === 'amber' ? 'border-amber-500 bg-amber-50' : 'border-red-500 bg-red-50';
  return (
    <div className={`border-l-4 ${border} rounded-lg p-4 shadow-sm`}>
      <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
      <p className="text-xl font-bold font-mono text-gray-900">{kpi.value}</p>
      <p className="text-xs text-gray-500 mt-1">{kpi.sub}</p>
      <div className="mt-2"><StatusBadge status={kpi.status} /></div>
    </div>
  );
}

function PriorityBadge({ p }: { p: Insight['priority'] }) {
  const cls = p === 'CRITICAL' ? 'bg-red-600' : p === 'HIGH' ? 'bg-orange-500' : p === 'MEDIUM' ? 'bg-amber-400 text-gray-800' : 'bg-gray-400';
  return <span className={`text-xs text-white px-2 py-0.5 rounded-full font-bold ${cls}`}>{p}</span>;
}

// ── Tab: P&L ─────────────────────────────────────────────────────────────────
function PLTab({ selectedId }: { selectedId: string }) {
  const companies = selectedId === 'all' ? COMPANIES_DATA : COMPANIES_DATA.filter(c => c.id === selectedId);
  const rows = companies.map(c => ({ c, r: calcRow(c) }));

  // for single-company: 3-year view
  const singleCo = selectedId !== 'all' ? COMPANIES_DATA.find(c => c.id === selectedId) : null;
  const years = singleCo ? [
    { yr:2024, mult:0.6 },
    { yr:2025, mult:0.8 },
    { yr:2026, mult:1.0 },
  ].map(({ yr, mult }) => {
    const sc = { ...singleCo!, revenue: singleCo!.revenue * mult, otherIncome: singleCo!.otherIncome * mult,
      land: singleCo!.land * mult, hard: singleCo!.hard * mult, soft: singleCo!.soft * mult,
      interest: singleCo!.interest * mult, commission: singleCo!.commission * mult, title: singleCo!.title * mult,
      mgmtFee: singleCo!.mgmtFee * mult, prof: singleCo!.prof * mult, legal: singleCo!.legal * mult,
      mktg: singleCo!.mktg * mult, ga: singleCo!.ga * mult, insur: singleCo!.insur * mult,
      propTax: singleCo!.propTax * mult, netIncome: singleCo!.netIncome * mult,
    };
    return { yr, r: calcRow(sc) };
  }) : [];

  const chartData = COMPANIES_DATA.map(c => ({
    name: short(c.name), revenue: c.revenue, net: c.netIncome,
    margin: Math.round((c.netIncome / c.revenue) * 100),
  }));

  const donutData = (() => {
    const tot = COMPANIES_DATA.reduce((s,c) => ({
      land: s.land+c.land, hard: s.hard+c.hard, soft: s.soft+c.soft,
      interest: s.interest+c.interest, commission: s.commission+c.commission, title: s.title+c.title,
    }), { land:0, hard:0, soft:0, interest:0, commission:0, title:0 });
    return [
      { name:'Land', value: tot.land },
      { name:'Hard Cost', value: tot.hard },
      { name:'Soft Cost', value: tot.soft },
      { name:'Interest', value: tot.interest },
      { name:'Commission', value: tot.commission },
      { name:'Title', value: tot.title },
    ];
  })();

  const marginData = [...COMPANIES_DATA]
    .map(c => ({ name: short(c.name), margin: Math.round((c.netIncome / c.revenue) * 100) }))
    .sort((a,b) => b.margin - a.margin);

  return (
    <div className="space-y-6">
      {/* Table */}
      <div className="overflow-x-auto rounded-lg shadow-sm border border-gray-200">
        <table className="text-xs w-full min-w-[700px]">
          <thead>
            <tr className="bg-gray-900 text-white">
              <th className="text-left px-4 py-2.5 font-semibold w-48">Line Item</th>
              {selectedId === 'all'
                ? companies.map(c => <th key={c.id} className="text-right px-3 py-2.5">{short(c.name)}</th>)
                : years.map(({yr}) => <th key={yr} className="text-right px-4 py-2.5">{yr}</th>)
              }
            </tr>
          </thead>
          <tbody>
            {[
              { label:'── INCOME ──', section:true },
              { label:'Lot Sales Revenue', key:'revenue' as const },
              { label:'Other Income', key:'otherIncome' as const },
              { label:'TOTAL REVENUE', sum:'totalRev', highlight:'bg-blue-50 font-bold text-blue-900' },
              { label:'── COGS ──', section:true },
              { label:'Land Cost', key:'land' as const },
              { label:'Hard Construction Cost', key:'hard' as const },
              { label:'Soft Costs', key:'soft' as const },
              { label:'Interest Expense', key:'interest' as const },
              { label:'Sales Commission', key:'commission' as const },
              { label:'Title & Escrow', key:'title' as const },
              { label:'TOTAL COGS', sum:'totalCOGS', highlight:'bg-red-50 font-bold text-red-900' },
              { label:'GROSS PROFIT', sum:'grossProfit', highlight:'bg-green-50 font-bold text-green-900' },
              { label:'── OPEX ──', section:true },
              { label:'Management Fee', key:'mgmtFee' as const },
              { label:'Professional Fees', key:'prof' as const },
              { label:'Legal & Accounting', key:'legal' as const },
              { label:'Marketing', key:'mktg' as const },
              { label:'G&A', key:'ga' as const },
              { label:'Insurance', key:'insur' as const },
              { label:'Property Tax', key:'propTax' as const },
              { label:'TOTAL OPEX', sum:'totalOpex', highlight:'bg-orange-50 font-bold text-orange-900' },
              { label:'NET OPERATING INCOME', sum:'noi', highlight:'bg-gray-100 font-bold' },
              { label:'NET INCOME', sum:'netIncome', highlight:'bg-green-800 text-white font-bold text-sm' },
            ].map((row, i) => {
              if ('section' in row && row.section) return (
                <tr key={i}><td colSpan={99} className="px-4 py-1.5 text-amber-600 font-semibold bg-gray-50 text-xs">{row.label}</td></tr>
              );
              const hl = 'highlight' in row ? row.highlight || '' : '';
              return (
                <tr key={i} className={`border-t border-gray-100 ${hl}`}>
                  <td className={`px-4 py-1.5 ${hl}`}>{row.label}</td>
                  {selectedId === 'all'
                    ? rows.map(({c, r}) => {
                        const val = 'key' in row && row.key ? c[row.key as keyof typeof c] as number
                          : 'sum' in row && row.sum ? r[row.sum as keyof typeof r] as number : 0;
                        return <td key={c.id} className={`text-right px-3 py-1.5 font-mono ${hl}`}>{fmt(val)}</td>;
                      })
                    : years.map(({ yr, r }) => {
                        const sc = COMPANIES_DATA.find(c => c.id === selectedId)!;
                        const mult = yr === 2024 ? 0.6 : yr === 2025 ? 0.8 : 1.0;
                        const rawVal = 'key' in row && row.key ? sc[row.key as keyof typeof sc] as number * mult
                          : 'sum' in row && row.sum ? r[row.sum as keyof typeof r] as number : 0;
                        return <td key={yr} className={`text-right px-4 py-1.5 font-mono ${hl}`}>{fmt(rawVal)}</td>;
                      })
                  }
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-700 mb-3">Revenue vs Net Income</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ left:-20, right:0, bottom:30 }}>
              <XAxis dataKey="name" tick={{ fontSize:9 }} angle={-45} textAnchor="end" />
              <YAxis tickFormatter={v => `$${(v/1e6).toFixed(0)}M`} tick={{ fontSize:9 }} />
              <Tooltip formatter={(v:number) => fmt(v)} />
              <Bar dataKey="revenue" fill={COLORS[0]} name="Revenue" />
              <Bar dataKey="net" fill={COLORS[1]} name="Net Income" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-700 mb-3">Cost Breakdown</p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={donutData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value">
                {donutData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v:number) => fmtM(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize:10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-xs font-semibold text-gray-700 mb-3">Gross Margin % by Company</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={marginData} layout="vertical" margin={{ left:60, right:10 }}>
              <XAxis type="number" tickFormatter={v => `${v}%`} tick={{ fontSize:9 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize:9 }} />
              <Tooltip formatter={(v:number) => `${v}%`} />
              <Bar dataKey="margin" fill={COLORS[2]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Balance Sheet ────────────────────────────────────────────────────────
function BSTab() {
  const trendData = BS_YEARS.map((yr, i) => ({
    year: yr,
    assets:  +(BS.cash[i]+BS.ar[i]+BS.deposits[i]+BS.land[i]+BS.wip[i]+BS.improv[i]+BS.partnerLoans[i]).toFixed(1),
    liab:    +(BS.ap[i]+BS.constLoans[i]+BS.otherLiab[i]).toFixed(1),
    equity:  +(BS.partnerCap[i]+BS.retained[i]+BS.netIncomeEq[i]).toFixed(1),
  }));

  const fmtBS = (v: number) => v < 0 ? `(${fmtM(Math.abs(v*1e6))})` : fmtM(v*1e6);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        {/* Assets */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-blue-700 text-white px-4 py-2 text-sm font-bold">ASSETS</div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50"><th className="text-left px-4 py-1.5">Item</th>{BS_YEARS.map(y => <th key={y} className="text-right px-3 py-1.5">{y}</th>)}</tr></thead>
            <tbody>
              {[
                { label:'── Current Assets ──', section:true },
                { label:'Cash & Bank',     data: BS.cash },
                { label:'Accounts Receivable', data: BS.ar },
                { label:'Deposits',        data: BS.deposits },
                { label:'Total Current',   data: BS.cash.map((_,i) => +(BS.cash[i]+BS.ar[i]+BS.deposits[i]).toFixed(1)), bold:true, bg:'bg-blue-50' },
                { label:'── Dev Assets ──', section:true },
                { label:'Land (at cost)',  data: BS.land },
                { label:'Dev WIP',         data: BS.wip },
                { label:'Improvements',    data: BS.improv },
                { label:'Total Dev',       data: BS.land.map((_,i) => +(BS.land[i]+BS.wip[i]+BS.improv[i]).toFixed(1)), bold:true, bg:'bg-blue-50' },
                { label:'Partner Loans',   data: BS.partnerLoans },
                { label:'TOTAL ASSETS',    data: BS.cash.map((_,i) => +(BS.cash[i]+BS.ar[i]+BS.deposits[i]+BS.land[i]+BS.wip[i]+BS.improv[i]+BS.partnerLoans[i]).toFixed(1)), bold:true, bg:'bg-blue-100' },
              ].map((r,i) => 'section' in r && r.section
                ? <tr key={i}><td colSpan={99} className="px-4 py-1 text-amber-600 font-semibold bg-gray-50 text-xs">{r.label}</td></tr>
                : <tr key={i} className={`border-t border-gray-100 ${('bg' in r && r.bg) || ''}`}>
                    <td className={`px-4 py-1.5 ${'bold' in r && r.bold ? 'font-bold' : ''}`}>{r.label}</td>
                    {(r as any).data.map((v: number, j: number) => <td key={j} className={`text-right px-3 py-1.5 font-mono ${'bold' in r && r.bold ? 'font-bold' : ''}`}>{fmtBS(v)}</td>)}
                  </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Liabilities & Equity */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-red-700 text-white px-4 py-2 text-sm font-bold">LIABILITIES & EQUITY</div>
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50"><th className="text-left px-4 py-1.5">Item</th>{BS_YEARS.map(y => <th key={y} className="text-right px-3 py-1.5">{y}</th>)}</tr></thead>
            <tbody>
              {[
                { label:'── Liabilities ──', section:true },
                { label:'Accounts Payable', data: BS.ap },
                { label:'Construction Loans', data: BS.constLoans },
                { label:'Other Liabilities', data: BS.otherLiab },
                { label:'TOTAL LIABILITIES', data: BS.ap.map((_,i) => +(BS.ap[i]+BS.constLoans[i]+BS.otherLiab[i]).toFixed(1)), bold:true, bg:'bg-red-50' },
                { label:'── Equity ──', section:true },
                { label:'Partner Capital',  data: BS.partnerCap },
                { label:'Retained Earnings', data: BS.retained },
                { label:'Net Income',       data: BS.netIncomeEq },
                { label:'TOTAL EQUITY',     data: BS.partnerCap.map((_,i) => +(BS.partnerCap[i]+BS.retained[i]+BS.netIncomeEq[i]).toFixed(1)), bold:true, bg:'bg-green-50' },
                { label:'TOTAL L + E',      data: BS.ap.map((_,i) => +(BS.ap[i]+BS.constLoans[i]+BS.otherLiab[i]+BS.partnerCap[i]+BS.retained[i]+BS.netIncomeEq[i]).toFixed(1)), bold:true, bg:'bg-gray-100' },
              ].map((r,i) => 'section' in r && r.section
                ? <tr key={i}><td colSpan={99} className="px-4 py-1 text-amber-600 font-semibold bg-gray-50 text-xs">{r.label}</td></tr>
                : <tr key={i} className={`border-t border-gray-100 ${('bg' in r && r.bg) || ''}`}>
                    <td className={`px-4 py-1.5 ${'bold' in r && r.bold ? 'font-bold' : ''}`}>{r.label}</td>
                    {(r as any).data.map((v: number, j: number) => <td key={j} className={`text-right px-3 py-1.5 font-mono ${'bold' in r && r.bold ? 'font-bold' : ''} ${v < 0 ? 'text-red-600' : ''}`}>{fmtBS(v)}</td>)}
                  </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-3">5-Year Trend: Assets vs Liabilities vs Equity ($M)</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="year" />
            <YAxis tickFormatter={v => `$${v}M`} />
            <Tooltip formatter={(v:number) => `$${v}M`} />
            <Legend />
            <Line type="monotone" dataKey="assets" stroke={COLORS[0]} strokeWidth={2} name="Total Assets" dot />
            <Line type="monotone" dataKey="liab" stroke={COLORS[5]} strokeWidth={2} name="Total Liabilities" dot />
            <Line type="monotone" dataKey="equity" stroke={COLORS[1]} strokeWidth={2} name="Total Equity" dot />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Tab: KPI Dashboard ────────────────────────────────────────────────────────
function KPITab() {
  const radialData = COMPANIES_DATA.map((c, i) => ({
    name: short(c.name),
    margin: Math.round((c.netIncome / c.revenue) * 100),
    fill: COLORS[i % COLORS.length],
  }));

  const barData = [...COMPANIES_DATA]
    .sort((a,b) => b.netIncome - a.netIncome)
    .map(c => ({ name: short(c.name), revenue: c.revenue, net: c.netIncome }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {KPIS.map((k, i) => <KpiCard key={i} kpi={k} />)}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Net Margin % by Company vs 30% Target</p>
          <ResponsiveContainer width="100%" height={240}>
            <RadialBarChart cx="50%" cy="50%" innerRadius={20} outerRadius={130} data={radialData} startAngle={180} endAngle={0}>
              <RadialBar dataKey="margin" label={{ position:'insideStart', fill:'#fff', fontSize:9 }} />
              <Tooltip formatter={(v:number) => `${v}%`} />
              <Legend iconSize={8} wrapperStyle={{ fontSize:10 }} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Revenue vs Net Income by Company</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ bottom:40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize:9 }} angle={-45} textAnchor="end" />
              <YAxis tickFormatter={v => `$${(v/1e6).toFixed(0)}M`} tick={{ fontSize:9 }} />
              <Tooltip formatter={(v:number) => fmt(v)} />
              <Legend />
              <Bar dataKey="revenue" fill={COLORS[0]} name="Revenue" />
              <Bar dataKey="net" fill={COLORS[1]} name="Net Income" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Tab: CFO Dashboard ────────────────────────────────────────────────────────
function CFOTab() {
  const totalNet = COMPANIES_DATA.reduce((s,c) => s+c.netIncome, 0);
  const totalLots = COMPANIES_DATA.reduce((s,c) => s+c.lots, 0);
  const totalSold = COMPANIES_DATA.reduce((s,c) => s+c.sold, 0);

  const tableData = [...COMPANIES_DATA]
    .map(c => {
      const margin = (c.netIncome / c.revenue) * 100;
      const status = margin >= 38 ? 'Outperformer' : margin >= 30 ? 'On Track' : 'Review';
      return { ...c, margin, status };
    })
    .sort((a,b) => b.netIncome - a.netIncome);

  const stackData = COMPANIES_DATA.map(c => ({
    name: short(c.name),
    Land: c.land,
    Hard: c.hard,
    Soft: c.soft,
    'Net Income': c.netIncome,
  }));

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label:'Portfolio Revenue', value: fmtM(TOTAL_REV) },
          { label:'Net Income',        value: fmtM(totalNet) },
          { label:'Net Margin',        value: `${((totalNet/TOTAL_REV)*100).toFixed(1)}%` },
          { label:'Lots Sold',         value: `${totalSold}/${totalLots}` },
          { label:'Cash Available',    value: '$6.42M' },
          { label:'Overdue',           value: '$75.5K', red:true },
        ].map((t,i) => (
          <div key={i} className={`rounded-lg p-3 text-center ${('red' in t && t.red) ? 'bg-red-50 border border-red-200' : 'bg-white border border-gray-200'} shadow-sm`}>
            <p className={`text-xl font-bold font-mono ${('red' in t && t.red) ? 'text-red-700' : 'text-gray-900'}`}>{t.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* Left: table + chart */}
        <div className="col-span-3 space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-900 text-white">
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Company</th>
                <th className="text-right px-3 py-2">Revenue</th>
                <th className="text-right px-3 py-2">Net Income</th>
                <th className="text-right px-3 py-2">Margin</th>
                <th className="text-right px-3 py-2">Lots</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr></thead>
              <tbody>
                {tableData.map((c,i) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-bold text-gray-400">{i+1}</td>
                    <td className="px-3 py-1.5 font-medium">{short(c.name)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtM(c.revenue)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-green-700">{fmtM(c.netIncome)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{c.margin.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right">{c.sold}/{c.lots}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'Outperformer' ? 'bg-green-100 text-green-700' : c.status === 'On Track' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
            <p className="text-xs font-semibold text-gray-700 mb-2">Cost Structure by Company</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stackData} margin={{ bottom:30 }}>
                <XAxis dataKey="name" tick={{ fontSize:9 }} angle={-40} textAnchor="end" />
                <YAxis tickFormatter={v => `$${(v/1e6).toFixed(0)}M`} tick={{ fontSize:9 }} />
                <Tooltip formatter={(v:number) => fmt(v)} />
                <Legend iconSize={8} wrapperStyle={{ fontSize:10 }} />
                <Bar dataKey="Land" stackId="a" fill={COLORS[0]} />
                <Bar dataKey="Hard" stackId="a" fill={COLORS[2]} />
                <Bar dataKey="Soft" stackId="a" fill={COLORS[3]} />
                <Bar dataKey="Net Income" stackId="a" fill={COLORS[1]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right column */}
        <div className="col-span-2 space-y-4">
          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
            <p className="text-xs font-semibold text-amber-600 uppercase mb-2">Top 3 Performers</p>
            {[
              { name:'WWBG (2024 net income)', net:'$79,584', rank:1 },
            ].map(p => (
              <div key={p.rank} className="flex items-center gap-3 p-2 rounded-lg border border-green-100 bg-green-50 mb-2">
                <span className="w-6 h-6 rounded-full bg-green-600 text-white text-xs flex items-center justify-center font-bold">{p.rank}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{p.name}</p>
                  <p className="text-xs text-green-700 font-mono font-bold">{p.net} net income</p>
                </div>
                <TrendingUp size={14} className="text-green-600 shrink-0" />
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-red-100">
            <p className="text-xs font-semibold text-red-600 uppercase mb-2">Attention Required</p>
            {[
              'WWBG: Cash covers only 1.1 months of EMI — Aug shortfall $16,732',
              'No distributions made — $2.22M partner capital fully at risk',
              '4 of 6 years net loss — only 2024 profitable ($79,584)',
            ].map((a,i) => (
              <div key={i} className="flex gap-2 p-2 rounded bg-red-50 border border-red-100 mb-2 text-xs">
                <AlertTriangle size={12} className="text-red-500 shrink-0 mt-0.5" />
                <span>{a}</span>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
            <p className="text-xs font-semibold text-gray-700 mb-2">13-Week Cash Flow</p>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={CASH_13}>
                <XAxis dataKey="week" tick={{ fontSize:9 }} />
                <YAxis domain={[6,8.5]} tickFormatter={v => `$${v}M`} tick={{ fontSize:9 }} />
                <Tooltip formatter={(v:number) => `$${v}M`} />
                <Line type="monotone" dataKey="balance" stroke={COLORS[1]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label:'Portfolio IRR', value:'22.4%' },
              { label:'DSCR',          value:'1.85x' },
              { label:'Equity Multiple', value:'1.38x' },
              { label:'Est. Completion', value:'Q4 2026' },
            ].map((m,i) => (
              <div key={i} className="bg-gray-900 rounded-lg p-3 text-center">
                <p className="text-white font-mono font-bold text-lg">{m.value}</p>
                <p className="text-gray-400 text-xs mt-0.5">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Strategic Insights ───────────────────────────────────────────────────
function StrategicTab() {
  const [expanded, setExpanded] = useState<number[]>([]);
  const [checked, setChecked] = useState<boolean[]>(() => {
    try { const s = localStorage.getItem(CHECKLIST_KEY); return s ? JSON.parse(s) : Array(6).fill(false); } catch { return Array(6).fill(false); }
  });

  useEffect(() => {
    localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checked));
  }, [checked]);

  const toggle = (id: number) => setExpanded(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleCheck = (i: number) => setChecked(p => { const n=[...p]; n[i]=!n[i]; return n; });

  const priBg: Record<string,string> = { CRITICAL:'border-red-400 bg-red-50', HIGH:'border-orange-400 bg-orange-50', MEDIUM:'border-amber-400 bg-amber-50', LOW:'border-gray-300 bg-gray-50' };

  const quadrants = [
    { key:'UH', label:'Urgent & High Impact', bg:'bg-red-50 border-red-300' },
    { key:'UL', label:'Urgent & Low Impact',  bg:'bg-amber-50 border-amber-300' },
    { key:'NH', label:'Not Urgent & High',    bg:'bg-blue-50 border-blue-300' },
    { key:'NL', label:'Not Urgent & Low',     bg:'bg-gray-50 border-gray-200' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-5">
        {/* Left: insight cards */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-700">Strategic Insights ({INSIGHTS.length})</p>
          {INSIGHTS.map(ins => (
            <div key={ins.id} className={`rounded-lg border-l-4 p-3 ${priBg[ins.priority]} border`}>
              <div className="flex items-start gap-2">
                <PriorityBadge p={ins.priority} />
                <span className="text-xs text-gray-500">{ins.category}</span>
                <button onClick={() => toggle(ins.id)} className="ml-auto text-gray-400">
                  {expanded.includes(ins.id) ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                </button>
              </div>
              <p className="text-sm font-semibold text-gray-800 mt-1">{ins.title}</p>
              <p className="text-xs text-gray-600 mt-0.5">{ins.text}</p>
              {expanded.includes(ins.id) && (
                <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                  <p className="text-xs font-semibold text-gray-700">Recommended Action:</p>
                  <p className="text-xs text-gray-700 mt-0.5">{ins.action}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right: matrix + checklist */}
        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Priority Action Matrix</p>
            <div className="grid grid-cols-2 gap-1">
              {quadrants.map(q => (
                <div key={q.key} className={`rounded-lg p-3 border ${q.bg}`}>
                  <p className="text-xs font-bold text-gray-700 mb-2">{q.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {INSIGHTS.filter(i => i.quad === q.key).map(i => (
                      <span key={i.id} className="text-xs bg-white border border-gray-200 rounded px-2 py-0.5">#{i.id} {i.title.split(' ').slice(0,2).join(' ')}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-3">CFO Sign-off Checklist</p>
            <div className="space-y-2">
              {CHECKLIST_ITEMS.map((item, i) => (
                <label key={i} className="flex items-start gap-2 cursor-pointer group">
                  <input type="checkbox" checked={checked[i]} onChange={() => toggleCheck(i)}
                    className="mt-0.5 w-4 h-4 accent-green-600 shrink-0" />
                  <span className={`text-xs ${checked[i] ? 'line-through text-gray-400' : 'text-gray-700 group-hover:text-gray-900'}`}>{item}</span>
                  {checked[i] && <CheckCircle size={12} className="text-green-500 shrink-0 mt-0.5" />}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">{checked.filter(Boolean).length}/{CHECKLIST_ITEMS.length} items complete — saved automatically</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Real WWBG Partner Data (from BS.xlsx 2026 capital balances) ───────────────
interface WwbgPartner { id: string; name: string; capital: number; pct: number; }
const WWBG_PARTNERS_STATIC: WwbgPartner[] = [
  { id:'rfamily', name:'R Family Ltd',  capital:238660, pct:10.73 },
  { id:'vre',     name:'VRE',           capital:230717, pct:10.38 },
  { id:'spsir',   name:'S PSIR',        capital:225592, pct:10.15 },
  { id:'rss',     name:'RSS',           capital:225536, pct:10.14 },
  { id:'ev',      name:'EV',            capital:211713, pct: 9.52 },
  { id:'rvdr',    name:'RVDR',          capital:119495, pct: 5.37 },
  { id:'hc',      name:'HC',            capital:119440, pct: 5.37 },
  { id:'scip',    name:'SCIP',          capital:119399, pct: 5.37 },
  { id:'bp',      name:'B P',           capital:112503, pct: 5.06 },
  { id:'nb',      name:'N B',           capital:109474, pct: 4.92 },
  { id:'sv',      name:'S V',           capital:109474, pct: 4.92 },
  { id:'vm',      name:'V M',           capital:109474, pct: 4.92 },
  { id:'mcca',    name:'MC @ CA',       capital:104576, pct: 4.70 },
  { id:'kv',      name:'KV',            capital:102576, pct: 4.61 },
  { id:'csp',     name:'CSP',           capital: 41039, pct: 1.85 },
  { id:'yb',      name:'Y B',           capital: 41035, pct: 1.85 },
  { id:'rm',      name:'R M',           capital:  2972, pct: 0.13 },
];
const WWBG_TOTAL_CAPITAL = 2223677;
const WWBG_LOAN          = 1787644;
const WWBG_EMI           = 17645;
const WWBG_COST_BASIS    = 3892736;

// ── Tab: Partners & Distribution ──────────────────────────────────────────────
function PartnersTab() {
  const { companies } = usePropDev();

  // Use real partners from DB context; fall back to static WWBG data
  const partners: WwbgPartner[] = useMemo(() => {
    const wwbg = companies.find(c => c.name.toUpperCase().includes('WWBG'));
    if (wwbg?.partners && wwbg.partners.length > 0) {
      const total = wwbg.partners.reduce((s, p) => s + p.capitalContributed, 0) || WWBG_TOTAL_CAPITAL;
      return wwbg.partners.map(p => ({
        id: p.id,
        name: p.name,
        capital: p.capitalContributed,
        pct: (p.capitalContributed / total) * 100,
      }));
    }
    return WWBG_PARTNERS_STATIC;
  }, [companies]);

  const totalCapital = partners.reduce((s, p) => s + p.capital, 0);

  const ownershipPie = partners.map((p, i) => ({
    name: p.name,
    value: p.capital,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label:'Total Partners',      value:String(partners.length),           bg:'bg-white border-gray-200',   text:'text-gray-900' },
          { label:'Total Capital In',    value:fmt(totalCapital),                 bg:'bg-white border-gray-200',   text:'text-gray-900' },
          { label:'Distributions Paid',  value:'$0',                              bg:'bg-amber-50 border-amber-200', text:'text-amber-700' },
          { label:'Next Distribution',   value:'Upon lot sale',                   bg:'bg-blue-50 border-blue-200', text:'text-blue-700'  },
        ].map((card, i) => (
          <div key={i} className={`rounded-lg p-4 border ${card.bg}`}>
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-lg font-bold font-mono ${card.text}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Section A: Partner Capital Summary Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-900 text-white px-4 py-2 text-sm font-bold">
          WWBG Partner Capital Summary — {partners.length} Partners
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Partner</th>
                <th className="text-right px-3 py-2">Capital Contributed</th>
                <th className="text-right px-3 py-2">Ownership %</th>
                <th className="text-right px-3 py-2">Distributions</th>
                <th className="text-right px-3 py-2">ROI</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p, i) => (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-gray-400 font-bold">{i + 1}</td>
                  <td className="px-3 py-1.5 font-medium">{p.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmt(p.capital)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-blue-700">{p.pct.toFixed(2)}%</td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-400">$0</td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-400">0.0%</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">Pre-sale</span>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold">
                <td className="px-3 py-2 text-gray-400" colSpan={2}>TOTAL ({partners.length} partners)</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(totalCapital)}</td>
                <td className="px-3 py-2 text-right font-mono text-blue-700">100.00%</td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">$0</td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">0.0%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Section B: Ownership chart + Waterfall structure */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-1">Ownership Distribution</p>
          <p className="text-xs text-gray-400 mb-3">Size = capital contributed</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={ownershipPie} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, pct }) => `${name} ${(pct * 100).toFixed(1)}%`} labelLine={false}>
                {ownershipPie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-amber-200">
          <p className="text-sm font-semibold text-gray-700 mb-1">Distribution Waterfall — Pre-Sale</p>
          <p className="text-xs text-amber-600 mb-4">No distributions yet. Structure applies upon first lot sale.</p>
          <div className="space-y-2 text-xs">
            {[
              { step: '1. Return of Capital',    note: '100% to partners (pro-rata)',      status: 'Pending' },
              { step: '2. Preferred Return (8%)', note: 'On unreturned capital per annum', status: 'Pending' },
              { step: '3. Residual Split',        note: 'Pro-rata by ownership %',         status: 'Pending' },
            ].map((w, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50">
                <div className="w-7 h-7 rounded-full bg-gray-800 text-white flex items-center justify-center font-bold text-xs shrink-0">{i + 1}</div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-800">{w.step}</p>
                  <p className="text-gray-500 mt-0.5">{w.note}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{w.status}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
            Break-even sale price: <strong>$4,862,551</strong> (includes 8% preferred return on $2.22M capital)
          </div>
        </div>
      </div>

      {/* Section C: Per-Partner WWBG Loan Exposure */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-blue-700 text-white px-4 py-2 text-sm font-bold">
          WWBG — Partner Loan Exposure (Pro-Rata Share)
        </div>
        <div className="text-xs text-gray-500 px-4 py-2 bg-blue-50 border-b border-blue-100">
          Based on: Loan outstanding $1,787,644 · Monthly EMI $17,645 · Total cost basis $3,892,736
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2">Partner</th>
                <th className="text-right px-3 py-2">Ownership %</th>
                <th className="text-right px-3 py-2">Share of Loan</th>
                <th className="text-right px-3 py-2">Monthly EMI Share</th>
                <th className="text-right px-3 py-2">Share of Cost Basis</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p, i) => {
                const f = p.pct / 100;
                return (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium">{p.name}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-blue-700">{p.pct.toFixed(2)}%</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(WWBG_LOAN * f)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(WWBG_EMI * f)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(WWBG_COST_BASIS * f)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold">
                <td className="px-3 py-2">TOTAL</td>
                <td className="px-3 py-2 text-right font-mono text-blue-700">100.00%</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(WWBG_LOAN)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(WWBG_EMI)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(WWBG_COST_BASIS)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Section D: CFO Insights */}
      <div className="space-y-2">
        {[
          { title:'No Distributions Made — $2.22M Fully at Risk', color:'bg-amber-50 border-amber-200', textColor:'text-amber-800',
            text:'All 17 partners have contributed capital with 0% returned. WWBG is in pre-sale phase. Distributions will trigger upon lot sale proceeds exceeding cost basis + preferred return.' },
          { title:'August EMI Shortfall: $16,732 Action Required', color:'bg-red-50 border-red-200', textColor:'text-red-800',
            text:'Current cash covers 1.1 months of EMI ($17,645/mo). Partners should be notified of the August shortfall. Consider a pro-rata capital call based on ownership percentages above.' },
          { title:'R Family Ltd & VRE Lead at 21.11% Combined', color:'bg-blue-50 border-blue-200', textColor:'text-blue-800',
            text:'Top 2 partners hold 21.11% of equity. Remaining 15 partners average 5.25% each. Concentration is within acceptable range — no diversification action needed for Phase 1.' },
        ].map((ins, i) => (
          <div key={i} className={`border rounded-lg p-4 ${ins.color}`}>
            <p className={`text-sm font-semibold mb-1 ${ins.textColor}`}>{ins.title}</p>
            <p className={`text-xs ${ins.textColor} opacity-90`}>{ins.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Upload: Types & Parser ────────────────────────────────────────────────────
interface PDFinItem {
  label: string; values: Record<number,number>; indent: number;
  isTotal: boolean; isSectionHeader: boolean; isNetIncome: boolean;
}
interface PDFinancials {
  companyName: string; years: number[];
  plFile: string; bsFile: string; uploadedAt: string;
  pl: PDFinItem[]; bs: PDFinItem[];
}

const PD_COMPANIES = ['WWBG'];
const PD_LS_KEY = (co: string) => `propdev_upload_${co.replace(/\s+/g,'_').toLowerCase()}`;

// ── Convert DB yearly JSON → PDFinancials (no file upload required) ──────────
function makeItem(label: string, values: Record<number,number>, opts?: Partial<PDFinItem>): PDFinItem {
  return { label, values, indent: 0, isTotal: false, isSectionHeader: false, isNetIncome: false, ...opts };
}

function wwbgBuildPL(
  yearlyPL: Record<string, { net_income: number; total_expenses: number; revenue?: number; other_income?: number; expenses_by_category?: Record<string,number> }>,
  years: number[]
): PDFinItem[] {
  const yv = (key: string) => Object.fromEntries(years.map(y => [y, yearlyPL[String(y)]?.[key as keyof typeof yearlyPL[string]] as number ?? 0])) as Record<number,number>;
  const items: PDFinItem[] = [
    makeItem('Income', {}, { isSectionHeader: true }),
    makeItem('Lot Sales Revenue', Object.fromEntries(years.map(y => [y, 0]))),
    makeItem('Other Income', Object.fromEntries(years.map(y => [y, Math.abs(yearlyPL[String(y)]?.other_income ?? 0)])) as Record<number,number>),
    makeItem('Total for Income', Object.fromEntries(years.map(y => [y, Math.abs(yearlyPL[String(y)]?.other_income ?? 0)])) as Record<number,number>, { isTotal: true }),
    makeItem('Expenses', {}, { isSectionHeader: true }),
  ];

  // Add per-category expense lines from first year that has them
  const firstWithCats = years.find(y => Object.keys(yearlyPL[String(y)]?.expenses_by_category ?? {}).length > 0);
  const catLabels: Record<string,string> = {
    interest_on_loan: 'Business Loan Interest',
    property_tax: 'Property Tax',
    hard_cost: 'Engineering Cost',
    soft_cost: 'Appraisal Fee',
    professional_charges: 'Book Keeping & Professional',
    legal_fees: 'Legal & Professional',
    title_charges: 'Escrow & Title Charges',
    loan_processing: 'Loan Processing Fee',
    other_charges: 'Management & Other',
  };
  if (firstWithCats !== undefined) {
    const allCats = Object.keys(yearlyPL[String(firstWithCats)]?.expenses_by_category ?? {});
    for (const cat of allCats) {
      const catVals = Object.fromEntries(
        years.map(y => [y, yearlyPL[String(y)]?.expenses_by_category?.[cat] ?? 0])
      ) as Record<number,number>;
      items.push(makeItem(catLabels[cat] ?? cat, catVals, { indent: 2 }));
    }
  }

  items.push(makeItem('Total for Expenses', yv('total_expenses'), { isTotal: true }));
  items.push(makeItem('Net Income', yv('net_income'), { isNetIncome: true }));
  return items;
}

function wwbgBuildBS(
  yearlyBS: Record<string, { cash: number; land: number; improvements: number; interest_capitalised: number; total_assets: number; loan_balance: number; total_liabilities: number }>,
  years: number[]
): PDFinItem[] {
  const yv = (key: string) => Object.fromEntries(years.map(y => [y, yearlyBS[String(y)]?.[key as keyof typeof yearlyBS[string]] as number ?? 0])) as Record<number,number>;
  const equityVals = Object.fromEntries(years.map(y => {
    const bs = yearlyBS[String(y)];
    return [y, bs ? bs.total_assets - bs.total_liabilities : 0];
  })) as Record<number,number>;

  return [
    makeItem('Current Assets', {}, { isSectionHeader: true }),
    makeItem('Total for Bank Accounts', yv('cash'), { isTotal: true }),
    makeItem('Fixed Assets', {}, { isSectionHeader: true }),
    makeItem('WWBL (Land)', yv('land'), { indent: 2 }),
    makeItem('Improvements', yv('improvements'), { indent: 2 }),
    makeItem('Interest Capitalised', yv('interest_capitalised'), { indent: 2 }),
    makeItem('Total for Assets', yv('total_assets'), { isTotal: true }),
    makeItem('Liabilities', {}, { isSectionHeader: true }),
    makeItem('Long-term Business Loan (Greater Plains Bank)', yv('loan_balance'), { indent: 2 }),
    makeItem('Total for Liabilities', yv('total_liabilities'), { isTotal: true }),
    makeItem('Equity', {}, { isSectionHeader: true }),
    makeItem('Total for Equity', equityVals, { isTotal: true }),
  ];
}

function buildWWBGFinancials(
  companyName: string,
  yearlyPL: Record<string,unknown> | undefined,
  yearlyBS: Record<string,unknown> | undefined,
): PDFinancials | null {
  if (!yearlyPL && !yearlyBS) return null;
  const allYears = Array.from(new Set([
    ...Object.keys(yearlyPL ?? {}),
    ...Object.keys(yearlyBS ?? {}),
  ])).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b);
  if (allYears.length === 0) return null;

  return {
    companyName,
    years: allYears,
    plFile: 'From database (WWBG seed)',
    bsFile: 'From database (WWBG seed)',
    uploadedAt: new Date().toISOString(),
    pl: yearlyPL ? wwbgBuildPL(yearlyPL as Parameters<typeof wwbgBuildPL>[0], allYears) : [],
    bs: yearlyBS ? wwbgBuildBS(yearlyBS as Parameters<typeof wwbgBuildBS>[0], allYears) : [],
  };
}

function pdDetectYears(raw: unknown[][]): { idx:number; cols:{year:number;col:number}[] } | null {
  for (let r=0; r<Math.min(raw.length,15); r++) {
    const row = raw[r] as unknown[];
    const cols: {year:number;col:number}[] = [];
    for (let c=0; c<row.length; c++) {
      const v = Number(row[c]);
      if (Number.isInteger(v) && v>=2018 && v<=2030) cols.push({year:v,col:c});
    }
    if (cols.length>=2) return {idx:r,cols};
  }
  return null;
}

function pdSheetType(raw: unknown[][]): 'pl'|'bs'|'unknown' {
  for (let r=0; r<Math.min(6,raw.length); r++) {
    const j = (raw[r] as unknown[]).map(c=>String(c??'').toLowerCase()).join(' ');
    if (j.includes('profit and loss')||j.includes('income statement')) return 'pl';
    if (j.includes('balance sheet')) return 'bs';
  }
  return 'unknown';
}

function pdParseRows(raw: unknown[][], hdrIdx: number, cols: {year:number;col:number}[]): PDFinItem[] {
  const items: PDFinItem[] = [];
  for (let r=hdrIdx+1; r<raw.length; r++) {
    const row = raw[r] as unknown[];
    const rawLbl = String(row[0]??'');
    const lbl = rawLbl.trim();
    if (!lbl) continue;
    const indent = rawLbl.length - rawLbl.trimStart().length;
    const isTotal = /^total\s+for\s+/i.test(lbl)||/^total\s+(assets|liabilities|equity)/i.test(lbl);
    const isNetIncome = /^net\s+income$/i.test(lbl);
    const vals: Record<number,number> = {};
    let hasAny = false;
    for (const {year,col} of cols) {
      const v = (row[col]===''||row[col]==null)?0:Number(row[col]);
      vals[year] = isNaN(v)?0:v;
      if (vals[year]!==0) hasAny=true;
    }
    const isSectionHeader = !hasAny && !isTotal && !isNetIncome;
    if (!hasAny && !isSectionHeader) continue;
    items.push({label:lbl,values:vals,indent,isTotal,isSectionHeader,isNetIncome});
  }
  return items;
}

function pdGetName(raw: unknown[][]): string {
  for (let r=0; r<Math.min(3,raw.length); r++) {
    const v = String((raw[r] as unknown[])[0]??'').trim();
    if (v&&v.length>2&&!/profit|loss|balance|sheet/i.test(v)) return v;
  }
  return '';
}

function pdParseFile(file: File): Promise<{type:'pl'|'bs'|'unknown';items:PDFinItem[];years:number[];name:string}> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer),{type:'array',cellFormula:false,cellHTML:false});
        for (const sn of wb.SheetNames) {
          const ws = wb.Sheets[sn];
          if (!ws) continue;
          const raw = XLSX.utils.sheet_to_json<unknown[]>(ws,{header:1,defval:''});
          const type = pdSheetType(raw);
          const yi = pdDetectYears(raw);
          if (!yi) continue;
          resolve({type,items:pdParseRows(raw,yi.idx,yi.cols),years:yi.cols.map(c=>c.year).sort((a,b)=>a-b),name:pdGetName(raw)});
          return;
        }
        resolve({type:'unknown',items:[],years:[],name:''});
      } catch(err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── Upload: KPI helpers ───────────────────────────────────────────────────────
function pdYV(items: PDFinItem[], pat: RegExp, y: number): number {
  return items.find(i=>pat.test(i.label))?.values[y]??0;
}
function pdSumI(items: PDFinItem[], pat: RegExp, y: number): number {
  return items.filter(i=>!i.isSectionHeader&&!i.isTotal&&pat.test(i.label))
    .reduce((s,i)=>s+(i.values[y]??0),0);
}
function pdKpis(fin: PDFinancials, y: number) {
  const p=fin.pl; const b=fin.bs;
  // QuickBooks exports income as negative credits in some formats — take abs to keep revenue positive
  const rawRev = pdYV(p,/^total\s+for\s+income$/i,y)||pdYV(p,/^total\s+income$/i,y)||pdYV(p,/^total\s+revenue$/i,y)||pdSumI(p,/^(other\s+)?income$/i,y);
  const rev = Math.abs(rawRev);
  const exp = Math.abs(pdYV(p,/^total\s+for\s+expenses?$/i,y)||pdYV(p,/^total\s+expenses?$/i,y));
  const netInc = pdYV(p,/^net\s+income$/i,y);
  const interest = Math.abs(pdSumI(p,/interest/i,y));
  const noi = rev - exp + interest;
  return { rev, exp, netInc, noi, interest,
    totalAssets: pdYV(b,/^total\s+for\s+assets$/i,y)||pdYV(b,/^total\s+assets$/i,y),
    totalLiab:   pdYV(b,/^total\s+for\s+liabilities$/i,y),
    equity:      pdYV(b,/^total\s+for\s+equity$/i,y),
    loans: Math.abs(pdYV(b,/^total\s+for\s+long.term/i,y)||pdSumI(b,/long.term\s+(business\s+)?loan/i,y)),
    buildings: Math.abs(pdYV(b,/^buildings$/i,y)),
    cash: pdYV(b,/^total\s+for\s+bank/i,y)||pdSumI(b,/bank|checking/i,y),
  };
}

// ── Upload: Formatters ────────────────────────────────────────────────────────
const pdFmtFull = (n: number) => {
  if (n===0) return '—';
  const abs = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.abs(n));
  return n<0?`(${abs})`:abs;
};
const pdFmt = (n: number) => {
  if (n===0) return '—';
  const abs=Math.abs(n);
  const s=abs>=1e6?`$${(abs/1e6).toFixed(2)}M`:abs>=1e3?`$${(abs/1e3).toFixed(1)}K`:`$${abs.toLocaleString()}`;
  return n<0?`(${s})`:s;
};

// ── Upload: P&L Table ─────────────────────────────────────────────────────────
function PDPLTable({ fin }: { fin: PDFinancials }) {
  if (!fin.pl.length) return (
    <p className="text-center text-gray-400 py-10 text-sm">
      No P&amp;L data. Click <strong>"Upload P&amp;L"</strong> above to upload the Profit &amp; Loss Excel file.
    </p>
  );
  const yrs=fin.years;
  const bg=(i: PDFinItem)=>i.isNetIncome?'bg-gray-900 text-white font-bold':i.isTotal?'bg-blue-50 font-semibold text-blue-900 border-t border-blue-200':i.isSectionHeader?'bg-amber-50 text-amber-800 font-semibold text-xs uppercase tracking-wide':'hover:bg-gray-50 text-gray-700';
  const pad=(i: PDFinItem)=>i.isTotal||i.isSectionHeader?'px-4':i.indent>4?'pl-12 pr-4':i.indent>1?'pl-8 pr-4':'pl-5 pr-4';
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead><tr className="bg-gray-900 text-white">
          <th className="text-left px-4 py-2.5 w-72">Line Item</th>
          {yrs.map(y=><th key={y} className="text-right px-3 py-2.5 min-w-[110px]">{y}</th>)}
        </tr></thead>
        <tbody>
          {fin.pl.map((item,i)=>(
            <tr key={i} className={`border-t border-gray-100 ${bg(item)}`}>
              <td className={`py-1.5 ${pad(item)}`}>{item.label}</td>
              {yrs.map(y=>(
                <td key={y} className={`py-1.5 px-3 text-right font-mono ${item.isNetIncome?'text-white':item.values[y]<0?'text-red-600':''}`}>
                  {item.values[y]===0?'—':pdFmtFull(item.values[y])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Upload: Balance Sheet Table ───────────────────────────────────────────────
function PDBSTable({ fin }: { fin: PDFinancials }) {
  if (!fin.bs.length) return (
    <p className="text-center text-gray-400 py-10 text-sm">
      No Balance Sheet data. Click <strong>"Upload B/S"</strong> above to upload the Balance Sheet Excel file.
    </p>
  );
  const yrs=fin.years;
  const bg=(item: PDFinItem)=>{
    const l=item.label.toLowerCase();
    if (/total\s+(for\s+)?(liabilities\s+and\s+equity|assets$)/.test(l)) return 'bg-gray-900 text-white font-bold';
    if (/total\s+for\s+liabilities$/.test(l)) return 'bg-orange-100 font-bold text-orange-900 border-t border-orange-300';
    if (/total\s+for\s+equity$/.test(l)) return 'bg-green-100 font-bold text-green-900 border-t border-green-300';
    if (item.isTotal) return 'bg-blue-50 font-semibold text-blue-900 border-t border-blue-200';
    if (item.isSectionHeader) return 'bg-gray-50 text-gray-700 font-semibold text-xs uppercase tracking-wide';
    return 'hover:bg-gray-50 text-gray-700';
  };
  const pad=(i: PDFinItem)=>i.isTotal||i.isSectionHeader?'px-4':i.indent>4?'pl-12 pr-4':i.indent>1?'pl-8 pr-4':'pl-5 pr-4';
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead><tr className="bg-gray-900 text-white">
          <th className="text-left px-4 py-2.5 w-72">Item</th>
          {yrs.map(y=><th key={y} className="text-right px-3 py-2.5 min-w-[120px]">Dec 31, {y}</th>)}
        </tr></thead>
        <tbody>
          {fin.bs.map((item,i)=>(
            <tr key={i} className={`border-t border-gray-100 ${bg(item)}`}>
              <td className={`py-1.5 ${pad(item)}`}>{item.label}</td>
              {yrs.map(y=>(
                <td key={y} className={`py-1.5 px-3 text-right font-mono ${item.values[y]<0?'text-red-500':''}`}>
                  {item.values[y]===0?'—':pdFmtFull(item.values[y])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Upload: KPI Dashboard (Power BI Executive Style) ─────────────────────────
function PDKPIView({ fin }: { fin: PDFinancials }) {
  const [chartType, setChartType] = useState<'Area'|'Line'|'Bar'>('Area');

  const lastY = fin.years[fin.years.length - 1];
  const prevY = fin.years.length >= 2 ? fin.years[fin.years.length - 2] : null;
  const k  = pdKpis(fin, lastY);
  const kP = prevY ? pdKpis(fin, prevY) : null;

  const noiM    = k.rev > 0 ? k.noi / k.rev * 100 : 0;
  const netM    = k.rev > 0 ? k.netInc / k.rev * 100 : 0;
  const ebitdaM = k.rev > 0 ? (k.netInc + k.interest) / k.rev * 100 : 0;
  const expR    = k.rev > 0 ? k.exp / k.rev * 100 : 0;
  const revG    = kP && kP.rev > 0 ? (k.rev - kP.rev) / kP.rev * 100 : null;
  const iCov    = k.interest > 0 ? k.noi / k.interest : 0;
  const ltv     = k.buildings > 0 ? k.loans / k.buildings * 100 : 0;
  const alR     = k.totalLiab > 0 ? k.totalAssets / k.totalLiab : 0;
  const dte     = k.equity > 0 ? k.totalLiab / k.equity : 0;
  const roa     = k.totalAssets > 0 ? k.netInc / k.totalAssets * 100 : 0;
  const roe     = k.equity > 0 ? k.netInc / k.equity * 100 : 0;
  const workingCapital = k.totalAssets - k.totalLiab;
  const consecutiveLossYears = (() => {
    let count = 0;
    for (let i = fin.years.length - 1; i >= 0; i--) {
      if (pdKpis(fin, fin.years[i]).netInc < 0) count++;
      else break;
    }
    return count;
  })();

  const fmtShort = (v: number) => {
    const abs = Math.abs(v);
    const s = abs >= 1e6 ? `$${(abs/1e6).toFixed(1)}M` : abs >= 1e3 ? `$${(abs/1e3).toFixed(1)}K` : `$${abs.toFixed(0)}`;
    return v < 0 ? `(${s})` : s;
  };

  const trendData = fin.years.map(y => {
    const kk = pdKpis(fin, y);
    return { year: String(y), revenue: kk.rev, expenses: kk.exp, netIncome: kk.netInc, noi: kk.noi };
  });

  const spark = (fn: (kk: ReturnType<typeof pdKpis>) => number) =>
    fin.years.map(y => ({ v: fn(pdKpis(fin, y)) }));

  const getExpBreak = (y: number) => {
    const items = fin.pl.filter(i => !i.isSectionHeader && !i.isTotal && !i.isNetIncome);
    const sum = (pat: RegExp) => items.filter(i => pat.test(i.label)).reduce((s, i) => s + Math.abs(i.values[y] ?? 0), 0);
    return {
      interest: sum(/interest/i),
      propTax:  sum(/tax/i),
      legal:    sum(/legal|attorney|account|book.keep/i),
      hoa:      sum(/hoa|association/i),
      mgmt:     sum(/management|mgmt/i),
      other:    items.filter(i => !/interest|tax|legal|attorney|account|book.keep|hoa|association|management|mgmt/i.test(i.label))
                     .reduce((s, i) => s + Math.abs(i.values[y] ?? 0), 0),
    };
  };

  const expByYear  = fin.years.map(y => ({ year: String(y), ...getExpBreak(y) }));
  const lastBreak  = getExpBreak(lastY);
  const interestPct = k.rev > 0 ? k.interest / k.rev * 100 : 0;
  const propTaxPct  = k.rev > 0 ? lastBreak.propTax / k.rev * 100 : 0;
  const mgmtPct     = k.rev > 0 ? lastBreak.mgmt / k.rev * 100 : 0;

  const radarData = [
    { subject: 'NOI Margin',   actual: Math.min(Math.max(noiM, 0), 100),                    benchmark: 35 },
    { subject: 'EBITDA',       actual: Math.min(Math.max(ebitdaM, 0), 100),                 benchmark: 45 },
    { subject: 'Rev Growth',   actual: Math.min(Math.max((revG ?? 0) * 3 + 50, 0), 100),   benchmark: 65 },
    { subject: 'Asset Safety', actual: Math.min(Math.max(alR / 2 * 100, 0), 100),           benchmark: 75 },
    { subject: 'Coverage',     actual: Math.min(Math.max(iCov / 3 * 100, 0), 100),          benchmark: 50 },
  ];

  const alerts: Array<{type:'warning'|'info'; text:string}> = [];
  if (ltv > 0 && ltv > 80) alerts.push({ type:'warning', text:`LTV at ${ltv.toFixed(1)}% — above 80% threshold. Accelerated principal payment needed to unlock better refinance rates.` });
  if (iCov > 0 && iCov < 1.5) alerts.push({ type:'warning', text:`Interest coverage ${iCov.toFixed(2)}x — below 1.5x safe harbor. NOI needs to grow from ${fmtShort(k.noi)} to ${fmtShort(k.interest * 1.5)}.` });
  if (consecutiveLossYears > 0) alerts.push({ type:'info', text:`Net loss for ${consecutiveLossYears} consecutive year(s) — driven by interest (${fmtShort(k.interest)}) and other costs. NOI is ${k.noi >= 0 ? 'healthy' : 'stressed'} at ${fmtShort(k.noi)}.` });

  const uploadDate    = fin.uploadedAt ? new Date(fin.uploadedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—';
  const uploadedFiles = [fin.plFile, fin.bsFile].filter(Boolean).join(' · ') || 'No files uploaded';

  const statusBg = (s: string) => ({
    good:'bg-green-100 text-green-700', warning:'bg-amber-100 text-amber-700',
    danger:'bg-red-100 text-red-700',  neutral:'bg-gray-100 text-gray-500',
  }[s] ?? 'bg-gray-100 text-gray-500');

  const tilesData = [
    { icon:<TrendingUp size={15}/>, label:'Total Revenue', value:fmtShort(k.rev),
      yoy:revG!==null?`${revG>=0?'↑':'↓'} ${Math.abs(revG).toFixed(1)}% vs prior year`:null, yoyPos:(revG??0)>=0,
      status:(revG??0)>5?'Growing':'Stable', statusColor:(revG??0)>0?'good':'neutral',
      accent:'bg-blue-500', iBg:'bg-blue-50', iCol:'text-blue-700',
      sp:spark(kk=>kk.rev), spCol:'#2a78d6' },
    { icon:<DollarSign size={15}/>, label:'Net Income', value:fmtShort(k.netInc),
      yoy:k.netInc<0?'Loss (debt-driven)':'Profitable', yoyPos:k.netInc>=0,
      status:k.netInc<0?'Note: Interest':'Positive', statusColor:k.netInc<0?'warning':'good',
      accent:k.netInc>=0?'bg-green-500':'bg-red-400', iBg:k.netInc>=0?'bg-green-50':'bg-red-50', iCol:k.netInc>=0?'text-green-700':'text-red-700',
      sp:spark(kk=>kk.netInc), spCol:k.netInc>=0?'#0ca30c':'#d03b3b' },
    { icon:<Building2 size={15}/>, label:'NOI — Operating', value:fmtShort(k.noi),
      yoy:kP&&kP.noi!==0?`${k.noi>=kP.noi?'↑':'↓'} ${Math.abs((k.noi-kP.noi)/Math.abs(kP.noi)*100).toFixed(1)}% vs prior`:null, yoyPos:k.noi>=(kP?.noi??k.noi),
      status:noiM>35?'Strong':noiM>25?'Healthy':'Watch', statusColor:noiM>35?'good':noiM>25?'warning':'danger',
      accent:k.noi>=0?'bg-green-500':'bg-red-500', iBg:'bg-green-50', iCol:'text-green-700',
      sp:spark(kk=>kk.noi), spCol:'#0ca30c' },
    { icon:<Percent size={15}/>, label:'NOI Margin', value:`${noiM.toFixed(1)}%`,
      yoy:'Benchmark ≥ 35%', yoyPos:noiM>=35,
      status:noiM>=35?'On Target':'Near Target', statusColor:noiM>=35?'good':'warning',
      accent:noiM>=35?'bg-green-500':'bg-amber-400', iBg:'bg-amber-50', iCol:'text-amber-700',
      sp:spark(kk=>kk.rev>0?kk.noi/kk.rev*100:0), spCol:'#fab219' },
    { icon:<Home size={15}/>, label:'LTV (Loan-to-Value)', value:ltv>0?`${ltv.toFixed(1)}%`:'N/A',
      yoy:ltv>0?(ltv>80?'Above 80% threshold':'Below 80% ✓'):'No loan data', yoyPos:ltv>0&&ltv<=80,
      status:ltv>0?(ltv>80?'Watch':'Good'):'N/A', statusColor:ltv>0?(ltv>80?'warning':'good'):'neutral',
      accent:ltv>80?'bg-orange-400':'bg-green-500', iBg:'bg-orange-50', iCol:'text-orange-700',
      sp:spark(kk=>kk.buildings>0?kk.loans/kk.buildings*100:0), spCol:'#eb6834' },
    { icon:<Shield size={15}/>, label:'Interest Coverage', value:iCov>0?`${iCov.toFixed(2)}x`:'N/A',
      yoy:'Safe harbor ≥ 1.5x', yoyPos:iCov>=1.5,
      status:iCov>0?(iCov>=1.5?'Safe':'Review'):'N/A', statusColor:iCov>0?(iCov>=1.5?'good':'danger'):'neutral',
      accent:iCov>=1.5?'bg-green-500':'bg-red-500', iBg:'bg-red-50', iCol:'text-red-700',
      sp:spark(kk=>kk.interest>0?kk.noi/kk.interest:0), spCol:iCov>=1.5?'#0ca30c':'#d03b3b' },
  ];

  return (
    <div className="space-y-3">

      {/* 1 — HEADER */}
      <div style={{background:'#1a2332',borderRadius:'10px',padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{color:'#fff',fontSize:'15px',fontWeight:500}}>{fin.companyName} — Financial Intelligence</div>
          <div style={{color:'#8899aa',fontSize:'11px',marginTop:'2px'}}>{uploadedFiles} · {fin.years.join(' · ')} · Uploaded {uploadDate}</div>
        </div>
        <div style={{display:'flex',gap:'6px'}}>
          <button className="text-xs px-3 py-1.5 rounded border border-gray-600 bg-gray-700 text-gray-300 hover:bg-gray-600">Export PDF</button>
          <button className="text-xs px-3 py-1.5 rounded bg-blue-700 text-white border border-blue-600 hover:bg-blue-600">Upload New</button>
        </div>
      </div>

      {/* 2 — HERO TILES */}
      <div className="grid grid-cols-6 gap-2">
        {tilesData.map((t,i)=>(
          <div key={i} className="bg-white rounded-xl p-3 border border-gray-100 relative overflow-hidden">
            <div className={`absolute top-0 left-0 right-0 h-[3px] ${t.accent}`}/>
            <div className={`w-7 h-7 rounded-lg ${t.iBg} flex items-center justify-center mb-2 mt-1`}>
              <span className={t.iCol}>{t.icon}</span>
            </div>
            <div className="text-lg font-mono font-medium leading-none text-gray-900">{t.value}</div>
            <div className="text-[10px] text-gray-400 mt-1">{t.label}</div>
            {t.yoy && (
              <div className={`text-[10px] mt-1.5 ${t.yoyPos?'text-green-600':'text-red-500'}`}>{t.yoy}</div>
            )}
            <div className={`text-[9px] px-1.5 py-0.5 rounded-full mt-1.5 inline-block ${statusBg(t.statusColor)}`}>{t.status}</div>
            {t.sp.length>=2 && (
              <div className="mt-2 h-6">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={t.sp}><Line type="monotone" dataKey="v" stroke={t.spCol} strokeWidth={1.5} dot={false}/></LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 3 — MID ROW: TREND + RADAR */}
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-3 bg-white rounded-xl p-4 border border-gray-100">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-sm font-medium text-gray-800">5-year financial trend</div>
              <div className="text-[10px] text-gray-400 mt-0.5">Revenue · NOI · Expenses · Net Income</div>
            </div>
            <div className="flex gap-0.5 bg-gray-100 rounded-md p-0.5">
              {(['Area','Line','Bar'] as const).map(t=>(
                <button key={t} className={`text-[9px] px-2 py-1 rounded ${chartType===t?'bg-white text-blue-600 shadow-sm font-medium':'text-gray-500 hover:text-gray-700'}`} onClick={()=>setChartType(t)}>{t}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            {chartType==='Bar' ? (
              <BarChart data={trendData} margin={{top:4,right:4,bottom:0,left:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" vertical={false}/>
                <XAxis dataKey="year" tick={{fontSize:9,fill:'#999'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:9,fill:'#999'}} tickFormatter={v=>fmtShort(v as number)} axisLine={false} tickLine={false} width={46}/>
                <Tooltip contentStyle={{fontSize:'11px',border:'0.5px solid #e5e7eb',borderRadius:'8px'}} formatter={(v:number,n:string)=>[fmtShort(v),n]}/>
                <Bar dataKey="revenue"   name="Revenue"    fill="#D4AF37" opacity={0.85} radius={[3,3,0,0]}/>
                <Bar dataKey="noi"       name="NOI"        fill="#0ca30c" opacity={0.85} radius={[3,3,0,0]}/>
                <Bar dataKey="expenses"  name="Expenses"   fill="#fab219" opacity={0.85} radius={[3,3,0,0]}/>
                <Bar dataKey="netIncome" name="Net Income" fill="#d03b3b" opacity={0.85} radius={[3,3,0,0]}/>
              </BarChart>
            ) : (
              <ComposedChart data={trendData} margin={{top:4,right:4,bottom:0,left:0}}>
                <defs>
                  <linearGradient id="kpiRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#2a78d6" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#2a78d6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="kpiNoiGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#0ca30c" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#0ca30c" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" vertical={false}/>
                <XAxis dataKey="year" tick={{fontSize:9,fill:'#999'}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:9,fill:'#999'}} tickFormatter={v=>fmtShort(v as number)} axisLine={false} tickLine={false} width={46}/>
                <Tooltip contentStyle={{fontSize:'11px',border:'0.5px solid #e5e7eb',borderRadius:'8px'}} formatter={(v:number,n:string)=>[fmtShort(v),n]}/>
                <ReferenceLine y={0} stroke="#e0e0e0" strokeDasharray="3 2"/>
                {chartType==='Area' ? (<>
                  <Area type="monotone" dataKey="revenue"   name="Revenue"    stroke="#2a78d6" fill="url(#kpiRevGrad)" strokeWidth={2} dot={{r:3,fill:'#2a78d6'}}/>
                  <Area type="monotone" dataKey="noi"       name="NOI"        stroke="#0ca30c" fill="url(#kpiNoiGrad)" strokeWidth={2} dot={{r:3,fill:'#0ca30c'}}/>
                </>) : (<>
                  <Line type="monotone" dataKey="revenue"   name="Revenue"    stroke="#2a78d6" strokeWidth={2} dot={{r:3,fill:'#2a78d6'}}/>
                  <Line type="monotone" dataKey="noi"       name="NOI"        stroke="#0ca30c" strokeWidth={2} dot={{r:3,fill:'#0ca30c'}}/>
                </>)}
                <Line type="monotone" dataKey="expenses"  name="Expenses"   stroke="#fab219" strokeWidth={1.5} strokeDasharray="4 3" dot={{r:2,fill:'#fab219'}}/>
                <Line type="monotone" dataKey="netIncome" name="Net Income" stroke="#d03b3b" strokeWidth={1.5} dot={{r:2,fill:'#d03b3b'}}/>
              </ComposedChart>
            )}
          </ResponsiveContainer>
          <div className="flex gap-3 mt-2 flex-wrap">
            {[{color:'#2a78d6',label:'Revenue'},{color:'#0ca30c',label:'NOI'},{color:'#fab219',label:'Expenses',dash:true},{color:'#d03b3b',label:'Net Income'}].map(l=>(
              <span key={l.label} className="flex items-center gap-1 text-[10px] text-gray-500">
                <span style={{width:'10px',height:'2px',background:l.color,display:'inline-block',borderTop:l.dash?`1px dashed ${l.color}`:'none'}}/>
                {l.label}
              </span>
            ))}
          </div>
        </div>

        <div className="col-span-2 bg-white rounded-xl p-4 border border-gray-100">
          <div className="text-sm font-medium text-gray-800 mb-0.5">Profitability snapshot</div>
          <div className="text-[10px] text-gray-400 mb-2">Key metrics vs benchmark ({lastY})</div>
          <ResponsiveContainer width="100%" height={160}>
            <RadarChart data={radarData} margin={{top:8,right:16,bottom:0,left:16}}>
              <PolarGrid stroke="#f0f0f0"/>
              <PolarAngleAxis dataKey="subject" tick={{fontSize:8,fill:'#999'}}/>
              <Radar dataKey="actual"    name="Actual"     stroke="#2a78d6" fill="#D4AF37" fillOpacity={0.1} strokeWidth={1.5}/>
              <Radar dataKey="benchmark" name="Benchmark"  stroke="#fab219" fill="#fab219" fillOpacity={0.05} strokeWidth={1} strokeDasharray="3 2"/>
            </RadarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-1.5 mt-2">
            {[
              {label:'NOI',    val:`${noiM.toFixed(1)}%`,    ok:noiM>=35},
              {label:'EBITDA', val:`${ebitdaM.toFixed(1)}%`, ok:ebitdaM>=45},
              {label:'Net',    val:`${netM.toFixed(1)}%`,    ok:netM>=0},
            ].map(m=>(
              <div key={m.label} className={`text-center p-2 rounded-lg ${m.ok?'bg-green-50':'bg-amber-50'}`}>
                <div className={`text-sm font-mono font-medium ${m.ok?'text-green-700':'text-amber-700'}`}>{m.val}</div>
                <div className="text-[9px] text-gray-400 mt-0.5">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4 — BOT ROW: EXPENSE BAR + SCORECARD */}
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-2 bg-white rounded-xl p-4 border border-gray-100">
          <div className="text-sm font-medium text-gray-800 mb-0.5">Expense structure by year</div>
          <div className="text-[10px] text-gray-400 mb-3">Stacked by category</div>
          <ResponsiveContainer width="100%" height={Math.max(160, fin.years.length*42)}>
            <BarChart data={expByYear} layout="vertical" margin={{top:0,right:10,bottom:0,left:35}}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f5f5f5"/>
              <XAxis type="number" tick={{fontSize:9,fill:'#999'}} tickFormatter={v=>fmtShort(v as number)} axisLine={false} tickLine={false}/>
              <YAxis dataKey="year" type="category" tick={{fontSize:9,fill:'#999'}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={{fontSize:'11px',borderRadius:'8px',border:'0.5px solid #e5e7eb'}} formatter={(v:number,n:string)=>[pdFmtFull(v),n]}/>
              <Bar dataKey="interest" name="Interest"    stackId="a" fill="#d03b3b"/>
              <Bar dataKey="propTax"  name="Prop Tax"   stackId="a" fill="#eb6834"/>
              <Bar dataKey="legal"    name="Legal/Acct" stackId="a" fill="#eda100"/>
              <Bar dataKey="hoa"      name="HOA"        stackId="a" fill="#D4AF37"/>
              <Bar dataKey="mgmt"     name="Mgmt"       stackId="a" fill="#1baf7a"/>
              <Bar dataKey="other"    name="Other"      stackId="a" fill="#73726c" radius={[0,4,4,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="col-span-3 bg-white rounded-xl p-4 border border-gray-100">
          <div className="text-sm font-medium text-gray-800 mb-3">KPI Scorecard</div>
          <div className="overflow-y-auto" style={{maxHeight:Math.max(200,fin.years.length*42)}}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="bg-gray-50">
                  <th className="text-left py-2 px-2 text-gray-400 font-normal text-[10px]">Metric</th>
                  <th className="text-right py-2 px-2 text-gray-400 font-normal text-[10px]">Value</th>
                  <th className="text-right py-2 px-2 text-gray-400 font-normal text-[10px]">Target</th>
                  <th className="text-center py-2 px-2 text-gray-400 font-normal text-[10px] w-8">●</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {([
                  {m:'NOI Margin',        v:`${noiM.toFixed(1)}%`,                      t:'>35%',    s:noiM>=35?'g':noiM>=25?'a':'r'},
                  {m:'Net Margin',        v:`${netM.toFixed(1)}%`,                      t:'>0%',     s:netM>=0?'g':'r'},
                  {m:'EBITDA Margin',     v:`${ebitdaM.toFixed(1)}%`,                   t:'>45%',    s:ebitdaM>=45?'g':'a'},
                  {m:'Asset/Liab Ratio',  v:alR>0?`${alR.toFixed(2)}x`:'N/A',          t:'>1.5x',   s:alR>=1.5?'g':alR>=1?'a':'r'},
                  {m:'LTV',               v:ltv>0?`${ltv.toFixed(1)}%`:'N/A',           t:'<80%',    s:ltv>0&&ltv<=80?'g':ltv<=90?'a':'r'},
                  {m:'Interest Coverage', v:iCov>0?`${iCov.toFixed(2)}x`:'N/A',         t:'>1.5x',   s:iCov>=1.5?'g':iCov>=1?'a':'r'},
                  {m:'ROA',               v:k.totalAssets>0?`${roa.toFixed(1)}%`:'N/A', t:'>4%',     s:roa>=4?'g':roa>=0?'a':'r'},
                  {m:'ROE',               v:k.equity>0?`${roe.toFixed(1)}%`:'N/A',      t:'>8%',     s:roe>=8?'g':roe>=0?'a':'r'},
                  {m:'DSCR (est.)',        v:iCov>0?`${iCov.toFixed(2)}x`:'N/A',        t:'>1.25x',  s:iCov>=1.25?'g':iCov>=1?'a':'r'},
                  {m:'Working Capital',   v:fmtShort(workingCapital),                   t:'Positive', s:workingCapital>0?'g':'r'},
                  {m:'Debt/Equity',        v:dte>0?`${dte.toFixed(1)}x`:'N/A',          t:'<5x',     s:dte>0&&dte<=5?'g':dte<=10?'a':'r'},
                  {m:'Cash on Hand',       v:k.cash>0?fmtShort(k.cash):'N/A',           t:'>$30K',   s:k.cash>=30000?'g':k.cash>0?'a':'n'},
                ] as const).map(row=>(
                  <tr key={row.m} className="hover:bg-gray-50/50">
                    <td className="py-1.5 px-2 text-gray-700">{row.m}</td>
                    <td className={`py-1.5 px-2 text-right font-mono font-medium ${row.s==='g'?'text-green-700':row.s==='r'?'text-red-600':'text-amber-600'}`}>{row.v}</td>
                    <td className="py-1.5 px-2 text-right text-gray-400 text-[10px]">{row.t}</td>
                    <td className="py-1.5 px-2 text-center">
                      {row.s!=='n' && <span className={`inline-block w-2 h-2 rounded-full ${row.s==='g'?'bg-green-500':row.s==='r'?'bg-red-500':'bg-amber-400'}`}/>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 5 — PROGRESS CARDS */}
      <div className="grid grid-cols-4 gap-2">
        {([
          { icon:<Landmark size={15}/>, label:'Interest burden',     value:fmtShort(k.interest),         pct:Math.min(interestPct,100),         barColor:'bg-red-500',   bg:'bg-red-50',   border:'border-red-100',   of:'of revenue', note:`${interestPct.toFixed(1)}% of revenue — largest single expense.` },
          { icon:<Settings size={15}/>, label:'Property tax load',   value:fmtShort(lastBreak.propTax),  pct:Math.min(propTaxPct,100),          barColor:'bg-amber-400', bg:'bg-amber-50', border:'border-amber-100', of:'of revenue', note:`${propTaxPct.toFixed(1)}% of revenue — monitor for assessment increases.` },
          { icon:<Settings size={15}/>, label:'Management cost',     value:fmtShort(lastBreak.mgmt),     pct:Math.min(mgmtPct*10,100),          barColor:'bg-blue-500',  bg:'bg-blue-50',  border:'border-blue-100',  of:'of revenue', note:`${mgmtPct.toFixed(1)}% of revenue — market 8–10% ${mgmtPct<=10?'✓':'— above range'}.` },
          { icon:<TrendingUp size={15}/>, label:'Revenue growth YoY', value:revG!==null?`${revG>=0?'+':''}${revG.toFixed(1)}%`:'N/A', pct:Math.min(Math.abs(revG??0)*2,100), barColor:(revG??0)>=0?'bg-green-500':'bg-red-500', bg:(revG??0)>=0?'bg-green-50':'bg-red-50', border:(revG??0)>=0?'border-green-100':'border-red-100', of:`${lastY} vs ${prevY??'—'}`, note:`Year-over-year revenue change.` },
        ] as const).map((card,i)=>(
          <div key={i} className={`${card.bg} border ${card.border} rounded-xl p-3`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-gray-500">{card.icon}</span>
              <span className="text-[9px] text-gray-400">{card.of}</span>
            </div>
            <div className="text-base font-mono font-medium text-gray-900">{card.value}</div>
            <div className="text-[10px] text-gray-500 mt-0.5 mb-2">{card.label}</div>
            <div className="h-1 bg-white/60 rounded-full overflow-hidden mb-1.5">
              <div className={`h-full ${card.barColor} rounded-full`} style={{width:`${card.pct}%`}}/>
            </div>
            <div className="text-[9px] text-gray-500 leading-relaxed">{card.note}</div>
          </div>
        ))}
      </div>

      {/* 6 — CFO ALERT BANNER */}
      {alerts.length>0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0"/>
            <span className="text-xs font-medium text-amber-800">CFO action items — {fin.companyName}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {alerts.map((a,i)=>(
              <div key={i} className="flex-1 min-w-[180px] text-[10px] text-amber-800 leading-relaxed">
                {a.type==='warning'?'⚠':'ℹ'} {a.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upload: CFO Dashboard ─────────────────────────────────────────────────────
function PDCFOView({ fin }: { fin: PDFinancials }) {
  const lastY=fin.years[fin.years.length-1];
  const k=pdKpis(fin,lastY);
  const snap=fin.years.map(y=>{const kk=pdKpis(fin,y);return{year:y,rev:kk.rev,exp:kk.exp,net:kk.netInc,noi:kk.noi,margin:kk.rev>0?kk.netInc/kk.rev*100:0};});
  const revChart=fin.years.map(y=>{const kk=pdKpis(fin,y);return{year:String(y),Revenue:kk.rev,Expenses:kk.exp,'Net Income':kk.netInc};});
  const expPie=[{name:'Interest',value:k.interest},{name:'Other',value:Math.max(0,k.exp-k.interest)}].filter(e=>e.value>0);
  const firstK=pdKpis(fin,fin.years[0]);
  const revG=firstK.rev>0?((k.rev-firstK.rev)/firstK.rev*100).toFixed(1):null;
  const avgRev=fin.years.reduce((s,y)=>s+pdKpis(fin,y).rev,0)/fin.years.length;
  const ltv=k.buildings>0?(k.loans/k.buildings*100):0;
  const negYrs=snap.filter(r=>r.net<0).length;
  const insights:Array<{color:string;text:string}>=[];
  if (k.interest>0) insights.push({color:'bg-blue-50 border-blue-200',text:`💡 Interest expense is ${k.rev>0?(k.interest/k.rev*100).toFixed(1):0}% of revenue — ${pdFmt(k.interest)}. Outstanding loans: ${pdFmt(k.loans)}.`});
  if (negYrs>0) insights.push({color:'bg-amber-50 border-amber-200',text:`⚠️ Net income negative for ${negYrs} of ${fin.years.length} years. NOI is ${k.noi>=0?'positive':'negative'} at ${pdFmt(k.noi)}, indicating ${k.noi>=0?'healthy':'stressed'} pre-debt operations.`});
  if (revG!==null) insights.push({color:'bg-green-50 border-green-200',text:`✅ Revenue grew ${revG}% from ${fin.years[0]} to ${lastY}: ${pdFmt(firstK.rev)} → ${pdFmt(k.rev)}. Avg annual: ${pdFmt(avgRev)}/yr.`});
  if (k.buildings>0) insights.push({color:'bg-gray-50 border-gray-200',text:`📋 Buildings: ${pdFmt(k.buildings)} | Loans: ${pdFmt(k.loans)} | LTV: ${ltv.toFixed(1)}% — ${ltv<80?'✅ Good (<80%)':ltv<90?'⚠️ Watch (80–90%)':'🔴 High (>90%)'}`});
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-900 text-white px-4 py-2 text-sm font-bold">5-Year Snapshot — {fin.companyName}</div>
        <table className="w-full text-xs">
          <thead><tr className="bg-gray-50 border-b border-gray-200">
            {['Year','Revenue','Expenses','Net Income','NOI','Margin %'].map(h=>(
              <th key={h} className={`px-4 py-2 font-semibold text-gray-600 ${h==='Year'?'text-left':'text-right'}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {snap.map((r,i)=>(
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2 font-bold">{r.year}</td>
                <td className="px-4 py-2 text-right font-mono">{pdFmt(r.rev)}</td>
                <td className="px-4 py-2 text-right font-mono text-red-600">{pdFmt(r.exp)}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${r.net>=0?'text-green-700':'text-red-600'}`}>{pdFmt(r.net)}</td>
                <td className={`px-4 py-2 text-right font-mono ${r.noi>=0?'text-blue-700':'text-red-600'}`}>{pdFmt(r.noi)}</td>
                <td className={`px-4 py-2 text-right font-mono ${r.margin>=0?'text-green-700':'text-red-600'}`}>{r.margin.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Revenue vs Expenses by Year</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={revChart} margin={{left:10}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{fontSize:10}} />
              <YAxis tickFormatter={v=>pdFmt(v as number)} tick={{fontSize:9}} />
              <Tooltip formatter={(v:number)=>pdFmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{fontSize:10}} />
              <Bar dataKey="Revenue"    fill={COLORS[0]} />
              <Bar dataKey="Expenses"   fill={COLORS[5]} />
              <Bar dataKey="Net Income" fill={COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Expense Breakdown ({lastY})</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={expPie} cx="50%" cy="50%" outerRadius={70} dataKey="value">
                {expPie.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v:number)=>pdFmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{fontSize:10}} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">CFO Insights</p>
        {insights.map((ins,i)=>(<div key={i} className={`border rounded-lg p-4 ${ins.color}`}><p className="text-sm text-gray-800">{ins.text}</p></div>))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const PROPDEV_STORAGE_KEYS = ['propdev_cfo_checklist'];

export default function PropDevFinancials() {
  const { companies } = usePropDev();
  const [activeTab, setActiveTab] = useState<TabType>('P&L Statement');
  const [selectedPDCo, setSelectedPDCo] = useState(PD_COMPANIES[0]);
  const [uploadedFin, setUploadedFin] = useState<PDFinancials | null>(null);
  const [uploading, setUploading] = useState(false);
  const plRef = useRef<HTMLInputElement>(null);
  const bsRef = useRef<HTMLInputElement>(null);

  // All real PropDev companies from DB — put them first in the dropdown
  const allCompanyNames = useMemo(() => {
    const dbNames = companies.map(c => c.name);
    const extras = PD_COMPANIES.filter(n => !dbNames.some(d => d.toUpperCase().includes(n.toUpperCase()) || n.toUpperCase().includes(d.toUpperCase())));
    return [...dbNames, ...extras];
  }, [companies]);

  useEffect(() => {
    PROPDEV_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
  }, []);

  // Load stored data when company changes; auto-populate WWBG from DB
  useEffect(() => {
    // Check localStorage first (manually uploaded files override DB data)
    const raw = localStorage.getItem(PD_LS_KEY(selectedPDCo));
    if (raw) {
      try { setUploadedFin(JSON.parse(raw)); return; } catch { /* fall through */ }
    }

    // Auto-populate from DB for any company that has yearly_pl/yearly_bs in context
    const dbCompany = companies.find(c =>
      c.name.toUpperCase().includes(selectedPDCo.toUpperCase()) ||
      selectedPDCo.toUpperCase().includes(c.name.toUpperCase())
    );
    if (dbCompany && (dbCompany.yearlyPL || dbCompany.yearlyBS)) {
      const fin = buildWWBGFinancials(
        dbCompany.name,
        dbCompany.yearlyPL as Record<string,unknown> | undefined,
        dbCompany.yearlyBS as Record<string,unknown> | undefined,
      );
      setUploadedFin(fin);
    } else {
      setUploadedFin(null);
    }
  }, [selectedPDCo, companies]);

  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const result = await pdParseFile(file);
      if (result.type === 'unknown') { alert('Could not detect sheet type. Ensure the file contains "Profit and Loss" or "Balance Sheet" in the first 6 rows.'); return; }
      setUploadedFin(prev => {
        const base: PDFinancials = prev ?? { companyName: selectedPDCo, years: [], plFile: '', bsFile: '', uploadedAt: '', pl: [], bs: [] };
        const allYears = Array.from(new Set([...base.years, ...result.years])).sort((a,b)=>a-b);
        const next: PDFinancials = {
          ...base,
          years: allYears,
          companyName: result.name || selectedPDCo,
          uploadedAt: new Date().toISOString(),
          ...(result.type==='pl' ? {pl:result.items, plFile:file.name} : {bs:result.items, bsFile:file.name}),
        };
        localStorage.setItem(PD_LS_KEY(selectedPDCo), JSON.stringify(next));
        return next;
      });
    } catch(e) { alert(`Upload failed: ${e instanceof Error?e.message:String(e)}`); }
    finally { setUploading(false); }
  }, [selectedPDCo]);

  const clearData = useCallback(() => {
    localStorage.removeItem(PD_LS_KEY(selectedPDCo));
    setUploadedFin(null);
  }, [selectedPDCo]);

  const dataTabActive = activeTab !== 'Strategic Insights' && activeTab !== 'Partners & Distribution';

  const UploadBar = () => (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
      <FileSpreadsheet size={16} className="text-gray-400 flex-shrink-0" />
      <span className="text-xs text-gray-500 flex-1">
        {uploadedFin
          ? <>P&L: <span className="font-medium text-gray-700">{uploadedFin.plFile||'—'}</span> &nbsp;|&nbsp; B/S: <span className="font-medium text-gray-700">{uploadedFin.bsFile||'—'}</span></>
          : 'Upload P&L and Balance Sheet Excel files for this entity'}
      </span>
      <button disabled={uploading} onClick={()=>plRef.current?.click()}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md disabled:opacity-50 transition-colors">
        <Upload size={12} />{uploading?'Uploading…':'Upload P&L'}
      </button>
      <button disabled={uploading} onClick={()=>bsRef.current?.click()}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-md disabled:opacity-50 transition-colors">
        <Upload size={12} />{uploading?'Uploading…':'Upload B/S'}
      </button>
      {uploadedFin && (
        <button onClick={clearData}
          className="px-3 py-1.5 text-xs font-medium border border-red-300 text-red-600 hover:bg-red-50 rounded-md transition-colors">
          Clear
        </button>
      )}
      <input ref={plRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);e.target.value='';}} />
      <input ref={bsRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);e.target.value='';}} />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Financials</h1>
          <p className="text-xs text-gray-500">
            {uploadedFin
              ? `${uploadedFin.companyName} — ${uploadedFin.years.length > 0 ? uploadedFin.years.join(', ') : 'no year data'}`
              : 'Upload financial statements to view analysis'}
          </p>
        </div>
        {dataTabActive && (
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-gray-400" />
            <select
              value={selectedPDCo}
              onChange={e => setSelectedPDCo(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
            >
              {allCompanyNames.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === t ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-gray-800'
            }`}
          >{t}</button>
        ))}
      </div>

      {/* Upload bar (only for data tabs) */}
      {dataTabActive && <UploadBar />}

      {/* Content */}
      <div className="min-h-[400px]">
        {dataTabActive && !uploadedFin ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <FileSpreadsheet size={28} className="text-gray-400" />
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-2">No data for {selectedPDCo}</p>
            <p className="text-sm text-gray-400 max-w-sm mb-4">
              Upload the Profit &amp; Loss and Balance Sheet Excel files above to view financial analysis.
            </p>
            <div className="flex gap-3">
              <button onClick={()=>plRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
                <Upload size={14} />Upload P&amp;L File
              </button>
              <button onClick={()=>bsRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors">
                <Upload size={14} />Upload Balance Sheet
              </button>
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'P&L Statement'           && (uploadedFin ? <PDPLTable fin={uploadedFin} /> : null)}
            {activeTab === 'Balance Sheet'           && (uploadedFin ? <PDBSTable fin={uploadedFin} /> : null)}
            {activeTab === 'KPI Dashboard'           && (uploadedFin ? <PDKPIView fin={uploadedFin} /> : null)}
            {activeTab === 'CFO Dashboard'           && (uploadedFin ? <PDCFOView fin={uploadedFin} /> : null)}
            {activeTab === 'Partners & Distribution' && <PartnersTab />}
            {activeTab === 'Strategic Insights'      && <StrategicTab />}
          </>
        )}
      </div>
    </div>
  );
}
