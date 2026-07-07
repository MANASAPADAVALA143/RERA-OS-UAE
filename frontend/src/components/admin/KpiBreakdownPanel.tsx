import type { KpiAuditRow } from '../../types/kpiAudit';
import { KpiStatusBadge } from './KpiStatusBadge';

interface Props {
  row: KpiAuditRow;
  compact?: boolean;
}

export function KpiBreakdownPanel({ row, compact }: Props) {
  return (
    <div
      className="rounded-lg border text-sm"
      style={{
        background: '#FFFBF5',
        borderColor: '#E8DEC8',
        padding: compact ? '10px 12px' : '14px 16px',
        marginTop: 8,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="font-semibold text-gray-900">{row.kpi} — calculation breakdown</p>
        <KpiStatusBadge status={row.status} />
      </div>

      <p className="text-xs text-gray-600 mb-2">
        <span className="font-semibold text-gray-700">Formula: </span>
        {row.formula}
      </p>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Raw inputs (this period)</p>
          <ul className="text-xs text-gray-700 space-y-0.5">
            {Object.entries(row.inputs_detail).map(([k, v]) => (
              <li key={k}><span className="text-gray-500">{k}:</span> {v}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Source references</p>
          <ul className="text-xs text-gray-600 space-y-0.5">
            {row.sources.map(s => (
              <li key={s.field}>
                <span className="font-medium text-gray-700">{s.field}</span> → {s.source}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {row.substitution && (
        <pre
          className="text-xs whitespace-pre-wrap rounded-md p-3 mb-3 font-mono"
          style={{ background: '#F7F5F0', border: '1px solid #E8DEC8', color: '#44403C' }}
        >
          {row.substitution}
        </pre>
      )}

      <div className="flex flex-wrap gap-4 text-xs">
        <div>
          <span className="text-gray-500">Canonical value: </span>
          <span className="font-mono font-semibold text-green-800">{row.canonical_display}</span>
        </div>
        <div>
          <span className="text-gray-500">Live card display: </span>
          <span className="font-mono font-semibold">{row.displayed_display}</span>
        </div>
      </div>

      {row.notes && (
        <p className="text-xs text-amber-800 mt-2 bg-amber-50 border border-amber-100 rounded px-2 py-1">
          {row.notes}
        </p>
      )}
    </div>
  );
}
