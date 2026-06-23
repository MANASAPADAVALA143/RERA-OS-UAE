import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, ChevronDown, ChevronRight } from 'lucide-react';
import { usePropDev } from '../../contexts/PropertyDevContext';

interface ParsedSheet {
  name: string;
  rows: Record<string, string | number>[];
  detected: string;
}

// ── Sheet detectors ──────────────────────────────────────────────────────────

function detectSheetType(name: string, rows: Record<string, string | number>[]): string {
  const n = name.toLowerCase();
  const allText = JSON.stringify(rows).toLowerCase();
  if (n.includes('annexure i') || n.includes('deal') || n.includes('p&l') || n.includes('pl'))
    return 'Deal P&L (Annexure I)';
  if (n.includes('annexure ii') || n.includes('partner') || allText.includes('roi'))
    return 'Partner Summary (Annexure II)';
  if (n.includes('capital') || n.includes('call') || allText.includes('emi'))
    return 'Capital Call Sheet';
  if (n.includes('loan') || allText.includes('bank') || allText.includes('maturity'))
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
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: 'binary' });
        const sheets: ParsedSheet[] = wb.SheetNames.map(name => {
          const ws = wb.Sheets[name];
          const rows = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: '' });
          return { name, rows, detected: detectSheetType(name, rows) };
        }).filter(s => s.rows.length > 0);
        resolve(sheets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

// ── Preview table ──────────────────────────────────────────────────────────

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
                    {String(col).substring(0, 25)}
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

// ── Upload tips ────────────────────────────────────────────────────────────

const EXPECTED_SHEETS = [
  { name: 'Annexure I — Deal P&L', cols: 'Sale Consideration, Land Cost, Hard/Soft Cost, Management Fee, Commission, Net Profit' },
  { name: 'Annexure II — Partner Summary', cols: 'Partner Name, % Share, Capital Contributed (A), Share of Profit (B), ROI [B/A]' },
  { name: 'Capital Call Sheet', cols: 'Partner Name, % Share, Balance Due, Call Amount (6 months), Received Date, Amount' },
  { name: 'Loan Sheet', cols: 'Company, Property, Bank, Loan Date, Account No, Amount, Rate %, EMI, Maturity Date' },
  { name: 'Expense Dashboard', cols: 'Expense Type, Amount, Category (Plumbing/Electrical/Materials etc.)' },
];

export default function PD00Upload() {
  const { companies, selectedCompanyId } = usePropDev();
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const targetCompany = selectedCompanyId === 'all'
    ? null
    : companies.find(c => c.id === selectedCompanyId);

  async function handleFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|xlsm)$/i)) {
      setError('Please upload an Excel file (.xlsx, .xls, .xlsm)');
      return;
    }
    setError('');
    setParsing(true);
    setSheets(null);
    setConfirmed(false);
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
    // In a real implementation, this would update the context with parsed data.
    // For demo, we just mark as confirmed.
    setConfirmed(true);
  }

  const sheetCount = sheets?.length ?? 0;
  const recognizedCount = sheets?.filter(s => s.detected !== 'Unknown').length ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Upload Client Excel Data</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload your Annexure Excel file — the app will auto-detect and parse each sheet.
        </p>
      </div>

      {/* Company target */}
      {!targetCompany && (
        <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0" />
          Select a specific company in the top bar before uploading — or select "All Companies" to upload to the first company.
        </div>
      )}
      {targetCompany && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <CheckCircle2 size={16} className="shrink-0" />
          Uploading to: <strong className="ml-1">{targetCompany.name}</strong>
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
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
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
                <Upload size={15} />
                Select File
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Preview */}
      {sheets && !confirmed && (
        <div className="space-y-4">
          {/* Summary */}
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

          {/* Sheet previews */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-800">Sheet Preview</h3>
            {sheets.map(sheet => <SheetPreview key={sheet.name} sheet={sheet} />)}
          </div>

          {/* Confirm */}
          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleConfirm}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
            >
              <CheckCircle2 size={16} />
              Confirm & Import Data
            </button>
            <button
              onClick={() => { setSheets(null); setFileName(''); }}
              className="px-6 py-3 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success state */}
      {confirmed && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center space-y-3">
          <CheckCircle2 size={40} className="text-green-500 mx-auto" />
          <p className="text-xl font-bold text-green-800">Data Imported Successfully</p>
          <p className="text-sm text-green-700">{sheetCount} sheets loaded into {targetCompany?.name ?? 'portfolio'}</p>
          <p className="text-xs text-green-600">Navigate to any page in the sidebar to view updated data</p>
          <button
            onClick={() => { setSheets(null); setFileName(''); setConfirmed(false); }}
            className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
          >
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

      {/* Download template placeholder */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-blue-800 text-sm">Need a template?</p>
          <p className="text-xs text-blue-600 mt-0.5">Download the EstateCFO Excel template with all required sheets pre-formatted.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Upload size={14} />
          Download Template
        </button>
      </div>
    </div>
  );
}
