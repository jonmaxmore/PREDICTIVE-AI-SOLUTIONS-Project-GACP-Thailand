/**
 * The applicant's end of the per-slot loop, through the wire.
 *
 * The rule is exercised exhaustively without a database in
 * revision-resubmit-rules.test.js. What that cannot see is what this proves:
 * that the door is owned by the applicant, refuses in the right ORDER, and moves
 * nothing when it refuses.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, res, next) => {
        if (!req.headers['x-test-user']) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        req.user = { id: 'user-1', role: 'health', canonicalRole: 'health' };
        return next();
    },
}));

const mockDb = {
    application: { findFirst: jest.fn() },
    applicationDocumentReview: { findMany: jest.fn() },
    applicationDocument: { findMany: jest.fn() },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'health-1', userId: 'user-1' })),
}));
jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: () => ({}),
}));

const mockWriteStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteStatus(...a),
}));

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/applications', require('../../routes/api/applications/revision-resubmit'));
    return a;
}

const ASKED_AT = new Date('2026-09-05T10:00:00.000Z');
const REPLACED_AT = new Date('2026-09-06T10:00:00.000Z');

beforeEach(() => {
    jest.clearAllMocks();
    mockWriteStatus.mockResolvedValue({ ok: true });
    mockDb.application.findFirst.mockResolvedValue({
        id: 'app-1', healthId: 'health-1', status: 'REVISION_REQUESTED', isDeleted: false,
    });
    mockDb.applicationDocumentReview.findMany.mockResolvedValue([
        { slotId: 'land_rights', verdict: 'MORE_REQUESTED', round: 1, createdAt: ASKED_AT },
        { slotId: 'sop_manual', verdict: 'ACCEPTED', round: 1, createdAt: ASKED_AT },
    ]);
    mockDb.applicationDocument.findMany.mockResolvedValue([
        { documentType: 'land_rights', createdAt: REPLACED_AT },
    ]);
});

const post = (headers = { 'x-test-user': '1' }) => request(app())
    .post('/api/applications/app-1/revision-resubmit').set(headers).send({});

describe('who may send a filing back', () => {
    test('an unauthenticated caller reaches nothing', async () => {
        const res = await request(app()).post('/api/applications/app-1/revision-resubmit').send({});
        expect(res.status).toBe(401);
        expect(mockDb.application.findFirst).not.toHaveBeenCalled();
    });

    test('another applicant\'s filing is 404 — the healthId is in the query, not a check after', async () => {
        mockDb.application.findFirst.mockResolvedValue(null);
        const res = await post();
        expect(res.status).toBe(404);
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });
});

describe('the happy path', () => {
    test('walks REVISION_REQUESTED → ASSIGNED_FOR_REVIEW through the writer', async () => {
        const res = await post();
        expect(res.status).toBe(200);
        expect(mockWriteStatus).toHaveBeenCalledTimes(1);
        expect(mockWriteStatus.mock.calls[0][0]).toMatchObject({
            applicationId: 'app-1',
            fromStatus: 'REVISION_REQUESTED',
            toStatus: 'ASSIGNED_FOR_REVIEW',
        });
    });

    test('answers with the papers that were returned', async () => {
        const res = await post();
        expect(res.body.data.resubmittedSlotIds).toEqual(['land_rights']);
        expect(res.body.data.round).toBe(1);
    });

    test('an ACCEPTED slot is not asked for again — that is the whole point', async () => {
        const res = await post();
        expect(res.body.data.resubmittedSlotIds).not.toContain('sop_manual');
    });
});

describe('refusals move nothing', () => {
    test('a stale file is refused and NAMES the paper', async () => {
        mockDb.applicationDocument.findMany.mockResolvedValue([
            { documentType: 'land_rights', createdAt: new Date('2026-09-01T00:00:00.000Z') },
        ]);
        const res = await post();
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('REVISION_INCOMPLETE');
        expect(res.body.slotIds).toEqual(['land_rights']);
        expect(res.body.messageTh).toContain('อัปโหลด');
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });

    test('the WRONG STATE is reported before the papers are looked at', async () => {
        // Someone on the wrong screen needs to hear that, not a document list
        // that has nothing to do with their problem.
        mockDb.application.findFirst.mockResolvedValue({
            id: 'app-1', healthId: 'health-1', status: 'DRAFT', isDeleted: false,
        });
        const res = await post();
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('REVISION_RESUBMIT_WRONG_STATE');
        expect(mockDb.applicationDocumentReview.findMany).not.toHaveBeenCalled();
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });

    test('a filing with no outstanding request is refused, not waved through', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'land_rights', verdict: 'ACCEPTED', round: 1, createdAt: ASKED_AT },
        ]);
        const res = await post();
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('REVISION_INCOMPLETE');
        expect(mockWriteStatus).not.toHaveBeenCalled();
    });
});
