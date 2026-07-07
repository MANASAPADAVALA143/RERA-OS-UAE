/** Roles allowed to use KPI breakdown tools (must match backend KPI_REVIEWER_ROLES). */
export const KPI_REVIEWER_ROLES = new Set([
  'platform_admin',
  'internal_reviewer',
]);

/** CA firm operator emails — Calculations Review (matches backend kpi_reviewer_emails). */
export const KPI_REVIEWER_EMAILS = new Set([
  'consulting.akk@gmail.com',
  'consultingakk@gmail.com',
]);

export function isKpiReviewerRole(role: string | undefined | null): boolean {
  return !!role && KPI_REVIEWER_ROLES.has(role);
}

export function isKpiReviewerEmail(email: string | undefined | null): boolean {
  return !!email && KPI_REVIEWER_EMAILS.has(email.trim().toLowerCase());
}
