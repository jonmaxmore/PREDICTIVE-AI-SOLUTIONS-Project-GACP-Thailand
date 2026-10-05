/**
 * F-APPV2-02 on the wire — the resolver being right proves nothing about the door.
 *
 * The unit suite next door (law-dimensions-are-checked-before-written) proves the CHECK.
 * This one proves the draft door actually runs it, that the result lands in the stored
 * formData, and — the part that matters most — that it lands there in a position the
 * applicant's own payload cannot shadow. `requestType` and `certScope` are not on the
 * wizard allowlist and never will be; if the door merged them in the wrong order, the
 * allowlist would be intact and the protection would still be gone.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const passHealthUser = (req, _res, next) => {
        req.user = { id: 'user-1', healthId: 'health-1', canonicalRole: 'health', role: 'HEALTH_USER' };
        next();
    };
    return { authenticateHealth: passHealthUser, authenticateAny: passHealthUser };
});

const mockCertFindFirst = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: { findFirst: (...a) => mockCertFindFirst(...a) },
        // holder-access (spec 2026-09-30 §3.1): the caller may edit ent-1's filings.
        entityMembership: {
            findMany: jest.fn(async () => [{ entityId: 'ent-1', role: 'OWNER' }]),
            // The renewal claim's SUBMIT_APPLICATION check on the holder (operator ruling 2026-10-03).
            findUnique: jest.fn(async () => ({ id: 'm-1', role: 'OWNER', permissions: [], status: 'ACTIVE' })),
        },
        entityMemberPermissionGrant: { findMany: jest.fn(async () => []) },
    },
}));

const mockUpdate = jest.fn(async (_id, patch) => ({
    id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT', ...patch,
}));
jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: jest.fn(async () => ({ healthId: 'health-1', userId: 'user-1', entityId: 'ent-1' })),
    findApplicationByIdForHealth: jest.fn(async () => ({
        id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT', healthId: 'health-1', entityId: 'ent-1',
        submitterId: 'user-1', serviceType: 'new_application', areaType: 'OUTDOOR', formData: {}, workflowHistory: [],
    })),
    findLatestOpenDraftForHealth: jest.fn(async () => null),
    findPersonalEntityForHealthIdentity: jest.fn(async () => null),
    healDraftEntityColumns: jest.fn(),
    createDraftForHealth: jest.fn(),
    updateApplicantDraftColumns: (...a) => mockUpdate(...a),
    findDraftForSubmit: jest.fn(),
    getApplicationSlice: jest.fn(),
    findUserOrganizationId: jest.fn(async () => null),
    getApplicantReadinessSnapshot: jest.fn(),
    getLatestOpenDraftForApplicant: jest.fn(),
    deleteDraft: jest.fn(),
}));

jest.mock('../../services/storage-service', () => ({
    createUploader: jest.fn(() => ({ single: jest.fn(() => (_req, _res, next) => next()) })),
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});
jest.mock('../../services/notification-service', () => ({
    createNotification: jest.fn().mockResolvedValue(null),
    createBulkNotifications: jest.fn().mockResolvedValue({ count: 0 }),
}));
jest.mock('../../shared/workflow-event-builder', () => ({
    buildWorkflowEvent: jest.fn((event) => ({ ...event, id: 'workflow-event-1' })),
}));
jest.mock('../../routes/api/helpers/applications-helpers', () => ({
    getHealthScopeOptions: jest.fn((user) => ({ healthId: user.healthId, strictHealthScope: true })),
}));
jest.mock('../../routes/api/preview/preview-utils', () => ({
    normalizeDocuments: jest.fn(() => []),
    summarizeCompletion: jest.fn(() => ({ isComplete: true, missingFields: [] })),
}));
// The draft door is what this suite is about; the sibling routers are mounted on the same
// router and need no part in it.
jest.mock('../../routes/api/applications/application-listing-handlers', () => require('express').Router());
jest.mock('../../routes/api/applications/application-workflow-handlers', () => require('express').Router());

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/applications', require('../../routes/api/applications/applications'));
    return a;
}

const LIVE_CERT = {
    id: 'cert-1',
    certificateNumber: 'GACP-TH-2569-ABC123',
    userId: 'user-1',
    status: 'active',
    expiryDate: new Date(Date.now() + 90 * 86400000),
    // Held by the draft's own entity (a renewal is filed under the certificate's holder).
    application: { entityId: 'ent-1' },
};

/** The formData the door actually handed the writer. */
function written() {
    return mockUpdate.mock.calls.at(-1)[1].formData;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockCertFindFirst.mockResolvedValue(null);
});

describe('POST /api/applications/draft — the law dimensions', () => {
    test('a PROCESSING filing is recorded as PROCESSING, not silently as PLANTING', async () => {
        const res = await request(app())
            .post('/api/applications/draft')
            .send({ applicationId: 'app-1', step: 1, formData: { certScope: 'PROCESSING' } })
            .expect(200);

        expect(written().certScope).toBe('PROCESSING');
        expect(res.body.data.certScope).toBe('PROCESSING');
    });

    test('a RENEWAL naming the caller\'s own live certificate is granted', async () => {
        mockCertFindFirst.mockResolvedValue(LIVE_CERT);
        const res = await request(app())
            .post('/api/applications/draft')
            .send({
                applicationId: 'app-1',
                step: 1,
                formData: { requestType: 'RENEWAL', previousCertificateNumber: 'GACP-TH-2569-ABC123' },
            })
            .expect(200);

        expect(written().requestType).toBe('RENEWAL');
        expect(written().renewalOf).toBe('cert-1');
        expect(res.body.data.lawNotice).toBeNull();
    });

    test("a RENEWAL naming someone else's certificate is recorded as NEW, and the draft still saves", async () => {
        mockCertFindFirst.mockResolvedValue({ ...LIVE_CERT, userId: 'user-someone-else' });
        const res = await request(app())
            .post('/api/applications/draft')
            .send({
                applicationId: 'app-1',
                step: 1,
                formData: { requestType: 'RENEWAL', previousCertificateNumber: 'GACP-TH-2569-ABC123' },
            })
            .expect(200);            // 200, NOT 422 — losing the draft is not the answer

        expect(written().requestType).toBe('NEW');
        expect(written().renewalOf).toBeNull();
        expect(res.body.data.lawNotice.code).toBe('PREVIOUS_CERTIFICATE_NOT_YOURS');
    });

    test('the applicant cannot smuggle a linkage past the checker', async () => {
        // The whole point: renewalOf and replacementOf are server-owned, so even a payload
        // that names them directly must not reach the stored filing.
        await request(app())
            .post('/api/applications/draft')
            .send({
                applicationId: 'app-1',
                step: 1,
                formData: {
                    requestType: 'REPLACEMENT',
                    replacementOf: 'cert-i-do-not-own',
                    renewalOf: 'cert-i-do-not-own',
                },
            })
            .expect(200);

        expect(written().requestType).toBe('NEW');
        expect(written().replacementOf).toBeNull();
        expect(written().renewalOf).toBeNull();
    });

    test('a filing that says nothing about the law keeps what it had', async () => {
        const svc = require('../../services/application-service');
        svc.findApplicationByIdForHealth.mockResolvedValueOnce({
            id: 'app-1', applicationNumber: 'APP-1', status: 'DRAFT', healthId: 'health-1', entityId: 'ent-1',
            submitterId: 'user-1', serviceType: 'new_application', areaType: 'OUTDOOR', workflowHistory: [],
            formData: { requestType: 'RENEWAL', renewalOf: 'cert-1', certScope: 'PROCESSING' },
        });

        await request(app())
            .post('/api/applications/draft')
            .send({ applicationId: 'app-1', step: 3, formData: { farmName: 'สวนทดสอบ' } })
            .expect(200);

        expect(written().requestType).toBe('RENEWAL');
        expect(written().renewalOf).toBe('cert-1');
        expect(written().certScope).toBe('PROCESSING');
    });
});
