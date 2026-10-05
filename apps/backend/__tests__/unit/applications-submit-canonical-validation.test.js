/**
 * C2 — /applications/submit canonical validation (REAL validators, NO mock).
 *
 * The original capability-gate test mocks validateAllSteps + summarizeCompletion
 * to always pass, which MASKED C2: the live wizard posts canonical camelCase
 * formData with no `steps.{1..9}`, so the unconditional snake-case
 * validateAllSteps({}) returned isValid:false and 422'd every real submit.
 *
 * This suite deliberately does NOT mock the validators. It drives REAL
 * canonical formData through the route and asserts:
 *   (a) a COMPLETE canonical formData → submit passes validation (no 422).
 *   (b) an INCOMPLETE canonical formData → 422 with correct missing step.
 *   (c) a legacy step-keyed payload → still validated by validateAllSteps.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passUser = (req, _res, next) => {
        req.user = {
            id: 'user-1',
            healthId: '1100000000008',
            organizationId: 'org-1',
            canonicalRole: 'health',
            role: 'HEALTH_USER',
        };
        next();
    };
    return { authenticateHealth: passUser, authenticateAny: passUser };
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

// A0 / PR-A0-2: the initial-submit branch now walks its two hops inside one
// `prisma.$transaction`. The old `{ prisma: {} }` stub had no entry point, so
// case (a) below reached the route's catch and passed on `not.toBe(422)` alone —
// a 500 is also not a 422. Pass-through so the suite exercises the submit path
// it was written for. (Same idiom as applications-submit-capability-gate.test.js:51.)
jest.mock('../../services/prisma-database', () => {
    const prisma = {};
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    return { prisma };
});

// M1 PR-C — /submit now runs the central guard before it validates anything,
// so the permission engine and the audit writer are dependencies of this route.
// Mocked with the REAL engine shape (entity-effective-permissions-service.js:403-426).
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(),
}));
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

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger) };
});

jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));

jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'we-1' })),
}));

jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((u) => ({ healthId: u.healthId, strictHealthScope: true })),
    mapHealthApplication: jest.fn((a) => a),
    getActorIdentity: jest.fn(() => 'user-1'),
}));

jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../routes/api/applications/application-workflow-handlers', () => require('express').Router());
jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
}));
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/fee-service', () => ({}));
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
    ensurePhase1Quotations: jest.fn().mockResolvedValue(undefined),
}));
// IMPORTANT: do NOT mock application-constants, preview-utils, application-schemas,
// or the canonical validator — this suite exercises REAL validation.

const applicationService = require('../../services/application-service');
const { assertEntityActionPermission } = require('../../services/entity-effective-permissions-service');
const router = require('../../routes/api/applications/applications');

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', router);
    return app;
}

// COMPLETE canonical formData (matches the live wizard review-step payload).
function completeCanonicalFormData() {
    return {
        plantId: 'cannabis',
        serviceType: 'NEW',
        certificationPurposes: ['EXPORT'],
        locationType: 'OUTDOOR',
        cultivationMethods: ['outdoor'],
        consentedPDPA: true,
        acknowledgedStandards: true,
        applicantData: {
            applicantType: 'INDIVIDUAL',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            idCard: '1100000000008',
            phone: '0812345678',
            email: 'somchai@example.com',
            address: '123 หมู่ 4',
        },
        farmData: {
            farmName: 'ฟาร์มสมชาย',
            address: '123 หมู่ 4',
            province: 'สมุทรปราการ',
            district: 'บางพลี',
            subdistrict: 'บางพลีใหญ่',
            postalCode: '10540',
            totalAreaSize: '5',
            totalAreaUnit: 'Rai',
            landOwnership: 'OWN',
            gpsLat: '13.12',
            gpsLng: '100.65',
        },
        plots: [{ id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Rai', solarSystem: 'OUTDOOR' }],
        productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
        harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN', storageSystem: 'AMBIENT' },
        documents: [{ type: 'ID_CARD', name: 'บัตรประชาชน', uploaded: true, url: '/uploads/id.pdf' }],
    };
}

function mockDraft(formData, status = 'DRAFT', entityId = 'ent-1') {
    applicationService.resolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: '1100000000008' });
    // M1 PR-C: `entityId` was null here. Every case below now hits the submit
    // guard's 400 before it reaches the validator this suite measures, so the
    // fixture names an entity and the engine allows — except case (d), which
    // exists to pin the new refusal.
    assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
    applicationService.findDraftForSubmit.mockResolvedValue({
        id: 'app-1',
        applicationNumber: 'APP-2026-100',
        status,
        healthId: '1100000000008',
        entityId,
        submitterId: 'user-1',
        formData,
        workflowHistory: [],
    });
    applicationService.getApplicationSlice.mockResolvedValue({
        id: 'app-1', applicationNumber: 'APP-2026-100', status: 'PENDING_DOC_FEE',
    });
}

describe('C2 — canonical /submit with REAL validators (no mock)', () => {
    let app;
    beforeAll(() => { app = makeApp(); });
    beforeEach(() => { jest.clearAllMocks(); });

    it('(a) COMPLETE canonical formData → submit passes validation (not 422)', async () => {
        mockDraft(completeCanonicalFormData());
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).not.toBe(422);
        expect(r.body.error).not.toBe('APPLICATION_INCOMPLETE');
    });

    it('(b) INCOMPLETE canonical formData (no plots) → 422 with step-5 error', async () => {
        const fd = completeCanonicalFormData();
        fd.plots = [];
        mockDraft(fd);
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).toBe(422);
        expect(r.body.error).toBe('APPLICATION_INCOMPLETE');
        expect(r.body.errorsByStep['5']).toBeDefined();
    });

    // F-PLOT-AREAUNIT-DEADEND fix (Task 1) — clone of the (a) fixture minus
    // plots[0].areaUnit. Before the fix, the step5 mapper never read a plot's
    // unit at all, so this "complete-looking" payload sailed through here,
    // got paid, passed audit, then died at cert generation
    // (evidence/phase0/FINDINGS.md:127-131; certificate-service.js:169-190
    // throws via area-utils.js:67-76 on a plot with no unit). This must 422
    // at THIS door instead.
    it('(b3) plot missing areaUnit → 422 with step-5 error (F-PLOT-AREAUNIT-DEADEND fix)', async () => {
        const fd = completeCanonicalFormData();
        delete fd.plots[0].areaUnit;
        mockDraft(fd);
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).toBe(422);
        expect(r.body.error).toBe('APPLICATION_INCOMPLETE');
        expect(r.body.errorsByStep['5']).toBeDefined();
    });

    // farm-areaunit-default fix (Task 2) — clone of the (a) fixture minus
    // farmData.totalAreaUnit. Mirrors (b3) above but for the farm's OWN
    // unit: certificate-service.js:561 (farm CREATE at mint) silently reads
    // this as Sqm when absent — the same ×1,600 ambiguity class as the plot
    // fix. Must 422 at THIS door instead of reaching mint.
    it('(b4) farm missing totalAreaUnit → 422 with step-5 error (farm-areaunit-default fix)', async () => {
        const fd = completeCanonicalFormData();
        delete fd.farmData.totalAreaUnit;
        mockDraft(fd);
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).toBe(422);
        expect(r.body.error).toBe('APPLICATION_INCOMPLETE');
        expect(r.body.errorsByStep['5']).toBeDefined();
    });

    it('(b2) INCOMPLETE canonical formData (no documents) → 422 with step-8 error', async () => {
        const fd = completeCanonicalFormData();
        fd.documents = [];
        mockDraft(fd);
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).toBe(422);
        expect(r.body.error).toBe('APPLICATION_INCOMPLETE');
        expect(r.body.errorsByStep['8']).toBeDefined();
    });

    it('(c) legacy step-keyed payload → still validated by validateAllSteps (complete passes)', async () => {
        // Build a fully-valid legacy step-keyed payload (snake-case schema).
        const legacyFormData = {
            steps: {
                1: {
                    operator_name: 'นายทดสอบ',
                    tax_id: '1100000000008',
                    address_contact: '123 ถนนทดสอบ',
                    phone_no: '0812345678',
                    email: 'legacy@example.com',
                    operator_type: 'INDIVIDUAL',
                },
                2: {
                    herb_type_id: 'cannabis',
                    botanical_name: 'Cannabis sativa',
                    strain_name: 'Thai Stick',
                    material_source: 'self',
                    source_location: 'farm',
                    lot_number: 'LOT-1',
                },
                3: {},
                4: {
                    applicant_type: 'INDIVIDUAL',
                    first_name: 'นาย',
                    last_name: 'ทดสอบ',
                    id_card: '1100000000008',
                    phone: '0812345678',
                    email: 'legacy@example.com',
                },
                5: {
                    plot_name: 'แปลง 1',
                    land_title_no: 'NS3-1',
                    area_rai: 2,
                    area_ngan: 0,
                    area_sq_wa: 0,
                    lat: 13.1,
                    long: 100.6,
                    surrounding_environment: 'rural',
                },
                6: {
                    water_source_type: 'well',
                    irrigation_method: 'drip',
                    soil_preparation_method: 'tilling',
                    soil_analysis_date: '2026-01-01',
                    water_analysis_date: '2026-01-01',
                    fertilizer_type: 'organic',
                    fertilizer_schedule: 'weekly',
                    pest_control_method: 'ipm',
                    weed_control_method: 'manual',
                    input_usage_history: 'none',
                },
                7: {
                    harvest_criteria: 'maturity',
                    harvest_method: 'manual',
                    equipment_sanitation: 'cleaned',
                    harvest_time_of_day: 'morning',
                    cleaning_method: 'rinse',
                    drying_method: 'sun',
                    sorting_criteria: 'size',
                    moisture_content_target: '12%',
                    packaging_material_type: 'foil',
                    storage_condition: 'cool',
                    warehouse_pest_control: 'traps',
                    stock_management_system: 'fifo',
                },
                8: { files: [{ name: 'doc.pdf' }] },
                9: {
                    traceability_code_format: 'QR',
                    internal_audit_date: '2026-01-01',
                    sample_retention_period: '1 year',
                    complaint_handling_procedure: 'documented',
                },
            },
        };
        mockDraft(legacyFormData);
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).not.toBe(422);
    });

    // M1 PR-C (plan D7) — the guard runs BEFORE validation: a complete draft
    // that names no entity is refused for the entity reason, not the form one.
    it('(d) COMPLETE canonical formData but no entityId (nothing to heal) → 400 VALIDATION_ERROR, never 422', async () => {
        mockDraft(completeCanonicalFormData(), 'DRAFT', null);
        applicationService.findPersonalEntityForHealthIdentity.mockResolvedValue(null);
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('VALIDATION_ERROR');
    });

    it('(c2) legacy step-keyed payload that is INCOMPLETE → 422 via validateAllSteps', async () => {
        const legacyFormData = { steps: { 1: { operator_name: 'x' } }, certificationPurposes: ['EXPORT'] };
        mockDraft(legacyFormData);
        const r = await request(app).post('/api/applications/submit').send({});
        expect(r.status).toBe(422);
        expect(r.body.error).toBe('APPLICATION_INCOMPLETE');
        // validateAllSteps produces errorsByStep (legacy snake-case path).
        expect(r.body.errorsByStep).toBeDefined();
    });
});
