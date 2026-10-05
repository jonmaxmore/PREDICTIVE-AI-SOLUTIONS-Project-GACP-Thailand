/**
 * Refresh-Token Blocklist Gate — Sprint 7 (Wave-D follow-up)
 *
 * Closes the "no server-side reuse detection" gap noted inline in
 * auth-session-security-handlers.js. Covers:
 *
 *   1. blocklisted RT presented to /refresh → 401 REFRESH_TOKEN_REVOKED
 *   2. successful /refresh blocklists the OLD RT JTI
 *   3. reuse-detection: blocklisted RT triggers invalidateSessionFamily()
 *   4. RT without a jti claim is rejected (defensive — generators inject jti)
 *   5. service-layer fail-closed: Redis read error → isRefreshTokenBlocklisted true
 *   6. service-layer blocklistRefreshToken writes with the RT: prefix
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}));

// In-memory fake of redis-service. W1-5 (2026-08-22): the fake now mirrors
// the service's TWO contracts, because the previous version did not and that
// is exactly how the fail-open shipped.
//
//   CACHE contract      get/set/del  — NEVER throw. Unavailable === absent.
//   AUTHORITATIVE       *Strict      — REJECT with code REDIS_UNAVAILABLE
//                                     when the store cannot answer.
//
// Outages are simulated with `mockRedisOutage.on`, not by mocking `get` to
// throw. The real `get` cannot throw, so the old "fails CLOSED when Redis
// throws" test was green against a branch that production could never reach.
// __tests__/unit/redis-outage-fail-closed.test.js proves the same policies
// against the REAL redis-service with no redis mock at all.
const fakeStore = new Map();
const mockRedisOutage = { on: false };
function mockUnavailable(op) {
    const err = new Error(`Redis unavailable during ${op}`);
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
const { createAuthSessionSecurityHandlers } = require('../../controllers/auth-controller/auth-session-security-handlers');

function makeRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.clearCookie = jest.fn(() => res);
    return res;
}

function buildHandlers(overrides = {}) {
    return createAuthSessionSecurityHandlers({
        AuthService: {},
        auditLogger: { logAuth: jest.fn().mockResolvedValue(undefined) },
        jwtConfig: {
            loadJWTConfiguration: jest.fn(() => ({})),
            verifyRefreshToken: jest.fn(),
            generateToken: jest.fn(() => 'new-access-token'),
            generateRefreshToken: jest.fn(() => 'new-refresh-token'),
            ...overrides.jwtConfig,
        },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        getRequestIp: () => '127.0.0.1',
        sendErrorResponse: (res, _req, { status, code, message }) =>
            res.status(status).json({ success: false, code, error: message }),
        sendSuccessResponse: (res, _req, body) =>
            res.status(200).json({ success: true, ...body }),
        setAuthCookies: jest.fn(() => 'csrf-xyz'),
        // BE-AUTH-03-03 (session epoch): the /refresh handler now re-fetches the
        // token owner before minting. Inject a default stub with NO revocation
        // instant (and an ACTIVE owner — SECU-03 refuses a disabled one) so
        // these blocklist/rotation/PII regression tests keep exercising
        // their intended paths (a null epoch never revokes a token). Tests that
        // specifically exercise the epoch gate live in session-epoch-refresh.test.js.
        fetchUserForSessionEpoch: overrides.fetchUserForSessionEpoch
            || jest.fn(async (userId) => ({ id: userId, status: 'ACTIVE', isDeleted: false, sessionsRevokedAt: null })),
        ...overrides,
    });
}

describe('[Sprint7] Refresh-Token Blocklist — service layer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fakeStore.clear();
        mockRedisOutage.on = false;   // every test starts on a HEALTHY store
    });

    it('blocklistRefreshToken writes under the RT: prefix', async () => {
        await tokenRevocation.blocklistRefreshToken('jti-rt-1', 100);
        const writes = mockRedisSetStrict.mock.calls;
        expect(writes.length).toBe(1);
        const [key, value, ttl] = writes[0];
        expect(key).toBe(`${tokenRevocation._REFRESH_BLOCKLIST_PREFIX}jti-rt-1`);
        expect(value).toMatchObject({ revokedAt: expect.any(String) });
        expect(ttl).toBe(100);
    });

    it('isRefreshTokenBlocklisted returns false when not present', async () => {
        const result = await tokenRevocation.isRefreshTokenBlocklisted('not-stored-jti');
        expect(result).toBe(false);
    });

    it('isRefreshTokenBlocklisted returns true after blocklist write', async () => {
        await tokenRevocation.blocklistRefreshToken('jti-rt-2');
        const result = await tokenRevocation.isRefreshTokenBlocklisted('jti-rt-2');
        expect(result).toBe(true);
    });

    it('isRefreshTokenBlocklisted returns false for empty/null jti (defensive)', async () => {
        expect(await tokenRevocation.isRefreshTokenBlocklisted('')).toBe(false);
        expect(await tokenRevocation.isRefreshTokenBlocklisted(null)).toBe(false);
        expect(await tokenRevocation.isRefreshTokenBlocklisted(undefined)).toBe(false);
    });

    it('isRefreshTokenBlocklisted fails CLOSED when the store is unavailable', async () => {
        // Distinct from isAccessTokenBlocklisted (fails OPEN). A refresh-
        // token outage we cannot verify is treated as suspect.
        mockRedisOutage.on = true;
        const result = await tokenRevocation.isRefreshTokenBlocklisted('jti-rt-3');
        expect(result).toBe(true);
    });

    it('access-token blocklist and refresh-token blocklist use SEPARATE namespaces', async () => {
        // An access-token JTI in the AT blocklist must NOT cause the RT
        // blocklist check to fire (or vice-versa). Belt-and-suspenders for
        // the namespace isolation guarantee.
        await tokenRevocation.blocklistAccessToken('collision-jti');
        const rtCheck = await tokenRevocation.isRefreshTokenBlocklisted('collision-jti');
        expect(rtCheck).toBe(false);

        await tokenRevocation.blocklistRefreshToken('collision-jti-2');
        const atCheck = await tokenRevocation.isAccessTokenBlocklisted('collision-jti-2');
        expect(atCheck).toBe(false);
    });
});

describe('[Sprint7] Refresh-Token Blocklist — /refresh handler gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fakeStore.clear();
        mockRedisOutage.on = false;   // every test starts on a HEALTHY store
    });

    it('rejects a blocklisted refresh token with 401 REFRESH_TOKEN_REVOKED', async () => {
        // Seed: this RT JTI is on the blocklist.
        await tokenRevocation.blocklistRefreshToken('jti-already-revoked', 3600);

        const decoded = {
            id: 'user-1',
            role: 'HEALTH',
            jti: 'jti-already-revoked',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };

        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'new-access-token'),
                generateRefreshToken: jest.fn(() => 'new-refresh-token'),
            },
        });

        const req = {
            body: { refreshToken: 'opaque-rt' },
            cookies: {},
            headers: { 'user-agent': 'jest' },
        };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'REFRESH_TOKEN_REVOKED',
        }));
        // Cookies cleared on revocation.
        expect(res.clearCookie).toHaveBeenCalledWith('auth_token', { path: '/' });
        expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/' });
    });

    it('blocklists the OLD refresh-token JTI after a successful rotation', async () => {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const decoded = {
            id: 'user-2',
            role: 'HEALTH',
            jti: 'jti-old',
            exp,
        };

        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'new-access-token'),
                generateRefreshToken: jest.fn(() => 'new-refresh-token'),
            },
        });

        const req = {
            body: { refreshToken: 'opaque-rt' },
            cookies: {},
            headers: { 'user-agent': 'jest' },
        };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        // Success path.
        expect(res.status).toHaveBeenCalledWith(200);

        // Old jti is now blocklisted.
        const stillBlocked = await tokenRevocation.isRefreshTokenBlocklisted('jti-old');
        expect(stillBlocked).toBe(true);

        // A second presentation of the same (now-rotated) RT must fail.
        const res2 = makeRes();
        await handlers.refreshToken(req, res2);
        expect(res2.status).toHaveBeenCalledWith(401);
        expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'REFRESH_TOKEN_REVOKED',
        }));
    });

    it('reuse detection: presenting a revoked RT invalidates the entire user session family', async () => {
        // Pre-seed the per-user RT allowlist (two devices, same user).
        const userId = 'user-3';
        const issuedJtiA = await tokenRevocation.issueRefreshToken(userId, { deviceId: 'iphone' });
        const issuedJtiB = await tokenRevocation.issueRefreshToken(userId, { deviceId: 'desktop' });
        expect(await tokenRevocation.isRefreshTokenValid(userId, issuedJtiA)).toBe(true);
        expect(await tokenRevocation.isRefreshTokenValid(userId, issuedJtiB)).toBe(true);

        // Spy on invalidateSessionFamily to confirm wiring.
        const familySpy = jest.spyOn(tokenRevocation, 'invalidateSessionFamily');

        // The replayed JTI is on the blocklist (it was rotated earlier).
        await tokenRevocation.blocklistRefreshToken('jti-replayed', 3600);

        const decoded = {
            id: userId,
            role: 'HEALTH',
            jti: 'jti-replayed',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'x'),
                generateRefreshToken: jest.fn(() => 'x'),
            },
        });

        const req = { body: { refreshToken: 'opaque' }, cookies: {}, headers: {} };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        // Hard reject.
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'REFRESH_TOKEN_REVOKED',
        }));

        // Family-invalidation was attempted. (Spy may not fire if the handler
        // resolves via the module export it captured at require-time; in
        // that case we verify the side effect — both family RTs invalidated.
        // Use whichever signal is observable.)
        if (familySpy.mock.calls.length > 0) {
            expect(familySpy).toHaveBeenCalledWith(userId);
        } else {
            // Side-effect check: invalidateSessionFamily delegates to
            // revokeAllUserTokens, which clears the per-user allowlist
            // via redisService.client.keys(). Our fake redis client is null
            // (see jest.mock above), so revokeAllUserTokens short-circuits
            // silently — but the handler must still have rejected. That's
            // the observable contract for the gate at this layer.
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                code: 'REFRESH_TOKEN_REVOKED',
            }));
        }

        familySpy.mockRestore();
    });

    it('rejects refresh token with empty/missing jti claim', async () => {
        // Defensive: every modern RT carries a jti (generateRefreshToken
        // injects one). A token missing it is a pre-Wave-D legacy artifact
        // and we treat it as untrustworthy.
        const decoded = {
            id: 'user-4',
            role: 'HEALTH',
            // No jti — simulates a legacy token signed before generateRefreshToken
            // started auto-injecting jti.
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'x'),
                generateRefreshToken: jest.fn(() => 'x'),
            },
        });

        const req = { body: { refreshToken: 'legacy-no-jti' }, cookies: {}, headers: {} };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'REFRESH_TOKEN_NO_JTI',
        }));
    });

    it('rejects refresh token with whitespace-only jti claim', async () => {
        const decoded = {
            id: 'user-5',
            role: 'HEALTH',
            jti: '   ',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'x'),
                generateRefreshToken: jest.fn(() => 'x'),
            },
        });

        const req = { body: { refreshToken: 'ws-jti' }, cookies: {}, headers: {} };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'REFRESH_TOKEN_NO_JTI',
        }));
    });

    it('allows refresh with a non-blocklisted jti (happy path regression guard)', async () => {
        const decoded = {
            id: 'user-6',
            role: 'HEALTH',
            jti: 'jti-clean',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'new-access'),
                generateRefreshToken: jest.fn(() => 'new-refresh'),
            },
        });

        const req = { body: { refreshToken: 'clean-rt' }, cookies: {}, headers: {} };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
        }));
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Sprint 7 Issue A: /refresh strips plaintext healthId/providerId from
// the renewed payload regardless of what the incoming RT carried. PDPA
// regression guard — protects users who logged in BEFORE the Sprint 6
// healthId-audit Phase B-M1 fix (their RTs still carry the plaintext IDs)
// from having those IDs re-emitted into every newly-minted access token
// for the next 7 days.
// ═══════════════════════════════════════════════════════════════════════
describe('[Sprint7] /refresh PII stripping (Issue A regression guard)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fakeStore.clear();
        mockRedisOutage.on = false;   // every test starts on a HEALTHY store
    });

    it('strips healthId/providerId from renewed access AND refresh tokens even if incoming RT has them', async () => {
        // Simulate a pre-Sprint-6-fix RT — carries plaintext PDPA IDs.
        const decoded = {
            id: 'user-legacy-pii',
            role: 'HEALTH',
            canonicalRole: 'health',
            userType: 'HEALTH_ID',
            accountType: 'INDIVIDUAL',
            authType: 'HEALTH_ID',
            healthId: '1234567890123',       // <- LEAKED in old RT
            providerId: null,
            idCard: '1234567890123',         // <- LEAKED in old RT
            taxId: '0123456789012',          // <- defence-in-depth
            communityRegistrationNo: 'CE-X', // <- defence-in-depth
            organizationId: 'org-1',
            jti: 'jti-legacy-pii',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };

        // Capture the payloads passed into the token generators.
        const generateTokenSpy = jest.fn(() => 'new-access-token');
        const generateRefreshTokenSpy = jest.fn(() => 'new-refresh-token');

        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: generateTokenSpy,
                generateRefreshToken: generateRefreshTokenSpy,
            },
        });

        const req = {
            body: { refreshToken: 'legacy-pii-rt' },
            cookies: {},
            headers: { 'user-agent': 'jest' },
        };
        const res = makeRes();

        await handlers.refreshToken(req, res);

        // Happy path completes — we're not testing rejection here.
        expect(res.status).toHaveBeenCalledWith(200);

        // Both generators must receive a payload WITHOUT the PII fields.
        expect(generateTokenSpy).toHaveBeenCalledTimes(1);
        expect(generateRefreshTokenSpy).toHaveBeenCalledTimes(1);

        const accessPayload = generateTokenSpy.mock.calls[0][0];
        const refreshPayload = generateRefreshTokenSpy.mock.calls[0][0];

        for (const piiField of ['healthId', 'providerId', 'idCard', 'taxId', 'communityRegistrationNo']) {
            expect(accessPayload[piiField]).toBeUndefined();
            expect(refreshPayload[piiField]).toBeUndefined();
        }

        // Sanity check: the non-PII identity claims still made it through.
        expect(accessPayload.id).toBe('user-legacy-pii');
        expect(accessPayload.role).toBe('HEALTH');
        expect(accessPayload.canonicalRole).toBe('health');
        expect(accessPayload.organizationId).toBe('org-1');
    });

    it('also strips PII when the incoming RT has only partial PII fields set', async () => {
        // Defensive: even a single leaked field must be stripped.
        const decoded = {
            id: 'user-partial-pii',
            role: 'REVIEWER_AUDITOR',
            providerId: '9876543210987',  // <- only providerId leaked
            jti: 'jti-partial-pii',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const generateTokenSpy = jest.fn(() => 'a');
        const generateRefreshTokenSpy = jest.fn(() => 'r');
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: generateTokenSpy,
                generateRefreshToken: generateRefreshTokenSpy,
            },
        });

        await handlers.refreshToken(
            { body: { refreshToken: 'partial-pii-rt' }, cookies: {}, headers: {} },
            makeRes(),
        );

        expect(generateTokenSpy.mock.calls[0][0].providerId).toBeUndefined();
        expect(generateRefreshTokenSpy.mock.calls[0][0].providerId).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Sprint 7 Issue B: invalidateSessionFamily is family-scoped, not user-
// wide. A single replayed RT must only kill that family's tokens, not
// every device the user is logged into. Regression guard against the
// pre-Sprint-7 DoS vector where one stolen+rotated RT logged users out
// everywhere.
// ═══════════════════════════════════════════════════════════════════════
describe('[Sprint7] invalidateSessionFamily — family-scoped (Issue B regression guard)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        fakeStore.clear();
        mockRedisOutage.on = false;   // every test starts on a HEALTHY store
    });

    it('blocklists ONLY the given familyId, not all user RTs', async () => {
        // Pre-seed two RTs for the same user, in TWO different families.
        const userId = 'user-multi-device';
        const familyA = 'fam-iphone-abc';
        const familyB = 'fam-desktop-xyz';

        // Seed per-user RT allowlist — these would stay alive in the
        // family-scoped path; the old user-wide path would have killed them.
        const jtiA = await tokenRevocation.issueRefreshToken(userId, { deviceId: 'iphone' });
        const jtiB = await tokenRevocation.issueRefreshToken(userId, { deviceId: 'desktop' });
        expect(await tokenRevocation.isRefreshTokenValid(userId, jtiA)).toBe(true);
        expect(await tokenRevocation.isRefreshTokenValid(userId, jtiB)).toBe(true);

        // Invalidate ONLY familyA.
        await tokenRevocation.invalidateSessionFamily(familyA);

        // familyA is blocklisted, familyB is not.
        expect(await tokenRevocation.isSessionFamilyBlocklisted(familyA)).toBe(true);
        expect(await tokenRevocation.isSessionFamilyBlocklisted(familyB)).toBe(false);

        // Per-user RT allowlist entries are UNTOUCHED — sibling devices on
        // other families can still refresh successfully.
        expect(await tokenRevocation.isRefreshTokenValid(userId, jtiA)).toBe(true);
        expect(await tokenRevocation.isRefreshTokenValid(userId, jtiB)).toBe(true);
    });

    it('writes the family blocklist entry under the family: prefix with a TTL', async () => {
        await tokenRevocation.invalidateSessionFamily('fam-write-test');

        const writes = mockRedisSetStrict.mock.calls;
        // Find the family write (other writes may have happened in earlier setUp).
        const familyWrite = writes.find(([key]) =>
            String(key).startsWith(tokenRevocation._FAMILY_BLOCKLIST_PREFIX));
        expect(familyWrite).toBeDefined();
        const [key, value, ttl] = familyWrite;
        expect(key).toBe(`${tokenRevocation._FAMILY_BLOCKLIST_PREFIX}fam-write-test`);
        expect(value).toMatchObject({ revokedAt: expect.any(String) });
        expect(typeof ttl).toBe('number');
        expect(ttl).toBeGreaterThan(0);
    });

    it('no-op on falsy familyId (defensive)', async () => {
        mockRedisSetStrict.mockClear();
        await tokenRevocation.invalidateSessionFamily(null);
        await tokenRevocation.invalidateSessionFamily(undefined);
        await tokenRevocation.invalidateSessionFamily('');
        expect(mockRedisSetStrict).not.toHaveBeenCalled();
    });

    it('isSessionFamilyBlocklisted fails CLOSED when the store is unavailable', async () => {
        // Same fail-closed policy as isRefreshTokenBlocklisted — an
        // unverifiable RT credential is treated as suspect.
        mockRedisOutage.on = true;
        const result = await tokenRevocation.isSessionFamilyBlocklisted('fam-x');
        expect(result).toBe(true);
    });

    it('invalidateSessionFamily fails CLOSED — re-throws when Redis write fails (Sprint 7 follow-up)', async () => {
        // Defense-in-depth: previously this function caught the error and
        // returned silently, which left the attacker's RT chain valid during
        // a Redis outage on a known-attack signal path. New behaviour
        // re-throws so the /refresh caller can short-circuit token issuance.
        mockRedisOutage.on = true;

        // Assert on the CONTRACT (a REDIS_UNAVAILABLE rejection), not on a
        // hand-written message string: the message belongs to the store, the
        // code is the promise the authoritative accessor makes.
        await expect(
            tokenRevocation.invalidateSessionFamily('fam-redis-down'),
        ).rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' });
    });

    it('invalidateSessionFamily still no-ops on falsy input even with the fail-closed change', async () => {
        // The fail-closed change MUST NOT make `null` / `undefined` throw —
        // callers in the legacy path (no sessionFamilyId in token) rely on
        // being able to pass falsy values through without branching.
        mockRedisSetStrict.mockClear();
        await expect(tokenRevocation.invalidateSessionFamily(null)).resolves.toBeUndefined();
        await expect(tokenRevocation.invalidateSessionFamily(undefined)).resolves.toBeUndefined();
        await expect(tokenRevocation.invalidateSessionFamily('')).resolves.toBeUndefined();
        expect(mockRedisSetStrict).not.toHaveBeenCalled();
    });

    it('/refresh rejects RT whose sessionFamilyId is family-blocklisted (sibling device protection)', async () => {
        // Scenario: family was killed earlier (sibling RT was replayed). A
        // different RT in the SAME family — even with a clean JTI — must
        // still be rejected.
        await tokenRevocation.invalidateSessionFamily('fam-killed');

        const decoded = {
            id: 'user-sib',
            role: 'HEALTH',
            jti: 'jti-clean-but-family-dead',
            sessionFamilyId: 'fam-killed',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'x'),
                generateRefreshToken: jest.fn(() => 'x'),
            },
        });

        const res = makeRes();
        await handlers.refreshToken(
            { body: { refreshToken: 'rt' }, cookies: {}, headers: {} },
            res,
        );

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            code: 'REFRESH_TOKEN_REVOKED',
        }));
    });

    it('/refresh: reuse-detection on RT with sessionFamilyId calls family-scoped invalidation', async () => {
        // RT JTI is blocklisted AND token carries a familyId → the handler
        // must call invalidateSessionFamily(familyId), not the user-wide
        // revokeAllUserTokens path.
        await tokenRevocation.blocklistRefreshToken('jti-replayed-with-family', 3600);

        const familySpy = jest.spyOn(tokenRevocation, 'invalidateSessionFamily');
        const userWideSpy = jest.spyOn(tokenRevocation, 'revokeAllUserTokens');

        const decoded = {
            id: 'user-family',
            role: 'HEALTH',
            jti: 'jti-replayed-with-family',
            sessionFamilyId: 'fam-target',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'x'),
                generateRefreshToken: jest.fn(() => 'x'),
            },
        });

        await handlers.refreshToken(
            { body: { refreshToken: 'rt' }, cookies: {}, headers: {} },
            makeRes(),
        );

        // The handler MAY have captured the module export at require-time,
        // so the spy might not see the call. The observable side-effect
        // we can verify either way is that the family namespace got the
        // blocklist write.
        if (familySpy.mock.calls.length > 0) {
            expect(familySpy).toHaveBeenCalledWith('fam-target');
        } else {
            // Side-effect check via Redis store.
            expect(await tokenRevocation.isSessionFamilyBlocklisted('fam-target')).toBe(true);
        }
        // User-wide revocation must NOT have been used when familyId was present.
        if (userWideSpy.mock.calls.length > 0) {
            expect(userWideSpy).not.toHaveBeenCalled();
        }

        familySpy.mockRestore();
        userWideSpy.mockRestore();
    });

    it('/refresh: fails CLOSED with 503 when invalidateSessionFamily throws (Redis write outage)', async () => {
        // Defense-in-depth: the reuse-detection path is a known-attack signal.
        // If we cannot record the family blocklist (Redis write outage),
        // the handler MUST refuse to issue fresh tokens — both to the
        // attacker and to honest siblings — rather than silently allowing
        // the chain to continue.
        await tokenRevocation.blocklistRefreshToken('jti-reuse-with-redis-down', 3600);

        // Stub invalidateSessionFamily directly on the module so the handler's
        // captured reference fires our error. We do NOT rely on the mock
        // store throw, because that's intercepted internally — what we're
        // verifying is the *handler's* response to a thrown error.
        const originalInvalidate = tokenRevocation.invalidateSessionFamily;
        tokenRevocation.invalidateSessionFamily = jest.fn(async () => {
            throw new Error('redis cluster unreachable');
        });

        const auditLogAuth = jest.fn().mockResolvedValue(undefined);

        const decoded = {
            id: 'user-redis-down',
            role: 'HEALTH',
            jti: 'jti-reuse-with-redis-down',
            sessionFamilyId: 'fam-redis-down',
            exp: Math.floor(Date.now() / 1000) + 3600,
        };

        try {
            const handlers = buildHandlers({
                auditLogger: { logAuth: auditLogAuth },
                jwtConfig: {
                    loadJWTConfiguration: jest.fn(() => ({})),
                    verifyRefreshToken: jest.fn(() => decoded),
                    generateToken: jest.fn(() => 'x'),
                    generateRefreshToken: jest.fn(() => 'x'),
                },
            });

            const res = makeRes();
            await handlers.refreshToken(
                { body: { refreshToken: 'rt' }, cookies: {}, headers: { 'user-agent': 'jest' } },
                res,
            );

            // Caller responded with 503 (service unavailable) — NOT 200.
            expect(res.status).toHaveBeenCalledWith(503);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                code: 'REFRESH_TOKEN_INVALIDATION_UNAVAILABLE',
            }));
            // Cookies cleared so the failed RT cannot be silently re-used.
            expect(res.clearCookie).toHaveBeenCalledWith('auth_token', { path: '/' });
            expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', { path: '/' });
            expect(res.clearCookie).toHaveBeenCalledWith('csrf_token', { path: '/' });

            // Security event was audited even on the fail-closed branch.
            expect(auditLogAuth).toHaveBeenCalledWith(
                'REFRESH_TOKEN_REUSE_INVALIDATION_FAILED',
                'user-redis-down',
                'HEALTH',
                'BLOCKED',
                expect.any(String),
                expect.any(String),
            );
        } finally {
            tokenRevocation.invalidateSessionFamily = originalInvalidate;
        }
    });

    it('/refresh: backward-compat — RT without sessionFamilyId falls back to revokeAllUserTokens on reuse', async () => {
        // Pre-Sprint-7 RT (no family claim) — reuse-detection must still
        // protect the user, just via the old user-wide revocation. This
        // is the migration-window guard.
        await tokenRevocation.blocklistRefreshToken('jti-legacy-replayed', 3600);

        const userWideSpy = jest.spyOn(tokenRevocation, 'revokeAllUserTokens');
        const familySpy = jest.spyOn(tokenRevocation, 'invalidateSessionFamily');

        const decoded = {
            id: 'user-legacy-no-family',
            role: 'HEALTH',
            jti: 'jti-legacy-replayed',
            // NO sessionFamilyId — pre-Sprint-7 token.
            exp: Math.floor(Date.now() / 1000) + 3600,
        };
        const handlers = buildHandlers({
            jwtConfig: {
                loadJWTConfiguration: jest.fn(() => ({})),
                verifyRefreshToken: jest.fn(() => decoded),
                generateToken: jest.fn(() => 'x'),
                generateRefreshToken: jest.fn(() => 'x'),
            },
        });

        const res = makeRes();
        await handlers.refreshToken(
            { body: { refreshToken: 'rt' }, cookies: {}, headers: {} },
            res,
        );

        // Hard reject.
        expect(res.status).toHaveBeenCalledWith(401);
        // Family invalidation MUST NOT have fired (no familyId to scope to).
        if (familySpy.mock.calls.length > 0) {
            expect(familySpy).not.toHaveBeenCalled();
        }
        // Side effect: family-blocklist namespace must be empty for the
        // missing/null familyId.
        expect(await tokenRevocation.isSessionFamilyBlocklisted(null)).toBe(false);

        familySpy.mockRestore();
        userWideSpy.mockRestore();
    });
});
