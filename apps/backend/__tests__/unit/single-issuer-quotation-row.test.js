'use strict';

/**
 * W14 — ONE quotation row, from the company, carrying the whole price.
 *
 * Operator ruling 2026-08-22 (the change log c28355ea): "บริษัทจะเป็นคนออก
 * ใบเสนอราคา ใบวางบิล และใบเสร็จ เท่านั้น".
 *
 * The retired model wrote TWO rows per application — a DTAM row for the state
 * fee and a PLATFORM row for the platform fee + VAT — because the platform
 * collected the state portion as DTAM's agent. Two rows meant two documents,
 * two numbers and two transfers for one piece of work.
 *
 * Prisma is stubbed rather than run: what is under test is which rows the
 * service decides to write and what amounts it puts on them, which is a pure
 * decision. The real writes need Postgres and are DB-gated — see the report.
 */

const PAYABLE = Object.freeze({ 1: 35310, 2: 70620, 3: 105930 });
const SERVICE_FEE = Object.freeze({ 1: 33000, 2: 66000, 3: 99000 });
const VAT = Object.freeze({ 1: 2310, 2: 4620, 3: 6930 });

/** Minimal Prisma stub that records every quotation.create it is handed. */
function stubPrisma(application, existingRows = []) {
    const created = [];
    const client = {
        application: { findUnique: jest.fn().mockResolvedValue(application) },
        quotation: {
            findMany: jest.fn().mockResolvedValue(existingRows),
            create: jest.fn(async ({ data }) => {
                const row = { id: `q-${created.length + 1}`, ...data };
                created.push(row);
                return row;
            }),
        },
        receiptSequence: {
            upsert: jest.fn().mockResolvedValue({ counter: 1 }),
        },
    };
    // Fix round 1 (reviewer BLOCKER B1) — $transaction now carries the
    // idempotency re-probe and the create, not only the number allocator's
    // ReceiptSequence upsert. It used to hand the callback a client that held
    // receiptSequence and nothing else, which is not what an interactive
    // transaction does: the body gets the whole client.
    client.$transaction = jest.fn(async (fn) => fn(client));
    return { created, client };
}

function application(scopeCount, extraFormData = {}) {
    return {
        id: `app-${scopeCount}`,
        formData: { ...extraFormData },
        totalAreaTypes: scopeCount,
        organizationId: 'org-1',
        isDeleted: false,
    };
}

const quotationService = require('../../services/quotation-service');

describe('W14 — issuance writes exactly one quotation', () => {
    test.each([1, 2, 3])('%i scope(s): one row, from the company, for the full payable', async (scopeCount) => {
        const stub = stubPrisma(application(scopeCount));
        const result = await quotationService.issueQuotationsForApplication(
            `app-${scopeCount}`,
            { actorId: 'actor-1', tx: stub.client },
        );

        // ONE row — not a pair.
        expect(stub.created).toHaveLength(1);
        const row = stub.created[0];

        // Issued by the company. 'PLATFORM' IS the company's issuer key.
        expect(row.issuerType).toBe('PLATFORM');
        expect(String(row.quotationNumber)).toContain('QT-PRD');

        // The whole price on one document.
        expect(row.subtotal).toBe(SERVICE_FEE[scopeCount]);
        expect(row.vat).toBe(VAT[scopeCount]);
        expect(row.totalAmount).toBe(PAYABLE[scopeCount]);
        // The relation downstream invoice math depends on.
        expect(row.totalAmount).toBe(row.subtotal + row.vat);

        // No DTAM row was created, under any key.
        expect(stub.created.some((r) => r.issuerType === 'DTAM')).toBe(false);
        expect(result.dtam).toBeNull();
        expect(result.company).toBe(result.platform);
    });

    test('the installments on the row sum to the row total', async () => {
        const stub = stubPrisma(application(2));
        await quotationService.issueQuotationsForApplication('app-2', { tx: stub.client });
        const row = stub.created[0];

        const summed = row.installments.reduce((n, i) => n + i.amount, 0);
        expect(summed).toBe(row.totalAmount);
        expect(summed).toBe(PAYABLE[2]);
        // Two phases for a new application.
        expect(row.installments.map((i) => i.phase)).toEqual(['PHASE_1', 'PHASE_2']);
    });

    test('a renewal is quoted as ONE charge on the ONE row', async () => {
        const stub = stubPrisma(application(1, {
            renewalOf: 'cert-1',
            renewalOfCertificateNumber: 'GACP-TH-2569-ABCDEF',
        }));
        await quotationService.issueQuotationsForApplication('app-1', { tx: stub.client });

        expect(stub.created).toHaveLength(1);
        const row = stub.created[0];
        expect(row.totalAmount).toBe(PAYABLE[1]);
        // A renewal has no document-review phase, so a single installment.
        expect(row.installments).toHaveLength(1);
        expect(row.installments[0].phase).toBe('PHASE_2');
        expect(row.installments[0].amount).toBe(PAYABLE[1]);
    });
});

describe('W14 — idempotency and legacy pairs', () => {
    test('an already-quoted application is not re-quoted', async () => {
        const existing = {
            id: 'q-existing', issuerType: 'PLATFORM', totalAmount: 35310, isDeleted: false,
        };
        const stub = stubPrisma(application(1), [existing]);
        const result = await quotationService.issueQuotationsForApplication(
            'app-1', { tx: stub.client },
        );
        expect(stub.created).toHaveLength(0);
        expect(result.company).toBe(existing);
    });

    test('a pre-W14 DTAM+PLATFORM pair is never repriced into a bigger bill', async () => {
        // The exact scenario that must not turn into a bigger bill: an
        // application quoted under the old formula. Nothing is created to
        // "correct" the rows, so the applicant is never re-billed.
        //
        // What CHANGED 2026-09-11: the returned shape lost its `dtam` slot.
        // There is one issuer, so issuance answers with the company row and
        // nothing else — a legacy ministry row is still in the table, still
        // untouched, but it is no longer something this door hands back as a
        // live document. The money-safety property (create nothing) is what
        // this test protects and it is asserted below unchanged.
        const legacyDtam = {
            id: 'q-dtam', issuerType: 'DTAM', subtotal: 30000, vat: 0, totalAmount: 30000, isDeleted: false,
        };
        const legacyPlatform = {
            id: 'q-plat', issuerType: 'PLATFORM', subtotal: 3000, vat: 210, totalAmount: 3210, isDeleted: false,
        };
        const stub = stubPrisma(application(1), [legacyDtam, legacyPlatform]);
        const result = await quotationService.issueQuotationsForApplication(
            'app-1', { tx: stub.client },
        );

        expect(stub.created).toHaveLength(0);
        expect(result.company).toBe(legacyPlatform);
        expect(result.dtam).toBeUndefined();
        // The old pair still totals the old price: 30,000 + 3,210 = 33,210.
        expect(legacyDtam.totalAmount + legacyPlatform.totalAmount).toBe(33210);
    });
});
