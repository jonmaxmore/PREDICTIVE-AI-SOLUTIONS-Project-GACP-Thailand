'use strict';

/**
 * ยามของ "ประตูทางออก" — ด่านลงทะเบียน MFA
 *
 * เมื่อ REQUIRE_MFA_FOR_PRIVILEGED เปิด บัญชีพนักงานที่ยังไม่ได้ลงทะเบียนสองปัจจัย จะได้รับ
 * ตั๋วเฉพาะกิจ (purpose='mfa_setup', อายุ 10 นาที, ออกให้หลังกรอกรหัสผ่านถูกแล้วเท่านั้น)
 * แทนที่จะได้ session — auth-provider.js:211
 *
 * ตั๋วใบนั้นคือสิ่งเดียวที่ผู้ใช้มี · แต่ /mfa/setup กับ /mfa/verify-setup เฝ้าด้วย
 * authenticateProvider ซึ่งเป็นยามของ session และปฏิเสธ token ที่มี purpose ทุกใบโดยเจตนา
 * (rejectPurposeScopedToken — PENTEST A1 ปิดช่องเอา mfa_challenge ไปใช้เป็น session)
 * ⇒ ทางออกเดียวปฏิเสธตั๋วใบเดียวที่มี · วัดจริงบน demo 2026-09-07: พนักงานทั้งห้าบทบาท
 * ล็อกอินแล้วได้ 200 พร้อมตั๋ว แล้ว /mfa/setup ตอบ 401 ทุกคน ⇒ เข้าระบบไม่ได้ถาวร
 * (ธงนี้เปิดทั้ง demo และ production ปิดเฉพาะ staging จึงไม่มีใครเห็นระหว่างพัฒนา)
 *
 * ด่าน PENTEST A1 ถูกและต้องอยู่ต่อ สิ่งที่ต้องแก้คือด่านนี้ต้องเป็นยาม "ของการลงทะเบียน"
 * ไม่ใช่ยามของ session — วิธีเดียวกับที่ POST /mfa/verify ทำอยู่แล้ว คือตรวจ token เอง
 * ไม่ผ่าน middleware ของ session (mfa.js:352) · คู่ setup ไม่เคยได้การปฏิบัติแบบเดียวกัน
 *
 * ขอบเขตที่ยอมรับ:
 *   1. ตั๋ว purpose='mfa_setup' ที่ยังไม่หมดอายุ และชี้ไปยังบัญชี provider ที่มีอยู่จริง
 *   2. session ปกติของ provider (คนที่ล็อกอินอยู่แล้วอยากเปิดสองปัจจัยเอง)
 * นอกนั้นปฏิเสธ · ตั๋วนี้ใช้ได้เฉพาะสองเส้นทางนี้ ที่อื่นยังเจอ authenticateProvider เหมือนเดิม
 *
 * @module middleware/mfa-setup-guard
 */

const jwtConfig = require('../config/jwt-security');
const { normalizeRole, isProviderRole } = require('../shared/canonical-rbac');
// ใช้ logger ตัวรวมโดยตรง ไม่ผ่าน createLogger — ชุดเทสของ MFA mock โมดูล logger แบบไม่มี
// createLogger ไว้ การเรียกมันตอนโหลดโมดูลจะทำให้ทุกเทสในไฟล์นั้นพังตั้งแต่ require
const logger = require('../shared/logger');

const MFA_SETUP_PURPOSE = 'mfa_setup';

function unauthorized(res, message, code) {
    return res.status(401).json({ success: false, error: 'Unauthorized', message, code });
}

function bearerFrom(req) {
    const header = req.headers?.['authorization'];
    const headerToken = header && String(header).split(' ')[1];
    return req.cookies?.provider_token || headerToken || null;
}

/**
 * @type {import('express').RequestHandler}
 */
async function authenticateForMfaSetup(req, res, next) {
    // ทุกกรณีที่ไม่ใช่ "ตั๋วลงทะเบียนที่ใช้ได้" ตกไปที่ยามของ session ตัวเดิม เพื่อให้คำปฏิเสธ
    // (ไม่มี token / token เสีย / บทบาทไม่ใช่พนักงาน) มีคำตอบเดียวกันทั้งระบบ และเพื่อให้
    // ผู้ที่ล็อกอินอยู่แล้วเปิดสองปัจจัยเองได้ตามปกติ
    const sessionGuard = () => {
        const { authenticateProvider } = require('./auth-middleware');
        return authenticateProvider(req, res, next);
    };

    const token = bearerFrom(req);
    if (!token) { return sessionGuard(); }

    let decoded = null;
    try {
        decoded = jwtConfig.verifyToken(token, 'provider');
    } catch (err) {
        logger.warn(`[MFA setup] token rejected: ${err.message}`);
        return sessionGuard();
    }

    if (decoded?.purpose !== MFA_SETUP_PURPOSE) { return sessionGuard(); }

    const { prisma } = require('../services/prisma-database');
    const user = await prisma.user.findFirst({
        where: { id: decoded.id, isDeleted: false },
        select: { id: true, email: true, role: true, providerId: true, organizationId: true },
    });

    if (!user?.id) {
        return unauthorized(res, 'Invalid or expired token', 'INVALID_TOKEN');
    }
    if (!isProviderRole(user.role)) {
        return res.status(403).json({
            success: false, error: 'Forbidden', message: 'Provider access only', code: 'INVALID_ROLE',
        });
    }

    // เท่าที่สองเส้นทางนี้ต้องใช้จริง: id (เก็บ secret), email (ชื่อในแอป authenticator),
    // role (บันทึก audit) · ไม่แนบอะไรเกินนั้น ตั๋วนี้ไม่ใช่ session
    req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        canonicalRole: normalizeRole(user.role),
        providerId: user.providerId,
        organizationId: user.organizationId || null,
        mfaSetupTicket: true,
    };
    return next();
}

module.exports = { authenticateForMfaSetup, MFA_SETUP_PURPOSE };
