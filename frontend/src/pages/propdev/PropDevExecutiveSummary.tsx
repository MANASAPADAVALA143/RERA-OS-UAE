/**
 * Property Dev Executive Summary — 7-tab page (Daily Pulse, Portfolio Overview,
 * Ownership, Deal P&L, Balance Sheet, Cash Flow, Action Plan).
 * Replaces the old single-page per-company band summary.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import api from '../../services/api';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import { propDevCompanyOverviewKpis, type PropDevCompanyOverviewKpis } from '../../utils/propDevCompanyOverview';
import { resolveAllPropDevLoans } from '../../utils/propDevLoanMetrics';
import { propDevPeriodAnchor } from '../../utils/propDevPeriodKpis';
import { scopePropDevFinToPeriod } from '../../utils/propDevPeriodScope';
import { buildPropDevBoardExportPayload } from '../../utils/gatherPropDevBoardExportData';
import { enrichPropDevFinWithCf } from '../../utils/propDevYearlyFinancials';
import { exportPropDevExecSummaryBoardPackPdf } from '../../utils/propDevSectionPdfExport';
import { PT, PT_FONT } from '../../utils/parchmentTypography';
import PDDailyPulseTab from '../../components/propdev/execSummary/PDDailyPulseTab';
import PDPortfolioOverviewTab from '../../components/propdev/execSummary/PDPortfolioOverviewTab';
import PDOwnershipTab from '../../components/propdev/execSummary/PDOwnershipTab';
import PDCapitalCallTrackerTab from '../../components/propdev/execSummary/PDCapitalCallTrackerTab';
import PDUnrealisedGlTab from '../../components/propdev/execSummary/PDUnrealisedGlTab';
import PDComingNextTab from '../../components/propdev/execSummary/PDComingNextTab';
import PDDealPLTab from '../../components/propdev/execSummary/PDDealPLTab';
import PDAcquisitionFlowTab from '../../components/propdev/execSummary/PDAcquisitionFlowTab';
import PDPartnerRoiTab from '../../components/propdev/execSummary/PDPartnerRoiTab';
import PDCarryingCostsTrackerTab from '../../components/propdev/execSummary/PDCarryingCostsTrackerTab';
import PDCapitalStructureTab from '../../components/propdev/execSummary/PDCapitalStructureTab';
import PDCapitalLifecycleTab from '../../components/propdev/execSummary/PDCapitalLifecycleTab';
import PDBalanceSheetTab from '../../components/propdev/execSummary/PDBalanceSheetTab';
import PDCashFlowTab from '../../components/propdev/execSummary/PDCashFlowTab';
import PDActionPlanTab from '../../components/propdev/execSummary/PDActionPlanTab';
import '../../theme/execSummaryPremium.css';

type ExecTab = 'daily-pulse' | 'portfolio-overview' | 'ownership' | 'capital-call-tracker' | 'unrealised-gl' | 'deal-pl' | 'acquisition-flow' | 'partner-roi' | 'carrying-costs-tracker' | 'capital-structure' | 'capital-lifecycle' | 'balance-sheet' | 'cash-flow' | 'action-plan';

const ENTITY_SCOPED_TABS: ExecTab[] = ['deal-pl', 'acquisition-flow', 'partner-roi', 'carrying-costs-tracker', 'capital-structure', 'capital-lifecycle', 'balance-sheet', 'cash-flow'];

const EXEC_TABS: { id: ExecTab; label: string }[] = [
  { id: 'daily-pulse', label: 'Daily Pulse' },
  { id: 'portfolio-overview', label: 'Portfolio Overview' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'capital-call-tracker', label: 'Capital Call Tracker' },
  { id: 'unrealised-gl', label: 'Unrealised G/L' },
  { id: 'deal-pl', label: 'Deal P&L' },
  { id: 'acquisition-flow', label: 'Acquisition Flow' },
  { id: 'partner-roi', label: 'Partner ROI' },
  { id: 'carrying-costs-tracker', label: 'Carrying Costs Tracker' },
  { id: 'capital-structure', label: 'Capital Structure' },
  { id: 'capital-lifecycle', label: 'Capital Lifecycle' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'action-plan', label: 'Action Plan' },
];

export default function PropDevExecutiveSummary() {
  const { companies, loans, ensureCompanyYearly, refetchCompanies, financialYear, financialPeriod, financialMonth } = usePropDev();
  const [activeTab, setActiveTab] = useState<ExecTab>('daily-pulse');
  const [uploadedFin, setUploadedFin] = useState<Record<string, PDFinancialsLike>>({});
  const [yearlyReady, setYearlyReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all(companies.map(c => ensureCompanyYearly(c.id)));
      if (!cancelled) setYearlyReady(n => n + 1);
    })();
    return () => { cancelled = true; };
  }, [companies, ensureCompanyYearly]);

  useEffect(() => {
    if (!companies.length) return;
    let cancelled = false;
    fetchPropDevFinancialsPool(
      companies.map(c => c.id),
      (_id, d) => ({
        years: d.years ?? [],
        pl: (d.pl ?? []) as PDFinancialsLike['pl'],
        bs: (d.bs ?? []) as PDFinancialsLike['bs'],
        cf: (d.cf ?? []) as PDFinancialsLike['cf'],
      }),
      { onItem: (id, item) => { if (!cancelled) setUploadedFin(prev => ({ ...prev, [id]: item })); } },
    ).then(merged => { if (!cancelled) setUploadedFin(prev => ({ ...prev, ...merged })); });
    return () => { cancelled = true; };
  }, [companies]);

  const allLoans = useMemo(() => resolveAllPropDevLoans(companies, loans), [companies, loans]);

  const kpisById = useMemo(() => {
    void yearlyReady;
    // Rewrite values[year] from monthlyValues for the selected Month/YTD window (same
    // scopePropDevFinToPeriod used by Financials' CFO Dashboard) -- otherwise entities
    // with real monthly B/S columns still show the full-year figure regardless of which
    // month is picked in the top-bar toggle.
    const periodAnchor = propDevPeriodAnchor(financialPeriod, financialMonth, financialYear);
    const map: Record<string, PropDevCompanyOverviewKpis> = {};
    for (const c of companies) {
      const cFin = uploadedFin[c.id] ?? null;
      const scopedCFin = cFin ? scopePropDevFinToPeriod(cFin, periodAnchor) : cFin;
      map[c.id] = propDevCompanyOverviewKpis(c, scopedCFin, allLoans, financialYear);
    }
    return map;
  }, [companies, uploadedFin, yearlyReady, allLoans, financialYear, financialPeriod, financialMonth]);

  const loading = companies.length > 0 && Object.keys(uploadedFin).length === 0 && yearlyReady === 0;

  // Deal P&L / Balance Sheet / Cash Flow are inherently per-entity statements —
  // give them their own entity selector (Daily Pulse / Portfolio Overview / Ownership stay portfolio-wide).
  const [financialsCompanyId, setFinancialsCompanyId] = useState<string>('');
  const activeFinancialsId = financialsCompanyId && companies.some(c => c.id === financialsCompanyId)
    ? financialsCompanyId
    : (companies[0]?.id ?? '');
  const financialsCompany = companies.find(c => c.id === activeFinancialsId);

  const [detailFin, setDetailFin] = useState<PDFinancialsLike | null>(null);
  useEffect(() => {
    if (!activeFinancialsId) { setDetailFin(null); return; }
    let cancelled = false;
    api.get<{ company_name: string; years: number[]; pl: PDFinancialsLike['pl']; bs: PDFinancialsLike['bs']; cf?: PDFinancialsLike['cf'] }>(
      `/api/propdev/financials/${activeFinancialsId}`,
    ).then(res => {
      if (cancelled) return;
      if (!res.data?.pl?.length && !res.data?.bs?.length) { setDetailFin(null); return; }
      setDetailFin({ companyName: res.data.company_name, years: res.data.years, pl: res.data.pl, bs: res.data.bs, cf: res.data.cf });
    }).catch(() => { if (!cancelled) setDetailFin(null); });
    return () => { cancelled = true; };
  }, [activeFinancialsId]);

  const financialsPayload = useMemo(() => {
    if (!detailFin || !financialsCompany) return null;
    try {
      const enriched = enrichPropDevFinWithCf(detailFin, financialsCompany);
      return buildPropDevBoardExportPayload(enriched, financialsCompany, allLoans, null, new Date().getFullYear(), 'YTD');
    } catch { return null; }
  }, [detailFin, financialsCompany, allLoans]);

  const [exportingPdf, setExportingPdf] = useState(false);

  async function handleExportBoardPack() {
    if (!financialsCompany || !financialsPayload) return;
    setExportingPdf(true);
    try {
      await exportPropDevExecSummaryBoardPackPdf({
        company: financialsCompany,
        kpis: kpisById[financialsCompany.id],
        payload: financialsPayload,
        allLoans,
        periodLabel: `FY ${new Date().getFullYear()}`,
      });
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div style={{ background: PT.pageBg, minHeight: '100vh', width: '100%', maxWidth: '100%', fontSize: 13, color: PT.text }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={PT_FONT.pageTitle}>Executive Summary</h1>
          <p style={{ ...PT_FONT.pageSubtitle, margin: '6px 0 0' }}>
            Development portfolio · {companies.length} entit{companies.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {ENTITY_SCOPED_TABS.includes(activeTab) && (
            <select
              value={activeFinancialsId}
              onChange={e => setFinancialsCompanyId(e.target.value)}
              style={{ ...PT_FONT.control, padding: '8px 12px', borderRadius: 8, border: `1px solid ${PT.border}`, background: PT.cardBg, minWidth: 220 }}
            >
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={handleExportBoardPack}
            disabled={!financialsCompany || !financialsPayload || exportingPdf}
            className="esp-scope"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: '#5B5FEF', color: '#1A1D29', fontWeight: 700,
              border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13,
              cursor: (!financialsCompany || !financialsPayload || exportingPdf) ? 'not-allowed' : 'pointer',
              opacity: (!financialsCompany || !financialsPayload) ? 0.5 : 1,
              fontFamily: 'inherit',
            }}
            title={!financialsPayload ? 'Upload financials for this entity to enable export' : undefined}
          >
            <Download size={14} />
            {exportingPdf ? 'Generating…' : 'Export Board Pack'}
          </button>
        </div>
      </div>

      {exportingPdf && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(11,29,51,0.75)', zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 600,
        }}>
          Generating board pack…
        </div>
      )}

      {!companies.length ? (
        <p style={PT_FONT.bodyMuted}>No companies yet — add one under Companies to see the Executive Summary.</p>
      ) : (
        <>
          <div className="esp-scope esp-tabbar">
            {EXEC_TABS.map(t => (
              <button
                key={t.id}
                type="button"
                className={`esp-tab${activeTab === t.id ? ' active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="esp-fade-in" key={activeTab}>
            {activeTab === 'daily-pulse' && (
              <PDDailyPulseTab companies={companies} allLoans={allLoans} kpisById={kpisById} loading={loading} />
            )}
            {activeTab === 'portfolio-overview' && (
              <PDPortfolioOverviewTab companies={companies} allLoans={allLoans} kpisById={kpisById} loading={loading} />
            )}
            {activeTab === 'ownership' && (
              <PDOwnershipTab companies={companies} allLoans={allLoans} kpisById={kpisById} loading={loading} />
            )}
            {activeTab === 'capital-call-tracker' && (
              <PDCapitalCallTrackerTab companies={companies} loading={loading} />
            )}
            {activeTab === 'unrealised-gl' && (
              <PDUnrealisedGlTab companies={companies} kpisById={kpisById} loading={loading} />
            )}
            {activeTab === 'deal-pl' && (
              <PDDealPLTab company={financialsCompany} payload={financialsPayload} />
            )}
            {activeTab === 'acquisition-flow' && (
              <PDAcquisitionFlowTab company={financialsCompany} kpis={financialsCompany ? kpisById[financialsCompany.id] : undefined} />
            )}
            {activeTab === 'partner-roi' && (
              <PDPartnerRoiTab company={financialsCompany} payload={financialsPayload} />
            )}
            {activeTab === 'carrying-costs-tracker' && (
              <PDCarryingCostsTrackerTab
                company={financialsCompany}
                pl={detailFin?.pl}
                costBasis={financialsCompany ? kpisById[financialsCompany.id]?.costBasis : undefined}
                companies={companies}
              />
            )}
            {activeTab === 'capital-structure' && (
              <PDCapitalStructureTab companies={companies} kpisById={kpisById} loading={loading} refetchCompanies={refetchCompanies} sharedCompanyId={activeFinancialsId} />
            )}
            {activeTab === 'capital-lifecycle' && (
              <PDCapitalLifecycleTab
                company={financialsCompany}
                kpis={financialsCompany ? kpisById[financialsCompany.id] : undefined}
                pl={detailFin?.pl}
              />
            )}
            {activeTab === 'balance-sheet' && (
              <PDBalanceSheetTab company={financialsCompany} payload={financialsPayload} />
            )}
            {activeTab === 'cash-flow' && (
              <PDCashFlowTab company={financialsCompany} payload={financialsPayload} allLoans={allLoans} />
            )}
            {activeTab === 'action-plan' && (
              <PDActionPlanTab companies={companies} allLoans={allLoans} kpisById={kpisById} loading={loading} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
