/**
 * Defect batch B item 6 — the per-slot "ขอเพิ่มเอกสาร" must start the revision clock.
 *
 * The reviewer screen reaches REVISION_REQUESTED only through
 * POST /api/provider/applications/:id/document-decision { action: 'REQUEST_MORE' }.
 * That door wrote the status and nothing else: no formData.revisionDueAt and no
 * RevisionDeadline row. The hourly revision-deadline-checker reads RevisionDeadline rows
 * only, and revision-resubmit reads revisionDueAt, so the 5-working-day expiry never fired
 * and a late resubmit was never refused. The "due date" was a sentence in a notification.
 *
 * The generic /workflow-transitions door stamps both. The two doors now share that code
 * (workflow-side-effects.buildRevisionDeadlineFormData + handleRevisionDeadlines).
 */

'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../../routes/api/provider/handlers/shared', () => {
    const actualRbac = jest.requireActual('../../shared/canonical-rbac');
    return {
        authenticateProvider: (req, res, next) => {
            req.user = { id: 'officer-1', role: 'document_reviewer', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
            return next();
        },
        requireCanonicalPermission: () => (_q, _s, n) => n(),
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
jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: (...a) => mockWriteStatus(...a) }));
jest.mock('../../services/notification/domain-helpers', () => ({
    notifyRevisionRequired: jest.fn().mockResolvedValue(undefined),
    notifyDocumentApproved: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/application-requirements-service', () => ({
    resolveApplicationRequirements: jest.fn().mockResolvedValue({
        slots: [{ slotId: 'sop_manual', labelTH: 'คู่มือ SOP', required: true, satisfied: true }],
        dims: { certScope: 'PLANTING', holderType: 'INDIVIDUAL', plantCode: 'cannabis' },
    }),
}));
const mockFindDeadline = jest.fn();
const mockUpsertDeadline = jest.fn();
const mockBulk = jest.fn();
jest.mock('../../services/admin-application-service', () => ({
    findRevisionDeadlineByApplicationId: (...a) => mockFindDeadline(...a),
    upsertRevisionDeadline: (...a) => mockUpsertDeadline(...a),
    bulkUpdateRevisionDeadlineStatus: (...a) => mockBulk(...a),
}));

const { addWorkingDays } = require('../../utils/working-days');
const { PAYMENT } = require('../../config/business-rules');

const APPLICATION = {
    id: 'app-1', organizationId: 'org-1', isDeleted: false, status: 'ASSIGNED_FOR_REVIEW',
    reviewerId: 'officer-1', formData: { keep: 'me', workflowState: 'ASSIGNED_FOR_REVIEW' }, workflowHistory: [],
};
const DUE = new Date(Date.now() + 14 * 24 * 3600 * 1000);

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/provider/applications', require('../../routes/api/provider/document-reviews'));
    return a;
}
const decide = (action) => request(app()).post('/api/provider/applications/app-1/document-decision').send({ action });

beforeEach(() => {
    jest.clearAllMocks();
    mockDb.application.findFirst.mockResolvedValue(APPLICATION);
    mockDb.applicationDocument.findMany.mockResolvedValue([]);
    mockWriteStatus.mockResolvedValue({ ok: true });
    mockFindDeadline.mockResolvedValue(null);
    mockUpsertDeadline.mockResolvedValue({});
    mockBulk.mockResolvedValue({ count: 0 });
});

describe('REQUEST_MORE from the reviewer screen', () => {
    beforeEach(() => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([
            { slotId: 'sop_manual', verdict: 'MORE_REQUESTED', round: 1, reason: 'อ่านไม่ออก กรุณาแนบฉบับที่ชัดเจน', dueDate: DUE },
        ]);
    });

    test('stamps revisionDueAt = 5 working days from now into the same status write, keeping the rest of formData', async () => {
        const before = Date.now();
        const res = await decide('REQUEST_MORE');
        expect(res.status).toBe(200);

        const arg = mockWriteStatus.mock.calls[0][0];
        const fd = arg.additionalData.formData;
        expect(fd.keep).toBe('me');
        expect(fd.revisionSlaDays).toBe(PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS);
        const stamped = new Date(fd.revisionDueAt);
        const lo = addWorkingDays(new Date(before), PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS).getTime();
        const hi = addWorkingDays(new Date(Date.now()), PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS).getTime();
        expect(stamped.getTime()).toBeGreaterThanOrEqual(lo);
        expect(stamped.getTime()).toBeLessThanOrEqual(hi);
        // the key the resubmit guard reads under its other spelling
        expect(fd.revision_due_at).toBe(fd.revisionDueAt);
    });

    test('creates the RevisionDeadline row the cron reads: same due date, PENDING, count 1', async () => {
        await decide('REQUEST_MORE');
        const fd = mockWriteStatus.mock.calls[0][0].additionalData.formData;
        expect(mockUpsertDeadline).toHaveBeenCalledTimes(1);
        const arg = mockUpsertDeadline.mock.calls[0][0];
        expect(arg.applicationId).toBe('app-1');
        expect(arg.create).toMatchObject({ applicationId: 'app-1', status: 'PENDING', revisionCount: 1, createdBy: 'officer-1' });
        expect(arg.create.revisionDue.toISOString()).toBe(fd.revisionDueAt);
        expect(arg.update).toMatchObject({ status: 'PENDING', updatedBy: 'officer-1' });
    });

    test('the farmer notice states the deadline the system enforces (revisionDueAt), not the officer-chosen slot date', async () => {
        const { notifyRevisionRequired } = require('../../services/notification/domain-helpers');
        const res = await decide('REQUEST_MORE');
        expect(res.status).toBe(200);
        const fd = mockWriteStatus.mock.calls[0][0].additionalData.formData;
        expect(notifyRevisionRequired).toHaveBeenCalledTimes(1);
        const stated = notifyRevisionRequired.mock.calls[0][2];
        expect(new Date(stated).toISOString()).toBe(fd.revisionDueAt);
        expect(new Date(stated).toISOString()).not.toBe(DUE.toISOString());
    });

    test('a second round bumps revisionCount (same rule as the generic door)', async () => {
        mockFindDeadline.mockResolvedValue({ revisionCount: 1 });
        await decide('REQUEST_MORE');
        expect(mockUpsertDeadline.mock.calls[0][0].update.revisionCount).toBe(2);
    });

    test('the deadline is written AFTER the status write (never for a refused decision)', async () => {
        const order = [];
        mockWriteStatus.mockImplementation(async () => { order.push('status'); return {}; });
        mockUpsertDeadline.mockImplementation(async () => { order.push('deadline'); return {}; });
        await decide('REQUEST_MORE');
        expect(order).toEqual(['status', 'deadline']);
    });

    test('a refused decision (wrong state) creates no deadline', async () => {
        mockDb.application.findFirst.mockResolvedValue({ ...APPLICATION, status: 'DRAFT' });
        const res = await decide('REQUEST_MORE');
        expect(res.status).toBe(409);
        expect(mockUpsertDeadline).not.toHaveBeenCalled();
    });

    test('if the deadline row cannot be written the officer is told, not shown a silent success', async () => {
        mockUpsertDeadline.mockRejectedValue(new Error('db'));
        const res = await decide('REQUEST_MORE');
        expect(res.status).toBe(200);
        expect(res.body.data.revisionDeadlineRecorded).toBe(false);
    });
});

describe('ACCEPT_ALL does not start a clock', () => {
    test('no deadline is created', async () => {
        mockDb.applicationDocumentReview.findMany.mockResolvedValue([{ slotId: 'sop_manual', verdict: 'ACCEPTED', round: 1 }]);
        await decide('ACCEPT_ALL');
        expect(mockUpsertDeadline).not.toHaveBeenCalled();
    });
});

describe('one piece of code, two doors', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

    test('the generic transition door builds its deadline fields with the shared builder, not its own copy', () => {
        const src = read('routes/api/provider/handlers/workflow-transitions-handler.js');
        expect(src).toContain('buildRevisionDeadlineFormData');
        expect(src).not.toMatch(/revisionSlaDays:\s*REVISION_SLA_DAYS/);
    });

    test('the per-slot door uses the shared builder and the shared row writer', () => {
        const src = read('routes/api/provider/document-reviews.js');
        expect(src).toContain('buildRevisionDeadlineFormData');
        expect(src).toContain('handleRevisionDeadlines');
    });
});
