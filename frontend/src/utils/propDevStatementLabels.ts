/**
 * Label matching for Prop Dev uploaded statements.
 * Keeps display labels as-is (I. Land, Partners Capital, …) while KPI/chart
 * extractors can match across QuickBooks and Particulars/YYYY formats.
 */

/** Strip leading roman / numeric section prefixes: "I. Land" → "Land". */
export function stripStatementPrefix(label: string): string {
  return label
    .replace(/\u00a0/g, ' ')
    .replace(/^\s*(?:[IVXLCDM]+|\d+)\.?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize for matching: "Total (Assets)" → "total assets", "Net Profit/(Loss)" → "net profit loss". */
export function normalizeLabelForMatch(label: string): string {
  return stripStatementPrefix(label)
    .toLowerCase()
    .replace(/[/()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function labelMatches(label: string, pat: RegExp): boolean {
  const raw = label.trim();
  if (pat.test(raw)) return true;
  const stripped = stripStatementPrefix(raw);
  if (stripped !== raw && pat.test(stripped)) return true;
  const norm = normalizeLabelForMatch(raw);
  return pat.test(norm);
}

/** Find first matching row value for a year (signed). */
export function matchYearValue(
  items: Array<{ label: string; values: Record<number | string, number>; isSectionHeader?: boolean }>,
  pat: RegExp,
  year: number,
): number {
  const hit = items.find(i => labelMatches(i.label, pat));
  if (!hit) return 0;
  const v = hit.values[year] ?? hit.values[String(year)];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Sum non-header, non-total detail rows matching pat. */
export function sumYearValues(
  items: Array<{
    label: string;
    values: Record<number | string, number>;
    isSectionHeader?: boolean;
    isTotal?: boolean;
  }>,
  pat: RegExp,
  year: number,
): number {
  return items
    .filter(i => !i.isSectionHeader && !i.isTotal && labelMatches(i.label, pat))
    .reduce((s, i) => {
      const v = i.values[year] ?? i.values[String(year)];
      return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
}
