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
  id: string; unit_number: string; company_id: string;
  company_name: string | null; property_name: string | null;
  status: string; monthly_rent: number; tenant_name: string | null;
  lease_end: string | null; arrears: number; days_vacant: number | null;
}
interface CompanyOption { id: string; company_name: string; }

// ── LTM hardcoded data ────────────────────────────────────────────────────────
const MONTHS_LTM = ['Jul 2024','Aug 2024','Sep 2024','Oct 2024','Nov 2024','Dec 2024',
                    'Jan 2025','Feb 2025','Mar 2025','Apr 2025','May 2025','Jun 2025'];
const MONTHS_SHORT = ['Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'];

type MonthStatus = 'occupied'|'vacant'|'notice'|'maintenance'|'reserved';
interface MonthEntry { status: MonthStatus; rent: number; }
interface UnitHistoryEntry {
  id: string; unit: string; company: string; building: string;
  marketRent: number; tenant: string|null; leaseEnd: string|null; turnovers: number;
  months: MonthEntry[];
}

const UNIT_HISTORY: UnitHistoryEntry[] = [
  {
    id:'U01', unit:'01-01', company:'Sunstone Rentals LLC', building:'Desert Vista Townhomes',
    marketRent:2100, tenant:'James Wilson', leaseEnd:'2025-12-31', turnovers:1,
    months:[
      {status:'occupied',rent:2100},{status:'occupied',rent:2100},{status:'occupied',rent:2100},
      {status:'occupied',rent:2100},{status:'occupied',rent:2100},{status:'occupied',rent:2100},
      {status:'occupied',rent:2100},{status:'occupied',rent:2100},{status:'vacant',rent:0},
      {status:'vacant',rent:0},{status:'occupied',rent:2000},{status:'occupied',rent:2000},
    ],
  },
  {
    id:'U02', unit:'01-02', company:'Sunstone Rentals LLC', building:'Desert Vista Townhomes',
    marketRent:2100, tenant:null, leaseEnd:null, turnovers:3,
    months:[
      {status:'occupied',rent:2100},{status:'notice',rent:2100},{status:'vacant',rent:0},
      {status:'vacant',rent:0},{status:'vacant',rent:0},{status:'occupied',rent:1900},
      {status:'occupied',rent:1900},{status:'notice',rent:1900},{status:'vacant',rent:0},
      {status:'vacant',rent:0},{status:'vacant',rent:0},{status:'vacant',rent:0},
    ],
  },
  {
    id:'U03', unit:'02-01', company:'Meridian Residential LLC', building:'Crestline Apartments',
    marketRent:1950, tenant:'Sarah Chen', leaseEnd:'2025-09-30', turnovers:1,
    months:[
      {status:'occupied',rent:1950},{status:'occupied',rent:1950},{status:'occupied',rent:1950},
      {status:'occupied',rent:1950},{status:'occupied',rent:1950},{status:'occupied',rent:1950},
      {status:'occupied',rent:1950},{status:'occupied',rent:1950},{status:'occupied',rent:1950},
      {status:'occupied',rent:1950},{status:'occupied',rent:1950},{status:'occupied',rent:1950},
    ],
  },
  {
    id:'U04', unit:'02-03', company:'Meridian Residential LLC', building:'Crestline Apartments',
    marketRent:2050, tenant:null, leaseEnd:null, turnovers:2,
    months:[
      {status:'occupied',rent:2050},{status:'occupied',rent:2050},{status:'occupied',rent:2050},
      {status:'occupied',rent:2050},{status:'notice',rent:2050},{status:'vacant',rent:0},
      {status:'vacant',rent:0},{status:'vacant',rent:0},{status:'vacant',rent:0},
      {status:'vacant',rent:0},{status:'vacant',rent:0},{status:'vacant',rent:0},
    ],
  },
  {
    id:'U05', unit:'03-01', company:'Cornerstone Housing LLC', building:'Oakwood Commons',
    marketRent:2100, tenant:'Maria Rodriguez', leaseEnd:'2026-03-31', turnovers:1,
    months:[
      {status:'occupied',rent:1800},{status:'occupied',rent:1800},{status:'occupied',rent:1800},
      {status:'occupied',rent:1800},{status:'occupied',rent:1800},{status:'occupied',rent:1800},
      {status:'occupied',rent:1800},{status:'occupied',rent:1800},{status:'occupied',rent:1800},
      {status:'occupied',rent:1800},{status:'occupied',rent:1800},{status:'occupied',rent:1800},
    ],
  },
  {
    id:'U06', unit:'04-02', company:'Pinnacle Rentals I LLC', building:'Pinnacle Ridge Homes',
    marketRent:2200, tenant:'David Kim', leaseEnd:'2025-08-31', turnovers:1,
    months:[
      {status:'occupied',rent:2200},{status:'occupied',rent:2200},{status:'occupied',rent:2200},
      {status:'occupied',rent:2200},{status:'occupied',rent:2200},{status:'occupied',rent:2200},
      {status:'occupied',rent:2200},{status:'occupied',rent:2200},{status:'occupied',rent:2200},
      {status:'occupied',rent:2200},{status:'occupied',rent:2200},{status:'maintenance',rent:0},
    ],
  },
  {
    id:'U07', unit:'05-01', company:'Summit Living LLC', building:'Summit Park Flats',
    marketRent:1800, tenant:'Tom Baker', leaseEnd:'2025-11-30', turnovers:1,
    months:[
      {status:'vacant',rent:0},{status:'vacant',rent:0},{status:'occupied',rent:1750},
      {status:'occupied',rent:1750},{status:'occupied',rent:1750},{status:'occupied',rent:1750},
      {status:'occupied',rent:1750},{status:'occupied',rent:1750},{status:'occupied',rent:1750},
      {status:'occupied',rent:1750},{status:'occupied',rent:1750},{status:'occupied',rent:1750},
    ],
  },
  {
    id:'U08', unit:'06-03', company:'Heritage Residential LLC', building:'Heritage Glen Suites',
    marketRent:1900, tenant:'Lisa Park', leaseEnd:'2025-10-31', turnovers:2,
    months:[
      {status:'occupied',rent:1900},{status:'occupied',rent:1900},{status:'notice',rent:1900},
      {status:'vacant',rent:0},{status:'occupied',rent:1850},{status:'occupied',rent:1850},
      {status:'occupied',rent:1850},{status:'occupied',rent:1850},{status:'occupied',rent:1850},
      {status:'occupied',rent:1850},{status:'occupied',rent:1850},{status:'occupied',rent:1850},
    ],
  },
];

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_DOT: Record<MonthStatus,string>  = { occupied:'🟢', vacant:'🔴', notice:'🟡', maintenance:'🔵', reserved:'⚪' };
const STATUS_LABEL: Record<MonthStatus,string> = { occupied:'Occupied', vacant:'Vacant', notice:'Notice Given', maintenance:'Maintenance', reserved:'Reserved' };
const STATUS_ROW: Record<MonthStatus,string>   = { occupied:'bg-green-50', vacant:'bg-red-50', notice:'bg-amber-50', maintenance:'bg-blue-50', reserved:'bg-gray-50' };

const STATUS_PILL: Record<string,string> = {
  occupied: 'bg-green-100 text-green-800', vacant: 'bg-red-100 text-red-800',
  notice: 'bg-amber-100 text-amber-800', reserved: 'bg-blue-100 text-blue-800',
  maintenance_hold: 'bg-gray-100 text-gray-800',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtN = (n: number) => '$' + n.toLocaleString('en-US');

function maxConsecVacant(months: MonthEntry[]): number {
  let max = 0, cur = 0;
  for (const m of months) { m.status === 'vacant' ? (cur++, max = Math.max(max, cur)) : (cur = 0); }
  return max;
}
function countVacant(months: MonthEntry[]) { return months.filter(m => m.status === 'vacant').length; }
function rentCollected(months: MonthEntry[]) { return months.reduce((s, m) => s + m.rent, 0); }
function getTrend(months: MonthEntry[]): 'up'|'down'|'stable' {
  const last = months.slice(-3).filter(m => m.status === 'occupied').length;
  const prev = months.slice(-6,-3).filter(m => m.status === 'occupied').length;
  return last > prev ? 'up' : last < prev ? 'down' : 'stable';
}
function getAction(u: UnitHistoryEntry): string {
  const consec = maxConsecVacant(u.months);
  const last   = u.months[u.months.length-1].status;
  const avg    = u.months.filter(m=>m.rent>0).reduce((s,m)=>s+m.rent,0)/(u.months.filter(m=>m.rent>0).length||1);
  if (last === 'vacant' && consec >= 2) return 'Offer discount';
  if (u.turnovers >= 3) return 'Inspect unit';
  if (avg < u.marketRent * 0.9) return 'Review rent';
  if (countVacant(u.months) === 0) return 'Retain tenant';
  return 'Monitor';
}

// ── STATUS HISTORY TAB ────────────────────────────────────────────────────────
function StatusHistoryTab() {
  const [selId, setSelId] = useState(UNIT_HISTORY[0].id);
  const u = UNIT_HISTORY.find(h => h.id === selId)!;
  const consec  = maxConsecVacant(u.months);
  const vacMos  = countVacant(u.months);
  const revLost = vacMos * u.marketRent;
  const allOcc  = u.months.every(m => m.status === 'occupied');

  return (
    <div className="space-y-5">
      {/* Selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Select Unit:</label>
        <select value={selId} onChange={e => setSelId(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-green-600">
          {UNIT_HISTORY.map(h => (
            <option key={h.id} value={h.id}>Unit {h.unit} — {h.company}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">
          {u.building} · Market: {fmtN(u.marketRent)}/mo{u.tenant ? ` · ${u.tenant}` : ' · VACANT'}
        </span>
      </div>

      {/* Strategic flags */}
      <div className="space-y-2">
        {consec >= 2 && (
          <div className="flex gap-3 p-3 rounded-lg border-l-4 border-red-500 bg-red-50">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Unit {u.unit} vacant {consec}+ months consecutively</p>
              <p className="text-sm text-red-700">Revenue lost: {fmtN(revLost)} · Recommended action: Offer discount to fill faster</p>
            </div>
          </div>
        )}
        {u.turnovers >= 3 && (
          <div className="flex gap-3 p-3 rounded-lg border-l-4 border-amber-500 bg-amber-50">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">High turnover unit — {u.turnovers} tenants this year</p>
              <p className="text-sm text-amber-700">Check maintenance issues or pricing strategy</p>
            </div>
          </div>
        )}
        {allOcc && (
          <div className="flex gap-3 p-3 rounded-lg border-l-4 border-green-500 bg-green-50">
            <span className="text-green-600 shrink-0">🟢</span>
            <div>
              <p className="text-sm font-semibold text-green-800">Unit {u.unit} — 100% occupancy all 12 months</p>
              <p className="text-sm text-green-700">Best-performing unit · No action needed</p>
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="font-semibold text-gray-900 text-sm">Unit {u.unit} — 12-Month Status Timeline</p>
          <p className="text-xs text-gray-400">Jul 2024 → Jun 2025</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="text-left px-4 py-2">Month</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-right px-4 py-2">Rent Collected</th>
              <th className="text-right px-4 py-2">Revenue Lost</th>
            </tr>
          </thead>
          <tbody>
            {u.months.map((m, i) => (
              <tr key={i} className={`border-t border-gray-50 ${STATUS_ROW[m.status]}`}>
                <td className="px-4 py-2.5 font-medium text-gray-700">{MONTHS_LTM[i]}</td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span>{STATUS_DOT[m.status]}</span>
                    <span className={`text-xs font-medium ${
                      m.status==='occupied'?'text-green-700':m.status==='vacant'?'text-red-700':
                      m.status==='notice'?'text-amber-700':m.status==='maintenance'?'text-blue-700':'text-gray-600'
                    }`}>{STATUS_LABEL[m.status]}</span>
                    {m.status==='vacant' && i>0 && u.months[i-1].status!=='vacant' &&
                      <span className="text-xs text-gray-400 italic">← tenant left</span>}
                    {m.status==='occupied' && m.rent < u.marketRent &&
                      <span className="text-xs text-amber-600 italic">← discount given</span>}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {m.rent > 0
                    ? <span className="text-green-700">{fmtN(m.rent)}</span>
                    : <span className="text-gray-400">$0</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {m.status==='vacant'
                    ? <span className="text-red-600">{fmtN(u.marketRent)}</span>
                    : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-900 text-white text-sm">
              <td className="px-4 py-3 font-semibold">Summary</td>
              <td className="px-4 py-3 text-xs">Vacant: {vacMos} months · Occupied: {12-vacMos} months</td>
              <td className="px-4 py-3 text-right font-mono font-semibold">{fmtN(rentCollected(u.months))}</td>
              <td className="px-4 py-3 text-right font-mono text-red-300 font-semibold">{fmtN(revLost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        {(Object.entries(STATUS_DOT) as [MonthStatus,string][]).map(([s,dot]) => (
          <span key={s} className="flex items-center gap-1">{dot} {STATUS_LABEL[s]}</span>
        ))}
      </div>
    </div>
  );
}

// ── LTM PERFORMANCE TAB ───────────────────────────────────────────────────────
function LTMPerformanceTab() {
  const [selId, setSelId] = useState('all');
  const [filterCo, setFilterCo] = useState('');
  const [viewMode, setViewMode] = useState<'chart'|'table'>('chart');

  const companies = [...new Set(UNIT_HISTORY.map(u => u.company))];
  const filtered  = filterCo ? UNIT_HISTORY.filter(u => u.company === filterCo) : UNIT_HISTORY;
  const displayUnit = selId !== 'all' ? UNIT_HISTORY.find(u => u.id === selId) : undefined;

  const chartData = displayUnit ? MONTHS_SHORT.map((mo, i) => {
    const m = displayUnit.months[i];
    return { month: mo, rent: m.rent, occupancy: (m.status==='occupied'||m.status==='notice') ? 100 : 0, status: m.status, lost: m.status==='vacant' ? displayUnit.marketRent : 0 };
  }) : [];

  const insights = useMemo(() => {
    const list: { type:'red'|'orange'|'yellow'|'green'; unit:string; text:string; rec:string }[] = [];
    for (const u of UNIT_HISTORY) {
      const consec = maxConsecVacant(u.months);
      const vac    = countVacant(u.months);
      const lost   = vac * u.marketRent;
      const last   = u.months[u.months.length-1].status;
      const avg    = u.months.filter(m=>m.rent>0).reduce((s,m)=>s+m.rent,0)/(u.months.filter(m=>m.rent>0).length||1);
      if (consec >= 3)
        list.push({ type:'red',    unit:u.unit, text:`Unit ${u.unit} — vacant ${consec} months · Revenue lost: ${fmtN(lost)}`, rec:`Offer 1 month free or reduce rent 10% to fill quickly` });
      else if (last==='vacant' && consec>=2)
        list.push({ type:'orange', unit:u.unit, text:`Unit ${u.unit} — currently vacant ${consec} months`, rec:`Contact prospects now · Offer early move-in special` });
      else if (avg < u.marketRent*0.9 && last==='occupied')
        list.push({ type:'yellow', unit:u.unit, text:`Unit ${u.unit} — renting at ${fmtN(Math.round(avg))}, market rate ${fmtN(u.marketRent)}`, rec:`Gradual increase $100/year to reach market rate` });
      else if (u.months.every(m=>m.status==='occupied') && avg >= u.marketRent)
        list.push({ type:'green',  unit:u.unit, text:`Unit ${u.unit} — 100% occupancy 12 months, at/above market rate`, rec:`No action needed — consider rent increase at renewal` });
    }
    return list;
  }, []);

  const insightCls = { red:'border-red-400 bg-red-50', orange:'border-orange-400 bg-orange-50', yellow:'border-amber-400 bg-amber-50', green:'border-green-400 bg-green-50' };
  const insightIco = { red:'🔴', orange:'🟠', yellow:'🟡', green:'🟢' };

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterCo} onChange={e => { setFilterCo(e.target.value); setSelId('all'); }}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-green-600">
          <option value="">All Companies</option>
          {companies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={selId} onChange={e => setSelId(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-1 focus:ring-green-600">
          <option value="all">All Units</option>
          {filtered.map(u => <option key={u.id} value={u.id}>Unit {u.unit} — {u.building}</option>)}
        </select>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg ml-auto">
          {(['chart','table'] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${viewMode===v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{v}</button>
          ))}
        </div>
      </div>

      {/* Chart — single unit */}
      {viewMode==='chart' && displayUnit && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="text-sm font-semibold text-gray-700">Unit {displayUnit.unit} — LTM Rent &amp; Occupancy</p>
          <p className="text-xs text-gray-400 mb-4">Jul 2024 – Jun 2025 · Market rent: {fmtN(displayUnit.marketRent)}/mo</p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ left:0, right:30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize:11 }} />
              <YAxis yAxisId="left" tickFormatter={v=>`$${(v/1000).toFixed(1)}K`} tick={{ fontSize:11 }} domain={[0, displayUnit.marketRent*1.2]} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={v=>`${v}%`} tick={{ fontSize:11 }} domain={[0,130]} />
              <Tooltip content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
                    <p className="font-semibold text-gray-800 mb-1">{MONTHS_LTM[MONTHS_SHORT.indexOf(label as string)]}</p>
                    <p className="text-gray-600">Status: <span className="font-medium">{STATUS_LABEL[d.status as MonthStatus] ?? d.status}</span></p>
                    <p className="text-gray-600">Rent: <span className="font-mono">{fmtN(d.rent)}</span></p>
                    {d.lost > 0 && <p className="text-red-600">Lost revenue: <span className="font-mono">{fmtN(d.lost)}</span></p>}
                  </div>
                );
              }} />
              <Bar yAxisId="left" dataKey="rent" name="Rent Collected" radius={[2,2,0,0]}>
                {chartData.map((d, i) => <Cell key={i} fill={d.rent > 0 ? '#16A34A' : '#DC2626'} />)}
              </Bar>
              <Line yAxisId="right" type="stepAfter" dataKey="occupancy" stroke="#B8860B" strokeWidth={2} dot={false} name="Occupancy %" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-600 inline-block"/>&nbsp;Rent Collected</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-600 inline-block"/>&nbsp;Vacant Month</span>
            <span className="flex items-center gap-1"><span className="w-6 h-0.5 bg-amber-600 inline-block"/>&nbsp;Occupancy %</span>
          </div>
        </div>
      )}

      {viewMode==='chart' && !displayUnit && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
          Select a specific unit above to view its LTM dual-axis chart.
        </div>
      )}

      {/* Summary table */}
      {(viewMode==='table' || true) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="font-semibold text-gray-900 text-sm">LTM Summary — {filterCo || 'All Companies'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-900 text-white">
                  {['Unit','Building','Company','Occ Mo','Vac Mo','Collected','Expected','Lost','Occ %','Avg Rent','Trend','Action'].map(h=>(
                    <th key={h} className="px-3 py-2.5 text-left whitespace-nowrap font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const occ  = 12 - countVacant(u.months);
                  const vac  = countVacant(u.months);
                  const coll = rentCollected(u.months);
                  const exp  = u.marketRent * 12;
                  const lost = exp - coll;
                  const pct  = Math.round((occ/12)*100);
                  const avg  = u.months.filter(m=>m.rent>0).reduce((s,m)=>s+m.rent,0)/(occ||1);
                  const trend = getTrend(u.months);
                  const action = getAction(u);
                  return (
                    <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono font-medium">{u.unit}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate">{u.building}</td>
                      <td className="px-3 py-2 text-gray-600 max-w-[120px] truncate">{u.company}</td>
                      <td className="px-3 py-2 text-center text-green-700 font-medium">{occ}</td>
                      <td className="px-3 py-2 text-center text-red-600 font-medium">{vac}</td>
                      <td className="px-3 py-2 font-mono text-right">{fmtN(coll)}</td>
                      <td className="px-3 py-2 font-mono text-right text-gray-400">{fmtN(exp)}</td>
                      <td className="px-3 py-2 font-mono text-right text-red-600">{lost>0?fmtN(lost):'—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pct===100?'bg-green-100 text-green-700':pct>=75?'bg-amber-100 text-amber-700':'bg-red-100 text-red-700'}`}>{pct}%</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-right">{fmtN(Math.round(avg))}</td>
                      <td className="px-3 py-2 text-center text-base font-bold">
                        {trend==='up'?<span className="text-green-600">↑</span>:trend==='down'?<span className="text-red-600">↓</span>:<span className="text-gray-400">→</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          action==='Offer discount'?'bg-red-100 text-red-700':
                          action==='Review rent'?'bg-amber-100 text-amber-700':
                          action==='Inspect unit'?'bg-blue-100 text-blue-700':
                          action==='Retain tenant'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-600'
                        }`}>{action}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Strategic Insights */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <p className="text-sm font-semibold text-gray-700 mb-3">Strategic Insights</p>
        <div className="space-y-2">
          {insights.map((ins, i) => (
            <div key={i} className={`border-l-4 rounded-r-lg p-3 ${insightCls[ins.type]}`}>
              <p className="text-sm font-medium text-gray-800"><span className="mr-2">{insightIco[ins.type]}</span>{ins.text}</p>
              <p className="text-sm text-gray-600 mt-0.5 ml-6">💡 {ins.rec}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT (existing units list + new tabs) ───────────────────────────
export default function RentalUnits() {
  const [activeTab, setActiveTab] = useState<'list'|'history'|'ltm'>('list');

  // ── existing state ──
  const [units,         setUnits]         = useState<UnitRow[]>([]);
  const [companies,     setCompanies]     = useState<CompanyOption[]>([]);
  const [filterCompany, setFilterCompany] = useState('');
  const [filterStatus,  setFilterStatus]  = useState('');
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  const fetchUnits = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params: Record<string,string> = {};
      if (filterCompany) params.company_id = filterCompany;
      if (filterStatus)  params.status     = filterStatus;
      const res = await api.get<UnitRow[]>('/api/rentals/units', { params });
      setUnits(res.data);
    } catch { setError('Failed to load units.'); }
    finally  { setLoading(false); }
  }, [filterCompany, filterStatus]);

  const fetchCompanies = useCallback(async () => {
    try { const res = await api.get<CompanyOption[]>('/api/rentals/companies'); setCompanies(res.data); } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchCompanies(); }, [fetchCompanies]);
  useEffect(() => { if (activeTab === 'list') fetchUnits(); }, [fetchUnits, activeTab]);

  const { occupied: occupiedCount, vacant: vacCnt } = useMemo(() => occupancyStats(units), [units]);
  const totalArrears = useMemo(() => units.reduce((s,u) => s+(u.arrears??0), 0), [units]);

  const columns: Column<UnitRow>[] = [
    { key:'unit_number',  label:'Unit No.',  sortValue:(r)=>r.unit_number },
    { key:'company_name', label:'Company',   sortValue:(r)=>r.company_name??'' },
    { key:'property_name',label:'Property',  sortValue:(r)=>r.property_name??'' },
    { key:'status', label:'Status',
      render:(r)=><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[r.status]??'bg-gray-100 text-gray-800'}`}>{r.status}</span>,
      sortValue:(r)=>r.status },
    { key:'tenant_name', label:'Tenant',
      render:(r)=>r.status==='vacant'&&r.days_vacant!=null
        ?<span className="text-gray-400 text-xs">— ({r.days_vacant}d vacant)</span>
        :(r.tenant_name??'—'),
      sortValue:(r)=>r.tenant_name??'' },
    { key:'lease_end',     label:'Lease End',     sortValue:(r)=>r.lease_end??'' },
    { key:'monthly_rent',  label:'Monthly Rent',  render:(r)=>fmtUSD(r.monthly_rent), sortValue:(r)=>r.monthly_rent },
    { key:'arrears', label:'Arrears',
      render:(r)=>r.arrears>0?<span className="text-red-600 font-medium">{fmtUSD(r.arrears)}</span>:'—',
      sortValue:(r)=>r.arrears },
  ];

  const TABS = [
    { id:'list'    as const, label:'Units List'      },
    { id:'history' as const, label:'Status History'  },
    { id:'ltm'     as const, label:'LTM Performance' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Units</h1>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab===t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ── Tab 1: existing Units List ── */}
      {activeTab === 'list' && (
        <>
          <div className="flex flex-wrap gap-3">
            <select value={filterCompany} onChange={e=>setFilterCompany(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">All Companies</option>
              {companies.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">All Statuses</option>
              <option value="occupied">Occupied</option>
              <option value="vacant">Vacant</option>
              <option value="notice">Notice</option>
              <option value="reserved">Reserved</option>
              <option value="maintenance_hold">Maintenance Hold</option>
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

      {/* ── Tab 2: Status History ── */}
      {activeTab === 'history' && <StatusHistoryTab />}

      {/* ── Tab 3: LTM Performance ── */}
      {activeTab === 'ltm' && <LTMPerformanceTab />}
    </div>
  );
}
