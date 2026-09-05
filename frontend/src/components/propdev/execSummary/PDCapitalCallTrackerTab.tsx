/**
 * Property Dev Executive Summary — Capital Call Tracker tab.
 * Portfolio-wide call history log, flagging which calls were auto-generated
 * (lot reinvestment shortfall / unrealised loss) vs. manually logged.
 */
import { useMemo } from 'react';
import { Landmark } from 'lucide-react';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import { EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Paid: { bg: 'var(--active-bg)', color: 'var(--active)' },
  Partial: { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' },
  Outstanding: { bg: 'var(--overdue-bg)', color: '#6D28D9' },
  Overdue: { bg: 'var(--overdue-bg)', color: '#6D28D9' },
};

interface Props {
  companies: CompanyData[];
  loading: boolean;
}

export default function PDCapitalCallTrackerTab({ companies, loading }: Props) {
  const rows = useMemo(() => {
    const out: {
      key: string; entity: string; partner: string; period: string;
      called: number; received: number; balance: number; status: string;
      sourceType: string; reason: string | null;
    }[] = [];
    for (const c of companies) {
      for (const cc of c.capitalCalls ?? []) {
        out.push({
          key: cc.id,
          entity: c.name,
          partner: cc.partnerName,
          period: cc.period,
          called: cc.totalDue ?? 0,
          received: cc.received ?? 0,
          balance: Math.max(0, (cc.totalDue ?? 0) - (cc.received ?? 0)),
          status: cc.status,
          sourceType: cc.sourceType,
          reason: cc.reason,
        });
      }
    }
    return out.sort((a, b) => b.balance - a.balance);
  }, [companies]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    called: acc.called + r.called,
    received: acc.received + r.received,
    balance: acc.balance + r.balance,
  }), { called: 0, received: 0, balance: 0 }), [rows]);

  const autoCount = rows.filter(r => r.sourceType !== 'manual').length;

  if (loading) return <p style={{ fontSize: 13, color: '#78716C' }}>Loading capital calls…</p>;

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <div className="esp-card" style={{ borderLeft: '4px solid var(--gold)' }}>
          <div className="esp-label">Total Called</div>
          <div className="esp-value">{fmtUsd(totals.called)}</div>
        </div>
        <div className="esp-card" style={{ borderLeft: '4px solid var(--active)' }}>
          <div className="esp-label">Total Received</div>
          <div className="esp-value" style={{ color: 'var(--active)' }}>{fmtUsd(totals.received)}</div>
        </div>
        <div className="esp-card" style={{ borderLeft: `4px solid ${totals.balance > 0 ? 'var(--overdue)' : 'var(--active)'}` }}>
          <div className="esp-label">Outstanding Balance</div>
          <div className="esp-value" style={{ color: totals.balance > 0 ? 'var(--overdue)' : 'var(--navy-text)' }}>{fmtUsd(totals.balance)}</div>
        </div>
        <div className="esp-card" style={{ borderLeft: '4px solid var(--navy)' }}>
          <div className="esp-label">Auto-Generated Calls</div>
          <div className="esp-value">{autoCount}</div>
          <div className="esp-sub" style={{ marginTop: 4 }}>Lot reinvestment shortfall or unrealised loss</div>
        </div>
      </div>

      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <Landmark size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Call History Log
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<Landmark size={32} />} title="No capital calls recorded" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead>
                <tr>
                  <th>Entity</th><th>Partner</th><th>Period</th><th>Source</th>
                  <th style={{ textAlign: 'right' }}>Called</th><th style={{ textAlign: 'right' }}>Received</th>
                  <th style={{ textAlign: 'right' }}>Balance</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.entity}</td>
                    <td>{r.partner}</td>
                    <td>{r.period}</td>
                    <td>
                      {r.sourceType === 'lot_reinvestment' ? (
                        <span className="esp-pill cursor-help" style={{ background: '#E8EFF8', color: 'var(--navy)' }} title={r.reason ?? undefined}>
                          Auto: Lot Reinvestment
                        </span>
                      ) : r.sourceType === 'unrealised_loss' ? (
                        <span className="esp-pill cursor-help" style={{ background: '#FEF3E2', color: 'var(--warning)' }} title={r.reason ?? undefined}>
                          Auto: Unrealised Loss
                        </span>
                      ) : (
                        <span className="esp-pill" style={{ background: 'var(--gold-light)', color: 'var(--gold)' }}>Manual</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.called)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--active)' }}>{fmtUsd(r.received)}</td>
                    <td style={{ textAlign: 'right', fontWeight: r.balance > 0 ? 700 : 400, color: r.balance > 0 ? 'var(--overdue)' : 'var(--active)' }}>{r.balance > 0 ? fmtUsd(r.balance) : '—'}</td>
                    <td>
                      <span className="esp-pill" style={STATUS_STYLE[r.status] ?? { bg: 'var(--neutral-pill)', color: 'var(--slate)' }}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
