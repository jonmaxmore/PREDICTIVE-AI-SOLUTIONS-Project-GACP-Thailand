/**
 * Tests for credit-note-service.js (B20-A, 2026-05-16).
 *
 * Anchors:
 *   - createCreditNote validates (paid + PLATFORM + within-cap + reason).
 *   - issueCreditNote enforces DRAFT → ISSUED only.
 *   - postCreditNote writes the reversing-entry shape via journal layer
 *     (or the fallback marker until B20-B wires recordCreditNoteEntry).
 *   - cancelCreditNote forbids POSTED → CANCELLED (POSTED is terminal).
 *   - VAT-period boundary: posting one CN in May does not affect April.
 */

'use strict';

const createPrismaMock = (initialInvoice) => {
    const cnStore = new Map();
    let cnCounter = 0;
    let seqCounter = 0;

    const invoiceModel = {
        findUnique: jest.fn(async ({ where: { id } }) => (
            id === initialInvoice?.id ? { ...initialInvoice } : null
        )),
    };

    const creditNoteModel = {
        create: jest.fn(async ({ data }) => {
            cnCounter += 1;
            const id = `cn-${cnCounter}`;
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
            cnStore.set(id, row);
            return row;
        }),
        findUnique: jest.fn(async ({ where: { id }, include }) => {
            const row = cnStore.get(id) || null;
            if (!row) {return null;}
            if (include?.originalInvoice) {
                return { ...row, originalInvoice: initialInvoice };
            }
            return row;
        }),
        findMany: jest.fn(async () => Array.from(cnStore.values())),
        aggregate: jest.fn(async () => ({ _sum: { subtotal: 0, vat: 0 } })),
        // Conditional claim (issue): matches only while the row still has the
        // expected status — like Postgres re-checking the WHERE after the row lock.
        updateMany: jest.fn(async ({ where: { id, status }, data }) => {
            const existing = cnStore.get(id);
            if (!existing || (status && existing.status !== status)) { return { count: 0 }; }
            cnStore.set(id, { ...existing, ...data });
            return { count: 1 };
        }),
        update: jest.fn(async ({ where: { id }, data }) => {
            const existing = cnStore.get(id);
            if (!existing) {throw new Error('not found');}
            const updated = { ...existing, ...data, updatedAt: new Date() };
            cnStore.set(id, updated);
            return updated;
        }),
    };

    const receiptSequenceModel = {
        upsert: jest.fn(async ({ where: _w }) => {
            seqCounter += 1;
            return { counter: seqCounter };
        }),
    };

    const prisma = {
        invoice: invoiceModel,
        creditNote: creditNoteModel,
        receiptSequence: receiptSequenceModel,
        // issueCreditNote takes a SELECT … FOR UPDATE lock on the invoice inside
        // the $transaction (this same object serves as tx) before the cap check.
        $queryRaw: jest.fn(async () => []),
        $transaction: jest.fn(async (cbOrArr, _opts) => {
            // Support both function form (used by service code paths) and
            // array form (used by Prisma allocator inside the service).
            if (typeof cbOrArr === 'function') {
                return cbOrArr(prisma);
            }
            return Promise.all(cbOrArr);
        }),
    };

    return { prisma, cnStore };
};

function loadService(prismaObj) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaObj.prisma }));
    // Stub the audit logger to avoid Prisma writes.
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { PAYMENT: 'PAYMENT' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { INVOICE: 'INVOICE' },
    }));
    return require('../../services/credit-note-service');
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

describe('[B20-A] credit-note-service — createCreditNote', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('creates a DRAFT against a paid PLATFORM invoice', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const cn = await svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'PRICE_REDUCTION',
            reason: 'ส่วนลดตามข้อตกลง',
            subtotal: 200,
            vat: 14,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        expect(cn.status).toBe('DRAFT');
        expect(cn.subtotal).toBe(200);
        expect(cn.vat).toBe(14);
        expect(cn.totalAmount).toBeCloseTo(214);
        // A DRAFT consumes no number — it is allocated at ISSUE (2026-09-26).
        expect(cn.creditNoteNumber).toBeNull();
        expect(prisma.receiptSequence.upsert).not.toHaveBeenCalled();
        expect(cn.originalInvoiceId).toBe(PLATFORM_INVOICE.id);
    });

    it('rejects STATE-side invoice (ม.86/10 platform-only)', async () => {
        const { prisma } = createPrismaMock(STATE_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createCreditNote({
            originalInvoiceId: STATE_INVOICE.id,
            reasonCode: 'CANCELLATION',
            reason: 'ยกเลิกบริการ',
            subtotal: 5000,
            vat: 0,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'NOT_PLATFORM_INVOICE' });
    });

    it('rejects unpaid invoice', async () => {
        const { prisma } = createPrismaMock({ ...PLATFORM_INVOICE, status: 'pending' });
        const svc = loadService({ prisma });
        await expect(svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไขข้อผิดพลาด',
            subtotal: 100,
            vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVOICE_NOT_PAID' });
    });

    it('rejects when subtotal exceeds original invoice subtotal', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไขข้อผิดพลาด',
            subtotal: 9999, // > 500
            vat: 35,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'EXCEEDS_INVOICE_SUBTOTAL' });
    });

    it('rejects invalid reason code', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'BOGUS',
            reason: 'reason text',
            subtotal: 100,
            vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'INVALID_REASON_CODE' });
    });

    it('rejects empty (zero) amounts', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไข',
            subtotal: 0,
            vat: 0,
            actor: ACTOR_ACCOUNT_PLATFORM,
        })).rejects.toMatchObject({ code: 'EMPTY_CREDIT_NOTE' });
    });

    it('rejects when actor lacks ACCOUNT_PLATFORM role', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไข',
            subtotal: 100,
            vat: 7,
            actor: { id: 'u1', canonicalRole: 'field_inspector', organizationId: 'org-1' },
        })).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });
});

describe('[B20-A] credit-note-service — state transitions', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    it('DRAFT → ISSUED records issuedAt + issuedBy', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const cn = await svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'PRICE_REDUCTION',
            reason: 'ส่วนลด',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        const issued = await svc.issueCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(issued.status).toBe('ISSUED');
        expect(issued.issuedAt).toBeInstanceOf(Date);
        expect(issued.issuedBy).toBe(ACTOR_ACCOUNT_PLATFORM.id);
        // The number is allocated at issue.
        expect(issued.creditNoteNumber).toMatch(/^CN-PRD-\d{4}-\d{6}$/);
    });

    it('ISSUED → POSTED triggers reversing journal entry (fallback path)', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const cn = await svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'PRICE_REDUCTION',
            reason: 'ส่วนลด',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        await svc.issueCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        const posted = await svc.postCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(posted.status).toBe('POSTED');
        expect(posted.postedAt).toBeInstanceOf(Date);
        expect(posted.postedBy).toBe(ACTOR_ACCOUNT_PLATFORM.id);
    });

    it('cannot POST from DRAFT (must ISSUE first)', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const cn = await svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไข',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        await expect(svc.postCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('POSTED is terminal — cannot cancel', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const cn = await svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CORRECTION',
            reason: 'แก้ไข',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        await svc.issueCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        await svc.postCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        await expect(svc.cancelCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM }))
            .rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('DRAFT → CANCELLED is allowed', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        const cn = await svc.createCreditNote({
            originalInvoiceId: PLATFORM_INVOICE.id,
            reasonCode: 'CANCELLATION',
            reason: 'ยกเลิก',
            subtotal: 100, vat: 7,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        const cancelled = await svc.cancelCreditNote(cn.id, {
            actor: ACTOR_ACCOUNT_PLATFORM, reason: 'wrong amount',
        });
        expect(cancelled.status).toBe('CANCELLED');
    });
});

describe('[B20-A] credit-note-service — constants', () => {
    it('lists valid reason codes', () => {
        const svc = require('../../services/credit-note-service');
        expect(svc.VALID_REASON_CODES).toContain('CANCELLATION');
        expect(svc.VALID_REASON_CODES).toContain('PRICE_REDUCTION');
        expect(svc.VALID_REASON_CODES).toContain('CORRECTION');
        expect(svc.VALID_REASON_CODES).toContain('RETURN');
    });

    it('exposes the canonical state machine', () => {
        const svc = require('../../services/credit-note-service');
        expect(svc.STATUS.DRAFT).toBe('DRAFT');
        expect(svc.STATUS.ISSUED).toBe('ISSUED');
        expect(svc.STATUS.POSTED).toBe('POSTED');
        expect(svc.STATUS.CANCELLED).toBe('CANCELLED');
        expect(svc.ALLOWED_TRANSITIONS.POSTED.size).toBe(0);
    });
});

// ── Bug 5.2 — cap re-check at DRAFT → ISSUED ────────────────────────────────
//
// assertWithinInvoiceCap ran only at CREATE, counting prior ISSUED/POSTED.
// issueCreditNote did NOT re-check. Two DRAFT CNs each pass the cap at create
// (prior ISSUED = 0); both then issue → aggregate ISSUED exceeds the original
// invoice, over-reversing output VAT. The fix re-runs the cap check INSIDE the
// issue $transaction, aggregating prior ISSUED/POSTED (excluding this CN) plus
// this CN's own amount.
//
// This store-backed mock reflects issued/posted rows in aggregate(), so the
// second issue observes the first CN's ISSUED amount.
function createCapMock(initialInvoice) {
    const cnStore = new Map();
    let cnCounter = 0;
    let seq = 0;

    const sumIssuedPosted = (originalInvoiceId, excludeId) => {
        let subtotal = 0;
        let vat = 0;
        for (const row of cnStore.values()) {
            if (row.originalInvoiceId !== originalInvoiceId) { continue; }
            if (row.isDeleted) { continue; }
            if (excludeId && row.id === excludeId) { continue; }
            if (row.status === 'ISSUED' || row.status === 'POSTED') {
                subtotal += Number(row.subtotal) || 0;
                vat += Number(row.vat) || 0;
            }
        }
        return { subtotal, vat };
    };

    const prisma = {
        invoice: {
            findUnique: jest.fn(async ({ where: { id } }) => (
                id === initialInvoice?.id ? { ...initialInvoice } : null
            )),
        },
        creditNote: {
            create: jest.fn(async ({ data }) => {
                cnCounter += 1;
                const id = `cn-${cnCounter}`;
                const row = {
                    id, ...data, isDeleted: false,
                    issuedAt: null, issuedBy: null, postedAt: null, postedBy: null,
                    createdAt: new Date(), updatedAt: new Date(),
                };
                cnStore.set(id, row);
                return row;
            }),
            findUnique: jest.fn(async ({ where: { id }, include }) => {
                const row = cnStore.get(id) || null;
                if (!row) { return null; }
                if (include?.originalInvoice) {
                    return { ...row, originalInvoice: initialInvoice };
                }
                return row;
            }),
            // Conditional claim (issue): matches only while the row still has the
            // expected status — like Postgres re-checking the WHERE after the row lock.
            updateMany: jest.fn(async ({ where: { id, status }, data }) => {
                const existing = cnStore.get(id);
                if (!existing || (status && existing.status !== status)) { return { count: 0 }; }
                cnStore.set(id, { ...existing, ...data });
                return { count: 1 };
            }),
            update: jest.fn(async ({ where: { id }, data }) => {
                const existing = cnStore.get(id);
                if (!existing) { throw new Error('not found'); }
                const updated = { ...existing, ...data, updatedAt: new Date() };
                cnStore.set(id, updated);
                return updated;
            }),
            aggregate: jest.fn(async ({ where }) => {
                // Honour a NOT:{id} exclusion clause the fix uses to drop this CN.
                const excludeId = where?.id?.not || where?.NOT?.id || null;
                const s = sumIssuedPosted(where.originalInvoiceId, excludeId);
                return { _sum: { subtotal: s.subtotal, vat: s.vat } };
            }),
        },
        receiptSequence: { upsert: jest.fn(async () => { seq += 1; return { counter: seq }; }) },
        // Bug 5.2 MF-2: issueCreditNote now takes a SELECT … FOR UPDATE row lock on
        // the original invoice INSIDE the $transaction, BEFORE the cap re-check, so
        // concurrent CN issues against the same invoice serialize. The tx is this
        // same prisma object (function-form $transaction below), so it must expose
        // $queryRaw. Record ordering so the test can prove the lock fired first.
        lockOrder: [],
        $queryRaw: jest.fn(async function queryRaw(strings) {
            const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
            if (/for\s+update/i.test(sql)) { prisma.lockOrder.push('LOCK'); }
            return [];
        }),
        $transaction: jest.fn(async (cbOrArr) => {
            if (typeof cbOrArr === 'function') { return cbOrArr(prisma); }
            return Promise.all(cbOrArr);
        }),
    };
    // Wrap aggregate so the ordering log records the cap-check relative to the lock.
    const rawAggregate = prisma.creditNote.aggregate;
    prisma.creditNote.aggregate = jest.fn(async (args) => {
        prisma.lockOrder.push('AGGREGATE');
        return rawAggregate(args);
    });
    return { prisma, cnStore };
}

describe('Bug 5.2 — credit-note cap re-check at DRAFT → ISSUED', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const CAP_INVOICE = {
        id: 'inv-cap-1',
        invoiceNumber: 'TAX-PRD-2026-00CAP',
        organizationId: 'org-1',
        serviceType: 'PHASE_1_PLATFORM_FEE',
        subtotal: 500,
        vat: 35,
        totalAmount: 535,
        status: 'paid',
        isDeleted: false,
    };

    it('blocks issuing a 2nd CN whose ISSUED total exceeds the cap (was: bypassed)', async () => {
        const { prisma } = createCapMock(CAP_INVOICE);
        const svc = loadService({ prisma });

        // Two DRAFT credit notes, each 400 subtotal / 28 vat. Both individually
        // pass the create-time cap (prior ISSUED = 0), together they exceed 500.
        const cn1 = await svc.createCreditNote({
            originalInvoiceId: CAP_INVOICE.id, reasonCode: 'CORRECTION',
            reason: 'first partial', subtotal: 400, vat: 28,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        const cn2 = await svc.createCreditNote({
            originalInvoiceId: CAP_INVOICE.id, reasonCode: 'CORRECTION',
            reason: 'second partial', subtotal: 400, vat: 28,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });

        // First issue succeeds (400 ≤ 500).
        const issued1 = await svc.issueCreditNote(cn1.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(issued1.status).toBe('ISSUED');

        // MF-2: the FOR UPDATE invoice lock fired BEFORE the cap aggregate.
        expect(prisma.$queryRaw).toHaveBeenCalled();
        expect(prisma.lockOrder.indexOf('LOCK')).toBeGreaterThanOrEqual(0);
        expect(prisma.lockOrder.indexOf('LOCK'))
            .toBeLessThan(prisma.lockOrder.lastIndexOf('AGGREGATE'));

        // Second issue must now FAIL the cap (400 prior ISSUED + 400 = 800 > 500).
        await expect(
            svc.issueCreditNote(cn2.id, { actor: ACTOR_ACCOUNT_PLATFORM }),
        ).rejects.toMatchObject({ code: 'EXCEEDS_INVOICE_SUBTOTAL' });
    });

    it('still allows issuing when within cap (does not over-block)', async () => {
        const { prisma } = createCapMock(CAP_INVOICE);
        const svc = loadService({ prisma });
        const cn = await svc.createCreditNote({
            originalInvoiceId: CAP_INVOICE.id, reasonCode: 'PRICE_REDUCTION',
            reason: 'within cap', subtotal: 200, vat: 14,
            actor: ACTOR_ACCOUNT_PLATFORM,
        });
        const issued = await svc.issueCreditNote(cn.id, { actor: ACTOR_ACCOUNT_PLATFORM });
        expect(issued.status).toBe('ISSUED');
    });
});

describe('[B-PAY-401] listCreditNotesForInvoice — applicant owner read access', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    const OWNED_INVOICE = {
        id: 'inv-owned-1',
        invoiceNumber: 'TAX-PRD-2026-000009',
        organizationId: 'org-1',
        serviceType: 'PHASE_1_PLATFORM_FEE',
        healthId: 'health-owner-1',
        status: 'paid',
        isDeleted: false,
    };

    it('allows a provider (ACCOUNT_PLATFORM) — unchanged behaviour', async () => {
        const svc = loadService(createPrismaMock(OWNED_INVOICE));
        await expect(
            svc.listCreditNotesForInvoice('inv-owned-1', { actor: ACTOR_ACCOUNT_PLATFORM }),
        ).resolves.toBeInstanceOf(Array);
    });

    it('allows the invoice OWNER (HEALTH applicant) to read their own invoice notes', async () => {
        const svc = loadService(createPrismaMock(OWNED_INVOICE));
        const ownerActor = { id: 'u-h1', canonicalRole: 'health', healthId: 'health-owner-1' };
        await expect(
            svc.listCreditNotesForInvoice('inv-owned-1', { actor: ownerActor }),
        ).resolves.toBeInstanceOf(Array);
    });

    it('DENIES a non-owner HEALTH applicant (403) — no cross-user leak', async () => {
        const svc = loadService(createPrismaMock(OWNED_INVOICE));
        const otherActor = { id: 'u-h2', canonicalRole: 'health', healthId: 'health-OTHER' };
        await expect(
            svc.listCreditNotesForInvoice('inv-owned-1', { actor: otherActor }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('DENIES when the invoice does not exist (403)', async () => {
        const svc = loadService(createPrismaMock(OWNED_INVOICE));
        const ownerActor = { id: 'u-h1', canonicalRole: 'health', healthId: 'health-owner-1' };
        await expect(
            svc.listCreditNotesForInvoice('inv-NOPE', { actor: ownerActor }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('still DENIES the general (no-invoice) list for a HEALTH applicant', async () => {
        const svc = loadService(createPrismaMock(OWNED_INVOICE));
        const ownerActor = { id: 'u-h1', canonicalRole: 'health', healthId: 'health-owner-1' };
        await expect(
            svc.listCreditNotes({ actor: ownerActor }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });

    // ── post-detokenize (APP_FK_USE_TOKEN, LIVE prod 2026-06-29) prod shape ──
    // Invoice.healthId stores the keyed-HMAC TOKEN (== actor.canonicalId), NOT
    // the plaintext 13-digit id (== actor.healthId). The walkthrough on staging
    // caught the owner fallback 403-ing the real owner because it compared the
    // token column against the plaintext field (2x console 403 on
    // /health/payments — the applicant refund-visibility panel never loads).
    const TOKENIZED_INVOICE = {
        ...OWNED_INVOICE,
        id: 'inv-owned-tok',
        healthId: 'hmac-token-owner-1', // token, not plaintext
    };

    it('allows the OWNER when Invoice.healthId is the detokenized TOKEN (prod shape)', async () => {
        const svc = loadService(createPrismaMock(TOKENIZED_INVOICE));
        const ownerActor = {
            id: 'u-h1',
            canonicalRole: 'health',
            canonicalId: 'hmac-token-owner-1', // token — matches the FK column
            healthId: '1100000000008', // plaintext — does NOT match the FK column
        };
        await expect(
            svc.listCreditNotesForInvoice('inv-owned-tok', { actor: ownerActor }),
        ).resolves.toBeInstanceOf(Array);
    });

    it('still DENIES a non-owner under the token shape (no cross-user leak)', async () => {
        const svc = loadService(createPrismaMock(TOKENIZED_INVOICE));
        const otherActor = {
            id: 'u-h2',
            canonicalRole: 'health',
            canonicalId: 'hmac-token-OTHER',
            healthId: '2200000000007',
        };
        await expect(
            svc.listCreditNotesForInvoice('inv-owned-tok', { actor: otherActor }),
        ).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe('listCreditNotes — org scoping (cross-tenant read guard)', () => {
    beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

    it('non-ADMIN caller is pinned to OWN org — a supplied organizationId cannot cross tenants', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await svc.listCreditNotes({
            organizationId: 'org-ATTACKER-2', // caller-supplied ?organizationId=
            actor: { id: 'u1', canonicalRole: 'finance_officer_platform', organizationId: 'org-1' },
        });
        // The findMany WHERE must scope to the actor's own org, NOT the supplied one.
        const where = prisma.creditNote.findMany.mock.calls[0][0].where;
        expect(where.organizationId).toBe('org-1');
    });

    it('non-ADMIN caller with no org context is denied (fail-closed)', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await expect(svc.listCreditNotes({
            organizationId: 'org-2',
            actor: { id: 'u1', canonicalRole: 'field_inspector' }, // no organizationId
        })).rejects.toMatchObject({ statusCode: 403 });
        expect(prisma.creditNote.findMany).not.toHaveBeenCalled();
    });

    it('ADMIN may cross-tenant (incident response) — supplied org is honored', async () => {
        const { prisma } = createPrismaMock(PLATFORM_INVOICE);
        const svc = loadService({ prisma });
        await svc.listCreditNotes({
            organizationId: 'org-9',
            actor: { id: 'admin1', canonicalRole: 'system_admin_dtam', organizationId: 'org-1' },
        });
        const where = prisma.creditNote.findMany.mock.calls[0][0].where;
        expect(where.organizationId).toBe('org-9');
    });
});
