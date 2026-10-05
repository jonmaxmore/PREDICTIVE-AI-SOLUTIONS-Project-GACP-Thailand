'use strict';

/**
 * ประตูยื่นจริง (POST /api/applications/submit) ต้องแตกเป็น N เคส ไม่ใช่แค่ตัวบริการทำได้
 *
 * ตัวบริการ `services/application-fan-out.js` ถูกพิสูจน์ไปแล้ว (ด่านของมันเอง 14 เคส และ
 * รันกับฐานจริงในทรานแซกชันที่ย้อนกลับ) แต่ **ไม่มีใครเรียกมัน** ⇒ ผู้ยื่นที่ติ๊กสามรูปแบบ
 * ยังได้คำขอใบเดียว · ไฟล์นี้ปักพฤติกรรมของ "ประตู" ไม่ใช่ของตัวบริการ
 *
 * operator 2026-09-11:
 *   • "คนส่งคิวงานต้องเห็นเอกสาร 3 ชุด ไม่ใช่ 1 ชุดรวม 3 รูปแบบ (เลขงาน เลขเคส
 *      หรือเลข ticket ต้องไม่เหมือนกัน)"
 *   • "แก้ไขเป็นจ่ายเงิน 3 ใบครับ เพราะ 3 ยอดรวมกันมันจะกระทบยอดกันยาก ระหว่างงวด 1
 *      และงวด 2" ⇒ **ใบเสนอราคาต้องออกต่อเคส** ไม่ใช่ใบเดียวของการกดครั้งนั้น
 *
 * สิ่งที่ปักไว้
 *   1. ติ๊กสาม → สามเคส · แต่ละเคสเดินสองฮ็อปของตัวเอง (DRAFT→SUBMITTED→รอชำระ)
 *   2. ฮ็อปของเคสไหน ถือลักษณะพื้นที่ของเคสนั้น **แบบเดียว** — ไม่ใช่ทั้งสาม
 *   3. ใบเสนอราคาออกครบทุกเคส (สายเงินของ operator)
 *   4. ทุกเคสชี้ฟาร์มใบเดียวกัน — ที่ดินผืนเดียว ไม่ใช่สามผืน
 *   5. ติ๊กเดียว = หนึ่งเคส ไม่มี bundle และไม่มีอะไรเปลี่ยนสำหรับผู้ยื่นเดิม
 *   6. คำตอบของประตูบอกครบทุกเลข — ไม่งั้นผู้ยื่นรู้จักคำขอของตัวเองแค่ใบเดียวจากสามใบ
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

const V2_FILING = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'v2-wizard-real-filing.json'), 'utf8',
));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: 'user-1',
            healthId: '1100000000008',
            canonicalId: '1100000000008',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser, authenticateProvider: passUser };
});

// ไคลเอนต์ทรานแซกชันจริงเปิด namespace ของโมเดล แต่ไม่มี `$transaction` — ตัวแยกตัวเดียวกับ
// ที่ตัวเขียนสถานะใช้เอง · ที่นี่ทำให้มันจำแถวได้จริง เพราะตัวแตกเคสอ่านค่าที่มันเพิ่งเขียน
const TX = {
    __tx: 'submit-tx',
    farm: { create: jest.fn() },
    application: { update: jest.fn(), create: jest.fn(), count: jest.fn() },
    applicationBundle: { create: jest.fn() },
    // ตัวแตกเคสสำเนาแถว application_documents ไปให้เคสพี่น้องด้วย (2026-09-11) — ชุดนี้
    // ตรวจเรื่องประตู ไม่ใช่เรื่องเอกสาร จึงสตับให้ว่าง · กติกาการสำเนาถูกตรึงไว้ที่
    // __tests__/unit/fan-out-copies-the-papers-to-every-case.test.js
    applicationDocument: { findMany: jest.fn(async () => []), createMany: jest.fn(async ({ data }) => ({ count: data.length })) },
};
const mockTransaction = jest.fn(async (cb) => cb(TX));
const mockWriteApplicationStatus = jest.fn().mockResolvedValue({ id: 'app-1' });

jest.mock('../../services/application-status-writer', () => {
    const actual = jest.requireActual('../../services/application-status-writer');
    return {
        writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
        TERMINAL_STATUSES: actual.TERMINAL_STATUSES,
    };
});

jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(async () => ({ allowed: true, via: 'ENTITY_PERMISSION' })),
}));

jest.mock('../../services/application-document-requirements', () => {
    const actual = jest.requireActual('../../services/application-document-requirements');
    return { ...actual, assertRequiredDocumentsPresent: jest.fn(async () => ({ appliedRules: [] })) };
});

jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: { log: jest.fn().mockResolvedValue({ id: 'audit-1' }), logWithin: jest.fn(() => jest.fn()) },
    };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        $transaction: (...a) => mockTransaction(...a),
        application: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        farm: { create: jest.fn(), findFirst: jest.fn() },
    },
}));

jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(),
    deleteDraft: jest.fn(),
    findApplicationByIdForHealth: jest.fn(),
    findLatestOpenDraftForHealth: jest.fn(),
    healDraftEntityColumns: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: jest.fn(),
    findDraftForSubmit: jest.fn(),
    getApplicationSlice: jest.fn(),
    findUserOrganizationId: jest.fn(),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
}));

jest.mock('../../services/correction-submission-version-service', () => ({
    snapshotCorrectionSubmission: jest.fn().mockResolvedValue({ id: 'csv-1' }),
}));

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: {},
}));

jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'we-1' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((u) => ({ healthId: u.healthId, strictHealthScope: true })),
    mapHealthApplication: jest.fn((a) => a),
    getActorIdentity: jest.fn(() => 'user-1'),
}));

jest.mock('../../routes/api/helpers/application-constants', () => ({
    MASTER_STEPS: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    AUDITOR_ROLES: [],
    REJECTABLE_STATUSES: [],
    REVISION_DECISION_TYPES: [],
    asObject: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}),
    asArray: (v) => (Array.isArray(v) ? v : []),
    upper: (v) => String(v || '').toUpperCase(),
    ensureApplicationNumber: jest.fn(() => 'APP-2026-100'),
    isMissingApplicationCommentsTableError: () => false,
    mergeMasterSteps: jest.fn(() => ({})),
    validateMasterSubmission: jest.fn(() => ({ isValid: true, missingByStep: {} })),
    pickWizardOwnedFormData: (v) => (v && typeof v === 'object' ? v : {}),
}));

jest.mock('../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => [{ uploaded: true, url: '/uploads/x.pdf' }]),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));

jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../routes/api/applications/application-workflow-handlers', () => require('express').Router());
jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
}));
jest.mock('../../services/fee-service', () => ({}));
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
    ensurePhase1Quotations: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/quotation-issuance-on-submit', () => ({
    issueQuotationOnSubmit: jest.fn().mockResolvedValue({ issued: true }),
}));

const applicationService = require('../../services/application-service');
const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
const { createNotification } = require('../../services/notification-service');
const submitRouter = require('../../routes/api/applications/applications');

function mountSubmit() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', submitRouter);
    return app;
}

function draftRow(formData) {
    return {
        id: 'app-1',
        applicationNumber: 'APP-2026-100',
        status: 'DRAFT',
        healthId: '1100000000008',
        entityId: 'ent-1',
        organizationId: 'org-1',
        submitterId: 'user-1',
        serviceType: 'new_application',
        bundleId: null,
        formData,
        workflowHistory: [],
    };
}

/** ทุกการเรียกตัวเขียนสถานะ เรียงตามลำดับที่เกิดจริง */
const writerCalls = () => mockWriteApplicationStatus.mock.calls.map(([a]) => a);

/** applicationId ที่ไม่ซ้ำ เรียงตามการพบครั้งแรก */
const caseIds = () => [...new Set(writerCalls().map((c) => c.applicationId))];

const areaTypesOf = (call) => call.additionalData.formData.farmData.areaTypes;

function filingWithTicks(ticks) {
    const filing = JSON.parse(JSON.stringify(V2_FILING));
    filing.farmData.areaTypes = ticks;
    return filing;
}

describe('POST /applications/submit — ติ๊ก N รูปแบบ ต้องได้ N เคส', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(TX));
        mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1' });
        TX.farm.create.mockResolvedValue({ id: 'farm-new-1', organizationId: 'org-1' });
        TX.application.count.mockResolvedValue(7);
        TX.applicationBundle.create.mockImplementation(async ({ data }) => ({ id: 'bundle-1', ...data }));
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.getApplicationSlice.mockImplementation(async (id) => ({
            id, applicationNumber: `NUM-${id}`, status: 'PENDING_DOC_FEE', organizationId: 'org-1',
        }));
        issueQuotationOnSubmit.mockResolvedValue({ issued: true });
        app = mountSubmit();
    });

    const submit = () => request(app)
        .post('/api/applications/submit')
        .send({ applicationId: 'app-1', declarationsAccepted: true });

    /** ให้ตัวแตกเคสทำงานกับแถวที่ "จำได้" — ไม่ใช่ค่าที่ตั้งไว้ล่วงหน้าใบเดียว */
    function seedDraft(ticks) {
        const row = draftRow(filingWithTicks(ticks));
        applicationService.findDraftForSubmit.mockResolvedValue(row);
        TX.application.update.mockImplementation(async ({ where, data }) => ({ ...row, ...where, ...data }));
        let n = 0;
        TX.application.create.mockImplementation(async ({ data }) => {
            n += 1;
            return { ...row, id: `app-sib-${n}`, ...data };
        });
        return row;
    }

    describe('ติ๊กสามรูปแบบ', () => {
        beforeEach(() => { seedDraft(['OUTDOOR', 'GREENHOUSE', 'INDOOR']); });

        test('ได้สามเคส เลขคนละใบ และแต่ละเคสเดินสองฮ็อปของตัวเอง', async () => {
            const res = await submit();
            expect(res.status).toBe(200);
            expect(caseIds()).toHaveLength(3);
            expect(writerCalls()).toHaveLength(6);
            // สองฮ็อปต่อเคส ไม่ใช่หกฮ็อปกองบนเคสเดียว
            for (const id of caseIds()) {
                const hops = writerCalls().filter((c) => c.applicationId === id);
                expect(hops.map((h) => h.toStatus)).toEqual(['SUBMITTED', 'PENDING_DOC_FEE']);
            }
        });

        test('ฮ็อปของแต่ละเคสถือลักษณะพื้นที่แบบเดียว ตามลำดับทะเบียน', async () => {
            await submit();
            const perCase = caseIds().map((id) => {
                const hops = writerCalls().filter((c) => c.applicationId === id);
                const words = hops.map(areaTypesOf);
                // ทั้งสองฮ็อปของเคสเดียวกันต้องพูดตรงกัน — ฮ็อป 2 สร้าง formData ใหม่จากสำเนา
                // ก่อนยื่น ของที่เขียนแค่ฮ็อป 1 จะถูกลบทิ้งในคำสั่งถัดไปของทรานแซกชันเดียวกัน
                expect(words[0]).toEqual(words[1]);
                return words[0];
            });
            expect(perCase).toEqual([['OUTDOOR'], ['GREENHOUSE'], ['INDOOR']]);
        });

        test('ออกใบเสนอราคาครบทุกเคส — สายเงินแยกใบตามมติ operator', async () => {
            await submit();
            expect(issueQuotationOnSubmit).toHaveBeenCalledTimes(3);
            const billed = issueQuotationOnSubmit.mock.calls.map(([a]) => a.application.id);
            expect([...new Set(billed)]).toHaveLength(3);
            expect(new Set(billed)).toEqual(new Set(caseIds()));
        });

        test('ที่ดินผืนเดียว ไม่ใช่สามผืน — ทุกเคสชี้ฟาร์มใบเดียวกัน', async () => {
            await submit();
            expect(TX.farm.create).toHaveBeenCalledTimes(1);
            for (const call of writerCalls()) {
                expect(call.additionalData.formData.farmId).toBe('farm-new-1');
            }
        });

        test('ทั้งสามเคสผูกอยู่ใน bundle ใบเดียว', async () => {
            await submit();
            expect(TX.applicationBundle.create).toHaveBeenCalledTimes(1);
            const bundles = new Set([
                ...TX.application.update.mock.calls.map(([a]) => a.data.bundleId),
                ...TX.application.create.mock.calls.map(([a]) => a.data.bundleId),
            ]);
            expect(bundles).toEqual(new Set(['bundle-1']));
        });

        test('คำตอบของประตูบอกครบทั้งสามเลข ไม่ใช่เลขเดียว', async () => {
            const res = await submit();
            expect(res.body.data.id).toBe('app-1'); // ร่างเดิมยังเป็นคำตอบหลัก
            expect(Array.isArray(res.body.cases)).toBe(true);
            expect(res.body.cases.map((c) => c.id)).toEqual(caseIds());
            expect(res.body.bundleId).toBe('bundle-1');
        });

        test('แจ้งผู้ยื่นครบทุกเคส — สามคำขอคือสามภาระที่ต้องจ่าย', async () => {
            await submit();
            expect(createNotification).toHaveBeenCalledTimes(3);
            const notified = createNotification.mock.calls.map(([a]) => a.data.applicationId);
            expect(new Set(notified)).toEqual(new Set(caseIds()));
        });
    });

    describe('ติ๊กรูปแบบเดียว — ผู้ยื่นเดิมต้องไม่รู้สึกว่าอะไรเปลี่ยน', () => {
        beforeEach(() => { seedDraft(['GREENHOUSE']); });

        test('หนึ่งเคส สองฮ็อป ใบเสนอราคาใบเดียว และไม่มี bundle', async () => {
            const res = await submit();
            expect(res.status).toBe(200);
            expect(caseIds()).toEqual(['app-1']);
            expect(writerCalls()).toHaveLength(2);
            expect(issueQuotationOnSubmit).toHaveBeenCalledTimes(1);
            expect(TX.applicationBundle.create).not.toHaveBeenCalled();
            expect(TX.application.create).not.toHaveBeenCalled();
            expect(res.body.bundleId).toBeNull();
        });

        test('คำขอถือรูปแบบที่ติ๊กจริง ไม่ใช่ค่าปริยายที่ระบบเดาให้', async () => {
            await submit();
            for (const call of writerCalls()) {
                expect(areaTypesOf(call)).toEqual(['GREENHOUSE']);
            }
        });
    });

    describe('ยื่นซ้ำบนร่างที่แตกไปแล้ว', () => {
        test('ไม่แตกรอบสอง — ร่างที่มี bundle อยู่แล้วเดินของตัวเองใบเดียว', async () => {
            const row = draftRow(filingWithTicks(['OUTDOOR', 'INDOOR']));
            row.bundleId = 'bundle-existing';
            applicationService.findDraftForSubmit.mockResolvedValue(row);
            TX.application.update.mockImplementation(async ({ where, data }) => ({ ...row, ...where, ...data }));

            const res = await submit();
            expect(res.status).toBe(200);
            expect(TX.applicationBundle.create).not.toHaveBeenCalled();
            expect(TX.application.create).not.toHaveBeenCalled();
            expect(caseIds()).toEqual(['app-1']);
        });
    });
});
