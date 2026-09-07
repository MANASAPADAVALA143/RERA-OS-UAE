/**
 * Gathers the data needed for the Consultancy & Outsourcing "Export PDF" board pack,
 * straight from state the Financials page already has in memory — mirrors
 * gatherPropDevBoardExportData.ts.
 */
import { consultKpis, type ConsultFinancials, type ConsultKpis } from '../pages/consultancy/ConsultancyFinancials';
import { canonicalExpenseLineLabel } from './finItemYearUtils';
export type { ConsultKpis };

export interface ConsultancyYearSnapshot extends ConsultKpis {
  year: number;
}

export interface ConsultancyBoardExportPayload {
  entityLabel: string;
  periodLabel: string;
  generatedAt: string;
  years: number[];
  snapshots: ConsultancyYearSnapshot[];
  latestExpenseCategories: Record<string, number>;
  latestRevenueCategories: Record<string, number>;
  fin: ConsultFinancials;
}

export function buildConsultancyBoardExportPayload(
  fin: ConsultFinancials,
  entityLabel: string,
  periodLabel: string,
  periodKpis: ConsultKpis | null = null,
  pYear?: number,
): ConsultancyBoardExportPayload {
  // Cap to selected as-of year so Export PDF for YTD 2025 never includes 2026 columns/rows.
  const asOf = pYear ?? fin.years[fin.years.length - 1];
  const years = (asOf != null ? fin.years.filter(y => y <= asOf) : fin.years).slice().sort((a, b) => a - b);
  const snapshots: ConsultancyYearSnapshot[] = years.map(year => {
    const annual = { year, ...consultKpis(fin, year) };
    return periodKpis && pYear === year ? { ...annual, ...periodKpis } : annual;
  });
  const lastYear = years[years.length - 1];

  const latestRevenueCategories: Record<string, number> = {};
  const latestExpenseCategories: Record<string, number> = {};
  if (lastYear != null) {
    for (const item of fin.pl) {
      if (item.isSectionHeader || item.isTotal || item.isNetIncome) continue;
      const v = item.values[lastYear] ?? 0;
      if (v === 0) continue;
      // Bare "Other" (exact match) is this segment's third revenue category — anchored
      // so it doesn't swallow expense lines like "Other Expenses"/"Other Charges".
      if (/sales|service/i.test(item.label) || /^other(\s+(income|revenue))?$/i.test(item.label.trim())) {
        latestRevenueCategories[item.label] = (latestRevenueCategories[item.label] ?? 0) + Math.abs(v);
      } else if (v > 0) {
        const catLabel = canonicalExpenseLineLabel(item.label);
        latestExpenseCategories[catLabel] = (latestExpenseCategories[catLabel] ?? 0) + v;
      }
    }
  }

  return {
    entityLabel,
    periodLabel,
    generatedAt: new Date().toISOString(),
    years,
    snapshots,
    latestExpenseCategories,
    latestRevenueCategories,
    // Cap fin.years so YoY / CF statement tables in the PDF also stop at asOf.
    fin: { ...fin, years },
  };
}
