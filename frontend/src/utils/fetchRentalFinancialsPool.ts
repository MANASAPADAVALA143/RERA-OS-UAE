import { api } from '../services/api';

export const RENTAL_FIN_FETCH_CONCURRENCY = 3;

type FinancialsApiPayload = {
  company_name: string;
  filename: string;
  date_range: string;
  years: number[];
  periods?: string[];
  pl: unknown[];
  bs: unknown[];
  cf?: unknown[];
  uploaded_at: string;
};

/**
 * Fetch /api/rentals/financials/{id} with a concurrency cap so Render cold starts
 * are not overwhelmed by N parallel large JSON responses.
 */
export async function fetchRentalFinancialsPool<T>(
  ids: string[],
  mapResponse: (id: string, data: FinancialsApiPayload) => T | null,
  options?: {
    concurrency?: number;
    onItem?: (id: string, item: T) => void;
  },
): Promise<Record<string, T>> {
  const concurrency = options?.concurrency ?? RENTAL_FIN_FETCH_CONCURRENCY;
  const out: Record<string, T> = {};
  if (!ids.length) return out;

  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const i = next++;
      const id = ids[i];
      try {
        const res = await api.get<FinancialsApiPayload>(`/api/rentals/financials/${id}`);
        const mapped = mapResponse(id, res.data);
        if (mapped != null) {
          out[id] = mapped;
          options?.onItem?.(id, mapped);
        }
      } catch {
        // 404 or network — skip this company
      }
    }
  }

  const workers = Math.min(concurrency, ids.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
