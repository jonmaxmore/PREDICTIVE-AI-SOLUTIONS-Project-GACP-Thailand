/**
 * Audit gap #14 keying follow-up — v3 HMAC-keyed hash chain.
 *
 * Today's audit `currentHash` is an UNKEYED sha256 over the payload, so anyone
 * who can write an `audit_logs` row can recompute a matching hash and forge or
 * edit the chain undetectably (audit-logger.js:92 calls out keying as the
 * pairing follow-up). v3 hashes the SAME wide v2 payload but with HMAC-SHA256
 * under a key that lives ONLY in env (derived from ENCRYPTION_KEY) — NOT in the
 * table — so a forged/edited row cannot be re-sealed without the key.
 *
 * The rollout is flag-gated (AUDIT_HASH_HMAC='true') and DEFAULT-OFF: with the
 * flag unset, writes stay v2 (zero behaviour change). verifyChain recomputes
 * v3 → v2 → v1 so legacy rows keep verifying green across the cut-over.
 *
 * RED (pre-impl): generateHashV3/_auditHashKey do not exist (test a throws), and
 * with the flag ON writes still produce a v2 sha256 hash, so the "rows do NOT
 * verify under a different key" proof (test c') FAILS — a v2 sha256 hash is
 * key-independent and verifies regardless of ENCRYPTION_KEY.
 */

'use strict';

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

const KEY_A = 'test-encryption-key-AAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'test-encryption-key-BBBBBBBBBBBBBBBBBBBBBBBB';

describe('audit gap #14 keying — v3 HMAC hash chain', () => {
    const savedEnv = {};
    beforeEach(() => {
        jest.clearAllMocks();
        savedEnv.flag = process.env.AUDIT_HASH_HMAC;
        savedEnv.enc = process.env.ENCRYPTION_KEY;
        savedEnv.key = process.env.AUDIT_HASH_KEY;
        delete process.env.AUDIT_HASH_HMAC;
        delete process.env.AUDIT_HASH_KEY;
        process.env.ENCRYPTION_KEY = KEY_A;
    });
    afterEach(() => {
        savedEnv.flag === undefined ? delete process.env.AUDIT_HASH_HMAC : (process.env.AUDIT_HASH_HMAC = savedEnv.flag);
        savedEnv.enc === undefined ? delete process.env.ENCRYPTION_KEY : (process.env.ENCRYPTION_KEY = savedEnv.enc);
        savedEnv.key === undefined ? delete process.env.AUDIT_HASH_KEY : (process.env.AUDIT_HASH_KEY = savedEnv.key);
    });

    // (a) The keyed hasher exists, produces a 64-hex digest, differs from the
    //     unkeyed sha256, and CHANGES when the key changes (proves it is keyed).
    test('generateHashV3 is keyed: differs from generateHash and depends on the key', () => {
        const { auditLogger } = loadLogger(createPrismaMock());
        const payload = { a: 1, b: 'x' };
        const v3 = auditLogger.generateHashV3(payload, 'PREV');
        const v2 = auditLogger.generateHash(payload, 'PREV');
        expect(v3).toMatch(/^[a-f0-9]{64}$/);
        expect(v3).not.toBe(v2);

        // Same logger instance caches KEY_A; a fresh instance under KEY_B must differ.
        process.env.ENCRYPTION_KEY = KEY_B;
        const { auditLogger: loggerB } = loadLogger(createPrismaMock());
        expect(loggerB.generateHashV3(payload, 'PREV')).not.toBe(v3);
    });

    // (b) Flag OFF → writes stay v2 (unchanged), and the chain verifies green.
    test('flag OFF: chain is written v2 and verifies GREEN (behaviour unchanged)', async () => {
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);
        const row1 = await writeRow(auditLogger, BASE_EVENT, { previous: null });
        // v2 currentHash == the unkeyed recompute; NOT the keyed one.
        expect(row1.currentHash).toBe(auditLogger._expectedHashForRow(
            { ...row1, createdAt: row1.createdAt }, auditLogger.getIsoTimestamp(row1.createdAt), 2));

        prismaMock.auditLog.findMany.mockResolvedValue([row1]);
        const result = await auditLogger.verifyChain({ organizationId: 'org-A' });
        expect(result.verified).toBe(true);
        expect(result.hashMismatches).toBe(0);
    });

    // (c) Flag ON → chain is written v3 and verifies GREEN under the right key.
    test('flag ON: chain is written v3 and verifies GREEN', async () => {
        process.env.AUDIT_HASH_HMAC = 'true';
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);
        const row1 = await writeRow(auditLogger, BASE_EVENT, { previous: null });
        const row2 = await writeRow(
            auditLogger,
            { ...BASE_EVENT, action: 'RECEIPT_ISSUED', metadata: { receiptNo: 'R-1' } },
            { previous: { currentHash: row1.currentHash, sequenceNumber: row1.sequenceNumber } },
        );

        // The v3 row does NOT match the unkeyed v2 recompute (proves HMAC was used).
        expect(row1.currentHash).not.toBe(auditLogger._expectedHashForRow(
            { ...row1, createdAt: row1.createdAt }, auditLogger.getIsoTimestamp(row1.createdAt), 2));

        prismaMock.auditLog.findMany.mockResolvedValue([row1, row2]);
        const result = await auditLogger.verifyChain({ organizationId: 'org-A' });
        expect(result.verified).toBe(true);
        expect(result.hashMismatches).toBe(0);
        expect(result.linkMismatches).toBe(0);
    });

    // (c') THE KEYING PROOF: v3 rows written under KEY_A do NOT verify when the
    //      verifier only has KEY_B — an unkeyed sha256 would verify regardless.
    test('flag ON: v3 rows do NOT verify under a different key (tamper-EVIDENT)', async () => {
        process.env.AUDIT_HASH_HMAC = 'true';
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);
        const row1 = await writeRow(auditLogger, BASE_EVENT, { previous: null });
        prismaMock.auditLog.findMany.mockResolvedValue([row1]);

        // Reload the logger with a DIFFERENT key; the same persisted rows must fail.
        process.env.ENCRYPTION_KEY = KEY_B;
        const prismaMockB = createPrismaMock();
        const { auditLogger: verifierB } = loadLogger(prismaMockB);
        prismaMockB.auditLog.findMany.mockResolvedValue([row1]);
        const result = await verifierB.verifyChain({ organizationId: 'org-A' });

        expect(result.verified).toBe(false);
        expect(result.hashMismatches).toBe(1);
    });

    // (d) Flag ON → mutating a hashed field after insert is detected (HASH_MISMATCH).
    test('flag ON: mutating a v3 row AFTER insert is flagged TAMPERED', async () => {
        process.env.AUDIT_HASH_HMAC = 'true';
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);
        const row = await writeRow(auditLogger, BASE_EVENT, { previous: null });

        const tampered = { ...row, result: 'FAILURE', actorRole: 'ADMIN' };
        prismaMock.auditLog.findMany.mockResolvedValue([tampered]);
        const result = await auditLogger.verifyChain({ organizationId: 'org-A' });

        expect(result.verified).toBe(false);
        expect(result.hashMismatches).toBe(1);
        expect(result.corruptedLogs).toEqual([
            expect.objectContaining({ type: 'HASH_MISMATCH', logId: row.logId }),
        ]);
    });

    // (f) MIXED chain: a v2 row (flag off) then a v3 row (flag on) both verify —
    //     enabling v3 mid-history does not false-flag the earlier v2 rows.
    test('mixed v2→v3 chain verifies GREEN (fallback across the cut-over)', async () => {
        const prismaMock = createPrismaMock();
        const { auditLogger } = loadLogger(prismaMock);

        // row1 written under v2 (flag off)
        const row1 = await writeRow(auditLogger, BASE_EVENT, { previous: null });
        // flip flag ON, row2 written under v3
        process.env.AUDIT_HASH_HMAC = 'true';
        const row2 = await writeRow(
            auditLogger,
            { ...BASE_EVENT, action: 'RECEIPT_ISSUED', metadata: { receiptNo: 'R-2' } },
            { previous: { currentHash: row1.currentHash, sequenceNumber: row1.sequenceNumber } },
        );

        prismaMock.auditLog.findMany.mockResolvedValue([row1, row2]);
        const result = await auditLogger.verifyChain({ organizationId: 'org-A' });
        expect(result.verified).toBe(true);
        expect(result.hashMismatches).toBe(0);
        expect(result.linkMismatches).toBe(0);
    });
});
