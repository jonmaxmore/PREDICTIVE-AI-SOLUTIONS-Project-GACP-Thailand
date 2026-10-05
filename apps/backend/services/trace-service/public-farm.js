'use strict';

/**
 * ฟาร์มที่หน้าสแกนสาธารณะพูดถึงได้ — **แหล่งเดียว** ของทั้งคำถาม (select) และคำตอบ (projection)
 *
 * ทำไมต้องอยู่ด้วยกัน: บั๊กเดิมของที่นี่ซ้ำสามครั้งด้วยรูปเดียวกัน — คอลัมน์มีอยู่ ตัวส่งออกพิมพ์มัน
 * แต่ `select` ไม่ได้ขอ · Prisma คืน `undefined` ให้ฟิลด์ที่ไม่ได้ขอ ไม่ใช่ error ดังนั้น
 * `field ?? null` จึงตีพิมพ์ null ออกไปเงียบ ๆ และหน้าเว็บอ่านว่า "ฟาร์มนี้ไม่เคยกรอกที่อยู่"
 * ทั้งที่กรอกไว้แล้ว (T8 plotCode · T12 address · N6 readAt)
 *
 * แยกไฟล์ออกมาเพราะประตูสแกนสาธารณะมี **สองเส้น** ไม่ใช่เส้นเดียว:
 *   - GET /api/trace/:qr        → services/trace-service/resolve-generic.js
 *   - GET /api/trace/lot/:id    → routes/api/trace/trace-batch-lot-routes.js  (เส้นที่หน้าเว็บล็อตเรียก)
 *   - GET /api/trace/batch/:id  → ไฟล์เดียวกัน
 * ก่อนหน้านี้ทั้งสามเขียน projection ของตัวเอง มติ operator 2026-09-05 ที่ให้เปิดที่อยู่จึงเป็นจริง
 * บนเส้นเดียว ผู้ซื้อคนเดียวกันสแกนของชิ้นเดียวกันแล้วได้คำตอบต่างกันตามว่า QR พาไปทางไหน
 *
 * สิ่งที่ยังไม่ปล่อย และไม่ได้อยู่ใน select ด้วยซ้ำ: `latitude`/`longitude` — พิกัดบ้านของเกษตรกร
 * และ `id` — เป็นมือจับสำหรับไล่เดาแถวของคนอื่น ไม่ใช่ข้อมูลที่คนสแกนต้องใช้ · ผู้เรียกที่ต้องใช้ id
 * ภายในให้เขียน `{ ...PUBLIC_FARM_SELECT, id: true }` ให้เห็นกับตาว่าขอเพิ่มเอง
 */

/** ทุกคอลัมน์ที่ `toPublicFarm` อ่าน — ปักด้วยเทสใน __tests__/unit/public-farm-projection.test.js */
const PUBLIC_FARM_SELECT = Object.freeze({
    farmName: true,
    farmType: true,
    district: true,
    province: true,
    status: true,
    address: true,
    subDistrict: true,
    postalCode: true,
});

/**
 * WHAT MAY BE SAID ABOUT A FARM to someone who scanned a QR — no login, no account.
 *
 * SEC-CULT-001 held that only a coarse district/province location may appear here,
 * never the street address or sub-district. The operator replaced that position on
 * 2026-09-05: "ยังไม่ต้องสนใจกฎหมาย PDPA ให้อัปโหลด COA และพวกชื่อฟาร์ม และที่อยู่ติดต่อได้
 * เมื่อสแกนต้องเห็นทั้งหมด" — logged as a DEMO-PHASE relaxation with a return date before
 * ministry production (tnt-data-scope.md §7).
 *
 * GPS COORDINATES ARE STILL ABSENT, and that is a separate decision the operator was
 * asked and answered separately ("ไม่เปิด"). Sub-district tells a buyer where produce
 * comes from; coordinates walk a stranger to the plot, and cannabis plots are theft
 * targets. That is a physical-safety question, not a privacy one, so opening the
 * address does not carry it along. Absent rather than null: a null tells the next
 * reader the platform holds the number and invites the change that fills it in.
 *
 * The farm's internal id is also still absent — unrelated to the ruling. An id is a
 * handle for enumerating other people's records, not something a scanner needs.
 *
 * เลขที่บ้าน/ตำบล/รหัสไปรษณีย์ เปิดตามมติ operator 2026-09-05 ("ที่อยู่ ... เมื่อสแกนต้องเห็นทั้งหมด")
 * ฟาร์มที่ไม่ได้กรอกได้ null ไม่ใช่ค่าปลอม · `location` คงไว้เพราะเป็นบรรทัดที่คนอ่านจริง และยังถูก
 * แม้ฟาร์มจะไม่มีเลขที่บ้านบันทึกไว้
 */
function toPublicFarm(farm) {
    if (!farm) { return null; }
    return {
        name: farm.farmName,
        type: farm.farmType,
        location: `${farm.district}, ${farm.province}`,
        address: farm.address ?? null,
        subDistrict: farm.subDistrict ?? null,
        district: farm.district,
        province: farm.province,
        postalCode: farm.postalCode ?? null,
        status: farm.status,
    };
}

module.exports = { PUBLIC_FARM_SELECT, toPublicFarm };
