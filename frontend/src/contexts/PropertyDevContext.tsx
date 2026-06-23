import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Lot {
  id: string;
  lotNo: string;
  block: string;
  sizeSqft: number;
  sizeAcres: number;
  listPrice: number;
  salePrice: number | null;
  status: 'available' | 'reserved' | 'contracted' | 'sold' | 'cancelled' | 'legal_pending';
  buyerName: string | null;
  contractDate: string | null;
  closeDate: string | null;
  landCost: number;
  devCost: number;
}

export interface Partner {
  id: string;
  name: string;
  type: 'Class A' | 'Class B';
  sharePercent: number;
  capitalContributed: number;
  distributionsReceived: number;
  preferredReturn: number;
  status: 'Active' | 'Exited';
}

export interface Loan {
  id: string;
  company: string;
  property: string;
  bank: string;
  loanDate: string;
  accountNo: string;
  amount: number;
  balance: number;
  interestRate: number;
  emi: number;
  maturityDate: string;
  emiDate: number;
  lenderName: string;
  lenderEmail: string;
  lenderPhone: string;
  status: 'Active' | 'Paid Off' | 'In Default';
}

export interface CapitalCall {
  id: string;
  period: string;
  partnerId: string;
  partnerName: string;
  sharePercent: number;
  totalCallAmount: number;
  partnerShare: number;
  oldDues: number;
  totalDue: number;
  received: number;
  receivedDate: string | null;
  status: 'Paid' | 'Partial' | 'Outstanding' | 'Overdue';
}

export interface Sale {
  id: string;
  propertyName: string;
  lotId: string;
  lotNo: string;
  buyerName: string;
  salePrice: number;
  closedDate: string;
  commission: number;
  distributed: number;
}

export interface Customer {
  id: string;
  name: string;
  lotNo: string;
  contractValue: number;
  collected: number;
  lastPaymentDate: string | null;
  installments: { dueDate: string; amount: number; status: 'paid' | 'pending' | 'overdue' | 'bounced' }[];
}

export interface ComplianceDoc {
  id: string;
  type: string;
  property: string;
  counterparty: string;
  issueDate: string;
  expiryDate: string | null;
  status: 'Valid' | 'Expiring Soon' | 'Expired' | 'Missing' | 'Pending';
  fileUrl: string | null;
}

export interface DevExpense {
  particulars: string;
  amount: number;
  category: string;
}

export interface Property {
  id: string;
  name: string;
  address: string;
  totalLots: number;
  totalAcres: number;
  saleConsideration: number;
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
  managementFeeRate: number;
  commissionRate: number;
  cashAvailable: number;
  monthlyData: { month: string; lotsSold: number; revenue: number }[];
}

// ── Demo Data ──────────────────────────────────────────────────────────────────

const DEMO_LOTS: Lot[] = Array.from({ length: 27 }, (_, i) => {
  const statuses: Lot['status'][] = [
    'sold','sold','sold','sold','sold','sold','sold','sold','sold','sold',
    'contracted','contracted','contracted','contracted','contracted',
    'reserved','reserved','reserved',
    'available','available','available','available','available','available',
    'cancelled','legal_pending','available',
  ];
  const buyers = [
    'John Smith','Maria Garcia','Robert Johnson','Emily Davis','Michael Wilson',
    'Sarah Brown','James Martinez','Jennifer Taylor','William Anderson','Patricia Thomas',
    'Charles Jackson','Barbara White',null,null,null,
    null,null,null,null,null,null,null,null,null,null,null,null,
  ];
  const lotNo = `L-${String(i + 1).padStart(2, '0')}`;
  const block = `Block ${String.fromCharCode(65 + Math.floor(i / 9))}`;
  const size = 8000 + (i % 7) * 500;
  const listPrice = 280000 + (i % 5) * 15000;
  const salePrice = statuses[i] === 'available' || statuses[i] === 'reserved' || statuses[i] === 'cancelled'
    ? null
    : listPrice - (i % 3) * 5000;
  return {
    id: `lot-${i + 1}`,
    lotNo,
    block,
    sizeSqft: size,
    sizeAcres: +(size / 43560).toFixed(3),
    listPrice,
    salePrice,
    status: statuses[i],
    buyerName: buyers[i],
    contractDate: statuses[i] !== 'available' && statuses[i] !== 'cancelled' ? '2025-03-15' : null,
    closeDate: statuses[i] === 'sold' ? '2025-05-20' : null,
    landCost: 3367555 / 27,
    devCost: 558080 / 27,
  };
});

const DEMO_PROPERTY: Property = {
  id: 'prop-1',
  name: 'Celina Ventures',
  address: 'Celina, TX 75009',
  totalLots: 27,
  totalAcres: 45.2,
  saleConsideration: 8150000,
  landCost: 3367555,
  hardCost: 120000,
  softCost: 85000,
  titleCharges: 42000,
  otherCharges: 18000,
  propertyTax: 26514,
  loanProcessing: 12000,
  professionalCharges: 9000,
  legalFees: 15000,
  interestOnLoan: 108000,
  managementFeeRate: 0.09,
  commissionRate: 0.045,
  cashAvailable: 342500,
  monthlyData: [
    { month: 'Jan 25', lotsSold: 1, revenue: 285000 },
    { month: 'Feb 25', lotsSold: 2, revenue: 590000 },
    { month: 'Mar 25', lotsSold: 3, revenue: 895000 },
    { month: 'Apr 25', lotsSold: 2, revenue: 610000 },
    { month: 'May 25', lotsSold: 1, revenue: 302000 },
    { month: 'Jun 25', lotsSold: 1, revenue: 315000 },
  ],
};

const DEMO_PARTNERS: Partner[] = [
  { id: 'p1', name: 'ABC LTD', type: 'Class A', sharePercent: 11, capitalContributed: 129212, distributionsReceived: 0, preferredReturn: 8, status: 'Active' },
  { id: 'p2', name: 'GP Holdings LLC', type: 'Class B', sharePercent: 50, capitalContributed: 600000, distributionsReceived: 50000, preferredReturn: 6, status: 'Active' },
  { id: 'p3', name: 'Sunrise Capital', type: 'Class A', sharePercent: 25, capitalContributed: 290000, distributionsReceived: 0, preferredReturn: 8, status: 'Active' },
  { id: 'p4', name: 'Celina Investors LP', type: 'Class A', sharePercent: 14, capitalContributed: 162000, distributionsReceived: 10000, preferredReturn: 7, status: 'Active' },
];

const DEMO_LOANS: Loan[] = [
  {
    id: 'ln-1', company: 'ABC LLC', property: 'Celina Ventures',
    bank: 'ABC BANK', loanDate: '2024-01-15', accountNo: 'ABK-2024-001',
    amount: 1500000, balance: 1234000, interestRate: 7.5, emi: 18500,
    maturityDate: '2026-01-15', emiDate: 15,
    lenderName: 'James Harrison', lenderEmail: 'j.harrison@abcbank.com',
    lenderPhone: '(214) 555-0182', status: 'Active',
  },
  {
    id: 'ln-2', company: 'ABC LLC', property: 'Celina Ventures',
    bank: 'First National Bank', loanDate: '2024-06-01', accountNo: 'FNB-2024-447',
    amount: 500000, balance: 465000, interestRate: 8.25, emi: 6800,
    maturityDate: '2026-06-01', emiDate: 1,
    lenderName: 'Susan Clark', lenderEmail: 's.clark@fnb.com',
    lenderPhone: '(972) 555-0291', status: 'Active',
  },
];

const DEMO_CAPITAL_CALLS: CapitalCall[] = [
  { id: 'cc-1', period: 'Jan–Jun 2025', partnerId: 'p1', partnerName: 'ABC LTD', sharePercent: 5, totalCallAmount: 137964, partnerShare: 6898, oldDues: 0, totalDue: 6898, received: 6898, receivedDate: '2025-02-10', status: 'Paid' },
  { id: 'cc-2', period: 'Jan–Jun 2025', partnerId: 'p2', partnerName: 'GP Holdings LLC', sharePercent: 50, totalCallAmount: 137964, partnerShare: 68982, oldDues: 0, totalDue: 68982, received: 68982, receivedDate: '2025-01-28', status: 'Paid' },
  { id: 'cc-3', period: 'Jan–Jun 2025', partnerId: 'p3', partnerName: 'Sunrise Capital', sharePercent: 25, totalCallAmount: 137964, partnerShare: 34491, oldDues: 0, totalDue: 34491, received: 20000, receivedDate: '2025-02-15', status: 'Partial' },
  { id: 'cc-4', period: 'Jan–Jun 2025', partnerId: 'p4', partnerName: 'Celina Investors LP', sharePercent: 14, totalCallAmount: 137964, partnerShare: 19315, oldDues: 0, totalDue: 19315, received: 0, receivedDate: null, status: 'Overdue' },
  { id: 'cc-5', period: 'Jul–Dec 2025', partnerId: 'p1', partnerName: 'ABC LTD', sharePercent: 5, totalCallAmount: 145000, partnerShare: 7250, oldDues: 0, totalDue: 7250, received: 0, receivedDate: null, status: 'Outstanding' },
];

const DEMO_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'John Smith', lotNo: 'L-01', contractValue: 285000, collected: 285000, lastPaymentDate: '2025-05-20', installments: [{ dueDate: '2025-03-01', amount: 100000, status: 'paid' }, { dueDate: '2025-04-01', amount: 100000, status: 'paid' }, { dueDate: '2025-05-20', amount: 85000, status: 'paid' }] },
  { id: 'c2', name: 'Maria Garcia', lotNo: 'L-02', contractValue: 302000, collected: 200000, lastPaymentDate: '2025-04-15', installments: [{ dueDate: '2025-03-01', amount: 100000, status: 'paid' }, { dueDate: '2025-04-15', amount: 100000, status: 'paid' }, { dueDate: '2025-06-01', amount: 102000, status: 'pending' }] },
  { id: 'c3', name: 'Robert Johnson', lotNo: 'L-03', contractValue: 295000, collected: 100000, lastPaymentDate: '2025-02-28', installments: [{ dueDate: '2025-02-28', amount: 100000, status: 'paid' }, { dueDate: '2025-04-28', amount: 97500, status: 'overdue' }, { dueDate: '2025-06-28', amount: 97500, status: 'pending' }] },
  { id: 'c4', name: 'Emily Davis', lotNo: 'L-04', contractValue: 310000, collected: 50000, lastPaymentDate: '2025-01-15', installments: [{ dueDate: '2025-01-15', amount: 50000, status: 'paid' }, { dueDate: '2025-03-15', amount: 130000, status: 'bounced' }, { dueDate: '2025-06-15', amount: 130000, status: 'pending' }] },
];

const DEMO_DOCS: ComplianceDoc[] = [
  { id: 'd1', type: 'Title Document', property: 'Celina Ventures', counterparty: 'Collin County', issueDate: '2024-01-10', expiryDate: null, status: 'Valid', fileUrl: null },
  { id: 'd2', type: 'Plot Approval', property: 'Celina Ventures', counterparty: 'City of Celina', issueDate: '2024-03-01', expiryDate: '2026-03-01', status: 'Valid', fileUrl: null },
  { id: 'd3', type: 'Loan Agreement', property: 'Celina Ventures', counterparty: 'ABC BANK', issueDate: '2024-01-15', expiryDate: '2026-01-15', status: 'Valid', fileUrl: null },
  { id: 'd4', type: 'Partner Agreement', property: 'Celina Ventures', counterparty: 'ABC LTD', issueDate: '2024-01-01', expiryDate: '2027-01-01', status: 'Valid', fileUrl: null },
  { id: 'd5', type: 'Insurance Certificate', property: 'Celina Ventures', counterparty: 'State Farm', issueDate: '2025-01-01', expiryDate: '2026-01-01', status: 'Valid', fileUrl: null },
  { id: 'd6', type: 'NOC - Water', property: 'Celina Ventures', counterparty: 'Celina Water Dept', issueDate: '2024-06-15', expiryDate: '2025-06-30', status: 'Expiring Soon', fileUrl: null },
  { id: 'd7', type: 'Survey Report', property: 'Celina Ventures', counterparty: 'TX Surveying LLC', issueDate: '2023-11-20', expiryDate: '2025-11-20', status: 'Valid', fileUrl: null },
  { id: 'd8', type: 'Legal Opinion', property: 'Celina Ventures', counterparty: 'Harrison & Co', issueDate: '2024-02-01', expiryDate: '2025-05-01', status: 'Expired', fileUrl: null },
  { id: 'd9', type: 'Tax Certificate', property: 'Celina Ventures', counterparty: 'Collin CAD', issueDate: '2025-01-01', expiryDate: null, status: 'Missing', fileUrl: null },
];

export const DEMO_EXPENSES: DevExpense[] = [
  { particulars: 'Monthly Loan EMI', amount: 108000, category: 'Debt Service' },
  { particulars: 'Property Tax (6 months)', amount: 26514, category: 'Tax' },
  { particulars: 'Book Keeping Charges', amount: 750, category: 'Admin' },
  { particulars: 'Professional Fee', amount: 1000, category: 'Admin' },
  { particulars: 'Bank Charges', amount: 100, category: 'Admin' },
  { particulars: 'Membership Fee', amount: 400, category: 'Admin' },
  { particulars: 'Misc Expenses', amount: 1200, category: 'Admin' },
];

// ── Context ────────────────────────────────────────────────────────────────────

interface PropertyDevState {
  properties: Property[];
  lots: Lot[];
  partners: Partner[];
  loans: Loan[];
  capitalCalls: CapitalCall[];
  customers: Customer[];
  docs: ComplianceDoc[];
  expenses: DevExpense[];
  setLots: (lots: Lot[]) => void;
  setDocs: (docs: ComplianceDoc[]) => void;
  setCapitalCalls: (calls: CapitalCall[]) => void;
}

const Ctx = createContext<PropertyDevState | null>(null);

export function PropertyDevProvider({ children }: { children: ReactNode }) {
  const [lots, setLots] = useState<Lot[]>(DEMO_LOTS);
  const [docs, setDocs] = useState<ComplianceDoc[]>(DEMO_DOCS);
  const [capitalCalls, setCapitalCalls] = useState<CapitalCall[]>(DEMO_CAPITAL_CALLS);

  return (
    <Ctx.Provider value={{
      properties: [DEMO_PROPERTY],
      lots,
      partners: DEMO_PARTNERS,
      loans: DEMO_LOANS,
      capitalCalls,
      customers: DEMO_CUSTOMERS,
      docs,
      expenses: DEMO_EXPENSES,
      setLots,
      setDocs,
      setCapitalCalls,
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
