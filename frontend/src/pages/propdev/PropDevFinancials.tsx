import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import api, { formatApiError, postJsonWithWake, withTimeout } from '../../services/api';
import { parseFinancialExcel } from '../../utils/financialExcelParser';
import { yearsFromItemsWithNonZeroValues, yearsFromItems, yearVal, tidyPropDevStatementRows, sortPropDevPlExpenseRowsByAmount, isTaxesPaidBoardLineLabel, ensureTaxesPaidFoldedIntoPropertyTaxes } from '../../utils/finItemYearUtils';
import PeriodToggle from '../../components/shared/PeriodToggle';
import PropDevCfoBsCharts from '../../components/propdev/PropDevCfoBsCharts';
import PropDevCfoCfCharts from '../../components/propdev/PropDevCfoCfCharts';
import {
  buildPropDevBsSnapshots,
  buildPropDevCfSnapshots,
  buildPropDevCfoInsights,
  computeCashRunwayHero,
  getPropDevAvailableKeys,
  readPartnerInvestmentsTotal,
} from '../../utils/propDevCfoTrendData';
import { propDevCompanyOverviewKpis } from '../../utils/propDevCompanyOverview';
import { fetchPropDevPropertyTax } from '../../utils/propDevCostBasisCalculations';
import type { Period } from '../../utils/periodWindow';
import { periodChipText } from '../../utils/periodWindow';
import type { CompanyData, Loan } from '../../contexts/PropertyDevContext';
import {
  isActivePropDevLoan,
  normalizeInterestRatePercent,
  resolveCompanyMonthlyEmi,
  sumActivePropDevLoanBalances,
} from '../../utils/propDevLoanMetrics';
import { PROPDEV_MARKET_RATE } from '../../hooks/usePropDevLoanTrackerData';
import { parchmentStyles } from '../../theme/parchmentTheme';
import PropDevPageHeader from '../../components/propdev/PropDevPageHeader';
import { PT_FONT } from '../../utils/parchmentTypography';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import { getPropDevRevenueForYear } from '../../utils/propDevRevenueBreakdown';
import {
  buildPropDevYearSnapshots,
  pdKpisForScope,
  periodKeysForPropDevYear,
  propDevPeriodAnchor,
  pruneInactivePropDevYears,
} from '../../utils/propDevPeriodKpis';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import { scopePropDevFinToPeriod } from '../../utils/propDevPeriodScope';
import { labelMatches } from '../../utils/propDevStatementLabels';
import {
  formatPropDevValidationReport,
  validatePropDevPortfolioCurrentPeriod,
} from '../../utils/validatePropDevCurrentPeriod';
import { apiFinToPropDevUploaded, type PropDevUploadedFinancials } from '../../utils/propDevFinancialApi';
import { KPI_MIN_DENOMINATOR } from '../../utils/rentalExpenseUtils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  CartesianGrid, ComposedChart, Area, ReferenceLine,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Upload, FileSpreadsheet, Building2, DollarSign, BarChart2, Percent, Shield, Home, Landmark, Settings, Download } from 'lucide-react';
import { exportPropDevFinancialsPdf, exportPropDevPortfolioFinancialsPdf } from '../../utils/propDevSectionPdfExport';
import type { PropDevFinancialsPdfPortfolioCtx } from '../../utils/gatherPropDevSectionPdfData';
import {
  enrichPropDevFinWithCf,
  resolvePropDevCfItems,
} from '../../utils/propDevYearlyFinancials';
import {
  PROPDEV_FINANCIALS_PDF_SCOPE_OPTIONS,
  type PropDevFinancialsPdfScope,
} from '../../utils/gatherPropDevSectionPdfData';
import {
  PROPDEV_EXPORT_PDF_EVENT,
  type PropDevExportPdfDetail,
} from '../../utils/propDevExportEvents';
import PD05Partners from './PD05Partners';

// ── Palette ──────────────────────────────────────────────────────────────────
const COLORS = ['#2E75B6','#70AD47','#ED7D31','#FFC000','#5A2D82','#C00000','#00B0F0','#FF0066','#00B050','#7030A0','#FF7C00','#003366'];
const fmt = (n: number) => {
  if (!Number.isFinite(n)) return '—';
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
};
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

const TABS = ['P&L Statement','Balance Sheet','Cash Flow','KPI Dashboard','CFO Dashboard','Ownership','Strategic Insights'] as const;
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
  { label:'Revenue per Property Sold',    value:'$420,890', sub:'↑ above $400K target', status:'green' },
  { label:'Portfolio Sale Progress',          value:'55% sold', sub:'⚠ 3 projects unsold', status:'amber' },
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

// ── Strategic insights types (builder lives below PDFinancials) ───────────────
interface Insight {
  id: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  title: string;
  text: string;
  action: string;
  quad: string;
}

const fmtUsd = (n: number) => {
  if (!Number.isFinite(n)) return '—';
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
};

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
              { label:'Property Sales Revenue', key:'revenue' as const },
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
          { label:'Properties Sold',         value: `${totalSold}/${totalLots}` },
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
                <th className="text-right px-3 py-2">Status</th>
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
                    <td className="px-3 py-1.5 text-right">{c.sold > 0 ? 'Sold' : 'For Sale'}</td>
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
function StrategicTab({
  company,
  fin,
  allLoans,
}: {
  company: CompanyData | undefined;
  fin: PDFinancials | null;
  allLoans: Loan[];
}) {
  const insights = useMemo(
    () => buildCompanyStrategicInsights(company, fin, allLoans),
    [company, fin, allLoans],
  );
  const checklistItems = useMemo(
    () => insights.map(i => i.action).slice(0, 8),
    [insights],
  );
  const checklistKey = `propdev_cfo_checklist_${company?.id ?? 'none'}`;

  const [expanded, setExpanded] = useState<number[]>([]);
  const [checked, setChecked] = useState<boolean[]>(() => {
    try {
      const s = localStorage.getItem(checklistKey);
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      const s = localStorage.getItem(checklistKey);
      setChecked(s ? JSON.parse(s) : Array(checklistItems.length).fill(false));
    } catch {
      setChecked(Array(checklistItems.length).fill(false));
    }
    setExpanded([]);
  }, [checklistKey, checklistItems.length]);

  useEffect(() => {
    localStorage.setItem(checklistKey, JSON.stringify(checked));
  }, [checked, checklistKey]);

  const toggle = (id: number) => setExpanded(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleCheck = (i: number) => setChecked(p => {
    const n = [...p];
    while (n.length < checklistItems.length) n.push(false);
    n[i] = !n[i];
    return n;
  });

  const priBg: Record<string, string> = {
    CRITICAL: 'border-red-400 bg-red-50',
    HIGH: 'border-orange-400 bg-orange-50',
    MEDIUM: 'border-amber-400 bg-amber-50',
    LOW: 'border-gray-300 bg-gray-50',
  };

  const quadrants = [
    { key: 'UH', label: 'Urgent & High Impact', bg: 'bg-red-50 border-red-300' },
    { key: 'UL', label: 'Urgent & Low Impact', bg: 'bg-amber-50 border-amber-300' },
    { key: 'NH', label: 'Not Urgent & High', bg: 'bg-blue-50 border-blue-300' },
    { key: 'NL', label: 'Not Urgent & Low', bg: 'bg-gray-50 border-gray-200' },
  ];

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Insights for <strong className="text-gray-800">{company?.name ?? 'All Companies'}</strong>
        {fin ? ` · using uploaded ${fin.pl.length ? 'P&L' : ''}${fin.pl.length && fin.bs.length ? ' + ' : ''}${fin.bs.length ? 'BS' : ''}` : ' · registry / loans (no financials upload yet)'}
      </p>
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-gray-700">Strategic Insights ({insights.length})</p>
          {insights.map(ins => (
            <div key={ins.id} className={`rounded-lg border-l-4 p-3 ${priBg[ins.priority]} border`}>
              <div className="flex items-start gap-2">
                <PriorityBadge p={ins.priority} />
                <span className="text-xs text-gray-500">{ins.category}</span>
                <button type="button" onClick={() => toggle(ins.id)} className="ml-auto text-gray-400">
                  {expanded.includes(ins.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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

        <div className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Priority Action Matrix</p>
            <div className="grid grid-cols-2 gap-1">
              {quadrants.map(q => (
                <div key={q.key} className={`rounded-lg p-3 border ${q.bg}`}>
                  <p className="text-xs font-bold text-gray-700 mb-2">{q.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {insights.filter(i => i.quad === q.key).map(i => (
                      <span key={i.id} className="text-xs bg-white border border-gray-200 rounded px-2 py-0.5">#{i.id} {i.title.split(' ').slice(0, 2).join(' ')}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-3">CFO Sign-off Checklist</p>
            <div className="space-y-2">
              {checklistItems.map((item, i) => (
                <label key={`${checklistKey}-${i}`} className="flex items-start gap-2 cursor-pointer group">
                  <input type="checkbox" checked={!!checked[i]} onChange={() => toggleCheck(i)}
                    className="mt-0.5 w-4 h-4 accent-green-600 shrink-0" />
                  <span className={`text-xs ${checked[i] ? 'line-through text-gray-400' : 'text-gray-700 group-hover:text-gray-900'}`}>{item}</span>
                  {checked[i] && <CheckCircle size={12} className="text-green-500 shrink-0 mt-0.5" />}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">{checked.filter(Boolean).length}/{checklistItems.length} items complete — saved for this company</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Upload: Types & Parser ────────────────────────────────────────────────────
interface PDFinItem {
  label: string; values: Record<number,number>; indent: number;
  monthlyValues?: Record<string, number>;
  isTotal: boolean; isSectionHeader: boolean; isNetIncome: boolean;
}
interface PDFinancials {
  companyName: string; years: number[];
  plFile: string; bsFile: string; cfFile?: string; uploadedAt: string;
  pl: PDFinItem[]; bs: PDFinItem[];
  /** Cash Flow statement lines (from yearlyCF seed or uploaded CF). */
  cf?: PDFinItem[];
}

function buildCompanyStrategicInsights(
  company: CompanyData | undefined,
  fin: PDFinancials | null,
  allLoans: Loan[],
): Insight[] {
  if (!company) {
    return [{
      id: 1,
      priority: 'MEDIUM',
      category: 'Scope',
      title: 'Select a company',
      text: 'Strategic Insights are entity-specific. Choose a company from the dropdown to see runway, partners, loans, and P&L for that entity.',
      action: 'Select a company in the top selector, then upload P&L / Balance Sheet if not already loaded.',
      quad: 'NH',
    }];
  }

  const name = company.name;
  const coLoans = (company.loans?.length ? company.loans : allLoans.filter(l => l.companyId === company.id))
    .filter(isActivePropDevLoan);
  const monthlyEmi = resolveCompanyMonthlyEmi(company, allLoans);
  const outstanding = sumActivePropDevLoanBalances(coLoans);
  const partners = company.partners ?? [];
  // Partner capital = BS "Total for Partner investments", never Land / Cost Basis.
  const partnerCapitalFromBs = readPartnerInvestmentsTotal(fin ?? undefined);
  const partnerCapitalFromRegistry = partners.reduce((s, p) => {
    // Skip Cost-Basis−Debt estimates that re-use land as "capital contributed".
    if (p.capitalContributedEstimated) return s;
    return s + (p.capitalContributed || 0);
  }, 0);
  const capitalDeployed = partnerCapitalFromBs > 0
    ? partnerCapitalFromBs
    : partnerCapitalFromRegistry > 0
      ? partnerCapitalFromRegistry
      : partners.reduce((s, p) => s + (p.capitalContributed || 0), 0);
  const distributions = partners.reduce((s, p) => s + (p.distributionsReceived || 0), 0);
  // Cost Basis = Land + Improvements/WIP from BS (same as Companies / Cost Basis Trend).
  const overview = propDevCompanyOverviewKpis(company, fin ?? undefined, allLoans);
  const costBasis = overview.costBasis
    ?? ((company.property.landCost || 0) + (company.property.hardCost || 0) + (company.property.softCost || 0)
      + (company.property.improvements || 0));
  // A Balance Sheet upload is the source of truth once one exists — cash_available is a
  // manual fallback only for companies with no BS uploaded at all, never a silent override
  // of a real (possibly zero/unmatched) upload result.
  const cash = fin?.bs.length
    ? (overview.cash ?? 0)
    : (company.property.cashAvailable || 0);

  const cfSnaps = fin ? buildPropDevCfSnapshots(fin, company) : [];
  const runway = computeCashRunwayHero(cfSnaps, company);

  const insights: Insight[] = [];
  let nextId = 1;

  if (monthlyEmi > 0) {
    const runwayMo = cash > 0 ? cash / monthlyEmi : 0;
    const shortfall = Math.max(0, monthlyEmi - cash);
    if (runwayMo > 0 && runwayMo < 3) {
      insights.push({
        id: nextId++,
        priority: 'CRITICAL',
        category: 'Liquidity',
        title: `Cash Runway: ${runwayMo.toFixed(1)} Months`,
        text: `${name}: cash of ${fmtUsd(cash)} covers ~${runwayMo.toFixed(1)} months of EMI (${fmtUsd(monthlyEmi)}/mo).${shortfall > 0 ? ` Near-term EMI gap ~${fmtUsd(shortfall)}.` : ''}`,
        action: `Fund next EMI for ${name} or issue a capital call before the payment date.`,
        quad: 'UH',
      });
    } else if (runway.months != null && runway.months < 6 && runway.avgMonthlyBurn > 0) {
      insights.push({
        id: nextId++,
        priority: 'HIGH',
        category: 'Liquidity',
        title: `Operating Runway: ${runway.months.toFixed(1)} Months`,
        text: `${name}: at ~${fmtUsd(runway.avgMonthlyBurn)}/mo operating burn, cash covers ~${runway.months.toFixed(1)} months.`,
        action: 'Tighten discretionary spend or accelerate capital inflows.',
        quad: 'UH',
      });
    } else if (runway.cashFlowPositive) {
      insights.push({
        id: nextId++,
        priority: 'LOW',
        category: 'Liquidity',
        title: 'Cash Flow Positive',
        text: `${name}: operating cash flow is positive for the latest period — cash runway N/A. Cash balance ${fmtUsd(runway.cashBalance || cash)}.`,
        action: 'Maintain reserves for upcoming EMI and carrying costs.',
        quad: 'NL',
      });
    } else {
      insights.push({
        id: nextId++,
        priority: cash < monthlyEmi ? 'HIGH' : 'MEDIUM',
        category: 'Liquidity',
        title: `Monthly EMI ${fmtUsd(monthlyEmi)}`,
        text: `${name}: cash ${fmtUsd(cash)}; outstanding loans ${fmtUsd(outstanding)}; EMI ${fmtUsd(monthlyEmi)}/mo.`,
        action: cash < monthlyEmi
          ? 'Ensure EMI funding from operations or capital call.'
          : 'Monitor cash vs EMI calendar on Loan Tracker.',
        quad: cash < monthlyEmi ? 'UH' : 'NH',
      });
    }
  } else if (cash > 0) {
    insights.push({
      id: nextId++,
      priority: 'LOW',
      category: 'Liquidity',
      title: `Cash ${fmtUsd(cash)}`,
      text: `${name}: no active EMI on Loan Tracker. Cash balance ${fmtUsd(cash)}.`,
      action: 'Confirm loan statuses if debt should be tracked for this entity.',
      quad: 'NL',
    });
  }

  if (partners.length > 0 || capitalDeployed > 0) {
    const distPct = capitalDeployed > 0 ? (distributions / capitalDeployed) * 100 : 0;
    const partnerCountLabel = partners.length > 0 ? `${partners.length} partner(s)` : 'BS equity';
    if (capitalDeployed > 0 && distributions <= 0) {
      insights.push({
        id: nextId++,
        priority: 'HIGH',
        category: 'Partner Relations',
        title: 'Zero Distributions — Capital Deployed',
        text: `${name}: ${fmtUsd(capitalDeployed)} partner capital across ${partnerCountLabel}; distributions received are ${fmtUsd(distributions)}.`,
        action: 'Prepare distribution waterfall for first sale / cash event.',
        quad: 'UH',
      });
    } else if (capitalDeployed > 0 || partners.length > 0) {
      insights.push({
        id: nextId++,
        priority: 'MEDIUM',
        category: 'Partner Relations',
        title: `${partners.length || 1} Partners · ${distPct.toFixed(0)}% Returned`,
        text: `${name}: capital ${fmtUsd(capitalDeployed)}; distributions ${fmtUsd(distributions)}.`,
        action: 'Reconcile Cap Table vs ownership upload.',
        quad: 'NH',
      });
    }

    const sorted = [...partners].sort((a, b) => (b.sharePercent || 0) - (a.sharePercent || 0));
    const top2 = sorted.slice(0, 2);
    const top2Pct = top2.reduce((s, p) => s + (p.sharePercent || 0), 0);
    if (top2.length >= 2 && top2Pct > 0) {
      insights.push({
        id: nextId++,
        priority: top2Pct >= 40 ? 'MEDIUM' : 'LOW',
        category: 'Concentration',
        title: `Top 2 Partners Hold ${top2Pct.toFixed(1)}%`,
        text: `${name}: ${top2.map(p => `${p.name} (${(p.sharePercent || 0).toFixed(1)}%)`).join(' and ')}.`,
        action: top2Pct >= 40
          ? 'Note concentration for future capital raises.'
          : 'No immediate action — concentration moderate.',
        quad: top2Pct >= 40 ? 'NH' : 'NL',
      });
    }
  }

  if (costBasis > 0) {
    const breakEven = costBasis + capitalDeployed * 0.08;
    const landNote = overview.landValue != null && overview.landValue > 0
      ? ` Land ${fmtUsd(overview.landValue)} + improvements/WIP.`
      : ' Land + Improvements/WIP from Balance Sheet.';
    insights.push({
      id: nextId++,
      priority: 'HIGH',
      category: 'Valuation',
      title: `Cost Basis ${fmtUsd(costBasis)}`,
      text: `${name}: cost basis ${fmtUsd(costBasis)}.${landNote}${capitalDeployed > 0 ? ` Indicative break-even with 8% pref ≈ ${fmtUsd(breakEven)}.` : ''}`,
      action: 'Confirm appraisal / FMV vs cost basis on Ownership tab.',
      quad: 'UH',
    });
  }

  if (fin?.pl?.length && fin.years.length) {
    const niRow = fin.pl.find(i => i.isNetIncome || /^net\s+income$/i.test(i.label));
    const yearlyNi = fin.years.map(y => ({ y, ni: niRow?.values[y] ?? 0 }));
    const lossYears = yearlyNi.filter(x => x.ni < 0);
    const profitYears = yearlyNi.filter(x => x.ni > 0);
    if (lossYears.length > 0) {
      const profitNote = profitYears.length
        ? ` Net income in: ${profitYears.map(x => `${x.y} (${fmtUsd(x.ni)})`).join(', ')}.`
        : ' No profitable years in uploaded P&L.';
      insights.push({
        id: nextId++,
        priority: lossYears.length >= fin.years.length / 2 ? 'MEDIUM' : 'LOW',
        category: 'Profitability',
        title: `${lossYears.length} of ${fin.years.length} Years Net Loss`,
        text: `${name}:${profitNote} Hold-phase losses are often interest / carrying costs.`,
        action: 'Monitor interest expense and discretionary spend for the current year.',
        quad: 'NH',
      });
    } else if (profitYears.length) {
      const last = yearlyNi[yearlyNi.length - 1];
      insights.push({
        id: nextId++,
        priority: 'LOW',
        category: 'Profitability',
        title: `Latest NI ${fmtUsd(last.ni)} (${last.y})`,
        text: `${name}: uploaded P&L shows positive net income across tracked years.`,
        action: 'Compare to budget and partner waterfall obligations.',
        quad: 'NL',
      });
    }
  } else {
    insights.push({
      id: nextId++,
      priority: 'MEDIUM',
      category: 'Data',
      title: 'No P&L Uploaded',
      text: `${name}: upload P&L and Balance Sheet under Financials to unlock profitability insights.`,
      action: 'Upload QuickBooks-style P&L (and BS) for this company.',
      quad: 'NH',
    });
  }

  const overdueCalls = (company.capitalCalls ?? []).filter(c => c.status === 'Overdue');
  if (overdueCalls.length > 0) {
    const overdueTotal = overdueCalls.reduce((s, c) => s + Math.max(0, c.totalDue - c.received), 0);
    const partnerCount = new Set(overdueCalls.map(c => c.partnerName)).size;
    insights.push({
      id: nextId++,
      priority: 'CRITICAL',
      category: 'Capital Calls',
      title: `${overdueCalls.length} Capital Call(s) Overdue`,
      text: `${name}: ${fmtUsd(overdueTotal)} overdue across ${partnerCount} partner(s).`,
      action: 'Follow up with partners on overdue capital calls before relying on additional financing.',
      quad: 'UH',
    });
  }

  if (coLoans.length > 0) {
    const withBal = coLoans.filter(l => l.balance > 0);
    const wAvg = withBal.length
      ? withBal.reduce((s, l) => s + normalizeInterestRatePercent(l.interestRate) * l.balance, 0)
        / withBal.reduce((s, l) => s + l.balance, 0)
      : normalizeInterestRatePercent(coLoans[0].interestRate);
    const bank = coLoans[0]?.bank || 'lender';
    if (wAvg > 0 && wAvg < PROPDEV_MARKET_RATE - 0.5) {
      insights.push({
        id: nextId++,
        priority: 'LOW',
        category: 'Financing',
        title: 'Loan Rate Below Market',
        text: `${name}: weighted avg rate ${wAvg.toFixed(2)}% (${bank}) vs market ~${PROPDEV_MARKET_RATE}%. Outstanding ${fmtUsd(outstanding)}.`,
        action: 'Confirm rate lock / maturity; refinance only if spread improves.',
        quad: 'NL',
      });
    } else if (wAvg >= PROPDEV_MARKET_RATE) {
      insights.push({
        id: nextId++,
        priority: 'MEDIUM',
        category: 'Financing',
        title: 'Rate At or Above Market',
        text: `${name}: weighted avg rate ${wAvg.toFixed(2)}% vs market ~${PROPDEV_MARKET_RATE}%. Outstanding ${fmtUsd(outstanding)}.`,
        action: 'Review refinance options on Loan Tracker.',
        quad: 'NH',
      });
    }
  }

  return insights;
}

const PD_LS_KEY = (companyId: string) => `propdev_upload_${companyId}`;

/** Legacy rows stored one combined filename on pl/bs/cf — keep only the first segment. */
function shortFilename(name: string | undefined): string {
  if (!name) return '';
  const first = name.split(' + ')[0]?.split(' | ')[0]?.trim() ?? '';
  return first.length > 240 ? `${first.slice(0, 237)}…` : first;
}

function buildCombinedFilename(pl: string, bs: string, cf?: string): string {
  const parts = [pl, bs, cf].filter(Boolean).map(shortFilename).filter(Boolean);
  return [...new Set(parts)].join(' | ').slice(0, 1990);
}

function apiFinToPD(fin: {
  company_name: string; years: number[]; pl: PDFinItem[]; bs: PDFinItem[];
  cf?: PDFinItem[];
  filename?: string;
  pl_filename?: string | null;
  bs_filename?: string | null;
  cf_filename?: string | null;
  uploaded_at?: string;
}): PDFinancials {
  const legacy = shortFilename(fin.filename);
  return pruneInactivePropDevYears({
    companyName: fin.company_name,
    years: fin.years,
    plFile: shortFilename(fin.pl_filename ?? undefined) || (fin.pl?.length ? legacy : ''),
    bsFile: shortFilename(fin.bs_filename ?? undefined) || (fin.bs?.length ? legacy : ''),
    cfFile: shortFilename(fin.cf_filename ?? undefined) || (fin.cf?.length ? legacy : undefined),
    uploadedAt: fin.uploaded_at || new Date().toISOString(),
    pl: fin.pl,
    bs: fin.bs,
    cf: fin.cf,
  });
}

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

function wwbgBuildCF(
  yearlyCF: Record<string, { operating: number; investing: number; financing: number; net_change: number; partner_investments?: number }>,
  years: number[],
): PDFinItem[] {
  const yv = (key: 'operating' | 'investing' | 'financing' | 'net_change' | 'partner_investments') =>
    Object.fromEntries(years.map(y => [y, yearlyCF[String(y)]?.[key] ?? 0])) as Record<number, number>;

  return [
    makeItem('Operating Activities', {}, { isSectionHeader: true }),
    makeItem('Operating Cash Flow', yv('operating'), { indent: 2 }),
    makeItem('Investing Activities', {}, { isSectionHeader: true }),
    makeItem('Investing Cash Flow (land / development spend)', yv('investing'), { indent: 2 }),
    makeItem('Financing Activities', {}, { isSectionHeader: true }),
    makeItem('Financing Cash Flow (capital calls + loan draws)', yv('financing'), { indent: 2 }),
    makeItem('Partner Investments', yv('partner_investments'), { indent: 2 }),
    makeItem('Net Change in Cash', yv('net_change'), { isTotal: true, isNetIncome: true }),
  ];
}

function buildWWBGFinancials(
  companyName: string,
  yearlyPL: Record<string,unknown> | undefined,
  yearlyBS: Record<string,unknown> | undefined,
  yearlyCF?: Record<string,unknown> | undefined,
): PDFinancials | null {
  if (!yearlyPL && !yearlyBS && !yearlyCF) return null;
  const allYears = Array.from(new Set([
    ...Object.keys(yearlyPL ?? {}),
    ...Object.keys(yearlyBS ?? {}),
    ...Object.keys(yearlyCF ?? {}),
  ])).map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b);
  if (allYears.length === 0) return null;

  return pruneInactivePropDevYears({
    companyName,
    years: allYears,
    plFile: 'From database (WWBG seed)',
    bsFile: 'From database (WWBG seed)',
    uploadedAt: new Date().toISOString(),
    pl: yearlyPL ? wwbgBuildPL(yearlyPL as Parameters<typeof wwbgBuildPL>[0], allYears) : [],
    bs: yearlyBS ? wwbgBuildBS(yearlyBS as Parameters<typeof wwbgBuildBS>[0], allYears) : [],
    cf: yearlyCF ? wwbgBuildCF(yearlyCF as Parameters<typeof wwbgBuildCF>[0], allYears) : [],
  });
}

// ── Upload: KPI helpers ───────────────────────────────────────────────────────
function pdYV(items: PDFinItem[], pat: RegExp, y: number): number {
  return items.find(i => labelMatches(i.label, pat))?.values[y] ?? 0;
}
function pdSumI(items: PDFinItem[], pat: RegExp, y: number): number {
  return items.filter(i => !i.isSectionHeader && !i.isTotal && labelMatches(i.label, pat))
    .reduce((s, i) => s + (i.values[y] ?? 0), 0);
}
function pdKpis(fin: PDFinancials, y: number) {
  const p=fin.pl; const b=fin.bs;
  const revBd = getPropDevRevenueForYear(fin, y);
  // Total revenue = operating income + post-NOI Other Income (matches snapshot table).
  let rev = revBd.totalRev;
  const operatingRev = revBd.operatingTotal;
  if (rev === 0) {
    // Legacy fallback when P&L structure cannot be parsed.
    const rawRev = pdYV(p,/^total\s+for\s+income$/i,y)||pdYV(p,/^total\s+income$/i,y)||pdYV(p,/^total\s+revenue$/i,y)||pdSumI(p,/^(other\s+)?income$/i,y);
    rev = Math.abs(rawRev) + revBd.otherIncome;
  }
  const exp = Math.abs(
    pdYV(p, /^total\s+for\s+(operating\s+)?expenses?$/i, y)
    || pdYV(p, /^total\s+(operating\s+)?expenses?$/i, y)
    || pdYV(p, /^total\s+for\s+(cost\s+of\s+(goods|sales)|cogs)/i, y)
    || pdYV(p, /^total\s+(cost\s+of\s+(goods|sales)|cogs)/i, y)
    || pdYV(p, /^total\s+costs?$/i, y),
  );
  // Bottom-line Net Income only — never "Net Operating Income" (NOI is separate).
  // Also matches Particulars formats: "Net Profit/(Loss)", "Profit for the year".
  const netCandidates = p.filter(i =>
    i.isNetIncome
    || labelMatches(i.label, /^net\s+income$/i)
    || labelMatches(i.label, /^net\s+profit/i)
    || labelMatches(i.label, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i),
  );
  let netInc = (
    netCandidates.find(i => labelMatches(i.label, /^net\s+income$/i) && !/operating/i.test(i.label))
    ?? netCandidates.find(i => labelMatches(i.label, /^net\s+profit/i) && !/operating/i.test(i.label))
    ?? netCandidates[netCandidates.length - 1]
  )?.values[y] ?? 0;
  if (netInc === 0 && (rev !== 0 || exp !== 0)) netInc = rev - exp;
  let expFinal = exp;
  if (expFinal === 0 && Math.abs(rev) > 0.005 && Math.abs(netInc - rev) > 0.005) {
    expFinal = Math.abs(rev - netInc);
  }
  const interest = Math.abs(pdSumI(p,/interest/i,y));
  // Prefer Financials "Net Operating Income" row; fall back to derived
  const noiItem = p.find(i => labelMatches(i.label, /^net\s+operating\s+income$/i));
  const noiRow = noiItem && Object.prototype.hasOwnProperty.call(noiItem.values, y)
    ? (noiItem.values[y] ?? 0)
    : null;
  const noi = noiRow != null ? noiRow : (operatingRev - expFinal + interest);
  const fa = Math.abs(pdYV(b,/fixed\s+assets?/i,y)||pdYV(b,/property\s*,?\s*plant\s+and\s+equipment/i,y)||pdSumI(b,/fixed\s+assets?/i,y));
  const cash = Math.abs(
    pdYV(b,/^total\s+for\s+bank/i,y)
    || pdYV(b,/cash\s+and\s+bank/i,y)
    || pdYV(b,/bank\s+balances?/i,y)
    || pdSumI(b,/bank|checking/i,y)
    || pdYV(b,/^cash$/i,y),
  );
  const totalAssets = Math.abs(
    pdYV(b,/^total\s+for\s+assets$/i,y)
    || pdYV(b,/^total\s+assets$/i,y)
  ) || (fa + cash);
  return { rev, operatingRev, otherRev: revBd.otherIncome, exp: expFinal, netInc, noi, interest,
    totalAssets,
    totalLiab:   Math.abs(pdYV(b,/^total\s+for\s+liabilities$/i,y)||pdYV(b,/^total\s+(?:of\s+)?liabilit(?:y|ies)$/i,y)),
    // Fall back to "Partners Capital" / "Share capital" / "I. Partners Capital" when no Total Equity row.
    equity:      pdYV(b,/^total\s+for\s+equity$/i,y)||pdYV(b,/^total\s+equity$/i,y)||pdYV(b,/^partners?\s+capital$/i,y)||pdYV(b,/^share\s+capital$/i,y)||pdSumI(b,/partners?\s+capital|share\s+capital/i,y),
    // Prefer B/S Total for Liabilities (Prop Dev Total Debt source of truth).
    loans: (() => {
      const totalLiab = Math.abs(pdYV(b,/^total\s+for\s+liabilities$/i,y)||pdYV(b,/^total\s+(?:of\s+)?liabilit(?:y|ies)$/i,y));
      if (totalLiab > 0) return totalLiab;
      const qboLt = Math.abs(pdYV(b,/^total\s+for\s+long.term/i,y)||pdYV(b,/^long\s*[- ]?term\s+loans?$/i,y)||pdSumI(b,/long\s*[- ]?term\s+(business\s+)?loan/i,y));
      if (qboLt > 0) return qboLt;
      const lt = Math.abs(pdYV(b,/^long\s*[- ]?term\s+liabilit/i,y)||pdYV(b,/loan\s*>?\s*1\s*year/i,y));
      const partnerLoans = Math.abs(pdYV(b,/^loan\s+from\s+partners?/i,y));
      // Particulars: Partners Capital sits under Liabilities — include so loans ≈ Total Liability.
      const particularsShape = b.some(i =>
        labelMatches(i.label, /^loan\s+from\s+partners?/i)
        || labelMatches(i.label, /loan\s*>?\s*1\s*year/i)
        || labelMatches(i.label, /^partners?\s+capital$/i),
      );
      const partnersCapital = particularsShape ? pdYV(b,/^partners?\s+capital$/i,y) : 0;
      return Math.abs(lt + partnerLoans + partnersCapital);
    })(),
    buildings: Math.abs(pdYV(b,/^buildings$/i,y)||fa),
    // QBO Bank Accounts + Particulars "Cash and bank balances" / bare "Cash".
    cash,
  };
}

// ── Upload: Formatters ────────────────────────────────────────────────────────
const pdFmtFull = (n: number) => {
  if (!Number.isFinite(n) || n===0) return '—';
  const abs = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.abs(n));
  return n<0?`(${abs})`:abs;
};
const pdFmt = (n: number) => {
  if (!Number.isFinite(n) || n===0) return '—';
  const abs=Math.abs(n);
  const s=abs>=1e6?`$${(abs/1e6).toFixed(2)}M`:abs>=1e3?`$${(abs/1e3).toFixed(1)}K`:`$${abs.toLocaleString()}`;
  return n<0?`(${s})`:s;
};
/** Percentages use accounting brackets for negatives: (37.2%) not -37.2%. */
const pdPct = (n: number | null | undefined, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return 'N/A';
  const body = `${Math.abs(n).toFixed(digits)}%`;
  return n < 0 ? `(${body})` : body;
};

function resolveFinForCompany(c: CompanyData, fromApi?: PDFinancials): PDFinancials | null {
  if (fromApi && (fromApi.pl.length > 0 || fromApi.bs.length > 0 || (fromApi.cf?.length ?? 0) > 0)) {
    return enrichPropDevFinWithCf(fromApi, c);
  }
  try {
    const raw = localStorage.getItem(PD_LS_KEY(c.id));
    if (raw) {
      const parsed = JSON.parse(raw) as PDFinancials;
      if (parsed.pl?.length || parsed.bs?.length || (parsed.cf?.length ?? 0) > 0) {
        return enrichPropDevFinWithCf(parsed, c);
      }
    }
  } catch { /* ignore */ }
  return buildWWBGFinancials(
    c.name,
    c.property.yearlyPL as Record<string, unknown> | undefined,
    c.property.yearlyBS as Record<string, unknown> | undefined,
    c.property.yearlyCF as Record<string, unknown> | undefined,
  );
}

function PDAllCompaniesPortfolio({
  companies,
  allFinancials,
  loans,
  loading,
  onSelectCompany,
  period,
  pMonth,
  pYear,
  selectedYear,
}: {
  companies: CompanyData[];
  allFinancials: Record<string, PDFinancials>;
  loans: { companyId: string; balance: number; status: string }[];
  loading: boolean;
  onSelectCompany: (id: string) => void;
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
}) {
  const anchor = propDevPeriodAnchor(period, pMonth, pYear);
  const periodLabel = period
    ? periodChipText(period, pMonth, pYear)
    : `FY ${selectedYear}`;
  const uploadedCount = companies.filter(c => resolveFinForCompany(c, allFinancials[c.id])).length;

  if (loading && uploadedCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-8 h-8 border-[3px] border-amber-200 border-t-amber-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-600">Loading portfolio financials…</p>
        <p className="text-xs text-gray-400">First load may take ~30s while the server wakes up</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Entities', value: String(companies.length) },
          { label: 'With financials', value: String(uploadedCount) },
          {
            label: 'Total land cost',
            value: pdFmt(companies.reduce((s, c) => s + (c.property.landCost ?? 0), 0)),
          },
          {
            label: 'Active loan balance',
            value: pdFmt(loans.filter(l => l.status === 'Active').reduce((s, l) => s + l.balance, 0)),
          },
        ].map(card => (
          <div key={card.label} className="rounded-lg border p-3" style={{ background: '#FFFFFF', borderColor: '#E8E9ED' }}>
            <p className="text-xs text-gray-500">{card.label}</p>
            <p className="text-lg font-bold font-mono text-gray-900">{card.value}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500">
        {uploadedCount} of {companies.length} entities with P&amp;L or Balance Sheet data — click a row to drill in
      </p>

      <div className="space-y-2">
        {companies.map(c => {
          const fin = resolveFinForCompany(c, allFinancials[c.id]);
          const loanBal = loans
            .filter(l => l.companyId === c.id && l.status === 'Active')
            .reduce((s, l) => s + l.balance, 0);
          const focusYear = period ? pYear : (fin?.years[fin.years.length - 1] ?? selectedYear);
          const periodKeys = fin && focusYear != null
            ? periodKeysForPropDevYear(fin, focusYear, anchor)
            : undefined;
          const k = fin && focusYear != null ? pdKpisForScope(fin, focusYear, periodKeys) : null;
          const buildings = fin && focusYear != null
            ? Math.abs(
              (fin.bs.find(i => labelMatches(i.label, /fixed\s+assets?/i))?.values[focusYear] ?? 0)
              || (fin.bs.find(i => labelMatches(i.label, /property\s*,?\s*plant\s+and\s+equipment/i))?.values[focusYear] ?? 0),
            )
            : 0;
          const ltlv = k && buildings > 0
            ? (loanBal / buildings) * 100
            : (loanBal > 0 && (c.property.landCost ?? 0) > 0 ? (loanBal / c.property.landCost) * 100 : null);

          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelectCompany(c.id)}
              className="w-full flex flex-wrap items-center gap-4 p-4 rounded-lg border border-gray-200 bg-gray-50 hover:bg-amber-50 hover:border-amber-200 transition-colors text-left"
            >
              <div className="flex-1 min-w-[140px]">
                <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
                <p className="text-xs text-gray-400 truncate">{c.property.name || '—'}</p>
                {!fin && <p className="text-xs text-amber-700 mt-1">No financials uploaded</p>}
              </div>
              {k ? (
                <>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">Revenue ({periodLabel})</p>
                    <p className="font-mono font-bold text-gray-900 text-sm">{pdFmt(k.rev)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">Net Income</p>
                    <p className={`font-mono font-bold text-sm ${k.netInc >= 0 ? 'text-green-800' : 'text-red-700'}`}>{pdFmt(k.netInc)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">NOI</p>
                    <p className={`font-mono font-bold text-sm ${k.noi >= 0 ? 'text-blue-700' : 'text-red-700'}`}>{pdFmt(k.noi)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">LTLV</p>
                    <p className="font-mono font-bold text-gray-700 text-sm">{ltlv != null ? `${ltlv.toFixed(0)}%` : '—'}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">Land cost</p>
                    <p className="font-mono font-bold text-gray-900 text-sm">{pdFmt(c.property.landCost ?? 0)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">Loan balance</p>
                    <p className="font-mono font-bold text-gray-700 text-sm">{loanBal > 0 ? pdFmt(loanBal) : '—'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-gray-500">Partners</p>
                    <p className="font-mono font-bold text-gray-700 text-sm">{c.partners.length || '—'}</p>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Upload: P&L Table ─────────────────────────────────────────────────────────
function PDPLTable({ fin, onUploadPl }: { fin: PDFinancials; onUploadPl?: () => void }) {
  const { plRows, yrs } = useMemo(
    () => {
      const years = yearsFromItemsWithNonZeroValues(fin.pl);
      const ys = years.length ? years : (fin.years.length ? [...fin.years].sort((a, b) => a - b) : yearsFromItems(fin.pl));
      // tidyPropDevStatementRows already sorts + pins P&L rows internally — do not
      // re-run sortPropDevPlExpenseRowsByAmount here, it would re-invoke pinning a
      // second time and can synthesize duplicate $0 placeholder rows.
      const tidied = ensureTaxesPaidFoldedIntoPropertyTaxes(tidyPropDevStatementRows(fin.pl, ys, 'pl'));
      const displayYears = yearsFromItemsWithNonZeroValues(tidied);
      const colYears = (displayYears.length ? displayYears : ys).slice().sort((a, b) => a - b);
      return {
        plRows: tidied.filter(i => !isTaxesPaidBoardLineLabel(i.label)),
        yrs: colYears,
      };
    },
    [fin.pl, fin.years],
  );
  if (!fin.pl.length) return (
    <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
      <p className="text-gray-500 text-sm max-w-md">
        No P&amp;L data for this company yet
        {fin.bs.length || (fin.cf?.length ?? 0) ? ' (other statements are uploaded)' : ''}.
        Upload the QuickBooks Profit &amp; Loss Excel file for this entity.
      </p>
      {onUploadPl && (
        <button
          type="button"
          onClick={onUploadPl}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white"
          style={{ background: '#4F46E5' }}
        >
          <Upload size={14} />
          Upload P&amp;L
        </button>
      )}
    </div>
  );
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
          {plRows.map((item,i)=>(
            <tr key={i} className={`border-t border-gray-100 ${bg(item)}`}>
              <td className={`py-1.5 ${pad(item)}`}>{item.label}</td>
              {yrs.map(y=>{
                const v = yearVal(item.values, y);
                return (
                <td key={y} className={`py-1.5 px-3 text-right font-mono ${item.isNetIncome?'text-white':v<0?'text-red-600':''}`}>
                  {v===0?(item.isSectionHeader?'':'$0'):pdFmtFull(v)}
                </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Upload: Balance Sheet Table ───────────────────────────────────────────────
function PDBSTable({ fin, onUploadBs }: { fin: PDFinancials; onUploadBs?: () => void }) {
  const bsRows = useMemo(
    () => {
      const years = yearsFromItemsWithNonZeroValues(fin.bs);
      const ys = years.length ? years : (fin.years.length ? fin.years : yearsFromItems(fin.bs));
      return tidyPropDevStatementRows(fin.bs, ys, 'bs');
    },
    [fin.bs, fin.years],
  );
  const yrs = useMemo(() => {
    const nonzero = yearsFromItemsWithNonZeroValues(bsRows);
    if (nonzero.length) return nonzero;
    if (fin.years.length) return fin.years;
    return yearsFromItems(fin.bs);
  }, [bsRows, fin.years, fin.bs]);
  if (!fin.bs.length) return (
    <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
      <p className="text-gray-500 text-sm max-w-md">
        No Balance Sheet data yet{fin.pl.length ? ' (P&amp;L is uploaded)' : ''}.
        Upload the QuickBooks Balance Sheet Excel file for this entity.
      </p>
      {onUploadBs && (
        <button
          type="button"
          onClick={onUploadBs}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-green-600 hover:bg-green-700"
        >
          <Upload size={14} />
          Upload Balance Sheet
        </button>
      )}
    </div>
  );
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
          {bsRows.map((item,i)=>(
            <tr key={i} className={`border-t border-gray-100 ${bg(item)}`}>
              <td className={`py-1.5 ${pad(item)}`}>{item.label}</td>
              {yrs.map(y=>{
                const v = yearVal(item.values, y);
                return (
                <td key={y} className={`py-1.5 px-3 text-right font-mono ${v<0?'text-red-500':''}`}>
                  {v===0?(item.isSectionHeader?'':'$0'):pdFmtFull(v)}
                </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Upload: Cash Flow Table ───────────────────────────────────────────────────
function PDCFTable({
  fin,
  company,
  onUploadCf,
}: {
  fin: PDFinancials;
  company?: import('../../contexts/PropertyDevContext').CompanyData;
  onUploadCf?: () => void;
}) {
  const items = useMemo(
    () => {
      const raw = resolvePropDevCfItems(fin, company);
      const years = yearsFromItemsWithNonZeroValues(raw);
      return tidyPropDevStatementRows(raw, years.length ? years : fin.years, 'cf');
    },
    [fin, company],
  );

  const yrs = useMemo(() => {
    if (items.length === 0) return fin.years;
    const nonzero = yearsFromItemsWithNonZeroValues(items);
    return nonzero.length ? nonzero : fin.years;
  }, [items, fin.years]);

  const netByYear = useMemo(() => yrs.map(y => {
    const netItem = items.find(i => /net\s+change/i.test(i.label));
    return { year: String(y), value: netItem?.values[y] ?? 0 };
  }), [items, yrs]);

  if (!items.length) {
    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-gray-500 text-sm">No Cash Flow data for this entity.</p>
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          Upload a QuickBooks <strong>Statement of Cash Flows</strong> Excel export for this company.
          P&amp;L / Balance Sheet years ({fin.years.join(', ') || 'none'}) do not populate this tab.
        </p>
        {onUploadCf && (
          <button
            type="button"
            onClick={onUploadCf}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg"
          >
            <Upload size={14} /> Upload Cash Flow
          </button>
        )}
        <p className="text-xs text-gray-400 max-w-md mx-auto">
          Development entities typically show negative Operating CF during the holding phase — that is expected.
        </p>
      </div>
    );
  }

  const bg = (i: PDFinItem) =>
    i.isNetIncome ? 'bg-gray-900 text-white font-bold'
      : i.isTotal ? 'bg-blue-50 font-semibold text-blue-900 border-t border-blue-200'
      : i.isSectionHeader ? 'bg-amber-50 text-amber-800 font-semibold text-xs uppercase tracking-wide'
      : 'hover:bg-gray-50 text-gray-700';
  const pad = (i: PDFinItem) =>
    i.isTotal || i.isSectionHeader ? 'px-4' : i.indent > 1 ? 'pl-8 pr-4' : 'pl-5 pr-4';

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500 -mt-1">
        Negative Operating CF is <strong>expected</strong> during the holding phase (holding-cost burn), not a rental NOI shortfall.
        For Cash Runway and Capital Call Coverage KPIs, open <strong>CFO Dashboard → Cash Flow</strong>.
      </p>
      {netByYear.some(d => d.value !== 0) && (
        <div className="rounded-lg p-4 shadow-sm border border-gray-200 bg-white">
          <p className="text-sm font-semibold text-gray-700 mb-3">Net Change in Cash by Year</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={netByYear} margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => pdFmt(v as number)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => pdFmtFull(v)} />
              <Bar dataKey="value" name="Net Change in Cash">
                {netByYear.map((d, i) => <Cell key={i} fill={d.value >= 0 ? '#22c55e' : '#78716C'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-900 text-white">
              <th className="text-left px-4 py-2.5 w-72">Line Item</th>
              {yrs.map(y => <th key={y} className="text-right px-3 py-2.5 min-w-[110px]">{y}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className={`border-t border-gray-100 ${bg(item)}`}>
                <td className={`py-1.5 ${pad(item)}`}>{item.label}</td>
                {yrs.map(y => (
                  <td
                    key={y}
                    className={`py-1.5 px-3 text-right font-mono ${item.isNetIncome ? 'text-white' : item.values[y] < 0 ? 'text-gray-600' : ''}`}
                  >
                    {item.values[y] === 0 ? (item.isSectionHeader ? '' : '$0') : pdFmtFull(item.values[y])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    { icon:<Percent size={15}/>, label:'NOI Margin', value:pdPct(noiM),
      yoy:'Benchmark ≥ 35%', yoyPos:noiM>=35,
      status:noiM>=35?'On Target':'Near Target', statusColor:noiM>=35?'good':'warning',
      accent:noiM>=35?'bg-green-500':'bg-amber-400', iBg:'bg-amber-50', iCol:'text-amber-700',
      sp:spark(kk=>kk.rev>0?kk.noi/kk.rev*100:0), spCol:'#fab219' },
    { icon:<Home size={15}/>, label:'LTV (Loan-to-Value)', value:ltv>0?pdPct(ltv):'N/A',
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
                <Bar dataKey="revenue"   name="Revenue"    fill="#5B5FEF" opacity={0.85} radius={[3,3,0,0]}/>
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
              <Radar dataKey="actual"    name="Actual"     stroke="#2a78d6" fill="#5B5FEF" fillOpacity={0.1} strokeWidth={1.5}/>
              <Radar dataKey="benchmark" name="Benchmark"  stroke="#fab219" fill="#fab219" fillOpacity={0.05} strokeWidth={1} strokeDasharray="3 2"/>
            </RadarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-1.5 mt-2">
            {[
              {label:'NOI',    val:pdPct(noiM),    ok:noiM>=35},
              {label:'EBITDA', val:pdPct(ebitdaM), ok:ebitdaM>=45},
              {label:'Net',    val:pdPct(netM),    ok:netM>=0},
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
              <Bar dataKey="hoa"      name="HOA"        stackId="a" fill="#5B5FEF"/>
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
                  {m:'NOI Margin',        v:pdPct(noiM),                                t:'>35%',    s:noiM>=35?'g':noiM>=25?'a':'r'},
                  {m:'Net Margin',        v:pdPct(netM),                                t:'>0%',     s:netM>=0?'g':'r'},
                  {m:'EBITDA Margin',     v:pdPct(ebitdaM),                             t:'>45%',    s:ebitdaM>=45?'g':'a'},
                  {m:'Asset/Liab Ratio',  v:alR>0?`${alR.toFixed(2)}x`:'N/A',          t:'>1.5x',   s:alR>=1.5?'g':alR>=1?'a':'r'},
                  {m:'LTV',               v:ltv>0?pdPct(ltv):'N/A',                     t:'<80%',    s:ltv>0&&ltv<=80?'g':ltv<=90?'a':'r'},
                  {m:'Interest Coverage', v:iCov>0?`${iCov.toFixed(2)}x`:'N/A',         t:'>1.5x',   s:iCov>=1.5?'g':iCov>=1?'a':'r'},
                  {m:'ROA',               v:k.totalAssets>0?pdPct(roa):'N/A',           t:'>4%',     s:roa>=4?'g':roa>=0?'a':'r'},
                  {m:'ROE',               v:k.equity>0?pdPct(roe):'N/A',                t:'>8%',     s:roe>=8?'g':roe>=0?'a':'r'},
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
type CfoStatementView = 'pl' | 'bs' | 'cf';

function CfoStatementToggle({
  value,
  onChange,
}: {
  value: CfoStatementView;
  onChange: (view: CfoStatementView) => void;
}) {
  return (
    <div style={{ display: 'inline-flex', background: '#F7F8FA', border: '1px solid #E8E9ED', borderRadius: 6, padding: 2 }}>
      {([
        { id: 'pl' as const, label: 'P&L' },
        { id: 'bs' as const, label: 'Balance Sheet' },
        { id: 'cf' as const, label: 'Cash Flow' },
      ]).map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          style={{
            fontSize: 12,
            fontWeight: value === id ? 700 : 500,
            color: value === id ? '#1C1917' : '#78716C',
            background: value === id ? '#5B5FEF' : 'transparent',
            borderRadius: 5,
            padding: '3px 10px',
            border: 'none',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PDExportPdfButton({
  fin, company, allLoans, period, pMonth, pYear, selectedYear, companies,
}: {
  fin: PDFinancials;
  company: CompanyData | undefined;
  allLoans: Loan[];
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
  /** Full company registry — used to build the Executive Summary Portfolio Overview + Entity Dashboard lead pages. */
  companies: CompanyData[];
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const handleExport = useCallback(async (scope: PropDevFinancialsPdfScope) => {
    setMenuOpen(false);
    setExporting(true);
    setError('');
    try {
      let portfolioCtx: PropDevFinancialsPdfPortfolioCtx | undefined;
      if (scope === 'cfo-dashboard' || scope === 'combined') {
        const finById = await fetchPropDevFinancialsPool(
          companies.map(c => c.id),
          (_id, d) => ({
            years: d.years ?? [],
            pl: (d.pl ?? []) as PDFinancialsLike['pl'],
            bs: (d.bs ?? []) as PDFinancialsLike['bs'],
            cf: (d.cf ?? []) as PDFinancialsLike['cf'],
          }),
        );
        // Anchor the portfolio KPIs to the same period picked for this export (period ? pYear
        // : selectedYear mirrors focusYear's own logic elsewhere on this page) -- otherwise the
        // Executive-Summary-style figures in the PDF silently used each entity's latest year,
        // diverging from the rest of the export which does honor the selected period.
        const exportAnchorYear = period ? pYear : selectedYear;
        // Also rewrite values[year] from monthlyValues for the selected Month/YTD window
        // (same scopePropDevFinToPeriod used by this page's own CFO Dashboard view) --
        // without this, entities with real monthly B/S columns still show the full-year
        // figure regardless of which month is picked, since propDevCompanyOverviewKpis
        // reads values[year] directly and never looks at monthlyValues on its own.
        const exportPeriodAnchor = propDevPeriodAnchor(period, pMonth, pYear);
        const kpisById: Record<string, ReturnType<typeof propDevCompanyOverviewKpis>> = {};
        for (const c of companies) {
          const cFin = finById[c.id] ?? null;
          const scopedCFin = cFin ? scopePropDevFinToPeriod(cFin, exportPeriodAnchor) : cFin;
          kpisById[c.id] = propDevCompanyOverviewKpis(c, scopedCFin, allLoans, exportAnchorYear);
        }
        const activePartnerCount = company ? company.partners.filter(p => p.status !== 'Exited').length : 0;
        const taxRows = await fetchPropDevPropertyTax().catch(() => []);
        portfolioCtx = { company, activePartnerCount, companies, kpisById, allLoans, taxRows };
      }
      await exportPropDevFinancialsPdf({
        fin, company, allLoans, period, pMonth, pYear, selectedYear, scope, portfolioCtx,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      setError(msg);
      window.alert(`PDF export failed: ${msg}`);
    } finally {
      setExporting(false);
    }
  }, [fin, company, allLoans, period, pMonth, pYear, selectedYear, companies]);

  // Top Command Strip "Export PDF" → same scopes as this button
  useEffect(() => {
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<PropDevExportPdfDetail>).detail ?? {};
      if (detail.scope === 'portfolio') return;
      if (detail.openMenu && !detail.scope) {
        setMenuOpen(true);
        return;
      }
      const scope = (detail.scope as PropDevFinancialsPdfScope | undefined) ?? 'cfo-dashboard';
      void handleExport(scope);
    };
    window.addEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
    return () => window.removeEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
  }, [handleExport]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => { if (!exporting) setMenuOpen(o => !o); }}
          disabled={exporting}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border font-medium"
          style={{
            background: '#FFFFFF', borderColor: '#E8E9ED', color: '#1C1917',
            cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.7 : 1,
          }}
        >
          <Download size={13} />
          {exporting ? 'Generating…' : 'Export PDF'}
          {!exporting && <ChevronDown size={13} />}
        </button>
        {menuOpen && !exporting && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              minWidth: 260,
              background: '#FFFFFF',
              border: '1px solid #E8E9ED',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(58,47,31,0.14)',
              zIndex: 50,
              padding: 6,
            }}
          >
            {PROPDEV_FINANCIALS_PDF_SCOPE_OPTIONS.map(opt => (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                onClick={() => void handleExport(opt.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 12px',
                  border: 'none',
                  borderRadius: 7,
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: opt.id === 'combined' ? 700 : 500,
                  color: '#1C1917',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#EEF0FF'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {!exporting && !error && (
        <span style={{ fontSize: 10, color: '#A8A29E' }}>
          Choose section · Combined exports full board pack
        </span>
      )}
      {error && <span style={{ fontSize: 10, color: '#B91C1C' }}>{error}</span>}
    </div>
  );
}

/** Portfolio (All Companies) — subtotals-only PDF export. */
function PDPortfolioExportPdfButton({
  companies,
  allFinancials,
  allLoans,
  period,
  pMonth,
  pYear,
  selectedYear,
  ensureCompanyYearly,
  onFinancialsLoaded,
  hidden,
}: {
  companies: CompanyData[];
  allFinancials: Record<string, PDFinancials>;
  allLoans: Loan[];
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
  ensureCompanyYearly: (companyId: string) => Promise<'cached' | 'loaded' | 'empty' | 'error'>;
  onFinancialsLoaded: (id: string, fin: PDFinancials) => void;
  hidden?: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError('');
    try {
      const financialsById: Record<string, PDFinancials> = {};
      for (const c of companies) {
        const fin = resolveFinForCompany(c, allFinancials[c.id]);
        if (fin) financialsById[c.id] = fin;
      }

      const missing = companies.filter(c => !financialsById[c.id]);
      if (missing.length) {
        await Promise.all(missing.map(c => ensureCompanyYearly(c.id)));
        const fetched = await fetchPropDevFinancialsPool(
          missing.map(c => c.id),
          (_id, d) => apiFinToPD({
            company_name: d.company_name,
            years: d.years ?? [],
            pl: d.pl as PDFinItem[],
            bs: d.bs as PDFinItem[],
            cf: (d.cf ?? []) as PDFinItem[],
            filename: d.filename,
            uploaded_at: d.uploaded_at,
          }),
        );
        for (const c of missing) {
          const company = companies.find(x => x.id === c.id);
          const fin = fetched[c.id]
            ? enrichPropDevFinWithCf(fetched[c.id], company)
            : resolveFinForCompany(c, undefined);
          if (fin) {
            financialsById[c.id] = fin;
            onFinancialsLoaded(c.id, fin);
          }
        }
      }

      if (!Object.keys(financialsById).length) {
        const msg = 'No financial data loaded yet. Wait for portfolio financials to finish loading, then try again.';
        setError(msg);
        window.alert(msg);
        return;
      }

      const taxRows = await fetchPropDevPropertyTax().catch(() => []);

      await exportPropDevPortfolioFinancialsPdf({
        companies,
        financialsById,
        allLoans,
        period,
        pMonth,
        pYear,
        selectedYear,
        taxRows,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Export failed';
      setError(msg);
      window.alert(`Portfolio PDF export failed: ${msg}`);
    } finally {
      setExporting(false);
    }
  }, [companies, allFinancials, allLoans, period, pMonth, pYear, selectedYear, ensureCompanyYearly, onFinancialsLoaded]);

  useEffect(() => {
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<PropDevExportPdfDetail>).detail ?? {};
      if (detail.scope && detail.scope !== 'portfolio') return;
      if (!detail.scope && detail.openMenu) return;
      void handleExport();
    };
    window.addEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
    return () => window.removeEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
  }, [handleExport]);

  if (hidden) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={exporting || !companies.length}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border font-medium"
        style={{
          background: '#1C3A5A', borderColor: '#1C3A5A', color: '#fff',
          cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.7 : 1,
        }}
        title="Export portfolio financials PDF (Portfolio Overview, Capital Structure, Property Tax, and per-entity subtotals)"
      >
        <Download size={13} />
        {exporting ? 'Generating…' : 'Export Portfolio PDF'}
      </button>
      {!exporting && !error && (
        <span style={{ fontSize: 10, color: '#A8A29E' }}>All companies · per-entity P&amp;L/BS/CF is subtotals only</span>
      )}
      {error && <span style={{ fontSize: 10, color: '#B91C1C' }}>{error}</span>}
    </div>
  );
}

/** Construction-style single-shot Export PDF on the CFO Dashboard toolbar. */
function PDCfoExportPdfButton({
  fin, company, allLoans, period, pMonth, pYear, selectedYear, companies,
}: {
  fin: PDFinancials;
  company: CompanyData | undefined;
  allLoans: Loan[];
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
  /** Full company registry — used to build the Executive Summary Portfolio Overview lead page. */
  companies: CompanyData[];
}) {
  const [exporting, setExporting] = useState(false);

  const handleExportPdf = useCallback(async () => {
    const cfRows = resolvePropDevCfItems(fin, company);
    if (!cfRows.length) {
      const cont = window.confirm(
        'Cash Flow is empty — the PDF will include P&L and Balance Sheet only. Use Upload Cash Flow if you need CF in the export. Continue anyway?',
      );
      if (!cont) return;
    }
    setExporting(true);
    try {
      // Fetch every entity's financials so the lead "Portfolio Overview" page matches
      // Executive Summary's Land/Market Value/Debt/LTLV figures exactly.
      const finById = await fetchPropDevFinancialsPool(
        companies.map(c => c.id),
        (_id, d) => ({
          years: d.years ?? [],
          pl: (d.pl ?? []) as PDFinancialsLike['pl'],
          bs: (d.bs ?? []) as PDFinancialsLike['bs'],
          cf: (d.cf ?? []) as PDFinancialsLike['cf'],
        }),
      );
      // Anchor to the same period picked for this export -- otherwise the lead Portfolio
      // Overview page silently used each entity's latest year, diverging from the exported
      // statements themselves, which do honor the selected period.
      const exportAnchorYear = period ? pYear : selectedYear;
      // Rewrite values[year] from monthlyValues for the selected Month/YTD window (same
      // scopePropDevFinToPeriod used by this page's own CFO Dashboard view) -- otherwise
      // entities with real monthly B/S columns still show the full-year figure regardless
      // of which month is picked.
      const exportPeriodAnchor = propDevPeriodAnchor(period, pMonth, pYear);
      const kpisById: Record<string, ReturnType<typeof propDevCompanyOverviewKpis>> = {};
      for (const c of companies) {
        const cFin = finById[c.id] ?? null;
        const scopedCFin = cFin ? scopePropDevFinToPeriod(cFin, exportPeriodAnchor) : cFin;
        kpisById[c.id] = propDevCompanyOverviewKpis(c, scopedCFin, allLoans, exportAnchorYear);
      }
      const activePartnerCount = company ? company.partners.filter(p => p.status !== 'Exited').length : 0;
      const taxRows = await fetchPropDevPropertyTax().catch(() => []);

      await exportPropDevFinancialsPdf({
        fin: cfRows.length && !(fin.cf?.length) ? { ...fin, cf: cfRows } : fin,
        company, allLoans, period, pMonth, pYear, selectedYear, scope: 'cfo-dashboard',
        portfolioCtx: { company, activePartnerCount, companies, kpisById, allLoans, taxRows },
      });
    } catch (e: unknown) {
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }, [fin, company, allLoans, period, pMonth, pYear, selectedYear, companies]);

  return (
    <button
      type="button"
      onClick={() => void handleExportPdf()}
      disabled={exporting}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white disabled:opacity-60"
      style={{ background: '#1C3A5A', cursor: exporting ? 'wait' : 'pointer' }}
      title="Export CFO Dashboard PDF"
    >
      <Download size={13} />
      {exporting ? 'Exporting…' : 'Export PDF'}
    </button>
  );
}

function PDCfoToolbar({
  fin,
  cfoStatement,
  onCfoStatementChange,
  period,
  pMonth,
  pYear,
  selectedYear,
  onPeriodChange,
  onSelectedYearChange,
}: {
  fin: PDFinancials;
  cfoStatement: CfoStatementView;
  onCfoStatementChange: (view: CfoStatementView) => void;
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
  onPeriodChange: (period: Period | null, month: number, year: number) => void;
  onSelectedYearChange: (year: number) => void;
}) {
  const availableKeys = useMemo(() => getPropDevAvailableKeys(fin), [fin]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexWrap: 'wrap',
      gap: 8,
      background: '#FFFFFF',
      border: '0.5px solid #E8E9ED',
      borderRadius: 8,
      padding: '5px 8px',
      marginLeft: 'auto',
      flexShrink: 0,
    }}>
      {availableKeys.length > 0 ? (
        <PeriodToggle
          period={period}
          month={pMonth}
          year={pYear}
          onChange={onPeriodChange}
          availableKeys={availableKeys}
          compact
        />
      ) : (
        <select
          value={selectedYear}
          onChange={e => {
            const y = Number(e.target.value);
            onSelectedYearChange(y);
            onPeriodChange(period, pMonth, y);
          }}
          style={{ fontSize: 12, border: '1px solid #E8E9ED', borderRadius: 6, padding: '3px 8px', background: '#FFFFFF', color: '#1C1917' }}
        >
          {fin.years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
      <div style={{ width: 1, height: 24, background: '#E8E9ED', flexShrink: 0 }} aria-hidden />
      <CfoStatementToggle value={cfoStatement} onChange={onCfoStatementChange} />
    </div>
  );
}

function PDCFOPlView({
  fin,
  period,
  pMonth,
  pYear,
  selectedYear,
}: {
  fin: PDFinancials;
  period: Period | null;
  pMonth: number;
  pYear: number;
  selectedYear: number;
}) {
  const periodAnchor = useMemo(
    () => propDevPeriodAnchor(period, pMonth, pYear),
    [period, pMonth, pYear],
  );

  const snapshotRows = useMemo(() => {
    const scoped = scopePropDevFinToPeriod(fin, periodAnchor);
    return buildPropDevYearSnapshots(scoped, periodAnchor, { annualLedger: true });
  }, [fin, periodAnchor]);

  const rows = useMemo(() => snapshotRows.map(r => ({
    year: r.yearLabel,
    yearNum: r.year,
    rev: r.rev,
    operatingRev: r.operatingRev,
    otherRev: r.otherRev,
    exp: r.exp,
    net: r.netInc,
    noi: r.noi,
    cash: r.cash,
    margin: r.margin,
    expenseRatio: r.expenseRatio,
    revenueContributingLines: r.revenueContributingLines,
  })), [snapshotRows]);

  const pieRow = snapshotRows.find(r => r.year === (periodAnchor?.year ?? selectedYear))
    ?? snapshotRows.find(r => r.year === selectedYear)
    ?? snapshotRows[snapshotRows.length - 1];

  const revChartSeries = useMemo(() => {
    const categorySet = new Set<string>();
    for (const r of snapshotRows) {
      Object.keys(r.revenueCategories).forEach(name => categorySet.add(name));
    }
    let categoryNames = [...categorySet];
    if (categoryNames.length === 0) categoryNames = ['Revenue'];
    const useStacked = categoryNames.length > 1
      || (categoryNames.length === 1 && categoryNames[0] !== 'Revenue');
    const chartRows = snapshotRows.map(r => {
      const row: Record<string, number | string> = {
        year: r.yearLabel,
        yearNum: r.year,
        rev: r.rev,
      };
      for (const cat of categoryNames) {
        row[cat] = r.revenueCategories[cat] ?? 0;
      }
      // Stacked bars use category keys — ensure segment sum matches snapshot Revenue column.
      const segSum = categoryNames.reduce((s, c) => s + (Number(row[c]) || 0), 0);
      if (r.rev > 0 && Math.abs(segSum - r.rev) > 0.01) {
        row.Revenue = r.rev - categoryNames
          .filter(c => c !== 'Revenue')
          .reduce((s, c) => s + (Number(row[c]) || 0), 0);
      }
      return row;
    });
    return { categoryNames, rows: chartRows, useStacked };
  }, [snapshotRows]);

  const anyLowRevYear = rows.some(r => r.expenseRatio == null);
  const expPie = pieRow
    ? [{ name: 'Interest', value: pieRow.interest }, { name: 'Other', value: Math.max(0, pieRow.exp - pieRow.interest) }].filter(e => e.value > 0)
    : [];

  const chartCard = 'bg-white rounded-lg p-4 shadow-sm border border-gray-100';
  const chartTitle = 'text-sm font-semibold text-gray-700 mb-1';
  const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <>
      {periodAnchor && (
        <p className="text-xs text-gray-500 mb-1">
          {periodAnchor.period === 'Month'
            ? `${pYear} reflects ${MNAMES[pMonth - 1]} ${pYear} only; prior years show full fiscal year totals. Cash balance is as of that month.`
            : `${pYear} reflects YTD through ${MNAMES[pMonth - 1]} only; prior years show full fiscal year totals. Cash balance is as of that month.`}
        </p>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-900 text-white px-4 py-2 text-sm font-bold">Multi-Year Financial Snapshot — {fin.companyName}</div>
        <p className="px-4 py-1.5 text-[11px] text-gray-500 bg-gray-50 border-b border-gray-100">
          Revenue = operating Income lines <strong>above</strong> NOI + post-NOI <strong>Other Income</strong>.
          It is <em>not</em> the same as &quot;Total for Income&quot; / &quot;Gross Profit&quot; (those stay $0 when only Other Income is populated).
        </p>
        <table className="w-full text-xs">
          <thead><tr className="bg-gray-50 border-b border-gray-200">
            {['Year', 'Revenue', 'Op. Income', 'Other Income', 'Expenses', 'Net Income', 'NOI', 'Margin %'].map(h => (
              <th key={h} className={`px-3 py-2 font-semibold text-gray-600 ${h === 'Year' ? 'text-left' : 'text-right'}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const tip = r.revenueContributingLines.length
                ? r.revenueContributingLines.map(l => `${l.label}: ${pdFmtFull(l.amount)} (${l.bucket})`).join('\n')
                : 'No contributing P&L lines';
              return (
              <tr
                key={i}
                className={`border-t border-gray-100 hover:bg-gray-50 ${r.yearNum === selectedYear ? 'bg-amber-50' : ''}`}
                title={tip}
              >
                <td className="px-3 py-2 font-bold">{r.year}{r.yearNum === selectedYear ? ' ◀' : ''}</td>
                <td className="px-3 py-2 text-right font-mono">{pdFmt(r.rev)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{pdFmt(r.operatingRev)}</td>
                <td className="px-3 py-2 text-right font-mono text-amber-800">{pdFmt(r.otherRev)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{pdFmt(r.exp)}</td>
                <td className={`px-3 py-2 text-right font-mono font-semibold ${r.net >= 0 ? 'text-green-700' : 'text-gray-700'}`}>{pdFmt(r.net)}</td>
                <td className={`px-3 py-2 text-right font-mono ${r.noi >= 0 ? 'text-blue-700' : 'text-gray-600'}`}>{pdFmt(r.noi)}</td>
                <td className={`px-3 py-2 text-right font-mono ${r.margin != null && r.margin >= 0 ? 'text-green-700' : 'text-gray-600'}`}>
                  {pdPct(r.margin)}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 6 multi-year trend charts — 2-column grid, 3 rows. Development-framed:
          negative net income is holding-phase burn (not styled red as "bad"). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1 — Net Income Trajectory */}
        <div className={chartCard}>
          <p className={chartTitle}>Net Income Trajectory</p>
          <p className="text-[11px] text-gray-400 mb-2">Negative during the pre-revenue holding phase is expected for development entities.</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={rows} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => pdFmt(v as number)} />
              <Tooltip formatter={(v: number) => [pdFmtFull(v), 'Net Income']} />
              <ReferenceLine y={0} stroke="#D1D5DB" />
              <Line type="monotone" dataKey="net" stroke="#2E75B6" strokeWidth={2} dot={{ fill: '#2E75B6', r: 4 }} activeDot={{ r: 6 }} name="Net Income" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 2 — Revenue vs Expenses by Year */}
        <div className={chartCard}>
          <p className={chartTitle}>Revenue vs Expenses by Year</p>
          <p className="text-[11px] text-gray-400 mb-2">Expenses exceeding minimal revenue is normal holding-phase behavior.</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={rows} margin={{ left: 10 }} barGap={4} barCategoryGap="18%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => pdFmt(v as number)} tick={{ fontSize: 9 }} />
              <Tooltip formatter={(v: number) => pdFmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="rev" name="Revenue" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="exp" name="Expenses" fill={COLORS[5]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 3 — Expense Ratio Trend (near-zero-revenue years omitted) */}
        <div className={chartCard}>
          <p className={chartTitle}>Expense Ratio Trend</p>
          <p className="text-[11px] text-gray-400 mb-2">
            {anyLowRevYear
              ? `Years with revenue below $${KPI_MIN_DENOMINATOR.toLocaleString()} are omitted — the ratio is undefined without meaningful revenue.`
              : 'Total expenses ÷ total revenue per year.'}
          </p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={rows} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${(v as number).toFixed(0)}%`} domain={[0, 'auto']} />
              <Tooltip formatter={(v: number) => (v == null || !Number.isFinite(v) ? ['N/A', 'Expense Ratio'] : [pdPct(v), 'Expense Ratio'])} />
              <Line type="monotone" dataKey="expenseRatio" stroke="#F59E0B" strokeWidth={2} dot={{ fill: '#F59E0B', r: 4 }} activeDot={{ r: 6 }} name="Expense %" connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 4 — Cash Balance Trend (Bank Accounts) */}
        <div className={chartCard}>
          <p className={chartTitle}>Cash Balance Trend (Bank Accounts)</p>
          <p className="text-[11px] text-gray-400 mb-2">Point-in-time bank balance per year-end from the Balance Sheet.</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={rows} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => pdFmt(v as number)} />
              <Tooltip formatter={(v: number) => [pdFmtFull(v), 'Cash']} />
              <Line type="monotone" dataKey="cash" stroke="#5A2D82" strokeWidth={2} dot={{ fill: '#5A2D82', r: 4 }} activeDot={{ r: 6 }} name="Cash" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 5 — Revenue Breakdown by Year (dynamic P&L sub-categories) */}
        <div className={chartCard}>
          <p className={chartTitle}>Revenue Breakdown by Year</p>
          <p className="text-[11px] text-gray-400 mb-2">
            {revChartSeries.useStacked
              ? 'Operating income lines and post-NOI Other Income parsed from uploaded P&L.'
              : 'Single combined revenue line — no sub-categories detected in P&L.'}
          </p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={revChartSeries.rows} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => pdFmt(v as number)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => pdFmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              {revChartSeries.useStacked
                ? revChartSeries.categoryNames.map((cat, i) => (
                    <Bar
                      key={cat}
                      dataKey={cat}
                      name={cat}
                      stackId="rev"
                      fill={COLORS[i % COLORS.length]}
                      radius={i === revChartSeries.categoryNames.length - 1 ? [4, 4, 0, 0] : undefined}
                    />
                  ))
                : <Bar dataKey="rev" name="Revenue" fill={COLORS[0]} radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 6 — Expense Breakdown pie (current year) */}
        <div className={chartCard}>
          <p className={chartTitle}>Expense Breakdown ({pieRow?.yearLabel ?? selectedYear})</p>
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={expPie} cx="50%" cy="50%" outerRadius={75} dataKey="value">
                {expPie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => pdFmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

function PDCFOView({
  fin,
  company,
  allLoans,
  cfoStatement,
  selectedYear,
  onYearSelect,
  period,
  pMonth,
  pYear,
}: {
  fin: PDFinancials;
  company: CompanyData | undefined;
  allLoans: import('../../contexts/PropertyDevContext').Loan[];
  cfoStatement: CfoStatementView;
  selectedYear: number;
  onYearSelect: (year: number) => void;
  period: Period | null;
  pMonth: number;
  pYear: number;
}) {
  const periodAnchor = useMemo(
    () => propDevPeriodAnchor(period, pMonth, pYear),
    [period, pMonth, pYear],
  );
  const finForCfo = useMemo(() => {
    const scoped = scopePropDevFinToPeriod(
      { ...fin, companyName: fin.companyName },
      periodAnchor,
    );
    return scoped;
  }, [fin, periodAnchor]);
  const bsSnapshots = useMemo(
    () => buildPropDevBsSnapshots(finForCfo, company, periodAnchor, {
      annualLedger: true,
      loans: company?.loans?.length
        ? company.loans
        : allLoans.filter(l => l.companyId === company?.id),
    }),
    [finForCfo, company, periodAnchor, allLoans],
  );
  const cfSnapshots = useMemo(
    () => buildPropDevCfSnapshots(finForCfo, company, periodAnchor, { annualLedger: true }),
    [finForCfo, company, periodAnchor],
  );
  const insights = useMemo(
    () => buildPropDevCfoInsights(fin, company, allLoans, bsSnapshots, cfSnapshots),
    [fin, company, allLoans, bsSnapshots, cfSnapshots],
  );

  return (
    <div className="space-y-6">
      {cfoStatement === 'pl' && (
        <PDCFOPlView
          fin={fin}
          period={period}
          pMonth={pMonth}
          pYear={pYear}
          selectedYear={selectedYear}
        />
      )}

      {cfoStatement === 'bs' && (
        <PropDevCfoBsCharts
          snapshots={bsSnapshots}
          selectedYear={selectedYear}
          onYearSelect={onYearSelect}
          companyName={fin.companyName}
        />
      )}

      {cfoStatement === 'cf' && (
        <PropDevCfoCfCharts
          snapshots={cfSnapshots}
          selectedYear={selectedYear}
          onYearSelect={onYearSelect}
          company={company}
          allLoans={allLoans}
          companyName={fin.companyName}
          periodAnchor={periodAnchor}
          pMonth={pMonth}
          pYear={pYear}
        />
      )}

      <div className="space-y-3">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">CFO Insights</p>
        {insights.map((ins, i) => (
          <div key={i} className={`border rounded-lg p-4 ${ins.color}`}>
            <p className="text-sm text-gray-800">{ins.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const PROPDEV_STORAGE_KEYS = ['propdev_cfo_checklist'];

export default function PropDevFinancials() {
  const navigate = useNavigate();
  const {
    companies, selectedCompanyId, setSelectedCompanyId, loans, ensureCompanyYearly,
    financialPeriod, financialMonth, financialYear, financialSelectedYear,
    setFinancialPeriodAnchor, setFinancialSelectedYear,
  } = usePropDev();
  const { setTab } = usePropDevNav();
  const [activeTab, setActiveTab] = useState<TabType>('P&L Statement');
  const [cfoStatement, setCfoStatement] = useState<CfoStatementView>('pl');
  const cfoPeriod = financialPeriod;
  const cfoMonth = financialMonth;
  const cfoYear = financialYear;
  const cfoSelectedYear = financialSelectedYear;
  const [uploadedFin, setUploadedFin] = useState<PDFinancials | null>(null);
  const [finSyncError, setFinSyncError] = useState<string | null>(null);
  const [finReloadKey, setFinReloadKey] = useState(0);
  const [allFinancials, setAllFinancials] = useState<Record<string, PDFinancials>>({});
  const [loadingAllFin, setLoadingAllFin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [validatingAll, setValidatingAll] = useState(false);
  const [validationReport, setValidationReport] = useState<string | null>(null);
  const plRef = useRef<HTMLInputElement>(null);
  const bsRef = useRef<HTMLInputElement>(null);
  const cfRef = useRef<HTMLInputElement>(null);

  const runValidateAllEntities = useCallback(async () => {
    if (!companies.length || validatingAll) return;
    setValidatingAll(true);
    setValidationReport(null);
    try {
      await Promise.all(companies.map(c => ensureCompanyYearly(c.id)));
      const financialsByCompanyId = await fetchPropDevFinancialsPool<PropDevUploadedFinancials>(
        companies.map(c => c.id),
        (_id, data) => apiFinToPropDevUploaded(data),
      );
      const report = validatePropDevPortfolioCurrentPeriod({
        companies,
        financialsByCompanyId,
        allLoans: loans,
        period: (cfoPeriod ?? 'YTD') as Period,
        month: cfoMonth,
        year: cfoYear,
      });
      setValidationReport(formatPropDevValidationReport(report));
    } catch (e: unknown) {
      setValidationReport(`Validation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setValidatingAll(false);
    }
  }, [companies, validatingAll, ensureCompanyYearly, loans, cfoPeriod, cfoMonth, cfoYear]);

  const isAll = selectedCompanyId === 'all';

  /** Financials are per-company — sync with the global command-strip selector. */
  const financialCompanyId = useMemo(() => {
    if (!isAll && companies.some(c => c.id === selectedCompanyId)) {
      return selectedCompanyId;
    }
    return '';
  }, [isAll, selectedCompanyId, companies]);

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === financialCompanyId),
    [companies, financialCompanyId],
  );

  useEffect(() => {
    const latest = uploadedFin?.years[uploadedFin.years.length - 1];
    if (latest == null) return;
    // Keep period year + highlight year on the company's latest data year so
    // Export PDF (anchor = financialYear) cannot drift to calendar year while
    // the screen highlights a different selected year.
    setFinancialPeriodAnchor(financialPeriod, financialMonth, latest);
  }, [uploadedFin?.years.join(','), setFinancialPeriodAnchor]); // eslint-disable-line react-hooks/exhaustive-deps -- only re-anchor when company years change

  useEffect(() => {
    PROPDEV_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
  }, []);

  // Load financials from backend when company changes — same pattern as Rentals Financials
  useEffect(() => {
    if (!financialCompanyId) {
      setUploadedFin(null);
      setFinSyncError(null);
      return;
    }

    // Already in memory after upload / portfolio fetch
    if (allFinancials[financialCompanyId]) {
      const company = companies.find(c => c.id === financialCompanyId);
      setUploadedFin(enrichPropDevFinWithCf(allFinancials[financialCompanyId], company));
      return;
    }

    let cancelled = false;
    setFinSyncError(null);
    setLoadingAllFin(true);

    api.get<{
      company_name: string; filename: string; date_range: string;
      years: number[]; periods?: string[];
      pl: PDFinItem[]; bs: PDFinItem[]; cf?: PDFinItem[];
      pl_filename?: string; bs_filename?: string; cf_filename?: string;
      uploaded_at: string;
    }>(`/api/propdev/financials/${financialCompanyId}`)
      .then(res => {
        if (cancelled || !res.data) return;
        if (!res.data.pl?.length && !res.data.bs?.length && !(res.data.cf?.length)) return;
        const fin = enrichPropDevFinWithCf(apiFinToPD(res.data), selectedCompany);
        setUploadedFin(fin);
        setAllFinancials(prev => ({ ...prev, [financialCompanyId]: fin }));
        localStorage.setItem(PD_LS_KEY(financialCompanyId), JSON.stringify(fin));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setUploadedFin(null);
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setFinSyncError(null);
          return;
        }
        if (status === 502 || status === 503 || status === 504 || !status) {
          setFinSyncError(
            'API temporarily unavailable (Render may be waking or overloaded). Wait ~30s and click Retry — you do not need to re-upload.',
          );
          return;
        }
        setFinSyncError('Could not load saved financials for this company. Try Retry before uploading again.');
      })
      .finally(() => {
        if (!cancelled) setLoadingAllFin(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mirror Rentals: only re-fetch when company id / retry changes
  }, [financialCompanyId, finReloadKey]);

  // Load all companies' financials when portfolio view is active (staggered — same as Rentals)
  useEffect(() => {
    if (!isAll || !companies.length) return;
    const missing = companies.filter(c => !allFinancials[c.id]);
    if (!missing.length) return;

    let cancelled = false;
    setLoadingAllFin(true);
    fetchPropDevFinancialsPool(
      missing.map(c => c.id),
      (_id, d) => apiFinToPD({
        company_name: d.company_name,
        years: d.years ?? [],
        pl: d.pl as PDFinItem[],
        bs: d.bs as PDFinItem[],
        cf: (d.cf ?? []) as PDFinItem[],
        filename: d.filename,
        uploaded_at: d.uploaded_at,
      }),
      {
        onItem: (id, item) => {
          if (!cancelled) setAllFinancials(prev => ({ ...prev, [id]: item }));
        },
      },
    )
      .then(merged => {
        if (!cancelled) setAllFinancials(prev => ({ ...prev, ...merged }));
      })
      .finally(() => {
        if (!cancelled) setLoadingAllFin(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAll, companies]);

  const handleFile = useCallback(async (file: File, hintType?: 'pl' | 'bs' | 'cf') => {
    if (!financialCompanyId || !selectedCompany) {
      alert('Please select a company first.');
      return;
    }
    setUploading(true);
    try {
      await withTimeout((async () => {
        const parsed = await parseFinancialExcel(file, selectedCompany.name, { hintType });
        if (!parsed.pl.length && !parsed.bs.length && !parsed.cf.length) {
          const notes = parsed.parseNotes?.length
            ? `\n\nDetails:\n${parsed.parseNotes.join('\n')}`
            : '';
          alert(
            `Could not parse "${file.name}". Use a QuickBooks-style Excel export with:\n`
            + `• Monthly columns (e.g. Dec 2021, Jan 2022) OR year columns (2021, 2022)\n`
            + `• Line items in the first column (Income, Expenses, Assets, Cash Flow, etc.)`
            + notes,
          );
          return;
        }

        // Merge like Rentals — keep existing statements when this file only has one type
        const base: PDFinancials = uploadedFin ?? {
          companyName: selectedCompany.name, years: [], plFile: '', bsFile: '', uploadedAt: '', pl: [], bs: [],
        };
        const allYears = Array.from(new Set([...base.years, ...parsed.years])).sort((a, b) => a - b);
        const plFile = parsed.pl.length ? file.name : base.plFile;
        const bsFile = parsed.bs.length ? file.name : base.bsFile;
        const cfFile = parsed.cf.length ? file.name : base.cfFile;
        const next = pruneInactivePropDevYears({
          ...base,
          years: allYears,
          companyName: parsed.companyName || selectedCompany.name,
          uploadedAt: parsed.uploadedAt || new Date().toISOString(),
          plFile,
          bsFile,
          cfFile,
          pl: parsed.pl.length ? (parsed.pl as PDFinItem[]) : base.pl,
          bs: parsed.bs.length ? (parsed.bs as PDFinItem[]) : base.bs,
          cf: parsed.cf.length ? (parsed.cf as PDFinItem[]) : (base.cf ?? []),
        });
        // If prune wiped years but line items still carry year keys/amounts, restore them.
        if (!next.years.length) {
          const fromVals = yearsFromItemsWithNonZeroValues([
            ...next.pl, ...next.bs, ...(next.cf ?? []),
          ]);
          const fromKeys = yearsFromItems([
            ...next.pl, ...next.bs, ...(next.cf ?? []),
          ]);
          next.years = fromVals.length ? fromVals : fromKeys;
        }
        setUploadedFin(next);
        setAllFinancials(prev => ({ ...prev, [financialCompanyId]: next }));
        localStorage.setItem(PD_LS_KEY(financialCompanyId), JSON.stringify(next));

        // Full payload every save — same as Rentals /api/rentals/financials/save
        await postJsonWithWake('/api/propdev/financials/save', {
          company_id: financialCompanyId,
          company_name: next.companyName,
          filename: buildCombinedFilename(plFile, bsFile, cfFile),
          pl_filename: plFile || null,
          bs_filename: bsFile || null,
          cf_filename: cfFile || null,
          date_range: parsed.dateRange || '',
          years: next.years,
          periods: parsed.periods?.length ? parsed.periods : undefined,
          pl: next.pl,
          bs: next.bs,
          cf: next.cf ?? [],
        });

        alert(`Saved for ${selectedCompany.name}.`);

        if (hintType === 'cf' || (parsed.cf.length > 0 && !parsed.pl.length && !parsed.bs.length)) {
          setActiveTab('Cash Flow');
        } else if (hintType === 'bs' || (parsed.bs.length > 0 && !parsed.pl.length)) {
          setActiveTab('Balance Sheet');
        } else if (hintType === 'pl' || parsed.pl.length > 0) {
          setActiveTab('P&L Statement');
        }
      })(), 90_000, 'Financials upload');
    } catch (e: unknown) {
      alert(`Upload failed: ${formatApiError(e, 'Could not save financials')}`);
    } finally {
      setUploading(false);
    }
  }, [financialCompanyId, selectedCompany, uploadedFin]);

  const clearData = useCallback(async () => {
    if (!financialCompanyId) return;
    try {
      await api.delete(`/api/propdev/financials/${financialCompanyId}`);
    } catch { /* ignore */ }
    localStorage.removeItem(PD_LS_KEY(financialCompanyId));
    setUploadedFin(null);
    setAllFinancials(prev => {
      const n = { ...prev };
      delete n[financialCompanyId];
      return n;
    });
  }, [financialCompanyId]);

  const dataTabActive = activeTab !== 'Strategic Insights' && activeTab !== 'Ownership';
  const partnersTabActive = activeTab === 'Ownership';

  const openPlUpload = () => plRef.current?.click();
  const openBsUpload = () => bsRef.current?.click();
  const openCfUpload = () => cfRef.current?.click();

  /** Always-visible statement uploads (not hidden behind tab-only More). */
  const UploadBar = () => (
    <div
      className="flex items-center gap-2 flex-wrap w-full px-3 py-2.5 rounded-lg border"
      style={{ ...parchmentStyles.uploadBar }}
    >
      <FileSpreadsheet size={15} className="text-amber-800/70 shrink-0" />
      <span className="text-xs text-stone-600 mr-1">Upload for this company:</span>
      <button
        type="button"
        disabled={uploading || !financialCompanyId}
        onClick={openPlUpload}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md text-white transition-colors disabled:opacity-50"
        style={{ background: '#4F46E5' }}
        title="Upload QuickBooks P&L statement"
      >
        <Upload size={12} />
        {uploading ? 'Uploading…' : 'Upload P&L'}
      </button>
      <button
        type="button"
        disabled={uploading || !financialCompanyId}
        onClick={openBsUpload}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md text-white transition-colors disabled:opacity-50 bg-green-600 hover:bg-green-700"
        title="Upload QuickBooks Balance Sheet"
      >
        <Upload size={12} />
        {uploading ? 'Uploading…' : 'Upload Balance Sheet'}
      </button>
      <button
        type="button"
        disabled={uploading || !financialCompanyId}
        onClick={openCfUpload}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md text-white transition-colors disabled:opacity-50"
        style={{ background: '#7C3AED' }}
        title="Upload QuickBooks Cash Flow"
      >
        <Upload size={12} />
        {uploading ? 'Uploading…' : 'Upload Cash Flow'}
      </button>
      {uploadedFin && (
        <>
          <div className="ml-auto flex items-center gap-2">
            <PDExportPdfButton
              fin={uploadedFin}
              company={selectedCompany}
              allLoans={loans}
              period={cfoPeriod}
              pMonth={cfoMonth}
              pYear={cfoYear}
              selectedYear={cfoSelectedYear}
              companies={companies}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => void clearData()}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              Clear all uploads
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PropDevPageHeader
            title="Financials"
            subtitle={
              isAll
                ? `Portfolio overview — ${companies.length} ${companies.length === 1 ? 'entity' : 'entities'} · select a company in the top bar to drill in`
                : uploadedFin && financialCompanyId
                  ? `${uploadedFin.companyName} — ${uploadedFin.years.length > 0 ? uploadedFin.years.join(', ') : 'no year data'}`
                  : financialCompanyId
                    ? `No P&L/B/S uploaded for ${selectedCompany?.name ?? 'selected company'}`
                    : 'Select a company in the top bar to view or upload financial statements'
            }
          />
        </div>
      </div>

      {companies.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold mb-2">No Property Dev companies yet</p>
          <p className="text-amber-800 mb-3">Add companies in the registry or import your portfolio Excel before uploading P&amp;L and Balance Sheet files.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigate('/settings/companies?tab=propdev')}
              className="px-4 py-2 bg-white border border-amber-300 rounded-lg text-sm font-medium hover:bg-amber-100">
              Company Registry
            </button>
            <button type="button" onClick={() => setTab('upload')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              Upload Data
            </button>
          </div>
        </div>
      )}

      {companies.length > 0 && financialCompanyId && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>Need another entity?</span>
          <button type="button" onClick={() => navigate('/settings/companies?tab=propdev')} className="text-blue-600 hover:underline font-medium">Company Registry</button>
          <span>·</span>
          <button type="button" onClick={() => setTab('upload')} className="text-blue-600 hover:underline font-medium">Upload portfolio Excel</button>
        </div>
      )}

      {finSyncError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-3 justify-between">
          <span>{finSyncError}</span>
          <button
            type="button"
            className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-md text-white"
            style={{ background: '#4F46E5' }}
            onClick={() => {
              setFinSyncError(null);
              setAllFinancials(prev => {
                const n = { ...prev };
                if (financialCompanyId) delete n[financialCompanyId];
                return n;
              });
              setFinReloadKey(k => k + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Tabs + CFO period controls */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div style={parchmentStyles.tabStrip}>
          {TABS.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              style={activeTab === t ? parchmentStyles.tabActive : parchmentStyles.tabInactive}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {companies.length > 0 && (
            <button
              type="button"
              onClick={() => void runValidateAllEntities()}
              disabled={validatingAll}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border font-medium"
              style={{
                background: '#FFFFFF', borderColor: '#E8E9ED', color: '#1C1917',
                cursor: validatingAll ? 'wait' : 'pointer', opacity: validatingAll ? 0.7 : 1,
              }}
              title="Compare summary KPI cards vs YoY Detail for every Prop Dev entity (current period)"
            >
              {validatingAll ? 'Validating…' : 'Validate All Entities'}
            </button>
          )}
          {activeTab === 'CFO Dashboard' && uploadedFin && financialCompanyId && (
            <>
              <PDCfoToolbar
                fin={uploadedFin}
                cfoStatement={cfoStatement}
                onCfoStatementChange={setCfoStatement}
                period={cfoPeriod}
                pMonth={cfoMonth}
                pYear={cfoYear}
                selectedYear={cfoSelectedYear}
                onPeriodChange={setFinancialPeriodAnchor}
                onSelectedYearChange={y => {
                  setFinancialSelectedYear(y);
                  setFinancialPeriodAnchor(financialPeriod, financialMonth, y);
                }}
              />
              <PDCfoExportPdfButton
                fin={uploadedFin}
                company={selectedCompany}
                allLoans={loans}
                companies={companies}
                period={cfoPeriod}
                pMonth={cfoMonth}
                pYear={cfoYear}
                selectedYear={cfoSelectedYear}
              />
            </>
          )}
        </div>
      </div>

      {validationReport && (
        <div
          className="rounded-lg border p-3"
          style={{ background: '#FFFFFF', borderColor: '#E8E9ED' }}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#78716C' }}>
              Cross-entity validation report
            </p>
            <button
              type="button"
              className="text-xs underline"
              style={{ color: '#57534E' }}
              onClick={() => setValidationReport(null)}
            >
              Dismiss
            </button>
          </div>
          <pre
            className="text-xs whitespace-pre-wrap overflow-auto max-h-80 font-mono"
            style={{ color: '#1C1917', margin: 0 }}
          >
            {validationReport}
          </pre>
        </div>
      )}

      {/* Dedicated upload strip — always visible when a company is selected on data tabs */}
      {dataTabActive && financialCompanyId && <UploadBar />}

      {/* Keep Export PDF listener mounted even when UploadBar is hidden (e.g. Ownership tab) */}
      {uploadedFin && financialCompanyId && !dataTabActive && (
        <div className="flex justify-end">
          <PDExportPdfButton
            fin={uploadedFin}
            company={selectedCompany}
            allLoans={loans}
            period={cfoPeriod}
            pMonth={cfoMonth}
            pYear={cfoYear}
            selectedYear={cfoSelectedYear}
            companies={companies}
          />
        </div>
      )}

      {/* Hidden file pickers — always mounted so empty-state CTAs work */}
      <input ref={plRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
        onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f,'pl');e.target.value='';}} />
      <input ref={bsRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
        onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f,'bs');e.target.value='';}} />
      <input ref={cfRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
        onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f,'cf');e.target.value='';}} />

      {/* Portfolio PDF export listener — always mounted for All Companies (Command Strip) */}
      {isAll && companies.length > 0 && (
        <PDPortfolioExportPdfButton
          companies={companies}
          allFinancials={allFinancials}
          allLoans={loans}
          period={cfoPeriod}
          pMonth={cfoMonth}
          pYear={cfoYear}
          selectedYear={cfoSelectedYear}
          ensureCompanyYearly={ensureCompanyYearly}
          onFinancialsLoaded={(id, fin) => setAllFinancials(prev => ({ ...prev, [id]: fin }))}
          hidden
        />
      )}

      {/* Content */}
      <div className="min-h-[400px]">
        {partnersTabActive ? (
          isAll ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Building2 size={32} className="text-gray-400 mb-3" />
              <p className="text-lg font-semibold text-gray-700 mb-2">Select a company</p>
              <p className="text-sm text-gray-400 max-w-sm">Partner capital is per entity — choose a company from the dropdown or portfolio list below.</p>
            </div>
          ) : (
            <PD05Partners scopeCompanyId={financialCompanyId} embedded />
          )
        ) : isAll && dataTabActive ? (
          <div className="border rounded-2xl shadow-sm p-6" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={18} className="text-amber-700" />
              <h2 className="text-lg font-bold text-gray-900">All Companies — Portfolio Overview</h2>
            </div>
            <p className="text-gray-400 text-sm mb-6">
              {companies.length} entities in portfolio
            </p>
            <PDAllCompaniesPortfolio
              companies={companies}
              allFinancials={allFinancials}
              loans={loans}
              loading={loadingAllFin}
              period={cfoPeriod}
              pMonth={cfoMonth}
              pYear={cfoYear}
              selectedYear={cfoSelectedYear}
              onSelectCompany={id => {
                setSelectedCompanyId(id);
                setActiveTab('P&L Statement');
              }}
            />
          </div>
        ) : dataTabActive && !financialCompanyId ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Building2 size={28} className="text-gray-400" />
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-2">Select a company</p>
            <p className="text-sm text-gray-400 max-w-sm mb-4">
              Use the company dropdown above or the top bar selector to view financials for each Property Dev entity.
            </p>
          </div>
        ) : dataTabActive && !uploadedFin ? (
          <div className="flex flex-col items-center justify-center min-h-[16rem] text-center px-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <FileSpreadsheet size={28} className="text-gray-400" />
            </div>
            {finSyncError ? (
              <>
                <p className="text-lg font-semibold text-amber-900 mb-2">Could not load financials</p>
                <p className="text-sm text-amber-800 max-w-md mb-4">{finSyncError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setFinSyncError(null);
                    setAllFinancials(prev => {
                      const n = { ...prev };
                      if (financialCompanyId) delete n[financialCompanyId];
                      return n;
                    });
                    // bump by clearing then re-setting company id via force reload key
                    setFinReloadKey(k => k + 1);
                  }}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white"
                  style={{ background: '#4F46E5' }}
                >
                  Retry load
                </button>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold text-gray-700 mb-2">
                  No statements uploaded yet for {selectedCompany?.name ?? 'this company'}
                </p>
                <p className="text-sm text-gray-500 max-w-md mb-2">
                  Upload <strong>once</strong> per statement type using the bar above:
                  P&amp;L, Balance Sheet, and Cash Flow (3 files max). You do not need to re-upload
                  every time you open this page.
                </p>
                <p className="text-xs text-gray-400 max-w-md">
                  Only re-upload if you intentionally cleared data or deleted/re-created the company in Company Registry.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            {activeTab === 'P&L Statement'           && (uploadedFin ? <PDPLTable fin={uploadedFin} onUploadPl={openPlUpload} /> : null)}
            {activeTab === 'Balance Sheet'           && (uploadedFin ? <PDBSTable fin={uploadedFin} onUploadBs={openBsUpload} /> : null)}
            {activeTab === 'Cash Flow'               && (uploadedFin ? (
              <PDCFTable
                fin={uploadedFin}
                company={selectedCompany}
                onUploadCf={openCfUpload}
              />
            ) : null)}
            {activeTab === 'KPI Dashboard'           && (uploadedFin ? <PDKPIView fin={uploadedFin} /> : null)}
            {activeTab === 'CFO Dashboard'           && (uploadedFin ? (
              <PDCFOView
                fin={uploadedFin}
                company={selectedCompany}
                allLoans={loans}
                cfoStatement={cfoStatement}
                selectedYear={cfoSelectedYear}
                onYearSelect={y => {
                  setFinancialSelectedYear(y);
                  setFinancialPeriodAnchor(financialPeriod, financialMonth, y);
                }}
                period={cfoPeriod}
                pMonth={cfoMonth}
                pYear={cfoYear}
              />
            ) : null)}
            {activeTab === 'Strategic Insights'      && (
              <StrategicTab company={selectedCompany} fin={uploadedFin} allLoans={loans} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
