import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import PeriodToggle from '../components/shared/PeriodToggle';
import ExecSummaryExportModal from '../components/rental/ExecSummaryExportModal';
import ExecutiveSummarySixBands from '../components/rental/ExecutiveSummarySixBands';
import { type Period, periodChipText, getPeriodKeys } from '../utils/periodWindow';
import { useRentalCfoData } from '../hooks/useRentalCfoData';
import { useExecutiveSummaryKpis } from '../hooks/useExecutiveSummaryKpis';
import { useExecutiveSummaryData } from '../hooks/useExecutiveSummaryData';
import { mergeFinRows } from '../utils/executiveSummaryFinRows';

const P = {
  pageBg: '#F7F1E6', cardBg: '#FBF6EE', border: '#E8DEC8',
  gold: '#D4AF37', text: '#1C1917', muted: '#78716C',
} as const;

const MNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthSortKey(m: string): number {
  const [mon, yr] = m.split(/[\s-]/);
  return (Number(yr) || 0) * 100 + (MNAMES.indexOf(mon) + 1);
}

export default function RentalExecutiveSummary() {
  const [period, setPeriod] = useState<Period | null>('MoM');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [entityId, setEntityId] = useState<string>('portfolio');
  const [showExportModal, setShowExportModal] = useState(false);

  const monthYm = `${year}-${String(month).padStart(2, '0')}`;
  const { companies, loans, portfolio, units, loading: cfoLoading } = useRentalCfoData(monthYm);
  const { arSummary, arMonths, ownership, loading: arLoading, hasOwnership, hasAr, availableArMonths } =
    useExecutiveSummaryData(monthYm);

  const arCollectionRate = useMemo(() => {
    const keys = period ? new Set(getPeriodKeys(period, month, year)) : null;
    const rows = keys ? arMonths.filter(d => keys.has(d.month)) : arMonths;
    const totalB = rows.reduce((s, r) => s + r.billed, 0);
    const totalC = rows.reduce((s, r) => s + r.collected, 0);
    return totalB > 0 ? (totalC / totalB) * 100 : (arSummary?.portfolio?.collection_rate ?? 0);
  }, [arMonths, arSummary, period, month, year]);

  const {
    kpiView, kpiSets, loanSchedule, overview, activeFins, availableKeys: finAvailableKeys, loading: finLoading,
  } = useExecutiveSummaryKpis(companies, portfolio, loans, entityId, period, month, year, arCollectionRate);

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
    const keys = finAvailableKeys.length ? finAvailableKeys : availableKeys;
    if (!keys.length) return null;
    return [...keys].sort((a, b) => monthSortKey(a) - monthSortKey(b)).pop() ?? null;
  }, [finAvailableKeys, availableKeys]);

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
            CEO dashboard — 6 bands · {entityLabel} · {periodLabel}
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

      {loading && (
        <p style={{ fontSize: 13, color: P.muted, marginBottom: 16 }}>Loading portfolio, financials, and rent receivable data…</p>
      )}

      <ExecutiveSummarySixBands
        overview={overview}
        kpiView={kpiView ? { k: kpiView.k, label: kpiView.label } : null}
        kpiSets={kpiSets}
        loanSchedule={loanSchedule}
        portfolio={portfolio}
        companies={companies}
        loans={loans}
        arSummary={arSummary}
        arMonths={arMonths}
        ownership={ownership}
        finRows={finRows}
        period={period}
        month={month}
        year={year}
        periodLabel={periodLabel}
        entityId={entityId}
        hasFinancials={overview.hasFinancials}
        hasOwnership={hasOwnership}
        hasAr={hasAr}
        latestFinMonth={latestFinMonth}
      />
    </div>
  );
}
