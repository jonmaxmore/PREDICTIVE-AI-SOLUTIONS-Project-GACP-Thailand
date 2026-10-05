'use strict';

/**
 * External-services cleanup T1 — application-draft-query-methods.js
 * (spec: design note 2026-08-19-external-services-cleanup-design).
 *
 * saveDraft's SUBMITTED branch used to do THREE things after persisting the
 * application: (1) generate the phase-1 invoice, (2) write the in-app
 * APPLICATION_SUBMITTED notification via sendNotification, (3) fire an E2
 * (services/email/email-service.js) submission-confirmation email. Operator
 * decision 2026-08-13 (shared/notification-view.js:16-19) sanctions deleting
 * (3) — the in-app row from (2) is already the authoritative channel.
 *
 * Pins:
 *   1. in-app write (sendNotification(...APPLICATION_SUBMITTED...)) survives
 *      byte-identical.
 *   2. removal pin — no E2 email function fires. RED against the
 *      pre-cleanup code (email IS sent today when the applicant has an
 *      email on file) → GREEN after T1 deletes the block.
 *
 * External-services cleanup T3 (2026-08-19) deleted the E2 module outright
 * (zero remaining callers), so this suite no longer jest.mocks
 * services/email/email-service — nothing in this code path can require it.
 */

const mockFindUserByHealthIdSecurely = jest.fn();
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: (...args) => mockFindUserByHealthIdSecurely(...args),
}));

jest.mock('../../services/audit-trail', () => ({
    logAction: jest.fn(),
    ACTIONS: { SUBMIT: 'SUBMIT' },
    ENTITIES: { APPLICATION: 'APPLICATION' },
    SEVERITY: { INFO: 'INFO' },
}));

const { createApplicationDraftQueryMethods } = require('../../services/application-service/application-draft-query-methods');

const noopLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function buildMethods({ prisma, sendNotification }) {
    const methods = createApplicationDraftQueryMethods({
        prisma,
        feeService: {
            calculateApplicationFees: () => ({
                phase1: { total: 5535 }, phase2: { total: 27675 }, total: 33210, scopeCount: 1,
            }),
        },
        sendNotification,
        NotifyType: { APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED' },
        logger: noopLogger,
    });
    // resolveHealthIdentity is provided by a sibling factory in the real
    // service composition; stub it directly like the sibling suite does
    // (apps/backend/__tests__/unit/application-entity-scope-where.test.js).
    methods.resolveHealthIdentity = jest.fn().mockResolvedValue({
        userId: 'user-1',
        healthId: '1234567890123',
    });
    // _generatePhase1Invoice belongs to a sibling mixin; stub it so saveDraft's
    // SUBMITTED branch can run standalone.
    methods._generatePhase1Invoice = jest.fn().mockResolvedValue(null);
    return methods;
}

function buildPrisma() {
    return {
        application: {
            findFirst: jest.fn().mockResolvedValue(null),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(async ({ data }) => ({ id: 'app-1', ...data })),
            update: jest.fn(),
        },
    };
}

const SUBMIT_PAYLOAD = {
    status: 'SUBMITTED',
    plantId: 'plant-1',
    plantName: 'กระท่อม',
    serviceType: 'GACP',
    areaType: 'OUTDOOR',
    cultivationMethods: ['outdoor'],
    applicantData: {},
    locationData: {},
    productionData: {},
    harvestData: {},
    documents: [],
};

beforeEach(() => {
    jest.clearAllMocks();
    mockFindUserByHealthIdSecurely.mockResolvedValue({
        email: 'applicant@example.com', firstName: 'สม', lastName: 'ชาย',
    });
});

describe('cleanup T1 — saveDraft(SUBMITTED) in-app write survives byte-identical', () => {
    it('calls sendNotification(userId, APPLICATION_SUBMITTED, {...}) exactly as before', async () => {
        const prisma = buildPrisma();
        const sendNotification = jest.fn().mockResolvedValue({});
        const methods = buildMethods({ prisma, sendNotification });

        await methods.saveDraft('user-1', SUBMIT_PAYLOAD);

        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(sendNotification).toHaveBeenCalledWith(
            'user-1',
            'APPLICATION_SUBMITTED',
            expect.objectContaining({
                applicationId: 'app-1',
                applicationNumber: expect.any(String),
                plantName: 'กระท่อม',
            }),
        );
    });
});

describe('cleanup T1/T3 — removal pin (E2 submission-confirmation email deleted)', () => {
    it('saveDraft completes without touching the (now-deleted) E2 email service', async () => {
        const prisma = buildPrisma();
        const sendNotification = jest.fn().mockResolvedValue({});
        const methods = buildMethods({ prisma, sendNotification });

        await expect(methods.saveDraft('user-1', SUBMIT_PAYLOAD)).resolves.toBeDefined();
    });

    it('the E2 email-service module file no longer exists on disk', () => {
        const fs = require('fs');
        const path = require('path');
        const e2Path = path.join(__dirname, '..', '..', 'services', 'email', 'email-service.js');
        expect(fs.existsSync(e2Path)).toBe(false);
    });
});
