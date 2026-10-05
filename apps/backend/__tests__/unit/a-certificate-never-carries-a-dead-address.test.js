'use strict';

/**
 * QR บนใบรับรองต้องพาไปถึงหน้าตรวจสอบจริง
 *
 * ใบรับรองคือกระดาษที่ออกจากมือรัฐไปแล้ว เรียกคืนไม่ได้ · ค่าที่อยู่ใน QR ถูกแช่ไว้ตั้งแต่วันออกใบ
 * (certificate-service เขียนลง `qrData` แล้วตัวเรนเดอร์ PDF เคารพค่านั้นเสมอ —
 * certificate-template-service.js:191 "prefer that so the QR scan target never drifts")
 *
 * ที่วัดได้จริง (2026-09-07 บนฐานข้อมูลที่เดินเส้นเต็ม):
 *   GACP-TH-2569-8F42A6  http://127.0.0.1:8099/verify/…   ❌ 5 ใบ
 *   GACP-TH-2569-EF182D  https://gacpth.com/verify/…      ✅ 2 ใบ
 * ⇒ ใบรับรองของรัฐห้าใบ ถ้าพิมพ์ออกมาวันนี้ จะมี QR ที่สแกนแล้วไปไม่ถึงไหนติดอยู่บนหน้ากระดาษ
 *
 * กฎเดียวกับ QR ของล็อต (a-qr-never-points-at-localhost) และกับชื่อฟาร์ม 'Certified Farm':
 * ค่าที่เก็บไว้ซึ่งเป็นไปไม่ได้ในโลกจริง ไม่ใช่ข้อเท็จจริงที่ต้องเคารพ — ถือว่าไม่มี แล้วสร้างใหม่
 * ส่วนใบที่เก็บที่อยู่สาธารณะจริงไว้ ยังใช้ค่าเดิมต่อ เพราะใบที่พิมพ์ไปแล้วกับใบที่พิมพ์ใหม่
 * ต้องพาไปที่เดียวกัน
 */

const {
    isUnscannableTraceUrl,
    publicVerifyUrlFor,
} = require('../../services/qrcode/public-trace-url');

const CERT = 'GACP-TH-2569-8F42A6';

describe('ที่อยู่ที่ QR ของใบรับรองพาไป', () => {
    it('ค่าที่แช่ไว้ซึ่งพาไปไม่ถึง ถูกสร้างใหม่จากค่าที่ตั้งไว้ปัจจุบัน', () => {
        const rebuilt = publicVerifyUrlFor(`http://127.0.0.1:8099/verify/${CERT}`, CERT);
        expect(isUnscannableTraceUrl(rebuilt)).toBe(false);
        expect(rebuilt.endsWith(`/${CERT}`)).toBe(true);
    });

    it('ค่าที่แช่ไว้ซึ่งเป็นที่อยู่สาธารณะจริง ไม่ถูกแตะ', () => {
        const live = `https://gacpth.com/verify/${CERT}`;
        expect(publicVerifyUrlFor(live, CERT)).toBe(live);
    });

    it('ใบที่ไม่เคยมี qrData ก็ยังได้ที่อยู่ที่สแกนได้', () => {
        const built = publicVerifyUrlFor(null, CERT);
        expect(isUnscannableTraceUrl(built)).toBe(false);
        expect(built).toContain(CERT);
    });

    it('ไม่มีเลขใบรับรอง = ได้แค่หน้าตรวจสอบ ไม่ใช่ที่อยู่พัง', () => {
        const built = publicVerifyUrlFor('http://localhost/verify/x', '');
        expect(isUnscannableTraceUrl(built)).toBe(false);
    });

    it('ตัวเรนเดอร์ใบรับรองใช้กฎนี้ ไม่ใช่หยิบ qrData ตรง ๆ', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'pdf', 'certificate-template-service.js'),
            'utf8',
        );
        expect(src).toContain('publicVerifyUrlFor');
    });
});
