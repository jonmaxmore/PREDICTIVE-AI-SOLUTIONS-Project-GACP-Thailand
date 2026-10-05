/**
 * admin batch-actions ASSIGN validation — M2 audit fix (2026-06-18).
 *
 * Supertest + mocked deps (mock-backed, runs on dev — no DB). Verifies that
 * POST /admin/batch-actions with action=ASSIGN validates `assignTo` BEFORE
 * writing anything — closing the phantom-reviewer data-integrity gap (an admin
 * typo used to transition apps to ASSIGNED_FOR_REVIEW pointing at a non-existent
 * reviewer, with the swallowed ledger FK failure, and still report success).
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
}));
// `{ prisma: {} }` was enough until the batch write was wrapped in a
// transaction so the transition lands in the hash-chained audit log atomically.
// From then on the handler called `prisma.$transaction` on an object that had
// no such method — a TypeError the route turned into a 500, which read as a
// validation failure rather than a missing stub. Run the callback inline: the
// status write itself is already mocked, so there is nothing to roll back.
jest.mock('../../services/prisma-database', () => ({
    prisma: { $transaction: jest.fn(async (cb) => (typeof cb === 'function' ? cb({}) : Promise.all(cb))) },
}));

const mockFindReviewer = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    findReassignmentTargetUser: (...a) => mockFindReviewer(...a),
}));
const mockFindApps = jest.fn(async () => []);
jest.mock('../../services/admin-application-service', () => ({
    findApplicationsByIds: (...a) => mockFindApps(...a),
}));
const mockWriteStatus = jest.fn(async () => ({}));
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: (...a) => mockWriteStatus(...a) }));
jest.mock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn(async () => null) }));
jest.mock('../../services/notification-service', () => ({ createNotification: jest.fn(async () => ({})) }));

const { adminBatchActions } = require('../../routes/api/provider/handlers/admin');

function buildApp(user = { id: 'admin-1', role: 'admin', organizationId: 'org-1' }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.post('/admin/batch-actions', ...adminBatchActions);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFindApps.mockResolvedValue([]);
    mockWriteStatus.mockResolvedValue({});
});

describe('admin batch-actions ASSIGN — assignTo validation (M2)', () => {
    test('rejects (400) when assignTo resolves to no active user — and writes NOTHING', async () => {
        mockFindReviewer.mockResolvedValue(null);
        const res = await request(buildApp())
            .post('/admin/batch-actions')
            .send({ applicationIds: ['app-1'], action: 'ASSIGN', assignTo: 'ghost-uuid' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not an active provider user/);
        expect(mockFindApps).not.toHaveBeenCalled();      // no app lookup
        expect(mockWriteStatus).not.toHaveBeenCalled();    // no transition written
    });

    test('rejects (400) when assignTo is inactive / soft-deleted / no providerId', async () => {
        mockFindReviewer.mockResolvedValue({ id: 'u-1', status: 'SUSPENDED', isDeleted: false, providerId: 'p1', role: 'AUDITOR' });
        const res = await request(buildApp())
            .post('/admin/batch-actions')
            .send({ applicationIds: ['app-1'], action: 'ASSIGN', assignTo: 'u-1' });
        expect(res.status).toBe(400);
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });

    test('rejects (400) when assignTo holds an ineligible role (e.g. health/account)', async () => {
        mockFindReviewer.mockResolvedValue({ id: 'u-2', status: 'ACTIVE', isDeleted: false, providerId: 'p2', role: 'ACCOUNT' });
        const res = await request(buildApp())
            .post('/admin/batch-actions')
            .send({ applicationIds: ['app-1'], action: 'ASSIGN', assignTo: 'u-2' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not eligible/);
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });

    test('proceeds when assignTo is an ACTIVE eligible reviewer (scoped to caller org)', async () => {
        mockFindReviewer.mockResolvedValue({ id: 'rev-1', status: 'ACTIVE', isDeleted: false, providerId: 'p3', role: 'document_reviewer' });
        mockFindApps.mockResolvedValue([{ id: 'app-1', status: 'DOC_FEE_PAID', formData: {}, workflowHistory: [], organizationId: 'org-1' }]);
        const res = await request(buildApp())
            .post('/admin/batch-actions')
            .send({ applicationIds: ['app-1'], action: 'ASSIGN', assignTo: 'rev-1' });
        expect(res.status).toBe(200);
        expect(mockFindReviewer).toHaveBeenCalledWith(expect.objectContaining({ id: 'rev-1', organizationId: 'org-1' }));
        expect(mockFindApps).toHaveBeenCalled();
        expect(mockWriteStatus).toHaveBeenCalledTimes(1);
    });

    test('REQUEST_DOCUMENTS skips reviewer validation (no assignTo needed)', async () => {
        mockFindApps.mockResolvedValue([{ id: 'app-1', status: 'DOC_FEE_PAID', formData: {}, workflowHistory: [] }]);
        const res = await request(buildApp())
            .post('/admin/batch-actions')
            .send({ applicationIds: ['app-1'], action: 'REQUEST_DOCUMENTS', reason: 'missing docs' });
        expect(res.status).toBe(200);
        expect(mockFindReviewer).not.toHaveBeenCalled();
        expect(mockWriteStatus).toHaveBeenCalledTimes(1);
    });
});

describe('admin batch-actions ASSIGN — separation of duties (fix round 1)', () => {
    test('refuses (409) the whole batch when assignTo is the inspector of any listed application — writes NOTHING', async () => {
        mockFindReviewer.mockResolvedValue({ id: 'u-3', status: 'ACTIVE', isDeleted: false, providerId: 'p3', role: 'DOCUMENT_REVIEWER' });
        mockFindApps.mockResolvedValue([
            { id: 'app-1', status: 'DOC_FEE_PAID', formData: {}, workflowHistory: [], auditorId: null },
            { id: 'app-2', status: 'DOC_FEE_PAID', formData: {}, workflowHistory: [], auditorId: 'u-3' },
        ]);
        const res = await request(buildApp())
            .post('/admin/batch-actions')
            .send({ applicationIds: ['app-1', 'app-2'], action: 'ASSIGN', assignTo: 'u-3' });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('REVIEWER_IS_APPLICATION_INSPECTOR');
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });
});

