import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import PeriodToggle from '../components/shared/PeriodToggle';
import ExecSummaryExportModal from '../components/rental/ExecSummaryExportModal';
import ExecutiveSummarySixBands from '../components/rental/ExecutiveSummarySixBands';
import {
  IncomeStatementTab,
  BalanceSheetTab,
  CashFlowTab,
  ActionPlanTab,
} from '../components/rental/ExecutiveSummaryDetailTabs';
import { type Period, periodChipText, getPeriodKeys } from '../utils/periodWindow';
import { resolveRegistryMonthKey, registryKeyToMonthYm } from '../utils/executiveSummaryRegistry';
import { useRentalCfoData } from '../hooks/useRentalCfoData';
import { useExecutiveSummaryKpis } from '../hooks/useExecutiveSummaryKpis';
import { useExecutiveSummaryData } from '../hooks/useExecutiveSummaryData';
import { mergeFinRows } from '../utils/executiveSummaryFinRows';

const P = {
  pageBg: '#F7F1E6', cardBg: '#FBF6EE', border: '#E8DEC8',
  gold: '#D4AF37', text: '#1C1917', muted: '#78716C',
} as const;

const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TABS = [
  { id: 'overview', label: 'Executive Overview' },
  { id: 'income', label: 'Income Statement' },
  { id: 'balance', label: 'Balance Sheet' },
  { id: 'cashflow', label: 'Cash Flow' },
  { id: 'actions', label: 'Action Plan' },
] as const;

type TabId = typeof TABS[number]['id'];

function monthSortKey(m: string): number {
  const [mon, yr] = m.split(/[\s-]/);
  return (Number(yr) || 0) * 100 + (MNAMES.indexOf(mon) + 1);
}

export default function RentalExecutiveSummary() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [period, setPeriod] = useState<Period | null>('MoM');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [entityId, setEntityId] = useState<string>('portfolio');
  const [showExportModal, setShowExportModal] = useState(false);

  const monthYm = `${year}-${String(month).padStart(2, '0')}`;
  const [registryMonthYm, setRegistryMonthYm] = useState(monthYm);
  const { companies, loans, portfolio, units, loading: cfoLoading } = useRentalCfoData(registryMonthYm);

  useEffect(() => {
    const key = resolveRegistryMonthKey(month, year, companies);
    const ym = key ? registryKeyToMonthYm(key) : monthYm;
    if (ym && ym !== registryMonthYm) setRegistryMonthYm(ym);
  }, [companies, month, year, monthYm, registryMonthYm]);
  const { arSummary, arMonths, ownership, qbArAging, qbApAging, hasApAging, loading: arLoading, hasOwnership, hasAr, availableArMonths } =
    useExecutiveSummaryData(monthYm);

  const arCollectionRate = useMemo(() => {
    const keys = period ? new Set(getPeriodKeys(period, month, year)) : null;
    const rows = keys ? arMonths.filter(d => keys.has(d.month)) : arMonths;
    const totalB = rows.reduce((s, r) => s + r.billed, 0);
    const totalC = rows.reduce((s, r) => s + r.collected, 0);
    return totalB > 0 ? (totalC / totalB) * 100 : (arSummary?.portfolio?.collection_rate ?? 0);
  }, [arMonths, arSummary, period, month, year]);

  const {
    kpiView, kpiSets, loanSchedule, overview, activeFins, registryOps, availableKeys: finAvailableKeys, loading: finLoading,
  } = useExecutiveSummaryKpis(companies, portfolio, loans, units, entityId, period, month, year, arCollectionRate);

  const scopedLoans = useMemo(() => {
    if (entityId === 'portfolio') return loans;
    const co = companies.find(c => c.id === entityId);
    if (!co) return [];
    return loans.filter(l => l.company_name === co.company_name);
  }, [loans, companies, entityId]);

  const [finRows, setFinRows] = useState<ReturnType<typeof mergeFinRows>>([]);
  useEffect(() => { setFinRows(mergeFinRows(activeFins)); }, [activeFins]);

  const availableKeys = useMemo(() => {
    const keys = new Set<string>([...finAvailableKeys, ...arMonths.map(d => d.month), ...availableArMonths]);
    return [...keys].sort((a, b) => monthSortKey(a) - monthSortKey(b));
  }, [finAvailableKeys, arMonths, availableArMonths]);

  const filteredAr = useMemo(() => {
    if (!period) return arMonths;
    const keys = new Set(getPeriodKeys(period, month, year));
    return arMonths.filter(d => keys.has(d.month));
  }, [arMonths, period, month, year]);

  const filteredFin = useMemo(() => {
    if (!period) return finRows;
    const keys = new Set(getPeriodKeys(period, month, year));
    return finRows.filter(r => keys.has(r.month));
  }, [finRows, period, month, year]);

  const latestFinMonth = useMemo(() => {
    if (!finAvailableKeys.length) return null;
    return [...finAvailableKeys].sort((a, b) => monthSortKey(a) - monthSortKey(b)).pop() ?? null;
  }, [finAvailableKeys]);

  const periodInit = useRef(false);
  useEffect(() => {
    if (periodInit.current || !finAvailableKeys.length) return;
    const latest = latestFinMonth;
    if (!latest) return;
    const [mon, yr] = latest.split(' ');
    const m = MNAMES.indexOf(mon) + 1;
    const y = parseInt(yr, 10);
    if (m > 0 && !isNaN(y)) {
      setMonth(m);
      setYear(y);
      periodInit.current = true;
    }
  }, [finAvailableKeys, latestFinMonth]);

  const entityLabel = entityId === 'portfolio'
    ? 'All companies (portfolio)'
    : (companies.find(c => c.id === entityId)?.company_name ?? 'Entity');

  const periodLabel = period
    ? periodChipText(period, month, year)
    : (overview.periodLabel || `FY ${year}`);

  const handlePrint = useCallback(() => { window.print(); }, []);

  const loading = cfoLoading || finLoading || arLoading;

  return (
    <div style={{ background: P.pageBg, minHeight: '100vh' }}>
      <style>{`@media print { button { display: none !important; } }`}</style>

      {showExportModal && (
        <ExecSummaryExportModal
          companies={companies}
          portfolio={portfolio}
          loans={loans}
          units={units}
          arData={filteredAr}
          finRows={filteredFin}
          period={period}
          month={month}
          year={year}
          onClose={() => setShowExportModal(false)}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: P.text, margin: 0 }}>Executive Summary</h1>
          <p style={{ fontSize: 13, color: P.muted, margin: '6px 0 0' }}>
            {entityLabel} · {periodLabel}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <select
            value={entityId}
            onChange={e => setEntityId(e.target.value)}
            style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: `1px solid ${P.border}`, background: P.cardBg, minWidth: 200 }}
          >
            <option value="portfolio">All Companies (Portfolio)</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
          <PeriodToggle
            period={period}
            month={month}
            year={year}
            onChange={(p, m, y) => { setPeriod(p); setMonth(m); setYear(y); }}
            availableKeys={availableKeys}
          />
          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
              background: `linear-gradient(135deg, ${P.gold}, #B8860B)`, border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer' }}
          >
            <Download size={14} />
            Download PPT
          </button>
          <button
            type="button"
            onClick={handlePrint}
            style={{ padding: '7px 14px', background: P.cardBg, border: `1px solid ${P.border}`,
              borderRadius: 8, fontSize: 13, fontWeight: 600, color: P.text, cursor: 'pointer' }}
          >
            Export PDF
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 24,
        background: P.cardBg, border: `1px solid ${P.border}`, borderRadius: 10, padding: 4, width: 'fit-content', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '7px 20px', borderRadius: 7, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
              background: activeTab === t.id ? P.gold : 'transparent',
              color: activeTab === t.id ? P.text : P.muted,
              transition: 'all 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && activeTab === 'overview' && (
        <p style={{ fontSize: 13, color: P.muted, marginBottom: 16 }}>Loading portfolio, financials, and rent receivable data…</p>
      )}

      {activeTab === 'overview' && (
        <ExecutiveSummarySixBands
          overview={overview}
          kpiView={kpiView ? { k: kpiView.k, label: kpiView.label } : null}
          kpiSets={kpiSets}
          loanSchedule={loanSchedule}
          portfolio={portfolio}
          companies={companies}
          loans={scopedLoans}
          arSummary={arSummary}
          arMonths={arMonths}
          ownership={ownership}
          finRows={finRows}
          activeFins={activeFins}
          qbArAging={qbArAging}
          qbApAging={qbApAging}
          hasApAging={hasApAging}
          period={period}
          month={month}
          year={year}
          periodLabel={periodLabel}
          entityId={entityId}
          hasFinancials={overview.hasFinancials}
          hasOwnership={hasOwnership}
          hasAr={hasAr}
          latestFinMonth={latestFinMonth}
          registryOps={registryOps}
        />
      )}

      {activeTab === 'income' && (
        <IncomeStatementTab finRows={filteredFin} arData={filteredAr} />
      )}

      {activeTab === 'balance' && (
        <BalanceSheetTab loans={scopedLoans} arData={filteredAr} />
      )}

      {activeTab === 'cashflow' && (
        <CashFlowTab loans={scopedLoans} arData={filteredAr} finRows={filteredFin} />
      )}

      {activeTab === 'actions' && (
        <ActionPlanTab portfolio={portfolio} loans={scopedLoans} arData={filteredAr} units={units} />
      )}
    </div>
  );
}
