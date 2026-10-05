'use strict';

/**
 * ไม่มีการรีเซ็ตรหัสผ่านไม่ว่ารูปแบบใด วัดจาก router ที่ mount จริง ไม่ใช่การอ่านข้อความในไฟล์
 *
 * มติ operator 2026-09-16: ไม่มีระบบลืมรหัสผ่าน ไม่ว่าทางอีเมลหรือ SMS ผู้ใช้ขอรีเซ็ตเองไม่ได้
 * มติ operator 2026-09-17: "เราไม่มีการกู้บัญชี" — ทางสุดท้ายที่เคยเหลือจึงถูกถอดทั้งสองปลาย
 *   - ปลายออก token: POST /provider/directory/:id/force-password-reset (ผู้ดูแลกดออก token ให้บัญชีหนึ่ง)
 *   - ปลายใช้ token: POST /auth/health/reset-password/:token (ตั้งรหัสใหม่ด้วย token นั้น)
 *   ไม่มีหน้าเว็บใดใช้ token นั้นได้อยู่แล้ว (audit UXUI-X02) เจ้าหน้าที่ได้ความลับไปแต่ส่งต่อให้ใครใช้ไม่ได้
 *
 * เทสคู่กันคือ no-self-service-password-reset.test.js ซึ่งกันการกลับมาของโค้ดด้วยการอ่าน source
 * ไฟล์นี้เติมสิ่งที่การอ่าน source ทำไม่ได้: เดินคำขอผ่าน router จริง จึงจับได้ทั้งเส้นทางที่ประกาศ
 * ด้วยรูปแบบอื่น (router.route(...).post, path ที่ประกอบจากตัวแปร) และเห็นว่าคำขอไปไม่ถึงฐานข้อมูล
 *
 * เรียก `router.handle()` ตรง ๆ ไม่ผ่าน supertest โดยตั้งใจ: การเปิด server ชั่วคราวในไฟล์นี้ทำให้
 * ชุดเทสทั้งกอง (maxWorkers: 1) จบด้วย exit 1 ทั้งที่ทุกเทสผ่าน ซึ่งเป็นสัญญาณเขียวปลอมแบบที่ repo นี้
 * ห้ามไว้ · ผลพลอยได้คือแม่นขึ้น: callback ตัวสุดท้ายของ router ทำงานเมื่อ "ไม่มีเส้นทางไหนรับ" จึงแยก
 * ออกจาก "มีเส้นทางแต่ตอบ 404" ได้จริง แทนที่จะเดาจาก status
 *
 * สิ่งที่ยังอยู่โดยตั้งใจ และเทสนี้ใช้เป็นตัวควบคุมว่าการเดิน router เห็นเส้นทางที่มีอยู่จริง:
 * ปลดล็อกบัญชีเจ้าหน้าที่ (/:id/unlock) — เป็นงานดูแลบัญชี ไม่ได้ตั้งรหัสผ่านใหม่
 * (ปิด 2FA /:id/disable-2fa ถูกถอด 2026-09-26 — second-factor-doors.test.js)
 */

// The one service name the retired redemption route called. If a route ever
// hands a token to it again, this spy sees the call.
const mockRedeemToken = jest.fn();

const mockUserFindFirst = jest.fn();
const mockUserUpdate = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: (...a) => mockUserFindFirst(...a),
            findUnique: jest.fn(),
            update: (...a) => mockUserUpdate(...a),
        },
        $queryRawUnsafe: jest.fn(),
    },
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});
jest.mock('../../services/prisma-auth-service', () => ({
    resetPasswordWithToken: (...args) => mockRedeemToken(...args),
}));

// Everything the routers pull that is NOT under test is stubbed, so this file
// exercises the two route tables and nothing else.
const mockLogin = jest.fn((req, res) => res.json({ success: true }));
jest.mock('../../controllers/auth-controller', () => ({
    login: (...a) => mockLogin(...a),
}));
jest.mock('../../middleware/upload-middleware', () => ({ single: () => (req, res, next) => next() }));
jest.mock('../../middleware/reject-bad-upload', () => (req, res, next) => next());
// The directory routes are admin-only; the caller here is a DTAM system admin
// of org-1, so a mounted route would run all the way to its database write.
const mockAsAdmin = (req, res, next) => {
    req.user = { id: 'admin-1', role: 'system_admin_dtam', canonicalRole: 'system_admin_dtam', organizationId: 'org-1' };
    next();
};
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, res, next) => next(),
    authenticateAny: (req, res, next) => next(),
    authenticateProvider: (...a) => mockAsAdmin(...a),
    isTokenBeforeSessionEpoch: () => false,
}));
const mockAuditLog = jest.fn().mockResolvedValue(null);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a), logAuth: jest.fn() },
    AuditCategory: { SECURITY: 'SECURITY', ADMIN: 'ADMIN' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));
jest.mock('../../services/pdpa-service', () => ({}));
jest.mock('../../services/notification-preferences-service', () => ({}));
jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (fn) => fn(),
    runWithTenantContext: (_ctx, fn) => fn(),
}));
jest.mock('../../services/provider-user-service', () => ({ createProviderUser: jest.fn() }));
jest.mock('../../services/admin-user-service', () => ({}));

const authHealthRouter = require('../../routes/api/auth/auth-health');
const providerDirectoryRouter = require('../../routes/api/system/provider');

/**
 * Walk one request through a real router. `unmatched` is true when the router
 * ran out of layers, i.e. nothing is mounted at that method + path.
 */
function callRouter(router, method, url, body = {}) {
    return new Promise((resolve, reject) => {
        const req = {
            method,
            url,
            originalUrl: url,
            baseUrl: '',
            path: url,
            body,
            headers: {},
            params: {},
            query: {},
            cookies: {},
            get: () => undefined,
            header: () => undefined,
        };
        const res = {
            statusCode: 200,
            headersSent: false,
            locals: {},
            status(code) { this.statusCode = code; return this; },
            set() { return this; },
            setHeader() { return this; },
            getHeader() { return undefined; },
            json(payload) { resolve({ status: this.statusCode, body: payload, unmatched: false }); return this; },
            send(payload) { resolve({ status: this.statusCode, body: payload, unmatched: false }); return this; },
            end() { resolve({ status: this.statusCode, body: undefined, unmatched: false }); return this; },
        };
        router.handle(req, res, (err) => {
            if (err) { reject(err); return; }
            resolve({ status: null, body: undefined, unmatched: true });
        });
    });
}

const routeTable = (router) => router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);

// A path that sets, resets or recovers a password or an account. MFA resets are
// staff administration of a second factor, not a way back into an account.
const RECOVERY_PATH = /password|recover|forgot/i;

const PROVIDER_TARGET = {
    id: 'staff-1',
    email: null,
    role: 'document_reviewer',
    providerId: '1526113009461',
    isLocked: true,
    twoFactorEnabled: true,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockRedeemToken.mockResolvedValue({ success: true, message: 'Password has been reset successfully' });
    mockUserFindFirst.mockResolvedValue(PROVIDER_TARGET);
    mockUserUpdate.mockResolvedValue({ id: PROVIDER_TARGET.id });
});

describe('the applicant auth router redeems no reset token (operator 2026-09-17)', () => {
    it('POST /reset-password/:token reaches no route and no service', async () => {
        const res = await callRouter(authHealthRouter, 'POST', '/reset-password/staff-issued-token', { newPassword: 'NotARealPassword-1' });

        expect(res.unmatched).toBe(true);
        expect(mockRedeemToken).not.toHaveBeenCalled();
        expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it('no other reset or recovery path is mounted either', async () => {
        for (const url of ['/reset-password', '/forgot-password', '/request-password-reset', '/password-recovery', '/account-recovery']) {
            const res = await callRouter(authHealthRouter, 'POST', url, { identifier: '1526113009461', newPassword: 'NotARealPassword-1' });
            expect({ url, unmatched: res.unmatched }).toEqual({ url, unmatched: true });
        }
        expect(mockRedeemToken).not.toHaveBeenCalled();
    });

    it('the route table names no password reset or recovery path', () => {
        const table = routeTable(authHealthRouter);
        // positive control: the table is the real one (login and change-password are there)
        expect(table).toEqual(expect.arrayContaining(['POST /login', 'POST /change-password']));
        expect(table.filter((row) => RECOVERY_PATH.test(row) && row !== 'POST /change-password')).toEqual([]);
    });

    it('positive control: the walk does reach a mounted route', async () => {
        const res = await callRouter(authHealthRouter, 'POST', '/login', { identifier: '1526113009461', password: 'NotARealPassword-1' });

        expect(res.unmatched).toBe(false);
        expect(res.status).toBe(200);
        expect(mockLogin).toHaveBeenCalledTimes(1);
    });
});

describe('the staff directory router issues no reset token (operator 2026-09-17)', () => {
    it('POST /:id/force-password-reset reaches no route, writes nothing and returns no token', async () => {
        const res = await callRouter(providerDirectoryRouter, 'POST', '/staff-1/force-password-reset');

        expect(res.unmatched).toBe(true);
        expect(res.body).toBeUndefined();
        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('the route table names no password reset or recovery action', () => {
        const table = routeTable(providerDirectoryRouter);
        expect(table).toEqual(expect.arrayContaining(['POST /:id/unlock']));
        // disable-2fa went 2026-09-26 (no one clears another account's 2FA — second-factor-doors.test.js)
        expect(table).not.toContain('POST /:id/disable-2fa');
        expect(table.filter((row) => RECOVERY_PATH.test(row))).toEqual([]);
    });

    // Staff administration that stays: it sets no password.
    it.each([
        ['unlock', { isLocked: false, lockedUntil: null, loginAttempts: 0 }],
    ])('positive control: POST /:id/%s is still mounted and sets no password', async (action, expected) => {
        const res = await callRouter(providerDirectoryRouter, 'POST', `/staff-1/${action}`);

        expect(res.unmatched).toBe(false);
        expect(res.status).toBe(200);
        expect(mockUserUpdate).toHaveBeenCalledTimes(1);
        const { data } = mockUserUpdate.mock.calls[0][0];
        expect(data).toMatchObject(expected);
        expect(Object.keys(data).filter((key) => /password/i.test(key))).toEqual([]);
    });
});
