'use strict';

/**
 * Company finance documents follow MEMBERSHIP, not the filer (operator ruling:
 * company co-members see company finance documents; review round 1 on
 * fix/applicant-receipt-and-billing-scope, finding I-1).
 *
 * On a real Postgres, through the real tenant + active-entity middlewares:
 *   - B (OWNER of company X) and V (VIEWER of X) — neither filed X's application —
 *     list X's invoice in X's workspace and download its receipt and its invoice PDF;
 *   - stranger C gets 403 on both doors;
 *   - A filed X's application, then A's membership on X is REVOKED → 403 on both doors;
 *   - the personal workspace never lists X's invoice;
 *   - a legacy invoice whose application has no entity stays visible to its filer
 *     (and to no one else);
 *   - a soft-deleted invoice is 404 on the owner doors;
 *   - review round 2: a member of both X and Y lists only X in X's workspace and
 *     is let through Y's doors by membership; a PENDING member of X is refused on
 *     both doors and cannot list X.
 *
 * Only authentication is attached by hand. PDF rendering goes through the real
 * template service in htmlOnly mode (pdf-parse cannot run under jest's CJS
 * transform); the one-page PDF itself is proven by receipt-tax-invoice-paper.test.js.
 * Skips cleanly without a migrated test database.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const { activeEntityMiddleware } = jest.requireActual('../../middleware/active-entity-middleware');
    const bindTenant = tenantContextMiddleware();
    const bindEntity = activeEntityMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, () => bindEntity(req, res, next));
    };
    return { authenticateAny: attach, authenticateHealth: attach, authenticateProvider: attach };
});

d('company finance documents follow membership (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const uid = () => crypto.randomUUID();
    const suffix = uid().slice(0, 8);
    const fx = { apps: [], invoices: [], entities: [], users: [], memberships: [] };

    async function makeUser(label) {
        const id = uid();
        const canonicalId = `mbr-${label}-${suffix}`;
        await raw.user.create({
            data: {
                id, canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `mbr-${label}-${suffix}@example.test`, firstName: 'ทดสอบ', lastName: label,
                organizationId: fx.orgId,
            },
        });
        fx.users.push(id);
        const personal = await raw.entity.create({
            data: { type: 'INDIVIDUAL', displayName: `ทดสอบ ${label}`, organizationId: fx.orgId },
        });
        fx.entities.push(personal.id);
        await raw.entityMembership.create({
            data: { userId: id, entityId: personal.id, role: 'OWNER', status: 'ACTIVE', organizationId: fx.orgId },
        });
        return { id, canonicalId, personalId: personal.id };
    }

    async function join(user, entityId, role) {
        const m = await raw.entityMembership.create({
            data: { userId: user.id, entityId, role, status: 'ACTIVE', organizationId: fx.orgId },
        });
        fx.memberships.push(m.id);
        return m;
    }

    async function billed({ label, filer, entityId, isDeleted = false }) {
        const application = await raw.application.create({
            data: {
                applicationNumber: `APP-MBR-${label}-${suffix}`, healthId: filer.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.orgId, entityId, status: 'DOC_FEE_PAID',
                formData: { applicantData: { address: '1 หมู่ 2', province: 'นนทบุรี', postalCode: '11000' } },
            },
        });
        fx.apps.push(application.id);
        const invoice = await raw.invoice.create({
            data: {
                invoiceNumber: `INV-MBR-${label}-${suffix}`, applicationId: application.id, healthId: filer.canonicalId,
                serviceType: 'CERTIFICATION_CHECKOUT_M1', subtotal: 5500, vat: 385, totalAmount: 5885,
                dueDate: new Date('2026-10-08T00:00:00Z'), organizationId: fx.orgId,
                status: 'paid', paidAt: new Date('2026-09-29T08:14:45Z'), paymentMethod: 'STRIPE',
                receiptNumber: `TAX-PRD-MBR-${label}-${suffix}`, receiptIssuedAt: new Date('2026-09-29T08:14:45Z'),
                receiptIssuedBy: 'stripe-webhook', receiptStatus: 'ISSUED',
                isDeleted, ...(isDeleted ? { deletedAt: new Date(), deletedBy: 'test', deleteReason: 'test' } : {}),
            },
        });
        fx.invoices.push(invoice.id);
        return invoice;
    }

    const as = (user) => {
        mockActor.current = { id: user.id, canonicalId: user.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.orgId };
    };
    const listIds = async (headers = {}) => {
        const res = await request(app).get('/api/invoices/my').set(headers);
        return { status: res.status, ids: Array.isArray(res.body?.data) ? res.body.data.map((i) => i.id).sort() : null };
    };
    const receiptDoor = (id, headers = {}) => request(app).get(`/api/invoices/my/${id}/receipt/pdf`).set(headers);
    const invoiceDoor = (id, headers = {}) => request(app).get(`/api/invoices/${id}/pdf`).set(headers);

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: `mbr-${suffix}`, slug: `mbr-${suffix}`, code: `MBR_${suffix}`.toUpperCase() },
        });
        fx.orgId = org.id;

        fx.A = await makeUser('filer');
        fx.B = await makeUser('owner');
        fx.V = await makeUser('viewer');
        fx.C = await makeUser('stranger');
        const company = await raw.entity.create({
            data: { type: 'JURISTIC', displayName: 'บริษัท สมาชิกร่วม จำกัด', juristicId: '0105561234560', organizationId: fx.orgId },
        });
        fx.X = company.id;
        fx.entities.push(company.id);
        fx.aOnX = await join(fx.A, fx.X, 'MANAGER');
        await join(fx.B, fx.X, 'OWNER');
        await join(fx.V, fx.X, 'VIEWER');

        fx.companyInvoice = await billed({ label: 'X', filer: fx.A, entityId: fx.X });
        fx.deletedInvoice = await billed({ label: 'DEL', filer: fx.A, entityId: fx.X, isDeleted: true });
        fx.legacyInvoice = await billed({ label: 'LEG', filer: fx.A, entityId: null });

        // Review round 2 — W belongs to X (VIEWER) and to Y (OWNER); Y's invoice was
        // filed by B. P was invited to X but has not accepted (PENDING).
        fx.W = await makeUser('both');
        fx.P = await makeUser('pending');
        const companyY = await raw.entity.create({
            data: { type: 'JURISTIC', displayName: 'บริษัท วาย จำกัด', juristicId: '0105561234560', organizationId: fx.orgId },
        });
        fx.Y = companyY.id;
        fx.entities.push(companyY.id);
        await join(fx.W, fx.X, 'VIEWER');
        await join(fx.W, fx.Y, 'OWNER');
        await join(fx.B, fx.Y, 'MANAGER');
        await raw.entityMembership.create({
            data: { userId: fx.P.id, entityId: fx.X, role: 'VIEWER', status: 'PENDING', organizationId: fx.orgId },
        });
        fx.companyYInvoice = await billed({ label: 'Y', filer: fx.B, entityId: fx.Y });

        const tpl = require('../../services/pdf/invoice-template-service');
        const realReceipt = tpl.generateReceiptTaxInvoicePdf;
        const realInvoice = tpl.generateInvoicePdf;
        jest.spyOn(tpl, 'generateReceiptTaxInvoicePdf').mockImplementation(async (inv, opts = {}) => Buffer.from(await realReceipt(inv, { ...opts, htmlOnly: true }), 'utf8'));
        jest.spyOn(tpl, 'generateInvoicePdf').mockImplementation(async (inv, opts = {}) => Buffer.from(await realInvoice(inv, { ...opts, htmlOnly: true }), 'utf8'));

        app = express();
        app.use(express.json());
        app.use('/api/invoices', require('../../routes/api/finance/invoices'));
    });

    afterAll(async () => {
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

    describe.each([['OWNER', 'B'], ['VIEWER', 'V']])('co-member %s of company X (did not file)', (_role, key) => {
        test('lists X\'s invoice in X\'s workspace', async () => {
            as(fx[key]);
            const { status, ids } = await listIds({ 'x-active-entity-id': fx.X });
            expect(status).toBe(200);
            expect(ids).toEqual([fx.companyInvoice.id]);
        });

        test('downloads X\'s receipt', async () => {
            as(fx[key]);
            const res = await receiptDoor(fx.companyInvoice.id, { 'x-active-entity-id': fx.X });
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/application\/pdf/);
        });

        test('downloads X\'s invoice PDF', async () => {
            as(fx[key]);
            const res = await invoiceDoor(fx.companyInvoice.id, { 'x-active-entity-id': fx.X });
            expect(res.status).toBe(200);
        });

        test('the personal workspace does not list X\'s invoice', async () => {
            as(fx[key]);
            const { status, ids } = await listIds();
            expect(status).toBe(200);
            expect(ids).not.toContain(fx.companyInvoice.id);
        });
    });

    describe('stranger C (no membership on X)', () => {
        test('403 on the receipt door', async () => {
            as(fx.C);
            expect((await receiptDoor(fx.companyInvoice.id)).status).toBe(403);
        });
        test('403 on the invoice PDF door', async () => {
            as(fx.C);
            expect((await invoiceDoor(fx.companyInvoice.id)).status).toBe(403);
        });
        test('403 on the legacy invoice of another filer', async () => {
            as(fx.C);
            expect((await receiptDoor(fx.legacyInvoice.id)).status).toBe(403);
        });
    });

    describe('legacy invoice (application without an entity)', () => {
        test('its filer lists it in the personal workspace', async () => {
            as(fx.A);
            const { ids } = await listIds();
            expect(ids).toContain(fx.legacyInvoice.id);
            expect(ids).not.toContain(fx.companyInvoice.id);
        });
        test('its filer downloads its receipt', async () => {
            as(fx.A);
            expect((await receiptDoor(fx.legacyInvoice.id)).status).toBe(200);
        });
        test('a company co-member does not see it', async () => {
            as(fx.B);
            expect((await receiptDoor(fx.legacyInvoice.id)).status).toBe(403);
            const { ids } = await listIds({ 'x-active-entity-id': fx.X });
            expect(ids).not.toContain(fx.legacyInvoice.id);
        });
    });

    describe('a soft-deleted invoice', () => {
        test('404 on both owner doors, and not listed', async () => {
            as(fx.B);
            expect((await receiptDoor(fx.deletedInvoice.id, { 'x-active-entity-id': fx.X })).status).toBe(404);
            expect((await invoiceDoor(fx.deletedInvoice.id, { 'x-active-entity-id': fx.X })).status).toBe(404);
            const { ids } = await listIds({ 'x-active-entity-id': fx.X });
            expect(ids).not.toContain(fx.deletedInvoice.id);
        });
    });

    describe('W, a member of both X and Y (review round 2)', () => {
        test('X\'s workspace lists only X\'s invoice', async () => {
            as(fx.W);
            const { status, ids } = await listIds({ 'x-active-entity-id': fx.X });
            expect(status).toBe(200);
            expect(ids).toEqual([fx.companyInvoice.id]);
        });
        test('Y\'s workspace lists only Y\'s invoice', async () => {
            as(fx.W);
            const { ids } = await listIds({ 'x-active-entity-id': fx.Y });
            expect(ids).toEqual([fx.companyYInvoice.id]);
        });
        test('Y\'s receipt and invoice PDF are allowed by membership, whichever workspace is active', async () => {
            as(fx.W);
            expect((await receiptDoor(fx.companyYInvoice.id, { 'x-active-entity-id': fx.X })).status).toBe(200);
            expect((await invoiceDoor(fx.companyYInvoice.id, { 'x-active-entity-id': fx.X })).status).toBe(200);
        });
    });

    describe('P, a PENDING member of X (review round 2)', () => {
        test('403 on the receipt door', async () => {
            as(fx.P);
            expect((await receiptDoor(fx.companyInvoice.id)).status).toBe(403);
        });
        test('403 on the invoice PDF door', async () => {
            as(fx.P);
            expect((await invoiceDoor(fx.companyInvoice.id)).status).toBe(403);
        });
        test('cannot list X: the X workspace is refused, the personal one does not hold X\'s invoice', async () => {
            as(fx.P);
            expect((await listIds({ 'x-active-entity-id': fx.X })).status).toBe(403);
            const { ids } = await listIds();
            expect(ids).not.toContain(fx.companyInvoice.id);
        });
    });

    describe('A filed X\'s application, then A\'s membership on X was revoked', () => {
        beforeAll(async () => {
            await raw.entityMembership.update({ where: { id: fx.aOnX.id }, data: { status: 'REVOKED' } });
        });
        test('403 on the receipt door', async () => {
            as(fx.A);
            expect((await receiptDoor(fx.companyInvoice.id)).status).toBe(403);
        });
        test('403 on the invoice PDF door', async () => {
            as(fx.A);
            expect((await invoiceDoor(fx.companyInvoice.id)).status).toBe(403);
        });
        test('the personal workspace does not list X\'s invoice', async () => {
            as(fx.A);
            const { ids } = await listIds();
            expect(ids).not.toContain(fx.companyInvoice.id);
        });
    });
});
