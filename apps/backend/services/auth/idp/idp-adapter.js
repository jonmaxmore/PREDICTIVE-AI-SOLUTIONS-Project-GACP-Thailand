'use strict';

/**
 * IdP adapter seam — AUTH-01 P1 (evidence/AUTH-01/mandate.md §D1; แบบเดียวกับ
 * services/payment/payment-adapter.js:52-66)
 *
 * Business logic เข้าถึง Identity Provider ผ่าน contract เดียวเท่านั้น:
 *
 *   getAuthorizeUrl({ state })   → string
 *       URL สำหรับ redirect ผู้ใช้ไป IdP — state บังคับส่งเสมอ (mandate §D3;
 *       เอกสารให้ optional แต่ไม่ห้ามส่ง — [P-OAUTH] หน้า 3)
 *   exchangeCode({ code })       → { accessToken, tokenType, expiresIn,
 *                                    accountId, raw }
 *       แลก authorization code เป็น access token ของ provider ปลายทาง
 *       (providerid = สองขา: Health ID token → Provider ID token)
 *   getProfile({ accessToken })  → object
 *       RAW profile ตามที่ provider ตอบเท่านั้น — ห้ามมี linking/user lookup
 *       ในชั้น adapter (ธง D-MANUAL-HASHCID; consumer P2 เป็นผู้ตัดสิน)
 *
 * Implementations:
 *   provider-id-adapter.js — Provider ID ผ่าน OAuth Health ID ตาม [P-OAUTH]
 *                            (evidence/AUTH-01/manual-citations.md)
 *   thaid-adapter.js       — ThaID (DOPA/BORA) ตามคู่มือ §6
 *
 * Fail-closed ทุกทาง (error codes อยู่ใน shared/error-codes.js):
 *   unknown key → AUTH_PROVIDER_UNKNOWN · ไม่ enabled → AUTH_PROVIDER_DISABLED
 *   config ไม่ครบ → AUTH_PROVIDER_NOT_CONFIGURED · ไม่มี adapter (local/
 *   healthid/thaid ใน P1) → AUTH_PROVIDER_NO_ADAPTER
 */

/** Resolve adapter ต่อ provider key — fail-closed ผ่าน assertProviderReady */
function getIdpAdapter(providerKey) {
    const { assertProviderReady } = require('../../../config/auth-providers');
    assertProviderReady(providerKey);
    if (providerKey === 'providerid') {
        return require('./provider-id-adapter');
    }
    if (providerKey === 'thaid') {
        return require('./thaid-adapter');
    }
    throw Object.assign(
        new Error(`auth provider "${providerKey}" has no IdP adapter (providerid|thaid)`),
        { code: 'AUTH_PROVIDER_NO_ADAPTER' },
    );
}

module.exports = { getIdpAdapter };
