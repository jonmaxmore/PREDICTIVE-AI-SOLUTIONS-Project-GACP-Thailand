/**
 * farm-areaunit-default fix — resubmit door (Task 2).
 *
 * Mirrors application-review-revision-plot-areaunit.test.js (F-PLOT-AREAUNIT-
 * DEADEND fix, Task 1) for the farm's OWN totalAreaUnit instead of a plot's.
 * The revision door (PUT /:id/revision → application-review-revision-methods.js)
 * runs the SAME validateSubmissionPayload gate as the front door (both doors
 * share validation/application-submission-validator.js since the plot
 * mission), so a farm missing totalAreaUnit must 422 here too, not just at
 * POST /submit.
 *
 * Like the plot-areaunit suite, this does NOT mock
 * validation/application-submission-validator (or its dependents) — it drives
 * the REAL validator through submitRevision.
 */

const {
    createApplicationReviewRevisionMethods,
} = require('../../services/application-service/application-review-revision-methods');
const {
    writeApplicationStatus,
} = require('../../services/application-status-writer');
const {
    issueQuotationsForApplication,
} = require('../../services/quotation-service');

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(),
}));
jest.mock('../../services/quotation-service', () => ({
    issueQuotationsForApplication: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
    writeApplicationStatus.mockReset();
    issueQuotationsForApplication.mockClear();
});

function buildSubmitMock(application) {
    const captured = { deadlineUpdates: [] };
    writeApplicationStatus.mockImplementation(async (args) => {
        captured.writerArgs = args;
        return { ...application, status: args.toStatus };
    });
    const prisma = {
        application: {
            findFirst: jest.fn(async () => application),
            findUnique: jest.fn(async () => ({ ...application })),
        },
        revisionDeadline: {
            findUnique: jest.fn(async () => null),
            updateMany: jest.fn(async (args) => {
                captured.deadlineUpdates.push(args);
                return { count: 1 };
            }),
        },
        user: { findMany: jest.fn(async () => []) },
        correctionRound: { findFirst: jest.fn(async () => null) },
        correctionSubmissionVersion: {
            create: jest.fn(async (args) => ({ id: 'csv-mock', ...args.data })),
        },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    return { captured, prisma };
}

function methodsFor(prisma) {
    return createApplicationReviewRevisionMethods({
        prisma,
        sendNotification: jest.fn(),
        NotifyType: { NEW_APPLICATION: 'NEW_APPLICATION' },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
}

const actor = { userId: 'u-1', healthId: 'h-1', actorIdentity: 'u-1', actorRole: 'HEALTH' };
// A future due date so the deadline-expiry branch is not taken.
const futureDue = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function canonicalFormDataWithFarm(farmData) {
    return {
        plantId: 'cannabis',
        serviceType: 'NEW',
        certificationPurposes: ['EXPORT'],
        locationType: 'OUTDOOR',
        cultivationMethods: ['outdoor'],
        applicantData: {
            applicantType: 'INDIVIDUAL',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            idCard: '1100000000008',
            phone: '0812345678',
            address: '123 หมู่ 4',
        },
        farmData,
        plots: [{ id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Sqm', solarSystem: 'OUTDOOR' }],
        productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
        harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN', storageSystem: 'AMBIENT' },
        documents: [{ type: 'ID_CARD', name: 'บัตรประชาชน', uploaded: true, url: '/uploads/id.pdf' }],
        revisionDueAt: futureDue,
        workflowState: 'REVISION_REQUESTED',
    };
}

describe('submitRevision — farm totalAreaUnit validated on the REVISION_REQUESTED resubmit door (farm-areaunit-default fix, Task 2)', () => {
    it('resubmit whose farm has NO totalAreaUnit → 422 errorsByStep[5], no transition written, no quotation', async () => {
        const app = {
            id: 'app-1',
            applicationNumber: 'GACP-2026-0001',
            status: 'REVISION_REQUESTED',
            healthId: 'h-1',
            formData: canonicalFormDataWithFarm({
                farmName: 'ฟาร์มสมชาย',
                address: '123 หมู่ 4',
                province: 'สมุทรปราการ',
                totalAreaSize: '5',
                // totalAreaUnit intentionally absent — the fixed-2026 legacy shape.
            }),
            workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        const result = await methods.submitRevision('app-1', { formData: {}, notes: 'fixed' }, actor);

        expect(result.status).toBe(422);
        expect(result.body).toMatchObject({ success: false, error: 'APPLICATION_INCOMPLETE' });
        expect(result.body.errorsByStep['5']).toBeDefined();
        expect(writeApplicationStatus).not.toHaveBeenCalled();
        expect(issueQuotationsForApplication).not.toHaveBeenCalled();
    });

    it('resubmit whose farm HAS a valid (UI-cased) totalAreaUnit still succeeds — byte-identical success path', async () => {
        const app = {
            id: 'app-1',
            applicationNumber: 'GACP-2026-0001',
            status: 'REVISION_REQUESTED',
            healthId: 'h-1',
            formData: canonicalFormDataWithFarm({
                farmName: 'ฟาร์มสมชาย',
                address: '123 หมู่ 4',
                province: 'สมุทรปราการ',
                totalAreaSize: '5',
                totalAreaUnit: 'Sqm',
            }),
            workflowHistory: [],
        };
        const mock = buildSubmitMock(app);
        const methods = methodsFor(mock.prisma);

        const result = await methods.submitRevision('app-1', { formData: {}, notes: 'fixed' }, actor);

        expect(result.status).toBe(200);
        expect(result.body.message).toBe('Revision submitted successfully. Your application will be reviewed again.');
        expect(writeApplicationStatus).toHaveBeenCalledTimes(1);
        expect(mock.captured.writerArgs.toStatus).toBe('ASSIGNED_FOR_REVIEW');
    });
});
