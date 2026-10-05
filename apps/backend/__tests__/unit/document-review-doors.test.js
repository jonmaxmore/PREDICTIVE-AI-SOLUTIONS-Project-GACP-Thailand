/**
 * The officer's doors — a 403 means no verdict was written, and a refusal names
 * the row it is about.
 *
 * The rules themselves are exercised exhaustively in
 * document-review-service.test.js, without a database. This file proves the
 * things a pure test cannot see: that the doors are guarded, that the refusals
 * reach the officer in their own language, and that a rejected request writes
 * nothing.
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../routes/api/provider/handlers/shared', () => {
    const actualRbac = jest.requireActual('../../shared/canonical-rbac');
    return {
        authenticateProvider: (req, res, next) => {
            const role = req.headers['x-test-role'];
            if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
            req.user = { id: 'officer-1', role, canonicalRole: role, organizationId: 'org-1' };
            return next();
        },
        requireCanonicalPermission: (permission) => (req, res, next) => {
            const role = actualRbac.normalizeRole(req.user?.canonicalRole);
            if (!actualRbac.hasPermission(role, permission)) {
                return res.status(403).json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
            }
            return next();
        },
        PERMISSIONS: actualRbac.PERMISSIONS,
    };
});

const mockDb = {
    application: { findFirst: jest.fn() },
    applicationDocument: { findMany: jest.fn() },
    applicationDocumentReview: { findMany: jest.fn(), upsert: jest.fn() },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockDb }));

const mockWriteStatus = jest.fn();
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteStatus(...a),
}));

const mockNotify = jest.fn();
jest.mock('../../services/notification/domain-helpers', () => ({
    notifyRevisionRequired: (...a) => mockNotify(...a),
}));

const mockResolve = jest.fn();
jest.mock('../../services/application-requirements-service', () => ({
    resolveApplicationRequirements: (...a) => mockResolve(...a),
}));

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/provider/applications', require('../../routes/api/provider/document-reviews'));
    return a;
}

const APPLICATION = { id: 'app-1', organizationId: 'org-1', isDeleted: false, status: 'ASSIGNED_FOR_REVIEW' };
const SLOTS = [
    { slotId: 'land_rights', labelTH: 'สำเนาเอกสารสิทธิ์ที่ดิน', required: true, satisfied: true },
    { slotId: 'sop_manual', labelTH: 'คู่มือ SOP', required: true, satisfied: true },
    { slotId: 'water_test', labelTH: 'ผลตรวจน้ำ', required: false, satisfied: false },
];
const REASON = 'สำเนาโฉนดที่แนบมาอ่านเลขที่ไม่ออก กรุณาแนบฉบับที่ชัดเจนกว่านี้';
const WORKING_DAY = '2026-09-10T00:00:00+07:00';
const WEEKEND = '2026-09-12T00:00:00+07:00';

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.application.findFirst.mockResolvedValue(APPLICATION);
    mockDb.applicationDocument.findMany.mockResolvedValue([]);
    mockDb.applicationDocumentReview.findMany.mockResolvedValue([]);
    mockDb.applicationDocumentReview.upsert.mockImplementation(async ({ create }) => ({ id: 'rev-1', ...create }));
    mockWriteStatus.mockResolvedValue({ ok: true });
    mockNotify.mockResolvedValue(undefined);
    mockResolve.mockResolvedValue({
        slots: SLOTS,
        dims: { certScope: 'PLANTING', holderType: 'INDIVIDUAL', plantCode: 'cannabis' },
    });
});

describe('who may review', () => {
    test.each([['health'], ['scheduler'], ['account_dtam']])('%s cannot record a verdict', async (role) => {
        const res = await request(app())
            .post('/api/provider/applications/app-1/document-reviews')
            .set('x-test-role', role)
            .send({ slotId: 'land_rights', verdict: 'ACCEPTED' });

        expect(res.status).toBe(403);
        expect(mockDb.applicationDocumentReview.upsert).not.toHaveBeenCalled();
    });

    test('a document reviewer can', async () => {
        const res = await request(app())
            .post('/api/provider/applications/app-1/document-reviews')
            .set('x-test-role', 'document_reviewer')
            .send({ slotId: 'land_rights', verdict: 'ACCEPTED' });

        expect(res.status).toBe(200);
        expect(mockDb.applicationDocumentReview.upsert).toHaveBeenCalledTimes(1);
    });

    test('an unauthenticated caller reaches nothing', async () => {
        const res = await request(app()).get('/api/provider/applications/app-1/document-check');
        expect(res.status).toBe(401);
        expect(mockResolve).not.toHaveBeenCalled();
    });
});

describe('a refused verdict writes nothing', () => {
    const post = (body) => request(app())
        .post('/api/provider/applications/app-1/document-reviews')
        .set('x-test-role', 'document_reviewer').send(body);

    test('MORE_REQUESTED with no reason → 422, nothing written', async () => {
        const res = await post({ slotId: 'land_rights', verdict: 'MORE_REQUESTED', dueDate: WORKING_DAY });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('REVIEW_REASON_REQUIRED');
        expect(res.body.messageTh).toContain('เหตุผล');
        expect(mockDb.applicationDocumentReview.upsert).not.toHaveBeenCalled();
    });

    test('ACCEPTED on a slot with no attached document → 422 with its own Thai answer, not a 500', async () => {
        // F-WALK-05 (walked 2026-09-06): the refusal existed and carried a good Thai
        // sentence, but REVIEW_SLOT_NOT_ATTACHED was missing from the route's ANSWERABLE
        // set, so the officer read 500 "ระบบตรวจเอกสารทำงานผิดพลาด" — a system-error claim
        // about a correct business refusal. The catalogue maps it to 422.
        const res = await post({ slotId: 'water_test', verdict: 'ACCEPTED' });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('REVIEW_SLOT_NOT_ATTACHED');
        expect(res.body.messageTh).toContain('ขอเอกสารเพิ่ม');
        expect(mockDb.applicationDocumentReview.upsert).not.toHaveBeenCalled();
    });

    test('a weekend due date → 422 naming working days', async () => {
        const res = await post({
            slotId: 'land_rights', verdict: 'MORE_REQUESTED', reason: REASON, dueDate: WEEKEND,
        });
        expect(res.status).toBe(422);
        expect(res.body.messageTh).toContain('วันทำการ');
        expect(mockDb.applicationDocumentReview.upsert).not.toHaveBeenCalled();
    });

    test('a slot this filing was never asked for is refused, and writes nothing', async () => {
        // 400, not 422: the catalogue maps VALIDATION_ERROR to 400 and the
        // catalogue is the single source for that mapping. A verdict on a paper
        // this filing was never asked for would otherwise sit in the record
        // forever with nothing to explain it.
        const res = await post({ slotId: 'police_report', verdict: 'ACCEPTED' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(mockDb.applicationDocumentReview.upsert).not.toHaveBeenCalled();
    });
});

describe('the decision over the filing', () => {
    const decide = (action) => request(app())
        .post('/api/provider/applications/app-1/document-decision')
        .set('x-test-role', 'document_reviewer').send({ action });

    test('ACCEPT_ALL is refused while a required slot is unaccepted, and NAMES it', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'land_rights', verdict: 'ACCEPTED', round: 1 },
        ]);
        const res = await decide('ACCEPT_ALL');
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DOCUMENT_CHECK_INCOMPLETE');
        expect(res.body.slotIds).toEqual(['sop_manual']);
    });

    test('ACCEPT_ALL passes once every required slot is accepted — the optional one does not block', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'land_rights', verdict: 'ACCEPTED', round: 1 },
            { slotId: 'sop_manual', verdict: 'ACCEPTED', round: 1 },
        ]);
        const res = await decide('ACCEPT_ALL');
        expect(res.status).toBe(200);
    });

    test('REQUEST_MORE with nothing requested → 409', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'land_rights', verdict: 'ACCEPTED', round: 1 },
        ]);
        const res = await decide('REQUEST_MORE');
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DOCUMENT_CHECK_NOTHING_REQUESTED');
    });

    test('REQUEST_MORE returns the slots the applicant will be asked for', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'sop_manual', verdict: 'MORE_REQUESTED', round: 1 },
        ]);
        const res = await decide('REQUEST_MORE');
        expect(res.status).toBe(200);
        expect(res.body.data.requestedSlotIds).toEqual(['sop_manual']);
    });
});

describe('the checklist the officer reads', () => {
    test('joins each slot with this round\'s verdict, and derives 1.2/1.3/1.4', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'land_rights', verdict: 'ACCEPTED', round: 1, reason: null, dueDate: null },
        ]);
        const res = await request(app())
            .get('/api/provider/applications/app-1/document-check')
            .set('x-test-role', 'document_reviewer');

        expect(res.status).toBe(200);
        expect(res.body.data.round).toBe(1);
        expect(res.body.data.slots.find((s) => s.slotId === 'land_rights').verdict).toBe('ACCEPTED');
        expect(res.body.data.slots.find((s) => s.slotId === 'sop_manual').verdict).toBeNull();
        expect(res.body.data.officerChecklist).toEqual({
            scope: 'IN', qualification: 'PASS', overall: 'INCOMPLETE',
        });
    });

    test('a missing application is 404, not an empty checklist', async () => {
        mockDb.application.findFirst.mockResolvedValue(null);
        const res = await request(app())
            .get('/api/provider/applications/nope/document-check')
            .set('x-test-role', 'document_reviewer');
        expect(res.status).toBe(404);
    });
});


describe('the decision actually moves the filing and tells the applicant', () => {
    /**
     * Until this was wired the door answered `transition: 'PENDING_WIRING'`:
     * the officer pressed a button, the record was written, and the application
     * sat exactly where it was with the applicant never told. Honest at the
     * time, and useless — the loop only closes here.
     */
    const decide = (action) => request(app())
        .post('/api/provider/applications/app-1/document-decision')
        .set('x-test-role', 'document_reviewer').send({ action });

    test('REQUEST_MORE walks ASSIGNED_FOR_REVIEW → REVISION_REQUESTED through the writer', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'sop_manual', verdict: 'MORE_REQUESTED', round: 1,
              reason: REASON, dueDate: new Date(WORKING_DAY) },
        ]);
        const res = await decide('REQUEST_MORE');

        expect(res.status).toBe(200);
        expect(mockWriteStatus).toHaveBeenCalledTimes(1);
        // Never a raw status write — the transition service owns the edge, the
        // audit row and the history.
        expect(mockWriteStatus.mock.calls[0][0]).toMatchObject({
            applicationId: 'app-1',
            fromStatus: 'ASSIGNED_FOR_REVIEW',
            toStatus: 'REVISION_REQUESTED',
        });
    });

    test('…and the applicant is told WHICH papers, with the deadline the system enforces', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'sop_manual', verdict: 'MORE_REQUESTED', round: 1,
              reason: REASON, dueDate: new Date(WORKING_DAY) },
        ]);
        await decide('REQUEST_MORE');

        expect(mockNotify).toHaveBeenCalledTimes(1);
        const [applicationId, reason, deadline] = mockNotify.mock.calls[0];
        expect(applicationId).toBe('app-1');
        // The paper's own name, not its slot id — an applicant does not know
        // what `sop_manual` is.
        expect(reason).toContain('คู่มือ SOP');
        expect(reason).toContain(REASON);
        // The stored clock (revisionDueAt), not the officer-chosen per-slot date.
        const stored = mockWriteStatus.mock.calls[0][0].additionalData.formData.revisionDueAt;
        expect(new Date(deadline).toISOString()).toBe(new Date(stored).toISOString());
    });

    test('ACCEPT_ALL walks to DOC_APPROVED and notifies nobody about a revision', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'land_rights', verdict: 'ACCEPTED', round: 1 },
            { slotId: 'sop_manual', verdict: 'ACCEPTED', round: 1 },
        ]);
        const res = await decide('ACCEPT_ALL');

        expect(res.status).toBe(200);
        expect(mockWriteStatus.mock.calls[0][0]).toMatchObject({ toStatus: 'DOC_APPROVED' });
        expect(mockNotify).not.toHaveBeenCalled();
    });

    test('a filing not under review is refused BEFORE anything moves', async () => {
        mockDb.application.findFirst.mockResolvedValue({ ...APPLICATION, status: 'DRAFT' });
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'sop_manual', verdict: 'MORE_REQUESTED', round: 1, reason: REASON, dueDate: new Date(WORKING_DAY) },
        ]);
        const res = await decide('REQUEST_MORE');

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DOCUMENT_DECISION_WRONG_STATE');
        expect(mockWriteStatus).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });

    test('a refused decision never notifies — nobody is told about a move that did not happen', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'land_rights', verdict: 'ACCEPTED', round: 1 },
        ]);
        await decide('ACCEPT_ALL');   // sop_manual is unaccepted → 409
        expect(mockWriteStatus).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });

    test('a notification failure does not undo the transition', async () => {
        // The applicant being told is important; it is not more important than
        // the filing actually moving. A throw here used to be able to 500 the
        // whole decision after the status had already been written.
        mockNotify.mockRejectedValue(new Error('notification service down'));
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'sop_manual', verdict: 'MORE_REQUESTED', round: 1, reason: REASON, dueDate: new Date(WORKING_DAY) },
        ]);
        const res = await decide('REQUEST_MORE');

        expect(res.status).toBe(200);
        expect(res.body.data.notified).toBe(false);
        expect(mockWriteStatus).toHaveBeenCalledTimes(1);
    });
});

describe('an empty checklist is not a passed checklist', () => {
    // Found by the 2026-09-06 document-coverage analysis: every identity/qualification
    // rule in the register binds requestType='NEW', so a REPLACEMENT filing resolves to
    // ZERO required slots. decideDocumentOutcome then filtered an empty list, found no
    // blockers, and let the officer accept it; officerChecklist's `.every()` on the same
    // empty list reported ครบถ้วน. A filing nobody was asked to evidence was being
    // approved on paper that does not exist.
    const { decideDocumentOutcome } = require('../../services/application-document-review-service');

    it('refuses ACCEPT_ALL when a NEW filing has no required documents at all', () => {
        expect(() => decideDocumentOutcome('ACCEPT_ALL', [], { requestType: 'NEW' })).toThrow();
        expect(() => decideDocumentOutcome('ACCEPT_ALL', [])).toThrow();   // default is NEW
    });

    it('refuses a renewal or replacement with no papers too — identity is asked again (P1/P2)', () => {
        // Operator approved P1/P2 on 2026-09-06: a succeeding request re-proves who is filing,
        // so an empty checklist is never the lawful answer for any request type.
        expect(() => decideDocumentOutcome('ACCEPT_ALL', [], { requestType: 'RENEWAL' })).toThrow();
        expect(() => decideDocumentOutcome('ACCEPT_ALL', [], { requestType: 'REPLACEMENT' })).toThrow();
    });

    it('still refuses when only optional papers exist', () => {
        expect(() => decideDocumentOutcome('ACCEPT_ALL', [
            { slotId: 'additional_docs', required: false, verdict: 'ACCEPTED' },
        ], { requestType: 'NEW' })).toThrow();
    });

    it('accepts normally when required papers exist and are accepted', () => {
        expect(decideDocumentOutcome('ACCEPT_ALL', [
            { slotId: 'id_house_reg', required: true, verdict: 'ACCEPTED' },
        ])).toEqual({ ok: true });
    });
});
