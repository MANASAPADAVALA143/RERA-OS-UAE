import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { fmtUSD } from '../ProtectedRoute';

export interface QBAgingTotals {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_91_plus: number;
  total: number;
  overdue: number;
}

export interface QBAgingCompany extends QBAgingTotals {
  company_id: string;
  company_name: string;
}

export interface QBAgingLatest {
  has_data: boolean;
  snapshot_count: number;
  latest_snapshot?: { snapshot_month: string; uploaded_at: string; row_count: number; unmatched_count: number };
  portfolio_totals?: QBAgingTotals;
  dso_estimate?: number | null;
  by_company: QBAgingCompany[];
  trend: { month: string; as_of_date: string }[];
}

interface CompanyRow {
  id: string;
  company_name: string;
}

interface CompanyFileRow {
  key: string;
  companyId: string;
  file: File | null;
}

interface QBPreview {
  as_of_date: string;
  snapshot_month: string;
  rows: unknown[];
  row_count: number;
  matched_count: number;
  unmatched_count: number;
  unmatched: { customer: string; unit_ref?: string; building: string }[];
  credit_rows: { customer: string; has_credit: boolean; days_61_90: number; days_91_plus: number }[];
  skipped_subtotals: number;
  portfolio_totals: QBAgingTotals;
  file_summaries?: { filename: string; company_id: string | null; company_name: string; row_count: number }[];
  parse_errors?: string[];
}

const SEL: React.CSSProperties = {
  fontSize: 12,
  border: '1px solid #E8DEC8',
  borderRadius: 6,
  padding: '5px 10px',
  background: '#FBF6EE',
  color: '#374151',
};

function guessCompanyId(filename: string, companies: CompanyRow[]): string {
  const fn = filename.toLowerCase().replace(/[_\-.]/g, ' ');
  for (const c of companies) {
    const parts = c.company_name.toLowerCase().split(/\s+/).filter(p => p.length > 2);
    if (parts.some(p => fn.includes(p))) return c.id;
  }
  return companies[0]?.id ?? '';
}

/** Weighted DSO from QB aging buckets — same formula as backend. */
export function estimateDsoFromBuckets(t: Pick<QBAgingTotals, 'current' | 'days_1_30' | 'days_31_60' | 'days_61_90' | 'days_91_plus' | 'total'>): number | null {
  if (!t.total || t.total <= 0) return null;
  const weighted = (
    t.current * 0 +
    t.days_1_30 * 15 +
    t.days_31_60 * 45 +
    t.days_61_90 * 75 +
    t.days_91_plus * 105
  ) / t.total;
  return Math.round(weighted);
}

interface Props {
  qbAging: QBAgingLatest | null;
  qbLoading: boolean;
  onRefresh: () => void;
  defaultExpanded?: boolean;
}

export default function QbArAgingUploadPanel({ qbAging, qbLoading, onRefresh, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded || !qbAging?.has_data);
  const [uploadMode, setUploadMode] = useState<'company' | 'portfolio'>('company');
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [companyFiles, setCompanyFiles] = useState<CompanyFileRow[]>([]);
  const [qbFile, setQbFile] = useState<File | null>(null);
  const [qbAsOfDate, setQbAsOfDate] = useState('');
  const [qbPreview, setQbPreview] = useState<QBPreview | null>(null);
  const [qbUploading, setQbUploading] = useState(false);
  const [qbConfirming, setQbConfirming] = useState(false);
  const [qbError, setQbError] = useState('');
  const qbFileRef = useRef<HTMLInputElement>(null);
  const multiFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<CompanyRow[]>('/api/rentals/companies')
      .then(r => setCompanies(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCompanies([]));
  }, []);

  const addCompanyRow = (file?: File, companyId?: string) => {
    const cid = companyId ?? companies[0]?.id ?? '';
    setCompanyFiles(prev => [...prev, { key: `${Date.now()}-${Math.random()}`, companyId: cid, file: file ?? null }]);
  };

  const handlePreview = async () => {
    if (!qbAsOfDate) {
      setQbError('Set the report as-of date.');
      return;
    }
    setQbError('');
    setQbUploading(true);
    setQbPreview(null);

    try {
      if (uploadMode === 'company') {
        const ready = companyFiles.filter(r => r.file && r.companyId);
        if (!ready.length) {
          setQbError('Add at least one company file (select company + Excel).');
          return;
        }
        const fd = new FormData();
        ready.forEach(r => {
          fd.append('files', r.file!);
          fd.append('company_ids', r.companyId);
        });
        fd.append('as_of_date', qbAsOfDate);
        fd.append('snapshot_month', qbAsOfDate.slice(0, 7));
        const r = await api.post<QBPreview>('/api/rentals/ar-ap/qb-aging/preview-batch', fd);
        setQbPreview(r.data);
      } else {
        if (!qbFile) {
          setQbError('Select a portfolio AR Aging file.');
          return;
        }
        const fd = new FormData();
        fd.append('file', qbFile);
        fd.append('as_of_date', qbAsOfDate);
        fd.append('snapshot_month', qbAsOfDate.slice(0, 7));
        const r = await api.post<QBPreview>('/api/rentals/ar-ap/qb-aging/preview', fd);
        setQbPreview(r.data);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setQbError(typeof msg === 'string' ? msg : 'Preview failed.');
    } finally {
      setQbUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!qbPreview || !qbAsOfDate) return;
    setQbConfirming(true);
    setQbError('');
    try {
      await api.post('/api/rentals/ar-ap/qb-aging/confirm', {
        as_of_date: qbAsOfDate,
        snapshot_month: qbPreview.snapshot_month,
        rows: qbPreview.rows,
      });
      setQbPreview(null);
      setQbFile(null);
      setCompanyFiles([]);
      setQbAsOfDate('');
      if (qbFileRef.current) qbFileRef.current.value = '';
      if (multiFileRef.current) multiFileRef.current.value = '';
      setExpanded(false);
      onRefresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | object } } };
      const raw = err?.response?.data?.detail;
      setQbError(typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : 'Confirm failed.');
    } finally {
      setQbConfirming(false);
    }
  };

  const resetForm = () => {
    setQbPreview(null);
    setQbFile(null);
    setCompanyFiles([]);
    setQbError('');
    if (qbFileRef.current) qbFileRef.current.value = '';
    if (multiFileRef.current) multiFileRef.current.value = '';
  };

  const onMultiFilePick = (files: FileList | null) => {
    if (!files?.length) return;
    const next: CompanyFileRow[] = [];
    Array.from(files).forEach(f => {
      next.push({
        key: `${Date.now()}-${f.name}`,
        companyId: guessCompanyId(f.name, companies),
        file: f,
      });
    });
    setCompanyFiles(prev => [...prev, ...next]);
    setQbPreview(null);
  };

  return (
    <div style={{ border: '1px solid #E8DEC8', borderRadius: 10, overflow: 'hidden', background: '#FDFAF4' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: expanded ? '1px solid #E8DEC8' : 'none',
        background: '#F5F0E8', flexWrap: 'wrap', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#3A2F1F' }}>AR Aging Upload</span>
          {qbLoading && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Loading…</span>}
          {!qbLoading && qbAging?.has_data && (
            <span style={{
              fontSize: 11, padding: '2px 10px', borderRadius: 20,
              background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0', fontWeight: 600,
            }}>
              ✓ Latest {qbAging.latest_snapshot?.snapshot_month}
            </span>
          )}
          {!qbLoading && !qbAging?.has_data && (
            <span style={{
              fontSize: 11, padding: '2px 10px', borderRadius: 20,
              background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', fontWeight: 600,
            }}>
              No upload yet
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          style={{
            fontSize: 12, padding: '5px 14px', borderRadius: 6,
            border: '1px solid #D4AF37',
            background: expanded ? '#FBF6EE' : 'linear-gradient(135deg,#D4AF37,#B8860B)',
            color: expanded ? '#5C5043' : '#fff',
            cursor: 'pointer', fontWeight: 600,
          }}
        >
          {expanded ? '▲ Hide' : qbAging?.has_data ? '+ Update AR Aging' : '▲ Upload AR Aging'}
        </button>
      </div>

      {expanded && (
        <div style={{ padding: 14 }}>
          <p style={{ fontSize: 12, color: '#78716C', marginBottom: 12, lineHeight: 1.5 }}>
            Upload your <strong>company-wise AR Aging Summary</strong> Excel files (one per entity), or a single
            portfolio QuickBooks export. Populates Overview aging buckets, arrears days, and risk table.
          </p>

          <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#3A2F1F', cursor: 'pointer' }}>
              <input type="radio" checked={uploadMode === 'company'} onChange={() => { setUploadMode('company'); setQbPreview(null); }} />
              Company-wise files (recommended)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#3A2F1F', cursor: 'pointer' }}>
              <input type="radio" checked={uploadMode === 'portfolio'} onChange={() => { setUploadMode('portfolio'); setQbPreview(null); }} />
              Single portfolio QB file
            </label>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#5C5043', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Report As-Of Date
            </div>
            <input
              type="date"
              value={qbAsOfDate}
              onChange={e => { setQbAsOfDate(e.target.value); setQbPreview(null); }}
              style={{ ...SEL, padding: '7px 12px' }}
            />
          </div>

          {uploadMode === 'company' ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#5C5043', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Company files
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => addCompanyRow()} style={{ ...SEL, cursor: 'pointer', fontWeight: 600 }}>
                    + Add row
                  </button>
                  <label style={{ ...SEL, cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>
                    📎 Pick multiple files
                    <input
                      ref={multiFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      multiple
                      onChange={e => onMultiFilePick(e.target.files)}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              {companyFiles.length === 0 && (
                <p style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 8 }}>
                  Click &quot;Pick multiple files&quot; to add all your company aging Excel files at once, or add rows one by one.
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {companyFiles.map((row, idx) => (
                  <div key={row.key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      value={row.companyId}
                      onChange={e => {
                        const v = e.target.value;
                        setCompanyFiles(prev => prev.map((r, i) => i === idx ? { ...r, companyId: v } : r));
                        setQbPreview(null);
                      }}
                      style={{ ...SEL, minWidth: 160, flex: 1 }}
                    >
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.company_name}</option>
                      ))}
                    </select>
                    <label style={{ ...SEL, flex: 2, minWidth: 180, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>📎</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.file?.name ?? 'Choose .xlsx'}
                      </span>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={e => {
                          const f = e.target.files?.[0] ?? null;
                          setCompanyFiles(prev => prev.map((r, i) => i === idx ? { ...r, file: f } : r));
                          setQbPreview(null);
                        }}
                        style={{ display: 'none' }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setCompanyFiles(prev => prev.filter((_, i) => i !== idx))}
                      style={{ ...SEL, color: '#B91C1C', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#5C5043', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Portfolio QB Excel
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                border: '1px solid #E8DEC8', borderRadius: 6, background: '#FBF6EE',
                cursor: 'pointer', fontSize: 12, color: '#5C5043', fontWeight: 500,
              }}>
                <span>📎</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {qbFile ? qbFile.name : 'AR Aging Detail by Customer.xlsx'}
                </span>
                <input
                  ref={qbFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={e => { setQbFile(e.target.files?.[0] ?? null); setQbPreview(null); }}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={handlePreview}
            disabled={!qbAsOfDate || qbUploading}
            style={{
              padding: '7px 20px', borderRadius: 6, border: 'none',
              background: (!qbAsOfDate || qbUploading) ? '#D4AF3766' : 'linear-gradient(135deg,#D4AF37,#B8860B)',
              color: '#fff', fontWeight: 700, fontSize: 13,
              cursor: (!qbAsOfDate || qbUploading) ? 'not-allowed' : 'pointer',
              marginBottom: 10,
            }}
          >
            {qbUploading ? 'Parsing…' : 'Preview merged upload'}
          </button>

          {qbError && (
            <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#B91C1C' }}>
              {qbError}
            </div>
          )}

          {qbPreview && (
            <div style={{ marginTop: 16 }}>
              {qbPreview.file_summaries && qbPreview.file_summaries.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5C5043', marginBottom: 6 }}>FILES PARSED</div>
                  {qbPreview.file_summaries.map((f, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 2 }}>
                      ✓ {f.company_name}: {f.filename} ({f.row_count} rows)
                    </div>
                  ))}
                </div>
              )}
              {qbPreview.parse_errors && qbPreview.parse_errors.length > 0 && (
                <div style={{ fontSize: 11, color: '#92400E', marginBottom: 10 }}>
                  ⚠️ {qbPreview.parse_errors.join(' · ')}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                {[
                  { label: 'Rows Parsed', value: qbPreview.row_count },
                  { label: 'Unit Matched', value: qbPreview.matched_count },
                  { label: 'Unit Unmatched', value: qbPreview.unmatched_count },
                ].map(k => (
                  <div key={k.label} style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 80 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#262626' }}>{k.value}</div>
                    <div style={{ fontSize: 10, color: '#6B6B6B', marginTop: 2, fontWeight: 600 }}>{k.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {[
                  { label: 'Current', v: qbPreview.portfolio_totals.current, c: '#166534' },
                  { label: '1–30d', v: qbPreview.portfolio_totals.days_1_30, c: '#F5A623' },
                  { label: '31–60d', v: qbPreview.portfolio_totals.days_31_60, c: '#E97316' },
                  { label: '61–90d', v: qbPreview.portfolio_totals.days_61_90, c: '#DC2626' },
                  { label: '90+d', v: qbPreview.portfolio_totals.days_91_plus, c: '#991B1B' },
                ].map(b => (
                  <div key={b.label} style={{ flex: 1, minWidth: 72, background: '#FBF6EE', borderRadius: 8, padding: '8px 10px', textAlign: 'center', borderTop: `3px solid ${b.c}` }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: b.c }}>{fmtUSD(b.v)}</div>
                    <div style={{ fontSize: 10, color: '#6B6B6B', marginTop: 2 }}>{b.label}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={qbConfirming}
                  style={{
                    padding: '8px 22px', borderRadius: 6, border: 'none',
                    background: qbConfirming ? '#86EFAC' : 'linear-gradient(135deg,#166534,#16A34A)',
                    color: '#fff', fontWeight: 700, fontSize: 13,
                    cursor: qbConfirming ? 'not-allowed' : 'pointer',
                  }}
                >
                  {qbConfirming ? 'Saving…' : 'Confirm & Save'}
                </button>
                <button type="button" onClick={resetForm} style={{ ...SEL, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
