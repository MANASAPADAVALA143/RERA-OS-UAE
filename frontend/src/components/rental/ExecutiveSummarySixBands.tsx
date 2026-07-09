import { useMemo, type ReactNode } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import {
  Building2, Home, Landmark, Banknote, TrendingUp, DollarSign,
  Percent, Wallet, Receipt, Users, AlertCircle, type LucideIcon,
} from 'lucide-react';
import type { Period } from '../../utils/periodWindow';
import { getPeriodKeys, getTrailingMonthKeys } from '../../utils/periodWindow';
import type { CompanyRow, LoanRow, PortfolioSummary } from '../../hooks/useRentalCfoData';
import type { ExecutiveOverviewMetrics } from '../../hooks/useExecutiveSummaryKpis';
import type { ExportKpiItem, KpiData, ParsedFinancials } from '../../utils/rentalKpiEngine';
import type { ArMonth, ArSummaryResponse, OwnerRow, QbApAgingLatest } from '../../hooks/useExecutiveSummaryData';
import type { QBAgingLatest } from './QbArAgingUploadPanel';
import {
  fmtMetricMoney, fmtMetricPct, fmtMoney, fmtPct, UPLOAD_HINTS, periodGapMessage,
} from '../../utils/executiveSummaryFormatters';
import {
  buildDebtComposition, buildMarketValueComposition, resolvePortfolioMarketValue,
} from '../../utils/executiveSummaryPortfolio';
import {
  buildCashCycleTrend, buildMarginTrend, hasCashCycleData, hasMarginTrendData,
} from '../../utils/executiveSummaryCharts';
import { buildRegistryTrend, type RegistryOpsMetrics } from '../../utils/executiveSummaryRegistry';
import type { FinRow } from '../../utils/executiveSummaryFinRows';

const P = {
  pageBg: '#F7F1E6', cardBg: '#F1F5F9', border: '#E2E8F0',
  gold: '#6366F1', text: '#1C1917', muted: '#78716C',
  green: '#15803D', amber: '#F2C14E', red: '#C0392B', teal: '#0F766E',
  blue: '#2563EB', purple: '#7C3AED',
} as const;

const DONUT_COLORS = [P.gold, P.teal, P.green, P.blue, P.purple, P.amber, P.red, '#64748B'];

const CARD: React.CSSProperties = {
  background: P.cardBg,
  border: `1px solid ${P.border}`,
  borderRadius: 12,
  padding: '20px 24px',
  boxShadow: '0 1px 3px rgba(28,25,23,0.06)',
};

const KPI_CARD: React.CSSProperties = {
  ...CARD,
  minHeight: 108,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
};

const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function BandShell({ title, subtitle, children, gap }: {
  title: string; subtitle?: string; children: React.ReactNode; gap?: string;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: gap ?? 20, width: '100%' }}>
      <div style={{ borderBottom: `1px solid ${P.border}`, paddingBottom: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: P.text, margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: P.muted, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function KpiTile({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: LucideIcon;
}) {
  const na = value === 'Not available';
  return (
    <div style={KPI_CARD}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
        {Icon && (
          <Icon size={18} strokeWidth={1.75} color={na ? P.muted : P.gold} style={{ flexShrink: 0, opacity: 0.85 }} />
        )}
      </div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: na ? P.muted : (color ?? P.text), lineHeight: 1.15 }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: 12, color: P.muted, marginTop: 4 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, height = 220 }: {
  title: string; subtitle?: string; children: ReactNode; height?: number;
}) {
  return (
    <div style={CARD}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px', color: P.text }}>{title}</p>
      {subtitle && <p style={{ fontSize: 11, color: P.muted, margin: '0 0 12px' }}>{subtitle}</p>}
      {!subtitle && <div style={{ marginBottom: 12 }} />}
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function DataGap({ message }: { message: string }) {
  return (
    <div style={{ ...CARD, padding: '28px 20px', textAlign: 'center', color: P.muted, fontSize: 13, lineHeight: 1.5 }}>
      {message}
    </div>
  );
}

function KpiGrid({ children, columns }: { children: React.ReactNode; columns?: number }) {
  const n = columns ?? Math.max(1, Array.isArray(children) ? children.length : 1);
  return (
    <div
      className={`exec-kpi-grid exec-cols-${n}`}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
        gap: 14,
        width: '100%',
      }}
    >
      {children}
    </div>
  );
}

function CompositionDonut({ data, title, subtitle, emptyMessage }: {
  data: { name: string; value: number }[];
  title: string;
  subtitle?: string;
  emptyMessage: string;
}) {
  if (!data.length) return <DataGap message={emptyMessage} />;
  return (
    <ChartCard title={title} subtitle={subtitle} height={200}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v: number) => fmtMoney(v)} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ChartCard>
  );
}

export interface SixBandsProps {
  overview: ExecutiveOverviewMetrics;
  kpiView: { k: KpiData; label: string } | null;
  kpiSets: {
    profitability: ExportKpiItem[];
    balanceSheet: ExportKpiItem[];
    occupancy: ExportKpiItem[];
    pricing: ExportKpiItem[];
    returns: ExportKpiItem[];
  };
  loanSchedule: { summary: ExportKpiItem[] };
  portfolio: PortfolioSummary | null;
  companies: CompanyRow[];
  loans: LoanRow[];
  arSummary: ArSummaryResponse | null;
  arMonths: ArMonth[];
  ownership: OwnerRow[];
  finRows: FinRow[];
  activeFins: ParsedFinancials[];
  qbArAging: QBAgingLatest | null;
  qbApAging: QbApAgingLatest | null;
  hasApAging: boolean;
  period: Period | null;
  month: number;
  year: number;
  periodLabel: string;
  entityId: string;
  hasFinancials: boolean;
  hasOwnership: boolean;
  hasAr: boolean;
  latestFinMonth: string | null;
  registryOps: RegistryOpsMetrics;
}

export default function ExecutiveSummarySixBands(props: SixBandsProps) {
  const {
    overview, kpiView, loanSchedule, portfolio, companies, loans,
    arSummary, arMonths, ownership, finRows, activeFins,
    qbArAging, qbApAging, hasApAging,
    period, month, year, periodLabel,
    entityId, hasFinancials, hasOwnership, hasAr, latestFinMonth, registryOps,
  } = props;

  const k = kpiView?.k ?? null;
  const scopedCompanies = entityId === 'portfolio'
    ? companies
    : companies.filter(c => c.id === entityId);

  const trendMonths = useMemo(() => {
    const keys = getTrailingMonthKeys(month, year, 12);
    const byMonth: Record<string, { gpr: number; collected: number; expense: number; noi: number }> = {};
    for (const r of finRows) {
      if (!keys.includes(r.month)) continue;
      if (r.category === 'income' || r.category === 'revenue') {
        byMonth[r.month] = byMonth[r.month] ?? { gpr: 0, collected: 0, expense: 0, noi: 0 };
        byMonth[r.month].gpr += r.amount;
      } else if (r.category === 'expense') {
        byMonth[r.month] = byMonth[r.month] ?? { gpr: 0, collected: 0, expense: 0, noi: 0 };
        byMonth[r.month].expense += r.amount;
      }
    }
    for (const a of arMonths) {
      if (!keys.includes(a.month)) continue;
      byMonth[a.month] = byMonth[a.month] ?? { gpr: 0, collected: 0, expense: 0, noi: 0 };
      byMonth[a.month].collected = a.collected;
      if (!byMonth[a.month].gpr) byMonth[a.month].gpr = a.billed;
    }
    return keys.map(m => {
      const row = byMonth[m] ?? { gpr: 0, collected: 0, expense: 0, noi: 0 };
      return { month: m.split(' ')[0], full: m, ...row, noi: row.gpr - row.expense };
    });
  }, [finRows, arMonths, month, year]);

  const marginTrend = useMemo(
    () => buildMarginTrend(activeFins, month, year, 12),
    [activeFins, month, year],
  );

  const cashCycleTrend = useMemo(
    () => buildCashCycleTrend(qbArAging?.trend ?? [], qbApAging?.trend ?? []),
    [qbArAging, qbApAging],
  );

  const rentalTrend = useMemo(() => {
    const fromRegistry = buildRegistryTrend(
      scopedCompanies, entityId, overview.occupancyPct, 6,
    );
    if (fromRegistry.length) return fromRegistry;

    const keys = getTrailingMonthKeys(month, year, 6);
    return keys.map(m => {
      const ar = arMonths.find(a => a.month === m);
      const occ = overview.occupancyPct;
      return {
        month: m.split(' ')[0],
        gpr: ar?.billed ?? 0,
        collected: ar?.collected ?? 0,
        occupancy: occ ?? 0,
      };
    });
  }, [scopedCompanies, entityId, overview.occupancyPct, arMonths, month, year]);

  const hasRegistryOps = registryOps.totalUnits > 0
    || registryOps.grossPotentialRent != null
    || registryOps.collected != null
    || overview.occupancyPct != null;

  const totalDebt = overview.totalDebt ?? loans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);
  const buildingsFromFin = k?.buildings ?? 0;
  const portfolioGpr = portfolio?.gross_potential_rent
    ?? scopedCompanies.reduce((s, c) => s + (c.gross_potential_rent ?? 0), 0);
  const marketValueResult = useMemo(
    () => resolvePortfolioMarketValue({
      loans, buildingsFromFinancials: buildingsFromFin,
      companies: scopedCompanies, ownership, portfolioGpr,
    }),
    [loans, buildingsFromFin, scopedCompanies, ownership, portfolioGpr],
  );
  const marketValue = marketValueResult.value;
  const assetComposition = useMemo(
    () => buildMarketValueComposition({ companies: scopedCompanies, loans, ownership }),
    [scopedCompanies, loans, ownership],
  );
  const debtComposition = useMemo(() => buildDebtComposition(loans), [loans]);

  const useRegistryUnits = registryOps.totalUnits > 0;
  const totalUnits = useRegistryUnits ? registryOps.totalUnits : (portfolio?.total_units ?? 0);
  const ownedUnits = useRegistryUnits
    ? registryOps.occupiedUnits
    : (portfolio?.occupied_units ?? 0);
  const vacantUnits = useRegistryUnits
    ? registryOps.vacantUnits
    : (portfolio?.vacant_units ?? Math.max(0, totalUnits - ownedUnits));
  const occupancyPct = overview.occupancyPct
    ?? (totalUnits > 0 ? (ownedUnits / totalUnits) * 100 : null);
  const unitDonut = [
    { name: 'Occupied', value: ownedUnits },
    { name: 'Vacant', value: vacantUnits },
  ].filter(d => d.value > 0);

  const companyBars = scopedCompanies.map(c => ({
    name: c.company_name.split(' ')[0],
    units: c.total_units,
    gpr: c.gross_potential_rent,
  }));

  const dscrByLoan = loans.map(l => ({
    name: (l.property_name || l.company_name).slice(0, 14),
    dscr: l.dscr ?? (l.noi_annual && l.loan_emi ? (l.noi_annual / 12) / l.loan_emi : 0),
    balance: l.loan_balance_as_of ?? 0,
  })).filter(r => r.balance > 0);

  const ltvByLoan = loans.map(l => {
    const bal = l.loan_balance_as_of ?? 0;
    const val = l.current_property_value ?? l.loan_amount ?? 0;
    return {
      name: (l.property_name || l.company_name).slice(0, 14),
      ltv: val > 0 ? (bal / val) * 100 : 0,
      high: val > 0 && (bal / val) > 0.75,
    };
  }).filter(r => r.ltv > 0);

  const maturityBuckets = useMemo(() => {
    const buckets: Record<string, number> = {};
    const now = new Date(year, month - 1, 1);
    for (const l of loans) {
      if (!l.loan_maturity_date) continue;
      const d = new Date(l.loan_maturity_date);
      const monthsOut = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
      if (monthsOut <= 12) buckets['≤12 mo'] = (buckets['≤12 mo'] ?? 0) + (l.loan_balance_as_of ?? 0);
      else if (monthsOut <= 24) buckets['12–24 mo'] = (buckets['12–24 mo'] ?? 0) + (l.loan_balance_as_of ?? 0);
      else buckets[String(d.getFullYear())] = (buckets[String(d.getFullYear())] ?? 0) + (l.loan_balance_as_of ?? 0);
    }
    return Object.entries(buckets).map(([label, amount]) => ({ label, amount }));
  }, [loans, month, year]);

  const ownershipRows = useMemo(() => {
    const rows: {
      property: string; partner: string; units: number; occupancy: string;
      noiMargin: string; dscr: string; arrears: string;
    }[] = [];
    for (const p of ownership) {
      for (const h of p.holdings) {
        const co = companies.find(c => c.company_name === h.company_name);
        const loan = loans.find(l => l.company_name === h.company_name);
        const noi = h.noi_this_month ?? co?.noi_this_month ?? 0;
        const rev = co?.gross_potential_rent ?? co?.collected_this_month ?? 0;
        const noiM = rev > 0 ? (noi / rev) * 100 : null;
        const dscr = loan?.dscr ?? null;
        rows.push({
          property: h.property_name || h.company_name,
          partner: p.partner_name,
          units: co?.total_units ?? 0,
          occupancy: co ? fmtPct(co.occupancy_pct * 100) : 'Not available',
          noiMargin: noiM != null ? fmtPct(noiM) : 'Not available',
          dscr: dscr != null ? `${dscr.toFixed(2)}x` : '—',
          arrears: co ? fmtMoney(co.arrears_total) : 'Not available',
        });
      }
    }
    return rows;
  }, [ownership, companies, loans]);

  const scatterData = ownershipRows
    .filter(r => r.occupancy !== 'Not available' && r.noiMargin !== 'Not available')
    .map(r => ({
      name: r.property,
      occupancy: parseFloat(r.occupancy),
      noiMargin: parseFloat(r.noiMargin),
      units: r.units || 1,
    }));

  const finGap = !hasFinancials
    ? (latestFinMonth
      ? periodGapMessage('P&L financials', periodLabel, latestFinMonth)
      : UPLOAD_HINTS.financials)
    : null;

  const arrearsTotal = registryOps.arrears
    ?? portfolio?.arrears_total
    ?? overview.arOutstanding
    ?? null;

  const partnerSharePayable = portfolio?.partner_share_payable ?? null;
  const hasPartnerData = portfolio?.has_partner_data !== false;

  const ownershipSummary = useMemo(() => {
    if (!ownership.length) return { partners: 0, equity: 0 };
    const partners = ownership.length;
    const equity = ownership.reduce((sum, p) => sum + p.holdings.reduce((hs, h) => {
      const v = h.book_value ?? h.cost_basis ?? h.capital_contributed ?? 0;
      return hs + (v ?? 0);
    }, 0), 0);
    return { partners, equity };
  }, [ownership]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40, width: '100%' }}>
      <style>{`
        .exec-kpi-grid { width: 100%; }
        @media (max-width: 1200px) {
          .exec-kpi-grid.exec-cols-6 { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
          .exec-kpi-grid.exec-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 640px) {
          .exec-kpi-grid.exec-cols-6,
          .exec-kpi-grid.exec-cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
      `}</style>
      {/* Portfolio Snapshot */}
      <BandShell title="Portfolio Snapshot" subtitle="Company Registry · Loan Tracker · Ownership">
        <KpiGrid columns={6}>
          <KpiTile icon={Building2} label="Total Units" value={totalUnits > 0 ? String(totalUnits) : 'Not available'}
            sub={totalUnits > 0 ? `${vacantUnits} vacant` : UPLOAD_HINTS.registry} />
          <KpiTile icon={Home} label="Occupied Units"
            value={ownedUnits > 0 ? String(ownedUnits) : 'Not available'}
            sub={occupancyPct != null ? `${fmtPct(occupancyPct)} occupancy` : undefined} color={P.green} />
          <KpiTile icon={Landmark} label="Portfolio Market Value"
            value={marketValue > 0 ? fmtMoney(marketValue) : 'Not available'}
            sub={marketValue > 0 ? marketValueResult.label : UPLOAD_HINTS.loans} />
          <KpiTile icon={Banknote} label="Total Loan Outstanding" value={fmtMetricMoney(totalDebt)}
            sub={loans.length ? `${loans.length} loans` : UPLOAD_HINTS.loans} />
          <KpiTile icon={AlertCircle} label="Total Arrears"
            value={arrearsTotal != null ? fmtMoney(arrearsTotal) : 'Not available'}
            sub={arrearsTotal != null && arrearsTotal > 5000 ? 'Above $5k threshold' : 'Rent Receivable · Registry'}
            color={arrearsTotal != null && arrearsTotal > 5000 ? P.red : undefined} />
          <KpiTile icon={Users} label={hasPartnerData && partnerSharePayable != null ? 'Partner Share Payable' : 'Active Partners'}
            value={
              hasPartnerData && partnerSharePayable != null
                ? fmtMoney(partnerSharePayable)
                : ownershipSummary.partners > 0
                  ? String(ownershipSummary.partners)
                  : 'Not available'
            }
            sub={
              hasPartnerData && partnerSharePayable != null
                ? 'Limited / silent partner NOI share'
                : ownershipSummary.equity > 0
                  ? `${fmtMoney(ownershipSummary.equity)} total equity`
                  : hasOwnership ? 'From Ownership' : UPLOAD_HINTS.ownership
            } />
        </KpiGrid>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {unitDonut.length ? (
            <CompositionDonut data={unitDonut} title="Unit Mix" subtitle="Occupied vs vacant"
              emptyMessage={UPLOAD_HINTS.registry} />
          ) : <DataGap message={UPLOAD_HINTS.registry} />}
          <CompositionDonut
            data={assetComposition}
            title="Asset Composition"
            subtitle={assetComposition.length ? 'By company / property' : 'Partial data from registry & ownership'}
            emptyMessage="Upload loan property values, financials, or ownership to see composition."
          />
          <CompositionDonut
            data={debtComposition}
            title="Debt by Property"
            subtitle={loans.length ? 'Outstanding balances' : undefined}
            emptyMessage={UPLOAD_HINTS.loans}
          />
        </div>
        {companyBars.length > 0 && (
          <ChartCard title="Units by Company" subtitle="Company Registry" height={200}>
            <BarChart data={companyBars}>
              <CartesianGrid strokeDasharray="3 3" stroke={P.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="units" fill={P.gold} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartCard>
        )}
      </BandShell>

      {/* Rental Performance */}
      <BandShell title="Rental Performance" subtitle={
        overview.registryMonth
          ? `Company Registry · ${overview.registryMonth}`
          : 'Company Registry'
      }>
        {!hasRegistryOps ? (
          <DataGap message={`${UPLOAD_HINTS.registry} for ${periodLabel}.`} />
        ) : (
          <>
            <KpiGrid columns={6}>
              <KpiTile icon={Percent} label="Physical Occupancy" value={fmtMetricPct(overview.occupancyPct)} />
              <KpiTile icon={TrendingUp} label="GPR" value={fmtMetricMoney(overview.grossPotentialRent)} />
              <KpiTile icon={DollarSign} label="Collected" value={fmtMetricMoney(overview.totalCollected)} color={P.green} />
              <KpiTile icon={Receipt} label="Vacancy Loss" value={fmtMetricMoney(overview.vacancyLoss)} color={P.red} />
              <KpiTile icon={Percent} label="Collection Rate" value={fmtMetricPct(overview.collectionRate)} />
              <KpiTile icon={Wallet} label="AR Outstanding"
                value={fmtMetricMoney(overview.arOutstanding ?? arSummary?.portfolio?.total_outstanding)} />
            </KpiGrid>
            <ChartCard title={`GPR vs Collected + Occupancy`} subtitle={`6 mo trailing · ${MNAMES[month - 1]} ${year}`} height={240}>
              <ComposedChart data={rentalTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="l" dataKey="gpr" name="GPR" fill={P.gold} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="l" dataKey="collected" name="Collected" fill={P.green} radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="occupancy" name="Occupancy %" stroke={P.teal} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ChartCard>
          </>
        )}
      </BandShell>

      {/* Finance & Profitability */}
      <BandShell title="Finance & Profitability" subtitle="Financials P&L · Balance Sheet · AR/AP Aging">
        {finGap ? (
          <DataGap message={latestFinMonth ? `${finGap} Select ${latestFinMonth} in the period picker.` : finGap} />
        ) : (
          <>
            <KpiGrid columns={6}>
              <KpiTile icon={DollarSign} label="NOI" value={fmtMetricMoney(overview.noi)} color={P.green} />
              <KpiTile icon={Percent} label="NOI Margin"
                value={k && k.totalRevenue > 0 ? fmtPct((k.noi / k.totalRevenue) * 100) : 'Not available'} />
              <KpiTile icon={Percent} label="Net Income Margin"
                value={k && k.totalRevenue > 0 ? fmtPct((k.netIncome / k.totalRevenue) * 100) : 'Not available'} />
              <KpiTile icon={Percent} label="Expense Ratio (OER)"
                value={k && k.totalRevenue > 0 ? fmtPct((k.totalExpenses / k.totalRevenue) * 100) : 'Not available'} />
              <KpiTile icon={Wallet} label="Cash Balance" value={k ? fmtMoney(k.cash) : 'Not available'}
                sub="Point-in-time from balance sheet" />
              <KpiTile icon={Receipt} label="Total Expenses" value={fmtMetricMoney(overview.totalExpenses)} />
            </KpiGrid>
            <ChartCard title="Revenue · Expenses · NOI" subtitle="12-month trailing" height={240}>
              <ComposedChart data={trendMonths}>
                <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="gpr" name="Revenue" fill={P.gold} radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Expenses" fill={P.red} radius={[3, 3, 0, 0]} />
                <Line type="monotone" dataKey="noi" name="NOI" stroke={P.green} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ChartCard>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
              {hasMarginTrendData(marginTrend) ? (
                <ChartCard title="Margin Trends" subtitle="NOI · Net Income · Expense ratio (%)" height={240}>
                  <LineChart data={marginTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => `${v?.toFixed(1)}%`} />
                    <Legend />
                    <Line type="monotone" dataKey="noiMargin" name="NOI Margin" stroke={P.green} strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="netMargin" name="Net Income Margin" stroke={P.teal} strokeWidth={2} dot={false} connectNulls />
                    <Line type="monotone" dataKey="expenseRatio" name="Expense Ratio" stroke={P.amber} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ChartCard>
              ) : (
                <DataGap message="Upload Financials P&L with monthly columns for margin trends." />
              )}
              {hasCashCycleData(cashCycleTrend) ? (
                <ChartCard
                  title="Cash Conversion Cycle"
                  subtitle={hasApAging ? 'DSO · DPO · CCC (DSO − DPO)' : 'DSO only — upload QB AP Aging for DPO'}
                  height={240}
                >
                  <LineChart data={cashCycleTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => `${v}d`} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => `${v} days`} />
                    <Legend />
                    <Line type="monotone" dataKey="dso" name="DSO" stroke={P.blue} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    {hasApAging && (
                      <>
                        <Line type="monotone" dataKey="dpo" name="DPO" stroke={P.purple} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        <Line type="monotone" dataKey="ccc" name="CCC" stroke={P.gold} strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls />
                      </>
                    )}
                  </LineChart>
                </ChartCard>
              ) : (
                <DataGap message="Upload QB AR Aging snapshots (Rent Receivable → AR Dashboard) for DSO trend. AP Aging adds DPO." />
              )}
            </div>
            <p style={{ fontSize: 12, color: P.muted, margin: 0, fontStyle: 'italic' }}>
              Actual vs Budget: not available — EstateCFO Rentals has no budget/forecast upload yet (PropDev construction budgets only).
            </p>
          </>
        )}
      </BandShell>

      {/* Loan & Risk */}
      <BandShell title="Loan & Risk" subtitle="Loan Tracker · Financial Ratios">
        {loans.length === 0 ? (
          <DataGap message={UPLOAD_HINTS.loans} />
        ) : (
          <>
            <KpiGrid columns={4}>
              {loanSchedule.summary.slice(0, 4).map(item => (
                <KpiTile key={item.label} label={item.label}
                  value={item.value === 'Data not available' ? 'Not available' : item.value}
                  sub={`Target ${item.benchmark}`} />
              ))}
            </KpiGrid>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <ChartCard title="DSCR by Property" subtitle="1.2× covenant reference" height={220}>
                <BarChart data={dscrByLoan}>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.border} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="dscr" fill={P.teal} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartCard>
              <ChartCard title="LTV by Property" height={220}>
                <BarChart data={ltvByLoan}>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.border} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="ltv" radius={[3, 3, 0, 0]}>
                    {ltvByLoan.map((e, i) => <Cell key={i} fill={e.high ? P.red : P.gold} />)}
                  </Bar>
                </BarChart>
              </ChartCard>
            </div>
            {maturityBuckets.length > 0 && (
              <ChartCard title="Loan Maturities" height={180}>
                <BarChart data={maturityBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.border} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  <Bar dataKey="amount" fill={P.amber} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartCard>
            )}
          </>
        )}
      </BandShell>

      {/* Ownership & Profitability */}
      <BandShell title="Ownership & Profitability" subtitle="Ownership · Financials · Company Registry">
        {!hasOwnership ? (
          <DataGap message={UPLOAD_HINTS.ownership} />
        ) : (
          <>
            <div style={{ overflowX: 'auto', ...CARD, padding: 0 }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: P.pageBg }}>
                    {['Property', 'Partner', 'Units', 'Occupancy', 'NOI Margin', 'DSCR', 'Arrears'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: P.muted, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ownershipRows.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${P.border}` }}>
                      <td style={{ padding: '10px 12px' }}>{r.property}</td>
                      <td style={{ padding: '10px 12px' }}>{r.partner}</td>
                      <td style={{ padding: '10px 12px' }}>{r.units}</td>
                      <td style={{ padding: '10px 12px' }}>{r.occupancy}</td>
                      <td style={{ padding: '10px 12px', color: parseFloat(r.noiMargin) < 15 ? P.red : P.text }}>{r.noiMargin}</td>
                      <td style={{ padding: '10px 12px' }}>{r.dscr}</td>
                      <td style={{ padding: '10px 12px' }}>{r.arrears}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scatterData.length > 0 && (
              <ChartCard title="Occupancy vs NOI Margin" height={220}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                  <XAxis type="number" dataKey="occupancy" name="Occupancy %" unit="%" tick={{ fontSize: 10 }} />
                  <YAxis type="number" dataKey="noiMargin" name="NOI Margin" unit="%" tick={{ fontSize: 10 }} />
                  <ZAxis type="number" dataKey="units" range={[40, 400]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter data={scatterData} fill={P.gold} />
                </ScatterChart>
              </ChartCard>
            )}
          </>
        )}
      </BandShell>
    </div>
  );
}
