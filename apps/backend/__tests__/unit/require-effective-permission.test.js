/**
 * Wave 2 — requireEffectivePermission middleware (per-permission gate).
 *
 * Engine-only: this test mounts the middleware on a throwaway express app
 * (it is NOT wired into any real route yet). It proves the effective-
 * permission model end-to-end through the middleware:
 *
 *   role WITH perm, no grants            → 200
 *   role WITHOUT perm, no grants         → 403
 *   role WITHOUT perm + GRANT            → 200
 *   role WITH perm + REVOKE              → 403
 *   two gates in one request             → findMany called ONCE (req cache)
 *
 * Pattern: the header-auth mock + REAL canonical-rbac from
 * admin-routes-rbac.test.js. prisma.userPermissionGrant.findMany is mocked
 * so no DB is touched.
 *
 * Anchor permissions (real ROLE_PERMISSIONS baseline):
 *   - document_reviewer HAS   'application.document.review'
 *   - document_reviewer LACKS 'report.export'
 */

'use strict';

const express = require('express');
const request = require('supertest');

// canonical-rbac stays REAL.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// prisma-database — only userPermissionGrant.findMany is needed.
const mockGrantFindMany = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        userPermissionGrant: { findMany: (...a) => mockGrantFindMany(...a) },
        application: { findUnique: jest.fn() },
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { requireEffectivePermission } = require('../../middleware/role-middleware');
const { PERMISSIONS } = require('../../shared/canonical-rbac');

const REVIEWER_HAS = PERMISSIONS.APPLICATION_DOC_REVIEW; // role holds
const REVIEWER_LACKS = PERMISSIONS.REPORT_EXPORT; // role lacks

// Minimal express error handler mapping AuthorizationError → 403 (like the
// app-level handler). Any thrown/next(err) with statusCode surfaces here.
function errorHandler(err, _req, res, _next) {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ success: false, error: err.message, code: err.code });
}

// Attach req.user from x-test-role header (auth mock).
function headerAuth(req, res, next) {
    const role = req.headers['x-test-role'];
    if (!role) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = {
        id: req.headers['x-test-user-id'] || 'user-1',
        role,
        canonicalRole: req.headers['x-test-canonical-role'] || role,
        organizationId: 'org-1',
    };
    return next();
}

function buildApp(permission) {
    const app = express();
    app.use(express.json());
    app.get('/thing', headerAuth, requireEffectivePermission(permission), (_req, res) => {
        res.json({ success: true });
    });
    app.use(errorHandler);
    return app;
}

// App with TWO gates in one request → proves the req-scoped cache does ONE read.
function buildTwoGateApp(permA, permB) {
    const app = express();
    app.use(express.json());
    app.get(
        '/thing',
        headerAuth,
        requireEffectivePermission(permA),
        requireEffectivePermission(permB),
        (_req, res) => res.json({ success: true }),
    );
    app.use(errorHandler);
    return app;
}

beforeEach(() => {
    mockGrantFindMany.mockReset();
    mockGrantFindMany.mockResolvedValue([]);
});

describe('requireEffectivePermission', () => {
    it('role WITH the permission, no grants → 200', async () => {
        const app = buildApp(REVIEWER_HAS);
        const res = await request(app).get('/thing').set('x-test-role', 'document_reviewer');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true });
    });

    it('role WITHOUT the permission, no grants → 403', async () => {
        const app = buildApp(REVIEWER_LACKS);
        const res = await request(app).get('/thing').set('x-test-role', 'document_reviewer');
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false });
    });

    it('role WITHOUT the permission + a GRANT for it → 200', async () => {
        mockGrantFindMany.mockResolvedValue([{ permission: REVIEWER_LACKS, effect: 'GRANT' }]);
        const app = buildApp(REVIEWER_LACKS);
        const res = await request(app).get('/thing').set('x-test-role', 'document_reviewer');
        expect(res.status).toBe(200);
    });

    it('role WITH the permission + a REVOKE for it → 403', async () => {
        mockGrantFindMany.mockResolvedValue([{ permission: REVIEWER_HAS, effect: 'REVOKE' }]);
        const app = buildApp(REVIEWER_HAS);
        const res = await request(app).get('/thing').set('x-test-role', 'document_reviewer');
        expect(res.status).toBe(403);
    });

    it('no req.user → 401 (unauthenticated)', async () => {
        const app = buildApp(REVIEWER_HAS);
        const res = await request(app).get('/thing'); // no x-test-role
        expect(res.status).toBe(401);
    });

    it('one request hitting TWO gates → findMany called ONCE (req cache)', async () => {
        // Both permissions the role holds by baseline so both gates pass.
        const app = buildTwoGateApp(REVIEWER_HAS, PERMISSIONS.APPLICATION_VIEW_ALL);
        const res = await request(app).get('/thing').set('x-test-role', 'document_reviewer');
        expect(res.status).toBe(200);
        expect(mockGrantFindMany).toHaveBeenCalledTimes(1);
    });
});
