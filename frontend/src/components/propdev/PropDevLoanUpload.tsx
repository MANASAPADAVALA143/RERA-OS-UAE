import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { formatApiError, postUploadWithWake } from '../../services/api';
import { notifyPropDevCompaniesRefresh } from '../../utils/propDevSync';
import { parchmentStyles } from '../../theme/parchmentTheme';

const NOW = new Date();
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  onImported: () => void | Promise<void>;
  onClose?: () => void;
}

interface ImportResponse {
  created: number;
  companies_updated: string[];
  message: string;
  balance_periods?: string[];
  balance_period_used?: string;
}

export default function PropDevLoanUpload({ onImported, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [selectedYear, setSelectedYear] = useState(NOW.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(NOW.getMonth() + 1);
  const [availablePeriods, setAvailablePeriods] = useState<string[]>([]);

  const balancePeriod = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  const yearOptions = (() => {
    const years = new Set<number>([NOW.getFullYear(), selectedYear]);
    availablePeriods.forEach(p => {
      const y = parseInt(p.slice(0, 4), 10);
      if (Number.isFinite(y)) years.add(y);
    });
    const sorted = [...years].sort((a, b) => b - a);
    return sorted.length ? sorted : [NOW.getFullYear()];
  })();

  const handleFile = async (file: File) => {
    setUploading(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await postUploadWithWake<ImportResponse>(
        `/api/propdev/import-loans?balance_period=${encodeURIComponent(balancePeriod)}`,
        form,
      );
      setResult(res.data);
      const periods = res.data.balance_periods ?? [];
      if (periods.length) {
        setAvailablePeriods(periods);
        const used = res.data.balance_period_used ?? periods[periods.length - 1];
        if (used) {
          setSelectedYear(parseInt(used.slice(0, 4), 10));
          setSelectedMonth(parseInt(used.slice(5, 7), 10));
        }
      }
      notifyPropDevCompaniesRefresh();
      await Promise.resolve(onImported());
    } catch (e: unknown) {
      setError(formatApiError(e, 'Loan upload failed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-xl p-4 space-y-3" style={parchmentStyles.uploadBar}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#1C1917' }}>
            <FileSpreadsheet size={16} /> Import Loan Register
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: '#57534E' }}>
            Reads only the <strong>Bank Loan Information</strong> (or <strong>Business Banks and Loan Information</strong>) tab.
            Columns: <strong>Entity Name, Property Name, Loan Bank Name, Loan Amount, Interest Rate, EMI, Maturity Date, Balance</strong>.
            Entity names must match <strong>Company Registry</strong>. Re-upload replaces loans per matched entity.
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: '#57534E' }}>
        <span className="font-medium">Balance month (if file has monthly balance columns):</span>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(Number(e.target.value))}
          className="border border-stone-300 rounded px-2 py-1 bg-white"
          disabled={uploading}
        >
          {MONTH_LABELS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(Number(e.target.value))}
          className="border border-stone-300 rounded px-2 py-1 bg-white"
          disabled={uploading}
        >
          {yearOptions.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {availablePeriods.length > 0 && (
          <span className="text-[10px] text-stone-500">
            Periods in file: {availablePeriods.slice(-4).join(', ')}
            {availablePeriods.length > 4 ? '…' : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 disabled:opacity-50 text-sm font-medium rounded-lg"
          style={{ ...parchmentStyles.tabActive, padding: '8px 16px' }}
        >
          <Upload size={14} />
          {uploading ? 'Importing…' : 'Import Excel (.xlsx)'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span>
            {result.message || (
              <>
                Imported <strong>{result.created}</strong> loan(s) across{' '}
                <strong>{result.companies_updated.length}</strong> entit
                {result.companies_updated.length === 1 ? 'y' : 'ies'}.
              </>
            )}
            {result.balance_period_used && (
              <> Balance month used: <strong>{result.balance_period_used}</strong>.</>
            )}
            {result.companies_updated.length > 0 && (
              <> ({result.companies_updated.join(', ')})</>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
