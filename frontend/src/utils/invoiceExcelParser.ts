/**
 * Consultancy Billing & Collections — invoice roster Excel parser.
 * Simple flat-table parser (client/date/amount columns), unlike financialExcelParser's
 * P&L/BS/CF statement-structure parsing — invoices are one row per record, not a
 * label-indented statement, so header-name matching is all that's needed.
 */
import * as XLSX from 'xlsx';

export interface ParsedInvoiceRow {
  client_name: string;
  invoice_date: string; // ISO yyyy-mm-dd
  amount: number;
  due_date: string | null;
  collected_amount: number;
  collected_date: string | null;
  standard_rate_amount: number | null;
}

export interface ParsedInvoiceWorkbook {
  fileName: string;
  rows: ParsedInvoiceRow[];
  parseNotes: string[];
}

const HEADER_PATTERNS: Record<string, RegExp> = {
  client_name: /^(client|client\s*name|customer|customer\s*name)$/i,
  invoice_date: /^(invoice\s*date|date)$/i,
  amount: /^(amount|billed\s*amount|invoice\s*amount)$/i,
  due_date: /^due\s*date$/i,
  collected_amount: /^(collected\s*amount|amount\s*collected|paid\s*amount|amount\s*paid)$/i,
  collected_date: /^(collected\s*date|payment\s*date|paid\s*date|date\s*paid)$/i,
  standard_rate_amount: /^(standard\s*rate\s*amount|standard\s*rate|rate\s*amount|standard\s*billing\s*rate)$/i,
};

function toIsoDate(cell: unknown): string | null {
  if (cell === '' || cell === null || cell === undefined) return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return cell.toISOString().slice(0, 10);
  }
  const str = String(cell).trim();
  if (!str) return null;
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function toNumber(cell: unknown): number {
  if (cell === '' || cell === null || cell === undefined) return 0;
  if (typeof cell === 'number') return cell;
  const cleaned = String(cell).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Find the header row (within the first 10 rows) that has at least client_name/invoice_date/amount columns. */
function findHeaderRow(raw: unknown[][]): { rowIdx: number; colMap: Record<string, number> } | null {
  const limit = Math.min(raw.length, 10);
  for (let r = 0; r < limit; r++) {
    const row = raw[r] || [];
    const colMap: Record<string, number> = {};
    row.forEach((cell, c) => {
      const str = String(cell ?? '').trim();
      if (!str) return;
      for (const [field, pattern] of Object.entries(HEADER_PATTERNS)) {
        if (pattern.test(str) && colMap[field] === undefined) colMap[field] = c;
      }
    });
    if (colMap.client_name !== undefined && colMap.invoice_date !== undefined && colMap.amount !== undefined) {
      return { rowIdx: r, colMap };
    }
  }
  return null;
}

export function parseInvoiceExcel(file: File): Promise<ParsedInvoiceWorkbook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const parseNotes: string[] = [];
        const rows: ParsedInvoiceRow[] = [];

        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
          const header = findHeaderRow(raw);
          if (!header) {
            parseNotes.push(`Sheet "${sheetName}": no recognizable Client/Invoice Date/Amount columns found`);
            continue;
          }
          const { rowIdx, colMap } = header;
          for (let r = rowIdx + 1; r < raw.length; r++) {
            const row = raw[r] || [];
            const clientName = String(row[colMap.client_name] ?? '').trim();
            const invoiceDate = toIsoDate(row[colMap.invoice_date]);
            if (!clientName || !invoiceDate) continue;
            rows.push({
              client_name: clientName,
              invoice_date: invoiceDate,
              amount: toNumber(row[colMap.amount]),
              due_date: colMap.due_date !== undefined ? toIsoDate(row[colMap.due_date]) : null,
              collected_amount: colMap.collected_amount !== undefined ? toNumber(row[colMap.collected_amount]) : 0,
              collected_date: colMap.collected_date !== undefined ? toIsoDate(row[colMap.collected_date]) : null,
              standard_rate_amount: colMap.standard_rate_amount !== undefined
                ? toNumber(row[colMap.standard_rate_amount]) || null
                : null,
            });
          }
        }

        if (!rows.length && !parseNotes.length) {
          parseNotes.push('No invoice rows found in this file.');
        }
        resolve({ fileName: file.name, rows, parseNotes });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to parse invoice Excel file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
