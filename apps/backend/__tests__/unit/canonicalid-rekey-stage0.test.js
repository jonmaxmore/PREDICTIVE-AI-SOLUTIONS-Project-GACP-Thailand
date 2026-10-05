/**
 * Detokenize STAGE 0 — canonicalId re-key prep (flag-gated writes + data-state-
 * agnostic reads + erasure gap).
 *
 * RFC: docs/handoffs/national-id-detokenize-rfc-2026-06-29.md
 *
 * Proves the STAGE-0 contract:
 *   (a) WRITE chokepoints gated APP_FK_USE_TOKEN:
 *        - flag OFF (default) → canonicalId written = the national ID
 *          (byte-for-byte today);
 *        - flag ON → canonicalId written = the keyed-HMAC token.
 *   (b) DATA-STATE-AGNOSTIC reads resolve correctly with canonicalId == national
 *        ID (pre-re-key) AND with canonicalId == token (post-re-key).
 *   (c) Erasure ALSO nulls the *Hmac columns + sets canonicalId = user.id +
 *        anonymises the personal INDIVIDUAL Entity row.
 *
 * Backend is JS (no project tsc); these are pure unit tests with prisma mocked.
 */

const crypto = require('crypto');

process.env.HEALTH_JWT_SECRET = 'test-only-health-jwt-secret-32-bytes-exactly-here!!';
process.env.PROVIDER_JWT_SECRET = 'test-only-provider-jwt-secret-32-bytes-exactly-ok';
delete process.env.APP_FK_USE_TOKEN;
delete process.env.AUTH_LOOKUP_USE_HMAC;
delete process.env.AUTH_LOOKUP_HMAC_KEY;

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const { computeLookupHmac } = require('../../utils/field-encryption');
const { useFkToken, resolveCanonicalIdForWrite } = require('../../shared/fk-token');

const ID = '1100100100011';

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

// ── (a) The shared resolver (single source of truth for all write sites) ──────
describe('STAGE 0 (a) — resolveCanonicalIdForWrite (flag-gated)', () => {
    afterEach(() => { delete process.env.APP_FK_USE_TOKEN; });

    it('flag OFF (default) → returns the national ID, byte-for-byte today', () => {
        expect(useFkToken()).toBe(false);
        expect(resolveCanonicalIdForWrite({ actualIdentifier: ID, isProvider: false })).toBe(ID);
        expect(resolveCanonicalIdForWrite({ actualIdentifier: ID, isProvider: true })).toBe(ID);
    });

    it('flag ON → returns the keyed-HMAC token (computeLookupHmac), not the national ID', () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        const token = computeLookupHmac(ID);
        expect(resolveCanonicalIdForWrite({ actualIdentifier: ID, isProvider: false })).toBe(token);
        expect(resolveCanonicalIdForWrite({ actualIdentifier: ID, isProvider: false })).not.toBe(ID);
        expect(resolveCanonicalIdForWrite({ actualIdentifier: ID, isProvider: false })).not.toBe(sha256(ID));
    });

    it('flag ON → reuses a precomputed *Hmac when the caller already has it (no recompute drift)', () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        const precomputed = computeLookupHmac(ID);
        expect(resolveCanonicalIdForWrite({ actualIdentifier: ID, isProvider: false, precomputedHmac: precomputed })).toBe(precomputed);
    });

    it('flag ON + no national ID → falls back to userId (matches COALESCE(...,id) in the re-key)', () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        expect(resolveCanonicalIdForWrite({ actualIdentifier: null, isProvider: true, userId: 'user-uuid-1' })).toBe('user-uuid-1');
    });
});

// ── (a) register() write chokepoint ──────────────────────────────────────────
describe('STAGE 0 (a) — prisma-auth-service.register() canonicalId write', () => {
    let prisma;
    let authService;

    beforeAll(() => {
        jest.resetModules();
        jest.doMock('../../services/token-revocation-service', () => ({
            issueRefreshToken: jest.fn().mockResolvedValue('jti'),
            issueMfaChallenge: jest.fn().mockResolvedValue('challenge'),
            isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false),
        }));
        jest.doMock('../../services/entity-service', () => ({
            ensurePersonalIndividualEntity: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('bcryptjs', () => ({
            compare: jest.fn().mockResolvedValue(true),
            hash: jest.fn().mockResolvedValue('$2a$12$mockhash'),
        }));
        jest.doMock('../../services/prisma-database', () => ({
            prisma: {
                user: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
                organization: { findUnique: jest.fn() },
                $transaction: jest.fn(),
                userConsent: { create: jest.fn() },
            },
        }));
        prisma = require('../../services/prisma-database').prisma;
        authService = require('../../services/prisma-auth-service');
    });

    afterAll(() => { jest.resetModules(); jest.dontMock('../../services/prisma-database'); });

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.APP_FK_USE_TOKEN;
        prisma.organization.findUnique.mockResolvedValue({ id: 'org-default' });
        prisma.$transaction.mockImplementation(async (cb) => cb({ user: { create: prisma.user.create } }));
        prisma.user.create.mockImplementation(async ({ data }) => ({ id: 'new-user', status: data.status, healthId: data.healthId, ...data }));
    });
    afterEach(() => { delete process.env.APP_FK_USE_TOKEN; });

    function payload() { return prisma.user.create.mock.calls[0][0].data; }

    it('flag OFF → canonicalId = the national ID (byte-for-byte today)', async () => {
        await authService.register({ healthId: ID, password: 'pw', firstName: 'A', lastName: 'B', phoneNumber: '0800000000' });
        expect(payload().canonicalId).toBe(ID);
    });

    it('flag ON → canonicalId = the keyed-HMAC token, never the national ID', async () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        await authService.register({ healthId: ID, password: 'pw', firstName: 'A', lastName: 'B', phoneNumber: '0800000000' });
        const data = payload();
        expect(data.canonicalId).toBe(computeLookupHmac(ID));
        expect(data.canonicalId).not.toBe(ID);
    });

    it('strips client-supplied canonicalId / canonicalIdLegacy (mass-assignment defense)', async () => {
        await authService.register({
            healthId: ID, password: 'pw', firstName: 'A', lastName: 'B', phoneNumber: '0800000000',
            canonicalId: 'ATTACKER-PINNED', canonicalIdLegacy: 'ALSO-ATTACKER',
        });
        const data = payload();
        // Server-derived, never the client value; legacy escrow never written here.
        expect(data.canonicalId).toBe(ID);
        expect(data.canonicalIdLegacy).toBeUndefined();
    });
});

// ── (a) provider-user-service.createProviderUser write chokepoint ─────────────
describe('STAGE 0 (a) — provider-user-service.createProviderUser canonicalId write', () => {
    let prisma;
    let createProviderUser;
    const PID = '5555555555555';

    beforeAll(() => {
        jest.resetModules();
        jest.doMock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('$2a$12$mockhash') }));
        jest.doMock('../../services/tenant-context', () => ({ withoutTenantScope: (fn) => fn() }));
        jest.doMock('../../services/prisma-database', () => ({
            prisma: { user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() } },
        }));
        prisma = require('../../services/prisma-database').prisma;
        ({ createProviderUser } = require('../../services/provider-user-service'));
    });
    afterAll(() => { jest.resetModules(); });

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.APP_FK_USE_TOKEN;
        prisma.user.findFirst.mockResolvedValue(null);
        prisma.user.create.mockImplementation(async ({ data }) => ({ id: 'p-1', ...data }));
    });
    afterEach(() => { delete process.env.APP_FK_USE_TOKEN; });

    const args = () => ({ providerId: PID, email: 'a@b.test', password: 'Str0ng!Pw9xQ', firstName: 'F', lastName: 'L', role: 'field_inspector' });

    it('flag OFF → canonicalId = the providerId national ID', async () => {
        await createProviderUser(args());
        expect(prisma.user.create.mock.calls[0][0].data.canonicalId).toBe(PID);
    });

    it('flag ON → canonicalId = the keyed-HMAC token', async () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        await createProviderUser(args());
        expect(prisma.user.create.mock.calls[0][0].data.canonicalId).toBe(computeLookupHmac(PID));
    });
});

// ── (b) auth-middleware read chokepoint: canonicalId is data-state-agnostic ───
describe('STAGE 0 (b) — auth-middleware fetchIdentityFromDb sets req.user.canonicalId', () => {
    let authMiddleware;
    let mockFindUnique;
    const jwt = require('jsonwebtoken');

    beforeAll(() => {
        jest.resetModules();
        mockFindUnique = jest.fn();
        jest.doMock('../../services/token-revocation-service', () => ({ isAccessTokenBlocklisted: jest.fn().mockResolvedValue(false) }));
        jest.doMock('../../services/prisma-database', () => ({ prisma: { user: { findUnique: (...a) => mockFindUnique(...a) } } }));
        authMiddleware = require('../../middleware/auth-middleware');
    });
    afterAll(() => { jest.resetModules(); });

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.APP_FK_USE_TOKEN;
        require('../../services/token-revocation-service').isAccessTokenBlocklisted.mockResolvedValue(false);
    });
    afterEach(() => { delete process.env.APP_FK_USE_TOKEN; });

    function makeReqRes(token) {
        const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, path: '/test' };
        const res = { status: jest.fn(function () { return this; }), json: jest.fn(function () { return this; }) };
        return { req, res };
    }
    function signHealth(payload) {
        // `tokenType: 'access'` mirrors what jwtConfig.generateToken() now stamps.
        // The access path classifies tokens by this claim so a REFRESH token can
        // no longer be presented as a session credential; a fixture that mints
        // an untyped token would be rejected as legacy and test nothing.
        return jwt.sign({ tokenType: 'access', ...payload }, process.env.HEALTH_JWT_SECRET, { algorithm: 'HS256', issuer: 'gacp-backend', audience: 'gacp-health', expiresIn: '1h', jwtid: 'jti-1' });
    }

    it('selects the *Hmac columns', async () => {
        const token = signHealth({ id: 'u1', role: 'HEALTH', canonicalRole: 'health' });
        mockFindUnique.mockResolvedValue({ healthId: ID, providerId: null, healthIdHmac: computeLookupHmac(ID), providerIdHmac: null, status: 'ACTIVE', isDeleted: false });
        const { req, res } = makeReqRes(token);
        await authMiddleware.authenticateHealth(req, res, jest.fn());
        // objectContaining, not an exact select: this test guards that the four
        // *Hmac columns ARE fetched, which is what its name says. Pinning the
        // exact shape made it fail the moment the middleware legitimately began
        // selecting `sessionsRevokedAt` for session revocation — an unrelated
        // column whose addition says nothing about the re-key contract.
        expect(mockFindUnique).toHaveBeenCalledWith({
            where: { id: 'u1' },
            select: expect.objectContaining({
                healthId: true, providerId: true, healthIdHmac: true, providerIdHmac: true,
            }),
        });
    });

    it('flag OFF → req.user.canonicalId = national ID (sourced from DB column, == FK key today)', async () => {
        const token = signHealth({ id: 'u1', role: 'HEALTH', canonicalRole: 'health' });
        mockFindUnique.mockResolvedValue({ healthId: ID, providerId: null, healthIdHmac: computeLookupHmac(ID), providerIdHmac: null, status: 'ACTIVE', isDeleted: false });
        const { req, res } = makeReqRes(token);
        await authMiddleware.authenticateHealth(req, res, jest.fn());
        expect(req.user.canonicalId).toBe(ID);
    });

    it('flag ON → req.user.canonicalId = the token (the *Hmac column), never the JWT or plaintext', async () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        const token = signHealth({ id: 'u1', role: 'HEALTH', canonicalRole: 'health', healthId: 'STALE-JWT-VALUE' });
        const hmac = computeLookupHmac(ID);
        mockFindUnique.mockResolvedValue({ healthId: ID, providerId: null, healthIdHmac: hmac, providerIdHmac: null, status: 'ACTIVE', isDeleted: false });
        const { req, res } = makeReqRes(token);
        await authMiddleware.authenticateHealth(req, res, jest.fn());
        expect(req.user.canonicalId).toBe(hmac);
        expect(req.user.canonicalId).not.toBe(ID);
        expect(req.user.canonicalId).not.toBe('STALE-JWT-VALUE');
    });

    it('flag ON + a row the re-key never touched → canonicalId = the COLUMN, not a derived token', async () => {
        // วัดจริงบน demo 2026-09-07: APP_FK_USE_TOKEN=true แต่ User.canonicalId ของบัญชี
        // เกษตรกรยังเป็นเลขบัตร (สคริปต์ re-key ไม่เคยรันบนฐานนั้น) และแถวเงินทุกแถว —
        // Application.healthId, Invoice.healthId — ก็ถือเลขบัตรตามคอลัมน์นั้น
        //
        // middleware กลับ "อนุมาน" ว่า canonicalId ควรเป็น HMAC แทนที่จะอ่านคอลัมน์จริง
        // ⇒ /invoices/my ถามด้วย HMAC เจอ 0 แถว ทั้งที่ใบแจ้งหนี้อยู่ครบ 3 ใบ — เกษตรกร
        // ที่จ่ายครบ 105,930 เปิดหน้าการเงินแล้วเห็น ฿0 กับ "ไม่พบรายการชำระเงิน"
        //
        // สัญญาที่ถูกต้องคือของ RFC เอง: req.user.canonicalId ต้องเท่ากับค่า FK จริง
        // ("it always equals the column the FK points at") — และค่า FK จริงคือคอลัมน์
        // ไม่ใช่สิ่งที่คอลัมน์ *ควรจะ* เป็นหลัง backfill ที่ยังไม่เกิด
        process.env.APP_FK_USE_TOKEN = 'true';
        const token = signHealth({ id: 'u1', role: 'HEALTH', canonicalRole: 'health' });
        mockFindUnique.mockResolvedValue({
            healthId: ID, providerId: null,
            healthIdHmac: computeLookupHmac(ID), providerIdHmac: null,
            status: 'ACTIVE', isDeleted: false,
            canonicalId: ID, // แถวก่อน re-key: คอลัมน์ยังถือเลขบัตร
        });
        const { req, res } = makeReqRes(token);
        await authMiddleware.authenticateHealth(req, res, jest.fn());
        expect(req.user.canonicalId).toBe(ID);
    });

    it('flag ON + a re-keyed row → canonicalId = the column, which IS the token', async () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        const token = signHealth({ id: 'u1', role: 'HEALTH', canonicalRole: 'health' });
        const hmac = computeLookupHmac(ID);
        mockFindUnique.mockResolvedValue({
            healthId: ID, providerId: null,
            healthIdHmac: hmac, providerIdHmac: null,
            status: 'ACTIVE', isDeleted: false,
            canonicalId: hmac, // แถวหลัง re-key
        });
        const { req, res } = makeReqRes(token);
        await authMiddleware.authenticateHealth(req, res, jest.fn());
        expect(req.user.canonicalId).toBe(hmac);
    });
});

// ── (b) resolveHealthIdentity returns the FK value (token when flag on) ───────
describe('STAGE 0 (b) — application-identity resolveHealthIdentity FK value', () => {
    const { createApplicationIdentityMethods } = require('../../services/application-service/application-identity-methods');
    const logger = { warn: jest.fn(), info: jest.fn() };

    function methods(user) {
        const findUserByHealthIdSecurely = jest.fn().mockResolvedValue(user);
        const prisma = { user: { findFirst: jest.fn().mockResolvedValue(user) } };
        return createApplicationIdentityMethods({ prisma, logger, findUserByHealthIdSecurely });
    }

    afterEach(() => { delete process.env.APP_FK_USE_TOKEN; });

    it('flag OFF → returns the healthId column value (national ID == FK key today)', async () => {
        const { resolveHealthIdentity } = methods({ id: 'u1', healthId: ID, canonicalId: ID });
        const res = await resolveHealthIdentity(null, { healthId: ID });
        expect(res).toEqual({ userId: 'u1', healthId: ID });
    });

    it('flag ON → returns the canonicalId column value (the token, the post-re-key FK key)', async () => {
        process.env.APP_FK_USE_TOKEN = 'true';
        const token = computeLookupHmac(ID);
        const { resolveHealthIdentity } = methods({ id: 'u1', healthId: ID, canonicalId: token });
        const res = await resolveHealthIdentity(null, { healthId: ID });
        expect(res).toEqual({ userId: 'u1', healthId: token });
    });

    // R2 Task 9 (spec 2026-09-30 §3.1): the filer where builder is deleted; every
    // applicant read carries the holder fragment (holder-access) instead.
    it('buildHealthWhereClause is gone (no filer where builder survives)', () => {
        const m = methods({});
        expect(m.buildHealthWhereClause).toBeUndefined();
        expect(m.buildHEALTH_USERWhereClause).toBeUndefined();
    });
});
