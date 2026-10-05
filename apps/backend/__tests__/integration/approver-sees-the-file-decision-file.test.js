'use strict';

/**
 * Batch A item 1 — the certificate approver reads the whole file before deciding.
 *
 *   GET /api/provider/auditor/applications/:id/decision-file
 *
 * Contract pinned here:
 *   - certificate_approver gets the application, the documents, the onsite checklist
 *     result per item, the photos with provenance (hash, GPS, time, duplicate flag),
 *     the GPS check, the inspector's summary and the CAR history;
 *   - only for a file that is in the decision queue (status AUDIT_PASSED);
 *   - roles outside CERT_DECIDERS are refused, and the approver still cannot WRITE
 *     audit results (POST /api/audit/onsite/:auditId/decision stays 403).
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../middleware/auth-middleware', () => {
    const actual = jest.requireActual('../../middleware/auth-middleware');
    const user = (req, res, next) => {
        const role = req.headers['x-test-role'];
        if (!role) { return res.status(401).json({ success: false, error: 'Unauthorized' }); }
        req.user = { id: req.headers['x-test-user-id'] || 'approver-1', role, canonicalRole: role, organizationId: req.headers['x-test-org'] === 'none' ? undefined : (req.headers['x-test-org'] || 'org-1') };
        return next();
    };
    return {
        ...actual,
        authenticateProvider: user,
        authenticateDTAM: user,
        authenticateAny: user,
    };
});
jest.mock('../../services/prisma-database', () => {
    const prisma = {
        application: { findFirst: jest.fn(), findMany: jest.fn() },
        applicationDocument: { findMany: jest.fn() },
        applicationDocumentReview: { findMany: jest.fn() },
        auditChecklist: { findFirst: jest.fn() },
        farmAuditChecklistItem: { findMany: jest.fn(), count: jest.fn() },
        farmAuditPhoto: { findMany: jest.fn() },
        attachment: { findMany: jest.fn() },
        gpsVerificationLog: { findFirst: jest.fn() },
        correctionRound: { findMany: jest.fn() },
        farm: { findUnique: jest.fn() },
        user: { findMany: jest.fn(), findUnique: jest.fn() },
        auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction = (fn) => (typeof fn === 'function' ? fn(prisma) : Promise.all(fn));
    return { prisma };
});
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    statusTransitionAuditHook: jest.fn(() => jest.fn().mockResolvedValue(null)),
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));
jest.mock('../../shared/logger', () => {
    const l = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    l.createLogger = jest.fn(() => ({ ...l }));
    l.stream = { write: jest.fn() };
    return l;
});
jest.mock('../../config/redis', () => null);
// The requirement engine is the one answer to "which papers does this filing need"
// (its own suite pins it) — the file view asks it, exactly like the reviewer's door.
jest.mock('../../services/application-requirements-service', () => ({
    resolveApplicationRequirements: jest.fn().mockResolvedValue({
        slots: [{
            slotId: 'ID_CARD', labelTH: 'สำเนาบัตรประชาชน', required: true, satisfied: true,
            fileUrl: '/uploads/application-drafts/1.pdf', fileName: 'idcard.pdf',
        }],
    }),
}));
jest.mock('../../middleware/rate-limiter', () => {
    const pass = (_req, _res, next) => next();
    return { rateLimiter: pass, strictRateLimiter: pass, createRateLimiter: () => pass };
});

const { prisma } = require('../../services/prisma-database');
const auditorRouter = require('../../routes/api/provider/auditor');
const onsiteRouter = require('../../routes/api/audit/onsite');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function seedFile() {
    prisma.application.findFirst.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-9001',
        status: 'AUDIT_PASSED',
        auditorId: 'inspector-9',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        updatedAt: new Date('2026-10-01T00:00:00Z'),
        auditNotes: 'แปลงตรงตามที่ยื่น',
        applicant: { firstName: 'สมชาย', lastName: 'ใจดี' },
        formData: {
            workflowState: 'AUDIT_PASSED',
            onsiteAuditId: 'audit-1',
            locationData: { farmAddress: '1 หมู่ 2 ต.ทดสอบ', latitude: 13.7, longitude: 100.5 },
            auditDecision: { decision: 'PASS', notes: 'ผ่านทุกข้อ', decidedAt: '2026-10-01T00:00:00.000Z' },
            auditDecisions: [
                { decision: 'MINOR', notes: 'ป้ายเตือนไม่ครบ', decidedAt: '2026-09-10T00:00:00.000Z',
                    findings: [{ index: 1, nonConformity: 'ไม่มีป้ายเตือน', correctiveAction: 'ติดป้าย' }] },
                { decision: 'PASS', notes: 'ผ่านทุกข้อ', decidedAt: '2026-10-01T00:00:00.000Z', findings: [] },
            ],
            carDocuments: [{ path: '/uploads/car/x.jpg', originalName: 'ภาพป้าย.jpg', uploadedAt: '2026-09-20T00:00:00.000Z' }],
        },
    });
    prisma.applicationDocument.findMany.mockResolvedValue([
        { documentType: 'ID_CARD', fileName: 'idcard.pdf', fileUrl: '/uploads/application-drafts/1.pdf', currentForSlot: true, supersededAt: null, createdAt: new Date() },
    ]);
    prisma.applicationDocumentReview.findMany.mockResolvedValue([
        { slotId: 'ID_CARD', verdict: 'ACCEPTED', reason: null, round: 1 },
    ]);
    prisma.auditChecklist.findFirst.mockResolvedValue({
        id: 'audit-1', applicationId: 'app-1', status: 'SUBMITTED', auditorId: 'inspector-9', createdAt: new Date(),
        application: { id: 'app-1', applicationNumber: 'APP-9001', formData: { locationData: { latitude: 13.7, longitude: 100.5 } } },
    });
    prisma.farmAuditChecklistItem.findMany.mockResolvedValue([
        { itemCode: '1.1', response: 'PASS', notes: 'เรียบร้อย', recordedAt: new Date() },
        { itemCode: '1.2', response: 'FAIL', notes: 'ขาดป้าย', recordedAt: new Date() },
    ]);
    prisma.farmAuditChecklistItem.count.mockResolvedValue(99);
    prisma.farmAuditPhoto.findMany.mockImplementation(async (args = {}) => {
        const rows = [
            {
                id: 'p1', attachmentId: 'att-1', createdAt: new Date('2026-10-01T01:00:00Z'), capturedAt: new Date('2026-10-01T01:00:00Z'),
                uploadedBy: 'inspector-9', fileHash: HASH_A, gpsLatitude: 13.7, gpsLongitude: 100.5,
                farmDistanceMeters: 12, farmDistanceStatus: 'MEASURED', captureTimeSource: 'CALLER_SUPPLIED_UNVERIFIED',
                captureWindowSource: 'INSPECTION_START', captureWindowStatus: 'INSIDE', captureWindowOffsetSec: 30,
                perceptualHash: 'ff00ff00ff00ff00', perceptualHashAlgo: 'dhash64', caption: 'ทางเข้า', checklistItemId: null,
            },
            {
                id: 'p2', attachmentId: 'att-2', createdAt: new Date('2026-10-01T01:05:00Z'), capturedAt: new Date('2026-10-01T01:05:00Z'),
                uploadedBy: 'inspector-9', fileHash: HASH_B, gpsLatitude: 13.7, gpsLongitude: 100.5,
                farmDistanceMeters: 9000, farmDistanceStatus: 'MEASURED', captureTimeSource: 'CALLER_SUPPLIED_UNVERIFIED',
                captureWindowSource: 'INSPECTION_START', captureWindowStatus: 'INSIDE', captureWindowOffsetSec: 60,
                perceptualHash: 'ff00ff00ff00ff00', perceptualHashAlgo: 'dhash64', caption: null, checklistItemId: null,
            },
        ];
        return args.select && Object.keys(args.select).length === 1 && args.select.fileHash
            ? rows.map((r) => ({ fileHash: r.fileHash })) : rows;
    });
    prisma.attachment.findMany.mockResolvedValue([
        { id: 'att-1', fileUrl: '/uploads/audits/audit-1/p1.jpg', fileName: 'p1.jpg' },
        { id: 'att-2', fileUrl: '/uploads/audits/audit-1/p2.jpg', fileName: 'p2.jpg' },
    ]);
    prisma.gpsVerificationLog.findFirst.mockResolvedValue({
        reportedLatitude: 13.7, reportedLongitude: 100.5, gpsAccuracy: 8, verifiedAt: new Date('2026-10-01T00:30:00Z'),
    });
    prisma.correctionRound.findMany.mockResolvedValue([
        { stage: 'FIELD_AUDIT', roundNo: 1, decidedAt: new Date('2026-09-10T00:00:00Z'), dueAt: new Date('2026-09-17T00:00:00Z') },
    ]);
}

describe('approver reads the whole file (item 1)', () => {
    let app;
    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/provider/auditor', auditorRouter);
        app.use('/api/audit/onsite', onsiteRouter);
    });
    beforeEach(() => {
        jest.clearAllMocks();
        seedFile();
    });

    const get = (role = 'certificate_approver', id = 'app-1') => request(app)
        .get(`/api/provider/auditor/applications/${id}/decision-file`)
        .set('x-test-role', role);

    test('approver receives application, documents, checklist per item, photos with provenance, GPS, summary, CAR history', async () => {
        const res = await get();
        expect(res.status).toBe(200);
        const d = res.body.data;

        expect(d.application).toEqual(expect.objectContaining({ id: 'app-1', applicationNumber: 'APP-9001', applicantName: 'สมชาย ใจดี' }));

        expect(d.documents).toHaveLength(1);
        expect(d.documents[0]).toEqual(expect.objectContaining({ slotId: 'ID_CARD', labelTH: 'สำเนาบัตรประชาชน', fileUrl: '/uploads/application-drafts/1.pdf', verdict: 'ACCEPTED' }));

        const a2 = d.onsite.checklist.find((c) => c.itemCode === '1.2');
        expect(a2).toEqual(expect.objectContaining({ response: 'FAIL', notes: 'ขาดป้าย' }));
        expect(typeof a2.prompt).toBe('string');

        expect(d.onsite.photos).toHaveLength(2);
        const p1 = d.onsite.photos.find((p) => p.photoId === 'p1');
        expect(p1).toEqual(expect.objectContaining({ fileHash: HASH_A, fileUrl: '/uploads/audits/audit-1/p1.jpg' }));
        expect(p1.gps).toEqual({ latitude: 13.7, longitude: 100.5 });
        expect(p1.capturedAt).toBeTruthy();
        expect(p1.flags).toContain('NEAR_DUPLICATE');
        const p2 = d.onsite.photos.find((p) => p.photoId === 'p2');
        expect(p2.flags).toContain('PLACE_BEYOND_TOLERANCE');
        expect(d.onsite.nearDuplicatePairs).toHaveLength(1);

        expect(d.onsite.gps).toEqual(expect.objectContaining({ withinTolerance: true, unknownFarmLocation: false }));

        expect(d.inspectorSummary).toEqual(expect.objectContaining({ decision: 'PASS', notes: 'ผ่านทุกข้อ' }));

        expect(d.carHistory.rounds[0]).toEqual(expect.objectContaining({ roundNo: 1 }));
        expect(d.carHistory.decisions.map((x) => x.decision)).toEqual(['MINOR']);
        expect(d.carHistory.decisions[0].findings[0].nonConformity).toBe('ไม่มีป้ายเตือน');
        expect(d.carHistory.applicantDocuments[0].name).toBe('ภาพป้าย.jpg');
    });

    test('says plainly whether the evidence would pass the issuance gate', async () => {
        const res = await get();
        expect(res.body.data.onsite.evidenceGate).toEqual(expect.objectContaining({ sufficient: expect.any(Boolean) }));
    });

    test('a file outside the decision queue (not AUDIT_PASSED) is not served -> 404', async () => {
        prisma.application.findFirst.mockResolvedValue(null);
        const res = await get('certificate_approver', 'app-elsewhere');
        expect(res.status).toBe(404);
        const where = prisma.application.findFirst.mock.calls[0][0].where;
        expect(JSON.stringify(where)).toMatch(/AUDIT_PASSED/);
    });

    test.each(['field_inspector', 'document_reviewer', 'dispatcher', 'finance_officer_platform', 'system_admin_dtam'])(
        '%s is refused (403) — the file is the decider\'s door', async (role) => {
            const res = await get(role);
            expect(res.status).toBe(403);
            expect(prisma.application.findFirst).not.toHaveBeenCalled();
        });

    test('the approver still cannot WRITE audit results', async () => {
        const res = await request(app)
            .post('/api/audit/onsite/audit-1/decision')
            .set('x-test-role', 'certificate_approver')
            .send({ decision: 'PASS' });
        expect(res.status).toBe(403);
    });

    test('the approver still cannot reach the inspector onsite reads or the disclosure switch', async () => {
        const ctx = await request(app).get('/api/audit/onsite/audit-1/context').set('x-test-role', 'certificate_approver');
        expect(ctx.status).toBe(403);
        const patch = await request(app)
            .patch('/api/audit/onsite/audit-1/checklist-items/i1/disclosure')
            .set('x-test-role', 'certificate_approver').send({ withheld: true, reason: 'x' });
        expect(patch.status).toBe(403);
    });

    describe('fix round 1 — organisation wall fails closed', () => {
        test('approver with no organisation is refused 403 on the file, nothing queried', async () => {
            const res = await get().set('x-test-org', 'none');
            expect(res.status).toBe(403);
            expect(prisma.application.findFirst).not.toHaveBeenCalled();
        });

        test('file of another organisation -> 404 (the query carries the caller org)', async () => {
            prisma.application.findFirst.mockImplementation(async ({ where }) => (where.organizationId === 'org-1' ? { id: 'app-1' } : null));
            const res = await get().set('x-test-org', 'org-2');
            expect(res.status).toBe(404);
            expect(prisma.application.findFirst.mock.calls[0][0].where.organizationId).toBe('org-2');
        });

        test('decision queue: no organisation -> 403, nothing queried', async () => {
            const res = await request(app).get('/api/provider/auditor/final-approval-queue')
                .set('x-test-role', 'certificate_approver').set('x-test-org', 'none');
            expect(res.status).toBe(403);
            expect(prisma.application.findMany).not.toHaveBeenCalled();
        });

        test('decision queue lists only the caller organisation (the files they can open)', async () => {
            prisma.application.findMany.mockResolvedValue([]);
            const res = await request(app).get('/api/provider/auditor/final-approval-queue')
                .set('x-test-role', 'certificate_approver').set('x-test-org', 'org-1');
            expect(res.status).toBe(200);
            expect(prisma.application.findMany.mock.calls[0][0].where).toEqual(
                expect.objectContaining({ status: 'AUDIT_PASSED', organizationId: 'org-1' }),
            );
        });
    });
});
