import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export interface EntityOps {
  entity_name: string;
  units: number;
  occupancy_pct: number;
  rent_per_unit_mo: number;
  other_income_annual: number;
  management_fee: number;
  maintenance: number;
  utilities: number;
  insurance: number;
  property_taxes: number;
  other_opex: number;
  loan_balance: number;
  debt_service_annual: number;
  property_value: number;
}

export interface EntityArAp {
  entity_name: string;
  ar_current: number;
  ar_1_30: number;
  ar_31_60: number;
  ar_61_90: number;
  ar_90_plus: number;
  ap_current: number;
  ap_1_30: number;
  ap_31_60: number;
  ap_60_plus: number;
}

export interface PortfolioState {
  entities: EntityOps[];
  arAp: EntityArAp[];
  loaded: boolean;
  fileName: string;
}

export interface EntityMetrics {
  gpr: number;
  vacancy: number;
  egi: number;
  total_opex: number;
  noi: number;
  dscr: number | null;
  cap_rate: number | null;
  cash_flow: number;
  ltv: number | null;
  member_equity: number;
}

export function computeEntityMetrics(e: EntityOps): EntityMetrics {
  const gpr = e.units * e.rent_per_unit_mo * 12;
  const vacancy = gpr * (1 - Math.min(1, Math.max(0, e.occupancy_pct)));
  const egi = gpr - vacancy + e.other_income_annual;
  const total_opex = e.management_fee + e.maintenance + e.utilities +
    e.insurance + e.property_taxes + e.other_opex;
  const noi = egi - total_opex;
  const dscr = e.debt_service_annual > 0 ? noi / e.debt_service_annual : null;
  const cap_rate = e.property_value > 0 ? noi / e.property_value : null;
  const cash_flow = noi - e.debt_service_annual;
  const ltv = e.property_value > 0 ? e.loan_balance / e.property_value : null;
  const member_equity = e.property_value - e.loan_balance;
  return { gpr, vacancy, egi, total_opex, noi, dscr, cap_rate, cash_flow, ltv, member_equity };
}

export function sumMetrics(entities: EntityOps[]): EntityMetrics {
  const ms = entities.map(computeEntityMetrics);
  const gpr = ms.reduce((s, m) => s + m.gpr, 0);
  const vacancy = ms.reduce((s, m) => s + m.vacancy, 0);
  const egi = ms.reduce((s, m) => s + m.egi, 0);
  const total_opex = ms.reduce((s, m) => s + m.total_opex, 0);
  const noi = ms.reduce((s, m) => s + m.noi, 0);
  const total_ds = entities.reduce((s, e) => s + e.debt_service_annual, 0);
  const dscr = total_ds > 0 ? noi / total_ds : null;
  const total_value = entities.reduce((s, e) => s + e.property_value, 0);
  const cap_rate = total_value > 0 ? noi / total_value : null;
  const cash_flow = noi - total_ds;
  const total_loan = entities.reduce((s, e) => s + e.loan_balance, 0);
  const ltv = total_value > 0 ? total_loan / total_value : null;
  const member_equity = total_value - total_loan;
  return { gpr, vacancy, egi, total_opex, noi, dscr, cap_rate, cash_flow, ltv, member_equity };
}

const BLANK: PortfolioState = { entities: [], arAp: [], loaded: false, fileName: '' };

interface CtxType { portfolio: PortfolioState; setPortfolio: (p: PortfolioState) => void }
const Ctx = createContext<CtxType | null>(null);

export function RentalPortfolioProvider({ children }: { children: ReactNode }) {
  const [portfolio, setPortfolio] = useState<PortfolioState>(BLANK);
  return <Ctx.Provider value={{ portfolio, setPortfolio }}>{children}</Ctx.Provider>;
}

export function useRentalPortfolio() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRentalPortfolio must be inside RentalPortfolioProvider');
  return ctx;
}
