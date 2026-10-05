'use strict';

/**
 * ประตูรหัสผ่านของเจ้าหน้าที่ — มติ operator 2026-09-26 "ปิด + เพิ่มเปลี่ยนรหัสของตัวเองให้เจ้าหน้าที่"
 *
 * ที่มา: security review reports/security/2026-09-26-no-recovery-review.md (HIGH)
 * PUT /api/provider/directory/:id รับ `password` แล้ว hash เขียนทับรหัสของบัญชีอื่น — ผู้ดูแลตั้งรหัส
 * ให้ใครก็ได้ในองค์กร (รวมเกษตรกร) โดยไม่มีเกณฑ์ความแข็งแรงและไม่มี audit ของตัวเอง ซึ่งคือการรีเซ็ต
 * รหัสผ่านโดยเจ้าหน้าที่ ขัดกับ "ไม่มีการกู้บัญชี" (มติ 2026-09-17)
 *
 * ไฟล์นี้ตรึงสามเรื่อง ผ่าน router จริงด้วย supertest:
 *   1. ประตูไดเรกทอรีไม่เขียนรหัสผ่านอีก — มี `password` ในคำขอ → 400 DIRECTORY_PASSWORD_WRITE_FORBIDDEN
 *   2. PUT/PATCH/DELETE ของไดเรกทอรีแตะได้เฉพาะบัญชีเจ้าหน้าที่ (มี providerId, ไม่ใช่ role health) →
 *      บัญชีอื่นตอบ 404 เหมือนข้ามองค์กร
 *   3. เจ้าหน้าที่เปลี่ยนรหัสของตัวเองด้วยรหัสเดิม + รหัสใหม่: POST /auth/provider/change-password
 *      ใช้ changePassword ตัวเดียวกับผู้ขอรับรอง (เกณฑ์เดียวกับตอนสมัคร/สร้างบัญชีเจ้าหน้าที่)
 *
 * ฐานข้อมูลเป็นตารางในหน่วยความจำ (ไม่มี Postgres ในเครื่องที่รัน): update เขียนลงแถวจริงในตาราง
 * "hash ไม่เปลี่ยน" จึงวัดจากแถว ไม่ใช่จากการนับว่ามีการเรียก update หรือไม่
 */

process.env.BCRYPT_ROUNDS = '4'; // password-management อ่านตอนโหลด — ต้องตั้งก่อน require

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');

// ── ตาราง users ในหน่วยความจำ ─────────────────────────────────────────────────
const mockUsers = new Map();

function mockMatches(row, where = {}) {
    for (const [key, cond] of Object.entries(where)) {
        const value = row[key];
        if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
            if ('not' in cond && value === cond.not) { return false; }
            if ('notIn' in cond && cond.notIn.includes(value)) { return false; }
            if ('in' in cond && !cond.in.includes(value)) { return false; }
            continue;
        }
        if (value !== cond) { return false; }
    }
    return true;
}

const mockUserUpdate = jest.fn(async ({ where, data }) => {
    const row = mockUsers.get(where.id);
    if (!row) { throw new Error('Record to update not found'); }
    Object.assign(row, data);
    return { ...row };
});

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: jest.fn(async ({ where } = {}) => {
                for (const row of mockUsers.values()) {
                    if (mockMatches(row, where)) { return { ...row }; }
                }
                return null;
            }),
            findUnique: jest.fn(async ({ where } = {}) => {
                const row = mockUsers.get(where.id);
                return row ? { ...row } : null;
            }),
            update: (...a) => mockUserUpdate(...a),
            count: jest.fn(async () => 0),
        },
        $transaction: jest.fn(async (cb) => cb({})),
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

// ผู้เรียกมาจาก header (รูปแบบเดียวกับ provider-directory-hardening.test.js)
jest.mock('../../middleware/auth-middleware', () => {
    const fromHeaders = (req, res, next) => {
        const id = req.headers['x-test-user-id'];
        if (!id) { return res.status(401).json({ success: false, code: 'AUTH_ERROR' }); }
        const role = req.headers['x-test-role'];
        req.user = {
            id,
            role,
            canonicalRole: role,
            organizationId: req.headers['x-test-organization-id'] || 'org-1',
        };
        return next();
    };
    return {
        authenticateProvider: fromHeaders,
        authenticateHealth: fromHeaders,
        authenticateAny: fromHeaders,
        authenticate: fromHeaders,
        optionalAuth: fromHeaders,
        requireRole: () => (_req, _res, next) => next(),
        requireVerification: (_req, _res, next) => next(),
        checkPermission: () => (_req, _res, next) => next(),
        rateLimitSensitive: () => (_req, _res, next) => next(),
        isTokenBeforeSessionEpoch: () => false,
    };
});

jest.mock('../../services/tenant-context', () => ({
    withoutTenantScope: (fn) => fn(),
    runWithTenantContext: (_ctx, fn) => fn(),
}));

jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: jest.fn(),
    listAllUsersForProviderDirectory: jest.fn().mockResolvedValue([]),
    findUserForProviderDirectory: jest.fn().mockResolvedValue(null),
    countOtherActiveAdmins: jest.fn().mockResolvedValue(2),
    getActiveAdminUserGuard: jest.fn(),
}));

const mockRevokeAll = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/token-revocation-service', () => ({
    revokeAllUserTokens: (...a) => mockRevokeAll(...a),
    isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
}));

const mockAuditLog = jest.fn().mockResolvedValue(null);
const mockLogAuth = jest.fn().mockResolvedValue(null);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        log: (...a) => mockAuditLog(...a),
        logAuth: (...a) => mockLogAuth(...a),
        logSecurity: jest.fn(),
    },
    AuditCategory: { ADMIN: 'ADMIN', SECURITY: 'SECURITY', AUTHENTICATION: 'AUTHENTICATION' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));

jest.mock('../../config/jwt-security', () => ({ generateToken: jest.fn(() => 'signed.token') }));
jest.mock('../../services/notification-preferences-service', () => ({}));
jest.mock('../../services/pdpa-service', () => ({}));
jest.mock('../../middleware/upload-middleware', () => ({ single: () => (req, res, next) => next() }));
jest.mock('../../middleware/reject-bad-upload', () => (req, res, next) => next());

const providerDirectoryRouter = require('../../routes/api/system/provider');
const authProviderRouter = require('../../routes/api/auth/auth-provider');
const authHealthRouter = require('../../routes/api/auth/auth-health');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/provider/directory', providerDirectoryRouter);
    app.use('/api/auth/provider', authProviderRouter);
    app.use('/api/auth/health', authHealthRouter);
    return app;
}

const OLD_PASSWORD = 'OldStaff#Pass2026';
const NEW_PASSWORD = 'NewStaff#Pass2027';
const FARMER_PASSWORD = 'Farmer#Secret2026';
let HASHES;

function seed() {
    mockUsers.clear();
    const base = { isDeleted: false, status: 'ACTIVE', organizationId: 'org-1', sessionsRevokedAt: null, healthId: null };
    mockUsers.set('admin-1', { ...base, id: 'admin-1', role: 'system_admin_dtam', providerId: '1111111111111', password: HASHES.admin, firstName: 'ผู้ดูแล' });
    mockUsers.set('staff-1', { ...base, id: 'staff-1', role: 'document_reviewer', providerId: '2222222222222', password: HASHES.staff, firstName: 'สมชาย' });
    mockUsers.set('staff-org2', { ...base, id: 'staff-org2', role: 'document_reviewer', providerId: '3333333333333', organizationId: 'org-2', password: HASHES.staff, firstName: 'อื่น' });
    // เกษตรกรในองค์กรเดียวกับผู้ดูแล (บัญชีใหม่ลง org `default` เหมือนเจ้าหน้าที่ที่ seed ไว้)
    mockUsers.set('farmer-1', { ...base, id: 'farmer-1', role: 'health', providerId: null, healthId: '4444444444444', password: HASHES.farmer, firstName: 'ชาวไร่' });
    // บัญชีที่มี providerId แต่ role เป็น health — ไม่ใช่เจ้าหน้าที่
    mockUsers.set('health-with-pid', { ...base, id: 'health-with-pid', role: 'health', providerId: '5555555555555', password: HASHES.farmer, firstName: 'ลูกผสม' });
}

const asAdmin = (req, opts = {}) => req
    .set('x-test-user-id', opts.id || 'admin-1')
    .set('x-test-role', opts.role || 'system_admin_dtam')
    .set('x-test-organization-id', opts.org || 'org-1');

let app;
beforeAll(async () => {
    HASHES = {
        admin: await bcrypt.hash(OLD_PASSWORD, 4),
        staff: await bcrypt.hash(OLD_PASSWORD, 4),
        farmer: await bcrypt.hash(FARMER_PASSWORD, 4),
    };
    app = buildApp();
});
beforeEach(() => {
    jest.clearAllMocks();
    seed();
});

// ── 1. ประตูไดเรกทอรีไม่เขียนรหัสผ่าน ─────────────────────────────────────────
describe('directory doors never write a password', () => {
    test('admin PUT a staff password → 400 DIRECTORY_PASSWORD_WRITE_FORBIDDEN, hash unchanged', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/staff-1')).send({ password: 'Taken#Over2026' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('DIRECTORY_PASSWORD_WRITE_FORBIDDEN');
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
        expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    test('admin PUT a farmer password → 400, the farmer hash unchanged and the old password still works', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/farmer-1')).send({ password: 'Taken#Over2026' });
        expect(res.status).toBe(400);
        expect(mockUsers.get('farmer-1').password).toBe(HASHES.farmer);
        expect(await bcrypt.compare(FARMER_PASSWORD, mockUsers.get('farmer-1').password)).toBe(true);
    });

    test('a password riding along with a legitimate edit refuses the whole request (nothing written)', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/staff-1')).send({ firstName: 'ใหม่', password: 'Taken#Over2026' });
        expect(res.status).toBe(400);
        expect(mockUsers.get('staff-1').firstName).toBe('สมชาย');
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
    });

    test('admin PUT their OWN password through the directory → 400 (own change needs the old password)', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/admin-1')).send({ password: 'Self#Reset2026' });
        expect(res.status).toBe(400);
        expect(mockUsers.get('admin-1').password).toBe(HASHES.admin);
    });

    test('platform admin (cross-tenant) PUT a password → 400', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/staff-org2'), { role: 'system_admin_platform', org: 'org-9' })
            .send({ password: 'Taken#Over2026' });
        expect(res.status).toBe(400);
        expect(mockUsers.get('staff-org2').password).toBe(HASHES.staff);
    });

    test('PATCH carrying a password → 400 as well (the field used to be dropped silently)', async () => {
        const res = await asAdmin(request(app).patch('/api/provider/directory/staff-1')).send({ password: 'Taken#Over2026' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('DIRECTORY_PASSWORD_WRITE_FORBIDDEN');
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
    });

    test('control: an empty password string is "no password" — the edit goes through and the hash stays', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/staff-1')).send({ firstName: 'ใหม่', password: '' });
        expect(res.status).toBe(200);
        expect(mockUsers.get('staff-1').firstName).toBe('ใหม่');
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
    });
});

// ── 2. ไดเรกทอรีแตะได้เฉพาะบัญชีเจ้าหน้าที่ ──────────────────────────────────────
describe('directory mutations reach staff accounts only', () => {
    test('PUT a farmer (no providerId) → 404, nothing written', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/farmer-1')).send({ firstName: 'เปลี่ยน' });
        expect(res.status).toBe(404);
        expect(mockUsers.get('farmer-1').firstName).toBe('ชาวไร่');
    });

    test('PATCH a farmer → 404', async () => {
        const res = await asAdmin(request(app).patch('/api/provider/directory/farmer-1')).send({ isActive: false });
        expect(res.status).toBe(404);
        expect(mockUsers.get('farmer-1').status).toBe('ACTIVE');
    });

    test('DELETE a farmer → 404, the account is not deleted', async () => {
        const res = await asAdmin(request(app).delete('/api/provider/directory/farmer-1')).send();
        expect(res.status).toBe(404);
        expect(mockUsers.get('farmer-1').isDeleted).toBe(false);
    });

    test('an account with a providerId but the health role → 404', async () => {
        const res = await asAdmin(request(app).patch('/api/provider/directory/health-with-pid')).send({ firstName: 'x' });
        expect(res.status).toBe(404);
        expect(mockUsers.get('health-with-pid').firstName).toBe('ลูกผสม');
    });

    test('platform admin cannot reach a farmer either → 404', async () => {
        const res = await asAdmin(request(app).put('/api/provider/directory/farmer-1'), { role: 'system_admin_platform', org: 'org-9' })
            .send({ firstName: 'x' });
        expect(res.status).toBe(404);
    });

    test('kept: cross-org staff → 404 for a dtam admin', async () => {
        const res = await asAdmin(request(app).patch('/api/provider/directory/staff-org2')).send({ firstName: 'x' });
        expect(res.status).toBe(404);
    });

    test('kept: a non-admin caller → 403', async () => {
        const res = await asAdmin(request(app).patch('/api/provider/directory/staff-1'), { id: 'staff-1', role: 'document_reviewer' })
            .send({ firstName: 'x' });
        expect(res.status).toBe(403);
    });

    test('control: PATCH a staff member in the same org still works', async () => {
        const res = await asAdmin(request(app).patch('/api/provider/directory/staff-1')).send({ firstName: 'สมศักดิ์' });
        expect(res.status).toBe(200);
        expect(mockUsers.get('staff-1').firstName).toBe('สมศักดิ์');
    });
});

// ── 3. เจ้าหน้าที่เปลี่ยนรหัสของตัวเอง ──────────────────────────────────────────
describe('POST /api/auth/provider/change-password — staff change their own password', () => {
    const asStaff = (req, id = 'staff-1') => req.set('x-test-user-id', id).set('x-test-role', 'document_reviewer');

    test('old + new → 200; the new password verifies, sessions revoked, audit written', async () => {
        const before = Date.now();
        const res = await asStaff(request(app).post('/api/auth/provider/change-password'))
            .send({ oldPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const row = mockUsers.get('staff-1');
        expect(await bcrypt.compare(NEW_PASSWORD, row.password)).toBe(true);
        expect(await bcrypt.compare(OLD_PASSWORD, row.password)).toBe(false);
        expect(row.sessionsRevokedAt).toBeInstanceOf(Date);
        expect(row.sessionsRevokedAt.getTime()).toBeGreaterThan(before);
        expect(mockRevokeAll).toHaveBeenCalledWith('staff-1');
        expect(mockLogAuth).toHaveBeenCalledTimes(1);
        expect(mockLogAuth.mock.calls[0].slice(0, 4)).toEqual(['PASSWORD_CHANGE', 'staff-1', 'PROVIDER', 'SUCCESS']);
    });

    test('changes only the caller: a userId in the body is ignored', async () => {
        const res = await asStaff(request(app).post('/api/auth/provider/change-password'))
            .send({ oldPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, userId: 'admin-1', id: 'admin-1' });
        expect(res.status).toBe(200);
        expect(mockUsers.get('admin-1').password).toBe(HASHES.admin);
    });

    test('wrong old password → the same 400 as the health door, hash unchanged', async () => {
        const staffRes = await asStaff(request(app).post('/api/auth/provider/change-password'))
            .send({ oldPassword: 'Wrong#Pass2026', newPassword: NEW_PASSWORD });
        const healthRes = await request(app).post('/api/auth/health/change-password')
            .set('x-test-user-id', 'farmer-1').set('x-test-role', 'health')
            .send({ oldPassword: 'Wrong#Pass2026', newPassword: NEW_PASSWORD });
        expect(staffRes.status).toBe(400);
        expect(staffRes.body.code).toBe('INVALID_CREDENTIALS');
        expect(staffRes.status).toBe(healthRes.status);
        expect(staffRes.body.code).toBe(healthRes.body.code);
        expect(staffRes.body.error).toBe(healthRes.body.error);
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
        expect(mockUsers.get('farmer-1').password).toBe(HASHES.farmer);
    });

    test('a weak new password → 400 VALIDATION_ERROR (the registration policy), hash unchanged', async () => {
        const res = await asStaff(request(app).post('/api/auth/provider/change-password'))
            .send({ oldPassword: OLD_PASSWORD, newPassword: 'short' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
    });

    test('no old password → 400, hash unchanged', async () => {
        const res = await asStaff(request(app).post('/api/auth/provider/change-password'))
            .send({ newPassword: NEW_PASSWORD });
        expect(res.status).toBe(400);
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
    });

    test('not signed in → 401', async () => {
        const res = await request(app).post('/api/auth/provider/change-password')
            .send({ oldPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(401);
        expect(mockUsers.get('staff-1').password).toBe(HASHES.staff);
    });
});

// ── นับครั้งที่ผิดต่อบัญชี (security re-review round 2, LOW) ─────────────────────────
// limiter ของ server.js นับต่อ IP เท่านั้น: session ที่ถูกขโมยเดารหัสเดิมได้ 10 ครั้ง/15 นาที/IP และเปลี่ยน IP ได้
// ใช้ตัวนับเดียวกับการล็อกอิน (loginAttempts / isLocked / lockedUntil — 5 ครั้ง ล็อก 15 นาที) ทั้งสองประตู
describe('change-password counts failures per account (the login lockout)', () => {
    const doors = [
        ['provider', '/api/auth/provider/change-password', 'staff-1', 'document_reviewer', OLD_PASSWORD, 'PROVIDER'],
        ['health', '/api/auth/health/change-password', 'farmer-1', 'health', FARMER_PASSWORD, 'HEALTH'],
    ];
    const post = (path, id, role, body) => request(app).post(path)
        .set('x-test-user-id', id).set('x-test-role', role).send(body);

    test.each(doors)('%s: the 5th wrong current password locks the account for 15 minutes', async (_d, path, id, role) => {
        for (let i = 1; i <= 4; i += 1) {
            const res = await post(path, id, role, { oldPassword: `Wrong#Pass${i}000`, newPassword: NEW_PASSWORD });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVALID_CREDENTIALS');
            expect(mockUsers.get(id).loginAttempts).toBe(i);
        }
        const fifth = await post(path, id, role, { oldPassword: 'Wrong#Pass5000', newPassword: NEW_PASSWORD });
        expect(fifth.status).toBe(423);
        expect(fifth.body.code).toBe('ACCOUNT_LOCKED');
        const row = mockUsers.get(id);
        expect(row.isLocked).toBe(true);
        const minutes = (new Date(row.lockedUntil).getTime() - Date.now()) / 60000;
        expect(minutes).toBeGreaterThan(14);
        expect(minutes).toBeLessThanOrEqual(15);
    });

    test.each(doors)('%s: while locked, even the right current password changes nothing', async (_d, path, id, role, oldPw) => {
        const before = mockUsers.get(id).password;
        Object.assign(mockUsers.get(id), { loginAttempts: 5, isLocked: true, lockedUntil: new Date(Date.now() + 10 * 60000) });
        const res = await post(path, id, role, { oldPassword: oldPw, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(423);
        expect(res.body.code).toBe('ACCOUNT_LOCKED');
        expect(mockUsers.get(id).password).toBe(before);
    });

    test.each(doors)('%s: an expired lock clears itself and a right change resets the count', async (_d, path, id, role, oldPw) => {
        Object.assign(mockUsers.get(id), { loginAttempts: 5, isLocked: true, lockedUntil: new Date(Date.now() - 60000) });
        const res = await post(path, id, role, { oldPassword: oldPw, newPassword: NEW_PASSWORD });
        expect(res.status).toBe(200);
        const row = mockUsers.get(id);
        expect(await bcrypt.compare(NEW_PASSWORD, row.password)).toBe(true);
        expect(row).toEqual(expect.objectContaining({ loginAttempts: 0, isLocked: false, lockedUntil: null }));
    });

    test.each(doors)('%s: a failed attempt is audited as FAILURE, with no password material', async (_d, path, id, role, _pw, actorType) => {
        const wrong = 'Wrong#Secret9876';
        await post(path, id, role, { oldPassword: wrong, newPassword: NEW_PASSWORD });
        expect(mockLogAuth).toHaveBeenCalledTimes(1);
        const call = mockLogAuth.mock.calls[0];
        expect(call.slice(0, 4)).toEqual(['PASSWORD_CHANGE', id, actorType, 'FAILURE']);
        expect(call[6]).toEqual({ reason: 'WRONG_CURRENT_PASSWORD', failedAttempts: 1 });
        const flat = JSON.stringify(call);
        expect(flat).not.toContain(wrong);
        expect(flat).not.toContain(NEW_PASSWORD);
        expect(flat).not.toContain('$2'); // no bcrypt hash either
    });

    test('the lock that locks the change door also locks sign-in (one counter, not two)', async () => {
        const path = '/api/auth/provider/change-password';
        for (let i = 1; i <= 5; i += 1) {
            await post(path, 'staff-1', 'document_reviewer', { oldPassword: `Wrong#Pass${i}000`, newPassword: NEW_PASSWORD });
        }
        const row = mockUsers.get('staff-1');
        // The same three columns the provider login reads (auth-provider.js lockout check).
        expect(row.isLocked).toBe(true);
        expect(row.loginAttempts).toBe(5);
        expect(new Date(row.lockedUntil).getTime()).toBeGreaterThan(Date.now());
    });
});

// ── rate limit: ตัวเดียวกันครอบทั้งสองประตูเปลี่ยนรหัส ────────────────────────────
describe('server.js mounts one change-password limiter on both doors, both prefixes', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    test('the limiter exists and counts failures only', () => {
        const block = src.match(/const changePasswordLimiter = rateLimit\(\{[\s\S]*?\n\}\);/);
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/skipSuccessfulRequests: true/);
        expect(block[0]).toMatch(/keyGenerator: req => getRequestIp\(req\)/);
    });
    test.each(['health', 'provider'])('mounted on /auth/%s/change-password inside the prefix loop', (who) => {
        const loop = src.match(/for \(const prefix of \['\/api', '\/api\/v1'\]\) \{[\s\S]*?\n\}/);
        expect(loop).not.toBeNull();
        expect(loop[0]).toContain(`app.use(\`\${prefix}/auth/${who}/change-password\`, changePasswordLimiter);`);
    });
});
