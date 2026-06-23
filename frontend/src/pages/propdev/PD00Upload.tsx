import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X,
  ChevronDown, ChevronRight, ArrowRight,
} from 'lucide-react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Loan, Partner, CapitalCall, Property } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';

interface ParsedSheet {
  name: string;
  rows: Record<string, string | number>[];
  detected: string;
}

// ── Sheet type detection ──────────────────────────────────────────────────────

function detectSheetType(name: string, rows: Record<string, string | number>[]): string {
  const n = name.toLowerCase();
  const allText = JSON.stringify(rows).toLowerCase();
  if (n.includes('annexure i') || n.includes('deal') || (n.includes('p') && n.includes('l') && !n.includes('partner')))
    return 'Deal P&L (Annexure I)';
  if (n.includes('annexure ii') || n.includes('partner') || allText.includes('roi'))
    return 'Partner Summary (Annexure II)';
  if (n.includes('capital') || n.includes('call'))
    return 'Capital Call Sheet';
  if (n.includes('loan') || allText.includes('maturity'))
    return 'Loan Sheet';
  if (n.includes('expense') || allText.includes('plumbing') || allText.includes('electrical'))
    return 'Expense Dashboard';
  return 'Unknown';
}

function parseExcelFile(file: File): Promise<ParsedSheet[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'binary' });
        const sheets: ParsedSheet[] = wb.SheetNames.map(name => {
          const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets[name], { defval: '' });
          return { name, rows, detected: detectSheetType(name, rows) };
        }).filter(s => s.rows.length > 0);
        resolve(sheets);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// ── Data extractors — turn raw rows into typed context objects ───────────────

function extractProperty(rows: Record<string, string | number>[], base: Property): Property {
  const find = (keywords: string[]): number => {
    for (const row of rows) {
      const desc = String(Object.values(row)[0] ?? '').toLowerCase();
      if (keywords.some(k => desc.includes(k))) {
        const nums = Object.values(row).map(v => Number(v)).filter(v => !isNaN(v) && v > 0);
        if (nums.length > 0) return nums[nums.length - 1]; // last numeric column
      }
    }
    return 0;
  };

  const saleConsideration = find(['sale consideration']) || base.saleConsideration;
  const landCost          = find(['land cost'])          || base.landCost;
  const hardCost          = find(['hard cost', 'construction', 'hard/soft']) || base.hardCost;
  const softCost          = find(['soft cost', 'engineering', 'architecture']) || base.softCost;
  const managementFee     = find(['management fee'])     || base.managementFee;
  const commission        = find(['commission'])         || base.commission;
  const legalFees         = find(['legal'])              || base.legalFees;
  const interestOnLoan    = find(['interest on loan', 'interest loan']) || base.interestOnLoan;

  return { ...base, saleConsideration, landCost, hardCost, softCost, managementFee, commission, legalFees, interestOnLoan };
}

function extractPartners(rows: Record<string, string | number>[], companyId: string): Partner[] {
  // Try to find rows where column 0 looks like a partner name (non-header, non-empty, non-section)
  const results: Partner[] = [];
  const skipWords = ['partner', 'total', 'name', 'particulars', 'description', ''];
  for (const row of rows) {
    const vals = Object.values(row);
    const name = String(vals[0] ?? '').trim();
    if (!name || skipWords.some(s => name.toLowerCase() === s)) continue;
    const nums = vals.slice(1).map(v => Number(v)).filter(v => !isNaN(v) && v > 0);
    if (nums.length < 2) continue; // need at least share% and capital
    const sharePercent      = nums[0] > 1 ? nums[0] : nums[0] * 100;  // handle % as decimal
    const capitalContributed = nums[1] > 100 ? nums[1] : nums[1] * 1000;
    const shareOfProfit      = nums[2] ?? capitalContributed * 0.18;
    const distributionsReceived = nums[3] ?? 0;
    results.push({
      id: `${companyId}-imp-${results.length + 1}`,
      companyId,
      name,
      type: results.length === 0 ? 'Class B' : 'Class A',
      sharePercent: Math.min(100, sharePercent),
      capitalContributed,
      shareOfProfit,
      distributionsReceived,
      preferredReturn: 8,
      status: 'Active',
    });
  }
  return results.length > 0 ? results : [];
}

function extractLoans(rows: Record<string, string | number>[], companyId: string, companyName: string): Loan[] {
  const results: Loan[] = [];
  for (const row of rows) {
    const vals = Object.values(row);
    const bank = String(vals.find(v => String(v).length > 2 && isNaN(Number(v))) ?? '').trim();
    if (!bank || bank.toLowerCase().includes('bank') && bank.length < 5) continue;
    const nums = vals.map(v => Number(v)).filter(v => !isNaN(v) && v > 0);
    if (nums.length < 2) continue;
    const amount = nums.find(n => n > 100000) ?? 0;
    const rate   = nums.find(n => n > 0 && n < 30) ?? 7.5;
    const emi    = nums.find(n => n > 1000 && n < amount / 10) ?? Math.round(amount * rate / 100 / 12 * 1.15);
    if (!amount) continue;
    results.push({
      id: `${companyId}-loan-imp-${results.length + 1}`,
      companyId, company: companyName,
      property: `${companyName} Property`,
      bank, accountNo: `IMP-${results.length + 1}`, loanDate: '2024-01-01',
      amount, balance: Math.round(amount * 0.85), interestRate: rate, emi,
      maturityDate: '2027-01-01', emiDate: 15,
      lenderName: bank, lenderEmail: `loans@${bank.toLowerCase().replace(/\s/g,'')}.com`, lenderPhone: '+1 555-0000',
      status: 'Active',
    });
  }
  return results;
}

function extractCapitalCalls(rows: Record<string, string | number>[], companyId: string): CapitalCall[] {
  const results: CapitalCall[] = [];
  const skipWords = ['partner', 'total', 'name', ''];
  for (const row of rows) {
    const vals = Object.values(row);
    const name = String(vals[0] ?? '').trim();
    if (!name || skipWords.some(s => name.toLowerCase() === s)) continue;
    const nums = vals.slice(1).map(v => Number(v)).filter(v => !isNaN(v) && v > 0);
    if (nums.length < 2) continue;
    const sharePercent    = nums[0] > 1 ? nums[0] : nums[0] * 100;
    const totalCallAmount = nums[1] > 1000 ? nums[1] : nums[1] * 1000;
    const received        = nums[2] ?? 0;
    const partnerShare    = (sharePercent / 100) * totalCallAmount;
    const balance         = partnerShare - received;
    results.push({
      id: `${companyId}-cc-imp-${results.length + 1}`,
      companyId, period: 'Imported',
      partnerId: `${companyId}-p${results.length + 1}`,
      partnerName: name, sharePercent, totalCallAmount, partnerShare,
      oldDues: 0, totalDue: partnerShare, received,
      receivedDate: received > 0 ? '2025-01-01' : null,
      status: balance <= 0 ? 'Paid' : received > 0 ? 'Partial' : 'Outstanding',
    });
  }
  return results;
}

// ── Sheet Preview ─────────────────────────────────────────────────────────────

function SheetPreview({ sheet }: { sheet: ParsedSheet }) {
  const [expanded, setExpanded] = useState(true);
  const cols = sheet.rows.length > 0 ? Object.keys(sheet.rows[0]) : [];
  const previewRows = sheet.rows.slice(0, 8);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3">
          <FileSpreadsheet size={16} className="text-green-600" />
          <div>
            <span className="font-medium text-gray-900 text-sm">{sheet.name}</span>
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{sheet.detected}</span>
          </div>
          <span className="text-xs text-gray-400">{sheet.rows.length} rows</span>
        </div>
        {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                {cols.slice(0, 8).map(col => (
                  <th key={col} className="px-3 py-2 text-left whitespace-nowrap border-b border-gray-100">
                    {String(col).substring(0, 22)}
                  </th>
                ))}
                {cols.length > 8 && <th className="px-3 py-2 text-gray-400">+{cols.length - 8} more</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {previewRows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {cols.slice(0, 8).map(col => (
                    <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[160px] truncate">
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                  {cols.length > 8 && <td />}
                </tr>
              ))}
              {sheet.rows.length > 8 && (
                <tr>
                  <td colSpan={Math.min(cols.length, 9)} className="px-3 py-2 text-center text-gray-400 italic">
                    … {sheet.rows.length - 8} more rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const EXPECTED_SHEETS = [
  { name: 'Annexure I — Deal P&L',     cols: 'Sale Consideration, Land Cost, Hard/Soft Cost, Management Fee, Commission, Net Profit'  },
  { name: 'Annexure II — Partner Summary', cols: 'Partner Name, % Share, Capital Contributed (A), Share of Profit (B), ROI [B/A]' },
  { name: 'Capital Call Sheet',         cols: 'Partner Name, % Share, Balance Due, Call Amount (6 months), Received Date, Amount'    },
  { name: 'Loan Sheet',                 cols: 'Company, Property, Bank, Loan Date, Account No, Amount, Rate %, EMI, Maturity Date'   },
  { name: 'Expense Dashboard',          cols: 'Expense Type, Amount, Category (Plumbing/Electrical/Materials etc.)'                  },
];

// ── Imported data summary ────────────────────────────────────────────────────

interface ImportSummary {
  dealPL: boolean;
  partners: number;
  loans: number;
  capitalCalls: number;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD00Upload() {
  const { companies, selectedCompanyId, properties, partners: ctxPartners, loans: ctxLoans,
          setProperty, setPartners, setLoans, setCapitalCalls, addUploadRecord, uploadHistory } = usePropDev();
  const { setTab } = usePropDevNav();

  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const targetCompany = selectedCompanyId === 'all'
    ? companies[0]
    : companies.find(c => c.id === selectedCompanyId) ?? companies[0];

  async function handleFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|xlsm)$/i)) {
      setError('Please upload an Excel file (.xlsx, .xls, .xlsm)');
      return;
    }
    setError('');
    setParsing(true);
    setSheets(null);
    setConfirmed(false);
    setSummary(null);
    setFileName(file.name);
    try {
      const result = await parseExcelFile(file);
      setSheets(result);
    } catch {
      setError('Failed to parse Excel file. Make sure it is a valid .xlsx file.');
    } finally {
      setParsing(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleConfirm() {
    if (!sheets) return;
    const cid = targetCompany.id;
    const s: ImportSummary = { dealPL: false, partners: 0, loans: 0, capitalCalls: 0 };

    for (const sheet of sheets) {
      if (sheet.detected === 'Deal P&L (Annexure I)') {
        const updated = extractProperty(sheet.rows, properties[0]);
        setProperty(updated);
        s.dealPL = true;
      }
      if (sheet.detected === 'Partner Summary (Annexure II)') {
        const extracted = extractPartners(sheet.rows, cid);
        if (extracted.length > 0) { setPartners(extracted); s.partners = extracted.length; }
      }
      if (sheet.detected === 'Loan Sheet') {
        const extracted = extractLoans(sheet.rows, cid, targetCompany.name);
        if (extracted.length > 0) { setLoans(extracted); s.loans = extracted.length; }
      }
      if (sheet.detected === 'Capital Call Sheet') {
        const extracted = extractCapitalCalls(sheet.rows, cid);
        if (extracted.length > 0) { setCapitalCalls(extracted); s.capitalCalls = extracted.length; }
      }
    }

    setSummary(s);
    setConfirmed(true);

    // Record this upload in history
    const sheetsImported = sheets.filter(sh => sh.detected !== 'Unknown').map(sh => sh.detected);
    addUploadRecord({
      companyId: targetCompany.id,
      companyName: targetCompany.name,
      fileName,
      uploadDate: new Date().toISOString(),
      sheetsImported,
    });
  }

  const sheetCount = sheets?.length ?? 0;
  const recognizedCount = sheets?.filter(s => s.detected !== 'Unknown').length ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Upload Client Excel Data</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload your Annexure Excel file — data is parsed and written live into the selected company.
        </p>
      </div>

      {/* Target company */}
      <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <CheckCircle2 size={16} className="shrink-0" />
        Uploading to: <strong className="ml-1">{targetCompany.name}</strong>
        {selectedCompanyId === 'all' && <span className="text-blue-500 ml-1">(select a specific company in the top bar to target another)</span>}
      </div>

      {/* Drop Zone */}
      {!sheets && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          }`}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
              <FileSpreadsheet size={32} className="text-green-600" />
            </div>
            {parsing ? (
              <div>
                <p className="font-semibold text-gray-700 text-lg">Parsing Excel…</p>
                <p className="text-sm text-gray-400 mt-1">Detecting sheet types and extracting data</p>
              </div>
            ) : (
              <div>
                <p className="font-semibold text-gray-700 text-lg">Drop your Excel file here</p>
                <p className="text-sm text-gray-400 mt-1">or click to browse · .xlsx, .xls, .xlsm</p>
              </div>
            )}
            {!parsing && (
              <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-4 py-2 rounded-lg">
                <Upload size={15} /> Select File
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle size={16} className="shrink-0" /> {error}
        </div>
      )}

      {/* Preview */}
      {sheets && !confirmed && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} className="text-green-600" />
              <div>
                <p className="font-semibold text-green-800">{fileName} parsed successfully</p>
                <p className="text-sm text-green-700">{sheetCount} sheets found · {recognizedCount} recognized · {sheetCount - recognizedCount} unknown</p>
              </div>
            </div>
            <button onClick={() => { setSheets(null); setFileName(''); }} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-gray-800">Sheet Preview</h3>
            {sheets.map(sheet => <SheetPreview key={sheet.name} sheet={sheet} />)}
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button onClick={handleConfirm}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">
              <CheckCircle2 size={16} /> Confirm & Import Data
            </button>
            <button onClick={() => { setSheets(null); setFileName(''); }}
              className="px-6 py-3 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success — show what was imported and navigation links */}
      {confirmed && summary && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 size={32} className="text-green-500" />
            <div>
              <p className="text-lg font-bold text-green-800">Data Imported into {targetCompany.name}</p>
              <p className="text-sm text-green-700">{sheetCount} sheets processed</p>
            </div>
          </div>

          {/* What was updated */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Deal P&L',       updated: summary.dealPL,         page: 'deal-pl' as const,       count: summary.dealPL ? '1 property' : null },
              { label: 'Partners',       updated: summary.partners > 0,   page: 'partners' as const,      count: summary.partners > 0 ? `${summary.partners} partners` : null },
              { label: 'Loans',          updated: summary.loans > 0,      page: 'loans' as const,         count: summary.loans > 0 ? `${summary.loans} loans` : null },
              { label: 'Capital Calls',  updated: summary.capitalCalls > 0, page: 'capital-calls' as const, count: summary.capitalCalls > 0 ? `${summary.capitalCalls} calls` : null },
            ].map(({ label, updated, page, count }) => (
              <button
                key={label}
                onClick={() => updated && setTab(page)}
                className={`flex items-center justify-between p-3 rounded-xl border text-left ${
                  updated
                    ? 'bg-white border-green-200 hover:border-blue-300 hover:shadow-sm cursor-pointer'
                    : 'bg-gray-50 border-gray-100 cursor-default opacity-50'
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800">{label}</p>
                  <p className={`text-xs mt-0.5 ${updated ? 'text-green-700' : 'text-gray-400'}`}>
                    {updated ? `✓ Updated — ${count}` : 'Not found in file'}
                  </p>
                </div>
                {updated && <ArrowRight size={14} className="text-blue-500 shrink-0" />}
              </button>
            ))}
          </div>

          <p className="text-xs text-green-600">Click any updated card above to navigate to that page and see the imported data.</p>

          <button onClick={() => { setSheets(null); setFileName(''); setConfirmed(false); setSummary(null); }}
            className="mt-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">
            Upload Another File
          </button>
        </div>
      )}

      {/* Expected format guide */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Expected Sheet Formats</h3>
          <p className="text-xs text-gray-400 mt-0.5">Your Excel file should contain sheets matching these formats</p>
        </div>
        <div className="divide-y divide-gray-100">
          {EXPECTED_SHEETS.map(s => (
            <div key={s.name} className="flex gap-4 px-4 py-3 hover:bg-gray-50">
              <FileSpreadsheet size={16} className="text-green-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-gray-800">{s.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">Columns: {s.cols}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-blue-800 text-sm">Need a template?</p>
          <p className="text-xs text-blue-600 mt-0.5">Download the EstateCFO Excel template with all required sheets pre-formatted.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Upload size={14} /> Download Template
        </button>
      </div>

      {/* Upload History */}
      {uploadHistory.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Upload History</h3>
            <p className="text-xs text-gray-400 mt-0.5">All previous uploads — latest first. Data is cumulative per session.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {uploadHistory.map(rec => (
              <div key={rec.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                <FileSpreadsheet size={16} className="text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800 truncate">{rec.fileName}</p>
                    <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">{rec.companyName}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(rec.uploadDate).toLocaleString()} · {rec.sheetsImported.length} sheet{rec.sheetsImported.length !== 1 ? 's' : ''}: {rec.sheetsImported.join(', ')}
                  </p>
                </div>
                <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-1" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
