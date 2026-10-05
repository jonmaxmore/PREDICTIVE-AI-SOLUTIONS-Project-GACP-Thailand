'use strict';

/**
 * AUTH-01 P2 — ThaID session resolver status gate (auth-idp.js resolveThaidSession).
 *
 * Operator-mandated guard (2026-08-06): resolveThaidSession must gate on
 * user.status BEFORE minting a provider_token session — mirroring the mock
 * path (auth-idp.js:211-217). Only {ACTIVE, PENDING_VERIFICATION} may receive a
 * session; a SUSPENDED/DISABLED/DELETED account is rejected with ACCOUNT_INACTIVE
 * and NO token is issued.
 *
 * RED-first (Law 3.11): before the fix, resolveThaidSession minted a session for
 * ANY resolved user (no status check) → the SUSPENDED case returns 200 + calls
 * issueTokensForAuthenticatedUser, failing these assertions.
 *
 * Isolation: the ThaID adapter and identity service are both mocked so the flow
 * is deterministic (no network, no prisma). The route is driven end-to-end
 * through the real state anti-CSRF machinery via the authorize-url endpoint.
 */

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

const mockLogAuth = jest.fn().mockResolvedValue(undefined);
jest.mock('../../middleware/audit-logger', () => ({
    // auditLogger.logAuth — used by auth-idp.js. auditLogger.log +
    // AuditCategory — used by mfa.js's /verify (MFA_VERIFY_SUCCESS/FAILED
    // audit rows), required for the /verify-compatibility describe below.
    auditLogger: {
        logAuth: (...a) => mockLogAuth(...a),
        log: jest.fn().mockResolvedValue({ id: 'audit-mock' }),
    },
    AuditCategory: { SECURITY: 'SECURITY', AUTHENTICATION: 'AUTHENTICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
}));

const mockIssueTokens = jest.fn();
jest.mock('../../services/prisma-auth-service', () => ({
    issueTokensForAuthenticatedUser: (...a) => mockIssueTokens(...a),
}));


// Fully mock the ThaID identity service so resolveThaidLogin's linking policy
// is out of scope — this test pins ONLY the status gate in the route.
// R-D Task 3: the route now also calls thaidSubjectKey(subject) for the
// audit-log subjectHash (replacing the old bare subjectHashOf) — mocked here
// too so this file's status-gate/MFA pins (which don't assert on subjectHash
// values) keep passing without depending on the real HMAC.
// Task 4: the route also calls decodeIdTokenClaims(raw.id_token) now — mocked
// to return null (⇒ auth-idp.js's `|| {}` fallback), matching the fixture
// below which puts pid/given_name/family_name TOP-LEVEL on `raw`, never
// inside the (opaque, non-JWT) `id_token` string this file uses.
const mockResolveThaidLogin = jest.fn();
const mockPersistThaidLink = jest.fn().mockResolvedValue({});
jest.mock('../../services/auth/thaid-identity-service', () => ({
    resolveThaidLogin: (...a) => mockResolveThaidLogin(...a),
    persistThaidLink: (...a) => mockPersistThaidLink(...a),
    decodeIdTokenSubject: () => 'opaque-thaid-sub',
    decodeIdTokenClaims: () => null,
    thaidSubjectKey: (sub) => `thaid-keyed(${sub})`,
}));

/**
 * Item 2 (council final-fix round): resolveThaidLogin's contract changed
 * from returning the bare user to `{ user, subjectKey }`. This helper keeps
 * every existing fixture below (which builds a plain user object) working
 * unchanged — wrap it once at the mock call site instead of touching every
 * `mockResolveThaidLogin.mockResolvedValue(...)` call individually.
 */
function resolved(user, subjectKey = 'thaid-subject-key-fixture') {
    return { user, subjectKey };
}

// Deterministic adapter: no BORA network. getAuthorizeUrl feeds beginFlow the
// state; exchangeCode returns a raw token envelope with the fields the resolver
// reads (pid/given_name/family_name — id_token is decoded by the mocked service).
const mockExchangeCode = jest.fn().mockResolvedValue({
    raw: {
        id_token: 'header.payload.sig',
        pid: '1234567890123',
        given_name: 'สมชาย',
        family_name: 'ใจดี',
    },
});
jest.mock('../../services/auth/idp/idp-adapter', () => ({
    getIdpAdapter: () => ({
        getAuthorizeUrl: ({ state }) => `https://thaid.example/oauth/authorize?state=${state}`,
        exchangeCode: (...a) => mockExchangeCode(...a),
    }),
}));

// Fixed client IP across BOTH apps built in this file (the auth-idp app and,
// for the /verify compatibility check below, a second app mounting the real
// mfa.js router) so the AUTH-5 bind fingerprint (sha256(ip|ua)) computed at
// mint time and recomputed at /verify time is guaranteed identical — no
// reliance on supertest's ephemeral local socket address being consistent
// across two separately-spun-up servers.
jest.mock('../../utils/client-ip', () => ({ getRequestIp: () => '203.0.113.9' }));

// ── /api/mfa/verify dependencies (real jwt-security + real mfa-challenge-binding
// deliberately NOT mocked below — the whole point of the compatibility test is
// that a real ThaID-minted challenge decodes and binds correctly there).
jest.mock('../../services/identity-service', () => ({
    findUserForMfaVerify: jest.fn(),
    updateBackupCodes: jest.fn(),
    touchLastLogin: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../middleware/mfa-service', () => ({
    mfaService: {
        verifyTOTP: jest.fn(() => true),
        hashBackupCode: jest.fn((c) => `H(${c})`),
    },
}));
jest.mock('../../services/redis-service', () => ({
    setNX: jest.fn(() => true),
    get: jest.fn(() => null),
    set: jest.fn(() => true),
    del: jest.fn(() => true),
}));
jest.mock('../../middleware/rate-limiter', () => ({
    createRateLimiter: () => (_req, _res, next) => next(),
}));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (_req, _res, next) => next(),
    authenticateAny: (_req, _res, next) => next(),
}));

const authIdpRouter = require('../../routes/api/auth/auth-idp');

const TEST_SESSION_SECRET = 'test-only-idp-state-secret-at-least-32-chars-long';

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth/idp', authIdpRouter);
    return app;
}

/**
 * Second app mounting the REAL mfa.js router — used only by the
 * "/verify compatibility" describe block below to prove a ThaID-minted
 * mfa_session challenge is actually consumable at POST /api/mfa/verify.
 * Required lazily (not at module top) so it loads AFTER all the jest.mock
 * calls above are in effect.
 */
function buildMfaApp() {
    const mfaRouter = require('../../routes/api/identity/mfa');
    const app = express();
    app.use(express.json());
    app.use('/api/identity/mfa', mfaRouter);
    return app;
}

const CHALLENGE_UA = 'thaid-mfa-verify-test-agent/1.0';

function setFullThaidEnv() {
    process.env.AUTH_THAID_STATE = 'enabled';
    process.env.AUTH_THAID_CLIENT_ID = 'test-thaid-client';
    process.env.AUTH_THAID_CLIENT_SECRET = 'test-thaid-client-secret-value';
    process.env.AUTH_THAID_REDIRECT_URI = 'https://gacp.example/auth/callback/thaid';
    process.env.AUTH_THAID_AUTHORIZE_URL = 'https://thaid.example/oauth/authorize';
    process.env.AUTH_THAID_TOKEN_URL = 'https://thaid.example/oauth/token';
    process.env.AUTH_THAID_INTROSPECT_URL = 'https://thaid.example/oauth/introspect';
    process.env.AUTH_THAID_SCOPE = 'pid name given_name family_name openid';
}

async function beginFlow(app) {
    const res = await request(app).post('/api/auth/idp/thaid/authorize-url');
    const setCookie = res.headers['set-cookie'] || [];
    const stateCookie = (setCookie.find((c) => c.startsWith('idp_state=')) || '').split(';')[0];
    const query = String(res.body?.data?.authorizeUrl || '').split('?')[1] || '';
    const state = new URLSearchParams(query).get('state');
    return { stateCookie, state };
}

function findAuditCall(outcome, reason) {
    return mockLogAuth.mock.calls.find((call) =>
        call[3] === outcome && (reason === undefined || (call[6] && call[6].reason === reason)),
    );
}

function findAuditCallByAction(action) {
    return mockLogAuth.mock.calls.find((call) => call[0] === action);
}

async function callback(app, { stateCookie, state }, { userAgent } = {}) {
    const req = request(app)
        .post('/api/auth/idp/thaid/callback')
        .set('Cookie', stateCookie);
    if (userAgent) { req.set('User-Agent', userAgent); }
    return req.send({ code: 'real-thaid-code', state });
}

let envBackup;
beforeEach(() => {
    jest.clearAllMocks();
    envBackup = { ...process.env };
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('AUTH_')) { delete process.env[key]; }
    }
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    setFullThaidEnv();
    mockLogAuth.mockResolvedValue(undefined);
    mockExchangeCode.mockResolvedValue({
        raw: { id_token: 'header.payload.sig', pid: '1234567890123', given_name: 'สมชาย', family_name: 'ใจดี' },
    });
});

afterEach(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in envBackup)) { delete process.env[key]; }
    }
    Object.assign(process.env, envBackup);
});

describe('resolveThaidSession — status gate (auth-idp.js)', () => {
    it('SUSPENDED existing user → 403 ACCOUNT_INACTIVE, NO session minted, audit FAILURE', async () => {
        mockResolveThaidLogin.mockResolvedValue(resolved({
            id: 'u-susp', role: 'health', status: 'SUSPENDED', firstName: 'สมชาย', lastName: 'ใจดี',
        }));
        // token IS stubbed: without the gate the resolver mints a full session
        // (pre-fix RED = 200 + auth_token). The gate must stop it at 403.
        mockIssueTokens.mockResolvedValue({ token: 'signed.thaid.session.token' });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        // no token issued, no session cookie of either name
        expect(mockIssueTokens).not.toHaveBeenCalled();
        const setCookie = (res.headers['set-cookie'] || []).join(';');
        expect(setCookie).not.toMatch(/provider_token=/);
        expect(setCookie).not.toMatch(/auth_token=/);
        // failure audited like the other reject paths
        expect(findAuditCall('FAILURE', 'ACCOUNT_INACTIVE')).toBeTruthy();
        expect(findAuditCall('SUCCESS')).toBeFalsy();
        // Item 7: pin the failure branch's action too.
        const failureAudit = findAuditCallByAction('IDP_LOGIN_FAILURE');
        expect(failureAudit).toBeTruthy();
        expect(failureAudit[3]).toBe('FAILURE');
    });

    it('SECU-03: soft-deleted user whose status still reads ACTIVE → 403 ACCOUNT_INACTIVE, NO session', async () => {
        // A PDPA self-erasure (DELETE /me) sets isDeleted but leaves status as it
        // was; an existing identity link still resolves to that row.
        mockResolveThaidLogin.mockResolvedValue(resolved({
            id: 'u-erased', role: 'health', status: 'ACTIVE', isDeleted: true, firstName: null, lastName: null,
        }));
        mockIssueTokens.mockResolvedValue({ token: 'signed.thaid.session.token' });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        expect(mockIssueTokens).not.toHaveBeenCalled();
        const setCookie = (res.headers['set-cookie'] || []).join(';');
        expect(setCookie).not.toMatch(/provider_token=/);
        expect(setCookie).not.toMatch(/auth_token=/);
        expect(findAuditCall('FAILURE', 'ACCOUNT_INACTIVE')).toBeTruthy();
    });

    it('ACTIVE user (HEALTH role) → 200, session minted via issueTokensForAuthenticatedUser, auth_token cookie (Item 1)', async () => {
        mockResolveThaidLogin.mockResolvedValue(resolved({
            id: 'u-active', role: 'health', status: 'ACTIVE', firstName: 'สมชาย', lastName: 'ใจดี',
        }));
        // R-A Task 2 regression pin: a real issueTokensForAuthenticatedUser
        // resolves { user, token, refreshToken } (no mfaRequired) for a
        // non-enrolled user — this must stay byte-identical to today.
        mockIssueTokens.mockResolvedValue({ token: 'signed.thaid.session.token' });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.status).toBe(200);
        expect(mockIssueTokens).toHaveBeenCalledTimes(1);
        const setCookie = (res.headers['set-cookie'] || []).join(';');
        // Item 1: a HEALTH-role user must land in the auth_token slot, not
        // provider_token — the Next middleware gates /health/* on auth_token
        // ONLY (middleware.ts:172-179), so this is the cookie the citizen's
        // browser actually needs.
        expect(setCookie).toMatch(/auth_token=signed\.thaid\.session\.token/);
        expect(setCookie).not.toMatch(/provider_token=/);
        expect(res.body.data.user.id).toBe('u-active');
        // byte-identical: no MFA fields leak onto the non-2FA success body
        expect(res.body.data.mfa_required).toBeUndefined();
        expect(res.body.data.mfa_session).toBeUndefined();
        // Item 2: the actual-mint branch persists the identity_links row.
        expect(mockPersistThaidLink).toHaveBeenCalledTimes(1);
        expect(mockPersistThaidLink).toHaveBeenCalledWith('thaid-subject-key-fixture', 'u-active');
        // Item 7: pin the success branch's action/dbOutcome pairing too,
        // while touching this file for the same fix.
        const successAudit = findAuditCallByAction('IDP_LOGIN_SUCCESS');
        expect(successAudit).toBeTruthy();
        expect(successAudit[3]).toBe('SUCCESS');
    });

    it('PENDING_VERIFICATION (freshly provisioned citizen) → 200, session minted, auth_token cookie', async () => {
        mockResolveThaidLogin.mockResolvedValue(resolved({
            id: 'u-pending', role: 'health', status: 'PENDING_VERIFICATION', firstName: 'สมชาย', lastName: 'ใจดี',
        }));
        mockIssueTokens.mockResolvedValue({ token: 'signed.thaid.session.token' });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.status).toBe(200);
        expect(mockIssueTokens).toHaveBeenCalledTimes(1);
        expect(res.body.data.user.id).toBe('u-pending');
        const setCookie = (res.headers['set-cookie'] || []).join(';');
        expect(setCookie).toMatch(/auth_token=/);
    });
});

/**
 * R-A Task 2 — MFA gate at the mint boundary (auth-idp.js resolveThaidSession).
 *
 * Council-confirmed bug: the IdP path called issueTokensForAuthenticatedUser
 * directly with no twoFactorEnabled check, so a 2FA-enrolled citizen bypassed
 * 2FA entirely via ThaID. issueTokensForAuthenticatedUser (real module, tested
 * in auth-service.test.js) now returns { user, mfaRequired: true,
 * twoFactorMethod } instead of minting when the resolved user has 2FA
 * enabled — this describe pins that the ROUTE honors that return shape with
 * the SAME wire contract the password path emits
 * (health-auth-profile-handlers.js:198-204 → { mfa_required, mfa_session })
 * and that client-view.tsx:205-207 reads.
 *
 * RED-first (Law 3.11): before the fix, resolveThaidSession destructured
 * `{ token }` off the mocked result unconditionally — with mfaRequired-shaped
 * mocks (no `token`), the pre-fix route still minted a provider_token cookie
 * of the literal string "undefined" and returned 200, failing every
 * assertion below.
 */
describe('resolveThaidSession — MFA gate at the mint boundary (R-A Task 2)', () => {
    const TWO_FA_USER = {
        id: 'u-2fa-totp', role: 'health', status: 'ACTIVE',
        firstName: 'สมชาย', lastName: 'ใจดี', email: 'citizen-2fa@example.test',
    };

    it('(a) TOTP-enrolled user → mfa challenge contract, NO tokens, NO session cookie, NO identity_links write (Item 2)', async () => {
        mockResolveThaidLogin.mockResolvedValue(resolved(TWO_FA_USER));
        mockIssueTokens.mockResolvedValue({
            user: TWO_FA_USER, mfaRequired: true, twoFactorMethod: 'TOTP',
        });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.status).toBe(200);
        // exact contract fields the FE reads (client-view.tsx:205-207)
        expect(res.body.data.mfa_required).toBe(true);
        expect(typeof res.body.data.mfa_session).toBe('string');
        expect(res.body.data.mfa_session.length).toBeGreaterThan(0);
        // NO tokens anywhere in the body
        expect(res.body.data.tokens).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toMatch(/access_token|refresh_token/i);
        // NO session cookie minted (neither slot)
        const setCookie = (res.headers['set-cookie'] || []).join(';');
        expect(setCookie).not.toMatch(/provider_token=/);
        expect(setCookie).not.toMatch(/auth_token=/);
        // Item 2: the challenge branch must write NOTHING to identity_links —
        // a failed/pending-MFA attempt must not persist or refresh the link.
        expect(mockPersistThaidLink).not.toHaveBeenCalled();
        // Item 7: the 3-outcome audit branch (auditIdpOutcome's
        // outcome:'MFA_CHALLENGE' → action:'MFA_CHALLENGE_ISSUED',
        // dbOutcome:'PENDING') had zero assertions before this pin — a
        // mutation test proved the action/dbOutcome remap could change
        // silently. This fails if either the action string or the dbOutcome
        // mapping regresses.
        const challengeAudit = findAuditCallByAction('MFA_CHALLENGE_ISSUED');
        expect(challengeAudit).toBeTruthy();
        expect(challengeAudit[3]).toBe('PENDING');
    });

    it('(b) a service result naming the retired EMAIL method fails closed — no challenge, no cookies, NO identity_links write', async () => {
        // มติ operator 2026-09-15: ไม่มี 2FA แบบอีเมล. issueTokensForAuthenticatedUser
        // itself never reports it any more (shared/second-factor.js treats an EMAIL
        // row as not enrolled) — and if a stale caller still does, this route must
        // not mint a five-minute challenge nobody can answer: there is no code to
        // email. Whatever the status, nothing usable may leave the response.
        const emailUser = { ...TWO_FA_USER, id: 'u-2fa-email' };
        mockResolveThaidLogin.mockResolvedValue(resolved(emailUser));
        mockIssueTokens.mockResolvedValue({
            user: emailUser, mfaRequired: true, twoFactorMethod: 'EMAIL',
        });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.body?.data?.mfa_required).not.toBe(true);
        expect(res.body?.data?.mfa_session).toBeUndefined();
        const setCookie = (res.headers['set-cookie'] || []).join(';');
        expect(setCookie).not.toMatch(/provider_token=/);
        expect(setCookie).not.toMatch(/auth_token=/);
        expect(mockPersistThaidLink).not.toHaveBeenCalled();
    });

    // Item 2, scenario (c) from the review: an existing-link user WITH 2FA
    // enrolled hits the challenge branch, same as a fresh TOTP user above —
    // named explicitly because this is the exact "re-resolves via CID
    // re-match every time until a non-challenge mint runs" case the
    // council's accepted trade-off describes (thaid-identity-service.js's
    // existing-link branch is itself unit-tested as read-only in
    // thaid-identity-service.test.js; this pins the ROUTE-level consequence).
    it('(c) existing-link user w/ 2FA enrolled → challenge, NO identity_links touch', async () => {
        const existingLinkedTwoFaUser = { ...TWO_FA_USER, id: 'u-2fa-existing-link' };
        mockResolveThaidLogin.mockResolvedValue(resolved(existingLinkedTwoFaUser, 'existing-link-subject-key'));
        mockIssueTokens.mockResolvedValue({
            user: existingLinkedTwoFaUser, mfaRequired: true, twoFactorMethod: 'TOTP',
        });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.status).toBe(200);
        expect(res.body.data.mfa_required).toBe(true);
        expect(mockPersistThaidLink).not.toHaveBeenCalled();
    });

    it('the minted mfa_session decodes with purpose=mfa_challenge + the correct method claim', async () => {
        mockResolveThaidLogin.mockResolvedValue(resolved(TWO_FA_USER));
        mockIssueTokens.mockResolvedValue({
            user: TWO_FA_USER, mfaRequired: true, twoFactorMethod: 'TOTP',
        });
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        const jwtConfig = require('../../config/jwt-security');
        const decoded = jwtConfig.verifyToken(res.body.data.mfa_session, 'public');
        expect(decoded.purpose).toBe('mfa_challenge');
        expect(decoded.method).toBe('TOTP');
        expect(decoded.id).toBe('u-2fa-totp');
    });
});

/**
 * R-A Task 2 — /api/mfa/verify compatibility.
 *
 * Proves the mfa_session minted by resolveThaidSession is not just
 * well-formed but ACTUALLY completes login at the real /verify endpoint —
 * same binding/purpose fields the password path's challenge uses, verified
 * by driving a real ThaID-minted token through the real router (only its
 * DB/Redis/TOTP dependencies are mocked; jwt-security + mfa-challenge-binding
 * run for real on both sides of the mint/verify boundary).
 */
describe('ThaID-minted mfa_session is verifiable at POST /api/mfa/verify (R-A Task 2)', () => {
    it('completes login: real challenge mint → real /verify accepts it (binding + purpose pass)', async () => {
        const user = {
            id: 'u-2fa-verify', role: 'health', status: 'ACTIVE',
            firstName: 'สมชาย', lastName: 'ใจดี', email: 'verify-2fa@example.test',
        };
        mockResolveThaidLogin.mockResolvedValue(resolved(user));
        mockIssueTokens.mockResolvedValue({ user, mfaRequired: true, twoFactorMethod: 'TOTP' });

        const idpApp = buildApp();
        const flow = await beginFlow(idpApp);
        const idpRes = await callback(idpApp, flow, { userAgent: CHALLENGE_UA });
        expect(idpRes.body.data.mfa_required).toBe(true);
        const mfaSession = idpRes.body.data.mfa_session;

        // /verify's user lookup + TOTP check for the SAME user id the challenge carries.
        const identityService = require('../../services/identity-service');
        identityService.findUserForMfaVerify.mockResolvedValue({
            id: 'u-2fa-verify', uuid: 'uuid-2fa-verify', email: 'verify-2fa@example.test',
            role: 'health', authType: 'HEALTH_ID', organizationId: null,
            twoFactorEnabled: true, twoFactorMethod: 'TOTP', twoFactorSecret: 'TOTP_SECRET',
            twoFactorBackupCodes: [],
        });

        const verifyRes = await request(buildMfaApp())
            .post('/api/identity/mfa/verify')
            .set('User-Agent', CHALLENGE_UA)
            .send({ mfa_session: mfaSession, code: '123456' });

        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.success).toBe(true);
        expect(verifyRes.body.data.user.id).toBe('u-2fa-verify');
    });
});

/**
 * R-A Task 2 — existing-link rider, route-level plumbing.
 *
 * The role-assertion LOGIC lives in and is unit-tested by
 * thaid-identity-service.test.js (resolveThaidLogin is fully mocked in THIS
 * file, so it cannot exercise that internal branch). This pins that the
 * ROUTE correctly surfaces whatever resolveThaidLogin rejects with —
 * generic behavior already covered by auth-idp-routes.test.js:463-477 for
 * the national-ID-match branch; reproduced narrowly here for the
 * existing-link branch's AUTH_AUTOPROVISION_ROLE_FORBIDDEN case named in the
 * task brief. HEALTH existing-link "passes as today" is already exercised
 * by the ACTIVE-user test above (resolveThaidLogin resolving a role:'health'
 * user is exactly what an existing HEALTH link returns).
 */
describe('resolveThaidSession — existing-link rider surfaces at the route (R-A Task 2)', () => {
    it('(d) staff existing-link rejection (AUTH_AUTOPROVISION_ROLE_FORBIDDEN) → 403 + audit FAILURE, no mint', async () => {
        mockResolveThaidLogin.mockRejectedValue(Object.assign(
            new Error('role "auditor" is not an auto-provisionable citizen role'),
            { code: 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN' },
        ));
        const app = buildApp();
        const flow = await beginFlow(app);
        const res = await callback(app, flow);

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('AUTH_AUTOPROVISION_ROLE_FORBIDDEN');
        expect(mockIssueTokens).not.toHaveBeenCalled();
        expect(findAuditCall('FAILURE', 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN')).toBeTruthy();
    });
});
