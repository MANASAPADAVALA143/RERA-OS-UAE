import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, LineChart, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { CompanyData, Loan } from '../../contexts/PropertyDevContext';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import { propDevCompanyOverviewKpis } from '../../utils/propDevCompanyOverview';
import { isActivePropDevLoan, portfolioLtlvPercent, resolveLandValue, sumActivePropDevLoanBalances, normalizeInterestRatePercent } from '../../utils/propDevLoanMetrics';
import { PROPDEV_MARKET_RATE } from '../../hooks/usePropDevLoanTrackerData';
import {
  computeAmortizationSchedule, computePayoff, computeDscrRows, computeRefinancingRows,
  computeSensitivityRows, computeDebtCapacityRows, dscrStatusFor,
} from '../../utils/propDevLoanCalculations';
import { EmptyState, type EspStatus } from '../../components/rental/execSummary/espShared';
import '../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function pct(n: number | null | undefined, d = 1): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(d)}%` : '—';
}
function ltlvColor(v: number | null): string {
  if (v == null) return 'var(--slate)';
  if (v < 60) return 'var(--active)';
  if (v <= 80) return 'var(--pending)';
  return 'var(--overdue)';
}
function statusToEsp(s: string): EspStatus {
  if (s === 'Strong' || s === 'Adequate' || s === 'No debt') return 'Active';
  if (s === 'Thin') return 'Pending';
  return 'Overdue';
}
function statusPillStyle(s: EspStatus): { bg: string; color: string } {
  if (s === 'Active') return { bg: 'var(--active-bg)', color: 'var(--active)' };
  if (s === 'Pending') return { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' };
  return { bg: 'var(--overdue-bg)', color: '#6D28D9' };
}

interface Props {
  loans: Loan[];
  companies: CompanyData[];
  allLoans: Loan[];
}

export default function PDLoanCalculationsTab({ companies, allLoans }: Props) {
  const [uploadedFin, setUploadedFin] = useState<Record<string, PDFinancialsLike>>({});
  useEffect(() => {
    if (!companies.length) return;
    let cancelled = false;
    fetchPropDevFinancialsPool(
      companies.map(c => c.id),
      (_id, d) => ({
        years: d.years ?? [], pl: (d.pl ?? []) as PDFinancialsLike['pl'],
        bs: (d.bs ?? []) as PDFinancialsLike['bs'], cf: (d.cf ?? []) as PDFinancialsLike['cf'],
      }),
      { onItem: (id, item) => { if (!cancelled) setUploadedFin(prev => ({ ...prev, [id]: item })); } },
    ).then(merged => { if (!cancelled) setUploadedFin(prev => ({ ...prev, ...merged })); });
    return () => { cancelled = true; };
  }, [companies]);

  const kpisById = useMemo(() => {
    const map: Record<string, ReturnType<typeof propDevCompanyOverviewKpis>> = {};
    for (const c of companies) map[c.id] = propDevCompanyOverviewKpis(c, uploadedFin[c.id] ?? null, allLoans);
    return map;
  }, [companies, uploadedFin, allLoans]);

  const noiById = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const c of companies) map[c.id] = kpisById[c.id]?.netIncome ?? null;
    return map;
  }, [companies, kpisById]);

  const activeLoans = useMemo(() => allLoans.filter(l => companies.some(c => c.id === l.companyId) && isActivePropDevLoan(l)), [allLoans, companies]);

  // ── Section 1: Portfolio Debt Snapshot ──
  const totalOutstanding = sumActivePropDevLoanBalances(activeLoans);
  const weightedAvgRate = useMemo(() => {
    const withBal = activeLoans.filter(l => l.balance > 0);
    if (!withBal.length) return 0;
    return withBal.reduce((s, l) => s + normalizeInterestRatePercent(l.interestRate) * l.balance, 0) / withBal.reduce((s, l) => s + l.balance, 0);
  }, [activeLoans]);
  const annualInterest = activeLoans.reduce((s, l) => s + (l.balance || 0) * (normalizeInterestRatePercent(l.interestRate) / 100), 0);
  const monthlyEmi = activeLoans.reduce((s, l) => s + (l.emi || 0), 0);
  const totalLandValue = companies.reduce((s, c) => s + (resolveLandValue(c) ?? 0), 0);
  const portfolioLtlv = portfolioLtlvPercent(totalOutstanding, totalLandValue > 0 ? totalLandValue : null);

  // ── Section 3: Refinancing (interactive) ──
  const [marketRate, setMarketRate] = useState(PROPDEV_MARKET_RATE);
  const refinanceRows = useMemo(() => computeRefinancingRows(companies, activeLoans, marketRate), [companies, activeLoans, marketRate]);
  const totalMonthlySavings = refinanceRows.reduce((s, r) => s + r.monthlySavings, 0);
  const totalAnnualSavings = refinanceRows.reduce((s, r) => s + r.annualSavings, 0);
  const avgBreakEven = refinanceRows.length
    ? refinanceRows.reduce((s, r) => s + (r.breakEvenMonths ?? 0), 0) / refinanceRows.length
    : 0;

  // ── Section 2: DSCR ──
  const dscrRows = useMemo(() => computeDscrRows(companies, activeLoans, noiById), [companies, activeLoans, noiById]);
  const avgDscr = useMemo(() => {
    const withDscr = dscrRows.filter(r => r.dscr != null);
    return withDscr.length ? withDscr.reduce((s, r) => s + (r.dscr ?? 0), 0) / withDscr.length : null;
  }, [dscrRows]);

  // ── Section 4/5: Amortization + Payoff (shared loan selector) ──
  const [selectedLoanId, setSelectedLoanId] = useState<string>(activeLoans[0]?.id ?? '');
  useEffect(() => {
    if (!activeLoans.some(l => l.id === selectedLoanId)) setSelectedLoanId(activeLoans[0]?.id ?? '');
  }, [activeLoans, selectedLoanId]);
  const selectedLoan = activeLoans.find(l => l.id === selectedLoanId) ?? null;
  const [showAllMonths, setShowAllMonths] = useState(false);
  const amortSchedule = useMemo(() => selectedLoan ? computeAmortizationSchedule(selectedLoan, 360) : [], [selectedLoan]);
  const visibleAmortRows = showAllMonths ? amortSchedule : amortSchedule.slice(0, 12);
  const totalRemainingInterest = amortSchedule.reduce((s, r) => s + r.interest, 0);
  const totalRemainingPrincipal = amortSchedule.reduce((s, r) => s + r.principal, 0);
  const totalRemainingPayments = totalRemainingInterest + totalRemainingPrincipal;

  const [payoffDate, setPayoffDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [penaltyPct, setPenaltyPct] = useState(0);
  const payoff = useMemo(
    () => selectedLoan ? computePayoff(selectedLoan, new Date(payoffDate), penaltyPct) : null,
    [selectedLoan, payoffDate, penaltyPct],
  );

  // ── Section 6: Rate Sensitivity ──
  const [rateChange, setRateChange] = useState(0);
  const sensitivityRows = useMemo(() => computeSensitivityRows(companies, activeLoans, noiById, rateChange), [companies, activeLoans, noiById, rateChange]);
  const totalCurrentEmi = sensitivityRows.reduce((s, r) => s + r.currentEmi, 0);
  const totalNewEmi = sensitivityRows.reduce((s, r) => s + r.newEmi, 0);
  const sensitivityChartData = useMemo(() => {
    const scenarios: { rate: number }[] = [];
    for (let d = -3; d <= 3; d += 0.5) scenarios.push({ rate: weightedAvgRate + d });
    return scenarios.map(({ rate }) => {
      const delta = rate - weightedAvgRate;
      const rows = computeSensitivityRows(companies, activeLoans, noiById, delta);
      const emi = rows.reduce((s, r) => s + r.newEmi, 0);
      const dscrVals = rows.filter(r => r.newDscr != null).map(r => r.newDscr as number);
      const avg = dscrVals.length ? dscrVals.reduce((s, v) => s + v, 0) / dscrVals.length : null;
      return { rateLabel: `${rate.toFixed(2)}%`, emi, dscr: avg };
    });
  }, [companies, activeLoans, noiById, weightedAvgRate]);

  // ── Section 7: Debt Capacity ──
  const capacityRows = useMemo(() => computeDebtCapacityRows(companies, activeLoans, noiById, marketRate), [companies, activeLoans, noiById, marketRate]);
  const totalHeadroomDscr = capacityRows.reduce((s, r) => s + Math.max(0, r.debtHeadroom ?? 0), 0);
  const totalCapacity = capacityRows.reduce((s, r) => s + Math.max(0, r.actualCapacity ?? 0), 0);

  if (!companies.length) {
    return (
      <div className="esp-scope esp-fade-in esp-card" style={{ marginTop: 16 }}>
        <EmptyState icon={<AlertTriangle size={32} />} title="No entities available" />
      </div>
    );
  }

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>

      {/* Section 1 — Portfolio Debt Snapshot */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
        {[
          { key: 'net', label: 'Total Outstanding Debt', accent: 'var(--overdue)', value: fmtUsd(totalOutstanding), valueColor: 'var(--overdue)', sub: `${activeLoans.length} active loan(s) across ${companies.length} entities` },
          { key: 'rate', label: 'Weighted Avg Rate', accent: 'var(--pending)', value: pct(weightedAvgRate, 2), valueColor: 'var(--pending-dark)', sub: 'Weighted by outstanding balance' },
          { key: 'interest', label: 'Annual Interest Expense', accent: 'var(--overdue)', value: fmtUsd(annualInterest), valueColor: 'var(--overdue)', sub: 'Est. total interest this year' },
          { key: 'emi', label: 'Total Monthly EMI', accent: 'var(--pending)', value: fmtUsd(monthlyEmi), sub: 'Combined debt obligations' },
          { key: 'ltlv', label: 'Portfolio LTLV', accent: ltlvColor(portfolioLtlv), value: pct(portfolioLtlv), valueColor: ltlvColor(portfolioLtlv), sub: 'Loan to land value ratio' },
          { key: 'savings', label: 'Potential Annual Savings', accent: 'var(--growth)', value: fmtUsd(totalAnnualSavings), valueColor: 'var(--growth)', sub: 'If all above-market loans refinanced' },
        ].map(c => (
          <div key={c.key} className="esp-card" style={{ borderLeft: `3px solid ${c.accent}`, padding: '16px 20px' }}>
            <span className="esp-label">{c.label}</span>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.valueColor ?? 'var(--navy-text)', marginTop: 6 }}>{c.value}</div>
            <div className="esp-sub" style={{ marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Section 2 — DSCR Calculator */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Debt Service Coverage Ratio (DSCR)</div>
        <div className="esp-sub" style={{ marginBottom: 16 }}>DSCR = Annual NOI ÷ Annual Debt Service (EMI × 12). Lenders require &gt; 1.25x</div>
        {dscrRows.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="No entities with loans" />
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="esp-table">
                <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>NOI (Annual)</th><th style={{ textAlign: 'right' }}>EMI × 12</th><th style={{ textAlign: 'right' }}>DSCR</th><th>Status</th><th style={{ textAlign: 'right' }}>Cushion</th></tr></thead>
                <tbody>
                  {dscrRows.map(r => {
                    const pill = statusPillStyle(statusToEsp(r.status));
                    return (
                      <tr key={r.entityId} className="esp-row-hover">
                        <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                        <td style={{ textAlign: 'right' }}>{r.annualNoi != null ? fmtUsd(r.annualNoi) : 'Upload P&L →'}</td>
                        <td style={{ textAlign: 'right' }}>{fmtUsd(r.annualDebtService)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{r.dscr != null ? `${r.dscr.toFixed(2)}x` : '—'}</td>
                        <td><span className="esp-pill" style={pill}>{r.status}</span></td>
                        <td style={{ textAlign: 'right', color: r.cushion == null ? 'var(--slate)' : r.cushion >= 0 ? 'var(--growth)' : 'var(--overdue)' }}>
                          {r.cushion == null ? '—' : r.cushion >= 0 ? `${fmtUsd(r.cushion)} surplus` : `(${fmtUsd(Math.abs(r.cushion))}) shortfall`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Portfolio avg DSCR: {avgDscr != null ? `${avgDscr.toFixed(2)}x` : '—'}</div>
              <div style={{ position: 'relative', height: 10, background: 'var(--border)', borderRadius: 5 }}>
                <div style={{ position: 'absolute', left: `${(1.25 / 3) * 100}%`, top: -4, bottom: -4, width: 2, background: 'var(--pending)' }} title="Lender minimum 1.25x" />
                {avgDscr != null && (
                  <div style={{ height: '100%', width: `${Math.min(100, (avgDscr / 3) * 100)}%`, borderRadius: 5, background: avgDscr >= 1.25 ? 'var(--active)' : avgDscr >= 1.0 ? 'var(--pending)' : 'var(--overdue)' }} />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Section 3 — Refinancing Calculator */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Refinancing Opportunity Calculator</div>
        <div className="esp-sub" style={{ marginBottom: 16 }}>Loans above market rate — live savings calculation</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Market Rate: {marketRate.toFixed(2)}%</label>
          <input type="range" min={4} max={10} step={0.25} value={marketRate} onChange={e => setMarketRate(Number(e.target.value))} style={{ accentColor: 'var(--gold)', width: 220 }} />
        </div>
        {refinanceRows.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="No loans above market rate" note={`All active loans are at or below ${marketRate.toFixed(2)}%.`} />
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="esp-table">
                <thead><tr><th>Entity</th><th>Lender</th><th>Current Rate</th><th>Rate Diff</th><th style={{ textAlign: 'right' }}>Outstanding</th><th style={{ textAlign: 'right' }}>Monthly Savings</th><th style={{ textAlign: 'right' }}>Annual Savings</th><th>Break-Even</th></tr></thead>
                <tbody>
                  {refinanceRows.map(r => {
                    const beColor = r.breakEvenMonths == null ? 'var(--slate)' : r.breakEvenMonths < 12 ? 'var(--active)' : r.breakEvenMonths <= 24 ? 'var(--pending)' : 'var(--overdue)';
                    return (
                      <tr key={r.loanId} className="esp-row-hover">
                        <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                        <td>{r.lender}</td>
                        <td><span className="esp-pill" style={{ background: r.currentRate > 8 ? 'var(--overdue-bg)' : 'var(--pending-bg)', color: r.currentRate > 8 ? '#6D28D9' : 'var(--pending-dark)' }}>{r.currentRate.toFixed(2)}%</span></td>
                        <td style={{ color: 'var(--pending)' }}>+{r.rateDiffBps}bps above market</td>
                        <td style={{ textAlign: 'right' }}>{fmtUsd(r.outstanding)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--growth)' }}>{fmtUsd(r.monthlySavings)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--growth)', fontWeight: 700 }}>{fmtUsd(r.annualSavings)}</td>
                        <td style={{ color: beColor }}>{r.breakEvenMonths != null ? `${r.breakEvenMonths.toFixed(0)} months` : '—'}</td>
                      </tr>
                    );
                  })}
                  <tr className="esp-total-row">
                    <td colSpan={5}>Total potential savings</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(totalMonthlySavings)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(totalAnnualSavings)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, background: 'var(--active-bg)', borderLeft: '4px solid var(--active)', borderRadius: 8, padding: '14px 18px', fontSize: 13 }}>
              Refinancing {refinanceRows.length} loan{refinanceRows.length === 1 ? '' : 's'} could save {fmtUsd(totalAnnualSavings)}/year ({fmtUsd(totalMonthlySavings)}/month).
              At current rates, break-even in avg {avgBreakEven.toFixed(0)} months.
            </div>
          </>
        )}
      </div>

      {/* Section 4 — Amortization Schedule */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 12 }}>Amortization Schedule</div>
        <select
          value={selectedLoanId}
          onChange={e => setSelectedLoanId(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 13, marginBottom: 16, minWidth: 320 }}
        >
          {activeLoans.map(l => {
            const co = companies.find(c => c.id === l.companyId);
            return <option key={l.id} value={l.id}>{co?.name ?? l.company} — {l.bank} — {fmtUsd(l.balance)} @ {normalizeInterestRatePercent(l.interestRate).toFixed(2)}%</option>;
          })}
        </select>

        {!selectedLoan ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="No loan selected" />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[['Original Amount', fmtUsd(selectedLoan.amount)], ['Outstanding', fmtUsd(selectedLoan.balance)], ['Rate', pct(normalizeInterestRatePercent(selectedLoan.interestRate), 2)], ['Monthly EMI', fmtUsd(selectedLoan.emi)], ['Remaining Payments', `${amortSchedule.length} mo`], ['Payoff Date', amortSchedule.length ? amortSchedule[amortSchedule.length - 1].date : '—']].map(([label, value]) => (
                <div key={label as string}>
                  <div className="esp-label">{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>

            {amortSchedule.length === 0 ? (
              <EmptyState icon={<AlertTriangle size={32} />} title="Cannot amortize" note="EMI does not cover monthly interest at the current rate — schedule cannot resolve." />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={amortSchedule.filter((_, i) => i % 3 === 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="paymentNum" tick={{ fontSize: 10, fill: 'var(--slate)' }} label={{ value: 'Month', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                    <YAxis tickFormatter={v => fmtUsd(v)} tick={{ fontSize: 10, fill: 'var(--slate)' }} width={70} />
                    <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="principal" stackId="1" name="Principal" stroke="#1B3A6B" fill="#1B3A6B" fillOpacity={0.6} />
                    <Area type="monotone" dataKey="interest" stackId="1" name="Interest" stroke="#7C3AED" fill="#7C3AED" fillOpacity={0.6} />
                  </ComposedChart>
                </ResponsiveContainer>

                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table className="esp-table">
                    <thead><tr><th style={{ textAlign: 'right' }}>#</th><th>Date</th><th style={{ textAlign: 'right' }}>Opening</th><th style={{ textAlign: 'right' }}>EMI</th><th style={{ textAlign: 'right' }}>Principal</th><th style={{ textAlign: 'right' }}>Interest</th><th style={{ textAlign: 'right' }}>Closing</th><th style={{ textAlign: 'right' }}>Cum. Interest</th></tr></thead>
                    <tbody>
                      {visibleAmortRows.map(r => (
                        <tr key={r.paymentNum}>
                          <td>{r.paymentNum}</td>
                          <td>{r.date}</td>
                          <td style={{ textAlign: 'right' }}>{fmtUsd(r.openingBalance)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtUsd(r.emi)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--active)' }}>{fmtUsd(r.principal)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--overdue)' }}>{fmtUsd(r.interest)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtUsd(r.closingBalance)}</td>
                          <td style={{ textAlign: 'right' }}>{fmtUsd(r.cumulativeInterest)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {amortSchedule.length > 12 && (
                  <button type="button" className="esp-btn-ghost" style={{ marginTop: 12 }} onClick={() => setShowAllMonths(v => !v)}>
                    {showAllMonths ? 'Show first 12 months' : `Show all ${amortSchedule.length} months ▾`}
                  </button>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 16 }}>
                  <div><div className="esp-label">Total Remaining Payments</div><div style={{ fontSize: 15, fontWeight: 700 }}>{fmtUsd(totalRemainingPayments)}</div></div>
                  <div><div className="esp-label">Total Interest Remaining</div><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--overdue)' }}>{fmtUsd(totalRemainingInterest)}</div></div>
                  <div><div className="esp-label">Total Principal Remaining</div><div style={{ fontSize: 15, fontWeight: 700, color: 'var(--active)' }}>{fmtUsd(totalRemainingPrincipal)}</div></div>
                  <div><div className="esp-label">Interest as % of Total</div><div style={{ fontSize: 15, fontWeight: 700 }}>{totalRemainingPayments > 0 ? pct((totalRemainingInterest / totalRemainingPayments) * 100) : '—'}</div></div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Section 5 — Payoff Calculator */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Loan Payoff Calculator</div>
        <div className="esp-sub" style={{ marginBottom: 16 }}>Calculate exact cost to close the loan selected above, on any date</div>
        {!selectedLoan || !payoff ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="Select a loan above" />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
              <div>
                <div className="esp-label" style={{ marginBottom: 4 }}>Payoff Date</div>
                <input type="date" value={payoffDate} onChange={e => setPayoffDate(e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)' }} />
              </div>
              <div>
                <div className="esp-label" style={{ marginBottom: 4 }}>Prepayment Penalty %</div>
                <input type="number" min={0} max={5} step={0.1} value={penaltyPct} onChange={e => setPenaltyPct(Number(e.target.value))} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', width: 100 }} />
              </div>
            </div>
            <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 22px', maxWidth: 480 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Payoff Summary — {selectedLoan.bank}</div>
              {[
                ['Outstanding Principal', fmtUsd(payoff.outstandingPrincipal)],
                [`+ Accrued Interest (${payoff.accruedDays} days)`, fmtUsd(payoff.accruedInterest)],
                [`+ Prepayment Penalty (${penaltyPct}%)`, fmtUsd(payoff.prepaymentPenalty)],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                  <span style={{ color: 'var(--slate)' }}>{label}</span><span>{value}</span>
                </div>
              ))}
              <div style={{ borderTop: '2px solid var(--gold)', marginTop: 8, paddingTop: 8, background: 'var(--gold-light)', margin: '8px -22px -18px', padding: '12px 22px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>TOTAL PAYOFF AMOUNT</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#0D1B2A' }}>{fmtUsd(payoff.totalPayoff)}</span>
                </div>
                <div className="esp-sub">as of {payoff.asOfDate}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Section 6 — Interest Rate Sensitivity */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Interest Rate Sensitivity Analysis</div>
        <div className="esp-sub" style={{ marginBottom: 16 }}>Impact of rate changes on portfolio debt service and DSCR</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>What if rates change by {rateChange >= 0 ? '+' : ''}{rateChange.toFixed(2)}%?</label>
          <input type="range" min={-3} max={3} step={0.25} value={rateChange} onChange={e => setRateChange(Number(e.target.value))} style={{ accentColor: 'var(--gold)', width: 220 }} />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="esp-table">
            <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Current EMI</th><th style={{ textAlign: 'right' }}>New EMI</th><th style={{ textAlign: 'right' }}>Change</th><th style={{ textAlign: 'right' }}>Current DSCR</th><th style={{ textAlign: 'right' }}>New DSCR</th><th>Impact</th></tr></thead>
            <tbody>
              {sensitivityRows.map(r => {
                const pill = statusPillStyle(statusToEsp(r.impactStatus));
                return (
                  <tr key={r.entityId} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.currentEmi)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.newEmi)}</td>
                    <td style={{ textAlign: 'right', color: r.changeAmount > 0 ? 'var(--overdue)' : r.changeAmount < 0 ? 'var(--growth)' : 'var(--slate)' }}>
                      {r.changeAmount === 0 ? '—' : `${r.changeAmount > 0 ? '+' : '-'}${fmtUsd(Math.abs(r.changeAmount))}/mo`}
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.currentDscr != null ? `${r.currentDscr.toFixed(2)}x` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.newDscr != null ? `${r.newDscr.toFixed(2)}x` : '—'}</td>
                    <td><span className="esp-pill" style={pill}>{r.impactStatus}</span></td>
                  </tr>
                );
              })}
              <tr className="esp-total-row">
                <td>Portfolio Total</td>
                <td style={{ textAlign: 'right' }}>{fmtUsd(totalCurrentEmi)}</td>
                <td style={{ textAlign: 'right' }}>{fmtUsd(totalNewEmi)}</td>
                <td style={{ textAlign: 'right' }}>{fmtUsd(totalNewEmi - totalCurrentEmi)}/mo</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16, background: 'var(--gold-light)', borderLeft: '4px solid var(--gold)', borderRadius: 8, padding: '14px 18px', fontSize: 13 }}>
          {rateChange > 0
            ? `A ${rateChange.toFixed(2)}% rate increase would add ${fmtUsd(totalNewEmi - totalCurrentEmi)} to monthly debt service (${fmtUsd((totalNewEmi - totalCurrentEmi) * 12)} annually). ${sensitivityRows.filter(r => (r.newDscr ?? 99) < 1.25).length} entities would see DSCR drop below 1.25x threshold.`
            : rateChange < 0
              ? `A ${Math.abs(rateChange).toFixed(2)}% rate reduction would save ${fmtUsd(totalCurrentEmi - totalNewEmi)} per month (${fmtUsd((totalCurrentEmi - totalNewEmi) * 12)} annually).`
              : 'Adjust the slider to see the impact of a rate change.'}
        </div>

        <ResponsiveContainer width="100%" height={220} style={{ marginTop: 16 }}>
          <LineChart data={sensitivityChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="rateLabel" tick={{ fontSize: 10, fill: 'var(--slate)' }} />
            <YAxis yAxisId="left" tickFormatter={v => fmtUsd(v)} tick={{ fontSize: 10, fill: 'var(--slate)' }} width={70} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}x`} tick={{ fontSize: 10, fill: 'var(--slate)' }} />
            <Tooltip contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <ReferenceLine yAxisId="right" y={1.25} stroke="#F5A623" strokeDasharray="4 4" label={{ value: '1.25x min', fontSize: 9, fill: '#F5A623' }} />
            <Line yAxisId="left" type="monotone" dataKey="emi" name="Total Monthly EMI" stroke="#7C3AED" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="dscr" name="Portfolio Avg DSCR" stroke="#1B3A6B" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Section 7 — Debt Capacity Analysis */}
      <div className="esp-card">
        <div className="esp-section-title" style={{ marginBottom: 4 }}>Debt Capacity &amp; Headroom</div>
        <div className="esp-sub" style={{ marginBottom: 16 }}>Maximum additional debt supportable at current NOI levels (min. 1.25x DSCR, max 75% LTLV)</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="esp-table">
            <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>NOI</th><th style={{ textAlign: 'right' }}>Debt Service</th><th style={{ textAlign: 'right' }}>DSCR</th><th style={{ textAlign: 'right' }}>Max Debt Service</th><th style={{ textAlign: 'right' }}>Headroom</th><th style={{ textAlign: 'right' }}>Max Add'l (DSCR)</th><th style={{ textAlign: 'right' }}>Max Add'l (LTLV 75%)</th><th style={{ textAlign: 'right' }}>Capacity</th></tr></thead>
            <tbody>
              {capacityRows.map(r => (
                <tr key={r.entityId} className="esp-row-hover">
                  <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                  <td style={{ textAlign: 'right' }}>{r.currentNoi != null ? fmtUsd(r.currentNoi) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(r.currentDebtService)}</td>
                  <td style={{ textAlign: 'right' }}>{r.currentDscr != null ? `${r.currentDscr.toFixed(2)}x` : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.maxDebtService != null ? fmtUsd(r.maxDebtService) : '—'}</td>
                  <td style={{ textAlign: 'right', color: r.debtHeadroom == null ? 'var(--slate)' : r.debtHeadroom >= 0 ? 'var(--growth)' : 'var(--overdue)' }}>
                    {r.debtHeadroom == null ? '—' : r.debtHeadroom >= 0 ? fmtUsd(r.debtHeadroom) : `(at limit)`}
                  </td>
                  <td style={{ textAlign: 'right', color: (r.maxAdditionalLoanDscr ?? 0) > 0 ? 'var(--navy-text)' : 'var(--overdue)' }}>
                    {r.maxAdditionalLoanDscr == null ? '—' : r.maxAdditionalLoanDscr > 0 ? fmtUsd(r.maxAdditionalLoanDscr) : '$0 — at or above debt limit'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.ltlvHeadroom != null ? fmtUsd(r.ltlvHeadroom) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--gold)' }}>{r.actualCapacity != null ? fmtUsd(Math.max(0, r.actualCapacity)) : '—'}</td>
                </tr>
              ))}
              <tr className="esp-total-row">
                <td colSpan={5}>Portfolio Total</td>
                <td style={{ textAlign: 'right' }}>{fmtUsd(totalHeadroomDscr)}</td>
                <td colSpan={2} />
                <td style={{ textAlign: 'right' }}>{fmtUsd(totalCapacity)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <ResponsiveContainer width="100%" height={Math.max(160, capacityRows.length * 34)} style={{ marginTop: 16 }}>
          <BarChart data={capacityRows.map(r => ({
            name: r.entityName.length > 18 ? `${r.entityName.slice(0, 16)}…` : r.entityName,
            current: sumActivePropDevLoanBalances(activeLoans.filter(l => l.companyId === r.entityId)),
            headroom: Math.max(0, r.ltlvHeadroom ?? 0),
          }))} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis type="number" tickFormatter={v => fmtUsd(v)} tick={{ fontSize: 10, fill: 'var(--slate)' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--slate)' }} width={120} />
            <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="current" stackId="a" name="Current Debt" fill="#1B3A6B" />
            <Bar dataKey="headroom" stackId="a" name="Headroom to 75% LTLV" fill="#5BB5A2" fillOpacity={0.4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
