import type { ParsedFinancials, FinItem } from './rentalKpiEngine';
import { normalizeMonthKey } from './executiveSummaryFormatters';

export interface FinRow {
  month: string;
  account: string;
  amount: number;
  category?: string;
  isSectionHeader?: boolean;
  isTotal?: boolean;
}

function guessCategory(item: FinItem): string {
  const label = item.label.toLowerCase();
  if (/income|revenue|rent/.test(label)) return 'income';
  if (/expense|repair|utility|hoa|tax|insurance|management|legal|interest/.test(label)) return 'expense';
  return 'other';
}

/** Flatten uploaded P&L monthly values into rows for Income Statement tab charts. */
export function parsedFinancialsToFinRows(fin: ParsedFinancials): FinRow[] {
  const rows: FinRow[] = [];
  for (const item of fin.pl) {
    if (item.monthlyValues && Object.keys(item.monthlyValues).length > 0) {
      for (const [month, amount] of Object.entries(item.monthlyValues)) {
        rows.push({
          month: normalizeMonthKey(month),
          account: item.label,
          amount,
          category: guessCategory(item),
          isSectionHeader: item.isSectionHeader,
          isTotal: item.isTotal,
        });
      }
    } else if (fin.years.length > 0) {
      for (const y of fin.years) {
        const amount = item.values[y] ?? 0;
        if (amount === 0 && !item.isTotal) continue;
        rows.push({
          month: `FY ${y}`,
          account: item.label,
          amount,
          category: guessCategory(item),
          isSectionHeader: item.isSectionHeader,
          isTotal: item.isTotal,
        });
      }
    }
  }
  return rows;
}

export function mergeFinRows(fins: ParsedFinancials[]): FinRow[] {
  return fins.flatMap(parsedFinancialsToFinRows);
}
