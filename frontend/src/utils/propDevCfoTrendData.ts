import type { CompanyData, Loan, YearlyBS, YearlyCF } from '../contexts/PropertyDevContext';
import { computeCapitalCallCoverage, resolveLandValue, sumActivePropDevLoanBalances } from './propDevLoanMetrics';
import { buildCfSnapshots } from './cfoCfTrendData';
import {
  cashBalanceAtPeriodEnd,
  type YearSnapshotPeriodAnchor,
  yearSnapshotLabel,
} from './cfoMultiYearTrendData';
import {
  periodKeysForPropDevYear,
  pdKpisForScope,
  propDevStatementHasYearActivity,
  propDevYearsSpanningActivity,
  type PropDevSnapshotOpts,
} from './propDevPeriodKpis';
import type { ParsedFinancials } from './rentalKpiEngine';
import { yearVal } from './finItemYearUtils';
import { labelMatches } from './propDevStatementLabels';

export interface PDFinItemLike {
  label: string;
  values: Record<number, number>;
  monthlyValues?: Record<string, number>;
  isSectionHeader?: boolean;
  isTotal?: boolean;
  isNetIncome?: boolean;
  indent?: number;
  /** interest | property_tax | improvements | other_carrying | operating | capex |
   * debt_service | other -- tagged server-side on save (propdev_expense_categorizer.py). */
  expense_category?: string;
}

export interface PDFinancialsLike {
  years: number[];
  pl: PDFinItemLike[];
  bs: PDFinItemLike[];
  cf?: PDFinItemLike[];
  companyName?: string;
}

function pdYV(items: PDFinItemLike[], pat: RegExp, y: number): number {
  return yearVal(items.find(i => labelMatches(i.label, pat))?.values, y);
}

/** First matching row with a non-zero year value (skips empty parent headers like "II. Long Term Liabilities"). */
function pdYVNonZero(items: PDFinItemLike[], pat: RegExp, y: number): number {
  for (const i of items) {
    if (!labelMatches(i.label, pat)) continue;
    const v = yearVal(i.values, y);
    if (v !== 0) return v;
  }
  return 0;
}

function pdSumI(items: PDFinItemLike[], pat: RegExp, y: number): number {
  return items
    .filter(i => !i.isSectionHeader && !i.isTotal && labelMatches(i.label, pat))
    .reduce((s, i) => s + yearVal(i.values, y), 0);
}

/** Prefer "Total for …" rows; skip empty section headers that would zero out year columns. */
function bsAbsForYear(items: PDFinItemLike[], pat: RegExp, y: number): number {
  const total = items.find(i => /^total\s+(for\s+)?/i.test(i.label) && labelMatches(i.label, pat));
  if (total) {
    const v = Math.abs(yearVal(total.values, y));
    if (v > 0) return v;
  }
  for (const i of items) {
    if (i.isSectionHeader || !labelMatches(i.label, pat)) continue;
    const v = Math.abs(yearVal(i.values, y));
    if (v > 0) return v;
  }
  return Math.abs(pdYV(items, pat, y));
}

function bsAbsAtMonthKey(items: PDFinItemLike[], pat: RegExp, key: string): number {
  const total = items.find(i => /^total\s+(for\s+)?/i.test(i.label) && labelMatches(i.label, pat));
  if (total?.monthlyValues) {
    const v = Math.abs(total.monthlyValues[key] ?? 0);
    if (v > 0) return v;
  }
  for (const i of items) {
    if (i.isSectionHeader || !labelMatches(i.label, pat) || !i.monthlyValues) continue;
    const v = Math.abs(i.monthlyValues[key] ?? 0);
    if (v > 0) return v;
  }
  return 0;
}

function endPeriodKey(
  fin: PDFinancialsLike,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): string | null {
  const keys = periodKeysForPropDevYear(fin, year, anchor);
  if (keys?.length) return keys[keys.length - 1];
  return null;
}

/** Balance Sheet "Total for Partner investments" (equity contributions) — not Land / Cost Basis. */
export function readPartnerInvestmentsTotal(
  fin: PDFinancialsLike | null | undefined,
  year?: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  if (!fin?.bs?.length || !fin.years?.length) return 0;
  const y = year && fin.years.includes(year) ? year : fin.years[fin.years.length - 1];
  const totalPat = /partner\s+invest|partners?\s+capital/i;
  const monthKey = endPeriodKey(fin, y, anchor);
  if (monthKey) {
    const fromMonth = bsAbsAtMonthKey(fin.bs, totalPat, monthKey);
    if (fromMonth > 0) return fromMonth;
  }
  const fromYear = bsAbsForYear(fin.bs, totalPat, y);
  if (fromYear > 0) return fromYear;
  // Sum individual partner-investment / partners-capital equity lines when no "Total for …" row exists.
  const summed = fin.bs
    .filter(i => !i.isSectionHeader && labelMatches(i.label, totalPat) && !/^total\s+(for\s+)?/i.test(i.label))
    .reduce((s, i) => {
      if (monthKey && i.monthlyValues?.[monthKey] != null) {
        return s + Math.abs(i.monthlyValues[monthKey] ?? 0);
      }
      return s + Math.abs(i.values[y] ?? 0);
    }, 0);
  return summed;
}

function yearlyBsFor(company: CompanyData | null | undefined, y: number): YearlyBS | null {
  const bs = company?.property.yearlyBS?.[String(y)];
  return bs ?? null;
}

function yearlyCfFor(company: CompanyData | null | undefined, y: number): YearlyCF | null {
  const cf = company?.property.yearlyCF?.[String(y)];
  return cf ?? null;
}

/** Safe ratio — returns null when denominator is zero or near-zero. */
export function safeRatio(numerator: number, denominator: number, nearZero = 1): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (Math.abs(denominator) < nearZero) return null;
  return numerator / denominator;
}

export function formatRatioNA(ratio: number | null, suffix = '', decimals = 1): string {
  if (ratio == null || !Number.isFinite(ratio)) return 'N/A';
  const body = `${Math.abs(ratio).toFixed(decimals)}${suffix}`;
  return ratio < 0 ? `(${body})` : body;
}

/** Table / tile label when Operating CF is not a burn year. */
export function formatCashRunwayCell(snapshot: {
  operatingCf: number;
  monthlyBurnRate: number;
  cashRunwayMonths: number | null;
}): string {
  if (snapshot.operatingCf >= 0 || !(snapshot.monthlyBurnRate > 0)) {
    return 'Cash flow positive';
  }
  return formatRatioNA(snapshot.cashRunwayMonths, ' mo', 1);
}

export type PropDevDebtSource = 'loan_tracker' | 'balance_sheet' | 'yearly_bs' | 'none';

export interface PropDevDebtResolved {
  amount: number;
  source: PropDevDebtSource;
  asOfNote: string;
}

/** True BS liability totals — never "Total Equity and Liabilities". */
function readBsTotalLiabilities(items: PDFinItemLike[], year: number): number {
  return Math.abs(
    pdYVNonZero(items, /^total\s+for\s+liabilities$/i, year)
    || pdYVNonZero(items, /^total\s+(?:of\s+)?liabilit(?:y|ies)$/i, year)
    // QBO sometimes omits "for": "Total Liabilities" (still not equity combo).
    || pdYVNonZero(items, /^total\s+liabilit(?:y|ies)$/i, year),
  );
}

/** "Total for Partner Investments" B/S line -- Capital Raised, per the Capital Structure tab. */
export function readBsPartnerInvestments(items: PDFinItemLike[], year: number): number {
  return Math.abs(
    pdYVNonZero(items, /^total\s+for\s+partner\s+investments?/i, year)
      || pdYVNonZero(items, /^partner\s+investments?$/i, year)
      || pdSumI(items, /partner\s+investments?/i, year),
  );
}

export function readBsLongTermDebt(items: PDFinItemLike[], year: number): number {
  const totalLt = Math.abs(
    pdYVNonZero(items, /^total\s+for\s+long[- ]?term\s+(loans?|liabilit)/i, year)
    || pdYVNonZero(items, /^total\s+for\s+long[- ]?term\s+loans?\s+(from\s+)?(bank|others?)/i, year)
    || pdYVNonZero(items, /^long\s*[- ]?term\s+loans?$/i, year)
    || pdYVNonZero(items, /^long\s*[- ]?term\s+liabilit/i, year),
  );
  if (totalLt > 0) return totalLt;
  // U Bank / institutional bank loan lines on the B/S (user's Mar 2026 LT debt).
  const uBank = Math.abs(pdSumI(items, /\bu\s*-?\s*bank\b.*\bloan|\bloan\b.*\bu\s*-?\s*bank\b/i, year));
  if (uBank > 0) return uBank;
  return Math.abs(
    pdSumI(items, /long\s*[- ]?term\s+(business\s+)?loan/i, year)
    || pdYVNonZero(items, /loan\s*>?\s*1\s*year/i, year),
  );
}

/**
 * Outstanding / Total Debt for Prop Dev — Balance Sheet first for every entity/year.
 * Prefer "Total for Liabilities". Fall back to long-term / U Bank loan lines, then
 * yearly BS JSON. Loan Tracker is LAST RESORT only when the uploaded B/S has no
 * usable liability amount for that year (never override a real multi-million B/S).
 */
export function resolveTotalDebt(
  company: CompanyData | null | undefined,
  fin: PDFinancialsLike,
  year: number,
  _isLatestYear: boolean,
  loansOverride?: Loan[],
): PropDevDebtResolved {
  const loans = (loansOverride?.length
    ? loansOverride
    : (company?.loans ?? []));
  const trackerDebt = sumActivePropDevLoanBalances(loans);

  // Tiny incomplete monthly stubs only (~$11k Montechino history). Anything at/above
  // this is treated as a real B/S balance and must never be replaced by Loan Tracker.
  const BS_DEBT_STUB_ABS = 50_000;
  const fromBsOrStub = (bsAmount: number, asOfNote: string): PropDevDebtResolved | null => {
    if (bsAmount <= 0) return null;
    if (bsAmount < BS_DEBT_STUB_ABS && trackerDebt > 0) {
      return {
        amount: trackerDebt,
        source: 'loan_tracker',
        asOfNote: `Loan Tracker (B/S stub ${bsAmount.toFixed(0)}; ${asOfNote})`,
      };
    }
    return {
      amount: bsAmount,
      source: 'balance_sheet',
      asOfNote,
    };
  };

  const b = fin.bs;
  if (b.length) {
    const totalLiab = readBsTotalLiabilities(b, year);
    const fromLiab = fromBsOrStub(totalLiab, `B/S Total for Liabilities (${year})`);
    if (fromLiab) return fromLiab;

    const qboLt = readBsLongTermDebt(b, year);
    const fromLt = fromBsOrStub(qboLt, `B/S long-term / bank loans (${year})`);
    if (fromLt) return fromLt;

    const partnerLoans = Math.abs(pdYVNonZero(b, /^loan\s+from\s+partners?/i, year));
    const particularsShape = b.some(i =>
      labelMatches(i.label, /^loan\s+from\s+partners?/i)
      || labelMatches(i.label, /loan\s*>?\s*1\s*year/i)
      || labelMatches(i.label, /^partners?\s+capital$/i),
    );
    const partnersCapital = particularsShape ? pdYVNonZero(b, /^partners?\s+capital$/i, year) : 0;
    const fromBs = Math.abs(partnerLoans + partnersCapital);
    const fromParticulars = fromBsOrStub(fromBs, `B/S Particulars liabilities (${year})`);
    if (fromParticulars) return fromParticulars;

    // Last B/S pass: any non-equity loan liability lines for the year.
    const loanLines = Math.abs(
      b.filter(i =>
        !i.isSectionHeader
        && !/^total\s+(for\s+)?/i.test(i.label)
        && /\bloan/i.test(i.label)
        && !/\b(partner|equity|receivable|advance\s+to|to\s+others)/i.test(i.label)
        && !/\binterest\b/i.test(i.label),
      ).reduce((s, i) => s + Math.abs(yearVal(i.values, year)), 0),
    );
    const fromLoanLines = fromBsOrStub(loanLines, `B/S loan liability lines (${year})`);
    if (fromLoanLines) return fromLoanLines;
  }

  const ybs = yearlyBsFor(company, year);
  if (ybs?.total_liabilities && ybs.total_liabilities > 0) {
    if (ybs.total_liabilities < BS_DEBT_STUB_ABS && trackerDebt > 0) {
      return {
        amount: trackerDebt,
        source: 'loan_tracker',
        asOfNote: `Loan Tracker (yearly B/S stub; liabilities ${year})`,
      };
    }
    return {
      amount: ybs.total_liabilities,
      source: 'yearly_bs',
      asOfNote: `Company yearly B/S liabilities (${year})`,
    };
  }
  if (ybs?.loan_balance && ybs.loan_balance > 0) {
    if (ybs.loan_balance < BS_DEBT_STUB_ABS && trackerDebt > 0) {
      return {
        amount: trackerDebt,
        source: 'loan_tracker',
        asOfNote: `Loan Tracker (yearly B/S stub; loan_balance ${year})`,
      };
    }
    return {
      amount: ybs.loan_balance,
      source: 'yearly_bs',
      asOfNote: `Company yearly B/S ${year}`,
    };
  }

  if (trackerDebt > 0) {
    return {
      amount: trackerDebt,
      source: 'loan_tracker',
      asOfNote: 'Loan Tracker (fallback — no B/S debt line)',
    };
  }
  return { amount: 0, source: 'none', asOfNote: 'No debt data' };
}

/**
 * Uploaded QBO Balance Sheets often label cost as "Total for Fixed Assets" + "Total for Improvements"
 * with no separate Land line. Prefer those per-year columns over stale yearlyBS / landCost
 * (which previously painted the same $ amount onto every year).
 */
function readImprovements(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  y: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const monthKey = endPeriodKey(fin, y, anchor);
  if (monthKey) {
    const imprM = bsAbsAtMonthKey(fin.bs, /improvement/i, monthKey);
    const intM = bsAbsAtMonthKey(fin.bs, /interest\s+capital/i, monthKey);
    if (imprM + intM > 0) return imprM + intM;
  }
  if (fin.bs.length) {
    const impr = bsAbsForYear(fin.bs, /improvement/i, y);
    const intCap = bsAbsForYear(fin.bs, /interest\s+capital/i, y);
    if (impr + intCap > 0) return impr + intCap;
  }
  const ybs = yearlyBsFor(company, y);
  return (ybs?.improvements ?? 0) + (ybs?.interest_capitalised ?? 0);
}

/**
 * "Land Improvements" only -- the B/S "Improvements" line (e.g. "Improvements - Others"),
 * excluding Interest Capitalised. Unlike readImprovements() (used for Total Fixed Assets,
 * where capitalized interest correctly belongs), this is for display fields that mean the
 * physical improvement cost specifically, not the full capitalized asset basis.
 */
function readLandImprovementsOnly(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  y: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const monthKey = endPeriodKey(fin, y, anchor);
  if (monthKey) {
    const imprM = bsAbsAtMonthKey(fin.bs, /improvement/i, monthKey);
    if (imprM > 0) return imprM;
  }
  if (fin.bs.length) {
    const impr = bsAbsForYear(fin.bs, /improvement/i, y);
    if (impr > 0) return impr;
  }
  return yearlyBsFor(company, y)?.improvements ?? 0;
}

function readFixedAssetsTotal(
  fin: PDFinancialsLike,
  y: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const monthKey = endPeriodKey(fin, y, anchor);
  if (monthKey) {
    const fromMonth = bsAbsAtMonthKey(fin.bs, /fixed\s+assets?/i, monthKey)
      || bsAbsAtMonthKey(fin.bs, /property\s*,?\s*plant\s+and\s+equipment/i, monthKey);
    if (fromMonth > 0) return fromMonth;
  }
  return bsAbsForYear(fin.bs, /fixed\s+assets?/i, y)
    || bsAbsForYear(fin.bs, /property\s*,?\s*plant\s+and\s+equipment/i, y);
}

function readLand(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  y: number,
  _anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const isLandLabel = (lab: string) => {
    const t = lab.trim();
    if (/sale\s+of\s+land|land\s+sales?|improvement|planning|scaping|loan|payable|receivable|landscape/i.test(t)) {
      return false;
    }
    // Match "Land", "Total for Land", "Lago Vista - Land", "WWBL Land", etc.
    return /wwbl/i.test(t)
      || labelMatches(t, /^land$/i)
      || labelMatches(t, /^total\s+(for\s+)?land$/i)
      || labelMatches(t, /^land\s*[-–—:]/i)
      || labelMatches(t, /^land\s+(cost|value|held|inventory|asset)/i)
      || labelMatches(t, /^i\.?\s*land$/i)
      || /\bland\b/i.test(t);
  };
  const isPreferredLand = (lab: string) =>
    labelMatches(lab, /^total\s+(for\s+)?land$/i) || labelMatches(lab, /^land$/i);

  /** Max absolute amount on a row across annual + monthly cells (land is sticky). */
  const rowBest = (i: PDFinItemLike): number => {
    let best = 0;
    for (const raw of Object.values(i.values ?? {})) {
      const v = Math.abs(Number(raw) || 0);
      if (v > best) best = v;
    }
    for (const raw of Object.values(i.monthlyValues ?? {})) {
      const v = Math.abs(Number(raw) || 0);
      if (v > best) best = v;
    }
    return best;
  };

  if (fin.bs.length) {
    let preferred = 0; // Total for Land / clubbed Land (historical max — land is sticky)
    let parcels = 0;
    let yearPreferred = 0;
    let sawPreferredRowThisYear = false;
    for (const i of fin.bs) {
      if (i.isSectionHeader || !isLandLabel(i.label)) continue;
      const allBest = rowBest(i);
      const yearV = Math.abs(yearVal(i.values, y));
      if (isPreferredLand(i.label)) {
        if (allBest > preferred) preferred = allBest;
        if (yearV > yearPreferred) yearPreferred = yearV;
        sawPreferredRowThisYear = true;
      } else if (allBest > parcels) {
        parcels = allBest;
      }
    }
    // Prefer this year's land when it is complete. Only fall back to the strongest
    // historical / monthly figure when the year column is a clear stub (≪ best).
    if (yearPreferred > 0 && (preferred <= 0 || yearPreferred >= preferred * 0.5)) {
      return yearPreferred;
    }
    // The preferred Land row explicitly reports $0 for a year the B/S actually
    // covers, despite carrying a real historical balance — land was disposed.
    // "Sticky" exists for sparse uploads, not to hide a genuine drop to zero.
    if (sawPreferredRowThisYear && yearPreferred === 0 && preferred > 0 && fin.years.includes(y)) {
      return 0;
    }
    if (preferred > 0) return preferred;
    if (parcels > 0) return parcels;
    if (yearPreferred > 0) return yearPreferred;
  }

  const ybs = yearlyBsFor(company, y);
  if (ybs?.land && ybs.land > 0) return ybs.land;
  // landCost only when the uploaded B/S has no land lines at all
  const landCost = company?.property?.landCost;
  if (landCost != null && landCost > 0) return landCost;
  return 0;
}

function readCash(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  y: number,
  isLatestYear: boolean,
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const periodKeys = periodKeysForPropDevYear(fin, y, anchor);
  const readAnnualCash = () => {
    if (!fin.bs.length) return 0;
    // Bank cash only — never sum loan / mortgage "bank" lines into cash.
    const bankCashRows = fin.bs.filter(i => {
      const lab = i.label ?? '';
      if (/loan|mortgage|payable|receivable|interest|od\b|overdraft/i.test(lab)) return false;
      return /(?:^total\s+for\s+bank)|(?:^bank\s+accounts?\b)|(?:cash\s+and\s+bank)|(?:bank\s+balances?)|(?:^cash$)|(?:checking)/i.test(lab);
    });
    const totalForBank = bsAbsForYear(fin.bs, /^total\s+for\s+bank/i, y)
      || bsAbsForYear(fin.bs, /^bank\s+accounts?$/i, y)
      || bsAbsForYear(fin.bs, /cash\s+and\s+bank/i, y)
      || bsAbsForYear(fin.bs, /bank\s+balances?/i, y)
      || bsAbsForYear(fin.bs, /^cash$/i, y);
    if (totalForBank > 0) return totalForBank;
    return Math.abs(
      bankCashRows
        .filter(i => !i.isSectionHeader && !i.isTotal)
        .reduce((s, i) => s + yearVal(i.values, y), 0),
    );
  };
  if (periodKeys?.length) {
    const fromPeriod = pdKpisForScope(fin, y, periodKeys).cash;
    if (Math.abs(fromPeriod) > 0.005) return fromPeriod;
    // Monthly cash cells often blank on Particulars H1/FY uploads — use annual ledger.
    return readAnnualCash();
  }
  // A Balance Sheet WAS uploaded for this company — that's the source of truth, even if
  // this specific year comes up zero/unmatched. Never silently substitute the manual
  // cash_available field (or a manually-entered yearly BS override) over real upload data;
  // those are fallbacks ONLY for companies with no Balance Sheet upload at all.
  if (fin.bs.length) return readAnnualCash();
  if (isLatestYear && company?.property.cashAvailable && company.property.cashAvailable > 0) {
    return company.property.cashAvailable;
  }
  const ybs = yearlyBsFor(company, y);
  if (ybs?.cash && ybs.cash > 0) return ybs.cash;
  return 0;
}

function propDevFinToParsed(fin: PDFinancialsLike): ParsedFinancials {
  const toItem = (i: PDFinItemLike) => ({
    label: i.label,
    values: i.values,
    monthlyValues: i.monthlyValues,
    indent: 0,
    isTotal: i.isTotal ?? false,
    isSectionHeader: i.isSectionHeader ?? false,
    isNetIncome: i.isNetIncome ?? false,
  });
  return {
    companyName: fin.companyName ?? '',
    dateRange: '',
    fileName: '',
    uploadedAt: '',
    years: fin.years,
    periods: getPropDevAvailableKeys(fin),
    pl: fin.pl.map(toItem),
    bs: fin.bs.map(toItem),
    cf: (fin.cf ?? []).map(toItem),
  };
}

function cashAtMonthKey(fin: PDFinancialsLike, key: string | null): number {
  if (!key) return 0;
  const year = parseInt(key.split(' ')[1] ?? '0', 10);
  if (!year) return 0;
  return pdKpisForScope(fin, year, [key]).cash;
}

function openingCashForYear(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  year: number,
  years: number[],
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const periodKeys = periodKeysForPropDevYear(fin, year, anchor);
  const available = getPropDevAvailableKeys(fin);
  if (periodKeys?.length && available.length) {
    const first = periodKeys[0];
    const idx = available.indexOf(first);
    if (idx > 0) return cashAtMonthKey(fin, available[idx - 1]);
  }
  const prevIdx = years.indexOf(year) - 1;
  if (prevIdx < 0) return 0;
  return readCash(fin, company, years[prevIdx], false, null);
}

function applyCashRunway(snapshots: PropDevCfSnapshot[]): void {
  const burnWindow = 3;
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    // Positive / zero Operating CF ⇒ no burn. Do not use prior-year burn to invent
    // a runaway ratio (e.g. 820 months when 2024 OpCF is net positive).
    if (s.operatingCf >= 0 || !(s.monthlyBurnRate > 0)) {
      s.cashRunwayMonths = null;
      continue;
    }
    const window = snapshots.slice(Math.max(0, i - burnWindow + 1), i + 1);
    const burns = window.map(x => x.monthlyBurnRate).filter(b => b > 0);
    const avgBurn = burns.length ? burns.reduce((sum, b) => sum + b, 0) / burns.length : 0;
    s.cashRunwayMonths = avgBurn > 0 ? safeRatio(s.closingCash, avgBurn, 1) : null;
  }
}

function readEquity(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  y: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): number {
  const monthKey = endPeriodKey(fin, y, anchor);
  if (monthKey) {
    const eq = bsAbsAtMonthKey(fin.bs, /^total\s+for\s+equity$/i, monthKey)
      || bsAbsAtMonthKey(fin.bs, /^total\s+equity$/i, monthKey);
    if (eq !== 0) return fin.bs.find(i => /^total\s+for\s+equity$/i.test(i.label))?.monthlyValues?.[monthKey]
      ?? fin.bs.find(i => /^total\s+equity$/i.test(i.label))?.monthlyValues?.[monthKey]
      ?? eq;
  }
  if (fin.bs.length) {
    const equity = pdYV(fin.bs, /^total\s+for\s+equity$/i, y)
      || pdYV(fin.bs, /^total\s+equity$/i, y)
      || pdYV(fin.bs, /^partners?\s+capital$/i, y);
    if (equity !== 0) return equity;
    const assets = pdYV(fin.bs, /^total\s+for\s+assets$/i, y) || pdYV(fin.bs, /^total\s+assets$/i, y);
    const liab = pdYV(fin.bs, /^total\s+for\s+liabilities$/i, y)
      || pdYV(fin.bs, /^total\s+liabilit(?:y|ies)$/i, y);
    if (assets !== 0 || liab !== 0) return assets - Math.abs(liab);
  }
  const ybs = yearlyBsFor(company, y);
  if (ybs) return ybs.total_assets - ybs.total_liabilities;
  return 0;
}

function readTotalAssets(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  y: number,
  fallback: number,
  _anchor?: YearSnapshotPeriodAnchor | null,
  opts?: { annualLedger?: boolean },
): number {
  const isAssetsTotal = (lab: string) =>
    labelMatches(lab, /^total\s+for\s+assets$/i)
    || labelMatches(lab, /^total\s+assets$/i)
    || labelMatches(lab, /^total\s*\(?\s*assets\s*\)?$/i);

  let yearAmt = 0;
  let bestAnyYear = 0;
  if (fin.bs.length) {
    for (const i of fin.bs) {
      if (i.isSectionHeader || !isAssetsTotal(i.label)) continue;
      const yv = Math.abs(yearVal(i.values, y));
      if (yv > yearAmt) yearAmt = yv;
      for (const raw of Object.values(i.values ?? {})) {
        const v = Math.abs(Number(raw) || 0);
        if (v > bestAnyYear) bestAnyYear = v;
      }
      // After scopePropDevFinToPeriod + annualLedger, values[year] is period-end —
      // do not let leftover monthly cells override (caused ~$27.7M vs $32.2M mixes).
      if (!opts?.annualLedger) {
        for (const raw of Object.values(i.monthlyValues ?? {})) {
          const v = Math.abs(Number(raw) || 0);
          if (v > bestAnyYear) bestAnyYear = v;
        }
      }
    }
  }
  if (opts?.annualLedger && yearAmt > 0) return yearAmt;
  // Prefer the selected year's Total Assets when present. Only fall back to the
  // strongest historical/monthly amount when this year's figure is a clear stub
  // (≪ best) — e.g. incomplete YTD upload vs a prior full-year ~$32M ledger.
  if (yearAmt > 0 && (bestAnyYear <= 0 || yearAmt >= bestAnyYear * 0.5)) {
    return yearAmt;
  }
  if (bestAnyYear > 0 && (yearAmt <= 0 || yearAmt < bestAnyYear * 0.5)) {
    return bestAnyYear;
  }
  if (yearAmt > 0) return yearAmt;

  const ybs = yearlyBsFor(company, y);
  if (ybs?.total_assets && ybs.total_assets > 0) return ybs.total_assets;
  return fallback;
}

export interface PropDevBsSnapshot {
  year: number;
  yearLabel: string;
  landValue: number;
  improvementsWip: number;
  /** "Improvements" B/S line only (e.g. "Improvements - Others"), excluding Interest Capitalised. */
  landImprovements: number;
  totalFixedAssets: number;
  cash: number;
  totalAssets: number;
  totalDebt: number;
  /** "Total for Long-term business loans" B/S line — distinct from totalDebt (Total for Liabilities). */
  longTermLoans: number;
  /** "Total for Partner Investments" B/S line — Capital Raised, per the Capital Structure tab. */
  partnerInvestments: number;
  equity: number;
  ltlv: number | null;
  otherAssets: number;
  debtSource: PropDevDebtSource;
  debtAsOfNote: string;
}

export function buildPropDevBsSnapshots(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  anchor?: YearSnapshotPeriodAnchor | null,
  opts?: PropDevSnapshotOpts & { loans?: Loan[] },
): PropDevBsSnapshot[] {
  if (!fin.bs.length && !company?.property.yearlyBS) return [];
  const years = propDevYearsSpanningActivity(fin.years, y =>
    propDevStatementHasYearActivity(fin.bs, y)
    || !!company?.property.yearlyBS?.[String(y)],
  );
  const lastYear = years[years.length - 1];
  // After scopePropDevFinToPeriod, values[year] already holds period-end balances —
  // do not re-read monthlyValues (stale current-period cells diverge from YoY Detail).
  const readAnchor = opts?.annualLedger ? null : anchor;
  const loansForDebt = opts?.loans?.length
    ? opts.loans
    : (company?.loans ?? []);

  return years.map(y => {
    const isLatest = y === lastYear;
    const improvementsWip = readImprovements(fin, company, y, readAnchor);
    const landImprovements = readLandImprovementsOnly(fin, company, y, readAnchor);
    const faTotal = readFixedAssetsTotal(fin, y, readAnchor);
    const landValue = readLand(fin, company, y, readAnchor);
    // Prefer Excel "Total for Fixed Assets" when present; else land + improvements.
    const totalFixedAssets = faTotal > 0 ? faTotal : landValue + improvementsWip;
    const cash = readCash(fin, company, y, isLatest, readAnchor);
    const totalAssets = readTotalAssets(
      fin, company, y, totalFixedAssets + cash, readAnchor, { annualLedger: opts?.annualLedger },
    );
    const debt = resolveTotalDebt(company, fin, y, isLatest, loansForDebt);
    const totalDebt = debt.amount;
    const longTermLoans = readBsLongTermDebt(fin.bs, y);
    const partnerInvestments = readBsPartnerInvestments(fin.bs, y);
    // Snapshot Equity must match the same Assets/Debt columns (Assets − Debt).
    // Do not use a separate B/S equity / partners-capital line — those can drift vs
    // Total Assets and Total for Liabilities in some years.
    const equity = totalAssets - totalDebt;
    const ltlvDenom = landValue > 0 ? landValue : totalFixedAssets;
    const ltlv = ltlvDenom > 0 ? safeRatio(totalDebt, ltlvDenom, 1)! * 100 : null;
    const otherAssets = Math.max(0, totalAssets - cash - totalFixedAssets);

    return {
      year: y,
      yearLabel: yearSnapshotLabel(y, anchor),
      landValue,
      improvementsWip,
      landImprovements,
      totalFixedAssets,
      cash,
      totalAssets,
      totalDebt,
      longTermLoans,
      partnerInvestments,
      equity,
      ltlv: ltlv != null && Number.isFinite(ltlv) ? ltlv : null,
      otherAssets,
      debtSource: debt.source,
      debtAsOfNote: debt.asOfNote,
    };
  });
}

export interface PropDevCfSnapshot {
  year: number;
  yearLabel: string;
  operatingCf: number;
  investingCf: number;
  financingCf: number;
  netCashFlow: number;
  openingCash: number;
  closingCash: number;
  monthlyBurnRate: number;
  cashRunwayMonths: number | null;
}

function deriveOperatingFromPl(fin: PDFinancialsLike, y: number): number {
  const exp = Math.abs(
    pdYV(fin.pl, /^total\s+for\s+expenses?$/i, y) || pdYV(fin.pl, /^total\s+expenses?$/i, y),
  );
  const rev = Math.abs(
    pdYV(fin.pl, /^total\s+for\s+income$/i, y) || pdYV(fin.pl, /^total\s+income$/i, y),
  );
  return rev - exp;
}

export function buildPropDevCfSnapshots(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  anchor?: YearSnapshotPeriodAnchor | null,
  opts?: PropDevSnapshotOpts,
): PropDevCfSnapshot[] {
  const hasUploadedCf = (fin.cf?.length ?? 0) > 0;
  const hasBs = fin.bs.length > 0 || !!company?.property.yearlyBS;
  const hasCfSeed = company?.property.yearlyCF && Object.keys(company.property.yearlyCF).length > 0;
  // IMPORTANT: For Cash Flow we MUST keep the period anchor when building CF snapshots.
  // If anchor is removed, CF trend helpers treat it as a full-year chart and re-sum
  // Jan–Dec monthly CF cells, which causes 2026 KPI cards to diverge from YoY Detail.
  const cfAnchor = anchor;

  if (hasUploadedCf && hasBs) {
    const parsed = propDevFinToParsed(fin);
    const cfSnaps = buildCfSnapshots([parsed], cfAnchor);
    if (cfSnaps.length) {
      const snapshots: PropDevCfSnapshot[] = cfSnaps.map(s => {
        // Prefer real period keys for burn / P&L fallback even when annualLedger
        // (caller often passes already-scoped fin; year values then match the window).
        const periodKeysForMetrics = periodKeysForPropDevYear(fin, s.year, anchor);
        const monthCount = periodKeysForMetrics?.length ?? 12;
        let operatingCf = s.operatingCf;
        let investingCf = s.investingCf;
        let financingCf = s.financingCf;
        let netCashFlow = s.netCashFlow;

        // Seed / board labels ("Operating Cash Flow") or sparse YTD months can leave
        // section nets at $0 while cash clearly moved — bridge from B/S cash and P&L.
        if (operatingCf === 0 && investingCf === 0 && financingCf === 0 && fin.pl.length) {
          let fromPl = 0;
          if (periodKeysForMetrics?.length && !opts?.annualLedger) {
            const scoped = pdKpisForScope(fin, s.year, periodKeysForMetrics);
            fromPl = scoped.rev - scoped.exp;
          } else {
            fromPl = deriveOperatingFromPl(fin, s.year);
          }
          if (fromPl !== 0) operatingCf = fromPl;
        }
        if (
          netCashFlow === 0
          && (s.openingCash !== 0 || s.closingCash !== 0)
          && s.openingCash !== s.closingCash
        ) {
          netCashFlow = s.closingCash - s.openingCash;
        } else if (netCashFlow === 0 && operatingCf !== 0 && investingCf === 0 && financingCf === 0) {
          netCashFlow = operatingCf;
        }

        const monthlyBurnRate = operatingCf < 0 ? Math.abs(operatingCf) / monthCount : 0;
        return {
          year: s.year,
          yearLabel: yearSnapshotLabel(s.year, anchor),
          operatingCf,
          investingCf,
          financingCf,
          netCashFlow,
          openingCash: s.openingCash,
          closingCash: s.closingCash,
          monthlyBurnRate,
          cashRunwayMonths: null,
        };
      });
      applyCashRunway(snapshots);
      return snapshots;
    }
  }

  if (!hasCfSeed && !fin.pl.length && !hasBs) return [];

  const years = propDevYearsSpanningActivity(fin.years, y =>
    propDevStatementHasYearActivity(fin.cf, y)
    || propDevStatementHasYearActivity(fin.pl, y)
    || !!company?.property.yearlyCF?.[String(y)],
  );
  const lastYear = years[years.length - 1];
  const snapshots: PropDevCfSnapshot[] = [];

  for (let i = 0; i < years.length; i++) {
    const y = years[i];
    const isLatest = y === lastYear;
    const ycf = yearlyCfFor(company, y);
    const periodKeys = opts?.annualLedger ? undefined : periodKeysForPropDevYear(fin, y, anchor);
    const monthCount = periodKeys?.length ?? 12;

    let operatingCf = ycf?.operating ?? 0;
    let investingCf = ycf?.investing ?? 0;
    let financingCf = ycf?.financing ?? 0;
    let netCashFlow = ycf?.net_change ?? 0;

    if (!ycf && fin.pl.length) {
      if (periodKeys?.length) {
        const scoped = pdKpisForScope(fin, y, periodKeys);
        operatingCf = scoped.rev - scoped.exp;
        netCashFlow = operatingCf;
      } else {
        operatingCf = deriveOperatingFromPl(fin, y);
        netCashFlow = operatingCf;
      }
    }

    const openingCash = openingCashForYear(fin, company, y, fin.years, cfAnchor);
    const closingCash = fin.bs.length
      ? cashBalanceAtPeriodEnd(propDevFinToParsed(fin), y, cfAnchor)
      : readCash(fin, company, y, isLatest, cfAnchor);

    if (netCashFlow === 0 && openingCash > 0 && closingCash > 0) {
      netCashFlow = closingCash - openingCash;
    }

    const monthlyBurnRate = operatingCf < 0 ? Math.abs(operatingCf) / monthCount : 0;

    snapshots.push({
      year: y,
      yearLabel: yearSnapshotLabel(y, anchor),
      operatingCf,
      investingCf,
      financingCf,
      netCashFlow,
      openingCash,
      closingCash,
      monthlyBurnRate,
      cashRunwayMonths: null,
    });
  }

  applyCashRunway(snapshots);
  return snapshots;
}

export interface CashRunwayHero {
  months: number | null;
  avgMonthlyBurn: number;
  cashBalance: number;
  label: string;
  /** True when Operating CF is non-negative / no burn — runway not applicable. */
  cashFlowPositive?: boolean;
}

export function computeCashRunwayHero(
  snapshots: PropDevCfSnapshot[],
  company: CompanyData | null | undefined,
  selectedYear?: number | null,
): CashRunwayHero {
  const latest = snapshots[snapshots.length - 1];
  if (!latest) {
    const cash = company?.property.cashAvailable ?? 0;
    return { months: null, avgMonthlyBurn: 0, cashBalance: cash, label: 'N/A — no cash flow data' };
  }

  const focus =
    selectedYear != null
      ? (snapshots.find(s => s.year === selectedYear) ?? latest)
      : latest;

  const cashBalance = focus.closingCash;
  const focusIdx = snapshots.findIndex(s => s.year === focus.year);
  const i = focusIdx >= 0 ? focusIdx : snapshots.length - 1;

  // Selected/year of focus with net-positive (or zero) Operating CF — runway is not applicable
  if (focus.operatingCf >= 0 || !(focus.monthlyBurnRate > 0)) {
    return {
      months: null,
      avgMonthlyBurn: 0,
      cashBalance,
      label: 'N/A',
      cashFlowPositive: true,
    };
  }

  const burnWindow = Math.min(6, i + 1);
  const recent = snapshots.slice(Math.max(0, i - burnWindow + 1), i + 1);
  const burns = recent.map(s => s.monthlyBurnRate).filter(b => b > 0);
  const avgMonthlyBurn = burns.length ? burns.reduce((s, b) => s + b, 0) / burns.length : 0;
  const months = avgMonthlyBurn > 0 ? safeRatio(cashBalance, avgMonthlyBurn, 1) : null;

  let label = 'N/A';
  if (months != null) {
    label = `~${months.toFixed(1)} months at current burn`;
  } else if (avgMonthlyBurn <= 0) {
    label = 'N/A — no operating burn recorded';
  }

  return { months, avgMonthlyBurn, cashBalance, label };
}

export interface PropDevCfoInsight {
  color: string;
  text: string;
}

export function buildPropDevCfoInsights(
  fin: PDFinancialsLike,
  company: CompanyData | null | undefined,
  allLoans: Loan[],
  bsSnapshots: PropDevBsSnapshot[],
  cfSnapshots: PropDevCfSnapshot[],
): PropDevCfoInsight[] {
  const insights: PropDevCfoInsight[] = [];
  const lastY = fin.years[fin.years.length - 1];
  const lastBs = bsSnapshots[bsSnapshots.length - 1];
  const runway = computeCashRunwayHero(cfSnapshots, company);
  const coverage = company ? computeCapitalCallCoverage(company, 6, allLoans) : null;

  const isInterestExpenseLabel = (label: string): boolean => {
    if (!/interest/i.test(label)) return false;
    if (/income|earned|receiv|capitali[sz]ed/i.test(label)) return false;
    return true;
  };

  const interest = fin.pl.length
    ? Math.abs(
      fin.pl.filter(i => !i.isSectionHeader && !i.isTotal && isInterestExpenseLabel(i.label))
        .reduce((s, i) => s + Math.abs(i.values[lastY] ?? 0), 0),
    )
    : (company?.property.interestOnLoan ?? 0);

  const outstandingDebt = lastBs?.totalDebt
    ?? (company ? sumActivePropDevLoanBalances(company.loans ?? []) : 0);
  const debtAsOf = lastBs?.debtAsOfNote ?? 'Loan Tracker (current Loan Balance)';
  const periodLabel = lastBs?.yearLabel ?? String(lastY ?? '');

  if (runway.months != null && runway.avgMonthlyBurn > 0) {
    insights.push({
      color: 'bg-blue-50 border-blue-200',
      text: `💧 At current burn rate (~$${Math.round(runway.avgMonthlyBurn).toLocaleString()}/mo holding costs), cash covers approximately ${runway.months.toFixed(1)} months of operating spend.`,
    });
  } else if (runway.cashBalance > 0 && runway.avgMonthlyBurn <= 0) {
    insights.push({
      color: 'bg-gray-50 border-gray-200',
      text: `💧 Cash balance is $${Math.round(runway.cashBalance).toLocaleString()}; no recurring operating burn is recorded in cash flow data.`,
    });
  }

  if (interest > 0 || outstandingDebt > 0) {
    insights.push({
      color: 'bg-slate-50 border-slate-200',
      text: `📊 Cumulative interest cost in the holding phase: interest expense is accruing on $${(outstandingDebt / 1000).toFixed(1)}K outstanding debt (as of ${periodLabel}; ${debtAsOf}) with limited offsetting operating income — expected during pre-revenue development.`,
    });
  }

  if (coverage) {
    if (coverage.dataGap) {
      insights.push({
        color: 'bg-amber-50 border-amber-200',
        text: '⚠️ Capital Call Coverage unavailable — no partner committed capital and no open capital-call dues. Add commitments or capital calls to enable this KPI.',
      });
    } else if (coverage.ratio != null) {
      insights.push({
        color: coverage.status === 'Review' ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200',
        text: `🏦 Capital Call Coverage: ${coverage.ratio.toFixed(1)}x — uncalled partner capital ($${Math.round(coverage.uncalled ?? 0).toLocaleString()}) vs upcoming EMI obligations ($${Math.round(coverage.obligations).toLocaleString()} over 6 months). Status: ${coverage.status}.`,
      });
    }
  }

  const negYrs = fin.years.filter(y => {
    const net = pdYV(fin.pl, /^net\s+income$/i, y)
      || pdYV(fin.pl, /^net\s+profit/i, y)
      || pdYV(fin.pl, /^profit(?:\s*\/?\s*loss)?\s+for\s+the\s+(year|period)$/i, y);
    return net < 0;
  }).length;

  if (negYrs > 0 && fin.pl.length) {
    insights.push({
      color: 'bg-gray-50 border-gray-200',
      text: `ℹ️ Net income negative for ${negYrs} of ${fin.years.length} years — normal for a pre-revenue development entity during the holding/entitlement phase (not a rental-style profitability warning).`,
    });
  }

  const land = lastBs?.landValue ?? (company ? resolveLandValue(company) : null);
  const ltlv = lastBs?.ltlv;
  if (land && land > 0 && outstandingDebt > 0) {
    insights.push({
      color: 'bg-gray-50 border-gray-200',
      text: `📋 Cost basis: Land $${(land / 1000).toFixed(1)}K | Outstanding debt (as of ${periodLabel}): $${(outstandingDebt / 1000).toFixed(1)}K · ${debtAsOf} | Loan-to-Land-Value: ${ltlv != null ? `${ltlv.toFixed(1)}%` : 'N/A'} (informational — development LTLV, not rental LTV).`,
    });
  }

  return insights;
}

export function getPropDevAvailableKeys(fin: PDFinancialsLike): string[] {
  const keys = new Set<string>();
  for (const section of [...fin.pl, ...fin.bs]) {
    if (section.monthlyValues) {
      Object.keys(section.monthlyValues).forEach(k => keys.add(k));
    }
  }
  return [...keys].sort((a, b) => {
    const [ma, ya] = a.split(' ');
    const [mb, yb] = b.split(' ');
    const yDiff = parseInt(ya) - parseInt(yb);
    if (yDiff !== 0) return yDiff;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months.indexOf(ma) - months.indexOf(mb);
  });
}
