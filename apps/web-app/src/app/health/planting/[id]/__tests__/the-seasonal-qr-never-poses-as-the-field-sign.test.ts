/**
 * แปลงหนึ่งแปลงมีรหัสสองแบบ และมีแบบเดียวที่ติดกลางแปลงได้
 *
 *   plotCode  รหัสถาวรของแปลง — เกิดพร้อมแถว Plot อยู่ไปตลอด
 *   qrCode    ผนึกของฤดูกาลนี้ — หนึ่งใบต่อ (รอบปลูก, แปลง) **เกิดใหม่ทุกฤดู**
 *
 * ไฟล์ตารางแปลงเขียนกฎไว้เองว่า qrCode "must never be printed on a sign meant to stay in
 * the field" — แต่บนหน้าจอ ปุ่ม "แสดง QR" เปิดรูป QR ของรหัสฤดูกาล ใต้หัวข้อ "QR แปลง:"
 * วางอยู่ข้าง ๆ ปุ่ม "พิมพ์ป้าย" ซึ่งพิมพ์ป้ายถาวร · ไม่มีอะไรบนจอบอกว่าสองอันนี้ต่างกัน
 *
 * เกษตรกรที่แคปหน้าจอนั้นไปเคลือบแล้วปักกลางแปลง จะได้ป้ายที่ตายเมื่อจบฤดู — สแกนแล้วเจอ
 * รอบปลูกที่ปิดไปแล้ว หรือไม่เจออะไรเลย · ในระบบตามสอบย้อนกลับ ป้ายที่ชี้ผิดแย่กว่าไม่มีป้าย
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');

const PLOTS_TAB = read('planting-cycle-detail-tabs-section-a-overview-plots.tsx');
const SECTION_B = read('planting-cycle-detail-tabs-section-b.tsx');
const MODALS = read('planting-cycle-detail-modals.tsx');

describe('QR ของรอบปลูก ต้องไม่ถูกเข้าใจว่าเป็นป้ายประจำแปลง', () => {
    it('หัวข้อบนรูปที่เปิดดู ไม่เรียกตัวเองว่า "QR แปลง"', () => {
        for (const src of [PLOTS_TAB, SECTION_B]) {
            expect(src).not.toMatch(/openQrPreview\(\s*`QR แปลง:/);
        }
    });

    it('หัวข้อบอกว่าเป็นของรอบปลูกนี้', () => {
        for (const src of [PLOTS_TAB, SECTION_B]) {
            expect(src).toMatch(/openQrPreview\(\s*`QR รอบปลูกนี้/);
        }
    });

    it('หน้าต่างที่เปิดดู บอกว่ารหัสนี้เกิดใหม่ทุกฤดู และป้ายถาวรอยู่ที่ปุ่มพิมพ์ป้าย', () => {
        expect(MODALS).toMatch(/เกิดใหม่ทุก(ฤดู|รอบ)/);
        expect(MODALS).toContain('พิมพ์ป้าย');
    });

    it('ปุ่มพิมพ์ป้ายถาวรยังผูกกับรหัสถาวร ไม่ใช่รหัสฤดูกาล', () => {
        // ปุ่มพิมพ์ป้ายแสดงเมื่อมี plotCode — ไม่ใช่ qrCode
        expect(PLOTS_TAB).toMatch(/qr\?\.plotCode[\s\S]{0,400}พิมพ์ป้าย/);
    });
});
