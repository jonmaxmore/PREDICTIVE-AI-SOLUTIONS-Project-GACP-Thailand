'use strict';

/**
 * ProviderIdAdapter — Provider ID ผ่าน OAuth ของ Health ID ตาม "คู่มือการ
 * เชื่อมต่อระบบ Provider ID ด้วย OAuth ของ Health ID" (สำนักสุขภาพดิจิทัล สธ.
 * 1 ก.ค. 2567) [P-OAUTH] — citations ทุก endpoint/parameter พร้อมเลขหน้าอยู่ใน
 * evidence/AUTH-01/manual-citations.md; ค่าที่เอกสารไม่ระบุ = ไม่ implement
 * (mandate §B2 — จึงไม่มี PKCE / refresh token / revoke ในไฟล์นี้)
 *
 * Flow ([P-OAUTH] หน้า 2 + หน้า 6):
 *   1) getAuthorizeUrl — redirect ผู้ใช้ไป Health ID (หน้า 3)
 *   2) exchangeCode ขา 1: code → Health ID access_token (หน้า 4-5)
 *      ขา 2: Health ID token → Provider ID token (หน้า 7-8) — ผู้ใช้ที่ไม่มี
 *      Provider ID ถูก IdP ปฏิเสธเอง (400) = สอดคล้อง "ห้าม auto-provision"
 *   3) getProfile — Provider ID token → RAW profile (หน้า 9-12)
 *
 * ไฟล์นี้ห้ามมี logic linking/user lookup ใด ๆ (ธง D-MANUAL-HASHCID) —
 * คืน raw profile เท่านั้น; endpoint URL/credential ทุกตัวมาจาก
 * config/auth-providers.js (Law 3.5 — ห้าม hardcode URL ในโค้ด)
 */

const { getProviderConfig } = require('../../../config/auth-providers');

const name = 'providerid';

/** [P-OAUTH] หน้า 7: token_by ต้องเป็นค่านี้ตามเอกสาร (protocol literal) */
const TOKEN_BY_HEALTH_ID = 'Health ID';

function config() {
    return getProviderConfig('providerid');
}

/** ดึง message จาก error body — envelope {status, data, message} ([P-OAUTH] หน้า 5) */
function messageOf(body) {
    if (!body) {
        return '';
    }
    if (typeof body.message === 'string') {
        return body.message;
    }
    if (body.data && typeof body.data.message === 'string') {
        return body.data.message;
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
            new Error('Provider ID IdP unreachable (network error or timeout)'),
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

/** Error mapping ขา 1 — Health ID token endpoint ([P-OAUTH] หน้า 5) */
function throwHealthIdTokenError(status, message) {
    if (status === 401) {
        // หน้า 5: 401 "Credential is required" — ฝั่งเรา config ผิด
        throw Object.assign(
            new Error(`Health ID token endpoint rejected client credentials: ${message}`),
            { code: 'AUTH_IDP_CLIENT_AUTH_FAILED' },
        );
    }
    if (status === 422 && /denied/i.test(message)) {
        // หน้า 5: 422 "Access grant has denied" — ผู้ใช้กดปฏิเสธ
        throw Object.assign(
            new Error(`user denied the Health ID authorization: ${message}`),
            { code: 'AUTH_IDP_ACCESS_DENIED' },
        );
    }
    if (status === 422 && /expired/i.test(message)) {
        // หน้า 5: 422 "Code has been expired"
        throw Object.assign(
            new Error(`authorization code has expired: ${message}`),
            { code: 'AUTH_IDP_CODE_EXPIRED' },
        );
    }
    if (status === 422) {
        // หน้า 5: 422 "Code is invalid" / "Redirect uri is invalid" /
        // "Code and Client ID not match."
        throw Object.assign(
            new Error(`authorization code rejected: ${message}`),
            { code: 'AUTH_IDP_CODE_INVALID' },
        );
    }
    if (status >= 500) {
        throw Object.assign(
            new Error(`Health ID token endpoint server error (${status})`),
            { code: 'AUTH_IDP_UNAVAILABLE' },
        );
    }
    throw Object.assign(
        new Error(`Health ID token endpoint unexpected response (${status}): ${message}`),
        { code: 'AUTH_IDP_EXCHANGE_FAILED' },
    );
}

/** Error mapping ขา 2 — Provider ID token exchange ([P-OAUTH] หน้า 8) */
function throwProviderExchangeError(status, message) {
    if (status === 400 && /provider.?id/i.test(message)) {
        // หน้า 8: 400 "This user has not provider id" — แยกเป็น error ของตัวเอง
        // (P2 จะ map เป็นข้อความ "ไม่พบข้อมูลเจ้าหน้าที่..." ตาม mandate §D4)
        throw Object.assign(
            new Error(`this account has no Provider ID: ${message}`),
            { code: 'AUTH_PROVIDERID_NOT_FOUND' },
        );
    }
    if (status === 401) {
        // หน้า 8: 401 — client_id+secret_key ผิด/ขาด หรือ token_by ไม่ถูกต้อง
        throw Object.assign(
            new Error(`Provider ID token exchange rejected client credentials: ${message}`),
            { code: 'AUTH_IDP_CLIENT_AUTH_FAILED' },
        );
    }
    if (status >= 500) {
        throw Object.assign(
            new Error(`Provider ID token exchange server error (${status})`),
            { code: 'AUTH_IDP_UNAVAILABLE' },
        );
    }
    // หน้า 8: 400 "The requested parameter can not used." และเคสอื่นนอก catalog
    throw Object.assign(
        new Error(`Provider ID token exchange rejected (${status}): ${message}`),
        { code: 'AUTH_IDP_EXCHANGE_FAILED' },
    );
}

/** Error mapping ขา profile ([P-OAUTH] หน้า 12) */
function throwProfileError(status, message) {
    if (status === 401 && /access.?token/i.test(message)) {
        // หน้า 12: 401 "access_token is invalid"
        throw Object.assign(
            new Error(`Provider ID profile token rejected: ${message}`),
            { code: 'AUTH_IDP_TOKEN_INVALID' },
        );
    }
    if (status === 401) {
        // หน้า 12: 401 client ผิด
        throw Object.assign(
            new Error(`Provider ID profile rejected client credentials: ${message}`),
            { code: 'AUTH_IDP_CLIENT_AUTH_FAILED' },
        );
    }
    if (status === 404 && /provider.?id/i.test(message)) {
        // หน้า 12: 404 "This user has no provider id"
        throw Object.assign(
            new Error(`this account has no Provider ID: ${message}`),
            { code: 'AUTH_PROVIDERID_NOT_FOUND' },
        );
    }
    if (status >= 500) {
        // หน้า 12: 500 / 503
        throw Object.assign(
            new Error(`Provider ID profile endpoint server error (${status})`),
            { code: 'AUTH_IDP_UNAVAILABLE' },
        );
    }
    // หน้า 12: 400 param ขาด / 404 "The requested resource was not found"
    throw Object.assign(
        new Error(`Provider ID profile request rejected (${status}): ${message}`),
        { code: 'AUTH_IDP_EXCHANGE_FAILED' },
    );
}

/**
 * [P-OAUTH] หน้า 3: GET {AUTHORIZE_URL}?client_id&redirect_uri&response_type=code&state
 * — state เป็น optional ในเอกสารแต่ mandate §D3 บังคับส่งเสมอฝั่งเรา
 */
function getAuthorizeUrl({ state } = {}) {
    if (!state) {
        throw Object.assign(
            new Error('state is required on every authorize URL (mandate §D3)'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    const cfg = config();
    const params = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        state,
    });
    return `${cfg.authorizeUrl}?${params.toString()}`;
}

/**
 * แลก code สองขา — ผลลัพธ์คือ token ของ Provider ID (ขา 2) ซึ่งเป็นตัวที่
 * getProfile ใช้ต่อ ([P-OAUTH] หน้า 6 ขั้นตอนรวม)
 */
async function exchangeCode({ code } = {}) {
    const cfg = config();

    // ขา 1 — [P-OAUTH] หน้า 4: POST form-urlencoded 5 field
    const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
    });
    const leg1 = await idpFetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
    });
    if (!leg1.res.ok) {
        throwHealthIdTokenError(leg1.res.status, messageOf(leg1.body));
    }
    // [P-OAUTH] หน้า 5: envelope {status, data: {access_token, ...}, message}
    const healthData = (leg1.body && leg1.body.data) || {};
    if (!healthData.access_token) {
        throw Object.assign(
            new Error('Health ID token response missing data.access_token'),
            { code: 'AUTH_IDP_EXCHANGE_FAILED' },
        );
    }

    // ขา 2 — [P-OAUTH] หน้า 7: POST JSON {client_id, secret_key, token_by, token}
    // client_id ขานี้ = "ของระบบ Provider ID" (pidClientId) คนละการลงทะเบียนกับ
    // คู่ Health ID ของขา 1 (audit F1; manual-citations.md:78,95)
    const leg2 = await idpFetch(cfg.tokenExchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: cfg.pidClientId,
            secret_key: cfg.secretKey,
            token_by: TOKEN_BY_HEALTH_ID,
            token: healthData.access_token,
        }),
    });
    if (!leg2.res.ok) {
        throwProviderExchangeError(leg2.res.status, messageOf(leg2.body));
    }
    const body = leg2.body || {};
    if (!body.access_token) {
        throw Object.assign(
            new Error('Provider ID token exchange response missing access_token'),
            { code: 'AUTH_IDP_EXCHANGE_FAILED' },
        );
    }
    // [P-OAUTH] หน้า 7-8: access_token / token_type / expires_in / account_id
    return {
        accessToken: body.access_token,
        tokenType: body.token_type,
        expiresIn: body.expires_in,
        accountId: body.account_id,
        raw: body,
    };
}

/**
 * [P-OAUTH] หน้า 9: GET + headers Authorization Bearer {provider_access_token},
 * client-id, secret-key — คืน RAW profile ตามที่ IdP ตอบเท่านั้น
 * client-id/secret-key = คู่ของระบบ Provider ID (pidClientId — audit F1;
 * คนละการลงทะเบียนกับคู่ Health ID ของขา 1)
 */
async function getProfile({ accessToken } = {}) {
    const cfg = config();
    const { res, body } = await idpFetch(cfg.profileUrl, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'client-id': cfg.pidClientId,
            'secret-key': cfg.secretKey,
        },
    });
    if (!res.ok) {
        throwProfileError(res.status, messageOf(body));
    }
    return body;
}

module.exports = {
    name,
    getAuthorizeUrl,
    exchangeCode,
    getProfile,
};
