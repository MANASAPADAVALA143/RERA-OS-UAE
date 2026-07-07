import { useAuth } from '../contexts/AuthContext';

/**
 * Whether the signed-in user may see KPI breakdown UI (ⓘ expand, Calculations tab).
 * Gated server-side by primary operator email — mirrored in GET /api/auth/me.
 */
export function useKpiAdminAccess() {
  const { profile, loading, isKpiReviewer } = useAuth();
  return {
    isKpiAdmin: isKpiReviewer,
    loading,
    email: profile?.email ?? null,
    role: profile?.role ?? null,
  };
}
