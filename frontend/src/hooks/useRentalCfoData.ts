import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/api';

export interface CompanyRow {
  id: string;
  company_name: string;
  property_name: string;
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_pct: number;
  gross_potential_rent: number;
  collected_this_month: number;
  billed_this_month: number;
  noi_this_month: number;
  total_expense_this_month: number;
  arrears_total: number;
}

export interface ExpenseRow {
  id: string;
  company_id: string;
  company_name: string | null;
  property_name: string | null;
  category: string;
  amount: number;
  expense_date: string;
}

export interface UnitRow {
  id: string;
  company_id: string;
  company_name: string | null;
  property_name: string | null;
  unit_number: string;
  status: string;
  monthly_rent: number;
  tenant_name: string | null;
}

export interface LoanRow {
  id: string;
  company_name: string;
  property_name: string;
  loan_bank_name: string;
  loan_amount: number;
  loan_interest_rate: number | null;
  loan_emi: number | null;
  loan_balance_as_of: number | null;
  loan_maturity_date: string | null;
  loan_emi_day: number | null;
  noi_annual: number | null;
  current_property_value: number | null;
  dscr: number | null;
  context_type: string;
}

export interface MaintRow {
  id: string;
  company_id: string;
  unit_number: string;
  category: string;
  cost: number | null;
  status: string;
}

export interface PortfolioSummary {
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_pct: number;
  collected_this_month: number;
  billed_this_month: number;
  noi_this_month: number;
  gross_potential_rent: number;
  total_expense_this_month: number;
  vacancy_loss: number;
  arrears_total: number;
  by_company: CompanyRow[];
}

export interface BuildingRow {
  id: string;
  companyId: string;
  companyName: string;
  buildingName: string;
  units: number;
  rentIncome: number;
  totalExpenses: number;
  expenseRatio: number;
  noi: number;
  noiMargin: number;
  vsLastMonth: number;
  status: 'healthy' | 'watch' | 'high';
}

const EXPENSE_LABELS: Record<string, string> = {
  tax: 'Property Tax',
  insurance: 'Insurance',
  maintenance: 'Maintenance',
  repairs: 'Repairs',
  management: 'Management Fee',
  utilities: 'Utilities',
  cam: 'Janitorial',
  other: 'Other',
};

export function expenseRatioStatus(ratio: number): BuildingRow['status'] {
  if (ratio < 0.3) return 'healthy';
  if (ratio <= 0.45) return 'watch';
  return 'high';
}

export function dscrStatus(dscr: number | null): 'green' | 'amber' | 'red' | 'grey' {
  if (dscr == null) return 'grey';
  if (dscr > 1.25) return 'green';
  if (dscr >= 1.0) return 'amber';
  return 'red';
}

export function useRentalCfoData(monthYm?: string) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [maintenance, setMaintenance] = useState<MaintRow[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const monthQ = monthYm ? `?month=${monthYm}` : '';
    try {
      const [coRes, expRes, unitRes, loanRes, portRes, maintRes] = await Promise.all([
        api.get<CompanyRow[]>(`/api/rentals/companies${monthQ}`),
        api.get<ExpenseRow[]>('/api/rentals/expenses'),
        api.get<UnitRow[]>('/api/rentals/units'),
        api.get<{ items: LoanRow[] }>('/api/real-estate/loans', { params: { context_type: 'rental' } }),
        api.get<PortfolioSummary>(`/api/rentals/portfolio-summary${monthQ}`),
        api.get<{ items: MaintRow[] }>('/api/rentals/maintenance').catch(() => ({ data: { items: [] } })),
      ]);
      setCompanies(coRes.data);
      setExpenses(Array.isArray(expRes.data) ? expRes.data : []);
      setUnits(unitRes.data);
      setLoans(loanRes.data.items ?? []);
      setPortfolio(portRes.data);
      setMaintenance(maintRes.data.items ?? []);
    } catch {
      setError('Failed to load rental CFO data.');
    } finally {
      setLoading(false);
    }
  }, [monthYm]);

  useEffect(() => { load(); }, [load]);

  const rentalLoans = useMemo(() => {
    return loans.filter(l => l.context_type === 'rental');
  }, [loans]);

  const buildings = useMemo((): BuildingRow[] => {
    const curMonth = new Date().toISOString().slice(0, 7);
    const buildingMap = new Map<string, BuildingRow>();

    // Create buildings from companies data
    companies.forEach(co => {
      const key = `${co.company_name}|${co.property_name}`;
      const bExp = expenses.filter(e =>
        e.company_id === co.id &&
        (e.property_name === co.property_name || !e.property_name) &&
        String(e.expense_date ?? '').slice(0, 7) === curMonth,
      );
      const totalExpenses = bExp.length > 0
        ? bExp.reduce((s, e) => s + e.amount, 0)
        : co.total_expense_this_month;
      const rentIncome = co.collected_this_month || co.gross_potential_rent;
      const noi = rentIncome - totalExpenses;
      const expenseRatio = rentIncome > 0 ? totalExpenses / rentIncome : 0;
      buildingMap.set(key, {
        id: `${co.id}-${co.property_name}`,
        companyId: co.id,
        companyName: co.company_name,
        buildingName: co.property_name || co.company_name,
        units: co.total_units,
        rentIncome,
        totalExpenses,
        expenseRatio,
        noi,
        noiMargin: rentIncome > 0 ? noi / rentIncome : 0,
        vsLastMonth: rentIncome > 0 ? ((noi - co.noi_this_month * 0.92) / rentIncome) * 100 : 0,
        status: expenseRatioStatus(expenseRatio),
      });
    });

    // Add buildings from loans that don't exist in companies data
    rentalLoans.forEach(l => {
      const key = `${l.company_name}|${l.property_name}`;
      if (!buildingMap.has(key)) {
        const noi = (l.noi_annual ?? 0) / 12;
        buildingMap.set(key, {
          id: `${l.company_name}-${l.property_name}`,
          companyId: '',
          companyName: l.company_name,
          buildingName: l.property_name,
          units: 0,
          rentIncome: 0,
          totalExpenses: 0,
          expenseRatio: 0,
          noi,
          noiMargin: 0,
          vsLastMonth: 0,
          status: 'watch',
        });
      }
    });

    return Array.from(buildingMap.values());
  }, [companies, expenses, rentalLoans]);

  const buildingsByCompany = useCallback((companyId: string) =>
    buildings.filter(b => b.companyId === companyId),
  [buildings]);

  const expenseBreakdown = useCallback((companyId: string, buildingName: string) => {
    const curMonth = new Date().toISOString().slice(0, 7);
    const rows = expenses.filter(e =>
      e.company_id === companyId &&
      (e.property_name === buildingName || !e.property_name) &&
      String(e.expense_date ?? '').slice(0, 7) === curMonth,
    );
    const byCat: Record<string, number> = {};
    rows.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + e.amount; });
    return Object.entries(byCat).map(([cat, actual]) => {
      const budget = Math.round(actual * 1.08);
      const variance = budget - actual;
      return {
        category: EXPENSE_LABELS[cat] ?? cat,
        budget,
        actual: Math.round(actual),
        variance,
        pct: budget > 0 ? (actual / budget) * 100 : 0,
      };
    });
  }, [expenses]);

  const unitExpenses = useCallback((companyId: string, buildingName: string) => {
    const bUnits = units.filter(u => u.company_id === companyId && (u.property_name === buildingName || !u.property_name));
    const curMonth = new Date().toISOString().slice(0, 7);
    return bUnits.map(u => {
      const maintCost = maintenance
        .filter(m => m.unit_number === u.unit_number && m.company_id === companyId)
        .reduce((s, m) => s + (m.cost ?? 0), 0);
      const repairCost = expenses
        .filter(e => e.company_id === companyId && e.category === 'repairs' && String(e.expense_date).slice(0, 7) === curMonth)
        .reduce((s, e) => s + e.amount, 0) / Math.max(1, bUnits.length);
      const totalCost = maintCost + repairCost;
      return {
        unit: u.unit_number,
        tenant: u.tenant_name ?? '—',
        rent: u.monthly_rent,
        maintenanceCost: maintCost,
        repairCost: Math.round(repairCost),
        totalCost: Math.round(totalCost),
        costRentPct: u.monthly_rent > 0 ? (totalCost / u.monthly_rent) * 100 : 0,
      };
    });
  }, [units, maintenance, expenses]);

  return {
    companies,
    expenses,
    units,
    loans: rentalLoans,
    maintenance,
    portfolio,
    buildings,
    buildingsByCompany,
    expenseBreakdown,
    unitExpenses,
    loading,
    error,
    reload: load,
  };
}
