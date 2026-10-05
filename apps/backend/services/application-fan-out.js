'use strict';
/**
 * ยื่นครั้งเดียว ติ๊ก N รูปแบบ → **N เคส** เลขอิสระ ผูกกันด้วย bundle
 *
 * operator 2026-09-11: *"ขอเป็น 3 รูปแบบ > คนส่งคิวงานต้องเห็นเอกสาร 3 ชุด ไม่ใช่ 1 ชุด
 * รวม 3 รูปแบบ (เลขงาน เลขเคส หรือเลข ticket ต้องไม่เหมือนกัน)"* และ *"กรมต้องออก
 * [ใบรับรอง]ตามจำนวนรูปแบบการขอ"*
 *
 * ═══ bundle คือตัวผูก ไม่ใช่หน่วยคิดเงิน ═══
 * `ApplicationBundle` มีอยู่แล้ว แต่ประตู `POST /bundles/:id/submit` พาสมาชิกทุกใบไป
 * หยุดที่ `SUBMITTED` เฉย ๆ ไม่ออกใบเสนอราคา ไม่ไป `PENDING_DOC_FEE` · คอมเมนต์เดิม
 * อธิบายว่า "a bundle bills once, not per member" — แต่ **ไม่มีโค้ดคิดเงินระดับ bundle
 * อยู่จริงเลย** มีแต่ `pricingPreview` ที่ไม่ถูกบันทึก ⇒ สมาชิก bundle จ่ายเงินไม่ได้
 *
 * operator สั่งเมื่อ 2026-09-11 ว่าทั้งสองงวดต้องเรียกเก็บรายเคส เพราะสาย
 * ใบเสนอราคา → ใบแจ้งหนี้ → ใบเสร็จ ของงวด 1 ต้องแนบกับของงวด 2 ได้ในเคสเดียวกัน
 * ⇒ ที่นี่ผูก `bundleId` ไว้เพื่อให้ทุกหน้าจอเห็นว่ามาจากการยื่นครั้งเดียว **เท่านั้น**
 * แต่ละเคสเดินเส้นทางคิดเงินของตัวเองตามปกติ
 *
 * ═══ ร่างเดิมกลายเป็นเคสหนึ่ง ไม่ใช่ถูกทิ้ง ═══
 * ผู้ยื่นกรอกมาทั้งใบแล้ว · การสร้างเคสใหม่ N ใบแล้วทิ้งร่างเดิมจะทำให้ id ที่ผู้ยื่น
 * (และลิงก์ที่เขาอาจบุ๊กมาร์กไว้) ชี้ไปที่แถวที่ถูกทิ้ง · ร่างเดิมจึงกลายเป็นเคสแรก
 * และถูกหด `areaTypes` ให้เหลือรูปแบบเดียว
 */

const { AREA_TYPES, AREA_TYPE_LABEL_TH } = require('../validation/canonical-application-validator');
const { localYear } = require('../utils/working-days');

const FAN_OUT_NO_AREA_TYPE = 'FAN_OUT_NO_AREA_TYPE';
const FAN_OUT_BAD_AREA_TYPE = 'FAN_OUT_BAD_AREA_TYPE';

const labelTh = (w) => AREA_TYPE_LABEL_TH[w] || w;
const asWord = (v) => String(v ?? '').trim().toUpperCase();
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function refuse(code, messageTh, statusCode = 422) {
    return Object.assign(new Error(messageTh), { code, statusCode, messageTh });
}

/** เลขคำขอของเคสใหม่ — รูปเดียวกับที่ประตูสร้างร่างใช้ (application-draft-query-methods) */
async function nextApplicationNumber(client, offset) {
    const year = localYear() + 543; // Bangkok year
    const count = await client.application.count();
    const stamp = Date.now().toString(36).slice(-4).toUpperCase();
    // offset กันชนกันเองภายในรอบเดียว — count อ่านค่าเดิมจนกว่าแถวจะถูกเขียน
    return `GACP-${year}-${String(count + 1 + offset).padStart(5, '0')}-${stamp}`;
}

/**
 * สำเนากระดาษของร่างเดิมไปให้เคสที่เพิ่งเกิด — **แนบครั้งเดียว ทุกเคสถือเป็นของตัวเอง**
 * (operator 2026-09-11: "สำเนาไปทุกเคส แต่ไม่ใช่ว่าเกษตรกรอัพ 3 ชุด")
 *
 * ที่เก็บหลักของไฟล์คือ `formData.draftDocuments` (JSON) ซึ่งสำเนาไปกับ formData อยู่แล้ว
 * แต่ตาราง `application_documents` เป็นแถวจริงที่ผูกกับ `applicationId` — ตัวสแกนทุจริตและ
 * ด่านตรวจเอกสารรายช่องอ่านจากตารางนี้ ⇒ เคสที่ไม่มีแถว จะดู "ไม่มีเอกสารแนบ" ทั้งที่
 * ผู้ยื่นแนบมาแล้ว และจะถูกตีกลับด้วยเหตุที่ไม่เป็นความจริง
 *
 * สามอย่างที่ **ไม่** สำเนา และเหตุผล:
 *   • สายอัปทับ (`supersededAt`/`supersededById`) — ประวัติการอัปทับเป็นของร่างเดิม
 *     เคสพี่น้องเพิ่งเกิด ไม่เคยมีใครอัปทับอะไรในนั้น การสำเนาไปคือการแต่งประวัติที่ไม่เคยเกิด
 *     (เหตุผลเดียวกับที่ฮ็อปของเคสใหม่ไม่ยืม workflowHistory ของร่างเดิม)
 *   • `slotVersion` — เริ่มนับที่ 1 เสมอ ด้วยเหตุผลเดียวกัน
 *   • ผลการตรวจ (`verificationStatus`/`verifiedAt`) — **เคสใหม่ยังไม่เคยถูกใครตรวจ**
 *     และ operator สั่งให้แต่ละเคสตรวจแยกกันได้โดยคนละคน การสำเนาผลไปคือการตัดสินล่วงหน้า
 *
 * ไฟล์ทางกายภาพไม่ถูกทำสำเนา — ทุกแถวชี้ `fileUrl` และ hash เดิม
 */
async function copyLivePapersToCase({ client, sourceApplicationId, targetApplicationId }) {
    const live = await client.applicationDocument.findMany({
        // `supersededAt: null` ครอบทั้งใบที่ยังถือช่องอยู่ และใบที่ไม่มีช่องเลย
        // (ใบไม่มีช่องอยู่นอกสายอัปทับตั้งแต่ต้น) — คือ "กระดาษที่คำขอนี้ยืนอยู่บนมันวันนี้"
        where: { applicationId: sourceApplicationId, supersededAt: null },
    });
    if (live.length === 0) { return 0; }

    const { count } = await client.applicationDocument.createMany({
        data: live.map((doc) => ({
            applicationId: targetApplicationId,
            documentId: doc.documentId,
            slotId: doc.slotId,
            stepKey: doc.stepKey,
            documentType: doc.documentType,
            issuedDate: doc.issuedDate,
            fileName: doc.fileName,
            fileUrl: doc.fileUrl,
            fileSize: doc.fileSize,
            mimeType: doc.mimeType,
            fileHash: doc.fileHash,
            photoHash: doc.photoHash,
            idNumber: doc.idNumber,
            uploadedBy: doc.uploadedBy,
            // ช่องเดียวกันแต่คนละคำขอ ⇒ @@unique([applicationId, currentForSlot]) ไม่ชนกัน
            currentForSlot: doc.currentForSlot,
            slotVersion: 1,
            // เขียนเป็น null อย่างชัดเจน ไม่ปล่อยให้เป็นค่าโดยปริยาย — สามบรรทัดนี้คือ
            // ข้อความว่า "เคสนี้ยังไม่เคยถูกอัปทับ และยังไม่เคยถูกใครตรวจ"
            supersededAt: null,
            supersededById: null,
            verificationStatus: null,
            verifiedAt: null,
        })),
    });
    return count;
}

/** formData ของเคสหนึ่ง — เหมือนต้นฉบับทุกอย่าง ยกเว้นถือลักษณะพื้นที่แบบเดียว */
function formDataForCase(sourceFormData, areaType) {
    const formData = asObject(sourceFormData);
    return {
        ...formData,
        farmData: { ...asObject(formData.farmData), areaTypes: [areaType] },
    };
}

/**
 * @param {{draft: object, client: object}} args
 * @returns {Promise<{cases: object[], bundleId: string|null}>}
 */
async function fanOutByAreaType({ draft, client } = {}) {
    if (!draft) { throw new TypeError('fanOutByAreaType: draft required'); }
    if (!client) { throw new Error('fanOutByAreaType: prisma client unavailable'); }

    // ร่างที่ถูกแตกไปแล้วคือสมาชิกของ bundle · การแตกซ้ำจะสร้างพี่น้องรอบสอง
    // ที่ไม่มีใครขอ และไม่มีทางรู้ว่าใบไหนคือของจริง
    if (draft.bundleId) {
        return { cases: [draft], bundleId: draft.bundleId };
    }

    const ticks = Array.isArray(asObject(draft.formData).farmData?.areaTypes)
        ? asObject(draft.formData).farmData.areaTypes.map(asWord).filter(Boolean)
        : [];

    if (ticks.length === 0) {
        throw refuse(
            FAN_OUT_NO_AREA_TYPE,
            'คำขอนี้ยังไม่ได้เลือกลักษณะพื้นที่ปลูก จึงยังแยกเป็นเคสไม่ได้',
        );
    }

    const unknown = ticks.filter((w) => !AREA_TYPES.includes(w));
    if (unknown.length > 0) {
        throw refuse(
            FAN_OUT_BAD_AREA_TYPE,
            `"${unknown[0]}" ไม่ใช่ลักษณะพื้นที่ที่ระบบรู้จัก — มีสามแบบ: `
            + AREA_TYPES.map(labelTh).join(' / '),
        );
    }
    if (new Set(ticks).size !== ticks.length) {
        throw refuse(FAN_OUT_BAD_AREA_TYPE, 'ลักษณะพื้นที่ซ้ำกัน — แต่ละข้อเลือกได้ครั้งเดียว');
    }

    // ลำดับจากทะเบียน ไม่ใช่ลำดับที่ผู้ยื่นคลิก — การยื่นเดียวกันต้องได้เคสเรียงเหมือนกันเสมอ
    const ordered = AREA_TYPES.filter((w) => ticks.includes(w));

    // ── ติ๊กเดียว: ไม่แตก และไม่สร้าง bundle ────────────────────────────────
    // bundle ของหนึ่งใบคือเสียงรบกวน: ทุกหน้าจอจะต้องคอยถามว่า "ใบนี้มีพี่น้องไหม"
    // แล้วได้คำตอบว่าไม่มี ตลอดไป
    if (ordered.length === 1) {
        const updated = await client.application.update({
            where: { id: draft.id },
            data: {
                areaType: ordered[0],
                cultivationScopeCount: 1,
                formData: formDataForCase(draft.formData, ordered[0]),
            },
        });
        return { cases: [updated], bundleId: null };
    }

    const bundle = await client.applicationBundle.create({
        data: {
            bundleNumber: `BND-${Date.now().toString(36).toUpperCase()}`,
            healthId: draft.healthId,
            status: 'DRAFT',
            organizationId: draft.organizationId,
        },
    });

    const cases = [];

    // เคสแรก = ร่างเดิม · หด areaTypes ให้เหลือรูปแบบเดียว และผูกเข้า bundle
    cases.push(await client.application.update({
        where: { id: draft.id },
        data: {
            bundleId: bundle.id,
            areaType: ordered[0],
            cultivationScopeCount: 1,
            formData: formDataForCase(draft.formData, ordered[0]),
        },
    }));

    // ที่เหลือ = คำขอใหม่ เลขของตัวเอง เอกสารและคำตอบชุดเดียวกัน
    for (let i = 1; i < ordered.length; i += 1) {
        const areaType = ordered[i];
        // eslint-disable-next-line no-await-in-loop
        const applicationNumber = await nextApplicationNumber(client, i - 1);
        // eslint-disable-next-line no-await-in-loop
        const sibling = await client.application.create({
            data: {
                applicationNumber,
                healthId: draft.healthId,
                entityId: draft.entityId ?? null,
                organizationId: draft.organizationId,
                serviceType: draft.serviceType,
                status: 'DRAFT',
                bundleId: bundle.id,
                areaType,
                cultivationScopeCount: 1,
                formData: formDataForCase(draft.formData, areaType),
            },
        });
        // eslint-disable-next-line no-await-in-loop
        await copyLivePapersToCase({
            client,
            sourceApplicationId: draft.id,
            targetApplicationId: sibling.id,
        });
        cases.push(sibling);
    }

    return { cases, bundleId: bundle.id };
}

module.exports = {
    fanOutByAreaType,
    copyLivePapersToCase,
    FAN_OUT_NO_AREA_TYPE,
    FAN_OUT_BAD_AREA_TYPE,
};
