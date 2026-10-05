/**
 * ชื่อฟาร์มบนใบรับรองและบนหน้าสแกนสาธารณะต้องเป็นชื่อที่เกษตรกรประกาศ ไม่ใช่ชื่อที่ระบบตั้งให้
 *
 * เจอโดย operator จากภาพหน้าสแกนจริง (2026-09-07): หน้าที่ผู้ซื้อเห็นขึ้นว่า "Certified Farm"
 * ซึ่งไม่ใช่ชื่อฟาร์มไหนเลย เป็นค่าตายตัวภาษาอังกฤษใน `certificate-service.js` ที่ถูกเขียนลง
 * คอลัมน์ `Farm.farmName` ตอนออกใบรับรอง แล้วจากนั้นทุกประตู — ใบรับรอง หน้าสแกนรุ่น หน้าสแกน
 * ล็อต และ COA — ก็พิมพ์มันต่อในฐานะ "ชื่อฟาร์ม" ทั้งที่ไม่มีใครตั้งชื่อนั้น
 *
 * ไฟล์เดียวกันประกาศกฎนี้ไว้เองอยู่แล้ว บรรทัดถัดจากบั๊กสองบรรทัด (F-G4-52):
 *   "no literal stand-ins ('Unknown' / '00000') … refuses when any is blank instead of
 *    inventing a value the register would then print as fact"
 * ชื่อฟาร์มหลุดจากกฎนั้นมาตัวเดียว
 *
 * และมันคือกฎ no-hardcode ของ operator (2026-09-07, ขยายเป็นทั้งระบบ) ในรูปที่เจ็บที่สุด:
 * ค่าตายตัวที่ไม่ได้แค่ควบคุมพฤติกรรม แต่กลายเป็น "ข้อเท็จจริง" ในฐานข้อมูลของรัฐ
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SERVICE = path.join(__dirname, '..', '..', 'services', 'certificate-service.js');

describe('the platform never invents a farm name', () => {
    const source = fs.readFileSync(SERVICE, 'utf-8');

    it('has no English stand-in left in the issuance path', () => {
        // Comments may name the retired literal — that is how the fix stays legible.
        // What must be gone is the literal used as a VALUE.
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('\n')
            .filter((line) => !line.trim().startsWith('//'))
            .join('\n');
        // It may still appear ONCE, in the retired-stand-ins set, where it exists to be
        // recognised and replaced. Anywhere else — above all as a `|| 'Certified Farm'`
        // fallback — it is the bug coming back.
        expect(code).not.toMatch(/\|\|\s*['"]Certified Farm['"]/);
        expect(code).not.toMatch(/farmName:\s*['"]Certified Farm['"]/);
        const occurrences = (code.match(/['"]Certified Farm['"]/g) || []).length;
        expect(occurrences).toBe(1);
        expect(code).toMatch(/RETIRED_FARM_NAME_STAND_INS[\s\S]{0,120}Certified Farm/);
    });

    it('refuses instead — the farm name is a required fact like the address', () => {
        // The refusal must be reachable from the same place the location refusal is:
        // a filing that cannot name its farm cannot have a certificate minted for it.
        expect(source).toContain('CERTIFICATE_FARM_NAME_MISSING');
    });

    it('heals a row that still carries the literal, instead of preserving it', () => {
        // fillIfBlank would not overwrite 'Certified Farm' — it is not blank. The reuse
        // branch must treat it the way it treats a retired LOCATION stand-in: never a
        // fact, so the filing's own site name may finally name the farm.
        expect(source).toContain('RETIRED_FARM_NAME_STAND_INS');
        expect(source).toContain('isRetiredFarmNameStandIn(farm.farmName)');
    });

    it('says so in Thai, because the person who reads it files in Thai', () => {
        const idx = source.indexOf('CERTIFICATE_FARM_NAME_MISSING');
        const around = source.slice(Math.max(0, idx - 900), idx + 200);
        expect(around).toMatch(/[ก-๙]/);
    });
});
