'use strict';
/**
 * PR3 ของการถอด DTAM remittance (operator 2026-09-11 "ถอดออกทั้งระบบ" · 2026-09-29
 * บริษัทชำระกับกรมฯ นอกระบบ แพลตฟอร์มไม่เก็บส่วนของกรมฯ) — contract migration.
 *
 * ตรึงสิ่งที่ต้องหายไปจาก schema และโค้ดหลังดรอป:
 *   - model DtamRemittanceBatch, Organization.dtamRemittanceBatches
 *   - CheckoutOrder.dtamPayableAmount (dtam_fee_amount), dtamRemittanceStatus,
 *     remittanceBatchId และ index ของมัน
 *   - 'DtamRemittanceBatch' ใน TENANT_SCOPED_MODELS
 *   - ตัวกัน "order ที่มีส่วนของกรมฯ" ทั้งที่ประตู checkout และที่ settlement
 *     (หลังดรอป order มีส่วนนั้นไม่ได้อีก — ฐานข้อมูลเป็นคนปฏิเสธผ่าน CHECK)
 *   - การ truncate ตารางใน scripts/reset-uat-data.js
 * และตรึงรูปของ migration ใหม่: หัว DESTRUCTIVE, rollback ในคอมเมนต์, ตัวปฏิเสธ
 * ก่อนดรอป และ CHECK ยอดรวมแบบใหม่ พฤติกรรมจริงพิสูจน์บน Postgres จริงใน
 * __tests__/integration/dtam-schema-drop-migration-real-postgres.test.js
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');

function modelBlock(schema, name) {
    const start = schema.indexOf(`model ${name} {`);
    if (start < 0) { return null; }
    const end = schema.indexOf('\n}', start);
    return schema.slice(start, end + 2);
}

function dropMigrationDir() {
    const dir = path.join(BACKEND, 'prisma', 'migrations');
    return fs.readdirSync(dir).filter((n) => /^\d{14}_drop_dtam_remittance_schema$/.test(n));
}

describe('schema: ไม่มีชั้นนำส่งกรมฯ เหลือ', () => {
    const billing = read('prisma/schema/billing.prisma');
    const tenancy = read('prisma/schema/tenancy.prisma');

    test('ไม่มี model DtamRemittanceBatch และไม่มีตาราง dtam_remittance_batches', () => {
        expect(billing).not.toMatch(/model DtamRemittanceBatch\b/);
        expect(billing).not.toContain('dtam_remittance_batches');
    });

    test('CheckoutOrder ไม่มีคอลัมน์ส่วนของกรมฯ / สถานะนำส่ง / batch', () => {
        const block = modelBlock(billing, 'CheckoutOrder');
        expect(block).not.toBeNull();
        for (const gone of ['dtamPayableAmount', 'dtam_fee_amount', 'dtamRemittanceStatus',
            'dtam_remittance_status', 'remittanceBatchId', 'remittanceBatch', 'DtamRemittanceBatch']) {
            expect({ gone, present: block.includes(gone) }).toEqual({ gone, present: false });
        }
        // คอลัมน์ค่าบริการยังอยู่ครบ — PR3 ไม่เปลี่ยนชื่อ (การเปลี่ยนชื่อเป็นการตัดสินใจแยก)
        for (const kept of ['platform_fee_net', 'platform_fee_vat', 'platform_fee_gross', 'total_payable_amount']) {
            expect(block).toContain(`@map("${kept}")`);
        }
    });

    test('Organization ไม่มี relation dtamRemittanceBatches', () => {
        expect(tenancy).not.toMatch(/dtamRemittanceBatches/);
    });

    test('TENANT_SCOPED_MODELS ไม่มี DtamRemittanceBatch', () => {
        const { TENANT_SCOPED_MODELS } = require('../../services/tenant-prisma-extension');
        const list = [...TENANT_SCOPED_MODELS];
        expect(list).not.toContain('DtamRemittanceBatch');
        expect(list).toContain('CheckoutOrder');
    });
});

describe('โค้ด: ไม่อ่าน/เขียนคอลัมน์ที่ดรอปแล้ว', () => {
    test('stripe-checkout-service ไม่เขียน dtamPayableAmount และไม่มีตัวปลด order ที่มีส่วนของกรมฯ', () => {
        const src = read('services/checkout/stripe-checkout-service.js');
        expect(src).not.toMatch(/dtamPayableAmount|dtam_fee_amount|retireOrderCarryingDtamPortion|CHECKOUT_ORDER_HAS_DTAM_PORTION/);
    });

    test('checkout-settlement-service ไม่อ่านส่วนของกรมฯ และไม่มีการปฏิเสธ CHECKOUT_ORDER_HAS_DTAM_PORTION', () => {
        const src = read('services/checkout/checkout-settlement-service.js');
        expect(src).not.toMatch(/dtamPayableAmount|dtamRemittanceStatus|CHECKOUT_ORDER_HAS_DTAM_PORTION/);
    });

    test('ไม่มีรหัส CHECKOUT_ORDER_HAS_DTAM_PORTION และไม่มีเหตุผล DTAM_PORTION_RETIRED', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        expect(ERROR_CODES.CHECKOUT_PRICE_DRIFT).toBeDefined();
        expect(ERROR_CODES.CHECKOUT_ORDER_HAS_DTAM_PORTION).toBeUndefined();
        const { RETIRE_REASONS } = require('../../services/checkout/retire-checkout-order');
        expect(Object.values(RETIRE_REASONS)).not.toContain('DTAM_PORTION_RETIRED');
        expect(RETIRE_REASONS.INTENT_CANCELED).toBe('PAYMENT_INTENT_CANCELED');
    });

    test('ไม่มีไฟล์ใน services/routes/jobs/shared/scripts ที่ยังอ้างคอลัมน์หรือตารางที่ดรอป', () => {
        const hits = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { if (e.name !== 'node_modules') { walk(p); } continue; }
                if (!/\.(js|ts|sql|sh)$/.test(e.name)) { continue; }
                const src = fs.readFileSync(p, 'utf8');
                if (/dtamPayableAmount|dtamRemittanceStatus|remittanceBatchId|dtamRemittanceBatch|DtamRemittanceBatch/.test(src)) {
                    hits.push(path.relative(BACKEND, p));
                }
            }
        };
        for (const d of ['services', 'routes', 'jobs', 'shared', 'scripts', 'middleware', 'controllers']) {
            const abs = path.join(BACKEND, d);
            if (fs.existsSync(abs)) { walk(abs); }
        }
        // ตัวตรวจก่อน deploy อ่านคอลัมน์เดิมด้วย SQL ตรง ๆ โดยตั้งใจ (ต้องนับก่อนดรอป)
        expect(hits.filter((h) => h !== 'scripts/ops/check-dtam-schema-drop-preflight.js')).toEqual([]);
    });
});

describe('migration ใหม่: DESTRUCTIVE, ปฏิเสธก่อนดรอป, CHECK ยอดรวม = ค่าบริการรวม', () => {
    test('มี migration ดรอปอยู่ใบเดียว และอยู่หลัง migration ที่สร้างตาราง', () => {
        const dirs = dropMigrationDir();
        expect(dirs).toHaveLength(1);
        expect(dirs[0] > '20260802150000_wave1_checkout_engine_expand').toBe(true);
    });

    test('หัวไฟล์ติดป้าย DESTRUCTIVE และมี rollback SQL ในคอมเมนต์', () => {
        const [dir] = dropMigrationDir();
        const sql = read(`prisma/migrations/${dir}/migration.sql`);
        expect(sql.split('\n').slice(0, 5).join('\n')).toMatch(/DESTRUCTIVE/);
        expect(sql).toMatch(/--\s*Rollback/i);
        expect(sql).toMatch(/--\s*CREATE TABLE "dtam_remittance_batches"/);
    });

    test('ปฏิเสธ (RAISE EXCEPTION) ก่อนดรอปเมื่อมี order ที่มีส่วนของกรมฯ และยังไม่ CANCELLED', () => {
        const [dir] = dropMigrationDir();
        const sql = read(`prisma/migrations/${dir}/migration.sql`);
        const raiseAt = sql.search(/RAISE EXCEPTION\s+'DTAM_SCHEMA_DROP_REFUSED/);
        const dropAt = sql.search(/DROP COLUMN "dtam_fee_amount"/);
        expect(raiseAt).toBeGreaterThan(-1);
        expect(dropAt).toBeGreaterThan(raiseAt);
        expect(sql).toMatch(/"dtam_fee_amount"\s*>\s*0/);
    });

    test('CHECK ยอดรวมใหม่: total = platform gross (ยกเว้นแถว CANCELLED) และคง CHECK ค่าไม่ติดลบของค่าบริการ', () => {
        const [dir] = dropMigrationDir();
        const sql = read(`prisma/migrations/${dir}/migration.sql`);
        expect(sql).toMatch(/ADD CONSTRAINT "checkout_orders_total_arithmetic_check" CHECK \(\s*"total_payable_amount" = "platform_fee_gross"\s+OR "status" = 'CANCELLED'\s*\)/);
        expect(sql).toMatch(/ADD CONSTRAINT "checkout_orders_amounts_nonnegative_check" CHECK \(\s*"platform_fee_net" >= 0 AND "platform_fee_vat" >= 0\s*\)/);
        expect(sql).toMatch(/DROP TABLE "dtam_remittance_batches"/);
    });

    test('ตัวตรวจก่อน deploy (อ่านอย่างเดียว) อยู่ที่ scripts/ops', () => {
        const src = read('scripts/ops/check-dtam-schema-drop-preflight.js');
        expect(src).toMatch(/READ ONLY/);
        expect(src).not.toMatch(/\b(UPDATE|DELETE FROM|INSERT INTO|DROP|ALTER|TRUNCATE)\b[^'\n]*checkout_orders/);
    });
});

describe('fixtures: reset-uat-data ไม่ truncate ตารางที่ไม่มีแล้ว', () => {
    test('ไม่มี dtamRemittanceBatch ในรายการล้าง', () => {
        expect(read('scripts/reset-uat-data.js')).not.toMatch(/dtamRemittanceBatch/);
    });
});
