import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Period } from '../utils/periodWindow';
import api from '../services/api';
import { PROPDEV_COMPANIES_REFRESH } from '../utils/propDevSync';
import { normalizeInterestRatePercent } from '../utils/propDevLoanMetrics';
import { partnerShareOfProfitFromAnnualPL } from '../utils/propDevPartnerProfit';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Lot {
  id: string; companyId: string;
  lotNo: string; block: string;
  sizeSqft: number; sizeAcres: number;
  listPrice: number; salePrice: number | null;
  status: 'available' | 'reserved' | 'contracted' | 'sold' | 'cancelled' | 'legal_pending';
  buyerName: string | null; contractDate: string | null; closeDate: string | null;
  landCost: number; devCost: number;
}
export interface Partner {
  id: string; companyId: string; name: string; type: 'Class A' | 'Class B';
  sharePercent: number; capitalContributed: number; distributionsReceived: number;
  /** True when import estimated capital as Cost Basis − Existing Debt. */
  capitalContributedEstimated?: boolean;
  /** Total committed capital (uncalled = committedCapital − capitalContributed). Optional — not yet in API. */
  committedCapital?: number;
  shareOfProfit: number; preferredReturn: number; status: 'Active' | 'Exited';
  entityName?: string;
  propertyName?: string;
  propertyAddress?: string;
  entityLine?: string;
  costBasis?: number;
  bookValue?: number;
  fairMarketValue?: number;
  existingDebt?: number;
}
export interface Loan {
  id: string; companyId: string; company: string; property: string;
  bank: string; loanDate: string; accountNo: string;
  amount: number; balance: number; interestRate: number; emi: number;
  maturityDate: string; emiDate: number;
  lenderName: string; lenderEmail: string; lenderPhone: string;
  status: 'Active' | 'Paid Off' | 'In Default';
  insuranceExpiryDate?: string | null;
  refinancingStatus?: string | null;
  refinancingNotes?: string | null;
  loanPurpose?: string | null;
  maturityChecklist?: Record<string, boolean> | null;
}
export interface CapitalCall {
  id: string; companyId: string; period: string; partnerId: string; partnerName: string;
  sharePercent: number; totalCallAmount: number; partnerShare: number;
  oldDues: number; totalDue: number; received: number;
  receivedDate: string | null; dueDate?: string;
  status: 'Paid' | 'Partial' | 'Outstanding' | 'Overdue';
  /** 'manual' (Excel import / hand-entered), 'lot_reinvestment', or 'unrealised_loss' (both auto-generated). */
  sourceType: 'manual' | 'lot_reinvestment' | 'unrealised_loss';
  /** propdev_lot_reinvestments id when sourceType is 'lot_reinvestment'; null for 'unrealised_loss' (no source row, just the entity + reason text). */
  sourceId: string | null;
  reason: string | null;
}
export interface Customer {
  id: string; companyId: string; name: string; lotNo: string;
  contractValue: number; collected: number; lastPaymentDate: string | null;
  installments: { dueDate: string; amount: number; status: 'paid' | 'pending' | 'overdue' | 'bounced' }[];
}
export interface ComplianceDoc {
  id: string; companyId: string; type: string; property: string; counterparty: string;
  issueDate: string; expiryDate: string | null;
  status: 'Valid' | 'Expiring Soon' | 'Expired' | 'Missing' | 'Pending';
  fileUrl: string | null;
}
export interface DevExpense { particulars: string; amount: number; category: string; }
export interface YearlyPL {
  net_income: number;
  total_expenses: number;
  revenue: number;
  other_income?: number;
  expenses_by_category?: Record<string, number>;
}
export interface YearlyBS  { cash: number; land: number; improvements: number; interest_capitalised: number; total_assets: number; loan_balance: number; total_liabilities: number; }
export interface YearlyCF  { operating: number; investing: number; financing: number; net_change: number; partner_investments?: number; }

export interface Property {
  id: string; companyId: string; name: string; address: string;
  totalLots: number; totalAcres: number; saleConsideration: number;
  landCost: number; hardCost: number; softCost: number; titleCharges: number;
  otherCharges: number; propertyTax: number; loanProcessing: number;
  professionalCharges: number; legalFees: number; interestOnLoan: number;
  managementFeeRate: number; commissionRate: number;
  commission?: number;  // explicit commission amount; overrides commissionRate when set
  cashAvailable: number;
  interestCapitalised?: number;
  improvements?: number;
  yearlyPL?: Record<string, YearlyPL>;
  yearlyBS?: Record<string, YearlyBS>;
  yearlyCF?: Record<string, YearlyCF>;
  monthlyData: { month: string; lotsSold: number; revenue: number }[];
  // Property Profile — identity
  city?: string | null; state?: string | null; zipCode?: string | null;
  county?: string | null; legalDescription?: string | null;
  // Property Profile — land details
  landUseType?: string | null; zoning?: string | null; currentStatus?: string | null;
  // Property Profile — ownership history
  previousOwnerName?: string | null; previousOwnerEntity?: string | null;
  acquisitionDate?: string | null; acquisitionPrice?: number | null;
  acquisitionType?: string | null; titleCompany?: string | null; deedReference?: string | null;
  // Property Profile — tax information
  taxParcelId?: string | null; propertyTaxAnnual?: number | null;
  taxAssessmentYear?: number | null; taxAssessedValue?: number | null;
  taxExemptions?: string | null; taxDueDate?: string | null;
}
export interface PropertyImprovement {
  id: string; companyId: string;
  improvementType: string; improvementCost: number;
  improvementDate: string | null; contractorName: string | null; notes: string | null;
}
export interface CompanyData {
  id: string; name: string;
  property: Property; lots: Lot[]; partners: Partner[]; loans: Loan[];
  capitalCalls: CapitalCall[]; customers: Customer[];
  docs: ComplianceDoc[]; expenses: DevExpense[];
  propertyImprovements: PropertyImprovement[];
}

// ── Data Factory ───────────────────────────────────────────────────────────────

const BUYERS: string[] = [];
const MONTHS = ['Jan 25','Feb 25','Mar 25','Apr 25','May 25','Jun 25'];

function makeLots(companyId: string, cfg: CompanyCfg): Lot[] {
  const { landCost, saleConsideration, soldCount, contractedCount } = cfg;
  const status: Lot['status'] = soldCount > 0 ? 'sold' : contractedCount > 0 ? 'contracted' : 'available';
  const listPrice = Math.round(saleConsideration || landCost);
  const salePrice = status === 'sold' ? listPrice : status === 'contracted' ? listPrice : null;
  const hasBuyer = status === 'sold' || status === 'contracted';
  return [{
    id: `${companyId}-lot-1`, companyId,
    lotNo: 'Property',
    block: '—',
    sizeSqft: Math.round((cfg.totalAcres || 1) * 43560),
    sizeAcres: cfg.totalAcres || 1,
    listPrice, salePrice, status,
    buyerName: hasBuyer ? BUYERS[0] ?? null : null,
    contractDate: hasBuyer ? '2025-03-15' : null,
    closeDate: status === 'sold' ? '2025-05-20' : null,
    landCost,
    devCost: landCost * 0.15,
  }];
}

function makePartners(companyId: string, configs: { name: string; pct: number; capital: number }[]): Partner[] {
  return configs.map((c, i) => ({
    id: `${companyId}-p${i + 1}`, companyId,
    name: c.name, type: (i === 0 ? 'Class B' : 'Class A') as Partner['type'],
    sharePercent: c.pct, capitalContributed: c.capital,
    distributionsReceived: i === 0 ? Math.round(c.capital * 0.08) : 0,
    shareOfProfit: Math.round(c.capital * (0.18 + i * 0.03)),
    preferredReturn: i === 0 ? 6 : 8, status: 'Active',
  }));
}

function makeLoans(companyId: string, companyName: string, propName: string, cfgs: { bank: string; amount: number; rate: number }[]): Loan[] {
  return cfgs.map((c, i) => ({
    id: `${companyId}-ln${i + 1}`, companyId,
    company: companyName, property: propName,
    bank: c.bank, loanDate: '2024-01-15',
    accountNo: `${c.bank.substring(0, 3).toUpperCase()}-2024-00${i + 1}`,
    amount: c.amount, balance: Math.round(c.amount * 0.82),
    interestRate: c.rate, emi: Math.round(c.amount * 0.012),
    maturityDate: '2026-06-15', emiDate: 15,
    lenderName: `Loan Officer ${i + 1}`,
    lenderEmail: `officer${i + 1}@${c.bank.toLowerCase().replace(/\s/g, '')}.com`,
    lenderPhone: `(214) 555-0${100 + i * 11}`,
    status: 'Active',
  }));
}

function makeCapitalCalls(companyId: string, partners: Partner[], totalExpenses: number): CapitalCall[] {
  return partners.map((p, i) => {
    const partnerShare = Math.round((p.sharePercent / 100) * totalExpenses);
    const received = i === 0 ? partnerShare : i === 1 ? partnerShare : i === 2 ? Math.round(partnerShare * 0.6) : 0;
    const status: CapitalCall['status'] = received >= partnerShare ? 'Paid'
      : received > 0 ? 'Partial' : i === 3 ? 'Overdue' : 'Outstanding';
    return {
      id: `${companyId}-cc${i + 1}`, companyId,
      period: 'Jan–Jun 2025', partnerId: p.id, partnerName: p.name,
      sharePercent: p.sharePercent, totalCallAmount: totalExpenses,
      partnerShare, oldDues: 0, totalDue: partnerShare,
      received, receivedDate: received > 0 ? '2025-02-10' : null, status,
    };
  });
}

function makeCustomers(companyId: string, lots: Lot[]): Customer[] {
  return lots.filter(l => l.status !== 'available' && l.status !== 'cancelled').slice(0, 5).map((l, i) => {
    const contractValue = l.salePrice ?? l.listPrice;
    const collected = i < 2 ? contractValue : i === 2 ? Math.round(contractValue * 0.66) : Math.round(contractValue * 0.33);
    return {
      id: `${companyId}-cust${i + 1}`, companyId,
      name: l.buyerName ?? `Buyer ${i + 1}`, lotNo: l.lotNo,
      contractValue, collected, lastPaymentDate: collected > 0 ? '2025-04-15' : null,
      installments: [
        { dueDate: '2025-03-01', amount: Math.round(contractValue * 0.33), status: 'paid' as const },
        { dueDate: '2025-04-15', amount: Math.round(contractValue * 0.33), status: collected >= contractValue * 0.66 ? 'paid' as const : i % 2 === 0 ? 'overdue' as const : 'pending' as const },
        { dueDate: '2025-06-30', amount: contractValue - Math.round(contractValue * 0.66), status: 'pending' as const },
      ],
    };
  });
}

function makeDocs(companyId: string, propName: string, bank: string): ComplianceDoc[] {
  const types = [
    { type: 'Title Document', party: 'County Clerk', status: 'Valid' as const, expiry: null },
    { type: 'Plot Approval', party: 'City Planning Dept', status: 'Valid' as const, expiry: '2026-08-01' },
    { type: 'Loan Agreement', party: bank, status: 'Valid' as const, expiry: '2026-06-15' },
    { type: 'Partner Agreement', party: 'All Partners', status: 'Valid' as const, expiry: '2027-01-01' },
    { type: 'Insurance Certificate', party: 'State Farm', status: 'Valid' as const, expiry: '2026-01-01' },
    { type: 'NOC - Water', party: 'Water Authority', status: 'Expiring Soon' as const, expiry: '2025-07-30' },
    { type: 'Tax Certificate', party: 'County CAD', status: 'Missing' as const, expiry: null },
    { type: 'Legal Opinion', party: 'Law Firm LLC', status: 'Expired' as const, expiry: '2025-05-01' },
  ];
  return types.map((t, i) => ({
    id: `${companyId}-doc${i + 1}`, companyId,
    type: t.type, property: propName, counterparty: t.party,
    issueDate: '2024-01-15', expiryDate: t.expiry,
    status: t.status, fileUrl: null,
  }));
}

function makeExpenses(emi: number): DevExpense[] {
  return [
    { particulars: 'Monthly Loan EMI', amount: emi, category: 'Debt Service' },
    { particulars: 'Property Tax (6 months)', amount: Math.round(emi * 0.246), category: 'Tax' },
    { particulars: 'Book Keeping Charges', amount: 750, category: 'Admin' },
    { particulars: 'Professional Fee', amount: 1000, category: 'Admin' },
    { particulars: 'Bank Charges', amount: 100, category: 'Admin' },
    { particulars: 'Membership Fee', amount: 400, category: 'Admin' },
    { particulars: 'Misc Expenses', amount: 1200, category: 'Admin' },
  ];
}

// ── Company Configurations ─────────────────────────────────────────────────────

interface CompanyCfg {
  id: string; name: string; address: string;
  totalLots: number; totalAcres: number;
  landCost: number; saleConsideration: number;
  hardCost: number; softCost: number;
  soldCount: number; contractedCount: number;
  cashAvailable: number;
  partners: { name: string; pct: number; capital: number }[];
  loans: { bank: string; amount: number; rate: number }[];
  // Optional explicit expense overrides (if omitted, formulas are used)
  titleCharges?: number;
  otherCharges?: number;
  propertyTax?: number;
  loanProcessing?: number;
  professionalCharges?: number;
  legalFees?: number;
  interestOnLoan?: number;
  commission?: number;       // explicit commission amount; overrides commissionRate formula
  managementFeeRate?: number; // default 0.09 (9% of land cost per Note 4)
  commissionRate?: number;    // only used when commission is not explicit
}

const COMPANY_CONFIGS: CompanyCfg[] = [];

// ── Empty company factory (used when importing from Excel) ─────────────────────

export function createEmptyCompany(id: string, name: string): CompanyData {
  const property: Property = {
    id: `${id}-prop`, companyId: id,
    name, address: '',
    totalLots: 0, totalAcres: 0, saleConsideration: 0,
    landCost: 0, hardCost: 0, softCost: 0,
    titleCharges: 0, otherCharges: 0, propertyTax: 0,
    loanProcessing: 0, professionalCharges: 0, legalFees: 0, interestOnLoan: 0,
    managementFeeRate: 0.09, commissionRate: 0.045,
    cashAvailable: 0, monthlyData: [],
  };
  return {
    id, name, property,
    lots: [], partners: [], loans: [], capitalCalls: [], customers: [], docs: [], expenses: [],
    propertyImprovements: [],
  };
}

// ── Build companies from configs ───────────────────────────────────────────────

function buildCompany(cfg: CompanyCfg): CompanyData {
  const lots = makeLots(cfg.id, cfg);
  const partners = makePartners(cfg.id, cfg.partners);
  const loans = makeLoans(cfg.id, cfg.name, cfg.name.split(' ')[0] + ' Property', cfg.loans);
  const totalMonthlyEMI = loans.reduce((s, l) => s + l.emi, 0);
  const totalExpenses = totalMonthlyEMI * 6 + cfg.propertyTax || (totalMonthlyEMI * 7.46);
  const capitalCalls = makeCapitalCalls(cfg.id, partners, Math.round(totalMonthlyEMI * 1.246));
  const customers = makeCustomers(cfg.id, lots);
  const docs = makeDocs(cfg.id, cfg.name, cfg.loans[0].bank);
  const expenses = makeExpenses(totalMonthlyEMI);

  const property: Property = {
    id: `${cfg.id}-prop`, companyId: cfg.id,
    name: cfg.name, address: cfg.address,
    totalLots: cfg.totalLots, totalAcres: cfg.totalAcres,
    saleConsideration: cfg.saleConsideration, landCost: cfg.landCost,
    hardCost: cfg.hardCost, softCost: cfg.softCost,
    titleCharges:         cfg.titleCharges         ?? Math.round(cfg.saleConsideration * 0.005),
    otherCharges:         cfg.otherCharges         ?? Math.round(cfg.saleConsideration * 0.002),
    propertyTax:          cfg.propertyTax          ?? Math.round(totalMonthlyEMI * 0.246),
    loanProcessing:       cfg.loanProcessing       ?? Math.round(loans[0].amount * 0.008),
    professionalCharges:  cfg.professionalCharges  ?? 9000,
    legalFees:            cfg.legalFees            ?? 15000,
    interestOnLoan:       cfg.interestOnLoan       ?? totalMonthlyEMI * 6,
    managementFeeRate:    cfg.managementFeeRate    ?? 0.09,
    // commissionRate encodes explicit amount as negative sentinel; PD02 reads commission field directly
    commissionRate:       cfg.commissionRate       ?? 0.045,
    commission:           cfg.commission,   // explicit override; undefined = use commissionRate
    cashAvailable: cfg.cashAvailable,
    monthlyData: MONTHS.map((month, i) => {
      const soldPerMonth = Math.ceil(cfg.soldCount / 6);
      const lotsSold = i < cfg.soldCount % 6 ? soldPerMonth : soldPerMonth - 1;
      return { month, lotsSold: Math.max(1, lotsSold), revenue: Math.round((cfg.saleConsideration / cfg.totalLots) * Math.max(1, lotsSold)) };
    }),
  };

  return { id: cfg.id, name: cfg.name, property, lots, partners, loans, capitalCalls, customers, docs, expenses };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCompanySafe(cfg: any): CompanyData {
  return buildCompany(cfg as CompanyCfg);
}

const ALL_COMPANIES: CompanyData[] = COMPANY_CONFIGS.map(buildCompanySafe);

// ── Aggregation helpers ────────────────────────────────────────────────────────

function aggregateYearly<K extends string>(
  companies: CompanyData[],
  propKey: 'yearlyBS' | 'yearlyPL' | 'yearlyCF',
  keys: K[],
): Record<string, Record<K, number>> | undefined {
  const years = new Set<string>();
  companies.forEach(c => {
    const data = c.property[propKey];
    if (data) Object.keys(data).forEach(y => years.add(y));
  });
  if (years.size === 0) return undefined;

  const out: Record<string, Record<K, number>> = {};
  [...years].sort().forEach(year => {
    const row = {} as Record<K, number>;
    keys.forEach(key => {
      row[key] = companies.reduce((sum, c) => {
        const yr = c.property[propKey]?.[year] as Record<string, number> | undefined;
        return sum + (Number(yr?.[key]) || 0);
      }, 0);
    });
    out[year] = row;
  });
  return out;
}

function aggregateProperty(companies: CompanyData[]): Property {
  if (companies.length === 0) {
    return createEmptyCompany('consolidated', 'All Companies (Portfolio)').property;
  }
  const total = companies.reduce(
    (acc, c) => {
      const p = c.property;
      return {
        totalLots: acc.totalLots + p.totalLots,
        totalAcres: acc.totalAcres + p.totalAcres,
        saleConsideration: acc.saleConsideration + p.saleConsideration,
        landCost: acc.landCost + p.landCost,
        hardCost: acc.hardCost + p.hardCost,
        softCost: acc.softCost + p.softCost,
        titleCharges: acc.titleCharges + p.titleCharges,
        otherCharges: acc.otherCharges + p.otherCharges,
        propertyTax: acc.propertyTax + p.propertyTax,
        loanProcessing: acc.loanProcessing + p.loanProcessing,
        professionalCharges: acc.professionalCharges + p.professionalCharges,
        legalFees: acc.legalFees + p.legalFees,
        interestOnLoan: acc.interestOnLoan + p.interestOnLoan,
        cashAvailable: acc.cashAvailable + p.cashAvailable,
        improvements: acc.improvements + (p.improvements ?? 0),
        interestCapitalised: acc.interestCapitalised + (p.interestCapitalised ?? 0),
      };
    },
    { totalLots: 0, totalAcres: 0, saleConsideration: 0, landCost: 0, hardCost: 0, softCost: 0,
      titleCharges: 0, otherCharges: 0, propertyTax: 0, loanProcessing: 0,
      professionalCharges: 0, legalFees: 0, interestOnLoan: 0, cashAvailable: 0,
      improvements: 0, interestCapitalised: 0 }
  );

  const monthlyMap: Record<string, { lotsSold: number; revenue: number }> = {};
  companies.forEach(c => c.property.monthlyData.forEach(m => {
    if (!monthlyMap[m.month]) monthlyMap[m.month] = { lotsSold: 0, revenue: 0 };
    monthlyMap[m.month].lotsSold += m.lotsSold;
    monthlyMap[m.month].revenue += m.revenue;
  }));

  return {
    id: 'consolidated', companyId: 'all',
    name: 'All Companies (Portfolio)', address: 'Texas, USA',
    managementFeeRate: 0.09, commissionRate: 0.045,
    monthlyData: Object.entries(monthlyMap).map(([month, v]) => ({ month, ...v })),
    yearlyBS: aggregateYearly(companies, 'yearlyBS', [
      'cash', 'land', 'improvements', 'interest_capitalised', 'total_assets', 'loan_balance', 'total_liabilities',
    ]) as Record<string, YearlyBS> | undefined,
    yearlyPL: aggregateYearly(companies, 'yearlyPL', [
      'net_income', 'total_expenses', 'revenue', 'other_income',
    ]) as Record<string, YearlyPL> | undefined,
    yearlyCF: aggregateYearly(companies, 'yearlyCF', [
      'operating', 'investing', 'financing', 'net_change',
    ]) as Record<string, YearlyCF> | undefined,
    ...total,
  };
}

// ── Upload History ─────────────────────────────────────────────────────────────

export interface UploadRecord {
  id: string;
  companyId: string;
  companyName: string;
  fileName: string;
  uploadDate: string;   // ISO string
  sheetsImported: string[];
}

// ── Context ────────────────────────────────────────────────────────────────────

interface PropertyDevState {
  companies: CompanyData[];
  selectedCompanyId: string;
  setSelectedCompanyId: (id: string) => void;

  // Derived (single company or aggregated)
  properties: Property[];
  lots: Lot[];
  partners: Partner[];
  loans: Loan[];
  capitalCalls: CapitalCall[];
  customers: Customer[];
  docs: ComplianceDoc[];
  expenses: DevExpense[];
  isConsolidated: boolean;

  // Upload history (all companies)
  uploadHistory: UploadRecord[];
  addUploadRecord: (rec: Omit<UploadRecord, 'id'>) => void;

  // Mutators — operate on selected company only
  setLots: (lots: Lot[]) => void;
  setDocs: (docs: ComplianceDoc[]) => void;
  setCapitalCalls: (calls: CapitalCall[]) => void;
  setLoans: (loans: Loan[]) => void;
  setPartners: (partners: Partner[]) => void;
  setProperty: (property: Property) => void;
  setCompanies: (companies: CompanyData[]) => void;
  refetchCompanies: () => Promise<void>;
  /** Load yearly_pl/bs/cf for one company (omitted from the default list for speed). */
  ensureCompanyYearly: (companyId: string) => Promise<'cached' | 'loaded' | 'empty' | 'error'>;

  /** Shared Month / YTD / YoY anchor — Command Strip + Financials. */
  financialPeriod: Period | null;
  financialMonth: number;
  financialYear: number;
  financialSelectedYear: number;
  setFinancialPeriodAnchor: (period: Period | null, month: number, year: number) => void;
  setFinancialSelectedYear: (year: number) => void;
}

const Ctx = createContext<PropertyDevState | null>(null);

const STORAGE_KEY = 'estatecfo_propdev_v1';

function loadPersisted(): { uploadHistory: UploadRecord[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { uploadHistory?: UploadRecord[] };
      return {
        uploadHistory: Array.isArray(parsed.uploadHistory) ? parsed.uploadHistory : [],
      };
    }
  } catch { /* ignore corrupt storage */ }
  return { uploadHistory: [] };
}

function mapApiCompanies(data: { companies: unknown[] }): CompanyData[] {
  return data.companies.map((c: any) => {
    const yearlyPL = c.yearly_pl as Record<string, YearlyPL> | undefined;
    const property: Property = {
      id: c.id + '-prop',
      companyId: c.id,
      name: c.property_name,
      address: c.address,
      totalLots: Math.min(1, c.total_lots || (c.lots?.length ? 1 : 0)),
      totalAcres: c.total_acres,
      saleConsideration: c.sale_consideration,
      landCost: c.land_cost,
      hardCost: c.hard_cost,
      softCost: c.soft_cost,
      titleCharges: c.title_charges,
      otherCharges: c.other_charges,
      propertyTax: c.property_tax,
      loanProcessing: c.loan_processing,
      professionalCharges: c.professional_charges,
      legalFees: c.legal_fees,
      interestOnLoan: c.interest_on_loan,
      managementFeeRate: c.management_fee_rate,
      commissionRate: c.commission_rate,
      commission: c.commission,
      cashAvailable: c.cash_available,
      interestCapitalised: c.interest_capitalised ?? 0,
      improvements: c.improvements ?? 0,
      city: c.city ?? null,
      state: c.state ?? null,
      zipCode: c.zip_code ?? null,
      county: c.county ?? null,
      legalDescription: c.legal_description ?? null,
      landUseType: c.land_use_type ?? null,
      zoning: c.zoning ?? null,
      currentStatus: c.current_status ?? null,
      previousOwnerName: c.previous_owner_name ?? null,
      previousOwnerEntity: c.previous_owner_entity ?? null,
      acquisitionDate: c.acquisition_date ?? null,
      acquisitionPrice: c.acquisition_price ?? null,
      acquisitionType: c.acquisition_type ?? null,
      titleCompany: c.title_company ?? null,
      deedReference: c.deed_reference ?? null,
      taxParcelId: c.tax_parcel_id ?? null,
      propertyTaxAnnual: c.property_tax_annual ?? null,
      taxAssessmentYear: c.tax_assessment_year ?? null,
      taxAssessedValue: c.tax_assessed_value ?? null,
      taxExemptions: c.tax_exemptions ?? null,
      taxDueDate: c.tax_due_date ?? null,
      yearlyPL: yearlyPL ?? undefined,
      yearlyBS: c.yearly_bs ?? undefined,
      yearlyCF: c.yearly_cf ?? undefined,
      monthlyData: (() => {
        const map: Record<string, { lotsSold: number; revenue: number }> = {};
        (c.lots || []).forEach((l: any) => {
          if (l.close_date && l.sale_price) {
            const d = new Date(l.close_date);
            const key = d.toLocaleString('default', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2);
            if (!map[key]) map[key] = { lotsSold: 0, revenue: 0 };
            map[key].lotsSold += 1;
            map[key].revenue += l.sale_price;
          }
        });
        return Object.entries(map)
          .sort((a, b) => new Date('1 ' + a[0]).getTime() - new Date('1 ' + b[0]).getTime())
          .map(([month, v]) => ({ month, ...v }));
      })(),
    };
    const companyForProfit: CompanyData = {
      id: c.id,
      name: c.name,
      property,
      lots: [],
      partners: [],
      loans: [],
      capitalCalls: [],
      customers: [],
      docs: [],
      expenses: [],
      propertyImprovements: [],
    };
    return {
    id: c.id,
    name: c.name,
    property,
    lots: (c.lots || []).slice(0, 1).map((l: any) => ({
      id: l.id,
      companyId: c.id,
      lotNo: l.lot_no,
      block: l.block,
      sizeSqft: l.size_sqft,
      sizeAcres: l.size_sqft / 43560,
      listPrice: l.list_price,
      salePrice: l.sale_price,
      status: l.status,
      buyerName: l.buyer_name,
      contractDate: l.contract_date,
      closeDate: l.close_date,
      landCost: 0,
      devCost: 0,
    })),
    partners: (c.partners || []).map((p: any) => {
      const sharePercent = Number(p.share_percent) > 1 ? Number(p.share_percent) : Number(p.share_percent) * 100;
      return {
      id: p.id,
      companyId: c.id,
      name: p.name,
      type: p.type,
      sharePercent,
      capitalContributed: p.capital_contributed,
      capitalContributedEstimated: Boolean(p.capital_contributed_estimated),
      committedCapital: p.committed_capital != null ? Number(p.committed_capital) : undefined,
      distributionsReceived: p.distributions_received,
      shareOfProfit: Math.round(partnerShareOfProfitFromAnnualPL(companyForProfit, sharePercent)),
      preferredReturn: Number(p.preferred_return) > 1 ? Number(p.preferred_return) : Number(p.preferred_return) * 100,
      status: p.status,
      entityName: p.entity_name ?? undefined,
      propertyName: p.property_name ?? undefined,
      propertyAddress: p.property_address ?? undefined,
      entityLine: p.entity_line ?? undefined,
      costBasis: p.cost_basis != null ? Number(p.cost_basis) : undefined,
      bookValue: p.book_value != null ? Number(p.book_value) : undefined,
      fairMarketValue: p.fair_market_value != null ? Number(p.fair_market_value) : undefined,
      existingDebt: p.existing_debt != null ? Number(p.existing_debt) : undefined,
    };
    }),
    loans: (c.loans || []).map((ln: any) => ({
      id: ln.id,
      companyId: c.id,
      company: c.name,
      // Prefer per-loan Property Name from Bank Loan Information Excel; fall back to company registry.
      property: (ln.property_name || c.property_name || c.name || '').trim(),
      bank: ln.bank,
      loanDate: ln.loan_date || '2023-01-15',
      accountNo: ln.account_no || '',
      amount: ln.loan_amount,
      balance: ln.balance,
      interestRate: normalizeInterestRatePercent(ln.interest_rate),
      emi: ln.emi,
      maturityDate: ln.maturity_date,
      emiDate: ln.emi_day || 15,
      lenderName: ln.lender_name || '',
      lenderEmail: ln.lender_email || '',
      lenderPhone: ln.lender_phone || '',
      status: (ln.emi_status === 'Paid Off' ? 'Paid Off' : ln.emi_status === 'In Default' ? 'In Default' : 'Active') as 'Active' | 'Paid Off' | 'In Default',
      insuranceExpiryDate: ln.insurance_expiry_date ?? null,
      refinancingStatus: ln.refinancing_status ?? 'Not Started',
      refinancingNotes: ln.refinancing_notes ?? null,
      loanPurpose: ln.loan_purpose ?? null,
      maturityChecklist: ln.maturity_checklist ?? null,
    })),
    capitalCalls: (c.capital_calls || []).map((cc: any) => ({
      id: cc.id,
      companyId: c.id,
      period: cc.period || 'Imported Capital Call',
      partnerId: cc.partner_id || '',
      partnerName: cc.partner_name,
      sharePercent: cc.share_percent > 1 ? cc.share_percent : cc.share_percent * 100,
      totalCallAmount: cc.total_call_amount,
      partnerShare: cc.partner_share,
      oldDues: cc.old_dues ?? 0,
      totalDue: cc.total_due ?? cc.partner_share,
      received: cc.amount_received,
      receivedDate: cc.received_date ?? null,
      dueDate: cc.due_date ?? undefined,
      status: cc.status,
      sourceType: cc.source_type ?? 'manual',
      sourceId: cc.source_id ?? null,
      reason: cc.reason ?? null,
    })),
    customers: [],
    docs: [],
    expenses: (c.expenses || []).map((e: any) => ({
      particulars: e.expense_type,
      amount: e.amount,
      category: e.category,
    })),
    propertyImprovements: (c.property_improvements || []).map((i: any) => ({
      id: i.id,
      companyId: c.id,
      improvementType: i.improvement_type,
      improvementCost: i.improvement_cost ?? 0,
      improvementDate: i.improvement_date ?? null,
      contractorName: i.contractor_name ?? null,
      notes: i.notes ?? null,
    })),
  };
  });
}

export function PropertyDevProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [financialPeriod, setFinancialPeriod] = useState<Period | null>(null);
  const [financialMonth, setFinancialMonth] = useState(now.getMonth() + 1);
  const [financialYear, setFinancialYear] = useState(now.getFullYear());
  const [financialSelectedYear, setFinancialSelectedYear] = useState(now.getFullYear());
  const [companiesState, setCompaniesState] = useState<CompanyData[]>([]);
  const companiesRef = useRef(companiesState);
  companiesRef.current = companiesState;
  const [uploadHistory, setUploadHistory] = useState<UploadRecord[]>(() => loadPersisted().uploadHistory);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uploadHistory }));
  }, [uploadHistory]);

  const refetchCompanies = useCallback(async () => {
    try {
      const res = await api.get('/api/propdev/companies', {
        params: { include_financials: false },
        timeout: 45_000,
      });
      if (res.status === 200 && res.data?.companies) {
        setCompaniesState(mapApiCompanies(res.data));
      }
    } catch (e) {
      console.error('Failed to fetch companies:', e);
    }
  }, []);

  const ensureCompanyYearly = useCallback(async (companyId: string): Promise<'cached' | 'loaded' | 'empty' | 'error'> => {
    const existing = companiesRef.current.find(x => x.id === companyId);
    if (
      existing?.property.yearlyPL && Object.keys(existing.property.yearlyPL).length
      || existing?.property.yearlyBS && Object.keys(existing.property.yearlyBS).length
      || existing?.property.yearlyCF && Object.keys(existing.property.yearlyCF).length
    ) {
      return 'cached';
    }

    try {
      const res = await api.get(`/api/propdev/companies/${companyId}/yearly`, { timeout: 60_000 });
      const { yearly_pl, yearly_bs, yearly_cf } = res.data as {
        yearly_pl?: Record<string, YearlyPL>;
        yearly_bs?: Record<string, YearlyBS>;
        yearly_cf?: Record<string, YearlyCF>;
      };
      const hasData = Boolean(
        (yearly_pl && Object.keys(yearly_pl).length)
        || (yearly_bs && Object.keys(yearly_bs).length)
        || (yearly_cf && Object.keys(yearly_cf).length),
      );

      if (!hasData) return 'empty';

      setCompaniesState(prev => {
        const c = prev.find(x => x.id === companyId);
        if (!c) return prev;
        const property = {
          ...c.property,
          yearlyPL: yearly_pl ?? c.property.yearlyPL,
          yearlyBS: yearly_bs ?? c.property.yearlyBS,
          yearlyCF: yearly_cf ?? c.property.yearlyCF,
        };
        const companyForProfit: CompanyData = { ...c, property };
        return prev.map(co => co.id !== companyId ? co : {
          ...co,
          property,
          partners: co.partners.map(p => ({
            ...p,
            shareOfProfit: Math.round(partnerShareOfProfitFromAnnualPL(companyForProfit, p.sharePercent)),
          })),
        });
      });
      return 'loaded';
    } catch (e) {
      console.error('Failed to fetch yearly financials:', e);
      return 'error';
    }
  }, []);

  useEffect(() => {
    refetchCompanies();
    const onRefresh = () => { refetchCompanies(); };
    window.addEventListener(PROPDEV_COMPANIES_REFRESH, onRefresh);
    return () => {
      window.removeEventListener(PROPDEV_COMPANIES_REFRESH, onRefresh);
    };
  }, [refetchCompanies]);

  const derived = useMemo(() => {
    const empty = {
      properties: [] as Property[],
      lots: [] as Lot[],
      partners: [] as Partner[],
      loans: [] as Loan[],
      capitalCalls: [] as CapitalCall[],
      customers: [] as Customer[],
      docs: [] as ComplianceDoc[],
      expenses: [] as DevExpense[],
      isConsolidated: true,
    };

    if (companiesState.length === 0) return empty;

    if (selectedCompanyId === 'all') {
      return {
        properties: [aggregateProperty(companiesState)],
        lots: companiesState.flatMap(c => c.lots),
        partners: companiesState.flatMap(c => c.partners),
        loans: companiesState.flatMap(c => c.loans),
        capitalCalls: companiesState.flatMap(c => c.capitalCalls),
        customers: companiesState.flatMap(c => c.customers),
        docs: companiesState.flatMap(c => c.docs),
        expenses: companiesState[0]?.expenses ?? [],
        isConsolidated: true,
      };
    }
    const c = companiesState.find(x => x.id === selectedCompanyId);
    if (!c) return empty;
    return {
      properties: [c.property],
      lots: c.lots,
      partners: c.partners,
      loans: c.loans,
      capitalCalls: c.capitalCalls,
      customers: c.customers,
      docs: c.docs,
      expenses: c.expenses,
      isConsolidated: false,
    };
  }, [selectedCompanyId, companiesState]);

  function setLots(lots: Lot[]) {
    if (selectedCompanyId === 'all') return;
    setCompaniesState(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, lots } : c));
  }
  function setDocs(docs: ComplianceDoc[]) {
    if (selectedCompanyId === 'all') return;
    setCompaniesState(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, docs } : c));
  }
  function setCapitalCalls(capitalCalls: CapitalCall[]) {
    if (selectedCompanyId === 'all') return;
    setCompaniesState(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, capitalCalls } : c));
  }
  function setLoans(loans: Loan[]) {
    if (selectedCompanyId === 'all') return;
    setCompaniesState(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, loans } : c));
  }
  function setPartners(partners: Partner[]) {
    if (selectedCompanyId === 'all') return;
    setCompaniesState(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, partners } : c));
  }
  function setProperty(property: Property) {
    if (selectedCompanyId === 'all') return;
    setCompaniesState(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, property } : c));
  }

  function addUploadRecord(rec: Omit<UploadRecord, 'id'>) {
    const id = `upload-${Date.now()}`;
    setUploadHistory(prev => [{ ...rec, id }, ...prev]);
  }

  function setCompanies(companies: CompanyData[]) {
    setCompaniesState(companies);
    if (companies.length === 1) {
      setSelectedCompanyId(companies[0].id);
    }
  }

  const setFinancialPeriodAnchor = useCallback((period: Period | null, month: number, year: number) => {
    setFinancialPeriod(period);
    setFinancialMonth(month);
    setFinancialYear(year);
    setFinancialSelectedYear(year);
  }, []);

  return (
    <Ctx.Provider value={{
      companies: companiesState, selectedCompanyId, setSelectedCompanyId,
      ...derived, uploadHistory, addUploadRecord,
      setLots, setDocs, setCapitalCalls, setLoans, setPartners, setProperty, setCompanies,
      refetchCompanies, ensureCompanyYearly,
      financialPeriod, financialMonth, financialYear, financialSelectedYear,
      setFinancialPeriodAnchor, setFinancialSelectedYear,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePropDev() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePropDev must be used within PropertyDevProvider');
  return ctx;
}

export type { CompanyData as Company };
export { ALL_COMPANIES };
