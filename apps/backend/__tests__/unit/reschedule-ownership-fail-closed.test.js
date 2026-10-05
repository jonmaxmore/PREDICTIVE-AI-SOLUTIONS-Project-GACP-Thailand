'use strict';

/**
 * SEC — requestReschedule's ownership check must fail CLOSED.
 *
 * audit-scheduling-service.js:692 guarded the comparison on both sides being
 * present:
 *
 *     if (effectiveActor.healthId && app.healthId && effectiveActor.healthId !== app.healthId) {
 *         throw FORBIDDEN_OWNER
 *     }
 *
 * So the check only runs when it already has both values. Whenever either is
 * missing it is skipped entirely — and "skipped" here means the applicant is
 * treated as the owner. Three concrete ways that happens, none hypothetical:
 *
 * 1. A DEGRADED DATABASE. `healthId` is no longer in the JWT (Sprint 6 B-C1);
 *    auth-middleware fetches it per request and, when that read fails, HEALTH
 *    users are DELIBERATELY kept alive with the identity fields null — the
 *    middleware says so in as many words ("HEALTH is deliberately excluded: it
 *    keeps the degraded-DB keep-alive"). That is a sound availability decision
 *    for authentication. It becomes an authorization hole only because this
 *    check reads a null owner key as "no opinion" instead of "cannot verify".
 *    During a pool timeout, any applicant can reschedule any audit.
 *
 * 2. A NON-HTTP CALLER. `effectiveActor` falls back to `{ id: actorId, role:
 *    HEALTH }`, which carries no healthId at all. The service's own docstring
 *    advertises exactly this usage — "authorization (role + tenant + ownership)
 *    lives inside the service so the contract is identical for any caller (CLI,
 *    cron, future routes)" — so the documented contract is the one that skips
 *    the check.
 *
 * 3. A ROW WITH NO healthId, which skips the check for every caller.
 *
 * assertApplicantRole above it does not help: it checks the ROLE only, so every
 * applicant clears it.
 *
 * Fail-closed means: resolve the caller's owner key, resolve the row's, and
 * refuse unless they match. A missing value on either side is a refusal, not a
 * pass. The comparison also accepts canonicalId, which is what Application
 * .healthId is actually an FK to and what the HTTP layer reads elsewhere
 * (`req.user?.canonicalId || req.user?.healthId`).
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockAppFindFirst = jest.fn();
const mockAppUpdate = jest.fn(async () => ({ id: 'APP-1' }));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findFirst: (...a) => mockAppFindFirst(...a),
            update: (...a) => mockAppUpdate(...a),
        },
        $transaction: jest.fn(async (cb) => cb({
            application: {
                findFirst: (...a) => mockAppFindFirst(...a),
                update: (...a) => mockAppUpdate(...a),
            },
        })),
    },
}));

jest.mock('../../services/notification-service', () => ({
    sendNotification: jest.fn().mockResolvedValue({}),
    NotifyType: {},
}));

const service = require('../../services/audit-scheduling-service');

// An audit already confirmed for applicant "owner-canonical".
const CONFIRMED_APP = {
    id: 'APP-1',
    applicationNumber: 'GACP-2026-0001',
    status: 'AUDIT_CONFIRMED',
    healthId: 'owner-canonical',
    organizationId: 'org-1',
    scheduledDate: new Date('2026-09-20T02:00:00.000Z'),
    auditorId: 'aud-1',
    formData: { workflowState: 'AUDIT_CONFIRMED' },
};

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const REASON = 'ติดธุระด่วน ขอเลื่อนวันตรวจ';

function reschedule(actor) {
    return service.requestReschedule({
        applicationId: 'APP-1',
        requestedDate: FUTURE,
        reason: REASON,
        actorId: actor?.id,
        actor,
    });
}

describe('SEC — requestReschedule refuses when ownership cannot be proven', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAppFindFirst.mockResolvedValue({ ...CONFIRMED_APP });
    });

    it('refuses a DIFFERENT applicant (the case that already worked)', async () => {
        await expect(reschedule({
            id: 'attacker', canonicalRole: 'health', role: 'HEALTH',
            healthId: 'attacker-canonical', canonicalId: 'attacker-canonical',
        })).rejects.toMatchObject({ code: 'FORBIDDEN_OWNER' });

        expect(mockAppUpdate).not.toHaveBeenCalled();
    });

    it('refuses when the caller identity is null — a degraded-DB request', async () => {
        // auth-middleware keeps HEALTH sessions alive with null identity fields
        // when the per-request identity read fails. That must not read as
        // "ownership not applicable".
        await expect(reschedule({
            id: 'attacker', canonicalRole: 'health', role: 'HEALTH',
            healthId: null, canonicalId: null,
        })).rejects.toMatchObject({ code: 'FORBIDDEN_OWNER' });

        expect(mockAppUpdate).not.toHaveBeenCalled();
    });

    it('refuses a caller passed as actorId only — the documented CLI/cron shape', async () => {
        await expect(service.requestReschedule({
            applicationId: 'APP-1',
            requestedDate: FUTURE,
            reason: REASON,
            actorId: 'attacker',
        })).rejects.toMatchObject({ code: 'FORBIDDEN_OWNER' });

        expect(mockAppUpdate).not.toHaveBeenCalled();
    });

    it('refuses when the APPLICATION carries no healthId', async () => {
        mockAppFindFirst.mockResolvedValue({ ...CONFIRMED_APP, healthId: null });

        await expect(reschedule({
            id: 'attacker', canonicalRole: 'health', role: 'HEALTH',
            healthId: 'attacker-canonical', canonicalId: 'attacker-canonical',
        })).rejects.toMatchObject({ code: 'FORBIDDEN_OWNER' });

        expect(mockAppUpdate).not.toHaveBeenCalled();
    });

    it('still lets the real owner reschedule, matched on healthId', async () => {
        await expect(reschedule({
            id: 'owner', canonicalRole: 'health', role: 'HEALTH',
            healthId: 'owner-canonical', canonicalId: null,
        })).resolves.toBeDefined();
    });

    it('still lets the real owner reschedule, matched on canonicalId', async () => {
        // Application.healthId is an FK to User.canonicalId, and the HTTP layer
        // reads `canonicalId || healthId` elsewhere — both must satisfy this.
        await expect(reschedule({
            id: 'owner', canonicalRole: 'health', role: 'HEALTH',
            healthId: null, canonicalId: 'owner-canonical',
        })).resolves.toBeDefined();
    });
});
