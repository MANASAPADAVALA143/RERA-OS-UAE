import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';

// ── Palette ──────────────────────────────────────────────────────────────────
const COLORS = ['#2E75B6','#70AD47','#ED7D31','#FFC000','#5A2D82','#C00000','#00B0F0','#FF0066','#00B050','#7030A0','#FF7C00','#003366'];
const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtM = (n: number) => `$${(n / 1_000_000).toFixed(2)}M`;
const fmtK = (n: number) => `$${(n / 1_000).toFixed(0)}K`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const short = (name: string) => name.split(' ').slice(0,2).join(' ');

// ── Company Data ─────────────────────────────────────────────────────────────
const COMPANIES_DATA = [
  { id:'sunstone',   name:'Sunstone Land Group LLC',        property:'Sunstone Ranch Phase 1',      lots:25, sold:8,  revenue:8088000,  netIncome:3258955, land:3002000, hard:697000,  soft:422000, interest:117200, commission:485280, title:50000,  mgmtFee:62730,  prof:24264, legal:16176, mktg:12132, ga:12132, insur:4044,  propTax:2831, otherIncome:121350 },
  { id:'meridian',   name:'Meridian Development Partners',  property:'Meridian Heights Subdivision', lots:28, sold:17, revenue:11611000, netIncome:4291929, land:4715000, hard:1098000, soft:513000, interest:121100, commission:696660, title:65300,  mgmtFee:98820,  prof:34833, legal:23222, mktg:17416, ga:17416, insur:5805,  propTax:4064, otherIncome:174165 },
  { id:'cornerstone',name:'Cornerstone RE Ventures',        property:'Cornerstone Estates',          lots:23, sold:14, revenue:9341000,  netIncome:2829785, land:3876000, hard:1274000, soft:487000, interest:102700, commission:560460, title:44700,  mgmtFee:114660, prof:28023, legal:18682, mktg:14011, ga:14011, insur:4670,  propTax:3269, otherIncome:140115 },
  { id:'pinnacle1',  name:'Pinnacle Land Holdings I',       property:'Pinnacle Meadows I',           lots:29, sold:11, revenue:8605000,  netIncome:2955048, land:3646000, hard:981000,  soft:269000, interest:119800, commission:516300, title:52800,  mgmtFee:88290,  prof:25815, legal:17210, mktg:12907, ga:12907, insur:4302,  propTax:3012, otherIncome:129075 },
  { id:'pinnacle2',  name:'Pinnacle Land Holdings II',      property:'Pinnacle Meadows II',          lots:32, sold:20, revenue:9246000,  netIncome:3266552, land:3498000, hard:1114000, soft:516000, interest:105400, commission:554760, title:58700,  mgmtFee:100260, prof:27738, legal:18492, mktg:13869, ga:13869, insur:4623,  propTax:3236, otherIncome:138690 },
  { id:'oakridge',   name:'Oakridge Development LLC',       property:'Oakridge Crossing',            lots:26, sold:12, revenue:10688000, netIncome:3793627, land:4160000, hard:1362000, soft:325000, interest:187300, commission:641280, title:65700,  mgmtFee:122580, prof:32064, legal:21376, mktg:16032, ga:16032, insur:5344,  propTax:3741, otherIncome:160320 },
  { id:'heritage',   name:'Heritage Land Partners',         property:'Heritage Hills',               lots:30, sold:10, revenue:10380000, netIncome:3550720, land:4502000, hard:1049000, soft:368000, interest:147900, commission:622800, title:47500,  mgmtFee:94410,  prof:31140, legal:20760, mktg:15570, ga:15570, insur:5190,  propTax:3633, otherIncome:155700 },
  { id:'summit',     name:'Summit RE Group',                property:'Summit Pointe',                lots:35, sold:28, revenue:12602000, netIncome:4322038, land:4848000, hard:1727000, soft:507000, interest:177200, commission:756120, title:89000,  mgmtFee:155430, prof:37806, legal:25204, mktg:18903, ga:18903, insur:6301,  propTax:4411, otherIncome:189030 },
  { id:'crestview',  name:'Crestview Development LLC',      property:'Crestview Farms',              lots:26, sold:18, revenue:8998000,  netIncome:3164378, land:3526000, hard:1107000, soft:399000, interest:123500, commission:539880, title:50800,  mgmtFee:99630,  prof:26994, legal:17996, mktg:13497, ga:13497, insur:4499,  propTax:3149, otherIncome:134970 },
  { id:'riverview',  name:'Riverview Land Partners',        property:'Riverview Crossing',           lots:37, sold:22, revenue:15241000, netIncome:4613212, land:6625000, hard:1947000, soft:582000, interest:250500, commission:914460, title:68400,  mgmtFee:175230, prof:45723, legal:30482, mktg:22861, ga:22861, insur:7620,  propTax:5334, otherIncome:228615 },
  { id:'landmark',   name:'Landmark RE Developers',         property:'Landmark Ridge',               lots:29, sold:16, revenue:8148000,  netIncome:2755431, land:3296000, hard:941000,  soft:424000, interest:106300, commission:488880, title:38300,  mgmtFee:84690,  prof:24444, legal:16296, mktg:12222, ga:12222, insur:4074,  propTax:2852, otherIncome:122220 },
  { id:'horizon',    name:'Horizon Land Group',             property:'Horizon Estates',              lots:26, sold:15, revenue:9546000,  netIncome:3951606, land:3678000, hard:825000,  soft:288000, interest:137800, commission:572760, title:50000,  mgmtFee:74250,  prof:28638, legal:19092, mktg:14319, ga:14319, insur:4773,  propTax:3341, otherIncome:143190 },
];

const TOTAL_REV = COMPANIES_DATA.reduce((s, c) => s + c.revenue, 0);

function calcRow(c: typeof COMPANIES_DATA[0]) {
  const totalRev = c.revenue + c.otherIncome;
  const totalCOGS = c.land + c.hard + c.soft + c.interest + c.commission + c.title;
  const grossProfit = totalRev - totalCOGS;
  const totalOpex = c.mgmtFee + c.prof + c.legal + c.mktg + c.ga + c.insur + c.propTax;
  const noi = grossProfit - totalOpex;
  return { totalRev, totalCOGS, grossProfit, totalOpex, noi, netIncome: c.netIncome };
}

const TABS = ['P&L Statement','Balance Sheet','KPI Dashboard','CFO Dashboard','Strategic Insights'] as const;
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
                ? companies.map(({c}) => <th key={c.id} className="text-right px-3 py-2.5">{short(c.name)}</th>)
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function PropDevFinancials() {
  const [activeTab, setActiveTab] = useState<TabType>('P&L Statement');
  const [selectedId, setSelectedId] = useState('all');

  const showCompanySelector = activeTab !== 'CFO Dashboard' && activeTab !== 'Strategic Insights';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Financials</h1>
          <p className="text-xs text-gray-500">Portfolio financial intelligence — 12 companies</p>
        </div>
        {showCompanySelector && (
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Companies (Portfolio)</option>
            {COMPANIES_DATA.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === t ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-white hover:text-gray-800'
            }`}
          >{t}</button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[400px]">
        {activeTab === 'P&L Statement'      && <PLTab selectedId={selectedId} />}
        {activeTab === 'Balance Sheet'      && <BSTab />}
        {activeTab === 'KPI Dashboard'      && <KPITab />}
        {activeTab === 'CFO Dashboard'      && <CFOTab />}
        {activeTab === 'Strategic Insights' && <StrategicTab />}
      </div>
    </div>
  );
}
