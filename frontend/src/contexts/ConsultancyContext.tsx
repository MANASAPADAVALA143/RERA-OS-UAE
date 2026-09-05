/**
 * Consultancy & Outsourcing segment data context — company list + selection.
 * Phase 1 only tracks companies (financials-only); Clients/Workforce/Deployments
 * (Phase 2) will extend CompanyData once real employee-deployment data exists.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import api from '../services/api';

export interface ConsultancyCompanyData {
  id: string;
  name: string;
  cashAvailable: number;
  status: string | null;
}

interface ConsultancyContextValue {
  companies: ConsultancyCompanyData[];
  loading: boolean;
  selectedCompanyId: string;
  setSelectedCompanyId: (id: string) => void;
  refetchCompanies: () => Promise<void>;
  createCompany: (name: string) => Promise<ConsultancyCompanyData>;
  deleteCompany: (id: string) => Promise<void>;
}

const Ctx = createContext<ConsultancyContextValue | null>(null);

function mapApiCompany(c: { id: string; name: string; cash_available: number; status: string | null }): ConsultancyCompanyData {
  return { id: c.id, name: c.name, cashAvailable: c.cash_available, status: c.status };
}

export function ConsultancyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<ConsultancyCompanyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');

  const refetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/consultancy/companies', { timeout: 45_000 });
      if (res.status === 200 && res.data?.companies) {
        setCompanies(res.data.companies.map(mapApiCompany));
      }
    } catch (e) {
      console.error('Failed to fetch consultancy companies:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refetchCompanies(); }, [refetchCompanies]);

  const createCompany = useCallback(async (name: string) => {
    const res = await api.post('/api/consultancy/companies', { name });
    const company = mapApiCompany(res.data);
    setCompanies(prev => [...prev, company]);
    return company;
  }, []);

  const deleteCompany = useCallback(async (id: string) => {
    await api.delete(`/api/consultancy/companies/${id}`);
    setCompanies(prev => prev.filter(c => c.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ companies, loading, selectedCompanyId, setSelectedCompanyId, refetchCompanies, createCompany, deleteCompany }}>
      {children}
    </Ctx.Provider>
  );
}

export function useConsultancy() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConsultancy must be used within ConsultancyProvider');
  return ctx;
}
