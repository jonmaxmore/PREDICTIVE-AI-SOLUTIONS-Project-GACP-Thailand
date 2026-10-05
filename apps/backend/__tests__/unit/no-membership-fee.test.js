/**
 * M3 — "ไม่มีค่าสมาชิก" (มติ operator 2026-08-23) และการเก็บกวาดทั้งพื้นผิว (2026-09-11)
 *
 * แพลตฟอร์มเก็บค่าธรรมเนียมรัฐ + ค่าบริการแพลตฟอร์ม 10% + VAT 7% ต่อรูปแบบการปลูก
 * และไม่เก็บอย่างอื่น · แผน Premium 990 / 9,900 บาท ไม่เคยถูกตัดสินให้มี และไม่เคยเรียกเก็บ
 * จากแถวจริงสักแถว (นับจากฐานจริงแบบอ่านอย่างเดียว 2026-08-23: subscriptions=0)
 *
 * รอบแรกเฟนซ์นี้ล็อก *ความสามารถ* ในการเรียกเก็บออกไป โดยให้ตัวอ่าน/ยกเลิก/หมดอายุอยู่ต่อ
 * เผื่อประวัติ · รอบนี้ operator สั่งเก็บกวาดทั้งชุด ("เราก็ไม่มีบริการ subscription ด้วย
 * ต้องเก็บกวาด และล้างคราบด้วย") เฟนซ์จึงเข้มขึ้นเป็น: ไม่มีไฟล์เหล่านั้นเหลืออยู่เลย
 *
 * ทำไมยังต้องมีเทสทั้งที่ลบของหมดแล้ว — สิ่งที่ผูกไว้คือ *มติ* ไม่ใช่ไฟล์ ใครที่เพิ่มแพ็กเกจ
 * สมาชิกกลับเข้ามาโดยไม่มีมติใหม่ จะทำให้ใบนั้นแดงก่อนถึงชั้น review
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../..');
const WEB = path.resolve(BACKEND, '../web-app/src');

const GONE_BACKEND = [
    'services/subscription/entitlements-service.js',
    'services/subscription/subscription-order-service.js',
    'routes/api/system/subscription.js',
    'routes/api/system/subscription-orders.js',
];

const GONE_WEB = [
    'lib/services/subscription-service.ts',
    'hooks/use-entitlements.ts',
    'lib/capabilities.ts',
    'app/provider/accounting/subscription-cancel-modal.tsx',
    'app/health/subscription/page.tsx',
    'app/health/subscription/client-view.tsx',
];

const read = (rel, root = BACKEND) => fs.readFileSync(path.resolve(root, rel), 'utf8');

/**
 * เฟนซ์นี้ล่า *ความสามารถ* ไม่ใช่ถ้อยคำ — คอมเมนต์เรียกเก็บเงินใครไม่ได้ และคอมเมนต์ที่
 * อธิบายว่าอะไรถูกถอดออกไปแล้วคือสิ่งที่อยากให้มี ไม่ใช่สิ่งที่อยากให้แดง
 * (บรรทัดที่เคยทำให้แดงตอนเขียนใบนี้: ตัวอย่างเลข 990 ใน split-payment-calculator
 * และคอมเมนต์ใน lots.js ที่เล่าว่าเคยมี requireFeature อยู่)
 */
function codeOnly(text) {
    return text
        .split('\n')
        .filter((line) => {
            const t = line.trim();
            return t !== '' && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('M3 — ไม่มีค่าสมาชิก และไม่มีพื้นผิวแพ็กเกจสมาชิกเหลืออยู่', () => {
    test.each(GONE_BACKEND)('หลังบ้าน %s ไม่มีอยู่แล้ว', (rel) => {
        expect(fs.existsSync(path.resolve(BACKEND, rel))).toBe(false);
    });

    test.each(GONE_WEB)('หน้าบ้าน %s ไม่มีอยู่แล้ว', (rel) => {
        expect(fs.existsSync(path.resolve(WEB, rel))).toBe(false);
    });

    test('ไม่มี router ไหน mount /subscription', () => {
        expect(read('routes/api/index.js')).not.toMatch(/router\.use\(\s*['"]\/subscription/);
    });

    /**
     * ราคาที่ยังนั่งอยู่ในโค้ด คือความสามารถที่รอคนมาต่อสาย — จึงผูกตัวเลขเอง ไม่ใช่ผูกชื่อไฟล์
     * นับเฉพาะบรรทัดที่ตัวเลขอยู่ร่วมกับคำว่า premium/tier/plan/subscription/สมาชิก
     * ตัวเลขเปล่า ๆ เป็นอะไรก็ได้ (timeout, จำนวนแถว) จึงไม่นับ
     */
    test('ไม่มีตัวเลขราคาแผนสมาชิกหลงเหลือในโค้ดฝั่งหลังบ้าน', () => {
        const suspects = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) { continue; }
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!entry.name.endsWith('.js')) { continue; }
                for (const line of codeOnly(fs.readFileSync(full, 'utf8')).split('\n')) {
                    if (!/\b990\b|\b9900\b/.test(line)) { continue; }
                    if (!/premium|tier|plan|subscription|สมาชิก/i.test(line)) { continue; }
                    suspects.push(`${path.relative(BACKEND, full)}: ${line.trim()}`);
                }
            }
        };
        for (const dir of ['services', 'routes', 'shared', 'constants', 'config']) {
            const full = path.resolve(BACKEND, dir);
            if (fs.existsSync(full)) { walk(full); }
        }
        expect(suspects).toEqual([]);
    });

    test('ไม่มี cron ต่ออายุแพ็กเกจ (ซึ่งคือการเรียกเก็บซ้ำ)', () => {
        const src = read('jobs/scheduler.js');
        expect(src).not.toMatch(/createRenewalInvoicesForDueSubscriptions/);
        expect(src).not.toMatch(/Subscription Auto-Renewal/);
    });
});

/**
 * ประตูสร้างล็อตเคยถูกกั้นไว้ที่แพ็กเกจ PREMIUM ผ่าน requireFeature('LOT_CREATION')
 * บน staging/preview ธง BILLING_FREE_TIER_FOR_ALL=true ทำให้ทุกคนเป็น PREMIUM จึงไม่มีใคร
 * เห็นปัญหา แต่ค่าเริ่มต้นของ production คือ false ⇒ เกษตรกรทุกคนจะได้ 403 ตอนบรรจุล็อต
 * ติดแพ็กเกจที่แพลตฟอร์มไม่ได้ขาย และครึ่งหลังของสายตรวจสอบย้อนกลับใช้ไม่ได้เลย
 *
 * operator สั่งเปิด ("ตอนนี้เราเปิดสร้างล็อตแบบ open") — แต่การเปิดประตูขายแพ็กเกจ ต้องไม่พา
 * ด่านความปลอดภัยออกไปด้วย สองอย่างนี้อยู่บรรทัดติดกันในไฟล์เดียวกัน จึงเป็นจุดที่พลาด
 * พร้อมกันได้ง่ายที่สุด
 */
describe('ประตูสร้างล็อตเปิด แต่ยังตรวจความเป็นเจ้าของ', () => {
    const lots = codeOnly(read('routes/api/trace/lots.js'));

    test('ไม่มีประตูแพ็กเกจกั้นการสร้างล็อตอีก', () => {
        expect(lots).not.toContain('requireFeature');
        expect(lots).not.toContain('LOT_CREATION');
    });

    test('ยังตรวจว่ารุ่นที่จะบรรจุเป็นของผู้เรียก', () => {
        expect(lots).toContain('verifyBatchOwnership');
        expect(lots).toContain('authenticateHealth');
    });
});
