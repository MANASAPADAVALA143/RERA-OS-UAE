/** 13-week rolling cash flow forecast for rental portfolio */

export interface ForecastAssumptions {
  collectionRate: number;
  expenseGrowthPct: number;
  vacancyFactor: number;
  openingCash: number;
}

export interface WeekForecastRow {
  week: number;
  startDate: string;
  openingCash: number;
  rentCollections: number;
  otherIncome: number;
  emiPayments: number;
  operatingExpenses: number;
  capex: number;
  netCashFlow: number;
  closingCash: number;
  isActual: boolean;
  status: 'green' | 'amber' | 'red';
}

export interface ForecastResult {
  weeks: WeekForecastRow[];
  closingCash: number;
  lowestWeek: number;
  lowestCash: number;
  totalCollections: number;
  totalObligations: number;
  confidence: 'High' | 'Medium' | 'Low';
  trend: 'Growing' | 'Stable' | 'Declining';
  bestCaseClosing: number;
  worstCaseClosing: number;
  runwayMonths: number;
}

export interface ForecastInputs {
  weeklyRentDue: number;
  weeklyOtherIncome: number;
  weeklyEmi: number;
  weeklyOpex: number;
  weeklyCapex: number;
  assumptions: ForecastAssumptions;
  startDate?: Date;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  r.setDate(r.getDate() - day);
  return r;
}

export function build13WeekForecast(inp: ForecastInputs): ForecastResult {
  const {
    weeklyRentDue,
    weeklyOtherIncome,
    weeklyEmi,
    weeklyOpex,
    weeklyCapex,
    assumptions,
  } = inp;

  const start = startOfWeek(inp.startDate ?? new Date());
  const weeks: WeekForecastRow[] = [];
  let cash = assumptions.openingCash;
  let totalCollections = 0;
  let totalObligations = 0;
  let lowestCash = cash;
  let lowestWeek = 1;

  for (let w = 1; w <= 13; w++) {
    const weekStart = addDays(start, (w - 1) * 7);
    const isActual = w <= 4;
    const growth = 1 + assumptions.expenseGrowthPct * (w - 1);
    const vacancyAdj = 1 - assumptions.vacancyFactor;

    const rentCollections = Math.round(
      weeklyRentDue * assumptions.collectionRate * vacancyAdj * (isActual ? 1 : 1),
    );
    const otherIncome = Math.round(weeklyOtherIncome * (isActual ? 1 : 0.98));
    const emiPayments = Math.round(weeklyEmi);
    const operatingExpenses = Math.round(weeklyOpex * growth);
    const capex = w % 4 === 0 ? Math.round(weeklyCapex) : 0;

    const inflows = rentCollections + otherIncome;
    const outflows = emiPayments + operatingExpenses + capex;
    const netCashFlow = inflows - outflows;
    const openingCash = cash;
    cash = openingCash + netCashFlow;

    totalCollections += inflows;
    totalObligations += outflows;

    if (cash < lowestCash) {
      lowestCash = cash;
      lowestWeek = w;
    }

    const status: WeekForecastRow['status'] =
      cash >= 100_000 ? 'green' : cash >= 50_000 ? 'amber' : 'red';

    weeks.push({
      week: w,
      startDate: weekStart.toISOString().slice(0, 10),
      openingCash,
      rentCollections,
      otherIncome,
      emiPayments,
      operatingExpenses,
      capex,
      netCashFlow,
      closingCash: cash,
      isActual,
      status,
    });
  }

  const closingCash = weeks[weeks.length - 1]?.closingCash ?? assumptions.openingCash;
  const opening = assumptions.openingCash;
  const trend: ForecastResult['trend'] =
    closingCash > opening * 1.05 ? 'Growing' : closingCash < opening * 0.95 ? 'Declining' : 'Stable';

  const avgWeeklyBurn = totalObligations / 13;
  const runwayMonths = avgWeeklyBurn > 0 ? closingCash / (avgWeeklyBurn * 4.33) : 99;

  return {
    weeks,
    closingCash,
    lowestWeek,
    lowestCash,
    totalCollections,
    totalObligations,
    confidence: assumptions.collectionRate >= 0.93 ? 'High' : assumptions.collectionRate >= 0.88 ? 'Medium' : 'Low',
    trend,
    bestCaseClosing: Math.round(closingCash * 1.15),
    worstCaseClosing: Math.round(closingCash * 0.85),
    runwayMonths: Math.round(runwayMonths * 10) / 10,
  };
}
