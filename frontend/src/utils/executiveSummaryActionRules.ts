import type { LoanRow, PortfolioSummary, CompanyRow, UnitRow } from '../hooks/useRentalCfoData';
import type { KpiData } from './rentalKpiEngine';
import type { OwnerRow } from '../hooks/useExecutiveSummaryData';
import { buildEmiStatusRows } from './executiveSummaryEmi';

const MARKET_RATE = 0.065;
const NOI_MARGIN_TARGET = 20;

export interface RiskActionRow {
  property: string;
  issue: string;
  kpi: string;
  impact: string;
  owner: string;
  dueDate: string;
  severity: 'critical' | 'warning';
}

function dueInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function buildRiskActionRows(params: {
  portfolio: PortfolioSummary | null;
  companies: CompanyRow[];
  loans: LoanRow[];
  units: UnitRow[];
  k: KpiData | null;
  collectionRate: number;
  ownership: OwnerRow[];
  arOverdue90: number;
}): RiskActionRow[] {
  const { portfolio, companies, loans, units, k, collectionRate, arOverdue90 } = params;
  const rows: RiskActionRow[] = [];
  const occ = (portfolio?.occupancy_pct ?? 0) * 100;

  if (occ > 0 && occ < 85) {
    rows.push({
      property: 'Portfolio',
      issue: 'Low occupancy',
      kpi: pct(occ),
      impact: 'Revenue shortfall vs GPR target',
      owner: 'Asset Management',
      dueDate: dueInDays(14),
      severity: 'critical',
    });
  } else if (occ > 0 && occ < 95) {
    rows.push({
      property: 'Portfolio',
      issue: 'Occupancy below target',
      kpi: `${pct(occ)} (target 95%)`,
      impact: 'Vacancy loss elevated',
      owner: 'Leasing',
      dueDate: dueInDays(30),
      severity: 'warning',
    });
  }

  const vacancyPct = 100 - occ;
  if (vacancyPct > 15 && occ > 0) {
    rows.push({
      property: 'Portfolio',
      issue: 'Vacancy above 15%',
      kpi: pct(vacancyPct),
      impact: 'GPR erosion',
      owner: 'Leasing',
      dueDate: dueInDays(21),
      severity: vacancyPct > 25 ? 'critical' : 'warning',
    });
  }

  if (collectionRate > 0 && collectionRate < 95) {
    rows.push({
      property: 'Portfolio',
      issue: 'Collection rate below target',
      kpi: `${pct(collectionRate)} (target 95%)`,
      impact: 'Cash flow timing risk',
      owner: 'Collections',
      dueDate: dueInDays(14),
      severity: collectionRate < 80 ? 'critical' : 'warning',
    });
  }

  if (arOverdue90 > 0) {
    rows.push({
      property: 'Portfolio',
      issue: 'AR 90+ days overdue',
      kpi: `$${Math.round(arOverdue90).toLocaleString()}`,
      impact: 'Bad debt / write-off risk',
      owner: 'Collections',
      dueDate: dueInDays(7),
      severity: 'critical',
    });
  }

  if (k && k.totalRevenue > 0) {
    const noiM = (k.noi / k.totalRevenue) * 100;
    if (noiM < NOI_MARGIN_TARGET) {
      rows.push({
        property: 'Portfolio',
        issue: 'NOI margin below target',
        kpi: `${pct(noiM)} (target ${NOI_MARGIN_TARGET}%)`,
        impact: 'Operating leverage compression',
        owner: 'CFO',
        dueDate: dueInDays(30),
        severity: noiM < 10 ? 'critical' : 'warning',
      });
    }
  }

  for (const l of loans) {
    const dscr = l.dscr ?? (
      l.noi_annual && l.loan_emi
        ? (l.noi_annual / 12) / l.loan_emi
        : null
    );
    const name = l.property_name || l.company_name;
    if (dscr != null && dscr < 1.1) {
      rows.push({
        property: name,
        issue: 'DSCR below covenant',
        kpi: `${dscr.toFixed(2)}x (min 1.2x)`,
        impact: 'Lender covenant breach risk',
        owner: 'CFO / Lender Relations',
        dueDate: dueInDays(21),
        severity: dscr < 1.0 ? 'critical' : 'warning',
      });
    }
    const bal = l.loan_balance_as_of ?? 0;
    const val = l.current_property_value ?? l.loan_amount ?? 0;
    if (val > 0 && bal / val > 0.75) {
      rows.push({
        property: name,
        issue: 'LTV above 75%',
        kpi: `${((bal / val) * 100).toFixed(1)}%`,
        impact: 'Refinance / collateral risk',
        owner: 'CFO',
        dueDate: dueInDays(45),
        severity: bal / val > 0.85 ? 'critical' : 'warning',
      });
    }
  }

  for (const r of buildEmiStatusRows(loans).filter(e => e.isOverdue)) {
    rows.push({
      property: r.loanName,
      issue: 'EMI overdue (due-date calendar)',
      kpi: r.emiAmount,
      impact: 'Late payment / covenant risk',
      owner: 'Treasury',
      dueDate: dueInDays(3),
      severity: 'critical',
    });
  }

  const highRate = loans.filter(l => (l.loan_interest_rate ?? 0) > MARKET_RATE);
  if (highRate.length > 0) {
    rows.push({
      property: highRate.map(l => l.property_name || l.company_name).join(', '),
      issue: 'Above-market interest rate',
      kpi: `${highRate.length} loan(s) > ${(MARKET_RATE * 100).toFixed(1)}%`,
      impact: 'Refinancing opportunity',
      owner: 'CFO',
      dueDate: dueInDays(60),
      severity: 'warning',
    });
  }

  for (const co of companies) {
    if (co.arrears_total > 0 && co.gross_potential_rent > 0) {
      const months = co.arrears_total / co.gross_potential_rent;
      if (months > 2) {
        rows.push({
          property: co.company_name,
          issue: 'Arrears > 2 months GPR',
          kpi: `$${Math.round(co.arrears_total).toLocaleString()}`,
          impact: 'Tenant default risk',
          owner: 'Collections',
          dueDate: dueInDays(14),
          severity: months > 3 ? 'critical' : 'warning',
        });
      }
    }
  }

  const vacantUnits = units.filter(u => (u.status ?? '').toLowerCase().includes('vacant'));
  if (vacantUnits.length > 0 && portfolio && portfolio.vacant_units > 0) {
    const avgDays = vacantUnits.reduce((s, u) => s + ((u as UnitRow & { days_vacant?: number }).days_vacant ?? 30), 0) / vacantUnits.length;
    if (avgDays > 45) {
      rows.push({
        property: 'Portfolio',
        issue: 'Extended vacancy duration',
        kpi: `${avgDays.toFixed(0)} days avg`,
        impact: 'Turn cost & lost rent',
        owner: 'Leasing',
        dueDate: dueInDays(21),
        severity: 'warning',
      });
    }
  }

  if (!rows.length && ownership.length === 0 && !portfolio) {
    return [];
  }
  return rows.slice(0, 12);
}
