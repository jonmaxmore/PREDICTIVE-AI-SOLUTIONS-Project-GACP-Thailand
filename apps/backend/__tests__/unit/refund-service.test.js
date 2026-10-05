/**
 * Tests for refund-service.js (Iter 23, 2026-05-16).
 *
 * Anchors:
 *   - initiateRefund: full flow creates CN (DRAFT → ISSUED → POSTED) and
 *     marks Invoice.metadata.refund as INITIATED.
 *   - Validates issuer is PLATFORM — STATE-fee invoices route through
 *     Treasury (we surface NOT_PLATFORM_INVOICE untouched).
 *   - Validates invoice is paid.
 *   - cancelRefund: requires ADMIN role + reverses underlying CN
 *     (when CN not yet POSTED → handled gracefully).
 *   - Idempotency: calling initiateRefund twice on same invoice returns
 *     the existing record without creating a second CN.
 *   - Notification fanout is invoked after the transaction commits.
 *
 * The Prisma mock here is intentionally lean — credit-note-service has
 * its own deep test coverage; we mock that whole module so this test
 * focuses on the ORCHESTRATION (transactional shape, idempotency,
 * notification fanout, role gating).
 */

'use strict';

const createPrismaMock = (initialInvoice) => {
    const invoiceStore = new Map();
    if (initialInvoice) {invoiceStore.set(initialInvoice.id, { ...initialInvoice });}

    const invoiceModel = {
        findUnique: jest.fn(async ({ where: { id }, select }) => {
            const row = invoiceStore.get(id);
            if (!row) {return null;}
            // honour the .applicant include path the service uses
            if (select?.applicant) {
                return {
                    ...row,
                    applicant: row.applicant || null,
                };
            }
            return { ...row };
        }),
        update: jest.fn(async ({ where: { id }, data, select: _select }) => {
            const existing = invoiceStore.get(id);
            if (!existing) {throw new Error('not found');}
            const updated = { ...existing, ...data, updatedAt: new Date() };
            invoiceStore.set(id, updated);
            return updated;
        }),
    };

    const prisma = {
        invoice: invoiceModel,
        $transaction: jest.fn(async (cbOrArr) => {
            if (typeof cbOrArr === 'function') {return cbOrArr(prisma);}
            return Promise.all(cbOrArr);
        }),
    };
    return { prisma, invoiceStore };
};

function loadService({ prisma, creditNoteMock, fanoutMock }) {
    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    jest.doMock('../../services/credit-note-service', () => creditNoteMock);
    jest.doMock('../../services/notification-fanout-service', () => fanoutMock);
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { PAYMENT: 'PAYMENT' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { INVOICE: 'INVOICE' },
    }));
    return require('../../services/refund-service');
}

function makeCreditNoteMock({ throwOnCreate, throwOnPost } = {}) {
    let counter = 0;
    const cnByInvoice = new Map();
    return {
        VALID_REASON_CODES: ['CANCELLATION', 'PRICE_REDUCTION', 'CORRECTION', 'RETURN'],
        createCreditNote: jest.fn(async ({ originalInvoiceId, reason, reasonCode, subtotal, vat }) => {
            if (throwOnCreate) {
                const err = new Error(throwOnCreate.message);
                err.code = throwOnCreate.code;
                throw err;
            }
            counter += 1;
            const cn = {
                id: `cn-${counter}`,
                creditNoteNumber: `CN-PRD-2026-${String(counter).padStart(6, '0')}`,
                originalInvoiceId,
                reason, reasonCode,
                subtotal, vat,
                totalAmount: subtotal + vat,
                status: 'DRAFT',
            };
            cnByInvoice.set(originalInvoiceId, cn);
            return cn;
        }),
        issueCreditNote: jest.fn(async (id) => {
            const existing = Array.from(cnByInvoice.values()).find((c) => c.id === id);
            if (!existing) {throw new Error('cn not found');}
            existing.status = 'ISSUED';
            existing.issuedAt = new Date();
            return existing;
        }),
        postCreditNote: jest.fn(async (id) => {
            if (throwOnPost) {
                const err = new Error(throwOnPost.message);
                err.code = throwOnPost.code;
                throw err;
            }
            const existing = Array.from(cnByInvoice.values()).find((c) => c.id === id);
            if (!existing) {throw new Error('cn not found');}
            existing.status = 'POSTED';
            existing.postedAt = new Date();
            return existing;
        }),
        cancelCreditNote: jest.fn(async (id, { reason: _r } = {}) => {
            const existing = Array.from(cnByInvoice.values()).find((c) => c.id === id);
            if (!existing) {throw new Error('cn not found');}
            if (existing.status === 'POSTED') {
                const err = new Error(`Cannot cancel credit note from status ${existing.status}`);
                err.code = 'INVALID_TRANSITION';
                throw err;
            }
            existing.status = 'CANCELLED';
            return existing;
        }),
        findCreditNoteById: jest.fn(async (id) => {
            return Array.from(cnByInvoice.values()).find((c) => c.id === id) || null;
        }),
    };
}

function makeFanoutMock() {
    return {
        send: jest.fn(async ({ userId, type, payload }) => ({
            dedupeKey: 'fake-key',
            deduped: false,
            inApp: { ok: true, id: 'notif-1' },
            email: { ok: true, messageId: 'stub-email-1' },
            sms: { ok: true, messageId: 'stub-sms-1' },
            _called: { userId, type, payload },
        })),
        getTemplateForType: jest.fn(() => null),
    };
}

const ACTOR_ACCOUNT_PLATFORM = {
    id: 'user-acct-1',
    canonicalRole: 'finance_officer_platform',
    organizationId: 'org-1',
};
const ACTOR_ADMIN = {
    id: 'user-admin-1',
    canonicalRole: 'system_admin_dtam',
    organizationId: 'org-admin',
};
const ACTOR_AUDITOR = {
    id: 'user-aud-1',
    canonicalRole: 'field_inspector',
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
    metadata: null,
    healthId: 'health-100',
    applicant: { id: 'user-applicant-1', email: 'farmer@example.com', phoneNumber: '0812345678', firstName: 'สมชาย', lastName: 'ใจดี' },
};

const STATE_INVOICE = {
    ...PLATFORM_INVOICE,
    id: 'inv-state-1',
    serviceType: 'PHASE_1_STATE_FEE',
    invoiceNumber: 'RCP-DTAM-2569-000001',
};

const UNPAID_INVOICE = { ...PLATFORM_INVOICE, id: 'inv-unpaid-1', status: 'pending' };

describe('[Iter23] refund-service — initiateRefund', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('creates CN (DRAFT → ISSUED → POSTED) and marks invoice metadata as INITIATED', async () => {
        const { prisma, invoiceStore } = createPrismaMock(PLATFORM_INVOICE);
        const cnMock = makeCreditNoteMock();
        const fanoutMock = makeFanoutMock();
        const svc = loadService({ prisma, creditNoteMock: cnMock, fanoutMock });

        const result = await svc.initiateRefund({
            invoiceId: PLATFORM_INVOICE.id,
            reason: 'ผู้สมัครยกเลิกบริการ',
            reasonCode: 'CANCELLATION',
            actor: ACTOR_ACCOUNT_PLATFORM,
        });

        expect(result.refundStatus).toBe('INITIATED');
        expect(result.creditNoteNumber).toMatch(/^CN-PRD-2026-\d{6}$/);
        expect(result.idempotent).toBe(false);

        // CN service: each step called exactly once
        expect(cnMock.createCreditNote).toHaveBeenCalledTimes(1);
        expect(cnMock.issueCreditNote).toHaveBeenCalledTimes(1);
        expect(cnMock.postCreditNote).toHaveBeenCalledTimes(1);

        // Full invoice subtotal + vat passed to CN
        const createArgs = cnMock.createCreditNote.mock.calls[0][0];
        expect(createArgs.subtotal).toBe(500);
        expect(createArgs.vat).toBe(35);
        expect(createArgs.reasonCode).toBe('CANCELLATION');

        // Invoice.metadata.refund stamped
        const updatedInvoice = invoiceStore.get(PLATFORM_INVOICE.id);
        expect(updatedInvoice.metadata.refund.status).toBe('INITIATED');
        expect(updatedInvoice.metadata.refund.legalBasis).toMatch(/86\/10/);
        expect(updatedInvoice.metadata.refund.amount).toBe(535);
        expect(updatedInvoice.metadata.refund.creditNoteId).toBe(result.creditNoteId);

        // Notification fanout dispatched after the transaction
        expect(fanoutMock.send).toHaveBeenCalledTimes(1);
        const sendArgs = fanoutMock.send.mock.calls[0][0];
        expect(sendArgs.type).toBe('REFUND_INITIATED');
        expect(sendArgs.userId).toBe('user-applicant-1');
        expect(sendArgs.payload.invoiceNumber).toBe('TAX-PRD-2026-000001');
        expect(sendArgs.payload.amount).toBe(535);
        expect(sendArgs.channels).toEqual(['IN_APP', 'EMAIL', 'SMS']);
    });

    it('rejects STATE-side invoice (ม.86/10 platform-only — surface CN error)', async () => {
        const { prisma } = createPrismaMock(STATE_INVOICE);
        const cnMock = makeCreditNoteMock({
            throwOnCreate: { code: 'NOT_PLATFORM_INVOICE', message: 'STATE invoices route via Treasury' },
        });
        const fanoutMock = makeFanoutMock();
        const svc = loadService({ prisma, creditNoteMock: cnMock, fanoutMock });

        await expect(svc.initiateRefund({
            invoiceId: STATE_INVOICE.id,
            reason: 'ยกเลิกบริการ',
            reasonCode: 'CANCELLATION',
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'NOT_PLATFORM_INVOICE' });
        expect(fanoutMock.send).not.toHaveBeenCalled();
    });

    it('rejects unpaid invoice', async () => {
        const { prisma } = createPrismaMock(UNPAID_INVOICE);
        const cnMock = makeCreditNoteMock();
        const fanoutMock = makeFanoutMock();
        const svc = loadService({ prisma, creditNoteMock: cnMock, fanoutMock });

        await expect(svc.initiateRefund({
            invoiceId: UNPAID_INVOICE.id,
            reason: 'ยกเลิก',
            reasonCode: 'CANCELLATION',
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVOICE_NOT_PAID' });
        expect(cnMock.createCreditNote).not.toHaveBeenCalled();
        expect(fanoutMock.send).not.toHaveBeenCalled();
    });

    it('rejects when actor lacks ACCOUNT_PLATFORM/ADMIN', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const cnMock = makeCreditNoteMock();
        const fanoutMock = makeFanoutMock();
        const svc = loadService({ prisma, creditNoteMock: cnMock, fanoutMock });

        await expect(svc.initiateRefund({
            invoiceId: PLATFORM_INVOICE.id,
            reason: 'ยกเลิก',
            reasonCode: 'CANCELLATION',
            actor: ACTOR_AUDITOR,
        })).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });

    it('returns existing record idempotently when refund is already INITIATED', async () => {
        const seeded = {
            ...PLATFORM_INVOICE,
            metadata: {
                refund: {
                    status: 'INITIATED',
                    creditNoteId: 'cn-existing',
                    creditNoteNumber: 'CN-PRD-2026-000001',
                    amount: 535,
                    legalBasis: 'ม.86/10 ป.รัษฎากร',
                },
            },
        };
        const { prisma } = createPrismaMock(seeded);
        const cnMock = makeCreditNoteMock();
        const fanoutMock = makeFanoutMock();
        const svc = loadService({ prisma, creditNoteMock: cnMock, fanoutMock });

        const result = await svc.initiateRefund({
            invoiceId: seeded.id,
            reason: 'ลองเรียกซ้ำ',
            reasonCode: 'CANCELLATION',
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(result.idempotent).toBe(true);
        expect(result.creditNoteNumber).toBe('CN-PRD-2026-000001');
        expect(cnMock.createCreditNote).not.toHaveBeenCalled();
        expect(fanoutMock.send).not.toHaveBeenCalled();
    });

    it('returns 404-shaped error when invoice not found', async () => {
        const { prisma } = createPrismaMock(null);
        const cnMock = makeCreditNoteMock();
        const fanoutMock = makeFanoutMock();
        const svc = loadService({ prisma, creditNoteMock: cnMock, fanoutMock });

        await expect(svc.initiateRefund({
            invoiceId: 'no-such-invoice',
            reason: 'ทดสอบ',
            reasonCode: 'CANCELLATION',
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND' });
    });

    it('does not fail the refund when notification dispatch throws', async () => {
        const { prisma, invoiceStore } = createPrismaMock(PLATFORM_INVOICE);
        const cnMock = makeCreditNoteMock();
        const fanoutMock = {
            send: jest.fn().mockRejectedValue(new Error('SMTP down')),
            getTemplateForType: jest.fn(() => null),
        };
        const svc = loadService({ prisma, creditNoteMock: cnMock, fanoutMock });

        const result = await svc.initiateRefund({
            invoiceId: PLATFORM_INVOICE.id,
            reason: 'ทดสอบความล้มเหลวของช่องทาง',
            reasonCode: 'CANCELLATION',
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(result.refundStatus).toBe('INITIATED');
        // Invoice still flipped to INITIATED — accounting reversal must persist.
        const updated = invoiceStore.get(PLATFORM_INVOICE.id);
        expect(updated.metadata.refund.status).toBe('INITIATED');
    });
});

describe('[Iter23] refund-service — getRefundStatus', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('returns NONE when no refund record on invoice', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({
            prisma, creditNoteMock: makeCreditNoteMock(), fanoutMock: makeFanoutMock(),
        });
        // S6 (operator 2026-09-27): field_inspector no longer reads refund status — read as finance
        const result = await svc.getRefundStatus(PLATFORM_INVOICE.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(result.refundStatus).toBe('NONE');
    });

    it('returns the refund block when present', async () => {
        const seeded = {
            ...PLATFORM_INVOICE,
            metadata: {
                refund: {
                    status: 'INITIATED',
                    creditNoteId: 'cn-existing',
                    creditNoteNumber: 'CN-PRD-2026-000001',
                    amount: 535,
                    reasonCode: 'CANCELLATION',
                    reason: 'ยกเลิก',
                    initiatedAt: '2026-05-16T10:00:00Z',
                    initiatedBy: 'user-acct-1',
                    legalBasis: 'ม.86/10 ป.รัษฎากร',
                },
            },
        };
        const { prisma } = createPrismaMock(seeded);
        const svc = loadService({
            prisma, creditNoteMock: makeCreditNoteMock(), fanoutMock: makeFanoutMock(),
        });
        const result = await svc.getRefundStatus(seeded.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(result.refundStatus).toBe('INITIATED');
        expect(result.creditNoteNumber).toBe('CN-PRD-2026-000001');
        expect(result.legalBasis).toMatch(/86\/10/);
    });
});

describe('[Iter23] refund-service — cancelRefund', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('marks refund as CANCELLED and reverses the underlying CN (ADMIN required)', async () => {
        const seeded = {
            ...PLATFORM_INVOICE,
            metadata: {
                refund: {
                    status: 'INITIATED',
                    creditNoteId: 'cn-issued-1',
                    creditNoteNumber: 'CN-PRD-2026-000002',
                    amount: 535,
                    legalBasis: 'ม.86/10 ป.รัษฎากร',
                },
            },
        };
        const { prisma, invoiceStore } = createPrismaMock(seeded);

        // CN is in ISSUED state — cancelCreditNote will succeed
        const cnMock = makeCreditNoteMock();
        // Pre-seed the CN store inside our mock by walking it through create+issue:
        const cn = await cnMock.createCreditNote({
            originalInvoiceId: seeded.id,
            reason: 'pre-seeded',
            reasonCode: 'CANCELLATION',
            subtotal: 500,
            vat: 35,
        });
        // Replace the auto-generated id with the one our seeded refund expects
        cn.id = 'cn-issued-1';
        await cnMock.issueCreditNote(cn.id);
        cnMock.createCreditNote.mockClear();
        cnMock.issueCreditNote.mockClear();

        const svc = loadService({
            prisma, creditNoteMock: cnMock, fanoutMock: makeFanoutMock(),
        });

        const result = await svc.cancelRefund(seeded.id, {
            actor: ACTOR_ADMIN,
            reason: 'แก้ไขข้อผิดพลาด',
        });
        expect(result.refundStatus).toBe('CANCELLED');
        expect(cnMock.cancelCreditNote).toHaveBeenCalledTimes(1);

        const updated = invoiceStore.get(seeded.id);
        expect(updated.metadata.refund.status).toBe('CANCELLED');
        expect(updated.metadata.refund.history).toBeDefined();
        expect(updated.metadata.refund.history[0].event).toBe('CANCELLED');
    });

    it('rejects when actor is NOT admin (ACCOUNT_PLATFORM cannot cancel)', async () => {
        const seeded = {
            ...PLATFORM_INVOICE,
            metadata: { refund: { status: 'INITIATED', creditNoteId: 'cn-x' } },
        };
        const { prisma } = createPrismaMock(seeded);
        const svc = loadService({
            prisma, creditNoteMock: makeCreditNoteMock(), fanoutMock: makeFanoutMock(),
        });
        await expect(svc.cancelRefund(seeded.id, { actor: ACTOR_ACCOUNT_PLATFORM }))
            .rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });

    it('returns POSTED_CN_IRREVERSIBLE when underlying CN already POSTED', async () => {
        const seeded = {
            ...PLATFORM_INVOICE,
            metadata: { refund: { status: 'INITIATED', creditNoteId: 'cn-posted-1' } },
        };
        const { prisma } = createPrismaMock(seeded);
        const cnMock = makeCreditNoteMock();
        // Pre-seed the CN as POSTED so cancelCreditNote throws INVALID_TRANSITION
        const cn = await cnMock.createCreditNote({
            originalInvoiceId: seeded.id,
            reason: 'pre-seeded',
            reasonCode: 'CANCELLATION',
            subtotal: 500,
            vat: 35,
        });
        cn.id = 'cn-posted-1';
        await cnMock.issueCreditNote(cn.id);
        await cnMock.postCreditNote(cn.id);
        cnMock.createCreditNote.mockClear();

        const svc = loadService({
            prisma, creditNoteMock: cnMock, fanoutMock: makeFanoutMock(),
        });
        await expect(svc.cancelRefund(seeded.id, {
            actor: ACTOR_ADMIN,
            reason: 'ทดสอบ posted',
        })).rejects.toMatchObject({ code: 'POSTED_CN_IRREVERSIBLE' });
    });

    it('returns idempotently when refund already CANCELLED', async () => {
        const seeded = {
            ...PLATFORM_INVOICE,
            metadata: { refund: { status: 'CANCELLED', creditNoteId: 'cn-x' } },
        };
        const { prisma } = createPrismaMock(seeded);
        const svc = loadService({
            prisma, creditNoteMock: makeCreditNoteMock(), fanoutMock: makeFanoutMock(),
        });
        const result = await svc.cancelRefund(seeded.id, { actor: ACTOR_ADMIN });
        expect(result.refundStatus).toBe('CANCELLED');
        expect(result.idempotent).toBe(true);
    });
});
