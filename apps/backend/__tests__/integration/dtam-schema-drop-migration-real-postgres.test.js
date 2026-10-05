'use strict';
/**
 * PR3 ของการถอด DTAM remittance — contract migration บน Postgres จริง
 * (operator 2026-09-11 "ถอดออกทั้งระบบ" · 2026-09-29 บริษัทชำระกับกรมฯ นอกระบบ).
 *
 * เทสนี้สร้างฐานของตัวเองสามก้อนบนเซิร์ฟเวอร์เดียวกับ TEST_DATABASE_URL
 * (ต้องมีสิทธิ์ CREATE DATABASE) แล้วลบทิ้งตอนจบ:
 *   base   — apply ทุก migration ยกเว้นใบดรอป (= สภาพ staging/demo วันนี้)
 *   refuse — จาก base + order รูปเก่าที่มีส่วนของกรมฯ ยัง PENDING_PAYMENT
 *            และ batch ที่ REMITTED (บันทึกของเงินที่ออกไปจริง)
 *   ok     — จาก base + order รูปเก่าที่ CANCELLED แล้ว (หลังกดจ่ายหนึ่งครั้ง — PR2)
 *            และ batch OPEN (ร่าง ไม่มีเงินเคลื่อน)
 *   drift  — จาก base แต่ CHECK ยอดรวมเดิมถูกถอดด้วยมือ และมี order SETTLED ส่วนกรมฯ = 0
 *            ที่ total ≠ gross (review m3: เดิมตัวตรวจตอบ SAFE_TO_DROP แล้ว migrate ล้มด้วย P3018 ดิบ)
 *
 * พิสูจน์:
 *   1. refuse: ตัวตรวจก่อน deploy exit 1 พร้อมตัวเลข · migrate deploy ล้มเสียงดัง
 *      พร้อมจำนวน และไม่มีอะไรถูกดรอป (ทั้งใบอยู่ใน transaction เดียว)
 *   2. ok: ตัวตรวจ exit 0 · migrate deploy ผ่าน · ตาราง/คอลัมน์หายจริง · แถวเก่ายังอยู่
 *      และไม่มียอดเงินถูกเขียน · CHECK ใหม่ปฏิเสธยอดรวม ≠ ค่าบริการรวม และปฏิเสธการ
 *      settle แถวเก่า · mint + settle ใหม่ทั้งเส้นลงบัญชี 1110/4110/2131 เท่านั้น
 *   3. หลังดรอป ตัวตรวจยังตอบ exit 0 (ดรอปแล้ว) · schema == migrations สำหรับสองตารางนี้
 *
 * Gateway: mock adapter (PAYMENT_ADAPTER=mock) ไม่ออกเน็ต
 * Run: TEST_DATABASE_URL=<local postgres> npx jest --config jest.config.cjs \
 *        __tests__/integration/dtam-schema-drop-migration-real-postgres.test.js -i
 */

process.env.PAYMENT_ADAPTER = 'mock';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d, getTestDatabase } = require('../../test-support/test-database');

jest.setTimeout(300000);

const BACKEND = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(BACKEND, 'prisma', 'migrations');
const SCHEMA = path.join(BACKEND, 'prisma', 'schema');
const PRISMA_BIN = path.join(BACKEND, 'node_modules', '.bin', 'prisma');
const GUARD = path.join(BACKEND, 'scripts', 'ops', 'check-dtam-schema-drop-preflight.js');
const isDropMigration = (name) => /^\d{14}_drop_dtam_remittance_schema$/.test(name);

function urlFor(baseUrl, dbName) {
    const u = new URL(baseUrl);
    u.pathname = `/${dbName}`;
    return u.toString();
}

function run(cmd, args, url) {
    const r = spawnSync(cmd, args, {
        cwd: BACKEND,
        env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
        encoding: 'utf8',
        timeout: 240000,
    });
    return { status: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}` };
}

/** prisma/ ชั่วคราวที่มีทุก migration ยกเว้นใบดรอป — สภาพของฐานก่อน deploy PR3 */
function preDropPrismaDir(tmp) {
    const root = path.join(tmp, 'prisma');
    fs.cpSync(SCHEMA, path.join(root, 'schema'), { recursive: true });
    fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });
    for (const entry of fs.readdirSync(MIGRATIONS)) {
        if (isDropMigration(entry)) { continue; }
        fs.cpSync(path.join(MIGRATIONS, entry), path.join(root, 'migrations', entry), { recursive: true });
    }
    return path.join(root, 'schema');
}

async function columnsOf(client, table) {
    const rows = await client.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
        table,
    );
    return rows.map((r) => r.column_name);
}

async function tableExists(client, table) {
    const [row] = await client.$queryRawUnsafe('SELECT to_regclass($1) IS NOT NULL AS present', table);
    return row.present;
}

async function checkDef(client, name) {
    const [row] = await client.$queryRawUnsafe(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1 AND conrelid = 'checkout_orders'::regclass",
        name,
    );
    return row ? row.def : null;
}

/** order รูปเก่า (ก่อน 2026-09-11): 5,000 ส่วนกรมฯ + 500 + VAT 385 = 5,885 — SQL ตรง เพราะ client ใหม่ไม่รู้จักคอลัมน์นี้ */
async function insertOldShapeOrder(client, { id, applicationId, organizationId, status }) {
    await client.$executeRawUnsafe(
        `INSERT INTO checkout_orders (id, "updatedAt", "applicationId", milestone, dtam_fee_amount,
            platform_fee_net, platform_fee_vat, platform_fee_gross, total_payable_amount, status, "organizationId")
         VALUES ($1, now(), $2, 'M1', 5000, 500, 385, 885, 5885, $3, $4)`,
        id, applicationId, status, organizationId,
    );
}

async function insertBatch(client, { id, organizationId, status }) {
    await client.$executeRawUnsafe(
        `INSERT INTO dtam_remittance_batches (id, "updatedAt", "batchNumber", status, "totalAmount", "organizationId")
         VALUES ($1, now(), $2, $3, 5000, $4)`,
        id, `RB-${id}`, status, organizationId,
    );
}

d('PR3: ดรอป schema ของ DTAM remittance บน Postgres จริง', () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const names = {
        base: `pr3_base_${suffix}`, refuse: `pr3_refuse_${suffix}`, ok: `pr3_ok_${suffix}`, drift: `pr3_drift_${suffix}`,
    };
    const password = new URL(getTestDatabase().url).password;
    let admin;
    let tmp;
    const urls = {};
    const clients = {};
    const ids = {};
    let svc; // services bound to the ok database

    beforeAll(async () => {
        const testUrl = getTestDatabase().url;
        admin = new PrismaClient({ datasources: { db: { url: testUrl } } });
        for (const k of Object.keys(names)) { urls[k] = urlFor(testUrl, names[k]); }

        // base: ทุก migration ยกเว้นใบดรอป
        await admin.$executeRawUnsafe(`CREATE DATABASE "${names.base}"`);
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pr3-drop-'));
        const pre = run(PRISMA_BIN, ['migrate', 'deploy', '--schema', preDropPrismaDir(tmp)], urls.base);
        if (pre.status !== 0) { throw new Error(`pre-drop migrate deploy failed:\n${pre.out}`); }
        await admin.$executeRawUnsafe(`CREATE DATABASE "${names.refuse}" TEMPLATE "${names.base}"`);
        await admin.$executeRawUnsafe(`CREATE DATABASE "${names.ok}" TEMPLATE "${names.base}"`);
        await admin.$executeRawUnsafe(`CREATE DATABASE "${names.drift}" TEMPLATE "${names.base}"`);

        // services ผูกกับฐาน ok — ตั้ง DATABASE_URL ก่อน require ใด ๆ ของ services
        process.env.DATABASE_URL = urls.ok;
        svc = {
            prismaDb: require('../../services/prisma-database'),
            quotationService: require('../../services/quotation-service'),
            issueQuotationOnSubmit: require('../../services/quotation-issuance-on-submit').issueQuotationOnSubmit,
            checkout: require('../../services/checkout/stripe-checkout-service'),
            settleEvent: require('../../services/checkout/checkout-settlement-service').settleEvent,
            mockAdapter: require('../../services/payment/mock-payment-adapter'),
            consent: require('../../middleware/consent-manager'),
        };
        svc.mockAdapter.__reset();

        for (const k of ['refuse', 'ok', 'drift']) {
            const c = new PrismaClient({ datasources: { db: { url: urls[k] } } });
            clients[k] = c;
            const org = await c.organization.create({
                data: { name: `PR3 ${k}`, slug: `pr3-${k}-${suffix}`.replace(/_/g, '-'), code: `PR3${k}`.toUpperCase() },
            });
            const user = await c.user.create({
                data: { canonicalId: `pr3-${k}-canon-${suffix}`, password: 'x', organizationId: org.id, authType: 'EMAIL_LEGACY' },
            });
            const app = await c.application.create({
                data: {
                    applicationNumber: `PR3-${k}-${suffix}`, healthId: user.canonicalId, areaType: 'OUTDOOR',
                    organizationId: org.id, status: 'PENDING_DOC_FEE', formData: {},
                },
            });
            ids[k] = { orgId: org.id, user, app, oldOrderId: `pr3-old-${k}-${suffix}` };
        }

        // refuse: สภาพ demo วันนี้ — order เก่ายังเปิดอยู่ + batch ที่มีการนำส่งเงินจริง
        await insertOldShapeOrder(clients.refuse, {
            id: ids.refuse.oldOrderId, applicationId: ids.refuse.app.id, organizationId: ids.refuse.orgId, status: 'PENDING_PAYMENT',
        });
        await insertOldShapeOrder(clients.refuse, {
            id: `${ids.refuse.oldOrderId}-c`, applicationId: ids.refuse.app.id, organizationId: ids.refuse.orgId, status: 'CANCELLED',
        });
        await insertBatch(clients.refuse, { id: `pr3-batch-r-${suffix}`, organizationId: ids.refuse.orgId, status: 'REMITTED' });

        // ok: order เก่าถูกปลดเป็น CANCELLED แล้ว (กดจ่ายหนึ่งครั้งบนประตู PR2) + batch ร่าง
        await insertOldShapeOrder(clients.ok, {
            id: ids.ok.oldOrderId, applicationId: ids.ok.app.id, organizationId: ids.ok.orgId, status: 'CANCELLED',
        });
        await insertBatch(clients.ok, { id: `pr3-batch-o-${suffix}`, organizationId: ids.ok.orgId, status: 'OPEN' });

        // drift: CHECK ยอดรวมเดิมถูกถอดด้วยมือ แล้วมีแถว SETTLED ที่ total ≠ gross โดยส่วนกรมฯ = 0
        await clients.drift.$executeRawUnsafe(
            'ALTER TABLE checkout_orders DROP CONSTRAINT "checkout_orders_total_arithmetic_check"',
        );
        await clients.drift.$executeRawUnsafe(
            `INSERT INTO checkout_orders (id, "updatedAt", "applicationId", milestone, dtam_fee_amount,
                platform_fee_net, platform_fee_vat, platform_fee_gross, total_payable_amount, status, "organizationId")
             VALUES ($1, now(), $2, 'M1', 0, 500, 385, 885, 5885, 'SETTLED', $3)`,
            ids.drift.oldOrderId, ids.drift.app.id, ids.drift.orgId,
        );
    });

    afterAll(async () => {
        for (const c of Object.values(clients)) { await c.$disconnect().catch(() => {}); }
        if (svc) { await svc.prismaDb.prisma.$disconnect().catch(() => {}); }
        if (admin) {
            for (const n of Object.values(names)) {
                await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`).catch(() => {});
            }
            await admin.$disconnect();
        }
        if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); }
    });

    describe('1. ฐานที่ยังมี order ค้างส่วนของกรมฯ', () => {
        test('ตัวตรวจก่อน deploy: exit 1 พร้อมตัวเลขต่อสถานะ และไม่พิมพ์รหัสผ่านฐาน', () => {
            const r = run(process.execPath, [GUARD], urls.refuse);
            expect(r.status).toBe(1);
            const report = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1));
            expect(report.verdict).toBe('BLOCKED');
            expect(report.blockingOrdersByStatus).toEqual({ PENDING_PAYMENT: 1 });
            expect(report.blockingOrders.map((o) => o.id)).toEqual([ids.refuse.oldOrderId]);
            expect(report.blockingOrders[0].applicationNumber).toBe(ids.refuse.app.applicationNumber);
            expect(report.cancelledOrdersWithDtamPortion).toBe(1);
            expect(report.blockingBatchesByStatus).toEqual({ REMITTED: 1 });
            expect(r.out).not.toContain(password);
        });

        test('migrate deploy ล้มเสียงดังพร้อมจำนวน และไม่ดรอปอะไรเลย', async () => {
            const r = run(PRISMA_BIN, ['migrate', 'deploy', '--schema', SCHEMA], urls.refuse);
            expect(r.status).not.toBe(0);
            expect(r.out).toContain('DTAM_SCHEMA_DROP_REFUSED');
            expect(r.out).toMatch(/1 checkout_orders row\(s\) carry dtam_fee_amount > 0 and are not CANCELLED \(PENDING_PAYMENT=1\)/);
            expect(r.out).toMatch(/1 dtam_remittance_batches row\(s\) are not OPEN \(REMITTED=1\)/);
            const cols = await columnsOf(clients.refuse, 'checkout_orders');
            expect(cols).toEqual(expect.arrayContaining(['dtam_fee_amount', 'dtam_remittance_status', 'remittanceBatchId']));
            expect(await tableExists(clients.refuse, 'dtam_remittance_batches')).toBe(true);
            const [order] = await clients.refuse.$queryRawUnsafe(
                'SELECT status, dtam_fee_amount::text AS dtam, total_payable_amount::text AS total FROM checkout_orders WHERE id = $1',
                ids.refuse.oldOrderId,
            );
            expect(order).toEqual({ status: 'PENDING_PAYMENT', dtam: '5000.00', total: '5885.00' });
            // Prisma records the attempt as failed: the next deploy refuses (P3009)
            // until someone marks it rolled back — the runbook's recovery step.
            const [attempt] = await clients.refuse.$queryRawUnsafe(
                "SELECT finished_at IS NULL AS unfinished, rolled_back_at IS NULL AS not_rolled_back FROM _prisma_migrations WHERE migration_name LIKE '%_drop_dtam_remittance_schema'",
            );
            expect(attempt).toEqual({ unfinished: true, not_rolled_back: true });
        });

        test('หลังถูกปฏิเสธ: migrate resolve --rolled-back แล้วแก้แถวที่ขวาง → deploy ซ้ำผ่าน', async () => {
            const again = run(PRISMA_BIN, ['migrate', 'deploy', '--schema', SCHEMA], urls.refuse);
            expect(again.status).not.toBe(0);
            expect(again.out).toContain('P3009');

            const [dir] = fs.readdirSync(MIGRATIONS).filter(isDropMigration);
            const resolved = run(PRISMA_BIN, ['migrate', 'resolve', '--rolled-back', dir, '--schema', SCHEMA], urls.refuse);
            expect({ status: resolved.status, out: resolved.status === 0 ? '' : resolved.out }).toEqual({ status: 0, out: '' });
            // Stand-ins for the operator's steps on a scratch copy: the open order is
            // retired (on demo: one press of its pay button) and the batch is no
            // longer a remitted record (on a real database: an operator decision).
            await clients.refuse.$executeRawUnsafe("UPDATE checkout_orders SET status = 'CANCELLED' WHERE id = $1", ids.refuse.oldOrderId);
            await clients.refuse.$executeRawUnsafe("UPDATE dtam_remittance_batches SET status = 'OPEN'");
            expect(run(process.execPath, [GUARD], urls.refuse).status).toBe(0);

            const r = run(PRISMA_BIN, ['migrate', 'deploy', '--schema', SCHEMA], urls.refuse);
            expect({ status: r.status, out: r.status === 0 ? '' : r.out }).toEqual({ status: 0, out: '' });
            expect(await tableExists(clients.refuse, 'dtam_remittance_batches')).toBe(false);
        });
    });

    describe('3. ฐานที่ drift: แถว SETTLED ที่ total ≠ gross ส่วนกรมฯ = 0 (CHECK เดิมถูกถอด)', () => {
        test('ตัวตรวจก่อน deploy: exit 1 พร้อมเหตุผลที่มีชื่อ ไม่ใช่ SAFE_TO_DROP', () => {
            const r = run(process.execPath, [GUARD], urls.drift);
            const report = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1));
            expect({ status: r.status, verdict: report.verdict }).toEqual({ status: 1, verdict: 'BLOCKED' });
            expect(report.blockingOrdersByStatus).toEqual({});
            expect(report.ordersBreakingNewTotalCheckByStatus).toEqual({ SETTLED: 1 });
            expect(report.ordersBreakingNewTotalCheck.map((o) => o.id)).toEqual([ids.drift.oldOrderId]);
        });

        test('migrate deploy ถูกปฏิเสธด้วยข้อความที่มีชื่อพร้อมจำนวน (ไม่ใช่ constraint error ดิบ) และไม่มีอะไรถูกดรอป', async () => {
            const r = run(PRISMA_BIN, ['migrate', 'deploy', '--schema', SCHEMA], urls.drift);
            expect(r.status).not.toBe(0);
            expect(r.out).toContain('DTAM_SCHEMA_DROP_REFUSED');
            expect(r.out).toMatch(/1 checkout_orders row\(s\) would break the new total CHECK \([^)]*\) \(SETTLED=1\)/);
            expect(r.out).not.toMatch(/violated by some row/);
            expect(await tableExists(clients.drift, 'dtam_remittance_batches')).toBe(true);
            expect(await columnsOf(clients.drift, 'checkout_orders')).toEqual(expect.arrayContaining(['dtam_fee_amount']));
        });
    });

    describe('2. ฐานที่ order เก่าถูกปลดแล้ว', () => {
        test('ตัวตรวจก่อน deploy: exit 0', () => {
            const r = run(process.execPath, [GUARD], urls.ok);
            expect(r.status).toBe(0);
            const report = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1));
            expect(report.verdict).toBe('SAFE_TO_DROP');
            expect(report.blockingOrdersByStatus).toEqual({});
            expect(report.cancelledOrdersWithDtamPortion).toBe(1);
            expect(report.batchesByStatus).toEqual({ OPEN: 1 });
        });

        test('migrate deploy ผ่าน: ตารางและคอลัมน์หาย, CHECK ใหม่อยู่, แถวเก่ายังอยู่และยอดไม่ถูกแตะ', async () => {
            const r = run(PRISMA_BIN, ['migrate', 'deploy', '--schema', SCHEMA], urls.ok);
            expect({ status: r.status, out: r.status === 0 ? '' : r.out }).toEqual({ status: 0, out: '' });

            const c = clients.ok;
            expect(await tableExists(c, 'dtam_remittance_batches')).toBe(false);
            const cols = await columnsOf(c, 'checkout_orders');
            for (const gone of ['dtam_fee_amount', 'dtam_remittance_status', 'remittanceBatchId']) {
                expect({ gone, present: cols.includes(gone) }).toEqual({ gone, present: false });
            }
            expect(await checkDef(c, 'checkout_orders_total_arithmetic_check'))
                .toBe("CHECK (((total_payable_amount = platform_fee_gross) OR (status = 'CANCELLED'::text)))");
            expect(await checkDef(c, 'checkout_orders_amounts_nonnegative_check'))
                .toBe('CHECK (((platform_fee_net >= (0)::numeric) AND (platform_fee_vat >= (0)::numeric)))');
            expect(await checkDef(c, 'checkout_orders_dtam_remittance_status_check')).toBeNull();

            const [old] = await c.$queryRawUnsafe(
                'SELECT status, platform_fee_gross::text AS gross, total_payable_amount::text AS total FROM checkout_orders WHERE id = $1',
                ids.ok.oldOrderId,
            );
            expect(old).toEqual({ status: 'CANCELLED', gross: '885.00', total: '5885.00' });
        });

        test('CHECK ใหม่: order ที่ยอดรวม ≠ ค่าบริการรวมเขียนไม่ได้ และแถวเก่าถูก settle ไม่ได้', async () => {
            const c = clients.ok;
            await expect(c.$executeRawUnsafe(
                `INSERT INTO checkout_orders (id, "updatedAt", "applicationId", milestone, platform_fee_net, platform_fee_vat,
                    platform_fee_gross, total_payable_amount, status, "organizationId")
                 VALUES ($1, now(), $2, 'M2', 500, 385, 885, 5885, 'PENDING_PAYMENT', $3)`,
                `pr3-bad-${suffix}`, ids.ok.app.id, ids.ok.orgId,
            )).rejects.toThrow(/checkout_orders_total_arithmetic_check/);
            await expect(c.$executeRawUnsafe(
                "UPDATE checkout_orders SET status = 'SETTLED', \"settledAt\" = now() WHERE id = $1",
                ids.ok.oldOrderId,
            )).rejects.toThrow(/checkout_orders_total_arithmetic_check/);
            await expect(c.$executeRawUnsafe(
                `INSERT INTO checkout_orders (id, "updatedAt", "applicationId", milestone, platform_fee_net, platform_fee_vat,
                    platform_fee_gross, total_payable_amount, status, "organizationId")
                 VALUES ($1, now(), $2, 'M2', -1, 1, 0, 0, 'PENDING_PAYMENT', $3)`,
                `pr3-neg-${suffix}`, ids.ok.app.id, ids.ok.orgId,
            )).rejects.toThrow(/checkout_orders_amounts_nonnegative_check/);
        });

        test('mint + settle ใหม่ทั้งเส้นบนคำขอเดียวกับ order เก่า: ลง 1110-001 / 4110-001 / 2131-001 เท่านั้น', async () => {
            const { app, user } = ids.ok;
            const c = clients.ok;
            const { ConsentCategory, ConsentVersions } = svc.consent;
            await c.userConsent.create({
                data: {
                    userId: user.id, organizationId: ids.ok.orgId, category: ConsentCategory.PAYMENT_TERMS,
                    version: ConsentVersions.PAYMENT_TERMS, granted: true, grantedAt: new Date(),
                },
            });
            expect(await svc.issueQuotationOnSubmit({ application: app, actorId: null })).toEqual({ issued: true });
            const [qt] = await c.quotation.findMany({ where: { applicationId: app.id, isDeleted: false } });
            await svc.quotationService.markQuotationAccepted(qt.id, {
                acceptedBy: null, snapshot: svc.quotationService.buildAcceptanceSnapshot(qt),
            });

            const minted = await svc.checkout.createCheckoutForApplication({
                applicationId: app.id, milestone: 'M1',
                // R1 (spec 2026-09-30 §3.1, Task 4): checkout reads within the payer's holder
                // scope, as the route passes it (holderScope(req)); the filer pin decides in R1.
                actor: {
                    id: user.id, healthId: user.canonicalId, role: 'health',
                    holderScope: { userId: user.id, readIds: [app.entityId].filter(Boolean), editIds: [app.entityId].filter(Boolean) },
                },
            });
            expect(minted.checkoutOrderId).not.toBe(ids.ok.oldOrderId);
            const order = await c.checkoutOrder.findUnique({ where: { id: minted.checkoutOrderId } });
            expect({
                status: order.status, net: Number(order.platformFeeNet), vat: Number(order.platformFeeVat),
                gross: Number(order.platformFeeGross), total: Number(order.totalPayableAmount),
            }).toEqual({ status: 'PENDING_PAYMENT', net: 5500, vat: 385, gross: 5885, total: 5885 });
            expect(order).not.toHaveProperty('dtamPayableAmount');

            const eventId = `evt_pr3_${suffix}`;
            await c.stripeWebhookEvent.create({
                data: {
                    id: eventId, type: 'payment_intent.succeeded', status: 'RECEIVED', attempts: 0,
                    payload: { data: { object: {
                        id: order.stripePaymentIntentId, amount: 588500, amount_received: 588500,
                        metadata: { checkoutOrderId: order.id, milestone: 'M1' },
                    } } },
                },
            });
            const outcome = await svc.settleEvent(eventId);
            expect(outcome.status).toBe('PROCESSED');

            expect((await c.checkoutOrder.findUnique({ where: { id: order.id } })).status).toBe('SETTLED');
            const entries = await c.journalEntry.findMany({ where: { sourceId: order.id }, include: { lines: true } });
            expect(entries).toHaveLength(1);
            const lines = entries[0].lines
                .map((l) => ({ account: l.accountCode, debit: Number(l.debit), credit: Number(l.credit) }))
                .sort((a, b) => a.account.localeCompare(b.account));
            expect(lines).toEqual([
                { account: '1110-001', debit: 5885, credit: 0 },
                { account: '2131-001', debit: 0, credit: 385 },
                { account: '4110-001', debit: 0, credit: 5500 },
            ]);
        });

        test('หลังดรอป: ตัวตรวจตอบ exit 0 (ดรอปแล้ว) และ schema == migrations สำหรับสองตารางนี้', () => {
            const r = run(process.execPath, [GUARD], urls.ok);
            expect(r.status).toBe(0);
            const report = JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1));
            expect(report.verdict).toBe('ALREADY_DROPPED');

            const diff = run(PRISMA_BIN, ['migrate', 'diff', '--from-url', urls.ok, '--to-schema-datamodel', SCHEMA, '--script'], urls.ok);
            expect(diff.status).toBe(0);
            const touching = diff.out.split('\n').filter((l) => /checkout_orders|dtam_remittance|remittanceBatch|dtam_fee/.test(l));
            expect(touching).toEqual([]);
        });
    });
});
