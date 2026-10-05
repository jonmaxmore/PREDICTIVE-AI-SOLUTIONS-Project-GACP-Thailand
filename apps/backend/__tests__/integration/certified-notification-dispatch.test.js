/**
 * CERTIFIED notification dispatch — end-to-end side-effect contract.
 *
 * Anchors the Tier 14 fix (batches 9-12) that ties the workflow-side-effects
 * helper (`sendTransitionNotifications` for `nextState === 'CERTIFIED'`) to
 * the canonical status writer (`writeApplicationStatus`).
 *
 * Two contracts are asserted:
 *
 *   1. `writeApplicationStatus` invokes the caller's `onAudit` callback with
 *      `event: 'APPLICATION_STATUS_TRANSITION'` and `toStatus: 'CERTIFIED'`.
 *      Without this event field, downstream audit routing breaks silently.
 *
 *   2. `sendTransitionNotifications` posts a CERTIFIED notification that
 *      contains the celebratory Thai farmer-facing copy (`ยินดีด้วย` /
 *      `ได้รับการรับรอง`) and includes the certificate number in the
 *      message body. Notification persistence is mocked at the prisma
 *      boundary so we exercise the real notification-service path.
 *
 * Mocks: prisma, tenant-context, logger. No I/O.
 */

'use strict';

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Prefix mock-vars with `mock` so jest.mock() hoisting accepts the closure.
const mockNotificationCreate = jest.fn().mockResolvedValue({ id: 'notif-1' });
const mockUserFindUnique = jest.fn().mockResolvedValue({ organizationId: 'org-1' });

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            update: jest.fn(),
            findUnique: jest.fn(),
        },
        user: {
            findUnique: mockUserFindUnique,
            findMany: jest.fn(),
        },
        notification: {
            create: mockNotificationCreate,
            createMany: jest.fn(),
        },
    },
}));

jest.mock('../../services/tenant-context', () => ({
    getTenantContext: jest.fn(() => ({ organizationId: 'org-1' })),
}));

// admin-application-service is required by workflow-side-effects but no
// branch we hit needs it. Stub all its functions to no-op.
jest.mock('../../services/admin-application-service', () => ({
    findRevisionDeadlineByApplicationId: jest.fn().mockResolvedValue(null),
    upsertRevisionDeadline: jest.fn().mockResolvedValue(null),
    bulkUpdateRevisionDeadlineStatus: jest.fn().mockResolvedValue(null),
}));

// field-encryption is required for the maskThaiId import (top of side-effects).
jest.mock('../../utils/field-encryption', () => ({
    maskThaiId: (v) => v || null,
}));

const { writeApplicationStatus } = require('../../services/application-status-writer');
const { sendTransitionNotifications } = require('../../routes/api/provider/handlers/workflow-side-effects');

beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationCreate.mockResolvedValue({ id: 'notif-1' });
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1' });
});

describe('writeApplicationStatus — CERTIFIED transition onAudit envelope', () => {
    test('invokes onAudit with APPLICATION_STATUS_TRANSITION event and toStatus=CERTIFIED', async () => {
        const onAudit = jest.fn().mockResolvedValue(null);
        // Mock prisma with only application.update — workActivity is omitted
        // so the writer's best-effort activity emission is skipped (terminal
        // status path requires workActivity.updateMany, which we don't need
        // to assert here).
        const stubPrisma = {
            application: {
                update: jest.fn().mockResolvedValue({
                    id: 'app-1',
                    status: 'CERTIFIED',
                    organizationId: 'org-1',
                }),
            },
        };

        await writeApplicationStatus({
            prisma: stubPrisma,
            applicationId: 'app-1',
            fromStatus: 'CERTIFICATE_ISSUED',
            toStatus: 'CERTIFIED',
            actorId: 'admin-1',
            actorRole: 'ADMIN',
            reason: 'CERTIFICATE_ISSUED',
            onAudit,
        });

        expect(onAudit).toHaveBeenCalledTimes(1);
        const auditEntry = onAudit.mock.calls[0][0];
        expect(auditEntry.event).toBe('APPLICATION_STATUS_TRANSITION');
        expect(auditEntry.toStatus).toBe('CERTIFIED');
        expect(auditEntry.fromStatus).toBe('CERTIFICATE_ISSUED');
        expect(auditEntry.applicationId).toBe('app-1');
        expect(auditEntry.actorId).toBe('admin-1');
        expect(auditEntry.actorRole).toBe('ADMIN');
        expect(auditEntry.reason).toBe('CERTIFICATE_ISSUED');
        // timestamp is set by the writer, not the caller.
        expect(auditEntry.timestamp).toBeInstanceOf(Date);
    });

    test('cancels open work-activities on CERTIFIED (terminal status)', async () => {
        const onAudit = jest.fn();
        const workActivityUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
        const workActivityCreate = jest.fn().mockResolvedValue(null);
        const stubPrisma = {
            application: {
                update: jest.fn().mockResolvedValue({
                    id: 'app-1',
                    status: 'CERTIFIED',
                    organizationId: 'org-1',
                }),
            },
            workActivity: {
                updateMany: workActivityUpdateMany,
                create: workActivityCreate,
            },
        };

        await writeApplicationStatus({
            prisma: stubPrisma,
            applicationId: 'app-1',
            fromStatus: 'CERTIFICATE_ISSUED',
            toStatus: 'CERTIFIED',
            actorId: 'admin-1',
            onAudit,
        });

        expect(workActivityUpdateMany).toHaveBeenCalledTimes(1);
        const cancelArgs = workActivityUpdateMany.mock.calls[0][0];
        expect(cancelArgs.where.applicationId).toBe('app-1');
        expect(cancelArgs.where.state.in).toEqual(
            expect.arrayContaining(['TODO', 'CLAIMED', 'IN_PROGRESS']),
        );
        expect(cancelArgs.data.state).toBe('CANCELLED');
        expect(cancelArgs.data.cancelReason).toContain('CERTIFIED');
    });

    test('does not throw when onAudit callback rejects (best-effort emission)', async () => {
        const onAudit = jest.fn().mockRejectedValue(new Error('downstream audit-log unavailable'));
        const stubPrisma = {
            application: {
                update: jest.fn().mockResolvedValue({
                    id: 'app-1',
                    status: 'CERTIFIED',
                    organizationId: 'org-1',
                }),
            },
        };

        const result = await writeApplicationStatus({
            prisma: stubPrisma,
            applicationId: 'app-1',
            fromStatus: 'CERTIFICATE_ISSUED',
            toStatus: 'CERTIFIED',
            actorId: 'admin-1',
            onAudit,
        });

        // Status write still succeeds — audit failure must NEVER block the
        // application from reaching CERTIFIED.
        expect(result).toEqual(expect.objectContaining({ id: 'app-1', status: 'CERTIFIED' }));
        expect(onAudit).toHaveBeenCalledTimes(1);
    });
});

describe('sendTransitionNotifications — CERTIFIED celebratory notification', () => {
    function fakeContext({ certificateNumber, certificateUrl = null } = {}) {
        return {
            application: {
                id: 'app-1',
                applicationNumber: 'GACP-2026-0007',
                certificateNumber: null,
            },
            transition: {
                previousState: 'CERTIFICATE_ISSUED',
                nextState: 'CERTIFIED',
                updateData: {
                    formData: {
                        certificateNumber,
                        certificateUrl,
                    },
                },
            },
            healthUserId: 'health-user-1',
            getRevisionDueAt: () => null,
            revisionCategory: null,
            revisionMessage: null,
            effectiveComment: null,
            revisionItems: null,
        };
    }

    test('persists a notification with celebratory Thai title containing ยินดีด้วย', async () => {
        const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
        await sendTransitionNotifications(
            {},
            logger,
            fakeContext({ certificateNumber: 'GACP-CERT-2026-0007' }),
        );

        expect(mockNotificationCreate).toHaveBeenCalledTimes(1);
        const createArgs = mockNotificationCreate.mock.calls[0][0].data;
        expect(createArgs.userId).toBe('health-user-1');
        expect(createArgs.type).toBe('SUCCESS');
        // Thai celebratory title
        expect(createArgs.title).toContain('ยินดีด้วย');
        // Canonical "ได้รับการรับรอง" verbiage from the workflow-side-effects fix.
        expect(createArgs.title).toContain('ได้รับการรับรอง');
    });

    test('embeds the certificate number in the notification message', async () => {
        const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
        await sendTransitionNotifications(
            {},
            logger,
            fakeContext({ certificateNumber: 'GACP-CERT-2026-0042' }),
        );

        const createArgs = mockNotificationCreate.mock.calls[0][0].data;
        expect(createArgs.message).toContain('GACP-CERT-2026-0042');
        // Thai farmer-facing wording — never English fallback.
        expect(createArgs.message).toContain('ใบรับรอง');
    });

    test('metadata payload carries certificateNumber + action=CERTIFIED', async () => {
        const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
        await sendTransitionNotifications(
            {},
            logger,
            fakeContext({
                certificateNumber: 'GACP-CERT-2026-0099',
                certificateUrl: 'https://gacpth.com/cert/0099.pdf',
            }),
        );

        const createArgs = mockNotificationCreate.mock.calls[0][0].data;
        // notification-service places `data` fields under metadata; the
        // exact column name varies by schema, but the URL must be persisted
        // alongside the certificate number. Probe a stable identifier
        // (the certificateNumber) and the action discriminator.
        const stringified = JSON.stringify(createArgs);
        expect(stringified).toContain('GACP-CERT-2026-0099');
        expect(stringified).toContain('CERTIFIED');
    });

    test('falls back to "-" when no certificate number is available', async () => {
        const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
        await sendTransitionNotifications(
            {},
            logger,
            fakeContext({ certificateNumber: undefined }),
        );

        const createArgs = mockNotificationCreate.mock.calls[0][0].data;
        // The notification must still go out — it would be bad UX to swallow
        // the certified message just because the cert-number lookup whiffed.
        expect(createArgs.title).toContain('ยินดีด้วย');
        // Sentinel "-" surface so the farmer at least sees the celebration.
        expect(createArgs.message).toContain('-');
    });

    test('skips notification dispatch when healthUserId is null', async () => {
        const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
        const ctx = fakeContext({ certificateNumber: 'GACP-CERT-2026-0007' });
        ctx.healthUserId = null;

        await sendTransitionNotifications({}, logger, ctx);

        expect(mockNotificationCreate).not.toHaveBeenCalled();
    });
});
