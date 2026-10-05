/**
 * พ่นสารแล้วเก็บเกี่ยวทันที ระบบต้องพูดอะไรสักอย่าง
 *
 * ก่อนหน้านี้: CultivationLog รู้วันพ่น · HarvestBatch รู้วันเก็บ · ไม่มีโค้ดบรรทัดไหน
 * เอาสองวันมาเทียบกัน — เก็บเกี่ยวถัดจากวันพ่นหนึ่งวันก็เงียบ (ช่องว่าง GACP ข้อ 1,
 * รายงาน 5 ฝ่าย 2026-09-07 ซึ่ง operator ตอบ "ผมเห็นด้วยครับ")
 */
'use strict';

const { assessPreHarvestInterval, DEFAULT_PHI_DAYS } = require('../../services/planting-cycle/pre-harvest-interval');

const day = (n) => new Date(Date.UTC(2026, 8, n));
const prismaWith = (rows) => ({
    cultivationLog: { findMany: jest.fn(async () => rows) },
});

describe('การเก็บเกี่ยวหลังพ่นสาร', () => {
    it('พ่น 3 วันก่อนเก็บ → เตือน พร้อมชื่อสารและจำนวนวัน', async () => {
        const prisma = prismaWith([
            { logDate: day(4), productName: 'น้ำส้มควันไม้', logType: 'PEST_CONTROL' },
        ]);
        const out = await assessPreHarvestInterval({ prisma, cycleId: 'c1', harvestDate: day(7) });
        expect(out).not.toBeNull();
        expect(out.sprayEvents[0].daysBeforeHarvest).toBe(3);
        expect(out.messageTh).toContain('น้ำส้มควันไม้');
        expect(out.messageTh).toContain('3 วันก่อนวันเก็บเกี่ยว');
        expect(out.messageTh).toContain('ตามฉลากสาร');
    });

    it('ถามฐานข้อมูลด้วยหน้าต่างเวลา ไม่ใช่ดึงทั้งตาราง', async () => {
        const prisma = prismaWith([]);
        await assessPreHarvestInterval({ prisma, cycleId: 'c1', harvestDate: day(20) });
        const where = prisma.cultivationLog.findMany.mock.calls[0][0].where;
        expect(where.cycleId).toBe('c1');
        expect(where.logType.in).toContain('PEST_CONTROL');
        expect(where.logDate.gte).toEqual(day(20 - DEFAULT_PHI_DAYS));
        expect(where.logDate.lte).toEqual(day(20));
    });

    it('ไม่มีการพ่นในหน้าต่าง → null ไม่ใช่คำเตือนว่าง', async () => {
        const out = await assessPreHarvestInterval({ prisma: prismaWith([]), cycleId: 'c1', harvestDate: day(7) });
        expect(out).toBeNull();
    });

    it('สารที่ไม่ได้บันทึกชื่อ ก็ยังเตือนได้ — แค่ไม่อ้างชื่อ', async () => {
        const out = await assessPreHarvestInterval({
            prisma: prismaWith([{ logDate: day(6), productName: null, logType: 'WEED_CONTROL' }]),
            cycleId: 'c1', harvestDate: day(7),
        });
        expect(out.messageTh).not.toContain('(');
        expect(out.sprayEvents[0].productName).toBeNull();
    });

    it('วันเก็บเกี่ยวไม่ใช่วันที่ → null ไม่ระเบิด', async () => {
        const out = await assessPreHarvestInterval({ prisma: prismaWith([]), cycleId: 'c1', harvestDate: 'ไม่ใช่วัน' });
        expect(out).toBeNull();
    });

    it('ประตูเก็บเกี่ยวเรียกการประเมินนี้จริง และคำตอบติดไปกับผลลัพธ์', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'planting-cycle', 'harvest-capacity-operations.js'),
            'utf8',
        );
        expect(src).toContain('assessPreHarvestInterval');
        expect(src).toContain('phiWarning');
    });
});
