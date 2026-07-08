/**
 * Shared rental KPI engine — single source of truth for Financials KPI Dashboard
 * and Executive Summary PPT export. Keep in sync with KPI card / benchmark logic.
 */
import { type Period, getPeriodKeys } from './periodWindow';
import { normalizeMonthKey } from './executiveSummaryFormatters';

export interface FinItem {
  label: string;
  values: Record<number, number>;
  monthlyValues?: Record<string, number>;
  indent: number;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
}

export interface ParsedFinancials {
  companyName: string;
  dateRange: string;
  fileName: string;
  uploadedAt: string;
  years: number[];
  periods: string[];
  pl: FinItem[];
  bs: FinItem[];
  cf: FinItem[];
}

export interface KpiData {
  totalRevenue: number; totalExpenses: number; netIncome: number; noi: number;
  rentalIncome: number; otherIncome: number;
  interestExpense: number; propertyTax: number; managementFee: number;
  hoaFees: number; legalFees: number; utilities: number; repairs: number;
  totalAssets: number; totalLiabilities: number; equity: number; cash: number;
  buildings: number; accumDep: number; longTermLoans: number; securityDeposits: number;
}

export type KpiStatus = 'good' | 'warn' | 'bad' | 'info';

export interface ExportKpiItem {
  label: string;
  value: string;
  benchmark: string;
  status: KpiStatus;
  statusLabel: string;
}

const _MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function normalizeFinItem(item: FinItem): FinItem {
  if (!item.monthlyValues) return item;
  const monthlyValues: Record<string, number> = {};
  for (const [k, v] of Object.entries(item.monthlyValues)) {
    monthlyValues[normalizeMonthKey(k)] = v;
  }
  return { ...item, monthlyValues };
}

export function apiResponseToParsedFinancials(data: {
  company_name?: string; date_range?: string; filename?: string; uploaded_at?: string;
  years?: number[]; periods?: string[]; pl?: FinItem[]; bs?: FinItem[]; cf?: FinItem[];
}): ParsedFinancials {
  return {
    companyName: data.company_name ?? '',
    dateRange: data.date_range ?? '',
    fileName: data.filename ?? '',
    uploadedAt: data.uploaded_at ?? '',
    years: data.years ?? [],
    periods: (data.periods ?? []).map(normalizeMonthKey),
    pl: (data.pl ?? []).map(normalizeFinItem),
    bs: (data.bs ?? []).map(normalizeFinItem),
    cf: (data.cf ?? []).map(normalizeFinItem),
  };
}

function sortPeriodKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const [am, ay] = a.split(' '); const [bm, by] = b.split(' ');
    return (parseInt(ay) - parseInt(by)) || (_MNAMES.indexOf(am) - _MNAMES.indexOf(bm));
  });
}

function getItemKeys(items: FinItem[]): string[] {
  const keySet = new Set<string>();
  for (const item of items) {
    if (item.monthlyValues) {
      Object.keys(item.monthlyValues).forEach(k => keySet.add(normalizeMonthKey(k)));
    }
  }
  return sortPeriodKeys([...keySet]);
}

export function getAvailableKeys(fin: ParsedFinancials): string[] {
  if (fin.periods?.length) {
    return sortPeriodKeys([...new Set(fin.periods.map(normalizeMonthKey))]);
  }
  return getItemKeys(fin.pl);
}

function latestAvailableKey(fin: ParsedFinancials): string | null {
  const keys = getAvailableKeys(fin);
  return keys.length ? keys[keys.length - 1] : null;
}

function getYV(items: FinItem[], pattern: RegExp, year: number): number {
  return items.find(i => pattern.test(i.label))?.values[year] ?? 0;
}

function sumI(items: FinItem[], pattern: RegExp, year: number): number {
  return items.filter(i => !i.isSectionHeader && !i.isTotal && pattern.test(i.label))
    .reduce((s, i) => s + (i.values[year] ?? 0), 0);
}

function getMV(pl: FinItem[], pattern: RegExp, key: string): number {
  const norm = normalizeMonthKey(key);
  const item = pl.find(i => pattern.test(i.label));
  if (!item?.monthlyValues) return 0;
  return item.monthlyValues[norm] ?? item.monthlyValues[key] ?? 0;
}

function sumMV(pl: FinItem[], pattern: RegExp, key: string): number {
  const norm = normalizeMonthKey(key);
  return pl.filter(i => !i.isSectionHeader && !i.isTotal && pattern.test(i.label))
    .reduce((s, i) => s + (i.monthlyValues?.[norm] ?? i.monthlyValues?.[key] ?? 0), 0);
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
  return {
    totalRevenue, totalExpenses, netIncome, interest, depreciation, noi,
    rentIncome, otherIncome, repairs, utilities, hoa, propertyTax, management, legal, insurance,
  };
}

interface PeriodAggregate extends MonthlyKpis { otherOpex: number }

export function sumKpisOverKeys(pl: FinItem[], keys: string[]): PeriodAggregate {
  let totalRevenue = 0, totalExpenses = 0, netIncome = 0, interest = 0, depreciation = 0;
  let rentIncome = 0, otherIncome = 0, repairs = 0, utilities = 0, hoa = 0;
  let propertyTax = 0, management = 0, legal = 0, insurance = 0;
  for (const k of keys) {
    const m = calcMonthlyKpis(pl, k);
    totalRevenue += m.totalRevenue;
    totalExpenses += m.totalExpenses;
    netIncome += m.netIncome;
    interest += m.interest;
    depreciation += m.depreciation;
    rentIncome += m.rentIncome;
    otherIncome += m.otherIncome;
    repairs += m.repairs;
    utilities += m.utilities;
    hoa += m.hoa;
    propertyTax += m.propertyTax;
    management += m.management;
    legal += m.legal;
    insurance += m.insurance;
  }
  const noi = totalRevenue - totalExpenses + interest;
  const otherOpex = Math.max(0, totalExpenses - interest - depreciation - repairs - utilities - hoa - propertyTax - management - legal - insurance);
  return {
    totalRevenue, totalExpenses, netIncome, interest, depreciation, noi,
    rentIncome, otherIncome, repairs, utilities, hoa, propertyTax, management, legal, insurance, otherOpex,
  };
}

export function calcKpis(fin: ParsedFinancials, year: number): KpiData {
  const pl = fin.pl; const bs = fin.bs;
  const totalRevenue =
    getYV(pl, /^total\s+for\s+income$/i, year) ||
    getYV(pl, /^total\s+income$/i, year) ||
    getYV(pl, /^gross\s+profit$/i, year) ||
    sumI(pl, /income|revenue|rent/i, year);
  const totalExpenses =
    getYV(pl, /^total\s+for\s+expenses?$/i, year) ||
    getYV(pl, /^total\s+expenses?$/i, year);
  const netIncome = getYV(pl, /^net\s+income$/i, year);
  const noiRow = getYV(pl, /^net\s+operating\s+income$/i, year);
  const interestExpense = Math.abs(
    getYV(pl, /^total\s+for\s+interest\s+paid$/i, year) ||
    sumI(pl, /^interest\s+on\s+loan|^interest\s+paid$/i, year),
  );
  const noi = noiRow || (totalRevenue - totalExpenses + interestExpense);
  const rentalIncome =
    getYV(pl, /^total\s+for\s+rental\s+income$/i, year) ||
    getYV(pl, /^total\s+for\s+services$/i, year) ||
    sumI(pl, /^rent\s+-|^rental\s+income$/i, year);
  const otherIncome = getYV(pl, /^other\s+income$/i, year) || 0;
  const propertyTax = Math.abs(
    getYV(pl, /^total\s+for\s+rates\s+&\s+taxes$/i, year) ||
    sumI(pl, /property\s+tax/i, year),
  );
  const managementFee = Math.abs(sumI(pl, /management\s+fee/i, year));
  const hoaFees = Math.abs(
    getYV(pl, /^total\s+for\s+hoa\s+expenses$/i, year) ||
    sumI(pl, /^hoa/i, year),
  );
  const legalFees = Math.abs(
    getYV(pl, /^total\s+for\s+legal/i, year) ||
    sumI(pl, /legal|accounting\s+fee/i, year),
  );
  const utilities = Math.abs(
    getYV(pl, /^total\s+for\s+utilities$/i, year) ||
    sumI(pl, /electricity|internet|utilities|water/i, year),
  );
  const repairs = Math.abs(sumI(pl, /repair|maintenance|cleaning/i, year));
  const totalAssets =
    getYV(bs, /^total\s+for\s+assets$/i, year) ||
    getYV(bs, /^total\s+assets$/i, year);
  const totalLiabilities =
    getYV(bs, /^total\s+for\s+liabilities$/i, year) ||
    getYV(bs, /^total\s+liabilities$/i, year) ||
    getYV(bs, /^total\s+for\s+long.term\s+liabilities$/i, year) + Math.abs(getYV(bs, /^total\s+for\s+current\s+liabilities$/i, year));
  const equity =
    getYV(bs, /^total\s+for\s+equity$/i, year) ||
    getYV(bs, /^total\s+equity$/i, year);
  const cash =
    getYV(bs, /^total\s+for\s+bank\s+accounts$/i, year) ||
    sumI(bs, /^bank\s+of\s+america|^great\s+plains|^prosperity|checking|savings/i, year);
  const buildings = Math.abs(
    getYV(bs, /^buildings$/i, year) ||
    getYV(bs, /^property\s*(and|&)?\s*equipment/i, year) ||
    getYV(bs, /^fixed\s*assets/i, year) ||
    getYV(bs, /^land\s*(and|&)?\s*buildings/i, year) ||
    getYV(bs, /^real\s+estate/i, year),
  );
  const accumDep = getYV(bs, /accumulated\s+dep/i, year);
  const longTermLoans = Math.abs(
    getYV(bs, /^total\s+for\s+long.term\s+liabilities$/i, year) ||
    sumI(bs, /^loan\s+from\s+gpb|^independent\s+bank|^loan\s+a\/c/i, year),
  );
  const securityDeposits = Math.abs(
    getYV(bs, /^total\s+for\s+security\s+deposit$/i, year) ||
    sumI(bs, /security\s+deposit/i, year),
  );
  return {
    totalRevenue, totalExpenses, netIncome, noi, rentalIncome, otherIncome, interestExpense,
    propertyTax, managementFee, hoaFees, legalFees, utilities, repairs,
    totalAssets, totalLiabilities, equity, cash, buildings, accumDep, longTermLoans, securityDeposits,
  };
}

export function calcKpisFromMonthlyKey(fin: ParsedFinancials, key: string): KpiData {
  const pl = fin.pl; const bs = fin.bs;
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
    totalRevenue: m.totalRevenue, totalExpenses: m.totalExpenses, netIncome: m.netIncome, noi: m.noi,
    rentalIncome: m.rentIncome, otherIncome: m.otherIncome, interestExpense: m.interest,
    propertyTax: m.propertyTax, managementFee: m.management, hoaFees: m.hoa, legalFees: m.legal,
    utilities: m.utilities, repairs: m.repairs,
    totalAssets, totalLiabilities, equity, cash, buildings, accumDep, longTermLoans, securityDeposits,
  };
}

function periodAggregateToKpiData(fin: ParsedFinancials, agg: PeriodAggregate, bsKey: string): KpiData {
  const bsK = calcKpisFromMonthlyKey(fin, bsKey);
  return {
    totalRevenue: agg.totalRevenue, totalExpenses: agg.totalExpenses, netIncome: agg.netIncome, noi: agg.noi,
    rentalIncome: agg.rentIncome, otherIncome: agg.otherIncome, interestExpense: agg.interest,
    propertyTax: agg.propertyTax, managementFee: agg.management, hoaFees: agg.hoa, legalFees: agg.legal,
    utilities: agg.utilities, repairs: agg.repairs,
    totalAssets: bsK.totalAssets, totalLiabilities: bsK.totalLiabilities, equity: bsK.equity,
    cash: bsK.cash, buildings: bsK.buildings, accumDep: bsK.accumDep,
    longTermLoans: bsK.longTermLoans, securityDeposits: bsK.securityDeposits,
  };
}

export function resolveKpiView(
  fin: ParsedFinancials,
  kpiYear: number,
  kpiMonth: number | null,
): { k: KpiData; kPrev: KpiData | null; label: string; compareLabel: string } {
  const availableKeys = getAvailableKeys(fin);
  const year = fin.years.includes(kpiYear) ? kpiYear : fin.years[fin.years.length - 1];

  if (kpiMonth && availableKeys.length > 0) {
    const key = `${_MNAMES[kpiMonth - 1]} ${kpiYear}`;
    const resolvedKey = availableKeys.includes(key) ? key : availableKeys[availableKeys.length - 1];
    const k = calcKpisFromMonthlyKey(fin, resolvedKey);
    const prevMonthKey = kpiMonth === 1 ? `${_MNAMES[11]} ${kpiYear - 1}` : `${_MNAMES[kpiMonth - 2]} ${kpiYear}`;
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
    return { k, kPrev, label: resolvedKey, compareLabel };
  }

  const k = calcKpis(fin, year);
  const prevY = fin.years.filter(y => y < year).pop() ?? null;
  const kPrev = prevY ? calcKpis(fin, prevY) : null;
  return { k, kPrev, label: `FY ${year}`, compareLabel: prevY ? `FY ${prevY}` : '' };
}

/** Resolve KPIs for MoM/YTD/TTM period window (Executive Summary export). */
export function resolveKpiViewForPeriod(
  fin: ParsedFinancials,
  period: Period | null,
  pMonth: number,
  pYear: number,
): { k: KpiData; kPrev: KpiData | null; label: string; compareLabel: string } {
  if (!period) return resolveKpiView(fin, pYear, pMonth);

  const keys = getPeriodKeys(period, pMonth, pYear);
  const available = getAvailableKeys(fin);
  const filtered = keys.filter(k => available.includes(k));
  if (!filtered.length) {
    const latest = latestAvailableKey(fin);
    if (latest) {
      const k = calcKpisFromMonthlyKey(fin, latest);
      const idx = available.indexOf(latest);
      const priorKey = idx > 0 ? available[idx - 1] : null;
      const kPrev = priorKey ? calcKpisFromMonthlyKey(fin, priorKey) : null;
      return { k, kPrev, label: latest, compareLabel: priorKey ?? '' };
    }
    return resolveKpiView(fin, pYear, pMonth);
  }

  // MoM: current month only — prior month is kPrev for comparison, not summed into k.
  if (period === 'MoM') {
    const currentKey = `${_MNAMES[pMonth - 1]} ${pYear}`;
    const key = available.includes(currentKey) ? currentKey : filtered[filtered.length - 1];
    const k = calcKpisFromMonthlyKey(fin, key);
    const priorKey = filtered.length >= 2 ? filtered[0] : null;
    const kPrev = priorKey && available.includes(priorKey)
      ? calcKpisFromMonthlyKey(fin, priorKey)
      : null;
    const compareLabel = priorKey && available.includes(priorKey) ? priorKey : '';
    return { k, kPrev, label: key, compareLabel };
  }

  const agg = sumKpisOverKeys(fin.pl, filtered);
  const bsKey = filtered[filtered.length - 1];
  const k = periodAggregateToKpiData(fin, agg, bsKey);

  let kPrev: KpiData | null = null;
  let compareLabel = '';
  if (period === 'YTD') {
    const prevYearKeys = filtered.map(k => {
      const [mon, yr] = k.split(' ');
      return `${mon} ${parseInt(yr, 10) - 1}`;
    });
    if (prevYearKeys.every(pk => available.includes(pk))) {
      const prevAgg = sumKpisOverKeys(fin.pl, prevYearKeys);
      kPrev = periodAggregateToKpiData(fin, prevAgg, prevYearKeys[prevYearKeys.length - 1]);
      compareLabel = `YTD ${pYear - 1}`;
    }
  } else {
    const prevTtmKeys = filtered.map(k => {
      const [mon, yr] = k.split(' ');
      const mi = _MNAMES.indexOf(mon);
      const y = parseInt(yr, 10);
      const prevMi = mi === 0 ? 11 : mi - 1;
      const prevY = mi === 0 ? y - 1 : y;
      return `${_MNAMES[prevMi]} ${prevY}`;
    });
    if (prevTtmKeys.every(pk => available.includes(pk))) {
      const prevAgg = sumKpisOverKeys(fin.pl, prevTtmKeys);
      kPrev = periodAggregateToKpiData(fin, prevAgg, prevTtmKeys[prevTtmKeys.length - 1]);
      compareLabel = 'Prior TTM';
    }
  }

  const periodLabel = period === 'YTD'
    ? `YTD Jan–${_MNAMES[pMonth - 1]} ${pYear}`
    : `TTM ending ${_MNAMES[pMonth - 1]} ${pYear}`;

  return { k, kPrev, label: periodLabel, compareLabel };
}

export function aggregateKpiDataList(items: KpiData[]): KpiData {
  const sum = (fn: (k: KpiData) => number) => items.reduce((s, k) => s + fn(k), 0);
  return {
    totalRevenue: sum(k => k.totalRevenue),
    totalExpenses: sum(k => k.totalExpenses),
    netIncome: sum(k => k.netIncome),
    noi: sum(k => k.noi),
    rentalIncome: sum(k => k.rentalIncome),
    otherIncome: sum(k => k.otherIncome),
    interestExpense: sum(k => k.interestExpense),
    propertyTax: sum(k => k.propertyTax),
    managementFee: sum(k => k.managementFee),
    hoaFees: sum(k => k.hoaFees),
    legalFees: sum(k => k.legalFees),
    utilities: sum(k => k.utilities),
    repairs: sum(k => k.repairs),
    totalAssets: sum(k => k.totalAssets),
    totalLiabilities: sum(k => k.totalLiabilities),
    equity: sum(k => k.equity),
    cash: sum(k => k.cash),
    buildings: sum(k => k.buildings),
    accumDep: sum(k => k.accumDep),
    longTermLoans: sum(k => k.longTermLoans),
    securityDeposits: sum(k => k.securityDeposits),
  };
}

/** Solvency metrics — same formulas as Financial Ratios / buildExportKpiSets. */
export function solvencyMetricsFromKpi(k: KpiData): { ltvPct: number | null; dscr: number | null } {
  const ltvPct = k.buildings > 0 ? (k.longTermLoans / k.buildings) * 100 : null;
  const dscr = k.interestExpense > 0 ? k.noi / (k.interestExpense * 1.2) : null;
  return { ltvPct, dscr };
}

export function formatSolvencyLtv(ltvPct: number | null): string {
  if (ltvPct === null) return 'No bldg value';
  return fmtKpiPct(ltvPct);
}

export function formatSolvencyDscr(dscr: number | null): string {
  if (dscr === null || dscr <= 0) return '—';
  return fmtKpiX(dscr);
}

// ── Formatting + status pills (matches KPI Dashboard / Benchmark Comparison) ──

const NA = 'Data not available';

export function fmtKpiCurrency(n: number): string {
  if (!Number.isFinite(n)) return NA;
  if (n === 0) return '$0';
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(2)}M`
    : abs >= 1_000 ? `$${(abs / 1_000).toFixed(1)}K`
      : `$${abs.toLocaleString()}`;
  return n < 0 ? `(${s})` : s;
}

export function fmtKpiPct(n: number, d = 1): string {
  return Number.isFinite(n) ? `${n.toFixed(d)}%` : NA;
}

export function fmtKpiX(n: number, d = 2): string {
  return Number.isFinite(n) ? `${n.toFixed(d)}x` : NA;
}

function pill(status: KpiStatus): string {
  if (status === 'good') return 'Healthy';
  if (status === 'warn') return 'Monitor';
  if (status === 'bad') return 'Review';
  return 'Info';
}

function pctVal(num: number, den: number): number | null {
  return den > 0 ? (num / den) * 100 : null;
}

/** Build all export KPI sets from resolved KpiData — same thresholds as KPITab. */
export function buildExportKpiSets(
  k: KpiData,
  kPrev: KpiData | null,
  ops?: { occupancyPct?: number; collectionRate?: number; vacancyRate?: number; avgDaysVacant?: number; totalUnits?: number },
): {
  profitability: ExportKpiItem[];
  balanceSheet: ExportKpiItem[];
  occupancy: ExportKpiItem[];
  pricing: ExportKpiItem[];
  returns: ExportKpiItem[];
} {
  const noiM = pctVal(k.noi, k.totalRevenue);
  const netM = pctVal(k.netIncome, k.totalRevenue);
  const expR = pctVal(k.totalExpenses, k.totalRevenue);
  const revG = kPrev && kPrev.totalRevenue > 0
    ? ((k.totalRevenue - kPrev.totalRevenue) / kPrev.totalRevenue) * 100
    : null;
  const rentP = pctVal(k.rentalIncome, k.totalRevenue);
  const iCov = k.interestExpense > 0 ? k.noi / k.interestExpense : null;
  const mgmtP = pctVal(k.managementFee, k.totalRevenue);
  const repP = pctVal(k.repairs, k.totalRevenue);
  const ltv = k.buildings > 0 ? (k.longTermLoans / k.buildings) * 100 : null;
  const alR = k.totalLiabilities > 0 ? k.totalAssets / k.totalLiabilities : null;
  const dte = k.equity !== 0 ? k.totalLiabilities / k.equity : null;
  const dta = k.totalAssets > 0 ? (k.totalLiabilities / k.totalAssets) * 100 : null;
  const equR = k.totalAssets > 0 ? (k.equity / k.totalAssets) * 100 : null;
  const netDebt = k.longTermLoans - k.cash;
  const dscr = k.interestExpense > 0 ? k.noi / (k.interestExpense * 1.2) : null;

  const item = (
    label: string, value: string, benchmark: string,
    status: KpiStatus,
  ): ExportKpiItem => ({ label, value, benchmark, status, statusLabel: pill(status) });

  const profitability: ExportKpiItem[] = [
    item('NOI Margin', noiM !== null ? fmtKpiPct(noiM) : NA, '>40%',
      noiM === null ? 'info' : noiM >= 40 ? 'good' : noiM >= 20 ? 'warn' : 'bad'),
    item('Net Income Margin', netM !== null ? fmtKpiPct(netM) : NA, '>10%',
      netM === null ? 'info' : netM >= 10 ? 'good' : netM >= 0 ? 'warn' : 'bad'),
    item('Revenue Growth YoY', revG !== null ? `${revG >= 0 ? '+' : ''}${revG.toFixed(1)}%` : NA, '>3%',
      revG === null ? 'info' : revG >= 3 ? 'good' : revG >= 0 ? 'warn' : 'bad'),
    item('Expense Ratio', expR !== null ? fmtKpiPct(expR) : NA, '<70%',
      expR === null ? 'info' : expR <= 70 ? 'good' : expR <= 85 ? 'warn' : 'bad'),
    item('Rental Income %', rentP !== null ? fmtKpiPct(rentP) : NA, '>80%',
      rentP === null ? 'info' : rentP >= 80 ? 'good' : 'info'),
    item('Interest Coverage', iCov !== null ? fmtKpiX(iCov) : NA, '>2.0x',
      iCov === null ? 'info' : iCov >= 2 ? 'good' : iCov >= 1.2 ? 'warn' : 'bad'),
    item('Mgmt Fee %', mgmtP !== null ? fmtKpiPct(mgmtP) : NA, '<10%',
      mgmtP === null ? 'info' : mgmtP <= 10 ? 'good' : mgmtP <= 15 ? 'warn' : 'bad'),
    item('Repair % of Revenue', repP !== null ? fmtKpiPct(repP) : NA, '<5%',
      repP === null ? 'info' : repP <= 5 ? 'good' : repP <= 10 ? 'warn' : 'bad'),
  ];

  const balanceSheet: ExportKpiItem[] = [
    item('LTV', ltv !== null ? fmtKpiPct(ltv) : NA, '<75%',
      ltv === null ? 'info' : ltv <= 75 ? 'good' : ltv <= 85 ? 'warn' : 'bad'),
    item('Asset / Liability Ratio', alR !== null ? fmtKpiX(alR) : NA, '>1.5x',
      alR === null ? 'info' : alR >= 1.5 ? 'good' : alR >= 1 ? 'warn' : 'bad'),
    item('Debt-to-Equity', dte !== null ? fmtKpiX(dte, 1) : NA, '<2.0x',
      dte === null ? 'info' : dte > 0 && dte <= 2 ? 'good' : dte <= 4 ? 'warn' : 'bad'),
    item('Cash Balance', fmtKpiCurrency(k.cash), '>$10K',
      k.cash > 10000 ? 'good' : k.cash > 0 ? 'warn' : 'bad'),
    item('Debt-to-Asset', dta !== null ? fmtKpiPct(dta) : NA, '<80%',
      dta === null ? 'info' : dta <= 70 ? 'good' : dta <= 85 ? 'warn' : 'bad'),
    item('Equity Ratio', equR !== null ? fmtKpiPct(equR) : NA, '>20%',
      equR === null ? 'info' : equR >= 20 ? 'good' : equR >= 10 ? 'warn' : 'bad'),
    item('Net Debt', fmtKpiCurrency(netDebt), 'Monitor', 'info'),
    item('DSCR (Est.)', dscr !== null ? fmtKpiX(dscr) : NA, '>1.25x',
      dscr === null ? 'info' : dscr >= 1.25 ? 'good' : dscr >= 1 ? 'warn' : 'bad'),
  ];

  const occ = ops?.occupancyPct;
  const coll = ops?.collectionRate;
  const vac = ops?.vacancyRate ?? (occ !== undefined ? 100 - occ : undefined);
  const units = ops?.totalUnits ?? 0;
  const revPerUnit = units > 0 && k.totalRevenue > 0 ? k.totalRevenue / units : null;
  const expPerUnit = units > 0 && k.totalExpenses > 0 ? k.totalExpenses / units : null;

  const occupancy: ExportKpiItem[] = [
    item('Occupancy Rate', occ !== undefined ? fmtKpiPct(occ) : NA, '>95%',
      occ === undefined ? 'info' : occ >= 95 ? 'good' : occ >= 85 ? 'warn' : 'bad'),
    item('Economic Occupancy', coll !== undefined ? fmtKpiPct(coll) : NA, '>95%',
      coll === undefined ? 'info' : coll >= 95 ? 'good' : coll >= 80 ? 'warn' : 'bad'),
    item('Rent Collection Rate', coll !== undefined ? fmtKpiPct(coll) : NA, '>95%',
      coll === undefined ? 'info' : coll >= 95 ? 'good' : coll >= 80 ? 'warn' : 'bad'),
    item('Vacancy Rate', vac !== undefined ? fmtKpiPct(vac) : NA, '<5%',
      vac === undefined ? 'info' : vac <= 5 ? 'good' : vac <= 15 ? 'warn' : 'bad'),
    item('Loss to Lease', NA, 'Monitor', 'info'),
    item('Avg Days Vacant', ops?.avgDaysVacant !== undefined ? `${Math.round(ops.avgDaysVacant)} days` : NA, '<30 days',
      ops?.avgDaysVacant === undefined ? 'info' : ops.avgDaysVacant <= 30 ? 'good' : ops.avgDaysVacant <= 60 ? 'warn' : 'bad'),
  ];

  const capRate = k.buildings > 0 ? (k.noi / k.buildings) * 100 : null;
  const pricing: ExportKpiItem[] = [
    item('Rent per Sq Ft', NA, 'Market', 'info'),
    item('Revenue per Unit', revPerUnit !== null ? fmtKpiCurrency(revPerUnit) : NA, 'Trend', 'info'),
    item('Expense per Unit', expPerUnit !== null ? fmtKpiCurrency(expPerUnit) : NA, 'Trend', 'info'),
    item('Cap Rate', capRate !== null ? fmtKpiPct(capRate) : NA, '>5%', capRate === null ? 'info' : capRate >= 5 ? 'good' : 'warn'),
    item('Price / Rent Ratio', NA, '<14x', 'info'),
    item('EGIM', NA, '<14x', 'info'),
  ];

  const returns: ExportKpiItem[] = [
    item('WACC', NA, 'Benchmark', 'info'),
    item('Cost of Debt', NA, 'Market', 'info'),
    item('Cost of Equity', NA, 'Market', 'info'),
    item('Return vs WACC', NA, 'Positive', 'info'),
    item('Economic Value Added', NA, 'Positive', 'info'),
    item('Spread (Cap−WACC)', NA, 'Positive', 'info'),
  ];

  return { profitability, balanceSheet, occupancy, pricing, returns };
}
