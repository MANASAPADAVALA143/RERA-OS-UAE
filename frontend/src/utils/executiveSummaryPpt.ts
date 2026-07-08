/**
 * CEO Board Review PPT — 12-slide deck, EstateCFO gold/parchment palette.
 */
import PptxGenJS from 'pptxgenjs';
import type { ExportKpiItem } from './rentalKpiEngine';
import type { EmiStatusRow } from './executiveSummaryEmi';
import type { RiskActionRow } from './executiveSummaryActionRules';

const C = {
  pageBg: 'F7F1E6', cardBg: 'FBF6EE', border: 'E8DEC8',
  gold: 'D4AF37', darkGold: 'B8860B', text: '1C1917', muted: '78716C',
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
    totalEquity: string; avgRoi: string;
    partnerSlices: { name: string; value: number }[];
    roiByPartner: { name: string; roi: number }[];
  };
  propertyProfitability: {
    available: boolean;
    rows: {
      property: string; occupancy: string; noiMargin: string; dscr: string; arrears: string; flagged: boolean;
      occupancyPct: number | null; noiMarginPct: number | null; noiDollars: number | null;
    }[];
  };
  riskActionTable: RiskActionRow[];
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
  slide.addText(`EstateCFO · ${entity} · ${period}`, {
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

export function buildCeoBoardReviewFilename(entityLabel: string, periodLabel: string): string {
  const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
  return `EstateCFO_CEOBoardReview_${safe(entityLabel)}_${safe(periodLabel)}.pptx`;
}

export function buildExecutiveSummaryFilename(entityLabel: string, periodLabel: string): string {
  return buildCeoBoardReviewFilename(entityLabel, periodLabel);
}

export async function generateCeoBoardReviewPpt(data: CeoBoardExportPayload): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'EstateCFO';
  pptx.title = `CEO Board Review — ${data.entityLabel}`;
  const sub = `${data.entityLabel} · ${data.periodLabel}`;

  // SLIDE 1 — Title
  {
    const s = pptx.addSlide();
    s.addShape('rect', { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.sidebar } });
    s.addShape('rect', { x: 0, y: 0, w: 0.4, h: 5.625, fill: { color: C.gold } });
    s.addText(data.entityLabel, { x: 0.6, y: 1.6, w: 8.8, h: 0.8, fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI' });
    s.addText('Rentals & Lease — CEO Business Review', { x: 0.6, y: 2.45, w: 8.8, h: 0.4, fontSize: 16, color: C.gold, fontFace: 'Segoe UI' });
    s.addText(data.periodLabel, { x: 0.6, y: 2.95, w: 8.8, h: 0.35, fontSize: 14, color: 'CCCCCC', fontFace: 'Segoe UI' });
    s.addText(`Generated ${data.generatedAt}`, { x: 0.6, y: 4.8, w: 8, h: 0.3, fontSize: 10, color: C.muted, fontFace: 'Segoe UI' });
  }

  // SLIDE 2 — Executive Summary narrative
  {
    const s = pptx.addSlide();
    header(s, 'Executive Summary', 'CEO talking points — read this slide first');
    prose(s, data.executiveNarrative);
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 3 — Portfolio Snapshot
  {
    const ps = data.portfolioSnapshot;
    const s = pptx.addSlide();
    header(s, 'Portfolio Snapshot', 'Company Registry · Loan Tracker · Ownership');
    kpiCards(s, [
      { label: 'Total Units', value: ps.totalUnits },
      { label: 'Occupied Units', value: ps.occupiedUnits, sub: ps.vacantUnits > 0 ? `${ps.vacantUnits} vacant` : undefined },
      { label: 'Portfolio Market Value', value: ps.marketValue, sub: ps.marketValueSource },
      { label: 'Total Loan Outstanding', value: ps.totalDebt, sub: `${ps.loanCount} loans` },
    ]);
    const occupied = Number(ps.occupiedUnits) || 0;
    const total = Number(ps.totalUnits) || 0;
    const vacant = Math.max(0, total - occupied);
    if (total > 0) {
      s.addChart(
        pptx.ChartType.doughnut,
        [{ name: 'Units', labels: ['Occupied', 'Vacant'], values: [occupied, vacant] }],
        {
          ...chartOpts(0.5, 2.0, 3.8, 2.5),
          chartColors: [C.green, C.amber],
          holeSize: 55,
          showPercent: true,
        },
      );
    } else {
      na(s, 'Data not available — Unit composition chart', 2.5);
    }
    const unitData = ps.unitsByCompany.slice(0, 8);
    if (unitData.length) {
      s.addChart(
        pptx.ChartType.bar,
        [{ name: 'Units', labels: unitData.map(u => u.name), values: unitData.map(u => u.units) }],
        {
          ...chartOpts(4.8, 2.0, 4.7, 2.5),
          barDir: 'col',
          chartColors: [C.gold],
        },
      );
    } else {
      na(s, 'Data not available — Units by company chart', 2.5);
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 4 — Rental Performance
  {
    const rp = data.rentalPerformance;
    const s = pptx.addSlide();
    header(s, 'Rental Performance', 'Rent Receivable · Rental Portfolio Overview');
    kpiCards(s, [
      { label: 'Physical Occupancy', value: rp.occupancy },
      { label: 'GPR', value: rp.gpr },
      { label: 'Collected', value: rp.collected },
      { label: 'Vacancy Loss', value: rp.vacancyLoss },
      { label: 'Collection Rate', value: rp.collectionRate },
      { label: 'AR Outstanding', value: rp.arOutstanding },
    ], 1.05, 3);
    if (rp.gprTrend.length > 0) {
      const labels = rp.gprTrend.map(t => t.month);
      const occSeries = rp.gprTrend.map(t => t.occupancy ?? (valPct(rp.occupancy) ?? 0));
      const hasMoney = rp.gprTrend.some(t => t.gpr > 0 || t.collected > 0);
      if (hasMoney) {
        s.addChart(
          [
            {
              type: pptx.ChartType.bar,
              data: [
                { name: 'GPR', labels, values: rp.gprTrend.map(t => t.gpr) },
                { name: 'Collected', labels, values: rp.gprTrend.map(t => t.collected) },
              ],
              options: { barDir: 'col', chartColors: [C.gold, C.green] },
            },
            {
              type: pptx.ChartType.line,
              data: [{ name: 'Occupancy %', labels, values: occSeries }],
              options: {
                lineSize: 2,
                chartColors: [C.blue],
                secondaryValAxis: true,
                showValAxisTitle: true,
                valAxisTitle: 'Occupancy %',
              },
            },
          ],
          {
            ...chartOpts(0.5, 2.2, 9.0, 2.6),
            showValAxisTitle: true,
            valAxisTitle: 'Amount ($)',
            secondaryValAxis: true,
          },
        );
      } else {
        na(s, 'Data not available — GPR vs Collected trend chart', 2.5);
      }
    } else {
      na(s, 'Data not available — GPR vs Collected trend chart', 2.5);
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 5 — Financial Performance
  {
    const fp = data.financialPerformance;
    const s = pptx.addSlide();
    header(s, 'Financial Performance', fp.sourceNote);
    if (fp.available) {
      kpiCards(s, fp.profitability.slice(0, 6).map(p => ({ label: p.label, value: p.value, sub: `Target ${p.benchmark}` })), 1.0, 3);
      // Waterfall approximation: GPR → Vacancy → Effective Rent → Opex → NOI → Interest → Net Income
      // Floating/stacked bar: invisible base + visible delta.
      const parseMoney = (v: string): number => {
        const neg = /\(.*\)/.test(v);
        const n = Number(String(v).replace(/[^0-9.-]/g, '')) || 0;
        return neg ? -Math.abs(n) : n;
      };
      const wfSteps = fp.waterfall.map(w => ({
        label: w.label
          .replace(/^Gross Potential Rent.*$/i, 'GPR')
          .replace(/^Less:\s*/i, '')
          .replace(/^Net Operating Income.*$/i, 'NOI')
          .replace(/^Net Income.*$/i, 'Net Income')
          .slice(0, 16),
        delta: parseMoney(w.value),
      }));
      // Skip "Effective Rent" middle subtotal — waterfall shows deltas + key totals
      const wf = wfSteps.filter(p => !/effective rent/i.test(p.label));
      if (wf.length >= 3) {
        const base: number[] = [];
        const delta: number[] = [];
        let running = 0;
        for (const p of wf) {
          if (p.delta >= 0 && running === 0) {
            // Opening pillar (GPR)
            base.push(0);
            delta.push(p.delta);
            running = p.delta;
          } else if (p.delta >= 0) {
            // Subtotal pillars (NOI, Net Income)
            base.push(0);
            delta.push(p.delta);
            running = p.delta;
          } else {
            // Expense / deduction
            const next = running + p.delta;
            base.push(Math.max(0, next));
            delta.push(Math.abs(p.delta));
            running = next;
          }
        }
        s.addChart(
          pptx.ChartType.bar,
          [
            { name: 'Base', labels: wf.map(p => p.label), values: base },
            { name: 'Amount', labels: wf.map(p => p.label), values: delta },
          ],
          {
            ...chartOpts(0.5, 2.2, 4.4, 2.6),
            barDir: 'col',
            barGrouping: 'stacked',
            chartColors: ['FBF6EE', C.gold],
            showLegend: false,
            showTitle: true,
            title: 'P&L Waterfall',
            titleFontSize: 10,
            titleColor: C.muted,
          },
        );
      }
      if (fp.trend.length > 0) {
        s.addChart(
          [
            {
              type: pptx.ChartType.bar,
              data: [
                { name: 'Revenue', labels: fp.trend.map(t => t.month), values: fp.trend.map(t => t.revenue) },
                { name: 'Expenses', labels: fp.trend.map(t => t.month), values: fp.trend.map(t => t.expenses) },
              ],
              options: { barDir: 'col', chartColors: [C.gold, C.red] },
            },
            {
              type: pptx.ChartType.line,
              data: [{ name: 'NOI', labels: fp.trend.map(t => t.month), values: fp.trend.map(t => t.noi) }],
              options: { lineSize: 2, chartColors: [C.green] },
            },
          ],
          {
            ...chartOpts(5.1, 2.2, 4.4, 2.6),
            showTitle: true,
            title: 'Revenue · Expenses · NOI',
            titleFontSize: 10,
            titleColor: C.muted,
          },
        );
      }
    } else {
      na(s, 'Data not available — upload P&L on Rentals → Financials');
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 6 — Cash Position
  {
    const cp = data.cashPosition;
    const s = pptx.addSlide();
    header(s, 'Cash Position', 'Balance Sheet · point-in-time for selected period');
    kpiCards(s, [{ label: 'Cash Balance', value: cp.balance, sub: cp.runwayNote }], 1.05, 2);
    if (cp.trend.length > 0) {
      s.addChart(
        pptx.ChartType.line,
        [{ name: 'Cash Balance', labels: cp.trend.map(t => t.month), values: cp.trend.map(t => t.cash) }],
        { ...chartOpts(0.6, 2.1, 8.9, 2.8), chartColors: [C.blue], lineSize: 3 },
      );
    } else {
      na(s, 'Cash trend not available — upload Balance Sheet with monthly columns', 2.2);
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 7 — Loan Portfolio & EMI Status
  {
    const lp = data.loanPortfolio;
    const s = pptx.addSlide();
    header(s, 'Loan Portfolio & EMI Status', 'Loan Tracker');
    if (lp.available) {
      kpiCards(s, [
        { label: 'Total Debt', value: lp.totalDebt },
        { label: 'Loans', value: lp.loanCount },
        { label: 'Portfolio DSCR', value: lp.portfolioDscr },
        { label: 'Interest Coverage', value: lp.interestCoverage },
      ], 1.0, 4);
      const emiTable = lp.emiRows.slice(0, 7).map(e => [
        e.loanName.slice(0, 14), e.lender.slice(0, 10), e.outstanding, e.emiAmount,
        e.emiDueDate, e.paymentStatus, e.interestRate, e.maturityDate,
      ]);
      table(s,
        ['Loan', 'Lender', 'Balance', 'EMI', 'Due', 'Status', 'Rate', 'Maturity'],
        emiTable, 2.05,
        [1.1, 0.9, 0.9, 0.7, 0.8, 0.7, 0.6, 0.8],
      );
      s.addText(lp.emiDisclaimer, { x: 0.4, y: 4.85, w: 9, h: 0.35, fontSize: 7, color: C.muted, fontFace: 'Segoe UI' });
    } else {
      na(s, 'Data not available — see Loan Tracker');
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 8 — Debt Risk & Maturities
  {
    const dr = data.debtRisk;
    const s = pptx.addSlide();
    header(s, 'Debt Risk & Maturities', 'Loan Tracker · Financial Ratios');
    if (dr.available) {
      const dscr = dr.dscrByProperty.slice(0, 8);
      const ltv = dr.ltvByProperty.slice(0, 8);
      if (dscr.length) {
        s.addChart(
          [
            {
              type: pptx.ChartType.bar,
              data: [{ name: 'DSCR', labels: dscr.map(d => d.name), values: dscr.map(d => d.dscr) }],
              options: { barDir: 'col', chartColors: [C.teal] },
            },
            {
              type: pptx.ChartType.line,
              data: [{ name: 'Covenant 1.2x', labels: dscr.map(d => d.name), values: dscr.map(() => 1.2) }],
              options: { lineSize: 2, chartColors: [C.red] },
            },
          ],
          { ...chartOpts(0.5, 1.15, 4.4, 2.2), valAxisTitle: 'DSCR' },
        );
      }
      if (ltv.length) {
        // Single series with conditional colors via two aligned series (0 placeholders)
        const labels = ltv.map(l => l.name);
        const healthyVals = ltv.map(l => (l.ltv <= 75 ? l.ltv : 0));
        const riskVals = ltv.map(l => (l.ltv > 75 ? l.ltv : 0));
        s.addChart(
          pptx.ChartType.bar,
          [
            { name: 'Healthy ≤75%', labels, values: healthyVals },
            { name: 'At Risk >75%', labels, values: riskVals },
          ],
          {
            ...chartOpts(5.1, 1.15, 4.4, 2.2),
            barDir: 'col',
            barGrouping: 'clustered',
            chartColors: [C.gold, C.red],
            showValAxisTitle: true,
            valAxisTitle: 'LTV %',
          },
        );
      }
      const matRows = dr.maturityBuckets.map(b => [b.label, `$${(b.amount / 1000).toFixed(0)}k`, String(b.count)]);
      table(s, ['Maturity Window', 'Balance', 'Loans'], matRows, 3.5, [2.5, 2, 1.5]);
    } else {
      na(s, 'Data not available — see Loan Tracker');
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 9 — Ownership Overview
  {
    const ow = data.ownership;
    const s = pptx.addSlide();
    header(s, 'Ownership Overview', 'Rentals → Ownership');
    if (ow.available) {
      kpiCards(s, [
        { label: 'Total Partners', value: ow.totalPartners },
        { label: 'Total Capital Raised', value: ow.totalCapital },
        { label: 'Total Equity', value: ow.totalEquity },
        { label: 'Avg Partner ROI', value: ow.avgRoi },
      ]);
      if (ow.partnerSlices.length > 0) {
        s.addChart(
          pptx.ChartType.doughnut,
          [{ name: 'Ownership', labels: ow.partnerSlices.map(p => p.name), values: ow.partnerSlices.map(p => p.value) }],
          { ...chartOpts(0.5, 2.1, 4.4, 2.5), chartColors: [C.gold, '1F6FEB', C.green, C.amber, C.red], holeSize: 55 },
        );
      }
      if (ow.roiByPartner.length > 0) {
        const avg = valPct(ow.avgRoi) ?? 0;
        const roi = ow.roiByPartner.slice(0, 8);
        s.addChart(
          [
            {
              type: pptx.ChartType.bar,
              data: [{ name: 'ROI %', labels: roi.map(r => r.name), values: roi.map(r => r.roi) }],
              options: { barDir: 'col', chartColors: [C.teal] },
            },
            {
              type: pptx.ChartType.line,
              data: [{ name: 'Avg ROI', labels: roi.map(r => r.name), values: roi.map(() => avg) }],
              options: { lineSize: 2, chartColors: [C.red] },
            },
          ],
          { ...chartOpts(5.1, 2.1, 4.4, 2.5), valAxisTitle: 'ROI %' },
        );
      }
    } else {
      na(s, 'Data not available — upload ownership on Rentals → Ownership');
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 10 — Per-Property Profitability
  {
    const pp = data.propertyProfitability;
    const s = pptx.addSlide();
    header(s, 'Per-Property Profitability', 'Ownership · Financials · Company Registry');
    if (pp.available) {
      // Treemap substitute: sorted horizontal bar of NOI $ (or margin % fallback)
      const sortedNoi = [...pp.rows]
        .map(r => ({
          name: r.property.slice(0, 16),
          noi: r.noiDollars != null && r.noiDollars !== 0 ? r.noiDollars : (r.noiMarginPct ?? 0),
          usingMargin: !(r.noiDollars != null && r.noiDollars !== 0),
        }))
        .filter(r => r.noi !== 0)
        .sort((a, b) => b.noi - a.noi)
        .slice(0, 8);
      if (sortedNoi.length) {
        const useMargin = sortedNoi.every(r => r.usingMargin);
        s.addChart(
          pptx.ChartType.bar,
          [{
            name: useMargin ? 'NOI Margin %' : 'NOI $',
            labels: sortedNoi.map(r => r.name),
            values: sortedNoi.map(r => r.noi),
          }],
          {
            ...chartOpts(0.5, 1.1, 4.4, 2.35),
            barDir: 'bar',
            chartColors: [C.gold],
            showValAxisTitle: true,
            valAxisTitle: useMargin ? 'NOI Margin %' : 'NOI ($)',
            showTitle: true,
            title: 'NOI by Property',
            titleFontSize: 10,
            titleColor: C.muted,
          },
        );
      }
      // Scatter needs X-Axis series + Y series (pptxgenjs native format)
      const scatterPts = pp.rows.filter(r => r.occupancyPct != null && r.noiMarginPct != null) as Array<{
        property: string; occupancyPct: number; noiMarginPct: number;
      }>;
      if (scatterPts.length > 0) {
        s.addChart(
          pptx.ChartType.scatter,
          [
            { name: 'X-Axis', values: scatterPts.map(p => p.occupancyPct) },
            {
              name: 'NOI Margin',
              values: scatterPts.map(p => p.noiMarginPct),
              labels: [scatterPts.map(p => p.property.slice(0, 12))],
            },
          ],
          {
            ...chartOpts(5.1, 1.1, 4.4, 2.35),
            chartColors: [C.teal],
            lineDataSymbol: 'circle',
            lineDataSymbolSize: 10,
            lineSize: 0,
            showTitle: true,
            title: 'Occupancy vs NOI Margin',
            titleFontSize: 10,
            titleColor: C.muted,
            showValAxisTitle: true,
            valAxisTitle: 'NOI Margin %',
            showCatAxisTitle: true,
            catAxisTitle: 'Occupancy %',
            showLabel: false,
          },
        );
      }
      const rows = pp.rows.slice(0, 6).map(r => [r.property.slice(0, 18), r.occupancy, r.noiMargin, r.dscr, r.arrears]);
      table(s, ['Property', 'Occupancy', 'NOI Margin', 'DSCR', 'Arrears'], rows, 3.6, [2.2, 1.2, 1.2, 1, 1.2]);
      const flagged = pp.rows.filter(r => r.flagged).length;
      if (flagged > 0) {
        s.addText(`${flagged} propert${flagged === 1 ? 'y' : 'ies'} flagged (NOI margin <15%, DSCR <1.1×, or arrears >2 mo GPR)`, {
          x: 0.4, y: 5.05, w: 9, h: 0.25, fontSize: 8, color: C.red, fontFace: 'Segoe UI',
        });
      }
    } else {
      na(s, 'Data not available — see Ownership and Company Registry');
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 11 — Risk & Action Items
  {
    const s = pptx.addSlide();
    header(s, 'Risk & Action Items', 'Auto-generated from portfolio rules');
    if (data.riskActionTable.length > 0) {
      const rows = data.riskActionTable.slice(0, 9).map(r => [
        r.property.slice(0, 14), r.issue, r.kpi, r.impact.slice(0, 28), r.owner.slice(0, 14), r.dueDate,
      ]);
      table(s, ['Property', 'Issue', 'KPI', 'Impact', 'Owner', 'Due'], rows, 1.05,
        [1.2, 1.3, 1, 1.8, 1.2, 0.9]);
    } else {
      na(s, 'No critical flags — portfolio within normal parameters');
    }
    footer(s, data.entityLabel, data.periodLabel);
  }

  // SLIDE 12 — Strategic Recommendations
  {
    const s = pptx.addSlide();
    header(s, 'Strategic Recommendations', 'CEO decision language — next board cycle');
    bullets(s, data.strategicRecommendations);
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
