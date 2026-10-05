/**
 * Scheduler reviewer-reassign — tenant-scope + RBAC regression (audit LOW-3, 2026-06-18).
 *
 * On prod TENANT_READ_ORG_SCOPE is OFF, so the handler's explicit organizationId
 * filter on BOTH lookups is the SOLE active cross-tenant defense. This locks it:
 *  - non-manager (auditor/document_reviewer) → 403
 *  - cross-tenant application (org-scoped lookup misses) → 404, org passed to the lookup
 *  - cross-tenant reviewer (org-scoped lookup misses) → 404, org passed to the lookup
 * Complements the pure-function scheduler-reviewer-reassign-auth.test.js (role list only).
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => next(),
    requireRole: () => (req, _res, next) => next(),
    requireCanonicalPermission: () => (req, _res, next) => next(),
}));
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const mockFindApp = jest.fn();
jest.mock('../../services/application-service', () => ({
    findAuditApplication: (...a) => mockFindApp(...a),
    listReassignableReviewers: jest.fn(async () => []),
}));
const mockFindReviewer = jest.fn();
jest.mock('../../services/provider-user-service', () => ({ findReassignmentTargetUser: (...a) => mockFindReviewer(...a) }));
jest.mock('../../services/tracked-writer', () => ({ trackedUpdate: jest.fn(async () => ({})) }));
jest.mock('../../services/notification-service', () => ({ createNotification: jest.fn(async () => ({})), sendNotification: jest.fn(async () => ({})), NotifyType: {} }));
jest.mock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn(async () => null) }));

const { schedulerReviewerReassign } = require('../../routes/api/provider/handlers/scheduler-reviewer-reassign-handler');

function buildApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.post('/x/:id/reassign', ...schedulerReviewerReassign);
    return app;
}
const SCHED_A = { id: 's-a', role: 'dispatcher', organizationId: 'org-A' };

beforeEach(() => jest.clearAllMocks());

describe('reviewer-reassign — RBAC', () => {
    test('auditor → 403 (manager-only)', async () => {
        const res = await request(buildApp({ id: 'a1', role: 'field_inspector', organizationId: 'org-A' }))
            .post('/x/app-1/reassign').send({ newReviewerId: 'r1', reason: 'x' });
        expect(res.status).toBe(403);
        expect(mockFindApp).not.toHaveBeenCalled();
    });
});

describe('reviewer-reassign — cross-tenant org scoping (sole prod defense)', () => {
    test('cross-tenant application → 404; organizationId IS passed to the application lookup', async () => {
        mockFindApp.mockResolvedValue(null); // org-scoped lookup misses tenant-B's app
        const res = await request(buildApp(SCHED_A)).post('/x/app-B/reassign').send({ newReviewerId: 'r1', reason: 'x' });
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/Application not found/);
        expect(mockFindApp).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 'app-B', organizationId: 'org-A' }),
        }));
        expect(mockFindReviewer).not.toHaveBeenCalled();
    });

    test('cross-tenant reviewer → 404; organizationId IS passed to the reviewer lookup', async () => {
        mockFindApp.mockResolvedValue({ id: 'app-1', status: 'ASSIGNED_FOR_REVIEW', reviewerId: 'old', formData: {}, applicant: { id: 'h1' }, organizationId: 'org-A' });
        mockFindReviewer.mockResolvedValue(null); // org-scoped lookup misses tenant-B's reviewer
        const res = await request(buildApp(SCHED_A)).post('/x/app-1/reassign').send({ newReviewerId: 'rev-B', reason: 'x' });
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/Reviewer not found/);
        expect(mockFindReviewer).toHaveBeenCalledWith(expect.objectContaining({ id: 'rev-B', organizationId: 'org-A' }));
    });

    test('wrong state (DOC_FEE_PAID, no reviewer yet) → 409, reviewer lookup not reached', async () => {
        mockFindApp.mockResolvedValue({ id: 'app-1', status: 'DOC_FEE_PAID', reviewerId: null, formData: {}, applicant: { id: 'h1' }, organizationId: 'org-A' });
        const res = await request(buildApp(SCHED_A)).post('/x/app-1/reassign').send({ newReviewerId: 'r1', reason: 'x' });
        expect(res.status).toBe(409);
        expect(mockFindReviewer).not.toHaveBeenCalled();
    });

    test('REVISION_REQUESTED IS reassignable (passes the state gate → reaches reviewer lookup)', async () => {
        mockFindApp.mockResolvedValue({ id: 'app-1', status: 'REVISION_REQUESTED', reviewerId: 'old', formData: {}, applicant: { id: 'h1' }, organizationId: 'org-A' });
        mockFindReviewer.mockResolvedValue(null); // stop at reviewer lookup — proves the state gate was passed
        const res = await request(buildApp(SCHED_A)).post('/x/app-1/reassign').send({ newReviewerId: 'rev-1', reason: 'reviewer unavailable mid-revision' });
        expect(res.status).toBe(404); // reviewer-not-found, NOT 409 state-rejected
        expect(res.body.error).toMatch(/Reviewer not found/);
        expect(mockFindReviewer).toHaveBeenCalledWith(expect.objectContaining({ id: 'rev-1', organizationId: 'org-A' }));
    });
});
