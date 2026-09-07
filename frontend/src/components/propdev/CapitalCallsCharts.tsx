import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts';
import type { CapitalCall } from '../../contexts/PropertyDevContext';
import { PT, PT_FONT } from '../../utils/parchmentTypography';

const STATUS_FILL: Record<CapitalCall['status'], string> = {
  Paid:        PT.green,
  Partial:     PT.amber,
  Outstanding: PT.blue,
  Overdue:     PT.red,
};

const COLLECTION = {
  called:      '#7A6040',
  received:    PT.green,
  outstanding: PT.red,
};

const CHART_CARD = {
  background: PT.cardBg,
  border: `1px solid ${PT.border}`,
  borderRadius: 12,
  overflow: 'hidden' as const,
};

const CHART_TOOLTIP = { contentStyle: PT_FONT.tooltip };

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtK = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return fmt(n);
};

const shortName = (name: string, max = 18) =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

interface Props {
  calls: CapitalCall[];
  companyNameMap: Record<string, string>;
  selectedCompanyId: string;
  onViewAllPartners?: () => void;
}

export default function CapitalCallsCharts({
  calls,
  companyNameMap,
  selectedCompanyId,
  onViewAllPartners,
}: Props) {
  const [showAllPartners, setShowAllPartners] = useState(false);

  const collectionByCompany = useMemo(() => {
    const byCo = new Map<string, { called: number; received: number }>();
    for (const c of calls) {
      const cur = byCo.get(c.companyId) ?? { called: 0, received: 0 };
      cur.called += c.totalDue;
      cur.received += c.received;
      byCo.set(c.companyId, cur);
    }
    const rows = [...byCo.entries()].map(([id, v]) => {
      const name = companyNameMap[id] ?? id;
      return {
        name: shortName(name, selectedCompanyId === 'all' ? 14 : 22),
        fullName: name,
        called: Math.round(v.called),
        received: Math.round(v.received),
        outstanding: Math.round(Math.max(0, v.called - v.received)),
      };
    }).filter(r => r.called > 0 || r.received > 0)
      .sort((a, b) => b.outstanding - a.outstanding);

    if (selectedCompanyId !== 'all' && rows.length === 0 && calls.length === 0) return [];
    if (selectedCompanyId !== 'all' && rows.length === 0) {
      const called = calls.reduce((s, c) => s + c.totalDue, 0);
      const received = calls.reduce((s, c) => s + c.received, 0);
      return [{
        name: shortName(companyNameMap[selectedCompanyId] ?? 'Company', 22),
        fullName: companyNameMap[selectedCompanyId] ?? 'Company',
        called: Math.round(called),
        received: Math.round(received),
        outstanding: Math.round(Math.max(0, called - received)),
      }];
    }
    return rows.slice(0, 10);
  }, [calls, companyNameMap, selectedCompanyId]);

  const statusBreakdown = useMemo(() => {
    const buckets: Record<CapitalCall['status'], { count: number; balance: number }> = {
      Paid: { count: 0, balance: 0 },
      Partial: { count: 0, balance: 0 },
      Outstanding: { count: 0, balance: 0 },
      Overdue: { count: 0, balance: 0 },
    };
    for (const c of calls) {
      const bal = Math.max(0, c.totalDue - c.received);
      buckets[c.status].count += 1;
      buckets[c.status].balance += bal;
    }
    const totalBal = Object.values(buckets).reduce((s, b) => s + b.balance, 0) || 1;
    return (Object.keys(buckets) as CapitalCall['status'][])
      .map(status => ({
        name: status,
        value: Math.round(buckets[status].balance),
        count: buckets[status].count,
        pct: (buckets[status].balance / totalBal) * 100,
        color: STATUS_FILL[status],
      }))
      .filter(d => d.count > 0 || d.value > 0);
  }, [calls]);

  const partnerBalances = useMemo(() => {
    const byPartner = new Map<string, {
      name: string; balance: number; status: CapitalCall['status'];
      oldDues: number; currentCall: number;
    }>();
    for (const c of calls) {
      const bal = Math.max(0, c.totalDue - c.received);
      const currentCall = Math.max(0, c.totalDue - (c.oldDues || 0));
      const existing = byPartner.get(c.partnerId);
      if (!existing) {
        byPartner.set(c.partnerId, {
          name: c.partnerName,
          balance: bal,
          status: c.status,
          oldDues: c.oldDues || 0,
          currentCall,
        });
      } else {
        existing.balance += bal;
        existing.oldDues += c.oldDues || 0;
        existing.currentCall += currentCall;
        // Prefer worse status for color
        const rank = { Paid: 0, Outstanding: 1, Partial: 2, Overdue: 3 };
        if (rank[c.status] > rank[existing.status]) existing.status = c.status;
      }
    }
    return [...byPartner.values()]
      .sort((a, b) => b.balance - a.balance);
  }, [calls]);

  const partnerBarData = useMemo(() => {
    const list = showAllPartners ? partnerBalances : partnerBalances.slice(0, 12);
    return list.map(p => ({
      name: shortName(p.name, 16),
      fullName: p.name,
      balance: Math.round(p.balance),
      fill: STATUS_FILL[p.status],
      status: p.status,
    }));
  }, [partnerBalances, showAllPartners]);

  const agingData = useMemo(() => {
    const list = partnerBalances
      .filter(p => p.oldDues > 0 || p.currentCall > 0)
      .slice(0, 12);
    return list.map(p => ({
      name: shortName(p.name, 16),
      fullName: p.name,
      oldDues: Math.round(p.oldDues),
      currentCall: Math.round(p.currentCall),
    }));
  }, [partnerBalances]);

  if (calls.length === 0) return null;

  const chartH = Math.max(200, partnerBarData.length * 22 + 40);

  return (
    <div className="space-y-4" data-testid="capital-calls-charts">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h3 style={PT_FONT.sectionTitle}>Capital Call Analytics</h3>
          <p style={PT_FONT.sectionSubtitle}>
            Collection gap, status risk, partner priorities, and dues aging — summary above the detail table
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CHART 1 — Called vs Received vs Outstanding */}
        <div style={CHART_CARD}>
          <div className="p-4" style={{ borderBottom: `1px solid ${PT.border}` }}>
            <h4 style={PT_FONT.chartTitle}>Called vs Received vs Outstanding</h4>
            <p style={PT_FONT.chartSubtitle}>
              {selectedCompanyId === 'all' ? 'One group per company' : 'Selected company collection gap'}
            </p>
          </div>
          <div className="p-4">
            {collectionByCompany.length === 0 ? (
              <p style={{ ...PT_FONT.bodyMuted, textAlign: 'center', padding: '40px 0' }}>No collection totals to chart.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={collectionByCompany} barGap={2} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke={PT.border} vertical={false} />
                  <XAxis dataKey="name" tick={PT_FONT.chartTick} interval={0} angle={collectionByCompany.length > 4 ? -25 : 0} textAnchor={collectionByCompany.length > 4 ? 'end' : 'middle'} height={collectionByCompany.length > 4 ? 56 : 30} />
                  <YAxis tick={PT_FONT.chartTick} tickFormatter={fmtK} width={52} />
                  <Tooltip
                    {...CHART_TOOLTIP}
                    formatter={(v: number, name: string) => [fmt(v), name]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? _}
                  />
                  <Legend wrapperStyle={PT_FONT.legend} />
                  <Bar dataKey="called" name="Called" fill={COLLECTION.called} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="received" name="Received" fill={COLLECTION.received} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="outstanding" name="Outstanding" fill={COLLECTION.outstanding} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* CHART 2 — Status Breakdown donut */}
        <div style={CHART_CARD}>
          <div className="p-4" style={{ borderBottom: `1px solid ${PT.border}` }}>
            <h4 style={PT_FONT.chartTitle}>Status Breakdown</h4>
            <p style={PT_FONT.chartSubtitle}>Outstanding $ balance by partner status · count in legend</p>
          </div>
          <div className="p-4">
            {statusBreakdown.length === 0 ? (
              <p style={{ ...PT_FONT.bodyMuted, textAlign: 'center', padding: '40px 0' }}>No status data.</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={statusBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="42%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                  >
                    {statusBreakdown.map(entry => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    {...CHART_TOOLTIP}
                    formatter={(v: number, _n, props) => {
                      const p = props.payload as { count: number; pct: number; name: string };
                      return [`${fmt(v)} · ${p.count} partner${p.count === 1 ? '' : 's'} (${p.pct.toFixed(0)}%)`, p.name];
                    }}
                  />
                  <Legend
                    layout="vertical"
                    align="right"
                    verticalAlign="middle"
                    wrapperStyle={{ ...PT_FONT.legend, lineHeight: '18px' }}
                    formatter={(value) => {
                      const row = statusBreakdown.find(d => d.name === value);
                      if (!row) return value;
                      return `${value} · ${fmtK(row.value)} · ${row.count} (${row.pct.toFixed(0)}%)`;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* CHART 3 — Balance Receivable by Partner */}
        <div style={CHART_CARD}>
          <div className="p-4 flex items-start justify-between gap-2" style={{ borderBottom: `1px solid ${PT.border}` }}>
            <div>
              <h4 style={PT_FONT.chartTitle}>Balance Receivable by Partner</h4>
              <p style={PT_FONT.chartSubtitle}>Highest outstanding first · color = status</p>
            </div>
            {partnerBalances.length > 12 && (
              <button
                type="button"
                className="whitespace-nowrap"
                style={{ ...PT_FONT.caption, color: PT.gold, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => {
                  if (showAllPartners) {
                    onViewAllPartners?.();
                  } else {
                    setShowAllPartners(true);
                  }
                }}
              >
                {showAllPartners ? 'View full table ↓' : `View all (${partnerBalances.length})`}
              </button>
            )}
          </div>
          <div className="p-4">
            {partnerBarData.length === 0 ? (
              <p style={{ ...PT_FONT.bodyMuted, textAlign: 'center', padding: '40px 0' }}>No partner balances.</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={Math.min(320, chartH)}>
                  <BarChart layout="vertical" data={partnerBarData} barSize={14} margin={{ left: 4, right: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={PT.border} horizontal={false} />
                    <XAxis type="number" tick={PT_FONT.chartTick} tickFormatter={fmtK} />
                    <YAxis type="category" dataKey="name" tick={PT_FONT.chartTick} width={100} />
                    <Tooltip
                      {...CHART_TOOLTIP}
                      formatter={(v: number, _n, props) => [fmt(v), props.payload.status]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? _}
                    />
                    <Bar dataKey="balance" name="Balance" radius={[0, 3, 3, 0]}>
                      {partnerBarData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 mt-2 justify-center" style={PT_FONT.caption}>
                  {([['Paid', STATUS_FILL.Paid], ['Partial', STATUS_FILL.Partial], ['Outstanding', STATUS_FILL.Outstanding], ['Overdue', STATUS_FILL.Overdue]] as const).map(([label, color]) => (
                    <span key={label} className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* CHART 4 — Old Dues vs Current Call */}
        <div style={CHART_CARD}>
          <div className="p-4" style={{ borderBottom: `1px solid ${PT.border}` }}>
            <h4 style={PT_FONT.chartTitle}>Old Dues vs Current Call</h4>
            <p style={PT_FONT.chartSubtitle}>
              Legacy carried balance vs this period&apos;s call (Total Due − Old Dues)
            </p>
          </div>
          <div className="p-4">
            {agingData.length === 0 ? (
              <p style={{ ...PT_FONT.bodyMuted, textAlign: 'center', padding: '40px 0' }}>No dues composition to chart.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.min(320, Math.max(200, agingData.length * 22 + 40))}>
                <BarChart layout="vertical" data={agingData} barSize={14} margin={{ left: 4, right: 48 }} stackOffset="none">
                  <CartesianGrid strokeDasharray="3 3" stroke={PT.border} horizontal={false} />
                  <XAxis type="number" tick={PT_FONT.chartTick} tickFormatter={fmtK} />
                  <YAxis type="category" dataKey="name" tick={PT_FONT.chartTick} width={100} />
                  <Tooltip
                    {...CHART_TOOLTIP}
                    formatter={(v: number, name: string) => [fmt(v), name]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? _}
                  />
                  <Legend wrapperStyle={PT_FONT.legend} />
                  <Bar dataKey="oldDues" name="Old Dues" stackId="dues" fill={PT.amber} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="currentCall" name="Current Call" stackId="dues" fill={PT.gold} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
