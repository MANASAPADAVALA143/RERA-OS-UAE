import { createClient } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import api, { fetchAuthConfig, getStoredToken, setStoredToken, type AuthConfig } from '../services/api';

// Supabase client — only created when env vars are present (production).
// In local dev VITE_SUPABASE_URL is not set, so supabase stays null and
// the backend /api/auth/login endpoint is used instead.
const _sbUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const _sbKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = (_sbUrl && _sbKey) ? createClient(_sbUrl, _sbKey) : null;

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

  // Bootstrap: load auth config + restore session from stored token
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

  // Supabase token refresh listener — keeps the stored JWT up to date
  // without requiring the user to re-login when the 1-hour token expires.
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.access_token) {
        setStoredToken(session.access_token);
      }
      if (event === 'SIGNED_OUT') {
        setStoredToken(null);
        setProfile(null);
        setIsAuthenticated(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (supabase) {
      // Production — Supabase handles auth; backend validates the JWT
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      const token = data.session?.access_token;
      if (token) setStoredToken(token);
    } else {
      // Local dev — backend issues its own JWT
      const { data } = await api.post<{ access_token: string }>('/api/auth/login', { email, password });
      setStoredToken(data.access_token);
    }
    await refreshProfile();
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
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
