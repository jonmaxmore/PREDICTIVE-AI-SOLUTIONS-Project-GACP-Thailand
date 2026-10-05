'use strict';

/**
 * Waiver-reopen fence at the canonical writer chokepoint (owner ruling
 * 2026-07-08 — "เท่านั้น"): leaving EXPIRED is reserved for the SYSTEM actor
 * executing an approved waiver request. Admin escape hatches (force/override/
 * revert) all flow through writeApplicationStatus, and the fence runs
 * REGARDLESS of assertTransition — so the SoD flow is not "a polite path next
 * to an open back door" (decision-doc carve-out C / risk #3). The audited
 * emergency override is breakGlassReopen:true (force-status reasonCode
 * BREAK_GLASS_REOPEN).
 */

const mockUpdate = jest.fn().mockResolvedValue({ id: 'APP-1', status: 'REVISION_REQUESTED', formData: {} });
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

// Lazy deps of the writer — stub the ones the status-update path touches.
jest.mock('../../services/workflow-transition-service', () => ({
    canTransition: jest.fn(() => true),
    resolveStateFromApplication: jest.fn(() => 'EXPIRED'),
    ROLE_TRANSITIONS: {},
    ALLOWED_TRANSITIONS: {},
}));
jest.mock('../../services/work-activity-service', () => ({
    spawnActivitiesForTransition: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../services/certificate-service', () => ({}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn(), logWithin: jest.fn() },
    statusTransitionAuditHook: jest.fn(() => jest.fn()),
}));
jest.mock('../../services/notification-fanout-service', () => ({
    dispatchTransitionFanout: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { writeApplicationStatus } = require('../../services/application-status-writer');

const PRISMA = {
    application: {
        update: (...a) => mockUpdate(...a),
        findUnique: jest.fn().mockResolvedValue({ id: 'APP-1', status: 'EXPIRED', formData: {} }),
    },
};

function baseArgs(overrides = {}) {
    return {
        prisma: PRISMA,
        applicationId: 'APP-1',
        fromStatus: 'EXPIRED',
        toStatus: 'REVISION_REQUESTED',
        actorId: 'admin-1',
        actorRole: 'admin',
        reason: 'ADMIN_FORCE_STATUS',
        assertTransition: false,
        autoIssueCertificate: false,
        ...overrides,
    };
}

describe('writer fence — EXPIRED exit is waiver/SYSTEM/break-glass only', () => {
    beforeEach(() => jest.clearAllMocks());

    test('admin force out of EXPIRED WITHOUT break-glass → 409 WAIVER_REOPEN_REQUIRED, no write', async () => {
        await expect(writeApplicationStatus(baseArgs()))
            .rejects.toMatchObject({ statusCode: 409, code: 'WAIVER_REOPEN_REQUIRED' });
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('the fence runs even with assertTransition:false (escape hatches cannot dodge it)', async () => {
        await expect(writeApplicationStatus(baseArgs({ assertTransition: false, actorRole: 'ADMIN' })))
            .rejects.toMatchObject({ code: 'WAIVER_REOPEN_REQUIRED' });
    });

    test('SYSTEM actor (waiver-reopen execution) passes the fence', async () => {
        await writeApplicationStatus(baseArgs({ actorRole: 'system', actorId: 'SYSTEM' }));
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    test('breakGlassReopen:true (force-status reasonCode BREAK_GLASS_REOPEN) passes, audited by caller', async () => {
        await writeApplicationStatus(baseArgs({ breakGlassReopen: true }));
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    test('EXPIRED→EXPIRED (idempotent re-stamp) is NOT fenced', async () => {
        await writeApplicationStatus(baseArgs({ toStatus: 'EXPIRED' }));
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    test('non-EXPIRED transitions are untouched by the fence', async () => {
        await writeApplicationStatus(baseArgs({ fromStatus: 'CAR_PENDING', toStatus: 'EXPIRED' }));
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    test('MUST-3: omitting fromStatus does NOT dodge the fence (writer pre-reads the row)', async () => {
        // sync-controller-class callers pass fromStatus: undefined while the
        // row may really be EXPIRED — the writer must read the actual status
        // (PRISMA.application.findUnique here returns EXPIRED) and still fence.
        await expect(writeApplicationStatus(baseArgs({ fromStatus: undefined })))
            .rejects.toMatchObject({ code: 'WAIVER_REOPEN_REQUIRED' });
        expect(PRISMA.application.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'APP-1' } }),
        );
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('MUST-3: nullish fromStatus on a NON-expired row passes (no false fence)', async () => {
        PRISMA.application.findUnique.mockResolvedValueOnce({ id: 'APP-1', status: 'SUBMITTED', formData: {} });
        await writeApplicationStatus(baseArgs({ fromStatus: undefined, toStatus: 'PENDING_DOC_FEE' }));
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
});
