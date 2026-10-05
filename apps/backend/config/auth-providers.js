'use strict';

/**
 * AUTH provider registry — SSOT เดียวของสถานะช่องทางเข้าสู่ระบบ
 * (AUTH-01 P1; evidence/AUTH-01/mandate.md §D2, §D5; plan.md P1)
 *
 * Idiom เดียวกับ config/stripe.js: PURE CONFIG ONLY — ไฟล์นี้คือที่เดียวที่อ่าน
 * process.env (ratchet env-direct ไม่นับ config/) adapter ห้ามแตะ environment เอง
 *
 * States ต่อ provider (mandate §D2): enabled | staging_only | coming_soon
 *   - default: local=enabled (TRANSITIONAL ตาม §C4 — ถอดได้ด้วย AUTH_LOCAL_STATE),
 *     healthid/providerid=coming_soon (ธง B1-CRED — credentials จริงยังไม่มา)
 *   - ไม่มี provider จำลองในทะเบียนนี้ ไม่ว่า environment ใด (operator 2026-08-14;
 *     spec design note 2026-08-14-remove-mock-idp-design §5)
 *   - fail-closed: provider ที่ env config ไม่ครบ ไม่มีทางเป็น enabled ได้จริง
 *     (แบบ assertReady ของ payment adapter — stripe-adapter.js:40-42)
 *
 * ทุก endpoint URL มาจาก env เท่านั้น (Law 3.5 — ห้าม hardcode ในโค้ด) —
 * ค่า UAT/production พร้อมเลขหน้า citation อยู่ใน .env.example และ
 * evidence/AUTH-01/manual-citations.md ([P-OAUTH], [T-SBX], [T-PRD])
 */

const PROVIDER_KEYS = Object.freeze(['local', 'healthid', 'providerid', 'thaid']);
const PROVIDER_STATES = Object.freeze(['enabled', 'staging_only', 'coming_soon']);

const DEFAULT_STATES = Object.freeze({
    local: 'enabled',
    healthid: 'coming_soon',
    providerid: 'coming_soon',
    // ThaID (DOPA/BORA) — adapter + spec + sandbox cred พร้อม (2026-08). Default
    // 'enabled' แต่ fail-closed เป็น coming_soon เองถ้า REQUIRED_ENV ไม่ครบ
    // (assertProviderReady) → prod ที่ยังไม่มี cred = ปิดเงียบ ไม่พัง.
    thaid: 'enabled',
});

const STATE_ENV = Object.freeze({
    local: 'AUTH_LOCAL_STATE',
    healthid: 'AUTH_HEALTHID_STATE',
    providerid: 'AUTH_PROVIDERID_STATE',
    thaid: 'AUTH_THAID_STATE',
});

/**
 * env ที่ต้องครบก่อน provider จะ enabled ได้จริง (mandate §D2) —
 * providerid มีเพิ่มตาม [P-OAUTH] ส่วนที่ 2: secret_key + token exchange endpoint
 * (manual-citations.md หน้า 6-9)
 *
 * providerid ใช้ credential สองคู่คนละการลงทะเบียน (audit F1;
 * manual-citations.md:59,78,95 — B1-CRED):
 *   คู่ Health ID       = CLIENT_ID + CLIENT_SECRET ([P-OAUTH] หน้า 4)
 *   คู่ระบบ Provider ID = PID_CLIENT_ID + SECRET_KEY ([P-OAUTH] หน้า 7 + หน้า 9)
 */
const REQUIRED_ENV = Object.freeze({
    local: Object.freeze([]),
    healthid: Object.freeze([
        'AUTH_HEALTHID_CLIENT_ID', 'AUTH_HEALTHID_CLIENT_SECRET',
        'AUTH_HEALTHID_REDIRECT_URI', 'AUTH_HEALTHID_AUTHORIZE_URL',
        'AUTH_HEALTHID_TOKEN_URL', 'AUTH_HEALTHID_PROFILE_URL',
    ]),
    providerid: Object.freeze([
        'AUTH_PROVIDERID_CLIENT_ID', 'AUTH_PROVIDERID_CLIENT_SECRET',
        'AUTH_PROVIDERID_REDIRECT_URI', 'AUTH_PROVIDERID_AUTHORIZE_URL',
        'AUTH_PROVIDERID_TOKEN_URL', 'AUTH_PROVIDERID_PROFILE_URL',
        'AUTH_PROVIDERID_PID_CLIENT_ID', 'AUTH_PROVIDERID_SECRET_KEY',
        'AUTH_PROVIDERID_TOKEN_EXCHANGE_URL',
    ]),
    // ThaID/BORA (§6): authorization-code + Basic auth ที่ token endpoint +
    // scope ที่ authorize. ไม่มี "profile endpoint" แยก — ข้อมูลมากับ token/
    // id_token (§6.2) โดยตรง; SCOPE บังคับ (§6.1.1) และมาจาก env (Law 3.5 —
    // ห้าม hardcode ฟิลด์ที่ขอ).
    // AUTH_THAID_INTROSPECT_URL (§6.3) ไม่อยู่ในรายการนี้ — Task 4 (audit-
    // verified): login flow (resolveThaidSession, routes/api/auth/auth-idp.js)
    // return ก่อนถึงจุดที่จะเรียก introspect เสมอ ไม่มี caller จริงเส้นไหนยิง
    // endpoint นี้เลย — บังคับ env ตัวที่ endpoint ตายอยู่มีแต่ทำให้ operator เสีย
    // เวลาไล่ debug ทั้งที่ provider ควรจะ enabled ได้แล้ว ไม่ใช่ security ที่ผ่อน
    // (ยังคง exposed ผ่าน getProviderConfig ด้านล่างเผื่อ getProfile ถูกเรียกในอนาคต)
    thaid: Object.freeze([
        'AUTH_THAID_CLIENT_ID', 'AUTH_THAID_CLIENT_SECRET',
        'AUTH_THAID_REDIRECT_URI', 'AUTH_THAID_AUTHORIZE_URL',
        'AUTH_THAID_TOKEN_URL', 'AUTH_THAID_SCOPE',
    ]),
});

/** ขอบเวลา HTTP ต่อ IdP (AbortController) — override ด้วย AUTH_IDP_TIMEOUT_MS */
const DEFAULT_IDP_TIMEOUT_MS = 10000;

function isProduction() {
    return process.env.NODE_ENV === 'production';
}

/**
 * NODE_ENV cannot tell the staging box from the production one: staging runs
 * the SAME image, which bakes `ENV NODE_ENV=production` (apps/backend/
 * Dockerfile:108) — whether it ends up 'staging' depends on the overlay/env-file
 * that happens to be loaded at deploy time. So "which slot am I on" gets its own
 * explicit marker instead of being inferred.
 *
 * GACP_DEPLOY_SLOT is set to 'staging' ONLY in docker-compose.staging.yml — an
 * operator-merged Tier C file — and staging-slot-compose-pin.test.js pins that
 * the production compose never carries it. Exact match, no trim: a value that
 * is almost the marker is not the marker.
 */
function isStagingSlot() {
    return process.env.GACP_DEPLOY_SLOT === 'staging';
}

function assertKnownProvider(key) {
    if (!PROVIDER_KEYS.includes(key)) {
        throw Object.assign(
            new Error(`auth provider "${key}" is not in the registry (${PROVIDER_KEYS.join('|')})`),
            { code: 'AUTH_PROVIDER_UNKNOWN' },
        );
    }
}

function isConfigComplete(key) {
    return REQUIRED_ENV[key].every((name) => Boolean(process.env[name]));
}

/** state ที่ขอผ่าน env — ค่านอก vocab = fail-closed เป็น coming_soon */
function requestedState(key) {
    const raw = process.env[STATE_ENV[key]] || DEFAULT_STATES[key];
    return PROVIDER_STATES.includes(raw) ? raw : 'coming_soon';
}

/** state จริงหลังบังคับกติกา fail-closed ทุกข้อ (§D5 + B1-CRED) */
function getEffectiveState(key) {
    assertKnownProvider(key);
    const state = requestedState(key);
    if (state !== 'coming_soon' && !isConfigComplete(key)) {
        return 'coming_soon';
    }
    return state;
}

function stateResolvesEnabled(state) {
    if (state === 'enabled') {
        return true;
    }
    return state === 'staging_only' && (!isProduction() || isStagingSlot());
}

function isProviderEnabled(key) {
    if (!PROVIDER_KEYS.includes(key)) {
        return false;
    }
    return stateResolvesEnabled(getEffectiveState(key));
}

/**
 * รายการ provider สำหรับผู้บริโภคภายนอก (P2 endpoint / P4 FE):
 * key + state เท่านั้น — ห้ามมี secret/credential/URL ใด ๆ (Law 3.3; test pin:
 * __tests__/unit/auth-providers-config.test.js)
 */
function getAuthProviders() {
    return PROVIDER_KEYS.map((key) => ({ key, state: getEffectiveState(key) }));
}

function getIdpTimeoutMs() {
    const raw = Number(process.env.AUTH_IDP_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDP_TIMEOUT_MS;
}

/**
 * Config เต็มของ provider (มี secret) — ใช้ภายใน backend service layer เท่านั้น
 * ห้าม serialize ออก API ใด ๆ
 */
function getProviderConfig(key) {
    assertKnownProvider(key);
    const base = { key, state: getEffectiveState(key), timeoutMs: getIdpTimeoutMs() };
    if (key === 'local') {
        return base;
    }
    const prefix = `AUTH_${key.toUpperCase()}_`;
    const cfg = {
        ...base,
        clientId: process.env[`${prefix}CLIENT_ID`],
        clientSecret: process.env[`${prefix}CLIENT_SECRET`],
        redirectUri: process.env[`${prefix}REDIRECT_URI`],
        authorizeUrl: process.env[`${prefix}AUTHORIZE_URL`],
        tokenUrl: process.env[`${prefix}TOKEN_URL`],
        profileUrl: process.env[`${prefix}PROFILE_URL`],
    };
    if (key === 'providerid') {
        // คู่ระบบ Provider ID — คนละการลงทะเบียนกับคู่ Health ID ข้างบน
        // (audit F1; [P-OAUTH] หน้า 7 token exchange + หน้า 9 header client-id)
        cfg.pidClientId = process.env.AUTH_PROVIDERID_PID_CLIENT_ID;
        cfg.secretKey = process.env.AUTH_PROVIDERID_SECRET_KEY;
        cfg.tokenExchangeUrl = process.env.AUTH_PROVIDERID_TOKEN_EXCHANGE_URL;
    }
    if (key === 'thaid') {
        // ThaID/BORA (§6): scope ที่ authorize + introspect endpoint แทน profile
        cfg.scope = process.env.AUTH_THAID_SCOPE;
        cfg.introspectUrl = process.env.AUTH_THAID_INTROSPECT_URL;
    }
    return cfg;
}

/**
 * Fail-fast แบบ assertReady ของ payment adapter: ผ่านเมื่อ provider enabled
 * ได้จริงเท่านั้น — แยก error ให้ operator วินิจฉัยถูกจุด:
 *   - อยาก enabled แต่ config ไม่ครบ → AUTH_PROVIDER_NOT_CONFIGURED
 *   - ไม่ enabled (coming_soon / staging_only นอก slot) → AUTH_PROVIDER_DISABLED
 */
function assertProviderReady(key) {
    assertKnownProvider(key);
    const wantsEnabled = stateResolvesEnabled(requestedState(key));
    if (wantsEnabled) {
        if (!isConfigComplete(key)) {
            throw Object.assign(
                new Error(`auth provider "${key}" is missing required env config — sign-in fails closed`),
                { code: 'AUTH_PROVIDER_NOT_CONFIGURED' },
            );
        }
        return;
    }
    throw Object.assign(
        new Error(`auth provider "${key}" is not enabled (state: ${getEffectiveState(key)})`),
        { code: 'AUTH_PROVIDER_DISABLED' },
    );
}

module.exports = {
    PROVIDER_KEYS,
    PROVIDER_STATES,
    getAuthProviders,
    getProviderConfig,
    getIdpTimeoutMs,
    isProviderEnabled,
    assertProviderReady,
    // Single production predicate for the auth-config domain (Law 3.6 SSOT).
    // Exposed so auth services can fail-closed on production without each
    // re-reading process.env.NODE_ENV (env-direct ratchet stays flat).
    isProduction,
    // Same reason, other half of the pair: "which box am I on" has exactly one
    // reader of GACP_DEPLOY_SLOT in the codebase — this one.
    isStagingSlot,
};
