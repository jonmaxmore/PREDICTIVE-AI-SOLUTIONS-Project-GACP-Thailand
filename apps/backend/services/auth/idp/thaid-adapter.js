'use strict';

/**
 * ThaIdAdapter — ThaID (ระบบพิสูจน์และยืนยันตัวตนทางดิจิทัล กรมการปกครอง /
 * BORA / DOPA) ผ่าน OAuth 2.0 authorization-code ตามคู่มือ "การพัฒนา API บน
 * Sandbox สำหรับผู้ให้บริการ (RP)" รุ่น 1.0.0 (7 ส.ค. 2567) และฉบับ Production
 * — endpoint/parameter ทุกตัวมาจากคู่มือ §6; ค่าที่คู่มือไม่ระบุ = ไม่ implement
 * (ไม่มี PKCE / refresh flow / revoke ในไฟล์นี้).
 *
 * ต่างจาก provider-id-adapter (MOPH):
 *   - ThaID ใช้ HTTP Basic (Base64(client_id:client_secret)) ที่ token endpoint
 *     (§6.2.1) — ไม่ส่ง client_id/secret ใน body
 *   - authorize ต้องมี `scope` (§6.1.1) — เลือกฟิลด์ที่ RP ขอ (pid/name/... /openid)
 *   - ThaID ไม่มี "profile endpoint" แยก: ข้อมูลผู้ใช้มากับ token response ตาม
 *     scope (§6.2.2) หรือใน id_token (§6.2.3). getProfile จึงใช้ introspect
 *     (§6.3) เพื่อ "ยืนยันว่า token ยัง active + คืน sub" — ตัวข้อมูล pid/name
 *     ที่ใช้สร้าง/ผูก user อยู่ใน exchangeCode().raw ให้ consumer อ่านต่อ.
 *
 * ไฟล์นี้ห้ามมี logic linking/user-lookup/PII-hash — คืน raw ตามที่ IdP ตอบ
 * เท่านั้น (การผูก id_token.sub → identity_links.subject และ pid → user เป็น
 * หน้าที่ของ consumer/callback). endpoint/credential ทุกตัวมาจาก
 * config/auth-providers.js (Law 3.5 — ห้าม hardcode URL/scope ในโค้ด).
 */

const { getProviderConfig } = require('../../../config/auth-providers');

const name = 'thaid';

/** §6.2.1: grant_type literal ตามคู่มือ */
const GRANT_TYPE = 'authorization_code';

function config() {
    return getProviderConfig('thaid');
}

/** ดึง error_description/error จาก body มาตรฐาน OAuth (§6.1.3 / §7) */
function messageOf(body) {
    if (!body || typeof body !== 'object') {
        return '';
    }
    if (typeof body.error_description === 'string') {
        return body.error_description;
    }
    if (typeof body.error === 'string') {
        return body.error;
    }
    if (typeof body.message === 'string') {
        return body.message;
    }
    return '';
}

/** HTTP ขาออกทั้งหมดผ่านตัวนี้ — timeout ด้วย AbortController, network fail-closed */
async function idpFetch(url, options) {
    const { timeoutMs } = config();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(url, { ...options, signal: controller.signal });
    } catch (cause) {
        throw Object.assign(
            new Error('ThaID IdP unreachable (network error or timeout)'),
            { code: 'AUTH_IDP_UNAVAILABLE', cause },
        );
    } finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = undefined;
    }
    return { res, body };
}

/** §7: error catalog ของ BORA — map เป็น AUTH_* code ภายใน */
function throwTokenError(status, body) {
    const message = messageOf(body);
    const error = (body && typeof body.error === 'string') ? body.error : '';
    if (status === 401 && /invalid_client|unauthorized_client/i.test(error)) {
        // §7: client ไม่ได้รับอนุญาต / client id ไม่พบ — ฝั่งเรา config ผิด
        throw Object.assign(
            new Error(`ThaID token endpoint rejected client credentials: ${message}`),
            { code: 'AUTH_IDP_CLIENT_AUTH_FAILED' },
        );
    }
    if (status === 401 && /user_denied|access_denied/i.test(error)) {
        // §7: ผู้ใช้กดปฏิเสธ / ไม่ได้รับอนุญาต
        throw Object.assign(
            new Error(`user denied the ThaID authorization: ${message}`),
            { code: 'AUTH_IDP_ACCESS_DENIED' },
        );
    }
    if (status === 400 && /invalid.?scope/i.test(error)) {
        throw Object.assign(
            new Error(`ThaID rejected the requested scope: ${message}`),
            { code: 'AUTH_IDP_EXCHANGE_FAILED' },
        );
    }
    if (status === 400) {
        // §7: invalid_request (code/redirect ผิด), unsupported_grant_type, ฯลฯ
        throw Object.assign(
            new Error(`ThaID authorization code rejected: ${message}`),
            { code: 'AUTH_IDP_CODE_INVALID' },
        );
    }
    if (status >= 500) {
        throw Object.assign(
            new Error(`ThaID token endpoint server error (${status})`),
            { code: 'AUTH_IDP_UNAVAILABLE' },
        );
    }
    throw Object.assign(
        new Error(`ThaID token endpoint unexpected response (${status}): ${message}`),
        { code: 'AUTH_IDP_EXCHANGE_FAILED' },
    );
}

/**
 * §6.1.1: GET {AUTHORIZE_URL}?response_type=code&client_id&redirect_uri&scope&state
 * — state บังคับส่งเสมอฝั่งเรา (mandate §D3; anti-CSRF). scope มาจาก config
 * (ห้าม hardcode ฟิลด์ธุรกิจ — Law 3.5).
 */
function getAuthorizeUrl({ state } = {}) {
    if (!state) {
        throw Object.assign(
            new Error('state is required on every authorize URL (mandate §D3)'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    const cfg = config();
    if (!cfg.scope) {
        throw Object.assign(
            new Error('ThaID scope is not configured (AUTH_THAID_SCOPE)'),
            { code: 'AUTH_PROVIDER_NOT_CONFIGURED' },
        );
    }
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        scope: cfg.scope,
        state,
    });
    return `${cfg.authorizeUrl}?${params.toString()}`;
}

/**
 * §6.2.1: POST {TOKEN_URL} · Header Authorization: Basic Base64(client_id:client_secret),
 * Content-Type: application/x-www-form-urlencoded · Body grant_type/code/redirect_uri.
 * คืน raw token response (§6.2.2) — มี access_token + ฟิลด์ตาม scope (pid/name)
 * หรือ id_token (ถ้า scope=openid). ไม่ decode/parse PII ในชั้นนี้.
 */
async function exchangeCode({ code } = {}) {
    if (!code) {
        throw Object.assign(
            new Error('authorization code is required'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    const cfg = config();
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const form = new URLSearchParams({
        grant_type: GRANT_TYPE,
        code,
        redirect_uri: cfg.redirectUri,
    });
    const { res, body } = await idpFetch(cfg.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
        },
        body: form.toString(),
    });
    if (!res.ok) {
        throwTokenError(res.status, body);
    }
    if (!body || !body.access_token) {
        throw Object.assign(
            new Error('ThaID token response missing access_token'),
            { code: 'AUTH_IDP_EXCHANGE_FAILED' },
        );
    }
    // §6.2.2: access_token / token_type "Bearer" / expire_in (unix) / scope
    //         + (ตาม scope) id_token หรือ ฟิลด์ pid/name/... — ส่งต่อทั้ง raw
    return {
        accessToken: body.access_token,
        tokenType: body.token_type,
        expiresIn: body.expire_in,
        // ThaID ไม่มี account_id; subject ที่เป็น opaque อยู่ใน id_token.sub
        // (§6.2.3) — consumer เป็นผู้ decode + ผูก identity_links.subject
        accountId: null,
        raw: body,
    };
}

/**
 * ThaID ไม่มี profile endpoint แยก — ใช้ Token Introspect (§6.3) เพื่อยืนยันว่า
 * token ยัง active และคืน { active, sub, scope }. ตัวข้อมูล pid/name ที่ใช้
 * สร้าง/ผูก user อยู่ใน exchangeCode().raw (consumer อ่านต่อ). introspectUrl
 * มาจาก config (ห้าม hardcode).
 */
async function getProfile({ accessToken } = {}) {
    if (!accessToken) {
        throw Object.assign(
            new Error('accessToken is required'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    const cfg = config();
    if (!cfg.introspectUrl) {
        throw Object.assign(
            new Error('ThaID introspect URL is not configured (AUTH_THAID_INTROSPECT_URL)'),
            { code: 'AUTH_PROVIDER_NOT_CONFIGURED' },
        );
    }
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const form = new URLSearchParams({ token: accessToken });
    const { res, body } = await idpFetch(cfg.introspectUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
        },
        body: form.toString(),
    });
    if (!res.ok) {
        // §6.3.3: 400 invalid_request — token ผิดรูป/หมดอายุ
        throw Object.assign(
            new Error(`ThaID token introspect rejected (${res.status}): ${messageOf(body)}`),
            { code: 'AUTH_IDP_TOKEN_INVALID' },
        );
    }
    if (!body || body.active !== true) {
        // §6.3.2: active=false → token ใช้ไม่ได้
        throw Object.assign(
            new Error('ThaID token is not active'),
            { code: 'AUTH_IDP_TOKEN_INVALID' },
        );
    }
    return body;
}

module.exports = {
    name,
    getAuthorizeUrl,
    exchangeCode,
    getProfile,
};
