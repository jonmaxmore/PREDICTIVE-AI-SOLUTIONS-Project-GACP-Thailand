'use strict';
/**
 * payment-terms v1.2 roll-out, on a real Postgres with the consent tables
 * (operator 2026-10-03: "ใช้ 1.2" → "ทำได้เลย"; v1.2 replaces v1.1 for NEW
 * acceptances, and whoever accepted v1.1 stays under v1.1 for what they paid).
 *
 * Three questions, each answered on the real rows a mocked prisma cannot hold
 * (user_consents @@unique(userId, category), checkout_orders, the webhook
 * ledger and the journal):
 *   (a) an applicant whose only grant is v1.1 is refused at the NEXT checkout
 *       until they accept v1.2, sees that their grant is not current
 *       (getUserConsents: version ≠ currentVersion), and the order minted after
 *       they accept carries v1.2;
 *   (b) an order stamped v1.1 keeps that stamp and still settles;
 *   (c) a checkout already in flight when v1.2 shipped (order + payment intent
 *       created under v1.1) settles from its webhook, and re-entering it after
 *       accepting v1.2 hands back the SAME order without restamping it.
 *
 * "Under v1.1" is reproduced literally: the services are loaded in an isolated
 * module registry with CONSENT_VERSION_PAYMENT_TERMS=payment-terms-th-v1.1, the
 * value the code default had before this change.
 *
 * Gateway: the mock adapter (PAYMENT_ADAPTER=mock), network-free.
 */

process.env.PAYMENT_ADAPTER = 'mock';

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const V11 = 'payment-terms-th-v1.1';
const V12 = 'payment-terms-th-v1.2';
const ENV_KEY = 'CONSENT_VERSION_PAYMENT_TERMS';

const quotationService = require('../../services/quotation-service');
const { issueQuotationOnSubmit } = require('../../services/quotation-issuance-on-submit');
const { createCheckoutForApplication } = require('../../services/checkout/stripe-checkout-service');
const { settleEvent } = require('../../services/checkout/checkout-settlement-service');
const mockAdapter = require('../../services/payment/mock-payment-adapter');
const { ConsentCategory, ConsentVersions, consentManager } = require('../../middleware/consent-manager');

/**
 * Run `fn` against the services as the v1.1 deploy loaded them. Async isolation
 * because the checkout door requires its gate lazily, at call time: the whole
 * press has to happen inside the isolated registry, or the gate it reaches is
 * this file's v1.2 one.
 */
async function underV11(fn) {
    const had = Object.prototype.hasOwnProperty.call(process.env, ENV_KEY);
    const saved = process.env[ENV_KEY];
    process.env[ENV_KEY] = V11;
    let result;
    try {
        await jest.isolateModulesAsync(async () => {
            const versions = require('../../middleware/consent-manager').ConsentVersions;
            const checkout = require('../../services/checkout/stripe-checkout-service');
            const { prisma: isolated } = require('../../services/prisma-database');
            try {
                result = await fn({ versions, checkout });
            } finally {
                await isolated.$disconnect();
            }
        });
    } finally {
        if (had) { process.env[ENV_KEY] = saved; } else { delete process.env[ENV_KEY]; }
    }
    return result;
}

d('payment-terms v1.2 roll-out, on a real Postgres', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let holder;
    const users = [];
    const appIds = [];
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        mockAdapter.__reset();
        const org = await prisma.organization.create({
            data: { name: 'PT12 org', slug: `pt12-${suffix}`, code: `PT12_${suffix}`.toUpperCase().slice(0, 24) },
        });
        orgId = org.id;
        holder = await prisma.entity.create({ data: { type: 'INDIVIDUAL', displayName: `holder ${suffix}`, organizationId: orgId } });
    });

    afterAll(async () => {
        for (const id of appIds) {
            const orders = await prisma.checkoutOrder.findMany({ where: { applicationId: id } });
            for (const o of orders) {
                await prisma.journalEntry.deleteMany({ where: { sourceId: o.id } }).catch(() => {});
            }
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
        await prisma.stripeWebhookEvent.deleteMany({ where: { id: { contains: suffix } } }).catch(() => {});
        for (const u of users) {
            await prisma.userConsent.deleteMany({ where: { userId: u.id } }).catch(() => {});
            await prisma.user.deleteMany({ where: { id: u.id } }).catch(() => {});
        }
        if (holder) { await prisma.entity.deleteMany({ where: { id: holder.id } }).catch(() => {}); }
        if (orgId) { await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {}); }
        await prisma.$disconnect();
    });

    /** An applicant whose only payment-terms grant is the v1.1 one. */
    async function applicantWhoAcceptedV11(label) {
        const user = await prisma.user.create({
            data: { canonicalId: `pt12-${label}-${suffix}`, password: 'x', organizationId: orgId, authType: 'EMAIL_LEGACY' },
        });
        users.push(user);
        await prisma.userConsent.create({
            data: {
                userId: user.id, organizationId: orgId, category: ConsentCategory.PAYMENT_TERMS,
                version: V11, granted: true, grantedAt: new Date('2026-09-20T03:00:00.000Z'),
            },
        });
        return user;
    }

    async function acceptedApplication(user, label) {
        const app = await prisma.application.create({
            data: {
                applicationNumber: `PT12-${label}-${suffix}`, healthId: user.canonicalId, areaType: 'OUTDOOR',
                organizationId: orgId, entityId: holder.id, status: 'PENDING_DOC_FEE', formData: {},
            },
        });
        appIds.push(app.id);
        expect(await issueQuotationOnSubmit({ application: app, actorId: null })).toEqual({ issued: true });
        const [qt] = await prisma.quotation.findMany({ where: { applicationId: app.id, isDeleted: false } });
        await quotationService.markQuotationAccepted(qt.id, {
            acceptedBy: null, snapshot: quotationService.buildAcceptanceSnapshot(qt),
        });
        return app;
    }

    const pressWith = (door, user, app) => door.createCheckoutForApplication({
        applicationId: app.id, milestone: 'M1',
        actor: {
            id: user.id, healthId: user.canonicalId, role: 'health',
            holderScope: { userId: user.id, readIds: [holder.id], editIds: [holder.id] },
        },
    });
    const press = (user, app) => pressWith({ createCheckoutForApplication }, user, app);

    async function webhookSettles(order, tag) {
        const eventId = `evt_pt12_${tag}_${suffix}`;
        await prisma.stripeWebhookEvent.create({
            data: {
                id: eventId, type: 'payment_intent.succeeded', status: 'RECEIVED', attempts: 0,
                payload: { data: { object: {
                    id: order.stripePaymentIntentId, amount: 588500, amount_received: 588500,
                    metadata: { checkoutOrderId: order.id, milestone: 'M1' },
                } } },
            },
        });
        return settleEvent(eventId);
    }

    test('the runtime under test is v1.2 and the reproduced v1.1 deploy is v1.1', async () => {
        expect(ConsentVersions.PAYMENT_TERMS).toBe(V12);
        expect(await underV11(async ({ versions }) => versions.PAYMENT_TERMS)).toBe(V11);
    });

    test('(a) a v1.1-only applicant is asked to accept v1.2 before the next checkout; the order then carries v1.2', async () => {
        const user = await applicantWhoAcceptedV11('a');
        const app = await acceptedApplication(user, 'a');

        // What the checkout screen reads on open: granted, but not the current version,
        // so isPaymentTermsGranted answers false and the box is drawn again.
        const status = await consentManager.getUserConsents(user.id);
        expect(status.PAYMENT_TERMS).toMatchObject({ granted: true, version: V11, currentVersion: V12 });

        await expect(press(user, app)).rejects.toMatchObject({ code: 'PAYMENT_TERMS_NOT_ACCEPTED', status: 409 });
        expect(await prisma.checkoutOrder.count({ where: { applicationId: app.id } })).toBe(0);

        // POST /api/consent {category:'PAYMENT_TERMS', granted:true} — the call the box makes.
        await consentManager.recordConsent(user.id, ConsentCategory.PAYMENT_TERMS, true, '127.0.0.1', 'jest');
        const grant = await prisma.userConsent.findUnique({
            where: { userId_category: { userId: user.id, category: ConsentCategory.PAYMENT_TERMS } },
        });
        expect(grant).toMatchObject({ granted: true, version: V12 });

        const minted = await press(user, app);
        const order = await prisma.checkoutOrder.findUnique({ where: { id: minted.checkoutOrderId } });
        expect(order.paymentTermsVersion).toBe(V12);
        expect(order.paymentTermsAcceptedAt.toISOString()).toBe(grant.grantedAt.toISOString());
        expect(Number(order.totalPayableAmount)).toBe(5885);
    });

    test('(b)+(c) an order minted under v1.1 and still in flight settles from its webhook after v1.2 ships, keeping its v1.1 stamp', async () => {
        const user = await applicantWhoAcceptedV11('bc');
        const app = await acceptedApplication(user, 'bc');

        // Before the deploy: the v1.1 door mints the order and the payment intent.
        const minted = await underV11(({ checkout }) => pressWith(checkout, user, app));
        const before = await prisma.checkoutOrder.findUnique({ where: { id: minted.checkoutOrderId } });
        expect(before).toMatchObject({ status: 'PENDING_PAYMENT', paymentTermsVersion: V11 });
        expect(before.stripePaymentIntentId).toBeTruthy();

        // After the deploy: a NEW checkout by the same applicant is refused until they accept v1.2 …
        await expect(press(user, app)).rejects.toMatchObject({ code: 'PAYMENT_TERMS_NOT_ACCEPTED' });

        // … but the money already asked for under v1.1 settles, and the evidence row is not rewritten.
        const outcome = await webhookSettles(before, 'bc');
        expect(outcome.status).toBe('PROCESSED');
        const after = await prisma.checkoutOrder.findUnique({ where: { id: before.id } });
        expect(after.status).toBe('SETTLED');
        expect(after.paymentTermsVersion).toBe(V11);
        expect(after.paymentTermsAcceptedAt.toISOString()).toBe(before.paymentTermsAcceptedAt.toISOString());
        expect(Number(after.totalPayableAmount)).toBe(5885);
        const consent = await prisma.userConsent.findUnique({
            where: { userId_category: { userId: user.id, category: ConsentCategory.PAYMENT_TERMS } },
        });
        expect(consent.version).toBe(V11);
    });

    test('(c) re-entering an in-flight v1.1 order after accepting v1.2 hands back the same order, stamp unchanged, and it settles', async () => {
        const user = await applicantWhoAcceptedV11('c2');
        const app = await acceptedApplication(user, 'c2');
        const minted = await underV11(({ checkout }) => pressWith(checkout, user, app));

        await consentManager.recordConsent(user.id, ConsentCategory.PAYMENT_TERMS, true, '127.0.0.1', 'jest');
        const again = await press(user, app);

        expect(again.checkoutOrderId).toBe(minted.checkoutOrderId);
        const order = await prisma.checkoutOrder.findUnique({ where: { id: minted.checkoutOrderId } });
        expect(order.paymentTermsVersion).toBe(V11);
        expect(await prisma.checkoutOrder.count({ where: { applicationId: app.id } })).toBe(1);

        expect((await webhookSettles(order, 'c2')).status).toBe('PROCESSED');
        expect((await prisma.checkoutOrder.findUnique({ where: { id: order.id } })).status).toBe('SETTLED');
    });
});
