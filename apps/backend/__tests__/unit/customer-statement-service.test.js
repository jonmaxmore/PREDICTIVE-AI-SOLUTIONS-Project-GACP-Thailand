/**
 * Customer Statement Service tests — B20-D (2026-05-16).
 *
 * Covers the consolidated billing view a finance staff member pulls
 * for a customer support ticket: applicant identity, per-application
 * quotations/invoices/slips, per-side rollups, PDPA masking, and the
 * role-based DTAM/PLATFORM filter.
 */

'use strict';

const createPrismaMock = () => ({
    user: { findFirst: jest.fn() },
    application: { findMany: jest.fn(), findFirst: jest.fn() },
    quotation: { findMany: jest.fn() },
    invoice: { findMany: jest.fn() },
    paymentSlip: { findMany: jest.fn() },
});

function loadServiceWithMocks(prismaMock) {
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    return require('../../services/customer-statement-service');
}

describe('customer-statement-service', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('PDPA masking helpers', () => {
        test('maskName keeps first 3 chars + ***', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { maskName } = service._internals;
            expect(maskName('สมชาย ใจดี')).toBe('สมช***');
            expect(maskName('Alice Smith')).toBe('Ali***');
            expect(maskName('Bob')).toBe('Bob***');
            expect(maskName('')).toBeNull();
            expect(maskName(null)).toBeNull();
        });

        test('maskPhone keeps last 4 digits', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { maskPhone } = service._internals;
            expect(maskPhone('0812345678')).toBe('******5678');
            expect(maskPhone('08-1234-5678')).toBe('******5678');
            expect(maskPhone(null)).toBeNull();
        });

        test('maskHealthId keeps first 4 + last 2 — never returns full 13-digit ID', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { maskHealthId } = service._internals;
            expect(maskHealthId('1234567890123')).toBe('1234*******23');
            // PDPA ม.6 — verify the unmasked digits are NOT present anywhere
            // in the mask other than the head/tail.
            const masked = maskHealthId('1234567890123');
            expect(masked).not.toContain('567890');
            expect(maskHealthId(null)).toBeNull();
        });

        test('maskEmail keeps first char + domain', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { maskEmail } = service._internals;
            expect(maskEmail('alice@gacp.go.th')).toBe('a***@gacp.go.th');
            expect(maskEmail('')).toBeNull();
        });
    });

    describe('classifyServiceType', () => {
        test('maps STATE_FEE → DTAM and PLATFORM_FEE → PLATFORM', () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            const { classifyServiceType } = service._internals;
            expect(classifyServiceType('PHASE_1_STATE_FEE')).toBe('DTAM');
            expect(classifyServiceType('PHASE_2_STATE_FEE')).toBe('DTAM');
            expect(classifyServiceType('PHASE_1_PLATFORM_FEE')).toBe('PLATFORM');
            expect(classifyServiceType('SUBSCRIPTION_BASIC')).toBe('PLATFORM');
        });
    });

    describe('generateCustomerStatement', () => {
        test('rejects when applicantHealthId missing', async () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            await expect(service.generateCustomerStatement({
                organizationId: 'org-1',
            })).rejects.toThrow(/applicantHealthId required/);
        });

        test('rejects when organizationId missing', async () => {
            const prismaMock = createPrismaMock();
            const service = loadServiceWithMocks(prismaMock);
            await expect(service.generateCustomerStatement({
                applicantHealthId: '1234567890123',
            })).rejects.toThrow(/organizationId required/);
        });

        test('returns notFound shape when applicant cannot be resolved', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.user.findFirst.mockResolvedValue(null);
            const service = loadServiceWithMocks(prismaMock);
            const result = await service.generateCustomerStatement({
                applicantHealthId: '9999999999999',
                organizationId: 'org-1',
            });
            expect(result.notFound).toBe(true);
            expect(result.applicant).toBeNull();
            expect(result.applications).toEqual([]);
        });

        test('aggregates a single application correctly + masks applicant PII', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.user.findFirst.mockResolvedValue({
                id: 'user-1',
                firstName: 'สมชาย',
                lastName: 'ใจดี',
                email: 'somchai@example.com',
                phoneNumber: '0812345678',
                healthId: '1234567890123',
            });
            prismaMock.application.findMany.mockResolvedValue([{
                id: 'app-1',
                applicationNumber: 'GACP-2026-0001',
                status: 'PHASE_1_PAID',
                createdAt: new Date('2026-05-01T00:00:00Z'),
                phase1Status: 'PAID',
                phase2Status: 'PENDING',
                phase1PaidAt: new Date('2026-05-02T00:00:00Z'),
                phase2PaidAt: null,
            }]);
            prismaMock.quotation.findMany.mockResolvedValue([
                { id: 'q1', applicationId: 'app-1', quotationNumber: 'QT-DTAM-001',
                  issuerType: 'DTAM', status: 'ACCEPTED', totalAmount: 5000, subtotal: 5000, vat: 0,
                  issueDate: new Date('2026-04-30'), validUntil: null, acceptedAt: null, createdAt: new Date() },
                { id: 'q2', applicationId: 'app-1', quotationNumber: 'QT-PRD-001',
                  issuerType: 'PLATFORM', status: 'ACCEPTED', totalAmount: 5350, subtotal: 5000, vat: 350,
                  issueDate: new Date('2026-04-30'), validUntil: null, acceptedAt: null, createdAt: new Date() },
            ]);
            prismaMock.invoice.findMany.mockResolvedValue([
                {
                    id: 'inv-1', applicationId: 'app-1', invoiceNumber: 'INV-DTAM-001',
                    serviceType: 'PHASE_1_STATE_FEE', status: 'PAID',
                    paidAt: new Date('2026-05-02'), totalAmount: 5000, subtotal: 5000, vat: 0,
                    dueDate: new Date('2026-05-05'), createdAt: new Date('2026-05-01'),
                },
                {
                    id: 'inv-2', applicationId: 'app-1', invoiceNumber: 'INV-PRD-001',
                    serviceType: 'PHASE_1_PLATFORM_FEE', status: 'pending',
                    paidAt: null, totalAmount: 5350, subtotal: 5000, vat: 350,
                    dueDate: new Date('2026-05-15'), createdAt: new Date('2026-05-01'),
                },
            ]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([
                { id: 'slip-1', invoiceId: 'inv-1', applicationId: 'app-1', status: 'APPROVED',
                  bankRef: 'TXN001', createdAt: new Date(), transferredAt: null, reviewedAt: null },
            ]);

            const service = loadServiceWithMocks(prismaMock);
            const result = await service.generateCustomerStatement({
                applicantHealthId: '1234567890123',
                organizationId: 'org-1',
            });

            // Applicant masked per PDPA
            expect(result.applicant.name).toBe('สมช***');
            expect(result.applicant.healthIdMasked).toBe('1234*******23');
            expect(result.applicant.phoneNumberMasked).toBe('******5678');
            // Full 13-digit ID never appears in the response
            expect(JSON.stringify(result)).not.toContain('1234567890123');

            // Summary totals
            expect(result.summary.dtamSide.billed).toBe(5000);
            expect(result.summary.dtamSide.paid).toBe(5000);
            expect(result.summary.dtamSide.outstanding).toBe(0);
            expect(result.summary.platformSide.billed).toBe(5350);
            expect(result.summary.platformSide.paid).toBe(0);
            expect(result.summary.platformSide.outstanding).toBe(5350);

            expect(result.applications).toHaveLength(1);
            expect(result.applications[0].invoices).toHaveLength(2);
            expect(result.applications[0].quotations).toHaveLength(2);
        });

        test('aggregates multiple applications into the rollup totals', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.user.findFirst.mockResolvedValue({
                id: 'user-1', firstName: 'A', lastName: 'B', healthId: '1234567890123',
            });
            prismaMock.application.findMany.mockResolvedValue([
                { id: 'app-1', applicationNumber: 'A1', status: 'X', createdAt: new Date(),
                  phase1Status: null, phase2Status: null, phase1PaidAt: null, phase2PaidAt: null },
                { id: 'app-2', applicationNumber: 'A2', status: 'X', createdAt: new Date(),
                  phase1Status: null, phase2Status: null, phase1PaidAt: null, phase2PaidAt: null },
            ]);
            prismaMock.quotation.findMany.mockResolvedValue([]);
            prismaMock.invoice.findMany.mockResolvedValue([
                { id: 'i1', applicationId: 'app-1', invoiceNumber: 'I1', serviceType: 'PHASE_1_PLATFORM_FEE',
                  status: 'PAID', paidAt: new Date(), totalAmount: 100, subtotal: 100, vat: 0,
                  dueDate: new Date(), createdAt: new Date('2026-05-01') },
                { id: 'i2', applicationId: 'app-2', invoiceNumber: 'I2', serviceType: 'PHASE_1_PLATFORM_FEE',
                  status: 'pending', paidAt: null, totalAmount: 200, subtotal: 200, vat: 0,
                  dueDate: new Date(), createdAt: new Date('2026-05-01') },
            ]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([]);
            const service = loadServiceWithMocks(prismaMock);
            const result = await service.generateCustomerStatement({
                applicantHealthId: '1234567890123',
                organizationId: 'org-1',
            });
            expect(result.summary.platformSide.billed).toBe(300);
            expect(result.summary.platformSide.paid).toBe(100);
            expect(result.summary.platformSide.outstanding).toBe(200);
            expect(result.applications).toHaveLength(2);
        });

        test('role filter — ACCOUNT_DTAM blanks PLATFORM summary', async () => {
            const prismaMock = createPrismaMock();
            prismaMock.user.findFirst.mockResolvedValue({
                id: 'user-1', firstName: 'A', lastName: 'B', healthId: '1234567890123',
            });
            prismaMock.application.findMany.mockResolvedValue([
                { id: 'app-1', applicationNumber: 'A1', status: 'X', createdAt: new Date(),
                  phase1Status: null, phase2Status: null, phase1PaidAt: null, phase2PaidAt: null },
            ]);
            prismaMock.quotation.findMany.mockResolvedValue([]);
            prismaMock.invoice.findMany.mockResolvedValue([
                { id: 'i1', applicationId: 'app-1', invoiceNumber: 'I1', serviceType: 'PHASE_1_STATE_FEE',
                  status: 'PAID', paidAt: new Date(), totalAmount: 5000, subtotal: 5000, vat: 0,
                  dueDate: new Date(), createdAt: new Date('2026-05-01') },
                { id: 'i2', applicationId: 'app-1', invoiceNumber: 'I2', serviceType: 'PHASE_1_PLATFORM_FEE',
                  status: 'pending', paidAt: null, totalAmount: 5350, subtotal: 5000, vat: 350,
                  dueDate: new Date(), createdAt: new Date('2026-05-01') },
            ]);
            prismaMock.paymentSlip.findMany.mockResolvedValue([]);
            const service = loadServiceWithMocks(prismaMock);
            const result = await service.generateCustomerStatement({
                applicantHealthId: '1234567890123',
                organizationId: 'org-1',
                viewerSides: ['DTAM'],
            });
            expect(result.summary.dtamSide).not.toBeNull();
            expect(result.summary.dtamSide.billed).toBe(5000);
            expect(result.summary.platformSide).toBeNull();
            // Per-application breakdown is filtered too
            expect(result.applications[0].summary.dtamSide).not.toBeNull();
            expect(result.applications[0].summary.platformSide).toBeNull();
        });
    });
});
