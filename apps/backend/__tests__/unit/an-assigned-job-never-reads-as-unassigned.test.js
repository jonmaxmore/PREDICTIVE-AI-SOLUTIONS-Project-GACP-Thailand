'use strict';

/**
 * งานที่มีเจ้าของ ต้องไม่ขึ้นว่า "ยังไม่มอบหมาย"
 *
 * วัดจริงบน staging 2026-09-07 · GET /api/audits/reassign/reassignable ตอบ:
 *   { "currentAuditorId": "e09508ad-be19-41b2-becc-49e483f838d1",
 *     "currentAuditor": "ยังไม่มอบหมาย" }
 * สองคีย์ขัดกันเองในแถวเดียวกัน · ผู้จัดตารางที่อ่านหน้านี้จะดึงงานจากมือผู้ตรวจที่ลงพื้นที่อยู่
 * โดยเชื่อว่าไม่มีใครถือ
 *
 * บั๊กเดียวกันอยู่สองไฟล์ — ฝั่งผู้ตรวจแปลง (audits-reassign.js:68) และฝั่งผู้ตรวจเอกสาร
 * (scheduler-reviewer-reassign-handler.js:76) — ทั้งคู่อ่านชื่อจากสำเนาใน formData แล้วตกไปที่
 * คำว่า "ยังไม่มอบหมาย" เมื่อสำเนานั้นว่าง
 */

const {
    assignedOfficerName,
    UNASSIGNED_TH,
    ASSIGNED_UNKNOWN_NAME_TH,
} = require('../../shared/assigned-officer-name');

describe('ชื่อเจ้าหน้าที่ที่ถืองาน', () => {
    it('ไม่มี id = ยังไม่มอบหมายจริง', () => {
        expect(assignedOfficerName({ officerId: null })).toBe(UNASSIGNED_TH);
        expect(assignedOfficerName({ officerId: '   ' })).toBe(UNASSIGNED_TH);
        expect(assignedOfficerName({})).toBe(UNASSIGNED_TH);
    });

    it('มีแถวผู้ใช้ = ใช้ชื่อจริงของคนนั้น', () => {
        expect(assignedOfficerName({
            officerId: 'u1', officer: { firstName: 'ตรวจแปลง', lastName: 'คิวเอ' },
        })).toBe('ตรวจแปลง คิวเอ');
    });

    it('ไม่มีแถวผู้ใช้ แต่มีสำเนาชื่อ = ใช้สำเนา', () => {
        expect(assignedOfficerName({ officerId: 'u1', storedName: 'ประสิทธิ์ ตรวจแปลง' }))
            .toBe('ประสิทธิ์ ตรวจแปลง');
    });

    it('มี id แต่ไม่รู้ชื่อเลย = บอกว่ามอบหมายแล้ว ไม่ใช่ว่ายังไม่มอบหมาย', () => {
        const name = assignedOfficerName({ officerId: 'e09508ad', officer: null, storedName: '' });
        expect(name).toBe(ASSIGNED_UNKNOWN_NAME_TH);
        expect(name).not.toBe(UNASSIGNED_TH);
    });

    it('สองหน้าจอมอบหมายงานใหม่ ใช้ตัวตัดสินตัวเดียวกัน', () => {
        const read = (rel) => require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', rel), 'utf8',
        );
        for (const file of [
            'routes/api/audit/audits-reassign.js',
            'routes/api/provider/handlers/scheduler-reviewer-reassign-handler.js',
        ]) {
            const src = read(file);
            expect(src).toContain('assignedOfficerName');
            expect(src).not.toMatch(/Name \|\| 'ยังไม่มอบหมาย'/);
        }
    });
});
