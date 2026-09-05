/**
 * Property Dev Executive Summary — Unrealised G/L tab.
 * Portfolio-wide, one row per entity, expandable to a per-partner split.
 * Moved here (its own tab) from the Ownership tab, where it first landed.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Scale } from 'lucide-react';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { EmptyState } from '../../rental/execSummary/espShared';
import api from '../../../services/api';
import '../../../theme/execSummaryPremium.css';

// Mirrors the backend floor in services/propdev_capital_call_triggers.py --
// used here only to decide whether it's worth firing the trigger request at
// all; the backend re-validates materiality and the duplicate-call guard
// independently, so this is an optimization, not the source of truth.
const MATERIALITY_DOLLAR_FLOOR = 5_000;
const MATERIALITY_PCT_OF_BOOK_VALUE = 0.02;

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

interface GlPartnerRow {
  partnerId: string;
  partnerName: string;
  ownershipPct: number;
  contribution: number;
  glShare: number;
  roi: number | null;
}

interface GlRow {
  companyId: string;
  entity: string;
  salesConsideration: number;
  costValue: number;
  unrealisedGl: number;
  partners: GlPartnerRow[];
}

interface Props {
  companies: CompanyData[];
  kpisById: Record<string, PropDevCompanyOverviewKpis>;
  loading: boolean;
}

export default function PDUnrealisedGlTab({ companies, kpisById, loading }: Props) {
  const [expandedGl, setExpandedGl] = useState<string | null>(null);

  // Sales Consideration & Unrealised G/L Distribution — per locked spec:
  // Sales Consideration = FMV (Ownership data), Cost Value = Book Value
  // (Balance Sheet Land + Improvements, never Cost Basis), Unrealised G/L =
  // FMV - Book Value. Both figures already come from kpisById the same way
  // the Unrealised Gain/(Loss) card elsewhere on this page does.
  const glRows = useMemo((): GlRow[] => {
    const rows: GlRow[] = [];
    for (const c of companies) {
      const kpis = kpisById[c.id];
      if (kpis?.fmv == null || kpis?.bookValue == null) continue;
      const salesConsideration = kpis.fmv;
      const costValue = kpis.bookValue;
      const unrealisedGl = salesConsideration - costValue;
      const activePartners = (c.partners ?? []).filter(p => (p.status as string) !== 'Exited');
      // Share % derived from actual capital contributed, not the imported sharePercent
      // field -- that column is frequently blank per-partner on the source Excel even
      // when Capital is populated. Mirrors PDEntityDashboardTab.tsx / PDF export.
      const totalPartnerCapital = activePartners.reduce((s, pt) => s + pt.capitalContributed, 0);
      const partners: GlPartnerRow[] = activePartners.map(p => {
        const ownershipPct = totalPartnerCapital > 0
          ? (p.capitalContributed / totalPartnerCapital) * 100
          : (p.sharePercent > 1 ? p.sharePercent : p.sharePercent * 100);
        const glShare = unrealisedGl * (ownershipPct / 100);
        const roi = p.capitalContributed > 0 ? (glShare / p.capitalContributed) * 100 : null;
        return { partnerId: p.id, partnerName: p.name, ownershipPct, contribution: p.capitalContributed, glShare, roi };
      });
      rows.push({ companyId: c.id, entity: c.name, salesConsideration, costValue, unrealisedGl, partners });
    }
    return rows;
  }, [companies, kpisById]);

  // Auto-trigger: for each entity showing a loss that clears the materiality
  // floor, ask the backend to raise a capital call (it independently
  // re-checks materiality and skips if one's already open for this entity —
  // see services/propdev_capital_call_triggers.py). Guarded per-session so a
  // re-render doesn't re-fire the same request; the backend's own duplicate
  // guard is the real safety net.
  const triggeredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const row of glRows) {
      if (row.unrealisedGl >= 0) continue;
      const threshold = Math.max(MATERIALITY_DOLLAR_FLOOR, Math.abs(row.costValue) * MATERIALITY_PCT_OF_BOOK_VALUE);
      if (Math.abs(row.unrealisedGl) <= threshold) continue;
      if (triggeredRef.current.has(row.companyId)) continue;
      triggeredRef.current.add(row.companyId);
      api.post('/api/propdev/capital-calls/unrealised-loss', {
        company_id: row.companyId,
        unrealised_gl: row.unrealisedGl,
        book_value: row.costValue,
      }).catch(() => {
        // Non-fatal — this is a background side effect of viewing the tab, not
        // a user action; let them keep reading the page either way.
        triggeredRef.current.delete(row.companyId);
      });
    }
  }, [glRows]);

  if (loading) return <p style={{ fontSize: 13, color: '#78716C' }}>Loading unrealised G/L…</p>;

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 0' }} className="esp-section-title">
          <Scale size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Sales Consideration &amp; Unrealised G/L Distribution
        </div>
        <div className="esp-sub" style={{ padding: '4px 24px 0', fontStyle: 'italic' }}>
          Unrealised G/L = FMV &minus; Book Value (Land + Improvements). A loss past materiality (greater of $5,000 or 2% of Book Value) auto-raises a capital call — see the badge in Capital Call Tracker.
        </div>
        {glRows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<Scale size={32} />} title="Not available" note="Needs both FMV and Balance Sheet data per entity." /></div>
        ) : (
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Sales Consideration (FMV)</th><th style={{ textAlign: 'right' }}>Cost Value (Book)</th><th style={{ textAlign: 'right' }}>Unrealised G/L</th><th>Status</th></tr></thead>
              <tbody>
                {glRows.map(row => {
                  const isOpen = expandedGl === row.companyId;
                  const isGain = row.unrealisedGl >= 0;
                  return (
                    <Fragment key={row.companyId}>
                      <tr className="esp-row-hover" style={{ cursor: 'pointer' }} onClick={() => setExpandedGl(isOpen ? null : row.companyId)}>
                        <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{row.entity}
                        </td>
                        <td style={{ textAlign: 'right' }}>{fmtUsd(row.salesConsideration)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtUsd(row.costValue)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: isGain ? 'var(--positive)' : 'var(--critical)' }}>{fmtUsd(row.unrealisedGl)}</td>
                        <td>
                          <span className="esp-pill" style={{ background: isGain ? 'var(--positive-bg)' : 'var(--critical-bg)', color: isGain ? 'var(--positive)' : 'var(--critical)' }}>
                            {isGain ? 'Gain' : 'Loss'}
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0, background: 'var(--ivory-dark)' }}>
                            <div style={{ padding: '10px 16px 14px 40px' }}>
                              {row.partners.length === 0 ? (
                                <div className="esp-sub">No active partners on file for this entity.</div>
                              ) : (
                                <table className="esp-table" style={{ background: 'transparent' }}>
                                  <thead>
                                    <tr>
                                      <th>Partner</th>
                                      <th style={{ textAlign: 'right' }}>Ownership %</th>
                                      <th style={{ textAlign: 'right' }}>Amount Contribution (A)</th>
                                      <th style={{ textAlign: 'right' }}>Unrealised G/L Share (B)</th>
                                      <th style={{ textAlign: 'right' }}>ROI [B/A]</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {row.partners.map(p => (
                                      <tr key={p.partnerId}>
                                        <td>{p.partnerName}</td>
                                        <td style={{ textAlign: 'right' }}>{p.ownershipPct.toFixed(1)}%</td>
                                        <td style={{ textAlign: 'right' }}>{fmtUsd(p.contribution)}</td>
                                        <td style={{ textAlign: 'right', color: p.glShare >= 0 ? 'var(--positive)' : 'var(--critical)' }}>{fmtUsd(p.glShare)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, color: p.roi != null && p.roi < 0 ? 'var(--critical)' : 'var(--positive)' }}>
                                          {p.roi != null ? `${p.roi.toFixed(2)}%` : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
