'use strict';

/**
 * OAuth IdP Routes — AUTH-01 P2 (evidence/AUTH-01/mandate.md §D3-§D5;
 * evidence/AUTH-01/plan.md P2)
 *
 *   POST /api/auth/idp/:provider/authorize-url
 *   POST /api/auth/idp/:provider/callback
 *
 * Flow ตาม [P-OAUTH] หน้า 2 ขั้น 4-5 (evidence/AUTH-01/manual-citations.md):
 * frontend อ่าน `code` จาก redirect แล้ว POST มาที่ callback — backend เป็น
 * ผู้แลก token + ดึง profile ทุกขาผ่าน adapter seam (confidential client:
 * client_secret ไม่ออกนอก backend — mandate §D3)
 *
 * identity provider ที่เชื่อมผ่าน registry นี้มีเฉพาะระบบ
 * ยืนยันตัวตนของหน่วยงานรัฐไทย (Health ID / Provider ID ของ สธ., ThaID ของ
 * กรมการปกครอง) — ห้ามนำ foreign IdP มา mount เพิ่ม
 * แนวเดียวกับที่ auth-health.js:61-65 ถอด foreign identity exchange ออก
 *
 * State anti-CSRF (mandate §D3):
 *   - สุ่ม 256 bit (≥128 bit ตาม spec) ต่อครั้ง ผูก browser ด้วย httpOnly
 *     cookie ที่ลงลายเซ็น HMAC-SHA256 ด้วย SESSION_SECRET (config/secrets.js:127
 *     — "Session signing secret (cookies, OAuth state)")
 *   - อายุ ≤10 นาที; ใช้ครั้งเดียว — callback เคลียร์ cookie ทันทีที่อ่าน
 *     ไม่ว่าผลตรวจเป็นอย่างไร
 *   - ทุกกรณีที่ตรวจไม่ผ่าน (ไม่มี/ไม่ตรง/หมดอายุ/ถูกดัดแปลง/ใช้ซ้ำ) ตอบ
 *     AUTH_STATE_INVALID ก้อนเดียว — ไม่ใบ้ว่าตกชั้นไหน
 *
 * ปลายทางต่อ provider:
 *   - thaid: เดินครบถึง session ผ่าน issueTokensForAuthenticatedUser
 *     (prisma-auth-service.js:475-522) + ตั้ง cookie ตาม "ช่อง" ที่ตรงกับ role
 *     ผู้ใช้จริง (Item 1, final-fix round) — HEALTH → auth_token, provider-
 *     canonical role → provider_token — สูตรเดียวกับที่
 *     routes/api/identity/mfa.js `/verify` ใช้เป๊ะ ๆ (ดู
 *     mfa.js:548-550: `isProviderRole(normalizeRole(user.role))`); นโยบาย
 *     linking อยู่ใน thaid-identity-service — ห้าม auto-provision (mandate §D4)
 *     — R-A Task 2: ถ้า user.twoFactorEnabled=true, issueTokensForAuthenticatedUser
 *     ไม่ mint token แต่คืน mfaRequired แทน (ตรวจ ณ mint boundary เดียวกับที่
 *     login() รหัสผ่านตรวจ) — เส้นนี้ mint mfa_session challenge ตาม contract
 *     เดียวกับ password path แล้วตอบ {mfa_required, mfa_session} แทน cookie —
 *     Item 2 (final-fix round): identity_links ไม่ถูกเขียนจนกว่าจะผ่านการ์ด
 *     MFA นี้แล้ว (ดู resolveThaidSession/persistThaidLink) — ฝั่ง challenge
 *     ไม่แตะ identity_links เลย
 *   - provider จริง (providerid): จบที่ดึง profile สำเร็จ → 409
 *     AUTH_LINKING_PENDING — ห้ามสร้าง/แก้/ค้นเพื่อผูก user ใด ๆ
 *     (ธง D-MANUAL-HASHCID; test pin ใน auth-idp-routes.test.js)
 *
 * Audit: ทุกผลของ callback ลง auditLogger.logAuth พร้อม metadata
 * { provider, subjectHash } — ห้าม PII/CID/ค่าดิบลง log (mandate §D4; Law 3.3)
 * providerid: subjectHash = sha256 ของ account_id จาก IdP (ไม่แตะโดย R-D)
 * thaid: subjectHash = thaidSubjectKey(sub) จาก thaid-identity-service —
 * keyed HMAC เดียวกับที่ผูก identity_links.subject (R-D, Task 3) — ไม่ใช่
 * sha256 ธรรมดา เพราะ ThaID `sub` คือเลขบัตรประชาชนดิบ (ดู thaid-identity-
 * service.js หัวไฟล์ + thaidSubjectKey doc comment)
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { getAuthProviders, isProviderEnabled } = require('../../../config/auth-providers');
const { tryGetSecret } = require('../../../config/secrets');
const { getIdpAdapter } = require('../../../services/auth/idp/idp-adapter');
const { sendErrorResponse, sendSuccessResponse } = require('../../../shared/api-response');
const { lookup } = require('../../../shared/error-codes');
const { auditLogger } = require('../../../middleware/audit-logger');
const { getRequestIp } = require('../../../utils/client-ip');
const { isSecureCookie } = require('../../../utils/cookie-security');
const { normalizeRole, isProviderRole } = require('../../../shared/canonical-rbac');
const { canAccountHoldSession } = require('../../../shared/account-status');
const logger = require('../../../shared/logger');

// ── State cookie (mandate §D3) ──────────────────────────────────────────────
const STATE_COOKIE = 'idp_state';
/** 32 bytes = 256 bit — เกินเกณฑ์ ≥128 bit ของ mandate §D3 */
const STATE_BYTES = 32;
/** อายุ state ≤10 นาที ตาม spec P2 (security parameter ไม่ใช่ค่าธุรกิจ) */
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_VERSION = 'v1';
/** provider_token idiom เดิม (auth-provider.js:250) — 8 ชั่วโมง */
const PROVIDER_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function stateSecret() {
    // SESSION_SECRET ผ่าน config/secrets เท่านั้น (ratchet: ห้ามอ่าน env ตรง
    // นอก config/) — ไม่มีค่า = fail-closed ทั้งสอง endpoint
    return tryGetSecret('SESSION_SECRET');
}

function signState(provider, state, expiresAt, secret) {
    return crypto
        .createHmac('sha256', secret)
        .update(`${STATE_VERSION}.${provider}.${state}.${expiresAt}`)
        .digest('hex');
}

/** ค่า cookie: v1.<provider>.<state>.<expiresAtMs>.<hmac> — ทุกส่วนไม่มีจุดปน */
function mintStateCookieValue(provider, state, secret, now = Date.now()) {
    const expiresAt = now + STATE_TTL_MS;
    return `${STATE_VERSION}.${provider}.${state}.${expiresAt}.${signState(provider, state, expiresAt, secret)}`;
}

function timingSafeEq(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) { return false; }
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * ตรวจ state ครบทุกชั้น: โครง cookie / provider ตรง / ยังไม่หมดอายุ /
 * ลายเซ็นแท้ / ค่า state ตรงกับที่ browser ส่งกลับ — คืน boolean เดียว
 * (ผู้เรียกตอบ AUTH_STATE_INVALID ก้อนเดียว ไม่แยกสาเหตุ)
 */
function isStateValid(provider, cookieValue, submittedState, secret, now = Date.now()) {
    if (!cookieValue || typeof submittedState !== 'string' || submittedState.length === 0) {
        return false;
    }
    const parts = String(cookieValue).split('.');
    if (parts.length !== 5 || parts[0] !== STATE_VERSION) { return false; }
    const [, cookieProvider, cookieState, expiresRaw, signature] = parts;
    const expiresAt = Number(expiresRaw);
    if (!Number.isFinite(expiresAt) || now > expiresAt) { return false; }
    if (cookieProvider !== provider) { return false; }
    if (!timingSafeEq(signState(cookieProvider, cookieState, expiresAt, secret), signature)) {
        return false;
    }
    return timingSafeEq(cookieState, submittedState);
}

function stateCookieOptions() {
    return {
        httpOnly: true,
        secure: isSecureCookie(),
        sameSite: 'lax',
        path: '/',
    };
}

function clearStateCookie(res) {
    res.clearCookie(STATE_COOKIE, stateCookieOptions());
}

// ── Response / audit helpers ────────────────────────────────────────────────

/** ตอบตาม catalog row เดียว (shared/error-codes.js — SSOT ของ status+ข้อความ) */
function sendCatalogError(res, req, code) {
    const row = lookup(code) || lookup('INTERNAL_SERVER_ERROR');
    return sendErrorResponse(res, req, {
        status: row.httpStatus,
        code: row.code,
        message: row.messageEn,
        messageTh: row.messageTh,
    });
}

/** map error จาก adapter → catalog row; นอก catalog = 500 กลาง */
function respondIdpError(res, req, error) {
    const row = error && error.code ? lookup(error.code) : null;
    if (row) {
        return sendErrorResponse(res, req, {
            status: row.httpStatus,
            code: row.code,
            message: row.messageEn,
            messageTh: row.messageTh,
        });
    }
    logger.error('[Auth IdP] unexpected error:', error && error.message);
    return sendCatalogError(res, req, 'INTERNAL_SERVER_ERROR');
}

// providerid path ONLY (real-provider `account_id`, not a ThaID sub — see
// resolveThaidSession, which uses thaidSubjectKey instead; R-D, Task 3 scoped
// this domain-separation change to ThaID and deliberately left this bare
// hash alone — account_id here isn't a national ID, so unsalted sha256 has
// no cross-column-joinability exposure the way an unlabelled CID hash would).
function subjectHashOf(accountId) {
    return crypto.createHash('sha256').update(String(accountId)).digest('hex');
}

/**
 * Audit ทุกผล — metadata มีเฉพาะ provider + subjectHash (+reason) เท่านั้น
 * ห้าม PII/CID/account_id ดิบ (mandate §D4; Law 3.3). ล้มเหลว = ไม่ block
 * response (idiom health-auth-profile-handlers.js:264-276)
 */
async function auditIdpOutcome(req, { outcome, actorId, actorRole, provider, subjectHash, reason }) {
    try {
        // R-A Task 2: a third outcome — the 2FA gate at the mint boundary
        // fired (no session minted yet, challenge pending) — mirrors the
        // password path's own MFA_CHALLENGE_ISSUED/PENDING audit row
        // (health-auth-profile-handlers.js:189-197).
        const action = outcome === 'SUCCESS' ? 'IDP_LOGIN_SUCCESS'
            : outcome === 'MFA_CHALLENGE' ? 'MFA_CHALLENGE_ISSUED'
                : 'IDP_LOGIN_FAILURE';
        const dbOutcome = outcome === 'MFA_CHALLENGE' ? 'PENDING' : outcome;
        await auditLogger.logAuth(
            action,
            actorId || 'ANONYMOUS',
            actorRole || 'PUBLIC',
            dbOutcome,
            getRequestIp(req),
            req.headers['user-agent'],
            {
                provider,
                ...(subjectHash ? { subjectHash } : {}),
                ...(reason ? { reason } : {}),
            },
        );
    } catch (auditErr) {
        logger.error('[Auth IdP] audit log failed (non-fatal):', auditErr.message);
    }
}

// ── ThaID (DOPA/BORA) session resolver ──────────────────────────────────────

/**
 * ปลายทาง thaid: แลก code → token (adapter) แล้วอ่าน identity จาก raw token
 * response — subject = opaque `sub` ใน id_token (§6.2.3) ห้ามใช้ pid เป็น
 * subject; pid ใช้เพียง match ทะเบียนเดิม. นโยบาย linking/auto-provision
 * (citizen-only + fail-closed บน production) อยู่ใน thaid-identity-service
 * (lazy require — เส้น provider อื่นไม่แตะ module ฝั่ง user).
 *
 * Session mint: issueTokensForAuthenticatedUser → cookie ใน "ช่อง" ที่ตรงกับ
 * role (Item 1 — auth_token สำหรับ HEALTH, provider_token สำหรับ role
 * provider-canonical; สูตรเดียวกับ mfa.js `/verify`) → audit SUCCESS →
 * sendSuccessResponse ไม่มี token ใน body.
 *
 * identity_links write (Item 2): resolveThaidLogin คืนแค่ {user, subjectKey}
 * ไม่เขียนอะไรเลย — persistThaidLink ถูกเรียกที่นี่ ณ actual-mint branch
 * เท่านั้น (หลังการ์ด MFA ด้านล่างตัดสินแล้วว่าไม่ต้อง challenge) ฝั่ง
 * challenge (mfaRequired=true) จึงไม่แตะ identity_links เลย
 *
 * Status gate: mint session ได้เฉพาะบัญชี ACTIVE หรือ PENDING_VERIFICATION
 * (พลเมืองที่เพิ่ง provision) — SUSPENDED/DISABLED/ฯลฯ ถูกปฏิเสธด้วย
 * ACCOUNT_INACTIVE ก่อนออก cookie ใด ๆ.
 */
async function resolveThaidSession(req, res, adapter, code) {
    const provider = 'thaid';
    const { resolveThaidLogin, persistThaidLink, decodeIdTokenSubject, decodeIdTokenClaims, thaidSubjectKey } =
        require('../../../services/auth/thaid-identity-service');

    let exchanged;
    try {
        exchanged = await adapter.exchangeCode({ code });
    } catch (idpError) {
        await auditIdpOutcome(req, {
            outcome: 'FAILURE', provider,
            reason: (idpError && idpError.code) || 'IDP_ERROR',
        });
        return respondIdpError(res, req, idpError);
    }

    const raw = exchanged.raw || {};
    const subject = decodeIdTokenSubject(raw.id_token);
    // Task 4 (audit-verified two-shape gap): §6.2.2's "**" note
    // (evidence/AUTH-01/manual-citations.md:134-135) — WITHOUT `openid` scope
    // pid/name arrive top-level on the token response; WITH `openid` they
    // move INSIDE the id_token instead. Whether BORA's sandbox echoes both is
    // unknowable statically (no prior sandbox call exists), so both read
    // paths are tolerated: id_token claims win when present, the top-level
    // field is the fallback. Subject itself is unaffected — it only ever
    // comes from the id_token (decodeIdTokenSubject above).
    const idTokenClaims = decodeIdTokenClaims(raw.id_token) || {};
    const nationalId = idTokenClaims.pid || raw.pid;
    const firstNameTh = idTokenClaims.given_name || raw.given_name
        || (raw.name ? String(raw.name).split(' ')[0] : undefined);
    const lastNameTh = idTokenClaims.family_name || raw.family_name;

    if (!subject) {
        await auditIdpOutcome(req, { outcome: 'FAILURE', provider, reason: 'PROFILE_INCOMPLETE' });
        return sendCatalogError(res, req, 'AUTH_IDP_PROFILE_INCOMPLETE');
    }
    // R-D Task 3: NOT subjectHashOf (bare sha256) — ThaID's `sub` is
    // documented as the raw 13-digit CID, so the audit hash must go through
    // the SAME domain-separated, keyed derivation identity_links.subject
    // uses (thaid-identity-service.js's thaidSubjectKey), never an unsalted
    // hash of the raw CID.
    const subjectHash = thaidSubjectKey(subject);

    let user;
    let subjectKeyForLink;
    try {
        ({ user, subjectKey: subjectKeyForLink } = await resolveThaidLogin({ subject, nationalId, firstNameTh, lastNameTh }));
    } catch (err) {
        await auditIdpOutcome(req, {
            outcome: 'FAILURE', provider, subjectHash,
            reason: (err && err.code) || 'THAID_LOGIN_FAILED',
        });
        return respondIdpError(res, req, err);
    }

    // Status gate ก่อน mint: อนุญาตเฉพาะ ACTIVE / PENDING_VERIFICATION —
    // SUSPENDED/DISABLED/DELETED/ฯลฯ
    // ห้ามได้ session cookie ใด ๆ ผ่าน ThaID. Audit FAILURE แบบเดียวกับเส้นปฏิเสธอื่น
    // SECU-03: กฎนี้ย้ายไป shared/account-status.js ให้ทุกประตูใช้ร่วมกัน และนับ isDeleted ด้วย
    // (DELETE /me ไม่แตะ status — identity link เดิมยัง resolve ไปหาแถวที่ถูกลบได้)
    if (!canAccountHoldSession(user)) {
        await auditIdpOutcome(req, {
            outcome: 'FAILURE', actorId: user.id, actorRole: user.role,
            provider, subjectHash, reason: 'ACCOUNT_INACTIVE',
        });
        return sendCatalogError(res, req, 'ACCOUNT_INACTIVE');
    }

    // Session mint: cookie เท่านั้น (ไม่มี refresh cookie ฝั่งนี้), token ไม่ออก
    // body — ซึ่ง "cookie" ตัวไหนตัดสินด้านล่าง (Item 1: ตาม role)
    const AuthService = require('../../../services/prisma-auth-service');
    const result = await AuthService.issueTokensForAuthenticatedUser(user, {
        ipAddress: getRequestIp(req),
        userAgent: req.headers['user-agent'],
    });

    // R-A (Task 2): issueTokensForAuthenticatedUser itself now applies the
    // SAME twoFactorEnabled gate the password path checks at login() (:412)
    // — see prisma-auth-service.js:481-490. A 2FA-enrolled citizen therefore
    // gets the SAME mfa_session challenge instead of a minted provider_token,
    // closing the ThaID 2FA-bypass. Contract fields are exactly what
    // health-auth-profile-handlers.js:198-204 emits (mfa_required/mfa_session)
    // and what the FE callback page reads (client-view.tsx:205-207) — one
    // wire shape for every login surface, so /api/mfa/verify completes it
    // unchanged regardless of which surface minted it.
    if (result.mfaRequired) {
        const { mintMfaChallengeToken } = require('../../../shared/mfa-challenge-binding');
        // The service only ever reports TOTP since 2026-09-15 (no email second
        // factor); the mint helper throws MFA_METHOD_RETIRED for anything else, so a
        // stale caller fails closed here instead of issuing an unanswerable challenge.
        const mfaSessionToken = mintMfaChallengeToken({
            userId: user.id,
            method: result.twoFactorMethod,
            ip: getRequestIp(req),
            userAgent: req.headers['user-agent'],
            // ThaID only ever resolves a citizen (HEALTH) account here — the
            // existing-link/national-ID/auto-provision branches in
            // thaid-identity-service.js all enforce assertAutoProvisionableRole
            // — so the public/health signing key is always correct, matching
            // health-auth-profile-handlers.js:175.
            tokenType: 'public',
        });
        await auditIdpOutcome(req, {
            outcome: 'MFA_CHALLENGE', actorId: user.id, actorRole: user.role, provider, subjectHash,
        });
        return sendSuccessResponse(res, req, {
            message: 'กรุณายืนยัน MFA เพื่อเข้าสู่ระบบ',
            data: {
                mfa_required: true,
                mfa_session: mfaSessionToken,
            },
        });
    }

    // Item 2 (council final-fix round): identity_links is written HERE —
    // the actual-mint branch, after the 2FA gate above has already decided
    // no challenge is needed — never during resolution. A failed/pending-MFA
    // attempt (the `if (result.mfaRequired)` branch above, which already
    // returned) therefore writes nothing to identity_links.
    try {
        await persistThaidLink(subjectKeyForLink, user.id);
    } catch (linkErr) {
        await auditIdpOutcome(req, {
            outcome: 'FAILURE', actorId: user.id, actorRole: user.role, provider, subjectHash,
            reason: 'LINK_PERSIST_FAILED',
        });
        return respondIdpError(res, req, linkErr);
    }

    // Item 1 (council final-fix round): cookie SLOT by role — mirrors
    // routes/api/identity/mfa.js:548-550 (`/verify`'s own login-completion
    // step) EXACTLY, not a bespoke ThaID rule. Before this fix every ThaID
    // mint set `provider_token` unconditionally, but the Next middleware
    // (apps/web-app/src/middleware.ts:172-179) gates `/health/*` on the
    // `auth_token` cookie ONLY — and ThaID's non-provider branches
    // (existing-link/national-ID/auto-provision) all enforce
    // assertAutoProvisionableRole, so every resolvable ThaID user here is a
    // HEALTH account. Every non-MFA citizen therefore minted a cookie the
    // health middleware could never see and bounced straight back to login.
    // A privileged/staff account can still resolve via the existing-link
    // branch (assertAutoProvisionableRole is enforced there too, but only
    // rejects NON-citizen roles at that gate — a role that happens to still
    // read as provider-canonical after that guard, if one ever exists, must
    // still land in the correct cookie slot), so this stays role-driven
    // rather than hardcoded to `auth_token`.
    const canonicalRole = normalizeRole(user.role);
    const isProvider = isProviderRole(canonicalRole);
    const cookieName = isProvider ? 'provider_token' : 'auth_token';

    const { token } = result;
    res.cookie(cookieName, token, {
        httpOnly: true,
        secure: isSecureCookie(),
        sameSite: 'lax',
        maxAge: PROVIDER_TOKEN_MAX_AGE_MS,
        path: '/',
    });

    await auditIdpOutcome(req, {
        outcome: 'SUCCESS', actorId: user.id, actorRole: user.role, provider, subjectHash,
    });

    // Session = httpOnly cookie เท่านั้น (E-4) — ห้ามมี token ใน body
    return sendSuccessResponse(res, req, {
        message: 'เข้าสู่ระบบสำเร็จ',
        data: {
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
        },
    });
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/auth/idp/providers
 * States-only feed for the login chooser (mandate P2 endpoint / P4 FE —
 * config/auth-providers.js:145-149 documented this consumer the day
 * getAuthProviders() was written). No auth: the login page has no session yet.
 * No cache: the whole point is that setting AUTH_*_STATE or completing a
 * provider's env flips the page without a deploy.
 *
 * Declared BEFORE the '/:provider/...' routes so the literal path can never be
 * captured as a provider param. Each entry is {key, state, enabled} and nothing
 * else — getProviderConfig() (which carries client secrets) must never reach
 * this handler (test pin: auth-idp-providers-endpoint.test.js).
 *
 * `enabled` is the RESOLVED verdict from isProviderEnabled(), added at
 * integration on an audit finding: `staging_only` is a state the frontend
 * cannot interpret — whether it resolves usable depends on isProduction() and
 * the staging slot, which only the backend knows. The first chooser build
 * guessed (`state === 'staging_only' → usable`), which on a real production
 * box would render a pressable button for a provider the backend refuses.
 * The backend resolves; the frontend renders. No guessing on either side.
 */
router.get('/providers', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const providers = getAuthProviders().map((p) => ({
        ...p,
        enabled: isProviderEnabled(p.key),
    }));
    return sendSuccessResponse(res, req, { data: { providers } });
});

/**
 * POST /api/auth/idp/:provider/authorize-url
 * ออก authorize URL ของ IdP + ผูก state เข้ากับ browser ผ่าน signed cookie
 * provider ไม่ enabled → 503 fail-closed (แบบ payments.js:409-417)
 */
router.post('/:provider/authorize-url', async (req, res) => {
    const provider = req.params.provider;
    try {
        if (!isProviderEnabled(provider)) {
            return sendCatalogError(res, req, 'AUTH_PROVIDER_DISABLED');
        }
        const secret = stateSecret();
        if (!secret) {
            return sendCatalogError(res, req, 'AUTH_STATE_SECRET_MISSING');
        }
        const adapter = getIdpAdapter(provider);
        const state = crypto.randomBytes(STATE_BYTES).toString('hex');
        const authorizeUrl = adapter.getAuthorizeUrl({ state });
        res.cookie(STATE_COOKIE, mintStateCookieValue(provider, state, secret), {
            ...stateCookieOptions(),
            maxAge: STATE_TTL_MS,
        });
        return sendSuccessResponse(res, req, { data: { authorizeUrl } });
    } catch (error) {
        return respondIdpError(res, req, error);
    }
});

/**
 * POST /api/auth/idp/:provider/callback  body: { code, state }
 * backend แลก code → token → profile ([P-OAUTH] หน้า 2 ขั้น 4-5) แล้วแยก
 * ปลายทางตาม provider (thaid = session, providerid = AUTH_LINKING_PENDING)
 */
router.post('/:provider/callback', async (req, res) => {
    const provider = req.params.provider;
    try {
        if (!isProviderEnabled(provider)) {
            return sendCatalogError(res, req, 'AUTH_PROVIDER_DISABLED');
        }
        const secret = stateSecret();
        if (!secret) {
            return sendCatalogError(res, req, 'AUTH_STATE_SECRET_MISSING');
        }

        // single-use: เคลียร์ cookie ทันทีที่อ่าน ไม่ว่าผลตรวจเป็นอย่างไร (§D3)
        const stateCookie = req.cookies ? req.cookies[STATE_COOKIE] : undefined;
        clearStateCookie(res);

        const { code, state } = req.body || {};
        if (!isStateValid(provider, stateCookie, state, secret)) {
            await auditIdpOutcome(req, { outcome: 'FAILURE', provider, reason: 'STATE_INVALID' });
            return sendCatalogError(res, req, 'AUTH_STATE_INVALID');
        }
        if (!code || typeof code !== 'string') {
            await auditIdpOutcome(req, { outcome: 'FAILURE', provider, reason: 'CODE_MISSING' });
            return sendErrorResponse(res, req, {
                status: 400,
                code: 'VALIDATION_ERROR',
                message: 'code is required',
                messageTh: 'ข้อมูลไม่ถูกต้อง: ไม่พบรหัสยืนยันจากระบบยืนยันตัวตน',
            });
        }

        const adapter = getIdpAdapter(provider);

        // ThaID: identity มากับ token response (id_token.sub + pid/name ตาม scope) —
        // ไม่มี account_id/hash_cid แยก จึงมีเส้น resolve ของตัวเอง (subject = sub)
        if (provider === 'thaid') {
            return await resolveThaidSession(req, res, adapter, code);
        }

        let profile;
        try {
            const exchanged = await adapter.exchangeCode({ code });
            profile = await adapter.getProfile({ accessToken: exchanged.accessToken });
        } catch (idpError) {
            await auditIdpOutcome(req, {
                outcome: 'FAILURE', provider,
                reason: (idpError && idpError.code) || 'IDP_ERROR',
            });
            return respondIdpError(res, req, idpError);
        }

        // profile ต้องมี identity fields ที่ [P-OAUTH] หน้า 10-12 ระบุ:
        // account_id (external subject) + hash_cid (ตัวเชื่อมทะเบียน)
        if (!profile || !profile.account_id || !profile.hash_cid) {
            await auditIdpOutcome(req, { outcome: 'FAILURE', provider, reason: 'PROFILE_INCOMPLETE' });
            return sendCatalogError(res, req, 'AUTH_IDP_PROFILE_INCOMPLETE');
        }
        const subjectHash = subjectHashOf(profile.account_id);

        // provider จริง: ธง D-MANUAL-HASHCID — algorithm ของ hash_cid ยังไม่
        // ยืนยันกับ สธ. จึงห้ามสร้าง/แก้/ค้นเพื่อผูก user ใด ๆ ในเส้นนี้
        // (test pin: prisma.user ต้องไม่ถูกเรียก) — จบที่ 409 เสมอ
        await auditIdpOutcome(req, {
            outcome: 'FAILURE', provider, subjectHash, reason: 'LINKING_PENDING',
        });
        return sendCatalogError(res, req, 'AUTH_LINKING_PENDING');
    } catch (error) {
        logger.error('[Auth IdP] callback error:', error && error.message);
        return respondIdpError(res, req, error);
    }
});

module.exports = router;
