import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import { isActivePropDevLoan, resolveLandValue } from './propDevLoanMetrics';
import api from '../services/api';

// ── Property tax records (backend-persisted, Excel-uploaded) ──────────────────

export interface PropDevPropertyTaxRow {
  id: string;
  company_id: string | null;
  entity_name: string;
  property_address: string | null;
  tax_year: number | null;
  tax_amount: number;
  tax_with_penalty: number;
  penalty_amount: number;
  paid_amount: number;
  balance: number;
  payment_date: string | null;
  payment_status: string | null;
}

export async function fetchPropDevPropertyTax(): Promise<PropDevPropertyTaxRow[]> {
  const res = await api.get<{ items: PropDevPropertyTaxRow[] }>('/api/propdev/property-tax');
  return res.data.items ?? [];
}

export async function uploadPropDevPropertyTax(file: File): Promise<{ imported: number; message: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await api.post<{ imported: number; message: string }>('/api/propdev/property-tax/upload', fd);
  return res.data;
}

// ── Section 1: Property Tax Tracker ────────────────────────────────────────────

export interface TaxEntityGroup {
  entityName: string;
  rows: PropDevPropertyTaxRow[];
  totalTax: number;
  totalPaid: number;
  totalBalance: number;
}

export function groupTaxByEntity(rows: PropDevPropertyTaxRow[]): TaxEntityGroup[] {
  const byEntity = new Map<string, PropDevPropertyTaxRow[]>();
  for (const r of rows) {
    const key = r.entity_name;
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key)!.push(r);
  }
  return [...byEntity.entries()]
    .map(([entityName, entityRows]) => ({
      entityName,
      rows: entityRows,
      totalTax: entityRows.reduce((s, r) => s + r.tax_with_penalty, 0),
      totalPaid: entityRows.reduce((s, r) => s + r.paid_amount, 0),
      totalBalance: entityRows.reduce((s, r) => s + r.balance, 0),
    }))
    .sort((a, b) => b.totalTax - a.totalTax);
}

export interface PenaltyRow {
  entityName: string;
  properties: number;
  baseTax: number;
  penaltyAmount: number;
  penaltyPct: number;
}

export function computePenaltyRows(groups: TaxEntityGroup[]): PenaltyRow[] {
  return groups
    .map(g => {
      const baseTax = g.rows.reduce((s, r) => s + r.tax_amount, 0);
      const penaltyAmount = g.rows.reduce((s, r) => s + r.penalty_amount, 0);
      return {
        entityName: g.entityName,
        properties: g.rows.length,
        baseTax,
        penaltyAmount,
        penaltyPct: baseTax > 0 ? (penaltyAmount / baseTax) * 100 : 0,
      };
    })
    .filter(r => r.penaltyAmount > 0)
    .sort((a, b) => b.penaltyAmount - a.penaltyAmount);
}

// ── Section 2: Loan Interest & Principal Breakdown ─────────────────────────────

export type InterestBurdenStatus = 'Interest heavy' | 'Balanced' | 'Principal heavy';

export function interestBurdenStatus(interestPct: number): InterestBurdenStatus {
  if (interestPct > 70) return 'Interest heavy';
  if (interestPct >= 50) return 'Balanced';
  return 'Principal heavy';
}

export interface InterestPrincipalRow {
  loanId: string;
  entityName: string;
  lender: string;
  outstanding: number;
  rate: number;
  annualEmi: number;
  annualInterest: number;
  annualPrincipal: number;
  interestPct: number;
  status: InterestBurdenStatus;
}

export function computeInterestPrincipalRows(companies: CompanyData[], allLoans: Loan[]): InterestPrincipalRow[] {
  const active = allLoans.filter(isActivePropDevLoan);
  return active.map(l => {
    const company = companies.find(c => c.id === l.companyId);
    const annualEmi = (l.emi || 0) * 12;
    const annualInterest = (l.balance || 0) * ((l.interestRate || 0) / 100);
    const annualPrincipal = Math.max(0, annualEmi - annualInterest);
    const interestPct = annualEmi > 0 ? (annualInterest / annualEmi) * 100 : 0;
    return {
      loanId: l.id,
      entityName: company?.name ?? l.company,
      lender: l.bank,
      outstanding: l.balance || 0,
      rate: l.interestRate || 0,
      annualEmi,
      annualInterest,
      annualPrincipal,
      interestPct,
      status: interestBurdenStatus(interestPct),
    };
  }).sort((a, b) => b.outstanding - a.outstanding);
}

export interface CumulativeInterestRow {
  loanId: string;
  entityName: string;
  lender: string;
  loanStart: string | null;
  monthsElapsed: number;
  cumulativeInterest: number;
  cumulativePrincipal: number;
  pctPaidOff: number;
}

/** Reconstructs interest paid to date by walking a standard amortization schedule from origination. */
export function computeCumulativeInterestRows(companies: CompanyData[], allLoans: Loan[]): CumulativeInterestRow[] {
  const active = allLoans.filter(isActivePropDevLoan);
  const now = new Date();
  return active.map(l => {
    const company = companies.find(c => c.id === l.companyId);
    const start = l.loanDate ? new Date(l.loanDate) : null;
    const monthsElapsed = start && !Number.isNaN(start.getTime())
      ? Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()))
      : 0;
    const monthlyRate = (l.interestRate || 0) / 100 / 12;
    let balance = l.amount || 0;
    let cumulativeInterest = 0;
    for (let i = 0; i < monthsElapsed && balance > 0.5; i++) {
      const interest = balance * monthlyRate;
      let principal = (l.emi || 0) - interest;
      if (principal <= 0) break;
      if (principal > balance) principal = balance;
      balance -= principal;
      cumulativeInterest += interest;
    }
    const cumulativePrincipal = Math.max(0, (l.amount || 0) - (l.balance || 0));
    const pctPaidOff = l.amount > 0 ? (cumulativePrincipal / l.amount) * 100 : 0;
    return {
      loanId: l.id,
      entityName: company?.name ?? l.company,
      lender: l.bank,
      loanStart: l.loanDate || null,
      monthsElapsed,
      cumulativeInterest,
      cumulativePrincipal,
      pctPaidOff,
    };
  }).sort((a, b) => b.pctPaidOff - a.pctPaidOff);
}

// ── Section 3: Cost Basis Calculator ───────────────────────────────────────────

export interface CostBasisRow {
  entityId: string;
  entityName: string;
  landCost: number;
  improvements: number;
  propertyTaxPaid: number;
  interestPaidToDate: number;
  operatingExpenses: number;
  totalCostBasis: number;
  currentLandValue: number | null;
  gainLoss: number | null;
  returnPct: number | null;
}

export function computeCostBasisRows(
  companies: CompanyData[],
  allLoans: Loan[],
  taxGroups: TaxEntityGroup[],
  cumulativeInterestRows: CumulativeInterestRow[],
  operatingExpensesByCompany: Record<string, number>,
): CostBasisRow[] {
  return companies.map(c => {
    const landCost = c.property.landCost || 0;
    const improvements = c.property.improvements ?? 0;
    const taxGroup = taxGroups.find(g => g.entityName === c.name);
    const propertyTaxPaid = taxGroup?.totalPaid ?? 0;
    const interestPaidToDate = cumulativeInterestRows
      .filter(r => r.entityName === c.name)
      .reduce((s, r) => s + r.cumulativeInterest, 0);
    const operatingExpenses = operatingExpensesByCompany[c.id] ?? 0;
    const totalCostBasis = landCost + improvements + propertyTaxPaid + interestPaidToDate + operatingExpenses;
    const currentLandValue = resolveLandValue(c);
    const gainLoss = currentLandValue != null ? currentLandValue - totalCostBasis : null;
    const returnPct = gainLoss != null && totalCostBasis > 0 ? (gainLoss / totalCostBasis) * 100 : null;
    return {
      entityId: c.id, entityName: c.name, landCost, improvements, propertyTaxPaid,
      interestPaidToDate, operatingExpenses, totalCostBasis, currentLandValue, gainLoss, returnPct,
    };
  });
}

export interface BreakEvenResult {
  totalCostBasis: number;
  targetNetProceed: number;
  sellingCostsAmount: number;
  taxOnGainAmount: number;
  grossSalePriceNeeded: number;
  currentLandValue: number | null;
  gapAmount: number | null;
  gapPct: number | null;
}

export function computeBreakEven(
  costBasis: number,
  currentLandValue: number | null,
  targetReturnPct: number,
  sellingCostsPct: number,
  taxOnGainPct: number,
): BreakEvenResult {
  const targetNetProceed = costBasis * (1 + targetReturnPct / 100);
  const denom = 1 - sellingCostsPct / 100 - taxOnGainPct / 100;
  const grossSalePriceNeeded = denom > 0 ? targetNetProceed / denom : targetNetProceed;
  const sellingCostsAmount = grossSalePriceNeeded * (sellingCostsPct / 100);
  const taxOnGainAmount = grossSalePriceNeeded * (taxOnGainPct / 100);
  const gapAmount = currentLandValue != null ? currentLandValue - grossSalePriceNeeded : null;
  const gapPct = gapAmount != null && grossSalePriceNeeded > 0 ? (gapAmount / grossSalePriceNeeded) * 100 : null;
  return {
    totalCostBasis: costBasis,
    targetNetProceed,
    sellingCostsAmount,
    taxOnGainAmount,
    grossSalePriceNeeded,
    currentLandValue,
    gapAmount,
    gapPct,
  };
}

// ── Section 4: Tax & Carrying Cost Efficiency ──────────────────────────────────

export type CarryingEfficiency = 'Efficient' | 'Moderate' | 'High cost';

export function carryingEfficiencyFor(carryingPct: number): CarryingEfficiency {
  if (carryingPct < 2) return 'Efficient';
  if (carryingPct <= 4) return 'Moderate';
  return 'High cost';
}

export interface CarryingCostRow {
  entityId: string;
  entityName: string;
  landValue: number | null;
  annualTax: number;
  annualInterest: number;
  annualOperating: number;
  totalCarrying: number;
  carryingPct: number | null;
  yearsHeld: number | null;
  totalCarryingToDate: number | null;
  efficiencyScore: number;
}

export function computeCarryingCostRows(
  companies: CompanyData[],
  allLoans: Loan[],
  taxGroups: TaxEntityGroup[],
  operatingExpensesByCompany: Record<string, number>,
  costBasisRows: CostBasisRow[],
): CarryingCostRow[] {
  const active = allLoans.filter(isActivePropDevLoan);
  const carryingPctVals: number[] = [];

  const prelim = companies.map(c => {
    const landValue = resolveLandValue(c);
    const annualTax = taxGroups.find(g => g.entityName === c.name)?.totalTax
      ?? (c.property.propertyTaxAnnual || 0);
    const annualInterest = active
      .filter(l => l.companyId === c.id)
      .reduce((s, l) => s + (l.balance || 0) * ((l.interestRate || 0) / 100), 0);
    const annualOperating = operatingExpensesByCompany[c.id] ?? 0;
    const totalCarrying = annualTax + annualInterest + annualOperating;
    const carryingPct = landValue != null && landValue > 0 ? (totalCarrying / landValue) * 100 : null;
    if (carryingPct != null) carryingPctVals.push(carryingPct);
    const acquisitionDate = c.property.acquisitionDate ? new Date(c.property.acquisitionDate) : null;
    const yearsHeld = acquisitionDate && !Number.isNaN(acquisitionDate.getTime())
      ? (Date.now() - acquisitionDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
      : null;
    const totalCarryingToDate = yearsHeld != null ? totalCarrying * yearsHeld : null;
    return { c, landValue, annualTax, annualInterest, annualOperating, totalCarrying, carryingPct, yearsHeld, totalCarryingToDate };
  });

  const avgCarryingPct = carryingPctVals.length ? carryingPctVals.reduce((s, v) => s + v, 0) / carryingPctVals.length : null;

  return prelim.map(({ c, landValue, annualTax, annualInterest, annualOperating, totalCarrying, carryingPct, yearsHeld, totalCarryingToDate }) => {
    const cb = costBasisRows.find(r => r.entityId === c.id);
    let score = 60;
    if (carryingPct != null && avgCarryingPct != null && avgCarryingPct > 0) {
      score += (avgCarryingPct - carryingPct) / avgCarryingPct * 20;
    }
    if (cb?.returnPct != null) {
      score += Math.max(-20, Math.min(20, cb.returnPct / 2));
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      entityId: c.id, entityName: c.name, landValue, annualTax, annualInterest, annualOperating,
      totalCarrying, carryingPct, yearsHeld, totalCarryingToDate, efficiencyScore: score,
    };
  });
}
