'use strict';

/**
 * ผลวิเคราะห์ (COA) ของรุ่นเก็บเกี่ยว — T10
 *
 * ตัดสินใจสองอย่างที่เป็นหัวใจ และเขียนไว้ตรงนี้เพราะโค้ดที่เรียกใช้จะไม่เห็นเหตุผลเอง:
 *
 * 1. **ไม่มีช่องค่าตัวเลข** — operator สั่ง "เราจะไม่ได้พิมพ์บอกค่าเท่าไหร่ เราจะอัพโหลดผลแลป"
 *    ไฟล์ COA เป็นแหล่งความจริงเดียว · ตัวเลขที่คนพิมพ์เองคือตัวเลขที่พิมพ์ผิดได้ และเมื่อมัน
 *    ขัดกับไฟล์จะไม่มีใครรู้ว่าอันไหนจริง · การตัดสินผ่าน/ไม่ผ่านเป็นของห้องปฏิบัติการ
 *    ถ้าแพลตฟอร์มสรุปเอง แพลตฟอร์มก็รับผิดชอบผลที่ตัวเองไม่ได้ตรวจ
 *
 * 2. **เพิ่มแถวเสมอ ไม่ทับ** — COA คือเอกสารที่ *มาถึงทีหลัง* ไม่ใช่การแก้สิ่งที่ประกาศไปแล้ว
 *    การเพิ่มจึงไม่ชนกับการแช่แข็ง และมติ 2026-09-05 ("ไม่มีสิทธิ์ทั้งหมด") ห้ามแก้ของที่
 *    แช่แข็งแล้ว ⇒ ได้ฉบับแก้ไขจากห้องแล็บ ให้แนบเพิ่ม ทั้งสองฉบับแสดงคู่กันพร้อมวันที่
 *
 * ออกแบบเต็ม: docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §4.5
 */

function refuse(code, messageTh, statusCode = 400) {
    const err = new Error(messageTh);
    err.code = code;
    err.statusCode = statusCode;
    err.messageTh = messageTh;
    return err;
}

/**
 * สิ่งที่ประตูต้องมีก่อนจะเขียนอะไรลงฐาน
 * @throws {Error & {code: 'LAB_FILE_REQUIRED'|'LAB_NAME_REQUIRED'}}
 */
function assertLabUploadInput({ file, labName }) {
    if (!file) {
        throw refuse('LAB_FILE_REQUIRED', 'กรุณาแนบไฟล์ผลวิเคราะห์ (COA)');
    }
    if (!String(labName || '').trim()) {
        // รายงานที่ไม่บอกว่าห้องปฏิบัติการไหนออก พิสูจน์อะไรไม่ได้ และคนสแกนตรวจย้อนไม่ได้
        throw refuse('LAB_NAME_REQUIRED', 'กรุณาระบุชื่อห้องปฏิบัติการที่ออกรายงาน');
    }
}

/** วันที่ที่อ่านไม่ได้ = ไม่มีวันที่ ไม่ใช่ Invalid Date ที่จะไปพิมพ์คำว่า Invalid ให้ผู้ใช้เห็น */
function parseReportedAt(value) {
    if (value === undefined || value === null || value === '') { return null; }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * แถวที่จะเขียนลง `batch_lab_results`
 *
 * `organizationId` มาจาก **รุ่น** ไม่ใช่จากคำขอ — ขอบเขต tenant ที่ผู้เรียกกำหนดเองได้
 * ไม่ใช่ขอบเขต
 */
function buildLabResultRow({
    batch, file, fileUrl, labName, reportNumber, reportedAt, verificationCode, uploadedBy,
}) {
    return {
        harvestBatchId: batch.id,
        organizationId: batch.organizationId,

        fileUrl,
        fileName: file?.originalname || null,
        fileSize: Number.isInteger(file?.size) ? file.size : null,
        mimeType: file?.mimetype || null,

        labName: String(labName).trim(),
        reportNumber: String(reportNumber || '').trim() || null,
        reportedAt: parseReportedAt(reportedAt),
        verificationCode: String(verificationCode || '').trim() || null,

        // จนกว่าเจ้าหน้าที่จะตรวจ คนสแกนต้องรู้ว่ากำลังดูเอกสารที่เกษตรกรเป็นคนใส่เข้ามา
        verificationStatus: 'FARMER_UPLOADED',
        uploadedBy: uploadedBy || null,
    };
}

module.exports = { assertLabUploadInput, buildLabResultRow, parseReportedAt };
