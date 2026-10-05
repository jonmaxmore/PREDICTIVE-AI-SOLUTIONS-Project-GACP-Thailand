/**
 * QR ที่พิมพ์ติดถุง ต้องพาคนสแกนไปถึงหน้าจริง
 *
 * operator: "QR code ที่เจนมาต้องเป็น QR ที่แสกนได้จริง และมีข้อมูลที่ถูกต้องข้างใน ไม่ใช่ mockup"
 *
 * ที่วัดได้จริงบน demo (2026-09-07):
 *   ค่าที่ระบบสร้าง "ตอนนี้"      https://demo.gacpth.com/trace/lot/…   ✅ ถูกต้อง
 *   ค่าที่ค้างอยู่ในฐานข้อมูล      http://localhost/trace/lot/…          ❌ สแกนแล้วไปไม่ถึงไหน
 *
 * แถวเหล่านั้นเกิดตอนที่ยังไม่ได้ตั้ง PUBLIC_TRACE_URL บนเครื่อง — ตัวสร้าง URL ถอยไปใช้
 * localhost เป็นค่าสุดท้าย · แต่ตัวเรนเดอร์ป้ายอ่าน `lot.trackingUrl` ที่เก็บไว้ก่อนเสมอ
 * (lot-label-template-service.js) ⇒ **ป้ายที่พิมพ์วันนี้ ยังพา URL ที่ตายแล้วออกไปติดถุง**
 *
 * กฎเดียวกับที่ใช้กับชื่อฟาร์ม "Certified Farm": ค่าที่เก็บไว้ซึ่งเป็นไปไม่ได้ในโลกจริง
 * ไม่ใช่ข้อเท็จจริงที่ต้องเคารพ — ให้ถือว่าไม่มี แล้วสร้างใหม่จากค่าที่ตั้งไว้ปัจจุบัน
 */
'use strict';

const {
    isUnscannableTraceUrl,
    publicTraceUrlFor,
} = require('../../services/qrcode/public-trace-url');

describe('URL ที่สแกนแล้วไปไม่ถึง ไม่ใช่ URL ที่ต้องเคารพ', () => {
    it('จับได้ว่าอันไหนพาไปไม่ถึง', () => {
        for (const dead of [
            'http://localhost/trace/lot/abc',
            'https://localhost:3000/trace/lot/abc',
            'http://127.0.0.1/trace/batch/abc',
            'http://0.0.0.0/trace/lot/abc',
            'http://[::1]/trace/lot/abc',
        ]) {
            expect(isUnscannableTraceUrl(dead)).toBe(true);
        }
    });

    it('ไม่ไปยุ่งกับ URL สาธารณะจริง', () => {
        for (const live of [
            'https://demo.gacpth.com/trace/lot/abc',
            'https://gacpth.com/trace/batch/abc',
            'https://staging.gacpth.com/trace/plot-cycle/PLOT-1',
        ]) {
            expect(isUnscannableTraceUrl(live)).toBe(false);
        }
    });

    it('ค่าว่างถือว่าใช้ไม่ได้ — จะได้สร้างใหม่', () => {
        expect(isUnscannableTraceUrl('')).toBe(true);
        expect(isUnscannableTraceUrl(null)).toBe(true);
        expect(isUnscannableTraceUrl('ไม่ใช่ URL')).toBe(true);
    });

    it('ค่าที่เก็บไว้ซึ่งใช้ได้ ยังชนะ — ไม่เขียนทับของที่ถูกอยู่แล้ว', () => {
        expect(publicTraceUrlFor('https://demo.gacpth.com/trace/lot/abc', 'lot/abc'))
            .toBe('https://demo.gacpth.com/trace/lot/abc');
    });

    it('ค่าที่เก็บไว้ซึ่งพาไปไม่ถึง ถูกสร้างใหม่จากค่าที่ตั้งไว้ปัจจุบัน', () => {
        const rebuilt = publicTraceUrlFor('http://localhost/trace/lot/abc', 'lot/abc');
        expect(isUnscannableTraceUrl(rebuilt)).toBe(false);
        expect(rebuilt).toMatch(/\/trace\/lot\/abc$/);
    });

    it('ตัวเรนเดอร์ป้ายล็อตใช้กฎนี้ ไม่ใช่หยิบค่าที่เก็บไว้ตรง ๆ', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'pdf', 'lot-label-template-service.js'),
            'utf8',
        );
        expect(src).toContain('publicTraceUrlFor');
    });
});
