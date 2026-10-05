/**
 * entity-permission-denial.test.ts — Farm-worker Wave C adversarial-verify
 * MUST F2 / MUST F1(b): ONE shared detector for the Wave-B engine's 403
 * ENTITY_PERMISSION_DENIED envelope, covering EVERY real serialized shape
 * the backend ships (verified against the routes on 2026-07-03):
 *
 *   Shape A — Thai copy in `error`, machine code in `code`:
 *     farms.js:17-24 · harvest-batches.js:31-38 · planting-cycles.js:225-231
 *     · seed-sources/water-sources/fertilizer-records/controlled-environments
 *     { success:false, code:'ENTITY_PERMISSION_DENIED', permission, error:'<Thai>' }
 *
 *   Shape B — Thai copy in `message`, machine code in `code`:
 *     cultivation-log-controller.js:51-58 · plots.js:12-16
 *     (plant-unit-ownership.js:165-171 was listed here until 2026-08-25; that
 *     middleware was deleted with per-plant tracking — R8 of
 *     design note 2026-08-20-planting-tnt-design — so the two
 *     files above are now the whole of shape B)
 *     { success:false, code:'ENTITY_PERMISSION_DENIED', permission, message:'<Thai>' }
 *
 *   Shape C — legacy/engine serializers that put the CODE in `error`
 *     (api-client harvests rawCode = data.error || data.code, so this is the
 *     shape that would otherwise masquerade as a message).
 */

import {
    ENTITY_PERMISSION_DENIED_CODE,
    ENTITY_PERMISSION_DENIED_FALLBACK_TH,
    entityPermissionDenialMessage,
    isEntityPermissionDenialBody,
    isEntityPermissionDeniedResult,
} from '../entity-permission-denial';

const THAI_A = 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ในพื้นที่ทำงาน';
// Was 'คุณไม่มีสิทธิ์จัดการต้นปลูกในพื้นที่ทำงานนี้', the per-plant route's copy —
// retired with the route on 2026-08-25. Both surviving shape-B senders
// (cultivation-log-controller.js:56, plots.js:16) ship the SAME Thai sentence as
// shape A, so THAI_B now equals THAI_A on purpose: what separates the two shapes
// is which KEY carries the copy, never the copy itself. Inventing a distinct
// string here would have been a sentence the backend never sends.
const THAI_B = 'คุณไม่มีสิทธิ์ดำเนินการรายการนี้ในพื้นที่ทำงาน';

describe('isEntityPermissionDenialBody — raw backend JSON body', () => {
    it('detects shape A (code in `code`, Thai in `error`) — farms.js et al.', () => {
        expect(isEntityPermissionDenialBody({
            success: false,
            code: 'ENTITY_PERMISSION_DENIED',
            permission: 'FARM_CREATE',
            error: THAI_A,
        })).toBe(true);
    });

    it('detects shape B (code in `code`, Thai in `message`) — cultivation-log et al.', () => {
        expect(isEntityPermissionDenialBody({
            success: false,
            code: 'ENTITY_PERMISSION_DENIED',
            permission: 'ACTIVITY_IRRIGATION',
            message: THAI_B,
        })).toBe(true);
    });

    it('detects shape C (code in `error`) — legacy serializers', () => {
        expect(isEntityPermissionDenialBody({
            success: false,
            error: 'ENTITY_PERMISSION_DENIED',
            message: THAI_B,
        })).toBe(true);
    });

    it('rejects non-denial bodies (plain Forbidden, other codes, null, non-object)', () => {
        expect(isEntityPermissionDenialBody({ success: false, error: 'Forbidden' })).toBe(false);
        expect(isEntityPermissionDenialBody({ success: false, code: 'INVALID_REVIEWER_SIDE' })).toBe(false);
        expect(isEntityPermissionDenialBody(null)).toBe(false);
        expect(isEntityPermissionDenialBody(undefined)).toBe(false);
        expect(isEntityPermissionDenialBody('ENTITY_PERMISSION_DENIED')).toBe(false);
    });
});

describe('entityPermissionDenialMessage — the route\'s own Thai copy', () => {
    it('extracts the Thai copy from `error` (shape A)', () => {
        expect(entityPermissionDenialMessage({
            success: false, code: 'ENTITY_PERMISSION_DENIED', error: THAI_A,
        })).toBe(THAI_A);
    });

    it('extracts the Thai copy from `message` (shape B)', () => {
        expect(entityPermissionDenialMessage({
            success: false, code: 'ENTITY_PERMISSION_DENIED', message: THAI_B,
        })).toBe(THAI_B);
    });

    it('never surfaces the machine code itself as the message (shape C → message field)', () => {
        expect(entityPermissionDenialMessage({
            success: false, error: 'ENTITY_PERMISSION_DENIED', message: THAI_B,
        })).toBe(THAI_B);
    });

    it('returns null when the denial body carries no human copy at all', () => {
        expect(entityPermissionDenialMessage({
            success: false, error: 'ENTITY_PERMISSION_DENIED',
        })).toBeNull();
        expect(entityPermissionDenialMessage({ success: false, error: 'Forbidden' })).toBeNull();
    });
});

describe('isEntityPermissionDeniedResult — apiClient RESULT envelope (F1(b) eviction detector)', () => {
    it('true on status 403 + normalized ENTITY_PERMISSION_DENIED code', () => {
        expect(isEntityPermissionDeniedResult({
            success: false, status: 403, code: 'ENTITY_PERMISSION_DENIED',
        })).toBe(true);
    });

    it('false on other 403s (session guard / cross-side) — no over-eviction', () => {
        expect(isEntityPermissionDeniedResult({ success: false, status: 403, code: 'Forbidden' })).toBe(false);
        expect(isEntityPermissionDeniedResult({ success: false, status: 403 })).toBe(false);
    });

    it('false on non-403 statuses even with the code (defensive)', () => {
        expect(isEntityPermissionDeniedResult({ success: false, status: 500, code: 'ENTITY_PERMISSION_DENIED' })).toBe(false);
        expect(isEntityPermissionDeniedResult(null)).toBe(false);
        expect(isEntityPermissionDeniedResult(undefined)).toBe(false);
    });
});

describe('shared constants', () => {
    it('exports the canonical code and the generic Thai fallback', () => {
        expect(ENTITY_PERMISSION_DENIED_CODE).toBe('ENTITY_PERMISSION_DENIED');
        // R2 Task 10 round 3: the backend catalogue sentence (ERROR_CODES.ENTITY_PERMISSION_DENIED.messageTh).
        expect(ENTITY_PERMISSION_DENIED_FALLBACK_TH).toBe('คุณไม่มีสิทธิ์ทำรายการนี้ในนามของผู้ถือรายนี้ ขอให้เจ้าของมอบสิทธิ์ให้คุณก่อน แล้วลองอีกครั้ง');
        expect(ENTITY_PERMISSION_DENIED_FALLBACK_TH).not.toMatch(/workspace|พื้นที่ทำงาน/i);
    });
});
