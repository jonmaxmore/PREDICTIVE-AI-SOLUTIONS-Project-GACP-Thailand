'use strict';

/**
 * provider-UAT-round2 2026-07-09 cluster — two LOW fixes:
 *
 *   (1) audits-reassign eligibility: the reassign target must be a STRICT
 *       auditor. The assign gate (scheduler-audit-schedules-post-handler) and
 *       the audit-decision handler both require canonicalRole==='field_inspector', so
 *       accepting a document_reviewer as the new auditor-of-record dead-ends the
 *       audit — the reviewer can never record a PASS/FAIL decision. The route
 *       previously accepted ['auditor','document_reviewer'].
 *
 *   (2) notify templates: AUDIT_REASSIGNED (old auditor) + AUDITOR_CHANGED
 *       (applicant) were emitted with NO template → recipients got the generic
 *       "การแจ้งเตือนใหม่" instead of a real Thai message.
 */

const { NotifyType, NotifyTemplates } = require('../../services/notification-service');

describe('(2) notify templates: AUDIT_REASSIGNED + AUDITOR_CHANGED render real Thai copy', () => {
    test('NotifyType keys exist', () => {
        expect(NotifyType.AUDIT_REASSIGNED).toBe('AUDIT_REASSIGNED');
        expect(NotifyType.AUDITOR_CHANGED).toBe('AUDITOR_CHANGED');
    });

    test('AUDIT_REASSIGNED renders non-generic Thai + includes app number and reason', () => {
        const t = NotifyTemplates[NotifyType.AUDIT_REASSIGNED];
        expect(typeof t).toBe('function');
        const out = t({ applicationNumber: 'GACP-2026-0007', reason: 'ผู้ตรวจลาป่วย' });
        expect(out.title).not.toBe('การแจ้งเตือนใหม่');
        expect(out.title).toMatch(/[฀-๿]/);
        expect(out.message).toContain('GACP-2026-0007');
        expect(out.message).toContain('ผู้ตรวจลาป่วย');
    });

    test('AUDIT_REASSIGNED omits the reason clause when no reason supplied', () => {
        const out = NotifyTemplates[NotifyType.AUDIT_REASSIGNED]({ applicationNumber: 'GACP-2026-0007' });
        expect(out.message).toContain('GACP-2026-0007');
        expect(out.message).not.toContain('เหตุผล');
    });

    test('AUDITOR_CHANGED renders non-generic Thai + includes app number and new auditor name', () => {
        const t = NotifyTemplates[NotifyType.AUDITOR_CHANGED];
        expect(typeof t).toBe('function');
        const out = t({ applicationNumber: 'GACP-2026-0007', newAuditorName: 'สมชาย ใจดี' });
        expect(out.title).not.toBe('การแจ้งเตือนใหม่');
        expect(out.title).toMatch(/[฀-๿]/);
        expect(out.message).toContain('GACP-2026-0007');
        expect(out.message).toContain('สมชาย ใจดี');
    });
});

describe('(1) audits-reassign eligibility: target must be a strict AUDITOR', () => {
    let request;
    let express;
    let mockFindAuditApplication;
    let mockFindReassignmentTargetUser;
    let mockTrackedUpdate;
    let mockSendNotification;
    let mockRecordAssignment;
    let currentUser;

    const APP_AUDIT_CONFIRMED = {
        id: 'APP-1',
        applicationNumber: 'GACP-2026-0007',
        status: 'AUDIT_CONFIRMED',
        auditorId: 'old-auditor-1',
        organizationId: 'org-1',
        formData: {},
        applicant: { id: 'applicant-1', firstName: 'เกษตรกร', lastName: 'ทดสอบ' },
    };

    beforeEach(() => {
        jest.resetModules();

        currentUser = { id: 'sched-1', role: 'dispatcher', canonicalRole: 'dispatcher', organizationId: 'org-1' };
        mockFindAuditApplication = jest.fn().mockResolvedValue(APP_AUDIT_CONFIRMED);
        mockFindReassignmentTargetUser = jest.fn();
        mockTrackedUpdate = jest.fn().mockResolvedValue({});
        mockSendNotification = jest.fn().mockResolvedValue({ id: 'n' });
        mockRecordAssignment = jest.fn().mockResolvedValue(null);

        jest.doMock('../../shared/logger', () => {
            const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            return { ...l, createLogger: jest.fn(() => l) };
        });
        // The reassign writes the application and the evidence row in one transaction.
        jest.doMock('../../services/prisma-database', () => {
            const tx = { auditChecklist: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
            return { prisma: { $transaction: async (cb) => cb(tx) } };
        });
        jest.doMock('../../middleware/auth-middleware', () => ({
            authenticateProvider: (req, _res, next) => { req.user = currentUser; next(); },
        }));
        jest.doMock('../../middleware/role-middleware', () => ({
            providerOnly: (_req, _res, next) => next(),
        }));
        jest.doMock('../../services/tracked-writer', () => ({
            trackedUpdate: (...a) => mockTrackedUpdate(...a),
        }));
        jest.doMock('../../middleware/audit-logger', () => ({
            auditLogger: { log: jest.fn() },
            AuditCategory: { APPLICATION: 'APPLICATION' },
            AuditSeverity: { HIGH: 'HIGH' },
            ResourceType: { APPLICATION: 'APPLICATION' },
        }));
        jest.doMock('../../services/application-service', () => ({
            findAuditApplication: (...a) => mockFindAuditApplication(...a),
            listReassignableAudits: jest.fn().mockResolvedValue([]),
        }));
        jest.doMock('../../services/provider-user-service', () => ({
            findReassignmentTargetUser: (...a) => mockFindReassignmentTargetUser(...a),
        }));
        jest.doMock('../../services/assignment-ledger-service', () => ({
            recordAssignment: (...a) => mockRecordAssignment(...a),
        }));
        jest.doMock('../../services/notification-service', () => ({
            sendNotification: (...a) => mockSendNotification(...a),
            NotifyType: new Proxy({}, { get: (_t, k) => String(k) }),
        }));

        express = require('express');
        request = require('supertest');
    });

    function buildApp() {
        const app = express();
        app.use(express.json());
        app.use('/audits-reassign', require('../../routes/api/audit/audits-reassign'));
        return app;
    }

    test('document_reviewer target → 400 (not eligible, must be AUDITOR); no write happens', async () => {
        mockFindReassignmentTargetUser.mockResolvedValue({
            id: 'rev-1', isDeleted: false, status: 'ACTIVE', providerId: 'P-REV-1',
            role: 'document_reviewer', firstName: 'นักตรวจ', lastName: 'เอกสาร',
        });

        const res = await request(buildApp())
            .post('/audits-reassign/APP-1/reassign')
            .send({ newAuditorId: 'rev-1', reason: 'ต้องการสับเปลี่ยน' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/AUDITOR/i);
        // No auditorId change written when the target is ineligible.
        expect(mockTrackedUpdate).not.toHaveBeenCalled();
    });

    test('auditor target → passes eligibility and performs the reassignment (200)', async () => {
        mockFindReassignmentTargetUser.mockResolvedValue({
            id: 'aud-2', isDeleted: false, status: 'ACTIVE', providerId: 'P-AUD-2',
            role: 'field_inspector', firstName: 'ผู้ตรวจ', lastName: 'ประเมิน',
        });

        const res = await request(buildApp())
            .post('/audits-reassign/APP-1/reassign')
            .send({ newAuditorId: 'aud-2', reason: 'ต้องการสับเปลี่ยน' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockTrackedUpdate).toHaveBeenCalledTimes(1);
    });
});
