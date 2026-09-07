import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Loan, CompanyData } from '../../contexts/PropertyDevContext';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import {
  Landmark, Mail, Phone, Calendar, TrendingDown, AlertTriangle, CheckCircle2, Upload,
  Download, Zap, AlertCircle, FileSpreadsheet,
} from 'lucide-react';
import {
  cashEmiStatus,
  computeCapitalCallCoverage,
  computeLtlv,
  computePortfolioCapitalCallCoverage,
  coverageStatusColors,
  formatCoverageRatio,
  isActivePropDevLoan,
  pickNextUpcomingMaturity,
  resolveCompanyMonthlyEmi,
  resolveLandValue,
  portfolioLtlvPercent,
  sumActivePropDevLoanBalances,
  type CoverageStatusLabel,
} from '../../utils/propDevLoanMetrics';
import { usePropDevLoanTrackerData, PROPDEV_MARKET_RATE } from '../../hooks/usePropDevLoanTrackerData';
import PropDevLoanPortfolioCharts from '../../components/propdev/PropDevLoanPortfolioCharts';
import PropDevLoanUpload from '../../components/propdev/PropDevLoanUpload';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { fmtUSD } from '../../components/ProtectedRoute';
import { PT as TypographyPT, PT_FONT } from '../../utils/parchmentTypography';
import PropDevPageHeader from '../../components/propdev/PropDevPageHeader';
import { exportPropDevLoansPdf } from '../../utils/propDevSectionPdfExport';
import { PROPDEV_EXPORT_PDF_EVENT } from '../../utils/propDevExportEvents';
import { parchmentStyles } from '../../theme/parchmentTheme';
import PDLoanManagementTab from './PDLoanManagementTab';
import PDLoanCalculationsTab from './PDLoanCalculationsTab';

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Same cream tokens as Rentals Ownership / Loan Tracker */
const PT = {
  pageBg: TypographyPT.pageBg,
  cardBg: TypographyPT.cardBg,
  border: TypographyPT.border,
  text: TypographyPT.text,
  muted: TypographyPT.muted,
};
const LT_KPI_CARD: CSSProperties = { borderRadius: 10, padding: '8px 10px', minWidth: 0, overflow: 'hidden' };
const LT_KPI_LABEL: CSSProperties = { fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2, lineHeight: 1.2 };
const LT_KPI_VALUE: CSSProperties = { fontSize: 17, fontWeight: 700, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums lining-nums' };
const LT_KPI_SUB: CSSProperties = { fontSize: 10, marginTop: 2, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const LT_KPI_NA: CSSProperties = { fontSize: 13, fontWeight: 600, color: PT.muted, lineHeight: 1.2 };

function buildAmortizationSchedule(loan: Loan, months = 12) {
  const monthlyRate = loan.interestRate / 100 / 12;
  let balance = loan.balance;
  const rows = [];
  for (let i = 1; i <= months; i++) {
    const interest = balance * monthlyRate;
    const principal = loan.emi - interest;
    balance = Math.max(0, balance - principal);
    rows.push({ month: `M${i}`, interest: Math.round(interest), principal: Math.round(principal), balance: Math.round(balance) });
    if (balance === 0) break;
  }
  return rows;
}

const STATUS_COLORS: Record<Loan['status'], string> = {
  Active: 'bg-green-100 text-green-700',
  'Paid Off': 'bg-gray-100 text-gray-500',
  'In Default': 'bg-red-100 text-red-700',
};

const COVERAGE_BADGE_STYLE: Record<CoverageStatusLabel, string> = {
  Healthy: 'bg-green-100 text-green-800',
  Monitor: 'bg-amber-100 text-amber-800',
  Review:  'bg-red-100 text-red-800',
  'N/A':   'bg-gray-100 text-gray-600',
};

const COVERAGE_WINDOW_MONTHS = 3;

// ── Capital Call Coverage Gauge (development entities — replaces DSCR) ────────

function CapitalCallCoverageGauge({
  ratio,
  status,
  dataGap,
  obligations,
  uncalled,
}: {
  ratio: number | null;
  status: CoverageStatusLabel;
  dataGap: boolean;
  obligations: number;
  uncalled: number | null;
}) {
  const colors = coverageStatusColors(status);
  const barWidth = ratio != null ? Math.min(100, (ratio / 3) * 100) : 0;
  const barColor = status === 'Healthy' ? 'bg-green-500' : status === 'Monitor' ? 'bg-amber-500' : status === 'Review' ? 'bg-red-500' : 'bg-gray-300';

  if (dataGap) {
    return (
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Capital Call Coverage</span>
          <span className="text-lg font-bold text-gray-600">N/A — insufficient data</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Partner committed capital is not tracked yet. Add <strong>committed capital</strong> amounts to partners
          (uncalled = committed − contributed) to calculate coverage against upcoming EMI obligations.
        </p>
        {obligations > 0 && (
          <p className="text-xs text-gray-400 mt-1">
            Upcoming EMI ({COVERAGE_WINDOW_MONTHS} mo): ${Math.round(obligations).toLocaleString()}
          </p>
        )}
      </div>
    );
  }

  if (ratio == null) {
    return (
      <div className="bg-gray-50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wide">Capital Call Coverage</span>
          <span className="text-lg font-bold text-gray-600">N/A — no loan data</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {obligations <= 0
            ? 'No active debt service — coverage ratio not applicable during pre-revenue holding.'
            : 'Unable to compute coverage with current partner and loan data.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Capital Call Coverage</span>
        <span className={`text-lg font-bold ${colors.text}`}>{formatCoverageRatio(ratio)} · {status}</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barWidth}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>0x</span><span>1x (min)</span><span>2x (healthy)</span><span>3x+</span>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Uncalled capital ${Math.round(uncalled ?? 0).toLocaleString()} ÷ upcoming EMI
        (${Math.round(obligations).toLocaleString()} over {COVERAGE_WINDOW_MONTHS} mo).
        {status === 'Review'
          ? ' ⚠️ Insufficient uncalled capital to cover near-term debt service — issue capital call.'
          : status === 'Monitor'
            ? ' Marginal buffer — monitor partner commitments and EMI schedule.'
            : ' Healthy buffer — uncalled capital covers upcoming debt service.'}
      </p>
    </div>
  );
}

// ── Refinancing Recommendation ───────────────────────────────────────────────

function RefinancingRecommendation({ loans }: { loans: Loan[] }) {
  const MARKET_RATE = PROPDEV_MARKET_RATE;
  const highRateLoans = loans.filter(l => l.interestRate > MARKET_RATE && isActivePropDevLoan(l));

  const monthlySavings = useMemo(() => {
    return highRateLoans.reduce((s, l) => {
      const currentMonthlyInterest = (l.balance * l.interestRate) / 100 / 12;
      const newMonthlyInterest = (l.balance * MARKET_RATE) / 100 / 12;
      return s + (currentMonthlyInterest - newMonthlyInterest);
    }, 0);
  }, [highRateLoans]);

  if (highRateLoans.length === 0) {
    return (
      <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
        <CheckCircle2 size={16} className="shrink-0" />
        No refinancing needed — all active loans are at or below market rate ({MARKET_RATE}%).
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <TrendingDown size={20} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="font-semibold text-amber-800">Refinancing Opportunity Identified</h4>
          <p className="text-sm text-amber-700 mt-1">
            {highRateLoans.length} loan{highRateLoans.length > 1 ? 's' : ''} above market rate ({MARKET_RATE}%):
            {' '}{highRateLoans.map(l => `${l.bank} @ ${l.interestRate}%`).join(', ')}.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-amber-600 mb-0.5">Current Avg Rate</p>
              <p className="font-bold text-amber-800">
                {(highRateLoans.reduce((s,l)=>s+l.interestRate,0)/highRateLoans.length).toFixed(2)}%
              </p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-amber-600 mb-0.5">Market Rate</p>
              <p className="font-bold text-green-700">{MARKET_RATE}%</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-xs text-amber-600 mb-0.5">Est. Monthly Saving</p>
              <p className="font-bold text-green-700">{fmt(monthlySavings)}</p>
            </div>
          </div>
          <p className="text-xs text-amber-600 mt-2">
            Annual savings potential: <strong>{fmt(monthlySavings * 12)}</strong>. Initiate refinancing conversations now — allow 60–90 days for processing.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── EMI Tracker (This Month) ─────────────────────────────────────────────────

function EmiTracker({ loans }: { loans: Loan[] }) {
  const today = new Date();
  const dayOfMonth = today.getDate();

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800">EMI Tracker — This Month</h3>
        <p className="text-xs text-gray-400 mt-0.5">Today is the {dayOfMonth}{dayOfMonth === 1 ? 'st' : dayOfMonth === 2 ? 'nd' : dayOfMonth === 3 ? 'rd' : 'th'}</p>
      </div>
      <div className="divide-y divide-gray-100">
        {loans.filter(isActivePropDevLoan).map(loan => {
          const isPaid = dayOfMonth > loan.emiDate + 2;
          const isDue = dayOfMonth >= loan.emiDate && !isPaid;
          const isUpcoming = dayOfMonth < loan.emiDate;
          return (
            <div key={loan.id} className={`flex items-center justify-between px-4 py-3 ${isDue ? 'bg-amber-50' : ''}`}>
              <div>
                <p className="text-sm font-medium text-gray-900">{loan.bank}</p>
                <p className="text-xs text-gray-400">Due on {loan.emiDate}{loan.emiDate === 1 ? 'st' : 'th'} · A/c {loan.accountNo.slice(-4)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-gray-900">{fmt(loan.emi)}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  isPaid ? 'bg-green-100 text-green-700' :
                  isDue ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {isPaid ? 'Paid' : isDue ? 'Due Now' : `Due on ${loan.emiDate}th`}
                </span>
              </div>
            </div>
          );
        })}
        <div className="flex justify-between px-4 py-3 bg-gray-50">
          <span className="font-bold text-gray-900 text-sm">Total Monthly EMI</span>
          <span className="font-bold text-red-600">{fmt(loans.filter(isActivePropDevLoan).reduce((s,l)=>s+l.emi,0))}</span>
        </div>
      </div>
    </div>
  );
}

// ── Loan Register ─────────────────────────────────────────────────────────────

function LoanRegister({ loans, companies, allLoans }: { loans: Loan[]; companies: CompanyData[]; allLoans: Loan[] }) {
  const companyById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);
  const coverageByCompany = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeCapitalCallCoverage>>();
    for (const c of companies) m.set(c.id, computeCapitalCallCoverage(c, COVERAGE_WINDOW_MONTHS, allLoans));
    return m;
  }, [companies, allLoans]);

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-900 text-white"><h3 className="font-semibold">Loan Register</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              {['Company', 'Property', 'Bank', 'Loan Amount', 'Rate', 'EMI', 'Outstanding', 'Maturity', 'EMI Day', 'Call Coverage', 'Status'].map(h => (
                <th
                  key={h}
                  className={`px-3 py-2.5 whitespace-nowrap ${
                    ['Company', 'Property', 'Bank', 'Status'].includes(h) ? 'text-left' : 'text-right'
                  }`}
                >{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {loans.map(loan => {
              const company = companyById.get(loan.companyId);
              const coverage = company ? coverageByCompany.get(company.id) : undefined;
              const covStatus = coverage?.status ?? 'N/A';
              const propertyLabel = (loan.property || company?.property.name || '—').trim() || '—';
              const bankLabel = (loan.bank || '—').trim() || '—';
              return (
                <tr key={loan.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-left font-medium text-gray-900">{loan.company}</td>
                  <td className="px-3 py-2.5 text-left text-gray-800">{propertyLabel}</td>
                  <td className="px-3 py-2.5 text-left text-gray-800">{bankLabel}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(loan.amount)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{loan.interestRate.toFixed(2)}%</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(loan.emi)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{fmt(loan.balance)}</td>
                  <td className="px-3 py-2.5 text-right text-xs">{loan.maturityDate}</td>
                  <td className="px-3 py-2.5 text-right">{loan.emiDate}</td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {coverage?.dataGap ? 'N/A' : formatCoverageRatio(coverage?.ratio ?? null)}
                  </td>
                  <td className="px-3 py-2.5 text-left">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${COVERAGE_BADGE_STYLE[covStatus]}`}>{covStatus}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loans.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No loans found</p>}
      </div>
    </div>
  );
}

// ── Entity Capital Call Coverage Health (replaces Building DSCR Health) ───────

function EntityCoverageHealth({ companies, allLoans }: { companies: CompanyData[]; allLoans: Loan[] }) {
  const rows = useMemo(
    () => companies
      .map(c => ({ company: c, coverage: computeCapitalCallCoverage(c, COVERAGE_WINDOW_MONTHS, allLoans), emi: resolveCompanyMonthlyEmi(c, allLoans) }))
      .filter(r => r.emi > 0 || r.coverage.dataGap || allLoans.some(l => l.companyId === r.company.id)),
    [companies, allLoans],
  );

  if (rows.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800">Entity Capital Call Coverage Health</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Uncalled partner capital ÷ upcoming EMI ({COVERAGE_WINDOW_MONTHS} months) — development entities only
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              {['Entity', 'Monthly EMI', 'Uncalled Capital', `EMI (${COVERAGE_WINDOW_MONTHS} mo)`, 'Coverage', 'Status'].map(h => (
                <th key={h} className="px-4 py-2.5 text-right first:text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ company, coverage, emi }) => {
              const colors = coverageStatusColors(coverage.status);
              return (
                <tr key={company.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{company.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmt(emi)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {coverage.dataGap ? '—' : fmt(coverage.uncalled ?? 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmt(coverage.obligations)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${colors.text}`}>
                    {coverage.dataGap ? 'N/A' : formatCoverageRatio(coverage.ratio)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${COVERAGE_BADGE_STYLE[coverage.status]}`}>
                      {coverage.dataGap ? 'Data gap' : coverage.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some(r => r.coverage.dataGap) && (
        <p className="px-4 py-3 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
          Partner <strong>committed capital</strong> is not yet tracked in the data model. Add commitment amounts to partners to enable coverage ratios.
        </p>
      )}
    </div>
  );
}

// ── Section 1: Company-wise Loan KPI Cards ────────────────────────────────────

function CompanyLoanCards({ companies, marketRate, allLoans }: { companies: CompanyData[]; marketRate: number; allLoans: Loan[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-gray-900">Loan Position — By Company</h3>
        <p className="text-sm text-gray-500 mt-0.5">Click any card to expand loan details</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {companies.map(company => {
          const activeLoans = company.loans.filter(isActivePropDevLoan);
          if (activeLoans.length === 0) return null;
          const totalBalance = activeLoans.reduce((s, l) => s + l.balance, 0);
          const totalEMI    = resolveCompanyMonthlyEmi(company, allLoans);
          const coverage    = computeCapitalCallCoverage(company, COVERAGE_WINDOW_MONTHS, allLoans);
          const weightedRate = totalBalance > 0
            ? activeLoans.reduce((s, l) => s + l.interestRate * l.balance, 0) / totalBalance : 0;
          const nextEmiDate      = Math.min(...activeLoans.map(l => l.emiDate));
          const earliestMaturity = pickNextUpcomingMaturity(activeLoans)?.maturityDate;
          const isAboveMarket  = weightedRate > marketRate;
          const isLowCoverage  = coverage.ratio != null && coverage.ratio < 1;
          const now = new Date();
          const matDate = earliestMaturity ? new Date(earliestMaturity) : null;
          const daysToMaturity = matDate ? Math.round((matDate.getTime() - now.getTime()) / 86400000) : null;
          const isMaturingSoon = daysToMaturity !== null && daysToMaturity < 90 && daysToMaturity > 0;
          const borderColor = isLowCoverage ? 'border-red-400'
            : (isAboveMarket || isMaturingSoon) ? 'border-amber-400' : 'border-green-400';
          const isExpanded = expandedId === company.id;
          const annualSaving = isAboveMarket ? Math.round(totalBalance * (weightedRate - marketRate) / 100) : 0;
          const covColors = coverageStatusColors(coverage.status);

          return (
            <div key={company.id} className={`bg-white rounded-xl border-2 ${borderColor} overflow-hidden`}>
              <button
                className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : company.id)}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-gray-900 text-sm leading-tight">{company.name}</p>
                  <span className="text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs mb-3">
                  {[
                    ['Loans',       `${activeLoans.length} active`],
                    ['Outstanding', fmt(totalBalance)],
                    ['Avg Rate',    `${weightedRate.toFixed(2)}%`],
                    ['Monthly EMI', fmt(totalEMI)],
                    ['Next EMI',    `${nextEmiDate}th`],
                    ['Matures',     earliestMaturity ?? '—'],
                  ].map(([k, v]) => (
                    <div key={k}><span className="text-gray-400">{k}: </span><span className="font-medium text-gray-700">{v}</span></div>
                  ))}
                </div>
                <div className="flex items-center justify-between py-2 border-t border-gray-100">
                  <span className="text-xs text-gray-400">Capital Call Coverage</span>
                  <span className={`text-sm font-bold ${covColors.text}`}>
                    {coverage.dataGap ? 'N/A' : formatCoverageRatio(coverage.ratio)} {coverage.status !== 'N/A' ? `· ${coverage.status}` : ''}
                  </span>
                </div>
                <div className="space-y-1 mt-1">
                  {isLowCoverage      && <p className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">🔴 Coverage below 1x — insufficient uncalled capital for near-term EMI</p>}
                  {coverage.dataGap   && <p className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">⚪ Committed capital not tracked — add partner commitment amounts</p>}
                  {isAboveMarket      && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">🟠 Rate {weightedRate.toFixed(1)}% &gt; market {marketRate}% — saves {fmt(annualSaving)}/yr</p>}
                  {isMaturingSoon     && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">🟡 Loan matures in {daysToMaturity} days — begin refinancing</p>}
                  {!isLowCoverage && !coverage.dataGap && !isAboveMarket && !isMaturingSoon && <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">🟢 All metrics healthy</p>}
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-gray-200 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-400 uppercase">
                      <tr>{['Bank','Amount','Rate','EMI','Balance','Next EMI','End Date','Status'].map(h => (
                        <th key={h} className="px-3 py-2 text-right first:text-left whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {company.loans.map(l => (
                        <tr key={l.id} className={`hover:bg-gray-50 ${l.interestRate > marketRate ? 'bg-amber-50/40' : ''}`}>
                          <td className="px-3 py-2 font-medium">{l.bank}</td>
                          <td className="px-3 py-2 text-right">{fmt(l.amount)}</td>
                          <td className={`px-3 py-2 text-right font-medium ${l.interestRate > marketRate ? 'text-amber-700' : 'text-gray-700'}`}>{l.interestRate}%</td>
                          <td className="px-3 py-2 text-right">{fmt(l.emi)}</td>
                          <td className="px-3 py-2 text-right">{fmt(l.balance)}</td>
                          <td className="px-3 py-2 text-right">{l.emiDate}th</td>
                          <td className="px-3 py-2 text-right">{l.maturityDate}</td>
                          <td className="px-3 py-2 text-right"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[l.status]}`}>{l.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── EMI Calendar strip (matches Rentals Loan Tracker) ─────────────────────────

function EmiCalendarStrip({ loans, scopeLabel }: { loans: Loan[]; scopeLabel: string }) {
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const activeLoans = loans.filter(isActivePropDevLoan);

  return (
    <div style={{ background: PT.cardBg, borderRadius: 12, border: `1px solid ${PT.border}`, padding: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: PT.text, marginBottom: 12 }}>
        EMI Calendar — {scopeLabel} · {today.toLocaleString('default', { month: 'long', year: 'numeric' })}
      </h3>
      <div className="flex flex-wrap gap-1">
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
          const dueLoans = activeLoans.filter(l => l.emiDate === d);
          if (dueLoans.length === 0) {
            return (
              <div key={d} style={{ width: 28, height: 28, fontSize: 11, color: '#C5BDB0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {d}
              </div>
            );
          }
          return (
            <div key={d} className="relative group">
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#166534', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 3 }}>
                {d}
              </div>
              <div className="hidden group-hover:block absolute z-10 top-7 left-0 bg-gray-900 text-white text-xs rounded p-2 whitespace-nowrap">
                {dueLoans.map(l => (
                  <div key={l.id}>{l.bank}: {fmtUSD(l.emi)}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 3: Bank Rate Intelligence ─────────────────────────────────────────

function BankRateIntelligence({ companies }: { companies: CompanyData[] }) {
  const [marketRate, setMarketRate] = useState(6.5);
  const [calc, setCalc] = useState({ balance: '', currentRate: '', targetRate: '6.5' });

  const allLoans = companies.flatMap(c => c.loans.filter(isActivePropDevLoan));

  const bankMap: Record<string, { bank: string; loans: Loan[]; totalDebt: number; monthlyEMI: number; weightedRate: number }> = {};
  allLoans.forEach(l => {
    if (!bankMap[l.bank]) bankMap[l.bank] = { bank: l.bank, loans: [], totalDebt: 0, monthlyEMI: 0, weightedRate: 0 };
    bankMap[l.bank].loans.push(l);
    bankMap[l.bank].totalDebt  += l.balance;
    bankMap[l.bank].monthlyEMI += l.emi;
  });
  Object.values(bankMap).forEach(row => {
    row.weightedRate = row.totalDebt > 0
      ? row.loans.reduce((s,l) => s + l.interestRate * l.balance, 0) / row.totalDebt : 0;
  });
  const bankRows = Object.values(bankMap).sort((a,b) => b.totalDebt - a.totalDebt);

  const highRateLoans = allLoans.filter(l => l.interestRate > marketRate);
  const monthlySavingTotal = highRateLoans.reduce((s,l) => s + l.balance*(l.interestRate-marketRate)/100/12, 0);
  const totalOutstanding = allLoans.reduce((s,l) => s+l.balance, 0);
  const weightedAvgRate = totalOutstanding > 0
    ? allLoans.reduce((s,l) => s+l.interestRate*l.balance, 0) / totalOutstanding : 0;
  const bestRateBank = bankRows.length > 0 ? bankRows.reduce((b,r) => r.weightedRate < b.weightedRate ? r : b, bankRows[0]) : null;
  const refLoans = [...highRateLoans]
    .sort((a,b) => b.balance*(b.interestRate-marketRate) - a.balance*(a.interestRate-marketRate))
    .slice(0, 5);

  const calcBal  = parseFloat(calc.balance)      || 0;
  const calcCurR = parseFloat(calc.currentRate)  || 0;
  const calcTgtR = parseFloat(calc.targetRate)   || marketRate;
  const emiFormula = (bal: number, rate: number) =>
    bal > 0 && rate > 0 ? (bal*(rate/100/12)) / (1 - Math.pow(1+rate/100/12, -240)) : 0;
  const calcCurEMI  = emiFormula(calcBal, calcCurR);
  const calcNewEMI  = emiFormula(calcBal, calcTgtR);
  const calcSaving  = Math.max(0, calcCurEMI - calcNewEMI);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">🏦 Bank Rate Intelligence</h3>
          <p className="text-sm text-gray-500 mt-0.5">Strategic insights on refinancing opportunities</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Market Rate Benchmark:</label>
          <input type="number" step="0.1" value={marketRate}
            onChange={e => setMarketRate(parseFloat(e.target.value)||6.5)}
            className="w-16 border rounded-lg px-2 py-1 text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h4 className="font-semibold text-gray-800">Current Rates by Bank</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
              <tr>{['Bank','Loans','Total Debt','Current Rate','Market Rate','Above Market?','Annual Saving','Recommendation'].map(h => (
                <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bankRows.map(row => {
                const above = row.weightedRate > marketRate;
                const annSave = above ? Math.round(row.totalDebt*(row.weightedRate-marketRate)/100) : 0;
                return (
                  <tr key={row.bank} className={`hover:bg-gray-50 ${above ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-900">{row.bank}</td>
                    <td className="px-4 py-3 text-right">{row.loans.length}</td>
                    <td className="px-4 py-3 text-right">{fmt(row.totalDebt)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${above ? 'text-red-600' : 'text-green-700'}`}>{row.weightedRate.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-gray-500">{marketRate.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right">{above ? <span className="text-red-600 font-medium">+{(row.weightedRate-marketRate).toFixed(2)}%</span> : <span className="text-green-600">✓</span>}</td>
                    <td className="px-4 py-3 text-right font-semibold text-green-700">{annSave > 0 ? fmt(annSave) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${above ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {above ? '↓ REFINANCE' : '✓ OPTIMAL'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        {bestRateBank && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-bold text-blue-900 mb-1">💡 INSIGHT 1 — BEST RATE BANK</p>
            <p className="text-sm text-blue-800"><strong>{bestRateBank.bank}</strong> offers the lowest weighted rate at <strong>{bestRateBank.weightedRate.toFixed(2)}%</strong> across <strong>{bestRateBank.loans.length} loan{bestRateBank.loans.length>1?'s':''}</strong> totaling <strong>{fmt(bestRateBank.totalDebt)}</strong>. Consider consolidating higher-rate loans here.</p>
          </div>
        )}
        <div className={`border rounded-xl p-4 space-y-3 ${highRateLoans.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <p className={`text-sm font-bold mb-1 ${highRateLoans.length > 0 ? 'text-amber-900' : 'text-green-900'}`}>💡 INSIGHT 2 — REFINANCING OPPORTUNITY</p>
          {highRateLoans.length > 0 ? (
            <>
              <p className="text-sm text-amber-800"><strong>{highRateLoans.length} loan{highRateLoans.length>1?'s':''}</strong> above market rate ({marketRate}%) totaling <strong>{fmt(highRateLoans.reduce((s,l)=>s+l.balance,0))}</strong>. Refinancing saves <strong>{fmt(monthlySavingTotal)}/month</strong> | <strong>{fmt(monthlySavingTotal*12)}/year</strong>.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-amber-100 text-amber-700 uppercase">
                    <tr>{['Company','Bank','Cur Rate','Target','Mo Saving','Yr Saving','Action'].map(h => <th key={h} className="px-3 py-1.5 text-right first:text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {refLoans.map(l => {
                      const ms = Math.round(l.balance*(l.interestRate-marketRate)/100/12);
                      return (
                        <tr key={l.id}>
                          <td className="px-3 py-1.5 font-medium">{l.company}</td>
                          <td className="px-3 py-1.5">{l.bank}</td>
                          <td className="px-3 py-1.5 text-right text-red-700 font-medium">{l.interestRate}%</td>
                          <td className="px-3 py-1.5 text-right text-green-700">{marketRate.toFixed(1)}%</td>
                          <td className="px-3 py-1.5 text-right">{fmt(ms)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{fmt(ms*12)}</td>
                          <td className="px-3 py-1.5 text-right"><span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium">Refinance</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-green-800">All loans at or below market rate ({marketRate}%). No refinancing needed.</p>
          )}
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-bold text-gray-900 mb-2">💡 INSIGHT 3 — RATE TREND</p>
          <p className="text-sm text-gray-700 mb-2">Weighted avg portfolio rate is <strong>{weightedAvgRate.toFixed(2)}%</strong> vs market <strong>{marketRate}%</strong>. {refLoans.length > 0 ? 'Priority refinancing order (by annual saving):' : 'All loans at or below market rate.'}</p>
          {refLoans.length > 0 && (
            <ol className="space-y-1">{refLoans.map((l, i) => (
              <li key={l.id} className="text-sm text-gray-700">
                <strong>{i+1}.</strong> {l.company} · {l.bank} @ <span className="text-red-600 font-medium">{l.interestRate}%</span> — saves <strong>{fmt(Math.round(l.balance*(l.interestRate-marketRate)/100))}/yr</strong>
              </li>
            ))}</ol>
          )}
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-bold text-green-900 mb-2">💡 INSIGHT 4 — BEST BANK TO APPROACH</p>
          <div className="space-y-1 text-sm text-green-800">
            {bankRows.slice(0,3).map((b,i) => (
              <p key={b.bank}><strong>{b.bank}</strong> — {b.weightedRate.toFixed(2)}% avg rate · {fmt(b.totalDebt)} total · {b.loans.length} loan{b.loans.length>1?'s':''}{i===0?' (largest lender)':''}</p>
            ))}
            {bestRateBank && <p className="mt-1 font-medium">Best rate: <strong>{bestRateBank.bank}</strong> @ {bestRateBank.weightedRate.toFixed(2)}% — ideal for consolidation.</p>}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-800 mb-4">Refinancing Calculator</h4>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {[
            { label:'Outstanding Balance ($)', key:'balance' as const, placeholder:'1,500,000' },
            { label:'Current Rate (%)',         key:'currentRate' as const, placeholder:'7.5' },
            { label:'Target Rate (%)',          key:'targetRate' as const, placeholder:'6.5' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="text-xs text-gray-500 block mb-1">{label}</label>
              <input type="number" value={calc[key]} placeholder={placeholder}
                onChange={e => setCalc(p => ({ ...p, [key]: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
        </div>
        {calcBal > 0 && calcCurR > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-green-50 rounded-xl">
            {[
              { label:'Current EMI',   value:fmt(Math.round(calcCurEMI)),  color:'text-red-700' },
              { label:'New EMI',       value:fmt(Math.round(calcNewEMI)),  color:'text-green-700' },
              { label:'Monthly Saving',value:fmt(Math.round(calcSaving)),  color:'text-green-700' },
              { label:'Annual Saving', value:fmt(Math.round(calcSaving*12)),color:'text-green-800 font-bold' },
            ].map(({ label, value, color }) => (
              <div key={label}><p className="text-xs text-gray-500 mb-0.5">{label}</p><p className={`text-lg font-bold ${color}`}>{value}</p></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section 4: Cash Position + EMI Alerts ─────────────────────────────────────

function CashPositionAlerts({ companies, allLoans }: { companies: CompanyData[]; allLoans: Loan[] }) {
  const [cashPositions, setCashPositions] = useState<Record<string, { amount: number; date: string; bank: string }>>({});
  const [formCompanyId, setFormCompanyId] = useState(companies[0]?.id ?? '');
  const [formCash,      setFormCash]      = useState('');
  const [formBank,      setFormBank]      = useState('');
  const today = new Date().toISOString().split('T')[0];

  // Sync cash positions when companies load from API (initial state alone misses async data).
  useEffect(() => {
    setCashPositions(prev => {
      const next = { ...prev };
      for (const c of companies) {
        if (!next[c.id]) {
          next[c.id] = {
            amount: c.property.cashAvailable,
            date: today,
            bank: 'Operating Account',
          };
        }
      }
      return next;
    });
    if (!formCompanyId && companies[0]?.id) {
      setFormCompanyId(companies[0].id);
    }
  }, [companies, today, formCompanyId]);

  const emiByCompanyId = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of companies) m.set(c.id, resolveCompanyMonthlyEmi(c, allLoans));
    return m;
  }, [companies, allLoans]);

  function updateCash() {
    if (!formCompanyId || !formCash) return;
    setCashPositions(prev => ({ ...prev, [formCompanyId]: { amount: parseFloat(formCash.replace(/,/g,''))||0, date: today, bank: formBank || 'Operating Account' } }));
    setFormCash(''); setFormBank('');
  }

  interface AlertItem { id: string; severity: 'critical'|'warning'|'watch'; company: string; message: string; detail: string; actions: string[]; }
  const alerts: AlertItem[] = [];
  companies.forEach(c => {
    const pos = cashPositions[c.id];
    const monthlyEMI = emiByCompanyId.get(c.id) ?? 0;
    const cash = pos?.amount ?? 0;
    const status = cashEmiStatus(cash, monthlyEMI);
    const daysSince = pos?.date ? Math.round((new Date().getTime()-new Date(pos.date).getTime())/86400000) : 0;
    if (status.kind === 'critical')
      alerts.push({ id:`crit-${c.id}`, severity:'critical', company:c.name, message:`Cash covers only ${status.ratio!.toFixed(1)} months of EMI`, detail:`Cash: ${fmt(cash)} | Monthly EMI: ${fmt(monthlyEMI)}`, actions:['Update Cash','View Loans'] });
    else if (status.kind === 'warning' || status.kind === 'monitor')
      alerts.push({ id:`warn-${c.id}`, severity:'warning', company:c.name, message:`Cash covers ${status.ratio!.toFixed(1)} months of EMI`, detail:`Consider capital call or lot sale to boost liquidity`, actions:['Issue Capital Call','View Lots'] });
    if (daysSince >= 7)
      alerts.push({ id:`stale-${c.id}`, severity:'watch', company:c.name, message:`Cash position not updated since ${pos?.date ?? 'unknown'}`, detail:`${daysSince} days since last update`, actions:['Update Now'] });
  });

  const sevCfg = {
    critical: { bg:'bg-red-50',    border:'border-l-red-500',    icon:'🔴', color:'text-red-700'    },
    warning:  { bg:'bg-amber-50',  border:'border-l-amber-500',  icon:'🟠', color:'text-amber-700'  },
    watch:    { bg:'bg-yellow-50', border:'border-l-yellow-400', icon:'🟡', color:'text-yellow-700' },
  };

  return (
    <div className="space-y-5">
      <div><h3 className="text-lg font-bold text-gray-900">💵 Cash Position & EMI Alert System</h3></div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-800 mb-4">Update Cash Position</h4>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Company</label>
            <select value={formCompanyId} onChange={e => setFormCompanyId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Cash Available ($)</label>
            <input type="text" value={formCash} onChange={e => setFormCash(e.target.value)} placeholder="e.g. 450,000"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Bank Account</label>
            <input type="text" value={formBank} onChange={e => setFormBank(e.target.value)} placeholder="Operating Account"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={updateCash} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Update</button>
        </div>
        <p className="text-xs text-gray-400 mt-2">As of date: {today} (auto-filled)</p>
      </div>

      {alerts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 bg-red-900 text-white"><h4 className="font-semibold">🔔 ACTIVE ALERTS ({alerts.length})</h4></div>
          <div className="divide-y divide-gray-100">
            {alerts.map(alert => {
              const cfg = sevCfg[alert.severity];
              return (
                <div key={alert.id} className={`p-4 ${cfg.bg} border-l-4 ${cfg.border}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${cfg.color}`}>{cfg.icon} {alert.company} — {alert.message}</p>
                      <p className={`text-xs mt-0.5 ${cfg.color} opacity-80`}>{alert.detail}</p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      {alert.actions.map(a => (
                        <button key={a} className="text-xs px-2 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 whitespace-nowrap">{a}</button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h4 className="font-semibold text-gray-800">Cash vs EMI Dashboard</h4></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-400 text-xs uppercase">
              <tr>{['Company','Cash Available','Monthly EMI','Cash/EMI Ratio','Months Covered','Last Updated','Status'].map(h => (
                <th key={h} className="px-4 py-3 text-right first:text-left whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {companies.map(c => {
                const pos = cashPositions[c.id];
                const monthlyEMI = emiByCompanyId.get(c.id) ?? 0;
                const cash = pos?.amount ?? 0;
                const status = cashEmiStatus(cash, monthlyEMI);
                const daysSince = pos?.date ? Math.round((new Date().getTime()-new Date(pos.date).getTime())/86400000) : 0;
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(cash)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(monthlyEMI)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCoverageRatio(status.ratio)}</td>
                    <td className="px-4 py-3 text-right">{status.months != null ? `${status.months.toFixed(1)} mo` : '—'}</td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {daysSince === 0 ? 'Today' : `${daysSince}d ago`}{daysSince >= 7 && <span className="text-amber-600 ml-1">⚠️</span>}
                    </td>
                    <td className="px-4 py-3 text-right"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.badgeClass}`}>{status.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Section 5: 90-Day Cash Flow Forecast ─────────────────────────────────────

function CashFlowForecast({ companies, allLoans }: { companies: CompanyData[]; allLoans: Loan[] }) {
  const today = new Date();
  const monthLabels = [0,1,2].map(offset => {
    const d = new Date(today.getFullYear(), today.getMonth()+offset, 1);
    return d.toLocaleDateString('en-US', { month:'short', year:'numeric' });
  });

  const forecasts = companies.map(c => {
    const monthlyEMI  = resolveCompanyMonthlyEmi(c, allLoans);
    const monthly$Col = c.customers.reduce((s,cust)=>s+cust.collected,0)/6;
    let cash = c.property.cashAvailable;
    return {
      company: c.name,
      rows: monthLabels.map(month => {
        const closing = cash - monthlyEMI + monthly$Col;
        const row = { month, openingCash:Math.round(cash), emiDue:Math.round(monthlyEMI), collections:Math.round(monthly$Col), closingCash:Math.round(closing), isNegative:closing<0 };
        cash = closing; return row;
      }),
    };
  });

  const portRows = monthLabels.map((month, mi) => ({
    month,
    openingCash:  forecasts.reduce((s,f)=>s+f.rows[mi].openingCash,0),
    emiDue:       forecasts.reduce((s,f)=>s+f.rows[mi].emiDue,0),
    collections:  forecasts.reduce((s,f)=>s+f.rows[mi].collections,0),
    closingCash:  forecasts.reduce((s,f)=>s+f.rows[mi].closingCash,0),
    isNegative:   false,
  }));
  portRows.forEach(r => { r.isNegative = r.closingCash < 0; });

  const chartData = monthLabels.map((month, i) => ({
    month, cash:portRows[i].closingCash, emi:portRows[i].emiDue, collections:portRows[i].collections,
  }));

  const negForecast = forecasts.find(f => f.rows.some(r => r.isNegative));

  const forecastTable = (rows: typeof forecasts[0]['rows'], label: string, dark = false) => (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-4 py-3 border-b border-gray-100 ${dark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <h4 className={`font-semibold text-sm ${dark ? 'text-white' : 'text-gray-700'}`}>{label}</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-400 text-xs uppercase bg-gray-50">
            <tr>{['Month','Opening Cash','EMI Due','Collections','Closing Cash','Status'].map(h => (
              <th key={h} className="px-4 py-2 text-right first:text-left">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr key={row.month} className={row.isNegative ? 'bg-red-50' : 'hover:bg-gray-50'}>
                <td className="px-4 py-2 font-medium text-gray-900">{row.month}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(row.openingCash)}</td>
                <td className="px-4 py-2 text-right font-mono text-red-600">({fmt(row.emiDue)})</td>
                <td className="px-4 py-2 text-right font-mono text-green-700">+{fmt(row.collections)}</td>
                <td className={`px-4 py-2 text-right font-bold font-mono ${row.isNegative ? 'text-red-700' : 'text-gray-900'}`}>{fmt(row.closingCash)}</td>
                <td className="px-4 py-2 text-right">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.isNegative ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {row.isNegative ? '🔴 Shortfall' : '🟢 OK'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-bold text-gray-900">90-Day Cash & EMI Outlook</h3>
        <p className="text-sm text-gray-500 mt-0.5">Combined cash position and EMI obligations for next 3 months</p>
      </div>

      {negForecast && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4">
          <p className="text-sm font-bold text-red-700">🔴 Cash shortfall projected for {negForecast.rows.find(r=>r.isNegative)?.month}:</p>
          <p className="text-sm text-red-600 mt-1">
            {negForecast.company} needs additional {fmt(Math.abs(negForecast.rows.find(r=>r.isNegative)?.closingCash??0))}.
            Options: <strong>Capital call</strong> | <strong>Lot sale</strong> | <strong>Bridge loan</strong> | <strong>Defer distribution</strong>
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h4 className="font-semibold text-gray-700 text-sm mb-3">Portfolio Cash vs EMI — 3 Month View</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="month" tick={{ fontSize:12 }} />
            <YAxis tick={{ fontSize:11 }} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} />
            <Tooltip formatter={(v:number)=>[`$${v.toLocaleString()}`,'']} />
            <Legend />
            <Bar dataKey="cash"        fill="#16A34A" name="Closing Cash"  radius={[4,4,0,0]} />
            <Bar dataKey="emi"         fill="#DC2626" name="EMI Due"       radius={[4,4,0,0]} />
            <Bar dataKey="collections" fill="#5B5FEF" name="Collections"   radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {forecasts.slice(0,5).map(f => forecastTable(f.rows, f.company))}
      {forecastTable(portRows, 'Portfolio Total', true)}
    </div>
  );
}

// ── Main Component (layout mirrors Rentals Loan Tracker) ──────────────────────

export default function PD07Loans() {
  const { refetchCompanies, selectedCompanyId } = usePropDev();
  const { setTab } = usePropDevNav();
  const [showUpload, setShowUpload] = useState(false);
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pageTab, setPageTab] = useState<'overview' | 'loan-management' | 'calculations'>('overview');

  useEffect(() => {
    setPropertyFilter('all');
  }, [selectedCompanyId]);
  const {
    allLoans,
    scopedLoans,
    scopedCompanies,
    scopeLabel: navScopeLabel,
    debtByProperty,
    emiByBank,
    maturityLadder,
    rateVariance,
    companies,
    companiesWithLoans,
  } = usePropDevLoanTrackerData();

  const companyOptions = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const propertyOptions = useMemo(() => {
    const src = selectedCompanyId !== 'all'
      ? allLoans.filter(l => l.companyId === selectedCompanyId)
      : allLoans;
    return [...new Set(src.map(l => l.property).filter(Boolean))].sort();
  }, [allLoans, selectedCompanyId]);

  const filtered = useMemo(() => {
    let rows = scopedLoans;
    if (propertyFilter !== 'all') rows = rows.filter(l => l.property === propertyFilter);
    return rows;
  }, [scopedLoans, propertyFilter]);

  const activeFiltered = useMemo(() => filtered.filter(isActivePropDevLoan), [filtered]);

  const scopeLabel = useMemo(() => {
    if (selectedCompanyId !== 'all' && propertyFilter !== 'all') {
      const co = companies.find(c => c.id === selectedCompanyId)?.name ?? navScopeLabel;
      return `${co} · ${propertyFilter}`;
    }
    if (propertyFilter !== 'all') return propertyFilter;
    return navScopeLabel;
  }, [selectedCompanyId, propertyFilter, companies, navScopeLabel]);

  const kpis = useMemo(() => {
    const loanTaken = filtered.reduce((s, l) => s + (l.amount ?? 0), 0);
    const outstanding = activeFiltered.reduce((s, l) => s + (l.balance ?? 0), 0);
    const emi = activeFiltered.reduce((s, l) => s + (l.emi ?? 0), 0);
    const withBal = activeFiltered.filter(l => l.balance > 0);
    const wAvg = withBal.length > 0
      ? withBal.reduce((s, l) => s + l.interestRate * l.balance, 0)
        / withBal.reduce((s, l) => s + l.balance, 0)
      : 0;
    const nextMat = pickNextUpcomingMaturity(filtered);
    const nextEmiDay = nextMat?.emiDate
      ?? (activeFiltered.length > 0 ? Math.min(...activeFiltered.map(l => l.emiDate)) : null);
    return {
      loanTaken,
      outstanding,
      emi,
      wAvg,
      nextMat,
      nextEmiDay,
      loanCount: filtered.length,
      activeCount: activeFiltered.length,
    };
  }, [filtered, activeFiltered]);

  const portfolioCoverage = useMemo(
    () => computePortfolioCapitalCallCoverage(scopedCompanies, COVERAGE_WINDOW_MONTHS, allLoans),
    [scopedCompanies, allLoans],
  );

  const companyById = useMemo(() => new Map(companies.map(c => [c.id, c])), [companies]);

  const extKpis = useMemo(() => {
    const now = new Date();
    const totalOutstanding = sumActivePropDevLoanBalances(activeFiltered);

    const loansWithMaturity = filtered.filter(l => l.maturityDate);
    const weightedTermNum = loansWithMaturity.reduce((s, l) => {
      const bal = l.balance ?? 0;
      const mat = new Date(l.maturityDate!);
      const months = Math.max(0, (mat.getFullYear() - now.getFullYear()) * 12 + mat.getMonth() - now.getMonth());
      return s + months * bal;
    }, 0);
    const weightedTermDen = loansWithMaturity.reduce((s, l) => s + (l.balance ?? 0), 0);
    const weightedAvgTerm = weightedTermDen > 0 ? weightedTermNum / weightedTermDen : null;

    const in12 = filtered.filter(l => {
      if (!l.maturityDate) return false;
      const mat = new Date(l.maturityDate);
      const months = (mat.getFullYear() - now.getFullYear()) * 12 + mat.getMonth() - now.getMonth();
      return months >= 0 && months <= 12;
    });
    const maturingCount = in12.length;
    const maturingAmt = in12.reduce((s, l) => s + (l.balance ?? 0), 0);

    // Portfolio LTLV = Σ outstanding ÷ Σ land (same formula as CFO) — not average of per-loan LTLVs.
    let landForLtlv = 0;
    let ltlvLoanCount = 0;
    const landSeen = new Set<string>();
    activeFiltered.forEach(l => {
      const co = companyById.get(l.companyId);
      if (!co) return;
      ltlvLoanCount += 1;
      if (landSeen.has(co.id)) return;
      landSeen.add(co.id);
      const lv = resolveLandValue(co);
      if (lv != null && lv > 0) landForLtlv += lv;
    });
    const avgLtlv = portfolioLtlvPercent(totalOutstanding, landForLtlv > 0 ? landForLtlv : null);

    const byProperty: Record<string, number> = {};
    const byLender: Record<string, number> = {};
    activeFiltered.forEach(l => {
      const bal = l.balance ?? 0;
      const prop = l.property || l.company || 'Unknown';
      byProperty[prop] = (byProperty[prop] || 0) + bal;
      byLender[l.bank || 'Unknown'] = (byLender[l.bank || 'Unknown'] || 0) + bal;
    });
    const maxProperty = Object.entries(byProperty).sort((a, b) => b[1] - a[1])[0];
    const maxLender = Object.entries(byLender).sort((a, b) => b[1] - a[1])[0];
    const topPropertyPct = totalOutstanding > 0 && maxProperty ? maxProperty[1] / totalOutstanding * 100 : null;
    const topLenderPct = totalOutstanding > 0 && maxLender ? maxLender[1] / totalOutstanding * 100 : null;

    return {
      weightedAvgTerm,
      maturingCount,
      maturingAmt,
      avgLtlv,
      ltlvCount: landSeen.size,
      coverage: portfolioCoverage,
      topProperty: maxProperty?.[0] ?? '',
      topPropertyPct,
      topLender: maxLender?.[0] ?? '',
      topLenderPct,
    };
  }, [filtered, activeFiltered, companyById, portfolioCoverage]);

  const chartDebt = useMemo(() => {
    if (propertyFilter === 'all' && selectedCompanyId === 'all') return debtByProperty;
    const map: Record<string, number> = {};
    filtered.forEach(l => {
      const key = l.property || l.company || 'Unknown';
      map[key] = (map[key] ?? 0) + (l.balance ?? 0);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value, label: name.length > 18 ? `${name.slice(0, 16)}…` : name }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, propertyFilter, selectedCompanyId, debtByProperty]);

  const chartEmi = useMemo(() => {
    const map: Record<string, number> = {};
    activeFiltered.forEach(l => {
      map[l.bank || 'Unknown'] = (map[l.bank || 'Unknown'] ?? 0) + (l.emi ?? 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [activeFiltered]);

  const chartMaturity = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(l => {
      if (!l.maturityDate) return;
      const year = l.maturityDate.slice(0, 4);
      map[year] = (map[year] ?? 0) + (l.balance ?? 0);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([year, amount]) => ({ year, amount }));
  }, [filtered]);

  const chartRateVar = useMemo(() => {
    return activeFiltered
      .filter(l => l.interestRate != null)
      .map(l => ({
        name: (l.property || l.company || l.bank).slice(0, 20),
        bps: Math.round((l.interestRate - PROPDEV_MARKET_RATE) * 100),
        rate: l.interestRate,
      }));
  }, [activeFiltered]);

  const highRateLoans = activeFiltered.filter(l => l.interestRate > PROPDEV_MARKET_RATE);
  const monthlySavings = highRateLoans.reduce((s, l) => {
    return s + (l.balance * (l.interestRate - PROPDEV_MARKET_RATE)) / 100 / 12;
  }, 0);

  const filteredCompanies = useMemo(() => {
    const ids = new Set(filtered.map(l => l.companyId));
    return companies.filter(c => ids.has(c.id));
  }, [filtered, companies]);

  const [exportingPdf, setExportingPdf] = useState(false);

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const registerCompanies = filteredCompanies.length ? filteredCompanies : scopedCompanies;
      await exportPropDevLoansPdf({
        entityLabel: scopeLabel,
        periodLabel: 'Current',
        propertyFilterLabel: propertyFilter === 'all' ? 'All Properties' : propertyFilter,
        loans: filtered,
        companies: registerCompanies,
        allLoans,
        marketRate: PROPDEV_MARKET_RATE,
        kpis: {
          loanTaken: kpis.loanTaken,
          outstanding: kpis.outstanding,
          emi: kpis.emi,
          wAvg: kpis.wAvg,
          loanCount: kpis.loanCount,
          activeCount: kpis.activeCount,
          nextMaturity: kpis.nextMat?.maturityDate ?? null,
          nextMaturityProperty: kpis.nextMat?.property ?? null,
          nextEmiDay: kpis.nextEmiDay,
          weightedAvgTermMonths: extKpis.weightedAvgTerm,
          maturingCount: extKpis.maturingCount,
          maturingAmt: extKpis.maturingAmt,
          topProperty: extKpis.topProperty,
          topPropertyPct: extKpis.topPropertyPct,
          topLender: extKpis.topLender,
          topLenderPct: extKpis.topLenderPct,
          avgLtlv: extKpis.avgLtlv,
        },
        coverage: {
          ratio: portfolioCoverage.ratio,
          status: portfolioCoverage.status,
          dataGap: portfolioCoverage.dataGap,
          obligations: portfolioCoverage.obligations,
          uncalled: portfolioCoverage.uncalled,
        },
        debtByProperty: (chartDebt.length ? chartDebt : debtByProperty).map(d => ({
          name: d.name, value: d.value,
        })),
        emiByBank: (chartEmi.length ? chartEmi : emiByBank).map(d => ({
          name: d.name, value: d.value,
        })),
        maturityLadder: chartMaturity.length ? chartMaturity : maturityLadder,
        highRateCount: highRateLoans.length,
        monthlyRefinanceSavings: monthlySavings,
      });
    } catch (e: unknown) {
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportingPdf(false);
    }
  }, [
    scopeLabel, propertyFilter, filtered, filteredCompanies, scopedCompanies, allLoans,
    kpis, extKpis, portfolioCoverage, chartDebt, debtByProperty, chartEmi, emiByBank,
    chartMaturity, maturityLadder, highRateLoans.length, monthlySavings,
  ]);

  useEffect(() => {
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<{ scope?: string }>).detail ?? {};
      if (detail.scope && detail.scope !== 'loans') return;
      void handleExportPdf();
    };
    window.addEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
    return () => window.removeEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
  }, [handleExportPdf]);

  return (
    <div className="space-y-6" style={{ background: PT.pageBg, fontSize: 13, color: PT.text }}>
      {/* Header — same chrome as Rentals */}
      <PropDevPageHeader
        title="Loan Tracker"
        subtitle={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>{scopeLabel} · Prop Dev debt, capital-call coverage, refinancing & amortization</span>
            <span>
              Loan Outstanding uses the <strong>Loan Balance</strong> column from Bank Loan Information — not Balance Sheet LTD.
              {companiesWithLoans.length > 0 && (
                <> · {companiesWithLoans.length} of {companies.length} entities with loan data</>
              )}
            </span>
          </div>
        }
        actions={
          <>
          <select
            value={propertyFilter}
            onChange={e => setPropertyFilter(e.target.value)}
            className="border rounded-lg px-2.5 py-1.5 text-sm"
            style={{ borderColor: PT.border, background: PT.cardBg, color: PT.text }}
          >
            <option value="all">All Properties</option>
            {propertyOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf}
            style={{ ...parchmentStyles.btnSecondary, opacity: exportingPdf ? 0.7 : 1 }}
            title="Export Loan Tracker PDF"
          >
            <Download size={13} /> {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </button>
          <button type="button" className="flex items-center gap-1 px-3 py-1.5 text-white rounded-lg text-xs"
            style={{ background: 'linear-gradient(135deg,#5B5FEF,#4F46E5)' }}>
            <Zap size={13} /> AI Insights
          </button>
          <button
            type="button"
            onClick={() => setShowUpload(v => !v)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-white rounded-lg text-sm font-medium"
            style={{ background: '#7C3AED' }}
          >
            <FileSpreadsheet size={14} />{showUpload ? 'Hide Import' : 'Import Excel'}
          </button>
          <button
            type="button"
            onClick={() => setTab('upload')}
            className="flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs"
            style={{ borderColor: PT.border, color: PT.text, background: PT.cardBg }}
          >
            <Upload size={12} /> Full Workbook
          </button>
          </>
        }
      />

      <div className="flex gap-1 border-b" style={{ borderColor: PT.border }}>
        {([
          { id: 'overview' as const, label: 'Overview' },
          { id: 'loan-management' as const, label: 'Loan Management' },
          { id: 'calculations' as const, label: 'Calculations' },
        ]).map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setPageTab(t.id)}
            className="px-3 py-2 text-xs font-medium border-b-2 -mb-px"
            style={{
              borderColor: pageTab === t.id ? '#5B5FEF' : 'transparent',
              color: pageTab === t.id ? PT.text : PT.muted,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {pageTab === 'loan-management' && (
        <PDLoanManagementTab loans={scopedLoans} companies={scopedCompanies} allLoans={allLoans} />
      )}

      {pageTab === 'calculations' && (
        <PDLoanCalculationsTab loans={scopedLoans} companies={scopedCompanies} allLoans={allLoans} />
      )}

      {pageTab === 'overview' && <>
      {(showUpload || allLoans.length === 0) && (
        <PropDevLoanUpload
          onImported={async () => { await refetchCompanies(); }}
          onClose={allLoans.length > 0 ? () => setShowUpload(false) : undefined}
        />
      )}

      {/* Primary KPIs — EMI Date sits next to Next Maturity */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
        {[
          { label: 'Loan Taken', value: fmtUSD(kpis.loanTaken), hero: true, sub: `${scopeLabel} · sum of Loan Amount` },
          { label: 'Loan Outstanding', value: fmtUSD(kpis.outstanding), sub: `${scopeLabel} · Loan Tracker (Active + Current)` },
          { label: 'Total Monthly EMI', value: fmtUSD(kpis.emi), sub: scopeLabel },
          { label: 'Weighted Avg Rate', value: `${kpis.wAvg.toFixed(2)}%`, sub: 'Weighted by outstanding balance' },
          {
            label: selectedCompanyId !== 'all' ? 'Company Loans' : 'Total Loans',
            value: String(kpis.loanCount),
            sub: selectedCompanyId !== 'all'
              ? (propertyFilter !== 'all' ? propertyFilter : scopeLabel)
              : `${companyOptions.length} companies`,
          },
          { label: 'Next Maturity', value: kpis.nextMat?.maturityDate ?? '—', sub: kpis.nextMat?.property ?? 'No upcoming maturity' },
          {
            label: 'EMI Date',
            value: kpis.nextEmiDay != null
              ? `${kpis.nextEmiDay}${kpis.nextEmiDay === 1 ? 'st' : kpis.nextEmiDay === 2 ? 'nd' : kpis.nextEmiDay === 3 ? 'rd' : 'th'}`
              : '—',
            sub: kpis.nextEmiDay != null
              ? (kpis.nextMat ? `Due day · ${kpis.nextMat.property}` : 'Monthly EMI due day')
              : 'No EMI day on loans',
          },
        ].map(k => (
          <div key={k.label} style={{
            background: k.hero ? 'linear-gradient(135deg,#5B5FEF,#4F46E5)' : PT.cardBg,
            border: k.hero ? '1px solid #5B5FEF' : `1px solid ${PT.border}`,
            ...LT_KPI_CARD,
          }}>
            <p style={{ ...LT_KPI_LABEL, color: k.hero ? 'rgba(255,255,255,0.85)' : PT.muted }}>{k.label}</p>
            <p style={{ ...LT_KPI_VALUE, color: k.hero ? '#fff' : PT.text }}>{k.value}</p>
            {k.sub && <p style={{ ...LT_KPI_SUB, color: k.hero ? 'rgba(255,255,255,0.75)' : PT.muted }} title={k.sub}>{k.sub}</p>}
          </div>
        ))}
      </div>

      {/* Extended KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, ...LT_KPI_CARD }}>
          <p style={{ ...LT_KPI_LABEL, color: PT.muted }}>Wtd Avg Remaining Term</p>
          {extKpis.weightedAvgTerm != null ? (
            <>
              <p style={{
                ...LT_KPI_VALUE,
                color: extKpis.weightedAvgTerm < 12 ? '#C0392B' : extKpis.weightedAvgTerm < 36 ? '#B45309' : PT.text,
              }}>
                {Math.round(extKpis.weightedAvgTerm)}mo
              </p>
              <p style={{ ...LT_KPI_SUB, color: PT.muted }}>~{(extKpis.weightedAvgTerm / 12).toFixed(1)} yrs · weighted by balance</p>
            </>
          ) : (
            <p style={LT_KPI_NA}>No maturity dates</p>
          )}
        </div>

        <div style={{
          background: PT.cardBg, border: `1px solid ${PT.border}`, ...LT_KPI_CARD,
          borderLeft: extKpis.maturingCount > 0 ? '3px solid #C0392B' : `1px solid ${PT.border}`,
        }}>
          <p style={{ ...LT_KPI_LABEL, color: PT.muted }}>Maturing ≤12 Months</p>
          <p style={{ ...LT_KPI_VALUE, color: extKpis.maturingCount > 0 ? '#C0392B' : '#166534' }}>
            {extKpis.maturingCount} loan{extKpis.maturingCount !== 1 ? 's' : ''}
          </p>
          <p style={{ ...LT_KPI_SUB, color: PT.muted }}>
            {extKpis.maturingCount > 0 ? `${fmtUSD(extKpis.maturingAmt)} coming due` : 'No near-term maturities'}
          </p>
        </div>

        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, ...LT_KPI_CARD }}>
          <p style={{ ...LT_KPI_LABEL, color: PT.muted }}>Property Concentration</p>
          {extKpis.topPropertyPct != null ? (
            <>
              <p style={{
                ...LT_KPI_VALUE,
                color: extKpis.topPropertyPct > 50 ? '#C0392B' : extKpis.topPropertyPct > 33 ? '#B45309' : '#166534',
              }}>
                {extKpis.topPropertyPct.toFixed(0)}%
              </p>
              <p style={{ ...LT_KPI_SUB, color: PT.muted }} title={`Largest: ${extKpis.topProperty}`}>
                Largest: {extKpis.topProperty}
              </p>
            </>
          ) : <p style={LT_KPI_NA}>—</p>}
        </div>

        <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, ...LT_KPI_CARD }}>
          <p style={{ ...LT_KPI_LABEL, color: PT.muted }}>Lender Concentration</p>
          {extKpis.topLenderPct != null ? (
            <>
              <p style={{
                ...LT_KPI_VALUE,
                color: extKpis.topLenderPct > 60 ? '#C0392B' : extKpis.topLenderPct > 40 ? '#B45309' : '#166534',
              }}>
                {extKpis.topLenderPct.toFixed(0)}%
              </p>
              <p style={{ ...LT_KPI_SUB, color: PT.muted }} title={`Largest lender: ${extKpis.topLender}`}>
                Largest lender: {extKpis.topLender}
              </p>
            </>
          ) : <p style={LT_KPI_NA}>—</p>}
        </div>
      </div>

      <EmiCalendarStrip loans={filtered} scopeLabel={scopeLabel} />

      {/* Alert banners — same pattern as Rentals */}
      <div className="space-y-3">
        {highRateLoans.length > 0 && (
          <div style={{ background: '#FFF7E8', borderLeft: '4px solid #F2994A', borderRadius: '0 8px 8px 0', padding: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertCircle size={18} style={{ color: '#F2994A', flexShrink: 0, marginTop: 1 }} />
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#7A4500', marginBottom: 2 }}>Refinancing Opportunity</h4>
              <p style={{ fontSize: 13, color: '#7A4500' }}>
                {highRateLoans.length} loan(s) above market rate ({PROPDEV_MARKET_RATE}%).
                Est. monthly savings: <strong>{fmtUSD(monthlySavings)}</strong> ({fmtUSD(monthlySavings * 12)}/yr)
              </p>
            </div>
          </div>
        )}
        {kpis.emi > 0 && kpis.outstanding > 0 && kpis.emi * 12 > kpis.outstanding * 0.12 && (
          <div style={{ background: '#FFECEC', borderLeft: '4px solid #C0392B', borderRadius: '0 8px 8px 0', padding: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <TrendingDown size={18} style={{ color: '#C0392B', flexShrink: 0, marginTop: 1 }} />
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#7B0000', marginBottom: 2 }}>High Debt Service</h4>
              <p style={{ fontSize: 13, color: '#7B0000' }}>
                Annual EMI of <strong>{fmtUSD(kpis.emi * 12)}</strong> exceeds 12% of loan portfolio — review cash / capital calls.
              </p>
            </div>
          </div>
        )}
        {highRateLoans.length === 0 && activeFiltered.length > 0 && (
          <div style={{ background: '#ECFDF5', borderLeft: '4px solid #166534', borderRadius: '0 8px 8px 0', padding: 12, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <CheckCircle2 size={18} style={{ color: '#166534', flexShrink: 0, marginTop: 1 }} />
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#14532D', marginBottom: 2 }}>All Rates Optimized</h4>
              <p style={{ fontSize: 13, color: '#14532D' }}>
                All active loans are at or below market rate ({PROPDEV_MARKET_RATE}%).
              </p>
            </div>
          </div>
        )}
      </div>

      <PropDevLoanPortfolioCharts
        scopeLabel={scopeLabel}
        debtByProperty={chartDebt.length ? chartDebt : debtByProperty}
        emiByBank={chartEmi.length ? chartEmi : emiByBank}
        maturityLadder={chartMaturity.length ? chartMaturity : maturityLadder}
        rateVariance={chartRateVar.length ? chartRateVar : rateVariance}
      />

      <div style={{ background: PT.cardBg, border: `1px solid ${PT.border}`, borderRadius: 12, padding: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: PT.text, marginBottom: 12 }}>Portfolio Capital Call Coverage</h3>
        <CapitalCallCoverageGauge
          ratio={portfolioCoverage.ratio}
          status={portfolioCoverage.status}
          dataGap={portfolioCoverage.dataGap}
          obligations={portfolioCoverage.obligations}
          uncalled={portfolioCoverage.uncalled}
        />
      </div>

      <LoanRegister loans={filtered} companies={filteredCompanies.length ? filteredCompanies : scopedCompanies} allLoans={allLoans} />

      <EntityCoverageHealth
        companies={filteredCompanies.length ? filteredCompanies : scopedCompanies}
        allLoans={allLoans}
      />

      {/* Prop Dev extras — below Rentals-parity spine */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="text-xs font-medium text-stone-600 underline underline-offset-2 hover:text-stone-900"
        >
          {showAdvanced ? 'Hide' : 'Show'} detailed loan cards, EMI tracker & cash outlook
        </button>
      </div>

      {showAdvanced && (
        <>
          <CompanyLoanCards companies={scopedCompanies} marketRate={PROPDEV_MARKET_RATE} allLoans={allLoans} />
          <EmiTracker loans={filtered} />
          {filtered.map(loan => {
            const schedule = buildAmortizationSchedule(loan, 12);
            const totalInterest = schedule.reduce((s, r) => s + r.interest, 0);
            const company = companyById.get(loan.companyId);
            const ltlv = company ? computeLtlv(loan, company) : null;
            const companyCoverage = company
              ? computeCapitalCallCoverage(company, COVERAGE_WINDOW_MONTHS, allLoans)
              : null;

            return (
              <div key={loan.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-stone-900 text-white p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Landmark size={20} className="text-amber-300" />
                      <div>
                        <h3 className="font-bold text-lg">{loan.bank}</h3>
                        <p className="text-sm text-stone-300">{loan.property} · A/c: {loan.accountNo}</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[loan.status]}`}>
                      {loan.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
                    {[
                      { label: 'Loan Amount', value: fmt(loan.amount) },
                      { label: 'Outstanding', value: fmt(loan.balance) },
                      { label: 'Rate', value: `${loan.interestRate}% p.a.` },
                      { label: 'Monthly EMI', value: fmt(loan.emi) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-xs text-stone-400 uppercase">{label}</p>
                        <p className="font-bold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    <h4 className="font-semibold text-gray-700 text-sm">Loan Details</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {[
                        ['Company', loan.company],
                        ['Loan Date', loan.loanDate],
                        ['Maturity', loan.maturityDate],
                        ['EMI Date', `${loan.emiDate}${loan.emiDate === 1 ? 'st' : 'th'}`],
                        ['LTLV', ltlv != null ? `${ltlv.toFixed(1)}%` : '—'],
                        ['Land Value', company ? (resolveLandValue(company) != null ? fmt(resolveLandValue(company)!) : '—') : '—'],
                        ['Repaid', fmt(loan.amount - loan.balance)],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <p className="text-xs text-gray-400">{k}</p>
                          <p className="font-medium text-gray-900">{v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-1.5 text-sm">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lender Contact</p>
                      <div className="flex items-center gap-2 text-gray-600"><Landmark size={12} />{loan.lenderName}</div>
                      <div className="flex items-center gap-2 text-blue-600"><Mail size={12} />{loan.lenderEmail}</div>
                      <div className="flex items-center gap-2 text-gray-600"><Phone size={12} />{loan.lenderPhone}</div>
                      <div className="flex items-center gap-2 text-gray-600"><Calendar size={12} />EMI due {loan.emiDate}{loan.emiDate === 1 ? 'st' : 'th'}</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-700 text-sm mb-3">Entity Capital Call Coverage</h4>
                    {companyCoverage ? (
                      <CapitalCallCoverageGauge
                        ratio={companyCoverage.ratio}
                        status={companyCoverage.status}
                        dataGap={companyCoverage.dataGap}
                        obligations={companyCoverage.obligations}
                        uncalled={companyCoverage.uncalled}
                      />
                    ) : (
                      <p className="text-sm text-gray-500">Company data not available</p>
                    )}
                    {loan.interestRate > PROPDEV_MARKET_RATE && (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                        <AlertTriangle size={12} className="inline mr-1" />
                        Rate {loan.interestRate}% above market {PROPDEV_MARKET_RATE}% — est. saving {fmt((loan.balance * (loan.interestRate - PROPDEV_MARKET_RATE) / 100) / 12)}/month if refinanced.
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-700 text-sm mb-3">12-Month Balance Trend</h4>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={schedule}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                        <Line type="monotone" dataKey="balance" stroke="#5B5FEF" strokeWidth={2} dot={false} name="Balance" />
                        <Line type="monotone" dataKey="interest" stroke="#DC2626" strokeWidth={1.5} dot={false} name="Interest" />
                      </LineChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-gray-400 mt-1">Est. 12-month interest: {fmt(totalInterest)}</p>
                  </div>
                </div>
              </div>
            );
          })}
          <BankRateIntelligence companies={scopedCompanies} />
          <CashPositionAlerts companies={scopedCompanies} allLoans={allLoans} />
          <CashFlowForecast companies={scopedCompanies} allLoans={allLoans} />
        </>
      )}
      </>}
    </div>
  );
}
