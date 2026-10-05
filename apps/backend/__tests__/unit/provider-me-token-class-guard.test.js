/**
 * SEC — GET /auth/provider/me must reject non-access tokens.
 *
 * The endpoint verifies the JWT INLINE rather than going through
 * authenticateProvider, so it never inherited the central guard that rejects
 * purpose-scoped and wrong-class tokens.
 *
 * An `mfa_challenge` token is handed out by POST /auth/provider/login to anyone
 * who supplies only the correct PASSWORD on a 2FA-enabled account. It is signed
 * with the same provider secret / issuer / audience as a real access token and
 * carries `id` plus an auto-injected `jti`, so it cleared every gate /me does
 * have: jti presence, the Redis blocklist, account status, and the session
 * epoch. A password-only attacker therefore read a 2FA-protected officer's
 * profile — the exact thing the second factor exists to prevent.
 *
 * Aggravating: the success payload returned `providerUser.providerId` RAW,
 * while the fully-authenticated login response masks it. The half-authenticated
 * attacker received MORE plaintext national ID than a user who completed 2FA.
 *
 * `mfa_setup` tokens are minted the same way and are covered here too.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockVerifyToken = jest.fn();
jest.mock('../../config/jwt-security', () => ({
    loadJWTConfiguration: jest.fn(() => ({})),
    verifyToken: (...a) => mockVerifyToken(...a),
    // Only token VERIFICATION is stubbed. The classifier is the REAL one, so a
    // regression in classifyTokenForAccessPath fails this suite instead of
    // being masked by a stub that always answers "ok".
    classifyTokenForAccessPath:
        jest.requireActual('../../config/jwt-security').classifyTokenForAccessPath,
}));

const mockFindById = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    findProviderUserById: (...a) => mockFindById(...a),
}));

jest.mock('../../services/token-revocation-service', () => ({
    isAccessTokenBlocklisted: jest.fn(async () => false),
}));

const authProviderRouter = require('../../routes/api/auth/auth-provider');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/auth/provider', authProviderRouter);
    return app;
}

const NOW_SEC = Math.floor(Date.now() / 1000);
const PROVIDER_ID = '1234567890123';

function providerUser(overrides = {}) {
    return {
        id: 'prov-1', providerId: PROVIDER_ID, email: 'officer@dtam.go.th',
        firstName: 'สมหญิง', lastName: 'ตรวจดี', role: 'ADMIN', authType: 'PROVIDER_ID',
        status: 'ACTIVE', isDeleted: false, sessionsRevokedAt: null,
        ministryVerified: true, ...overrides,
    };
}

describe('SEC — /auth/provider/me rejects non-access tokens', () => {
    let app;
    const graceEnv = process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;

    beforeEach(() => {
        jest.clearAllMocks();
        // Strict allowlist by default; the grace-window tests opt in explicitly.
        delete process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;
        mockFindById.mockResolvedValue(providerUser());
        app = buildApp();
    });

    afterAll(() => {
        if (graceEnv === undefined) {
            delete process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL;
        } else {
            process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL = graceEnv;
        }
    });

    it('rejects an mfa_challenge token (password-only attacker)', async () => {
        mockVerifyToken.mockReturnValue({
            id: 'prov-1', jti: 'jti-1', iat: NOW_SEC,
            purpose: 'mfa_challenge', method: 'TOTP', bind: 'abc',
            tokenType: 'access',
        });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');

        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toContain(PROVIDER_ID);
        expect(mockFindById).not.toHaveBeenCalled();
    });

    it('rejects an mfa_setup token', async () => {
        mockVerifyToken.mockReturnValue({
            id: 'prov-1', jti: 'jti-1', iat: NOW_SEC, purpose: 'mfa_setup', tokenType: 'access',
        });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');
        expect(res.status).toBe(401);
        expect(mockFindById).not.toHaveBeenCalled();
    });

    it('rejects a refresh token presented to /me', async () => {
        mockVerifyToken.mockReturnValue({
            id: 'prov-1', jti: 'jti-1', iat: NOW_SEC, tokenType: 'refresh',
        });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');
        expect(res.status).toBe(401);
        expect(mockFindById).not.toHaveBeenCalled();
    });

    it('still serves a genuine access token', async () => {
        mockVerifyToken.mockReturnValue({
            id: 'prov-1', jti: 'jti-1', iat: NOW_SEC, tokenType: 'access',
        });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe('prov-1');
    });

    // Rollout hazard: every token minted before tokenType existed is "untyped".
    // LEGACY_UNTYPED_TOKEN_GRACE_UNTIL must be set at deploy time or every live
    // session is logged out the moment this ships.
    it('rejects a legacy untyped token once the grace window has expired', async () => {
        mockVerifyToken.mockReturnValue({ id: 'prov-1', jti: 'jti-1', iat: NOW_SEC });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');
        expect(res.status).toBe(401);
        expect(mockFindById).not.toHaveBeenCalled();
    });

    it('accepts a legacy untyped token while the grace window is open', async () => {
        process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL =
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        mockVerifyToken.mockReturnValue({ id: 'prov-1', jti: 'jti-1', iat: NOW_SEC });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');
        expect(res.status).toBe(200);
    });

    // The grace window tolerates an ABSENT tokenType only — an explicit
    // `refresh` is rejected on day one, so the vulnerability closes at deploy.
    it('rejects a refresh token even while the grace window is open', async () => {
        process.env.LEGACY_UNTYPED_TOKEN_GRACE_UNTIL =
            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        mockVerifyToken.mockReturnValue({
            id: 'prov-1', jti: 'jti-1', iat: NOW_SEC, tokenType: 'refresh',
        });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');
        expect(res.status).toBe(401);
        expect(mockFindById).not.toHaveBeenCalled();
    });

    it('masks the national ID on the success path, matching the login response', async () => {
        mockVerifyToken.mockReturnValue({
            id: 'prov-1', jti: 'jti-1', iat: NOW_SEC, tokenType: 'access',
        });

        const res = await request(app).get('/auth/provider/me').set('Authorization', 'Bearer x');
        expect(res.status).toBe(200);
        // The raw 13-digit citizen ID must not appear anywhere in the payload.
        expect(JSON.stringify(res.body)).not.toContain(PROVIDER_ID);
        expect(res.body.data.providerId).toBeTruthy();
    });
});
