'use strict';

/**
 * Hardening batch 2026-07-09 (#664 follow-up) — logWithin needs the per-org
 * audit-chain advisory lock that log() already takes.
 *
 * log() serializes the read-tail → assign-seq → insert critical section with
 * pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_NS, hashtext(orgId)) inside its own
 * $transaction. logWithin ran the SAME critical section inside the CALLER's
 * tx with NO lock, relying on a SERIALIZABLE assumption only ONE caller
 * satisfies — the 10 statusTransitionAuditHook callers run default READ
 * COMMITTED. Race outcome: both writers read tail seq N → both insert N+1 →
 * loser P2002 on @@unique([organizationId, sequenceNumber]) → the onAudit
 * throw is swallowed (best-effort) AND the caller's Postgres tx is POISONED
 * (25P02) → Prisma's COMMIT becomes a silent ROLLBACK — the whole business
 * write (e.g. slip approval + invoice PAID) can be lost while the route
 * returns 200.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        organization: { findFirst: jest.fn(async () => ({ id: 'org-default' })) },
        auditLog: { findFirst: jest.fn(), create: jest.fn() },
        $transaction: jest.fn(),
    },
}));

const { auditLogger, AuditCategory, AuditSeverity } = require('../../middleware/audit-logger');

const AUDIT_CHAIN_LOCK_NS = 0x41554454; // "AUDT"

function buildTxMock(order) {
    return {
        $executeRaw: jest.fn(async () => { order.push('lock'); return 1; }),
        auditLog: {
            findFirst: jest.fn(async () => { order.push('tail'); return { currentHash: 'H-7', sequenceNumber: 7 }; }),
            create: jest.fn(async ({ data }) => { order.push('create'); return data; }),
        },
    };
}

const EVENT = {
    category: 'APPLICATION',
    action: 'TEST_TRANSITION',
    severity: 'INFO',
    actorId: 'actor-1',
    actorRole: 'admin',
    resourceType: 'APPLICATION',
    resourceId: 'APP-1',
    organizationId: 'org-1',
    metadata: { probe: true },
};

describe('logWithin takes the per-org audit-chain advisory lock INSIDE the caller tx', () => {
    test('lock is acquired strictly BEFORE the tail read and the insert, keyed (NS, hashtext(orgId))', async () => {
        const order = [];
        const tx = buildTxMock(order);

        await auditLogger.logWithin(EVENT, tx);

        // The lock statement executed exactly once…
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        // …as a tagged template carrying pg_advisory_xact_lock + the canonical key pair.
        const [strings, ...values] = tx.$executeRaw.mock.calls[0];
        expect(strings.join('x')).toMatch(/pg_advisory_xact_lock/);
        expect(values[0]).toBe(AUDIT_CHAIN_LOCK_NS);
        expect(values[1]).toBe('org-1');
        // …and strictly ordered: lock → read tail → insert.
        expect(order).toEqual(['lock', 'tail', 'create']);
    });

    test('the audit row still lands correctly through the tx (no behavior drift)', async () => {
        const order = [];
        const tx = buildTxMock(order);

        const row = await auditLogger.logWithin(EVENT, tx);

        expect(row.sequenceNumber).toBe(8); // tail 7 + 1
        expect(row.previousHash).toBe('H-7');
        expect(row.organizationId).toBe('org-1');
        expect(AuditCategory.APPLICATION).toBe('APPLICATION');
        expect(AuditSeverity.INFO).toBe('INFO');
    });
});
