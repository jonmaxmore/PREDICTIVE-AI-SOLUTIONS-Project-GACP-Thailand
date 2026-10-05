'use strict';

/**
 * เรียกคืนล็อต (recall) — ช่องว่างข้อ 2 ของรายงาน 5 ฝ่าย (operator: "ผมเห็นด้วยครับ")
 *
 * ก่อนหน้านี้: ถ้าแล็บพบการปนเปื้อนหลังของออกจากฟาร์ม ระบบไม่มีคำให้พูด —
 * Lot.status มีแค่ CREATED/PACKAGED/TESTED/SHIPPED และหน้าสแกนสาธารณะจะประกาศ
 * "ใบรับรอง valid" ให้ผู้ถือถุงต่อไปเรื่อย ๆ · การเพิกถอนใบรับรองทั้งใบกว้างเกิน:
 * มันลงโทษทุกล็อตของฟาร์ม ขณะที่ปัญหาอยู่ที่รุ่นเดียว
 *
 * ออกแบบตามประตูเพิกถอนใบรับรอง (admin/certificates.js) ที่พิสูจน์แล้ว:
 *   - เหตุผลบังคับ · ผู้กระทำถูกจดใน AuditLog (เหตุผลเต็มอยู่ที่นั่น ไม่ใช่บนหน้า
 *     สาธารณะ — คนถือถุงต้องรู้ว่า "ห้ามบริโภค ติดต่อผู้ขาย" ไม่ใช่รายละเอียดสอบสวน)
 *   - ทางเดียว: ปลด recall = การประกาศว่าของปลอดภัยอีกครั้ง ซึ่งเป็นمตินโยบาย
 *     ไม่ใช่ปุ่ม — ยังไม่มีจนกว่า operator จะสั่ง
 *   - สถานะเก่าเก็บไว้ใน AuditLog metadata เพื่อการสอบย้อน
 *
 * ไม่ต้อง migrate: `Lot.status` เป็น String ในสคีมา ค่าใหม่ 'RECALLED' จึงเป็น
 * ข้อมูล ไม่ใช่โครงสร้าง — แบบเดียวกับที่ TESTED/SHIPPED เป็นอยู่
 *
 * @module services/lot-recall-service
 */

const { prisma } = require('./prisma-database');

const RECALLED_STATUS = 'RECALLED';

/** ข้อความที่หน้าสแกนสาธารณะพูดกับผู้ถือถุงของล็อตที่ถูกเรียกคืน */
const RECALL_PUBLIC_MESSAGE_TH = 'ล็อตนี้อยู่ระหว่างการเรียกคืน กรุณางดบริโภคหรือใช้ผลิตภัณฑ์ '
    + 'และติดต่อผู้จำหน่ายหรือฟาร์มผู้ผลิตเพื่อส่งคืนสินค้า';

/**
 * @param {string} lotId
 * @param {object} args
 * @param {string} args.reason   เหตุผล (บังคับ — ไปอยู่ใน AuditLog ของผู้เรียก)
 * @param {string} args.actorId
 * @returns {Promise<{lot: object, previousStatus: string}>}
 * @throws {Error & {code: 'LOT_NOT_FOUND'|'LOT_ALREADY_RECALLED'|'RECALL_REASON_REQUIRED'}}
 */
async function recallLot(lotId, { reason, actorId } = {}) {
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason) {
        throw Object.assign(new Error('a recall must say why'), {
            code: 'RECALL_REASON_REQUIRED', statusCode: 400,
            messageTh: 'กรุณาระบุเหตุผลการเรียกคืน',
        });
    }
    const lot = await prisma.lot.findUnique({
        where: { id: String(lotId || '').trim() },
        select: { id: true, lotNumber: true, status: true, batchId: true, organizationId: true },
    });
    if (!lot) {
        throw Object.assign(new Error(`lot ${lotId} not found`), {
            code: 'LOT_NOT_FOUND', statusCode: 404, messageTh: 'ไม่พบล็อตนี้',
        });
    }
    if (lot.status === RECALLED_STATUS) {
        // ซ้ำ = คำถามว่าระบบรู้แล้วหรือยัง ไม่ใช่ความผิด — แต่ตอบตามจริงว่าเรียกไปแล้ว
        throw Object.assign(new Error(`lot ${lot.lotNumber} is already recalled`), {
            code: 'LOT_ALREADY_RECALLED', statusCode: 409,
            messageTh: `ล็อต ${lot.lotNumber} ถูกเรียกคืนไปแล้ว`,
        });
    }

    const updated = await prisma.lot.update({
        where: { id: lot.id },
        data: { status: RECALLED_STATUS },
    });
    return { lot: updated, previousStatus: lot.status, actorId: actorId || null };
}

/** คำที่หน้าสแกนใช้ตัดสินว่าล็อตนี้ถูกเรียกคืน — ที่เดียว ทุกประตูถามที่นี่ */
function isRecalled(lot) {
    return String(lot?.status || '').toUpperCase() === RECALLED_STATUS;
}

module.exports = { recallLot, isRecalled, RECALLED_STATUS, RECALL_PUBLIC_MESSAGE_TH };
