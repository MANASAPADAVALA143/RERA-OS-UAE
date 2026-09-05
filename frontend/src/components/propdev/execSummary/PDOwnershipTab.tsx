import { useMemo, useState } from 'react';
import { Users, ArrowUpRight, AlertTriangle, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';
import type { CompanyData, Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { sumActiveMonthlyEmi, resolveLandValue } from '../../../utils/propDevLoanMetrics';
import { CountUpUsd, EmptyState, type EspStatus } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Props {
  companies: CompanyData[];
  allLoans: Loan[];
  kpisById: Record<string, PropDevCompanyOverviewKpis>;
  loading: boolean;
}

interface Holding {
  partnerName: string;
  entity: string;
  companyId: string;
  ownershipPct: number;
  capitalIn: number;
  distributions: number;
  currentValue: number;
  capitalCallsOutstanding: number;
}

export default function PDOwnershipTab({ companies, allLoans, kpisById, loading }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const holdings = useMemo((): Holding[] => {
    const rows: Holding[] = [];
    for (const c of companies) {
      const kpis = kpisById[c.id];
      const land = resolveLandValue(c);
      for (const p of c.partners ?? []) {
        if ((p.status as string) === 'Exited') continue;
        const capitalIn = p.capitalContributed || 0;
        const distributions = p.distributionsReceived || 0;
        const ownershipPctRaw = p.sharePercent > 1 ? p.sharePercent : p.sharePercent * 100;
        // Prefer the real uploaded Fair Market Value (property-level, scaled by ownership %) — same
        // source as the Ownership page's own "Market Value". Only estimate from land delta when no
        // FMV was uploaded for this entity.
        const landDelta = land != null && kpis?.costBasis != null ? land - (p.costBasis ?? kpis.costBasis) : 0;
        const currentValue = p.fairMarketValue != null
          ? p.fairMarketValue * (ownershipPctRaw / 100)
          : capitalIn + landDelta - distributions;
        const outstanding = (c.capitalCalls ?? [])
          .filter(cc => cc.partnerId === p.id)
          .reduce((s, cc) => s + Math.max(0, (cc.totalDue ?? 0) - (cc.received ?? 0)), 0);
        rows.push({
          partnerName: p.name, entity: c.name, companyId: c.id,
          ownershipPct: ownershipPctRaw,
          capitalIn, distributions, currentValue, capitalCallsOutstanding: outstanding,
        });
      }
    }
    return rows;
  }, [companies, kpisById]);

  const totalCapital = holdings.reduce((s, h) => s + h.capitalIn, 0);
  const totalDistributions = holdings.reduce((s, h) => s + h.distributions, 0);
  const totalCallsOutstanding = holdings.reduce((s, h) => s + h.capitalCallsOutstanding, 0);
  const partnerCount = new Set(holdings.map(h => h.partnerName)).size;
  const entityCount = new Set(holdings.map(h => h.entity)).size;
  const portfolioNoi = companies.reduce((s, c) => s + (kpisById[c.id]?.netIncome ?? 0), 0);

  const debtService = sumActiveMonthlyEmi(allLoans) * 12;
  const reserve = Math.max(0, portfolioNoi - debtService) * 0.10;
  const available = Math.max(0, portfolioNoi - debtService - reserve);
  const partnerShareTotals = useMemo(() => {
    const byPartner = new Map<string, number>();
    for (const h of holdings) byPartner.set(h.partnerName, (byPartner.get(h.partnerName) ?? 0) + h.ownershipPct / entityCount || 0);
    return [...byPartner.entries()].map(([name, pct]) => ({ name, pct: Math.min(100, pct), amount: available * (Math.min(100, pct) / 100) }));
  }, [holdings, available, entityCount]);

  // Capital calls tracker (real data)
  const callRows = useMemo(() => {
    const out: { entity: string; partner: string; called: number; received: number; outstanding: number; daysSince: number | null; status: string }[] = [];
    for (const c of companies) {
      for (const cc of c.capitalCalls ?? []) {
        const outstanding = Math.max(0, (cc.totalDue ?? 0) - (cc.received ?? 0));
        const daysSince = cc.dueDate ? Math.round((Date.now() - new Date(cc.dueDate).getTime()) / 86400000) : null;
        out.push({ entity: c.name, partner: cc.partnerName, called: cc.totalDue ?? 0, received: cc.received ?? 0, outstanding, daysSince, status: cc.status });
      }
    }
    return out.sort((a, b) => b.outstanding - a.outstanding);
  }, [companies]);

  // IRR (simplified, non-dated — capitalContributed vs distributions + current value)
  const irrRows = useMemo(() => holdings.map(h => {
    const returned = h.distributions + h.currentValue;
    const returnPct = h.capitalIn > 0 ? ((returned - h.capitalIn) / h.capitalIn) * 100 : null;
    let status: { label: string; bg: string; color: string };
    if (returnPct == null) status = { label: 'N/A', bg: 'var(--neutral-pill)', color: 'var(--slate)' };
    else if (returnPct < 0) status = { label: 'Loss', bg: 'var(--overdue-bg)', color: '#6D28D9' };
    else if (returnPct > 15) status = { label: 'Outperforming', bg: 'var(--active-bg)', color: 'var(--active)' };
    else if (returnPct >= 8) status = { label: 'On track', bg: 'var(--gold-light)', color: '#92400E' };
    else status = { label: 'Underperforming', bg: 'var(--pending-bg)', color: 'var(--pending-dark)' };
    return { ...h, returnPct, status };
  }), [holdings]);

  if (loading) return <p style={{ fontSize: 13, color: '#78716C' }}>Loading ownership data…</p>;

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* A. 4 KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div className="esp-card" style={{ borderLeft: '4px solid var(--active)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><Users size={16} color="var(--active)" /><span className="esp-label">Total Partner Capital</span></div>
          <div className="esp-value"><CountUpUsd value={totalCapital} /></div>
          <div className="esp-sub" style={{ marginTop: 4 }}>Across {partnerCount} partner{partnerCount === 1 ? '' : 's'}, {entityCount} entit{entityCount === 1 ? 'y' : 'ies'}</div>
        </div>
        <div className="esp-card" style={{ borderLeft: '4px solid var(--growth)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><ArrowUpRight size={16} color="var(--growth)" /><span className="esp-label">Distributions Paid YTD</span></div>
          <div className="esp-value"><CountUpUsd value={totalDistributions} /></div>
        </div>
        <div className="esp-card" style={{ borderLeft: `4px solid ${totalCallsOutstanding > 0 ? 'var(--overdue)' : 'var(--active)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><AlertTriangle size={16} color={totalCallsOutstanding > 0 ? 'var(--overdue)' : 'var(--active)'} /><span className="esp-label">Capital Calls Outstanding</span></div>
          <div className="esp-value" style={{ color: totalCallsOutstanding > 0 ? 'var(--overdue)' : 'var(--navy-text)' }}>{fmtUsd(totalCallsOutstanding)}</div>
        </div>
        <div className="esp-card" style={{ borderLeft: '4px solid var(--gold)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><TrendingUp size={16} color="var(--gold)" /><span className="esp-label">Portfolio NOI/Loss</span></div>
          <div className="esp-value" style={{ color: portfolioNoi >= 0 ? 'var(--growth)' : 'var(--pending)' }}>{fmtUsd(portfolioNoi)}</div>
        </div>
      </div>

      {/* B. Partner Investment Cards */}
      <div>
        <div className="esp-section-title">Partner Portfolio View</div>
        {holdings.length === 0 ? (
          <div className="esp-card"><EmptyState icon={<Users size={32} />} title="Ownership data not available" note="Add partner records under Ownership." /></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            {holdings.map((h, i) => (
              <div key={`${h.partnerName}-${h.entity}-${i}`} className="esp-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div className="esp-avatar">{initialsFor(h.partnerName)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{h.partnerName}</div>
                    <div className="esp-sub">{h.entity}</div>
                  </div>
                  <span className="esp-pill" style={{ background: 'var(--gold-light)', color: 'var(--gold)' }}>{h.ownershipPct.toFixed(1)}%</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
                  <div><div className="esp-label">Capital In</div><div style={{ fontSize: 18, fontWeight: 800 }}>{fmtUsd(h.capitalIn)}</div></div>
                  <div><div className="esp-label">Distributions</div><div style={{ fontSize: 18, fontWeight: 800 }}>{fmtUsd(h.distributions)}</div></div>
                  <div><div className="esp-label">Market Value</div><div style={{ fontSize: 18, fontWeight: 800 }}>{fmtUsd(h.currentValue)}</div></div>
                </div>
                <div style={{ fontSize: 12, color: h.capitalCallsOutstanding > 0 ? 'var(--overdue)' : 'var(--active)' }}>
                  {h.capitalCallsOutstanding > 0 ? `⚠ ${fmtUsd(h.capitalCallsOutstanding)} outstanding` : 'No outstanding ✓'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* C. Distribution Waterfall */}
      <div className="esp-card">
        <div className="esp-section-title">Distribution Waterfall <span className="esp-sub" style={{ fontWeight: 400 }}>(current-period NOI split, not a payment history)</span></div>
        <div className="esp-sub" style={{ fontStyle: 'italic', marginBottom: 12 }}>Pre-revenue entities show negative NOI — distribution from capital only</div>
        {portfolioNoi <= 0 ? (
          <EmptyState icon={<TrendingUp size={32} />} title="Waterfall not available" note="Portfolio NOI is negative or unavailable — expected for pre-revenue development entities." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="esp-table">
              <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>% of NOI</th></tr></thead>
              <tbody>
                <tr><td>Total NOI</td><td style={{ textAlign: 'right' }}>{fmtUsd(portfolioNoi)}</td><td style={{ textAlign: 'right' }}>100%</td></tr>
                <tr><td>Debt Service</td><td style={{ textAlign: 'right', color: 'var(--overdue)' }}>({fmtUsd(debtService)})</td><td style={{ textAlign: 'right' }}>{((debtService / portfolioNoi) * 100).toFixed(1)}%</td></tr>
                <tr><td>Operating Reserve (10%)</td><td style={{ textAlign: 'right', color: 'var(--pending)' }}>({fmtUsd(reserve)})</td><td style={{ textAlign: 'right' }}>{((reserve / portfolioNoi) * 100).toFixed(1)}%</td></tr>
                <tr className="esp-total-row"><td>Available for Distribution</td><td style={{ textAlign: 'right' }}>{fmtUsd(available)}</td><td style={{ textAlign: 'right' }}>{((available / portfolioNoi) * 100).toFixed(1)}%</td></tr>
                {partnerShareTotals.map(p => (
                  <tr key={p.name}><td>{p.name} ({p.pct.toFixed(1)}%)</td><td style={{ textAlign: 'right' }}>{fmtUsd(p.amount)}</td><td style={{ textAlign: 'right' }}>{((p.amount / portfolioNoi) * 100).toFixed(1)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* D. Capital Account Statements */}
      <div className="esp-card">
        <div className="esp-section-title">Capital Account Statements</div>
        {holdings.length === 0 ? (
          <EmptyState icon={<Users size={32} />} title="Not available" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {holdings.map((h, i) => {
              const key = `${h.partnerName}-${h.entity}-${i}`;
              const isOpen = expanded === key;
              const co = companies.find(c => c.id === h.companyId);
              const land = co ? resolveLandValue(co) : null;
              const landShare = land != null ? land * (h.ownershipPct / 100) : null;
              const closing = h.currentValue;
              const change = closing - h.capitalIn;
              return (
                <div key={key}>
                  <div className="esp-row-hover" onClick={() => setExpanded(isOpen ? null : key)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', cursor: 'pointer', borderRadius: 8 }}>
                    <div className="esp-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>{initialsFor(h.partnerName)}</div>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{h.partnerName} — {h.entity} — {h.ownershipPct.toFixed(1)}%</div>
                    <div style={{ fontWeight: 700, color: change >= 0 ? 'var(--growth)' : 'var(--pending)' }}>{fmtUsd(closing)}</div>
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  {isOpen && (
                    <div style={{ marginLeft: 44, marginBottom: 8, padding: '12px 16px', background: 'var(--ivory-dark)', borderRadius: 8, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>Capital Contributed</span><span>{fmtUsd(h.capitalIn)}</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>− Distributions Paid</span><span>{fmtUsd(h.distributions)}</span></div>
                      {landShare != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: 'var(--gold)' }}><span>{h.ownershipPct.toFixed(1)}% share of land value</span><span>{fmtUsd(landShare)}</span></div>
                      )}
                      <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontWeight: 700 }}>
                        <span>Closing Balance</span>
                        <span style={{ color: change >= 0 ? 'var(--growth)' : 'var(--pending)' }}>{fmtUsd(closing)} ({change >= 0 ? '+' : ''}{fmtUsd(change)})</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* E. Capital Calls Tracker */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Capital Calls — Live Status</div>
        {callRows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<AlertTriangle size={32} />} title="No capital calls recorded" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th>Partner</th><th style={{ textAlign: 'right' }}>Called</th><th style={{ textAlign: 'right' }}>Received</th><th style={{ textAlign: 'right' }}>Outstanding</th><th style={{ textAlign: 'right' }}>Days</th><th>Status</th></tr></thead>
              <tbody>
                {callRows.map((r, i) => {
                  const statusStyle: Record<string, { bg: string; color: string }> = {
                    Paid: { bg: 'var(--active-bg)', color: 'var(--active)' },
                    Partial: { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' },
                    Outstanding: { bg: 'var(--overdue-bg)', color: '#6D28D9' },
                    Overdue: { bg: (r.daysSince ?? 0) > 60 ? 'var(--navy)' : 'var(--overdue-bg)', color: (r.daysSince ?? 0) > 60 ? '#fff' : '#6D28D9' },
                  };
                  const s = statusStyle[r.status] ?? { bg: 'var(--neutral-pill)', color: 'var(--slate)' };
                  return (
                    <tr key={i} className="esp-row-hover">
                      <td style={{ fontWeight: 600 }}>{r.entity}</td>
                      <td>{r.partner}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(r.called)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(r.received)}</td>
                      <td style={{ textAlign: 'right', fontWeight: r.outstanding > 0 ? 700 : 400, color: r.outstanding > 0 ? 'var(--overdue)' : 'var(--active)' }}>{r.outstanding > 0 ? fmtUsd(r.outstanding) : '—'}</td>
                      <td style={{ textAlign: 'right', color: r.daysSince == null ? 'var(--slate)' : r.daysSince > 60 ? 'var(--overdue)' : r.daysSince > 30 ? 'var(--pending)' : 'var(--slate)', fontWeight: (r.daysSince ?? 0) > 60 ? 700 : 400 }}>{r.daysSince != null ? `${r.daysSince}d` : '—'}</td>
                      <td><span className="esp-pill" style={{ background: s.bg, color: s.color }}>{r.status}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* F. Partner IRR */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Partner Returns</div>
        <div className="esp-sub" style={{ padding: '0 24px', fontStyle: 'italic' }}>Development IRR realized at exit — current figures are unrealized estimates, not time-weighted</div>
        {irrRows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<TrendingUp size={32} />} title="Not available" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Partner</th><th>Entity</th><th style={{ textAlign: 'right' }}>Invested</th><th style={{ textAlign: 'right' }}>Returned</th><th style={{ textAlign: 'right' }}>Return %</th><th>Status</th></tr></thead>
              <tbody>
                {irrRows.map((r, i) => (
                  <tr key={i} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.partnerName}</td>
                    <td>{r.entity}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.capitalIn)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.distributions + r.currentValue)}</td>
                    <td style={{ textAlign: 'right' }}>{r.returnPct != null ? `${r.returnPct.toFixed(1)}%` : '—'}</td>
                    <td><span className="esp-pill" style={{ background: r.status.bg, color: r.status.color }}>{r.status.label}</span></td>
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
