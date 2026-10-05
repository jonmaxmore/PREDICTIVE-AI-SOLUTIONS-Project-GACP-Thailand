'use strict';

/**
 * F-QA-06 — a filing submitted through the six-step wizard must end up owning a FARM.
 *
 * Deep QA walked application 0103079d on staging through every gate the platform has:
 * papers, both payments, audit scheduling, six GPS-tagged onsite photographs and the
 * full 24-item checklist. The auditor pressed PASS and got
 *
 *     422 CERTIFICATE_FARM_LOCATION_MISSING — "ขาด ที่อยู่"
 *
 * The filing HELD the address the farmer typed at step 3
 * (farmData.siteAddress / province / district / subDistrict), but no Farm row existed
 * and nothing pointed at one. A certificate names the place it certifies by reading the
 * FARM, not formData — so the last gate on the production line refused a filing that had
 * satisfied every gate before it.
 *
 * The v1 wizard door has always minted the farm inside its submit transaction
 * (application-submission-methods.executeWizardSubmission). The v2 door
 * (routes/api/applications/applications.js POST /submit) never did.
 *
 * WHAT THIS SUITE PINS
 *   1. the site the farmer typed becomes a Farm row, mapped column by column
 *   2. it is written inside the SAME transaction as the two status hops
 *   3. the filing then POINTS at that farm (formData.farmId — the first thing
 *      certificate-service.resolveFarmForCertificate reads)
 *   4. it is idempotent: a filing that already has a farm gets no second one
 *   5. a LEGACY-shaped filing is left alone — the certificate path already reads its
 *      vocabulary (farmData.address/province/district/subdistrict) and mints the farm at
 *      issuance. This is a boundary, not a migration.
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

// A real Prisma interactive-tx client exposes the model namespaces but NOT
// `$transaction` — the same discriminator the status writer itself uses.
const TX = {
    __tx: 'submit-tx',
    farm: { create: jest.fn() },
    // ตั้งแต่ 2026-09-11 ประตูยื่นแตกคำขอเป็นหนึ่งเคสต่อลักษณะพื้นที่ที่ติ๊ก และ
    // fixture ของชุดนี้ติ๊กมาสามแบบ ⇒ ทรานแซกชันเดียวกันนี้เขียนคำขอและ bundle ด้วย
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

// The document law reads models this suite's prisma mock does not carry, and a refusal
// there would end the request before a transaction opened. The law itself is proven in
// the m2a suites.
jest.mock('../../services/application-document-requirements', () => {
    const actual = jest.requireActual('../../services/application-document-requirements');
    return {
        ...actual,
        assertRequiredDocumentsPresent: jest.fn(async () => ({ appliedRules: [] })),
    };
});

jest.mock('../../middleware/audit-logger', () => {
    const actual = jest.requireActual('../../middleware/audit-logger');
    return {
        ...actual,
        auditLogger: {
            log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
            logWithin: jest.fn(() => jest.fn()),
        },
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
const submitRouter = require('../../routes/api/applications/applications');

/**
 * The OLD wizard's vocabulary, complete enough to pass the legacy submit gate:
 * farmName / address / subdistrict, plot rows, production and harvest answers.
 * certificate-service.resolveFarmForCertificate reads exactly these keys.
 */
const LEGACY_FILING = {
    plantId: 'cannabis',
    serviceType: 'new_application',
    certificationPurposes: ['EXPORT'],
    cultivationMethods: ['OUTDOOR'],
    applicantData: {
        applicantType: 'INDIVIDUAL',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        idCard: '1100000000008',
        phone: '0812345678',
        address: '123 หมู่ 4',
    },
    farmData: {
        farmName: 'ฟาร์มเก่า',
        address: '1 หมู่ 1',
        province: 'นนทบุรี',
        district: 'ปากเกร็ด',
        subdistrict: 'บางตลาด',
        postalCode: '11120',
        totalAreaSize: '5',
        totalAreaUnit: 'Rai',
    },
    plots: [{ id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Rai', solarSystem: 'OUTDOOR' }],
    productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
    harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN', storageSystem: 'AMBIENT' },
    documents: [{ type: 'ID_CARD', name: 'บัตรประชาชน', uploaded: true, url: '/uploads/id.pdf' }],
};

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
        formData,
        workflowHistory: [],
    };
}

/** every writeApplicationStatus call, in order */
function writerCalls() {
    return mockWriteApplicationStatus.mock.calls.map(([arg]) => arg);
}

function farmCreateData() {
    expect(TX.farm.create).toHaveBeenCalledTimes(1);
    return TX.farm.create.mock.calls[0][0].data;
}

describe('POST /applications/submit — the six-step filing becomes a farm', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(TX));
        mockWriteApplicationStatus.mockResolvedValue({ id: 'app-1' });
        TX.farm.create.mockResolvedValue({ id: 'farm-new-1', organizationId: 'org-1' });
        TX.application.count.mockResolvedValue(7);
        TX.applicationBundle.create.mockImplementation(async ({ data }) => ({ id: 'bundle-1', ...data }));
        TX.application.update.mockImplementation(async ({ where, data }) => ({
            ...draftRow(JSON.parse(JSON.stringify(V2_FILING))), ...where, ...data,
        }));
        let sibling = 0;
        TX.application.create.mockImplementation(async ({ data }) => {
            sibling += 1;
            return { id: `app-sib-${sibling}`, workflowHistory: [], ...data };
        });
        applicationService.resolveHealthIdentity.mockResolvedValue({
            userId: 'user-1', healthId: '1100000000008',
        });
        applicationService.getApplicationSlice.mockResolvedValue({
            id: 'app-1', applicationNumber: 'APP-2026-100', status: 'PENDING_DOC_FEE', organizationId: 'org-1',
        });
        app = mountSubmit();
    });

    const submit = () => request(app)
        .post('/api/applications/submit')
        .send({ applicationId: 'app-1', declarationsAccepted: true });

    describe('the real browser-walked filing (fixtures/v2-wizard-real-filing.json)', () => {
        beforeEach(() => {
            applicationService.findDraftForSubmit.mockResolvedValue(
                draftRow(JSON.parse(JSON.stringify(V2_FILING))),
            );
        });

        test('mints ONE farm, inside the submit transaction', async () => {
            const res = await submit();
            expect(res.status).toBe(200);
            expect(TX.farm.create).toHaveBeenCalledTimes(1);
        });

        test('maps the wizard\'s ส่วนที่ ๒ answers onto the Farm columns', async () => {
            await submit();
            const data = farmCreateData();
            expect(data.farmName).toBe(V2_FILING.farmData.siteName);
            expect(data.address).toBe(V2_FILING.farmData.siteAddress);
            expect(data.province).toBe(V2_FILING.farmData.province);
            expect(data.district).toBe(V2_FILING.farmData.district);
            expect(data.subDistrict).toBe(V2_FILING.farmData.subDistrict);
            expect(data.postalCode).toBe(V2_FILING.farmData.postalCode);
        });

        test('the three fields the certificate refuses without are all present', async () => {
            await submit();
            const data = farmCreateData();
            // CERTIFICATE_LOCATION_FIELDS (certificate-service.js:177) — the refusal
            // "ขาด ที่อยู่" that closed the production line.
            for (const field of ['province', 'district', 'subDistrict']) {
                expect(String(data[field] || '').trim()).not.toBe('');
            }
        });

        test('carries the area in square metres and the workspace it belongs to', async () => {
            await submit();
            const data = farmCreateData();
            expect(data.totalArea).toBe(1200);
            expect(data.cultivationArea).toBe(1200);
            expect(data.areaUnit).toBe('sqm');
            expect(data.ownerId).toBe('user-1');
            expect(data.entityId).toBe('ent-1');
            expect(data.organizationId).toBe('org-1');
        });

        test('records the most controlled ลักษณะพื้นที่ the filing declared', async () => {
            await submit();
            // OUTDOOR + GREENHOUSE + INDOOR were ticked; the platform records the
            // most controlled, never a guessed OUTDOOR (shared/cultivation-method.js).
            expect(farmCreateData().cultivationMethod).toBe('INDOOR');
        });

        test('EVERY status hop carries the farmId, so the certificate can find it', async () => {
            await submit();
            const hops = writerCalls();
            // สองฮ็อปต่อเคส และ fixture นี้ติ๊กสามลักษณะพื้นที่ ⇒ หกฮ็อป (แก้ 2026-09-11
            // ตอนประตูเริ่มแตกเคส) · ที่ชุดนี้พิสูจน์ไม่เปลี่ยน: **ทุก** ฮ็อปถือ farmId
            // เพราะที่ดินคือผืนเดียว สามเคสจึงต้องชี้ฟาร์มใบเดียวกันทั้งหมด
            expect(hops).toHaveLength(6);
            expect(new Set(hops.map((h) => h.applicationId)).size).toBe(3);
            for (const hop of hops) {
                expect(hop.additionalData.formData.farmId).toBe('farm-new-1');
            }
        });

        test('the farm is written on the SAME transaction handle as the hops', async () => {
            await submit();
            expect(mockTransaction).toHaveBeenCalledTimes(1);
            for (const hop of writerCalls()) {
                expect(hop.prisma).toBe(TX);
            }
        });
    });

    test('a filing that already names a farm gets no second one', async () => {
        const already = JSON.parse(JSON.stringify(V2_FILING));
        already.farmId = 'farm-existing-9';
        applicationService.findDraftForSubmit.mockResolvedValue(draftRow(already));

        const res = await submit();
        expect(res.status).toBe(200);
        expect(TX.farm.create).not.toHaveBeenCalled();
        for (const hop of writerCalls()) {
            expect(hop.additionalData.formData.farmId).toBe('farm-existing-9');
        }
    });

    test('a LEGACY-shaped filing is left to the path that already works for it', async () => {
        // No siteName / siteAddress / areaSqm — this is the old wizard's vocabulary, and
        // certificate-service.resolveFarmForCertificate reads it directly. Minting here
        // would change the meaning of filings already in flight.
        applicationService.findDraftForSubmit.mockResolvedValue(draftRow(LEGACY_FILING));

        const res = await submit();
        expect(res.status).toBe(200);
        expect(TX.farm.create).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// The map itself — one reader for both eras' spellings.
// ─────────────────────────────────────────────────────────────────────────────
const {
    readFilingSite,
    materializeFarmForFiling,
} = require('../../services/application-service/application-farm-materialization');

describe('readFilingSite — ONE map, both vocabularies', () => {
    test('reads the six-step wizard\'s กทล.๑ spellings', () => {
        const site = readFilingSite(V2_FILING);
        expect(site.farmName).toBe(V2_FILING.farmData.siteName);
        expect(site.address).toBe(V2_FILING.farmData.siteAddress);
        expect(site.subDistrict).toBe(V2_FILING.farmData.subDistrict);
        expect(site.areaAmount).toBe('1200');
        expect(site.areaUnit).toBe('sqm');
    });

    test('reads the previous wizard\'s spellings too — including `subdistrict`', () => {
        const site = readFilingSite(LEGACY_FILING);
        expect(site.farmName).toBe('ฟาร์มเก่า');
        expect(site.address).toBe('1 หมู่ 1');
        expect(site.subDistrict).toBe('บางตลาด');
        expect(site.areaAmount).toBe('5');
        expect(site.areaUnit).toBe('Rai');
    });

    test('parses the wizard\'s single free-text พิกัด box', () => {
        const site = readFilingSite({ farmData: { coordinates: '18.7961, 98.9797' } });
        expect(site.latitude).toBeCloseTo(18.7961, 4);
        expect(site.longitude).toBeCloseTo(98.9797, 4);
    });

    test('half a coordinate is no coordinate — both null, never paired with 0', () => {
        expect(readFilingSite({ farmData: { coordinates: '18.7961' } }))
            .toMatchObject({ latitude: null, longitude: null });
        expect(readFilingSite({ farmData: { gpsLat: '18.7961' } }))
            .toMatchObject({ latitude: null, longitude: null });
    });

    test('records the most controlled ลักษณะพื้นที่, and never guesses OUTDOOR', () => {
        expect(readFilingSite({ farmData: { areaTypes: ['OUTDOOR', 'GREENHOUSE'] } }).cultivationMethod)
            .toBe('GREENHOUSE');
        // อื่น ๆ is what the farmer said; it is carried, not rewritten into a method
        // they did not tick.
        expect(readFilingSite({ farmData: { areaTypes: ['OTHER'] } }).cultivationMethod).toBe('OTHER');
        expect(readFilingSite({ farmData: {} }).cultivationMethod).toBeNull();
    });
});

describe('materializeFarmForFiling — nothing is invented', () => {
    const client = { farm: { create: jest.fn(async () => ({ id: 'farm-z' })) } };

    beforeEach(() => { client.farm.create.mockClear(); });

    test('a filing that does not state where it is gets NO farm and NO stand-ins', async () => {
        const result = await materializeFarmForFiling({
            client,
            formData: { farmData: { siteName: 'สวน', siteAddress: '12 หมู่ 3' } },
            ownerId: 'user-1',
            entityId: 'ent-1',
            organizationId: 'org-1',
        });
        expect(client.farm.create).not.toHaveBeenCalled();
        expect(result.farmId).toBeNull();
        expect(result.reason).toContain('NOT_STATED');
        expect(result.reason).toContain('province');
    });

    test('a postal code the form never required is stored blank, not as 00000', async () => {
        const filing = JSON.parse(JSON.stringify(V2_FILING));
        delete filing.farmData.postalCode;
        await materializeFarmForFiling({
            client, formData: filing, ownerId: 'user-1', entityId: 'ent-1', organizationId: 'org-1',
        });
        expect(client.farm.create.mock.calls[0][0].data.postalCode).toBe('');
    });

    test('an already-linked filing is answered from the pointer it carries', async () => {
        const result = await materializeFarmForFiling({
            client, formData: { farmId: 'farm-old', farmData: V2_FILING.farmData }, ownerId: 'user-1',
        });
        expect(client.farm.create).not.toHaveBeenCalled();
        expect(result).toEqual({ farmId: 'farm-old', created: false, reason: 'ALREADY_LINKED' });
    });
});
