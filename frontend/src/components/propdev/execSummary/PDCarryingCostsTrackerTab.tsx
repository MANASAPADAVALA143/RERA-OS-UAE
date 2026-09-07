/**
 * Property Dev Executive Summary — Carrying Costs Tracker tab.
 * Entity-scoped (same selector as Deal P&L / Acquisition Flow / Balance Sheet /
 * Cash Flow), with an optional portfolio-wide toggle (lazy-fetched — only pulls
 * every other entity's P&L when actually switched to, not on every page load).
 *
 * Data source: pl_data expense_category tags (interest | property_tax |
 * improvements | other_carrying | operating | capex | debt_service | other),
 * written server-side by services/propdev_expense_categorizer.py. Only the 4
 * carrying-cost categories count here -- everything else (including the ~31%
 * residual still in "other") is out of scope for this view by definition.
 *
 * Period grain is annual only: pl_data's `values` (Record<year, number>) is
 * always populated regardless of upload; `monthlyValues` is only present when
 * the source Excel had monthly columns, which varies per company -- annual is
 * the one grain guaranteed to work for every entity.
 */
import { useMemo, useState, useCallback } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Landmark } from 'lucide-react';
import api from '../../../services/api';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PDFinItemLike } from '../../../utils/propDevCfoTrendData';
import { EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

export const CARRYING_CATEGORIES = ['interest', 'property_tax', 'improvements', 'other_carrying'] as const;
export type CarryingCategory = typeof CARRYING_CATEGORIES[number];
export const CATEGORY_LABEL: Record<CarryingCategory, string> = {
  interest: 'Interest Paid',
  property_tax: 'Property Tax',
  improvements: 'Improvements',
  other_carrying: 'Other Carrying',
};
export const CATEGORY_COLOR: Record<CarryingCategory, string> = {
  interest: '#1B3A6B',
  property_tax: '#5B5FEF',
  improvements: '#0F766E',
  other_carrying: '#6D28D9',
};

export interface YearRow {
  year: number;
  interest: number;
  property_tax: number;
  improvements: number;
  other_carrying: number;
  total: number;
}

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}

/** Sums carrying-cost detail lines (skips totals/headers/net-income) into one row per year. */
export function buildYearRows(items: PDFinItemLike[]): YearRow[] {
  const byYear = new Map<number, YearRow>();
  for (const item of items) {
    if (item.isTotal || item.isSectionHeader || item.isNetIncome) continue;
    const cat = item.expense_category as CarryingCategory | undefined;
    if (!cat || !CARRYING_CATEGORIES.includes(cat)) continue;
    for (const [yStr, val] of Object.entries(item.values || {})) {
      const year = Number(yStr);
      if (!Number.isFinite(year) || !val) continue;
      const row = byYear.get(year) ?? { year, interest: 0, property_tax: 0, improvements: 0, other_carrying: 0, total: 0 };
      row[cat] += Math.abs(val);
      row.total += Math.abs(val);
      byYear.set(year, row);
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

function mergeYearRows(all: YearRow[][]): YearRow[] {
  const byYear = new Map<number, YearRow>();
  for (const rows of all) {
    for (const r of rows) {
      const row = byYear.get(r.year) ?? { year: r.year, interest: 0, property_tax: 0, improvements: 0, other_carrying: 0, total: 0 };
      row.interest += r.interest;
      row.property_tax += r.property_tax;
      row.improvements += r.improvements;
      row.other_carrying += r.other_carrying;
      row.total += r.total;
      byYear.set(r.year, row);
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

interface Props {
  company: CompanyData | undefined;
  pl: PDFinItemLike[] | undefined;
  costBasis: number | null | undefined;
  companies: CompanyData[];
}

export default function PDCarryingCostsTrackerTab({ company, pl, costBasis, companies }: Props) {
  const [portfolioMode, setPortfolioMode] = useState(false);
  const [portfolioRows, setPortfolioRows] = useState<Record<string, YearRow[]> | null>(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);

  const loadPortfolio = useCallback(async () => {
    if (portfolioRows || loadingPortfolio) return;
    setLoadingPortfolio(true);
    try {
      const results = await Promise.all(companies.map(async c => {
        try {
          const res = await api.get<{ pl?: PDFinItemLike[] }>(`/api/propdev/financials/${c.id}`);
          return [c.id, buildYearRows(res.data?.pl ?? [])] as const;
        } catch {
          return [c.id, []] as const;
        }
      }));
      setPortfolioRows(Object.fromEntries(results));
    } finally {
      setLoadingPortfolio(false);
    }
  }, [companies, portfolioRows, loadingPortfolio]);

  function togglePortfolio() {
    const next = !portfolioMode;
    setPortfolioMode(next);
    if (next) void loadPortfolio();
  }

  const entityRows = useMemo(() => buildYearRows(pl ?? []), [pl]);
  const rows = useMemo(() => {
    if (!portfolioMode) return entityRows;
    if (!portfolioRows) return [];
    return mergeYearRows(Object.values(portfolioRows));
  }, [portfolioMode, entityRows, portfolioRows]);

  const totalCarryingCost = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows]);
  const latest = rows[rows.length - 1];
  const prior = rows[rows.length - 2];
  const pctOfCostBasis = latest && costBasis && costBasis > 0 ? (latest.total / costBasis) * 100 : null;
  const yoyDelta = latest && prior && prior.total > 0 ? ((latest.total - prior.total) / prior.total) * 100 : null;

  const chartData = rows.map(r => ({
    year: String(r.year),
    'Interest Paid': r.interest,
    'Property Tax': r.property_tax,
    Improvements: r.improvements,
    'Other Carrying': r.other_carrying,
  }));

  if (!portfolioMode && !company) {
    return <p style={{ fontSize: 13, color: '#78716C' }}>Select an entity to view Carrying Costs Tracker.</p>;
  }

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={togglePortfolio}
          className="esp-pill"
          style={{
            background: portfolioMode ? '#1B3A6B' : '#fff', color: portfolioMode ? '#fff' : 'var(--navy-text)',
            border: '1px solid var(--border, #E5DFCF)', padding: '8px 16px', cursor: 'pointer', fontWeight: 600,
          }}
        >
          {portfolioMode ? 'Portfolio-wide (all entities)' : `Entity: ${company?.name ?? '—'}`} — click to toggle
        </button>
      </div>

      {portfolioMode && loadingPortfolio ? (
        <p style={{ fontSize: 13, color: '#78716C' }}>Loading portfolio carrying costs…</p>
      ) : rows.length === 0 ? (
        <div className="esp-card"><EmptyState icon={<Landmark size={32} />} title="No carrying-cost line items found for this scope" /></div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div className="esp-card" style={{ borderLeft: '3px solid var(--gold)', padding: '16px 20px' }}>
              <div className="esp-label">Total Carrying Cost</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{fmtUsd(totalCarryingCost)}</div>
              <div className="esp-sub" style={{ marginTop: 4 }}>All periods, {portfolioMode ? 'portfolio' : company?.name}</div>
            </div>
            <div className="esp-card" style={{ borderLeft: '3px solid var(--navy)', padding: '16px 20px' }}>
              <div className="esp-label">Carrying Cost % of Cost Basis</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{pctOfCostBasis != null ? `${pctOfCostBasis.toFixed(1)}%` : '—'}</div>
              <div className="esp-sub" style={{ marginTop: 4 }}>Latest year ({latest?.year ?? '—'}) vs Cost Basis</div>
            </div>
            <div className="esp-card" style={{ borderLeft: `3px solid ${yoyDelta == null ? 'var(--slate)' : yoyDelta > 0 ? 'var(--overdue)' : 'var(--active)'}`, padding: '16px 20px' }}>
              <div className="esp-label">YoY Trend</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, color: yoyDelta == null ? 'var(--navy-text)' : yoyDelta > 0 ? 'var(--overdue)' : 'var(--active)' }}>
                {yoyDelta == null ? <Minus size={18} /> : yoyDelta > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                {yoyDelta != null ? `${Math.abs(yoyDelta).toFixed(1)}%` : '—'}
              </div>
              <div className="esp-sub" style={{ marginTop: 4 }}>{latest?.year ?? '—'} vs {prior?.year ?? '—'}</div>
            </div>
          </div>

          <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Carrying Costs by Category Over Time</div>
            <div style={{ padding: '0 24px 24px' }}>
              <ResponsiveContainer width="100%" height={280}>
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
          </div>

          <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Carrying Costs Breakdown</div>
            <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
              <table className="esp-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th style={{ textAlign: 'right' }}>Interest Paid</th>
                    <th style={{ textAlign: 'right' }}>Property Tax</th>
                    <th style={{ textAlign: 'right' }}>Improvements</th>
                    <th style={{ textAlign: 'right' }}>Other Carrying</th>
                    <th style={{ textAlign: 'right' }}>Total Carrying Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.year} className="esp-row-hover">
                      <td style={{ fontWeight: 600 }}>{r.year}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(r.interest)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(r.property_tax)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(r.improvements)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtUsd(r.other_carrying)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtUsd(r.total)}</td>
                    </tr>
                  ))}
                  <tr className="esp-total-row">
                    <td>All Years</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(rows.reduce((s, r) => s + r.interest, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(rows.reduce((s, r) => s + r.property_tax, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(rows.reduce((s, r) => s + r.improvements, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(rows.reduce((s, r) => s + r.other_carrying, 0))}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(totalCarryingCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
