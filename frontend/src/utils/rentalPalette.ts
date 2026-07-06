/**
 * EstateCFO Rental & Lease — semantic colors (darker green/teal/red for parchment backgrounds).
 */
export const RENTAL_GREEN = '#15803D';
export const RENTAL_TEAL = '#0F766E';
export const RENTAL_RED = '#C0392B';
export const RENTAL_CHART_GREEN = '#166534';
export const RENTAL_CHART_RED = '#B91C1C';

/** Legacy hex → darker rental palette (for bulk migration). */
export const RENTAL_COLOR_MAP: Record<string, string> = {
  '#26A65B': RENTAL_GREEN,
  '#18B7A0': RENTAL_TEAL,
  '#E76F6F': RENTAL_RED,
  '#22A06B': RENTAL_CHART_GREEN,
  '#D9534F': RENTAL_CHART_RED,
  '#EB5757': RENTAL_RED,
  '22A06B': '166534',
  'D9534F': 'B91C1C',
};
