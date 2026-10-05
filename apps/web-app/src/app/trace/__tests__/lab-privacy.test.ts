/**
 * SEC-TRACE-PII-002 / R9 — **INVERTED 2026-09-06, not deleted.**
 *
 * ไฟล์นี้เคยปักมติ R9 ไว้ว่า หน้าสแกนสาธารณะพูดได้อย่างเดียวว่า "มีผลตรวจ" หรือ "ยังไม่มี" ·
 * ห้ามแสดงค่าที่วัดได้ ห้ามแสดงไฟล์รายงาน · **มตินั้นถูกต้องตอนที่มันมีผล** และคำยืนยันเดิม
 * ยังอยู่ในประวัติ git ไม่ได้ถูกแกล้งลืม
 *
 * operator เปลี่ยนมติเมื่อ 2026-09-05: "ให้อัปโหลด COA และพวกชื่อฟาร์ม และที่อยู่ติดต่อได้
 * เมื่อสแกนต้องเห็นทั้งหมด" · หลังบ้านทำตามแล้ว (T13) แต่ **ตัวช่วยฝั่งหน้าจอยังบังคับมติเดิม
 * และยังอ่านรูปร่างเก่าอยู่** — `data.lot.labTest.tested` ซึ่งหลัง T13 กลายเป็น
 * `data.lot.labTest.lot.tested` ⇒ หน้าจอไม่แสดงผลแล็บเลย ทั้งที่ API ส่งมาครบ
 *
 * เจอด้วยการกดผ่านเบราว์เซอร์จริง ไม่ใช่จากการอ่านโค้ด: payload มีที่อยู่และไฟล์ COA
 * แต่หน้าที่ผู้ซื้อเห็นไม่มีทั้งสองอย่าง · "เมื่อสแกนต้องเห็น" ไม่ได้แปลว่า "อยู่ใน JSON"
 *
 * ที่ **ไม่เปลี่ยน**: ค่าที่วัดได้ (THC/CBD/ความชื้น) ยังไม่แสดง — ไม่ใช่เพราะความลับ
 * แต่เพราะแพลตฟอร์มไม่เก็บมันเลย มติคือ "ไม่พิมพ์ค่าเอง ให้แนบผลแล็บ"
 */
import { describe, expect, it } from '@jest/globals';
import { deriveLabAssurance } from '../lab-assurance';

const lotWithCoa = {
    lot: {
        labTest: {
            lot: {
                subject: 'LOT',
                tested: true,
                latest: {
                    fileUrl: '/uploads/lab-results/coa.pdf',
                    fileName: 'coa.pdf',
                    labName: 'ห้องปฏิบัติการกลาง',
                    reportNumber: 'CL-2569-001',
                    reportedAt: '2026-09-01T00:00:00.000Z',
                    verificationCode: 'AB12-CD34',
                    verificationStatus: 'FARMER_UPLOADED',
                },
                reports: [{ fileUrl: '/uploads/lab-results/coa.pdf', labName: 'ห้องปฏิบัติการกลาง' }],
            },
            farm: { subject: 'FARM', reportCount: 1 },
        },
    },
} as never;

const lotWithoutCoa = {
    lot: { labTest: { lot: { subject: 'LOT', tested: false, latest: null, reports: [] }, farm: { subject: 'FARM', reportCount: 0 } } },
} as never;

describe('ผลแล็บบนหน้าสแกน — มติ 2026-09-05', () => {
    it('อ่านรูปร่างใหม่ได้ (labTest.lot) ไม่ใช่รูปร่างก่อน T13', () => {
        const a = deriveLabAssurance(lotWithCoa, true);
        expect(a.show).toBe(true);
        expect(a.tested).toBe(true);
    });

    it('ส่งไฟล์ COA ให้หน้าจอแสดงได้ — นี่คือสิ่งที่มติเปลี่ยน', () => {
        const a = deriveLabAssurance(lotWithCoa, true);
        expect(a.fileUrl).toBe('/uploads/lab-results/coa.pdf');
        expect(a.labName).toBe('ห้องปฏิบัติการกลาง');
        expect(a.reportNumber).toBe('CL-2569-001');
    });

    it('บอกว่าใครเป็นคนอ้าง — ผู้ซื้อต้องไม่ต้องเดาว่าเอกสารนี้ใครใส่เข้ามา', () => {
        expect(deriveLabAssurance(lotWithCoa, true).verificationStatus).toBe('FARMER_UPLOADED');
    });

    it('ไม่มีผลตรวจ = พูดว่าไม่มี ไม่ใช่เงียบ — "ยังไม่ตรวจ" ต่างจาก "ระบบไม่รู้"', () => {
        const a = deriveLabAssurance(lotWithoutCoa, true);
        expect(a.tested).toBe(false);
        expect(a.captionTH).toMatch(/ยังไม่มีผลตรวจ/);
        expect(a.fileUrl).toBeNull();
    });

    it('ไม่แสดงค่าที่วัดได้ — แพลตฟอร์มไม่เก็บมัน และไม่ควรเดา', () => {
        const a = deriveLabAssurance(lotWithCoa, true);
        const serialized = JSON.stringify(a);
        for (const key of ['thc', 'cbd', 'moisture', 'passed']) {
            expect(serialized.toLowerCase()).not.toContain(key);
        }
    });

    it('คำอธิบายเดิมที่บอกว่า "ไม่แสดงไฟล์รายงาน" ต้องหายไป — มันขัดกับสิ่งที่หน้าจอทำแล้ว', () => {
        expect(deriveLabAssurance(lotWithCoa, true).noteTH).not.toMatch(/ไม่แสดง.*ไฟล์รายงาน/);
    });
});
