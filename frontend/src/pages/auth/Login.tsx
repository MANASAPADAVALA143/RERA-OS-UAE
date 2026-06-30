import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

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
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#161310' }}>
      <div className="w-full max-w-sm p-8 rounded-2xl"
        style={{ background: '#1C1917', border: '1px solid rgba(212,175,55,0.25)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #D4AF37, #B8962E)' }}>
            <span className="font-bold text-lg" style={{ color: '#161310' }}>E</span>
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#F5F5F4' }}>EstateCFO</h1>
          <p className="text-sm mt-1" style={{ color: '#9C9893' }}>Real estate financial intelligence</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#D6D3D1' }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoComplete="email"
              className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2"
              style={{
                background: '#161310',
                border: '1px solid #44403C',
                color: '#F5F5F4',
                // @ts-expect-error - CSS custom prop
                '--tw-ring-color': '#D4AF37',
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: '#D6D3D1' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2"
              style={{ background: '#161310', border: '1px solid #44403C', color: '#F5F5F4' }}
            />
          </div>

          {error && (
            <div className="text-xs rounded-lg px-3 py-2"
              style={{ color: '#FCA5A5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm py-2.5 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            style={{ background: '#D4AF37', color: '#161310' }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: '#78716C' }}>
          Contact your administrator to get access
        </p>
      </div>
    </div>
  );
}
