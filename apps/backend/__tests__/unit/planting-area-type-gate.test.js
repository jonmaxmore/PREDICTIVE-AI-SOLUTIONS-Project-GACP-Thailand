'use strict';
/**
 * เปิดรอบปลูกได้เฉพาะบนแปลงที่อยู่ในขอบเขตของใบรับรอง
 *
 * operator 2026-09-10: การจ่ายเงินคิดตามรูปแบบการปลูกที่ขอมา และการบันทึกฟาร์มก็ต้อง
 * ตามรูปแบบที่ขอมา
 *
 * ช่องที่ปิด: assertPlotWithinCertifiedScope กั้นการ **สร้างแปลง** อยู่แล้ว แต่แปลงที่เกิด
 * ก่อนใบรับรองไม่เคยผ่านด่านนั้น ⇒ ยังเปิดรอบปลูกบนแปลงนอกขอบเขตได้
 *
 * โมดูลนี้ไม่ตีความ "ลักษณะพื้นที่" เอง — เรียก certifiedAreaTypes ตัวเดียวกับที่ requirement
 * lens และด่านสร้างแปลงใช้ · เทสจึง mock ตัวนั้น เพื่อพิสูจน์ว่าโมดูล **เชื่อฟัง** มันจริง
 */

jest.mock('../../services/certified-scope', () => ({ certifiedAreaTypes: jest.fn() }));
const { certifiedAreaTypes } = require('../../services/certified-scope');
const {
    checkPlotsAgainstCertifiedScope, labelTh, plotAreaType,
} = require('../../services/planting-area-type-gate');

const scope = (areaTypes, certificateNumber = 'GACP-TH-2569-TEST') =>
    certifiedAreaTypes.mockResolvedValue({ areaTypes, certificateNumber, applicationId: 'app-1' });
const plot = (id, name, solarSystem) => ({ id, name, solarSystem });

beforeEach(() => certifiedAreaTypes.mockReset());

describe('ขอบเขตมาจาก certifiedAreaTypes ตัวเดียว', () => {
    test('ถามด้วย farmId ที่ได้รับมา ไม่ตีความเอง', async () => {
        scope(['OUTDOOR']);
        await checkPlotsAgainstCertifiedScope({ farmId: 'farm-9', plots: [] });
        expect(certifiedAreaTypes).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-9' }));
    });
});

describe('ด่านเปิดรอบปลูก', () => {
    test('แปลงอยู่ในขอบเขต — ผ่าน', async () => {
        scope(['OUTDOOR']);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('p1', 'แปลงเหนือ', 'OUTDOOR'), plot('p2', 'แปลงใต้', 'OUTDOOR')],
        });
        expect(r.allowed).toBe(true);
        expect(r.blocked).toEqual([]);
    });

    test('ใบรับรองครอบคลุมกลางแจ้ง แต่เลือกแปลงโรงเรือน — ถูกปฏิเสธ', async () => {
        scope(['OUTDOOR']);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('p1', 'แปลงเหนือ', 'OUTDOOR'), plot('g1', 'โรงเรือน A', 'GREENHOUSE')],
        });
        expect(r.allowed).toBe(false);
        expect(r.code).toBe('PLOT_OUTSIDE_CERTIFIED_SCOPE');
        expect(r.blocked.map((b) => b.plotId)).toEqual(['g1']);
    });

    test('ข้อความบอกครบ: แปลงไหน · ใบรับรองครอบคลุมอะไร · ต้องทำอะไรต่อ', async () => {
        scope(['OUTDOOR'], 'GACP-TH-2569-ABC123');
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('g1', 'โรงเรือน A', 'GREENHOUSE')],
        });
        expect(r.reasonTh).toContain('โรงเรือน A');
        expect(r.reasonTh).toContain('กลางแจ้ง');
        expect(r.reasonTh).toContain('GACP-TH-2569-ABC123');
        expect(r.reasonTh).toContain('ยื่นคำขอเพิ่มรูปแบบการปลูก');
        expect(r.reasonTh).not.toMatch(/GREENHOUSE|OUTDOOR|_[A-Z]/);
    });

    test('แต่ละแปลงที่ติดด่านมีเหตุผลของตัวเอง — หน้าจอทำให้จางพร้อมบอกเหตุ ไม่ใช่ซ่อน', async () => {
        scope(['OUTDOOR']);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('i1', 'ห้องปลูก 1', 'INDOOR')],
        });
        expect(r.blocked[0]).toMatchObject({ plotId: 'i1', plotName: 'ห้องปลูก 1', areaType: 'INDOOR' });
        expect(r.blocked[0].reasonTh).toContain('อาคารระบบปิด');
    });

    test('ใบรับรองครอบคลุม 3 รูปแบบ — เลือกแปลงแบบไหนก็ได้', async () => {
        scope(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1',
            plots: [plot('p1', 'แปลงเหนือ', 'OUTDOOR'), plot('g1', 'โรงเรือน A', 'GREENHOUSE'), plot('i1', 'ห้องปลูก 1', 'INDOOR')],
        });
        expect(r.allowed).toBe(true);
    });

    test('INDOOR_CONTROLLED นับเป็น INDOOR — คำเดียวกันคนละสะกด', async () => {
        scope(['INDOOR']);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('i1', 'ห้องปลูก 1', 'INDOOR_CONTROLLED')],
        });
        expect(r.allowed).toBe(true);
    });
});

describe('เคสที่ต้องไม่กั้น — ด่านกั้นความขัดแย้งที่พิสูจน์ได้ ไม่ใช่กั้นข้อมูลที่ขาด', () => {
    test('ฟาร์มยังไม่มีใบรับรอง (null) — เงียบ · ด่าน "ต้องมีใบก่อนปลูก" เป็นคนละด่าน', async () => {
        scope(null, null);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('g1', 'โรงเรือน A', 'GREENHOUSE')],
        });
        expect(r.allowed).toBe(true);
        expect(r.certified).toBeNull();
    });

    test('มีใบรับรอง แต่คำขอต้นทางไม่เคยระบุลักษณะพื้นที่ (ลิสต์ว่าง) — ไม่เดา ไม่ล็อก', async () => {
        // วัดจริง 2026-09-10: 3 ใบบน demo มี farmData.areaTypes = null
        scope([]);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('g1', 'โรงเรือน A', 'GREENHOUSE')],
        });
        expect(r.allowed).toBe(true);
        expect(r.certified).toEqual([]);
    });

    test('แปลงที่ไม่บอกลักษณะของตัวเอง — ไม่ถูกกั้น', async () => {
        scope(['OUTDOOR']);
        const r = await checkPlotsAgainstCertifiedScope({
            farmId: 'f1', plots: [plot('x1', 'แปลงไม่ระบุ', null)],
        });
        expect(r.allowed).toBe(true);
    });
});

describe('ป้ายไทยและการอ่านลักษณะแปลง', () => {
    test.each([['OUTDOOR', 'กลางแจ้ง'], ['GREENHOUSE', 'โรงเรือน'], ['INDOOR', 'อาคารระบบปิด']])(
        '%s → %s', (word, th) => { expect(labelTh(word)).toBe(th); });

    test('คำที่ไม่รู้จัก ไม่คืนค่าว่าง', () => {
        expect(labelTh('')).toBe('ไม่ระบุ');
        expect(labelTh('AQUAPONIC')).toBe('AQUAPONIC');
    });

    test('อ่านจาก solarSystem ก่อน แล้วจึง cultivationMethod ชื่อเก่า', () => {
        expect(plotAreaType({ solarSystem: 'greenhouse' })).toBe('GREENHOUSE');
        expect(plotAreaType({ cultivationMethod: 'indoor' })).toBe('INDOOR');
        expect(plotAreaType({})).toBe('');
    });
});
