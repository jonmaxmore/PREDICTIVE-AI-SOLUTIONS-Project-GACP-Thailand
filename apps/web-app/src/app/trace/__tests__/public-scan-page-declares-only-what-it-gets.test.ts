/**
 * หน้าที่ผู้ซื้อเปิด ต้องประกาศรับเฉพาะสิ่งที่เซิร์ฟเวอร์ส่งจริง
 *
 * ฝั่งหลังบ้านมีเทสโครงสร้างที่ห้ามประตูสาธารณะตีพิมพ์ id ภายใน ชื่อแปลง ชื่อรอบปลูก
 * (apps/backend/__tests__/unit/public-trace-hands-out-no-internal-ids.test.js) · แต่หน้าจอ
 * **ยังประกาศชนิดของมันไว้ครบ** และเรนเดอร์สองแถวที่ตอบได้แค่ "-" ตลอดกาล
 *
 * เห็นตอนกดผ่านเบราว์เซอร์จริง 2026-09-06: หน้าล็อตแสดง "แปลงและพื้นที่ -" กับ "รอบปลูก -"
 * ให้ผู้ซื้อ · ไม่ใช่แค่ขยะบนจอ มันบอกผู้ซื้อว่าแพลตฟอร์มถือข้อมูลนี้อยู่แต่ไม่ยอมบอก
 * ทั้งที่ความจริงคือมติสั่งไม่ให้เก็บมันไว้บนหน้าสาธารณะเลย
 *
 * เทสนี้อ่านซอร์สของหน้า เพราะสิ่งที่ต้องพิสูจน์คือ "ไม่มี" ซึ่งเรนเดอร์แล้วดูไม่เห็น
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const TRACE = join(__dirname, '..');

/** ตัดคอมเมนต์ออก — คำอธิบายว่าทำไมฟิลด์หนึ่งถึงหายไป ต้องไม่ถูกอ่านว่ามันยังอยู่ */
function code(...segments: string[]): string {
    return readFileSync(join(TRACE, ...segments), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

const PAGES: Array<[string, string]> = [
    ['หน้าล็อต (ที่ QR บนถุงชี้มา)', code('lot', '[lot-id]', 'client-view.tsx')],
    ['หน้า QR ทั่วไป', code('[qr-code]', 'client-view.tsx')],
    ['หน้ารุ่นเก็บเกี่ยว', code('batch', '[qr-code]', 'client-view.tsx')],
];

describe('หน้าสแกนสาธารณะไม่ประกาศรับของที่เซิร์ฟเวอร์เลิกส่งแล้ว', () => {
    it.each(PAGES)('%s — ไม่มีชื่อแปลง/ชื่อรอบปลูก/คีย์ภายใน', (_name, src) => {
        const found = ['plotName', 'cycleName', 'plotId', 'cyclePlotId', 'cycleId',
            'healthPlantingUnitsUrl'].filter((f) => new RegExp(`\\b${f}\\b`).test(src));
        expect(found).toEqual([]);
    });

    it.each(PAGES)('%s — ไม่มีพิกัด GPS ไม่ว่าจะรูปไหน', (_name, src) => {
        const found = ['latitude', 'longitude', 'gpsCoordinates'].filter((f) => new RegExp(`\\b${f}\\b`).test(src));
        expect(found).toEqual([]);
    });

    it.each(PAGES)('%s — ไม่ประกาศคีย์หลักของฟาร์มไว้ในชนิดของตัวเอง', (_name, src) => {
        // `farm: { id: string; ... }` — เซิร์ฟเวอร์เลิกส่งตั้งแต่ T12 แต่หน้ารุ่นยังประกาศรับ
        expect(src).not.toMatch(/farm\s*:\s*\{[^}]*?\bid\s*:/s);
    });

    it('หน้าล็อตยังแสดงที่อยู่และ COA — สิ่งที่มติ 2026-09-05 สั่งให้เห็น', () => {
        const src = code('lot', '[lot-id]', 'client-view.tsx');
        expect(src).toMatch(/farm\?\.address/);
        expect(src).toMatch(/labTest\?\.lot/);
        expect(src).toMatch(/latest\?\.fileUrl/);
    });

    it('หน้ารุ่นก็แสดงทั้งสองอย่าง และพูดถึง "รุ่น" ไม่ใช่ "ล็อต"', () => {
        const src = code('batch', '[qr-code]', 'client-view.tsx');
        expect(src).toMatch(/farm\?\.address/);
        expect(src).toMatch(/labTest\?\.batch/);
        // ห้ามหยิบก้อนของล็อตมาแสดงบนหน้ารุ่น — คำกล่าวอ้างคนละอัน
        expect(src).not.toMatch(/labTest[\s\S]{0,40}\.lot\b/);
    });
});
