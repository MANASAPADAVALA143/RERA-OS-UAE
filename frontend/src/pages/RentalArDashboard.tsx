import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, Line, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, Legend, AreaChart,
} from 'recharts';
import api from '../services/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QBAgingTotals {
  current: number; days_1_30: number; days_31_60: number;
  days_61_90: number; days_91_plus: number; total: number; overdue: number;
}
interface QBAgingCompany extends QBAgingTotals { company_id: string; company_name: string; }
interface QBAgingTrendPoint extends QBAgingTotals { month: string; as_of_date: string; }
interface QBAgingLatest {
  has_data: boolean;
  snapshot_count: number;
  latest_snapshot?: { snapshot_month: string; uploaded_at: string; row_count: number; unmatched_count: number };
  portfolio_totals?: QBAgingTotals;
  dso_estimate?: number | null;
  by_company: QBAgingCompany[];
  unmatched: { customer: string; unit_ref?: string; building: string }[];
  credit_rows: { customer: string; has_credit: boolean; days_61_90: number; days_91_plus: number }[];
  trend: QBAgingTrendPoint[];
  trend_ready: boolean;
}
interface QBPreview {
  as_of_date: string; snapshot_month: string;
  rows: unknown[]; row_count: number; matched_count: number; unmatched_count: number;
  unmatched: { customer: string; unit_ref?: string; building: string }[];
  credit_rows: { customer: string; has_credit: boolean; days_61_90: number; days_91_plus: number }[];
  skipped_subtotals: number;
  portfolio_totals: QBAgingTotals;
}

interface TenantAgingRow {
  customer: string; unit_ref: string; building: string;
  lease_end: string | null; last_payment_date: string | null;
  current: number; days_1_30: number; days_31_60: number;
  days_61_90: number; days_91_plus: number;
  total: number; overdue: number;
  has_credit: boolean; is_unmatched: boolean;
  matched_company_id: string | null; action_status: 'Review' | 'Monitor' | 'Current';
}
interface TenantAgingResponse {
  has_data: boolean; snapshot_month: string | null; rows: TenantAgingRow[];
}

interface MonthlyDetail {
  month: string;
  billed: number;
  collected: number;
  outstanding: number;
  collection_rate: number;
  data_source: 'rent_receivable' | 'pl_fallback';
  recon_flag: { rent_receivable: number; pl: number; diff_pct: number } | null;
}

interface CompanySummary {
  company_id: string;
  company_name: string;
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  billed_per_month: number;
  vacancy_loss_per_month: number;
  last_sync_month: string | null;
  has_rent_receivable: boolean;
  has_pl_data: boolean;
  monthly: MonthlyDetail[];
  latest_month: string | null;
  latest_collected: number;
  latest_outstanding: number;
  latest_rate: number;
  pl_lines_unmatched: string[];
}

interface ArSummaryResponse {
  companies: CompanySummary[];
  portfolio: {
    total_billed: number;
    total_collected: number;
    total_outstanding: number;
    collection_rate: number;
    vacancy_loss: number;
    occupied_units: number;
    total_units: number;
  };
  monthly_trend: { month: string; billed: number; collected: number }[];
  available_months: string[];
  unmatched_lines: { company: string; label: string }[];
  generated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$  = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtK  = (v: number) => `$${(Math.abs(v) / 1000).toFixed(0)}K`;
const pct   = (v: number) => `${Math.min(v, 999).toFixed(1)}%`;
const short = (m: string) => m.replace(/-\d{4}$/, '');

const STATUS_COLORS = ['#166534','#F2C94C','#F5A623','#B91C1C','#2F80ED','#8B5CF6','#EC4899','#06B6D4','#D4AF37'];

function getStatus(rate: number, collected: number): { label: string; bg: string; color: string } {
  if (collected === 0) return { label: 'Zero-Pay', bg: '#FEE2E2', color: '#991B1B' };
  if (rate >= 95)      return { label: 'Paid',     bg: '#DCFCE7', color: '#166534' };
  if (rate >= 85)      return { label: 'Partial',  bg: '#FEF3C7', color: '#92400E' };
  return                      { label: 'Low',      bg: '#FEE2E2', color: '#991B1B' };
}

const SEL = { fontSize: 12, border: '1px solid #E8DEC8', borderRadius: 6, padding: '5px 10px', background: '#FBF6EE', color: '#374151', cursor: 'pointer' } as const;
const CARD = { background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: 16 } as const;

// ── Billed-vs-Collected custom tooltip ───────────────────────────────────────
function BvcTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null;
  const row       = payload[0]?.payload ?? {};
  const billed    = row.billed    ?? 0;
  const collected = row.collected ?? 0;
  const gap       = Math.max(0, billed - collected);
  const realPct   = billed > 0 ? (collected / billed * 100).toFixed(1) : null;
  const byCompany: { name: string; collected: number }[] = row.byCompany ?? [];
  return (
    <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 14px', fontSize: 12, maxWidth: 260, fontVariantNumeric: 'tabular-nums lining-nums' }}>
      <p style={{ fontWeight: 700, color: '#1C1917', marginBottom: 8 }}>{row.full ?? row.month}</p>
      <p style={{ color: '#4E79A7' }}>Billed: {fmt$(billed)}</p>
      <p style={{ color: '#166534' }}>Collected: {fmt$(collected)}</p>
      <p style={{ color: '#B91C1C' }}>Gap: {fmt$(gap)}</p>
      {realPct !== null && <p style={{ color: '#78716C', marginTop: 3 }}>Realization: {realPct}%</p>}
      {byCompany.length > 1 && (
        <div style={{ marginTop: 8, borderTop: '1px solid #E8DEC8', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[...byCompany].sort((a, b) => b.collected - a.collected).map(c => (
            <p key={c.name} style={{ fontSize: 11, color: '#6B6B6B' }}>{c.name}: {fmt$(c.collected)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RentalArDashboard() {
  // raw data from API — always ALL companies for the selected month
  const [rawData,  setRawData]  = useState<ArSummaryResponse | null>(null);
  const [loading,  setLoading]  = useState(true);

  // filters — month triggers API refetch, company is client-side only
  const [selMonth,  setSelMonth]  = useState('');   // '' = All Months
  const [selCoId,   setSelCoId]   = useState('');   // '' = All Companies
  const [statusFlt, setStatusFlt] = useState('All');
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [chartMonth, setChartMonth] = useState(''); // click-to-filter from chart

  // ── QB AR Aging state ─────────────────────────────────────────────────────
  const [qbAging, setQbAging] = useState<QBAgingLatest | null>(null);
  const [qbLoading, setQbLoading] = useState(true);
  const [qbFile, setQbFile] = useState<File | null>(null);
  const [qbAsOfDate, setQbAsOfDate] = useState('');
  const [qbPreview, setQbPreview] = useState<QBPreview | null>(null);
  const [qbUploading, setQbUploading] = useState(false);
  const [qbConfirming, setQbConfirming] = useState(false);
  const [qbError, setQbError] = useState('');
  const [showQbPanel, setShowQbPanel] = useState(false);
  const [showQbUnmatched, setShowQbUnmatched] = useState(false);
  const qbFileRef = useRef<HTMLInputElement>(null);

  const fetchQbAging = () => {
    setQbLoading(true);
    api.get<QBAgingLatest>('/api/rentals/ar-ap/qb-aging/latest')
      .then(r => setQbAging(r.data))
      .catch(() => setQbAging(null))
      .finally(() => setQbLoading(false));
  };

  useEffect(() => { fetchQbAging(); }, []);

  const handleQbPreview = async () => {
    if (!qbFile || !qbAsOfDate) { setQbError('Select a file and set the as-of date.'); return; }
    setQbError(''); setQbUploading(true); setQbPreview(null);
    const fd = new FormData();
    fd.append('file', qbFile);
    fd.append('as_of_date', qbAsOfDate);
    fd.append('snapshot_month', qbAsOfDate.slice(0, 7)); // YYYY-MM
    try {
      const r = await api.post<QBPreview>('/api/rentals/ar-ap/qb-aging/preview', fd);
      setQbPreview(r.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setQbError(msg || 'Preview failed.');
    } finally { setQbUploading(false); }
  };

  // ── Tenant Aging state ───────────────────────────────────────────────────
  const [tenantAging, setTenantAging] = useState<TenantAgingResponse | null>(null);
  const [tenantSortCol, setTenantSortCol] = useState<keyof TenantAgingRow>('total');
  const [tenantSortAsc, setTenantSortAsc] = useState(false);

  const fetchTenantAging = () => {
    api.get<TenantAgingResponse>('/api/rentals/ar-ap/qb-aging/tenants')
      .then(r => setTenantAging(r.data))
      .catch(() => setTenantAging(null));
  };
  useEffect(() => { fetchTenantAging(); }, []);

  const handleQbConfirm = async () => {
    if (!qbPreview || !qbAsOfDate) return;
    setQbConfirming(true); setQbError('');
    try {
      // Send the already-parsed preview rows as JSON — no re-upload needed
      await api.post('/api/rentals/ar-ap/qb-aging/confirm', {
        as_of_date:     qbAsOfDate,
        snapshot_month: qbPreview.snapshot_month,
        rows:           qbPreview.rows,
      });
      setQbPreview(null); setQbFile(null); setQbAsOfDate('');
      if (qbFileRef.current) qbFileRef.current.value = '';
      setShowQbPanel(false);
      fetchQbAging();
      fetchTenantAging();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string | object } } };
      const raw = err?.response?.data?.detail;
      const msg = typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : 'Confirm failed — check server logs.';
      setQbError(msg);
    } finally { setQbConfirming(false); }
  };

  // Fetch when month changes (company filter is client-side)
  useEffect(() => {
    setLoading(true);
    const params = selMonth ? `?month=${selMonth}` : '';
    api.get<ArSummaryResponse>(`/api/rentals/ar-summary${params}`)
      .then(r => setRawData(r.data))
      .catch(() => setRawData(null))
      .finally(() => setLoading(false));
  }, [selMonth]);

  // All companies always available for dropdown (from unfiltered response)
  const allCompanies = rawData?.companies ?? [];
  const availMonths  = rawData?.available_months ?? [];

  // ── Client-side company filter ────────────────────────────────────────────
  const companies = useMemo(
    () => selCoId ? allCompanies.filter(c => c.company_id === selCoId) : allCompanies,
    [allCompanies, selCoId],
  );

  // ── KPI aggregates from filtered companies ────────────────────────────────
  const port = useMemo(() => {
    if (!companies.length) return null;
    const totalBilled    = companies.reduce((s, c) => s + c.billed_per_month, 0);
    const totalCollected = companies.reduce((s, c) => s + c.latest_collected, 0);
    const totalOutstanding = Math.max(0, totalBilled - totalCollected);
    const rate = totalBilled > 0 ? totalCollected / totalBilled * 100 : 0;
    const vacLoss = companies.reduce((s, c) => s + c.vacancy_loss_per_month, 0);
    const occupied = companies.reduce((s, c) => s + c.occupied_units, 0);
    const total    = companies.reduce((s, c) => s + c.total_units, 0);
    return { totalBilled, totalCollected, totalOutstanding, rate, vacLoss, occupied, total };
  }, [companies]);

  // ── Trend — month-wise aggregated from filtered companies ─────────────────
  const trendData = useMemo(() => {
    const map = new Map<string, { billed: number; collected: number; byCompany: { name: string; collected: number }[] }>();
    for (const co of companies) {
      for (const m of co.monthly) {
        const existing = map.get(m.month);
        if (!existing) {
          map.set(m.month, { billed: 0, collected: 0, byCompany: [] });
        }
        const e = map.get(m.month)!;
        e.billed    += m.billed;
        e.collected += m.collected;
        if (m.collected > 0) e.byCompany.push({ name: co.company_name, collected: m.collected });
      }
    }
    const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const sorted = [...map.entries()].sort(([a],[b]) => {
      const [am, ay] = a.split('-'); const [bm, by] = b.split('-');
      return (parseInt(ay)-parseInt(by)) || (MNAMES.indexOf(am)-MNAMES.indexOf(bm));
    });
    return sorted.map(([m, v]) => ({
      month: short(m), full: m,
      billed: v.billed, collected: v.collected,
      byCompany: v.byCompany,
      // stacked area series: transparent base up to collected, red fill for the gap
      collectedBase: v.collected,
      gapFill: Math.max(0, v.billed - v.collected),
    }));
  }, [companies]);

  // ── Outstanding AR by company ─────────────────────────────────────────────
  const outstandingData = useMemo(() =>
    [...companies]
      .filter(c => c.latest_outstanding > 0)
      .sort((a, b) => b.latest_outstanding - a.latest_outstanding)
      .map(c => ({ company: c.company_name.length > 16 ? c.company_name.slice(0,14)+'…' : c.company_name, ar: c.latest_outstanding, full: c.company_name })),
    [companies],
  );

  // ── Month × Company detail rows ───────────────────────────────────────────
  const detailRows = useMemo(() => {
    const rows: Array<{
      company_name: string; month: string; occupied: number; total: number;
      billed: number; collected: number; outstanding: number; rate: number;
      data_source: string; has_data: boolean;
    }> = [];

    for (const co of companies) {
      if (co.monthly.length === 0) {
        rows.push({
          company_name: co.company_name, month: selMonth || '—',
          occupied: co.occupied_units, total: co.total_units,
          billed: co.billed_per_month, collected: 0,
          outstanding: co.billed_per_month, rate: 0,
          data_source: 'none', has_data: false,
        });
      } else {
        for (const m of co.monthly) {
          rows.push({
            company_name: co.company_name, month: m.month,
            occupied: co.occupied_units, total: co.total_units,
            billed: m.billed, collected: m.collected,
            outstanding: m.outstanding, rate: m.collection_rate,
            data_source: m.data_source, has_data: true,
          });
        }
      }
    }
    return rows;
  }, [companies, selMonth]);

  const filteredRows = useMemo(() => {
    return detailRows.filter(r => {
      if (chartMonth && r.month !== chartMonth && r.month !== short(chartMonth)) return false;
      if (statusFlt === 'All') return true;
      return getStatus(r.rate, r.collected).label === statusFlt;
    });
  }, [detailRows, statusFlt, chartMonth]);

  // ── Sorted tenant rows ────────────────────────────────────────────────────
  const sortedTenants = useMemo(() => {
    const rows = tenantAging?.rows ?? [];
    return [...rows].sort((a, b) => {
      const av = a[tenantSortCol] ?? 0;
      const bv = b[tenantSortCol] ?? 0;
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return tenantSortAsc ? cmp : -cmp;
    });
  }, [tenantAging, tenantSortCol, tenantSortAsc]);

  // ── Property ranked bar — always show all companies ──────────────────────
  const propertyBarData = useMemo(() =>
    [...companies]
      .sort((a, b) => b.latest_outstanding - a.latest_outstanding)
      .map(c => ({
        company:     c.company_name,
        company_id:  c.company_id,
        outstanding: c.latest_outstanding,
        rate:        c.latest_rate,
      })),
    [companies],
  );

  // ── Overdue bucket trend (31-60 / 61-90 / 91+) from QB snapshots ──────────
  const bucketTrend = useMemo(() => {
    if (!qbAging?.trend || qbAging.trend.length < 3) return [];
    return qbAging.trend.map(pt => ({
      month:     pt.month,
      '31–60':   pt.days_31_60,
      '61–90':   pt.days_61_90,
      '91+':     pt.days_91_plus,
    }));
  }, [qbAging]);

  // Overall realization % across all trend months
  const realizationPct = useMemo(() => {
    const tb = trendData.reduce((s, d) => s + d.billed, 0);
    const tc = trendData.reduce((s, d) => s + d.collected, 0);
    return tb > 0 ? tc / tb * 100 : null;
  }, [trendData]);

  // ── Part A/B additional memos ─────────────────────────────────────────────
  const currentMonthShortfall = useMemo(() => {
    if (!trendData.length) return null;
    const latest = trendData[trendData.length - 1];
    return { month: latest.full, shortfall: Math.max(0, latest.billed - latest.collected), billed: latest.billed, collected: latest.collected };
  }, [trendData]);

  const partialPayCount = useMemo(() =>
    companies.filter(c => c.latest_collected > 0 && c.latest_collected < c.billed_per_month).length,
    [companies],
  );

  const top5Outstanding = useMemo(() =>
    [...companies]
      .filter(c => c.latest_outstanding > 0)
      .sort((a, b) => b.latest_outstanding - a.latest_outstanding)
      .slice(0, 5),
    [companies],
  );

  const occupiedBillingGap = useMemo(() => {
    const withBilling    = companies.filter(c => c.billed_per_month > 0).reduce((s, c) => s + c.occupied_units, 0);
    const withoutBilling = companies.filter(c => c.billed_per_month === 0).reduce((s, c) => s + c.occupied_units, 0);
    return { billed: withBilling, unbilled: withoutBilling };
  }, [companies]);

  const heatmapData = useMemo(() => {
    const MNAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthSet = new Set<string>();
    for (const co of companies) for (const m of co.monthly) monthSet.add(m.month);
    const months = [...monthSet].sort((a, b) => {
      const [am, ay] = a.split('-'); const [bm, by] = b.split('-');
      return (parseInt(ay) - parseInt(by)) || (MNAMES.indexOf(am) - MNAMES.indexOf(bm));
    });
    const rows = companies.map(co => ({
      company: co.company_name,
      cells: months.map(m => {
        const md = co.monthly.find(mm => mm.month === m);
        return md ? { rate: md.collection_rate, collected: md.collected, billed: md.billed, has_data: true } : { rate: null as number | null, collected: 0, billed: 0, has_data: false };
      }),
    }));
    return { months, rows };
  }, [companies]);

  const payDistribution = useMemo(() => {
    if (!companies.length) return [];
    const zeroPay      = companies.filter(c => c.billed_per_month > 0 && c.latest_collected === 0).length;
    const partial      = companies.filter(c => c.latest_collected > 0 && c.latest_collected < c.billed_per_month).length;
    const fullPay      = companies.filter(c => c.billed_per_month > 0 && c.latest_collected >= c.billed_per_month).length;
    const noBilledCnt  = companies.filter(c => c.billed_per_month === 0).length;
    return [
      { name: 'Zero-Pay',         count: zeroPay,      fill: '#B91C1C' },
      { name: 'Partial-Pay',      count: partial,       fill: '#F5A623' },
      { name: 'Fully Paid',       count: fullPay,       fill: '#166534' },
      ...(noBilledCnt > 0 ? [{ name: 'No Billing Data', count: noBilledCnt, fill: '#D1D5DB' }] : []),
    ].filter(d => d.count > 0);
  }, [companies]);

  // ── Recon flags ───────────────────────────────────────────────────────────
  const reconFlags = useMemo(() =>
    companies.flatMap(c =>
      c.monthly.flatMap(m =>
        m.recon_flag ? [{ company: c.company_name, month: m.month, ...m.recon_flag }] : [],
      ),
    ), [companies],
  );

  // ── Source counts ─────────────────────────────────────────────────────────
  const srcSummary = useMemo(() => ({
    rr:   allCompanies.filter(c => c.has_rent_receivable).length,
    pl:   allCompanies.filter(c => !c.has_rent_receivable && c.has_pl_data).length,
    none: allCompanies.filter(c => !c.has_rent_receivable && !c.has_pl_data).length,
  }), [allCompanies]);

  const selCoName = allCompanies.find(c => c.company_id === selCoId)?.company_name ?? '';

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  const kpis = port ? [
    {
      label: 'Total Billed / Month',
      value: fmt$(port.totalBilled),
      sub: `${port.occupied} occupied units · registry`,
      border: '#2F80ED',
    },
    {
      label: selMonth ? `Collected · ${selMonth}` : 'Collected (Latest Mo)',
      value: fmt$(port.totalCollected),
      sub: `${pct(port.rate)} collection rate`,
      border: '#166534',
    },
    {
      label: 'Outstanding AR',
      value: fmt$(port.totalOutstanding),
      sub: `${companies.filter(c => c.latest_outstanding > 0).length} companies with gaps`,
      border: '#B91C1C',
    },
    {
      label: 'Collection Rate',
      value: pct(port.rate),
      sub: port.rate >= 95 ? '✅ On Target' : '⚠️ Below 95% target',
      border: port.rate >= 95 ? '#166534' : '#F5A623',
    },
    {
      label: 'Vacancy Loss / Month',
      value: fmt$(port.vacLoss),
      sub: `${port.total - port.occupied} vacant / notice units`,
      border: '#B91C1C',
    },
    {
      label: 'Total Units',
      value: String(port.total),
      sub: `${port.occupied} occupied · ${port.total - port.occupied} vacant`,
      border: '#2F80ED',
    },
    {
      label: 'Zero-Pay Companies',
      value: String(companies.filter(c => c.billed_per_month > 0 && c.latest_collected === 0).length),
      sub: companies.filter(c => c.billed_per_month > 0 && c.latest_collected === 0).map(c => c.company_name).join(', ') || 'None',
      border: '#B91C1C',
    },
    {
      label: 'Best Performer',
      value: [...companies].sort((a, b) => b.latest_rate - a.latest_rate)[0]?.company_name ?? '—',
      sub: (() => {
        const b = [...companies].filter(c => c.latest_collected > 0).sort((a, b) => b.latest_rate - a.latest_rate)[0];
        return b ? `${pct(b.latest_rate)} · ${fmt$(b.latest_collected)}` : 'No data yet';
      })(),
      border: '#166534',
    },
    {
      label: `Month-End Shortfall${currentMonthShortfall ? ' · ' + short(currentMonthShortfall.month) : ''}`,
      value: currentMonthShortfall ? fmt$(currentMonthShortfall.shortfall) : '—',
      sub: currentMonthShortfall
        ? `${fmt$(currentMonthShortfall.collected)} collected of ${fmt$(currentMonthShortfall.billed)} billed`
        : 'No monthly data',
      border: (currentMonthShortfall?.shortfall ?? 0) > 0 ? '#B91C1C' : '#166534',
    },
    {
      label: 'Partial-Pay Companies',
      value: String(partialPayCount),
      sub: partialPayCount > 0
        ? companies.filter(c => c.latest_collected > 0 && c.latest_collected < c.billed_per_month).map(c => c.company_name).slice(0, 3).join(', ')
        : 'All paying in full or zero-pay',
      border: partialPayCount > 0 ? '#F5A623' : '#166534',
    },
    {
      label: 'Top 5 by Outstanding AR',
      value: top5Outstanding.length > 0 ? fmt$(top5Outstanding[0].latest_outstanding) : '—',
      sub: top5Outstanding.length > 0
        ? top5Outstanding.map((c, i) => `${i + 1}. ${c.company_name.length > 12 ? c.company_name.slice(0, 11) + '…' : c.company_name}`).join(' · ')
        : 'No outstanding AR',
      border: top5Outstanding.length > 0 ? '#B91C1C' : '#166534',
    },
    {
      label: 'Occupied — Billing Gap',
      value: `${occupiedBillingGap.billed}/${occupiedBillingGap.billed + occupiedBillingGap.unbilled}`,
      sub: occupiedBillingGap.unbilled > 0
        ? `⚠ ${occupiedBillingGap.unbilled} occupied units have no billing data`
        : '✓ All occupied units have billing data',
      border: occupiedBillingGap.unbilled > 0 ? '#F5A623' : '#166534',
    },
  ] : [];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 20, background: '#F5F0E8', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Spinner */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8 }}>
          <div style={{ width: 16, height: 16, border: '2px solid #E8DEC8', borderTopColor: '#D4AF37', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 12, color: '#78716C' }}>Loading AR data…</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* Source banner */}
      {!loading && !!rawData && (
        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#14532D' }}>
            ✅ Live data from registry · Billed = occupied units monthly rent
          </span>
          <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
            {srcSummary.rr   > 0 && <span style={{ color: '#166534' }}>🔵 {srcSummary.rr} co. via Rent Receivable upload</span>}
            {srcSummary.pl   > 0 && <span style={{ color: '#92400E' }}>🟡 {srcSummary.pl} co. via P&L fallback</span>}
            {srcSummary.none > 0 && <span style={{ color: '#9CA3AF' }}>⚪ {srcSummary.none} co. no collection data yet</span>}
          </div>
        </div>
      )}

      {/* ── FILTER BAR ─────────────────────────────────────────────────── */}
      <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#5C5043' }}>Filter:</span>

        {/* Month — triggers API refetch */}
        <select value={selMonth} onChange={e => { setSelMonth(e.target.value); setSelCoId(''); }} style={SEL}>
          <option value="">All Months</option>
          {availMonths.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        {/* Company — client-side only, never triggers refetch */}
        <select value={selCoId} onChange={e => setSelCoId(e.target.value)} style={SEL}>
          <option value="">All Companies</option>
          {allCompanies.map(c => (
            <option key={c.company_id} value={c.company_id}>{c.company_name}</option>
          ))}
        </select>

        {/* Active chips */}
        {selMonth && (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', gap: 4 }}>
            📅 {selMonth}
            <button onClick={() => setSelMonth('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
          </span>
        )}
        {selCoId && (
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', gap: 4 }}>
            🏢 {selCoName}
            <button onClick={() => setSelCoId('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1E40AF', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF' }}>
          {companies.length} / {allCompanies.length} companies · {port?.total ?? 0} units · {port?.occupied ?? 0} occupied
          {selCoId && <span style={{ color: '#D4AF37', marginLeft: 6 }}>← Company filtered (client-side)</span>}
        </span>
      </div>

      {/* No data */}
      {!loading && !rawData && (
        <div style={{ ...CARD, textAlign: 'center', padding: '40px 24px' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#5C5043', marginBottom: 8 }}>No AR data available yet</p>
          <p style={{ fontSize: 12, color: '#9CA3AF' }}>Add units to companies in the Company Registry, then upload a Rent Receivable Excel.</p>
        </div>
      )}

      {/* ── 8 KPI TILES ─────────────────────────────────────────────────── */}
      {!!port && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8 }}>
          {kpis.map((t, i) => (
            <div key={i} style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 10, padding: '12px 14px', borderLeft: `3px solid ${t.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B6B6B', marginBottom: 4, lineHeight: 1.2 }}>{t.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#262626', fontVariantNumeric: 'tabular-nums lining-nums', lineHeight: 1.1 }}>{t.value}</div>
              <div style={{ fontSize: 11, marginTop: 4, color: '#6B6B6B', lineHeight: 1.3 }}>{t.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── TREND + COLLECTION RATE ──────────────────────────────────────── */}
      {!!port && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Billed vs Collected dual-line trend */}
          <div style={CARD}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#262626' }}>
                Billed vs Collected — {selCoName || 'All Companies'}
              </div>
              {realizationPct !== null && (
                <div style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                  background: realizationPct >= 95 ? 'rgba(22,101,52,0.12)' : realizationPct >= 80 ? 'rgba(242,193,78,0.18)' : 'rgba(185,28,28,0.12)',
                  color:      realizationPct >= 95 ? '#065F46' : realizationPct >= 80 ? '#92400E' : '#991B1B',
                  border: `1px solid ${realizationPct >= 95 ? 'rgba(22,101,52,0.3)' : realizationPct >= 80 ? 'rgba(242,193,78,0.4)' : 'rgba(185,28,28,0.3)'}`,
                  fontVariantNumeric: 'tabular-nums lining-nums', flexShrink: 0 }}>
                  {realizationPct.toFixed(1)}% realization
                </div>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 14 }}>
              {trendData.length > 0
                ? `${trendData[0].full} → ${trendData[trendData.length - 1].full} · ${trendData.length} months`
                : 'No collection data yet — upload Rent Receivable Excel'}
            </div>

            {chartMonth && (
              <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' }}>
                  Table filtered: {chartMonth}
                </span>
                <button onClick={() => setChartMonth('')} style={{ fontSize: 11, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Clear
                </button>
              </div>
            )}

            {trendData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart
                    data={trendData}
                    margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
                    onClick={(e) => {
                      const full = e?.activePayload?.[0]?.payload?.full;
                      if (full) setChartMonth(prev => prev === full ? '' : full);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      axisLine={false} tickLine={false}
                      interval={Math.max(1, Math.floor(trendData.length / 10))}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      tickFormatter={(v: number) => v === 0 ? '$0' : v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`}
                      axisLine={false} tickLine={false} width={44}
                      tickCount={6}
                    />
                    <Tooltip content={<BvcTooltip />} />
                    {/* Under-collection fill: stacked transparent base + red gap */}
                    <Area type="monotone" dataKey="collectedBase" stackId="gap" fill="transparent" stroke="none" legendType="none" />
                    <Area type="monotone" dataKey="gapFill"       stackId="gap" fill="rgba(235,87,87,0.12)" stroke="none" legendType="none" />
                    <Line type="monotone" dataKey="billed"    name="Billed"    stroke="#4E79A7" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 1.5, stroke: '#4E79A7', fill: '#fff' }} />
                    <Line type="monotone" dataKey="collected" name="Collected" stroke="#166534" strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 1.5, stroke: '#166534', fill: '#fff' }} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', gap: 20, marginTop: 10, alignItems: 'center' }}>
                  {[['#4E79A7','Billed'],['#166534','Collected']].map(([c,l]) => (
                    <span key={l} style={{ fontSize: 12, color: '#4B5563', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
                      <span style={{ width: 20, height: 3, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 12, height: 10, background: 'rgba(235,87,87,0.25)', borderRadius: 2, display: 'inline-block' }} />Under-collection
                  </span>
                  <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 'auto' }}>Click month to filter table ↓</span>
                </div>
              </>
            ) : (
              <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p style={{ fontSize: 12, color: '#9CA3AF' }}>Upload Rent Receivable data to see trend</p>
              </div>
            )}
          </div>

          {/* Collection rate by company */}
          <div style={CARD}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Collection rate by company</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
              {selMonth || 'Latest available month'} · collected vs billed from registry
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', maxHeight: 240 }}>
              {allCompanies.map((co, idx) => {
                // Use filtered company data when company is selected, else original
                const src = selCoId ? companies.find(c => c.company_id === co.company_id) : co;
                const rate = src?.latest_rate ?? 0;
                const coll = src?.latest_collected ?? 0;
                const bill = src?.billed_per_month ?? 0;
                const pill = getStatus(rate, coll);
                const isSelected = selCoId === co.company_id;
                return (
                  <div key={co.company_id}
                    style={{ opacity: selCoId && !isSelected ? 0.4 : 1, cursor: 'pointer' }}
                    onClick={() => setSelCoId(isSelected ? '' : co.company_id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, color: isSelected ? '#1C1917' : '#374151', fontWeight: isSelected ? 700 : 500 }}>
                        {co.company_name}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#6B6B6B' }}>
                          {fmt$(coll)} / {fmt$(bill)}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: pill.bg, color: pill.color }}>
                          {rate > 0 ? pct(rate) : pill.label}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 7, background: '#E8DEC8', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 4,
                        width: `${Math.min(100, rate)}%`,
                        background: STATUS_COLORS[idx % STATUS_COLORS.length],
                        transition: 'width 0.4s',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 10 }}>💡 Click a company to filter the whole dashboard</div>
          </div>
        </div>
      )}

      {/* ── VACANCY LOSS TREND ───────────────────────────────────────────── */}
      {!!port && trendData.length > 0 && port.vacLoss > 0 && (
        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Revenue vs Vacancy Loss</div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
            Actual billed vs maximum potential · current vacancy loss: <strong style={{ color: '#B91C1C' }}>{fmt$(port.vacLoss)}/mo</strong> · based on registry occupancy snapshot
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart
              data={trendData.map(d => ({ ...d, vacancyLoss: port.vacLoss, potential: d.billed + port.vacLoss }))}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} interval={Math.max(1, Math.floor(trendData.length / 10))} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickFormatter={(v: number) => v === 0 ? '$0' : v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`} axisLine={false} tickLine={false} width={44} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E8DEC8', background: '#FBF6EE' }} formatter={(v: number, name: string) => [fmt$(v), name]} />
              <Area type="monotone" dataKey="billed"        stackId="vac" fill="transparent"            stroke="none" legendType="none" />
              <Area type="monotone" dataKey="vacancyLoss"   stackId="vac" fill="rgba(185,28,28,0.12)"  stroke="rgba(185,28,28,0.3)" strokeWidth={0.5} name="Vacancy Loss" />
              <Line type="monotone" dataKey="potential"     name="Potential Revenue" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              <Line type="monotone" dataKey="billed"        name="Actual Billed"    stroke="#4E79A7" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 1.5, stroke: '#4E79A7', fill: '#fff' }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: 12, color: '#4B5563', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 20, height: 3, background: '#4E79A7', borderRadius: 2, display: 'inline-block' }} />Actual Billed
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 20, height: 2, background: '#9CA3AF', borderRadius: 2, display: 'inline-block', borderTop: '2px dashed #9CA3AF' }} />Potential Revenue
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 10, background: 'rgba(185,28,28,0.20)', borderRadius: 2, display: 'inline-block' }} />Vacancy Loss Gap
            </span>
          </div>
        </div>
      )}

      {/* ── OUTSTANDING AR BY COMPANY ─────────────────────────────────────── */}
      {!!port && outstandingData.length > 0 && (
        <div style={CARD}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Outstanding AR by company</div>
          <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 12 }}>
            Billed (registry) − Collected · {selMonth || 'latest month'}
          </div>
          <ResponsiveContainer width="100%" height={Math.max(120, outstandingData.length * 34)}>
            <BarChart data={outstandingData} layout="vertical" margin={{ top: 0, right: 90, bottom: 0, left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E8DEC8" />
              <XAxis type="number" tick={{ fontSize: 9, fill: '#9ca3af' }} tickFormatter={fmtK} axisLine={false} tickLine={false} />
              <YAxis dataKey="company" type="category" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: number, _, p) => [fmt$(v), `${p.payload?.full} · Outstanding`]} />
              <Bar dataKey="ar" radius={[0,4,4,0]} label={{ position: 'right', fontSize: 10, fill: '#6b7280', formatter: (v: number) => fmt$(v) }}>
                {outstandingData.map((_, i) => <Cell key={i} fill={['#B91C1C','#F5A623','#F2C94C'][Math.min(i, 2)]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!!port && outstandingData.length === 0 && companies.some(c => c.latest_collected > 0) && (
        <div style={{ ...CARD, textAlign: 'center', color: '#166534', fontSize: 13, fontWeight: 600 }}>
          ✅ No outstanding AR — all companies current
        </div>
      )}

      {/* ══ PART B — HEATMAP + ZERO-PAY DISTRIBUTION ═════════════════════════ */}
      {!!port && companies.some(c => c.monthly.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* Company × Month Collection Rate Heatmap */}
          {heatmapData.months.length > 0 && heatmapData.rows.length > 0 && (() => {
            const heatBg = (rate: number | null) => {
              if (rate === null) return '#F3F4F6';
              if (rate >= 95)   return '#166534';
              if (rate >= 80)   return '#16A34A';
              if (rate >= 60)   return '#FCD34D';
              if (rate >= 30)   return '#F5A623';
              return '#B91C1C';
            };
            const heatFg = (rate: number | null) => {
              if (rate === null) return '#9CA3AF';
              if (rate >= 80)    return '#fff';
              return '#1C1917';
            };
            const displayMonths = heatmapData.months.slice(-12);
            const startIdx = heatmapData.months.length - displayMonths.length;
            return (
              <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: 16, overflowX: 'auto' }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#1C1917', marginBottom: 2 }}>Collection Rate Heatmap</div>
                <div style={{ fontSize: 12, color: '#A8A29E', marginBottom: 12 }}>
                  Company × Month · green = high collection rate · red = low · last {displayMonths.length} months
                </div>
                <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12, width: '100%', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '22%' }} />
                    {displayMonths.map(m => (
                      <col key={m} style={{ width: `${78 / displayMonths.length}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 12, color: '#78716C', fontWeight: 600, whiteSpace: 'nowrap' }}>Company</th>
                      {displayMonths.map(m => (
                        <th key={m} style={{ padding: '4px 2px', fontSize: 11, color: '#78716C', fontWeight: 600, textAlign: 'center' }}>{short(m)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmapData.rows.map((row, ri) => (
                      <tr key={ri}>
                        <td style={{
                          padding: '4px 8px', fontSize: 12, color: '#1C1917', fontWeight: 500,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {row.company}
                        </td>
                        {row.cells.slice(startIdx).map((cell, ci) => (
                          <td key={ci} style={{
                            padding: '6px 4px', textAlign: 'center', borderRadius: 4,
                            background: heatBg(cell.has_data ? cell.rate : null),
                            color: heatFg(cell.has_data ? cell.rate : null),
                            fontSize: 11, fontWeight: 700,
                          }}>
                            {cell.has_data ? `${Math.round(cell.rate ?? 0)}%` : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center', fontSize: 11, color: '#78716C', flexWrap: 'wrap' }}>
                  {([['#166534','≥95%'],['#16A34A','80–94%'],['#FCD34D','60–79%'],['#F5A623','30–59%'],['#B91C1C','<30%'],['#F3F4F6','No data']] as [string,string][]).map(([c, l]) => (
                    <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block', border: '1px solid rgba(0,0,0,0.1)' }} />
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Zero-Pay / Partial-Pay / Fully Paid Distribution */}
          {payDistribution.length > 0 && (
            <div style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Pay Distribution — Current Period</div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
                {selMonth || 'Latest month'} · {companies.filter(c => c.billed_per_month > 0).length} companies with billing data
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={payDistribution} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E8DEC8', background: '#FBF6EE' }}
                    formatter={(v: number, _name: string, p: { payload?: { name: string } }) => [`${v} compan${v === 1 ? 'y' : 'ies'}`, p.payload?.name ?? '']}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} label={{ position: 'top', fontSize: 12, fontWeight: 700, fill: '#374151' }}>
                    {payDistribution.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {payDistribution.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: d.fill, display: 'inline-block' }} />
                      <span style={{ color: '#374151' }}>{d.name}</span>
                    </span>
                    <span style={{ fontWeight: 700, color: '#1C1917' }}>{d.count} compan{d.count === 1 ? 'y' : 'ies'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ NEW SECTION 1 — TENANT AGING TABLE ═══════════════════════════════ */}
      {!!port && tenantAging?.has_data && sortedTenants.length > 0 && (() => {
        const thStyle = (col: keyof TenantAgingRow): React.CSSProperties => ({
          padding: '8px 10px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.04em', color: '#6B6B6B', whiteSpace: 'nowrap',
          cursor: 'pointer', userSelect: 'none',
          background: tenantSortCol === col ? '#F0EDE5' : '#FBF6EE',
          borderBottom: '1px solid #E8DEC8', textAlign: 'right' as const,
        });
        const thL = (col: keyof TenantAgingRow): React.CSSProperties => ({ ...thStyle(col), textAlign: 'left' as const });
        const arrow = (col: keyof TenantAgingRow) => tenantSortCol === col ? (tenantSortAsc ? ' ▲' : ' ▼') : '';
        const sort = (col: keyof TenantAgingRow) => {
          if (tenantSortCol === col) setTenantSortAsc(a => !a);
          else { setTenantSortCol(col); setTenantSortAsc(false); }
        };
        const ACTION_STYLE: Record<string, React.CSSProperties> = {
          Review:  { background: '#FEE2E2', color: '#991B1B', border: '1px solid rgba(220,38,38,0.25)' },
          Monitor: { background: '#FEF3C7', color: '#92400E', border: '1px solid rgba(245,158,11,0.3)' },
          Current: { background: '#DCFCE7', color: '#166534', border: '1px solid rgba(34,197,94,0.3)'  },
        };
        return (
          <div style={{ background: '#fff', border: '1px solid #E8DEC8', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #E8DEC8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1C1917' }}>Tenant AR Aging — {tenantAging.snapshot_month}</div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                  {sortedTenants.length} tenants · from QB AR Aging Detail upload · click column header to sort
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#78716C' }}>Last Payment Date: not captured in QB AR Aging export</div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {([
                      ['customer',    'Tenant Name',      thL],
                      ['unit_ref',    'Unit',             thL],
                      ['lease_end',   'Lease End',        thL],
                      ['current',     'Current',          thStyle],
                      ['days_1_30',   '1–30',             thStyle],
                      ['days_31_60',  '31–60',            thStyle],
                      ['days_61_90',  '61–90',            thStyle],
                      ['days_91_plus','91+',              thStyle],
                      ['total',       'Total Due',        thStyle],
                      ['action_status','Action Status',   thL],
                    ] as [keyof TenantAgingRow, string, (c: keyof TenantAgingRow) => React.CSSProperties][]).map(([col, label, styleFn]) => (
                      <th key={col} style={styleFn(col)} onClick={() => sort(col)}>
                        {label}{arrow(col)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTenants.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F5F0E8', background: i % 2 === 0 ? '#fff' : '#FDFAF5' }}>
                      <td style={{ padding: '8px 10px', color: '#1C1917', fontWeight: 500, whiteSpace: 'nowrap' }}>{row.customer}</td>
                      <td style={{ padding: '8px 10px', color: '#78716C', whiteSpace: 'nowrap' }}>{row.unit_ref}</td>
                      <td style={{ padding: '8px 10px', color: '#78716C', whiteSpace: 'nowrap' }}>
                        {row.lease_end ?? <span style={{ color: '#D4AF37', fontStyle: 'italic' }}>Not tracked</span>}
                      </td>
                      {[row.current, row.days_1_30, row.days_31_60, row.days_61_90, row.days_91_plus, row.total].map((v, vi) => (
                        <td key={vi} style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums lining-nums',
                          color: vi >= 2 && v > 0 ? (vi >= 3 ? '#B91C1C' : '#92400E') : '#374151',
                          fontWeight: vi === 5 ? 700 : 400 }}>
                          {v > 0 ? fmt$(v) : '—'}
                        </td>
                      ))}
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600, ...ACTION_STYLE[row.action_status] }}>
                          {row.action_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ══ NEW SECTION 2 — AR BY PROPERTY (ranked bar, color = collection rate) ═ */}
      {!!port && propertyBarData.length > 0 && (() => {
        const rateColor = (rate: number) =>
          rate >= 95 ? '#166534' : rate >= 75 ? '#F5A623' : '#B91C1C';
        const maxOutstanding = Math.max(...propertyBarData.map(d => d.outstanding), 1);
        return (
          <div style={CARD}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>AR by Property — Outstanding ranked</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
              Bar size = Outstanding AR · Color = Collection Rate · Click to filter dashboard
              <span style={{ marginLeft: 12 }}>
                <span style={{ color: '#166534', fontWeight: 600 }}>■</span> ≥95%
                <span style={{ color: '#F5A623', fontWeight: 600, marginLeft: 8 }}>■</span> 75–94%
                <span style={{ color: '#B91C1C', fontWeight: 600, marginLeft: 8 }}>■</span> &lt;75%
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {propertyBarData.map(d => {
                const isSelected = selCoId === d.company_id;
                const pct100 = maxOutstanding > 0 ? (d.outstanding / maxOutstanding) * 100 : 0;
                return (
                  <div key={d.company_id}
                    style={{ opacity: selCoId && !isSelected ? 0.45 : 1, cursor: 'pointer' }}
                    onClick={() => setSelCoId(isSelected ? '' : d.company_id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: isSelected ? '#1C1917' : '#374151', fontWeight: isSelected ? 700 : 500 }}>
                        {d.company}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, color: '#6B6B6B', fontVariantNumeric: 'tabular-nums lining-nums' }}>
                          {d.outstanding > 0 ? fmt$(d.outstanding) : '—'} outstanding
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: rateColor(d.rate) }}>
                          {d.rate > 0 ? `${d.rate.toFixed(1)}%` : 'No data'}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 10, background: '#E8DEC8', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 6, transition: 'width 0.4s',
                        width: `${Math.max(pct100, d.outstanding > 0 ? 1.5 : 0)}%`,
                        background: rateColor(d.rate),
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ══ NEW SECTION 3 — OVERDUE TREND BY BUCKET (gated: 3+ snapshots) ════ */}
      {!!port && (
        bucketTrend.length >= 3 ? (
          <div style={CARD}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Overdue Trend by Aging Bucket</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 14 }}>
              Three distinct overdue buckets over time — shows whether the worst-aged AR is growing or resolving
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={bucketTrend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="#E5E7EB" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickFormatter={(v: number) => v === 0 ? '$0' : v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1000).toFixed(0)}k`}
                  axisLine={false} tickLine={false} width={44}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E8DEC8', background: '#FBF6EE' }}
                  formatter={(v: number, name: string) => [fmt$(v), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="31–60" name="31–60 days" stroke="#F5A623" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="61–90" name="61–90 days" stroke="#C0392B" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="91+"   name="91+ days"   stroke="#991B1B" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={CARD}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1C1917' }}>Overdue Trend by Bucket</div>
          </div>
        )
      )}

      {/* ── RECON FLAGS (below Overdue Trend) ─────────────────────────────── */}
      {reconFlags.length > 0 && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 10 }}>
            ⚠️ {reconFlags.length} Reconciliation Flag{reconFlags.length > 1 ? 's' : ''} — Rent Receivable vs P&L differ &gt; 2%
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 8 }}>
            {reconFlags.map((f, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #FCD34D', borderRadius: 6, padding: '10px 12px', fontSize: 11 }}>
                <div style={{ fontWeight: 600, color: '#1C1917', marginBottom: 4 }}>{f.company} · {f.month}</div>
                <div style={{ color: '#2F80ED' }}>Rent Receivable: {fmt$(f.rent_receivable)}</div>
                <div style={{ color: '#92400E' }}>P&L: {fmt$(f.pl)}</div>
                <div style={{ color: '#B91C1C', fontWeight: 600, marginTop: 2 }}>Δ {f.diff_pct}% difference</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── QB snapshot collecting history (below Overdue Trend) ──────────── */}
      {!!port && bucketTrend.length < 3 && (
        <div style={{ ...CARD, textAlign: 'center', padding: '20px 16px' }}>
          <div style={{ fontSize: 12, color: '#9CA3AF' }}>
            Collecting history — chart appears after 3 monthly QB AR Aging snapshots.
            Currently {qbAging?.snapshot_count ?? 0} of 3 required.
            {!qbAging?.has_data && ' Upload QB AR Aging below to start.'}
          </div>
        </div>
      )}

      {/* ── COMPANY × MONTH DETAIL TABLE ─────────────────────────────────── */}
      {!!port && (
        <div style={{ background: '#fff', border: '1px solid #E8DEC8', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1C1917' }}>
                Collection detail — {selCoName || 'All Companies'} · {chartMonth || selMonth || 'All Months'}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
                Every company × every month · billed from registry · collected from Rent Receivable or P&L
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['All','Zero-Pay','Partial','Paid','Low'].map(f => (
                <button key={f} onClick={() => setStatusFlt(f)} style={{
                  fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid',
                  borderColor: statusFlt === f ? '#1C1917' : '#E8DEC8',
                  background:  statusFlt === f ? '#1C1917' : 'transparent',
                  color:       statusFlt === f ? '#fff'    : '#6B6B6B',
                  cursor: 'pointer',
                }}>{f}</button>
              ))}
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F7F1E6' }}>
                  {['Company','Month','Occ/Total','Billed/Mo','Collected','Outstanding','Rate','Source','Status'].map(h => (
                    <th key={h} style={{
                      textAlign: ['Company','Source','Status'].includes(h) ? 'left' : 'right',
                      padding: '8px 10px', fontSize: 10, fontWeight: 600,
                      color: '#5C5043', textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 28, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
                      No data for this filter.
                      {srcSummary.none > 0 && ` Upload Rent Receivable Excel to populate ${srcSummary.none} companies.`}
                    </td>
                  </tr>
                ) : filteredRows.map((row, i) => {
                  const pill = getStatus(row.rate, row.collected);
                  return (
                    <tr key={i} style={{ borderTop: '1px solid #F0EBE3', background: i % 2 === 0 ? '#FDFAF6' : '#fff' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 500, color: '#1C1917', whiteSpace: 'nowrap' }}>{row.company_name}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6B6B6B', fontFamily: 'monospace', fontSize: 11 }}>{row.month}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6B6B6B' }}>{row.occupied}/{row.total}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#374151' }}>{fmt$(row.billed)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#166534', fontWeight: 500 }}>{fmt$(row.collected)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: row.outstanding > 0 ? '#991B1B' : '#166534' }}>
                        {row.outstanding > 0 ? fmt$(row.outstanding) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                        color: row.rate >= 95 ? '#166534' : row.rate >= 85 ? '#92400E' : '#991B1B' }}>
                        {row.has_data ? pct(row.rate) : '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {row.has_data ? (
                          <span style={{
                            fontSize: 9, padding: '2px 6px', borderRadius: 20,
                            background: row.data_source === 'rent_receivable' ? '#EFF6FF' : '#FEFCE8',
                            color:      row.data_source === 'rent_receivable' ? '#1E40AF' : '#92400E',
                          }}>
                            {row.data_source === 'rent_receivable' ? 'Rent Rcv' : 'P&L'}
                          </span>
                        ) : (
                          <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280' }}>No data</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: pill.bg, color: pill.color }}>
                          {pill.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr style={{ background: '#F7F1E6', borderTop: '2px solid #E8DEC8' }}>
                    <td colSpan={3} style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, color: '#1C1917' }}>TOTAL ({filteredRows.length} rows)</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.billed, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#166534' }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.collected, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#991B1B' }}>
                      {fmt$(filteredRows.reduce((s, r) => s + r.outstanding, 0))}
                    </td>
                    <td colSpan={3} style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      {(() => {
                        const tb = filteredRows.reduce((s,r)=>s+r.billed,0);
                        const tc = filteredRows.reduce((s,r)=>s+r.collected,0);
                        return tb > 0 ? pct(tc/tb*100) : '—';
                      })()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
           QB AR AGING SECTION
         ══════════════════════════════════════════════════════════════════ */}
      <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>

        {/* ── Header bar ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #E8DEC8', background: '#F5F0E8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#262626' }}>📊 QB AR Aging Detail</span>
            {qbLoading && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Loading…</span>}
            {!qbLoading && qbAging?.has_data && (
              <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0', fontWeight: 600 }}>
                ✓ {qbAging.snapshot_count} upload{qbAging.snapshot_count !== 1 ? 's' : ''} · latest {qbAging.latest_snapshot?.snapshot_month}
              </span>
            )}
            {!qbLoading && !qbAging?.has_data && (
              <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', fontWeight: 600 }}>
                No data yet — upload QB "AR Aging Detail by Customer"
              </span>
            )}
          </div>
          {/* Collapsed: show compact "Update" row; Expanded: show Hide */}
          {qbAging?.has_data && !showQbPanel ? (
            <button
              onClick={() => setShowQbPanel(true)}
              style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid #D4AF37', background: 'linear-gradient(135deg,#D4AF37,#B8860B)', color: '#fff', cursor: 'pointer', fontWeight: 600, letterSpacing: '0.02em' }}
            >
              + Upload Next Month
            </button>
          ) : (
            <button
              onClick={() => setShowQbPanel(v => !v)}
              style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: '1px solid #D4AF37', background: '#FBF6EE', color: '#5C5043', cursor: 'pointer', fontWeight: 600 }}
            >
              {showQbPanel ? '▲ Hide Upload' : '▲ Upload QB Aging'}
            </button>
          )}
        </div>

        {/* ── Monthly upload history strip ────────────────────────────────── */}
        {!qbLoading && qbAging?.has_data && (qbAging.trend?.length ?? 0) > 0 && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #E8DEC8', background: '#FDFAF4', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#78716C', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 4 }}>Upload History:</span>
            {qbAging.trend.map((t, i) => (
              <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: '#DCFCE7', color: '#166534', border: '1px solid #BBF7D0', fontWeight: 500 }}>
                ✓ {t.month.slice(0, 7)}
              </span>
            ))}
          </div>
        )}

        {/* ── Upload panel — shown when no data yet OR user clicked Upload ── */}
        {(!qbAging?.has_data || showQbPanel) && (
          <div style={{ padding: 16, borderBottom: '1px solid #E8DEC8', background: '#FDFAF4' }}>

            {/* File + date + preview row */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#5C5043', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>QB Excel File</div>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                  border: '1px solid #E8DEC8', borderRadius: 6, background: '#FBF6EE',
                  cursor: 'pointer', fontSize: 12, color: '#5C5043', fontWeight: 500,
                }}>
                  <span>📎</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {qbFile ? qbFile.name : 'Choose AR Aging Detail by Customer.xlsx'}
                  </span>
                  <input ref={qbFileRef} type="file" accept=".xlsx,.xls"
                    onChange={e => { setQbFile(e.target.files?.[0] ?? null); setQbPreview(null); }}
                    style={{ display: 'none' }} />
                </label>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#5C5043', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Report As-Of Date</div>
                <input
                  type="date" value={qbAsOfDate}
                  onChange={e => { setQbAsOfDate(e.target.value); setQbPreview(null); }}
                  style={{ ...SEL, padding: '7px 12px', fontSize: 12 }}
                />
              </div>
              <button
                onClick={handleQbPreview}
                disabled={!qbFile || !qbAsOfDate || qbUploading}
                style={{
                  padding: '7px 20px', borderRadius: 6, border: 'none',
                  background: (!qbFile || !qbAsOfDate || qbUploading) ? '#D4AF3766' : 'linear-gradient(135deg,#D4AF37,#B8860B)',
                  color: '#fff', fontWeight: 700, fontSize: 13, cursor: (!qbFile || !qbAsOfDate || qbUploading) ? 'not-allowed' : 'pointer',
                  letterSpacing: '0.02em',
                }}
              >
                {qbUploading ? '⏳ Parsing…' : '🔍 Preview'}
              </button>
            </div>

            {/* Error banner — styled like attention pill */}
            {qbError && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>⚠️</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 2 }}>Upload Error</div>
                  <div style={{ fontSize: 12, color: '#B91C1C' }}>{qbError}</div>
                </div>
              </div>
            )}

            {/* Preview results */}
            {qbPreview && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#5C5043', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Parse Summary</div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                  {[
                    { label: 'Rows Parsed', value: qbPreview.row_count, c: '#262626' },
                    { label: 'Matched', value: qbPreview.matched_count, c: '#166534' },
                    { label: 'Unmatched', value: qbPreview.unmatched_count, c: qbPreview.unmatched_count > 0 ? '#B91C1C' : '#166534' },
                    { label: 'Subtotals Skipped', value: qbPreview.skipped_subtotals, c: '#6B6B6B' },
                    { label: 'Credit Rows', value: qbPreview.credit_rows.length, c: qbPreview.credit_rows.length > 0 ? '#7C3AED' : '#6B6B6B' },
                  ].map(k => (
                    <div key={k.label} style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '10px 16px', textAlign: 'center', minWidth: 90 }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: k.c, fontVariantNumeric: 'tabular-nums lining-nums' }}>{k.value}</div>
                      <div style={{ fontSize: 10, color: '#6B6B6B', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
                    </div>
                  ))}
                </div>

                {/* Bucket totals */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {[
                    { label: 'Current', v: qbPreview.portfolio_totals.current, c: '#166534' },
                    { label: '1–30 Days', v: qbPreview.portfolio_totals.days_1_30, c: '#F5A623' },
                    { label: '31–60 Days', v: qbPreview.portfolio_totals.days_31_60, c: '#E97316' },
                    { label: '61–90 Days', v: qbPreview.portfolio_totals.days_61_90, c: '#DC2626' },
                    { label: '91+ Days', v: qbPreview.portfolio_totals.days_91_plus, c: '#991B1B' },
                  ].map(b => (
                    <div key={b.label} style={{ flex: 1, minWidth: 90, background: '#FBF6EE', border: `2px solid ${b.c}33`, borderRadius: 8, padding: '10px 12px', textAlign: 'center', borderTop: `3px solid ${b.c}` }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: b.c, fontVariantNumeric: 'tabular-nums lining-nums' }}>{fmt$(b.v)}</div>
                      <div style={{ fontSize: 10, color: '#6B6B6B', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{b.label}</div>
                    </div>
                  ))}
                </div>

                {/* Unmatched warning */}
                {qbPreview.unmatched.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px', borderRadius: 8, background: '#FFF7ED', border: '1px solid #FDBA74', marginBottom: 12 }}>
                    <span style={{ fontSize: 16, lineHeight: 1 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#9A3412', marginBottom: 4 }}>
                        {qbPreview.unmatched.length} customer{qbPreview.unmatched.length !== 1 ? 's' : ''} not matched to any unit — will be saved as unmatched
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {qbPreview.unmatched.slice(0, 6).map((u, i) => (
                          <span key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: '#92400E' }}>
                            {u.customer}{u.unit_ref ? ` · ${u.unit_ref}` : ''} — {u.building}
                          </span>
                        ))}
                        {qbPreview.unmatched.length > 6 && <span style={{ fontSize: 11, color: '#78716C' }}>…and {qbPreview.unmatched.length - 6} more</span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    onClick={handleQbConfirm}
                    disabled={qbConfirming}
                    style={{
                      padding: '8px 22px', borderRadius: 6, border: 'none',
                      background: qbConfirming ? '#86EFAC' : 'linear-gradient(135deg,#166534,#16A34A)',
                      color: '#fff', fontWeight: 700, fontSize: 13, cursor: qbConfirming ? 'not-allowed' : 'pointer',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {qbConfirming ? '⏳ Saving…' : '✔ Confirm & Save'}
                  </button>
                  <button
                    onClick={() => { setQbPreview(null); setQbFile(null); setQbAsOfDate(''); if (qbFileRef.current) qbFileRef.current.value = ''; }}
                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #E8DEC8', background: '#FBF6EE', color: '#5C5043', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 4 }}>
                    This creates a new monthly snapshot — existing history is preserved.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* QB KPIs */}
        {qbAging?.has_data && qbAging.portfolio_totals && (
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 14 }}>
              {[
                { label: 'Overdue AR (30+)', value: fmt$(qbAging.portfolio_totals.overdue), border: '#B91C1C', sub: 'Excludes current bucket' },
                { label: '30+ Days Overdue', value: fmt$(qbAging.portfolio_totals.days_1_30 + qbAging.portfolio_totals.days_31_60 + qbAging.portfolio_totals.days_61_90 + qbAging.portfolio_totals.days_91_plus), border: '#F5A623', sub: '1-30 + 31-60 + 61-90 + 91+' },
                { label: '60+ Days Overdue', value: fmt$(qbAging.portfolio_totals.days_61_90 + qbAging.portfolio_totals.days_91_plus), border: '#E97316', sub: '61-90 + 91+ days' },
                { label: '90+ Days Overdue', value: fmt$(qbAging.portfolio_totals.days_91_plus), border: '#991B1B', sub: 'Critical — 91+ days' },
                { label: 'Est. Days to Collect', value: qbAging.dso_estimate != null ? `${Math.round(qbAging.dso_estimate)} days` : '—', border: '#2F80ED', sub: qbAging.trend_ready ? `${qbAging.snapshot_count} snapshots` : `${qbAging.snapshot_count} of 3 needed for trend` },
              ].map((t, i) => (
                <div key={i} style={{ background: '#FBF6EE', border: '1px solid #E8DEC8', borderRadius: 8, padding: '12px 14px', borderLeft: `3px solid ${t.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B6B6B', marginBottom: 4, lineHeight: 1.2 }}>{t.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#262626', fontVariantNumeric: 'tabular-nums lining-nums' }}>{t.value}</div>
                  <div style={{ fontSize: 10, marginTop: 3, color: '#9CA3AF' }}>{t.sub}</div>
                </div>
              ))}
            </div>

            {/* AR Aging by Bucket stacked bar chart */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={CARD}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#262626', marginBottom: 2 }}>AR Aging by Bucket — Portfolio</div>
                <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 12 }}>All tenants · as of {qbAging.latest_snapshot?.snapshot_month}</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={[{
                      name: 'Portfolio',
                      Current: qbAging.portfolio_totals.current,
                      '1-30': qbAging.portfolio_totals.days_1_30,
                      '31-60': qbAging.portfolio_totals.days_31_60,
                      '61-90': qbAging.portfolio_totals.days_61_90,
                      '91+': qbAging.portfolio_totals.days_91_plus,
                    }]}
                    layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
                    <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={60} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmt$(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Current"  stackId="a" fill="#166534" />
                    <Bar dataKey="1-30"    stackId="a" fill="#F5A623" />
                    <Bar dataKey="31-60"   stackId="a" fill="#E97316" />
                    <Bar dataKey="61-90"   stackId="a" fill="#DC2626" />
                    <Bar dataKey="91+"     stackId="a" fill="#991B1B" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* By-company table */}
              <div style={CARD}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#262626', marginBottom: 2 }}>Aging by Company</div>
                <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 10 }}>Sorted by overdue amount (30+)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {[...qbAging.by_company]
                    .sort((a, b) => b.overdue - a.overdue)
                    .map((co, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, background: '#F5F0E8', borderRadius: 5, padding: '6px 10px' }}>
                        <span style={{ fontWeight: 600, color: '#1C1917', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{co.company_name}</span>
                        <span style={{ color: '#166534', marginLeft: 8, minWidth: 60, textAlign: 'right' }}>{fmt$(co.current)}</span>
                        <span style={{ color: co.overdue > 0 ? '#B91C1C' : '#9CA3AF', marginLeft: 6, minWidth: 60, textAlign: 'right', fontWeight: co.overdue > 0 ? 700 : 400 }}>{co.overdue > 0 ? fmt$(co.overdue) : '—'}</span>
                      </div>
                    ))
                  }
                </div>
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: '#9CA3AF' }}>
                  <span style={{ color: '#166534' }}>■ Current</span>
                  <span style={{ color: '#B91C1C' }}>■ Overdue (30+)</span>
                </div>
              </div>
            </div>

            {/* Trend section — only when 3+ snapshots */}
            {qbAging.trend_ready && qbAging.trend.length >= 3 && (
              <div style={{ ...CARD, marginTop: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#262626', marginBottom: 2 }}>AR Aging Trend — {qbAging.snapshot_count} Months</div>
                <div style={{ fontSize: 11, color: '#6B6B6B', marginBottom: 12 }}>Monthly overdue bucket breakdown</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={qbAging.trend.map(t => ({
                    month: t.month.slice(0, 7),
                    Current: t.current,
                    '1-30': t.days_1_30,
                    '31-60': t.days_31_60,
                    '61-90': t.days_61_90,
                    '91+': t.days_91_plus,
                  }))} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E8DEC8" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => fmt$(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Current" stackId="a" fill="#166534" />
                    <Bar dataKey="1-30"   stackId="a" fill="#F5A623" />
                    <Bar dataKey="31-60"  stackId="a" fill="#E97316" />
                    <Bar dataKey="61-90"  stackId="a" fill="#DC2626" />
                    <Bar dataKey="91+"    stackId="a" fill="#991B1B" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {!qbAging.trend_ready && (
              <div style={{ marginTop: 10, fontSize: 11, color: '#9CA3AF', textAlign: 'center', padding: '8px 0' }}>
                📈 Trend chart available after {3 - qbAging.snapshot_count} more monthly upload{3 - qbAging.snapshot_count !== 1 ? 's' : ''} ({qbAging.snapshot_count}/3 collected)
              </div>
            )}

            {/* Credit rows warning */}
            {qbAging.credit_rows.length > 0 && (
              <div style={{ marginTop: 10, background: '#F3E8FF', border: '1px solid #C4B5FD', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#5B21B6', marginBottom: 6 }}>
                  💜 {qbAging.credit_rows.length} tenant(s) have credit balances (negative buckets)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {qbAging.credit_rows.map((r, i) => (
                    <span key={i} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: '#EDE9FE', color: '#4C1D95', border: '1px solid #C4B5FD' }}>
                      {r.customer}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Unmatched rows */}
            {qbAging.unmatched.length > 0 && (
              <div style={{ marginTop: 10, background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#9A3412' }}>
                    ⚠️ {qbAging.unmatched.length} QB row(s) not matched to any unit in registry
                  </span>
                  <button onClick={() => setShowQbUnmatched(v => !v)} style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: '#9A3412', textDecoration: 'underline' }}>
                    {showQbUnmatched ? 'Hide' : 'Show'}
                  </button>
                </div>
                {showQbUnmatched && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {qbAging.unmatched.map((u, i) => (
                      <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: '#92400E' }}>
                        {u.customer}{u.unit_ref ? ` · ${u.unit_ref}` : ''} — {u.building}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── UNMATCHED P&L LINES ──────────────────────────────────────────── */}
      {(rawData?.unmatched_lines?.length ?? 0) > 0 && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#9A3412' }}>
              ⚠️ {rawData!.unmatched_lines.length} Unmatched P&L line{rawData!.unmatched_lines.length !== 1 ? 's' : ''} — unit label not found in registry
            </div>
            <button onClick={() => setShowUnmatched(v => !v)} style={{ fontSize: 11, color: '#9A3412', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              {showUnmatched ? 'Hide' : 'Show all'}
            </button>
          </div>
          {showUnmatched && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
              {rawData!.unmatched_lines.map((u, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, fontSize: 11, background: '#fff', border: '1px solid #FDBA74', borderRadius: 6, padding: '6px 10px' }}>
                  <span style={{ fontWeight: 600, color: '#7C3AED', minWidth: 130 }}>{u.company}</span>
                  <span style={{ color: '#374151', fontFamily: 'monospace' }}>{u.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
