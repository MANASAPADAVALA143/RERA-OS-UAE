/**
 * Property Dev Companies overview KPIs — single source of truth for card metrics.
 * Cost Basis = Land + Improvements/WIP (Balance Sheet), never capital contributed.
 */
import type { CompanyData, Loan, Partner } from '../contexts/PropertyDevContext';
import {
  buildPropDevBsSnapshots,
  type PDFinancialsLike,
} from './propDevCfoTrendData';
import { pdKpisForScope } from './propDevPeriodKpis';
import {
  portfolioLtlvPercent,
  resolveLandValue,
  sumActivePropDevLoanBalances,
} from './propDevLoanMetrics';

export interface PropDevPartnerLine {
  name: string;
  sharePercent: number;
}

export interface PropDevCompanyOverviewKpis {
  landValue: number | null;
  /** Land + Improvements/WIP (+ interest capitalised) from Balance Sheet. */
  costBasis: number | null;
  /** B/S "Improvements" line only (e.g. "Improvements - Others"), excluding Interest Capitalised. */
  improvements: number | null;
  /** Max partner fair_market_value for the entity (Ownership upload). */
  fmv: number | null;
  /** Max partner cost_basis for the entity (Ownership upload "Cost Basis" column) --
   *  distinct from costBasis above (Balance Sheet Land + Improvements/WIP). Displayed as
   *  "Land Cost" per the glossary: Land Cost / Cost Basis = raw file "Cost Basis" column. */
  acquisitionCost: number | null;
  /** Book Value = Balance Sheet Land + Improvements (landValue + improvements). Used with
   *  fmv for Unrealised Gain/(Loss) = Market Value (FV) - Book Value. */
  bookValue: number | null;
  /** "Total for Partner Investments" B/S line -- Capital Raised, per the Capital
   *  Structure tab. Distinct from partner-level capitalContributed (Ownership sheet). */
  partnerInvestments: number | null;
  loanBalance: number;
  /** "Total for Long-term business loans" B/S line — distinct from loanBalance (Total for Liabilities). */
  loanOutstanding: number | null;
  /** Sum of active loan balances from the Loan Tracker (uploaded Bank Loan Information
   *  workbook, "Loan Balance as on <date>" column) -- distinct from the B/S-sourced
   *  loanOutstanding above. */
  loanTrackerOutstanding: number | null;
  ltlv: number | null;
  cash: number | null;
  netIncome: number | null;
  hasFin: boolean;
  hasOwnership: boolean;
  partners: PropDevPartnerLine[];
}

function activePartners(partners: Partner[]): Partner[] {
  return partners.filter(p => {
    const s = (p.status as string) || 'Active';
    return s !== 'Exited';
  });
}

/** Company-level FMV = max of uploaded partner FMV values (same as Ownership page). */
export function companyFmvFromPartners(partners: Partner[]): number | null {
  let max = 0;
  for (const p of partners) {
    const v = p.fairMarketValue;
    if (v != null && v > 0) max = Math.max(max, v);
  }
  return max > 0 ? max : null;
}

/** Company-level Acquisition Cost = max of uploaded partner cost_basis values
 *  (Ownership sheet's "Cost Basis" column, same aggregation convention as FMV above). */
export function companyCostBasisFromPartners(partners: Partner[]): number | null {
  let max = 0;
  for (const p of partners) {
    const v = p.costBasis;
    if (v != null && v > 0) max = Math.max(max, v);
  }
  return max > 0 ? max : null;
}

function fromYearlyBsPl(c: CompanyData, anchorYear?: number | null): Pick<
  PropDevCompanyOverviewKpis,
  'landValue' | 'costBasis' | 'improvements' | 'cash' | 'netIncome' | 'hasFin' | 'loanOutstanding'
> {
  const bs = c.property.yearlyBS;
  const pl = c.property.yearlyPL;
  const bsYears = bs ? Object.keys(bs).sort() : [];
  const plYears = pl ? Object.keys(pl).sort() : [];
  const anchorKey = anchorYear != null ? String(anchorYear) : null;
  const latestBsY = (anchorKey && bsYears.includes(anchorKey)) ? anchorKey : bsYears[bsYears.length - 1];
  const latestPlY = (anchorKey && plYears.includes(anchorKey)) ? anchorKey : plYears[plYears.length - 1];
  const row = latestBsY && bs ? bs[latestBsY] : undefined;

  const landValue = resolveLandValue(c);
  const improvements = row?.improvements ?? c.property.improvements ?? 0;
  const intCap = row?.interest_capitalised ?? c.property.interestCapitalised ?? 0;
  const costBasis =
    landValue != null
      ? landValue + improvements + intCap
      : improvements + intCap > 0
        ? improvements + intCap
        : null;

  const cash =
    row != null && row.cash != null
      ? row.cash
      : null;

  const netIncome =
    latestPlY && pl?.[latestPlY]
      ? pl[latestPlY].net_income
      : null;

  const hasFin = Boolean(
    (bs && bsYears.length > 0) || (pl && plYears.length > 0),
  );

  const loanOutstanding = row?.loan_balance ?? null;

  return { landValue, costBasis, improvements: improvements > 0 ? improvements : null, cash, netIncome, hasFin, loanOutstanding };
}

function fromUploadedFin(
  c: CompanyData,
  fin: PDFinancialsLike,
  anchorYear?: number | null,
): Pick<PropDevCompanyOverviewKpis, 'landValue' | 'costBasis' | 'improvements' | 'cash' | 'netIncome' | 'hasFin' | 'loanBalance' | 'loanOutstanding' | 'partnerInvestments'> | null {
  if (!fin.years?.length || (!fin.bs?.length && !fin.pl?.length)) return null;
  // Caller should pass period-scoped fin (values[year] already hold Month/YTD).
  // annualLedger: true avoids re-reading stale monthly cells / cashAvailable.
  const snaps = buildPropDevBsSnapshots(fin, c, null, {
    annualLedger: true,
    loans: c.loans ?? [],
  });
  const latest = (anchorYear != null ? snaps.find(s => s.year === anchorYear) : undefined) ?? snaps[snaps.length - 1];
  const year = latest?.year ?? fin.years[fin.years.length - 1];
  const kpis = pdKpisForScope(fin, year);

  const landValue =
    latest && latest.landValue > 0
      ? latest.landValue
      : resolveLandValue(c);
  const costBasis =
    latest && latest.totalFixedAssets > 0
      ? latest.totalFixedAssets
      : null;
  const improvements = latest && latest.landImprovements > 0 ? latest.landImprovements : null;
  const cash = latest != null ? latest.cash : kpis.cash;
  const netIncome = kpis.netInc;
  const loanBalance = latest && latest.totalDebt > 0 ? latest.totalDebt : 0;
  const loanOutstanding = latest && latest.longTermLoans > 0 ? latest.longTermLoans : null;
  const partnerInvestments = latest && latest.partnerInvestments > 0 ? latest.partnerInvestments : null;

  return {
    landValue,
    costBasis,
    improvements,
    cash: cash != null ? cash : null,
    netIncome,
    hasFin: true,
    loanBalance,
    loanOutstanding,
    partnerInvestments,
  };
}

export function propDevCompanyOverviewKpis(
  c: CompanyData,
  uploadedFin?: PDFinancialsLike | null,
  allLoans?: Loan[],
  anchorYear?: number | null,
): PropDevCompanyOverviewKpis {
  const partners = activePartners(c.partners ?? []);
  const hasOwnership = partners.length > 0;
  const fmv = hasOwnership ? companyFmvFromPartners(partners) : null;
  const acquisitionCost = hasOwnership ? companyCostBasisFromPartners(partners) : null;

  const coLoans = (c.loans?.length ? c.loans : (allLoans ?? []).filter(l => l.companyId === c.id));
  const trackerBalance = sumActivePropDevLoanBalances(coLoans);

  const fromUpload = uploadedFin ? fromUploadedFin(c, uploadedFin, anchorYear) : null;
  const fromYearly = fromYearlyBsPl(c, anchorYear);

  const landValue = fromUpload?.landValue ?? fromYearly.landValue;
  const costBasis = fromUpload?.costBasis ?? fromYearly.costBasis;
  const improvements = fromUpload?.improvements ?? fromYearly.improvements;
  const cash = fromUpload?.cash ?? fromYearly.cash;
  const netIncome = fromUpload?.netIncome ?? fromYearly.netIncome;
  // Prefer B/S Total for Liabilities (via BS snapshots) over Loan Tracker April as-of balances.
  const loanBalance = (fromUpload?.loanBalance && fromUpload.loanBalance > 0)
    ? fromUpload.loanBalance
    : trackerBalance;
  const loanOutstanding = fromUpload?.loanOutstanding ?? fromYearly.loanOutstanding;
  const loanTrackerOutstanding = trackerBalance > 0 ? trackerBalance : null;
  const bookValue = landValue != null ? landValue + (improvements ?? 0) : null;
  const partnerInvestments = fromUpload?.partnerInvestments ?? null;
  const hasFin = Boolean(fromUpload?.hasFin || fromYearly.hasFin)
    || Boolean(typeof localStorage !== 'undefined' && localStorage.getItem(`propdev_upload_${c.id}`));

  return {
    landValue,
    costBasis,
    improvements,
    fmv,
    acquisitionCost,
    bookValue,
    partnerInvestments,
    loanBalance,
    loanOutstanding,
    loanTrackerOutstanding,
    ltlv: portfolioLtlvPercent(loanBalance, landValue),
    cash,
    netIncome,
    hasFin,
    hasOwnership,
    partners: partners.map(p => ({
      name: p.name,
      sharePercent: p.sharePercent > 0 && p.sharePercent <= 1
        ? p.sharePercent * 100
        : p.sharePercent,
    })),
  };
}

export function propDevPortfolioOverview(
  rows: { kpis: PropDevCompanyOverviewKpis }[],
): {
  totalLand: number;
  totalCostBasis: number;
  /** Sum of B/S "Improvements" lines only (e.g. "Improvements - Others"). */
  totalImprovements: number;
  totalAcquisitionCost: number;
  totalMarketValue: number;
  totalDebt: number;
  totalLoanOutstanding: number;
  /** Sum of active Loan Tracker balances (distinct from the B/S-sourced totalLoanOutstanding). */
  totalLoanTrackerOutstanding: number;
  avgLtlv: number | null;
  companiesWithLand: number;
} {
  let totalLand = 0;
  let totalCostBasis = 0;
  let totalImprovements = 0;
  let totalAcquisitionCost = 0;
  let totalMarketValue = 0;
  let totalDebt = 0;
  let totalLoanOutstanding = 0;
  let totalLoanTrackerOutstanding = 0;
  let companiesWithLand = 0;
  for (const { kpis } of rows) {
    if (kpis.landValue != null && kpis.landValue > 0) {
      totalLand += kpis.landValue;
      companiesWithLand += 1;
    }
    if (kpis.costBasis != null && kpis.costBasis > 0) totalCostBasis += kpis.costBasis;
    if (kpis.improvements != null && kpis.improvements > 0) totalImprovements += kpis.improvements;
    if (kpis.acquisitionCost != null && kpis.acquisitionCost > 0) totalAcquisitionCost += kpis.acquisitionCost;
    if (kpis.fmv != null && kpis.fmv > 0) totalMarketValue += kpis.fmv;
    totalDebt += kpis.loanBalance;
    if (kpis.loanOutstanding != null && kpis.loanOutstanding > 0) totalLoanOutstanding += kpis.loanOutstanding;
    if (kpis.loanTrackerOutstanding != null && kpis.loanTrackerOutstanding > 0) totalLoanTrackerOutstanding += kpis.loanTrackerOutstanding;
  }
  return {
    totalLand,
    totalCostBasis,
    totalImprovements,
    totalAcquisitionCost,
    totalMarketValue,
    totalDebt,
    totalLoanOutstanding,
    totalLoanTrackerOutstanding,
    avgLtlv: portfolioLtlvPercent(totalDebt, totalLand > 0 ? totalLand : null),
    companiesWithLand,
  };
}
