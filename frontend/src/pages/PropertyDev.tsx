import { useState } from 'react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { PropertyDevProvider, usePropDev } from '../contexts/PropertyDevContext';
import { usePropDevNav } from '../contexts/PropDevNavContext';
import PropDevCommandStrip from '../components/propdev/PropDevCommandStrip';
import PropDevEmptyState from '../components/propdev/PropDevEmptyState';
import AiInsightsPanel from '../components/propdev/AiInsightsPanel';
import PD01Dashboard from './propdev/PD01Dashboard';
import PropDevExecutiveSummary from './propdev/PropDevExecutiveSummary';
import PD05Partners from './propdev/PD05Partners';
import PD06CapitalCalls from './propdev/PD06CapitalCalls';
import PD07Loans from './propdev/PD07Loans';
import PD11CashFlow from './propdev/PD11CashFlow';
import PD00Upload from './propdev/PD00Upload';
import PDCompanies from './propdev/PDCompanies';
import PDEntityExecutiveSummary from './propdev/PDEntityExecutiveSummary';
import PDProperties from './propdev/PDProperties';
import PropDevFinancials from './propdev/PropDevFinancials';
import PropDevFinancialRatios from './propdev/PropDevFinancialRatios';
import { parchmentStyles } from '../theme/parchmentTheme';

function PropertyDevInner() {
  const { tab } = usePropDevNav();
  const { companies } = usePropDev();
  const [aiOpen, setAiOpen] = useState(false);
  const hasData = companies.length > 0;
  const showPage = hasData || tab === 'upload' || tab === 'companies' || tab === 'financials' || tab === 'financial-ratios';

  return (
    <div
      id="propdev-section-root"
      className="dark-app space-y-4 -mx-4 lg:-mx-6"
      style={parchmentStyles.page}
    >
      <PropDevCommandStrip onAiInsights={() => setAiOpen(o => !o)} />

      <div className={`px-4 lg:px-6 transition-all ${aiOpen ? 'pr-[420px]' : ''}`}>
        {!showPage ? (
          <PropDevEmptyState />
        ) : (
          <>
            {tab === 'upload'        && <ErrorBoundary><PD00Upload /></ErrorBoundary>}
            {tab === 'companies'     && <ErrorBoundary><PDCompanies /></ErrorBoundary>}
            {tab === 'dashboard'     && <ErrorBoundary><PD01Dashboard /></ErrorBoundary>}
            {tab === 'entity-executive-summary' && <ErrorBoundary><PDEntityExecutiveSummary /></ErrorBoundary>}
            {tab === 'properties'     && <ErrorBoundary><PDProperties /></ErrorBoundary>}
            {tab === 'executive-summary' && <ErrorBoundary><PropDevExecutiveSummary /></ErrorBoundary>}
            {tab === 'partners'      && <ErrorBoundary><PD05Partners /></ErrorBoundary>}
            {tab === 'capital-calls' && <ErrorBoundary><PD06CapitalCalls /></ErrorBoundary>}
            {tab === 'loans'         && <ErrorBoundary><PD07Loans /></ErrorBoundary>}
            {tab === 'cash-flow'     && <ErrorBoundary><PD11CashFlow /></ErrorBoundary>}
            {tab === 'financials'        && <ErrorBoundary><PropDevFinancials /></ErrorBoundary>}
            {tab === 'financial-ratios'  && <ErrorBoundary><PropDevFinancialRatios /></ErrorBoundary>}
          </>
        )}
      </div>

      {aiOpen && <AiInsightsPanel onClose={() => setAiOpen(false)} />}
    </div>
  );
}

// PropDevNavProvider lives in AppShell — PropertyDevProvider is scoped here.
export default function PropertyDev() {
  return (
    <PropertyDevProvider>
      <PropertyDevInner />
    </PropertyDevProvider>
  );
}
