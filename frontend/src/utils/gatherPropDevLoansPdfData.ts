/**
 * Property Dev → Loan Tracker Export PDF board pack.
 * Mirrors live Loan Tracker: KPIs, alerts, portfolio charts, and loan register.
 */
import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import type {
  SectionPdfAlert, SectionPdfBlock, SectionPdfKpi, SectionPdfPayload,
} from './gatherSectionPdfData';
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import {
  svgBarChart,
  svgHorizontalBarChart,
} from './sectionPdfCharts';
import {
  computeCapitalCallCoverage,
  formatCoverageRatio,
  isActivePropDevLoan,
  type CoverageStatusLabel,
} from './propDevLoanMetrics';

const GOLD = '#5B5FEF';
const GREEN = '#166534';
const RED = '#B91C1C';
const AMBER = '#F5A623';
const BLUE = '#1E3A8A';
const TEAL = '#0F766E';
const CHART_COLORS = ['#5B5FEF', '#F2C94C', '#E8E9ED', '#1E3A8A', '#0F766E', '#B91C1C'];

const COVERAGE_WINDOW_MONTHS = 3;

export interface PropDevLoansPdfInput {
  entityLabel: string;
  periodLabel: string;
  propertyFilterLabel: string;
  loans: Loan[];
  companies: CompanyData[];
  allLoans: Loan[];
  marketRate: number;
  kpis: {
    loanTaken: number;
    outstanding: number;
    emi: number;
    wAvg: number;
    loanCount: number;
    activeCount: number;
    nextMaturity: string | null;
    nextMaturityProperty: string | null;
    nextEmiDay: number | null;
    weightedAvgTermMonths: number | null;
    maturingCount: number;
    maturingAmt: number;
    topProperty: string;
    topPropertyPct: number | null;
    topLender: string;
    topLenderPct: number | null;
    avgLtlv: number | null;
  };
  coverage: {
    ratio: number | null;
    status: CoverageStatusLabel;
    dataGap: boolean;
    obligations: number;
    uncalled: number | null;
  };
  debtByProperty: { name: string; value: number }[];
  emiByBank: { name: string; value: number }[];
  maturityLadder: { year: string; amount: number }[];
  highRateCount: number;
  monthlyRefinanceSavings: number;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function shortName(name: string, max = 16): string {
  const t = name.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function ordinalDay(d: number | null): string {
  if (d == null) return '—';
  const suf = d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th';
  return `${d}${suf}`;
}

function buildStrategy(input: PropDevLoansPdfInput): SectionStrategyPlan {
  const actions: string[] = [];
  const { outstanding, emi, maturingCount, maturingAmt, wAvg } = input.kpis;
  if (input.highRateCount > 0) {
    actions.push(
      `Refinance ${input.highRateCount} loan(s) above ${input.marketRate}% — est. ${fmtUsd(input.monthlyRefinanceSavings)}/mo savings.`,
    );
  }
  if (maturingCount > 0) {
    actions.push(
      `Start refinance / extension talks for ${maturingCount} loan(s) maturing within 12 months (${fmtUsd(maturingAmt)}).`,
    );
  }
  if (input.coverage.status === 'Review') {
    actions.push(
      'Capital-call coverage is below 1x — issue a partner call before the next EMI cycle.',
    );
  } else if (input.coverage.status === 'Monitor') {
    actions.push('Capital-call coverage is marginal — confirm partner commitments cover near-term EMI.');
  }
  if (emi > 0 && outstanding > 0 && emi * 12 > outstanding * 0.12) {
    actions.push('Annual EMI exceeds 12% of outstanding — stress-test cash and capital-call capacity.');
  }
  if (!actions.length) {
    actions.push(
      wAvg > 0
        ? `Debt book is within target bands (wtd rate ${wAvg.toFixed(2)}%) — keep maturity and coverage reviews on the monthly cadence.`
        : 'Upload loan data before relying on this pack for refinancing or coverage decisions.',
    );
  }
  const commentary = input.loans.length === 0
    ? `No loan records for ${input.entityLabel}. Import Bank Loan Information before board review.`
    : `${input.entityLabel}: ${fmtUsd(outstanding)} outstanding · ${fmtUsd(emi)}/mo EMI · `
      + `wtd rate ${wAvg.toFixed(2)}% · ${input.kpis.activeCount} active of ${input.kpis.loanCount} loans.`;
  return { commentary, actions };
}

function buildAlerts(input: PropDevLoansPdfInput): SectionPdfAlert[] {
  const alerts: SectionPdfAlert[] = [];
  if (!input.loans.length) {
    alerts.push({
      severity: 'warning',
      title: 'No Loan Data',
      text: `No loans found for ${input.entityLabel}. Import via Loan Tracker → Import Excel.`,
    });
    return alerts;
  }
  if (input.highRateCount > 0) {
    alerts.push({
      severity: 'warning',
      title: 'Refinancing Opportunity',
      text: `${input.highRateCount} loan(s) above market (${input.marketRate}%). `
        + `Est. monthly savings: ${fmtUsd(input.monthlyRefinanceSavings)} `
        + `(${fmtUsd(input.monthlyRefinanceSavings * 12)}/yr).`,
    });
  }
  if (input.kpis.maturingCount > 0) {
    alerts.push({
      severity: 'critical',
      title: 'Near-Term Maturities',
      text: `${input.kpis.maturingCount} loan(s) mature within 12 months — `
        + `${fmtUsd(input.kpis.maturingAmt)} coming due.`,
    });
  }
  if (input.coverage.status === 'Review') {
    alerts.push({
      severity: 'critical',
      title: 'Insufficient Capital Call Coverage',
      text: `Coverage ${formatCoverageRatio(input.coverage.ratio)} · Review — `
        + `uncalled capital does not cover ${fmtUsd(input.coverage.obligations)} near-term EMI.`,
    });
  }
  if (
    input.kpis.emi > 0
    && input.kpis.outstanding > 0
    && input.kpis.emi * 12 > input.kpis.outstanding * 0.12
  ) {
    alerts.push({
      severity: 'warning',
      title: 'High Debt Service',
      text: `Annual EMI of ${fmtUsd(input.kpis.emi * 12)} exceeds 12% of the loan portfolio.`,
    });
  }
  if (
    input.highRateCount === 0
    && input.kpis.activeCount > 0
    && input.coverage.status !== 'Review'
  ) {
    alerts.push({
      severity: 'info',
      title: 'Rates Optimized',
      text: `All active loans are at or below market rate (${input.marketRate}%).`,
    });
  }
  return alerts;
}

function coverageLabelForLoan(
  loan: Loan,
  companies: CompanyData[],
  allLoans: Loan[],
): string {
  const company = companies.find(c => c.id === loan.companyId);
  if (!company) return '—';
  const cov = computeCapitalCallCoverage(company, COVERAGE_WINDOW_MONTHS, allLoans);
  if (cov.dataGap) return 'N/A';
  if (cov.ratio == null) return 'N/A';
  return `${formatCoverageRatio(cov.ratio)} · ${cov.status}`;
}

export function buildPropDevLoansPdfPayload(
  input: PropDevLoansPdfInput,
): SectionPdfPayload {
  const { kpis, coverage } = input;
  const kpisRow: SectionPdfKpi[] = [
    { label: 'Loan Taken', value: fmtUsd(kpis.loanTaken), accent: GOLD },
    { label: 'Loan Outstanding', value: fmtUsd(kpis.outstanding), accent: BLUE },
    { label: 'Monthly EMI', value: fmtUsd(kpis.emi), accent: RED },
    {
      label: 'Wtd Avg Rate',
      value: `${kpis.wAvg.toFixed(2)}%`,
      accent: kpis.wAvg > input.marketRate ? AMBER : GREEN,
    },
    {
      label: 'Active Loans',
      value: String(kpis.activeCount),
      sub: `${kpis.loanCount} total`,
      accent: TEAL,
    },
    {
      label: 'Next Maturity',
      value: kpis.nextMaturity ?? '—',
      sub: kpis.nextMaturityProperty ?? undefined,
      accent: GOLD,
    },
  ];

  const extKpis: SectionPdfKpi[] = [
    {
      label: 'Wtd Remaining Term',
      value: kpis.weightedAvgTermMonths != null
        ? `${Math.round(kpis.weightedAvgTermMonths)} mo`
        : '—',
      accent: (kpis.weightedAvgTermMonths ?? 99) < 12 ? RED : BLUE,
    },
    {
      label: 'Maturing ≤12 Mo',
      value: String(kpis.maturingCount),
      sub: kpis.maturingCount > 0 ? fmtUsd(kpis.maturingAmt) : 'None',
      accent: kpis.maturingCount > 0 ? RED : GREEN,
    },
    {
      label: 'Call Coverage',
      value: coverage.dataGap
        ? 'N/A'
        : `${formatCoverageRatio(coverage.ratio)} · ${coverage.status}`,
      accent: coverage.status === 'Review' ? RED
        : coverage.status === 'Monitor' ? AMBER
          : coverage.status === 'Healthy' ? GREEN
            : GOLD,
    },
    {
      label: 'Portfolio LTLV',
      value: kpis.avgLtlv != null ? `${kpis.avgLtlv.toFixed(1)}%` : '—',
      accent: (kpis.avgLtlv ?? 0) > 70 ? RED : TEAL,
    },
    {
      label: 'Property Concentration',
      value: kpis.topPropertyPct != null ? `${kpis.topPropertyPct.toFixed(0)}%` : '—',
      sub: kpis.topProperty || undefined,
      accent: (kpis.topPropertyPct ?? 0) > 50 ? RED : GOLD,
    },
    {
      label: 'Lender Concentration',
      value: kpis.topLenderPct != null ? `${kpis.topLenderPct.toFixed(0)}%` : '—',
      sub: kpis.topLender || undefined,
      accent: (kpis.topLenderPct ?? 0) > 60 ? RED : GOLD,
    },
  ];

  const charts = [];
  const debtItems = input.debtByProperty
    .filter(d => d.value > 0)
    .slice(0, 10)
    .map((d, i) => ({
      label: shortName(d.name, 16),
      value: d.value,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
  if (debtItems.length) {
    charts.push({
      title: 'Debt by Property',
      subtitle: 'Outstanding balance · highest first',
      svg: svgHorizontalBarChart(debtItems, {
        width: 520,
        height: Math.max(180, debtItems.length * 24 + 60),
        maxItems: 10,
      }),
    });
  }

  const emiItems = input.emiByBank
    .filter(d => d.value > 0)
    .slice(0, 10)
    .map((d, i) => ({
      label: shortName(d.name, 16),
      value: d.value,
      color: i === 0 ? GOLD : BLUE,
    }));
  if (emiItems.length) {
    charts.push({
      title: 'EMI by Lender',
      subtitle: 'Monthly EMI · active loans',
      svg: svgHorizontalBarChart(emiItems, {
        width: 520,
        height: Math.max(180, emiItems.length * 24 + 60),
        maxItems: 10,
      }),
    });
  }

  if (input.maturityLadder.length) {
    const nowYear = new Date().getFullYear();
    charts.push({
      title: 'Maturity Ladder',
      subtitle: 'Outstanding balance maturing by calendar year',
      svg: svgBarChart(
        input.maturityLadder.map(m => m.year),
        input.maturityLadder.map(m => m.amount),
        input.maturityLadder.some(m => parseInt(m.year, 10) - nowYear <= 1) ? RED : GOLD,
        { width: 520, height: 220 },
      ),
    });
  }

  const active = input.loans.filter(isActivePropDevLoan);
  const rateItems = active
    .filter(l => l.interestRate != null)
    .sort((a, b) => b.interestRate - a.interestRate)
    .slice(0, 12)
    .map(l => ({
      label: shortName(l.property || l.company || l.bank, 16),
      value: l.interestRate,
      color: l.interestRate > input.marketRate ? RED : GREEN,
    }));
  if (rateItems.length) {
    charts.push({
      title: 'Interest Rate by Facility',
      subtitle: `Market benchmark ${input.marketRate}%`,
      svg: svgHorizontalBarChart(rateItems, {
        width: 520,
        height: Math.max(180, rateItems.length * 24 + 60),
        maxItems: 12,
        valueFormat: 'pct',
      }),
    });
  }

  const blocks: SectionPdfBlock[] = [
    {
      heading: 'Loan Tracker Snapshot',
      kpis: kpisRow,
      alerts: buildAlerts(input),
      charts: charts.slice(0, 2),
      chartsLayout: charts.length > 1 ? 'grid' : 'stack',
    },
  ];

  blocks.push({
    heading: 'Risk & Concentration',
    pageBreakBefore: charts.length > 2,
    forcePageBreak: charts.length > 2,
    kpis: extKpis,
    charts: charts.slice(2),
    chartsLayout: charts.slice(2).length > 1 ? 'grid' : 'stack',
  });

  if (input.loans.length) {
    const sorted = [...input.loans].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));
    const rows = sorted.map(l => [
      shortName(l.company || '—', 22),
      shortName(l.property || '—', 22),
      shortName(l.bank || '—', 18),
      fmtUsd(l.amount ?? 0),
      `${(l.interestRate ?? 0).toFixed(2)}%`,
      fmtUsd(l.emi ?? 0),
      fmtUsd(l.balance ?? 0),
      l.maturityDate || '—',
      ordinalDay(l.emiDate ?? null),
      coverageLabelForLoan(l, input.companies, input.allLoans),
      l.status,
    ]);
    const totalAmt = sorted.reduce((s, l) => s + (l.amount ?? 0), 0);
    const totalEmi = sorted.filter(isActivePropDevLoan).reduce((s, l) => s + (l.emi ?? 0), 0);
    const totalBal = sorted.filter(isActivePropDevLoan).reduce((s, l) => s + (l.balance ?? 0), 0);
    rows.push([
      'TOTAL', '', '',
      fmtUsd(totalAmt), '',
      fmtUsd(totalEmi),
      fmtUsd(totalBal),
      '', '', '', '',
    ]);

    blocks.push({
      heading: 'Loan Register',
      pageBreakBefore: true,
      forcePageBreak: true,
      tables: [{
        title: `Loan Register — ${input.entityLabel}`,
        headers: [
          'Company', 'Property', 'Bank', 'Loan Amount', 'Rate', 'EMI',
          'Outstanding', 'Maturity', 'EMI Day', 'Call Coverage', 'Status',
        ],
        rows,
        rowKinds: [
          ...sorted.map(() => 'detail' as const),
          'total' as const,
        ],
        keepTogether: sorted.length <= 8,
      }],
    });
  }

  return {
    tab: 'propdev-loans',
    sectionTitle: 'Loan Tracker',
    fileSectionName: 'PropDev_Loan_Tracker',
    entityLabel: input.entityLabel,
    periodLabel: input.periodLabel,
    generatedAt: new Date().toISOString(),
    sourceNote: `Property Dev → Loan Tracker · ${input.propertyFilterLabel}`
      + (kpis.nextEmiDay != null ? ` · EMI day ${ordinalDay(kpis.nextEmiDay)}` : ''),
    kpis: [],
    charts: [],
    blocks,
    strategy: buildStrategy(input),
  };
}
