import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { KpiCalculationsReviewPanel } from '../../components/admin/KpiCalculationsReviewPanel';

export default function RentalCalculationsReview() {
  const { isKpiReviewer, loading } = useAuth();

  if (loading) return null;
  if (!isKpiReviewer) return <Navigate to="/rental" replace />;

  return <KpiCalculationsReviewPanel embedded />;
}
