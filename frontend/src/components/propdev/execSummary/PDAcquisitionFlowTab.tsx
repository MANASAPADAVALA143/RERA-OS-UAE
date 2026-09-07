/**
 * Property Dev Executive Summary — Acquisition Flow tab.
 * Entity-scoped (same selector as Deal P&L / Balance Sheet / Cash Flow).
 * Sections: A (Land Acquisition Summary), C (Fair Value vs Book Value),
 * D (Capital Call Trigger Panel). Section B (Carrying Costs) deferred —
 * needs new P&L expense-category logic, not in this phase.
 */
import { useMemo } from 'react';
import { Landmark, Scale, TrendingUp, AlertTriangle } from 'lucide-react';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { EmptyState, BadgePill, type EspStatus } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function ltvColor(ltv: number | null): string {
  if (ltv == null) return 'var(--slate)';
  if (ltv < 60) return 'var(--active)';
  if (ltv <= 70) return 'var(--pending)';
  return 'var(--overdue)';
}

interface Props {
  company: CompanyData | undefined;
  kpis: PropDevCompanyOverviewKpis | undefined;
}

export default function PDAcquisitionFlowTab({ company, kpis }: Props) {
  const rawLandCost = company?.property?.landCost;
  const landCost = rawLandCost != null && rawLandCost > 0 ? rawLandCost : (kpis?.landValue ?? null);
  // Book Value = Balance Sheet Land + Improvements (kpis.bookValue) -- not Land +
  // Acquisition Costs. Acquisition Costs itself is dropped from this section.
  const bookValue = kpis?.bookValue ?? null;

  const bankFunded = kpis?.loanOutstanding ?? kpis?.loanBalance ?? 0;
  const equityFunded = bookValue != null ? Math.max(0, bookValue - bankFunded) : null;
  const ltvAtAcquisition = bookValue && bookValue > 0 ? (bankFunded / bookValue) * 100 : null;

  const currentLandValue = kpis?.landValue ?? null;
  const unrealisedGain = currentLandValue != null && bookValue != null ? currentLandValue - bookValue : null;
  const ltvNow = currentLandValue && currentLandValue > 0 ? ((kpis?.loanBalance ?? 0) / currentLandValue) * 100 : null;
  const capitalCallRisk = unrealisedGain != null && unrealisedGain < 0;

  const monthlyBurn = useMemo(() => {
    const loans = company?.loans ?? [];
    return loans.filter(l => l.status === 'Active').reduce((s, l) => s + (l.emi || 0), 0);
  }, [company]);
  const cashRunwayMonths = kpis?.cash != null && monthlyBurn > 0 ? kpis.cash / monthlyBurn : null;

  const ltv60GapAmount = useMemo(() => {
    if (currentLandValue == null || currentLandValue <= 0) return null;
    const targetDebt = currentLandValue * 0.60;
    const gap = (kpis?.loanBalance ?? 0) - targetDebt;
    return gap > 0 ? gap : 0;
  }, [currentLandValue, kpis]);

  const callNeeded = capitalCallRisk || (ltvNow != null && ltvNow > 70);
  const partners = kpis?.partners ?? [];

  if (!company) {
    return <p style={{ fontSize: 13, color: '#78716C' }}>Select an entity to view Acquisition Flow.</p>;
  }

  const kpiCardsA = [
    { label: 'Land Cost', value: fmtUsd(landCost), accent: 'var(--gold)' },
    { label: 'Book Value', value: fmtUsd(bookValue), accent: 'var(--navy)', sub: 'Land + Improvements (Balance Sheet)' },
    { label: 'Funded by Equity', value: fmtUsd(equityFunded), accent: 'var(--active)' },
    { label: 'Funded by Bank', value: fmtUsd(bankFunded), accent: 'var(--overdue)' },
    { label: 'LTV at Acquisition', value: ltvAtAcquisition != null ? `${ltvAtAcquisition.toFixed(1)}%` : '—', accent: ltvColor(ltvAtAcquisition) },
  ];

  const kpiCardsC = [
    { label: 'Current Land Value (FV)', value: fmtUsd(currentLandValue), accent: 'var(--gold)' },
    { label: 'Book Value', value: fmtUsd(bookValue), accent: 'var(--navy)' },
    { label: 'Unrealised Gain / (Loss)', value: fmtUsd(unrealisedGain), accent: unrealisedGain != null && unrealisedGain < 0 ? 'var(--overdue)' : 'var(--active)' },
    { label: 'LTV Now', value: ltvNow != null ? `${ltvNow.toFixed(1)}%` : '—', accent: ltvColor(ltvNow) },
  ];

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Section A — Land Acquisition Summary */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <Landmark size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Land Acquisition Summary
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: 20 }}>
          {kpiCardsA.map(c => (
            <div key={c.label} className="esp-card" style={{ borderLeft: `3px solid ${c.accent}`, padding: '14px 16px' }}>
              <div className="esp-label">{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: c.accent, marginTop: 4 }}>{c.value}</div>
              {c.sub && <div className="esp-sub" style={{ marginTop: 4 }}>{c.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Section C — Fair Value vs Book Value */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="esp-section-title" style={{ padding: 0 }}>
            <Scale size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Fair Value vs Book Value
          </span>
          {capitalCallRisk && (
            <span className="esp-pill" style={{ background: 'var(--overdue-bg)', color: 'var(--overdue)', fontWeight: 700 }}>Capital Call Risk</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: 20 }}>
          {kpiCardsC.map(c => (
            <div key={c.label} className="esp-card" style={{ borderLeft: `3px solid ${c.accent}`, padding: '14px 16px' }}>
              <div className="esp-label">{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: c.accent, marginTop: 4 }}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section D — Capital Call Trigger Panel */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <TrendingUp size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Capital Call Trigger Panel
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, padding: '20px 24px' }}>
          <div>
            <div className="esp-label">Cash Runway</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{cashRunwayMonths != null ? `${cashRunwayMonths.toFixed(1)} mo` : '—'}</div>
          </div>
          <div>
            <div className="esp-label">LTV Status</div>
            <div style={{ marginTop: 4 }}>
              <span className="esp-pill" style={{ background: ltvNow != null && ltvNow > 70 ? 'var(--overdue-bg)' : ltvNow != null && ltvNow >= 60 ? 'var(--pending-bg)' : 'var(--active-bg)', color: ltvColor(ltvNow) }}>
                {ltvNow != null ? `${ltvNow.toFixed(0)}%` : '—'}
              </span>
            </div>
          </div>
          <div>
            <div className="esp-label">Capital Call Needed?</div>
            <div style={{ marginTop: 4 }}>
              <BadgePill badge={(callNeeded ? 'Overdue' : 'Active') as EspStatus} />
            </div>
          </div>
          <div>
            <div className="esp-label">Call Amount (to restore 60% LTV)</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: ltv60GapAmount ? 'var(--overdue)' : 'var(--navy-text)' }}>
              {ltv60GapAmount != null ? fmtUsd(ltv60GapAmount) : '—'}
            </div>
          </div>
        </div>

        {partners.length === 0 || !ltv60GapAmount ? (
          <div style={{ padding: '0 24px 20px' }}>
            <EmptyState icon={<AlertTriangle size={28} />} title={partners.length === 0 ? 'No partner data for allocation' : 'No capital call needed'} />
          </div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '0 0 4px' }}>
            <table className="esp-table">
              <thead><tr><th>Partner</th><th style={{ textAlign: 'right' }}>Share %</th><th style={{ textAlign: 'right' }}>Allocation</th><th>Status</th></tr></thead>
              <tbody>
                {partners.map(p => {
                  const allocation = ltv60GapAmount * (p.sharePercent / 100);
                  const call = (company.capitalCalls ?? []).find(cc => cc.partnerName === p.name);
                  return (
                    <tr key={p.name} className="esp-row-hover">
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td style={{ textAlign: 'right' }}>{p.sharePercent.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(allocation)}</td>
                      <td>
                        <span className="esp-pill" style={{
                          background: call?.status === 'Paid' ? 'var(--active-bg)' : call?.status === 'Partial' ? 'var(--pending-bg)' : 'var(--overdue-bg)',
                          color: call?.status === 'Paid' ? 'var(--active)' : call?.status === 'Partial' ? 'var(--pending-dark)' : 'var(--overdue)',
                        }}>
                          {call?.status ?? 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
