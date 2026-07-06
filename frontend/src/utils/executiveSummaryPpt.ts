/**
 * Executive Summary multi-section PPT export — EstateCFO gold/parchment palette.
 * Library: pptxgenjs (client-side, same stack as frontend).
 */
import PptxGenJS from 'pptxgenjs';
import type { ExportKpiItem, KpiStatus } from './rentalKpiEngine';

const C = {
  pageBg: 'F7F1E6',
  cardBg: 'FBF6EE',
  border: 'E8DEC8',
  gold: 'D4AF37',
  darkGold: 'B8860B',
  text: '1C1917',
  muted: '78716C',
  sidebar: '3A2F1F',
  green: '166534',
  amber: 'F5A623',
  red: 'B91C1C',
};

const STATUS_FILL: Record<KpiStatus, string> = {
  good: C.green,
  warn: C.amber,
  bad: C.red,
  info: C.muted,
};

export interface ExecOverviewKpi {
  label: string;
  value: string;
  sub?: string;
}

export interface LoanExportRow {
  company: string;
  bank: string;
  balance: string;
  rate: string;
  maturity: string;
  emi: string;
}

export interface ExecExportPayload {
  entityLabel: string;
  periodLabel: string;
  generatedAt: string;
  overviewKpis: ExecOverviewKpi[];
  profitability: ExportKpiItem[];
  balanceSheet: ExportKpiItem[];
  occupancy: ExportKpiItem[];
  pricing: ExportKpiItem[];
  returns: ExportKpiItem[];
  loans: LoanExportRow[];
  loanSummary: ExportKpiItem[];
  incomeStatementLines: { label: string; value: string }[];
  balanceSheetLines: { label: string; value: string }[];
  cashFlowLines: { label: string; value: string }[];
  actionItems: { severity: string; title: string; detail: string }[];
}

function addSectionHeader(slide: PptxGenJS.Slide, title: string, subtitle: string) {
  slide.addShape('rect', { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.pageBg } });
  slide.addShape('rect', { x: 0, y: 0, w: 0.35, h: 5.625, fill: { color: C.gold } });
  slide.addShape('rect', { x: 0, y: 0, w: 10, h: 0.9, fill: { color: C.sidebar } });
  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.5,
    fontSize: 22, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI',
  });
  slide.addText(subtitle, {
    x: 0.5, y: 0.55, w: 9, h: 0.3,
    fontSize: 11, color: C.gold, fontFace: 'Segoe UI',
  });
}

function addKpiGrid(slide: PptxGenJS.Slide, items: ExportKpiItem[], startY = 1.1) {
  const cols = 4;
  const cardW = 2.25;
  const cardH = 0.95;
  const gapX = 0.15;
  const gapY = 0.12;

  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.4 + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    slide.addShape('roundRect', {
      x, y, w: cardW, h: cardH,
      fill: { color: C.cardBg },
      line: { color: C.border, width: 1 },
      rectRadius: 0.08,
    });
    slide.addShape('rect', {
      x, y, w: 0.06, h: cardH,
      fill: { color: C.gold },
    });
    slide.addText(item.label.toUpperCase(), {
      x: x + 0.12, y: y + 0.06, w: cardW - 0.15, h: 0.2,
      fontSize: 8, bold: true, color: C.muted, fontFace: 'Segoe UI',
    });
    slide.addText(item.value, {
      x: x + 0.12, y: y + 0.24, w: cardW - 0.15, h: 0.32,
      fontSize: 14, bold: true, color: C.text, fontFace: 'Segoe UI',
    });
    slide.addText(`Target: ${item.benchmark}`, {
      x: x + 0.12, y: y + 0.56, w: cardW - 0.7, h: 0.18,
      fontSize: 7, color: C.muted, fontFace: 'Segoe UI',
    });
    slide.addShape('roundRect', {
      x: x + cardW - 0.72, y: y + 0.56, w: 0.62, h: 0.22,
      fill: { color: STATUS_FILL[item.status] },
    });
    slide.addText(item.statusLabel, {
      x: x + cardW - 0.72, y: y + 0.57, w: 0.62, h: 0.2,
      fontSize: 7, bold: true, color: 'FFFFFF', align: 'center', fontFace: 'Segoe UI',
    });
  });
}

function addLineList(slide: PptxGenJS.Slide, title: string, lines: { label: string; value: string }[], startY = 1.1) {
  slide.addText(title, {
    x: 0.4, y: startY, w: 9, h: 0.3,
    fontSize: 13, bold: true, color: C.text, fontFace: 'Segoe UI',
  });
  const rows = lines.slice(0, 14);
  rows.forEach((line, i) => {
    const y = startY + 0.35 + i * 0.28;
    slide.addShape('rect', {
      x: 0.4, y, w: 9.2, h: 0.24,
      fill: { color: i % 2 === 0 ? C.cardBg : C.pageBg },
      line: { color: C.border, width: 0.5 },
    });
    slide.addText(line.label, {
      x: 0.5, y: y + 0.02, w: 5.5, h: 0.2,
      fontSize: 10, color: C.text, fontFace: 'Segoe UI',
    });
    slide.addText(line.value, {
      x: 6.2, y: y + 0.02, w: 3.2, h: 0.2,
      fontSize: 10, bold: true, color: C.text, align: 'right', fontFace: 'Segoe UI',
    });
  });
}

function addFooter(slide: PptxGenJS.Slide, entity: string, period: string) {
  slide.addText(`EstateCFO · ${entity} · ${period}`, {
    x: 0.4, y: 5.35, w: 9, h: 0.2,
    fontSize: 8, color: C.muted, fontFace: 'Segoe UI',
  });
}

export function buildExecutiveSummaryFilename(entityLabel: string, periodLabel: string): string {
  const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');
  return `EstateCFO_ExecutiveSummary_${safe(entityLabel)}_${safe(periodLabel)}.pptx`;
}

export async function generateExecutiveSummaryPpt(data: ExecExportPayload): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'EstateCFO';
  pptx.title = `Executive Summary — ${data.entityLabel}`;

  // 1. Executive Overview
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Executive Overview', `${data.entityLabel} · ${data.periodLabel}`);
    const overviewItems: ExportKpiItem[] = data.overviewKpis.map(k => ({
      label: k.label,
      value: k.value,
      benchmark: k.sub ?? '—',
      status: 'info' as const,
      statusLabel: 'Info',
    }));
    addKpiGrid(slide, overviewItems.slice(0, 8), 1.0);
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 2. Profitability & Rental Performance
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Profitability & Rental Performance', 'KPI cards + benchmark targets');
    addKpiGrid(slide, data.profitability);
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 3. Balance Sheet & Leverage
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Balance Sheet & Leverage', 'Solvency & liquidity ratios');
    addKpiGrid(slide, data.balanceSheet);
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 4. Occupancy & Rental Ops
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Occupancy & Rental Ops', 'Portfolio operations metrics');
    addKpiGrid(slide, data.occupancy);
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 5. Pricing & Market Position
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Pricing & Market Position', 'Revenue efficiency metrics');
    addKpiGrid(slide, data.pricing);
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 6. Returns & Cost of Capital
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Returns & Cost of Capital', 'Cost of capital analysis');
    addKpiGrid(slide, data.returns);
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 7. Loan Schedule
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Loan Schedule', 'Loan Tracker summary');
    addKpiGrid(slide, data.loanSummary, 1.0);
    if (data.loans.length > 0) {
      const headers = ['Company', 'Lender', 'Balance', 'Rate', 'Maturity', 'EMI'];
      const tableRows = [
        headers,
        ...data.loans.slice(0, 8).map(l => [l.company, l.bank, l.balance, l.rate, l.maturity, l.emi]),
      ];
      slide.addTable(tableRows as PptxGenJS.TableRow[], {
        x: 0.4, y: 2.2, w: 9.2,
        fontSize: 9,
        fontFace: 'Segoe UI',
        color: C.text,
        border: { type: 'solid', color: C.border, pt: 0.5 },
        fill: { color: C.cardBg },
        colW: [1.8, 1.5, 1.3, 0.8, 1.2, 1.0],
      });
    } else {
      slide.addText('Data not available — no loans configured in Loan Tracker', {
        x: 0.4, y: 2.4, w: 9, h: 0.4, fontSize: 12, color: C.muted, fontFace: 'Segoe UI',
      });
    }
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 8. Income Statement
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Income Statement', data.periodLabel);
    if (data.incomeStatementLines.length > 0) {
      addLineList(slide, 'Revenue & Expense Summary', data.incomeStatementLines);
    } else {
      slide.addText('Data not available — upload P&L financials', {
        x: 0.4, y: 1.5, w: 9, h: 0.4, fontSize: 12, color: C.muted,
      });
    }
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 9. Balance Sheet
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Balance Sheet', data.periodLabel);
    if (data.balanceSheetLines.length > 0) {
      addLineList(slide, 'Assets & Liabilities', data.balanceSheetLines);
    } else {
      slide.addText('Data not available — upload Balance Sheet', {
        x: 0.4, y: 1.5, w: 9, h: 0.4, fontSize: 12, color: C.muted,
      });
    }
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 10. Cash Flow
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Cash Flow', data.periodLabel);
    if (data.cashFlowLines.length > 0) {
      addLineList(slide, 'Cash Flow Summary', data.cashFlowLines);
    } else {
      slide.addText('Data not available — upload Cash Flow statement', {
        x: 0.4, y: 1.5, w: 9, h: 0.4, fontSize: 12, color: C.muted,
      });
    }
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  // 11. Action Plan
  {
    const slide = pptx.addSlide();
    addSectionHeader(slide, 'Action Plan', 'Rule-based flags & recommendations');
    if (data.actionItems.length > 0) {
      data.actionItems.slice(0, 10).forEach((a, i) => {
        const y = 1.1 + i * 0.42;
        const color = a.severity === 'critical' ? C.red : a.severity === 'warning' ? C.amber : C.green;
        slide.addShape('roundRect', {
          x: 0.4, y, w: 9.2, h: 0.38,
          fill: { color: C.cardBg },
          line: { color: C.border, width: 1 },
        });
        slide.addShape('rect', { x: 0.4, y, w: 0.06, h: 0.38, fill: { color } });
        slide.addText(a.title, {
          x: 0.55, y: y + 0.04, w: 8.8, h: 0.18,
          fontSize: 10, bold: true, color: C.text, fontFace: 'Segoe UI',
        });
        slide.addText(a.detail, {
          x: 0.55, y: y + 0.2, w: 8.8, h: 0.16,
          fontSize: 8, color: C.muted, fontFace: 'Segoe UI',
        });
      });
    } else {
      slide.addText('No action items — portfolio within normal range', {
        x: 0.4, y: 1.5, w: 9, h: 0.4, fontSize: 12, color: C.muted,
      });
    }
    addFooter(slide, data.entityLabel, data.periodLabel);
  }

  const filename = buildExecutiveSummaryFilename(data.entityLabel, data.periodLabel);
  await pptx.writeFile({ fileName: filename });
}
