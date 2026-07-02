import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import { occupancyStats } from '../utils/occupancyStats';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UnitRow extends Record<string, unknown> {
  id: string;
  unit_number: string;
  company_id: string;
  company_name: string | null;
  property_name: string | null;
  status: string;
  monthly_rent: number;
  tenant_name: string | null;
  lease_end: string | null;
  arrears: number;
  days_vacant: number | null;
  rent_history: Record<string, number> | null;
  vacancy_loss: number | null;
}

interface CompanyOption { id: string; company_name: string; }

// ── Constants ─────────────────────────────────────────────────────────────────

// All 2026 months in Mon-YYYY order (matches rent_history keys from Excel sync)
const ALL_MONTHS = [
  'Jan-2026','Feb-2026','Mar-2026','Apr-2026','May-2026','Jun-2026',
  'Jul-2026','Aug-2026','Sep-2026','Oct-2026','Nov-2026','Dec-2026',
];

const STATUS_PILL: Record<string, string> = {
  occupied:         'bg-green-100 text-green-800',
  vacant:           'bg-red-100 text-red-800',
  notice:           'bg-amber-100 text-amber-800',
  reserved:         'bg-blue-100 text-blue-800',
  maintenance_hold: 'bg-gray-100 text-gray-800',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtN = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** All months for which ≥ 1 unit has rent_history data */
function getAvailableMonths(units: UnitRow[]): string[] {
  const set = new Set<string>();
  for (const u of units) {
    for (const m of Object.keys(u.rent_history ?? {})) {
      if (ALL_MONTHS.includes(m)) set.add(m);
    }
  }
  return ALL_MONTHS.filter(m => set.has(m));
}

interface UnitLtm {
  marketRent: number;
  monthData: { month: string; rent: number; status: 'occupied' | 'vacant' }[];
  occMonths: number;
  vacMonths: number;
  totalMonths: number;
  collected: number;
  expected: number;
  lost: number;
  occPct: number;
  avgRent: number;
  trend: 'up' | 'down' | 'stable';
  action: string;
  maxConsecVacant: number;
  lastStatus: 'occupied' | 'vacant';
}

function computeUnitLtm(unit: UnitRow, months: string[]): UnitLtm {
  const hist = unit.rent_history ?? {};
  const monthData = months.map(m => ({
    month: m,
    rent: hist[m] ?? 0,
    status: ((hist[m] ?? 0) > 0 ? 'occupied' : 'vacant') as 'occupied' | 'vacant',
  }));

  const histValues = Object.values(hist).filter((v): v is number => v > 0);
  const marketRent = histValues.length > 0
    ? Math.max(...histValues, unit.monthly_rent ?? 0)
    : (unit.monthly_rent ?? 0);

  const totalMonths = monthData.length;
  const occMonths   = monthData.filter(m => m.rent > 0).length;
  const vacMonths   = totalMonths - occMonths;
  const collected   = monthData.reduce((s, m) => s + m.rent, 0);
  const expected    = marketRent * totalMonths;
  const lost        = Math.max(0, expected - collected);
  const occPct      = totalMonths > 0 ? Math.round((occMonths / totalMonths) * 100) : 0;
  const avgRent     = occMonths > 0 ? Math.round(collected / occMonths) : 0;

  const lastN = (n: number) => monthData.slice(-n).filter(m => m.rent > 0).length;
  const trend: 'up' | 'down' | 'stable' =
    lastN(3) > lastN(6) - lastN(3) ? 'up' : lastN(3) < lastN(6) - lastN(3) ? 'down' : 'stable';

  let consecVacant = 0, maxConsecVacant = 0;
  for (const m of monthData) {
    m.status === 'vacant'
      ? (consecVacant++, maxConsecVacant = Math.max(maxConsecVacant, consecVacant))
      : (consecVacant = 0);
  }

  const lastStatus = monthData.length > 0 ? monthData[monthData.length - 1].status : 'vacant';

  let action = 'Monitor';
  if (lastStatus === 'vacant' && maxConsecVacant >= 2) action = 'Offer discount';
  else if (avgRent > 0 && marketRent > 0 && avgRent < marketRent * 0.9) action = 'Review rent';
  else if (occPct === 100) action = 'Retain tenant';

  return { marketRent, monthData, occMonths, vacMonths, totalMonths, collected, expected, lost, occPct, avgRent, trend, action, maxConsecVacant, lastStatus };
}

// Dark-theme tooltip style shared across charts
const TOOLTIP_STYLE = {
  contentStyle: { background: '#F7F5F0', border: '1px solid #DDD8CC', color: '#1C1917', borderRadius: 8 },
  labelStyle: { color: '#92400E' },
};
const TICK = { fill: '#92400E', fontSize: 11 };
const SEL_STYLE: React.CSSProperties = {
  background: '#F7F5F0', border: '1px solid #DDD8CC', color: '#1C1917',
  borderRadius: '0.5rem', padding: '0.375rem 0.75rem', fontSize: '0.875rem',
};

// ── STATUS HISTORY TAB ────────────────────────────────────────────────────────

function StatusHistoryTab() {
  const [units, setUnits]     = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId]     = useState('');

  useEffect(() => {
    api.get<UnitRow[]>('/api/rentals/units').then(r => {
      // Only units that have real rent_history data
      const withHist = r.data.filter(u => u.rent_history && Object.keys(u.rent_history).length > 0);
      setUnits(withHist);
      if (withHist.length > 0) setSelId(withHist[0].id);
    }).finally(() => setLoading(false));
  }, []);

  const availableMonths = useMemo(() => getAvailableMonths(units), [units]);
  const unit = useMemo(() => units.find(u => u.id === selId), [units, selId]);

  const ltm = useMemo(
    () => unit ? computeUnitLtm(unit, availableMonths) : null,
    [unit, availableMonths],
  );

  if (loading) return <LoadingSkeleton rows={6} />;

  if (units.length === 0) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}>
        <p className="font-medium mb-1" style={{ color: '#D4AF37' }}>No rent history available yet</p>
        <p className="text-sm" style={{ color: '#A8A29E' }}>
          Upload your Rent Receivable Excel file via <strong>Sync Rent Data</strong> to populate month-by-month status history for each unit.
        </p>
      </div>
    );
  }

  const periodLabel = availableMonths.length > 0
    ? `${availableMonths[0]} → ${availableMonths[availableMonths.length - 1]}`
    : '';

  return (
    <div className="space-y-5">
      {/* Unit selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium" style={{ color: '#92400E' }}>Select Unit:</label>
        <select value={selId} onChange={e => setSelId(e.target.value)} style={SEL_STYLE}>
          {units.map(u => (
            <option key={u.id} value={u.id} style={{ background: '#F7F5F0' }}>
              {u.unit_number} — {u.company_name}
            </option>
          ))}
        </select>
        {unit && (
          <span className="text-sm" style={{ color: '#A8A29E' }}>
            {unit.property_name} · Market: {fmtN(ltm?.marketRent ?? 0)}/mo
            {unit.tenant_name ? ` · ${unit.tenant_name}` : ' · VACANT'}
          </span>
        )}
        <span className="ml-auto text-xs" style={{ color: '#A8A29E' }}>
          {availableMonths.length} months available ({periodLabel})
        </span>
      </div>

      {/* Flags */}
      {ltm && (
        <div className="space-y-2">
          {ltm.maxConsecVacant >= 2 && (
            <div className="flex gap-3 p-3 rounded-lg border-l-4" style={{ borderColor: '#EF4444', background: 'rgba(239,68,68,0.1)' }}>
              <AlertTriangle size={16} style={{ color: '#F87171', flexShrink: 0, marginTop: 2 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: '#FCA5A5' }}>
                  {unit?.unit_number} vacant {ltm.maxConsecVacant}+ consecutive months
                </p>
                <p className="text-sm" style={{ color: '#FCA5A5', opacity: 0.8 }}>
                  Revenue lost: {fmtN(ltm.lost)} · Recommended: offer discount to fill faster
                </p>
              </div>
            </div>
          )}
          {ltm.occPct === 100 && availableMonths.length >= 3 && (
            <div className="flex gap-3 p-3 rounded-lg border-l-4" style={{ borderColor: '#22C55E', background: 'rgba(34,197,94,0.1)' }}>
              <span style={{ flexShrink: 0 }}>🟢</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#86EFAC' }}>
                  {unit?.unit_number} — 100% occupancy across all {ltm.totalMonths} available months
                </p>
                <p className="text-sm" style={{ color: '#86EFAC', opacity: 0.8 }}>
                  Best-performing unit · Consider rent increase at renewal
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timeline table */}
      {unit && ltm && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#F7F5F0', border: '1px solid #DDD8CC' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #DDD8CC' }}>
            <p className="font-semibold text-sm" style={{ color: '#1C1917' }}>
              {unit.unit_number} — {unit.company_name} · Status Timeline
            </p>
            <p className="text-xs" style={{ color: '#A8A29E' }}>{periodLabel}</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: '#F0EDE5' }}>
                {['Month', 'Status', 'Rent Collected', 'Revenue Lost'].map(h => (
                  <th key={h} className={`px-4 py-2 text-xs font-medium uppercase ${h !== 'Month' && h !== 'Status' ? 'text-right' : 'text-left'}`} style={{ color: '#A8A29E' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ltm.monthData.map((m, i) => (
                <tr key={i} style={{ borderTop: '1px solid #1E2A4A' }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: '#1C1917' }}>{m.month}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span>{m.status === 'occupied' ? '🟢' : '🔴'}</span>
                      <span className="text-xs font-medium" style={{ color: m.status === 'occupied' ? '#86EFAC' : '#FCA5A5' }}>
                        {m.status === 'occupied' ? 'Occupied' : 'Vacant'}
                      </span>
                      {m.status === 'vacant' && i > 0 && ltm.monthData[i - 1].status !== 'vacant' && (
                        <span className="text-xs italic" style={{ color: '#A8A29E' }}>← tenant left</span>
                      )}
                      {m.status === 'occupied' && m.rent > 0 && m.rent < ltm.marketRent && (
                        <span className="text-xs italic" style={{ color: '#FCD34D' }}>← below market</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {m.rent > 0
                      ? <span style={{ color: '#86EFAC' }}>{fmtN(m.rent)}</span>
                      : <span style={{ color: '#A8A29E' }}>$0</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {m.status === 'vacant'
                      ? <span style={{ color: '#F87171' }}>{fmtN(ltm.marketRent)}</span>
                      : <span style={{ color: '#DDD8CC' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F0EDE5' }}>
                <td className="px-4 py-3 font-semibold text-sm" style={{ color: '#1C1917' }}>Summary</td>
                <td className="px-4 py-3 text-xs" style={{ color: '#92400E' }}>
                  Vacant: {ltm.vacMonths} mo · Occupied: {ltm.occMonths} mo · {ltm.totalMonths} total
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: '#86EFAC' }}>
                  {fmtN(ltm.collected)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: '#F87171' }}>
                  {ltm.lost > 0 ? fmtN(ltm.lost) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs" style={{ color: '#A8A29E' }}>
        <span className="flex items-center gap-1">🟢 Occupied</span>
        <span className="flex items-center gap-1">🔴 Vacant</span>
      </div>
    </div>
  );
}

// ── LTM PERFORMANCE TAB ───────────────────────────────────────────────────────

function LTMPerformanceTab() {
  const [allUnits, setAllUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filterCo, setFilterCo] = useState('');
  const [selId, setSelId]       = useState('all');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');

  useEffect(() => {
    api.get<UnitRow[]>('/api/rentals/units').then(r => {
      setAllUnits(r.data);
    }).finally(() => setLoading(false));
  }, []);

  const availableMonths = useMemo(() => getAvailableMonths(allUnits), [allUnits]);

  const companies = useMemo(
    () => [...new Set(allUnits.map(u => u.company_name).filter((n): n is string => !!n))].sort(),
    [allUnits],
  );

  const filteredUnits = useMemo(
    () => filterCo ? allUnits.filter(u => u.company_name === filterCo) : allUnits,
    [allUnits, filterCo],
  );

  const displayUnit = useMemo(
    () => selId !== 'all' ? allUnits.find(u => u.id === selId) : undefined,
    [allUnits, selId],
  );

  const displayLtm = useMemo(
    () => displayUnit ? computeUnitLtm(displayUnit, availableMonths) : null,
    [displayUnit, availableMonths],
  );

  const chartData = useMemo(() => {
    if (!displayLtm) return [];
    return displayLtm.monthData.map(m => ({
      month: m.month.slice(0, 3),  // "Jan" from "Jan-2026"
      fullMonth: m.month,
      rent: m.rent,
      occupancy: m.rent > 0 ? 100 : 0,
      status: m.status,
      lost: m.status === 'vacant' ? displayLtm.marketRent : 0,
    }));
  }, [displayLtm]);

  // Strategic insights from REAL units
  const insights = useMemo(() => {
    if (availableMonths.length === 0) return [];
    const list: { type: 'red' | 'orange' | 'yellow' | 'green'; text: string; rec: string }[] = [];
    for (const unit of filteredUnits) {
      const ltm = computeUnitLtm(unit, availableMonths);
      if (ltm.totalMonths === 0) continue;
      if (ltm.maxConsecVacant >= 3) {
        list.push({ type: 'red', text: `${unit.unit_number} (${unit.company_name}) — vacant ${ltm.maxConsecVacant} months · Lost: ${fmtN(ltm.lost)}`, rec: 'Offer 1 month free or reduce rent 10% to fill quickly' });
      } else if (ltm.lastStatus === 'vacant' && ltm.maxConsecVacant >= 2) {
        list.push({ type: 'orange', text: `${unit.unit_number} (${unit.company_name}) — currently vacant ${ltm.maxConsecVacant} months`, rec: 'Contact prospects now · Offer early move-in special' });
      } else if (ltm.avgRent > 0 && ltm.marketRent > 0 && ltm.avgRent < ltm.marketRent * 0.9 && ltm.lastStatus === 'occupied') {
        list.push({ type: 'yellow', text: `${unit.unit_number} (${unit.company_name}) — avg rent ${fmtN(ltm.avgRent)}, market ${fmtN(ltm.marketRent)}`, rec: 'Gradual increase $100/year to approach market rate' });
      } else if (ltm.occPct === 100 && ltm.totalMonths >= 3) {
        list.push({ type: 'green', text: `${unit.unit_number} (${unit.company_name}) — 100% occupancy across ${ltm.totalMonths} months`, rec: 'Best performer · Consider rent increase at renewal' });
      }
    }
    return list.slice(0, 12);
  }, [filteredUnits, availableMonths]);

  const insightBorder = { red: '#EF4444', orange: '#F97316', yellow: '#F59E0B', green: '#22C55E' };
  const insightBg = { red: 'rgba(239,68,68,0.1)', orange: 'rgba(249,115,22,0.1)', yellow: 'rgba(245,158,11,0.1)', green: 'rgba(34,197,94,0.1)' };
  const insightColor = { red: '#FCA5A5', orange: '#FDBA74', yellow: '#FDE68A', green: '#86EFAC' };
  const insightIcon = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢' };

  if (loading) return <LoadingSkeleton rows={8} />;

  const periodLabel = availableMonths.length > 0
    ? `${availableMonths.length} months (${availableMonths[0]} – ${availableMonths[availableMonths.length - 1]})`
    : 'No rent history available';

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterCo} onChange={e => { setFilterCo(e.target.value); setSelId('all'); }} style={SEL_STYLE}>
          <option value="" style={{ background: '#F7F5F0' }}>All Companies</option>
          {companies.map(c => <option key={c} value={c} style={{ background: '#F7F5F0' }}>{c}</option>)}
        </select>
        <select value={selId} onChange={e => setSelId(e.target.value)} style={SEL_STYLE}>
          <option value="all" style={{ background: '#F7F5F0' }}>All Units</option>
          {filteredUnits.map(u => (
            <option key={u.id} value={u.id} style={{ background: '#F7F5F0' }}>
              {u.unit_number} — {u.property_name || u.company_name}
            </option>
          ))}
        </select>
        <span className="text-xs ml-2" style={{ color: '#A8A29E' }}>{periodLabel}</span>
        <div className="flex gap-1 ml-auto p-1 rounded-lg" style={{ background: '#F0EDE5' }}>
          {(['chart', 'table'] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className="px-3 py-1 rounded text-xs font-medium capitalize transition-colors"
              style={viewMode === v
                ? { background: '#F7F5F0', color: '#1C1917' }
                : { color: '#A8A29E' }
              }>{v}</button>
          ))}
        </div>
      </div>

      {/* No history notice */}
      {availableMonths.length === 0 && (
        <div className="rounded-xl p-5 text-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <p className="font-medium mb-1" style={{ color: '#D4AF37' }}>No rent history data yet</p>
          <p className="text-sm" style={{ color: '#A8A29E' }}>
            Use <strong>Sync Rent Data</strong> to upload the Rent Receivable Excel — that populates month-by-month history for LTM analysis.
          </p>
        </div>
      )}

      {/* Dual-axis chart — single unit */}
      {viewMode === 'chart' && displayUnit && displayLtm && chartData.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#F7F5F0', border: '1px solid #DDD8CC' }}>
          <p className="text-sm font-semibold mb-0.5" style={{ color: '#1C1917' }}>
            {displayUnit.unit_number} ({displayUnit.company_name}) — Rent &amp; Occupancy
          </p>
          <p className="text-xs mb-4" style={{ color: '#A8A29E' }}>
            {periodLabel} · Market rent: {fmtN(displayLtm.marketRent)}/mo
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ left: 0, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F7F5F0" />
              <XAxis dataKey="month" tick={TICK} />
              <YAxis yAxisId="left" tickFormatter={v => `$${(v / 1000).toFixed(1)}K`} tick={TICK} domain={[0, displayLtm.marketRent * 1.2]} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} tick={TICK} domain={[0, 130]} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  return (
                    <div style={{ background: '#F7F5F0', border: '1px solid #DDD8CC', borderRadius: 8, padding: '0.75rem', fontSize: '0.75rem', color: '#1C1917' }}>
                      <p style={{ fontWeight: 600, marginBottom: 4, color: '#92400E' }}>{d.fullMonth || label}</p>
                      <p>Status: <span style={{ fontWeight: 600 }}>{d.status === 'occupied' ? 'Occupied' : 'Vacant'}</span></p>
                      <p>Rent: <span style={{ fontFamily: 'monospace' }}>{fmtN(d.rent)}</span></p>
                      {d.lost > 0 && <p style={{ color: '#F87171' }}>Lost: <span style={{ fontFamily: 'monospace' }}>{fmtN(d.lost)}</span></p>}
                    </div>
                  );
                }}
              />
              <Bar yAxisId="left" dataKey="rent" name="Rent Collected" radius={[2, 2, 0, 0]}>
                {chartData.map((d, i) => <Cell key={i} fill={d.rent > 0 ? '#22C55E' : '#EF4444'} />)}
              </Bar>
              <Line yAxisId="right" type="stepAfter" dataKey="occupancy" stroke="#F59E0B" strokeWidth={2} dot={false} name="Occupancy %" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-xs" style={{ color: '#A8A29E' }}>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#22C55E' }} /> Rent Collected</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#EF4444' }} /> Vacant Month</span>
            <span className="flex items-center gap-1"><span className="inline-block w-6 h-0.5" style={{ background: '#F59E0B' }} /> Occupancy %</span>
          </div>
        </div>
      )}

      {viewMode === 'chart' && !displayUnit && availableMonths.length > 0 && (
        <div className="rounded-lg p-4 text-sm" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: '#D4AF37' }}>
          Select a specific unit above to view its dual-axis chart.
        </div>
      )}

      {/* LTM Summary table — always visible */}
      {availableMonths.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#F7F5F0', border: '1px solid #DDD8CC' }}>
          <div className="px-4 py-3" style={{ borderBottom: '1px solid #DDD8CC' }}>
            <p className="font-semibold text-sm" style={{ color: '#1C1917' }}>
              LTM Summary — {filterCo || 'All Companies'} · {filteredUnits.length} units
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#F0EDE5' }}>
                  {['Unit', 'Building', 'Company', 'Occ Mo', 'Vac Mo', 'Collected', 'Expected', 'Lost', 'Occ %', 'Avg Rent', 'Trend', 'Action'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left whitespace-nowrap font-medium" style={{ color: '#A8A29E' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUnits.map(u => {
                  const ltm = computeUnitLtm(u, availableMonths);
                  const noHistory = ltm.totalMonths === 0;
                  const actionColor = {
                    'Offer discount': { bg: '#FCEAEA', color: '#C0392B' },
                    'Review rent':    { bg: 'rgba(245,158,11,0.15)', color: '#92400E' },
                    'Retain tenant':  { bg: 'rgba(34,197,94,0.15)',  color: '#065F46' },
                    'Monitor':        { bg: 'rgba(100,116,139,0.15)', color: '#44403C' },
                  }[ltm.action] ?? { bg: 'rgba(100,116,139,0.15)', color: '#44403C' };

                  return (
                    <tr key={u.id} style={{ borderTop: '1px solid #1E2A4A' }}>
                      <td className="px-3 py-2 font-mono font-medium" style={{ color: '#1C1917' }}>{u.unit_number}</td>
                      <td className="px-3 py-2 max-w-[120px] truncate" style={{ color: '#92400E' }}>{u.property_name || '—'}</td>
                      <td className="px-3 py-2 max-w-[120px] truncate" style={{ color: '#92400E' }}>{u.company_name || '—'}</td>
                      {noHistory ? (
                        <td colSpan={9} className="px-3 py-2 text-xs italic" style={{ color: '#DDD8CC' }}>
                          No history — upload rent receivable to see LTM data
                        </td>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-center font-medium" style={{ color: '#86EFAC' }}>{ltm.occMonths}</td>
                          <td className="px-3 py-2 text-center font-medium" style={{ color: ltm.vacMonths > 0 ? '#F87171' : '#A8A29E' }}>{ltm.vacMonths}</td>
                          <td className="px-3 py-2 font-mono text-right" style={{ color: '#1C1917' }}>{fmtN(ltm.collected)}</td>
                          <td className="px-3 py-2 font-mono text-right" style={{ color: '#A8A29E' }}>{fmtN(ltm.expected)}</td>
                          <td className="px-3 py-2 font-mono text-right" style={{ color: ltm.lost > 0 ? '#F87171' : '#A8A29E' }}>{ltm.lost > 0 ? fmtN(ltm.lost) : '—'}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={
                              ltm.occPct === 100
                                ? { background: 'rgba(34,197,94,0.15)', color: '#86EFAC' }
                                : ltm.occPct >= 75
                                  ? { background: 'rgba(245,158,11,0.15)', color: '#FDE68A' }
                                  : { background: 'rgba(239,68,68,0.15)', color: '#FCA5A5' }
                            }>{ltm.occPct}%</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-right" style={{ color: '#1C1917' }}>{ltm.avgRent > 0 ? fmtN(ltm.avgRent) : '—'}</td>
                          <td className="px-3 py-2 text-center text-base font-bold">
                            {ltm.trend === 'up'
                              ? <span style={{ color: '#86EFAC' }}>↑</span>
                              : ltm.trend === 'down'
                                ? <span style={{ color: '#F87171' }}>↓</span>
                                : <span style={{ color: '#A8A29E' }}>→</span>}
                          </td>
                          <td className="px-3 py-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ background: actionColor.bg, color: actionColor.color }}>
                              {ltm.action}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Strategic Insights */}
      {insights.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#F7F5F0', border: '1px solid #DDD8CC' }}>
          <p className="text-sm font-semibold mb-3" style={{ color: '#1C1917' }}>Strategic Insights</p>
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <div
                key={i}
                className="rounded-r-lg p-3 border-l-4"
                style={{ borderColor: insightBorder[ins.type], background: insightBg[ins.type] }}
              >
                <p className="text-sm font-medium" style={{ color: insightColor[ins.type] }}>
                  <span className="mr-2">{insightIcon[ins.type]}</span>{ins.text}
                </p>
                <p className="text-sm mt-0.5 ml-6" style={{ color: insightColor[ins.type], opacity: 0.8 }}>
                  💡 {ins.rec}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {insights.length === 0 && availableMonths.length > 0 && (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#86EFAC' }}>
          🟢 No urgent issues found — all units are performing within normal range.
        </div>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function RentalUnits() {
  const [activeTab, setActiveTab] = useState<'list' | 'history' | 'ltm'>('list');

  // Units list state
  const [units,         setUnits]         = useState<UnitRow[]>([]);
  const [companies,     setCompanies]     = useState<CompanyOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterStatus,  setFilterStatus]  = useState('');
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  const fetchUnits = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: Record<string, string> = {};
      if (filterCompany) params.company_id = filterCompany;
      if (filterStatus)  params.status     = filterStatus;
      const res = await api.get<UnitRow[]>('/api/rentals/units', { params });
      setUnits(res.data);
    } catch { setError('Failed to load units.'); }
    finally  { setLoading(false); }
  }, [filterCompany, filterStatus]);

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await api.get<CompanyOption[]>('/api/rentals/companies');
      setCompanies(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { if (activeTab === 'list') fetchUnits(); }, [fetchUnits, activeTab]);

  const { occupied: occupiedCount, vacant: vacCnt } = useMemo(() => occupancyStats(units), [units]);
  const totalArrears = useMemo(() => units.reduce((s, u) => s + (u.arrears ?? 0), 0), [units]);

  const columns: Column<UnitRow>[] = [
    { key: 'unit_number',   label: 'Unit No.',  sortValue: r => r.unit_number },
    { key: 'company_name',  label: 'Company',   sortValue: r => r.company_name ?? '' },
    { key: 'property_name', label: 'Property',  sortValue: r => r.property_name ?? '' },
    {
      key: 'status', label: 'Status',
      render: r => <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[r.status] ?? 'bg-gray-100 text-gray-800'}`}>{r.status}</span>,
      sortValue: r => r.status,
    },
    {
      key: 'tenant_name', label: 'Tenant',
      render: r => r.status === 'vacant' && r.days_vacant != null
        ? <span className="text-gray-400 text-xs">— ({r.days_vacant}d vacant)</span>
        : (r.tenant_name ?? '—'),
      sortValue: r => r.tenant_name ?? '',
    },
    { key: 'lease_end',    label: 'Lease End',    sortValue: r => r.lease_end ?? '' },
    { key: 'monthly_rent', label: 'Monthly Rent', render: r => fmtUSD(r.monthly_rent), sortValue: r => r.monthly_rent },
    {
      key: 'arrears', label: 'Arrears',
      render: r => r.arrears > 0 ? <span className="text-red-600 font-medium">{fmtUSD(r.arrears)}</span> : '—',
      sortValue: r => r.arrears,
    },
  ];

  const TABS = [
    { id: 'list'    as const, label: 'Units List'      },
    { id: 'history' as const, label: 'Status History'  },
    { id: 'ltm'     as const, label: 'LTM Performance' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Units</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: '#F0EDE5' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={activeTab === t.id
              ? { background: '#F7F5F0', color: '#1C1917' }
              : { color: '#A8A29E' }
            }
          >{t.label}</button>
        ))}
      </div>

      {/* Units List */}
      {activeTab === 'list' && (
        <>
          <div className="flex flex-wrap gap-3">
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)} style={SEL_STYLE}>
              <option value="" style={{ background: '#F7F5F0' }}>All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id} style={{ background: '#F7F5F0' }}>{c.company_name}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={SEL_STYLE}>
              <option value="" style={{ background: '#F7F5F0' }}>All Statuses</option>
              <option value="occupied"         style={{ background: '#F7F5F0' }}>Occupied</option>
              <option value="vacant"           style={{ background: '#F7F5F0' }}>Vacant</option>
              <option value="notice"           style={{ background: '#F7F5F0' }}>Notice</option>
              <option value="reserved"         style={{ background: '#F7F5F0' }}>Reserved</option>
              <option value="maintenance_hold" style={{ background: '#F7F5F0' }}>Maintenance Hold</option>
            </select>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Showing Units" value={String(units.length)} />
            <KpiCard label="Occupied"      value={String(occupiedCount)} />
            <KpiCard label="Vacant"        value={String(vacCnt)} />
            <KpiCard label="Total Arrears" value={fmtUSD(totalArrears)} />
          </div>
          {loading ? <LoadingSkeleton rows={8} /> : error ? (
            <p className="text-red-600">{error}</p>
          ) : (
            <Card title="Units">
              <Table columns={columns} data={units} emptyMessage="No units found" defaultSortKey="unit_number" />
            </Card>
          )}
        </>
      )}

      {activeTab === 'history' && <StatusHistoryTab />}
      {activeTab === 'ltm'     && <LTMPerformanceTab />}
    </div>
  );
}
