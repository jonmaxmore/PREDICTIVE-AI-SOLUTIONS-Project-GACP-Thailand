/**
 * B3 (PDPA-LEAK cluster, carpet-bomb-inversion-audit-2026-07-06) —
 * audit_logs.metadata persists req.query verbatim → a reviewer searching
 * applicants by citizen ID (GET /provider/applications?q=<13-digit>) writes the
 * national ID cleartext into the unhashed, unencrypted `audit_logs.metadata`
 * column (audit-middleware.js:57 `query: req.query` → audit-logger.js
 * _buildAuditRow:248 `metadata: JSON.stringify(metadata)`), from where a DB dump
 * (and the admin CSV export) recovers it.
 *
 * Fix: mask every standalone 13-digit run in the metadata VALUES at the
 * _buildAuditRow chokepoint (covers ALL metadata sources — router audit
 * middleware, logAction adapter, statusTransitionAuditHook — not just the search
 * query). metadata is NOT part of the audit hash chain (buildHashPayload excludes
 * it), so masking is chain-safe. The walker recurses nested objects/arrays (the
 * query can be nested) and leaves non-plain objects (Date) untouched so
 * JSON.stringify keeps its existing serialization.
 */

const ID = '1100000000008';
const MASKED = '1-XXXX-XXXX-X-0008'; // maskThaiId('1100000000008')
const RUN_13 = /(?<!\d)\d{13}(?!\d)/;

function loadLogger() {
    jest.resetModules();
    const prismaMock = {
        auditLog: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
        organization: { findUnique: jest.fn().mockResolvedValue({ id: 'default-org-id' }) },
        $executeRaw: jest.fn(), $transaction: jest.fn(), $disconnect: jest.fn(),
    };
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return require('../../middleware/audit-logger').auditLogger;
}

function buildRow(auditLogger, metadata) {
    return auditLogger._buildAuditRow({
        event: {
            category: 'APPLICATION', action: 'VIEW', actorId: 'u-1',
            resourceType: 'APPLICATION', resourceId: 'app-1', metadata,
        },
        resolvedOrgId: 'org-1', previousHash: 'PARENT-HASH', sequenceNumber: 5,
    });
}

describe('[B3] _buildAuditRow masks national IDs in metadata', () => {
    it('masks a 13-digit ID carried in a NESTED query object (the applicant-search leak)', () => {
        const auditLogger = loadLogger();
        const { data } = buildRow(auditLogger, {
            method: 'GET',
            url: `/api/provider/applications?q=${ID}`,
            query: { q: ID, page: '1' },
            bodyKeys: [],
        });
        const meta = JSON.parse(data.metadata);
        // Nested value masked, non-ID values untouched.
        expect(meta.query.q).toBe(MASKED);
        expect(meta.query.page).toBe('1');
        // The 13-digit run masked in the url string too.
        expect(meta.url).not.toMatch(RUN_13);
        // The whole persisted metadata blob has no recoverable 13-digit run.
        expect(data.metadata).not.toMatch(RUN_13);
        expect(data.metadata).not.toContain(ID);
    });

    it('masks IDs in top-level strings and inside arrays', () => {
        const auditLogger = loadLogger();
        const { data } = buildRow(auditLogger, {
            note: `applicant ${ID} flagged`,
            ids: [ID, 'not-an-id', '0105561234560'],
        });
        const meta = JSON.parse(data.metadata);
        expect(meta.note).toBe(`applicant ${MASKED} flagged`);
        expect(meta.ids[0]).toBe(MASKED);
        expect(meta.ids[1]).toBe('not-an-id');
        expect(meta.ids[2]).toBe('0-XXXX-XXXX-X-4560'); // maskThaiId('0105561234560')
        expect(data.metadata).not.toMatch(RUN_13);
    });

    it('leaves non-ID metadata (numbers, 10-digit phone, dates) intact', () => {
        const auditLogger = loadLogger();
        const when = new Date('2026-07-06T00:00:00.000Z');
        const { data } = buildRow(auditLogger, {
            statusCode: 200,
            phone: '0812345678', // 10 digits — not masked
            at: when, // Date — preserved as ISO (not corrupted into {})
        });
        const meta = JSON.parse(data.metadata);
        expect(meta.statusCode).toBe(200);
        expect(meta.phone).toBe('0812345678');
        expect(meta.at).toBe(when.toISOString());
    });

    it('is chain-safe — the MASKED metadata is exactly what feeds currentHash (v2, tamper-evident)', () => {
        const auditLogger = loadLogger();
        const { data } = buildRow(auditLogger, { query: { q: ID } });
        // Audit gap #14: metadata is now FOLDED INTO the hash (v2 wide payload),
        // so a post-write edit of the metadata column breaks the chain. "Chain-
        // safe" now means DETERMINISTIC: the value hashed is the same masked
        // string that is persisted (data.metadata), so verifyChain recomputes it
        // consistently. Recompute over the FULL persisted row (as verifyChain
        // does) and assert it matches currentHash.
        const expected = auditLogger.generateHash(auditLogger.buildHashPayload({
            logId: data.logId,
            sequenceNumber: data.sequenceNumber,
            category: data.category,
            action: data.action,
            actorId: data.actorId,
            resourceType: data.resourceType,
            resourceId: data.resourceId,
            timestamp: auditLogger.getIsoTimestamp(data.createdAt),
            severity: data.severity,
            actorType: data.actorType,
            actorEmail: data.actorEmail,
            actorRole: data.actorRole,
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
            metadata: data.metadata, // the persisted MASKED string
            result: data.result,
            errorCode: data.errorCode,
            errorMessage: data.errorMessage,
        }), 'PARENT-HASH');
        expect(data.currentHash).toBe(expected);
        // And the hashed metadata carries the mask, not the raw ID — so the
        // tamper-evidence covers the PII-safe value.
        expect(data.metadata).not.toContain(ID);
    });

    it('handles empty / non-object metadata without crashing', () => {
        const auditLogger = loadLogger();
        expect(() => buildRow(auditLogger, {})).not.toThrow();
        expect(() => buildRow(auditLogger, undefined)).not.toThrow();
        expect(JSON.parse(buildRow(auditLogger, {}).data.metadata)).toEqual({});
    });
});
