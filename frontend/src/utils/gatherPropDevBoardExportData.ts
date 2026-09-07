/**
 * Gathers the data needed for the Property Dev "Export PDF" board pack, straight from
 * state the CFO Dashboard tab already has in memory (no re-fetch) — mirrors Rentals'
 * gatherCeoBoardExportPayload but scoped to what Property Dev actually tracks.
 */
import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import {
  buildPropDevBsSnapshots, buildPropDevCfSnapshots, buildPropDevCfoInsights,
  computeCashRunwayHero, getPropDevAvailableKeys,
  type PDFinancialsLike, type PropDevBsSnapshot, type PropDevCfSnapshot, type PropDevCfoInsight,
} from './propDevCfoTrendData';
import {
  buildPropDevYearSnapshots, pickFocusSnapshot, resolvePropDevFocusYear,
  type PropDevYearSnapshot,
} from './propDevPeriodKpis';
import { scopePropDevFinToPeriod } from './propDevPeriodScope';
import { canonicalExpenseLineLabel } from './finItemYearUtils';
import { getPropDevRevenueForYear } from './propDevRevenueBreakdown';
import type { YearSnapshotPeriodAnchor } from './cfoMultiYearTrendData';
import {
  computeCapitalCallCoverage, normalizeInterestRatePercent, isActivePropDevLoan,
  resolveCompanyMonthlyEmi, resolveLandValue, sumActivePropDevLoanBalances,
  type CapitalCallCoverageResult,
} from './propDevLoanMetrics';

export { pickFocusSnapshot, resolvePropDevFocusYear };

export interface PropDevLoanRow {
  bank: string;
  amount: number;
  rate: number;
  emi: number;
  balance: number;
  maturityDate: string;
  status: Loan['status'];
}

export interface PropDevOverdueCapitalCall {
  partnerName: string;
  period: string;
  amountDue: number;
  dueDate?: string;
}

export interface PropDevBoardExportPayload {
  entityLabel: string;
  periodLabel: string;
  generatedAt: string;
  years: number[];
  /** Year used for hero KPIs / breakdowns — matches screen period or selected year. */
  focusYear: number | null;
  plSnapshots: PropDevYearSnapshot[];
  bsSnapshots: PropDevBsSnapshot[];
  cfSnapshots: PropDevCfSnapshot[];
  insights: PropDevCfoInsight[];
  cashRunway: ReturnType<typeof computeCashRunwayHero>;
  capitalCallCoverage: CapitalCallCoverageResult | null;
  landValue: number | null;
  totalDebt: number;
  totalMonthlyEmi: number;
  loanRows: PropDevLoanRow[];
  overdueCapitalCalls: PropDevOverdueCapitalCall[];
  latestExpenseCategories: Record<string, number>;
  latestRevenueCategories: Record<string, number>;
  /**
   * Statements with the active Month/YTD window written into values[year].
   * YoY Detail and summary cards must both read from this (not the raw upload).
   */
  scopedFin: PDFinancialsLike;
}

export function buildPropDevBoardExportPayload(
  fin: PDFinancialsLike,
  company: CompanyData | undefined,
  allLoans: Loan[],
  anchor: YearSnapshotPeriodAnchor | null,
  selectedYear: number,
  periodLabel: string,
): PropDevBoardExportPayload {
  // One scoped ledger for Command Center + Multi-Year Snapshot + YoY Detail.
  // Anchor year Month/YTD amounts are written into values[year] so every section matches.
  const scopedFin = scopePropDevFinToPeriod(fin, anchor);
  const plSnapshots = buildPropDevYearSnapshots(scopedFin, anchor, { annualLedger: true });
  const companyLoansEarly = (company?.loans?.length ? company.loans : allLoans.filter(l => l.companyId === company?.id));
  const bsSnapshots = buildPropDevBsSnapshots(scopedFin, company, anchor, {
    annualLedger: true,
    loans: companyLoansEarly,
  });
  const cfSnapshots = buildPropDevCfSnapshots(scopedFin, company, anchor, { annualLedger: true });
  const focusYear = resolvePropDevFocusYear(
    scopedFin.years.length
      ? scopedFin.years
      : [...new Set([
        ...plSnapshots.map(s => s.year),
        ...bsSnapshots.map(s => s.year),
        ...cfSnapshots.map(s => s.year),
      ])].sort((a, b) => a - b),
    anchor?.year,
    selectedYear,
  );
  const focusBs = pickFocusSnapshot(bsSnapshots, focusYear);
  const insights = buildPropDevCfoInsights(scopedFin, company, allLoans, bsSnapshots, cfSnapshots);
  const cashRunway = computeCashRunwayHero(cfSnapshots, company, focusYear ?? selectedYear);
  const capitalCallCoverage = company ? computeCapitalCallCoverage(company, 6, allLoans) : null;

  const landValue = (() => {
    const fromSnap = focusBs?.landValue ?? 0;
    const isLandLine = (lab: string) => {
      if (/sale\s+of\s+land|land\s+sales?|improvement|landscape|loan|payable/i.test(lab)) return false;
      return /\bland\b/i.test(lab);
    };
    // B/S genuinely tracks land for this company (some year has a land-labeled row)?
    // If so, trust the current-period snapshot as authoritative — including a
    // real $0 after disposal — instead of a sticky historical max or the static
    // company-record land cost, both of which can never reflect a sale.
    const bsTracksLand = scopedFin.bs.some(i => isLandLine(i.label ?? ''));
    if (bsTracksLand && focusBs) return fromSnap;

    // No B/S land line at all — fall back to the strongest historical/company figure.
    let fromBs = 0;
    for (const i of scopedFin.bs) {
      const lab = i.label ?? '';
      if (!isLandLine(lab)) continue;
      for (const raw of Object.values(i.values ?? {})) {
        const v = Math.abs(Number(raw) || 0);
        if (v > fromBs) fromBs = v;
      }
      for (const raw of Object.values(i.monthlyValues ?? {})) {
        const v = Math.abs(Number(raw) || 0);
        if (v > fromBs) fromBs = v;
      }
    }
    const fromCompany = company ? resolveLandValue(company) : null;
    return Math.max(fromSnap, fromBs, fromCompany ?? 0) || null;
  })();
  const companyLoans = companyLoansEarly;
  const trackerDebt = sumActivePropDevLoanBalances(companyLoans);
  const totalMonthlyEmi = company ? resolveCompanyMonthlyEmi(company, allLoans) : 0;
  // Command Center Total Debt must match B/S snapshot (Total for Liabilities).
  const bsDebt = focusBs?.totalDebt ?? 0;
  const bsFromSheet = focusBs?.debtSource === 'balance_sheet' || focusBs?.debtSource === 'yearly_bs';
  const totalDebt = (bsFromSheet && bsDebt > 0)
    ? bsDebt
    : (bsDebt > 50_000 ? bsDebt : (trackerDebt > 0 ? trackerDebt : bsDebt));

  const loanRowsBase: PropDevLoanRow[] = companyLoans
    .filter(isActivePropDevLoan)
    .map(l => ({
      bank: l.bank || l.lenderName || '—',
      amount: l.amount,
      rate: normalizeInterestRatePercent(l.interestRate),
      emi: l.emi,
      balance: l.balance,
      maturityDate: l.maturityDate,
      status: l.status,
    }));

  // Loan register outstanding should reconcile to the period-scoped Balance Sheet
  // line(s) for long-term business loans (especially for the current in-progress
  // year where loan tracker "current balance" can drift by a few thousand).
  let loanRows = loanRowsBase;
  const loanFocusYear = focusYear ?? scopedFin.years[scopedFin.years.length - 1];
  if (loanFocusYear != null && loanRowsBase.length > 0 && scopedFin.bs.length > 0) {
    const readYear = (vals: Record<number | string, number> | undefined) => {
      if (!vals) return 0;
      return vals[loanFocusYear] ?? vals[String(loanFocusYear)] ?? 0;
    };

    const bsLoanCandidates = scopedFin.bs.filter(i =>
      !i.isSectionHeader
      && !/partner/i.test(i.label)
      && /loan/i.test(i.label)
      && /business/i.test(i.label),
    );

    const bsLoanTotalRow = bsLoanCandidates.find(i => i.isTotal || /^total\s+for\b/i.test(i.label.trim()));
    const bsLoanTotal = bsLoanTotalRow
      ? Math.abs(readYear(bsLoanTotalRow.values as any))
      : Math.abs(bsLoanCandidates.filter(i => !i.isTotal).reduce((s, i) => s + Math.abs(readYear(i.values as any)), 0));

    const loanRegisterSum = loanRowsBase.reduce((s, r) => s + r.balance, 0);
    if (bsLoanTotal > 0 && loanRegisterSum !== 0) {
      const ratio = bsLoanTotal / loanRegisterSum;
      // Apply proportional adjustment so lender-level charts and totals reconcile.
      loanRows = loanRowsBase.map(r => ({ ...r, balance: r.balance * ratio }));
    }
  }

  const overdueCapitalCalls: PropDevOverdueCapitalCall[] = (company?.capitalCalls ?? [])
    .filter(c => c.status === 'Overdue')
    .map(c => ({
      partnerName: c.partnerName,
      period: c.period,
      amountDue: Math.max(0, c.totalDue - c.received),
      dueDate: c.dueDate,
    }));

  // Values already period-scoped — read annual maps for the focus year (not always last).
  const latestRevenueCategories = focusYear != null
    ? getPropDevRevenueForYear(scopedFin, focusYear, undefined).categories
    : {};
  const latestExpenseCategories: Record<string, number> = {};
  if (focusYear != null) {
    for (const item of scopedFin.pl) {
      if (item.isSectionHeader || item.isTotal || item.isNetIncome) continue;
      // Include COGS / cost lines — development P&Ls often have spend there, not under Expenses.
      if (/income|revenue|gross\s+profit|net\s+income|net\s+profit/i.test(item.label)) continue;
      if (/^total\s+for\b/i.test(item.label)) continue;
      const v = Math.abs(item.values[focusYear] ?? 0);
      if (v > 0) {
        const catLabel = canonicalExpenseLineLabel(item.label);
        latestExpenseCategories[catLabel] = (latestExpenseCategories[catLabel] ?? 0) + v;
      }
    }
  }

  return {
    entityLabel: company?.name ?? scopedFin.companyName ?? fin.companyName ?? 'Property Dev Entity',
    periodLabel,
    generatedAt: new Date().toISOString(),
    years: scopedFin.years,
    focusYear,
    plSnapshots,
    bsSnapshots,
    cfSnapshots,
    insights,
    cashRunway,
    capitalCallCoverage,
    landValue,
    totalDebt,
    totalMonthlyEmi,
    loanRows,
    overdueCapitalCalls,
    latestExpenseCategories,
    latestRevenueCategories,
    /** Period-scoped statements — YoY Detail must use this, not the raw upload. */
    scopedFin,
  };
}

export { getPropDevAvailableKeys };
