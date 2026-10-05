'use strict';

/**
 * The applicant's billing doors on a REAL Postgres, through the REAL
 * tenant-context middleware and the REAL read witness
 * (staging walk 2026-09-29 defects P1 + P6; holder read scope, Task 5 of
 * 2026-09-30-remove-workspace-mode).
 *
 * One account pays for two workspaces: its own personal (INDIVIDUAL) entity and
 * a company (JURISTIC) it owns. On staging, with the personal workspace active,
 * GET /api/invoices/my returned the company's invoice while
 * GET /api/applications/my returned [] — the page then asked for that
 * application's quotations and got 404. And once paid, the only PDF the owner
 * could download was the invoice: the receipt route was staff-only.
 *
 * Task 5: GET /api/invoices/my (invoiceService.listForHolders) and the two
 * owner PDF doors (findHealthInvoice) read Invoice through a registered holder
 * fragment, so the witness in THROW mode lets every one of them through and
 * logs nothing. R2 Task 12: the fragment alone decides (no workspace header, no
 * filer pin): the account lists both of its holders' invoices, a co-member lists
 * the company's, and a stranger, a REVOKED member and anyone asking for a
 * null-entity invoice get 404.
 *
 * The receipt the owner downloads is rendered from the stored row (the receipt
 * template's own HTML, real data — Puppeteer is replaced by `htmlOnly` because
 * pdf-parse cannot run under jest's CJS transform; the evidence pack renders
 * the real PDF outside jest).
 *
 * Only authentication is attached by hand. Skips cleanly without a migrated
 * test database.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const bindTenant = tenantContextMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, next);
    };
    return { authenticateAny: attach, authenticateHealth: attach, authenticateProvider: attach };
});

const sharedLogger = require('../../shared/logger');
const witnessConfig = require('../../config/holder-read-witness');

function setWitnessMode(mode) {
    if (mode === undefined) { delete process.env.HOLDER_READ_WITNESS; }
    else { process.env.HOLDER_READ_WITNESS = mode; }
    witnessConfig.resetHolderReadWitnessModeCache();
}
const ORIGINAL_WITNESS_MODE = process.env.HOLDER_READ_WITNESS;

// Checksum-valid (DOPA mod-11) juristic tax id used across this repo's fixtures.
const COMPANY_TAX_ID = '0105561234560';
const COMPANY_NAME = 'บริษัท ทดสอบใบเสร็จผู้ยื่น จำกัด';

d('applicant billing follows the active workspace; the owner gets the receipt (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let tpl;
    let realReceiptRender;
    let captured;
    let warn;
    const uid = () => crypto.randomUUID();
    const suffix = uid().slice(0, 8);
    const fx = { apps: [], invoices: [], entities: [], users: [] };

    async function makeUser(label) {
        const id = uid();
        const canonicalId = `rcpt-${label}-${suffix}`;
        await raw.user.create({
            data: {
                id, canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `rcpt-${label}-${suffix}@example.test`, firstName: 'ทดสอบ', lastName: label,
                organizationId: fx.orgId,
            },
        });
        fx.users.push(id);
        return { id, canonicalId };
    }

    async function makeEntity({ type, displayName, juristicId, ownerId }) {
        const entity = await raw.entity.create({
            data: { type, displayName, juristicId: juristicId || null, organizationId: fx.orgId },
        });
        fx.entities.push(entity.id);
        await raw.entityMembership.create({
            data: { userId: ownerId, entityId: entity.id, role: 'OWNER', status: 'ACTIVE', organizationId: fx.orgId },
        });
        return entity;
    }

    async function makeApplicationWithInvoice({ label, owner, entityId, paid, receiptNumber = `TAX-PRD-RCPT-${suffix}` }) {
        const application = await raw.application.create({
            data: {
                applicationNumber: `APP-RCPT-${label}-${suffix}`, healthId: owner.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId, status: paid ? 'DOC_FEE_PAID' : 'PENDING_DOC_FEE',
                formData: { applicantData: { address: '99 หมู่ 1', province: 'นนทบุรี', postalCode: '11000' } },
            },
        });
        fx.apps.push(application.id);
        const invoice = await raw.invoice.create({
            data: {
                invoiceNumber: `INV-RCPT-${label}-${suffix}`, applicationId: application.id, healthId: owner.canonicalId,
                serviceType: 'CERTIFICATION_CHECKOUT_M1', subtotal: 5500, vat: 385, totalAmount: 5885,
                dueDate: new Date('2026-10-08T00:00:00Z'), organizationId: fx.orgId,
                status: paid ? 'RECEIPT_ISSUED' : 'pending',
                ...(paid ? {
                    paidAt: new Date('2026-09-29T08:14:45Z'),
                    receiptNumber,
                    receiptIssuedAt: new Date('2026-09-29T08:14:45Z'),
                    receiptIssuedBy: 'stripe-webhook',
                    receiptStatus: 'ISSUED',
                    paymentMethod: 'PromptPay',
                } : {}),
            },
        });
        fx.invoices.push(invoice.id);
        return { application, invoice };
    }

    const as = (user) => { mockActor.current = { id: user.id, canonicalId: user.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.orgId }; };
    // Every read the witness refused or counted, as `Model.op route`.
    const witnessLogs = () => warn.mock.calls
        .map((c) => c[1])
        .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED')
        .map((m) => `${m.model}.${m.op} ${m.route || ''}`);
    // jest.setup.js clears every mock between tests, so each test's witness lines
    // are collected after it runs; the last test asserts the whole file saw none.
    const witnessSeen = [];
    afterEach(() => { if (warn) { witnessSeen.push(...witnessLogs()); } });
    const myInvoiceIds = async (headers = {}) => {
        const res = await request(app).get('/api/invoices/my').set(headers);
        return { status: res.status, body: res.body, ids: Array.isArray(res.body?.data) ? res.body.data.map((i) => i.id).sort() : null };
    };

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: `rcpt-${suffix}`, slug: `rcpt-${suffix}`, code: `RCPT_${suffix}`.toUpperCase() },
        });
        fx.orgId = org.id;

        fx.owner = await makeUser('owner');
        fx.stranger = await makeUser('stranger');
        fx.personal = await makeEntity({ type: 'INDIVIDUAL', displayName: 'ทดสอบ owner', ownerId: fx.owner.id });
        fx.company = await makeEntity({ type: 'JURISTIC', displayName: COMPANY_NAME, juristicId: COMPANY_TAX_ID, ownerId: fx.owner.id });
        fx.strangerPersonal = await makeEntity({ type: 'INDIVIDUAL', displayName: 'ทดสอบ stranger', ownerId: fx.stranger.id });

        fx.personalBill = await makeApplicationWithInvoice({ label: 'P', owner: fx.owner, entityId: fx.personal.id, paid: false });
        fx.companyBill = await makeApplicationWithInvoice({ label: 'C', owner: fx.owner, entityId: fx.company.id, paid: true });

        // Task 5: B is a MANAGER of the company who filed nothing; R lost the company
        // membership (REVOKED); L filed an application with no entity at all.
        fx.coMember = await makeUser('comember');
        await makeEntity({ type: 'INDIVIDUAL', displayName: 'ทดสอบ comember', ownerId: fx.coMember.id });
        await raw.entityMembership.create({
            data: { userId: fx.coMember.id, entityId: fx.company.id, role: 'MANAGER', status: 'ACTIVE', organizationId: fx.orgId },
        });
        fx.revoked = await makeUser('revoked');
        await makeEntity({ type: 'INDIVIDUAL', displayName: 'ทดสอบ revoked', ownerId: fx.revoked.id });
        await raw.entityMembership.create({
            data: { userId: fx.revoked.id, entityId: fx.company.id, role: 'MANAGER', status: 'REVOKED', organizationId: fx.orgId },
        });
        fx.legacyFiler = await makeUser('legacy');
        await makeEntity({ type: 'INDIVIDUAL', displayName: 'ทดสอบ legacy', ownerId: fx.legacyFiler.id });
        fx.legacyBill = await makeApplicationWithInvoice({
            label: 'L', owner: fx.legacyFiler, entityId: null, paid: true, receiptNumber: `TAX-PRD-RCPT-L-${suffix}`,
        });

        tpl = require('../../services/pdf/invoice-template-service');
        realReceiptRender = tpl.generateReceiptTaxInvoicePdf;
        jest.spyOn(tpl, 'generateReceiptTaxInvoicePdf').mockImplementation(async (invoice, opts = {}) => {
            captured = invoice;
            return Buffer.from(await realReceiptRender(invoice, { ...opts, htmlOnly: true }), 'utf8');
        });
        // The invoice PDF door renders through the same template service; htmlOnly
        // keeps the headless browser out of jest (it would hold the run open).
        const realInvoiceRender = tpl.generateInvoicePdf;
        jest.spyOn(tpl, 'generateInvoicePdf').mockImplementation(async (invoice, opts = {}) => Buffer.from(await realInvoiceRender(invoice, { ...opts, htmlOnly: true }), 'utf8'));

        app = express();
        app.use(express.json());
        app.use('/api/invoices', require('../../routes/api/finance/invoices'));

        // Every door below runs with the witness in THROW mode: an Invoice read with
        // no registered holder fragment rejects before it runs (the door answers 500).
        setWitnessMode('throw');
        warn = jest.spyOn(sharedLogger, 'warn');
    });

    afterAll(async () => {
        setWitnessMode(ORIGINAL_WITNESS_MODE);
        jest.restoreAllMocks();
        if (!raw) { return; }
        await raw.invoice.deleteMany({ where: { id: { in: fx.invoices } } }).catch(() => {});
        await raw.application.deleteMany({ where: { id: { in: fx.apps } } }).catch(() => {});
        await raw.entityMembership.deleteMany({ where: { entityId: { in: fx.entities } } }).catch(() => {});
        await raw.entity.deleteMany({ where: { id: { in: fx.entities } } }).catch(() => {});
        await raw.user.deleteMany({ where: { id: { in: fx.users } } }).catch(() => {});
        if (fx.orgId) { await raw.organization.deleteMany({ where: { id: fx.orgId } }).catch(() => {}); }
        await raw.$disconnect();
    });

    describe('GET /api/invoices/my (P6; R2 Task 12)', () => {
        test('the owner lists the invoices of both its holders (personal and company), no header needed', async () => {
            as(fx.owner);
            const { status, ids } = await myInvoiceIds();
            expect(status).toBe(200);
            expect(ids).toEqual([fx.personalBill.invoice.id, fx.companyBill.invoice.id].sort());
        });

        test('a stale workspace header changes nothing: the same two invoices', async () => {
            as(fx.owner);
            const { ids } = await myInvoiceIds({ 'x-active-entity-id': fx.personal.id });
            expect(ids).toEqual([fx.personalBill.invoice.id, fx.companyBill.invoice.id].sort());
        });

        test('a non-member sending the company header sees none of the company\'s invoices (200, no 403)', async () => {
            as(fx.stranger);
            const { status, ids } = await myInvoiceIds({ 'x-active-entity-id': fx.company.id });
            expect(status).toBe(200);
            expect(ids).toEqual([]);
        });

        test('the non-member sees none of the owner\'s invoices', async () => {
            as(fx.stranger);
            const { status, ids } = await myInvoiceIds();
            expect(status).toBe(200);
            expect(ids).toEqual([]);
        });
    });

    describe('GET /api/invoices/my/:invoiceId/receipt/pdf (P1)', () => {
        test('the owner downloads the receipt of the paid company invoice: receipt title, receipt number, company buyer block', async () => {
            as(fx.owner);
            captured = null;
            const res = await request(app)
                .get(`/api/invoices/my/${fx.companyBill.invoice.id}/receipt/pdf`)
                .buffer(true).parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/application\/pdf/);
            expect(res.headers['content-disposition']).toContain(`TAX-PRD-RCPT-${suffix}.pdf`);
            // The row the template received is the stored one, entity included.
            expect(captured.receiptNumber).toBe(`TAX-PRD-RCPT-${suffix}`);
            expect(captured.application.entity.type).toBe('JURISTIC');

            const html = res.body.toString('utf8');
            expect(html).toContain('ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป');
            expect(html).not.toContain('ใบวางบิล');
            expect(html).toContain(`TAX-PRD-RCPT-${suffix}`);
            expect(html).toContain(COMPANY_NAME);
            expect(html).toContain('ชื่อบริษัท / Company Name');
            expect(html).toContain('เลขประจำตัวผู้เสียภาษี / Tax ID');
            expect(html).toContain('0-1055-61234-56-0');
        });

        test('a stranger cannot download it (404, R2 Task 12), the template is never reached', async () => {
            as(fx.stranger);
            captured = null;
            const res = await request(app).get(`/api/invoices/my/${fx.companyBill.invoice.id}/receipt/pdf`);
            expect(res.status).toBe(404);
            expect(captured).toBeNull();
        });

        test('an unpaid invoice has no receipt to give (409 RECEIPT_NOT_ISSUED)', async () => {
            as(fx.owner);
            captured = null;
            const res = await request(app).get(`/api/invoices/my/${fx.personalBill.invoice.id}/receipt/pdf`);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('RECEIPT_NOT_ISSUED');
            expect(captured).toBeNull();
        });

        test('an unknown invoice id answers 404', async () => {
            as(fx.owner);
            const res = await request(app).get(`/api/invoices/my/${uid()}/receipt/pdf`);
            expect(res.status).toBe(404);
        });

        test('the stored receipt row is not rewritten by a download (no numbering, no regeneration)', async () => {
            const after = await raw.invoice.findUnique({ where: { id: fx.companyBill.invoice.id } });
            expect(after.receiptNumber).toBe(`TAX-PRD-RCPT-${suffix}`);
            expect(after.receiptIssuedAt.toISOString()).toBe('2026-09-29T08:14:45.000Z');
            expect(after.updatedAt.toISOString()).toBe(fx.companyBill.invoice.updatedAt.toISOString());
        });
    });

    describe('Task 5 holder doors with the R2 answers (Task 12)', () => {
        const pdfDoor = (id) => request(app).get(`/api/invoices/${id}/pdf`);
        const receiptDoor = (id) => request(app).get(`/api/invoices/my/${id}/receipt/pdf`);

        test('co-member B lists and downloads the company invoice A filed, with no header', async () => {
            as(fx.coMember);
            const { status, ids } = await myInvoiceIds();
            expect(status).toBe(200);
            expect(ids).toEqual([fx.companyBill.invoice.id]);
            expect((await receiptDoor(fx.companyBill.invoice.id)).status).toBe(200);
            expect((await pdfDoor(fx.companyBill.invoice.id)).status).toBe(200);
        });

        test('a stranger is refused on the invoice PDF and the receipt PDF with 404 (R1 answered 403)', async () => {
            as(fx.stranger);
            expect((await pdfDoor(fx.companyBill.invoice.id)).status).toBe(404);
            expect((await receiptDoor(fx.companyBill.invoice.id)).status).toBe(404);
        });

        test('a REVOKED member is refused with 404 (R1 answered 403) and does not list it', async () => {
            as(fx.revoked);
            expect((await pdfDoor(fx.companyBill.invoice.id)).status).toBe(404);
            expect((await receiptDoor(fx.companyBill.invoice.id)).status).toBe(404);
            const { ids } = await myInvoiceIds();
            expect(ids).not.toContain(fx.companyBill.invoice.id);
        });

        test('a null-entity invoice is invisible to everyone, its filer included (spec §3.1 no filer fallback)', async () => {
            as(fx.legacyFiler);
            const { status, ids } = await myInvoiceIds();
            expect(status).toBe(200);
            expect(ids).toEqual([]);
            expect((await receiptDoor(fx.legacyBill.invoice.id)).status).toBe(404);
            as(fx.owner);
            expect((await receiptDoor(fx.legacyBill.invoice.id)).status).toBe(404);
        });

        test('the witness, in throw mode for this whole file, counted no unscoped Invoice read', () => {
            expect([...witnessSeen, ...witnessLogs()]).toEqual([]);
        });
    });
});
