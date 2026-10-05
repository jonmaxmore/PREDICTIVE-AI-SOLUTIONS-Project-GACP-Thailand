'use strict';

/**
 * AUTH-01 P2 — OAuth IdP routes (authorize-url + callback)
 * (evidence/AUTH-01/mandate.md §D3-§D5; evidence/AUTH-01/plan.md P2)
 * RED-first ตาม Law 3.11 — red-output: evidence/AUTH-01/P2/red-output.txt
 *
 * Contract under test:
 *   - state anti-CSRF (mandate §D3 + auditor แกน 3): random ≥128bit ผูก browser
 *     ด้วย httpOnly signed cookie อายุ ≤10 นาที ใช้ครั้งเดียว — callback ที่
 *     (ก) ไม่มี state (ข) state ผิด (ค) state ถูกแต่ซ้ำรอบสอง ต้องถูกปฏิเสธ
 *   - provider ไม่ enabled → 503 fail-closed; mock บน production → ปิด (§D5)
 *   - mock happy → session mint ผ่าน issueTokensForAuthenticatedUser +
 *     provider_token cookie idiom (auth-provider.js:245-252) — ไม่มี token
 *     ในตัว response body
 *   - staff-not-in-registry → 403 ข้อความไทยตาม mandate §D4 + ไม่มี user.create
 *     (auditor check #4 — no auto-provision)
 *   - providerid จริง → 409 AUTH_LINKING_PENDING + ไม่มี prisma.user call ใด ๆ
 *     (ธง D-MANUAL-HASHCID)
 *   - audit log ทุก outcome พร้อม subjectHash (sha256 ของ account_id) ไม่ใช่ค่าดิบ
 */

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log), stream: { write: jest.fn() } };
});

const mockLogAuth = jest.fn().mockResolvedValue(undefined);
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { logAuth: (...a) => mockLogAuth(...a) },
}));

// เส้น providerid จริงต้องไม่มี prisma.user call ใด ๆ (ธง D-MANUAL-HASHCID) —
// mock ทั้ง client แล้ว assert ว่าไม่ถูกเรียก
const mockPrismaUser = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
};
jest.mock('../../services/prisma-database', () => ({
    prisma: { user: mockPrismaUser },
}));

const mockIssueTokens = jest.fn();
jest.mock('../../services/prisma-auth-service', () => ({
    issueTokensForAuthenticatedUser: (...a) => mockIssueTokens(...a),
}));

// คงไว้ทั้งที่แผน Task 2 Step 3 สั่งลบ: ผู้ใช้ที่เหลือไม่ใช่เคส mock แต่เป็น pin
// ของเส้น providerid (บรรทัด ~530: `expect(mockFindByHash).not.toHaveBeenCalled()`
// — ธง D-MANUAL-HASHCID ห้ามค้น user เพื่อผูกบัญชี) การลบ seam นี้จะทำให้ pin นั้น
// พังทั้งที่ไม่เกี่ยวกับ mock — แผนข้อนั้นจึงรันไม่ได้ตามที่เขียน
const mockFindByHash = jest.fn();
jest.mock('../../services/provider-user-service', () => ({
    findProviderForLoginByHash: (...a) => mockFindByHash(...a),
}));

// route-level suite: identity policy ของ thaid มี suite ของตัวเองแล้ว — ที่นี่
// mock ทั้ง service เพื่อทดสอบว่า ROUTE ทำอะไรกับผลลัพธ์/error ของมัน
const mockResolveThaidLogin = jest.fn();
const mockDecodeSubject = jest.fn();
// Task 4: two-shape pid/name extraction — decodeIdTokenClaims is a SIBLING of
// decodeIdTokenSubject (both live in thaid-identity-service). Left unset in a
// test → jest.fn() default (undefined), which auth-idp.js's
// `decodeIdTokenClaims(raw.id_token) || {}` turns into an empty object, i.e.
// "id_token carried nothing" → every existing test that never touches this
// mock keeps exercising the top-level-fallback path unchanged.
const mockDecodeClaims = jest.fn();
// R-D Task 3: deterministic fake standing in for the real
// thaidSubjectKey(sub) = computeLookupHmac('idp:thaid:'+sub) — the route
// under test (auth-idp.js resolveThaidSession) must call THIS (mocked)
// function for its subjectHash, not the local bare-sha256 subjectHashOf.
// Hash-shaped (hex digest of a differently-prefixed input) rather than
// string-embedding: it must (a) never equal sha256(sub) so the pins below
// can distinguish "keyed derivation used" from "old bare hash still used",
// and (b) never literally CONTAIN the raw sub the way a naive
// `thaid-keyed(${sub})` template would — a real HMAC-SHA256 hex digest
// never contains its own plaintext input, and the raw-CID-nowhere-in-audit
// assertions below rely on that same property.
function mockThaidSubjectKey(sub) {
    return crypto.createHash('sha256').update(`keyed:${sub}`).digest('hex');
}
// Item 2 (council final-fix round): resolveThaidLogin's mock now resolves
// `mockResolveThaidLogin.mockResolvedValue(resolved(STAFF_ROW))` — the real
// function no longer resolves the bare user, so every mock below must too.
const mockPersistThaidLink = jest.fn().mockResolvedValue({});
jest.mock('../../services/auth/thaid-identity-service', () => ({
    resolveThaidLogin: (...a) => mockResolveThaidLogin(...a),
    persistThaidLink: (...a) => mockPersistThaidLink(...a),
    decodeIdTokenSubject: (...a) => mockDecodeSubject(...a),
    decodeIdTokenClaims: (...a) => mockDecodeClaims(...a),
    thaidSubjectKey: (...a) => mockThaidSubjectKey(...a),
}));

/** Wraps a plain user fixture in resolveThaidLogin's real {user, subjectKey} shape. */
function resolved(user, subjectKey = 'route-test-subject-key') {
    return { user, subjectKey };
}

const authIdpRouter = require('../../routes/api/auth/auth-idp');

const TEST_SESSION_SECRET = 'test-only-idp-state-secret-at-least-32-chars-long';

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth/idp', authIdpRouter);
    return app;
}

function jsonResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload),
    };
}

// ค่า placeholder ล้วน — ไม่ใช่ credential จริง (B1-CRED); โครงเดียวกับ
// idp-adapter.test.js:64-75
function setFullProviderIdEnv() {
    process.env.AUTH_PROVIDERID_STATE = 'enabled';
    process.env.AUTH_PROVIDERID_CLIENT_ID = 'test-providerid-client';
    process.env.AUTH_PROVIDERID_CLIENT_SECRET = 'test-providerid-client-secret-value';
    process.env.AUTH_PROVIDERID_REDIRECT_URI = 'https://gacp.example/auth/callback/providerid';
    process.env.AUTH_PROVIDERID_AUTHORIZE_URL = 'https://healthid.example/oauth/redirect';
    process.env.AUTH_PROVIDERID_TOKEN_URL = 'https://healthid.example/api/v1/token';
    process.env.AUTH_PROVIDERID_PROFILE_URL = 'https://providerid.example/api/v1/services/profile';
    process.env.AUTH_PROVIDERID_PID_CLIENT_ID = 'test-providerid-pid-client';
    process.env.AUTH_PROVIDERID_SECRET_KEY = 'test-providerid-secret-key-value';
    process.env.AUTH_PROVIDERID_TOKEN_EXCHANGE_URL = 'https://providerid.example/api/v1/services/token';
}

// ค่า placeholder ล้วน — ไม่ใช่ credential จริง (B1-CRED); โครงเดียวกับ setFullProviderIdEnv
function setFullThaidEnv() {
    process.env.AUTH_THAID_STATE = 'enabled';
    process.env.AUTH_THAID_CLIENT_ID = 'test-thaid-client';
    process.env.AUTH_THAID_CLIENT_SECRET = 'test-thaid-client-secret-value';
    process.env.AUTH_THAID_REDIRECT_URI = 'https://gacp.example/auth/callback/thaid';
    process.env.AUTH_THAID_AUTHORIZE_URL = 'https://thaid.example/api/v2/oauth2/auth/';
    process.env.AUTH_THAID_TOKEN_URL = 'https://thaid.example/api/v2/oauth2/token/';
    process.env.AUTH_THAID_INTROSPECT_URL = 'https://thaid.example/api/v2/oauth2/introspect/';
    process.env.AUTH_THAID_SCOPE = 'pid given_name family_name';
}

/** เริ่ม flow จริงผ่าน endpoint — ได้ทั้ง state cookie และค่า state จาก authorizeUrl */
async function beginFlow(app, provider = 'thaid') {
    const res = await request(app).post(`/api/auth/idp/${provider}/authorize-url`);
    const setCookie = res.headers['set-cookie'] || [];
    const stateCookieFull = setCookie.find((c) => c.startsWith('idp_state=')) || '';
    const stateCookie = stateCookieFull.split(';')[0];
    const query = String(res.body?.data?.authorizeUrl || '').split('?')[1] || '';
    const state = new URLSearchParams(query).get('state');
    return { res, stateCookie, stateCookieFull, state };
}

function findAuditCall(outcome, reason) {
    return mockLogAuth.mock.calls.find((call) =>
        call[3] === outcome && (reason === undefined || (call[6] && call[6].reason === reason)),
    );
}

const STAFF_ROW = {
    id: 'staff-uuid-1',
    role: 'field_inspector',
    status: 'ACTIVE',
    firstName: 'สมศรี',
    lastName: 'ทดสอบระบบ',
};

/** token response ตาม §6.2.2 ของคู่มือ ThaID — ค่า placeholder ล้วน (B1-CRED) */
const THAID_TOKEN_BODY = {
    access_token: 'thaid-access-token', token_type: 'Bearer', expire_in: 300,
    id_token: 'h.p.s', pid: '1234567890123',
    given_name: 'สมศรี', family_name: 'ทดสอบระบบ',
};

/**
 * เดินเส้น callback จริงของ thaid ตั้งแต่ authorize-url → state cookie →
 * POST callback โดย stub เฉพาะขา token ของ IdP (module scope เพราะทั้ง describe
 * เส้น session และ describe audit ใช้ตัวเดียวกัน)
 */
async function beginThaidCallback(app, { fetchStatus = 200, fetchBody = THAID_TOKEN_BODY } = {}) {
    setFullThaidEnv();
    const { stateCookie, state } = await beginFlow(app);
    global.fetch.mockResolvedValueOnce(jsonResponse(fetchStatus, fetchBody));
    return request(app).post('/api/auth/idp/thaid/callback')
        .set('Cookie', stateCookie).send({ code: 'real-code-from-redirect', state });
}

let envBackup;
let realFetch;

beforeEach(() => {
    jest.clearAllMocks();
    envBackup = { ...process.env };
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('AUTH_')) { delete process.env[key]; }
    }
    process.env.SESSION_SECRET = TEST_SESSION_SECRET;
    realFetch = global.fetch;
    global.fetch = jest.fn();
    mockLogAuth.mockResolvedValue(undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
        if (!(key in envBackup)) { delete process.env[key]; }
    }
    Object.assign(process.env, envBackup);
    global.fetch = realFetch;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/idp/:provider/authorize-url', () => {
    it('provider ไม่ enabled (thaid = coming_soon) → 503 AUTH_PROVIDER_DISABLED fail-closed', async () => {
        const res = await request(buildApp()).post('/api/auth/idp/thaid/authorize-url');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('AUTH_PROVIDER_DISABLED');
    });

    it('provider นอก registry → 503 AUTH_PROVIDER_DISABLED (ไม่ leak ว่า key ไหนมีจริง)', async () => {
        const res = await request(buildApp()).post('/api/auth/idp/not-a-provider/authorize-url');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('AUTH_PROVIDER_DISABLED');
    });

    it('SESSION_SECRET หาย → 503 AUTH_STATE_SECRET_MISSING (fail-closed — ห้ามออก state ไม่ลงลายเซ็น)', async () => {
        setFullThaidEnv();
        delete process.env.SESSION_SECRET;
        const res = await request(buildApp()).post('/api/auth/idp/thaid/authorize-url');
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('AUTH_STATE_SECRET_MISSING');
    });

    it('thaid enabled → 200 {authorizeUrl} + state ≥256bit + httpOnly cookie อายุ ≤10 นาที', async () => {
        setFullThaidEnv();
        const { res, stateCookieFull, state } = await beginFlow(buildApp());
        expect(res.status).toBe(200);
        expect(res.body.data.authorizeUrl).toContain('https://thaid.example/api/v2/oauth2/auth/?');
        // mandate §D3: ≥128bit — implementation ใช้ 32 bytes = 64 hex chars
        expect(state).toMatch(/^[0-9a-f]{64,}$/);
        expect(stateCookieFull).toMatch(/HttpOnly/i);
        const maxAge = Number((stateCookieFull.match(/Max-Age=(\d+)/i) || [])[1]);
        expect(maxAge).toBeGreaterThan(0);
        expect(maxAge).toBeLessThanOrEqual(600);
        // ห้ามมี state ดิบเปลือย ๆ เป็นค่า cookie ทั้งก้อน (ต้องมี expiry+ลายเซ็นผูกอยู่)
        expect(stateCookieFull.split(';')[0]).not.toBe(`idp_state=${state}`);
    });

    it('state สุ่มใหม่ทุกครั้ง — สองรอบต้องไม่ซ้ำกัน', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const first = await beginFlow(app);
        const second = await beginFlow(app);
        expect(first.state).toBeTruthy();
        expect(first.state).not.toBe(second.state);
    });

    /**
     * spec §7.3 (design note 2026-08-14-remove-mock-idp-design:83) เขียนว่า
     * สอง endpoint นี้ต้องตอบ **404** · ที่ได้จริงคือ 503 AUTH_PROVIDER_DISABLED —
     * และ **ไม่ได้เกิดจากใบนี้**: pin ต่อต้าน enumeration ที่ :204 มีอยู่บน main ก่อนงานนี้
     * (`git show main:apps/backend/__tests__/unit/auth-idp-routes.test.js` บรรทัด 165)
     * สั่งไว้ว่า provider นอก registry ต้องตอบเหมือนกันหมด "ไม่ leak ว่า key ไหนมีจริง"
     * ⇒ ให้ 'mock' ตอบ 404 ขณะที่ key มั่วตอบ 503 = สร้าง oracle บอกว่า key ไหนเคยมีอยู่
     * ⇒ **ไม่แก้เองในใบนี้** (Tier C + ขัด pin ความปลอดภัยที่มีอยู่ก่อน) — operator ตัดสินว่า
     * จะแก้ถ้อยคำ spec AC3 หรือสั่งเปลี่ยนพฤติกรรมทั้งเส้นเป็นใบแยก (audit 2026-08-14 MINOR)
     * สิ่งที่ pin แทน 404 ตรงนี้แข็งกว่าที่ spec ขอ: mock ต้อง **แยกไม่ออก** จาก key ที่ไม่เคยมี
     */
    it("tombstone: 'mock' ไม่อยู่ใน registry แล้ว → 503 และแยกไม่ออกจาก key ที่ไม่เคยมี (operator 2026-08-14)", async () => {
        const app = buildApp();
        const a = await request(app).post('/api/auth/idp/mock/authorize-url');
        expect(a.status).toBe(503);
        expect(a.body.code).toBe('AUTH_PROVIDER_DISABLED');
        const b = await request(app).post('/api/auth/idp/mock/callback').send({});
        expect(b.status).toBe(503);

        const unknownA = await request(app).post('/api/auth/idp/never-existed/authorize-url');
        const unknownB = await request(app).post('/api/auth/idp/never-existed/callback').send({});
        expect({ status: a.status, code: a.body.code })
            .toEqual({ status: unknownA.status, code: unknownA.body.code });
        expect({ status: b.status, code: b.body.code })
            .toEqual({ status: unknownB.status, code: unknownB.body.code });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('callback state anti-CSRF (mandate §D3; auditor แกน 3)', () => {
    it('(ก) ไม่มี state ใน body → 400 AUTH_STATE_INVALID + audit FAILURE', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie } = await beginFlow(app);
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-code-from-redirect' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('AUTH_STATE_INVALID');
        expect(findAuditCall('FAILURE', 'STATE_INVALID')).toBeTruthy();
        expect(mockIssueTokens).not.toHaveBeenCalled();
    });

    it('(ข) state ผิด (ไม่ตรง cookie) → 400 AUTH_STATE_INVALID', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie } = await beginFlow(app);
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-code-from-redirect', state: 'f'.repeat(64) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('AUTH_STATE_INVALID');
        expect(mockIssueTokens).not.toHaveBeenCalled();
    });

    it('(ค) state ถูกแต่ส่งซ้ำรอบสอง → รอบแรกผ่าน รอบสองถูกปฏิเสธ (single-use)', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const agent = request.agent(app);
        const first = await agent.post('/api/auth/idp/thaid/authorize-url');
        expect(first.status).toBe(200);
        const query = String(first.body.data.authorizeUrl).split('?')[1];
        const state = new URLSearchParams(query).get('state');

        // รอบแรกผ่านชั้น state แล้วไปตายที่ IdP → 403 — พิสูจน์ว่า state ถูกบริโภคไปแล้ว
        global.fetch.mockResolvedValueOnce(jsonResponse(401, { error: 'access_denied' }));
        const ok = await agent.post('/api/auth/idp/thaid/callback')
            .send({ code: 'real-code-from-redirect', state });
        expect(ok.status).toBe(403);
        // การใช้ครั้งเดียว: response แรกต้องสั่งเคลียร์ idp_state cookie ทันที
        const cleared = (ok.headers['set-cookie'] || []).find((c) => c.startsWith('idp_state='));
        expect(cleared).toBeTruthy();

        // รอบสองตายก่อนถึง adapter — ไม่ต้อง stub fetch
        const replay = await agent.post('/api/auth/idp/thaid/callback')
            .send({ code: 'real-code-from-redirect', state });
        expect(replay.status).toBe(400);
        expect(replay.body.code).toBe('AUTH_STATE_INVALID');
        expect(mockIssueTokens).not.toHaveBeenCalled();
    });

    it('ไม่มี cookie เลย (ส่งแต่ body.state) → 400 AUTH_STATE_INVALID', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { state } = await beginFlow(app);
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .send({ code: 'real-code-from-redirect', state });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('AUTH_STATE_INVALID');
    });

    it('cookie ถูกดัดแปลง (ลายเซ็นไม่ตรง) → 400 AUTH_STATE_INVALID', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie, state } = await beginFlow(app);
        const lastChar = stateCookie.slice(-1);
        const tampered = stateCookie.slice(0, -1) + (lastChar === '0' ? '1' : '0');
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', tampered)
            .send({ code: 'real-code-from-redirect', state });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('AUTH_STATE_INVALID');
    });

    it('state หมดอายุ (เกิน 10 นาที) → 400 AUTH_STATE_INVALID', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie, state } = await beginFlow(app);
        const realNow = Date.now();
        jest.spyOn(Date, 'now').mockReturnValue(realNow + 11 * 60 * 1000);
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-code-from-redirect', state });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('AUTH_STATE_INVALID');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/idp/thaid/callback — เส้น session จริง (แปลงพาหนะจาก mock — coverage เดิมครบ)', () => {
    // เกราะที่เคสนี้ถือ = การ์ด `code` ของ ROUTE (auth-idp.js:437-445) ไม่ใช่ของ
    // adapter. thaid-adapter.js:157-163 โยน VALIDATION_ERROR ซ้ำอีกชั้น ดังนั้น
    // status+code อย่างเดียวแยกสองชั้นนี้ไม่ออก (ลบการ์ด route ทิ้งก็ยังเขียว —
    // ผลตรวจ audit 2026-08-14). ตัวแยกคือ reason ใน audit row: route = CODE_MISSING,
    // adapter = VALIDATION_ERROR (auth-idp.js:279 ส่ง error.code เป็น reason)
    it('ไม่มี code (state ผ่าน) → 400 VALIDATION_ERROR + audit reason CODE_MISSING จากการ์ดของ route', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie, state } = await beginFlow(app);
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ state });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(findAuditCall('FAILURE', 'CODE_MISSING')).toBeTruthy();
        expect(findAuditCall('FAILURE', 'VALIDATION_ERROR')).toBeFalsy();
        expect(mockIssueTokens).not.toHaveBeenCalled();
    });

    it('code ไม่ใช่สตริง (number) → 400 VALIDATION_ERROR ก่อนถึง adapter (ไม่ยิง IdP)', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie, state } = await beginFlow(app);
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ state, code: 1234567 });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(findAuditCall('FAILURE', 'CODE_MISSING')).toBeTruthy();
        // adapter รับ number เป็น truthy → ถ้าการ์ด typeof ของ route หาย จะมีการยิง
        // ออกไปหา IdP จริง; ที่นี่ต้องเงียบสนิท
        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockIssueTokens).not.toHaveBeenCalled();
    });

    it('happy → 200: mint ผ่าน issueTokensForAuthenticatedUser + provider_token httpOnly cookie', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockResolveThaidLogin.mockResolvedValue(resolved(STAFF_ROW));
        mockIssueTokens.mockResolvedValue({ token: 'signed-provider-jwt' });
        const app = buildApp();
        const res = await beginThaidCallback(app);
        expect(res.status).toBe(200);
        // portal เจ้าหน้าที่ → provider_token idiom (auth-provider.js:245-252)
        const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('provider_token='));
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toContain('provider_token=signed-provider-jwt');
        // identity ที่ส่งให้ policy layer มาจาก token response (§6.2.2/§6.2.3) ครบทุกฟิลด์
        expect(mockResolveThaidLogin).toHaveBeenCalledWith({
            subject: 'thaid-subject-1', nationalId: '1234567890123',
            firstNameTh: 'สมศรี', lastNameTh: 'ทดสอบระบบ',
        });
        expect(mockIssueTokens).toHaveBeenCalledTimes(1);
        expect(mockIssueTokens).toHaveBeenCalledWith(STAFF_ROW, expect.any(Object));
        expect(res.body.data.user.id).toBe(STAFF_ROW.id);
        expect(res.body.data.user.role).toBe('field_inspector');
        // Item 2 (final-fix round): actual-mint branch persists the link.
        expect(mockPersistThaidLink).toHaveBeenCalledWith('route-test-subject-key', STAFF_ROW.id);
    });

    // Item 1 (council final-fix round): the cookie SLOT is chosen by role,
    // not hardcoded to provider_token — a HEALTH-role resolution (the ONLY
    // role resolveThaidLogin's real implementation ever actually returns,
    // per assertAutoProvisionableRole) must land in auth_token instead,
    // mirroring routes/api/identity/mfa.js:548-550 exactly.
    it('happy (HEALTH role) → 200: mint ผ่าน issueTokensForAuthenticatedUser + auth_token httpOnly cookie (Item 1)', async () => {
        const HEALTH_ROW = { ...STAFF_ROW, id: 'citizen-uuid-1', role: 'HEALTH' };
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockResolveThaidLogin.mockResolvedValue(resolved(HEALTH_ROW));
        mockIssueTokens.mockResolvedValue({ token: 'signed-health-jwt' });
        const app = buildApp();
        const res = await beginThaidCallback(app);
        expect(res.status).toBe(200);
        const setCookieAll = (res.headers['set-cookie'] || []).join(';');
        expect(setCookieAll).not.toMatch(/provider_token=/);
        const cookie = (res.headers['set-cookie'] || []).find((c) => c.startsWith('auth_token='));
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toContain('auth_token=signed-health-jwt');
        expect(res.body.data.user.role).toBe('HEALTH');
    });

    it('happy → response body ต้องไม่มี access/refresh token (session = cookie เท่านั้น, E-4)', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockResolveThaidLogin.mockResolvedValue(resolved(STAFF_ROW));
        mockIssueTokens.mockResolvedValue({ token: 'signed-provider-jwt' });
        const app = buildApp();
        const res = await beginThaidCallback(app);
        expect(res.status).toBe(200);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('signed-provider-jwt');
        expect(body).not.toMatch(/access_token|refresh/i);
    });

    it('ทะเบียนปฏิเสธ fail-closed (auto-provision ปิด) → catalog status + ไม่มี create/upsert/mint + audit FAILURE', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockResolveThaidLogin.mockRejectedValue(Object.assign(
            new Error('citizen auto-provision is disabled here'),
            { code: 'AUTH_AUTOPROVISION_DISABLED' },
        ));
        const app = buildApp();
        const res = await beginThaidCallback(app);
        // status มาจาก catalog row เดียว (shared/error-codes.js:2516-2523 = 503) —
        // ห้ามเดา status ในเทส
        expect(res.status).toBe(503);
        expect(res.body.code).toBe('AUTH_AUTOPROVISION_DISABLED');
        // auditor check #4: no auto-provision — ห้ามสร้าง/แก้ user ทุกกรณี
        expect(mockPrismaUser.create).not.toHaveBeenCalled();
        expect(mockPrismaUser.upsert).not.toHaveBeenCalled();
        expect(mockIssueTokens).not.toHaveBeenCalled();
        // FAILURE row ของเส้นนี้ (auth-idp.js:300-303) รู้จัก subject แล้ว จึงต้อง
        // พก subjectHash ไปด้วยและห้ามมีค่าดิบใน metadata — R-D Task 3: thaid
        // subjectHash = thaidSubjectKey(sub) (keyed derivation) ไม่ใช่
        // sha256(sub) ธรรมดาอีกต่อไป (ค่าดิบ = เลขบัตรประชาชนตาม ThaID จริง)
        const failure = findAuditCall('FAILURE', 'AUTH_AUTOPROVISION_DISABLED');
        expect(failure).toBeTruthy();
        expect(failure[6].subjectHash).toBe(mockThaidSubjectKey('thaid-subject-1'));
        expect(failure[6].subjectHash).not.toBe(sha256('thaid-subject-1'));
        expect(JSON.stringify(failure[6])).not.toContain('thaid-subject-1');
    });

    it('บัญชีที่ผูกเลข 13 หลักเป็นเจ้าหน้าที่ → 403 ไม่ auto-link ไม่ create/upsert/mint + audit FAILURE', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockResolveThaidLogin.mockRejectedValue(Object.assign(
            new Error('privileged account cannot be auto-linked via ThaID'),
            { code: 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN' },
        ));
        const app = buildApp();
        const res = await beginThaidCallback(app);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('AUTH_AUTOPROVISION_ROLE_FORBIDDEN');
        expect(mockPrismaUser.create).not.toHaveBeenCalled();
        expect(mockPrismaUser.upsert).not.toHaveBeenCalled();
        expect(mockIssueTokens).not.toHaveBeenCalled();
        expect(findAuditCall('FAILURE', 'AUTH_AUTOPROVISION_ROLE_FORBIDDEN')).toBeTruthy();
    });

    it('บัญชี status ไม่ ACTIVE → 403 ACCOUNT_INACTIVE ไม่ mint session', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockResolveThaidLogin.mockResolvedValue(resolved({ ...STAFF_ROW, status: 'SUSPENDED' }));
        const app = buildApp();
        const res = await beginThaidCallback(app);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ACCOUNT_INACTIVE');
        expect(mockIssueTokens).not.toHaveBeenCalled();
        expect(findAuditCall('FAILURE', 'ACCOUNT_INACTIVE')).toBeTruthy();
    });

    it('ผู้ใช้กดปฏิเสธที่ IdP → 403 AUTH_IDP_ACCESS_DENIED + audit FAILURE', async () => {
        const app = buildApp();
        const res = await beginThaidCallback(app, {
            fetchStatus: 401, fetchBody: { error: 'access_denied' },
        });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('AUTH_IDP_ACCESS_DENIED');
        expect(mockIssueTokens).not.toHaveBeenCalled();
        expect(findAuditCall('FAILURE', 'AUTH_IDP_ACCESS_DENIED')).toBeTruthy();
    });

    it('code ถูก IdP ปฏิเสธ → 401 AUTH_IDP_CODE_INVALID (ใช้ไม่ได้ = ปฏิเสธก่อน mint)', async () => {
        const app = buildApp();
        const res = await beginThaidCallback(app, {
            fetchStatus: 400, fetchBody: { error: 'invalid_request' },
        });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('AUTH_IDP_CODE_INVALID');
        expect(mockIssueTokens).not.toHaveBeenCalled();
        expect(findAuditCall('FAILURE', 'AUTH_IDP_CODE_INVALID')).toBeTruthy();
    });

    it('id_token ไม่มี subject → 502 AUTH_IDP_PROFILE_INCOMPLETE + audit FAILURE', async () => {
        mockDecodeSubject.mockReturnValue(null);
        const app = buildApp();
        const res = await beginThaidCallback(app);
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('AUTH_IDP_PROFILE_INCOMPLETE');
        expect(findAuditCall('FAILURE', 'PROFILE_INCOMPLETE')).toBeTruthy();
        expect(mockResolveThaidLogin).not.toHaveBeenCalled();
        expect(mockIssueTokens).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4 (audit-verified two-shape gap): §6.2.2's "**" note
// (evidence/AUTH-01/manual-citations.md:134-135) — WITHOUT `openid` scope,
// pid/given_name/family_name arrive TOP-LEVEL on the token response; WITH
// `openid` those same values move INSIDE the id_token instead. Whether
// BORA's sandbox echoes both shapes at once cannot be known statically (no
// prior sandbox call exists to observe) — resolveThaidSession must tolerate
// EITHER. mockReturnValueOnce is used for the new decodeIdTokenClaims mock
// throughout this block specifically so nothing here can leak a stale return
// value into a later, unrelated test (mockDecodeClaims otherwise has no
// established convention in this file to lean on).
describe('POST /api/auth/idp/thaid/callback — two-shape pid/name extraction (Task 4)', () => {
    it('(a) id_token carries pid/name INSIDE (no top-level pid) → nationalId/name resolved from id_token claims', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockDecodeClaims.mockReturnValueOnce({
            sub: 'thaid-subject-1', pid: '1234567890123',
            given_name: 'สมศรี', family_name: 'ทดสอบระบบ',
        });
        mockResolveThaidLogin.mockResolvedValue(resolved(STAFF_ROW));
        mockIssueTokens.mockResolvedValue({ token: 'signed-provider-jwt' });
        const app = buildApp();
        // openid-scope shape: id_token present, NO top-level pid/given_name/family_name.
        const res = await beginThaidCallback(app, {
            fetchBody: { access_token: 'thaid-access-token', token_type: 'Bearer', expire_in: 300, id_token: 'h.p.s' },
        });
        expect(res.status).toBe(200);
        expect(mockResolveThaidLogin).toHaveBeenCalledWith({
            subject: 'thaid-subject-1', nationalId: '1234567890123',
            firstNameTh: 'สมศรี', lastNameTh: 'ทดสอบระบบ',
        });
    });

    it('(b) REGRESSION PIN: top-level pid/name only (id_token carries just sub) → still resolves via top-level fallback', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        // id_token decodes but carries no pid/name claims at all — the shape
        // §6.2.2 documents when `openid` is NOT requested.
        mockDecodeClaims.mockReturnValueOnce({
            sub: 'thaid-subject-1', pid: null, given_name: null, family_name: null,
        });
        mockResolveThaidLogin.mockResolvedValue(resolved(STAFF_ROW));
        mockIssueTokens.mockResolvedValue({ token: 'signed-provider-jwt' });
        const app = buildApp();
        const res = await beginThaidCallback(app); // THAID_TOKEN_BODY: top-level pid/given_name/family_name
        expect(res.status).toBe(200);
        expect(mockResolveThaidLogin).toHaveBeenCalledWith({
            subject: 'thaid-subject-1', nationalId: '1234567890123',
            firstNameTh: 'สมศรี', lastNameTh: 'ทดสอบระบบ',
        });
    });

    it('id_token claims win over top-level when BOTH are present (precedence pin)', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockDecodeClaims.mockReturnValueOnce({
            sub: 'thaid-subject-1', pid: '9998887776665',
            given_name: 'จาก id_token', family_name: 'จาก id_token',
        });
        mockResolveThaidLogin.mockResolvedValue(resolved(STAFF_ROW));
        mockIssueTokens.mockResolvedValue({ token: 'signed-provider-jwt' });
        const app = buildApp();
        // THAID_TOKEN_BODY carries a DIFFERENT top-level pid/name — id_token must win.
        const res = await beginThaidCallback(app);
        expect(res.status).toBe(200);
        expect(mockResolveThaidLogin).toHaveBeenCalledWith({
            subject: 'thaid-subject-1', nationalId: '9998887776665',
            firstNameTh: 'จาก id_token', lastNameTh: 'จาก id_token',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/idp/providerid/callback — provider จริง (ธง D-MANUAL-HASHCID)', () => {
    function primeProviderIdFetch() {
        global.fetch
            // ขา 1 — Health ID token ([P-OAUTH] หน้า 5 envelope)
            .mockResolvedValueOnce(jsonResponse(200, {
                status: 200,
                data: { access_token: 'healthid-access-token', token_type: 'Bearer', account_id: 'pid-account-777' },
                message: 'success',
            }))
            // ขา 2 — Provider ID token exchange ([P-OAUTH] หน้า 7-8)
            .mockResolvedValueOnce(jsonResponse(200, {
                access_token: 'provider-access-token', token_type: 'Bearer',
                expires_in: 86400, account_id: 'pid-account-777',
            }))
            // profile ([P-OAUTH] หน้า 10-12)
            .mockResolvedValueOnce(jsonResponse(200, {
                account_id: 'pid-account-777',
                hash_cid: 'a'.repeat(64),
                provider_id: 'PV-777',
                organization: [],
            }));
    }

    it('profile สำเร็จ → 409 AUTH_LINKING_PENDING ข้อความไทยทางการ — ไม่แตะ user ใด ๆ', async () => {
        setFullProviderIdEnv();
        const app = buildApp();
        const { stateCookie, state } = await beginFlow(app, 'providerid');
        primeProviderIdFetch();
        const res = await request(app)
            .post('/api/auth/idp/providerid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-authorization-code', state });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('AUTH_LINKING_PENDING');
        expect(typeof res.body.messageTh).toBe('string');
        expect(res.body.messageTh.length).toBeGreaterThan(0);
        // ธง D-MANUAL-HASHCID: ห้ามสร้าง/แก้/ค้นเพื่อผูก user — prisma.user ต้องเงียบสนิท
        for (const fn of Object.values(mockPrismaUser)) {
            expect(fn).not.toHaveBeenCalled();
        }
        expect(mockFindByHash).not.toHaveBeenCalled();
        expect(mockIssueTokens).not.toHaveBeenCalled();
        const call = findAuditCall('FAILURE', 'LINKING_PENDING');
        expect(call).toBeTruthy();
        expect(call[6].provider).toBe('providerid');
        expect(call[6].subjectHash).toBe(sha256('pid-account-777'));
    });

    it('IdP ล่ม (network error) → 502 AUTH_IDP_UNAVAILABLE + audit FAILURE', async () => {
        setFullProviderIdEnv();
        const app = buildApp();
        const { stateCookie, state } = await beginFlow(app, 'providerid');
        global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
        const res = await request(app)
            .post('/api/auth/idp/providerid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-authorization-code', state });
        expect(res.status).toBe(502);
        expect(res.body.code).toBe('AUTH_IDP_UNAVAILABLE');
        expect(findAuditCall('FAILURE', 'AUTH_IDP_UNAVAILABLE')).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/auth/idp/thaid/callback — state anti-CSRF ยังบังคับกับ provider ThaID', () => {
    // ค่า placeholder ล้วน (B1-CRED) — โครงเดียวกับ setFullProviderIdEnv
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

    it('state ผิด (ไม่ตรง cookie) → 400 AUTH_STATE_INVALID — ไม่แลก token, ไม่ mint session', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie } = await beginFlow(app, 'thaid');
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-thaid-code', state: 'f'.repeat(64) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('AUTH_STATE_INVALID');
        // state ล้มก่อนถึง adapter → ไม่มี fetch ไป BORA, ไม่ mint session
        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockIssueTokens).not.toHaveBeenCalled();
        expect(findAuditCall('FAILURE', 'STATE_INVALID')).toBeTruthy();
    });

    it('ไม่มี state ใน body → 400 AUTH_STATE_INVALID (single-use/anti-CSRF ครอบ thaid ด้วย)', async () => {
        setFullThaidEnv();
        const app = buildApp();
        const { stateCookie } = await beginFlow(app, 'thaid');
        const res = await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-thaid-code' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('AUTH_STATE_INVALID');
        expect(mockIssueTokens).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('audit log ทุก outcome — subjectHash ไม่ใช่ค่าดิบ (mandate §D4; Law 3.3)', () => {
    it('thaid happy → IDP_LOGIN_SUCCESS พร้อม subjectHash = thaidSubjectKey(subject) (keyed, R-D Task 3) ไม่ใช่ sha256 ธรรมดา ไม่มีค่าดิบใน metadata', async () => {
        mockDecodeSubject.mockReturnValue('thaid-subject-1');
        mockResolveThaidLogin.mockResolvedValue(resolved(STAFF_ROW));
        mockIssueTokens.mockResolvedValue({ token: 'signed-provider-jwt' });
        const app = buildApp();
        await beginThaidCallback(app);
        const success = findAuditCall('SUCCESS');
        expect(success).toBeTruthy();
        expect(success[0]).toBe('IDP_LOGIN_SUCCESS');
        expect(success[1]).toBe(STAFF_ROW.id);
        expect(success[6].provider).toBe('thaid');
        // (d) audit hash: keyed derivation, NOT the old bare sha256(sub) —
        // ThaID's sub is documented as the raw CID, so a bare hash of it
        // would be a fixed non-reversible fingerprint of that CID.
        expect(success[6].subjectHash).toBe(mockThaidSubjectKey('thaid-subject-1'));
        expect(success[6].subjectHash).not.toBe(sha256('thaid-subject-1'));
        // ค่าดิบ (subject ของ IdP / เลข 13 หลัก) ต้องไม่โผล่ใน metadata
        const metaJson = JSON.stringify(success[6]);
        expect(metaJson).not.toContain('thaid-subject-1');
        expect(metaJson).not.toContain('1234567890123');
    });

    it('ทุกเส้นปฏิเสธ/ล้มเหลวของ callback มี IDP_LOGIN_FAILURE อย่างน้อยหนึ่งรายการ', async () => {
        const app = buildApp();

        // (1) ผู้ใช้กดปฏิเสธที่ IdP
        await beginThaidCallback(app, { fetchStatus: 401, fetchBody: { error: 'access_denied' } });
        // (2) state ไม่ตรง cookie — ตายก่อนถึง adapter
        setFullThaidEnv();
        const { stateCookie } = await beginFlow(app);
        await request(app)
            .post('/api/auth/idp/thaid/callback')
            .set('Cookie', stateCookie)
            .send({ code: 'real-code-from-redirect', state: 'f'.repeat(64) });
        // (3) id_token ไม่มี subject
        mockDecodeSubject.mockReturnValue(null);
        await beginThaidCallback(app);

        expect(findAuditCall('FAILURE', 'AUTH_IDP_ACCESS_DENIED')).toBeTruthy();
        expect(findAuditCall('FAILURE', 'STATE_INVALID')).toBeTruthy();
        expect(findAuditCall('FAILURE', 'PROFILE_INCOMPLETE')).toBeTruthy();
        const failures = mockLogAuth.mock.calls.filter((call) => call[3] === 'FAILURE');
        expect(failures.length).toBeGreaterThanOrEqual(3);
        for (const call of failures) {
            expect(call[0]).toBe('IDP_LOGIN_FAILURE');
            expect(call[6].provider).toBe('thaid');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('wiring pins — CSRF bypass + mount + rate limiter (plan.md P2:21)', () => {
    it('CSRF bypass ครอบ 2 path ใหม่ (ทั้ง /api และ /api/v1) และไม่ครอบ path อื่นใต้ /auth/idp', () => {
        const { DEFAULT_BYPASS_PATTERNS } = require('../../middleware/csrf-middleware');
        const bypassed = (p) => DEFAULT_BYPASS_PATTERNS.some((rx) => rx.test(p));
        expect(bypassed('/api/auth/idp/mock/authorize-url')).toBe(true);
        expect(bypassed('/api/v1/auth/idp/mock/authorize-url')).toBe(true);
        expect(bypassed('/api/auth/idp/providerid/callback')).toBe(true);
        expect(bypassed('/api/v1/auth/idp/providerid/callback')).toBe(true);
        expect(bypassed('/api/auth/idp/mock/other-endpoint')).toBe(false);
    });

    it('routes/api/index.js mount /auth/idp', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../routes/api/index.js'), 'utf8');
        expect(src).toMatch(/router\.use\('\/auth\/idp'/);
    });

    it('server.js ครอบ /auth/idp ด้วย idp-rate-limit factory ที่รับ authLimiter จริง', () => {
        // History of this pin, because it embodies the lesson: v1 asserted the
        // bare authLimiter mount; v2 asserted the inline carve-out via source
        // regexes — and the E1 deep review PROVED v2 constrained nothing
        // (inverting the branch passed every regex). v3: the branch logic
        // lives in middleware/idp-rate-limit.js where idp-rate-limit.test.js
        // exercises it with real supertest requests and counts which limiter
        // saw what. This pin keeps only what a source pin CAN keep honestly —
        // that server.js mounts that factory, on that prefix, fed the strict
        // limiter — and leaves behaviour to the behavioural suite.
        const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
        expect(src).toMatch(/app\.use\(`\$\{prefix\}\/auth\/idp`,\s*createIdpRateLimit\(\{ authLimiter \}\)\)/);
        expect(src).toMatch(/require\('\.\/middleware\/idp-rate-limit'\)/);
    });
});
