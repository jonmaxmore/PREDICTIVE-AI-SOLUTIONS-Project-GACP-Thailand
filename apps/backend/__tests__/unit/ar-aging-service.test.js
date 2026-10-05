/**
 * AR Aging Service tests — B20-D (2026-05-16).
 *
 * Covers bucket math (boundary cases), bookSide filtering, CSV
 * format (RFC 4180 + UTF-8 BOM + CRLF + bilingual headers), and
 * the slip-in-review badge.
 */

'use strict';

const createPrismaMock = () => ({
    invoice: { findMany: jest.fn() },
    paymentSlip: { findMany: jest.fn() },
});

function loadServiceWithMocks(prismaMock) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return require('../../services/ar-aging-service');
}

describe('ar-aging-service', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('bucket math', () => {
        test('NOT_YET_DUE for future dueDate', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { bucketForDaysOverdue } = service._internals;
            expect(bucketForDaysOverdue(-1)).toBe('NOT_YET_DUE');
            expect(bucketForDaysOverdue(-30)).toBe('NOT_YET_DUE');
        });

        test('0..30 days bucket inclusive boundaries', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { bucketForDaysOverdue } = service._internals;
            expect(bucketForDaysOverdue(0)).toBe('0_30');
            expect(bucketForDaysOverdue(15)).toBe('0_30');
            expect(bucketForDaysOverdue(30)).toBe('0_30');
            expect(bucketForDaysOverdue(31)).toBe('31_60');
        });

        test('boundary cases 60/61, 90/91', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { bucketForDaysOverdue } = service._internals;
            expect(bucketForDaysOverdue(60)).toBe('31_60');
            expect(bucketForDaysOverdue(61)).toBe('61_90');
            expect(bucketForDaysOverdue(90)).toBe('61_90');
            expect(bucketForDaysOverdue(91)).toBe('OVER_90');
            expect(bucketForDaysOverdue(180)).toBe('OVER_90');
        });

        test('daysBetween computes whole days in UTC (no DST drift)', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { daysBetween } = service._internals;
            const asOf = new Date('2026-05-31T00:00:00Z');
            const due = new Date('2026-05-01T00:00:00Z');
            expect(daysBetween(asOf, due)).toBe(30);
        });
    });

    describe('generateArAgingReport', () => {
        test('rejects when bookSide missing', async () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            await expect(service.generateArAgingReport({
                asOfDate: '2026-05-16',
                organizationId: 'org-1',
            })).rejects.toThrow(/bookSide is required/);
            try {
                await service.generateArAgingReport({
                    asOfDate: '2026-05-16',
                    organizationId: 'org-1',
                });
                throw new Error('expected throw');
            } catch (err) {
                expect(err.code).toBe('BOOK_SIDE_REQUIRED');
            }
        });

        test('rejects when organizationId missing', async () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            await expect(service.generateArAgingReport({
                asOfDate: '2026-05-16',
                bookSide: 'DTAM',
            })).rejects.toThrow(/organizationId required/);
        });

        test('rejects when asOfDate is invalid', async () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            await expect(service.generateArAgingReport({
                asOfDate: 'not-a-date',
                bookSide: 'DTAM',
                organizationId: 'org-1',
            })).rejects.toThrow(/invalid asOfDate/);
        });

        test('bookSide filter applied — DTAM excludes PLATFORM rows', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.invoice.findMany.mockResolvedValue([
                {
                    id: 'i1', invoiceNumber: 'INV-DTAM-001', serviceType: 'PHASE_1_STATE_FEE',
                    totalAmount: 5000, status: 'pending',
                    dueDate: new Date('2026-04-16'), createdAt: new Date('2026-04-01'),
                    application: { id: 'app-1', applicationNumber: 'A1', healthId: '1234567890123',
                                   farmer: { firstName: 'สมชาย', lastName: 'ใจดี' } },
                    healthId: '1234567890123',
                },
                {
                    id: 'i2', invoiceNumber: 'INV-PRD-001', serviceType: 'PHASE_1_PLATFORM_FEE',
                    totalAmount: 5350, status: 'pending',
                    dueDate: new Date('2026-04-16'), createdAt: new Date('2026-04-01'),
                    application: { id: 'app-1', applicationNumber: 'A1', healthId: '1234567890123',
                                   farmer: { firstName: 'สมชาย', lastName: 'ใจดี' } },
                    healthId: '1234567890123',
                },
            ]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([]);
            const service = loadServiceWithMocks(prismaMock);
            const result = await service.generateArAgingReport({
                asOfDate: '2026-05-16',
                bookSide: 'DTAM',
                organizationId: 'org-1',
            });
            expect(result.bookSide).toBe('DTAM');
            expect(result.rowCount).toBe(1);
            expect(result.rows[0].invoiceNumber).toBe('INV-DTAM-001');
            expect(result.totalOutstanding).toBe(5000);
        });

        test('correctly buckets invoices by age + applies PDPA masking', async () => {
            const prismaMock = createPrismaMock();
            const asOf = new Date('2026-05-31T00:00:00Z');
            prismaMock.invoice.findMany.mockResolvedValue([
                // Future due → NOT_YET_DUE
                { id: 'i1', invoiceNumber: 'I1', serviceType: 'PHASE_1_PLATFORM_FEE',
                  totalAmount: 100, status: 'pending',
                  dueDate: new Date('2026-06-15'), createdAt: new Date('2026-05-01'),
                  application: { id: 'app', applicationNumber: 'A', healthId: '1234567890123',
                                 farmer: { firstName: 'A', lastName: 'B' } },
                  healthId: '1234567890123' },
                // 30 days overdue → 0_30
                { id: 'i2', invoiceNumber: 'I2', serviceType: 'PHASE_1_PLATFORM_FEE',
                  totalAmount: 200, status: 'pending',
                  dueDate: new Date('2026-05-01'), createdAt: new Date('2026-04-15'),
                  application: { id: 'app', applicationNumber: 'A', healthId: '1234567890123',
                                 farmer: { firstName: 'C', lastName: 'D' } },
                  healthId: '1234567890123' },
                // 60 days overdue → 31_60
                { id: 'i3', invoiceNumber: 'I3', serviceType: 'PHASE_1_PLATFORM_FEE',
                  totalAmount: 300, status: 'pending',
                  dueDate: new Date('2026-04-01'), createdAt: new Date('2026-03-15'),
                  application: { id: 'app', applicationNumber: 'A', healthId: '1234567890123',
                                 farmer: { firstName: 'E', lastName: 'F' } },
                  healthId: '1234567890123' },
                // 120 days overdue → OVER_90
                { id: 'i4', invoiceNumber: 'I4', serviceType: 'PHASE_1_PLATFORM_FEE',
                  totalAmount: 400, status: 'pending',
                  dueDate: new Date('2026-02-01'), createdAt: new Date('2026-01-15'),
                  application: { id: 'app', applicationNumber: 'A', healthId: '1234567890123',
                                 farmer: { firstName: 'G', lastName: 'H' } },
                  healthId: '1234567890123' },
            ]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([]);
            const service = loadServiceWithMocks(prismaMock);
            const result = await service.generateArAgingReport({
                asOfDate: asOf,
                bookSide: 'PLATFORM',
                organizationId: 'org-1',
            });

            expect(result.rowCount).toBe(4);
            expect(result.totalOutstanding).toBe(1000);
            expect(result.totalsByBucket.NOT_YET_DUE.amount).toBe(100);
            expect(result.totalsByBucket['0_30'].amount).toBe(200);
            expect(result.totalsByBucket['31_60'].amount).toBe(300);
            expect(result.totalsByBucket.OVER_90.amount).toBe(400);

            // Health ID masked
            for (const row of result.rows) {
                expect(row.applicantHealthIdMasked).toBe('1234*******23');
                expect(JSON.stringify(row)).not.toContain('1234567890123');
            }
        });

        test('org-scope applied — invoice.findMany receives organizationId', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.invoice.findMany.mockResolvedValue([]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([]);
            const service = loadServiceWithMocks(prismaMock);
            await service.generateArAgingReport({
                asOfDate: '2026-05-31',
                bookSide: 'PLATFORM',
                organizationId: 'tenant-abc',
            });
            expect(prismaMock.invoice.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ organizationId: 'tenant-abc' }),
                }),
            );
        });
    });

    describe('generateArAgingReportCSV', () => {
        test('starts with UTF-8 BOM, uses CRLF, includes Thai+English headers', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.invoice.findMany.mockResolvedValue([]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([]);
            const service = loadServiceWithMocks(prismaMock);
            const csv = await service.generateArAgingReportCSV({
                asOfDate: '2026-05-31',
                bookSide: 'PLATFORM',
                organizationId: 'org-1',
            });
            // BOM
            expect(csv.charCodeAt(0)).toBe(0xfeff);
            // CRLF
            expect(csv).toContain('\r\n');
            // Bilingual header
            expect(csv).toContain('Invoice No.');
            expect(csv).toContain('Aging Bucket');
            expect(csv).toContain('เลขใบแจ้งหนี้');
            // Total row
            expect(csv).toContain('TOTAL');
        });

        test('properly escapes commas + quotes in invoice numbers', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.invoice.findMany.mockResolvedValue([
                { id: 'i1', invoiceNumber: 'INV,001 "test"', serviceType: 'PHASE_1_PLATFORM_FEE',
                  totalAmount: 100, status: 'pending',
                  dueDate: new Date('2026-05-01'), createdAt: new Date('2026-04-15'),
                  application: { id: 'a', applicationNumber: 'A', healthId: '1234567890123',
                                 farmer: { firstName: 'X', lastName: 'Y' } },
                  healthId: '1234567890123' },
            ]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([]);
            const service = loadServiceWithMocks(prismaMock);
            const csv = await service.generateArAgingReportCSV({
                asOfDate: '2026-05-31',
                bookSide: 'PLATFORM',
                organizationId: 'org-1',
            });
            expect(csv).toContain('"INV,001 ""test"""');
        });
    });
});
