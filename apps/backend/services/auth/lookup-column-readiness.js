'use strict';

/**
 * ธงเปิดการค้นหาด้วย HMAC ต้องไม่เปิดก่อนที่คอลัมน์จะถูกเติม
 *
 * เกิดขึ้นจริงบน demo 2026-09-07: `AUTH_LOOKUP_USE_HMAC=true` ถูกตั้งไว้ แต่สคริปต์เติมค่า
 * (scripts/backfill-national-id-hmac.js) ไม่เคยรันบนเครื่องนั้น ⇒ ประตูล็อกอินค้นหาใน
 * `healthIdHmac` / `providerIdHmac` ซึ่งยังว่าง แถวที่มีอยู่จึงกลายเป็นแถวที่ค้นหาไม่เจอ
 *
 *   เกษตรกร 3 ราย + พนักงานทั้ง 5 ราย = ทุกบัญชีที่สร้างก่อนวันเปิดธง เข้าระบบไม่ได้เลย
 *   สิ่งที่ผู้ใช้เห็นคือ "ไม่พบผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" ทั้งที่รหัสผ่านถูกต้อง
 *
 * เอกสารของสคริปต์เขียนไว้ชัดว่า "ต้องรันก่อนเปิดธง" — แต่ลำดับนั้นไม่มีเครื่องบังคับ มีแต่วินัย
 * คน · ตัวนี้คือเครื่องบังคับ: ถ้าธงเปิดแล้วยังมีแถวที่มีเลขแต่ไม่มีค่าค้นหา แปลว่าเครื่องนี้อยู่ใน
 * สภาพที่ล็อกอินไม่ได้ ให้ตะโกนออกมาตอนบูต แทนที่จะรอให้คนมากดแล้วงง
 *
 * คู่คอลัมน์เดียวกับที่สคริปต์เติม และเงื่อนไขเดียวกับ assertion ปิดท้ายของมัน (นับเฉพาะแถวที่
 * ยังไม่ถูกลบ) เพื่อให้ "ผ่านสคริปต์" กับ "ผ่านด่านนี้" หมายถึงสิ่งเดียวกันเสมอ
 *
 * @module services/auth/lookup-column-readiness
 */

/** คอลัมน์เลขจริง → คอลัมน์ค่าที่ใช้ค้นหา */
const LOOKUP_COLUMN_PAIRS = Object.freeze([
    ['healthId', 'healthIdHmac'],
    ['providerId', 'providerIdHmac'],
    ['idCard', 'idCardHmac'],
    ['taxId', 'taxIdHmac'],
    ['communityRegistrationNo', 'communityRegistrationNoHmac'],
]);

function hmacLookupEnabled(env = process.env) {
    return String(env.AUTH_LOOKUP_USE_HMAC) === 'true';
}

/**
 * @param {{ user: { count: Function } }} prismaClient
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ ok: boolean, enabled: boolean, missing: Array<{column: string, rows: number}> }>}
 */
async function checkLookupColumnsBackfilled(prismaClient, env = process.env) {
    if (!hmacLookupEnabled(env)) {
        // ธงปิดอยู่ = ยังค้นหาด้วยคอลัมน์เดิม ไม่มีอะไรต้องเติมก่อน
        return { ok: true, enabled: false, missing: [] };
    }

    const missing = [];
    for (const [plaintextColumn, lookupColumn] of LOOKUP_COLUMN_PAIRS) {
        const rows = await prismaClient.user.count({
            where: {
                isDeleted: false,
                NOT: { [plaintextColumn]: null },
                [lookupColumn]: null,
            },
        });
        if (rows > 0) { missing.push({ column: plaintextColumn, rows }); }
    }

    return { ok: missing.length === 0, enabled: true, missing };
}

/** ประโยคเดียวที่บอกทั้งอาการและวิธีซ่อม — คนที่อ่าน log ตอนตีสองต้องใช้ได้ทันที */
function describeMissing(missing) {
    const detail = missing.map((m) => `${m.column}=${m.rows}`).join(', ');
    return `AUTH_LOOKUP_USE_HMAC is on, but ${detail} row(s) still have the id without its lookup value. `
        + 'Those accounts cannot log in at all. '
        + 'Repair: node apps/backend/scripts/backfill-national-id-hmac.js (run --dry-run first).';
}

module.exports = {
    LOOKUP_COLUMN_PAIRS,
    hmacLookupEnabled,
    checkLookupColumnsBackfilled,
    describeMissing,
};
