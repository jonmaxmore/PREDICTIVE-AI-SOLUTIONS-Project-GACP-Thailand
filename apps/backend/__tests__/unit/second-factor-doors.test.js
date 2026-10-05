'use strict';

/**
 * ไม่มีใครล้าง 2FA ของบัญชีอื่น — มติ operator 2026-09-26 "ถอดทั้งสองประตู"
 * (การกู้ 2FA ไปที่หมอพร้อม · "เราไม่มีการกู้บัญชี" 2026-09-17)
 *
 * ที่มา: reports/security/2026-09-26-no-recovery-round2-review.md (MEDIUM)
 *   a) POST /api/admin/users/:id/force-reset-mfa — ผู้ดูแลล้าง 2FA ของใครก็ได้ในองค์กร (ประตูตายอยู่แล้ว:
 *      เขียนคอลัมน์ twoFactorRecoveryCodes ที่ไม่มีจริง Prisma จึงปฏิเสธทุกครั้ง แต่เทสที่ mock ไว้เขียวตลอด)
 *   b) POST /api/provider/directory/:id/disable-2fa — ผู้ดูแลปิด 2FA ของเจ้าหน้าที่คนอื่น ใช้งานได้จริง
 *
 * ไฟล์นี้เดินคำขอผ่าน router จริงด้วย supertest: ทั้งสองประตูต้องไม่มีเส้นทางรับ (404 ของ express เอง
 * ไม่ใช่ 404 ที่ route ตอบ) และแถวในตาราง users ไม่เปลี่ยน · ตัวควบคุม: เจ้าของบัญชียังปิด 2FA ของตัวเองได้
 * ที่ DELETE /api/mfa/disable ด้วยรหัส TOTP จากแอปของตัวเอง
 *
 * ตาราง users อยู่ในหน่วยความจำ (ไม่มี Postgres ในเครื่องที่รัน) — ทุกทางเขียนลงแถวจริงในตาราง
 */

const express = require('express');
const request = require('supertest');
const { mfaService } = require('../../middleware/mfa-service');

const mockUsers = new Map();
const mockWrite = (id, data) => {
    const row = mockUsers.get(id);
    if (!row) { throw new Error('Record to update not found'); }
    Object.assign(row, data);
    return { ...row };
};

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: jest.fn(async ({ where } = {}) => {
                const row = mockUsers.get(where?.id);
                if (!row || row.isDeleted) { return null; }
                if (where.organizationId !== undefined && where.organizationId !== row.organizationId) { return null; }
                return { ...row };
            }),
            findUnique: jest.fn(async ({ where } = {}) => {
                const row = mockUsers.get(where?.id);
                return row ? { ...row } : null;
            }),
            update: jest.fn(async ({ where, data }) => mockWrite(where.id, data)),
            count: jest.fn(async () => 2),
        },
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

jest.mock('../../middleware/auth-middleware', () => {
    const fromHeaders = (req, res, next) => {
        const id = req.headers['x-test-user-id'];
        if (!id) { return res.status(401).json({ success: false, code: 'AUTH_ERROR' }); }
        const role = req.headers['x-test-role'];
        req.user = { id, role, canonicalRole: role, organizationId: 'org-1' };
        return next();
    };
    return {
        authenticateProvider: fromHeaders,
        authenticateHealth: fromHeaders,
        authenticateAny: fromHeaders,
        authenticateDTAM: fromHeaders,
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

// The admin console's guard + updater, backed by the same table.
jest.mock('../../services/provider-user-service', () => ({
    createProviderUser: jest.fn(),
    listAllUsersForProviderDirectory: jest.fn().mockResolvedValue([]),
    findUserForProviderDirectory: jest.fn().mockResolvedValue(null),
    countOtherActiveAdmins: jest.fn().mockResolvedValue(2),
    searchAdminUsers: jest.fn().mockResolvedValue({ users: [], total: 0 }),
    getActiveAdminUserGuard: jest.fn(async (id) => {
        const row = mockUsers.get(id);
        return row && !row.isDeleted ? { ...row } : null;
    }),
    updateAdminUser: jest.fn(async (id, data) => mockWrite(id, data)),
}));

// The owner's own disable door reads and writes through identity-service.
jest.mock('../../services/identity-service', () => ({
    findMfaSecretForDisable: jest.fn(async (id) => {
        const row = mockUsers.get(id);
        return row ? { twoFactorSecret: row.twoFactorSecret, twoFactorEnabled: row.twoFactorEnabled } : null;
    }),
    disableMfa: jest.fn(async (id) => mockWrite(id, {
        twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: null,
    })),
}));

const mockAuditLog = jest.fn().mockResolvedValue(null);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a), logAuth: jest.fn(), logSecurity: jest.fn() },
    AuditCategory: { ADMIN: 'ADMIN', SECURITY: 'SECURITY', AUTHENTICATION: 'AUTHENTICATION' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { USER: 'USER' },
}));

const app = express();
app.use(express.json());
// routes/api/index.js authenticates before this router (it carries only requireAdmin).
app.use('/api/admin/users', require('../../middleware/auth-middleware').authenticateProvider, require('../../routes/api/admin/users'));
app.use('/api/provider/directory', require('../../routes/api/system/provider'));
app.use('/api/mfa', require('../../routes/api/identity/mfa'));

let SECRETS;
function seed() {
    mockUsers.clear();
    const base = { isDeleted: false, status: 'ACTIVE', organizationId: 'org-1', twoFactorEnabled: true, twoFactorBackupCodes: ['h1', 'h2'] };
    mockUsers.set('admin-1', { ...base, id: 'admin-1', role: 'system_admin_dtam', providerId: '1111111111111', twoFactorSecret: SECRETS.admin });
    mockUsers.set('staff-1', { ...base, id: 'staff-1', role: 'document_reviewer', providerId: '2222222222222', twoFactorSecret: SECRETS.staff });
    mockUsers.set('farmer-1', { ...base, id: 'farmer-1', role: 'health', providerId: null, twoFactorSecret: SECRETS.farmer });
}

const asAdmin = (req) => req.set('x-test-user-id', 'admin-1').set('x-test-role', 'system_admin_dtam');
const asPlatform = (req) => req.set('x-test-user-id', 'admin-1').set('x-test-role', 'system_admin_platform');

// Express's own final handler answers an unmatched route with an HTML
// "Cannot POST …" page. A route that exists and answers 404 sends JSON. The
// difference is what proves the door is gone rather than merely refusing.
function expectNoRoute(res, method, path) {
    expect(res.status).toBe(404);
    expect(res.text).toContain(`Cannot ${method} ${path}`);
}

function expectSecondFactorIntact(id) {
    const row = mockUsers.get(id);
    expect(row.twoFactorEnabled).toBe(true);
    expect(row.twoFactorSecret).toBe(SECRETS[id.split('-')[0]]);
    expect(row.twoFactorBackupCodes).toEqual(['h1', 'h2']);
}

beforeAll(() => {
    SECRETS = { admin: mfaService.generateSecret(), staff: mfaService.generateSecret(), farmer: mfaService.generateSecret() };
});
beforeEach(() => {
    jest.clearAllMocks();
    seed();
});

describe('no door clears another account\'s second factor', () => {
    test.each(['farmer-1', 'staff-1'])('POST /api/admin/users/%s/force-reset-mfa reaches no route; 2FA intact', async (id) => {
        const path = `/api/admin/users/${id}/force-reset-mfa`;
        const res = await asAdmin(request(app).post(path)).send({ reason: 'lost the phone, please reset' });
        expectNoRoute(res, 'POST', path);
        expectSecondFactorIntact(id);
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    test.each([asAdmin, asPlatform])('POST /api/provider/directory/staff-1/disable-2fa reaches no route; 2FA intact (%#)', async (as) => {
        const path = '/api/provider/directory/staff-1/disable-2fa';
        const res = await as(request(app).post(path)).send({});
        expectNoRoute(res, 'POST', path);
        expectSecondFactorIntact('staff-1');
    });

    test('an admin cannot use the directory door on their own account either', async () => {
        const path = '/api/provider/directory/admin-1/disable-2fa';
        const res = await asAdmin(request(app).post(path)).send({});
        expectNoRoute(res, 'POST', path);
        expectSecondFactorIntact('admin-1');
    });

    test('control: the directory router still answers its kept lifecycle action (unlock)', async () => {
        mockUsers.get('staff-1').isLocked = true;
        const res = await asAdmin(request(app).post('/api/provider/directory/staff-1/unlock')).send({});
        expect(res.status).toBe(200);
        expect(mockUsers.get('staff-1').isLocked).toBe(false);
        expectSecondFactorIntact('staff-1');
    });
});

describe('control: the owner still turns off their OWN 2FA with a code from their own app', () => {
    const asOwner = (req, id, role) => req.set('x-test-user-id', id).set('x-test-role', role);

    test.each([['staff-1', 'document_reviewer', 'staff'], ['farmer-1', 'health', 'farmer']])(
        'DELETE /api/mfa/disable as %s with a valid TOTP → 200, 2FA off, audit MFA_DISABLED',
        async (id, role, key) => {
            const code = mfaService.generateTOTP(SECRETS[key]);
            const res = await asOwner(request(app).delete('/api/mfa/disable'), id, role).send({ code });
            expect(res.status).toBe(200);
            const row = mockUsers.get(id);
            expect(row.twoFactorEnabled).toBe(false);
            expect(row.twoFactorSecret).toBeNull();
            expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'MFA_DISABLED', actorId: id, resourceId: id }));
        },
    );

    test('a wrong code is refused and nothing changes', async () => {
        const res = await asOwner(request(app).delete('/api/mfa/disable'), 'staff-1', 'document_reviewer').send({ code: '000000' });
        expect(res.status).toBe(401);
        expectSecondFactorIntact('staff-1');
    });

    test('it acts on the caller only: a code from another account\'s app does not work', async () => {
        const code = mfaService.generateTOTP(SECRETS.admin);
        const res = await asOwner(request(app).delete('/api/mfa/disable'), 'staff-1', 'document_reviewer').send({ code, userId: 'admin-1' });
        expect(res.status).toBe(401);
        expectSecondFactorIntact('staff-1');
        expectSecondFactorIntact('admin-1');
    });
});
