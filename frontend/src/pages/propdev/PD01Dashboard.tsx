import { useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { usePropDevCompanyFinancials } from '../../hooks/usePropDevCompanyFinancials';
import CompanyComparisonPanel from '../../components/propdev/CompanyComparisonPanel';
import PropDevCommandCenterSummaries from '../../components/propdev/PropDevCommandCenterSummaries';
import PropDevCommandCenterLoanInsights from '../../components/propdev/PropDevCommandCenterLoanInsights';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { ArrowUp, ArrowDown, AlertCircle, Clock } from 'lucide-react';
import PropDevPageHeader from '../../components/propdev/PropDevPageHeader';

const money = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${n.toLocaleString()}`;
const fmtK = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n}`;

const STATUS_COLORS: Record<string, string> = {
  sold: '#16A34A', contracted: '#2563EB', reserved: '#D97706',
  available: '#6B7280', cancelled: '#DC2626', legal_pending: '#7C3AED',
};

const COMPANY_COLORS = [
  '#2563EB', '#16A34A', '#DC2626', '#D97706', '#7C3AED',
  '#059669', '#DB2777', '#0891B2', '#65A30D', '#9F1239',
];

const shortName = (name: string) => name.split(' ')[0];

function partnerSharePct(sharePercent: number) {
  return sharePercent > 0 && sharePercent <= 1 ? sharePercent * 100 : sharePercent;
}

export default function PD01Dashboard() {
  const {
    lots, properties, loans, capitalCalls, customers, companies,
    isConsolidated, selectedCompanyId, setSelectedCompanyId,
  } = usePropDev();
  const [activeSlice, setActiveSlice] = useState<string | null>(null);
  const p = properties[0];

  const showCompanyFinancials = !isConsolidated && selectedCompanyId !== 'all';
  const finHook = usePropDevCompanyFinancials(showCompanyFinancials ? selectedCompanyId : 'all');
  const selectedCompany = finHook.company;

  const propertyCount = companies.length || lots.length;
  const soldProperties = lots.filter(l => l.status === 'sold');
  const forSaleProperties = lots.filter(l => l.status === 'available' || l.status === 'reserved');
  const contractedProperties = lots.filter(l => l.status === 'contracted');
  const totalRevenue = soldProperties.reduce((s, l) => s + (l.salePrice ?? 0), 0);
  const totalLoanBalance = loans.reduce((s, l) => s + l.balance, 0);
  const overdueCalls = capitalCalls.filter(c => c.status === 'Overdue' || c.status === 'Partial');
  const overdueCapital = overdueCalls.reduce((s, c) => s + c.totalDue - c.received, 0);
  const pendingDistributions = customers.reduce((s, c) => s + Math.max(0, c.contractValue - c.collected), 0);
  const portfolioCashAvail = companies.reduce((s, c) => s + (c.property.cashAvailable ?? 0), 0);
  const cashAvail = isConsolidated ? portfolioCashAvail : (p?.cashAvailable ?? 0);
  const partnerCount = companies.reduce(
    (s, c) => s + c.partners.filter(pr => ((pr.status as string) || 'Active') !== 'Exited').length,
    0,
  );

  const totalCost = p
    ? p.landCost + p.hardCost + p.softCost + p.titleCharges + p.otherCharges
      + p.propertyTax + p.loanProcessing + p.professionalCharges + p.legalFees + p.interestOnLoan
    : 0;
  const netProfit = p
    ? p.saleConsideration - totalCost - p.saleConsideration * 0.09 - p.saleConsideration * 0.045
    : 0;
  const grossMargin = p && p.saleConsideration > 0
    ? ((netProfit / p.saleConsideration) * 100).toFixed(1)
    : '0';

  const kpis = isConsolidated
    ? [
      { label: 'Companies', value: companies.length.toString(), sub: 'in portfolio', trend: 'flat' as const, good: true },
      { label: 'Partners', value: partnerCount.toString(), sub: 'active ownership', trend: 'flat' as const, good: true },
      { label: 'Active Loans', value: loans.filter(l => l.status === 'Active').length.toString(), sub: 'across entities', trend: 'flat' as const, good: true },
      { label: 'Loan Balance', value: money(totalLoanBalance), sub: `${loans.length} loans`, trend: 'down' as const, good: false },
      { label: 'Capital Due', value: money(overdueCapital), sub: 'overdue calls', trend: overdueCapital > 0 ? 'up' as const : 'flat' as const, good: overdueCapital === 0 },
      { label: 'Cash Avail', value: money(cashAvail), sub: 'portfolio total', trend: 'flat' as const, good: true },
      { label: 'Gross Sales', value: money(totalRevenue), sub: 'realized lots', trend: 'up' as const, good: true },
      { label: 'Distrib Pending', value: money(pendingDistributions), sub: 'to partners', trend: 'up' as const, good: false },
    ]
    : [
      { label: 'Properties Sold', value: soldProperties.length.toString(), sub: `of ${propertyCount} total`, trend: 'up' as const, good: true },
      { label: 'For Sale', value: forSaleProperties.length.toString(), sub: 'unsold', trend: 'down' as const, good: false },
      { label: 'Under Contract', value: contractedProperties.length.toString(), sub: 'in pipeline', trend: 'flat' as const, good: true },
      { label: 'Gross Sales', value: money(totalRevenue), sub: 'realized', trend: 'up' as const, good: true },
      { label: 'Net Margin', value: `${grossMargin}%`, sub: 'projected', trend: 'up' as const, good: parseFloat(grossMargin) >= 35 },
      { label: 'Loan Balance', value: money(totalLoanBalance), sub: `${loans.length} loans`, trend: 'down' as const, good: false },
      { label: 'Capital Due', value: money(overdueCapital), sub: 'overdue calls', trend: overdueCapital > 0 ? 'up' as const : 'flat' as const, good: overdueCapital === 0 },
      { label: 'Cash Avail', value: money(cashAvail), sub: 'on hand', trend: 'flat' as const, good: true },
      { label: 'Distrib Pending', value: money(pendingDistributions), sub: 'to partners', trend: 'up' as const, good: false },
    ];

  const statusGroups: Record<string, number> = {};
  lots.forEach(l => { statusGroups[l.status] = (statusGroups[l.status] ?? 0) + 1; });
  const pieData = Object.entries(statusGroups).map(([s, v]) => ({
    name: s.replace('_', ' '), value: v, color: STATUS_COLORS[s] ?? '#9CA3AF',
  }));
  const monthlyData = p?.monthlyData ?? [];
  const hasLotCharts = monthlyData.length > 0 || pieData.length > 0;

  const portfolioCompanyRows = companies.map((c, ci) => ({
    id: c.id,
    name: c.name,
    color: COMPANY_COLORS[ci % COMPANY_COLORS.length],
  }));

  const alerts = [
    ...overdueCalls.map(c => ({ level: 'critical' as const, msg: `Capital call overdue — ${c.partnerName}: $${(c.totalDue - c.received).toLocaleString()} outstanding` })),
    ...customers.filter(c => c.installments.some(i => i.status === 'bounced')).map(c => ({ level: 'critical' as const, msg: `Bounced payment — ${c.name}: $${(c.contractValue - c.collected).toLocaleString()} pending` })),
    ...loans.filter(l => l.interestRate > 8).map(l => ({ level: 'high' as const, msg: `High rate loan — ${l.bank} at ${l.interestRate}% — refinancing opportunity` })),
    forSaleProperties.length > 0 && propertyCount > 3
      ? { level: 'watch' as const, msg: `${forSaleProperties.length} properties still for sale — pricing strategy review recommended` }
      : null,
  ].filter(Boolean) as { level: string; msg: string }[];

  const ALERT_STYLES = {
    critical: 'bg-red-50 border-red-200 text-red-800',
    high: 'bg-orange-50 border-orange-200 text-orange-800',
    watch: 'bg-amber-50 border-amber-200 text-amber-800',
  };
  const ALERT_ICONS = {
    critical: <AlertCircle size={14} className="shrink-0" />,
    high: <AlertCircle size={14} className="shrink-0" />,
    watch: <Clock size={14} className="shrink-0" />,
  };

  const today = new Date();
  const todayDay = today.getDate();

  const companyEmiData = companies.map((c, ci) => {
    const active = c.loans.filter(l => l.status === 'Active');
    const outstanding = active.reduce((s, l) => s + l.balance, 0);
    const monthlyEmi = active.reduce((s, l) => s + l.emi, 0);
    const nextEmiDay = active.length > 0 ? Math.min(...active.map(l => l.emiDate)) : null;
    let daysToEmi: number | null = null;
    if (nextEmiDay !== null) {
      daysToEmi = nextEmiDay - todayDay;
      if (daysToEmi < 0) daysToEmi += 30;
    }
    const emiStatus = daysToEmi === null ? 'No Loans' : daysToEmi < 0 ? 'Overdue' : daysToEmi <= 7 ? 'Due Soon' : 'Current';
    const coverage = monthlyEmi > 0 ? c.property.cashAvailable / monthlyEmi : 99;
    const avgRate = outstanding > 0 ? active.reduce((s, l) => s + l.interestRate * l.balance, 0) / outstanding : 0;
    const color = COMPANY_COLORS[ci % COMPANY_COLORS.length];
    const alertFlags: string[] = [];
    if (avgRate > 7.5) alertFlags.push('Rate above market');
    if (daysToEmi !== null && daysToEmi >= 0 && daysToEmi <= 7) alertFlags.push(`EMI due in ${daysToEmi}d`);
    if (coverage < 3 && monthlyEmi > 0) alertFlags.push('Low cash coverage');
    active.forEach(l => {
      const mat = new Date(l.maturityDate);
      const daysToMat = Math.floor((mat.getTime() - today.getTime()) / 86400000);
      if (daysToMat <= 90 && daysToMat > 0) alertFlags.push('Loan maturing soon');
    });
    return {
      name: c.name, short: shortName(c.name), active, outstanding, monthlyEmi,
      nextEmiDay, daysToEmi, emiStatus, cashAvailable: c.property.cashAvailable,
      coverage, avgRate, color, alertFlags,
    };
  });

  const emiBarData = companyEmiData.map(c => ({
    name: c.short,
    outstanding: Math.round(c.outstanding / 1000),
    emi: Math.round(c.monthlyEmi / 1000),
    overdue: c.emiStatus === 'Overdue' ? Math.round(c.monthlyEmi / 1000) : 0,
    fullName: c.name,
  })).filter(c => c.outstanding > 0 || c.emi > 0);

  const calendarEvents = companies.flatMap(c =>
    c.loans.filter(l => l.status === 'Active').map(l => {
      const day = l.emiDate;
      const isPast = day < todayDay;
      const isToday = day === todayDay;
      const isSoon3 = !isPast && day <= todayDay + 3;
      const isSoon7 = !isPast && day <= todayDay + 7;
      const pillColor = isPast ? 'bg-green-100 text-green-800 border-green-200'
        : isToday ? 'bg-red-100 text-red-800 border-red-200'
          : isSoon3 ? 'bg-orange-100 text-orange-800 border-orange-200'
            : isSoon7 ? 'bg-amber-100 text-amber-800 border-amber-200'
              : 'bg-gray-100 text-gray-600 border-gray-200';
      return { day, company: shortName(c.name), amount: l.emi, pillColor, isPast };
    }),
  ).sort((a, b) => a.day - b.day);

  const totalMonthlyEmi = companyEmiData.reduce((s, c) => s + c.monthlyEmi, 0);
  const emiCompanyCount = companyEmiData.filter(c => c.monthlyEmi > 0).length;

  const donutData = companyEmiData
    .filter(c => c.outstanding > 0)
    .map(c => ({ name: c.short, value: c.outstanding, color: c.color }));

  const rateBarData = companyEmiData
    .flatMap(c => c.active.map(l => ({
      name: `${c.short} / ${l.bank.split(' ')[0]}`,
      rate: l.interestRate,
      balance: Math.round(l.balance / 1000),
      barColor: l.interestRate > 7.5 ? '#DC2626' : l.interestRate > 6.5 ? '#D97706' : '#16A34A',
    })))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 12);

  const highestRateLoan = rateBarData[0];
  const highestRateCompany = companyEmiData.find(c => c.active.some(l => l.interestRate === highestRateLoan?.rate));
  const scorecardData = [...companyEmiData].sort((a, b) => a.coverage - b.coverage);
  const portfolioMonthlyEmi = companyEmiData.reduce((s, c) => s + c.monthlyEmi, 0);
  const portfolioCash = companies.reduce((s, c) => s + c.property.cashAvailable, 0);
  const portfolioOutstanding = companyEmiData.reduce((s, c) => s + c.outstanding, 0);

  const healthBadge = (cov: number) =>
    cov > 12 ? { label: 'Excellent', cls: 'bg-green-100 text-green-800' }
      : cov > 6 ? { label: 'Good', cls: 'bg-yellow-100 text-yellow-800' }
        : cov > 3 ? { label: 'Monitor', cls: 'bg-orange-100 text-orange-800' }
          : { label: 'Critical', cls: 'bg-red-100 text-red-800' };

  const emiStatusBadge = (s: string) =>
    s === 'Current' ? { label: 'Current', cls: 'bg-green-100 text-green-700' }
      : s === 'Due Soon' ? { label: 'Due Soon', cls: 'bg-amber-100 text-amber-700' }
        : s === 'Overdue' ? { label: 'Overdue', cls: 'bg-red-100 text-red-700' }
          : { label: '—', cls: 'bg-gray-100 text-gray-500' };

  const CustomEmiTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: typeof emiBarData[0] }[] }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const c = companyEmiData.find(x => x.short === d.name);
    if (!c) return null;
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs">
        <p className="font-semibold text-gray-900 mb-1">{c.name}</p>
        <p className="text-gray-600">Active loans: {c.active.length}</p>
        <p className="text-gray-600">Outstanding: {money(c.outstanding)}</p>
        <p className="text-gray-600">Monthly EMI: {money(c.monthlyEmi)}</p>
        {c.nextEmiDay && <p className="text-gray-600">Next EMI: {c.nextEmiDay}th</p>}
      </div>
    );
  };

  const companyPartners = (() => {
    if (!showCompanyFinancials) return [] as { name: string; sharePercent: number }[];
    if (finHook.overviewKpis?.partners?.length) return finHook.overviewKpis.partners;
    return (selectedCompany?.partners ?? [])
      .filter(pr => ((pr.status as string) || 'Active') !== 'Exited')
      .map(pr => ({ name: pr.name, sharePercent: partnerSharePct(pr.sharePercent) }));
  })();

  return (
    <div className="space-y-5">
      <PropDevPageHeader
        title={p?.name ?? 'Portfolio'}
        subtitle={`${p?.address ?? ''}${propertyCount <= 1 ? (p?.name ? ` · ${p.name} — single property holding` : '') : ` · ${propertyCount} properties`}${p?.totalAcres && p.totalAcres > 0 ? ` · ${p.totalAcres?.toFixed(1)} acres` : ''}`}
      />

      {isConsolidated && (
        <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: 'rgba(212,175,55,0.25)' }}>
          <div className="px-4 py-3 border-b" style={{ background: '#EEF0FF', borderColor: 'rgba(212,175,55,0.20)' }}>
            <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold">Portfolio Companies</p>
            <h3 className="text-sm font-semibold text-gray-900 mt-0.5">
              {companies.length} entities · click one for P&L, Balance Sheet, Cash Flow &amp; Loans
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {portfolioCompanyRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No companies loaded yet.</p>
            ) : portfolioCompanyRows.map(row => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedCompanyId(row.id)}
                className="w-full text-left px-4 py-3 hover:bg-amber-50/60 transition-colors flex items-center gap-2"
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.color }} />
                <span className="font-semibold text-gray-900 truncate">{row.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCompanyFinancials && selectedCompany && (
        <div className="space-y-4">
          <div className="rounded-xl border overflow-hidden bg-white" style={{ borderColor: 'rgba(212,175,55,0.25)' }}>
            <div className="px-4 py-3" style={{ background: '#EEF0FF' }}>
              <p className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold">Selected Company</p>
              <h3 className="text-base font-semibold text-gray-900 mt-0.5">{selectedCompany.name}</h3>
              {selectedCompany.property.address && (
                <p className="text-xs text-gray-500 mt-0.5">{selectedCompany.property.address}</p>
              )}
            </div>
          </div>

          <PropDevCommandCenterSummaries
            companyId={selectedCompanyId}
            company={selectedCompany}
            fin={finHook.resolvedFin}
            loans={loans}
            loadState={finHook.loadState}
            error={finHook.error}
            onRetry={finHook.reload}
            plSnapshots={finHook.plSnapshots}
            bsSnapshots={finHook.bsSnapshots}
            cfSnapshots={finHook.cfSnapshots}
            selectedYear={finHook.selectedYear}
          />

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-2">Partners &amp; Share</p>
            {companyPartners.length === 0 ? (
              <p className="text-sm text-gray-400">No partners on file for this company.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {companyPartners.map(pr => (
                  <div key={pr.name} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
                    <span className="text-sm font-medium text-gray-800">{pr.name}</span>
                    <span className="text-xs font-semibold font-mono text-amber-700">
                      {pr.sharePercent.toFixed(pr.sharePercent % 1 === 0 ? 0 : 2)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <PropDevCommandCenterLoanInsights
            company={selectedCompany}
            cashAvailable={finHook.overviewKpis?.cash ?? null}
          />
        </div>
      )}

      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        {kpis.map(({ label, value, sub, trend, good }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-3 text-center hover:border-blue-300 transition-colors">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1 truncate">{label}</p>
            <p className="text-base font-bold text-gray-900 truncate">{value}</p>
            <div className="flex items-center justify-center gap-1 mt-1">
              {trend === 'up' && <ArrowUp size={10} className={good ? 'text-green-500' : 'text-red-500'} />}
              {trend === 'down' && <ArrowDown size={10} className={good ? 'text-red-500' : 'text-green-500'} />}
              <p className="text-xs text-gray-400 truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {alerts.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <AlertCircle size={14} className="text-red-500" /> Action Required
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
            {alerts.slice(0, 6).map((a, i) => (
              <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${ALERT_STYLES[a.level as keyof typeof ALERT_STYLES]}`}>
                {ALERT_ICONS[a.level as keyof typeof ALERT_ICONS]}
                {a.msg}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasLotCharts ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-3">Monthly Revenue Trend</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyData} barSize={22}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" fill="#5B5FEF" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-3">Property Status</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="45%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}>
                  {pieData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v} properties`, '']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 lg:col-span-2">
            <h3 className="font-semibold text-gray-800 text-sm mb-3">Sale Activity (properties/month)</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={monthlyData}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="lotsSold" stroke="#16A34A" strokeWidth={2} dot={{ r: 4 }} name="Properties Sold" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Lot sale charts are empty for this land-dev portfolio. Use the company list above (or the company selector) to open P&amp;L, Balance Sheet, Cash Flow, and Loans.
        </div>
      )}

      {isConsolidated && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Loan &amp; EMI Overview — All Companies</h3>
              <p className="text-xs text-gray-500 mt-0.5">Outstanding balance, monthly EMI and overdue exposure per company</p>
            </div>
            <div className="p-4">
              {emiBarData.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No active loans across portfolio.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={emiBarData} barCategoryGap="25%" barGap={3}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}K`} />
                    <Tooltip content={<CustomEmiTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="outstanding" name="Outstanding ($K)" fill="#5B5FEF" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="emi" name="Monthly EMI ($K)" fill="#F97316" radius={[3, 3, 0, 0]} maxBarSize={18} />
                    <Bar dataKey="overdue" name="Overdue EMI ($K)" fill="#DC2626" radius={[3, 3, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="border-t border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-center">Active Loans</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3 text-right">Monthly EMI</th>
                    <th className="px-4 py-3 text-center">Next EMI</th>
                    <th className="px-4 py-3 text-center">Days Away</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...companyEmiData]
                    .filter(c => c.active.length > 0)
                    .sort((a, b) => (a.daysToEmi ?? 999) - (b.daysToEmi ?? 999))
                    .map(c => {
                      const sb = emiStatusBadge(c.emiStatus);
                      return (
                        <tr key={c.name} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">
                            <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: c.color }} />
                            {c.name}
                          </td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{c.active.length}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-blue-700">{money(c.outstanding)}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-orange-700">{money(c.monthlyEmi)}</td>
                          <td className="px-4 py-2.5 text-center text-gray-600">{c.nextEmiDay ? `${c.nextEmiDay}th` : '—'}</td>
                          <td className="px-4 py-2.5 text-center text-gray-600">
                            {c.daysToEmi !== null ? (c.daysToEmi === 0 ? 'Today' : `${c.daysToEmi}d`) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sb.cls}`}>{sb.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-800">This Month&apos;s EMI Schedule</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {today.toLocaleString('default', { month: 'long', year: 'numeric' })} · Total:{' '}
                  <span className="font-semibold text-orange-700">{money(totalMonthlyEmi)}</span> across {emiCompanyCount} companies
                </p>
              </div>
            </div>
            {calendarEvents.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No EMI payments this month.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {calendarEvents.map((e, i) => (
                  <div key={i} className={`flex flex-col items-center px-3 py-2 rounded-lg border text-xs font-medium ${e.pillColor}`}>
                    <span className="text-xs opacity-60 mb-0.5">{e.day}th</span>
                    <span className="font-semibold">{e.company}</span>
                    <span className="mt-0.5">{fmtK(e.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Loan Portfolio by Company</h3>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Outstanding Balance</p>
                {donutData.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No active loans.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        cx="50%" cy="50%"
                        innerRadius={55} outerRadius={90}
                        paddingAngle={2}
                        onClick={d => setActiveSlice(prev => prev === d.name ? null : d.name)}
                      >
                        {donutData.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={entry.color}
                            opacity={activeSlice === null || activeSlice === entry.name ? 1 : 0.35}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => [money(v), 'Outstanding']} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Interest Rate by Loan</p>
                {rateBarData.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">No active loans.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart layout="vertical" data={rateBarData} barSize={14} margin={{ left: 8, right: 50 }}>
                      <XAxis type="number" domain={[0, 12]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                      <Tooltip formatter={(v: number) => [`${v}%`, 'Rate']} />
                      <Bar dataKey="rate" radius={[0, 3, 3, 0]}>
                        {rateBarData.map((entry, i) => <Cell key={i} fill={entry.barColor} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 px-4 pb-4">
              <div className="border border-red-200 bg-red-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Highest Rate Loan</p>
                {highestRateLoan ? (
                  <>
                    <p className="text-xl font-bold text-red-700">{highestRateLoan.rate}%</p>
                    <p className="text-sm text-gray-700 mt-1">{highestRateCompany?.name ?? '—'}</p>
                  </>
                ) : <p className="text-gray-400 text-sm">No loans</p>}
              </div>
              <div className="border border-orange-200 bg-orange-50 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Monthly EMI Burden</p>
                <p className="text-xl font-bold text-orange-700">{money(portfolioMonthlyEmi)}/mo</p>
                <p className="text-sm text-gray-600 mt-1">{money(portfolioMonthlyEmi * 12)}/year</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">EMI Health — Company Scorecard</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Company</th>
                    <th className="px-4 py-3 text-center">Loans</th>
                    <th className="px-4 py-3 text-right">Avg Rate</th>
                    <th className="px-4 py-3 text-right">Monthly EMI</th>
                    <th className="px-4 py-3 text-right">Cash Available</th>
                    <th className="px-4 py-3 text-right">Coverage</th>
                    <th className="px-4 py-3 text-center">Health</th>
                    <th className="px-4 py-3 text-left">Alerts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {scorecardData.map(c => {
                    const hb = healthBadge(c.monthlyEmi > 0 ? c.coverage : 99);
                    return (
                      <tr key={c.name} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: c.color }} />
                          {c.name}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-600">{c.active.length}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{c.avgRate > 0 ? `${c.avgRate.toFixed(1)}%` : '—'}</td>
                        <td className="px-4 py-3 text-right font-medium text-orange-700">
                          {c.monthlyEmi > 0 ? money(c.monthlyEmi) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{money(c.cashAvailable)}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {c.monthlyEmi > 0
                            ? <span>{c.coverage > 99 ? '∞' : `${c.coverage.toFixed(1)} mo`}</span>
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {c.monthlyEmi > 0
                            ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${hb.cls}`}>{hb.label}</span>
                            : <span className="text-xs text-gray-400">No Loans</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.alertFlags.length > 0
                            ? c.alertFlags.map((f, i) => (
                              <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 mr-1">{f}</span>
                            ))
                            : <span className="text-xs text-green-600">No issues</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-900 text-white font-semibold">
                    <td className="px-4 py-3">Portfolio Total</td>
                    <td className="px-4 py-3 text-center">{companyEmiData.reduce((s, c) => s + c.active.length, 0)}</td>
                    <td className="px-4 py-3 text-right text-gray-400">—</td>
                    <td className="px-4 py-3 text-right text-orange-300">{money(portfolioMonthlyEmi)}/mo</td>
                    <td className="px-4 py-3 text-right text-blue-300">{money(portfolioCash)}</td>
                    <td className="px-4 py-3 text-right text-green-300">
                      {portfolioMonthlyEmi > 0 ? `${(portfolioCash / portfolioMonthlyEmi).toFixed(1)} mo` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400">—</td>
                    <td className="px-4 py-3 text-xs text-gray-400">Outstanding: {money(portfolioOutstanding)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      <CompanyComparisonPanel
        title="Portfolio Company Dashboard"
        columns={[
          { label: 'Revenue', getValue: c => c.property.saleConsideration, higherIsBetter: true },
          { label: 'Cash', getValue: c => c.property.cashAvailable, higherIsBetter: true },
          { label: 'Loan Bal', getValue: c => c.loans.reduce((s, l) => s + l.balance, 0), higherIsBetter: false },
        ]}
        onCompanyClick={id => setSelectedCompanyId(id)}
      />
    </div>
  );
}
