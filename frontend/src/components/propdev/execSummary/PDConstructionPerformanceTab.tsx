import { useMemo } from 'react';
import { Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import type { CompanyData } from '../../../contexts/PropertyDevContext';
import type { PropDevCompanyOverviewKpis } from '../../../utils/propDevCompanyOverview';
import { EmptyState } from '../../rental/execSummary/espShared';
import '../../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  const v = n == null || !Number.isFinite(n) ? 0 : n;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
}
function yFmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

interface Props {
  company: CompanyData;
  kpis: PropDevCompanyOverviewKpis | undefined;
}

export default function PDConstructionPerformanceTab({ company, kpis }: Props) {
  const bsTrend = useMemo(() => {
    const bs = company.property.yearlyBS;
    if (!bs) return [];
    return Object.keys(bs).sort().map(year => ({
      year, Land: bs[year].land, 'Improvements/WIP': bs[year].improvements, 'Total Cost Basis': bs[year].land + bs[year].improvements,
    }));
  }, [company]);

  const capexByYear = useMemo(() => {
    const byYear = new Map<string, number>();
    for (const imp of company.propertyImprovements ?? []) {
      if (!imp.improvementDate) continue;
      const y = imp.improvementDate.slice(0, 4);
      byYear.set(y, (byYear.get(y) ?? 0) + (imp.improvementCost || 0));
    }
    return [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [company]);

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="esp-card">
        <div className="esp-section-title">Cost Basis vs. Land Value — {company.name}</div>
        {bsTrend.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="Not available" note="Populates once yearly Balance Sheet data exists for this entity." />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={bsTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--slate)' }} />
              <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: 'var(--slate)' }} width={64} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Land" fill="#1B3A6B" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Improvements/WIP" fill="#F5A623" radius={[3, 3, 0, 0]} />
              <Line type="monotone" dataKey="Total Cost Basis" stroke="#5B5FEF" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="esp-card">
        <div className="esp-section-title">WIP / Improvements Tracker</div>
        {(company.propertyImprovements ?? []).length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="No improvements recorded" />
        ) : (
          <table className="esp-table">
            <thead><tr><th>Type</th><th>Contractor</th><th>Date</th><th style={{ textAlign: 'right' }}>Cost</th></tr></thead>
            <tbody>
              {(company.propertyImprovements ?? []).map(imp => (
                <tr key={imp.id}>
                  <td>{imp.improvementType}</td>
                  <td>{imp.contractorName ?? '—'}</td>
                  <td>{imp.improvementDate ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(imp.improvementCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="esp-card">
        <div className="esp-section-title">Capex by Year</div>
        {capexByYear.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={32} />} title="Not available" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={capexByYear.map(([year, amount]) => ({ year, Capex: amount }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--slate)' }} />
              <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: 'var(--slate)' }} width={64} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="Capex" fill="#1B3A6B" radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="esp-sub">Current status: {company.property.currentStatus ?? (kpis?.hasFin ? 'Financials on file' : '—')}</div>
    </div>
  );
}
