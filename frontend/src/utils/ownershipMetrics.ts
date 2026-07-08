/** Partner-level IRR, equity multiple, and effective cap rate helpers for Ownership page. */

export interface CashFlowRow {
  date: string;
  amount: number;
  type?: string;
}

export interface PartnerReturnMetrics {
  irr: number | null;
  irrLabel: string;
  equityMultiple: number | null;
  equityMultipleLabel: string;
  hasRealDates: boolean;
}

function parseFlowDate(dateStr: string): Date | null {
  if (!dateStr || dateStr === '—' || dateStr === '-') return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Investor-perspective cash flow: contributions negative, distributions + terminal value positive. */
export function buildInvestorCashFlows(
  rows: CashFlowRow[],
  terminalValue: number,
): { date: Date; amount: number }[] | null {
  const flows: { date: Date; amount: number }[] = [];
  for (const row of rows) {
    const d = parseFlowDate(row.date);
    if (!d) return null;
    const isDistribution =
      row.amount < 0 ||
      /distribution|return of capital/i.test(row.type ?? '');
    flows.push({
      date: d,
      amount: isDistribution ? Math.abs(row.amount) : -Math.abs(row.amount),
    });
  }
  if (terminalValue > 0) {
    flows.push({ date: new Date(), amount: terminalValue });
  }
  flows.sort((a, b) => a.date.getTime() - b.date.getTime());
  return flows.length >= 2 ? flows : null;
}

/** XIRR via Newton-Raphson — returns annualized % or null. */
export function calcXIRR(flows: { date: Date; amount: number }[]): number | null {
  const hasIn = flows.some(f => f.amount > 0);
  const hasOut = flows.some(f => f.amount < 0);
  if (!hasIn || !hasOut) return null;

  const t0 = flows[0].date.getTime();
  const years = (d: Date) => (d.getTime() - t0) / (365.25 * 24 * 60 * 60 * 1000);
  const npv = (rate: number) =>
    flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, years(f.date)), 0);
  const dnpv = (rate: number) =>
    flows.reduce((s, f) => {
      const y = years(f.date);
      const factor = Math.pow(1 + rate, y);
      return s - (y * f.amount) / (factor * (1 + rate));
    }, 0);

  let rate = 0.1;
  for (let i = 0; i < 80; i++) {
    const v = npv(rate);
    if (Math.abs(v) < 1e-6) return rate * 100;
    const dv = dnpv(rate);
    if (!Number.isFinite(dv) || Math.abs(dv) < 1e-12) break;
    const next = rate - v / dv;
    if (!Number.isFinite(next) || next <= -0.99) break;
    if (Math.abs(next - rate) < 1e-8) return next * 100;
    rate = next;
  }
  return null;
}

export function calcEquityMultiple(
  capitalContributed: number,
  distributions: number,
  currentValue: number,
): number | null {
  if (capitalContributed <= 0) return null;
  return (distributions + currentValue) / capitalContributed;
}

export function partnerReturnMetrics(
  contribs: CashFlowRow[],
  capitalContributed: number,
  currentValue: number,
): PartnerReturnMetrics {
  const distributions = contribs
    .filter(c => c.amount < 0 || /distribution|return of capital/i.test(c.type ?? ''))
    .reduce((s, c) => s + Math.abs(c.amount), 0);

  const em = calcEquityMultiple(capitalContributed, distributions, currentValue);
  const emLabel = em !== null ? `${em.toFixed(2)}x` : '—';

  const flows = buildInvestorCashFlows(contribs, currentValue);
  if (!flows) {
    return {
      irr: null,
      irrLabel: 'N/A — insufficient date data',
      equityMultiple: em,
      equityMultipleLabel: emLabel,
      hasRealDates: false,
    };
  }

  const irr = calcXIRR(flows);
  return {
    irr,
    irrLabel: irr !== null ? `${irr.toFixed(1)}%` : 'N/A — insufficient date data',
    equityMultiple: em,
    equityMultipleLabel: emLabel,
    hasRealDates: true,
  };
}

export function portfolioEquityMultiple(
  partners: { capital: number; distributions: number; marketValue: number }[],
): number | null {
  const capital = partners.reduce((s, p) => s + p.capital, 0);
  if (capital <= 0) return null;
  const returned = partners.reduce((s, p) => s + p.distributions + p.marketValue, 0);
  return returned / capital;
}

export function portfolioIrr(
  partners: { metrics: PartnerReturnMetrics; weight: number }[],
): { irr: number | null; label: string } {
  const withIrr = partners.filter(p => p.metrics.irr !== null && p.weight > 0);
  if (!withIrr.length) {
    const anyReal = partners.some(p => p.metrics.hasRealDates);
    return {
      irr: null,
      label: anyReal ? 'N/A' : 'N/A — insufficient date data',
    };
  }
  const totalW = withIrr.reduce((s, p) => s + p.weight, 0);
  const wIrr = withIrr.reduce((s, p) => s + (p.metrics.irr ?? 0) * p.weight, 0) / totalW;
  return { irr: wIrr, label: `${wIrr.toFixed(1)}%` };
}

export function effectiveCapRate(noi: number, marketValue: number): number | null {
  if (marketValue <= 0 || !Number.isFinite(noi)) return null;
  return (noi / marketValue) * 100;
}
