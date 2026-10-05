const path = require('path');
const { authenticateAny } = require('./auth-middleware');
const storageService = require('../services/storage-service');
const { prisma } = require('../services/prisma-database');
const { normalizeRole, isProviderRole } = require('../shared/canonical-rbac');
const logger = require('../shared/logger');

/**
 * C1 (RD-UPLOADS traversal) — decode + normalize the `/uploads`-relative
 * request path so classification and object-ACL lookups run on the SAME
 * collapsed path that `send`/express.static ultimately resolves. `send@0.19.2`
 * normalizes AFTER these gates classify, so a request whose RAW URI is
 * `/uploads/x/../slips/<uuid>.jpg` (or the `%2f..%2f` / `%2e%2e` encoded
 * variants an nginx literal proxy_pass forwards un-normalized) would
 * prefix-miss `slips/` here yet stream the slip bytes downstream.
 *
 * Returns `{ malformed, traversal, rel, normalized }`. Callers reject on
 * `malformed || traversal` BEFORE static and classify off `normalized`.
 */
function decodeUploadsRel(originalUrl) {
    const raw = String(originalUrl || '').split('?')[0];
    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    } catch (_decodeErr) {
        return { malformed: true, traversal: false, rel: '', normalized: '' };
    }
    const rel = decoded.replace(/^\/uploads\/?/, '');
    // Split on BOTH separators: a decoded `%2f` is a real path separator and a
    // stray backslash must not sneak a segment past the check on any platform.
    const segments = rel.split(/[\\/]+/);
    const hasDotSegment = segments.some((s) => s === '..' || s === '.');
    // posix.normalize collapses any residual `a/../b` → `b`; a normalized path
    // that still escapes the mount root (`..` prefix or absolute) is traversal.
    const normalized = path.posix.normalize(rel);
    const escapes = normalized.startsWith('..') || normalized.startsWith('/');
    return { malformed: false, traversal: hasDotSegment || escapes, rel, normalized };
}

// Shared 400 for a malformed / traversal `/uploads` request. Never serves bytes.
function rejectBadUploadPath(res) {
    return res.status(400).json({ success: false, error: 'Bad Request', code: 'INVALID_PATH' });
}

/**
 * SEC-AUDIT-002 — scoped protection for the public `/uploads` static mount.
 *
 * `/uploads` mixes definitively-sensitive files with intended-public assets under
 * a single mount, so a mount-wide auth gate is the wrong layer — a blanket gate
 * broke the PUBLIC consumer trace page, which links lab-test reports served from
 * `/uploads`. Instead we require a valid session ONLY for the paths that are
 * sensitive AND have no public consumer:
 *
 *   - root-level files (`/uploads/<file>`) → ID-card images + avatars. These come
 *     only from the register `idCardImage` and `me/avatar` uploaders; the public
 *     web-app never loads raw `/uploads/<file>` URLs.
 *   - `/uploads/slips/*` → payment slips (financial PII). The finance UI views a
 *     slip via an authenticated endpoint that 302-redirects to this static URL, so
 *     the auth cookie forwards on the follow-up GET (same-origin Next rewrite);
 *     anonymous direct access is what we close.
 *
 *   - `/uploads/application-drafts/*` and `/uploads/wizard-drafts/*` → applicant
 *     application documents (PII). B-DOC-01 fix (2026-06-04): these are now gated —
 *     they hold sensitive applicant docs and have NO public consumer (the public
 *     consumer-trace page links LAB reports, not draft documents). The applicant's
 *     own browser forwards its auth cookie on same-origin GETs; anonymous direct
 *     access is what we close.
 *
 * Other subfolders (lab-report locations) stay PUBLIC to preserve consumer trace
 * transparency. Full signed-URL / object-storage / bucket-separation hardening is
 * still tracked in docs/handoffs/audit-2026-05-31.
 *
 * Uses `req.originalUrl` (always the full path, mount-independent) so the prefix
 * test is unambiguous.
 */
/**
 * SINGLE SOURCE of the sensitivity classification, so the static gate and the
 * signed-URL mint endpoint can never drift apart about what "sensitive" means.
 *
 * The set is UNCHANGED from the pre-W1-2 gate — this function only names what
 * the gate already did inline.
 *
 * @param {string} rel `/uploads`-relative path, already decoded + normalized.
 * @returns {{kind: 'root'|'slip'|'draft'|'car'|'audit'|'public', sensitive: boolean}}
 */
function classifyUploadsPath(rel) {
    const value = String(rel || '');
    const isRootFile = value.length > 0 && !value.includes('/'); // ID-card / avatar
    const isSlip = value.startsWith('slips/');                   // payment slips
    // B-DOC-01 fix: applicant draft documents are sensitive PII with no public
    // consumer → require a session. Lab-report subfolders stay public (trace).
    const isApplicantDraft = value.startsWith('application-drafts/') || value.startsWith('wizard-drafts/');
    // SECURITY (finding F8): CAR audit-finding documents and on-site audit
    // evidence photos are PDPA-sensitive and have NO public consumer (unlike lab
    // reports, which the consumer-trace page links). They were served anonymously,
    // protected only by uuid-filename obscurity. Require a session, same as the
    // draft/slip PII.
    const isCar = value.startsWith('car/');
    const isAuditPhoto = value.startsWith('audits/');

    let kind = 'public';
    if (isSlip) { kind = 'slip'; }
    else if (isApplicantDraft) { kind = 'draft'; }
    else if (isCar) { kind = 'car'; }
    else if (isAuditPhoto) { kind = 'audit'; }
    else if (isRootFile) { kind = 'root'; }

    return { kind, sensitive: isRootFile || isSlip || isApplicantDraft || isCar || isAuditPhoto };
}

function gateSensitiveUploads(req, res, next) {
    const info = decodeUploadsRel(req.originalUrl);
    // C1: malformed encoding or ANY path-traversal segment can never map to a
    // legitimate asset — reject BEFORE express.static (which would decode +
    // normalize and serve the escaped target). This is the first chokepoint;
    // gateSlipObjectAccess repeats it defensively.
    if (info.malformed || info.traversal) {
        return rejectBadUploadPath(res);
    }
    // Classify off the NORMALIZED path so an encoded/relative form resolves to
    // the same target the static handler will serve.
    const rel = info.normalized;
    const { sensitive } = classifyUploadsPath(rel);
    if (sensitive) {
        // W1-2 — accept EITHER credential, never neither.
        //
        // A browser <img src="/uploads/x.png"> cannot send an Authorization
        // header, so a session-only gate made every private upload unrenderable
        // even for its owner. A signature is minted ONLY by
        // routes/api/files/files.js, which first proves the caller is entitled to
        // this exact object using authorizeUploadsObject() below — the same ACL
        // this file enforces for a session. The signature is bound to THIS object
        // key and expires in minutes, so it grants strictly less than the session
        // that minted it. Classification above is untouched.
        const signature = storageService.verifySignedObjectRequest(rel, req.query || {});
        if (signature.valid) {
            // Marks the request as already object-authorized at mint time, so
            // gateSlipObjectAccess does not re-run an ACL that needs a req.user.
            req.uploadsSignedAccess = true;
            return next();
        }
        return authenticateAny(req, res, next);
    }
    return next();
}

/**
 * RD-UPLOADS-IDOR (OWASP A01) — object-level authorization for the static
 * `/uploads/slips/*` mount.
 *
 * `gateSensitiveUploads` only proves a slip request carries a VALID session; it
 * does NOT check that the session belongs to the slip's owner or money-flow
 * side. Without this second gate, any authenticated user who learned a slip's
 * uuid filename could stream another applicant's transfer-proof image
 * (financial PII), bypassing both the HEALTH owner check AND the DTAM/PLATFORM
 * side-wall (SoD) that the JSON API path (`payment-slips.js` → `canSeeSlip`)
 * enforces.
 *
 * This middleware runs AFTER `gateSensitiveUploads` (so `req.user` is populated
 * for slip paths) and maps the requested `/uploads/slips/<file>` path back to
 * its PaymentSlip row, then applies the SAME `canSeeSlip` ACL the API uses
 * (owner + side + tenancy). It is a no-op for every non-slip `/uploads` path,
 * so intended-public assets and the existing draft/root-file gating are
 * unaffected.
 *
 * Fail-closed:
 *   - missing session (should not happen — gateSensitiveUploads gates slips,
 *     but defend anyway) → 401.
 *   - no slip references the path (unknown / orphaned file) → 404.
 *   - caller not the owner / wrong side / wrong org → 404 (do not leak
 *     existence; mirrors the API's `GET /:id` 404-on-deny).
 *   - lookup error → 500 (logged) — never silently serve.
 */
async function gateSlipObjectAccess(req, res, next) {
    const info = decodeUploadsRel(req.originalUrl);
    // C1 defense-in-depth: reject malformed / traversal even though
    // gateSensitiveUploads already did — the two gates must never disagree on
    // the resolved path (that disagreement IS the send-normalizes-after-classify
    // bug). Do NOT serve.
    if (info.malformed || info.traversal) {
        return rejectBadUploadPath(res);
    }
    const rel = info.normalized;

    // W1-2 — a valid signature already proved this exact object was authorized
    // for the minting subject (routes/api/files/files.js runs
    // authorizeUploadsObject before signing). There is no req.user to re-check
    // against here, and re-running the ACL would 401 every legitimate signed
    // request. The path guards above still ran.
    if (req.uploadsSignedAccess) {
        return next();
    }

    // ทุกไฟล์ที่ classifyUploadsPath ตัดสินว่า "sensitive" ต้องผ่าน ACL ระดับวัตถุ
    // ไม่ใช่แค่ draft กับ slip
    //
    // เดิมมีเพียงสองชนิดที่ถูกส่งเข้า authorizeUploadsObject ส่วน car/ audits/ และ
    // ไฟล์ที่ราก ถูกจัดว่า sensitive (จึงบังคับให้มีเซสชัน) แต่ไม่เคยถูกตรวจว่า
    // "เซสชันของใคร" · วัดจริงบน GACP Lite ซึ่งใช้โค้ดชุดเดียวกัน 2026-09-09:
    //
    //   GET /uploads/car/<ไฟล์>   ไม่มีโทเคน -> 401 · ผู้ยื่นคนอื่น -> 200
    //   GET /uploads/<ไฟล์ที่ราก> ไม่มีโทเคน -> 401 · ผู้ยื่นคนอื่น -> 200
    //
    // car/ คือเอกสารตอบข้อบกพร่องที่เกษตรกรยื่นหลังถูกตรวจพบ และ audits/ คือภาพถ่าย
    // หลักฐานการตรวจแปลง — ทั้งสองเป็นข้อมูลส่วนบุคคลที่ไม่มีผู้บริโภคสาธารณะ
    //
    // authorizeUploadsObject รองรับทุกชนิดอยู่แล้ว (slip / root / draft / audit / car)
    // และ fail closed ด้วย OWNER_UNRESOLVED เมื่อหาเจ้าของไม่ได้ · ช่องว่างอยู่ที่
    // ตรงนี้จุดเดียว: ไม่มีใครส่งชนิดที่เหลือเข้าไปให้มันตัดสิน
    const { sensitive } = classifyUploadsPath(rel);
    if (sensitive) {
        return gateDraftObjectAccess(req, res, next, rel);
    }

    return next();

    // gateSensitiveUploads already required authenticateAny for slip paths, so
    // req.user should be present. Defend anyway — fail closed, do not serve.
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized',
            code: 'NO_TOKEN',
        });
    }

    // The bank-slip payment rail is retired (Stripe-only, 2026-09-06): no slip
    // objects are written any more, so a request for one is fail-closed. Kept as a
    // 404 (not 410) to match the old behaviour of not distinguishing missing from
    // forbidden — nothing here leaks whether a path ever existed.
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
}

/**
 * C2 (RD-UPLOADS draft-IDOR) — fail-closed read ACL for one draft document.
 *   - owner by UUID (wizard `ApplicationDraft.userId` / `application_documents.uploadedBy`).
 *   - owner by FK token (`Application.healthId` stores canonicalId once APP_FK_USE_TOKEN on).
 *   - authorized provider staff within the SAME tenant (may review application docs).
 *   - anything else → false.
 * `doc` = { ownerUserId, ownerHealthId, organizationId }.
 */
function canSeeDraftDoc(user, doc) {
    if (!user || !doc) { return false; }
    const uid = String(user.id || user.userId || '').trim();
    if (uid && doc.ownerUserId && uid === String(doc.ownerUserId)) { return true; }
    const token = String(user.canonicalId || user.healthId || '').trim();
    if (token && doc.ownerHealthId && token === String(doc.ownerHealthId)) { return true; }
    const role = normalizeRole(user.canonicalRole || user.role);
    if (isProviderRole(role) && doc.organizationId && user.organizationId
        && String(doc.organizationId) === String(user.organizationId)) {
        return true;
    }
    return false;
}

/**
 * Resolve a draft file path → its owning application/draft.
 *   - application-drafts/* → `application_documents` (dual-written on upload;
 *     see applications.js). This model is NOT tenant-scoped, so the lookup
 *     resolves the owner across tenants — the cross-tenant wall is enforced by
 *     canSeeDraftDoc, not by the query returning null.
 *     B3 fallback: that dual-write is best-effort (application-document-sync.js
 *     swallows failures) and the delete path removes the row, so its absence
 *     does NOT mean "no owner". Fall back to the CANONICAL upload record —
 *     `Application.formData.draftDocuments[].fileUrl`, written in the same
 *     request that stores the bytes (applications.js draft-documents POST) —
 *     before concluding the object is unowned. Same JSON-containment shape as
 *     resolveCarDocumentOwner below.
 *   - wizard-drafts/*      → `ApplicationDraft` (owner `userId`; the fileUrl
 *     lives inside its `formData.uploadedDocuments[]` JSON). ApplicationDraft
 *     IS tenant-scoped, so a cross-tenant lookup returns null (closes the
 *     same-tenant cross-applicant case; the cross-tenant case is not reachable
 *     in the single-tenant pilot — tracked as a follow-up).
 * Returns { ownerUserId, ownerHealthId, organizationId } or null. Throws bubble
 * to the caller, which fails SAFE (pass-through, no availability regression).
 */
/**
 * B3 — the canonical owner record for an `application-drafts/*` object.
 *
 * `Application.formData.draftDocuments[]` is written in the SAME request that
 * writes the bytes (routes/api/applications/applications.js draft-documents
 * POST), unlike the `application_documents` mirror, which is best-effort and is
 * hard-deleted by the draft-document DELETE. Deliberately not filtered on
 * `isDeleted`: a soft-deleted application still tells us WHO owns the file, and
 * the answer we need from this function is "whose is it", not "is it live".
 */
async function resolveApplicationDraftDocumentOwner(fileUrl) {
    const row = await prisma.application.findFirst({
        where: {
            formData: { path: ['draftDocuments'], array_contains: [{ fileUrl }] },
        },
        select: { healthId: true, organizationId: true, submitterId: true },
    });
    if (!row) { return null; }
    return {
        ownerUserId: row.submitterId || null,
        ownerHealthId: row.healthId || null,
        organizationId: row.organizationId || null,
    };
}

async function resolveDraftOwner(fileUrl, rel) {
    if (rel.startsWith('application-drafts/')) {
        const row = await prisma.applicationDocument.findFirst({
            where: { fileUrl },
            select: {
                uploadedBy: true,
                application: { select: { healthId: true, organizationId: true } },
            },
        });
        if (row) {
            return {
                ownerUserId: row.uploadedBy || null,
                ownerHealthId: row.application?.healthId || null,
                organizationId: row.application?.organizationId || null,
            };
        }
        return resolveApplicationDraftDocumentOwner(fileUrl);
    }
    const draft = await prisma.applicationDraft.findFirst({
        where: {
            isDeleted: false,
            formData: { path: ['uploadedDocuments'], array_contains: [{ fileUrl }] },
        },
        select: { userId: true, organizationId: true },
    });
    if (!draft) { return null; }
    return {
        ownerUserId: draft.userId || null,
        ownerHealthId: null, // wizard drafts are owned by UUID, not a FK token
        organizationId: draft.organizationId || null,
    };
}

/**
 * C2 object-ACL for `/uploads/{application,wizard}-drafts/*`. Invoked from
 * gateSlipObjectAccess (already past auth). Maps the file → owner and denies a
 * non-owner / non-authorized-reviewer with 404 (anti-enumeration; matches the
 * JSON API's 404-on-deny).
 *
 * B3 (2026-08-23) — the C2 INTERIM pass-through ("unresolved → keep the
 * session-presence gate") is GONE. It was not a neutral fail-safe: because the
 * only owner record the resolver read was the row the draft-document DELETE
 * hard-deletes, pressing delete flipped a file from "404 for every non-owner" to
 * "200 + bytes for any logged-in user". Deleting made the file MORE accessible
 * than leaving it (proven live twice, 07-BUG-HUNT.md row B3). The same door let
 * a failed best-effort dual-write publish a live applicant's ID card (row H7).
 *
 * Now: ownership that cannot be established = refusal. The availability cost the
 * interim was protecting is paid instead by resolving against the CANONICAL
 * upload record (resolveApplicationDraftDocumentOwner), which is written in the
 * same request as the bytes, so a legitimate owner does not depend on the
 * best-effort mirror.
 *
 * Delegates to authorizeUploadsObject so the static gate and the signed-URL mint
 * cannot drift about who owns an object — ONE decision, one place.
 */
async function gateDraftObjectAccess(req, res, next, rel) {
    if (!req.user) {
        return res.status(401).json({ success: false, error: 'Unauthorized', code: 'NO_TOKEN' });
    }
    const decision = await authorizeUploadsObject(req.user, rel);
    if (decision.allowed) {
        return next();
    }
    // An infrastructure failure is reported as one (and logged inside
    // authorizeUploadsObject) instead of being disguised as "no such file"; it
    // still does not serve the bytes.
    if (decision.reason === 'LOOKUP_FAILED') {
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
}

/**
 * W1-2 — root-level files (`/uploads/<file>`) are ID-card images and avatars.
 *
 * ONLY the avatar has an owner record: uploadAvatar writes the served path into
 * `User.privacySettings.avatar`
 * (controllers/auth-controller/auth-session-security-handlers.js:121-134).
 *
 * The registration ID-card image does NOT: `registerHealthUser` passes
 * `idCardImage` into userData (services/prisma-auth-service.js:648) but
 * `_sanitizeInput` deletes that key (:55) and the User model has no such column
 * (prisma/schema/auth.prisma) — the bytes land on disk with NOTHING in the
 * database pointing at them. There is therefore no owner to check and no
 * entitlement a mint could honestly assert, so a mint for any root file that is
 * not the caller's own avatar is DENIED. The session path is unchanged, so this
 * removes no existing access.
 */
async function resolveRootFileOwner(user, rel) {
    const uid = String(user?.id || user?.userId || '').trim();
    if (!uid) { return { allowed: false, reason: 'NO_SESSION' }; }
    const fileUrl = `/uploads/${rel}`;
    const row = await prisma.user.findUnique({
        where: { id: uid },
        select: { privacySettings: true },
    });
    const avatar = row?.privacySettings?.avatar;
    if (avatar && String(avatar) === fileUrl) {
        return { allowed: true, reason: 'OWN_AVATAR' };
    }
    return { allowed: false, reason: 'NOT_OWNER' };
}

/**
 * W1-2 — on-site audit evidence photos (`/uploads/audits/<auditId>/<file>`) are
 * stored through attachment-service, so the `Attachment` row IS the owner record
 * (services/audit-onsite-service.js:663-676 → fileUrl + uploadedBy +
 * organizationId). Uploader or same-tenant provider staff may see it.
 */
async function resolveAuditEvidenceOwner(fileUrl) {
    const row = await prisma.attachment.findFirst({
        where: { fileUrl, isDeleted: false },
        select: { uploadedBy: true, organizationId: true },
    });
    if (!row) { return null; }
    return {
        ownerUserId: row.uploadedBy || null,
        ownerHealthId: null,
        organizationId: row.organizationId || null,
    };
}

/**
 * W1-2 — CAR evidence (`/uploads/car/<file>`) lives inside
 * `Application.formData.carDocuments[].path`
 * (routes/api/applications/applications-car.js:180-186) — there is no dedicated
 * row, so this is a JSON containment lookup, same shape as the wizard-draft one.
 */
async function resolveCarDocumentOwner(fileUrl) {
    const row = await prisma.application.findFirst({
        where: {
            formData: { path: ['carDocuments'], array_contains: [{ path: fileUrl }] },
        },
        // Application has NO userId column — the applicant is reached through
        // `healthId` (an FK to User.canonicalId), which is exactly the FK-token
        // owner form canSeeDraftDoc already understands.
        select: { healthId: true, organizationId: true },
    });
    if (!row) { return null; }
    return {
        ownerUserId: null,
        ownerHealthId: row.healthId || null,
        organizationId: row.organizationId || null,
    };
}

/**
 * W1-2 — the ONE entitlement decision, shared by the static gate's object ACLs
 * and by the signed-URL mint endpoint.
 *
 * THE INVARIANT: a mint is never more permissive than what this caller's own
 * session could already GET from `/uploads`. Every branch either reuses the
 * exact ACL the gate uses (slips → canSeeSlip; drafts → canSeeDraftDoc), adds a
 * STRICTER owner check the gate does not have (root files → own avatar only), or
 * — where the data model genuinely cannot express an owner and the gate is
 * session-only — mints at that same session parity and says so in `reason`.
 *
 * B3 — an object that cannot be resolved to an owner is now REFUSED
 * (`reason: 'OWNER_UNRESOLVED'`) rather than minted at "any valid session"
 * parity. Losing the owner record is not a neutral state: it is what a delete
 * and a failed dual-write both produce, so parity there meant deleting a file
 * published it.
 *
 * @param {object|null} user `req.user`
 * @param {string} rel `/uploads`-relative path, decoded + normalized
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
async function authorizeUploadsObject(user, rel) {
    const { kind, sensitive } = classifyUploadsPath(rel);
    if (!sensitive) {
        return { allowed: true, reason: 'PUBLIC' };
    }
    if (!user) {
        return { allowed: false, reason: 'NO_SESSION' };
    }

    const fileUrl = `/uploads/${rel}`;

    try {
        if (kind === 'slip') {
            // Slip rail retired (Stripe-only) — no slip objects exist; deny.
            return { allowed: false, reason: 'SLIP_RETIRED' };
        }

        if (kind === 'root') {
            return resolveRootFileOwner(user, rel);
        }

        let owner = null;
        if (kind === 'draft') {
            owner = await resolveDraftOwner(fileUrl, rel);
        } else if (kind === 'audit') {
            owner = await resolveAuditEvidenceOwner(fileUrl);
        } else if (kind === 'car') {
            owner = await resolveCarDocumentOwner(fileUrl);
        }

        if (!owner) {
            // B3 — FAIL CLOSED. This used to return
            // `{ allowed: true, reason: 'SESSION_PARITY_UNRESOLVED' }` at parity
            // with a static gate that also passed unresolved objects through.
            // That parity was the bug: an object loses its owner record exactly
            // when it is deleted or when the best-effort dual-write fails, i.e.
            // precisely when nobody should be reading it. "We cannot tell whose
            // this is" is now a refusal on BOTH paths, so the mint stays no more
            // permissive than the gate.
            return { allowed: false, reason: 'OWNER_UNRESOLVED' };
        }
        if (!canSeeDraftDoc(user, owner)) {
            return { allowed: false, reason: 'OBJECT_ACL_DENIED' };
        }
        return { allowed: true, reason: 'OBJECT_ACL' };
    } catch (err) {
        // A lookup failure must not silently WIDEN access at mint time. The
        // static gate's own fail-SAFE pass-through is unchanged (availability of
        // an already-working session read); minting a NEW credential on a failed
        // check is a different risk, so this one fails closed.
        logger.error('[uploads-access] mint authorization lookup failed:', err?.message);
        return { allowed: false, reason: 'LOOKUP_FAILED' };
    }
}

module.exports = {
    gateSensitiveUploads,
    gateSlipObjectAccess,
    // W1-2 — shared with routes/api/files/files.js so the mint endpoint cannot
    // disagree with the static gate about paths or ACLs.
    decodeUploadsRel,
    classifyUploadsPath,
    authorizeUploadsObject,
    canSeeDraftDoc,
};
