import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useRentalNav, tabFromRentalPath } from '../contexts/RentalNavContext';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import RentalOverview from './RentalOverview';
import RentalCompanies from './RentalCompanies';
import RentalUnits from './RentalUnits';
import RentalLeases from './RentalLeases';
import RentalMaintenance from './RentalMaintenance';
import RentalCollections from './RentalCollections';
import RentalVacancy from './RentalVacancy';
import RentalExpenses from './RentalExpenses';
import RentalOwnership from './RentalOwnership';
import RentalReports from './RentalReports';
import RentalArDashboard from './RentalArDashboard';
import RentalApDashboard from './RentalApDashboard';
import RentalVendorManagement from './RentalVendorManagement';
import RentalVendorRisk from './RentalVendorRisk';
import RentalPortfolioUpload from './RentalPortfolioUpload';
import RentalCfoDashboard from './RentalCfoDashboard';
import RentalIncomeBridge from './RentalIncomeBridge';
import RentalEntityRollup from './RentalEntityRollup';
import RentalCompliance from './RentalCompliance';
import RentalFinancials from './RentalFinancials';
import RentalDiscounts from './RentalDiscounts';
import RentalPortfolio from './RentalPortfolio';
import RentalFinancialRatios from './rental/RentalFinancialRatios';
import RentalBuildingExpenses from './rental/RentalBuildingExpenses';
import RentalLoanTracker from './rental/RentalLoanTracker';
import RentalCfoPortfolio from './rental/RentalCfoPortfolio';
import Rental13WeekCashFlow from './rental/Rental13WeekCashFlow';
import RentalExecutiveSummary from './RentalExecutiveSummary';

export default function Rental() {
  const { tab, setTab } = useRentalNav();
  const location = useLocation();

  useEffect(() => {
    const t = tabFromRentalPath(location.pathname);
    if (t) setTab(t);
  }, [location.pathname, setTab]);
  return (
    <div className="space-y-6">
      {tab === 'executive-summary' && <ErrorBoundary><RentalExecutiveSummary /></ErrorBoundary>}
      {tab === 'overview'     && <ErrorBoundary><RentalOverview /></ErrorBoundary>}
      {tab === 'companies'    && <ErrorBoundary><RentalCompanies /></ErrorBoundary>}
      {tab === 'units'        && <ErrorBoundary><RentalUnits /></ErrorBoundary>}
      {tab === 'discounts'    && <ErrorBoundary><RentalDiscounts /></ErrorBoundary>}
      {tab === 'leases'       && <ErrorBoundary><RentalLeases /></ErrorBoundary>}
      {tab === 'maintenance'  && <ErrorBoundary><RentalMaintenance /></ErrorBoundary>}
      {tab === 'vendor-risk'  && <ErrorBoundary><RentalVendorRisk /></ErrorBoundary>}
      {tab === 'collections'  && <ErrorBoundary><RentalCollections /></ErrorBoundary>}
      {tab === 'vacancy'      && <ErrorBoundary><RentalVacancy /></ErrorBoundary>}
      {tab === 'expenses'     && <ErrorBoundary><RentalExpenses /></ErrorBoundary>}
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
      {tab === 'financials'        && <ErrorBoundary><RentalFinancials /></ErrorBoundary>}
      {tab === 'financial-ratios'  && <ErrorBoundary><RentalFinancialRatios /></ErrorBoundary>}
      {tab === 'building-expenses' && <ErrorBoundary><RentalBuildingExpenses /></ErrorBoundary>}
      {tab === 'loan-tracker'      && <ErrorBoundary><RentalLoanTracker /></ErrorBoundary>}
      {tab === 'cfo-portfolio'     && <ErrorBoundary><RentalCfoPortfolio /></ErrorBoundary>}
      {tab === '13-week-cf'        && <ErrorBoundary><Rental13WeekCashFlow /></ErrorBoundary>}
    </div>
  );
}
