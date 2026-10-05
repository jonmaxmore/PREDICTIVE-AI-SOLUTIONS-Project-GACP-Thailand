/**
 * P0-D — staff-directory hardening (routes/api/system/provider.js).
 *
 * The /api/system/providers surface is the SECOND staff-management surface
 * (the working FE console /provider/management uses it). Before this fix it
 * had these verified holes:
 *
 *   1. PATCH/PUT accepted `providerId` edits and wrote plaintext + legacy
 *      providerIdHash only. Under the LIVE prod flags (AUTH_LOOKUP_USE_HMAC
 *      + APP_FK_USE_TOKEN) an edited user could NO LONGER LOG IN (login
 *      resolves via providerIdHmac, never rewritten) and their canonicalId
 *      FK token went stale. Owner decision: FORBID the edit entirely
 *      (400 PROVIDER_ID_EDIT_FORBIDDEN); identical value = idempotent no-op.
 *   2. PATCH/PUT/DELETE looked the target up by raw id — a tenant ADMIN
 *      could mutate users of ANY org. Now tenant-scoped findFirst → 404
 *      (no cross-tenant existence disclosure). PLATFORM_ADMIN (the only
 *      cross-tenant role) bypasses the org filter.
 *   3. role/isActive/password changes did not stamp sessionsRevokedAt, so
 *      the target's live 12h JWT survived the mutation (P0-A class).
 *   4. No self-guards (own isActive) / last-admin guard — an admin could
 *      disable themselves or demote/disable/delete the org's final ADMIN,
 *      permanently locking the tenant out of permission control.
 *   5. No before/after audit row on directory role changes.
 *   6. GET /roles served a hardcoded 5-entry list missing the Tier-16
 *      ACCOUNT_DTAM / ACCOUNT_PLATFORM roles.
 *
 * Pattern: supertest + header-driven auth mock (admin-routes-rbac.test.js),
 * canonical-rbac kept REAL via jest.requireActual so the tests prove the
 * actual canonical contract. admin-user-service is REAL too (the last-admin
 * policy under test) — only its prisma reach (provider-user-service
 * .countOtherActiveAdmins) is mocked.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (V1-D…V5-B header-driven pattern) ─────────────────────────────
jest.mock('../../middleware/auth-middleware', () => {
    const buildHeaderUser = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'admin-1',
            email: req.headers['x-test-email'] || 'admin-1@example.com',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || '9999999999999') : null,
            healthId: role === 'health' ? 'health-1' : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    return {
        authenticateProvider: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateHealth: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole: () => (_req, _res, next) => next(),
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL — these tests prove the canonical contract.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

jest.mock('../../shared/logger', () => {
    const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...mockLog, createLogger: jest.fn(() => mockLog), stream: { write: jest.fn() } };
});

// ── Prisma mock ─────────────────────────────────────────────────────────────
const mockUserFindFirst = jest.fn();
const mockUserUpdate = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: (...args) => mockUserFindFirst(...args),
            update: (...args) => mockUserUpdate(...args),
            findUnique: jest.fn().mockResolvedValue(null),
        },
    },
}));

// S6: findMutationTarget / loadProviderTarget do their OWN explicit org
// filtering (incl. the PLATFORM_ADMIN bypass), so the route must run them
// inside withoutTenantScope — otherwise the TENANT_READ_ORG_SCOPE prisma
// extension (ON on staging+prod) spreads `organizationId: ctx.org` over the
// WHERE and clobbers the bypass. Pass-through mock that records invocations.
const mockWithoutTenantScope = jest.fn((fn) => fn());
jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (...args) => mockWithoutTenantScope(...args),
    runWithTenantContext: (_ctx, fn) => fn(),
}));

// provider-user-service — mocked: backs the directory read utils AND the
// REAL admin-user-service.assertNotLastActiveAdmin (countOtherActiveAdmins).
const mockCountOtherActiveAdmins = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: jest.fn(),
    listAllUsersForProviderDirectory: jest.fn().mockResolvedValue([]),
    findUserForProviderDirectory: jest.fn().mockResolvedValue(null),
    findActiveProviderReviewerById: jest.fn(),
    countOtherActiveAdmins: (...args) => mockCountOtherActiveAdmins(...args),
    getActiveAdminUserGuard: jest.fn(),
    updateAdminUser: jest.fn(),
}));

// Audit spy — best-effort emission is asserted (and must never block).
const mockAuditLog = jest.fn().mockResolvedValue(null);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...args) => mockAuditLog(...args) },
    AuditCategory: { ADMIN: 'ADMIN' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));

jest.mock('../../utils/client-ip', () => ({
    getRequestIp: jest.fn(() => '127.0.0.1'),
}));

jest.mock('../../utils/field-encryption', () => ({
    maskThaiId: jest.fn((value) => (value ? `MASKED(${value})` : null)),
}));

// bcryptjs — real hashing is slow (12 rounds); the PUT password test only
// asserts the epoch stamp, not the hash value.
jest.mock('bcryptjs', () => ({
    hash: jest.fn(async (pw) => `hashed:${pw}`),
}));

// Pulled after mocks so requires resolve to the stubs above.
const systemProviderRouter = require('../../routes/api/system/provider');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/system/providers', systemProviderRouter);
    return app;
}

// ── Fixture: the mutation target lives in org-1 ─────────────────────────────
const TARGET = Object.freeze({
    id: 'target-1',
    uuid: 'uuid-target-1',
    email: 'target@dtam.go.th',
    firstName: 'Target',
    lastName: 'User',
    role: 'document_reviewer',
    status: 'ACTIVE',
    providerId: '1234567890123',
    accountType: 'PROVIDER',
    organizationId: 'org-1',
    isDeleted: false,
    lastLoginAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    // Lifecycle columns the unlock route branches on (twoFactorEnabled kept
    // on the fixture: nothing may clear it — second-factor-doors.test.js).
    isLocked: false,
    twoFactorEnabled: false,
});

// Honest findFirst: applies the WHERE clause fields the route is expected to
// thread (id / isDeleted / organizationId) against the fixture row. If the
// route FORGETS the org filter, the cross-tenant test gets the row back and
// fails loudly — this is what makes the 404 assertion load-bearing.
function seedFindFirst(row = TARGET) {
    mockUserFindFirst.mockImplementation(async ({ where } = {}) => {
        if (!where) { return row; }
        if (where.id !== undefined && where.id !== row.id) { return null; }
        if (where.isDeleted !== undefined && where.isDeleted !== row.isDeleted) { return null; }
        if (where.organizationId !== undefined && where.organizationId !== row.organizationId) { return null; }
        return row;
    });
}

function lastUpdateArg() {
    expect(mockUserUpdate).toHaveBeenCalled();
    return mockUserUpdate.mock.calls[mockUserUpdate.mock.calls.length - 1][0];
}

describe('P0-D staff-directory hardening — /api/system/providers', () => {
    let app;

    beforeAll(() => {
        app = buildApp();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        seedFindFirst();
        mockCountOtherActiveAdmins.mockResolvedValue(2);
        mockUserUpdate.mockResolvedValue({
            ...TARGET,
            role: 'dispatcher',
        });
        mockAuditLog.mockResolvedValue(null);
    });

    // ── 1. providerId edits are FORBIDDEN (owner decision — no dual-write) ──
    describe('providerId edit forbid', () => {
        for (const method of ['patch', 'put']) {
            const M = method.toUpperCase();

            test(`${M} /:id — differing providerId → 400 PROVIDER_ID_EDIT_FORBIDDEN, no write`, async () => {
                const res = await request(app)[method]('/api/system/providers/target-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .send({ providerId: '3210987654321' });
                expect(res.status).toBe(400);
                expect(res.body.code).toBe('PROVIDER_ID_EDIT_FORBIDDEN');
                expect(mockUserUpdate).not.toHaveBeenCalled();
            });

            test(`${M} /:id — identical providerId is an idempotent no-op (2xx, providerId NOT in update data)`, async () => {
                const res = await request(app)[method]('/api/system/providers/target-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .send({ providerId: TARGET.providerId, firstName: 'Renamed' });
                expect(res.status).toBeLessThan(400);
                const arg = lastUpdateArg();
                expect(arg.data).not.toHaveProperty('providerId');
                expect(arg.data).not.toHaveProperty('providerIdHash');
                expect(arg.data.firstName).toBe('Renamed');
            });

            test(`${M} /:id — dashed-but-identical providerId also passes as no-op`, async () => {
                const res = await request(app)[method]('/api/system/providers/target-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .send({ providerId: '1-2345-67890-12-3', firstName: 'Renamed' });
                expect(res.status).toBeLessThan(400);
                expect(lastUpdateArg().data).not.toHaveProperty('providerId');
            });
        }
    });

    // ── 2. Tenant-scoped target lookup ──────────────────────────────────────
    describe('tenant scope on PATCH/PUT/DELETE', () => {
        for (const method of ['patch', 'put']) {
            const M = method.toUpperCase();

            test(`${M} /:id — cross-tenant target → 404, no write (no existence disclosure)`, async () => {
                const res = await request(app)[method]('/api/system/providers/target-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .set('x-test-organization-id', 'org-2')
                    .send({ firstName: 'Hijack' });
                expect(res.status).toBe(404);
                expect(mockUserUpdate).not.toHaveBeenCalled();
            });

            test(`${M} /:id — PLATFORM_ADMIN bypasses the org filter (cross-tenant role)`, async () => {
                const res = await request(app)[method]('/api/system/providers/target-1')
                    .set('x-test-role', 'system_admin_platform')
                    .set('x-test-organization-id', 'org-2')
                    .send({ firstName: 'PlatformEdit' });
                expect(res.status).toBeLessThan(400);
                expect(mockUserUpdate).toHaveBeenCalled();
            });
        }

        test('DELETE /:id — cross-tenant target → 404, no write', async () => {
            const res = await request(app).delete('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .set('x-test-organization-id', 'org-2')
                .send();
            expect(res.status).toBe(404);
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test('same-tenant PATCH still works (positive control)', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ firstName: 'SameOrg' });
            expect(res.status).toBeLessThan(400);
            expect(mockUserUpdate).toHaveBeenCalled();
        });
    });

    // ── 3. Session-epoch stamp (P0-A class) ─────────────────────────────────
    describe('session-epoch stamp on role/isActive/password changes', () => {
        test('PATCH role change stamps sessionsRevokedAt', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'dispatcher' });
            expect(res.status).toBeLessThan(400);
            const arg = lastUpdateArg();
            expect(arg.data.sessionsRevokedAt).toBeInstanceOf(Date);
        });

        test('PATCH isActive change stamps sessionsRevokedAt', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ isActive: false });
            expect(res.status).toBeLessThan(400);
            expect(lastUpdateArg().data.sessionsRevokedAt).toBeInstanceOf(Date);
        });

        // มติ operator 2026-09-26: ประตูไดเรกทอรีไม่เขียนรหัสผ่านอีก (เคยตรึงว่า PUT password ประทับ epoch)
        // พฤติกรรมเต็มอยู่ที่ staff-password-doors.test.js
        test('PUT password → 400 DIRECTORY_PASSWORD_WRITE_FORBIDDEN, no write at all', async () => {
            const res = await request(app).put('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ password: 'N3wStr0ngPass!' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('DIRECTORY_PASSWORD_WRITE_FORBIDDEN');
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test('PUT isActive change stamps sessionsRevokedAt', async () => {
            const res = await request(app).put('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ isActive: false });
            expect(res.status).toBeLessThan(400);
            expect(lastUpdateArg().data.sessionsRevokedAt).toBeInstanceOf(Date);
        });

        test('PATCH name-only change does NOT stamp sessionsRevokedAt', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ firstName: 'JustAName' });
            expect(res.status).toBeLessThan(400);
            expect(lastUpdateArg().data).not.toHaveProperty('sessionsRevokedAt');
        });

        // S1 CONTRACT CORRECTION (change-vs-presence): stamping used to key
        // on `updateData.role !== undefined` — the console modal always sends
        // role, so EVERY routine edit force-evicted the target's session.
        test('PATCH re-submitting the UNCHANGED role does NOT stamp sessionsRevokedAt', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'document_reviewer', firstName: 'Routine' });
            expect(res.status).toBeLessThan(400);
            expect(lastUpdateArg().data).not.toHaveProperty('sessionsRevokedAt');
        });

        test('PATCH unchanged isActive:true (already ACTIVE) does NOT stamp', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ isActive: true });
            expect(res.status).toBeLessThan(400);
            expect(lastUpdateArg().data).not.toHaveProperty('sessionsRevokedAt');
        });

        test('PUT re-submitting the UNCHANGED role does NOT stamp sessionsRevokedAt', async () => {
            const res = await request(app).put('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'document_reviewer', firstName: 'Routine' });
            expect(res.status).toBeLessThan(400);
            expect(lastUpdateArg().data).not.toHaveProperty('sessionsRevokedAt');
        });

        test('DELETE stamps sessionsRevokedAt on the soft delete', async () => {
            const res = await request(app).delete('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send();
            expect(res.status).toBeLessThan(400);
            const arg = lastUpdateArg();
            expect(arg.data.isDeleted).toBe(true);
            expect(arg.data.sessionsRevokedAt).toBeInstanceOf(Date);
        });
    });

    // ── 4. Self-guards + last-admin guard ───────────────────────────────────
    //
    // S1 CONTRACT CORRECTION (change-vs-presence): the self-guards used to
    // fire on the mere PRESENCE of role/isActive in the body. The management
    // console modal ALWAYS sends role — so admins could not edit their OWN
    // name/email at all. The guards now compare against the EXISTING row and
    // 403 only on a REAL role/status change; the target row therefore has to
    // load first (these tests seed the self row where the old ones didn't).
    describe('self-guards', () => {
        for (const method of ['patch', 'put']) {
            const M = method.toUpperCase();

            test(`${M} /:id — own role CHANGE → 403 SELF_ROLE_CHANGE_FORBIDDEN, no write`, async () => {
                seedFindFirst({ ...TARGET, id: 'admin-1' });
                const res = await request(app)[method]('/api/system/providers/admin-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .set('x-test-user-id', 'admin-1')
                    .send({ role: 'dispatcher' });
                expect(res.status).toBe(403);
                expect(res.body.code).toBe('SELF_ROLE_CHANGE_FORBIDDEN');
                expect(mockUserUpdate).not.toHaveBeenCalled();
            });

            test(`${M} /:id — own status CHANGE → 403 SELF_DISABLE_FORBIDDEN, no write`, async () => {
                seedFindFirst({ ...TARGET, id: 'admin-1' });
                const res = await request(app)[method]('/api/system/providers/admin-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .set('x-test-user-id', 'admin-1')
                    .send({ isActive: false });
                expect(res.status).toBe(403);
                expect(res.body.code).toBe('SELF_DISABLE_FORBIDDEN');
                expect(mockUserUpdate).not.toHaveBeenCalled();
            });

            test(`${M} /:id — own name/email edits stay allowed`, async () => {
                seedFindFirst({ ...TARGET, id: 'admin-1' });
                const res = await request(app)[method]('/api/system/providers/admin-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .set('x-test-user-id', 'admin-1')
                    .send({ firstName: 'SelfRename' });
                expect(res.status).toBeLessThan(400);
                expect(mockUserUpdate).toHaveBeenCalled();
            });

            // S1: the console modal always sends role — re-submitting the
            // CURRENT role alongside a profile edit must not 403 the admin
            // out of editing their own name/email.
            test(`${M} /:id — own edit re-submitting the UNCHANGED role passes as a profile edit`, async () => {
                seedFindFirst({ ...TARGET, id: 'admin-1' });
                const res = await request(app)[method]('/api/system/providers/admin-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .set('x-test-user-id', 'admin-1')
                    .send({ role: 'document_reviewer', firstName: 'SelfRename' });
                expect(res.status).toBeLessThan(400);
                const arg = lastUpdateArg();
                expect(arg.data.firstName).toBe('SelfRename');
                expect(arg.data).not.toHaveProperty('sessionsRevokedAt');
            });

            test(`${M} /:id — own isActive:true while already ACTIVE is a no-op edit, not a 403`, async () => {
                seedFindFirst({ ...TARGET, id: 'admin-1' });
                const res = await request(app)[method]('/api/system/providers/admin-1')
                    .set('x-test-role', 'system_admin_dtam')
                    .set('x-test-user-id', 'admin-1')
                    .send({ isActive: true, firstName: 'StillMe' });
                expect(res.status).toBeLessThan(400);
                expect(lastUpdateArg().data).not.toHaveProperty('sessionsRevokedAt');
            });
        }

        test('DELETE /:id — self-delete → 403 SELF_DISABLE_FORBIDDEN, no write', async () => {
            const res = await request(app).delete('/api/system/providers/admin-1')
                .set('x-test-role', 'system_admin_dtam')
                .set('x-test-user-id', 'admin-1')
                .send();
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('SELF_DISABLE_FORBIDDEN');
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });
    });

    describe('last-admin guard (ROLE_ADMIN_CANNOT_BE_LAST)', () => {
        const ADMIN_TARGET = Object.freeze({ ...TARGET, role: 'system_admin_dtam' });

        test('PATCH demoting the last active ADMIN → 409 + code, no write', async () => {
            seedFindFirst(ADMIN_TARGET);
            mockCountOtherActiveAdmins.mockResolvedValue(0);
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'dispatcher' });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('ROLE_ADMIN_CANNOT_BE_LAST');
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test('PATCH isActive=false on the last active ADMIN → 409 + code, no write', async () => {
            seedFindFirst(ADMIN_TARGET);
            mockCountOtherActiveAdmins.mockResolvedValue(0);
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ isActive: false });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('ROLE_ADMIN_CANNOT_BE_LAST');
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test('DELETE targeting the last active ADMIN → 409 + code, no write', async () => {
            seedFindFirst(ADMIN_TARGET);
            mockCountOtherActiveAdmins.mockResolvedValue(0);
            const res = await request(app).delete('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send();
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('ROLE_ADMIN_CANNOT_BE_LAST');
            expect(mockUserUpdate).not.toHaveBeenCalled();
        });

        test('PATCH demoting an ADMIN when another active admin exists → passes', async () => {
            seedFindFirst(ADMIN_TARGET);
            mockCountOtherActiveAdmins.mockResolvedValue(1);
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'dispatcher' });
            expect(res.status).toBeLessThan(400);
            expect(mockUserUpdate).toHaveBeenCalled();
        });

        test('PATCH demoting a NON-admin target skips the admin count entirely', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'field_inspector' });
            expect(res.status).toBeLessThan(400);
            expect(mockCountOtherActiveAdmins).not.toHaveBeenCalled();
        });
    });

    // ── 5. Audit before/after on directory role changes ─────────────────────
    describe('audit emission (best-effort)', () => {
        test('PATCH role change writes USER_ROLE_UPDATED with before/after metadata', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'dispatcher' });
            expect(res.status).toBeLessThan(400);
            expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
                action: 'USER_ROLE_UPDATED',
                severity: 'WARNING',
                resourceId: TARGET.id,
                metadata: expect.objectContaining({
                    before: { role: TARGET.role, status: TARGET.status },
                    after: expect.objectContaining({ role: 'dispatcher' }),
                    via: 'provider-directory',
                }),
            }));
        });

        test('PATCH name-only change does NOT write the role-update audit row', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ firstName: 'Quiet' });
            expect(res.status).toBeLessThan(400);
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        // S1 CONTRACT CORRECTION: an unchanged-role submit used to write a
        // before==after USER_ROLE_UPDATED row (audit noise). Real change only.
        test('PATCH re-submitting the UNCHANGED role does NOT write a before==after audit row', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'document_reviewer', firstName: 'Routine' });
            expect(res.status).toBeLessThan(400);
            expect(mockAuditLog).not.toHaveBeenCalled();
        });

        test('audit failure NEVER blocks the mutation (best-effort)', async () => {
            mockAuditLog.mockRejectedValue(new Error('audit sink down'));
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ role: 'dispatcher' });
            expect(res.status).toBeLessThan(400);
            expect(mockUserUpdate).toHaveBeenCalled();
        });
    });

    // ── S2 — tenant scope on the admin lifecycle actions ────────────────────
    // unlock (and force-password-reset, retired 2026-09-17 — no account
    // recovery; disable-2fa, retired 2026-09-26 — no one clears another
    // account's 2FA) used an UNSCOPED loadProviderTarget while
    // PATCH/PUT/DELETE were org-walled — a tenant ADMIN could act on another
    // tenant's staff. Same wall as findMutationTarget now.
    // password-reset-routes-behaviour.test.js and second-factor-doors.test.js
    // pin the retired routes as unmounted.
    describe('S2 — tenant scope on unlock', () => {
        const LIFECYCLE_ACTIONS = [
            ['unlock', { isLocked: true }],
        ];

        test.each(LIFECYCLE_ACTIONS)(
            'POST /:id/%s — cross-tenant target → 404, no write',
            async (action, seedOverrides) => {
                seedFindFirst({ ...TARGET, ...seedOverrides });
                const res = await request(app).post(`/api/system/providers/target-1/${action}`)
                    .set('x-test-role', 'system_admin_dtam')
                    .set('x-test-organization-id', 'org-2')
                    .send();
                expect(res.status).toBe(404);
                expect(mockUserUpdate).not.toHaveBeenCalled();
            },
        );

        test.each(LIFECYCLE_ACTIONS)(
            'POST /:id/%s — same-tenant target still works (positive control)',
            async (action, seedOverrides) => {
                seedFindFirst({ ...TARGET, ...seedOverrides });
                mockUserUpdate.mockResolvedValue({ ...TARGET, ...seedOverrides });
                const res = await request(app).post(`/api/system/providers/target-1/${action}`)
                    .set('x-test-role', 'system_admin_dtam')
                    .send();
                expect(res.status).toBeLessThan(400);
                expect(mockUserUpdate).toHaveBeenCalled();
            },
        );
    });

    // ── S6 — explicit org filters run outside the tenant read-scope ─────────
    // findMutationTarget / loadProviderTarget carry their own organizationId
    // WHERE (with the PLATFORM_ADMIN bypass). Under TENANT_READ_ORG_SCOPE
    // (ON on staging+prod) the prisma extension spreads the caller-ctx org
    // over findFirst/count WHEREs — which would clobber the bypass. The
    // lookups must therefore run inside withoutTenantScope.
    describe('S6 — target lookups run inside withoutTenantScope', () => {
        test('PATCH /:id target lookup is wrapped', async () => {
            const res = await request(app).patch('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_dtam')
                .send({ firstName: 'Scoped' });
            expect(res.status).toBeLessThan(400);
            expect(mockWithoutTenantScope).toHaveBeenCalled();
        });

        test('POST /:id/unlock target lookup is wrapped', async () => {
            seedFindFirst({ ...TARGET, isLocked: true });
            const res = await request(app).post('/api/system/providers/target-1/unlock')
                .set('x-test-role', 'system_admin_dtam')
                .send();
            expect(res.status).toBeLessThan(400);
            expect(mockWithoutTenantScope).toHaveBeenCalled();
        });
    });

    // ── 6. GET /roles derived from canonical-rbac ───────────────────────────
    describe('GET /roles', () => {
        test('includes Tier-16 ACCOUNT_DTAM + ACCOUNT_PLATFORM, excludes PLATFORM_ADMIN and HEALTH', async () => {
            const res = await request(app).get('/api/system/providers/roles')
                .set('x-test-role', 'system_admin_dtam');
            expect(res.status).toBe(200);
            const values = res.body.data.map((entry) => entry.value);
            expect(values).toContain('finance_officer_dtam');
            expect(values).toContain('finance_officer_platform');
            expect(values).not.toContain('system_admin_platform');
            expect(values).not.toContain('HEALTH');
        });

        test('keeps the FE-expected value/label shape and the legacy entries', async () => {
            const res = await request(app).get('/api/system/providers/roles')
                .set('x-test-role', 'system_admin_dtam');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            for (const entry of res.body.data) {
                expect(typeof entry.value).toBe('string');
                expect(typeof entry.label).toBe('string');
                expect(entry.label.length).toBeGreaterThan(0);
            }
            const values = res.body.data.map((entry) => entry.value);
            for (const legacy of ['system_admin_dtam', 'document_reviewer', 'dispatcher', 'field_inspector', 'finance_officer_platform']) {
                expect(values).toContain(legacy);
            }
        });
    });

    // ── Gate: only ADMIN (+ PLATFORM_ADMIN) may hit the mutations ───────────
    describe('mutation gate', () => {
        const NON_ADMIN_ROLES = ['document_reviewer', 'dispatcher', 'field_inspector', 'finance_officer_dtam', 'finance_officer_platform', 'finance_officer_platform'];

        for (const method of ['patch', 'put', 'delete']) {
            const M = method.toUpperCase();
            test.each(NON_ADMIN_ROLES)(`${M} /:id — %s role gets 403, no write`, async (role) => {
                const res = await request(app)[method]('/api/system/providers/target-1')
                    .set('x-test-role', role)
                    .send({ firstName: 'Nope' });
                expect(res.status).toBe(403);
                expect(mockUserUpdate).not.toHaveBeenCalled();
            });
        }

        test('DELETE /:id — PLATFORM_ADMIN is allowed through the gate', async () => {
            const res = await request(app).delete('/api/system/providers/target-1')
                .set('x-test-role', 'system_admin_platform')
                .set('x-test-organization-id', 'org-9')
                .send();
            expect(res.status).toBeLessThan(400);
            expect(mockUserUpdate).toHaveBeenCalled();
        });
    });
});
