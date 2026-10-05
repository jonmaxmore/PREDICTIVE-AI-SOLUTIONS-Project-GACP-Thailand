'use strict';
/**
 * แนบครั้งเดียว → ทุกเคสถือกระดาษชุดนั้นเป็นของตัวเอง
 *
 * operator 2026-09-11: *"สำเนาไปทุกเคส แต่ไม่ใช่ว่าเกษตรกรอัพ 3 ชุด"*
 *
 * ═══ ทำไมสำเนา `formData` อย่างเดียวไม่พอ ═══
 * ที่เก็บหลักของไฟล์ที่อัปโหลดคือ `Application.formData.draftDocuments` (JSON) ซึ่ง
 * ตัวแตกเคสสำเนาไปให้ทุกเคสอยู่แล้วโดยปริยาย · แต่ตาราง `application_documents` เป็น
 * แถวจริงที่ผูกกับ `applicationId` และมี `@@unique([applicationId, currentForSlot])`
 * ⇒ เคสพี่น้องที่เพิ่งถูกสร้าง **ไม่มีแถวเลย**
 *
 * ใครอ่านตารางนั้น: ตัวสแกนทุจริต และด่านตรวจเอกสารรายช่องของเจ้าหน้าที่ ⇒ ถ้าไม่สำเนา
 * เคสที่ 2 และ 3 จะดู "ไม่มีเอกสารแนบ" ทั้งที่ผู้ยื่นแนบมาแล้ว — และนั่นคือเคสที่จะถูก
 * ตีกลับด้วยเหตุที่ไม่เป็นความจริง
 *
 * ═══ สำเนาเฉพาะใบที่ยังมีผล ไม่ใช่ทั้งประวัติ ═══
 * ช่องหนึ่งอัปทับได้หลายรอบ แถวเก่าถูกทำเครื่องหมาย `supersededAt` ไว้ · ประวัตินั้นเป็น
 * ของร่างเดิม — เคสพี่น้องเพิ่งเกิด ไม่เคยมีใครอัปทับอะไรในนั้น การสำเนาสายอัปทับไปด้วย
 * คือการแต่งประวัติที่ไม่เคยเกิด (เหตุผลเดียวกับที่ไม่สำเนา workflowHistory)
 *
 * ไฟล์ทางกายภาพใบเดียว — ทุกแถวชี้ `fileUrl` เดิม ไม่ได้ทำสำเนาไฟล์ และไม่ได้ให้ผู้ยื่นอัปใหม่
 */

const { fanOutByAreaType } = require('../../services/application-fan-out');

const DRAFT_ID = 'draft-1';

function makeDraft(areaTypes) {
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
        formData: { plantId: 'cannabis', farmData: { areaTypes, farmName: 'สวนทดสอบ' } },
    };
}

/** แถวเอกสารของร่างเดิม: สองช่องที่ยังมีผล · หนึ่งใบที่ถูกอัปทับไปแล้ว · หนึ่งใบไม่มีช่อง */
function seedDocs() {
    return [
        {
            id: 'doc-live-1', applicationId: DRAFT_ID, documentId: 'up-1',
            slotId: 'land_title', stepKey: '3', documentType: 'LAND_TITLE',
            fileName: 'chanote.pdf', fileUrl: '/uploads/chanote.pdf', fileSize: 1024,
            mimeType: 'application/pdf', fileHash: 'hash-a', photoHash: null,
            issuedDate: new Date('2026-01-02'), uploadedBy: 'user-1',
            verificationStatus: 'PENDING', currentForSlot: 'LAND_TITLE', slotVersion: 3,
            supersededAt: null, supersededById: null,
        },
        {
            id: 'doc-live-2', applicationId: DRAFT_ID, documentId: 'up-2',
            slotId: 'id_card', stepKey: '1', documentType: 'ID_CARD',
            fileName: 'id.jpg', fileUrl: '/uploads/id.jpg', fileSize: 2048,
            mimeType: 'image/jpeg', fileHash: 'hash-b', photoHash: 'hash-b',
            issuedDate: null, uploadedBy: 'user-1',
            verificationStatus: null, currentForSlot: 'ID_CARD', slotVersion: 1,
            supersededAt: null, supersededById: null,
        },
        {
            id: 'doc-old', applicationId: DRAFT_ID, documentId: 'up-0',
            slotId: 'land_title', stepKey: '3', documentType: 'LAND_TITLE',
            fileName: 'chanote-old.pdf', fileUrl: '/uploads/chanote-old.pdf', fileSize: 999,
            mimeType: 'application/pdf', fileHash: 'hash-old', photoHash: null,
            issuedDate: null, uploadedBy: 'user-1',
            verificationStatus: null, currentForSlot: null, slotVersion: 1,
            supersededAt: new Date('2026-02-01'), supersededById: 'doc-live-1',
        },
        {
            id: 'doc-noslot', applicationId: DRAFT_ID, documentId: 'up-3',
            slotId: null, stepKey: null, documentType: 'UNKNOWN',
            fileName: 'extra.pdf', fileUrl: '/uploads/extra.pdf', fileSize: 10,
            mimeType: 'application/pdf', fileHash: 'hash-c', photoHash: null,
            issuedDate: null, uploadedBy: 'user-1',
            verificationStatus: null, currentForSlot: null, slotVersion: 1,
            supersededAt: null, supersededById: null,
        },
    ];
}

function fakePrisma(draft) {
    const apps = [{ ...draft }];
    const docs = seedDocs();
    let seq = 1;
    return {
        _apps: apps,
        _docs: docs,
        application: {
            count: async () => apps.length,
            create: async ({ data }) => { const row = { id: `sib-${seq++}`, ...data }; apps.push(row); return row; },
            update: async ({ where, data }) => {
                const row = apps.find((a) => a.id === where.id);
                Object.assign(row, data);
                return { ...row };
            },
        },
        applicationBundle: {
            create: async ({ data }) => ({ id: `bundle-${seq++}`, ...data }),
        },
        applicationDocument: {
            findMany: async ({ where }) => docs.filter((d) => {
                if (where.applicationId && d.applicationId !== where.applicationId) { return false; }
                if (where.supersededAt === null && d.supersededAt !== null) { return false; }
                return true;
            }),
            createMany: async ({ data }) => {
                data.forEach((d) => docs.push({ id: `new-${seq++}`, ...d }));
                return { count: data.length };
            },
        },
    };
}

const run = async (areaTypes) => {
    const draft = makeDraft(areaTypes);
    const prisma = fakePrisma(draft);
    const out = await fanOutByAreaType({ draft, client: prisma });
    return { ...out, prisma };
};

const docsOf = (prisma, applicationId) => prisma._docs.filter((d) => d.applicationId === applicationId);

describe('ติ๊กสามรูปแบบ — กระดาษชุดเดียวกันไปถึงทุกเคส', () => {
    it('เคสพี่น้องได้แถวเอกสารของตัวเอง ไม่ใช่ว่างเปล่า', async () => {
        const { cases, prisma } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        for (const filingCase of cases.slice(1)) {
            expect(docsOf(prisma, filingCase.id).length).toBeGreaterThan(0);
        }
    });

    it('สำเนาเฉพาะใบที่ยังมีผล — ใบที่ถูกอัปทับไปแล้วไม่ตามไป', async () => {
        const { cases, prisma } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        for (const filingCase of cases.slice(1)) {
            const copied = docsOf(prisma, filingCase.id);
            // สามใบที่ยังมีผล: land_title ปัจจุบัน · id_card · ใบที่ไม่มีช่อง
            expect(copied).toHaveLength(3);
            expect(copied.every((d) => d.supersededAt == null)).toBe(true);
            expect(copied.map((d) => d.fileUrl)).not.toContain('/uploads/chanote-old.pdf');
        }
    });

    it('ไฟล์ใบเดียว — ทุกเคสชี้ fileUrl และ hash เดิม ไม่ได้ให้ผู้ยื่นอัปใหม่', async () => {
        const { cases, prisma } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        const land = (id) => docsOf(prisma, id).find((d) => d.documentType === 'LAND_TITLE');
        for (const filingCase of cases) {
            expect(land(filingCase.id).fileUrl).toBe('/uploads/chanote.pdf');
            expect(land(filingCase.id).fileHash).toBe('hash-a');
        }
    });

    it('แถวที่สำเนาถือช่องของตัวเอง และเริ่มนับรุ่นใหม่ที่ 1', async () => {
        const { cases, prisma } = await run(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        const sibling = cases[1];
        const land = docsOf(prisma, sibling.id).find((d) => d.documentType === 'LAND_TITLE');
        // ช่องเดียวกัน เคสคนละใบ ⇒ @@unique([applicationId, currentForSlot]) ไม่ชน
        expect(land.currentForSlot).toBe('LAND_TITLE');
        // รุ่นที่ 3 เป็นประวัติของร่างเดิม เคสนี้เพิ่งเกิด ไม่เคยมีใครอัปทับอะไรในนั้น
        expect(land.slotVersion).toBe(1);
        expect(land.supersededById).toBeNull();
    });

    it('ใบที่ไม่มีช่อง ยังไม่มีช่องหลังสำเนา — สองใบแบบนี้ต้องอยู่ร่วมกันได้', async () => {
        const { cases, prisma } = await run(['OUTDOOR', 'INDOOR']);
        const noSlot = docsOf(prisma, cases[1].id).filter((d) => d.documentType === 'UNKNOWN');
        expect(noSlot).toHaveLength(1);
        expect(noSlot[0].currentForSlot).toBeNull();
    });

    it('วันที่บนกระดาษตามไปด้วย — ด่านอายุเอกสารอ่านค่านี้', async () => {
        const { cases, prisma } = await run(['OUTDOOR', 'INDOOR']);
        const land = docsOf(prisma, cases[1].id).find((d) => d.documentType === 'LAND_TITLE');
        expect(land.issuedDate).toEqual(new Date('2026-01-02'));
    });

    it('ผลการตรวจไม่ตามไป — เคสใหม่ยังไม่เคยถูกใครตรวจ', async () => {
        const { cases, prisma } = await run(['OUTDOOR', 'INDOOR']);
        const land = docsOf(prisma, cases[1].id).find((d) => d.documentType === 'LAND_TITLE');
        expect(land.verificationStatus ?? null).toBeNull();
        expect(land.verifiedAt ?? null).toBeNull();
    });
});

describe('ติ๊กเดียว — ไม่มีเคสใหม่ จึงไม่มีอะไรให้สำเนา', () => {
    it('ไม่เพิ่มแถวเอกสารเลย', async () => {
        const { prisma } = await run(['INDOOR']);
        expect(prisma._docs).toHaveLength(4);
    });
});
