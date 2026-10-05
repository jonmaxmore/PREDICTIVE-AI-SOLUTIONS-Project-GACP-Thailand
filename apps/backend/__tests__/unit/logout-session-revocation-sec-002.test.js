/**
 * SEC-002 — logout must terminate the session SERVER-SIDE.
 *
 * Before the fix, logout only cleared cookies: the access token stayed valid
 * until its exp and the refresh token was replayable for 7 days. These tests
 * drive the shared revoker with real JWTs (real jwt-security mint/verify) over
 * an in-memory Redis (mirroring the repo's blocklist-test convention) and
 * assert the access- and refresh-token JTIs land on their blocklists — the
 * exact gates auth-middleware and POST /refresh consult.
 */

// In-memory Redis — same get/set/del shape the revocation service relies on.
const mockStore = new Map();
// W1-5 (2026-08-22): revocation reads/writes go through the AUTHORITATIVE
// *Strict accessors, which reject when the store cannot answer rather than
// silently returning null/false. This fake models a healthy store, so the
// strict and cache variants agree.
jest.mock('../../services/redis-service', () => ({
    get: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
    set: jest.fn(async (key, value) => { mockStore.set(key, value); return 'OK'; }),
    del: jest.fn(async (key) => { mockStore.delete(key); return 1; }),
    getStrict: jest.fn(async (key) => (mockStore.has(key) ? mockStore.get(key) : null)),
    setStrict: jest.fn(async (key, value) => { mockStore.set(key, value); return true; }),
    delStrict: jest.fn(async (key) => { mockStore.delete(key); return true; }),
    client: { keys: jest.fn(async () => []), del: jest.fn(async () => 0) },
}));

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const jwtConfig = require('../../config/jwt-security');
const {
    isAccessTokenBlocklisted,
    isRefreshTokenBlocklisted,
} = require('../../services/token-revocation-service');
const { revokeSessionFromRequest } = require('../../utils/session-revocation');

beforeEach(() => mockStore.clear());

function mintSession(type) {
    const cfg = jwtConfig.loadJWTConfiguration();
    const at = jwtConfig.generateToken({ id: 'user-1', role: 'HEALTH' }, type);
    const atJti = jwtConfig.verifyToken(at, type, cfg).jti;
    const rt = jwtConfig.generateRefreshToken({ id: 'user-1' }, type);
    const rtJti = jwtConfig.verifyRefreshToken(rt, type, cfg).jti;
    return { at, atJti, rt, rtJti };
}

describe('SEC-002 — health logout revokes the presented tokens', () => {
    it('blocklists BOTH the access token and the refresh token', async () => {
        const { at, atJti, rt, rtJti } = mintSession('public');
        // Sanity — nothing is revoked before logout.
        expect(await isAccessTokenBlocklisted(atJti)).toBe(false);
        expect(await isRefreshTokenBlocklisted(rtJti)).toBe(false);

        const req = { cookies: { auth_token: at, refresh_token: rt }, headers: {}, body: {} };
        const summary = await revokeSessionFromRequest(req, 'public');

        expect(summary).toEqual({ accessRevoked: true, refreshRevoked: true });
        expect(await isAccessTokenBlocklisted(atJti)).toBe(true);
        expect(await isRefreshTokenBlocklisted(rtJti)).toBe(true);
    });

    it('accepts the access token via Authorization: Bearer as well as cookie', async () => {
        const { at, atJti } = mintSession('public');
        const req = { cookies: {}, headers: { authorization: `Bearer ${at}` }, body: {} };
        const summary = await revokeSessionFromRequest(req, 'public');
        expect(summary.accessRevoked).toBe(true);
        expect(await isAccessTokenBlocklisted(atJti)).toBe(true);
    });

    it('is a safe no-op when no tokens are presented', async () => {
        const summary = await revokeSessionFromRequest({ cookies: {}, headers: {}, body: {} }, 'public');
        expect(summary).toEqual({ accessRevoked: false, refreshRevoked: false });
    });

    it('ignores garbage / expired tokens without throwing', async () => {
        const req = { cookies: { auth_token: 'not.a.jwt', refresh_token: 'x.y.z' }, headers: {}, body: {} };
        const summary = await revokeSessionFromRequest(req, 'public');
        expect(summary).toEqual({ accessRevoked: false, refreshRevoked: false });
    });
});

describe('SEC-002 — provider logout revokes the provider access token', () => {
    it('blocklists the provider_token jti', async () => {
        const cfg = jwtConfig.loadJWTConfiguration();
        const at = jwtConfig.generateToken({ id: 'prov-1', role: 'PROVIDER' }, 'provider');
        const atJti = jwtConfig.verifyToken(at, 'provider', cfg).jti;

        const req = { cookies: { provider_token: at }, headers: {}, body: {} };
        const summary = await revokeSessionFromRequest(req, 'provider');

        expect(summary.accessRevoked).toBe(true);
        expect(await isAccessTokenBlocklisted(atJti)).toBe(true);
    });
});
