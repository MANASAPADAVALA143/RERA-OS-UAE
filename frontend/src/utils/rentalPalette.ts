/**
 * RERA OS — chart semantic colors (Finance Command Center palette).
 */
export const RENTAL_GREEN = '#22C55E';
export const RENTAL_TEAL = '#14B8A6';
export const RENTAL_RED = '#EF4444';
export const RENTAL_CHART_GREEN = '#22C55E';
export const RENTAL_CHART_RED = '#EF4444';

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
