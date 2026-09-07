import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import api from '../services/api';
import type { RentalTab } from '../contexts/RentalNavContext';
import type { Period } from './periodWindow';
import type { CompanyRow, LoanRow, PortfolioSummary, UnitRow } from '../hooks/useRentalCfoData';
import { gatherCeoBoardExportPayload } from './gatherExecutiveExportData';
import { generateSectionStrategyPlan } from './executiveSummaryNarrative';
import { apiResponseToParsedFinancials } from './rentalKpiEngine';
import { mergeFinRows } from './executiveSummaryFinRows';
import { normalizeMonthKey } from './executiveSummaryFormatters';
import type { ArSummaryResponse } from '../hooks/useExecutiveSummaryData';
import { metricsFromArSummary } from './arSummaryMetrics';
import {
  buildSectionPdfPayload,
  isPolishedSectionPdfTab,
  sectionPdfFileName,
  type FinancialsPdfScope,
  type SectionPdfPayload,
} from './gatherSectionPdfData';
import { buildSectionPdfHtml } from './sectionPdfHtml';
import { printRentalSection } from './rentalSectionPrint';

interface ArMonth { month: string; billed: number; collected: number; }
interface FinRow { month: string; account: string; amount: number; category?: string; }

export interface SectionPdfExportContext {
  tab: RentalTab;
  sectionLabel: string;
  period?: Period | null;
  month?: number;
  year?: number;
  entityId?: string | 'portfolio';
  entityLabel?: string;
  monthYm?: string;
  /** Rentals → Financials PDF scope (dropdown). Defaults to income-statement. */
  financialsScope?: FinancialsPdfScope;
}

function parseMonthYm(ym: string): { month: number; year: number } {
  const [y, m] = ym.split('-').map(Number);
  return { month: m || new Date().getMonth() + 1, year: y || new Date().getFullYear() };
}

function monthYmFromSearchParams(params: URLSearchParams): string {
  return params.get('month') || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
}

async function loadFinancialRows(companyIds: string[]): Promise<FinRow[]> {
  if (!companyIds.length) return [];
  const idsToFetch = [...new Set(companyIds)];
  const fins = await Promise.all(
    idsToFetch.map(id =>
      api.get(`/api/rentals/financials/${id}`)
        .then(r => apiResponseToParsedFinancials(r.data))
        .catch(() => null),
    ),
  );
  return mergeFinRows(fins.filter((f): f is NonNullable<typeof f> => f !== null && f.pl.length > 0));
}

async function fetchBaseExportData(monthYm: string, entityId: string | 'portfolio' = 'portfolio') {
  const [coRes, portRes, loanRes, unitRes, arRes] = await Promise.all([
    api.get<CompanyRow[]>(`/api/rentals/companies?month=${monthYm}`),
    api.get<PortfolioSummary>(`/api/rentals/portfolio-summary?month=${monthYm}`),
    api.get<{ items: LoanRow[] }>('/api/real-estate/loans', { params: { context_type: 'rental' } }),
    api.get<UnitRow[]>('/api/rentals/units'),
    // Fetch full AR Summary (no month filter) so company monthly[] can be period-scoped client-side.
    api.get<ArSummaryResponse>('/api/rentals/ar-summary').catch(() => ({ data: null })),
  ]);

  const companies = coRes.data ?? [];
  const scopedCompanies = entityId === 'portfolio' ? companies : companies.filter(c => c.id === entityId);
  const arSummary = arRes.data ?? null;
  const arData: ArMonth[] = (arSummary?.monthly_trend ?? []).map(t => ({
    month: normalizeMonthKey(t.month),
    billed: t.billed ?? 0,
    collected: t.collected ?? 0,
  }));
  const finCompanyIds = entityId === 'portfolio'
    ? companies.map(c => c.id)
    : (scopedCompanies[0] ? [scopedCompanies[0].id] : []);
  const finRows = await loadFinancialRows(finCompanyIds);
  const portfolio = entityId === 'portfolio'
    ? (portRes.data ?? null)
    : (() => {
      const co = scopedCompanies[0];
      if (!co) return null;
      return {
        total_units: co.total_units,
        occupied_units: co.occupied_units,
        vacant_units: co.vacant_units,
        occupancy_pct: co.occupancy_pct,
        collected_this_month: co.collected_this_month,
        billed_this_month: co.billed_this_month,
        noi_this_month: co.noi_this_month,
        gross_potential_rent: co.gross_potential_rent,
        total_expense_this_month: co.total_expense_this_month,
        vacancy_loss: Math.max(0, co.gross_potential_rent - co.collected_this_month),
        arrears_total: co.arrears_total,
        by_company: [co],
      } as PortfolioSummary;
    })();

  return {
    companies,
    portfolio,
    loans: (loanRes.data?.items ?? []).filter(l => l.context_type === 'rental'),
    units: unitRes.data ?? [],
    arData,
    arSummary,
    finRows,
  };
}

export async function gatherAndBuildSectionPdf(ctx: SectionPdfExportContext): Promise<SectionPdfPayload> {
  const monthYm = ctx.monthYm ?? `${ctx.year ?? new Date().getFullYear()}-${String(ctx.month ?? new Date().getMonth() + 1).padStart(2, '0')}`;
  const { month, year } = ctx.month != null && ctx.year != null
    ? { month: ctx.month, year: ctx.year }
    : parseMonthYm(monthYm);

  const entityId = ctx.entityId ?? 'portfolio';
  const base = await fetchBaseExportData(monthYm, entityId);
  const entityLabel = ctx.entityLabel ?? (entityId === 'portfolio'
    ? 'Portfolio_Total'
    : (base.companies.find(c => c.id === entityId)?.company_name ?? 'Entity'));

  const ceoPayload = await gatherCeoBoardExportPayload({
    entityId,
    entityLabel,
    period: ctx.period ?? 'Month',
    month,
    year,
    companies: base.companies,
    portfolio: base.portfolio,
    loans: base.loans,
    units: base.units,
    arData: base.arData,
    arSummary: base.arSummary,
    finRows: base.finRows,
  });

  const arMetrics = metricsFromArSummary(
    base.arSummary,
    entityId,
    ctx.period ?? 'Month',
    month,
    year,
  );
  const collectionRate = arMetrics?.rate ?? 0;

  const strategy = generateSectionStrategyPlan(ctx.tab, {
    payload: ceoPayload,
    slideNarratives: ceoPayload.slideNarratives,
    strategicRecommendations: ceoPayload.strategicRecommendations,
    collectionRate,
    portfolio: base.portfolio,
    vacantUnits: ceoPayload.portfolioSnapshot.vacantUnits,
  });

  return buildSectionPdfPayload(ctx.tab, ceoPayload, strategy, {
    financialsScope: ctx.financialsScope,
    units: base.units,
    period: ctx.period ?? null,
    month,
    year,
    entityId,
  });
}

/** Atomic blocks that must not be sliced across PDF pages. */
const PDF_AVOID_BREAK_SELECTOR = [
  '.header-band',
  // Do NOT list bare `.pdf-section-header` — that orphans titles above blank space.
  '.pdf-keep-together',
  '.kpi-grid',
  '.chart-card',
  // Compact tables stay atomic; wide statement tables (P&L/BS/CF) must flow across pages.
  '.table-card:not(.table-wide)',
  '.alert-card',
  '.strategy-block',
].join(', ');

/**
 * Build Y cut positions (canvas px) so pages prefer gaps between cards
 * instead of slicing through charts / KPI grids. Also honor explicit
 * `.pdf-section-break` markers (board-pack section starts).
 */
function buildSafePageCuts(
  body: HTMLElement,
  canvasHeight: number,
  scale: number,
  pageHeightPx: number,
): number[] {
  const bodyRect = body.getBoundingClientRect();
  const toY = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    return {
      top: Math.max(0, (r.top - bodyRect.top) * scale),
      bottom: Math.min(canvasHeight, (r.bottom - bodyRect.top) * scale),
    };
  };
  const blocks = Array.from(body.querySelectorAll(PDF_AVOID_BREAK_SELECTOR))
    .map(toY)
    .filter(b => b.bottom > b.top)
    .sort((a, b) => a.top - b.top);

  // Prefer cutting between statement rows so long P&L/BS/CF tables don't leave blank bands.
  // Never row-cut compact multi-year snapshots — those must stay intact on one page.
  const rowCuts = Array.from(body.querySelectorAll('.table-wide:not(.table-snapshot) tbody tr'))
    .map(el => toY(el).bottom)
    .filter(y => y > 20)
    .sort((a, b) => a - b);

  const sectionBreaks = Array.from(body.querySelectorAll('.pdf-section-break:not(.pdf-force-page)'))
    .map(el => toY(el).top)
    .filter(y => y > 20)
    .sort((a, b) => a - b);

  // P&L / BS / CF must always start on a fresh page — honor even when prior page is sparse.
  const forceBreaks = Array.from(body.querySelectorAll('.pdf-force-page'))
    .map(el => toY(el).top)
    .filter(y => y > 20)
    .sort((a, b) => a - b);

  const cuts: number[] = [0];
  let pageStart = 0;
  const minUseful = 40 * scale;

  while (pageStart + pageHeightPx < canvasHeight - 2) {
    const idealCut = pageStart + pageHeightPx;
    let cut = idealCut;

    const forceCut = forceBreaks.find(y => y > pageStart + minUseful && y <= idealCut);
    if (forceCut != null) {
      cut = forceCut;
    } else {
      // Prefer an explicit section start only when the current page is already
      // substantially filled — early cuts leave large CEO-unfriendly blank bands.
      const minFillBeforeSectionBreak = pageHeightPx * 0.72;
      const sectionCut = sectionBreaks.find(y => y > pageStart + minUseful && y <= idealCut);
      if (sectionCut != null && (sectionCut - pageStart) >= minFillBeforeSectionBreak) {
        cut = sectionCut;
      } else {
        // Prefer a row boundary near the bottom of the page for wide statement tables
        // (fill leftover space — avoid large blank bands mid P&L/BS/CF).
        const rowCut = [...rowCuts].reverse().find(y =>
          y > pageStart + Math.max(minUseful, pageHeightPx * 0.5) && y <= idealCut - 2,
        );
        if (rowCut != null) {
          cut = rowCut;
        } else {
          const crossed = blocks.find(b => b.top < idealCut - 1 && b.bottom > idealCut + 1);
          if (crossed) {
            const blockH = crossed.bottom - crossed.top;
            const tallBlock = blockH > pageHeightPx * 0.82;
            const filledEnough = crossed.top - pageStart >= minFillBeforeSectionBreak;
            const fitsOnPage = crossed.bottom - pageStart <= pageHeightPx + 1;
            // Atomic cards (KPI grids, charts, multi-year snapshots) must never be sliced.
            // If they don't fit the remainder, start them on the next page.
            if (!fitsOnPage && crossed.top - pageStart >= minUseful && !tallBlock) {
              cut = crossed.top;
            } else if (tallBlock && filledEnough) {
              // Start oversized cards/tables on a fresh page instead of slicing through them.
              cut = crossed.top;
            } else if (filledEnough) {
              cut = crossed.top;
            } else if (fitsOnPage) {
              cut = Math.min(crossed.bottom, canvasHeight);
            } else if (crossed.top > pageStart) {
              // Doesn't fit the remainder and none of the above matched (e.g. the
              // gap before it is under minUseful) -- still push it to a fresh page
              // rather than slicing straight through an atomic table/chart card.
              // A slightly early page break is far less broken-looking than a
              // table splitting mid-row across two pages.
              cut = crossed.top;
            } else {
              // The block starts at the very top of this page and still doesn't
              // fit a full page -- there's nowhere left to push it, so this is
              // the one unavoidable slice-through case.
              cut = idealCut;
            }
          } else {
            let bestGap = idealCut;
            for (let i = 0; i < blocks.length - 1; i++) {
              const gapStart = blocks[i].bottom;
              const gapEnd = blocks[i + 1].top;
              if (
                gapStart > pageStart + minFillBeforeSectionBreak
                && gapEnd <= idealCut
                && gapEnd - gapStart >= 4
              ) {
                bestGap = gapEnd;
              }
            }
            if (bestGap < idealCut && bestGap - pageStart >= minFillBeforeSectionBreak) {
              cut = bestGap;
            }
          }
        }
      }
    }

    if (cut <= pageStart + minUseful) {
      cut = Math.min(pageStart + pageHeightPx, canvasHeight);
    }
    if (cut >= canvasHeight - 2) break;
    cuts.push(cut);
    pageStart = cut;
  }

  return cuts;
}

/** ~300 DPI print quality for 816px-wide A4 HTML (816 × 3.25 ≈ 2652px). */
const PDF_PRINT_SCALE = 3.25;
const PDF_CHUNK_SCALE_MIN = 3.25;

function fullPageCanvasHeightPx(canvasWidth: number, pdfW: number, pdfPageH: number): number {
  return Math.max(1, Math.round((pdfPageH * canvasWidth) / pdfW));
}

/** Lossless PNG keeps statement numerals crisp (JPEG smears small text). */
function addCanvasPageToPdf(
  pdf: jsPDF,
  pageCanvas: HTMLCanvasElement,
  pdfW: number,
  pdfPageH: number,
  pageIndex: number,
  opts?: { format?: 'PNG' | 'JPEG'; quality?: number },
): void {
  if (pageIndex > 0) pdf.addPage();
  const format = opts?.format ?? 'PNG';
  if (format === 'JPEG') {
    pdf.addImage(
      pageCanvas.toDataURL('image/jpeg', opts?.quality ?? 0.82),
      'JPEG',
      0,
      0,
      pdfW,
      pdfPageH,
      undefined,
      'FAST',
    );
    return;
  }
  pdf.addImage(
    pageCanvas.toDataURL('image/png'),
    'PNG',
    0,
    0,
    pdfW,
    pdfPageH,
    undefined,
    'SLOW',
  );
}

function paintFullPageCanvas(
  sliceCanvas: HTMLCanvasElement,
  bg: string,
  pdfW: number,
  pdfPageH: number,
): HTMLCanvasElement {
  const targetH = fullPageCanvasHeightPx(sliceCanvas.width, pdfW, pdfPageH);
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = sliceCanvas.width;
  pageCanvas.height = Math.max(sliceCanvas.height, targetH);
  const ctx = pageCanvas.getContext('2d');
  if (!ctx) throw new Error('Could not create PDF page canvas');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sliceCanvas, 0, 0);
  return pageCanvas;
}

function sliceCanvasToPdfPages(
  canvas: HTMLCanvasElement,
  cuts: number[],
  pdfW: number,
  bg: string,
  pdfPageH = 297,
  imageOpts?: { format?: 'PNG' | 'JPEG'; quality?: number },
): jsPDF {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const fullPagePx = fullPageCanvasHeightPx(canvas.width, pdfW, pdfPageH);

  for (let i = 0; i < cuts.length; i++) {
    const y0 = Math.floor(cuts[i]);
    const y1 = Math.ceil(cuts[i + 1] ?? canvas.height);
    const sliceH = Math.max(1, y1 - y0);

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = sliceH;
    const sliceCtx = sliceCanvas.getContext('2d');
    if (!sliceCtx) throw new Error('Could not create PDF slice canvas');
    sliceCtx.drawImage(canvas, 0, y0, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

    const pageCanvas = paintFullPageCanvas(sliceCanvas, bg, pdfW, pdfPageH);
    if (pageCanvas.height < fullPagePx) {
      const padded = document.createElement('canvas');
      padded.width = pageCanvas.width;
      padded.height = fullPagePx;
      const pctx = padded.getContext('2d');
      if (!pctx) throw new Error('Could not create PDF page canvas');
      pctx.fillStyle = bg;
      pctx.fillRect(0, 0, padded.width, padded.height);
      pctx.drawImage(pageCanvas, 0, 0);
      addCanvasPageToPdf(pdf, padded, pdfW, pdfPageH, i, imageOpts);
      padded.width = 0;
      padded.height = 0;
    } else {
      addCanvasPageToPdf(pdf, pageCanvas, pdfW, pdfPageH, i, imageOpts);
    }

    sliceCanvas.width = 0;
    sliceCanvas.height = 0;
    pageCanvas.width = 0;
    pageCanvas.height = 0;
  }

  return pdf;
}

/** Stay under typical browser canvas / ArrayBuffer limits for tall board-pack PDFs. */
function choosePdfRenderScale(contentWidth: number, contentHeight: number): number {
  const MAX_PIXELS = 24_000_000;
  const candidates = [4, 3.5, PDF_PRINT_SCALE, 3, 2.5, 2];
  for (const s of candidates) {
    if (contentWidth * s * contentHeight * s <= MAX_PIXELS) return s;
  }
  const fitted = Math.sqrt(MAX_PIXELS / Math.max(1, contentWidth * contentHeight));
  return Math.max(PDF_CHUNK_SCALE_MIN, Math.min(3.5, fitted));
}

/** Per-page chunk renders only ~1 A4 of HTML — print-grade when small, faster when large. */
function chooseChunkRenderScale(contentWidth: number, pageHeightCss: number, largePack = false): number {
  const MAX_PIXELS = 22_000_000;
  const candidates = largePack
    ? [2.25, 2, 1.75, 1.5]
    : [4, 3.5, PDF_PRINT_SCALE, 3, 2.5, 2];
  for (const s of candidates) {
    if (contentWidth * s * pageHeightCss * s <= MAX_PIXELS) return s;
  }
  return largePack ? 1.5 : PDF_CHUNK_SCALE_MIN;
}

function html2canvasSharpOptions(
  scale: number,
  bg: string,
  contentWidth: number,
  y: number,
  height: number,
): Parameters<typeof html2canvas>[1] {
  return {
    scale,
    useCORS: true,
    backgroundColor: bg,
    logging: false,
    width: contentWidth,
    windowWidth: contentWidth,
    x: 0,
    y,
    height,
    windowHeight: Math.max(height, 800),
    scrollX: 0,
    scrollY: 0,
    onclone: (clonedDoc) => {
      const style = clonedDoc.createElement('style');
      style.textContent = `
        html, body {
          -webkit-font-smoothing: antialiased !important;
          -moz-osx-font-smoothing: grayscale !important;
          text-rendering: geometricPrecision !important;
        }
        table, th, td {
          text-rendering: geometricPrecision !important;
        }
      `;
      clonedDoc.head.appendChild(style);
    },
  };
}

function releaseCanvas(canvas: HTMLCanvasElement | null | undefined) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    /* ignore */
  }
}

/**
 * Render tall HTML as PDF page-by-page so we never allocate one giant canvas
 * (fixes "Array buffer allocation failed" on CFO Dashboard / Combined exports).
 */
async function renderPdfByPageChunks(
  body: HTMLElement,
  cutsCss: number[],
  scale: number,
  bg: string,
  pdfW: number,
  contentWidth: number,
  pdfPageH = 297,
  imageOpts?: { format?: 'PNG' | 'JPEG'; quality?: number },
): Promise<jsPDF> {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const totalH = Math.max(body.scrollHeight, body.offsetHeight, 1);

  for (let i = 0; i < cutsCss.length; i++) {
    const y0 = Math.max(0, Math.floor(cutsCss[i]));
    const y1 = Math.min(totalH, Math.ceil(cutsCss[i + 1] ?? totalH));
    const sliceH = Math.max(1, y1 - y0);

    let sliceCanvas: HTMLCanvasElement | null = null;
    let pageCanvas: HTMLCanvasElement | null = null;
    try {
      sliceCanvas = await html2canvas(
        body,
        html2canvasSharpOptions(scale, bg, contentWidth, y0, sliceH),
      );

      pageCanvas = paintFullPageCanvas(sliceCanvas, bg, pdfW, pdfPageH);
      addCanvasPageToPdf(pdf, pageCanvas, pdfW, pdfPageH, i, imageOpts);
    } finally {
      releaseCanvas(sliceCanvas);
      releaseCanvas(pageCanvas);
    }
    // Let the UI breathe on long Portfolio / Vendor board packs.
    if (i % 2 === 1) {
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  return pdf;
}

export async function downloadSectionPdf(payload: SectionPdfPayload): Promise<void> {
  const html = buildSectionPdfHtml(payload);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '816px';
  iframe.style.height = '1200px';
  iframe.style.border = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  let fullCanvas: HTMLCanvasElement | null = null;

  try {
    const doc = iframe.contentDocument;
    if (!doc) {
      throw new Error('Could not create PDF render frame');
    }

    doc.open();
    doc.write(html);
    doc.close();

    await new Promise<void>(resolve => {
      iframe.onload = () => resolve();
      setTimeout(resolve, 600);
    });

    const body = doc.body;
    // Expand frame to full content height so html2canvas does not clip tall PDFs.
    const contentH = Math.max(body.scrollHeight, body.offsetHeight, 1200);
    const contentW = 816;
    iframe.style.height = `${contentH + 48}px`;
    await new Promise<void>(r => setTimeout(r, 120));

    const bg = '#F7F1E6';
    const pdfW = 210; // A4 width mm
    const pdfPageH = 297; // A4 height mm
    const pageHeightCss = (pdfPageH * contentW) / pdfW;

    // Page-by-page at print scale — sharper than one downscaled full-document canvas.
    const useChunks = contentH > pageHeightCss * 1.15;
    const pageEstimate = Math.ceil(contentH / pageHeightCss);
    const blockCount = payload.blocks?.length ?? 0;
    // Portfolio / Vendor packs with many force-break sections hang on PNG@3.25.
    const largePack = pageEstimate > 18
      || blockCount > 10
      || contentH > 20_000
      || String(payload.tab).startsWith('construction-');
    const imageOpts = largePack
      ? { format: 'JPEG' as const, quality: 0.82 }
      : { format: 'PNG' as const };

    if (useChunks) {
      const cutsCss = buildSafePageCuts(body, contentH, 1, pageHeightCss);
      if (cutsCss.length > 160) {
        throw new Error(
          `PDF would be ~${cutsCss.length} pages and is too large for this browser tab. `
          + 'Export again after closing other tabs, or export fewer projects.',
        );
      }
      const chunkScale = chooseChunkRenderScale(contentW, pageHeightCss, largePack);
      const pdf = await renderPdfByPageChunks(
        body, cutsCss, chunkScale, bg, pdfW, contentW, pdfPageH, imageOpts,
      );
      pdf.save(sectionPdfFileName(payload));
      return;
    }

    const scale = choosePdfRenderScale(contentW, contentH);
    fullCanvas = await html2canvas(
      body,
      html2canvasSharpOptions(scale, bg, contentW, 0, contentH),
    );

    const pageHeightPx = (pdfPageH * fullCanvas.width) / pdfW;
    const cuts = buildSafePageCuts(body, fullCanvas.height, scale, pageHeightPx);
    const pdf = sliceCanvasToPdfPages(fullCanvas, cuts, pdfW, bg, pdfPageH, imageOpts);
    pdf.save(sectionPdfFileName(payload));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/array buffer|allocation failed|out of memory|maximum call stack/i.test(msg)) {
      throw new Error(
        'PDF is too large to generate in this browser tab. Try closing other tabs, then retry.',
      );
    }
    throw err;
  } finally {
    releaseCanvas(fullCanvas);
    if (iframe.parentNode) document.body.removeChild(iframe);
  }
}

export async function exportRentalSectionPdf(ctx: SectionPdfExportContext): Promise<void> {
  if (!isPolishedSectionPdfTab(ctx.tab)) {
    printRentalSection(ctx.sectionLabel);
    return;
  }
  const payload = await gatherAndBuildSectionPdf(ctx);
  await downloadSectionPdf(payload);
}

export function buildExportContextFromUrl(
  tab: RentalTab,
  sectionLabel: string,
  searchParams: URLSearchParams,
  overrides?: Partial<SectionPdfExportContext>,
): SectionPdfExportContext {
  const monthYm = overrides?.monthYm ?? monthYmFromSearchParams(searchParams);
  const { month, year } = overrides?.month != null && overrides?.year != null
    ? { month: overrides.month, year: overrides.year }
    : parseMonthYm(monthYm);

  const companyId = searchParams.get('company') || undefined;
  const entityId = overrides?.entityId ?? (companyId || 'portfolio');

  return {
    tab,
    sectionLabel,
    monthYm,
    month,
    year,
    period: overrides?.period ?? 'Month',
    entityId,
    entityLabel: overrides?.entityLabel,
    financialsScope: overrides?.financialsScope,
  };
}
