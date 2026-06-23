import { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, ChevronDown, ChevronRight, Sparkles, X,
  AlertTriangle, CheckCircle, Building2, FileSpreadsheet,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ParsedRow {
  particulars: string;
  noteNo: string;
  current: number;
  prior: number;
  isHeader: boolean;
  isTotal: boolean;
  isSubtotal: boolean;
  isProfit: boolean;
}

interface CompanyFinancials {
  companyName: string;
  period: string;
  fileName: string;
  uploadedAt: string;
  hasRefErrors: boolean;
  pl: ParsedRow[];
  bs: ParsedRow[];
  schedulesBs: ParsedRow[];
  schedulesPl: ParsedRow[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const COMPANIES = [
  'All Companies',
  'Lone Star Holdings I',
  'Lone Star Holdings II',
  'Bluebonnet Rentals',
  'Hill Country Props',
  'Trinity Units LLC',
  'Brazos Portfolio',
  'Alamo Residential',
  'Pecan Grove LLC',
  'Gulf Coast Homes',
  'Red River Rentals',
];

const PERIODS = ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026', 'FY 2025', 'FY 2026'];

// ── Parsing ────────────────────────────────────────────────────────────────────

function parseValue(v: unknown): { value: number; hasError: boolean } {
  if (v === null || v === undefined || v === '') return { value: 0, hasError: false };
  if (typeof v === 'number') return { value: v, hasError: false };
  const s = String(v).trim();
  if (s.startsWith('#') || s === 'N/A') return { value: 0, hasError: true };
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return { value: isNaN(n) ? 0 : n, hasError: false };
}

function classifyRow(particulars: string) {
  const p = particulars.trim().toUpperCase();
  const isTotal =
    p.startsWith('TOTAL') ||
    p === 'GRAND TOTAL' ||
    p.includes('TOTAL INCOME') ||
    p.includes('TOTAL EXPENSE') ||
    p.includes('TOTAL REVENUE');
  const isSubtotal =
    !isTotal && (p.includes('TOTAL') || p.startsWith('SUB-TOTAL') || p.startsWith('SUBTOTAL'));
  const isAllCaps =
    particulars.trim().length > 2 &&
    particulars.trim() === particulars.trim().toUpperCase() &&
    !/\d/.test(particulars);
  const isHeader = isAllCaps && !isTotal && !isSubtotal;
  const isProfit =
    p.includes('PROFIT') ||
    p.includes('LOSS') ||
    p.includes('NET INCOME') ||
    p.includes('PBT') ||
    p.includes('PAT') ||
    p.includes('EBITDA');
  return { isHeader, isTotal, isSubtotal, isProfit };
}

function parseSheet(wb: XLSX.WorkBook, sheetName: string): { rows: ParsedRow[]; hasErrors: boolean } {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { rows: [], hasErrors: false };

  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  let hasErrors = false;

  let headerIdx = 0;
  for (let i = 0; i < Math.min(raw.length, 20); i++) {
    const row = raw[i] as unknown[];
    const joined = row.map(c => String(c).toLowerCase()).join(' ');
    if (joined.includes('particular') || joined.includes('description') || joined.includes('items')) {
      headerIdx = i;
      break;
    }
  }

  const rows: ParsedRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const particulars = String(row[0] ?? '').trim();
    if (!particulars) continue;

    const noteNo = String(row[1] ?? '').trim();
    const curr = parseValue(row[2]);
    const prior = parseValue(row[3]);
    if (curr.hasError || prior.hasError) hasErrors = true;

    const { isHeader, isTotal, isSubtotal, isProfit } = classifyRow(particulars);
    rows.push({
      particulars,
      noteNo,
      current: curr.value,
      prior: prior.value,
      isHeader,
      isTotal,
      isSubtotal,
      isProfit,
    });
  }
  return { rows, hasErrors };
}

function parseExcel(file: File, companyName: string, period: string): Promise<CompanyFinancials> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false });

        const pl = parseSheet(wb, 'P&L');
        const bs = parseSheet(wb, 'B-S');
        const schedBs = parseSheet(wb, 'Schedules BS');
        const schedPl = parseSheet(wb, 'Schedules PL');

        resolve({
          companyName,
          period,
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          hasRefErrors: pl.hasErrors || bs.hasErrors || schedBs.hasErrors || schedPl.hasErrors,
          pl: pl.rows,
          bs: bs.rows,
          schedulesBs: schedBs.rows,
          schedulesPl: schedPl.rows,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtAmt(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s =
    abs >= 1_000_000
      ? `$${(abs / 1_000_000).toFixed(2)}M`
      : abs >= 1_000
      ? `$${(abs / 1_000).toFixed(1)}K`
      : `$${abs.toLocaleString()}`;
  return n < 0 ? `(${s})` : s;
}

function variance(current: number, prior: number) {
  const diff = current - prior;
  const pct = prior !== 0 ? ((diff / Math.abs(prior)) * 100).toFixed(1) : null;
  return {
    dollar: diff === 0 ? '—' : diff > 0 ? `+${fmtAmt(diff)}` : fmtAmt(diff),
    pct: pct !== null ? (diff >= 0 ? `+${pct}%` : `${pct}%`) : '—',
    positive: diff >= 0,
  };
}

// ── Row styling ────────────────────────────────────────────────────────────────

function rowCls(row: ParsedRow): string {
  if (row.isTotal) return 'bg-gray-900 text-white font-bold';
  if (row.isSubtotal) return 'bg-gray-100 font-semibold text-gray-800 border-t border-gray-300';
  if (row.isHeader) return 'bg-gray-50 text-gray-600 font-bold text-xs uppercase tracking-wider';
  if (row.isProfit) return 'bg-emerald-50 font-semibold text-emerald-900 border-t border-emerald-200';
  return 'text-gray-700 hover:bg-gray-50/50';
}

// ── Statement Table ────────────────────────────────────────────────────────────

function StatementTable({
  rows,
  title,
  showVariance = true,
}: {
  rows: ParsedRow[];
  title: string;
  showVariance?: boolean;
}) {
  if (rows.length === 0)
    return <p className="text-gray-400 text-sm py-6 text-center">No data parsed from "{title}" sheet</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
        <thead>
          <tr className="border-b-2 border-gray-400">
            <th className="text-left py-2 px-3 text-gray-600 font-semibold w-5/12">Particulars</th>
            <th className="text-center py-2 px-2 text-gray-500 font-medium w-12 text-xs">Note</th>
            <th className="text-right py-2 px-3 text-gray-600 font-semibold">Current Period</th>
            <th className="text-right py-2 px-3 text-gray-600 font-semibold">Prior Period</th>
            {showVariance && (
              <th className="text-right py-2 px-3 text-gray-600 font-semibold w-28">Variance</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const v = variance(row.current, row.prior);
            return (
              <tr key={i} className={`border-b border-gray-100 transition-colors ${rowCls(row)}`}>
                <td className={`py-1.5 px-3 ${row.isHeader || row.isTotal ? '' : 'pl-7'}`}>
                  {row.particulars}
                </td>
                <td className="py-1.5 px-2 text-center text-xs" style={{ color: '#B8860B' }}>
                  {row.noteNo}
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums">{fmtAmt(row.current)}</td>
                <td className={`py-1.5 px-3 text-right tabular-nums ${row.isTotal ? 'text-gray-300' : 'text-gray-500'}`}>
                  {fmtAmt(row.prior)}
                </td>
                {showVariance && (
                  <td className="py-1.5 px-3 text-right tabular-nums text-xs">
                    <span className={v.positive ? 'text-green-600' : 'text-red-600'}>
                      {v.dollar}
                    </span>
                    <br />
                    <span className={`text-xs ${v.positive ? 'text-green-500' : 'text-red-500'}`}>
                      {v.pct}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Balance Sheet split layout ─────────────────────────────────────────────────

function BSSplit({ rows }: { rows: ParsedRow[] }) {
  if (rows.length === 0)
    return <p className="text-gray-400 text-sm py-6 text-center">No data parsed from "B-S" sheet</p>;

  // Find where ASSETS section starts
  const assetIdx = rows.findIndex(
    (r) => r.isHeader && /\bASSET/i.test(r.particulars)
  );

  const liabRows = assetIdx > 0 ? rows.slice(0, assetIdx) : rows;
  const assetRows = assetIdx > 0 ? rows.slice(assetIdx) : [];

  const totalLiab = liabRows.filter((r) => r.isTotal).reduce((s, r) => s + r.current, 0);
  const totalAssets = assetRows.filter((r) => r.isTotal).reduce((s, r) => s + r.current, 0);
  const isBalanced = assetRows.length > 0 && Math.abs(totalLiab - totalAssets) < 1;

  const HalfTable = ({ half, label }: { half: ParsedRow[]; label: string }) => (
    <div>
      <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 border-b border-gray-200 pb-1">
        {label}
      </div>
      <table className="w-full text-sm" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-1 px-2 text-gray-500 text-xs">Particulars</th>
            <th className="text-right py-1 px-2 text-gray-500 text-xs">Current</th>
            <th className="text-right py-1 px-2 text-gray-500 text-xs">Prior</th>
          </tr>
        </thead>
        <tbody>
          {half.map((row, i) => (
            <tr key={i} className={`border-b border-gray-50 transition-colors ${rowCls(row)}`}>
              <td className={`py-1 px-2 text-xs ${row.isHeader || row.isTotal ? '' : 'pl-5'}`}>
                {row.particulars}
              </td>
              <td className="py-1 px-2 text-right tabular-nums text-xs">{fmtAmt(row.current)}</td>
              <td className={`py-1 px-2 text-right tabular-nums text-xs ${row.isTotal ? 'text-gray-300' : 'text-gray-400'}`}>
                {fmtAmt(row.prior)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      {assetRows.length > 0 ? (
        <div className="grid grid-cols-2 gap-8">
          <HalfTable half={liabRows} label="Equity & Liabilities" />
          <HalfTable half={assetRows} label="Assets" />
        </div>
      ) : (
        <StatementTable rows={rows} title="B-S" showVariance={false} />
      )}
      <div
        className={`mt-4 flex items-center gap-2 text-sm font-medium ${
          isBalanced ? 'text-emerald-600' : 'text-red-600'
        }`}
      >
        {isBalanced ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
        {isBalanced
          ? 'Balance Sheet is Balanced'
          : `Out of balance — Liabilities: ${fmtAmt(totalLiab)}, Assets: ${fmtAmt(totalAssets)}`}
      </div>
    </div>
  );
}

// ── Schedules ──────────────────────────────────────────────────────────────────

function SchedulesSection({ bsRows, plRows }: { bsRows: ParsedRow[]; plRows: ParsedRow[] }) {
  const [open, setOpen] = useState(false);
  const all = [...bsRows, ...plRows];
  if (all.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="font-semibold text-gray-800">Schedules & Notes to Financial Statements</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div className="border-t border-gray-100 p-4 space-y-6">
          {bsRows.length > 0 && (
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                Balance Sheet Schedules
              </div>
              <StatementTable rows={bsRows} title="Schedules BS" showVariance={false} />
            </div>
          )}
          {plRows.length > 0 && (
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                P&L Schedules
              </div>
              <StatementTable rows={plRows} title="Schedules PL" showVariance={false} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Multi-company comparison ───────────────────────────────────────────────────

function ComparisonTable({ all }: { all: Record<string, CompanyFinancials> }) {
  const entries = Object.values(all);
  if (entries.length < 2)
    return (
      <p className="text-gray-400 text-sm text-center py-8">
        Upload financials for at least 2 companies to see the comparison
      </p>
    );

  const metric = (fin: CompanyFinancials, key: string): number => {
    const rows = key === 'assets' ? fin.bs : fin.pl;
    if (key === 'revenue')
      return rows.find((r) => r.isTotal && /INCOME|REVENUE/i.test(r.particulars))?.current ?? 0;
    if (key === 'expenses')
      return rows.find((r) => r.isTotal && /EXPENSE/i.test(r.particulars))?.current ?? 0;
    if (key === 'profit')
      return rows.find((r) => r.isProfit || (r.isTotal && /PROFIT|LOSS/i.test(r.particulars)))?.current ?? 0;
    if (key === 'assets')
      return rows.find((r) => r.isTotal)?.current ?? 0;
    return 0;
  };

  const best = (vals: number[]) => Math.max(...vals);
  const worst = (vals: number[]) => Math.min(...vals);

  const revenues = entries.map((e) => metric(e, 'revenue'));
  const profits = entries.map((e) => metric(e, 'profit'));
  const assets = entries.map((e) => metric(e, 'assets'));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {['Company', 'Revenue', 'Total Expenses', 'Net Profit', 'Margin %', 'Total Assets', 'Period'].map(
              (h) => (
                <th key={h} className="py-3 px-4 text-left font-semibold text-gray-700 text-xs uppercase">
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {entries.map((fin, i) => {
            const rev = revenues[i];
            const exp = metric(fin, 'expenses');
            const pft = profits[i];
            const ast = assets[i];
            const margin = rev > 0 ? ((pft / rev) * 100).toFixed(1) : null;
            return (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="py-3 px-4 font-medium text-gray-900">{fin.companyName}</td>
                <td className={`py-3 px-4 tabular-nums font-medium ${rev === best(revenues) ? 'text-emerald-600' : ''}`}>
                  {fmtAmt(rev)}
                </td>
                <td className="py-3 px-4 tabular-nums text-red-600">{fmtAmt(exp)}</td>
                <td
                  className={`py-3 px-4 tabular-nums font-semibold ${
                    pft === best(profits) ? 'text-emerald-600' : pft === worst(profits) ? 'text-red-600' : 'text-gray-800'
                  }`}
                >
                  {fmtAmt(pft)}
                </td>
                <td
                  className={`py-3 px-4 ${
                    margin !== null && parseFloat(margin) > 15 ? 'text-emerald-600' : 'text-gray-700'
                  }`}
                >
                  {margin !== null ? `${margin}%` : '—'}
                </td>
                <td className="py-3 px-4 tabular-nums text-gray-700">{fmtAmt(ast)}</td>
                <td className="py-3 px-4 text-gray-400 text-xs">{fin.period}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── AI Insights Modal ──────────────────────────────────────────────────────────

function AIInsightsModal({ fin, onClose }: { fin: CompanyFinancials; onClose: () => void }) {
  const revenue = fin.pl.find((r) => r.isTotal && /INCOME|REVENUE/i.test(r.particulars))?.current ?? 0;
  const priorRevenue = fin.pl.find((r) => r.isTotal && /INCOME|REVENUE/i.test(r.particulars))?.prior ?? 0;
  const expenses = fin.pl.find((r) => r.isTotal && /EXPENSE/i.test(r.particulars))?.current ?? 0;
  const profit =
    fin.pl.find((r) => r.isProfit || (r.isTotal && /PROFIT|LOSS/i.test(r.particulars)))?.current ?? 0;
  const priorProfit =
    fin.pl.find((r) => r.isProfit || (r.isTotal && /PROFIT|LOSS/i.test(r.particulars)))?.prior ?? 0;
  const totalAssets = fin.bs.find((r) => r.isTotal)?.current ?? 0;

  const margin = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '—';
  const revGrowth =
    priorRevenue > 0 ? (((revenue - priorRevenue) / priorRevenue) * 100).toFixed(1) : null;
  const profitGrowth =
    priorProfit !== 0 ? (((profit - priorProfit) / Math.abs(priorProfit)) * 100).toFixed(1) : null;
  const expRatio = revenue > 0 ? ((expenses / revenue) * 100).toFixed(1) : '—';

  const topExpenses = fin.pl
    .filter((r) => !r.isHeader && !r.isTotal && !r.isSubtotal && r.current > 0)
    .sort((a, b) => b.current - a.current)
    .slice(0, 4);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles size={20} className="text-amber-500" />
            <h2 className="text-lg font-bold text-gray-900">AI Financial Insights</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6 text-sm">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <div className="font-semibold text-blue-900">{fin.companyName}</div>
            <div className="text-blue-700 text-xs mt-0.5">Period: {fin.period}</div>
          </div>

          {/* KPI summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Revenue', value: fmtAmt(revenue), sub: revGrowth ? `${Number(revGrowth) >= 0 ? '▲' : '▼'} ${revGrowth}% YoY` : '' },
              { label: 'Net Profit', value: fmtAmt(profit), sub: `${margin}% margin` },
              { label: 'Total Assets', value: fmtAmt(totalAssets), sub: '' },
            ].map((k) => (
              <div key={k.label} className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500 mb-1">{k.label}</div>
                <div className="font-bold text-gray-900">{k.value}</div>
                {k.sub && <div className="text-xs text-gray-500 mt-0.5">{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* 1 Revenue */}
          <div>
            <div className="font-semibold text-gray-800 mb-2">1. Revenue & Profitability</div>
            <p className="text-gray-700 leading-relaxed">
              Total revenue is <strong>{fmtAmt(revenue)}</strong>
              {revGrowth && (
                <>, representing a <strong className={Number(revGrowth) >= 0 ? 'text-emerald-600' : 'text-red-600'}>{revGrowth}%</strong> change vs prior period ({fmtAmt(priorRevenue)})</>
              )}
              . Net profit of <strong className={profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtAmt(profit)}</strong> yields a <strong>{margin}%</strong> margin
              {profitGrowth && <> ({Number(profitGrowth) >= 0 ? '▲' : '▼'} {profitGrowth}% YoY)</>}.
              {profit < 0 && <span className="text-red-600 font-medium"> The entity is operating at a loss — immediate cost review is recommended.</span>}
              {Number(margin) > 20 && <span className="text-emerald-600 font-medium"> Profit margin above 20% signals healthy operations.</span>}
            </p>
          </div>

          {/* 2 Expenses */}
          <div>
            <div className="font-semibold text-gray-800 mb-2">2. Key Expense Categories</div>
            <p className="text-gray-700 leading-relaxed mb-2">
              Total expenses: <strong>{fmtAmt(expenses)}</strong> ({expRatio}% of revenue).
            </p>
            {topExpenses.length > 0 && (
              <ul className="space-y-1">
                {topExpenses.map((e, i) => (
                  <li key={i} className="flex justify-between text-gray-700 border-b border-gray-100 pb-1">
                    <span>{e.particulars}</span>
                    <span className="font-medium">{fmtAmt(e.current)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 3 Balance Sheet */}
          {totalAssets > 0 && (
            <div>
              <div className="font-semibold text-gray-800 mb-2">3. Balance Sheet Strength</div>
              <p className="text-gray-700">Total assets stand at <strong>{fmtAmt(totalAssets)}</strong>. Review debt-to-equity ratio and ensure long-term loans are within serviceable limits.</p>
            </div>
          )}

          {/* 4 YoY */}
          <div>
            <div className="font-semibold text-gray-800 mb-2">4. YoY Performance</div>
            <p className="text-gray-700">
              {revGrowth
                ? `Revenue ${Number(revGrowth) >= 0 ? 'grew' : 'declined'} by ${revGrowth}% year-on-year. `
                : 'Prior period data not available for YoY comparison. '}
              {profitGrowth
                ? `Profit ${Number(profitGrowth) >= 0 ? 'improved' : 'declined'} by ${profitGrowth}% vs prior period.`
                : ''}
            </p>
          </div>

          {/* 5 Risks */}
          <div>
            <div className="font-semibold text-gray-800 mb-2">5. Risks & Recommendations</div>
            <ul className="space-y-1.5 text-gray-700">
              {fin.hasRefErrors && (
                <li className="flex gap-2"><span className="text-red-500 mt-0.5">⚠</span> Fix #REF! formula errors in the source Excel — they may understate true figures.</li>
              )}
              {Number(expRatio) > 80 && (
                <li className="flex gap-2"><span className="text-amber-500 mt-0.5">⚠</span> Expense ratio ({expRatio}%) exceeds 80% of revenue — identify cost reduction opportunities.</li>
              )}
              {profit < 0 && (
                <li className="flex gap-2"><span className="text-red-500 mt-0.5">⚠</span> Operating at a net loss. Review rent pricing and vacancy rates immediately.</li>
              )}
              {Number(margin) < 10 && profit >= 0 && (
                <li className="flex gap-2"><span className="text-amber-500 mt-0.5">⚠</span> Profit margin below 10%. Consider rent escalation clauses in lease renewals.</li>
              )}
              <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">✓</span> Benchmark expense ratios against industry standard (35–45% for residential rentals).</li>
              <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">✓</span> Review finance costs and insurance premiums for renegotiation opportunity.</li>
              <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">✓</span> Ensure all loan covenants are met based on current balance sheet position.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState({ onUpload, company }: { onUpload: () => void; company: string }) {
  return (
    <div className="text-center py-24">
      <FileSpreadsheet size={72} className="mx-auto text-gray-200 mb-6" />
      <h2 className="text-2xl font-bold text-gray-700 mb-3">Upload Financial Statements</h2>
      <p className="text-gray-400 mb-2 max-w-lg mx-auto">
        {company === 'All Companies'
          ? 'Select a specific company from the dropdown, then upload their Excel financial statements.'
          : `Upload ${company}'s Excel file to render their P&L, Balance Sheet, and Schedule notes.`}
      </p>
      <p className="text-gray-400 text-sm mb-8">
        Expected sheets:&nbsp;
        {['B-S', 'P&L', 'Schedules BS', 'Schedules PL'].map((s) => (
          <span key={s} className="font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded mr-1">{s}</span>
        ))}
      </p>
      <button
        onClick={onUpload}
        className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-xl font-semibold transition-colors shadow-sm"
      >
        <Upload size={18} /> Upload Excel File
      </button>

      {/* Preview mockup */}
      <div className="mt-12 max-w-2xl mx-auto border border-dashed border-gray-200 rounded-2xl p-6 text-left opacity-40">
        <div className="h-3 bg-gray-200 rounded w-48 mb-4" />
        {[80, 60, 90, 55, 70].map((w, i) => (
          <div key={i} className="flex gap-4 mb-2">
            <div className="h-2.5 bg-gray-200 rounded flex-1" />
            <div className={`h-2.5 bg-gray-200 rounded w-${w === 80 ? '16' : '12'}`} />
            <div className="h-2.5 bg-gray-200 rounded w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function RentalFinancials() {
  const [selectedCompany, setSelectedCompany] = useState('All Companies');
  const [selectedPeriod, setSelectedPeriod] = useState('Q1 2026');
  const [allFinancials, setAllFinancials] = useState<Record<string, CompanyFinancials>>({});
  const [uploading, setUploading] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentFin = selectedCompany !== 'All Companies' ? allFinancials[selectedCompany] : null;
  const hasAnyUpload = Object.keys(allFinancials).length > 0;
  const isAllCompanies = selectedCompany === 'All Companies';

  const triggerUpload = useCallback(() => {
    if (isAllCompanies) {
      alert('Please select a specific company before uploading.');
      return;
    }
    fileRef.current?.click();
  }, [isAllCompanies]);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (isAllCompanies) { alert('Please select a specific company first.'); return; }
      setUploading(true);
      try {
        const fin = await parseExcel(file, selectedCompany, selectedPeriod);
        setAllFinancials((prev) => ({ ...prev, [selectedCompany]: fin }));
      } catch {
        alert('Failed to parse the Excel file. Please check the file format and try again.');
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [isAllCompanies, selectedCompany, selectedPeriod]
  );

  return (
    <div className="space-y-6">
      {/* ── Sticky controls ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 shadow-sm -mx-6 px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-gray-400" />
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {COMPANIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {PERIODS.map((p) => <option key={p}>{p}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          <button
            onClick={triggerUpload}
            disabled={uploading}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Upload size={14} />
            {uploading ? 'Parsing…' : 'Upload Excel'}
          </button>
          {currentFin && (
            <button
              onClick={() => setShowAI(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Sparkles size={14} /> AI Insights
            </button>
          )}
          {currentFin && (
            <span className="text-xs text-gray-400 ml-auto hidden sm:block">
              {currentFin.fileName} · {new Date(currentFin.uploadedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {isAllCompanies ? (
        hasAnyUpload ? (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">All Companies — Financial Comparison</h2>
            <p className="text-gray-400 text-sm mb-6">{Object.keys(allFinancials).length} companies uploaded</p>
            <ComparisonTable all={allFinancials} />
          </div>
        ) : (
          <EmptyState onUpload={triggerUpload} company="All Companies" />
        )
      ) : currentFin ? (
        <div className="space-y-6">
          {/* Header card */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{currentFin.companyName}</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                Financial Statements · Period: <strong>{currentFin.period}</strong>
              </p>
            </div>
            {currentFin.hasRefErrors && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-2 rounded-lg text-sm shrink-0">
                <AlertTriangle size={14} />
                Formula errors found — affected values set to 0
              </div>
            )}
          </div>

          {/* 01 P&L */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-emerald-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                1
              </span>
              Profit & Loss Statement
            </h2>
            <StatementTable rows={currentFin.pl} title="P&L" />
          </div>

          {/* 02 Balance Sheet */}
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                2
              </span>
              Balance Sheet
            </h2>
            <BSSplit rows={currentFin.bs} />
          </div>

          {/* 03 Schedules */}
          {(currentFin.schedulesBs.length > 0 || currentFin.schedulesPl.length > 0) && (
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6">
              <h2 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                <span className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                  3
                </span>
                Schedules & Notes
              </h2>
              <SchedulesSection bsRows={currentFin.schedulesBs} plRows={currentFin.schedulesPl} />
            </div>
          )}
        </div>
      ) : (
        <EmptyState onUpload={triggerUpload} company={selectedCompany} />
      )}

      {/* AI modal */}
      {showAI && currentFin && (
        <AIInsightsModal fin={currentFin} onClose={() => setShowAI(false)} />
      )}
    </div>
  );
}
