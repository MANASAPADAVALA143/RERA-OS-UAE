import {
  anchorPeriodKeys,
  cashBalanceAtPeriodEnd,
  type YearSnapshotPeriodAnchor,
  unionYears,
  yearSnapshotLabel,
} from './cfoMultiYearTrendData';
import { monthKeyFromParts } from './periodWindow';
import {
  calcKpis,
  calcKpisFromMonthlyKey,
  calcKpisYtdThroughMonth,
  getAvailableKeys,
  type FinItem,
  type ParsedFinancials,
} from './rentalKpiEngine';

const NET_OCF_RE = /net\s+cash\s+(provided|used)\s+(by\s+)?(\(used\s+in\)\s+)?operating|net\s+cash\s+from\s+operating|net\s+cash\s+provided\s+by\s+operations|^operating\s+cash\s+flow\b/i;
const NET_ICF_RE = /net\s+cash\s+(provided|used)\s+(by\s+)?(\(used\s+in\)\s+)?investing|net\s+cash\s+from\s+investing|^investing\s+cash\s+flow\b/i;
const NET_FCF_RE = /net\s+cash\s+(provided|used)\s+(by\s+)?(\(used\s+in\)\s+)?financing|net\s+cash\s+from\s+financing|^financing\s+cash\s+flow\b/i;
const SECTION_OPERATING_RE = /^operating\s+activities/i;
const SECTION_INVESTING_RE = /^investing\s+activities/i;
const SECTION_FINANCING_RE = /^financing\s+activities/i;
const NET_CHANGE_RE = /net\s+(cash\s+)?(increase|decrease)(\s+in\s+cash)?|net\s+change\s+in\s+cash|net\s+increase\s*\(\s*decrease\s*\)(\s+in\s+cash)?/i;
const CASH_BALANCE_RE = /cash\s+(and\s+cash\s+equivalents\s+)?at\s+(the\s+)?(beginning|end)|beginning\s+cash|ending\s+cash|cash\s+balance\s+at/i;
const CASH_BEGIN_RE = /cash\s+(and\s+cash\s+equivalents\s+)?at\s+(the\s+)?beginning|beginning\s+cash/i;
const CASH_END_RE = /cash\s+(and\s+cash\s+equivalents\s+)?at\s+(the\s+)?end|ending\s+cash/i;

function isCfSectionNet(label: string): boolean {
  return NET_OCF_RE.test(label) || NET_ICF_RE.test(label) || NET_FCF_RE.test(label);
}

function isNetChangeLabel(label: string): boolean {
  if (isCfSectionNet(label) || CASH_BALANCE_RE.test(label)) return false;
  return NET_CHANGE_RE.test(label) && /cash/i.test(label);
}

function normKey(k: string): string {
  return k.replace(/-/g, ' ');
}

function cfValueForItem(item: FinItem, keys: string[], year: number): number {
  // Prefer monthly keys when this line actually has monthly CF data.
  // Annual-only CF uploads (year columns like the live Cash Flow tab) store
  // amounts on values[year] — do not treat empty monthlyValues as $0.
  if (keys.length && item.monthlyValues) {
    let sawKey = false;
    let sum = 0;
    for (const k of keys) {
      const nk = normKey(k);
      if (item.monthlyValues[nk] != null || item.monthlyValues[k] != null) {
        sawKey = true;
        sum += item.monthlyValues[nk] ?? item.monthlyValues[k] ?? 0;
      }
    }
    if (sawKey) return sum;
  }
  return item.values[year] ?? 0;
}

/** Section net total — last matching row wins (QB section subtotal), never sum duplicates. */
function findCfPattern(
  fin: ParsedFinancials,
  pattern: RegExp,
  keys: string[],
  year: number,
): { found: boolean; value: number } {
  let last = 0;
  let found = false;
  for (const item of fin.cf) {
    if (item.isSectionHeader || !pattern.test(item.label)) continue;
    last = cfValueForItem(item, keys, year);
    found = true;
  }
  return { found, value: last };
}

function sumCfPattern(fin: ParsedFinancials, pattern: RegExp, keys: string[], year: number): number {
  return findCfPattern(fin, pattern, keys, year).value;
}

/**
 * When QBO-style uploads omit "Net cash provided by operating…" totals,
 * sum detail lines inside the Operating / Investing / Financing sections.
 */
function sumCfSectionFallback(
  fin: ParsedFinancials,
  sectionRe: RegExp,
  keys: string[],
  year: number,
): number {
  let inSection = false;
  let sum = 0;
  let saw = false;
  for (const item of fin.cf) {
    const label = item.label.trim();
    if (item.isSectionHeader || SECTION_OPERATING_RE.test(label) || SECTION_INVESTING_RE.test(label) || SECTION_FINANCING_RE.test(label)) {
      if (sectionRe.test(label)) {
        inSection = true;
        continue;
      }
      if (inSection) break;
      continue;
    }
    if (!inSection) continue;
    if (isCfSectionNet(label) || isNetChangeLabel(label) || CASH_BALANCE_RE.test(label)) continue;
    if (item.isNetIncome) continue;
    const val = cfValueForItem(item, keys, year);
    if (val !== 0) {
      sum += val;
      saw = true;
    }
  }
  return saw ? sum : 0;
}

function sectionCfTotal(
  fin: ParsedFinancials,
  netRe: RegExp,
  sectionRe: RegExp,
  keys: string[],
  year: number,
): number {
  const hit = findCfPattern(fin, netRe, keys, year);
  if (hit.found) return hit.value;
  return sumCfSectionFallback(fin, sectionRe, keys, year);
}

function readCashBridge(fin: ParsedFinancials, keys: string[], year: number): number | null {
  let beginning: number | null = null;
  let ending: number | null = null;
  for (const item of fin.cf) {
    if (item.isSectionHeader) continue;
    const lbl = item.label;
    if (CASH_BEGIN_RE.test(lbl)) beginning = cfValueForItem(item, keys, year);
    if (CASH_END_RE.test(lbl)) ending = cfValueForItem(item, keys, year);
  }
  if (beginning !== null && ending !== null) return ending - beginning;
  return null;
}

function readNetChange(fin: ParsedFinancials, keys: string[], year: number): number | null {
  let last: number | null = null;
  for (const item of fin.cf) {
    if (item.isSectionHeader || !isNetChangeLabel(item.label)) continue;
    last = cfValueForItem(item, keys, year);
  }
  if (last !== null) return last;
  return readCashBridge(fin, keys, year);
}

function netCfTotal(fin: ParsedFinancials, keys: string[], year: number): number {
  const netChange = readNetChange(fin, keys, year);
  if (netChange !== null) return netChange;

  const fromSections =
    sectionCfTotal(fin, NET_OCF_RE, SECTION_OPERATING_RE, keys, year) +
    sectionCfTotal(fin, NET_ICF_RE, SECTION_INVESTING_RE, keys, year) +
    sectionCfTotal(fin, NET_FCF_RE, SECTION_FINANCING_RE, keys, year);
  if (fromSections !== 0) return fromSections;

  const totals = fin.cf.filter(i => i.isTotal || i.isNetIncome);
  const last = totals[totals.length - 1];
  if (!last) return 0;
  return cfValueForItem(last, keys, year);
}

/** Net cash increase/decrease for a period window — used by CF table and CFO charts. */
export function cfNetCashFlow(fin: ParsedFinancials, keys: string[], year: number): number {
  if (!fin.cf.length) return 0;
  return netCfTotal(fin, keys, year);
}

/** Period-scoped CF section totals — same logic as Financials → Cash Flow tab. */
export function cfPeriodTotals(
  fin: ParsedFinancials,
  keys: string[],
  year: number,
): {
  operatingCf: number;
  investingCf: number;
  financingCf: number;
  netCashFlow: number;
  hasCfStatement: boolean;
} {
  const hasCf = fin.cf.length > 0;
  if (!hasCf) {
    return { operatingCf: 0, investingCf: 0, financingCf: 0, netCashFlow: 0, hasCfStatement: false };
  }
  const operatingCf = hasCf ? sectionCfTotal(fin, NET_OCF_RE, SECTION_OPERATING_RE, keys, year) : 0;
  const investingCf = hasCf ? sectionCfTotal(fin, NET_ICF_RE, SECTION_INVESTING_RE, keys, year) : 0;
  const financingCf = hasCf ? sectionCfTotal(fin, NET_FCF_RE, SECTION_FINANCING_RE, keys, year) : 0;
  const netCashFlow = netCfTotal(fin, keys, year);
  const hasCfStatement = operatingCf !== 0 || investingCf !== 0 || financingCf !== 0 || netCashFlow !== 0;
  return { operatingCf, investingCf, financingCf, netCashFlow, hasCfStatement };
}

function cashAtKey(fin: ParsedFinancials, key: string | null): number {
  if (!key) return 0;
  return calcKpisFromMonthlyKey(fin, key).cash;
}

/** Opening cash = balance immediately before the period window (point-in-time, not summed). */

function openingCashKey(fin: ParsedFinancials, keys: string[], year: number): string | null {
  const available = getAvailableKeys(fin);
  if (!keys.length) {
    const prevYearKeys = available.filter(k => k.endsWith(` ${year - 1}`));
    return prevYearKeys.length ? prevYearKeys[prevYearKeys.length - 1] : null;
  }
  const first = keys[0];
  const idx = available.indexOf(first);
  if (idx > 0) return available[idx - 1];
  return available.filter(k => k.endsWith(` ${year - 1}`)).pop() ?? null;
}

function cfKeysForYear(
  fin: ParsedFinancials,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): string[] {
  return anchorPeriodKeys(fin, year, anchor);
}

/** True when CF upload has detail lines beyond the three net section totals. */
export function cfHasSubCategories(fin: ParsedFinancials): boolean {
  const netLines = fin.cf.filter(i =>
    !i.isSectionHeader && (NET_OCF_RE.test(i.label) || NET_ICF_RE.test(i.label) || NET_FCF_RE.test(i.label)),
  ).length;
  const detailLines = fin.cf.filter(i =>
    !i.isSectionHeader && !i.isTotal && !NET_OCF_RE.test(i.label) && !NET_ICF_RE.test(i.label) && !NET_FCF_RE.test(i.label)
    && !/^operating activities$|^investing activities$|^financing activities$/i.test(i.label.trim()),
  ).length;
  return detailLines > 3 && detailLines > netLines;
}

export interface CfSnapshot {
  year: number;
  yearLabel: string;
  operatingCf: number;
  investingCf: number;
  financingCf: number;
  netCashFlow: number;
  openingCash: number;
  closingCash: number;
  operatingCfMargin: number | null;
  hasCfStatement: boolean;
}

function readCfSnapshot(
  fin: ParsedFinancials,
  year: number,
  anchor?: YearSnapshotPeriodAnchor | null,
): CfSnapshot | null {
  const keys = cfKeysForYear(fin, year, anchor);
  const hasCf = fin.cf.length > 0;
  if (!hasCf && !fin.bs.length) return null;

  const operatingCf = hasCf ? sectionCfTotal(fin, NET_OCF_RE, SECTION_OPERATING_RE, keys, year) : 0;
  const investingCf = hasCf ? sectionCfTotal(fin, NET_ICF_RE, SECTION_INVESTING_RE, keys, year) : 0;
  const financingCf = hasCf ? sectionCfTotal(fin, NET_FCF_RE, SECTION_FINANCING_RE, keys, year) : 0;
  const netCashFlow = hasCf ? netCfTotal(fin, keys, year) : 0;

  const openingKey = openingCashKey(fin, keys, year);
  const closingCash = cashBalanceAtPeriodEnd(fin, year, anchor);
  const openingCash = cashAtKey(fin, openingKey);

  const revenue = anchor && year === anchor.year
    ? (anchor.period === 'Month'
      ? calcKpisFromMonthlyKey(fin, monthKeyFromParts(anchor.month, anchor.year)).totalRevenue
      : calcKpisYtdThroughMonth(fin, year, anchor.month)?.totalRevenue ?? 0)
    : calcKpis(fin, year).totalRevenue;

  const hasData = hasCf && (
    operatingCf !== 0 || investingCf !== 0 || financingCf !== 0 || netCashFlow !== 0
    || fin.cf.some(i => !i.isSectionHeader && cfValueForItem(i, keys, year) !== 0)
  );
  if (!hasData && closingCash === 0) return null;

  return {
    year,
    yearLabel: yearSnapshotLabel(year, anchor),
    operatingCf,
    investingCf,
    financingCf,
    netCashFlow,
    openingCash,
    closingCash,
    operatingCfMargin: revenue > 0 ? (operatingCf / revenue) * 100 : null,
    hasCfStatement: hasData,
  };
}

export function buildCfSnapshots(
  fins: ParsedFinancials[],
  anchor?: YearSnapshotPeriodAnchor | null,
): CfSnapshot[] {
  if (!fins.length) return [];
  if (!fins.some(f => f.cf.length)) return [];
  return unionYears(fins)
    .map(y => {
      const parts = fins
        .filter(f => f.years.includes(y))
        .map(f => readCfSnapshot(f, y, anchor))
        .filter((r): r is CfSnapshot => r != null);
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0]!;
      const operatingCf = parts.reduce((s, p) => s + p.operatingCf, 0);
      const investingCf = parts.reduce((s, p) => s + p.investingCf, 0);
      const financingCf = parts.reduce((s, p) => s + p.financingCf, 0);
      const netCashFlow = parts.reduce((s, p) => s + p.netCashFlow, 0);
      const openingCash = parts.reduce((s, p) => s + p.openingCash, 0);
      const closingCash = parts.reduce((s, p) => s + p.closingCash, 0);
      return {
        year: y,
        yearLabel: yearSnapshotLabel(y, anchor),
        operatingCf,
        investingCf,
        financingCf,
        netCashFlow,
        openingCash,
        closingCash,
        operatingCfMargin: null,
        hasCfStatement: parts.some(p => p.hasCfStatement),
      } satisfies CfSnapshot;
    })
    .filter((r): r is CfSnapshot => r != null);
}

export function cfPieFromSnapshot(s: CfSnapshot) {
  return [
    { name: 'Operating CF', value: Math.abs(s.operatingCf), signedValue: s.operatingCf },
    { name: 'Investing CF', value: Math.abs(s.investingCf), signedValue: s.investingCf },
    { name: 'Financing CF', value: Math.abs(s.financingCf), signedValue: s.financingCf },
  ].filter(e => e.value > 0);
}

export const CF_DRILL_PATTERNS: Record<string, RegExp> = {
  'Operating CF': NET_OCF_RE,
  'Investing CF': NET_ICF_RE,
  'Financing CF': NET_FCF_RE,
};

export function cfSourceStacksForYear(fin: ParsedFinancials, year: number, keys: string[]): Record<string, number> | null {
  if (!cfHasSubCategories(fin)) return null;
  const stacks: Record<string, number> = {};
  for (const item of fin.cf) {
    if (item.isSectionHeader || item.isTotal || NET_OCF_RE.test(item.label) || NET_ICF_RE.test(item.label) || NET_FCF_RE.test(item.label)) continue;
    const label = item.label.trim();
    if (!label || /^operating activities$|^investing activities$|^financing activities$/i.test(label)) continue;
    const val = keys.length
      ? keys.reduce((s, k) => {
        const nk = normKey(k);
        return s + (item.monthlyValues?.[nk] ?? item.monthlyValues?.[k] ?? 0);
      }, 0)
      : (item.values[year] ?? 0);
    if (val !== 0) stacks[label] = (stacks[label] ?? 0) + val;
  }
  return Object.keys(stacks).length ? stacks : null;
}
