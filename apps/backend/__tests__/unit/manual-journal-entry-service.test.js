/**
 * Tests for manual-journal-entry-service (B20-C, 2026-05-16).
 *
 * Anchors:
 *   - createDraftManualEntry validates lines (balanced, accountCode in CoA).
 *   - approveManualEntry enforces separation-of-duties (approver !== creator).
 *   - postManualEntry writes JournalEntry + JournalLine atomically.
 *   - rejectManualEntry records the reason and is terminal.
 */

'use strict';

const createPrismaMock = () => {
    const store = new Map();
    let counter = 0;
    const txStore = []; // history of tx callbacks for assertion

    const draftModel = {
        create: jest.fn(async ({ data }) => {
            counter += 1;
            const row = {
                id: `draft-${counter}`,
                ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
                approvedBy: null,
                approvedAt: null,
                postedAt: null,
                postedJournalEntryId: null,
                rejectedBy: null,
                rejectedAt: null,
                rejectionReason: null,
            };
            store.set(row.id, row);
            return row;
        }),
        findUnique: jest.fn(async ({ where: { id } }) => store.get(id) || null),
        findMany: jest.fn(async () => Array.from(store.values())),
        count: jest.fn(async () => store.size),
        update: jest.fn(async ({ where: { id }, data }) => {
            const existing = store.get(id);
            if (!existing) {
                throw new Error('not found');
            }
            const updated = { ...existing, ...data, updatedAt: new Date() };
            store.set(id, updated);
            return updated;
        }),
    };

    const journalEntryModel = {
        create: jest.fn(async ({ data, include: _include }) => {
            const entryId = `je-${Math.floor(Math.random() * 1000000)}`;
            const entry = {
                id: entryId,
                ...data,
                createdAt: new Date(),
            };
            if (data.lines?.create) {
                entry.lines = data.lines.create.map((line, i) => ({
                    id: `jl-${entryId}-${i}`,
                    entryId,
                    ...line,
                }));
                delete entry.lines.create;
            }
            return entry;
        }),
    };

    const prisma = {
        manualJournalEntryDraft: draftModel,
        journalEntry: journalEntryModel,
        $transaction: jest.fn(async (callback) => {
            txStore.push(callback);
            return callback({
                manualJournalEntryDraft: draftModel,
                journalEntry: journalEntryModel,
            });
        }),
    };

    return { prisma, store, txStore };
};

function loadServiceWithMocks(prismaObj) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaObj.prisma }));
    return require('../../services/manual-journal-entry-service');
}

const validBalancedLines = () => ([
    { lineNumber: 1, accountCode: '1110-001', debit: 100, credit: 0 },
    { lineNumber: 2, accountCode: '4110', debit: 0, credit: 100 },
]);

describe('[B20-C] manual-journal-entry-service', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('validateLines (pure helper)', () => {
        test('accepts a balanced 2-line entry', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            const result = service.validateLines(validBalancedLines());
            expect(result.totalDebit).toBe(100);
            expect(result.totalCredit).toBe(100);
            expect(result.normalizedLines).toHaveLength(2);
            // accountName auto-populated from CoA
            expect(result.normalizedLines[0].accountName).toBeTruthy();
        });

        test('rejects fewer than 2 lines', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            expect(() => service.validateLines([
                { accountCode: '1110-001', debit: 100, credit: 0 },
            ])).toThrow(/at least 2 entries/);
        });

        test('rejects unbalanced entries', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            expect(() => service.validateLines([
                { accountCode: '1110-001', debit: 100, credit: 0 },
                { accountCode: '4110', debit: 0, credit: 80 },
            ])).toThrow(/unbalanced/i);
        });

        test('rejects unknown accountCode', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            try {
                service.validateLines([
                    { accountCode: '9999-NOT-IN-COA', debit: 100, credit: 0 },
                    { accountCode: '4110', debit: 0, credit: 100 },
                ]);
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('UNKNOWN_ACCOUNT_CODE');
            }
        });

        test('rejects lines with both debit and credit > 0', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            expect(() => service.validateLines([
                { accountCode: '1110-001', debit: 50, credit: 50 },
                { accountCode: '4110', debit: 0, credit: 100 },
            ])).toThrow(/cannot have both debit and credit/);
        });

        test('rejects lines with neither debit nor credit', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            expect(() => service.validateLines([
                { accountCode: '1110-001', debit: 0, credit: 0 },
                { accountCode: '4110', debit: 0, credit: 100 },
            ])).toThrow(/at least one of debit\/credit/);
        });
    });

    describe('createDraftManualEntry', () => {
        test('persists DRAFT row with allocated draftNumber MJE-yyyy-nnnnnn', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'Bank charge for May',
                lines: validBalancedLines(),
                organizationId: 'org-1',
                actorId: 'user-creator',
                postingDate: '2026-05-15',
                reason: 'Bank monthly maintenance charge',
            });

            expect(draft.status).toBe('DRAFT');
            expect(draft.draftNumber).toMatch(/^MJE-\d{4}-\d{6}$/);
            expect(draft.totalDebit).toBe(100);
            expect(draft.totalCredit).toBe(100);
            expect(draft.createdBy).toBe('user-creator');
            expect(prismaObj.prisma.manualJournalEntryDraft.create).toHaveBeenCalledTimes(1);
        });

        test('rejects when required fields are missing', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            await expect(service.createDraftManualEntry({
                description: '',
                lines: validBalancedLines(),
                actorId: 'user-1',
                reason: 'Reason 12345',
            })).rejects.toThrow(/description is required/);

            await expect(service.createDraftManualEntry({
                description: 'desc',
                lines: validBalancedLines(),
                reason: 'reason123',
            })).rejects.toThrow(/actorId is required/);

            await expect(service.createDraftManualEntry({
                description: 'desc',
                lines: validBalancedLines(),
                actorId: 'u1',
            })).rejects.toThrow(/reason is required/);
        });
    });

    describe('approveManualEntry — separation of duties', () => {
        test('flips DRAFT → APPROVED when approver != creator', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'desc',
                lines: validBalancedLines(),
                actorId: 'user-creator',
                reason: 'business reason 12345',
            });

            const approved = await service.approveManualEntry(draft.id, {
                approverId: 'user-approver-different',
            });
            expect(approved.status).toBe('APPROVED');
            expect(approved.approvedBy).toBe('user-approver-different');
            expect(approved.approvedAt).toBeInstanceOf(Date);
        });

        test('REJECTS approve when approver === creator (SELF_APPROVAL_FORBIDDEN)', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'desc',
                lines: validBalancedLines(),
                actorId: 'user-creator',
                reason: 'business reason 12345',
            });

            try {
                await service.approveManualEntry(draft.id, { approverId: 'user-creator' });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('SELF_APPROVAL_FORBIDDEN');
            }
        });

        test('rejects approve from non-DRAFT state', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'desc',
                lines: validBalancedLines(),
                actorId: 'user-creator',
                reason: 'business reason 12345',
            });
            await service.approveManualEntry(draft.id, { approverId: 'user-approver' });

            // second approve attempt
            try {
                await service.approveManualEntry(draft.id, { approverId: 'user-another' });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('INVALID_STATE');
            }
        });
    });

    describe('postManualEntry — writes JournalEntry + JournalLine', () => {
        test('APPROVED → POSTED creates JournalEntry with [MANUAL] prefix', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'Accrual reversal',
                lines: validBalancedLines(),
                actorId: 'user-creator',
                reason: 'monthly accrual reversal',
            });
            await service.approveManualEntry(draft.id, { approverId: 'user-approver' });

            const result = await service.postManualEntry(draft.id, { actorId: 'user-approver' });

            // JournalEntry was created via the transaction
            expect(prismaObj.prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(prismaObj.prisma.journalEntry.create).toHaveBeenCalledTimes(1);
            const createCall = prismaObj.prisma.journalEntry.create.mock.calls[0][0];
            expect(createCall.data.description).toMatch(/^\[MANUAL\]/);
            expect(createCall.data.totalDebit).toBe(100);
            expect(createCall.data.totalCredit).toBe(100);
            expect(createCall.data.lines.create).toHaveLength(2);

            // Draft status updated to POSTED with journalEntryId back-pointer
            expect(result.draft.status).toBe('POSTED');
            expect(result.draft.postedJournalEntryId).toBeTruthy();
            expect(result.entry.id).toBeTruthy();
        });

        test('rejects post from non-APPROVED state', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'desc',
                lines: validBalancedLines(),
                actorId: 'u1',
                reason: 'business reason 12345',
            });
            try {
                await service.postManualEntry(draft.id);
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('INVALID_STATE');
            }
        });

        test('POSTED is terminal — second post fails INVALID_STATE', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            const draft = await service.createDraftManualEntry({
                description: 'desc', lines: validBalancedLines(),
                actorId: 'u1', reason: 'business reason 12345',
            });
            await service.approveManualEntry(draft.id, { approverId: 'u2' });
            await service.postManualEntry(draft.id);

            try {
                await service.postManualEntry(draft.id);
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('INVALID_STATE');
            }
        });
    });

    describe('rejectManualEntry — records reason', () => {
        test('DRAFT → REJECTED records rejectionReason + rejectedBy + rejectedAt', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'desc', lines: validBalancedLines(),
                actorId: 'u1', reason: 'business reason 12345',
            });
            const rejected = await service.rejectManualEntry(draft.id, {
                reason: 'Wrong account selected by maker',
                rejectorId: 'user-rejecter',
            });
            expect(rejected.status).toBe('REJECTED');
            expect(rejected.rejectionReason).toBe('Wrong account selected by maker');
            expect(rejected.rejectedBy).toBe('user-rejecter');
            expect(rejected.rejectedAt).toBeInstanceOf(Date);
        });

        test('APPROVED → REJECTED is allowed (last-line defense)', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);

            const draft = await service.createDraftManualEntry({
                description: 'desc', lines: validBalancedLines(),
                actorId: 'u1', reason: 'business reason 12345',
            });
            await service.approveManualEntry(draft.id, { approverId: 'u2' });

            const rejected = await service.rejectManualEntry(draft.id, {
                reason: 'CFO veto after approval',
                rejectorId: 'user-cfo',
            });
            expect(rejected.status).toBe('REJECTED');
        });

        test('rejects short rejection reason (< 10 chars)', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            const draft = await service.createDraftManualEntry({
                description: 'desc', lines: validBalancedLines(),
                actorId: 'u1', reason: 'business reason 12345',
            });
            await expect(service.rejectManualEntry(draft.id, {
                reason: 'short',
                rejectorId: 'u-rej',
            })).rejects.toThrow(/at least 10 characters/);
        });

        test('cannot reject from POSTED (terminal)', async () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            const draft = await service.createDraftManualEntry({
                description: 'desc', lines: validBalancedLines(),
                actorId: 'u1', reason: 'business reason 12345',
            });
            await service.approveManualEntry(draft.id, { approverId: 'u2' });
            await service.postManualEntry(draft.id);

            try {
                await service.rejectManualEntry(draft.id, {
                    reason: 'too late to reject',
                    rejectorId: 'u3',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('INVALID_STATE');
            }
        });
    });

    describe('STATUS + ACTIONS exports', () => {
        test('exposes the canonical status state-machine', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            expect(service.STATUS).toEqual({
                DRAFT: 'DRAFT',
                APPROVED: 'APPROVED',
                POSTED: 'POSTED',
                REJECTED: 'REJECTED',
            });
        });
        test('exposes ACTIONS for audit-logger', () => {
            const prismaObj = createPrismaMock();
            const service = loadServiceWithMocks(prismaObj);
            expect(service.ACTIONS.POSTED).toBe('MANUAL_JE_POSTED');
            expect(service.ACTIONS.APPROVED).toBe('MANUAL_JE_APPROVED');
            expect(service.ACTIONS.REJECTED).toBe('MANUAL_JE_REJECTED');
            expect(service.ACTIONS.DRAFT_CREATED).toBe('MANUAL_JE_DRAFT_CREATED');
        });
    });
});
