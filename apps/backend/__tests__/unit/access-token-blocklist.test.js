/**
 * Access-Token Blocklist — Fail-Mode Policy (Sprint 8, 2026-05-16)
 *
 * SECURITY POLICY REGRESSION GUARD — DO NOT relax these tests.
 *
 * `isAccessTokenBlocklisted` MUST fail OPEN on Redis errors (return false)
 * AND MUST emit a structured high-severity SecOps audit event when it does.
 * The asymmetry with `isRefreshTokenBlocklisted` (which fails CLOSED) is a
 * documented, intentional Security-Lead decision — see the SECURITY POLICY
 * block in `token-revocation-service.js`.
 *
 * If a future contributor flips the fail mode without also updating the
 * SECURITY POLICY docstring AND the auth-middleware caller, these tests
 * will fail loudly. That is by design.
 *
 * Covers:
 *   1. Happy path — present token returns true, absent returns false.
 *   2. Defensive — empty/null jti returns false without touching Redis.
 *   3. FAIL-OPEN — store unavailable → returns false (NOT true).
 *   4. AUDIT EVENT — store unavailable → structured event emitted with the
 *      stable shape that the SIEM pipeline keys on.
 *   5. THROTTLE — repeated fail-opens for the same jti prefix within the
 *      throttle window emit only once (prevents log flooding).
 *   6. THROTTLE-SCOPED — fail-opens for DIFFERENT jti prefixes are NOT
 *      throttled against each other (one bad jti can't suppress others).
 *   7. NAMESPACE ISOLATION — access-token blocklist and refresh-token
 *      blocklist do not bleed into each other.
 */

jest.mock('../../shared/logger', () => {
    const mockLog = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    return {
        ...mockLog,
        createLogger: jest.fn(() => mockLog),
    };
});

// In-memory fake of redis-service. W1-5 (2026-08-22): this fake now mirrors
// the service's TWO contracts faithfully, because the previous version did
// not and that is precisely how the fail-open shipped.
//
//   CACHE contract      get/set/del  — NEVER throw. Unavailable === absent.
//   AUTHORITATIVE       *Strict      — REJECT with code REDIS_UNAVAILABLE
//                                     when the store cannot answer.
//
// Outages are simulated by flipping `mockRedisOutage.on`, not by making
// `get` throw. The real `get` cannot throw, so a test that mocked it
// throwing was asserting behaviour that did not exist in production — the
// fail-CLOSED branch it 'proved' was unreachable code. Driving the outage
// through the same switch the service actually has keeps that impossible.
// See __tests__/unit/redis-outage-fail-closed.test.js, which runs these
// same policies against the REAL redis-service with no mock at all.
const fakeStore = new Map();
const mockRedisOutage = { on: false, message: 'Redis cluster unreachable' };
function mockUnavailable(op) {
    const err = new Error(`Redis unavailable during ${op}: ${mockRedisOutage.message}`);
    err.code = 'REDIS_UNAVAILABLE';
    return err;
}
const mockRedisGet = jest.fn(async (key) => (mockRedisOutage.on ? null : (fakeStore.get(key) || null)));
const mockRedisSet = jest.fn(async (key, value /* , ttlSeconds */) => {
    if (mockRedisOutage.on) { return false; }
    fakeStore.set(key, value);
    return true;
});
const mockRedisDel = jest.fn(async (key) => {
    if (mockRedisOutage.on) { return false; }
    fakeStore.delete(key);
    return true;
});
const mockRedisGetStrict = jest.fn(async (key) => {
    if (mockRedisOutage.on) { throw mockUnavailable('GET'); }
    return fakeStore.get(key) || null;
});
const mockRedisSetStrict = jest.fn(async (key, value /* , ttlSeconds */) => {
    if (mockRedisOutage.on) { throw mockUnavailable('SET'); }
    fakeStore.set(key, value);
    return true;
});
const mockRedisDelStrict = jest.fn(async (key) => {
    if (mockRedisOutage.on) { throw mockUnavailable('DEL'); }
    fakeStore.delete(key);
    return true;
});

jest.mock('../../services/redis-service', () => ({
    get: (...args) => mockRedisGet(...args),
    set: (...args) => mockRedisSet(...args),
    del: (...args) => mockRedisDel(...args),
    getStrict: (...args) => mockRedisGetStrict(...args),
    setStrict: (...args) => mockRedisSetStrict(...args),
    delStrict: (...args) => mockRedisDelStrict(...args),
    client: null,
}));

const tokenRevocation = require('../../services/token-revocation-service');
const logger = require('../../shared/logger');

describe('[Sprint8] Access-Token Blocklist — fail-OPEN policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fakeStore.clear();
        // Reset the audit-alert throttle so each test starts clean.
        tokenRevocation._resetBlocklistOutageThrottle();
        // Every test starts with a HEALTHY store; the outage tests opt in.
        mockRedisOutage.on = false;
        mockRedisOutage.message = 'Redis cluster unreachable';
    });

    // ─────────────────────────────────────────────────────────────────
    // Happy path
    // ─────────────────────────────────────────────────────────────────

    it('returns false for an absent jti (token never blocklisted)', async () => {
        const result = await tokenRevocation.isAccessTokenBlocklisted('jti-never-seen');
        expect(result).toBe(false);
        expect(mockRedisGetStrict).toHaveBeenCalledTimes(1);
    });

    it('returns true after blocklistAccessToken writes the entry', async () => {
        await tokenRevocation.blocklistAccessToken('jti-revoked', 600);
        const result = await tokenRevocation.isAccessTokenBlocklisted('jti-revoked');
        expect(result).toBe(true);
    });

    it('returns false for empty / null / undefined jti without hitting Redis (defensive)', async () => {
        mockRedisGetStrict.mockClear();
        expect(await tokenRevocation.isAccessTokenBlocklisted('')).toBe(false);
        expect(await tokenRevocation.isAccessTokenBlocklisted(null)).toBe(false);
        expect(await tokenRevocation.isAccessTokenBlocklisted(undefined)).toBe(false);
        // No Redis round-trip when the input is falsy.
        expect(mockRedisGetStrict).not.toHaveBeenCalled();
    });

    // ─────────────────────────────────────────────────────────────────
    // FAIL-OPEN behaviour — the load-bearing security-policy assertion
    // ─────────────────────────────────────────────────────────────────

    it('fails OPEN (returns false) when Redis read throws — SECURITY POLICY REGRESSION GUARD', async () => {
        // If this test fails because the function returned `true`, do NOT
        // simply relax the assertion. Re-read the SECURITY POLICY block in
        // token-revocation-service.js — flipping to fail-CLOSED is a
        // platform-wide auth-availability change and requires Security
        // Lead sign-off and the caller update in auth-middleware.js.
        mockRedisOutage.on = true;

        const result = await tokenRevocation.isAccessTokenBlocklisted('jti-with-redis-down');
        expect(result).toBe(false);
    });

    it('asymmetry: refresh-token blocklist still fails CLOSED on same error (regression guard for the asymmetry)', async () => {
        // Belt-and-suspenders: ensure we have NOT accidentally aligned the
        // two policies. They are deliberately asymmetric — see the
        // SECURITY POLICY block in token-revocation-service.js.
        mockRedisOutage.on = true;

        const accessResult = await tokenRevocation.isAccessTokenBlocklisted('jti-a');
        expect(accessResult).toBe(false); // OPEN

        const refreshResult = await tokenRevocation.isRefreshTokenBlocklisted('jti-r');
        expect(refreshResult).toBe(true); // CLOSED
    });

    // ─────────────────────────────────────────────────────────────────
    // Audit event — structured, high-severity, with the stable shape
    // ─────────────────────────────────────────────────────────────────

    it('emits ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE structured audit event on fail-open', async () => {
        mockRedisOutage.on = true;
        mockRedisOutage.message = 'connection refused';

        // Test jti is intentionally longer than the 16-char truncation so we
        // can assert that the emitted jtiPrefix is properly truncated.
        const longJti = 'jti-abc123def456-extra-bytes-XYZ-001';
        await tokenRevocation.isAccessTokenBlocklisted(longJti);

        // Exactly one structured error-level event must have been emitted.
        expect(logger.error).toHaveBeenCalledTimes(1);
        const [message, payload] = logger.error.mock.calls[0];

        // Tag string is stable — SIEM may filter on it.
        expect(message).toBe('[SECURITY] ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE');

        // Stable shape — DO NOT change without updating SIEM mappings.
        expect(payload).toEqual(expect.objectContaining({
            securityEvent: true,
            event: 'ACCESS_TOKEN_BLOCKLIST_REDIS_OUTAGE',
            severity: 'CRITICAL',
            failMode: 'OPEN',
            timestamp: expect.any(String),
            jtiPrefix: expect.any(String),
            error: expect.stringContaining('connection refused'),
            recommendedAction: expect.stringContaining('Verify Redis health'),
        }));
        // Timestamp is a parseable ISO-8601 string.
        expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
        // jtiPrefix is truncated — must not equal the full jti (privacy guard
        // against leaking a hot credential identifier into SIEM long-term
        // storage). With the 16-char truncation, the prefix is strictly
        // shorter than the original jti.
        expect(payload.jtiPrefix.length).toBeLessThanOrEqual(16);
        expect(payload.jtiPrefix.length).toBeLessThan(longJti.length);
        expect(payload.jtiPrefix).not.toBe(longJti);
    });

    it('recommendedAction text mentions the SecOps playbook actions', async () => {
        mockRedisOutage.on = true;
        await tokenRevocation.isAccessTokenBlocklisted('jti-playbook-check');

        const payload = logger.error.mock.calls[0][1];
        // Operator-facing guidance must include the two key remediations:
        expect(payload.recommendedAction).toMatch(/revokeAllUserTokens/);
        expect(payload.recommendedAction).toMatch(/rotate.*JWT.*signing key/i);
    });

    // ─────────────────────────────────────────────────────────────────
    // Throttle — same jti within the window emits once
    // ─────────────────────────────────────────────────────────────────

    it('throttles repeat audit events for the same jti prefix within the throttle window', async () => {
        // Three back-to-back fail-opens for the same jti must produce
        // exactly ONE audit event. SIEM dashboards rely on this.
        mockRedisOutage.on = true;

        await tokenRevocation.isAccessTokenBlocklisted('jti-flood');
        await tokenRevocation.isAccessTokenBlocklisted('jti-flood');
        await tokenRevocation.isAccessTokenBlocklisted('jti-flood');

        expect(logger.error).toHaveBeenCalledTimes(1);

        // But the calls themselves all still failed open (returned false).
        // We re-call once more and verify the return value to make sure
        // throttling the *log* didn't accidentally change the *return value*.
        const result = await tokenRevocation.isAccessTokenBlocklisted('jti-flood');
        expect(result).toBe(false);
    });

    it('does NOT throttle audit events for DIFFERENT jti prefixes (per-jti scoping)', async () => {
        // One compromised jti must not silence alerts for other compromised
        // jtis during a Redis outage. The throttle is keyed by jti prefix.
        mockRedisOutage.on = true;

        await tokenRevocation.isAccessTokenBlocklisted('jti-AAAA-1111-2222');
        await tokenRevocation.isAccessTokenBlocklisted('jti-BBBB-3333-4444');
        await tokenRevocation.isAccessTokenBlocklisted('jti-CCCC-5555-6666');

        // Three distinct prefixes → three distinct events.
        expect(logger.error).toHaveBeenCalledTimes(3);
    });

    // ─────────────────────────────────────────────────────────────────
    // Namespace isolation — final cross-check
    // ─────────────────────────────────────────────────────────────────

    it('access and refresh blocklists use SEPARATE Redis namespaces', async () => {
        // Even if the same jti string appears in both code paths (it never
        // should at runtime — generators randomize independently — but we
        // assert isolation as a defence-in-depth guarantee), they MUST NOT
        // bleed into each other.
        await tokenRevocation.blocklistAccessToken('collision-jti');
        expect(await tokenRevocation.isRefreshTokenBlocklisted('collision-jti')).toBe(false);

        await tokenRevocation.blocklistRefreshToken('collision-jti-2');
        expect(await tokenRevocation.isAccessTokenBlocklisted('collision-jti-2')).toBe(false);
    });

    it('blocklistAccessToken writes under the auth:blocklist: prefix with TTL', async () => {
        await tokenRevocation.blocklistAccessToken('jti-write-check', 900);
        const writes = mockRedisSetStrict.mock.calls;
        expect(writes.length).toBeGreaterThanOrEqual(1);
        const accessWrite = writes.find(([key]) =>
            String(key).startsWith(tokenRevocation._ACCESS_BLOCKLIST_PREFIX));
        expect(accessWrite).toBeDefined();
        const [key, value, ttl] = accessWrite;
        expect(key).toBe(`${tokenRevocation._ACCESS_BLOCKLIST_PREFIX}jti-write-check`);
        expect(value).toMatchObject({ revokedAt: expect.any(String) });
        expect(ttl).toBe(900);
    });
});
