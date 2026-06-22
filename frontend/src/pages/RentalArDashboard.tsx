import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell,
} from 'recharts';
import { useRentalPortfolio, sumMetrics } from '../contexts/RentalPortfolioContext';
import type { EntityArAp } from '../contexts/RentalPortfolioContext';
import { useRentalNav } from '../contexts/RentalNavContext';

// ─── helpers ──────────────────────────────────────────────────────────────────
const $$ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function pctStr(n: number, t: number) {
  return t > 0 ? ((n / t) * 100).toFixed(1) + '%' : '0%';
}

function arTotal(r: EntityArAp) {
  return r.ar_current + r.ar_1_30 + r.ar_31_60 + r.ar_61_90 + r.ar_90_plus;
}

// ─── risk flag ────────────────────────────────────────────────────────────────
type RiskLevel = 'CRITICAL' | 'HIGH' | 'WATCH' | 'OK';
function riskFlag(r: EntityArAp): RiskLevel {
  const total = arTotal(r);
  if (total === 0) return 'OK';
  if (r.ar_90_plus / total > 0.20)  return 'CRITICAL';
  if (r.ar_61_90  / total > 0.15)  return 'HIGH';
  if (r.ar_31_60  / total > 0.20)  return 'WATCH';
  return 'OK';
}

const RISK_STYLE: Record<RiskLevel, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  HIGH:     'bg-orange-100 text-orange-800',
  WATCH:    'bg-amber-100 text-amber-800',
  OK:       'bg-green-100 text-green-800',
};

// ─── collection stage ─────────────────────────────────────────────────────────
type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const STAGE_LABELS: Record<Stage, string> = {
  1: 'Current — no action',
  2: 'First reminder sent',
  3: 'Second reminder sent',
  4: 'Formal demand issued',
  5: 'Payment plan agreed',
  6: 'Legal action initiated',
  7: 'Written off',
};
function stageColor(s: Stage) {
  if (s <= 2) return 'text-green-700';
  if (s === 3) return 'text-amber-700';
  if (s <= 5)  return 'text-orange-700';
  return 'text-red-700';
}

// ─── AI narrative ─────────────────────────────────────────────────────────────
function buildNarrative(
  arAp: EntityArAp[],
  totalAR: number,
  dso: number,
  badDebtPct: number,
) {
  const critical = arAp.filter(r => riskFlag(r) === 'CRITICAL');
  const high     = arAp.filter(r => riskFlag(r) === 'HIGH');
  const watch    = arAp.filter(r => riskFlag(r) === 'WATCH');
  const lines: string[] = [];

  lines.push('── TOP 3 COLLECTION PRIORITIES ──────────────────────────────');
  const priority = [...critical, ...high, ...watch].slice(0, 3);
  if (priority.length === 0) {
    lines.push('  1. No overdue buckets detected — portfolio is current.');
    lines.push('  2. Maintain current billing cadence and payment monitoring.');
    lines.push('  3. Confirm all AR balances reconcile to rent rolls monthly.');
  } else {
    priority.forEach((r, i) => {
      const total = arTotal(r);
      const pastDue = r.ar_31_60 + r.ar_61_90 + r.ar_90_plus;
      lines.push(`  ${i + 1}. ${r.entity_name} — ${$$(pastDue)} past due (${pctStr(pastDue, total)} of AR)`);
      if (r.ar_90_plus > 0)
        lines.push(`     → Issue formal demand / pay-or-quit notice immediately`);
      else if (r.ar_61_90 > 0)
        lines.push(`     → Send second reminder with late fee schedule`);
      else
        lines.push(`     → Send first reminder and verify payment method`);
    });
  }

  lines.push('');
  lines.push('── CASH FLOW RISK (30 / 60 / 90 DAYS) ─────────────────────');
  const at30  = arAp.reduce((s, r) => s + r.ar_1_30, 0);
  const at60  = arAp.reduce((s, r) => s + r.ar_1_30 + r.ar_31_60, 0);
  const at90  = arAp.reduce((s, r) => s + r.ar_1_30 + r.ar_31_60 + r.ar_61_90, 0);
  lines.push(`  30-day:  ${$$(at30)} at risk if 1–30 day balances don't convert`);
  lines.push(`  60-day:  ${$$(at60)} cumulative exposure`);
  lines.push(`  90-day:  ${$$(at90)} cumulative — act now to protect Q-end cash position`);

  lines.push('');
  lines.push('── RECOMMENDED PAYMENT PLAN TERMS ──────────────────────────');
  lines.push('  • 31–60 days: Offer 50% now / balance in 30 days, no fee waiver');
  lines.push('  • 61–90 days: Require 70% upfront + signed repayment schedule');
  lines.push('  • 90+ days:   Demand full cure or initiate formal collections');

  lines.push('');
  lines.push('── EARLY WARNING INDICATORS ─────────────────────────────────');
  lines.push(`  • DSO trending above 35 days (current: ${dso.toFixed(1)} days)`);
  lines.push('  • Any entity moving from 1–30 to 31–60 bucket — flag immediately');
  lines.push('  • Repeat late payers: move to advance-pay requirement after 2nd occurrence');
  lines.push(`  • Bad debt ratio: ${(badDebtPct * 100).toFixed(1)}% (threshold: 10%)`);

  lines.push('');
  lines.push('── STRATEGIC RECOMMENDATION TO IMPROVE DSO ─────────────────');
  if (dso > 45) {
    lines.push('  DSO is elevated. Implement ACH/auto-pay enrollment for all tenants.');
    lines.push('  Target: reduce DSO below 35 days within 90 days.');
  } else if (dso > 35) {
    lines.push('  DSO is above benchmark. Tighten first-reminder cadence to Day 5 past due.');
    lines.push('  Consider early-payment discount (0.5%) for tenants paying by the 1st.');
  } else {
    lines.push('  DSO is within healthy range. Continue current collections discipline.');
    lines.push('  Review monthly — any spike above 35 days warrants immediate outreach.');
  }

  lines.push('');
  lines.push(`  Generated: ${new Date().toLocaleString()}`);
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
export default function RentalArDashboard() {
  const { portfolio } = useRentalPortfolio();
  const { setTab }    = useRentalNav();
  const port          = sumMetrics(portfolio.entities);

  // Section 4 — action board state
  const [actioned, setActioned] = useState<Set<string>>(new Set());
  const [notes, setNotes]       = useState<Record<string, string>>({});

  // Section 7 — process stage state
  const [stages, setStages] = useState<Record<string, Stage>>({});

  // Section 6 — AI advisor
  const [narrative, setNarrative] = useState('');
  const [generating, setGenerating] = useState(false);

  // ── computed values ────────────────────────────────────────────────────────
  const arAp = portfolio.arAp;

  const totalAR    = useMemo(() => arAp.reduce((s, r) => s + arTotal(r), 0), [arAp]);
  const current    = useMemo(() => arAp.reduce((s, r) => s + r.ar_current, 0), [arAp]);
  const bucket130  = useMemo(() => arAp.reduce((s, r) => s + r.ar_1_30, 0), [arAp]);
  const bucket3160 = useMemo(() => arAp.reduce((s, r) => s + r.ar_31_60, 0), [arAp]);
  const bucket6190 = useMemo(() => arAp.reduce((s, r) => s + r.ar_61_90, 0), [arAp]);
  const bucket90p  = useMemo(() => arAp.reduce((s, r) => s + r.ar_90_plus, 0), [arAp]);
  const totalAP    = useMemo(() => arAp.reduce((s, r) => s + r.ap_current + r.ap_1_30 + r.ap_31_60 + r.ap_60_plus, 0), [arAp]);

  const monthlyGPR = port.gpr / 12;
  const dso        = monthlyGPR > 0 ? (totalAR / monthlyGPR) * 30 : 0;
  const collectionRate = port.gpr > 0 ? Math.min(1, (port.egi) / port.gpr) : 0;
  const badDebtPct = totalAR > 0 ? bucket90p / totalAR : 0;
  const nwc        = totalAR - totalAP;

  // ── chart data ─────────────────────────────────────────────────────────────
  const chartData = arAp.map(r => ({
    name:    r.entity_name.split(' ')[0],
    Current: r.ar_current,
    '1-30':  r.ar_1_30,
    '31-60': r.ar_31_60,
    '61-90': r.ar_61_90,
    '90+':   r.ar_90_plus,
  }));

  // ── action board ───────────────────────────────────────────────────────────
  const immediate = arAp.filter(r => r.ar_90_plus > 0);
  const high_risk = arAp.filter(r => r.ar_90_plus === 0 && r.ar_61_90 > 0);
  const watch_tier = arAp.filter(r => r.ar_90_plus === 0 && r.ar_61_90 === 0 && r.ar_31_60 > 0);

  function toggleAction(key: string) {
    setActioned(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function generateNarrative() {
    setGenerating(true);
    setTimeout(() => {
      setNarrative(buildNarrative(arAp, totalAR, dso, badDebtPct));
      setGenerating(false);
    }, 800);
  }

  // ── no data guard ──────────────────────────────────────────────────────────
  if (!portfolio.loaded || arAp.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-gray-500 text-sm">No AR data loaded yet.</p>
        <button
          onClick={() => setTab('portfolio-upload')}
          className="bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#1A5249]"
        >
          ← Upload Portfolio Data
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10" style={{ fontFamily: 'Georgia, serif' }}>

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs uppercase tracking-wider font-sans" style={{ color: '#B8860B' }}>AR Dashboard</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Accounts Receivable</h1>
        <p className="text-sm text-gray-400 font-sans mt-1">Aging, collections, and strategic AR management</p>
      </div>

      {/* ══ SECTION 1 — KPI Cards ══════════════════════════════════════════════ */}
      <div>
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-3">01 — Receivables Summary</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-sans text-gray-500">Total Receivable</p>
            <p className="text-2xl font-bold font-mono mt-1 text-gray-900">{$$(totalAR)}</p>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-200 p-5">
            <p className="text-xs font-sans text-green-700">Current (0–30)</p>
            <p className="text-2xl font-bold font-mono mt-1 text-green-800">{$$(current + bucket130)}</p>
            <p className="text-xs font-sans text-green-600 mt-1">{pctStr(current + bucket130, totalAR)}</p>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
            <p className="text-xs font-sans text-amber-700">At Risk (31–60)</p>
            <p className="text-2xl font-bold font-mono mt-1 text-amber-800">{$$(bucket3160)}</p>
            <p className="text-xs font-sans text-amber-600 mt-1">{pctStr(bucket3160, totalAR)}</p>
          </div>
          <div className="rounded-xl border p-5" style={{ backgroundColor: '#FFF3ED', borderColor: '#FCA17D' }}>
            <p className="text-xs font-sans" style={{ color: '#C05621' }}>Overdue (61–90)</p>
            <p className="text-2xl font-bold font-mono mt-1" style={{ color: '#9C4221' }}>{$$(bucket6190)}</p>
            <p className="text-xs font-sans mt-1" style={{ color: '#C05621' }}>{pctStr(bucket6190, totalAR)}</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-5">
            <p className="text-xs font-sans text-red-700">Critical (90+)</p>
            <p className="text-2xl font-bold font-mono mt-1 text-red-800">{$$(bucket90p)}</p>
            <p className="text-xs font-sans text-red-600 mt-1">{pctStr(bucket90p, totalAR)}</p>
          </div>
        </div>
      </div>

      {/* ══ SECTION 2 — Stacked bar chart ═════════════════════════════════════ */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-1">02</p>
          <h2 className="text-xl font-bold text-gray-900">Receivables Aging by Entity</h2>
          <p className="text-sm text-gray-400 font-sans mb-5">Tall amber / red stacks = collection priority</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: 'sans-serif' }} />
              <YAxis tick={{ fontSize: 10, fontFamily: 'monospace' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [$$(v)]} contentStyle={{ fontFamily: 'monospace', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontFamily: 'sans-serif', fontSize: 12 }} />
              <Bar dataKey="Current" stackId="a" fill="#16A34A" />
              <Bar dataKey="1-30"    stackId="a" fill="#CA8A04" />
              <Bar dataKey="31-60"   stackId="a" fill="#D97706" />
              <Bar dataKey="61-90"   stackId="a" fill="#EA580C" />
              <Bar dataKey="90+"     stackId="a" fill="#DC2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ══ SECTION 3 — Aging Detail Table ════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">03</p>
          <h2 className="text-xl font-bold text-gray-900">AR Aging Detail</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="bg-gray-900 text-white text-xs">
                <th className="px-4 py-2.5 text-left">Entity</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Current</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">1–30</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">31–60</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">61–90</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">90+</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap font-bold">Total AR</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">% Past Due</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Risk</th>
              </tr>
            </thead>
            <tbody>
              {arAp.map((r, i) => {
                const total    = arTotal(r);
                const pastDue  = r.ar_31_60 + r.ar_61_90 + r.ar_90_plus;
                const flag     = riskFlag(r);
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.entity_name}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{$$(r.ar_current)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{$$(r.ar_1_30)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${r.ar_31_60 > 0 ? 'text-amber-700 font-semibold' : ''}`}>{$$(r.ar_31_60)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${r.ar_61_90 > 0 ? 'text-orange-700 font-semibold' : ''}`}>{$$(r.ar_61_90)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${r.ar_90_plus > 0 ? 'text-red-700 font-bold' : ''}`}>{$$(r.ar_90_plus)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{$$(total)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${pastDue > 0 ? 'text-red-600' : 'text-gray-400'}`}>{pctStr(pastDue, total)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RISK_STYLE[flag]}`}>{flag}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white font-bold">
                <td className="px-4 py-2.5">Portfolio Total</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(current)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(bucket130)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(bucket3160)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(bucket6190)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(bucket90p)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(totalAR)}</td>
                <td className="px-4 py-2.5 text-right font-mono">
                  {pctStr(bucket3160 + bucket6190 + bucket90p, totalAR)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ══ SECTION 4 — Collections Action Board ══════════════════════════════ */}
      <div className="space-y-5">
        <div>
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">04</p>
          <h2 className="text-xl font-bold text-gray-900">Collections — Action Required</h2>
        </div>

        {/* IMMEDIATE */}
        {immediate.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm font-bold text-red-800 mb-3 font-sans">🔴 IMMEDIATE — This Week</p>
            <p className="text-xs text-red-600 font-sans mb-3">Issue formal demand notice / pay-or-quit</p>
            <div className="space-y-3">
              {immediate.map(r => {
                const key = `imm-${r.entity_name}`;
                return (
                  <div key={key} className={`flex flex-col gap-2 p-3 rounded-lg border ${actioned.has(key) ? 'bg-red-100 border-red-200 opacity-60' : 'bg-white border-red-200'}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={actioned.has(key)} onChange={() => toggleAction(key)}
                        className="mt-0.5 h-4 w-4 rounded border-red-300 accent-red-600" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 font-sans">{r.entity_name}</p>
                        <p className="text-xs text-red-700 font-mono">{$$(r.ar_90_plus)} outstanding 90+ days</p>
                      </div>
                      <button className="text-xs border border-red-300 text-red-700 px-2 py-0.5 rounded hover:bg-red-100 font-sans">
                        Send Notice
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Add notes…"
                      value={notes[key] ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))}
                      className="text-xs border border-red-200 rounded px-2 py-1 font-sans bg-white"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* HIGH */}
        {high_risk.length > 0 && (
          <div className="rounded-xl p-5 border" style={{ backgroundColor: '#FFF3ED', borderColor: '#FCA17D' }}>
            <p className="text-sm font-bold mb-3 font-sans" style={{ color: '#9C4221' }}>🟠 HIGH — This Month</p>
            <p className="text-xs font-sans mb-3" style={{ color: '#C05621' }}>Send second reminder + late fee notice</p>
            <div className="space-y-3">
              {high_risk.map(r => {
                const key = `high-${r.entity_name}`;
                return (
                  <div key={key} className={`flex flex-col gap-2 p-3 rounded-lg bg-white border ${actioned.has(key) ? 'opacity-60' : ''}`} style={{ borderColor: '#FCA17D' }}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={actioned.has(key)} onChange={() => toggleAction(key)}
                        className="mt-0.5 h-4 w-4 rounded" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 font-sans">{r.entity_name}</p>
                        <p className="text-xs font-mono" style={{ color: '#C05621' }}>{$$(r.ar_61_90)} outstanding 61–90 days</p>
                      </div>
                      <button className="text-xs px-2 py-0.5 rounded font-sans border" style={{ borderColor: '#FCA17D', color: '#9C4221' }}>
                        Send Notice
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Add notes…"
                      value={notes[key] ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))}
                      className="text-xs border rounded px-2 py-1 font-sans"
                      style={{ borderColor: '#FCA17D' }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* WATCH */}
        {watch_tier.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-sm font-bold text-amber-800 mb-3 font-sans">🟡 WATCH — Next 30 Days</p>
            <p className="text-xs text-amber-700 font-sans mb-3">Send first reminder — check payment plan</p>
            <div className="space-y-3">
              {watch_tier.map(r => {
                const key = `watch-${r.entity_name}`;
                return (
                  <div key={key} className={`flex flex-col gap-2 p-3 rounded-lg bg-white border border-amber-200 ${actioned.has(key) ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={actioned.has(key)} onChange={() => toggleAction(key)}
                        className="mt-0.5 h-4 w-4 rounded accent-amber-500" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 font-sans">{r.entity_name}</p>
                        <p className="text-xs text-amber-700 font-mono">{$$(r.ar_31_60)} outstanding 31–60 days</p>
                      </div>
                      <button className="text-xs border border-amber-300 text-amber-800 px-2 py-0.5 rounded hover:bg-amber-100 font-sans">
                        Send Notice
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Add notes…"
                      value={notes[key] ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))}
                      className="text-xs border border-amber-200 rounded px-2 py-1 font-sans bg-white"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {immediate.length === 0 && high_risk.length === 0 && watch_tier.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-green-800 font-sans">🟢 All receivables are current — no action required</p>
          </div>
        )}
      </div>

      {/* ══ SECTION 5 — Strategic Metrics ═════════════════════════════════════ */}
      <div>
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-3">05 — Strategic Metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* DSO */}
          <div className={`rounded-xl border p-5 ${dso > 45 ? 'bg-red-50 border-red-200' : dso > 35 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
            <p className="text-xs font-sans text-gray-500">Days Sales Outstanding</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${dso > 45 ? 'text-red-800' : dso > 35 ? 'text-amber-800' : 'text-green-800'}`}>
              {dso.toFixed(1)}d
            </p>
            <p className="text-xs font-sans mt-1 text-gray-400">
              {dso < 35 ? '✓ Good (target < 35)' : dso < 45 ? '⚠ Watch (target < 35)' : '✗ Elevated (target < 35)'}
            </p>
          </div>

          {/* Collection Rate */}
          <div className={`rounded-xl border p-5 ${collectionRate < 0.95 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
            <p className="text-xs font-sans text-gray-500">Collection Rate</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${collectionRate < 0.95 ? 'text-amber-800' : 'text-green-800'}`}>
              {(collectionRate * 100).toFixed(1)}%
            </p>
            <p className="text-xs font-sans mt-1 text-gray-400">Target &gt; 95%</p>
          </div>

          {/* Bad Debt Risk */}
          <div className={`rounded-xl border p-5 ${badDebtPct > 0.10 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs font-sans text-gray-500">Bad Debt Risk (90+)</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${badDebtPct > 0.10 ? 'text-red-800' : 'text-gray-900'}`}>
              {(badDebtPct * 100).toFixed(1)}%
            </p>
            {badDebtPct > 0.10 && (
              <p className="text-xs font-sans mt-1 text-red-600">⚠ Above 10% threshold</p>
            )}
          </div>

          {/* Working Capital Impact */}
          <div className={`rounded-xl border p-5 ${nwc < 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            <p className="text-xs font-sans text-gray-500">Working Capital (AR−AP)</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${nwc < 0 ? 'text-red-800' : 'text-green-800'}`}>
              {$$(nwc)}
            </p>
            <p className="text-xs font-sans mt-1 text-gray-400">{nwc >= 0 ? '✓ Positive' : '✗ Negative — AP exceeds AR'}</p>
          </div>
        </div>
      </div>

      {/* ══ SECTION 6 — AI Strategic Advisor ═════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-1">06</p>
        <h2 className="text-xl font-bold text-gray-900 mb-1">AR Strategic Advisor</h2>
        <p className="text-sm text-gray-400 font-sans mb-4">AI-generated analysis of your AR aging position</p>
        <button
          onClick={generateNarrative}
          disabled={generating}
          className="flex items-center gap-2 bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#1A5249] disabled:opacity-50 font-sans mb-4"
        >
          {generating ? (
            <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
          ) : (
            '⚡ Generate AR Strategy'
          )}
        </button>
        {narrative && (
          <div className="bg-gray-900 rounded-xl p-5 overflow-x-auto">
            <pre className="text-green-300 text-xs leading-relaxed whitespace-pre-wrap font-mono">{narrative}</pre>
          </div>
        )}
      </div>

      {/* ══ SECTION 7 — AR Process Tracker ═══════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">07</p>
          <h2 className="text-xl font-bold text-gray-900">AR Collection Process</h2>
          <p className="text-sm text-gray-400 font-sans mt-0.5">Track collection stage per entity</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="bg-gray-100 text-gray-600 text-xs">
                <th className="px-4 py-2.5 text-left">Entity</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">AR Balance</th>
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Collection Stage</th>
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Notes</th>
              </tr>
            </thead>
            <tbody>
              {arAp.map((r, i) => {
                const total  = arTotal(r);
                const stage  = stages[r.entity_name] ?? 1;
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.entity_name}</td>
                    <td className="px-4 py-3 text-right font-mono">{$$(total)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={stage}
                        onChange={e => setStages(s => ({ ...s, [r.entity_name]: Number(e.target.value) as Stage }))}
                        className={`text-xs border rounded px-2 py-1 min-w-[180px] font-sans ${stageColor(stage)}`}
                      >
                        {(Object.entries(STAGE_LABELS) as [string, string][]).map(([v, lbl]) => (
                          <option key={v} value={v}>{lbl}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        placeholder="Notes…"
                        value={notes[`proc-${r.entity_name}`] ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [`proc-${r.entity_name}`]: e.target.value }))}
                        className="text-xs border rounded px-2 py-1 w-full font-sans"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
