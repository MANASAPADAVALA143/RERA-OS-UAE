import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import api, { fetchAuthConfig, getStoredToken, setStoredToken, type AuthConfig } from '../services/api';

export interface AuthProfile {
  user_id: string;
  email: string;
  tenant_id: string;
  company_name: string;
  role: string;
  status: string;
  subscription_tier: string;
  ai_narrative_enabled: boolean;
}

interface AuthContextType {
  profile: AuthProfile | null;
  loading: boolean;
  authConfig: AuthConfig | null;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  canWrite: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const WRITE_ROLES = new Set(['owner', 'admin', 'cfo', 'controller']);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const refreshProfile = async () => {
    try {
      const { data } = await api.get<AuthProfile>('/api/auth/me');
      setProfile(data);
      setIsAuthenticated(true);
    } catch {
      setProfile(null);
      setIsAuthenticated(false);
      setStoredToken(null);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const config = await fetchAuthConfig();
        setAuthConfig(config);

        if (getStoredToken()) {
          await refreshProfile();
        }
      } catch {
        setAuthConfig({ auth_mode: 'local' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data } = await api.post<{ access_token: string }>('/api/auth/login', { email, password });
    setStoredToken(data.access_token);
    await refreshProfile();
  };

  const signOut = async () => {
    setStoredToken(null);
    setProfile(null);
    setIsAuthenticated(false);
  };

  const canWrite = profile ? WRITE_ROLES.has(profile.role) : false;

  return (
    <AuthContext.Provider
      value={{ profile, loading, authConfig, isAuthenticated, signIn, signOut, refreshProfile, canWrite }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
