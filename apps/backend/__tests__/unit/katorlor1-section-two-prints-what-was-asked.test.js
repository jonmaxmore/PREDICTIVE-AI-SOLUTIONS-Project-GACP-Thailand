/**
 * ส่วนที่ ๒ ของ กทล.1 ต้องพิมพ์ทุกช่องที่แบบขอ และผู้ยื่นกรอกไว้แล้ว
 *
 * ที่มา: operator เปิดหน้าตรวจทานแล้วบอกว่า "มีหัวข้อ แต่ข้อมูลไม่ครบ" (2026-09-10)
 * เทียบกับแบบทางการที่ทีมอ่านเต็มฉบับไว้แล้ว
 * (reports/research/2026-09-01-dtam-application-baseline/facts.md:24-27) พบว่าสี่อย่าง
 * ที่ step 3 และ step 4 ของวิซาร์ดเก็บมาตั้งแต่ต้น ไม่เคยถูกพิมพ์ลงแบบเลย:
 *   โทรศัพท์ ณ สถานที่ · เล่มที่/หน้าที่/ออกให้โดย ของเอกสารสิทธิ์ ·
 *   ปริมาณการปลูก (ต้น/รอบ · รอบ/ปี) · และ **ข้อ ๓ พันธุ์และส่วนที่ใช้ ทั้งข้อ**
 *
 * ข้อ ๓ คือกรณีที่หนักที่สุด เพราะหัวข้อ ส่วนที่ ๒ เขียนไว้เองว่า "...และพันธุ์พืช"
 * ใครอ่านแบบที่พิมพ์ออกมาจึงเห็นหัวข้อสัญญาไว้ แล้วไม่เห็นคำตอบ — และไม่มีทางรู้ว่า
 * ผู้ยื่นไม่ได้กรอก หรือระบบไม่ได้พิมพ์
 *
 * เทสนี้จึงยืนบนสิ่งที่ *ผู้ยื่นพิมพ์ลงไป* ไม่ใช่บนชื่อฟังก์ชัน: กรอกค่าที่แยกแยะได้
 * ทุกช่อง แล้วยืนยันว่าค่าทุกตัวโผล่บนกระดาษ
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { renderKatorlor1Html } = require('../../services/pdf/katorlor1-template-service');

const WIZARD_STEP4 = path.resolve(
    __dirname,
    '../../../web-app/src/app/health/applications/new/_steps/steps/step4-variety-purpose-config.ts',
);

function filing(overrides = {}) {
    return {
        id: 'app-1',
        applicationNumber: 'GACP-TEST-01',
        formData: {
            applicantType: 'INDIVIDUAL',
            requestType: 'NEW',
            certScope: 'PLANTING',
            applicantData: { prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี' },
            certificationPurposes: ['EXPORT'],
            farmData: {
                siteName: 'สวนสมชาย',
                siteAddress: '99 หมู่ 4',
                sitePhone: '053-111-222',
                landOwnership: 'OWNED',
                areaTypes: ['OUTDOOR'],
                areaSqm: '2400',
                landDocumentDetail: {
                    type: 'โฉนด', number: '12345', volume: '7', page: '88',
                    issuedBy: 'สำนักงานที่ดินเชียงใหม่',
                },
                coordinates: '18.9, 98.9',
                plantsPerCycle: '500',
                cyclesPerYear: '3',
            },
            varieties: [
                { kind: 'SEED', name: 'หางกระรอก', origin: 'DOMESTIC', source: 'ศูนย์วิจัยพืช', quantity: '200', unit: 'เมล็ด' },
                { kind: 'OTHER_PART', name: 'Charlotte', origin: 'IMPORTED', originCountry: 'เนเธอร์แลนด์', source: 'บริษัท ก', quantity: '50', unit: 'ต้นกล้า' },
            ],
            ...overrides,
        },
    };
}

/** ส่วนที่ ๒ เท่านั้น — กันไม่ให้ค่าที่บังเอิญโผล่ในส่วนอื่นมานับเป็นผ่าน */
function sectionTwoOf(html) {
    const after = html.split('ส่วนที่ ๒')[1];
    expect(after).toBeDefined();
    return after.split('ส่วนที่ ๓')[0];
}

describe('กทล.1 ส่วนที่ ๒ — ทุกช่องที่แบบขอ', () => {
    test('ช่องที่ step 3 เก็บไว้ ถูกพิมพ์ลงแบบครบ', () => {
        const s2 = sectionTwoOf(renderKatorlor1Html(filing(), null));

        expect(s2).toContain('053-111-222');          // โทรศัพท์ ณ สถานที่
        expect(s2).toContain('12345');                // เลขที่เอกสารสิทธิ์
        expect(s2).toContain('7');                    // เล่มที่
        expect(s2).toContain('88');                   // หน้าที่
        expect(s2).toContain('สำนักงานที่ดินเชียงใหม่'); // ออกให้โดย
        expect(s2).toContain('500');                  // ต้นต่อรอบ
        expect(s2).toContain('3 รอบต่อปี');            // รอบต่อปี
    });

    test('ข้อ ๓ พันธุ์และส่วนที่ใช้ พิมพ์ครบทุกช่องของแต่ละแถว', () => {
        const s2 = sectionTwoOf(renderKatorlor1Html(filing(), null));

        expect(s2).toContain('เมล็ดพันธุ์');
        expect(s2).toContain('หางกระรอก');
        expect(s2).toContain('ในประเทศ');
        expect(s2).toContain('ศูนย์วิจัยพืช');
        expect(s2).toContain('200 เมล็ด');

        expect(s2).toContain('ส่วนขยายพันธุ์อื่น');
        expect(s2).toContain('Charlotte');
        expect(s2).toContain('นำเข้า');
        expect(s2).toContain('เนเธอร์แลนด์');
        expect(s2).toContain('50 ต้นกล้า');
    });

    test('ประเทศต้นทางพิมพ์เฉพาะของที่นำเข้า — ของในประเทศไม่มีประเทศต้นทางให้พิมพ์', () => {
        const s2 = sectionTwoOf(renderKatorlor1Html(filing({
            varieties: [{ kind: 'SEED', name: 'หางกระรอก', origin: 'DOMESTIC', originCountry: 'ไทย', source: 'ก', quantity: '1', unit: 'เมล็ด' }],
        }), null));

        expect(s2).toContain('ในประเทศ');
        expect(s2).not.toContain('จากไทย');
    });

    /**
     * กระดาษของกรมมีสองช่อง แต่แบบสั่งเองว่า "เกิน 2 ส่วนให้แนบรายละเอียดเพิ่ม" —
     * การตัดแถวที่สามทิ้งคือการลบสายพันธุ์ที่ผู้ยื่นประกาศไว้ออกจากเอกสารราชการ
     */
    test('สายพันธุ์เกินสองแถวไม่ถูกตัดทิ้ง แต่กำกับว่าเป็นรายละเอียดเพิ่ม', () => {
        const s2 = sectionTwoOf(renderKatorlor1Html(filing({
            varieties: [
                { kind: 'SEED', name: 'หนึ่ง', origin: 'DOMESTIC', source: 'ก', quantity: '1', unit: 'เมล็ด' },
                { kind: 'SEED', name: 'สอง', origin: 'DOMESTIC', source: 'ข', quantity: '2', unit: 'เมล็ด' },
                { kind: 'SEED', name: 'สาม', origin: 'DOMESTIC', source: 'ค', quantity: '3', unit: 'เมล็ด' },
            ],
            varietiesNote: 'อยู่ระหว่างทดลองอีกหนึ่งสายพันธุ์',
        }), null));

        expect(s2).toContain('สาม');
        expect(s2).toContain('รายละเอียดเพิ่ม');
        expect(s2).toContain('อยู่ระหว่างทดลองอีกหนึ่งสายพันธุ์');
    });

    /**
     * ช่องว่างต้องอ่านออกว่าว่าง ไม่ใช่หายไปเงียบ ๆ — คนตรวจต้องแยกออกระหว่าง
     * "ผู้ยื่นไม่ได้กรอก" กับ "ระบบไม่ได้พิมพ์" ซึ่งคือข้อบกพร่องที่เทสนี้เกิดมาเพื่อกัน
     */
    test('คำขอที่ยังไม่ระบุพันธุ์ พิมพ์ว่ายังไม่ได้ระบุ ไม่ใช่เงียบ', () => {
        const s2 = sectionTwoOf(renderKatorlor1Html(filing({ varieties: [], varietiesNote: '' }), null));
        expect(s2).toContain('ยังไม่ได้ระบุพันธุ์และส่วนที่ใช้');
    });

    test('แถวเปล่าที่ผู้ยื่นกด "เพิ่มสายพันธุ์" แล้วไม่กรอก ไม่กลายเป็นแถวบนกระดาษ', () => {
        const s2 = sectionTwoOf(renderKatorlor1Html(filing({
            varieties: [{ kind: null, name: '', origin: null, source: '', quantity: '', unit: '' }],
            varietiesNote: '',
        }), null));
        expect(s2).toContain('ยังไม่ได้ระบุพันธุ์และส่วนที่ใช้');
        expect(s2).not.toContain('พันธุ์ที่ 1');
    });

    test('ค่าที่ผู้ยื่นพิมพ์ถูก escape — คำขอไม่ใช่ที่แทรก markup', () => {
        const s2 = sectionTwoOf(renderKatorlor1Html(filing({
            varieties: [{ kind: 'SEED', name: '<script>x</script>', origin: 'DOMESTIC', source: 'ก', quantity: '1', unit: 'เมล็ด' }],
        }), null));
        expect(s2).not.toContain('<script>');
        expect(s2).toContain('&lt;script&gt;');
    });
});

/**
 * คำสองชุดนี้มีสำเนาสองที่โดยจำเป็น (หลังบ้าน import ไฟล์ .ts ของหน้าบ้านไม่ได้)
 * จึงผูกด้วยการอ่านไฟล์วิซาร์ดเป็นข้อความ — สำนวนเดียวกับ plant-slug-map-covers-the-wizard
 */
describe('คำของข้อ ๓ ตรงกับที่วิซาร์ดให้ผู้ยื่นเลือก', () => {
    test('ค่าที่วิซาร์ดเขียนลงคำขอ มีคำไทยบนกระดาษครบทุกค่า', () => {
        const text = fs.readFileSync(WIZARD_STEP4, 'utf8');
        const kinds = [...text.matchAll(/value: '(SEED|OTHER_PART)'/g)].map((m) => m[1]);
        const origins = [...text.matchAll(/value: '(DOMESTIC|IMPORTED)'/g)].map((m) => m[1]);

        expect(kinds.sort()).toEqual(['OTHER_PART', 'SEED']);
        expect(origins.sort()).toEqual(['DOMESTIC', 'IMPORTED']);

        // ทุกค่าต้องพิมพ์เป็นคำไทยได้ ไม่ใช่พิมพ์รหัสดิบให้ชาวบ้านอ่าน
        for (const kind of kinds) {
            const s2 = sectionTwoOf(renderKatorlor1Html(filing({
                varieties: [{ kind, name: 'ทดสอบ', origin: 'DOMESTIC', source: 'ก', quantity: '1', unit: 'หน่วย' }],
            }), null));
            expect(s2).not.toContain(kind);
            expect(s2).toContain('ทดสอบ');
        }
        for (const origin of origins) {
            const s2 = sectionTwoOf(renderKatorlor1Html(filing({
                varieties: [{ kind: 'SEED', name: 'ทดสอบ', origin, source: 'ก', quantity: '1', unit: 'หน่วย' }],
            }), null));
            expect(s2).not.toContain(origin);
        }
    });

    test('จำนวนช่องบนกระดาษตรงกับที่วิซาร์ดบอกผู้ยื่น', () => {
        const text = fs.readFileSync(WIZARD_STEP4, 'utf8');
        const m = text.match(/VARIETY_ROWS_ON_THE_FORM = (\d+)/);
        expect(m).not.toBeNull();
        expect(Number(m[1])).toBe(2);
    });
});

/**
 * แบบพิมพ์ต้องอ่านครบบนมือถือ — และกระดาษที่กรมได้รับต้องไม่เปลี่ยน
 *
 * เดินจริงบนมือถือ 390px 2026-09-12: หน้าตรวจทานแสดงแบบ กทล.1 แล้วข้อความถูกตัดหาย
 * ทางขวา (ป้ายกินความกว้างขั้นต่ำ 190px จาก 390 ที่มี และช่องติ๊กห้ามขึ้นบรรทัดใหม่)
 * เกษตรกรอ่านแบบที่ตัวเองกำลังจะยื่นไม่ครบ
 *
 * ที่ต้องตรึงคู่กันคือ **PDF ต้องไม่เปลี่ยน** — Puppeteer เรนเดอร์ที่ความกว้าง A4 (~794px)
 * การแก้จึงต้องอยู่ใน media query ที่จุดตัดต่ำกว่านั้น ไม่ใช่แก้กติกาหลัก
 */
describe('แบบ กทล.1 บนจอแคบ', () => {
    const html = renderKatorlor1Html(filing(), null);

    test('มีกติกาสำหรับจอแคบ', () => {
        expect(html).toContain('@media (max-width: 640px)');
    });

    test('จอแคบวางป้ายเหนือค่า และปล่อยให้ช่องติ๊กขึ้นบรรทัดได้', () => {
        const block = html.slice(html.indexOf('@media (max-width: 640px)'));
        expect(block).toContain('flex-direction:column');
        expect(block).toContain('min-width:0');
        expect(block).toContain('white-space:normal');
    });

    /**
     * จุดตัดต้องต่ำกว่าความกว้าง A4 ที่ Puppeteer ใช้ ไม่งั้นกระดาษจะเปลี่ยนหน้าตาไปด้วย
     */
    test('จุดตัดต่ำกว่าความกว้างกระดาษ A4 — PDF จึงไม่ถูกแตะ', () => {
        const m = html.match(/@media \(max-width: (\d+)px\)/);
        expect(m).not.toBeNull();
        expect(Number(m[1])).toBeLessThan(794);
    });

    test('กติกาหลักยังเหมือนเดิม — ป้ายยังกว้าง 190px บนจอกว้าง', () => {
        const beforeMedia = html.slice(0, html.indexOf('@media'));
        expect(beforeMedia).toContain('min-width:190px');
    });
});
