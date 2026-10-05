/**
 * F-PLOT-AREAUNIT-DEADEND fix — resubmit door (Task 1).
 *
 * application-review-revision-methods.js used to run the shared completeness
 * gate (validateSubmissionPayload) ONLY on the isDraftSubmit leg
 * (application-review-revision-methods.js:184, pre-fix). A REVISION_REQUESTED
 * resubmit whose plots lacked areaUnit sailed straight to ASSIGNED_FOR_REVIEW
 * — the specimen (f866374a-8f6b-4c7a-b850-bd09491db042) walked exactly this
 * door — and later died at cert generation (evidence/phase0/FINDINGS.md:127-131).
 *
 * Unlike application-review-revision-methods.test.js, this suite does NOT
 * mock validation/application-submission-validator (or its dependents:
 * canonical-application-validator, application-schemas, preview-utils,
 * application-constants) — it drives the REAL validator through
 * submitRevision, mirroring how applications-submit-canonical-validation.test.js
 * exercises the front door with no validator mocking.
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

function canonicalFormDataWithPlots(plots) {
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
        farmData: {
            farmName: 'ฟาร์มสมชาย',
            address: '123 หมู่ 4',
            province: 'สมุทรปราการ',
            totalAreaSize: '5',
            // farm-areaunit-default fix (Task 2) — this suite is about plot
            // areaUnit; farmData now needs its OWN unit too, or the
            // "still succeeds" case below would 422 for a reason this file
            // isn't testing.
            totalAreaUnit: 'Sqm',
        },
        plots,
        productionData: { propagationType: ['SEED'], plantParts: ['FLOWER'] },
        harvestData: { harvestMethod: 'MANUAL', dryingMethod: 'SUN', storageSystem: 'AMBIENT' },
        documents: [{ type: 'ID_CARD', name: 'บัตรประชาชน', uploaded: true, url: '/uploads/id.pdf' }],
        revisionDueAt: futureDue,
        workflowState: 'REVISION_REQUESTED',
    };
}

describe('submitRevision — plot areaUnit validated on the REVISION_REQUESTED resubmit door (F-PLOT-AREAUNIT-DEADEND fix, Task 1)', () => {
    it('resubmit whose plot has NO areaUnit → 422 errorsByStep[5], no transition written, no quotation', async () => {
        const app = {
            id: 'app-1',
            applicationNumber: 'GACP-2026-0001',
            status: 'REVISION_REQUESTED',
            healthId: 'h-1',
            formData: canonicalFormDataWithPlots([
                { id: 'p1', name: 'แปลงที่ 1', areaSize: '2', solarSystem: 'OUTDOOR' },
            ]),
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

    it('resubmit whose plot HAS a valid (UI-cased) areaUnit still succeeds — byte-identical success path', async () => {
        const app = {
            id: 'app-1',
            applicationNumber: 'GACP-2026-0001',
            status: 'REVISION_REQUESTED',
            healthId: 'h-1',
            formData: canonicalFormDataWithPlots([
                { id: 'p1', name: 'แปลงที่ 1', areaSize: '2', areaUnit: 'Sqm', solarSystem: 'OUTDOOR' },
            ]),
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
