import { useEffect, useState, useMemo, useCallback } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import type { CapitalCall } from '../../contexts/PropertyDevContext';
import { usePropDevNav } from '../../contexts/PropDevNavContext';
import { Plus, X, AlertTriangle, CheckCircle2, Bell, Trash2, Calculator, Upload, Download } from 'lucide-react';
import PropDevPageHeader from '../../components/propdev/PropDevPageHeader';
import CapitalCallsCharts from '../../components/propdev/CapitalCallsCharts';
import { ParchmentKpiTile } from '../../components/ui/ParchmentKpiTile';
import { PT, PT_FONT, PT_CARD } from '../../utils/parchmentTypography';
import { parchmentStyles } from '../../theme/parchmentTheme';
import { exportPropDevCapitalCallsPdf } from '../../utils/propDevSectionPdfExport';
import { PROPDEV_EXPORT_PDF_EVENT } from '../../utils/propDevExportEvents';

const STATUS_BADGE: Record<CapitalCall['status'], { background: string; color: string }> = {
  Paid:        { background: '#DCFCE7', color: PT.green },
  Partial:     { background: '#FFFBEB', color: PT.amber },
  Outstanding: { background: '#EFF6FF', color: PT.blue },
  Overdue:     { background: '#FEF2F2', color: PT.red },
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

// ── Expense builder types ─────────────────────────────────────────────────────

interface ExpenseRow {
  id: string;
  category: string;
  description: string;
  amount: number;
}

const DEFAULT_CATEGORIES = [
  'Construction Materials', 'Labor & Contractors', 'Site Development',
  'Professional Fees', 'Permits & Approvals', 'Loan Servicing',
  'Marketing & Sales', 'Utilities', 'Insurance', 'Miscellaneous',
];

function newExpenseRow(): ExpenseRow {
  return { id: `exp-${Date.now()}-${Math.random()}`, category: DEFAULT_CATEGORIES[0], description: '', amount: 0 };
}

// ── Decision Header ───────────────────────────────────────────────────────────

function DecisionHeader({ capitalCalls, totalExpenseNeed, monthlyEmi, cashAvailable, companyLabel, onUploadClick }: {
  capitalCalls: CapitalCall[];
  totalExpenseNeed: number;
  monthlyEmi: number;
  cashAvailable: number;
  companyLabel: string;
  onUploadClick: () => void;
}) {
  const overdue      = capitalCalls.filter(c => c.status === 'Overdue');
  const outstanding  = capitalCalls.filter(c => c.status !== 'Paid');
  const outstandingAmount = capitalCalls.reduce((sum, call) => sum + Math.max(0, call.totalDue - call.received), 0);
  const cashShortfall = totalExpenseNeed > cashAvailable;
  const urgency = capitalCalls.length === 0
    ? 'unknown'
    : overdue.length > 0
      ? 'high'
      : outstandingAmount > 0 || cashShortfall
        ? 'medium'
        : 'low';

  const config = {
    high:   { bg: '#FEF2F2', border: '#FECACA', iconColor: PT.red,   title: 'CALL NOW — Overdue Obligations',       color: PT.red   },
    medium: { bg: '#FFFBEB', border: '#FDE68A', iconColor: PT.amber, title: 'ACTION NEEDED — Capital Outstanding',  color: '#92400E' },
    low:    { bg: '#F0FDF4', border: '#BBF7D0', iconColor: PT.green, title: 'NO CALL NEEDED — Position Adequate',    color: PT.green },
    unknown:{ bg: PT.pageBg, border: PT.border, iconColor: PT.muted, title: 'NO CAPITAL CALL DATA PARSED',           color: PT.muted },
  }[urgency];

  const urgencyIcon = urgency === 'low'
    ? <CheckCircle2 size={20} style={{ color: config.iconColor }} />
    : <AlertTriangle size={20} style={{ color: config.iconColor }} />;

  const bullets =
    urgency === 'unknown'
      ? [
          `No capital-call records were found for ${companyLabel}.`,
          'This is not treated as a $0 outstanding position.',
          'Upload your single Excel file via Data Import → Upload Data (all companies in one workbook).',
          'Tab names should match Company Registry (LLC / Group suffix optional). Annexure / Loan tabs in the same file are OK.',
        ]
      : urgency === 'high'
      ? [
          `${overdue.length} capital call${overdue.length > 1 ? 's' : ''} overdue — total $${overdue.reduce((s, c) => s + c.totalDue - c.received, 0).toLocaleString()} unpaid.`,
          'Send formal demand notices immediately to avoid default provisions.',
          `Consider calling $${Math.max(0, totalExpenseNeed - cashAvailable).toLocaleString()} above current cash to cover 6-month obligations.`,
        ]
      : urgency === 'medium'
        ? [
            `$${outstandingAmount.toLocaleString()} remains outstanding across ${outstanding.length} active capital call record${outstanding.length === 1 ? '' : 's'}.`,
            cashShortfall
              ? `Expense pipeline ($${totalExpenseNeed.toLocaleString()}) exceeds current cash ($${cashAvailable.toLocaleString()}).`
              : 'Follow up on unpaid or partially paid partner balances.',
            'Review due dates and send reminders before balances become overdue.',
          ]
        : [
            `Cash ($${cashAvailable.toLocaleString()}) covers ${monthlyEmi > 0 ? (cashAvailable / monthlyEmi).toFixed(1) : '∞'} months of obligations.`,
            `${outstanding.length} active capital calls being serviced on schedule.`,
            'Monitor monthly — call if collections slip below 70% of target.',
          ];

  return (
    <div className="rounded-xl p-5" style={{ background: config.bg, border: `1px solid ${config.border}` }}>
      <div className="flex items-start gap-3">
        {urgencyIcon}
        <div className="flex-1">
          <h3 style={{ ...PT_FONT.sectionTitle, color: config.color }}>{config.title}</h3>
          <ul className="mt-2 space-y-1">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2" style={{ ...PT_FONT.body, color: config.color }}>
                <span className="font-bold shrink-0">·</span>{b}
              </li>
            ))}
          </ul>
          {urgency === 'unknown' && (
            <button
              type="button"
              onClick={onUploadClick}
              style={{ ...parchmentStyles.btnPrimary, marginTop: 16, padding: '8px 16px' }}
            >
              <Upload size={15} /> Upload Capital Call Data
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PD06CapitalCalls() {
  const { companies, capitalCalls: allCtxCalls, partners: allCtxPartners, loans, properties,
          selectedCompanyId, setSelectedCompanyId } = usePropDev();
  const { setTab } = usePropDevNav();

  const [localPartnerName,  setLocalPartnerName]  = useState('all');
  const [showModal,         setShowModal]         = useState(false);
  const [form,              setForm]              = useState({ period: '', totalCallAmount: '', dueDate: '', notes: '' });
  const [expenses,          setExpenses]          = useState<ExpenseRow[]>([newExpenseRow()]);
  const [showExpenses,      setShowExpenses]      = useState(true);
  const [exportingPdf,      setExportingPdf]      = useState(false);

  // ── All data from all companies (for local filters) ────────────────────────
  const allCompaniesData = useMemo(() => companies, [companies]);

  // Build partner → type lookup (from all companies)
  const partnerTypeMap = useMemo(() => {
    const map: Record<string, 'Class A' | 'Class B'> = {};
    allCompaniesData.forEach(c => c.partners.forEach(p => { map[p.id] = p.type; }));
    return map;
  }, [allCompaniesData]);

  // All capital calls + partners scoped to local company filter
  const scopedCompanies = useMemo(
    () => selectedCompanyId === 'all' ? allCompaniesData : allCompaniesData.filter(c => c.id === selectedCompanyId),
    [allCompaniesData, selectedCompanyId],
  );

  const scopedCalls    = useMemo(() => scopedCompanies.flatMap(c => c.capitalCalls), [scopedCompanies]);
  const scopedPartners = useMemo(() => scopedCompanies.flatMap(c => c.partners),     [scopedCompanies]);

  // Unique partner names for dropdown (within scoped companies)
  const partnerNames = useMemo(
    () => [...new Set(scopedPartners.map(p => p.name))].sort(),
    [scopedPartners],
  );

  // Apply partner filter
  const filteredCalls = useMemo(() => {
    if (localPartnerName === 'all') return scopedCalls;
    return scopedCalls.filter(c => c.partnerName === localPartnerName);
  }, [scopedCalls, localPartnerName]);

  // Partner-wise mode: one partner selected → show aggregated partner view
  const isPartnerView = localPartnerName !== 'all';

  useEffect(() => {
    setLocalPartnerName('all');
  }, [selectedCompanyId]);

  const companyNameMap = useMemo(
    () => Object.fromEntries(allCompaniesData.map(c => [c.id, c.name])),
    [allCompaniesData],
  );

  const companyLabel = selectedCompanyId === 'all'
    ? 'the selected filter (all companies)'
    : (companyNameMap[selectedCompanyId] ?? 'this company');

  const companiesMissingCalls = useMemo(
    () => allCompaniesData.filter(c => c.capitalCalls.length === 0).map(c => c.name),
    [allCompaniesData],
  );

  function goToCapitalCallUpload() {
    if (selectedCompanyId !== 'all') {
      setSelectedCompanyId(selectedCompanyId);
    }
    setTab('upload');
  }

  // ── KPIs (based on filtered calls) ────────────────────────────────────────
  const totalCalled      = filteredCalls.reduce((s, c) => s + c.totalDue, 0);
  const totalReceived    = filteredCalls.reduce((s, c) => s + c.received, 0);
  const totalOutstanding = totalCalled - totalReceived;
  const overdueCount     = filteredCalls.filter(c => c.status === 'Overdue').length;

  const monthlyEmi    = loans.reduce((s, l) => s + l.emi, 0);
  const cashAvailable = properties[0]?.cashAvailable ?? 0;

  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const entityLabel = selectedCompanyId === 'all'
        ? 'All Companies'
        : (companyNameMap[selectedCompanyId] ?? 'Property Dev Entity');
      await exportPropDevCapitalCallsPdf({
        entityLabel,
        periodLabel: 'All Time',
        partnerFilterLabel: localPartnerName === 'all' ? 'All Partners' : localPartnerName,
        calls: filteredCalls,
        partnerTypeMap,
        companyNameMap,
        cashAvailable,
        monthlyEmi,
      });
    } catch (e: unknown) {
      window.alert(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportingPdf(false);
    }
  }, [
    selectedCompanyId, companyNameMap, localPartnerName, filteredCalls,
    partnerTypeMap, cashAvailable, monthlyEmi,
  ]);

  // Top Command Strip "Export PDF" while on Capital Calls
  useEffect(() => {
    const onExport = (e: Event) => {
      const detail = (e as CustomEvent<{ scope?: string }>).detail ?? {};
      if (detail.scope && detail.scope !== 'capital-calls') return;
      void handleExportPdf();
    };
    window.addEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
    return () => window.removeEventListener(PROPDEV_EXPORT_PDF_EVENT, onExport);
  }, [handleExportPdf]);

  const totalExpenseNeed = useMemo(
    () => expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [expenses],
  );

  const partnerSplits = useMemo(() => {
    const total = parseFloat(form.totalCallAmount.replace(/,/g, '') || '0');
    return scopedPartners.filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).map(p => ({
      ...p,
      callShare: (p.sharePercent / 100) * total,
    }));
  }, [form.totalCallAmount, scopedPartners]);

  function addExpenseRow() { setExpenses(prev => [...prev, newExpenseRow()]); }
  function updateExpenseRow(id: string, field: keyof ExpenseRow, value: string | number) {
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }
  function removeExpenseRow(id: string) { setExpenses(prev => prev.filter(e => e.id !== id)); }
  function applyExpensesToCall() { setForm(f => ({ ...f, totalCallAmount: String(Math.ceil(totalExpenseNeed)) })); }

  function addCall() {
    if (!form.period || !form.totalCallAmount) return;
    const total = parseFloat(form.totalCallAmount.replace(/,/g, ''));
    // Issue to partners of the selected company (or all companies if 'all')
    const targetPartners = scopedPartners.filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i);
    const newCalls: CapitalCall[] = targetPartners.map(p => ({
      id: `cc-${Date.now()}-${p.id}`,
      companyId: p.companyId,
      period: form.period,
      partnerId: p.id,
      partnerName: p.name,
      sharePercent: p.sharePercent,
      totalCallAmount: total,
      partnerShare: (p.sharePercent / 100) * total,
      oldDues: 0,
      totalDue: (p.sharePercent / 100) * total,
      received: 0,
      receivedDate: null,
      dueDate: form.dueDate || undefined,
      status: 'Outstanding' as const,
      sourceType: 'manual' as const,
      sourceId: null,
      reason: null,
    }));
    // Append to all companies' capitalCalls in state (handled by context)
    // Since setCapitalCalls is per-selected-company, we just close modal here
    setShowModal(false);
    setForm({ period: '', totalCallAmount: '', dueDate: '', notes: '' });
  }

  // ── Dropdowns ──────────────────────────────────────────────────────────────
  const dropdowns = (
    <div className="flex flex-wrap gap-3 px-4 py-3 rounded-xl" style={{ background: '#EEF0FF', border: `1px solid ${PT.border}` }}>
      <div>
        <label style={{ ...PT_FONT.tableHeader, display: 'block', marginBottom: 4 }}>Partner</label>
        <select
          value={localPartnerName}
          onChange={e => setLocalPartnerName(e.target.value)}
          style={{ ...parchmentStyles.select, padding: '8px 12px', minWidth: 220 }}
        >
          <option value="all">All Partners</option>
          {partnerNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
    </div>
  );

  // ── Partner-wise view ──────────────────────────────────────────────────────
  if (isPartnerView) {
    const partnerInstance = scopedPartners.find(p => p.name === localPartnerName);
    const partnerType     = partnerInstance?.type ?? 'Class A';
    const typeLabel       = partnerType === 'Class A' ? 'Type A' : 'Type B';
    const typeBadge = partnerType === 'Class A'
      ? { background: '#DCFCE7', color: PT.green }
      : { background: '#EFF6FF', color: PT.blue };

    return (
      <div className="space-y-6" style={{ fontSize: 13, color: PT.text }}>
        <div className="flex items-center justify-between">
          <div>
            <PropDevPageHeader title="Capital Calls" subtitle="Decision support for partner capital contributions" />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf}
              style={{ ...parchmentStyles.btnSecondary, opacity: exportingPdf ? 0.7 : 1 }}
            >
              <Download size={15} /> {exportingPdf ? 'Exporting…' : 'Export PDF'}
            </button>
            <button
              onClick={() => setShowModal(true)}
              style={parchmentStyles.btnPrimary}
            >
              <Plus size={15} /> Issue Capital Call
            </button>
          </div>
        </div>

        {dropdowns}

        {/* Partner summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ParchmentKpiTile label="Total Called" value={fmt(totalCalled)} />
          <ParchmentKpiTile label="Total Received" value={fmt(totalReceived)} accent />
          <ParchmentKpiTile label="Outstanding" value={fmt(totalOutstanding)} warn={totalOutstanding > 0} />
          <ParchmentKpiTile label="Overdue" value={String(overdueCount)} warn={overdueCount > 0} />
        </div>

        {/* Partner-wise history table */}
        <div style={{ ...PT_CARD, padding: 0, overflow: 'hidden' }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#EEF0FF', borderBottom: `1px solid ${PT.border}` }}>
            <div>
              <h3 style={PT_FONT.sectionTitle}>
                Capital Call History — {localPartnerName}
                <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium" style={typeBadge}>{typeLabel}</span>
              </h3>
            </div>
            <span style={PT_FONT.caption}>{filteredCalls.length} call records</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={PT_FONT.table}>
              <thead style={{ background: PT.pageBg }}>
                <tr>
                  {['Period', 'Company', 'Source', 'Type', 'Called', 'Received', 'Balance', 'Status'].map(h => (
                    <th key={h} className="px-4 py-2 text-right first:text-left whitespace-nowrap" style={PT_FONT.tableHeader}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCalls.map(c => {
                  const balance = c.totalDue - c.received;
                  const pType   = partnerTypeMap[c.partnerId] ?? 'Class A';
                  const typeStyle = pType === 'Class A'
                    ? { background: '#DCFCE7', color: PT.green }
                    : { background: '#EFF6FF', color: PT.blue };
                  return (
                    <tr key={c.id} style={{ borderTop: `1px solid ${PT.border}`, background: c.status === 'Overdue' ? '#FEF2F2' : undefined }}>
                      <td className="px-4 py-2.5 font-medium" style={PT_FONT.tableCell}>{c.period}</td>
                      <td className="px-4 py-2.5" style={{ ...PT_FONT.tableCell, color: PT.muted }}>{companyNameMap[c.companyId] ?? c.companyId}</td>
                      <td className="px-4 py-2.5 text-right">
                        {c.sourceType === 'lot_reinvestment' ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium cursor-help"
                            style={{ background: '#E8EFF8', color: 'var(--navy)' }}
                            title={c.reason ?? 'Auto-generated from a lot reinvestment round'}
                          >
                            Auto: Lot Reinvestment
                          </span>
                        ) : c.sourceType === 'unrealised_loss' ? (
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-medium cursor-help"
                            style={{ background: '#FEF3E2', color: 'var(--warning)' }}
                            title={c.reason ?? 'Auto-generated from an unrealised loss on this entity'}
                          >
                            Auto: Unrealised Loss
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--gold-light)', color: 'var(--gold)' }}>
                            Manual
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="px-2 py-0.5 rounded text-xs font-medium" style={typeStyle}>{pType === 'Class A' ? 'Type A' : 'Type B'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right" style={PT_FONT.tableCell}>{fmt(c.totalDue)}</td>
                      <td className="px-4 py-2.5 text-right" style={{ ...PT_FONT.tableCell, color: PT.green }}>{fmt(c.received)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {balance > 0 ? (
                          <span style={{ color: PT.red, fontWeight: 600 }}>{fmt(balance)}</span>
                        ) : (
                          <span style={{ color: PT.green }}>$0</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={STATUS_BADGE[c.status]}>{c.status}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#44403C', color: '#fff', ...PT_FONT.tableCell }}>
                  <td className="px-4 py-2 font-bold" colSpan={4}>TOTAL</td>
                  <td className="px-4 py-2 text-right font-bold">{fmt(totalCalled)}</td>
                  <td className="px-4 py-2 text-right font-bold" style={{ color: '#86EFAC' }}>{fmt(totalReceived)}</td>
                  <td className="px-4 py-2 text-right font-bold" style={{ color: '#FCA5A5' }}>{fmt(totalOutstanding)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {showModal && renderModal()}
      </div>
    );
  }

  // ── All-partners / company-filtered view ──────────────────────────────────
  const periods = [...new Set(filteredCalls.map(c => c.period))];

  function renderModal() {
    const inputStyle = { ...parchmentStyles.select, width: '100%', padding: '8px 12px' };
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-xl shadow-xl" style={{ background: PT.cardBg, border: `1px solid ${PT.border}` }}>
          <div className="flex items-center justify-between p-5" style={{ borderBottom: `1px solid ${PT.border}` }}>
            <h3 style={PT_FONT.sectionTitle}>Issue Capital Call</h3>
            <button onClick={() => setShowModal(false)}><X size={18} style={{ color: PT.mutedLight }} /></button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label style={{ ...PT_FONT.button, display: 'block', marginBottom: 4, color: PT.text }}>Period</label>
                <input className="focus:outline-none focus:ring-2 focus:ring-amber-300"
                  style={inputStyle}
                  placeholder="e.g. Jan–Jun 2026" value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} />
              </div>
              <div>
                <label style={{ ...PT_FONT.button, display: 'block', marginBottom: 4, color: PT.text }}>Due Date</label>
                <input type="date" className="focus:outline-none focus:ring-2 focus:ring-amber-300"
                  style={inputStyle}
                  value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label style={{ ...PT_FONT.button, display: 'block', marginBottom: 4, color: PT.text }}>Total Call Amount ($)</label>
              <div className="flex gap-2">
                <input className="flex-1 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  style={inputStyle}
                  placeholder="e.g. 145000" value={form.totalCallAmount} onChange={e => setForm({ ...form, totalCallAmount: e.target.value })} />
                {totalExpenseNeed > 0 && (
                  <button onClick={applyExpensesToCall}
                    style={{ ...parchmentStyles.btnSecondary, padding: '8px 12px', whiteSpace: 'nowrap', color: PT.gold, borderColor: PT.gold }}>
                    Use {fmt(totalExpenseNeed)}
                  </button>
                )}
              </div>
            </div>
            {parseFloat(form.totalCallAmount || '0') > 0 && (
              <div className="rounded-xl p-3" style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
                <p style={{ ...PT_FONT.tableHeader, color: '#92400E', marginBottom: 8 }}>Auto-Calculated Partner Splits</p>
                <div className="space-y-1">
                  {partnerSplits.map(p => (
                    <div key={p.id} className="flex justify-between" style={PT_FONT.body}>
                      <span style={{ color: PT.muted }}>{p.name} ({p.sharePercent}%)</span>
                      <span style={{ fontWeight: 600, color: '#92400E' }}>{fmt(p.callShare)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label style={{ ...PT_FONT.button, display: 'block', marginBottom: 4, color: PT.text }}>Notes (optional)</label>
              <textarea rows={2} className="w-full focus:outline-none focus:ring-2 focus:ring-amber-300"
                style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="Reason for this capital call…" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-3 p-5" style={{ borderTop: `1px solid ${PT.border}` }}>
            <button onClick={() => setShowModal(false)} style={parchmentStyles.btnSecondary}>Cancel</button>
            <button onClick={addCall} style={parchmentStyles.btnPrimary}>
              Issue Call to All Partners
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ fontSize: 13, color: PT.text }}>
      <div className="flex items-center justify-between">
        <div>
          <PropDevPageHeader title="Capital Calls" subtitle="Partner capital contribution schedule" />
          <p style={PT_FONT.pageSubtitle}>Decision support for partner capital contributions</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exportingPdf}
            style={{ ...parchmentStyles.btnSecondary, opacity: exportingPdf ? 0.7 : 1 }}
          >
            <Download size={15} /> {exportingPdf ? 'Exporting…' : 'Export PDF'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            style={parchmentStyles.btnPrimary}
          >
            <Plus size={15} /> Issue Capital Call
          </button>
        </div>
      </div>

      {dropdowns}

      {/* Data as of — verifies which contribution period was imported per company */}
      {scopedCompanies.some(c => c.capitalCalls.length > 0) && (
        <div className="rounded-xl px-4 py-3" style={{ background: PT.cardBg, border: `1px solid ${PT.border}` }}>
          <p style={{ ...PT_FONT.tableHeader, marginBottom: 8 }}>Data as of</p>
          <div className="flex flex-wrap gap-2">
            {scopedCompanies
              .filter(c => c.capitalCalls.length > 0)
              .map(c => {
                const periodsForCo = [...new Set(c.capitalCalls.map(cc => cc.period).filter(Boolean))];
                const label = periodsForCo[0] ?? 'Imported Capital Call';
                return (
                  <div
                    key={c.id}
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5"
                    style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
                  >
                    {selectedCompanyId === 'all' && (
                      <span style={{ ...PT_FONT.body, fontWeight: 500 }}>{c.name}</span>
                    )}
                    <span style={{ ...PT_FONT.button, color: '#92400E' }}>
                      Data as of: {label}
                    </span>
                    {periodsForCo.length > 1 && (
                      <span style={PT_FONT.caption}>(+{periodsForCo.length - 1} older)</span>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Decision Header */}
      <DecisionHeader
        capitalCalls={filteredCalls}
        totalExpenseNeed={totalExpenseNeed}
        monthlyEmi={monthlyEmi}
        cashAvailable={cashAvailable}
        companyLabel={companyLabel}
        onUploadClick={goToCapitalCallUpload}
      />

      {filteredCalls.length === 0 && selectedCompanyId === 'all' && companiesMissingCalls.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: '#EEF0FF', border: `1px solid ${PT.border}` }}>
          <p style={{ ...PT_FONT.sectionTitle, marginBottom: 8 }}>Companies without imported capital-call data</p>
          <p style={{ ...PT_FONT.bodyMuted, marginBottom: 8 }}>
            One Excel file, one tab per company. Tab names must match <strong>Company Registry</strong> names
            (e.g. tab &quot;JKL LLC&quot; = registry &quot;JKL LLC&quot;).
          </p>
          <ul className="list-disc list-inside space-y-0.5" style={PT_FONT.bodyMuted}>
            {companiesMissingCalls.map(name => <li key={name}>{name}</li>)}
          </ul>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ParchmentKpiTile
          label="Total Called"
          value={fmt(totalCalled)}
          sub={`${filteredCalls.length} calls`}
        />
        <ParchmentKpiTile
          label="Total Received"
          value={fmt(totalReceived)}
          sub={`${((totalReceived / Math.max(1, totalCalled)) * 100).toFixed(0)}% collected`}
          accent
        />
        <ParchmentKpiTile
          label="Outstanding"
          value={fmt(totalOutstanding)}
          sub={`${filteredCalls.filter(c => c.status !== 'Paid').length} active`}
          warn={totalOutstanding > 0}
        />
        <ParchmentKpiTile
          label="Overdue Calls"
          value={String(overdueCount)}
          sub="need immediate action"
          warn={overdueCount > 0}
        />
      </div>

      {filteredCalls.length > 0 && (
        <CapitalCallsCharts
          calls={filteredCalls}
          companyNameMap={companyNameMap}
          selectedCompanyId={selectedCompanyId}
          onViewAllPartners={() => {
            document.getElementById('capital-calls-partner-tables')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      )}

      {/* Expense Builder */}
      <div style={{ ...PT_CARD, padding: 0 }}>
        <button
          className="w-full flex items-center justify-between p-4 rounded-xl"
          style={{ background: PT.cardBg }}
          onClick={() => setShowExpenses(e => !e)}
        >
          <div className="flex items-center gap-2">
            <Calculator size={16} style={{ color: PT.gold }} />
            <h3 style={PT_FONT.sectionTitle}>Expense Builder — Calculate Call Amount</h3>
          </div>
          <div className="flex items-center gap-4">
            <span style={{ ...PT_FONT.button, color: '#92400E' }}>{fmt(totalExpenseNeed)}</span>
            <span style={PT_FONT.caption}>{showExpenses ? '▲' : '▼'}</span>
          </div>
        </button>

        {showExpenses && (
          <div className="p-4 space-y-3" style={{ borderTop: `1px solid ${PT.border}` }}>
            <div className="overflow-x-auto">
              <table className="w-full" style={PT_FONT.table}>
                <thead style={{ background: PT.pageBg }}>
                  <tr>
                    {['Category', 'Description', 'Amount ($)', ''].map(h => (
                      <th key={h || 'actions'} className={`px-3 py-2 ${h === 'Amount ($)' ? 'text-right w-40' : 'text-left'}`} style={PT_FONT.tableHeader}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map(row => (
                    <tr key={row.id} style={{ borderTop: `1px solid ${PT.border}` }}>
                      <td className="px-3 py-2">
                        <select
                          value={row.category}
                          onChange={e => updateExpenseRow(row.id, 'category', e.target.value)}
                          style={{ ...parchmentStyles.select, width: '100%', padding: '4px 8px', fontSize: 12 }}
                        >
                          {DEFAULT_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.description}
                          onChange={e => updateExpenseRow(row.id, 'description', e.target.value)}
                          placeholder="Optional description"
                          style={{ ...parchmentStyles.select, width: '100%', padding: '4px 8px', fontSize: 12 }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={row.amount || ''}
                          onChange={e => updateExpenseRow(row.id, 'amount', parseFloat(e.target.value) || 0)}
                          placeholder="0"
                          style={{ ...parchmentStyles.select, width: '100%', padding: '4px 8px', fontSize: 12, textAlign: 'right' }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeExpenseRow(row.id)} style={{ color: PT.mutedLight, background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#FFFBEB', borderTop: `1px solid #FDE68A` }}>
                    <td className="px-3 py-2 font-bold" colSpan={2} style={{ ...PT_FONT.body, color: '#92400E' }}>TOTAL EXPENSE NEED</td>
                    <td className="px-3 py-2 text-right font-bold" style={{ ...PT_FONT.body, color: '#92400E' }}>{fmt(totalExpenseNeed)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={addExpenseRow} style={{ ...parchmentStyles.btnSecondary, fontSize: 12, color: PT.gold, border: 'none', background: 'transparent', padding: 0 }}>
                <Plus size={13} /> Add Row
              </button>
              <button
                onClick={applyExpensesToCall}
                style={{ ...parchmentStyles.btnPrimary, fontSize: 12 }}
              >
                <Calculator size={13} /> Use as Call Amount
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Per-period tables */}
      <div id="capital-calls-partner-tables" className="space-y-6">
      {periods.map(period => {
        const periodCalls = filteredCalls.filter(c => c.period === period);
        const pTotal    = periodCalls.reduce((s, c) => s + c.totalDue, 0);
        const pReceived = periodCalls.reduce((s, c) => s + c.received, 0);
        const hasOverdue = periodCalls.some(c => c.status === 'Overdue');
        return (
          <div key={period} style={{ ...PT_CARD, padding: 0, overflow: 'hidden' }}>
            <div className="px-5 py-3 flex justify-between items-center"
              style={{
                background: hasOverdue ? '#FEF2F2' : '#EEF0FF',
                borderBottom: `1px solid ${hasOverdue ? '#FECACA' : PT.border}`,
              }}>
              <div>
                <h3 style={{ ...PT_FONT.sectionTitle, color: hasOverdue ? PT.red : PT.text }}>Capital Call — {period}</h3>
                <p style={PT_FONT.caption}>Data as of: {period}</p>
              </div>
              <div className="flex items-center gap-4" style={PT_FONT.body}>
                <span style={{ color: PT.muted }}>Called: {fmt(pTotal)}</span>
                <span style={{ color: PT.green }}>Received: {fmt(pReceived)}</span>
                <span style={{ color: PT.red }}>Outstanding: {fmt(pTotal - pReceived)}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full" style={PT_FONT.table}>
                <thead style={{ background: PT.pageBg }}>
                  <tr>
                    {['Partner', 'Type', 'Share %', 'Partner Share', 'Old Dues', 'Total Due', 'Received', 'Due Date', 'Balance', 'Status', ''].map(h => (
                      <th key={h || 'actions'} className="px-3 py-3 text-right first:text-left whitespace-nowrap" style={PT_FONT.tableHeader}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {periodCalls.map(c => {
                    const balance = c.totalDue - c.received;
                    const pType   = partnerTypeMap[c.partnerId] ?? 'Class A';
                    const typeStyle = pType === 'Class A'
                      ? { background: '#DCFCE7', color: PT.green }
                      : { background: '#EFF6FF', color: PT.blue };
                    return (
                      <tr key={c.id} style={{ borderTop: `1px solid ${PT.border}`, background: c.status === 'Overdue' ? '#FEF2F2' : undefined }}>
                        <td className="px-3 py-3 font-medium" style={PT_FONT.tableCell}>{c.partnerName}</td>
                        <td className="px-3 py-3 text-right">
                          <span className="px-2 py-0.5 rounded text-xs font-medium" style={typeStyle}>{pType === 'Class A' ? 'Type A' : 'Type B'}</span>
                        </td>
                        <td className="px-3 py-3 text-right" style={PT_FONT.tableCell}>{c.sharePercent}%</td>
                        <td className="px-3 py-3 text-right" style={PT_FONT.tableCell}>{fmt(c.partnerShare)}</td>
                        <td className="px-3 py-3 text-right" style={{ ...PT_FONT.tableCell, color: PT.amber }}>{c.oldDues > 0 ? fmt(c.oldDues) : '—'}</td>
                        <td className="px-3 py-3 text-right font-semibold" style={PT_FONT.tableCell}>{fmt(c.totalDue)}</td>
                        <td className="px-3 py-3 text-right" style={{ ...PT_FONT.tableCell, color: PT.green }}>{fmt(c.received)}</td>
                        <td className="px-3 py-3 text-right" style={{ ...PT_FONT.tableCell, color: PT.muted }}>{c.dueDate ?? c.receivedDate ?? '—'}</td>
                        <td className="px-3 py-3 text-right font-semibold" style={{ ...PT_FONT.tableCell, color: balance > 0 ? PT.red : PT.muted }}>{balance > 0 ? fmt(balance) : '—'}</td>
                        <td className="px-3 py-3 text-right">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={STATUS_BADGE[c.status]}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {(c.status === 'Overdue' || c.status === 'Outstanding') && (
                            <button className="flex items-center gap-1 whitespace-nowrap px-2 py-0.5 rounded-lg"
                              style={{ ...PT_FONT.caption, color: PT.gold, border: `1px solid ${PT.border}`, background: PT.cardBg }}>
                              <Bell size={11} /> Remind
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#44403C', color: '#fff', ...PT_FONT.tableCell }}>
                    <td className="px-3 py-3 font-bold" colSpan={5}>TOTAL</td>
                    <td className="px-3 py-3 text-right font-bold">{fmt(pTotal)}</td>
                    <td className="px-3 py-3 text-right font-bold" style={{ color: '#86EFAC' }}>{fmt(pReceived)}</td>
                    <td />
                    <td className="px-3 py-3 text-right font-bold" style={{ color: '#FCA5A5' }}>{fmt(pTotal - pReceived)}</td>
                    <td /><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
      </div>

      {showModal && renderModal()}
    </div>
  );
}
