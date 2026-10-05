// Review-action gate helpers for /provider/applications/[id].
//
// These were originally exported from page.tsx, but Next.js forbids a page
// module from exporting anything other than the default component + the route
// segment config (metadata, dynamic, …) — `next build` fails with
// "<name> is not a valid Page export field". They live here so both the page
// and the V2-A test suite can import them without breaking the build.

import { CANONICAL_ROLES, normalizeRole } from '@/lib/constants/canonical-roles';

// DR-2: the action-panel buttons are only meaningful when the viewer is one
// of the canonical roles whose ROLE_TRANSITIONS map includes
// ASSIGNED_FOR_REVIEW -> DOC_APPROVED / REVISION_REQUESTED. The backend
// workflow-transition-service enforces this; the UI must not render an
// affordance that returns 400 for every other role. ADMIN keeps full
// visibility per the canonical admin override.
export const REVIEW_ACTION_ROLES: ReadonlySet<string> = new Set<string>([
  CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
  CANONICAL_ROLES.DOCUMENT_REVIEWER,
  CANONICAL_ROLES.FIELD_INSPECTOR,
]);

/**
 * DR-2: pure predicate — given a role string from the auth provider,
 * decide whether the action panel should expose Approve / Request
 * Revision buttons. Roles outside this set see the read-only notice
 * instead. Exported so the V2-A test suite can lock the contract
 * without mounting the whole client page.
 *
 * NB: the former `getReviewedStepsGate` / `REQUIRED_REVIEWED_STEPS` 9-step
 * Approve gate (REV-12) was removed 2026-06-23 (owner decision, pilot-simplify);
 * Approve is now gated only by role + the backend ownership/edge checks.
 */
export function viewerCanActOnReview(role: string | null | undefined): boolean {
  const canonical = normalizeRole(role);
  return canonical ? REVIEW_ACTION_ROLES.has(canonical) : false;
}
