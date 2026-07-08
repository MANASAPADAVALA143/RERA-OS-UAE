import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import {
  aggregateKpiDataList,
  apiResponseToParsedFinancials,
  calcKpis,
  solvencyMetricsFromKpi,
  type KpiData,
} from '../utils/rentalKpiEngine';
import {
  derivePartnerFinancials,
  holdingFinancials,
  type OwnershipCompanyMeta,
  type OwnershipPartnerGroup,
  type PartnerFinancials,
} from '../utils/ownershipFinancials';
import { effectiveCapRate, partnerReturnMetrics } from '../utils/ownershipMetrics';

export interface OwnershipContributionRow {
  id: string;
  partner: string;
  company: string;
  date: string;
  amount: number;
  type: string;
}

function buildContributions(partners: OwnershipPartnerGroup[]): OwnershipContributionRow[] {
  const rows: OwnershipContributionRow[] = [];
  partners.forEach(p => {
    p.holdings.forEach(h => {
      if (h.capital_contributed && h.capital_contributed > 0) {
        rows.push({
          id: `import-${h.ownership_id}`,
          partner: p.partner_name,
          company: h.company_name,
          date: '—',
          amount: h.capital_contributed,
          type: 'Initial Contribution',
        });
      }
    });
  });
  return rows;
}

export function useOwnershipAnalyticsData(entityCompanyId: string = 'portfolio') {
  const [apiPartners, setApiPartners] = useState<OwnershipPartnerGroup[]>([]);
  const [companies, setCompanies] = useState<OwnershipCompanyMeta[]>([]);
  const [companyKpis, setCompanyKpis] = useState<Record<string, KpiData | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scatterMode, setScatterMode] = useState<'partner' | 'property'>('partner');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    Promise.all([
      api.get<OwnershipPartnerGroup[]>('/api/rentals/ownership'),
      api.get<OwnershipCompanyMeta[]>('/api/rentals/companies'),
    ])
      .then(([ownRes, coRes]) => {
        if (cancelled) return;
        setApiPartners(Array.isArray(ownRes.data) ? ownRes.data : []);
        setCompanies(Array.isArray(coRes.data) ? coRes.data : []);
      })
      .catch(() => { if (!cancelled) setError('Failed to load ownership analytics.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const scopedCompanyId = entityCompanyId !== 'portfolio' ? entityCompanyId : undefined;

  const scopedPartners = useMemo(() => {
    if (!scopedCompanyId) return apiPartners;
    return apiPartners
      .map(p => ({
        ...p,
        holdings: p.holdings.filter(h => h.company_id === scopedCompanyId),
      }))
      .filter(p => p.holdings.length > 0);
  }, [apiPartners, scopedCompanyId]);

  useEffect(() => {
    const ids = [...new Set(scopedPartners.flatMap(p => p.holdings.map(h => h.company_id)))];
    if (!ids.length) {
      setCompanyKpis({});
      return;
    }
    let cancelled = false;
    Promise.all(ids.map(async id => {
      try {
        const res = await api.get(`/api/rentals/financials/${id}`);
        const fin = apiResponseToParsedFinancials(res.data);
        const year = fin.years.length ? fin.years[fin.years.length - 1] : null;
        return [id, year ? calcKpis(fin, year) : null] as const;
      } catch {
        return [id, null] as const;
      }
    })).then(rows => {
      if (cancelled) return;
      const m: Record<string, KpiData | null> = {};
      rows.forEach(([id, k]) => { m[id] = k; });
      setCompanyKpis(m);
    });
    return () => { cancelled = true; };
  }, [scopedPartners]);

  const companyGpr = useMemo(() => {
    const m: Record<string, number> = {};
    companies.forEach(c => { m[c.id] = c.gross_potential_rent; });
    return m;
  }, [companies]);

  const financials = useMemo(() => {
    const m: Record<string, PartnerFinancials> = {};
    scopedPartners.forEach(p => {
      m[p.partner_name] = derivePartnerFinancials(p, companyGpr, scopedCompanyId);
    });
    return m;
  }, [scopedPartners, companyGpr, scopedCompanyId]);

  const allContribs = useMemo(() => buildContributions(scopedPartners), [scopedPartners]);

  const partnerMetricsByName = useMemo(() => {
    const m: Record<string, ReturnType<typeof partnerReturnMetrics>> = {};
    scopedPartners.forEach(p => {
      const f = financials[p.partner_name];
      const contribs = allContribs
        .filter(c => c.partner === p.partner_name)
        .map(c => ({ date: c.date, amount: c.amount, type: c.type }));
      m[p.partner_name] = partnerReturnMetrics(
        contribs,
        f?.capitalContributed ?? 0,
        f?.marketValue ?? 0,
      );
    });
    return m;
  }, [scopedPartners, financials, allContribs]);

  const propertiesPerCompany = useMemo(() => {
    const uniq: Record<string, Set<string>> = {};
    scopedPartners.forEach(p => {
      p.holdings.forEach(h => {
        if (!uniq[h.company_id]) uniq[h.company_id] = new Set();
        uniq[h.company_id].add(h.property_name || h.company_name);
      });
    });
    const out: Record<string, number> = {};
    Object.entries(uniq).forEach(([id, set]) => { out[id] = set.size; });
    return out;
  }, [scopedPartners]);

  const byProperty = useMemo(() => {
    const map: Record<string, {
      key: string; propertyName: string; companyId: string;
      marketValue: number; effectiveCapRate: number | null;
    }> = {};
    scopedPartners.forEach(p => {
      p.holdings.forEach(h => {
        const gpr = companyGpr[h.company_id] ?? 0;
        const hf = holdingFinancials(h, gpr);
        const propName = h.property_name || h.company_name;
        const key = `${h.company_id}::${propName}`;
        if (!map[key]) {
          map[key] = { key, propertyName: propName, companyId: h.company_id, marketValue: 0, effectiveCapRate: null };
        }
        map[key].marketValue += hf.marketValue;
      });
    });
    const rows = Object.values(map);
    rows.forEach(r => {
      const kpi = companyKpis[r.companyId];
      const propCount = propertiesPerCompany[r.companyId] ?? 1;
      const companyNoi = kpi?.noi ?? 0;
      const allocatedNoi = propCount > 0 ? companyNoi / propCount : companyNoi;
      r.effectiveCapRate = effectiveCapRate(allocatedNoi, r.marketValue);
    });
    return rows;
  }, [scopedPartners, companyGpr, companyKpis, propertiesPerCompany]);

  const portfolioMarketValue = useMemo(
    () => scopedPartners.reduce((s, p) => s + (financials[p.partner_name]?.marketValue ?? 0), 0),
    [scopedPartners, financials],
  );

  const avgROI = useMemo(() => {
    const fs = scopedPartners.map(p => financials[p.partner_name]).filter(Boolean);
    const totalCost = fs.reduce((s, f) => s + f.costBasis, 0);
    return totalCost > 0
      ? fs.reduce((s, f) => s + f.roi * f.costBasis, 0) / totalCost
      : 0;
  }, [scopedPartners, financials]);

  const scatterPoints = useMemo(() => {
    if (scatterMode === 'partner') {
      return scopedPartners.map(p => {
        const f = financials[p.partner_name];
        const metrics = partnerMetricsByName[p.partner_name];
        const companyIds = [...new Set(p.holdings.map(h => h.company_id))];
        const kpis = companyIds.map(id => companyKpis[id]).filter((k): k is KpiData => k != null);
        const solvency = kpis.length ? solvencyMetricsFromKpi(aggregateKpiDataList(kpis)) : { ltvPct: null, dscr: null };
        const risk = solvency.ltvPct ?? (solvency.dscr != null ? solvency.dscr * 100 : null);
        return {
          name: p.partner_name,
          irr: metrics?.irr ?? null,
          risk,
          size: Math.max(f?.marketValue ?? 0, 1),
        };
      }).filter(pt => pt.irr != null && pt.risk != null);
    }
    return byProperty.map(prop => {
      const kpi = companyKpis[prop.companyId];
      const solvency = kpi ? solvencyMetricsFromKpi(kpi) : { ltvPct: null, dscr: null };
      const risk = solvency.ltvPct ?? (solvency.dscr != null ? solvency.dscr * 100 : null);
      return {
        name: prop.propertyName,
        irr: prop.effectiveCapRate,
        risk,
        size: Math.max(prop.marketValue, 1),
      };
    }).filter(pt => pt.irr != null && pt.risk != null);
  }, [scatterMode, scopedPartners, financials, partnerMetricsByName, companyKpis, byProperty]);

  return {
    loading,
    error,
    partners: scopedPartners,
    financials,
    portfolioMarketValue,
    avgROI,
    scatterMode,
    setScatterMode,
    scatterPoints,
  };
}
