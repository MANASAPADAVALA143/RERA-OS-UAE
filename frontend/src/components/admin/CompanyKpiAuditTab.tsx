import { RefreshCw, Shield } from 'lucide-react';
import type { CompanyKpiAuditResult } from '../../types/kpiAudit';
import { KpiStatusBadge } from './KpiStatusBadge';
import PeriodToggle from '../shared/PeriodToggle';
import type { Period } from '../../utils/periodWindow';

interface Props {
  companyName: string;
  audit: CompanyKpiAuditResult | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  period: Period | null;
  month: number;
  year: number;
  onPeriodChange: (p: Period | null, m: number, y: number) => void;
  availableKeys: string[];
}

export function CompanyKpiAuditTab({
  companyName,
  audit,
  loading,
  error,
  onRefresh,
  period,
  month,
  year,
  onPeriodChange,
  availableKeys,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-indigo-700" />
            <h2 className="text-lg font-semibold text-gray-900">Calculations — {companyName}</h2>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            All KPIs for this company: formula, raw inputs, canonical vs live display, match status
          </p>
          {audit?.period_label && (
            <p className="text-xs text-gray-400 mt-0.5">Period: {audit.period_label}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {availableKeys.length > 0 && (
        <PeriodToggle
          period={period}
          month={month}
          year={year}
          onChange={onPeriodChange}
          availableKeys={availableKeys}
        />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {loading && !audit && (
        <p className="text-sm text-gray-400 py-8 text-center">Loading calculation breakdown…</p>
      )}

      {audit && !audit.has_data && (
        <p className="text-sm text-gray-400 py-8 text-center">
          Insufficient data — upload P&amp;L / balance sheet for this company first.
        </p>
      )}

      {audit?.has_data && (
        <>
          <div className="flex items-center gap-3">
            <KpiStatusBadge status={audit.summary_status} />
            <span className="text-xs text-gray-500">
              {audit.mismatch_count} mismatches · {audit.check_logic_count} logic flags
            </span>
          </div>

          <div className="overflow-x-auto border rounded-xl bg-white">
            <table className="w-full text-base leading-relaxed">
              <thead className="bg-gray-50 text-sm text-gray-600 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">KPI</th>
                  <th className="px-4 py-3 text-left">Formula</th>
                  <th className="px-4 py-3 text-left">Raw Inputs</th>
                  <th className="px-4 py-3 text-right">Calculated</th>
                  <th className="px-4 py-3 text-right">Live Display</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {audit.rows.map(row => (
                  <tr
                    key={row.kpi}
                    className={
                      row.status === 'MISMATCH' ? 'bg-red-50/60'
                        : row.status === 'CHECK_LOGIC' ? 'bg-amber-50/60' : ''
                    }
                  >
                    <td className="px-4 py-3 font-medium whitespace-nowrap">
                      <div className="text-base">{row.kpi}</div>
                      <div className="text-sm text-gray-500 mt-0.5">{row.section}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[220px] text-[15px]">{row.formula}</td>
                    <td className="px-4 py-3 text-gray-600 max-w-[220px] text-[15px]">
                      {Object.entries(row.inputs_detail).map(([k, v]) => (
                        <div key={k}>{k}: {v}</div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-green-800 text-base">
                      {row.canonical_display}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-base">
                      {row.displayed_display}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <KpiStatusBadge status={row.status} />
                      {row.notes && (
                        <p className="text-sm text-amber-800 mt-2 max-w-[180px] mx-auto">{row.notes}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
