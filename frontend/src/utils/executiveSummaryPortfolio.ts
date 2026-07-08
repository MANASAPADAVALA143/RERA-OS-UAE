import type { CompanyRow, LoanRow } from '../hooks/useRentalCfoData';
import type { OwnerRow } from '../hooks/useExecutiveSummaryData';

const CAP_RATE = 0.055;

export type MarketValueSource =
  | 'loan_tracker'
  | 'financials'
  | 'ownership'
  | 'gpr_cap_rate'
  | 'loan_amount';

export interface PortfolioMarketValueResult {
  value: number;
  source: MarketValueSource;
  label: string;
}

/** Resolve portfolio market value from uploaded sections (loan tracker → financials → ownership → GPR). */
export function resolvePortfolioMarketValue(params: {
  loans: LoanRow[];
  buildingsFromFinancials: number;
  companies: CompanyRow[];
  ownership: OwnerRow[];
  portfolioGpr: number;
}): PortfolioMarketValueResult {
  const { loans, buildingsFromFinancials, companies, ownership, portfolioGpr } = params;

  const loanPropValue = loans.reduce((s, l) => s + (l.current_property_value ?? 0), 0);
  if (loanPropValue > 0) {
    return { value: loanPropValue, source: 'loan_tracker', label: 'From loan tracker property values' };
  }

  if (buildingsFromFinancials > 0) {
    return { value: buildingsFromFinancials, source: 'financials', label: 'From balance sheet (Buildings)' };
  }

  if (ownership.length > 0) {
    const gprByCompany = new Map(companies.map(c => [c.company_name, c.gross_potential_rent]));
    const seen = new Set<string>();
    let mv = 0;
    for (const p of ownership) {
      for (const h of p.holdings) {
        const key = h.company_name;
        if (seen.has(key)) continue;
        seen.add(key);
        const gpr = gprByCompany.get(h.company_name) ?? 0;
        const fromGpr = gpr > 0 ? (gpr * 12) / CAP_RATE : 0;
        if (fromGpr > 0) {
          mv += fromGpr;
        } else if ((h.book_value ?? 0) > 0) {
          mv += h.book_value!;
        } else if ((h.cost_basis ?? 0) > 0) {
          mv += h.cost_basis!;
        }
      }
    }
    if (mv > 0) {
      return { value: mv, source: 'ownership', label: 'From ownership (GPR cap rate or book value)' };
    }
  }

  const gpr = portfolioGpr > 0
    ? portfolioGpr
    : companies.reduce((s, c) => s + (c.gross_potential_rent ?? 0), 0);
  if (gpr > 0) {
    return {
      value: (gpr * 12) / CAP_RATE,
      source: 'gpr_cap_rate',
      label: `Estimated from GPR @ ${(CAP_RATE * 100).toFixed(1)}% cap`,
    };
  }

  const loanAmountSum = loans.reduce((s, l) => s + (l.loan_amount ?? 0), 0);
  if (loanAmountSum > 0) {
    return { value: loanAmountSum, source: 'loan_amount', label: 'Estimated from original loan amounts' };
  }

  return { value: 0, source: 'loan_amount', label: '' };
}

export interface CompositionSlice {
  name: string;
  value: number;
}

/** Per-company / property market value slices for asset composition donut. */
export function buildMarketValueComposition(params: {
  companies: CompanyRow[];
  loans: LoanRow[];
  ownership: OwnerRow[];
}): CompositionSlice[] {
  const { companies, loans, ownership } = params;
  const slices: CompositionSlice[] = [];
  const gprByCompany = new Map(companies.map(c => [c.company_name, c.gross_potential_rent]));
  const seen = new Set<string>();

  for (const co of companies) {
    const loanVal = loans
      .filter(l => l.company_name === co.company_name)
      .reduce((s, l) => s + (l.current_property_value ?? 0), 0);
    if (loanVal > 0) {
      slices.push({ name: shortName(co.company_name), value: loanVal });
      seen.add(co.company_name);
      continue;
    }
    const gpr = co.gross_potential_rent ?? 0;
    if (gpr > 0) {
      slices.push({ name: shortName(co.company_name), value: (gpr * 12) / CAP_RATE });
      seen.add(co.company_name);
    }
  }

  if (!slices.length && ownership.length) {
    for (const p of ownership) {
      for (const h of p.holdings) {
        if (seen.has(h.company_name)) continue;
        seen.add(h.company_name);
        const gpr = gprByCompany.get(h.company_name) ?? 0;
        const fromGpr = gpr > 0 ? (gpr * 12) / CAP_RATE : 0;
        if (fromGpr > 0) slices.push({ name: shortName(h.company_name), value: fromGpr });
        else if ((h.book_value ?? 0) > 0) slices.push({ name: shortName(h.company_name), value: h.book_value! });
        else if ((h.cost_basis ?? 0) > 0) slices.push({ name: shortName(h.company_name), value: h.cost_basis! });
      }
    }
  }

  if (!slices.length && loans.length) {
    for (const l of loans) {
      const val = l.current_property_value ?? l.loan_amount ?? 0;
      if (val > 0) {
        slices.push({ name: shortName(l.property_name || l.company_name), value: val });
      }
    }
  }

  return slices.filter(s => s.value > 0);
}

/** Outstanding debt by property for Band 1 composition donut. */
export function buildDebtComposition(loans: LoanRow[]): CompositionSlice[] {
  const byProp = new Map<string, number>();
  for (const l of loans) {
    const key = l.property_name || l.company_name;
    const bal = l.loan_balance_as_of ?? l.loan_amount ?? 0;
    if (bal <= 0) continue;
    byProp.set(key, (byProp.get(key) ?? 0) + bal);
  }
  return [...byProp.entries()].map(([name, value]) => ({
    name: shortName(name),
    value,
  }));
}

function shortName(s: string): string {
  const parts = s.trim().split(/\s+/);
  return parts.length > 2 ? `${parts[0]} ${parts[1]}` : s.slice(0, 14);
}
