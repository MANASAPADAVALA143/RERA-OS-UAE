/**
 * Consultancy & Outsourcing — Billing & Collections.
 * First of the six "coming soon" Phase-2 tabs to go live: invoice roster upload +
 * KPIs/charts/table. Re-uploading replaces all invoices for the selected company
 * (same semantics as the P&L/BS/CF upload in ConsultancyFinancials.tsx).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Upload, Building2, FileSpreadsheet } from 'lucide-react';
import { useConsultancy } from '../../contexts/ConsultancyContext';
import api, { formatApiError, postJsonWithWake, withTimeout } from '../../services/api';
import { parseInvoiceExcel } from '../../utils/invoiceExcelParser';
import PeriodToggle from '../../components/shared/PeriodToggle';
import { type Period, periodChipText } from '../../utils/periodWindow';
import { ParchmentKpiTile } from '../../components/ui/ParchmentKpiTile';
import { PT, PT_FONT, PT_CARD } from '../../utils/parchmentTypography';
import { Table, type Column } from '../../components/ui/Table';

// ── Types ────────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  client_name: string;
  invoice_date: string;
  amount: number;
  due_date: string | null;
  collected_amount: number;
  collected_date: string | null;
  standard_rate_amount: number | null;
}

const P = { gold: PT.gold, teal: PT.teal, green: PT.green, red: PT.red, amber: '#F2C14E', blue: PT.blue, border: PT.border };
const CHART_TICK = PT_FONT.chartTick;
const CHART_TOOLTIP = PT_FONT.tooltip;
const CHART_LEGEND = { wrapperStyle: PT_FONT.legend };
const DONUT_COLORS = [P.gold, P.teal, P.green, P.blue, P.amber, P.red, '#7C3AED', '#64748B'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  const abs = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
}
function fmtPct(n: number | null): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}
function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
function isoMonthKey(iso: string): string {
  const d = parseIso(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/** Whether an ISO date falls inside the selected period window (Annual = whole selected year). */
function inPeriod(iso: string, period: Period | null, month: number, year: number): boolean {
  const d = parseIso(iso);
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  if (!period) return y === year;
  if (period === 'Month') return m === month && y === year;
  return y === year && m <= month; // YTD and YoY both use Jan..selected-month of the selected year
}

interface InvoiceCalc {
  outstanding: number;
  daysPastDue: number; // negative/zero = not yet due
  status: 'Paid' | 'Outstanding' | 'Overdue';
}
function calcInvoice(inv: InvoiceRow, today: Date): InvoiceCalc {
  const outstanding = Math.max(0, inv.amount - inv.collected_amount);
  if (outstanding <= 0.01) return { outstanding: 0, daysPastDue: 0, status: 'Paid' };
  const due = parseIso(inv.due_date || inv.invoice_date);
  const daysPastDue = daysBetween(today, due);
  return { outstanding, daysPastDue, status: daysPastDue > 0 ? 'Overdue' : 'Outstanding' };
}

const STATUS_STYLE: Record<InvoiceCalc['status'], { bg: string; color: string }> = {
  Paid: { bg: '#DCFCE7', color: '#166534' },
  Outstanding: { bg: '#FEF3C7', color: '#92400E' },
  Overdue: { bg: '#FEE2E2', color: '#B91C1C' },
};

interface CalcRow extends Record<string, unknown> { id: string; inv: InvoiceRow; calc: InvoiceCalc }

// ── Main page ────────────────────────────────────────────────────────────────

export default function ConsultancyBillingCollections() {
  const { companies, selectedCompanyId, setSelectedCompanyId } = useConsultancy();
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [period, setPeriod] = useState<Period | null>(null);
  const now = new Date();
  const [pMonth, setPMonth] = useState(now.getMonth() + 1);
  const [pYear, setPYear] = useState(now.getFullYear());
  const [drillClient, setDrillClient] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const companyId = selectedCompanyId !== 'all' && companies.some(c => c.id === selectedCompanyId)
    ? selectedCompanyId
    : (companies[0]?.id ?? '');
  const selectedCompany = companies.find(c => c.id === companyId);

  useEffect(() => {
    if (!companyId) { setInvoices(null); return; }
    let cancelled = false;
    api.get<{ invoices: InvoiceRow[] }>(`/api/consultancy/billing/${companyId}`)
      .then(res => { if (!cancelled) setInvoices(res.data?.invoices ?? []); })
      .catch(() => { if (!cancelled) setInvoices(null); });
    return () => { cancelled = true; };
  }, [companyId]);

  const handleFile = useCallback(async (file: File) => {
    if (!companyId || !selectedCompany) { alert('Please select a company first.'); return; }
    setUploading(true);
    setUploadMsg('');
    try {
      await withTimeout((async () => {
        const parsed = await parseInvoiceExcel(file);
        if (!parsed.rows.length) {
          alert(`Could not parse "${file.name}". ${parsed.parseNotes.join(' ') || 'Use a roster with Client, Invoice Date, and Amount columns.'}`);
          return;
        }
        await postJsonWithWake('/api/consultancy/billing/save', {
          company_id: companyId,
          invoices: parsed.rows,
        });
        const res = await api.get<{ invoices: InvoiceRow[] }>(`/api/consultancy/billing/${companyId}`);
        setInvoices(res.data?.invoices ?? []);
        setUploadMsg(`Saved ${parsed.rows.length} invoices for ${selectedCompany.name}.`);
      })(), 90_000, 'Invoice upload');
    } catch (e: unknown) {
      alert(`Upload failed: ${formatApiError(e, 'Could not save invoices')}`);
    } finally {
      setUploading(false);
    }
  }, [companyId, selectedCompany]);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const calcRows: CalcRow[] = useMemo(
    () => (invoices ?? []).map(inv => ({ id: inv.id, inv, calc: calcInvoice(inv, today) })),
    [invoices, today],
  );

  const kpis = useMemo(() => {
    const list = invoices ?? [];
    const totalBilled = list.filter(i => inPeriod(i.invoice_date, period, pMonth, pYear))
      .reduce((s, i) => s + i.amount, 0);
    const totalCollected = list.filter(i => i.collected_date && inPeriod(i.collected_date, period, pMonth, pYear))
      .reduce((s, i) => s + i.collected_amount, 0);
    const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : null;
    const arOutstanding = calcRows.reduce((s, r) => s + r.calc.outstanding, 0);
    const trailing365 = new Date(today); trailing365.setDate(trailing365.getDate() - 365);
    const trailingBilled = list.filter(i => parseIso(i.invoice_date) >= trailing365)
      .reduce((s, i) => s + i.amount, 0);
    const dso = trailingBilled > 0 ? arOutstanding / (trailingBilled / 365) : null;
    return { totalBilled, totalCollected, collectionRate, arOutstanding, dso };
  }, [invoices, calcRows, period, pMonth, pYear, today]);

  const availableKeys = useMemo(
    () => (invoices ?? []).map(i => isoMonthKey(i.invoice_date)),
    [invoices],
  );

  const monthlySeries = useMemo(() => {
    const list = invoices ?? [];
    const keys = Array.from(new Set(list.map(i => isoMonthKey(i.invoice_date)))).sort((a, b) => {
      const [am, ay] = a.split(' '); const [bm, by] = b.split(' ');
      const av = parseInt(ay) * 100 + MONTHS.indexOf(am); const bv = parseInt(by) * 100 + MONTHS.indexOf(bm);
      return av - bv;
    }).slice(-12);
    return keys.map(key => {
      const billed = list.filter(i => isoMonthKey(i.invoice_date) === key).reduce((s, i) => s + i.amount, 0);
      const collected = list.filter(i => i.collected_date && isoMonthKey(i.collected_date) === key)
        .reduce((s, i) => s + i.collected_amount, 0);
      const stdSum = list.filter(i => isoMonthKey(i.invoice_date) === key && i.standard_rate_amount != null)
        .reduce((s, i) => s + (i.standard_rate_amount ?? 0), 0);
      const realization = stdSum > 0 ? (billed / stdSum) * 100 : null;
      return { month: key, billed, collected, realization };
    });
  }, [invoices]);

  const hasStandardRate = useMemo(() => (invoices ?? []).some(i => i.standard_rate_amount != null), [invoices]);

  const agingBuckets = useMemo(() => {
    const buckets = { Current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '91+': 0 };
    for (const { calc } of calcRows) {
      if (calc.outstanding <= 0) continue;
      if (calc.daysPastDue <= 0) buckets.Current += calc.outstanding;
      else if (calc.daysPastDue <= 30) buckets['1-30'] += calc.outstanding;
      else if (calc.daysPastDue <= 60) buckets['31-60'] += calc.outstanding;
      else if (calc.daysPastDue <= 90) buckets['61-90'] += calc.outstanding;
      else buckets['91+'] += calc.outstanding;
    }
    return Object.entries(buckets).map(([name, value]) => ({ name, value })).filter(b => b.value > 0);
  }, [calcRows]);

  const topClients = useMemo(() => {
    const list = invoices ?? [];
    const byClient = new Map<string, number>();
    for (const i of list) byClient.set(i.client_name, (byClient.get(i.client_name) ?? 0) + i.collected_amount);
    return Array.from(byClient.entries())
      .map(([name, value]) => ({ name, value }))
      .filter(c => c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [invoices]);

  const clientDrillInvoices = useMemo(
    () => (drillClient ? calcRows.filter(r => r.inv.client_name === drillClient) : []),
    [calcRows, drillClient],
  );

  const columns: Column<CalcRow>[] = [
    { key: 'client', label: 'Client', render: r => r.inv.client_name, sortValue: r => r.inv.client_name },
    { key: 'invoice_date', label: 'Invoice Date', render: r => r.inv.invoice_date, sortValue: r => r.inv.invoice_date },
    { key: 'amount', label: 'Amount', render: r => fmtUsd(r.inv.amount), sortValue: r => r.inv.amount },
    { key: 'due_date', label: 'Due Date', render: r => r.inv.due_date ?? '—', sortValue: r => r.inv.due_date ?? '' },
    {
      key: 'status', label: 'Status', sortValue: r => r.calc.status,
      render: r => {
        const st = STATUS_STYLE[r.calc.status];
        return (
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
            {r.calc.status}
          </span>
        );
      },
    },
    { key: 'days_outstanding', label: 'Days Outstanding', render: r => (r.calc.daysPastDue > 0 ? r.calc.daysPastDue : '—'), sortValue: r => Math.max(0, r.calc.daysPastDue) },
  ];

  return (
    <div style={{ background: PT.pageBg, minHeight: '100vh', fontSize: 13, color: PT.text }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 style={PT_FONT.pageTitle}>Billing &amp; Collections</h1>
          <p style={PT_FONT.pageSubtitle}>Invoice roster, AR aging, and collection performance.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={companyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5"
            style={{ borderColor: PT.border, background: PT.cardBg }}
          >
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <PeriodToggle period={period} month={pMonth} year={pYear} onChange={(p, m, y) => { setPeriod(p); setPMonth(m); setPYear(y); }} availableKeys={availableKeys} compact />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading || !companyId}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white" style={{ background: '#4F46E5' }}>
            <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload Invoices'}
          </button>
        </div>
      </div>
      {uploadMsg && <p className="text-xs mb-3" style={{ color: PT.green }}>{uploadMsg}</p>}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ''; }} />

      {!companies.length ? (
        <div className="border rounded-2xl shadow-sm p-6" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Building2 size={32} className="text-gray-400 mb-3" />
            <p className="text-lg font-semibold text-gray-700 mb-2">No companies yet</p>
            <p className="text-sm text-gray-400">Add a consulting/staffing company to get started.</p>
          </div>
        </div>
      ) : !invoices || !invoices.length ? (
        <div className="border rounded-2xl shadow-sm p-6" style={{ background: '#F7F5F0', borderColor: '#DDD8CC' }}>
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <FileSpreadsheet size={28} className="text-gray-400 mb-3" />
            <p className="text-lg font-semibold text-gray-700 mb-2">No data uploaded</p>
            <p className="text-sm text-gray-400 max-w-md">
              Upload an invoice roster (Client, Invoice Date, Amount, Due Date, Collected Amount, Collected Date)
              to populate this section for {selectedCompany?.name ?? 'this company'}.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <ParchmentKpiTile label="Total Billed" value={fmtUsd(kpis.totalBilled)} sub={period ? periodChipText(period, pMonth, pYear) : `Annual · ${pYear}`} accent />
            <ParchmentKpiTile label="Total Collected" value={fmtUsd(kpis.totalCollected)} />
            <ParchmentKpiTile label="Collection Rate %" value={fmtPct(kpis.collectionRate)} warn={kpis.collectionRate != null && kpis.collectionRate < 80} />
            <ParchmentKpiTile label="AR Outstanding" value={fmtUsd(kpis.arOutstanding)} />
            <ParchmentKpiTile label="DSO (trailing 12mo)" value={kpis.dso != null ? `${kpis.dso.toFixed(0)} days` : '—'} sub="AR Outstanding ÷ trailing-365-day daily billed rate" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>Billed vs Collected Trend</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={monthlySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                  <XAxis dataKey="month" tick={CHART_TICK} />
                  <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
                  <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
                  <Legend {...CHART_LEGEND} />
                  <Bar dataKey="billed" name="Billed" fill={P.gold} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="collected" name="Collected" fill={P.teal} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>AR Aging Breakdown</p>
              {agingBuckets.length === 0 ? (
                <div className="flex items-center justify-center" style={{ height: 220, color: PT.mutedLight }}>No outstanding balances.</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={agingBuckets} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                      {agingBuckets.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
                    <Legend {...CHART_LEGEND} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>Collections by Client · Top 10</p>
              <p style={PT_FONT.chartSubtitle}>Click a bar to see the underlying invoices</p>
              {topClients.length === 0 ? (
                <div className="flex items-center justify-center" style={{ height: 220, color: PT.mutedLight }}>No collections recorded yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topClients} layout="vertical" margin={{ left: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                    <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={CHART_TICK} />
                    <YAxis type="category" dataKey="name" width={120} tick={CHART_TICK} />
                    <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={CHART_TOOLTIP} />
                    <Bar
                      dataKey="value" name="Collected" fill={P.green} radius={[0, 3, 3, 0]}
                      onClick={(d: { name?: string }) => setDrillClient(prev => (prev === d.name ? null : (d.name ?? null)))}
                      style={{ cursor: 'pointer' }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {drillClient && (
                <div className="mt-2">
                  <Table
                    columns={columns}
                    data={clientDrillInvoices}
                    keyField="id"
                    emptyMessage="No matching invoices found."
                  />
                </div>
              )}
            </div>
            <div style={PT_CARD}>
              <p style={PT_FONT.chartTitle}>Realization Rate Trend</p>
              <p style={PT_FONT.chartSubtitle}>Billed Amount ÷ Standard Rate Amount</p>
              {!hasStandardRate ? (
                <div className="flex items-center justify-center text-center px-4" style={{ height: 220, color: PT.mutedLight }}>
                  No standard rate data uploaded — add a "Standard Rate Amount" column to the invoice roster to populate this chart.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={monthlySeries.filter(m => m.realization != null)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={P.border} />
                    <XAxis dataKey="month" tick={CHART_TICK} />
                    <YAxis tick={CHART_TICK} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} contentStyle={CHART_TOOLTIP} />
                    <Line type="monotone" dataKey="realization" name="Realization Rate" stroke={P.blue} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div style={PT_CARD}>
            <p style={PT_FONT.chartTitle}>Invoice List</p>
            <Table columns={columns} data={calcRows} keyField="id" emptyMessage="No invoices found." defaultSortKey="invoice_date" defaultSortDir="desc" />
          </div>
        </div>
      )}
    </div>
  );
}
