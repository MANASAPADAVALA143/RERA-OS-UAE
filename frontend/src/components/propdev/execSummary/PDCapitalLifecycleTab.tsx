/**
 * Property Dev Executive Summary — Capital Lifecycle tab.
 * Entity-scoped (same selector as Deal P&L / Acquisition Flow / Carrying
 * Costs Tracker / Balance Sheet / Cash Flow) — this is one entity's
 * investment story end to end, not a portfolio rollup.
 *
 * Read-only composed view: every number here already exists on Acquisition
 * Flow, Carrying Costs Tracker, Capital Structure, or Distribution
 * Waterfall — no new backend work, just the same data laid out as a single
 * narrative instead of scattered across 4 tabs.
 *
 * "Invested" deliberately reuses Acquisition Flow's exact Total Cost Basis
 * definition (landCost + acquisition costs), not propDevCompanyOverview's
 * Balance-Sheet-derived costBasis and not total capital calls issued — see
 * PDAcquisitionFlowTab.tsx. Capital calls issued is a demand figure (may
 * include due-but-unpaid amounts); that reconciliation already lives in
 * Acquisition Flow's Capital Call Trigger Panel and is intentionally not
 * duplicated here. Any divergence between capital raised and cost basis
 * (e.g. land already owned before formal capital calls started) is a real
 * signal and is left visible, not blended away.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Coins, Landmark, Wallet, Scale, ArrowLeftRight, ArrowRight } from 'lucide-react';
import api from '../../../services/api';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import type { PDFinItemLike } from '../../../utils/propDevCfoTrendData';
import { EmptyState } from '../../rental/execSummary/espShared';
import {
  buildYearRows, CARRYING_CATEGORIES, CATEGORY_LABEL, CATEGORY_COLOR,
} from './PDCarryingCostsTrackerTab';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

interface DistributionEvent {
  id: string;
  amount: number;
  distribution_action: 'reinvest' | 'payout';
}

interface Props {
  company: CompanyData | undefined;
  kpis: PropDevCompanyOverviewKpis | undefined;
  pl: PDFinItemLike[] | undefined;
}

export default function PDCapitalLifecycleTab({ company, kpis, pl }: Props) {
  // ── Stage 1 — Capital raised (from Capital Structure) ───────────────────────
  const capitalRaised = useMemo(() => {
    let classA = 0, classB = 0;
    for (const p of company?.partners ?? []) {
      if ((p.status as string) === 'Exited') continue;
      if (p.type === 'Class A') classA += p.capitalContributed || 0;
      else classB += p.capitalContributed || 0;
    }
    return { classA, classB, total: classA + classB };
  }, [company]);

  // ── Stage 2 — Invested (from Acquisition Flow's Total Cost Basis) ───────────
  const acquisitionCosts = useMemo(() => {
    const p = company?.property;
    if (!p) return 0;
    return (p.titleCharges || 0) + (p.legalFees || 0) + (p.professionalCharges || 0);
  }, [company]);
  const rawLandCost = company?.property?.landCost;
  const landCost = rawLandCost != null && rawLandCost > 0 ? rawLandCost : (kpis?.landValue ?? null);
  const totalCostBasis = landCost != null ? landCost + acquisitionCosts : null;

  // ── Stage 2b — Carrying cost to date (from Carrying Costs Tracker) ──────────
  const carryingRows = useMemo(() => buildYearRows(pl ?? []), [pl]);
  const totalCarryingCost = useMemo(() => carryingRows.reduce((s, r) => s + r.total, 0), [carryingRows]);
  const chartData = carryingRows.map(r => ({
    year: String(r.year),
    ...Object.fromEntries(CARRYING_CATEGORIES.map(cat => [CATEGORY_LABEL[cat], r[cat]])),
  }));

  // ── Stage 3 — Cash position and debt ─────────────────────────────────────────
  const bankBalance = kpis?.cash ?? null;
  const loanOutstanding = kpis?.loanOutstanding ?? kpis?.loanBalance ?? 0;
  const monthlyBurn = useMemo(() => {
    const loans = company?.loans ?? [];
    return loans.filter(l => l.status === 'Active').reduce((s, l) => s + (l.emi || 0), 0);
  }, [company]);
  const cashRunwayMonths = bankBalance != null && monthlyBurn > 0 ? bankBalance / monthlyBurn : null;

  // ── Stage 4 — Position today (from Acquisition Flow) ─────────────────────────
  const currentLandValue = kpis?.landValue ?? null;

  // ── Distributions back to partners (from Distribution Waterfall) ─────────────
  const [distributions, setDistributions] = useState<DistributionEvent[]>([]);
  const [loadingDist, setLoadingDist] = useState(false);

  const loadDistributions = useCallback(async () => {
    if (!company) return;
    setLoadingDist(true);
    try {
      const res = await api.get<{ items: DistributionEvent[] }>('/api/propdev/distributions', {
        params: { company_id: company.id },
      });
      setDistributions(res.data?.items ?? []);
    } catch (e) {
      console.error('Failed to load distributions:', e);
    } finally {
      setLoadingDist(false);
    }
  }, [company]);

  useEffect(() => { void loadDistributions(); }, [loadDistributions]);

  const waterfallTotals = useMemo(() => {
    let reinvest = 0, payout = 0;
    for (const d of distributions) {
      if (d.distribution_action === 'reinvest') reinvest += d.amount; else payout += d.amount;
    }
    return { reinvest, payout, total: reinvest + payout };
  }, [distributions]);

  if (!company) {
    return <p style={{ fontSize: 13, color: '#78716C' }}>Select an entity to view Capital Lifecycle.</p>;
  }

  const stages = [
    { label: 'Capital Raised', value: fmtUsd(capitalRaised.total), sub: `Class A ${fmtUsd(capitalRaised.classA)} · Class B ${fmtUsd(capitalRaised.classB)}`, accent: '#6D28D9', icon: <Coins size={18} /> },
    { label: 'Invested', value: fmtUsd(totalCostBasis), sub: 'Total Cost Basis', accent: 'var(--navy)', icon: <Landmark size={18} /> },
    { label: 'Carrying Cost to Date', value: fmtUsd(totalCarryingCost), sub: 'Interest + Tax + Improvements + Other', accent: 'var(--overdue)', icon: <Wallet size={18} /> },
    { label: 'Position Today', value: fmtUsd(currentLandValue), sub: 'Current Land Value (FV)', accent: 'var(--gold)', icon: <Scale size={18} /> },
  ];

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Section 1 — 4-stage lifecycle strip */}
      <div className="esp-card" style={{ padding: '20px 24px' }}>
        <div className="esp-section-title" style={{ padding: 0, marginBottom: 16 }}>Capital Lifecycle — {company.name}</div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, flexWrap: 'wrap' }}>
          {stages.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 200px' }}>
              <div className="esp-card" style={{ borderTop: `3px solid ${s.accent}`, padding: '14px 16px', flex: 1, minWidth: 160 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: s.accent }}>
                  {s.icon}
                  <div className="esp-label" style={{ margin: 0 }}>{s.label}</div>
                </div>
                <div style={{ fontSize: 19, fontWeight: 800, marginTop: 6 }}>{s.value}</div>
                <div className="esp-sub" style={{ marginTop: 4 }}>{s.sub}</div>
              </div>
              {i < stages.length - 1 && (
                <ArrowRight size={18} style={{ color: 'var(--slate)', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Section 2 — Carrying cost breakdown */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <Wallet size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Carrying Cost Breakdown, Year over Year
        </div>
        {chartData.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<Wallet size={28} />} title="No carrying-cost line items found for this entity" /></div>
        ) : (
          <div style={{ padding: '0 24px 24px' }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5DFCF" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Legend />
                {CARRYING_CATEGORIES.map((cat, i) => (
                  <Bar
                    key={cat} dataKey={CATEGORY_LABEL[cat]} stackId="carrying" fill={CATEGORY_COLOR[cat]}
                    radius={i === CARRYING_CATEGORIES.length - 1 ? [3, 3, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Section 3 — Cash position and debt */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <Landmark size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Cash Position and Debt
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: 20 }}>
          <div className="esp-card" style={{ borderLeft: '3px solid var(--active)', padding: '14px 16px' }}>
            <div className="esp-label">Bank Balance</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fmtUsd(bankBalance)}</div>
          </div>
          <div className="esp-card" style={{ borderLeft: '3px solid var(--overdue)', padding: '14px 16px' }}>
            <div className="esp-label">Loan Outstanding</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fmtUsd(loanOutstanding)}</div>
          </div>
          <div className="esp-card" style={{ borderLeft: '3px solid var(--navy)', padding: '14px 16px' }}>
            <div className="esp-label">Cash Runway</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{cashRunwayMonths != null ? `${cashRunwayMonths.toFixed(1)} mo` : '—'}</div>
          </div>
        </div>
      </div>

      {/* Section 4 — Distributions back to partners */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <ArrowLeftRight size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Distributions Back to Partners
        </div>
        {loadingDist ? (
          <p style={{ fontSize: 13, color: '#78716C', padding: '0 24px 20px' }}>Loading distributions…</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: 20 }}>
            <div className="esp-card" style={{ borderLeft: '3px solid var(--gold)', padding: '14px 16px' }}>
              <div className="esp-label">Total Distributed</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fmtUsd(waterfallTotals.total)}</div>
            </div>
            <div className="esp-card" style={{ borderLeft: '3px solid var(--active)', padding: '14px 16px' }}>
              <div className="esp-label">Payout</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--active)', marginTop: 4 }}>{fmtUsd(waterfallTotals.payout)}</div>
            </div>
            <div className="esp-card" style={{ borderLeft: '3px solid #6D28D9', padding: '14px 16px' }}>
              <div className="esp-label">Reinvested</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#6D28D9', marginTop: 4 }}>{fmtUsd(waterfallTotals.reinvest)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
