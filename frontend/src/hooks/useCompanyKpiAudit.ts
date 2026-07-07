import { useCallback, useEffect, useState } from 'react';
import api from '../services/api';
import type { CompanyKpiAuditResult } from '../types/kpiAudit';

interface Params {
  companyId: string | null;
  month: number;
  year: number;
  period?: string | null;
  enabled: boolean;
}

export function useCompanyKpiAudit({ companyId, month, year, period, enabled }: Params) {
  const [audit, setAudit] = useState<CompanyKpiAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchAudit = useCallback(async () => {
    if (!enabled || !companyId) {
      setAudit(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string | number> = { month, year };
      if (period) params.period = period;
      const { data } = await api.get<CompanyKpiAuditResult>(
        `/api/admin/kpi-sanity/company/${companyId}`,
        { params },
      );
      setAudit(data);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Failed to load calculation breakdown');
      setAudit(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, month, year, period, enabled]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const rowsByKpi = useCallback(() => {
    const map = new Map<string, CompanyKpiAuditResult['rows'][number]>();
    audit?.rows?.forEach(row => map.set(row.kpi, row));
    return map;
  }, [audit]);

  return { audit, loading, error, refresh: fetchAudit, rowsByKpi: rowsByKpi() };
}
