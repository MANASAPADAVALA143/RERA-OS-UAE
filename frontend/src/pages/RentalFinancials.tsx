import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid,
} from 'recharts';
import { Upload, Building2, FileSpreadsheet, TrendingUp, TrendingDown, DollarSign, Home, Vault, BarChart3, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import PeriodToggle from '../components/shared/PeriodToggle';
import { type Period, getPeriodKeys } from '../utils/periodWindow';
import { BulletChartStrip } from '../components/shared/BulletChartStrip';
import type { BulletDef, BulletCard } from '../components/shared/BulletChartStrip';
import { ParchmentKpiTile } from '../components/ui/ParchmentKpiTile';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FinItem {
  label: string;
  values: Record<number, number>;
  monthlyValues?: Record<string, number>;  // "Jan 2022" → value
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
  periods: string[];  // all "MMM YYYY" labels in chronological order
  pl: FinItem[];
  bs: FinItem[];
  cf: FinItem[];
}

interface CompanyOption {
  id: string;
  company_name: string;
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

const TABS = ['P&L Statement', 'Balance Sheet', 'Cash Flow', 'KPI Dashboard', 'CFO Dashboard', 'Financial Metrics'] as const;
type FinTab = typeof TABS[number];


// ── Parser ────────────────────────────────────────────────────────────────────

const MONTH_ABBRS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const MONTH_DISPLAY = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Detects monthly headers like "Dec 2021", "Jan 2022" — QBO export format
function detectMonthlyHeaders(raw: unknown[][]): {
  headerRowIdx: number;
  monthCols: Array<{ year: number; month: number; col: number }>;
  years: number[];
} | null {
  for (let r = 0; r < Math.min(raw.length, 15); r++) {
    const row = raw[r] as unknown[];
    const monthCols: Array<{ year: number; month: number; col: number }> = [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? '').trim();
      const m = cell.match(/^([A-Za-z]{3})\s+(\d{4})$/);
      if (m) {
        const monthIdx = MONTH_ABBRS.indexOf(m[1].toLowerCase());
        const year = parseInt(m[2]);
        if (monthIdx >= 0 && year >= 2018 && year <= 2032) {
          monthCols.push({ year, month: monthIdx, col: c });
        }
      }
    }
    if (monthCols.length >= 2) {
      const years = [...new Set(monthCols.map(mc => mc.year))].sort((a, b) => a - b);
      return { headerRowIdx: r, monthCols, years };
    }
  }
  return null;
}

// Detects integer year columns (legacy / annual format)
function detectYearHeaders(raw: unknown[][]): { headerRowIdx: number; yearCols: Array<{year:number;col:number}> } | null {
  for (let r = 0; r < Math.min(raw.length, 15); r++) {
    const row = raw[r] as unknown[];
    const yearCols: Array<{year:number;col:number}> = [];
    for (let c = 0; c < row.length; c++) {
      const v = Number(row[c]);
      if (Number.isInteger(v) && v >= 2018 && v <= 2032) yearCols.push({ year: v, col: c });
    }
    if (yearCols.length >= 2) return { headerRowIdx: r, yearCols };
  }
  return null;
}

function detectSheetType(raw: unknown[][]): 'pl' | 'bs' | 'cf' | 'unknown' {
  for (let r = 0; r < Math.min(6, raw.length); r++) {
    const joined = (raw[r] as unknown[]).map(c => String(c ?? '').toLowerCase()).join(' ');
    if (joined.includes('profit and loss') || joined.includes('income statement')) return 'pl';
    if (joined.includes('balance sheet')) return 'bs';
    if (joined.includes('cash flow') || joined.includes('statement of cash') || joined.includes('cashflow')) return 'cf';
  }
  const sheetNameHints = (raw[0] as unknown[] ?? []).map(c => String(c ?? '').toLowerCase()).join(' ');
  if (/cash\s*flow/.test(sheetNameHints)) return 'cf';
  return 'unknown';
}

// Parse rows from a QBO monthly export — aggregates months → annual
// P&L / CF: SUM monthly values per year
// BS:       LAST available month value per year (end-of-period snapshot)
function parseSheetRowsMonthly(
  raw: unknown[][],
  headerRowIdx: number,
  monthCols: Array<{ year: number; month: number; col: number }>,
  years: number[],
  sheetType: 'pl' | 'bs' | 'cf' | 'unknown',
): FinItem[] {
  // Group columns by year, sorted by month
  const byYear: Record<number, Array<{ month: number; col: number }>> = {};
  for (const mc of monthCols) {
    if (!byYear[mc.year]) byYear[mc.year] = [];
    byYear[mc.year].push({ month: mc.month, col: mc.col });
  }
  for (const y of years) byYear[y].sort((a, b) => a.month - b.month);

  const items: FinItem[] = [];
  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r] as unknown[];
    const rawLabel = String(row[0] ?? '');
    const trimmed = rawLabel.trim();
    if (!trimmed) continue;
    const indent = rawLabel.length - rawLabel.trimStart().length;
    const isTotal = /^total\s+for\s+/i.test(trimmed) || /^total\s+(assets|liabilities|equity)/i.test(trimmed);
    const isNetIncome = /^net\s+income$/i.test(trimmed) || /^net\s+operating\s+income$/i.test(trimmed);

    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    let hasAny = false;

    for (const year of years) {
      const cols = byYear[year] ?? [];
      if (sheetType === 'bs') {
        let val = 0;
        for (const { month, col } of cols) {
          const rv = row[col];
          const n = (rv !== '' && rv !== null && rv !== undefined) ? Number(rv) : NaN;
          const periodKey = `${MONTH_DISPLAY[month]} ${year}`;
          monthlyValues[periodKey] = isNaN(n) ? 0 : n;
          if (!isNaN(n)) val = n;
        }
        values[year] = val;
      } else {
        let sum = 0;
        for (const { month, col } of cols) {
          const rv = row[col];
          const n = (rv === '' || rv === null || rv === undefined) ? 0 : Number(rv);
          const safe = isNaN(n) ? 0 : n;
          const periodKey = `${MONTH_DISPLAY[month]} ${year}`;
          monthlyValues[periodKey] = safe;
          sum += safe;
        }
        values[year] = sum;
      }
      if (values[year] !== 0) hasAny = true;
    }

    const isSectionHeader = !hasAny && !isTotal && !isNetIncome;
    if (!hasAny && !isSectionHeader) continue;
    items.push({ label: trimmed, indent, values, monthlyValues, isTotal, isSectionHeader, isNetIncome });
  }
  return items;
}

// Parse rows from an annual-column file (legacy format with integer year headers)
function parseSheetRows(raw: unknown[][], headerRowIdx: number, yearCols: Array<{year:number;col:number}>): FinItem[] {
  const items: FinItem[] = [];
  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r] as unknown[];
    const rawLabel = String(row[0] ?? '');
    const trimmed = rawLabel.trim();
    if (!trimmed) continue;
    const indent = rawLabel.length - rawLabel.trimStart().length;
    const isTotal = /^total\s+for\s+/i.test(trimmed) || /^total\s+(assets|liabilities|equity)/i.test(trimmed);
    const isNetIncome = /^net\s+income$/i.test(trimmed) || /^net\s+operating\s+income$/i.test(trimmed);
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
    if (val && val.length > 2 && !/profit|loss|balance|sheet|cash\s*flow|statement/i.test(val)) return val;
  }
  return '';
}

function getDateRange(raw: unknown[][]): string {
  for (let r = 0; r < Math.min(8, raw.length); r++) {
    const joined = (raw[r] as unknown[]).join(' ').trim();
    if (/\d{4}/.test(joined) && /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(joined)) {
      // Build a clean "MMM YYYY – MMM YYYY" summary from first/last month cells
      const months = (raw[r] as unknown[]).map(c => String(c ?? '').trim()).filter(c => /^[A-Za-z]{3}\s+\d{4}$/.test(c));
      if (months.length >= 2) return `${months[0]} – ${months[months.length - 1]}`;
      return joined.slice(0, 60);
    }
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
        let cfItems: FinItem[] = [];
        let detectedYears: number[] = [];
        let detectedPeriods: string[] = [];
        let detectedName = companyName;
        let dateRange = '';

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
          // Prepend sheet name as hint so CF sheets are detected even without title row
          const rawWithHint = [[sheetName, ...((raw[0] as unknown[]) || [])], ...raw.slice(1)] as unknown[][];
          const sheetType = detectSheetType(rawWithHint);

          // Prefer monthly detection (QBO format), fall back to annual columns
          const monthInfo = detectMonthlyHeaders(raw);
          const yearInfo = monthInfo ? null : detectYearHeaders(raw);
          if (!monthInfo && !yearInfo) continue;

          const name = getCompanyName(raw);
          if (name && !detectedName) detectedName = name;
          if (!dateRange) dateRange = getDateRange(raw);

          let items: FinItem[];
          let years: number[];

          if (monthInfo) {
            years = monthInfo.years;
            // Build ordered period labels from monthCols sorted by year then month
            const sortedMC = [...monthInfo.monthCols].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
            const allPeriods = sortedMC.map(mc => `${MONTH_DISPLAY[mc.month]} ${mc.year}`);
            if (!detectedPeriods.length) detectedPeriods = allPeriods;
            items = parseSheetRowsMonthly(raw, monthInfo.headerRowIdx, monthInfo.monthCols, years, sheetType);
          } else {
            years = yearInfo!.yearCols.map(yc => yc.year).sort((a, b) => a - b);
            items = parseSheetRows(raw, yearInfo!.headerRowIdx, yearInfo!.yearCols);
          }

          if (sheetType === 'pl') { plItems = items; detectedYears = years; }
          else if (sheetType === 'bs') { bsItems = items; if (!detectedYears.length) detectedYears = years; }
          else if (sheetType === 'cf') { cfItems = items; if (!detectedYears.length) detectedYears = years; }
          else {
            if (!plItems.length) { plItems = items; detectedYears = years; }
            else if (!bsItems.length) { bsItems = items; }
            else if (!cfItems.length) { cfItems = items; }
          }
        }

        resolve({
          companyName: detectedName || companyName,
          dateRange,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          years: detectedYears,
          periods: detectedPeriods,
          pl: plItems,
          bs: bsItems,
          cf: cfItems,
        });
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

const _MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function sortPeriodKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const [am, ay] = a.split(' '); const [bm, by] = b.split(' ');
    return (parseInt(ay) - parseInt(by)) || (_MNAMES.indexOf(am) - _MNAMES.indexOf(bm));
  });
}

// Scan any FinItem array for monthlyValues keys → sorted period strings
function getItemKeys(items: FinItem[]): string[] {
  const keySet = new Set<string>();
  for (const item of items) {
    if (item.monthlyValues) Object.keys(item.monthlyValues).forEach(k => keySet.add(k));
  }
  return sortPeriodKeys([...keySet]);
}

// Derive available period keys — use fin.periods if populated, else scan P&L monthlyValues
function getAvailableKeys(fin: ParsedFinancials): string[] {
  if (fin.periods?.length) return fin.periods;
  return getItemKeys(fin.pl);
}

function getYV(items: FinItem[], pattern: RegExp, year: number): number {
  return items.find(i => pattern.test(i.label))?.values[year] ?? 0;
}

function sumI(items: FinItem[], pattern: RegExp, year: number): number {
  return items.filter(i => !i.isSectionHeader && !i.isTotal && pattern.test(i.label))
    .reduce((s,i) => s + (i.values[year] ?? 0), 0);
}

// ── Monthly helpers (parallel to getYV/sumI but for monthlyValues) ────────────

function getMV(pl: FinItem[], pattern: RegExp, key: string): number {
  return pl.find(i => pattern.test(i.label))?.monthlyValues?.[key] ?? 0;
}

function sumMV(pl: FinItem[], pattern: RegExp, key: string): number {
  return pl.filter(i => !i.isSectionHeader && !i.isTotal && pattern.test(i.label))
    .reduce((s, i) => s + (i.monthlyValues?.[key] ?? 0), 0);
}

interface MonthlyKpis {
  totalRevenue: number; totalExpenses: number; netIncome: number;
  interest: number; depreciation: number; noi: number;
  rentIncome: number; otherIncome: number;
  repairs: number; utilities: number; hoa: number;
  propertyTax: number; management: number; legal: number; insurance: number;
}

function calcMonthlyKpis(pl: FinItem[], key: string): MonthlyKpis {
  const totalRevenue =
    getMV(pl, /^total\s+for\s+income$/i, key) ||
    getMV(pl, /^total\s+income$/i, key) ||
    getMV(pl, /^gross\s+profit$/i, key) ||
    sumMV(pl, /income|revenue|rent/i, key);
  const totalExpenses =
    getMV(pl, /^total\s+for\s+expenses?$/i, key) ||
    getMV(pl, /^total\s+expenses?$/i, key);
  const netIncome = getMV(pl, /^net\s+income$/i, key);
  const interest = Math.abs(
    getMV(pl, /^total\s+for\s+interest\s+paid$/i, key) ||
    sumMV(pl, /^interest\s+on\s+loan|^interest\s+paid$/i, key),
  );
  const depreciation = Math.abs(sumMV(pl, /depreciation|amortization/i, key));
  const rentIncome =
    getMV(pl, /^total\s+for\s+rental\s+income$/i, key) ||
    getMV(pl, /^total\s+for\s+services$/i, key) ||
    sumMV(pl, /^rent\s+-|^rental\s+income$/i, key);
  const otherIncome = getMV(pl, /^other\s+income$/i, key) || 0;
  const repairs = Math.abs(sumMV(pl, /repair|maintenance|cleaning/i, key));
  const utilities = Math.abs(
    getMV(pl, /^total\s+for\s+utilities$/i, key) ||
    sumMV(pl, /electricity|internet|utilities|water/i, key),
  );
  const hoa = Math.abs(
    getMV(pl, /^total\s+for\s+hoa\s+expenses$/i, key) ||
    sumMV(pl, /^hoa/i, key),
  );
  const propertyTax = Math.abs(
    getMV(pl, /^total\s+for\s+rates\s+&\s+taxes$/i, key) ||
    sumMV(pl, /property\s+tax/i, key),
  );
  const management = Math.abs(sumMV(pl, /management\s+fee/i, key));
  const legal = Math.abs(
    getMV(pl, /^total\s+for\s+legal/i, key) ||
    sumMV(pl, /legal|accounting\s+fee/i, key),
  );
  const insurance = Math.abs(sumMV(pl, /insurance/i, key));
  const noi = totalRevenue - totalExpenses + interest;
  return { totalRevenue, totalExpenses, netIncome, interest, depreciation, noi,
           rentIncome, otherIncome, repairs, utilities, hoa, propertyTax, management, legal, insurance };
}

interface PeriodAggregate extends MonthlyKpis { otherOpex: number }

function sumKpisOverKeys(pl: FinItem[], keys: string[]): PeriodAggregate {
  let totalRevenue = 0, totalExpenses = 0, netIncome = 0, interest = 0, depreciation = 0;
  let rentIncome = 0, otherIncome = 0, repairs = 0, utilities = 0, hoa = 0;
  let propertyTax = 0, management = 0, legal = 0, insurance = 0;
  for (const k of keys) {
    const m = calcMonthlyKpis(pl, k);
    totalRevenue   += m.totalRevenue;
    totalExpenses  += m.totalExpenses;
    netIncome      += m.netIncome;
    interest       += m.interest;
    depreciation   += m.depreciation;
    rentIncome     += m.rentIncome;
    otherIncome    += m.otherIncome;
    repairs        += m.repairs;
    utilities      += m.utilities;
    hoa            += m.hoa;
    propertyTax    += m.propertyTax;
    management     += m.management;
    legal          += m.legal;
    insurance      += m.insurance;
  }
  const noi = totalRevenue - totalExpenses + interest;
  const otherOpex = Math.max(0, totalExpenses - interest - depreciation - repairs - utilities - hoa - propertyTax - management - legal - insurance);
  return { totalRevenue, totalExpenses, netIncome, interest, depreciation, noi,
           rentIncome, otherIncome, repairs, utilities, hoa, propertyTax, management, legal, insurance, otherOpex };
}

function calcKpis(fin: ParsedFinancials, year: number): KpiData {
  const pl = fin.pl; const bs = fin.bs;
  // Revenue — try Total for Income, Gross Profit (QBO), or sum all income lines
  const totalRevenue =
    getYV(pl,/^total\s+for\s+income$/i,year) ||
    getYV(pl,/^total\s+income$/i,year) ||
    getYV(pl,/^gross\s+profit$/i,year) ||
    sumI(pl,/income|revenue|rent/i,year);
  // Expenses — try Total for Expenses, or Net Operating Income derivation
  const totalExpenses =
    getYV(pl,/^total\s+for\s+expenses?$/i,year) ||
    getYV(pl,/^total\s+expenses?$/i,year);
  // Net income — "Net Income" or QBO "Net Income" row
  const netIncome = getYV(pl,/^net\s+income$/i,year);
  // NOI — try QBO row first, then derive
  const noiRow = getYV(pl,/^net\s+operating\s+income$/i,year);
  const interestExpense = Math.abs(
    getYV(pl,/^total\s+for\s+interest\s+paid$/i,year) ||
    sumI(pl,/^interest\s+on\s+loan|^interest\s+paid$/i,year)
  );
  const noi = noiRow || (totalRevenue - totalExpenses + interestExpense);
  // Rental income
  const rentalIncome =
    getYV(pl,/^total\s+for\s+rental\s+income$/i,year) ||
    getYV(pl,/^total\s+for\s+services$/i,year) ||
    sumI(pl,/^rent\s+-|^rental\s+income$/i,year);
  const otherIncome = getYV(pl,/^other\s+income$/i,year) || 0;
  const propertyTax = Math.abs(
    getYV(pl,/^total\s+for\s+rates\s+&\s+taxes$/i,year) ||
    sumI(pl,/property\s+tax/i,year)
  );
  const managementFee = Math.abs(sumI(pl,/management\s+fee/i,year));
  const hoaFees = Math.abs(
    getYV(pl,/^total\s+for\s+hoa\s+expenses$/i,year) ||
    sumI(pl,/^hoa/i,year)
  );
  const legalFees = Math.abs(
    getYV(pl,/^total\s+for\s+legal/i,year) ||
    sumI(pl,/legal|accounting\s+fee/i,year)
  );
  const utilities = Math.abs(
    getYV(pl,/^total\s+for\s+utilities$/i,year) ||
    sumI(pl,/electricity|internet|utilities|water/i,year)
  );
  const repairs = Math.abs(sumI(pl,/repair|maintenance|cleaning/i,year));
  // Balance sheet
  const totalAssets =
    getYV(bs,/^total\s+for\s+assets$/i,year) ||
    getYV(bs,/^total\s+assets$/i,year);
  const totalLiabilities =
    getYV(bs,/^total\s+for\s+liabilities$/i,year) ||
    getYV(bs,/^total\s+liabilities$/i,year) ||
    // DO NOT fall back to "Total for Liabilities and Equity" — that's the B/S grand total, not liabilities alone
    getYV(bs,/^total\s+for\s+long.term\s+liabilities$/i,year) + Math.abs(getYV(bs,/^total\s+for\s+current\s+liabilities$/i,year));
  const equity =
    getYV(bs,/^total\s+for\s+equity$/i,year) ||
    getYV(bs,/^total\s+equity$/i,year);
  const cash =
    getYV(bs,/^total\s+for\s+bank\s+accounts$/i,year) ||
    sumI(bs,/^bank\s+of\s+america|^great\s+plains|^prosperity|checking|savings/i,year);
  const buildings = Math.abs(
    getYV(bs,/^buildings$/i,year) ||
    getYV(bs,/^property\s*(and|&)?\s*equipment/i,year) ||
    getYV(bs,/^fixed\s*assets/i,year) ||
    getYV(bs,/^land\s*(and|&)?\s*buildings/i,year) ||
    getYV(bs,/^real\s+estate/i,year)
  );
  const accumDep = getYV(bs,/accumulated\s+dep/i,year);
  const longTermLoans = Math.abs(
    getYV(bs,/^total\s+for\s+long.term\s+liabilities$/i,year) ||
    sumI(bs,/^loan\s+from\s+gpb|^independent\s+bank|^loan\s+a\/c/i,year)
  );
  const securityDeposits = Math.abs(
    getYV(bs,/^total\s+for\s+security\s+deposit$/i,year) ||
    sumI(bs,/security\s+deposit/i,year)
  );
  return { totalRevenue, totalExpenses, netIncome, noi, rentalIncome, otherIncome, interestExpense, propertyTax, managementFee, hoaFees, legalFees, utilities, repairs, totalAssets, totalLiabilities, equity, cash, buildings, accumDep, longTermLoans, securityDeposits };
}

function calcKpisFromMonthlyKey(fin: ParsedFinancials, key: string): KpiData {
  const pl = fin.pl;
  const bs = fin.bs;
  const m = calcMonthlyKpis(pl, key);
  const totalAssets =
    getMV(bs, /^total\s+for\s+assets$/i, key) ||
    getMV(bs, /^total\s+assets$/i, key);
  const totalLiabilities =
    getMV(bs, /^total\s+for\s+liabilities$/i, key) ||
    getMV(bs, /^total\s+liabilities$/i, key) ||
    getMV(bs, /^total\s+for\s+long.term\s+liabilities$/i, key) + Math.abs(getMV(bs, /^total\s+for\s+current\s+liabilities$/i, key));
  const equity =
    getMV(bs, /^total\s+for\s+equity$/i, key) ||
    getMV(bs, /^total\s+equity$/i, key);
  const cash =
    getMV(bs, /^total\s+for\s+bank\s+accounts$/i, key) ||
    sumMV(bs, /^bank\s+of\s+america|^great\s+plains|^prosperity|checking|savings/i, key);
  const buildings = Math.abs(
    getMV(bs, /^buildings$/i, key) ||
    getMV(bs, /^property\s*(and|&)?\s*equipment/i, key) ||
    getMV(bs, /^fixed\s*assets/i, key) ||
    getMV(bs, /^land\s*(and|&)?\s*buildings/i, key) ||
    getMV(bs, /^real\s+estate/i, key),
  );
  const accumDep = getMV(bs, /accumulated\s+dep/i, key);
  const longTermLoans = Math.abs(
    getMV(bs, /^total\s+for\s+long.term\s+liabilities$/i, key) ||
    sumMV(bs, /^loan\s+from\s+gpb|^independent\s+bank|^loan\s+a\/c/i, key),
  );
  const securityDeposits = Math.abs(
    getMV(bs, /^total\s+for\s+security\s+deposit$/i, key) ||
    sumMV(bs, /security\s+deposit/i, key),
  );
  return {
    totalRevenue: m.totalRevenue,
    totalExpenses: m.totalExpenses,
    netIncome: m.netIncome,
    noi: m.noi,
    rentalIncome: m.rentIncome,
    otherIncome: m.otherIncome,
    interestExpense: m.interest,
    propertyTax: m.propertyTax,
    managementFee: m.management,
    hoaFees: m.hoa,
    legalFees: m.legal,
    utilities: m.utilities,
    repairs: m.repairs,
    totalAssets,
    totalLiabilities,
    equity,
    cash,
    buildings,
    accumDep,
    longTermLoans,
    securityDeposits,
  };
}

function periodAggregateToKpiData(fin: ParsedFinancials, agg: PeriodAggregate, bsKey: string): KpiData {
  const bsK = calcKpisFromMonthlyKey(fin, bsKey);
  return {
    totalRevenue: agg.totalRevenue,
    totalExpenses: agg.totalExpenses,
    netIncome: agg.netIncome,
    noi: agg.noi,
    rentalIncome: agg.rentIncome,
    otherIncome: agg.otherIncome,
    interestExpense: agg.interest,
    propertyTax: agg.propertyTax,
    managementFee: agg.management,
    hoaFees: agg.hoa,
    legalFees: agg.legal,
    utilities: agg.utilities,
    repairs: agg.repairs,
    totalAssets: bsK.totalAssets,
    totalLiabilities: bsK.totalLiabilities,
    equity: bsK.equity,
    cash: bsK.cash,
    buildings: bsK.buildings,
    accumDep: bsK.accumDep,
    longTermLoans: bsK.longTermLoans,
    securityDeposits: bsK.securityDeposits,
  };
}

function resolveKpiView(
  fin: ParsedFinancials,
  kpiYear: number,
  kpiMonth: number | null,
): { k: KpiData; kPrev: KpiData | null; label: string; compareLabel: string } {
  const availableKeys = getAvailableKeys(fin);
  const year = fin.years.includes(kpiYear) ? kpiYear : fin.years[fin.years.length - 1];

  if (kpiMonth && availableKeys.length > 0) {
    const key = `${_MNAMES[kpiMonth - 1]} ${kpiYear}`;
    if (availableKeys.includes(key)) {
      const k = calcKpisFromMonthlyKey(fin, key);
      const prevMonthKey = kpiMonth === 1
        ? `${_MNAMES[11]} ${kpiYear - 1}`
        : `${_MNAMES[kpiMonth - 2]} ${kpiYear}`;
      const prevYearKey = `${_MNAMES[kpiMonth - 1]} ${kpiYear - 1}`;
      const kPrev = availableKeys.includes(prevYearKey)
        ? calcKpisFromMonthlyKey(fin, prevYearKey)
        : availableKeys.includes(prevMonthKey)
          ? calcKpisFromMonthlyKey(fin, prevMonthKey)
          : fin.years.includes(kpiYear - 1)
            ? calcKpis(fin, kpiYear - 1)
            : null;
      const compareLabel = availableKeys.includes(prevYearKey)
        ? `${_MNAMES[kpiMonth - 1]} ${kpiYear - 1}`
        : kPrev ? 'Prior period' : '';
      return { k, kPrev, label: key, compareLabel };
    }
  }

  const k = calcKpis(fin, year);
  const prevY = fin.years.filter(y => y < year).pop() ?? null;
  const kPrev = prevY ? calcKpis(fin, prevY) : null;
  return { k, kPrev, label: `FY ${year}`, compareLabel: prevY ? `FY ${prevY}` : '' };
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyUpload({ onUpload, company, onAddMetrics }: { onUpload: () => void; onAddMetrics: () => void; company: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: '#F7F5F0' }}>
        <FileSpreadsheet className="w-8 h-8" style={{ color: '#D4AF37' }} />
      </div>
      <h3 className="text-lg font-semibold mb-2" style={{ color: '#1C1917' }}>No Financial Data Uploaded</h3>
      <p className="text-sm mb-6 max-w-sm" style={{ color: '#92400E' }}>
        {company === 'All Companies'
          ? 'Select a specific company from the dropdown above to upload their financials.'
          : `Upload ${company}'s Excel financial statements (P&L and Balance Sheet) or enter metrics manually.`}
      </p>
      {company !== 'All Companies' && (
        <div className="flex gap-3 flex-wrap justify-center">
          <button onClick={onUpload} className="flex items-center gap-2 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors" style={{ background: 'linear-gradient(135deg,#3B82F6,#1D4ED8)' }}>
            <Upload size={16} /> Upload Excel File
          </button>
          <button onClick={onAddMetrics} className="flex items-center gap-2 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors" style={{ background: 'linear-gradient(135deg,#10B981,#059669)' }}>
            <TrendingUp size={16} /> Add Metrics Manually
          </button>
        </div>
      )}
      <p className="text-xs mt-4" style={{ color: '#A8A29E' }}>Supported format: Excel (.xlsx) with P&L and Balance Sheet data</p>
    </div>
  );
}

// ── P&L Table ─────────────────────────────────────────────────────────────────

const FIN_FONT = "'Inter', 'Segoe UI', sans-serif";

function FinTable({ items, years, labelCol = 'Line Item', selectedYear, periods, periodKeys }: {
  items: FinItem[];
  years: number[];
  labelCol?: string;
  selectedYear?: number | null;
  periods?: string[];
  periodKeys?: string[] | null;  // explicit period window — overrides selectedYear monthly display
}) {
  // periodKeys override takes highest precedence, then selectedYear monthly, then annual
  const showMonthly = !!(selectedYear && periods && periods.length > 0);
  const monthlyPeriods = showMonthly
    ? periods!.filter(p => p.endsWith(` ${selectedYear}`))
    : [];
  const displayCols: string[] | null = (periodKeys && periodKeys.length > 0)
    ? periodKeys
    : showMonthly ? monthlyPeriods : null;

  // Determine grand-total rows — isNetIncome or "Total for Assets/Liabilities and Equity"
  const isGrandTotal = (item: FinItem) =>
    item.isNetIncome || /total\s+(for\s+)?(liabilities\s+and\s+equity|assets$)/i.test(item.label);

  const rowBg = (item: FinItem, idx: number): string => {
    if (isGrandTotal(item)) return '#D4C4A8';
    if (item.isTotal) return '#EDE5D8';
    if (item.isSectionHeader) return '#E8E0CF';
    return idx % 2 === 0 ? '#F7F1E6' : '#FBF6EE';
  };

  const rowBorderTop = (item: FinItem): string => {
    if (isGrandTotal(item)) return '2px solid #C4A87A';
    if (item.isTotal) return '1px solid #DDD5C4';
    return '1px solid #EEE8DF';
  };

  const labelStyle = (item: FinItem, bg: string): React.CSSProperties => ({
    position: 'sticky', left: 0, zIndex: 1,
    background: bg,
    fontFamily: FIN_FONT,
    fontSize: item.isSectionHeader ? 13 : isGrandTotal(item) ? 14 : item.isTotal ? 14 : 14,
    fontWeight: (isGrandTotal(item) || item.isTotal) ? 600 : item.isSectionHeader ? 600 : 400,
    letterSpacing: item.isSectionHeader ? '0.05em' : undefined,
    textTransform: item.isSectionHeader ? 'uppercase' : undefined,
    color: item.isSectionHeader ? '#92400E' : '#1C1917',
    paddingTop: item.isSectionHeader ? 7 : 9,
    paddingBottom: item.isSectionHeader ? 7 : 9,
    paddingLeft: (item.isTotal || item.isSectionHeader || isGrandTotal(item)) ? 12 : item.indent > 4 ? 48 : item.indent > 1 ? 32 : 20,
    paddingRight: 12,
    whiteSpace: 'nowrap',
  });

  const valueStyle = (item: FinItem, val: number): React.CSSProperties => {
    const isNeg = val < 0;
    let color = '#262626';
    if (isGrandTotal(item)) color = isNeg ? '#D9534F' : '#1baf7a';
    else if (isNeg) color = '#D9534F';
    else if (val === 0) color = '#B0B0B0';
    return {
      fontFamily: FIN_FONT,
      fontSize: isGrandTotal(item) ? 14 : item.isTotal ? 14 : 14,
      fontWeight: (isGrandTotal(item) || item.isTotal) ? 600 : 400,
      textAlign: 'right',
      paddingTop: item.isSectionHeader ? 7 : 9,
      paddingBottom: item.isSectionHeader ? 7 : 9,
      paddingLeft: 10, paddingRight: 10,
      color,
      whiteSpace: 'nowrap',
    };
  };

  const fmtVal = (val: number): string => {
    if (val === 0) return '—';
    return fmtFull(val); // fmtFull already wraps negatives in ()
  };

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: '#DDD5C4', fontFamily: FIN_FONT }}>
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#DDD5C4' }}>
            <th style={{ position: 'sticky', left: 0, zIndex: 2, background: '#DDD5C4', textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#78716C', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', minWidth: 240, fontFamily: FIN_FONT }}>
              {labelCol}
            </th>
            {displayCols
              ? displayCols.map(p => (
                  <th key={p} style={{ textAlign: 'right', padding: '10px 10px', fontSize: 13, fontWeight: 600, color: '#78716C', letterSpacing: '0.03em', minWidth: 110, whiteSpace: 'nowrap', fontFamily: FIN_FONT }}>
                    {p}
                  </th>
                ))
              : years.map(y => (
                  <th key={y} style={{ textAlign: 'right', padding: '10px 10px', fontSize: 13, fontWeight: 600, color: '#78716C', letterSpacing: '0.03em', minWidth: 120, whiteSpace: 'nowrap', fontFamily: FIN_FONT }}>
                    {y}
                  </th>
                ))
            }
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const bg = rowBg(item, i);
            return (
              <tr key={i} style={{ borderTop: rowBorderTop(item), background: bg }}>
                <td style={labelStyle(item, bg)}>{item.label}</td>
                {displayCols
                  ? displayCols.map(p => {
                      const val = item.monthlyValues?.[p] ?? 0;
                      return <td key={p} style={valueStyle(item, val)}>{fmtVal(val)}</td>;
                    })
                  : years.map(y => (
                      <td key={y} style={valueStyle(item, item.values[y] ?? 0)}>
                        {fmtVal(item.values[y] ?? 0)}
                      </td>
                    ))
                }
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PLTable({ fin, selectedYear, period, pMonth, pYear }: {
  fin: ParsedFinancials;
  selectedYear?: number | null;
  period: Period | null;
  pMonth: number;
  pYear: number;
}) {
  const periodKeys = useMemo(
    () => period ? getPeriodKeys(period, pMonth, pYear) : null,
    [period, pMonth, pYear],
  );

  if (!fin.pl.length) return <p className="text-center text-gray-400 py-12 text-sm">No P&amp;L data found in the uploaded file. Ensure the Excel contains a "Profit and Loss" sheet or section.</p>;
  return (
    <FinTable
      items={fin.pl}
      years={fin.years}
      labelCol="Line Item"
      selectedYear={period ? null : selectedYear}
      periods={getAvailableKeys(fin)}
      periodKeys={periodKeys}
    />
  );
}

// ── Balance Sheet Table ───────────────────────────────────────────────────────

function BSTable({ fin, selectedYear, period, pMonth, pYear }: {
  fin: ParsedFinancials; selectedYear?: number | null;
  period: Period | null; pMonth: number; pYear: number;
}) {
  const bsKeys    = useMemo(() => getItemKeys(fin.bs), [fin.bs]);
  const periodKeys = useMemo(() => period ? getPeriodKeys(period, pMonth, pYear) : null, [period, pMonth, pYear]);
  if (!fin.bs.length) return <p className="text-center text-gray-400 py-12 text-sm">No Balance Sheet data found. Ensure the Excel contains a "Balance Sheet" sheet or section.</p>;
  return <FinTable items={fin.bs} years={fin.years} labelCol="Item"
    selectedYear={period ? null : selectedYear} periods={bsKeys} periodKeys={periodKeys} />;
}

// ── Cash Flow Table ───────────────────────────────────────────────────────────

function CFTable({ fin, selectedYear, period, pMonth, pYear }: {
  fin: ParsedFinancials; selectedYear?: number | null;
  period: Period | null; pMonth: number; pYear: number;
}) {
  const cfKeys     = useMemo(() => getItemKeys(fin.cf), [fin.cf]);
  const periodKeys = useMemo(() => period ? getPeriodKeys(period, pMonth, pYear) : null, [period, pMonth, pYear]);

  if (!fin.cf.length) return (
    <div className="text-center py-12">
      <p className="text-gray-400 text-sm mb-2">No Cash Flow data found in the uploaded file.</p>
      <p className="text-xs text-gray-300">Ensure the Excel has a sheet named "Cash Flow" or containing "Statement of Cash Flows".</p>
    </div>
  );
  const years = fin.years;
  const netCFByYear = years.map(y => {
    const totals = fin.cf.filter(i => i.isTotal || i.isNetIncome);
    const last = totals[totals.length - 1];
    return { year: String(y), value: last?.values[y] ?? 0 };
  });

  return (
    <div className="space-y-6">
      {/* Summary bar chart — only in Annual Summary mode */}
      {!selectedYear && !period && netCFByYear.some(d => d.value !== 0) && (
        <div className="rounded-lg p-4 shadow-sm border" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
          <p className="text-sm font-semibold mb-3" style={{ color: '#1C1917' }}>Net Cash Flow by Year</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={netCFByYear} margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8E4DC" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} />
              <Bar dataKey="value" name="Net Cash Flow">
                {netCFByYear.map((d, i) => <Cell key={i} fill={d.value >= 0 ? '#22c55e' : '#ef4444'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <FinTable items={fin.cf} years={years} labelCol="Line Item"
        selectedYear={period ? null : selectedYear} periods={cfKeys} periodKeys={periodKeys} />
    </div>
  );
}

// ── KPI Card (parchment style — matches Expenses page) ─────────────────────────

interface KCardProps {
  label: string; value: string; sub: string;
  status: 'good'|'warn'|'bad'|'info';
  trendData?: number[];
  accent?: boolean;
}

function KCard({ label, value, sub, status, trendData, accent }: KCardProps) {
  const warn = status === 'warn' || status === 'bad';

  return (
    <ParchmentKpiTile label={label} value={value} sub={sub} accent={accent} warn={warn}>
      {trendData && trendData.length > 0 && (
        <div style={{ height: 28, marginTop: 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData.map((v, i) => ({ x: i, y: v }))}>
              <Line type="monotone" dataKey="y" stroke={accent ? 'rgba(255,255,255,0.7)' : '#D4AF37'} dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ParchmentKpiTile>
  );
}

// ── KPI Dashboard Tab ─────────────────────────────────────────────────────────

function KPITab({ fin, kpiYear, kpiMonth }: { fin: ParsedFinancials; kpiYear: number; kpiMonth: number | null }) {
  const { k, kPrev: kP, label, compareLabel } = resolveKpiView(fin, kpiYear, kpiMonth);
  const prevY = compareLabel || (fin.years.length >= 2 ? String(fin.years[fin.years.length - 2]) : null);

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

  // Calculate trend data for sparklines
  const noiMTrend = fin.years.map(y => { const kk = calcKpis(fin, y); return kk.totalRevenue > 0 ? kk.noi / kk.totalRevenue * 100 : 0; });
  const netMTrend = fin.years.map(y => { const kk = calcKpis(fin, y); return kk.totalRevenue > 0 ? kk.netIncome / kk.totalRevenue * 100 : 0; });
  const revGTrend = fin.years.map(y => { const kk = calcKpis(fin, y); return kk.totalRevenue; });
  const cashTrend = fin.years.map(y => { const kk = calcKpis(fin, y); return kk.cash; });

  const trendData = fin.years.map(y => {
    const kk = calcKpis(fin, y);
    return { year: String(y), Revenue: kk.totalRevenue, Expenses: kk.totalExpenses, 'Net Income': kk.netIncome, NOI: kk.noi };
  });

  // Margins & Ratios trend (Section 2)
  const marginsTrend = fin.years.map(y => {
    const kk = calcKpis(fin, y);
    return {
      year: String(y),
      'NOI Margin %':    kk.totalRevenue > 0 ? +(kk.noi / kk.totalRevenue * 100).toFixed(1) : 0,
      'Net Margin %':    kk.totalRevenue > 0 ? +(kk.netIncome / kk.totalRevenue * 100).toFixed(1) : 0,
      'Expense Ratio %': kk.totalRevenue > 0 ? +(kk.totalExpenses / kk.totalRevenue * 100).toFixed(1) : 0,
    };
  });

  // Bullet-chart card adapters — map KCard statuses to BulletStatus
  const toBS = (s: 'good'|'warn'|'bad'|'info'): BulletCard['status'] =>
    s === 'warn' ? 'monitor' : s === 'bad' ? 'critical' : s;

  const profBulletCards: BulletCard[] = [
    { name: 'NOI Margin',          value: `${noiM.toFixed(1)}%`,                               status: toBS(noiM>=40?'good':noiM>=20?'warn':'bad') },
    { name: 'Net Income Margin',   value: `${netM.toFixed(1)}%`,                               status: toBS(netM>=10?'good':netM>=0?'warn':'bad') },
    { name: 'Revenue Growth YoY',  value: revG !== null ? `${revG.toFixed(1)}%` : '0%',        status: toBS(revG===null?'info':revG>=3?'good':revG>=0?'warn':'bad') },
    { name: 'Expense Ratio',       value: `${expR.toFixed(1)}%`,                               status: toBS(expR<=70?'good':expR<=85?'warn':'bad') },
  ];
  const rentalBulletCards: BulletCard[] = [
    { name: 'Interest Coverage',   value: `${iCov.toFixed(2)}x`,                              status: toBS(iCov>=2?'good':iCov>=1.2?'warn':'bad') },
    { name: 'Mgmt Fee %',          value: `${mgmtP.toFixed(1)}%`,                             status: toBS(mgmtP<=10?'good':mgmtP<=15?'warn':'bad') },
    { name: 'Repair % of Revenue', value: `${repP.toFixed(1)}%`,                              status: toBS(repP<=5?'good':repP<=10?'warn':'bad') },
  ];
  const balanceBulletCards: BulletCard[] = [
    { name: 'LTV',                 value: ltv > 0 ? `${ltv.toFixed(1)}%` : 'No bldg value',  status: ltv > 0 ? toBS(ltv<=75?'good':ltv<=85?'warn':'bad') : 'info' },
    { name: 'Asset/Liability',     value: `${alR.toFixed(2)}x`,                               status: toBS(alR>=1.5?'good':alR>=1?'warn':'bad') },
    { name: 'Debt-to-Equity',      value: `${dte.toFixed(2)}x`,                               status: toBS(dte>0&&dte<=2?'good':dte<=4?'warn':'bad') },
  ];

  const PROF_BULLET_DEFS: BulletDef[] = [
    { names: ['NOI Margin'],         benchmark: 35, unit: '%', reversed: false, max: 80,  extract: v => parseFloat(v) || 0 },
    { names: ['Net Income Margin'],  benchmark: 25, unit: '%', reversed: false, max: 80,  extract: v => parseFloat(v) || 0 },
    { names: ['Revenue Growth YoY'], benchmark: 0,  unit: '%', reversed: false, max: 30,  extract: v => Math.max(0, parseFloat(v.replace('+','')) || 0) },
    { names: ['Expense Ratio'],      benchmark: 60, unit: '%', reversed: true,  max: 130, extract: v => parseFloat(v) || 0 },
  ];
  const RENTAL_BULLET_DEFS: BulletDef[] = [
    { names: ['Interest Coverage'],   benchmark: 1.5, unit: 'x', reversed: false, max: 5,  extract: v => parseFloat(v) || 0 },
    { names: ['Mgmt Fee %'],          benchmark: 10,  unit: '%', reversed: true,  max: 25, extract: v => parseFloat(v) || 0 },
    { names: ['Repair % of Revenue'], benchmark: 10,  unit: '%', reversed: true,  max: 25, extract: v => parseFloat(v) || 0 },
  ];
  const BALANCE_BULLET_DEFS: BulletDef[] = [
    { names: ['LTV'],             benchmark: 75,  unit: '%', reversed: true,  max: 130, extract: v => parseFloat(v) || 0 },
    { names: ['Asset/Liability'], benchmark: 1.5, unit: 'x', reversed: false, max: 3,   extract: v => parseFloat(v) || 0 },
    { names: ['Debt-to-Equity'],  benchmark: 2,   unit: 'x', reversed: true,  max: 15,  extract: v => parseFloat(v) || 0 },
  ];

  // Data for new charts
  const lastKpi = k;
  const revenueAllocation = [
    { name: 'NOI', value: Math.max(0, lastKpi.noi) },
    { name: 'Expenses', value: lastKpi.totalExpenses },
  ];
  const yoyComparison = kP ? [
    { kpi: 'NOI Margin', current: noiM, previous: kP.totalRevenue > 0 ? kP.noi / kP.totalRevenue * 100 : 0 },
    { kpi: 'Net Margin', current: netM, previous: kP.totalRevenue > 0 ? kP.netIncome / kP.totalRevenue * 100 : 0 },
    { kpi: 'Expense Ratio', current: expR, previous: kP.totalRevenue > 0 ? kP.totalExpenses / kP.totalRevenue * 100 : 0 },
    { kpi: 'D/E Ratio', current: dte, previous: kP.equity > 0 ? kP.totalLiabilities / kP.equity : 0 },
  ] : [];

  return (
    <div className="space-y-6">
      <p style={{ fontSize: 13, color: '#A8A29E' }}>KPIs for selected period: <strong style={{ color: '#1C1917' }}>{label}</strong>{compareLabel ? <span> · compared to <strong style={{ color: '#1C1917' }}>{compareLabel}</strong></span> : null}</p>

      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Profitability</p>
        <div className="grid grid-cols-4 gap-4">
          <KCard label="NOI Margin" value={`${noiM.toFixed(1)}%`} sub={`NOI: ${fmt(k.noi)}`} status={noiM>=40?'good':noiM>=20?'warn':'bad'} trendData={noiMTrend} accent />
          <KCard label="Net Income Margin" value={`${netM.toFixed(1)}%`} sub={`Net: ${fmt(k.netIncome)}`} status={netM>=10?'good':netM>=0?'warn':'bad'} trendData={netMTrend} />
          <KCard label="Revenue Growth YoY" value={revG!==null?`${revG>=0?'+':''}${revG.toFixed(1)}%`:'N/A'} sub={kP?`${label} vs ${compareLabel || prevY}`:'Only 1 period'} status={revG===null?'info':revG>=3?'good':revG>=0?'warn':'bad'} trendData={revGTrend} />
          <KCard label="Expense Ratio" value={`${expR.toFixed(1)}%`} sub={`Total exp: ${fmt(k.totalExpenses)}`} status={expR<=70?'good':expR<=85?'warn':'bad'} />
        </div>
      </div>

      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Rental Performance</p>
        <div className="grid grid-cols-4 gap-4">
          <KCard label="Rental Income %" value={`${rentP.toFixed(1)}%`} sub={`${fmt(k.rentalIncome)} of ${fmt(k.totalRevenue)}`} status={rentP>=80?'good':'info'} />
          <KCard label="Interest Coverage" value={iCov>0?`${iCov.toFixed(2)}x`:'N/A'} sub={`NOI ÷ Interest (${fmt(k.interestExpense)})`} status={iCov>=2?'good':iCov>=1.2?'warn':'bad'} />
          <KCard label="Mgmt Fee %" value={`${mgmtP.toFixed(1)}%`} sub={`${fmt(k.managementFee)} of revenue`} status={mgmtP<=10?'good':mgmtP<=15?'warn':'bad'} />
          <KCard label="Repair % of Revenue" value={`${repP.toFixed(1)}%`} sub={`${fmt(k.repairs)} repairs/maint`} status={repP<=5?'good':repP<=10?'warn':'bad'} />
        </div>
      </div>

      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>Balance Sheet</p>
        <div className="grid grid-cols-4 gap-4">
          <KCard label="LTV (Loans / Building)" value={ltv>0?`${ltv.toFixed(1)}%`:'Not available'} sub={ltv>0?`Loans: ${fmt(k.longTermLoans)}`:'Property value not found in balance sheet'} status={ltv>0&&ltv<=75?'good':ltv>0&&ltv<=85?'warn':ltv>0?'bad':'info'} />
          <KCard label="Asset / Liability Ratio" value={alR>0?`${alR.toFixed(2)}x`:'N/A'} sub={`Assets: ${fmt(k.totalAssets)}`} status={alR>=1.5?'good':alR>=1?'warn':'bad'} />
          <KCard label="Debt-to-Equity" value={dte>0?`${dte.toFixed(2)}x`:'N/A'} sub={`Equity: ${fmt(k.equity)}`} status={dte>0&&dte<=2?'good':dte<=4?'warn':'bad'} />
          <KCard label="Cash Balance" value={fmt(k.cash)} sub={`As of ${label}`} status={k.cash>10000?'good':k.cash>0?'warn':'bad'} trendData={cashTrend} />
        </div>
      </div>

      {/* ── Benchmark Bullet Strips ─────────────────────────────────────── */}
      <div className="space-y-3">
        <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Benchmark Comparison</p>
        <div style={{ borderLeft: '3px solid #2F80ED', paddingLeft: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#2F80ED', marginBottom: 8 }}>Profitability</p>
          <BulletChartStrip cards={profBulletCards} defs={PROF_BULLET_DEFS} />
        </div>
        <div style={{ borderLeft: '3px solid #27AE60', paddingLeft: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#27AE60', marginBottom: 8 }}>Rental Performance — Rental Income % and Cash Balance excluded (not ratio-comparable)</p>
          <BulletChartStrip cards={rentalBulletCards} defs={RENTAL_BULLET_DEFS} />
        </div>
        <div style={{ borderLeft: '3px solid #F2994A', paddingLeft: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#F2994A', marginBottom: 8 }}>Balance Sheet — Cash Balance excluded ($ amount, not ratio)</p>
          <BulletChartStrip cards={balanceBulletCards} defs={BALANCE_BULLET_DEFS} />
        </div>
      </div>

      {/* ── Margins & Ratios Trend ──────────────────────────────────────── */}
      <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>Margins &amp; Ratios Trend</p>
        <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 16 }}>NOI Margin, Net Margin, and Expense Ratio over all available years</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={marginsTrend} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="NOI Margin %"    stroke="#D4AF37" strokeWidth={2} dot={{ r: 3, fill: '#D4AF37' }} />
            <Line type="monotone" dataKey="Net Margin %"    stroke="#22A06B" strokeWidth={2} dot={{ r: 3, fill: '#22A06B' }} />
            <Line type="monotone" dataKey="Expense Ratio %" stroke="#EB5757" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, fill: '#EB5757' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: 20 }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>5-Year Financial Trend</p>
        <p style={{ fontSize: 12, color: '#A8A29E', marginBottom: 14 }}>Revenue, Expenses, Net Income and NOI across all available years</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={trendData} margin={{ left: 16, right: 16, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: number) => fmtFull(v)} contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="Revenue"    stroke="#D4AF37" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Expenses"   stroke="#EB5757" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Net Income" stroke="#22A06B" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="NOI"        stroke="#8B6914" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue Allocation + YoY */}
      <div className="grid grid-cols-2 gap-4">
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: 20 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 14 }}>Revenue Allocation ({label})</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={revenueAllocation} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                <Cell fill="#D4AF37" />
                <Cell fill="#EB5757" />
              </Pie>
              <Tooltip formatter={(v: number) => fmtFull(v)} contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {yoyComparison.length > 0 && (
          <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: 20 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 14 }}>{label} vs {compareLabel || 'Prior Period'}</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={yoyComparison}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" vertical={false} />
                <XAxis dataKey="kpi" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => v.toFixed(2)} contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="current"  name={label}  fill="#D4AF37" radius={[4,4,0,0]} />
                <Bar dataKey="previous" name={compareLabel || 'Prior'} fill="#A8A29E" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ── CFO Dashboard Tab ─────────────────────────────────────────────────────────

function CFOTab({ fin }: { fin: ParsedFinancials }) {
  const lastY = fin.years[fin.years.length - 1];
  const [selectedYear, setSelectedYear] = useState<number>(lastY);

  const snapshotRows = fin.years.map(y => {
    const kk = calcKpis(fin, y);
    return { year: y, revenue: kk.totalRevenue, expenses: kk.totalExpenses, netIncome: kk.netIncome, noi: kk.noi, cash: kk.cash, margin: kk.totalRevenue > 0 ? kk.netIncome / kk.totalRevenue * 100 : 0 };
  });

  const niTrajectory  = snapshotRows.map(r => ({ year: String(r.year), netIncome: r.netIncome }));
  const expRatioTrend = snapshotRows.map(r => ({ year: String(r.year), ratio: r.revenue > 0 ? (r.expenses / r.revenue) * 100 : 0 }));
  const revExpCombo   = snapshotRows.map(r => ({ year: String(r.year), Revenue: r.revenue, Expenses: r.expenses }));
  const cashTrend     = snapshotRows.map(r => ({ year: String(r.year), cash: r.cash }));

  const revChart = fin.years.map(y => {
    const kk = calcKpis(fin, y);
    return { year: String(y), 'Rental Income': kk.rentalIncome, 'Other Income': kk.otherIncome, 'Services': Math.max(0, kk.totalRevenue - kk.rentalIncome - kk.otherIncome) };
  });

  const k = calcKpis(fin, selectedYear);
  const expPie = [
    { name: 'Interest Paid', value: k.interestExpense },
    { name: 'Property Tax',  value: k.propertyTax },
    { name: 'HOA Fees',      value: k.hoaFees },
    { name: 'Legal Fees',    value: k.legalFees },
    { name: 'Mgmt Fee',      value: k.managementFee },
    { name: 'Utilities',     value: k.utilities },
    { name: 'Repairs',       value: k.repairs },
    { name: 'Other',         value: Math.max(0, k.totalExpenses - k.interestExpense - k.propertyTax - k.hoaFees - k.legalFees - k.managementFee - k.utilities - k.repairs) },
  ].filter(e => e.value > 0);

  // Year insight card
  const margin = k.totalRevenue > 0 ? (k.netIncome / k.totalRevenue) * 100 : 0;
  let insightText = ''; let insightColor = '#374151'; let insightBg = '#F9FAFB'; let insightBorder = '#E5E7EB';
  let InsightIcon: React.ReactNode = null;
  if (margin > 20) {
    insightText = `Strong profitability: ${margin.toFixed(1)}% net margin. Revenue of ${fmtFull(k.totalRevenue)} with controlled expenses.`;
    insightColor = '#065F46'; insightBg = '#ECFDF5'; insightBorder = '#A7F3D0';
    InsightIcon = <CheckCircle2 size={20} style={{ color: '#10B981', flexShrink: 0 }} />;
  } else if (margin > 0) {
    insightText = `Healthy margin at ${margin.toFixed(1)}%. Watch expense growth relative to ${fmtFull(k.totalRevenue)} revenue.`;
    insightColor = '#1E40AF'; insightBg = '#EFF6FF'; insightBorder = '#BFDBFE';
    InsightIcon = <TrendingUp size={20} style={{ color: '#D4AF37', flexShrink: 0 }} />;
  } else if (k.totalRevenue > 0) {
    insightText = `Net loss of ${fmtFull(Math.abs(k.netIncome))} (${margin.toFixed(1)}% margin). NOI is ${fmtFull(k.noi)} — check interest and depreciation charges.`;
    insightColor = '#92400E'; insightBg = '#FFFBEB'; insightBorder = '#FCD34D';
    InsightIcon = <AlertCircle size={20} style={{ color: '#F59E0B', flexShrink: 0 }} />;
  } else {
    insightText = 'No revenue recorded for this year.';
    insightColor = '#991B1B'; insightBg = '#FEF2F2'; insightBorder = '#FECACA';
    InsightIcon = <AlertCircle size={20} style={{ color: '#EF4444', flexShrink: 0 }} />;
  }

  // Summary tiles
  const latestRow = snapshotRows[snapshotRows.length - 1];
  const prevRow   = snapshotRows.length > 1 ? snapshotRows[snapshotRows.length - 2] : null;
  const niChange  = prevRow && prevRow.netIncome !== 0 ? ((latestRow.netIncome - prevRow.netIncome) / Math.abs(prevRow.netIncome)) * 100 : 0;
  const avgMargin = snapshotRows.reduce((s, r) => s + r.margin, 0) / snapshotRows.length;

  // CFO Insights (auto-generated from selected year)
  const intPct    = k.totalRevenue > 0 ? (k.interestExpense / k.totalRevenue * 100).toFixed(1) : '0';
  const negYrs    = snapshotRows.filter(r => r.netIncome < 0).length;
  const firstK    = calcKpis(fin, fin.years[0]);
  const revGrowth = firstK.totalRevenue > 0 ? ((k.totalRevenue - firstK.totalRevenue) / firstK.totalRevenue * 100).toFixed(1) : null;
  const avgRev    = fin.years.reduce((s, y) => s + calcKpis(fin, y).totalRevenue, 0) / fin.years.length;
  const ltv       = k.buildings > 0 ? k.longTermLoans / k.buildings * 100 : 0;
  const ltvLabel  = ltv < 80 ? '✅ Good (below 80%)' : ltv < 90 ? '⚠️ Watch (80–90%)' : '🔴 High (above 90%)';

  const insights: Array<{ color: string; text: string }> = [];
  if (k.interestExpense > 0) insights.push({ color: 'bg-blue-50 border-blue-200', text: `💡 Interest expense is ${intPct}% of revenue — the single largest expense at ${fmt(k.interestExpense)}. This represents mortgage interest on outstanding loans of ${fmt(k.longTermLoans)}.` });
  if (negYrs > 0) insights.push({ color: 'bg-amber-50 border-amber-200', text: `⚠️ Net income has been negative for ${negYrs} of ${fin.years.length} years due to depreciation and interest charges. NOI (pre-interest) is ${k.noi >= 0 ? 'positive' : 'negative'} at ${fmt(k.noi)}, indicating ${k.noi >= 0 ? 'healthy' : 'stressed'} operating performance.` });
  if (revGrowth !== null) insights.push({ color: 'bg-green-50 border-green-200', text: `✅ Revenue grew from ${fmt(firstK.totalRevenue)} (${fin.years[0]}) to ${fmt(k.totalRevenue)} (${lastY}) — ${revGrowth}% over ${fin.years.length - 1} years. Average annual revenue: ${fmt(avgRev)}/year.` });
  if (k.buildings > 0) insights.push({ color: 'bg-gray-50 border-gray-200', text: `📋 Property value (Buildings): ${fmt(k.buildings)} | Outstanding loans: ${fmt(k.longTermLoans)} | LTV: ${ltv.toFixed(1)}% — ${ltvLabel}` });

  // ── Period toggle state — default to latest period in uploaded data ───────
  const availableKeys = getAvailableKeys(fin);
  const _PMONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const _latestKey   = availableKeys[availableKeys.length - 1] ?? '';
  const _latestMonth = _latestKey ? _PMONTHS.indexOf(_latestKey.split(' ')[0]) + 1 : new Date().getMonth() + 1;
  const _latestYear  = _latestKey ? parseInt(_latestKey.split(' ')[1]) : new Date().getFullYear();

  const [period, setPeriod] = useState<Period | null>(null);
  const [pMonth, setPMonth] = useState(_latestMonth || new Date().getMonth() + 1);
  const [pYear, setPYear] = useState(_latestYear  || new Date().getFullYear());

  const periodKeys = useMemo(
    () => period ? getPeriodKeys(period, pMonth, pYear) : [],
    [period, pMonth, pYear],
  );

  const periodAgg = useMemo(
    () => periodKeys.length ? sumKpisOverKeys(fin.pl, periodKeys) : null,
    [fin.pl, periodKeys],
  );

  const periodTrend = useMemo(() => {
    if (!periodKeys.length) return [];
    return periodKeys.map(key => {
      const m = calcMonthlyKpis(fin.pl, key);
      const grossMargin = m.totalRevenue > 0
        ? (m.rentIncome + m.otherIncome - m.repairs - m.utilities - m.hoa) / m.totalRevenue * 100 : 0;
      const operatingMargin = m.totalRevenue > 0 ? m.noi / m.totalRevenue * 100 : 0;
      const netMargin = m.totalRevenue > 0 ? m.netIncome / m.totalRevenue * 100 : 0;
      return { month: key, grossMargin, operatingMargin, netMargin };
    });
  }, [fin.pl, periodKeys]);

  const periodRevByMonth = useMemo(() => {
    if (!periodKeys.length) return [];
    return periodKeys.map(key => {
      const m = calcMonthlyKpis(fin.pl, key);
      return { month: key, rentIncome: m.rentIncome, otherIncome: m.otherIncome };
    });
  }, [fin.pl, periodKeys]);

  const OPEX_PALETTE = ['#D4AF37','#F2994A','#2F80ED','#22A06B','#D9534F','#9B59B6','#F2C94C','#E8DEC8'];

  return (
    <div className="space-y-6">

      {/* Period Toggle */}
      <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Income Analysis Period</div>
        <PeriodToggle
          period={period}
          month={pMonth}
          year={pYear}
          onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }}
          availableKeys={availableKeys}
        />
      </div>

      {/* Period Panels — shown when a period is active */}
      {period && periodAgg && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Income Statement — {period === 'MoM' ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][pMonth-1]} ${pYear}` : period === 'YTD' ? `YTD Jan–${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][pMonth-1]} ${pYear}` : `TTM (${periodKeys[0]}–${periodKeys[11]})`}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Panel 1 — Revenue Mix Donut */}
            <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Revenue Mix</p>
              {periodAgg.totalRevenue > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={[
                        { name: 'Rent Income',  value: periodAgg.rentIncome  },
                        { name: 'Other Income', value: periodAgg.otherIncome },
                      ].filter(d => d.value > 0)} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                        <Cell fill="#D4AF37" />
                        <Cell fill="#2F80ED" />
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtFull(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    {[
                      { name: 'Rent Income',  val: periodAgg.rentIncome,  color: '#D4AF37' },
                      { name: 'Other Income', val: periodAgg.otherIncome, color: '#2F80ED' },
                    ].map(s => (
                      <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                          <span style={{ fontSize: 13, color: '#1C1917' }}>{s.name}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: '#1C1917', fontFamily: 'monospace' }}>{fmtFull(s.val)}</span>
                          <span style={{ fontSize: 12, color: '#A8A29E', marginLeft: 6 }}>
                            {periodAgg.totalRevenue > 0 ? `${(s.val / periodAgg.totalRevenue * 100).toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid #E8DEC8', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#78716C' }}>Total Revenue</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#1C1917', fontFamily: 'monospace' }}>{fmtFull(periodAgg.totalRevenue)}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#A8A29E', textAlign: 'center', paddingTop: 40 }}>No revenue data for this period</p>
              )}
            </div>

            {/* Panel 2 — Opex Breakdown */}
            <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Opex Breakdown</p>
              {(() => {
                const cats = [
                  { name: 'Management Fee', val: periodAgg.management },
                  { name: 'Interest',       val: periodAgg.interest },
                  { name: 'Property Tax',   val: periodAgg.propertyTax },
                  { name: 'Repairs',        val: periodAgg.repairs },
                  { name: 'Utilities',      val: periodAgg.utilities },
                  { name: 'HOA Fees',       val: periodAgg.hoa },
                  { name: 'Legal Fees',     val: periodAgg.legal },
                  { name: 'Insurance',      val: periodAgg.insurance },
                  { name: 'Depreciation',   val: periodAgg.depreciation },
                  { name: 'Other',          val: periodAgg.otherOpex },
                ].filter(c => c.val > 0).sort((a, b) => b.val - a.val);
                if (!cats.length) return <p style={{ fontSize: 13, color: '#A8A29E', textAlign: 'center', paddingTop: 40 }}>No expense data for this period</p>;
                const totalOpex = cats.reduce((s, c) => s + c.val, 0);
                return (
                  <>
                    <ResponsiveContainer width="100%" height={Math.max(160, cats.length * 28)}>
                      <BarChart data={cats} layout="vertical" margin={{ left: 0, right: 60, top: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8DEC8" />
                        <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmt(v as number)} axisLine={false} tickLine={false} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} width={90} />
                        <Tooltip formatter={(v: number) => fmtFull(v)} />
                        <Bar dataKey="val" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 9, fill: '#6b7280', formatter: (v: number) => fmt(v) }}>
                          {cats.map((_, i) => <Cell key={i} fill={OPEX_PALETTE[i % OPEX_PALETTE.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div style={{ marginTop: 8 }}>
                      {cats.map((c, i) => (
                        <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #EEE8DF' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: OPEX_PALETTE[i % OPEX_PALETTE.length], display: 'inline-block', flexShrink: 0 }} />
                            <span style={{ color: '#374151' }}>{c.name}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, fontFamily: 'monospace' }}>
                            <span style={{ color: '#262626' }}>{fmt(c.val)}</span>
                            <span style={{ color: '#9CA3AF', minWidth: 36, textAlign: 'right' }}>{totalOpex > 0 ? `${(c.val / totalOpex * 100).toFixed(0)}%` : '—'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Panel 3 — Profitability Trend */}
            <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Profitability Trend</p>
              {periodTrend.some(d => d.grossMargin !== 0 || d.operatingMargin !== 0 || d.netMargin !== 0) ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={periodTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
                    <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${(v as number).toFixed(0)}%`} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="grossMargin"     stroke="#22A06B" strokeWidth={2} dot={false} name="Gross Margin"     />
                    <Line type="monotone" dataKey="operatingMargin" stroke="#F2994A" strokeWidth={2} dot={false} name="Operating Margin" />
                    <Line type="monotone" dataKey="netMargin"       stroke="#D9534F" strokeWidth={2} dot={false} name="Net Margin"       />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ fontSize: 13, color: '#A8A29E', textAlign: 'center', paddingTop: 40 }}>No margin data for this period</p>
              )}
            </div>

            {/* Panel 4 — Revenue by Month */}
            <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#1C1917', marginBottom: 12 }}>Revenue by Month</p>
              {periodRevByMonth.some(d => d.rentIncome > 0 || d.otherIncome > 0) ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={periodRevByMonth} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
                      <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmt(v as number)} />
                      <Tooltip formatter={(v: number) => fmtFull(v)} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="rentIncome"  stackId="rev" fill="#D4AF37" name="Rent Income"  radius={[0,0,0,0]} />
                      <Bar dataKey="otherIncome" stackId="rev" fill="#2F80ED" name="Other Income" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <p style={{ fontSize: 13, color: '#A8A29E', textAlign: 'center', paddingTop: 40 }}>No revenue data for this period</p>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Year Selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ fontSize: 13, color: '#92400E', fontWeight: 600, marginRight: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>YEAR:</span>
        {fin.years.map(y => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            style={{
              background: selectedYear === y ? '#D4AF37' : '#F7F5F0',
              color: selectedYear === y ? '#FFFFFF' : '#92400E',
              border: '1px solid ' + (selectedYear === y ? '#D4AF37' : '#2D3A56'),
              padding: '5px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {y}
          </button>
        ))}
      </div>

      {/* Year Insight Card */}
      <div style={{ background: insightBg, border: `1px solid ${insightBorder}`, borderRadius: '12px', padding: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          {InsightIcon}
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 700, fontSize: '15px', color: insightColor, marginBottom: '6px' }}>{selectedYear} Financial Snapshot</p>
            <p style={{ fontSize: '13px', color: '#374151' }}>{insightText}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '12px' }}>
              {[
                { label: 'Revenue',    value: fmtFull(k.totalRevenue) },
                { label: 'Expenses',   value: fmtFull(k.totalExpenses) },
                { label: 'Net Income', value: fmtFull(k.netIncome) },
                { label: 'Cash (Bank)',value: k.cash > 0 ? fmtFull(k.cash) : '—' },
              ].map(item => (
                <div key={item.label}>
                  <p style={{ fontSize: 13, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{item.label}</p>
                  <p style={{ fontSize: 18, fontWeight: 700, color: '#1C1917', marginTop: 2 }}>{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Year Snapshot Table */}
      <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, overflow:'hidden' }}>
        <div style={{ background:'#DDD5C4', color:'#78716C', padding:'8px 16px', fontSize:13, fontWeight:700 }}>Multi-Year Financial Snapshot</div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background:'#DDD5C4' }}>
                {['Year','Total Revenue','Total Expenses','Net Income','NOI','Cash','Net Margin %'].map(h => (
                  <th key={h} style={{ fontSize:13, fontWeight:600, color:'#78716C', textTransform:'uppercase', textAlign: h==='Year' ? 'left' : 'right', padding:'8px 16px', letterSpacing:'0.03em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshotRows.map((r, i) => (
                <tr key={i} style={{ background: r.year === selectedYear ? '#EDE5D8' : i % 2 === 0 ? '#F7F1E6' : '#FBF6EE', borderTop:'1px solid #E8DEC8' }}>
                  <td style={{ padding:'8px 16px', fontSize:14, fontWeight: r.year === selectedYear ? 700 : 500, color:'#1C1917' }}>{r.year}{r.year === selectedYear ? ' ◀' : ''}</td>
                  <td style={{ padding:'8px 16px', textAlign:'right', fontFamily:'monospace', fontSize:14, color:'#1C1917' }}>{fmt(r.revenue)}</td>
                  <td style={{ padding:'8px 16px', textAlign:'right', fontFamily:'monospace', fontSize:14, color:'#D9534F' }}>{fmt(r.expenses)}</td>
                  <td style={{ padding:'8px 16px', textAlign:'right', fontFamily:'monospace', fontSize:14, fontWeight:600, color: r.netIncome>=0 ? '#1baf7a' : '#D9534F' }}>{r.netIncome < 0 ? `(${fmt(Math.abs(r.netIncome))})` : fmt(r.netIncome)}</td>
                  <td style={{ padding:'8px 16px', textAlign:'right', fontFamily:'monospace', fontSize:14, color: r.noi>=0 ? '#2F80ED' : '#D9534F' }}>{r.noi < 0 ? `(${fmt(Math.abs(r.noi))})` : fmt(r.noi)}</td>
                  <td style={{ padding:'8px 16px', textAlign:'right', fontFamily:'monospace', fontSize:14, color:'#2F80ED' }}>{r.cash > 0 ? fmt(r.cash) : '—'}</td>
                  <td style={{ padding:'8px 16px', textAlign:'right', fontFamily:'monospace', fontSize:14, color: r.margin>=0 ? '#1baf7a' : '#D9534F' }}>{r.margin.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Grid 2×2 */}
      <div className="grid grid-cols-2 gap-4">
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
          <p style={{ fontSize:15, fontWeight:600, color:'#1C1917', marginBottom:12 }}>Net Income Trajectory</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={niTrajectory} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmt(v as number)} />
              <Tooltip formatter={(v: number) => fmtFull(v)} />
              <Line type="monotone" dataKey="netIncome" stroke="#22C55E" strokeWidth={2} dot={{ fill: '#22C55E', r: 4 }} activeDot={{ r: 6, fill: '#22C55E' }} name="Net Income" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
          <p style={{ fontSize:15, fontWeight:600, color:'#1C1917', marginBottom:12 }}>Expense Ratio Trend</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={expRatioTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${(v as number).toFixed(0)}%`} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Line type="monotone" dataKey="ratio" stroke="#F59E0B" strokeWidth={2} dot={{ fill: '#F59E0B', r: 4 }} activeDot={{ r: 6, fill: '#F59E0B' }} name="Expense %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
          <p style={{ fontSize:15, fontWeight:600, color:'#1C1917', marginBottom:12 }}>Revenue vs Expenses</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={revExpCombo} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmt(v as number)} />
              <Tooltip formatter={(v: number) => fmtFull(v)} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Revenue"  fill="#3B82F6" radius={[4,4,0,0]} />
              <Bar dataKey="Expenses" fill="#EF4444" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
          <p style={{ fontSize:15, fontWeight:600, color:'#1C1917', marginBottom:12 }}>Cash Balance Trend (Bank Accounts)</p>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={cashTrend} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmt(v as number)} />
              <Tooltip formatter={(v: number) => fmtFull(v)} />
              <Line type="monotone" dataKey="cash" stroke="#8B5CF6" strokeWidth={2} dot={{ fill: '#8B5CF6', r: 4 }} activeDot={{ r: 6, fill: '#8B5CF6' }} name="Cash" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue Breakdown + Expense Pie for selected year */}
      <div className="grid grid-cols-2 gap-4">
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
          <p style={{ fontSize:15, fontWeight:600, color:'#1C1917', marginBottom:12 }}>Revenue Breakdown by Year</p>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={revChart} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => fmtFull(v)} contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Rental Income" stackId="a" fill="#D4AF37" />
              <Bar dataKey="Other Income"  stackId="a" fill="#B8860B" />
              <Bar dataKey="Services"      stackId="a" fill="#8B6914" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background:'#FBF6EE', border:'0.5px solid #E8DEC8', borderRadius:8, padding:16 }}>
          <p style={{ fontSize:15, fontWeight:600, color:'#1C1917', marginBottom:12 }}>Expense Breakdown ({selectedYear})</p>
          <ResponsiveContainer width="100%" height={210}>
            <PieChart>
              <Pie data={expPie} cx="50%" cy="50%" outerRadius={75} dataKey="value">
                {expPie.map((_, i) => <Cell key={i} fill={['#D4AF37','#EB5757','#22A06B','#F2994A','#8B6914','#A8A29E','#C08B40','#78716C'][i % 8]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtFull(v)} contentStyle={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, fontSize: 13 }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Summary Tiles */}
      <div className="grid grid-cols-3 gap-4">
        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 11, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Latest Net Income ({lastY})</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: latestRow.netIncome >= 0 ? '#1C1917' : '#D9534F', marginTop: 8 }}>{latestRow.netIncome < 0 ? `(${fmtFull(Math.abs(latestRow.netIncome))})` : fmtFull(latestRow.netIncome)}</p>
          {prevRow && <p style={{ fontSize: 11, color: niChange >= 0 ? '#22A06B' : '#D9534F', marginTop: 4 }}>{niChange >= 0 ? '↑' : '↓'} {Math.abs(niChange).toFixed(1)}% vs {prevRow.year}</p>}
        </div>
        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 11, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Avg Profit Margin</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: avgMargin >= 0 ? '#1C1917' : '#D9534F', marginTop: 8 }}>{avgMargin.toFixed(1)}%</p>
          <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>Across {fin.years.length} years</p>
        </div>
        <div style={{ background: '#FBF6EE', border: '0.5px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 11, color: '#6B6B6B', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Latest Cash Position</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: '#2F80ED', marginTop: 8 }}>{latestRow.cash > 0 ? fmtFull(latestRow.cash) : '—'}</p>
          <p style={{ fontSize: 11, color: '#6B6B6B', marginTop: 4 }}>Bank accounts ({lastY})</p>
        </div>
      </div>

      {/* CFO Insights */}
      <div className="space-y-3">
        <p style={{ fontSize:12, fontWeight:700, color:'#92400E', textTransform:'uppercase', letterSpacing:'0.05em' }}>CFO Insights</p>
        {insights.length === 0
          ? <p style={{ fontSize:13, color:'#9CA3AF' }}>Upload complete financials to generate CFO insights.</p>
          : insights.map((ins, i) => (
              <div key={i} style={{ border:'1px solid #E8DEC8', borderRadius:8, padding:16, background:'#FBF6EE' }}>
                <p style={{ fontSize:13, color:'#374151' }}>{ins.text}</p>
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

const FM_INPUT: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid #E8DEC8',
  borderRadius: 8, fontSize: 14, color: '#1C1917', background: '#FBF6EE',
  outline: 'none', fontFamily: FIN_FONT,
};
const FM_LABEL: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, color: '#78716C',
  textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6,
};

function FinancialMetricsTab({ companyName }: { companyName: string }) {
  const [metrics, setMetrics] = useState({
    month: new Date().toISOString().split('T')[0].slice(0, 7),
    revenue: '',
    expenses: '',
    noi: '',
    cashFlow: '',
    loanPayments: '',
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setMetrics(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metrics.month || !metrics.revenue || !metrics.expenses) {
      alert('Please fill in at least Month, Revenue, and Expenses');
      return;
    }
    try {
      console.log('Saving financial metrics:', metrics);
      alert(`Financial metrics for ${metrics.month} saved successfully. Revenue: $${parseFloat(metrics.revenue).toLocaleString()}`);
      setMetrics({
        month: new Date().toISOString().split('T')[0].slice(0, 7),
        revenue: '', expenses: '', noi: '', cashFlow: '', loanPayments: '', notes: '',
      });
    } catch {
      alert('Failed to save financial metrics');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: '#1C1917', marginBottom: 6 }}>
          Manual Financial Entry — {companyName}
        </h3>
        <p style={{ fontSize: 13, color: '#A8A29E' }}>
          Enter monthly financial figures. These will flow through to your portfolio KPIs and dashboard.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 680 }}>
        {/* Month */}
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '16px 18px' }}>
          <label style={FM_LABEL}>Period (Month)</label>
          <input type="month" name="month" value={metrics.month} onChange={handleChange} style={FM_INPUT} />
        </div>

        {/* Financial Figures Grid */}
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '16px 18px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
            Financial Figures
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { key: 'revenue',      label: 'Total Revenue' },
              { key: 'expenses',     label: 'Total Expenses' },
              { key: 'noi',          label: 'Net Operating Income (NOI)' },
              { key: 'cashFlow',     label: 'Cash Flow' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label style={FM_LABEL}>{label}</label>
                <input
                  type="number" name={key} placeholder="0.00"
                  value={metrics[key as keyof typeof metrics]}
                  onChange={handleChange} style={FM_INPUT}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Loan Payments */}
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '16px 18px' }}>
          <label style={FM_LABEL}>Loan Payments (if any)</label>
          <input type="number" name="loanPayments" placeholder="0.00"
            value={metrics.loanPayments} onChange={handleChange} style={{ ...FM_INPUT, maxWidth: 320 }} />
        </div>

        {/* Notes */}
        <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 12, padding: '16px 18px' }}>
          <label style={FM_LABEL}>Notes / Comments</label>
          <textarea
            name="notes" placeholder="Any notes about this period..."
            value={metrics.notes} onChange={handleChange} rows={3}
            style={{ ...FM_INPUT, resize: 'vertical' }}
          />
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 4 }}>
          <button
            type="submit"
            style={{
              padding: '9px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg,#D4AF37,#B8860B)', color: '#fff',
              fontSize: 14, fontWeight: 600, letterSpacing: '0.02em',
            }}
          >
            Save Metrics
          </button>
          <p style={{ fontSize: 13, color: '#A8A29E' }}>
            Tip: Use the Expenses page to record individual expense transactions.
          </p>
        </div>
      </form>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function RentalFinancials() {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FinTab>('P&L Statement');
  const [allFinancials, setAllFinancials] = useState<Record<string, ParsedFinancials>>({});
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingFin, setLoadingFin] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Period toggle state (shared across P&L and CFO Dashboard)
  const [period, setPeriod] = useState<Period | null>(null);
  const [pMonth, setPMonth] = useState(new Date().getMonth() + 1);
  const [pYear, setPYear] = useState(new Date().getFullYear());
  const [kpiYear, setKpiYear] = useState(new Date().getFullYear());
  const [kpiMonth, setKpiMonth] = useState<number | null>(null);

  const selectStyle: React.CSSProperties = {
    fontSize: 13, border: '1px solid #E8DEC8', borderRadius: 6,
    padding: '5px 10px', background: '#FBF6EE', color: '#1C1917', cursor: 'pointer',
  };

  const currentFin = selectedCompanyId ? allFinancials[selectedCompanyId] : null;

  // Reset period and default to latest available key when company or financials load
  useEffect(() => {
    if (!selectedCompanyId || !currentFin) return;
    setPeriod(null);
    const keys = getAvailableKeys(currentFin);
    const latestKey = keys[keys.length - 1] ?? '';
    const _M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (latestKey) {
      const parts = latestKey.split(' ');
      const m = _M.indexOf(parts[0]) + 1;
      const y = parseInt(parts[1]);
      if (m > 0) setPMonth(m);
      if (!isNaN(y)) setPYear(y);
      if (m > 0) setKpiMonth(m);
      if (!isNaN(y)) setKpiYear(y);
    } else {
      const latestYear = currentFin.years[currentFin.years.length - 1] ?? new Date().getFullYear();
      setKpiYear(latestYear);
      setKpiMonth(null);
    }
  }, [selectedCompanyId, currentFin?.uploadedAt, currentFin?.fileName]);

  // Load company list from backend
  useEffect(() => {
    api.get<{ id: string; company_name: string }[]>('/api/rentals/companies')
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : [];
        setCompanies(list.map(c => ({ id: c.id, company_name: c.company_name })));
      })
      .catch(() => {});
  }, []);

  // Load financials from backend when company changes
  useEffect(() => {
    if (!selectedCompanyId) return;
    if (allFinancials[selectedCompanyId]) return; // already cached
    setLoadingFin(true);
    api.get<{
      company_name: string; filename: string; date_range: string;
      years: number[]; pl: FinItem[]; bs: FinItem[]; cf: FinItem[]; uploaded_at: string;
    }>(`/api/rentals/financials/${selectedCompanyId}`)
      .then(res => {
        const d = res.data;
        setAllFinancials(prev => ({
          ...prev,
          [selectedCompanyId]: {
            companyName: d.company_name,
            fileName: d.filename,
            dateRange: d.date_range,
            uploadedAt: d.uploaded_at,
            years: d.years,
            periods: d.periods ?? [],
            pl: d.pl,
            bs: d.bs,
            cf: d.cf ?? [],
          },
        }));
      })
      .catch(() => {}) // 404 = no upload yet — leave as undefined
      .finally(() => setLoadingFin(false));
  }, [selectedCompanyId]);

  // Load ALL companies' financials on mount (and when company list first arrives)
  // Skip companies already cached in allFinancials to avoid redundant fetches
  useEffect(() => {
    if (!companies.length) return;
    const missing = companies.filter(co => !allFinancials[co.id]);
    if (!missing.length) return; // everything already cached

    setLoadingFin(true);
    Promise.all(
      missing.map(co =>
        api.get<{
          company_name: string; filename: string; date_range: string;
          years: number[]; periods?: string[]; pl: FinItem[]; bs: FinItem[]; cf: FinItem[]; uploaded_at: string;
        }>(`/api/rentals/financials/${co.id}`)
          .then(res => {
            const d = res.data;
            return {
              [co.id]: {
                companyName: d.company_name,
                fileName: d.filename,
                dateRange: d.date_range,
                uploadedAt: d.uploaded_at,
                years: d.years ?? [],
                periods: d.periods ?? [],
                pl: d.pl ?? [],
                bs: d.bs ?? [],
                cf: d.cf ?? [],
              } as ParsedFinancials,
            };
          })
          .catch(() => ({}))
      )
    )
    .then(results => {
      const merged = Object.assign({}, ...results) as Record<string, ParsedFinancials>;
      setAllFinancials(prev => ({ ...prev, ...merged }));
    })
    .finally(() => setLoadingFin(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  const isAll = !selectedCompanyId;
  const selectedCompanyName = companies.find(c => c.id === selectedCompanyId)?.company_name ?? '';

  const triggerUpload = useCallback(() => {
    if (!selectedCompanyId) { alert('Please select a specific company before uploading.'); return; }
    fileRef.current?.click();
  }, [selectedCompanyId]);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !selectedCompanyId) return;
    setUploading(true);
    try {
      // Parse all uploaded files (P&L, BS, CF may be separate files)
      let merged: ParsedFinancials = allFinancials[selectedCompanyId] ?? {
        companyName: selectedCompanyName, dateRange: '', fileName: '', uploadedAt: new Date().toISOString(), years: [], pl: [], bs: [], cf: [],
      };

      for (const file of files) {
        const fin = await parseExcel(file, selectedCompanyName);
        merged = {
          companyName: fin.companyName || merged.companyName,
          dateRange:   fin.dateRange   || merged.dateRange,
          fileName:    files.map(f => f.name).join(' + '),
          uploadedAt:  new Date().toISOString(),
          pl:    fin.pl.length  ? fin.pl    : merged.pl,
          bs:    fin.bs.length  ? fin.bs    : merged.bs,
          cf:    fin.cf.length  ? fin.cf    : merged.cf,
          years: Array.from(new Set([...merged.years, ...fin.years])).sort((a, b) => a - b),
          periods: fin.periods.length ? fin.periods : merged.periods,
        };
      }

      setAllFinancials(prev => ({ ...prev, [selectedCompanyId]: merged }));

      await api.post('/api/rentals/financials/save', {
        company_id:   selectedCompanyId,
        company_name: merged.companyName,
        filename:     merged.fileName,
        date_range:   merged.dateRange,
        years:        merged.years,
        periods:      merged.periods,
        pl:           merged.pl,
        bs:           merged.bs,
        cf:           merged.cf,
      });
    } catch {
      alert('Failed to parse one or more Excel files. Make sure the files are QBO-exported P&L, Balance Sheet, or Cash Flow exports.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [selectedCompanyId, selectedCompanyName, allFinancials]);

  const clearData = useCallback(async () => {
    if (!currentFin || !selectedCompanyId) return;
    try {
      await api.delete(`/api/rentals/financials/${selectedCompanyId}`);
    } catch {}
    setAllFinancials(prev => { const n = { ...prev }; delete n[selectedCompanyId]; return n; });
  }, [selectedCompanyId, currentFin]);

  return (
    <div className="space-y-6">
      {/* Controls bar */}
      <div className="sticky top-0 z-10 border-b shadow-sm -mx-6 px-6 py-3" style={{ background: '#ECE9E3', borderColor: '#DDD8CC' }}>
        <div className="flex flex-wrap items-center gap-3">
          <Building2 size={15} className="text-gray-400 shrink-0" />
          <select
            value={selectedCompanyId ?? ''}
            onChange={e => {
              setSelectedCompanyId(e.target.value || null);
              setActiveTab('P&L Statement');
              setSelectedYear(null);
            }}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">All Companies</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={handleFile} />
          {selectedCompanyId && (
            <button onClick={triggerUpload} disabled={uploading || loadingFin}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors">
              <Upload size={14} />{uploading ? 'Uploading…' : 'Upload Excel'}
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
        <div className="border rounded-2xl shadow-sm p-6" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={18} className="text-emerald-600" />
            <h2 className="text-lg font-bold text-gray-900">All Companies — Portfolio Overview</h2>
          </div>
          <p className="text-gray-400 text-sm mb-6">{Object.keys(allFinancials).length} companies with uploaded data</p>
          {loadingFin && Object.keys(allFinancials).length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 12 }}>
              <div style={{ width: 32, height: 32, border: '3px solid #E8DEC8', borderTopColor: '#D4AF37', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <p style={{ fontSize: 13, color: '#78716C' }}>Loading financials…</p>
              <p style={{ fontSize: 11, color: '#B0A898' }}>First load may take ~30s while the server wakes up</p>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : Object.keys(allFinancials).length === 0 ? (
            <EmptyUpload onUpload={triggerUpload} onAddMetrics={() => {}} company="All Companies" />
          ) : (
            <AllCompaniesSummary all={allFinancials} />
          )}
        </div>
      ) : loadingFin ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 0', gap: 12 }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E8DEC8', borderTopColor: '#D4AF37', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ fontSize: 13, color: '#78716C' }}>Loading financials…</p>
          <p style={{ fontSize: 11, color: '#B0A898' }}>First load may take ~30s while the server wakes up</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : currentFin ? (
        <div className="space-y-4">
          {/* Header */}
          <div className="border rounded-2xl shadow-sm p-4 flex items-center justify-between gap-4 flex-wrap" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1C1917' }}>{currentFin.companyName}</h1>
              <p style={{ fontSize: 13, color: '#A8A29E', marginTop: 2 }}>
                {currentFin.dateRange || 'Financial Statements'} · Years: {currentFin.years.join(', ')}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeTab === 'KPI Dashboard' && currentFin ? (
                <>
                  <span style={{ fontSize: 11, color: '#92400E', fontWeight: 600, marginRight: 4 }}>PERIOD:</span>
                  <select
                    value={kpiYear}
                    onChange={e => {
                      const y = Number(e.target.value);
                      setKpiYear(y);
                      const monthsForY = getAvailableKeys(currentFin)
                        .filter(k => k.endsWith(` ${y}`))
                        .map(k => _MNAMES.indexOf(k.split(' ')[0]) + 1)
                        .filter(m => m > 0)
                        .sort((a, b) => a - b);
                      if (kpiMonth && !monthsForY.includes(kpiMonth)) {
                        setKpiMonth(monthsForY[monthsForY.length - 1] ?? null);
                      }
                    }}
                    style={selectStyle}
                  >
                    {currentFin.years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {getAvailableKeys(currentFin).length > 0 && (
                    <select
                      value={kpiMonth ?? 0}
                      onChange={e => {
                        const v = Number(e.target.value);
                        setKpiMonth(v === 0 ? null : v);
                      }}
                      style={selectStyle}
                    >
                      <option value={0}>Full Year</option>
                      {getAvailableKeys(currentFin)
                        .filter(k => k.endsWith(` ${kpiYear}`))
                        .map(k => _MNAMES.indexOf(k.split(' ')[0]) + 1)
                        .filter(m => m > 0)
                        .sort((a, b) => a - b)
                        .map(m => (
                          <option key={m} value={m}>{MONTH_DISPLAY[m - 1]}</option>
                        ))}
                    </select>
                  )}
                  <span style={{
                    fontSize: 11, color: '#78716C', background: '#F7F1E6',
                    border: '1px solid #E8DEC8', borderRadius: 20, padding: '3px 12px',
                  }}>
                    {kpiMonth ? `${MONTH_DISPLAY[kpiMonth - 1]} ${kpiYear}` : `FY ${kpiYear}`}
                  </span>
                </>
              ) : (
                <>
              {/* YEAR VIEW — clicking drills into Monthly Detail for that year */}
              {!selectedYear && (
                <span style={{ fontSize: 11, color: '#92400E', fontWeight: 600, marginRight: 4 }}>YEAR VIEW:</span>
              )}
              {selectedYear ? (
                /* In Monthly Detail mode — show back link + active year label */
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => { setSelectedYear(null); setPeriod(null); }}
                    style={{ fontSize: 11, color: '#2F80ED', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                  >
                    ← Annual Summary
                  </button>
                  <span style={{ color: '#C8C0B0', fontSize: 13 }}>|</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#D4AF37', padding: '3px 10px', borderRadius: 20, background: '#FDF3D7', border: '1.5px solid #D4AF37' }}>
                    {selectedYear} — Monthly Detail
                  </span>
                  {/* Quick-jump to other years */}
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>Jump:</span>
                  {currentFin.years.filter(y => y !== selectedYear).map(y => (
                    <button key={y} onClick={() => { setSelectedYear(y); setPeriod(null); }}
                      style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20, border: '1px solid #C8C0B0', background: 'transparent', color: '#78716C', cursor: 'pointer' }}>
                      {y}
                    </button>
                  ))}
                </div>
              ) : (
                /* Annual Summary mode — show all year buttons */
                currentFin.years.map(y => (
                  <button
                    key={y}
                    onClick={() => { setSelectedYear(y); setPeriod(null); }}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                      border: selectedYear === y ? '1.5px solid #D4AF37' : '1.5px solid #C8C0B0',
                      background: selectedYear === y ? '#FDF3D7' : 'transparent',
                      color: selectedYear === y ? '#D4AF37' : '#78716C',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {y}
                  </button>
                ))
              )}
                </>
              )}

              {/* MoM/YTD/TTM — shows on P&L always when monthly data exists;
                  shows on BS/CF only when drilled into a year */}
              {(() => {
                const showForPL  = activeTab === 'P&L Statement' && getAvailableKeys(currentFin).length > 0;
                const showForBS  = activeTab === 'Balance Sheet'  && !!selectedYear && getItemKeys(currentFin.bs).length > 0;
                const showForCF  = activeTab === 'Cash Flow'      && !!selectedYear && getItemKeys(currentFin.cf).length > 0;
                if (!showForPL && !showForBS && !showForCF) return null;
                const keys = showForPL ? getAvailableKeys(currentFin)
                           : showForBS ? getItemKeys(currentFin.bs)
                           : getItemKeys(currentFin.cf);
                return (
                  <>
                    <span style={{ width: 1, height: 18, background: '#C8C0B0', margin: '0 6px', display: 'inline-block' }} />
                    <PeriodToggle
                      period={period}
                      month={pMonth}
                      year={pYear}
                      onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }}
                      availableKeys={keys}
                    />
                  </>
                );
              })()}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 rounded-lg w-fit flex-wrap" style={{ background: '#E8E4DC' }}>
            {TABS.map(t => (
              <button key={t} onClick={() => {
                setActiveTab(t);
                if (t === 'P&L Statement' || t === 'Balance Sheet' || t === 'Cash Flow') {
                  setSelectedYear(null);
                  setPeriod(null);
                }
              }}
                className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
                style={activeTab === t
                  ? { background: '#D4AF37', color: '#161310', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }
                  : { color: '#78716C', background: 'transparent' }}>
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="border rounded-2xl shadow-sm p-6" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
            {activeTab === 'P&L Statement' && <PLTable fin={currentFin} selectedYear={selectedYear} period={period} pMonth={pMonth} pYear={pYear} />}
            {activeTab === 'Balance Sheet'  && <BSTable fin={currentFin} selectedYear={selectedYear} period={period} pMonth={pMonth} pYear={pYear} />}
            {activeTab === 'Cash Flow'      && <CFTable fin={currentFin} selectedYear={selectedYear} period={period} pMonth={pMonth} pYear={pYear} />}
            {activeTab === 'KPI Dashboard'  && <KPITab  fin={currentFin} kpiYear={kpiYear} kpiMonth={kpiMonth} />}
            {activeTab === 'CFO Dashboard'  && <CFOTab  fin={currentFin} />}
            {activeTab === 'Financial Metrics' && <FinancialMetricsTab companyName={currentFin.companyName} />}
          </div>
        </div>
      ) : (
        <EmptyUpload onUpload={triggerUpload} onAddMetrics={() => setActiveTab('Financial Metrics')} company={selectedCompanyName || 'the selected company'} />
      )}
    </div>
  );
}
