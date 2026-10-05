/**
 * Phase-0 fix — credit/debit notes must post REVERSING / ADDITIONAL-CHARGE
 * journal entries to the general ledger. Before this, both services only logged
 * a "manual GL reconciliation required" marker, so credited/refunded revenue
 * was never reversed in the ledger and the VAT-output report overstated revenue.
 *
 * These assert the posted line shape (account codes + Dr/Cr direction + balance)
 * via the log-only path (prisma mocked null), exactly like the existing
 * journal-entry tests.
 */

jest.mock('../../services/prisma-database', () => ({ prisma: null }));
// The guard asks period-close-service.isPeriodClosed; this stub says "open".
// (It used to stub a non-existent checkPeriodOpen and relied on the guard
// failing OPEN for a service without isPeriodClosed — it fails CLOSED now.)
jest.mock('../../services/period-close-service', () => ({
    isPeriodClosed: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const {
    recordCreditNoteEntry,
    recordDebitNoteEntry,
} = require('../../services/journal-entry-service');

const CASH = '1110-001';
const REVENUE = '4110-001';
const VAT = '2131-001';

/** index lines by account code for direction assertions */
function byCode(entry) {
    const m = {};
    for (const l of entry.lines) { m[l.accountCode] = l; }
    return m;
}

const META = {
    invoiceNumber: 'INV-2569-0001',
    serviceType: 'PHASE_1_PLATFORM_FEE',
    organizationId: 'org-1',
    createdBy: 'user-1',
};

describe('recordCreditNoteEntry — reverses the original platform sale', () => {
    it('posts Dr Revenue / Dr VAT / Cr Cash, balanced', async () => {
        const e = await recordCreditNoteEntry('inv-1', 1070, { subtotal: 1000, vat: 70 }, { ...META, creditNoteNumber: 'CN-256905-0001' });
        const l = byCode(e);
        expect(e.balanced).toBe(true);
        expect(e.totalDebit).toBe(1070);
        expect(e.totalCredit).toBe(1070);
        // Revenue + VAT are DEBITED (reversed); cash is CREDITED (returned).
        expect(l[REVENUE].debit).toBe(1000);
        expect(l[REVENUE].credit).toBe(0);
        expect(l[VAT].debit).toBe(70);
        expect(l[CASH].credit).toBe(1070);
        expect(l[CASH].debit).toBe(0);
    });

    it('handles a zero-VAT credit note (two lines, still balanced)', async () => {
        const e = await recordCreditNoteEntry('inv-1', 1000, { subtotal: 1000, vat: 0 }, META);
        expect(e.balanced).toBe(true);
        expect(e.lines).toHaveLength(2);
        expect(byCode(e)[REVENUE].debit).toBe(1000);
        expect(byCode(e)[CASH].credit).toBe(1000);
    });
});

describe('recordDebitNoteEntry — additional charge, same direction as the sale', () => {
    it('posts Dr Cash / Cr Revenue / Cr VAT, balanced', async () => {
        const e = await recordDebitNoteEntry('inv-1', 1070, { subtotal: 1000, vat: 70 }, { ...META, debitNoteNumber: 'DN-256905-0001' });
        const l = byCode(e);
        expect(e.balanced).toBe(true);
        expect(e.totalDebit).toBe(1070);
        expect(e.totalCredit).toBe(1070);
        // Cash DEBITED (more received); revenue + VAT CREDITED (more earned).
        expect(l[CASH].debit).toBe(1070);
        expect(l[CASH].credit).toBe(0);
        expect(l[REVENUE].credit).toBe(1000);
        expect(l[VAT].credit).toBe(70);
    });
});

describe('adjustment-entry guards', () => {
    it('rejects a missing invoiceId', async () => {
        await expect(recordCreditNoteEntry('', 100, { subtotal: 100, vat: 0 }, META))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects a non-positive total', async () => {
        await expect(recordDebitNoteEntry('inv-1', 0, { subtotal: 0, vat: 0 }, META))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('REFUSES a retired STATE invoice — never posted, and never passed over in silence', async () => {
        // Was `expect(e.skipped).toBe(true)`. Split STATE/PLATFORM invoicing is
        // retired (operator 2026-09-05): the company sells one service and books
        // the whole ค่าบริการ. An adjustment note against a STATE invoice is now a
        // defect to investigate, not a case to wave through — and a `skipped`
        // return reads as success to the caller that asked for the adjustment.
        await expect(recordCreditNoteEntry('inv-1', 5000, { subtotal: 5000, vat: 0 }, {
            ...META,
            serviceType: 'PHASE_1_STATE_FEE',
        })).rejects.toMatchObject({ code: 'RETIRED_STATE_INVOICE' });
    });
});
