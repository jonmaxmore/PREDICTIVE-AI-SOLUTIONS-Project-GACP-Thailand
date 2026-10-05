'use strict';
/**
 * ประตูอัปโหลดจริงต้องปฏิเสธการแก้ช่องที่เจ้าหน้าที่ตรวจผ่านแล้ว
 *
 * operator 2026-09-11: *"ถ้าเจ้าหน้าที่ผ่านไปแล้ว ไม่สามารถกลับมาแก้เอกสารได้"*
 *
 * กติกาถูกตรึงไว้แล้วที่ a-paper-the-officer-passed-cannot-be-replaced.test.js — ไฟล์นี้
 * ตรึงคนละอย่าง: **ประตูเรียกกติกานั้นจริง** · บทเรียนที่ซ้ำในโครงนี้คือด่านที่เขียนถูกแต่
 * ไม่มีใครเรียก มันจะเขียวตลอดไปและไม่กันอะไรเลย
 *
 * และตรึงว่าไฟล์ที่ถูกปฏิเสธ **ไม่ค้างบนดิสก์** — multer เขียนไฟล์ลงไปก่อนจะถึงด่านนี้เสมอ
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../../middleware/auth-middleware', () => {
    const asHealthUser = (req, _res, next) => {
        req.user = { id: 'user-1', role: 'health', canonicalRole: 'health', healthId: 'health-1' };
        return next();
    };
    return {
        authenticateHealth: asHealthUser,
        authenticateAny: asHealthUser,
        authenticateProvider: asHealthUser,
    };
});

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(),
    deleteDraft: jest.fn(),
    findApplicationByIdForHealth: jest.fn(),
    findLatestOpenDraftForHealth: jest.fn(),
    findPersonalEntityForHealthIdentity: jest.fn(),
    healDraftEntityColumns: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: jest.fn(),
    findDraftForSubmit: jest.fn(),
    getApplicationSlice: jest.fn(),
    findUserOrganizationId: jest.fn(),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
}));

jest.mock('../../services/entity-service', () => ({
    ...jest.requireActual('../../services/entity-service'),
    assertCapability: jest.fn(),
    ensureEntityFromApplicantData: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: { applicationDocumentReview: { findMany: (...a) => mockFindReviews(...a) } },
}));

jest.mock('../../services/fee-service', () => ({
    calculatePhase1Fee: jest.fn(() => ({})),
    calculatePhase2Fee: jest.fn(() => ({})),
}));

const mockSyncApplicationDocument = jest.fn(async () => null);
jest.mock('../../services/application-document-sync', () => ({
    syncApplicationDocument: (...a) => mockSyncApplicationDocument(...a),
    removeApplicationDocument: jest.fn(async () => undefined),
}));

jest.mock('../../services/application-status-writer', () => ({ writeApplicationStatus: jest.fn() }));
jest.mock('../../services/quotation-service', () => ({ issueQuotationsForApplication: jest.fn().mockResolvedValue(null) }));
jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));
jest.mock('../../services/working-days-service', () => ({
    addWorkingDays: jest.fn((d) => d),
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'wf-1' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    mapHealthApplication: jest.fn((app) => app),
    getHealthScopeOptions: jest.fn((user) => ({ healthId: user?.healthId, strictHealthScope: true })),
    getActorIdentity: jest.fn((user) => user?.id || null),
}));

jest.mock('../../routes/api/helpers/application-constants', () => ({
    MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    AUDITOR_ROLES: new Set(['auditor', 'admin']),
    REJECTABLE_STATUSES: new Set(['SUBMITTED']),
    REVISION_DECISION_TYPES: new Set(['DOC_REVISION']),
    asObject: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    upper: (v) => String(v || '').toUpperCase(),
    ensureApplicationNumber: jest.fn(() => 'APP-TEST-001'),
    isMissingApplicationCommentsTableError: jest.fn(() => false),
    mergeMasterSteps: jest.fn(() => ({})),
    validateMasterSubmission: jest.fn(() => ({ isValid: true, missingByStep: {} })),
}));

jest.mock('../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));

jest.mock('../../validation/application-schemas', () => ({
    validateStep: jest.fn(() => ({ success: true, errors: [] })),
    validateAllSteps: jest.fn(() => ({ isValid: true, errorsByStep: {} })),
}));

jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../routes/api/applications/application-workflow-handlers', () => require('express').Router());

const applicationService = require('../../services/application-service');
const storageService = require('../../services/storage-service');
const applicationsRouter = require('../../routes/api/applications/applications');

const DRAFT_DIR = path.join(storageService.BASE_UPLOAD_DIR, 'application-drafts');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', applicationsRouter);
    app.use((err, _req, res, _next) => res.status(500).json({ success: false, error: 'INTERNAL', message: err.message }));
    return app;
}

/** A PDF the size of the smallest real one-page Thai permit in this system. */
function realisticPdf(bytes = 14029) {
    const header = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'utf8');
    return Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length), 0x20)]);
}

/** คำตัดสินรายช่องที่ฐานข้อมูลจะตอบกลับมา — ตั้งค่าได้ต่อเทส */
let mockFindReviews = jest.fn(async () => []);

const DRAFT_DIR_FILES = () => { try { return new Set(fs.readdirSync(DRAFT_DIR)); } catch { return new Set(); } };

let draftDocuments = [];

function uploadTo(slotId, filename = 'paper.pdf') {
    return request(buildApp())
        .post('/api/applications/draft-documents')
        .field('slotId', slotId)
        .field('stepKey', 'documents')
        .attach('file', realisticPdf(), { filename, contentType: 'application/pdf' });
}

beforeEach(() => {
    jest.clearAllMocks();
    draftDocuments = [];
    mockFindReviews = jest.fn(async () => []);
    applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
    applicationService.findApplicationByIdForHealth.mockResolvedValue(null);
    applicationService.findLatestOpenDraftForHealth.mockImplementation(async () => ({
        id: 'app-1',
        applicationNumber: 'APP-2026-000001',
        // คำขอที่ถูกตีกลับ — สถานะนี้เปิดให้แก้ทั้งใบ ซึ่งคือเหตุผลที่ต้องมีด่านรายช่อง
        status: 'REVISION_REQUESTED',
        entityId: 'ent-1',
        submitterId: 'user-1',
        formData: { draftDocuments },
        workflowHistory: [],
    }));
    applicationService.updateApplicantDraftColumns.mockImplementation(async (_id, patch) => {
        draftDocuments = patch.formData.draftDocuments;
        return { id: 'app-1', formData: patch.formData };
    });
});

describe('POST /draft-documents — ช่องที่ผ่านแล้ว ประตูต้องปฏิเสธ', () => {
    test('ช่องที่เจ้าหน้าที่กดผ่าน → 409 และไม่มีอะไรถูกเขียน', async () => {
        mockFindReviews = jest.fn(async () => [
            { slotId: 'controlled_herb_license', verdict: 'ACCEPTED', round: 1 },
        ]);

        const res = await uploadTo('controlled_herb_license');

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DOCUMENT_SLOT_ALREADY_ACCEPTED');
        expect(res.body.messageTh).toMatch(/ผ่าน/);
        // ไม่มีการเขียนใด ๆ — ไม่ใช่แค่ตอบ 409 แล้วเขียนไปแล้ว
        expect(applicationService.updateApplicantDraftColumns).not.toHaveBeenCalled();
        expect(draftDocuments).toHaveLength(0);
    });

    test('ชื่อช่องที่ผู้ยื่นส่งมาไม่ใช่ชื่อที่ตารางผลตรวจเก็บ — ด่านต้องแปลงก่อนเทียบ', async () => {
        // `LICENSE_BT11` ไม่ใช่ชื่อที่ตารางผลตรวจเก็บ — มันแปลงเป็น **`controlled_herb_license`**
        // (ชื่อพ้องของช่องนั้น) · ถ้าด่านเทียบสตริงดิบ มันจะไม่ล็อกอะไรเลยและเขียวตลอดไป
        mockFindReviews = jest.fn(async () => [
            { slotId: 'controlled_herb_license', verdict: 'ACCEPTED', round: 1 },
        ]);
        for (const spelling of ['LICENSE_BT11', 'license_bt11', 'CONTROLLED_HERB_LICENSE', 'controlled_herb_license']) {
            // eslint-disable-next-line no-await-in-loop
            const res = await uploadTo(spelling);
            expect(res.status).toBe(409);
        }
    });

    test('ไฟล์ที่ถูกปฏิเสธไม่ค้างบนดิสก์', async () => {
        mockFindReviews = jest.fn(async () => [
            { slotId: 'controlled_herb_license', verdict: 'ACCEPTED', round: 1 },
        ]);
        const before = DRAFT_DIR_FILES();
        await uploadTo('controlled_herb_license', 'refused.pdf');
        const added = [...DRAFT_DIR_FILES()].filter((n) => !before.has(n));
        expect(added).toEqual([]);
    });

    test('ช่องที่เจ้าหน้าที่ขอให้แก้ → อัปได้ตามปกติ', async () => {
        mockFindReviews = jest.fn(async () => [
            { slotId: 'controlled_herb_license', verdict: 'ACCEPTED', round: 1 },
            { slotId: 'water_test', verdict: 'MORE_REQUESTED', round: 1 },
        ]);
        const res = await uploadTo('WATER_TEST');
        expect(res.status).toBe(200);
        expect(draftDocuments).toHaveLength(1);
    });

    test('ช่องที่ยังไม่เคยถูกตรวจ → อัปได้', async () => {
        mockFindReviews = jest.fn(async () => [
            { slotId: 'controlled_herb_license', verdict: 'ACCEPTED', round: 1 },
        ]);
        const res = await uploadTo('PHOTOS_EXTERIOR');
        expect(res.status).toBe(200);
    });

    test('เจ้าหน้าที่กลับคำเป็นขอแก้ในรอบถัดไป → เปิดให้อัปอีกครั้ง', async () => {
        mockFindReviews = jest.fn(async () => [
            { slotId: 'controlled_herb_license', verdict: 'ACCEPTED', round: 1 },
            { slotId: 'controlled_herb_license', verdict: 'MORE_REQUESTED', round: 2 },
        ]);
        const res = await uploadTo('controlled_herb_license');
        expect(res.status).toBe(200);
    });
});

describe('DELETE /draft-documents/:id — ลบก็คือแก้', () => {
    test('ลบเอกสารของช่องที่ผ่านแล้ว → 409', async () => {
        draftDocuments = [{ documentId: 'doc-1', slotId: 'controlled_herb_license', fileName: 'p.pdf' }];
        mockFindReviews = jest.fn(async () => [
            { slotId: 'controlled_herb_license', verdict: 'ACCEPTED', round: 1 },
        ]);

        const res = await request(buildApp()).delete('/api/applications/draft-documents/doc-1');

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('DOCUMENT_SLOT_ALREADY_ACCEPTED');
        expect(draftDocuments).toHaveLength(1);
    });

    test('ลบเอกสารของช่องที่ถูกขอให้แก้ → ทำได้', async () => {
        draftDocuments = [{ documentId: 'doc-2', slotId: 'WATER_TEST', fileName: 'w.pdf' }];
        mockFindReviews = jest.fn(async () => [
            { slotId: 'water_test', verdict: 'MORE_REQUESTED', round: 1 },
        ]);

        const res = await request(buildApp()).delete('/api/applications/draft-documents/doc-2');
        expect(res.status).toBe(200);
    });
});
