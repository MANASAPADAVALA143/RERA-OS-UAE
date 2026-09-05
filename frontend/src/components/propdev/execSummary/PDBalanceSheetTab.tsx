import { AlertTriangle } from 'lucide-react';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevBoardExportPayload } from '../../../utils/gatherPropDevBoardExportData';
import { pickFocusSnapshot } from '../../../utils/gatherPropDevBoardExportData';
import PropDevCfoBsCharts from '../PropDevCfoBsCharts';
import { EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function bandColor(value: number | null, low: number, high: number, invert = false): string {
  if (value == null) return 'var(--slate)';
  const lowOk = invert ? value >= high : value < low;
  const highBad = invert ? value < low : value >= high;
  if (lowOk) return 'var(--active)';
  if (highBad) return 'var(--overdue)';
  return 'var(--pending)';
}

interface Props {
  company: CompanyData | undefined;
  payload: PropDevBoardExportPayload | null;
}

export default function PDBalanceSheetTab({ company, payload }: Props) {
  if (!company) {
    return <div className="esp-scope esp-fade-in esp-card"><EmptyState icon={<AlertTriangle size={32} />} title="Select an entity" /></div>;
  }

  const bs = payload ? pickFocusSnapshot(payload.bsSnapshots, payload.focusYear) : null;

  if (!bs || !payload) {
    return (
      <div className="esp-scope esp-fade-in esp-card">
        <div className="esp-section-title">Balance Sheet — {company.name}</div>
        <EmptyState icon={<AlertTriangle size={32} />} title="Balance sheet data not available" note="Upload Balance Sheet financials under Financials to populate." />
      </div>
    );
  }

  const currentRatio = bs.totalDebt > 0 ? bs.totalAssets / bs.totalDebt : null;
  const debtToEquity = bs.equity !== 0 ? bs.totalDebt / bs.equity : null;

  const cards = [
    { label: 'Total Assets', value: fmtUsd(bs.totalAssets), accent: 'var(--active)', valueColor: 'var(--active)' },
    { label: 'Total Liabilities', value: fmtUsd(bs.totalDebt), accent: 'var(--overdue)', valueColor: 'var(--overdue)' },
    { label: 'Equity', value: fmtUsd(bs.equity), accent: 'var(--gold)', valueColor: bs.equity >= 0 ? 'var(--gold)' : 'var(--pending)' },
    { label: 'Current Ratio', value: currentRatio != null ? `${currentRatio.toFixed(2)}x` : '—', accent: bandColor(currentRatio, 1, 2, true), valueColor: bandColor(currentRatio, 1, 2, true) },
    { label: 'Debt-to-Equity', value: debtToEquity != null ? `${debtToEquity.toFixed(2)}x` : '—', accent: bandColor(debtToEquity, 1, 2), valueColor: bandColor(debtToEquity, 1, 2) },
    { label: 'LTLV %', value: bs.ltlv != null ? `${bs.ltlv.toFixed(1)}%` : '—', accent: bandColor(bs.ltlv, 60, 80), valueColor: bandColor(bs.ltlv, 60, 80) },
  ];

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {cards.map(c => (
          <div key={c.label} className="esp-card" style={{ borderLeft: `3px solid ${c.accent}`, padding: '16px 20px' }}>
            <div className="esp-label">{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.valueColor, marginTop: 6 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="esp-card">
        <div className="esp-section-title">Balance Sheet Trend — {company.name}</div>
        <PropDevCfoBsCharts snapshots={payload.bsSnapshots} selectedYear={payload.focusYear ?? bs.year} companyName={company.name} />
      </div>
    </div>
  );
}
