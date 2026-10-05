/**
 * Tests for services/vat-report-service.js (B19-C, 2026-05-16).
 *
 * Covers the ภ.พ.30 (Por.Por.30) monthly Output-VAT report:
 *   - Empty month → totals zero, no rows
 *   - Single PLATFORM payment → 1 row, VAT amount matches journal credit
 *   - Multi-scope invoice (3 scopes) → VAT total scales linearly
 *   - CSV: UTF-8 BOM present, RFC-4180 escaping, totals footer row
 *   - Buyer tax ID: corporate (JURISTIC) rendered; individual → '-'
 *   - Period-closable: returns closable=false when pending invoices exist
 *
 * The service module loads Prisma lazily, so we override
 * `services/prisma-database` per-test via jest.doMock and re-require the
 * service inside loadServiceWithMocks() — same idiom used by the sister
 * bank-reconciliation tests so the patterns stay consistent.
 *
 * Legal anchors verified by these tests:
 *   - ป.รัษฎากร ม.83/8 (monthly e-filing cadence — 15th of next month)
 *   - ป.รัษฎากร ม.86/4 (full tax invoice — buyer TIN required when
 *     registered, dash otherwise)
 *   - ประกาศกรมสรรพากร ฉบับที่ 200/2562 (CSV column ordering)
 */

'use strict';

const PLATFORM_VAT_ACCOUNT = '2131-001';

const createPrismaMock = () => {
    const mock = {
        journalLine: { findMany: jest.fn() },
        invoice: {
            count: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
        },
    };
    // C1 fix: the service no longer selects a nested `invoice` relation on
    // JournalEntry (that relation doesn't exist → PrismaClientValidationError
    // → 500). It now fetches invoices separately by the scalar entry.invoiceId.
    // Auto-derive that separate fetch from the `entry.invoice` objects the
    // journal-line fixtures still embed, so every existing test keeps working
    // without per-test rewiring.
    mock.invoice.findMany.mockImplementation(async ({ where } = {}) => {
        const ids = where?.id?.in || [];
        const lines = (await Promise.resolve(mock.journalLine.findMany.mock.results[0]?.value)) || [];
        const byId = new Map();
        for (const l of lines) {
            if (l?.entry?.invoice) { byId.set(l.entry.invoice.id, l.entry.invoice); }
        }
        return ids.map((id) => byId.get(id)).filter(Boolean);
    });
    return mock;
};

function loadServiceWithMocks(prismaMock) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return require('../../services/vat-report-service');
}

function makeVatLine({
    id = 'jl-1',
    credit = 35,
    taxableAmount = 500,
    invoice = null,
    entryDate = new Date('2026-05-15T10:00:00Z'),
} = {}) {
    return {
        id,
        lineNumber: 4,
        accountCode: PLATFORM_VAT_ACCOUNT,
        accountName: 'ภาษีขายตั้งพัก (Output VAT 7%)',
        debit: 0,
        credit,
        taxableAmount,
        issuer: 'PLATFORM',
        metadata: {},
        entry: {
            id: 'je-' + id,
            entryDate,
            reference: 'INV-MAY-001',
            invoiceId: invoice ? invoice.id : null,
            invoice,
        },
    };
}

function makeInvoice({
    id = 'inv-1',
    invoiceNumber = 'INV-2026-05-001',
    paidAt = new Date('2026-05-15T10:00:00Z'),
    billingName = 'Test Buyer',
    serviceType = 'PHASE_1_PLATFORM_FEE',
    applicant = null,
    application = null,
} = {}) {
    return {
        id,
        invoiceNumber,
        paidAt,
        createdAt: paidAt,
        billingName,
        serviceType,
        applicant,
        application,
    };
}

describe('[B19-C] vat-report-service — generateOutputVatReport', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('empty month → totals zero, no rows, inputVat TODO flagged', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalLine.findMany.mockResolvedValue([]);
        const service = loadServiceWithMocks(prismaMock);

        const report = await service.generateOutputVatReport({
            year: 2026,
            month: 5,
            organizationId: 'org-1',
        });

        expect(report.rows).toEqual([]);
        // B20-A: totals now also carries `outputVatBeforeAdjustments` +
        // `outputVatAdjustments` (CN/DN integration). Assert each headline
        // figure individually so the test survives forward-compatible
        // additions to the totals shape.
        expect(report.totals.taxableAmount).toBe(0);
        expect(report.totals.vatAmount).toBe(0);
        expect(report.totals.rowCount).toBe(0);
        expect(report.period.year).toBe(2026);
        expect(report.period.month).toBe(5);
        expect(report.period.monthThai).toBe('พฤษภาคม');
        // ป.รัษฎากร ม.83/8: filing-due date = 15th of NEXT month
        expect(report.period.filingDueDate.toISOString()).toBe('2026-06-15T00:00:00.000Z');
        // Input VAT (ภาษีซื้อ) tracking out of scope for this batch —
        // make sure the TODO flag is surfaced so finance officers don't
        // file blind.
        expect(report.inputVat.tracked).toBe(false);
        expect(report.inputVat.todo).toMatch(/ภาษีซื้อ/);

        // Seller header carries the platform's TIN — ป.รัษฎากร ม.86/4
        // requires the seller's TIN on every VAT report.
        expect(report.seller.taxId).toBe('0105568045932');
        expect(report.seller.vatRate).toBe(0.07);

        // The filter must scope by accountCode (Output VAT line) and the
        // parent entry's date window. Spot-check the call arg.
        const where = prismaMock.journalLine.findMany.mock.calls[0][0].where;
        expect(where.accountCode.in).toEqual(expect.arrayContaining([PLATFORM_VAT_ACCOUNT]));
        // Bangkok month edges (00:00 ICT = 17:00 UTC the day before).
        expect(where.entry.entryDate.gte.toISOString()).toBe('2026-04-30T17:00:00.000Z');
        expect(where.entry.entryDate.lt.toISOString()).toBe('2026-05-31T17:00:00.000Z');
        expect(where.entry.isDeleted).toBe(false);
        expect(where.entry.organizationId).toBe('org-1');
    });

    test('one PLATFORM payment in May 2026 → 1 row, VAT amount equals journal-line credit', async () => {
        const prismaMock = createPrismaMock();
        const invoice = makeInvoice({
            invoiceNumber: 'INV-2026-05-007',
            paidAt: new Date('2026-05-12T03:00:00Z'),
            billingName: 'นาย สมชาย ทดสอบ',
        });
        prismaMock.journalLine.findMany.mockResolvedValue([
            makeVatLine({ credit: 35, taxableAmount: 500, invoice, entryDate: invoice.paidAt }),
        ]);
        const service = loadServiceWithMocks(prismaMock);

        const report = await service.generateOutputVatReport({
            year: 2026, month: 5, organizationId: 'org-1',
        });

        expect(report.rows).toHaveLength(1);
        const row = report.rows[0];
        expect(row.invoiceNumber).toBe('INV-2026-05-007');
        expect(row.vatAmount).toBe(35);
        expect(row.taxableAmount).toBe(500);
        // Individual buyer (no JURISTIC entity) → dash per ม.86/4.
        expect(row.buyerTaxId).toBe('-');
        expect(report.totals.vatAmount).toBe(35);
        expect(report.totals.taxableAmount).toBe(500);
        expect(report.totals.rowCount).toBe(1);
    });

    test('multi-scope invoice (3 scopes) → VAT scales linearly to 105 / taxable 1,500', async () => {
        const prismaMock = createPrismaMock();
        // A 3-scope Phase-1 application produces a platform-fee subtotal
        // of 1,500 (3 × 500) and VAT of 105 (3 × 35). The journal-entry
        // service writes ONE Output VAT line per payment with the
        // scaled credit.
        const invoice = makeInvoice({
            invoiceNumber: 'INV-2026-05-008',
            paidAt: new Date('2026-05-20T08:00:00Z'),
        });
        prismaMock.journalLine.findMany.mockResolvedValue([
            makeVatLine({
                credit: 105,
                taxableAmount: 1500,
                invoice,
                entryDate: invoice.paidAt,
            }),
        ]);
        const service = loadServiceWithMocks(prismaMock);

        const report = await service.generateOutputVatReport({
            year: 2026, month: 5,
        });

        expect(report.totals.vatAmount).toBe(105);
        expect(report.totals.taxableAmount).toBe(1500);
        // Per ม.86/4 we expect 7% of taxable = VAT (within rounding).
        const derivedRate = report.totals.vatAmount / report.totals.taxableAmount;
        expect(derivedRate).toBeCloseTo(0.07, 4);
    });

    test('corporate (JURISTIC) buyer tax ID is rendered; individual buyer shows dash', async () => {
        const prismaMock = createPrismaMock();
        const corporateInvoice = makeInvoice({
            id: 'inv-corp',
            invoiceNumber: 'INV-2026-05-100',
            paidAt: new Date('2026-05-10T03:00:00Z'),
            application: {
                id: 'app-corp',
                applicationNumber: 'GACP-2026-100',
                entity: {
                    id: 'ent-1',
                    type: 'JURISTIC',
                    displayName: 'บริษัท สมุนไพรไทย จำกัด',
                    juristicId: '0105540099999',
                },
            },
        });
        const individualInvoice = makeInvoice({
            id: 'inv-ind',
            invoiceNumber: 'INV-2026-05-101',
            paidAt: new Date('2026-05-11T03:00:00Z'),
            application: {
                id: 'app-ind',
                applicationNumber: 'GACP-2026-101',
                entity: {
                    id: 'ent-2',
                    type: 'INDIVIDUAL',
                    displayName: 'นายเกษตรกร ทดสอบ',
                    juristicId: null,
                },
            },
        });
        prismaMock.journalLine.findMany.mockResolvedValue([
            makeVatLine({ id: 'jl-corp', credit: 35, taxableAmount: 500, invoice: corporateInvoice }),
            makeVatLine({ id: 'jl-ind', credit: 35, taxableAmount: 500, invoice: individualInvoice }),
        ]);
        const service = loadServiceWithMocks(prismaMock);

        const report = await service.generateOutputVatReport({ year: 2026, month: 5 });
        expect(report.rows).toHaveLength(2);

        const corp = report.rows.find((r) => r.invoiceNumber === 'INV-2026-05-100');
        const ind = report.rows.find((r) => r.invoiceNumber === 'INV-2026-05-101');
        expect(corp.buyerType).toBe('JURISTIC');
        expect(corp.buyerTaxId).toBe('0105540099999');
        expect(corp.buyerName).toBe('บริษัท สมุนไพรไทย จำกัด');
        expect(ind.buyerType).toBe('INDIVIDUAL');
        expect(ind.buyerTaxId).toBe('-');
        expect(ind.buyerName).toBe('นายเกษตรกร ทดสอบ');
    });

    test('reversing entry (credit=0) is excluded from the report', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalLine.findMany.mockResolvedValue([
            // Normal credit line — included
            makeVatLine({ id: 'jl-pos', credit: 35, taxableAmount: 500 }),
            // Reversing debit-only line — credit=0, must be skipped
            makeVatLine({ id: 'jl-rev', credit: 0, taxableAmount: 0 }),
        ]);
        const service = loadServiceWithMocks(prismaMock);

        const report = await service.generateOutputVatReport({ year: 2026, month: 5 });
        expect(report.rows).toHaveLength(1);
        expect(report.totals.vatAmount).toBe(35);
    });

    test('C1 regression: JournalLine query selects scalar invoiceId, NOT a nested invoice relation', async () => {
        // The 500 bug was an include of a non-existent JournalEntry.invoice
        // relation. A unit mock can't validate include shape against the real
        // schema, so assert the shape directly: entry.select keeps invoiceId and
        // has NO `invoice` key, and invoices are fetched via a separate
        // prisma.invoice.findMany keyed by id.
        const prismaMock = createPrismaMock();
        const invoice = makeInvoice({ id: 'inv-c1', invoiceNumber: 'INV-C1' });
        prismaMock.journalLine.findMany.mockResolvedValue([
            makeVatLine({ id: 'jl-c1', credit: 35, taxableAmount: 500, invoice }),
        ]);
        const service = loadServiceWithMocks(prismaMock);

        const report = await service.generateOutputVatReport({ year: 2026, month: 5 });

        const include = prismaMock.journalLine.findMany.mock.calls[0][0].include;
        expect(include.entry.select.invoiceId).toBe(true);
        expect(include.entry.select.invoice).toBeUndefined();
        expect(prismaMock.invoice.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: { in: ['inv-c1'] } } }),
        );
        expect(report.rows[0].invoiceNumber).toBe('INV-C1');
    });

    test('rejects invalid year / month', async () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);

        await expect(service.generateOutputVatReport({ year: 1999, month: 5 }))
            .rejects.toThrow(/Invalid year/);
        await expect(service.generateOutputVatReport({ year: 2026, month: 13 }))
            .rejects.toThrow(/Invalid month/);
    });
});

describe('[B19-C] vat-report-service — CSV serialisation', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('UTF-8 BOM prefix present, RFC-4180 escaping, totals footer row', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalLine.findMany.mockResolvedValue([
            makeVatLine({
                invoice: makeInvoice({
                    invoiceNumber: 'INV-2026-05-007',
                    paidAt: new Date('2026-05-12T03:00:00Z'),
                    application: {
                        id: 'app-corp',
                        applicationNumber: 'GACP-2026-100',
                        entity: {
                            type: 'JURISTIC',
                            // Embed a comma in the buyer name to verify CSV quoting.
                            displayName: 'บริษัท ทดสอบ, จำกัด',
                            juristicId: '0105540099999',
                        },
                    },
                }),
                credit: 35,
                taxableAmount: 500,
            }),
        ]);
        const service = loadServiceWithMocks(prismaMock);
        const csv = await service.generateOutputVatReportCSV({ year: 2026, month: 5 });

        // BOM check — must be the literal U+FEFF byte at offset 0.
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        expect(csv.startsWith(service.UTF8_BOM)).toBe(true);

        // Header row must contain the RD e-Filing required columns.
        for (const col of service.CSV_HEADERS) {
            expect(csv).toContain(col);
        }
        expect(csv).toContain('เลขที่ใบกำกับภาษี');
        expect(csv).toContain('เลขประจำตัวผู้เสียภาษีผู้ซื้อ');

        // CRLF line endings (RFC 4180 / Excel).
        expect(csv).toMatch(/\r\n/);

        // Embedded comma in buyer name must be quoted with double-quotes.
        expect(csv).toMatch(/"บริษัท ทดสอบ, จำกัด"/);

        // Totals footer row — first three columns blank, label
        // 'รวมทั้งสิ้น' in the buyer-name slot, then taxable + VAT.
        const lines = csv.split('\r\n');
        const totalsLine = lines.find((l) => l.includes('รวมทั้งสิ้น'));
        expect(totalsLine).toBeDefined();
        expect(totalsLine).toContain('500.00');
        expect(totalsLine).toContain('35.00');

        // Buyer TIN column carries the JURISTIC ID, not a dash.
        expect(csv).toContain('0105540099999');
    });

    test('CSV handles empty month — header + empty totals footer only', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.journalLine.findMany.mockResolvedValue([]);
        const service = loadServiceWithMocks(prismaMock);

        const csv = await service.generateOutputVatReportCSV({ year: 2026, month: 5 });
        const lines = csv.split('\r\n').filter((l) => l.length > 0);
        // Expect 2 non-empty lines: header + totals.
        expect(lines).toHaveLength(2);
        expect(lines[1]).toContain('รวมทั้งสิ้น');
        expect(lines[1]).toContain('0.00');
    });

    test('CSV escapes double-quotes by doubling them per RFC 4180', () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        const escaped = service._internals.csvEscape('he said "hi"');
        expect(escaped).toBe('"he said ""hi"""');
    });

    test('CSV serialises Date as YYYY-MM-DD and number as fixed-2 decimal', () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        expect(service._internals.csvEscape(new Date('2026-05-15T03:00:00Z'))).toBe('2026-05-15');
        expect(service._internals.csvEscape(1535)).toBe('1535.00');
        expect(service._internals.csvEscape(0.7)).toBe('0.70');
    });
});

describe('[B19-C] vat-report-service — checkPeriodClosable', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('returns closable=true when no pending invoices in window', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.invoice.count.mockResolvedValue(0);
        prismaMock.invoice.findFirst.mockResolvedValue({
            paidAt: new Date('2026-05-30T10:00:00Z'),
        });
        const service = loadServiceWithMocks(prismaMock);

        const result = await service.checkPeriodClosable({
            year: 2026, month: 5, organizationId: 'org-1',
        });
        expect(result.closable).toBe(true);
        expect(result.openInvoices).toBe(0);
        expect(result.warnings).toEqual([]);
        expect(result.lastPaidInvoiceDate.toISOString()).toBe('2026-05-30T10:00:00.000Z');
    });

    test('returns closable=false when pending invoices exist in the period', async () => {
        const prismaMock = createPrismaMock();
        prismaMock.invoice.count.mockResolvedValue(3);
        prismaMock.invoice.findFirst.mockResolvedValue(null);
        const service = loadServiceWithMocks(prismaMock);

        const result = await service.checkPeriodClosable({
            year: 2026, month: 5, organizationId: 'org-1',
        });
        expect(result.closable).toBe(false);
        expect(result.openInvoices).toBe(3);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0]).toMatch(/3 pending invoice/);
        // The warning text should reference ภ.พ.30 amendment so the
        // user knows the legal consequence of filing while open
        // invoices remain.
        expect(result.warnings[0]).toMatch(/ภ\.พ\.30/);
    });

    test('rejects invalid year / month', async () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        await expect(service.checkPeriodClosable({ year: 1999, month: 5 }))
            .rejects.toThrow(/Invalid year/);
        await expect(service.checkPeriodClosable({ year: 2026, month: 0 }))
            .rejects.toThrow(/Invalid month/);
    });
});

describe('[B19-C] vat-report-service — helpers', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('monthThai returns the Thai month name', () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        expect(service._internals.monthThai(1)).toBe('มกราคม');
        expect(service._internals.monthThai(5)).toBe('พฤษภาคม');
        expect(service._internals.monthThai(12)).toBe('ธันวาคม');
    });

    test('toMonthBoundaries pins the Bangkok start/end of month', () => {
        // The tax month is the Bangkok calendar month: 00:00 ICT on the 1st
        // is 17:00 UTC the day before (CODE-X1, audit 2026-09-17).
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        const { start, end } = service._internals.toMonthBoundaries(2026, 5);
        expect(start.toISOString()).toBe('2026-04-30T17:00:00.000Z');
        expect(end.toISOString()).toBe('2026-05-31T17:00:00.000Z');
    });

    test('OUTPUT_VAT_ACCOUNT_CODES includes canonical 2131-001 plus legacy fallbacks', () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        expect(service.OUTPUT_VAT_ACCOUNT_CODES).toContain('2131-001');
        // Legacy codes from older chart revisions must remain reportable
        // (ป.รัษฎากร requires ALL output VAT in the period).
        expect(service.OUTPUT_VAT_ACCOUNT_CODES).toContain('2210');
    });

    test('INPUT_VAT_ACCOUNT_CODES exposes the canonical 1310-001 (Iter 26)', () => {
        const prismaMock = createPrismaMock();
        const service = loadServiceWithMocks(prismaMock);
        expect(service.INPUT_VAT_ACCOUNT_CODES).toContain('1310-001');
    });
});

// ─────────────────────────────────────────────────────────────────────────
// Iter 26 (2026-05-16) — Input VAT (ภาษีซื้อ) integration per
// ป.รัษฎากร ม.82/3 + ม.82/4 + ม.83/8.
// ─────────────────────────────────────────────────────────────────────────

describe('[Iter26] vat-report-service — generateInputVatReport', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    function createInputVatPrismaMock(purchaseRows = []) {
        return {
            journalLine: { findMany: jest.fn().mockResolvedValue([]) },
            invoice: {
                count: jest.fn().mockResolvedValue(0),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            purchaseInvoice: {
                findMany: jest.fn().mockResolvedValue(purchaseRows),
            },
        };
    }

    test('returns empty totals when no APPROVED purchase invoices exist', async () => {
        const prismaMock = createInputVatPrismaMock([]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateInputVatReport({
            year: 2026, month: 5, organizationId: 'org-1',
        });
        expect(report.rows).toEqual([]);
        expect(report.totals.taxableAmount).toBe(0);
        expect(report.totals.vatAmount).toBe(0);
        expect(report.totals.rowCount).toBe(0);
        expect(report.source).toBe('purchase_invoices');
        // ม.83/8 — filing-due date 15th of next month, same shape as Output.
        expect(report.period.filingDueDate.toISOString())
            .toBe('2026-06-15T00:00:00.000Z');
    });

    test('aggregates per-row taxable + VAT across APPROVED rows', async () => {
        const prismaMock = createInputVatPrismaMock([
            {
                id: 'pi-1',
                invoiceNumber: 'SUP-001',
                supplierName: 'ABC Ltd',
                supplierTaxId: '0105540099999',
                supplierAddress: '123 Test',
                invoiceDate: new Date('2026-05-10T03:00:00Z'),
                subtotal: 1000,
                vat: 70,
                totalAmount: 1070,
                category: 'OFFICE_SUPPLIES',
                description: null,
                organizationId: 'org-1',
            },
            {
                id: 'pi-2',
                invoiceNumber: 'SUP-002',
                supplierName: 'XYZ Co',
                supplierTaxId: '0103530021111',
                supplierAddress: null,
                invoiceDate: new Date('2026-05-22T03:00:00Z'),
                subtotal: 500,
                vat: 35,
                totalAmount: 535,
                category: 'UTILITIES',
                description: 'electricity',
                organizationId: 'org-1',
            },
        ]);
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateInputVatReport({
            year: 2026, month: 5, organizationId: 'org-1',
        });
        expect(report.rows).toHaveLength(2);
        expect(report.totals.taxableAmount).toBe(1500);
        expect(report.totals.vatAmount).toBe(105);
        expect(report.totals.rowCount).toBe(2);
        // ม.86/4 — supplier TIN must be on every Input VAT row.
        expect(report.rows[0].supplierTaxId).toBe('0105540099999');
        expect(report.rows[1].supplierTaxId).toBe('0103530021111');
    });

    test('only scans APPROVED rows in the (start, end) window', async () => {
        const prismaMock = createInputVatPrismaMock([]);
        const service = loadServiceWithMocks(prismaMock);
        await service.generateInputVatReport({
            year: 2026, month: 5, organizationId: 'org-1',
        });
        const callArg = prismaMock.purchaseInvoice.findMany.mock.calls[0][0];
        expect(callArg.where.status).toBe('APPROVED');
        expect(callArg.where.isDeleted).toBe(false);
        // Bangkok month edges (00:00 ICT = 17:00 UTC the day before).
        expect(callArg.where.invoiceDate.gte.toISOString())
            .toBe('2026-04-30T17:00:00.000Z');
        expect(callArg.where.invoiceDate.lt.toISOString())
            .toBe('2026-05-31T17:00:00.000Z');
        expect(callArg.where.organizationId).toBe('org-1');
    });

    test('returns source:unavailable when PurchaseInvoice delegate is missing', async () => {
        const prismaMock = {
            journalLine: { findMany: jest.fn().mockResolvedValue([]) },
            invoice: {
                count: jest.fn().mockResolvedValue(0),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            // No purchaseInvoice delegate — simulates pre-migration state.
        };
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateInputVatReport({
            year: 2026, month: 5,
        });
        expect(report.source).toBe('unavailable');
        expect(report.rows).toEqual([]);
    });
});

describe('[Iter26] vat-report-service — generateOutputVatReport with Input side', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('inputVat block computes from APPROVED PurchaseInvoice rows', async () => {
        const prismaMock = {
            journalLine: { findMany: jest.fn().mockResolvedValue([
                makeVatLine({ credit: 100, taxableAmount: 1500 }),
            ]) },
            invoice: {
                count: jest.fn().mockResolvedValue(0),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            purchaseInvoice: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'pi-1', subtotal: 600, vat: 42, totalAmount: 642 },
                    { id: 'pi-2', subtotal: 400, vat: 28, totalAmount: 428 },
                ]),
            },
        };
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateOutputVatReport({
            year: 2026, month: 5, organizationId: 'org-1',
        });
        // Output side unchanged.
        expect(report.totals.vatAmount).toBe(100);
        // Input side now populated (Iter 26).
        expect(report.inputVat.tracked).toBe(true);
        expect(report.inputVat.vatAmount).toBe(70); // 42 + 28
        expect(report.inputVat.taxableAmount).toBe(1000);
        expect(report.inputVat.rowCount).toBe(2);
        // Net VAT = Output − Input per ป.รัษฎากร ม.82/3.
        expect(report.totals.netVatPayable).toBe(30); // 100 − 70
    });

    test('falls back to tracked:false marker when PurchaseInvoice missing', async () => {
        const prismaMock = {
            journalLine: { findMany: jest.fn().mockResolvedValue([]) },
            invoice: {
                count: jest.fn().mockResolvedValue(0),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            // No purchaseInvoice delegate — legacy fallback path.
        };
        const service = loadServiceWithMocks(prismaMock);
        const report = await service.generateOutputVatReport({
            year: 2026, month: 5,
        });
        expect(report.inputVat.tracked).toBe(false);
        expect(report.inputVat.todo).toMatch(/ภาษีซื้อ/);
        // netVatPayable cannot be computed in fallback path.
        expect(report.totals.netVatPayable).toBeNull();
    });

    test('collectInputVatSummary helper rounds + aggregates', async () => {
        const prismaMock = {
            journalLine: { findMany: jest.fn().mockResolvedValue([]) },
            invoice: {
                count: jest.fn().mockResolvedValue(0),
                findFirst: jest.fn().mockResolvedValue(null),
            },
            purchaseInvoice: {
                findMany: jest.fn().mockResolvedValue([
                    { subtotal: 333.33, vat: 23.33 },
                    { subtotal: 666.67, vat: 46.67 },
                ]),
            },
        };
        const service = loadServiceWithMocks(prismaMock);
        const summary = await service._internals.collectInputVatSummary({
            prisma: prismaMock,
            start: new Date('2026-05-01T00:00:00Z'),
            end:   new Date('2026-06-01T00:00:00Z'),
            organizationId: 'org-1',
        });
        expect(summary.taxableAmount).toBe(1000);
        expect(summary.vatAmount).toBe(70);
        expect(summary.rowCount).toBe(2);
    });
});
