import { debtRatiosFromLoanTracker, ebitdaMarginPct } from './rentalKpiEngine';

export type RatioStatus = 'good' | 'watch' | 'critical' | 'monitor' | 'info';

export interface FinItem {
  label: string;
  values: Record<number, number>;
  /** "Jan 2026" → amount when statement was uploaded with monthly columns */
  monthlyValues?: Record<string, number>;
  indent: number;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
}

export interface LiveFin {
  company_name: string;
  filename: string;
  date_range: string;
  years: number[];
  periods?: string[];
  pl: FinItem[];
  bs: FinItem[];
  cf: FinItem[];
  uploaded_at: string;
}

export interface RatioCard {
  name: string;
  formula: string;
  value: string;
  benchmark: string;
  status: RatioStatus;
  statusLabel: string;
  note?: string;
  spark?: number[];
}

function fmtPct(n: number, dec = 1) { return `${n.toFixed(dec)}%`; }
function fmtX(n: number, dec = 2) { return `${n.toFixed(dec)}x`; }
function fmtDollar(n: number) {
  const a = Math.abs(n);
  const s = a >= 1_000_000 ? `$${(a / 1_000_000).toFixed(2)}M` : a >= 1_000 ? `$${(a / 1_000).toFixed(0)}K` : `$${a.toFixed(0)}`;
  return n < 0 ? `(${s})` : s;
}

function sumMonthly(items: FinItem[], pat: RegExp, keys: string[]): number {
  return items
    .filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label))
    .reduce((total, i) => {
      if (!i.monthlyValues) return total;
      return total + keys.reduce((s, k) => s + (i.monthlyValues![k] ?? 0), 0);
    }, 0);
}

function yvMonthly(items: FinItem[], pat: RegExp, key: string): number {
  return items.find(i => pat.test(i.label))?.monthlyValues?.[key] ?? 0;
}

/**
 * @param periodKeys When set (Month / YTD / TTM month keys), P&L/CF are summed over those months
 * and Balance Sheet uses the last key (point-in-time). Otherwise annual year columns are used.
 */
export function calcAllRatios(
  fin: LiveFin,
  activeYear?: number,
  totalDebt?: number | null,
  periodKeys?: string[],
): { profitability: RatioCard[]; liquidity: RatioCard[]; solvency: RatioCard[] } {
  const pl = fin.pl;
  const bs = fin.bs;
  const cf = fin.cf;
  const lastY = activeYear && fin.years.includes(activeYear) ? activeYear : fin.years[fin.years.length - 1];
  const useMonthly = Boolean(periodKeys?.length);
  const endKey = useMonthly ? periodKeys![periodKeys!.length - 1] : '';

  const yv = (items: FinItem[], pat: RegExp, y: number) =>
    items.find(i => pat.test(i.label))?.values[y] ?? 0;
  const si = (items: FinItem[], pat: RegExp, y: number) =>
    items.filter(i => !i.isSectionHeader && !i.isTotal && pat.test(i.label)).reduce((s, i) => s + (i.values[y] ?? 0), 0);

  const stock = (pat: RegExp, alt?: RegExp) => {
    if (useMonthly) {
      const v = yvMonthly(bs, pat, endKey) || (alt ? yvMonthly(bs, alt, endKey) : 0);
      if (v) return v;
      return sumMonthly(bs, pat, [endKey]) || (alt ? sumMonthly(bs, alt, [endKey]) : 0);
    }
    return yv(bs, pat, lastY) || (alt ? yv(bs, alt, lastY) : 0);
  };

  const rev = useMonthly
    ? (Math.abs(sumMonthly(pl, /^total\s+(for\s+)?income$/i, periodKeys!))
      || Math.abs(sumMonthly(pl, /^gross\s+profit$/i, periodKeys!))
      || sumMonthly(pl, /income|revenue|rent|sales/i, periodKeys!))
    : (yv(pl, /^total\s+(for\s+)?income$/i, lastY) || yv(pl, /^gross\s+profit$/i, lastY) || si(pl, /income|revenue|rent|sales/i, lastY));
  const exp = useMonthly
    ? Math.abs(sumMonthly(pl, /^total\s+(for\s+)?expenses?$/i, periodKeys!) || sumMonthly(pl, /^total\s+expenses/i, periodKeys!))
    : (yv(pl, /^total\s+(for\s+)?expenses?$/i, lastY) || Math.abs(si(pl, /^total\s+expenses/i, lastY)));
  const ni = useMonthly
    ? sumMonthly(pl, /^net\s+income$/i, periodKeys!)
    : yv(pl, /^net\s+income$/i, lastY);
  const intEx = Math.abs(
    useMonthly
      ? (sumMonthly(pl, /^total\s+for\s+interest\s+paid$/i, periodKeys!) || sumMonthly(pl, /interest/i, periodKeys!))
      : (yv(pl, /^total\s+for\s+interest\s+paid$/i, lastY) || si(pl, /interest/i, lastY)),
  );
  const depAm = Math.abs(useMonthly ? sumMonthly(pl, /depreciation|amortization/i, periodKeys!) : si(pl, /depreciation|amortization/i, lastY));
  // Prefer Financials "Net Operating Income" line; fall back to derived
  const noiItem = pl.find(i => /^net\s+operating\s+income$/i.test(i.label));
  const noi = (() => {
    if (useMonthly && noiItem) {
      return sumMonthly(pl, /^net\s+operating\s+income$/i, periodKeys!);
    }
    if (noiItem && Object.prototype.hasOwnProperty.call(noiItem.values, lastY)) {
      return noiItem.values[lastY] ?? 0;
    }
    return rev - exp + intEx;
  })();

  const totalAssets = stock(/^total\s+(for\s+)?assets$/i);
  const totalLiab = stock(/^total\s+(for\s+)?liabilities$/i, /^total\s+for\s+liabilities\s+and\s+equity$/i)
    || (useMonthly ? 0 : yv(bs, /^total\s+for\s+liabilities\s+and\s+equity$/i, lastY));
  const equity = stock(/^total\s+(for\s+)?equity$/i);
  const cash = stock(/^total\s+(for\s+)?bank/i)
    || (useMonthly ? sumMonthly(bs, /^bank|checking|savings|prosperity/i, [endKey]) : si(bs, /^bank|checking|savings|prosperity/i, lastY));
  const currAssets = stock(/^total\s+for\s+current\s+assets$/i, /^total\s+current\s+assets$/i)
    || (cash + Math.abs(useMonthly ? sumMonthly(bs, /receivable/i, [endKey]) : si(bs, /receivable/i, lastY)));
  const currLiab = stock(/^total\s+for\s+current\s+liabilities$/i, /^total\s+current\s+liabilities$/i)
    || Math.abs(useMonthly ? sumMonthly(bs, /payable/i, [endKey]) : si(bs, /payable/i, lastY));
  const buildings = Math.abs(
    stock(/^buildings$/i)
    || stock(/^property\s*(and|&)?\s*equipment/i)
    || stock(/^fixed\s*assets/i)
    || stock(/^land\s*(and|&)?\s*buildings/i)
    || stock(/^wwbl\s*\(land\)/i)
    || stock(/^real\s+estate/i)
    || (useMonthly ? 0 : (
      yv(bs, /^buildings$/i, lastY) ||
      yv(bs, /^property\s*(and|&)?\s*equipment/i, lastY) ||
      yv(bs, /^fixed\s*assets/i, lastY) ||
      yv(bs, /^land\s*(and|&)?\s*buildings/i, lastY) ||
      yv(bs, /^wwbl\s*\(land\)/i, lastY) ||
      yv(bs, /^real\s+estate/i, lastY)
    )),
  );
  const loans = Math.abs(
    stock(/^total\s+for\s+long.term\s+liabilities$/i)
    || (useMonthly
      ? sumMonthly(bs, /long.term.*loan|loan\s+from|independent\s+bank|business\s+loan/i, [endKey])
      : (yv(bs, /^total\s+for\s+long.term\s+liabilities$/i, lastY) || si(bs, /long.term.*loan|loan\s+from|independent\s+bank|business\s+loan/i, lastY))),
  );
  const ocf = useMonthly
    ? (sumMonthly(cf, /^net\s+cash.*operating/i, periodKeys!) || sumMonthly(cf, /^net\s+income$/i, periodKeys!))
    : (yv(cf, /^net\s+cash.*operating/i, lastY) || yv(cf, /^net\s+income$/i, lastY));

  const spark = (fn: (y: number) => number) => fin.years.slice(-4).map(fn);

  const kLike = {
    noi, totalRevenue: rev, netIncome: ni, totalExpenses: exp, interestExpense: intEx,
    equity, totalAssets, totalLiabilities: totalLiab, rentalIncome: 0, managementFee: 0,
    repairs: 0, cash, buildings, longTermLoans: loans, depreciation: depAm,
    securityDeposits: 0, legalFees: 0, utilities: 0, hoa: 0, propertyTax: 0,
    insurance: 0, accumDep: 0, otherOpex: 0,
  };
  const noiM = rev > 0 ? noi / rev * 100 : 0;
  const netM = rev > 0 ? ni / rev * 100 : 0;
  const expR = rev > 0 ? exp / rev * 100 : 0;
  const ebitdaM = ebitdaMarginPct(kLike) ?? 0;
  const roa = totalAssets > 0 ? ni / totalAssets * 100 : 0;
  const roe = equity > 0 ? ni / equity * 100 : 0;
  const grm = rev > 0 ? (totalAssets > 0 ? totalAssets / rev : 0) : 0;

  const currR = currLiab > 0 ? currAssets / currLiab : 0;
  const cashR = currLiab > 0 ? cash / currLiab : 0;
  const ocfR = currLiab > 0 ? Math.abs(ocf) / currLiab : 0;
  const wc = currAssets - currLiab;
  const daysOp = exp > 0 ? (cash / (exp / 365)) : 0;

  const { debtToEquity: dte, debtToAsset: dta } = debtRatiosFromLoanTracker(totalDebt ?? null, kLike);
  const equR = totalAssets > 0 ? equity / totalAssets * 100 : 0;
  const iCov = intEx > 0 ? noi / intEx : 0;
  const ltv = buildings > 0 ? loans / buildings * 100 : 0;
  const netDebt = loans - cash;
  const dscr = (intEx > 0 || loans > 0) ? noi / (intEx * 1.2) : 0;

  const pill = (good: boolean, watch: boolean): { status: RatioCard['status']; label: string } => ({
    status: good ? 'good' : watch ? 'watch' : 'critical',
    label: good ? '✓ Good' : watch ? '⚠ Watch' : '✗ Review',
  });

  const profitability: RatioCard[] = [
    { name: 'NOI Margin', formula: 'NOI / Revenue', value: noiM ? fmtPct(noiM) : '—', benchmark: '>35%', ...pill(noiM >= 35, noiM >= 20), spark: spark(y => { const r = yv(pl, /^total\s+(for\s+)?income$/i, y) || si(pl, /income|revenue|rent|sales/i, y); const e = yv(pl, /^total\s+(for\s+)?expenses?$/i, y); const ie = Math.abs(si(pl, /interest/i, y)); const n = r - e + ie; return r > 0 ? n / r * 100 : 0; }) },
    { name: 'Net Profit Margin', formula: 'Net Income / Revenue', value: rev > 0 ? fmtPct(netM) : '—', benchmark: '>10%', ...pill(netM >= 10, netM >= 0) },
    { name: 'Operating Expense Ratio', formula: 'Total OpEx / Revenue', value: rev > 0 ? fmtPct(expR) : '—', benchmark: '<60%', ...pill(expR <= 60, expR <= 85) },
    { name: 'EBITDA Margin', formula: 'NOI / Revenue (EBITDA ≡ NOI)', value: rev > 0 ? fmtPct(ebitdaM) : '—', benchmark: '>45%', ...pill(ebitdaM >= 45, ebitdaM >= 30) },
    { name: 'Return on Assets', formula: 'Net Income / Total Assets', value: totalAssets > 0 ? fmtPct(roa) : '—', benchmark: '>4%', ...pill(roa >= 4, roa >= 2) },
    { name: 'Return on Equity', formula: 'Net Income / Equity', value: equity > 0 ? fmtPct(roe) : '—', benchmark: '>8%', ...pill(roe >= 8, roe >= 4) },
    { name: 'Revenue', formula: 'Total Income', value: fmtDollar(rev), benchmark: 'Trend', status: 'info', statusLabel: 'ℹ Info', spark: spark(y => yv(pl, /^total\s+(for\s+)?income$/i, y) || si(pl, /income|revenue|rent|sales/i, y)) },
    { name: 'Net Income', formula: 'Revenue − Expenses', value: fmtDollar(ni), benchmark: 'Positive', ...pill(ni > 0, ni > -5000) },
    { name: 'Gross Rent Multiple', formula: 'Asset Value / Ann. Revenue', value: grm > 0 ? fmtX(grm, 1) : '—', benchmark: '<14x', ...pill(grm > 0 && grm < 14, grm < 18) },
  ];

  const liquidity: RatioCard[] = [
    { name: 'Current Ratio', formula: 'Current Assets / CL', value: currR > 0 ? fmtX(currR) : '—', benchmark: '>1.5x', ...pill(currR >= 1.5, currR >= 1.0), spark: spark(y => { const ca = yv(bs, /^total\s+for\s+current\s+assets/i, y) || yv(bs, /^total\s+current\s+assets/i, y); const cl = yv(bs, /^total\s+for\s+current\s+liab/i, y) || yv(bs, /^total\s+current\s+liab/i, y); return cl > 0 ? ca / cl : 0; }) },
    { name: 'Cash Ratio', formula: 'Cash / Current Liabilities', value: cashR > 0 ? fmtX(cashR) : '—', benchmark: '>0.2x', ...pill(cashR >= 0.2, cashR >= 0.1) },
    { name: 'Operating CF Ratio', formula: 'OCF / Current Liabilities', value: ocfR > 0 ? fmtX(ocfR) : '—', benchmark: '>1.0x', ...pill(ocfR >= 1.0, ocfR >= 0.5) },
    { name: 'Working Capital', formula: 'Current Assets − CL', value: fmtDollar(wc), benchmark: 'Positive', ...pill(wc > 0, wc > -10000), spark: spark(y => { const ca = yv(bs, /^total\s+for\s+current\s+assets/i, y) || yv(bs, /^total\s+current\s+assets/i, y); const cl = yv(bs, /^total\s+for\s+current\s+liab/i, y) || yv(bs, /^total\s+current\s+liab/i, y); return ca - cl; }) },
    { name: 'Cash & Bank Balance', formula: 'Total Bank Accounts', value: fmtDollar(cash), benchmark: 'Positive', ...pill(cash > 50000, cash > 10000), spark: spark(y => yv(bs, /^total\s+(for\s+)?bank/i, y) || si(bs, /^bank|checking|savings|prosperity/i, y)) },
    { name: 'Days Cash on Hand', formula: 'Cash / Daily OpEx', value: daysOp > 0 ? `${daysOp.toFixed(0)} days` : '—', benchmark: '>60 days', ...pill(daysOp >= 60, daysOp >= 30) },
  ];

  const solvency: RatioCard[] = [
    { name: 'Debt-to-Equity', formula: 'Total for Liabilities / Equity', value: dte != null ? fmtX(dte, 1) : '— no BS liabilities', benchmark: '<5x', ...pill(dte != null && dte <= 3, dte != null && dte <= 6) },
    { name: 'Debt-to-Asset', formula: 'Total for Liabilities / Total Assets', value: dta != null ? fmtPct(dta) : '— no BS liabilities', benchmark: '<80%', ...pill(dta != null && dta <= 70, dta != null && dta <= 85) },
    { name: 'Equity Ratio', formula: 'Equity / Total Assets', value: totalAssets > 0 ? fmtPct(equR) : '—', benchmark: '>20%', ...pill(equR >= 20, equR >= 10) },
    { name: 'Interest Coverage', formula: 'NOI / Interest Expense', value: intEx > 0 ? fmtX(iCov) : '—', benchmark: '>1.5x', ...pill(iCov >= 1.5, iCov >= 1.0), spark: spark(y => { const r = yv(pl, /^total\s+(for\s+)?income$/i, y) || si(pl, /income|revenue|rent|sales/i, y); const e = yv(pl, /^total\s+(for\s+)?expenses?$/i, y); const ie = Math.abs(si(pl, /interest/i, y)); return ie > 0 ? (r - e + ie) / ie : 0; }) },
    { name: 'LTV', formula: 'Mortgage / Property Value', value: buildings > 0 ? fmtPct(ltv) : 'No asset value', benchmark: '<80%', ...pill(ltv <= 70, ltv <= 85), spark: spark(y => { const b = Math.abs(yv(bs, /^buildings$/i, y) || yv(bs, /^property\s*(and|&)?\s*equipment/i, y) || yv(bs, /^fixed\s*assets/i, y) || yv(bs, /^land\s*(and|&)?\s*buildings/i, y) || yv(bs, /^wwbl\s*\(land\)/i, y) || yv(bs, /^real\s+estate/i, y)); const l = Math.abs(yv(bs, /^total\s+for\s+long.term/i, y) || si(bs, /long.term.*loan|loan\s+from|independent\s+bank|business\s+loan/i, y)); return b > 0 ? l / b * 100 : 0; }) },
    { name: 'Net Debt', formula: 'Long-term Loans − Cash', value: fmtDollar(netDebt), benchmark: 'Monitor', status: 'info', statusLabel: 'ℹ Info' },
    { name: 'DSCR (Est.)', formula: 'NOI / (Interest × 1.2)', value: dscr > 0 ? fmtX(dscr) : '—', benchmark: '>1.25x', ...pill(dscr >= 1.25, dscr >= 1.0) },
    { name: 'Total Assets', formula: 'Balance Sheet Total', value: fmtDollar(totalAssets), benchmark: 'Trend', status: 'info', statusLabel: 'ℹ Info' },
    { name: 'Equity', formula: "Owner's Net Worth", value: fmtDollar(equity), benchmark: 'Positive', ...pill(equity > 0, equity > -10000) },
  ];

  return { profitability, liquidity, solvency };
}
