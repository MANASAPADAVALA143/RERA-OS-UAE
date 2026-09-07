import { useMemo } from 'react';
import { Building2, Layers, AlertTriangle, Calendar, TrendingDown, Wallet } from 'lucide-react';
import { usePropDevNav } from '../../../contexts/PropDevNavContext';
import { usePropDev, type CompanyData, type Loan, type Partner } from '../../../contexts/PropertyDevContext';
import { propDevPortfolioOverview, type PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { isActivePropDevLoan, sumActiveMonthlyEmi, resolveLandValue } from '../../../utils/propDevLoanMetrics';
import { CountUpUsd, EmptyState, scoreColor, BadgePill, type EspStatus } from '../../rental/execSummary/espShared';
import { badgeForScore } from '../../../utils/propDevDailyPulseData';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

function ltlvColor(ltlv: number | null): string {
  if (ltlv == null) return 'var(--slate)';
  if (ltlv < 60) return 'var(--active)';
  if (ltlv <= 80) return 'var(--pending)';
  return 'var(--overdue)';
}

function ltlvStatus(ltlv: number | null): EspStatus {
  if (ltlv == null) return 'Active';
  if (ltlv < 60) return 'Active';
  if (ltlv <= 80) return 'Pending';
  return 'Overdue';
}

function rateStatus(rate: number): EspStatus {
  if (rate > 8) return 'Overdue';
  if (rate >= 6) return 'Pending';
  return 'Active';
}

function maturityColor(days: number | null): string {
  if (days == null) return 'var(--slate)';
  if (days < 90) return 'var(--overdue)';
  if (days < 365) return 'var(--pending)';
  return 'var(--active)';
}

interface CapitalCallAgg {
  companyId: string;
  name: string;
  totalCalled: number;
  received: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
}

function aggregateCapitalCalls(companies: CompanyData[]): CapitalCallAgg[] {
  return companies
    .map(c => {
      const calls = c.capitalCalls ?? [];
      const totalCalled = calls.reduce((s, cc) => s + (cc.totalDue || 0), 0);
      const received = calls.reduce((s, cc) => s + (cc.received || 0), 0);
      const overdue = calls.filter(cc => cc.status === 'Overdue');
      return {
        companyId: c.id,
        name: c.name,
        totalCalled,
        received,
        outstanding: totalCalled - received,
        overdueAmount: overdue.reduce((s, cc) => s + (cc.totalDue - cc.received), 0),
        overdueCount: overdue.length,
      };
    })
    .filter(r => r.totalCalled > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}

interface PartnerAgg {
  name: string;
  entityCount: number;
  totalCapital: number;
  avgShare: number;
}

function aggregatePartners(companies: CompanyData[]): PartnerAgg[] {
  const byName = new Map<string, { capital: number; shareSum: number; count: number; companies: Set<string> }>();
  for (const c of companies) {
    for (const p of c.partners as Partner[]) {
      if ((p.status as string) === 'Exited') continue;
      const key = p.name.trim();
      if (!key) continue;
      const cur = byName.get(key) ?? { capital: 0, shareSum: 0, count: 0, companies: new Set<string>() };
      cur.capital += p.capitalContributed || 0;
      cur.shareSum += p.sharePercent || 0;
      cur.count += 1;
      cur.companies.add(c.id);
      byName.set(key, cur);
    }
  }
  return [...byName.entries()]
    .map(([name, v]) => ({
      name,
      entityCount: v.companies.size,
      totalCapital: v.capital,
      avgShare: v.count ? v.shareSum / v.count : 0,
    }))
    .sort((a, b) => b.totalCapital - a.totalCapital)
    .slice(0, 10);
}

interface Props {
  companies: CompanyData[];
  allLoans: Loan[];
  kpisById: Record<string, PropDevCompanyOverviewKpis>;
  loading: boolean;
}

export default function PDPortfolioOverviewTab({ companies, allLoans, kpisById, loading }: Props) {
  const { setSelectedCompanyId } = usePropDev();
  const { setTab } = usePropDevNav();

  const rows = useMemo(() => companies.map(c => ({ c, kpis: kpisById[c.id] })), [companies, kpisById]);
  const summary = useMemo(() => propDevPortfolioOverview(rows), [rows]);
  const totalCash = useMemo(() => rows.reduce((s, r) => s + (r.kpis?.cash ?? 0), 0), [rows]);
  const totalEmi = useMemo(() => sumActiveMonthlyEmi(allLoans), [allLoans]);
  const maxCash = useMemo(() => Math.max(1, ...rows.map(r => r.kpis?.cash ?? 0)), [rows]);

  const lenderRisk = useMemo(() => {
    const active = allLoans.filter(isActivePropDevLoan);
    return companies
      .map(c => {
        const byLender = new Map<string, number>();
        for (const l of active.filter(l => l.companyId === c.id)) byLender.set(l.bank, (byLender.get(l.bank) ?? 0) + (l.balance || 0));
        const totalDebt = [...byLender.values()].reduce((s, v) => s + v, 0);
        const lenders = [...byLender.entries()]
          .map(([bank, amt]) => ({ bank, amt, pct: totalDebt > 0 ? (amt / totalDebt) * 100 : 0 }))
          .sort((a, b) => b.amt - a.amt);
        return { name: c.name, lenders, totalDebt, topPct: lenders[0]?.pct ?? 0 };
      })
      .filter(r => r.totalDebt > 0)
      .sort((a, b) => b.topPct - a.topPct);
  }, [companies, allLoans]);

  const capitalCallRows = useMemo(() => aggregateCapitalCalls(companies), [companies]);
  const capitalCallTotals = useMemo(() => capitalCallRows.reduce((acc, r) => ({
    totalCalled: acc.totalCalled + r.totalCalled,
    received: acc.received + r.received,
    outstanding: acc.outstanding + r.outstanding,
    overdueCount: acc.overdueCount + r.overdueCount,
  }), { totalCalled: 0, received: 0, outstanding: 0, overdueCount: 0 }), [capitalCallRows]);
  const topPartners = useMemo(() => aggregatePartners(companies), [companies]);
  const totalPartners = useMemo(() => rows.reduce((s, r) => s + (r.kpis?.partners.length ?? 0), 0), [rows]);

  // Unrealised Gain/(Loss) = Market Value (FV) - Book Value, summed across entities that have both.
  const unrealisedByCompany = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const { c, kpis } of rows) {
      m[c.id] = kpis?.fmv != null && kpis?.bookValue != null ? kpis.fmv - kpis.bookValue : null;
    }
    return m;
  }, [rows]);
  const totalUnrealised = useMemo(
    () => Object.values(unrealisedByCompany).reduce((s: number, v) => s + (v ?? 0), 0),
    [unrealisedByCompany],
  );

  const distributionRatioByClass = useMemo(() => {
    let classACapital = 0, classADist = 0, classBCapital = 0, classBDist = 0;
    for (const c of companies) {
      for (const p of c.partners as Partner[]) {
        if ((p.status as string) === 'Exited') continue;
        if (p.type === 'Class A') { classACapital += p.capitalContributed || 0; classADist += p.distributionsReceived || 0; }
        else { classBCapital += p.capitalContributed || 0; classBDist += p.distributionsReceived || 0; }
      }
    }
    return {
      classAPct: classACapital > 0 ? (classADist / classACapital) * 100 : null,
      classBPct: classBCapital > 0 ? (classBDist / classBCapital) * 100 : null,
    };
  }, [companies]);

  function capitalCallRiskBadge(companyId: string): { label: string; bg: string; color: string } {
    const cc = capitalCallRows.find(r => r.companyId === companyId);
    const unrealised = unrealisedByCompany[companyId];
    if ((cc && cc.overdueCount > 0) || (unrealised != null && unrealised < 0)) {
      return { label: 'Critical', bg: 'var(--overdue-bg)', color: 'var(--overdue)' };
    }
    if (cc && cc.outstanding > 0) {
      return { label: 'Watch', bg: 'var(--pending-bg)', color: 'var(--pending-dark)' };
    }
    return { label: 'Safe', bg: 'var(--active-bg)', color: 'var(--active)' };
  }

  function concColor(_pct: number): string {
    // Deliberately not var(--navy) -- that token (#1A1D29) renders as
    // near-black at this size, which read as a bug to users. Use a clearly
    // blue shade instead, matching the fix used for other navy-vs-black
    // color complaints in the PDF export.
    return '#2E4C8A';
  }

  function goToEntity(id: string) {
    setSelectedCompanyId(id);
    setTab('entity-executive-summary');
  }

  if (loading) return <p style={{ fontSize: 13, color: '#78716C' }}>Loading portfolio overview…</p>;

  const activeLoans = allLoans.filter(isActivePropDevLoan);

  const kpiCards = [
    { key: 'land', label: 'Land Cost', icon: <Building2 size={16} />, accent: 'var(--gold)', value: fmtUsd(summary.totalAcquisitionCost), sub: 'Ownership sheet "Cost Basis" column' },
    { key: 'cost', label: 'Book Value', icon: <Layers size={16} />, accent: 'var(--navy)', value: fmtUsd(summary.totalLand + summary.totalImprovements), sub: 'Land + Improvements (Improvements - Others)' },
    { key: 'debt', label: 'Total Debt', icon: <AlertTriangle size={16} />, accent: 'var(--overdue)', value: fmtUsd(summary.totalLoanOutstanding), valueColor: 'var(--overdue)', sub: `${activeLoans.length} active loans · B/S Total for Long-term business loans` },
    { key: 'loanOutstanding', label: 'Total Loan Amount Outstanding', icon: <AlertTriangle size={16} />, accent: '#6D28D9', value: fmtUsd(summary.totalLoanOutstanding), valueColor: '#6D28D9', sub: 'B/S Total for Long-term business loans' },
    { key: 'emi', label: 'Total Monthly EMI', icon: <Calendar size={16} />, accent: 'var(--pending)', value: fmtUsd(totalEmi), valueColor: 'var(--pending-dark)', sub: 'Combined obligations' },
    { key: 'ltlv', label: 'Portfolio LTLV', icon: <TrendingDown size={16} />, accent: ltlvColor(summary.avgLtlv), value: summary.avgLtlv != null ? `${summary.avgLtlv.toFixed(1)}%` : '—', valueColor: ltlvColor(summary.avgLtlv), sub: 'Avg across entities with loans' },
    { key: 'cash', label: 'Total Bank', icon: <Wallet size={16} />, accent: 'var(--growth)', value: fmtUsd(totalCash), sub: 'Across all entities' },
    { key: 'unrealised', label: 'Unrealised Gain/(Loss)', icon: <TrendingDown size={16} />, accent: totalUnrealised < 0 ? 'var(--overdue)' : 'var(--active)', value: fmtUsd(totalUnrealised), valueColor: totalUnrealised < 0 ? 'var(--overdue)' : 'var(--active)', sub: 'FV − Book Value, all entities' },
    { key: 'callsPending', label: 'Capital Calls Pending', icon: <Wallet size={16} />, accent: capitalCallTotals.outstanding > 0 ? 'var(--pending)' : 'var(--active)', value: fmtUsd(capitalCallTotals.outstanding), valueColor: capitalCallTotals.outstanding > 0 ? 'var(--pending-dark)' : 'var(--navy-text)', sub: `${capitalCallTotals.overdueCount} overdue` },
    { key: 'distRatio', label: 'Avg Distribution Ratio', icon: <Layers size={16} />, accent: 'var(--navy)', value: `A: ${distributionRatioByClass.classAPct != null ? `${distributionRatioByClass.classAPct.toFixed(0)}%` : '—'} · B: ${distributionRatioByClass.classBPct != null ? `${distributionRatioByClass.classBPct.toFixed(0)}%` : '—'}`, sub: 'Distributions ÷ Capital by class' },
  ];

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* A. Hero KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {kpiCards.map(c => (
          <div key={c.key} className="esp-card" style={{ borderLeft: `3px solid ${c.accent}`, padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: c.accent }}>{c.icon}<span className="esp-label">{c.label}</span></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.valueColor ?? 'var(--navy-text)' }}>{c.value}</div>
            <div className="esp-sub" style={{ marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* B. Portfolio Summary Table */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Portfolio Summary</div>
        {rows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<Building2 size={32} />} title="Entity data not available" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Land Cost</th><th style={{ textAlign: 'right' }}>Book Value</th><th style={{ textAlign: 'right' }}>Market Value</th><th style={{ textAlign: 'right' }}>Bank</th><th style={{ textAlign: 'right' }}>Total Debt</th><th style={{ textAlign: 'right' }}>Loan Outstanding</th><th>LTLV%</th><th style={{ textAlign: 'right' }}>Partners</th><th style={{ textAlign: 'right' }}>EMI</th><th style={{ textAlign: 'right' }}>Unrealised G/(L)</th><th>Capital Call Risk</th><th>Health</th></tr></thead>
              <tbody>
                {rows.map(({ c, kpis }) => {
                  const emi = sumActiveMonthlyEmi(c.loans?.length ? c.loans : allLoans.filter(l => l.companyId === c.id));
                  const cashPct = kpis?.cash ? (kpis.cash / maxCash) * 100 : 0;
                  return (
                    <tr key={c.id} className="esp-row-hover" style={{ cursor: 'pointer' }} onClick={() => goToEntity(c.id)}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(kpis?.acquisitionCost)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(kpis?.bookValue)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(kpis?.fmv)}</td>
                      <td style={{ textAlign: 'right', position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(27,58,107,0.10)', width: `${cashPct}%`, zIndex: 0 }} />
                        <span style={{ position: 'relative', zIndex: 1 }}>{fmtUsd(kpis?.cash)}</span>
                      </td>
                      {/* Total Debt = B/S "Total for Long-term business loans" (loanOutstanding).
                          No fallback to loanBalance -- matches the portfolio-total card exactly,
                          which also only counts entities with a real loanOutstanding value. */}
                      <td style={{ textAlign: 'right', color: 'var(--overdue)' }}>{kpis?.loanOutstanding != null ? fmtUsd(kpis.loanOutstanding) : '—'}</td>
                      {/* Loan Outstanding = Loan Tracker balance (uploaded Bank Loan Information
                          workbook, dated balance column) -- distinct from the B/S-sourced Total Debt. */}
                      <td style={{ textAlign: 'right', color: '#6D28D9' }}>{kpis?.loanTrackerOutstanding != null ? fmtUsd(kpis.loanTrackerOutstanding) : '—'}</td>
                      <td>
                        {kpis?.ltlv == null
                          ? <span className="esp-pill" style={{ background: 'var(--neutral-pill)', color: 'var(--slate)' }}>—</span>
                          : <span className="esp-pill" style={{ background: kpis.ltlv > 100 ? 'var(--overdue-bg)' : kpis.ltlv > 80 ? 'var(--overdue-bg)' : kpis.ltlv >= 60 ? 'var(--pending-bg)' : 'var(--active-bg)', color: ltlvColor(kpis.ltlv) }}>
                              {kpis.ltlv > 100 ? 'Critical' : `${kpis.ltlv.toFixed(0)}%`}
                            </span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{kpis?.partners.length ?? 0}</td>
                      <td style={{ textAlign: 'right', color: kpis?.cash != null && emi > kpis.cash * 0.3 ? 'var(--overdue)' : 'var(--navy-text)' }}>{emi > 0 ? fmtUsd(emi) : '—'}</td>
                      <td style={{ textAlign: 'right', color: (unrealisedByCompany[c.id] ?? 0) < 0 ? 'var(--overdue)' : 'var(--active)' }}>{fmtUsd(unrealisedByCompany[c.id])}</td>
                      <td>
                        {(() => {
                          const b = capitalCallRiskBadge(c.id);
                          return <span className="esp-pill" style={{ background: b.bg, color: b.color, fontWeight: 700 }}>{b.label}</span>;
                        })()}
                      </td>
                      <td><BadgePill badge={badgeForScore(kpis?.ltlv != null ? (kpis.ltlv < 60 ? 90 : kpis.ltlv <= 80 ? 60 : 20) : 90)} /></td>
                    </tr>
                  );
                })}
                <tr className="esp-total-row">
                  <td>Portfolio Total</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(summary.totalAcquisitionCost)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(summary.totalLand + summary.totalImprovements)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(summary.totalMarketValue)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(totalCash)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(summary.totalLoanOutstanding)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(summary.totalLoanTrackerOutstanding)}</td>
                  <td>{summary.avgLtlv != null ? `${summary.avgLtlv.toFixed(1)}%` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{totalPartners}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(totalEmi)}</td>
                  <td style={{ textAlign: 'right', color: totalUnrealised < 0 ? 'var(--overdue)' : 'var(--active)' }}>{fmtUsd(totalUnrealised)}</td>
                  <td>—</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* C. Lender Concentration */}
      <div className="esp-card">
        <div className="esp-section-title">Lender Concentration</div>
        {lenderRisk.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="No active loans" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {lenderRisk.map(r => (
              <div key={r.name}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{r.name}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {r.lenders.map(l => (
                    <div key={l.bank}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: 'var(--slate)' }}>{l.bank}</span>
                        <span className="esp-pill" style={{ background: 'transparent', color: concColor(l.pct), fontWeight: 700 }}>{l.pct.toFixed(0)}% · {fmtUsd(l.amt)}</span>
                      </div>
                      <div className="esp-bar-track"><div className="esp-bar-fill" style={{ width: `${l.pct}%`, background: concColor(l.pct) }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* D. Loan Portfolio Table */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Loan Portfolio</div>
        {activeLoans.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<AlertTriangle size={32} />} title="No active loans" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th>Lender</th><th style={{ textAlign: 'right' }}>Outstanding</th><th>Rate</th><th style={{ textAlign: 'right' }}>EMI</th><th>Maturity</th><th>Status</th></tr></thead>
              <tbody>
                {activeLoans.map(l => {
                  const days = l.maturityDate ? Math.round((new Date(l.maturityDate).getTime() - Date.now()) / 86400000) : null;
                  const co = companies.find(c => c.id === l.companyId);
                  const land = co ? resolveLandValue(co) : null;
                  const status: EspStatus = days == null ? 'Active' : days < 0 ? 'Overdue' : days < 90 ? 'Pending' : 'Active';
                  return (
                    <tr key={l.id} className="esp-row-hover">
                      <td style={{ fontWeight: 600 }}>{l.company}</td>
                      <td>{l.bank}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(l.balance)}</td>
                      <td>
                        <span className="esp-pill" style={{
                          background: l.interestRate > 8 ? 'var(--overdue-bg)' : l.interestRate >= 6 ? 'var(--pending-bg)' : 'var(--active-bg)',
                          color: statusColorFor(rateStatus(l.interestRate)),
                        }}>{l.interestRate.toFixed(2)}%</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(l.emi)}</td>
                      <td style={{ color: maturityColor(days) }}>
                        {l.maturityDate ? `${new Date(l.maturityDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}${days != null ? ` · ${Math.abs(days)}${days < 0 ? 'd overdue' : 'd'}` : ''}` : '—'}
                      </td>
                      <td><BadgePill badge={status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* E. Capital Calls Table */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Capital Calls — All Entities</div>
        {capitalCallRows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<Wallet size={32} />} title="No capital calls recorded" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Total Called</th><th style={{ textAlign: 'right' }}>Received</th><th style={{ textAlign: 'right' }}>Outstanding</th><th>Overdue</th></tr></thead>
              <tbody>
                {capitalCallRows.map(r => (
                  <tr key={r.companyId} className="esp-row-hover" style={{ cursor: 'pointer' }} onClick={() => goToEntity(r.companyId)}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.totalCalled)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--active)' }}>{fmtUsd(r.received)}</td>
                    <td style={{ textAlign: 'right', color: r.outstanding > 0 ? 'var(--pending-dark)' : 'var(--navy-text)' }}>{fmtUsd(r.outstanding)}</td>
                    <td>
                      {r.overdueCount > 0
                        ? <span className="esp-pill" style={{ background: 'var(--overdue-bg)', color: 'var(--overdue)' }}>{r.overdueCount} · {fmtUsd(r.overdueAmount)}</span>
                        : <span className="esp-pill" style={{ background: 'var(--active-bg)', color: 'var(--active)' }}>None</span>}
                    </td>
                  </tr>
                ))}
                <tr className="esp-total-row">
                  <td>Portfolio Total</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(capitalCallTotals.totalCalled)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(capitalCallTotals.received)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(capitalCallTotals.outstanding)}</td>
                  <td style={{ textAlign: 'right' }}>{capitalCallTotals.overdueCount}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* F. Top Partners by Total Capital Table */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Top Partners by Total Capital Across All Entities</div>
        {topPartners.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<Building2 size={32} />} title="No partner data available" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Partner</th><th style={{ textAlign: 'right' }}>Entities</th><th style={{ textAlign: 'right' }}>Total Capital</th><th style={{ textAlign: 'right' }}>Avg Share</th></tr></thead>
              <tbody>
                {topPartners.map(p => (
                  <tr key={p.name} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td style={{ textAlign: 'right' }}>{p.entityCount}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(p.totalCapital)}</td>
                    <td style={{ textAlign: 'right' }}>{p.avgShare.toFixed(1)}%</td>
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

function statusColorFor(s: EspStatus): string {
  if (s === 'Active') return 'var(--active)';
  if (s === 'Pending') return 'var(--pending-dark)';
  return 'var(--overdue)';
}
