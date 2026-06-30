import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/executive-summary');
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            ?? 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F8F9FB' }}>
      <div className="w-full max-w-sm p-8 rounded-2xl" style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)' }}>
            <span className="text-white font-bold text-lg">E</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#111827' }}>EstateCFO</h1>
          <p className="text-sm mt-1" style={{ color: '#6B7280' }}>Real estate financial intelligence</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoComplete="email"
              className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: '#F9FAFB', border: '1px solid #D1D5DB', color: '#111827' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#374151' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: '#F9FAFB', border: '1px solid #D1D5DB', color: '#111827' }}
            />
          </div>

          {error && (
            <div className="text-xs rounded-lg px-3 py-2" style={{ color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm text-white py-2.5 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            style={{ background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)' }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: '#6B7280' }}>
          Contact your administrator to get access
        </p>
      </div>
    </div>
  );
}
