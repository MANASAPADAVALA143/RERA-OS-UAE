import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { ConsultancyProvider } from '../contexts/ConsultancyContext';
import { useConsultancyNav } from '../contexts/ConsultancyNavContext';
import CN01Dashboard from './consultancy/CN01Dashboard';
import CN02Revenue from './consultancy/CN02Revenue';
import CN03PL from './consultancy/CN03PL';
import CN04Payroll from './consultancy/CN04Payroll';
import CN05Receivables from './consultancy/CN05Receivables';
import CN06Financials from './consultancy/CN06Financials';

function ConsultancyInner() {
  const { tab } = useConsultancyNav();
  return (
    <div className="space-y-6">
      {tab === 'dashboard'   && <ErrorBoundary><CN01Dashboard /></ErrorBoundary>}
      {tab === 'revenue'     && <ErrorBoundary><CN02Revenue /></ErrorBoundary>}
      {tab === 'pnl'         && <ErrorBoundary><CN03PL /></ErrorBoundary>}
      {tab === 'payroll'     && <ErrorBoundary><CN04Payroll /></ErrorBoundary>}
      {tab === 'receivables' && <ErrorBoundary><CN05Receivables /></ErrorBoundary>}
      {tab === 'financials'  && <ErrorBoundary><CN06Financials /></ErrorBoundary>}
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
