/** Visual theme for the shared section-PDF renderer (sectionPdfHtml.ts). Lets a module
 * (e.g. Property Dev) opt into a different look without touching the default used by
 * every other module (Rental, Construction, Consultancy) still on the parchment theme. */
export interface PdfTheme {
  pageBg: string;
  cardBg: string;
  border: string;
  text: string;
  muted: string;
  mutedLight: string;
  accent: string;
  positive: string;
  negative: string;
  /** Top brand/title band. */
  headerBg: string;
  headerBrand: string;
  headerTitle: string;
  headerMeta: string;
  /** Section title band (e.g. "Balance Sheet", "Loan & EMI Detail"). */
  sectionHeaderBg: string;
  sectionHeaderText: string;
  /** In-table category header rows (e.g. "EXPENSES"). */
  rowHeaderBg: string;
  rowHeaderText: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  rowTotalBg: string;
  rowNetBg: string;
  strongBorder: string;
  /** KPI card accent placement + whether it gets a drop shadow instead of a flat border. */
  kpiAccentSide: 'left' | 'bottom';
  kpiShadow: boolean;
  footerBg: string;
}

/** Default — matches the existing Rental "Expenses" parchment look. Unchanged. */
export const PARCHMENT_THEME: PdfTheme = {
  pageBg: '#F7F8FA',
  cardBg: '#FFFFFF',
  border: '#E8E9ED',
  text: '#1C1917',
  muted: '#78716C',
  mutedLight: '#A8A29E',
  accent: '#5B5FEF',
  positive: '#15803D',
  negative: '#B91C1C',
  headerBg: 'linear-gradient(135deg, #3A2F1F 0%, #5C4A32 100%)',
  headerBrand: '#5B5FEF',
  headerTitle: '#FFFFFF',
  headerMeta: '#D4C4A8',
  sectionHeaderBg: '#EDE5D8',
  sectionHeaderText: '#3A2F1F',
  rowHeaderBg: '#E8E0CF',
  rowHeaderText: '#92400E',
  tableHeaderBg: '#EEF0FF',
  tableHeaderText: '#78716C',
  rowTotalBg: '#EDE5D8',
  rowNetBg: '#D4C4A8',
  strongBorder: '#1C1917',
  kpiAccentSide: 'left',
  kpiShadow: false,
  footerBg: 'transparent',
};

/** Executive Summary board-pack look — navy/gold, no red/no green (growth teal / overdue purple instead). */
export const EXEC_SUMMARY_PDF_THEME: PdfTheme = {
  pageBg: '#F7F8FA',
  cardBg: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0D1B2A',
  muted: '#64748B',
  mutedLight: '#94A3B8',
  accent: '#5B5FEF',
  positive: '#5BB5A2',
  negative: '#7C3AED',
  headerBg: '#1A1D29',
  headerBrand: '#5B5FEF',
  headerTitle: '#FFFFFF',
  headerMeta: 'rgba(255,255,255,0.6)',
  sectionHeaderBg: '#EEF0FF',
  sectionHeaderText: '#1A1D29',
  rowHeaderBg: '#E8EFF8',
  rowHeaderText: '#1B3A6B',
  tableHeaderBg: '#1A1D29',
  tableHeaderText: '#FFFFFF',
  rowTotalBg: '#EEF0FF',
  rowNetBg: '#EEF0FF',
  strongBorder: '#5B5FEF',
  kpiAccentSide: 'left',
  kpiShadow: true,
  footerBg: '#F7F8FA',
};

/** Enterprise finance report look — Bloomberg/S&P Capital IQ style. Property Dev pilot. */
export const ENTERPRISE_THEME: PdfTheme = {
  pageBg: '#FFFFFF',
  cardBg: '#FFFFFF',
  border: '#E0E0E0',
  text: '#2C2C2C',
  muted: '#6B6B6B',
  mutedLight: '#6B6B6B',
  accent: '#C9A84C',
  positive: '#1B6B3A',
  negative: '#8B0000',
  headerBg: '#FFFFFF',
  headerBrand: '#1A1A2E',
  headerTitle: '#1A1A2E',
  headerMeta: '#6B6B6B',
  sectionHeaderBg: 'transparent',
  sectionHeaderText: '#1A1A2E',
  rowHeaderBg: '#F8F9FA',
  rowHeaderText: '#1A1A2E',
  tableHeaderBg: 'transparent',
  tableHeaderText: '#6B6B6B',
  rowTotalBg: '#F8F9FA',
  rowNetBg: '#F8F9FA',
  strongBorder: '#1A1A2E',
  kpiAccentSide: 'bottom',
  kpiShadow: true,
  footerBg: '#F8F9FA',
};
