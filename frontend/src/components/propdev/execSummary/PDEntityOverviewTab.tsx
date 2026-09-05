import { Building2, Layers, AlertTriangle, TrendingDown } from 'lucide-react';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import type { PropDevBoardExportPayload } from '../../../utils/gatherPropDevBoardExportData';
import { pickFocusSnapshot } from '../../../utils/gatherPropDevBoardExportData';
import { computeEntityHealth } from '../../../utils/propDevDailyPulseData';
import { ScoreBar, scoreColor, BadgePill, EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}
function pct(n: number | null | undefined): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}
function ltlvColor(ltlv: number | null): string {
  if (ltlv == null) return 'var(--slate)';
  if (ltlv < 60) return 'var(--active)';
  if (ltlv <= 80) return 'var(--pending)';
  return 'var(--overdue)';
}

interface Props {
  company: CompanyData;
  kpis: PropDevCompanyOverviewKpis | undefined;
  loans: Loan[];
  payload: PropDevBoardExportPayload | null;
}

export default function PDEntityOverviewTab({ company, kpis, loans, payload }: Props) {
  const health = computeEntityHealth([company], { [company.id]: kpis as PropDevCompanyOverviewKpis })[0];
  const pl = payload ? pickFocusSnapshot(payload.plSnapshots, payload.focusYear) : null;
  const bs = payload ? pickFocusSnapshot(payload.bsSnapshots, payload.focusYear) : null;
  const grossMargin = pl && pl.rev > 0 ? (pl.noi / pl.rev) * 100 : null;

  const cards = [
    { key: 'noi', label: 'NOI', icon: <TrendingDown size={16} />, accent: 'var(--gold)', value: fmtUsd(pl?.noi ?? kpis?.netIncome ?? null) },
    { key: 'margin', label: 'Gross Margin %', icon: <Layers size={16} />, accent: 'var(--active)', value: pct(grossMargin) },
    { key: 'netinc', label: 'Net Income', icon: <Building2 size={16} />, accent: (kpis?.netIncome ?? 0) >= 0 ? 'var(--growth)' : 'var(--overdue)', value: fmtUsd(kpis?.netIncome ?? null), valueColor: (kpis?.netIncome ?? 0) >= 0 ? 'var(--growth)' : 'var(--overdue)' },
    { key: 'assets', label: 'Total Assets', icon: <Building2 size={16} />, accent: 'var(--active)', value: fmtUsd(bs?.totalAssets ?? kpis?.costBasis ?? null) },
    { key: 'debt', label: 'Total Debt', icon: <AlertTriangle size={16} />, accent: 'var(--overdue)', value: fmtUsd(kpis?.loanBalance ?? null), valueColor: 'var(--overdue)' },
    { key: 'ltlv', label: 'LTLV %', icon: <TrendingDown size={16} />, accent: ltlvColor(kpis?.ltlv ?? null), value: pct(kpis?.ltlv ?? null), valueColor: ltlvColor(kpis?.ltlv ?? null) },
  ];

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Health Score</div>
        {!health ? (
          <EmptyState icon={<AlertTriangle size={28} />} title="Not available" />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: scoreColor(health.compositeScore) }}>{health.compositeScore}/100</div>
            <BadgePill badge={health.badge} />
            <div style={{ flex: 1 }}><ScoreBar score={health.compositeScore} colorFor={scoreColor} /></div>
          </div>
        )}
        {health && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
            {[['LTLV', health.ltlvScore], ['Cash Coverage', health.cashCoverageScore], ['Loan Health', health.loanHealthScore]].map(([label, score]) => (
              <div key={label as string}>
                <div className="esp-label">{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: scoreColor(score as number) }}>{score}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {cards.map(c => (
          <div key={c.key} className="esp-card" style={{ borderLeft: `3px solid ${c.accent}`, padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: c.accent }}>{c.icon}<span className="esp-label">{c.label}</span></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.valueColor ?? 'var(--navy-text)' }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="esp-card">
        <div className="esp-section-title">Summary Metrics — Current vs. Prior Year</div>
        {payload && payload.plSnapshots.length >= 2 ? (
          <table className="esp-table">
            <thead><tr><th>Metric</th><th style={{ textAlign: 'right' }}>Current</th><th style={{ textAlign: 'right' }}>Prior</th><th style={{ textAlign: 'right' }}>Change</th></tr></thead>
            <tbody>
              {(() => {
                const cur = payload.plSnapshots[payload.plSnapshots.length - 1];
                const prior = payload.plSnapshots[payload.plSnapshots.length - 2];
                const rows: [string, number, number][] = [
                  ['Revenue', cur.rev, prior.rev],
                  ['Expenses', cur.exp, prior.exp],
                  ['NOI', cur.noi, prior.noi],
                  ['Net Income', cur.netInc, prior.netInc],
                ];
                return rows.map(([label, c, p]) => {
                  const change = c - p;
                  return (
                    <tr key={label}>
                      <td style={{ fontWeight: 600 }}>{label}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(c)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(p)}</td>
                      <td style={{ textAlign: 'right', color: change >= 0 ? 'var(--growth)' : 'var(--pending)' }}>{change >= 0 ? '+' : ''}{fmtUsd(change)}</td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<AlertTriangle size={28} />} title="Not enough history" note="Needs at least 2 years of P&L data to compare." />
        )}
      </div>

      <div className="esp-sub">{loans.length} active/total loan record(s) for this entity — see the Loans tab for detail.</div>
    </div>
  );
}
