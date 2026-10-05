'use strict';

/**
 * AUTH-01 P1 — AUTH_PROVIDERS config SSOT (evidence/AUTH-01/mandate.md §D2, §D5;
 * evidence/AUTH-01/plan.md P1). RED-first ตาม Law 3.11 —
 * red-output: evidence/AUTH-01/P1/red-output.txt
 *
 * Contract under test (config/auth-providers.js):
 *   - registry 4 provider: local | healthid | providerid | thaid
 *     (mock ถูกถอนทั้งชั้นเมื่อ 2026-08-14 ตามคำสั่ง operator —
 *     spec design note 2026-08-14-remove-mock-idp-design §5)
 *   - default states: local=enabled (TRANSITIONAL §C4), provider จริงทุกตัว
 *     =coming_soon (ธง B1-CRED)
 *   - fail-closed: provider ที่ config ไม่ครบ = ไม่มีทางเป็น enabled ได้จริง
 *   - getAuthProviders() ไม่มี secret ใด ๆ ใน output (Law 3.3 grep-pin)
 *   - config layer เป็นที่เดียวที่อ่าน process.env (ratchet env-direct)
 */

const {
    PROVIDER_KEYS,
    getAuthProviders,
    getProviderConfig,
    isProviderEnabled,
    assertProviderReady,
} = require('../../config/auth-providers');

let envBackup;

beforeEach(() => {
    envBackup = { ...process.env };
    // Isolate: every test starts from "no AUTH_* env set" (pure defaults).
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('AUTH_')) { delete process.env[key]; }
    }
    // …and from "no deploy slot": a shell that happened to export
    // GACP_DEPLOY_SLOT=staging would otherwise silently disarm the
    // production-lockout cases below (E1 Task 2).
    delete process.env.GACP_DEPLOY_SLOT;
});

afterEach(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in envBackup)) { delete process.env[key]; }
    }
    Object.assign(process.env, envBackup);
});

function stateOf(providerKey) {
    const list = getAuthProviders() || [];
    const row = list.find((p) => p && p.key === providerKey);
    return row ? row.state : undefined;
}

function thrownCode(fn) {
    try { fn(); } catch (err) { return err && err.code; }
    return undefined;
}

// ค่า placeholder ล้วน — ไม่ใช่ credential จริง (B1-CRED: ของจริงยังไม่มี)
// สองคู่ credential แยกการลงทะเบียน (audit F1; manual-citations.md:59,78,95):
//   คู่ Health ID = CLIENT_ID+CLIENT_SECRET · คู่ระบบ Provider ID = PID_CLIENT_ID+SECRET_KEY
function setFullProviderIdEnv() {
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

// ค่า placeholder ล้วน — ไม่ใช่ credential จริง (B1-CRED). ThaID เป็นพาหนะของเคส
// staging-slot หลัง mock ถูกถอน: state staging_only ต้องมี config ครบก่อน จึงจะ
// เห็นผลของ isStagingSlot() ได้ (ไม่งั้นตกที่ fail-closed ก่อน — วัดคนละอย่าง)
function setFullThaidEnv() {
    process.env.AUTH_THAID_CLIENT_ID = 'test-thaid-client';
    process.env.AUTH_THAID_CLIENT_SECRET = 'test-thaid-client-secret-value';
    process.env.AUTH_THAID_REDIRECT_URI = 'https://gacp.example/auth/callback/thaid';
    process.env.AUTH_THAID_AUTHORIZE_URL = 'https://thaid.example/api/v2/oauth2/auth/';
    process.env.AUTH_THAID_TOKEN_URL = 'https://thaid.example/api/v2/oauth2/token/';
    process.env.AUTH_THAID_INTROSPECT_URL = 'https://thaid.example/api/v2/oauth2/introspect/';
    process.env.AUTH_THAID_SCOPE = 'pid given_name family_name';
}

describe('AUTH_PROVIDERS registry (mandate §D2)', () => {
    test('registry มีครบ 4 provider ตาม vocab: local | healthid | providerid | thaid', () => {
        expect(PROVIDER_KEYS).toEqual(['local', 'healthid', 'providerid', 'thaid']);
        const listed = (getAuthProviders() || []).map((p) => p && p.key);
        expect(listed).toEqual(['local', 'healthid', 'providerid', 'thaid']);
        // tombstone: ไม่มีทะเบียนจำลองอีกแล้ว (operator 2026-08-14)
        expect(PROVIDER_KEYS).not.toContain('mock');
    });

    test('default states: local=enabled, healthid/providerid/thaid=coming_soon (B1-CRED)', () => {
        expect(stateOf('local')).toBe('enabled');
        expect(stateOf('healthid')).toBe('coming_soon');
        expect(stateOf('providerid')).toBe('coming_soon');
        expect(stateOf('thaid')).toBe('coming_soon');
    });

    test('isProviderEnabled defaults ตรงกับ states', () => {
        expect(isProviderEnabled('local')).toBe(true);
        expect(isProviderEnabled('healthid')).toBe(false);
        expect(isProviderEnabled('providerid')).toBe(false);
        expect(isProviderEnabled('thaid')).toBe(false);
    });

    test('unknown key: isProviderEnabled=false, getProviderConfig/assertProviderReady โยน AUTH_PROVIDER_UNKNOWN', () => {
        expect(isProviderEnabled('facebook')).toBe(false);
        expect(thrownCode(() => getProviderConfig('facebook'))).toBe('AUTH_PROVIDER_UNKNOWN');
        expect(thrownCode(() => assertProviderReady('facebook'))).toBe('AUTH_PROVIDER_UNKNOWN');
    });
});

describe('fail-closed: config ไม่ครบ = ไม่มีทางเป็น enabled (mandate §D2 + แบบ assertReady ของ payment)', () => {
    test('AUTH_PROVIDERID_STATE=enabled แต่ไม่มี config ใดเลย → ไม่ enabled + AUTH_PROVIDER_NOT_CONFIGURED', () => {
        process.env.AUTH_PROVIDERID_STATE = 'enabled';
        expect(isProviderEnabled('providerid')).toBe(false);
        expect(stateOf('providerid')).toBe('coming_soon');
        expect(thrownCode(() => assertProviderReady('providerid'))).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
    });

    test('ขาดตัวเดียว (SECRET_KEY) ก็ fail-closed เหมือนกัน', () => {
        setFullProviderIdEnv();
        delete process.env.AUTH_PROVIDERID_SECRET_KEY;
        process.env.AUTH_PROVIDERID_STATE = 'enabled';
        expect(isProviderEnabled('providerid')).toBe(false);
        expect(thrownCode(() => assertProviderReady('providerid'))).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
    });

    test('ขาด PID_CLIENT_ID (client ของระบบ Provider ID — audit F1) ก็ fail-closed เหมือนกัน', () => {
        setFullProviderIdEnv();
        delete process.env.AUTH_PROVIDERID_PID_CLIENT_ID;
        process.env.AUTH_PROVIDERID_STATE = 'enabled';
        expect(isProviderEnabled('providerid')).toBe(false);
        expect(thrownCode(() => assertProviderReady('providerid'))).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
    });

    test('config ครบ + STATE=enabled → enabled จริง และ getProviderConfig คืนครบทุก field', () => {
        setFullProviderIdEnv();
        process.env.AUTH_PROVIDERID_STATE = 'enabled';
        expect(isProviderEnabled('providerid')).toBe(true);
        expect(thrownCode(() => assertProviderReady('providerid'))).toBeUndefined();
        const cfg = getProviderConfig('providerid') || {};
        expect(cfg.clientId).toBe('test-providerid-client');
        expect(cfg.clientSecret).toBe('test-providerid-client-secret-value');
        expect(cfg.redirectUri).toBe('https://gacp.example/auth/callback/providerid');
        expect(cfg.authorizeUrl).toBe('https://healthid.example/oauth/redirect');
        expect(cfg.tokenUrl).toBe('https://healthid.example/api/v1/token');
        expect(cfg.profileUrl).toBe('https://providerid.example/api/v1/services/profile');
        // audit F1: คู่ระบบ Provider ID เป็น field แยก — คนละการลงทะเบียนกับคู่ Health ID
        expect(cfg.pidClientId).toBe('test-providerid-pid-client');
        expect(cfg.secretKey).toBe('test-providerid-secret-key-value');
        expect(cfg.tokenExchangeUrl).toBe('https://providerid.example/api/v1/services/token');
        expect(typeof cfg.timeoutMs).toBe('number');
    });

    test('ค่า state นอก vocab (เช่น "yolo") → fail-closed ไม่ enabled', () => {
        setFullProviderIdEnv();
        process.env.AUTH_PROVIDERID_STATE = 'yolo';
        expect(isProviderEnabled('providerid')).toBe(false);
        expect(stateOf('providerid')).toBe('coming_soon');
    });

    test('staging_only: enabled เฉพาะ non-production', () => {
        setFullProviderIdEnv();
        process.env.AUTH_PROVIDERID_STATE = 'staging_only';
        expect(isProviderEnabled('providerid')).toBe(true);
        process.env.NODE_ENV = 'production';
        expect(isProviderEnabled('providerid')).toBe(false);
    });

    test('provider จริงที่ยัง coming_soon (healthid/providerid) → assertProviderReady โยน AUTH_PROVIDER_DISABLED', () => {
        expect(thrownCode(() => assertProviderReady('providerid'))).toBe('AUTH_PROVIDER_DISABLED');
        expect(thrownCode(() => assertProviderReady('healthid'))).toBe('AUTH_PROVIDER_DISABLED');
    });

    test('thaid: default enabled แต่ยังไม่มี cred → fail-closed เป็น NOT_CONFIGURED (ไม่ใช่ DISABLED)', () => {
        // ThaID เปิดใช้แล้ว (adapter + spec + sandbox cred พร้อม 2026-08) →
        // DEFAULT_STATES.thaid='enabled'. env ที่ยังไม่มี AUTH_THAID_* ครบ → ยังใช้ไม่ได้
        // แต่แยกสาเหตุ "อยาก enabled แต่ config ไม่ครบ" = NOT_CONFIGURED (operator วินิจฉัย
        // ถูกจุด) ไม่ใช่ DISABLED (ซึ่งแปลว่า coming_soon = ปิดตั้งใจ).
        expect(isProviderEnabled('thaid')).toBe(false);
        expect(thrownCode(() => assertProviderReady('thaid'))).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
    });

    // Task 4 (audit-verified): AUTH_THAID_INTROSPECT_URL demoted out of
    // REQUIRED_ENV.thaid — resolveThaidSession (routes/api/auth/auth-idp.js)
    // never calls introspect on the login path (identity comes straight off
    // the token/id_token), so requiring a var for a dead endpoint only cost
    // operator debugging time. getProviderConfig still exposes it when set
    // (unchanged below) for a future getProfile() caller.
    test('thaid: 6 remaining required vars set + INTROSPECT_URL UNSET → resolves enabled (Task 4 — introspect optional)', () => {
        setFullThaidEnv();
        delete process.env.AUTH_THAID_INTROSPECT_URL;
        expect(isProviderEnabled('thaid')).toBe(true);
        expect(thrownCode(() => assertProviderReady('thaid'))).toBeUndefined();
    });

    test('thaid: any of the 6 remaining required vars missing → still coming_soon (fail-closed preserved, Task 4)', () => {
        setFullThaidEnv();
        delete process.env.AUTH_THAID_CLIENT_ID;
        expect(isProviderEnabled('thaid')).toBe(false);
        expect(stateOf('thaid')).toBe('coming_soon');
        expect(thrownCode(() => assertProviderReady('thaid'))).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
    });

    test('thaid: getProviderConfig still exposes introspectUrl WHEN SET, even though it is no longer required', () => {
        setFullThaidEnv();
        const cfg = getProviderConfig('thaid') || {};
        expect(cfg.introspectUrl).toBe('https://thaid.example/api/v2/oauth2/introspect/');
    });
});

describe('local = provider TRANSITIONAL ถอดได้ด้วย config (mandate §C4 amended)', () => {
    test('local ยัง enabled บน production (ยังไม่ถึงเงื่อนไขถอดตาม §F0.6)', () => {
        process.env.NODE_ENV = 'production';
        expect(isProviderEnabled('local')).toBe(true);
    });

    test('AUTH_LOCAL_STATE=coming_soon → local ปิดได้ด้วย config (seam สำหรับ two-state pin P5)', () => {
        process.env.AUTH_LOCAL_STATE = 'coming_soon';
        expect(isProviderEnabled('local')).toBe(false);
        expect(stateOf('local')).toBe('coming_soon');
    });
});

/**
 * Staging slot (E1 Task 2) — เครื่อง staging รัน image เดียวกับ production ⇒
 * NODE_ENV เพียงตัวเดียวแยกสองกล่องไม่ได้ · marker GACP_DEPLOY_SLOT=staging
 * ตั้งได้ที่เดียวคือ docker-compose.staging.yml (Tier C — operator merge) และมี
 * __tests__/unit/staging-slot-compose-pin.test.js ปักว่าไฟล์ production ห้ามมี
 * ⇒ invariant ใหม่คือ "production = NODE_ENV production + ไม่มี marker"
 */
describe('staging slot (GACP_DEPLOY_SLOT)', () => {
    test('staging_only resolves ENABLED on the staging slot under NODE_ENV=production — the || isStagingSlot() branch had zero coverage (deep review)', () => {
        process.env.NODE_ENV = 'production';
        process.env.GACP_DEPLOY_SLOT = 'staging';
        process.env.AUTH_THAID_STATE = 'staging_only';
        process.env.AUTH_THAID_CLIENT_ID = 'x';
        process.env.AUTH_THAID_CLIENT_SECRET = 'x';
        process.env.AUTH_THAID_REDIRECT_URI = 'https://x.example/cb';
        process.env.AUTH_THAID_AUTHORIZE_URL = 'https://x.example/auth';
        process.env.AUTH_THAID_TOKEN_URL = 'https://x.example/token';
        process.env.AUTH_THAID_INTROSPECT_URL = 'https://x.example/introspect';
        process.env.AUTH_THAID_SCOPE = 'openid pid';
        jest.resetModules();
        const { isProviderEnabled } = require('../../config/auth-providers');
        expect(isProviderEnabled('thaid')).toBe(true);
    });

    // isProviderEnabled ตอบว่าเปิด แต่ assertProviderReady โยน DISABLED = ปุ่ม
    // ที่ "กดได้แต่พัง" — ความขัดแย้งในโมดูลเดียวกัน เทสต์นี้ปักว่าสองตัวตอบตรงกัน
    // บน slot (พาหนะเดิมคือ mock — ย้ายมา thaid เมื่อ mock ถูกถอน 2026-08-14)
    test('assertProviderReady("thaid") ผ่านบน staging slot — flow ต้องเดิน authorize-url ได้จริง', () => {
        process.env.NODE_ENV = 'production';
        process.env.GACP_DEPLOY_SLOT = 'staging';
        process.env.AUTH_THAID_STATE = 'staging_only';
        setFullThaidEnv();
        jest.resetModules();
        const { assertProviderReady: freshAssert } = require('../../config/auth-providers');
        expect(thrownCode(() => freshAssert('thaid'))).toBeUndefined();
    });

    test('assertProviderReady("thaid") ยังโยน DISABLED บน production จริง (ไม่มี marker)', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.GACP_DEPLOY_SLOT;
        process.env.AUTH_THAID_STATE = 'staging_only';
        setFullThaidEnv();
        jest.resetModules();
        const { assertProviderReady: freshAssert } = require('../../config/auth-providers');
        expect(thrownCode(() => freshAssert('thaid'))).toBe('AUTH_PROVIDER_DISABLED');
    });

    test('an unexpected slot value changes nothing — only the exact string counts', () => {
        process.env.NODE_ENV = 'production';
        process.env.GACP_DEPLOY_SLOT = 'staging '; // trailing space: not the marker
        process.env.AUTH_THAID_STATE = 'staging_only';
        setFullThaidEnv();
        jest.resetModules();
        const { isProviderEnabled: freshIsProviderEnabled } = require('../../config/auth-providers');
        expect(freshIsProviderEnabled('thaid')).toBe(false);
    });
});

describe('getAuthProviders() ห้ามคืน secret (Law 3.3 grep-pin)', () => {
    test('ไม่มีชื่อ key หรือค่า secret ใด ๆ ใน output แม้ config ครบ', () => {
        setFullProviderIdEnv();
        process.env.AUTH_PROVIDERID_STATE = 'enabled';
        const out = getAuthProviders() || [];
        expect(out).toHaveLength(4); // กัน pin หลอก: ต้องมีข้อมูลจริงก่อนค่อยตรวจว่าไม่รั่ว
        const serialized = JSON.stringify(out);
        // grep-pin ชื่อ field ต้องห้าม
        expect(serialized).not.toMatch(/secret/i);
        expect(serialized).not.toMatch(/token/i);
        expect(serialized).not.toMatch(/client_?id/i);
        // ค่า secret จริงต้องไม่รั่ว
        expect(serialized).not.toContain('test-providerid-client-secret-value');
        expect(serialized).not.toContain('test-providerid-secret-key-value');
        // โครงสร้างต่อแถว: มีแค่ key + state เท่านั้น
        for (const row of out) {
            expect(Object.keys(row).sort()).toEqual(['key', 'state']);
        }
    });
});
