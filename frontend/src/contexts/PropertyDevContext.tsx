import { createContext, useContext, useMemo, useState } from 'react';
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
  preferredReturn: number; status: 'Active' | 'Exited';
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
  managementFeeRate: number; commissionRate: number; cashAvailable: number;
  monthlyData: { month: string; lotsSold: number; revenue: number }[];
}
export interface CompanyData {
  id: string; name: string;
  property: Property; lots: Lot[]; partners: Partner[]; loans: Loan[];
  capitalCalls: CapitalCall[]; customers: Customer[];
  docs: ComplianceDoc[]; expenses: DevExpense[];
}

// ── Data Factory ───────────────────────────────────────────────────────────────

const BUYERS = [
  'John Smith','Maria Garcia','Robert Johnson','Emily Davis','Michael Wilson',
  'Sarah Brown','James Martinez','Jennifer Taylor','William Anderson','Patricia Thomas',
  'Charles Jackson','Barbara White','Daniel Harris','Susan Lewis','Paul Walker',
  'Nancy Hall','Mark Allen','Betty Young','Donald King','Dorothy Wright',
];
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
}

const COMPANY_CONFIGS: CompanyCfg[] = [
  {
    id: 'c1', name: 'Celina Ventures LLC', address: 'Celina, TX 75009',
    totalLots: 27, totalAcres: 45.2, landCost: 3367555, saleConsideration: 8150000,
    hardCost: 120000, softCost: 85000, soldCount: 10, contractedCount: 5, cashAvailable: 342500,
    partners: [
      { name: 'GP Holdings LLC', pct: 50, capital: 600000 },
      { name: 'ABC LTD', pct: 11, capital: 129212 },
      { name: 'Sunrise Capital', pct: 25, capital: 290000 },
      { name: 'Celina Investors LP', pct: 14, capital: 162000 },
    ],
    loans: [{ bank: 'ABC BANK', amount: 1500000, rate: 7.5 }],
  },
  {
    id: 'c2', name: 'Lone Star Development I', address: 'Frisco, TX 75034',
    totalLots: 32, totalAcres: 54.8, landCost: 4200000, saleConsideration: 10200000,
    hardCost: 145000, softCost: 98000, soldCount: 14, contractedCount: 8, cashAvailable: 520000,
    partners: [
      { name: 'Lone Star GP LLC', pct: 45, capital: 810000 },
      { name: 'Frisco RE Partners', pct: 30, capital: 540000 },
      { name: 'DFW Capital Fund', pct: 25, capital: 450000 },
    ],
    loans: [
      { bank: 'Wells Fargo', amount: 2100000, rate: 7.25 },
      { bank: 'Chase Bank', amount: 800000, rate: 7.75 },
    ],
  },
  {
    id: 'c3', name: 'Lone Star Development II', address: 'McKinney, TX 75070',
    totalLots: 24, totalAcres: 38.6, landCost: 2950000, saleConsideration: 7800000,
    hardCost: 110000, softCost: 75000, soldCount: 9, contractedCount: 4, cashAvailable: 215000,
    partners: [
      { name: 'Lone Star GP LLC', pct: 50, capital: 590000 },
      { name: 'McKinney Land Trust', pct: 30, capital: 354000 },
      { name: 'North TX Investors', pct: 20, capital: 236000 },
    ],
    loans: [{ bank: 'Texas Capital Bank', amount: 1400000, rate: 7.9 }],
  },
  {
    id: 'c4', name: 'Texas Land Holdings I', address: 'Allen, TX 75013',
    totalLots: 35, totalAcres: 62.4, landCost: 5100000, saleConsideration: 11500000,
    hardCost: 180000, softCost: 120000, soldCount: 18, contractedCount: 7, cashAvailable: 680000,
    partners: [
      { name: 'TLH Management LLC', pct: 40, capital: 1040000 },
      { name: 'Allen RE Fund I', pct: 35, capital: 910000 },
      { name: 'Collin County Partners', pct: 25, capital: 650000 },
    ],
    loans: [
      { bank: 'Prosperity Bank', amount: 2500000, rate: 7.1 },
      { bank: 'Guaranty Bank', amount: 1000000, rate: 8.0 },
    ],
  },
  {
    id: 'c5', name: 'Texas Land Holdings II', address: 'Prosper, TX 75078',
    totalLots: 28, totalAcres: 47.1, landCost: 3800000, saleConsideration: 9200000,
    hardCost: 135000, softCost: 92000, soldCount: 12, contractedCount: 6, cashAvailable: 390000,
    partners: [
      { name: 'TLH Management LLC', pct: 40, capital: 745000 },
      { name: 'Prosper Land LLC', pct: 35, capital: 652000 },
      { name: 'Star Equity Group', pct: 25, capital: 465000 },
    ],
    loans: [{ bank: 'First National Bank', amount: 1800000, rate: 7.5 }],
  },
  {
    id: 'c6', name: 'Brazos Land Partners', address: 'Waco, TX 76706',
    totalLots: 22, totalAcres: 35.4, landCost: 2300000, saleConsideration: 6800000,
    hardCost: 95000, softCost: 68000, soldCount: 7, contractedCount: 3, cashAvailable: 178000,
    partners: [
      { name: 'Brazos GP LLC', pct: 55, capital: 580000 },
      { name: 'Central TX Fund', pct: 25, capital: 264000 },
      { name: 'Baylor Area RE', pct: 20, capital: 211000 },
    ],
    loans: [{ bank: 'Heritage Bank', amount: 1100000, rate: 8.25 }],
  },
  {
    id: 'c7', name: 'Hill Country Dev LLC', address: 'Dripping Springs, TX 78620',
    totalLots: 30, totalAcres: 58.9, landCost: 4500000, saleConsideration: 9800000,
    hardCost: 160000, softCost: 108000, soldCount: 13, contractedCount: 7, cashAvailable: 445000,
    partners: [
      { name: 'Hill Country GP', pct: 45, capital: 900000 },
      { name: 'Austin Land Trust', pct: 30, capital: 600000 },
      { name: 'Texas Hill Fund', pct: 25, capital: 500000 },
    ],
    loans: [
      { bank: 'Frost Bank', amount: 2200000, rate: 7.35 },
      { bank: 'Comerica Bank', amount: 700000, rate: 7.85 },
    ],
  },
  {
    id: 'c8', name: 'Trinity Land Group', address: 'Fort Worth, TX 76102',
    totalLots: 18, totalAcres: 28.7, landCost: 1850000, saleConsideration: 5900000,
    hardCost: 80000, softCost: 55000, soldCount: 6, contractedCount: 2, cashAvailable: 142000,
    partners: [
      { name: 'Trinity GP LLC', pct: 60, capital: 540000 },
      { name: 'Tarrant RE Fund', pct: 25, capital: 225000 },
      { name: 'FW Land Trust', pct: 15, capital: 135000 },
    ],
    loans: [{ bank: 'Veritex Community', amount: 900000, rate: 8.5 }],
  },
  {
    id: 'c9', name: 'Pecan Grove Development', address: 'Richmond, TX 77406',
    totalLots: 25, totalAcres: 42.3, landCost: 3100000, saleConsideration: 8500000,
    hardCost: 115000, softCost: 80000, soldCount: 11, contractedCount: 5, cashAvailable: 312000,
    partners: [
      { name: 'Pecan Grove GP', pct: 48, capital: 780000 },
      { name: 'Sugar Land Capital', pct: 32, capital: 520000 },
      { name: 'Fort Bend Partners', pct: 20, capital: 325000 },
    ],
    loans: [{ bank: 'Cadence Bank', amount: 1600000, rate: 7.6 }],
  },
  {
    id: 'c10', name: 'Red River Land Co', address: 'Denison, TX 75021',
    totalLots: 20, totalAcres: 33.8, landCost: 2050000, saleConsideration: 6400000,
    hardCost: 90000, softCost: 62000, soldCount: 6, contractedCount: 3, cashAvailable: 165000,
    partners: [
      { name: 'Red River GP LLC', pct: 50, capital: 480000 },
      { name: 'Grayson County RE', pct: 30, capital: 288000 },
      { name: 'N Texas Land Fund', pct: 20, capital: 192000 },
    ],
    loans: [{ bank: 'Interbank TX', amount: 980000, rate: 8.1 }],
  },
];

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
    titleCharges: Math.round(cfg.saleConsideration * 0.005),
    otherCharges: Math.round(cfg.saleConsideration * 0.002),
    propertyTax: Math.round(totalMonthlyEMI * 0.246),
    loanProcessing: Math.round(loans[0].amount * 0.008),
    professionalCharges: 9000, legalFees: 15000,
    interestOnLoan: totalMonthlyEMI * 6,
    managementFeeRate: 0.09, commissionRate: 0.045,
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

  // Mutators — operate on selected company only
  setLots: (lots: Lot[]) => void;
  setDocs: (docs: ComplianceDoc[]) => void;
  setCapitalCalls: (calls: CapitalCall[]) => void;
}

const Ctx = createContext<PropertyDevState | null>(null);

export function PropertyDevProvider({ children }: { children: ReactNode }) {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [companiesState, setCompaniesState] = useState<CompanyData[]>(ALL_COMPANIES);

  const derived = useMemo(() => {
    if (selectedCompanyId === 'all') {
      return {
        properties: [aggregateProperty(companiesState)],
        lots: companiesState.flatMap(c => c.lots),
        partners: companiesState.flatMap(c => c.partners),
        loans: companiesState.flatMap(c => c.loans),
        capitalCalls: companiesState.flatMap(c => c.capitalCalls),
        customers: companiesState.flatMap(c => c.customers),
        docs: companiesState.flatMap(c => c.docs),
        expenses: companiesState[0].expenses,
        isConsolidated: true,
      };
    }
    const c = companiesState.find(x => x.id === selectedCompanyId)!;
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

  return (
    <Ctx.Provider value={{
      companies: companiesState, selectedCompanyId, setSelectedCompanyId,
      ...derived, setLots, setDocs, setCapitalCalls,
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
