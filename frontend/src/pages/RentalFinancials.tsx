import { useState, useRef, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from 'recharts';
import { Upload, Building2, FileSpreadsheet, TrendingUp } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FinItem {
  label: string;
  values: Record<number, number>;
  indent: number;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
}

interface ParsedFinancials {
  companyName: string;
  dateRange: string;
  fileName: string;
  uploadedAt: string;
  years: number[];
  pl: FinItem[];
  bs: FinItem[];
}

interface KpiData {
  totalRevenue: number; totalExpenses: number; netIncome: number; noi: number;
  rentalIncome: number; otherIncome: number;
  interestExpense: number; propertyTax: number; managementFee: number;
  hoaFees: number; legalFees: number; utilities: number; repairs: number;
  totalAssets: number; totalLiabilities: number; equity: number; cash: number;
  buildings: number; accumDep: number; longTermLoans: number; securityDeposits: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RENTAL_COMPANIES = [
  'All Companies',
  'ABC LLC',
  'Sunstone Rentals LLC',
  'Meridian Residential LLC',
  'Cornerstone Housing LLC',
  'Pinnacle Rentals I LLC',
  'Summit Living LLC',
  'Heritage Residential LLC',
  'Riverview Rentals LLC',
  'Landmark Housing LLC',
  'Horizon Rentals LLC',
  'Crestview Living LLC',
];

const TABS = ['P&L Statement', 'Balance Sheet', 'KPI Dashboard', 'CFO Dashboard'] as const;
type FinTab = typeof TABS[number];

const CC = ['#2E75B6','#70AD47','#ED7D31','#FFC000','#5A2D82','#C00000','#00B0F0','#FF0066'];

const lsKey = (c: string) => `rental_financials_${c.replace(/\s+/g, '_')}`;

// ── Parser ────────────────────────────────────────────────────────────────────

function detectYearHeaders(raw: unknown[][]): { headerRowIdx: number; yearCols: Array<{year:number;col:number}> } | null {
  for (let r = 0; r < Math.min(raw.length, 15); r++) {
    const row = raw[r] as unknown[];
    const yearCols: Array<{year:number;col:number}> = [];
    for (let c = 0; c < row.length; c++) {
      const v = Number(row[c]);
      if (Number.isInteger(v) && v >= 2018 && v <= 2030) yearCols.push({ year: v, col: c });
    }
    if (yearCols.length >= 2) return { headerRowIdx: r, yearCols };
  }
  return null;
}

function detectSheetType(raw: unknown[][]): 'pl' | 'bs' | 'unknown' {
  for (let r = 0; r < Math.min(6, raw.length); r++) {
    const joined = (raw[r] as unknown[]).map(c => String(c ?? '').toLowerCase()).join(' ');
    if (joined.includes('profit and loss') || joined.includes('income statement')) return 'pl';
    if (joined.includes('balance sheet')) return 'bs';
  }
  return 'unknown';
}

function parseSheetRows(raw: unknown[][], headerRowIdx: number, yearCols: Array<{year:number;col:number}>): FinItem[] {
  const items: FinItem[] = [];
  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r] as unknown[];
    const rawLabel = String(row[0] ?? '');
    const trimmed = rawLabel.trim();
    if (!trimmed) continue;
    const indent = rawLabel.length - rawLabel.trimStart().length;
    const isTotal = /^total\s+for\s+/i.test(trimmed) || /^total\s+(assets|liabilities|equity)/i.test(trimmed);
    const isNetIncome = /^net\s+income$/i.test(trimmed);
    const values: Record<number,number> = {};
    let hasAny = false;
    for (const { year, col } of yearCols) {
      const raw_v = row[col];
      const v = (raw_v === '' || raw_v === null || raw_v === undefined) ? 0 : Number(raw_v);
      values[year] = isNaN(v) ? 0 : v;
      if (values[year] !== 0) hasAny = true;
    }
    const isSectionHeader = !hasAny && !isTotal && !isNetIncome;
    if (!hasAny && !isSectionHeader) continue;
    items.push({ label: trimmed, indent, values, isTotal, isSectionHeader, isNetIncome });
  }
  return items;
}

function getCompanyName(raw: unknown[][]): string {
  for (let r = 0; r < Math.min(3, raw.length); r++) {
    const val = String((raw[r] as unknown[])[0] ?? '').trim();
    if (val && val.length > 2 && !/profit|loss|balance|sheet/i.test(val)) return val;
  }
  return '';
}

function getDateRange(raw: unknown[][]): string {
  for (let r = 0; r < Math.min(6, raw.length); r++) {
    const joined = (raw[r] as unknown[]).join(' ').trim();
    if (/\d{4}/.test(joined) && /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(joined)) return joined;
  }
  return '';
}

function parseExcel(file: File, companyName: string): Promise<ParsedFinancials> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false });
        let plItems: FinItem[] = [];
        let bsItems: FinItem[] = [];
        let detectedYears: number[] = [];
        let detectedName = companyName;
        let dateRange = '';
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
          const sheetType = detectSheetType(raw);
          const yearInfo = detectYearHeaders(raw);
          if (!yearInfo) continue;
          const name = getCompanyName(raw);
          if (name && !detectedName) detectedName = name;
          if (!dateRange) dateRange = getDateRange(raw);
          const years = yearInfo.yearCols.map(yc => yc.year).sort((a,b) => a-b);
          const items = parseSheetRows(raw, yearInfo.headerRowIdx, yearInfo.yearCols);
          if (sheetType === 'pl') { plItems = items; detectedYears = years; }
          else if (sheetType === 'bs') { bsItems = items; if (!detectedYears.length) detectedYears = years; }
          else {
            if (!plItems.length) { plItems = items; detectedYears = years; }
            else if (!bsItems.length) { bsItems = items; }
          }
        }
        resolve({ companyName: detectedName || companyName, dateRange, fileName: file.name, uploadedAt: new Date().toISOString(), years: detectedYears, pl: plItems, bs: bsItems });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number): string => {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `$${(abs/1_000_000).toFixed(2)}M` : abs >= 1_000 ? `$${(abs/1_000).toFixed(1)}K` : `$${abs.toLocaleString()}`;
  return n < 0 ? `(${s})` : s;
};

const fmtFull = (n: number): string => {
  if (n === 0) return '—';
  const abs = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
};

function getYV(items: FinItem[], pattern: RegExp, year: number): number {
  return items.find(i => pattern.test(i.label))?.values[year] ?? 0;
}

function sumI(items: FinItem[], pattern: RegExp, year: number): number {
  return items.filter(i => !i.isSectionHeader && !i.isTotal && pattern.test(i.label))
    .reduce((s,i) => s + (i.values[year] ?? 0), 0);
}

function calcKpis(fin: ParsedFinancials, year: number): KpiData {
  const pl = fin.pl; const bs = fin.bs;
  const totalRevenue = getYV(pl,/^total\s+for\s+income$/i,year) || getYV(pl,/^total\s+income$/i,year) || sumI(pl,/income|revenue|rent/i,year);
  const totalExpenses = getYV(pl,/^total\s+for\s+expenses?$/i,year) || getYV(pl,/^total\s+expenses?$/i,year);
  const netIncome = getYV(pl,/^net\s+income$/i,year);
  const interestExpense = Math.abs(sumI(pl,/interest/i,year)) || Math.abs(getYV(pl,/interest\s+paid/i,year));
  const noi = totalRevenue - totalExpenses + interestExpense;
  const rentalIncome = getYV(pl,/^total\s+for\s+rental\s+income$/i,year) || sumI(pl,/^rent\s+suit|^rental\s+income$/i,year);
  const otherIncome = sumI(pl,/^other\s+income$|^services$/i,year);
  const propertyTax = Math.abs(sumI(pl,/property\s+tax/i,year));
  const managementFee = Math.abs(sumI(pl,/management\s+fee/i,year));
  const hoaFees = Math.abs(sumI(pl,/^hoa$/i,year));
  const legalFees = Math.abs(sumI(pl,/legal/i,year));
  const utilities = Math.abs(sumI(pl,/electricity|internet|utilities/i,year));
  const repairs = Math.abs(sumI(pl,/repair|maintenance/i,year));
  const totalAssets = getYV(bs,/^total\s+for\s+assets$/i,year) || getYV(bs,/^total\s+assets$/i,year);
  const totalLiabilities = getYV(bs,/^total\s+for\s+liabilities$/i,year) || getYV(bs,/^total\s+liabilities$/i,year);
  const equity = getYV(bs,/^total\s+for\s+equity$/i,year) || getYV(bs,/^total\s+equity$/i,year);
  const cash = getYV(bs,/^total\s+for\s+bank\s+accounts$/i,year) || sumI(bs,/^bank|checking|savings/i,year);
  const buildings = Math.abs(getYV(bs,/^buildings$/i,year));
  const accumDep = getYV(bs,/accumulated\s+dep/i,year);
  const longTermLoans = Math.abs(getYV(bs,/^total\s+for\s+long.term/i,year) || sumI(bs,/long.term\s+(business\s+)?loan/i,year));
  const securityDeposits = Math.abs(getYV(bs,/security\s+deposit/i,year));
  return { totalRevenue, totalExpenses, netIncome, noi, rentalIncome, otherIncome, interestExpense, propertyTax, managementFee, hoaFees, legalFees, utilities, repairs, totalAssets, totalLiabilities, equity, cash, buildings, accumDep, longTermLoans, securityDeposits };
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyUpload({ onUpload, company }: { onUpload: () => void; company: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <FileSpreadsheet className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-700 mb-2">No Financial Data Uploaded</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        {company === 'All Companies'
          ? 'Select a specific company from the dropdown above to upload their financials.'
          : `Upload ${company}'s Excel financial statements (P&L and Balance Sheet).`}
      </p>
      {company !== 'All Companies' && (
        <button onClick={onUpload} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors">
          <Upload size={16} /> Upload Excel File
        </button>
      )}
      <p className="text-xs text-gray-400 mt-4">Supported format: Excel (.xlsx) with P&L and Balance Sheet data</p>
    </div>
  );
}

// ── P&L Table ─────────────────────────────────────────────────────────────────

function PLTable({ fin }: { fin: ParsedFinancials }) {
  if (!fin.pl.length) return <p className="text-center text-gray-400 py-12 text-sm">No P&amp;L data found in the uploaded file. Ensure the Excel contains a "Profit and Loss" sheet or section.</p>;
  const years = fin.years;
  const rowBg = (item: FinItem) => {
    if (item.isNetIncome) return 'bg-gray-900 text-white font-bold';
    if (item.isTotal) return 'bg-blue-50 font-semibold text-blue-900 border-t border-blue-200';
    if (item.isSectionHeader) return 'bg-amber-50 text-amber-800 font-semibold text-xs uppercase tracking-wide';
    return 'hover:bg-gray-50 text-gray-700';
  };
  const padCls = (item: FinItem) => item.isTotal || item.isSectionHeader ? 'px-4' : item.indent > 4 ? 'pl-12 pr-4' : item.indent > 1 ? 'pl-8 pr-4' : 'pl-5 pr-4';
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-900 text-white">
            <th className="text-left px-4 py-2.5 w-72">Line Item</th>
            {years.map(y => <th key={y} className="text-right px-3 py-2.5 min-w-[110px]">{y}</th>)}
          </tr>
        </thead>
        <tbody>
          {fin.pl.map((item, i) => (
            <tr key={i} className={`border-t border-gray-100 ${rowBg(item)}`}>
              <td className={`py-1.5 ${padCls(item)}`}>{item.label}</td>
              {years.map(y => (
                <td key={y} className={`py-1.5 px-3 text-right font-mono ${item.isNetIncome ? 'text-white' : item.values[y] < 0 ? 'text-red-600' : ''}`}>
                  {item.values[y] === 0 ? '—' : fmtFull(item.values[y])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Balance Sheet Table ───────────────────────────────────────────────────────

function BSTable({ fin }: { fin: ParsedFinancials }) {
  if (!fin.bs.length) return <p className="text-center text-gray-400 py-12 text-sm">No Balance Sheet data found. Ensure the Excel contains a "Balance Sheet" sheet or section.</p>;
  const years = fin.years;
  const rowBg = (item: FinItem) => {
    const lbl = item.label.toLowerCase();
    if (/total\s+(for\s+)?(liabilities\s+and\s+equity|assets$)/.test(lbl)) return 'bg-gray-900 text-white font-bold';
    if (/total\s+for\s+liabilities$/.test(lbl)) return 'bg-orange-100 font-bold text-orange-900 border-t border-orange-300';
    if (/total\s+for\s+equity$/.test(lbl)) return 'bg-green-100 font-bold text-green-900 border-t border-green-300';
    if (item.isTotal) return 'bg-blue-50 font-semibold text-blue-900 border-t border-blue-200';
    if (item.isSectionHeader) return 'bg-gray-50 text-gray-700 font-semibold text-xs uppercase tracking-wide';
    return 'hover:bg-gray-50 text-gray-700';
  };
  const padCls = (item: FinItem) => item.isTotal || item.isSectionHeader ? 'px-4' : item.indent > 4 ? 'pl-12 pr-4' : item.indent > 1 ? 'pl-8 pr-4' : 'pl-5 pr-4';
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-900 text-white">
            <th className="text-left px-4 py-2.5 w-72">Item</th>
            {years.map(y => <th key={y} className="text-right px-3 py-2.5 min-w-[120px]">Dec 31, {y}</th>)}
          </tr>
        </thead>
        <tbody>
          {fin.bs.map((item, i) => (
            <tr key={i} className={`border-t border-gray-100 ${rowBg(item)}`}>
              <td className={`py-1.5 ${padCls(item)}`}>{item.label}</td>
              {years.map(y => (
                <td key={y} className={`py-1.5 px-3 text-right font-mono ${item.values[y] < 0 ? 'text-red-500' : ''}`}>
                  {item.values[y] === 0 ? '—' : fmtFull(item.values[y])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KCard({ label, value, sub, status }: { label:string; value:string; sub:string; status:'good'|'warn'|'bad'|'info' }) {
  const border = { good:'border-green-500 bg-green-50', warn:'border-amber-500 bg-amber-50', bad:'border-red-500 bg-red-50', info:'border-blue-500 bg-blue-50' }[status];
  const pill   = { good:'bg-green-100 text-green-700', warn:'bg-amber-100 text-amber-700', bad:'bg-red-100 text-red-700', info:'bg-blue-100 text-blue-700' }[status];
  const pillTx = { good:'✓ Healthy', warn:'⚠ Monitor', bad:'✗ Review', info:'ℹ Info' }[status];
  return (
    <div className={`border-l-4 ${border} rounded-lg p-4 shadow-sm`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-xl font-bold font-mono text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
      <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-2 font-medium ${pill}`}>{pillTx}</span>
    </div>
  );
}

// ── KPI Dashboard Tab ─────────────────────────────────────────────────────────

function KPITab({ fin }: { fin: ParsedFinancials }) {
  const lastY = fin.years[fin.years.length - 1];
  const prevY = fin.years.length >= 2 ? fin.years[fin.years.length - 2] : null;
  const k = calcKpis(fin, lastY);
  const kP = prevY ? calcKpis(fin, prevY) : null;

  const noiM  = k.totalRevenue > 0 ? k.noi / k.totalRevenue * 100 : 0;
  const netM  = k.totalRevenue > 0 ? k.netIncome / k.totalRevenue * 100 : 0;
  const expR  = k.totalRevenue > 0 ? k.totalExpenses / k.totalRevenue * 100 : 0;
  const revG  = kP && kP.totalRevenue > 0 ? (k.totalRevenue - kP.totalRevenue) / kP.totalRevenue * 100 : null;
  const rentP = k.totalRevenue > 0 ? k.rentalIncome / k.totalRevenue * 100 : 0;
  const iCov  = k.interestExpense > 0 ? k.noi / k.interestExpense : 0;
  const mgmtP = k.totalRevenue > 0 ? k.managementFee / k.totalRevenue * 100 : 0;
  const repP  = k.totalRevenue > 0 ? k.repairs / k.totalRevenue * 100 : 0;
  const ltv   = k.buildings > 0 ? k.longTermLoans / k.buildings * 100 : 0;
  const alR   = k.totalLiabilities > 0 ? k.totalAssets / k.totalLiabilities : 0;
  const dte   = k.equity > 0 ? k.totalLiabilities / k.equity : 0;

  const trendData = fin.years.map(y => {
    const kk = calcKpis(fin, y);
    return { year: String(y), Revenue: kk.totalRevenue, Expenses: kk.totalExpenses, 'Net Income': kk.netIncome, NOI: kk.noi };
  });

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">KPIs for latest year: <strong>{lastY}</strong></p>

      <div>
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Profitability</p>
        <div className="grid grid-cols-4 gap-4">
          <KCard label="NOI Margin" value={`${noiM.toFixed(1)}%`} sub={`NOI: ${fmt(k.noi)}`} status={noiM>=40?'good':noiM>=20?'warn':'bad'} />
          <KCard label="Net Income Margin" value={`${netM.toFixed(1)}%`} sub={`Net: ${fmt(k.netIncome)}`} status={netM>=10?'good':netM>=0?'warn':'bad'} />
          <KCard label="Revenue Growth YoY" value={revG!==null?`${revG>=0?'+':''}${revG.toFixed(1)}%`:'N/A'} sub={prevY?`${lastY} vs ${prevY}`:'Only 1 year'} status={revG===null?'info':revG>=3?'good':revG>=0?'warn':'bad'} />
          <KCard label="Expense Ratio" value={`${expR.toFixed(1)}%`} sub={`Total exp: ${fmt(k.totalExpenses)}`} status={expR<=70?'good':expR<=85?'warn':'bad'} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Rental Performance</p>
        <div className="grid grid-cols-4 gap-4">
          <KCard label="Rental Income %" value={`${rentP.toFixed(1)}%`} sub={`${fmt(k.rentalIncome)} of ${fmt(k.totalRevenue)}`} status={rentP>=80?'good':'info'} />
          <KCard label="Interest Coverage" value={iCov>0?`${iCov.toFixed(2)}x`:'N/A'} sub={`NOI ÷ Interest (${fmt(k.interestExpense)})`} status={iCov>=2?'good':iCov>=1.2?'warn':'bad'} />
          <KCard label="Mgmt Fee %" value={`${mgmtP.toFixed(1)}%`} sub={`${fmt(k.managementFee)} of revenue`} status={mgmtP<=10?'good':mgmtP<=15?'warn':'bad'} />
          <KCard label="Repair % of Revenue" value={`${repP.toFixed(1)}%`} sub={`${fmt(k.repairs)} repairs/maint`} status={repP<=5?'good':repP<=10?'warn':'bad'} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">Balance Sheet</p>
        <div className="grid grid-cols-4 gap-4">
          <KCard label="LTV (Loans / Building)" value={ltv>0?`${ltv.toFixed(1)}%`:'N/A'} sub={`Loans: ${fmt(k.longTermLoans)}`} status={ltv>0&&ltv<=75?'good':ltv<=85?'warn':'bad'} />
          <KCard label="Asset / Liability Ratio" value={alR>0?`${alR.toFixed(2)}x`:'N/A'} sub={`Assets: ${fmt(k.totalAssets)}`} status={alR>=1.5?'good':alR>=1?'warn':'bad'} />
          <KCard label="Debt-to-Equity" value={dte>0?`${dte.toFixed(2)}x`:'N/A'} sub={`Equity: ${fmt(k.equity)}`} status={dte>0&&dte<=2?'good':dte<=4?'warn':'bad'} />
          <KCard label="Cash Balance" value={fmt(k.cash)} sub={`As of Dec 31, ${lastY}`} status={k.cash>10000?'good':k.cash>0?'warn':'bad'} />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-3">5-Year Financial Trend</p>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ left:20, right:20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize:11 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize:10 }} />
              <Tooltip formatter={(v:number) => fmtFull(v)} />
              <Legend />
              <Line type="monotone" dataKey="Revenue" stroke={CC[0]} strokeWidth={2} dot />
              <Line type="monotone" dataKey="Expenses" stroke={CC[5]} strokeWidth={2} dot />
              <Line type="monotone" dataKey="Net Income" stroke={CC[1]} strokeWidth={2} dot />
              <Line type="monotone" dataKey="NOI" stroke={CC[2]} strokeWidth={2} strokeDasharray="5 5" dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── CFO Dashboard Tab ─────────────────────────────────────────────────────────

function CFOTab({ fin }: { fin: ParsedFinancials }) {
  const lastY = fin.years[fin.years.length - 1];
  const k = calcKpis(fin, lastY);

  const snapshotRows = fin.years.map(y => {
    const kk = calcKpis(fin, y);
    return { year: y, revenue: kk.totalRevenue, expenses: kk.totalExpenses, netIncome: kk.netIncome, noi: kk.noi, margin: kk.totalRevenue > 0 ? kk.netIncome / kk.totalRevenue * 100 : 0 };
  });

  const revChart = fin.years.map(y => {
    const kk = calcKpis(fin, y);
    const svc = Math.max(0, kk.totalRevenue - kk.rentalIncome - kk.otherIncome);
    return { year: String(y), 'Rental Income': kk.rentalIncome, 'Other Income': kk.otherIncome, 'Services': svc };
  });

  const expPie = [
    { name:'Interest Paid',  value: k.interestExpense  },
    { name:'Property Tax',   value: k.propertyTax      },
    { name:'HOA Fees',       value: k.hoaFees          },
    { name:'Legal Fees',     value: k.legalFees        },
    { name:'Mgmt Fee',       value: k.managementFee    },
    { name:'Utilities',      value: k.utilities        },
    { name:'Repairs',        value: k.repairs          },
    { name:'Other',          value: Math.max(0, k.totalExpenses - k.interestExpense - k.propertyTax - k.hoaFees - k.legalFees - k.managementFee - k.utilities - k.repairs) },
  ].filter(e => e.value > 0);

  const intPct   = k.totalRevenue > 0 ? (k.interestExpense / k.totalRevenue * 100).toFixed(1) : '0';
  const negYrs   = snapshotRows.filter(r => r.netIncome < 0).length;
  const firstK   = calcKpis(fin, fin.years[0]);
  const revGrowth = firstK.totalRevenue > 0 ? ((k.totalRevenue - firstK.totalRevenue) / firstK.totalRevenue * 100).toFixed(1) : null;
  const avgRev   = fin.years.reduce((s,y) => s + calcKpis(fin,y).totalRevenue, 0) / fin.years.length;
  const ltv      = k.buildings > 0 ? k.longTermLoans / k.buildings * 100 : 0;
  const ltvLabel = ltv < 80 ? '✅ Good (below 80%)' : ltv < 90 ? '⚠️ Watch (80–90%)' : '🔴 High (above 90%)';

  const insights: Array<{color:string; text:string}> = [];
  if (k.interestExpense > 0) insights.push({ color:'bg-blue-50 border-blue-200', text:`💡 Interest expense is ${intPct}% of revenue — the single largest expense at ${fmt(k.interestExpense)}. This represents mortgage interest on outstanding loans of ${fmt(k.longTermLoans)}.` });
  if (negYrs > 0) insights.push({ color:'bg-amber-50 border-amber-200', text:`⚠️ Net income has been negative for ${negYrs} of ${fin.years.length} years due to depreciation and interest charges. NOI (pre-interest) is ${k.noi >= 0 ? 'positive' : 'negative'} at ${fmt(k.noi)}, indicating ${k.noi >= 0 ? 'healthy' : 'stressed'} operating performance.` });
  if (revGrowth !== null) insights.push({ color:'bg-green-50 border-green-200', text:`✅ Revenue grew from ${fmt(firstK.totalRevenue)} (${fin.years[0]}) to ${fmt(k.totalRevenue)} (${lastY}) — ${revGrowth}% over ${fin.years.length - 1} years. Average annual revenue: ${fmt(avgRev)}/year.` });
  if (k.buildings > 0) insights.push({ color:'bg-gray-50 border-gray-200', text:`📋 Property value (Buildings): ${fmt(k.buildings)} | Outstanding loans: ${fmt(k.longTermLoans)} | LTV: ${ltv.toFixed(1)}% — ${ltvLabel}` });

  return (
    <div className="space-y-6">
      {/* Section A: 5-Year Snapshot */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-900 text-white px-4 py-2 text-sm font-bold">5-Year Financial Snapshot</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Year','Total Revenue','Total Expenses','Net Income','NOI','Net Margin %'].map(h => (
                  <th key={h} className={`px-4 py-2 font-semibold text-gray-600 ${h==='Year'?'text-left':'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshotRows.map((r,i) => (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-bold">{r.year}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(r.revenue)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">{fmt(r.expenses)}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${r.netIncome>=0?'text-green-700':'text-red-600'}`}>{fmt(r.netIncome)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${r.noi>=0?'text-blue-700':'text-red-600'}`}>{fmt(r.noi)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${r.margin>=0?'text-green-700':'text-red-600'}`}>{r.margin.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sections B + C */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Revenue Breakdown by Year</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={revChart} margin={{ left:10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize:10 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize:9 }} />
              <Tooltip formatter={(v:number) => fmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize:10 }} />
              <Bar dataKey="Rental Income" stackId="a" fill={CC[0]} />
              <Bar dataKey="Other Income"  stackId="a" fill={CC[1]} />
              <Bar dataKey="Services"      stackId="a" fill={CC[3]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
          <p className="text-sm font-semibold text-gray-700 mb-3">Expense Breakdown ({lastY})</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={expPie} cx="50%" cy="50%" outerRadius={75} dataKey="value">
                {expPie.map((_,i) => <Cell key={i} fill={CC[i % CC.length]} />)}
              </Pie>
              <Tooltip formatter={(v:number) => fmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize:10 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Section D: CFO Insights */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">CFO Insights</p>
        {insights.length === 0
          ? <p className="text-sm text-gray-400">Upload complete financials to generate CFO insights.</p>
          : insights.map((ins, i) => (
              <div key={i} className={`border rounded-lg p-4 ${ins.color}`}>
                <p className="text-sm text-gray-800">{ins.text}</p>
              </div>
            ))
        }
      </div>
    </div>
  );
}

// ── All Companies Summary ─────────────────────────────────────────────────────

function AllCompaniesSummary({ all }: { all: Record<string, ParsedFinancials> }) {
  const entries = Object.values(all);
  if (!entries.length) return null;
  return (
    <div className="space-y-3">
      {entries.map((fin, i) => {
        const lastY = fin.years[fin.years.length - 1];
        const k = calcKpis(fin, lastY);
        return (
          <div key={i} className="flex items-center gap-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 text-sm truncate">{fin.companyName}</p>
              <p className="text-xs text-gray-400 truncate">{fin.fileName}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">Revenue ({lastY})</p>
              <p className="font-mono font-bold text-gray-900 text-sm">{fmt(k.totalRevenue)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">Net Income</p>
              <p className={`font-mono font-bold text-sm ${k.netIncome>=0?'text-green-700':'text-red-600'}`}>{fmt(k.netIncome)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">NOI</p>
              <p className={`font-mono font-bold text-sm ${k.noi>=0?'text-blue-700':'text-red-600'}`}>{fmt(k.noi)}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">LTV</p>
              <p className="font-mono font-bold text-gray-700 text-sm">{k.buildings>0?`${(k.longTermLoans/k.buildings*100).toFixed(0)}%`:'—'}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function RentalFinancials() {
  const [selectedCompany, setSelectedCompany] = useState('All Companies');
  const [activeTab, setActiveTab] = useState<FinTab>('P&L Statement');
  const [allFinancials, setAllFinancials] = useState<Record<string,ParsedFinancials>>({});
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loaded: Record<string,ParsedFinancials> = {};
    for (const co of RENTAL_COMPANIES) {
      if (co === 'All Companies') continue;
      try {
        const stored = localStorage.getItem(lsKey(co));
        if (stored) loaded[co] = JSON.parse(stored);
      } catch {}
    }
    if (Object.keys(loaded).length) setAllFinancials(loaded);
  }, []);

  const isAll = selectedCompany === 'All Companies';
  const currentFin = !isAll ? allFinancials[selectedCompany] : null;

  const triggerUpload = useCallback(() => {
    if (isAll) { alert('Please select a specific company before uploading.'); return; }
    fileRef.current?.click();
  }, [isAll]);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isAll) return;
    setUploading(true);
    try {
      const fin = await parseExcel(file, selectedCompany);
      setAllFinancials(prev => {
        const existing = prev[selectedCompany];
        const merged = existing ? {
          ...fin,
          pl:    fin.pl.length    ? fin.pl    : existing.pl,
          bs:    fin.bs.length    ? fin.bs    : existing.bs,
          years: Array.from(new Set([...existing.years, ...fin.years])).sort((a,b)=>a-b),
        } : fin;
        localStorage.setItem(lsKey(selectedCompany), JSON.stringify(merged));
        return { ...prev, [selectedCompany]: merged };
      });
    } catch {
      alert('Failed to parse the Excel file. Please check the format and try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [isAll, selectedCompany]);

  const clearData = useCallback(() => {
    if (!currentFin) return;
    localStorage.removeItem(lsKey(selectedCompany));
    setAllFinancials(prev => { const n={...prev}; delete n[selectedCompany]; return n; });
  }, [selectedCompany, currentFin]);

  return (
    <div className="space-y-6">
      {/* Controls bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm -mx-6 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Building2 size={15} className="text-gray-400 shrink-0" />
          <select
            value={selectedCompany}
            onChange={e => { setSelectedCompany(e.target.value); setActiveTab('P&L Statement'); }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {RENTAL_COMPANIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          {!isAll && (
            <button onClick={triggerUpload} disabled={uploading}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
              <Upload size={14} />{uploading ? 'Parsing…' : 'Upload Excel'}
            </button>
          )}
          {currentFin && (
            <>
              <span className="text-xs text-gray-400">{currentFin.fileName} · {new Date(currentFin.uploadedAt).toLocaleDateString()}</span>
              <button onClick={clearData} className="text-xs text-red-400 hover:text-red-600 transition-colors">Clear</button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {isAll ? (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-emerald-600" />
            <h2 className="text-lg font-bold text-gray-900">All Companies — Portfolio Overview</h2>
          </div>
          <p className="text-gray-400 text-sm mb-6">{Object.keys(allFinancials).length} companies with uploaded data</p>
          {Object.keys(allFinancials).length === 0
            ? <EmptyUpload onUpload={triggerUpload} company="All Companies" />
            : <AllCompaniesSummary all={allFinancials} />
          }
        </div>
      ) : currentFin ? (
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-lg font-bold text-gray-900">{currentFin.companyName}</h1>
              <p className="text-gray-400 text-xs mt-0.5">
                {currentFin.dateRange || `Financial Statements`} · Years: {currentFin.years.join(', ')}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {currentFin.years.map(y => (
                <span key={y} className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">{y}</span>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
            {TABS.map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab===t?'bg-emerald-600 text-white shadow-sm':'text-gray-600 hover:bg-white hover:text-gray-800'}`}>
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            {activeTab === 'P&L Statement' && <PLTable fin={currentFin} />}
            {activeTab === 'Balance Sheet'  && <BSTable fin={currentFin} />}
            {activeTab === 'KPI Dashboard'  && <KPITab  fin={currentFin} />}
            {activeTab === 'CFO Dashboard'  && <CFOTab  fin={currentFin} />}
          </div>
        </div>
      ) : (
        <EmptyUpload onUpload={triggerUpload} company={selectedCompany} />
      )}
    </div>
  );
}
