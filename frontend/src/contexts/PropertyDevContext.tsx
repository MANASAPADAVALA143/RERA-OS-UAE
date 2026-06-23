import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

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
  shareOfProfit: number; preferredReturn: number; status: 'Active' | 'Exited';
}
export interface Loan {
  id: string; companyId: string; company: string; property: string;
  bank: string; loanDate: string; accountNo: string;
  amount: number; balance: number; interestRate: number; emi: number;
  maturityDate: string; emiDate: number;
  lenderName: string; lenderEmail: string; lenderPhone: string;
  status: 'Active' | 'Paid Off' | 'In Default';
}
export interface CapitalCall {
  id: string; companyId: string; period: string; partnerId: string; partnerName: string;
  sharePercent: number; totalCallAmount: number; partnerShare: number;
  oldDues: number; totalDue: number; received: number;
  receivedDate: string | null; dueDate?: string;
  status: 'Paid' | 'Partial' | 'Outstanding' | 'Overdue';
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
export interface Property {
  id: string; companyId: string; name: string; address: string;
  totalLots: number; totalAcres: number; saleConsideration: number;
  landCost: number; hardCost: number; softCost: number; titleCharges: number;
  otherCharges: number; propertyTax: number; loanProcessing: number;
  professionalCharges: number; legalFees: number; interestOnLoan: number;
  managementFeeRate: number; commissionRate: number;
  commission?: number;  // explicit commission amount; overrides commissionRate when set
  cashAvailable: number;
  monthlyData: { month: string; lotsSold: number; revenue: number }[];
}
export interface CompanyData {
  id: string; name: string;
  property: Property; lots: Lot[]; partners: Partner[]; loans: Loan[];
  capitalCalls: CapitalCall[]; customers: Customer[];
  docs: ComplianceDoc[]; expenses: DevExpense[];
}

// ── Data Factory ───────────────────────────────────────────────────────────────

const BUYERS: string[] = [];
const MONTHS = ['Jan 25','Feb 25','Mar 25','Apr 25','May 25','Jun 25'];

function makeLots(companyId: string, cfg: CompanyCfg): Lot[] {
  const { totalLots: n, landCost, saleConsideration, soldCount, contractedCount } = cfg;
  const reservedCount = Math.floor(n * 0.1);
  const avgPrice = saleConsideration / n;
  const statuses: Lot['status'][] = [
    ...Array(soldCount).fill('sold'),
    ...Array(contractedCount).fill('contracted'),
    ...Array(reservedCount).fill('reserved'),
    ...Array(Math.max(0, n - soldCount - contractedCount - reservedCount - 1)).fill('available'),
    'legal_pending',
  ];
  return statuses.map((status, i) => {
    const listPrice = Math.round(avgPrice * (0.9 + (i % 5) * 0.05));
    const salePrice = (status === 'available' || status === 'reserved' || status === 'cancelled')
      ? null : listPrice - (i % 3) * 4000;
    const hasBuyer = status === 'sold' || status === 'contracted';
    return {
      id: `${companyId}-lot-${i + 1}`, companyId,
      lotNo: `L-${String(i + 1).padStart(2, '0')}`,
      block: `Block ${String.fromCharCode(65 + Math.floor(i / 9))}`,
      sizeSqft: 7800 + (i * 200) % 2400,
      sizeAcres: +((7800 + (i * 200) % 2400) / 43560).toFixed(3),
      listPrice, salePrice, status,
      buyerName: hasBuyer ? BUYERS[i % BUYERS.length] : null,
      contractDate: hasBuyer ? '2025-03-15' : null,
      closeDate: status === 'sold' ? '2025-05-20' : null,
      landCost: landCost / n,
      devCost: (landCost * 0.15) / n,
    };
  });
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
      };
    },
    { totalLots: 0, totalAcres: 0, saleConsideration: 0, landCost: 0, hardCost: 0, softCost: 0,
      titleCharges: 0, otherCharges: 0, propertyTax: 0, loanProcessing: 0,
      professionalCharges: 0, legalFees: 0, interestOnLoan: 0, cashAvailable: 0 }
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
}

const Ctx = createContext<PropertyDevState | null>(null);

export function PropertyDevProvider({ children }: { children: ReactNode }) {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [companiesState, setCompaniesState] = useState<CompanyData[]>(ALL_COMPANIES);
  const [uploadHistory, setUploadHistory] = useState<UploadRecord[]>([]);

  // Fetch companies from API on mount
  useEffect(() => {
    const fetchCompanies = async () => {
      try {
        const res = await fetch('/api/propdev/companies');
        if (res.ok) {
          const data = await res.json();
          const transformed = data.companies.map((c: any) => ({
            id: c.id,
            name: c.name,
            property: {
              id: c.id + '-prop',
              companyId: c.id,
              name: c.property_name,
              address: c.address,
              totalLots: c.total_lots,
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
              monthlyData: [],
            },
            lots: (c.lots || []).map((l: any) => ({
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
            partners: (c.partners || []).map((p: any) => ({
              id: p.id,
              companyId: c.id,
              name: p.name,
              type: p.type,
              sharePercent: p.share_percent * 100,
              capitalContributed: p.capital_contributed,
              distributionsReceived: p.distributions_received,
              shareOfProfit: 0,
              preferredReturn: p.preferred_return * 100,
              status: p.status,
            })),
            loans: (c.loans || []).map((ln: any) => ({
              id: ln.id,
              companyId: c.id,
              company: c.name,
              property: c.property_name,
              bank: ln.bank,
              loanDate: '2023-01-15',
              accountNo: '',
              amount: ln.loan_amount,
              balance: ln.balance,
              interestRate: ln.interest_rate * 100,
              emi: ln.emi,
              maturityDate: ln.maturity_date,
              emiDate: 15,
              lenderName: '',
              lenderEmail: '',
              lenderPhone: '',
              status: 'Active',
            })),
            capitalCalls: (c.capital_calls || []).map((cc: any) => ({
              id: cc.id,
              companyId: c.id,
              period: 'Jan–Jun 2025',
              partnerId: '',
              partnerName: cc.partner_name,
              sharePercent: cc.share_percent * 100,
              totalCallAmount: cc.total_call_amount,
              partnerShare: cc.partner_share,
              oldDues: 0,
              totalDue: cc.partner_share,
              received: cc.amount_received,
              receivedDate: null,
              status: cc.status,
            })),
            customers: [],
            docs: [],
            expenses: (c.expenses || []).map((e: any) => ({
              particulars: e.expense_type,
              amount: e.amount,
              category: e.category,
            })),
          }));
          setCompaniesState(transformed);
        }
      } catch (e) {
        console.error('Failed to fetch companies:', e);
      }
    };
    fetchCompanies();
  }, []);

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

  return (
    <Ctx.Provider value={{
      companies: companiesState, selectedCompanyId, setSelectedCompanyId,
      ...derived, uploadHistory, addUploadRecord,
      setLots, setDocs, setCapitalCalls, setLoans, setPartners, setProperty, setCompanies,
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
