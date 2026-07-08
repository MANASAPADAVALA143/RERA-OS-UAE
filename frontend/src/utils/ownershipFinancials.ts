/** Shared ownership valuation helpers — used by Ownership page and Executive Summary analytics tab. */

export const OWNERSHIP_CAP_RATE = 0.055;
const ACQ_COST = 0.05;
const DEP_RATE = 0.03636;
const HOLD_YEARS = 5;
const DIST_RATE = 0.045;

export const OWNERSHIP_CHART_COLORS = [
  '#1E3A8A', '#2D6A4F', '#40916C', '#52B788', '#74C69D', '#95D5B2',
  '#FBBF24', '#F97316', '#7C3AED', '#DB2777',
];

export interface OwnershipHolding {
  ownership_id: string;
  company_id: string;
  company_name: string;
  property_id?: string | null;
  property_name?: string;
  property_address?: string | null;
  ownership_pct: number;
  role: string;
  cost_basis?: number | null;
  book_value?: number | null;
  existing_debt?: number | null;
  capital_contributed?: number | null;
  noi_this_month: number;
  noi_share: number;
}

export interface OwnershipPartnerGroup {
  partner_name: string;
  company_count: number;
  total_noi_share: number;
  holdings: OwnershipHolding[];
}

export interface PartnerFinancials {
  marketValue: number;
  capitalContributed: number;
  costBasis: number;
  bookValue: number;
  unrealizedGain: number;
  returnToDate: number;
  roi: number;
}

export interface OwnershipCompanyMeta {
  id: string;
  company_name: string;
  total_units: number;
  gross_potential_rent: number;
}

export function companyMarketValue(gpr: number): number {
  return gpr > 0 ? (gpr * 12) / OWNERSHIP_CAP_RATE : 0;
}

export function holdingFinancials(
  holding: OwnershipHolding,
  companyGpr: number,
  holdYears = HOLD_YEARS,
) {
  const propertyMV = companyMarketValue(companyGpr);
  const marketValue = propertyMV > 0
    ? propertyMV * holding.ownership_pct
    : (holding.book_value ?? holding.cost_basis ?? 0);

  let capitalContributed = holding.capital_contributed ?? null;
  if (capitalContributed == null && holding.cost_basis != null) {
    capitalContributed = holding.cost_basis / (1 + ACQ_COST);
  }
  if (capitalContributed == null && marketValue > 0) {
    capitalContributed = marketValue / 1.25;
  }
  capitalContributed = capitalContributed ?? 0;

  const costBasis = holding.cost_basis
    ?? (capitalContributed > 0 ? capitalContributed * (1 + ACQ_COST) : 0);

  const bookValue = holding.book_value
    ?? (costBasis > 0 ? Math.max(0, costBasis * (1 - DEP_RATE * holdYears)) : 0);

  const existingDebt = holding.existing_debt ?? 0;
  const unrealizedGain = marketValue - costBasis;
  return { marketValue, capitalContributed, costBasis, bookValue, unrealizedGain, existingDebt };
}

export function derivePartnerFinancials(
  p: OwnershipPartnerGroup,
  companyGpr: Record<string, number>,
  scopeCompanyId?: string,
): PartnerFinancials {
  const holdings = scopeCompanyId
    ? p.holdings.filter(h => h.company_id === scopeCompanyId)
    : p.holdings;

  let marketValue = 0;
  let capitalContributed = 0;
  let costBasis = 0;
  let bookValue = 0;

  holdings.forEach(h => {
    const gpr = companyGpr[h.company_id] ?? 0;
    const hf = holdingFinancials(h, gpr);
    marketValue += hf.marketValue;
    capitalContributed += hf.capitalContributed;
    costBasis += hf.costBasis;
    bookValue += hf.bookValue;
  });

  const unrealizedGain = marketValue - costBasis;
  const returnToDate = capitalContributed > 0 ? capitalContributed * DIST_RATE * HOLD_YEARS : 0;
  const roi = costBasis > 0 ? (returnToDate / costBasis) * 100 : 0;
  return { marketValue, capitalContributed, costBasis, bookValue, unrealizedGain, returnToDate, roi };
}

export const fmtOwnershipK = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${Math.round(n)}`;
