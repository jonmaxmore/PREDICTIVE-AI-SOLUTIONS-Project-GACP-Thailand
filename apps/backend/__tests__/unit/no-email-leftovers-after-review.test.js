'use strict';

/**
 * รอบ review ของ chore/retire-email-auth (2026-09-16): ของที่ยังพูดถึงอีเมลทั้งที่ระบบไม่มีอีเมลแล้ว
 *
 * มติ operator 2026-09-15: เข้าสู่ระบบด้วย หมอพร้อม / ThaID เท่านั้น ไม่มีอีเมลในระบบ
 *
 * 1) POST /auth/health/reset-password เคยตอบว่า "ระบบได้ส่งลิงก์เปลี่ยนรหัสผ่านไปแล้ว" ทั้งที่ไม่ได้ส่ง
 *    ต่อมามติ operator 2026-09-16 "เราไม่มีระบบ forgot ไม่ว่าจะไปอีเมลหรือ sms" ถอด endpoint นี้ทั้งเส้น
 *    เทสนี้จึงพิสูจน์ว่า controller ไม่มี handler ให้เรียกอีก (รายละเอียดทั้งระบบอยู่ใน
 *    no-self-service-password-reset.test.js)
 * 2) GET /api/mfa/status: ยังอ่านอีเมลและตอบ hasEmail ซึ่งมีไว้ให้หน้าลงทะเบียน 2FA ทางอีเมลที่ถูกลบไปแล้ว
 *    อ่าน PII โดยไม่มีใครใช้
 */

const fs = require('fs');
const path = require('path');

const mockUserFindFirst = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: { user: { findFirst: (...a) => mockUserFindFirst(...a), update: jest.fn() } },
}));
jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { createAuthSessionSecurityHandlers } = require('../../controllers/auth-controller/auth-session-security-handlers');
const identityService = require('../../services/identity-service');

function buildHandlers() {
    return createAuthSessionSecurityHandlers({
        AuthService: {},
        auditLogger: { logAuth: jest.fn() },
        jwtConfig: {},
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        getRequestIp: () => '127.0.0.1',
        sendErrorResponse: (res, _req, { status, code, message }) => res.status(status).json({ success: false, code, error: message }),
        sendSuccessResponse: (res, _req, body) => res.status(200).json({ success: true, ...body }),
        setAuthCookies: jest.fn(),
    });
}

beforeEach(() => mockUserFindFirst.mockReset());

describe('no password-reset request handler is left to answer anything', () => {
    it('the session/security handlers expose no requestPasswordReset', () => {
        expect(buildHandlers().requestPasswordReset).toBeUndefined();
    });
});

describe('GET /api/mfa/status reads no email', () => {
    it('getMfaStatus selects only the enrolment flag', async () => {
        mockUserFindFirst.mockResolvedValueOnce({ twoFactorEnabled: false });
        await identityService.getMfaStatus('u-1');

        expect(mockUserFindFirst).toHaveBeenCalledTimes(1);
        expect(mockUserFindFirst.mock.calls[0][0].select).toEqual({ twoFactorEnabled: true });
    });

    it('the route no longer reports hasEmail', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'api', 'identity', 'mfa.js'), 'utf-8');
        expect(src).not.toMatch(/hasEmail/);
    });
});
