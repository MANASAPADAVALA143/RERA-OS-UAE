import { useEffect, useRef, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useRentalPortfolio, sumMetrics } from '../contexts/RentalPortfolioContext';
import type { EntityArAp } from '../contexts/RentalPortfolioContext';
import { useRentalNav } from '../contexts/RentalNavContext';
import api from '../services/api';

// ── QB AP Aging types ─────────────────────────────────────────────────────────
interface QBApTotals {
  current: number; days_1_30: number; days_31_60: number;
  days_60_plus: number; total: number; overdue: number;
}
interface QBApPreview {
  as_of_date: string; snapshot_month: string;
  rows: unknown[]; row_count: number;
  matched_count: number; seeded_count: number;
  vendors_to_seed: string[];
  credit_rows: { vendor_name: string; has_credit: boolean; days_31_60: number; days_60_plus: number }[];
  skipped_subtotals: number;
  portfolio_totals: QBApTotals;
}
interface QBApLatest {
  has_data: boolean; snapshot_count: number;
  latest_snapshot?: { snapshot_month: string; uploaded_at: string; row_count: number; seeded_count: number };
  portfolio_totals?: QBApTotals;
  dpo_estimate?: number | null;
  by_vendor: { vendor_name: string; overdue: number; total: number; has_credit: boolean; was_seeded: boolean }[];
  credit_rows: { vendor_name: string }[];
  trend: { month: string; overdue: number; total: number }[];
  trend_ready: boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const $$ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

function pctStr(n: number, t: number) {
  return t > 0 ? ((n / t) * 100).toFixed(1) + '%' : '0%';
}

function apTotal(r: EntityArAp) {
  return r.ap_current + r.ap_1_30 + r.ap_31_60 + r.ap_60_plus;
}

// ─── risk flag (AP) ───────────────────────────────────────────────────────────
type RiskLevel = 'CRITICAL' | 'WATCH' | 'OK';
function riskFlag(r: EntityArAp): RiskLevel {
  const total = apTotal(r);
  if (total === 0) return 'OK';
  if (r.ap_60_plus / total > 0.20) return 'CRITICAL';
  if (r.ap_31_60  / total > 0.20) return 'WATCH';
  return 'OK';
}

const RISK_STYLE: Record<RiskLevel, string> = {
  CRITICAL: 'bg-red-100 text-red-800',
  WATCH:    'bg-amber-100 text-amber-800',
  OK:       'bg-green-100 text-green-800',
};

// ─── process stage ────────────────────────────────────────────────────────────
type Stage = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const STAGE_LABELS: Record<Stage, string> = {
  1: 'Invoice received',
  2: 'Under review / approval',
  3: 'Approved — pending payment',
  4: 'Payment scheduled',
  5: 'Payment released',
  6: 'Disputed',
  7: 'On hold',
};
function stageColor(s: Stage): string {
  if (s <= 3) return 'text-amber-700';
  if (s <= 5) return 'text-green-800';
  return 'text-red-700';
}

// ─── AI narrative ─────────────────────────────────────────────────────────────
function buildNarrative(
  arAp: EntityArAp[],
  totalAP: number,
  dpo: number,
) {
  const critical = arAp.filter(r => r.ap_60_plus > 0).sort((a, b) => b.ap_60_plus - a.ap_60_plus);
  const watch    = arAp.filter(r => r.ap_60_plus === 0 && r.ap_31_60 > 0).sort((a, b) => b.ap_31_60 - a.ap_31_60);
  const lines: string[] = [];

  lines.push('── TOP 3 PAYMENT PRIORITIES ──────────────────────────────────');
  const top3 = [...critical, ...watch].slice(0, 3);
  if (top3.length === 0) {
    lines.push('  1. All payables are current — no overdue vendor balances.');
    lines.push('  2. Maintain current payment schedule to preserve vendor terms.');
    lines.push('  3. Consider early-payment discounts with key vendors.');
  } else {
    top3.forEach((r, i) => {
      const total = apTotal(r);
      const overdue = r.ap_31_60 + r.ap_60_plus;
      lines.push(`  ${i + 1}. ${r.entity_name} — ${$$(overdue)} overdue (${pctStr(overdue, total)} of AP)`);
      if (r.ap_60_plus > 0)
        lines.push(`     → Release payment immediately — vendor relationship at risk`);
      else
        lines.push(`     → Schedule payment this week — avoid late fee / service disruption`);
    });
  }

  lines.push('');
  lines.push('── CASH FLOW IMPACT OF CURRENT DELAYS ────────────────────────');
  const overdue60 = arAp.reduce((s, r) => s + r.ap_60_plus, 0);
  const overdue31 = arAp.reduce((s, r) => s + r.ap_31_60, 0);
  lines.push(`  60+ days overdue: ${$$(overdue60)} — vendors may suspend service`);
  lines.push(`  31–60 days at risk: ${$$(overdue31)} — late fees likely accruing`);
  lines.push(`  Total AP outstanding: ${$$(totalAP)}`);
  lines.push('  Delayed payments compress vendor credit terms and increase future AP costs.');

  lines.push('');
  lines.push('── RECOMMENDED PAYMENT SCHEDULE (NEXT 30 DAYS) ───────────────');
  lines.push(`  Week 1: Clear all 60+ day balances (${$$(overdue60)}) — protect service continuity`);
  lines.push(`  Week 2: Process 31–60 day balances (${$$(overdue31)})`);
  lines.push('  Week 3–4: Stay current on new invoices; review payment terms with top vendors');

  lines.push('');
  lines.push('── VENDOR RELATIONSHIP RISKS ──────────────────────────────────');
  if (critical.length > 0) {
    critical.slice(0, 3).forEach(r => {
      lines.push(`  ⚠ ${r.entity_name}: ${$$(r.ap_60_plus)} 60+ days — immediate risk of service interruption`);
    });
  } else {
    lines.push('  No vendors are currently at relationship risk.');
  }

  lines.push('');
  lines.push('── DPO OPTIMISATION STRATEGY ──────────────────────────────────');
  if (dpo < 20) {
    lines.push(`  DPO: ${dpo.toFixed(1)} days — paying too fast. Extend to 30-35 days to improve working capital.`);
    lines.push('  Negotiate Net-30 terms with major vendors; retain cash longer without penalty.');
  } else if (dpo <= 45) {
    lines.push(`  DPO: ${dpo.toFixed(1)} days — healthy range (30–45). Maintain current payment cadence.`);
    lines.push('  Pursue early-pay discounts (e.g. 2/10 Net 30) with high-volume vendors.');
  } else {
    lines.push(`  DPO: ${dpo.toFixed(1)} days — elevated. Risk of strained vendor terms and credit holds.`);
    lines.push('  Prioritise clearing 60+ day balances first, then optimise to 30–45 day DPO.');
  }

  lines.push('');
  lines.push(`  Generated: ${new Date().toLocaleString()}`);
  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════════════════════
export default function RentalApDashboard() {
  const { portfolio } = useRentalPortfolio();
  const { setTab }    = useRentalNav();
  const port          = sumMetrics(portfolio.entities);

  // ── QB AP Aging upload state ──────────────────────────────────────────────
  const [qbAp, setQbAp]               = useState<QBApLatest | null>(null);
  const [qbApFile, setQbApFile]        = useState<File | null>(null);
  const [qbApDate, setQbApDate]        = useState('');
  const [qbApPreview, setQbApPreview]  = useState<QBApPreview | null>(null);
  const [qbApUploading, setQbApUploading] = useState(false);
  const [qbApConfirming, setQbApConfirming] = useState(false);
  const [qbApError, setQbApError]      = useState('');
  const [showQbApPanel, setShowQbApPanel] = useState(false);
  const qbApFileRef = useRef<HTMLInputElement>(null);

  const fetchQbAp = () => {
    api.get<QBApLatest>('/api/rentals/ar-ap/qb-ap-aging/latest')
      .then(r => setQbAp(r.data))
      .catch(() => setQbAp(null));
  };
  useEffect(() => { fetchQbAp(); }, []);

  const handleQbApPreview = async () => {
    if (!qbApFile || !qbApDate) { setQbApError('Select a file and set the report date.'); return; }
    setQbApError(''); setQbApUploading(true); setQbApPreview(null);
    const fd = new FormData();
    fd.append('file', qbApFile);
    fd.append('as_of_date', qbApDate);
    try {
      const r = await api.post<QBApPreview>('/api/rentals/ar-ap/qb-ap-aging/preview', fd);
      setQbApPreview(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setQbApError(msg || 'Preview failed.');
    } finally { setQbApUploading(false); }
  };

  const handleQbApConfirm = async () => {
    if (!qbApPreview || !qbApDate) return;
    setQbApConfirming(true); setQbApError('');
    try {
      await api.post('/api/rentals/ar-ap/qb-ap-aging/confirm', {
        as_of_date:     qbApDate,
        snapshot_month: qbApPreview.snapshot_month,
        rows:           qbApPreview.rows,
      });
      setQbApPreview(null); setQbApFile(null); setQbApDate('');
      if (qbApFileRef.current) qbApFileRef.current.value = '';
      setShowQbApPanel(false);
      fetchQbAp();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | object } } };
      const raw = err?.response?.data?.detail;
      setQbApError(typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : 'Confirm failed.');
    } finally { setQbApConfirming(false); }
  };

  // section 4 action state
  const [actioned, setActioned] = useState<Set<string>>(new Set());
  const [notes, setNotes]       = useState<Record<string, string>>({});

  // section 8 process stage state
  const [stages, setStages] = useState<Record<string, Stage>>({});

  // section 7 AI advisor
  const [narrative, setNarrative] = useState('');
  const [generating, setGenerating] = useState(false);

  const arAp = portfolio.arAp;

  // ── totals ────────────────────────────────────────────────────────────────
  const totalAP   = useMemo(() => arAp.reduce((s, r) => s + apTotal(r), 0), [arAp]);
  const current   = useMemo(() => arAp.reduce((s, r) => s + r.ap_current, 0), [arAp]);
  const b130      = useMemo(() => arAp.reduce((s, r) => s + r.ap_1_30, 0), [arAp]);
  const b3160     = useMemo(() => arAp.reduce((s, r) => s + r.ap_31_60, 0), [arAp]);
  const b60plus   = useMemo(() => arAp.reduce((s, r) => s + r.ap_60_plus, 0), [arAp]);

  const totalAR   = useMemo(() =>
    portfolio.arAp.reduce((s, r) => s + r.ar_current + r.ar_1_30 + r.ar_31_60 + r.ar_61_90 + r.ar_90_plus, 0),
    [portfolio.arAp]);

  const monthlyOpEx = port.total_opex / 12;
  const dpo         = monthlyOpEx > 0 ? (totalAP / monthlyOpEx) * 30 : 0;
  const nwc         = totalAR - totalAP;

  // ── chart data ────────────────────────────────────────────────────────────
  const chartData = arAp.map(r => ({
    name:    r.entity_name.split(' ')[0],
    Current: r.ap_current,
    '1–30':  r.ap_1_30,
    '31–60': r.ap_31_60,
    '60+':   r.ap_60_plus,
  }));

  // ── action tiers ──────────────────────────────────────────────────────────
  const payNow  = arAp.filter(r => r.ap_60_plus > 0);
  const payWeek = arAp.filter(r => r.ap_60_plus === 0 && r.ap_31_60 > 0);
  const schedule = arAp.filter(r => r.ap_60_plus === 0 && r.ap_31_60 > 0); // same bucket, shown separately
  // Note: since we only have 60+ (no split 61-90 vs 90+), payNow and payWeek are distinct by bucket
  const payWeekOnly = arAp.filter(r => r.ap_60_plus === 0 && r.ap_31_60 > 0);

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
      setNarrative(buildNarrative(arAp, totalAP, dpo));
      setGenerating(false);
    }, 900);
  }

  // ── no portfolio data — still show QB AP upload panel ────────────────────
  const hasPortfolioData = portfolio.loaded && arAp.length > 0;

  return (
    <div className="space-y-10" style={{ fontFamily: 'Georgia, serif' }}>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs uppercase tracking-wider font-sans" style={{ color: '#7C3AED' }}>AP Dashboard</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-1">Accounts Payable</h1>
        <p className="text-sm text-gray-400 font-sans mt-1">Aging, payment planning, and vendor relationship management</p>
      </div>

      {/* ══ QB AP AGING UPLOAD PANEL ════════════════════════════════════════ */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        {/* header bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <p className="text-xs font-sans font-semibold uppercase tracking-wider text-gray-400">QuickBooks · AP Aging Detail by Vendor</p>
            {qbAp?.has_data && qbAp.latest_snapshot && (
              <p className="text-xs text-gray-500 font-sans mt-0.5">
                Latest: {qbAp.latest_snapshot.snapshot_month} · {qbAp.latest_snapshot.row_count} vendors
              </p>
            )}
          </div>
          {qbAp?.has_data && !showQbApPanel && (
            <button onClick={() => setShowQbApPanel(true)}
              className="text-xs font-sans font-medium px-3 py-1.5 rounded-lg border border-[#0E3B36] text-[#0E3B36] hover:bg-[#0E3B36] hover:text-white transition-colors">
              + Upload Next Month
            </button>
          )}
        </div>

        {/* upload form */}
        {(!qbAp?.has_data || showQbApPanel) && (
          <div className="px-6 py-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
              {/* file chooser */}
              <div className="flex-1">
                <label className="block text-xs font-sans font-medium text-gray-500 mb-1">QB AP Aging Excel file</label>
                <label className="flex items-center gap-2 cursor-pointer border border-dashed border-gray-300 rounded-lg px-4 py-3 hover:border-[#0E3B36] transition-colors">
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="text-sm text-gray-500 font-sans truncate">
                    {qbApFile ? qbApFile.name : 'Choose .xlsx file…'}
                  </span>
                  <input ref={qbApFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                    onChange={e => { setQbApFile(e.target.files?.[0] ?? null); setQbApPreview(null); }} />
                </label>
              </div>
              {/* date */}
              <div>
                <label className="block text-xs font-sans font-medium text-gray-500 mb-1">Report "As of" date</label>
                <input type="date" value={qbApDate} onChange={e => { setQbApDate(e.target.value); setQbApPreview(null); }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-[#0E3B36]" />
              </div>
              {/* preview button */}
              <button onClick={handleQbApPreview} disabled={!qbApFile || !qbApDate || qbApUploading}
                className="px-5 py-2.5 rounded-lg bg-[#0E3B36] text-white text-sm font-sans font-medium hover:bg-[#1A5249] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                {qbApUploading ? 'Parsing…' : 'Preview Import'}
              </button>
            </div>

            {/* error */}
            {qbApError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 font-sans">
                {qbApError}
              </div>
            )}

            {/* preview results */}
            {qbApPreview && (
              <div className="space-y-4">
                {/* stats strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Vendors parsed', val: qbApPreview.row_count, color: 'gray' },
                    { label: 'Matched existing', val: qbApPreview.matched_count, color: 'green' },
                    { label: 'Will be created', val: qbApPreview.seeded_count, color: qbApPreview.seeded_count > 0 ? 'amber' : 'gray' },
                    { label: 'Subtotals skipped', val: qbApPreview.skipped_subtotals, color: 'gray' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className={`rounded-xl border p-4 ${
                      color === 'green' ? 'bg-green-50 border-green-200' :
                      color === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                      <p className="text-xs font-sans text-gray-500">{label}</p>
                      <p className={`text-2xl font-bold font-mono mt-1 ${
                        color === 'green' ? 'text-green-800' :
                        color === 'amber' ? 'text-amber-800' : 'text-gray-800'}`}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* totals by bucket */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { label: 'Current', val: qbApPreview.portfolio_totals.current, color: 'green' },
                    { label: '1–30 days', val: qbApPreview.portfolio_totals.days_1_30, color: 'green' },
                    { label: '31–60 days', val: qbApPreview.portfolio_totals.days_31_60, color: 'amber' },
                    { label: '60+ days', val: qbApPreview.portfolio_totals.days_60_plus, color: 'red' },
                    { label: 'Total AP', val: qbApPreview.portfolio_totals.total, color: 'gray' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className={`rounded-xl border p-4 ${
                      color === 'green' ? 'bg-green-50 border-green-200' :
                      color === 'amber' ? 'bg-amber-50 border-amber-200' :
                      color === 'red'   ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                      <p className="text-xs font-sans text-gray-500">{label}</p>
                      <p className={`text-lg font-bold font-mono mt-1 ${
                        color === 'green' ? 'text-green-800' :
                        color === 'amber' ? 'text-amber-800' :
                        color === 'red'   ? 'text-red-800' : 'text-gray-800'}`}>{$$(val)}</p>
                    </div>
                  ))}
                </div>

                {/* vendors to be seeded */}
                {qbApPreview.seeded_count > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                    <p className="text-sm font-sans font-semibold text-amber-800 mb-2">
                      {qbApPreview.seeded_count} new vendor{qbApPreview.seeded_count > 1 ? 's' : ''} will be created in Vendor Registry
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {qbApPreview.vendors_to_seed.map(v => (
                        <span key={v} className="text-xs font-sans bg-amber-100 text-amber-800 border border-amber-300 rounded px-2 py-0.5">{v}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* credit rows warning */}
                {qbApPreview.credit_rows.length > 0 && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-sans text-blue-700">
                    {qbApPreview.credit_rows.length} vendor{qbApPreview.credit_rows.length > 1 ? 's have' : ' has'} credit balances (negative values). These will be imported as-is.
                  </div>
                )}

                {/* confirm / cancel */}
                <div className="flex gap-3">
                  <button onClick={handleQbApConfirm} disabled={qbApConfirming}
                    className="px-6 py-2.5 rounded-lg bg-[#0E3B36] text-white text-sm font-sans font-medium hover:bg-[#1A5249] disabled:opacity-40 transition-colors">
                    {qbApConfirming ? 'Saving…' : `Confirm & Save — ${qbApPreview.snapshot_month}`}
                  </button>
                  <button onClick={() => { setQbApPreview(null); setQbApFile(null); setQbApDate(''); if (qbApFileRef.current) qbApFileRef.current.value = ''; }}
                    className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-600 text-sm font-sans hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* KPI tiles — shown when data exists */}
        {qbAp?.has_data && qbAp.portfolio_totals && (
          <div className="px-6 pb-6 pt-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Overdue AP (30+)', val: qbAp.portfolio_totals.overdue, color: 'red' },
                { label: '31–60 days', val: qbAp.portfolio_totals.days_31_60, color: 'amber' },
                { label: '60+ days', val: qbAp.portfolio_totals.days_60_plus, color: 'red' },
                { label: 'Est. Days Payable Outstanding', val: qbAp.dpo_estimate != null ? `${Math.round(qbAp.dpo_estimate)}d` : '–', color: 'gray', raw: true },
              ].map(({ label, val, color, raw }) => (
                <div key={label} className={`rounded-xl border p-5 ${
                  color === 'red' ? 'bg-red-50 border-red-200' :
                  color === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="text-xs font-sans text-gray-500">{label}</p>
                  <p className={`text-2xl font-bold font-mono mt-1 ${
                    color === 'red' ? 'text-red-800' :
                    color === 'amber' ? 'text-amber-800' : 'text-gray-800'}`}>
                    {raw ? val : $$(val as number)}
                  </p>
                </div>
              ))}
            </div>

            {/* vendor table */}
            {qbAp.by_vendor.length > 0 && (
              <div>
                <p className="text-xs font-sans font-semibold uppercase tracking-wider text-gray-400 mb-2">By Vendor</p>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="min-w-full text-sm font-sans">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3 text-left">Vendor</th>
                        <th className="px-4 py-3 text-right">Overdue</th>
                        <th className="px-4 py-3 text-right">Total AP</th>
                        <th className="px-4 py-3 text-center">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {qbAp.by_vendor.map(v => (
                        <tr key={v.vendor_name} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-800">
                            {v.vendor_name}
                            {v.was_seeded && <span className="ml-2 text-xs text-amber-600">(new)</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-red-700">{v.overdue > 0 ? $$(v.overdue) : '–'}</td>
                          <td className="px-4 py-3 text-right font-mono text-gray-700">{$$(v.total)}</td>
                          <td className="px-4 py-3 text-center text-xs">
                            {v.has_credit && <span className="bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">credit</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Portfolio data note when not uploaded yet ─────────────────────── */}
      {!hasPortfolioData && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-sans text-amber-800">
          Portfolio AP data not uploaded yet — KPI tiles and charts will appear after uploading via <strong>Portfolio Upload</strong>. You can still upload QB AP Aging above independently.
        </div>
      )}

      {/* ══ SECTION 1 — KPI Cards ══════════════════════════════════════════ */}
      {hasPortfolioData && <>
      <div>
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-3">01 — Payables Summary</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-sans text-gray-500">Total Payable</p>
            <p className="text-2xl font-bold font-mono mt-1 text-gray-900">{$$(totalAP)}</p>
          </div>
          <div className="bg-green-50 rounded-xl border border-green-200 p-5">
            <p className="text-xs font-sans text-green-800">Current (0–30)</p>
            <p className="text-2xl font-bold font-mono mt-1 text-green-800">{$$(current + b130)}</p>
            <p className="text-xs font-sans text-green-800 mt-1">{pctStr(current + b130, totalAP)}</p>
          </div>
          <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
            <p className="text-xs font-sans text-amber-700">Due Soon (31–60)</p>
            <p className="text-2xl font-bold font-mono mt-1 text-amber-800">{$$(b3160)}</p>
            <p className="text-xs font-sans text-amber-600 mt-1">{pctStr(b3160, totalAP)}</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-5">
            <p className="text-xs font-sans text-red-700">Overdue (60+)</p>
            <p className="text-2xl font-bold font-mono mt-1 text-red-800">{$$(b60plus)}</p>
            <p className="text-xs font-sans text-red-700 mt-1">{pctStr(b60plus, totalAP)}</p>
          </div>
        </div>
      </div>

      {/* ══ SECTION 2 — Stacked bar chart ══════════════════════════════════ */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-1">02</p>
          <h2 className="text-xl font-bold text-gray-900">Payables Aging by Entity</h2>
          <p className="text-sm text-gray-400 font-sans mb-5">Tall red stacks = vendor relationship at risk</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: 'sans-serif' }} />
              <YAxis tick={{ fontSize: 10, fontFamily: 'monospace' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [$$(v)]} contentStyle={{ fontFamily: 'monospace', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontFamily: 'sans-serif', fontSize: 12 }} />
              <Bar dataKey="Current" stackId="a" fill="#16A34A" />
              <Bar dataKey="1–30"    stackId="a" fill="#CA8A04" />
              <Bar dataKey="31–60"   stackId="a" fill="#D97706" />
              <Bar dataKey="60+"     stackId="a" fill="#DC2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ══ SECTION 3 — Aging Detail Table ═════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">03</p>
          <h2 className="text-xl font-bold text-gray-900">AP Aging Detail</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="text-white text-xs" style={{ backgroundColor: '#F0EDE5' }}>
                <th className="px-4 py-2.5 text-left">Entity</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Current</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">1–30</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">31–60</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">60+</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap font-bold">Total AP</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">% Overdue</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Risk</th>
              </tr>
            </thead>
            <tbody>
              {arAp.map((r, i) => {
                const total   = apTotal(r);
                const overdue = r.ap_31_60 + r.ap_60_plus;
                const flag    = riskFlag(r);
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{r.entity_name}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{$$(r.ap_current)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{$$(r.ap_1_30)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${r.ap_31_60 > 0 ? 'text-amber-700 font-semibold' : ''}`}>{$$(r.ap_31_60)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${r.ap_60_plus > 0 ? 'text-red-700 font-bold' : ''}`}>{$$(r.ap_60_plus)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold">{$$(total)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${overdue > 0 ? 'text-red-700' : 'text-gray-400'}`}>{pctStr(overdue, total)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RISK_STYLE[flag]}`}>{flag}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-white font-bold" style={{ backgroundColor: '#F0EDE5' }}>
                <td className="px-4 py-2.5">Portfolio Total</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(current)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(b130)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(b3160)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(b60plus)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{$$(totalAP)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{pctStr(b3160 + b60plus, totalAP)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ══ SECTION 4 — Payment Action Board ═══════════════════════════════ */}
      <div className="space-y-5">
        <div>
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">04</p>
          <h2 className="text-xl font-bold text-gray-900">Payments — Action Required</h2>
        </div>

        {/* PAY IMMEDIATELY */}
        {payNow.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-sm font-bold text-red-800 mb-1 font-sans">🔴 PAY IMMEDIATELY</p>
            <p className="text-xs text-red-700 font-sans mb-3">60+ days overdue — vendor may stop service or initiate legal action</p>
            <div className="space-y-3">
              {payNow.map(r => {
                const key = `now-${r.entity_name}`;
                return (
                  <div key={key} className={`flex flex-col gap-2 p-3 rounded-lg bg-white border border-red-200 ${actioned.has(key) ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={actioned.has(key)} onChange={() => toggleAction(key)}
                        className="mt-0.5 h-4 w-4 rounded accent-red-600" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 font-sans">{r.entity_name}</p>
                        <p className="text-xs text-red-700 font-mono">{$$(r.ap_60_plus)} — 60+ days outstanding</p>
                      </div>
                      <button className="text-xs border border-red-300 text-red-700 px-2 py-0.5 rounded hover:bg-red-100 font-sans whitespace-nowrap">
                        Release Payment
                      </button>
                    </div>
                    <input type="text" placeholder="Notes…" value={notes[key] ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))}
                      className="text-xs border border-red-200 rounded px-2 py-1 font-sans" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PAY THIS WEEK */}
        {payWeekOnly.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-sm font-bold text-amber-800 mb-1 font-sans">🟡 PAY THIS WEEK</p>
            <p className="text-xs text-amber-700 font-sans mb-3">31–60 days — schedule payment and notify vendor</p>
            <div className="space-y-3">
              {payWeekOnly.map(r => {
                const key = `week-${r.entity_name}`;
                return (
                  <div key={key} className={`flex flex-col gap-2 p-3 rounded-lg bg-white border border-amber-200 ${actioned.has(key) ? 'opacity-50' : ''}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={actioned.has(key)} onChange={() => toggleAction(key)}
                        className="mt-0.5 h-4 w-4 rounded accent-amber-500" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900 font-sans">{r.entity_name}</p>
                        <p className="text-xs text-amber-700 font-mono">{$$(r.ap_31_60)} — 31–60 days outstanding</p>
                      </div>
                      <button className="text-xs border border-amber-300 text-amber-800 px-2 py-0.5 rounded hover:bg-amber-100 font-sans whitespace-nowrap">
                        Schedule Payment
                      </button>
                    </div>
                    <input type="text" placeholder="Notes…" value={notes[key] ?? ''}
                      onChange={e => setNotes(n => ({ ...n, [key]: e.target.value }))}
                      className="text-xs border border-amber-200 rounded px-2 py-1 font-sans" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {payNow.length === 0 && payWeekOnly.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="text-sm font-semibold text-green-800 font-sans">🟢 All payables are current — no urgent payments required</p>
          </div>
        )}
      </div>

      {/* ══ SECTION 5 — Strategic Metrics ══════════════════════════════════ */}
      <div>
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-3">05 — Strategic Metrics</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* DPO */}
          <div className={`rounded-xl border p-5 ${dpo > 60 ? 'bg-red-50 border-red-200' : dpo < 20 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
            <p className="text-xs font-sans text-gray-500">Days Payable Outstanding</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${dpo > 60 ? 'text-red-800' : dpo < 20 ? 'text-amber-800' : 'text-green-800'}`}>
              {dpo.toFixed(1)}d
            </p>
            <p className="text-xs font-sans mt-1 text-gray-400">
              {dpo < 20 ? '⚠ Paying too fast' : dpo <= 45 ? '✓ Healthy (30–45 target)' : '✗ Elevated — vendor risk'}
            </p>
          </div>

          {/* Vendor Concentration Risk */}
          {(() => {
            const maxAp = Math.max(...arAp.map(r => apTotal(r)), 0);
            const concPct = totalAP > 0 ? maxAp / totalAP : 0;
            const warn = concPct > 0.30;
            return (
              <div className={`rounded-xl border p-5 ${warn ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                <p className="text-xs font-sans text-gray-500">Vendor Concentration</p>
                <p className={`text-2xl font-bold font-mono mt-1 ${warn ? 'text-amber-800' : 'text-gray-900'}`}>
                  {(concPct * 100).toFixed(1)}%
                </p>
                <p className="text-xs font-sans mt-1 text-gray-400">
                  {warn ? '⚠ Top entity >30% of AP' : '✓ Diversified'}
                </p>
              </div>
            );
          })()}

          {/* Overdue ratio */}
          <div className={`rounded-xl border p-5 ${b60plus > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
            <p className="text-xs font-sans text-gray-500">Overdue Ratio (60+)</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${b60plus > 0 ? 'text-red-800' : 'text-gray-900'}`}>
              {pctStr(b60plus, totalAP)}
            </p>
            {b60plus > 0 && <p className="text-xs font-sans mt-1 text-red-700">⚠ Clear immediately</p>}
          </div>

          {/* Working Capital Impact */}
          <div className={`rounded-xl border p-5 ${nwc < 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            <p className="text-xs font-sans text-gray-500">Working Capital (AR−AP)</p>
            <p className={`text-2xl font-bold font-mono mt-1 ${nwc < 0 ? 'text-red-800' : 'text-green-800'}`}>
              {$$(nwc)}
            </p>
            <p className="text-xs font-sans mt-1 text-gray-400">{nwc >= 0 ? '✓ Positive' : '✗ AP exceeds AR'}</p>
          </div>
        </div>
      </div>

      {/* ══ SECTION 6 — Cash Flow Payment Planner ══════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-1">06</p>
        <h2 className="text-xl font-bold text-gray-900 mb-1">30/60/90 Day Payment Outlook</h2>
        <p className="text-sm text-gray-400 font-sans mb-5">Cash required to clear each aging bucket</p>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Current Due Now',    amount: current + b130,  color: 'bg-green-50 border-green-200',  text: 'text-green-800' },
            { label: 'Due in 31–60 Days',  amount: b3160,           color: 'bg-amber-50 border-amber-200',  text: 'text-amber-800' },
            { label: 'Overdue 60+ Days',   amount: b60plus,         color: 'bg-red-50 border-red-200',      text: 'text-red-800'   },
          ].map(col => (
            <div key={col.label} className={`rounded-xl border p-4 ${col.color}`}>
              <p className="text-xs font-sans text-gray-500 mb-2">{col.label}</p>
              <p className={`text-2xl font-bold font-mono ${col.text}`}>{$$(col.amount)}</p>
              <div className="mt-3 space-y-1">
                {arAp.filter(r => {
                  if (col.label.includes('Now'))   return (r.ap_current + r.ap_1_30) > 0;
                  if (col.label.includes('31'))    return r.ap_31_60 > 0;
                  return r.ap_60_plus > 0;
                }).map(r => (
                  <div key={r.entity_name} className="flex justify-between text-xs font-sans">
                    <span className="text-gray-600 truncate">{r.entity_name.split(' ')[0]}</span>
                    <span className="font-mono ml-2">
                      {col.label.includes('Now')  ? $$( r.ap_current + r.ap_1_30) :
                       col.label.includes('31')   ? $$(r.ap_31_60) :
                       $$(r.ap_60_plus)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="pt-4 border-t border-gray-100">
          <div className="flex justify-between items-center">
            <p className="text-sm font-sans text-gray-600">Cumulative 90-day cash requirement:</p>
            <p className="text-lg font-bold font-mono text-gray-900">{$$(totalAP)}</p>
          </div>
        </div>
      </div>

      {/* ══ SECTION 7 — AI AP Advisor ═══════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider mb-1">07</p>
        <h2 className="text-xl font-bold text-gray-900 mb-1">AP Strategic Advisor</h2>
        <p className="text-sm text-gray-400 font-sans mb-4">AI-generated analysis of your payables position</p>
        <button onClick={generateNarrative} disabled={generating}
          className="flex items-center gap-2 bg-[#0E3B36] text-white px-5 py-2 rounded-lg text-sm hover:bg-[#1A5249] disabled:opacity-50 font-sans mb-4">
          {generating
            ? <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
            : '⚡ Generate AP Strategy'}
        </button>
        {narrative && (
          <div className="bg-gray-900 rounded-xl p-5 overflow-x-auto">
            <pre className="text-green-300 text-xs leading-relaxed whitespace-pre-wrap font-mono">{narrative}</pre>
          </div>
        )}
      </div>

      {/* ══ SECTION 8 — AP Process Tracker ════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="text-xs font-sans font-semibold text-gray-400 uppercase tracking-wider">08</p>
          <h2 className="text-xl font-bold text-gray-900">Payment Process — by Entity</h2>
          <p className="text-sm text-gray-400 font-sans mt-0.5">Track invoice approval and payment stage</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="bg-gray-100 text-gray-600 text-xs">
                <th className="px-4 py-2.5 text-left">Entity</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">AP Balance</th>
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Payment Stage</th>
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Notes</th>
              </tr>
            </thead>
            <tbody>
              {arAp.map((r, i) => {
                const total = apTotal(r);
                const stage = stages[r.entity_name] ?? 1;
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{r.entity_name}</td>
                    <td className="px-4 py-3 text-right font-mono">{$$(total)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={stage}
                        onChange={e => setStages(s => ({ ...s, [r.entity_name]: Number(e.target.value) as Stage }))}
                        className={`text-xs border rounded px-2 py-1 min-w-[210px] font-sans ${stageColor(stage)}`}
                      >
                        {(Object.entries(STAGE_LABELS) as [string, string][]).map(([v, lbl]) => (
                          <option key={v} value={v}>{lbl}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input type="text" placeholder="Notes…"
                        value={notes[`proc-${r.entity_name}`] ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [`proc-${r.entity_name}`]: e.target.value }))}
                        className="text-xs border rounded px-2 py-1 w-full font-sans" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      </>}

    </div>
  );
}
