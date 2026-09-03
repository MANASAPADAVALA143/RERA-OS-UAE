import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

/**
 * Consultancy practice — advisory / tax / audit firm P&L, clients and AR.
 * All figures USD. Demo data is deterministic and self-consistent:
 *   - yearly P&L nets to the headline net income
 *   - service-line revenue sums to the year's revenue
 *   - payroll by grade sums to the year's payroll
 *   - client AR aging sums to the balance-sheet receivables
 *   - the balance sheet balances (Assets = Liabilities + Equity)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface YearFin {
  year: number;
  revenue: number;
  payroll: number;
  otherOpex: number;
  otherIncome: number;
  netIncome: number;
}

export interface ServiceLine {
  name: string;
  revenue: number;   // current year (2025)
  marginPct: number; // contribution margin
}

export interface MonthPoint {
  month: string;     // 'Jan 25'
  revenue: number;
  cost: number;
}

export interface Client {
  id: string;
  name: string;
  industry: string;
  serviceLine: string;
  annualFee: number;
  ytdBilled: number;
  arCurrent: number;
  ar30: number;
  ar60: number;
  ar90: number;
  lastInvoice: string;   // ISO date
  status: 'Active' | 'On Hold' | 'Prospect';
}

export interface TeamGrade {
  grade: string;
  headcount: number;
  avgSalary: number;
  utilizationPct: number;
  billRate: number;      // blended $/hr
}

export interface Engagement {
  id: string;
  client: string;
  type: string;
  fees: number;
  budgetHours: number;
  actualHours: number;
  status: 'In Progress' | 'Delivered' | 'Invoiced' | 'Scoping';
}

export interface BalanceSheet {
  cash: number;
  receivables: number;
  prepaid: number;
  fixedAssetsNet: number;
  accountsPayable: number;
  accruedPayroll: number;
  deferredRevenue: number;
  bankLoan: number;
  equity: number;
}

// ── Demo data ──────────────────────────────────────────────────────────────────

const YEARS: YearFin[] = [
  { year: 2023, revenue: 1_850_000, payroll: 1_420_000, otherOpex: 255_000, otherIncome: 0, netIncome: 175_000 },
  { year: 2024, revenue: 2_120_000, payroll: 1_580_000, otherOpex: 312_000, otherIncome: 0, netIncome: 228_000 },
  { year: 2025, revenue: 2_400_000, payroll: 1_750_000, otherOpex: 370_000, otherIncome: 0, netIncome: 280_000 },
];

const SERVICE_LINES: ServiceLine[] = [
  { name: 'Advisory & Transaction', revenue: 900_000, marginPct: 34 },
  { name: 'Tax & VAT Compliance',   revenue: 620_000, marginPct: 41 },
  { name: 'Audit & Assurance',      revenue: 480_000, marginPct: 28 },
  { name: 'IFRS & Technical',       revenue: 250_000, marginPct: 45 },
  { name: 'ESG & Valuation',        revenue: 150_000, marginPct: 30 },
];

const MONTHLY_2025_K = [175, 185, 210, 195, 205, 220, 190, 170, 200, 215, 230, 205]; // sums to 2,400
const MONTHS = ['Jan 25','Feb 25','Mar 25','Apr 25','May 25','Jun 25','Jul 25','Aug 25','Sep 25','Oct 25','Nov 25','Dec 25'];

const MONTHLY: MonthPoint[] = MONTHS.map((month, i) => ({
  month,
  revenue: MONTHLY_2025_K[i] * 1000,
  cost: Math.round(MONTHLY_2025_K[i] * 1000 * 0.74),
}));

const CLIENTS: Client[] = [
  { id: 'c1', name: 'Emaar Properties PJSC',        industry: 'Real Estate',   serviceLine: 'Advisory & Transaction', annualFee: 520_000, ytdBilled: 468_000, arCurrent: 62_000, ar30: 18_000, ar60: 0,      ar90: 0,     lastInvoice: '2026-08-20', status: 'Active' },
  { id: 'c2', name: 'Aldar Investments',            industry: 'Real Estate',   serviceLine: 'Tax & VAT Compliance',   annualFee: 410_000, ytdBilled: 372_000, arCurrent: 45_000, ar30: 22_000, ar60: 8_000,  ar90: 0,     lastInvoice: '2026-08-12', status: 'Active' },
  { id: 'c3', name: 'DAMAC Group',                  industry: 'Real Estate',   serviceLine: 'Advisory & Transaction', annualFee: 355_000, ytdBilled: 318_000, arCurrent: 30_000, ar30: 15_000, ar60: 12_000, ar90: 9_000, lastInvoice: '2026-07-28', status: 'Active' },
  { id: 'c4', name: 'Majid Al Futtaim Holding',     industry: 'Retail',        serviceLine: 'Audit & Assurance',      annualFee: 300_000, ytdBilled: 264_000, arCurrent: 28_000, ar30: 10_000, ar60: 0,      ar90: 0,     lastInvoice: '2026-08-18', status: 'Active' },
  { id: 'c5', name: 'Meraas Holding',               industry: 'Hospitality',   serviceLine: 'IFRS & Technical',       annualFee: 245_000, ytdBilled: 210_000, arCurrent: 20_000, ar30: 12_000, ar60: 6_000,  ar90: 0,     lastInvoice: '2026-08-05', status: 'Active' },
  { id: 'c6', name: 'Nakheel PJSC',                 industry: 'Real Estate',   serviceLine: 'Advisory & Transaction', annualFee: 205_000, ytdBilled: 176_000, arCurrent: 15_000, ar30: 8_000,  ar60: 4_000,  ar90: 7_000, lastInvoice: '2026-07-15', status: 'Active' },
  { id: 'c7', name: 'Sobha Realty',                 industry: 'Real Estate',   serviceLine: 'ESG & Valuation',        annualFee: 105_000, ytdBilled: 84_000,  arCurrent: 9_000,  ar30: 0,      ar60: 0,      ar90: 3_000, lastInvoice: '2026-06-30', status: 'Active' },
  { id: 'c8', name: 'Binghatti Developers',         industry: 'Real Estate',   serviceLine: 'ESG & Valuation',        annualFee: 55_000,  ytdBilled: 41_000,  arCurrent: 4_000,  ar30: 2_000,  ar60: 0,      ar90: 6_000, lastInvoice: '2026-05-22', status: 'On Hold' },
];

// Recurring client fees sum to 2,195,000; the balance to the 2025 headline
// (205,000) is non-recurring / one-off project work.
const NON_RECURRING_REVENUE = 205_000;

const TEAM: TeamGrade[] = [
  { grade: 'Partner',  headcount: 2, avgSalary: 260_000, utilizationPct: 55, billRate: 480 },
  { grade: 'Director', headcount: 3, avgSalary: 145_000, utilizationPct: 68, billRate: 320 },
  { grade: 'Manager',  headcount: 5, avgSalary: 92_000,  utilizationPct: 74, billRate: 210 },
  { grade: 'Analyst',  headcount: 8, avgSalary: 41_875,  utilizationPct: 79, billRate: 130 },
]; // payroll = 520k + 435k + 460k + 335k = 1,750,000 · headcount 18

const ENGAGEMENTS: Engagement[] = [
  { id: 'e1', client: 'Emaar Properties PJSC',    type: 'Portfolio carve-out advisory',  fees: 180_000, budgetHours: 640, actualHours: 590, status: 'In Progress' },
  { id: 'e2', client: 'Aldar Investments',        type: 'VAT health check & filing',     fees: 95_000,  budgetHours: 380, actualHours: 395, status: 'Invoiced' },
  { id: 'e3', client: 'DAMAC Group',              type: 'Acquisition due diligence',     fees: 140_000, budgetHours: 520, actualHours: 470, status: 'Delivered' },
  { id: 'e4', client: 'Majid Al Futtaim Holding', type: 'Internal audit co-source',      fees: 110_000, budgetHours: 460, actualHours: 448, status: 'In Progress' },
  { id: 'e5', client: 'Meraas Holding',           type: 'IFRS 16 remediation',           fees: 78_000,  budgetHours: 300, actualHours: 265, status: 'Delivered' },
  { id: 'e6', client: 'Nakheel PJSC',             type: 'Feasibility model review',      fees: 62_000,  budgetHours: 240, actualHours: 232, status: 'Invoiced' },
  { id: 'e7', client: 'Sobha Realty',             type: 'Fixed-asset valuation',         fees: 45_000,  budgetHours: 180, actualHours: 150, status: 'Scoping' },
];

const BALANCE_SHEET_2025: BalanceSheet = {
  cash: 644_000,
  receivables: 355_000,   // = sum of client AR aging (see CLIENTS above)
  prepaid: 45_000,
  fixedAssetsNet: 180_000,
  accountsPayable: 96_000,
  accruedPayroll: 138_000,
  deferredRevenue: 120_000,
  bankLoan: 150_000,
  equity: 720_000,        // plug: assets 1,224,000 - liabilities 504,000
};

// ── Context ────────────────────────────────────────────────────────────────────

interface ConsultancyState {
  years: YearFin[];
  current: YearFin;
  serviceLines: ServiceLine[];
  monthly: MonthPoint[];
  clients: Client[];
  nonRecurringRevenue: number;
  team: TeamGrade[];
  engagements: Engagement[];
  balanceSheet: BalanceSheet;
  // derived
  arAging: { bucket: string; amount: number }[];
  totalAR: number;
  headcount: number;
  revenuePerHead: number;
  netMarginPct: number;
  totalAssets: number;
  totalLiabilities: number;
}

const Ctx = createContext<ConsultancyState | null>(null);

export function ConsultancyProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ConsultancyState>(() => {
    const current = YEARS[YEARS.length - 1];
    const headcount = TEAM.reduce((s, t) => s + t.headcount, 0);
    const arCurrent = CLIENTS.reduce((s, c) => s + c.arCurrent, 0);
    const ar30 = CLIENTS.reduce((s, c) => s + c.ar30, 0);
    const ar60 = CLIENTS.reduce((s, c) => s + c.ar60, 0);
    const ar90 = CLIENTS.reduce((s, c) => s + c.ar90, 0);
    const totalAR = arCurrent + ar30 + ar60 + ar90;
    const totalAssets =
      BALANCE_SHEET_2025.cash + BALANCE_SHEET_2025.receivables +
      BALANCE_SHEET_2025.prepaid + BALANCE_SHEET_2025.fixedAssetsNet;
    const totalLiabilities =
      BALANCE_SHEET_2025.accountsPayable + BALANCE_SHEET_2025.accruedPayroll +
      BALANCE_SHEET_2025.deferredRevenue + BALANCE_SHEET_2025.bankLoan;

    return {
      years: YEARS,
      current,
      serviceLines: SERVICE_LINES,
      monthly: MONTHLY,
      clients: CLIENTS,
      nonRecurringRevenue: NON_RECURRING_REVENUE,
      team: TEAM,
      engagements: ENGAGEMENTS,
      balanceSheet: BALANCE_SHEET_2025,
      arAging: [
        { bucket: 'Current',  amount: arCurrent },
        { bucket: '1–30 days', amount: ar30 },
        { bucket: '31–60 days', amount: ar60 },
        { bucket: '61–90+ days', amount: ar90 },
      ],
      totalAR,
      headcount,
      revenuePerHead: Math.round(current.revenue / headcount),
      netMarginPct: +((current.netIncome / current.revenue) * 100).toFixed(1),
      totalAssets,
      totalLiabilities,
    };
  }, []);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConsultancy() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConsultancy must be used within ConsultancyProvider');
  return ctx;
}

export const consultancyMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M`
  : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K`
  : `$${n.toLocaleString()}`;
