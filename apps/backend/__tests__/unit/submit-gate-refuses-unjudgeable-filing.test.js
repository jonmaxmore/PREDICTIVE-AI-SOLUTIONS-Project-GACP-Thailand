'use strict';

/**
 * The submit gate refuses a filing the law cannot reach.
 *
 * The gate's contract has always been "the server cannot see a document the law demands".
 * That sentence hides an assumption: that some law was found. When the register held no
 * rules for the filing's plant it found none, `missingRequired` was empty, and the gate
 * waved the filing through — then froze the empty answer onto it as the law every later
 * resubmit is judged by (AC3). The refusal has to happen at the same door, or the
 * emptiest possible stamp becomes permanent.
 */

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockResolve = jest.fn();
jest.mock('../../services/application-requirements-service', () => {
    const actual = jest.requireActual('../../services/application-requirements-service');
    return {
        ...actual,
        resolveApplicationRequirements: (...args) => mockResolve(...args),
    };
});

const {
    assertRequiredDocumentsPresent,
    MODE_FIRST_SUBMIT,
    MODE_RESUBMIT,
} = require('../../services/application-document-requirements');

const APPLICATION = { id: 'app-1', entityId: null, formData: { plantId: 'turmeric' } };

function clientWithNoDocuments() {
    return {
        applicationDocument: { findMany: jest.fn().mockResolvedValue([]) },
        entity: { findUnique: jest.fn().mockResolvedValue(null) },
    };
}

const JUDGED = {
    dims: {}, slots: [], missingRequired: [], complete: true, blockingIssues: [],
    appliedRules: [{ id: 'r1', slotId: 'land_rights' }], requiredSlotIds: ['land_rights'],
};

beforeEach(() => jest.clearAllMocks());

describe('first submit — a filing no law can judge', () => {
    test('is refused, with the reason the farmer can act on', async () => {
        mockResolve.mockResolvedValue({
            ...JUDGED,
            complete: false,
            requiredSlotIds: [],
            appliedRules: [],
            blockingIssues: [{
                code: 'PLANT_LAW_NOT_FILED',
                messageTH: 'ขณะนี้ยังไม่มีประกาศข้อกำหนดเอกสารสำหรับพืชที่คุณเลือก',
                detail: { plantCode: 'turmeric', openPlantCodes: ['cannabis'] },
            }],
        });
        await expect(assertRequiredDocumentsPresent({
            application: APPLICATION, mode: MODE_FIRST_SUBMIT, client: clientWithNoDocuments(),
        })).rejects.toMatchObject({
            status: 422,
            code: 'APPLICATION_NOT_JUDGEABLE',
            blockingIssues: [expect.objectContaining({ code: 'PLANT_LAW_NOT_FILED' })],
        });
    });

    test('is refused BEFORE it can be told which documents are missing', async () => {
        // Both are true at once, and the order matters: "attach these nine papers" is
        // wrong advice for a filing whose plant the ministry has published no list for.
        mockResolve.mockResolvedValue({
            ...JUDGED,
            complete: false,
            missingRequired: ['land_rights'],
            blockingIssues: [{ code: 'PLANT_NOT_DECLARED', messageTH: 'ยังไม่ได้ระบุชนิดพืช', detail: {} }],
        });
        await expect(assertRequiredDocumentsPresent({
            application: APPLICATION, mode: MODE_FIRST_SUBMIT, client: clientWithNoDocuments(),
        })).rejects.toMatchObject({ code: 'APPLICATION_NOT_JUDGEABLE' });
    });

    test('a judged filing still passes and still gets its stamp', async () => {
        mockResolve.mockResolvedValue(JUDGED);
        await expect(assertRequiredDocumentsPresent({
            application: APPLICATION, mode: MODE_FIRST_SUBMIT, client: clientWithNoDocuments(),
        })).resolves.toMatchObject({ requiredSlotIds: ['land_rights'], grandfathered: false });
    });
});

describe('resubmit is untouched — it is judged by the stamp, never by today’s law', () => {
    test('a filing stamped before this change resubmits against its own stamp', async () => {
        const stamped = {
            id: 'app-2',
            entityId: null,
            formData: {
                plantId: 'turmeric',
                serverRequirementSnapshot: { slotIds: [] },
            },
        };
        await expect(assertRequiredDocumentsPresent({
            application: stamped, mode: MODE_RESUBMIT, client: clientWithNoDocuments(),
        })).resolves.toMatchObject({ grandfathered: false });
        expect(mockResolve).not.toHaveBeenCalled();
    });
});
