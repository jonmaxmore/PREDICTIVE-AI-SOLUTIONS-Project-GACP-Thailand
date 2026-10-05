/**
 * Tests for services/purchase-invoice-service.js (Iter 26, 2026-05-16).
 *
 * Anchors:
 *   - createPurchaseInvoice validates (13-digit TIN + totals balance +
 *     category + uniqueness).
 *   - approvePurchaseInvoice writes the Input VAT journal entry (Dr 1310
 *     Input VAT + Dr 5xxx Expense + Cr 1110 Cash OR Cr 2110 AP) and
 *     transitions PENDING_REVIEW → APPROVED atomically.
 *   - rejectPurchaseInvoice transitions PENDING_REVIEW → REJECTED with
 *     a recorded reason; APPROVED rows are terminal (cannot re-reject).
 *   - markAsPaid records paidAt without changing status; only APPROVED
 *     rows can be marked paid (PENDING_REVIEW rejected).
 *   - listPurchaseInvoices filters by status + dateRange + organizationId
 *     and tenant-scopes ACCOUNT_PLATFORM to their own org.
 *   - VAT period boundary: ภ.พ.30 month derives from invoiceDate (ม.83/8).
 */

'use strict';

const createPrismaMock = () => {
    const piStore = new Map();
    const jeStore = new Map();
    let piCounter = 0;
    let jeCounter = 0;

    const purchaseInvoiceModel = {
        findFirst: jest.fn(async ({ where }) => {
            for (const row of piStore.values()) {
                if (row.isDeleted) {continue;}
                // PDPA close-natid-round2: dedup now keys off supplierTaxIdHmac
                // (the keyed lookup column), not the encrypted plaintext column.
                // Keep the legacy supplierTaxId branch too so any other caller
                // still works.
                if (where.supplierTaxIdHmac && row.supplierTaxIdHmac !== where.supplierTaxIdHmac) {continue;}
                if (where.supplierTaxId && row.supplierTaxId !== where.supplierTaxId) {continue;}
                if (where.invoiceNumber && row.invoiceNumber !== where.invoiceNumber) {continue;}
                return row;
            }
            return null;
        }),
        findUnique: jest.fn(async ({ where: { id } }) => piStore.get(id) || null),
        findMany: jest.fn(async ({ where, orderBy: _o } = {}) => {
            let rows = Array.from(piStore.values());
            if (where) {
                if (where.isDeleted === false) {
                    rows = rows.filter((r) => !r.isDeleted);
                }
                if (where.status) {
                    rows = rows.filter((r) => r.status === where.status);
                }
                if (where.organizationId) {
                    rows = rows.filter((r) => r.organizationId === where.organizationId);
                }
                if (where.invoiceDate) {
                    if (where.invoiceDate.gte) {
                        rows = rows.filter((r) => r.invoiceDate >= where.invoiceDate.gte);
                    }
                    if (where.invoiceDate.lt) {
                        rows = rows.filter((r) => r.invoiceDate < where.invoiceDate.lt);
                    }
                }
            }
            return rows;
        }),
        create: jest.fn(async ({ data }) => {
            piCounter += 1;
            const id = `pi-${piCounter}`;
            const row = {
                id,
                ...data,
                createdAt: new Date(),
                isDeleted: false,
                reviewedAt: null,
                reviewedBy: null,
                rejectionReason: null,
                paidAt: null,
                paidBy: null,
                journalEntryId: null,
            };
            piStore.set(id, row);
            return row;
        }),
        update: jest.fn(async ({ where: { id }, data }) => {
            const existing = piStore.get(id);
            if (!existing) {throw new Error('not found');}
            const updated = { ...existing, ...data };
            piStore.set(id, updated);
            return updated;
        }),
    };

    const journalEntryModel = {
        create: jest.fn(async ({ data }) => {
            jeCounter += 1;
            const id = `je-${jeCounter}`;
            const lines = (data.lines?.create || []).map((l, idx) => ({
                id: `jl-${jeCounter}-${idx + 1}`,
                ...l,
            }));
            const row = { id, ...data, lines };
            // Remove the nested .lines.create field on the persisted obj.
            row.lines = lines;
            jeStore.set(id, row);
            return row;
        }),
    };

    const prisma = {
        purchaseInvoice: purchaseInvoiceModel,
        journalEntry: journalEntryModel,
        $transaction: jest.fn(async (cbOrArr) => {
            if (typeof cbOrArr === 'function') {
                return cbOrArr(prisma);
            }
            return Promise.all(cbOrArr);
        }),
    };
    return { prisma, piStore, jeStore };
};

function loadService(prisma) {
    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { PAYMENT: 'PAYMENT' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { INVOICE: 'INVOICE' },
    }));
    return require('../../services/purchase-invoice-service');
}

const ACTOR_ACCOUNT_PLATFORM = {
    id: 'user-acct-1',
    canonicalRole: 'finance_officer_platform',
    organizationId: 'org-1',
};

const ACTOR_AUDITOR = {
    id: 'user-aud-1',
    canonicalRole: 'field_inspector',
    organizationId: 'org-1',
};

const ACTOR_ADMIN = {
    id: 'user-admin-1',
    canonicalRole: 'system_admin_dtam',
    organizationId: 'org-1',
};

const VALID_PAYLOAD = {
    invoiceNumber: 'SUP-INV-2026-001',
    supplierName: 'บริษัท ผู้ขาย จำกัด',
    supplierTaxId: '0105540099999',
    supplierAddress: '123 ถ.ทดสอบ',
    invoiceDate: new Date('2026-05-10T03:00:00Z'),
    subtotal: 1000,
    vat: 70,
    totalAmount: 1070,
    category: 'OFFICE_SUPPLIES',
    organizationId: 'org-1',
    createdBy: 'user-acct-1',
    // ประตูสร้างมีด่านบทบาทแล้ว (operator 2026-09-27) — ชุดเดียวกับ approve/reject
    actor: ACTOR_ACCOUNT_PLATFORM,
};

describe('[Iter26] purchase-invoice-service — createPurchaseInvoice', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('creates a PENDING_REVIEW row with rounded totals', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        expect(created.status).toBe('PENDING_REVIEW');
        expect(created.subtotal).toBe(1000);
        expect(created.vat).toBe(70);
        expect(created.totalAmount).toBe(1070);
        expect(created.supplierTaxId).toBe('0105540099999');
        expect(created.invoiceNumber).toBe('SUP-INV-2026-001');
    });

    it('forbids create without a write role — FORBIDDEN_ROLE before any validation or DB write', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        for (const actor of [undefined, ACTOR_AUDITOR, { id: 'd-1', canonicalRole: 'finance_officer_dtam', organizationId: 'org-1' }]) {
            await expect(svc.createPurchaseInvoice({ ...VALID_PAYLOAD, actor }))
                .rejects.toMatchObject({ code: 'FORBIDDEN_ROLE', statusCode: 403 });
        }
        await expect(svc.createPurchaseInvoice({ ...VALID_PAYLOAD, actor: ACTOR_ADMIN })).resolves.toMatchObject({ status: 'PENDING_REVIEW' });
    });

    it('rejects non-13-digit tax IDs (ม.86/4)', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        await expect(svc.createPurchaseInvoice({
            ...VALID_PAYLOAD, supplierTaxId: '12345',
        })).rejects.toMatchObject({ code: 'INVALID_TAX_ID' });
    });

    it('rejects when subtotal + vat ≠ totalAmount', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        await expect(svc.createPurchaseInvoice({
            ...VALID_PAYLOAD, subtotal: 1000, vat: 70, totalAmount: 9999,
        })).rejects.toMatchObject({ code: 'UNBALANCED_TOTALS' });
    });

    it('rejects invalid category', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        await expect(svc.createPurchaseInvoice({
            ...VALID_PAYLOAD, category: 'BOGUS',
        })).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
    });

    it('rejects duplicate (supplierTaxId, invoiceNumber)', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await expect(svc.createPurchaseInvoice(VALID_PAYLOAD))
            .rejects.toMatchObject({ code: 'DUPLICATE_PURCHASE_INVOICE' });
    });
});

describe('[Iter26] purchase-invoice-service — approvePurchaseInvoice', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('writes a balanced Input VAT journal entry (unpaid → Cr AP)', async () => {
        const { prisma, jeStore } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        const approved = await svc.approvePurchaseInvoice(created.id, {
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(approved.status).toBe('APPROVED');
        expect(approved.reviewedAt).toBeInstanceOf(Date);
        expect(approved.reviewedBy).toBe(ACTOR_ACCOUNT_PLATFORM.id);
        expect(approved.journalEntryId).toBeTruthy();
        // Inspect the persisted journal entry.
        expect(jeStore.size).toBe(1);
        const entry = Array.from(jeStore.values())[0];
        expect(Number(entry.totalDebit)).toBeCloseTo(1070);
        expect(Number(entry.totalCredit)).toBeCloseTo(1070);
        const codes = entry.lines.map((l) => l.accountCode);
        expect(codes).toContain('1310-001'); // Input VAT
        expect(codes).toContain('5210-001'); // Office expense
        expect(codes).toContain('2110-001'); // AP (unpaid → AP)
        const vatLine = entry.lines.find((l) => l.accountCode === '1310-001');
        expect(Number(vatLine.debit)).toBe(70);
        expect(Number(vatLine.taxableAmount)).toBe(1000);
    });

    it('credits Cash (1110) instead of AP (2110) when row was marked paid first', async () => {
        const { prisma, piStore, jeStore } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        // Simulate the row already being marked paid before approval.
        const existing = piStore.get(created.id);
        existing.paidAt = new Date('2026-05-12T03:00:00Z');
        piStore.set(created.id, existing);
        await svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ADMIN });
        const entry = Array.from(jeStore.values())[0];
        const codes = entry.lines.map((l) => l.accountCode);
        expect(codes).toContain('1110-001'); // Cash
        expect(codes).not.toContain('2110-001');
    });

    it('rejects approving a row already APPROVED (terminal)', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        await expect(svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ACCOUNT_PLATFORM }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('forbids non-ACCOUNT_PLATFORM / non-ADMIN actor', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await expect(svc.approvePurchaseInvoice(created.id, { actor: ACTOR_AUDITOR }))
            .rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });

    it('uses invoiceDate as entryDate (ป.รัษฎากร ม.83/8 — period match)', async () => {
        const { prisma, jeStore } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        const entry = Array.from(jeStore.values())[0];
        expect(new Date(entry.entryDate).toISOString())
            .toBe(VALID_PAYLOAD.invoiceDate.toISOString());
    });

    it('PDPA close-natid-round4 — the PURCHASE_INVOICE_APPROVED audit stores the MASKED TIN (never the raw 13-digit ID)', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        // The audit-logger is mocked in loadService — grab the same instance.
        const { auditLogger } = require('../../middleware/audit-logger');
        const { maskThaiId } = require('../../utils/field-encryption');
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        auditLogger.log.mockClear();
        await svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ACCOUNT_PLATFORM });

        const approveCall = auditLogger.log.mock.calls
            .map((c) => c[0])
            .find((a) => a.action === 'PURCHASE_INVOICE_APPROVED');
        expect(approveCall).toBeDefined();
        const masked = maskThaiId(VALID_PAYLOAD.supplierTaxId); // 0-XXXX-XXXX-X-9999
        expect(approveCall.metadata.supplierTaxId).toBe(masked);
        // Hard guarantee: the raw 13-digit TIN never appears in the audit metadata.
        expect(approveCall.metadata.supplierTaxId).not.toBe(VALID_PAYLOAD.supplierTaxId);
        expect(JSON.stringify(approveCall.metadata)).not.toContain(VALID_PAYLOAD.supplierTaxId);
    });
});

describe('[Iter26] purchase-invoice-service — rejectPurchaseInvoice', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('PENDING_REVIEW → REJECTED records reason', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        const rejected = await svc.rejectPurchaseInvoice(created.id, {
            reason: 'attachment missing — TIN cannot be verified',
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(rejected.status).toBe('REJECTED');
        expect(rejected.rejectionReason).toMatch(/attachment missing/);
    });

    it('requires a reason string (≥ 3 chars)', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await expect(svc.rejectPurchaseInvoice(created.id, {
            reason: 'no', actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVALID_REASON' });
    });

    it('cannot reject already APPROVED row (terminal)', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        await expect(svc.rejectPurchaseInvoice(created.id, {
            reason: 'changed mind', actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });
});

describe('[Iter26] purchase-invoice-service — markAsPaid', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('records paidAt on APPROVED row without changing status', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        const paidAt = new Date('2026-05-20T03:00:00Z');
        const paid = await svc.markAsPaid(created.id, {
            paidAt, actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(paid.status).toBe('APPROVED');
        expect(paid.paidAt.toISOString()).toBe(paidAt.toISOString());
        expect(paid.paidBy).toBe(ACTOR_ACCOUNT_PLATFORM.id);
    });

    it('rejects when not yet APPROVED', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await expect(svc.markAsPaid(created.id, {
            paidAt: new Date(), actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('rejects already-paid rows (idempotency)', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        const created = await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await svc.approvePurchaseInvoice(created.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        await svc.markAsPaid(created.id, {
            paidAt: new Date('2026-05-20T03:00:00Z'),
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        await expect(svc.markAsPaid(created.id, {
            paidAt: new Date(), actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'ALREADY_PAID' });
    });
});

describe('[Iter26] purchase-invoice-service — listPurchaseInvoices', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('filters by status and dateRange', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await svc.createPurchaseInvoice({
            ...VALID_PAYLOAD,
            invoiceNumber: 'SUP-INV-2026-002',
            invoiceDate: new Date('2026-04-20T03:00:00Z'),
        });
        const mayRows = await svc.listPurchaseInvoices({
            status: 'PENDING_REVIEW',
            dateRange: {
                from: new Date('2026-05-01T00:00:00Z'),
                to:   new Date('2026-06-01T00:00:00Z'),
            },
            organizationId: 'org-1',
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(mayRows).toHaveLength(1);
        expect(mayRows[0].invoiceNumber).toBe('SUP-INV-2026-001');
    });

    // S6 (operator 2026-09-27): the field inspector no longer reads finance data — was "AUDITOR can read"
    it('AUDITOR (field_inspector) cannot read — FORBIDDEN_ROLE', async () => {
        const { prisma } = createPrismaMock();
        const svc = loadService(prisma);
        await svc.createPurchaseInvoice(VALID_PAYLOAD);
        await expect(svc.listPurchaseInvoices({ actor: ACTOR_AUDITOR }))
            .rejects.toMatchObject({ code: 'FORBIDDEN_ROLE', statusCode: 403 });
    });
});

describe('[Iter26] purchase-invoice-service — constants', () => {
    it('exposes the canonical state machine + categories', () => {
        const svc = require('../../services/purchase-invoice-service');
        expect(svc.STATUS.PENDING_REVIEW).toBe('PENDING_REVIEW');
        expect(svc.STATUS.APPROVED).toBe('APPROVED');
        expect(svc.STATUS.REJECTED).toBe('REJECTED');
        expect(svc.VALID_CATEGORIES).toEqual(expect.arrayContaining([
            'OFFICE_SUPPLIES', 'PROFESSIONAL_SERVICES', 'UTILITIES', 'OTHER',
        ]));
        expect(svc.ACCOUNTS.INPUT_VAT.code).toBe('1310-001');
    });

    it('rejects helpers reject malformed totals + tax IDs', () => {
        const svc = require('../../services/purchase-invoice-service');
        expect(svc._internals.isValidThaiTaxId('0105540099999')).toBe(true);
        expect(svc._internals.isValidThaiTaxId('123')).toBe(false);
        expect(() => svc._internals.assertTotalsBalance(100, 7, 200))
            .toThrow(/subtotal.*vat.*totalAmount/);
    });
});

describe('[Iter26] purchase-invoice-service — buildInputVatEntryLines (pure)', () => {
    it('emits Dr Input VAT + Dr Expense + Cr AP shape for unpaid rows', () => {
        const svc = require('../../services/purchase-invoice-service');
        const entry = svc._internals.buildInputVatEntryLines({
            purchaseInvoiceId: 'pi-1',
            invoiceNumber: 'SUP-001',
            supplierName: 'ABC Co',
            subtotal: 1000,
            vat: 70,
            totalAmount: 1070,
            category: 'PROFESSIONAL_SERVICES',
            paid: false,
            entryDate: new Date('2026-05-10T00:00:00Z'),
        });
        expect(entry.balanced).toBe(true);
        expect(entry.totalDebit).toBe(1070);
        expect(entry.totalCredit).toBe(1070);
        const codes = entry.lines.map((l) => l.accountCode);
        expect(codes).toEqual(['1310-001', '5220-001', '2110-001']);
    });
});
