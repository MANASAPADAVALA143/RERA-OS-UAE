import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, Legend,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { Card, KpiCard } from '../components/ui/Card';
import { Table, LoadingSkeleton, type Column } from '../components/ui/Table';
import { fmtUSD } from '../components/ProtectedRoute';
import { occupancyStats } from '../utils/occupancyStats';
import { EXP_PALETTE } from '../utils/rentalExpenseUtils';

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

// Cap to months up to and including the current calendar month so future
// months with no data don't show as "Vacant" (they simply don't exist yet).
const _now = new Date();
const _curMonthAbbrev = _now.toLocaleString('default', { month: 'short' }) + '-' + _now.getFullYear();
const PAST_AND_CURRENT_MONTHS = ALL_MONTHS.filter(m => {
  const [mon, yr] = m.split('-');
  const mDate = new Date(`${mon} 1, ${yr}`);
  return mDate <= new Date(_curMonthAbbrev.replace('-', ' 1, '));
});

const MNAME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DROPDOWN = MNAME.map((_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleString('default', { month: 'long' }),
}));

function monthKey(year: number, month: number): string {
  return `${MNAME[month - 1]}-${year}`;
}

/** Last N months ending at year/month (inclusive), oldest first. */
function monthsEndingAt(year: number, month: number, span = 12): string[] {
  const out: string[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < span; i++) {
    out.push(monthKey(y, m));
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return out.reverse();
}

function yearsFromMonthKeys(months: string[]): number[] {
  const yrs = new Set(months.map(k => parseInt(k.split('-')[1], 10)));
  yrs.add(new Date().getFullYear());
  return [...yrs].sort((a, b) => a - b);
}

const STATUS_PILL: Record<string, string> = {
  occupied:         'bg-green-100 text-green-800',
  vacant:           'bg-red-100 text-red-800',
  notice:           'bg-amber-100 text-amber-800',
  reserved:         'bg-blue-100 text-blue-800',
  maintenance_hold: 'bg-gray-100 text-gray-800',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtN = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** All months for which ≥ 1 unit has rent_history data — capped at current month */
function getAvailableMonths(units: UnitRow[]): string[] {
  const set = new Set<string>();
  for (const u of units) {
    for (const m of Object.keys(u.rent_history ?? {})) {
      if (PAST_AND_CURRENT_MONTHS.includes(m)) set.add(m);
    }
  }
  return PAST_AND_CURRENT_MONTHS.filter(m => set.has(m));
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
  trailingVacantDays: number;
}

function daysInMonthKey(key: string): number {
  const [mon, yr] = key.split('-');
  const mi = MNAME.indexOf(mon);
  if (mi < 0) return 30;
  return new Date(parseInt(yr, 10), mi + 1, 0).getDate();
}

/** Estimate how long a unit has been vacant using rent receivable month columns. */
function estimateVacantDays(
  ltm: Pick<UnitLtm, 'monthData' | 'lastStatus' | 'totalMonths'>,
  unitDaysVacant: number | null,
): number | null {
  if (ltm.lastStatus !== 'vacant' || ltm.totalMonths === 0) return null;
  if (unitDaysVacant != null && unitDaysVacant >= 0) return unitDaysVacant;
  let days = 0;
  for (let i = ltm.monthData.length - 1; i >= 0; i--) {
    if (ltm.monthData[i].status !== 'vacant') break;
    days += daysInMonthKey(ltm.monthData[i].month);
  }
  return days > 0 ? days : null;
}

function bucketVacancyDays(days: number): string {
  if (days <= 30) return '0–30 days';
  if (days <= 60) return '31–60 days';
  if (days <= 90) return '61–90 days';
  return '90+ days';
}

function computeUnitLtm(unit: UnitRow, months: string[]): UnitLtm {
  const hist = unit.rent_history ?? {};
  // Only include months that have an actual rent entry — never infer "vacant"
  // for a future or missing month purely because it has no data.
  const monthData = months.filter(m => m in hist).map(m => ({
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

  let trailingVacantDays = 0;
  for (let i = monthData.length - 1; i >= 0; i--) {
    if (monthData[i].status !== 'vacant') break;
    trailingVacantDays += daysInMonthKey(monthData[i].month);
  }

  let action = 'Monitor';
  if (lastStatus === 'vacant' && maxConsecVacant >= 2) action = 'Offer discount';
  else if (avgRent > 0 && marketRent > 0 && avgRent < marketRent * 0.9) action = 'Review rent';
  else if (occPct === 100) action = 'Retain tenant';

  return { marketRent, monthData, occMonths, vacMonths, totalMonths, collected, expected, lost, occPct, avgRent, trend, action, maxConsecVacant, lastStatus, trailingVacantDays };
}

// Dark-theme tooltip style shared across charts
const TOOLTIP_STYLE = {
  contentStyle: { background: '#F8FAFC', border: '1px solid #CBD5E1', color: '#1C1917', borderRadius: 8 },
  labelStyle: { color: '#92400E' },
};
const TICK = { fill: '#92400E', fontSize: 11 };
const SEL_STYLE: React.CSSProperties = {
  background: '#F8FAFC', border: '1px solid #CBD5E1', color: '#1C1917',
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
        <p className="font-medium mb-1" style={{ color: '#6366F1' }}>No rent history available yet</p>
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
            <option key={u.id} value={u.id} style={{ background: '#F8FAFC' }}>
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
            <div className="flex gap-3 p-3 rounded-lg border-l-4" style={{ borderColor: '#C0392B', background: '#FCEAEA' }}>
              <AlertTriangle size={16} style={{ color: '#C0392B', flexShrink: 0, marginTop: 2 }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: '#8B3A3A' }}>
                  {unit?.unit_number} vacant {ltm.maxConsecVacant}+ consecutive months
                </p>
                <p className="text-sm" style={{ color: '#8B3A3A', opacity: 0.85 }}>
                  Revenue lost: {fmtN(ltm.lost)} · Recommended: offer discount to fill faster
                </p>
              </div>
            </div>
          )}
          {ltm.occPct === 100 && availableMonths.length >= 3 && (
            <div className="flex gap-3 p-3 rounded-lg border-l-4" style={{ borderColor: '#15803D', background: 'rgba(21,128,61,0.08)' }}>
              <span style={{ flexShrink: 0 }}>🟢</span>
              <div>
                <p className="text-sm font-semibold" style={{ color: '#065F46' }}>
                  {unit?.unit_number} — 100% occupancy across all {ltm.totalMonths} available months
                </p>
                <p className="text-sm" style={{ color: '#065F46', opacity: 0.85 }}>
                  Best-performing unit · Consider rent increase at renewal
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Timeline table */}
      {unit && ltm && (
        <div className="rounded-xl overflow-hidden" style={{ background: '#F8FAFC', border: '1px solid #CBD5E1' }}>
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #CBD5E1' }}>
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
                      <span className="text-xs font-medium" style={{ color: m.status === 'occupied' ? '#065F46' : '#8B3A3A' }}>
                        {m.status === 'occupied' ? 'Occupied' : 'Vacant'}
                      </span>
                      {m.status === 'vacant' && i > 0 && ltm.monthData[i - 1].status !== 'vacant' && (
                        <span className="text-xs italic" style={{ color: '#A8A29E' }}>← tenant left</span>
                      )}
                      {m.status === 'occupied' && m.rent > 0 && m.rent < ltm.marketRent && (
                        <span className="text-xs italic" style={{ color: '#92400E' }}>← below market</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {m.rent > 0
                      ? <span style={{ color: '#065F46' }}>{fmtN(m.rent)}</span>
                      : <span style={{ color: '#A8A29E' }}>$0</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    {m.status === 'vacant'
                      ? <span style={{ color: '#B91C1C' }}>{fmtN(ltm.marketRent)}</span>
                      : <span style={{ color: '#A8A29E' }}>—</span>}
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
                <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: '#065F46' }}>
                  {fmtN(ltm.collected)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: '#B91C1C' }}>
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

// ── LTM PERFORMANCE TAB (REDESIGNED) ─────────────────────────────────────────

const LTM_C = {
  teal:  '#0F766E',
  green: '#15803D',
  amber: '#7C3AED',
  warn:  '#92400E',
  gold:  '#6366F1',
};
const LTM_CARD: React.CSSProperties = {
  background: '#F1F5F9',
  border: '1px solid #E2E8F0',
  borderRadius: 12,
  padding: '16px 18px',
};
const LTM_TICK = { fill: '#78716C', fontSize: 12 };
const LTM_TT = {
  contentStyle: { background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#1C1917', borderRadius: 8, fontSize: 13 },
  labelStyle:   { color: '#78716C', fontWeight: 600 },
};

function priorityScore(ltm: ReturnType<typeof computeUnitLtm>): number {
  let s = 0;
  if (ltm.occPct < 50)  s += 40;
  else if (ltm.occPct < 75)  s += 20;
  else if (ltm.occPct < 90)  s += 10;
  if (ltm.lost > 10000) s += 30;
  else if (ltm.lost > 5000)  s += 15;
  else if (ltm.lost > 2000)  s += 8;
  if (ltm.lastStatus === 'vacant')     s += 20;
  if (ltm.maxConsecVacant >= 3)        s += 10;
  return s;
}

function LtmKpi({ label, value, sub, accent, warn, na }: {
  label: string; value: string; sub?: string; accent?: string; warn?: boolean; na?: boolean;
}) {
  return (
    <div style={LTM_CARD}>
      <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#78716C', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums lining-nums', color: na ? '#A8A29E' : warn ? LTM_C.warn : (accent ?? '#1C1917') }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: na ? '#A8A29E' : '#A8A29E', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LtmChart({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={LTM_CARD}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', margin: 0 }}>{title}</h3>
        {sub && <p style={{ fontSize: 12, color: '#A8A29E', margin: '4px 0 0' }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

function LTMPerformanceTab() {
  const [allUnits, setAllUnits]         = useState<UnitRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filterCo, setFilterCo]         = useState('');
  const [filterBuilding, setFilterBuilding] = useState('');
  const [endYear, setEndYear]           = useState(() => new Date().getFullYear());
  const [endMonth, setEndMonth]         = useState(() => new Date().getMonth() + 1);
  const periodInit = useRef(false);

  useEffect(() => {
    api.get<UnitRow[]>('/api/rentals/units')
      .then(r => setAllUnits(r.data))
      .finally(() => setLoading(false));
  }, []);

  const dataMonths = useMemo(() => getAvailableMonths(allUnits), [allUnits]);

  useEffect(() => {
    if (periodInit.current || dataMonths.length === 0) return;
    const last = dataMonths[dataMonths.length - 1];
    const [mon, yr] = last.split('-');
    const mi = MNAME.indexOf(mon) + 1;
    if (mi > 0) {
      setEndYear(parseInt(yr, 10));
      setEndMonth(mi);
      periodInit.current = true;
    }
  }, [dataMonths]);

  const curYear = new Date().getFullYear();
  const curMonth = new Date().getMonth() + 1;
  const yearOptions = useMemo(() => yearsFromMonthKeys(dataMonths), [dataMonths]);
  const maxSelectableMonth = endYear === curYear ? curMonth : 12;

  useEffect(() => {
    if (endMonth > maxSelectableMonth) setEndMonth(maxSelectableMonth);
  }, [endYear, endMonth, maxSelectableMonth]);

  const selectedLtmMonths = useMemo(
    () => monthsEndingAt(endYear, endMonth, 12).filter(m => PAST_AND_CURRENT_MONTHS.includes(m)),
    [endYear, endMonth],
  );

  const companies = useMemo(
    () => [...new Set(allUnits.map(u => u.company_name).filter((n): n is string => !!n))].sort(),
    [allUnits],
  );

  const buildings = useMemo(() => {
    const src = filterCo ? allUnits.filter(u => u.company_name === filterCo) : allUnits;
    return [...new Set(src.map(u => u.property_name).filter((n): n is string => !!n))].sort();
  }, [allUnits, filterCo]);

  const filteredUnits = useMemo(
    () => allUnits.filter(u =>
      (!filterCo || u.company_name === filterCo) &&
      (!filterBuilding || u.property_name === filterBuilding)
    ),
    [allUnits, filterCo, filterBuilding],
  );

  const allLtm = useMemo(
    () => filteredUnits.map(u => ({ unit: u, ltm: computeUnitLtm(u, selectedLtmMonths) })),
    [filteredUnits, selectedLtmMonths],
  );

  // ── Portfolio KPIs ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalUnits = allLtm.length;
    const occupied   = allLtm.filter(({ ltm }) => ltm.occMonths > 0).length;
    const collected  = allLtm.reduce((s, { ltm }) => s + ltm.collected, 0);
    const expected   = allLtm.reduce((s, { ltm }) => s + ltm.expected, 0);
    const lost       = Math.max(0, expected - collected);
    const occRate    = totalUnits > 0 ? occupied / totalUnits : 0;
    const collRate   = expected > 0 ? (collected / expected) * 100 : null;
    const avgOccRent = occupied > 0 ? collected / occupied : null;
    return { totalUnits, occupied, collected, expected, lost, occRate, collRate, avgOccRent };
  }, [allLtm]);

  // ── Cross-section chart: all units ranked by Lost Rent ───────────────────────
  const crossSection = useMemo(() =>
    allLtm
      .filter(({ ltm }) => ltm.totalMonths > 0)
      .sort((a, b) => b.ltm.lost - a.ltm.lost)
      .map(({ unit, ltm }) => ({
        name: unit.unit_number.length > 10 ? unit.unit_number.slice(0, 10) + '…' : unit.unit_number,
        lost: ltm.lost,
        occPct: ltm.occPct,
      })),
    [allLtm],
  );

  // ── Monthly trend (portfolio aggregate) ──────────────────────────────────────
  const monthlyTrend = useMemo(() =>
    selectedLtmMonths.map(month => {
      let collected = 0, expected = 0;
      for (const { unit, ltm } of allLtm) {
        collected += (unit.rent_history ?? {})[month] ?? 0;
        expected  += ltm.marketRent;
      }
      return { month: month.slice(0, 3), collected, expected, lost: Math.max(0, expected - collected) };
    }),
    [allLtm, selectedLtmMonths],
  );

  // ── Building comparison ───────────────────────────────────────────────────────
  const buildingChart = useMemo(() => {
    const map: Record<string, { collected: number; expected: number }> = {};
    for (const { unit, ltm } of allLtm) {
      const key = (unit.property_name || unit.company_name || 'Unknown').slice(0, 20);
      if (!map[key]) map[key] = { collected: 0, expected: 0 };
      map[key].collected += ltm.collected;
      map[key].expected  += ltm.expected;
    }
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.expected - a.expected);
  }, [allLtm]);

  // ── Vacancy duration buckets (from rent receivable $0 months) ────────────────
  const vacancyDurationBuckets = useMemo(() => {
    const defs = [
      { range: '0–30 days', fill: LTM_C.green },
      { range: '31–60 days', fill: LTM_C.amber },
      { range: '61–90 days', fill: '#C2410C' },
      { range: '90+ days', fill: LTM_C.warn },
    ];
    const counts = Object.fromEntries(defs.map(d => [d.range, 0])) as Record<string, number>;
    for (const { unit, ltm } of allLtm) {
      const days = estimateVacantDays(ltm, unit.days_vacant);
      if (days == null) continue;
      counts[bucketVacancyDays(days)] += 1;
    }
    return defs.map(d => ({ ...d, count: counts[d.range] }));
  }, [allLtm]);

  const vacantUnitCount = vacancyDurationBuckets.reduce((s, b) => s + b.count, 0);

  // ── Action distribution ───────────────────────────────────────────────────────
  const actionDist = useMemo(() => {
    const map: Record<string, number> = {};
    for (const { ltm } of allLtm) {
      if (ltm.totalMonths > 0) map[ltm.action] = (map[ltm.action] ?? 0) + 1;
    }
    const ACTION_FILL: Record<string, string> = {
      'Offer discount': LTM_C.amber,
      'Review rent':    LTM_C.amber,
      'Retain tenant':  LTM_C.green,
      'Monitor':        '#A8A29E',
    };
    return Object.entries(map)
      .map(([action, count]) => ({ action, count, fill: ACTION_FILL[action] ?? LTM_C.gold }))
      .sort((a, b) => b.count - a.count);
  }, [allLtm]);

  // ── Top risk units ─────────────────────────────────────────────────────────────
  const topRisk = useMemo(() =>
    allLtm
      .filter(({ ltm }) => ltm.totalMonths > 0)
      .map(({ unit, ltm }) => ({ unit, ltm, score: priorityScore(ltm) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12),
    [allLtm],
  );

  // ── Strategic insights ─────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    type InsightType = 'red' | 'amber' | 'green';
    const list: { type: InsightType; icon: string; title: string; detail: string }[] = [];
    for (const { unit, ltm } of allLtm) {
      if (ltm.totalMonths === 0) continue;
      const lbl = unit.unit_number;
      if (ltm.occPct < 50 && ltm.lost > 3000) {
        list.push({ type: 'red',   icon: '🔴', title: `Urgent discount review — ${lbl}`, detail: `${ltm.occPct}% occupancy · ${fmtN(ltm.lost)} lost` });
      } else if (ltm.avgRent > 0 && ltm.marketRent > 0 && ltm.avgRent > ltm.marketRent * 0.95 && ltm.occPct < 70) {
        list.push({ type: 'amber', icon: '🟡', title: `Pricing review — ${lbl}`, detail: `High avg rent but ${ltm.occPct}% occupancy` });
      } else if (ltm.expected > 8000 && ltm.collected / ltm.expected < 0.70) {
        list.push({ type: 'amber', icon: '🟠', title: `Collections: ${lbl}`, detail: `${Math.round((ltm.collected / ltm.expected) * 100)}% collection rate` });
      } else if (ltm.occPct === 100 && ltm.totalMonths >= 3) {
        list.push({ type: 'green', icon: '🟢', title: `Top performer — ${lbl}`, detail: `100% occupancy · ${fmtN(ltm.avgRent)}/mo avg` });
      }
    }
    return list.slice(0, 8);
  }, [allLtm]);

  if (loading) return <LoadingSkeleton rows={8} />;

  const periodLabel = selectedLtmMonths.length > 0
    ? `${selectedLtmMonths[0]} – ${selectedLtmMonths[selectedLtmMonths.length - 1]} (${selectedLtmMonths.length} mo)`
    : 'No months in range';

  const hasData = dataMonths.length > 0 && allLtm.some(({ ltm }) => ltm.totalMonths > 0);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterCo} onChange={e => { setFilterCo(e.target.value); setFilterBuilding(''); }} style={SEL_STYLE}>
          <option value="" style={{ background: '#F8FAFC' }}>All Companies</option>
          {companies.map(c => <option key={c} value={c} style={{ background: '#F8FAFC' }}>{c}</option>)}
        </select>
        <select value={filterBuilding} onChange={e => setFilterBuilding(e.target.value)} style={SEL_STYLE}>
          <option value="" style={{ background: '#F8FAFC' }}>All Buildings</option>
          {buildings.map(b => <option key={b} value={b} style={{ background: '#F8FAFC' }}>{b}</option>)}
        </select>
        <span className="text-xs" style={{ color: '#A8A29E' }}>Period ending</span>
        <select
          value={endYear}
          onChange={e => setEndYear(parseInt(e.target.value, 10))}
          style={SEL_STYLE}
        >
          {yearOptions.map(y => (
            <option key={y} value={y} style={{ background: '#F8FAFC' }}>{y}</option>
          ))}
        </select>
        <select
          value={endMonth}
          onChange={e => setEndMonth(parseInt(e.target.value, 10))}
          style={SEL_STYLE}
        >
          {MONTH_DROPDOWN.filter(m => m.value <= maxSelectableMonth).map(m => (
            <option key={m.value} value={m.value} style={{ background: '#F8FAFC' }}>{m.label}</option>
          ))}
        </select>
        <span className="text-sm" style={{ color: '#A8A29E' }}>{periodLabel}</span>
      </div>

      {dataMonths.length === 0 && (
        <div className="rounded-xl p-5 text-center" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <p className="font-medium mb-1" style={{ color: '#6366F1' }}>No rent history data yet</p>
          <p className="text-sm" style={{ color: '#A8A29E' }}>Use <strong>Sync Rent Data</strong> to upload the Rent Receivable Excel.</p>
        </div>
      )}

      {hasData && (
        <>
          {/* ── 8 KPI Cards ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            <LtmKpi label="Total Units"     value={String(kpis.totalUnits)} sub={`${filteredUnits.length} in scope`} />
            <LtmKpi label="Occupied Units"  value={String(kpis.occupied)}  sub={`${kpis.totalUnits - kpis.occupied} vacant`} accent={LTM_C.green} />
            <LtmKpi
              label="Occupancy Rate" value={`${Math.round(kpis.occRate * 100)}%`}
              accent={kpis.occRate >= 0.92 ? LTM_C.green : kpis.occRate >= 0.82 ? LTM_C.amber : LTM_C.warn}
            />
            <LtmKpi label="Rent Collected"  value={fmtN(kpis.collected)}  sub="LTM period"        accent={LTM_C.teal} />
            <LtmKpi label="Expected Rent"   value={fmtN(kpis.expected)}   sub="If fully occupied" />
            <LtmKpi label="Vacancy Loss"    value={fmtN(kpis.lost)} warn={kpis.lost > 0} sub="Expected − Collected" />
            <LtmKpi
              label="Collection Rate"
              value={kpis.collRate !== null ? `${kpis.collRate.toFixed(1)}%` : '—'}
              warn={kpis.collRate !== null && kpis.collRate < 90}
              na={kpis.collRate === null}
            />
            <LtmKpi
              label="Avg Occ Rent"
              value={kpis.avgOccRent !== null ? fmtN(kpis.avgOccRent) : '—'}
              sub="/mo per occupied"
              accent={LTM_C.gold}
              na={kpis.avgOccRent === null}
            />
          </div>

          {/* ── Row 1: Two wide charts ──────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <LtmChart title="Lost Rent vs Occupancy by Unit" sub="Bars = vacancy loss · Line = occupancy % · sorted highest loss first">
              {crossSection.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={crossSection} margin={{ left: 0, right: 32, top: 4, bottom: 36 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(232,222,200,0.5)" />
                    <XAxis dataKey="name" tick={{ ...LTM_TICK }} angle={-25} textAnchor="end" height={60} interval={0} />
                    <YAxis yAxisId="left"  tick={LTM_TICK} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" tick={LTM_TICK} tickFormatter={(v: number) => `${v}%`} domain={[0, 110]} />
                    <Tooltip
                      contentStyle={LTM_TT.contentStyle}
                      labelStyle={LTM_TT.labelStyle}
                      formatter={(v: number, name: string) =>
                        name === 'Occupancy %' ? [`${v}%`, 'Occupancy'] : [fmtN(v), 'Lost Rent']
                      }
                    />
                    <Bar yAxisId="left" dataKey="lost" name="Lost Rent" radius={[3, 3, 0, 0]}>
                      {crossSection.map((_, i) => (
                        <Cell key={i} fill={EXP_PALETTE[i % EXP_PALETTE.length]} opacity={Math.max(0.7, 0.95 - i * 0.02)} />
                      ))}
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="occPct" name="Occupancy %" stroke={LTM_C.gold} strokeWidth={2} dot={{ r: 3, fill: LTM_C.gold }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40" style={{ color: '#C0C0C0', fontSize: 13 }}>No vacancy loss data available</div>
              )}
            </LtmChart>

            <LtmChart title="Monthly Trend — Collected vs Expected" sub="Portfolio aggregate · area = uncollected gap">
              {monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={monthlyTrend} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(232,222,200,0.5)" />
                    <XAxis dataKey="month" tick={LTM_TICK} />
                    <YAxis tick={LTM_TICK} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={LTM_TT.contentStyle}
                      labelStyle={LTM_TT.labelStyle}
                      formatter={(v: number, name: string) => [fmtN(v), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: '#78716C' }} />
                    <Area type="monotone" dataKey="lost" name="Lost" fill="rgba(99,102,241,0.18)" stroke="none" legendType="none" />
                    <Line type="monotone" dataKey="expected"  name="Expected"  stroke={LTM_C.gold}  strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                    <Line type="monotone" dataKey="collected" name="Collected" stroke={LTM_C.teal}  strokeWidth={2.5} dot={{ r: 3, fill: LTM_C.teal }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40" style={{ color: '#C0C0C0', fontSize: 13 }}>No monthly trend data</div>
              )}
            </LtmChart>
          </div>

          {/* ── Row 2: Three medium charts ──────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <LtmChart title="By Building" sub="LTM Collected vs Expected">
              {buildingChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart layout="vertical" data={buildingChart} margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
                    <XAxis type="number" tick={LTM_TICK} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" width={100} tick={LTM_TICK} />
                    <Tooltip contentStyle={LTM_TT.contentStyle} labelStyle={LTM_TT.labelStyle} formatter={(v: number, name: string) => [fmtN(v), name]} />
                    <Legend wrapperStyle={{ fontSize: 12, color: '#78716C' }} />
                    <Bar dataKey="expected"  name="Expected"  fill={`${LTM_C.gold}70`} radius={[0, 3, 3, 0]} />
                    <Bar dataKey="collected" name="Collected" fill={LTM_C.teal}         radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40" style={{ color: '#C0C0C0', fontSize: 13 }}>No building data</div>
              )}
            </LtmChart>

            <LtmChart title="Vacancy Duration Breakdown" sub="Currently vacant units · from rent receivable $0 months">
              {vacantUnitCount > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={vacancyDurationBuckets} margin={{ left: 0, right: 8, top: 4, bottom: 36 }}>
                    <XAxis dataKey="range" tick={{ ...LTM_TICK, fontSize: 11 }} angle={-15} textAnchor="end" height={52} interval={0} />
                    <YAxis tick={LTM_TICK} allowDecimals={false} />
                    <Tooltip
                      contentStyle={LTM_TT.contentStyle}
                      labelStyle={LTM_TT.labelStyle}
                      formatter={(v: number) => [`${v} unit${v !== 1 ? 's' : ''}`, 'Count']}
                    />
                    <Bar dataKey="count" name="Units" radius={[4, 4, 0, 0]}>
                      {vacancyDurationBuckets.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 gap-3">
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#B0B0B0' }}>No vacant units in period</span>
                  <span style={{ fontSize: 11, color: '#C8C8C8', maxWidth: 220, textAlign: 'center', lineHeight: 1.5 }}>
                    Duration is estimated from consecutive $0 months in the rent receivable sheet.
                  </span>
                </div>
              )}
            </LtmChart>

            <LtmChart title="Recommended Actions" sub="Unit count by action type">
              {actionDist.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={actionDist} margin={{ left: 0, right: 8, top: 4, bottom: 36 }}>
                    <XAxis dataKey="action" tick={{ ...LTM_TICK, fontSize: 11 }} angle={-20} textAnchor="end" height={62} interval={0} />
                    <YAxis tick={LTM_TICK} allowDecimals={false} />
                    <Tooltip contentStyle={LTM_TT.contentStyle} labelStyle={LTM_TT.labelStyle} />
                    <Bar dataKey="count" name="Units" radius={[4, 4, 0, 0]}>
                      {actionDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-40" style={{ color: '#C0C0C0', fontSize: 13 }}>No data</div>
              )}
            </LtmChart>
          </div>

          {/* ── Bottom: Top Risk Table + Strategic Insights ─────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Top Risk table */}
            <div style={{ ...LTM_CARD, padding: 0, overflow: 'hidden' }} className="lg:col-span-2">
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0' }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', margin: 0 }}>Top Risk Units</h3>
                <p style={{ fontSize: 12, color: '#A8A29E', margin: '4px 0 0' }}>Ranked by occupancy risk + vacancy loss · {topRisk.length} shown</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#F0EDE5' }}>
                      {['Unit', 'Building', 'Occ Mo', 'Vac Mo', 'Collected', 'Expected', 'Lost', 'Occ %', 'Avg Rent', 'Trend', 'Action', 'Score'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topRisk.map(({ unit, ltm, score }, i) => {
                      const occColor = ltm.occPct >= 92 ? LTM_C.green : ltm.occPct >= 82 ? LTM_C.amber : LTM_C.warn;
                      const trendEl = ltm.trend === 'up'
                        ? <span style={{ color: LTM_C.green, fontWeight: 700 }}>↑</span>
                        : ltm.trend === 'down'
                          ? <span style={{ color: LTM_C.warn, fontWeight: 700 }}>↓</span>
                          : <span style={{ color: '#A8A29E' }}>→</span>;
                      const scoreBg    = score >= 60 ? 'rgba(146,64,14,0.12)' : score >= 30 ? 'rgba(184,134,11,0.15)' : 'rgba(21,128,61,0.12)';
                      const scoreColor = score >= 60 ? '#92400E' : score >= 30 ? '#7C3AED' : '#065F46';
                      const actionStyle = {
                        'Offer discount': { bg: '#FEF3C7', color: '#92400E' },
                        'Review rent':    { bg: 'rgba(184,134,11,0.15)', color: '#92400E' },
                        'Retain tenant':  { bg: 'rgba(21,128,61,0.12)', color: '#065F46' },
                        'Monitor':        { bg: 'rgba(168,162,158,0.15)', color: '#57534E' },
                      }[ltm.action] ?? { bg: 'rgba(168,162,158,0.15)', color: '#57534E' };
                      return (
                        <tr key={unit.id} style={{ background: i % 2 === 0 ? '#F7F1E6' : '#F1F5F9', borderBottom: '1px solid rgba(232,222,200,0.5)' }}>
                          <td style={{ padding: '8px 10px', fontWeight: 500, color: '#1C1917', whiteSpace: 'nowrap' }}>{unit.unit_number}</td>
                          <td style={{ padding: '8px 10px', color: '#57534E', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unit.property_name || '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', color: LTM_C.green, fontWeight: 600 }}>{ltm.occMonths}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', color: ltm.vacMonths > 0 ? LTM_C.warn : '#A8A29E', fontWeight: 600 }}>{ltm.vacMonths}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{fmtN(ltm.collected)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums', color: '#78716C' }}>{fmtN(ltm.expected)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums', color: ltm.lost > 0 ? LTM_C.warn : '#A8A29E', fontWeight: ltm.lost > 0 ? 600 : 400 }}>{ltm.lost > 0 ? fmtN(ltm.lost) : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: occColor }}>{ltm.occPct}%</span>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums' }}>{ltm.avgRent > 0 ? fmtN(ltm.avgRent) : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 15 }}>{trendEl}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap', background: actionStyle.bg, color: actionStyle.color }}>{ltm.action}</span>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: scoreBg, color: scoreColor }}>{score}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {topRisk.length === 0 && (
                      <tr><td colSpan={12} style={{ padding: '20px 16px', textAlign: 'center', color: '#C0C0C0', fontSize: 13 }}>No risk units — portfolio performing within range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Strategic Insights */}
            <div style={LTM_CARD}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', margin: '0 0 4px' }}>Strategic Insights</h3>
              <p style={{ fontSize: 12, color: '#A8A29E', margin: '0 0 14px' }}>Rule-based flags from per-unit LTM data</p>
              {insights.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {insights.map((ins, i) => {
                    const border = ins.type === 'red' ? LTM_C.warn : ins.type === 'amber' ? LTM_C.amber : LTM_C.green;
                    const bg     = ins.type === 'red' ? '#FEF3C7' : ins.type === 'amber' ? 'rgba(184,134,11,0.12)' : 'rgba(21,128,61,0.08)';
                    const tc     = ins.type === 'red' ? '#92400E' : ins.type === 'amber' ? '#92400E' : '#065F46';
                    return (
                      <div key={i} style={{ borderLeft: `3px solid ${border}`, background: bg, padding: '10px 12px', borderRadius: '0 8px 8px 0' }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: tc, margin: 0 }}>{ins.icon} {ins.title}</p>
                        <p style={{ fontSize: 12, color: tc, opacity: 0.85, margin: '4px 0 0' }}>{ins.detail}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 0', color: '#65A87A', fontSize: 13 }}>
                  🟢 No urgent issues — portfolio within normal range.
                </div>
              )}
              <div style={{ marginTop: 14, padding: '10px 12px', background: '#F7F1E6', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                <p style={{ fontSize: 12, color: '#78716C', margin: 0, lineHeight: 1.6 }}>
                  Rules: Occ &lt;50% + loss &gt;$3K → discount review · High rent + low occ → pricing review · Collection rate &lt;70% → collections flag
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function RentalUnits() {
  const [activeTab, setActiveTab] = useState<'list' | 'history' | 'ltm'>('ltm');

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
      render: r => r.arrears > 0 ? <span className="text-red-700 font-medium">{fmtUSD(r.arrears)}</span> : '—',
      sortValue: r => r.arrears,
    },
  ];

  const TABS = [
    { id: 'ltm'     as const, label: 'LTM Performance' },
    { id: 'list'    as const, label: 'Units List'      },
    { id: 'history' as const, label: 'Status History'  },
  ];

  return (
    <div className="space-y-6">
      <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1C1917' }}>Units</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: '#F0EDE5' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={activeTab === t.id
              ? { background: '#F8FAFC', color: '#1C1917' }
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
              <option value="" style={{ background: '#F8FAFC' }}>All Companies</option>
              {companies.map(c => <option key={c.id} value={c.id} style={{ background: '#F8FAFC' }}>{c.company_name}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={SEL_STYLE}>
              <option value="" style={{ background: '#F8FAFC' }}>All Statuses</option>
              <option value="occupied"         style={{ background: '#F8FAFC' }}>Occupied</option>
              <option value="vacant"           style={{ background: '#F8FAFC' }}>Vacant</option>
              <option value="notice"           style={{ background: '#F8FAFC' }}>Notice</option>
              <option value="reserved"         style={{ background: '#F8FAFC' }}>Reserved</option>
              <option value="maintenance_hold" style={{ background: '#F8FAFC' }}>Maintenance Hold</option>
            </select>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Showing Units" value={String(units.length)} />
            <KpiCard label="Occupied"      value={String(occupiedCount)} />
            <KpiCard label="Vacant"        value={String(vacCnt)} />
            <KpiCard label="Total Arrears" value={fmtUSD(totalArrears)} />
          </div>
          {loading ? <LoadingSkeleton rows={8} /> : error ? (
            <p className="text-red-700">{error}</p>
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
