/**
 * ถอดระบบนำส่งเงินกรมฯ (DTAM remittance) — operator 2026-09-11 "ถอดออกทั้งระบบ"
 *
 * PR1 ถอดเฉพาะโค้ด: service · route + mount · job รายเดือน + การลงทะเบียนใน scheduler ·
 * คำศัพท์สถานะ · และการเขียน `dtamRemittanceStatus: 'PENDING'` ตอน settle
 * ตาราง/คอลัมน์ดรอปใน PR3 (migration 20260929155037 · เทส dtam-remittance-schema-dropped.test.js) —
 * เทสนี้ล็อก *ความสามารถ* ไม่ใช่ schema
 *
 * PR1 ตั้งใจเก็บ (ตอนนั้นมติ operator ยังค้าง): บัญชี 2151-001 และการลงบัญชีของมัน,
 * `recordRemittanceToDtam` / `buildRemittanceEntryLines`, `buildGovRemittanceReport` ·
 * มติ operator 2026-09-29 (ชำระกับกรมฯ นอกระบบ ลงบัญชีในสมุดบัญชีบริษัทเอง) ถอดทั้งหมดนั้นใน PR2 —
 * เทสกันอยู่ที่ dtam-accounting-layer-removed.test.js
 */

'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');

// Placeholder credentials, split so secret-literal scanners never match them.
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'x'.repeat(24);
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_' + 'x'.repeat(24);
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_' + 'x'.repeat(24);
process.env.STRIPE_CHECKOUT_ENABLED = 'true';

const BACKEND = path.resolve(__dirname, '../..');

const GONE_MODULES = [
    'services/checkout/dtam-remittance-service',
    'routes/api/finance/dtam-remittance',
    'jobs/dtam-remittance-batch-job',
    'shared/dtam-remittance-status',
];

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
mockLogger.createLogger = jest.fn(() => mockLogger);
mockLogger.stream = { write: jest.fn() };

describe('โมดูลของ pipeline นำส่งเงินกรมฯ ไม่มีอยู่แล้ว', () => {
    test.each(GONE_MODULES)('require(%s) โยน MODULE_NOT_FOUND', (rel) => {
        let caught = null;
        jest.isolateModules(() => {
            try {
                require(path.join(BACKEND, rel));
            } catch (err) {
                caught = err;
            }
        });
        expect(caught).not.toBeNull();
        expect(caught.code).toBe('MODULE_NOT_FOUND');
    });
});

describe('ประตู /api/finance/dtam-remittance ไม่ถูก mount', () => {
    function buildApiApp() {
        let router;
        jest.isolateModules(() => {
            // ผู้เรียกเป็น system_admin_dtam — บทบาทที่เคยผ่านทุกประตูของ route นี้ ถ้ายังมี
            // ประตูอยู่ คำตอบจะไม่ใช่ 404
            jest.doMock('../../middleware/auth-middleware', () => {
                const pass = (req, _res, next) => {
                    req.user = { id: 'user-1', role: 'system_admin_dtam', organizationId: 'org-1' };
                    next();
                };
                return {
                    authenticate: pass,
                    authenticateHealth: pass,
                    authenticateProvider: pass,
                    authenticateAny: pass,
                    authenticateDTAM: pass,
                    optionalAuth: pass,
                    requireVerification: pass,
                    authorizeRoles: () => pass,
                    authorize: () => pass,
                    requireRole: () => pass,
                    checkPermission: () => pass,
                    rateLimitSensitive: () => pass,
                };
            });
            jest.doMock('../../shared/logger', () => mockLogger);
            // services/trace-service/common.js requires server.js, which requires this
            // router back — the cycle hands server.js a half-built router. The server's
            // prisma singleton is optional there (it falls back to prisma-database).
            jest.doMock('../../server', () => ({ prisma: null }));
            router = require('../../routes/api/index');
        });
        const app = express();
        app.use(express.json());
        app.use('/api', router);
        return app;
    }

    test.each([
        ['get', '/api/finance/dtam-remittance'],
        ['post', '/api/finance/dtam-remittance/batches'],
        ['post', '/api/finance/dtam-remittance/batches/b-1/remit'],
        ['post', '/api/finance/dtam-remittance/batches/b-1/reconcile'],
        ['delete', '/api/finance/dtam-remittance/batches/b-1'],
    ])('%s %s → 404', async (method, url) => {
        const res = await request(buildApiApp())[method](url).send({ bankReference: 'REF-1' });
        expect(res.status).toBe(404);
    });
});

describe('scheduler ไม่ลงทะเบียนงานนำส่งเงินกรมฯ', () => {
    test('ไม่มี cron 0 2 1 * * และไม่มี callback ไหนเรียก dtam-remittance-batch-job', async () => {
        const mockCronSchedule = jest.fn(() => ({ stop: jest.fn() }));
        const mockOpenMonthlyBatches = jest.fn(async () => ({}));
        let scheduler;
        jest.isolateModules(() => {
            jest.doMock('node-cron', () => ({ schedule: (...args) => mockCronSchedule(...args) }));
            jest.doMock('../../shared/logger', () => mockLogger);
            jest.doMock('../../jobs/revision-deadline-checker', () => ({ checkExpiredDeadlines: jest.fn(async () => ({})) }));
            jest.doMock('../../jobs/work-activity-sla-monitor', () => ({ checkOverdueActivities: jest.fn(async () => ({})) }));
            jest.doMock('../../cron/renewal-reminder-cron', () => ({ run: jest.fn(async () => ({})) }));
            // virtual: ไฟล์จริงถูกลบแล้ว — ถ้ามี callback ใด require มัน จะมาเจอตัวนับนี้
            jest.doMock('../../jobs/dtam-remittance-batch-job', () => ({
                openMonthlyBatches: (...a) => mockOpenMonthlyBatches(...a),
            }), { virtual: true });
            scheduler = require('../../jobs/scheduler.js');
        });
        scheduler.start();

        expect(mockCronSchedule.mock.calls.map((c) => c[0])).not.toContain('0 2 1 * *');
        const logged = mockLogger.info.mock.calls.map((c) => String(c[0]));
        expect(logged.filter((m) => /remittance/i.test(m))).toEqual([]);
        scheduler.stop();
        expect(mockOpenMonthlyBatches).not.toHaveBeenCalled();
    });
});

describe('settlement ไม่เขียน dtamRemittanceStatus อีก', () => {
    test('payload ของ checkoutOrder.update ตอน settle มีแค่ status + settledAt', async () => {
        const order = {
            id: 'co-1',
            applicationId: 'app-1',
            milestone: 'M1',
            status: 'PENDING_PAYMENT',
            platformFeeNet: '5500.00',
            platformFeeVat: '385.00',
            platformFeeGross: '5885.00',
            totalPayableAmount: '5885.00',
            stripePaymentIntentId: 'pi_1',
            invoiceId: 'inv-1',
            paymentTransactionId: 'pt-1',
            organizationId: 'org-1',
            quotationId: 'qt-1',
            application: { id: 'app-1', status: 'PENDING_DOC_FEE', applicationNumber: 'APP-2026-000001' },
            invoice: { id: 'inv-1', invoiceNumber: 'INV-CO-1' },
        };
        const db = {
            checkoutOrder: {
                findFirst: jest.fn(async () => order),
                update: jest.fn(async ({ data }) => ({ ...order, ...data })),
                updateMany: jest.fn(async () => ({ count: 1 })),
            },
            invoice: { update: jest.fn(async () => ({})) },
            paymentTransaction: { update: jest.fn(async () => ({})) },
            stripeWebhookEvent: { update: jest.fn(async () => ({})), findUnique: jest.fn() },
            checkoutDocument: { create: jest.fn(async ({ data }) => data) },
            quotation: { findFirst: jest.fn(), update: jest.fn() },
            $queryRaw: jest.fn(async () => [{ id: 'co-1', status: 'PENDING_PAYMENT' }]),
        };
        db.$transaction = jest.fn(async (cb) => cb(db));

        let settleFromPaymentIntent;
        jest.isolateModules(() => {
            jest.doMock('../../shared/logger', () => mockLogger);
            jest.doMock('../../services/prisma-database', () => ({ prisma: db }));
            jest.doMock('../../services/application-status-writer', () => ({
                writeApplicationStatus: jest.fn(async () => ({})),
            }));
            jest.doMock('../../services/journal-entry-service', () => ({
                recordPaymentEntry: jest.fn(async () => ({ persisted: true, journalEntryId: 'je-1' })),
            }));
            jest.doMock('../../services/quotation-service', () => ({
                ...jest.requireActual('../../services/quotation-service'),
                recordPhaseInvoiced: jest.fn(async () => ({ quotationId: 'qt-1', phase: 'PHASE_1', closed: false })),
            }));
            jest.doMock('../../services/receipt-numbering-service', () => ({
                ...jest.requireActual('../../services/receipt-numbering-service'),
                allocateReceiptNumber: jest.fn(async () => ({ number: 'TAX-PRD-2026-000001' })),
            }));
            ({ settleFromPaymentIntent } = require('../../services/checkout/checkout-settlement-service'));
        });

        const result = await settleFromPaymentIntent({
            paymentIntent: {
                id: 'pi_1',
                amount: 588500,
                amount_received: 588500,
                metadata: { checkoutOrderId: 'co-1', milestone: 'M1' },
            },
            eventId: 'evt_1',
        });

        expect(result.settled).toBe(true);
        const settleUpdate = db.checkoutOrder.update.mock.calls
            .map((c) => c[0].data)
            .find((d) => d.status === 'SETTLED');
        expect(settleUpdate).toBeDefined();
        expect(settleUpdate).not.toHaveProperty('dtamRemittanceStatus');
        expect(Object.keys(settleUpdate).sort()).toEqual(['settledAt', 'status']);
    });
});
