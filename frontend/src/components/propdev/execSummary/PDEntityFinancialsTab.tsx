import { useState } from 'react';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevBoardExportPayload } from '../../../utils/gatherPropDevBoardExportData';
import PDDealPLTab from './PDDealPLTab';
import PDBalanceSheetTab from './PDBalanceSheetTab';
import PDCashFlowTab from './PDCashFlowTab';
import '../../../theme/execSummaryPremium.css';

type SubTab = 'pl' | 'bs' | 'cf';

interface Props {
  company: CompanyData;
  payload: PropDevBoardExportPayload | null;
  allLoans: Loan[];
}

export default function PDEntityFinancialsTab({ company, payload, allLoans }: Props) {
  const [sub, setSub] = useState<SubTab>('pl');
  return (
    <div className="esp-scope esp-fade-in">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {([['pl', 'P&L'], ['bs', 'Balance Sheet'], ['cf', 'Cash Flow']] as [SubTab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSub(id)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: sub === id ? 'var(--navy)' : 'var(--card)',
              color: sub === id ? '#fff' : 'var(--slate)',
              border: `1px solid ${sub === id ? 'var(--navy)' : 'var(--border)'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === 'pl' && <PDDealPLTab company={company} payload={payload} />}
      {sub === 'bs' && <PDBalanceSheetTab company={company} payload={payload} />}
      {sub === 'cf' && <PDCashFlowTab company={company} payload={payload} allLoans={allLoans} />}
    </div>
  );
}
