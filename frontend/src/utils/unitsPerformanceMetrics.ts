/**
 * Units performance metrics for live LTM tab parity (PDF + shared helpers).
 * Mirrors Rentals → Units → LTM Performance calculations.
 */
import { getPeriodFilterKeys, type Period } from './periodWindow';
import { portfolioRentPotential, unitLeaseAmount } from './rentalVacancyLoss';

const MNAME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface UnitsPerfUnit {
  id: string;
  unit_number: string;
  company_id?: string;
  company_name: string | null;
  property_name: string | null;
  status: string;
  monthly_rent?: number | null;
  agreed_lease_amount?: number | null;
  display_lease_amount?: number | null;
  arrears?: number | null;
  days_vacant?: number | null;
  unit_register_at?: string | null;
  rent_history?: Record<string, number> | null;
  vacancy_loss?: number | null;
}

export interface UnitLtmMetrics {
  marketRent: number;
  occMonths: number;
  vacMonths: number;
  totalMonths: number;
  collected: number;
  expected: number;
  lost: number;
  occPct: number;
  avgRent: number;
  trend: 'up' | 'down' | 'stable';
  action: string;
  maxConsecVacant: number;
  lastStatus: 'occupied' | 'vacant';
}

export interface UnitsPerformanceBundle {
  kpis: {
    totalUnits: number;
    occupied: number;
    vacant: number;
    occupiedRent: number;
    expected: number;
    lost: number;
    occRate: number;
    receivablePct: number | null;
    avgOccRent: number | null;
  };
  monthlyTrend: { month: string; collected: number; expected: number; lost: number }[];
  buildingChart: { name: string; collected: number; expected: number }[];
  crossSection: { name: string; lost: number; occPct: number }[];
  topRisk: {
    unit: string;
    building: string;
    company: string;
    occMonths: number;
    vacMonths: number;
    collected: number;
    expected: number;
    lost: number;
    occPct: number;
    avgRent: number;
    trend: string;
    action: string;
    score: number;
  }[];
  insights: { severity: 'critical' | 'warning' | 'info'; title: string; text: string }[];
  vacancyByCompany: { name: string; loss: number }[];
  avgRentByCompany: { name: string; avgRent: number }[];
}

function histMonthToKey(m: string): string {
  return m.includes('-') ? m.replace('-', ' ') : m;
}

function getAvailableMonths(units: UnitsPerfUnit[]): string[] {
  const set = new Set<string>();
  for (const u of units) {
    for (const m of Object.keys(u.rent_history ?? {})) set.add(m);
  }
  return [...set].sort((a, b) => {
    const [am, ay] = a.split(/[\s-]/);
    const [bm, by] = b.split(/[\s-]/);
    const ya = parseInt(ay, 10) || 0;
    const yb = parseInt(by, 10) || 0;
    if (ya !== yb) return ya - yb;
    return MNAME.indexOf(am) - MNAME.indexOf(bm);
  });
}

export function computeUnitLtm(unit: UnitsPerfUnit, months: string[]): UnitLtmMetrics {
  const hist = unit.rent_history ?? {};
  const monthData = months.filter(m => m in hist).map(m => ({
    month: m,
    rent: hist[m] ?? 0,
    status: ((hist[m] ?? 0) > 0 ? 'occupied' : 'vacant') as 'occupied' | 'vacant',
  }));

  const histValues = Object.values(hist).filter((v): v is number => v > 0);
  const marketRent = histValues.length > 0
    ? Math.max(...histValues, unit.monthly_rent ?? 0)
    : (unit.monthly_rent ?? 0);

  const totalMonths = monthData.length;
  const occMonths = monthData.filter(m => m.rent > 0).length;
  const vacMonths = totalMonths - occMonths;
  const collected = monthData.reduce((s, m) => s + m.rent, 0);
  const expected = marketRent * totalMonths;
  const lost = Math.max(0, expected - collected);
  const occPct = totalMonths > 0 ? Math.round((occMonths / totalMonths) * 100) : 0;
  const avgRent = occMonths > 0 ? Math.round(collected / occMonths) : 0;

  const lastN = (n: number) => monthData.slice(-n).filter(m => m.rent > 0).length;
  const trend: 'up' | 'down' | 'stable' =
    lastN(3) > lastN(6) - lastN(3) ? 'up' : lastN(3) < lastN(6) - lastN(3) ? 'down' : 'stable';

  let consecVacant = 0;
  let maxConsecVacant = 0;
  for (const m of monthData) {
    if (m.status === 'vacant') {
      consecVacant += 1;
      maxConsecVacant = Math.max(maxConsecVacant, consecVacant);
    } else {
      consecVacant = 0;
    }
  }

  const lastStatus = monthData.length > 0 ? monthData[monthData.length - 1].status : 'vacant';

  let action = 'Monitor';
  if (lastStatus === 'vacant' && maxConsecVacant >= 2) action = 'Offer discount';
  else if (avgRent > 0 && marketRent > 0 && avgRent < marketRent * 0.9) action = 'Review rent';
  else if (occPct === 100) action = 'Retain tenant';

  return {
    marketRent, occMonths, vacMonths, totalMonths, collected, expected, lost,
    occPct, avgRent, trend, action, maxConsecVacant, lastStatus,
  };
}

function priorityScore(ltm: UnitLtmMetrics): number {
  let s = 0;
  if (ltm.occPct < 50) s += 40;
  else if (ltm.occPct < 75) s += 20;
  else if (ltm.occPct < 90) s += 10;
  if (ltm.lost > 10000) s += 30;
  else if (ltm.lost > 5000) s += 15;
  else if (ltm.lost > 2000) s += 8;
  if (ltm.lastStatus === 'vacant') s += 20;
  if (ltm.maxConsecVacant >= 3) s += 10;
  return s;
}

export function buildUnitsPerformanceBundle(
  unitsIn: UnitsPerfUnit[],
  opts: {
    period?: Period | null;
    month?: number;
    year?: number;
    entityId?: string | 'portfolio';
  } = {},
): UnitsPerformanceBundle {
  const { period = 'Month', month = new Date().getMonth() + 1, year = new Date().getFullYear(), entityId = 'portfolio' } = opts;

  let units = unitsIn;
  if (entityId && entityId !== 'portfolio') {
    units = unitsIn.filter(u => u.company_id === entityId);
  }

  const dataMonths = getAvailableMonths(units);
  const selectedMonths = (() => {
    if (!period) return dataMonths;
    const keys = new Set(getPeriodFilterKeys(period, month, year));
    return dataMonths.filter(m => keys.has(histMonthToKey(m)));
  })();

  const allLtm = units.map(u => ({ unit: u, ltm: computeUnitLtm(u, selectedMonths) }));

  const occupiedUnits = units.filter(u => u.status === 'occupied');
  const vacantUnits = units.filter(u => u.status === 'vacant');
  const { occupiedRent, vacancyLoss: lostVacant, expectedRent: expectedAll } = portfolioRentPotential(units);
  const rentFixed = occupiedUnits.reduce((s, u) => s + unitLeaseAmount(u), 0)
    || units.reduce((s, u) => s + unitLeaseAmount(u), 0);
  const rentReceivable = units.reduce((s, u) => s + (Number(u.arrears) || 0), 0);
  const receivablePct = rentFixed > 0 ? (rentReceivable / rentFixed) * 100 : null;

  const totalUnits = units.length;
  const occupied = occupiedUnits.length;
  const vacant = vacantUnits.length;
  const expected = expectedAll > 0
    ? expectedAll
    : (allLtm.some(({ ltm }) => ltm.totalMonths > 0)
      ? allLtm.reduce((s, { ltm }) => s + ltm.expected, 0)
      : 0);
  const occRate = totalUnits > 0 ? occupied / totalUnits : 0;
  const avgOccRent = occupied > 0 ? occupiedRent / occupied : null;

  const monthlyTrend = selectedMonths.map(m => {
    let collected = 0;
    let expectedMo = 0;
    for (const { unit, ltm } of allLtm) {
      collected += (unit.rent_history ?? {})[m] ?? 0;
      expectedMo += ltm.marketRent;
    }
    return {
      month: m.split(/[\s-]/)[0],
      collected,
      expected: expectedMo,
      lost: Math.max(0, expectedMo - collected),
    };
  });

  const buildingMap: Record<string, { collected: number; expected: number }> = {};
  for (const { unit, ltm } of allLtm) {
    const key = (unit.property_name || unit.company_name || 'Unknown').slice(0, 28);
    if (!buildingMap[key]) buildingMap[key] = { collected: 0, expected: 0 };
    buildingMap[key].collected += ltm.collected;
    buildingMap[key].expected += ltm.expected;
  }
  const buildingChart = Object.entries(buildingMap)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.expected - a.expected);

  const crossSection = allLtm
    .filter(({ ltm }) => ltm.totalMonths > 0)
    .sort((a, b) => b.ltm.lost - a.ltm.lost)
    .slice(0, 14)
    .map(({ unit, ltm }) => ({
      name: unit.unit_number.length > 10 ? `${unit.unit_number.slice(0, 10)}…` : unit.unit_number,
      lost: ltm.lost,
      occPct: ltm.occPct,
    }));

  const topRisk = allLtm
    .filter(({ ltm }) => ltm.totalMonths > 0)
    .map(({ unit, ltm }) => ({
      unit: unit.unit_number,
      building: unit.property_name || '—',
      company: unit.company_name || '—',
      occMonths: ltm.occMonths,
      vacMonths: ltm.vacMonths,
      collected: ltm.collected,
      expected: ltm.expected,
      lost: ltm.lost,
      occPct: ltm.occPct,
      avgRent: ltm.avgRent,
      trend: ltm.trend === 'up' ? '↑' : ltm.trend === 'down' ? '↓' : '→',
      action: ltm.action,
      score: priorityScore(ltm),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const insights: UnitsPerformanceBundle['insights'] = [];
  for (const { unit, ltm } of allLtm) {
    if (ltm.totalMonths === 0) continue;
    const lbl = unit.unit_number;
    const building = unit.property_name ? ` · ${unit.property_name}` : '';
    if (ltm.occPct < 50 && ltm.lost > 3000) {
      insights.push({
        severity: 'critical',
        title: `Urgent discount review — ${lbl}${building}`,
        text: `${ltm.occPct}% occupancy · $${Math.round(ltm.lost).toLocaleString()} lost`,
      });
    } else if (ltm.avgRent > 0 && ltm.marketRent > 0 && ltm.avgRent > ltm.marketRent * 0.95 && ltm.occPct < 70) {
      insights.push({
        severity: 'warning',
        title: `Pricing review — ${lbl}${building}`,
        text: `High avg rent but ${ltm.occPct}% occupancy`,
      });
    } else if (unitLeaseAmount(unit) > 0 && (Number(unit.arrears) || 0) / unitLeaseAmount(unit) > 0.25) {
      const arPct = Math.round(((Number(unit.arrears) || 0) / unitLeaseAmount(unit)) * 100);
      insights.push({
        severity: 'warning',
        title: `Rent receivable — ${lbl}${building}`,
        text: `${arPct}% of agreement rent currently outstanding`,
      });
    } else if (ltm.occPct === 100 && ltm.totalMonths >= 3) {
      insights.push({
        severity: 'info',
        title: `Top performer — ${lbl}${building}`,
        text: `100% occupancy · $${Math.round(ltm.avgRent).toLocaleString()}/mo avg`,
      });
    }
  }

  const vacCoMap: Record<string, number> = {};
  const rentCoMap: Record<string, { rent: number; n: number }> = {};
  for (const u of units) {
    const name = (u.company_name || 'Unknown').slice(0, 28);
    if (u.status === 'vacant') {
      vacCoMap[name] = (vacCoMap[name] ?? 0) + (u.vacancy_loss ?? unitLeaseAmount(u));
    }
    if (u.status === 'occupied') {
      if (!rentCoMap[name]) rentCoMap[name] = { rent: 0, n: 0 };
      rentCoMap[name].rent += unitLeaseAmount(u) || (u.monthly_rent ?? 0);
      rentCoMap[name].n += 1;
    }
  }

  return {
    kpis: {
      totalUnits,
      occupied,
      vacant,
      occupiedRent,
      expected,
      lost: lostVacant,
      occRate,
      receivablePct,
      avgOccRent,
    },
    monthlyTrend,
    buildingChart: buildingChart.slice(0, 10),
    crossSection,
    topRisk,
    insights: insights.slice(0, 8),
    vacancyByCompany: Object.entries(vacCoMap)
      .map(([name, loss]) => ({ name, loss }))
      .sort((a, b) => b.loss - a.loss)
      .slice(0, 8),
    avgRentByCompany: Object.entries(rentCoMap)
      .map(([name, v]) => ({ name, avgRent: v.n > 0 ? v.rent / v.n : 0 }))
      .sort((a, b) => b.avgRent - a.avgRent)
      .slice(0, 8),
  };
}
