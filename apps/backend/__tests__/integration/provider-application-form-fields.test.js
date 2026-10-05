/**
 * PATCH /api/provider/applications/:id/form-fields integration tests.
 *
 * Covers the reviewer in-place scalar/enum edit feature (V1):
 *   - happy path: the ASSIGNED reviewer edits a scalar field → persisted +
 *     audit row written + leaf-level diff returned
 *   - 403: a provider who is NOT the assigned reviewer (and not ADMIN)
 *   - ADMIN bypass: a non-assigned ADMIN may edit
 *   - 422 INVALID_STATE: editing while the app is in a non-reviewer state
 *   - array-strip: arrays/tables (seedSources, productionInputs, …) in the
 *     payload are ignored; the deep-merge preserves the existing arrays
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => next(),
    requireRole: () => (req, _res, next) => next(),
}));

// Avoid prisma-database process.exit on missing DATABASE_URL (the project rules gotcha).
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

// Tenant context — just invoke the fn so the write runs.
jest.mock('../../services/tenant-context', () => ({
    runWithTenantContext: jest.fn((_ctx, fn) => fn()),
}));

// Audit logger — capture calls.
const auditCalls = [];
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(async (event) => { auditCalls.push(event); return { id: 'audit-1' }; }) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

// resolveUserIdFromHealthId is reached via ./shared (user-lookup-service);
// stub the underlying service so it doesn't touch prisma.
jest.mock('../../services/user-lookup-service', () => ({
    resolveUserIdFromHealthIdSecurely: jest.fn(async () => 'health-user-1'),
}));

// Application-service: in-memory store.
const dbState = {
    application: null,
    updateCalls: [],
};
jest.mock('../../services/application-service', () => ({
    findFirstWithWhere: jest.fn(async () => dbState.application),
    updateApplicationColumns: jest.fn(async (id, data) => {
        dbState.updateCalls.push({ id, data });
        dbState.application = { ...dbState.application, ...data };
        return {
            id,
            applicationNumber: dbState.application.applicationNumber,
            status: dbState.application.status,
            formData: data.formData,
            updatedAt: new Date().toISOString(),
        };
    }),
}));

const applicationService = require('../../services/application-service');
const router = require('../../routes/api/provider/applications');

const REVIEWER_ID = 'reviewer-1';

function buildApp(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use('/applications', router);
    return app;
}

function seedApplication(overrides = {}) {
    dbState.application = {
        id: 'app-1',
        applicationNumber: 'GACP-0001',
        status: 'ASSIGNED_FOR_REVIEW',
        reviewerId: REVIEWER_ID,
        healthId: '1234567890123',
        organizationId: 'org-1',
        formData: {
            applicantData: { phone: '0810000000', email: 'old@example.com' },
            farmData: { farmName: 'ฟาร์มเก่า', soilType: 'LOAM' },
            productionData: {
                treeCount: 100,
                seedSources: [{ varietyName: 'พันธุ์ A' }],
                productionInputs: [{ name: 'ปุ๋ย X' }],
                plantParts: ['flower', 'leaf'],
            },
            harvestData: { dryingMethod: 'HANGING' },
        },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    auditCalls.length = 0;
    dbState.updateCalls.length = 0;
    seedApplication();
});

const reviewerUser = { id: REVIEWER_ID, role: 'document_reviewer', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
const otherReviewerUser = { id: 'reviewer-2', role: 'document_reviewer', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
const adminUser = { id: 'admin-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam', organizationId: 'org-1' };

describe('PATCH /:id/form-fields — happy path', () => {
    test('assigned reviewer edits scalar/enum fields → persisted + audited + diff returned', async () => {
        const res = await request(buildApp(reviewerUser))
            .patch('/applications/app-1/form-fields')
            .send({
                changes: {
                    applicantData: { phone: '0899999999' },
                    farmData: { soilType: 'CLAY' },
                },
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.meta.changedFields).toBe(2);

        // Persisted deep-merge: changed fields updated, untouched fields kept.
        expect(applicationService.updateApplicationColumns).toHaveBeenCalledTimes(1);
        const writtenFormData = dbState.updateCalls[0].data.formData;
        expect(writtenFormData.applicantData.phone).toBe('0899999999');
        expect(writtenFormData.applicantData.email).toBe('old@example.com'); // preserved
        expect(writtenFormData.farmData.soilType).toBe('CLAY');
        expect(writtenFormData.farmData.farmName).toBe('ฟาร์มเก่า'); // preserved

        // Audit row with leaf-level diff.
        expect(auditCalls).toHaveLength(1);
        expect(auditCalls[0].action).toBe('APPLICATION_FORMDATA_EDITED_BY_REVIEWER');
        const paths = auditCalls[0].metadata.changedFields.map((c) => c.path).sort();
        expect(paths).toEqual(['applicantData.phone', 'farmData.soilType']);
        const phoneDiff = auditCalls[0].metadata.changedFields.find((c) => c.path === 'applicantData.phone');
        expect(phoneDiff.old).toBe('0810000000');
        expect(phoneDiff.new).toBe('0899999999');
    });

    test('ADMIN (not assigned) may edit', async () => {
        const res = await request(buildApp(adminUser))
            .patch('/applications/app-1/form-fields')
            .send({ changes: { farmData: { soilType: 'SANDY' } } });
        expect(res.status).toBe(200);
        expect(dbState.updateCalls).toHaveLength(1);
    });

    test('nested one-level scalar (waterSourceDetail.sourceType) is merged', async () => {
        const res = await request(buildApp(reviewerUser))
            .patch('/applications/app-1/form-fields')
            .send({ changes: { farmData: { waterSourceDetail: { sourceType: 'POND' } } } });
        expect(res.status).toBe(200);
        const fd = dbState.updateCalls[0].data.formData;
        expect(fd.farmData.waterSourceDetail.sourceType).toBe('POND');
        expect(res.body.meta.changedFields).toBe(1);
    });
});

describe('PATCH /:id/form-fields — RBAC 403', () => {
    test('non-assigned non-admin reviewer is forbidden', async () => {
        const res = await request(buildApp(otherReviewerUser))
            .patch('/applications/app-1/form-fields')
            .send({ changes: { farmData: { soilType: 'CLAY' } } });
        expect(res.status).toBe(403);
        expect(applicationService.updateApplicationColumns).not.toHaveBeenCalled();
        expect(auditCalls).toHaveLength(0);
    });
});

describe('PATCH /:id/form-fields — state gate 422', () => {
    test('editing in a non-reviewer state → 422 INVALID_STATE', async () => {
        seedApplication({ status: 'DOC_APPROVED' });
        const res = await request(buildApp(reviewerUser))
            .patch('/applications/app-1/form-fields')
            .send({ changes: { farmData: { soilType: 'CLAY' } } });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('INVALID_STATE');
        expect(applicationService.updateApplicationColumns).not.toHaveBeenCalled();
    });

    test('REVISION_REQUESTED is editable', async () => {
        seedApplication({ status: 'REVISION_REQUESTED' });
        const res = await request(buildApp(reviewerUser))
            .patch('/applications/app-1/form-fields')
            .send({ changes: { farmData: { soilType: 'CLAY' } } });
        expect(res.status).toBe(200);
    });
});

describe('PATCH /:id/form-fields — array strip (V1)', () => {
    test('arrays in the payload are ignored; existing arrays preserved', async () => {
        const res = await request(buildApp(reviewerUser))
            .patch('/applications/app-1/form-fields')
            .send({
                changes: {
                    productionData: {
                        treeCount: 250, // scalar — applied
                        seedSources: [{ varietyName: 'พันธุ์ B (ห้ามแก้)' }], // array — stripped
                        productionInputs: [], // array — stripped
                        plantParts: ['root'], // array — stripped
                    },
                },
            });

        expect(res.status).toBe(200);
        expect(res.body.meta.changedFields).toBe(1); // only treeCount changed
        expect(res.body.meta.droppedPaths.sort()).toEqual([
            'productionData.plantParts',
            'productionData.productionInputs',
            'productionData.seedSources',
        ]);

        const fd = dbState.updateCalls[0].data.formData;
        expect(fd.productionData.treeCount).toBe(250);
        // Arrays unchanged from seed.
        expect(fd.productionData.seedSources).toEqual([{ varietyName: 'พันธุ์ A' }]);
        expect(fd.productionData.productionInputs).toEqual([{ name: 'ปุ๋ย X' }]);
        expect(fd.productionData.plantParts).toEqual(['flower', 'leaf']);
    });

    test('payload with ONLY arrays → 400 (nothing editable)', async () => {
        const res = await request(buildApp(reviewerUser))
            .patch('/applications/app-1/form-fields')
            .send({ changes: { productionData: { seedSources: [{ x: 1 }] } } });
        expect(res.status).toBe(400);
        expect(applicationService.updateApplicationColumns).not.toHaveBeenCalled();
    });
});
