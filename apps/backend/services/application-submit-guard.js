/**
 * M1 — the single submit gate: "who submits, in whose name".
 *
 * Every door that moves an application forward (POST /applications/submit,
 * bundle submit, revision-deadline submit, CAR submit) asks this one function
 * before it writes anything. It answers exactly two questions:
 *
 *   1. Does this application row name an entity at all?  No → 400
 *      VALIDATION_ERROR. An application with a null `entityId` has no legal
 *      submitter to check against, and the old behaviour (skip the gate when
 *      the caller sent no active-entity header) made the gate opt-out by
 *      omission (plan D7).
 *   2. May THIS user act for THAT entity?  The answer comes from the
 *      effective-permission engine primitive
 *      `assertEntityActionPermission` (entity-effective-permissions-service.js:403-426),
 *      which is already fail-closed and already applies REVOKE-wins over role
 *      defaults, legacy permission arrays and GRANT rows. No second permission
 *      model is invented here, and the denial keeps the engine's own code
 *      `ENTITY_PERMISSION_DENIED` (plan D5).
 *
 * The entity checked is the one on the APPLICATION ROW — never a value the
 * request supplies. Keying off a request value is how a member of entity A
 * could submit a draft belonging to entity B.
 *
 * Every rejection writes an AuditLog FAILURE row through `auditLogger.log()`,
 * which opens its OWN short transaction and takes its own advisory lock
 * (middleware/audit-logger.js:479,505-506). That is deliberate: the rejection
 * row must survive the caller's rollback, and it must NEVER be called from
 * inside another interactive transaction. `log()` swallows its own errors by
 * design (:526-541), so "every throw writes FAILURE" is best-effort — proven
 * on real DB in staging, not by this unit-level contract (plan D10).
 */

'use strict';

const { assertEntityActionPermission } = require('./entity-effective-permissions-service');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');
const { ENTITY_PERMISSION_DENIED_EN } = require('../shared/entity-permission-denied');

/** The capability every submit door gates on. */
const SUBMIT_PERMISSION = 'SUBMIT_APPLICATION';
/** Audit action name for a refused submit (category APPLICATION). */
const SUBMIT_DENIED_ACTION = 'APPLICATION_SUBMIT_DENIED';

/** Sentinel for the NOT-NULL audit columns when the caller has no value. */
const UNKNOWN_ACTOR = 'UNKNOWN';

const VALIDATION_ERROR = 'VALIDATION_ERROR';
/** Reused verbatim from the engine — a new synonym would fork the contract. */
const PERMISSION_DENIED = 'ENTITY_PERMISSION_DENIED';

/**
 * Refusal carrying an HTTP shape. `status` is what the plan's contract and the
 * route handlers read; `statusCode`/`httpStatus` mirror it so the shared
 * sendServiceError mapper does not fall back to 500.
 */
class SubmitGuardError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'SubmitGuardError';
        this.status = status;
        this.statusCode = status;
        this.httpStatus = status;
        this.code = code;
    }
}

/**
 * Best-effort FAILURE row. Never throws: an audit outage must not turn a 403
 * into a 500, and must not mask the refusal itself.
 */
async function writeDenialAudit({ userId, application, entityId, auditContext, status, code, reason, permission = SUBMIT_PERMISSION }) {
    const ctx = auditContext || {};
    try {
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action: SUBMIT_DENIED_ACTION,
            severity: AuditSeverity.WARNING,
            // actorId / actorRole / resourceType / resourceId are NOT NULL on
            // AuditLog (prisma/schema/audit.prisma:22,25,28,29) and log()
            // swallows the insert error — a null here would silently DROP the
            // refusal row instead of raising. UNKNOWN is the existing sentinel
            // (routes/api/identity/mfa.js:384).
            actorId: userId || UNKNOWN_ACTOR,
            actorType: ctx.actorType || 'USER',
            actorRole: ctx.actorRole || UNKNOWN_ACTOR,
            resourceType: ResourceType.APPLICATION,
            resourceId: application?.id || UNKNOWN_ACTOR,
            ipAddress: ctx.ipAddress || null,
            userAgent: ctx.userAgent || null,
            organizationId: ctx.organizationId ?? null,
            result: 'FAILURE',
            errorCode: code,
            errorMessage: reason,
            metadata: {
                // The heart of AC3: in whose name was this attempted. The holder
                // alone; no workspace field (R2 Task 9, spec §3.2 Submit).
                onBehalfOfEntityId: entityId || null,
                // What the refusal is about: SUBMIT_APPLICATION, or the certificate
                // holder rule for a RENEWAL/REPLACEMENT claim.
                permission,
                applicationId: application?.id || null,
                route: ctx.route || null,
                httpStatus: status,
                reason: code,
            },
        });
    } catch (auditErr) {
        // auditLogger.log() already console-falls-back internally; this catch
        // only covers a failure of the call itself (e.g. the module missing).
        console.error('[submit-guard] denial audit write failed', {
            applicationId: application?.id || null,
            code,
            error: auditErr?.message,
        });
    }
}

/**
 * The gate.
 *
 * @param {object} args
 * @param {string} args.userId            the human pressing submit
 * @param {object} args.application       the application ROW (needs id + entityId)
 * @param {object} [args.auditContext]    { actorRole, actorType, ipAddress, userAgent, organizationId, route }
 * @param {object} [args.prisma]          optional client passed through to the engine
 * @param {object} [args.holderScope]     the door's holder scope, for the certificate read
 * @returns {Promise<{ entityId: string }>} the entity the submit acts for
 * @throws {SubmitGuardError} 400 VALIDATION_ERROR | 403 ENTITY_PERMISSION_DENIED |
 *         422 RENEWAL_HOLDER_MISMATCH
 *
 * Every submit door calls this, so the RENEWAL/REPLACEMENT holder rule (operator ruling
 * 2026-10-03, review round 2) lives here too: a filing that claims an earlier certificate
 * is refused unless that certificate belongs to the filing's own holder. Callers must pass
 * the row WITH formData (each door's row carries it); a row without formData makes no
 * claim the guard can see. The renewals door passes a synthetic row for the source
 * application (no formData): the renewal it creates takes the certificate's holder by
 * construction.
 */
async function assertSubmitAllowed({ userId, application, auditContext, prisma, holderScope = null } = {}) {
    const app = application || {};
    const entityId = String(app.entityId || '').trim();
    const actorId = String(userId || '').trim();

    if (!entityId) {
        const message = 'คำขอนี้ยังไม่ได้ระบุผู้ยื่นตามกฎหมาย (entity) จึงยื่นไม่ได้';
        await writeDenialAudit({
            userId: actorId, application: app, entityId: null, auditContext,
            status: 400, code: VALIDATION_ERROR, reason: 'application has no entityId',
        });
        throw new SubmitGuardError(400, VALIDATION_ERROR, message);
    }

    if (!actorId) {
        // No identified actor = nobody to check. Fail closed rather than let
        // an anonymous path fall through to the engine's own arg validation.
        await writeDenialAudit({
            userId: null, application: app, entityId, auditContext,
            status: 403, code: PERMISSION_DENIED, reason: 'no actor on the submit request',
        });
        throw new SubmitGuardError(403, PERMISSION_DENIED, ENTITY_PERMISSION_DENIED_EN);
    }

    try {
        await assertEntityActionPermission({
            entityId,
            userId: actorId,
            permission: SUBMIT_PERMISSION,
            prisma,
        });
    } catch (err) {
        // Fail closed on ANY rejection: the engine's canonical denial and an
        // unexpected fault (pool exhaustion, mis-wired mock) both mean "not
        // proven allowed". The code stays the engine's own (plan D5).
        await writeDenialAudit({
            userId: actorId, application: app, entityId, auditContext,
            status: 403, code: PERMISSION_DENIED,
            reason: err?.code === PERMISSION_DENIED
                ? 'effective permission set lacks SUBMIT_APPLICATION'
                : `permission check failed: ${err?.message || 'unknown error'}`,
        });
        throw new SubmitGuardError(403, PERMISSION_DENIED, ENTITY_PERMISSION_DENIED_EN);
    }

    await assertRenewalHolderMatches({ userId: actorId, application: app, auditContext, holderScope, prisma });

    return { entityId };
}

const RENEWAL_ALREADY_IN_PROGRESS = 'RENEWAL_ALREADY_IN_PROGRESS';

/**
 * One renewal or replacement per certificate at a time (re-review of the operator
 * ruling 2026-10-03: every member with SUBMIT_APPLICATION on the holder may renew,
 * so two members could each start one, each with its own quotation).
 *
 * In flight = a live (not soft-deleted) application whose formData links one of
 * `certificateIds` (renewalOf or replacementOf) and whose status is neither one of
 * the status writer's TERMINAL_STATUSES nor DRAFT. A DRAFT claim was never filed (no
 * quotation, nothing to pay): counting it would let an abandoned draft block every
 * member of the holder for good. `excludeApplicationId` leaves the filing being
 * submitted out. A health caller's read carries its holder fragment (the in-flight
 * filing is under the same holder, which the caller may read).
 * @param {object} args
 * @param {object} args.db             prisma client or transaction client
 * @param {string[]} args.certificateIds
 * @param {?string} [args.excludeApplicationId]
 * @param {?object} [args.holderScope]
 * @returns {Promise<?{ id: string }>}
 */
async function findInFlightSuccession({ db, certificateIds, excludeApplicationId = null, holderScope = null } = {}) {
    const ids = [...new Set((certificateIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (ids.length === 0) { return null; }
    // Lazy: the status writer is a large module; only its terminal set is needed here.
    const { TERMINAL_STATUSES } = require('./application-status-writer');
    const { holderReadWhereIfScoped } = require('./holder-access');
    return db.application.findFirst({
        where: {
            ...holderReadWhereIfScoped(holderScope, 'Application'),
            isDeleted: false,
            status: { notIn: [...TERMINAL_STATUSES, 'DRAFT'] },
            ...(excludeApplicationId ? { NOT: { id: String(excludeApplicationId) } } : {}),
            AND: [{
                OR: ids.flatMap((id) => [
                    { formData: { path: ['renewalOf'], equals: id } },
                    { formData: { path: ['replacementOf'], equals: id } },
                ]),
            }],
        },
        select: { id: true },
    });
}

/** The certificate ids a filing claims to succeed (renewalOf / replacementOf), sorted. */
function claimedSuccessionIds(formData) {
    const fd = formData && typeof formData === 'object' ? formData : {};
    return [...new Set([fd.renewalOf, fd.replacementOf].map((id) => String(id || '').trim()).filter(Boolean))].sort();
}

/**
 * Per-certificate advisory locks for a succession (renewal / replacement), held to
 * the end of the transaction `tx` (pg_advisory_xact_lock). The renewal door and every
 * submit transaction of a succession claim take these as the FIRST statement of the
 * transaction, one key per certificate (`renewal:<certificateId>`), in ascending id
 * order. Lock ordering: no transaction that takes them holds a row lock yet (the
 * ordered-draft FOR UPDATE and the checkout locks are taken by other transactions that
 * never wait on these keys, or later in this one), and two transactions take their
 * keys in the same order, so no wait cycle can form.
 * @param {object} tx                 interactive transaction client
 * @param {string[]} certificateIds
 */
async function lockCertificateSuccessions(tx, certificateIds) {
    const ids = [...new Set((certificateIds || []).map((id) => String(id || '').trim()).filter(Boolean))].sort();
    if (typeof tx?.$executeRaw !== 'function') { return; }
    for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop -- keys must be taken one by one, in order
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`renewal:${id}`}))`;
    }
}

/**
 * Inside a submit transaction, before anything else: lock the claimed certificates and
 * refuse (409 RENEWAL_ALREADY_IN_PROGRESS, audit row) when another filing of one of them
 * is in flight. A filing that claims no certificate passes untouched.
 * @param {object} tx
 * @param {{ application: object, userId?: string, holderScope?: object, auditContext?: object }} args
 */
async function lockAndAssertNoSuccessionInFlight(tx, { application, userId = null, holderScope = null, auditContext = null } = {}) {
    const ids = claimedSuccessionIds(application?.formData);
    if (ids.length === 0) { return; }
    await lockCertificateSuccessions(tx, ids);
    const other = await findInFlightSuccession({ db: tx, certificateIds: ids, excludeApplicationId: application.id, holderScope });
    if (!other) { return; }
    await writeDenialAudit({
        userId: String(userId || '').trim() || null, application, entityId: application.entityId || null, auditContext,
        status: 409, code: RENEWAL_ALREADY_IN_PROGRESS, permission: HOLDER_RULE,
        reason: `succession while application ${other.id} of the same certificate is in flight`,
    });
    throw renewalInProgressError();
}

/** The refusal both doors answer with (renewal door 409, submit guard 409). */
function renewalInProgressError() {
    const { ERROR_CODES } = require('../shared/error-codes');
    return new SubmitGuardError(409, RENEWAL_ALREADY_IN_PROGRESS, ERROR_CODES.RENEWAL_ALREADY_IN_PROGRESS.messageTh);
}

/** A renewal or replacement of a certificate held by another holder (operator ruling 2026-10-03). */
const RENEWAL_HOLDER_MISMATCH = 'RENEWAL_HOLDER_MISMATCH';
/** The claims that succeed an existing certificate and so remove requirements. */
const SUCCESSION_CLAIMS = Object.freeze(['RENEWAL', 'REPLACEMENT']);
/** metadata.permission on the holder-rule refusal row: what was actually checked. */
const HOLDER_RULE = 'CERTIFICATE_HOLDER_MATCH';

/**
 * The submit-time half of "a renewal is a submission" (operator ruling 2026-10-03).
 *
 * The draft door judges a renewal claim when it is made; membership can change before
 * submit, and a draft judged by older code may carry a renewal of another holder's
 * certificate. So, for a filing that claims to succeed a certificate (RENEWAL or
 * REPLACEMENT, read the way the requirement engine and quotation-service read it: the
 * requestType word OR a renewalOf / replacementOf link), every linked certificate's
 * holder (its application.entityId) must be the filing's own entityId. SUBMIT_APPLICATION
 * on that holder is then exactly what assertSubmitAllowed has already checked on the row.
 * A claim that names no certificate is refused too: nothing proves it.
 *
 * Called by assertSubmitAllowed after the permission check, so every submit door gets it
 * BEFORE any write. A filing that claims neither
 * passes untouched. Refusal: 422 RENEWAL_HOLDER_MISMATCH (the code covers replacement
 * as well) and the same APPLICATION_SUBMIT_DENIED audit row as every other submit refusal.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {object} args.application   the row (id, entityId, formData)
 * @param {object} [args.auditContext]
 * @param {object} [args.holderScope] the door's holder scope
 * @param {object} [args.prisma]      client for the certificate read (default: prisma-database)
 * @returns {Promise<void>}
 * @throws {SubmitGuardError} 422 RENEWAL_HOLDER_MISMATCH
 */
async function assertRenewalHolderMatches({ userId, application, auditContext, holderScope = null, prisma: injected } = {}) {
    const app = application || {};
    const formData = app.formData && typeof app.formData === 'object' ? app.formData : {};
    const requestType = String(formData.requestType || '').trim().toUpperCase();
    const linkedIds = [...new Set([formData.renewalOf, formData.replacementOf]
        .map((id) => String(id || '').trim())
        .filter(Boolean))];
    const claimsSuccession = SUCCESSION_CLAIMS.includes(requestType) || linkedIds.length > 0;
    if (!claimsSuccession) {
        return;
    }
    const filingEntityId = String(app.entityId || '').trim();
    const holders = [];
    if (linkedIds.length > 0) {
        const db = injected || require('./prisma-database').prisma;
        const { holderReadWhereIfScoped } = require('./holder-access');
        for (const certificateId of linkedIds) {
            // A health door passes its holder scope: a certificate outside it reads as
            // no holder, which the rule below refuses (fail closed).
            const cert = await db.certificate.findFirst({
                where: {
                    id: certificateId,
                    isDeleted: false,
                    ...holderReadWhereIfScoped(holderScope, 'Certificate'),
                },
                select: { application: { select: { entityId: true } } },
            });
            holders.push(cert?.application?.entityId || null);
        }
    }
    const certHolder = holders.find((h) => h) || null;
    if (filingEntityId && holders.length > 0 && holders.every((h) => h === filingEntityId)) {
        // Same holder: refuse only when another renewal/replacement of the certificate
        // is already in flight (one per certificate, RENEWAL_ALREADY_IN_PROGRESS).
        const db = injected || require('./prisma-database').prisma;
        const other = await findInFlightSuccession({
            db, certificateIds: linkedIds, excludeApplicationId: app.id, holderScope,
        });
        if (!other) {
            return;
        }
        await writeDenialAudit({
            userId: String(userId || '').trim() || null, application: app, entityId: filingEntityId, auditContext,
            status: 409, code: RENEWAL_ALREADY_IN_PROGRESS, permission: HOLDER_RULE,
            reason: `${requestType || 'succession'} while application ${other.id} of the same certificate is in flight`,
        });
        throw renewalInProgressError();
    }
    await writeDenialAudit({
        userId: String(userId || '').trim() || null, application: app, entityId: filingEntityId || null, auditContext,
        status: 422, code: RENEWAL_HOLDER_MISMATCH, permission: HOLDER_RULE,
        reason: certHolder
            ? `${requestType || 'succession'} of a certificate held by another holder`
            : `${requestType || 'succession'} names no readable certificate holder`,
    });
    throw new SubmitGuardError(
        422,
        RENEWAL_HOLDER_MISMATCH,
        'ใบรับรองเดิมออกในนามผู้ถือรายอื่น จึงยื่นต่ออายุหรือขอใบแทนในนามนี้ไม่ได้ กรุณายื่นในนามผู้ถือใบรับรองใบนั้น',
    );
}

module.exports = {
    assertSubmitAllowed,
    assertRenewalHolderMatches,
    RENEWAL_HOLDER_MISMATCH,
    RENEWAL_ALREADY_IN_PROGRESS,
    findInFlightSuccession,
    renewalInProgressError,
    lockCertificateSuccessions,
    lockAndAssertNoSuccessionInFlight,
    // The renewals door writes the same refusal row (renewal-service).
    recordSubmitDenial: writeDenialAudit,
    SubmitGuardError,
    SUBMIT_PERMISSION,
    SUBMIT_DENIED_ACTION,
};
