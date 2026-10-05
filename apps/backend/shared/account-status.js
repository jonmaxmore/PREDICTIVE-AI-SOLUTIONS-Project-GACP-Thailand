'use strict';

const { isProviderRole } = require('./canonical-rbac');

/**
 * บัญชีสถานะไหนยังถือ session ได้ — ที่เดียวที่ทุกประตูออก token ถาม
 *
 * SECU-03 (audit 2026-09-17): แอดมินระงับบัญชีผู้ยื่นคำขอแล้ว ผู้ใช้ล็อกอินด้วยรหัสผ่านเดิมกลับมาได้ทันที
 * เพราะประตูรหัสผ่านไม่เคยอ่าน User.status ขณะที่ประตู ThaID ตรวจอยู่แล้วด้วยกฎนี้
 * (ACTIVE หรือ PENDING_VERIFICATION — ผู้สมัครใหม่ยังไม่ผ่านการยืนยันตัวตนแต่ต้องเข้าระบบได้)
 * กฎนั้นจึงย้ายมาอยู่ที่นี่ แล้วทุกประตูใช้ร่วมกัน: ล็อกอินรหัสผ่าน, จุด mint กลาง, /refresh,
 * การยืนยัน MFA และ ThaID
 *
 * สถานะอื่นทั้งหมด (INACTIVE จากปุ่มระงับ, SUSPENDED, LOCKED ที่แอดมินตั้งได้) = ไม่มี session
 * บัญชีที่ถูกลบแบบ soft (isDeleted) ก็ไม่มี แม้ status ยังเป็น ACTIVE — DELETE /me ไม่แตะ status
 *
 * พนักงาน (role ฝั่ง provider) ต้องเป็น ACTIVE เท่านั้น — กฎเดียวกับประตูล็อกอินพนักงาน
 * (auth-provider.js) และ GET /auth/provider/me · ข้อยกเว้น PENDING_VERIFICATION มีไว้ให้ผู้สมัครใหม่
 * ไม่ใช่ให้พนักงาน
 */
const SESSION_ELIGIBLE_STATUSES = Object.freeze(['ACTIVE', 'PENDING_VERIFICATION']);
const STAFF_SESSION_ELIGIBLE_STATUSES = Object.freeze(['ACTIVE']);

/**
 * @param {{ status?: string|null, isDeleted?: boolean|null, role?: string|null }|null|undefined} user
 *   a User row that carries `status` and `role` (and `isDeleted` when the read
 *   did not already filter it). A row without `status` is NOT eligible; a row
 *   read without `role` is judged by the applicant rule.
 * @returns {boolean}
 */
function canAccountHoldSession(user) {
    if (!user || user.isDeleted === true) { return false; }
    const allowed = isProviderRole(user.role) ? STAFF_SESSION_ELIGIBLE_STATUSES : SESSION_ELIGIBLE_STATUSES;
    return allowed.includes(String(user.status || '').toUpperCase());
}

/**
 * Throwing form for service code. The message is what the HEALTH login
 * handler maps to HTTP (health-auth-profile-handlers.js mapLoginError).
 */
function assertAccountCanHoldSession(user) {
    if (!canAccountHoldSession(user)) {
        const err = new Error('Account is inactive');
        err.code = 'ACCOUNT_INACTIVE';
        throw err;
    }
}

module.exports = {
    SESSION_ELIGIBLE_STATUSES,
    canAccountHoldSession,
    assertAccountCanHoldSession,
};
