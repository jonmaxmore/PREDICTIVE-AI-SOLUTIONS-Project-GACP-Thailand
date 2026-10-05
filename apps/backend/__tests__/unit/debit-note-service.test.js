/**
 * Tests for debit-note-service.js (B20-A, 2026-05-16).
 *
 * Mirror of credit-note-service.test.js — only the journal-entry shape
 * and the legal anchor (ม.86/9 vs ม.86/10) differ.
 */

'use strict';

const createPrismaMock = (initialInvoice) => {
    const dnStore = new Map();
    let dnCounter = 0;
    let seqCounter = 0;

    const invoiceModel = {
        findUnique: jest.fn(async ({ where: { id } }) => (
            id === initialInvoice?.id ? { ...initialInvoice } : null
        )),
    };

    const debitNoteModel = {
        create: jest.fn(async ({ data }) => {
            dnCounter += 1;
            const id = `dn-${dnCounter}`;
            const row = {
                id, ...data,
                createdAt: new Date(),
                updatedAt: new Date(),
                issuedAt: null,
                issuedBy: null,
                postedAt: null,
                postedBy: null,
                isDeleted: false,
            };
            dnStore.set(id, row);
            return row;
        }),
        findUnique: jest.fn(async ({ where: { id }, include }) => {
            const row = dnStore.get(id) || null;
            if (!row) {return null;}
            if (include?.originalInvoice) {
                return { ...row, originalInvoice: initialInvoice };
            }
            return row;
        }),
        findMany: jest.fn(async () => Array.from(dnStore.values())),
        // Conditional claim (issue): matches only while the row still has the
        // expected status — like Postgres re-checking the WHERE after the row lock.
        updateMany: jest.fn(async ({ where: { id, status }, data }) => {
            const existing = dnStore.get(id);
            if (!existing || (status && existing.status !== status)) { return { count: 0 }; }
            dnStore.set(id, { ...existing, ...data });
            return { count: 1 };
        }),
        update: jest.fn(async ({ where: { id }, data }) => {
            const existing = dnStore.get(id);
            if (!existing) {throw new Error('not found');}
            const updated = { ...existing, ...data, updatedAt: new Date() };
            dnStore.set(id, updated);
            return updated;
        }),
    };

    const receiptSequenceModel = {
        upsert: jest.fn(async () => {
            seqCounter += 1;
            return { counter: seqCounter };
        }),
    };

    const prisma = {
        invoice: invoiceModel,
        debitNote: debitNoteModel,
        receiptSequence: receiptSequenceModel,
        $transaction: jest.fn(async (cbOrArr) => {
            if (typeof cbOrArr === 'function') {
                return cbOrArr(prisma);
            }
            return Promise.all(cbOrArr);
        }),
    };

    return { prisma, dnStore };
};

function loadService(prismaObj) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaObj.prisma }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { PAYMENT: 'PAYMENT' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { INVOICE: 'INVOICE' },
    }));
    return require('../../services/debit-note-service');
}

const ACTOR_ACCOUNT_PLATFORM = {
    id: 'user-acct-1',
    canonicalRole: 'finance_officer_platform',
    organizationId: 'org-1',
};

const PLATFORM_INVOICE = {
    id: 'inv-platform-1',
    invoiceNumber: 'TAX-PRD-2026-000001',
    organizationId: 'org-1',
    serviceType: 'PHASE_1_PLATFORM_FEE',
    subtotal: 500,
    vat: 35,
    totalAmount: 535,
    status: 'paid',
    isDeleted: false,
};

const STATE_INVOICE = {
    id: 'inv-state-1',
    invoiceNumber: 'RCP-DTAM-2569-000001',
    organizationId: 'org-1',
    serviceType: 'PHASE_1_STATE_FEE',
    subtotal: 5000,
    vat: 0,
    totalAmount: 5000,
    status: 'paid',
    isDeleted: false,
};

describe('[B20-A] debit-note-service — createDebitNote', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('creates a DRAFT against a paid PLATFORM invoice', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const dn = await svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'ADDITIONAL_CHARGE',
            reason: 'งานเพิ่มเติม',
            subtotal: 200, vat: 14,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(dn.status).toBe('DRAFT');
        expect(dn.subtotal).toBe(200);
        expect(dn.vat).toBe(14);
        expect(dn.totalAmount).toBeCloseTo(214);
        // A DRAFT consumes no number — it is allocated at ISSUE (2026-09-26).
        expect(dn.debitNoteNumber).toBeNull();
        expect(prisma.receiptSequence.upsert).not.toHaveBeenCalled();
        expect(dn.originalInvoiceId).toBe(PLATFORM_INVOICE.id);
    });

    it('rejects STATE-side invoice', async () => {
        const { prisma } = createPrismaMock(STATE_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createDebitNote({
            originalInvoiceId: STATE_INVOICE.id,
            reasonCode: 'ADDITIONAL_CHARGE',
            reason: 'งานเพิ่ม',
            subtotal: 500, vat: 35,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'NOT_PLATFORM_INVOICE' });
    });

    it('rejects unpaid invoice', async () => {
        const { prisma } = createPrismaMock({ ...PLATFORM_INVOICE, status: 'pending' });
        const svc = loadService({ prisma });
        await expect(svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'LATE_FEE',
            reason: 'ค่าปรับล่าช้า',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVOICE_NOT_PAID' });
    });

    it('rejects invalid reason code', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'BOGUS',
            reason: 'reason',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVALID_REASON_CODE' });
    });

    it('rejects zero amounts', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไข',
            subtotal: 0, vat: 0,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'EMPTY_DEBIT_NOTE' });
    });

    it('rejects when actor lacks ACCOUNT_PLATFORM role', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'LATE_FEE',
            reason: 'ค่าปรับ',
            subtotal: 100, vat: 7,
            actor: { id: 'u1', canonicalRole: 'field_inspector', organizationId: 'org-1' },
        })).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });
});

describe('[B20-A] debit-note-service — state transitions', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('DRAFT → ISSUED → POSTED works end-to-end', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const dn = await svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'LATE_FEE',
            reason: 'ค่าปรับล่าช้า',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        const issued = await svc.issueDebitNote(dn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(issued.status).toBe('ISSUED');
        expect(issued.debitNoteNumber).toMatch(/^DN-PRD-\d{4}-\d{6}$/); // allocated at issue
        const posted = await svc.postDebitNote(dn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(posted.status).toBe('POSTED');
        expect(posted.postedAt).toBeInstanceOf(Date);
        expect(posted.postedBy).toBe(ACTOR_ACCOUNT_PLATFORM.id);
    });

    it('cannot POST from DRAFT', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const dn = await svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไข',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        await expect(svc.postDebitNote(dn.id, { actor: ACTOR_ACCOUNT_PLATFORM }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('POSTED is terminal — cannot cancel', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const dn = await svc.createDebitNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไข',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        await svc.issueDebitNote(dn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        await svc.postDebitNote(dn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        await expect(svc.cancelDebitNote(dn.id, { actor: ACTOR_ACCOUNT_PLATFORM }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });
});

describe('[B20-A] debit-note-service — constants', () => {
    it('lists valid reason codes', () => {
        const svc = require('../../services/debit-note-service');
        expect(svc.VALID_REASON_CODES).toContain('ADDITIONAL_CHARGE');
        expect(svc.VALID_REASON_CODES).toContain('CORRECTION');
        expect(svc.VALID_REASON_CODES).toContain('LATE_FEE');
    });

    it('exposes the canonical state machine', () => {
        const svc = require('../../services/debit-note-service');
        expect(svc.STATUS.DRAFT).toBe('DRAFT');
        expect(svc.STATUS.POSTED).toBe('POSTED');
        expect(svc.ALLOWED_TRANSITIONS.POSTED.size).toBe(0);
    });
});
