import { useRentalNav } from '../contexts/RentalNavContext';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import RentalOverview from './RentalOverview';
import RentalCompanies from './RentalCompanies';
import RentalUnits from './RentalUnits';
import RentalLeases from './RentalLeases';
import RentalMaintenance from './RentalMaintenance';
import RentalInspections from './RentalInspections';
import RentalCollections from './RentalCollections';
import RentalVacancy from './RentalVacancy';
import RentalExpenses from './RentalExpenses';
import RentalOwnership from './RentalOwnership';
import RentalReports from './RentalReports';
import RentalArAp from './RentalArAp';
import RentalArDashboard from './RentalArDashboard';
import RentalApDashboard from './RentalApDashboard';
import RentalVendorManagement from './RentalVendorManagement';
import RentalVendorRisk from './RentalVendorRisk';
import RentalPortfolioUpload from './RentalPortfolioUpload';
import RentalCfoDashboard from './RentalCfoDashboard';
import RentalIncomeBridge from './RentalIncomeBridge';
import RentalEntityRollup from './RentalEntityRollup';
import RentalCompliance from './RentalCompliance';

export default function Rental() {
  const { tab } = useRentalNav();
  return (
    <div className="space-y-6">
      {tab === 'overview'     && <ErrorBoundary><RentalOverview /></ErrorBoundary>}
      {tab === 'companies'    && <ErrorBoundary><RentalCompanies /></ErrorBoundary>}
      {tab === 'units'        && <ErrorBoundary><RentalUnits /></ErrorBoundary>}
      {tab === 'leases'       && <ErrorBoundary><RentalLeases /></ErrorBoundary>}
      {tab === 'maintenance'  && <ErrorBoundary><RentalMaintenance /></ErrorBoundary>}
      {tab === 'inspections'  && <ErrorBoundary><RentalInspections /></ErrorBoundary>}
      {tab === 'vendor-risk'  && <ErrorBoundary><RentalVendorRisk /></ErrorBoundary>}
      {tab === 'collections'  && <ErrorBoundary><RentalCollections /></ErrorBoundary>}
      {tab === 'vacancy'      && <ErrorBoundary><RentalVacancy /></ErrorBoundary>}
      {tab === 'expenses'     && <ErrorBoundary><RentalExpenses /></ErrorBoundary>}
      {tab === 'ar-ap'        && <ErrorBoundary><RentalArAp /></ErrorBoundary>}
      {tab === 'ar-dashboard'      && <ErrorBoundary><RentalArDashboard /></ErrorBoundary>}
      {tab === 'ap-dashboard'      && <ErrorBoundary><RentalApDashboard /></ErrorBoundary>}
      {tab === 'vendor-management' && <ErrorBoundary><RentalVendorManagement /></ErrorBoundary>}
      {tab === 'ownership'         && <ErrorBoundary><RentalOwnership /></ErrorBoundary>}
      {tab === 'reports'           && <ErrorBoundary><RentalReports /></ErrorBoundary>}
      {tab === 'portfolio-upload'  && <ErrorBoundary><RentalPortfolioUpload /></ErrorBoundary>}
      {tab === 'cfo-dashboard'     && <ErrorBoundary><RentalCfoDashboard /></ErrorBoundary>}
      {tab === 'income-bridge'     && <ErrorBoundary><RentalIncomeBridge /></ErrorBoundary>}
      {tab === 'entity-rollup'     && <ErrorBoundary><RentalEntityRollup /></ErrorBoundary>}
      {tab === 'compliance'        && <ErrorBoundary><RentalCompliance /></ErrorBoundary>}
    </div>
  );
}
