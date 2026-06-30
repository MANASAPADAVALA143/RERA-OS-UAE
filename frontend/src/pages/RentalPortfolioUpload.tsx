import { useRef, useState } from 'react';
import api from '../services/api';

const MONTH_OPTIONS = [
  { value: 'Jan-2026', label: 'January 2026' },
  { value: 'Feb-2026', label: 'February 2026' },
  { value: 'Mar-2026', label: 'March 2026' },
  { value: 'Apr-2026', label: 'April 2026' },
  { value: 'May-2026', label: 'May 2026' },
  { value: 'Jun-2026', label: 'June 2026' },
  { value: 'Jul-2026', label: 'July 2026' },
  { value: 'Aug-2026', label: 'August 2026' },
  { value: 'Sep-2026', label: 'September 2026' },
  { value: 'Oct-2026', label: 'October 2026' },
  { value: 'Nov-2026', label: 'November 2026' },
  { value: 'Dec-2026', label: 'December 2026' },
];

interface SyncedCompanyPreview {
  company: string;
  total_units: number;
  occupied: number;
  vacant: number;
  occupancy_rate: number;
  collected: number;
  gross_potential: number;
  vacancy_loss: number;
  vacant_units: string[];
  monthly_totals: Record<string, number>;
}

interface SyncedPortfolioPreview {
  target_month: string;
  total_units: number;
  occupied: number;
  vacant: number;
  total_collected: number;
  gross_potential: number;
  total_vacancy_loss: number;
  collection_rate: number;
  occupancy_rate: number;
  monthly_totals: Record<string, number>;
  companies_parsed: number;
  skipped: string[];
}

interface RentUploadPreview {
  target_month: string;
  portfolio: SyncedPortfolioPreview;
  companies: Record<string, SyncedCompanyPreview>;
  temp_file_id: string;
}

const fmtUSD = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

export default function RentalPortfolioUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedMonth, setSelectedMonth] = useState('Jun-2026');
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<RentUploadPreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState('');

  function showMsg(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('target_month', selectedMonth);
    try {
      const res = await api.post<RentUploadPreview>(
        '/api/rentals/upload-rent-receivable/preview',
        formData,
      );
      setPreview(res.data);
      setShowPreview(true);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showMsg(`❌ ${detail || 'Upload failed — check file format'}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleConfirm() {
    if (!preview) return;
    setConfirming(true);
    try {
      await api.post('/api/rentals/upload-rent-receivable/confirm', {
        temp_file_id: preview.temp_file_id,
        target_month: selectedMonth,
      });
      setShowPreview(false);
      showMsg(`✅ All rental data updated for ${selectedMonth}`);
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      showMsg('❌ Save failed — please try again');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Upload Portfolio Data</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload monthly Excel to sync all rental financials across every section
        </p>
      </div>

      {/* Upload card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
            <span className="text-xl">📊</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">Rent Receivable Sync</div>
            <div className="text-xs text-gray-400">Upload EstateCFO_Rent_Template_ByCompany.xlsx</div>
          </div>
        </div>

        {/* Step 1: Month */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
            Step 1 — Select month
          </label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2.5 bg-white
                       focus:outline-none focus:ring-2 focus:ring-green-500 w-56"
          >
            {MONTH_OPTIONS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1.5">
            App reads this month's column for each unit. Previous months calculate vacancy loss automatically.
          </p>
        </div>

        {/* Step 2: Upload */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
            Step 2 — Upload file
          </label>
          <input ref={fileRef} type="file" accept=".xlsx" onChange={handleUpload} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 text-sm bg-green-700 text-white px-5 py-2.5
                       rounded-xl hover:bg-green-600 font-medium disabled:opacity-50
                       disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Parsing {selectedMonth}...
              </>
            ) : '📊 Upload Rent Receivable Excel'}
          </button>
        </div>
      </div>

      {/* What gets updated */}
      <div className="rounded-xl p-4 max-w-2xl mb-6"
        style={{ background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.25)' }}>
        <div className="text-xs font-semibold mb-2" style={{ color: '#92400E' }}>
          ✅ After upload, these sections update automatically:
        </div>
        <div className="grid grid-cols-2 gap-1">
          {[
            'Company Registry — units, suites, company list',
            'Overview — occupancy, collected, NOI',
            'Companies — per-company KPIs',
            'Units — vacant/occupied status & rent history',
            'AR Dashboard — collection summary by company',
            'Vacancy & Loss — vacancy loss by unit',
            'Financial Ratios — all ratios recalculated',
            'Income vs Expense — 6-month trend chart',
          ].map(item => (
            <div key={item} className="text-xs flex items-center gap-1.5" style={{ color: '#92400E' }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#D4AF37' }} />
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">

            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Preview — {selectedMonth}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Review before saving to database</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="text-gray-400 hover:text-gray-600 p-1">✕</button>
            </div>

            {/* Portfolio KPI tiles */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {([
                { label: 'Total Units',     value: preview.portfolio.total_units,                            color: 'text-blue-600'  },
                { label: 'Occupied',        value: preview.portfolio.occupied,                               color: 'text-green-600' },
                { label: 'Vacant',          value: preview.portfolio.vacant,                                 color: 'text-red-500'   },
                { label: 'Total Collected', value: fmtUSD(preview.portfolio.total_collected),               color: 'text-green-600' },
                { label: 'Occupancy %',     value: `${preview.portfolio.occupancy_rate}%`,                  color: preview.portfolio.occupancy_rate >= 80 ? 'text-green-600' : 'text-amber-600' },
                { label: 'Vacancy Loss',    value: fmtUSD(preview.portfolio.total_vacancy_loss),            color: 'text-amber-600' },
                { label: 'Gross Potential', value: fmtUSD(preview.portfolio.gross_potential),               color: 'text-blue-600'  },
                { label: 'Companies',       value: preview.portfolio.companies_parsed,                       color: 'text-gray-700'  },
              ] as { label: string; value: string | number; color: string }[]).map(tile => (
                <div key={tile.label} className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                  <div className={`text-lg font-mono font-semibold ${tile.color}`}>{tile.value}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{tile.label}</div>
                </div>
              ))}
            </div>

            {/* Per-company table */}
            <table className="w-full text-xs mb-5">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Company</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Units</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Occ%</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Collected</th>
                  <th className="text-right py-2 px-3 text-gray-400 font-medium">Vac Loss</th>
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Vacant Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {Object.entries(preview.companies)
                  .sort(([, a], [, b]) => b.collected - a.collected)
                  .map(([co, data]) => (
                    <tr key={co} className="hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium text-gray-800">{co}</td>
                      <td className="py-2 px-3 text-right font-mono">{data.total_units}</td>
                      <td className={`py-2 px-3 text-right font-mono font-medium ${
                        data.occupancy_rate >= 85 ? 'text-green-600' :
                        data.occupancy_rate >= 70 ? 'text-amber-600' : 'text-red-500'
                      }`}>{data.occupancy_rate}%</td>
                      <td className="py-2 px-3 text-right font-mono text-green-700">{fmtUSD(data.collected)}</td>
                      <td className="py-2 px-3 text-right font-mono text-amber-600">{fmtUSD(data.vacancy_loss)}</td>
                      <td className="py-2 px-3 text-gray-400 text-[10px]">
                        {data.vacant_units.slice(0, 4).join(', ')}
                        {data.vacant_units.length > 4 ? ` +${data.vacant_units.length - 4}` : ''}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>

            {/* Skipped warning */}
            {preview.portfolio.skipped.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <div className="text-xs font-medium text-amber-800 mb-1">⚠ Skipped:</div>
                {preview.portfolio.skipped.map(s => (
                  <div key={s} className="text-xs text-amber-700">{s}</div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowPreview(false)}
                className="flex-1 text-sm border border-gray-200 text-gray-600 py-2.5 rounded-xl hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="flex-1 text-sm bg-green-700 text-white py-2.5 rounded-xl hover:bg-green-600 font-medium disabled:opacity-50"
              >
                {confirming ? 'Updating all sections...' : '✅ Confirm & Update All Sections'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
