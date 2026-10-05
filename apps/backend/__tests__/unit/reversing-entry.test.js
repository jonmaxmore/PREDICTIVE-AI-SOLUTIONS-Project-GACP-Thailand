/**
 * Tests for journal-entry-service.recordReversingEntry (Iter 24, 2026-05-16).
 *
 * Verifies the generic reversing-entry primitive required by TFRS for NPAEs
 * ch.18 immutability + ป.รัษฎากร ม.86/10 (ใบลดหนี้ / adjustment audit trail):
 *   - Auto-swap: every debit becomes a credit and vice versa, account
 *     code / name / issuer / taxableAmount are preserved.
 *   - Idempotency: calling twice on the same originalEntryId returns
 *     `{ skipped: true, reason: 'ALREADY_REVERSED', reversingEntryId }`.
 *   - Validation: original must exist; reason is required.
 *   - $transaction support: a caller-supplied tx is threaded through
 *     persistEntry + marker write.
 *   - Partial reversal: customLines override the auto-swap.
 *   - Net-to-zero invariant: original.lines + reversal.lines net to zero
 *     on every account (sum(debit) === sum(credit)).
 *   - Audit log: REVERSING_ENTRY_POSTED is emitted via the audit-logger.
 */

'use strict';

// The audit-logger module touches prisma + tenant context on require — mock
// it so the journal service can `require('../middleware/audit-logger')`
// inside recordReversingEntry without bootstrapping the whole audit stack.
jest.mock('../../middleware/audit-logger', () => {
    const AuditCategory = { PAYMENT: 'PAYMENT' };
    const AuditSeverity = { INFO: 'INFO', WARNING: 'WARNING' };
    const ResourceType = { INVOICE: 'INVOICE' };
    return {
        auditLogger: { log: jest.fn().mockResolvedValue(undefined) },
        AuditCategory,
        AuditSeverity,
        ResourceType,
    };
});

const {
    recordReversingEntry,
    buildReversalLines,
    ACCOUNTS,
    ISSUER,
} = require('../../services/journal-entry-service');
const { auditLogger } = require('../../middleware/audit-logger');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a mock prisma + tx pair that mirrors a posted PLATFORM payment entry
 * (Dr Cash / Cr Revenue / Cr Output VAT) for a 535-THB invoice. The mock
 * captures the create call for assertions and supports a configurable
 * "already reversed" state via `markerEntryId`.
 */
function makeOriginalEntry({ id = 'je-original-001', reference = 'TAX-PRD-2026-000100', markerEntryId = null, invoiceId = 'inv-platform-001' } = {}) {
    return {
        id,
        entryDate: new Date('2026-05-16T10:00:00Z'),
        reference,
        invoiceId,
        organizationId: 'org-1',
        description: `Payment received for invoice ${reference}`,
        totalDebit: 535,
        totalCredit: 535,
        isDeleted: false,
        lines: [
            {
                id: 'jl-original-001',
                lineNumber: 1,
                accountCode: ACCOUNTS.CASH_BANK.code,
                accountName: ACCOUNTS.CASH_BANK.name,
                debit: 535,
                credit: 0,
                issuer: ISSUER.PLATFORM,
                taxableAmount: null,
                metadata: markerEntryId
                    ? { memo: 'Cash received', kind: 'PAYMENT', reversedByEntryId: markerEntryId }
                    : { memo: 'Cash received', kind: 'PAYMENT' },
            },
            {
                id: 'jl-original-002',
                lineNumber: 2,
                accountCode: ACCOUNTS.REVENUE_PLATFORM_FEE.code,
                accountName: ACCOUNTS.REVENUE_PLATFORM_FEE.name,
                debit: 0,
                credit: 500,
                issuer: ISSUER.PLATFORM,
                taxableAmount: 500,
                metadata: { memo: 'Platform service fee', kind: 'PAYMENT' },
            },
            {
                id: 'jl-original-003',
                lineNumber: 3,
                accountCode: ACCOUNTS.VAT_PAYABLE_OUTPUT.code,
                accountName: ACCOUNTS.VAT_PAYABLE_OUTPUT.name,
                debit: 0,
                credit: 35,
                issuer: ISSUER.PLATFORM,
                taxableAmount: null,
                metadata: { memo: 'Output VAT 7%', kind: 'PAYMENT' },
            },
        ],
    };
}

function makeTxMock({ originalEntry, existingReversal = null, reversalRowId = 'je-reversal-001' } = {}) {
    const reversalCreateCalls = [];
    const findUniqueCalls = [];
    const findFirstCalls = [];
    const updateCalls = [];

    const tx = {
        journalEntry: {
            findUnique: jest.fn().mockImplementation(async (args) => {
                findUniqueCalls.push(args);
                if (originalEntry && args?.where?.id === originalEntry.id) {
                    return JSON.parse(JSON.stringify(originalEntry));
                }
                return null;
            }),
            findFirst: jest.fn().mockImplementation(async (args) => {
                findFirstCalls.push(args);
                return existingReversal || null;
            }),
            create: jest.fn().mockImplementation(async ({ data, include }) => {
                reversalCreateCalls.push({ data, include });
                return {
                    id: reversalRowId,
                    entryDate: data.entryDate,
                    reference: data.reference,
                    invoiceId: data.invoiceId,
                    organizationId: data.organizationId,
                    description: data.description,
                    totalDebit: data.totalDebit,
                    totalCredit: data.totalCredit,
                    createdBy: data.createdBy,
                    lines: data.lines.create.map((line, idx) => ({
                        id: `jl-rev-${idx + 1}`,
                        ...line,
                    })),
                };
            }),
        },
        journalLine: {
            update: jest.fn().mockImplementation(async (args) => {
                updateCalls.push(args);
                return { ...args.data, id: args.where.id };
            }),
        },
        _calls: {
            reversalCreateCalls,
            findUniqueCalls,
            findFirstCalls,
            updateCalls,
        },
    };
    return tx;
}

describe('[Iter 24] buildReversalLines — pure auto-swap helper', () => {
    it('swaps debit ↔ credit on every line and preserves accountCode/name/issuer/taxableAmount', () => {
        const original = [
            {
                lineNumber: 1,
                accountCode: '1110-001',
                accountName: 'Cash',
                debit: 535,
                credit: 0,
                issuer: 'PLATFORM',
                taxableAmount: null,
            },
            {
                lineNumber: 2,
                accountCode: '4110-001',
                accountName: 'Revenue',
                debit: 0,
                credit: 500,
                issuer: 'PLATFORM',
                taxableAmount: 500,
            },
        ];
        const reversed = buildReversalLines(original);
        expect(reversed).toHaveLength(2);
        // Cash: was Dr 535 → now Cr 535
        expect(reversed[0].accountCode).toBe('1110-001');
        expect(reversed[0].debit).toBe(0);
        expect(reversed[0].credit).toBe(535);
        expect(reversed[0].issuer).toBe('PLATFORM');
        // Revenue: was Cr 500 → now Dr 500. taxableAmount preserved.
        expect(reversed[1].accountCode).toBe('4110-001');
        expect(reversed[1].debit).toBe(500);
        expect(reversed[1].credit).toBe(0);
        expect(reversed[1].taxableAmount).toBe(500);
    });
});

describe('[Iter 24] recordReversingEntry — validation', () => {
    it('throws on missing originalEntryId', async () => {
        await expect(recordReversingEntry(null, { reason: 'CN issued' }))
            .rejects.toThrow(/originalEntryId is required/);
        await expect(recordReversingEntry('', { reason: 'CN issued' }))
            .rejects.toThrow(/originalEntryId is required/);
    });

    it('throws on missing or too-short reason', async () => {
        const tx = makeTxMock({ originalEntry: makeOriginalEntry() });
        await expect(recordReversingEntry('je-original-001', { tx }))
            .rejects.toThrow(/reason is required/);
        await expect(recordReversingEntry('je-original-001', { reason: 'xy', tx }))
            .rejects.toThrow(/reason is required/);
    });

    it('throws when partial=true but customLines is empty', async () => {
        const tx = makeTxMock({ originalEntry: makeOriginalEntry() });
        await expect(
            recordReversingEntry('je-original-001', {
                reason: 'Partial refund',
                partial: true,
                customLines: [],
                tx,
            }),
        ).rejects.toThrow(/customLines must be a non-empty array/);
    });

    it('throws when the original entry does not exist', async () => {
        const tx = makeTxMock({ originalEntry: makeOriginalEntry() });
        await expect(
            recordReversingEntry('je-missing-999', { reason: 'CN issued', tx }),
        ).rejects.toThrow(/Original journal entry .* not found/);
    });

    it('throws when the original entry is soft-deleted', async () => {
        const deletedOriginal = makeOriginalEntry();
        deletedOriginal.isDeleted = true;
        const tx = makeTxMock({ originalEntry: deletedOriginal });
        await expect(
            recordReversingEntry(deletedOriginal.id, { reason: 'CN issued', tx }),
        ).rejects.toThrow(/Cannot reverse a soft-deleted/);
    });
});

describe('[Iter 24] recordReversingEntry — auto-swap reversal', () => {
    beforeEach(() => {
        auditLogger.log.mockClear();
    });

    it('produces a reversal with swapped Dr ↔ Cr and reference=`<original>-REV`', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        const result = await recordReversingEntry(original.id, {
            reason: 'Credit note CN-PRD-2026-000001 issued',
            actorId: 'user-account-1',
            tx,
        });
        expect(result.persisted).toBe(true);
        expect(result.reversingEntryId).toBe('je-reversal-001');
        expect(result.reference).toBe('TAX-PRD-2026-000100-REV');
        expect(result.description).toMatch(/Reversal of TAX-PRD-2026-000100/);
        expect(result.totalDebit).toBeCloseTo(535, 2);
        expect(result.totalCredit).toBeCloseTo(535, 2);
        expect(result.balanced).toBe(true);

        // The reversal's create call must have swapped lines.
        const [createCall] = tx._calls.reversalCreateCalls;
        const linesCreated = createCall.data.lines.create;
        expect(linesCreated).toHaveLength(3);
        // Cash: was Dr 535 → now Cr 535
        const cashLine = linesCreated.find((l) => l.accountCode === ACCOUNTS.CASH_BANK.code);
        expect(cashLine.debit).toBe(0);
        expect(cashLine.credit).toBe(535);
        // Revenue: was Cr 500 → now Dr 500
        const revenueLine = linesCreated.find((l) => l.accountCode === ACCOUNTS.REVENUE_PLATFORM_FEE.code);
        expect(revenueLine.debit).toBe(500);
        expect(revenueLine.credit).toBe(0);
        // VAT: was Cr 35 → now Dr 35
        const vatLine = linesCreated.find((l) => l.accountCode === ACCOUNTS.VAT_PAYABLE_OUTPUT.code);
        expect(vatLine.debit).toBe(35);
        expect(vatLine.credit).toBe(0);
    });

    it('passes the tx handle through to tx.journalEntry.create (not the default prisma client)', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        await recordReversingEntry(original.id, {
            reason: 'CN issued',
            tx,
        });
        expect(tx.journalEntry.create).toHaveBeenCalledTimes(1);
        expect(tx.journalEntry.findUnique).toHaveBeenCalledWith({
            where: { id: original.id },
            include: { lines: true },
        });
    });

    it('writes REVERSAL metadata (kind=REVERSAL, reversalOf=<original>) on every reversal line', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        await recordReversingEntry(original.id, { reason: 'CN issued', tx });
        const [createCall] = tx._calls.reversalCreateCalls;
        const linesCreated = createCall.data.lines.create;
        for (const line of linesCreated) {
            expect(line.metadata).toBeDefined();
            expect(line.metadata.kind).toBe('REVERSAL');
            expect(line.metadata.reversalOf).toBe(original.id);
        }
    });

    it('marks the original entry as reversed via metadata.reversedByEntryId on its first line', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original, reversalRowId: 'je-reversal-marker' });
        await recordReversingEntry(original.id, {
            reason: 'CN issued',
            actorId: 'user-account-9',
            tx,
        });
        // The marker write hits journalLine.update on the original's first
        // line (id jl-original-001).
        expect(tx.journalLine.update).toHaveBeenCalledTimes(1);
        const [updateCall] = tx._calls.updateCalls;
        expect(updateCall.where.id).toBe('jl-original-001');
        expect(updateCall.data.metadata.reversedByEntryId).toBe('je-reversal-marker');
        expect(updateCall.data.metadata.reversedReason).toBe('CN issued');
        expect(updateCall.data.metadata.reversedBy).toBe('user-account-9');
    });
});

describe('[Iter 24] recordReversingEntry — idempotency', () => {
    beforeEach(() => {
        auditLogger.log.mockClear();
    });

    it('returns { skipped: true, ALREADY_REVERSED } when called twice (via metadata marker)', async () => {
        // First call: original has no marker → reversal is minted, marker
        // is written on the original's first line.
        const original = makeOriginalEntry();
        const tx1 = makeTxMock({ originalEntry: original, reversalRowId: 'je-reversal-first' });
        const first = await recordReversingEntry(original.id, { reason: 'CN issued', tx: tx1 });
        expect(first.skipped).toBeUndefined();
        expect(first.reversingEntryId).toBe('je-reversal-first');

        // Second call: simulate the marker having landed on the original
        // (production: that's a different request reading the DB).
        const originalAfterFirst = makeOriginalEntry({ markerEntryId: 'je-reversal-first' });
        const tx2 = makeTxMock({ originalEntry: originalAfterFirst });
        const second = await recordReversingEntry(original.id, { reason: 'CN issued (retry)', tx: tx2 });
        expect(second.skipped).toBe(true);
        expect(second.reason).toBe('ALREADY_REVERSED');
        expect(second.reversingEntryId).toBe('je-reversal-first');
        // Critically: the second call MUST NOT create another JournalEntry.
        expect(tx2.journalEntry.create).not.toHaveBeenCalled();
    });

    it('returns ALREADY_REVERSED when a reversal entry exists in the DB (belt-and-braces findFirst)', async () => {
        // Marker missing (e.g., race where marker write rolled back) but a
        // <reference>-REV row exists — idempotency still holds.
        const original = makeOriginalEntry();
        const tx = makeTxMock({
            originalEntry: original,
            existingReversal: {
                id: 'je-reversal-existing',
                reference: 'TAX-PRD-2026-000100-REV',
                lines: [],
            },
        });
        const result = await recordReversingEntry(original.id, { reason: 'CN issued', tx });
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('ALREADY_REVERSED');
        expect(result.reversingEntryId).toBe('je-reversal-existing');
        expect(tx.journalEntry.create).not.toHaveBeenCalled();
    });
});

describe('[Iter 24] recordReversingEntry — partial reversal', () => {
    beforeEach(() => {
        auditLogger.log.mockClear();
    });

    it('uses customLines when partial=true (does NOT auto-swap)', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        // Partial reversal: half the platform fee + half the VAT only.
        const customLines = [
            {
                accountCode: ACCOUNTS.REVENUE_PLATFORM_FEE.code,
                accountName: ACCOUNTS.REVENUE_PLATFORM_FEE.name,
                debit: 250,
                credit: 0,
                issuer: ISSUER.PLATFORM,
                taxableAmount: 250,
            },
            {
                accountCode: ACCOUNTS.VAT_PAYABLE_OUTPUT.code,
                accountName: ACCOUNTS.VAT_PAYABLE_OUTPUT.name,
                debit: 17.5,
                credit: 0,
                issuer: ISSUER.PLATFORM,
            },
            {
                accountCode: ACCOUNTS.CASH_BANK.code,
                accountName: ACCOUNTS.CASH_BANK.name,
                debit: 0,
                credit: 267.5,
                issuer: ISSUER.PLATFORM,
            },
        ];
        const result = await recordReversingEntry(original.id, {
            reason: 'Partial price reduction',
            partial: true,
            customLines,
            tx,
        });
        expect(result.persisted).toBe(true);
        expect(result.totalDebit).toBeCloseTo(267.5, 2);
        expect(result.totalCredit).toBeCloseTo(267.5, 2);
        const [createCall] = tx._calls.reversalCreateCalls;
        expect(createCall.data.lines.create).toHaveLength(3);
    });

    it('rejects partial customLines that do not balance (Dr !== Cr)', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        const unbalancedLines = [
            { accountCode: '4110-001', accountName: 'Revenue', debit: 100, credit: 0 },
            { accountCode: '1110-001', accountName: 'Cash', debit: 0, credit: 50 },
        ];
        await expect(
            recordReversingEntry(original.id, {
                reason: 'Bad partial',
                partial: true,
                customLines: unbalancedLines,
                tx,
            }),
        ).rejects.toThrow(/Unbalanced reversing entry/);
    });
});

describe('[Iter 24] recordReversingEntry — net-to-zero invariant', () => {
    it('pair (original + auto-swap reversal) nets to zero on every account', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        await recordReversingEntry(original.id, { reason: 'CN issued', tx });
        const [createCall] = tx._calls.reversalCreateCalls;
        const reversalLines = createCall.data.lines.create;

        // Bucket sums by accountCode across BOTH entries.
        const byCode = new Map();
        for (const line of original.lines) {
            const cur = byCode.get(line.accountCode) || { debit: 0, credit: 0 };
            cur.debit += Number(line.debit) || 0;
            cur.credit += Number(line.credit) || 0;
            byCode.set(line.accountCode, cur);
        }
        for (const line of reversalLines) {
            const cur = byCode.get(line.accountCode) || { debit: 0, credit: 0 };
            cur.debit += Number(line.debit) || 0;
            cur.credit += Number(line.credit) || 0;
            byCode.set(line.accountCode, cur);
        }

        // Every account's debit-sum must equal its credit-sum after the pair.
        for (const [code, totals] of byCode.entries()) {
            expect(totals.debit).toBeCloseTo(totals.credit, 2);
            // Sanity check: each account was touched twice (once Dr, once Cr).
            expect(totals.debit).toBeGreaterThan(0);
            expect(totals.credit).toBeGreaterThan(0);
            // Capture code so the test name surfaces in case of failure.
            expect(typeof code).toBe('string');
        }

        // Aggregate: sum of all debits across the pair === sum of all credits.
        const totalDebit = original.totalDebit
            + reversalLines.reduce((s, l) => s + Number(l.debit), 0);
        const totalCredit = original.totalCredit
            + reversalLines.reduce((s, l) => s + Number(l.credit), 0);
        expect(totalDebit).toBeCloseTo(totalCredit, 2);
        // Per the spec: both equal totalDebit × 2 from the original.
        expect(totalDebit).toBeCloseTo(original.totalDebit * 2, 2);
        expect(totalCredit).toBeCloseTo(original.totalCredit * 2, 2);
    });
});

describe('[Iter 24] recordReversingEntry — audit log', () => {
    beforeEach(() => {
        auditLogger.log.mockClear();
    });

    it('emits REVERSING_ENTRY_POSTED with originalEntryId + reversingEntryId + reason', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original, reversalRowId: 'je-rev-audit' });
        await recordReversingEntry(original.id, {
            reason: 'CN-PRD-2026-000001 issued',
            actorId: 'user-account-42',
            tx,
        });
        expect(auditLogger.log).toHaveBeenCalledTimes(1);
        const [event] = auditLogger.log.mock.calls[0];
        expect(event.action).toBe('REVERSING_ENTRY_POSTED');
        expect(event.actorId).toBe('user-account-42');
        expect(event.metadata.originalEntryId).toBe(original.id);
        expect(event.metadata.reversingEntryId).toBe('je-rev-audit');
        expect(event.metadata.reason).toBe('CN-PRD-2026-000001 issued');
        expect(event.metadata.reversalReference).toBe('TAX-PRD-2026-000100-REV');
        expect(event.metadata.partial).toBe(false);
    });

    it('does not throw when audit logger fails (non-fatal)', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        auditLogger.log.mockRejectedValueOnce(new Error('audit pipeline down'));
        const result = await recordReversingEntry(original.id, { reason: 'CN issued', tx });
        // The primary operation still succeeds.
        expect(result.persisted).toBe(true);
        expect(result.reversingEntryId).toBe('je-reversal-001');
    });
});

describe('[Iter 24] recordReversingEntry — rollback semantics inside $transaction', () => {
    it('re-throws when tx.journalEntry.create fails so the surrounding $transaction rolls back', async () => {
        const original = makeOriginalEntry();
        const tx = makeTxMock({ originalEntry: original });
        tx.journalEntry.create.mockRejectedValueOnce(new Error('db-connection-lost'));
        await expect(
            recordReversingEntry(original.id, { reason: 'CN issued', tx }),
        ).rejects.toThrow(/db-connection-lost/);
    });
});
