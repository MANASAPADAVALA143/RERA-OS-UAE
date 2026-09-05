import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { ConsultancyProvider } from '../contexts/ConsultancyContext';
import { useConsultancyNav } from '../contexts/ConsultancyNavContext';
import ConsultancyOverview from './consultancy/ConsultancyOverview';
import ConsultancyExecutiveSummary from './consultancy/ConsultancyExecutiveSummary';
import ConsultancyFinancials from './consultancy/ConsultancyFinancials';
import ConsultancyBillingCollections from './consultancy/ConsultancyBillingCollections';
import ConsultancyClients from './consultancy/ConsultancyClients';
import ConsultancyComingSoon from '../components/consultancy/ConsultancyComingSoon';
import { parchmentStyles } from '../theme/parchmentTheme';

const COMING_SOON_LABEL: Partial<Record<string, string>> = {
  workforce: 'Workforce',
  deployments: 'Deployments',
  'payroll-compliance': 'Payroll & Compliance',
  'bench-utilization': 'Bench & Utilization',
};

function ConsultancyInner() {
  const { tab } = useConsultancyNav();

  return (
    <div
      id="consultancy-section-root"
      className="dark-app space-y-4 -mx-4 lg:-mx-6"
      style={parchmentStyles.page}
    >
      <div className="px-4 lg:px-6">
        {tab === 'executive-summary' && <ErrorBoundary><ConsultancyExecutiveSummary /></ErrorBoundary>}
        {tab === 'overview'          && <ErrorBoundary><ConsultancyOverview /></ErrorBoundary>}
        {tab === 'financials'        && <ErrorBoundary><ConsultancyFinancials initialTab="P&L Statement" /></ErrorBoundary>}
        {tab === 'cfo-view'          && <ErrorBoundary><ConsultancyFinancials initialTab="CFO Dashboard" /></ErrorBoundary>}
        {tab === 'billing-collections' && <ErrorBoundary><ConsultancyBillingCollections /></ErrorBoundary>}
        {tab === 'clients'           && <ErrorBoundary><ConsultancyClients /></ErrorBoundary>}
        {tab in COMING_SOON_LABEL && (
          <ErrorBoundary><ConsultancyComingSoon label={COMING_SOON_LABEL[tab] ?? tab} /></ErrorBoundary>
        )}
      </div>
    </div>
  );
}

// ConsultancyNavProvider lives in AppShell — ConsultancyProvider is scoped here.
export default function Consultancy() {
  return (
    <ConsultancyProvider>
      <ConsultancyInner />
    </ConsultancyProvider>
  );
}
