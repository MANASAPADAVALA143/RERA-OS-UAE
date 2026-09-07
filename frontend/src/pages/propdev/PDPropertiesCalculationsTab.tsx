import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, Upload } from 'lucide-react';
import type { CompanyData, Loan } from '../../contexts/PropertyDevContext';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import { buildPropDevBoardExportPayload, pickFocusSnapshot } from '../../utils/gatherPropDevBoardExportData';
import { enrichPropDevFinWithCf } from '../../utils/propDevYearlyFinancials';
import {
  fetchPropDevPropertyTax, uploadPropDevPropertyTax, groupTaxByEntity, computePenaltyRows,
  computeInterestPrincipalRows, computeCumulativeInterestRows, computeCostBasisRows, computeBreakEven,
  computeCarryingCostRows, carryingEfficiencyFor, type PropDevPropertyTaxRow,
} from '../../utils/propDevCostBasisCalculations';
import { EmptyState } from '../../components/rental/execSummary/espShared';
import '../../theme/execSummaryPremium.css';

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtPct(n: number | null | undefined, d = 1): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(d)}%` : '—';
}
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_PILL: Record<string, { bg: string; color: string }> = {
  Paid: { bg: 'var(--active-bg)', color: 'var(--active)' },
  Pending: { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' },
  Overdue: { bg: 'var(--overdue-bg)', color: '#6D28D9' },
  Partial: { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' },
};
const DONUT_COLORS: Record<string, string> = {
  Paid: '#1B3A6B', Pending: '#F5A623', Overdue: '#7C3AED', Partial: '#E8821A', Unknown: '#94A3B8',
};

interface Props {
  companies: CompanyData[];
  allLoans: Loan[];
}

export default function PDPropertiesCalculationsTab({ companies, allLoans }: Props) {
  const [taxRows, setTaxRows] = useState<PropDevPropertyTaxRow[]>([]);
  const [loadingTax, setLoadingTax] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  function reloadTax() {
    setLoadingTax(true);
    fetchPropDevPropertyTax().then(setTaxRows).finally(() => setLoadingTax(false));
  }
  useEffect(reloadTax, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadMsg(null);
    try {
      const res = await uploadPropDevPropertyTax(file);
      setUploadMsg({ text: res.message, ok: true });
      reloadTax();
    } catch (ex: unknown) {
      const msg = (ex as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setUploadMsg({ text: msg ?? 'Upload failed — check the file format.', ok: false });
    } finally {
      setUploading(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  const [uploadedFin, setUploadedFin] = useState<Record<string, PDFinancialsLike>>({});
  useEffect(() => {
    if (!companies.length) return;
    let cancelled = false;
    fetchPropDevFinancialsPool(
      companies.map(c => c.id),
      (_id, d) => ({
        years: d.years ?? [], pl: (d.pl ?? []) as PDFinancialsLike['pl'],
        bs: (d.bs ?? []) as PDFinancialsLike['bs'], cf: (d.cf ?? []) as PDFinancialsLike['cf'],
      }),
      { onItem: (id, item) => { if (!cancelled) setUploadedFin(prev => ({ ...prev, [id]: item })); } },
    ).then(merged => { if (!cancelled) setUploadedFin(prev => ({ ...prev, ...merged })); });
    return () => { cancelled = true; };
  }, [companies]);

  const taxGroups = useMemo(() => groupTaxByEntity(taxRows), [taxRows]);
  const penaltyRows = useMemo(() => computePenaltyRows(taxGroups), [taxGroups]);
  const taxTotals = useMemo(() => ({
    totalTax: taxRows.reduce((s, r) => s + r.tax_amount, 0),
    totalWithPenalty: taxRows.reduce((s, r) => s + r.tax_with_penalty, 0),
    totalPaid: taxRows.reduce((s, r) => s + r.paid_amount, 0),
    totalBalance: taxRows.reduce((s, r) => s + r.balance, 0),
  }), [taxRows]);
  const totalPenalty = taxTotals.totalWithPenalty - taxTotals.totalTax;
  const propertiesWithBalance = taxRows.filter(r => r.balance > 0).length;
  const entitiesWithTax = new Set(taxRows.map(r => r.entity_name)).size;

  const donutData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of taxRows) {
      const k = r.payment_status || 'Unknown';
      map[k] = (map[k] || 0) + r.tax_with_penalty;
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [taxRows]);

  const taxByEntityChart = useMemo(() => taxGroups.map(g => ({
    name: g.entityName.length > 18 ? `${g.entityName.slice(0, 16)}…` : g.entityName,
    baseTax: g.rows.reduce((s, r) => s + r.tax_amount, 0),
    withPenalty: g.rows.reduce((s, r) => s + r.tax_with_penalty, 0),
  })), [taxGroups]);

  const operatingExpensesByCompany = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of companies) {
      const fin = uploadedFin[c.id];
      if (!fin || (!fin.pl.length && !fin.bs.length)) { map[c.id] = 0; continue; }
      try {
        const enriched = enrichPropDevFinWithCf(fin, c);
        const payload = buildPropDevBoardExportPayload(enriched, c, allLoans, null, new Date().getFullYear(), 'YTD');
        const snap = pickFocusSnapshot(payload.plSnapshots, payload.focusYear);
        map[c.id] = snap?.exp ?? 0;
      } catch { map[c.id] = 0; }
    }
    return map;
  }, [companies, uploadedFin, allLoans]);

  const interestPrincipalRows = useMemo(() => computeInterestPrincipalRows(companies, allLoans), [companies, allLoans]);
  const ipTotals = useMemo(() => ({
    emi: interestPrincipalRows.reduce((s, r) => s + r.annualEmi, 0),
    interest: interestPrincipalRows.reduce((s, r) => s + r.annualInterest, 0),
    principal: interestPrincipalRows.reduce((s, r) => s + r.annualPrincipal, 0),
  }), [interestPrincipalRows]);
  const avgInterestPct = ipTotals.emi > 0 ? (ipTotals.interest / ipTotals.emi) * 100 : 0;

  const burdenChartData = useMemo(() => {
    const byEntity = new Map<string, { principal: number; interest: number }>();
    for (const r of interestPrincipalRows) {
      const cur = byEntity.get(r.entityName) ?? { principal: 0, interest: 0 };
      cur.principal += r.annualPrincipal; cur.interest += r.annualInterest;
      byEntity.set(r.entityName, cur);
    }
    return [...byEntity.entries()].map(([name, v]) => ({ name: name.length > 18 ? `${name.slice(0, 16)}…` : name, ...v }));
  }, [interestPrincipalRows]);

  const cumulativeInterestRows = useMemo(() => computeCumulativeInterestRows(companies, allLoans), [companies, allLoans]);

  const costBasisRows = useMemo(
    () => computeCostBasisRows(companies, allLoans, taxGroups, cumulativeInterestRows, operatingExpensesByCompany),
    [companies, allLoans, taxGroups, cumulativeInterestRows, operatingExpensesByCompany],
  );

  const carryingCostRows = useMemo(
    () => computeCarryingCostRows(companies, allLoans, taxGroups, operatingExpensesByCompany, costBasisRows),
    [companies, allLoans, taxGroups, operatingExpensesByCompany, costBasisRows],
  );

  const [selectedEntityId, setSelectedEntityId] = useState(companies[0]?.id ?? '');
  useEffect(() => {
    if (!companies.some(c => c.id === selectedEntityId)) setSelectedEntityId(companies[0]?.id ?? '');
  }, [companies, selectedEntityId]);
  const selectedCompany = companies.find(c => c.id === selectedEntityId);
  const selectedCostBasis = costBasisRows.find(r => r.entityId === selectedEntityId);

  const waterfallData = useMemo(() => {
    if (!selectedCostBasis) return [];
    const steps = [
      { key: 'Land Cost', value: selectedCostBasis.landCost, fill: '#1A1D29' },
      { key: 'Improvements', value: selectedCostBasis.improvements, fill: '#1B3A6B' },
      { key: 'Tax Paid', value: selectedCostBasis.propertyTaxPaid, fill: '#F5A623' },
      { key: 'Interest Paid', value: selectedCostBasis.interestPaidToDate, fill: '#7C3AED' },
      { key: 'Operating', value: selectedCostBasis.operatingExpenses, fill: '#E8821A' },
    ];
    let running = 0;
    const bars = steps.map(s => {
      const base = running;
      running += s.value;
      return { name: s.key, base, value: s.value, fill: s.fill };
    });
    bars.push({ name: 'Total Cost', base: 0, value: running, fill: '#5B5FEF' });
    if (selectedCostBasis.currentLandValue != null) {
      bars.push({ name: 'Current Value', base: 0, value: selectedCostBasis.currentLandValue, fill: '#5BB5A2' });
    }
    return bars;
  }, [selectedCostBasis]);

  const [targetReturn, setTargetReturn] = useState(15);
  const [sellingCosts, setSellingCosts] = useState(3);
  const [taxOnGain, setTaxOnGain] = useState(20);
  const breakEven = selectedCostBasis
    ? computeBreakEven(selectedCostBasis.totalCostBasis, selectedCostBasis.currentLandValue, targetReturn, sellingCosts, taxOnGain)
    : null;

  if (!companies.length) {
    return (
      <div className="esp-scope esp-fade-in esp-card" style={{ marginTop: 16 }}>
        <EmptyState icon={<AlertTriangle size={32} />} title="No entities available" />
      </div>
    );
  }

  return (
    <div className="esp-scope esp-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>

      {/* ══════════ SECTION 1 — PROPERTY TAX TRACKER ══════════ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="esp-section-title" style={{ margin: 0 }}>Property Tax Tracker</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {uploadMsg && (
            <span style={{ fontSize: 11, color: uploadMsg.ok ? 'var(--active)' : 'var(--overdue)' }}>{uploadMsg.text}</span>
          )}
          <input ref={importRef} type="file" accept=".xlsx,.xlsm" className="hidden" style={{ display: 'none' }} onChange={handleUpload} />
          <button type="button" className="esp-btn-primary" disabled={uploading} onClick={() => importRef.current?.click()}>
            <Upload size={13} style={{ marginRight: 6 }} />{uploading ? 'Uploading…' : 'Upload Property Tax Excel'}
          </button>
        </div>
      </div>

      {loadingTax ? (
        <div className="esp-card"><EmptyState icon={<AlertTriangle size={32} />} title="Loading property tax data…" /></div>
      ) : taxRows.length === 0 ? (
        <div className="esp-card">
          <EmptyState icon={<AlertTriangle size={32} />} title="No property tax records yet" note="Upload an Excel file with columns: SL No, Entity Name, Property Address, Year, Year Tax with Penalty, Paid Amount, Balance, Payment Date, Payment Status." />
        </div>
      ) : (
        <>
          {/* A. Tax Summary Strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
            <div className="esp-card" style={{ borderLeft: '3px solid #1B3A6B', padding: '16px 20px' }}>
              <span className="esp-label">Total Tax</span>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{fmtUsd(taxTotals.totalTax)}</div>
              <div className="esp-sub" style={{ marginTop: 4 }}>{taxRows.length} properties across {entitiesWithTax} entities</div>
            </div>
            <div className="esp-card" style={{ borderLeft: '3px solid #F5A623', padding: '16px 20px' }}>
              <span className="esp-label">Total With Penalty</span>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{fmtUsd(taxTotals.totalWithPenalty)}</div>
              <div className="esp-sub" style={{ marginTop: 4, color: totalPenalty > 0 ? '#7C3AED' : undefined }}>
                {totalPenalty > 0 ? `${fmtUsd(totalPenalty)} in penalties` : 'Including late payment penalties'}
              </div>
            </div>
            <div className="esp-card" style={{ borderLeft: '3px solid #5BB5A2', padding: '16px 20px' }}>
              <span className="esp-label">Total Paid</span>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6 }}>{fmtUsd(taxTotals.totalPaid)}</div>
              <div className="esp-sub" style={{ marginTop: 4 }}>{fmtPct(taxTotals.totalWithPenalty > 0 ? (taxTotals.totalPaid / taxTotals.totalWithPenalty) * 100 : 0)} of total with penalty</div>
            </div>
            <div className="esp-card" style={{ borderLeft: `3px solid ${taxTotals.totalBalance > 0 ? '#7C3AED' : '#1B3A6B'}`, padding: '16px 20px' }}>
              <span className="esp-label">Total Balance Outstanding</span>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 6, color: taxTotals.totalBalance > 0 ? '#7C3AED' : undefined }}>{fmtUsd(taxTotals.totalBalance)}</div>
              <div className="esp-sub" style={{ marginTop: 4 }}>{propertiesWithBalance} properties with balance</div>
            </div>
          </div>

          {/* B. Property Tax Table (grouped by entity) */}
          <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Property Tax — By Entity</div>
            <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
              <table className="esp-table">
                <thead><tr><th>Property Address</th><th style={{ textAlign: 'right' }}>Tax</th><th style={{ textAlign: 'right' }}>W/Penalty</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Balance</th><th>Payment Date</th><th>Status</th></tr></thead>
                <tbody>
                  {taxGroups.map(g => (
                    <Fragment key={g.entityName}>
                      <tr style={{ background: 'var(--gold-light)' }}>
                        <td colSpan={2} style={{ fontWeight: 700 }}>{g.entityName} <span style={{ fontWeight: 400, color: 'var(--slate)' }}>· {g.rows.length} properties</span></td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtUsd(g.totalTax)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtUsd(g.totalPaid)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtUsd(g.totalBalance)}</td>
                        <td /><td />
                      </tr>
                      {g.rows.map(r => (
                        <tr key={r.id} className="esp-row-hover">
                          <td title={r.property_address ?? undefined} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.property_address ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{fmtUsd(r.tax_amount)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {fmtUsd(r.tax_with_penalty)}
                            {r.penalty_amount > 0 && <div style={{ fontSize: 10, color: '#F5A623' }}>+{fmtUsd(r.penalty_amount)} penalty</div>}
                          </td>
                          <td style={{ textAlign: 'right' }}>{fmtUsd(r.paid_amount)}</td>
                          <td style={{ textAlign: 'right', color: r.balance > 0 ? '#7C3AED' : '#1B3A6B', fontWeight: r.balance > 0 ? 700 : 400 }}>
                            {r.balance > 0 ? fmtUsd(r.balance) : 'Cleared'}
                          </td>
                          <td>{fmtDate(r.payment_date) === '—' ? <span style={{ color: 'var(--slate)' }}>—</span> : fmtDate(r.payment_date)}</td>
                          <td>
                            {r.payment_status
                              ? <span className="esp-pill" style={STATUS_PILL[r.payment_status] ?? { bg: 'var(--neutral-pill)', color: 'var(--slate)' }}>{r.payment_status}</span>
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  <tr className="esp-total-row">
                    <td>PORTFOLIO TOTAL</td>
                    <td style={{ textAlign: 'right' }}>{taxRows.length}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(taxTotals.totalWithPenalty)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(taxTotals.totalPaid)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(taxTotals.totalBalance)}</td>
                    <td /><td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* C. Tax Analytics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
            <div className="esp-card">
              <div className="esp-section-title">Tax by Entity</div>
              <ResponsiveContainer width="100%" height={Math.max(180, taxByEntityChart.length * 40)}>
                <BarChart data={[...taxByEntityChart].sort((a, b) => b.withPenalty - a.withPenalty)} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tickFormatter={v => fmtUsd(v)} tick={{ fontSize: 10, fill: 'var(--slate)' }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--slate)' }} width={120} />
                  <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="baseTax" name="Tax" fill="#1B3A6B" />
                  <Bar dataKey="withPenalty" name="w/ Penalty" fill="#F5A623" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="esp-card">
              <div className="esp-section-title">Payment Status Breakdown</div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                    {donutData.map(d => <Cell key={d.name} fill={DONUT_COLORS[d.name] ?? '#94A3B8'} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, marginTop: -8 }}>Total: {fmtUsd(taxTotals.totalWithPenalty)}</div>
            </div>
          </div>

          {/* D. Penalty Analysis */}
          {penaltyRows.length > 0 && (
            <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Penalty Analysis</div>
              <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
                <table className="esp-table">
                  <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Properties</th><th style={{ textAlign: 'right' }}>Base Tax</th><th style={{ textAlign: 'right' }}>Penalty Amount</th><th style={{ textAlign: 'right' }}>Penalty %</th></tr></thead>
                  <tbody>
                    {penaltyRows.map(r => (
                      <tr key={r.entityName} className="esp-row-hover">
                        <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                        <td style={{ textAlign: 'right' }}>{r.properties}</td>
                        <td style={{ textAlign: 'right' }}>{fmtUsd(r.baseTax)}</td>
                        <td style={{ textAlign: 'right', color: '#F5A623', fontWeight: 700 }}>{fmtUsd(r.penaltyAmount)}</td>
                        <td style={{ textAlign: 'right', color: '#F5A623' }}>{fmtPct(r.penaltyPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ padding: '8px 24px 20px', fontSize: 11, fontStyle: 'italic', color: 'var(--slate)' }}>
                {fmtUsd(totalPenalty)} in penalties could have been avoided with timely payment.
              </p>
            </div>
          )}
        </>
      )}

      {/* ══════════ SECTION 2 — LOAN INTEREST & PRINCIPAL BREAKDOWN ══════════ */}
      <div className="esp-section-title" style={{ marginTop: 8 }}>Loan Interest &amp; Principal — Property Level</div>
      <div className="esp-sub" style={{ marginTop: -12 }}>Annual breakdown of debt cost per entity and property</div>

      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        {interestPrincipalRows.length === 0 ? (
          <div style={{ padding: 24 }}><EmptyState icon={<AlertTriangle size={32} />} title="No active loans" /></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th>Lender</th><th style={{ textAlign: 'right' }}>Outstanding</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Annual EMI</th><th style={{ textAlign: 'right' }}>Annual Interest</th><th style={{ textAlign: 'right' }}>Annual Principal</th><th style={{ textAlign: 'right' }}>Interest %</th><th>Status</th></tr></thead>
              <tbody>
                {interestPrincipalRows.map(r => (
                  <tr key={r.loanId} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                    <td>{r.lender}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.outstanding)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtPct(r.rate, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.annualEmi)}</td>
                    <td style={{ textAlign: 'right', color: '#7C3AED' }}>{fmtUsd(r.annualInterest)}</td>
                    <td style={{ textAlign: 'right', color: '#1B3A6B' }}>{fmtUsd(r.annualPrincipal)}</td>
                    <td style={{ textAlign: 'right', color: r.interestPct > 80 ? '#7C3AED' : r.interestPct >= 60 ? '#F5A623' : '#1B3A6B', fontWeight: 700 }}>{fmtPct(r.interestPct)}</td>
                    <td>
                      <span className="esp-pill" style={
                        r.status === 'Interest heavy' ? { bg: 'var(--overdue-bg)', color: '#6D28D9' }
                          : r.status === 'Balanced' ? { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' }
                            : { bg: 'var(--active-bg)', color: 'var(--active)' }
                      }>{r.status}</span>
                    </td>
                  </tr>
                ))}
                <tr className="esp-total-row">
                  <td colSpan={4}>Portfolio Total</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(ipTotals.emi)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(ipTotals.interest)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(ipTotals.principal)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtPct(avgInterestPct)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {burdenChartData.length > 0 && (
        <div className="esp-card">
          <div className="esp-section-title">Interest Burden by Entity</div>
          <ResponsiveContainer width="100%" height={Math.max(200, burdenChartData.length * 40)}>
            <BarChart data={burdenChartData} layout="vertical" stackOffset="none" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tickFormatter={v => fmtUsd(v)} tick={{ fontSize: 10, fill: 'var(--slate)' }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--slate)' }} width={120} />
              <Tooltip formatter={(v: number) => fmtUsd(v)} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="principal" stackId="a" name="Principal" fill="#1B3A6B" />
              <Bar dataKey="interest" stackId="a" name="Interest" fill="#7C3AED" />
            </BarChart>
          </ResponsiveContainer>
          <div className="esp-sub" style={{ marginTop: 8 }}>
            {fmtPct(avgInterestPct)} of total debt service is interest ({fmtUsd(ipTotals.interest)}/year across all loans).
          </div>
        </div>
      )}

      {cumulativeInterestRows.length > 0 && (
        <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px 0' }} className="esp-section-title">Cumulative Interest Tracker</div>
          <div className="esp-sub" style={{ padding: '0 24px' }}>How much interest paid to date?</div>
          <div style={{ overflowX: 'auto', padding: '16px 0 0' }}>
            <table className="esp-table">
              <thead><tr><th>Entity</th><th>Lender</th><th>Loan Start</th><th style={{ textAlign: 'right' }}>Months Elapsed</th><th style={{ textAlign: 'right' }}>Cumulative Interest</th><th style={{ textAlign: 'right' }}>Cumulative Principal</th><th style={{ textAlign: 'right' }}>% Paid Off</th></tr></thead>
              <tbody>
                {cumulativeInterestRows.map(r => (
                  <tr key={r.loanId} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                    <td>{r.lender}</td>
                    <td>{fmtDate(r.loanStart)}</td>
                    <td style={{ textAlign: 'right' }}>{r.monthsElapsed}</td>
                    <td style={{ textAlign: 'right', color: '#7C3AED' }}>{fmtUsd(r.cumulativeInterest)}</td>
                    <td style={{ textAlign: 'right', color: '#1B3A6B' }}>{fmtUsd(r.cumulativePrincipal)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: r.pctPaidOff > 50 ? '#1B3A6B' : r.pctPaidOff >= 25 ? '#F5A623' : '#7C3AED' }}>{fmtPct(r.pctPaidOff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════ SECTION 3 — COST BASIS & RETURN CALCULATOR ══════════ */}
      <div className="esp-section-title" style={{ marginTop: 8 }}>Cost Basis &amp; Return Calculator</div>
      <div className="esp-sub" style={{ marginTop: -12 }}>Total cost of ownership including acquisition, improvements, tax, and financing cost</div>

      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="esp-table">
            <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Land Cost</th><th style={{ textAlign: 'right' }}>Improvements</th><th style={{ textAlign: 'right' }}>Tax Paid</th><th style={{ textAlign: 'right' }}>Interest Paid</th><th style={{ textAlign: 'right' }}>Operating Exp.</th><th style={{ textAlign: 'right' }}>Total Cost Basis</th><th style={{ textAlign: 'right' }}>Current Land Value</th><th style={{ textAlign: 'right' }}>Gain/(Loss)</th><th style={{ textAlign: 'right' }}>Return %</th></tr></thead>
            <tbody>
              {costBasisRows.map(r => (
                <tr key={r.entityId} className="esp-row-hover">
                  <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(r.landCost)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(r.improvements)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(r.propertyTaxPaid)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(r.interestPaidToDate)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtUsd(r.operatingExpenses)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtUsd(r.totalCostBasis)}</td>
                  <td style={{ textAlign: 'right' }}>{r.currentLandValue != null ? fmtUsd(r.currentLandValue) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: r.gainLoss == null ? 'var(--slate)' : r.gainLoss >= 0 ? '#5BB5A2' : '#7C3AED' }}>
                    {r.gainLoss == null ? '—' : r.gainLoss >= 0 ? `+${fmtUsd(r.gainLoss)}` : `(${fmtUsd(Math.abs(r.gainLoss))})`}
                  </td>
                  <td style={{ textAlign: 'right', color: r.returnPct == null ? 'var(--slate)' : r.returnPct >= 0 ? '#5BB5A2' : '#7C3AED' }}>{fmtPct(r.returnPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="esp-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="esp-section-title" style={{ margin: 0 }}>Cost Waterfall</div>
          <select
            value={selectedEntityId}
            onChange={e => setSelectedEntityId(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 12 }}
          >
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {waterfallData.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={28} />} title="No cost basis data for this entity" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={waterfallData} margin={{ left: 10, right: 10, top: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--slate)' }} angle={-20} textAnchor="end" height={60} />
              <YAxis tickFormatter={v => fmtUsd(v)} tick={{ fontSize: 10, fill: 'var(--slate)' }} width={80} />
              <Tooltip formatter={(v: number, key: string) => [fmtUsd(v), key === 'value' ? 'Amount' : key]} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="base" stackId="w" fill="transparent" />
              <Bar dataKey="value" stackId="w" name="Amount">
                {waterfallData.map(d => <Cell key={d.name} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {selectedCostBasis && breakEven && (
        <div className="esp-card">
          <div className="esp-section-title">Break-Even Analysis — What does the property need to sell for?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Target Return: {targetReturn}%</label><br />
              <input type="range" min={0} max={50} step={1} value={targetReturn} onChange={e => setTargetReturn(Number(e.target.value))} style={{ accentColor: 'var(--gold)', width: 200 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Selling Costs: {sellingCosts}%</label><br />
              <input type="range" min={0} max={10} step={0.5} value={sellingCosts} onChange={e => setSellingCosts(Number(e.target.value))} style={{ accentColor: 'var(--gold)', width: 200 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Tax on Gain: {taxOnGain}%</label><br />
              <input type="range" min={0} max={40} step={1} value={taxOnGain} onChange={e => setTaxOnGain(Number(e.target.value))} style={{ accentColor: 'var(--gold)', width: 200 }} />
            </div>
          </div>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 22px', maxWidth: 480 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Break-Even Analysis — {selectedCompany?.name}</div>
            {[
              ['Total cost basis', fmtUsd(breakEven.totalCostBasis)],
              [`Target return (${targetReturn}%)`, `+${fmtUsd(breakEven.targetNetProceed - breakEven.totalCostBasis)}`],
              [`Selling costs (${sellingCosts}%)`, `+${fmtUsd(breakEven.sellingCostsAmount)}`],
              ['Capital gains tax', `+${fmtUsd(breakEven.taxOnGainAmount)}`],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
                <span style={{ color: 'var(--slate)' }}>{label}</span><span>{value}</span>
              </div>
            ))}
            <div style={{ borderTop: '2px solid var(--gold)', marginTop: 8, paddingTop: 8, background: 'var(--gold-light)', margin: '8px -22px -18px', padding: '12px 22px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>MIN SALE PRICE</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#5B5FEF' }}>{fmtUsd(breakEven.grossSalePriceNeeded)}</span>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--slate)' }}>Current land value</span>
                <span>{breakEven.currentLandValue != null ? fmtUsd(breakEven.currentLandValue) : '—'}</span>
              </div>
              {breakEven.gapAmount != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ color: 'var(--slate)' }}>Gap to target</span>
                  <span style={{ fontWeight: 700, color: breakEven.gapAmount >= 0 ? '#5BB5A2' : '#7C3AED' }}>
                    {breakEven.gapAmount >= 0 ? `+${fmtUsd(breakEven.gapAmount)} · Above target` : `${fmtUsd(breakEven.gapAmount)} · Below target`}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════ SECTION 4 — TAX & CARRYING COST EFFICIENCY ══════════ */}
      <div className="esp-section-title" style={{ marginTop: 8 }}>Tax &amp; Carrying Cost Efficiency</div>
      <div className="esp-sub" style={{ marginTop: -12 }}>Annual carrying cost as % of land value — benchmark for hold vs sell</div>

      <div className="esp-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="esp-table">
            <thead><tr><th>Entity</th><th style={{ textAlign: 'right' }}>Land Value</th><th style={{ textAlign: 'right' }}>Annual Tax</th><th style={{ textAlign: 'right' }}>Annual Interest</th><th style={{ textAlign: 'right' }}>Annual Operating</th><th style={{ textAlign: 'right' }}>Total Carrying</th><th>Carrying %</th><th style={{ textAlign: 'right' }}>Years Held</th><th style={{ textAlign: 'right' }}>Carrying To Date</th><th>Efficiency</th></tr></thead>
            <tbody>
              {carryingCostRows.map(r => {
                const eff = r.carryingPct != null ? carryingEfficiencyFor(r.carryingPct) : null;
                const effTone = eff === 'Efficient' ? { bg: 'var(--active-bg)', color: 'var(--active)' }
                  : eff === 'Moderate' ? { bg: 'var(--pending-bg)', color: 'var(--pending-dark)' }
                    : eff === 'High cost' ? { bg: 'var(--overdue-bg)', color: '#6D28D9' } : null;
                return (
                  <tr key={r.entityId} className="esp-row-hover">
                    <td style={{ fontWeight: 600 }}>{r.entityName}</td>
                    <td style={{ textAlign: 'right' }}>{r.landValue != null ? fmtUsd(r.landValue) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.annualTax)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.annualInterest)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtUsd(r.annualOperating)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtUsd(r.totalCarrying)}</td>
                    <td>{effTone ? <span className="esp-pill" style={effTone}>{fmtPct(r.carryingPct)}</span> : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.yearsHeld != null ? r.yearsHeld.toFixed(1) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{r.totalCarryingToDate != null ? fmtUsd(r.totalCarryingToDate) : '—'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div className="esp-bar-track" style={{ width: 60 }}>
                          <div className="esp-bar-fill" style={{ width: `${r.efficiencyScore}%`, background: r.efficiencyScore > 75 ? '#1B3A6B' : r.efficiencyScore >= 50 ? '#F5A623' : '#7C3AED' }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: r.efficiencyScore > 75 ? '#1B3A6B' : r.efficiencyScore >= 50 ? '#F5A623' : '#7C3AED' }}>
                          {r.efficiencyScore > 75 ? 'Efficient hold' : r.efficiencyScore >= 50 ? 'Monitor' : 'Review exit'}
                        </span>
                      </div>
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
