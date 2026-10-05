'use strict';
/**
 * I-1 (PR2 Tier C review, 2026-09-29), on a real Postgres: after a
 * payment_intent.canceled webhook the applicant can pay again.
 *
 * The old handler cancelled the ORDER only; its invoice stayed live and
 * uniq_invoice_app_service_active (one live invoice per application +
 * serviceType, WHERE isDeleted = false) refused every later mint's invoice →
 * P2002 → CHECKOUT_ALREADY_IN_PROGRESS. A mocked prisma cannot see that index,
 * so it runs here: an ordinary one-fee order, canceled webhook → next press
 * mints afresh. (Case B, the recovery path of the checkout door's DTAM-portion
 * retire guard, went with that guard in PR3: migration 20260929155037 dropped
 * the column, so no order can carry a DTAM portion.)
 *
 * Gateway: the mock adapter (PAYMENT_ADAPTER=mock), network-free.
 * Run: DATABASE_URL=<local migrated postgres> TEST_DATABASE_URL=<same> npx jest --config jest.config.cjs \
 *        __tests__/integration/canceled-webhook-lets-the-applicant-pay-again-real-postgres.test.js -i
 */

process.env.PAYMENT_ADAPTER = 'mock';

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const quotationService = require('../../services/quotation-service');
const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
const { createCheckoutForApplication, checkoutInvoiceServiceType } = require('../../services/checkout/stripe-checkout-service');
const { handleStripeEvent } = require('../../services/checkout/checkout-settlement-service');
const mockAdapter = require('../../services/payment/mock-payment-adapter');
const { ConsentCategory, ConsentVersions } = require('../../middleware/consent-manager');

d('payment_intent.canceled lets the applicant pay again, on a real Postgres', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let holder;
    let user;
    const appIds = [];
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        mockAdapter.__reset();
        const org = await prisma.organization.create({
            data: { name: 'PR2 I-1 org', slug: `pr2-i1-${suffix}`, code: `PR2I1_${suffix}`.toUpperCase().slice(0, 24) },
        });
        orgId = org.id;
        user = await prisma.user.create({
            data: { canonicalId: `pr2-i1-canon-${suffix}`, password: 'x', organizationId: orgId, authType: 'EMAIL_LEGACY' },
        });
        await prisma.userConsent.create({
            data: {
                userId: user.id, organizationId: orgId, category: ConsentCategory.PAYMENT_TERMS,
                version: ConsentVersions.PAYMENT_TERMS, granted: true, grantedAt: new Date(),
            },
        });
        // The payer's holder (spec 2026-09-30 §3.1, Task 4): checkout reads within it.
        holder = await prisma.entity.create({ data: { type: 'INDIVIDUAL', displayName: `holder ${suffix}`, organizationId: orgId } });
    });

    afterAll(async () => {
        for (const id of appIds) {
            const orders = await prisma.checkoutOrder.findMany({ where: { applicationId: id } });
            await prisma.checkoutOrder.deleteMany({ where: { applicationId: id } }).catch(() => {});
            for (const o of orders) {
                if (o.invoiceId) { await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: o.invoiceId } }).catch(() => {}); }
            }
            await prisma.paymentTransaction.deleteMany({ where: { applicationId: id } }).catch(() => {});
            await prisma.invoice.deleteMany({ where: { applicationId: id } }).catch(() => {});
            await prisma.quotation.deleteMany({ where: { applicationId: id } }).catch(() => {});
            await prisma.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id } }).catch(() => {});
        }
        if (user) {
            await prisma.userConsent.deleteMany({ where: { userId: user.id } }).catch(() => {});
            await prisma.user.deleteMany({ where: { id: user.id } }).catch(() => {});
        }
        if (holder) { await prisma.entity.deleteMany({ where: { id: holder.id } }).catch(() => {}); }
        if (orgId) { await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {}); }
        await prisma.$disconnect();
    });

    async function seedAcceptedApplication(label) {
        const app = await prisma.application.create({
            data: {
                applicationNumber: `PR2I1-${label}-${suffix}`, healthId: user.canonicalId, areaType: 'OUTDOOR',
                organizationId: orgId, entityId: holder.id, status: 'PENDING_DOC_FEE', formData: {},
            },
        });
        appIds.push(app.id);
        expect(await issueQuotationOnSubmit({ application: app, actorId: null })).toEqual({ issued: true });
        const [qt] = await prisma.quotation.findMany({ where: { applicationId: app.id, isDeleted: false } });
        await quotationService.markQuotationAccepted(qt.id, {
            acceptedBy: null, snapshot: quotationService.buildAcceptanceSnapshot(qt),
        });
        return { app, qt };
    }

    const press = (app) => createCheckoutForApplication({
        applicationId: app.id, milestone: 'M1',
        actor: {
            id: user.id, healthId: user.canonicalId, role: 'health',
            holderScope: { userId: user.id, readIds: [holder.id], editIds: [holder.id] },
        },
    });
    const canceledEvent = (orderId, intentId, tag) => ({
        id: `evt_i1_${tag}_${suffix}`,
        type: 'payment_intent.canceled',
        data: { object: { id: intentId, status: 'canceled', metadata: { checkoutOrderId: orderId } } },
    });
    const liveInvoices = (appId) => prisma.invoice.findMany({
        where: { applicationId: appId, serviceType: checkoutInvoiceServiceType('M1'), isDeleted: false },
    });

    test('A. ordinary order: canceled webhook → order CANCELLED + invoice retired (deletedBy/deleteReason) + charge CANCELLED → next press mints afresh', async () => {
        const { app } = await seedAcceptedApplication('A');
        const first = await press(app);
        const firstOrder = await prisma.checkoutOrder.findUnique({ where: { id: first.checkoutOrderId } });
        await mockAdapter.cancelPaymentIntent(first.paymentIntentId);

        await handleStripeEvent(canceledEvent(firstOrder.id, first.paymentIntentId, 'A'));

        expect((await prisma.checkoutOrder.findUnique({ where: { id: firstOrder.id } })).status).toBe('CANCELLED');
        const inv = await prisma.invoice.findUnique({ where: { id: firstOrder.invoiceId } });
        expect(inv.isDeleted).toBe(true);
        expect(inv.deletedBy).toBe('system:checkout-order-retired');
        expect(inv.deleteReason).toBe('PAYMENT_INTENT_CANCELED');
        expect(Number(inv.totalAmount)).toBe(5885);
        expect((await prisma.paymentTransaction.findUnique({ where: { id: firstOrder.paymentTransactionId } })).status)
            .toBe('CANCELLED');

        const second = await press(app);

        expect(second.checkoutOrderId).not.toBe(firstOrder.id);
        const fresh = await prisma.checkoutOrder.findUnique({ where: { id: second.checkoutOrderId } });
        expect(fresh.status).toBe('PENDING_PAYMENT');
        expect(Number(fresh.totalPayableAmount)).toBe(5885);
        expect((await liveInvoices(app.id)).map((i) => i.id)).toEqual([fresh.invoiceId]);
    });
});
