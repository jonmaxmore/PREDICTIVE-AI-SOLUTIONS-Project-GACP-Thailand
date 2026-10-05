/**
 * เลขบนกระดาษคือ GACP-DTAM-{ปี}-{รหัส} แต่ทะเบียนเก็บ GACP-TH-{ปี}-{รหัส}
 * (ข้อวินิจฉัยของ operator 2026-10-05 ข้อ ข): หน้าตรวจสอบสาธารณะต้องรับเลขทั้งสองแบบ
 *
 * หน้านี้ไม่มี regex หรือ zod ดักรูปแบบ — เลขจาก URL ถูกส่งต่อให้ backend ตัดสิน
 * เทสนี้ล็อกว่าเลขที่พิมพ์บนกระดาษไปถึง backend ครบ (ไม่ถูกตัดทิ้งหรือปฏิเสธที่หน้าเว็บ)
 * และคำตอบ "ไม่พบ" ของ backend ยังขึ้นเป็น "ไม่พบ" เหมือนเดิม
 * ฝั่งแปลงเลขอยู่ที่ backend: apps/backend/__tests__/unit/certificate-number-printed-form.test.js
 */

import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/headers', () => ({
    headers: async () => ({
        get: (name: string) =>
            name === 'x-forwarded-host' ? 'staging.gacpth.com' : name === 'x-forwarded-proto' ? 'https' : null,
    }),
}));

import PublicCertVerifyPage from '../page';

function stub(body: unknown) {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch;
}

async function render(certNumber: string) {
    const el = await PublicCertVerifyPage({ params: Promise.resolve({ 'cert-number': certNumber }) });
    return renderToStaticMarkup(el);
}

afterEach(() => jest.clearAllMocks());

describe('หน้าตรวจสอบใบรับรอง รับเลขที่พิมพ์บนกระดาษ', () => {
    it('ส่งเลข GACP-DTAM ถึง backend ครบ และแสดงผลว่าถูกต้องเมื่อ backend พบ', async () => {
        stub({
            success: true, verified: true, valid: true,
            data: {
                certificateNumber: 'GACP-TH-2569-A3F7B2',
                certificate: { farmName: 'ฟาร์มสมุนไพรบ้านนา', province: 'เชียงใหม่', cropTypes: ['ขมิ้นชัน'], standards: ['GACP'] },
            },
        });
        const html = await render('GACP-DTAM-2569-A3F7B2');
        const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
        expect(url.endsWith('/api/v1/public/verify/GACP-DTAM-2569-A3F7B2')).toBe(true);
        expect(html).toContain('ใบรับรองถูกต้องและยังมีผลบังคับใช้');
    });

    it('เลข GACP-DTAM ที่ backend ไม่รู้จัก ยังขึ้น "ไม่พบใบรับรองเลขที่นี้ในทะเบียน"', async () => {
        stub({ success: true, verified: false, valid: false, data: { status: 'invalid', reasonCode: 'NOT_FOUND' } });
        const html = await render('GACP-DTAM-2569-ZZZZZZ');
        expect(html).toContain('ไม่พบใบรับรองเลขที่นี้ในทะเบียน');
        expect(html).not.toContain('ใบรับรองถูกต้องและยังมีผลบังคับใช้');
    });
});

describe('รอบ 2: เลขแบบ TH-GACP {n}/{ปี}', () => {
    const ok = (num: string) => ({
        success: true, verified: true, valid: true,
        data: { certificateNumber: num, certificate: { farmName: 'ฟาร์มสมุนไพรบ้านนา', province: 'เชียงใหม่', cropTypes: ['ขมิ้นชัน'], standards: ['GACP'] } },
    });

    it('หน้าแสดงเลขที่เก็บจริงจาก API ไม่ใช่ค่าที่พิมพ์ใน URL', async () => {
        stub(ok('TH-GACP 87/2568'));
        const html = await render('th-gacp-87-2568');
        expect(html).toContain('TH-GACP 87/2568');
        expect(html).not.toContain('>th-gacp-87-2568<');
    });

    it('เลขแบบใหม่ไปถึง backend เป็น slug ที่ไม่มี / และช่องว่าง', async () => {
        stub(ok('TH-GACP 87/2568'));
        await render('TH-GACP-87-2568');
        const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
        expect(url.endsWith('/api/v1/public/verify/TH-GACP-87-2568')).toBe(true);
    });

    it('ลิงก์และ QR ที่หน้านี้สร้างใช้ slug', async () => {
        const { buildPublicVerifyPageUrl, buildPublicVerifyUrl } = await import('@/lib/verify/public-verify-url');
        expect(buildPublicVerifyPageUrl('https://gacpth.com', 'TH-GACP 87/2568')).toBe('https://gacpth.com/verify/TH-GACP-87-2568');
        expect(buildPublicVerifyUrl('https://gacpth.com', 'TH-GACP 87/2568')).toBe('https://gacpth.com/api/v1/public/verify/TH-GACP-87-2568');
        expect(buildPublicVerifyPageUrl('https://gacpth.com', 'GACP-TH-2569-A3F7B2')).toBe('https://gacpth.com/verify/GACP-TH-2569-A3F7B2');
    });
});

