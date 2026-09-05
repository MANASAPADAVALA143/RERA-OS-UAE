import * as XLSX from 'xlsx';

export interface ParsedFinItem {
  label: string;
  values: Record<number, number>;
  monthlyValues?: Record<string, number>;
  indent: number;
  isTotal: boolean;
  isSectionHeader: boolean;
  isNetIncome: boolean;
  /** True when this row's label came from an uploaded Category column, not raw QBO
   * account text — signals downstream code to trust it as-is and skip legacy
   * label-pattern-matching/clubbing meant for uncategorized uploads. */
  fromCategory?: boolean;
}

export interface ParsedFinancialWorkbook {
  companyName: string;
  dateRange: string;
  fileName: string;
  uploadedAt: string;
  years: number[];
  periods: string[];
  pl: ParsedFinItem[];
  bs: ParsedFinItem[];
  cf: ParsedFinItem[];
  /** Debug info when parse yields no rows */
  parseNotes?: string[];
}

export interface ParseFinancialExcelOptions {
  /** Which statement the user is uploading — used when the sheet has no title row. */
  hintType?: 'pl' | 'bs' | 'cf';
}

const MONTH_ABBRS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_DISPLAY = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MONTH_NAME_RE = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;

function monthNameToIndex(name: string): number {
  const token = name.trim().slice(0, 3).toLowerCase();
  return MONTH_ABBRS.indexOf(token);
}

function getCellDisplay(ws: XLSX.WorkSheet, r: number, c: number): unknown {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr];
  if (!cell) return '';
  if (cell.w != null && String(cell.w).trim()) return cell.w;
  return cell.v ?? '';
}

export function parseMonthHeaderCell(cell: unknown): { year: number; month: number } | null {
  if (cell === '' || cell === null || cell === undefined) return null;

  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const year = cell.getFullYear();
    if (year >= 2010 && year <= 2035) return { year, month: cell.getMonth() };
    return null;
  }

  // Note: no numeric "Excel serial → date" fallback here. With `cellDates: true` set at
  // read time, genuine date-formatted cells already arrive as JS Date objects (handled
  // above) — a bare-number heuristic would misinterpret ordinary dollar amounts in the
  // ~35,000-65,000 range (a common expense/asset size) as calendar dates.

  const cellStr = String(cell).trim();
  if (!cellStr) return null;

  let m = cellStr.match(/^([A-Za-z]{3,9})[\s\-_/]+(\d{4})$/);
  if (m) {
    const monthIdx = monthNameToIndex(m[1]);
    const year = parseInt(m[2], 10);
    if (monthIdx >= 0 && year >= 2010 && year <= 2035) return { year, month: monthIdx };
  }

  m = cellStr.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    if (month >= 0 && month <= 11 && year >= 2010 && year <= 2035) return { year, month };
  }

  m = cellStr.match(/(?:as of\s+)?(?:[A-Za-z]+\s+)?([A-Za-z]{3,9})\s+\d{1,2},?\s+(\d{4})/i);
  if (m) {
    const monthIdx = monthNameToIndex(m[1]);
    const year = parseInt(m[2], 10);
    if (monthIdx >= 0 && year >= 2010 && year <= 2035) return { year, month: monthIdx };
  }

  if (MONTH_NAME_RE.test(cellStr.split(/\s+/)[0] ?? '')) {
    const parsed = Date.parse(cellStr.replace(/_/g, ' '));
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      const year = d.getFullYear();
      if (year >= 2010 && year <= 2035) return { year, month: d.getMonth() };
    }
  }

  return null;
}

function parseYearHeaderCell(cell: unknown): number | null {
  if (cell === '' || cell === null || cell === undefined) return null;
  if (typeof cell === 'number' && Number.isInteger(cell) && cell >= 2010 && cell <= 2035) return cell;
  const s = String(cell).trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // FY 2025 / FY2025 / F.Y. 2025 / bare 2025
  let m = s.match(/^(?:F\.?Y\.?\s*)?(\d{4})$/i);
  if (m) {
    const year = parseInt(m[1], 10);
    if (year >= 2010 && year <= 2035) return year;
  }

  // H1 2026 / H1-2026 / 1H 2026 / H1 FY 2026 / First Half 2026 / Half Year 2026
  m = s.match(/^(?:H\s*[12]|[12]\s*H)(?:\s*F\.?Y\.?)?[\s\-_/]*(\d{4})$/i)
    || s.match(/^(?:first|second|1st|2nd)\s*half(?:\s*(?:of|year)?)?[\s\-_/]*(\d{4})$/i)
    || s.match(/^half[\s\-_]*year[\s\-_/]*(\d{4})$/i)
    || s.match(/^(?:YTD|H[12])[\s\-_/]+(?:through|to|ending)?[\s\-_/]*[A-Za-z]{3,9}[\s\-_/]+(\d{4})$/i);
  if (m) {
    const year = parseInt(m[1], 10);
    if (year >= 2010 && year <= 2035) return year;
  }

  const fromMonth = parseMonthHeaderCell(cell);
  if (fromMonth) return fromMonth.year;
  return null;
}

/** Lowercase, strip slashes/parens (used in wordings like "Net Profit/(Loss)"), collapse whitespace. */
function normalizeStatementLabel(label: string): string {
  return label.toLowerCase().replace(/[/()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** QBO "Total for Taxes paid" — board clubs detail into Property taxes and drops this subtotal. */
function isTaxesPaidBandSubtotalLabel(label: string): boolean {
  return /^total\s+(for\s+)?taxes\s+paid$/.test(normalizeStatementLabel(label));
}

function isTotalLabel(label: string): boolean {
  const norm = normalizeStatementLabel(label);
  if (/^total\s+for\s+/.test(norm)) return true;
  // Unanchored on purpose — also matches grand-total rows like "Total Liabilities and Equity".
  if (/^total\s+(assets|liabilit(?:y|ies)|equity)/.test(norm)) return true;
  // Cash Flow structural summary lines — QBO leaves their Category cell blank just like
  // "Total for …" rows, so they must count as totals or a Category upload would drop them.
  if (/^net\s+cash\s+(provided by|used in)\s+(operating|investing|financing)\s+activities/.test(norm)) return true;
  if (/^net\s+(increase|decrease|change)\s+in\s+cash/.test(norm)) return true;
  if (/^cash\s+at\s+(the\s+)?(beginning|end)\s+of\s+(the\s+)?(period|year)/.test(norm)) return true;
  // These bare variants require an exact match so we don't swallow unrelated line items
  // that merely start with "Total" (e.g. "Total Rent Roll").
  return /^total\s+(income|expenses?|tax\s+expense)$/.test(norm);
}

export function isNetIncomeLabel(label: string, sheetType?: 'pl' | 'bs' | 'cf' | 'unknown'): boolean {
  const norm = normalizeStatementLabel(label);
  // Do NOT treat "Net Operating Income" as Net Income — NOI is a separate P&L line.
  if (/^net\s+operating\s+income$/.test(norm)) return false;
  if (/^net\s+(income|profit|profit\s+loss|loss)$/.test(norm)) return true;
  // "Profit/Loss for the Year" is the P&L bottom line when phrased that way — but
  // in a Balance Sheet's equity/partners' capital rollforward, the identical
  // phrase is just a regular contributing line (Opening Capital + Loss for the
  // Year + ... = Closing Capital), not a grand total, and must not get the bold
  // Net Income treatment there.
  if (sheetType === 'bs') return false;
  return /^(profit|loss|profit\s+loss)\s+for\s+the\s+(year|period)$/.test(norm);
}

/** True for the Net Operating Income line (distinct from bottom-line Net Income). */
export function isNetOperatingIncomeLabel(label: string): boolean {
  return /^net\s+operating\s+income$/.test(normalizeStatementLabel(label));
}

/** Top-level section titles only — not BS subcategory names like "Bank Accounts"
 * that also appear as category rollup labels with amounts. */
export function isBareSectionHeaderLabel(label: string): boolean {
  const norm = normalizeStatementLabel(label);
  return /^(income|revenue|expenses?|cost of goods sold|cogs|gross profit|assets|liabilit(?:y|ies)|equity(?:\s+and\s+liabilit(?:y|ies))?|shareholders?\s+funds?|non[- ]current assets?|current assets?|operating\s+activit(?:y|ies)|investing\s+activit(?:y|ies)|financing\s+activit(?:y|ies))$/i.test(norm);
}

/** True if every value column in this row itself parses as a year/month header — i.e. a
 *  second, unrelated table (e.g. a "Transfer to X" reconciliation schedule) starts here. */
function looksLikeYearHeaderRow(row: unknown[], cols: Array<{ col: number }>): boolean {
  return cols.length > 0 && cols.every(c => parseYearHeaderCell(row[c.col]) != null);
}
function looksLikeMonthHeaderRow(row: unknown[], cols: Array<{ col: number }>): boolean {
  return cols.length > 0 && cols.every(c => parseMonthHeaderCell(row[c.col]) != null);
}

function parseCellNumber(rv: unknown): number {
  if (rv === '' || rv === null || rv === undefined) return 0;
  if (typeof rv === 'number') return Number.isFinite(rv) ? rv : 0;
  const raw = String(rv).trim();
  if (!raw || raw === '-' || raw === '—' || raw === '–' || raw === '$' || raw === '$-' || raw === '$ -') return 0;
  // "$ -1,45,779.44", "$-1,234", "(1,234)", Unicode minus
  const negative = (raw.includes('(') && raw.includes(')'))
    || /^[$€£₹]?\s*[-−–]/.test(raw)
    || raw.startsWith('$-');
  let cleaned = raw
    .replace(/[$€£₹()]/g, '')
    .replace(/[-−–]/g, '')
    .replace(/\s+/g, '');
  // Indian (12,34,567.89) and Western (1,234,567.89) groupings — strip all commas.
  cleaned = cleaned.replace(/,/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return negative ? -Math.abs(n) : n;
}

/**
 * Category P&Ls often put the period amount in Total while only some month/year
 * cells are filled (e.g. months sum to 1,500 but Total is 3,000). Prefer Total
 * when it is larger and the row only hits a single year (or none yet).
 */
function applyPlCfTotalCol(
  values: Record<number, number>,
  years: number[],
  totalCol: number | null,
  row: unknown[],
  sheetType: 'pl' | 'bs' | 'cf' | 'unknown',
  monthlyValues?: Record<string, number>,
): boolean {
  if (totalCol == null || (sheetType !== 'pl' && sheetType !== 'cf') || !years.length) {
    return years.some(y => (values[y] ?? 0) !== 0);
  }
  const totalVal = parseCellNumber(row[totalCol]);
  if (totalVal === 0) return years.some(y => (values[y] ?? 0) !== 0);

  const yearsWithAmt = years.filter(y => (values[y] ?? 0) !== 0);
  const sumYears = years.reduce((s, y) => s + (values[y] ?? 0), 0);

  if (!yearsWithAmt.length) {
    values[years[years.length - 1]!] = totalVal;
    return true;
  }
  if (yearsWithAmt.length === 1 && Math.abs(totalVal) - Math.abs(sumYears) > 0.005) {
    const y = yearsWithAmt[0]!;
    values[y] = totalVal;
    if (monthlyValues) {
      const monthKeys = Object.keys(monthlyValues).filter(k => k.endsWith(` ${y}`));
      const nonZero = monthKeys.filter(k => (monthlyValues[k] ?? 0) !== 0);
      if (nonZero.length === 1) monthlyValues[nonZero[0]!] = totalVal;
    }
    return true;
  }
  return years.some(y => (values[y] ?? 0) !== 0);
}

/**
 * Pick which column (left of the first value column) holds the row labels. Usually that's
 * simply the column immediately to the left, but some exports insert a mostly-blank
 * secondary column there (e.g. "Note No."). Prefer an explicit Particulars/Description
 * header, then the column with the most *text* labels (not numeric amounts).
 */
/** Like `a ?? b ?? ''` but also skips a blank/whitespace-only string, not just null/undefined. */
function firstNonBlankCell(...cells: unknown[]): string {
  for (const c of cells) {
    if (c === undefined || c === null) continue;
    const s = String(c);
    if (s.trim() !== '') return s;
  }
  return '';
}

/** Prefer the configured label column; if it looks like an amount, scan left-side text cells. */
function resolveRowLabel(
  row: unknown[],
  labelCol: number,
  valueCols: number[],
): string {
  const firstValueCol = valueCols.length ? Math.min(...valueCols) : labelCol + 1;
  const primary = firstNonBlankCell(row[labelCol], row[0]);
  if (primary && !looksLikeNumericLabel(primary)) return primary;

  for (let c = 0; c < firstValueCol; c++) {
    if (valueCols.includes(c)) continue;
    const s = String(row[c] ?? '').trim();
    if (!s || s === '-' || s === '—' || s === '–') continue;
    if (looksLikeNumericLabel(s)) continue;
    if (/^\d{1,3}$/.test(s)) continue; // note numbers
    return String(row[c] ?? ''); // preserve leading indent spaces
  }
  return primary;
}

function isLabelHeaderName(h: string): boolean {
  return /^(particulars?|description|account(\s*name)?|line\s*item|details?)$/i.test(h.trim());
}

function isNoteHeaderName(h: string): boolean {
  return /^(note(\s*no\.?)?|notes?|#)$/i.test(h.trim());
}

/** True when a "label" is really an amount / note number (wrong column). */
function looksLikeNumericLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (/^[A-Za-z]/.test(t)) return false;
  return /^[$€£₹(.\-\s]*[\d,]+(?:\.\d+)?[)\s]*$/.test(t);
}

function pickLabelCol(raw: unknown[][], headerRowIdx: number, firstValueCol: number): number {
  const fallback = Math.max(0, firstValueCol - 1);
  const header = (raw[headerRowIdx] as unknown[] | undefined) ?? [];

  // Explicit Particulars / Description / Account column always wins.
  for (let c = 0; c < firstValueCol; c++) {
    if (isLabelHeaderName(String(header[c] ?? ''))) return c;
  }

  if (firstValueCol <= 1) return fallback;

  let best = fallback;
  let bestScore = Number.NEGATIVE_INFINITY;
  const lastRow = Math.min(raw.length, headerRowIdx + 1 + 60);
  for (let c = 0; c < firstValueCol; c++) {
    if (isNoteHeaderName(String(header[c] ?? ''))) continue;
    let textCount = 0;
    let numericCount = 0;
    let nonBlank = 0;
    for (let r = headerRowIdx + 1; r < lastRow; r++) {
      const v = (raw[r] as unknown[] | undefined)?.[c];
      if (v === undefined || v === null) continue;
      const s = String(v).trim();
      if (!s || s === '-' || s === '—' || s === '–') continue;
      nonBlank += 1;
      if (looksLikeNumericLabel(s) || typeof v === 'number') numericCount += 1;
      else textCount += 1;
    }
    // Prefer text-heavy columns; penalize amount-like columns (H1 values mistaken as labels).
    const score = textCount * 5 + nonBlank - numericCount * 4;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Optional "category" column (usually right of year/Total) — used to rename + roll up detail lines.
 * Shared by P&L and Balance Sheet uploads when the sheet has a category header. */
function findCategoryCol(
  raw: unknown[][],
  headerRowIdx: number,
  valueCols: number[],
): number | null {
  const valueSet = new Set(valueCols);
  const isCategoryHeader = (h: string) =>
    /^categor(?:y|ies)$/i.test(h)
    || /^account\s*categor(?:y|ies)$/i.test(h)
    || /^group(\s*name)?$/i.test(h);

  // Check the year-header row and one row above/below (merged/two-row headers).
  const rowsToCheck = [headerRowIdx - 1, headerRowIdx, headerRowIdx + 1]
    .filter(r => r >= 0 && r < raw.length);
  for (const r of rowsToCheck) {
    const header = (raw[r] as unknown[] | undefined) ?? [];
    for (let c = 0; c < header.length; c++) {
      if (valueSet.has(c)) continue;
      if (isCategoryHeader(String(header[c] ?? '').trim())) return c;
    }
  }
  return null;
}

/**
 * Standalone Total / Amount / YTD column (not a month or year header).
 * Prop Dev category P&Ls often leave month cells blank and put the period amount in Total.
 */
function findTotalCol(
  raw: unknown[][],
  headerRowIdx: number,
  reservedCols: number[],
): number | null {
  const reserved = new Set(reservedCols);
  const isTotalHeader = (h: string) =>
    /^(totals?|amount|ytd|ytd\s*total)$/i.test(h.trim().replace(/\s+/g, ' '));

  const rowsToCheck = [headerRowIdx - 1, headerRowIdx, headerRowIdx + 1]
    .filter(r => r >= 0 && r < raw.length);
  for (const r of rowsToCheck) {
    const header = (raw[r] as unknown[] | undefined) ?? [];
    for (let c = 0; c < header.length; c++) {
      if (reserved.has(c)) continue;
      if (isTotalHeader(String(header[c] ?? ''))) return c;
    }
  }
  return null;
}

/** BS subcategory names rolled up via category column (Bank Accounts, AR, …). */
const CATEGORY_ROLLUP_SECTION_RE =
  /^(bank accounts?|accounts receivable|accounts payable|credit cards?|other current assets?|fixed assets?|other assets?)$/i;

function isCategoryRollupSectionLabel(label: string): boolean {
  return CATEGORY_ROLLUP_SECTION_RE.test(normalizeStatementLabel(label));
}

/**
 * Map Category cell → rollup label.
 * P&L / Cash Flow / Balance Sheet: keep only rows with a filled Category (plus Net
 * Income). No blank-Category lines — the Category cell is always the line's label.
 */
function resolveCategoryRollupRow(
  categoryCol: number | null,
  lineLabel: string,
  categoryLabel: string,
  hasAny: boolean,
  isTotal: boolean,
  isNetIncome: boolean,
  activeRollupCategory: { value: string },
  sheetType: 'pl' | 'bs' | 'cf' | 'unknown' = 'unknown',
): { label: string; usedCategory: boolean; skip: boolean } {
  const lineTrimmed = lineLabel.trim();
  if (categoryCol == null) {
    return { label: lineTrimmed, usedCategory: false, skip: false };
  }

  const strictFilledCategory = sheetType === 'pl' || sheetType === 'cf' || sheetType === 'bs';
  if (strictFilledCategory) {
    // Totals / Net Income are structural (Total for Expenses, Total for Assets, …) and
    // never carry their own Category cell in a QBO export — always keep them.
    if (isNetIncome || isTotal) {
      return { label: lineTrimmed, usedCategory: false, skip: false };
    }
    // Drop Income / Expenses banners and any detail with blank Category.
    if (!categoryLabel) {
      return { label: lineTrimmed, usedCategory: false, skip: true };
    }
    return { label: categoryLabel.trim(), usedCategory: true, skip: false };
  }

  if (!hasAny && !isTotal && !isNetIncome && isBareSectionHeaderLabel(lineTrimmed)) {
    activeRollupCategory.value = '';
  }

  // Empty subcategory header (Col A = "Bank Accounts", no amounts) — skip; detail lines inherit.
  if (!hasAny && !isTotal && !isNetIncome && !categoryLabel && isCategoryRollupSectionLabel(lineTrimmed)) {
    activeRollupCategory.value = lineTrimmed;
    return { label: lineTrimmed, usedCategory: false, skip: true };
  }

  if (categoryLabel && isCategoryRollupSectionLabel(categoryLabel)) {
    activeRollupCategory.value = categoryLabel;
  }

  let effectiveCategory = categoryLabel;
  if (!effectiveCategory && activeRollupCategory.value && hasAny && !isTotal && !isNetIncome) {
    effectiveCategory = activeRollupCategory.value;
  }

  const label = (effectiveCategory || lineTrimmed).trim();
  return { label, usedCategory: Boolean(effectiveCategory), skip: !label };
}
/** Merge detail rows that share the same category/label (sum year amounts).
 * Section headers / totals / net stay as-is; rollup resets at each section header.
 * Drops empty section headers that duplicate a rolled-up category name (e.g. Bank Accounts). */
function rollupByCategoryLabel(items: ParsedFinItem[]): ParsedFinItem[] {
  const out: ParsedFinItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    if (item.isSectionHeader || item.isNetIncome || item.isTotal) {
      out.push(item);
      if (item.isSectionHeader) indexByKey.clear();
      continue;
    }
    const key = normalizeStatementLabel(item.label);
    if (!key) {
      out.push(item);
      continue;
    }
    const existingIdx = indexByKey.get(key);
    if (existingIdx == null) {
      indexByKey.set(key, out.length);
      out.push({
        ...item,
        values: { ...item.values },
        monthlyValues: item.monthlyValues ? { ...item.monthlyValues } : undefined,
      });
      continue;
    }
    const existing = out[existingIdx];
    for (const [yStr, v] of Object.entries(item.values)) {
      const y = Number(yStr);
      existing.values[y] = (existing.values[y] ?? 0) + (typeof v === 'number' ? v : 0);
    }
    if (item.monthlyValues) {
      existing.monthlyValues = existing.monthlyValues ?? {};
      for (const [k, v] of Object.entries(item.monthlyValues)) {
        existing.monthlyValues[k] = (existing.monthlyValues[k] ?? 0) + v;
      }
    }
  }

  // Remove empty section headers whose title matches a detail/category row (avoids
  // "Bank Accounts" header + "Bank Accounts" rolled-up line with amounts).
  const detailKeys = new Set(
    out
      .filter(i => !i.isSectionHeader && !i.isNetIncome)
      .filter(i => Object.values(i.values).some(v => v !== 0))
      .map(i => normalizeStatementLabel(i.label)),
  );
  const filtered = out.filter(i => {
    if (!i.isSectionHeader) return true;
    return !detailKeys.has(normalizeStatementLabel(i.label));
  });
  return dropEmptyDuplicateCategoryRows(filtered);
}

/** Drop empty duplicate labels when a rolled-up row with amounts exists (e.g. twin Bank Accounts headers). */
function dropEmptyDuplicateCategoryRows(items: ParsedFinItem[]): ParsedFinItem[] {
  const labelsWithData = new Set<string>();
  for (const item of items) {
    if (Object.values(item.values).some(v => v !== 0)) {
      labelsWithData.add(normalizeStatementLabel(item.label));
    }
  }
  return items.filter(item => {
    const key = normalizeStatementLabel(item.label);
    if (!labelsWithData.has(key)) return true;
    const hasAmount = Object.values(item.values).some(v => v !== 0);
    if (hasAmount) return true;
    if (item.isTotal || item.isNetIncome) return true;
    // Empty duplicate of a labeled row that has amounts (Improvements header + Improvements detail).
    return false;
  });
}

/** Drop subtotal rows where Col A repeats the category name (e.g. yellow "Bank Accounts"
 * total under bank detail lines) so rollup does not double-count. */
function excludeCategoryNamedSubtotals<T extends {
  label: string;
  sourceLabel: string;
  hasAny: boolean;
  isTotal: boolean;
  isNetIncome: boolean;
}>(rows: T[]): T[] {
  const detailCountByCat = new Map<string, number>();
  for (const row of rows) {
    if (row.isTotal || row.isNetIncome || !row.hasAny) continue;
    const cat = normalizeStatementLabel(row.label);
    const src = normalizeStatementLabel(row.sourceLabel);
    if (cat && src && cat !== src) {
      detailCountByCat.set(cat, (detailCountByCat.get(cat) ?? 0) + 1);
    }
  }
  return rows.filter(row => {
    if (row.isTotal || row.isNetIncome || !row.hasAny) return true;
    const cat = normalizeStatementLabel(row.label);
    const src = normalizeStatementLabel(row.sourceLabel);
    // Same name as category + other real detail lines exist → Excel subtotal, skip.
    if (cat && src && cat === src && (detailCountByCat.get(cat) ?? 0) > 0) return false;
    return true;
  });
}

function detectMonthlyHeaders(
  ws: XLSX.WorkSheet,
  raw: unknown[][],
): {
  headerRowIdx: number;
  monthCols: Array<{ year: number; month: number; col: number }>;
  years: number[];
  labelCol: number;
} | null {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const maxRow = Math.min(range.e.r, 35);

  for (let r = 0; r <= maxRow; r++) {
    const monthCols: Array<{ year: number; month: number; col: number }> = [];
    let nonBlankCount = 0;
    for (let c = 0; c <= range.e.c; c++) {
      const display = getCellDisplay(ws, r, c);
      const fallback = (raw[r] as unknown[] | undefined)?.[c];
      if (String(display ?? fallback ?? '').trim()) nonBlankCount++;
      const parsed = parseMonthHeaderCell(display) ?? parseMonthHeaderCell(fallback);
      if (parsed) monthCols.push({ year: parsed.year, month: parsed.month, col: c });
    }
    // A lone "As of Month Day, Year" caption (row otherwise blank) is a title/subtitle,
    // not a header row — require either 2+ period columns, or a separate non-blank
    // label cell alongside the single period column, before accepting this row.
    if (monthCols.length >= 2 || (monthCols.length === 1 && nonBlankCount >= 2)) {
      const years = [...new Set(monthCols.map(mc => mc.year))].sort((a, b) => a - b);
      const labelCol = pickLabelCol(raw, r, Math.min(...monthCols.map(mc => mc.col)));
      return { headerRowIdx: r, monthCols, years, labelCol };
    }
  }
  return null;
}

function detectYearHeaders(
  ws: XLSX.WorkSheet,
  raw: unknown[][],
): {
  headerRowIdx: number;
  yearCols: Array<{ year: number; col: number }>;
  labelCol: number;
  hasParticulars: boolean;
  score: number;
} | null {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const maxRow = Math.min(range.e.r, 35);
  let best: {
    headerRowIdx: number;
    yearCols: Array<{ year: number; col: number }>;
    labelCol: number;
    hasParticulars: boolean;
    score: number;
  } | null = null;

  for (let r = 0; r <= maxRow; r++) {
    const yearCols: Array<{ year: number; col: number }> = [];
    let nonBlankCount = 0;
    let hasParticulars = false;
    const monthFallbackYearCounts = new Map<number, number>();
    for (let c = 0; c <= range.e.c; c++) {
      const display = getCellDisplay(ws, r, c);
      const fallback = (raw[r] as unknown[] | undefined)?.[c];
      const text = String(display ?? fallback ?? '').trim();
      if (text) nonBlankCount++;
      if (isLabelHeaderName(text)) hasParticulars = true;
      const year = parseYearHeaderCell(display) ?? parseYearHeaderCell(fallback);
      if (year != null) {
        yearCols.push({ year, col: c });
        // Track cells whose year only came from month-parsing ("Jan 2026" etc.),
        // as opposed to a genuine bare/FY/H1 year cell.
        if (parseMonthHeaderCell(display) ?? parseMonthHeaderCell(fallback)) {
          monthFallbackYearCounts.set(year, (monthFallbackYearCounts.get(year) ?? 0) + 1);
        }
      }
    }
    // Reject only when 2+ MONTH-parsed cells collide on the same year (e.g. "Jan
    // 2026", "Feb 2026", "Mar 2026" all resolving to "year 2026" via the month
    // fallback) — that specific pattern is monthly data misdetected as annual, and
    // the annual parser overwrites (not sums) same-year columns, so only the last
    // month would survive. A single incidental collision with an otherwise genuine
    // bare-year column must not reject the whole row — real files have noise
    // columns (Total, notes, account codes) that could coincidentally parse as a
    // month for a year already covered by a real year column.
    if ([...monthFallbackYearCounts.values()].some(n => n >= 2)) continue;

    // Same guard as detectMonthlyHeaders — a lone "As of ..." caption cell in an
    // otherwise-blank row is a title/subtitle, not a header row.
    if (yearCols.length >= 2 || (yearCols.length === 1 && nonBlankCount >= 2)) {
      const labelCol = pickLabelCol(raw, r, Math.min(...yearCols.map(yc => yc.col)));
      // Prefer rows with an explicit Particulars/Description header and more year columns
      // (H1 + FY) over a weaker earlier match.
      const score = yearCols.length * 10 + (hasParticulars ? 50 : 0) + nonBlankCount;
      if (!best || score > best.score) {
        best = { headerRowIdx: r, yearCols, labelCol, hasParticulars, score };
      }
      // Strong Particulars + 2 period columns — take immediately.
      if (hasParticulars && yearCols.length >= 2) {
        return { headerRowIdx: r, yearCols, labelCol, hasParticulars, score };
      }
    }
  }
  return best;
}

/** Title captions like "Jan 2025 to Dec 2025" look like 2 month columns in one year. */
function monthlyHeadersLookLikeTitle(
  monthInfo: { monthCols: Array<{ year: number; month: number; col: number }> },
): boolean {
  const years = new Set(monthInfo.monthCols.map(m => m.year));
  return years.size <= 1 && monthInfo.monthCols.length <= 3;
}

function detectSheetTypeFromContent(raw: unknown[][]): 'pl' | 'bs' | 'cf' | 'unknown' {
  for (let r = 0; r < Math.min(25, raw.length); r++) {
    const joined = (raw[r] as unknown[]).map(c => String(c ?? '').toLowerCase()).join(' ');
    // CF first — cash-flow statements often contain "Net Income" and would otherwise
    // be misclassified as P&L, which then gets skipped on Upload CF.
    if (
      joined.includes('cash flow')
      || joined.includes('statement of cash')
      || joined.includes('cashflow')
      || joined.includes('operating activities')
      || joined.includes('investing activities')
      || joined.includes('financing activities')
    ) return 'cf';
    if (joined.includes('profit and loss') || joined.includes('profit & loss') || joined.includes('income statement') || /\bp\s*&?\s*l\b/.test(joined)) return 'pl';
    if (joined.includes('balance sheet')) return 'bs';
  }

  // QBO line-item heuristics when the sheet has no title row (e.g. Sheet2).
  let bsHits = 0;
  let plHits = 0;
  let cfHits = 0;
  for (let r = 0; r < Math.min(80, raw.length); r++) {
    const label = String((raw[r] as unknown[])?.[0] ?? '').toLowerCase();
    if (!label) continue;
    if (/total for (fixed )?assets|total for (current )?liabilities|total for equity|total for bank/.test(label)) bsHits += 2;
    if (/total\s+liabilit(?:y|ies)|total\s+assets|partners?\s+capital|loan\s+from\s+partners?/.test(label)) bsHits += 2;
    if (/fixed assets|current assets|long.?term|accounts payable|retained earnings/.test(label)) bsHits += 1;
    if (/total for (income|expenses)|gross profit|net income|lease income|cost of goods/.test(label)) plHits += 2;
    if (/total\s+income|total\s+expenses?|net\s+profit/.test(label)) plHits += 2;
    if (/operating activities|investing activities|financing activities|net cash/.test(label)) cfHits += 2;
  }
  if (bsHits >= 3 && bsHits >= plHits && bsHits >= cfHits) return 'bs';
  if (plHits >= 3 && plHits >= bsHits && plHits >= cfHits) return 'pl';
  if (cfHits >= 2 && cfHits >= bsHits && cfHits >= plHits) return 'cf';
  return 'unknown';
}

function detectSheetType(raw: unknown[][], fileName = '', sheetName = ''): 'pl' | 'bs' | 'cf' | 'unknown' {
  const fromContent = detectSheetTypeFromContent(raw);
  if (fromContent !== 'unknown') return fromContent;

  // Prefer sheet tab name over filename (filename often mixes "PL_BS_CF").
  const sheet = sheetName.toLowerCase();
  if (/profit|loss|income\s+statement|\bp\s*&?\s*l\b/.test(sheet)) return 'pl';
  if (/balance|b\s*\/\s*s|bs\b/.test(sheet)) return 'bs';
  if (/cash\s*flow|cf\b/.test(sheet)) return 'cf';

  const file = fileName.toLowerCase();
  const filePl = /profit|loss|income\s+statement|\bp\s*&?\s*l\b/.test(file);
  const fileBs = /balance\s*sheet|\bbalance\b|\bb\/s\b/.test(file);
  const fileCf = /cash\s*flow|statement\s+of\s+cash/.test(file);
  const hitCount = [filePl, fileBs, fileCf].filter(Boolean).length;
  // Ambiguous filenames (e.g. "Victoria_PL_BS.xlsx") — do not force a type.
  if (hitCount === 1) {
    if (filePl) return 'pl';
    if (fileBs) return 'bs';
    if (fileCf) return 'cf';
  }
  return 'unknown';
}

function parseSheetRowsMonthly(
  raw: unknown[][],
  headerRowIdx: number,
  monthCols: Array<{ year: number; month: number; col: number }>,
  years: number[],
  sheetType: 'pl' | 'bs' | 'cf' | 'unknown',
  labelCol: number,
  categoryCol: number | null = null,
  totalCol: number | null = null,
): ParsedFinItem[] {
  const byYear: Record<number, Array<{ month: number; col: number }>> = {};
  for (const mc of monthCols) {
    if (!byYear[mc.year]) byYear[mc.year] = [];
    byYear[mc.year].push({ month: mc.month, col: mc.col });
  }
  for (const y of years) byYear[y].sort((a, b) => a.month - b.month);

  interface RawRow {
    label: string; sourceLabel: string; indent: number; values: Record<number, number>; monthlyValues: Record<string, number>;
    isTotal: boolean; isNetIncome: boolean; hasAny: boolean; usedCategory: boolean;
  }
  const rawRows: RawRow[] = [];
  const activeRollupCategory = { value: '' };
  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r] as unknown[];
    if (looksLikeMonthHeaderRow(row, monthCols)) break;
    const valueCols = [
      ...monthCols.map(mc => mc.col),
      ...(totalCol != null ? [totalCol] : []),
    ];
    const lineLabel = resolveRowLabel(row, labelCol, valueCols);
    const categoryLabel = categoryCol != null ? String(row[categoryCol] ?? '').trim() : '';
    // Amount / note cells mistaken as labels — skip (Particulars / H1 / FY workbooks).
    if (looksLikeNumericLabel(lineLabel.trim())) continue;

    const indent = lineLabel.length - lineLabel.trimStart().length;
    const isTotal = isTotalLabel(lineLabel.trim()) || (categoryLabel ? isTotalLabel(categoryLabel) : false);
    const isNetIncome = isNetIncomeLabel(lineLabel.trim(), sheetType) || (categoryLabel ? isNetIncomeLabel(categoryLabel, sheetType) : false);
    if ((sheetType === 'pl' || sheetType === 'cf') && isTaxesPaidBandSubtotalLabel(lineLabel)) continue;

    const values: Record<number, number> = {};
    const monthlyValues: Record<string, number> = {};
    let hasAny = false;

    for (const year of years) {
      const cols = byYear[year] ?? [];
      if (sheetType === 'bs') {
        let val = 0;
        for (const { month, col } of cols) {
          const rv = row[col];
          const n = parseCellNumber(rv);
          monthlyValues[`${MONTH_DISPLAY[month]} ${year}`] = n;
          if (rv !== '' && rv !== null && rv !== undefined) val = n;
        }
        values[year] = val;
      } else {
        let sum = 0;
        for (const { month, col } of cols) {
          const rv = row[col];
          const safe = parseCellNumber(rv);
          monthlyValues[`${MONTH_DISPLAY[month]} ${year}`] = safe;
          sum += safe;
        }
        values[year] = sum;
      }
      if (values[year] !== 0) hasAny = true;
    }

    hasAny = applyPlCfTotalCol(values, years, totalCol, row, sheetType, monthlyValues);

    const resolved = resolveCategoryRollupRow(
      categoryCol, lineLabel, categoryLabel, hasAny, isTotal, isNetIncome, activeRollupCategory, sheetType,
    );
    if (resolved.skip) continue;

    const trimmed = resolved.label;
    const usedCategory = resolved.usedCategory;

    const forceSection = !hasAny && !isTotal && !isNetIncome && (
      isBareSectionHeaderLabel(trimmed) || isBareSectionHeaderLabel(lineLabel.trim())
    );
    rawRows.push({
      label: trimmed, sourceLabel: lineLabel.trim(), indent, values, monthlyValues, isTotal, isNetIncome, hasAny,
      usedCategory: forceSection ? false : usedCategory,
    });
  }

  const rowsForItems = categoryCol != null && sheetType === 'bs'
    ? excludeCategoryNamedSubtotals(rawRows)
    : rawRows;
  const items: ParsedFinItem[] = [];
  for (let i = 0; i < rowsForItems.length; i++) {
    const cur = rowsForItems[i];
    // Keep "Total for …" rows even when amounts are 0 (asset + accum. dep. nets to zero).
    if (!cur.hasAny && cur.isNetIncome) continue;
    const next = rowsForItems[i + 1];
    const isSectionHeader = !cur.hasAny && !cur.isTotal && !cur.isNetIncome && (
      isBareSectionHeaderLabel(cur.label)
      || isBareSectionHeaderLabel(cur.sourceLabel)
      || (!!next && next.indent > cur.indent && !isCategoryRollupSectionLabel(cur.label))
      || (categoryCol != null && !cur.usedCategory && !isCategoryRollupSectionLabel(cur.label) && !isCategoryRollupSectionLabel(cur.sourceLabel))
    );
    items.push({
      label: cur.label, indent: cur.indent, values: cur.values, monthlyValues: cur.monthlyValues,
      isTotal: cur.isTotal, isSectionHeader, isNetIncome: cur.isNetIncome,
      fromCategory: cur.usedCategory,
    });
  }
  return categoryCol != null ? rollupByCategoryLabel(items) : items;
}

function parseSheetRows(
  raw: unknown[][],
  headerRowIdx: number,
  yearCols: Array<{ year: number; col: number }>,
  labelCol: number,
  categoryCol: number | null = null,
  sheetType: 'pl' | 'bs' | 'cf' | 'unknown' = 'unknown',
  totalCol: number | null = null,
): ParsedFinItem[] {
  interface RawRow {
    label: string; sourceLabel: string; indent: number; values: Record<number, number>; isTotal: boolean; isNetIncome: boolean; hasAny: boolean;
    usedCategory: boolean;
  }
  const rawRows: RawRow[] = [];
  const activeRollupCategory = { value: '' };
  for (let r = headerRowIdx + 1; r < raw.length; r++) {
    const row = raw[r] as unknown[];
    if (looksLikeYearHeaderRow(row, yearCols)) break;
    const valueCols = [
      ...yearCols.map(yc => yc.col),
      ...(totalCol != null ? [totalCol] : []),
    ];
    const lineLabel = resolveRowLabel(row, labelCol, valueCols);
    const categoryLabel = categoryCol != null ? String(row[categoryCol] ?? '').trim() : '';
    // Amount / note cells mistaken as labels — skip (Particulars / H1 / FY workbooks).
    if (looksLikeNumericLabel(lineLabel.trim())) continue;

    const indent = lineLabel.length - lineLabel.trimStart().length;
    const isTotal = isTotalLabel(lineLabel.trim()) || (categoryLabel ? isTotalLabel(categoryLabel) : false);
    const isNetIncome = isNetIncomeLabel(lineLabel.trim(), sheetType) || (categoryLabel ? isNetIncomeLabel(categoryLabel, sheetType) : false);
    if ((sheetType === 'pl' || sheetType === 'cf') && isTaxesPaidBandSubtotalLabel(lineLabel)) continue;
    const values: Record<number, number> = {};
    let hasAny = false;
    for (const { year, col } of yearCols) {
      values[year] = parseCellNumber(row[col]);
      if (values[year] !== 0) hasAny = true;
    }
    const sortedYears = yearCols.map(yc => yc.year).sort((a, b) => a - b);
    hasAny = applyPlCfTotalCol(values, sortedYears, totalCol, row, sheetType);

    const resolved = resolveCategoryRollupRow(
      categoryCol, lineLabel, categoryLabel, hasAny, isTotal, isNetIncome, activeRollupCategory, sheetType,
    );
    if (resolved.skip) continue;

    const trimmed = resolved.label;
    const usedCategory = resolved.usedCategory;

    const forceSection = !hasAny && !isTotal && !isNetIncome && (
      isBareSectionHeaderLabel(trimmed) || isBareSectionHeaderLabel(lineLabel.trim())
    );
    rawRows.push({
      label: trimmed, sourceLabel: lineLabel.trim(), indent, values, isTotal, isNetIncome, hasAny,
      usedCategory: forceSection ? false : usedCategory,
    });
  }

  // BS only: drop Excel subtotals that repeat the category name (Bank Accounts total under details).
  // P&L category uploads often name the line the same as Category (e.g. Engineering Cost).
  const rowsForItems = categoryCol != null && sheetType === 'bs'
    ? excludeCategoryNamedSubtotals(rawRows)
    : rawRows;
  const items: ParsedFinItem[] = [];
  for (let i = 0; i < rowsForItems.length; i++) {
    const cur = rowsForItems[i];
    // Keep "Total for …" rows even when amounts are 0 (asset + accum. dep. nets to zero).
    if (!cur.hasAny && cur.isNetIncome) continue;
    const next = rowsForItems[i + 1];
    const isSectionHeader = !cur.hasAny && !cur.isTotal && !cur.isNetIncome && (
      isBareSectionHeaderLabel(cur.label)
      || isBareSectionHeaderLabel(cur.sourceLabel)
      || (!!next && next.indent > cur.indent && !isCategoryRollupSectionLabel(cur.label))
      || (categoryCol != null && !cur.usedCategory && !isCategoryRollupSectionLabel(cur.label) && !isCategoryRollupSectionLabel(cur.sourceLabel))
    );
    items.push({
      label: cur.label, indent: cur.indent, values: cur.values, isTotal: cur.isTotal, isSectionHeader,
      isNetIncome: cur.isNetIncome, fromCategory: cur.usedCategory,
    });
  }
  return categoryCol != null ? rollupByCategoryLabel(items) : items;
}

function getCompanyName(raw: unknown[][]): string {
  for (let r = 0; r < Math.min(10, raw.length); r++) {
    const row = raw[r] as unknown[];
    for (let c = 0; c < Math.min(3, row.length); c++) {
      const val = String(row[c] ?? '').trim();
      if (val && val.length > 2 && !/profit|loss|balance|sheet|cash\s*flow|statement|distribution\s+account|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(val)) {
        return val;
      }
    }
  }
  return '';
}

function getDateRange(raw: unknown[][], monthCols?: Array<{ year: number; month: number }>): string {
  if (monthCols && monthCols.length >= 1) {
    const sorted = [...monthCols].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return `${MONTH_DISPLAY[first.month]} ${first.year} – ${MONTH_DISPLAY[last.month]} ${last.year}`;
  }
  for (let r = 0; r < Math.min(12, raw.length); r++) {
    const joined = (raw[r] as unknown[]).join(' ').trim();
    if (/\d{4}/.test(joined) && /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(joined)) {
      return joined.slice(0, 80);
    }
  }
  return '';
}

function mergeDetectedYears(state: { detectedYears: number[] }, years: number[]) {
  state.detectedYears = Array.from(new Set([...state.detectedYears, ...years])).sort((a, b) => a - b);
}

function assignItems(
  effectiveType: 'pl' | 'bs' | 'cf' | 'unknown',
  items: ParsedFinItem[],
  years: number[],
  state: {
    plItems: ParsedFinItem[];
    bsItems: ParsedFinItem[];
    cfItems: ParsedFinItem[];
    detectedYears: number[];
  },
): boolean {
  if (effectiveType === 'pl') {
    if (state.plItems.length) return false;
    state.plItems = items;
    mergeDetectedYears(state, years);
    return true;
  }
  if (effectiveType === 'bs') {
    if (state.bsItems.length) return false;
    state.bsItems = items;
    mergeDetectedYears(state, years);
    return true;
  }
  if (effectiveType === 'cf') {
    if (state.cfItems.length) return false;
    state.cfItems = items;
    mergeDetectedYears(state, years);
    return true;
  }
  if (!state.plItems.length) {
    state.plItems = items;
    mergeDetectedYears(state, years);
    return true;
  }
  if (!state.bsItems.length) {
    state.bsItems = items;
    mergeDetectedYears(state, years);
    return true;
  }
  if (!state.cfItems.length) {
    state.cfItems = items;
    mergeDetectedYears(state, years);
    return true;
  }
  return false;
}

/** Parse QBO-style Excel exports (monthly columns like "Dec 2021" or annual year columns). */
export function parseFinancialExcel(
  file: File,
  companyName = '',
  options: ParseFinancialExcelOptions = {},
): Promise<ParsedFinancialWorkbook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false, cellDates: true });
        const parseNotes: string[] = [];
        const state = {
          plItems: [] as ParsedFinItem[],
          bsItems: [] as ParsedFinItem[],
          cfItems: [] as ParsedFinItem[],
          detectedYears: [] as number[],
        };
        let detectedPeriods: string[] = [];
        let detectedName = companyName;
        let dateRange = '';

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
          const rawWithHint = [[sheetName, ...((raw[0] as unknown[]) || [])], ...raw.slice(1)] as unknown[][];
          const detectedType = detectSheetType(rawWithHint, file.name, sheetName);
          const contentOnly = detectSheetTypeFromContent(rawWithHint);

          // Prefer the Upload P&L / BS / CF button, but do not force a clearly different
          // statement sheet into that bucket (e.g. Balance Sheet overwriting P&L on a
          // multi-sheet workbook). CF keeps a special case: sheets with "Net Income" are
          // often misclassified as P&L.
          let effectiveType: 'pl' | 'bs' | 'cf' | 'unknown' = detectedType;
          if (options.hintType) {
            if (contentOnly !== 'unknown' && contentOnly !== options.hintType) {
              const cfNetIncomeConfusion = options.hintType === 'cf' && contentOnly === 'pl';
              if (!cfNetIncomeConfusion) {
                parseNotes.push(
                  `Sheet "${sheetName}": skipped (looks like ${contentOnly.toUpperCase()}, upload button is ${options.hintType.toUpperCase()})`,
                );
                continue;
              }
              parseNotes.push(
                `Sheet "${sheetName}": treating as CF (button) even though content looked like P&L`,
              );
            }
            effectiveType = options.hintType;
          } else if (detectedType === 'unknown') {
            parseNotes.push(`Sheet "${sheetName}": skipped (could not detect P&L / Balance Sheet / Cash Flow)`);
            continue;
          }

          const monthInfoRaw = detectMonthlyHeaders(ws, raw);
          const yearInfo = detectYearHeaders(ws, raw);
          // Particulars / 2025 / 2024 annual sheets often also have "Jan 2025 … Dec 2025" in
          // the title — that must not win over the real year columns.
          let monthInfo = monthInfoRaw;
          if (
            monthInfoRaw
            && yearInfo
            && (yearInfo.hasParticulars || yearInfo.yearCols.length >= 2)
            && (monthlyHeadersLookLikeTitle(monthInfoRaw) || yearInfo.hasParticulars)
          ) {
            parseNotes.push(
              `Sheet "${sheetName}": preferring Particulars/year columns over title month dates`,
            );
            monthInfo = null;
          }
          if (!monthInfo && !yearInfo) {
            parseNotes.push(`Sheet "${sheetName}": no month/year column headers found`);
            continue;
          }

          const name = getCompanyName(raw);
          if (name && !detectedName) detectedName = name;
          if (!dateRange) {
            dateRange = monthInfo
              ? getDateRange(raw, monthInfo.monthCols)
              : getDateRange(raw);
          }

          let items: ParsedFinItem[];
          let years: number[];

          if (monthInfo) {
            years = monthInfo.years;
            const sortedMC = [...monthInfo.monthCols].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
            const allPeriods = sortedMC.map(mc => `${MONTH_DISPLAY[mc.month]} ${mc.year}`);
            if (!detectedPeriods.length) detectedPeriods = allPeriods;
            const monthValueCols = monthInfo.monthCols.map(mc => mc.col);
            const categoryCol = findCategoryCol(
              raw,
              monthInfo.headerRowIdx,
              monthValueCols,
            );
            const totalCol = findTotalCol(
              raw,
              monthInfo.headerRowIdx,
              [...monthValueCols, ...(categoryCol != null ? [categoryCol] : []), monthInfo.labelCol],
            );
            if (categoryCol != null) {
              if (effectiveType === 'pl' || effectiveType === 'cf') {
                parseNotes.push(
                  `Sheet "${sheetName}": Category column — keeping only rows with a Category (blank Category lines dropped)`,
                );
              } else {
                parseNotes.push(
                  `Sheet "${sheetName}": rolling up ${effectiveType.toUpperCase()} detail lines by category column (duplicates summed)`,
                );
              }
            }
            if (totalCol != null) {
              parseNotes.push(
                `Sheet "${sheetName}": Total column used when month cells are empty`,
              );
            }
            items = parseSheetRowsMonthly(
              raw,
              monthInfo.headerRowIdx,
              monthInfo.monthCols,
              years,
              effectiveType,
              monthInfo.labelCol,
              categoryCol,
              totalCol,
            );
          } else {
            years = yearInfo!.yearCols.map(yc => yc.year).sort((a, b) => a - b);
            const yearValueCols = yearInfo!.yearCols.map(yc => yc.col);
            const categoryCol = findCategoryCol(
              raw,
              yearInfo!.headerRowIdx,
              yearValueCols,
            );
            const totalCol = findTotalCol(
              raw,
              yearInfo!.headerRowIdx,
              [...yearValueCols, ...(categoryCol != null ? [categoryCol] : []), yearInfo!.labelCol],
            );
            if (categoryCol != null) {
              if (effectiveType === 'pl' || effectiveType === 'cf') {
                parseNotes.push(
                  `Sheet "${sheetName}": Category column — keeping only rows with a Category (blank Category lines dropped)`,
                );
              } else {
                parseNotes.push(
                  `Sheet "${sheetName}": rolling up ${effectiveType.toUpperCase()} detail lines by category column (duplicates summed)`,
                );
              }
            }
            if (totalCol != null) {
              parseNotes.push(
                `Sheet "${sheetName}": Total column used when year cells are empty`,
              );
            }
            items = parseSheetRows(
              raw,
              yearInfo!.headerRowIdx,
              yearInfo!.yearCols,
              yearInfo!.labelCol,
              categoryCol,
              effectiveType,
              totalCol,
            );
          }

          // Drop blank label placeholders that some Particulars exports leave between sections.
          items = items.filter(i => i.label.trim() !== '' || i.isTotal || i.isNetIncome);

          if (!items.length) {
            parseNotes.push(`Sheet "${sheetName}": headers found but no data rows`);
            continue;
          }

          const assigned = assignItems(effectiveType, items, years, state);
          if (!assigned) {
            parseNotes.push(`Sheet "${sheetName}": skipped (already have ${effectiveType.toUpperCase()} from an earlier sheet)`);
            continue;
          }
          parseNotes.push(`Sheet "${sheetName}": ${items.length} rows → ${effectiveType}`);
        }

        resolve({
          companyName: detectedName || companyName,
          dateRange,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          years: state.detectedYears,
          periods: detectedPeriods,
          pl: state.plItems,
          bs: state.bsItems,
          cf: state.cfItems,
          parseNotes,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
