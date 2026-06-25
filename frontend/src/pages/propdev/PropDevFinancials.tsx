import { useState, useEffect, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Upload, FileSpreadsheet, Building2 } from 'lucide-react';

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
  { id:1,  priority:'CRITICAL', category:'Partner Relations',  title:'Capital Calls Overdue',          text:'6 capital calls totalling $75,500 overdue across Cascade, Keystone, Apex, Vanguard, Monarch, Skyline.',   action:'Immediate outreach — email + call. Late fee per op agreement.',                         quad:'UH' },
  { id:2,  priority:'HIGH',     category:'Revenue',            title:'Revenue Optimization — Summit',  text:'Summit RE Group has 7 lots remaining at $360K avg = $2.5M unrealized.',                                  action:'Aggressive pricing + Phase 2 buyer incentive bundle.',                                  quad:'UH' },
  { id:3,  priority:'HIGH',     category:'Inventory Risk',     title:'112 Lots Remaining',             text:'At 32 lots/month velocity = 3.5 months runway.',                                                         action:'Increase marketing on 4 slow projects. 5% discount on >12mo aged.',                      quad:'UL' },
  { id:4,  priority:'HIGH',     category:'Partner',            title:'Partner Distribution Ready',     text:'$38.76M net income available. Class A investors (8% pref) await payout.',                                action:'Prepare waterfall distribution schedule for Q3 2026.',                                  quad:'UH' },
  { id:5,  priority:'HIGH',     category:'Cost Control',       title:'Riverview Cost Ratio High',      text:'Riverview cost ratio 69.7% vs portfolio avg 61.3%.',                                                    action:'Cost audit — identify soft cost and interest overruns.',                                 quad:'NH' },
  { id:6,  priority:'MEDIUM',   category:'Liquidity',          title:'Cash Deployment',                text:'$6.42M cash earning minimal return. 3 entities below $500K minimum.',                                    action:'Establish $300K floor per entity. Sweep excess to money market.',                        quad:'NH' },
  { id:7,  priority:'MEDIUM',   category:'Margin Watch',       title:'Cornerstone Near Floor',         text:'Cornerstone at 30.3% margin, just above 30% floor.',                                                    action:'Monthly margin review. Freeze discretionary spend immediately.',                          quad:'NH' },
  { id:8,  priority:'MEDIUM',   category:'Tax Planning',       title:'Tax Optimization',               text:'Soft costs and interest may be immediately deductible vs capitalized.',                                   action:'CPA review for cost segregation — potential $200K+ tax saving.',                         quad:'NH' },
  { id:9,  priority:'LOW',      category:'Financing',          title:'Untapped Borrowing Capacity',    text:'LTV at 42% vs 60% limit = $20M+ untapped borrowing capacity.',                                          action:'Prepare portfolio credit facility proposal for Phase 2 land.',                           quad:'NL' },
  { id:10, priority:'LOW',      category:'Strategy',           title:'Geographic Concentration',       text:'All 12 companies Texas-only. Single-state concentration risk.',                                          action:'AZ/FL market analysis for Phase 3 pipeline — target Q3 2026.',                          quad:'NL' },
];

const CHECKLIST_ITEMS = [
  'Review capital call status with all 6 partners',
  'Approve Q3 distribution waterfall',
  'Cost audit initiated for Riverview & Cornerstone',
  'Cash floor policy communicated to all entities',
  'CPA briefed on tax optimization',
  'Phase 2 land pipeline review scheduled',
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
              { name:'Riverview Land Partners', net:'$4.61M', rank:1 },
              { name:'Summit RE Group',         net:'$4.32M', rank:2 },
              { name:'Horizon Land Group',      net:'$3.95M', rank:3 },
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
              'Capital calls overdue: 6 partners, $75,500 total',
              'Riverview cost ratio: 69.7% (above 65% threshold)',
              'Cornerstone margin: 30.3% (near floor)',
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

// ── Partner Data ──────────────────────────────────────────────────────────────
type PartnerNature = 'GP' | 'LP' | 'Class A' | 'Class B' | 'Silent';
interface PartnerRow {
  id: string; name: string; nature: PartnerNature;
  invested: number; bookValue: number; preferred: number; ownership: number;
  committed: number; called: number; distributions: number;
  lastCall: string; status: 'overdue' | 'pending' | 'received';
}

const PARTNER_FINANCIALS: PartnerRow[] = [
  { id:'cascade',  name:'Cascade Capital Group',    nature:'GP',      invested:12500000, bookValue:15800000, preferred:8.0, ownership:15.0, committed:12500000, called:12500000, distributions:2800000, lastCall:'Aug 2025', status:'overdue'  },
  { id:'keystone', name:'Keystone Investment LLC',  nature:'LP',      invested:8750000,  bookValue:10900000, preferred:8.0, ownership:10.5, committed:9000000,  called:8750000,  distributions:1950000, lastCall:'Sep 2025', status:'overdue'  },
  { id:'apex',     name:'Apex RE Fund II',          nature:'Class A', invested:15000000, bookValue:18200000, preferred:8.0, ownership:18.0, committed:15000000, called:15000000, distributions:3800000, lastCall:'Aug 2025', status:'overdue'  },
  { id:'vanguard', name:'Vanguard Land Partners',   nature:'LP',      invested:6250000,  bookValue:7800000,  preferred:8.0, ownership:7.5,  committed:7000000,  called:6250000,  distributions:1200000, lastCall:'Sep 2025', status:'overdue'  },
  { id:'monarch',  name:'Monarch Capital RE',       nature:'Class B', invested:9000000,  bookValue:10650000, preferred:6.0, ownership:10.8, committed:9000000,  called:9000000,  distributions:980000,  lastCall:'Aug 2025', status:'overdue'  },
  { id:'skyline',  name:'Skyline Investment Group', nature:'Class A', invested:11000000, bookValue:13400000, preferred:8.0, ownership:13.2, committed:11000000, called:11000000, distributions:2200000, lastCall:'Sep 2025', status:'overdue'  },
  { id:'granite',  name:'Granite Peak Ventures',    nature:'Class B', invested:7500000,  bookValue:8900000,  preferred:6.0, ownership:9.0,  committed:8000000,  called:7500000,  distributions:850000,  lastCall:'Oct 2025', status:'pending'  },
  { id:'riviera',  name:'Riviera Capital Partners', nature:'Silent',  invested:5000000,  bookValue:5900000,  preferred:5.0, ownership:6.0,  committed:5000000,  called:5000000,  distributions:600000,  lastCall:'Oct 2025', status:'received' },
];

const NATURE_BADGE: Record<PartnerNature, string> = {
  'GP':      'bg-green-800 text-white',
  'LP':      'bg-blue-600 text-white',
  'Class A': 'bg-amber-500 text-white',
  'Class B': 'bg-purple-600 text-white',
  'Silent':  'bg-gray-500 text-white',
};

const WATERFALL_DATA = [
  { stage:'Preferred Return', GP:0,        LP:1248000, ClassA:2152000, ClassB:1188000, Silent:250000 },
  { stage:'Return of Capital', GP:1250000, LP:2625000, ClassA:4500000, ClassB:2700000, Silent:0      },
  { stage:'GP Promote (20%)', GP:1580000,  LP:0,       ClassA:0,       ClassB:0,       Silent:0      },
  { stage:'Residual Split',   GP:2200000,  LP:1850000, ClassA:2800000, ClassB:1600000, Silent:350000 },
];

const CO_PARTNER_DATA = [
  { company:'Sunstone',    gp:8.5,  lp:6.2, classA:4.1, classB:0,   silent:0   },
  { company:'Meridian',    gp:10.2, lp:7.8, classA:5.3, classB:3.1, silent:0   },
  { company:'Cornerstone', gp:7.1,  lp:5.5, classA:3.8, classB:2.2, silent:0   },
  { company:'Pinnacle I',  gp:6.8,  lp:4.9, classA:3.2, classB:0,   silent:1.8 },
  { company:'Pinnacle II', gp:7.4,  lp:5.8, classA:4.5, classB:2.8, silent:0   },
  { company:'Oakridge',    gp:9.1,  lp:7.2, classA:5.0, classB:3.5, silent:0   },
  { company:'Heritage',    gp:8.3,  lp:6.4, classA:4.6, classB:2.1, silent:0   },
  { company:'Summit',      gp:11.2, lp:8.9, classA:6.2, classB:4.1, silent:0   },
  { company:'Crestview',   gp:7.8,  lp:6.0, classA:4.2, classB:2.5, silent:0   },
  { company:'Riverview',   gp:12.5, lp:9.8, classA:6.8, classB:4.5, silent:0   },
  { company:'Landmark',    gp:6.5,  lp:5.0, classA:3.5, classB:0,   silent:1.5 },
  { company:'Horizon',     gp:9.8,  lp:7.5, classA:5.2, classB:3.2, silent:1.8 },
];

// ── Tab: Partners & Distribution ──────────────────────────────────────────────
function PartnersTab() {
  const totalInvested = PARTNER_FINANCIALS.reduce((s, p) => s + p.invested, 0);
  const totalBook     = PARTNER_FINANCIALS.reduce((s, p) => s + p.bookValue, 0);
  const totalDist     = PARTNER_FINANCIALS.reduce((s, p) => s + p.distributions, 0);
  const totalCalled   = PARTNER_FINANCIALS.reduce((s, p) => s + p.called, 0);
  const totalCommit   = PARTNER_FINANCIALS.reduce((s, p) => s + p.committed, 0);

  const distPie = PARTNER_FINANCIALS.map((p, i) => ({
    name: p.name.split(' ').slice(0, 2).join(' '),
    value: p.distributions,
    fill: COLORS[i % COLORS.length],
  }));

  const statusPill: Record<string, string> = {
    overdue:  'bg-red-100 text-red-800',
    pending:  'bg-amber-100 text-amber-800',
    received: 'bg-green-100 text-green-800',
  };
  const statusLabel: Record<string, string> = { overdue: 'Overdue', pending: 'Pending', received: 'Received' };

  return (
    <div className="space-y-6">

      {/* Section A: Partner Capital Summary Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-900 text-white px-4 py-2 text-sm font-bold">Partner Capital Summary</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2">Partner</th>
                <th className="text-left px-3 py-2">Nature</th>
                <th className="text-right px-3 py-2">Invested</th>
                <th className="text-right px-3 py-2">Book Value</th>
                <th className="text-right px-3 py-2">ROI %</th>
                <th className="text-right px-3 py-2">Pref %</th>
                <th className="text-right px-3 py-2">Ownership %</th>
                <th className="text-right px-3 py-2">Committed</th>
                <th className="text-right px-3 py-2">Called</th>
                <th className="text-right px-3 py-2">Distributions</th>
                <th className="text-center px-3 py-2">Last Call</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {PARTNER_FINANCIALS.map(p => {
                const roi = ((p.bookValue - p.invested) / p.invested * 100).toFixed(1);
                return (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${NATURE_BADGE[p.nature]}`}>{p.nature}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmtM(p.invested)}</td>
                    <td className="px-3 py-2 text-right font-mono text-green-700">{fmtM(p.bookValue)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-blue-700">{roi}%</td>
                    <td className="px-3 py-2 text-right">{p.preferred.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right">{p.ownership.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtM(p.committed)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtM(p.called)}</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-700">{fmtM(p.distributions)}</td>
                    <td className="px-3 py-2 text-center text-gray-500">{p.lastCall}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusPill[p.status]}`}>{statusLabel[p.status]}</span>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-gray-300 bg-gray-100 font-bold">
                <td className="px-3 py-2" colSpan={2}>TOTALS</td>
                <td className="px-3 py-2 text-right font-mono">{fmtM(totalInvested)}</td>
                <td className="px-3 py-2 text-right font-mono text-green-700">{fmtM(totalBook)}</td>
                <td className="px-3 py-2 text-right font-mono text-blue-700">{((totalBook - totalInvested) / totalInvested * 100).toFixed(1)}%</td>
                <td className="px-3 py-2 text-right">—</td>
                <td className="px-3 py-2 text-right">72.0%</td>
                <td className="px-3 py-2 text-right font-mono">{fmtM(totalCommit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtM(totalCalled)}</td>
                <td className="px-3 py-2 text-right font-mono text-amber-700">{fmtM(totalDist)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Section B: Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Waterfall Distribution by Stage ($)</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={WATERFALL_DATA} margin={{ bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="stage" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" />
              <YAxis tickFormatter={v => `$${(v / 1e6).toFixed(1)}M`} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="GP"      stackId="a" fill={COLORS[1]}  />
              <Bar dataKey="LP"      stackId="a" fill={COLORS[0]}  />
              <Bar dataKey="ClassA"  stackId="a" fill={COLORS[3]}  name="Class A" />
              <Bar dataKey="ClassB"  stackId="a" fill={COLORS[4]}  name="Class B" />
              <Bar dataKey="Silent"  stackId="a" fill={COLORS[11]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Distributions by Partner</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={distPie} cx="50%" cy="50%" outerRadius={80} dataKey="value">
                {distPie.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtM(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Section C: Per-Company Partner Exposure */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-blue-700 text-white px-4 py-2 text-sm font-bold">Per-Company Partner Exposure ($M)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-3 py-2">Company</th>
                <th className="text-right px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-green-800 text-white">GP</span></th>
                <th className="text-right px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-blue-600 text-white">LP</span></th>
                <th className="text-right px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-amber-500 text-white">Class A</span></th>
                <th className="text-right px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-purple-600 text-white">Class B</span></th>
                <th className="text-right px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-gray-500 text-white">Silent</span></th>
                <th className="text-right px-3 py-2 font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {CO_PARTNER_DATA.map((r, i) => {
                const total = r.gp + r.lp + r.classA + r.classB + r.silent;
                return (
                  <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium">{r.company}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.gp > 0 ? `$${r.gp}M` : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.lp > 0 ? `$${r.lp}M` : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.classA > 0 ? `$${r.classA}M` : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.classB > 0 ? `$${r.classB}M` : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.silent > 0 ? `$${r.silent}M` : '—'}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold">${total.toFixed(1)}M</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section D: Capital Call Status Strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label:'Capital Calls Overdue',  value:'6 Partners',  sub:'$75,500 total',        bg:'bg-red-50 border-red-200',   dot:'bg-red-600',   text:'text-red-700'   },
          { label:'Calls Received (MTD)',   value:'2 Partners',  sub:'$42,000 collected',    bg:'bg-green-50 border-green-200', dot:'bg-green-600', text:'text-green-700' },
          { label:'Pending (Next 30d)',     value:'3 Partners',  sub:'$28,750 expected',     bg:'bg-amber-50 border-amber-200', dot:'bg-amber-500', text:'text-amber-700' },
          { label:'Next Distribution',      value:'Q3 2026',     sub:'$38.76M projected',    bg:'bg-blue-50 border-blue-200',  dot:'bg-blue-600',  text:'text-blue-700'  },
        ].map((card, i) => (
          <div key={i} className={`rounded-lg p-4 border ${card.bg}`}>
            <div className={`w-2 h-2 rounded-full ${card.dot} mb-2`} />
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-xl font-bold font-mono ${card.text}`}>{card.value}</p>
            <p className={`text-xs mt-1 ${card.text} opacity-80`}>{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Section E: CFO Partner Insights */}
      <div className="space-y-2">
        {[
          { title:'Preferred Return Threshold Triggered', text:'Class A & LP investors hold 8% preferred return hurdle. Current portfolio IRR of 22.4% far exceeds the hurdle — waterfall distribution to residual split is triggered. Recommend issuing Q3 2026 distribution memo to all LPs immediately.' },
          { title:'Capital Call Compliance Risk', text:'6 partners are overdue on capital calls totalling $75,500. Per operating agreement, late fees of 1.5%/month apply after the 30-day grace period. Immediate outreach required to prevent GP/LP agreement disputes and preserve co-investor relationships.' },
          { title:'Equity Concentration Alert', text:'Apex RE Fund II and Cascade Capital Group together represent 33% of total equity committed ($27.5M). Concentration above 25% per single partner is a portfolio risk flag. Consider diversification strategy for Phase 2 capital raise to reduce exposure.' },
        ].map((ins, i) => (
          <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">{ins.title}</p>
            <p className="text-xs text-amber-700">{ins.text}</p>
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

const PD_COMPANIES = [
  'ABC LLC','Sunstone Development LLC','Meridian PropDev LLC','Cornerstone RE Ventures',
  'Pinnacle Land Holdings','Summit Development LLC','Heritage Land Partners',
  'Riverview PropDev LLC','Landmark Developers','Horizon Land Group','Crestview Development LLC',
];
const PD_LS_KEY = (co: string) => `propdev_upload_${co.replace(/\s+/g,'_').toLowerCase()}`;

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
  const rev = pdYV(p,/^total\s+for\s+income$/i,y)||pdYV(p,/^total\s+income$/i,y)||pdYV(p,/^total\s+revenue$/i,y)||pdSumI(p,/income|revenue|rent/i,y);
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

// ── Upload: KPI Dashboard ─────────────────────────────────────────────────────
function PDKpiCard({ label,value,sub,status }: { label:string;value:string;sub:string;status:'good'|'warn'|'bad'|'info' }) {
  const border={good:'border-green-500 bg-green-50',warn:'border-amber-500 bg-amber-50',bad:'border-red-500 bg-red-50',info:'border-blue-500 bg-blue-50'}[status];
  const pill={good:'bg-green-100 text-green-700',warn:'bg-amber-100 text-amber-700',bad:'bg-red-100 text-red-700',info:'bg-blue-100 text-blue-700'}[status];
  const tx={good:'✓ Healthy',warn:'⚠ Monitor',bad:'✗ Review',info:'ℹ Info'}[status];
  return (
    <div className={`border-l-4 ${border} rounded-lg p-4 shadow-sm`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold font-mono text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
      <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-2 font-medium ${pill}`}>{tx}</span>
    </div>
  );
}

function PDKPIView({ fin }: { fin: PDFinancials }) {
  const lastY=fin.years[fin.years.length-1];
  const prevY=fin.years.length>=2?fin.years[fin.years.length-2]:null;
  const k=pdKpis(fin,lastY);
  const kP=prevY?pdKpis(fin,prevY):null;
  const noiM=k.rev>0?k.noi/k.rev*100:0;
  const netM=k.rev>0?k.netInc/k.rev*100:0;
  const expR=k.rev>0?k.exp/k.rev*100:0;
  const revG=kP&&kP.rev>0?(k.rev-kP.rev)/kP.rev*100:null;
  const iCov=k.interest>0?k.noi/k.interest:0;
  const ltv=k.buildings>0?k.loans/k.buildings*100:0;
  const alR=k.totalLiab>0?k.totalAssets/k.totalLiab:0;
  const dte=k.equity>0?k.totalLiab/k.equity:0;
  const trendData=fin.years.map(y=>{const kk=pdKpis(fin,y);return{year:String(y),Revenue:kk.rev,Expenses:kk.exp,'Net Income':kk.netInc,NOI:kk.noi};});
  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">KPIs for <strong>{lastY}</strong> — {fin.companyName}</p>
      <div>
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Profitability</p>
        <div className="grid grid-cols-4 gap-4">
          <PDKpiCard label="NOI Margin"         value={`${noiM.toFixed(1)}%`}       sub={`NOI: ${pdFmt(k.noi)}`}          status={noiM>=40?'good':noiM>=20?'warn':'bad'} />
          <PDKpiCard label="Net Income Margin"  value={`${netM.toFixed(1)}%`}       sub={`Net: ${pdFmt(k.netInc)}`}       status={netM>=10?'good':netM>=0?'warn':'bad'} />
          <PDKpiCard label="Revenue Growth YoY" value={revG!==null?`${revG>=0?'+':''}${revG.toFixed(1)}%`:'N/A'} sub={prevY?`${lastY} vs ${prevY}`:'Only 1 year'} status={revG===null?'info':revG>=3?'good':revG>=0?'warn':'bad'} />
          <PDKpiCard label="Expense Ratio"      value={`${expR.toFixed(1)}%`}       sub={`Total exp: ${pdFmt(k.exp)}`}    status={expR<=70?'good':expR<=85?'warn':'bad'} />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Balance Sheet</p>
        <div className="grid grid-cols-4 gap-4">
          <PDKpiCard label="LTV (Loans/Building)" value={ltv>0?`${ltv.toFixed(1)}%`:'N/A'}      sub={`Loans: ${pdFmt(k.loans)}`}        status={ltv>0&&ltv<=75?'good':ltv<=85?'warn':'bad'} />
          <PDKpiCard label="Asset/Liability Ratio" value={alR>0?`${alR.toFixed(2)}x`:'N/A'}     sub={`Assets: ${pdFmt(k.totalAssets)}`}  status={alR>=1.5?'good':alR>=1?'warn':'bad'} />
          <PDKpiCard label="Debt-to-Equity"        value={dte>0?`${dte.toFixed(2)}x`:'N/A'}     sub={`Equity: ${pdFmt(k.equity)}`}       status={dte>0&&dte<=2?'good':dte<=4?'warn':'bad'} />
          <PDKpiCard label="Interest Coverage"     value={iCov>0?`${iCov.toFixed(2)}x`:'N/A'}   sub={`NOI ÷ Interest (${pdFmt(k.interest)})`} status={iCov>=2?'good':iCov>=1.2?'warn':'bad'} />
        </div>
      </div>
      {fin.years.length>=2 && (
        <div>
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">5-Year Financial Trend</p>
          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData} margin={{left:20,right:20}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{fontSize:11}} />
                <YAxis tickFormatter={v=>pdFmt(v as number)} tick={{fontSize:10}} />
                <Tooltip formatter={(v:number)=>pdFmtFull(v)} />
                <Legend />
                <Line type="monotone" dataKey="Revenue"    stroke={COLORS[0]} strokeWidth={2} dot />
                <Line type="monotone" dataKey="Expenses"   stroke={COLORS[5]} strokeWidth={2} dot />
                <Line type="monotone" dataKey="Net Income" stroke={COLORS[1]} strokeWidth={2} dot />
                <Line type="monotone" dataKey="NOI"        stroke={COLORS[2]} strokeWidth={2} strokeDasharray="5 5" dot />
              </LineChart>
            </ResponsiveContainer>
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
  const [activeTab, setActiveTab] = useState<TabType>('P&L Statement');
  const [selectedPDCo, setSelectedPDCo] = useState(PD_COMPANIES[0]);
  const [uploadedFin, setUploadedFin] = useState<PDFinancials | null>(null);
  const [uploading, setUploading] = useState(false);
  const plRef = useRef<HTMLInputElement>(null);
  const bsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    PROPDEV_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
  }, []);

  // Load stored data when company changes
  useEffect(() => {
    const raw = localStorage.getItem(PD_LS_KEY(selectedPDCo));
    if (raw) {
      try { setUploadedFin(JSON.parse(raw)); } catch { setUploadedFin(null); }
    } else {
      setUploadedFin(null);
    }
  }, [selectedPDCo]);

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
              {PD_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
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
