/**
 * F-QA-02 (deep-qa 2026-09-06) — "ยังไม่เคยมีใบรับรอง" ต้องไม่ถูกพิมพ์เป็น
 * "หมดอายุหรือไม่มีผล"
 *
 * ที่เห็นบนเดโม: ล็อต LOT-2569-000019-A ไม่มีใบรับรองเลย (ระบบมีใบรับรอง 0 ใบ)
 * แต่หน้าสาธารณะขึ้นป้ายแดง "หมดอายุหรือไม่มีผล" + "เลขที่ใบรับรอง: -" ผู้ซื้ออ่านว่า
 * ฟาร์มนี้เคยได้ใบรับรองแล้วปล่อยให้ขาด ซึ่งเป็นคำกล่าวอ้างคนละเรื่องและเสียหายกว่า
 *
 * เทสนี้ตรึงตัวตัดสิน (pure function) — ทั้งสองทิศ: ห้ามทำให้ "ไม่มีใบ" ฟังดูเหมือน
 * "ใบขาด" และห้ามทำให้ "ใบขาดจริง" ฟังดูอ่อนลง
 */
import { describe, expect, it } from '@jest/globals';
import { describeCertificate, readCertificateState } from '../certificate-status';

const VALID = {
    reference: 'GACP-TH-2569-85B448',
    issuedDate: '2026-01-01',
    issuedDateTH: '1 ม.ค. 2569',
    expiryDate: '2029-01-01',
    expiryDateTH: '1 ม.ค. 2572',
    isValid: true,
};

describe('readCertificateState — สามสถานะ ไม่ใช่สอง', () => {
    it.each([
        ['null (เซิร์ฟเวอร์ตอบว่าไม่มีใบ)', null],
        ['undefined (ไม่ได้ส่งฟิลด์มาเลย)', undefined],
        ['อ็อบเจ็กต์เปล่า', {}],
        ['เลขที่ใบเป็นสตริงว่าง', { reference: '   ', isValid: false }],
    ])('%s → NONE', (_name, input) => {
        expect(readCertificateState(input as never)).toBe('NONE');
    });

    it('มีเลขที่ใบ + isValid true → VALID', () => {
        expect(readCertificateState(VALID)).toBe('VALID');
    });

    it('มีเลขที่ใบ แต่ isValid false → LAPSED (ใบมีอยู่จริงและขาดจริง)', () => {
        expect(readCertificateState({ ...VALID, isValid: false })).toBe('LAPSED');
    });

    it('มีเลขที่ใบ แต่ไม่ได้บอก isValid มา → LAPSED ไม่ใช่ VALID (ไม่เดาเข้าข้าง)', () => {
        expect(readCertificateState({ reference: 'GACP-TH-2569-000001' })).toBe('LAPSED');
    });
});

describe('describeCertificate — ถ้อยคำที่ผู้ซื้ออ่าน', () => {
    it('ไม่มีใบรับรอง: ป้ายเป็นกลาง บอกตรง ๆ ว่ายังไม่เคยออกใบ และไม่พูดคำว่าหมดอายุบนป้าย', () => {
        const cert = describeCertificate(null, 'ล็อต');

        expect(cert.state).toBe('NONE');
        expect(cert.hasCertificate).toBe(false);
        expect(cert.tone).toBe('neutral');
        expect(cert.badgeLabel).toBe('ยังไม่มีใบรับรองสำหรับล็อตนี้');
        expect(cert.badgeLabel).not.toMatch(/หมดอายุ|เพิกถอน|ไม่มีผล/);
        // บรรทัดอธิบายพูดถึงคำว่าหมดอายุได้ เพราะพูดเพื่อ "ปฏิเสธ" ว่าไม่ใช่กรณีนั้น
        expect(cert.note).toContain('ยังไม่เคยมีการออกใบรับรอง');
    });

    it('ใบหมดอายุ/ถูกเพิกถอนจริง: ยังเป็นสีแดงและยังใช้ถ้อยคำเดิม ไม่ถูกทำให้อ่อนลง', () => {
        const cert = describeCertificate({ ...VALID, isValid: false }, 'ล็อต');

        expect(cert.state).toBe('LAPSED');
        expect(cert.hasCertificate).toBe(true);
        expect(cert.tone).toBe('danger');
        expect(cert.badgeLabel).toBe('หมดอายุหรือไม่มีผล');
        expect(cert.note).toContain('เคยได้รับใบรับรอง');
    });

    it('ใบใช้ได้: เขียว และไม่ต้องมีบรรทัดอธิบาย', () => {
        const cert = describeCertificate(VALID, 'ล็อต');

        expect(cert.state).toBe('VALID');
        expect(cert.hasCertificate).toBe(true);
        expect(cert.tone).toBe('success');
        expect(cert.badgeLabel).toBe('ใช้งานได้ ยังไม่หมดอายุ');
        expect(cert.note).toBeNull();
    });

    it('คำเรียกเปลี่ยนตามประตูที่ถูกสแกน — หน้ารุ่นไม่พูดว่า "ล็อต"', () => {
        expect(describeCertificate(null, 'รุ่น').badgeLabel).toBe('ยังไม่มีใบรับรองสำหรับรุ่นนี้');
        expect(describeCertificate(null).badgeLabel).toBe('ยังไม่มีใบรับรองสำหรับรายการนี้');
    });

    it('สามสถานะให้ป้ายที่ต่างกันทั้งหมด — ผู้ซื้อต้องแยกออกด้วยตา', () => {
        const labels = [
            describeCertificate(null, 'ล็อต').badgeLabel,
            describeCertificate(VALID, 'ล็อต').badgeLabel,
            describeCertificate({ ...VALID, isValid: false }, 'ล็อต').badgeLabel,
        ];
        expect(new Set(labels).size).toBe(3);
    });
});
