import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { usePropDevNav } from '../../../contexts/PropDevNavContext';
import { usePropDev, type CompanyData, type Loan } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import {
  computeEntityHealth, buildPropDevAlerts, buildCashBurnRows, buildPortfolioHeroStats,
  type PDAlert,
} from '../../../utils/propDevDailyPulseData';
import {
  CountUpUsd, CountUpNumber, ScoreBar, EmptyState, Toast,
  statusColor, statusBg, statusCardBg, scoreColor, BadgePill,
} from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function greetingWord(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function greetingName(email: string | undefined): string {
  if (!email) return 'there';
  const local = email.split('@')[0] ?? '';
  const first = local.split(/[._-]/)[0] ?? local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'there';
}

interface Props {
  companies: CompanyData[];
  allLoans: Loan[];
  kpisById: Record<string, PropDevCompanyOverviewKpis>;
  loading: boolean;
}

export default function PDDailyPulseTab({ companies, allLoans, kpisById, loading }: Props) {
  const { profile } = useAuth();
  const { setSelectedCompanyId } = usePropDev();
  const { setTab } = usePropDevNav();
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [showAllAlerts, setShowAllAlerts] = useState(false);

  const health = useMemo(() => computeEntityHealth(companies, kpisById), [companies, kpisById]);
  const alerts = useMemo(
    () => buildPropDevAlerts(companies, kpisById).filter(a => !dismissedIds.has(a.id)),
    [companies, kpisById, dismissedIds],
  );
  const burnRows = useMemo(() => buildCashBurnRows(companies, kpisById, allLoans), [companies, kpisById, allLoans]);
  const hero = useMemo(() => buildPortfolioHeroStats(companies, allLoans), [companies, allLoans]);

  const activity = useMemo(() => {
    const items: { id: string; t: number; description: string; entity: string }[] = [];
    for (const c of companies) {
      for (const cc of c.capitalCalls ?? []) {
        if (!cc.receivedDate) continue;
        const t = new Date(cc.receivedDate).getTime();
        if (Number.isNaN(t) || t < Date.now() - 7 * 86400000) continue;
        items.push({ id: cc.id, t, description: `${cc.partnerName} — capital call received ${fmtUsd(cc.received)}`, entity: c.name });
      }
    }
    return items.sort((a, b) => b.t - a.t).slice(0, 10);
  }, [companies]);

  function timeAgo(t: number): string {
    const mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function goToEntity(entityId: string) {
    setSelectedCompanyId(entityId);
    setTab('entity-executive-summary');
  }

  function actOnAlert(a: PDAlert, action: 'primary' | 'secondary') {
    setDismissedIds(prev => {
      const next = new Set(prev);
      if (action === 'secondary') next.add(a.id);
      return next;
    });
    setToast(`${action === 'primary' ? a.actionPrimary : a.actionSecondary} confirmed ✓`);
  }

  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 9);
  const loansSortedByMaturity = useMemo(
    () => [...allLoans]
      .filter(l => l.maturityDate)
      .sort((a, b) => new Date(a.maturityDate).getTime() - new Date(b.maturityDate).getTime())
      .slice(0, 12),
    [allLoans],
  );

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* A. Hero Banner */}
      <div style={{ background: 'var(--navy)', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{greetingWord()}, {greetingName(profile?.email)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {' · Development portfolio as of '}
            {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>
          {alerts.length > 0 && (
            <div className="esp-pill" style={{ background: 'var(--gold)', color: 'var(--navy)', marginTop: 10 }}>
              ⚠ {alerts.length} item{alerts.length === 1 ? '' : 's'} need attention
            </div>
          )}
        </div>
        <div style={{ display: 'flex' }}>
          {[
            { label: 'Total Debt', value: <CountUpUsd value={hero.totalDebt} /> },
            { label: 'Avg Cash Burn', value: <>{fmtUsd(hero.avgMonthlyBurn)}/mo</> },
            { label: 'Capital Calls Due', value: <CountUpUsd value={hero.capitalCallsDue} /> },
            { label: 'Alerts', value: <CountUpNumber value={alerts.length} /> },
          ].map((s, i) => (
            <div key={s.label} style={{ padding: '0 20px', borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.12)' : 'none', textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{s.value}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* B. Entity Health Scorecard */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Development Portfolio Health</div>
        <div className="esp-sub" style={{ marginBottom: 16 }}>LTLV 40% · Cash coverage 35% · Loan health 25%</div>
        {health.length === 0 ? (
          <EmptyState icon={<CheckCircle size={32} />} title="Health data not available" note="Populates once companies are configured." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {health.map(h => (
              <div key={h.entityId} className="esp-row-hover" onClick={() => goToEntity(h.entityId)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px', cursor: 'pointer', borderRadius: 8 }}>
                <div className="esp-avatar" style={{ width: 34, height: 34, fontSize: 12 }}>{h.initials}</div>
                <div style={{ width: 220, flexShrink: 0, fontSize: 13, fontWeight: 600 }}>{h.name}</div>
                <div style={{ flex: 1, minWidth: 100 }}><ScoreBar score={h.compositeScore} colorFor={scoreColor} /></div>
                <div style={{ width: 40, textAlign: 'right', fontSize: 16, fontWeight: 800, color: scoreColor(h.compositeScore) }}>{h.compositeScore}</div>
                <div style={{ width: 80, flexShrink: 0, textAlign: 'right' }}><BadgePill badge={h.badge} /></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* C. Alert Cards */}
      {alerts.length > 0 ? (
        <div>
          <div className="esp-section-title">Attention Required</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {visibleAlerts.map((a, i) => (
              <div key={a.id} className="esp-slide-in" style={{ borderLeft: `4px solid ${statusColor(a.status)}`, borderRadius: '0 10px 10px 0', background: statusCardBg(a.status), border: '1px solid var(--border)', borderLeftWidth: 4, borderLeftColor: statusColor(a.status), padding: '18px 20px', animationDelay: `${i * 80}ms` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span className="esp-pill" style={{ background: statusBg(a.status), color: statusColor(a.status) }}>{a.status}</span>
                  {a.days != null && <span className="esp-sub">{a.days}d</span>}
                </div>
                <div className="esp-body" style={{ marginBottom: 14, fontSize: 13 }}>{a.description}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="esp-btn-primary" onClick={() => actOnAlert(a, 'primary')}>{a.actionPrimary}</button>
                  <button type="button" className="esp-btn-ghost" onClick={() => actOnAlert(a, 'secondary')}>{a.actionSecondary}</button>
                </div>
              </div>
            ))}
          </div>
          {!showAllAlerts && alerts.length > 9 && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="esp-btn-ghost" onClick={() => setShowAllAlerts(true)}>{alerts.length - 9} more → View all</button>
            </div>
          )}
        </div>
      ) : !loading ? (
        <div className="esp-card" style={{ background: 'var(--active-bg)', textAlign: 'center' }}>
          <CheckCircle size={28} color="var(--active)" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--active)' }}>All clear — Portfolio within normal parameters</div>
          <div className="esp-sub" style={{ marginTop: 4 }}>Last checked: {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
        </div>
      ) : null}

      {/* D. Cash Burn Tracker */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Cash and Burn Rate Monitor</div>
        <div className="esp-sub" style={{ padding: '0 24px' }}>Pre-revenue burn is expected for development entities</div>
        {burnRows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<AlertTriangle size={32} />} title="Burn data not available" note="Populates once P&L financials are uploaded." /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Cash</th><th style={{ textAlign: 'right' }}>Monthly Burn</th><th style={{ textAlign: 'right' }}>Runway</th><th style={{ textAlign: 'right' }}>EMI Burden</th><th>Status</th></tr></thead>
              <tbody>
                {burnRows.map(r => (
                  <tr key={r.entityId} className="esp-row-hover" style={{ cursor: 'pointer' }} onClick={() => goToEntity(r.entityId)}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ textAlign: 'right' }}>{r.cash != null ? fmtUsd(r.cash) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.monthlyBurn != null ? fmtUsd(r.monthlyBurn) : '—'}</td>
                    <td style={{
                      textAlign: 'right', fontWeight: r.runwayMonths != null && r.runwayMonths < 6 ? 700 : 400,
                      color: r.runwayMonths == null ? 'var(--slate)' : r.runwayMonths > 12 ? 'var(--active)' : r.runwayMonths >= 3 ? 'var(--pending)' : 'var(--overdue)',
                    }}>
                      {r.runwayMonths != null ? `${r.runwayMonths.toFixed(1)}mo` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: r.cash != null && r.emiBurden > r.cash * 0.3 ? 'var(--overdue)' : 'var(--navy-text)' }}>
                      {r.emiBurden > 0 ? fmtUsd(r.emiBurden) : '—'}
                    </td>
                    <td><BadgePill badge={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* F. Loan Maturity Timeline */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Loan Maturity Schedule</div>
        <div className="esp-sub" style={{ marginBottom: 16 }}>Next 24 months</div>
        {loansSortedByMaturity.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="No loans with maturity dates" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {loansSortedByMaturity.map(l => {
              const days = Math.round((new Date(l.maturityDate).getTime() - Date.now()) / 86400000);
              const color = days < 90 ? 'var(--overdue)' : days < 365 ? 'var(--pending)' : 'var(--active)';
              const pct = Math.max(2, Math.min(100, 100 - (days / 730) * 100));
              return (
                <div key={l.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    <span>{l.company} — {l.bank}</span>
                    <span style={{ color }}>{days < 0 ? 'Past maturity' : `${days}d`}</span>
                  </div>
                  <div className="esp-bar-track"><div className="esp-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                  <div className="esp-sub" style={{ marginTop: 4 }}>Outstanding: {fmtUsd(l.balance)} · Rate: {l.interestRate.toFixed(2)}%</div>
                  {days < 90 && (
                    <span className="esp-pill" style={{ background: 'var(--overdue-bg)', color: 'var(--overdue)', marginTop: 6, display: 'inline-block' }}>Action required</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* G. Activity Feed */}
      <div className="esp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="esp-section-title" style={{ marginBottom: 4 }}>Recent Activity</div>
          <span className="esp-sub">Last 7 days</span>
        </div>
        {activity.length === 0 ? (
          <EmptyState icon={<Clock size={32} />} title="No recent activity recorded." note="Activity appears here after data uploads." />
        ) : (
          <div style={{ position: 'relative', paddingLeft: 20, marginTop: 8 }}>
            <div style={{ position: 'absolute', left: 4, top: 4, bottom: 4, width: 2, background: 'var(--border)' }} />
            {activity.map(item => (
              <div key={item.id} style={{ position: 'relative', paddingBottom: 16 }}>
                <div style={{ position: 'absolute', left: -20, top: 4, width: 10, height: 10, borderRadius: '50%', background: 'var(--active)', border: '2px solid var(--card)' }} />
                <div style={{ fontSize: 13, color: 'var(--navy-text)' }}>{item.description}</div>
                <div className="esp-sub">{item.entity} · {timeAgo(item.t)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
