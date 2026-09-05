/**
 * Property Dev Entity Executive Summary — per-entity drill-in page.
 * Separate from the portfolio-wide PropDevExecutiveSummary.tsx. The former
 * standalone Entity Dashboard page now lives here as the first tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePropDev } from '../../contexts/PropertyDevContext';
import { fetchPropDevFinancialsPool } from '../../utils/fetchPropDevFinancialsPool';
import type { PDFinancialsLike } from '../../utils/propDevCfoTrendData';
import { propDevCompanyOverviewKpis, type PropDevCompanyOverviewKpis } from '../../utils/propDevCompanyOverview';
import { resolveAllPropDevLoans } from '../../utils/propDevLoanMetrics';
import { buildPropDevBoardExportPayload, type PropDevBoardExportPayload } from '../../utils/gatherPropDevBoardExportData';
import { enrichPropDevFinWithCf } from '../../utils/propDevYearlyFinancials';
import { PT, PT_FONT } from '../../utils/parchmentTypography';
import PDDailyPulseTab from '../../components/propdev/execSummary/PDDailyPulseTab';
import PDEntityPropertiesTab from '../../components/propdev/execSummary/PDEntityPropertiesTab';
import PDOwnershipTab from '../../components/propdev/execSummary/PDOwnershipTab';
import PDActionPlanTab from '../../components/propdev/execSummary/PDActionPlanTab';
import PDEntityOverviewTab from '../../components/propdev/execSummary/PDEntityOverviewTab';
import PDEntityFinancialsTab from '../../components/propdev/execSummary/PDEntityFinancialsTab';
import PDConstructionPerformanceTab from '../../components/propdev/execSummary/PDConstructionPerformanceTab';
import PDEntityLoansTab from '../../components/propdev/execSummary/PDEntityLoansTab';
import PDEntityDashboardTab from '../../components/propdev/execSummary/PDEntityDashboardTab';
import '../../theme/execSummaryPremium.css';

type ExecTab = 'entity-dashboard' | 'daily-pulse' | 'properties' | 'overview' | 'financials' | 'construction-performance' | 'loans' | 'ownership' | 'action-plan';

const EXEC_TABS: { id: ExecTab; label: string }[] = [
  { id: 'entity-dashboard', label: 'Entity Dashboard' },
  { id: 'daily-pulse', label: 'Daily Pulse' },
  { id: 'properties', label: 'Properties' },
  { id: 'overview', label: 'Overview' },
  { id: 'financials', label: 'Financials' },
  { id: 'construction-performance', label: 'Construction Performance' },
  { id: 'loans', label: 'Loans' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'action-plan', label: 'Action Plan' },
];

export default function PDEntityExecutiveSummary() {
  const { companies, loans, selectedCompanyId, setSelectedCompanyId, ensureCompanyYearly } = usePropDev();
  const [activeTab, setActiveTab] = useState<ExecTab>('entity-dashboard');
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

  const activeCompanyId = selectedCompanyId !== 'all' && companies.some(c => c.id === selectedCompanyId)
    ? selectedCompanyId
    : (companies[0]?.id ?? '');
  const company = companies.find(c => c.id === activeCompanyId);

  const allLoans = useMemo(() => resolveAllPropDevLoans(companies, loans), [companies, loans]);
  const entityLoans = useMemo(() => allLoans.filter(l => l.companyId === activeCompanyId), [allLoans, activeCompanyId]);

  const kpisById = useMemo(() => {
    void yearlyReady;
    const map: Record<string, PropDevCompanyOverviewKpis> = {};
    for (const c of companies) map[c.id] = propDevCompanyOverviewKpis(c, uploadedFin[c.id] ?? null, allLoans);
    return map;
  }, [companies, uploadedFin, yearlyReady, allLoans]);

  const loading = companies.length > 0 && Object.keys(uploadedFin).length === 0 && yearlyReady === 0;

  const financialsPayload: PropDevBoardExportPayload | null = useMemo(() => {
    const fin = uploadedFin[activeCompanyId];
    if (!fin || !company || (!fin.pl?.length && !fin.bs?.length)) return null;
    try {
      const enriched = enrichPropDevFinWithCf(fin, company);
      return buildPropDevBoardExportPayload(enriched, company, entityLoans, null, new Date().getFullYear(), 'YTD');
    } catch { return null; }
  }, [uploadedFin, activeCompanyId, company, entityLoans]);

  return (
    <div style={{ background: PT.pageBg, minHeight: '100vh', width: '100%', maxWidth: '100%', fontSize: 13, color: PT.text }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={PT_FONT.pageTitle}>Entity Executive Summary</h1>
          <p style={{ ...PT_FONT.pageSubtitle, margin: '6px 0 0' }}>{company?.name ?? 'Select an entity'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <select
            value={activeCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            style={{ ...PT_FONT.control, padding: '8px 12px', borderRadius: 8, border: `1px solid ${PT.border}`, background: PT.cardBg, minWidth: 220 }}
          >
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {!companies.length ? (
        <p style={PT_FONT.bodyMuted}>No companies yet — add one under Companies.</p>
      ) : !company ? (
        <p style={PT_FONT.bodyMuted}>Select an entity above.</p>
      ) : (
        <>
          <div className="esp-scope esp-tabbar">
            {EXEC_TABS.map(t => (
              <button key={t.id} type="button" className={`esp-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="esp-fade-in" key={activeTab}>
            {activeTab === 'entity-dashboard' && (
              <PDEntityDashboardTab company={company} kpis={kpisById[company.id]} loans={entityLoans} payload={financialsPayload} />
            )}
            {activeTab === 'daily-pulse' && (
              <PDDailyPulseTab companies={[company]} allLoans={entityLoans} kpisById={kpisById} loading={loading} />
            )}
            {activeTab === 'properties' && (
              <PDEntityPropertiesTab company={company} kpis={kpisById[company.id]} loans={entityLoans} />
            )}
            {activeTab === 'overview' && (
              <PDEntityOverviewTab company={company} kpis={kpisById[company.id]} loans={entityLoans} payload={financialsPayload} />
            )}
            {activeTab === 'financials' && (
              <PDEntityFinancialsTab company={company} payload={financialsPayload} allLoans={entityLoans} />
            )}
            {activeTab === 'construction-performance' && (
              <PDConstructionPerformanceTab company={company} kpis={kpisById[company.id]} />
            )}
            {activeTab === 'loans' && (
              <PDEntityLoansTab company={company} kpis={kpisById[company.id]} loans={entityLoans} />
            )}
            {activeTab === 'ownership' && (
              <PDOwnershipTab companies={[company]} allLoans={entityLoans} kpisById={kpisById} loading={loading} />
            )}
            {activeTab === 'action-plan' && (
              <PDActionPlanTab companies={[company]} allLoans={entityLoans} kpisById={kpisById} loading={loading} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
