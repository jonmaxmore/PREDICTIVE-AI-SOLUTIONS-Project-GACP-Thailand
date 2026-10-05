/**
 * Tests for services/wht-service.js (Iter 26 / hardening loop, 2026-05-16).
 *
 * Anchors:
 *   - isCorporateBuyer: JURISTIC / COMPANY → true; INDIVIDUAL / null → false.
 *   - computeWhtAmount: ม.50 standard 3% — 500 → 15, 535 → 16.05, etc.
 *   - recordWhtCertificate:
 *       - rejects unpaid invoice (409)
 *       - rejects STATE-fee invoice (422 — only PLATFORM is subject to WHT)
 *       - rejects whtAmount > subtotal (cap by RD logic)
 *       - rejects bad TIN / missing fields
 *       - idempotent: same cert number → returns existing
 *       - conflict on different cert number for same invoice
 *       - happy path: persists on Invoice.metadata.whtCertificate
 *       - recordJournal=true emits stub log (journal hook not yet wired)
 *   - listWhtCertificates: filters by date range + organizationId.
 *   - isWhtApplicableForInvoice: covers each failure branch (not paid,
 *     state fee, individual buyer, already recorded).
 *
 * Legal anchors:
 *   - ป.รัษฎากร ม.50 (duty of payer to withhold)
 *   - ป.รัษฎากร ม.69 ทวิ (issuance of ทบ.50 ทวิ)
 *   - ภ.ง.ด.53 (monthly remittance — out of scope; stub)
 */

'use strict';

function createPrismaMock(initialInvoices = []) {
    const store = new Map();
    for (const inv of initialInvoices) {
        store.set(inv.id, { ...inv });
    }

    const invoiceModel = {
        findUnique: jest.fn(async ({ where: { id }, select: _s }) => {
            const row = store.get(id) || null;
            if (!row) {return null;}
            // Honour the deep select shape used by isWhtApplicableForInvoice
            // — the mock simply returns the whole row, which is a strict
            // superset.
            return { ...row };
        }),
        findMany: jest.fn(async ({ where, orderBy: _o, select: _s }) => {
            const all = Array.from(store.values());
            return all.filter((inv) => {
                if (where?.isDeleted === false && inv.isDeleted) {return false;}
                if (where?.status && inv.status !== where.status) {return false;}
                if (where?.serviceType?.in
                    && !where.serviceType.in.includes(inv.serviceType)) {
                    return false;
                }
                if (where?.organizationId && inv.organizationId !== where.organizationId) {
                    return false;
                }
                return true;
            });
        }),
        update: jest.fn(async ({ where: { id }, data }) => {
            const existing = store.get(id);
            if (!existing) {throw new Error('not found');}
            const next = { ...existing, ...data };
            store.set(id, next);
            return next;
        }),
    };

    return {
        prisma: { invoice: invoiceModel },
        store,
    };
}

function loadService(prismaMock) {
    jest.doMock('../../services/prisma-database', () => ({
        prisma: prismaMock.prisma,
    }));
    return require('../../services/wht-service');
}

function paidPlatformInvoice(overrides = {}) {
    return {
        id: 'inv-1',
        invoiceNumber: 'INV-PRD-2026-0001',
        serviceType: 'PHASE_1_PLATFORM_FEE',
        status: 'paid',
        subtotal: 500,
        vat: 35,
        totalAmount: 535,
        isDeleted: false,
        organizationId: 'org-1',
        paidAt: new Date('2026-05-10T10:00:00Z'),
        metadata: null,
        application: {
            entity: { type: 'JURISTIC' },
        },
        applicant: { taxId: '0105568045932' },
        ...overrides,
    };
}

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
});

describe('[Iter 26] wht-service — isCorporateBuyer', () => {
    test('JURISTIC entity → true', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(svc.isCorporateBuyer({ type: 'JURISTIC' })).toBe(true);
    });

    test('COMPANY alias (legacy admin form) → true', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(svc.isCorporateBuyer({ entityType: 'COMPANY' })).toBe(true);
    });

    test('INDIVIDUAL entity → false (farmer applicant)', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(svc.isCorporateBuyer({ type: 'INDIVIDUAL' })).toBe(false);
    });

    test('nested entity inside application → unwraps and re-evaluates', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(
            svc.isCorporateBuyer({ entity: { type: 'JURISTIC' } }),
        ).toBe(true);
        expect(
            svc.isCorporateBuyer({ entity: { type: 'INDIVIDUAL' } }),
        ).toBe(false);
    });

    test('null / undefined / missing type → false', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(svc.isCorporateBuyer(null)).toBe(false);
        expect(svc.isCorporateBuyer(undefined)).toBe(false);
        expect(svc.isCorporateBuyer({})).toBe(false);
    });
});

describe('[Iter 26] wht-service — computeWhtAmount (ม.50 standard 3%)', () => {
    test('500 × 3% = 15.00 ; net = 485', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(svc.computeWhtAmount(500)).toEqual({
            wht: 15, net: 485, gross: 500, rate: 0.03,
        });
    });

    test('535 × 3% = 16.05 ; net = 518.95 (gross-incl-VAT example)', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        const result = svc.computeWhtAmount(535);
        expect(result.wht).toBe(16.05);
        expect(result.net).toBe(518.95);
        // gross = wht + net (no drift)
        expect(result.wht + result.net).toBeCloseTo(535, 2);
    });

    test('2500 × 3% = 75.00 (Phase 2 platform fee)', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(svc.computeWhtAmount(2500).wht).toBe(75);
    });

    test('custom rate (5%) → 25 on 500', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(svc.computeWhtAmount(500, 0.05).wht).toBe(25);
    });

    test('rejects negative gross', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(() => svc.computeWhtAmount(-1)).toThrow(/non-negative/);
    });

    test('rejects rate outside [0, 1]', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(() => svc.computeWhtAmount(500, 1.5)).toThrow(/rate/);
        expect(() => svc.computeWhtAmount(500, -0.01)).toThrow(/rate/);
    });
});

describe('[Iter 26] wht-service — recordWhtCertificate', () => {
    const VALID_CERT = {
        certificateNumber: 'WHT-2026-001',
        issuedByTaxId: '0105566001234',
        issuedByName: 'บริษัท ตัวอย่าง จำกัด',
        certificateDate: '2026-05-15',
        whtAmount: 15,
    };

    test('rejects when invoice is not paid (409)', async () => {
        const inv = paidPlatformInvoice({ status: 'pending' });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        await expect(
            svc.recordWhtCertificate({ invoiceId: 'inv-1', ...VALID_CERT }),
        ).rejects.toMatchObject({ code: 'INVOICE_NOT_PAID', statusCode: 409 });
    });

    test('rejects STATE-fee invoice (422 — state revenue not subject to WHT)', async () => {
        const inv = paidPlatformInvoice({ serviceType: 'PHASE_1_STATE_FEE' });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        await expect(
            svc.recordWhtCertificate({ invoiceId: 'inv-1', ...VALID_CERT }),
        ).rejects.toMatchObject({
            code: 'NOT_PLATFORM_INVOICE',
            statusCode: 422,
        });
    });

    test('rejects whtAmount > subtotal (cap by RD logic)', async () => {
        const inv = paidPlatformInvoice({ subtotal: 500 });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        await expect(
            svc.recordWhtCertificate({
                invoiceId: 'inv-1',
                ...VALID_CERT,
                whtAmount: 600,
            }),
        ).rejects.toMatchObject({ code: 'WHT_EXCEEDS_SUBTOTAL' });
    });

    test('rejects invalid Thai TIN (must be exactly 13 digits)', async () => {
        const inv = paidPlatformInvoice();
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        await expect(
            svc.recordWhtCertificate({
                invoiceId: 'inv-1',
                ...VALID_CERT,
                issuedByTaxId: '12345', // too short
            }),
        ).rejects.toMatchObject({ code: 'INVALID_BUYER_TAX_ID' });
    });

    test('happy path: persists ทบ.50 ทวิ on Invoice.metadata.whtCertificate', async () => {
        const inv = paidPlatformInvoice();
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const result = await svc.recordWhtCertificate({
            invoiceId: 'inv-1',
            ...VALID_CERT,
        });
        expect(result.invoiceId).toBe('inv-1');
        expect(result.certificateNumber).toBe('WHT-2026-001');
        expect(result.whtAmount).toBe(15);
        expect(prismaMock.prisma.invoice.update).toHaveBeenCalledTimes(1);
        const persisted = prismaMock.store.get('inv-1');
        expect(persisted.metadata.whtCertificate.certificateNumber)
            .toBe('WHT-2026-001');
        expect(persisted.metadata.whtCertificate.rate).toBe(0.03);
        expect(persisted.metadata.whtCertificate.source).toBe('BUYER_ISSUED');
    });

    // BUGHUNT-2.2 MF-1: a legacy invoice whose metadata was double-encoded to a
    // JSON STRING (old holdInvoice JSON.stringify) must self-heal in the WHT path.
    test('MF-1a: STRING metadata — dup-guard still fires (was bypassed by string index)', async () => {
        const legacyMeta = JSON.stringify({
            whtCertificate: { certificateNumber: 'WHT-2026-001', whtAmount: 15, recordedAt: '2026-05-15T00:00:00Z' },
        });
        const inv = paidPlatformInvoice({ metadata: legacyMeta });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const dup = await svc.recordWhtCertificate({ invoiceId: 'inv-1', ...VALID_CERT });
        expect(dup.alreadyRecorded).toBe(true); // was: string.whtCertificate === undefined → double-recorded
        expect(prismaMock.prisma.invoice.update).not.toHaveBeenCalled();
    });

    test('MF-1b: STRING metadata — persisting a WHT cert PRESERVES the .refund block (no double-refund)', async () => {
        // Released-hold invoice: metadata is a string carrying a refund block but no cert yet.
        const legacyMeta = JSON.stringify({ refund: { status: 'INITIATED', creditNoteId: 'cn-1' } });
        const inv = paidPlatformInvoice({ metadata: legacyMeta });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        await svc.recordWhtCertificate({ invoiceId: 'inv-1', ...VALID_CERT });
        const persisted = prismaMock.store.get('inv-1');
        expect(typeof persisted.metadata).toBe('object');
        expect(persisted.metadata.whtCertificate.certificateNumber).toBe('WHT-2026-001');
        // The refund idempotency block MUST survive (spreading a string dropped it → double-refund).
        expect(persisted.metadata.refund).toEqual({ status: 'INITIATED', creditNoteId: 'cn-1' });
    });

    test('idempotency: re-recording the SAME cert returns alreadyRecorded', async () => {
        const inv = paidPlatformInvoice();
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        await svc.recordWhtCertificate({ invoiceId: 'inv-1', ...VALID_CERT });
        // Second call with same payload — should NOT write again.
        prismaMock.prisma.invoice.update.mockClear();
        const result = await svc.recordWhtCertificate({
            invoiceId: 'inv-1',
            ...VALID_CERT,
        });
        expect(result.alreadyRecorded).toBe(true);
        expect(prismaMock.prisma.invoice.update).not.toHaveBeenCalled();
    });

    test('conflict: DIFFERENT cert number on same invoice → 409', async () => {
        const inv = paidPlatformInvoice();
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        await svc.recordWhtCertificate({ invoiceId: 'inv-1', ...VALID_CERT });
        await expect(
            svc.recordWhtCertificate({
                invoiceId: 'inv-1',
                ...VALID_CERT,
                certificateNumber: 'WHT-2026-002', // different
            }),
        ).rejects.toMatchObject({
            code: 'WHT_CERTIFICATE_ALREADY_RECORDED',
            statusCode: 409,
        });
    });

    test('recordJournal=true: emits stub log line (hook not yet wired)', async () => {
        const inv = paidPlatformInvoice();
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const result = await svc.recordWhtCertificate({
            invoiceId: 'inv-1',
            ...VALID_CERT,
            recordJournal: true,
        });
        // No real journal entry — but journalRef returns a marker so the
        // caller can surface "manual entry needed" in the UI.
        expect(result.journalRef).toMatchObject({ stub: true });
    });

    test('rejects when invoice not found (404)', async () => {
        const prismaMock = createPrismaMock([]);
        const svc = loadService(prismaMock);
        await expect(
            svc.recordWhtCertificate({
                invoiceId: 'inv-missing',
                ...VALID_CERT,
            }),
        ).rejects.toMatchObject({ code: 'INVOICE_NOT_FOUND', statusCode: 404 });
    });
});

describe('[Iter 26] wht-service — listWhtCertificates', () => {
    test('returns empty list when no invoices carry a cert', async () => {
        const prismaMock = createPrismaMock([
            paidPlatformInvoice({ id: 'inv-a' }),
            paidPlatformInvoice({ id: 'inv-b' }),
        ]);
        const svc = loadService(prismaMock);
        const list = await svc.listWhtCertificates({
            startDate: '2026-05-01',
            endDate: '2026-06-01',
        });
        expect(list).toEqual([]);
    });

    test('returns recorded certs in window', async () => {
        const certPayload = {
            certificateNumber: 'WHT-2026-001',
            issuedByTaxId: '0105566001234',
            issuedByName: 'A Co Ltd',
            certificateDate: '2026-05-15T00:00:00.000Z',
            whtAmount: 15,
            rate: 0.03,
            attachmentId: null,
            recordedAt: '2026-05-15T10:00:00.000Z',
            recordedBy: 'user-1',
            source: 'BUYER_ISSUED',
        };
        const inv = paidPlatformInvoice({
            id: 'inv-with-cert',
            metadata: { whtCertificate: certPayload },
        });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const list = await svc.listWhtCertificates({
            startDate: '2026-05-01',
            endDate: '2026-06-01',
            organizationId: 'org-1',
        });
        expect(list).toHaveLength(1);
        expect(list[0].invoiceId).toBe('inv-with-cert');
        expect(list[0].certificateNumber).toBe('WHT-2026-001');
        expect(list[0].invoiceSubtotal).toBe(500);
    });

    test('filters by date range — cert before window excluded', async () => {
        const inv = paidPlatformInvoice({
            id: 'inv-old-cert',
            metadata: {
                whtCertificate: {
                    certificateNumber: 'WHT-2026-OLD',
                    issuedByTaxId: '0105566001234',
                    issuedByName: 'A Co Ltd',
                    certificateDate: '2026-03-15T00:00:00.000Z',
                    whtAmount: 15,
                    rate: 0.03,
                    attachmentId: null,
                    recordedAt: '2026-03-15T10:00:00.000Z',
                    recordedBy: 'user-1',
                    source: 'BUYER_ISSUED',
                },
            },
        });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const list = await svc.listWhtCertificates({
            startDate: '2026-05-01',
            endDate: '2026-06-01',
        });
        expect(list).toEqual([]);
    });
});

describe('[Iter 26] wht-service — isWhtApplicableForInvoice', () => {
    test('PLATFORM + paid + JURISTIC → applicable with indicative wht=15', async () => {
        const inv = paidPlatformInvoice();
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const r = await svc.isWhtApplicableForInvoice('inv-1');
        expect(r.applicable).toBe(true);
        expect(r.reason).toBe('CORPORATE_BUYER_PLATFORM_PAID');
        expect(r.indicativeWht).toBe(15);
        expect(r.alreadyRecorded).toBe(false);
    });

    test('INDIVIDUAL buyer → not applicable', async () => {
        const inv = paidPlatformInvoice({
            application: { entity: { type: 'INDIVIDUAL' } },
        });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const r = await svc.isWhtApplicableForInvoice('inv-1');
        expect(r.applicable).toBe(false);
        expect(r.reason).toBe('INDIVIDUAL_BUYER');
    });

    test('STATE-fee invoice → not applicable', async () => {
        const inv = paidPlatformInvoice({ serviceType: 'PHASE_1_STATE_FEE' });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const r = await svc.isWhtApplicableForInvoice('inv-1');
        expect(r.applicable).toBe(false);
        expect(r.reason).toBe('NOT_PLATFORM_INVOICE');
    });

    test('unpaid invoice → not applicable', async () => {
        const inv = paidPlatformInvoice({ status: 'pending' });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const r = await svc.isWhtApplicableForInvoice('inv-1');
        expect(r.applicable).toBe(false);
        expect(r.reason).toBe('INVOICE_NOT_PAID');
    });

    test('already-recorded cert surfaces in flag', async () => {
        const inv = paidPlatformInvoice({
            metadata: {
                whtCertificate: { certificateNumber: 'WHT-2026-001' },
            },
        });
        const prismaMock = createPrismaMock([inv]);
        const svc = loadService(prismaMock);
        const r = await svc.isWhtApplicableForInvoice('inv-1');
        expect(r.applicable).toBe(true);
        expect(r.alreadyRecorded).toBe(true);
    });
});

describe('[Iter 26] wht-service — role gates', () => {
    // operator 2026-09-11 / 2026-09-27: both finance roles + admin read; field_inspector no longer does
    test('assertReadRole accepts both finance roles + ADMIN, refuses field_inspector', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(() => svc.assertReadRole({ canonicalRole: 'finance_officer_platform' })).not.toThrow();
        expect(() => svc.assertReadRole({ canonicalRole: 'finance_officer_dtam' })).not.toThrow();
        expect(() => svc.assertReadRole({ canonicalRole: 'system_admin_dtam' })).not.toThrow();
        expect(() => svc.assertReadRole({ canonicalRole: 'field_inspector' })).toThrow(expect.objectContaining({ statusCode: 403 }));
    });

    test('assertReadRole rejects HEALTH applicant role (403)', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(() => svc.assertReadRole({ canonicalRole: 'health' }))
            .toThrow(/role/i);
    });

    test('assertWriteRole rejects AUDITOR (read-only)', () => {
        const prismaMock = createPrismaMock();
        const svc = loadService(prismaMock);
        expect(() => svc.assertWriteRole({ canonicalRole: 'field_inspector' }))
            .toThrow(/role/i);
    });
});
