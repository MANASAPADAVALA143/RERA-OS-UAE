import { useState } from 'react';
import { Download, X } from 'lucide-react';
import type { Period } from '../utils/periodWindow';
import type { CompanyRow, PortfolioSummary, LoanRow } from '../hooks/useRentalCfoData';
import { gatherExecutiveExportPayload } from '../../utils/gatherExecutiveExportData';
import { generateExecutiveSummaryPpt } from '../../utils/executiveSummaryPpt';

const P = {
  pageBg: '#F7F1E6', cardBg: '#FBF6EE', border: '#E8DEC8',
  gold: '#D4AF37', text: '#1C1917', muted: '#78716C',
};

interface ArMonth { month: string; billed: number; collected: number; }
interface FinRow { month: string; account: string; amount: number; }

interface Props {
  companies: CompanyRow[];
  portfolio: PortfolioSummary | null;
  loans: LoanRow[];
  arData: ArMonth[];
  finRows: FinRow[];
  period: Period | null;
  month: number;
  year: number;
  onClose: () => void;
}

export default function ExecSummaryExportModal({
  companies, portfolio, loans, arData, finRows,
  period, month, year, onClose,
}: Props) {
  const [entityId, setEntityId] = useState<string>('portfolio');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      const entityLabel = entityId === 'portfolio'
        ? 'Portfolio_Total'
        : (companies.find(c => c.id === entityId)?.company_name ?? 'Entity');

      const payload = await gatherExecutiveExportPayload({
        entityId,
        entityLabel,
        period,
        month,
        year,
        companies,
        portfolio,
        loans,
        arData,
        finRows,
      });

      await generateExecutiveSummaryPpt(payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const periodDesc = period
    ? `${period} · ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]} ${year}`
    : `Latest available · ${year}`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(28,25,23,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: P.cardBg, border: `1px solid ${P.border}`,
          borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 440,
          boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: P.text, margin: 0 }}>Download PPT</h2>
            <p style={{ fontSize: 12, color: P.muted, marginTop: 4 }}>
              11 slides · period: <strong style={{ color: P.text }}>{periodDesc}</strong>
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: P.muted }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Export for
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: P.text }}>
              <input
                type="radio"
                name="entity"
                checked={entityId === 'portfolio'}
                onChange={() => setEntityId('portfolio')}
              />
              Portfolio Total (all companies consolidated)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: P.text }}>
              <input
                type="radio"
                name="entity"
                checked={entityId !== 'portfolio'}
                onChange={() => setEntityId(companies[0]?.id ?? 'portfolio')}
              />
              Single entity
            </label>
            {entityId !== 'portfolio' && (
              <select
                value={entityId}
                onChange={e => setEntityId(e.target.value)}
                style={{
                  marginLeft: 24, background: P.pageBg, border: `1px solid ${P.border}`,
                  borderRadius: 8, padding: '8px 12px', fontSize: 13, color: P.text,
                }}
              >
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <p style={{ fontSize: 11, color: P.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Slides: Executive Overview → Profitability → Balance Sheet → Occupancy →
          Pricing → Returns → Loans → Income Statement → Balance Sheet → Cash Flow → Action Plan
        </p>

        {error && (
          <p style={{ fontSize: 12, color: '#D9534F', marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${P.border}`,
              background: P.pageBg, fontSize: 13, fontWeight: 600, color: P.muted, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: `linear-gradient(135deg, ${P.gold}, #B8860B)`,
              fontSize: 13, fontWeight: 700, color: '#fff', cursor: exporting ? 'wait' : 'pointer',
              opacity: exporting ? 0.7 : 1,
            }}
          >
            <Download size={14} />
            {exporting ? 'Generating…' : 'Generate PPT'}
          </button>
        </div>
      </div>
    </div>
  );
}
