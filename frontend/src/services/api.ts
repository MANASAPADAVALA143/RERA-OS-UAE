import axios from 'axios';

// VITE_API_URL is injected by Render (the backend service hostname).
// In dev, it's not set so API_BASE is '' and the Vite proxy routes /api/* to localhost:8000.
const API_BASE = import.meta.env.VITE_API_URL
  ? `https://${import.meta.env.VITE_API_URL}`
  : '';
const TOKEN_KEY = 'estatecfo_access_token';

export const api = axios.create({ baseURL: API_BASE });

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** One retry on network failure (Render cold start) for GET requests. */
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    if (!config || config._retry) return Promise.reject(error);
    const method = (config.method ?? 'get').toLowerCase();
    const isNetwork = !error.response && (error.code === 'ERR_NETWORK' || error.message === 'Network Error');
    if (method === 'get' && isNetwork) {
      config._retry = true;
      await new Promise((r) => setTimeout(r, 2500));
      return api(config);
    }
    return Promise.reject(error);
  },
);

export default api;

export interface AuthConfig {
  auth_mode: 'local' | 'supabase';
  single_user_mode?: boolean;
  primary_user_email?: string;
  demo_email?: string | null;
  demo_password?: string | null;
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const { data } = await api.get<AuthConfig>('/api/auth/config');
  return data;
}
