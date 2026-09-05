import { api } from '../services/api';

export const PROPDEV_FIN_FETCH_CONCURRENCY = 3;

type FinancialsApiPayload = {
  company_name: string;
  filename?: string;
  uploaded_at?: string;
  years: number[];
  pl: unknown[];
  bs: unknown[];
  cf?: unknown[];
};

type FinancialsListRow = {
  company_id: string;
  company_name?: string;
  filename?: string;
  years?: number[];
  uploaded_at?: string;
};

/**
 * Fetch /api/propdev/financials/{id} with a concurrency cap (same pattern as rentals).
 * Uses GET /api/propdev/financials first so companies without uploads are not
 * probed (avoids noisy browser 404s for every empty entity).
 */
export async function fetchPropDevFinancialsPool<T>(
  ids: string[],
  mapResponse: (id: string, data: FinancialsApiPayload) => T | null,
  options?: {
    concurrency?: number;
    onItem?: (id: string, item: T) => void;
  },
): Promise<Record<string, T>> {
  const concurrency = options?.concurrency ?? PROPDEV_FIN_FETCH_CONCURRENCY;
  const out: Record<string, T> = {};
  if (!ids.length) return out;

  const requested = new Set(ids);
  let idsWithUploads: string[] = [];
  try {
    const listRes = await api.get<FinancialsListRow[]>('/api/propdev/financials');
    idsWithUploads = (listRes.data ?? [])
      .map(r => r.company_id)
      .filter(id => requested.has(id));
  } catch {
    // List failed — fall back to probing requested ids (may 404).
    idsWithUploads = ids;
  }
  if (!idsWithUploads.length) return out;

  let next = 0;
  async function worker() {
    while (next < idsWithUploads.length) {
      const i = next++;
      const id = idsWithUploads[i];
      try {
        const res = await api.get<FinancialsApiPayload>(`/api/propdev/financials/${id}`);
        if (!res.data?.pl?.length && !res.data?.bs?.length && !res.data?.cf?.length) continue;
        const mapped = mapResponse(id, res.data);
        if (mapped != null) {
          out[id] = mapped;
          options?.onItem?.(id, mapped);
        }
      } catch {
        // Network / unexpected — skip
      }
    }
  }

  const workers = Math.min(concurrency, idsWithUploads.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
