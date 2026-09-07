/**
 * Property Dev → Capital Calls Export PDF board pack.
 * Mirrors the live Capital Calls page: KPIs, decision alerts, collection charts,
 * and per-period partner call registers.
 */
import type { CapitalCall } from '../contexts/PropertyDevContext';
import type {
  SectionPdfAlert, SectionPdfBlock, SectionPdfKpi, SectionPdfPayload, SectionPdfTable,
} from './gatherSectionPdfData';
import type { SectionStrategyPlan } from './executiveSummaryNarrative';
import { svgDoughnut, svgHorizontalBarChart } from './sectionPdfCharts';

const GOLD = '#5B5FEF';
const GREEN = '#166534';
const RED = '#B91C1C';
const AMBER = '#F5A623';
const BLUE = '#1F6FEB';
const BROWN = '#7A6040';

const STATUS_COLOR: Record<CapitalCall['status'], string> = {
  Paid: GREEN,
  Partial: AMBER,
  Outstanding: BLUE,
  Overdue: RED,
};

export interface PropDevCapitalCallsPdfInput {
  entityLabel: string;
  periodLabel: string;
  partnerFilterLabel: string;
  calls: CapitalCall[];
  partnerTypeMap: Record<string, 'Class A' | 'Class B'>;
  companyNameMap: Record<string, string>;
  cashAvailable: number;
  monthlyEmi: number;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function balanceOf(c: CapitalCall): number {
  return Math.max(0, c.totalDue - c.received);
}

function buildStrategy(input: PropDevCapitalCallsPdfInput): SectionStrategyPlan {
  const overdue = input.calls.filter(c => c.status === 'Overdue');
  const outstanding = input.calls.reduce((s, c) => s + balanceOf(c), 0);
  const called = input.calls.reduce((s, c) => s + c.totalDue, 0);
  const received = input.calls.reduce((s, c) => s + c.received, 0);
  const pct = called > 0 ? Math.round((received / called) * 100) : 0;
  const actions: string[] = [];
  if (overdue.length) {
    actions.push(
      `Send formal demand notices for ${overdue.length} overdue call(s) totaling ${fmtUsd(overdue.reduce((s, c) => s + balanceOf(c), 0))}.`,
    );
  }
  if (outstanding > 0) {
    actions.push(`Follow up on ${fmtUsd(outstanding)} outstanding partner balances before due dates slip.`);
  }
  if (pct < 70 && called > 0) {
    actions.push(`Collection rate is ${pct}% — target ≥70% before issuing the next capital call.`);
  }
  if (!actions.length) {
    actions.push('Collections are current — monitor monthly and reassess before the next funding cycle.');
  }
  const commentary = input.calls.length === 0
    ? `No capital-call records for ${input.entityLabel}. Upload capital-call data before relying on this pack.`
    : `${input.entityLabel}: ${fmtUsd(called)} called, ${fmtUsd(received)} received (${pct}%), ${fmtUsd(outstanding)} outstanding`
      + (overdue.length ? `, ${overdue.length} overdue.` : '.');
  return { commentary, actions };
}

function buildAlerts(input: PropDevCapitalCallsPdfInput): SectionPdfAlert[] {
  const overdue = input.calls.filter(c => c.status === 'Overdue');
  const outstanding = input.calls.reduce((s, c) => s + balanceOf(c), 0);
  const alerts: SectionPdfAlert[] = [];
  if (!input.calls.length) {
    alerts.push({
      severity: 'warning',
      title: 'No Capital Call Data',
      text: `No capital-call records found for ${input.entityLabel}. Upload via Data Import before board review.`,
    });
    return alerts;
  }
  if (overdue.length) {
    alerts.push({
      severity: 'critical',
      title: 'CALL NOW — Overdue Obligations',
      text: `${overdue.length} capital call${overdue.length > 1 ? 's' : ''} overdue — total ${fmtUsd(overdue.reduce((s, c) => s + balanceOf(c), 0))} unpaid. Send demand notices immediately.`,
    });
  } else if (outstanding > 0) {
    alerts.push({
      severity: 'warning',
      title: 'ACTION NEEDED — Capital Outstanding',
      text: `${fmtUsd(outstanding)} remains outstanding. Follow up on unpaid or partially paid partner balances.`,
    });
  } else {
    alerts.push({
      severity: 'info',
      title: 'NO CALL NEEDED — Position Adequate',
      text: 'All tracked capital calls are paid. Monitor monthly for collection slippage.',
    });
  }
  return alerts;
}

function buildPeriodTables(calls: CapitalCall[]): SectionPdfTable[] {
  const periods = [...new Set(calls.map(c => c.period).filter(Boolean))];
  if (!periods.length && calls.length) periods.push('Imported Capital Call');
  return periods.map(period => {
    const periodCalls = calls.filter(c => (c.period || 'Imported Capital Call') === period);
    const pTotal = periodCalls.reduce((s, c) => s + c.totalDue, 0);
    const pReceived = periodCalls.reduce((s, c) => s + c.received, 0);
    const rows = periodCalls.map(c => {
      const bal = balanceOf(c);
      return [
        c.partnerName,
        `${c.sharePercent}%`,
        fmtUsd(c.partnerShare),
        c.oldDues > 0 ? fmtUsd(c.oldDues) : '—',
        fmtUsd(c.totalDue),
        fmtUsd(c.received),
        c.dueDate ?? c.receivedDate ?? '—',
        bal > 0 ? fmtUsd(bal) : '—',
        c.status,
      ];
    });
    rows.push([
      'TOTAL', '', '', '',
      fmtUsd(pTotal), fmtUsd(pReceived), '',
      fmtUsd(Math.max(0, pTotal - pReceived)), '',
    ]);
    return {
      title: `Capital Call — ${period}`,
      headers: [
        'Partner', 'Share %', 'Partner Share', 'Old Dues',
        'Total Due', 'Received', 'Due Date', 'Balance', 'Status',
      ],
      rows,
      rowKinds: [
        ...periodCalls.map(() => 'detail' as const),
        'total' as const,
      ],
      keepTogether: periodCalls.length <= 12,
    };
  });
}

export function buildPropDevCapitalCallsPdfPayload(
  input: PropDevCapitalCallsPdfInput,
): SectionPdfPayload {
  const called = input.calls.reduce((s, c) => s + c.totalDue, 0);
  const received = input.calls.reduce((s, c) => s + c.received, 0);
  const outstanding = Math.max(0, called - received);
  const overdue = input.calls.filter(c => c.status === 'Overdue');
  const overdueAmt = overdue.reduce((s, c) => s + balanceOf(c), 0);
  const collectedPct = called > 0 ? Math.round((received / called) * 100) : 0;
  const active = input.calls.filter(c => c.status !== 'Paid').length;

  const kpis: SectionPdfKpi[] = [
    { label: 'Total Called', value: fmtUsd(called), sub: `${input.calls.length} calls`, accent: GOLD },
    {
      label: 'Total Received',
      value: fmtUsd(received),
      sub: `${collectedPct}% collected`,
      accent: GREEN,
    },
    {
      label: 'Outstanding',
      value: fmtUsd(outstanding),
      sub: `${active} active`,
      accent: outstanding > 0 ? RED : GREEN,
    },
    {
      label: 'Overdue Calls',
      value: String(overdue.length),
      sub: overdue.length ? fmtUsd(overdueAmt) : 'none',
      accent: overdue.length ? RED : GREEN,
    },
  ];

  const charts = [];
  if (called > 0 || received > 0) {
    charts.push({
      title: 'Called vs Received vs Outstanding',
      svg: svgHorizontalBarChart(
        [
          { label: 'Called', value: called, color: BROWN },
          { label: 'Received', value: received, color: GREEN },
          { label: 'Outstanding', value: outstanding, color: RED },
        ].filter(r => r.value > 0 || r.label === 'Called'),
        { width: 520, height: 160, valueFormat: 'money' },
      ),
    });
  }

  const statusBuckets: Record<CapitalCall['status'], { count: number; balance: number }> = {
    Paid: { count: 0, balance: 0 },
    Partial: { count: 0, balance: 0 },
    Outstanding: { count: 0, balance: 0 },
    Overdue: { count: 0, balance: 0 },
  };
  for (const c of input.calls) {
    statusBuckets[c.status].count += 1;
    statusBuckets[c.status].balance += balanceOf(c);
  }
  // Paid slice uses received amount so the donut isn't empty when balances are $0.
  const paidReceived = input.calls
    .filter(c => c.status === 'Paid')
    .reduce((s, c) => s + c.received, 0);
  const statusSlices = (Object.keys(statusBuckets) as CapitalCall['status'][])
    .map(status => ({
      label: status,
      value: status === 'Paid'
        ? Math.max(statusBuckets[status].balance, paidReceived, statusBuckets[status].count)
        : Math.max(statusBuckets[status].balance, statusBuckets[status].count > 0 ? 1 : 0),
      color: STATUS_COLOR[status],
      count: statusBuckets[status].count,
      balance: statusBuckets[status].balance,
    }))
    .filter(s => s.count > 0);

  if (statusSlices.length) {
    charts.push({
      title: 'Status Breakdown',
      subtitle: statusSlices
        .map(s => `${s.label}: ${fmtUsd(s.balance)} · ${s.count}`)
        .join('  ·  '),
      svg: svgDoughnut(
        statusSlices.map(s => ({ label: s.label, value: s.value, color: s.color })),
        { width: 300, height: 220 },
      ),
    });
  }

  const blocks: SectionPdfBlock[] = [
    {
      heading: 'Capital Calls Snapshot',
      kpis,
      alerts: buildAlerts(input),
      charts,
      chartsLayout: charts.length > 1 ? 'grid' : 'stack',
    },
  ];

  // Partner rollup by outstanding balance
  if (input.calls.length) {
    const byPartner = new Map<string, { called: number; received: number; overdue: number }>();
    for (const c of input.calls) {
      const cur = byPartner.get(c.partnerName) ?? { called: 0, received: 0, overdue: 0 };
      cur.called += c.totalDue;
      cur.received += c.received;
      if (c.status === 'Overdue') cur.overdue += balanceOf(c);
      byPartner.set(c.partnerName, cur);
    }
    const partnerRows = [...byPartner.entries()]
      .map(([name, v]) => ({
        name,
        called: v.called,
        received: v.received,
        outstanding: Math.max(0, v.called - v.received),
        overdue: v.overdue,
      }))
      .sort((a, b) => b.outstanding - a.outstanding || b.called - a.called);

    blocks.push({
      heading: 'Partner Collection Summary',
      pageBreakBefore: true,
      forcePageBreak: true,
      tables: [{
        title: `Partner Collection Summary — ${input.entityLabel}`,
        headers: ['Partner', 'Called', 'Received', 'Outstanding', 'Overdue'],
        rows: partnerRows.map(r => [
          r.name, fmtUsd(r.called), fmtUsd(r.received), fmtUsd(r.outstanding),
          r.overdue > 0 ? fmtUsd(r.overdue) : '—',
        ]),
        rowKinds: partnerRows.map(() => 'detail' as const),
        keepTogether: partnerRows.length <= 18,
      }],
    });
  }

  const periodTables = buildPeriodTables(input.calls);
  for (let i = 0; i < periodTables.length; i++) {
    blocks.push({
      heading: periodTables[i].title ?? `Capital Call Register ${i + 1}`,
      pageBreakBefore: true,
      forcePageBreak: true,
      tables: [periodTables[i]],
    });
  }

  const strategy = buildStrategy(input);
  const asOf = [...new Set(input.calls.map(c => c.period).filter(Boolean))].slice(0, 3).join(', ')
    || input.periodLabel;

  return {
    tab: 'propdev-capital-calls',
    sectionTitle: 'Capital Calls',
    fileSectionName: 'PropDev_CapitalCalls',
    entityLabel: input.entityLabel,
    periodLabel: input.periodLabel,
    generatedAt: new Date().toISOString(),
    sourceNote: `Property Dev → Capital Calls · ${input.partnerFilterLabel} · as of ${asOf}`,
    kpis: [],
    charts: [],
    blocks,
    strategy,
  };
}
