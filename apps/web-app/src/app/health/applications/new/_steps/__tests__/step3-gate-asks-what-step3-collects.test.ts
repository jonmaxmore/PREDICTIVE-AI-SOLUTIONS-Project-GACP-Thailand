/**
 * ประตูของขั้นหนึ่ง ต้องถามสิ่งที่ขั้นนั้นเก็บ
 *
 * `isStepComplete(state, 3)` ตรวจ `farmData.farmName`, `farmData.address` และ
 * `plots.length > 0` · แต่หน้าจอขั้น 3 เขียน `siteName` กับ `siteAddress` และ **ไม่เคย
 * แตะ `plots` เลยสักครั้ง** ⇒ ขั้น 3 ทำให้ครบไม่ได้ไม่ว่าจะกรอกอย่างไร ปุ่มถัดไปดับถาวร
 * และยามเส้นทางเด้งทุกคนที่พยายามไปขั้น 4
 *
 * เป็นข้อผิดพลาดชนิดเดียวกับที่โค้ดตัวเองเตือนไว้ที่ขั้น 4: "การเรียกร้องสิ่งที่ขั้นนั้น
 * ไม่ได้เก็บอีกแล้ว คือ v1 hard-lock เป๊ะ ๆ" — มีคนเห็นชนิดนี้แล้วแก้ให้ขั้น 4 แต่ขั้น 3
 * ยังค้างอยู่
 *
 * เจอตอนเดินจริง 2026-09-06 หลังจากปลด route ที่บังขั้น 3 ออก
 */
import { describe, expect, it } from '@jest/globals';
import { step3CanProceed } from '../steps/step3-site-land-config';
import { isStepComplete } from '../hooks/use-application-flow-store';
import type { WizardState } from '../hooks/use-application-flow-store';

/** สิ่งที่ผู้ยื่นกรอกครบตามที่หน้าจอขั้น 3 ถาม (ช่องที่มีดอกจัน + คำถามที่ต้องเลือก) */
const filled = {
    siteName: 'แปลงสมุนไพรบ้านทดสอบ',
    siteAddress: '99/9 หมู่ 3',
    // กทล.๑ ส่วนที่ ๒ ข้อ ๑ — the certificate names these, so step 3 is not complete without them
    subDistrict: 'หนองหาร',
    district: 'สันทราย',
    province: 'เชียงใหม่',
    postalCode: '50210',
    landOwnership: 'OWNED',
    landDocumentDetail: { type: 'โฉนด', number: '12345', volume: '', page: '', issuedBy: '' },
    areaTypes: ['OUTDOOR'],
    areaSqm: '1600',
} as unknown as Record<string, unknown>;

const stateWith = (farmData: Record<string, unknown>) => ({
    farmData, plots: [], requestType: 'NEW', applicantType: 'INDIVIDUAL', certScope: 'PLANTING',
} as unknown as WizardState);

describe('ขั้น 3 ทำให้ครบได้ด้วยสิ่งที่ขั้น 3 ถาม', () => {
    it('กรอกครบตามที่หน้าจอถาม = ผ่าน แม้ไม่มีแถว plots สักแถว', () => {
        expect(step3CanProceed(filled)).toBe(true);
        expect(isStepComplete(stateWith(filled), 3)).toBe(true);
    });

    it('ยังไม่กรอกอะไร = ไม่ผ่าน', () => {
        expect(step3CanProceed({})).toBe(false);
    });

    it.each([['siteName'], ['siteAddress'], ['landOwnership'], ['areaSqm']])(
        'ขาด %s แล้วไม่ผ่าน',
        (key) => {
            const missing = { ...filled };
            delete missing[key];
            expect(step3CanProceed(missing)).toBe(false);
        },
    );

    // F-WALK-03: the certificate names จังหวัด/อำเภอ/ตำบล; without them a filing passes submit
    // and then cannot be certified. Step 3 must refuse to proceed until each is stated.
    it.each([['province'], ['district'], ['subDistrict']])(
        'ขาด %s (ที่ตั้งที่ใบรับรองต้องระบุ) แล้วไม่ผ่าน',
        (key) => {
            const missing = { ...filled };
            delete missing[key];
            expect(step3CanProceed(missing)).toBe(false);
        },
    );

    it('ไม่ติ๊กลักษณะพื้นที่เลย ไม่ผ่าน — สองข้อนี้ตัดสินว่าต้องแนบแบบแปลนหรือภาพถ่ายแปลง', () => {
        expect(step3CanProceed({ ...filled, areaTypes: [] })).toBe(false);
    });

    it('เอกสารสิทธิ์ต้องมีประเภทและเลขที่ ตามที่หน้าจอทำดอกจันไว้', () => {
        expect(step3CanProceed({ ...filled, landDocumentDetail: { type: 'โฉนด', number: '' } })).toBe(false);
        expect(step3CanProceed({ ...filled, landDocumentDetail: { type: '', number: '12345' } })).toBe(false);
    });

    it('เช่าที่ดินต้องระบุชื่อผู้ให้เช่า — หนังสือยินยอมต้องมีชื่อ', () => {
        const rented = { ...filled, landOwnership: 'RENTED' };
        expect(step3CanProceed(rented)).toBe(false);
        expect(step3CanProceed({ ...rented, landlordName: 'นายให้เช่า ที่ดิน' })).toBe(true);
    });

    it('ต้องติ๊กลักษณะพื้นที่อย่างน้อยหนึ่งข้อ — ไม่ติ๊กเลยไม่ใช่คำขอที่ยื่นได้', () => {
        // operator 2026-09-11: *"เราไม่มีอะไรติ๊กมาเลย ... มันไม่ถูกต้อง"*
        // ประตูยื่นปฏิเสธด้วย และข้อนี้กันไม่ให้จอปล่อยผ่านไปเจอ 422 ปลายทาง
        expect(step3CanProceed({ ...filled, areaTypes: [] })).toBe(false);
        expect(step3CanProceed({ ...filled, areaTypes: ['OUTDOOR'] })).toBe(true);
    });
});
