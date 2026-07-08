import { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import type { Period } from '../utils/periodWindow';
import { getPeriodKeys, getTrailingMonthKeys } from '../utils/periodWindow';
import type { CompanyRow, LoanRow, PortfolioSummary } from '../hooks/useRentalCfoData';
import type { ExecutiveOverviewMetrics } from '../hooks/useExecutiveSummaryKpis';
import type { ExportKpiItem, KpiData } from '../utils/rentalKpiEngine';
import type { ArMonth, ArSummaryResponse, OwnerRow } from '../hooks/useExecutiveSummaryData';
import {
  fmtMetricMoney, fmtMetricPct, fmtMoney, fmtPct, UPLOAD_HINTS, periodGapMessage,
} from '../utils/executiveSummaryFormatters';
import type { FinRow } from '../utils/executiveSummaryFinRows';

const P = {
  pageBg: '#F7F1E6', cardBg: '#FBF6EE', border: '#E8DEC8',
  gold: '#D4AF37', text: '#1C1917', muted: '#78716C',
  green: '#15803D', amber: '#F2C14E', red: '#C0392B', teal: '#0F766E',
} as const;

const CARD: React.CSSProperties = {
  background: P.cardBg, border: `1px solid ${P.border}`,
  borderRadius: 12, padding: '20px 24px',
};

const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthSortKey(m: string): number {
  const [mon, yr] = m.split(/[\s-]/);
  return (Number(yr) || 0) * 100 + (MNAMES.indexOf(mon) + 1);
}

function BandShell({ title, subtitle, children, gap }: {
  title: string; subtitle?: string; children: React.ReactNode; gap?: string;
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: gap ?? 16 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: P.text, margin: 0 }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: P.muted, margin: '4px 0 0' }}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function KpiTile({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  const na = value === 'Not available';
  return (
    <div style={{ ...CARD, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: P.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: na ? P.muted : (color ?? P.text) }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: P.muted, marginTop: 4 }}>{sub}</div>}
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

function KpiGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      {children}
    </div>
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
  period: Period | null;
  month: number;
  year: number;
  periodLabel: string;
  entityId: string;
  hasFinancials: boolean;
  hasOwnership: boolean;
  hasAr: boolean;
  latestFinMonth: string | null;
}

function filterByPeriod<T extends { month: string }>(rows: T[], period: Period | null, month: number, year: number): T[] {
  if (!period) return rows;
  const keys = new Set(getPeriodKeys(period, month, year));
  return rows.filter(r => keys.has(r.month));
}

function trailingFinMonths(endMonth: number, endYear: number, count: number): string[] {
  return getTrailingMonthKeys(endMonth, endYear, count);
}

export function buildCeoActionRows(
  portfolio: PortfolioSummary | null,
  loans: LoanRow[],
  arMonths: ArMonth[],
  ownership: OwnerRow[],
  kpi: KpiData | null,
): { property: string; issue: string; kpi: string; impact: string; owner: string; due: string }[] {
  const rows: { property: string; issue: string; kpi: string; impact: string; owner: string; due: string }[] = [];
  const occ = (portfolio?.occupancy_pct ?? 0) * 100;
  if (portfolio && occ > 0 && occ < 85) {
    rows.push({
      property: 'Portfolio', issue: 'Low occupancy', kpi: fmtPct(occ),
      impact: 'Revenue shortfall', owner: 'Asset Mgmt', due: '30 days',
    });
  } else if (portfolio && occ >= 85 && occ < 95) {
    rows.push({
      property: 'Portfolio', issue: 'Vacancy above target', kpi: fmtPct(occ),
      impact: 'GPR gap', owner: 'Leasing', due: '60 days',
    });
  }

  const billed = arMonths.reduce((s, r) => s + r.billed, 0);
  const collected = arMonths.reduce((s, r) => s + r.collected, 0);
  const collRate = billed > 0 ? (collected / billed) * 100 : null;
  if (collRate != null && collRate < 95) {
    rows.push({
      property: 'Portfolio', issue: 'Collection rate below target', kpi: fmtPct(collRate),
      impact: 'Cash flow', owner: 'Collections', due: '14 days',
    });
  }

  if (kpi) {
    const noiM = kpi.totalRevenue > 0 ? (kpi.noi / kpi.totalRevenue) * 100 : null;
    if (noiM != null && noiM < 15) {
      rows.push({
        property: 'Portfolio', issue: 'NOI margin below target', kpi: fmtPct(noiM),
        impact: 'Profitability', owner: 'CFO', due: '90 days',
      });
    }
    const oer = kpi.totalRevenue > 0 ? (kpi.totalExpenses / kpi.totalRevenue) * 100 : null;
    if (oer != null && oer > 70) {
      rows.push({
        property: 'Portfolio', issue: 'Expense ratio high', kpi: fmtPct(oer),
        impact: 'Margin compression', owner: 'CFO', due: '60 days',
      });
    }
  }

  for (const l of loans) {
    const bal = l.loan_balance_as_of ?? 0;
    const val = l.current_property_value ?? 0;
    const ltv = val > 0 ? (bal / val) * 100 : null;
    if (ltv != null && ltv > 75) {
      rows.push({
        property: l.property_name || l.company_name,
        issue: 'LTV above 75%', kpi: fmtPct(ltv),
        impact: 'Refinance / equity risk', owner: 'Treasury', due: '90 days',
      });
    }
    const dscr = l.dscr ?? (l.noi_annual && l.loan_emi ? (l.noi_annual / 12) / l.loan_emi : null);
    if (dscr != null && dscr < 1.1) {
      rows.push({
        property: l.property_name || l.company_name,
        issue: 'DSCR below 1.1x', kpi: `${dscr.toFixed(2)}x`,
        impact: 'Covenant risk', owner: 'Treasury', due: '30 days',
      });
    }
  }

  const partner = ownership[0]?.partner_name ?? '—';
  if (rows.length === 0 && (portfolio || loans.length)) {
    rows.push({
      property: 'Portfolio', issue: 'On track', kpi: 'Healthy',
      impact: '—', owner: partner, due: '—',
    });
  }
  return rows;
}

export default function ExecutiveSummarySixBands(props: SixBandsProps) {
  const {
    overview, kpiView, loanSchedule, portfolio, companies, loans,
    arSummary, arMonths, ownership, finRows, period, month, year, periodLabel,
    entityId, hasFinancials, hasOwnership, hasAr, latestFinMonth,
  } = props;

  const k = kpiView?.k ?? null;
  const scopedCompanies = entityId === 'portfolio'
    ? companies
    : companies.filter(c => c.id === entityId);

  const periodAr = useMemo(
    () => filterByPeriod(arMonths, period, month, year),
    [arMonths, period, month, year],
  );

  const trendMonths = useMemo(() => {
    const keys = trailingFinMonths(month, year, 12);
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
      const noi = row.gpr - row.expense;
      return { month: m.split(' ')[0], full: m, ...row, noi };
    });
  }, [finRows, arMonths, month, year]);

  const rentalTrend = useMemo(() => {
    const keys = getTrailingMonthKeys(month, year, 6);
    return keys.map(m => {
      const ar = arMonths.find(a => a.month === m);
      const co = scopedCompanies[0];
      const occ = portfolio?.occupancy_pct != null ? portfolio.occupancy_pct * 100 : null;
      return {
        month: m.split(' ')[0],
        gpr: ar?.billed ?? 0,
        collected: ar?.collected ?? 0,
        occupancy: occ ?? 0,
      };
    });
  }, [arMonths, month, year, portfolio, scopedCompanies]);

  const totalDebt = overview.totalDebt ?? loans.reduce((s, l) => s + (l.loan_balance_as_of ?? 0), 0);
  const marketValue = loans.reduce((s, l) => s + (l.current_property_value ?? 0), 0);
  const ownedUnits = portfolio?.occupied_units ?? 0;
  const vacantUnits = portfolio?.vacant_units ?? 0;
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
  })).filter(r => r.dscr > 0 || r.balance > 0);

  const ltvByLoan = loans.map(l => {
    const bal = l.loan_balance_as_of ?? 0;
    const val = l.current_property_value ?? 0;
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
      const yr = d.getFullYear();
      const monthsOut = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
      if (monthsOut <= 12) buckets['≤12 mo'] = (buckets['≤12 mo'] ?? 0) + (l.loan_balance_as_of ?? 0);
      else if (monthsOut <= 24) buckets['12–24 mo'] = (buckets['12–24 mo'] ?? 0) + (l.loan_balance_as_of ?? 0);
      else buckets[String(yr)] = (buckets[String(yr)] ?? 0) + (l.loan_balance_as_of ?? 0);
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

  const ceoActions = buildCeoActionRows(portfolio, loans, periodAr, ownership, k);

  const finGap = !hasFinancials
    ? periodGapMessage('P&L financials', periodLabel, latestFinMonth)
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
      {/* BAND 1 */}
      <BandShell title="Band 1 — Portfolio Snapshot" subtitle="Company Registry · Loan Tracker · Ownership">
        <KpiGrid>
          <KpiTile label="Total Units" value={portfolio ? String(portfolio.total_units) : 'Not available'} sub={UPLOAD_HINTS.registry} />
          <KpiTile label="Occupied Units" value={portfolio ? String(portfolio.occupied_units) : 'Not available'} />
          <KpiTile label="Portfolio Market Value" value={marketValue > 0 ? fmtMoney(marketValue) : 'Not available'} sub={loans.length ? 'From loan tracker property values' : UPLOAD_HINTS.loans} />
          <KpiTile label="Total Loan Outstanding" value={fmtMetricMoney(totalDebt)} sub={loans.length ? `${loans.length} loans` : UPLOAD_HINTS.loans} />
        </KpiGrid>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={CARD}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Occupied vs Vacant Units</p>
            {unitDonut.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={unitDonut} dataKey="value" nameKey="name" innerRadius={50} outerRadius={75}>
                    {unitDonut.map((_, i) => <Cell key={i} fill={i === 0 ? P.green : P.amber} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <DataGap message={UPLOAD_HINTS.registry} />}
          </div>
          <div style={CARD}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Units by Company</p>
            {companyBars.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={companyBars}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="units" fill={P.gold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <DataGap message={UPLOAD_HINTS.registry} />}
          </div>
        </div>
      </BandShell>

      {/* BAND 2 */}
      <BandShell title="Band 2 — Rental Performance" subtitle="Rent Receivable · Company Registry">
        {!hasAr && !portfolio ? (
          <DataGap message={`${UPLOAD_HINTS.rentReceivable} for ${periodLabel}.`} />
        ) : (
          <>
            <KpiGrid>
              <KpiTile label="Physical Occupancy" value={fmtMetricPct(overview.occupancyPct)} />
              <KpiTile label="GPR" value={fmtMetricMoney(overview.grossPotentialRent)} />
              <KpiTile label="Collected" value={fmtMetricMoney(overview.totalCollected)} color={P.green} />
              <KpiTile label="Vacancy Loss" value={fmtMetricMoney(overview.vacancyLoss)} color={P.red} />
              <KpiTile label="Collection Rate" value={fmtMetricPct(overview.collectionRate)} />
              <KpiTile label="AR Outstanding" value={fmtMetricMoney(overview.arOutstanding ?? arSummary?.portfolio?.total_outstanding)} />
            </KpiGrid>
            <div style={CARD}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>GPR vs Collected + Occupancy (6 mo to {MNAMES[month - 1]} {year})</p>
              <ResponsiveContainer width="100%" height={240}>
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
              </ResponsiveContainer>
            </div>
          </>
        )}
      </BandShell>

      {/* BAND 3 */}
      <BandShell title="Band 3 — Finance & Profitability" subtitle="Financials P&L · Balance Sheet · Cash Flow">
        {finGap ? (
          <DataGap message={`${UPLOAD_HINTS.financials} for ${periodLabel}. ${finGap}`} />
        ) : (
          <>
            <KpiGrid>
              <KpiTile label="NOI" value={fmtMetricMoney(overview.noi)} color={P.green} />
              <KpiTile label="NOI Margin" value={k && k.totalRevenue > 0 ? fmtPct((k.noi / k.totalRevenue) * 100) : 'Not available'} />
              <KpiTile label="Net Income Margin" value={k && k.totalRevenue > 0 ? fmtPct((k.netIncome / k.totalRevenue) * 100) : 'Not available'} />
              <KpiTile label="Expense Ratio (OER)" value={k && k.totalRevenue > 0 ? fmtPct((k.totalExpenses / k.totalRevenue) * 100) : 'Not available'} />
              <KpiTile label="Cash Balance" value={k ? fmtMoney(k.cash) : 'Not available'} sub="Point-in-time from balance sheet" />
              <KpiTile label="Total Expenses" value={fmtMetricMoney(overview.totalExpenses)} />
            </KpiGrid>
            <div style={CARD}>
              <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Revenue · Expenses · NOI (12 mo)</p>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={trendMonths}>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="gpr" name="Revenue" fill={P.gold} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expense" name="Expenses" fill={P.red} radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="noi" name="NOI" stroke={P.green} strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </BandShell>

      {/* BAND 4 */}
      <BandShell title="Band 4 — Loan & Risk" subtitle="Loan Tracker · Financial Ratios">
        {loans.length === 0 ? (
          <DataGap message={UPLOAD_HINTS.loans} />
        ) : (
          <>
            <KpiGrid>
              {loanSchedule.summary.slice(0, 4).map(item => (
                <KpiTile key={item.label} label={item.label} value={item.value === 'Data not available' ? 'Not available' : item.value} sub={`Target ${item.benchmark}`} />
              ))}
            </KpiGrid>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={CARD}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>DSCR by Property (1.2x covenant)</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dscrByLoan}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="dscr" fill={P.teal} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={CARD}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>LTV by Property</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={ltvByLoan}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="ltv" radius={[3, 3, 0, 0]}>
                      {ltvByLoan.map((e, i) => <Cell key={i} fill={e.high ? P.red : P.gold} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {maturityBuckets.length > 0 && (
              <div style={CARD}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Loan Maturities</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={maturityBuckets}>
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Bar dataKey="amount" fill={P.amber} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </BandShell>

      {/* BAND 5 */}
      <BandShell title="Band 5 — Per-Ownership Profitability" subtitle="Ownership · Financials">
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
              <div style={CARD}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Occupancy vs NOI Margin</p>
                <ResponsiveContainer width="100%" height={220}>
                  <ScatterChart>
                    <XAxis type="number" dataKey="occupancy" name="Occupancy %" unit="%" tick={{ fontSize: 10 }} />
                    <YAxis type="number" dataKey="noiMargin" name="NOI Margin" unit="%" tick={{ fontSize: 10 }} />
                    <ZAxis type="number" dataKey="units" range={[40, 400]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                    <Scatter data={scatterData} fill={P.gold} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </BandShell>

      {/* BAND 6 */}
      <BandShell title="Band 6 — CEO Action List" subtitle="Rule-based flags across AR · P&L · Loans · Ownership">
        {ceoActions.length === 0 ? (
          <DataGap message="Upload data across Financials, Rent Receivable, and Loan Tracker to generate action items." />
        ) : (
          <div style={{ overflowX: 'auto', ...CARD, padding: 0 }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: P.pageBg }}>
                  {['Property', 'Issue', 'KPI', 'Impact', 'Owner', 'Due Date'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', color: P.muted, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ceoActions.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${P.border}` }}>
                    <td style={{ padding: '10px 12px' }}>{r.property}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{r.issue}</td>
                    <td style={{ padding: '10px 12px' }}>{r.kpi}</td>
                    <td style={{ padding: '10px 12px' }}>{r.impact}</td>
                    <td style={{ padding: '10px 12px' }}>{r.owner}</td>
                    <td style={{ padding: '10px 12px' }}>{r.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BandShell>
    </div>
  );
}
