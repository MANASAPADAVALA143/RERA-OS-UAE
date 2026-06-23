// 3-Level Break-Even Calculator for EstateCFO Property Dev

export interface BreakEvenInputs {
  landCost: number;
  hardCost: number;
  softCost: number;
  titleCharges: number;
  otherCharges: number;
  propertyTax: number;
  loanProcessing: number;
  professionalCharges: number;
  legalFees: number;
  interestOnLoan: number;
  managementFeeRate: number;   // e.g. 0.09
  commissionRate: number;      // e.g. 0.045
  commission?: number;         // explicit override
  totalLots: number;
  partnerCapital: number;
  preferredReturnRate: number; // e.g. 0.08
  loanAmount: number;
  loanRatePercent: number;     // e.g. 7.5
  loanTenureMonths: number;    // e.g. 24
}

export interface BreakEvenResult {
  // Cost components
  directCosts: number;
  managementFee: number;
  commissionAmount: number;

  // Level 1 — Basic (direct costs + mgmt fee + commission)
  basicTotalCost: number;
  basicBreakEven: number;

  // Level 2 — Capitalised (+ financing interest)
  totalInterestCapitalised: number;
  capitalisedTotalCost: number;
  capitalisedBreakEven: number;

  // Level 3 — Partnership (+ preferred return)
  minPartnerReturn: number;
  partnershipTotalCost: number;
  partnershipBreakEven: number;

  // Per-unit
  costPerLot: number;
}

export function calculateBreakEven(inputs: BreakEvenInputs): BreakEvenResult {
  const {
    landCost, hardCost, softCost, titleCharges, otherCharges,
    propertyTax, loanProcessing, professionalCharges, legalFees, interestOnLoan,
    managementFeeRate, commissionRate, commission,
    totalLots, partnerCapital, preferredReturnRate,
    loanAmount, loanRatePercent, loanTenureMonths,
  } = inputs;

  const n = Math.max(1, totalLots);

  // Direct costs (everything except mgmt fee and commission)
  const directCosts = landCost + hardCost + softCost + titleCharges + otherCharges
    + propertyTax + loanProcessing + professionalCharges + legalFees + interestOnLoan;

  // Management fee: 9% of land cost per Note 4
  const managementFee = landCost * managementFeeRate;

  // Commission: explicit amount or rate × (directCosts / n) × n ≈ rate × totalRevenue
  // We use it as a fixed known amount when provided, else estimate from rate
  const commissionAmount = commission ?? (directCosts * commissionRate);

  // ── Level 1 ──────────────────────────────────────────────────────────────────
  const basicTotalCost = directCosts + managementFee + commissionAmount;
  const basicBreakEven = basicTotalCost / n;

  // ── Level 2 — Capitalised (add full tenure interest) ─────────────────────────
  // Interest already in directCosts (interestOnLoan), but add loan amortisation interest
  const monthlyRate = loanRatePercent / 100 / 12;
  const totalInterestCapitalised = monthlyRate > 0 && loanTenureMonths > 0
    ? loanAmount * monthlyRate * loanTenureMonths
    : 0;
  const capitalisedTotalCost = basicTotalCost + totalInterestCapitalised;
  const capitalisedBreakEven = capitalisedTotalCost / n;

  // ── Level 3 — Partnership (add preferred return) ──────────────────────────────
  const minPartnerReturn = partnerCapital * preferredReturnRate;
  const partnershipTotalCost = capitalisedTotalCost + minPartnerReturn;
  const partnershipBreakEven = partnershipTotalCost / n;

  return {
    directCosts,
    managementFee,
    commissionAmount,
    basicTotalCost,
    basicBreakEven,
    totalInterestCapitalised,
    capitalisedTotalCost,
    capitalisedBreakEven,
    minPartnerReturn,
    partnershipTotalCost,
    partnershipBreakEven,
    costPerLot: directCosts / n,
  };
}

export type ZoneType = 'DANGER' | 'RISK' | 'CAUTION' | 'PROFIT';

export interface Zone {
  zone: ZoneType;
  color: 'red' | 'orange' | 'amber' | 'green';
  label: string;
  message: string;
}

export function getZone(salePrice: number, be: BreakEvenResult): Zone {
  if (salePrice < be.basicBreakEven)
    return { zone: 'DANGER', color: 'red',    label: '🔴 Danger',  message: 'Below cost — selling at a loss' };
  if (salePrice < be.capitalisedBreakEven)
    return { zone: 'RISK',   color: 'orange', label: '🟠 Risk',    message: 'Covers direct cost but not financing' };
  if (salePrice < be.partnershipBreakEven)
    return { zone: 'CAUTION',color: 'amber',  label: '🟡 Caution', message: 'Covers financing but not partner return' };
  return   { zone: 'PROFIT', color: 'green',  label: '🟢 Profit',  message: 'Covers all costs + partner return' };
}
