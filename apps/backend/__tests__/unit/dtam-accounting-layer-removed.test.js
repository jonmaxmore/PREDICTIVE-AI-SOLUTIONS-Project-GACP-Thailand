/**
 * ถอดชั้นบัญชีเจ้าหนี้กรมฯ (PR2 ของการถอดระบบนำส่งเงินกรมฯ)
 *
 * มติ operator 2026-09-29: บริษัทชำระกับกรมฯ นอกระบบ และลงบัญชีในสมุดบัญชีของบริษัทเอง ·
 * แพลตฟอร์มไม่ถือเจ้าหนี้กรมฯ ไม่มี pipeline นำส่ง ไม่แยกส่วนค่าธรรมเนียมของกรมฯ
 *
 * เทสนี้ล็อก *ความสามารถ*: settlement ไม่ลงบรรทัดบน 2151-001 (หรือต้นทุน 5110-001 ที่เป็นคู่ของมัน) ·
 * ไม่มีโมดูลส่งออกตัวบันทึกการนำส่ง · ผังบัญชีในโค้ดไม่มี PAYABLE_TO_DTAM ·
 * รายงานนำส่งเงินกรมฯ ไม่มีแล้ว · ราคาที่คิดไม่มีส่วนของกรมฯ แยก
 *
 * คอลัมน์ checkout_orders.dtam_fee_amount ถูกดรอปแล้วใน PR3 (migration 20260929155037)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
const DTAM_PAYABLE = '2151-001';
const DTAM_COST = '5110-001';
const ONE_FEE_CODES = ['1110-001', '4110-001', '2131-001'];

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
mockLogger.createLogger = jest.fn(() => mockLogger);
mockLogger.stream = { write: jest.fn() };

/** Source with comment lines stripped — so history comments do not count. */
function codeOnly(rel) {
    return fs.readFileSync(path.join(BACKEND, rel), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

describe('ไม่มีโมดูลส่งออกตัวบันทึกการนำส่งเงินกรมฯ', () => {
    test('journal-entry-service ไม่ส่งออก recordRemittanceToDtam / buildRemittanceEntryLines', () => {
        const jes = require('../../services/journal-entry-service');
        expect(jes).not.toHaveProperty('recordRemittanceToDtam');
        expect(jes).not.toHaveProperty('buildRemittanceEntryLines');
    });

    test('ไม่มีไฟล์ใน services/routes/jobs ที่ยังเรียกชื่อ recordRemittanceToDtam ในโค้ด', () => {
        const offenders = [];
        const walk = (dir) => {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, ent.name);
                if (ent.isDirectory()) { walk(full); continue; }
                if (!ent.name.endsWith('.js')) { continue; }
                const rel = path.relative(BACKEND, full);
                if (/recordRemittanceToDtam|buildRemittanceEntryLines|PAYABLE_TO_DTAM|COST_DTAM_FEE/.test(codeOnly(rel))) {
                    offenders.push(rel);
                }
            }
        };
        ['services', 'routes', 'jobs', 'shared', 'modules', 'controllers'].forEach((d) => {
            const dir = path.join(BACKEND, d);
            if (fs.existsSync(dir)) { walk(dir); }
        });
        expect(offenders).toEqual([]);
    });
});

describe('ผังบัญชีในโค้ดไม่มีเจ้าหนี้กรมฯ', () => {
    test('ACCOUNTS ไม่มี PAYABLE_TO_DTAM / COST_DTAM_FEE และไม่มีรหัส 2151-001 / 5110-001', () => {
        const { ACCOUNTS } = require('../../services/journal-accounts');
        expect(ACCOUNTS).not.toHaveProperty('PAYABLE_TO_DTAM');
        expect(ACCOUNTS).not.toHaveProperty('COST_DTAM_FEE');
        const codes = Object.values(ACCOUNTS).map((a) => a.code);
        expect(codes).not.toContain(DTAM_PAYABLE);
        expect(codes).not.toContain(DTAM_COST);
        // re-export ตัวเดียวกัน
        expect(require('../../services/journal-entry-service').ACCOUNTS).toBe(ACCOUNTS);
    });

    test('chart-of-accounts ไม่มี 2151-001 / 5110-001 — บัญชีมือ (manual journal) จึงลงไม่ได้ด้วย', () => {
        const coa = require('../../services/chart-of-accounts-service');
        expect(coa.accountExists(DTAM_PAYABLE)).toBe(false);
        expect(coa.accountExists(DTAM_COST)).toBe(false);
        const mentions = coa.getChartOfAccounts()
            .filter((row) => JSON.stringify(row).includes(DTAM_PAYABLE))
            .map((row) => row.code);
        expect(mentions).toEqual([]);
    });
});

describe('รายการบัญชีตอนชำระเงิน = ค่าบริการก้อนเดียว', () => {
    test('buildPaymentEntryLines ไม่ออกบรรทัด 2151-001 / 5110-001 แม้ผู้เรียกยังส่ง stateFee มา', () => {
        jest.isolateModules(() => {
            jest.doMock('../../services/prisma-database', () => ({ prisma: null }));
            const { buildPaymentEntryLines } = require('../../services/journal-entry-service');
            const e = buildPaymentEntryLines({
                invoiceId: 'inv-1',
                invoiceNumber: 'TAX-PRD-2569-0001',
                serviceType: 'CERTIFICATION_CHECKOUT_M1',
                totalAmount: 5885,
                components: { stateFee: 5000, platformFee: 500, vat: 385 },
            });
            const codes = e.lines.map((l) => l.accountCode);
            expect(codes).not.toContain(DTAM_PAYABLE);
            expect(codes).not.toContain(DTAM_COST);
        });
    });
});

function makeSettlementHarness(orderFigures) {
    const order = {
        id: 'co-1',
        applicationId: 'app-1',
        milestone: 'M1',
        status: 'PENDING_PAYMENT',
        ...orderFigures,
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
        journalEntry: {
            create: jest.fn(async ({ data }) => ({
                id: 'je-1',
                ...data,
                lines: data.lines.create.map((l, i) => ({ id: `jl-${i}`, ...l })),
            })),
        },
        $queryRaw: jest.fn(async () => [{ id: 'co-1', status: 'PENDING_PAYMENT' }]),
    };
    db.$transaction = jest.fn(async (cb) => cb(db));

    let settleFromPaymentIntent;
    // Each harness needs its OWN db behind prisma-database; without a reset the
    // second harness's settle ran against the first one's db.
    jest.resetModules();
    jest.isolateModules(() => {
        jest.doMock('../../shared/logger', () => mockLogger);
        jest.doMock('../../services/prisma-database', () => ({ prisma: db }));
        jest.doMock('../../services/period-guard-loader', () => ({
            loadPeriodGuardOrRefuse: () => ({ checkPeriodOpen: async () => undefined }),
        }));
        jest.doMock('../../services/application-status-writer', () => ({
            writeApplicationStatus: jest.fn(async () => ({})),
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

    const settle = () => settleFromPaymentIntent({
        paymentIntent: {
            id: 'pi_1',
            amount: Math.round(Number(orderFigures.totalPayableAmount) * 100),
            amount_received: Math.round(Number(orderFigures.totalPayableAmount) * 100),
            metadata: { checkoutOrderId: 'co-1', milestone: 'M1' },
        },
        eventId: 'evt_1',
    });
    const journalLines = () => db.journalEntry.create.mock.calls
        .flatMap((c) => c[0].data.lines.create);
    return { db, settle, journalLines };
}

describe('settlement (journal-entry-service ตัวจริง) ไม่ลงบรรทัดบนเจ้าหนี้กรมฯ', () => {
    test('order ปัจจุบัน: ลง 1110/4110/2131 เท่านั้น และใบกำกับแสดงค่าบริการตามคอลัมน์ค่าบริการ', async () => {
        const h = makeSettlementHarness({
            platformFeeNet: '5500.00',
            platformFeeVat: '385.00',
            platformFeeGross: '5885.00',
            totalPayableAmount: '5885.00',
        });
        const result = await h.settle();
        expect(result.settled).toBe(true);

        const lines = h.journalLines();
        expect(lines.length).toBeGreaterThan(0);
        expect([...new Set(lines.map((l) => l.accountCode))].sort()).toEqual([...ONE_FEE_CODES].sort());
        const sum = (side) => lines.reduce((s, l) => s + Number(l[side]), 0);
        expect(sum('debit')).toBe(5885);
        expect(sum('credit')).toBe(5885);

        const doc = h.db.checkoutDocument.create.mock.calls[0][0].data;
        expect(doc.payload.lines).toEqual([
            expect.objectContaining({ code: 'PLATFORM_FEE', amount: '5500' }),
        ]);
    });

    test('checkout-settlement-service ไม่ส่ง stateFee ให้ชั้นบัญชี และไม่บวกส่วนกรมฯ เข้าใบกำกับ', () => {
        const src = codeOnly('services/checkout/checkout-settlement-service.js');
        expect(src.match(/stateFee/g) || []).toEqual([]);
        expect(src.match(/dtamPayableAmount/g) || []).toEqual([]);
    });
});

describe('ราคาที่คิดไม่มีส่วนของกรมฯ แยก', () => {
    test('stripe-checkout-service ไม่มี dtamPayableAmount เลย — คอลัมน์ดรอปแล้วใน PR3', () => {
        const src = codeOnly('services/checkout/stripe-checkout-service.js');
        expect(src.match(/dtamPayableAmount/g) || []).toEqual([]);
    });
});

describe('รายงานนำส่งเงินกรมฯ ไม่มีแล้ว', () => {
    test('financial-export-service ไม่ส่งออก buildGovRemittanceReport และไม่มี case gov_remittance', () => {
        let svc;
        jest.isolateModules(() => {
            jest.doMock('../../services/prisma-database', () => ({
                prisma: { invoice: { findMany: jest.fn(async () => []) } },
            }));
            svc = require('../../services/financial-export-service');
        });
        expect(svc).not.toHaveProperty('buildGovRemittanceReport');
        // ชื่อยังปรากฏได้ในการปฏิเสธ (400 EXPORT_REPORT_TYPE_RETIRED — PR2 review M-3) แต่ต้องไม่มีทางออกรายงาน
        expect(codeOnly('services/financial-export-service.js').match(/case 'gov_remittance'|buildGovRemittanceReport/g) || []).toEqual([]);
    });
});
