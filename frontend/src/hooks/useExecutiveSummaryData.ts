import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { normalizeMonthKey } from '../utils/executiveSummaryFormatters';

export interface ArMonth {
  month: string;
  billed: number;
  collected: number;
}

export interface ArSummaryResponse {
  companies: {
    company_id: string;
    company_name: string;
    monthly?: { month: string; billed: number; collected: number }[];
    occupancy_rate?: number;
    gross_potential?: number;
    collected?: number;
    vacancy_loss?: number;
  }[];
  portfolio: {
    total_billed: number;
    total_collected: number;
    total_outstanding: number;
    collection_rate: number;
    vacancy_loss: number;
    occupied_units: number;
    total_units: number;
  };
  monthly_trend: { month: string; billed: number; collected: number }[];
  available_months: string[];
}

export interface OwnerRow {
  partner_name: string;
  total_noi_share: number;
  holdings: {
    company_name: string;
    property_name?: string;
    ownership_pct: number;
    noi_share: number;
    noi_this_month?: number;
    existing_debt?: number | null;
  }[];
}

export function useExecutiveSummaryData(monthYm?: string) {
  const [arSummary, setArSummary] = useState<ArSummaryResponse | null>(null);
  const [ownership, setOwnership] = useState<OwnerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = monthYm ? `?month=${monthYm}` : '';
    Promise.all([
      api.get<ArSummaryResponse>(`/api/rentals/ar-summary${q}`).catch(() => ({ data: null })),
      api.get<OwnerRow[]>('/api/rentals/ownership').catch(() => ({ data: [] as OwnerRow[] })),
    ]).then(([arRes, ownRes]) => {
      if (cancelled) return;
      setArSummary(arRes.data);
      setOwnership(Array.isArray(ownRes.data) ? ownRes.data : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [monthYm]);

  const arMonths = useMemo((): ArMonth[] => {
    if (!arSummary?.monthly_trend?.length) return [];
    return arSummary.monthly_trend.map(t => ({
      month: normalizeMonthKey(t.month),
      billed: t.billed ?? 0,
      collected: t.collected ?? 0,
    }));
  }, [arSummary]);

  const availableArMonths = useMemo(
    () => (arSummary?.available_months ?? []).map(normalizeMonthKey),
    [arSummary],
  );

  return {
    arSummary,
    arMonths,
    availableArMonths,
    ownership,
    loading,
    hasOwnership: ownership.length > 0,
    hasAr: Boolean(arSummary?.monthly_trend?.length || arSummary?.portfolio?.total_units),
  };
}
