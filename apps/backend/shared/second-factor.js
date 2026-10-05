'use strict';

/**
 * ปัจจัยที่สองของระบบมีอย่างเดียว: TOTP (แอป authenticator)
 *
 * มติ operator 2026-09-15: เข้าสู่ระบบด้วย หมอพร้อม กับ ThaID เท่านั้น — ไม่มีล็อกอินด้วยอีเมล
 * และไม่มี 2FA แบบอีเมล. วิธี 'EMAIL' ที่เคยเปิดให้เลือก (ส่งรหัส 6 หลักทางอีเมล) ถูกปลดออกทั้งชุด
 * และแถวที่ยังจำวิธีนั้นอยู่ถูก migration
 * 20260915180000_retire_email_second_factor ปลดเป็น "ยังไม่ลงทะเบียน"
 *
 * helper นี้คือที่เดียวที่ทุกประตูล็อกอิน (รหัสผ่าน, หมอพร้อม, ThaID) ถามว่า "ต้องท้าทายปัจจัยที่สองไหม"
 * แถวที่ยังเป็น 'EMAIL' (เช่น ฐานที่ยังไม่ได้รัน migration) ต้องนับว่า *ไม่ได้ลงทะเบียน* —
 * มันไม่เคยมี TOTP seed การท้าทายด้วย TOTP จะเป็นการล็อกผู้ใช้ออกถาวร ส่วนบทบาทที่บังคับ MFA
 * (REQUIRE_MFA_FOR_PRIVILEGED) จะถูกส่งไปลงทะเบียน TOTP ใหม่ตามปกติ
 */
const RETIRED_SECOND_FACTOR_METHODS = Object.freeze(['EMAIL']);

/**
 * @param {{ twoFactorEnabled?: boolean, mfaEnabled?: boolean, twoFactorMethod?: string|null }|null|undefined} user
 * @returns {boolean} true only when the account is enrolled in a factor that still exists
 */
function hasUsableSecondFactor(user) {
    if (!user) { return false; }
    // `mfaEnabled` is the pre-rename column name; a still-mid-migration database
    // must not break login (prisma-auth-service.js kept the same fallback).
    const enabled = Boolean(user.twoFactorEnabled || user.mfaEnabled);
    if (!enabled) { return false; }
    const method = user.twoFactorMethod || 'TOTP';
    return !RETIRED_SECOND_FACTOR_METHODS.includes(method);
}

module.exports = { hasUsableSecondFactor, RETIRED_SECOND_FACTOR_METHODS };
