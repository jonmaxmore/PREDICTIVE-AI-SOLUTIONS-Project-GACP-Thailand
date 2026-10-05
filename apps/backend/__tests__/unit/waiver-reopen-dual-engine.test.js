'use strict';

/**
 * MUST-7 (adversarial-verify / decision-doc risk #1 — CRIT): after a waiver
 * reopen, BOTH real expiry engines must leave the application alone.
 *
 * The nightly/hourly engines read the STORED stamps:
 *   * routes/api/system/cron.js GET /auto-cancel — parseAutoCancelDueDate over
 *     formData.revisionDueAt/carDueAt (+ RevisionDeadline fallback)
 *   * jobs/revision-deadline-checker.js — RevisionDeadline rows PENDING/EXTENDED
 * A reopen that misses one restamp leg is silently re-expired within the hour.
 * This spec captures the EXACT formData + deadline row the real
 * approveReopenRequest writes, then runs the REAL engines against them.
 */

const express = require('express');
const request = require('supertest');

// ── shared quiet mocks ──────────────────────────────────────────────────────
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});
jest.mock('../../utils/field-encryption', () => ({ maskThaiIdsInText: (s) => s }));

// waiver service deps (real service, mocked IO)
const mockWriteApplicationStatus = jest.fn().mockResolvedValue({});
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));
jest.mock('../../middleware/audit-logger', () => ({
    statusTransitionAuditHook: jest.fn(() => jest.fn()),
}));
jest.mock('../../services/finance/invoice-side', () => ({
    ISSUER_SIDE: Object.freeze({ DTAM: 'DTAM', PLATFORM: 'PLATFORM' }),
    resolveAllowedIssuerSides: () => ['DTAM'],
}));
jest.mock('../../services/phase-billing-service', () => ({
    computePhaseSettlement: () => ({ phasePaid: true }),
}));
jest.mock('../../services/invoice-service', () => ({
    listSettlementsForApplication: jest.fn().mockResolvedValue([]),
}));

const mockAppFindFirst = jest.fn();
const mockDeadlineUpsert = jest.fn().mockResolvedValue({});
const mockApplicationFindMany = jest.fn();
const mockDeadlineFindMany = jest.fn();
const mockApplicationUpdate = jest.fn().mockResolvedValue({});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findFirst: (...a) => mockAppFindFirst(...a),
            findMany: (...a) => mockApplicationFindMany(...a),
            update: (...a) => mockApplicationUpdate(...a),
        },
        waiverReopenRequest: {
            findFirst: jest.fn().mockResolvedValue({
                id: 'REQ-1', applicationId: 'APP-1', organizationId: 'org-1',
                status: 'PENDING', requestedBy: 'rev-1',
                expiredFromState: 'REVISION_REQUESTED', reasonCode: 'LENIENCY',
            }),
        },
        revisionDeadline: { updateMany: jest.fn().mockResolvedValue({}) },
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'u-1' }), findMany: jest.fn().mockResolvedValue([]) },
        // Refund-aware settlement gate (carpet-bomb S1) reads invoice metadata.
        invoice: { findMany: jest.fn().mockResolvedValue([]) },
        // Hardening batch: WAIVER_APPROVAL queue item (spawn/close best-effort).
        workActivity: {
            create: jest.fn().mockResolvedValue({ id: 'WA-1' }),
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $transaction: jest.fn(async (cb) => cb({
            waiverReopenRequest: { update: jest.fn().mockResolvedValue({}) },
            revisionDeadline: { upsert: (...a) => mockDeadlineUpsert(...a) },
            application: { update: (...a) => mockApplicationUpdate(...a) },
            workActivity: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        })),
    },
}));
jest.mock('../../services/working-days-service', () => ({
    loadHolidaySet: jest.fn().mockResolvedValue(new Set()),
    countWorkingDays: jest.fn(() => 3),
    addWorkingDays: jest.fn((d) => d),
}));
const mockSendNotification = jest.fn().mockResolvedValue({ id: 'n-1' });
const mockNotifyApproaching = jest.fn().mockResolvedValue({ id: 'n-2' });
jest.mock('../../services/notification-service', () => ({
    sendNotification: (...a) => mockSendNotification(...a),
    notifyRevisionDeadlineApproaching: (...a) => mockNotifyApproaching(...a),
    NotifyType: new Proxy({}, { get: (_t, k) => String(k) }),
}));
jest.mock('../../services/tenant-context', () => ({
    runWithTenantContext: (_ctx, fn) => fn(),
    withoutTenantScope: (fn) => fn(),
}));
jest.mock('../../shared/workflow-state-machine', () => ({
    APPLICATION_STATUSES: { EXPIRED: 'EXPIRED' },
}));
jest.mock('../../services/workflow-transition-service', () => ({
    buildTransitionUpdate: jest.fn(),
}));

const EXPIRED_APP = {
    id: 'APP-1',
    applicationNumber: 'GACP-2026-0300',
    status: 'EXPIRED',
    organizationId: 'org-1',
    healthId: 'tok-1',
    reviewerId: 'rev-1',
    auditorId: null,
    version: 3,
    formData: {
        cancelReason: 'REVISION_OVERDUE',
        canceledExpiredAt: '2026-07-01T00:00:00.000Z',
        revisionDueAt: '2026-06-30T00:00:00.000Z',
        revision_due_at: '2026-06-30T00:00:00.000Z',
        revisionReminder24hSentAt: '2026-06-29T00:00:00.000Z',
        revisionReminder48hSentAt: '2026-06-28T00:00:00.000Z',
    },
    workflowHistory: [
        { timestamp: 't1', action: 'AUTO_EXPIRED', fromStatus: 'REVISION_REQUESTED', toStatus: 'EXPIRED' },
    ],
};

describe('MUST-7 — post-reopen, both REAL expiry engines leave the app alone', () => {
    let reopenedFormData;
    let reopenedDueAt;
    let reopenedUpsertArgs;

    beforeAll(async () => {
        mockAppFindFirst.mockResolvedValue({ ...EXPIRED_APP });
        const service = require('../../services/waiver-reopen-service');
        const { dueAt } = await service.approveReopenRequest({
            requestId: 'REQ-1',
            user: { id: 'acct-1', canonicalRole: 'finance_officer_dtam', organizationId: 'org-1' },
        });
        reopenedDueAt = dueAt;
        // Capture BOTH persisted shapes here — mock.calls read inside tests
        // can be wiped by clears; beforeAll is the safe window.
        reopenedFormData = mockWriteApplicationStatus.mock.calls[0][0].additionalData.formData;
        reopenedUpsertArgs = mockDeadlineUpsert.mock.calls[0][0];
        expect(reopenedFormData.revisionDueAt).toBe(dueAt.toISOString());
    });

    beforeEach(() => {
        mockApplicationUpdate.mockClear();
        mockWriteApplicationStatus.mockClear();
        mockSendNotification.mockClear();
        mockNotifyApproaching.mockClear();
    });

    test('REAL cron /auto-cancel neither expires nor (yet) reminds the reopened app', async () => {
        process.env.CRON_SECRET = 'drill-secret';
        mockApplicationFindMany.mockResolvedValue([{
            id: 'APP-1',
            applicationNumber: 'GACP-2026-0300',
            status: 'REVISION_REQUESTED', // post-reopen state
            healthId: 'tok-1',
            formData: reopenedFormData,   // EXACTLY what the reopen wrote
            workflowHistory: [],
            revisionDeadline: null,
        }]);

        const app = express();
        app.use('/cron', require('../../routes/api/system/cron'));
        const res = await request(app).get('/cron/auto-cancel').set('x-cron-secret', 'drill-secret');

        expect(res.status).toBe(200);
        // No re-expiry: due date is ~5 working days out.
        expect(res.body.data.cancelledCount).toBe(0);
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
        // No stale reminder either: the reopen re-armed all four stamps and
        // the fresh due date is beyond the 48h reminder buckets.
        expect(res.body.data.remindersSentCount).toBe(0);
        expect(new Date(reopenedFormData.revisionDueAt).getTime() - Date.now())
            .toBeGreaterThan(48 * 60 * 60 * 1000);
    });

    test('REAL revision-deadline-checker does not expire the re-seeded deadline', async () => {
        mockDeadlineFindMany.mockResolvedValue([]);
        // The checker scans RevisionDeadline PENDING/EXTENDED. Feed it the row
        // shape the reopen upserted (fresh future revisionDue), captured in
        // beforeAll (jest clears mock.calls between tests).
        expect(reopenedUpsertArgs.update.revisionDue.toISOString()).toBe(reopenedDueAt.toISOString());

        const { prisma } = require('../../services/prisma-database');
        prisma.revisionDeadline.findMany = jest.fn().mockResolvedValue([{
            id: 'RD-1',
            applicationId: 'APP-1',
            organizationId: 'org-1',
            status: 'PENDING',
            revisionDue: reopenedDueAt, // the reopen's fresh due date
            application: {
                id: 'APP-1',
                applicationNumber: 'GACP-2026-0300',
                status: 'REVISION_REQUESTED',
                healthId: 'tok-1',
                formData: reopenedFormData,
                workflowHistory: [],
            },
        }]);

        const { checkExpiredDeadlines } = require('../../jobs/revision-deadline-checker');
        const stats = await checkExpiredDeadlines();

        expect(stats.expired).toBe(0);
        expect(mockWriteApplicationStatus).not.toHaveBeenCalled();
    });
});
