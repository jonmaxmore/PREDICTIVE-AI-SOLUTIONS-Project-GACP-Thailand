/**
 * use-entity-permissions — Farm-worker Wave C chunk 3 (pure-logic TDD).
 *
 * The hook fetches GET /entities/:id/my-permissions for WORKSPACE contexts
 * (personal:false) and exposes has(permission) for FE operation-button
 * gating. The BE stays authoritative — FE gating is UX only, hence the
 * binding failure policy:
 *
 *   fail-OPEN to visible on fetch ERROR (hiding on a flaky fetch = false
 *   lockout) EXCEPT a 404 (not a member → hide); personal context →
 *   has() always true (solo farmer unchanged).
 *
 * Pure decision functions tested in isolation (repo convention — the React
 * hook just wires useActiveEntity + apiClient to them; its wiring is pinned
 * by the per-surface source-scan suites).
 */

import {
    NO_PERMISSION_TOOLTIP_TH,
    __clearEntityPermissionsCache,
    activityPermissionFor,
    computeCanLogSelectedActivity,
    computeHas,
    entityPermissionsCacheKey,
    evictEntityPermissionsOnDenial,
    peekEntityPermissionsSnapshot,
    resolveFetchOutcome,
    revalidateEntityPermissions,
    type EntityPermissionState,
} from '../use-entity-permissions';

describe('computeHas — failure policy', () => {
    const perm = 'HARVEST_RECORD';

    it('personal → always true (solo unchanged)', () => {
        expect(computeHas({ kind: 'personal' }, perm)).toBe(true);
    });
    it('loading → true (fail-open until resolved; BE authoritative)', () => {
        expect(computeHas({ kind: 'loading' }, perm)).toBe(true);
    });
    it('fetch error → true (fail-OPEN: hiding on flaky fetch = false lockout)', () => {
        expect(computeHas({ kind: 'error' }, perm)).toBe(true);
    });
    it('404 not-a-member → false (hide)', () => {
        expect(computeHas({ kind: 'not-member' }, perm)).toBe(false);
    });
    it('loaded → membership test on the effective set', () => {
        const loaded: EntityPermissionState = { kind: 'loaded', effective: ['UNIT_MANAGE'] };
        expect(computeHas(loaded, 'UNIT_MANAGE')).toBe(true);
        expect(computeHas(loaded, 'HARVEST_RECORD')).toBe(false);
    });
});

/**
 * Gap 25 — personal / loading / error all fail OPEN to visible (FE gating is
 * UX-only; the BE re-checks and answers 403 ENTITY_PERMISSION_DENIED).
 * R2: the hook's "no entity id given" case is pinned in
 * use-entity-permissions-hook.test.tsx.
 */
describe('Gap 25 — fail-open states are one outcome (BE authoritative)', () => {
    it('personal / loading / error ALL resolve to the same fail-OPEN (so re-labelling null cannot change the outcome)', () => {
        const perm = 'HARVEST_RECORD';
        expect(computeHas({ kind: 'personal' }, perm)).toBe(true);
        expect(computeHas({ kind: 'loading' }, perm)).toBe(true);
        expect(computeHas({ kind: 'error' }, perm)).toBe(true);
        // Only these two ever hide — a real workspace membership must resolve
        // first; null never reaches them.
        expect(computeHas({ kind: 'not-member' }, perm)).toBe(false);
        expect(computeHas({ kind: 'loaded', effective: [] }, perm)).toBe(false);
    });
});

describe('resolveFetchOutcome — apiClient envelope → state', () => {
    it('success + workspace payload → loaded with the effective set', () => {
        expect(resolveFetchOutcome({
            success: true,
            data: { entityId: 'e1', role: 'MANAGER', personal: false, effective: ['UNIT_MANAGE'] },
        })).toEqual({ kind: 'loaded', effective: ['UNIT_MANAGE'] });
    });
    it('success + personal payload → personal (has() always true)', () => {
        expect(resolveFetchOutcome({
            success: true,
            data: { entityId: 'e1', role: 'OWNER', personal: true, effective: [] },
        })).toEqual({ kind: 'personal' });
    });
    // F4 — only the ANTI-PROBE 404 hides: the route's JSON envelope
    // ({success:false, error:'Not Found'}) reaches the hook with a harvested
    // `.code`; an infra 404 (proxy/HTML/stripped body) has none and must
    // NOT read as a membership verdict.
    it('anti-probe 404 (JSON envelope → code harvested) → not-member (the ONE case that hides)', () => {
        expect(resolveFetchOutcome({ success: false, status: 404, code: 'Not Found' }))
            .toEqual({ kind: 'not-member' });
    });
    it('bare/infra 404 (no JSON envelope, no code) → error, not a lockout', () => {
        expect(resolveFetchOutcome({ success: false, status: 404 })).toEqual({ kind: 'error' });
        expect(resolveFetchOutcome({ success: false, status: 404, code: '   ' })).toEqual({ kind: 'error' });
    });
    it('any other failure (500 / network / empty body) → error (fail-OPEN)', () => {
        expect(resolveFetchOutcome({ success: false, status: 500 })).toEqual({ kind: 'error' });
        expect(resolveFetchOutcome({ success: false })).toEqual({ kind: 'error' });
        expect(resolveFetchOutcome({ success: true, data: undefined })).toEqual({ kind: 'error' });
    });
});

describe('activityPermissionFor — the 7 per-type codes', () => {
    it.each([
        ['IRRIGATION', 'ACTIVITY_IRRIGATION'],
        ['FERTILIZER', 'ACTIVITY_FERTILIZER'],
        ['PEST_CONTROL', 'ACTIVITY_PEST_CONTROL'],
        ['WEED_CONTROL', 'ACTIVITY_WEED_CONTROL'],
        ['INSPECTION', 'ACTIVITY_INSPECTION'],
        ['INCIDENT', 'ACTIVITY_INCIDENT'],
        ['OTHER', 'ACTIVITY_OTHER'],
    ])('%s → %s', (type, code) => {
        expect(activityPermissionFor(type)).toBe(code);
    });
    it('is case-tolerant on the form value', () => {
        expect(activityPermissionFor('irrigation')).toBe('ACTIVITY_IRRIGATION');
    });
    it('unknown type → null (no FE gate — the BE decides)', () => {
        expect(activityPermissionFor('SOMETHING_NEW')).toBeNull();
        expect(activityPermissionFor('')).toBeNull();
    });
});

describe('tooltip text', () => {
    it('is the exact owner-facing Thai copy', () => {
        expect(NO_PERMISSION_TOOLTIP_TH).toBe('ไม่มีสิทธิ์ ขอให้เจ้าของมอบสิทธิ์ให้คุณ');
    });
});

// Wave-C F5 — the activities submit gate was an inline expression pinned
// only by a presence scan (`canLogSelectedActivity` string match), so a
// polarity inversion kept every suite green. Extracted + truth-tabled.
describe('computeCanLogSelectedActivity — per-type submit gate (F5)', () => {
    const hasOnly = (granted: string) => (p: string) => p === granted;

    it('permission for the SELECTED type present → allowed', () => {
        expect(computeCanLogSelectedActivity('ACTIVITY_IRRIGATION', hasOnly('ACTIVITY_IRRIGATION'))).toBe(true);
    });

    it('permission for the SELECTED type absent → blocked (the inversion this test exists to catch)', () => {
        expect(computeCanLogSelectedActivity('ACTIVITY_IRRIGATION', hasOnly('ACTIVITY_FERTILIZER'))).toBe(false);
        expect(computeCanLogSelectedActivity('ACTIVITY_IRRIGATION', () => false)).toBe(false);
    });

    it('unknown/blank type (no catalog code) → no FE gate, the BE decides', () => {
        expect(computeCanLogSelectedActivity(null, () => false)).toBe(true);
    });
});

/**
 * Wave-C adversarial-verify MUST F1 — the module cache used to pin
 * 'loaded' AND 'not-member' TERMINALLY for the whole tab session:
 * REVOKE mid-session → enabled-but-always-403 buttons; GRANT → hidden
 * until hard reload — contradicting the matrix copy "มีผลกับคำขอถัดไปทันที".
 * The cache is now STALE-WHILE-REVALIDATE per mount + evict-on-denial.
 */
describe('SWR cache — revalidateEntityPermissions (F1(a))', () => {
    const userId = 'user-1';
    const entityId = 'entity-1';
    const cacheKey = entityPermissionsCacheKey(userId, entityId);

    const loadedEnvelope = (effective: string[]) => ({
        success: true,
        data: { entityId, role: 'MANAGER', personal: false, effective },
    });
    // The REAL anti-probe 404 as apiClient serves it (route body
    // {success:false,error:'Not Found'} → code harvested = 'Not Found').
    const notMemberEnvelope = { success: false, status: 404, code: 'Not Found', error: 'Not Found' };

    beforeEach(() => {
        __clearEntityPermissionsCache();
    });

    it('caches a loaded snapshot AND still refetches on the next mount, updating to the new effective set', async () => {
        const mockFetch = jest.fn()
            .mockResolvedValueOnce(loadedEnvelope(['HARVEST_RECORD']))
            .mockResolvedValueOnce(loadedEnvelope([]));

        // mount 1
        const first = await revalidateEntityPermissions(cacheKey, entityId, mockFetch);
        expect(first).toEqual({ kind: 'loaded', effective: ['HARVEST_RECORD'] });
        expect(peekEntityPermissionsSnapshot(cacheKey)).toEqual(first);

        // mount 2 — the cached snapshot serves instantly (peek), but the
        // refetch MUST fire and the state MUST update to the new effective
        // (REVOKE mid-session converges without a hard reload).
        const second = await revalidateEntityPermissions(cacheKey, entityId, mockFetch);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(second).toEqual({ kind: 'loaded', effective: [] });
        expect(peekEntityPermissionsSnapshot(cacheKey)).toEqual(second);
    });

    it("caches 'not-member' as revalidate-on-next-mount, NOT terminally (F1(c) — heals the infra-404 lockout)", async () => {
        const mockFetch = jest.fn()
            .mockResolvedValueOnce(notMemberEnvelope)
            .mockResolvedValueOnce(loadedEnvelope(['UNIT_MANAGE']));

        const first = await revalidateEntityPermissions(cacheKey, entityId, mockFetch);
        expect(first).toEqual({ kind: 'not-member' });
        expect(peekEntityPermissionsSnapshot(cacheKey)).toEqual({ kind: 'not-member' });

        // next mount MUST retry — and recover when the API answers.
        const second = await revalidateEntityPermissions(cacheKey, entityId, mockFetch);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(second).toEqual({ kind: 'loaded', effective: ['UNIT_MANAGE'] });
    });

    it("never caches 'error' (fail-open stays transient)", async () => {
        const mockFetch = jest.fn().mockResolvedValue({ success: false, status: 500 });
        const outcome = await revalidateEntityPermissions(cacheKey, entityId, mockFetch);
        expect(outcome).toEqual({ kind: 'error' });
        expect(peekEntityPermissionsSnapshot(cacheKey)).toBeNull();
    });

    it('keeps serving the existing snapshot when a REVALIDATION errors (stale beats flicker-open)', async () => {
        const mockFetch = jest.fn()
            .mockResolvedValueOnce(loadedEnvelope(['QR_GENERATE']))
            .mockRejectedValueOnce(new Error('network down'));

        await revalidateEntityPermissions(cacheKey, entityId, mockFetch);
        const second = await revalidateEntityPermissions(cacheKey, entityId, mockFetch);
        expect(second).toEqual({ kind: 'loaded', effective: ['QR_GENERATE'] });
        expect(peekEntityPermissionsSnapshot(cacheKey)).toEqual({ kind: 'loaded', effective: ['QR_GENERATE'] });
    });
});

describe('evict-on-denial — evictEntityPermissionsOnDenial (F1(b))', () => {
    const userId = 'user-1';
    const entityId = 'entity-1';
    const cacheKey = entityPermissionsCacheKey(userId, entityId);

    beforeEach(async () => {
        __clearEntityPermissionsCache();
        await revalidateEntityPermissions(cacheKey, entityId, jest.fn().mockResolvedValue({
            success: true,
            data: { entityId, role: 'MANAGER', personal: false, effective: ['HARVEST_RECORD'] },
        }));
    });

    it('a live 403 ENTITY_PERMISSION_DENIED evicts the (user, entity) snapshot → next mount refetches', () => {
        const evicted = evictEntityPermissionsOnDenial(
            { status: 403, code: 'ENTITY_PERMISSION_DENIED' },
            userId,
            entityId,
        );
        expect(evicted).toBe(true);
        expect(peekEntityPermissionsSnapshot(cacheKey)).toBeNull();
    });

    it('non-denial failures do NOT evict (no over-eviction on session-guard 403s / 500s)', () => {
        expect(evictEntityPermissionsOnDenial({ status: 403, code: 'Forbidden' }, userId, entityId)).toBe(false);
        expect(evictEntityPermissionsOnDenial({ status: 500, code: 'ENTITY_PERMISSION_DENIED' }, userId, entityId)).toBe(false);
        expect(evictEntityPermissionsOnDenial(null, userId, entityId)).toBe(false);
        expect(peekEntityPermissionsSnapshot(cacheKey)).toEqual({ kind: 'loaded', effective: ['HARVEST_RECORD'] });
    });

    it('no entityId → no-op false (personal context has nothing cached)', () => {
        expect(evictEntityPermissionsOnDenial({ status: 403, code: 'ENTITY_PERMISSION_DENIED' }, userId, '')).toBe(false);
    });
});

/**
 * W8 personal-workspace-team, item 4 — end-to-end capability-story proof:
 * a MANAGER member of a PERSONAL (INDIVIDUAL) workspace reaches the
 * planting-record surfaces and does NOT reach application-submission /
 * financial surfaces. Asserted against the actual capability LIST the API
 * would return for MANAGER (mirrored from apps/backend/services/
 * entity-service.js DEFAULT_PERMISSIONS_BY_ROLE.MANAGER, lines 204-207 —
 * PRINT_QR + MANAGER_FARM_OPERATIONS, lines 155-161), never against
 * hardcoded UI strings.
 *
 * Note the polarity: a hired worker (MANAGER) on the owner's INDIVIDUAL
 * entity is, BY DESIGN, a "workspace" context for THAT worker
 * (the server answers personal:false for them) — so the hook fetches
 * /my-permissions and gates on the real `effective` array.
 */
describe('W8 — MANAGER in a PERSONAL (INDIVIDUAL) workspace: reaches planting/harvest, not application/financial', () => {
    // Mirrors entity-service.js:204-207 (MANAGER = PRINT_QR +
    // MANAGER_FARM_OPERATIONS, i.e. FARM_OPERATION_CAPABILITIES minus
    // FARM_CREATE/EDIT_FARM minus SUBMIT_APPLICATION per NOT_A_ROLE_DEFAULT).
    const MANAGER_EFFECTIVE = [
        'PRINT_QR', 'CYCLE_CREATE', 'UNIT_MANAGE',
        'ACTIVITY_IRRIGATION', 'ACTIVITY_FERTILIZER', 'ACTIVITY_PEST_CONTROL',
        'ACTIVITY_WEED_CONTROL', 'ACTIVITY_INSPECTION', 'ACTIVITY_INCIDENT', 'ACTIVITY_OTHER',
        'HARVEST_RECORD', 'QR_GENERATE', 'RECORDS_MANAGE', 'REPORT_SUBMIT',
    ];

    it('the /my-permissions envelope for that MANAGER resolves to loaded+effective (not the personal fast-path)', () => {
        const state = resolveFetchOutcome({
            success: true,
            data: { entityId: 'e-personal-1', role: 'MANAGER', personal: false, effective: MANAGER_EFFECTIVE },
        });
        expect(state).toEqual({ kind: 'loaded', effective: MANAGER_EFFECTIVE });
    });

    it('reaches every planting/harvest recording surface (7 activity types + harvest + cycle/plot setup)', () => {
        const state: EntityPermissionState = { kind: 'loaded', effective: MANAGER_EFFECTIVE };
        for (const perm of [
            'CYCLE_CREATE', 'UNIT_MANAGE', 'HARVEST_RECORD', 'QR_GENERATE',
            'ACTIVITY_IRRIGATION', 'ACTIVITY_FERTILIZER', 'ACTIVITY_PEST_CONTROL',
            'ACTIVITY_WEED_CONTROL', 'ACTIVITY_INSPECTION', 'ACTIVITY_INCIDENT', 'ACTIVITY_OTHER',
        ]) {
            expect(computeHas(state, perm)).toBe(true);
        }
    });

    it('does NOT reach application submission or financial surfaces', () => {
        const state: EntityPermissionState = { kind: 'loaded', effective: MANAGER_EFFECTIVE };
        expect(computeHas(state, 'SUBMIT_APPLICATION')).toBe(false);
        expect(computeHas(state, 'VIEW_FINANCIAL')).toBe(false);
        // also cannot manage the workspace itself or edit the farm profile
        expect(computeHas(state, 'INVITE_MEMBER')).toBe(false);
        expect(computeHas(state, 'REVOKE_MEMBER')).toBe(false);
        expect(computeHas(state, 'EDIT_FARM')).toBe(false);
        expect(computeHas(state, 'FARM_CREATE')).toBe(false);
    });
});
