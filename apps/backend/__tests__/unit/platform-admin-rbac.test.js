/**
 * SEC-PROV-001 regression — the cross-tenant platform-admin org-management
 * surface must require the new `platform_admin` role. A tenant `admin` (or any
 * other provider role) must be denied; only `platform_admin` may list/create/
 * mutate organizations. `platform_admin` is modelled as a superset root role,
 * so it also satisfies ordinary provider role gates.
 *
 * Uses the REAL requireRole + REAL canonical-rbac so it proves the contract.
 *
 * See docs/handoffs/audit-2026-05-31/security/SEC-PROV.md (SEC-PROV-001).
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        organization: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        user: { create: jest.fn() },
    },
}));
jest.mock('../../services/tenant-context', () => ({ withoutTenantScope: (fn) => fn() }));
jest.mock('../../shared/logger', () => ({
    // role-middleware uses the default logger (logger.warn on the deny path);
    // organizations.js uses createLogger(). Provide both shapes.
    info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

// Header-auth stand-in for authenticateProvider; keep the REAL requireRole so
// the canonical PLATFORM_ADMIN_ONLY gate is genuinely exercised.
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
        req.user = { id: 'u1', role, canonicalRole: role, providerId: 'p1' };
        return next();
    },
    requireRole: require('../../middleware/role-middleware').requireRole,
}));

const { prisma } = require('../../services/prisma-database');
const { requireRole } = require('../../middleware/role-middleware');
const { ROLE_GROUPS } = require('../../shared/canonical-rbac');
const orgRouter = require('../../routes/api/platform-admin/organizations');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/platform-admin/organizations', orgRouter);
    app.use((err, _req, res, _next) => {
        res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
    });
    return app;
}

let app;
beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
});

describe('SEC-PROV-001 — platform-admin org surface requires platform_admin', () => {
    test('tenant ADMIN cannot list organizations (403, no DB read)', async () => {
        const res = await request(app)
            .get('/api/platform-admin/organizations')
            .set('x-test-role', 'system_admin_dtam');
        expect(res.status).toBe(403);
        expect(prisma.organization.findMany).not.toHaveBeenCalled();
    });

    test('tenant ADMIN cannot create an organization (403, no DB write)', async () => {
        const res = await request(app)
            .post('/api/platform-admin/organizations')
            .set('x-test-role', 'system_admin_dtam')
            .send({ name: 'X', slug: 'x-org', code: 'X_ORG' });
        expect(res.status).toBe(403);
        expect(prisma.organization.create).not.toHaveBeenCalled();
    });

    test('SCHEDULER is likewise denied (403)', async () => {
        const res = await request(app)
            .get('/api/platform-admin/organizations')
            .set('x-test-role', 'dispatcher');
        expect(res.status).toBe(403);
    });

    test('platform_admin CAN list organizations (200)', async () => {
        prisma.organization.findMany.mockResolvedValue([]);
        const res = await request(app)
            .get('/api/platform-admin/organizations')
            .set('x-test-role', 'system_admin_platform');
        expect(res.status).toBe(200);
        expect(prisma.organization.findMany).toHaveBeenCalledTimes(1);
    });

    test('platform_admin CAN create an organization (201)', async () => {
        prisma.organization.create.mockResolvedValue({ id: 'org-1', slug: 'x-org', code: 'X_ORG' });
        const res = await request(app)
            .post('/api/platform-admin/organizations')
            .set('x-test-role', 'system_admin_platform')
            .send({ name: 'X', slug: 'x-org', code: 'X_ORG' });
        expect(res.status).toBe(201);
        expect(prisma.organization.create).toHaveBeenCalledTimes(1);
    });
});

describe('platform_admin is a superset root role (requireRole bypass)', () => {
    const run = (role, allowed) => {
        const req = { user: { id: 'u', role } };
        let passed = false;
        let err = null;
        requireRole(allowed)(req, { }, (e) => { if (e) { err = e; } else { passed = true; } });
        return { passed, err };
    };

    test('platform_admin satisfies a scheduler-only gate', () => {
        expect(run('system_admin_platform', ['dispatcher']).passed).toBe(true);
    });

    test('admin does NOT satisfy a scheduler-only gate', () => {
        const { passed, err } = run('system_admin_dtam', ['dispatcher']);
        expect(passed).toBe(false);
        expect(err).toBeTruthy();
    });

    test('platform_admin satisfies the PLATFORM_ADMIN_ONLY group; admin does not', () => {
        expect(run('system_admin_platform', ROLE_GROUPS.PLATFORM_ADMIN_ONLY).passed).toBe(true);
        expect(run('system_admin_dtam', ROLE_GROUPS.PLATFORM_ADMIN_ONLY).passed).toBe(false);
    });
});
