/**
 * P0-B — /admin/users console FE↔BE contract (class-guard).
 *
 * The FE admin console (apps/web-app/src/app/admin/users/page.tsx +
 * lib/services/admin-service-b28.ts) drifted against its own backend:
 *
 *   1. FE reads `isActive` / `isLocked` / `username` / `lastLoginAt` but
 *      mapUser (routes/api/admin/users.js) emitted NONE of them →
 *      every row rendered "ถูกระงับ" (isActive undefined = falsy), KPI
 *      counters were wrong, and UserDisableModal (isActive ? disable :
 *      enable) ALWAYS called enable → 409 ALREADY_ACTIVE. Disable was
 *      IMPOSSIBLE from this page.
 *   2. FE sends `q` + `status`; BE destructured only `search` and had no
 *      status filter → both params silently ignored.
 *   3. A 13-digit ID search did plaintext `contains` on providerId /
 *      healthId — those columns hold `enc:v1:` ciphertext under
 *      ENABLE_PDPA_FIELD_ENCRYPTION=true (LIVE prod) → zero matches.
 *      Exact-match must go through the keyed lookup columns
 *      (healthIdHmac / providerIdHmac via computeLookupHmac).
 *
 * Pattern: supertest + header-auth mock from admin-routes-rbac.test.js —
 * auth middleware mock attaches req.user from x-test-* headers,
 * canonical-rbac stays REAL, service layer (searchAdminUsers) is spied so
 * the WHERE handed to it can be asserted. field-encryption stays REAL so
 * the expected HMACs are computed by the same function the route uses
 * (NODE_ENV=test has a deterministic fallback ENCRYPTION_KEY).
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (V5-B / admin-routes-rbac pattern) ───────────────────────────
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'admin-1',
            email: req.headers['x-test-email'] || 'admin-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            providerId: req.headers['x-test-provider-id'] || 'provider-1',
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole: () => (_req, _res, next) => next(),
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL — the test proves the canonical contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// ── Service-layer mocks ─────────────────────────────────────────────────────
const mockSearchAdminUsers = jest.fn();
const mockCreateProviderUser = jest.fn();
const mockGetActiveAdminUserGuard = jest.fn();
const mockUpdateAdminUser = jest.fn();

jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: (...args) => mockCreateProviderUser(...args),
    searchAdminUsers: (...args) => mockSearchAdminUsers(...args),
    getActiveAdminUserGuard: (...args) => mockGetActiveAdminUserGuard(...args),
    updateAdminUser: (...args) => mockUpdateAdminUser(...args),
}));

// admin-user-service — the GET path under test never reaches the mutators;
// mocked so requiring the route does not drag prisma-database in.
jest.mock('../../services/admin-user-service', () => ({
    enableUser: jest.fn(),
    changeUserRole: jest.fn(),
    disableUser: jest.fn(),
    assertNotLastActiveAdmin: jest.fn(),
}));

// prisma-database — defensive: nothing on the GET path may touch it.
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../shared/logger', () => {
    const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLog, createLogger: jest.fn(() => mockLog) };
});

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { ADMIN: 'ADMIN' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));

// field-encryption stays REAL — computeLookupHmac is the exact function the
// keyed-lookup columns are populated with (test env uses the deterministic
// NODE_ENV=test fallback key), so the expected values below cannot drift.
const { computeLookupHmac } = require('../../utils/field-encryption');

const usersRouter = require('../../routes/api/admin/users');
const { authenticateProvider } = require('../../middleware/auth-middleware');
// S4: golden rule #3 — the list catch must logger.error the cause before
// returning the generic 500. The shared/logger mock above exposes the spies.
const logger = require('../../shared/logger');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(authenticateProvider);
    app.use('/api/admin/users', usersRouter);
    return app;
}

// Valid Mod-11 Thai national ID (same class of value the FE search box takes).
const THAI_ID = '1186494077533';

const FIXTURE_ROW = Object.freeze({
    id: 'u-somchai',
    email: 'somchai.r@example.com',
    firstName: 'Somchai',
    lastName: 'Rakdee',
    role: 'field_inspector',
    accountType: 'PROVIDER',
    authType: 'PROVIDER_ID',
    status: 'ACTIVE',
    providerId: '1234567890123',
    healthId: null,
    username: 'somchai.r',
    lastLoginAt: new Date('2026-06-30T12:00:00.000Z'),
    lockedUntil: null,
    isLocked: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-30T00:00:00.000Z'),
});

function lastSearchWhere() {
    expect(mockSearchAdminUsers).toHaveBeenCalled();
    const call = mockSearchAdminUsers.mock.calls[mockSearchAdminUsers.mock.calls.length - 1][0];
    return call.where;
}

describe('P0-B /admin/users console contract', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchAdminUsers.mockResolvedValue({ rows: [FIXTURE_ROW], total: 1 });
    });

    describe('query params the FE actually sends (q + status)', () => {
        it('GET /?q=somchai&status=ACTIVE threads BOTH into the WHERE', async () => {
            const response = await request(app)
                .get('/api/admin/users?q=somchai&status=ACTIVE')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const where = lastSearchWhere();
            // q → the same OR search the legacy `search` param produced.
            expect(where.OR).toEqual(expect.arrayContaining([
                { email: { contains: 'somchai', mode: 'insensitive' } },
                { firstName: { contains: 'somchai', mode: 'insensitive' } },
                { lastName: { contains: 'somchai', mode: 'insensitive' } },
            ]));
            // status → equality filter.
            expect(where.status).toBe('ACTIVE');
        });

        it('legacy ?search= keeps working (alias, not replacement)', async () => {
            const response = await request(app)
                .get('/api/admin/users?search=somchai')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const where = lastSearchWhere();
            expect(where.OR).toEqual(expect.arrayContaining([
                { email: { contains: 'somchai', mode: 'insensitive' } },
            ]));
        });

        it('status=DISABLED (FE "ถูกระงับ" option) maps to the stored INACTIVE status', async () => {
            const response = await request(app)
                .get('/api/admin/users?status=DISABLED')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            expect(lastSearchWhere().status).toBe('INACTIVE');
        });

        it('status=BOGUS → 400 and the search never fires', async () => {
            const response = await request(app)
                .get('/api/admin/users?status=BOGUS')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(mockSearchAdminUsers).not.toHaveBeenCalled();
        });

        // S3: NO code path ever writes status='LOCKED' (locks live in the
        // isLocked/lockedUntil columns) — where.status='LOCKED' returned a
        // guaranteed-empty list. The filter must target the lock column.
        it('status=LOCKED filters on isLocked=true, never on the never-written status value', async () => {
            const response = await request(app)
                .get('/api/admin/users?status=LOCKED')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const where = lastSearchWhere();
            expect(where.isLocked).toBe(true);
            expect(where.status).toBeUndefined();
        });

        it('other statuses keep the plain status equality filter', async () => {
            const response = await request(app)
                .get('/api/admin/users?status=SUSPENDED')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const where = lastSearchWhere();
            expect(where.status).toBe('SUSPENDED');
            expect(where.isLocked).toBeUndefined();
        });
    });

    // S4(a): the list catch used to swallow the cause entirely (generic 500,
    // no logger call) — golden rule #3: log the cause before degrading.
    describe('list failure diagnostics', () => {
        it('500s generically but logger.errors the cause (no PII echo)', async () => {
            mockSearchAdminUsers.mockRejectedValue(new Error('db exploded'));

            const response = await request(app)
                .get('/api/admin/users')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(500);
            expect(response.body).toEqual({ success: false, error: 'Failed to fetch users' });
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('[admin/users] list failed'),
                'db exploded',
            );
        });
    });

    // S1 (change-vs-presence) on PATCH /:id/role: the endpoint requires role
    // and/or status to be PRESENT, but the console can re-submit the current
    // values — a before==after write must NOT evict the target's session.
    describe('PATCH /:id/role session-epoch stamp keys on REAL change', () => {
        const GUARD_ROW = Object.freeze({
            id: 'u-1',
            role: 'field_inspector',
            status: 'ACTIVE',
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
            providerId: '1234567890123',
            healthId: null,
            organizationId: 'org-1',
        });

        beforeEach(() => {
            mockGetActiveAdminUserGuard.mockResolvedValue({ ...GUARD_ROW });
            mockUpdateAdminUser.mockResolvedValue({ ...FIXTURE_ROW, id: 'u-1' });
        });

        function lastUpdateData() {
            expect(mockUpdateAdminUser).toHaveBeenCalled();
            const call = mockUpdateAdminUser.mock.calls[mockUpdateAdminUser.mock.calls.length - 1];
            return call[1];
        }

        it('unchanged role (auditor → AUDITOR) does NOT stamp sessionsRevokedAt', async () => {
            const response = await request(app)
                .patch('/api/admin/users/u-1/role')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'field_inspector' });

            expect(response.status).toBe(200);
            expect(lastUpdateData()).not.toHaveProperty('sessionsRevokedAt');
        });

        it('real role change (auditor → scheduler) stamps sessionsRevokedAt', async () => {
            const response = await request(app)
                .patch('/api/admin/users/u-1/role')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'dispatcher' });

            expect(response.status).toBe(200);
            expect(lastUpdateData().sessionsRevokedAt).toBeInstanceOf(Date);
        });

        it('unchanged status (ACTIVE → ACTIVE) does NOT stamp', async () => {
            const response = await request(app)
                .patch('/api/admin/users/u-1/role')
                .set('x-test-role', 'system_admin_dtam')
                .send({ status: 'ACTIVE' });

            expect(response.status).toBe(200);
            expect(lastUpdateData()).not.toHaveProperty('sessionsRevokedAt');
        });

        it('real status change (ACTIVE → SUSPENDED) stamps', async () => {
            const response = await request(app)
                .patch('/api/admin/users/u-1/role')
                .set('x-test-role', 'system_admin_dtam')
                .send({ status: 'SUSPENDED' });

            expect(response.status).toBe(200);
            expect(lastUpdateData().sessionsRevokedAt).toBeInstanceOf(Date);
        });
    });

    describe('13-digit ID search under PDPA field encryption', () => {
        it('exactly-13-digit query searches the keyed HMAC lookup columns, never plaintext contains', async () => {
            const response = await request(app)
                .get(`/api/admin/users?q=${THAI_ID}`)
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const where = lastSearchWhere();
            const expectedHmac = computeLookupHmac(THAI_ID);
            expect(where.OR).toEqual(expect.arrayContaining([
                { healthIdHmac: expectedHmac },
                { providerIdHmac: expectedHmac },
            ]));
            // Plaintext contains on the encrypted columns can only match
            // `enc:v1:` ciphertext noise — it must be GONE.
            for (const clause of where.OR) {
                expect(clause).not.toHaveProperty('healthId');
                expect(clause).not.toHaveProperty('providerId');
            }
            // email/name contains stay (harmless) so the OR still covers them.
            expect(where.OR).toEqual(expect.arrayContaining([
                { email: { contains: THAI_ID, mode: 'insensitive' } },
            ]));
        });

        it('dash-separated 13-digit query (1-1864-94077-53-3) is normalized before hashing', async () => {
            const response = await request(app)
                .get('/api/admin/users?q=1-1864-94077-53-3')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const where = lastSearchWhere();
            expect(where.OR).toEqual(expect.arrayContaining([
                { healthIdHmac: computeLookupHmac(THAI_ID) },
                { providerIdHmac: computeLookupHmac(THAI_ID) },
            ]));
        });

        it('non-13-digit query DROPS the plaintext providerId/healthId contains entirely', async () => {
            const response = await request(app)
                .get('/api/admin/users?q=somchai')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const where = lastSearchWhere();
            for (const clause of where.OR) {
                expect(clause).not.toHaveProperty('healthId');
                expect(clause).not.toHaveProperty('providerId');
                expect(clause).not.toHaveProperty('healthIdHmac');
                expect(clause).not.toHaveProperty('providerIdHmac');
            }
        });
    });

    describe('response fields the FE reads (page.tsx contract)', () => {
        it('rows carry isActive / isLocked / username / lastLoginAt', async () => {
            const response = await request(app)
                .get('/api/admin/users')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const row = response.body.data.users[0];
            expect(row.isActive).toBe(true);
            expect(row.isLocked).toBe(false);
            expect(row.username).toBe('somchai.r');
            expect(row.lastLoginAt).toBeTruthy();
        });

        it('non-ACTIVE status → isActive:false; isLocked follows the lock column', async () => {
            mockSearchAdminUsers.mockResolvedValue({
                rows: [{
                    ...FIXTURE_ROW,
                    id: 'u-locked',
                    status: 'INACTIVE',
                    isLocked: true,
                    lockedUntil: new Date('2027-01-01T00:00:00.000Z'),
                }],
                total: 1,
            });

            const response = await request(app)
                .get('/api/admin/users')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const row = response.body.data.users[0];
            expect(row.isActive).toBe(false);
            expect(row.isLocked).toBe(true);
        });

        it('username falls back to the email local-part, never the raw 13-digit id', async () => {
            mockSearchAdminUsers.mockResolvedValue({
                rows: [{ ...FIXTURE_ROW, id: 'u-nouser', username: undefined }],
                total: 1,
            });

            const response = await request(app)
                .get('/api/admin/users')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const row = response.body.data.users[0];
            expect(row.username).toBe('somchai.r');
            // PDPA: the raw 13-digit identifier must not leak anywhere.
            expect(JSON.stringify(response.body)).not.toContain('1234567890123');
        });

        it('healthId/providerId masking is preserved (existing PDPA contract)', async () => {
            const response = await request(app)
                .get('/api/admin/users')
                .set('x-test-role', 'system_admin_dtam');

            expect(response.status).toBe(200);
            const row = response.body.data.users[0];
            expect(row.providerId).toMatch(/^\d-\*{4}-\*{5}-\*{2}-\d$/);
            expect(JSON.stringify(response.body)).not.toContain('1234567890123');
        });
    });
});
