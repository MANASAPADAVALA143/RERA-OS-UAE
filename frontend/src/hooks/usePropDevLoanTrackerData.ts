import { useEffect, useMemo } from 'react';
import { usePropDev } from '../contexts/PropertyDevContext';
import type { CompanyData, Loan } from '../contexts/PropertyDevContext';
import {
  isActivePropDevLoan,
  resolveAllPropDevLoans,
  pickNextUpcomingMaturity,
} from '../utils/propDevLoanMetrics';

export const PROPDEV_MARKET_RATE = 6.5;

export function usePropDevLoanTrackerData() {
  const { companies, loans: contextLoans, selectedCompanyId, refetchCompanies } = usePropDev();

  useEffect(() => {
    refetchCompanies();
  }, [refetchCompanies]);

  const allLoans = useMemo(
    () => resolveAllPropDevLoans(companies, contextLoans),
    [companies, contextLoans],
  );

  const scopedLoans = useMemo(() => {
    if (selectedCompanyId === 'all') return allLoans;
    return allLoans.filter(l => l.companyId === selectedCompanyId);
  }, [allLoans, selectedCompanyId]);

  const scopedCompanies = useMemo((): CompanyData[] => {
    if (selectedCompanyId === 'all') return companies;
    const c = companies.find(x => x.id === selectedCompanyId);
    return c ? [c] : [];
  }, [companies, selectedCompanyId]);

  const scopeLabel = useMemo(() => {
    if (selectedCompanyId === 'all') return 'All Companies';
    return companies.find(c => c.id === selectedCompanyId)?.name ?? 'Selected Company';
  }, [selectedCompanyId, companies]);

  const activeLoans = useMemo(
    () => scopedLoans.filter(isActivePropDevLoan),
    [scopedLoans],
  );

  const kpis = useMemo(() => {
    const loanTaken = scopedLoans.reduce((s, l) => s + (l.amount ?? 0), 0);
    const outstanding = activeLoans.reduce((s, l) => s + (l.balance ?? 0), 0);
    const emi = activeLoans.reduce((s, l) => s + (l.emi ?? 0), 0);
    const withBal = activeLoans.filter(l => l.balance > 0);
    const wAvg = withBal.length > 0
      ? withBal.reduce((s, l) => s + l.interestRate * l.balance, 0)
        / withBal.reduce((s, l) => s + l.balance, 0)
      : 0;
    const nextMat = pickNextUpcomingMaturity(scopedLoans);
    return {
      loanTaken,
      outstanding,
      emi,
      wAvg,
      nextMat,
      loanCount: scopedLoans.length,
      activeCount: activeLoans.length,
      totalCount: allLoans.length,
    };
  }, [scopedLoans, activeLoans, allLoans.length]);

  const debtByProperty = useMemo(() => {
    const map: Record<string, number> = {};
    scopedLoans.forEach(l => {
      const key = l.property || l.company || 'Unknown';
      map[key] = (map[key] ?? 0) + (l.balance ?? 0);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value, label: name.length > 18 ? `${name.slice(0, 16)}…` : name }))
      .sort((a, b) => b.value - a.value);
  }, [scopedLoans]);

  const emiByBank = useMemo(() => {
    const map: Record<string, number> = {};
    activeLoans.forEach(l => {
      const bank = l.bank || 'Unknown';
      map[bank] = (map[bank] ?? 0) + (l.emi ?? 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [activeLoans]);

  const maturityLadder = useMemo(() => {
    const map: Record<string, number> = {};
    scopedLoans.forEach(l => {
      if (!l.maturityDate) return;
      const year = l.maturityDate.slice(0, 4);
      map[year] = (map[year] ?? 0) + (l.balance ?? 0);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, amount]) => ({ year, amount }));
  }, [scopedLoans]);

  const rateVariance = useMemo(() => {
    return activeLoans
      .filter(l => l.interestRate != null)
      .map(l => ({
        name: (l.property || l.company || l.bank).slice(0, 20),
        bps: Math.round((l.interestRate - PROPDEV_MARKET_RATE) * 100),
        rate: l.interestRate,
      }));
  }, [activeLoans]);

  const companiesWithLoans = useMemo(
    () => companies.filter(c => allLoans.some(l => l.companyId === c.id)),
    [companies, allLoans],
  );

  return {
    companies,
    allLoans,
    scopedLoans,
    scopedCompanies,
    scopeLabel,
    activeLoans,
    kpis,
    debtByProperty,
    emiByBank,
    maturityLadder,
    rateVariance,
    companiesWithLoans,
    selectedCompanyId,
  };
}
