/** Orchestrates the Consultancy & Outsourcing "Export PDF" — reuses the shared generic HTML/PDF renderer. */
import { downloadSectionPdf } from './sectionPdfExport';
import { buildConsultancyBoardExportPayload } from './gatherConsultancyBoardExportData';
import { buildConsultancyCfoDashboardBoardBlocks, buildConsultancySectionPdfPayload } from './gatherConsultancySectionPdfData';
import { generateConsultancyStrategyPlan } from './consultancyExportNarrative';
import type { ConsultFinancials, ConsultKpis } from '../pages/consultancy/ConsultancyFinancials';

export async function exportConsultancyCfoDashboardPdf(ctx: {
  fin: ConsultFinancials;
  entityLabel: string;
  periodLabel: string;
  /** When a period filter is active, supply the period-scoped KPIs and the year they override */
  periodKpis?: ConsultKpis | null;
  pYear?: number;
}): Promise<void> {
  const cfCount = ctx.fin.cf?.length ?? 0;
  if (!cfCount) {
    throw new Error('Cash Flow data is missing from export payload (0 CF lines). Upload CF and try again.');
  }
  const payload = buildConsultancyBoardExportPayload(
    ctx.fin, ctx.entityLabel, ctx.periodLabel,
    ctx.periodKpis ?? null, ctx.pYear,
  );
  const blocks = buildConsultancyCfoDashboardBoardBlocks(payload);
  const cfBlock = blocks.find(b => /^cash\s*flow$/i.test(b.heading));
  if (!cfBlock) {
    throw new Error('Cash Flow section failed to build in the PDF. Please refresh and retry.');
  }
  const strategy = generateConsultancyStrategyPlan(payload);
  const sectionPayload = buildConsultancySectionPdfPayload(payload, blocks, strategy);
  await downloadSectionPdf(sectionPayload);
}
