/**
 * PIN, not a fix: the code already passed `tx`, so this suite was green from birth.
 * That it can fail was shown by mutation (tx → prisma at services/pdpa-erasure-service.js
 * clearPrecheckText call, then reverted): evidence/precheck-followups/6-owed-tests/
 * erasure-tx-mutation-red.txt.
 *
 * Task 10 N2 (owed test): executeErasure clears the document pre-check text with
 * the erasure's OWN transaction client, not the global prisma client.
 *
 * Why it matters: the clear (DocumentPrecheck.extractedText + every flag's
 * evidenceSnippet) must commit or roll back with the rest of the erasure. Handed
 * the global client instead, a later step that throws would roll the user back
 * to un-erased while the page text was already gone — or, the other way round,
 * the clear would run outside the lock the transaction holds.
 *
 * The transaction client here is a DIFFERENT object from `prisma` (in the older
 * pdpa-erasure-service.test.js they are the same object, so that suite cannot
 * tell the two apart); clear-text.js is replaced by a spy.
 */

'use strict';

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    AuditCategory: { SECURITY: 'SECURITY' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { USER: 'USER' },
}));
jest.mock('../../services/notification-fanout-service', () => ({ send: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock('../../services/user-lookup-service', () => ({ findUserByHealthIdSecurely: jest.fn().mockResolvedValue(null) }));

const mockClearPrecheckText = jest.fn(async () => 3);
jest.mock('../../services/document-precheck/clear-text', () => ({
    clearPrecheckText: (...args) => mockClearPrecheckText(...args),
}));

jest.mock('../../services/prisma-database', () => {
    const models = () => ({
        user: { findUnique: jest.fn(), findFirst: jest.fn(async () => null), update: jest.fn(async () => ({ id: 'user-abc', privacySettings: {} })), findMany: jest.fn(async () => []) },
        application: { findMany: jest.fn(async () => []), update: jest.fn() },
        certificate: { findMany: jest.fn(async () => []), update: jest.fn() },
        entityMembership: { findMany: jest.fn(async () => []) },
        entity: { update: jest.fn() },
        applicationDraft: { deleteMany: jest.fn(async () => ({ count: 0 })) },
        notification: { deleteMany: jest.fn(async () => ({ count: 0 })) },
        documentPrecheck: { updateMany: jest.fn(), findMany: jest.fn(async () => []) },
        documentPrecheckFlag: { updateMany: jest.fn(), create: jest.fn() },
    });
    const global = models();
    const mockTx = { ...models(), __isTransactionClient: true };
    global.user.findUnique.mockResolvedValue({ canonicalId: 'canonical-12345', organizationId: 'org-1', legalHold: false });
    mockTx.user.findUnique.mockResolvedValue({ canonicalId: 'canonical-12345', organizationId: 'org-1', legalHold: false });
    return {
        prisma: { ...global, $transaction: jest.fn(async (cb) => cb(mockTx)) },
        __mockTx: mockTx,
    };
});

const { prisma, __mockTx: tx } = require('../../services/prisma-database');
const pdpaErasureService = require('../../services/pdpa-erasure-service');

describe('executeErasure → clearPrecheckText', () => {
    beforeEach(() => mockClearPrecheckText.mockClear());

    it('is called once, with the transaction client and the erased user id', async () => {
        const summary = await pdpaErasureService.executeErasure({ userId: 'user-abc', actorId: 'user-abc' });
        expect(mockClearPrecheckText).toHaveBeenCalledTimes(1);
        const [client, userId] = mockClearPrecheckText.mock.calls[0];
        expect(client).toBe(tx);
        expect(client).not.toBe(prisma);
        expect(userId).toBe('user-abc');
        expect(summary.anonymized.precheckTexts).toBe(3);
    });

    it('a failing clear fails the erasure (it is inside the transaction, not best-effort)', async () => {
        mockClearPrecheckText.mockRejectedValueOnce(new Error('db gone'));
        await expect(pdpaErasureService.executeErasure({ userId: 'user-abc', actorId: 'user-abc' })).rejects.toThrow('db gone');
    });
});
