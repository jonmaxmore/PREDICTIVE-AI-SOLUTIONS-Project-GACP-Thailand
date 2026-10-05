'use strict';

/**
 * A0-AUDIT-EMISSION / PR-A0-2 — caller #7 (admin status override).
 *
 * `PATCH /api/admin/applications/:id/status` is the ONE caller that already
 * wrote its own audit row inside the status write's transaction
 * (`auditLogger.logWithin(..., tx)` — routes/api/admin/applications.js:352).
 * That row is `category: ADMIN / action: APPLICATION_STATUS_OVERRIDE`: it
 * records the ADMINISTRATIVE ACT (reasonCode + comment), not the state-machine
 * edge.
 *
 * After PR-A0-1 made the writer audit-by-default, this hop silently acquired a
 * SECOND row (`category: APPLICATION / action: APPLICATION_STATUS_TRANSITION`)
 * emitted by the writer itself — recorded as an open question in
 * the backlog ("ต้องตัดสินว่าอยากได้แถว canonical ที่ hop นี้ไหม").
 *
 * The ruling this suite pins (design-decision.md §4 INVARIANT A0 clause (1) +
 * §2 line 90-91):
 *
 *   1. The canonical transition row IS wanted here. An admin force-transition
 *      is a live status write; excluding it from the canonical trail would make
 *      the single most sensitive general-tier hop the one hop an auditor cannot
 *      find by the canonical query.
 *   2. It must NOT come from the writer's DEFAULT emission at this call site.
 *      The default emitter is fail-OPEN and savepoint-fenced
 *      (application-status-writer.js:367-434) — a failed INSERT is swallowed.
 *      This route's declared contract is the opposite (:263-279): every write of
 *      the hop is bound to one SERIALIZABLE tx and an audit-chain sequence
 *      conflict RETRIES THE WHOLE TRANSACTION (`MAX_TX_ATTEMPTS`). A swallowed
 *      canonical row is invisible to that retry loop, so under two concurrent
 *      overrides the ADMIN row is retried and lands while the canonical row is
 *      dropped — the two rows of the same hop disagree.
 *   3. Therefore: `onAudit: false` (the documented "the caller emits its own
 *      rows" state) + the canonical row emitted by the caller through the SSOT
 *      envelope factory `statusTransitionAuditHook({ tx })`
 *      (middleware/audit-logger.js:834) inside the same tx, un-swallowed.
 *
 * Net effect on row COUNT: unchanged (2 rows, as today post-PR-A0-1). Net effect
 * on SEMANTICS: both rows now share one failure policy and one retry.
 *
 * RED before the fix: `onAudit` is not passed at all and
 * `statusTransitionAuditHook` is never called by this route.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const TX = { __tx: 'admin-override-tx' };
TX.application = {
    update: jest.fn(async () => ({ id: 'APP-7', status: 'AUDIT_CONFIRMED' })),
    findUnique: jest.fn(async () => ({
        id: 'APP-7',
        applicationNumber: 'GACP-2026-0007',
        status: 'AUDIT_CONFIRMED',
        updatedAt: new Date('2026-08-07T00:00:00.000Z'),
    })),
};

const mockLogWithin = jest.fn().mockResolvedValue({ id: 'audit-row' });
const CANONICAL_EMIT = jest.fn().mockResolvedValue({ id: 'canonical-row' });
const mockStatusTransitionAuditHook = jest.fn(() => CANONICAL_EMIT);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: jest.fn(),
        logWithin: (...a) => mockLogWithin(...a),
        isSequenceConflictError: jest.fn(() => false),
    },
    AuditCategory: { ADMIN: 'ADMIN', APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: (...a) => mockStatusTransitionAuditHook(...a),
}));

const mockWriteApplicationStatus = jest.fn().mockResolvedValue({ id: 'APP-7' });
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: (...a) => mockWriteApplicationStatus(...a),
}));

const mockFindFirst = jest.fn();
const mockTransaction = jest.fn(async (cb) => cb(TX));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...a) => mockFindFirst(...a) },
        $transaction: (...a) => mockTransaction(...a),
    },
}));

jest.mock('../../services/admin-application-service', () => ({
    ALLOWED_FORCE_STATUSES: new Set(['AUDIT_CONFIRMED', 'AUDIT_PASSED', 'REJECTED']),
    forceTransitionStatus: jest.fn(),
    revertLastTransition: jest.fn(),
}));

const router = require('../../routes/api/admin/applications');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'admin-uuid-7', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam' };
        next();
    });
    app.use('/api/admin/applications', router);
    return app;
}

const OVERRIDE_BODY = {
    status: 'AUDIT_CONFIRMED',
    reasonCode: 'DATA_CORRECTION',
    comment: 'แก้ไขสถานะตามคำสั่งผู้ดูแลระบบ',
};

describe('PR-A0-2 #7 — admin status override: canonical transition row is caller-owned', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(TX));
        mockWriteApplicationStatus.mockResolvedValue({ id: 'APP-7' });
        mockFindFirst.mockResolvedValue({
            id: 'APP-7',
            applicationNumber: 'GACP-2026-0007',
            status: 'AUDIT_FEE_PAID',
            formData: {},
            workflowHistory: [],
        });
        app = buildApp();
    });

    const patch = () => request(app).patch('/api/admin/applications/APP-7/status').send(OVERRIDE_BODY);

    test('the writer is told the caller owns the emission (onAudit === false)', async () => {
        const res = await patch();

        expect(res.status).toBe(200);
        expect(mockWriteApplicationStatus).toHaveBeenCalledTimes(1);
        const call = mockWriteApplicationStatus.mock.calls[0][0];
        // Still the same tx handle as before — unchanged.
        expect(call.prisma).toBe(TX);
        // THE MIGRATION: the tri-state is now explicit at this call site.
        expect(call.onAudit).toBe(false);
    });

    test('the canonical APPLICATION_STATUS_TRANSITION row is emitted through the SSOT hook, bound to the SAME tx', async () => {
        await patch();

        expect(mockStatusTransitionAuditHook).toHaveBeenCalledTimes(1);
        expect(mockStatusTransitionAuditHook).toHaveBeenCalledWith(
            expect.objectContaining({ tx: TX }),
        );
        expect(CANONICAL_EMIT).toHaveBeenCalledTimes(1);
        const entry = CANONICAL_EMIT.mock.calls[0][0];
        expect(entry).toMatchObject({
            event: 'APPLICATION_STATUS_TRANSITION',
            applicationId: 'APP-7',
            fromStatus: 'AUDIT_FEE_PAID',
            toStatus: 'AUDIT_CONFIRMED',
        });
    });

    test('the pre-existing ADMIN override row is NOT removed (the two rows are different records)', async () => {
        await patch();

        expect(mockLogWithin).toHaveBeenCalledTimes(1);
        const [event, txArg] = mockLogWithin.mock.calls[0];
        expect(event).toMatchObject({
            category: 'ADMIN',
            action: 'APPLICATION_STATUS_OVERRIDE',
            resourceId: 'APP-7',
        });
        expect(event.metadata).toMatchObject({
            reasonCode: 'DATA_CORRECTION',
            previousStatus: 'AUDIT_FEE_PAID',
            nextStatus: 'AUDIT_CONFIRMED',
        });
        expect(txArg).toBe(TX);
    });

    // PR-A0-2 audit round 1, F3 — this case used to be named "ROLLS THE HOP
    // BACK", which it cannot prove: `mockTransaction` (line 86) is a
    // pass-through with no rollback semantics, so no assertion here can observe
    // whether anything was undone. design-decision.md §4:155 forbids a unit
    // test from claiming clause (2) for exactly this reason. Renamed to what it
    // actually establishes — the failure PROPAGATES instead of being swallowed,
    // which is the caller-side half of the contract. The rollback half is
    // claimed only by the Postgres integration file
    // (`__tests__/integration/a0-pr2-per-hop-invariant.test.js`, hop #7 case 3).
    test('a failing canonical emission is NOT swallowed — it propagates and the route 500s', async () => {
        CANONICAL_EMIT.mockRejectedValueOnce(new Error('audit chain unavailable'));
        // The route's retry loop only retries sequence conflicts; this is not
        // one, so the error must reach the caller rather than letting the route
        // answer 200 for a hop whose canonical row vanished.
        const res = await patch();

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});
