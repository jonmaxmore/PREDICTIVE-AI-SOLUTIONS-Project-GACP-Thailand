'use strict';

/**
 * บัญชีที่ระบบสั่งให้ "ตั้ง MFA ก่อน" ต้องตั้งได้จริง
 *
 * วัดจริงบน demo 2026-09-07 (REQUIRE_MFA_FOR_PRIVILEGED=true ทั้ง demo และ production
 * ส่วน staging ปิดอยู่ จึงไม่มีใครเห็น):
 *
 *   POST /auth/provider/login  → 200 {"mfa_setup_required":true,"setup_token":"…"}
 *   POST /mfa/setup  (ตั๋วใบนั้น) → 401 "This token cannot be used to authenticate a session"
 *
 * ประตูทางออกเดียวปฏิเสธตั๋วใบเดียวที่ผู้ใช้มี ⇒ **พนักงานทุกคนบนดีโมและโปรดักชันเข้าระบบ
 * ไม่ได้ถาวร** ทดสอบครบทั้งห้าบทบาท ได้คำตอบเดียวกันหมด
 *
 * ด่านที่ปฏิเสธ (rejectPurposeScopedToken) ถูกต้องและต้องอยู่ต่อ — มันปิดช่องข้าม 2FA
 * (PENTEST A1) ที่เอา mfa_challenge มาใช้เป็น session · สิ่งที่ผิดคือ /mfa/setup กับ
 * /mfa/verify-setup ใช้ยาม "ของ session" ทั้งที่ผู้ใช้ที่ยังไม่ได้ลงทะเบียนถือได้แค่ตั๋วเฉพาะกิจ
 * /mfa/verify แก้ปัญหานี้ไปแล้วด้วยการตรวจ token เอง ไม่ผ่าน middleware — คู่ setup ไม่เคยได้
 * การปฏิบัติแบบเดียวกัน
 */

const jwtConfig = require('../../config/jwt-security');
const { authenticateForMfaSetup } = require('../../middleware/mfa-setup-guard');

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: jest.fn(async ({ where }) => (
                where.id === 'officer-1'
                    ? { id: 'officer-1', email: 'reviewer@gacp.go.th', role: 'document_reviewer', providerId: '1111111111111' }
                    : null
            )),
        },
    },
}));

function resFor() {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}
const reqWith = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {}, cookies: {} });

const setupTicket = () => jwtConfig.generateToken(
    { id: 'officer-1', purpose: 'mfa_setup' }, 'provider', { expiresIn: '10m' },
);

describe('ประตูลงทะเบียน MFA', () => {
    it('รับตั๋วที่ประตูล็อกอินเพิ่งยื่นให้ — ไม่งั้นทางออกไม่มีอยู่จริง', async () => {
        const req = reqWith(setupTicket());
        const res = resFor();
        const next = jest.fn();

        await authenticateForMfaSetup(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.statusCode).toBeNull();
        expect(req.user.id).toBe('officer-1');
        expect(req.user.email).toBe('reviewer@gacp.go.th');
        expect(req.user.mfaSetupTicket).toBe(true);
    });

    it('ตั๋วของ MFA challenge ใช้ที่นี่ไม่ได้ — คนละเรื่องกับการลงทะเบียน', async () => {
        const challenge = jwtConfig.generateToken(
            { id: 'officer-1', purpose: 'mfa_challenge' }, 'provider', { expiresIn: '5m' },
        );
        const res = resFor();
        const next = jest.fn();

        await authenticateForMfaSetup(reqWith(challenge), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('ไม่มีตั๋วเลย = ไม่ผ่าน', async () => {
        const res = resFor();
        const next = jest.fn();
        await authenticateForMfaSetup(reqWith(null), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('ตั๋วชี้ไปยังบัญชีที่ไม่มีอยู่ = ไม่ผ่าน', async () => {
        const ghost = jwtConfig.generateToken({ id: 'nobody', purpose: 'mfa_setup' }, 'provider', { expiresIn: '10m' });
        const res = resFor();
        const next = jest.fn();
        await authenticateForMfaSetup(reqWith(ghost), res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('สองประตูของการลงทะเบียนใช้ยามตัวนี้ ไม่ใช่ยามของ session', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'identity', 'mfa.js'), 'utf8',
        );
        // limitSetupWhenProving (2026-09-26) sits in front: it rate-limits only a /setup
        // that carries a current code (re-enrol); the guard is still authenticateForMfaSetup.
        expect(src).toMatch(/router\.post\('\/setup',\s*limitSetupWhenProving,\s*authenticateForMfaSetup/);
        // mfaVerifyLimiter (round 5, 2026-09-26) sits in front of the guard on /verify-setup.
        expect(src).toMatch(/router\.post\('\/verify-setup',\s*mfaVerifyLimiter,\s*authenticateForMfaSetup/);
    });

    it('ยามของ session ยังปฏิเสธตั๋วเฉพาะกิจเหมือนเดิม — ช่องข้าม 2FA ต้องปิดอยู่', () => {
        expect(jwtConfig.classifyTokenForAccessPath({ purpose: 'mfa_setup', tokenType: 'access' }))
            .not.toBe('ok');
        expect(jwtConfig.classifyTokenForAccessPath({ purpose: 'mfa_challenge', tokenType: 'access' }))
            .not.toBe('ok');
    });
});
