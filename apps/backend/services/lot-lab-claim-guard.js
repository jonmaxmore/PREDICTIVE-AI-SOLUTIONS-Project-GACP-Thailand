'use strict';

/**
 * T10b — ค่าผลตรวจแล็บไม่ใช่สิ่งที่พิมพ์เอง
 *
 * มติ operator 2026-09-05: "เราจะไม่ได้พิมพ์บอกค่าเท่าไหร่ เราจะอัพโหลดผลแลป"
 *
 * ประตูล็อตเคยรับตัวเลขห้าช่องนี้ตรง ๆ — เกษตรกรพิมพ์ THC เท่าไหร่ก็ได้ และประกาศเองว่า
 * `testStatus: 'PASSED'` ได้ด้วย นั่นคือแบบจำลองเดิมที่ Bug 6.3 ทำให้ซื่อสัตย์ที่สุด
 * เท่าที่แบบจำลองนั้นจะเป็นได้ (แนบลิงก์เฉย ๆ ไม่ทำให้ผ่านอัตโนมัติ ต้องประกาศเอง)
 * แต่ตอนนี้ไม่ใช่แบบจำลองนั้นแล้ว: รุ่นถือ COA จริง (T9/T10) เจ้าหน้าที่ตรวจสอบ (T13)
 * และหน้าสแกนอ่านจากตรงนั้น ไม่ใช่จากคำพูดของล็อตเกี่ยวกับตัวเอง
 *
 * **ปฏิเสธ ไม่ใช่เมิน** — ถ้าเมินเงียบ ๆ ผู้เรียกส่ง 0.2 มาแล้วได้ 200 กลับไป
 * เท่ากับระบบรายงานว่าเขียนสำเร็จทั้งที่ไม่ได้เขียน ซึ่งเป็นคำโกหกชนิดเดียวกับที่
 * กฎหลักฐานของแพลตฟอร์มมีไว้กันตั้งแต่ต้น · คำปฏิเสธจึงชี้ประตูที่ใช้ได้จริงแทน
 *
 * คอลัมน์ในฐานข้อมูลไม่ได้ถูกลบ: แถวที่เขียนไว้ก่อนวันนี้ยังอ่านได้ตามเดิม
 * การลบคอลัมน์คือการทำให้อธิบายหน้าเก่าไม่ได้อีกเลย · มันแค่ไม่มีใครเขียนได้อีกแล้ว
 */

/** ห้าช่องที่ประตูล็อตเคยรับ — เรียงตามที่ปรากฏใน `PUT` เดิม */
const TYPED_LAB_FIELDS = Object.freeze([
    'thcContent',
    'cbdContent',
    'moistureContent',
    'labTestReportUrl',
    'testStatus',
]);

/** ประตูจริงที่รับผลตรวจ — อยู่ที่ *รุ่น* เพราะแล็บตรวจรุ่น ไม่ได้ตรวจล็อต (§4.5) */
const LAB_RESULT_DOOR = 'POST /api/harvest-batches/:id/lab-results';

/**
 * ช่องที่ผู้เรียก "ส่งมาจริง" — นับ key ที่มีอยู่ ไม่ใช่ค่าที่ truthy
 * ส่ง `thcContent: null` มาก็คือการพยายามเขียนทับ ไม่ใช่การไม่ส่ง
 */
function typedLabFieldsIn(body) {
    if (!body || typeof body !== 'object') { return []; }
    return TYPED_LAB_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
}

function assertNoTypedLabValues(body) {
    const attempted = typedLabFieldsIn(body);
    if (attempted.length === 0) { return; }

    const err = new Error(`Typed lab values are not accepted: ${attempted.join(', ')}`);
    err.code = 'LAB_VALUES_NOT_TYPED';
    err.statusCode = 400;
    err.fields = attempted;
    err.messageTh =
        `ค่าผลวิเคราะห์พิมพ์เองไม่ได้ ให้แนบไฟล์ผลตรวจ (COA) ของรุ่นที่ ${LAB_RESULT_DOOR} แทน `
        + `— ช่องที่ถูกปฏิเสธ: ${attempted.join(', ')}`;
    throw err;
}

module.exports = { TYPED_LAB_FIELDS, LAB_RESULT_DOOR, typedLabFieldsIn, assertNoTypedLabValues };
