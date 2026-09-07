import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import PropDevCfoBsCharts from './PropDevCfoBsCharts';
import PropDevCfoCfCharts from './PropDevCfoCfCharts';
import type { CompanyData, Loan } from '../../contexts/PropertyDevContext';
import type { PropDevUploadedFinancials } from '../../utils/propDevFinancialApi';
import type { PropDevBsSnapshot, PropDevCfSnapshot } from '../../utils/propDevCfoTrendData';
import type { PropDevYearSnapshot } from '../../utils/propDevPeriodKpis';
import type { PropDevFinLoadState } from '../../hooks/usePropDevCompanyFinancials';

const fmt = (n: number) => {
  if (!Number.isFinite(n) || n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1e6 ? `$${(abs / 1e6).toFixed(2)}M` : abs >= 1e3 ? `$${(abs / 1e3).toFixed(1)}K` : `$${abs.toLocaleString()}`;
  return n < 0 ? `(${s})` : s;
};

function SectionShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: 'rgba(212,175,55,0.25)' }}>
      <div className="px-4 py-3 border-b" style={{ background: '#EEF0FF', borderColor: 'rgba(212,175,55,0.20)' }}>
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function PlSummary({
  plSnapshots,
  selectedYear,
}: {
  plSnapshots: PropDevYearSnapshot[];
  selectedYear: number;
}) {
  const rows = useMemo(() => plSnapshots.map(r => ({
    year: r.yearLabel,
    rev: r.rev,
    exp: r.exp,
    net: r.netInc,
    noi: r.noi,
  })), [plSnapshots]);

  const latest = plSnapshots.find(r => r.year === selectedYear) ?? plSnapshots[plSnapshots.length - 1];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Revenue', value: fmt(latest?.rev ?? 0) },
          { label: 'Expenses', value: fmt(latest?.exp ?? 0) },
          { label: 'Net Income', value: fmt(latest?.netInc ?? 0) },
          { label: 'NOI', value: fmt(latest?.noi ?? 0) },
        ].map(k => (
          <div key={k.label} className="rounded-lg border p-3 text-center" style={{ borderColor: '#E8E9ED', background: '#FFFFFF' }}>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">{k.label}</p>
            <p className="text-lg font-bold font-mono text-gray-900 mt-1">{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{selectedYear}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-900 text-white">
              {['Year', 'Revenue', 'Expenses', 'Net Income', 'NOI'].map(h => (
                <th key={h} className={`px-3 py-2 ${h === 'Year' ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.year} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-semibold">{r.year}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.rev)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{fmt(r.exp)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.net)}</td>
                <td className="px-3 py-2 text-right font-mono text-blue-700">{fmt(r.noi)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border border-gray-100 p-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Revenue vs Expenses by Year</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={v => fmt(v as number)} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="rev" name="Revenue" fill="#5B5FEF" radius={[3, 3, 0, 0]} />
              <Bar dataKey="exp" name="Expenses" fill="#B91C1C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function PropDevCommandCenterSummaries({
  company,
  fin,
  loans,
  loadState,
  error,
  onRetry,
  plSnapshots,
  bsSnapshots,
  cfSnapshots,
  selectedYear,
}: {
  companyId?: string;
  company: CompanyData;
  fin: PropDevUploadedFinancials | null;
  loans: Loan[];
  loadState: PropDevFinLoadState;
  error: string | null;
  onRetry: () => void;
  plSnapshots: PropDevYearSnapshot[];
  bsSnapshots: PropDevBsSnapshot[];
  cfSnapshots: PropDevCfSnapshot[];
  selectedYear: number;
}) {
  if (loadState === 'loading') {
    return (
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        Loading financial statements for {company.name}…
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
        <span>{error ?? 'Could not load financials.'}</span>
        <button type="button" onClick={onRetry} className="underline font-semibold shrink-0">Retry</button>
      </div>
    );
  }

  if (loadState === 'empty' || !fin) {
    return (
      <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        No financials uploaded yet for {company.name}. Upload P&amp;L / Balance Sheet / Cash Flow under Financials to populate this summary.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionShell title="P&L Summary" subtitle={`${fin.companyName} · latest ${selectedYear}`}>
        <PlSummary plSnapshots={plSnapshots} selectedYear={selectedYear} />
      </SectionShell>

      <SectionShell title="Balance Sheet Summary" subtitle="Same source as Financials → Balance Sheet / CFO Dashboard">
        <PropDevCfoBsCharts
          snapshots={bsSnapshots}
          selectedYear={selectedYear}
          companyName={fin.companyName}
        />
      </SectionShell>

      <SectionShell title="Cash Flow Summary" subtitle="Same source as Financials → Cash Flow / CFO Dashboard">
        <PropDevCfoCfCharts
          snapshots={cfSnapshots}
          selectedYear={selectedYear}
          company={company}
          allLoans={loans}
          companyName={fin.companyName}
        />
      </SectionShell>
    </div>
  );
}
