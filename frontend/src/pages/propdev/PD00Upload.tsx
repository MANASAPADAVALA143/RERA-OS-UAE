import { useState, useRef } from 'react';
import api from '../../services/api';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X,
  ChevronDown, ChevronRight, ArrowRight, Zap,
} from 'lucide-react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Loan, Partner, CapitalCall, Property } from '../../contexts/PropertyDevContext';
import { createEmptyCompany } from '../../contexts/PropertyDevContext';
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
  // Company-named sheets (e.g. "JKL LLC", "MNO LLC") with capital call data
  if (/\b(llc|lp|inc|ltd|corp|holdings|ventures|development|group|partners|land|realty|properties|estate)\b/i.test(name))
    return 'Company Capital Call';
  // QuickBooks / accounting P&L export (sheet content has "profit and loss" text)
  if (allText.includes('profit and loss') || (allText.includes('net income') && allText.includes('expenses') && allText.includes('income')))
    return 'QuickBooks P&L';
  return 'Unknown';
}

function isCapitalContributionFile(sheets: ParsedSheet[]): boolean {
  return sheets.every(s => s.detected === 'Company Capital Call' || s.detected === 'Unknown')
    && sheets.some(s => s.detected === 'Company Capital Call');
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
  { name: 'QuickBooks P&L Export',      cols: 'Company name in A1, "Profit and Loss" in A2, year columns (2021–2026), expense line items' },
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
  const { companies, selectedCompanyId, setSelectedCompanyId, setCompanies,
          addUploadRecord, uploadHistory } = usePropDev();
  const { setTab } = usePropDevNav();

  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── QuickBooks multi-file uploader state ──────────────────────────────────
  const qbInputRef = useRef<HTMLInputElement>(null);
  const [qbFiles, setQbFiles] = useState<File[]>([]);
  const [qbDragOver, setQbDragOver] = useState(false);
  const [qbUploading, setQbUploading] = useState(false);
  const [qbResult, setQbResult] = useState<{
    status: string;
    company: string;
    files_processed: Array<{ file: string; type: string; status: string; detail: string }>;
    kpis: Record<string, number>;
  } | null>(null);
  const [qbError, setQbError] = useState('');

  const QB_TYPE_COLORS: Record<string, string> = {
    'Balance Sheet': 'bg-blue-100 text-blue-700',
    'P&L':          'bg-green-100 text-green-700',
    'Cash Flow':    'bg-purple-100 text-purple-700',
    'Loans':        'bg-amber-100 text-amber-800',
    'Unknown':      'bg-gray-100 text-gray-500',
  };

  function guessFileType(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('bs') || n.includes('balance')) return 'Balance Sheet';
    if (n.includes('p_l') || n.includes('pl') || n.includes('profit')) return 'P&L';
    if (n.includes('loan')) return 'Loans';
    if (n.includes('cash') || n.includes('cf')) return 'Cash Flow';
    return 'Auto-detect';
  }

  function addQbFiles(incoming: FileList | null) {
    if (!incoming) return;
    const valid = Array.from(incoming).filter(f => /\.(xlsx|xls|xlsm)$/i.test(f.name));
    setQbFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
    setQbResult(null);
    setQbError('');
  }

  async function handleQbUpload() {
    if (qbFiles.length === 0) return;
    setQbUploading(true);
    setQbError('');
    setQbResult(null);
    try {
      const fd = new FormData();
      qbFiles.forEach(f => fd.append('files', f));
      const res = await api.post<typeof qbResult>('/api/propdev/import-quickbooks', fd);
      setQbResult(res.data);
      setTimeout(() => window.location.reload(), 3000);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setQbError(detail || 'Upload failed');
    } finally {
      setQbUploading(false);
    }
  }

  async function handleSeedWWBG() {
    setSeeding(true);
    setSeedResult('');
    try {
      const res = await api.post<{ status: string; company: string; total_invested: number; loan_balance: number; ltv_pct: number; cash: number; partners_added: number }>('/api/propdev/seed-wwbg');
      const d = res.data;
      setSeedResult(`✅ ${d.company} seeded — Total invested $${d.total_invested.toLocaleString('en-US',{maximumFractionDigits:0})} · Loan $${d.loan_balance.toLocaleString('en-US',{maximumFractionDigits:0})} · LTV ${d.ltv_pct}% · ${d.partners_added} partners`);
      setTimeout(() => window.location.reload(), 2000);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSeedResult(`❌ ${detail || 'Seeding failed'}`);
    } finally {
      setSeeding(false);
    }
  }

  const targetCompany = selectedCompanyId === 'all'
    ? companies[0]
    : companies.find(c => c.id === selectedCompanyId) ?? companies[0];

  function inferCompanyName(sheetList: ParsedSheet[]): string | null {
    for (const sheet of sheetList) {
      for (const row of sheet.rows.slice(0, 20)) {
        const vals = Object.values(row).map(v => String(v).trim());
        const companyCell = vals.find(v => /llc|lp|inc|holdings|ventures|development/i.test(v));
        if (companyCell && companyCell.length > 3) return companyCell;
      }
    }
    return null;
  }

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
    setSelectedFile(file);
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

  async function handleConfirm() {
    if (!sheets || sheets.length === 0) return;

    if (!selectedFile) {
      setError('No file selected');
      return;
    }

    setParsing(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      // Route to correct endpoint based on file type
      const endpoint = isCapitalContributionFile(sheets)
        ? '/api/propdev/import-capital-contributions'
        : '/api/propdev/import-excel';

      const response = await api.post<{ companies: Array<{ id: string; name: string; property?: string; total_lots?: number }> }>(
        endpoint,
        formData,
      );
      const data = response.data;
      setSummary({
        dealPL: true,
        partners: data.companies.length,
        loans: data.companies.length,
        capitalCalls: data.companies.length,
      });
      setConfirmed(true);

      // Trigger a refresh of companies
      await api.get('/api/propdev/companies');
      window.location.reload();

      const sheetsImported = sheets.filter(sh => sh.detected !== 'Unknown').map(sh => sh.detected);
      addUploadRecord({
        companyId: data.companies[0]?.id || 'unknown',
        companyName: data.companies[0]?.name || 'Imported',
        fileName,
        uploadDate: new Date().toISOString(),
        sheetsImported,
      });
    } catch (err) {
      setError(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setParsing(false);
    }
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
      {targetCompany ? (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <CheckCircle2 size={16} className="shrink-0" />
          Uploading to: <strong className="ml-1">{targetCompany.name}</strong>
          {selectedCompanyId === 'all' && <span className="text-blue-500 ml-1">(select a specific company in the top bar to target another)</span>}
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0" />
          No companies yet — your first upload will create a new company from the Excel file.
        </div>
      )}

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
              <p className="text-lg font-bold text-green-800">Data Imported into {targetCompany?.name ?? 'new company'}</p>
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

      {/* ── QuickBooks Multi-File Upload ────────────────────────────────────── */}
      <div className="rounded-2xl border-2 overflow-hidden" style={{ borderColor: 'rgba(99,102,241,0.40)', background: '#FDFCF8' }}>
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: 'rgba(99,102,241,0.20)', background: 'rgba(99,102,241,0.08)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#6366F1' }}>
            <Zap size={16} color="#1E1B4B" />
          </div>
          <div>
            <p className="font-bold text-sm" style={{ color: '#78350F' }}>Upload QuickBooks Export Files</p>
            <p className="text-xs text-gray-500">Auto-detect BS · P&amp;L · Loans · Cash Flow — upload all 4 together</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Drop zone */}
          {!qbResult && (
            <div
              onDragOver={e => { e.preventDefault(); setQbDragOver(true); }}
              onDragLeave={() => setQbDragOver(false)}
              onDrop={e => { e.preventDefault(); setQbDragOver(false); addQbFiles(e.dataTransfer.files); }}
              onClick={() => qbInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                qbDragOver ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50/30'
              }`}
            >
              <input
                ref={qbInputRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.xlsm"
                className="hidden"
                onChange={e => addQbFiles(e.target.files)}
              />
              <FileSpreadsheet size={28} className="mx-auto mb-2 text-amber-600" />
              <p className="text-sm font-semibold text-gray-700">Drop 1–4 QuickBooks export files here</p>
              <p className="text-xs text-gray-400 mt-0.5">or click to browse · .xlsx, .xls, .xlsm · multiple files OK</p>
            </div>
          )}

          {/* File chips */}
          {qbFiles.length > 0 && !qbResult && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Selected files</p>
              <div className="flex flex-wrap gap-2">
                {qbFiles.map((f, i) => {
                  const guessed = guessFileType(f.name);
                  const colorCls = QB_TYPE_COLORS[guessed] ?? 'bg-gray-100 text-gray-600';
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm shadow-sm">
                      <FileSpreadsheet size={14} className="text-green-600 shrink-0" />
                      <span className="text-gray-700 max-w-[180px] truncate">{f.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${colorCls}`}>{guessed}</span>
                      <button
                        onClick={() => setQbFiles(prev => prev.filter((_, j) => j !== i))}
                        className="text-gray-300 hover:text-red-500 ml-1"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {qbError && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle size={14} /> {qbError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleQbUpload}
                  disabled={qbUploading}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
                  style={{ background: '#6366F1', color: '#1E1B4B' }}
                >
                  <Upload size={14} />
                  {qbUploading ? 'Parsing & importing…' : `Parse & Import ${qbFiles.length} file${qbFiles.length !== 1 ? 's' : ''}`}
                </button>
                <button
                  onClick={() => { setQbFiles([]); setQbError(''); }}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Success result */}
          {qbResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-800 font-semibold text-sm">
                <CheckCircle2 size={18} className="text-green-500" />
                {qbResult.company} — data imported successfully
              </div>

              {/* Per-file breakdown */}
              <div className="space-y-1.5">
                {qbResult.files_processed.map((fp, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-base leading-none mt-0.5">{fp.status}</span>
                    <div>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium mr-2 ${QB_TYPE_COLORS[fp.type] ?? 'bg-gray-100 text-gray-600'}`}>{fp.type}</span>
                      <span className="text-gray-700">{fp.detail}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* KPI summary */}
              {Object.keys(qbResult.kpis).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
                  {[
                    { key: 'land',             label: 'Land Value' },
                    { key: 'cash',             label: 'Cash (latest)' },
                    { key: 'loan_balance',     label: 'Loan Balance' },
                    { key: 'improvements',     label: 'Improvements' },
                    { key: 'interest_capitalised', label: 'Int. Capitalised' },
                    { key: 'ltv_pct',          label: 'LTV', suffix: '%' },
                  ].filter(({ key }) => qbResult.kpis[key] !== undefined).map(({ key, label, suffix }) => (
                    <div key={key} className="rounded-lg border bg-white px-3 py-2">
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className="text-sm font-bold text-gray-800">
                        {suffix
                          ? `${qbResult.kpis[key]}${suffix}`
                          : `$${qbResult.kpis[key].toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-400">Refreshing dashboard in 3 seconds…</p>

              <button
                onClick={() => { setQbFiles([]); setQbResult(null); setQbError(''); }}
                className="text-sm text-amber-700 underline"
              >
                Upload more files
              </button>
            </div>
          )}
        </div>
      </div>

      {/* WWBG quick-seed removed in public demo — use Excel upload or synthetic rental seed only */}

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
          <p className="text-xs text-blue-600 mt-0.5">Download the RERA OS Excel template with all required sheets pre-formatted.</p>
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
