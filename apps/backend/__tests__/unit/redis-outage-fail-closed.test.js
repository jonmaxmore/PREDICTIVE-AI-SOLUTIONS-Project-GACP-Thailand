'use strict';

/**
 * REAL-redis-service outage semantics for authoritative security reads.
 *
 * WHY THIS FILE EXISTS (W1-5, 2026-08-22)
 * ────────────────────────────────────────────────────────────────────────
 * `access-token-blocklist.test.js` and `refresh-token-blocklist.test.js`
 * assert the fail-mode policy by `jest.mock`-ing redis-service with a `get`
 * that THROWS. The real `redis-service.get()` never throws: it returns
 * `null` when `isConnected === false` and `null` again from its own catch.
 * So the fail-CLOSED branch of `isRefreshTokenBlocklisted` was unreachable
 * in production and a Redis outage made every blocklisted refresh token
 * look valid for its full 7-day TTL. The mocked tests were green against
 * behaviour that did not exist.
 *
 * This suite deliberately does NOT mock redis-service. It stubs only
 * `ioredis` (a native dep that opens a socket on require) and drives the
 * REAL singleton into the two shapes a production outage actually takes:
 *
 *   (1) `isConnected = false`      — client never connected / connection dropped
 *   (2) client method REJECTS      — connected flag stale, socket broken
 *
 * Both must be indistinguishable to an authoritative caller: "the store
 * could not answer" — which is NOT the same as "the key is absent".
 *
 * Cache callers (cache-service, routes/api/documents/reports.js) keep the
 * graceful-degradation contract; that is asserted here too so the strict
 * accessors cannot be bolted onto `get()`/`set()` by accident later.
 */

// ioredis opens a TCP connection on require — stub it so the suite is hermetic.
jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn(),
})));

jest.mock('../../shared/logger', () => {
    const mockLog = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    return { ...mockLog, createLogger: jest.fn(() => mockLog) };
});

const redisService = require('../../services/redis-service');           // REAL
const tokenRevocation = require('../../services/token-revocation-service');
const logger = require('../../shared/logger');

// ── helpers ───────────────────────────────────────────────────────────────
const ORIGINAL_CLIENT = redisService.client;
const ORIGINAL_CONNECTED = redisService.isConnected;

/** Shape (1): the store never connected / the connection dropped. */
function simulateNotConnected() {
    redisService.isConnected = false;
    redisService.client = null;
}

/** Shape (2): `isConnected` is stale-true but every command rejects. */
function simulateBrokenSocket() {
    redisService.isConnected = true;
    redisService.client = {
        get: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
        set: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
        setex: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
        del: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
        quit: jest.fn(),
    };
}

/** Healthy in-memory store so happy paths still run against the real service. */
function simulateHealthy(seed = new Map()) {
    redisService.isConnected = true;
    redisService.client = {
        get: jest.fn(async (k) => (seed.has(k) ? seed.get(k) : null)),
        setex: jest.fn(async (k, _ttl, v) => { seed.set(k, v); return 'OK'; }),
        set: jest.fn(async (k, v) => { seed.set(k, v); return 'OK'; }),
        del: jest.fn(async (k) => { seed.delete(k); return 1; }),
        quit: jest.fn(),
    };
    return seed;
}

afterEach(() => {
    redisService.client = ORIGINAL_CLIENT;
    redisService.isConnected = ORIGINAL_CONNECTED;
    jest.clearAllMocks();
    tokenRevocation._resetBlocklistOutageThrottle();
});

// ══════════════════════════════════════════════════════════════════════════
describe('redis-service — strict accessors distinguish "unavailable" from "absent"', () => {
    it('exposes a strict read accessor (the capability authoritative callers need)', () => {
        expect(typeof redisService.getStrict).toBe('function');
        expect(typeof redisService.setStrict).toBe('function');
        expect(typeof redisService.RedisUnavailableError).toBe('function');
    });

    it('getStrict REJECTS when the store is not connected', async () => {
        simulateNotConnected();
        await expect(redisService.getStrict('auth:rt-blocklist:x')).rejects.toThrow(/unavailable/i);
    });

    it('getStrict REJECTS with code REDIS_UNAVAILABLE (stable machine identifier)', async () => {
        simulateNotConnected();
        await expect(redisService.getStrict('auth:rt-blocklist:x'))
            .rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    });

    it('getStrict REJECTS when the underlying client rejects (broken socket)', async () => {
        simulateBrokenSocket();
        await expect(redisService.getStrict('auth:rt-blocklist:x'))
            .rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    });

    it('getStrict never puts the raw key in the error message (keys carry jti/userId)', async () => {
        simulateNotConnected();
        const err = await redisService.getStrict('auth:rt-blocklist:SECRET-JTI-VALUE').catch((e) => e);
        expect(err.message).not.toContain('SECRET-JTI-VALUE');
    });

    it('getStrict RESOLVES null on a genuine miss (store healthy, key absent)', async () => {
        simulateHealthy();
        await expect(redisService.getStrict('auth:rt-blocklist:absent')).resolves.toBeNull();
    });

    it('getStrict RESOLVES the parsed value on a hit', async () => {
        simulateHealthy(new Map([['k', JSON.stringify({ a: 1 })]]));
        await expect(redisService.getStrict('k')).resolves.toEqual({ a: 1 });
    });

    it('setStrict REJECTS when the store is not connected', async () => {
        simulateNotConnected();
        await expect(redisService.setStrict('k', { v: 1 }, 60))
            .rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    });

    it('setStrict REJECTS when the underlying client rejects', async () => {
        simulateBrokenSocket();
        await expect(redisService.setStrict('k', { v: 1 }, 60))
            .rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    });

    it('setStrict RESOLVES true on a healthy write', async () => {
        const seed = simulateHealthy();
        await expect(redisService.setStrict('k', { v: 1 }, 60)).resolves.toBe(true);
        expect(seed.get('k')).toBe(JSON.stringify({ v: 1 }));
    });
});

describe('redis-service — cache callers keep graceful degradation (regression guard)', () => {
    it('get() still resolves null when not connected (never throws)', async () => {
        simulateNotConnected();
        await expect(redisService.get('reports:stats')).resolves.toBeNull();
    });

    it('get() still resolves null when the client rejects (never throws)', async () => {
        simulateBrokenSocket();
        await expect(redisService.get('reports:stats')).resolves.toBeNull();
    });

    it('set() still resolves false when not connected (never throws)', async () => {
        simulateNotConnected();
        await expect(redisService.set('reports:stats', { x: 1 }, 60)).resolves.toBe(false);
    });

    it('set() still resolves false when the client rejects (never throws)', async () => {
        simulateBrokenSocket();
        await expect(redisService.set('reports:stats', { x: 1 }, 60)).resolves.toBe(false);
    });

    it('setNX() still resolves false when not connected (dedupe degrades, no throw)', async () => {
        simulateNotConnected();
        await expect(redisService.setNX('notify:dedupe:a', { v: 1 }, 60)).resolves.toBe(false);
    });

    it('del() still resolves false when not connected (never throws)', async () => {
        simulateNotConnected();
        await expect(redisService.del('reports:stats')).resolves.toBe(false);
    });

    it('getOrSet() still falls through to the fetch fn when the store is down', async () => {
        simulateNotConnected();
        const fetchFn = jest.fn(async () => ({ fresh: true }));
        await expect(redisService.getOrSet('reports:stats', fetchFn, 60)).resolves.toEqual({ fresh: true });
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });
});

// ══════════════════════════════════════════════════════════════════════════
describe('token-revocation — refresh-token blocklist FAILS CLOSED on a real outage', () => {
    it('isRefreshTokenBlocklisted → TRUE when the store is not connected', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.isRefreshTokenBlocklisted('jti-rt-outage')).resolves.toBe(true);
    });

    it('isRefreshTokenBlocklisted → TRUE when the client rejects', async () => {
        simulateBrokenSocket();
        await expect(tokenRevocation.isRefreshTokenBlocklisted('jti-rt-outage')).resolves.toBe(true);
    });

    it('isRefreshTokenBlocklisted → FALSE on a genuine miss (store healthy)', async () => {
        simulateHealthy();
        await expect(tokenRevocation.isRefreshTokenBlocklisted('jti-rt-clean')).resolves.toBe(false);
    });

    it('isRefreshTokenBlocklisted → TRUE on a genuine hit (store healthy)', async () => {
        simulateHealthy();
        await tokenRevocation.blocklistRefreshToken('jti-rt-hit');
        await expect(tokenRevocation.isRefreshTokenBlocklisted('jti-rt-hit')).resolves.toBe(true);
    });

    it('still returns false for a falsy jti without touching the store', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.isRefreshTokenBlocklisted('')).resolves.toBe(false);
        await expect(tokenRevocation.isRefreshTokenBlocklisted(null)).resolves.toBe(false);
    });
});

describe('token-revocation — session-family blocklist FAILS CLOSED on a real outage', () => {
    it('isSessionFamilyBlocklisted → TRUE when the store is not connected', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.isSessionFamilyBlocklisted('fam-outage')).resolves.toBe(true);
    });

    it('isSessionFamilyBlocklisted → TRUE when the client rejects', async () => {
        simulateBrokenSocket();
        await expect(tokenRevocation.isSessionFamilyBlocklisted('fam-outage')).resolves.toBe(true);
    });

    it('isSessionFamilyBlocklisted → FALSE on a genuine miss (store healthy)', async () => {
        simulateHealthy();
        await expect(tokenRevocation.isSessionFamilyBlocklisted('fam-clean')).resolves.toBe(false);
    });

    it('invalidateSessionFamily REJECTS when the store is not connected (reuse-detection write must not be swallowed)', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.invalidateSessionFamily('fam-outage')).rejects.toThrow(/unavailable/i);
    });

    it('invalidateSessionFamily REJECTS when the client rejects', async () => {
        simulateBrokenSocket();
        await expect(tokenRevocation.invalidateSessionFamily('fam-outage')).rejects.toThrow(/unavailable/i);
    });

    it('invalidateSessionFamily still no-ops on a falsy familyId', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.invalidateSessionFamily(null)).resolves.toBeUndefined();
    });
});

describe('token-revocation — refresh-token ALLOWLIST fails closed on a real outage', () => {
    it('isRefreshTokenValid → FALSE when the store is not connected', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.isRefreshTokenValid('u1', 'tok1')).resolves.toBe(false);
    });

    it('isRefreshTokenValid → FALSE when the client rejects', async () => {
        simulateBrokenSocket();
        await expect(tokenRevocation.isRefreshTokenValid('u1', 'tok1')).resolves.toBe(false);
    });

    it('logs the outage instead of silently treating it as "not allowlisted"', async () => {
        simulateNotConnected();
        await tokenRevocation.isRefreshTokenValid('u1', 'tok1');
        const warned = logger.warn.mock.calls.some(([msg]) => /failing closed/i.test(String(msg)));
        expect(warned).toBe(true);
    });
});

describe('token-revocation — access-token blocklist keeps the documented fail-OPEN, but the alert MUST fire', () => {
    it('isAccessTokenBlocklisted → FALSE when the store is not connected (documented policy, unchanged)', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.isAccessTokenBlocklisted('jti-at-outage')).resolves.toBe(false);
    });

    it('emits ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE when the store is NOT CONNECTED (previously dead code)', async () => {
        simulateNotConnected();
        await tokenRevocation.isAccessTokenBlocklisted('jti-at-outage');
        const emitted = logger.error.mock.calls.find(
            ([, meta]) => meta && meta.event === 'ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE',
        );
        expect(emitted).toBeDefined();
        expect(emitted[1]).toMatchObject({
            securityEvent: true,
            severity: 'CRITICAL',
            failMode: 'OPEN',
        });
    });

    it('emits the same alert when the client rejects', async () => {
        simulateBrokenSocket();
        await tokenRevocation.isAccessTokenBlocklisted('jti-at-broken');
        const emitted = logger.error.mock.calls.find(
            ([, meta]) => meta && meta.event === 'ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE',
        );
        expect(emitted).toBeDefined();
    });

    it('does NOT emit the alert on a genuine miss (healthy store, absent key)', async () => {
        simulateHealthy();
        await tokenRevocation.isAccessTokenBlocklisted('jti-at-clean');
        const emitted = logger.error.mock.calls.find(
            ([, meta]) => meta && meta.event === 'ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE',
        );
        expect(emitted).toBeUndefined();
    });

    it('the alert never carries the full jti (truncated prefix only)', async () => {
        simulateNotConnected();
        const longJti = 'abcdefghijklmnopqrstuvwxyz0123456789';
        await tokenRevocation.isAccessTokenBlocklisted(longJti);
        const emitted = logger.error.mock.calls.find(
            ([, meta]) => meta && meta.event === 'ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE',
        );
        expect(emitted[1].jtiPrefix).toBe(longJti.slice(0, 16));
        expect(JSON.stringify(emitted[1])).not.toContain(longJti);
    });
});

describe('token-revocation — MFA challenge lookup fails closed on a real outage', () => {
    it('consumeMfaChallenge → null when the store is not connected (challenge cannot be honoured)', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.consumeMfaChallenge('chal-1')).resolves.toBeNull();
    });

    it('consumeMfaChallenge → null when the client rejects', async () => {
        simulateBrokenSocket();
        await expect(tokenRevocation.consumeMfaChallenge('chal-1')).resolves.toBeNull();
    });

    it('issueMfaChallenge REJECTS rather than handing back a challenge the store never persisted', async () => {
        simulateNotConnected();
        await expect(tokenRevocation.issueMfaChallenge('u1')).rejects.toThrow(/unavailable/i);
    });

    it('issueMfaChallenge → consumeMfaChallenge round-trips on a healthy store', async () => {
        simulateHealthy();
        const chal = await tokenRevocation.issueMfaChallenge('u-round');
        await expect(tokenRevocation.consumeMfaChallenge(chal)).resolves.toBe('u-round');
    });
});
