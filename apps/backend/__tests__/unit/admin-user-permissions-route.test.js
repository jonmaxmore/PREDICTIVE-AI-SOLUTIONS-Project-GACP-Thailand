/**
 * admin-user-permissions-route.test.js — per-user permission GRANT/REVOKE
 * admin API (feat/backoffice-per-permission-grants).
 *
 * Surface under test: routes/api/admin/user-permissions.js, mounted at
 * /api/admin/user-permissions under the admin router's
 * authenticateProvider + requireAdmin parent chain.
 *
 *   GET    /:userId              → { userId, role, rolePermissions, grants,
 *                                     effective, catalog }
 *   PUT    /:userId/:permission  → upsert a GRANT/REVOKE row + audit
 *   DELETE /:userId/:permission  → revert to inherit (delete row) + audit
 *
 * Pattern mirrors admin-routes-rbac.test.js:
 *   - auth middleware is header-mocked (x-test-role builds req.user),
 *   - canonical-rbac stays REAL (the test proves the canonical contract +
 *     the effective-permissions engine's real math),
 *   - prisma.userPermissionGrant + provider-user-service.getActiveAdminUserGuard
 *     + audit-logger are mocked,
 *   - effective-permissions-service stays REAL (it receives the mocked
 *     prisma via the route passing { prisma }).
 */

'use strict';

const express = require('express');
const request = require('supertest');

// ── Auth mock (admin-routes-rbac.test.js pattern) ──────────────────────────
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
            healthId: role === 'health' ? (req.headers['x-test-health-id'] || 'health-1') : null,
            providerId: role !== 'health' ? (req.headers['x-test-provider-id'] || 'provider-1') : null,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    const requireRole = () => (_req, _res, next) => next();
    return {
        authenticateHealth: buildHeaderUser,
        authenticateAny: buildHeaderUser,
        authenticateProvider: buildHeaderUser,
        authenticateDTAM: buildHeaderUser,
        authenticate: buildHeaderUser,
        requireRole,
        optionalAuth: buildHeaderUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL — proves the canonical contract + real engine math.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));
jest.mock('../../services/effective-permissions-service', () => jest.requireActual('../../services/effective-permissions-service'));

// ── provider-user-service: only getActiveAdminUserGuard is used by the route ─
const mockGetActiveAdminUserGuard = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    getActiveAdminUserGuard: (...args) => mockGetActiveAdminUserGuard(...args),
    // The RBAC matrix mount pulls the whole admin router (users.js needs these).
    createProviderUser: jest.fn(),
    searchAdminUsers: jest.fn(),
    updateAdminUser: jest.fn(),
}));

// ── prisma.userPermissionGrant — the grant table the route mutates ──────────
const mockGrantFindMany = jest.fn();
const mockGrantFindUnique = jest.fn();
const mockGrantUpsert = jest.fn();
const mockGrantDelete = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        userPermissionGrant: {
            findMany: (...args) => mockGrantFindMany(...args),
            findUnique: (...args) => mockGrantFindUnique(...args),
            upsert: (...args) => mockGrantUpsert(...args),
            delete: (...args) => mockGrantDelete(...args),
        },
    },
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = {
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

const mockAuditLog = jest.fn().mockResolvedValue(null);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: (...args) => mockAuditLog(...args),
        logWithin: jest.fn().mockResolvedValue(null),
        isSequenceConflictError: jest.fn(() => false),
    },
    AuditCategory: { ADMIN: 'ADMIN' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));

jest.mock('../../utils/client-ip', () => ({ getRequestIp: jest.fn(() => '127.0.0.1') }));

const userPermissionsRouter = require('../../routes/api/admin/user-permissions');

function buildApp() {
    const app = express();
    app.use(express.json());
    // Inline the parent auth+admin gate so the route runs like it does in prod
    // (mirror admin/index.js: authenticateProvider → requireAdmin).
    const { authenticateProvider } = require('../../middleware/auth-middleware');
    const { requireAdmin } = require('../../middleware/require-admin');
    app.use('/api/admin/user-permissions', authenticateProvider, requireAdmin, userPermissionsRouter);
    return app;
}

const TARGET = {
    id: 'target-1',
    role: 'dispatcher', // legacy DB storage → canonical 'dispatcher'
    status: 'ACTIVE',
    organizationId: 'org-1',
    firstName: 'Somchai',
    lastName: 'Scheduler',
    email: 'somchai@example.com',
};

function adminReq(app, method, path) {
    return request(app)[method](path)
        .set('x-test-role', 'system_admin_dtam')
        .set('x-test-user-id', 'admin-1')
        .set('x-test-organization-id', 'org-1');
}

describe('GET /api/admin/user-permissions/:userId', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetActiveAdminUserGuard.mockResolvedValue({ ...TARGET });
        mockGrantFindMany.mockResolvedValue([]);
    });

    test('returns role, rolePermissions, effective, grants, and the catalog', async () => {
        const res = await adminReq(app, 'get', '/api/admin/user-permissions/target-1').send();
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const data = res.body.data;
        expect(data.userId).toBe('target-1');
        // Legacy 'dispatcher' normalises to canonical 'dispatcher' (รีเนม 2026-09-10).
        expect(data.role).toBe('dispatcher');
        // The scheduler baseline includes application.schedule.
        expect(data.rolePermissions).toEqual(expect.arrayContaining(['application.schedule']));
        expect(data.effective).toEqual(expect.arrayContaining(['application.schedule']));
        expect(Array.isArray(data.grants)).toBe(true);
        // Catalog = every PERMISSIONS value mapped to { key, label } (Thai label).
        expect(Array.isArray(data.catalog)).toBe(true);
        expect(data.catalog.length).toBeGreaterThan(10);
        const one = data.catalog.find((c) => c.key === 'report.export');
        expect(one).toBeTruthy();
        expect(typeof one.label).toBe('string');
        expect(one.label.length).toBeGreaterThan(0);
    });

    test('a GRANT row shows up in effective', async () => {
        mockGrantFindMany.mockResolvedValue([{ permission: 'users.manage', effect: 'GRANT' }]);
        const res = await adminReq(app, 'get', '/api/admin/user-permissions/target-1').send();
        expect(res.status).toBe(200);
        expect(res.body.data.effective).toEqual(expect.arrayContaining(['users.manage']));
        expect(res.body.data.grants).toEqual([{ permission: 'users.manage', effect: 'GRANT' }]);
    });

    test('cross-tenant target 404s (guard returns null)', async () => {
        mockGetActiveAdminUserGuard.mockResolvedValue(null);
        const res = await adminReq(app, 'get', '/api/admin/user-permissions/other-org-user').send();
        expect(res.status).toBe(404);
        expect(mockGrantFindMany).not.toHaveBeenCalled();
    });
});

describe('PUT /api/admin/user-permissions/:userId/:permission', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetActiveAdminUserGuard.mockResolvedValue({ ...TARGET });
        mockGrantFindUnique.mockResolvedValue(null);
        mockGrantFindMany.mockResolvedValue([]);
        mockGrantUpsert.mockResolvedValue({});
    });

    test('GRANT persists, audits, and is reflected in effective', async () => {
        // After upsert the GET-payload refetch reads the new grant back.
        mockGrantFindMany.mockResolvedValue([{ permission: 'users.manage', effect: 'GRANT' }]);
        const res = await adminReq(app, 'put', '/api/admin/user-permissions/target-1/users.manage')
            .send({ effect: 'GRANT', reason: 'delegated admin for onboarding sprint' });
        expect(res.status).toBe(200);
        expect(mockGrantUpsert).toHaveBeenCalledTimes(1);
        const upsertArgs = mockGrantUpsert.mock.calls[0][0];
        expect(upsertArgs.where).toEqual({ userId_permission: { userId: 'target-1', permission: 'users.manage' } });
        expect(upsertArgs.update).toMatchObject({ effect: 'GRANT', reason: 'delegated admin for onboarding sprint', grantedBy: 'admin-1' });
        expect(upsertArgs.create).toMatchObject({ userId: 'target-1', permission: 'users.manage', effect: 'GRANT', organizationId: 'org-1' });
        // audit
        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        expect(mockAuditLog.mock.calls[0][0]).toMatchObject({ action: 'USER_PERMISSION_GRANTED', severity: 'WARNING' });
        // fresh payload reflects the grant
        expect(res.body.data.effective).toEqual(expect.arrayContaining(['users.manage']));
    });

    test('REVOKE persists and audits USER_PERMISSION_REVOKED', async () => {
        const res = await adminReq(app, 'put', '/api/admin/user-permissions/target-1/report.export')
            .send({ effect: 'REVOKE', reason: 'segregation of duties — no export' });
        expect(res.status).toBe(200);
        expect(mockGrantUpsert).toHaveBeenCalledTimes(1);
        expect(mockGrantUpsert.mock.calls[0][0].update).toMatchObject({ effect: 'REVOKE' });
        expect(mockAuditLog.mock.calls[0][0]).toMatchObject({ action: 'USER_PERMISSION_REVOKED' });
    });

    test('invalid permission → 400 INVALID_PERMISSION and no write', async () => {
        const res = await adminReq(app, 'put', '/api/admin/user-permissions/target-1/not.a.real.permission')
            .send({ effect: 'GRANT', reason: 'this should never persist' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PERMISSION');
        expect(mockGrantUpsert).not.toHaveBeenCalled();
    });

    test('invalid effect → 400 and no write', async () => {
        const res = await adminReq(app, 'put', '/api/admin/user-permissions/target-1/report.export')
            .send({ effect: 'MAYBE', reason: 'nonsense effect' });
        expect(res.status).toBe(400);
        expect(mockGrantUpsert).not.toHaveBeenCalled();
    });

    test('missing / too-short reason → 400 and no write', async () => {
        const res = await adminReq(app, 'put', '/api/admin/user-permissions/target-1/report.export')
            .send({ effect: 'GRANT', reason: 'no' });
        expect(res.status).toBe(400);
        expect(mockGrantUpsert).not.toHaveBeenCalled();
    });

    test('self-target → 403 SELF_PERMISSION_CHANGE_FORBIDDEN and no write', async () => {
        // admin editing their OWN permissions (id === req.user.id).
        const res = await request(app).put('/api/admin/user-permissions/admin-1/users.manage')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'admin-1')
            .set('x-test-organization-id', 'org-1')
            .send({ effect: 'GRANT', reason: 'trying to self-escalate' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('SELF_PERMISSION_CHANGE_FORBIDDEN');
        expect(mockGrantUpsert).not.toHaveBeenCalled();
    });

    test('cross-tenant target → 404 and no write', async () => {
        mockGetActiveAdminUserGuard.mockResolvedValue(null);
        const res = await adminReq(app, 'put', '/api/admin/user-permissions/other-org-user/users.manage')
            .send({ effect: 'GRANT', reason: 'cross tenant attempt blocked' });
        expect(res.status).toBe(404);
        expect(mockGrantUpsert).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/admin/user-permissions/:userId/:permission', () => {
    let app;
    beforeAll(() => { app = buildApp(); });
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetActiveAdminUserGuard.mockResolvedValue({ ...TARGET });
        mockGrantFindMany.mockResolvedValue([]);
        mockGrantDelete.mockResolvedValue({});
    });

    test('reverts a grant to inherit (deletes the row) + audits USER_PERMISSION_RESET', async () => {
        const res = await adminReq(app, 'delete', '/api/admin/user-permissions/target-1/users.manage').send();
        expect(res.status).toBe(200);
        expect(mockGrantDelete).toHaveBeenCalledTimes(1);
        expect(mockGrantDelete.mock.calls[0][0].where).toEqual({ userId_permission: { userId: 'target-1', permission: 'users.manage' } });
        expect(mockAuditLog.mock.calls[0][0]).toMatchObject({ action: 'USER_PERMISSION_RESET' });
    });

    test('self-target → 403 and no delete', async () => {
        const res = await request(app).delete('/api/admin/user-permissions/admin-1/users.manage')
            .set('x-test-role', 'system_admin_dtam')
            .set('x-test-user-id', 'admin-1')
            .set('x-test-organization-id', 'org-1')
            .send();
        expect(res.status).toBe(403);
        expect(mockGrantDelete).not.toHaveBeenCalled();
    });

    test('cross-tenant target → 404 and no delete', async () => {
        mockGetActiveAdminUserGuard.mockResolvedValue(null);
        const res = await adminReq(app, 'delete', '/api/admin/user-permissions/other-org-user/users.manage').send();
        expect(res.status).toBe(404);
        expect(mockGrantDelete).not.toHaveBeenCalled();
    });

    test('deleting a non-existent grant (P2025) is idempotent — still 200', async () => {
        const err = new Error('Record to delete does not exist.');
        err.code = 'P2025';
        mockGrantDelete.mockRejectedValue(err);
        const res = await adminReq(app, 'delete', '/api/admin/user-permissions/target-1/users.manage').send();
        expect(res.status).toBe(200);
    });
});
