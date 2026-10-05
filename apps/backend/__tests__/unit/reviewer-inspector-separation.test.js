/**
 * Separation of duties (operator ruling 2026-10-05): a field_inspector must NOT be the
 * document reviewer of the same application.
 *
 * Until now the reviewer pick-list deliberately included field inspectors ("one person may
 * read the papers in round one and visit in round two"), and nothing compared the reviewer
 * with the inspector, so one person could pass the papers and then pass the farm. Refused
 * at reviewer assignment and at inspector assignment (whichever comes second), and again
 * at decision time, each with a Thai catalogue error.
 */
'use strict';

const path = require('path');
const { lookup } = require('../../shared/error-codes');

const SOD = path.resolve(__dirname, '../../shared/reviewer-inspector-separation.js');
const THAI = /[฀-๿]/;

describe('the helper', () => {
    let sod;
    beforeAll(() => { sod = require(SOD); });

    test('same person on both sides is refused, each way, with its own code', () => {
        expect(() => sod.assertReviewerIsNotInspector({ reviewerId: 'u1', auditorId: 'u1' }))
            .toThrow(expect.objectContaining({ code: 'REVIEWER_IS_APPLICATION_INSPECTOR', statusCode: 409 }));
        expect(() => sod.assertInspectorIsNotReviewer({ reviewerId: 'u1', auditorId: 'u1' }))
            .toThrow(expect.objectContaining({ code: 'INSPECTOR_IS_APPLICATION_REVIEWER', statusCode: 409 }));
        expect(() => sod.assertDecisionNotByReviewerAndInspector({ actorId: 'u1', reviewerId: 'u1', auditorId: 'u1' }))
            .toThrow(expect.objectContaining({ code: 'DECISION_BY_REVIEWER_AND_INSPECTOR', statusCode: 403 }));
    });

    test('different people, or an empty side, pass', () => {
        expect(() => sod.assertReviewerIsNotInspector({ reviewerId: 'u1', auditorId: 'u2' })).not.toThrow();
        expect(() => sod.assertReviewerIsNotInspector({ reviewerId: 'u1', auditorId: null })).not.toThrow();
        expect(() => sod.assertInspectorIsNotReviewer({ reviewerId: null, auditorId: 'u2' })).not.toThrow();
        expect(() => sod.assertDecisionNotByReviewerAndInspector({ actorId: 'u2', reviewerId: 'u1', auditorId: 'u2' })).not.toThrow();
    });

    test('errors carry a Thai message, and the three codes are in the catalogue with Thai text', () => {
        let err;
        try { sod.assertReviewerIsNotInspector({ reviewerId: 'u1', auditorId: 'u1' }); } catch (e) { err = e; }
        expect(err.messageTh).toMatch(THAI);
        for (const code of ['REVIEWER_IS_APPLICATION_INSPECTOR', 'INSPECTOR_IS_APPLICATION_REVIEWER', 'DECISION_BY_REVIEWER_AND_INSPECTOR']) {
            const row = lookup(code);
            expect(row).toBeTruthy();
            expect(row.messageTh).toMatch(THAI);
        }
    });
});

function run(handler, req) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            status(c) { this.statusCode = c; return this; },
            json(p) { resolve({ status: this.statusCode, body: p }); return this; },
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}
const quietLogger = () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() });

describe('reviewer assignment refuses the application\'s own inspector', () => {
    function load(application, reviewer) {
        jest.resetModules();
        const writeAssignmentColumns = jest.fn().mockResolvedValue({ id: 'app-1', applicationNumber: 'N', status: 'ASSIGNED_FOR_REVIEW' });
        const rbac = jest.requireActual('../../shared/canonical-rbac');
        jest.doMock('../../routes/api/provider/handlers/scheduler-handler-deps', () => ({
            authenticateProvider: (_q, _r, n) => n(),
            requireCanonicalPermission: () => (_q, _r, n) => n(),
            PERMISSIONS: { APPLICATION_SCHEDULE: 'x' },
            logger: quietLogger(),
            prisma: {},
            workflowTransitionService: jest.requireActual('../../services/workflow-transition-service'),
            getApplicantName: (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim(),
            getRequestIp: () => '127.0.0.1',
            auditLogger: { log: jest.fn() },
            AuditCategory: {}, AuditSeverity: {}, ResourceType: {},
            normalizeRole: rbac.normalizeRole,
            CANONICAL_ROLES: rbac.CANONICAL_ROLES,
            requireRole: () => (_q, _r, n) => n(),
            applicationService: { findAuditApplication: jest.fn(async () => application) },
        }));
        jest.doMock('../../services/application-service', () => ({
            findFirstWithWhere: jest.fn(async () => application),
            writeAssignmentColumns,
        }));
        jest.doMock('../../services/provider-user-service', () => ({
            findActiveProviderReviewerById: jest.fn(async () => reviewer),
            findReassignmentTargetUser: jest.fn(async () => reviewer),
        }));
        jest.doMock('../../services/notification-service', () => ({ createNotification: jest.fn().mockResolvedValue({}) }));
        jest.doMock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn().mockResolvedValue(null) }));
        jest.doMock('../../services/tracked-writer', () => ({ trackedUpdate: jest.fn().mockResolvedValue({}) }));
        return { writeAssignmentColumns };
    }
    const baseApp = (over = {}) => ({
        id: 'app-1', applicationNumber: 'N-1', status: 'DOC_FEE_PAID', healthId: 'h', organizationId: 'org-1',
        formData: { workflowState: 'DOC_FEE_PAID' }, workflowHistory: [], applicant: { id: 'a', firstName: 'ก', lastName: 'ข' },
        auditorId: null, reviewerId: null, ...over,
    });
    const inspector = { id: 'insp-1', role: 'field_inspector', providerId: 'P1', firstName: 'ผู้ตรวจ', lastName: 'หนึ่ง', status: 'ACTIVE', isDeleted: false };
    const user = { id: 'disp-1', role: 'dispatcher', canonicalRole: 'dispatcher', organizationId: 'org-1' };

    test('assign-reviewer: the person already assigned as this application\'s inspector is refused, nothing written', async () => {
        const { writeAssignmentColumns } = load(baseApp({ auditorId: 'insp-1' }), inspector);
        const { schedulerAssignReviewer } = require('../../routes/api/provider/handlers/scheduler-assign-reviewer-handler');
        const out = await run(schedulerAssignReviewer.slice(-1)[0], { body: { applicationId: 'app-1', reviewerId: 'insp-1' }, user, get: () => '' });
        expect(out.status).toBe(409);
        expect(out.body.code).toBe('REVIEWER_IS_APPLICATION_INSPECTOR');
        expect(out.body.messageTh).toMatch(THAI);
        expect(writeAssignmentColumns).not.toHaveBeenCalled();
    });

    test('assign-reviewer: a field inspector who is NOT this application\'s inspector is still a valid reviewer', async () => {
        const { writeAssignmentColumns } = load(baseApp({ auditorId: 'someone-else' }), inspector);
        const { schedulerAssignReviewer } = require('../../routes/api/provider/handlers/scheduler-assign-reviewer-handler');
        const out = await run(schedulerAssignReviewer.slice(-1)[0], { body: { applicationId: 'app-1', reviewerId: 'insp-1' }, user, get: () => '' });
        expect(out.status).toBe(200);
        expect(writeAssignmentColumns).toHaveBeenCalled();
    });

    test('reviewer reassign: same refusal', async () => {
        load(baseApp({ status: 'ASSIGNED_FOR_REVIEW', auditorId: 'insp-1', reviewerId: 'rev-old' }), inspector);
        const { schedulerReviewerReassign } = require('../../routes/api/provider/handlers/scheduler-reviewer-reassign-handler');
        const { trackedUpdate } = require('../../services/tracked-writer');
        const out = await run(schedulerReviewerReassign.slice(-1)[0], {
            params: { id: 'app-1' }, body: { newReviewerId: 'insp-1', reason: 'ผู้ตรวจเดิมลา' }, user, get: () => '',
        });
        expect(out.status).toBe(409);
        expect(out.body.code).toBe('REVIEWER_IS_APPLICATION_INSPECTOR');
        expect(trackedUpdate).not.toHaveBeenCalled();
    });
});

describe('inspector assignment (queue door, assignAuditor) refuses the application\'s own reviewer', () => {
    test('409 INSPECTOR_IS_APPLICATION_REVIEWER, no transaction opened', async () => {
        jest.resetModules();
        const app = {
            id: 'app-1', applicationNumber: 'N-1', status: 'AUDIT_FEE_PAID', organizationId: 'org-1', healthId: 'h',
            auditorId: null, reviewerId: 'insp-1', scheduledDate: null, formData: { workflowState: 'AUDIT_FEE_PAID' }, workflowHistory: [],
        };
        const prisma = {
            application: { findFirst: jest.fn(async () => app), findUnique: jest.fn(), findMany: jest.fn(async () => []), update: jest.fn() },
            user: { findFirst: jest.fn(async () => ({ id: 'insp-1', role: 'field_inspector', firstName: 'ก', lastName: 'ข', status: 'ACTIVE' })) },
            auditChecklist: {},
            $transaction: jest.fn(),
        };
        jest.doMock('../../services/prisma-database', () => ({ prisma }));
        jest.doMock('../../services/notification-service', () => ({ createNotification: jest.fn() }));
        jest.doMock('../../services/notification-fanout-service', () => ({ send: jest.fn() }));
        jest.doMock('../../middleware/audit-logger', () => ({
            auditLogger: { log: jest.fn() }, AuditCategory: {}, AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' }, ResourceType: {},
        }));
        jest.doMock('../../utils/working-days', () => ({ ...jest.requireActual('../../utils/working-days'), isWorkingDay: () => true }));
        const service = require('../../services/audit-scheduling-service');
        await expect(service.assignAuditor({
            applicationId: 'app-1', auditorId: 'insp-1', scheduledDate: new Date(Date.now() + 9 * 86400000).toISOString(),
            location: 'ฟาร์ม', actor: { id: 'd', canonicalRole: 'dispatcher', role: 'dispatcher', organizationId: 'org-1' },
        })).rejects.toMatchObject({ code: 'INSPECTOR_IS_APPLICATION_REVIEWER', statusCode: 409 });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe('decision time', () => {
    test('document-decision: the reviewer who is also the application\'s inspector may not decide (403, nothing moves)', async () => {
        jest.resetModules();
        const express = require('express');
        const request = require('supertest');
        const mockWrite = jest.fn();
        const mockDb = {
            application: { findFirst: jest.fn(async () => ({
                id: 'app-1', organizationId: 'org-1', isDeleted: false, status: 'ASSIGNED_FOR_REVIEW',
                reviewerId: 'insp-1', auditorId: 'insp-1', formData: {}, workflowHistory: [],
            })) },
            applicationDocument: { findMany: jest.fn(async () => []) },
            applicationDocumentReview: { findMany: jest.fn(async () => [{ slotId: 's', verdict: 'ACCEPTED', round: 1 }]) },
        };
        jest.doMock('../../routes/api/provider/handlers/shared', () => ({
            authenticateProvider: (req, _res, next) => { req.user = { id: 'insp-1', role: 'field_inspector', canonicalRole: 'field_inspector' }; next(); },
            requireCanonicalPermission: () => (_q, _s, n) => n(),
            PERMISSIONS: jest.requireActual('../../shared/canonical-rbac').PERMISSIONS,
        }));
        jest.doMock('../../services/prisma-database', () => ({ prisma: mockDb }));
        jest.doMock('../../services/application-status-writer', () => ({ writeApplicationStatus: mockWrite }));
        jest.doMock('../../services/notification/domain-helpers', () => ({ notifyRevisionRequired: jest.fn(), notifyDocumentApproved: jest.fn() }));
        jest.doMock('../../services/application-requirements-service', () => ({
            resolveApplicationRequirements: jest.fn().mockResolvedValue({ slots: [{ slotId: 's', labelTH: 'ก', required: true, satisfied: true }], dims: {} }),
        }));
        const a = express();
        a.use(express.json());
        a.use('/api/provider/applications', require('../../routes/api/provider/document-reviews'));
        const res = await request(a).post('/api/provider/applications/app-1/document-decision').send({ action: 'ACCEPT_ALL' });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('DECISION_BY_REVIEWER_AND_INSPECTOR');
        expect(res.body.messageTh).toMatch(THAI);
        expect(mockWrite).not.toHaveBeenCalled();
    });

    test('audit-decision (PASS/MINOR/MAJOR/REJECT): the inspector who is also the application\'s document reviewer may not decide', async () => {
        jest.resetModules();
        const rbac = jest.requireActual('../../shared/canonical-rbac');
        const findAuditDecisionApplication = jest.fn(async () => ({
            id: 'app-1', applicationNumber: 'N-1', healthId: 'h', status: 'AUDIT_CONFIRMED',
            auditorId: 'insp-1', reviewerId: 'insp-1', formData: {}, workflowHistory: [],
        }));
        const writeApplicationStatus = jest.fn();
        jest.doMock('../../routes/api/provider/handlers/auditor-handler-deps', () => ({
            authenticateProvider: (_q, _r, n) => n(),
            logger: quietLogger(),
            PERMISSIONS: rbac.PERMISSIONS,
            requireCanonicalPermission: () => (_q, _r, n) => n(),
            obj: (v) => v || {}, arr: (v) => (Array.isArray(v) ? v : []),
            prisma: {},
            workflowTransitionService: jest.requireActual('../../services/workflow-transition-service'),
            getRequestIp: () => '', auditLogger: { log: jest.fn() }, AuditCategory: {}, AuditSeverity: {}, ResourceType: {},
            resolveUserIdFromHealthId: jest.fn(async () => 'farmer'),
            applicationService: { findAuditDecisionApplication },
        }));
        jest.doMock('../../services/application-status-writer', () => ({ writeApplicationStatus }));
        jest.doMock('../../middleware/auth-middleware', () => ({ requireRole: () => (_q, _r, n) => n() }));
        jest.doMock('../../services/notification-service', () => ({ createNotification: jest.fn() }));
        jest.doMock('../../services/car-deadline-service', () => ({ computeCarDueDate: jest.fn(), seedCarRevisionDeadline: jest.fn() }));
        const { auditorAuditDecisions } = require('../../routes/api/provider/handlers/auditor-audit-decision-handler');
        const out = await run(auditorAuditDecisions.slice(-1)[0], {
            params: { id: 'app-1' }, body: { decision: 'PASS' }, user: { id: 'insp-1', role: 'field_inspector', canonicalRole: 'field_inspector' }, get: () => '',
        });
        expect(out.status).toBe(403);
        expect(out.body.code).toBe('DECISION_BY_REVIEWER_AND_INSPECTOR');
        expect(writeApplicationStatus).not.toHaveBeenCalled();
    });

    test('onsite decision (submitDecision): same refusal on the field-app door', async () => {
        jest.resetModules();
        const audit = {
            id: 'audit-1', status: 'IN_PROGRESS', auditorId: 'insp-1',
            application: { id: 'app-1', status: 'AUDIT_CONFIRMED', applicationNumber: 'N-1', healthId: 'h', formData: {}, reviewerId: 'insp-1', auditorId: 'insp-1' },
        };
        const prisma = { auditChecklist: { findFirst: jest.fn(async () => audit) } };
        jest.doMock('../../services/prisma-database', () => ({ prisma }));
        const svc = require('../../services/audit-onsite-service');
        await expect(svc.submitDecision({ prisma, auditId: 'audit-1', actorId: 'insp-1', decision: 'PASS', summary: 'ok' }))
            .rejects.toMatchObject({ code: 'DECISION_BY_REVIEWER_AND_INSPECTOR' });
    });
});
