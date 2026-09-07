/**
 * Property Dev → Ownership (Partners) Export PDF board pack.
 * Mirrors live Ownership KPIs, distribution chart, and partner registry.
 */
import type {
  SectionPdfAlert, SectionPdfBlock, SectionPdfKpi, SectionPdfPayload,
} from './gatherSectionPdfData';
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import {
  svgDoughnut, svgGroupedBarChart, svgHorizontalBarChart,
} from './sectionPdfCharts';

const GOLD = '#5B5FEF';
const GREEN = '#166534';
const RED = '#B91C1C';
const AMBER = '#F5A623';
const BLUE = '#1E3A8A';
const TEAL = '#0F766E';
const CHART_COLORS = [
  '#1E3A8A', '#2D6A4F', '#40916C', '#52B788', '#74C69D',
  '#95D5B2', '#FBBF24', '#F97316', '#7C3AED', '#DB2777',
];

export interface PropDevOwnershipPdfPartnerRow {
  name: string;
  propertyNames: string;
  ownPct: number;
  capitalIn: number;
  costBasis: number;
  bookValue: number;
  marketValue: number;
  hasFairValue: boolean;
  unrealizedGain: number;
  returnToDate: number;
  roi: number;
  irrLabel: string;
  equityMultipleLabel: string;
}

export interface PropDevOwnershipPdfInput {
  entityLabel: string;
  periodLabel: string;
  partnerFilterLabel: string;
  kpis: {
    totalPartners: number;
    totalCapital: number;
    totalMV: number;
    totalEquity: number;
    totalDebt: number;
    avgROI: number;
    ltvPct: number | null;
  };
  partners: PropDevOwnershipPdfPartnerRow[];
  totals: {
    capitalIn: number;
    costBasis: number;
    bookValue: number;
    marketValue: number;
    unrealizedGain: number;
    returnToDate: number;
    hasFairValue: boolean;
  };
  portfolioIrrLabel: string;
  portfolioEqMultLabel: string;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function fmtUsdOrDash(n: number, present: boolean): string {
  return present ? fmtUsd(n) : '—';
}

function fmtGain(n: number, present: boolean): string {
  if (!present) return '—';
  const abs = fmtUsd(Math.abs(n));
  return n >= 0 ? `+${abs}` : `(${abs})`;
}

function shortName(name: string, max = 14): string {
  const t = name.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function buildStrategy(input: PropDevOwnershipPdfInput): SectionStrategyPlan {
  const actions: string[] = [];
  const { avgROI, ltvPct, totalEquity, totalMV } = input.kpis;
  if (avgROI < 10) {
    actions.push(`Average partner ROI is ${avgROI.toFixed(1)}% — review underperforming holdings and distribution timing.`);
  } else if (avgROI < 20) {
    actions.push(`Average partner ROI is ${avgROI.toFixed(1)}% — monitor returns vs the 20% target band.`);
  }
  if (ltvPct != null && ltvPct > 70) {
    actions.push(`Portfolio LTV is ${ltvPct.toFixed(1)}% — limit further leverage until equity cushion improves.`);
  }
  if (totalMV > 0 && totalEquity / totalMV < 0.3) {
    actions.push('Equity is below 30% of fair value — prioritize capital retention and debt paydown.');
  }
  if (!actions.length) {
    actions.push('Ownership metrics are within target bands — keep partner registry and FV columns current after each capital event.');
  }
  const commentary = input.partners.length === 0
    ? `No ownership partners for ${input.entityLabel}. Import the ownership workbook before board review.`
    : `${input.entityLabel}: ${input.kpis.totalPartners} partners · Cost Basis ${fmtUsd(input.kpis.totalCapital)} · FV ${fmtUsd(input.kpis.totalMV)} · Equity ${fmtUsd(input.kpis.totalEquity)} · Avg ROI ${avgROI.toFixed(1)}%.`;
  return { commentary, actions };
}

function buildAlerts(input: PropDevOwnershipPdfInput): SectionPdfAlert[] {
  const alerts: SectionPdfAlert[] = [];
  if (!input.partners.length) {
    alerts.push({
      severity: 'warning',
      title: 'No Ownership Data',
      text: `No partner ownership records for ${input.entityLabel}. Import partners before relying on this pack.`,
    });
    return alerts;
  }
  if (input.kpis.avgROI < 10) {
    alerts.push({
      severity: 'critical',
      title: 'Low Average ROI',
      text: `Weighted average partner ROI is ${input.kpis.avgROI.toFixed(1)}% (below 10%).`,
    });
  }
  if (input.kpis.ltvPct != null && input.kpis.ltvPct > 75) {
    alerts.push({
      severity: 'warning',
      title: 'Elevated Portfolio LTV',
      text: `Average LTV is ${input.kpis.ltvPct.toFixed(1)}% — limited headroom for additional debt.`,
    });
  }
  if (!input.totals.hasFairValue) {
    alerts.push({
      severity: 'info',
      title: 'Fair Value Missing',
      text: 'Market Value / unrealized G/L columns are incomplete — re-import ownership with Fair Market Value (FV).',
    });
  }
  return alerts;
}

export function buildPropDevOwnershipPdfPayload(
  input: PropDevOwnershipPdfInput,
): SectionPdfPayload {
  const kpis: SectionPdfKpi[] = [
    { label: 'Total Partners', value: String(input.kpis.totalPartners), accent: GOLD },
    { label: 'Total Cost Basis', value: fmtUsd(input.kpis.totalCapital), accent: BLUE },
    { label: 'Portfolio Fair Value', value: fmtUsd(input.kpis.totalMV), accent: GREEN },
    { label: 'Total Equity', value: fmtUsd(input.kpis.totalEquity), accent: TEAL },
    {
      label: 'Avg Partner ROI',
      value: `${input.kpis.avgROI.toFixed(1)}%`,
      accent: input.kpis.avgROI < 10 ? RED : input.kpis.avgROI < 20 ? AMBER : GREEN,
    },
    {
      label: 'Portfolio LTV',
      value: input.kpis.ltvPct != null ? `${input.kpis.ltvPct.toFixed(1)}%` : '—',
      accent: (input.kpis.ltvPct ?? 0) > 75 ? RED : GOLD,
    },
  ];

  const charts = [];
  const ownSlices = input.partners
    .map((p, i) => ({
      label: shortName(p.name, 16),
      value: input.kpis.totalMV > 0 ? Math.max(0, p.marketValue) : Math.max(0, p.costBasis),
      color: CHART_COLORS[i % CHART_COLORS.length],
    }))
    .filter(s => s.value > 0)
    .slice(0, 10);
  if (ownSlices.length) {
    charts.push({
      title: 'Ownership Distribution',
      subtitle: input.kpis.totalMV > 0 ? 'By fair-value share' : 'By cost basis',
      svg: svgDoughnut(ownSlices, { width: 300, height: 220 }),
    });
  }

  if (input.partners.length) {
    const labels = input.partners.slice(0, 12).map(p => shortName(p.name.split(' ')[0] || p.name, 10));
    charts.push({
      title: 'Capital vs Market Value',
      subtitle: 'Top partners · USD',
      svg: svgGroupedBarChart(
        labels,
        [
          {
            name: 'Cost Basis',
            values: input.partners.slice(0, 12).map(p => p.costBasis),
            color: BLUE,
          },
          {
            name: 'Market Value',
            values: input.partners.slice(0, 12).map(p => p.marketValue),
            color: GREEN,
          },
        ],
        { width: 520, height: 220 },
      ),
    });

    const roiSorted = [...input.partners].sort((a, b) => b.roi - a.roi).slice(0, 12);
    charts.push({
      title: 'ROI by Partner',
      subtitle: `Portfolio avg ${input.kpis.avgROI.toFixed(1)}%`,
      svg: svgHorizontalBarChart(
        roiSorted.map(p => ({
          label: shortName(p.name, 16),
          value: p.roi,
          color: p.roi >= 20 ? GREEN : p.roi >= 10 ? AMBER : RED,
        })),
        {
          width: 520,
          height: Math.max(180, roiSorted.length * 24 + 60),
          valueFormat: 'pct',
        },
      ),
    });
  }

  const blocks: SectionPdfBlock[] = [
    {
      heading: 'Ownership Snapshot',
      kpis,
      alerts: buildAlerts(input),
      charts: charts.slice(0, 2),
      chartsLayout: charts.length > 1 ? 'grid' : 'stack',
    },
  ];

  if (charts.length > 2) {
    blocks.push({
      heading: 'Return Analytics',
      pageBreakBefore: true,
      forcePageBreak: true,
      charts: [charts[2]],
      chartsLayout: 'stack',
      kpis: [
        { label: 'Portfolio IRR', value: input.portfolioIrrLabel, accent: BLUE },
        { label: 'Equity Multiple', value: input.portfolioEqMultLabel, accent: GOLD },
        { label: 'Total Debt', value: fmtUsd(input.kpis.totalDebt), accent: RED },
      ],
    });
  }

  if (input.partners.length) {
    const rows = input.partners.map(p => [
      p.name,
      shortName(p.propertyNames, 28),
      `${p.ownPct.toFixed(1)}%`,
      fmtUsd(p.capitalIn),
      fmtUsd(p.costBasis),
      fmtUsdOrDash(p.bookValue, p.bookValue > 0),
      fmtUsdOrDash(p.marketValue, p.hasFairValue),
      fmtGain(p.unrealizedGain, p.hasFairValue),
      fmtUsd(p.returnToDate),
      `${p.roi.toFixed(1)}%`,
      p.irrLabel,
      p.equityMultipleLabel,
    ]);
    rows.push([
      'PORTFOLIO TOTAL', '', '',
      fmtUsd(input.totals.capitalIn),
      fmtUsd(input.totals.costBasis),
      fmtUsdOrDash(input.totals.bookValue, input.totals.bookValue > 0),
      fmtUsdOrDash(input.totals.marketValue, input.totals.hasFairValue),
      fmtGain(input.totals.unrealizedGain, input.totals.hasFairValue),
      fmtUsd(input.totals.returnToDate),
      `${input.kpis.avgROI.toFixed(1)}%`,
      input.portfolioIrrLabel,
      input.portfolioEqMultLabel,
    ]);

    blocks.push({
      heading: 'Partner Registry',
      pageBreakBefore: true,
      forcePageBreak: true,
      tables: [{
        title: `Partner Registry — ${input.entityLabel}`,
        headers: [
          'Partner', 'Property', 'Own %', 'Capital In', 'Cost Basis', 'Book Value',
          'Market Value', 'Unrealized G/L', 'Return to Date', 'ROI', 'IRR', 'Eq. Mult.',
        ],
        rows,
        rowKinds: [
          ...input.partners.map(() => 'detail' as const),
          'total' as const,
        ],
        keepTogether: input.partners.length <= 10,
      }],
    });
  }

  return {
    tab: 'propdev-ownership',
    sectionTitle: 'Ownership',
    fileSectionName: 'PropDev_Ownership',
    entityLabel: input.entityLabel,
    periodLabel: input.periodLabel,
    generatedAt: new Date().toISOString(),
    sourceNote: `Property Dev → Ownership · ${input.partnerFilterLabel}`,
    kpis: [],
    charts: [],
    blocks,
    strategy: buildStrategy(input),
  };
}
