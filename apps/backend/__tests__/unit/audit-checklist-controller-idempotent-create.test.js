'use strict';

/**
 * audit-checklist-controller.create — idempotent find-or-create, explicit
 * organizationId (onsite evidence-capture fix, Task 13, 2026-08-17), and, since
 * 2026-08-26, no create of its own at all.
 *
 * Task 1 creates the canonical AuditChecklist at auditor-assignment
 * (idempotent — see audit-scheduling-service.js assignAuditor). This
 * controller is a SECOND, pre-existing creator with no idempotency guard:
 * POST /api/provider/applications/:applicationId/checklist, gated by
 * requireApplicationOwner (reviewer/auditor/admin). It is FE-dead but still
 * live-mounted + API-reachable. A manual POST used to create a DUPLICATE
 * AuditChecklist for the application — the cert gate + resolveCurrentOnsite
 * -AuditId read most-recent/IN_PROGRESS-first, so a duplicate could SHADOW
 * the real audit and defeat the onsite-evidence-capture fix.
 *
 * The row is now opened by services/audit/arm-onsite-evidence.js, which is
 * exercised for real here rather than mocked: the point of the change is that
 * this controller no longer decides anything about evidence by itself, and a
 * mocked armer would prove only that a function was called. The prisma double
 * below deliberately exposes NO `auditChecklist.create` outside the
 * transaction, so a controller that went back to creating rows directly throws.
 *
 * This suite pins:
 *   - resolver returns an existing id => nothing is armed, the existing row is
 *     fetched + returned as-is (200, same response shape).
 *   - resolver returns null => a new row IS armed, with organizationId set
 *     explicitly from the application's own org (not left to
 *     tenantInjectExtension, which would inject the CALLER's tenant context
 *     instead of the application-owning provider's).
 *   - the arming prefers Application.auditorId (the formally assigned auditor)
 *     over the caller's own id, falling back to the caller only when the
 *     application has no assigned auditor yet.
 *   - the GACP template is still seeded onto the freshly armed row, and the
 *     evidence pin is stamped at the same time.
 *   - the existing 404-when-application-missing behavior is unchanged.
 */

jest.mock('../../shared/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const mockResolveCurrentOnsiteAuditId = jest.fn();
jest.mock('../../services/onsite-audit-resolver', () => ({
    resolveCurrentOnsiteAuditId: (...args) => mockResolveCurrentOnsiteAuditId(...args),
}));

const mockAppFindUnique = jest.fn();
const mockChecklistFindUnique = jest.fn();

// Transaction-scoped doubles — everything the armer and the template seed touch.
const mockTxChecklistFindFirst = jest.fn();
const mockTxChecklistCreate = jest.fn();
const mockTxChecklistFindUnique = jest.fn();
const mockTxChecklistUpdate = jest.fn();
const mockTxAppFindUnique = jest.fn();
const mockTxAppUpdate = jest.fn();

const tx = {
    auditChecklist: {
        findFirst: (...args) => mockTxChecklistFindFirst(...args),
        create: (...args) => mockTxChecklistCreate(...args),
        findUnique: (...args) => mockTxChecklistFindUnique(...args),
        update: (...args) => mockTxChecklistUpdate(...args),
    },
    application: {
        findUnique: (...args) => mockTxAppFindUnique(...args),
        update: (...args) => mockTxAppUpdate(...args),
    },
};

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findUnique: (...args) => mockAppFindUnique(...args),
        },
        auditChecklist: {
            // No `create` here on purpose — see the header.
            findUnique: (...args) => mockChecklistFindUnique(...args),
        },
        $transaction: (fn) => fn(tx),
    },
}));

const { prisma: mockedPrisma } = require('../../services/prisma-database');
const auditChecklistController = require('../../controllers/audit-checklist-controller');

const ONSITE_FORM_DATA = { auditSchedule: { inspectionMode: 'ONSITE', location: 'แปลงที่ 1' } };

function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}

function buildReq({ applicationId = 'app-1', userId = 'reviewer-1', body = {} } = {}) {
    return { params: { applicationId }, body, user: { id: userId } };
}

/** Wire the transaction doubles for the happy "nothing armed yet" path. */
function armsCleanly({ auditorId = 'assigned-auditor', sections = [] } = {}) {
    mockTxChecklistFindFirst.mockResolvedValue(null);
    mockTxChecklistCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'checklist-new', ...data }));
    mockTxAppFindUnique.mockResolvedValue({ formData: ONSITE_FORM_DATA });
    mockTxAppUpdate.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data }));
    mockTxChecklistFindUnique.mockResolvedValue({
        id: 'checklist-new',
        organizationId: 'org-1',
        auditorId,
        sections,
        auditor: null,
    });
    mockTxChecklistUpdate.mockImplementation(({ where, data }) => Promise.resolve({
        id: where.id, organizationId: 'org-1', auditorId, auditor: null, ...data,
    }));
}

describe('audit-checklist-controller.create — idempotent find-or-create + explicit org', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('404s when the application does not exist (unchanged) and never consults the resolver', async () => {
        mockAppFindUnique.mockResolvedValue(null);

        const res = buildRes();
        await auditChecklistController.create(buildReq({ applicationId: 'ghost' }), res);

        expect(mockResolveCurrentOnsiteAuditId).not.toHaveBeenCalled();
        expect(mockTxChecklistCreate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('an existing active AuditChecklist short-circuits the arming and is returned as-is (200)', async () => {
        mockAppFindUnique.mockResolvedValue({
            id: 'app-1', organizationId: 'org-1', auditorId: 'assigned-auditor', formData: ONSITE_FORM_DATA,
        });
        mockResolveCurrentOnsiteAuditId.mockResolvedValue('checklist-existing');
        mockChecklistFindUnique.mockResolvedValue({
            id: 'checklist-existing',
            applicationId: 'app-1',
            organizationId: 'org-1',
            auditorId: 'assigned-auditor',
            status: 'IN_PROGRESS',
            auditor: { firstName: 'สมชาย', lastName: 'ใจดี' },
        });

        const res = buildRes();
        await auditChecklistController.create(buildReq(), res);

        // Exactly the 2-arg resolver call the shared resolver contract
        // expects — no options object (the resolver's org filter is
        // opt-in; this call site intentionally mirrors the gate's own
        // no-organizationId call, per resolveCurrentOnsiteAuditId's doc).
        expect(mockResolveCurrentOnsiteAuditId).toHaveBeenCalledTimes(1);
        expect(mockResolveCurrentOnsiteAuditId).toHaveBeenCalledWith(mockedPrisma, 'app-1');

        expect(mockTxChecklistCreate).not.toHaveBeenCalled();
        expect(mockChecklistFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'checklist-existing' } }),
        );

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: expect.objectContaining({
                id: 'checklist-existing',
                auditorName: 'สมชาย ใจดี',
            }),
        });
    });

    test('a row of ANY status short-circuits arming, so a SUBMITTED audit cannot be shadowed', async () => {
        // The resolver looks at every status; the armer only at IN_PROGRESS. Arming first
        // would open a fresh IN_PROGRESS row beside a finished audit and shadow it.
        mockAppFindUnique.mockResolvedValue({
            id: 'app-1', organizationId: 'org-1', auditorId: 'assigned-auditor', formData: ONSITE_FORM_DATA,
        });
        mockResolveCurrentOnsiteAuditId.mockResolvedValue('checklist-submitted');
        mockChecklistFindUnique.mockResolvedValue({ id: 'checklist-submitted', status: 'SUBMITTED', auditor: null });

        const res = buildRes();
        await auditChecklistController.create(buildReq(), res);

        expect(mockTxChecklistCreate).not.toHaveBeenCalled();
        expect(mockTxAppUpdate).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });

    test('no existing row => arms WITH organizationId explicit from the application', async () => {
        mockAppFindUnique.mockResolvedValue({
            id: 'app-1', organizationId: 'org-1', auditorId: 'assigned-auditor', formData: ONSITE_FORM_DATA,
        });
        mockResolveCurrentOnsiteAuditId.mockResolvedValue(null);
        armsCleanly();

        const res = buildRes();
        await auditChecklistController.create(buildReq({ userId: 'reviewer-1' }), res);

        expect(mockTxChecklistCreate).toHaveBeenCalledTimes(1);
        const createArgs = mockTxChecklistCreate.mock.calls[0][0];
        expect(createArgs.data.applicationId).toBe('app-1');
        expect(createArgs.data.organizationId).toBe('org-1');
        // Prefers the application's formally assigned auditor over the caller.
        expect(createArgs.data.auditorId).toBe('assigned-auditor');
        expect(createArgs.data.status).toBe('IN_PROGRESS');
        expect(createArgs.data.createdBy).toBe('reviewer-1');

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: expect.objectContaining({ id: 'checklist-new' }),
        });
    });

    test('arming through the shared function stamps the evidence pin at the new row', async () => {
        mockAppFindUnique.mockResolvedValue({
            id: 'app-1', organizationId: 'org-1', auditorId: 'assigned-auditor', formData: ONSITE_FORM_DATA,
        });
        mockResolveCurrentOnsiteAuditId.mockResolvedValue(null);
        armsCleanly();

        await auditChecklistController.create(buildReq(), buildRes());

        expect(mockTxAppUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'app-1' },
            data: { formData: expect.objectContaining({ onsiteAuditId: 'checklist-new' }) },
        }));
    });

    test('the GACP template is seeded onto the freshly armed row', async () => {
        mockAppFindUnique.mockResolvedValue({
            id: 'app-1', organizationId: 'org-1', auditorId: 'assigned-auditor', formData: ONSITE_FORM_DATA,
        });
        mockResolveCurrentOnsiteAuditId.mockResolvedValue(null);
        armsCleanly({ sections: [] });

        await auditChecklistController.create(buildReq(), buildRes());

        expect(mockTxChecklistUpdate).toHaveBeenCalledTimes(1);
        const updateArgs = mockTxChecklistUpdate.mock.calls[0][0];
        expect(updateArgs.where).toEqual({ id: 'checklist-new' });
        expect(Array.isArray(updateArgs.data.sections)).toBe(true);
        expect(updateArgs.data.sections.length).toBeGreaterThan(0);
        expect(updateArgs.data.totalItems).toBe(
            updateArgs.data.sections.reduce((sum, s) => sum + s.items.length, 0),
        );
        expect(updateArgs.data.completedItems).toBe(0);
    });

    test('a row that already carries sections is never re-seeded, so answers cannot be wiped', async () => {
        mockAppFindUnique.mockResolvedValue({
            id: 'app-1', organizationId: 'org-1', auditorId: 'assigned-auditor', formData: ONSITE_FORM_DATA,
        });
        mockResolveCurrentOnsiteAuditId.mockResolvedValue(null);
        armsCleanly({ sections: [{ sectionName: 'กรอกไว้แล้ว', items: [{ criteria: 'x', result: 'PASS' }] }] });
        // The armer found an IN_PROGRESS row the outer resolver had not (a concurrent POST).
        mockTxChecklistFindFirst.mockResolvedValue({ id: 'checklist-new' });

        await auditChecklistController.create(buildReq(), buildRes());

        expect(mockTxChecklistCreate).not.toHaveBeenCalled();
        expect(mockTxChecklistUpdate).not.toHaveBeenCalled();
    });

    test('falls back to the caller id when the application has no assigned auditor yet', async () => {
        mockAppFindUnique.mockResolvedValue({
            id: 'app-1', organizationId: 'org-1', auditorId: null, formData: ONSITE_FORM_DATA,
        });
        mockResolveCurrentOnsiteAuditId.mockResolvedValue(null);
        armsCleanly({ auditorId: 'reviewer-1' });

        const res = buildRes();
        await auditChecklistController.create(buildReq({ userId: 'reviewer-1' }), res);

        const createArgs = mockTxChecklistCreate.mock.calls[0][0];
        expect(createArgs.data.auditorId).toBe('reviewer-1');
        expect(createArgs.data.organizationId).toBe('org-1');
    });
});
