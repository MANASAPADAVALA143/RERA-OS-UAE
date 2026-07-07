/** Roles allowed to use KPI breakdown tools (must match backend KPI_REVIEWER_ROLES). */
export const KPI_REVIEWER_ROLES = new Set([
  'platform_admin',
  'internal_reviewer',
]);

export function isKpiReviewerRole(role: string | undefined | null): boolean {
  return !!role && KPI_REVIEWER_ROLES.has(role);
}
