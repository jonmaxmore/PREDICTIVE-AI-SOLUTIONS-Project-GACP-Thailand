/**
 * BE-EDGE-04 (D2) — Provider LOGIN route failure-code contract.
 *
 * Companion to auth-middleware-db-lookup.test.js (which pins the *middleware*
 * codes). This pins the login *route* codes the web client switches on:
 * INVALID_PROVIDER_ID / USER_NOT_FOUND / INVALID_PROVIDER_ROLE /
 * ACCOUNT_INACTIVE / INVALID_PASSWORD — all code-present but previously
 * unasserted (the hardening findings D2, evidence code-mapping.md).
 *
 * Test-only: real Zod validate middleware + real canonical-rbac role logic;
 * only the DB/bcrypt/jwt boundaries are mocked so no connection is opened.
 * The ordering of the guards (format → lookup → role → accountType → status →
 * password) is itself part of the contract — each test drives the request to
 * exactly one failing guard with everything earlier satisfied.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockFindByHash = jest.fn();
const mockTouchLastLogin = jest.fn().mockResolvedValue(undefined);
const mockRegisterFailed = jest.fn().mockResolvedValue({ attempts: 1, locked: false, lockedUntil: null });
const mockResetLock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/provider-user-service', () => ({
    findProviderForLoginByHash: (...a) => mockFindByHash(...a),
    touchProviderLastLogin: (...a) => mockTouchLastLogin(...a),
    registerFailedProviderLogin: (...a) => mockRegisterFailed(...a),
    resetProviderLoginLock: (...a) => mockResetLock(...a),
}));

const mockCompare = jest.fn();
jest.mock('bcryptjs', () => ({ compare: (...a) => mockCompare(...a) }));

// Avoid needing real JWT secrets for the happy path.
jest.mock('../../config/jwt-security', () => ({
    generateToken: jest.fn(() => 'signed.provider.token'),
}));

const authProviderRouter = require('../../routes/api/auth/auth-provider');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/auth/provider', authProviderRouter);
    return app;
}

// A well-formed 13-digit provider id + a schema-valid password so the request
// always reaches the guard under test (not the format/validation gate).
const VALID_ID = '1234567890123';
const VALID_PW = 'Password123!';

// A provider record that passes every guard EXCEPT the one a test overrides.
function provider(overrides = {}) {
    return {
        id: 'prov-uuid-1',
        uuid: 'prov-uuid-1',
        role: 'field_inspector',
        canonicalRole: 'field_inspector',
        accountType: 'PROVIDER',
        status: 'ACTIVE',
        healthId: null,
        password: 'hashed',
        providerId: VALID_ID,
        email: 'a@b.co',
        firstName: 'A',
        lastName: 'B',
        organizationId: 'org-1',
        ...overrides,
    };
}

function login(body) {
    return request(buildApp()).post('/auth/provider/login').send(body);
}

describe('BE-EDGE-04 (D2) — POST /auth/provider/login failure-code mapping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTouchLastLogin.mockResolvedValue(undefined);
        mockRegisterFailed.mockResolvedValue({ attempts: 1, locked: false, lockedUntil: null });
        mockResetLock.mockResolvedValue(undefined);
    });

    it('malformed (non-13-digit) providerId → 400 INVALID_PROVIDER_ID (never hits the DB)', async () => {
        const res = await login({ providerId: '12345', password: VALID_PW });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PROVIDER_ID');
        expect(mockFindByHash).not.toHaveBeenCalled();
    });

    it('unknown provider → 401 USER_NOT_FOUND', async () => {
        mockFindByHash.mockResolvedValue(null);
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('USER_NOT_FOUND');
    });

    it('account carries a non-provider role → 403 INVALID_PROVIDER_ROLE', async () => {
        mockFindByHash.mockResolvedValue(provider({ role: 'HEALTH' }));
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('INVALID_PROVIDER_ROLE');
        expect(mockCompare).not.toHaveBeenCalled(); // rejected before password check
    });

    it('inactive provider (status !== ACTIVE) → 403 ACCOUNT_INACTIVE', async () => {
        mockFindByHash.mockResolvedValue(provider({ status: 'SUSPENDED' }));
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        expect(mockCompare).not.toHaveBeenCalled(); // status gate is before password
    });

    it('wrong password → 401 INVALID_PASSWORD and records the failed attempt', async () => {
        mockFindByHash.mockResolvedValue(provider());
        mockCompare.mockResolvedValue(false);
        mockRegisterFailed.mockResolvedValue({ attempts: 1, locked: false, lockedUntil: null });
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_PASSWORD');
        expect(mockRegisterFailed).toHaveBeenCalledTimes(1);
    });

    // ── H-3: per-account brute-force lockout (audit 2026-06-11) ──
    it('wrong password that crosses the threshold → 423 ACCOUNT_LOCKED', async () => {
        mockFindByHash.mockResolvedValue(provider({ loginAttempts: 4 }));
        mockCompare.mockResolvedValue(false);
        mockRegisterFailed.mockResolvedValue({ attempts: 5, locked: true, lockedUntil: new Date(Date.now() + 15 * 60 * 1000) });
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(res.status).toBe(423);
        expect(res.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('already-locked account → 423 ACCOUNT_LOCKED, never reaches bcrypt', async () => {
        mockFindByHash.mockResolvedValue(provider({ isLocked: true, lockedUntil: new Date(Date.now() + 10 * 60 * 1000) }));
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(res.status).toBe(423);
        expect(res.body.code).toBe('ACCOUNT_LOCKED');
        expect(mockCompare).not.toHaveBeenCalled();
        expect(mockRegisterFailed).not.toHaveBeenCalled();
    });

    it('expired lock → auto-unlocks then proceeds to a normal login', async () => {
        mockFindByHash.mockResolvedValue(provider({ isLocked: true, lockedUntil: new Date(Date.now() - 60 * 1000) }));
        mockCompare.mockResolvedValue(true);
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(mockResetLock).toHaveBeenCalledWith('prov-uuid-1');
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBe('signed.provider.token');
    });

    it('happy path → 200, sets httpOnly provider_token cookie, touches last-login', async () => {
        mockFindByHash.mockResolvedValue(provider());
        mockCompare.mockResolvedValue(true);
        const res = await login({ providerId: VALID_ID, password: VALID_PW });
        expect(res.status).toBe(200);
        expect(res.body.data.token).toBe('signed.provider.token');
        // แถวเก่าถือ role:'field_inspector' และ canonicalRole:'field_inspector' ทั้งคู่เป็นคำก่อนรีเนม
        // การล็อกอินต้องยังผ่าน และต้องคืน "คำวันนี้" ให้ client ไม่ใช่คำที่ฐานเก็บไว้
        expect(res.body.data.user.canonicalRole).toBe('field_inspector');
        const setCookie = res.headers['set-cookie'].join(';');
        expect(setCookie).toMatch(/provider_token=/);
        expect(setCookie).toMatch(/HttpOnly/i);
        expect(mockTouchLastLogin).toHaveBeenCalledWith('prov-uuid-1');
    });
});
