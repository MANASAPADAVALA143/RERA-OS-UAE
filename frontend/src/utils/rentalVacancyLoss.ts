/** Shared Rent Fixed / Vacancy / Expected (GPR) math — one source of truth. */

export type RentPotentialUnit = {
  status: string;
  monthly_rent?: number | null;
  agreed_lease_amount?: number | null;
  display_lease_amount?: number | null;
  vacancy_loss?: number | null;
};

/** Agreement / Rent Fixed stack (vacant potential + display fallthrough). */
export function unitLeaseAmount(u: {
  monthly_rent?: number | null;
  agreed_lease_amount?: number | null;
  display_lease_amount?: number | null;
}): number {
  if (u.agreed_lease_amount != null && u.agreed_lease_amount > 0) return u.agreed_lease_amount;
  if (u.display_lease_amount != null && u.display_lease_amount > 0) return u.display_lease_amount;
  return u.monthly_rent ?? 0;
}

/** Actual rent for an occupied unit — prefer monthly/register rent. */
export function unitOccupiedActualRent(u: RentPotentialUnit): number {
  if (u.status !== 'occupied') return 0;
  if (u.monthly_rent != null && u.monthly_rent > 0) return u.monthly_rent;
  return unitLeaseAmount(u);
}

/** Vacancy loss for one vacant unit — Rent Fixed / agreed lease from tenant details. */
export function unitVacancyLossAmount(u: RentPotentialUnit): number {
  if (u.status !== 'vacant') return 0;
  const lease = unitLeaseAmount(u);
  if (lease > 0) return lease;
  if (u.vacancy_loss != null && u.vacancy_loss > 0) return u.vacancy_loss;
  return 0;
}

/** Portfolio vacancy loss — sum of vacant-unit agreement rents only. */
export function portfolioVacancyLoss(units: RentPotentialUnit[]): number {
  return units.reduce((sum, u) => sum + unitVacancyLossAmount(u), 0);
}

/**
 * Expected Rent / Gross Potential Rent:
 *   Occupied actual rent (Monthly Rent) + Vacancy Loss (agreement on vacant)
 */
export function portfolioRentPotential(units: RentPotentialUnit[]): {
  occupiedRent: number;
  vacancyLoss: number;
  expectedRent: number;
} {
  const occupiedRent = units.reduce((s, u) => s + unitOccupiedActualRent(u), 0);
  const vacancyLoss = portfolioVacancyLoss(units);
  return {
    occupiedRent,
    vacancyLoss,
    expectedRent: occupiedRent + vacancyLoss,
  };
}
