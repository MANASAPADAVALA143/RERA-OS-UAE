import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import AppShell from './components/layout/AppShell';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import AcceptInvite from './pages/auth/AcceptInvite';
import ExecutiveSummary from './pages/ExecutiveSummary';
import Construction from './pages/Construction';
import Development from './pages/Development';
import Reit from './pages/Reit';
import ReitPropertyDetail from './pages/ReitPropertyDetail';
import Rental from './pages/Rental';
import PropertyDev from './pages/PropertyDev';
import CapitalRisk from './pages/CapitalRisk';
import PipelineMarket from './pages/PipelineMarket';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Navigate to="/executive-summary" replace />} />
          <Route path="/register" element={<Navigate to="/executive-summary" replace />} />
          <Route path="/accept-invite" element={<Navigate to="/executive-summary" replace />} />
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/executive-summary" element={<ExecutiveSummary />} />
            <Route path="/construction" element={<Construction />} />
            <Route path="/development" element={<Development />} />
            <Route path="/reit" element={<Reit />} />
            <Route path="/reit/:propertyId" element={<ReitPropertyDetail />} />
            <Route path="/rental" element={<Rental />} />
            <Route path="/property-dev" element={<PropertyDev />} />
            <Route path="/capital-risk" element={<CapitalRisk />} />
            <Route path="/pipeline-market" element={<PipelineMarket />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="/" element={<Navigate to="/executive-summary" replace />} />
          <Route path="*" element={<Navigate to="/executive-summary" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
