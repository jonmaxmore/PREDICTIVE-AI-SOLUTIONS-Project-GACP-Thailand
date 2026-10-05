/**
 * ขอบข่ายที่รับรองไว้ อ่านจาก "ใบรับรอง" ไม่ใช่จาก "คำขอวันนี้" และไม่ใช่ใบล่าสุดใบเดียว
 *
 * สองข้อบกพร่องที่ไฟล์นี้ปิด วัดจากโค้ดจริงบน main 2026-09-11:
 *
 * **(1) หยิบใบล่าสุดใบเดียว** — `certified-scope.js` อ่านด้วย `findFirst` +
 * `orderBy: { createdAt: 'desc' }` · ฟาร์มที่ถือใบกลางแจ้ง (มกราคม) และใบโรงเรือน (มิถุนายน)
 * จะถูกอ่านเห็นแต่ใบมิถุนายน ⇒ **เกษตรกรเปิดรอบปลูกบนแปลงกลางแจ้งของตัวเองไม่ได้
 * ทั้งที่ถือใบรับรองกลางแจ้งที่ยังไม่หมดอายุ** · ด่านที่ปฏิเสธคนที่มีสิทธิ แย่กว่าด่านที่ไม่มี
 * เพราะเขาจะไม่รู้ว่าต้องไปแก้ที่ไหน
 *
 * **(2) อ่านขอบข่ายจากคำขอ ไม่ใช่จากใบ** — `deriveDimensions(cert.application)` แปลว่า
 * ขอบข่ายที่ "รับรองไปแล้ว" เปลี่ยนได้ทุกครั้งที่ข้อมูลคำขอเปลี่ยน · ใบรับรองเป็นบันทึกทาง
 * กฎหมายของสิ่งที่ **ตัดสินไปแล้ว ณ วันนั้น** (ISO/IEC 17065 §7.7.1(d) ให้ใบระบุ
 * "the scope of certification") — ไม่ใช่มุมมองสดของคำขอ
 *
 * ทางแก้: `CertificateScope` หนึ่งแถวต่อหนึ่งลักษณะที่ใบครอบคลุม · ระหว่างหน้าต่าง expand
 * ใบเก่าที่ยังไม่มีแถวยังตอบจากคำขอได้เหมือนเดิม (ไม่มีใบใดกลายเป็นไร้ขอบข่ายกลางทาง)
 */

'use strict';

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: {
            findMany: (...a) => mockFindMany(...a),
            findFirst: (...a) => mockFindFirst(...a),
        },
    },
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

const { certifiedAreaTypes } = require('../../services/certified-scope');

/** ใบรับรองที่ถือขอบข่ายเป็นแถวของตัวเอง (รูปหลังบ้านใหม่) */
const certWithScopes = (number, areaTypes, over = {}) => ({
    id: `cert-${number}`,
    certificateNumber: number,
    status: 'active',
    isDeleted: false,
    expiryDate: new Date('2099-01-01'),
    scopes: areaTypes.map((areaType) => ({ areaType, status: 'active' })),
    application: { id: `app-${number}`, formData: { farmData: { areaTypes: ['OUTDOOR'] } } },
    ...over,
});

/** ใบยุคก่อน expand — ยังไม่มีแถวขอบข่าย ต้องตอบจากคำขอได้เหมือนเดิม */
const legacyCert = (number, ticks) => ({
    id: `cert-${number}`,
    certificateNumber: number,
    status: 'active',
    isDeleted: false,
    expiryDate: new Date('2099-01-01'),
    scopes: [],
    application: { id: `app-${number}`, formData: { farmData: { areaTypes: ticks } } },
});

beforeEach(() => {
    mockFindMany.mockReset();
    mockFindFirst.mockReset();
});

describe('ขอบข่ายอ่านจากใบรับรอง', () => {
    it('อ่านจากแถวขอบข่ายของใบ ไม่ใช่จากคำขอที่แก้ได้ภายหลัง', async () => {
        // คำขอของใบนี้ระบุ OUTDOOR แต่ใบรับรองขอบข่าย INDOOR — ใบต้องชนะ
        mockFindMany.mockResolvedValue([certWithScopes('A', ['INDOOR'])]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.areaTypes).toEqual(['INDOOR']);
    });

    it('ถามฐานด้วย findMany — ไม่ใช่ findFirst ที่หยิบใบเดียว', async () => {
        mockFindMany.mockResolvedValue([certWithScopes('A', ['OUTDOOR'])]);
        await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(mockFindMany).toHaveBeenCalled();
        expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('ฟาร์มที่ถือสองใบ เห็นขอบข่ายรวมของทั้งสอง', async () => {
        mockFindMany.mockResolvedValue([
            certWithScopes('B', ['GREENHOUSE']),   // ใบใหม่กว่า
            certWithScopes('A', ['OUTDOOR']),      // ใบเก่ากว่า ยังไม่หมดอายุ
        ]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect([...scope.areaTypes].sort()).toEqual(['GREENHOUSE', 'OUTDOOR']);
    });

    it('แถวขอบข่ายที่ถูกลด ไม่นับ (ISO §7.11 reduction)', async () => {
        mockFindMany.mockResolvedValue([
            certWithScopes('A', ['OUTDOOR'], {
                scopes: [
                    { areaType: 'OUTDOOR', status: 'active' },
                    { areaType: 'INDOOR', status: 'reduced' },
                ],
            }),
        ]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.areaTypes).toEqual(['OUTDOOR']);
    });

    it('ไม่มีใบที่ยังมีผล = เงียบ (null) ไม่ใช่ลิสต์ว่าง — สองอย่างนี้คนละความหมาย', async () => {
        mockFindMany.mockResolvedValue([]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.areaTypes).toBeNull();
    });

    it('คำเดียวกันจากสองใบ นับครั้งเดียว', async () => {
        mockFindMany.mockResolvedValue([
            certWithScopes('A', ['OUTDOOR']),
            certWithScopes('B', ['OUTDOOR', 'INDOOR']),
        ]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect([...scope.areaTypes].sort()).toEqual(['INDOOR', 'OUTDOOR']);
    });
});

describe('หน้าต่าง expand — ใบเก่าที่ยังไม่มีแถวขอบข่าย', () => {
    it('ยังตอบจากคำขอได้เหมือนเดิม ไม่กลายเป็นใบไร้ขอบข่าย', async () => {
        mockFindMany.mockResolvedValue([legacyCert('OLD', ['GREENHOUSE'])]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.areaTypes).toEqual(['GREENHOUSE']);
    });

    it('ใบเก่ากับใบใหม่อยู่ด้วยกันได้ระหว่าง backfill', async () => {
        mockFindMany.mockResolvedValue([
            certWithScopes('NEW', ['INDOOR']),
            legacyCert('OLD', ['OUTDOOR']),
        ]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect([...scope.areaTypes].sort()).toEqual(['INDOOR', 'OUTDOOR']);
    });
});

describe('เลขใบที่คืนกลับมา', () => {
    it('ใบเดียว = เลขใบนั้น', async () => {
        mockFindMany.mockResolvedValue([certWithScopes('GACP-TH-2569-AAAAAA', ['OUTDOOR'])]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.certificateNumber).toBe('GACP-TH-2569-AAAAAA');
    });

    it('หลายใบ = เลขของใบแรกตามลำดับที่ฐานคืน และต้องไม่เป็น null', async () => {
        // ผู้เรียกใช้เลขนี้ไปประกอบข้อความปฏิเสธ — null จะทำให้ข้อความบอกไม่ได้ว่าใบไหน
        mockFindMany.mockResolvedValue([
            certWithScopes('GACP-TH-2569-BBBBBB', ['GREENHOUSE']),
            certWithScopes('GACP-TH-2569-AAAAAA', ['OUTDOOR']),
        ]);
        const scope = await certifiedAreaTypes({ farmId: 'farm-1' });
        expect(scope.certificateNumber).toBe('GACP-TH-2569-BBBBBB');
    });
});
