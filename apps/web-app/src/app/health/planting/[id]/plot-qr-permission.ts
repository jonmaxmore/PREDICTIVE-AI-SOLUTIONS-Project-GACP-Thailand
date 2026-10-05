/**
 * Wave B fix S11 (2026-07-03) — the cycle-detail loader AUTO-fires
 * plot-qrs/generate when QR rows are missing. For a workspace member without
 * QR_GENERATE (VIEWER / REVOKE'd worker) the backend correctly answers
 * 403 ENTITY_PERMISSION_DENIED — but the auto-fire turned that into a
 * spurious "Auto-generate plot QR failed" toast on EVERY page load.
 *
 * A permission denial on a background auto-fire is not an error the viewer
 * can act on — swallow it silently (the page still renders; the explicit
 * "generate" button keeps its own error surface). Every OTHER failure keeps
 * the warning toast.
 *
 * Wave-C adversarial-verify F2/F1(b): the shape detection now lives in the
 * SHARED detector (lib/api/entity-permission-denial.ts) — the api-client
 * normalizes denial results to code==='ENTITY_PERMISSION_DENIED'. This
 * endpoint-specific predicate stays broader on purpose: the only 403
 * plot-qrs/generate returns IS the permission gate, so a bare 403 counts.
 */

import {
  ENTITY_PERMISSION_DENIED_CODE,
  type PermissionDeniableApiResult,
} from '@/lib/api/entity-permission-denial';

/** Result envelope subset the predicate needs (ApiResponse-compatible). */
export type PermissionDeniableResult = PermissionDeniableApiResult;

/**
 * True when the failed result is the workspace per-permission denial:
 * HTTP 403 (the only 403 this endpoint returns is the ENTITY_PERMISSION
 * gate) or the normalized machine code when the transport surfaced it
 * without a status (shared constant — lib/api/entity-permission-denial.ts).
 */
export function isWorkspacePermissionDenied(result: PermissionDeniableResult | null | undefined): boolean {
  if (!result) return false;
  if (result.status === 403) return true;
  return result.code === ENTITY_PERMISSION_DENIED_CODE;
}
