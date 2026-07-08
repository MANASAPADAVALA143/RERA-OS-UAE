import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { normalizeMonthKey } from '../utils/executiveSummaryFormatters';
import type { QBAgingLatest } from '../components/rental/QbArAgingUploadPanel';
import type { AgingTrendBuckets } from '../utils/executiveSummaryCharts';

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
    company_id?: string;
    company_name: string;
    property_name?: string;
    ownership_pct: number;
    noi_share: number;
    noi_this_month?: number;
    existing_debt?: number | null;
    book_value?: number | null;
    cost_basis?: number | null;
    capital_contributed?: number | null;
  }[];
}

export interface QbApAgingLatest {
  has_data: boolean;
  snapshot_count: number;
  dpo_estimate?: number | null;
  trend: AgingTrendBuckets[];
  trend_ready: boolean;
}

export function useExecutiveSummaryData(monthYm?: string) {
  const [arSummary, setArSummary] = useState<ArSummaryResponse | null>(null);
  const [ownership, setOwnership] = useState<OwnerRow[]>([]);
  const [qbArAging, setQbArAging] = useState<QBAgingLatest | null>(null);
  const [qbApAging, setQbApAging] = useState<QbApAgingLatest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = monthYm ? `?month=${monthYm}` : '';
    Promise.all([
      api.get<ArSummaryResponse>(`/api/rentals/ar-summary${q}`).catch(() => ({ data: null })),
      api.get<OwnerRow[]>('/api/rentals/ownership').catch(() => ({ data: [] as OwnerRow[] })),
      api.get<QBAgingLatest>('/api/rentals/ar-ap/qb-aging/latest').catch(() => ({ data: null })),
      api.get<QbApAgingLatest>('/api/rentals/ar-ap/qb-ap-aging/latest').catch(() => ({ data: null })),
    ]).then(([arRes, ownRes, arAgingRes, apAgingRes]) => {
      if (cancelled) return;
      setArSummary(arRes.data);
      setOwnership(Array.isArray(ownRes.data) ? ownRes.data : []);
      setQbArAging(arAgingRes.data);
      setQbApAging(apAgingRes.data);
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
    qbArAging,
    qbApAging,
    loading,
    hasOwnership: ownership.length > 0,
    hasAr: Boolean(arSummary?.monthly_trend?.length || arSummary?.portfolio?.total_units),
    hasApAging: Boolean(qbApAging?.has_data),
    hasArAging: Boolean(qbArAging?.has_data),
  };
}
