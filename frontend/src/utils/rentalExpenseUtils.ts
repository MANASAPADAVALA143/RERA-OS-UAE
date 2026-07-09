// Shared expense categorisation logic — used by RentalExpenses and RentalCompanyDashboard.
// Keep in sync: any change here affects both pages.

export interface FinItem {
  label: string;
  values?: Record<number, number>;
  monthlyValues?: Record<string, number>;
  isSectionHeader?: boolean;
  isTotal?: boolean;
  children?: FinItem[];
}

export const ONE_TIME_CAT = 'OneTimeAdjustment';
export const ONE_TIME_RE  = /sec\s*481|481\s*\(a\)|accounting\s*method\s*adjustment/i;

export const EXPENSE_CATS: { label: string; re: RegExp }[] = [
  { label: 'Management Fee',           re: /management\s*fee/i },
  { label: 'Insurance',                re: /insurance/i },
  { label: 'Interest',                 re: /interest.*loan|interest.*paid|interest.*expense|interest\s+on/i },
  { label: 'Legal',                    re: /\blegal\b/i },
  { label: 'Accounting Fee',           re: /accounting\s*fee/i },
  { label: 'HOA',                      re: /\bhoa\b/i },
  { label: 'Property Tax',             re: /property\s*tax|real\s*estate\s*tax/i },
  { label: 'Repairs & Maintenance',    re: /repair|maintenance/i },
  { label: 'Utilities',                re: /utilit/i },
  { label: 'Depreciation',             re: /depreciat/i },
  { label: 'Consulting',               re: /consult/i },
  { label: 'Loan Processing',          re: /loan.*process/i },
  { label: 'Membership/Subscriptions', re: /membership|subscript/i },
  { label: 'Misc Expenses',            re: /\bmisc\b/i },
  { label: 'Office Supplies',          re: /office.*suppl/i },
  { label: 'Cleaning',                 re: /clean/i },
  { label: 'Irrigation',               re: /irrigat/i },
  { label: 'Advertising',              re: /advertis/i },
  { label: 'Appraisal Fee',            re: /apprais/i },
  { label: 'Bank Charges',             re: /bank.*charg|bank.*fee/i },
  { label: 'Commission',               re: /commission/i },
  { label: 'Courier',                  re: /courier/i },
  { label: 'Donation',                 re: /donat/i },
  { label: 'Engineering',              re: /engineer/i },
  { label: 'Fire Safety',              re: /fire.*safe|fire.*protect/i },
];

export const SKIP_RE = /^(total|subtotal|net\s|gross\s|\bincome\b|^revenue|rental\s+income|rent\s+income|rent\s*-|other\s+income|total\s+revenue|total\s+income|total\s+rent|operating\s+income|net\s+income|net\s+loss)/i;

export const REVENUE_LINE_RE  = /rental\s+income|rent\s+income|other\s+income|parking\s+income|rent\s*-/i;
export const REVENUE_SKIP_RE  = /^(total\s|subtotal\s|net\s|gross\s)/i;

const TOTAL_EXPENSE_RE = /^total\s+for\s+expenses?$/i;
const TOTAL_EXPENSE_ALT_RE = /^total\s+expenses?$/i;

/** Normalise month keys to "Mon YYYY" (space-separated). */
export function normalizeMonthKey(month: string): string {
  return month.replace(/-/g, ' ');
}

/** Official P&L expense total per month from "Total for Expenses" / "Total Expenses" rows. */
export function getOfficialMonthlyExpenses(pl: FinItem[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of flattenItems(pl)) {
    const t = item.label.trim();
    if (!TOTAL_EXPENSE_RE.test(t) && !TOTAL_EXPENSE_ALT_RE.test(t)) continue;
    for (const [month, val] of Object.entries(item.monthlyValues ?? {})) {
      const norm = normalizeMonthKey(month);
      map[norm] = Math.abs(val as number);
    }
  }
  return map;
}

/** Returns the expense category for a P&L line label, or null to skip. */
export function classifyLabel(label: string): string | null {
  const t = label.trim();
  if (SKIP_RE.test(t)) return null;
  if (ONE_TIME_RE.test(t)) return ONE_TIME_CAT;
  for (const { label: cat, re } of EXPENSE_CATS) {
    if (re.test(label)) return cat;
  }
  return 'Other';
}

/** Recursively flatten a P&L item tree to leaf + parent nodes. */
export function flattenItems(items: FinItem[]): FinItem[] {
  const out: FinItem[] = [];
  function walk(list: FinItem[]) {
    for (const item of list) {
      out.push(item);
      if (item.children?.length) walk(item.children);
    }
  }
  walk(items);
  return out;
}

export const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function monthSortKey(k: string): number {
  const [m, y] = k.split(/[\s-]/);
  return (parseInt(y) || 0) * 100 + (MNAMES.indexOf(m) + 1);
}

export function allMonthKeys(items: FinItem[]): string[] {
  const s = new Set<string>();
  flattenItems(items).forEach(i => Object.keys(i.monthlyValues ?? {}).forEach(k => s.add(k)));
  return Array.from(s);
}

/** Indigo / purple / teal palette used across expense charts. */
export const EXP_PALETTE = [
  '#6366F1','#7C3AED','#14B8A6','#4F46E5','#8B5CF6',
  '#0D9488','#818CF8','#A78BFA','#2DD4BF','#5B21B6',
  '#312E81','#06B6D4','#C4B5FD','#99F6E4','#4338CA',
  '#1E1B4B','#67E8F9','#DDD6FE','#134E4A','#6D28D9',
];
export const catColor = (cat: string, cats: string[]) =>
  EXP_PALETTE[cats.indexOf(cat) % EXP_PALETTE.length] ?? '#A8A29E';

/**
 * From a flat P&L item list, build {category → all-time total} map.
 * Excludes Sec 481(a) one-time adjustments and skips section headers/totals.
 */
export function buildCategoryTotals(pl: FinItem[]): Record<string, number> {
  const byCat: Record<string, number> = {};
  for (const item of flattenItems(pl)) {
    if (item.children?.length || item.isSectionHeader || item.isTotal) continue;
    const cat = classifyLabel(item.label);
    if (!cat || cat === ONE_TIME_CAT) continue;
    for (const val of Object.values(item.monthlyValues ?? {})) {
      byCat[cat] = (byCat[cat] ?? 0) + Math.abs(val as number);
    }
  }
  return byCat;
}

/**
 * P&L expense total per month — uses "Total for Expenses" row when present
 * (matches Financials page). Falls back to summing classified detail lines.
 */
export function buildMonthlyExpense(pl: FinItem[]): Record<string, number> {
  const official = getOfficialMonthlyExpenses(pl);
  if (Object.keys(official).length > 0) return official;

  const map: Record<string, number> = {};
  for (const item of flattenItems(pl)) {
    if (item.children?.length || item.isSectionHeader || item.isTotal) continue;
    const cat = classifyLabel(item.label);
    if (!cat || cat === ONE_TIME_CAT) continue;
    for (const [month, val] of Object.entries(item.monthlyValues ?? {})) {
      const norm = normalizeMonthKey(month);
      map[norm] = (map[norm] ?? 0) + Math.abs(val as number);
    }
  }
  return map;
}

/**
 * From a flat P&L item list, build {normalised-month → total revenue} map.
 * Revenue lines: rent income, other income, parking income.
 */
export function buildMonthlyRevenue(pl: FinItem[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of flattenItems(pl)) {
    if (item.children?.length || item.isSectionHeader || item.isTotal) continue;
    const t = item.label.trim();
    if (REVENUE_SKIP_RE.test(t) || !REVENUE_LINE_RE.test(t)) continue;
    for (const [month, val] of Object.entries(item.monthlyValues ?? {})) {
      const norm = month.replace(/-/g, ' ');
      map[norm] = (map[norm] ?? 0) + Math.abs(val as number);
    }
  }
  return map;
}

/** P&L line is maintenance-related (repairs, maintenance, cleaning, etc.). */
export function isMaintenanceLine(label: string): boolean {
  const t = label.trim();
  if (SKIP_RE.test(t)) return false;
  const cat = classifyLabel(t);
  if (cat === 'Repairs & Maintenance' || cat === 'Cleaning') return true;
  return /repair|maintenance|cleaning|hvac|plumbing|landscap|pest|roofing|pool/i.test(t);
}

export interface MaintPlRow {
  company: string;
  account: string;
  month: string;
  amount: number;
}

/** Extract maintenance P&L account rows with monthly amounts. */
export function buildMaintenancePlRows(companyName: string, pl: FinItem[]): MaintPlRow[] {
  const rows: MaintPlRow[] = [];
  for (const item of flattenItems(pl)) {
    if (item.children?.length || item.isSectionHeader || item.isTotal) continue;
    if (!isMaintenanceLine(item.label)) continue;
    for (const [month, val] of Object.entries(item.monthlyValues ?? {})) {
      const amount = Math.abs(val as number);
      if (amount > 0) {
        rows.push({
          company: companyName,
          account: item.label.trim(),
          month: month.replace(/-/g, ' '),
          amount,
        });
      }
    }
  }
  return rows;
}

export function parseMonthKey(k: string): { month: number; year: number } {
  const parts = k.split(/[\s-]/);
  const month = MNAMES.indexOf(parts[0]) + 1;
  const year = parseInt(parts[parts.length - 1], 10);
  return { month: month > 0 ? month : 1, year: Number.isFinite(year) ? year : new Date().getFullYear() };
}

/** Minimum dollar denominator before MoM% or ratio% is shown (avoids divide-by-near-zero). */
export const KPI_MIN_DENOMINATOR = 100;

export function prevMonthKey(k: string): string {
  const [m, y] = k.split(' ');
  const mi = MNAMES.indexOf(m);
  return mi === 0 ? `Dec ${parseInt(y, 10) - 1}` : `${MNAMES[mi - 1]} ${y}`;
}

/** Safe month-over-month % — returns null when prior period is missing or below threshold. */
export function safeMomPct(curr: number, prev: number, minDenom = KPI_MIN_DENOMINATOR): number | null {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (prev < minDenom) return null;
  return ((curr - prev) / prev) * 100;
}

/** Safe ratio % (numerator ÷ denominator × 100) — null when denominator is too small. */
export function safeRatioPct(numerator: number, denominator: number, minDenom = KPI_MIN_DENOMINATOR): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator < minDenom) return null;
  return (numerator / denominator) * 100;
}
