import { useMemo, useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { Partner, CapitalCall, CompanyData } from '../../contexts/PropertyDevContext';
import {
  Treemap, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Legend,
  ComposedChart, Line, CartesianGrid, Cell,
} from 'recharts';
import { Calculator, FileText, Search, Download, Zap } from 'lucide-react';

const COLORS = ['#2563EB', '#16A34A', '#D97706', '#7C3AED', '#DC2626', '#0891B2', '#BE185D', '#047857'];
const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtK = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : fmt(n);
const pct = (n: number) => `${n.toFixed(1)}%`;

// -- Types & aggregation -------------------------------------------------------

interface PartnerSummary {
  name: string;
  instances: Partner[];
  totalCapital: number;
  totalDistributed: number;
  totalProfit: number;
  totalPending: number;
  roi: number;
  overdue: number;
  avgEquity: number;
  avgPref: number;
  partnerType: string;
  status: 'Active' | 'Exited';
  primaryCompany: string;
  indicator: 'good' | 'overdue' | 'nodist';
}

interface OwnershipEvent {
  date: string; event: string; sharePct: number;
  capital: number; cumulative: number; notes: string;
}

interface TxRecord {
  date: string;
  type: string; company: string; amount: number;
  cumulativeCapital: number; profitShare: number; status: string; notes: string;
}

type SortKey = 'name' | 'capital' | 'roi';

function aggregatePartners(
  partners: Partner[],
  allCalls: CapitalCall[],
  companiesMap: Record<string, CompanyData>,
): PartnerSummary[] {
  const byName = new Map<string, Partner[]>();
  partners.forEach(p => {
    const arr = byName.get(p.name) ?? [];
    arr.push(p);
    byName.set(p.name, arr);
  });

  return [...byName.entries()].map(([name, instances]) => {
    const totalCapital = instances.reduce((s, p) => s + p.capitalContributed, 0);
    const totalDistributed = instances.reduce((s, p) => s + p.distributionsReceived, 0);
    const totalProfit = instances.reduce((s, p) => s + p.shareOfProfit, 0);
    const totalPending = instances.reduce(
      (s, p) => s + Math.max(0, p.capitalContributed + p.shareOfProfit - p.distributionsReceived), 0,
    );
    const roi = totalCapital > 0 ? (totalProfit / totalCapital) * 100 : 0;
    const instanceIds = new Set(instances.map(p => p.id));
    const overdue = allCalls
      .filter(c => instanceIds.has(c.partnerId) && (c.status === 'Overdue' || c.status === 'Partial'))
      .reduce((s, c) => s + (c.totalDue - c.received), 0);
    const indicator: PartnerSummary['indicator'] =
      overdue > 0 ? 'overdue' : totalDistributed === 0 ? 'nodist' : 'good';
    return {
      name,
      instances,
      totalCapital,
      totalDistributed,
      totalProfit,
      totalPending,
      roi,
      overdue,
      avgEquity: instances.reduce((s, p) => s + p.sharePercent, 0) / instances.length,
      avgPref: instances.reduce((s, p) => s + p.preferredReturn, 0) / instances.length,
      partnerType: instances[0]?.type ?? 'Class A',
      status: instances[0]?.status ?? 'Active',
      primaryCompany: companiesMap[instances[0]?.companyId]?.name ?? '',
      indicator,
    };
  });
}

function roiFill(roi: number, overdue: number): string {
  if (overdue > 0) return '#DC2626';
  if (roi >= 25) return '#14532D';
  if (roi >= 15) return '#16A34A';
  if (roi >= 8) return '#D97706';
  return '#F59E0B';
}

// -- History builders (unchanged logic) -----------------------------------------

function buildOwnershipHistory(
  instances: Partner[], allCalls: CapitalCall[], companiesMap: Record<string, CompanyData>,
): OwnershipEvent[] {
  const events: OwnershipEvent[] = [];
  let cumulative = 0;
  instances.forEach(p => {
    const companyName = companiesMap[p.companyId]?.name ?? p.companyId;
    cumulative += p.capitalContributed;
    events.push({ date: '2024-01-15', event: 'Initial Contribution', sharePct: p.sharePercent, capital: p.capitalContributed, cumulative, notes: `Initial equity · ${companyName}` });
    allCalls.filter(c => c.partnerId === p.id && c.received > 0).forEach(c => {
      cumulative += c.received;
      events.push({ date: c.receivedDate ?? '2025-02-10', event: 'Capital Call Payment', sharePct: p.sharePercent, capital: c.received, cumulative, notes: `${c.period}${c.status === 'Partial' ? ' (partial)' : ''}` });
    });
    if (p.distributionsReceived > 0) {
      events.push({ date: '2025-05-15', event: 'Distribution Received', sharePct: p.sharePercent, capital: -p.distributionsReceived, cumulative, notes: 'Profit / preferred distribution' });
    }
  });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function buildHistory(instances: Partner[], allCalls: CapitalCall[], companiesMap: Record<string, CompanyData>): TxRecord[] {
  const txns: TxRecord[] = [];
  let cumulative = 0;
  instances.forEach(p => {
    const companyName = companiesMap[p.companyId]?.name ?? p.companyId;
    cumulative += p.capitalContributed;
    txns.push({ date: '2024-01-15', type: 'Capital Contribution', company: companyName, amount: p.capitalContributed, cumulativeCapital: cumulative, profitShare: 0, status: 'Completed', notes: 'Initial equity contribution' });
    allCalls.filter(c => c.partnerId === p.id && c.received > 0).forEach(c => {
      cumulative += c.received;
      txns.push({ date: c.receivedDate ?? '2025-02-10', type: 'Capital Call Payment', company: companyName, amount: c.received, cumulativeCapital: cumulative, profitShare: 0, status: c.status === 'Paid' ? 'Completed' : 'Partial', notes: `Capital call · ${c.period}` });
    });
    if (p.distributionsReceived > 0) {
      const prefAmount = Math.round(p.capitalContributed * (p.preferredReturn / 100));
      const prefPaid = Math.min(p.distributionsReceived, prefAmount);
      if (prefPaid > 0) txns.push({ date: '2025-05-01', type: 'Preferred Return Payment', company: companyName, amount: prefPaid, cumulativeCapital: cumulative, profitShare: 0, status: 'Completed', notes: `${p.preferredReturn}% preferred return` });
      const remainder = p.distributionsReceived - prefPaid;
      if (remainder > 0) txns.push({ date: '2025-05-15', type: 'Profit Distribution', company: companyName, amount: remainder, cumulativeCapital: cumulative, profitShare: remainder, status: 'Completed', notes: `${(p.sharePercent / 100).toFixed(2)}% equity split` });
    }
  });
  return txns.sort((a, b) => a.date.localeCompare(b.date));
}

function buildTimelineData(history: TxRecord[]) {
  const byMonth: Record<string, { month: string; capitalIn: number; distributed: number; balance: number }> = {};
  let balance = 0;
  history.forEach(tx => {
    const month = tx.date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { month, capitalIn: 0, distributed: 0, balance: 0 };
    if (tx.amount > 0) byMonth[month].capitalIn += tx.amount;
    else byMonth[month].distributed += Math.abs(tx.amount);
    balance = tx.cumulativeCapital - (tx.type.includes('Distribution') || tx.type.includes('Preferred') ? tx.amount : 0);
    byMonth[month].balance = tx.cumulativeCapital;
  });
  return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
}

// -- Treemap custom content -----------------------------------------------------

interface TreemapNode {
  x: number; y: number; width: number; height: number;
  name: string; size: number; roi: number; fill: string; avgEquity: number;
}

function TreemapContent(props: Partial<TreemapNode> & { onSelect?: (name: string) => void; depth?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, name, size = 0, roi = 0, fill = '#92400E', avgEquity = 0, onSelect } = props;
  if (!name || width < 50 || height < 40) return null;
  const short = name.length > 14 ? `${name.slice(0, 12)}…` : name;
  return (
    <g onClick={() => onSelect?.(name)} style={{ cursor: 'pointer' }}>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" strokeWidth={2} rx={4} />
      <text x={x + 6} y={y + 16} fill="#fff" fontSize={12} fontWeight={600}>{short}</text>
      <text x={x + 6} y={y + 30} fill="#ffffffcc" fontSize={11}>{(avgEquity / 100).toFixed(2)}% · {fmtK(size)}</text>
      <text x={x + 6} y={y + 44} fill="#ffffffaa" fontSize={11}>ROI {roi.toFixed(1)}%</text>
    </g>
  );
}

// -- Left panel -----------------------------------------------------------------

function PartnerListPanel({
  summaries, selected, search, sortKey, onSearch, onSort, onSelect,
}: {
  summaries: PartnerSummary[];
  selected: string;
  search: string;
  sortKey: SortKey;
  onSearch: (s: string) => void;
  onSort: (k: SortKey) => void;
  onSelect: (name: string) => void;
}) {
  const filtered = useMemo(() => {
    let list = summaries.filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.primaryCompany.toLowerCase().includes(search.toLowerCase()),
    );
    if (sortKey === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sortKey === 'capital') list = [...list].sort((a, b) => b.totalCapital - a.totalCapital);
    if (sortKey === 'roi') list = [...list].sort((a, b) => b.roi - a.roi);
    return list;
  }, [summaries, search, sortKey]);

  return (
    <div className="flex flex-col h-full bg-[#F8F9FA] border-r border-gray-200">
      <div className="p-3 border-b border-gray-200 bg-white sticky top-0 z-10">
        <p className="sidebar-name font-semibold mb-2">Partners ({summaries.length})</p>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
          <input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search partners…"
            className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <div className="flex gap-1 mt-2">
          {([['name', 'By Name'], ['capital', 'By Capital'], ['roi', 'By ROI']] as [SortKey, string][]).map(([k, label]) => (
            <button key={k} onClick={() => onSort(k)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${sortKey === k ? 'bg-amber-100 text-amber-900 border border-amber-400' : 'bg-gray-100 text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        <button
          onClick={() => onSelect('all')}
          className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${
            selected === 'all' ? 'border-l-4 border-l-amber-600 bg-[#FFFBEB] border-amber-200' : 'border-transparent bg-white hover:bg-gray-50'
          }`}
        >
          <p className="text-xs font-semibold text-gray-800">All Partners</p>
          <p className="text-[10px] text-gray-400">Portfolio overview</p>
        </button>
        {filtered.map(s => (
          <button
            key={s.name}
            onClick={() => onSelect(s.name)}
            className={`w-full text-left p-3 rounded-lg border transition-all duration-200 ${
              selected === s.name ? 'border-l-4 border-l-amber-600 bg-[#FFFBEB] border-amber-200' : 'border-transparent bg-white hover:bg-gray-50'
            }`}
          >
            <div className="flex items-start justify-between gap-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-full bg-gray-800 text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {s.name.charAt(0)}
                </span>
                <div className="min-w-0">
                  <p className="sidebar-name truncate">{s.name}</p>
                  <p className="sidebar-meta truncate">{(s.avgEquity / 100).toFixed(2)}% · {s.primaryCompany}</p>
                </div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${s.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.status}</span>
            </div>
            <p className="text-[10px] text-gray-600 mt-1.5 font-mono">{fmtK(s.totalCapital)} contributed</p>
            <div className="flex items-center justify-between mt-1">
              <span className={`text-[10px] font-semibold ${s.roi >= 15 ? 'text-green-700' : 'text-amber-600'}`}>ROI {pct(s.roi)}</span>
              {s.indicator === 'overdue' && <span className="text-[10px] text-red-600">?? {fmtK(s.overdue)} overdue</span>}
              {s.indicator === 'good' && <span className="text-[10px] text-green-600">?</span>}
              {s.indicator === 'nodist' && <span className="text-[10px] text-gray-400">?? No distributions</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// -- Center: all partners -------------------------------------------------------

function CenterAllView({
  summaries, onSelectPartner, showAllBars, onToggleBars,
}: {
  summaries: PartnerSummary[];
  onSelectPartner: (name: string) => void;
  showAllBars: boolean;
  onToggleBars: () => void;
}) {
  const treemapData = summaries
    .filter(s => s.totalCapital > 0)
    .map(s => ({
      name: s.name,
      size: s.totalCapital,
      roi: s.roi,
      avgEquity: s.avgEquity,
      fill: roiFill(s.roi, s.overdue),
    }));

  const barSource = [...summaries].sort((a, b) => b.totalCapital - a.totalCapital);
  const barData = (showAllBars ? barSource : barSource.slice(0, 10)).map(s => ({
    name: s.name.length > 12 ? `${s.name.slice(0, 10)}…` : s.name,
    fullName: s.name,
    contributed: s.totalCapital,
    distributed: s.totalDistributed,
    pending: s.totalPending,
  }));

  return (
    <div className="space-y-5 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="section-header">Capital Contribution — All Partners</h3>
        <p className="body-text mb-3">Size = capital · Color = ROI performance · Click to select partner</p>
        <ResponsiveContainer width="100%" height={280}>
          {treemapData.length > 0 ? (
            <Treemap
              data={treemapData}
              dataKey="size"
              aspectRatio={4 / 3}
              stroke="#fff"
              content={(props) => (
                <TreemapContent {...(props as Partial<TreemapNode>)} onSelect={onSelectPartner} />
              )}
            >
              <Tooltip formatter={(v: number, _n: string, p: { payload?: { name: string; roi: number } }) => [
                `${fmt(v)} · ROI ${p.payload?.roi?.toFixed(1) ?? 0}%`, p.payload?.name ?? '',
              ]} />
            </Treemap>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-gray-400">No partner capital data</div>
          )}
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="section-header">Capital vs Distributions vs Pending</h3>
            <p className="body-text">Grouped bars per partner</p>
          </div>
          {summaries.length > 10 && (
            <button onClick={onToggleBars} className="text-xs text-blue-600 hover:underline">
              {showAllBars ? 'Show top 10' : `+ ${summaries.length - 10} more`}
            </button>
          )}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={barData} barGap={2} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(_l, payload) => (payload?.[0]?.payload as { fullName?: string })?.fullName ?? _l} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="contributed" name="Contributed" fill="#6366F1" radius={[3, 3, 0, 0]} />
            <Bar dataKey="distributed" name="Distributed" fill="#16A34A" radius={[3, 3, 0, 0]} />
            <Bar dataKey="pending" name="Pending" fill="#D97706" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// -- Center: single partner -----------------------------------------------------

function CenterPartnerView({
  summary, allCalls, companiesMap,
}: {
  summary: PartnerSummary;
  allCalls: CapitalCall[];
  companiesMap: Record<string, CompanyData>;
}) {
  const { name, instances } = summary;
  const totalPrefReturn = instances.reduce((s, p) => s + Math.round(p.capitalContributed * (p.preferredReturn / 100)), 0);
  const netPending = Math.max(0, summary.totalCapital + summary.totalProfit + totalPrefReturn - summary.totalDistributed);
  const netProfitAvailable = instances.reduce((s, p) => {
    const co = companiesMap[p.companyId];
    return s + (co?.property?.saleConsideration ?? 0);
  }, 0);
  const partnerShare = Math.round(netProfitAvailable * (summary.avgEquity / 100));
  const totalEntitled = partnerShare + totalPrefReturn;

  const history = useMemo(() => buildHistory(instances, allCalls, companiesMap), [instances, allCalls, companiesMap]);
  const ownershipHistory = useMemo(() => buildOwnershipHistory(instances, allCalls, companiesMap), [instances, allCalls, companiesMap]);
  const timeline = useMemo(() => buildTimelineData(history), [history]);

  const waterfall = useMemo(() => {
    const revenue = netProfitAvailable;
    const land = instances.reduce((s, p) => s + (companiesMap[p.companyId]?.property?.landCost ?? 0) * (p.sharePercent / 100), 0);
    const dev = instances.reduce((s, p) => {
      const prop = companiesMap[p.companyId]?.property;
      if (!prop) return s;
      return s + (prop.hardCost + prop.softCost) * (p.sharePercent / 100);
    }, 0);
    const commission = revenue * 0.03;
    const netProfit = revenue - land - dev - commission;
    const share = netProfit * (summary.avgEquity / 100);
    const pref = totalPrefReturn;
    const netDist = share + pref - summary.totalDistributed;
    return [
      { step: 'Total Revenue', value: revenue, fill: '#2563EB' },
      { step: 'Land Cost', value: -land, fill: '#DC2626' },
      { step: 'Dev Expenses', value: -dev, fill: '#DC2626' },
      { step: 'Commission', value: -commission, fill: '#DC2626' },
      { step: 'Net Profit', value: netProfit, fill: '#16A34A' },
      { step: `${name} Share`, value: share, fill: '#7C3AED' },
      { step: 'Pref Return', value: pref, fill: '#D97706' },
      { step: 'Net Distribution', value: netDist, fill: '#047857' },
    ];
  }, [instances, companiesMap, netProfitAvailable, summary, totalPrefReturn, name]);

  const primaryCompany = instances.length === 1 ? companiesMap[instances[0].companyId]?.name : null;

  return (
    <div className="space-y-4 p-4 overflow-y-auto">
      {/* Profile header */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-gray-900 text-white flex items-center justify-center text-lg font-bold">{name.charAt(0)}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="page-title">{name}</h2>
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{summary.status}</span>
            </div>
            <p className="text-sm text-gray-500">{summary.partnerType} · {pct(summary.avgEquity / 100)} equity · {summary.avgPref.toFixed(0)}% pref</p>
            {primaryCompany && <p className="text-sm text-gray-600">{primaryCompany}</p>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
          {[
            { label: 'Capital', value: fmt(summary.totalCapital) },
            { label: 'Received', value: fmt(summary.totalDistributed) },
            { label: 'ROI', value: pct(summary.roi) },
          ].map(k => (
            <div key={k.label} className="text-center bg-gray-50 rounded-lg p-2">
              <p className="text-[10px] text-gray-400 uppercase">{k.label}</p>
              <p className="font-bold font-mono text-gray-900">{k.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="section-header mb-3">Capital & Distribution History</h3>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={timeline}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="capitalIn" name="Capital In" fill="#6366F1" radius={[3, 3, 0, 0]} />
            <Bar dataKey="distributed" name="Distributed" fill="#16A34A" radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="balance" name="Balance" stroke="#7C3AED" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Waterfall */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="section-header mb-3">How Profit Is Calculated</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={waterfall} layout="vertical" margin={{ left: 8 }}>
            <XAxis type="number" tickFormatter={v => `$${(Math.abs(v) / 1000).toFixed(0)}k`} tick={{ fontSize: 9 }} />
            <YAxis type="category" dataKey="step" width={100} tick={{ fontSize: 9 }} />
            <Tooltip formatter={(v: number) => fmt(Math.abs(v))} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {waterfall.map((w, i) => <Cell key={i} fill={w.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Company breakdown */}
      {instances.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-4 py-2 border-b bg-gray-50"><h3 className="section-header">Company Breakdown</h3></div>
          <table className="w-full text-xs">
            <thead className="table-header">
              <tr>{['Company', 'Capital', 'Profit Share', 'Status'].map(h => <th key={h} className="px-3 py-2 text-right first:text-left">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {instances.map(p => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium">{companiesMap[p.companyId]?.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtK(p.capitalContributed)}</td>
                  <td className="px-3 py-2 text-right text-blue-700 font-mono">{fmtK(p.shareOfProfit)}</td>
                  <td className="px-3 py-2 text-right"><span className="text-green-700">{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* History table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b bg-gray-50"><h3 className="section-header">Ownership History</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="table-header">
              <tr>{['Date', 'Event', 'Amount', 'Balance', 'Notes'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {ownershipHistory.map((ev, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{ev.date}</td>
                  <td className="px-3 py-2">{ev.event}</td>
                  <td className={`px-3 py-2 font-mono ${ev.capital < 0 ? 'text-red-600' : ''}`}>{ev.capital < 0 ? `(${fmt(Math.abs(ev.capital))})` : fmt(ev.capital)}</td>
                  <td className="px-3 py-2 font-mono text-blue-700">{fmt(ev.cumulative)}</td>
                  <td className="px-3 py-2 text-gray-400">{ev.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sales strategy */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b bg-blue-900 text-white"><h3 className="text-sm font-semibold">Expected Returns from Remaining Lots</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>{['Property', 'Remaining', 'Expected Revenue', 'Partner Share', 'Timeline'].map(h => <th key={h} className="px-3 py-2 text-right first:text-left">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {instances.map(p => {
                const co = companiesMap[p.companyId];
                const prop = co?.property;
                if (!prop || !co?.lots) return null;
                const sold = co.lots.filter(l => l.status === 'sold' || l.status === 'contracted').length;
                const remaining = prop.totalLots - sold;
                const avgPrice = prop.totalLots > 0 ? prop.saleConsideration / prop.totalLots : 0;
                const partnerShareVal = Math.round(remaining * avgPrice * (p.sharePercent / 100));
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-medium">{prop.name}</td>
                    <td className="px-3 py-2 text-right">{remaining} lots</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(prop.saleConsideration)}</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-700">
                      {remaining > 0 ? `If ${remaining} @ ${fmtK(avgPrice)} ? ${fmt(partnerShareVal)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{sold}/{prop.totalLots} sold</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Profit position */}
      <div className="bg-white rounded-xl border-2 border-amber-200 p-4 shadow-sm">
        <h3 className="section-header mb-3">Current Profit Position</h3>
        <div className="space-y-2 text-sm font-mono">
          {[
            ['Net Profit Available', fmt(netProfitAvailable)],
            [`${name} Share (${(summary.avgEquity / 100).toFixed(2)}%)`, fmt(partnerShare)],
            [`Preferred Return (${summary.avgPref.toFixed(0)}%)`, fmt(totalPrefReturn)],
            ['Total Entitled', fmt(totalEntitled)],
            ['Less: Distributed', `(${fmt(summary.totalDistributed)})`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-gray-50 pb-1">
              <span className="text-gray-600 font-sans text-xs">{label}</span>
              <span className="font-semibold">{value}</span>
            </div>
          ))}
          <div className="flex justify-between pt-2">
            <span className="font-bold text-gray-900 font-sans">NET PENDING</span>
            <span className="text-lg font-bold text-amber-700">{fmt(netPending)}</span>
          </div>
        </div>
        <button className="mt-4 w-full py-2 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 flex items-center justify-center gap-2">
          <FileText size={14} /> Generate Settlement Statement PDF
        </button>
      </div>
    </div>
  );
}

// -- Right panel ----------------------------------------------------------------

function RightPanel({
  summaries, allPartners, allCalls,
}: {
  summaries: PartnerSummary[];
  allPartners: Partner[];
  allCalls: CapitalCall[];
}) {
  const [distributableAmount, setDistributableAmount] = useState('');
  const totalCapital = allPartners.reduce((s, p) => s + p.capitalContributed, 0);
  const totalDistributed = allPartners.reduce((s, p) => s + p.distributionsReceived, 0);
  const totalPending = summaries.reduce((s, p) => s + p.totalPending, 0);
  const avgROI = totalCapital > 0 ? (allPartners.reduce((s, p) => s + p.shareOfProfit, 0) / totalCapital) * 100 : 0;

  const attention = summaries.filter(s => s.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  const topPerformers = [...summaries].sort((a, b) => b.roi - a.roi).slice(0, 3);

  const calcResult = useMemo(() => {
    const total = parseFloat(distributableAmount.replace(/,/g, '') || '0');
    if (total <= 0 || allPartners.length === 0) return null;
    const step1 = Math.min(total, totalCapital);
    const remaining1 = total - step1;
    const prefTotal = allPartners.reduce((s, p) => s + p.capitalContributed * (p.preferredReturn / 100), 0);
    const step2 = Math.min(remaining1, prefTotal);
    const step3 = remaining1 - step2;
    const perPartner = allPartners.map(p => {
      const rocShare = totalCapital > 0 ? (p.capitalContributed / totalCapital) * step1 : 0;
      const prefShare = prefTotal > 0 ? (p.capitalContributed * (p.preferredReturn / 100) / prefTotal) * step2 : 0;
      const splitShare = (p.sharePercent / 100) * step3;
      return { name: p.name, pct: p.sharePercent, amount: rocShare + prefShare + splitShare };
    });
    return { perPartner, total };
  }, [distributableAmount, allPartners, totalCapital]);

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
        <p className="card-label mb-3">Portfolio Summary</p>
        <div className="space-y-2">
          {[
            ['Total Partners', String(summaries.length)],
            ['Total Capital', fmtK(totalCapital)],
            ['Total Distributed', fmtK(totalDistributed)],
            ['Total Pending', fmtK(totalPending)],
            ['Avg ROI', pct(avgROI)],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between">
              <span className="body-text">{l}</span>
              <span className="font-mono font-semibold text-gray-900 text-[13px]">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {attention.length > 0 && (
        <div className="p-4 border-b border-gray-100">
          <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">Attention Needed</p>
          <div className="space-y-2">
            {attention.slice(0, 3).map(s => (
              <div key={s.name} className="bg-red-50 border border-red-100 rounded-lg p-2.5">
                <p className="text-xs font-semibold text-red-800">?? {s.name}</p>
                <p className="text-[10px] text-red-600 mt-0.5">Overdue: {fmt(s.overdue)}</p>
                <button className="text-[10px] text-red-700 underline mt-1">Send Reminder</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-2">
          <Calculator size={14} className="text-blue-600" />
          <p className="text-xs font-bold text-gray-700 uppercase">Distribution Calculator</p>
        </div>
        <input
          type="text"
          value={distributableAmount}
          onChange={e => setDistributableAmount(e.target.value)}
          placeholder="Total to distribute ($)"
          className="w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 mb-2"
        />
        {calcResult && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {calcResult.perPartner.slice(0, 8).map((p, i) => (
              <div key={i} className="flex justify-between text-[10px]">
                <span className="text-gray-600 truncate max-w-[120px]">{p.name}</span>
                <span className="font-mono font-semibold">{(p.pct / 100).toFixed(2)}% · {fmtK(p.amount)}</span>
              </div>
            ))}
            {calcResult.perPartner.length > 8 && <p className="text-[10px] text-gray-400">+ {calcResult.perPartner.length - 8} more</p>}
            <button className="w-full mt-2 py-1.5 text-[10px] bg-blue-600 text-white rounded-lg">Generate All Statements</button>
          </div>
        )}
      </div>

      <div className="p-4">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Top Performers</p>
        <div className="space-y-2">
          {topPerformers.map((s, i) => (
            <div key={s.name} className="flex items-center gap-2 text-xs">
              <span>{['??', '??', '??'][i]}</span>
              <span className="font-medium text-gray-800 flex-1 truncate">{s.name}</span>
              <span className="text-green-700 font-mono font-semibold">{pct(s.roi)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -- Main ---------------------------------------------------------------------

export default function PD05Partners() {
  const { companies } = usePropDev();
  const [localCompanyId, setLocalCompanyId] = useState('all');
  const [selectedPartnerName, setSelectedPartnerName] = useState('all');
  const [period, setPeriod] = useState('ytd');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('capital');
  const [showAllBars, setShowAllBars] = useState(false);

  const companiesMap = useMemo(() => Object.fromEntries(companies.map(c => [c.id, c])), [companies]);
  const filteredCompanies = useMemo(
    () => localCompanyId === 'all' ? companies : companies.filter(c => c.id === localCompanyId),
    [companies, localCompanyId],
  );
  const allPartners = useMemo(() => filteredCompanies.flatMap(c => c.partners), [filteredCompanies]);
  const allCalls = useMemo(() => filteredCompanies.flatMap(c => c.capitalCalls), [filteredCompanies]);
  const allCallsGlobal = useMemo(() => companies.flatMap(c => c.capitalCalls), [companies]);

  const summaries = useMemo(
    () => aggregatePartners(allPartners, allCalls, companiesMap),
    [allPartners, allCalls, companiesMap],
  );

  const selectedSummary = selectedPartnerName !== 'all'
    ? summaries.find(s => s.name === selectedPartnerName) ?? null
    : null;

  const handleCompanyChange = (id: string) => {
    setLocalCompanyId(id);
    setSelectedPartnerName('all');
  };

  const totalCapital = allPartners.reduce((s, p) => s + p.capitalContributed, 0);
  const totalDistributed = allPartners.reduce((s, p) => s + p.distributionsReceived, 0);
  const totalPending = summaries.reduce((s, p) => s + p.totalPending, 0);
  const avgROI = totalCapital > 0 ? (allPartners.reduce((s, p) => s + p.shareOfProfit, 0) / totalCapital) * 100 : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[600px] -m-2">
      {/* Top bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-3 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="page-title">Partners / JV Ledger</h2>
            <p className="body-text">Equity · contributions · distributions · settlement</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={localCompanyId} onChange={e => handleCompanyChange(e.target.value)}
              className="border rounded-lg px-2.5 py-1.5 text-xs bg-white min-w-[160px]">
              <option value="all">Company: All</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={selectedPartnerName} onChange={e => setSelectedPartnerName(e.target.value)}
              className="border rounded-lg px-2.5 py-1.5 text-xs bg-white min-w-[160px]">
              <option value="all">Partner: All</option>
              {summaries.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <select value={period} onChange={e => setPeriod(e.target.value)}
              className="border rounded-lg px-2.5 py-1.5 text-xs bg-white">
              <option value="ytd">Period: YTD</option>
              <option value="this-month">This Month</option>
              <option value="all">All Time</option>
            </select>
            <button className="flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs"><Download size={12} /> Export</button>
            <button className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg text-xs"><Zap size={12} /> AI Insights</button>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
        {[
          { label: 'Partners', value: String(summaries.length) },
          { label: 'Capital', value: fmtK(totalCapital) },
          { label: 'Distributed', value: fmtK(totalDistributed) },
          { label: 'Pending', value: fmtK(totalPending) },
          { label: 'Avg ROI', value: pct(avgROI) },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-lg border border-gray-200 px-3 py-2 shadow-sm">
            <p className="card-label">{k.label}</p>
            <p className="card-value font-mono">{k.value}</p>
          </div>
        ))}
      </div>

      {/* 3-panel layout */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
        {/* Left — hidden on mobile, use partner dropdown instead */}
        <div className="hidden lg:block w-[240px] shrink-0 min-h-0">
          <PartnerListPanel
            summaries={summaries}
            selected={selectedPartnerName}
            search={search}
            sortKey={sortKey}
            onSearch={setSearch}
            onSort={setSortKey}
            onSelect={setSelectedPartnerName}
          />
        </div>

        {/* Center */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-[transparent]">
          {selectedPartnerName === 'all' || !selectedSummary ? (
            <CenterAllView
              summaries={summaries}
              onSelectPartner={setSelectedPartnerName}
              showAllBars={showAllBars}
              onToggleBars={() => setShowAllBars(v => !v)}
            />
          ) : (
            <CenterPartnerView
              summary={selectedSummary}
              allCalls={allCallsGlobal}
              companiesMap={companiesMap}
            />
          )}
        </div>

        {/* Right — desktop */}
        <div className="hidden xl:block w-[280px] shrink-0 min-h-0">
          <RightPanel summaries={summaries} allPartners={allPartners} allCalls={allCalls} />
        </div>
      </div>

      {/* Right panel — mobile/tablet collapsible */}
      <details className="xl:hidden mt-3 bg-white border border-gray-200 rounded-xl shadow-sm">
        <summary className="px-4 py-3 text-xs font-semibold text-gray-700 cursor-pointer select-none">
          Portfolio Summary &amp; Distribution Calculator
        </summary>
        <div className="max-h-[420px] overflow-y-auto border-t border-gray-100">
          <RightPanel summaries={summaries} allPartners={allPartners} allCalls={allCalls} />
        </div>
      </details>
    </div>
  );
}
