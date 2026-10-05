/**
 * MFA /verify — guards added by the audit-fix commit (PR6 hardening):
 *   - M-2 jti single-use replay guard (Redis setNX + disambiguating get)
 *   - null-secret TOTP guard (EMAIL-method user routed to the TOTP branch → 400, not 500)
 *   - input type-guards on `code` / `mfa_session` (non-string → 400, not 500)
 *   - the happy path actually issues a token + claims the jti
 *
 * The binding suite (mfa-challenge-binding.test.js) only reaches the pre-isValid
 * branches and does NOT mock redis-service; this suite mocks redis-service so the
 * post-success jti block is exercised deterministically.
 */
'use strict';

const request = require('supertest');
const express = require('express');

// Decoded mfa_challenge JWT — no `bind` claim so the AUTH-5 binding gate is
// skipped and we reach the code/verify/jti path. exp ~5 min out.
const mockState = {
    decoded: { id: 'user-1', purpose: 'mfa_challenge', jti: 'jti-success', method: 'TOTP', exp: 9999999999 },
    user: {
        id: 'user-1', uuid: 'uuid-1', email: 'u@example.com', role: 'document_reviewer',
        twoFactorEnabled: true, twoFactorMethod: 'TOTP', twoFactorSecret: 'SECRET', twoFactorBackupCodes: [],
        organizationId: 'org-1',
    },
    setNX: true,   // claimed (first use)
    get: null,     // no existing jti key
    totpValid: true,
};

jest.mock('../../config/jwt-security', () => ({
    verifyToken: jest.fn(() => mockState.decoded),
    generateToken: jest.fn(() => 'access-token'),
    generateRefreshToken: jest.fn(() => 'refresh-token'),
}));
jest.mock('../../utils/client-ip', () => ({ getRequestIp: () => '1.2.3.4' }));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({ id: 'a1' }) },
    AuditCategory: { SECURITY: 'SECURITY', AUTHENTICATION: 'AUTHENTICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
}));
jest.mock('../../services/identity-service', () => ({
    findUserForMfaVerify: jest.fn(() => mockState.user),
    updateBackupCodes: jest.fn(),
    touchLastLogin: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../middleware/mfa-service', () => ({
    mfaService: { verifyTOTP: jest.fn(() => mockState.totpValid), hashBackupCode: jest.fn((c) => `H(${c})`) },
}));
// W1-5 (2026-08-22): the *Strict accessors are the AUTHORITATIVE contract —
// they reject when the store cannot answer instead of returning null. The
// jti replay guard reads through getStrict so it can tell "already used"
// from "Redis down" (the old `get`-null heuristic conflated them). This
// fake keeps a healthy store, so strict and cache reads agree.
jest.mock('../../services/redis-service', () => ({
    setNX: jest.fn(() => mockState.setNX),
    get: jest.fn(() => mockState.get),
    set: jest.fn(() => true),
    del: jest.fn(() => true),
    getStrict: jest.fn(() => mockState.get),
    setStrict: jest.fn(() => true),
    delStrict: jest.fn(() => true),
}));
jest.mock('../../middleware/rate-limiter', () => ({ createRateLimiter: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (_req, _res, next) => next(),
    authenticateAny: (_req, _res, next) => next(),
}));
jest.mock('../../shared/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const jwtConfig = require('../../config/jwt-security');

function buildApp() {
    const mfaRouter = require('../../routes/api/identity/mfa');
    const app = express();
    app.use(express.json());
    app.use('/api/identity/mfa', mfaRouter);
    return app;
}

describe('MFA /verify guards (PR6 hardening)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockState.decoded = { id: 'user-1', purpose: 'mfa_challenge', jti: 'jti-success', method: 'TOTP', exp: 9999999999 };
        mockState.user = {
            id: 'user-1', uuid: 'uuid-1', email: 'u@example.com', role: 'document_reviewer',
            twoFactorEnabled: true, twoFactorMethod: 'TOTP', twoFactorSecret: 'SECRET', twoFactorBackupCodes: [],
            organizationId: 'org-1',
        };
        mockState.setNX = true;
        mockState.get = null;
        mockState.totpValid = true;
    });

    test('happy path: valid TOTP + fresh jti → 200, token issued, jti claimed', async () => {
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .send({ mfa_session: 'tok', code: '123456' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.token).toBe('access-token');
        expect(jwtConfig.generateToken).toHaveBeenCalledTimes(1);
        const redis = require('../../services/redis-service');
        expect(redis.setNX).toHaveBeenCalledWith(expect.stringContaining('mfa-jti:jti-success'), '1', expect.any(Number));
    });

    test('M-2 replay: jti already used (setNX false + get truthy) → 401 MFA_CHALLENGE_REUSED, no token', async () => {
        mockState.setNX = false;
        mockState.get = '1'; // key exists → confirmed replay
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .send({ mfa_session: 'tok', code: '123456' });

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('MFA_CHALLENGE_REUSED');
        expect(jwtConfig.generateToken).not.toHaveBeenCalled();
    });

    test('M-2 fail-open: Redis down (setNX false + get null) → 200, proceeds', async () => {
        mockState.setNX = false;
        mockState.get = null; // can't confirm replay → allow
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .send({ mfa_session: 'tok', code: '123456' });

        expect(res.status).toBe(200);
        expect(jwtConfig.generateToken).toHaveBeenCalledTimes(1);
    });

    test('null-secret guard: TOTP-routed user with no secret → 400 MFA_METHOD_MISMATCH (not 500)', async () => {
        mockState.decoded = { id: 'user-1', purpose: 'mfa_challenge', jti: 'jti-x', exp: 9999999999 }; // no method
        mockState.user = { ...mockState.user, twoFactorMethod: 'TOTP', twoFactorSecret: null };
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .send({ mfa_session: 'tok', code: '123456' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('MFA_METHOD_MISMATCH');
        expect(jwtConfig.generateToken).not.toHaveBeenCalled();
    });

    test('type-guard: non-string code → 400 (not a 500 from .replace/verifyTOTP)', async () => {
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .send({ mfa_session: 'tok', code: { evil: true } });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/string/i);
    });

    test('type-guard: non-string mfa_session → 400', async () => {
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .send({ mfa_session: 12345, code: '123456' });

        expect(res.status).toBe(400);
    });
});
