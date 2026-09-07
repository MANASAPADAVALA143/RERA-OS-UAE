/**
 * Property Dev Executive Summary — Partner ROI tab.
 * Entity-scoped (same selector as Deal P&L / Balance Sheet / Cash Flow).
 * Summary Showing Partners Share of Profit / Loss on Sale of Property:
 * Net Profit/Loss is the P&L's aggregate Total Expenses line (payload.plSnapshots'
 * netInc, latest year) rather than an itemized cost breakdown, and each partner's
 * share is allocated by Actual Capital Contribution -- not the imported
 * sharePercent field, which is frequently blank per-partner on the source Excel
 * (see PDUnrealisedGlTab.tsx for the same fallback).
 */
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevBoardExportPayload } from '../../../utils/gatherPropDevBoardExportData';
import { EmptyState } from '../../rental/execSummary/espShared';
import { AlertTriangle } from 'lucide-react';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

interface Props {
  company: CompanyData | undefined;
  payload: PropDevBoardExportPayload | null;
}

export default function PDPartnerRoiTab({ company, payload }: Props) {
  if (!company) {
    return (
      <div className="esp-scope esp-fade-in esp-card">
        <EmptyState icon={<AlertTriangle size={32} />} title="Select an entity" />
      </div>
    );
  }

  const snapshots = payload?.plSnapshots ?? [];
  const netProfit = snapshots.length ? snapshots[snapshots.length - 1].netInc : null;
  const activePartners = (company.partners ?? []).filter(p => (p.status as string) !== 'Exited');
  const totalContribution = activePartners.reduce((s, p) => s + p.capitalContributed, 0);

  const rows = activePartners.map(p => {
    const pctShare = totalContribution > 0 ? (p.capitalContributed / totalContribution) * 100 : 0;
    const profitShare = netProfit != null && totalContribution > 0 ? netProfit * (pctShare / 100) : null;
    const roi = profitShare != null && p.capitalContributed > 0 ? (profitShare / p.capitalContributed) * 100 : null;
    return { id: p.id, name: p.name, pctShare, contribution: p.capitalContributed, profitShare, roi };
  }).sort((a, b) => b.contribution - a.contribution);

  const canCompute = netProfit != null && totalContribution > 0;

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          Summary Showing Partners Share of Profit / Loss on Sale of Property — {company.name}
        </div>
        {!snapshots.length ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon={<AlertTriangle size={32} />} title="P&L data not available" note="Upload P&L financials under Financials to populate." />
          </div>
        ) : !activePartners.length ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon={<AlertTriangle size={32} />} title="No partners on file for this entity" />
          </div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead>
                <tr>
                  <th>Partner Name</th>
                  <th style={{ textAlign: 'right' }}>% Partners Share</th>
                  <th style={{ textAlign: 'right' }}>Amount Contribution Received from Partners (A)</th>
                  <th style={{ textAlign: 'right' }}>Share of Profit / Loss on the Basis of Actual Capital Contribution (B)</th>
                  <th style={{ textAlign: 'right' }}>ROI on Capital Investment [B/A]</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ textAlign: 'right' }}>{r.pctShare.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.contribution)}</td>
                    <td style={{ textAlign: 'right', color: r.profitShare != null && r.profitShare < 0 ? 'var(--critical)' : undefined }}>
                      {r.profitShare != null ? fmtUsd(r.profitShare) : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: r.roi != null && r.roi < 0 ? 'var(--critical)' : 'var(--positive)' }}>
                      {r.roi != null ? `${r.roi.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <td>Total Contribution</td>
                  <td style={{ textAlign: 'right' }}>100.00%</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(totalContribution)}</td>
                  <td style={{ textAlign: 'right' }}>{canCompute ? fmtUsd(netProfit) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
