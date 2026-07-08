/**
 * Company Registry ops for Executive Summary Band 2 — mirrors CompanyRegistry / RentalOverview logic.
 * Uses monthly_rent_data, sync_* fields, and unit rows when API month-scoped totals are empty.
 */
import type { CompanyRow, UnitRow } from '../hooks/useRentalCfoData';

const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface RegistryOpsMetrics {
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyPct: number | null;
  grossPotentialRent: number | null;
  collected: number | null;
  vacancyLoss: number | null;
  billed: number | null;
  arrears: number | null;
  /** Mon-YYYY key used for monthly_rent_data lookup */
  registryMonth: string | null;
}

type RegistryCompany = CompanyRow & {
  sync_gross_potential?: number | null;
  sync_collected?: number | null;
  sync_vacancy_loss?: number | null;
  sync_occupied_units?: number | null;
  sync_total_units?: number | null;
  monthly_rent_data?: Record<string, number> | null;
  last_sync_month?: string | null;
};

export function periodToRegistryKey(month: number, year: number): string {
  return `${MNAMES[month - 1]}-${year}`;
}

function parseRegistryKey(key: string): number {
  const m = key.match(/^([A-Za-z]{3})-(\d{4})$/);
  if (!m) return 0;
  const mi = MNAMES.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (mi < 0) return 0;
  return parseInt(m[2], 10) * 100 + (mi + 1);
}

export function latestRegistryMonthKey(companies: CompanyRow[]): string | null {
  const keys = new Set<string>();
  for (const c of companies) {
    const mrd = (c as RegistryCompany).monthly_rent_data;
    if (mrd) Object.keys(mrd).forEach(k => keys.add(k));
  }
  if (!keys.size) return null;
  return [...keys].sort((a, b) => parseRegistryKey(a) - parseRegistryKey(b)).pop() ?? null;
}

/** Prefer selected period month if present in registry; else latest sync month. */
export function resolveRegistryMonthKey(
  month: number,
  year: number,
  companies: CompanyRow[],
): string | null {
  const preferred = periodToRegistryKey(month, year);
  const hasPreferred = companies.some(c => {
    const mrd = (c as RegistryCompany).monthly_rent_data;
    return mrd && preferred in mrd;
  });
  if (hasPreferred) return preferred;

  const lastSync = companies
    .map(c => (c as RegistryCompany).last_sync_month)
    .filter((m): m is string => Boolean(m))
    .sort((a, b) => parseRegistryKey(a) - parseRegistryKey(b))
    .pop();
  if (lastSync) return lastSync;

  return latestRegistryMonthKey(companies);
}

function collectedForMonth(c: RegistryCompany, registryMonth: string | null): number | null {
  const mrd = c.monthly_rent_data ?? {};
  if (registryMonth && registryMonth in mrd) return mrd[registryMonth];
  if (c.collected_this_month > 0) return c.collected_this_month;
  if (c.sync_collected != null && c.sync_collected > 0) return c.sync_collected;
  return null;
}

function grossPotentialForCompany(c: RegistryCompany): number | null {
  if (c.gross_potential_rent > 0) return c.gross_potential_rent;
  if (c.sync_gross_potential != null && c.sync_gross_potential > 0) return c.sync_gross_potential;
  const mrd = c.monthly_rent_data ?? {};
  const vals = Object.values(mrd).filter(v => v > 0);
  if (vals.length) return Math.max(...vals);
  return null;
}

function occupancyForCompany(c: RegistryCompany): { occ: number; total: number } {
  if (c.total_units > 0) {
    return { occ: c.occupied_units, total: c.total_units };
  }
  const syncTotal = c.sync_total_units ?? 0;
  const syncOcc = c.sync_occupied_units ?? 0;
  if (syncTotal > 0) return { occ: syncOcc, total: syncTotal };
  return { occ: 0, total: 0 };
}

function unitsOccupancy(units: UnitRow[], companyIds: Set<string>): { occ: number; total: number } {
  const scoped = units.filter(u => companyIds.has(u.company_id));
  if (!scoped.length) return { occ: 0, total: 0 };
  const occ = scoped.filter(u => u.status === 'occupied').length;
  return { occ, total: scoped.length };
}

function unitsGpr(units: UnitRow[], companyIds: Set<string>): number {
  return units
    .filter(u => companyIds.has(u.company_id))
    .reduce((s, u) => s + (u.monthly_rent ?? 0), 0);
}

export function aggregateRegistryOps(
  companies: CompanyRow[],
  units: UnitRow[],
  entityId: string,
  month: number,
  year: number,
): RegistryOpsMetrics {
  const scoped = entityId === 'portfolio'
    ? companies
    : companies.filter(c => c.id === entityId);
  const companyIds = new Set(scoped.map(c => c.id));
  const registryMonth = resolveRegistryMonthKey(month, year, scoped);

  let totalUnits = 0;
  let occupiedUnits = 0;
  let gprSum = 0;
  let gprAny = false;
  let collectedSum = 0;
  let collectedAny = false;
  let vacancySum = 0;
  let vacancyAny = false;
  let billedSum = 0;
  let billedAny = false;
  let arrearsSum = 0;
  let arrearsAny = false;

  for (const co of scoped) {
    const rc = co as RegistryCompany;
    const { occ, total } = occupancyForCompany(rc);
    totalUnits += total;
    occupiedUnits += occ;

    const gpr = grossPotentialForCompany(rc);
    if (gpr != null) { gprSum += gpr; gprAny = true; }

    const coll = collectedForMonth(rc, registryMonth);
    if (coll != null) { collectedSum += coll; collectedAny = true; }

    if (rc.vacancy_loss > 0) {
      vacancySum += rc.vacancy_loss;
      vacancyAny = true;
    } else if (rc.sync_vacancy_loss != null && rc.sync_vacancy_loss > 0) {
      vacancySum += rc.sync_vacancy_loss;
      vacancyAny = true;
    }

    if (rc.billed_this_month > 0) {
      billedSum += rc.billed_this_month;
      billedAny = true;
    }
    if (rc.arrears_total > 0) {
      arrearsSum += rc.arrears_total;
      arrearsAny = true;
    }
  }

  // Unit-level fallbacks when registry sync counts are missing
  if (totalUnits === 0 && units.length > 0) {
    const uo = unitsOccupancy(units, companyIds);
    totalUnits = uo.total;
    occupiedUnits = uo.occ;
  }
  if (!gprAny && units.length > 0) {
    const ug = unitsGpr(units, companyIds);
    if (ug > 0) { gprSum = ug; gprAny = true; }
  }

  const vacantUnits = Math.max(0, totalUnits - occupiedUnits);
  const occupancyPct = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : null;

  let grossPotentialRent = gprAny ? gprSum : null;
  let collected = collectedAny ? collectedSum : null;

  if (!vacancyAny && grossPotentialRent != null && collected != null) {
    vacancySum = Math.max(0, grossPotentialRent - collected);
    vacancyAny = vacancySum > 0;
  }

  return {
    totalUnits,
    occupiedUnits,
    vacantUnits,
    occupancyPct,
    grossPotentialRent,
    collected,
    vacancyLoss: vacancyAny ? vacancySum : null,
    billed: billedAny ? billedSum : null,
    arrears: arrearsAny ? arrearsSum : null,
    registryMonth,
  };
}

export interface RegistryTrendPoint {
  month: string;
  gpr: number;
  collected: number;
  occupancy: number;
}

/** Six-month GPR/collected trend from Company Registry monthly_rent_data. */
export function buildRegistryTrend(
  companies: CompanyRow[],
  entityId: string,
  occupancyPct: number | null,
  trailing = 6,
): RegistryTrendPoint[] {
  const scoped = entityId === 'portfolio'
    ? companies
    : companies.filter(c => c.id === entityId);

  const byMonth = new Map<string, number>();
  for (const co of scoped) {
    const mrd = (co as RegistryCompany).monthly_rent_data ?? {};
    for (const [k, v] of Object.entries(mrd)) {
      byMonth.set(k, (byMonth.get(k) ?? 0) + v);
    }
  }

  const occ = occupancyPct ?? 0;
  if (!byMonth.size) return [];

  const flatGpr = scoped.reduce((s, co) => {
    const rc = co as RegistryCompany;
    if (rc.gross_potential_rent > 0) return s + rc.gross_potential_rent;
    if (rc.sync_gross_potential != null && rc.sync_gross_potential > 0) return s + rc.sync_gross_potential;
    const mrd = rc.monthly_rent_data ?? {};
    const vals = Object.values(mrd).filter(v => v > 0);
    return s + (vals.length ? Math.max(...vals) : 0);
  }, 0);

  const sorted = [...byMonth.entries()]
    .sort((a, b) => parseRegistryKey(a[0]) - parseRegistryKey(b[0]))
    .slice(-trailing);

  return sorted.map(([key, collected]) => ({
    month: key.split('-')[0],
    gpr: flatGpr > 0 ? flatGpr : collected,
    collected,
    occupancy: occ,
  }));
}

export function registryKeyToMonthYm(key: string): string | null {
  const m = key.match(/^([A-Za-z]{3})-(\d{4})$/i);
  if (!m) return null;
  const mi = MNAMES.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (mi < 0) return null;
  return `${m[2]}-${String(mi + 1).padStart(2, '0')}`;
}
