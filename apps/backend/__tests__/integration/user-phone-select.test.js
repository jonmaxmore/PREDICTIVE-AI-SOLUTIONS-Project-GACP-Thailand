'use strict';
/**
 * RED-first regression — Receipt/invoice PDF download and the provider
 * audit-detail read both 500 on staging/demo:
 *
 *   PrismaClientValidationError: Unknown field `phone` for select statement
 *   on model `User`.
 *
 * The User model's column is `phoneNumber` (prisma/schema/auth.prisma:21),
 * not `phone`. Both sites below picked `phone: true` in the "narrow selects"
 * security fix (commit 83157701, 2026-08-01) and no unit suite caught it —
 * unit tests mock `prisma`, so a mocked `applicant.findFirst` happily returns
 * whatever shape the test hands it; only a real Prisma client validates the
 * select against the actual schema. This suite runs against a REAL Postgres
 * so it fails the same way staging does.
 *
 *   - services/invoice-service.js `_findOneInvoice` → `applicant.select`
 *     (reached via the public callers `getById` / `getForDocument`, the
 *     latter being the PDF template's data read).
 *   - services/application-service/application-provider-query-methods.js
 *     `findAuditDetail` → `applicant.select`.
 *
 * Skips cleanly (with the reason in the suite name) when no test database is
 * reachable — a green run here is NOT proof the class disappeared on staging;
 * see evidence/user-phone-select-2026-09-27/INDEX.md for the real walk.
 */

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const invoiceService = require('../../services/invoice-service');
const applicationService = require('../../services/application-service');

d('the applicant select on Invoice + audit-detail reads (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let canonicalId;
    let applicationId;
    let invoiceId;
    const SEEDED_PHONE = '0812223333';

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'user-phone-select test org',
                slug: `phonesel-${suffix}`,
                code: `PHONESEL_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;

        canonicalId = `phonesel-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'ทดสอบ',
                lastName: 'เบอร์โทร',
                email: `phonesel-${suffix}@example.test`,
                phoneNumber: SEEDED_PHONE,
            },
        });

        const app = await prisma.application.create({
            data: {
                applicationNumber: `PHONESEL-${suffix}`,
                healthId: canonicalId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status: 'PENDING_DOC_FEE',
                formData: {},
                isDeleted: false,
            },
        });
        applicationId = app.id;

        const invoice = await prisma.invoice.create({
            data: {
                invoiceNumber: `INV-PHONESEL-${suffix}`,
                applicationId,
                healthId: canonicalId,
                organizationId: orgId,
                serviceType: 'PHASE_1_PLATFORM_FEE',
                subtotal: 500,
                vat: 35,
                totalAmount: 535,
                dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
                status: 'pending',
            },
        });
        invoiceId = invoice.id;
    });

    afterAll(async () => {
        if (invoiceId) {
            await prisma.invoice.deleteMany({ where: { id: invoiceId } }).catch(() => {});
        }
        if (applicationId) {
            await prisma.application.deleteMany({ where: { id: applicationId } }).catch(() => {});
        }
        if (canonicalId) {
            await prisma.user.deleteMany({ where: { canonicalId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    test('invoiceService.getById (billing view) selects the real User column', async () => {
        const invoice = await invoiceService.getById(invoiceId);
        expect(invoice).not.toBeNull();
        expect(invoice.applicant.phoneNumber).toBe(SEEDED_PHONE);
    });

    test('invoiceService.getForDocument (the PDF template data read) selects the real User column', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        expect(invoice).not.toBeNull();
        expect(invoice.applicant.phoneNumber).toBe(SEEDED_PHONE);
    });

    test('applicationService.findAuditDetail (provider audit-detail screen) selects the real User column', async () => {
        const application = await applicationService.findAuditDetail({
            where: { id: applicationId, isDeleted: false },
        });
        expect(application).not.toBeNull();
        expect(application.applicant.phoneNumber).toBe(SEEDED_PHONE);
    });
});
