import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, Download } from 'lucide-react';
import api, { formatApiError, postUploadWithWake } from '../../services/api';
import { notifyPropDevCompaniesRefresh } from '../../utils/propDevSync';
import { parchmentStyles } from '../../theme/parchmentTheme';

interface Props {
  onImported: () => void | Promise<void>;
  onClose?: () => void;
}

interface ImportResult {
  imported_count?: number;
  partners_imported?: number;
  companies_updated?: number;
  companies?: string[];
  skipped_non_propdev?: number;
  skipped_non_rental?: number;
  sheets_parsed?: string[];
  errors?: string[];
  message?: string;
}

export default function PartnerOwnershipUpload({ onImported, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await postUploadWithWake<ImportResult>('/api/propdev/import-partner-ownership', form);
      const data = res.data;
      const count = data.imported_count ?? data.partners_imported ?? 0;
      const skipped = data.skipped_non_propdev ?? data.skipped_non_rental ?? 0;
      const sheets = data.sheets_parsed?.length
        ? ` Sheets: ${data.sheets_parsed.join(', ')}.`
        : '';
      const warnings = (data.errors ?? []).filter(Boolean);

      if (count === 0) {
        setMessage({
          type: 'error',
          text: warnings.join('; ') || data.message ||
            'No partner rows imported. Use Entity = Construction, Development, Holding, Prop Dev, or Partner and match Entity Name to Company Registry.',
        });
      } else {
        const skipText = skipped > 0
          ? ` Skipped ${skipped} row(s) where Entity is not Construction / Development / Holding / Prop Dev / Partner.`
          : '';
        const warnText = warnings.length
          ? ` (${warnings.length} row warning(s): ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''})`
          : '';
        const companies = data.companies?.length
          ? ` Companies: ${data.companies.join(', ')}.`
          : '';
        setMessage({
          type: 'success',
          text: data.message || `Imported ${count} Property Dev partner position(s).${sheets}${companies}${skipText}${warnText}`,
        });
        notifyPropDevCompaniesRefresh();
        await Promise.resolve(onImported());
      }
    } catch (e: unknown) {
      setMessage({ type: 'error', text: formatApiError(e, 'Partner upload failed') });
    } finally {
      setUploading(false);
    }
  };

  async function downloadTemplate() {
    try {
      const response = await api.get('/api/propdev/import-partner-ownership-template', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'Ownership_Import_Template.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setMessage({ type: 'error', text: 'Failed to download import template.' });
    }
  }

  return (
    <div className="rounded-xl p-4 space-y-3" style={parchmentStyles.uploadBar}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#1C1917' }}>
            <FileSpreadsheet size={16} /> Update Partner Input Data
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: '#57534E' }}>
            Upload the same ownership workbook used in <strong>Rentals → Ownership</strong> (.xlsx).
            The importer reads <strong>all three</strong> register tabs:{' '}
            <strong>Personal Entities</strong>, <strong>Partnership Entities (Family)</strong>, and{' '}
            <strong>Partnership Entities</strong>. Property Dev keeps rows where{' '}
            <strong>Entity = Construction, Development, Holding, Prop Dev, or Partner</strong>{' '}
            (Rental/Land/Personal lines are skipped).{' '}
            <strong>Entity Name must match Property Dev Company Registry</strong> — re-upload replaces all partner positions.
            Use <strong>Capital Contributed</strong> for actual cash invested; if blank, the system estimates{' '}
            <strong>Cost Basis − Existing Debt</strong> (labeled as estimated in the UI).
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={16} />
          </button>
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
          {uploading ? 'Uploading…' : 'Import Excel (.xlsx)'}
        </button>
        <button
          type="button"
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        >
          <Download size={14} />
          Download Template
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

      {message?.type === 'error' && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{message.text}</span>
        </div>
      )}

      {message?.type === 'success' && (
        <div className="flex items-start gap-2 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}
