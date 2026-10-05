/**
 * ติ๊กสามรูปแบบ = สามเคส ไม่ใช่คำขอเดียวที่เขียนว่าสามรูปแบบ
 *
 * operator 2026-09-11: *"ขอเป็น 3 รูปแบบ > คนส่งคิวงานต้องเห็นเอกสาร 3 ชุด ไม่ใช่ 1 ชุด
 * รวม 3 รูปแบบ (หมายความว่าเลขงาน เลขเคส หรือเลข ticket ต้องไม่เหมือนกัน)"*
 * และ *"กรมต้องออก[ใบรับรอง]ตามจำนวนรูปแบบการขอ"*
 *
 * ═══ ทำไมต้องแตกที่ประตูยื่น ไม่ใช่ให้ผู้ยื่นสร้างเอง ═══
 * `ApplicationBundle` มีอยู่แล้วและใช้งานได้ แต่วันนี้ผู้ยื่นต้องสร้างร่างเองทีละใบแล้ว
 * ผูกเข้า bundle เอง · operator ต้องการให้กรอกครั้งเดียว แนบเอกสารครั้งเดียว แล้วระบบแตกให้
 *
 * ═══ ที่วัดได้ก่อนเขียนใบนี้ และเป็นเหตุผลที่ไม่ใช้ประตู submit ของ bundle ═══
 * `POST /bundles/:id/submit` พาสมาชิกทุกใบไปหยุดที่ `SUBMITTED` เฉย ๆ — ไม่ออกใบเสนอราคา
 * ไม่ไป `PENDING_DOC_FEE` · คอมเมนต์ใน applications.js:922 อธิบายว่า "a bundle bills once,
 * not per member" แต่ **ไม่มีโค้ดคิดเงินระดับ bundle อยู่จริงเลย** — มีแต่ `pricingPreview`
 * ที่เป็นตัวเลขแสดงผลและไม่ถูกบันทึก ⇒ สมาชิก bundle จ่ายเงินไม่ได้
 *
 * operator กลับมติเรื่องนี้เมื่อ 2026-09-11: *"แก้ไขเป็นจ่ายเงิน 3 ใบครับ เพราะ 3 ยอดรวมกัน
 * มันจะกระทบยอดกันยาก ระหว่างงวด 1 และงวด 2"* ⇒ แต่ละเคสต้องมีใบของตัวเองทั้งสองงวด
 * `bundleId` จึงถูกใช้เป็น **ตัวผูกให้เห็นว่ามาจากการยื่นครั้งเดียว** เท่านั้น
 * ไม่ใช่หน่วยคิดเงิน
 */

'use strict';

const {
    fanOutByAreaType,
    FAN_OUT_NO_AREA_TYPE,
    FAN_OUT_BAD_AREA_TYPE,
} = require('../../services/application-fan-out');

const DRAFT_ID = 'draft-1';

function makeDraft(areaTypes, over = {}) {
    return {
        id: DRAFT_ID,
        applicationNumber: 'GACP-2569-00001-ABCD',
        healthId: 'health-1',
        entityId: 'entity-1',
        organizationId: 'org-1',
        status: 'DRAFT',
        serviceType: 'new_application',
        areaType: 'OUTDOOR',
        bundleId: null,
        formData: {
            plantId: 'cannabis',
            farmData: { areaTypes, farmName: 'สวนทดสอบ' },
            documents: { land_title: { fileId: 'f-1' } },
        },
        ...over,
    };
}

/** prisma ปลอมที่จำแถวไว้ พอสำหรับตรึงกติกา ไม่ต้องมีฐานจริง */
function fakePrisma(draft) {
    const apps = [{ ...draft }];
    const bundles = [];
    let seq = 1;
    return {
        _apps: apps,
        _bundles: bundles,
        application: {
            count: async () => apps.length,
            findFirst: async ({ where }) => apps.find((a) => a.id === where.id) || null,
            create: async ({ data }) => { const row = { id: `sib-${seq++}`, ...data }; apps.push(row); return row; },
            update: async ({ where, data }) => {
                const row = apps.find((a) => a.id === where.id);
                Object.assign(row, data);
                return { ...row };
            },
        },
        applicationBundle: {
            create: async ({ data }) => { const row = { id: `bundle-${seq++}`, ...data }; bundles.push(row); return row; },
        },
        // ตั้งแต่ 2026-09-11 ตัวแตกเคสสำเนาแถว application_documents ไปให้เคสพี่น้องด้วย
        // ร่างในชุดนี้ไม่มีแถวเอกสารเลย ⇒ ไม่มีอะไรให้สำเนา · กติกาการสำเนาเองถูกตรึงไว้ที่
        // __tests__/unit/fan-out-copies-the-papers-to-every-case.test.js
        applicationDocument: {
            findMany: async () => [],
            createMany: async ({ data }) => ({ count: data.length }),
        },
    };
}

const run = (areaTypes, over) => {
    const draft = makeDraft(areaTypes, over);
    const prisma = fakePrisma(draft);
    return fanOutByAreaType({ draft, client: prisma }).then((r) => ({ ...r, prisma }));
};

describe('ติ๊กเดียว — ไม่แตก และไม่สร้าง bundle', () => {
    it('คืนคำขอเดิมใบเดียว', async () => {
        const { cases, bundleId, prisma } = await run(['INDOOR']);
        expect(cases).toHaveLength(1);
        expect(cases[0].id).toBe(DRAFT_ID);
        expect(bundleId).toBeNull();
        // bundle ของหนึ่งใบคือเสียงรบกวน — ทุกหน้าจอจะต้องคอยถามว่า "มีพี่น้องไหม" โดยเปล่าประโยชน์
        expect(prisma._bundles).toHaveLength(0);
    });

    it('คำขอเดิมยังถือลักษณะที่ติ๊กไว้', async () => {
        const { cases } = await run(['INDOOR']);
        expect(cases[0].formData.farmData.areaTypes).toEqual(['INDOOR']);
    });
});

describe('ติ๊กสามรูปแบบ — สามเคส', () => {
    it('ได้สามคำขอ', async () => {
        const { cases } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(cases).toHaveLength(3);
    });

    it('เคสละหนึ่งรูปแบบ ไม่ใช่เคสที่ถือสามรูปแบบ', async () => {
        const { cases } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(cases.map((c) => c.formData.farmData.areaTypes)).toEqual([
            ['OUTDOOR'], ['GREENHOUSE'], ['INDOOR'],
        ]);
    });

    it('เลขคำขอไม่ซ้ำกันสักใบ — operator: "เลขเคสต้องไม่เหมือนกัน"', async () => {
        const { cases } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        const numbers = cases.map((c) => c.applicationNumber);
        expect(new Set(numbers).size).toBe(3);
        expect(numbers.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
    });

    it('ร่างเดิมกลายเป็นเคสหนึ่ง — งานที่ผู้ยื่นกรอกไว้ไม่ถูกทิ้ง', async () => {
        const { cases } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(cases.map((c) => c.id)).toContain(DRAFT_ID);
    });

    it('ทุกเคสผูกด้วย bundleId เดียวกัน', async () => {
        const { cases, bundleId } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(bundleId).toBeTruthy();
        expect(cases.every((c) => c.bundleId === bundleId)).toBe(true);
    });

    it('เอกสารที่แนบครั้งเดียว ตามไปทุกเคส — operator: "ไม่ใช่ว่าเกษตรกรอัพ 3 ชุด"', async () => {
        const { cases } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(cases.every((c) => c.formData.documents?.land_title?.fileId === 'f-1')).toBe(true);
    });

    it('คอลัมน์ค่าเดียวของแต่ละเคสตรงกับรูปแบบของมันเอง', async () => {
        const { cases } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(cases.map((c) => c.areaType)).toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
    });

    it('แต่ละเคสคิดเงินหนึ่งรูปแบบ ไม่ใช่สาม', async () => {
        const { cases } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(cases.every((c) => c.cultivationScopeCount === 1)).toBe(true);
    });
});

describe('สิ่งที่ต้องปฏิเสธ', () => {
    it('ไม่ติ๊กเลย', async () => {
        await expect(run([])).rejects.toMatchObject({ code: FAN_OUT_NO_AREA_TYPE });
    });

    it('คำนอกทะเบียนสามคำ', async () => {
        await expect(run(['ROOFTOP'])).rejects.toMatchObject({ code: FAN_OUT_BAD_AREA_TYPE });
        await expect(run(['OTHER'])).rejects.toMatchObject({ code: FAN_OUT_BAD_AREA_TYPE });
    });

    it('คำซ้ำ', async () => {
        await expect(run(['OUTDOOR', 'outdoor'])).rejects.toMatchObject({ code: FAN_OUT_BAD_AREA_TYPE });
    });
});

describe('เรียกซ้ำไม่แตกเพิ่ม', () => {
    it('ร่างที่ถูกแตกไปแล้ว (มี bundleId) คืนตัวเองใบเดียว ไม่สร้างพี่น้องรอบสอง', async () => {
        const draft = makeDraft(['OUTDOOR'], { bundleId: 'bundle-existing' });
        const prisma = fakePrisma(draft);
        const r = await fanOutByAreaType({ draft, client: prisma });
        expect(r.cases).toHaveLength(1);
        expect(prisma._bundles).toHaveLength(0);
        expect(r.bundleId).toBe('bundle-existing');
    });
});
