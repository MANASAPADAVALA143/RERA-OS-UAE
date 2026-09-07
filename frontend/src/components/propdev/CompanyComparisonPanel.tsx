import { usePropDev } from '../../contexts/PropertyDevContext';
import type { CompanyData } from '../../contexts/PropertyDevContext';

const BADGES = ['🥇', '🥈', '🥉'];

interface Column {
  label: string;
  getValue: (c: CompanyData) => number;
  format?: (v: number) => string;
  higherIsBetter?: boolean;
}

interface Props {
  columns: Column[];
  title?: string;
  onCompanyClick?: (id: string) => void;
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
const pctFmt = (n: number) => `${n.toFixed(1)}%`;

export default function CompanyComparisonPanel({ columns, title = 'Company Comparison', onCompanyClick }: Props) {
  const { companies, setSelectedCompanyId, isConsolidated } = usePropDev();
  if (!isConsolidated) return null;

  // Rank by first column
  const ranked = [...companies].sort((a, b) => {
    const aVal = columns[0].getValue(a);
    const bVal = columns[0].getValue(b);
    return columns[0].higherIsBetter !== false ? bVal - aVal : aVal - bVal;
  });

  // Portfolio totals / averages
  const portfolio: Record<string, number> = {};
  columns.forEach(col => {
    portfolio[col.label] = companies.reduce((s, c) => s + col.getValue(c), 0);
  });

  // Compute avg for heat coloring
  const averages: Record<string, number> = {};
  columns.forEach(col => {
    averages[col.label] = portfolio[col.label] / companies.length;
  });

  function heatClass(col: Column, value: number) {
    const avg = averages[col.label];
    if (!avg) return '';
    const ratio = value / avg;
    if (col.higherIsBetter === false) {
      // lower is better (costs, overdue, etc.)
      if (ratio < 0.85) return 'bg-green-50 text-green-700';
      if (ratio > 1.15) return 'bg-red-50 text-red-700';
    } else {
      if (ratio >= 1.15) return 'bg-green-50 text-green-700';
      if (ratio < 0.85) return 'bg-red-50 text-red-700';
    }
    return '';
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6">
      <div className="px-5 py-3 bg-gray-900 text-white flex items-center justify-between">
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="text-xs text-gray-400">All {companies.length} companies · click row to drill in</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Rank</th>
              <th className="px-4 py-3 text-left">Company</th>
              <th className="px-4 py-3 text-right">Status</th>
              {columns.map(col => (
                <th key={col.label} className="px-4 py-3 text-right whitespace-nowrap">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ranked.map((c, idx) => (
              <tr
                key={c.id}
                className="hover:bg-blue-50 cursor-pointer transition-colors"
                onClick={() => {
                  setSelectedCompanyId(c.id);
                  onCompanyClick?.(c.id);
                }}
              >
                <td className="px-4 py-3 text-center">
                  {idx < 3
                    ? <span className="text-base">{BADGES[idx]}</span>
                    : <span className="text-gray-400 text-xs">#{idx + 1}</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900 text-xs">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.property.address}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-xs">
                  {(() => {
                    const lot = c.lots[0];
                    if (!lot) return <span className="text-gray-400">—</span>;
                    const labels: Record<string, string> = { sold: 'Sold', contracted: 'Contracted', available: 'For Sale', reserved: 'Reserved', legal_pending: 'Legal', cancelled: 'Cancelled' };
                    return <span className="font-medium capitalize">{labels[lot.status] ?? lot.status.replace('_', ' ')}</span>;
                  })()}
                </td>
                {columns.map(col => {
                  const value = col.getValue(c);
                  const heat = heatClass(col, value);
                  const display = col.format ? col.format(value) : fmt(value);
                  return (
                    <td key={col.label} className={`px-4 py-3 text-right text-xs font-semibold ${heat}`}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-800 text-white">
              <td className="px-4 py-3 font-bold text-xs" colSpan={3}>PORTFOLIO TOTAL</td>
              {columns.map(col => (
                <td key={col.label} className="px-4 py-3 text-right text-xs font-bold">
                  {col.format ? col.format(portfolio[col.label]) : fmt(portfolio[col.label])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export { fmt, pctFmt };
