/**
 * CEO Board Review PPT — section-sourced deck, RERA OS indigo/purple palette.
 */
import PptxGenJSImport from 'pptxgenjs';

/** Vite resolves default export; Node/tsx may expose the constructor on `.default`. */
const PptxGenJS = (
  typeof PptxGenJSImport === 'function'
    ? PptxGenJSImport
    : (PptxGenJSImport as { default: typeof PptxGenJSImport }).default
);
import type { ExportKpiItem } from './rentalKpiEngine';
import type { EmiStatusRow } from './executiveSummaryEmi';
import type { RiskActionRow } from './executiveSummaryActionRules';
import type { SlideNarratives } from './executiveSummaryNarrative';
import type {
  ArDashboardSection,
  BalanceSheetSection,
  CashFlowSection,
  ExpensesSection,
  IncomeStatementSection,
  RentalPortfolioSection,
} from './executiveSummaryPptSections';

const C = {
  pageBg: 'F7F1E6', cardBg: 'FBF6EE', border: 'E8DEC8',
  gold: '6366F1', darkGold: '4F46E5', purple: '7C3AED', teal: '14B8A6', text: '0F172A', muted: '64748B',
  sidebar: '3A2F1F', green: '166534', amber: 'F5A623', red: 'B91C1C',
  blue: '1F6FEB', teal: '0F766E',
};

export interface CeoBoardExportPayload {
  entityLabel: string;
  periodLabel: string;
  generatedAt: string;
  executiveNarrative: string;
  portfolioSnapshot: {
    totalUnits: string; occupiedUnits: string; vacantUnits: number;
    marketValue: string; marketValueSource: string; totalDebt: string; loanCount: number;
    unitsByCompany: { name: string; units: number }[];
    assetComposition: { name: string; value: number }[];
    debtComposition: { name: string; value: number }[];
  };
  rentalPerformance: {
    occupancy: string; gpr: string; collected: string; vacancyLoss: string;
    collectionRate: string; arOutstanding: string;
    gprTrend: { month: string; gpr: number; collected: number; occupancy: number | null }[];
  };
  /** Rentals → Financials · Income Statement */
  incomeStatement: IncomeStatementSection;
  /** Rentals → Financials · Balance Sheet */
  balanceSheet: BalanceSheetSection;
  /** Rentals → Financials · Cash Flow */
  cashFlow: CashFlowSection;
  /** Rentals → Rental Portfolio Overview */
  rentalPortfolio: RentalPortfolioSection;
  /** Rentals → Expenses */
  expenses: ExpensesSection;
  /** Rentals → AR Dashboard */
  arDashboard: ArDashboardSection;
  /** @deprecated merged into incomeStatement — kept for narrative compat */
  financialPerformance: {
    available: boolean; profitability: ExportKpiItem[];
    waterfall: { label: string; value: string }[];
    trend: { month: string; revenue: number; expenses: number; noi: number }[];
    noi: string; sourceNote: string;
  };
  cashPosition: {
    balance: string; trend: { month: string; cash: number }[];
    runwayNote: string;
  };
  loanPortfolio: {
    available: boolean; summary: ExportKpiItem[];
    totalDebt: string; loanCount: string;
    portfolioDscr: string; interestCoverage: string;
    emiRows: EmiStatusRow[]; emiDisclaimer: string;
    worstDscr: { name: string; dscr: number }[];
  };
  debtRisk: {
    available: boolean;
    dscrByProperty: { name: string; dscr: number }[];
    ltvByProperty: { name: string; ltv: number }[];
    maturityBuckets: { label: string; amount: number; count: number }[];
  };
  ownership: {
    available: boolean; totalPartners: string; totalCapital: string;
    portfolioMarketValue: string;
    totalEquity: string; avgRoi: string;
    partnerSlices: { name: string; value: number }[];
    roiByPartner: { name: string; roi: number }[];
  };
  /** @deprecated not in current deck structure */
  propertyProfitability: {
    available: boolean;
    rows: {
      property: string; occupancy: string; noiMargin: string; dscr: string; arrears: string; flagged: boolean;
      occupancyPct: number | null; noiMarginPct: number | null; noiDollars: number | null;
    }[];
  };
  riskActionTable: RiskActionRow[];
  actionPlanCommentary: string;
  slideNarratives: SlideNarratives;
  strategicRecommendations: string[];
}

/** Legacy types kept for compatibility */
export interface ExecOverviewKpi { label: string; value: string; sub?: string; }
export interface LoanExportRow { company: string; bank: string; balance: string; rate: string; maturity: string; emi: string; }
export interface ExecExportPayload extends CeoBoardExportPayload {}

function header(slide: PptxGenJS.Slide, title: string, subtitle: string) {
  slide.addShape('rect', { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.pageBg } });
  slide.addShape('rect', { x: 0, y: 0, w: 0.35, h: 5.625, fill: { color: C.gold } });
  slide.addShape('rect', { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.sidebar } });
  slide.addText(title, { x: 0.5, y: 0.15, w: 9, h: 0.5, fontSize: 22, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI' });
  slide.addText(subtitle, { x: 0.5, y: 0.55, w: 9, h: 0.3, fontSize: 11, color: C.gold, fontFace: 'Segoe UI' });
}

function footer(slide: PptxGenJS.Slide, entity: string, period: string) {
  slide.addText(`RERA OS · ${entity} · ${period}`, {
    x: 0.4, y: 5.35, w: 9, h: 0.2, fontSize: 8, color: C.muted, fontFace: 'Segoe UI',
  });
}

function kpiCards(slide: PptxGenJS.Slide, items: { label: string; value: string; sub?: string }[], startY = 1.05, cols = 4) {
  const cardW = 2.25;
  const cardH = 0.9;
  items.slice(0, 8).forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.4 + col * (cardW + 0.15);
    const y = startY + row * (cardH + 0.12);
    slide.addShape('roundRect', { x, y, w: cardW, h: cardH, fill: { color: C.cardBg }, line: { color: C.border, width: 1 }, rectRadius: 0.08 });
    slide.addShape('rect', { x, y, w: 0.06, h: cardH, fill: { color: C.gold } });
    slide.addText(item.label.toUpperCase(), { x: x + 0.12, y: y + 0.06, w: cardW - 0.15, h: 0.18, fontSize: 8, bold: true, color: C.muted, fontFace: 'Segoe UI' });
    slide.addText(item.value, { x: x + 0.12, y: y + 0.24, w: cardW - 0.15, h: 0.32, fontSize: 14, bold: true, color: C.text, fontFace: 'Segoe UI' });
    if (item.sub) {
      slide.addText(item.sub, { x: x + 0.12, y: y + 0.58, w: cardW - 0.15, h: 0.2, fontSize: 7, color: C.muted, fontFace: 'Segoe UI' });
    }
  });
}

function prose(slide: PptxGenJS.Slide, text: string, y = 1.1) {
  slide.addShape('roundRect', { x: 0.4, y, w: 9.2, h: 3.8, fill: { color: C.cardBg }, line: { color: C.border, width: 1 }, rectRadius: 0.1 });
  slide.addText(text, {
    x: 0.6, y: y + 0.2, w: 8.8, h: 3.4,
    fontSize: 13, color: C.text, fontFace: 'Segoe UI', valign: 'top', lineSpacingMultiple: 1.35,
  });
}

function bullets(slide: PptxGenJS.Slide, items: string[], y = 1.1) {
  slide.addShape('roundRect', { x: 0.4, y, w: 9.2, h: 3.8, fill: { color: C.cardBg }, line: { color: C.border, width: 1 }, rectRadius: 0.1 });
  const body = items.map(b => `• ${b}`).join('\n\n');
  slide.addText(body, {
    x: 0.6, y: y + 0.2, w: 8.8, h: 3.4,
    fontSize: 12, color: C.text, fontFace: 'Segoe UI', valign: 'top', lineSpacingMultiple: 1.3,
  });
}

function table(slide: PptxGenJS.Slide, headers: string[], rows: string[][], y: number, colW?: number[]) {
  if (!rows.length) {
    slide.addText('Data not available — see source page', { x: 0.4, y: y + 0.2, w: 9, h: 0.4, fontSize: 12, color: C.muted });
    return;
  }
  slide.addTable([headers, ...rows] as PptxGenJS.TableRow[], {
    x: 0.4, y, w: 9.2, fontSize: 8, fontFace: 'Segoe UI', color: C.text,
    border: { type: 'solid', color: C.border, pt: 0.5 },
    fill: { color: C.cardBg },
    colW,
  });
}

function na(slide: PptxGenJS.Slide, msg: string, y = 1.5) {
  slide.addText(msg, { x: 0.4, y, w: 9, h: 0.5, fontSize: 12, color: C.muted, fontFace: 'Segoe UI' });
}

function valPct(value: string): number | null {
  const m = value.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function chartOpts(x: number, y: number, w: number, h: number): PptxGenJS.IChartOpts {
  return {
    x, y, w, h,
    showLegend: true,
    legendPos: 'b',
    catAxisLabelSize: 8,
    valAxisLabelSize: 8,
    showValue: false,
  };
}

/** CFO commentary block — below title bar, above charts/KPIs (slides 3–11). */
const NARR_Y = 0.92;
const NARR_H = 0.58;
const KPI_Y = 1.58;
const CHART_Y = 2.78;
const CHART_Y_TALL = 2.95;
const TABLE_Y = 3.55;

function slideCommentary(slide: PptxGenJS.Slide, text: string) {
  if (!text?.trim()) return;
  slide.addShape('roundRect', {
    x: 0.4, y: NARR_Y, w: 9.2, h: NARR_H,
    fill: { color: C.cardBg }, line: { color: C.border, width: 0.5 }, rectRadius: 0.06,
  });
  slide.addText(text, {
    x: 0.52, y: NARR_Y + 0.05, w: 8.95, h: NARR_H - 0.08,
    fontSize: 9.5, color: C.text, fontFace: 'Segoe UI', valign: 'top', lineSpacingMultiple: 1.15,
  });
}

export function buildCeoBoardReviewFilename(entityLabel: string, periodLabel: string): string {
  const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
  return `RERA_OS_CEOBoardReview_${safe(entityLabel)}_${safe(periodLabel)}.pptx`;
}

export function buildExecutiveSummaryFilename(entityLabel: string, periodLabel: string): string {
  return buildCeoBoardReviewFilename(entityLabel, periodLabel);
}

export async function generateCeoBoardReviewPpt(data: CeoBoardExportPayload): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'RERA OS';
  pptx.title = `CEO Board Review — ${data.entityLabel}`;

  // 1 — Title
  {
    const s = pptx.addSlide();
    s.addShape('rect', { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.sidebar } });
    s.addShape('rect', { x: 0, y: 0, w: 0.4, h: 5.625, fill: { color: C.gold } });
    s.addText(data.entityLabel, { x: 0.6, y: 1.6, w: 8.8, h: 0.8, fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI' });
    s.addText('Rentals & Lease — CEO Business Review', { x: 0.6, y: 2.45, w: 8.8, h: 0.4, fontSize: 16, color: C.gold, fontFace: 'Segoe UI' });
    s.addText(data.periodLabel, { x: 0.6, y: 2.95, w: 8.8, h: 0.35, fontSize: 14, color: 'CCCCCC', fontFace: 'Segoe UI' });
    s.addText(`Generated ${data.generatedAt}`, { x: 0.6, y: 4.8, w: 8, h: 0.3, fontSize: 10, color: C.muted, fontFace: 'Segoe UI' });
  }

  // 2 — Executive Summary narrative
  {
    const s = pptx.addSlide();
    header(s, 'Executive Summary', 'CEO talking points — read this slide first');
    prose(s, data.executiveNarrative);
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 3 — Portfolio Snapshot
  {
    const ps = data.portfolioSnapshot;
    const s = pptx.addSlide();
    header(s, 'Portfolio Snapshot', 'Company Registry · Loan Tracker · Ownership');
    slideCommentary(s, data.slideNarratives.portfolioSnapshot);
    kpiCards(s, [
      { label: 'Total Units', value: ps.totalUnits },
      { label: 'Occupied Units', value: ps.occupiedUnits, sub: ps.vacantUnits > 0 ? `${ps.vacantUnits} vacant` : undefined },
      { label: 'Portfolio Market Value', value: ps.marketValue, sub: ps.marketValueSource },
      { label: 'Total Loan Outstanding', value: ps.totalDebt, sub: `${ps.loanCount} loans` },
    ], KPI_Y);
    const occupied = Number(ps.occupiedUnits) || 0;
    const total = Number(ps.totalUnits) || 0;
    const vacant = Math.max(0, total - occupied);
    if (total > 0) {
      s.addChart(pptx.ChartType.doughnut,
        [{ name: 'Units', labels: ['Occupied', 'Vacant'], values: [occupied, vacant] }],
        { ...chartOpts(0.5, CHART_Y, 3.8, 2.35), chartColors: [C.green, C.amber], holeSize: 55, showPercent: true });
    } else na(s, 'Data not available — see Company Registry', CHART_Y + 0.5);
    const unitData = ps.unitsByCompany.slice(0, 8);
    if (unitData.length) {
      s.addChart(pptx.ChartType.bar,
        [{ name: 'Units', labels: unitData.map(u => u.name), values: unitData.map(u => u.units) }],
        { ...chartOpts(4.8, CHART_Y, 4.7, 2.35), barDir: 'col', chartColors: [C.gold] });
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 4 — Rental Performance (Executive Summary band)
  {
    const rp = data.rentalPerformance;
    const s = pptx.addSlide();
    header(s, 'Rental Performance', 'Company Registry · Rent Receivable');
    slideCommentary(s, data.slideNarratives.rentalPerformance);
    kpiCards(s, [
      { label: 'Physical Occupancy', value: rp.occupancy },
      { label: 'GPR', value: rp.gpr },
      { label: 'Collected', value: rp.collected },
      { label: 'Collection Rate', value: rp.collectionRate },
    ], KPI_Y, 4);
    if (rp.gprTrend.length > 0 && rp.gprTrend.some(t => t.gpr > 0 || t.collected > 0)) {
      const labels = rp.gprTrend.map(t => t.month);
      const occSeries = rp.gprTrend.map(t => t.occupancy ?? (valPct(rp.occupancy) ?? 0));
      s.addChart([
        { type: pptx.ChartType.bar, data: [
          { name: 'GPR', labels, values: rp.gprTrend.map(t => t.gpr) },
          { name: 'Collected', labels, values: rp.gprTrend.map(t => t.collected) },
        ], options: { barDir: 'col', chartColors: [C.gold, C.green] } },
        { type: pptx.ChartType.line, data: [{ name: 'Occupancy %', labels, values: occSeries }],
          options: { lineSize: 2, chartColors: [C.blue], secondaryValAxis: true } },
      ], { ...chartOpts(0.5, CHART_Y_TALL, 9.0, 2.45), secondaryValAxis: true, valAxisTitle: 'Amount ($)' });
    } else na(s, 'Data not available — see Rental Portfolio Overview', CHART_Y + 0.5);
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 5 — Income Statement
  {
    const isec = data.incomeStatement;
    const s = pptx.addSlide();
    header(s, 'Income Statement', isec.sourceNote);
    slideCommentary(s, data.slideNarratives.incomeStatement);
    if (isec.available) {
      kpiCards(s, [
        { label: 'Revenue (Latest)', value: isec.latestRevenue },
        { label: 'Expenses (Latest)', value: isec.latestExpenses },
        { label: 'NOI (Latest)', value: isec.latestNoi },
      ], KPI_Y, 3);
      if (isec.monthlyTrend.length) {
        const labels = isec.monthlyTrend.map(t => t.month);
        s.addChart([
          { type: pptx.ChartType.bar, data: [
            { name: 'Revenue', labels, values: isec.monthlyTrend.map(t => t.revenue) },
            { name: 'Expenses', labels, values: isec.monthlyTrend.map(t => t.expenses) },
          ], options: { barDir: 'col', chartColors: [C.teal, C.red] } },
          { type: pptx.ChartType.line, data: [{ name: 'NOI', labels, values: isec.monthlyTrend.map(t => t.noi) }],
            options: { lineSize: 2, chartColors: [C.gold] } },
        ], { ...chartOpts(0.5, CHART_Y, 5.5, 2.2), showTitle: true, title: 'Monthly Revenue & NOI', titleFontSize: 10, titleColor: C.muted });
      }
      const expPie = isec.expenseCategories.slice(0, 6);
      if (expPie.length) {
        s.addChart(pptx.ChartType.doughnut,
          [{ name: 'Expenses', labels: expPie.map(e => e.name.slice(0, 14)), values: expPie.map(e => e.value) }],
          { ...chartOpts(6.3, CHART_Y, 3.3, 2.2), chartColors: [C.gold, C.teal, C.green, C.red, C.amber, C.blue], holeSize: 50,
            showTitle: true, title: 'Cost Structure', titleFontSize: 10, titleColor: C.muted });
      }
    } else {
      na(s, 'Data not available — see Rentals → Financials → Income Statement');
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 6 — Income Statement multi-year (if data)
  if (data.incomeStatement.yearSnapshots.length >= 2) {
    const ys = data.incomeStatement.yearSnapshots;
    const s = pptx.addSlide();
    header(s, 'Income Statement — Multi-Year Trends', 'Financials · CFO Dashboard charts');
    const labels = ys.map(y => String(y.year));
    s.addChart(pptx.ChartType.line,
      [{ name: 'Net Income', labels, values: ys.map(y => y.netIncome) }],
      { ...chartOpts(0.5, 1.05, 4.4, 2.0), chartColors: [C.teal], showTitle: true, title: 'Net Income Trajectory', titleFontSize: 9, titleColor: C.muted });
    s.addChart(pptx.ChartType.line,
      [{ name: 'Expense Ratio %', labels, values: ys.map(y => y.revenue > 0 ? (y.expenses / y.revenue) * 100 : 0) }],
      { ...chartOpts(5.1, 1.05, 4.4, 2.0), chartColors: [C.red], showTitle: true, title: 'Expense Ratio Trend', titleFontSize: 9, titleColor: C.muted });
    s.addChart(pptx.ChartType.bar,
      [
        { name: 'Revenue', labels, values: ys.map(y => y.revenue) },
        { name: 'Expenses', labels, values: ys.map(y => y.expenses) },
      ],
      { ...chartOpts(0.5, 3.2, 4.4, 2.0), barDir: 'col', chartColors: [C.gold, C.red], showTitle: true, title: 'Revenue vs Expenses', titleFontSize: 9, titleColor: C.muted });
    s.addChart(pptx.ChartType.bar,
      [
        { name: 'Rental', labels, values: ys.map(y => y.rentalIncome) },
        { name: 'Other', labels, values: ys.map(y => y.otherIncome + y.services) },
      ],
      { ...chartOpts(5.1, 3.2, 4.4, 2.0), barDir: 'col', barGrouping: 'stacked', chartColors: [C.teal, C.amber],
        showTitle: true, title: 'Revenue Breakdown by Year', titleFontSize: 9, titleColor: C.muted });
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 7 — Balance Sheet
  {
    const bs = data.balanceSheet;
    const s = pptx.addSlide();
    header(s, 'Balance Sheet', bs.sourceNote);
    slideCommentary(s, data.slideNarratives.balanceSheet);
    if (bs.available) {
      kpiCards(s, [
        { label: 'Total Assets', value: bs.totalAssets },
        { label: 'Total Liabilities', value: bs.totalLiabilities },
        { label: 'Equity', value: bs.equity },
        { label: 'Cash Balance', value: bs.cashBalance },
        { label: 'Debt-to-Equity', value: bs.debtToEquity },
        { label: 'Debt-to-Asset', value: bs.debtToAsset },
      ], KPI_Y - 0.05, 3);
      if (bs.assetComposition.length) {
        s.addChart(pptx.ChartType.doughnut,
          [{ name: 'Assets', labels: bs.assetComposition.map(a => a.name), values: bs.assetComposition.map(a => a.value) }],
          { ...chartOpts(0.5, CHART_Y, 4.2, 2.3), chartColors: [C.gold, C.blue, C.teal], holeSize: 55,
            showTitle: true, title: 'Asset Composition', titleFontSize: 10, titleColor: C.muted });
      }
      if (bs.capitalStructure.length) {
        s.addChart(pptx.ChartType.doughnut,
          [{ name: 'Capital', labels: bs.capitalStructure.map(a => a.name), values: bs.capitalStructure.map(a => a.value) }],
          { ...chartOpts(5.3, CHART_Y, 4.2, 2.3), chartColors: [C.red, C.green, C.amber], holeSize: 55,
            showTitle: true, title: 'Capital Structure', titleFontSize: 10, titleColor: C.muted });
      }
    } else na(s, 'Data not available — see Rentals → Financials → Balance Sheet');
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 8 — Cash Flow
  {
    const cf = data.cashFlow;
    const s = pptx.addSlide();
    header(s, 'Cash Flow', cf.sourceNote);
    slideCommentary(s, data.slideNarratives.cashFlow);
    kpiCards(s, [
      { label: 'Operating CF', value: cf.operatingCf },
      { label: 'Financing CF', value: cf.financingCf },
      { label: 'Investing CF', value: cf.investingCf },
    ], KPI_Y, 3);
    if (cf.cashTrend.length) {
      s.addChart(pptx.ChartType.line,
        [{ name: 'Cash Balance', labels: cf.cashTrend.map(t => t.month), values: cf.cashTrend.map(t => t.cash) }],
        { ...chartOpts(0.5, CHART_Y, 4.3, 2.3), chartColors: [C.blue], lineSize: 3,
          showTitle: true, title: 'Cash Balance Trend (point-in-time)', titleFontSize: 10, titleColor: C.muted });
    }
    if (cf.operatingVsFinancing.length) {
      s.addChart(pptx.ChartType.bar,
        [
          { name: 'Operating', labels: cf.operatingVsFinancing.map(t => t.month), values: cf.operatingVsFinancing.map(t => t.operating) },
          { name: 'Financing', labels: cf.operatingVsFinancing.map(t => t.month), values: cf.operatingVsFinancing.map(t => t.financing) },
        ],
        { ...chartOpts(5.0, CHART_Y, 4.3, 2.3), barDir: 'col', chartColors: [C.teal, C.red],
          showTitle: true, title: 'Operating vs Financing', titleFontSize: 10, titleColor: C.muted });
    }
    if (!cf.available) na(s, 'Data not available — see Rentals → Financials → Cash Flow', CHART_Y + 0.8);
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 9 — Rental Portfolio Overview
  {
    const rp = data.rentalPortfolio;
    const s = pptx.addSlide();
    header(s, 'Rental Portfolio Overview', rp.sourceNote);
    slideCommentary(s, data.slideNarratives.rentalPortfolio);
    kpiCards(s, [
      { label: 'Occupancy Rate', value: rp.occupancy },
      { label: 'Collected This Month', value: rp.collected },
      { label: 'Collection Rate', value: rp.collectionRate },
      { label: 'Vacancy Loss', value: rp.vacancyLoss },
      { label: 'Outstanding AR', value: rp.arOutstanding },
      { label: 'NOI Margin (P&L)', value: rp.noiMargin },
    ], KPI_Y - 0.05, 3);
    if (rp.gprTrend.length) {
      const labels = rp.gprTrend.map(t => t.month);
      s.addChart([
        { type: pptx.ChartType.bar, data: [
          { name: 'GPR', labels, values: rp.gprTrend.map(t => t.gpr) },
          { name: 'Collected', labels, values: rp.gprTrend.map(t => t.collected) },
        ], options: { barDir: 'col', chartColors: [C.gold, C.green] } },
        { type: pptx.ChartType.line, data: [{ name: 'Occupancy %', labels, values: rp.gprTrend.map(t => t.occupancy ?? 0) }],
          options: { lineSize: 2, chartColors: [C.blue], secondaryValAxis: true } },
      ], { ...chartOpts(0.5, CHART_Y_TALL, 9.0, 2.4), secondaryValAxis: true });
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 10 — Ownership
  {
    const ow = data.ownership;
    const s = pptx.addSlide();
    header(s, 'Ownership', 'Rentals → Ownership');
    slideCommentary(s, data.slideNarratives.ownership);
    if (ow.available) {
      kpiCards(s, [
        { label: 'Total Partners', value: ow.totalPartners },
        { label: 'Total Capital Raised', value: ow.totalCapital },
        { label: 'Portfolio Market Value', value: ow.portfolioMarketValue },
        { label: 'Total Equity', value: ow.totalEquity },
        { label: 'Avg Partner ROI', value: ow.avgRoi },
      ], KPI_Y, 3);
      if (ow.partnerSlices.length) {
        s.addChart(pptx.ChartType.doughnut,
          [{ name: 'Ownership', labels: ow.partnerSlices.map(p => p.name), values: ow.partnerSlices.map(p => p.value) }],
          { ...chartOpts(0.5, CHART_Y, 4.4, 2.45), chartColors: [C.gold, C.blue, C.green, C.amber, C.red], holeSize: 55 });
      }
      if (ow.roiByPartner.length) {
        const avg = valPct(ow.avgRoi) ?? 0;
        const roi = ow.roiByPartner.slice(0, 8);
        s.addChart([
          { type: pptx.ChartType.bar, data: [{ name: 'ROI %', labels: roi.map(r => r.name), values: roi.map(r => r.roi) }],
            options: { barDir: 'col', chartColors: [C.teal] } },
          { type: pptx.ChartType.line, data: [{ name: 'Avg ROI', labels: roi.map(r => r.name), values: roi.map(() => avg) }],
            options: { lineSize: 2, chartColors: [C.red] } },
        ], { ...chartOpts(5.1, CHART_Y, 4.4, 2.45), valAxisTitle: 'ROI %' });
      }
    } else na(s, 'Data not available — see Rentals → Ownership');
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 11 — Expenses
  {
    const ex = data.expenses;
    const s = pptx.addSlide();
    header(s, 'Expenses', ex.sourceNote);
    slideCommentary(s, data.slideNarratives.expenses);
    if (ex.available && ex.trend6Mo.length) {
      s.addChart(pptx.ChartType.line,
        [{ name: 'Total Expenses', labels: ex.trend6Mo.map(t => t.month), values: ex.trend6Mo.map(t => t.amount) }],
        { ...chartOpts(0.5, KPI_Y, 5.5, 2.4), chartColors: [C.gold], lineSize: 2,
          showTitle: true, title: `Expense Trend — 6 Months to ${ex.trendEndLabel}`, titleFontSize: 10, titleColor: C.muted });
    }
    const pie = ex.breakdown.slice(0, 6);
    if (pie.length) {
      s.addChart(pptx.ChartType.doughnut,
        [{ name: 'Category', labels: pie.map(p => p.name.slice(0, 12)), values: pie.map(p => p.value) }],
        { ...chartOpts(6.2, KPI_Y, 3.4, 2.4), chartColors: [C.gold, C.teal, C.red, C.amber, C.green, C.blue], holeSize: 50,
          showTitle: true, title: 'Expense Breakdown', titleFontSize: 10, titleColor: C.muted });
    }
    if (!ex.available) na(s, 'Data not available — see Rentals → Expenses');
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 12 — AR Dashboard
  {
    const ar = data.arDashboard;
    const s = pptx.addSlide();
    header(s, 'AR Dashboard', ar.sourceNote);
    slideCommentary(s, data.slideNarratives.arDashboard);
    kpiCards(s, [
      { label: 'Est. Days to Collect (DSO)', value: ar.dso },
      { label: 'Overdue AR (30+)', value: ar.overdue30 },
      { label: 'Overdue AR (60+)', value: ar.overdue60 },
      { label: 'Overdue AR (90+)', value: ar.overdue90 },
      { label: 'Credit Balance', value: ar.creditBalance, sub: 'Excluded from DSO' },
    ], KPI_Y - 0.05, 3);
    if (ar.agingChart.length) {
      s.addChart(pptx.ChartType.bar,
        [{ name: 'AR', labels: ar.agingChart.map(b => b.label), values: ar.agingChart.map(b => b.amount) }],
        { ...chartOpts(0.5, CHART_Y_TALL, 9.0, 2.4), barDir: 'col', chartColors: [C.teal], showTitle: true,
          title: 'AR Aging by Bucket', titleFontSize: 10, titleColor: C.muted });
    } else if (!ar.available) {
      na(s, 'Data not available — see Rentals → AR Dashboard', CHART_Y + 0.5);
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 13 — Loan Portfolio & EMI Status
  {
    const lp = data.loanPortfolio;
    const s = pptx.addSlide();
    header(s, 'Loan Portfolio & EMI Status', 'Loan Tracker');
    slideCommentary(s, data.slideNarratives.loanPortfolio);
    if (lp.available) {
      kpiCards(s, lp.summary.slice(0, 6).map(item => ({ label: item.label, value: item.value, sub: item.benchmark })), KPI_Y - 0.05, 3);
      const emiTable = lp.emiRows.slice(0, 7).map(e => [
        e.loanName.slice(0, 14), e.lender.slice(0, 10), e.outstanding, e.emiAmount,
        e.emiDueDate, e.paymentStatus, e.interestRate, e.maturityDate,
      ]);
      table(s, ['Loan', 'Lender', 'Balance', 'EMI', 'Due', 'Status', 'Rate', 'Maturity'],
        emiTable, 2.55, [1.1, 0.9, 0.9, 0.7, 0.8, 0.7, 0.6, 0.8]);
      s.addText(lp.emiDisclaimer, { x: 0.4, y: 4.85, w: 9, h: 0.35, fontSize: 7, color: C.muted, fontFace: 'Segoe UI' });
    } else na(s, 'Data not available — see Loan Tracker');
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 14 — Debt Risk & Maturities
  {
    const dr = data.debtRisk;
    const s = pptx.addSlide();
    header(s, 'Debt Risk & Maturities', 'Loan Tracker · Financial Ratios');
    slideCommentary(s, data.slideNarratives.debtRisk);
    if (dr.available) {
      const dscr = dr.dscrByProperty.slice(0, 8);
      const ltv = dr.ltvByProperty.slice(0, 8);
      if (dscr.length) {
        s.addChart([
          { type: pptx.ChartType.bar, data: [{ name: 'DSCR', labels: dscr.map(d => d.name), values: dscr.map(d => d.dscr) }],
            options: { barDir: 'col', chartColors: [C.teal] } },
          { type: pptx.ChartType.line, data: [{ name: 'Covenant 1.2x', labels: dscr.map(d => d.name), values: dscr.map(() => 1.2) }],
            options: { lineSize: 2, chartColors: [C.red] } },
        ], { ...chartOpts(0.5, KPI_Y + 0.1, 4.4, 2.15), valAxisTitle: 'DSCR' });
      }
      if (ltv.length) {
        const labels = ltv.map(l => l.name);
        s.addChart(pptx.ChartType.bar,
          [
            { name: 'Healthy ≤75%', labels, values: ltv.map(l => (l.ltv <= 75 ? l.ltv : 0)) },
            { name: 'At Risk >75%', labels, values: ltv.map(l => (l.ltv > 75 ? l.ltv : 0)) },
          ],
          { ...chartOpts(5.1, KPI_Y + 0.1, 4.4, 2.15), barDir: 'col', barGrouping: 'clustered', chartColors: [C.gold, C.red], valAxisTitle: 'LTV %' });
      }
      const matRows = dr.maturityBuckets.map(b => [b.label, `$${(b.amount / 1000).toFixed(0)}k`, String(b.count)]);
      table(s, ['Maturity Window', 'Balance', 'Loans'], matRows, TABLE_Y, [2.5, 2, 1.5]);
    } else na(s, 'Data not available — see Loan Tracker');
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 15 — Strategic Decisions
  {
    const s = pptx.addSlide();
    header(s, 'Strategic Decisions', 'Synthesized from deck metrics — CEO decision language');
    bullets(s, data.strategicRecommendations);
    footer(s, data.entityLabel, data.periodLabel);
  }

  // 16 — Action Plan + commentary
  {
    const s = pptx.addSlide();
    header(s, 'Action Plan', 'Rule-based flags · DSCR · LTV · Vacancy · Arrears · NOI · EMI');
    if (data.actionPlanCommentary) {
      slideCommentary(s, data.actionPlanCommentary);
    }
    if (data.riskActionTable.length > 0) {
      const rows = data.riskActionTable.slice(0, 9).map(r => [
        r.property.slice(0, 14), r.issue, r.kpi, r.impact.slice(0, 28), r.owner.slice(0, 14), r.dueDate,
      ]);
      table(s, ['Property', 'Issue', 'KPI', 'Impact', 'Owner', 'Due'], rows, KPI_Y + 0.1,
        [1.2, 1.3, 1, 1.8, 1.2, 0.9]);
    } else {
      na(s, 'No critical flags — portfolio within normal parameters', KPI_Y + 0.3);
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  await pptx.writeFile({ fileName: buildCeoBoardReviewFilename(data.entityLabel, data.periodLabel) });
}

function slideDualTable(
  slide: PptxGenJS.Slide,
  leftTitle: string, leftRows: string[][],
  rightTitle: string, rightRows: string[][],
  y: number,
) {
  slide.addText(leftTitle, { x: 0.4, y, w: 4.2, h: 0.25, fontSize: 11, bold: true, color: C.text, fontFace: 'Segoe UI' });
  slide.addText(rightTitle, { x: 5.2, y, w: 4.2, h: 0.25, fontSize: 11, bold: true, color: C.text, fontFace: 'Segoe UI' });
  if (leftRows.length) {
    slide.addTable([['Name', 'Value'], ...leftRows] as PptxGenJS.TableRow[], {
      x: 0.4, y: y + 0.28, w: 4.4, fontSize: 8, fontFace: 'Segoe UI', color: C.text,
      border: { type: 'solid', color: C.border, pt: 0.5 }, fill: { color: C.cardBg },
    });
  } else {
    slide.addText('No data', { x: 0.4, y: y + 0.35, w: 4, h: 0.3, fontSize: 9, color: C.muted });
  }
  if (rightRows.length) {
    slide.addTable([['Name', 'Units'], ...rightRows] as PptxGenJS.TableRow[], {
      x: 5.2, y: y + 0.28, w: 4.4, fontSize: 8, fontFace: 'Segoe UI', color: C.text,
      border: { type: 'solid', color: C.border, pt: 0.5 }, fill: { color: C.cardBg },
    });
  } else {
    slide.addText('No data', { x: 5.2, y: y + 0.35, w: 4, h: 0.3, fontSize: 9, color: C.muted });
  }
}

export async function generateExecutiveSummaryPpt(data: CeoBoardExportPayload): Promise<void> {
  return generateCeoBoardReviewPpt(data);
}
