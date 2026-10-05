'use strict';

/**
 * SECU-03 — บัญชีที่ถูกระงับ ต้องได้ session ไม่ได้จากประตูใดเลย
 *
 * ผลตรวจ 2026-09-17: แอดมินกด "ระงับ" บัญชีผู้ยื่นคำขอ (HEALTH) แล้ว session เดิมหลุดครั้งเดียว
 * (disableUser ประทับ sessionsRevokedAt) แต่ผู้ใช้ล็อกอินกลับเข้ามาใหม่ได้ทันทีด้วยรหัสผ่านเดิม
 * เพราะ AuthService.login() ไม่เคยอ่าน User.status — ส่วนประตูพนักงาน (auth-provider.js) กับ ThaID
 * (auth-idp.js) ตรวจอยู่แล้ว
 *
 * ไฟล์นี้เดินคำขอผ่าน router จริง (auth-health.js → AuthController → AuthService จริง,
 * bcrypt จริง, jwt-security จริง) และระงับบัญชีด้วย adminUserService.disableUser ตัวจริง
 * สิ่งที่ถูกแทนมีแค่ของที่อยู่นอกโปรเซส: ฐานข้อมูล (ตารางในหน่วยความจำที่เคารพ where/select),
 * Redis, audit log และ upload
 *
 * เรียก `router.handle()` ตรง ๆ ไม่เปิด server (ดูเหตุผลใน password-reset-routes-behaviour.test.js)
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.HEALTH_JWT_SECRET = process.env.HEALTH_JWT_SECRET || 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = process.env.PROVIDER_JWT_SECRET || 'test-only-provider-jwt-secret-32-bytes-exactly-ok';

// ── ตาราง users ในหน่วยความจำ ─────────────────────────────────────────────────
// เคารพ `where` (เท่ากับ, { in }, OR) และ `select` เหมือน Prisma: คอลัมน์ที่ไม่ได้ select
// จะไม่ออกมา ดังนั้นถ้าโค้ดลืม select `status` การตรวจสถานะจะมองไม่เห็นค่า และเทสจะจับได้
const mockUsers = new Map();

function mockMatches(row, where = {}) {
    return Object.entries(where).every(([key, cond]) => {
        if (cond === undefined) { return true; }
        if (key === 'OR') { return cond.some((sub) => mockMatches(row, sub)); }
        if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
            if (Array.isArray(cond.in)) { return cond.in.includes(row[key]); }
            if ('equals' in cond) { return row[key] === cond.equals; }
            if ('not' in cond) { return row[key] !== cond.not; }
            throw new Error(`in-memory users table: unsupported filter on ${key}`);
        }
        return row[key] === cond;
    });
}

function mockProject(row, select) {
    if (!row) { return null; }
    if (!select) { return { ...row }; }
    const out = {};
    for (const [key, on] of Object.entries(select)) {
        if (on) { out[key] = row[key]; }
    }
    return out;
}

function mockFind({ where, select } = {}) {
    const row = [...mockUsers.values()].find((r) => mockMatches(r, where));
    return Promise.resolve(mockProject(row, select));
}

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: {
            findFirst: (args) => mockFind(args),
            findUnique: (args) => mockFind(args),
            update: ({ where, data, select }) => {
                const row = [...mockUsers.values()].find((r) => mockMatches(r, where));
                if (!row) { return Promise.reject(new Error('Record to update not found')); }
                Object.assign(row, data);
                return Promise.resolve(mockProject(row, select));
            },
            count: () => Promise.resolve(0),
        },
        $queryRawUnsafe: jest.fn(),
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l, stream: { write: jest.fn() } };
});

// Redis-backed session state, kept in memory.
const mockIssuedRefreshJtis = [];
jest.mock('../../services/token-revocation-service', () => ({
    issueRefreshToken: jest.fn(async () => {
        const jti = `rt-${mockIssuedRefreshJtis.length + 1}`;
        mockIssuedRefreshJtis.push(jti);
        return jti;
    }),
    isAccessTokenBlocklisted: jest.fn(async () => false),
    blocklistAccessToken: jest.fn(async () => undefined),
    isRefreshTokenBlocklisted: jest.fn(async () => false),
    isSessionFamilyBlocklisted: jest.fn(async () => false),
    blocklistRefreshToken: jest.fn(async () => undefined),
    invalidateSessionFamily: jest.fn(async () => undefined),
    revokeAllUserTokens: jest.fn(async () => undefined),
}));
jest.mock('../../services/redis-service', () => ({
    setNX: jest.fn(async () => true),
    get: jest.fn(async () => null),
    getStrict: jest.fn(async () => null),
    set: jest.fn(async () => true),
    del: jest.fn(async () => true),
}));

jest.mock('../../middleware/audit-logger', () => {
    const auditLogger = {
        log: jest.fn(async () => ({ id: 'audit' })),
        logAuth: jest.fn(async () => undefined),
        logMany: jest.fn(async () => undefined),
        authEvent: jest.fn((...args) => ({ args })),
    };
    return {
        auditLogger,
        AuditCategory: { SECURITY: 'SECURITY', AUTHENTICATION: 'AUTHENTICATION', DATA_ACCESS: 'DATA_ACCESS' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    };
});

// Not under test: personal-entity bootstrap (register only), uploads, PDPA
// export, notification prefs, the rate limiter and the TOTP maths.
jest.mock('../../services/entity-service', () => ({ ensurePersonalIndividualEntity: jest.fn() }));
jest.mock('../../middleware/upload-middleware', () => ({ single: () => (req, res, next) => next() }));
jest.mock('../../middleware/reject-bad-upload', () => (req, res, next) => next());
jest.mock('../../services/pdpa-service', () => ({}));
jest.mock('../../services/notification-preferences-service', () => ({}));
jest.mock('../../middleware/rate-limiter', () => ({ createRateLimiter: () => (req, res, next) => next() }));
jest.mock('../../middleware/mfa-service', () => ({
    mfaService: { verifyTOTP: jest.fn(() => true), hashBackupCode: jest.fn((c) => `H(${c})`) },
}));
// Fixed caller address, so the MFA challenge's IP/UA binding matches at /verify.
jest.mock('../../utils/client-ip', () => ({ getRequestIp: () => '203.0.113.9' }));

const tokenRevocation = require('../../services/token-revocation-service');
const authHealthRouter = require('../../routes/api/auth/auth-health');
const mfaRouter = require('../../routes/api/identity/mfa');
const adminUserService = require('../../services/admin-user-service');
const AuthService = require('../../services/prisma-auth-service');
const jwtConfig = require('../../config/jwt-security');
const { authenticateHealth, authenticateProvider, authenticateAny } = require('../../middleware/auth-middleware');
const { mintMfaChallengeToken } = require('../../shared/mfa-challenge-binding');

const PASSWORD = 'Correct-Horse-9';
const USER_AGENT = 'secu-03-test-agent/1.0';
const ORG = 'org-default';

function thaiId(prefix12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) { sum += Number(prefix12[i]) * (13 - i); }
    return prefix12 + ((11 - (sum % 11)) % 10);
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

let seq = 0;
function seedApplicant(overrides = {}) {
    seq += 1;
    const nationalId = thaiId(`1100100${String(seq).padStart(5, '0')}`);
    const row = {
        id: `applicant-${seq}`,
        uuid: `uuid-${seq}`,
        email: null,
        firstName: 'สมหญิง',
        lastName: 'ใจดี',
        role: 'health',
        accountType: 'INDIVIDUAL',
        accountTier: 'NORMAL',
        authType: 'HEALTH_ID',
        healthId: nationalId,
        providerId: null,
        canonicalId: nationalId,
        idCardHash: sha256(nationalId),
        healthIdHash: sha256(nationalId),
        providerIdHash: null,
        password: PASSWORD_HASH,
        status: 'ACTIVE',
        isDeleted: false,
        isLocked: false,
        lockedUntil: null,
        loginAttempts: 0,
        lastLoginAt: null,
        twoFactorEnabled: false,
        twoFactorMethod: 'TOTP',
        twoFactorSecret: null,
        twoFactorBackupCodes: null,
        organizationId: ORG,
        sessionsRevokedAt: null,
        ...overrides,
    };
    mockUsers.set(row.id, row);
    return { row, nationalId };
}

let staffSeq = 0;
/** A staff (provider-portal) row — same shape, provider identity. */
function seedStaff(overrides = {}) {
    staffSeq += 1;
    const providerId = thaiId(`3100200${String(staffSeq).padStart(5, '0')}`);
    return seedApplicant({
        id: `staff-${staffSeq}`,
        role: 'field_inspector',
        accountType: 'PROVIDER',
        authType: 'PROVIDER_ID',
        healthId: null,
        providerId,
        canonicalId: providerId,
        idCardHash: sha256(providerId),
        healthIdHash: null,
        providerIdHash: sha256(providerId),
        ...overrides,
    });
}

/** One pass through a real guard; reduced to status/code so a failure never prints a token. */
function guard(middleware, cookies) {
    return new Promise((resolve) => {
        const req = { headers: {}, cookies, path: '/api/secu-03', originalUrl: '/api/secu-03' };
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { resolve({ passed: false, status: this.statusCode, code: body && body.code }); return this; },
        };
        middleware(req, res, (err) => resolve(err
            ? { passed: false, error: err.message }
            : { passed: true, userId: req.user && req.user.id }));
    });
}

/**
 * Wall clock the code under test reads (JWT `iat`, the session-epoch stamp).
 * `advance(1000)` = "the next wall-clock second", the case the epoch stamp
 * (rounded up to a whole second) no longer covers.
 */
function controlClock() {
    const realNow = Date.now.bind(Date);
    let offsetMs = 0;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offsetMs);
    return {
        advance(ms) { offsetMs += ms; },
        restore() { spy.mockRestore(); },
    };
}

/** `iat` (ms) of a token vs the owner's stamp — read without printing the token. */
function issuedNotBeforeStamp(token, userId) {
    const stamp = mockUsers.get(userId).sessionsRevokedAt;
    return Boolean(stamp) && jwt.decode(token).iat * 1000 >= new Date(stamp).getTime();
}

/** The admin console's disable button: PATCH /api/admin/users/:id/disable. */
function disable(row) {
    return adminUserService.disableUser({
        userId: row.id,
        reason: 'ผู้ยื่นแจ้งว่าบัญชีถูกสวมรอย',
        actorId: 'admin-1',
        organizationId: ORG,
    });
}

/** Walk one request through a real router. Cookies set on the response are captured. */
function callRouter(router, method, url, { body = {}, cookies = {}, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const setCookies = {};
        const req = {
            method,
            url,
            originalUrl: url,
            baseUrl: '',
            path: url,
            body,
            headers: { 'user-agent': USER_AGENT, ...headers },
            params: {},
            query: {},
            cookies,
            get: () => undefined,
            header: () => undefined,
        };
        const done = (payload) => resolve({ status: res.statusCode, body: payload, cookies: setCookies, unmatched: false });
        const res = {
            statusCode: 200,
            headersSent: false,
            locals: {},
            status(code) { this.statusCode = code; return this; },
            set() { return this; },
            setHeader() { return this; },
            getHeader() { return undefined; },
            cookie(name, value) { setCookies[name] = value; return this; },
            clearCookie(name) { setCookies[name] = null; return this; },
            json(payload) { done(payload); return this; },
            send(payload) { done(payload); return this; },
            end() { done(undefined); return this; },
        };
        router.handle(req, res, (err) => {
            if (err) { reject(err); return; }
            resolve({ status: null, body: undefined, cookies: setCookies, unmatched: true });
        });
    });
}

const login = (identifier, password = PASSWORD) =>
    callRouter(authHealthRouter, 'POST', '/login', { body: { identifier, password } });

const refresh = (refreshToken) =>
    callRouter(authHealthRouter, 'POST', '/refresh', { body: {}, cookies: { refresh_token: refreshToken } });

function noSessionIssued(res) {
    expect(res.cookies.auth_token || null).toBeNull();
    expect(res.cookies.refresh_token || null).toBeNull();
    expect(res.cookies.provider_token || null).toBeNull();
    expect(res.body?.data?.tokens).toBeUndefined();
    expect(res.body?.data?.accessToken).toBeUndefined();
    expect(res.body?.data?.token).toBeUndefined();
    expect(res.body?.data?.mfa_session).toBeUndefined();
}

async function loginOk(nationalId) {
    const res = await login(nationalId);
    expect(res.status).toBe(200);
    return {
        accessToken: res.body.data.tokens.accessToken,
        refreshToken: res.body.data.tokens.refreshToken,
    };
}

beforeEach(() => {
    mockUsers.clear();
    mockIssuedRefreshJtis.length = 0;
    jest.clearAllMocks();
});

describe('SECU-03 — password login refuses a disabled applicant', () => {
    it('an applicant disabled by an admin cannot log back in with the correct password', async () => {
        const { row, nationalId } = seedApplicant();
        await loginOk(nationalId); // works while ACTIVE

        await disable(row);
        expect(mockUsers.get(row.id).status).toBe('INACTIVE');
        const lastLoginBefore = mockUsers.get(row.id).lastLoginAt;

        const res = await login(nationalId);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        expect(res.body.messageTh).toMatch(/ระงับ/);
        noSessionIssued(res);
        // The refused attempt is not recorded as a successful sign-in.
        expect(mockUsers.get(row.id).lastLoginAt).toBe(lastLoginBefore);
        expect(tokenRevocation.issueRefreshToken).toHaveBeenCalledTimes(1); // the first, ACTIVE login only
    });

    it.each(['SUSPENDED', 'LOCKED', 'INACTIVE'])('status %s is refused', async (status) => {
        const { nationalId } = seedApplicant({ status });

        const res = await login(nationalId);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        noSessionIssued(res);
        expect(tokenRevocation.issueRefreshToken).not.toHaveBeenCalled();
    });

    it('a soft-deleted account is refused even when its status still reads ACTIVE', async () => {
        const { nationalId } = seedApplicant({ isDeleted: true, status: 'ACTIVE' });

        const res = await login(nationalId);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        noSessionIssued(res);
    });

    it('a disabled account with 2FA enrolled is refused, not handed an MFA challenge', async () => {
        const { row, nationalId } = seedApplicant({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        await disable(row);

        const res = await login(nationalId);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        noSessionIssued(res);
    });

    it('a wrong password on a disabled account still answers INVALID_CREDENTIALS (no status oracle)', async () => {
        const { row, nationalId } = seedApplicant();
        await disable(row);

        const res = await login(nationalId, 'not-the-password');

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
        noSessionIssued(res);
    });

    it('a newly registered applicant (PENDING_VERIFICATION) still logs in', async () => {
        const { nationalId } = seedApplicant({ status: 'PENDING_VERIFICATION' });

        const res = await login(nationalId);

        expect(res.status).toBe(200);
        expect(res.cookies.auth_token).toEqual(expect.any(String));
    });

    it('re-enabling the account lets the applicant log in again', async () => {
        const { row, nationalId } = seedApplicant();
        await disable(row);
        expect((await login(nationalId)).status).toBe(403);

        await adminUserService.enableUser({ userId: row.id, actorId: 'admin-1', organizationId: ORG });

        const res = await login(nationalId);
        expect(res.status).toBe(200);
        expect(res.cookies.auth_token).toEqual(expect.any(String));
    });
});

describe('SECU-03 — tokens issued before the account was disabled stop working', () => {
    it('refresh token issued before disableUser is refused (session-epoch stamp)', async () => {
        const { row, nationalId } = seedApplicant();
        const { refreshToken } = await loginOk(nationalId);

        await disable(row);
        const res = await refresh(refreshToken);

        expect(res.status).toBeGreaterThanOrEqual(401);
        expect(res.status).toBeLessThan(404);
        noSessionIssued(res);
    });

    it('refresh token is refused when the account was deactivated by a write that did not stamp the epoch', async () => {
        const { row, nationalId } = seedApplicant();
        const { refreshToken } = await loginOk(nationalId);

        // e.g. a status set straight in the database during an incident.
        mockUsers.get(row.id).status = 'SUSPENDED';
        const res = await refresh(refreshToken);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        noSessionIssued(res);
        expect(tokenRevocation.blocklistRefreshToken).not.toHaveBeenCalled();
    });

    it('refresh token minted after the disable stamp is still refused while the account is disabled', async () => {
        const { row } = seedApplicant();
        await disable(row);
        // Disabled an hour ago; this token was minted afterwards by a door that
        // skipped the status check (before SECU-03: the password login itself).
        mockUsers.get(row.id).sessionsRevokedAt = new Date(Date.now() - 60 * 60 * 1000);
        const refreshToken = jwtConfig.generateRefreshToken(
            { id: row.id, role: 'health', canonicalRole: 'health', organizationId: ORG, sessionFamilyId: 'fam-late' },
            'public',
        );

        const res = await refresh(refreshToken);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        noSessionIssued(res);
    });

    it('refresh token of a PDPA-erased account (isDeleted, status untouched) is refused', async () => {
        const { row, nationalId } = seedApplicant();
        const { refreshToken } = await loginOk(nationalId);

        mockUsers.get(row.id).isDeleted = true;
        const res = await refresh(refreshToken);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        noSessionIssued(res);
    });

    it('an ACTIVE applicant can still refresh', async () => {
        const { nationalId } = seedApplicant({ status: 'PENDING_VERIFICATION' });
        const { refreshToken } = await loginOk(nationalId);

        const res = await refresh(refreshToken);

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    // LOW-1 (PR #858 review): /refresh read the owner without `role`, so a
    // staff row in PENDING_VERIFICATION was judged by the applicant rule and
    // renewed; only the next guard (auth-middleware rejectInactiveAccount)
    // refused it. The refusal belongs at /refresh, with the guard's code.
    it('a staff refresh token is refused at /refresh once the account is PENDING_VERIFICATION', async () => {
        const { row } = seedStaff();
        const refreshToken = jwtConfig.generateRefreshToken(
            { id: row.id, role: row.role, canonicalRole: row.role, organizationId: ORG, sessionFamilyId: 'fam-staff' },
            'public',
        );

        mockUsers.get(row.id).status = 'PENDING_VERIFICATION';
        const res = await refresh(refreshToken);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        noSessionIssued(res);
        expect(tokenRevocation.issueRefreshToken).not.toHaveBeenCalled();
    });

    it('an ACTIVE staff refresh token still renews', async () => {
        const { row } = seedStaff();
        const refreshToken = jwtConfig.generateRefreshToken(
            { id: row.id, role: row.role, canonicalRole: row.role, organizationId: ORG, sessionFamilyId: 'fam-staff-ok' },
            'public',
        );

        const res = await refresh(refreshToken);

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('access token issued before disableUser is refused by authenticateHealth', async () => {
        const { row, nationalId } = seedApplicant();
        const { accessToken } = await loginOk(nationalId);
        const guard = () => new Promise((resolve) => {
            const req = { headers: {}, cookies: { auth_token: accessToken }, path: '/api/auth/health/me' };
            const res = { status: () => res, json: (body) => resolve({ body }) };
            authenticateHealth(req, res, () => resolve({ passed: true }));
        });

        expect((await guard()).passed).toBe(true);

        await disable(row);
        const after = await guard();
        expect(after.passed).toBeUndefined();
        expect(after.body.code).toBe('TOKEN_REVOKED');
    });
});

describe('SECU-03 — every access-token guard reads the owner\'s status itself', () => {
    // token ที่ไม่มีการประทับ sessionsRevokedAt ให้เทียบ: ล็อกอินที่วิ่งแข่งกับปุ่มระงับ (ช่วง bcrypt)
    // ได้ token หลังการประทับ หรือสถานะถูกเขียนตรงในฐานข้อมูลโดยไม่ประทับเลย — ตัวกลางต้องอ่าน status เอง
    // ไม่งั้น token ใช้ได้จนหมดอายุ (HEALTH 24 ชม. / PROVIDER 12 ชม.)
    const seedFor = { health: seedApplicant, provider: seedStaff };
    const cookieFor = { health: 'auth_token', provider: 'provider_token' };

    // [label, middleware, portal]
    const GUARDS = [
        ['authenticateHealth', authenticateHealth, 'health'],
        ['authenticateProvider', authenticateProvider, 'provider'],
        ['authenticateAny (staff token)', authenticateAny, 'provider'],
        ['authenticateAny (applicant token)', authenticateAny, 'health'],
    ];

    /** Mint through the shared mint site while the row is still eligible. */
    async function mintFor(portal, overrides) {
        const { row } = seedFor[portal](overrides);
        const minted = await AuthService.issueTokensForAuthenticatedUser(row);
        return { row, cookies: { [cookieFor[portal]]: minted.token } };
    }

    it.each(GUARDS)('%s refuses a token once the owner is SUSPENDED without an epoch stamp', async (_label, middleware, portal) => {
        const { row, cookies } = await mintFor(portal);
        expect(await guard(middleware, cookies)).toEqual({ passed: true, userId: row.id });

        mockUsers.get(row.id).status = 'SUSPENDED'; // written straight, sessionsRevokedAt untouched
        expect(mockUsers.get(row.id).sessionsRevokedAt).toBeNull();

        expect(await guard(middleware, cookies)).toEqual({ passed: false, status: 403, code: 'ACCOUNT_INACTIVE' });
    });

    it.each(GUARDS)('%s refuses the token of a soft-deleted owner whose status still reads ACTIVE', async (_label, middleware, portal) => {
        const { row, cookies } = await mintFor(portal);

        mockUsers.get(row.id).isDeleted = true; // DELETE /me / PDPA erasure do not touch status

        expect(await guard(middleware, cookies)).toEqual({ passed: false, status: 403, code: 'ACCOUNT_INACTIVE' });
    });

    it.each(GUARDS)('%s refuses a token whose owner row no longer exists', async (_label, middleware, portal) => {
        const { row, cookies } = await mintFor(portal);

        mockUsers.delete(row.id);

        expect(await guard(middleware, cookies)).toEqual({ passed: false, status: 403, code: 'ACCOUNT_INACTIVE' });
    });

    it.each(GUARDS)('%s still admits a legacy lowercase "active" status', async (_label, middleware, portal) => {
        const lower = await mintFor(portal, { status: 'active' });

        expect(await guard(middleware, lower.cookies)).toEqual({ passed: true, userId: lower.row.id });
    });

    it.each(GUARDS.filter(([, , portal]) => portal === 'health'))(
        '%s still admits a PENDING_VERIFICATION applicant (new registrations must log in)',
        async (_label, middleware, portal) => {
            const pending = await mintFor(portal, { status: 'PENDING_VERIFICATION' });

            expect(await guard(middleware, pending.cookies)).toEqual({ passed: true, userId: pending.row.id });
        },
    );

    it.each(GUARDS.filter(([, , portal]) => portal === 'provider'))(
        '%s refuses a staff token once the account is PENDING_VERIFICATION (staff login admits ACTIVE only)',
        async (_label, middleware, portal) => {
            const { row, cookies } = await mintFor(portal);
            expect(await guard(middleware, cookies)).toEqual({ passed: true, userId: row.id });

            mockUsers.get(row.id).status = 'PENDING_VERIFICATION'; // written straight, no epoch stamp

            expect(await guard(middleware, cookies)).toEqual({ passed: false, status: 403, code: 'ACCOUNT_INACTIVE' });
        },
    );

    it('a database outage keeps the applicant keep-alive (status cannot be read, the token is not refused)', async () => {
        const { row, cookies } = await mintFor('health');
        const { prisma } = require('../../services/prisma-database');
        const findUnique = prisma.user.findUnique;
        prisma.user.findUnique = () => Promise.reject(new Error('pool timeout'));
        try {
            expect(await guard(authenticateHealth, cookies)).toEqual({ passed: true, userId: row.id });
        } finally {
            prisma.user.findUnique = findUnique;
        }
    });
});

describe('SECU-03 — MFA completion and the shared mint site refuse a disabled account', () => {
    it('an MFA challenge issued before the disable cannot be completed into a session', async () => {
        const { row } = seedApplicant({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        const mfaSession = mintMfaChallengeToken({
            userId: row.id, method: 'TOTP', ip: '203.0.113.9', userAgent: USER_AGENT, tokenType: 'public',
        });

        await disable(row);
        const res = await callRouter(mfaRouter, 'POST', '/verify', { body: { mfa_session: mfaSession, code: '123456' } });

        expect(res.status).not.toBe(200);
        expect(res.body.success).toBe(false);
        noSessionIssued(res);
    });

    it('an MFA challenge for an ACTIVE account still completes', async () => {
        const { row } = seedApplicant({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        const mfaSession = mintMfaChallengeToken({
            userId: row.id, method: 'TOTP', ip: '203.0.113.9', userAgent: USER_AGENT, tokenType: 'public',
        });

        const res = await callRouter(mfaRouter, 'POST', '/verify', { body: { mfa_session: mfaSession, code: '123456' } });

        expect(res.status).toBe(200);
        expect(res.cookies.auth_token).toEqual(expect.any(String));
    });

    it('a 2FA account whose legacy status reads lowercase "active" can complete MFA', async () => {
        // login() let this row through to the challenge (the shared rule upper-cases);
        // the verify step must apply the same rule, not a case-sensitive `in` filter.
        const { row, nationalId } = seedApplicant({ status: 'active', twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        const challenge = await login(nationalId);
        expect(challenge.status).toBe(200);
        expect(challenge.body.data.mfa_session).toEqual(expect.any(String));

        const res = await callRouter(mfaRouter, 'POST', '/verify', {
            body: { mfa_session: challenge.body.data.mfa_session, code: '123456' },
        });

        expect({ status: res.status, error: res.body && res.body.error }).toEqual({ status: 200, error: undefined });
        expect(res.cookies.auth_token).toEqual(expect.any(String));
        expect(res.body.data.user.id).toBe(row.id);
    });

    it('issueTokensForAuthenticatedUser will not mint for a disabled or deleted account', async () => {
        const { row: disabled } = seedApplicant({ status: 'INACTIVE' });
        const { row: deleted } = seedApplicant({ isDeleted: true });

        // Reduce the outcome to a word so a failure never prints a signed token.
        const outcome = (user) => AuthService.issueTokensForAuthenticatedUser(user)
            .then(() => 'minted', (err) => err.code);

        expect(await outcome(disabled)).toBe('ACCOUNT_INACTIVE');
        expect(await outcome(deleted)).toBe('ACCOUNT_INACTIVE');
        expect(tokenRevocation.issueRefreshToken).not.toHaveBeenCalled();
    });

    it('issueTokensForAuthenticatedUser will not mint for a staff account that is not ACTIVE', async () => {
        const { row: pendingStaff } = seedStaff({ status: 'PENDING_VERIFICATION' });

        const outcome = await AuthService.issueTokensForAuthenticatedUser(pendingStaff)
            .then(() => 'minted', (err) => err.code);

        expect(outcome).toBe('ACCOUNT_INACTIVE');
        expect(tokenRevocation.issueRefreshToken).not.toHaveBeenCalled();
    });
});

describe('SECU-03 — staff complete MFA only while ACTIVE (the staff login rule)', () => {
    const staffChallenge = (row) => mintMfaChallengeToken({
        userId: row.id, method: 'TOTP', ip: '203.0.113.9', userAgent: USER_AGENT, tokenType: 'provider',
    });

    it('a staff challenge cannot complete once the account is PENDING_VERIFICATION', async () => {
        const { row } = seedStaff({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        const mfaSession = staffChallenge(row); // issued by staff login while ACTIVE

        mockUsers.get(row.id).status = 'PENDING_VERIFICATION';
        const res = await callRouter(mfaRouter, 'POST', '/verify', { body: { mfa_session: mfaSession, code: '123456' } });

        expect(res.status).not.toBe(200);
        expect(res.body.success).toBe(false);
        noSessionIssued(res);
    });

    it('an ACTIVE staff challenge still completes into a provider session', async () => {
        const { row } = seedStaff({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });

        const res = await callRouter(mfaRouter, 'POST', '/verify', {
            body: { mfa_session: staffChallenge(row), code: '123456' },
        });

        expect(res.status).toBe(200);
        expect(res.cookies.provider_token).toEqual(expect.any(String));
        expect(res.body.data.user.id).toBe(row.id);
    });
});

describe('SECU-03 — an MFA challenge minted before a session revocation cannot complete', () => {
    const NEW_PASSWORD = 'Brand-New-Horse-77';
    const applicantChallenge = (row) => mintMfaChallengeToken({
        userId: row.id, method: 'TOTP', ip: '203.0.113.9', userAgent: USER_AGENT, tokenType: 'public',
    });
    const verify = (mfaSession) =>
        callRouter(mfaRouter, 'POST', '/verify', { body: { mfa_session: mfaSession, code: '123456' } });

    it('a challenge minted before the owner changed the password is refused, before any code is checked', async () => {
        // Someone holding the old password (and a code) started a login; the owner
        // then changed the password, which ends every session (epoch stamp).
        const { row } = seedApplicant({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        const mfaSession = applicantChallenge(row);

        await AuthService.changePassword(row.id, PASSWORD, NEW_PASSWORD);
        expect(mockUsers.get(row.id).sessionsRevokedAt).toBeInstanceOf(Date);
        const res = await verify(mfaSession);

        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_REVOKED');
        noSessionIssued(res);
        const { mfaService } = require('../../middleware/mfa-service');
        expect(mfaService.verifyTOTP).not.toHaveBeenCalled();
    });

    it('a challenge minted after the password change still completes', async () => {
        const { row } = seedApplicant({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        await AuthService.changePassword(row.id, PASSWORD, NEW_PASSWORD);

        const clock = controlClock();
        try {
            clock.advance(1000); // the next login, a moment later
            const res = await verify(applicantChallenge(row));

            expect(res.status).toBe(200);
            expect(res.cookies.auth_token).toEqual(expect.any(String));
        } finally {
            clock.restore();
        }
    });
});

describe('SECU-03 — a login that races the disable button yields nothing usable', () => {
    // login() reads the row once, before bcrypt (~350 ms at cost 12); /mfa/verify reads it
    // before the code check. If the admin disables the account inside that window, the
    // door still mints — and a mint that lands in the next wall-clock second is NOT older
    // than the epoch stamp. The access-token guards must refuse it by reading the status.
    it('password login: the token minted while disableUser ran is refused by the guards and by /refresh', async () => {
        const { row, nationalId } = seedApplicant();
        const clock = controlClock();
        const realCompare = bcrypt.compare.bind(bcrypt);
        const compare = jest.spyOn(bcrypt, 'compare').mockImplementationOnce(async (plain, hash) => {
            const ok = await realCompare(plain, hash);
            await disable(row);  // the admin clicks "disable" during the compare
            clock.advance(1000); // the mint lands in the next second
            return ok;
        });
        try {
            const res = await login(nationalId);

            expect(mockUsers.get(row.id).status).toBe('INACTIVE');
            // login() checked the row it read before bcrypt, so the race is real:
            expect(res.status).toBe(200);
            const { accessToken, refreshToken } = res.body.data.tokens;
            // ...and the epoch stamp alone cannot catch this token.
            expect(issuedNotBeforeStamp(accessToken, row.id)).toBe(true);

            expect(await guard(authenticateHealth, { auth_token: accessToken }))
                .toEqual({ passed: false, status: 403, code: 'ACCOUNT_INACTIVE' });
            expect(await guard(authenticateAny, { auth_token: accessToken }))
                .toEqual({ passed: false, status: 403, code: 'ACCOUNT_INACTIVE' });
            const renewed = await refresh(refreshToken);
            expect(renewed.status).toBe(403);
            noSessionIssued(renewed);
        } finally {
            compare.mockRestore();
            clock.restore();
        }
    });

    it('MFA completion: the token minted while disableUser ran is refused by authenticateHealth', async () => {
        const { row } = seedApplicant({ twoFactorEnabled: true, twoFactorSecret: 'SEED' });
        const mfaSession = mintMfaChallengeToken({
            userId: row.id, method: 'TOTP', ip: '203.0.113.9', userAgent: USER_AGENT, tokenType: 'public',
        });
        const clock = controlClock();
        // The single-use claim runs after the row was read and the code verified, just before the mint.
        const redisService = require('../../services/redis-service');
        redisService.setNX.mockImplementationOnce(async () => {
            await disable(row);
            clock.advance(1000);
            return true;
        });
        try {
            const res = await callRouter(mfaRouter, 'POST', '/verify', { body: { mfa_session: mfaSession, code: '123456' } });

            expect(mockUsers.get(row.id).status).toBe('INACTIVE');
            expect(res.status).toBe(200); // the route read the row before the disable
            const accessToken = res.cookies.auth_token;
            expect(issuedNotBeforeStamp(accessToken, row.id)).toBe(true);

            expect(await guard(authenticateHealth, { auth_token: accessToken }))
                .toEqual({ passed: false, status: 403, code: 'ACCOUNT_INACTIVE' });
        } finally {
            clock.restore();
        }
    });
});
