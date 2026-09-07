import type { CompanyData, Loan } from '../contexts/PropertyDevContext';

/** Active loan — includes legacy 'Current' status from Excel imports. */
export function isActivePropDevLoan(l: Loan): boolean {
  const s = l.status as string;
  return s === 'Active' || s === 'Current';
}

/** DB may store 0.076 or 7.6 depending on import path — always return display percent. */
export function normalizeInterestRatePercent(rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate)) return 0;
  return rate <= 1 ? rate * 100 : rate;
}

/** Dedupe loans by id (portfolio aggregation). */
export function dedupePropDevLoans(loans: Loan[]): Loan[] {
  const seen = new Set<string>();
  return loans.filter(l => {
    if (!l.id || seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
}

/**
 * Single source of truth for portfolio loan rows — nested company.loans first,
 * then context flat list (same records, different timing after API refresh).
 */
export function resolveAllPropDevLoans(companies: CompanyData[], contextLoans: Loan[] = []): Loan[] {
  const nested = dedupePropDevLoans(companies.flatMap(c => c.loans ?? []));
  if (nested.length > 0) return nested;
  return dedupePropDevLoans(contextLoans);
}

/** Sum of active-loan outstanding balances — Loan Tracker source of truth for Outstanding Debt. */
export function sumActivePropDevLoanBalances(loans: Loan[]): number {
  return loans
    .filter(isActivePropDevLoan)
    .reduce((s, l) => s + (l.balance ?? 0), 0);
}

/** Portfolio LTLV = total outstanding ÷ land value (same formula as CFO Total Debt ÷ Land). */
export function portfolioLtlvPercent(outstandingDebt: number, landValue: number | null | undefined): number | null {
  if (!landValue || landValue <= 0 || !Number.isFinite(outstandingDebt)) return null;
  const pct = (outstandingDebt / landValue) * 100;
  return Number.isFinite(pct) ? pct : null;
}

/** Sum of active-loan monthly EMI — single source of truth for portfolio tables. */
export function sumActiveMonthlyEmi(loans: Loan[]): number {
  return loans
    .filter(isActivePropDevLoan)
    .reduce((s, l) => s + (l.emi ?? 0), 0);
}

/** Resolve monthly EMI for a company; falls back to flat loan list if nested loans are empty. */
export function resolveCompanyMonthlyEmi(company: CompanyData, allLoans: Loan[] = []): number {
  const nested = sumActiveMonthlyEmi(company.loans);
  if (nested > 0) return nested;
  return sumActiveMonthlyEmi(allLoans.filter(l => l.companyId === company.id));
}

export type CashEmiStatusKind = 'no_data' | 'no_debt' | 'critical' | 'warning' | 'monitor' | 'safe';

export interface CashEmiStatus {
  ratio: number | null;
  months: number | null;
  kind: CashEmiStatusKind;
  label: string;
  badgeClass: string;
}

/** Cash/EMI ratio with explicit handling for missing inputs vs genuine zero debt. */
export function cashEmiStatus(cash: number, monthlyEmi: number): CashEmiStatus {
  const cashUnset = cash <= 0;
  const emiUnset = monthlyEmi <= 0;

  if (cashUnset && emiUnset) {
    return {
      ratio: null,
      months: null,
      kind: 'no_data',
      label: '⚪ No data entered',
      badgeClass: 'bg-gray-100 text-gray-600',
    };
  }
  if (emiUnset) {
    return {
      ratio: null,
      months: null,
      kind: 'no_debt',
      label: 'N/A — no debt',
      badgeClass: 'bg-gray-100 text-gray-600',
    };
  }

  const ratio = cash / monthlyEmi;
  const months = ratio;

  if (ratio < 1) {
    return { ratio, months, kind: 'critical', label: '🔴 Critical', badgeClass: 'bg-red-100 text-red-700' };
  }
  if (ratio <= 3) {
    return { ratio, months, kind: 'warning', label: '🟠 Warning', badgeClass: 'bg-orange-100 text-orange-700' };
  }
  if (ratio <= 6) {
    return { ratio, months, kind: 'monitor', label: '🟡 Monitor', badgeClass: 'bg-amber-100 text-amber-700' };
  }
  return { ratio, months, kind: 'safe', label: '🟢 Safe', badgeClass: 'bg-green-100 text-green-700' };
}

export function formatCoverageRatio(ratio: number | null): string {
  if (ratio == null) return 'N/A';
  if (ratio > 50) return '∞';
  return `${ratio.toFixed(1)}x`;
}

export type CoverageStatusLabel = 'Healthy' | 'Monitor' | 'Review' | 'N/A';

export function capitalCallCoverageStatus(ratio: number | null): CoverageStatusLabel {
  if (ratio == null) return 'N/A';
  if (ratio > 2) return 'Healthy';
  if (ratio >= 1) return 'Monitor';
  return 'Review';
}

export function coverageStatusColors(status: CoverageStatusLabel): { text: string; badge: string } {
  switch (status) {
    case 'Healthy': return { text: 'text-green-700', badge: 'bg-green-100 text-green-800' };
    case 'Monitor': return { text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800' };
    case 'Review':  return { text: 'text-red-700', badge: 'bg-red-100 text-red-800' };
    default:        return { text: 'text-gray-600', badge: 'bg-gray-100 text-gray-600' };
  }
}

export interface UncalledCapitalResult {
  uncalled: number | null;
  /** True when neither committed capital nor capital-call dues are available. */
  dataGap: boolean;
  /** Where uncalled came from when computed. */
  source?: 'committed' | 'capital-calls';
}

/**
 * Open capital-call amounts still due (totalDue − received) for Partial / Outstanding / Overdue.
 * Used when partner committedCapital is not tracked — still gives a real Uncalled / Coverage number.
 */
export function outstandingCapitalCallDues(company: CompanyData): number | null {
  const calls = company.capitalCalls ?? [];
  if (!calls.length) return null;

  let outstanding = 0;
  let hasOpen = false;
  let hasAnyCall = false;

  for (const c of calls) {
    hasAnyCall = true;
    const due = Math.max(0, (c.totalDue ?? c.partnerShare ?? 0) - (c.received ?? 0));
    if (c.status === 'Paid' && due <= 0) continue;
    if (due > 0 || c.status === 'Outstanding' || c.status === 'Overdue' || c.status === 'Partial') {
      hasOpen = true;
      outstanding += due;
    }
  }

  if (hasOpen) return outstanding;
  // All calls paid / settled — treat as $0 uncalled (not a data gap).
  if (hasAnyCall) return 0;
  return null;
}

/** Uncalled partner capital = committed − contributed; else open capital-call dues. */
export function computeUncalledCapital(company: CompanyData): UncalledCapitalResult {
  if (company.partners.length === 0 && !(company.capitalCalls?.length)) {
    return { uncalled: null, dataGap: true };
  }

  let hasCommitted = false;
  let totalUncalled = 0;

  for (const p of company.partners) {
    const committed = p.committedCapital;
    if (committed != null && committed > 0) {
      hasCommitted = true;
      const called = p.capitalContributed ?? 0;
      totalUncalled += Math.max(0, committed - called);
    }
  }

  if (hasCommitted) {
    return { uncalled: totalUncalled, dataGap: false, source: 'committed' };
  }

  const fromCalls = outstandingCapitalCallDues(company);
  if (fromCalls != null) {
    return { uncalled: fromCalls, dataGap: false, source: 'capital-calls' };
  }

  return { uncalled: null, dataGap: true };
}

export function upcomingEmiObligations(
  company: CompanyData,
  windowMonths: number,
  allLoans: Loan[] = [],
): number {
  return resolveCompanyMonthlyEmi(company, allLoans) * windowMonths;
}

export interface CapitalCallCoverageResult {
  ratio: number | null;
  uncalled: number | null;
  obligations: number;
  dataGap: boolean;
  status: CoverageStatusLabel;
  source?: 'committed' | 'capital-calls';
}

export function computeCapitalCallCoverage(
  company: CompanyData,
  windowMonths = 3,
  allLoans: Loan[] = [],
): CapitalCallCoverageResult {
  const { uncalled, dataGap, source } = computeUncalledCapital(company);
  const obligations = upcomingEmiObligations(company, windowMonths, allLoans);

  if (dataGap || uncalled == null) {
    return { ratio: null, uncalled: null, obligations, dataGap: true, status: 'N/A' };
  }
  if (obligations <= 0) {
    return { ratio: null, uncalled, obligations: 0, dataGap: false, status: 'N/A', source };
  }

  const ratio = uncalled / obligations;
  return {
    ratio,
    uncalled,
    obligations,
    dataGap: false,
    status: capitalCallCoverageStatus(ratio),
    source,
  };
}

export function computePortfolioCapitalCallCoverage(
  companies: CompanyData[],
  windowMonths = 3,
  allLoans: Loan[] = [],
): CapitalCallCoverageResult {
  let totalUncalled = 0;
  let hasUncalledData = false;
  let usedCapitalCalls = false;
  let totalObligations = 0;

  for (const c of companies) {
    const { uncalled, dataGap, source } = computeUncalledCapital(c);
    if (!dataGap && uncalled != null) {
      hasUncalledData = true;
      totalUncalled += uncalled;
      if (source === 'capital-calls') usedCapitalCalls = true;
    }
    totalObligations += upcomingEmiObligations(c, windowMonths, allLoans);
  }

  if (!hasUncalledData) {
    return {
      ratio: null,
      uncalled: null,
      obligations: totalObligations,
      dataGap: true,
      status: 'N/A',
    };
  }
  if (totalObligations <= 0) {
    return {
      ratio: null,
      uncalled: totalUncalled,
      obligations: 0,
      dataGap: false,
      status: 'N/A',
      source: usedCapitalCalls ? 'capital-calls' : 'committed',
    };
  }

  const ratio = totalUncalled / totalObligations;
  return {
    ratio,
    uncalled: totalUncalled,
    obligations: totalObligations,
    dataGap: false,
    status: capitalCallCoverageStatus(ratio),
    source: usedCapitalCalls ? 'capital-calls' : 'committed',
  };
}

/** Land value from balance sheet (preferred) or property land cost. */
export function resolveLandValue(company: CompanyData): number | null {
  const bs = company.property.yearlyBS;
  if (bs) {
    const years = Object.keys(bs).sort().reverse();
    for (const y of years) {
      const land = bs[y]?.land;
      if (land != null && land > 0) return land;
    }
  }
  const landCost = company.property.landCost;
  return landCost > 0 ? landCost : null;
}

/** Loan-to-Land-Value for development entities. */
export function computeLtlv(loan: Loan, company: CompanyData): number | null {
  const land = resolveLandValue(company);
  if (!land || land <= 0) return null;
  return (loan.balance / land) * 100;
}

export function formatLtlv(loan: Loan, company: CompanyData): string {
  const ltlv = computeLtlv(loan, company);
  return ltlv != null ? `${ltlv.toFixed(1)}%` : '—';
}

/** Start of local calendar day (ignores time-of-day / timezone quirks on date-only strings). */
function startOfLocalDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseMaturityLocal(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : startOfLocalDay(d);
}

/** Earliest maturity on or after today — never surfaces already-passed dates as "Next". */
export function pickNextUpcomingMaturity<T extends { maturityDate?: string | null }>(
  loans: T[],
  asOf: Date = new Date(),
): T | undefined {
  const today = startOfLocalDay(asOf).getTime();
  const upcoming = loans
    .filter(l => l.maturityDate)
    .map(l => ({ loan: l, t: parseMaturityLocal(l.maturityDate!)?.getTime() ?? NaN }))
    .filter(x => Number.isFinite(x.t) && x.t >= today)
    .sort((a, b) => a.t - b.t);
  return upcoming[0]?.loan;
}
