'use strict';

/**
 * หน้าจอล็อตของเกษตรกร พิมพ์ "สายพันธุ์" จากคีย์ที่ประตูไม่เคยส่งมา
 *
 * หน้าจอ (app/health/tracking/lots/client-view.tsx) อ่าน `batch.species.nameTH` ที่สามจุด
 * — แถวรุ่นเก็บเกี่ยว, แถวล็อต และหน้าต่างรายละเอียดล็อต · แต่ในสคีมา ความสัมพันธ์ของ
 * HarvestBatch ไปยัง PlantSpecies ชื่อ `plant` ไม่ใช่ `species` (harvest.prisma:31)
 * ⇒ ทั้งสามจุดขึ้น "ไม่ระบุสายพันธุ์" หรือ "-" เสมอ ทุกล็อต ทุกฟาร์ม
 *
 * ซ้ำร้ายกว่านั้น ประตูรายชื่อล็อต (listLotsByBatchId) คืนแถว Lot เปล่า ๆ ไม่ join รุ่นมาด้วย
 * จึงไม่มีทางรู้สายพันธุ์ได้เลยแม้จะอ่านคีย์ถูก · หน้าสแกนสาธารณะแสดงสายพันธุ์ได้ แต่หน้าของ
 * เกษตรกรเจ้าของล็อตเองแสดงไม่ได้
 *
 * เป็นคลาสเดียวกับ select-gap: คอลัมน์มีอยู่ คำสั่งค้นไม่เคยขอ
 */

const mockFindMany = jest.fn(async () => []);
jest.mock('../../services/prisma-database', () => ({
    prisma: { lot: { findMany: (...a) => mockFindMany(...a) } },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { listLotsByBatchId } = require('../../services/traceability-service');

describe('รายชื่อล็อตของรุ่นเก็บเกี่ยว', () => {
    beforeEach(() => { mockFindMany.mockClear(); });

    it('ขอสายพันธุ์ของรุ่นมาด้วย — ไม่ใช่คืนแถวล็อตเปล่า', async () => {
        await listLotsByBatchId('batch-1');
        const args = mockFindMany.mock.calls[0][0];
        expect(args.include?.batch).toBeTruthy();
        const batchSelect = args.include.batch.select || {};
        expect(batchSelect.plant).toBeTruthy();
    });

    it('ยังกรองแถวที่ถูกลบ และเรียงเก่าไปใหม่เหมือนเดิม', async () => {
        await listLotsByBatchId('batch-1');
        const args = mockFindMany.mock.calls[0][0];
        expect(args.where).toEqual({ batchId: 'batch-1', isDeleted: false });
        expect(args.orderBy).toEqual({ createdAt: 'asc' });
    });

    it('หน้าจอเกษตรกรอ่านคีย์ที่ประตูส่งมาจริง', () => {
        const src = require('fs').readFileSync(
            require('path').join(
                __dirname, '..', '..', '..', 'web-app', 'src', 'app', 'health', 'tracking', 'lots', 'client-view.tsx',
            ),
            'utf8',
        );
        expect(src).not.toMatch(/species\?\.nameTH/);
        expect(src).toMatch(/plant\?\.nameTH/);
    });
});
