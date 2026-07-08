/** Shared Executive Summary formatters — distinguish null/missing from legitimate zero. */

export function normalizeMonthKey(m: string): string {
  return m.replace(/-/g, ' ').trim();
}

export function fmtMoney(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null || !Number.isFinite(n)) return 'Not available';
  if (opts?.compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n);
}

export function fmtPct(n: number | null | undefined, d = 1): string {
  if (n == null || !Number.isFinite(n)) return 'Not available';
  return `${n.toFixed(d)}%`;
}

export function fmtMetricMoney(n: number | null | undefined): string {
  return fmtMoney(n);
}

export function fmtMetricPct(n: number | null | undefined): string {
  return fmtPct(n);
}

export function periodGapMessage(
  source: string,
  selectedLabel: string,
  latestKey: string | null,
): string {
  if (!latestKey) {
    return `Upload ${source} to populate this band.`;
  }
  return `No data for ${selectedLabel} — latest available: ${latestKey}. Upload or select that period.`;
}

export const UPLOAD_HINTS = {
  financials: 'Upload P&L + Balance Sheet on Rentals → Financials',
  rentReceivable: 'Upload Rent Receivable Excel on Rentals → Portfolio Upload or Rent Receivable',
  loans: 'Import loans on Rentals → Loan Tracker',
  ownership: 'Upload ownership % on Rentals → Ownership',
  registry: 'Add companies and units on Rentals → Company Registry',
} as const;
