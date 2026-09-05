import type { CompanyData } from '../contexts/PropertyDevContext';
import { isActivePropDevLoan, normalizeInterestRatePercent, resolveLandValue } from './propDevLoanMetrics';
import { monthlyBurnFor } from './propDevDailyPulseData';
import type { PropDevCompanyOverviewKpis } from './propDevCompanyOverview';

const MARKET_RATE_PCT = 6.5;

export type ActionPriority = 'Critical' | 'Warning' | 'Info';

export interface ActionItem {
  id: string;
  priority: ActionPriority;
  title: string;
  entity: string;
  entityId: string;
  detail: string;
  nextStep: string;
  dueDate: string | null;
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

export function buildPropDevActionPlan(
  companies: CompanyData[],
  kpisById: Record<string, PropDevCompanyOverviewKpis>,
): ActionItem[] {
  const items: ActionItem[] = [];

  for (const c of companies) {
    const kpis = kpisById[c.id];
    const activeLoans = (c.loans ?? []).filter(isActivePropDevLoan);
    const burn = monthlyBurnFor(c);
    const cash = kpis?.cash ?? null;
    const runway = cash != null && burn != null && burn > 0 ? cash / burn : null;

    // 1. Critical — loan maturing <= 90 days
    for (const l of activeLoans) {
      if (!l.maturityDate) continue;
      const maturity = new Date(l.maturityDate);
      const days = Math.round((maturity.getTime() - Date.now()) / 86400000);
      if (days < 0 || days > 90) continue;
      items.push({
        id: `maturity:${l.id}`, priority: 'Critical', title: 'Loan Maturity Approaching',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — ${l.bank} loan matures ${fmtDate(maturity)} · ${fmtUsd(l.balance)} outstanding`,
        nextStep: `Initiate refinancing or extension — contact ${l.bank}`,
        dueDate: fmtDate(new Date(maturity.getTime() - 30 * 86400000)),
      });
    }

    // 2. Critical — LTLV > 80%
    if (kpis?.ltlv != null && kpis.ltlv > 80) {
      items.push({
        id: `ltlv:${c.id}`, priority: 'Critical', title: 'LTLV Above Lender Threshold',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — LTLV at ${kpis.ltlv.toFixed(0)}% above 80% lender threshold`,
        nextStep: 'Review with lender — consider partial paydown or revaluation',
        dueDate: null,
      });
    }

    // 3. Critical — cash runway < 3 months
    if (runway != null && runway < 3) {
      const shortfall = burn != null ? Math.max(0, burn * 6 - (cash ?? 0)) : 0;
      items.push({
        id: `runway:${c.id}`, priority: 'Critical', title: 'Low Cash Runway',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — ${runway.toFixed(1)} months runway at current burn rate`,
        nextStep: `Issue capital call immediately — ${fmtUsd(shortfall)} needed to cover 6 months operations`,
        dueDate: daysFromNow(7),
      });
    }

    // 4/6. Capital call overdue — >60d Critical, >30d Warning
    for (const cc of c.capitalCalls ?? []) {
      const outstanding = (cc.totalDue ?? 0) - (cc.received ?? 0);
      if (outstanding <= 0) continue;
      const due = cc.dueDate ? new Date(cc.dueDate) : null;
      const days = due ? Math.round((Date.now() - due.getTime()) / 86400000) : null;
      if (days == null || days < 30) continue;
      if (days > 60) {
        items.push({
          id: `call-critical:${cc.id}`, priority: 'Critical', title: 'Capital Call Severely Overdue',
          entity: c.name, entityId: c.id,
          detail: `${c.name} — ${cc.partnerName} · ${fmtUsd(outstanding)} · ${days} days overdue`,
          nextStep: 'Escalate to legal review — send formal notice',
          dueDate: daysFromNow(7),
        });
      } else {
        items.push({
          id: `call-warning:${cc.id}`, priority: 'Warning', title: 'Capital Call Outstanding',
          entity: c.name, entityId: c.id,
          detail: `${c.name} — ${cc.partnerName} · ${fmtUsd(outstanding)} · ${days} days`,
          nextStep: 'Send formal reminder with payment deadline',
          dueDate: daysFromNow(14),
        });
      }
    }

    // 5. Warning — high rate loan > 8%
    for (const l of activeLoans) {
      const rate = normalizeInterestRatePercent(l.interestRate);
      if (rate <= 8) continue;
      const savings = (rate - MARKET_RATE_PCT) / 100 * l.balance / 12;
      items.push({
        id: `rate:${l.id}`, priority: 'Warning', title: 'High Rate Loan',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — ${l.bank} at ${rate.toFixed(2)}% · est. savings ${fmtUsd(Math.max(0, savings))}/mo if refinanced to market rate ${MARKET_RATE_PCT}%`,
        nextStep: 'Get competing quotes from 2-3 lenders',
        dueDate: null,
      });
    }

    // 7. Warning — lender concentration 100%
    const byLender = new Map<string, number>();
    for (const l of activeLoans) byLender.set(l.bank, (byLender.get(l.bank) ?? 0) + (l.balance || 0));
    if (byLender.size === 1 && activeLoans.length > 0) {
      const [bank, amt] = [...byLender.entries()][0];
      items.push({
        id: `concentration:${c.id}`, priority: 'Warning', title: 'Lender Concentration Risk',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — 100% exposure to ${bank} · ${fmtUsd(amt)}`,
        nextStep: 'Explore secondary lender relationships',
        dueDate: null,
      });
    }

    // 8. Warning — negative NOI
    if (kpis?.netIncome != null && kpis.netIncome < 0) {
      items.push({
        id: `noi:${c.id}`, priority: 'Warning', title: 'Negative NOI',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — NOI (${fmtUsd(Math.abs(kpis.netIncome))}) this period`,
        nextStep: 'Review expense categories — identify deferrable items',
        dueDate: null,
      });
    }

    // 9. Info — EMI due within 14 days
    const today = new Date().getDate();
    for (const l of activeLoans) {
      if (!l.emiDate) continue;
      const daysUntil = l.emiDate - today;
      if (daysUntil < 0 || daysUntil > 14) continue;
      items.push({
        id: `emi:${l.id}`, priority: 'Info', title: 'EMI Due Soon',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — ${l.bank} · ${fmtUsd(l.emi)} due day ${l.emiDate}`,
        nextStep: 'Confirm funds available in operating account',
        dueDate: daysFromNow(daysUntil),
      });
    }

    // 10. Info — refinancing opportunity (rate above market but under the Warning threshold)
    for (const l of activeLoans) {
      const rate = normalizeInterestRatePercent(l.interestRate);
      if (rate <= MARKET_RATE_PCT || rate > 8) continue;
      items.push({
        id: `refi:${l.id}`, priority: 'Info', title: 'Refinancing Opportunity',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — ${l.bank} at ${rate.toFixed(2)}% · ${Math.round((rate - MARKET_RATE_PCT) * 100)}bps above market`,
        nextStep: 'Request rate review or explore refinancing',
        dueDate: null,
      });
    }

    // 11. Info — partner distribution due (positive NOI, no active loans in distress, no overdue calls)
    if (kpis?.netIncome != null && kpis.netIncome > 0 && (c.partners ?? []).length > 0) {
      const land = resolveLandValue(c);
      void land;
      items.push({
        id: `distribution:${c.id}`, priority: 'Info', title: 'Partner Distribution Due',
        entity: c.name, entityId: c.id,
        detail: `${c.name} — distributable NOI: ${fmtUsd(kpis.netIncome)} available`,
        nextStep: 'Prepare distribution schedule for partner approval',
        dueDate: null,
      });
    }
  }

  const rank: Record<ActionPriority, number> = { Critical: 0, Warning: 1, Info: 2 };
  items.sort((a, b) => rank[a.priority] - rank[b.priority]);
  return items;
}
