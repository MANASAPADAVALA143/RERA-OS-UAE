/**
 * Property Dev Executive Summary — Capital Structure tab.
 * Portfolio-wide by default, with a per-entity toggle (not a separate top-nav
 * selector — this tab's own dropdown, since it needs to stay comparable across
 * entities for the stacked bar chart). Sections: A (Share Capital Breakdown),
 * B (Distribution Waterfall), C (Partner ROI Summary). Section D (Lot
 * Reinvestment Tracker) deferred — needs new persisted fields (board approval
 * status) not built yet.
 *
 * Distribution Waterfall (Section B) is the only manual-entry path for
 * per-event distributions today — bulk Excel import still writes the legacy
 * distributions_received running total directly (Annexure II's "Distributed
 * ($)" column has no date/action, so it can't populate propdev_distributions
 * cleanly). The backend keeps distributions_received in sync on every manual
 * entry (routers/propdev/distributions.py), so Partner ROI Summary below
 * reads distributionsReceived as-is with no separate summing needed here —
 * it already reflects legacy bulk-import totals + all manual entries.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PieChart as PieChartIcon, Users, ArrowLeftRight, Trash2 } from 'lucide-react';
import api from '../../../services/api';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { EmptyState } from '../../rental/execSummary/espShared';
import { partnerReturnMetrics } from '../../../utils/ownershipMetrics';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

interface DistributionEvent {
  id: string;
  company_id: string;
  partner_id: string;
  partner_name: string;
  period: string;
  distribution_date: string | null;
  amount: number;
  distribution_action: 'reinvest' | 'payout';
  notes: string | null;
}

interface Props {
  companies: CompanyData[];
  kpisById: Record<string, PropDevCompanyOverviewKpis>;
  loading: boolean;
  refetchCompanies: () => Promise<void>;
  /** Entity selected in the page-level shared dropdown (Deal P&L / Balance Sheet /
   *  etc.) — kept in sync here so switching that dropdown also updates this tab,
   *  without losing the ability to pick "Portfolio-wide" locally afterward. */
  sharedCompanyId?: string;
}

export default function PDCapitalStructureTab({ companies, kpisById, loading, refetchCompanies, sharedCompanyId }: Props) {
  const [viewCompanyId, setViewCompanyId] = useState<string>(sharedCompanyId || 'all');
  useEffect(() => {
    if (sharedCompanyId) setViewCompanyId(sharedCompanyId);
  }, [sharedCompanyId]);
  const scoped = useMemo(
    () => viewCompanyId === 'all' ? companies : companies.filter(c => c.id === viewCompanyId),
    [companies, viewCompanyId],
  );

  const classTotals = useMemo(() => {
    let classA = 0, classB = 0, bankDebt = 0, capitalRaised = 0;
    for (const c of scoped) {
      for (const p of c.partners ?? []) {
        if ((p.status as string) === 'Exited') continue;
        if (p.type === 'Class A') classA += p.capitalContributed || 0;
        else classB += p.capitalContributed || 0;
      }
      bankDebt += kpisById[c.id]?.loanBalance ?? 0;
      // Capital Raised = B/S "Total for Partner Investments" -- distinct from the
      // Class A/B split above, which stays partner-level (Ownership sheet) since the
      // B/S line has no per-class breakdown.
      capitalRaised += kpisById[c.id]?.partnerInvestments ?? 0;
    }
    const shareCapital = classA + classB;
    return { classA, classB, bankDebt, shareCapital, capitalRaised, capitalStack: capitalRaised + bankDebt };
  }, [scoped, kpisById]);

  const chartData = useMemo(() => scoped.map(c => {
    let classA = 0, classB = 0;
    for (const p of c.partners ?? []) {
      if ((p.status as string) === 'Exited') continue;
      if (p.type === 'Class A') classA += p.capitalContributed || 0;
      else classB += p.capitalContributed || 0;
    }
    return { name: c.name.length > 16 ? `${c.name.slice(0, 15)}…` : c.name, 'Class A': classA, 'Class B': classB, 'Bank Debt': kpisById[c.id]?.loanBalance ?? 0 };
  }), [scoped, kpisById]);

  // ── Section B — Distribution Waterfall ──────────────────────────────────────
  const [distributions, setDistributions] = useState<DistributionEvent[]>([]);
  const [loadingDist, setLoadingDist] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formCompanyId, setFormCompanyId] = useState('');
  const [formPartnerId, setFormPartnerId] = useState('');
  const [formPeriod, setFormPeriod] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formAction, setFormAction] = useState<'reinvest' | 'payout'>('payout');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadDistributions = useCallback(async () => {
    setLoadingDist(true);
    try {
      const params = viewCompanyId !== 'all' ? { company_id: viewCompanyId } : undefined;
      const res = await api.get<{ items: DistributionEvent[] }>('/api/propdev/distributions', { params });
      setDistributions(res.data?.items ?? []);
    } catch (e) {
      console.error('Failed to load distributions:', e);
    } finally {
      setLoadingDist(false);
    }
  }, [viewCompanyId]);

  useEffect(() => { void loadDistributions(); }, [loadDistributions]);

  const formCompany = companies.find(c => c.id === formCompanyId);

  function openForm() {
    setFormCompanyId(viewCompanyId !== 'all' ? viewCompanyId : (companies[0]?.id ?? ''));
    setFormPartnerId('');
    setFormPeriod('');
    setFormDate('');
    setFormAmount('');
    setFormAction('payout');
    setFormNotes('');
    setFormError(null);
    setShowForm(true);
  }

  async function submitDistribution() {
    setFormError(null);
    if (!formCompanyId || !formPartnerId || !formPeriod.trim() || !formAmount || Number(formAmount) <= 0) {
      setFormError('Company, partner, period, and a positive amount are required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/propdev/distributions', {
        company_id: formCompanyId,
        partner_id: formPartnerId,
        period: formPeriod.trim(),
        distribution_date: formDate || null,
        amount: Number(formAmount),
        distribution_action: formAction,
        notes: formNotes.trim() || null,
      });
      setShowForm(false);
      await Promise.all([loadDistributions(), refetchCompanies()]);
    } catch (e) {
      console.error('Failed to record distribution:', e);
      setFormError('Failed to save this distribution. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteDistribution(id: string) {
    try {
      await api.delete(`/api/propdev/distributions/${id}`);
      await Promise.all([loadDistributions(), refetchCompanies()]);
    } catch (e) {
      console.error('Failed to delete distribution:', e);
    }
  }

  const companyNameById = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c.name])), [companies]);
  const waterfallTotals = useMemo(() => {
    let reinvest = 0, payout = 0;
    for (const d of distributions) {
      if (d.distribution_action === 'reinvest') reinvest += d.amount; else payout += d.amount;
    }
    return { reinvest, payout, total: reinvest + payout };
  }, [distributions]);

  const partnerRows = useMemo(() => {
    const rows: {
      key: string; name: string; type: string; capital: number; distributions: number;
      unreturned: number; roiPct: number | null; irrLabel: string;
    }[] = [];
    for (const c of scoped) {
      for (const p of c.partners ?? []) {
        if ((p.status as string) === 'Exited') continue;
        const capital = p.capitalContributed || 0;
        const distributions = p.distributionsReceived || 0;
        const currentValue = p.fairMarketValue ?? p.bookValue ?? p.costBasis ?? 0;
        // Real dated cash flows from this partner's capital calls (contributions);
        // distributions + terminal FV are undated (mark-to-market "as of today"),
        // same convention used on the Ownership tab.
        const calls = (c.capitalCalls ?? []).filter(cc => cc.partnerId === p.id && (cc.received || 0) > 0);
        const contribs = calls.map(cc => ({
          date: cc.receivedDate ?? cc.dueDate ?? '',
          amount: -(cc.received || 0),
          type: 'contribution',
        })).filter(cf => cf.date);
        const metrics = partnerReturnMetrics(contribs, capital, currentValue + distributions);
        rows.push({
          key: `${c.id}-${p.id}`,
          name: p.name,
          type: p.type,
          capital,
          distributions,
          unreturned: Math.max(0, capital - distributions),
          roiPct: capital > 0 ? (distributions / capital) * 100 : null,
          irrLabel: metrics.irrLabel,
        });
      }
    }
    return rows.sort((a, b) => b.capital - a.capital);
  }, [scoped]);

  if (loading) return <p style={{ fontSize: 13, color: '#78716C' }}>Loading capital structure…</p>;

  const kpiCards = [
    { label: 'Capital Raised', value: fmtUsd(classTotals.capitalRaised), accent: 'var(--gold)', sub: 'B/S Total for Partner Investments' },
    { label: 'Class A (GP/Promoter)', value: fmtUsd(classTotals.classA), accent: 'var(--navy)' },
    { label: 'Class B (LP Partners)', value: fmtUsd(classTotals.classB), accent: '#6D28D9' },
    { label: 'Bank Debt', value: fmtUsd(classTotals.bankDebt), accent: 'var(--overdue)' },
    { label: 'Total Capital Stack', value: fmtUsd(classTotals.capitalStack), accent: 'var(--active)', sub: 'Share Capital + Bank' },
  ];

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <select
          value={viewCompanyId}
          onChange={e => setViewCompanyId(e.target.value)}
          style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border, #E5DFCF)', background: '#fff', minWidth: 200 }}
        >
          <option value="all">Portfolio-wide (all entities)</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Section A — Share Capital Breakdown */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <PieChartIcon size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Share Capital Breakdown
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, padding: 20 }}>
          {kpiCards.map(c => (
            <div key={c.label} className="esp-card" style={{ borderLeft: `3px solid ${c.accent}`, padding: '14px 16px' }}>
              <div className="esp-label">{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: c.accent, marginTop: 4 }}>{c.value}</div>
              {c.sub && <div className="esp-sub" style={{ marginTop: 4 }}>{c.sub}</div>}
            </div>
          ))}
        </div>
        {chartData.length === 0 ? (
          <div style={{ padding: '0 24px 24px' }}><EmptyState icon={<PieChartIcon size={28} />} title="No entities with capital data" /></div>
        ) : (
          <div style={{ padding: '0 24px 24px' }}>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5DFCF" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} interval={0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtUsd(v)} />
                <Legend />
                <Bar dataKey="Class A" stackId="cap" fill="#1B3A6B" />
                <Bar dataKey="Class B" stackId="cap" fill="#6D28D9" />
                <Bar dataKey="Bank Debt" stackId="cap" fill="#C0392B" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Section B — Distribution Waterfall */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="esp-section-title">
            <ArrowLeftRight size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Distribution Waterfall
          </div>
          <button
            type="button"
            onClick={openForm}
            className="esp-pill"
            style={{ background: 'var(--navy)', color: '#fff', border: 'none', padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
          >
            + Record Distribution
          </button>
        </div>
        <p className="esp-sub" style={{ padding: '4px 24px 0' }}>
          Manual entry only — bulk Excel import still updates the running-total field directly. Reinvest/payout is required per event.
        </p>

        {showForm && (
          <div className="esp-card" style={{ margin: '16px 24px 0', padding: 16, background: '#FAF8F2' }}>
            {formError && <div style={{ color: 'var(--overdue)', fontSize: 12, marginBottom: 8 }}>{formError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <label style={{ fontSize: 12 }}>
                Company
                <select
                  value={formCompanyId}
                  onChange={e => { setFormCompanyId(e.target.value); setFormPartnerId(''); }}
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #E5DFCF)' }}
                >
                  <option value="">Select…</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Partner
                <select
                  value={formPartnerId}
                  onChange={e => setFormPartnerId(e.target.value)}
                  disabled={!formCompany}
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #E5DFCF)' }}
                >
                  <option value="">Select…</option>
                  {(formCompany?.partners ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Period
                <input
                  value={formPeriod}
                  onChange={e => setFormPeriod(e.target.value)}
                  placeholder="e.g. Q2 2026"
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #E5DFCF)' }}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Distribution Date (optional)
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #E5DFCF)' }}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Amount
                <input
                  type="number"
                  min={0}
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #E5DFCF)' }}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                Action
                <select
                  value={formAction}
                  onChange={e => setFormAction(e.target.value as 'reinvest' | 'payout')}
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #E5DFCF)' }}
                >
                  <option value="payout">Payout</option>
                  <option value="reinvest">Reinvest</option>
                </select>
              </label>
              <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>
                Notes (optional)
                <input
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border, #E5DFCF)' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                onClick={submitDistribution}
                disabled={submitting}
                className="esp-pill"
                style={{ background: 'var(--active)', color: '#fff', border: 'none', padding: '8px 16px', cursor: submitting ? 'default' : 'pointer', fontWeight: 600, opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? 'Saving…' : 'Save Distribution'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="esp-pill"
                style={{ background: '#fff', color: 'var(--navy-text)', border: '1px solid var(--border, #E5DFCF)', padding: '8px 16px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

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

        {loadingDist ? (
          <p style={{ fontSize: 13, color: '#78716C', padding: '0 24px 20px' }}>Loading distributions…</p>
        ) : distributions.length === 0 ? (
          <div style={{ padding: '0 24px 24px' }}><EmptyState icon={<ArrowLeftRight size={28} />} title="No distributions recorded yet" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '0 0 20px' }}>
            <table className="esp-table">
              <thead>
                <tr>
                  <th>Period</th>
                  {viewCompanyId === 'all' && <th>Entity</th>}
                  <th>Partner</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Action</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {distributions.map(d => (
                  <tr key={d.id} className="esp-row-hover">
                    <td>{d.period}</td>
                    {viewCompanyId === 'all' && <td>{companyNameById[d.company_id] ?? '—'}</td>}
                    <td>{d.partner_name}</td>
                    <td>{d.distribution_date ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(d.amount)}</td>
                    <td>
                      <span
                        className="esp-pill"
                        style={{
                          fontSize: 11, padding: '3px 10px',
                          background: d.distribution_action === 'reinvest' ? 'rgba(109,40,217,0.12)' : 'var(--active-bg)',
                          color: d.distribution_action === 'reinvest' ? '#6D28D9' : 'var(--active)',
                        }}
                      >
                        {d.distribution_action === 'reinvest' ? 'Reinvest' : 'Payout'}
                      </span>
                    </td>
                    <td style={{ maxWidth: 200, color: 'var(--slate)', fontSize: 12 }}>{d.notes ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => deleteDistribution(d.id)}
                        title="Delete"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate)', padding: 4 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section C — Partner ROI Summary */}
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <Users size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Partner ROI Summary
        </div>
        <p className="esp-sub" style={{ padding: '4px 24px 0' }}>
          IRR is mark-to-market (unrealized) — dated from actual capital-call receipts where available, valued at current fair market value; not a realized exit IRR.
        </p>
        {partnerRows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<Users size={32} />} title="No partner data available" /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead>
                <tr>
                  <th>Partner</th><th>Class</th>
                  <th style={{ textAlign: 'right' }}>Capital Contributed</th>
                  <th style={{ textAlign: 'right' }}>Distributions Received</th>
                  <th style={{ textAlign: 'right' }}>Unreturned Capital</th>
                  <th style={{ textAlign: 'right' }}>Current ROI%</th>
                  <th style={{ textAlign: 'right' }}>IRR</th>
                </tr>
              </thead>
              <tbody>
                {partnerRows.map(r => (
                  <tr key={r.key} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>{r.type}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.capital)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--active)' }}>{fmtUsd(r.distributions)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.unreturned)}</td>
                    <td style={{ textAlign: 'right' }}>{r.roiPct != null ? `${r.roiPct.toFixed(1)}%` : '—'}</td>
                    <td style={{ textAlign: 'right' }} title="Mark-to-market, unrealized">{r.irrLabel}</td>
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
