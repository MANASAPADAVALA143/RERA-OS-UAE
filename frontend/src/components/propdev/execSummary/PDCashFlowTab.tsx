import { AlertTriangle } from 'lucide-react';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevBoardExportPayload } from '../../../utils/gatherPropDevBoardExportData';
import { pickFocusSnapshot } from '../../../utils/gatherPropDevBoardExportData';
import PropDevCfoCfCharts from '../PropDevCfoCfCharts';
import { EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

interface Props {
  company: CompanyData | undefined;
  payload: PropDevBoardExportPayload | null;
  allLoans: Loan[];
}

export default function PDCashFlowTab({ company, payload, allLoans }: Props) {
  if (!company) {
    return <div className="esp-scope esp-fade-in esp-card"><EmptyState icon={<AlertTriangle size={32} />} title="Select an entity" /></div>;
  }

  const cf = payload ? pickFocusSnapshot(payload.cfSnapshots, payload.focusYear) : null;

  if (!cf || !payload) {
    return (
      <div className="esp-scope esp-fade-in esp-card">
        <div className="esp-section-title">Cash Flow — {company.name}</div>
        <EmptyState icon={<AlertTriangle size={32} />} title="Cash flow data not available" note="Upload Cash Flow financials under Financials to populate." />
      </div>
    );
  }

  const runwayColor = cf.cashRunwayMonths == null ? 'var(--slate)'
    : cf.cashRunwayMonths > 12 ? 'var(--active)'
      : cf.cashRunwayMonths >= 6 ? 'var(--pending)' : 'var(--overdue)';

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="esp-card" style={{ borderLeft: `4px solid ${runwayColor}` }}>
        <div className="esp-label">Cash Runway</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: runwayColor, marginTop: 4 }}>
          {cf.cashRunwayMonths != null ? `${cf.cashRunwayMonths.toFixed(1)} months` : 'N/A'}
        </div>
        <div className="esp-sub" style={{ marginTop: 4 }}>Closing cash ÷ average monthly expenses</div>
      </div>

      <div className="esp-card">
        <div className="esp-section-title">Cash Flow — {company.name}</div>
        <PropDevCfoCfCharts snapshots={payload.cfSnapshots} selectedYear={payload.focusYear ?? cf.year} company={company} allLoans={allLoans} companyName={company.name} />
      </div>
    </div>
  );
}
