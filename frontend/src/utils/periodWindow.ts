export type Period = 'MoM' | 'YTD' | 'TTM';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "Mon YYYY" key from 1-based month index and calendar year. */
export function monthKeyFromParts(month: number, year: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

/**
 * Trailing N calendar months ending at (month, year), inclusive. Oldest first.
 * e.g. getTrailingMonthKeys(3, 2026, 6) → Oct 2025 … Mar 2026
 */
export function getTrailingMonthKeys(endMonth: number, endYear: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const offset = count - 1 - i;
    let m = endMonth - offset;
    let y = endYear;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    return monthKeyFromParts(m, y);
  });
}

/**
 * From an ideal trailing window, keep only months present in dataMonths (chronological).
 * Falls back to the full ideal window when none match (chart shows zeros).
 */
export function trailingMonthsWithData(
  endMonth: number,
  endYear: number,
  count: number,
  dataMonths: Iterable<string>,
): string[] {
  const ideal = getTrailingMonthKeys(endMonth, endYear, count);
  const dataSet = new Set(dataMonths);
  const matched = ideal.filter(k => dataSet.has(k));
  return matched.length > 0 ? matched : ideal;
}

export function getPeriodKeys(period: Period, month: number, year: number): string[] {
  if (period === 'MoM') {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    return [`${MONTHS[prevMonth - 1]} ${prevYear}`, `${MONTHS[month - 1]} ${year}`];
  }
  if (period === 'YTD') {
    return Array.from({ length: month }, (_, i) => `${MONTHS[i]} ${year}`);
  }
  // TTM — trailing 12 ending at selected month, rolls across year boundary
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((month - 1 - (11 - i) + 120) % 12);
    const y = year + Math.floor((month - 1 - (11 - i)) / 12);
    return `${MONTHS[m]} ${y}`;
  });
}

export function periodChipText(period: Period, month: number, year: number): string {
  if (period === 'MoM') {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    return `MoM · ${MONTHS[month - 1]} ${year} vs ${MONTHS[prevMonth - 1]} ${prevYear}`;
  }
  if (period === 'YTD') {
    return `YTD · Jan–${MONTHS[month - 1]} ${year}`;
  }
  const keys = getPeriodKeys('TTM', month, year);
  return `TTM · ${keys[0]}–${keys[11]}`;
}
