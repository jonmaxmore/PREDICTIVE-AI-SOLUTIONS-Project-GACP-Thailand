'use strict';

/**
 * POST /api/mfa/setup ต้องไม่ปิดหรือเขียนทับ 2FA ที่เปิดอยู่โดยไม่มีหลักฐาน (round 4, 2026-09-26)
 *
 * ที่มา: round 3 เจอว่า /mfa/setup รับ session ปกติ แล้ว storePendingTotpSecret ตั้ง twoFactorEnabled=false
 * และเขียน secret ใหม่ทับทันที โดยไม่ขอรหัส — session ที่ถูกขโมยจึงถอด 2FA ได้โดยไม่ต้องมีรหัสที่
 * DELETE /mfa/disable ขอ ซึ่งขัดกับมติ "ถอดทั้งสองประตู" (ไม่มีใครล้าง 2FA โดยไม่มีหลักฐาน)
 *
 * สัญญาที่ตรึง:
 *   - บัญชีที่เปิด 2FA อยู่: /setup ต้องมีรหัส TOTP ปัจจุบัน (ตัวตรวจเดียวกับ /disable, ผิด/ไม่มี → 401)
 *   - secret ใหม่ไม่แทนของเดิมจนกว่า /verify-setup ยืนยันด้วยรหัสจาก secret ใหม่ — ระหว่างนั้น 2FA เดิมยังใช้งาน
 *   - เปลี่ยนสำเร็จ → audit MFA_REENROLLED · ถูกปฏิเสธ → audit MFA_REENROL_REFUSED
 *   - บัญชีที่ยังไม่เปิด 2FA: /setup ทำงานเหมือนเดิม (ไม่ต้องมีรหัส)
 *
 * router จริงผ่าน supertest · แถว users และ redis อยู่ในหน่วยความจำ (ไม่มี Postgres/Redis ในเครื่องที่รัน)
 */

const express = require('express');
const request = require('supertest');
const { mfaService } = require('../../middleware/mfa-service');

const mockUsers = new Map();
const mockRedis = new Map();
const mockRedisState = { down: false };
const mockLimiterCalls = [];

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

jest.mock('../../middleware/auth-middleware', () => {
    const fromHeaders = (req, res, next) => {
        const id = req.headers['x-test-user-id'];
        if (!id) { return res.status(401).json({ success: false, code: 'AUTH_ERROR' }); }
        // jti: the session's token id — a re-enrol is bound to the session that started it (round 5)
        req.user = { id, role: 'document_reviewer', canonicalRole: 'document_reviewer', email: `${id}@example.test`, jti: `session-of-${id}` };
        return next();
    };
    return { authenticateProvider: fromHeaders, authenticateAny: fromHeaders, isTokenBeforeSessionEpoch: () => false };
});

// The limiter is observed, not exercised: the file records which requests pass through it.
jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (req, _res, next) => { mockLimiterCalls.push(`${req.method} ${req.path}`); next(); },
}));

jest.mock('../../services/redis-service', () => {
    class RedisUnavailableError extends Error {}
    const guard = () => { if (mockRedisState.down) { throw new RedisUnavailableError('redis down'); } };
    // raw client for the atomic attempt counter (round 6): INCR in a pipeline
    const client = {
        pipeline() {
            const ops = [];
            const p = {
                incr(k) { ops.push(() => { const n = Number(mockRedis.get(k) || 0) + 1; mockRedis.set(k, String(n)); return n; }); return p; },
                pexpire() { ops.push(() => 1); return p; },
                async exec() { guard(); return ops.map((op) => [null, op()]); },
            };
            return p;
        },
    };
    const svc = {
        client,
        get isConnected() { return !mockRedisState.down; },
        getStrict: jest.fn(async (k) => { guard(); return mockRedis.has(k) ? JSON.parse(mockRedis.get(k)) : null; }),
        setStrict: jest.fn(async (k, v) => { guard(); mockRedis.set(k, JSON.stringify(v)); return true; }),
        delStrict: jest.fn(async (k) => { guard(); mockRedis.delete(k); return true; }),
        del: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
        setNX: jest.fn(async () => true),
    };
    return Object.assign(svc, { RedisUnavailableError });
});

jest.mock('../../services/identity-service', () => {
    const row = (id) => mockUsers.get(id);
    return {
        getMfaStatus: jest.fn(async (id) => (row(id) ? { twoFactorEnabled: row(id).twoFactorEnabled } : null)),
        findMfaSecretForDisable: jest.fn(async (id) => (row(id) ? { twoFactorSecret: row(id).twoFactorSecret, twoFactorEnabled: row(id).twoFactorEnabled } : null)),
        storePendingTotpSecret: jest.fn(async (id, secret) => Object.assign(row(id), { twoFactorSecret: secret, twoFactorEnabled: false })),
        findPendingTotpSecret: jest.fn(async (id) => ({ twoFactorSecret: row(id)?.twoFactorSecret })),
        enableMfaWithBackupCodes: jest.fn(async (id, codes) => Object.assign(row(id), { twoFactorEnabled: true, twoFactorBackupCodes: codes })),
        replaceTotpSecretWithBackupCodes: jest.fn(async (id, secret, codes) => Object.assign(row(id), { twoFactorSecret: secret, twoFactorEnabled: true, twoFactorBackupCodes: codes })),
        disableMfa: jest.fn(),
    };
});

const mockAudit = jest.fn(async () => {});
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAudit(...a) },
    AuditCategory: { SECURITY: 'SECURITY' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { USER: 'USER' },
}));

const app = express();
app.use(express.json());
app.use('/api/mfa', require('../../routes/api/identity/mfa'));

let OLD_SECRET;
const as = (req, id = 'staff-1') => req.set('x-test-user-id', id);
const actions = () => mockAudit.mock.calls.map(([e]) => e.action);

beforeEach(() => {
    jest.clearAllMocks();
    mockLimiterCalls.length = 0;
    mockRedis.clear();
    mockRedisState.down = false;
    mockUsers.clear();
    OLD_SECRET = mfaService.generateSecret();
    mockUsers.set('staff-1', { id: 'staff-1', twoFactorEnabled: true, twoFactorSecret: OLD_SECRET, twoFactorBackupCodes: ['old-h1'] });
    mockUsers.set('fresh-1', { id: 'fresh-1', twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: null });
});

function expectOldFactorIntact() {
    const r = mockUsers.get('staff-1');
    expect(r.twoFactorEnabled).toBe(true);
    expect(r.twoFactorSecret).toBe(OLD_SECRET);
    expect(r.twoFactorBackupCodes).toEqual(['old-h1']);
}

describe('enabled 2FA: /setup needs the current code', () => {
    test('a session without a code cannot re-run setup — 401, the enabled factor is untouched', async () => {
        const res = await as(request(app).post('/api/mfa/setup')).send({});
        expect(res.status).toBe(401);
        expect(res.body.data?.secret).toBeUndefined();
        expectOldFactorIntact();
        expect(actions()).toContain('MFA_REENROL_REFUSED');
    });

    test('a wrong current code → 401, untouched (same verifier and answer as /disable)', async () => {
        const res = await as(request(app).post('/api/mfa/setup')).send({ code: '000000' });
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid code');
        expectOldFactorIntact();
    });

    test('the right current code starts a re-enrol, but the old factor stays active until the new one is confirmed', async () => {
        const res = await as(request(app).post('/api/mfa/setup')).send({ code: mfaService.generateTOTP(OLD_SECRET) });
        expect(res.status).toBe(200);
        const newSecret = res.body.data.secret;
        expect(newSecret).toBeTruthy();
        expect(newSecret).not.toBe(OLD_SECRET);
        expectOldFactorIntact();
        expect(actions()).toContain('MFA_REENROL_INITIATED');
    });

    test('verify-setup with a code from the NEW secret swaps the factor and issues new backup codes', async () => {
        const setup = await as(request(app).post('/api/mfa/setup')).send({ code: mfaService.generateTOTP(OLD_SECRET) });
        const newSecret = setup.body.data.secret;
        const res = await as(request(app).post('/api/mfa/verify-setup')).send({ code: mfaService.generateTOTP(newSecret) });
        expect(res.status).toBe(200);
        expect(res.body.data.backupCodes.length).toBeGreaterThan(0);
        const r = mockUsers.get('staff-1');
        expect(r.twoFactorEnabled).toBe(true);
        expect(r.twoFactorSecret).toBe(newSecret);
        expect(r.twoFactorBackupCodes).not.toEqual(['old-h1']);
        expect(mockRedis.size).toBe(0); // the pending secret and its attempt counter are gone
        expect(actions()).toContain('MFA_REENROLLED');
    });

    test('verify-setup with a wrong code keeps the old factor', async () => {
        await as(request(app).post('/api/mfa/setup')).send({ code: mfaService.generateTOTP(OLD_SECRET) });
        const res = await as(request(app).post('/api/mfa/verify-setup')).send({ code: '000000' });
        expect(res.status).toBe(400);
        expectOldFactorIntact();
    });

    test('verify-setup with no re-enrol in progress changes nothing', async () => {
        const res = await as(request(app).post('/api/mfa/verify-setup')).send({ code: mfaService.generateTOTP(OLD_SECRET) });
        expect(res.status).toBe(400);
        expectOldFactorIntact();
    });

    test('the store for the pending secret is down → 503, nothing changed', async () => {
        mockRedisState.down = true;
        const res = await as(request(app).post('/api/mfa/setup')).send({ code: mfaService.generateTOTP(OLD_SECRET) });
        expect(res.status).toBe(503);
        expectOldFactorIntact();
    });

    test('the store goes down between /setup and /verify-setup → 503 at verify, the old factor stays (round 6: the attempt counter is a store write too)', async () => {
        const setup = await as(request(app).post('/api/mfa/setup')).send({ code: mfaService.generateTOTP(OLD_SECRET) });
        mockRedisState.down = true;
        const res = await as(request(app).post('/api/mfa/verify-setup')).send({ code: mfaService.generateTOTP(setup.body.data.secret) });
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('MFA_REENROL_UNAVAILABLE');
        expectOldFactorIntact();
    });

    test('a /setup that carries a code goes through the MFA limiter (the one /disable uses)', async () => {
        await as(request(app).post('/api/mfa/setup')).send({ code: '000000' });
        expect(mockLimiterCalls).toContain('POST /setup');
    });
});

describe('control: 2FA not enabled — first enrolment works as before', () => {
    test('setup without a code → 200, verify-setup → enabled', async () => {
        const setup = await as(request(app).post('/api/mfa/setup'), 'fresh-1').send({});
        expect(setup.status).toBe(200);
        const res = await as(request(app).post('/api/mfa/verify-setup'), 'fresh-1')
            .send({ code: mfaService.generateTOTP(setup.body.data.secret) });
        expect(res.status).toBe(200);
        expect(mockUsers.get('fresh-1').twoFactorEnabled).toBe(true);
        // no code, no limiter: first enrolment is not a guessing surface
        expect(mockLimiterCalls).not.toContain('POST /setup');
    });
});
