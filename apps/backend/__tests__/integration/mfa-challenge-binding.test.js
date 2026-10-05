/**
 * AUTH-5 — MFA challenge IP/User-Agent binding.
 *
 * The `mfa_session` JWT minted after the password step now carries a `bind`
 * claim = SHA-256(ip|user-agent). POST /api/identity/mfa/verify recomputes the
 * fingerprint from the completing request and rejects (401) when it differs —
 * so a stolen challenge token can't be completed from a different network/agent.
 *
 * The /verify ordering is: decode → binding check → `if (!code)` → DB lookup.
 * So we exercise the binding gate with NO `code` in the body:
 *   - binding PASS  → falls through to 400 "Verification code required"
 *   - binding FAIL  → 401 MFA_CHALLENGE_BINDING_MISMATCH (before the code check)
 */

'use strict';

const request = require('supertest');
const express = require('express');

const { computeMfaChallengeBinding } = require('../../shared/mfa-challenge-binding');

const ISSUED_IP = '1.2.3.4';
const ISSUED_UA = 'issued-agent/1.0';
const ISSUED_BIND = computeMfaChallengeBinding(ISSUED_IP, ISSUED_UA);

// Mutable decode result so each test can choose whether the token carries a bind.
const mockState = {
    decoded: { id: 'user-1', purpose: 'mfa_challenge', jti: 'jti-1', bind: ISSUED_BIND },
};

jest.mock('../../config/jwt-security', () => ({
    verifyToken: jest.fn(() => mockState.decoded),
    generateToken: jest.fn(() => 'access-token'),
    generateRefreshToken: jest.fn(() => 'refresh-token'),
}));

// getRequestIp returns the test-controlled IP (header), defaulting to the
// issued IP so a request without the header represents the "same client".
jest.mock('../../utils/client-ip', () => ({
    getRequestIp: (req) => req.headers['x-test-ip'] || '1.2.3.4',
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    AuditCategory: { SECURITY: 'SECURITY', AUTHENTICATION: 'AUTHENTICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
}));

// These modules sit AFTER the binding gate for the no-code cases, but mfa.js
// requires them at load time — stub so the router loads without the DB tree.
jest.mock('../../services/identity-service', () => ({
    findUserForMfaVerify: jest.fn(),
    updateBackupCodes: jest.fn(),
}));
jest.mock('../../middleware/mfa-service', () => ({
    mfaService: { verifyTOTP: jest.fn(() => true), hashBackupCode: jest.fn((c) => `H(${c})`) },
}));
jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (_req, _res, next) => next(),
}));
// PR6: /status, /email/*, /disable use authenticateAny — export both names or
// the router throws at mount and the suite fails to load.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (_req, _res, next) => next(),
    authenticateAny: (_req, _res, next) => next(),
}));
jest.mock('../../shared/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

function buildApp() {
    const mfaRouter = require('../../routes/api/identity/mfa');
    const app = express();
    app.use(express.json());
    app.use('/api/identity/mfa', mfaRouter);
    return app;
}

describe('AUTH-5 — MFA challenge IP/UA binding', () => {
    const ORIGINAL_ENFORCE = process.env.MFA_CHALLENGE_BIND_ENFORCE;

    beforeEach(() => {
        jest.clearAllMocks();
        mockState.decoded = { id: 'user-1', purpose: 'mfa_challenge', jti: 'jti-1', bind: ISSUED_BIND };
        delete process.env.MFA_CHALLENGE_BIND_ENFORCE;
    });

    afterAll(() => {
        if (ORIGINAL_ENFORCE === undefined) { delete process.env.MFA_CHALLENGE_BIND_ENFORCE; }
        else { process.env.MFA_CHALLENGE_BIND_ENFORCE = ORIGINAL_ENFORCE; }
    });

    describe('computeMfaChallengeBinding', () => {
        test('is deterministic and changes when IP or User-Agent changes', () => {
            expect(computeMfaChallengeBinding(ISSUED_IP, ISSUED_UA)).toBe(ISSUED_BIND);
            expect(computeMfaChallengeBinding('9.9.9.9', ISSUED_UA)).not.toBe(ISSUED_BIND);
            expect(computeMfaChallengeBinding(ISSUED_IP, 'other-agent')).not.toBe(ISSUED_BIND);
            expect(ISSUED_BIND).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    test('same IP + UA → binding passes (falls through to "code required")', async () => {
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .set('User-Agent', ISSUED_UA)
            .set('x-test-ip', ISSUED_IP)
            .send({ mfa_session: 'tok' }); // no code

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/code required/i);
    });

    test('different IP → 401 MFA_CHALLENGE_BINDING_MISMATCH', async () => {
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .set('User-Agent', ISSUED_UA)
            .set('x-test-ip', '9.9.9.9') // hijack from another network
            .send({ mfa_session: 'tok', code: '123456' });

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('MFA_CHALLENGE_BINDING_MISMATCH');
    });

    test('different User-Agent → 401 MFA_CHALLENGE_BINDING_MISMATCH', async () => {
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .set('User-Agent', 'attacker-agent/9')
            .set('x-test-ip', ISSUED_IP)
            .send({ mfa_session: 'tok', code: '123456' });

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('MFA_CHALLENGE_BINDING_MISMATCH');
    });

    test('legacy token without a bind claim is allowed through (5-min grace)', async () => {
        mockState.decoded = { id: 'user-1', purpose: 'mfa_challenge', jti: 'jti-1' }; // no bind
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .set('User-Agent', 'anything')
            .set('x-test-ip', '9.9.9.9')
            .send({ mfa_session: 'tok' }); // no code

        // Binding skipped (no claim) → falls through to the code check.
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/code required/i);
    });

    test('MFA_CHALLENGE_BIND_ENFORCE=false → mismatch is allowed (monitor mode)', async () => {
        process.env.MFA_CHALLENGE_BIND_ENFORCE = 'false';
        const res = await request(buildApp())
            .post('/api/identity/mfa/verify')
            .set('User-Agent', ISSUED_UA)
            .set('x-test-ip', '9.9.9.9') // mismatch, but enforcement off
            .send({ mfa_session: 'tok' }); // no code

        // Not rejected for binding — falls through to the code check.
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/code required/i);
    });
});
