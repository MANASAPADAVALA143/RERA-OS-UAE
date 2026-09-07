/**
 * Consultancy & Outsourcing — Financials & Risk / CFO View.
 * Copy-adapted from PropDevFinancials.tsx (same architecture: parseFinancialExcel upload,
 * local PL/BS/CF table renderers, label-pattern-matched KPI extraction) but scoped to this
 * segment's economics: Sales/Services/Other revenue split, Payroll as its own major P&L
 * section, Loans & Advances + Investments on the Balance Sheet, and a Financing/Loan
 * Movement breakout on the Cash Flow (related-party loan advances/repayments dominate here).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Upload, FileSpreadsheet, Building2, Download } from 'lucide-react';
import { useConsultancy } from '../../contexts/ConsultancyContext';
import api, { formatApiError, postJsonWithWake, withTimeout } from '../../services/api';
import { parseFinancialExcel } from '../../utils/financialExcelParser';
import { mergeUploadedFinancials, normalizeFinItems, tidyStatementRows, isDroppedStatementLineLabel, yearVal, yearsFromItems, yearsFromItemsWithNonZeroValues } from '../../utils/finItemYearUtils';
import PeriodToggle from '../../components/shared/PeriodToggle';
import { type Period, periodChipText, getPeriodFilterKeys } from '../../utils/periodWindow';
import { ParchmentKpiTile } from '../../components/ui/ParchmentKpiTile';
import { exportConsultancyCfoDashboardPdf } from '../../utils/consultancySectionPdfExport';
import { PT, PT_FONT, PT_CARD } from '../../utils/parchmentTypography';
import { ProfitWaterfallChart } from '../../components/rental/analytics/ProfitWaterfallChart';
import type { WaterfallRow } from '../../utils/rentalAnalyticsCharts';
import { BulletChartStrip, type BulletCard, type BulletDef } from '../../components/shared/BulletChartStrip';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConsultFinItem {
  label: string;
  values: Record<number, number>;
  monthlyValues?: Record<string, number>;
  indent: number;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
}

interface ConsultFinancials {
  companyName: string;
  years: number[];
  plFile: string; bsFile: string; cfFile?: string;
  uploadedAt: string;
  pl: ConsultFinItem[]; bs: ConsultFinItem[]; cf: ConsultFinItem[];
}

type SubTab =
  | 'P&L Statement' | 'Balance Sheet' | 'Cash Flow' | 'KPI Dashboard' | 'CFO Dashboard'
  | 'AR Dashboard' | 'Expenses' | 'Profitability' | 'Financial Ratios' | 'Financial Metrics'
  | 'Action Plan' | 'Calculations';
const SUB_TABS: SubTab[] = [
  'P&L Statement', 'Balance Sheet', 'Cash Flow', 'KPI Dashboard', 'CFO Dashboard',
  'AR Dashboard', 'Expenses', 'Profitability', 'Financial Ratios', 'Financial Metrics',
  'Action Plan', 'Calculations',
];

type ProfitabilitySubTab = 'Profitability' | 'Cash & Debt' | 'Exceptions';
const PROFITABILITY_SUB_TABS: ProfitabilitySubTab[] = ['Profitability', 'Cash & Debt', 'Exceptions'];

const P = { gold: PT.gold, teal: PT.teal, green: PT.green, red: PT.red, amber: '#F2C14E', blue: PT.blue, border: PT.border };
const CHART_TICK = PT_FONT.chartTick;
const CHART_TOOLTIP = PT_FONT.tooltip;
const CHART_LEGEND = { wrapperStyle: PT_FONT.legend };
const DONUT_COLORS = [P.gold, P.teal, P.green, P.blue, P.amber, P.red, '#7C3AED', '#64748B'];

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
}
function fmtPct(n: number | null): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

/** Cap statement/chart years to the selected as-of year (e.g. YTD 2025 hides 2026). */
function yearsThrough(years: number[], asOfYear: number): number[] {
  return years.filter(y => y <= asOfYear).sort((a, b) => a - b);
}

// ── KPI extraction — label-pattern matched, same style as PropDev's pdKpis() ───

function cYV(items: ConsultFinItem[], pat: RegExp, y: number): number {
  return yearVal(items.find(i => pat.test(i.label))?.values, y);
}
function cSumI(items: ConsultFinItem[], pat: RegExp, y: number): number {
  return items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label))
    .reduce((s, i) => s + yearVal(i.values, y), 0);
}
/** Prefer an explicit "Total for X" row over a same-named section header (which always
 * carries 0) — cYV's plain find() can match the header first since both share the label. */
function cTotalOrSum(items: ConsultFinItem[], pat: RegExp, y: number): number {
  const total = items.find(i => i.isTotal && pat.test(i.label));
  if (total) return yearVal(total.values, y);
  return cSumI(items, pat, y);
}

export interface ConsultKpis {
  salesRev: number; servicesRev: number; otherRev: number; rev: number;
  payroll: number; exp: number; netInc: number; interestExpense: number;
  grossMargin: number | null; netMargin: number | null; payrollPctRev: number | null;
  ar: number; cash: number; loansAdvances: number;
}

/** Single source of truth for "cash" across every Consultancy view (CFO Dashboard,
 * Executive Summary, Financial Metrics, Cash & Debt, Calculations, PDF export) — prefer
 * the Balance Sheet's own "Total for Bank Accounts" subtotal row; only sum individual
 * bank/cash/checking lines when that named subtotal row isn't present in the upload.
 * `getVal` picks the annual value[year] or a specific monthlyValues[key], so callers
 * needing full-year vs a specific month/period both go through this one function. */
function cashFromBs(b: ConsultFinItem[], getVal: (item: ConsultFinItem) => number): number {
  const totalRow = b.find(i => /^total\s+for\s+bank/i.test(i.label.trim()));
  if (totalRow) return Math.abs(getVal(totalRow));
  return Math.abs(
    b.filter(i => !i.isSectionHeader && !i.isTotal && /bank|cash|checking/i.test(i.label))
      .reduce((s, i) => s + getVal(i), 0),
  );
}

/** Real bottom-line Net Income row — NOT just the first isNetIncome-flagged row. The
 * shared parser's isNetIncomeLabel() also matches "Net Operating Income" (a distinct,
 * earlier subtotal before any Other Income/Other Expenses adjustments), so when both
 * exist, .find() naively grabbed NOI instead of the true final Net Income. Prefer a row
 * labeled exactly "Net Income"; otherwise fall back to the LAST flagged row, since the
 * real bottom line always sits at or near the end of the P&L, never the start. */
function findNetIncomeItem(p: ConsultFinItem[]): ConsultFinItem | undefined {
  const candidates = p.filter(i => i.isNetIncome);
  return candidates.find(i => /^net\s+income$/i.test(i.label.trim())) ?? candidates[candidates.length - 1];
}

function consultKpis(fin: ConsultFinancials, y: number): ConsultKpis {
  const p = fin.pl; const b = fin.bs;
  const salesRev = Math.abs(cTotalOrSum(p, /^sales(\s+revenue)?$/i, y)) || Math.abs(cSumI(p, /sales/i, y));
  const servicesRev = Math.abs(cTotalOrSum(p, /^services?(\s+revenue)?$/i, y)) || Math.abs(cSumI(p, /service/i, y));
  const otherRev = Math.abs(cTotalOrSum(p, /^other(\s+(income|revenue))?$/i, y));
  // The real "Total Income" row is the source of truth for the headline Revenue KPI —
  // NOT the sales/services/other buckets below. Real uploads routinely carry revenue
  // lines (e.g. "Rental Income - 7000 Parkwood") that don't match any of those three
  // patterns; summing only the buckets silently drops them whenever Sales or Services
  // alone already produce a non-zero total, which a "fall back only on exact zero" rule
  // never catches. The buckets are kept only for the Revenue Mix chart's category split.
  let rev = Math.abs(cYV(p, /^total\s+(for\s+)?income$/i, y) || cYV(p, /^total\s+revenue$/i, y));
  if (rev === 0) rev = salesRev + servicesRev + otherRev;
  if (rev === 0) rev = Math.abs(sectionItems(p, /income|revenue/i).reduce((s, i) => s + yearVal(i.values, y), 0));
  // Same "prefer the real subtotal row" fix as Revenue — "Bonus" and similar payroll-
  // adjacent lines routinely don't match the salary/wages/tax/per-diem label patterns
  // below, so they were silently excluded even though the real "Total for Payroll
  // expenses" row (when present) already accounts for them correctly.
  const payroll = Math.abs(
    cYV(p, /^total\s+for\s+payroll(\s+expenses?)?$/i, y)
    || cTotalOrSum(p, /^payroll$/i, y)
    || cSumI(p, /salar|wages?|payroll\s+tax|per\s+diem|employee\s+housing/i, y),
  );
  const exp = Math.abs(cYV(p, /^total\s+(for\s+)?expenses?$/i, y));
  const netInc = yearVal(findNetIncomeItem(p)?.values, y);
  const interestExpense = Math.abs(cSumI(p, /interest/i, y));
  // Payroll is the primary direct delivery cost in a staffing business — Gross Margin
  // here means Revenue less Payroll, distinct from Net Margin (after all opex/finance).
  const grossMargin = rev > 0 ? ((rev - payroll) / rev) * 100 : null;
  const netMargin = rev > 0 ? (netInc / rev) * 100 : null;
  const payrollPctRev = rev > 0 ? (payroll / rev) * 100 : null;
  const ar = Math.abs(cTotalOrSum(b, /accounts?\s+receivable/i, y) || cSumI(b, /receivable/i, y));
  const cash = cashFromBs(b, i => yearVal(i.values, y));
  const loansAdvances = Math.abs(
    cTotalOrSum(b, /loans?\s*(&|and)?\s*advances?/i, y)
    || cSumI(b, /(?=.*loans?\b)(?=.*advances?\b)/i, y),
  );
  return { salesRev, servicesRev, otherRev, rev, payroll, exp, netInc, interestExpense, grossMargin, netMargin, payrollPctRev, ar, cash, loansAdvances };
}

/** Period-scoped mirror of consultKpis() — same preference order for every field (real
 * subtotal row first, label-pattern sum as fallback), just summed over `keys` via
 * monthlyValues instead of reading values[year]. Exists so the CFO Dashboard's period
 * toggle can consistently override EVERY figure for the toggled year — Multi-Year
 * Snapshot row, Revenue Mix/Opex Breakdown slices, and the trend charts — not just the
 * 4 header KPI tiles, which previously left the rest of the page silently showing
 * full-year data regardless of the selected period. Returns null when the upload has no
 * monthly granularity for these keys (annual-only data). */
export function consultKpisForPeriod(fin: ConsultFinancials, keys: string[]): ConsultKpis | null {
  const p = fin.pl; const b = fin.bs;
  const hasMonthly = [...p, ...b].some(i => i.monthlyValues && keys.some(k => i.monthlyValues![k] != null));
  if (!hasMonthly) return null;
  const lastKey = keys[keys.length - 1];
  const sum = (items: ConsultFinItem[], pat: RegExp) =>
    items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label))
      .reduce((s, i) => s + periodVal(keys)(i), 0);
  const totalRow = (items: ConsultFinItem[], pat: RegExp) => {
    const row = items.find(i => i.isTotal && pat.test(i.label.trim()));
    return row ? periodVal(keys)(row) : 0;
  };

  const salesRev = Math.abs(sum(p, /sales/i));
  const servicesRev = Math.abs(sum(p, /service/i));
  const otherRev = Math.abs(sum(p, /^other(\s+(income|revenue))?$/i));
  let rev = Math.abs(totalRow(p, /^total\s+(for\s+)?income$/i) || totalRow(p, /^total\s+revenue$/i));
  if (rev === 0) rev = salesRev + servicesRev + otherRev;
  if (rev === 0) rev = Math.abs(sectionItems(p, /income|revenue/i).reduce((s, i) => s + periodVal(keys)(i), 0));

  let payroll = Math.abs(totalRow(p, /^total\s+for\s+payroll(\s+expenses?)?$/i) || totalRow(p, /^payroll$/i));
  if (payroll === 0) payroll = Math.abs(sum(p, /salar|wages?|payroll\s+tax|per\s+diem|employee\s+housing/i));

  const exp = Math.abs(totalRow(p, /^total\s+(for\s+)?expenses?$/i));
  const netIncItem = findNetIncomeItem(p);
  const netInc = netIncItem ? periodVal(keys)(netIncItem) : 0;
  const interestExpense = Math.abs(sum(p, /interest/i));
  const grossMargin = rev > 0 ? ((rev - payroll) / rev) * 100 : null;
  const netMargin = rev > 0 ? (netInc / rev) * 100 : null;
  const payrollPctRev = rev > 0 ? (payroll / rev) * 100 : null;

  const arTotal = b.find(i => i.isTotal && /accounts?\s+receivable/i.test(i.label.trim()));
  const ar = Math.abs(arTotal ? (arTotal.monthlyValues?.[lastKey] ?? 0)
    : b.filter(i => !i.isSectionHeader && !i.isTotal && /receivable/i.test(i.label)).reduce((s, i) => s + (i.monthlyValues?.[lastKey] ?? 0), 0));
  const cash = cashFromBs(b, i => i.monthlyValues?.[lastKey] ?? 0);
  const loansTotal = b.find(i => i.isTotal && /loans?\s*(&|and)?\s*advances?/i.test(i.label.trim()));
  const loansAdvances = Math.abs(loansTotal ? (loansTotal.monthlyValues?.[lastKey] ?? 0)
    : b.filter(i => !i.isSectionHeader && !i.isTotal && /(?=.*loans?\b)(?=.*advances?\b)/i.test(i.label)).reduce((s, i) => s + (i.monthlyValues?.[lastKey] ?? 0), 0));

  return { salesRev, servicesRev, otherRev, rev, payroll, exp, netInc, interestExpense, grossMargin, netMargin, payrollPctRev, ar, cash, loansAdvances };
}

/** Non-payroll P&L expense line items — the "expense category" set for the Expenses tab
 * breakdown. Payroll is excluded here since it's isolated as its own callout (dominant
 * cost driver). Scoped structurally to the Expenses section (via sectionItems) rather
 * than excluding revenue by label pattern — real-world revenue labels ("Consulting Fees",
 * "Retainer Income", "Project Revenue", etc.) don't match a fixed sales/services/other
 * regex, so a label-based revenue exclusion silently let revenue lines leak into "expense"
 * categories; scoping to the actual Expenses section avoids that entirely. */
const PAYROLL_LABEL_RE = /salar|wages?|payroll\s+tax|per\s+diem|employee\s+housing|^payroll$/i;
function plExpenseCategoryItems(pl: ConsultFinItem[]): ConsultFinItem[] {
  return sectionItems(pl, /expense/i).filter(i => !i.isNetIncome && !PAYROLL_LABEL_RE.test(i.label.trim()));
}

/** Named receivable sub-accounts on the Balance Sheet (not the rolled-up total). */
function bsReceivableSubAccounts(bs: ConsultFinItem[]): ConsultFinItem[] {
  return bs.filter(i => !i.isSectionHeader && !i.isTotal && /receivable/i.test(i.label));
}

/** Revenue → Operating Expenses → Payroll → Interest → Net Income bridge. Payroll and
 * interest are broken out from the "Total Expenses" line since they're the two cost
 * drivers CFO Insights and Action Plan already track separately for this segment. */
function buildConsultWaterfall(k: ConsultKpis): WaterfallRow[] {
  const revenue = k.rev;
  const opex = Math.max(0, k.exp - k.payroll - k.interestExpense);
  const afterOpex = revenue - opex;
  const afterPayroll = afterOpex - k.payroll;
  const afterInterest = afterPayroll - k.interestExpense;
  const net = k.netInc;
  return [
    { label: 'Revenue', invisible: 0, bar: revenue, fill: P.gold },
    { label: 'Operating Expenses', invisible: Math.max(0, afterOpex), bar: opex, fill: P.red },
    { label: 'Payroll', invisible: Math.max(0, afterPayroll), bar: k.payroll, fill: '#B45309' },
    { label: 'Interest', invisible: Math.max(0, afterInterest), bar: k.interestExpense, fill: '#7C3AED' },
    { label: 'Net Income', invisible: 0, bar: net, fill: net >= 0 ? '#1D4ED8' : '#C0392B' },
  ];
}

function getConsultAvailableKeys(fin: ConsultFinancials): string[] {
  const keys = new Set<string>();
  for (const item of [...fin.pl, ...fin.bs]) {
    if (item.monthlyValues) Object.keys(item.monthlyValues).forEach(k => keys.add(k));
  }
  return [...keys];
}

// ── Table renderers ──────────────────────────────────────────────────────────

function rowBg(item: ConsultFinItem): string {
  if (item.isNetIncome) return 'bg-gray-900 text-white font-bold';
  if (item.isTotal) return 'bg-blue-50 font-semibold text-blue-900 border-t border-blue-200';
  if (item.isSectionHeader) return 'bg-amber-50 text-amber-800 font-semibold text-xs uppercase tracking-wide';
  return 'hover:bg-gray-50 text-gray-700';
}
function rowPad(item: ConsultFinItem): string {
  return item.isTotal || item.isSectionHeader ? 'px-4' : item.indent > 4 ? 'pl-12 pr-4' : item.indent > 1 ? 'pl-8 pr-4' : 'pl-5 pr-4';
}

function StatementTable({ items, years, labelCol, emptyMessage }: {
  items: ConsultFinItem[]; years: number[]; labelCol: string; emptyMessage: string;
}) {
  const visible = items.filter(item => !isDroppedStatementLineLabel(item.label));
  if (!visible.length) return <p className="text-center text-gray-400 py-12 text-sm">{emptyMessage}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead><tr className="bg-gray-900 text-white">
          <th className="text-left px-4 py-2.5 w-72">{labelCol}</th>
          {years.map(y => <th key={y} className="text-right px-3 py-2.5 min-w-[110px]">{y}</th>)}
        </tr></thead>
        <tbody>
          {visible.map((item, i) => (
            <tr key={i} className={`border-t border-gray-100 ${rowBg(item)}`}>
              <td className={`py-1.5 ${rowPad(item)}`}>{item.label}</td>
              {years.map(y => {
                const v = yearVal(item.values, y);
                return (
                  <td key={y} className={`py-1.5 px-3 text-right font-mono ${item.isNetIncome ? 'text-white' : v < 0 ? 'text-red-600' : ''}`}>
                    {v === 0 ? (item.isSectionHeader ? '' : '—') : fmtUsd(v)}
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

/** Cash Flow's Financing Activity / Loan Movement breakout — related-party loan
 * advances/repayments dominate this statement, so a plain 3-section CF table
 * understates how noisy it is; surface those lines as their own mini-table too. */
function LoanMovementTable({ cf, years }: { cf: ConsultFinItem[]; years: number[] }) {
  const rows = cf.filter(i => !i.isSectionHeader && /loan|advance/i.test(i.label));
  if (!rows.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Financing Activity — Loan Movement</p>
      <StatementTable items={rows} years={years} labelCol="Line Item" emptyMessage="No loan movement lines found." />
    </div>
  );
}

// ── KPI Dashboard ────────────────────────────────────────────────────────────

function KpiDashboard({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const k = useMemo(() => consultKpis(fin, year), [fin, year]);
  const idx = fin.years.indexOf(year);
  const prevYear = idx > 0 ? fin.years[idx - 1] : null;
  const prevK = prevYear != null ? consultKpis(fin, prevYear) : null;
  const revGrowth = prevK && prevK.rev > 0 ? ((k.rev - prevK.rev) / prevK.rev) * 100 : null;
  const netCf = k.rev - k.exp;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <ParchmentKpiTile label="Revenue" value={fmtUsd(k.rev)} accent />
      <ParchmentKpiTile label="Sales Revenue" value={fmtUsd(k.salesRev)} />
      <ParchmentKpiTile label="Services Revenue" value={fmtUsd(k.servicesRev)} />
      <ParchmentKpiTile label="Gross Margin %" value={fmtPct(k.grossMargin)} />
      <ParchmentKpiTile label="Net Margin %" value={fmtPct(k.netMargin)} warn={(k.netMargin ?? 0) < 0} />
      <ParchmentKpiTile label="Payroll Cost" value={fmtUsd(k.payroll)} />
      <ParchmentKpiTile label="Payroll % of Revenue" value={fmtPct(k.payrollPctRev)} warn={(k.payrollPctRev ?? 0) > 70} />
      <ParchmentKpiTile label="AR Balance" value={fmtUsd(k.ar)} />
      <ParchmentKpiTile label="Cash Balance" value={fmtUsd(k.cash)} warn={k.cash <= 0} />
      <ParchmentKpiTile label="Loans & Advances" value={fmtUsd(k.loansAdvances)} />
      <ParchmentKpiTile label="Revenue Growth (YoY)" value={revGrowth != null ? fmtPct(revGrowth) : '—'} />
      <ParchmentKpiTile label="Net Cash Flow" value={fmtUsd(netCf)} />
    </div>
  );
}

// ── CFO Dashboard ────────────────────────────────────────────────────────────

interface ConsultInsight { color: string; text: string; }

function buildConsultInsights(fin: ConsultFinancials): ConsultInsight[] {
  const insights: ConsultInsight[] = [];
  const years = fin.years;
  if (years.length < 1) return insights;
  const lastY = years[years.length - 1];
  const k = consultKpis(fin, lastY);
  const prevY = years.length > 1 ? years[years.length - 2] : null;
  const prevK = prevY != null ? consultKpis(fin, prevY) : null;

  if (k.payrollPctRev != null && k.payrollPctRev > 70) {
    insights.push({ color: 'bg-red-50 border-red-200', text: `⚠️ Payroll is ${k.payrollPctRev.toFixed(1)}% of revenue for ${lastY} — above the typical 70% threshold for staffing margins.` });
  }
  if (prevK && prevK.rev > 0 && prevK.ar > 0 && k.rev > 0) {
    const revGrowth = (k.rev - prevK.rev) / prevK.rev;
    const arGrowth = (k.ar - prevK.ar) / prevK.ar;
    if (arGrowth > revGrowth + 0.1) {
      insights.push({ color: 'bg-amber-50 border-amber-200', text: `📈 Accounts Receivable grew ${(arGrowth * 100).toFixed(1)}% vs revenue growth of ${(revGrowth * 100).toFixed(1)}% — collections may be slipping behind billing.` });
    }
    if (prevK.loansAdvances > 0) {
      const loanGrowth = (k.loansAdvances - prevK.loansAdvances) / prevK.loansAdvances;
      if (loanGrowth > revGrowth + 0.1) {
        insights.push({ color: 'bg-amber-50 border-amber-200', text: `🏦 Loans & Advances grew ${(loanGrowth * 100).toFixed(1)}% vs revenue growth of ${(revGrowth * 100).toFixed(1)}% — the business is leaning more on related-party financing relative to its growth.` });
      }
    }
  }
  if (k.netInc < 0 && k.cash <= 0) {
    insights.push({ color: 'bg-red-50 border-red-200', text: `🔴 ${lastY}: negative net income and no cash on the books — operations are being financed externally.` });
  } else if (k.netInc < 0) {
    insights.push({ color: 'bg-gray-50 border-gray-200', text: `ℹ️ ${lastY}: net income is negative (${fmtUsd(k.netInc)}) — confirm whether this is covered by financing activity rather than operating cash.` });
  }

  // Interest expense as % of revenue, with dollar context.
  if (k.interestExpense > 0 && k.rev > 0) {
    const interestPctRev = (k.interestExpense / k.rev) * 100;
    if (interestPctRev > 5) {
      insights.push({ color: 'bg-amber-50 border-amber-200', text: `💰 Interest expense is ${fmtUsd(k.interestExpense)} (${interestPctRev.toFixed(1)}% of revenue) for ${lastY} — above a typical 5% threshold, financing costs are eating into margin.` });
    }
  }

  // Payroll % threshold breach, with trend direction vs prior year.
  if (k.payrollPctRev != null && k.payrollPctRev > 70 && prevK?.payrollPctRev != null) {
    const delta = k.payrollPctRev - prevK.payrollPctRev;
    const direction = delta > 0.5 ? 'worsening' : delta < -0.5 ? 'improving' : 'flat';
    insights.push({ color: 'bg-red-50 border-red-200', text: `⚠️ Payroll % of revenue is ${direction} — ${k.payrollPctRev.toFixed(1)}% in ${lastY} vs ${prevK.payrollPctRev.toFixed(1)}% in ${prevY} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts).` });
  }

  // Any expense category growing disproportionately vs revenue.
  if (prevK && prevK.rev > 0 && k.rev > 0) {
    const revGrowth = (k.rev - prevK.rev) / prevK.rev;
    const categories = plExpenseCategoryItems(fin.pl);
    for (const item of categories) {
      const cur = Math.abs(item.values[lastY] ?? 0);
      const prevVal = prevY != null ? Math.abs(item.values[prevY] ?? 0) : 0;
      if (prevVal <= 0 || cur <= 0) continue;
      const growth = (cur - prevVal) / prevVal;
      if (growth > revGrowth + 0.25 && cur > k.rev * 0.03) {
        insights.push({ color: 'bg-amber-50 border-amber-200', text: `📊 "${item.label}" grew ${(growth * 100).toFixed(1)}% vs revenue growth of ${(revGrowth * 100).toFixed(1)}% — this expense category is outpacing the business.` });
        break; // surface the single most notable outlier, not every category
      }
    }
  }

  // Cash runway relative to monthly payroll burn.
  const monthlyPayroll = k.payroll / 12;
  if (monthlyPayroll > 0) {
    const cashMonths = k.cash / monthlyPayroll;
    if (cashMonths < 3) {
      insights.push({ color: 'bg-red-50 border-red-200', text: `🏃 Cash on hand covers only ${cashMonths.toFixed(1)} months of payroll (${fmtUsd(k.cash)} vs ${fmtUsd(monthlyPayroll)}/mo) — below the 3-month runway target.` });
    }
  }

  return insights;
}

function CfoDashboard({ fin, period, pMonth, pYear }: {
  fin: ConsultFinancials; period: Period | null; pMonth: number; pYear: number;
}) {
  const periodKeys = useMemo(() => (period ? getPeriodFilterKeys(period, pMonth, pYear) : null), [period, pMonth, pYear]);
  const periodKpis = useMemo(() => (periodKeys ? consultKpisForPeriod(fin, periodKeys) : null), [fin, periodKeys]);

  // Cap every multi-year view to the selected as-of year so choosing 2025 never shows 2026.
  const viewYears = useMemo(() => yearsThrough(fin.years, pYear), [fin.years, pYear]);

  // Every figure on this page for the currently-toggled year reflects the selected period
  // when one's active — Multi-Year Snapshot's current-year row, Revenue Mix/Opex
  // Breakdown slices, and every trend chart, not just the 4 header KPI tiles. Previously
  // only the header tiles were period-aware, so toggling to "YTD Jan-Mar 2026" left the
  // rest of the page silently showing the full uploaded range (e.g. through July) for
  // that same year. Other years are untouched — they're already complete calendar years.
  const snapshots = useMemo(() => viewYears.map(y => {
    const annual = { year: y, ...consultKpis(fin, y) };
    return periodKpis && y === pYear ? { ...annual, ...periodKpis } : annual;
  }), [fin, periodKpis, pYear, viewYears]);
  // Headline = selected as-of year (pYear), NOT the latest year in the upload.
  const focus = snapshots.find(s => s.year === pYear) ?? snapshots[snapshots.length - 1] ?? null;
  const insights = useMemo(() => buildConsultInsights(fin), [fin]);
  const focusYear = focus?.year ?? pYear;
  const periodLabel = period ? periodChipText(period, pMonth, pYear) : `FY ${focusYear}`;
  const headline = focus
    ? { rev: focus.rev, netInc: focus.netInc, payroll: focus.payroll, payrollPctRev: focus.payrollPctRev, cash: focus.cash, label: periodLabel }
    : null;

  const waterfall = useMemo(() => (focus ? buildConsultWaterfall(focus) : []), [focus]);

  const [drillRevenueType, setDrillRevenueType] = useState<string | null>(null);
  const [drillOpexCat, setDrillOpexCat] = useState<string | null>(null);

  // Real per-line-item categories — not a lumped "Services"/"Other Opex" bucket. Revenue
  // Mix pulls every actual line from the P&L's Income section; Opex Breakdown isolates
  // Payroll as its own slice (the dominant cost driver) and expands everything else into
  // its real sub-categories via plExpenseCategoryItems. Sums over the same period-scoped
  // keys as everything else above when a period is toggled, full-year otherwise.
  const categoryGetVal = periodKeys ? periodVal(periodKeys) : annualVal(focusYear ?? 0);
  const revenueMix = useMemo(
    () => (focusYear != null ? buildCategorySlices(sectionItems(fin.pl, /income|revenue/i), categoryGetVal) : []),
    [fin.pl, focusYear, categoryGetVal],
  );
  const otherOpexSlices = useMemo(
    () => (focusYear != null ? buildCategorySlices(plExpenseCategoryItems(fin.pl), categoryGetVal, 6) : []),
    [fin.pl, focusYear, categoryGetVal],
  );
  const opexBreakdown = useMemo((): CategorySlice[] => {
    const payrollItems = fin.pl.filter(i => !i.isSectionHeader && !i.isTotal && PAYROLL_LABEL_RE.test(i.label));
    const payrollSlice: CategorySlice[] = focus && focus.payroll > 0
      ? [{ name: 'Payroll', value: focus.payroll, items: payrollItems }]
      : [];
    return [...payrollSlice, ...otherOpexSlices];
  }, [focus, otherOpexSlices, fin.pl]);

  const revenueDrillItems = useMemo(
    () => revenueMix.find(s => s.name === drillRevenueType)?.items ?? [],
    [drillRevenueType, revenueMix],
  );
  const opexDrillItems = useMemo(
    () => opexBreakdown.find(s => s.name === drillOpexCat)?.items ?? [],
    [drillOpexCat, opexBreakdown],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ParchmentKpiTile label="Revenue" value={fmtUsd(headline?.rev ?? 0)} accent />
        <ParchmentKpiTile label="Net Income" value={fmtUsd(headline?.netInc ?? 0)} warn={(headline?.netInc ?? 0) < 0} />
        <ParchmentKpiTile label="Payroll % of Revenue" value={fmtPct(headline?.payrollPctRev ?? null)} />
        <ParchmentKpiTile label="Cash" value={fmtUsd(headline?.cash ?? 0)} />
      </div>
      {period && (
        <p className="text-[11px] text-gray-400">
          {periodKpis ? `Showing ${headline?.label}` : `${period} view requested but this upload has no monthly data — showing FY ${focusYear} instead.`}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Multi-Year Financial Snapshot</p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-500 uppercase text-[10px]">
                <th className="text-left py-1">Year</th><th className="text-right py-1">Revenue</th>
                <th className="text-right py-1">Payroll</th><th className="text-right py-1">Net Income</th>
              </tr></thead>
              <tbody>
                {snapshots.map(s => (
                  <tr key={s.year} className="border-t border-gray-100">
                    <td className="py-1">{s.year}</td>
                    <td className="text-right py-1 font-mono">{fmtUsd(s.rev)}</td>
                    <td className="text-right py-1 font-mono">{fmtUsd(s.payroll)}</td>
                    <td className={`text-right py-1 font-mono ${s.netInc < 0 ? 'text-red-600' : ''}`}>{fmtUsd(s.netInc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Revenue Mix</p>
          <p style={PT_FONT.chartSubtitle}>Click a segment to drill into P&amp;L revenue lines</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={revenueMix} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}
                onClick={(d: { name?: string }) => setDrillRevenueType(prev => (prev === d.name ? null : (d.name ?? null)))}
                style={{ cursor: 'pointer' }}
              >
                {revenueMix.map((s, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} opacity={drillRevenueType && drillRevenueType !== s.name ? 0.4 : 1} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Opex Breakdown</p>
          <p style={PT_FONT.chartSubtitle}>Click a segment to drill into P&amp;L expense lines · Payroll isolated as the dominant slice</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={opexBreakdown} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}
                onClick={(d: { name?: string }) => setDrillOpexCat(prev => (prev === d.name ? null : (d.name ?? null)))}
                style={{ cursor: 'pointer' }}
              >
                {opexBreakdown.map((s, i) => (
                  <Cell key={i} fill={s.name === 'Payroll' ? P.red : DONUT_COLORS[i % DONUT_COLORS.length]} opacity={drillOpexCat && drillOpexCat !== s.name ? 0.4 : 1} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Revenue vs Expenses</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={snapshots.map(s => ({ year: s.year, rev: s.rev, exp: s.exp, netInc: s.netInc }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Bar dataKey="rev" name="Revenue" fill={P.gold} radius={[3, 3, 0, 0]} />
              <Bar dataKey="exp" name="Expenses" fill={P.red} radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="netInc" name="Net Income" stroke={P.green} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {(drillRevenueType || drillOpexCat) && (
        <div style={PT_CARD}>
          <div className="flex items-center justify-between mb-2">
            <p style={PT_FONT.chartTitle}>
              {drillRevenueType ? `Revenue drill-down · ${drillRevenueType}` : `Opex drill-down · ${drillOpexCat}`}
            </p>
            <button type="button" onClick={() => { setDrillRevenueType(null); setDrillOpexCat(null); }}
              className="text-xs text-gray-400 hover:text-gray-600">× clear</button>
          </div>
          <StatementTable
            items={drillRevenueType ? revenueDrillItems : opexDrillItems}
            years={viewYears} labelCol="Line Item" emptyMessage="No matching P&L lines found."
          />
        </div>
      )}

      <div style={PT_CARD}>
        <ProfitWaterfallChart
          data={waterfall}
          title="Revenue → Net Income Waterfall"
          subtitle={`Revenue → Operating Expenses → Payroll → Interest → Net Income · FY ${focusYear}`}
          embedded
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Cash Balance Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={snapshots.map(s => ({ year: s.year, cash: s.cash }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="cash" name="Cash" stroke={P.green} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>AR Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={snapshots.map(s => ({ year: s.year, ar: s.ar }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="ar" name="AR" stroke={P.blue} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Loans & Advances Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={snapshots.map(s => ({ year: s.year, loans: s.loansAdvances }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="loans" name="Loans & Advances" stroke={P.amber} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Balance Sheet</p>
        <ConsultancyBalanceSheetCharts fin={fin} year={focusYear} />
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide">CFO Insights</p>
        {insights.length === 0 && <p className="text-sm text-gray-400">No flags for the latest period.</p>}
        {insights.map((ins, i) => (
          <div key={i} className={`border rounded-lg p-4 ${ins.color}`}>
            <p className="text-sm text-gray-800">{ins.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AR Dashboard ─────────────────────────────────────────────────────────────
// Built from the uploaded P&L/BS/CF only — this segment has no invoicing/billing
// system to source true date-level aging from (that's a Phase 2 Billing &
// Collections data source), so this shows balance-over-time plus a drill-down into
// any named receivable sub-accounts, rather than fabricating 30/60/90 aging buckets.

function ArDashboard({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const trend = useMemo(() => fin.years.map(y => ({ year: y, ar: consultKpis(fin, y).ar })), [fin]);
  const subAccounts = useMemo(() => bsReceivableSubAccounts(fin.bs), [fin.bs]);
  const k = consultKpis(fin, year);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ParchmentKpiTile label="AR Balance" value={fmtUsd(k.ar)} accent />
        <ParchmentKpiTile label="AR % of Revenue" value={fmtPct(k.rev > 0 ? (k.ar / k.rev) * 100 : null)} />
      </div>

      <div style={PT_CARD}>
        <p style={PT_FONT.chartTitle}>AR Balance Trend</p>
        <p style={PT_FONT.chartSubtitle}>
          Point-in-time receivable balance per year — true invoice-level aging (30/60/90) isn&apos;t available
          from this data source (P&amp;L/Balance Sheet upload only, no billing/invoice detail).
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
            <XAxis dataKey="year" tick={CHART_TICK} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
            <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
            <Line type="monotone" dataKey="ar" name="AR Balance" stroke={P.blue} strokeWidth={2} dot />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {subAccounts.length > 1 && (
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Receivable Sub-Accounts</p>
          <p style={PT_FONT.chartSubtitle}>Named receivable lines from the uploaded Balance Sheet</p>
          <StatementTable items={subAccounts} years={fin.years} labelCol="Receivable" emptyMessage="No named receivable sub-accounts found." />
        </div>
      )}
    </div>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────

function ExpensesTab({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const k = consultKpis(fin, year);
  const [filterCat, setFilterCat] = useState<string | null>(null);

  const categories = useMemo(() => {
    const items = plExpenseCategoryItems(fin.pl);
    return items
      .map(i => ({ name: i.label, value: Math.abs(i.values[year] ?? 0) }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [fin.pl, year]);

  const expenseTrend = useMemo(
    () => fin.years.map(y => ({ year: y, expenses: consultKpis(fin, y).exp, payroll: consultKpis(fin, y).payroll })),
    [fin],
  );

  const drillItems = useMemo(() => {
    if (!filterCat) return [];
    return fin.pl.filter(i => !i.isSectionHeader && !i.isTotal && i.label === filterCat);
  }, [filterCat, fin.pl]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ParchmentKpiTile label="Total Expenses" value={fmtUsd(k.exp)} accent />
        <ParchmentKpiTile label="Payroll" value={fmtUsd(k.payroll)} warn={(k.payrollPctRev ?? 0) > 70} />
        <ParchmentKpiTile label="Payroll % of Revenue" value={fmtPct(k.payrollPctRev)} warn={(k.payrollPctRev ?? 0) > 70} />
        <ParchmentKpiTile label="Non-Payroll Opex" value={fmtUsd(Math.max(0, k.exp - k.payroll))} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Expense Breakdown by Category</p>
          <p style={PT_FONT.chartSubtitle}>Click a bar to see the underlying P&amp;L line item · Payroll excluded (shown separately)</p>
          <ResponsiveContainer width="100%" height={Math.max(180, categories.length * 32)}>
            <BarChart data={categories} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} horizontal={false} />
              <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <YAxis type="category" dataKey="name" width={140} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Bar
                dataKey="value" name="Amount" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}
                onClick={(d: { name?: string }) => setFilterCat(prev => (prev === d.name ? null : (d.name ?? null)))}
              >
                {categories.map((c, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} opacity={filterCat && filterCat !== c.name ? 0.4 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Expense Trend</p>
          <p style={PT_FONT.chartSubtitle}>Total expenses vs Payroll over time</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={expenseTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Line type="monotone" dataKey="expenses" name="Total Expenses" stroke={P.red} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="payroll" name="Payroll" stroke={P.amber} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {filterCat && (
        <div style={PT_CARD}>
          <div className="flex items-center justify-between mb-2">
            <p style={PT_FONT.chartTitle}>P&amp;L line item · {filterCat}</p>
            <button type="button" onClick={() => setFilterCat(null)} className="text-xs text-gray-400 hover:text-gray-600">× clear</button>
          </div>
          <StatementTable items={drillItems} years={fin.years} labelCol="Line Item" emptyMessage="No matching P&L line found." />
        </div>
      )}
    </div>
  );
}

// ── Profitability (sub-tabs: Profitability · Cash & Debt · Exceptions) ───────

const CONSULT_PROFITABILITY_BULLET_DEFS: BulletDef[] = [
  { names: ['Gross Margin %'], benchmark: 30, unit: '%', reversed: false, max: 60, extract: raw => parseFloat(raw) || 0 },
  { names: ['Net Margin %'], benchmark: 10, unit: '%', reversed: false, max: 30, extract: raw => parseFloat(raw) || 0 },
];

function ProfitabilitySubTab({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const k = consultKpis(fin, year);
  const waterfall = useMemo(() => buildConsultWaterfall(k), [k]);
  const cards: BulletCard[] = [
    { name: 'Gross Margin %', value: fmtPct(k.grossMargin), status: (k.grossMargin ?? 0) >= 30 ? 'good' : (k.grossMargin ?? 0) >= 15 ? 'watch' : 'critical' },
    { name: 'Net Margin %', value: fmtPct(k.netMargin), status: (k.netMargin ?? 0) >= 10 ? 'good' : (k.netMargin ?? 0) >= 0 ? 'watch' : 'critical' },
  ];
  return (
    <div className="space-y-6">
      <ProfitWaterfallChart
        data={waterfall}
        title="Profitability Waterfall"
        subtitle={`Revenue → Operating Expenses → Payroll → Interest → Net Income · FY ${year}`}
      />
      <BulletChartStrip
        cards={cards}
        defs={CONSULT_PROFITABILITY_BULLET_DEFS}
        title="Profitability Benchmarks"
        subtitle="Gross Margin (Revenue less Payroll) and Net Margin vs target thresholds"
      />
    </div>
  );
}

/** Total for a named CF section (Operating/Investing/Financing) — prefers the
 * section's own "Total for X" row, same lookup convention as cTotalOrSum. */
function cfSectionTotal(cf: ConsultFinItem[], pat: RegExp, y: number): number {
  // Priority 1: "Net cash provided/used by X activities" — exact QuickBooks CF subtotal label
  const netCashRow = cf.find(i => /net\s+cash/i.test(i.label) && pat.test(i.label));
  if (netCashRow) return netCashRow.values[y] ?? 0;
  // Priority 2: parser-flagged total row
  return cTotalOrSum(cf, pat, y);
}
/** Raw line items belonging to a named section (between its header row and its total
 * row) — used for CF Operating/Investing/Financing drill-downs and BS Asset/Liability
 * composition breakdowns alike, since both share the same header/total bracketing. */
function sectionItems(items: ConsultFinItem[], pat: RegExp): ConsultFinItem[] {
  const out: ConsultFinItem[] = [];
  let inSection = false;
  for (const item of items) {
    if (item.isSectionHeader) { inSection = pat.test(item.label); continue; }
    if (!inSection) continue;
    if (item.isTotal) { inSection = false; continue; }
    out.push(item);
  }
  return out;
}
const cfSectionItems = sectionItems;

interface CategorySlice { name: string; value: number; items: ConsultFinItem[] }
/** Real per-line-item donut slices — each actual P&L line gets its own slice instead of
 * being lumped into a single "Other" bucket. Only merges the smallest tail categories
 * once there are more than maxSlices, and never invents a zero-value category; genuinely-
 * zero items are simply omitted. `getVal` picks the annual value[year] or a period-summed
 * monthlyValues total, so annual and period-aware callers share this one function. */
function buildCategorySlices(items: ConsultFinItem[], getVal: (item: ConsultFinItem) => number, maxSlices = 7): CategorySlice[] {
  const raw = items
    .map(i => ({ name: i.label, value: Math.abs(getVal(i)), items: [i] }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value);
  if (raw.length <= maxSlices) return raw;
  const head = raw.slice(0, maxSlices - 1);
  const tail = raw.slice(maxSlices - 1);
  return [...head, { name: 'Other', value: tail.reduce((s, x) => s + x.value, 0), items: tail.flatMap(x => x.items) }];
}
function annualVal(year: number) {
  return (i: ConsultFinItem) => i.values[year] ?? 0;
}
function periodVal(keys: string[]) {
  return (i: ConsultFinItem) => keys.reduce((s, k) => s + (i.monthlyValues?.[k] ?? 0), 0);
}

function CashDebtSubTab({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const b = fin.bs; const cf = fin.cf;
  const [drillCfCat, setDrillCfCat] = useState<'Operating' | 'Investing' | 'Financing' | null>(null);

  const series = useMemo(() => fin.years.map(y => {
    const k = consultKpis(fin, y);
    const totalAssets = Math.abs(cYV(b, /^total\s+(for\s+)?assets$/i, y));
    const totalLiab = Math.abs(cYV(b, /^total\s+(for\s+)?liabilit(y|ies)$/i, y));
    const equity = Math.abs(cYV(b, /^total\s+(for\s+)?equity$/i, y));
    const debtToEquity = equity > 0 ? k.loansAdvances / equity : 0;
    const arDays = k.rev > 0 ? (k.ar / k.rev) * 365 : 0;
    const operating = cfSectionTotal(cf, /operating/i, y);
    const investing = cfSectionTotal(cf, /investing/i, y);
    const financing = cfSectionTotal(cf, /financing/i, y);
    return { year: y, totalAssets, totalLiab, equity, debtToEquity, arDays, loans: k.loansAdvances, cash: k.cash, operating, investing, financing };
  }), [fin, b, cf]);

  const last = series[series.length - 1];
  const cfPie = last
    ? [
        { name: 'Operating', value: Math.abs(last.operating) },
        { name: 'Investing', value: Math.abs(last.investing) },
        { name: 'Financing', value: Math.abs(last.financing) },
      ].filter(s => s.value > 0)
    : [];
  const cfDrillItems = drillCfCat
    ? cfSectionItems(cf, drillCfCat === 'Operating' ? /operating/i : drillCfCat === 'Investing' ? /investing/i : /financing/i)
    : [];

  return (
    <div className="space-y-6">
      <div style={PT_CARD}>
        <p style={PT_FONT.chartTitle}>Loan &amp; Advances Balance (Maturities not available)</p>
        <p style={PT_FONT.chartSubtitle}>
          No per-loan maturity schedule is available from this data source (Balance Sheet upload only) —
          showing the year-end Loans &amp; Advances balance instead.
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
            <XAxis dataKey="year" tick={CHART_TICK} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
            <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
            <Bar dataKey="loans" name="Loans & Advances" fill={P.amber} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Debt-to-Equity Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => `${v.toFixed(2)}x`} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="debtToEquity" name="Debt-to-Equity" stroke={P.red} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Total Assets Trajectory</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="totalAssets" name="Total Assets" stroke={P.teal} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Assets vs Liabilities</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Bar dataKey="totalAssets" name="Total Assets" fill={P.teal} radius={[3, 3, 0, 0]} />
              <Bar dataKey="totalLiab" name="Total Liabilities" fill={P.red} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Equity Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="equity" name="Equity" stroke={P.green} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={PT_CARD}>
        <p style={PT_FONT.chartTitle}>Cash Conversion Cycle</p>
        <p style={PT_FONT.chartSubtitle}>
          AR Days (DSO) only — DPO / AP-aging data isn&apos;t available from this data source, so a full
          cash conversion cycle can&apos;t be computed.
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
            <XAxis dataKey="year" tick={CHART_TICK} />
            <YAxis tick={CHART_TICK} />
            <Tooltip formatter={(v: number) => `${v.toFixed(0)} days`} contentStyle={CHART_TOOLTIP} />
            <Line type="monotone" dataKey="arDays" name="AR Days (DSO)" stroke={P.blue} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>CF Category Comparison</p>
          <p style={PT_FONT.chartSubtitle}>Operating / Investing / Financing by year</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Bar dataKey="operating" name="Operating" fill={P.gold} radius={[3, 3, 0, 0]} />
              <Bar dataKey="investing" name="Investing" fill={P.teal} radius={[3, 3, 0, 0]} />
              <Bar dataKey="financing" name="Financing" fill={P.amber} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Cumulative Cash Trend</p>
          <p style={PT_FONT.chartSubtitle}>Point-in-time cash balance per year — not a running sum</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="cash" name="Cash Balance" stroke={P.green} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>CF Source Breakdown by Year</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Bar dataKey="operating" name="Operating" stackId="cf" fill={P.gold} />
              <Bar dataKey="investing" name="Investing" stackId="cf" fill={P.teal} />
              <Bar dataKey="financing" name="Financing" stackId="cf" fill={P.amber} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>CF Breakdown · FY {year}</p>
          <p style={PT_FONT.chartSubtitle}>Click a segment to see the underlying Cash Flow lines</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={cfPie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}
                onClick={(d: { name?: string }) => setDrillCfCat(prev => (prev === d.name ? null : (d.name as 'Operating' | 'Investing' | 'Financing' | undefined) ?? null))}
                style={{ cursor: 'pointer' }}
              >
                {cfPie.map((s, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} opacity={drillCfCat && drillCfCat !== s.name ? 0.4 : 1} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {drillCfCat && (
        <div style={PT_CARD}>
          <div className="flex items-center justify-between mb-2">
            <p style={PT_FONT.chartTitle}>Cash Flow lines · {drillCfCat}</p>
            <button type="button" onClick={() => setDrillCfCat(null)} className="text-xs text-gray-400 hover:text-gray-600">× clear</button>
          </div>
          <StatementTable items={cfDrillItems} years={fin.years} labelCol="Line Item" emptyMessage="No matching Cash Flow lines found." />
        </div>
      )}
    </div>
  );
}

const EXCEPTION_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  critical: { bg: '#FEE2E2', color: '#B91C1C' },
  warning: { bg: '#FEF3C7', color: '#92400E' },
  ok: { bg: '#DCFCE7', color: '#166534' },
};

function ExceptionsSubTab({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const flags = useMemo(
    () => buildActionFlags(fin, year).filter(f => f.severity !== 'ok').sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1)),
    [fin, year],
  );
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Exceptions for FY {year} — reuses the same rule evaluations as the Action Plan tab. Worst status first.
      </p>
      <div style={{ background: '#FFFFFF', border: '1px solid #E8E9ED', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
          <thead>
            <tr style={{ background: '#F5EFE0', borderBottom: '1px solid #E8E9ED', textAlign: 'left' }}>
              {['Flag', 'Value', 'Status', 'Target'].map(h => (
                <th key={h} style={{ padding: '12px 16px', fontSize: 11, fontWeight: 600, color: '#78716C', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {flags.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#166534' }}>No exceptions — all tracked KPIs are healthy for FY {year}.</td></tr>
            ) : flags.map((f, i) => {
              const st = EXCEPTION_STATUS_STYLE[f.severity] ?? EXCEPTION_STATUS_STYLE.ok;
              return (
                <tr key={i} style={{ borderBottom: '1px solid rgba(232,222,200,0.6)' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 500, color: '#1C1917' }}>{f.title}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace' }}>{f.metric}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                      {f.severity === 'critical' ? 'Critical' : 'Warning'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', color: '#78716C' }}>{f.target}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProfitabilityTab({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const [sub, setSub] = useState<ProfitabilitySubTab>('Profitability');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b" style={{ borderColor: PT.border }}>
        {PROFITABILITY_SUB_TABS.map(t => (
          <button key={t} type="button" onClick={() => setSub(t)}
            className={`text-xs px-3 py-2 font-medium border-b-2 ${sub === t ? 'border-amber-600 text-amber-800' : 'border-transparent text-gray-500'}`}>
            {t}
          </button>
        ))}
      </div>
      {sub === 'Profitability' && <ProfitabilitySubTab fin={fin} year={year} />}
      {sub === 'Cash & Debt' && <CashDebtSubTab fin={fin} year={year} />}
      {sub === 'Exceptions' && <ExceptionsSubTab fin={fin} year={year} />}
    </div>
  );
}

// ── Financial Ratios ─────────────────────────────────────────────────────────

function FinancialRatios({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const k = consultKpis(fin, year);
  const b = fin.bs;
  const totalAssets = Math.abs(cYV(b, /^total\s+(for\s+)?assets$/i, year));
  const totalLiab = Math.abs(cYV(b, /^total\s+(for\s+)?liabilit(y|ies)$/i, year));
  const equity = Math.abs(cYV(b, /^total\s+(for\s+)?equity$/i, year));
  const currentAssets = Math.abs(cYV(b, /^total\s+(for\s+)?current\s+assets$/i, year)) || totalAssets;
  const currentLiab = Math.abs(cYV(b, /^total\s+(for\s+)?current\s+liabilit(y|ies)$/i, year)) || totalLiab;
  const currentRatio = currentLiab > 0 ? currentAssets / currentLiab : null;
  const debtToEquity = equity > 0 ? k.loansAdvances / equity : null;
  const arDays = k.rev > 0 ? (k.ar / k.rev) * 365 : null;
  const loansToAssets = totalAssets > 0 ? (k.loansAdvances / totalAssets) * 100 : null;
  const cashConversion = k.exp > 0 ? (k.rev - k.ar) / k.exp : null;

  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: 'Payroll % of Revenue', value: fmtPct(k.payrollPctRev), warn: (k.payrollPctRev ?? 0) > 70 },
    { label: 'Gross Margin %', value: fmtPct(k.grossMargin) },
    { label: 'Net Margin %', value: fmtPct(k.netMargin), warn: (k.netMargin ?? 0) < 0 },
    { label: 'AR Days (DSO)', value: arDays != null ? `${arDays.toFixed(0)} days` : '—', warn: (arDays ?? 0) > 60 },
    { label: 'Current Ratio', value: currentRatio != null ? `${currentRatio.toFixed(2)}x` : '—', warn: (currentRatio ?? 99) < 1 },
    { label: 'Debt-to-Equity', value: debtToEquity != null ? `${debtToEquity.toFixed(2)}x` : '—' },
    { label: 'Loans & Advances / Total Assets', value: fmtPct(loansToAssets) },
    { label: 'Cash Conversion Ratio', value: cashConversion != null ? `${cashConversion.toFixed(2)}x` : '—' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {rows.map(r => (
        <ParchmentKpiTile key={r.label} label={r.label} value={r.value} warn={r.warn} />
      ))}
    </div>
  );
}

// ── Action Plan ──────────────────────────────────────────────────────────────

interface ActionFlag { severity: 'critical' | 'warning' | 'ok'; title: string; metric: string; target: string; detail: string; }

function buildActionFlags(fin: ConsultFinancials, year: number): ActionFlag[] {
  const flags: ActionFlag[] = [];
  const k = consultKpis(fin, year);
  const idx = fin.years.indexOf(year);
  const prevYear = idx > 0 ? fin.years[idx - 1] : null;
  const prevK = prevYear != null ? consultKpis(fin, prevYear) : null;
  const arDays = k.rev > 0 ? (k.ar / k.rev) * 365 : null;
  const monthlyPayroll = k.payroll / 12;
  const cashMonths = monthlyPayroll > 0 ? k.cash / monthlyPayroll : null;

  if (k.payrollPctRev != null) {
    if (k.payrollPctRev > 80) {
      flags.push({ severity: 'critical', title: 'Payroll % of Revenue Critical', metric: fmtPct(k.payrollPctRev), target: '≤ 70%', detail: 'Payroll cost is consuming nearly all revenue — margins are unsustainable at current billing rates.' });
    } else if (k.payrollPctRev > 70) {
      flags.push({ severity: 'warning', title: 'Payroll % of Revenue Elevated', metric: fmtPct(k.payrollPctRev), target: '≤ 70%', detail: 'Review billing rates vs payroll cost per deployed employee.' });
    } else {
      flags.push({ severity: 'ok', title: 'Payroll % of Revenue On Target', metric: fmtPct(k.payrollPctRev), target: '≤ 70%', detail: 'Payroll cost is within a healthy range relative to revenue.' });
    }
  }

  if (arDays != null) {
    if (arDays > 90) {
      flags.push({ severity: 'critical', title: 'AR Days Critical', metric: `${arDays.toFixed(0)} days`, target: '≤ 60 days', detail: 'Collections are lagging well behind billing — follow up on aged invoices immediately.' });
    } else if (arDays > 60) {
      flags.push({ severity: 'warning', title: 'AR Days Above Threshold', metric: `${arDays.toFixed(0)} days`, target: '≤ 60 days', detail: 'Client collections are slower than target — review aging and follow up on overdue invoices.' });
    } else {
      flags.push({ severity: 'ok', title: 'AR Days On Target', metric: `${arDays.toFixed(0)} days`, target: '≤ 60 days', detail: 'Collections are keeping pace with billing.' });
    }
  }

  if (cashMonths != null) {
    if (cashMonths < 1) {
      flags.push({ severity: 'critical', title: 'Cash Below 1 Month of Payroll', metric: `${cashMonths.toFixed(1)} mo`, target: '≥ 3 months', detail: 'Cash on hand covers less than a month of payroll — immediate funding risk.' });
    } else if (cashMonths < 3) {
      flags.push({ severity: 'warning', title: 'Cash Below Target Payroll Coverage', metric: `${cashMonths.toFixed(1)} mo`, target: '≥ 3 months', detail: 'Build cash reserves to cover at least 3 months of payroll before a client payment delay becomes a crisis.' });
    } else {
      flags.push({ severity: 'ok', title: 'Cash Coverage Healthy', metric: `${cashMonths.toFixed(1)} mo`, target: '≥ 3 months', detail: 'Cash on hand comfortably covers several months of payroll.' });
    }
  }

  if (prevK && prevK.rev > 0 && prevK.loansAdvances > 0) {
    const revGrowth = (k.rev - prevK.rev) / prevK.rev;
    const loanGrowth = (k.loansAdvances - prevK.loansAdvances) / prevK.loansAdvances;
    if (loanGrowth > revGrowth + 0.1) {
      flags.push({ severity: 'warning', title: 'Loans & Advances Growing Faster Than Revenue', metric: `${(loanGrowth * 100).toFixed(1)}%`, target: `≤ revenue growth (${(revGrowth * 100).toFixed(1)}%)`, detail: 'Related-party financing is growing disproportionately to the business — confirm this is temporary, not structural.' });
    }
  }

  if (k.netInc < 0 && k.cash > 0 && k.loansAdvances > 0) {
    flags.push({ severity: 'warning', title: 'Repeated Financing Reliance', metric: fmtUsd(k.netInc), target: 'Positive net income', detail: 'Operations show a loss while loans & advances remain on the books — confirm the business isn\'t structurally dependent on related-party financing to cover payroll.' });
  }

  return flags;
}

const SEVERITY_STYLE: Record<ActionFlag['severity'], string> = {
  critical: 'border-red-400 bg-red-50 text-red-800',
  warning: 'border-amber-400 bg-amber-50 text-amber-800',
  ok: 'border-green-400 bg-green-50 text-green-800',
};

function ActionPlan({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const flags = useMemo(() => buildActionFlags(fin, year), [fin, year]);
  return (
    <div className="space-y-3">
      {flags.map((f, i) => (
        <div key={i} className={`rounded-lg border-l-4 p-4 ${SEVERITY_STYLE[f.severity]} border`}>
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">{f.title}</p>
            <span className="text-xs font-mono">{f.metric} · target {f.target}</span>
          </div>
          <p className="text-xs mt-1 opacity-90">{f.detail}</p>
        </div>
      ))}
    </div>
  );
}

// ── Financial Metrics ────────────────────────────────────────────────────────
// Dedicated visual tab — separate from the flat Financial Ratios list above.

/** Shared Balance Sheet chart set — rendered identically by both Financial Metrics and
 * CFO Dashboard so the two tabs never carry two copies of the same calculation logic
 * (the exact "two sources of truth" pattern just fixed for cash). Any future change to
 * how these are computed only needs to happen here. */
function ConsultancyBalanceSheetCharts({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const b = fin.bs;
  const [drillLiability, setDrillLiability] = useState<string | null>(null);

  const series = useMemo(() => fin.years.map(y => {
    const k = consultKpis(fin, y);
    const totalAssets = Math.abs(cYV(b, /^total\s+(for\s+)?assets$/i, y));
    const totalLiab = Math.abs(cYV(b, /^total\s+(for\s+)?liabilit(y|ies)$/i, y));
    const equity = Math.abs(cYV(b, /^total\s+(for\s+)?equity$/i, y));
    const debtToEquity = equity > 0 ? k.loansAdvances / equity : 0;
    return { year: y, totalAssets, totalLiab, equity, debtToEquity };
  }), [fin, b]);

  const assetItems = useMemo(() => sectionItems(b, /^assets$/i), [b]);
  const assetComposition = useMemo(() => fin.years.map(y => {
    const row: Record<string, number | string> = { year: y };
    for (const item of assetItems) row[item.label] = Math.abs(item.values[y] ?? 0);
    return row;
  }), [fin.years, assetItems]);

  const liabilityItems = useMemo(() => sectionItems(b, /^liabilit(y|ies)$/i), [b]);
  const liabilityBreakdown = useMemo(
    () => liabilityItems.map(i => ({ name: i.label, value: Math.abs(i.values[year] ?? 0) })).filter(x => x.value > 0),
    [liabilityItems, year],
  );
  const liabilityDrillItems = drillLiability ? liabilityItems.filter(i => i.label === drillLiability) : [];

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Total Assets Trajectory</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="totalAssets" name="Total Assets" stroke={P.teal} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Debt-to-Equity Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => `${v.toFixed(2)}x`} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="debtToEquity" name="Debt-to-Equity" stroke={P.red} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Assets vs Liabilities</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              <Bar dataKey="totalAssets" name="Total Assets" fill={P.teal} radius={[3, 3, 0, 0]} />
              <Bar dataKey="totalLiab" name="Total Liabilities" fill={P.red} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Equity Trend</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="equity" name="Equity" stroke={P.green} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {assetItems.length > 0 && (
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Asset Composition by Year</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={assetComposition}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(Number(v) / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
              {assetItems.map((item, i) => (
                <Bar key={item.label} dataKey={item.label} name={item.label} stackId="assets" fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={PT_CARD}>
        <p style={PT_FONT.chartTitle}>Liability Breakdown · FY {year}</p>
        <p style={PT_FONT.chartSubtitle}>Click a segment to see the underlying Balance Sheet line</p>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={liabilityBreakdown} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}
              onClick={(d: { name?: string }) => setDrillLiability(prev2 => (prev2 === d.name ? null : (d.name ?? null)))}
              style={{ cursor: 'pointer' }}
            >
              {liabilityBreakdown.map((s, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} opacity={drillLiability && drillLiability !== s.name ? 0.4 : 1} />)}
            </Pie>
            <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
            <Legend {...CHART_LEGEND} />
          </PieChart>
        </ResponsiveContainer>
        {drillLiability && (
          <div className="mt-2">
            <StatementTable items={liabilityDrillItems} years={fin.years} labelCol="Liability" emptyMessage="No matching line found." />
          </div>
        )}
      </div>
    </>
  );
}

function FinancialMetricsTab({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const b = fin.bs;
  const [drillExpense, setDrillExpense] = useState<string | null>(null);

  const series = useMemo(() => fin.years.map(y => {
    const k = consultKpis(fin, y);
    const expenseRatio = k.rev > 0 ? (k.exp / k.rev) * 100 : 0;
    const netCf = k.rev - k.exp;
    const operatingCf = cfSectionTotal(fin.cf, /operating/i, y);
    const operatingCfMargin = k.rev > 0 ? (operatingCf / k.rev) * 100 : 0;
    return {
      year: y, expenseRatio,
      cash: k.cash, netCf, operatingCfMargin,
      rev: k.rev, salesRev: k.salesRev, servicesRev: k.servicesRev, otherRev: k.otherRev,
      netInc: k.netInc, netMargin: k.netMargin,
    };
  }), [fin, b]);

  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const avgMargin = series.length ? series.reduce((s, x) => s + (x.netMargin ?? 0), 0) / series.length : 0;
  const marginYoY = prev ? (last.netMargin ?? 0) - (prev.netMargin ?? 0) : null;

  const expenseCategories = useMemo(() => plExpenseCategoryItems(fin.pl), [fin.pl]);
  const expenseBreakdown = useMemo(
    () => expenseCategories.map(i => ({ name: i.label, value: Math.abs(i.values[year] ?? 0) })).filter(x => x.value > 0),
    [expenseCategories, year],
  );
  const expenseDrillItems = drillExpense ? expenseCategories.filter(i => i.label === drillExpense) : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <ParchmentKpiTile label="Net Income (current year)" value={fmtUsd(last?.netInc ?? 0)} accent warn={(last?.netInc ?? 0) < 0} />
        <ParchmentKpiTile label="Avg Profit Margin" value={fmtPct(avgMargin)} />
        <ParchmentKpiTile label="Latest Cash Position" value={fmtUsd(last?.cash ?? 0)} />
      </div>
      {marginYoY != null && (
        <p className="text-[11px] text-gray-400">
          Net Margin {marginYoY >= 0 ? 'improved' : 'declined'} {Math.abs(marginYoY).toFixed(1)} pts YoY vs {prev.year}.
        </p>
      )}

      <ConsultancyBalanceSheetCharts fin={fin} year={year} />

      <div style={PT_CARD}>
        <p style={PT_FONT.chartTitle}>Revenue Breakdown by Year</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
            <XAxis dataKey="year" tick={CHART_TICK} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
            <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
            <Legend {...CHART_LEGEND} />
            <Bar dataKey="salesRev" name="Sales" stackId="rev" fill={P.gold} />
            <Bar dataKey="servicesRev" name="Services" stackId="rev" fill={P.teal} />
            <Bar dataKey="otherRev" name="Other" stackId="rev" fill={P.blue} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Expense Ratio Trend</p>
          <p style={PT_FONT.chartSubtitle}>Total Expenses as % of Revenue</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="expenseRatio" name="Expense Ratio" stroke={P.red} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Cash Balance Trend</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="cash" name="Cash" stroke={P.green} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Expense Breakdown · FY {year}</p>
          <p style={PT_FONT.chartSubtitle}>Click a segment to see the underlying P&amp;L line · Payroll shown on the Expenses tab</p>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={expenseBreakdown} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}
                onClick={(d: { name?: string }) => setDrillExpense(prev2 => (prev2 === d.name ? null : (d.name ?? null)))}
                style={{ cursor: 'pointer' }}
              >
                {expenseBreakdown.map((s, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} opacity={drillExpense && drillExpense !== s.name ? 0.4 : 1} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Legend {...CHART_LEGEND} />
            </PieChart>
          </ResponsiveContainer>
          {drillExpense && (
            <div className="mt-2">
              <StatementTable items={expenseDrillItems} years={fin.years} labelCol="Line Item" emptyMessage="No matching line found." />
            </div>
          )}
        </div>
        <div style={PT_CARD}>
          <p style={PT_FONT.chartTitle}>Net Cash Flow Trajectory</p>
          <p style={PT_FONT.chartSubtitle}>Revenue less Expenses per year</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
              <XAxis dataKey="year" tick={CHART_TICK} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
              <Line type="monotone" dataKey="netCf" name="Net Cash Flow" stroke={P.blue} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={PT_CARD}>
        <p style={PT_FONT.chartTitle}>Operating CF Margin Trend</p>
        <p style={PT_FONT.chartSubtitle}>Operating Cash Flow as % of Revenue</p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
            <XAxis dataKey="year" tick={CHART_TICK} />
            <YAxis tick={CHART_TICK} />
            <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={CHART_TOOLTIP} />
            <Line type="monotone" dataKey="operatingCfMargin" name="Operating CF Margin" stroke={P.teal} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Calculations ─────────────────────────────────────────────────────────────
// Lightweight, tenant-facing formula/inputs transparency view — NOT a copy of
// Rentals' "Calculations" tab, which is actually a backend audit/mismatch-detection
// service gated to internal reviewers (services/kpi_sanity_check.py,
// /api/admin/kpi-sanity/*). That's a different system with a different audience;
// replicating it was explicitly decided against. This just shows each KPI's formula
// and current inputs/output, sourced directly from consultKpis().

interface CalcRow { kpi: string; formula: string; inputs: string; value: string }

function buildCalcRows(fin: ConsultFinancials, year: number): CalcRow[] {
  const k = consultKpis(fin, year);
  return [
    { kpi: 'Revenue', formula: 'Sales + Services + Other', inputs: `${fmtUsd(k.salesRev)} + ${fmtUsd(k.servicesRev)} + ${fmtUsd(k.otherRev)}`, value: fmtUsd(k.rev) },
    { kpi: 'Payroll', formula: 'Sum of Payroll / Salary / Wages / Payroll Tax lines', inputs: `Total Payroll`, value: fmtUsd(k.payroll) },
    { kpi: 'Total Expenses', formula: '"Total for Expenses" row from P&L', inputs: `As uploaded`, value: fmtUsd(k.exp) },
    { kpi: 'Net Income', formula: 'Net Income row from P&L', inputs: `As uploaded`, value: fmtUsd(k.netInc) },
    { kpi: 'Interest Expense', formula: 'Sum of P&L lines matching "interest"', inputs: `As uploaded`, value: fmtUsd(k.interestExpense) },
    { kpi: 'Gross Margin %', formula: '(Revenue − Payroll) / Revenue × 100', inputs: `(${fmtUsd(k.rev)} − ${fmtUsd(k.payroll)}) / ${fmtUsd(k.rev)}`, value: fmtPct(k.grossMargin) },
    { kpi: 'Net Margin %', formula: 'Net Income / Revenue × 100', inputs: `${fmtUsd(k.netInc)} / ${fmtUsd(k.rev)}`, value: fmtPct(k.netMargin) },
    { kpi: 'Payroll % of Revenue', formula: 'Payroll / Revenue × 100', inputs: `${fmtUsd(k.payroll)} / ${fmtUsd(k.rev)}`, value: fmtPct(k.payrollPctRev) },
    { kpi: 'AR Balance', formula: '"Accounts Receivable" total from Balance Sheet', inputs: `As uploaded`, value: fmtUsd(k.ar) },
    { kpi: 'Cash Balance', formula: 'Sum of Bank / Cash / Checking lines from Balance Sheet', inputs: `As uploaded`, value: fmtUsd(k.cash) },
    { kpi: 'Loans & Advances', formula: '"Loans & Advances" total from Balance Sheet', inputs: `As uploaded`, value: fmtUsd(k.loansAdvances) },
  ];
}

function CalculationsTab({ fin, year }: { fin: ConsultFinancials; year: number }) {
  const rows = useMemo(() => buildCalcRows(fin, year), [fin, year]);
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        How each KPI shown elsewhere in this section is calculated for FY {year} — formula, inputs, and current value.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead><tr className="bg-gray-900 text-white">
            <th className="text-left px-4 py-2.5">KPI</th>
            <th className="text-left px-4 py-2.5">Formula</th>
            <th className="text-left px-4 py-2.5">Inputs</th>
            <th className="text-right px-4 py-2.5">Value</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-4 font-medium text-gray-800">{r.kpi}</td>
                <td className="py-2 px-4 text-gray-600">{r.formula}</td>
                <td className="py-2 px-4 text-gray-500 font-mono">{r.inputs}</td>
                <td className="py-2 px-4 text-right font-mono font-semibold">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ConsultancyFinancials({ initialTab = 'P&L Statement' }: { initialTab?: SubTab }) {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useConsultancy();
  const [activeTab, setActiveTab] = useState<SubTab>(initialTab);
  const [fin, setFin] = useState<ConsultFinancials | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [period, setPeriod] = useState<Period | null>(null);
  const [pMonth, setPMonth] = useState(new Date().getMonth() + 1);
  const [pYear, setPYear] = useState(new Date().getFullYear());
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const plRef = useRef<HTMLInputElement>(null);
  const bsRef = useRef<HTMLInputElement>(null);
  const cfRef = useRef<HTMLInputElement>(null);
  /** Bumped on every upload so a slow initial GET cannot overwrite fresh data. */
  const finRevisionRef = useRef(0);

  const financialCompanyId = selectedCompanyId !== 'all' && companies.some(c => c.id === selectedCompanyId)
    ? selectedCompanyId
    : (companies[0]?.id ?? '');
  const selectedCompany = companies.find(c => c.id === financialCompanyId);

  useEffect(() => {
    if (!financialCompanyId) { setFin(null); return; }
    let cancelled = false;
    const revAtStart = finRevisionRef.current;
    api.get<{ company_name: string; years: number[]; pl: ConsultFinItem[]; bs: ConsultFinItem[]; cf?: ConsultFinItem[]; pl_filename?: string; bs_filename?: string; cf_filename?: string; uploaded_at?: string }>(
      `/api/consultancy/financials/${financialCompanyId}`,
    )
      .then(res => {
        if (cancelled || revAtStart !== finRevisionRef.current) return;
        const d = res.data;
        const hasAny =
          !!(d?.pl?.length || d?.bs?.length || d?.cf?.length);
        if (!hasAny) { setFin(null); return; }
        const pl = normalizeFinItems(d.pl);
        const bs = normalizeFinItems(d.bs);
        const cf = normalizeFinItems(d.cf);
        const fromItems = yearsFromItems([...pl, ...bs, ...cf]);
        const years = fromItems.length ? fromItems : (d.years ?? []);
        const loaded: ConsultFinancials = {
          companyName: d.company_name, years,
          plFile: d.pl_filename ?? '', bsFile: d.bs_filename ?? '', cfFile: d.cf_filename,
          uploadedAt: d.uploaded_at ?? '', pl, bs, cf,
        };
        setFin(loaded);
        if (years.length) {
          const latest = years[years.length - 1];
          setSelectedYear(latest);
          setPYear(latest);
        }
      })
      .catch(() => { if (!cancelled && revAtStart === finRevisionRef.current) setFin(null); });
    return () => { cancelled = true; };
  }, [financialCompanyId]);

  const handleFile = useCallback(async (file: File, hintType?: 'pl' | 'bs' | 'cf') => {
    if (!financialCompanyId || !selectedCompany) { alert('Please select a company first.'); return; }
    setUploading(true);
    try {
      await withTimeout((async () => {
        const parsed = await parseFinancialExcel(file, selectedCompany.name, { hintType });
        if (!parsed.pl.length && !parsed.bs.length && !parsed.cf.length) {
          alert(`Could not parse "${file.name}". Use a QuickBooks-style Excel export with monthly or annual year columns and line items in the first column.`);
          return;
        }
        finRevisionRef.current += 1;
        const next = mergeUploadedFinancials<ConsultFinItem>({
          base: fin,
          parsed: {
            companyName: parsed.companyName,
            uploadedAt: parsed.uploadedAt,
            years: parsed.years,
            pl: parsed.pl as ConsultFinItem[],
            bs: parsed.bs as ConsultFinItem[],
            cf: parsed.cf as ConsultFinItem[],
          },
          hintType,
          fileName: file.name,
          companyName: selectedCompany.name,
        });
        setFin(next);
        if (next.years.length) {
          const latest = next.years[next.years.length - 1];
          setSelectedYear(latest);
          setPYear(latest);
        }
        await postJsonWithWake('/api/consultancy/financials/save', {
          company_id: financialCompanyId,
          company_name: next.companyName,
          filename: file.name,
          pl_filename: next.plFile || null,
          bs_filename: next.bsFile || null,
          cf_filename: next.cfFile || null,
          date_range: parsed.dateRange || '',
          years: next.years,
          periods: parsed.periods ?? [],
          pl: next.pl, bs: next.bs, cf: next.cf ?? [],
        });
        const cfN = next.cf?.length ?? 0;
        alert(
          `Saved for ${selectedCompany.name}.\n`
          + `P&L: ${next.pl.length} lines · BS: ${next.bs.length} lines · CF: ${cfN} lines`
          + (hintType === 'cf' && cfN === 0
            ? '\n\nWARNING: Upload CF saved 0 Cash Flow lines. Re-export the statement from QuickBooks as Cash Flow and try again.'
            : ''),
        );
      })(), 90_000, 'Financials upload');
    } catch (e: unknown) {
      alert(`Upload failed: ${formatApiError(e, 'Could not save financials')}`);
    } finally {
      setUploading(false);
    }
  }, [financialCompanyId, selectedCompany, fin]);

  const availableKeys = useMemo(() => (fin ? getConsultAvailableKeys(fin) : []), [fin]);
  const tidiedPl = useMemo(
    () => (fin ? tidyStatementRows(fin.pl, fin.years, 'pl') : []),
    [fin],
  );
  const tidiedBs = useMemo(
    () => (fin ? tidyStatementRows(fin.bs, fin.years, 'bs') : []),
    [fin],
  );
  const tidiedCf = useMemo(
    () => (fin ? tidyStatementRows(fin.cf, fin.years, 'cf') : []),
    [fin],
  );
  const plYears = useMemo(() => (fin ? yearsFromItemsWithNonZeroValues(tidiedPl) : []), [fin, tidiedPl]);
  const bsYears = useMemo(() => (fin ? yearsFromItemsWithNonZeroValues(tidiedBs) : []), [fin, tidiedBs]);
  const cfYears = useMemo(() => (fin ? yearsFromItemsWithNonZeroValues(tidiedCf) : []), [fin, tidiedCf]);
  const activeStatementYears = useMemo(() => {
    if (!fin) return [];
    if (activeTab === 'P&L Statement') return plYears.length ? plYears : fin.years;
    if (activeTab === 'Balance Sheet') return bsYears.length ? bsYears : fin.years;
    if (activeTab === 'Cash Flow') return cfYears.length ? cfYears : fin.years;
    return fin.years;
  }, [activeTab, bsYears, cfYears, fin, plYears]);
  const displayYears = useMemo(
    () => yearsThrough(activeStatementYears, selectedYear),
    [activeStatementYears, selectedYear],
  );

  useEffect(() => {
    if (!activeStatementYears.length) return;
    if (!activeStatementYears.includes(selectedYear)) {
      const latest = activeStatementYears[activeStatementYears.length - 1];
      setSelectedYear(latest);
      setPYear(latest);
    }
  }, [activeStatementYears, selectedYear]);

  const handleExportPdf = useCallback(async () => {
    if (!selectedCompany || !financialCompanyId) return;
    setExporting(true);
    setExportError('');
    try {
      // Prefer freshly saved server CF; if API still has no CF but this session does
      // (upload saved to memory but cf_data column was missing), keep memory CF and re-save.
      let exportFin = fin;
      try {
        const res = await api.get<{
          company_name: string; years: number[];
          pl: ConsultFinItem[]; bs: ConsultFinItem[]; cf?: ConsultFinItem[];
          pl_filename?: string; bs_filename?: string; cf_filename?: string; uploaded_at?: string;
        }>(`/api/consultancy/financials/${financialCompanyId}`);
        const d = res.data;
        if (d && (d.pl?.length || d.bs?.length || d.cf?.length || fin?.cf?.length)) {
          const apiCf = d.cf ?? [];
          const memCf = fin?.cf ?? [];
          const cf = apiCf.length ? apiCf : memCf;
          const years = Array.from(new Set([
            ...(d.years ?? []),
            ...(fin?.years ?? []),
            ...cf.flatMap(i => Object.keys(i.values ?? {}).map(Number).filter(n => n >= 1990 && n <= 2100)),
          ])).sort((a, b) => a - b);
          exportFin = {
            companyName: d.company_name || fin?.companyName || selectedCompany.name,
            years,
            plFile: d.pl_filename ?? fin?.plFile ?? '',
            bsFile: d.bs_filename ?? fin?.bsFile ?? '',
            cfFile: d.cf_filename ?? fin?.cfFile,
            uploadedAt: d.uploaded_at ?? fin?.uploadedAt ?? '',
            pl: (d.pl?.length ? d.pl : fin?.pl) ?? [],
            bs: (d.bs?.length ? d.bs : fin?.bs) ?? [],
            cf,
          };
          setFin(exportFin);
          // Persist memory CF if server was empty
          if (!apiCf.length && memCf.length) {
            await postJsonWithWake('/api/consultancy/financials/save', {
              company_id: financialCompanyId,
              company_name: exportFin.companyName,
              filename: exportFin.cfFile || 'cashflow.xlsx',
              pl_filename: exportFin.plFile || null,
              bs_filename: exportFin.bsFile || null,
              cf_filename: exportFin.cfFile || null,
              date_range: '',
              years: exportFin.years,
              periods: [],
              pl: exportFin.pl, bs: exportFin.bs, cf: exportFin.cf,
            });
          }
        }
      } catch {
        // Fall back to in-memory fin if refresh fails
      }
      if (!exportFin) {
        setExportError('No financials loaded for this company.');
        return;
      }
      const cfCount = exportFin.cf?.length ?? 0;
      if (!cfCount) {
        setExportError('Cash Flow is empty — open the Cash Flow tab to confirm data, then click Upload CF again and Export PDF.');
        return;
      }
      const periodLabel = period ? periodChipText(period, pMonth, pYear) : `FY ${selectedYear}`;
      const periodKeys = period ? getPeriodFilterKeys(period, pMonth, pYear) : null;
      const periodKpis = periodKeys ? consultKpisForPeriod(exportFin, periodKeys) : null;
      await exportConsultancyCfoDashboardPdf({
        fin: exportFin, entityLabel: selectedCompany.name, periodLabel,
        periodKpis, pYear: period ? pYear : selectedYear,
      });
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [fin, selectedCompany, financialCompanyId, period, pMonth, pYear, selectedYear]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <select
            value={financialCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5"
            style={{ borderColor: PT.border, background: PT.cardBg }}
          >
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {fin && (
            <select
              value={selectedYear}
              onChange={e => { const y = Number(e.target.value); setSelectedYear(y); setPYear(y); }}
              className="text-sm border rounded-lg px-3 py-1.5"
              style={{ borderColor: PT.border, background: PT.cardBg }}
            >
              {activeStatementYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(activeTab === 'KPI Dashboard' || activeTab === 'CFO Dashboard' || activeTab === 'Financial Ratios' || activeTab === 'Action Plan') && (
            <PeriodToggle period={period} month={pMonth} year={pYear} onChange={(p, m, y) => {
              setPeriod(p); setPMonth(m); setPYear(y); setSelectedYear(y);
            }} availableKeys={availableKeys} compact />
          )}
          <button type="button" onClick={() => plRef.current?.click()} disabled={uploading || !financialCompanyId}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white" style={{ background: '#4F46E5' }}>
            <Upload size={13} /> Upload P&amp;L
          </button>
          <button type="button" onClick={() => bsRef.current?.click()} disabled={uploading || !financialCompanyId}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white bg-green-700">
            <Upload size={13} /> Upload BS
          </button>
          <button type="button" onClick={() => cfRef.current?.click()} disabled={uploading || !financialCompanyId}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white bg-purple-700">
            <Upload size={13} /> Upload CF
          </button>
          <button type="button" onClick={() => void handleExportPdf()} disabled={exporting || !fin}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border font-medium"
            style={{ background: PT.cardBg, borderColor: PT.border, color: PT.text, cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.7 : 1 }}>
            <Download size={13} /> {exporting ? 'Generating…' : 'Export PDF'}
          </button>
        </div>
      </div>
      {fin && (
        <p className="text-xs text-right" style={{ color: PT.muted ?? '#6B7280' }}>
          Loaded: P&amp;L {fin.pl.length} · BS {fin.bs.length} · CF {fin.cf?.length ?? 0}
          {(fin.cf?.length ?? 0) === 0 ? ' — Upload CF before export if you need Cash Flow in the PDF' : ''}
        </p>
      )}
      {exportError && <p className="text-xs text-red-600 text-right">{exportError}</p>}

      <input ref={plRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f, 'pl'); e.target.value = ''; }} />
      <input ref={bsRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f, 'bs'); e.target.value = ''; }} />
      <input ref={cfRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f, 'cf'); e.target.value = ''; }} />

      <div className="flex gap-1 border-b" style={{ borderColor: PT.border }}>
        {SUB_TABS.map(t => (
          <button key={t} type="button" onClick={() => setActiveTab(t)}
            className={`text-xs px-3 py-2 font-medium border-b-2 ${activeTab === t ? 'border-amber-600 text-amber-800' : 'border-transparent text-gray-500'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="border rounded-2xl shadow-sm p-6" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
        {!companies.length ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Building2 size={32} className="text-gray-400 mb-3" />
            <p className="text-lg font-semibold text-gray-700 mb-2">No companies yet</p>
            <p className="text-sm text-gray-400">Add a consulting/staffing company to get started.</p>
          </div>
        ) : !fin ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <FileSpreadsheet size={28} className="text-gray-400 mb-3" />
            <p className="text-lg font-semibold text-gray-700 mb-2">No financials uploaded</p>
            <p className="text-sm text-gray-400 max-w-md">Upload a QuickBooks-style P&amp;L / Balance Sheet / Cash Flow Excel for {selectedCompany?.name ?? 'this company'}.</p>
          </div>
        ) : (
          <>
            {activeTab === 'P&L Statement' && <StatementTable items={tidiedPl} years={displayYears} labelCol="Line Item" emptyMessage="No P&L data found." />}
            {activeTab === 'Balance Sheet' && <StatementTable items={tidiedBs} years={displayYears} labelCol="Item" emptyMessage="No Balance Sheet data found." />}
            {activeTab === 'Cash Flow' && (
              <>
                <StatementTable items={tidiedCf} years={displayYears} labelCol="Line Item" emptyMessage="No Cash Flow data found." />
                <LoanMovementTable cf={tidiedCf} years={displayYears} />
              </>
            )}
            {activeTab === 'KPI Dashboard' && <KpiDashboard fin={fin} year={selectedYear} />}
            {activeTab === 'CFO Dashboard' && <CfoDashboard fin={fin} period={period} pMonth={pMonth} pYear={pYear} />}
            {activeTab === 'AR Dashboard' && <ArDashboard fin={fin} year={selectedYear} />}
            {activeTab === 'Expenses' && <ExpensesTab fin={fin} year={selectedYear} />}
            {activeTab === 'Profitability' && <ProfitabilityTab fin={fin} year={selectedYear} />}
            {activeTab === 'Financial Ratios' && <FinancialRatios fin={fin} year={selectedYear} />}
            {activeTab === 'Financial Metrics' && <FinancialMetricsTab fin={fin} year={selectedYear} />}
            {activeTab === 'Action Plan' && <ActionPlan fin={fin} year={selectedYear} />}
            {activeTab === 'Calculations' && <CalculationsTab fin={fin} year={selectedYear} />}
          </>
        )}
      </div>
    </div>
  );
}

export { getConsultAvailableKeys, consultKpis };
export type { ConsultFinancials, ConsultFinItem };
