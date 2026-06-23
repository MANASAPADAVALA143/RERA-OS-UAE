/** Occupancy helpers — vacant = total − occupied; rate = occupied / total */

export interface OccupancyStats {
  total: number;
  occupied: number;
  vacant: number;
  occupancyPct: number;
}

export function occupancyStats(
  units: ReadonlyArray<{ status: string }>,
): OccupancyStats {
  const total = units.length;
  const occupied = units.filter((u) => u.status === 'occupied').length;
  const vacant = total - occupied;
  const occupancyPct = total > 0 ? occupied / total : 0;
  return { total, occupied, vacant, occupancyPct };
}
