'use strict';

/**
 * F-QA-01 (deep-qa 2026-09-06) — one registration used to write its three
 * audit rows in three separate locked transactions. With the app in Bangkok
 * and its database in Seoul, one round trip costs ~364 ms measured, so the
 * audit trail alone was ~15 crossings of a 5.6 s registration.
 *
 * logMany() writes a whole batch as ONE chain segment. The property that must
 * hold is that the chain is INDISTINGUISHABLE from N sequential log() calls:
 *   - one advisory lock, taken before the tail read (same key as log());
 *   - sequence numbers continuing contiguously from the persisted tail;
 *   - each row's previousHash === the PRECEDING row's currentHash;
 *   - the first row's previousHash === the tail hash that was read.
 * If any of those slip, verifyChain() breaks and the audit trail stops being
 * evidence.
 */

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        organization: { findUnique: jest.fn(async () => ({ id: 'org-default' })) },
        auditLog: { findFirst: jest.fn(), create: jest.fn(), createMany: jest.fn() },
        $transaction: jest.fn(),
    },
}));

const { auditLogger } = require('../../middleware/audit-logger');
const { prisma } = require('../../services/prisma-database');

const AUDIT_CHAIN_LOCK_NS = 0x41554454; // "AUDT"

function event(action, overrides = {}) {
    return {
        category: 'SECURITY',
        action,
        actorId: 'user-1',
        actorRole: 'HEALTH',
        resourceType: 'USER',
        resourceId: 'user-1',
        organizationId: 'org-1',
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
        metadata: { probe: true },
        ...overrides,
    };
}

/** A tx client that records the statement order and captures the batch. */
function buildTx(order, captured, tail = { currentHash: 'H-7', sequenceNumber: 7 }) {
    return {
        $executeRaw: jest.fn(async () => { order.push('lock'); return 1; }),
        auditLog: {
            findFirst: jest.fn(async () => { order.push('tail'); return tail; }),
            create: jest.fn(async ({ data }) => { order.push('create'); return data; }),
            createMany: jest.fn(async ({ data }) => {
                order.push('createMany');
                captured.rows = data;
                return { count: data.length };
            }),
        },
    };
}

describe('auditLogger.logMany — one locked transaction per batch, chain intact', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auditLogger._defaultOrgIdPromise = null;
    });

    test('three events → ONE transaction, ONE lock, ONE tail read, ONE insert', async () => {
        const order = [];
        const captured = {};
        prisma.$transaction.mockImplementation(async (cb) => cb(buildTx(order, captured)));

        const written = await auditLogger.logMany([
            event('REGISTER_SUCCESS', { category: 'AUTHENTICATION' }),
            event('CONSENT_GRANTED', { resourceType: 'CONSENT', resourceId: 'c1' }),
            event('CONSENT_GRANTED', { resourceType: 'CONSENT', resourceId: 'c2' }),
        ]);

        expect(written).toBe(3);
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['lock', 'tail', 'createMany']);
        expect(captured.rows).toHaveLength(3);
    });

    test('the lock is the SAME per-org key log() takes, and it precedes the tail read', async () => {
        const order = [];
        const captured = {};
        const tx = buildTx(order, captured);
        prisma.$transaction.mockImplementation(async (cb) => cb(tx));

        await auditLogger.logMany([event('A'), event('B')]);

        const [strings, ...values] = tx.$executeRaw.mock.calls[0];
        expect(strings.join('x')).toMatch(/pg_advisory_xact_lock/);
        expect(values[0]).toBe(AUDIT_CHAIN_LOCK_NS);
        expect(values[1]).toBe('org-1');
        expect(order.indexOf('lock')).toBeLessThan(order.indexOf('tail'));
    });

    test('sequence numbers continue from the persisted tail, contiguously', async () => {
        const order = [];
        const captured = {};
        prisma.$transaction.mockImplementation(async (cb) => cb(buildTx(order, captured)));

        await auditLogger.logMany([event('A'), event('B'), event('C')]);

        expect(captured.rows.map((r) => r.sequenceNumber)).toEqual([8, 9, 10]);
    });

    test('each row links to the previous one — the chain a following log() would have read', async () => {
        const order = [];
        const captured = {};
        prisma.$transaction.mockImplementation(async (cb) => cb(buildTx(order, captured)));

        await auditLogger.logMany([event('A'), event('B'), event('C')]);

        const [a, b, c] = captured.rows;
        expect(a.previousHash).toBe('H-7'); // the tail that was read
        expect(b.previousHash).toBe(a.currentHash);
        expect(c.previousHash).toBe(b.currentHash);
        // and every link is a real, distinct hash — not a placeholder
        expect(new Set([a.currentHash, b.currentHash, c.currentHash]).size).toBe(3);
        for (const row of captured.rows) {
            expect(row.currentHash).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    test('an empty chain starts at GENESIS, sequence 1', async () => {
        const order = [];
        const captured = {};
        prisma.$transaction.mockImplementation(async (cb) => cb(buildTx(order, captured, null)));

        await auditLogger.logMany([event('A'), event('B')]);

        expect(captured.rows[0].previousHash).toBe('GENESIS');
        expect(captured.rows.map((r) => r.sequenceNumber)).toEqual([1, 2]);
    });

    test('events for different tenants are written as separate per-org chains (ADR-014)', async () => {
        const order = [];
        const batches = [];
        prisma.$transaction.mockImplementation(async (cb) => {
            const captured = {};
            const res = await cb(buildTx(order, captured));
            batches.push(captured.rows);
            return res;
        });

        await auditLogger.logMany([
            event('A', { organizationId: 'org-1' }),
            event('B', { organizationId: 'org-2' }),
            event('C', { organizationId: 'org-1' }),
        ]);

        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
        expect(batches.map((rows) => rows.map((r) => r.organizationId))).toEqual([
            ['org-1', 'org-1'],
            ['org-2'],
        ]);
    });

    test('a single event still goes through log() — no behaviour fork for the common case', async () => {
        const order = [];
        const captured = {};
        prisma.$transaction.mockImplementation(async (cb) => cb(buildTx(order, captured)));

        const written = await auditLogger.logMany([event('SOLO')]);

        expect(written).toBe(1);
        expect(order).toEqual(['lock', 'tail', 'create']);
    });

    test('a failing audit sink never throws at the caller — it falls back to the console', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => { });
        prisma.$transaction.mockRejectedValue(new Error('db down'));

        await expect(auditLogger.logMany([event('A'), event('B')])).resolves.toBe(0);
        expect(spy).toHaveBeenCalledWith('[AUDIT_FALLBACK]', expect.objectContaining({
            batch: ['SECURITY:A', 'SECURITY:B'],
        }));
        spy.mockRestore();
    });

    test('nothing to write is not an error', async () => {
        await expect(auditLogger.logMany([])).resolves.toBe(0);
        await expect(auditLogger.logMany(null)).resolves.toBe(0);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
