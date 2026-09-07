import { Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevBoardExportPayload } from '../../../utils/gatherPropDevBoardExportData';
import { EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}
function yFmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

interface Props {
  company: CompanyData | undefined;
  payload: PropDevBoardExportPayload | null;
}

export default function PDDealPLTab({ company, payload }: Props) {
  if (!company) {
    return (
      <div className="esp-scope esp-fade-in esp-card">
        <EmptyState icon={<AlertTriangle size={32} />} title="Select an entity" />
      </div>
    );
  }
  const snapshots = payload?.plSnapshots ?? [];

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Deal P&amp;L — {company.name}</div>
        {snapshots.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="P&L data not available" note="Upload P&L financials under Financials to populate." />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={snapshots.map(s => ({ year: s.yearLabel, Revenue: s.rev, Expenses: s.exp, NOI: s.noi, 'Net Income': s.netInc }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--slate)' }} />
                <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: 'var(--slate)' }} width={64} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Revenue" fill="#1B3A6B" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Expenses" fill="#F5A623" radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="NOI" stroke="#5B5FEF" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Net Income" stroke="#5BB5A2" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>

            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table className="esp-table">
                <thead>
                  <tr>
                    <th>Year</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Expenses</th><th style={{ textAlign: 'right' }}>NOI</th><th style={{ textAlign: 'right' }}>Interest</th><th style={{ textAlign: 'right' }}>Net Income</th><th style={{ textAlign: 'right' }}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map(s => (
                    <tr key={s.year} className="esp-row-hover">
                      <td style={{ fontWeight: 600 }}>{s.yearLabel}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(s.rev)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--pending-dark)' }}>{fmtUsd(s.exp)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: s.noi >= 0 ? 'var(--growth)' : 'var(--overdue)' }}>{fmtUsd(s.noi)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(s.interest)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: s.netInc >= 0 ? 'var(--growth)' : 'var(--overdue)' }}>{fmtUsd(s.netInc)}</td>
                      <td style={{ textAlign: 'right' }}>{s.margin != null ? `${s.margin.toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
