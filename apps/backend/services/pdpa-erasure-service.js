/**
 * PDPA Right-to-Forget (Erasure) Service — Iter 27 (2026-05-16)
 *
 * ## Legal basis
 *
 *   - PDPA ม.32 / Thai PDPA Section 32 (พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล
 *     พ.ศ. 2562 มาตรา 32) — the data subject's right to request erasure or
 *     anonymisation of personal data when (1) the purpose of processing
 *     has ended, (2) consent is withdrawn and no other legal basis
 *     applies, or (3) processing is unlawful.
 *   - ม.87/3 ป.รัษฎากร / Revenue Code Section 87/3 — VAT-registered
 *     persons MUST retain ใบกำกับภาษี (tax invoices), ใบลดหนี้, ใบเพิ่มหนี้,
 *     ภ.พ.30 working papers, and supporting accounting records for ≥ 5
 *     years (de facto 7 years for general accounting per the Revenue
 *     Department guidance and TFRS for NPAEs).
 *   - PDPA ม.24(6) / Section 24(6) — Lawful basis "ปฏิบัติตามกฎหมาย"
 *     overrides erasure for records the operator is legally compelled
 *     to retain. The platform's tax/accounting books fall under this
 *     basis; the User row that issued an invoice cannot disappear, but
 *     its PII columns CAN be anonymised while preserving the FK.
 *
 * ## Erase vs. anonymise vs. preserve matrix
 *
 *   PRESERVED (legally compelled — 7 years per ม.87/3):
 *     Invoice rows (amounts, dates, numbers)
 *     CreditNote / DebitNote rows
 *     JournalEntry / JournalLine rows
 *     PaymentTransaction
 *     AuditLog (immutable hash chain per Thai e-Transactions Act §31)
 *     Certificate (regulated cert lifecycle — DTAM 5y minimum)
 *
 *   ANONYMISED in place (FK intact, PII cleared):
 *     User: thaiId/healthId, providerId, email, phoneNumber, firstName,
 *           lastName, address fields, idCard, taxId, companyName,
 *           representativeName, communityName. password set to sentinel,
 *           twoFactor cleared.
 *     Application.formData PII leaves (applicantName, applicantPhone,
 *           applicantEmail, ...): cleared to null/sentinel inside the
 *           JSON blob. The application row + applicationNumber stays so
 *           audit/invoice references resolve.
 *     Certificate.applicantName + .address: cleared to sentinel ONLY once
 *           retainUntil has passed and legalHold is false (operator ruling
 *           2026-08-27 — a live certificate keeps the holder's name; see
 *           executeErasure step 3). certificateNumber + farmId + dates
 *           preserved. A certificate still under retention at erasure
 *           time is RETAINED, and for this data subject that is permanent:
 *           step 1 closes every door back (isDeleted, password sentinel,
 *           sessions revoked, lookup hashes nulled) and no job in the tree
 *           anonymises a certificate after retainUntil passes
 *           (jobs/pdpa-retention-job.js sweeps prisma.user only). The
 *           sweep that would honour "for the life of the certificate" is
 *           a separate work item (the backlog, 2026-08-27).
 *
 *   ERASED (true delete):
 *     ApplicationDraft (working copy — no legal retention)
 *     Notification rows targeted at the user — EXCEPT official letters
 *         (Notification.kind per shared/notification-kind.js): permanent
 *         archive per operator decision D-9 2026-08-03
 *         (evidence/R2-special-reopen/decisions-final.md)
 *     Per-user session tokens / refresh tokens / consent cookies
 *
 * ## 2-step request → confirm flow
 *
 * Mirrors GDPR Article 17 + PDPA guidance: a single click should NOT
 * erase a user. Security threat model: a hijacked session or a coerced
 * user could trigger an irreversible erasure. We require:
 *
 *   1. `requestErasure({ healthId, reason, actorId })`
 *      - Records the request inside `User.privacySettings.pdpaErasure`
 *        (no separate table needed — privacySettings is already Json?).
 *      - Generates a single-use SHA-256 token (32 hex chars).
 *      - Sets `expiresAt = now + 24h`.
 *      - Sends a notification (PDPA_ERASURE_REQUESTED) to the user.
 *      - Returns `{ requestId, expiresAt }`. The token itself is NOT
 *        in the response — it travels only inside the in-app
 *        notification's confirm link (payload.actionUrl).
 *
 *   2. `confirmErasure(requestId, { token, actorId })`
 *      - Re-fetches the request envelope.
 *      - Validates: token matches (timing-safe), within window, status
 *        is REQUESTED. Then calls executeErasure inside one prisma.$transaction.
 *
 * ## Audit trail
 *
 * Both request and execution write to AuditLog via auditLogger:
 *   - PDPA_ERASURE_REQUESTED (INFO)
 *   - PDPA_ERASURE_CANCELED  (INFO)
 *   - PDPA_ERASURE_EXECUTED  (WARNING — destructive)
 * Audit rows themselves are NEVER erased — they are the legal evidence
 * that the data subject's request was honored per ม.32.
 *
 * @module services/pdpa-erasure-service
 */

const crypto = require('crypto');
const { appBaseUrl } = require('../config/public-urls');
const { prisma } = require('./prisma-database');
const { sessionEpochStamp } = require('../utils/session-epoch');
const { createLogger } = require('../shared/logger');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');
// Detokenize STAGE 0: resolve the data subject by the national-ID hash (H-4
// hash-first helper), NOT by `where:{canonicalId: nationalId}` — after the
// STAGE-A re-key, canonicalId holds the token, so a national-ID value WHERE on
// it would no longer match. The hash helper keys on healthIdHash/Hmac, which is
// stable across the re-key.
const { findUserByHealthIdSecurely } = require('./user-lookup-service');
const { NOTIFICATION_KIND } = require('../shared/notification-kind');
const { clearPrecheckText } = require('./document-precheck/clear-text');

const logger = createLogger('pdpa-erasure-service');

// 24-hour confirmation window. Long enough that a user who requests at
// 5pm can confirm in the morning; short enough that a stale token cannot
// be abused weeks later.
const CONFIRM_WINDOW_MS = 24 * 60 * 60 * 1000;

const ERASURE_STATUS = Object.freeze({
    REQUESTED: 'REQUESTED',
    CONFIRMED: 'CONFIRMED',
    EXECUTED: 'EXECUTED',
    CANCELED: 'CANCELED',
    EXPIRED: 'EXPIRED',
});

const ERASURE_SENTINEL = 'PDPA_ERASED';

// Optional dependency: notification fanout. We do not hard-require it in
// the module-load path so unit tests can mock it lazily, and so the
// erasure flow degrades gracefully if the fanout module is unavailable.
let _fanoutModule = null;
function _getFanout() {
    if (_fanoutModule === null) {
        try {
            _fanoutModule = require('./notification-fanout-service');
        } catch (_err) {
            _fanoutModule = { send: async () => ({ skipped: 'NO_FANOUT' }) };
        }
    }
    return _fanoutModule;
}

function _now() {
    return new Date();
}

function _generateToken() {
    return crypto.randomBytes(16).toString('hex'); // 32 hex chars
}

function _generateRequestId() {
    return `pdpa-er-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Constant-time string comparison to avoid timing side-channels on
 * the erasure confirmation token. crypto.timingSafeEqual requires
 * equal-length buffers — we early-out on length mismatch (the length
 * itself is public via the token format).
 */
function _safeTokenEqual(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string') {return false;}
    if (provided.length !== expected.length) {return false;}
    try {
        return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    } catch (_err) {
        return false;
    }
}

/**
 * Read the current erasure envelope from User.privacySettings.pdpaErasure.
 * Returns null when the user has no pending request.
 *
 * @param {string} userId — User.id (UUID, plaintext-safe)
 */
async function _loadEnvelope(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, privacySettings: true, isDeleted: true, legalHold: true },
    });
    if (!user) {return null;}
    const envelope = user.privacySettings && user.privacySettings.pdpaErasure
        ? user.privacySettings.pdpaErasure
        : null;
    return { user, envelope };
}

/**
 * Write the erasure envelope back into User.privacySettings, preserving
 * other privacy keys. The whole JSON column is rewritten because Prisma
 * does not support partial JSON updates portably across providers.
 */
async function _saveEnvelope(userId, envelope) {
    const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { privacySettings: true },
    });
    const settings = (existing && existing.privacySettings && typeof existing.privacySettings === 'object')
        ? { ...existing.privacySettings }
        : {};
    settings.pdpaErasure = envelope;
    return prisma.user.update({
        where: { id: userId },
        data: { privacySettings: settings },
        select: { id: true, privacySettings: true },
    });
}

/**
 * Resolve a user by their national ID — the public PDPA identifier the caller
 * supplies. Returns the User.id (UUID) + the live canonicalId (FK key) needed
 * for the FK-keyed anonymisation queries.
 *
 * Detokenize STAGE 0 (RFC breaker 3, data-state-agnostic): resolves via the
 * H-4 hash-first helper (healthIdHash/Hmac) instead of `where:{canonicalId}`.
 * The old canonicalId WHERE only worked because canonicalId == the national ID
 * TODAY; after the STAGE-A re-key the national ID no longer lives in
 * canonicalId, so a value WHERE on it finds nothing. The hash is derived from
 * the national ID and is stable across the re-key. We return `canonicalId` so
 * the caller anonymises Applications via `where:{healthId: user.canonicalId}`
 * (the live FK key) regardless of data state.
 */
async function _resolveByHealthId(nationalId) {
    if (!nationalId || typeof nationalId !== 'string') {return null;}
    return findUserByHealthIdSecurely(nationalId, {
        select: { id: true, canonicalId: true, organizationId: true, email: true, isDeleted: true, legalHold: true },
        includeDeleted: true, // the caller decides what to do with deleted/held subjects
        client: prisma,
    });
}

/**
 * Step 1 — User submits an erasure request.
 *
 * @param {object} args
 * @param {string} args.healthId — canonicalId of the data subject
 * @param {string} [args.reason] — user-supplied reason text (truncated to 500 chars)
 * @param {string} args.actorId — User.id of the principal making the call
 *                                (normally same as data subject; admins
 *                                may file on behalf during PDPA Section
 *                                30/32 helpdesk escalations).
 * @returns {Promise<{ requestId: string, expiresAt: string, token: string }>}
 *
 * The `token` is included in the return value for test fixtures only.
 * Callers MUST NOT echo the token back in a generic HTTP response — it
 * is embedded into the confirmation URL delivered through the in-app
 * notification (payload.actionUrl + message text), the sole carrier.
 */
async function requestErasure({ healthId, reason, actorId }) {
    if (!healthId) {
        const err = new Error('healthId is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    if (!actorId) {
        const err = new Error('actorId is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }

    const subject = await _resolveByHealthId(healthId);
    if (!subject) {
        const err = new Error('Data subject not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
    }
    if (subject.isDeleted) {
        const err = new Error('Account is already scheduled for deletion');
        err.code = 'PDPA_ALREADY_DELETED';
        throw err;
    }
    if (subject.legalHold) {
        // PDPA ม.32 explicitly defers to other statutory retention duties
        // (ม.24(6)). A legal hold here is the operator's claim that an
        // active retention duty applies; the subject must escalate to
        // DTAM compliance for review rather than self-serve erasure.
        const err = new Error('Account cannot be erased while a legal hold is active');
        err.code = 'PDPA_LEGAL_HOLD';
        throw err;
    }

    const existing = await _loadEnvelope(subject.id);
    if (existing && existing.envelope && existing.envelope.status === ERASURE_STATUS.REQUESTED) {
        // Idempotent: an in-flight REQUESTED envelope is returned as-is
        // rather than overwritten — overwriting would silently invalidate
        // the prior confirmation URL, surprising legitimate users who
        // double-click the request button.
        const err = new Error('An erasure request is already in progress');
        err.code = 'PDPA_ERASURE_IN_PROGRESS';
        err.requestId = existing.envelope.requestId;
        err.expiresAt = existing.envelope.expiresAt;
        throw err;
    }

    const requestId = _generateRequestId();
    const token = _generateToken();
    const now = _now();
    const expiresAt = new Date(now.getTime() + CONFIRM_WINDOW_MS);

    const envelope = {
        requestId,
        status: ERASURE_STATUS.REQUESTED,
        token, // stored at-rest under the PDPA-encrypted privacySettings column
        reason: reason ? String(reason).slice(0, 500) : null,
        requestedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        actorId,
    };

    await _saveEnvelope(subject.id, envelope);

    await auditLogger.log({
        category: AuditCategory.SECURITY,
        action: 'PDPA_ERASURE_REQUESTED',
        severity: AuditSeverity.INFO,
        actorId,
        organizationId: subject.organizationId,
        resourceType: ResourceType.USER,
        resourceId: subject.id,
        metadata: { requestId, expiresAt: envelope.expiresAt, reasonProvided: Boolean(envelope.reason) },
    });

    try {
        // One accessor, one guard — a staging notice must not link to production.
        const webBaseUrl = appBaseUrl();
        // Compose the confirm URL ONCE here — same formula
        // notification-fanout-service.js's PDPA_ERASURE_REQUESTED template
        // uses internally (webBaseUrl + path + encoded requestId/token) — and
        // pass it as `actionUrl` so the in-app notification row gets a real
        // click-through target (final-fix-1, 2026-08-19: previously the URL
        // only reached the user as unclickable plain text inside `message`).
        const confirmUrl = `${webBaseUrl}/health/account/erasure`
            + `?requestId=${encodeURIComponent(requestId)}`
            + `&token=${encodeURIComponent(token)}`;

        await _getFanout().send({
            userId: subject.id,
            type: 'PDPA_ERASURE_REQUESTED',
            // The PDPA_ERASURE_REQUESTED template builds the confirm link from
            // requestId + token + webBaseUrl. Previously only requestId/expiresAt
            // were passed, so the link rendered with an EMPTY token and a
            // '[WEB_BASE_URL_NOT_CONFIGURED]' host — unusable (audit 2.11). The
            // token is the confirm secret, delivered only to the data subject's
            // own channels (single-use, 24h) — same trust model as a password-
            // reset link.
            payload: {
                requestId,
                token,
                expiresAt: envelope.expiresAt,
                webBaseUrl,
                actionUrl: confirmUrl,
            },
        });
    } catch (err) {
        // Notification failure is non-fatal — the request envelope is
        // already persisted. The user can still confirm via an
        // admin-supplied link.
        logger.warn('[pdpa-erasure] notification send failed', { err: err.message });
    }

    return { requestId, expiresAt: envelope.expiresAt, token };
}

/**
 * Step 2 — User confirms the erasure request with the token.
 *
 * @param {string} requestId
 * @param {object} args
 * @param {string} args.token
 * @param {string} args.actorId
 * @returns {Promise<object>} The executeErasure summary.
 */
async function confirmErasure(requestId, { token, actorId } = {}) {
    if (!requestId) {
        const err = new Error('requestId is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    if (!token) {
        const err = new Error('token is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    if (!actorId) {
        const err = new Error('actorId is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }

    // Locate the envelope by requestId. We do not have a dedicated index
    // on privacySettings JSON, so the route layer enforces self-service
    // (actorId == subject.id) and we fetch the user by id+envelope.
    const subjectUser = await prisma.user.findFirst({
        where: { id: actorId },
        select: {
            id: true,
            organizationId: true,
            privacySettings: true,
            isDeleted: true,
            legalHold: true,
        },
    });
    if (!subjectUser) {
        const err = new Error('Data subject not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
    }
    const envelope = subjectUser.privacySettings && subjectUser.privacySettings.pdpaErasure
        ? subjectUser.privacySettings.pdpaErasure
        : null;
    if (!envelope || envelope.requestId !== requestId) {
        const err = new Error('Erasure request not found');
        err.code = 'PDPA_ERASURE_NOT_FOUND';
        throw err;
    }
    if (envelope.status !== ERASURE_STATUS.REQUESTED) {
        const err = new Error(`Erasure request is in status ${envelope.status}`);
        err.code = 'PDPA_ERASURE_BAD_STATUS';
        throw err;
    }
    if (new Date(envelope.expiresAt).getTime() < Date.now()) {
        // Mark as EXPIRED for the audit trail before refusing.
        const expiredEnvelope = { ...envelope, status: ERASURE_STATUS.EXPIRED };
        await _saveEnvelope(subjectUser.id, expiredEnvelope);
        const err = new Error('Erasure confirmation window has expired');
        err.code = 'PDPA_ERASURE_EXPIRED';
        throw err;
    }
    if (!_safeTokenEqual(String(token), String(envelope.token))) {
        const err = new Error('Invalid erasure token');
        err.code = 'PDPA_ERASURE_INVALID_TOKEN';
        throw err;
    }

    return executeErasure({ healthId: null, userId: subjectUser.id, actorId });
}

/**
 * Cancel an in-flight erasure request before confirmation.
 *
 * @param {string} requestId
 * @param {object} args
 * @param {string} args.actorId — must equal the subject (self-service).
 */
async function cancelErasure(requestId, { actorId } = {}) {
    if (!requestId) {
        const err = new Error('requestId is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    if (!actorId) {
        const err = new Error('actorId is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    const user = await prisma.user.findFirst({
        where: { id: actorId },
        select: { id: true, organizationId: true, privacySettings: true },
    });
    if (!user) {
        const err = new Error('Data subject not found');
        err.code = 'USER_NOT_FOUND';
        throw err;
    }
    const envelope = user.privacySettings && user.privacySettings.pdpaErasure
        ? user.privacySettings.pdpaErasure
        : null;
    if (!envelope || envelope.requestId !== requestId) {
        const err = new Error('Erasure request not found');
        err.code = 'PDPA_ERASURE_NOT_FOUND';
        throw err;
    }
    if (envelope.status !== ERASURE_STATUS.REQUESTED) {
        const err = new Error(`Erasure request is in status ${envelope.status}`);
        err.code = 'PDPA_ERASURE_BAD_STATUS';
        throw err;
    }

    const canceled = { ...envelope, status: ERASURE_STATUS.CANCELED, canceledAt: _now().toISOString() };
    delete canceled.token; // do not retain the verification token after cancel
    await _saveEnvelope(user.id, canceled);

    await auditLogger.log({
        category: AuditCategory.SECURITY,
        action: 'PDPA_ERASURE_CANCELED',
        severity: AuditSeverity.INFO,
        actorId,
        organizationId: user.organizationId,
        resourceType: ResourceType.USER,
        resourceId: user.id,
        metadata: { requestId },
    });

    return { ok: true, requestId, status: ERASURE_STATUS.CANCELED };
}

/**
 * Step 3 — Execute the erasure inside a single transaction.
 *
 * Returns a summary describing what was erased vs. preserved per the
 * legal retention matrix above.
 *
 * @param {object} args
 * @param {string} [args.healthId] — canonicalId; either this OR userId is required
 * @param {string} [args.userId]   — User.id (UUID)
 * @param {string} args.actorId
 * @returns {Promise<{
 *   ok: boolean,
 *   userId: string,
 *   executedAt: string,
 *   anonymized: { user: boolean, applications: number, certificates: number },
 *   erased: { applicationDrafts: number, notifications: number },
 *   preserved: string[],
 * }>}
 */
async function executeErasure({ healthId, userId, actorId }) {
    if (!actorId) {
        const err = new Error('actorId is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    let resolvedUserId = userId;
    // Detokenize STAGE 0 (RFC breaker 3): the pre-erasure canonicalId (the LIVE FK
    // key). Captured from the resolved User row — NOT the `healthId` argument (the
    // national ID), which stops equalling the FK key after the STAGE-A re-key.
    // After step 1 re-keys canonicalId to resolvedUserId, the Application
    // anonymise queries by resolvedUserId (the post-cascade FK value), so this is
    // used only for the data-integrity guard + audit trail below.
    let canonicalId = null;
    let organizationId = null;
    if (!resolvedUserId) {
        if (!healthId) {
            const err = new Error('healthId or userId is required');
            err.code = 'VALIDATION_ERROR';
            throw err;
        }
        const subject = await _resolveByHealthId(healthId);
        if (!subject) {
            const err = new Error('Data subject not found');
            err.code = 'USER_NOT_FOUND';
            throw err;
        }
        resolvedUserId = subject.id;
        canonicalId = subject.canonicalId;
        organizationId = subject.organizationId;
    } else {
        const u = await prisma.user.findUnique({
            where: { id: resolvedUserId },
            select: { canonicalId: true, organizationId: true, legalHold: true },
        });
        if (!u) {
            const err = new Error('Data subject not found');
            err.code = 'USER_NOT_FOUND';
            throw err;
        }
        canonicalId = u.canonicalId;
        organizationId = u.organizationId;
        if (u.legalHold) {
            const err = new Error('Account cannot be erased while a legal hold is active');
            err.code = 'PDPA_LEGAL_HOLD';
            throw err;
        }
    }

    const now = _now();
    const summary = {
        ok: true,
        userId: resolvedUserId,
        executedAt: now.toISOString(),
        anonymized: { user: false, applications: 0, certificates: 0, entities: 0, precheckTexts: 0 },
        erased: { applicationDrafts: 0, notifications: 0 },
        // Rows the request reached but retention kept intact (operator ruling
        // 2026-08-27, step 3 below). Each entry: { id, certificateNumber,
        // basis: 'LEGAL_HOLD' | 'RETENTION_ACTIVE', retainUntil: iso | null }.
        // Named "retained", not "deferred": nothing in the tree revisits these
        // rows once this erasure commits, and the subject cannot re-request
        // (step 1 soft-deletes the account), so the state is permanent.
        retained: { certificates: [] },
        preserved: [
            // Per ม.87/3 ป.รัษฎากร (7-year retention for tax/accounting):
            'Invoice',
            'CreditNote',
            'DebitNote',
            'JournalEntry',
            'JournalLine',
            'PaymentTransaction',
            // Per Thai e-Transactions Act §31 (immutable audit chain):
            'AuditLog',
            // Per DTAM 5-year cert retention (regulated records) + operator
            // ruling 2026-08-27 (a GACP certificate is a government register):
            'Certificate (live: retainUntil/legalHold — holder name kept for the life of the certificate; operator ruling 2026-08-27)',
            'Certificate (anonymised, row kept — only once past retention and not on legal hold)',
            // Per operator decision D-9 2026-08-03 (R2 M1 — จดหมายราชการ
            // เก็บถาวร; evidence/R2-special-reopen/decisions-final.md):
            `Notification kind=${NOTIFICATION_KIND.OFFICIAL_LETTER}`,
        ],
    };

    // Use a single transaction so a partial failure does not leave the
    // user half-erased. The transaction client bypasses extensions, so
    // we explicitly call encryption-aware helpers when needed — for the
    // anonymisation path we are writing the SENTINEL string, which is
    // safe to store plaintext (it carries no personal data).
    await prisma.$transaction(async (tx) => {
        // 1. Anonymise the User row.
        await tx.user.update({
            where: { id: resolvedUserId },
            data: {
                // Identifier columns — null them out (the lookup hashes
                // are also cleared so even hash-correlation is defeated).
                healthId: null,
                healthIdHash: null,
                providerId: null,
                providerIdHash: null,
                idCard: null,
                idCardHash: null,
                taxId: null,
                taxIdHash: null,
                communityRegistrationNo: null,
                communityRegistrationNoHash: null,
                laserCode: null,
                // Detokenize STAGE 0 (RFC gap 4 — live defect today): the keyed
                // HMAC lookup columns MUST also be nulled. The legacy raw-SHA-256
                // `*Hash` columns above were cleared, but the `*Hmac` columns
                // survived — and a keyed HMAC over the ~10^11 national-ID space is
                // dictionary-confirmable (the key is shared, login needs it). A
                // surviving healthIdHmac means an attacker who guesses a national
                // ID can confirm "this erased row was that person". Null them.
                healthIdHmac: null,
                providerIdHmac: null,
                idCardHmac: null,
                taxIdHmac: null,
                communityRegistrationNoHmac: null,
                // canonicalId is @unique NOT NULL → cannot be nulled. Re-key it to
                // the stable User.id so it carries no national-ID-derived value
                // (today it == the national ID; the token is national-ID-derived
                // too). The 3 FK children (Application/Invoice/Bundle.healthId) are
                // ON UPDATE CASCADE, so they follow to user.id in this same
                // statement — step 2 below queries the post-cascade value.
                canonicalId: resolvedUserId,
                // PII columns — sentinel instead of null so downstream
                // joins still render a non-empty label ("PDPA_ERASED").
                email: null,
                phoneNumber: null,
                firstName: ERASURE_SENTINEL,
                lastName: ERASURE_SENTINEL,
                address: null,
                province: null,
                district: null,
                subdistrict: null,
                zipCode: null,
                companyName: null,
                representativeName: null,
                representativePosition: null,
                communityName: null,
                // Credentials.
                password: 'PDPA_ERASED',
                // SF-3: evict any tokens issued before erasure (session epoch).
                sessionsRevokedAt: sessionEpochStamp(),
                twoFactorSecret: null,
                twoFactorBackupCodes: null,
                twoFactorEnabled: false,
                emailVerificationToken: null,
                emailVerificationExpiry: null,
                passwordResetToken: null,
                passwordResetExpiry: null,
                // Soft-delete + anonymise markers. retainUntil is left intact,
                // but NOTHING revisits this row afterwards: the retention sweep
                // (jobs/pdpa-retention-job.js) reads users through the
                // soft-delete filter, so an isDeleted row never reaches it.
                // Everything this erasure owes the subject therefore happens in
                // this transaction — including the document pre-check text
                // (step 2b below).
                isDeleted: true,
                deletedAt: now,
                deletedBy: actorId,
                deleteReason: 'PDPA ม.32 user-initiated erasure',
                privacySettings: {
                    pdpaErasure: {
                        status: ERASURE_STATUS.EXECUTED,
                        executedAt: now.toISOString(),
                        actorId,
                    },
                },
            },
        });
        summary.anonymized.user = true;

        // 2. Anonymise the formData PII leaves on the user's applications.
        //    We never DELETE applications — they reference audit + invoice
        //    rows that the platform must retain.
        //
        //    Detokenize STAGE 0: step 1 set canonicalId = resolvedUserId, and the
        //    ON UPDATE CASCADE already rewrote Application.healthId to that same
        //    User.id within this transaction. So we query by `resolvedUserId` (the
        //    post-cascade FK value), NOT the pre-update `canonicalId` variable —
        //    which no longer matches any row. resolvedUserId is always present.
        {
            const apps = await tx.application.findMany({
                where: { healthId: resolvedUserId },
                select: { id: true, formData: true },
            });
            for (const app of apps) {
                const sanitized = _sanitizeApplicationFormData(app.formData);
                await tx.application.update({
                    where: { id: app.id },
                    data: { formData: sanitized },
                });
                summary.anonymized.applications += 1;
            }
        }

        // 2b. The text the document pre-check read off the subject's papers
        //     (DocumentPrecheck.extractedText + every flag's evidenceSnippet) —
        //     the same clear the retention sweep runs, bound to this `tx` so it
        //     commits or rolls back with the rest of the erasure. Applications
        //     under legal hold keep their text. Rows, status and results stay.
        summary.anonymized.precheckTexts = await clearPrecheckText(tx, resolvedUserId);

        // 3. Certificate display fields — ONLY once the certificate is past
        //    its retention. Operator ruling 2026-08-27: a GACP certificate is
        //    a government register; the holder's name stays on it for the
        //    life of the certificate even under a PDPA erasure request. The
        //    row carries the same retention columns the User row above
        //    honours (`retainUntil` default now()+5y, `legalHold`), so:
        //      legalHold === true             → retained (basis LEGAL_HOLD)
        //      retainUntil is a future Date   → retained (basis RETENTION_ACTIVE)
        //      otherwise                      → anonymised exactly as before
        //    A live certificate must also not be touched because its signed
        //    documentHash covers applicantName — anonymising it makes the
        //    public verifier report TAMPERED for a genuinely valid
        //    certificate. The cert NUMBER stays either way so a QR scan still
        //    resolves the row.
        //
        //    "Retained" is permanent for this subject. Step 1 above closed
        //    every door back (isDeleted → requestErasure refuses, lookup
        //    hashes nulled, password sentinel, sessions revoked), and no job
        //    in the tree anonymises a certificate once retainUntil passes —
        //    jobs/pdpa-retention-job.js sweeps prisma.user only, and the
        //    update below is the sole certificate anonymiser. Honouring "for
        //    the life of the certificate" therefore needs a certificate
        //    retention sweep (past retainUntil, legalHold=false, holder user
        //    isDeleted, same payload as the update below); that is a separate
        //    work item (the backlog, 2026-08-27), not this erasure.
        //
        //    Known debt (out of scope here; the change log "PDPA erasure
        //    เขียนฟิลด์ในแฮช", operator TALK): a certificate anonymised AFTER
        //    retention still fails hash verification, because the sentinel ≠
        //    the signed name.
        //
        //    M1 (2026-08-15): `holderType` is selected because the decision
        //    below depends on it — with the old `{ id: true }` select every
        //    branch would read `undefined` and silently keep person names.
        //    The same holds for `retainUntil` / `legalHold`: unselected, both
        //    read `undefined` and a live certificate is silently anonymised.
        //    `now` is the single clock read this erasure already took above —
        //    never a second one, so summary.executedAt and the retention
        //    decision agree.
        const certs = await tx.certificate.findMany({
            where: { userId: resolvedUserId },
            select: {
                id: true,
                certificateNumber: true,
                status: true,
                holderType: true,
                retainUntil: true,
                legalHold: true,
            },
        });
        for (const cert of certs) {
            const retentionActive = cert.retainUntil instanceof Date && cert.retainUntil > now;
            if (cert.legalHold === true || retentionActive) {
                const retainedEntry = {
                    id: cert.id,
                    certificateNumber: cert.certificateNumber,
                    basis: cert.legalHold === true ? 'LEGAL_HOLD' : 'RETENTION_ACTIVE',
                    retainUntil: cert.retainUntil instanceof Date ? cert.retainUntil.toISOString() : null,
                };
                summary.retained.certificates.push(retainedEntry);
                logger.warn('[pdpa-erasure] certificate retained — retention keeps the holder name for the life of the certificate (operator ruling 2026-08-27)', {
                    userId: resolvedUserId,
                    ...retainedEntry,
                    status: cert.status,
                });
                continue;
            }
            await tx.certificate.update({
                where: { id: cert.id },
                data: {
                    applicantName: ERASURE_SENTINEL,
                    address: null,
                    // M1: holder columns — a farm's name is not personal data;
                    // a person's is. LEGACY_PERSON (pre-entity rows) and
                    // INDIVIDUAL (displayName = firstName + lastName, built by
                    // entity-service) both carry the data subject's own name, so
                    // they follow applicantName into the sentinel. JURISTIC /
                    // COMMUNITY_ENTERPRISE hold the certificate in the entity's
                    // name and outlive any one member — never touched (AC4).
                    ...(cert.holderType === 'LEGACY_PERSON' || cert.holderType === 'INDIVIDUAL'
                        ? { holderDisplayName: ERASURE_SENTINEL }
                        : {}),
                },
            });
            summary.anonymized.certificates += 1;
        }

        // 4. Detokenize STAGE 0 (RFC gap 4 / "REQUIRED scope addition"): the
        //    user's personal INDIVIDUAL Entity row carries a SECOND copy of the
        //    national ID — `Entity.thaiCitizenId` (plaintext) + an UNKEYED
        //    SHA-256 `thaiCitizenIdHash` (entity-service.js writes both from
        //    user.healthId). Without anonymising it, the national ID survives a
        //    user erasure in the entities table (and the unkeyed hash is
        //    brute-forceable with NO key). Resolve the entity via the stable
        //    EntityMembership(userId) OWNER link — User.id never moves — and null
        //    both. (Full Entity field-encryption + keyed thaiCitizenIdHmac is
        //    STAGE B; here we only anonymise on erasure.)
        const ownerMemberships = await tx.entityMembership.findMany({
            where: { userId: resolvedUserId, role: 'OWNER', entity: { type: 'INDIVIDUAL' } },
            select: { entityId: true },
        });
        for (const m of ownerMemberships) {
            await tx.entity.update({
                where: { id: m.entityId },
                data: { thaiCitizenId: null, thaiCitizenIdHash: null },
            });
            summary.anonymized.entities += 1;
        }

        // 5. Hard-delete the non-regulated records.
        const draftsDeleted = await tx.applicationDraft.deleteMany({
            where: { userId: resolvedUserId },
        });
        summary.erased.applicationDrafts = draftsDeleted.count;

        // R2 M1 exception (NOT silent — cited basis): จดหมายราชการในระบบ
        // (kind = official letter) เก็บถาวรตามมติ operator 2026-08-03 (D-9) —
        // ดู evidence/R2-special-reopen/decisions-final.md. The official-letter
        // rows are the permanent record of formal decisions communicated to the
        // farmer, so a user erasure keeps them; every other notification kind
        // of the user is still hard-deleted here as before.
        const notificationsDeleted = await tx.notification.deleteMany({
            where: {
                userId: resolvedUserId,
                kind: { not: NOTIFICATION_KIND.OFFICIAL_LETTER },
            },
        });
        summary.erased.notifications = notificationsDeleted.count;
    });

    // Audit AFTER the transaction commits so we do not write an EXECUTED
    // row for a transaction that rolled back.
    await auditLogger.log({
        category: AuditCategory.SECURITY,
        action: 'PDPA_ERASURE_EXECUTED',
        severity: AuditSeverity.WARNING,
        actorId,
        organizationId,
        resourceType: ResourceType.USER,
        resourceId: resolvedUserId,
        metadata: {
            anonymizedApplications: summary.anonymized.applications,
            anonymizedCertificates: summary.anonymized.certificates,
            // Detokenize STAGE 0: record how many personal INDIVIDUAL entities
            // had their thaiCitizenId/Hash anonymised + that the FK key was
            // present (data-integrity sanity — never the value, which is PII).
            anonymizedEntities: summary.anonymized.entities,
            hadCanonicalId: Boolean(canonicalId),
            erasedDrafts: summary.erased.applicationDrafts,
            erasedNotifications: summary.erased.notifications,
            preserved: summary.preserved,
            // Cite legal authorities so a future PDPA audit trail can
            // reconstruct the legal basis from the audit row alone.
            legalBasis: ['PDPA ม.32', 'ม.87/3 ป.รัษฎากร', 'ทะเบียนใบรับรอง GACP (เก็บตามอายุใบ)'],
        },
    });

    try {
        await _getFanout().send({
            userId: resolvedUserId,
            type: 'PDPA_ERASURE_EXECUTED',
            payload: { executedAt: summary.executedAt },
        });
    } catch (err) {
        // After erasure the email/phone are null — fanout will skip the
        // email/SMS channels. The in-app row is the user's final receipt.
        logger.warn('[pdpa-erasure] post-erasure notification failed', { err: err.message });
    }

    logger.info('[pdpa-erasure] EXECUTED', {
        userId: resolvedUserId,
        anonymized: summary.anonymized,
        erased: summary.erased,
    });

    return summary;
}

/**
 * Scrub PII leaves from an Application.formData JSON blob. The blob is
 * free-form — different application types populate different keys —
 * so we walk known PII keys + any key that LOOKS like PII by name.
 *
 * Preserves non-PII keys (areaSize, cropType, ...) so the application
 * row remains useful for audit/recon. Non-string values (numbers,
 * objects, arrays) are passed through unchanged unless their KEY name
 * matches a PII heuristic.
 */
function _sanitizeApplicationFormData(formData) {
    if (!formData || typeof formData !== 'object') {return formData;}
    // Known PII keys observed in the schema's frontend form components.
    const PII_KEYS = new Set([
        'applicantName',
        'applicantPhone',
        'applicantEmail',
        'applicantAddress',
        'applicantIdCard',
        'applicantThaiId',
        'phoneNumber',
        'phone',
        'email',
        'thaiId',
        'idCard',
        'address',
        'firstName',
        'lastName',
        'fullName',
        'birthDate',
        'birthday',
        'nationalId',
    ]);
    const result = Array.isArray(formData) ? [...formData] : { ...formData };
    for (const key of Object.keys(result)) {
        const value = result[key];
        if (PII_KEYS.has(key)) {
            result[key] = null;
            continue;
        }
        if (value && typeof value === 'object') {
            // Recurse into nested objects/arrays.
            result[key] = _sanitizeApplicationFormData(value);
        }
    }
    return result;
}

/**
 * Admin view of pending / historical erasure requests.
 *
 * @param {object} args
 * @param {string} [args.status]
 * @param {string} [args.organizationId] — scoped lookup (RBAC enforced
 *                                          at the route layer).
 * @returns {Promise<Array<{
 *   userId: string,
 *   organizationId: string,
 *   requestId: string,
 *   status: string,
 *   requestedAt: string,
 *   expiresAt: string,
 * }>>}
 */
async function listErasureRequests({ status, organizationId } = {}) {
    const where = {
        privacySettings: { path: ['pdpaErasure', 'requestId'], not: null },
    };
    if (organizationId) {
        where.organizationId = organizationId;
    }
    // The Prisma JSON-path filter is provider-specific (PostgreSQL only);
    // we fall back to a broader scan if the database does not support it.
    let users;
    try {
        users = await prisma.user.findMany({
            where,
            select: { id: true, organizationId: true, privacySettings: true },
            take: 500,
        });
    } catch (_err) {
        users = await prisma.user.findMany({
            where: organizationId ? { organizationId } : {},
            select: { id: true, organizationId: true, privacySettings: true },
            take: 500,
        });
    }

    const rows = [];
    for (const user of users) {
        const envelope = user.privacySettings && user.privacySettings.pdpaErasure
            ? user.privacySettings.pdpaErasure
            : null;
        if (!envelope || !envelope.requestId) {continue;}
        if (status && envelope.status !== status) {continue;}
        rows.push({
            userId: user.id,
            organizationId: user.organizationId,
            requestId: envelope.requestId,
            status: envelope.status,
            requestedAt: envelope.requestedAt || null,
            expiresAt: envelope.expiresAt || null,
            executedAt: envelope.executedAt || null,
            canceledAt: envelope.canceledAt || null,
            // The token is intentionally NOT exposed on the admin view —
            // it is a confirmation secret meant only for the data subject.
        });
    }
    return rows;
}

module.exports = {
    requestErasure,
    confirmErasure,
    cancelErasure,
    executeErasure,
    listErasureRequests,
    // exported for tests + internal use
    CONFIRM_WINDOW_MS,
    ERASURE_STATUS,
    ERASURE_SENTINEL,
    _sanitizeApplicationFormData,
};
