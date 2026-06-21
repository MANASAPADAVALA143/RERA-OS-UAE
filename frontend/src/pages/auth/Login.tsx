import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function Login() {
  const { authConfig, signIn } = useAuth();
  const demoEmail = authConfig?.demo_email || 'demo@estatecfo.com';
  const demoPassword = authConfig?.demo_password || 'demo1234';

  const [email, setEmail] = useState(demoEmail);
  const [password, setPassword] = useState(demoPassword);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/executive-summary');
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
        : null;
      setError(msg || (err instanceof Error ? err.message : 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-primary">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-primary mb-1">EstateCFO</h1>
        <p className="text-gray-500 text-sm mb-4">Local demo mode — no Supabase required</p>

        <div className="mb-4 p-3 rounded-lg bg-accent/10 border border-accent/30 text-sm text-primary">
          <p className="font-medium">Demo login (pre-filled)</p>
          <p className="mt-1 text-gray-600">{demoEmail} / {demoPassword}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-accent" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-primary text-white py-2.5 rounded-lg font-medium hover:bg-primary-light disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign in to demo'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          New company? <Link to="/register" className="text-accent font-medium hover:underline">Register</Link>
        </p>
      </div>
    </div>
  );
}
