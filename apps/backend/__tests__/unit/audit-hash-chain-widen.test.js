/**
 * Audit gap #14 (A) — the hash chain must cover the tamper-relevant PERSISTED
 * columns, not just a skeleton.
 *
 * Before this fix `buildHashPayload` hashed only
 *   { logId, sequenceNumber, category, action, actorId, resourceType,
 *     resourceId, timestamp }
 * so a privileged DB write could mutate metadata / result / actorRole /
 * errorCode / severity / actorType / actorEmail / ipAddress / userAgent /
 * errorMessage of an already-written row WITHOUT breaking the chain —
 * verifyChain still reported verified:true over forged evidence
 * (carpet-bomb-inversion-audit-2026-07-06 #14).
 *
 * The fix VERSIONS the payload: NEW rows are hashed under v2 (wide payload);
 * verifyChain recomputes each row under v2 first and falls back to the legacy
 * v1 narrow payload, so pre-cutover rows keep verifying green (no schema
 * column, no history re-key) while any post-write mutation of a v2 field is
 * detected as a HASH_MISMATCH.
 *
 * RED (pre-fix): the "mutating a v2 field is detected" cases FAIL because the
 * narrow v1 hash ignores those columns, so verifyChain stays verified:true.
 */

'use strict';

const crypto = require('crypto');

const createPrismaMock = () => {
    const mock = {
        auditLog: {
            findFirst: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
        },
        organization: {
            findUnique: jest.fn().mockResolvedValue({ id: 'default-org-id' }),
        },
        $disconnect: jest.fn(),
        $executeRaw: jest.fn().mockResolvedValue(1),
    };
    mock.$transaction = jest.fn(async (cb) => cb(mock));
    return mock;
};

function loadLogger(prismaMock) {
    jest.resetModules();
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return require('../../middleware/audit-logger');
}

// Write one row through log() and return the exact object persisted to
// auditLog.create (the row the DB would store + read back).
async function writeRow(auditLogger, event, { previous = null } = {}) {
    const prismaMock = auditLogger.prisma;
    prismaMock.auditLog.findFirst.mockResolvedValueOnce(previous);
    let persisted;
    prismaMock.auditLog.create.mockImplementationOnce(async ({ data }) => {
        persisted = { id: `row-${data.sequenceNumber}`, ...data };
        return persisted;
    });
    await auditLogger.log(event);
    return persisted;
}

const BASE_EVENT = {
    category: 'PAYMENT',
    action: 'PAYMENT_SLIP_APPROVED',
    severity: 'INFO',
    actorId: 'acct-1',
    actorType: 'USER',
    actorEmail: 'acct@example.com',
    actorRole: 'ACCOUNT',
    resourceType: 'PAYMENT',
    resourceId: 'slip-1',
    ipAddress: '10.0.0.1',
    userAgent: 'Mozilla/5.0',
    metadata: { amount: 5535, invoiceId: 'inv-1' },
    result: 'SUCCESS',
    errorCode: null,
    errorMessage: null,
    organizationId: 'org-A',
};

describe('audit gap #14 (A) — widened, versioned hash chain', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Fields that live ONLY in the v2 payload (not the legacy v1 skeleton).
    // Mutating any of them after insert must break the chain.
    const V2_TAMPERS = [
        ['metadata', (row) => ({ ...row, metadata: JSON.stringify({ amount: 999999, invoiceId: 'inv-1' }) })],
        ['result', (row) => ({ ...row, result: 'FAILURE' })],
        ['actorRole', (row) => ({ ...row, actorRole: 'ADMIN' })],
        ['errorCode', (row) => ({ ...row, errorCode: 'FORGED' })],
        ['severity', (row) => ({ ...row, severity: 'CRITICAL' })],
        ['actorType', (row) => ({ ...row, actorType: 'ADMIN' })],
        ['actorEmail', (row) => ({ ...row, actorEmail: 'attacker@evil.test' })],
        ['ipAddress', (row) => ({ ...row, ipAddress: '9.9.9.9' })],
        ['errorMessage', (row) => ({ ...row, errorMessage: 'rewritten' })],
    ];

    test.each(V2_TAMPERS)(
        'mutating %s AFTER insert makes verifyChain flag the v2 row TAMPERED',
        async (field, mutate) => {
            const prismaMock = createPrismaMock();
            const { auditLogger } = loadLogger(prismaMock);

            const row = await writeRow(auditLogger, BASE_EVENT, { previous: null });
            expect(row.currentHash).toMatch(/^[a-f0-9]{64}$/);

            // Simulate a privileged DB write editing the persisted column.
            const tampered = mutate(row);
            prismaMock.auditLog.findMany.mockResolvedValue([tampered]);

            const result = await auditLogger.verifyChain({ organizationId: 'org-A' });

            expect(result.verified).toBe(false);
            expect(result.hashMismatches).toBe(1);
            expect(result.corruptedLogs).toEqual([
                expect.objectContaining({ type: 'HASH_MISMATCH', logId: row.logId }),
            ]);
        },
    );

    test('an untampered v2 chain verifies GREEN (write→verify round-trip)', async () => {
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);

        const row1 = await writeRow(auditLogger, BASE_EVENT, { previous: null });
        const row2 = await writeRow(
            auditLogger,
            { ...BASE_EVENT, action: 'RECEIPT_ISSUED', metadata: { receiptNo: 'R-1' } },
            { previous: { currentHash: row1.currentHash, sequenceNumber: row1.sequenceNumber } },
        );

        prismaMock.auditLog.findMany.mockResolvedValue([row1, row2]);
        const result = await auditLogger.verifyChain({ organizationId: 'org-A' });

        expect(result.verified).toBe(true);
        expect(result.hashMismatches).toBe(0);
        expect(result.linkMismatches).toBe(0);
    });

    test('a LEGACY v1 row (narrow hash) still verifies GREEN — no false-tamper on history', async () => {
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);

        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        // Reconstruct the EXACT legacy v1 hash independently of buildHashPayload
        // (v1 formula: sha256 of JSON.stringify({ ...narrowPayload, previousHash })).
        const legacyRow = {
            logId: 'LOG-LEGACY-1',
            sequenceNumber: 1,
            category: 'APPLICATION',
            action: 'DOC_APPROVED',
            actorId: 'rev-1',
            resourceType: 'APPLICATION',
            resourceId: 'app-1',
            // v2-only columns are present in the DB row but were NOT hashed at v1
            // write time — verifyChain must not treat them as tamper for legacy rows.
            severity: 'INFO',
            actorType: 'USER',
            actorEmail: null,
            actorRole: 'DOCUMENT_REVIEWER',
            ipAddress: 'unknown',
            userAgent: 'unknown',
            metadata: JSON.stringify({ fromStatus: 'ASSIGNED_FOR_REVIEW', toStatus: 'DOC_APPROVED' }),
            result: 'SUCCESS',
            errorCode: null,
            errorMessage: null,
            previousHash: 'GENESIS',
            createdAt,
        };
        const v1Payload = {
            logId: legacyRow.logId,
            sequenceNumber: legacyRow.sequenceNumber,
            category: legacyRow.category,
            action: legacyRow.action,
            actorId: legacyRow.actorId,
            resourceType: legacyRow.resourceType,
            resourceId: legacyRow.resourceId,
            timestamp: createdAt.toISOString(),
        };
        legacyRow.currentHash = crypto
            .createHash('sha256')
            .update(JSON.stringify({ ...v1Payload, previousHash: 'GENESIS' }))
            .digest('hex');

        prismaMock.auditLog.findMany.mockResolvedValue([legacyRow]);
        const result = await auditLogger.verifyChain({ organizationId: 'org-A' });

        expect(result.verified).toBe(true);
        expect(result.hashMismatches).toBe(0);
        expect(result.linkMismatches).toBe(0);
    });

    test('a windowed verify (startSequence > 1) does not false-flag the first row link', async () => {
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);

        // Row whose previousHash points to a row OUTSIDE the window.
        const row = await writeRow(
            auditLogger,
            BASE_EVENT,
            { previous: { currentHash: 'PARENT-OUTSIDE-WINDOW', sequenceNumber: 41 } },
        );
        expect(row.sequenceNumber).toBe(42);
        expect(row.previousHash).toBe('PARENT-OUTSIDE-WINDOW');

        prismaMock.auditLog.findMany.mockResolvedValue([row]);
        const result = await auditLogger.verifyChain({ organizationId: 'org-A', startSequence: 42 });

        // Content hash still validated; the boundary link is anchored, not GENESIS.
        expect(result.verified).toBe(true);
        expect(result.linkMismatches).toBe(0);
        expect(result.hashMismatches).toBe(0);
    });
});
