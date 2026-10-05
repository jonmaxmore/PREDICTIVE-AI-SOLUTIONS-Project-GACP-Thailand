/**
 * entity-permission-denial — ONE detector for the Wave-B workspace
 * per-permission gate's 403 envelope (Farm-worker Wave C adversarial-verify
 * MUST F2 + MUST F1(b)).
 *
 * The backend serializes the denial in more than one shape (verified against
 * the live routes 2026-07-03):
 *
 *   Shape A — Thai copy in `error`, machine code in `code`:
 *     routes/api/cultivation/farms.js:17-24 · harvest-batches.js:31-38 ·
 *     planting-cycles.js:225-231 · seed-sources / water-sources /
 *     fertilizer-records / controlled-environments
 *     { success:false, code:'ENTITY_PERMISSION_DENIED', permission, error:'<Thai>' }
 *
 *   Shape B — Thai copy in `message`, machine code in `code`:
 *     controllers/cultivation-log-controller.js:51-58 ·
 *     routes/api/helpers/plant-unit-ownership.js:165-171 · plots.js:12-16
 *     { success:false, code:'ENTITY_PERMISSION_DENIED', permission, message:'<Thai>' }
 *
 *   Shape C — the machine code itself in `error` (legacy serializers /
 *     generic error paths). CAREFUL: api-client harvests
 *     rawCode = data.error || data.code (api-client.ts request()), so for
 *     shape A the harvested `.code` would be the THAI MESSAGE — result-level
 *     consumers must rely on the NORMALIZED code the api-client denial
 *     branch sets, never on the raw harvest.
 *
 * Consumers:
 *   - api-client 403 branch: pass the route's own Thai copy through instead
 *     of the blanket "กรุณาเข้าสู่ระบบใหม่" rewrite (F2), normalizing `.code`.
 *   - use-entity-permissions evict-on-denial (F1(b)) + the plot-QR auto-fire
 *     suppressor (plot-qr-permission.ts) via isEntityPermissionDeniedResult.
 */

export const ENTITY_PERMISSION_DENIED_CODE = 'ENTITY_PERMISSION_DENIED';

/** Generic Thai copy when a denial body carries no human message. */
export const ENTITY_PERMISSION_DENIED_FALLBACK_TH =
    'ไม่มีสิทธิ์ดำเนินการนี้ ติดต่อเจ้าของ workspace';

/**
 * Detect the denial on the RAW backend JSON body (pre-envelope). Handles
 * all three serialized shapes above.
 */
export function isEntityPermissionDenialBody(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false;
    const rec = body as Record<string, unknown>;
    return (
        rec.code === ENTITY_PERMISSION_DENIED_CODE
        || rec.error === ENTITY_PERMISSION_DENIED_CODE
    );
}

/**
 * The route's own human (Thai) copy from a denial body — `error` (shape A)
 * or `message` (shape B), never the machine code itself. Null when the body
 * is not a denial or carries no human copy (caller falls back to
 * ENTITY_PERMISSION_DENIED_FALLBACK_TH).
 */
export function entityPermissionDenialMessage(body: unknown): string | null {
    if (!isEntityPermissionDenialBody(body)) return null;
    const rec = body as Record<string, unknown>;
    for (const key of ['error', 'message'] as const) {
        const value = rec[key];
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed && trimmed !== ENTITY_PERMISSION_DENIED_CODE) return trimmed;
        }
    }
    return null;
}

/** Result-envelope subset the post-apiClient detector needs. */
export interface PermissionDeniableApiResult {
    status?: number | undefined;
    code?: string | undefined;
}

/**
 * Detect the denial on an apiClient RESULT envelope. Relies on the
 * NORMALIZED `.code` the api-client denial branch sets (F2) — a bare 403
 * without the code (session guard, cross-side 403, HTML body) is NOT a
 * workspace denial, so cache eviction (F1(b)) never over-fires.
 */
export function isEntityPermissionDeniedResult(
    result: PermissionDeniableApiResult | null | undefined,
): boolean {
    if (!result) return false;
    return result.status === 403 && result.code === ENTITY_PERMISSION_DENIED_CODE;
}
