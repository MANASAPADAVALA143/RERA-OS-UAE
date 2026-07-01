export type Period = 'MoM' | 'YTD' | 'TTM';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
