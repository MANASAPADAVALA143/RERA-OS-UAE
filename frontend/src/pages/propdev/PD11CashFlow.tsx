import { useState, useRef } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { AlertTriangle, CheckCircle2, TrendingUp, Phone, ChevronDown, ChevronUp } from 'lucide-react';
import PropDevPageHeader from '../../components/propdev/PropDevPageHeader';

const fmt = (n: number) => n < 0 ? `($${Math.abs(Math.round(n)).toLocaleString()})` : `$${Math.round(n).toLocaleString()}`;
const fmtAbs = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString()}`;

// ── CEO Cash Today box ──────────────────────────────────────────────────────

function CashTodayBox({ cash, monthlyEmi, nextOutflow }: { cash: number; monthlyEmi: number; nextOutflow: string }) {
  const runway = monthlyEmi > 0 ? cash / monthlyEmi : 99;
  const status = runway < 1.5 ? 'critical' : runway < 3 ? 'watch' : 'safe';

  const config = {
    critical: { border: 'border-red-300',   bg: 'bg-red-50',   textMain: 'text-red-700',   icon: <AlertTriangle size={24} className="text-red-500" />,  label: '⚠️ CRITICAL'  },
    watch:    { border: 'border-amber-300', bg: 'bg-amber-50', textMain: 'text-amber-700', icon: <AlertTriangle size={24} className="text-amber-500" />, label: '⚡ WATCH'     },
    safe:     { border: 'border-green-300', bg: 'bg-green-50', textMain: 'text-green-700', icon: <CheckCircle2  size={24} className="text-green-500" />, label: '✓ SAFE'       },
  }[status];

  return (
    <div className={`rounded-2xl border-2 ${config.border} ${config.bg} p-6`}>
      <div className="flex items-center gap-3 mb-4">
        {config.icon}
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Cash Available Today</p>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white border ${config.border} ${config.textMain}`}>{config.label}</span>
        </div>
      </div>
      <p className={`text-4xl font-black ${config.textMain}`}>{fmtAbs(cash)}</p>
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-gray-500">Cash Runway</p>
          <p className={`text-xl font-bold ${config.textMain}`}>{runway.toFixed(1)} months</p>
          <p className="text-xs text-gray-400">at current EMI rate</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Next Major Outflow</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5">{nextOutflow}</p>
        </div>
      </div>
    </div>
  );
}

// ── 30/60/90-day Forward Panel (with expandable call breakdown) ──────────────

function ForwardPanel({ label, collections, emi, calls, distributions, callBreakdown }: {
  label: string;
  collections: number;
  emi: number;
  calls: number;
  distributions: number;
  callBreakdown?: { name: string; amount: number }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const net = collections - emi - calls - distributions;
  const hasBreakdown = callBreakdown && callBreakdown.length > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-blue-700 mb-3">{label}</p>
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">+ Collections</span>
          <span className="font-semibold text-green-700">{fmtAbs(collections)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">- EMI Payments</span>
          <span className="font-semibold text-red-600">{fmtAbs(emi)}</span>
        </div>

        {/* Capital Calls — expandable breakdown */}
        <div>
          <div className="flex justify-between text-sm items-center">
            <button
              onClick={() => hasBreakdown && setExpanded(e => !e)}
              className={`flex items-center gap-1 text-gray-600 ${hasBreakdown ? 'hover:text-gray-900 cursor-pointer' : 'cursor-default'}`}
            >
              - Capital Calls
              {hasBreakdown && (expanded ? <ChevronUp size={11} className="text-gray-400" /> : <ChevronDown size={11} className="text-gray-400" />)}
            </button>
            <span className="font-semibold text-red-600">{fmtAbs(calls)}</span>
          </div>
          {expanded && hasBreakdown && (
            <div className="ml-3 mt-1.5 space-y-1 border-l-2 border-red-100 pl-2.5">
              {callBreakdown!.map(b => (
                <div key={b.name} className="flex justify-between text-xs">
                  <span className="text-gray-400">↳ {b.name}</span>
                  <span className="text-red-400 font-medium">{fmtAbs(b.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-600">- Distributions</span>
          <span className="font-semibold text-amber-600">{fmtAbs(distributions)}</span>
        </div>
        <div className="pt-2 border-t border-gray-100 flex justify-between text-sm font-bold">
          <span>= NET</span>
          <span className={net >= 0 ? 'text-green-700' : 'text-red-600'}>{fmt(net)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Capital Call Timeline ─────────────────────────────────────────────────────

interface TLEvent {
  type: 'call' | 'emi' | 'collection';
  pct: number;
  label: string;
  amount: number;
}

function CallTimeline({ events }: { events: TLEvent[] }) {
  if (events.length === 0) return null;

  const colors: Record<TLEvent['type'], { dot: string; text: string; label: string }> = {
    call:       { dot: 'bg-red-500',    text: 'text-red-600',    label: 'Capital Calls'  },
    emi:        { dot: 'bg-orange-400', text: 'text-orange-600', label: 'EMI Payments'   },
    collection: { dot: 'bg-green-500',  text: 'text-green-600',  label: 'Collections'    },
  };

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs text-gray-600">
        {(['call','emi','collection'] as const).map(t => (
          <span key={t} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full inline-block ${colors[t].dot}`} />
            {colors[t].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-blue-500" />
          Today
        </span>
      </div>

      {/* Timeline bar */}
      <div className="relative h-16 select-none">
        <div className="absolute top-5 left-4 right-4 h-0.5 bg-gray-200 rounded-full" />

        {/* Tick marks at 0, 30, 60, 90 */}
        {[{ pct: 0, lbl: 'Today' }, { pct: 33.3, lbl: '+30d' }, { pct: 66.6, lbl: '+60d' }, { pct: 100, lbl: '+90d' }].map(({ pct, lbl }) => (
          <div
            key={lbl}
            style={{ position: 'absolute', left: `calc(1rem + ${pct}% * (100% - 2rem) / 100)`, top: '10px', transform: 'translateX(-50%)' }}
          >
            <div className="w-px h-3 bg-gray-300 mx-auto" />
            <p className="text-xs text-gray-400 text-center mt-1 whitespace-nowrap">{lbl}</p>
          </div>
        ))}

        {/* Today blue marker */}
        <div style={{ position: 'absolute', left: 'calc(1rem)', top: '10px', transform: 'translateX(-50%)' }}>
          <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
        </div>

        {/* Event dots */}
        {events.map((e, i) => {
          const left = `calc(1rem + ${Math.min(98, Math.max(2, e.pct))}% * (100% - 2rem) / 100)`;
          return (
            <div
              key={i}
              style={{ position: 'absolute', left, top: '10px', transform: 'translateX(-50%)' }}
              title={`${e.label}: ${fmtAbs(e.amount)}`}
            >
              <div className={`w-3 h-3 rounded-full border-2 border-white shadow-sm ${colors[e.type].dot}`} />
            </div>
          );
        })}
      </div>

      {/* Event list below */}
      {events.filter(e => e.type === 'call').length > 0 && (
        <div className="mt-2 space-y-1">
          {events.filter(e => e.type === 'call').map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <span>{e.label} — {fmtAbs(e.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD11CashFlow() {
  const { properties, lots, loans, expenses, customers, capitalCalls, partners, companies } = usePropDev();
  const { setTab } = usePropDevNav();
  const capitalCallRef = useRef<HTMLDivElement>(null);

  const p = properties[0];

  const monthlyRevenue = p.monthlyData;
  const fixedMonthlyExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const monthlyCashFlow = monthlyRevenue.map(m => ({
    month: m.month,
    inflow: m.revenue,
    outflow: fixedMonthlyExpense,
    net: m.revenue - fixedMonthlyExpense,
  }));

  const totalRevenue = lots.filter(l => l.status === 'sold').reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalEMI = loans.reduce((s, l) => s + l.emi * 6, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0) * 6;
  const partnerContributions = partners.reduce((s, p) => s + p.capitalContributed, 0);
  const distributions = partners.reduce((s, p) => s + p.distributionsReceived, 0);

  const operatingCF = totalRevenue - totalExpenses;
  const financingCF = partnerContributions - totalEMI - distributions;
  const netCF = operatingCF + financingCF;

  const customerCollections = customers.reduce((s, c) => s + c.collected, 0);
  const monthlyEmi = loans.reduce((s, l) => s + l.emi, 0);
  const pendingCalls = capitalCalls.filter(c => c.status !== 'Paid').reduce((s, c) => s + c.totalDue - c.received, 0);

  const nextOutflow = monthlyEmi > 0
    ? `${fmt(monthlyEmi)}/month EMI (${loans.filter(l=>l.status==='Active')[0]?.emiDate ?? 15}th)`
    : 'No active loans';

  // 30/60/90-day projections
  const mo30Collections = customerCollections * 0.15;
  const mo60Collections = customerCollections * 0.30;
  const mo90Collections = customerCollections * 0.50;

  // ── Per-partner call breakdown for forward panels ─────────────────────────
  const partnerCallMap = new Map<string, number>();
  capitalCalls.filter(c => c.status !== 'Paid').forEach(call => {
    const amount = call.totalDue - call.received;
    partnerCallMap.set(call.partnerName, (partnerCallMap.get(call.partnerName) ?? 0) + amount);
  });
  const partnerBreakdown = Array.from(partnerCallMap.entries()).map(([name, total]) => ({ name, total }));
  const bd30 = partnerBreakdown.map(({ name, total }) => ({ name, amount: total * 0.2 }));
  const bd60 = partnerBreakdown.map(({ name, total }) => ({ name, amount: total * 0.4 }));
  const bd90 = partnerBreakdown.map(({ name, total }) => ({ name, amount: total * 0.6 }));

  // ── Build pending call rows (one per call, per company) ───────────────────
  const today = new Date();
  const todayMs = today.getTime();
  const end90Ms = todayMs + 90 * 24 * 60 * 60 * 1000;

  const dayPct = (dateStr: string) => {
    const ms = new Date(dateStr).getTime();
    return ((Math.min(Math.max(ms, todayMs), end90Ms) - todayMs) / (end90Ms - todayMs)) * 100;
  };

  const pendingCallRows = companies.flatMap((company, ci) => {
    const monthlyEmiC = company.loans.reduce((s, l) => l.status === 'Active' ? s + l.emi : s, 0);
    let running = company.property.cashAvailable;
    return company.capitalCalls
      .filter(c => c.status !== 'Paid')
      .map((call, i) => {
        const amount = call.totalDue - call.received;
        const partner = company.partners.find(pp => pp.id === call.partnerId);
        const cashBefore = running;
        const cashAfter = running - amount;
        const monthsCoverage = monthlyEmiC > 0 ? Math.max(0, cashAfter) / monthlyEmiC : 99;
        running = cashAfter;
        const dueDate = call.dueDate ?? (() => {
          const d = new Date(today);
          d.setDate(d.getDate() + 7 + ci * 25 + i * 15);
          return d.toISOString().split('T')[0];
        })();
        return { company: company.name, partner: call.partnerName, type: partner?.type ?? 'Class A', amount, dueDate, cashBefore, cashAfter, monthsCoverage, status: call.status };
      });
  });

  // ── Portfolio-wide totals after all calls ─────────────────────────────────
  const portfolioCash = companies.reduce((s, c) => s + c.property.cashAvailable, 0);
  const totalPendingDue = pendingCallRows.reduce((s, r) => s + r.amount, 0);
  const portfolioMonthlyEMI = companies.reduce((s, c) => s + c.loans.reduce((ls, l) => l.status === 'Active' ? ls + l.emi : ls, 0), 0);
  const cashAfterAllCalls = portfolioCash - totalPendingDue;
  const coverageAfterCalls = portfolioMonthlyEMI > 0 ? Math.max(0, cashAfterAllCalls) / portfolioMonthlyEMI : 99;

  // ── Pending calls KPI extras ──────────────────────────────────────────────
  const numPendingCalls = pendingCallRows.length;
  const numPartners = new Set(pendingCallRows.map(r => r.partner)).size;
  const sortedByDate = [...pendingCallRows].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nextDueDate = sortedByDate[0]?.dueDate ?? 'TBD';
  const nextDueFmt = nextDueDate !== 'TBD'
    ? new Date(nextDueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'TBD';

  // ── Timeline events ───────────────────────────────────────────────────────
  const timelineEvents: TLEvent[] = [
    ...pendingCallRows.map(r => ({
      type: 'call' as const,
      pct: dayPct(r.dueDate),
      label: `${r.partner} (${r.company})`,
      amount: r.amount,
    })),
    ...[1, 2, 3].map(m => {
      const d = new Date(today);
      d.setMonth(d.getMonth() + m);
      d.setDate(loans.find(l => l.status === 'Active')?.emiDate ?? 15);
      return { type: 'emi' as const, pct: dayPct(d.toISOString().split('T')[0]), label: `EMI Month +${m}`, amount: monthlyEmi };
    }),
    ...customers.flatMap(c =>
      c.installments
        .filter(i => (i.status === 'pending' || i.status === 'overdue') && new Date(i.dueDate).getTime() <= end90Ms)
        .map(i => ({ type: 'collection' as const, pct: dayPct(i.dueDate), label: c.name, amount: i.amount }))
    ),
  ];

  // ── Coverage color helpers ────────────────────────────────────────────────
  const coverageColor = (mo: number) =>
    mo >= 6 ? 'text-green-700' : mo >= 3 ? 'text-amber-600' : 'text-red-600';
  const cashAfterColor = (mo: number) =>
    mo >= 6 ? 'text-green-700' : mo >= 3 ? 'text-amber-600' : 'text-red-600';

  const lowestCoverage = pendingCallRows.reduce((min, r) => Math.min(min, r.monthsCoverage), Infinity);
  const showIssueCallAlert = pendingCallRows.length > 0 && lowestCoverage < 3;
  const recommendedCall = showIssueCallAlert
    ? Math.round((3 - lowestCoverage) * portfolioMonthlyEMI)
    : 0;

  return (
    <div className="space-y-6">
      <PropDevPageHeader title="Cash Flow" subtitle="30/60/90-day forward view + runway indicator" />

      {/* CEO Cash Today */}
      <CashTodayBox cash={p.cashAvailable} monthlyEmi={monthlyEmi} nextOutflow={nextOutflow} />

      {/* 30/60/90-day Forward View */}
      <div>
        <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-blue-600" />
          Forward Cash Flow Projection
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ForwardPanel
            label="Next 30 Days"
            collections={mo30Collections}
            emi={monthlyEmi}
            calls={pendingCalls * 0.2}
            distributions={0}
            callBreakdown={bd30}
          />
          <ForwardPanel
            label="Next 60 Days"
            collections={mo60Collections}
            emi={monthlyEmi * 2}
            calls={pendingCalls * 0.4}
            distributions={distributions * 0.1}
            callBreakdown={bd60}
          />
          <ForwardPanel
            label="Next 90 Days"
            collections={mo90Collections}
            emi={monthlyEmi * 3}
            calls={pendingCalls * 0.6}
            distributions={distributions * 0.2}
            callBreakdown={bd90}
          />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CAPITAL CALL CASH IMPACT — NEW SECTION
      ══════════════════════════════════════════════════════════════════════ */}
      <div ref={capitalCallRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Section header */}
        <div className="bg-blue-900 text-white px-5 py-4">
          <div className="flex items-center gap-2">
            <Phone size={18} />
            <h3 className="font-bold text-base">Capital Call Cash Impact</h3>
          </div>
          <p className="text-blue-200 text-xs mt-0.5">Upcoming capital calls and cash position after each call</p>
        </div>

        <div className="p-5 space-y-6">

          {/* Pending Calls Table */}
          {pendingCallRows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No pending capital calls.</p>
          ) : (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Pending Calls</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">Company</th>
                      <th className="px-3 py-2 text-left">Partner</th>
                      <th className="px-3 py-2 text-center">Type</th>
                      <th className="px-3 py-2 text-right">Call Amount</th>
                      <th className="px-3 py-2 text-center">Due Date</th>
                      <th className="px-3 py-2 text-right">Cash Before</th>
                      <th className="px-3 py-2 text-right">Cash After</th>
                      <th className="px-3 py-2 text-right">Coverage</th>
                      <th className="px-3 py-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCallRows.map((row, i) => (
                      <tr key={i} className={`border-t border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}>
                        <td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">{row.company}</td>
                        <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{row.partner}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            row.type === 'Class A' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {row.type === 'Class A' ? 'Type A' : 'Type B'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-red-600">{fmtAbs(row.amount)}</td>
                        <td className="px-3 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {new Date(row.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{fmtAbs(row.cashBefore)}</td>
                        <td className={`px-3 py-2.5 text-right font-semibold ${cashAfterColor(row.monthsCoverage)}`}>
                          {fmtAbs(row.cashAfter)}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-semibold ${coverageColor(row.monthsCoverage)}`}>
                          {row.monthsCoverage >= 99 ? '∞' : `${row.monthsCoverage.toFixed(1)} mo`}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.status === 'Overdue'     ? 'bg-red-100 text-red-700'    :
                            row.status === 'Partial'     ? 'bg-amber-100 text-amber-700' :
                            row.status === 'Outstanding' ? 'bg-blue-100 text-blue-700'   :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Capital Call Timeline */}
          {timelineEvents.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">90-Day Cash Event Timeline</h4>
              <p className="text-xs text-gray-400 mb-3">Hover over dots to see details. Red = capital calls · Orange = EMI · Green = customer collections</p>
              <CallTimeline events={timelineEvents} />
            </div>
          )}

          {/* Cash After All Calls — Summary Card */}
          <div className={`rounded-xl border-2 p-4 ${
            coverageAfterCalls >= 6 ? 'border-green-200 bg-green-50' :
            coverageAfterCalls >= 3 ? 'border-amber-200 bg-amber-50' :
            'border-red-200 bg-red-50'
          }`}>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">After All Pending Capital Calls</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500">Total Calls Due</p>
                <p className="text-lg font-bold text-red-600">{fmtAbs(totalPendingDue)}</p>
                <p className="text-xs text-gray-400">{numPendingCalls} call{numPendingCalls !== 1 ? 's' : ''} from {numPartners} partner{numPartners !== 1 ? 's' : ''}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Portfolio Cash Available</p>
                <p className="text-lg font-bold text-gray-800">{fmtAbs(portfolioCash)}</p>
                <p className="text-xs text-gray-400">across all companies</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Cash Remaining</p>
                <p className={`text-lg font-bold ${cashAfterColor(coverageAfterCalls)}`}>{fmtAbs(cashAfterAllCalls)}</p>
                <p className="text-xs text-gray-400">after all calls settled</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Coverage</p>
                <p className={`text-lg font-bold ${coverageColor(coverageAfterCalls)}`}>
                  {coverageAfterCalls >= 99 ? '∞' : `${coverageAfterCalls.toFixed(1)} months`}
                  {' '}
                  {coverageAfterCalls >= 6 ? '✅' : coverageAfterCalls >= 3 ? '⚠️' : '🔴'}
                </p>
                <p className={`text-xs font-medium mt-0.5 ${coverageColor(coverageAfterCalls)}`}>
                  {coverageAfterCalls >= 6 ? 'Position adequate' :
                   coverageAfterCalls >= 3 ? 'Monitor closely' :
                   'Action required'}
                </p>
              </div>
            </div>
          </div>

          {/* Issue Capital Call Alert */}
          {showIssueCallAlert && (
            <div className="flex items-start gap-4 p-4 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">
                  🔴 Cash coverage drops to {lowestCoverage.toFixed(1)} months after pending calls.
                </p>
                <p className="text-sm text-red-700 mt-1">
                  Consider issuing a capital call to replenish reserves. Recommended amount to reach 3-month buffer:{' '}
                  <span className="font-bold">{fmtAbs(recommendedCall)}</span>
                </p>
              </div>
              <button
                onClick={() => setTab('capital-calls')}
                className="shrink-0 flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
              >
                <Phone size={13} /> Issue Capital Call →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPIs — 5 cards (4 existing updated + 1 new) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Inflows</p>
          <p className="text-xl font-bold text-green-700">{fmtAbs(totalRevenue + partnerContributions)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Outflows</p>
          <p className="text-xl font-bold text-red-600">{fmtAbs(totalExpenses + totalEMI + distributions)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Cash Flow</p>
          <p className={`text-xl font-bold ${netCF >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmtAbs(netCF)}</p>
        </div>
        {/* Pending Calls — updated, clickable */}
        <button
          onClick={() => capitalCallRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="bg-white rounded-xl border border-amber-200 p-4 text-left hover:bg-amber-50 transition-colors"
        >
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Pending Calls</p>
          <p className={`text-xl font-bold ${pendingCalls > 0 ? 'text-amber-700' : 'text-green-600'}`}>{fmtAbs(pendingCalls)}</p>
          {numPendingCalls > 0 && (
            <>
              <p className="text-xs text-gray-400 mt-1">{numPendingCalls} call{numPendingCalls !== 1 ? 's' : ''} from {numPartners} partner{numPartners !== 1 ? 's' : ''}</p>
              <p className="text-xs text-amber-600 font-medium">Next due: {nextDueFmt}</p>
            </>
          )}
        </button>
        {/* NEW: Cash After Calls */}
        <div className={`rounded-xl border p-4 ${
          coverageAfterCalls >= 6 ? 'border-green-200 bg-green-50' :
          coverageAfterCalls >= 3 ? 'border-amber-200 bg-amber-50' :
          'border-red-200 bg-red-50'
        }`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Cash After Calls</p>
          <p className={`text-xl font-bold ${cashAfterColor(coverageAfterCalls)}`}>{fmtAbs(cashAfterAllCalls)}</p>
          <p className={`text-xs font-medium mt-1 ${coverageColor(coverageAfterCalls)}`}>
            {coverageAfterCalls >= 99 ? '∞' : `${coverageAfterCalls.toFixed(1)} mo`} coverage
          </p>
        </div>
      </div>

      {/* Monthly Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-800 mb-4">Monthly Cash Flow (6-Month View)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyCashFlow} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(Math.abs(v)/1000).toFixed(0)}K`} />
            <Tooltip formatter={(v: number) => [`$${Math.abs(v).toLocaleString()}`, '']} />
            <Legend />
            <Bar dataKey="inflow"  name="Inflow"  fill="#16A34A" radius={[4,4,0,0]} barSize={24} />
            <Bar dataKey="outflow" name="Outflow" fill="#DC2626" radius={[4,4,0,0]} barSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Historical CF Statement — shows when real yearly data exists */}
      {p?.yearlyCF && (() => {
        const cfYears = Object.keys(p.yearlyCF).sort();
        return (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(212,175,55,0.25)' }}>
            <div className="px-4 py-2 flex items-center gap-2 border-b" style={{ background: '#EEF0FF', borderColor: 'rgba(212,175,55,0.20)' }}>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Historical Cash Flow Statement · {p.name} · {cfYears[0]}–{cfYears[cfYears.length - 1]}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: '#F7F5F0' }}>
                    <th className="px-4 py-2 text-left text-gray-500 font-medium">Activity</th>
                    {cfYears.map(y => <th key={y} className="px-3 py-2 text-right text-gray-500 font-medium">{y}</th>)}
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {([
                    { label: 'Operating Activities', key: 'operating' as const, bold: false },
                    { label: 'Investing Activities',  key: 'investing'  as const, bold: false },
                    { label: 'Financing Activities',  key: 'financing'  as const, bold: false },
                    { label: 'Net Cash Change',       key: 'net_change' as const, bold: true  },
                  ] as const).map(({ label, key, bold }) => {
                    const total = cfYears.reduce((s, y) => s + (p.yearlyCF![y]?.[key] ?? 0), 0);
                    return (
                      <tr key={label} className={bold ? 'font-bold' : ''} style={bold ? { background: '#EEF0FF' } : {}}>
                        <td className="px-4 py-1.5 text-gray-700">{label}</td>
                        {cfYears.map(y => {
                          const v = p.yearlyCF![y]?.[key] ?? 0;
                          return (
                            <td key={y} className={`px-3 py-1.5 text-right font-mono ${v >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              {v === 0 ? '—' : v >= 0 ? `$${v.toLocaleString('en-US',{maximumFractionDigits:0})}` : `($${Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:0})})`}
                            </td>
                          );
                        })}
                        <td className={`px-3 py-1.5 text-right font-mono font-semibold ${total >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          {total >= 0 ? `$${total.toLocaleString('en-US',{maximumFractionDigits:0})}` : `($${Math.abs(total).toLocaleString('en-US',{maximumFractionDigits:0})})`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* CF Waterfall Chart */}
            <div className="p-4 border-t" style={{ borderColor: 'rgba(212,175,55,0.15)' }}>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Annual Cash Flows</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={cfYears.map(y => ({
                  year: y,
                  operating: p.yearlyCF![y]?.operating ?? 0,
                  investing: p.yearlyCF![y]?.investing ?? 0,
                  financing: p.yearlyCF![y]?.financing ?? 0,
                }))} barSize={18}>
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v >= 0 ? `$${(v/1000).toFixed(0)}K` : `($${(-v/1000).toFixed(0)}K)`} />
                  <Tooltip formatter={(v: number, name: string) => [
                    v >= 0 ? `$${v.toLocaleString()}` : `($${Math.abs(v).toLocaleString()})`,
                    name.charAt(0).toUpperCase() + name.slice(1),
                  ]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="operating" fill="#059669" radius={[2,2,0,0]} />
                  <Bar dataKey="investing"  fill="#DC2626" radius={[2,2,0,0]} />
                  <Bar dataKey="financing"  fill="#2563EB" radius={[2,2,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Cash Flow Statement */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-5 py-3 text-left text-xs uppercase text-gray-500">Particulars</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Amount</th>
                <th className="px-5 py-3 text-right text-xs uppercase text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-blue-900 text-white">
                <td className="px-5 py-2.5 font-bold" colSpan={3}>A. OPERATING ACTIVITIES</td>
              </tr>
              {[
                { label: 'Property Sale Receipts',                amount: totalRevenue,          note: `${lots.filter(l=>l.status==='sold').length} propert${lots.filter(l=>l.status==='sold').length !== 1 ? 'ies' : 'y'} sold` },
                { label: 'Customer Installments Collected', amount: customerCollections,   note: 'Per installment schedule'  },
                { label: 'Operating Expenses',              amount: -totalExpenses,         note: '6 months admin + tax'      },
              ].map(({ label, amount, note }) => (
                <tr key={label} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 pl-10 text-gray-700">{label}</td>
                  <td className={`px-5 py-3 text-right font-medium ${amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(amount)}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">{note}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-3 font-semibold">Net Operating Cash Flow</td>
                <td className={`px-5 py-3 text-right font-bold ${operatingCF >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(operatingCF)}</td>
                <td />
              </tr>

              <tr className="bg-blue-900 text-white">
                <td className="px-5 py-2.5 font-bold" colSpan={3}>B. FINANCING ACTIVITIES</td>
              </tr>
              {[
                { label: 'Partner Capital Contributions', amount: partnerContributions,        note: `${partners.length} partners`      },
                { label: 'Loan EMI Payments (6 months)', amount: -totalEMI,                   note: `${loans.filter(l=>l.status==='Active').length} active loans` },
                { label: 'Distributions to Partners',    amount: -distributions,              note: 'Already paid out'                 },
                { label: 'Capital Calls Pending',        amount: -pendingCalls,               note: 'Outstanding obligations'          },
              ].map(({ label, amount, note }) => (
                <tr key={label} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 pl-10 text-gray-700">{label}</td>
                  <td className={`px-5 py-3 text-right font-medium ${amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(amount)}</td>
                  <td className="px-5 py-3 text-right text-xs text-gray-400">{note}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 border-t border-gray-200">
                <td className="px-5 py-3 font-semibold">Net Financing Cash Flow</td>
                <td className={`px-5 py-3 text-right font-bold ${financingCF >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(financingCF)}</td>
                <td />
              </tr>
            </tbody>
            <tfoot>
              <tr className="bg-gray-900 text-white">
                <td className="px-5 py-4 font-bold text-base">NET CASH FLOW  (A + B)</td>
                <td className={`px-5 py-4 text-right font-bold text-lg ${netCF >= 0 ? 'text-green-300' : 'text-red-300'}`}>{fmt(netCF)}</td>
                <td />
              </tr>
              <tr className="bg-gray-800 text-white">
                <td className="px-5 py-3 text-sm">Cash Available on Hand</td>
                <td className="px-5 py-3 text-right font-semibold text-blue-300">{fmtAbs(p.cashAvailable)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Expense Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Recurring Expense Breakdown (Monthly)</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {expenses.map(e => (
            <div key={e.particulars} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-gray-50">
              <div>
                <span className="font-medium text-gray-900">{e.particulars}</span>
                <span className="ml-2 px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{e.category}</span>
              </div>
              <span className="font-semibold text-gray-700">${e.amount.toLocaleString()}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50">
            <span className="font-bold text-gray-900">Total Monthly Expenses</span>
            <span className="font-bold text-red-600">{fmtAbs(expenses.reduce((s,e) => s+e.amount, 0))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
