/**
 * เป้ากดที่นิ้วกดถูก และแป้นพิมพ์ที่ถูกชนิด
 *
 * operator 2026-09-10: "ลูกค้าบอกว่าเวปเรากดยาก เข้าใจยาก" · สองอย่างนี้วัดได้ และวัดแล้ว
 * ก่อนแก้:
 *   ปุ่ม      ไม่มีขนาดไหนถึง 48px เลยแม้แต่ตัวใหญ่สุด (lg = 44px) และขนาดที่ใช้จริง
 *             มากที่สุดคือ sm (234 จุด) ซึ่งสูงแค่ 36px — ไม่ใช่ md ที่เป็นค่าเริ่มต้น
 *   คีย์บอร์ด  inputMode เป็นศูนย์จุดทั้งแอป ⇒ ช่องตัวเลขทุกช่องเด้งแป้นตัวอักษร
 *
 * เทสนี้อ่านซอร์สของ primitive ตรง ๆ ไม่ mount อะไร — เพราะสิ่งที่ต้องตรึงคือ "สัญญา"
 * ของ design system ไม่ใช่พฤติกรรมของหน้าจอใดหน้าจอหนึ่ง · ถ้าวันหน้ามีคนย่อปุ่มกลับ
 * เพื่อให้ตารางแน่นขึ้น เทสนี้จะแดงพร้อมบอกว่าทำไมมันถึงเคยใหญ่
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const BUTTON = read('button.tsx');
const INPUT = read('input.tsx');

/** 'h-12' → 48 · Tailwind หน่วยละ 4px */
function px(cls: string): number {
    const m = cls.match(/\bh-(\d+)\b/);
    return m ? Number(m[1]) * 4 : 0;
}

function sizeClass(name: string): string {
    const m = BUTTON.match(new RegExp(`['"]?${name.replace(/[-]/g, '\\-')}['"]?:\\s*'([^']+)'`));
    return m ? m[1] : '';
}

describe('ขนาดเป้ากดของปุ่ม', () => {
    test.each([
        ['sm', 44],   // พื้น WCAG AA — และเป็นขนาดที่ใช้มากที่สุดในแอป
        ['md', 48],   // ค่าเริ่มต้น ตาม directive
        ['lg', 48],   // ปุ่มหลักของหน้า ต้องไม่ต่ำกว่าค่าเริ่มต้น
    ])('size="%s" สูงอย่างน้อย %spx', (name, min) => {
        expect(px(sizeClass(name))).toBeGreaterThanOrEqual(min);
    });

    test('ค่าเริ่มต้น (md) ถึง 48px — ปุ่มที่ไม่ระบุ size คือส่วนใหญ่ของแอป', () => {
        expect(px(sizeClass('md'))).toBeGreaterThanOrEqual(48);
    });

    test('ปุ่มไอคอนเป็นสี่เหลี่ยมจัตุรัส และถึง 48px', () => {
        const icon = sizeClass('icon');
        expect(px(icon)).toBeGreaterThanOrEqual(48);
        expect(icon).toMatch(/\bw-12\b/);
    });

    test('lg ต้องใหญ่กว่า md และ md ใหญ่กว่า sm — ลำดับต้องอ่านออกจากขนาดจริง', () => {
        expect(px(sizeClass('lg'))).toBeGreaterThan(px(sizeClass('md')));
        expect(px(sizeClass('md'))).toBeGreaterThan(px(sizeClass('sm')));
    });

    test('ขนาด compact ยังเล็กกว่า 48px ได้ แต่ต้องเขียนไว้ว่าไม่ใช่เป้ากดหลัก', () => {
        // ไม่ได้บังคับให้ compact ถึง 48 — ชิปในตารางไม่ใช่ปุ่มที่ต้องกดให้ถูกครั้งเดียว
        // แต่ต้องมีคำเตือนอยู่ในไฟล์ ไม่งั้นคนถัดไปจะหยิบไปใช้กับปุ่มจริง
        expect(BUTTON).toMatch(/ไม่ใช่เป้ากดหลัก/);
    });
});

describe('คีย์บอร์ดที่เด้งขึ้นมาบนมือถือ', () => {
    test('ช่องตัวเลขขอแป้นตัวเลขที่มีจุดทศนิยม', () => {
        expect(INPUT).toMatch(/number:\s*'decimal'/);
    });

    test.each([['tel', 'tel'], ['email', 'email'], ['url', 'url'], ['search', 'search']])(
        'type="%s" → inputMode="%s"', (type, mode) => {
            expect(INPUT).toMatch(new RegExp(`${type}:\\s*'${mode}'`));
        });

    test('ผู้เรียกที่ส่ง inputMode มาเอง ต้องชนะค่าที่อนุมาน', () => {
        expect(INPUT).toMatch(/inputMode\s*\?\?\s*\(type/);
    });

    test('ส่งค่าเข้า <input> ทั้งสองทาง (มี/ไม่มี section ข้าง ๆ)', () => {
        expect((INPUT.match(/inputMode=\{resolvedInputMode\}/g) || [])).toHaveLength(2);
    });
});
