/** Cross-component trigger for Prop Dev Financials Export PDF (Command Strip → Financials). */
export const PROPDEV_EXPORT_PDF_EVENT = 'propdev-export-pdf';

export type PropDevExportPdfDetail = {
  /** When set, export that scope immediately; otherwise open the Export PDF menu. */
  scope?: string;
  openMenu?: boolean;
};

export function requestPropDevExportPdf(detail: PropDevExportPdfDetail = { openMenu: true }) {
  window.dispatchEvent(new CustomEvent(PROPDEV_EXPORT_PDF_EVENT, { detail }));
}
