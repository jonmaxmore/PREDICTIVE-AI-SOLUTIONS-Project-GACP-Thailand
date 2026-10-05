/**
 * R2 M5 integration (RED-first) — the payment-closure cron
 * (jobs/payment-closure-job.js), run against a REAL Postgres, must close an
 * application whose checkout payment was ABANDONED and ONLY then:
 *   - a case with a PENDING invoice > 30 calendar days past due AND all three
 *     reminder types logged (PRE_DUE / DUE_DATE / OVERDUE_NOTICE) is moved to a
 *     terminal status with closedReason = 'PAYMENT_ABANDONED' + exactly ONE
 *     canonical audit row.
 *
 * The two negative cases PROVE no false-close (operator money-safety mandate):
 *   - too-soon: an invoice only 10 days past due (but fully reminded) is NOT
 *     closed — remove the threshold guard and this goes RED.
 *   - reminders-incomplete: an invoice 31 days past due but with only 2 of the
 *     3 reminder types is NOT closed — remove the reminder guard and this goes RED.
 *
 * Idempotency: running the sweep twice over one abandoned case leaves round-2
 * deltas at zero (status, marker, audit all unchanged) — an already-EXPIRED case
 * is skipped, and no money is ever touched.
 *
 * Requires DATABASE_URL → a migrated Postgres; skips cleanly otherwise.
 */

const { PrismaClient } = require('@prisma/client');
const { runPaymentClosureSweep } = require('../../jobs/payment-closure-job');

// Not `Boolean(process.env.DATABASE_URL)`: jest.setup.js:104 pins that variable on every
// run, so the old HAS_DB was always true — this suite never skipped and died on connection
// refused. Ask the run-level guard what it actually probed; it names the reason in the title.
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const CLOSED_REASON = 'PAYMENT_ABANDONED';
const CHECKOUT_SERVICE_TYPE = 'CERTIFICATION_CHECKOUT';
const ALL_REMINDER_TYPES = ['PRE_DUE', 'DUE_DATE', 'OVERDUE_NOTICE'];

const DAY_MS = 24 * 60 * 60 * 1000;

d('R2 M5 — payment-abandonment close stamps marker + audit (no false-close)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let prisma;
    let orgId;
    let healthId;
    /** @type {string[]} */
    let createdAppIds;
    /** @type {string[]} */
    let createdInvoiceIds;

    beforeAll(async () => {
        prisma = new PrismaClient();
        await prisma.$connect();
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const org = await prisma.organization.create({
            data: {
                name: 'M5 Test Org',
                slug: `m5-pac-${suffix}`,
                code: `M5PAC_${suffix}`.toUpperCase().slice(0, 24),
            },
        });
        orgId = org.id;
        healthId = `m5-pac-canon-${suffix}`;
        await prisma.user.create({
            data: {
                canonicalId: healthId,
                password: 'x',
                organizationId: orgId,
                authType: 'EMAIL_LEGACY',
            },
        });
    });

    beforeEach(() => {
        createdAppIds = [];
        createdInvoiceIds = [];
    });

    afterEach(async () => {
        // Child-first cleanup (fresh DB per CI run, so leftovers are harmless;
        // this keeps re-runs on a shared local DB clean).
        for (const invId of createdInvoiceIds) {
            await prisma.paymentReminderLog.deleteMany({ where: { invoiceId: invId } }).catch(() => {});
            await prisma.invoice.deleteMany({ where: { id: invId } }).catch(() => {});
        }
        for (const id of createdAppIds) {
            await prisma.auditLog.deleteMany({ where: { resourceId: id } }).catch(() => {});
            await prisma.application.deleteMany({ where: { id } }).catch(() => {});
        }
        createdAppIds = [];
        createdInvoiceIds = [];
    });

    afterAll(async () => {
        if (healthId) {
            await prisma.user.deleteMany({ where: { canonicalId: healthId } }).catch(() => {});
        }
        if (orgId) {
            await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
        }
        await prisma.$disconnect();
    });

    /**
     * Seed one application at a payment gate with a single PENDING checkout
     * invoice `pastDueDays` calendar days past due, plus a PaymentReminderLog
     * row for each type in `reminderTypes`.
     */
    async function seedCase({
        pastDueDays = 31, reminderTypes = ALL_REMINDER_TYPES, status = 'PENDING_DOC_FEE',
        serviceType = CHECKOUT_SERVICE_TYPE,
    } = {}) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const app = await prisma.application.create({
            data: {
                applicationNumber: `M5-PAC-${suffix}`,
                healthId,
                areaType: 'OUTDOOR',
                organizationId: orgId,
                status,
                formData: { plot: 'keep-me', applicant: 'preserve' },
            },
        });
        createdAppIds.push(app.id);

        const dueDate = new Date(Date.now() - pastDueDays * DAY_MS);
        const invoice = await prisma.invoice.create({
            data: {
                invoiceNumber: `INV-M5-${suffix}`,
                healthId,
                applicationId: app.id,
                organizationId: orgId,
                serviceType,
                status: 'pending',
                subtotal: 5000,
                vat: 350,
                totalAmount: 5350,
                dueDate,
            },
        });
        createdInvoiceIds.push(invoice.id);

        let i = 0;
        for (const reminderType of reminderTypes) {
            await prisma.paymentReminderLog.create({
                data: {
                    invoiceId: invoice.id,
                    organizationId: orgId,
                    reminderType,
                    // Distinct intendedDate per type (unique key is
                    // invoiceId+reminderType+intendedDate); the value is not read.
                    intendedDate: new Date(dueDate.getTime() + i * DAY_MS),
                },
            });
            i += 1;
        }
        return { appId: app.id, invoiceId: invoice.id };
    }

    const auditCount = (appId) =>
        prisma.auditLog.count({ where: { resourceType: 'APPLICATION', resourceId: appId } });
    const getApp = (appId) =>
        prisma.application.findUnique({ where: { id: appId }, select: { status: true, closedReason: true } });
    const getInvoice = (invoiceId) =>
        prisma.invoice.findUnique({
            where: { id: invoiceId },
            select: { status: true, paidAt: true, subtotal: true, vat: true, totalAmount: true },
        });
    const paymentTxCount = (appId) =>
        prisma.paymentTransaction.count({ where: { applicationId: appId } });

    test('positive: abandoned case (31d past due + all 3 reminders) → EXPIRED + PAYMENT_ABANDONED + exactly +1 audit', async () => {
        const { appId, invoiceId } = await seedCase({ pastDueDays: 31, reminderTypes: ALL_REMINDER_TYPES });
        const before = await auditCount(appId);

        await runPaymentClosureSweep();

        const app = await getApp(appId);
        expect(app.status).toBe('EXPIRED');
        expect(app.closedReason).toBe(CLOSED_REASON);
        expect((await auditCount(appId)) - before).toBe(1);

        // Money-safety mandate: the close is money-STATE-adjacent, NOT money-
        // mutating. The invoice row it closed on must be BYTE-for-BYTE untouched —
        // still pending, never marked paid, amounts unchanged — and the close must
        // NOT have minted any payment transaction. (Decimal marshals as Decimal.js;
        // compare via Number.)
        const inv = await getInvoice(invoiceId);
        expect(inv.status).toBe('pending');
        expect(inv.paidAt).toBeNull();
        expect(Number(inv.subtotal)).toBe(5000);
        expect(Number(inv.vat)).toBe(350);
        expect(Number(inv.totalAmount)).toBe(5350);
        expect(await paymentTxCount(appId)).toBe(0);
    });

    test('F-CHECKOUT-M2 (2026-08-18): a milestone-dimensioned CERTIFICATION_CHECKOUT_M2 invoice is closed exactly like a legacy one (prefix match, real DB)', async () => {
        const { appId, invoiceId } = await seedCase({
            pastDueDays: 31,
            reminderTypes: ALL_REMINDER_TYPES,
            serviceType: `${CHECKOUT_SERVICE_TYPE}_M2`,
            status: 'PENDING_AUDIT_FEE',
        });

        await runPaymentClosureSweep();

        const app = await getApp(appId);
        expect(app.status).toBe('EXPIRED');
        expect(app.closedReason).toBe(CLOSED_REASON);
        // Money-safety: still money-STATE-adjacent, not money-mutating.
        const inv = await getInvoice(invoiceId);
        expect(inv.status).toBe('pending');
        expect(inv.paidAt).toBeNull();
    });

    test('no false-close (too-soon): invoice only 10d past due → NOT closed, closedReason null', async () => {
        const { appId } = await seedCase({ pastDueDays: 10, reminderTypes: ALL_REMINDER_TYPES });

        await runPaymentClosureSweep();

        const app = await getApp(appId);
        expect(app.status).toBe('PENDING_DOC_FEE');
        expect(app.closedReason).toBeNull();
    });

    test('no false-close (reminders-incomplete): 31d past due but only 2 of 3 reminder types → NOT closed', async () => {
        const { appId } = await seedCase({ pastDueDays: 31, reminderTypes: ['PRE_DUE', 'DUE_DATE'] });

        await runPaymentClosureSweep();

        const app = await getApp(appId);
        expect(app.status).toBe('PENDING_DOC_FEE');
        expect(app.closedReason).toBeNull();
    });

    test('audit: a run that closes nothing writes +0 audit rows', async () => {
        const { appId } = await seedCase({ pastDueDays: 10, reminderTypes: ALL_REMINDER_TYPES });
        const before = await auditCount(appId);

        await runPaymentClosureSweep();

        expect((await auditCount(appId)) - before).toBe(0);
    });

    test('idempotency: running the sweep twice over one abandoned case leaves round-2 deltas at zero', async () => {
        const { appId } = await seedCase({ pastDueDays: 31, reminderTypes: ALL_REMINDER_TYPES });

        await runPaymentClosureSweep(); // round 1 — closes it
        const afterOne = await getApp(appId);
        const auditAfterOne = await auditCount(appId);
        expect(afterOne.status).toBe('EXPIRED');
        expect(afterOne.closedReason).toBe(CLOSED_REASON);

        await runPaymentClosureSweep(); // round 2 — must be a no-op for this row
        const afterTwo = await getApp(appId);
        const auditAfterTwo = await auditCount(appId);

        expect(afterTwo.status).toBe(afterOne.status);
        expect(afterTwo.closedReason).toBe(afterOne.closedReason);
        expect(auditAfterTwo - auditAfterOne).toBe(0);
    });
});
