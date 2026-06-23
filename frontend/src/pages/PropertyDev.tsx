import { useState } from 'react';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { PropertyDevProvider } from '../contexts/PropertyDevContext';
import { usePropDevNav } from '../contexts/PropDevNavContext';
import PropDevCommandStrip from '../components/propdev/PropDevCommandStrip';
import AiInsightsPanel from '../components/propdev/AiInsightsPanel';
import PD01Dashboard from './propdev/PD01Dashboard';
import PD02DealPL from './propdev/PD02DealPL';
import PD03Pricing from './propdev/PD03Pricing';
import PD04Inventory from './propdev/PD04Inventory';
import PD05Partners from './propdev/PD05Partners';
import PD06CapitalCalls from './propdev/PD06CapitalCalls';
import PD07Loans from './propdev/PD07Loans';
import PD08Sales from './propdev/PD08Sales';
import PD09Performance from './propdev/PD09Performance';
import PD10Receivables from './propdev/PD10Receivables';
import PD11CashFlow from './propdev/PD11CashFlow';
import PD12Documents from './propdev/PD12Documents';

function PropertyDevInner() {
  const { tab } = usePropDevNav();
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <div className="relative -m-6 lg:-m-8">
      {/* Command Strip */}
      <PropDevCommandStrip onAiInsights={() => setAiOpen(o => !o)} />

      {/* Page content */}
      <div className={`p-6 lg:p-8 transition-all ${aiOpen ? 'pr-[420px]' : ''}`}>
        {tab === 'dashboard'     && <ErrorBoundary><PD01Dashboard /></ErrorBoundary>}
        {tab === 'deal-pl'       && <ErrorBoundary><PD02DealPL /></ErrorBoundary>}
        {tab === 'pricing'       && <ErrorBoundary><PD03Pricing /></ErrorBoundary>}
        {tab === 'inventory'     && <ErrorBoundary><PD04Inventory /></ErrorBoundary>}
        {tab === 'partners'      && <ErrorBoundary><PD05Partners /></ErrorBoundary>}
        {tab === 'capital-calls' && <ErrorBoundary><PD06CapitalCalls /></ErrorBoundary>}
        {tab === 'loans'         && <ErrorBoundary><PD07Loans /></ErrorBoundary>}
        {tab === 'sales'         && <ErrorBoundary><PD08Sales /></ErrorBoundary>}
        {tab === 'performance'   && <ErrorBoundary><PD09Performance /></ErrorBoundary>}
        {tab === 'receivables'   && <ErrorBoundary><PD10Receivables /></ErrorBoundary>}
        {tab === 'cash-flow'     && <ErrorBoundary><PD11CashFlow /></ErrorBoundary>}
        {tab === 'documents'     && <ErrorBoundary><PD12Documents /></ErrorBoundary>}
      </div>

      {/* AI Insights Side Panel */}
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
