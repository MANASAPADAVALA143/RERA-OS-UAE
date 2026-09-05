import axios from 'axios';

// VITE_API_URL is injected by Render (the backend service hostname).
// In dev, it's not set so API_BASE is '' and the Vite proxy routes /api/* to localhost:8000.
const API_BASE = import.meta.env.VITE_API_URL
  ? `https://${import.meta.env.VITE_API_URL}`
  : '';
const TOKEN_KEY = 'estatecfo_access_token';

export const api = axios.create({
  baseURL: API_BASE,
  // Remote Supabase (India → AWS) can take 30–45s on first rental queries.
  timeout: 120_000,
});

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

/** Ping /health until the Render API is awake (cold starts can take 30–60s). */
export async function wakeApi(maxAttempts = 4, healthTimeoutMs = 20_000): Promise<void> {
  const delays = [0, 2000, 4000, 8000];
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      await api.get('/health', { timeout: healthTimeoutMs });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('API unreachable');
}

/** Fail an in-flight upload/save so the UI does not sit on "Uploading…" forever. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Request'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. Wait a moment and try again.`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function isApiNetworkError(e: unknown): boolean {
  const isNetwork =
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    ((e as { code?: string }).code === 'ERR_NETWORK' ||
      (e as { message?: string }).message === 'Network Error');
  const noResponse =
    typeof e === 'object' && e !== null && 'response' in e && !(e as { response?: unknown }).response;
  return isNetwork || noResponse;
}

/** POST multipart upload — retries once after wakeApi on cold-start network failures. */
export async function postUploadWithWake<T>(url: string, body: FormData) {
  try {
    return await api.post<T>(url, body);
  } catch (e: unknown) {
    if (!isApiNetworkError(e)) throw e;
    await wakeApi();
    return await api.post<T>(url, body);
  }
}

/** POST JSON — same cold-start wake/retry as multipart (Prop Dev / Rentals financials save). */
export async function postJsonWithWake<T>(url: string, body: unknown) {
  const opts = { timeout: 60_000 };
  try {
    return await api.post<T>(url, body, opts);
  } catch (e: unknown) {
    if (!isApiNetworkError(e)) throw e;
    // Cap wake so "Uploading…" cannot hang for several minutes on a wedged API.
    await wakeApi(3, 15_000);
    return await api.post<T>(url, body, opts);
  }
}

/** GET JSON — wake/retry so Prop Dev financials reload after Render cold starts (CORS ERR_FAILED). */
export async function getJsonWithWake<T>(url: string, config?: Parameters<typeof api.get>[1]) {
  try {
    return await api.get<T>(url, config);
  } catch (e: unknown) {
    if (!isApiNetworkError(e)) throw e;
    await wakeApi();
    return await api.get<T>(url, config);
  }
}

export function formatApiError(e: unknown, fallback = 'Request failed'): string {
  if (isApiNetworkError(e)) {
    return 'Cannot reach the API server — it may be waking up after idle (~30–60s on Render). Refresh the page, wait a moment, then try the upload again.';
  }
  const detail = (e as { response?: { data?: { detail?: string | { msg?: string }[] } } })?.response?.data
    ?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

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
