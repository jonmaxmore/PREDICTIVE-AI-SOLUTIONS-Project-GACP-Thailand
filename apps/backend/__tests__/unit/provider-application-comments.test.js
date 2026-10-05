/**
 * Wave-3 ERP primitive — per-record CHATTER (staff comments / internal notes).
 *
 * POST /api/provider/applications/:id/comments lets provider staff post a
 * comment (or an internal-only note) on an application they can SEE. The
 * applicant-side leak-guard (applicant-comments-internal-only-guard.test.js)
 * already filters `internalOnly:false` on every applicant read, so an
 * internalOnly=true note created here NEVER reaches the applicant.
 *
 * Pins:
 *   - a comment persists with authorId/role/organizationId + the
 *     `internalOnly` flag passed through (true stays true; absent → false);
 *   - empty content → 400 (VALIDATION_ERROR) and NO create fires;
 *   - a non-visible / cross-tenant application → 404 and NO create fires;
 *   - a non-provider (HEALTH) token → 401 (crypto side-wall) and NO create.
 *
 * Pattern: header-auth mock like admin-routes-rbac.test.js — but
 * authenticateProvider REJECTS a `health` role with 401 (the HEALTH token /
 * provider endpoint separation is cryptographic, so it 401s before any role
 * check). canonical-rbac stays REAL. The prisma applicationComment.create +
 * application.findFirst are spied so a 400/404/401 truly means "no work done".
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Auth mock: attaches req.user from x-test-role headers. authenticateProvider
// rejects HEALTH (mirrors the real crypto side-wall — a health token can't
// reach a provider endpoint, 401 before role check).
jest.mock('../../middleware/auth-middleware', () => {
    const buildUser = (req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (!role || role === 'anonymous') {
            return _res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = {
            id: req.headers['x-test-user-id'] || 'user-1',
            role,
            canonicalRole: req.headers['x-test-canonical-role'] || role,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
            providerId: role === 'health' ? null : (req.headers['x-test-provider-id'] || 'provider-1'),
            healthId: role === 'health' ? 'health-1' : null,
        };
        return next();
    };
    const requireRole = () => (_req, _res, next) => next();
    return {
        authenticateProvider: (req, res, next) => {
            const role = req.headers['x-test-role'];
            if (!role || role === 'anonymous' || role === 'health') {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            return buildUser(req, res, next);
        },
        authenticateHealth: buildUser,
        authenticateAny: buildUser,
        authenticateDTAM: buildUser,
        authenticate: buildUser,
        requireRole,
        optionalAuth: buildUser,
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
    };
});

// canonical-rbac stays REAL.
jest.mock('../../shared/canonical-rbac', () => jest.requireActual('../../shared/canonical-rbac'));

// audit-logger — best-effort emit; spied so we can assert it does NOT block.
const mockAuditLog = jest.fn(async () => ({}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { APPLICATION: 'APPLICATION', ADMIN: 'ADMIN' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

// prisma: the route reaches for applicationComment.create + application.findFirst
// (visibility probe) + user.findMany (assignment resolver on the detail read is
// NOT exercised by the POST). Everything spied.
const mockApplicationCommentCreate = jest.fn();
const mockApplicationFindFirst = jest.fn();
const mockApplicationFindUnique = jest.fn();
const mockUserFindMany = jest.fn(async () => []);
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        applicationComment: { create: (...a) => mockApplicationCommentCreate(...a) },
        application: {
            findFirst: (...a) => mockApplicationFindFirst(...a),
            findUnique: (...a) => mockApplicationFindUnique(...a),
        },
        user: { findMany: (...a) => mockUserFindMany(...a) },
    },
}));

// The service layer wraps the same prisma singleton. Load it AFTER the mock so
// application-service reads the mocked prisma (it requires prisma-database).
const applicationService = require('../../services/application-service');

function buildApp() {
    const router = require('../../routes/api/provider/applications');
    const app = express();
    app.use(express.json());
    app.use('/provider/applications', router);
    return app;
}

const VISIBLE_APP = { id: 'app-1', organizationId: 'org-1' };

describe('POST /api/provider/applications/:id/comments — chatter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // visibility probe returns a visible app by default
        mockApplicationFindFirst.mockResolvedValue(VISIBLE_APP);
        // helper re-fetches organizationId
        mockApplicationFindUnique.mockResolvedValue({ organizationId: 'org-1' });
        mockApplicationCommentCreate.mockImplementation(async ({ data }) => ({
            id: 'cmt-1',
            createdAt: new Date('2026-07-02T00:00:00Z'),
            ...data,
        }));
    });

    test('persists comment with authorId/role/organizationId (internalOnly absent → false)', async () => {
        const app = buildApp();
        const res = await request(app)
            .post('/provider/applications/app-1/comments')
            .set('x-test-role', 'document_reviewer')
            .set('x-test-user-id', 'rev-9')
            .set('x-test-organization-id', 'org-1')
            .send({ content: '  ตรวจแล้ว เอกสารครบถ้วน  ' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockApplicationCommentCreate).toHaveBeenCalledTimes(1);
        const { data } = mockApplicationCommentCreate.mock.calls[0][0];
        expect(data.applicationId).toBe('app-1');
        expect(data.authorId).toBe('rev-9');
        expect(data.role).toBe('document_reviewer');
        expect(data.organizationId).toBe('org-1');
        expect(data.content).toBe('ตรวจแล้ว เอกสารครบถ้วน'); // trimmed
        expect(data.internalOnly).toBe(false);
        expect(res.body.data.id).toBe('cmt-1');
    });

    test('internalOnly:true is a server-trusted staff flag — passes through as true', async () => {
        const app = buildApp();
        const res = await request(app)
            .post('/provider/applications/app-1/comments')
            .set('x-test-role', 'auditor')
            .send({ content: 'โน้ตภายใน: รอเอกสารเพิ่ม', internalOnly: true });

        expect(res.status).toBe(200);
        expect(mockApplicationCommentCreate).toHaveBeenCalledTimes(1);
        const { data } = mockApplicationCommentCreate.mock.calls[0][0];
        expect(data.internalOnly).toBe(true);
    });

    test('empty content → 400 and no create fires', async () => {
        const app = buildApp();
        const res = await request(app)
            .post('/provider/applications/app-1/comments')
            .set('x-test-role', 'document_reviewer')
            .send({ content: '   ' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(mockApplicationCommentCreate).not.toHaveBeenCalled();
    });

    test('missing content field → 400 and no create fires', async () => {
        const app = buildApp();
        const res = await request(app)
            .post('/provider/applications/app-1/comments')
            .set('x-test-role', 'document_reviewer')
            .send({ internalOnly: true });

        expect(res.status).toBe(400);
        expect(mockApplicationCommentCreate).not.toHaveBeenCalled();
    });

    test('non-visible / cross-tenant application → 404 and no create fires', async () => {
        mockApplicationFindFirst.mockResolvedValue(null); // visibility probe misses
        const app = buildApp();
        const res = await request(app)
            .post('/provider/applications/other-app/comments')
            .set('x-test-role', 'document_reviewer')
            .send({ content: 'should not persist' });

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(mockApplicationCommentCreate).not.toHaveBeenCalled();
    });

    test('HEALTH token (non-provider) → 401 and no create fires', async () => {
        const app = buildApp();
        const res = await request(app)
            .post('/provider/applications/app-1/comments')
            .set('x-test-role', 'health')
            .send({ content: 'applicant should never reach here' });

        expect(res.status).toBe(401);
        expect(mockApplicationCommentCreate).not.toHaveBeenCalled();
    });

    test('service helper createApplicationCommentIfAvailable threads internalOnly through', async () => {
        mockApplicationFindUnique.mockResolvedValue({ organizationId: 'org-7' });
        await applicationService.createApplicationCommentIfAvailable({
            applicationId: 'app-1',
            authorId: 'rev-9',
            role: 'auditor',
            content: 'note',
            internalOnly: true,
        });
        expect(mockApplicationCommentCreate).toHaveBeenCalledTimes(1);
        const { data } = mockApplicationCommentCreate.mock.calls[0][0];
        expect(data.internalOnly).toBe(true);
        expect(data.organizationId).toBe('org-7');
    });
});
