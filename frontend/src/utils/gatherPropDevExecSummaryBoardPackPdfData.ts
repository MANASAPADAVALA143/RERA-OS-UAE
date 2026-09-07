import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import type { PropDevBoardExportPayload } from './gatherPropDevBoardExportData';
import { pickFocusSnapshot } from './gatherPropDevBoardExportData';
import { generatePropDevStrategyPlan } from './propDevExportNarrative';
import type { SectionPdfPayload, SectionPdfBlock, SectionPdfTable } from './gatherSectionPdfData';
import { EXEC_SUMMARY_PDF_THEME } from './pdfTheme';
import { computeEntityHealth, buildPropDevAlerts, monthlyBurnFor } from './propDevDailyPulseData';
import { buildPropDevActionPlan, type ActionItem } from './propDevActionPlanData';
import type { PropDevCompanyOverviewKpis } from './propDevCompanyOverview';

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
}
function pct(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

export function buildPropDevExecSummaryBoardPackPdf(params: {
  company: CompanyData;
  kpis: PropDevCompanyOverviewKpis | undefined;
  payload: PropDevBoardExportPayload;
  allLoans: Loan[];
  periodLabel: string;
}): SectionPdfPayload {
  const { company, kpis, payload, allLoans, periodLabel } = params;
  const strategy = generatePropDevStrategyPlan(payload);

  const bs = pickFocusSnapshot(payload.bsSnapshots, payload.focusYear);
  const cf = pickFocusSnapshot(payload.cfSnapshots, payload.focusYear);

  const health = computeEntityHealth([company], { [company.id]: kpis as PropDevCompanyOverviewKpis })[0];
  const alerts = buildPropDevAlerts([company], { [company.id]: kpis as PropDevCompanyOverviewKpis });
  const actions = buildPropDevActionPlan([company], { [company.id]: kpis as PropDevCompanyOverviewKpis });
  const burn = monthlyBurnFor(company);

  const blocks: SectionPdfBlock[] = [];

  // Executive Snapshot
  blocks.push({
    heading: 'Executive Snapshot',
    kpis: [
      { label: 'Cash', value: fmtUsd(kpis?.cash ?? null) },
      { label: 'NOI / Loss', value: fmtUsd(kpis?.netIncome ?? null) },
      { label: 'Total Debt', value: fmtUsd(kpis?.loanBalance ?? null) },
      { label: 'LTLV %', value: pct(kpis?.ltlv ?? null) },
    ],
    tables: [{
      title: 'Summary',
      headers: ['Metric', 'Value'],
      rows: [
        ['Health score', health ? `${health.compositeScore} — ${health.badge}` : '—'],
        ['Alerts requiring attention', String(alerts.length)],
        ['Commentary', strategy.commentary],
      ],
    }],
  });

  // Daily Pulse Summary
  const alertTable: SectionPdfTable = {
    title: 'Alerts',
    headers: ['Type', 'Status', 'Detail'],
    rows: alerts.length
      ? alerts.map(a => [a.type.replace(/_/g, ' '), a.status, a.description])
      : [['—', '—', 'No active alerts']],
  };
  blocks.push({
    heading: 'Daily Pulse Summary',
    forcePageBreak: true,
    kpis: [
      { label: 'Cash', value: fmtUsd(kpis?.cash ?? null) },
      { label: 'Monthly Burn', value: burn != null ? `${fmtUsd(burn)}/mo` : '—' },
      { label: 'Capital Calls Due', value: fmtUsd((company.capitalCalls ?? []).reduce((s, cc) => s + Math.max(0, (cc.totalDue ?? 0) - (cc.received ?? 0)), 0)) },
    ],
    tables: [alertTable],
  });

  // Deal P&L
  const plTable: SectionPdfTable = {
    title: 'Multi-Year P&L',
    headers: ['Year', 'Revenue', 'Expenses', 'NOI', 'Net Income', 'Margin'],
    rows: payload.plSnapshots.map(s => [s.yearLabel, fmtUsd(s.rev), fmtUsd(s.exp), fmtUsd(s.noi), fmtUsd(s.netInc), pct(s.margin)]),
  };
  blocks.push({ heading: 'Deal P&L', forcePageBreak: true, tables: [plTable] });

  // Balance Sheet
  const currentRatio = bs && bs.totalDebt > 0 ? bs.totalAssets / bs.totalDebt : null;
  const debtToEquity = bs && bs.equity !== 0 ? bs.totalDebt / bs.equity : null;
  blocks.push({
    heading: 'Balance Sheet',
    forcePageBreak: true,
    kpis: bs ? [
      { label: 'Total Assets', value: fmtUsd(bs.totalAssets) },
      { label: 'Total Liabilities', value: fmtUsd(bs.totalDebt) },
      { label: 'Equity', value: fmtUsd(bs.equity) },
      { label: 'Current Ratio', value: currentRatio != null ? `${currentRatio.toFixed(2)}x` : '—' },
      { label: 'Debt-to-Equity', value: debtToEquity != null ? `${debtToEquity.toFixed(2)}x` : '—' },
      { label: 'LTLV %', value: pct(bs.ltlv) },
    ] : [],
    tables: [{
      title: 'Balance Sheet Snapshot',
      headers: ['Year', 'Cash', 'Land', 'Improvements/WIP', 'Total Assets', 'Total Debt', 'Equity'],
      rows: payload.bsSnapshots.map(s => [s.yearLabel, fmtUsd(s.cash), fmtUsd(s.landValue), fmtUsd(s.improvementsWip), fmtUsd(s.totalAssets), fmtUsd(s.totalDebt), fmtUsd(s.equity)]),
    }],
  });

  // Cash Flow
  blocks.push({
    heading: 'Cash Flow',
    forcePageBreak: true,
    kpis: cf ? [
      { label: 'Cash Runway', value: cf.cashRunwayMonths != null ? `${cf.cashRunwayMonths.toFixed(1)} months` : 'N/A' },
      { label: 'Closing Cash', value: fmtUsd(cf.closingCash) },
    ] : [],
    tables: [{
      title: 'Cash Flow Summary',
      headers: ['Year', 'Operating CF', 'Investing CF', 'Financing CF', 'Net Change'],
      rows: payload.cfSnapshots.map(s => [s.yearLabel, fmtUsd(s.operatingCf), fmtUsd(s.investingCf), fmtUsd(s.financingCf), fmtUsd(s.netCashFlow)]),
    }],
  });

  // Ownership
  const activePartners = company.partners.filter(p => (p.status as string) !== 'Exited');
  const callRows = (company.capitalCalls ?? []).map(cc => [
    cc.partnerName, fmtUsd(cc.totalDue), fmtUsd(cc.received), fmtUsd(Math.max(0, (cc.totalDue ?? 0) - (cc.received ?? 0))), cc.status,
  ]);
  blocks.push({
    heading: 'Ownership',
    forcePageBreak: true,
    tables: [
      { title: 'Partners', headers: ['Partner', 'Capital', 'Share %'], rows: activePartners.map(p => [p.name, fmtUsd(p.capitalContributed), pct(p.sharePercent > 1 ? p.sharePercent : p.sharePercent * 100)]) },
      { title: 'Capital Calls Status', headers: ['Partner', 'Called', 'Received', 'Outstanding', 'Status'], rows: callRows.length ? callRows : [['—', '—', '—', '—', 'No capital calls']] },
    ],
  });

  // Action Plan
  const actionRows = (items: ActionItem[]) => items.map(a => [a.title, a.entity, a.detail, a.nextStep, a.dueDate ?? '—']);
  blocks.push({
    heading: 'Action Plan',
    forcePageBreak: true,
    tables: [
      { title: 'Critical', headers: ['Title', 'Entity', 'Detail', 'Next Step', 'Due'], rows: actionRows(actions.filter(a => a.priority === 'Critical')) || [] },
      { title: 'Warning', headers: ['Title', 'Entity', 'Detail', 'Next Step', 'Due'], rows: actionRows(actions.filter(a => a.priority === 'Warning')) },
      { title: 'Info', headers: ['Title', 'Entity', 'Detail', 'Next Step', 'Due'], rows: actionRows(actions.filter(a => a.priority === 'Info')) },
    ].map(t => t.rows.length ? t : { ...t, rows: [['—', '—', 'No items', '—', '—']] }),
  });

  return {
    tab: 'propdev-exec-summary',
    sectionTitle: 'Executive Board Pack',
    fileSectionName: 'Board_Pack',
    entityLabel: company.name,
    periodLabel,
    generatedAt: new Date().toISOString(),
    sourceNote: 'EstateCFO · Property Development Board Pack · Confidential',
    kpis: [],
    charts: [],
    blocks,
    strategy,
    theme: EXEC_SUMMARY_PDF_THEME,
  };
}
