'use strict';

/**
 * H-3 (auth audit 2026-06-11) — provider-login brute-force lockout service.
 *
 * The privileged provider accounts (AUDITOR issues certs, PLATFORM_ADMIN
 * crosses tenants) previously had ONLY a per-IP limiter, defeated by IP
 * rotation. registerFailedProviderLogin / resetProviderLoginLock /
 * touchProviderLastLogin now maintain a per-account 5-strike / 15-min lock,
 * mirroring the HEALTH login path. This pins the DB writes.
 */

const mockUpdate = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/prisma-database', () => ({
    prisma: { user: { update: (...a) => mockUpdate(...a) } },
}));

const svc = require('../../services/provider-user-service');

describe('provider-login lockout service (H-3)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('threshold is 5 attempts / 15 minutes', () => {
        expect(svc.PROVIDER_MAX_LOGIN_ATTEMPTS).toBe(5);
        expect(svc.PROVIDER_LOCKOUT_MINUTES).toBe(15);
    });

    it('a non-final failed attempt increments the counter without locking', async () => {
        const out = await svc.registerFailedProviderLogin({ id: 'u1', loginAttempts: 2 });
        expect(out).toMatchObject({ attempts: 3, locked: false, lockedUntil: null });
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'u1' },
            data: { loginAttempts: 3 },
        });
    });

    it('the 5th failed attempt locks the account for 15 minutes', async () => {
        const before = Date.now();
        const out = await svc.registerFailedProviderLogin({ id: 'u1', loginAttempts: 4 });
        expect(out.attempts).toBe(5);
        expect(out.locked).toBe(true);
        const data = mockUpdate.mock.calls[0][0].data;
        expect(data.isLocked).toBe(true);
        expect(data.loginAttempts).toBe(5);
        // lockedUntil ~ now + 15min
        const delta = new Date(data.lockedUntil).getTime() - before;
        expect(delta).toBeGreaterThanOrEqual(14 * 60 * 1000);
        expect(delta).toBeLessThanOrEqual(16 * 60 * 1000);
    });

    it('treats a missing loginAttempts as 0 (first failure → attempt 1)', async () => {
        const out = await svc.registerFailedProviderLogin({ id: 'u1' });
        expect(out).toMatchObject({ attempts: 1, locked: false });
    });

    it('resetProviderLoginLock clears all three lock fields', async () => {
        await svc.resetProviderLoginLock('u1');
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'u1' },
            data: { loginAttempts: 0, isLocked: false, lockedUntil: null },
        });
    });

    it('a successful login (touchProviderLastLogin) also resets the lock counter', async () => {
        await svc.touchProviderLastLogin('u1');
        const data = mockUpdate.mock.calls[0][0].data;
        expect(data).toMatchObject({ loginAttempts: 0, isLocked: false, lockedUntil: null });
        expect(data.lastLoginAt).toBeInstanceOf(Date);
    });
});
