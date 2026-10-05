'use strict';
/**
 * RED-first regression — the invoice / receipt / (unwired) tax-invoice PDF for
 * a JURISTIC (company) payer prints "เลขประจำตัวผู้เสียภาษี / Tax ID: -" even
 * when `Entity.juristicId` is set. Real staging evidence: invoice
 * INV-CO-CAFF6646-M1.
 *
 * Root cause, confirmed by reading the source (not guessed):
 *   - `services/invoice-service.js` `getForDocument()` builds the
 *     application include with `entity: { select: { id, type, displayName } }`
 *     — `juristicId` (and `thaiCitizenId`) never reach the result tree, so
 *     `utils/applicant-resolver.js:36` (`id = entity.juristicId || '-'`)
 *     always falls to '-'.
 *   - Because `juristicId`/`thaiCitizenId` are PDPA-encrypted at rest
 *     (`services/prisma-pdpa-extension.js`, `enc:v1:` prefix), this is
 *     invisible to any suite that mocks `prisma` — a mock hands back
 *     whatever shape the test gives it, encryption included or not. Only a
 *     REAL Postgres + the real extension proves the select gap AND proves
 *     the decrypt-on-read walker actually reaches the fixed field.
 *   - the former `generateTaxInvoicePdf`'s payer-tax-id line had a SEPARATE bug: it
 *     reads `invoice.applicant?.taxId` (the legacy User column), which
 *     `_findOneInvoice`'s own `applicant` select never carries — that branch
 *     was dead code, always '-', for every payer. Fixed to use the same
 *     entity-resolved `payer.id` the invoice/receipt use. (Since 2026-09-29
 *     the receipt and the tax invoice are one paper, rendered by
 *     generateReceiptTaxInvoicePdf.)
 *
 * Runs against a REAL Postgres (throwaway docker container, see the
 * dispatch's Method section) with `ENABLE_PDPA_FIELD_ENCRYPTION=true` and the
 * real entity-service create path, so the value is genuinely encrypted at
 * rest and must be genuinely decrypted to print correctly. Skips cleanly
 * (name says why) when no test database is reachable.
 */

// Must be set before `services/prisma-database.js` is first required (by any
// of the services below) — the PDPA extension is wired at module-require
// time, gated on this env var (services/prisma-pdpa-extension.js:860).
process.env.ENABLE_PDPA_FIELD_ENCRYPTION = 'true';

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const entityService = require('../../services/entity-service');
const invoiceService = require('../../services/invoice-service');
const invoiceTemplateService = require('../../services/pdf/invoice-template-service');

// Checksum-valid (mod-11) synthetic Thai juristic registration number —
// reused verbatim from this codebase's own unit fixtures
// (__tests__/unit/applicant-validation.test.js, prisma-pdpa-extension.test.js
// etc.), never a real company's number.
const JURISTIC_TAX_ID = '0105561234560';

// The PAYER_ID value span, immediately after the label span that ends in
// "Tax ID" (JURISTIC — invoice.html/receipt.html's payerIdLabel()) or
// "ID No." (everyone else). Module-scope so every suite in this file shares
// one extractor. Scoped to THIS ONE field, not the whole document — the
// issuer's own (legitimate, always-printed) 13-digit tax id and the
// generated invoice/receipt NUMBER (which embeds a millisecond timestamp)
// both legitimately contain 13-digit runs elsewhere on the same page.
function extractPayerIdValue(html) {
    const m = html.match(/(?:Tax ID|ID No\.)<\/span><br>\s*<span class="val">([^<]*)<\/span>/);
    return m ? m[1] : null;
}

d('juristic payer tax id on invoice/receipt/tax-invoice PDFs (real Postgres, real PDPA encryption)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let canonicalId;
    let userId;
    let entityId;
    let applicationId;
    let invoiceId;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const org = await prisma.organization.create({
            data: {
                name: 'invoice-tax-id test org',
                slug: `taxidsel-${suffix}`,
                code: `TAXIDSEL_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;

        canonicalId = `taxidsel-canon-${suffix}`;
        const user = await prisma.user.create({
            data: {
                canonicalId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'ทดสอบ',
                lastName: 'ผู้เสียภาษี',
                email: `taxidsel-${suffix}@example.test`,
                phoneNumber: '0813164168',
            },
        });
        userId = user.id;

        // Real entity-service create path — this is what makes juristicId
        // genuinely `enc:v1:`-encrypted at rest (services/entity-service.js
        // `ensureJuristicEntity` → prisma.entity.create → the PDPA
        // extension's encrypt-on-write hook), not a value the test injected
        // by hand.
        const { entity } = await entityService.ensureJuristicEntity({
            user: { id: userId, organizationId: orgId },
            applicantData: {
                taxId: JURISTIC_TAX_ID,
                companyName: 'บริษัท ทดสอบ เลขผู้เสียภาษี จำกัด',
            },
        });
        entityId = entity.id;

        const app = await prisma.application.create({
            data: {
                applicationNumber: `TAXIDSEL-${suffix}`,
                healthId: canonicalId,
                entityId,
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
                invoiceNumber: `INV-TAXIDSEL-${suffix}`,
                receiptNumber: `RCT-TAXIDSEL-${suffix}`,
                applicationId,
                healthId: canonicalId,
                organizationId: orgId,
                serviceType: 'PHASE_1_PLATFORM_FEE',
                subtotal: 500,
                vat: 35,
                totalAmount: 535,
                dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
                status: 'paid',
                paidAt: new Date(),
                receiptIssuedAt: new Date(),
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
        if (entityId) {
            await prisma.entityMembership.deleteMany({ where: { entityId } }).catch(() => {});
            await prisma.entity.deleteMany({ where: { id: entityId } }).catch(() => {});
        }
        if (canonicalId) {
            await prisma.user.deleteMany({ where: { canonicalId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    test('sanity: Entity.juristicId is genuinely encrypted at rest (enc:v1: prefix)', async () => {
        const rows = await prisma.$queryRawUnsafe(
            'select "juristicId", "juristicIdHash" from "entities" where id = $1',
            entityId,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].juristicIdHash).not.toBeNull();
        expect(String(rows[0].juristicId)).toMatch(/^enc:v1:/);
        expect(String(rows[0].juristicId)).not.toContain(JURISTIC_TAX_ID);
    });

    test('invoiceService.getForDocument decrypts the payer tax id onto entity.juristicId', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        expect(invoice).not.toBeNull();
        expect(invoice.application.entity.juristicId).toBe(JURISTIC_TAX_ID);
    });

    test('generateInvoicePdf prints the real tax id, not "Tax ID -"', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        const html = await invoiceTemplateService.generateInvoicePdf(invoice, { upload: false, htmlOnly: true });
        expect(html).toContain(JURISTIC_TAX_ID);
        expect(html).toContain('เลขประจำตัวผู้เสียภาษี / Tax ID');
        // The PAYER_ID label + value pair must not be the label followed by a
        // bare "-" — the exact bug shape reported on staging invoice
        // INV-CO-CAFF6646-M1. Scoped to this one label/value pair (not "any
        // dash anywhere in the document") so it doesn't also assert about the
        // unrelated approver-block placeholders, which legitimately render
        // "-" here (auto-issued, no human approver).
        expect(html).toMatch(new RegExp(`เลขประจำตัวผู้เสียภาษี / Tax ID</span><br>\\s*<span class="val">${JURISTIC_TAX_ID}</span>`));
    });

    test('generateReceiptTaxInvoicePdf prints the real tax id, grouped 1-4-5-2-1 (was reading the wrong, always-empty column)', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        const html = await invoiceTemplateService.generateReceiptTaxInvoicePdf(invoice, { upload: false, htmlOnly: true });
        // The one ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป paper (2026-09-29) prints the
        // buyer tax id grouped X-XXXX-XXXXX-XX-X. Asserted against the LITERAL
        // expected string — comparing against formatThaiTaxId(...) itself would
        // be circular and pass under any grouping.
        expect(html).toMatch(/เลขประจำตัวผู้เสียภาษี \/ Tax ID<\/span><br>\s*<span class="val">0-1055-61234-56-0<\/span>/);
    });
});

// Checksum-valid (mod-11) synthetic Thai national ID — reused verbatim from
// this codebase's own unit fixtures (__tests__/unit/applicant-validation.test.js,
// applicant-resolver.test.js etc.), never a real person's.
const INDIVIDUAL_NATIONAL_ID = '1100000000008';

// Fix round 1 (2026-09-27 operator ruling, after 08f800e6): an INDIVIDUAL
// payer's national ID is NEVER printed on any finance document, neither in
// full nor partly. `getForDocument`'s entity select briefly carried
// `thaiCitizenId` (to fix the juristic/company tax id above) which — via
// `applicant-resolver.js:34` `id = entity.thaiCitizenId || '-'` — started
// printing the full 13-digit national ID as PAYER_ID on the invoice/receipt
// PDF for an individual payer. This is the regression test for that leak:
// it must fail on 08f800e6 (RED), and must stay green forever after.
d('individual payer national ID is never printed on invoice/receipt PDFs (real Postgres, real PDPA encryption)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let canonicalId;
    let entityId;
    let applicationId;
    let invoiceId;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Idempotency guard: `canonicalId` below is a FIXED synthetic national
        // ID (not suffixed — it has to be, since it is also the value under
        // test), so a prior run of this file that crashed before its own
        // afterAll could leave a stale row. Clear it first rather than fail
        // on a unique-constraint collision.
        await prisma.user.deleteMany({ where: { canonicalId: INDIVIDUAL_NATIONAL_ID } }).catch(() => {});

        const org = await prisma.organization.create({
            data: {
                name: 'invoice-tax-id individual test org',
                slug: `taxidind-${suffix}`,
                code: `TAXIDIND_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;

        // `canonicalId` is the User FK every table joins on (Invoice/Application
        // `healthId` columns reference `User.canonicalId`, confusingly — see
        // prisma/schema/billing.prisma). It must equal the national ID here
        // because `ensurePersonalIndividualEntity` mints `Entity.thaiCitizenId
        // = user.healthId`, and this test passes `canonicalId` as that
        // FUNCTION ARGUMENT's `healthId` (a plain object property, unrelated
        // to the DIFFERENT `User.healthId` DB column — the หมอพร้อม Health ID
        // — which this test does not touch).
        canonicalId = INDIVIDUAL_NATIONAL_ID;
        const user = await prisma.user.create({
            data: {
                canonicalId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'ทดสอบ',
                lastName: 'บุคคลธรรมดา',
                email: `taxidind-${suffix}@example.test`,
                phoneNumber: '0899998888',
            },
        });

        // Real entity-service create path — this is what makes thaiCitizenId
        // genuinely `enc:v1:`-encrypted at rest (services/entity-service.js
        // `ensurePersonalIndividualEntity` → prisma.entity.create → the PDPA
        // extension's encrypt-on-write hook), not a value the test injected
        // by hand.
        const { entity } = await entityService.ensurePersonalIndividualEntity({
            user: {
                id: user.id,
                healthId: canonicalId,
                organizationId: orgId,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
            },
            isNewUser: true,
        });
        entityId = entity.id;

        const app = await prisma.application.create({
            data: {
                applicationNumber: `TAXIDIND-${suffix}`,
                healthId: canonicalId,
                entityId: entity.id,
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
                invoiceNumber: `INV-TAXIDIND-${suffix}`,
                receiptNumber: `RCT-TAXIDIND-${suffix}`,
                applicationId,
                healthId: canonicalId,
                organizationId: orgId,
                serviceType: 'PHASE_1_PLATFORM_FEE',
                subtotal: 500,
                vat: 35,
                totalAmount: 535,
                dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
                status: 'paid',
                paidAt: new Date(),
                receiptIssuedAt: new Date(),
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
        if (entityId) {
            await prisma.entityMembership.deleteMany({ where: { entityId } }).catch(() => {});
            await prisma.entity.deleteMany({ where: { id: entityId } }).catch(() => {});
        }
        if (canonicalId) {
            await prisma.user.deleteMany({ where: { canonicalId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });


    test('generateInvoicePdf never prints the national ID, in full or in part, as the payer value', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        expect(invoice).not.toBeNull();
        const html = await invoiceTemplateService.generateInvoicePdf(invoice, { upload: false, htmlOnly: true });
        // Defense in depth: the raw digits must not appear ANYWHERE on the
        // rendered page (not just the PAYER_ID field) — the address block,
        // approver block etc. are all separate render paths that could, in
        // principle, also source from the entity.
        expect(html).not.toContain(INDIVIDUAL_NATIONAL_ID);
        const payerIdValue = extractPayerIdValue(html);
        expect(payerIdValue).toBe('-');
        expect(payerIdValue).not.toMatch(/\d{13}/);
        expect(payerIdValue).not.toMatch(/\d/);
    });

    test('generateReceiptTaxInvoicePdf never prints the national ID, in full or in part, as the payer value', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        expect(invoice).not.toBeNull();
        const html = await invoiceTemplateService.generateReceiptTaxInvoicePdf(invoice, { upload: false, htmlOnly: true });
        expect(html).not.toContain(INDIVIDUAL_NATIONAL_ID);
        const payerIdValue = extractPayerIdValue(html);
        expect(payerIdValue).toBe('-');
        expect(payerIdValue).not.toMatch(/\d{13}/);
        expect(payerIdValue).not.toMatch(/\d/);
    });
});

// Security review fix round 2 (2026-09-27) — I1: a decrypt failure (rotated
// key / corrupt ciphertext — services/prisma-pdpa-extension.js decryptValue,
// ~L319-326) makes `Entity.juristicId` resolve to the literal marker string
// `[PII_DECRYPT_FAILED]` instead of throwing. Before this branch,
// `getForDocument()` never selected `juristicId` at all, so this marker
// could never reach a template. This suite forces a REAL decrypt failure
// (corrupts the stored ciphertext directly in Postgres, after a real
// encrypt-on-write) and proves the marker never reaches the rendered PDF —
// it must fail before the `payerIdPrintable()` shape-guard fix
// (services/pdf/invoice-template-service.js).
d('a PDPA decrypt failure never prints [PII_DECRYPT_FAILED] on invoice/receipt PDFs (real Postgres, real PDPA encryption)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let canonicalId;
    let entityId;
    let applicationId;
    let invoiceId;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();

        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const org = await prisma.organization.create({
            data: {
                name: 'invoice-tax-id decrypt-failure test org',
                slug: `taxiddec-${suffix}`,
                code: `TAXIDDEC_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;

        canonicalId = `taxiddec-canon-${suffix}`;
        const user = await prisma.user.create({
            data: {
                canonicalId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
                firstName: 'ทดสอบ',
                lastName: 'ถอดรหัสล้มเหลว',
                email: `taxiddec-${suffix}@example.test`,
                phoneNumber: '0866667777',
            },
        });

        // Real entity-service create path first, so juristicId is genuinely
        // `enc:v1:`-encrypted at rest — then corrupt the ciphertext directly
        // in the database (not via the service) to force a real decrypt
        // failure on read, the same shape a rotated key / bit-rot would
        // produce.
        const { entity } = await entityService.ensureJuristicEntity({
            user: { id: user.id, organizationId: orgId },
            applicantData: {
                taxId: JURISTIC_TAX_ID,
                companyName: 'บริษัท ทดสอบ ถอดรหัสล้มเหลว จำกัด',
            },
        });
        entityId = entity.id;

        await prisma.$executeRawUnsafe(
            'update "entities" set "juristicId" = $1 where id = $2',
            'enc:v1:not-real-ciphertext-this-is-corrupted',
            entityId,
        );

        const app = await prisma.application.create({
            data: {
                applicationNumber: `TAXIDDEC-${suffix}`,
                healthId: canonicalId,
                entityId,
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
                invoiceNumber: `INV-TAXIDDEC-${suffix}`,
                receiptNumber: `RCT-TAXIDDEC-${suffix}`,
                applicationId,
                healthId: canonicalId,
                organizationId: orgId,
                serviceType: 'PHASE_1_PLATFORM_FEE',
                subtotal: 500,
                vat: 35,
                totalAmount: 535,
                dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
                status: 'paid',
                paidAt: new Date(),
                receiptIssuedAt: new Date(),
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
        if (entityId) {
            await prisma.entityMembership.deleteMany({ where: { entityId } }).catch(() => {});
            await prisma.entity.deleteMany({ where: { id: entityId } }).catch(() => {});
        }
        if (canonicalId) {
            await prisma.user.deleteMany({ where: { canonicalId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    test('sanity: the corrupted juristicId genuinely resolves to the [PII_DECRYPT_FAILED] marker on a real read', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        expect(invoice).not.toBeNull();
        expect(invoice.application.entity.juristicId).toBe('[PII_DECRYPT_FAILED]');
    });

    test('generateInvoicePdf never prints [PII_DECRYPT_FAILED] — the payer value falls back to "-"', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        const html = await invoiceTemplateService.generateInvoicePdf(invoice, { upload: false, htmlOnly: true });
        expect(html).not.toContain('[PII_DECRYPT_FAILED]');
        expect(extractPayerIdValue(html)).toBe('-');
    });

    test('generateReceiptTaxInvoicePdf never prints [PII_DECRYPT_FAILED] — the payer value falls back to "-"', async () => {
        const invoice = await invoiceService.getForDocument(invoiceId);
        const html = await invoiceTemplateService.generateReceiptTaxInvoicePdf(invoice, { upload: false, htmlOnly: true });
        expect(html).not.toContain('[PII_DECRYPT_FAILED]');
        expect(extractPayerIdValue(html)).toBe('-');
    });
});
