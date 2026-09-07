/**
 * Traditional T-account Balance Sheet (Liabilities | Assets) for one rental entity:
 * "204 & 208 (Sandya & Suraj)" / 26919 E Highway Aubrey.
 * All other rental companies keep the standard YoY column BS.
 */
import type { FinItem } from './rentalKpiEngine';
import type { StatementTableRow } from './executiveSummaryStatementTables';
import { formatStatementAmount } from './executiveSummaryStatementTables';
import { yearVal } from './finItemYearUtils';

export interface TraditionalBsSideRow {
  label: string;
  /** Detail amount (middle column). */
  amount: number | null;
  /** Section / band total (outer column). */
  total: number | null;
  kind: 'header' | 'detail' | 'total';
}

export interface TraditionalBsTables {
  liabilities: TraditionalBsSideRow[];
  assets: TraditionalBsSideRow[];
  yearLabel: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True only for the 204 & 208 Sandya/Suraj rental company (and its highway property). */
export function isTraditionalTAccountBsCompany(opts: {
  companyName?: string | null;
  propertyName?: string | null;
  entityLabel?: string | null;
}): boolean {
  const blob = norm([opts.companyName, opts.propertyName, opts.entityLabel].filter(Boolean).join(' '));
  if (!blob) return false;
  if (/\b204\s*&\s*208\b/.test(blob) || /\b204\s+and\s+208\b/.test(blob)) return true;
  if (/\b26919\b/.test(blob) && /\bhighway\b/.test(blob)) return true;
  // Name-only fallback when registry omits the unit numbers.
  if (/\b(sandhya|sandya)\b/.test(blob) && /\bsuraj\b/.test(blob)) return true;
  return false;
}

function isAssetSectionHeader(label: string): boolean {
  const n = norm(label);
  return /^(assets|current\s+assets|fixed\s+assets|non[- ]current\s+assets|accounts?\s+receivables?|bank\s+accounts?)$/i.test(n)
    || /^total\s+(for\s+)?(assets|current\s+assets|fixed\s+assets)\b/i.test(n);
}

function isLiabilityOrEquitySectionHeader(label: string): boolean {
  const n = norm(label);
  return /^(liabilities|current\s+liabilities|long[- ]term\s+liabilities|share\s+capital|retained\s+earnings|equity|partners?\s+capital|owner'?s?\s+equity)$/i.test(n)
    || /^total\s+(for\s+)?(liabilities|current\s+liabilities|long[- ]term\s+liabilities|equity|share\s+capital|retained\s+earnings)\b/i.test(n);
}

function classifySide(label: string, current: 'liab' | 'asset' | null): 'liab' | 'asset' | null {
  const n = norm(label);
  if (isAssetSectionHeader(label)) return 'asset';
  if (isLiabilityOrEquitySectionHeader(label)) return 'liab';
  // Detail heuristics when section context is missing.
  if (/\b(payable|security\s+deposit|provision|loan|share\s+capital|retained\s+earnings|opening\s+bal)\b/i.test(n)) {
    return 'liab';
  }
  if (/\b(receivable|bank|cash|property|building|improvement|depreciation|accum\.?\s*dep|less\s+dep|fixed\s+asset)\b/i.test(n)) {
    return 'asset';
  }
  return current;
}

function toSideRow(r: StatementTableRow): TraditionalBsSideRow {
  if (r.isSectionHeader && !r.isTotal) {
    return {
      label: r.label.replace(/\s*:?\s*$/, ' :'),
      amount: null,
      total: Math.abs(r.amount) > 0.005 ? r.amount : null,
      kind: 'header',
    };
  }
  if (r.isTotal || /^total\s+(for\s+)?/i.test(r.label.trim())) {
    return {
      label: r.label,
      amount: null,
      total: r.amount,
      kind: 'total',
    };
  }
  return {
    label: r.label,
    amount: r.amount,
    total: null,
    kind: 'detail',
  };
}

/**
 * Split statement rows into Liabilities+Equity (left) and Assets (right)
 * for the traditional T-account layout.
 */
export function partitionTraditionalTAccountBs(
  rows: StatementTableRow[],
  yearLabel: string,
): TraditionalBsTables {
  const liabilities: TraditionalBsSideRow[] = [];
  const assets: TraditionalBsSideRow[] = [];
  let side: 'liab' | 'asset' | null = null;

  for (const r of rows) {
    const n = norm(r.label);
    // Skip overall balancing totals that belong on neither wing as a section.
    if (/^total\s+(for\s+)?(liabilities\s+and\s+equity|assets\s+and\s+liabilities)\b/i.test(n)) {
      continue;
    }
    side = classifySide(r.label, side);
    if (!side) {
      // Default unmatched early rows to liabilities (sheet usually starts there).
      side = 'liab';
    }
    const sideRow = toSideRow(r);
    if (side === 'asset') assets.push(sideRow);
    else liabilities.push(sideRow);
  }

  return { liabilities, assets, yearLabel };
}

/** Build StatementTableRow[] for one year from tidied FinItems (UI path). */
export function finItemsToStatementRowsForYear(
  items: FinItem[],
  year: number,
  periodKeys?: string[] | null,
): StatementTableRow[] {
  return items.map(item => {
    let amount = 0;
    if (periodKeys?.length) {
      const hasMonthly = periodKeys.some(k => item.monthlyValues?.[k] != null);
      if (hasMonthly) {
        const lastKey = periodKeys[periodKeys.length - 1]!;
        amount = item.monthlyValues?.[lastKey] ?? 0;
      } else {
        amount = yearVal(item.values, year);
      }
    } else {
      amount = yearVal(item.values, year);
    }
    return {
      label: item.label,
      amount,
      indent: item.indent ?? 0,
      isSectionHeader: Boolean(item.isSectionHeader),
      isTotal: Boolean(item.isTotal),
      isNetIncome: Boolean(item.isNetIncome),
    };
  });
}

export function traditionalBsSideToPdfRows(
  side: TraditionalBsSideRow[],
): { rows: string[][]; rowKinds: Array<'header' | 'total' | 'net' | 'detail'> } {
  const rows: string[][] = [];
  const rowKinds: Array<'header' | 'total' | 'net' | 'detail'> = [];
  for (const r of side) {
    const amt = r.amount != null && Math.abs(r.amount) > 0.005
      ? formatStatementAmount(r.amount)
      : '';
    const tot = r.total != null && Math.abs(r.total) > 0.005
      ? formatStatementAmount(r.total)
      : (r.kind === 'header' && r.total === 0 ? '$0' : '');
    rows.push([r.label, amt, tot]);
    rowKinds.push(r.kind === 'header' ? 'header' : r.kind === 'total' ? 'total' : 'detail');
  }
  return { rows, rowKinds };
}

/** Sum of absolute band totals (prefer explicit total rows). */
export function traditionalBsSideTotal(side: TraditionalBsSideRow[]): number {
  const totals = side.filter(r => r.kind === 'total' && r.total != null);
  if (totals.length) {
    return totals.reduce((s, r) => s + (r.total ?? 0), 0);
  }
  return side
    .filter(r => r.kind === 'detail' && r.amount != null)
    .reduce((s, r) => s + (r.amount ?? 0), 0);
}
