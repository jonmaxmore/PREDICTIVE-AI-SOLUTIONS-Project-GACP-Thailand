'use strict';

/**
 * Credit / debit note numbers are allocated at ISSUE — operator ruling
 * 2026-09-26 ("number year = printed year") as applied by the controller:
 *
 *   - a DRAFT consumes no number and shows "ร่าง";
 *   - the number is allocated from the same instant the note prints as its
 *     issue date, read once in Bangkok — a draft made at 23:30 on 31 Dec 2569
 *     and issued on 2 Jan 2570 is CN-PRD-2027-… and prints 2570;
 *   - an abandoned draft leaves no gap in the series;
 *   - the allocator runs inside the issue transaction, so a refused issue does
 *     not consume a number either.
 *
 * The sequence mock below keys counters by (prefix, year) exactly like the
 * ReceiptSequence table, so the series and its year are observable.
 */

const PLATFORM_INVOICE = {
    id: 'inv-platform-1',
    invoiceNumber: 'TAX-PRD-2026-000010',
    organizationId: 'org-1',
    serviceType: 'CERTIFICATION_CHECKOUT_M1',
    subtotal: 5500,
    vat: 385,
    totalAmount: 5885,
    status: 'PAID',
    isDeleted: false,
};
const ACTOR = {
    id: 'acc-1',
    canonicalRole: 'finance_officer_platform',
    role: 'finance_officer_platform',
    organizationId: 'org-1',
};

// 23:30 on 31 Dec 2569 in Bangkok (16:30Z) — still 2026 on every clock.
const DRAFT_AT = '2026-12-31T16:30:00.000Z';
// 10:00 on 2 Jan 2570 in Bangkok.
const ISSUE_AT = '2027-01-02T03:00:00.000Z';
// 00:30 on 1 Jan 2570 in Bangkok — still 31 Dec 2026 on a UTC clock.
const NEW_YEAR_0030_BKK = '2026-12-31T17:30:00.000Z';

function createPrisma({ noteModelName }) {
    const notes = new Map();
    const sequences = new Map(); // `${prefix}|${year}` → counter
    let nextId = 0;
    const noteModel = {
        create: jest.fn(async ({ data }) => {
            nextId += 1;
            const row = { id: `note-${nextId}`, createdAt: new Date(), ...data };
            notes.set(row.id, row);
            return row;
        }),
        findUnique: jest.fn(async ({ where: { id }, include }) => {
            const row = notes.get(id) || null;
            if (!row) {return null;}
            return include?.originalInvoice ? { ...row, originalInvoice: PLATFORM_INVOICE } : row;
        }),
        aggregate: jest.fn(async () => ({ _sum: { subtotal: 0, vat: 0 } })),
        // Conditional claim (issue): matches only while the row still has the
        // expected status — like Postgres re-checking the WHERE after the row lock.
        updateMany: jest.fn(async ({ where: { id, status }, data }) => {
            const existing = notes.get(id);
            if (!existing || (status && existing.status !== status)) { return { count: 0 }; }
            notes.set(id, { ...existing, ...data });
            return { count: 1 };
        }),
        update: jest.fn(async ({ where: { id }, data }) => {
            const updated = { ...notes.get(id), ...data };
            notes.set(id, updated);
            return updated;
        }),
    };
    // What the issue transaction sees: an interactive-transaction client, which
    // (like Prisma's) has no $transaction of its own.
    const tx = {
        [noteModelName]: noteModel,
        invoice: { findUnique: jest.fn(async () => PLATFORM_INVOICE) },
        receiptSequence: {
            upsert: jest.fn(async ({ where: { prefix_year: { prefix, year } } }) => {
                const key = `${prefix}|${year}`;
                const counter = (sequences.get(key) || 0) + 1;
                sequences.set(key, counter);
                return { counter };
            }),
        },
        $queryRaw: jest.fn(async () => []),
    };
    const prisma = {
        ...tx,
        $transaction: jest.fn(async (fn) => {
            // Roll back the sequence AND the note rows when the body throws.
            const before = new Map(sequences);
            const notesBefore = new Map([...notes].map(([k, v]) => [k, { ...v }]));
            try {
                return await fn(tx);
            } catch (err) {
                sequences.clear();
                for (const [k, v] of before) {sequences.set(k, v);}
                notes.clear();
                for (const [k, v] of notesBefore) {notes.set(k, v);}
                throw err;
            }
        }),
    };
    return { prisma, tx, sequences, notes };
}

function load(kind, prisma) {
    jest.resetModules();
    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { PAYMENT: 'PAYMENT' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { INVOICE: 'INVOICE' },
    }));
    return require(`../../services/${kind}-note-service`);
}

function at(iso) {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date(iso));
}

afterEach(() => {
    jest.useRealTimers();
    jest.dontMock('../../services/prisma-database');
    jest.dontMock('../../middleware/audit-logger');
});

const CASES = [
    ['credit', 'creditNote', 'creditNoteNumber', 'createCreditNote', 'issueCreditNote', 'CN-PRD'],
    ['debit', 'debitNote', 'debitNoteNumber', 'createDebitNote', 'issueDebitNote', 'DN-PRD'],
];

describe.each(CASES)('%s notes: the number is allocated at issue', (kind, model, numberField, create, issue, prefix) => {
    const draftArgs = {
        originalInvoiceId: PLATFORM_INVOICE.id,
        reasonCode: kind === 'credit' ? 'PRICE_REDUCTION' : 'CORRECTION',
        reason: 'ปรับราคาตามข้อตกลง',
        subtotal: 100,
        vat: 7,
        actor: ACTOR,
    };

    it(`a draft made 31 Dec 23:30 (Bangkok) and issued 2 Jan is ${prefix}-2027-000001 and prints 2570`, async () => {
        const { prisma, sequences } = createPrisma({ noteModelName: model });
        const svc = load(kind, prisma);

        at(DRAFT_AT);
        const draft = await svc[create](draftArgs);
        expect(draft[numberField]).toBeNull();
        expect(sequences.size).toBe(0);

        at(ISSUE_AT);
        const issued = await svc[issue](draft.id, { actor: ACTOR });
        jest.useRealTimers();
        expect(issued[numberField]).toBe(`${prefix}-2027-000001`);
        expect(issued.issuedAt.toISOString()).toBe(ISSUE_AT);

        const { buildAdjustmentNoteContext } = require('../../services/pdf/invoice-template-service');
        const printed = buildAdjustmentNoteContext(
            { ...issued, originalInvoice: { ...PLATFORM_INVOICE, paidAt: new Date('2026-09-16T18:30:00.000Z') } },
            { docNumber: issued[numberField], docTypeTh: 'x', docTypeEn: 'x' },
        );
        expect(printed.ISSUE_DATE).toBe('2 ม.ค. 2570');
        expect(printed.YEAR_BE_TH).toBe('๒๕๗๐');
    });

    it('issued at 00:30 on 1 Jan in Bangkok (31 Dec on UTC) takes the new year from that one instant', async () => {
        const { prisma } = createPrisma({ noteModelName: model });
        const svc = load(kind, prisma);
        at('2026-12-20T03:00:00.000Z');
        const draft = await svc[create](draftArgs);
        at(NEW_YEAR_0030_BKK);
        const issued = await svc[issue](draft.id, { actor: ACTOR });
        jest.useRealTimers();
        expect(issued[numberField]).toBe(`${prefix}-2027-000001`);
        expect(issued.issuedAt.toISOString()).toBe(NEW_YEAR_0030_BKK);
    });

    it('an abandoned draft leaves no gap: the next issued note is 000001, then 000002', async () => {
        const { prisma, sequences } = createPrisma({ noteModelName: model });
        const svc = load(kind, prisma);
        at('2026-10-05T03:00:00.000Z');
        await svc[create](draftArgs); // abandoned — never issued
        const second = await svc[create](draftArgs);
        const third = await svc[create](draftArgs);
        const issuedSecond = await svc[issue](second.id, { actor: ACTOR });
        const issuedThird = await svc[issue](third.id, { actor: ACTOR });
        jest.useRealTimers();
        expect(issuedSecond[numberField]).toBe(`${prefix}-2026-000001`);
        expect(issuedThird[numberField]).toBe(`${prefix}-2026-000002`);
        expect(Object.fromEntries(sequences)).toEqual({ [`${prefix}|2026`]: 2 });
    });

    it('an issue that fails after allocating rolls the number back with it (no gap)', async () => {
        const { prisma, tx, sequences } = createPrisma({ noteModelName: model });
        const svc = load(kind, prisma);
        at('2026-10-05T03:00:00.000Z');
        const draft = await svc[create](draftArgs);
        tx[model].update.mockRejectedValueOnce(new Error('write failed'));
        await expect(svc[issue](draft.id, { actor: ACTOR })).rejects.toThrow('write failed');
        expect(sequences.size).toBe(0);
        const issued = await svc[issue](draft.id, { actor: ACTOR });
        jest.useRealTimers();
        expect(issued[numberField]).toBe(`${prefix}-2026-000001`);
    });
});

describe.each(CASES)('%s notes: issuing the same draft twice', (kind, model, numberField, create, issue, prefix) => {
    const draftArgs = {
        originalInvoiceId: PLATFORM_INVOICE.id,
        reasonCode: kind === 'credit' ? 'PRICE_REDUCTION' : 'CORRECTION',
        reason: 'ปรับราคาตามข้อตกลง',
        subtotal: 100,
        vat: 7,
        actor: ACTOR,
    };

    it('the second issue is refused before it draws a number (one number used, no gap)', async () => {
        const { prisma, sequences, tx } = createPrisma({ noteModelName: model });
        const svc = load(kind, prisma);
        at('2026-10-05T03:00:00.000Z');
        const draft = await svc[create](draftArgs);
        // Both callers read the row while it is still DRAFT (the race window):
        // the second caller's read returns the stale DRAFT row, and its claim
        // inside the transaction then finds the row already ISSUED.
        const stale = { ...(await tx[model].findUnique({ where: { id: draft.id } })) };
        const first = await svc[issue](draft.id, { actor: ACTOR });
        tx[model].findUnique.mockImplementationOnce(async ({ include }) => (
            include?.originalInvoice ? { ...stale, originalInvoice: PLATFORM_INVOICE } : stale));
        await expect(svc[issue](draft.id, { actor: ACTOR })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
        jest.useRealTimers();
        expect(first[numberField]).toBe(`${prefix}-2026-000001`);
        expect(Object.fromEntries(sequences)).toEqual({ [`${prefix}|2026`]: 1 });
    });

    it('a draft that already holds a number (made before 2026-09-26) keeps it at issue — no new number, no gap', async () => {
        const { prisma, sequences, notes } = createPrisma({ noteModelName: model });
        const svc = load(kind, prisma);
        at('2026-10-05T03:00:00.000Z');
        const draft = await svc[create](draftArgs);
        notes.set(draft.id, { ...notes.get(draft.id), [numberField]: `${prefix}-2026-000007` });
        const issued = await svc[issue](draft.id, { actor: ACTOR });
        jest.useRealTimers();
        expect(issued[numberField]).toBe(`${prefix}-2026-000007`);
        expect(issued.status).toBe('ISSUED');
        expect(sequences.size).toBe(0);
    });
});

describe('a draft note prints "ร่าง", never a number or "-"', () => {
    it.each([
        ['generateCreditNotePdf', 'creditNoteNumber'],
        ['generateDebitNotePdf', 'debitNoteNumber'],
    ])('%s on a DRAFT', async (fn, numberField) => {
        jest.resetModules();
        const rendered = [];
        jest.doMock('../../services/pdf/pdf-generator.service', () => ({
            readTemplateCached: () => '<p>{{DOC_NUMBER}}</p>',
            replaceTemplateVariables: (tpl, data) => { rendered.push(data); return tpl; },
            generatePDF: async () => Buffer.from('pdf'),
        }));
        const tpl = require('../../services/pdf/invoice-template-service');
        await tpl[fn]({
            id: 'note-9', [numberField]: null, status: 'DRAFT', createdAt: new Date(),
            subtotal: 100, vat: 7, totalAmount: 107, originalInvoice: PLATFORM_INVOICE,
        }, { upload: false });
        jest.dontMock('../../services/pdf/pdf-generator.service');
        expect(rendered[0].DOC_NUMBER).toBe('ร่าง');
    });
});
