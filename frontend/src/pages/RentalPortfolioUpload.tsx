import { useRef, useState } from 'react';
import { Upload, CheckCircle, ArrowRight, AlertCircle, X } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { useRentalPortfolio } from '../contexts/RentalPortfolioContext';
import type { EntityOps, EntityArAp, PortfolioState } from '../contexts/RentalPortfolioContext';
import { useRentalNav } from '../contexts/RentalNavContext';
import api from '../services/api';

function numCell(v: unknown): number {
  const n = parseFloat(String(v ?? '0').replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Occupancy stored as 94 (not 0.94) — always divide by 100
function occCell(v: unknown): number {
  const n = parseFloat(String(v ?? '0').replace(/[%,\s]/g, ''));
  if (isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}

// Find the real header row by looking for "entity name" in col A (case-insensitive)
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i][0] ?? '').toLowerCase().trim();
    if (cell.includes('entity')) return i;
  }
  return 0;
}

function parseEntityOps(rows: unknown[][]): EntityOps[] {
  if (rows.length < 2) return [];

  // Skip title/description rows — find real header row
  const headerIdx = findHeaderRow(rows);
  const dataRows = rows.slice(headerIdx + 1);
  const results: EntityOps[] = [];

  for (const row of dataRows) {
    const name = String(row[0] ?? '').trim();
    // Skip empty rows, portfolio total row, or rows without a valid unit count
    if (!name) continue;
    if (name.toLowerCase().includes('total') || name.toLowerCase().includes('portfolio')) continue;
    const units = numCell(row[2]);
    if (units === 0 || isNaN(units)) continue;

    // Fixed column positions:
    // A(0)=Entity, B(1)=EIN, C(2)=Units, D(3)=Rent$/mo,
    // E(4)=Occ%, F(5)=OpEx$/yr, G(6)=Debt svc$/yr, H(7)=Value$, I(8)=Loan$
    results.push({
      entity_name:         name,
      units:               units,
      occupancy_pct:       occCell(row[4]),
      rent_per_unit_mo:    numCell(row[3]),
      other_income_annual: 0,
      management_fee:      0,
      maintenance:         0,
      utilities:           0,
      insurance:           0,
      property_taxes:      0,
      other_opex:          numCell(row[5]),  // F = total OpEx $/yr
      loan_balance:        numCell(row[8]),  // I = Loan $
      debt_service_annual: numCell(row[6]),  // G = Debt svc $/yr
      property_value:      numCell(row[7]),  // H = Value $
    });
  }
  return results;
}

function parseArAp(rows: unknown[][]): EntityArAp[] {
  if (rows.length < 2) return [];
  const headerIdx = findHeaderRow(rows);
  const dataRows = rows.slice(headerIdx + 1);
  const results: EntityArAp[] = [];
  for (const row of dataRows) {
    const name = String(row[0] ?? '').trim();
    if (!name) continue;
    if (name.toLowerCase().includes('total') || name.toLowerCase().includes('portfolio')) continue;
    // Fixed positions: A(0)=Entity, B(1)=AR Current, C(2)=AR 1-30, D(3)=AR 31-60,
    // E(4)=AR 61-90, F(5)=AR 90+, G(6)=AP Current, H(7)=AP 1-30, I(8)=AP 31-60, J(9)=AP 60+
    results.push({
      entity_name: name,
      ar_current:  numCell(row[1]),
      ar_1_30:     numCell(row[2]),
      ar_31_60:    numCell(row[3]),
      ar_61_90:    numCell(row[4]),
      ar_90_plus:  numCell(row[5]),
      ap_current:  numCell(row[6]),
      ap_1_30:     numCell(row[7]),
      ap_31_60:    numCell(row[8]),
      ap_60_plus:  numCell(row[9]),
    });
  }
  return results;
}

interface RentPreviewCompany {
  company: string;
  total_units: number;
  occupied: number;
  vacant: number;
  occupancy_rate: number;
  collected: number;
  vacancy_loss: number;
  current_month: string | null;
  vacant_units: string[];
}

interface RentPreview {
  portfolio: {
    total_units: number;
    occupied: number;
    vacant: number;
    total_collected: number;
    total_vacancy_loss: number;
    occupancy_rate: number;
    skipped: string[];
  };
  companies: Record<string, RentPreviewCompany>;
  temp_file_id: string;
}

function RentReceivableUpload() {
  const rrRef = useRef<HTMLInputElement>(null);
  const [rrUploading, setRrUploading] = useState(false);
  const [rrPreview, setRrPreview] = useState<RentPreview | null>(null);
  const [rrConfirming, setRrConfirming] = useState(false);
  const [rrToast, setRrToast] = useState('');

  function showToast(msg: string) {
    setRrToast(msg);
    setTimeout(() => setRrToast(''), 3500);
  }

  async function handleRrUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRrUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post<RentPreview>('/api/rentals/upload-rent-receivable/preview', formData);
      setRrPreview(res.data);
    } catch {
      showToast('Could not read file — check format');
    } finally {
      setRrUploading(false);
      if (rrRef.current) rrRef.current.value = '';
    }
  }

  async function handleRrConfirm() {
    if (!rrPreview) return;
    setRrConfirming(true);
    try {
      await api.post('/api/rentals/upload-rent-receivable/confirm', {
        temp_file_id: rrPreview.temp_file_id,
      });
      setRrPreview(null);
      showToast('All rental data updated successfully');
    } catch {
      showToast('Save failed — please try again');
    } finally {
      setRrConfirming(false);
    }
  }

  const fmtUSD = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Rent Receivable Sync</h2>
          <p className="text-xs text-gray-400 mt-0.5">Upload monthly Rent Receivable Excel — unit status and rents update instantly</p>
        </div>
        <div>
          <input ref={rrRef} type="file" accept=".xlsx" onChange={handleRrUpload} className="hidden" />
          <button
            onClick={() => rrRef.current?.click()}
            disabled={rrUploading}
            className="flex items-center gap-2 text-sm bg-green-700 text-white px-4 py-2 rounded-xl hover:bg-green-600 disabled:opacity-50 font-medium transition-colors"
          >
            {rrUploading ? (
              <><div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />Parsing...</>
            ) : (
              <>📊 Upload Rent Receivable Excel</>
            )}
          </button>
        </div>
      </div>

      {rrToast && (
        <div className={`text-sm px-4 py-2 rounded-lg mb-3 ${rrToast.includes('success') || rrToast.includes('updated') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {rrToast}
        </div>
      )}

      {/* Preview modal */}
      {rrPreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Preview — Confirm Update</h2>
                <p className="text-xs text-gray-400 mt-0.5">Review the parsed data before saving to database</p>
              </div>
              <button onClick={() => setRrPreview(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {/* Portfolio summary tiles */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total Units', value: rrPreview.portfolio.total_units, color: 'blue' },
                { label: 'Occupied', value: rrPreview.portfolio.occupied, color: 'green' },
                { label: 'Vacant', value: rrPreview.portfolio.vacant, color: 'red' },
                { label: 'Collected', value: fmtUSD(rrPreview.portfolio.total_collected), color: 'green' },
              ].map(tile => (
                <div key={tile.label} className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                  <div className={`text-xl font-mono font-semibold text-${tile.color}-600`}>{tile.value}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{tile.label}</div>
                </div>
              ))}
            </div>

            {/* Per-company table */}
            <table className="w-full text-xs mb-5">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-2 px-3 text-gray-400 font-normal">Company</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Units</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Occ%</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Collected</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-normal">Vac Loss</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-normal">Vacant Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {Object.entries(rrPreview.companies).map(([co, data]) => (
                  <tr key={co} className="hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-800">{co}</td>
                    <td className="py-2 px-3 text-right font-mono">{data.total_units}</td>
                    <td className={`py-2 px-3 text-right font-mono font-medium ${
                      data.occupancy_rate >= 90 ? 'text-green-600' :
                      data.occupancy_rate >= 75 ? 'text-amber-600' : 'text-red-500'
                    }`}>{data.occupancy_rate}%</td>
                    <td className="py-2 px-3 text-right font-mono text-green-700">{fmtUSD(data.collected)}</td>
                    <td className="py-2 px-3 text-right font-mono text-amber-600">{fmtUSD(data.vacancy_loss)}</td>
                    <td className="py-2 px-3 text-gray-400 text-[10px]">
                      {data.vacant_units.length > 0 ? data.vacant_units.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {rrPreview.portfolio.skipped.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">
                Skipped sheets: {rrPreview.portfolio.skipped.join(', ')}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setRrPreview(null)}
                className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRrConfirm}
                disabled={rrConfirming}
                className="flex-1 text-sm bg-green-700 text-white py-2.5 rounded-xl hover:bg-green-600 font-medium disabled:opacity-50"
              >
                {rrConfirming ? 'Saving...' : 'Confirm & Update Database'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RentalPortfolioUpload() {
  const { setPortfolio } = useRentalPortfolio();
  const { setTab } = useRentalNav();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [preview, setPreview] = useState<PortfolioState | null>(null);

  async function processFile(file: File) {
    if (!file.name.endsWith('.xlsx')) {
      setErrorMsg('Only .xlsx files are supported.');
      setStatus('error');
      return;
    }
    setStatus('parsing');
    setErrorMsg('');
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });

      const opsSheet = wb.Sheets['Rental - Entity Ops'] ?? wb.Sheets[wb.SheetNames[0]];
      const arApSheet = wb.Sheets['Rental - AR & AP'] ?? wb.Sheets[wb.SheetNames[1]];

      const opsRows: unknown[][] = XLSX.utils.sheet_to_json(opsSheet, { header: 1, defval: '' });
      const arApRows: unknown[][] = arApSheet
        ? XLSX.utils.sheet_to_json(arApSheet, { header: 1, defval: '' })
        : [];

      const entities = parseEntityOps(opsRows);
      const arAp = parseArAp(arApRows);

      if (entities.length === 0) {
        setErrorMsg('No entity rows found. Check that your sheet is named "Rental - Entity Ops" and has a header row.');
        setStatus('error');
        return;
      }

      const state: PortfolioState = { entities, arAp, loaded: true, fileName: file.name };
      setPortfolio(state);
      setPreview(state);
      setStatus('done');
    } catch (e) {
      setErrorMsg(`Parse error: ${String(e)}`);
      setStatus('error');
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload Portfolio Data</h1>
        <p className="text-sm text-gray-500 mt-1">Upload your Excel intake file — all tabs parsed automatically</p>
      </div>

      {/* Rent Receivable sync — server-side parser */}
      <RentReceivableUpload />

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
          dragging ? 'border-[#0E3B36] bg-green-50' : 'border-gray-300 hover:border-[#0E3B36] hover:bg-gray-50'
        }`}
      >
        <Upload size={40} className="mx-auto text-gray-400 mb-3" />
        <p className="font-medium text-gray-700">Drag & drop your Excel file here</p>
        <p className="text-sm text-gray-400 mt-1">or click to browse — .xlsx only</p>
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={onFileChange} />
      </div>

      {/* Expected sheets info */}
      <Card>
        <p className="text-sm font-semibold text-gray-700 mb-2">Expected sheet names:</p>
        <ul className="space-y-1 text-sm text-gray-600">
          <li><span className="font-mono bg-gray-100 px-1 rounded">Rental - Entity Ops</span> — entity operations (units, rent, occupancy, OpEx, debt)</li>
          <li><span className="font-mono bg-gray-100 px-1 rounded">Rental - AR & AP</span> — AR & AP aging buckets per entity</li>
          <li><span className="font-mono bg-gray-100 px-1 rounded">Rental - Portfolio</span> — OpEx categories & other income (optional)</li>
        </ul>
      </Card>

      {/* Parsing */}
      {status === 'parsing' && (
        <div className="flex items-center gap-3 text-gray-600">
          <div className="w-5 h-5 border-2 border-[#0E3B36] border-t-transparent rounded-full animate-spin" />
          Parsing file…
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertCircle size={18} className="text-red-600 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{errorMsg}</p>
        </div>
      )}

      {/* Success */}
      {status === 'done' && preview && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
            <CheckCircle size={18} className="text-green-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-800">
                {preview.entities.length} {preview.entities.length === 1 ? 'entity' : 'entities'} loaded
                {preview.arAp.length > 0 && ` · ${preview.arAp.length} AR/AP records`}
              </p>
              <p className="text-xs text-green-600 mt-0.5">{preview.fileName}</p>
            </div>
          </div>

          {/* Preview table */}
          <Card>
            <p className="text-sm font-semibold text-gray-700 mb-3">Entities detected</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0E3B36] text-white text-xs">
                    <th className="px-3 py-2 text-left">Entity</th>
                    <th className="px-3 py-2 text-right">Units</th>
                    <th className="px-3 py-2 text-right">Occ%</th>
                    <th className="px-3 py-2 text-right">Rent/Unit</th>
                    <th className="px-3 py-2 text-right">Loan Balance</th>
                    <th className="px-3 py-2 text-right">Property Value</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entities.map((e, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2 font-medium">{e.entity_name}</td>
                      <td className="px-3 py-2 text-right font-mono">{e.units}</td>
                      <td className="px-3 py-2 text-right font-mono">{(e.occupancy_pct * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right font-mono">${e.rent_per_unit_mo.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">${e.loan_balance.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">${e.property_value.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <button
            onClick={() => setTab('cfo-dashboard')}
            className="flex items-center gap-2 bg-[#0E3B36] text-white px-6 py-3 rounded-lg font-medium hover:bg-[#1A5249] transition-colors"
          >
            Go to CFO Dashboard <ArrowRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
