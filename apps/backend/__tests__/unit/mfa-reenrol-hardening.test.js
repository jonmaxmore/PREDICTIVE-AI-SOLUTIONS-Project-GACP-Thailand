'use strict';

/**
 * Re-enrolling an enabled 2FA: the CONSUMING door (/verify-setup) is guarded too
 * (round 5 of fix/no-recovery, 2026-09-26).
 *
 * Security re-review reports/security/2026-09-26-no-recovery-round34-review.md (MEDIUM):
 * /setup needs the current code and is rate-limited, but /verify-setup, the door that
 * USES the pending secret, had no limiter, no attempt counter and no link to the
 * session that started it. The reviewer's case D1: 40 wrong guesses → 40x400, and the
 * slot survives. E1: any session of that user with a valid code for the pending secret
 * got the 10 new backup codes.
 *
 * Pinned here through the real mfa router, the real rate limiter (memory store) and
 * the real token-revocation / session-revocation / password-management modules. The
 * users table and Redis are in memory (no Postgres or Redis on the machine that runs this).
 *   1. /verify-setup goes through the /disable limiter; the pending entry is bound to
 *      the session that created it; 5 wrong codes delete it (restart with the current code).
 *   2. the pending entry is deleted on /disable, password change, logout and
 *      revoke-all-sessions.
 *   3. a successful re-enrol revokes the account's other sessions (sessionsRevokedAt)
 *      and keeps the current one (a fresh cookie whose iat is not before the stamp).
 */

process.env.BCRYPT_ROUNDS = '4';

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwtConfig = require('../../config/jwt-security');
const { mfaService } = require('../../middleware/mfa-service');
const { isTokenBeforeSessionEpoch } = require('../../utils/session-epoch');

const mockUsers = new Map();
const mockRedis = new Map();

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

// Session identity comes from headers: x-test-jti is the token id of "this session".
jest.mock('../../middleware/auth-middleware', () => {
    const fromHeaders = (req, res, next) => {
        const id = req.headers['x-test-user-id'];
        if (!id) { return res.status(401).json({ success: false, code: 'AUTH_ERROR' }); }
        req.user = {
            id,
            uuid: `uuid-${id}`,
            email: `${id}@example.test`,
            role: 'document_reviewer',
            canonicalRole: 'document_reviewer',
            authType: 'PROVIDER_ID',
            userType: 'PROVIDER_ID',
            organizationId: 'org-1',
            jti: req.headers['x-test-jti'],
        };
        return next();
    };
    return { authenticateProvider: fromHeaders, authenticateAny: fromHeaders, isTokenBeforeSessionEpoch: () => false };
});

// In-memory Redis. `mockLag.ms` adds a round-trip delay to every call so that
// parallel requests really interleave, as they do against a networked Redis.
const mockLag = { ms: 0 };
jest.mock('../../services/redis-service', () => {
    class RedisUnavailableError extends Error {}
    const lag = () => new Promise((r) => setTimeout(r, mockLag.ms));
    const incr = (k) => { const n = Number(mockRedis.get(k) || 0) + 1; mockRedis.set(k, String(n)); return n; };
    // the raw ioredis surface the rate limiter and the attempt counter use
    const client = {
        status: 'ready',
        incr: jest.fn(async (k) => { await lag(); return incr(k); }),
        pexpire: jest.fn(async () => { await lag(); return 1; }),
        keys: jest.fn(async () => []),
        del: jest.fn(async (...ks) => { await lag(); ks.forEach((k) => mockRedis.delete(k)); return ks.length; }),
        pipeline() {
            const ops = [];
            const p = {
                incr(k) { ops.push(() => incr(k)); return p; },
                pexpire() { ops.push(() => 1); return p; },
                pttl() { ops.push(() => 600000); return p; },
                del(k) { ops.push(() => (mockRedis.delete(k) ? 1 : 0)); return p; },
                async exec() { await lag(); return ops.map((op) => [null, op()]); },
            };
            return p;
        },
    };
    const svc = {
        client,
        isConnected: true,
        getStrict: jest.fn(async (k) => { await lag(); return mockRedis.has(k) ? JSON.parse(mockRedis.get(k)) : null; }),
        get: jest.fn(async (k) => (mockRedis.has(k) ? JSON.parse(mockRedis.get(k)) : null)),
        setStrict: jest.fn(async (k, v) => { await lag(); mockRedis.set(k, JSON.stringify(v)); return true; }),
        set: jest.fn(async (k, v) => { mockRedis.set(k, JSON.stringify(v)); return true; }),
        delStrict: jest.fn(async (k) => { await lag(); mockRedis.delete(k); return true; }),
        del: jest.fn(async (k) => { mockRedis.delete(k); return true; }),
        setNX: jest.fn(async () => true),
    };
    return Object.assign(svc, { RedisUnavailableError });
});

// The real rate limiter falls back to its memory store; keep config/redis out of it.
jest.mock('../../config/redis', () => null);

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findUnique: jest.fn(async ({ where }) => (mockUsers.has(where.id) ? { ...mockUsers.get(where.id) } : null)),
            update: jest.fn(async ({ where, data }) => Object.assign(mockUsers.get(where.id), data)),
        },
    },
}));

jest.mock('../../services/identity-service', () => {
    const row = (id) => mockUsers.get(id);
    return {
        getMfaStatus: jest.fn(async (id) => ({ twoFactorEnabled: row(id).twoFactorEnabled })),
        findMfaSecretForDisable: jest.fn(async (id) => ({ twoFactorSecret: row(id).twoFactorSecret, twoFactorEnabled: row(id).twoFactorEnabled })),
        storePendingTotpSecret: jest.fn(),
        findPendingTotpSecret: jest.fn(),
        enableMfaWithBackupCodes: jest.fn(),
        replaceTotpSecretWithBackupCodes: jest.fn(async (id, secret, codes, extra = {}) => Object.assign(row(id), {
            twoFactorSecret: secret, twoFactorEnabled: true, twoFactorBackupCodes: codes, ...extra,
        })),
        disableMfa: jest.fn(async (id) => Object.assign(row(id), { twoFactorEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: null })),
    };
});

const mockAudit = jest.fn(async () => {});
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAudit(...a), logAuth: jest.fn(), logSecurity: jest.fn() },
    AuditCategory: { SECURITY: 'SECURITY', AUTHENTICATION: 'AUTHENTICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { USER: 'USER' },
}));

const app = express();
app.use(express.json());
// A test can pick the caller's address, the way separate attackers would have separate ones.
app.use((req, _res, next) => { req.clientIp = req.headers['x-test-ip'] || '10.0.0.1'; next(); });
app.use('/api/mfa', require('../../routes/api/identity/mfa'));

const PENDING = 'mfa:reenrol:staff-1';
let OLD_SECRET;
let ipSeq = 0;
const freshIp = () => { ipSeq += 1; return `10.1.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`; };
const as = (req, { jti = 'session-A', ip = freshIp() } = {}) => req
    .set('x-test-user-id', 'staff-1').set('x-test-jti', jti).set('x-test-ip', ip);

async function startReenrol(jti = 'session-A') {
    const res = await as(request(app).post('/api/mfa/setup'), { jti }).send({ code: mfaService.generateTOTP(OLD_SECRET) });
    expect(res.status).toBe(200);
    return res.body.data.secret;
}
function wrongCode(newSecret) {
    // any 6 digits that the new secret does not accept right now
    for (let n = 0; ; n += 1) {
        const c = String(n).padStart(6, '0');
        if (!mfaService.verifyTOTP(newSecret, c)) { return c; }
    }
}
function expectOldFactorIntact() {
    const r = mockUsers.get('staff-1');
    expect(r.twoFactorEnabled).toBe(true);
    expect(r.twoFactorSecret).toBe(OLD_SECRET);
    expect(r.twoFactorBackupCodes).toEqual(['old-h1']);
}

beforeEach(async () => {
    jest.clearAllMocks();
    mockLag.ms = 0;
    mockRedis.clear();
    mockUsers.clear();
    OLD_SECRET = mfaService.generateSecret();
    mockUsers.set('staff-1', {
        id: 'staff-1', twoFactorEnabled: true, twoFactorSecret: OLD_SECRET, twoFactorBackupCodes: ['old-h1'],
        password: await bcrypt.hash('OldStaff#Pass2026', 4), healthId: null, providerId: '2222222222222',
        loginAttempts: 0, isLocked: false, lockedUntil: null, sessionsRevokedAt: null,
    });
});

describe('the reviewer\'s 40-guess case on /verify-setup', () => {
    test('40 wrong codes from 40 addresses: the pending secret is deleted after the 5th, and nothing is ever swapped', async () => {
        const newSecret = await startReenrol();
        const wrong = wrongCode(newSecret);
        const statuses = [];
        for (let i = 0; i < 40; i += 1) {
            const res = await as(request(app).post('/api/mfa/verify-setup')).send({ code: wrong });
            statuses.push(res.status);
            if (i === 4) {
                expect(res.body.code).toBe('MFA_REENROL_RESTART');
                expect(mockRedis.has(PENDING)).toBe(false);
            }
        }
        expect(statuses.every((s) => s === 400)).toBe(true);
        expect(mockRedis.has(PENDING)).toBe(false);
        // the right code for the new secret is useless now: restart from /setup with the current code
        const late = await as(request(app).post('/api/mfa/verify-setup')).send({ code: mfaService.generateTOTP(newSecret) });
        expect(late.status).toBe(400);
        expect(late.body.data?.backupCodes).toBeUndefined();
        expectOldFactorIntact();
    });

    test('from ONE address the /disable limiter answers 429 after 5 attempts', async () => {
        const newSecret = await startReenrol();
        const wrong = wrongCode(newSecret);
        const ip = '10.9.9.9';
        const statuses = [];
        for (let i = 0; i < 8; i += 1) {
            const res = await as(request(app).post('/api/mfa/verify-setup'), { ip }).send({ code: wrong });
            statuses.push(res.status);
        }
        expect(statuses.slice(5)).toEqual([429, 429, 429]);
        expectOldFactorIntact();
    });
});

describe('the pending secret belongs to the session that started it', () => {
    test('another session of the same user with a VALID code for the pending secret is refused, gets no backup codes', async () => {
        const newSecret = await startReenrol('session-A');
        const res = await as(request(app).post('/api/mfa/verify-setup'), { jti: 'session-B' }).send({ code: mfaService.generateTOTP(newSecret) });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('MFA_REENROL_SESSION_MISMATCH');
        expect(res.body.data?.backupCodes).toBeUndefined();
        expectOldFactorIntact();
    });

    test('a session without a token id cannot finish a re-enrol', async () => {
        const newSecret = await startReenrol('session-A');
        const res = await as(request(app).post('/api/mfa/verify-setup'), { jti: '' }).send({ code: mfaService.generateTOTP(newSecret) });
        expect(res.status).toBe(403);
        expectOldFactorIntact();
    });
});

describe('a successful re-enrol revokes the other sessions and keeps this one', () => {
    test('sessionsRevokedAt is stamped, the refresh tokens are revoked, the caller gets a fresh cookie that survives the stamp', async () => {
        const newSecret = await startReenrol('session-A');
        const before = Math.floor(Date.now() / 1000) - 5;
        const res = await as(request(app).post('/api/mfa/verify-setup'), { jti: 'session-A' }).send({ code: mfaService.generateTOTP(newSecret) });
        expect(res.status).toBe(200);
        const row = mockUsers.get('staff-1');
        expect(row.twoFactorSecret).toBe(newSecret);
        expect(row.sessionsRevokedAt).toBeInstanceOf(Date);

        // another session minted before the swap is now evicted by the epoch check
        expect(isTokenBeforeSessionEpoch({ iat: before }, row.sessionsRevokedAt)).toBe(true);

        // this session carries on with a fresh provider token that is NOT before the stamp
        const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('provider_token='));
        expect(cookie).toBeDefined();
        const token = cookie.split(';')[0].slice('provider_token='.length);
        const decoded = jwtConfig.verifyToken(token, 'provider');
        expect(decoded.id).toBe('staff-1');
        expect(isTokenBeforeSessionEpoch(decoded, row.sessionsRevokedAt)).toBe(false);

        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'MFA_REENROLLED', metadata: expect.objectContaining({ otherSessionsRevoked: true }),
        }));
        expect(mockRedis.has(PENDING)).toBe(false);
    });
});

describe('the pending secret is deleted when the account\'s security state changes', () => {
    test('DELETE /api/mfa/disable', async () => {
        await startReenrol();
        const res = await as(request(app).delete('/api/mfa/disable')).send({ code: mfaService.generateTOTP(OLD_SECRET) });
        expect(res.status).toBe(200);
        expect(mockRedis.has(PENDING)).toBe(false);
    });

    test('password change (the function behind both change-password doors)', async () => {
        await startReenrol();
        await require('../../services/auth/password-management').changePassword('staff-1', 'OldStaff#Pass2026', 'NewStaff#Pass2027');
        expect(mockRedis.has(PENDING)).toBe(false);
    });

    test('logout (the session revocation both logout doors run)', async () => {
        await startReenrol();
        const token = jwtConfig.generateToken({ id: 'staff-1', role: 'document_reviewer' }, 'provider');
        const { revokeSessionFromRequest } = require('../../utils/session-revocation');
        await revokeSessionFromRequest({ headers: { authorization: `Bearer ${token}` }, cookies: {}, body: {} }, 'provider');
        expect(mockRedis.has(PENDING)).toBe(false);
    });

    test('revoke all of the account\'s sessions', async () => {
        await startReenrol();
        await require('../../services/token-revocation-service').revokeAllUserTokens('staff-1');
        expect(mockRedis.has(PENDING)).toBe(false);
    });
});

// Round 6 (security re-review round 5, LOW): the failure count was read-modify-write,
// so k parallel wrong codes (same session, k addresses) all read the same count.
// Measured by the reviewer against a real Redis: k=5 → 15 codes checked, k=20 → 60.
// The count is now an atomic INCR taken BEFORE the code is checked, so at most 5
// codes are ever checked against one pending secret, whatever k is.
describe('parallel wrong codes: at most 5 checks against the pending secret in total', () => {
    test.each([5, 20])('k=%i parallel guesses per round, each from its own address', async (k) => {
        const newSecret = await startReenrol('session-A');
        const wrong = wrongCode(newSecret);
        const verify = jest.spyOn(mfaService, 'verifyTOTP');
        mockLag.ms = 3;
        for (let round = 0; round < 6 && mockRedis.has(PENDING); round += 1) {
            await Promise.all(Array.from({ length: k }, () => as(request(app).post('/api/mfa/verify-setup')).send({ code: wrong })));
        }
        const checksAgainstPending = verify.mock.calls.filter(([secret]) => secret === newSecret).length;
        verify.mockRestore();
        expect(mockRedis.has(PENDING)).toBe(false);
        expect(checksAgainstPending).toBeLessThanOrEqual(5);
        expectOldFactorIntact();
    });
});

