import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function AcceptInvite() {
  const { profile, loading, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && isAuthenticated && profile?.status !== 'invited') {
      navigate('/executive-summary');
    }
  }, [profile, loading, isAuthenticated, navigate]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  if (profile?.status === 'invited') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="bg-white rounded-xl p-8 max-w-md text-center shadow">
          <h2 className="text-xl font-bold text-primary">Invitation Pending</h2>
          <p className="text-gray-500 mt-2">Your account is marked invited. Ask an admin to activate it in local mode.</p>
        </div>
      </div>
    );
  }

  return null;
}
