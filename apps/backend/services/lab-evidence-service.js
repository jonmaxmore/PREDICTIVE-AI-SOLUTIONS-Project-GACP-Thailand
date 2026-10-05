'use strict';

/**
 * ผลวิเคราะห์ที่หน้าสแกนพูดถึงได้ — T11 (ล็อตสืบทอดจากรุ่น) + T13 (สองบรรทัดที่ต้องแยกขาด)
 *
 * operator สั่งสองอย่างในประโยคเดียว: "ต้องแนบเอกสารนี้ลงไปด้วย ให้เห็นว่าฟาร์มนี้มีผลตรวจ"
 * มันเป็นคำกล่าวอ้างคนละอัน และเหตุผลทั้งหมดที่โมดูลนี้มีอยู่ คือห้ามยุบสองอันนี้เป็นอันเดียว:
 *
 *     ล็อตนี้   ตรวจแล้ว / ยังไม่ได้ตรวจ + ไฟล์ ถ้ามี
 *     ฟาร์มนี้  มีผลตรวจกี่ฉบับ
 *
 * ถ้าเขียนรวมเป็นบรรทัดเดียวว่า "ฟาร์มนี้มีผลตรวจ" คนที่ถือถุงซึ่ง **ยังไม่ได้ตรวจ**
 * จะอ่านว่าถุงในมือผ่านการตรวจแล้ว — ทุกประโยคเป็นความจริงทีละประโยค แต่ผู้อ่านเข้าใจผิด
 * ซึ่งแย่กว่าการไม่บอกอะไรเลย
 *
 * **T11 — ล็อตไม่เคยมี COA ของตัวเอง** ห้องปฏิบัติการตรวจ *รุ่น* และรุ่นหนึ่งออกได้หลายล็อต
 * ล็อตจึงสืบทอด · ถ้าแนบรายล็อต จะต้องอัปโหลดไฟล์เดิมซ้ำทุกล็อต แล้ววันหนึ่งสองใบจะไม่ตรงกัน
 *
 * ออกแบบเต็ม: docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §4.5
 */

/** ฉบับที่ยังใช้ได้ เรียงใหม่สุดก่อน — ฉบับแก้ไขอยู่ข้างฉบับเดิม ไม่ได้ลบมันทิ้ง */
function liveReports(rows) {
    return (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.isDeleted !== true)
        .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

/**
 * ผลตรวจของ "ล็อตนี้" — มาจากรุ่นที่มันมา ไม่ใช่ของตัวเอง
 * `tested: false` คือคำตอบ ไม่ใช่ความว่าง: ผู้ซื้อต้องแยก "ยังไม่ได้ตรวจ" ออกจาก
 * "ระบบไม่รู้" ได้
 */
function lotLabEvidence(lot) {
    // ล็อตสืบทอดคำตอบของรุ่นมาทั้งดุ้น เปลี่ยนแค่ว่ากำลังพูดถึงอะไรอยู่
    return { ...batchLabEvidence(lot && lot.batch), subject: 'LOT' };
}

/**
 * ผลตรวจของ "รุ่นนี้" — ห้องปฏิบัติการตรวจรุ่น เอกสารจึงเป็นของรุ่นโดยตรง ไม่ได้สืบทอดมา
 * ใช้โดยประตู /api/trace/batch/:id ซึ่งเป็นการสแกน QR ของรุ่น ไม่ใช่ของถุง
 */
function batchLabEvidence(batch) {
    const reports = liveReports(batch && batch.labResults);
    return {
        subject: 'BATCH',
        tested: reports.length > 0,
        latest: reports[0] || null,
        reports,
    };
}

/** ผลตรวจของ "ฟาร์มนี้" — เป็นประวัติของฟาร์ม ไม่ใช่คำกล่าวอ้างเกี่ยวกับของที่ถืออยู่ */
function farmLabEvidence(rows) {
    const reports = liveReports(rows);
    return { subject: 'FARM', reportCount: reports.length };
}

/**
 * สิ่งที่ส่งออกหน้าสาธารณะ
 *
 * `subject` ติดไปกับทั้งสองก้อนโดยตั้งใจ: เทมเพลตที่พิมพ์ก้อนใดก้อนหนึ่งออกไปลอย ๆ
 * จะยังมีคำว่าเป็นเรื่องของ "ล็อต" หรือ "ฟาร์ม" ติดอยู่ · และ **ไม่มี** ฟิลด์บูลีนรวม
 * แบบ `hasLabResults` ให้หยิบไปใช้ผิด
 *
 * ฟิลด์ที่ปล่อยออก: ไฟล์ · ชื่อแล็บ · เลขที่รายงาน · วันที่ · รหัสตรวจสอบ · สถานะการตรวจสอบ
 * (มติ operator 2026-09-05 เปิดไฟล์ COA สู่สาธารณะ แทนที่ R9 เดิมที่เปิดแค่ "มี/ไม่มี")
 * ฟิลด์ที่ไม่ปล่อย: id ภายในทุกชนิด, harvestBatchId, organizationId, uploadedBy
 * — เป็นมือจับสำหรับไล่เดา ไม่ใช่ข้อมูลที่คนสแกนต้องใช้
 */
function toPublicReport(row) {
    if (!row) { return null; }
    return {
        fileUrl: row.fileUrl || null,
        fileName: row.fileName || null,
        labName: row.labName || null,
        reportNumber: row.reportNumber || null,
        reportedAt: row.reportedAt || null,
        verificationCode: row.verificationCode || null,
        // คนสแกนควรรู้ว่ากำลังดูเอกสารที่ใครเป็นคนใส่เข้ามา ไม่ใช่ให้เดาเอง
        verificationStatus: row.verificationStatus || 'FARMER_UPLOADED',
    };
}

function publicLabProjection({ lot, farmLabResults }) {
    return {
        lot: toPublicEvidence(lotLabEvidence(lot)),
        farm: farmLabEvidence(farmLabResults),
    };
}

/**
 * เหมือน publicLabProjection ทุกอย่าง ยกเว้นสิ่งที่มันพูดถึง — รุ่น ไม่ใช่ล็อต
 * แยกฟังก์ชันแทนที่จะรับพารามิเตอร์เพิ่ม เพราะคีย์ที่ออกไปคนละคำ ผู้เรียกจึงพลาดไม่ได้ว่า
 * กำลังตีพิมพ์คำกล่าวอ้างของอะไรอยู่
 */
function publicBatchLabProjection({ batch, farmLabResults }) {
    return {
        batch: toPublicEvidence(batchLabEvidence(batch)),
        farm: farmLabEvidence(farmLabResults),
    };
}

/** เอา row ดิบออก เหลือเฉพาะฟิลด์ที่เปิดสาธารณะได้ โดยยังคง subject ติดไว้ */
function toPublicEvidence(evidence) {
    return {
        subject: evidence.subject,
        tested: evidence.tested,
        latest: toPublicReport(evidence.latest),
        reports: evidence.reports.map(toPublicReport),
    };
}

/**
 * แถวผลตรวจของ **ฟาร์ม** เท่าที่ต้องใช้นับ — ฝั่งข้อมูลของ `farmLabEvidence`
 *
 * รับ prisma เข้ามาแทนที่จะ require เอง เพราะผู้เรียกสองเส้นถือ client คนละตัว:
 * `trace-service/common` หยิบจาก server ก่อนแล้วค่อยตกไป prisma-database ส่วน
 * `traceability-service` หยิบจาก prisma-database ตรง ๆ · ในโปรดักชันเป็นตัวเดียวกัน
 * แต่ในเทสถูก mock แยกกัน — โมดูลที่ไปหยิบ client เองจึงทำให้ mock ของผู้เรียกฝั่งหนึ่ง
 * เงียบไปเฉย ๆ (เกิดแล้วจริง 2026-09-06: reportCount ตกจาก 2 เป็น 0 โดยไม่มีใคร throw)
 *
 * คืนแค่ marker พอให้นับ: ไม่ดึงชื่อแล็บ เลขที่รายงาน หรือไฟล์ของรุ่นอื่นในฟาร์มเดียวกัน
 */
async function findFarmLabResultMarkers(prisma, farmId) {
    if (!farmId || !prisma || !prisma.batchLabResult) { return []; }
    return prisma.batchLabResult.findMany({
        where: { isDeleted: false, harvestBatch: { farmId } },
        select: { id: true, isDeleted: true, uploadedAt: true },
    });
}

module.exports = {
    lotLabEvidence, batchLabEvidence, farmLabEvidence,
    publicLabProjection, publicBatchLabProjection, toPublicReport,
    findFarmLabResultMarkers,
};
