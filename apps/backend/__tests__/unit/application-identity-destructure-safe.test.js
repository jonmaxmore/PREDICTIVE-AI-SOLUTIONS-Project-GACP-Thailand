/**
 * Regression guard for the carpet-found BUG-1 (2026-06-05): the identity
 * resolver methods were object methods using `this.normalizeIdentityValue`, so
 * DESTRUCTURING them off the service (as routes/api/applications/revision-
 * deadline.js did) dropped the `this` binding and threw
 * "this.normalizeIdentityValue is not a function" at runtime → HTTP 500.
 *
 * After the closure refactor, every method must work when destructured. These
 * tests call each method via a destructured reference (the exact failure mode).
 */

'use strict';

const { createApplicationIdentityMethods } = require('../../services/application-service/application-identity-methods');

const HEALTH_ID = '1186494077533';
const USER_UUID = '4a940550-4bd4-43e9-95c6-dd1e3e798dcd';

function makeMethods() {
    return createApplicationIdentityMethods({
        prisma: {
            user: {
                findFirst: async () => ({ id: USER_UUID, healthId: HEALTH_ID }),
            },
        },
        logger: { warn() {} },
        findUserByHealthIdSecurely: async () => ({ id: USER_UUID, healthId: HEALTH_ID }),
    });
}

describe('[carpet BUG-1] identity methods are destructure-safe (no `this` dependency)', () => {
    it('normalizeIdentityValue works when destructured', () => {
        const { normalizeIdentityValue } = makeMethods();
        expect(normalizeIdentityValue('  abc  ')).toBe('abc');
        expect(normalizeIdentityValue('')).toBeNull();
    });


    it('resolveHealthIdentity works when destructured (the exact BUG-1 call shape)', async () => {
        const { resolveHealthIdentity } = makeMethods();
        const r = await resolveHealthIdentity(USER_UUID, { healthId: HEALTH_ID });
        expect(r).toEqual({ userId: USER_UUID, healthId: HEALTH_ID });
    });

    it('resolveHealthUserId / resolveHealthId work when destructured', async () => {
        const { resolveHealthUserId, resolveHealthId } = makeMethods();
        expect(await resolveHealthUserId(USER_UUID, { healthId: HEALTH_ID })).toBe(USER_UUID);
        expect(await resolveHealthId(USER_UUID, { healthId: HEALTH_ID })).toBe(HEALTH_ID);
    });

    it('does NOT throw "this.normalizeIdentityValue is not a function" (the original 500)', async () => {
        const { resolveHealthIdentity } = makeMethods();
        await expect(resolveHealthIdentity(USER_UUID, { healthId: HEALTH_ID })).resolves.toBeDefined();
    });
});
