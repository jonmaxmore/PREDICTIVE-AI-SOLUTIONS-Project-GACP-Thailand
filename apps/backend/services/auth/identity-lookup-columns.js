'use strict';

/**
 * คอลัมน์ที่ทำให้ "เลขประจำตัวหนึ่งเลข" ค้นหาเจอ
 *
 * แถวผู้ใช้จะถูกค้นหาตอนล็อกอินด้วยคอลัมน์ค้นหา ไม่ใช่ด้วยเลขที่มองเห็น · เขียนเลขลงไปแล้วลืม
 * เขียนคอลัมน์ค้นหา = สร้างบัญชีที่ล็อกอินไม่ได้ โดยที่ไม่มีอะไรฟ้องจนกว่าจะมีคนมากด
 *
 * เกิดขึ้นมาแล้วสองแบบจากสาเหตุเดียวกัน (2026-09-07):
 *   · แถวเก่าที่มีอยู่ก่อนเปิดธง AUTH_LOOKUP_USE_HMAC — ซ่อมด้วย backfill-national-id-hmac.js
 *   · แถวใหม่ที่ seed สร้าง — prisma/seed-gacp.js เขียนแต่ *Hash ไม่เขียน *Hmac ⇒ ทุกบัญชี
 *     ที่ seed สร้างบนเครื่องที่เปิดธง จะล็อกอินไม่ได้ตั้งแต่วินาทีแรก
 *
 * ที่นี่คือคำตอบเดียวของคำถาม "เลขนี้ต้องลงคอลัมน์ไหนบ้าง" ทั้งประตูสมัครสมาชิกและ seed
 * เรียกอันเดียวกัน จะได้ไม่มีทางตอบต่างกันอีก
 *
 * @module services/auth/identity-lookup-columns
 */

const crypto = require('crypto');
const { computeLookupHmac } = require('../../utils/field-encryption');

const AUTH_TYPE_HEALTH = 'HEALTH_ID';
const AUTH_TYPE_PROVIDER = 'PROVIDER_ID';

/** ธงเดียวกับที่ประตูล็อกอินใช้ตัดสินว่าจะค้นหาจากคอลัมน์ไหน */
function hmacLookupEnabled(env = process.env) {
    return String(env.AUTH_LOOKUP_USE_HMAC) === 'true';
}

/**
 * ทุกคอลัมน์ค้นหาที่ต้องเขียนคู่กับเลขหนึ่งเลข
 *
 * *Hash (SHA-256 เปล่า) เขียนเสมอ — เป็นของเดิมและยังมีคนอ่านอยู่
 * *Hmac (มีคีย์) เขียนเพิ่มเมื่อธงเปิด — เป็นคอลัมน์ที่ล็อกอินใช้จริงตอนนั้น
 *
 * @param {string|null|undefined} identityNumber  เลขบัตรประชาชน หรือรหัสพนักงาน
 * @param {'HEALTH_ID'|'PROVIDER_ID'} authType
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string|null>}
 */
function identityLookupColumns(identityNumber, authType, env = process.env) {
    if (!identityNumber) {
        return { idCardHash: null, healthIdHash: null, providerIdHash: null };
    }

    const idCardHash = crypto.createHash('sha256').update(identityNumber).digest('hex');
    const columns = {
        idCardHash,
        healthIdHash: authType === AUTH_TYPE_HEALTH ? idCardHash : null,
        providerIdHash: authType === AUTH_TYPE_PROVIDER ? idCardHash : null,
    };

    if (hmacLookupEnabled(env)) {
        const idCardHmac = computeLookupHmac(identityNumber);
        columns.idCardHmac = idCardHmac;
        columns.healthIdHmac = authType === AUTH_TYPE_HEALTH ? idCardHmac : null;
        columns.providerIdHmac = authType === AUTH_TYPE_PROVIDER ? idCardHmac : null;
    }

    return columns;
}

module.exports = {
    AUTH_TYPE_HEALTH,
    AUTH_TYPE_PROVIDER,
    hmacLookupEnabled,
    identityLookupColumns,
};
