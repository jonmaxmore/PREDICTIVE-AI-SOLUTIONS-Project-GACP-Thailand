/**
 * Renewal Service — Iter 26 (2026-05-16).
 *
 * Annual re-certification workflow for GACP farmers whose existing
 * certificate is approaching expiry. A renewal application carries the marker
 * `formData.renewalOf = originalCertificateId` and pre-filled farm +
 * cultivation data from the source application, so the UI can show a
 * "ต่ออายุใบรับรอง" indicator and apply different copy.
 *
 * W12 (operator ruling 2026-08-22, final - the change log @ 67ef3612):
 *   "ต่ออายุ 30,000 ครั้งเดียว และไม่ตรวจเอกสาร นัดลงพื้นที่อย่างเดียว"
 * A renewal NO LONGER travels the same canonical states as a new application.
 * Until this change it did - created DRAFT, then DRAFT -> SUBMITTED ->
 * PENDING_DOC_FEE -> DOC_FEE_PAID -> ASSIGNED_FOR_REVIEW -> DOC_APPROVED before
 * it ever reached the audit half - and the only difference was the marker.
 * There is no document-review stage in a renewal any more, and no document fee.
 *
 *     ┌──────────────────────────────────────────────────────────────┐
 *     │ Original Cert (ACTIVE, expiryDate ≈ T+30d)                    │
 *     │     │                                                          │
 *     │     │  HEALTH applicant POST /api/applications/renewals       │
 *     │     ▼                                                          │
 *     │  Application (PENDING_AUDIT_FEE, formData.renewalOf = origCert)│
 *     │     │                                                          │
 *     │     │  …one payment, then site visit. No document review…     │
 *     │     ▼                                                          │
 *     │  Application (CERTIFIED)  →  new Certificate                  │
 *     │                              ├── previousCertificateId = orig │
 *     │                              └── (original cert SUPERSEDED)   │
 *     └──────────────────────────────────────────────────────────────┘
 *
 * Reminder cadence (60/30/15 days before expiry) is driven by
 * `getApplicationsForRenewalReminder` (read) + `markRenewalReminderSent`
 * (idempotent write). The cron lives at apps/backend/cron/renewal-reminder-cron.js
 * and the dispatcher uses notification-fanout-service.
 *
 * Storage note (NO Prisma migration in Iter 26):
 *   - The Certificate model has `renewedCertificateId` and
 *     `previousCertificateId` columns already (see certification.prisma).
 *     We reuse those.
 *   - Reminders-sent state is stored on the **owning Application's**
 *     `formData.renewalReminders[]` (the Application that produced the
 *     expiring Certificate). This keeps the idempotency record close to
 *     the workflow record that already accepts JSON extensions, and
 *     avoids touching the certificate-service writer or the Prisma
 *     schema. The shape is:
 *         formData.renewalReminders = [
 *           { type: 'D60', sentAt: '2026-03-17T02:00:00Z', certId, dispatchId? },
 *           { type: 'D30', sentAt: '2026-04-16T02:00:00Z', certId, dispatchId? },
 *           { type: 'D15', sentAt: '2026-05-01T02:00:00Z', certId, dispatchId? },
 *         ]
 *   - Supersession of the OLD certificate when the new one is CERTIFIED
 *     is also written as JSON on the OLD certificate's parent
 *     Application.formData.supersededBy = { certificateId, supersededAt }
 *     and on the OLD certificate's status string transitions to 'renewed'
 *     (already a documented value in the schema, see certification.prisma
 *     line 47 comment).
 *
 * @module services/renewal-service
 */

'use strict';

const logger = require('../shared/logger');
const crypto = require('crypto');
// The ONE function that decides what counts as a cultivation scope. Required
// from the billing barrel (the `gacp/no-cross-module-internal` rule forbids
// reaching into modules/billing/internal directly) so this file cannot grow a
// second opinion about the number the quotation and the checkout both price on.
const { resolveCultivationScopeCount } = require('../modules/billing');

let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

const certificateService = require('./certificate-service');
const { localYear, getZonedParts, startOfLocalCalendarDay } = require('../utils/working-days');
// R2 Task 8 fix round 1: the renewal's reads carry the caller's holder scope (spec 2026-09-30 §3.1).
const { holderReadWhereIfScoped } = require('./holder-access');

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Reminder cadence — 60 / 30 / 15 days before expiry. The cron evaluates
 * each tier daily and skips already-sent tiers (idempotent).
 */
const REMINDER_DAYS = Object.freeze([60, 30, 15]);

const REMINDER_TYPES = Object.freeze({
    D60: 'D60',
    D30: 'D30',
    D15: 'D15',
});

const REMINDER_TYPE_BY_DAYS = Object.freeze({
    60: REMINDER_TYPES.D60,
    30: REMINDER_TYPES.D30,
    15: REMINDER_TYPES.D15,
});

/**
 * Certificate status values per certification.prisma comment on line 47:
 *   active, expired, revoked, renewed
 * "renewed" is the supersession marker we set when a new cert takes over.
 */
const CERT_STATUS = Object.freeze({
    ACTIVE: 'active',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
    RENEWED: 'renewed', // = SUPERSEDED in business language
});

// ── Errors ─────────────────────────────────────────────────────────────────

function makeError(code, message, statusCode = 400, extra) {
    const err = new Error(message);
    err.code = code;
    err.statusCode = statusCode;
    if (extra) {err.data = extra;}
    return err;
}

function resolvePrisma(injected) {
    if (injected) {return injected;}
    return prismaModule && prismaModule.prisma ? prismaModule.prisma : null;
}

// ── Pure helpers ───────────────────────────────────────────────────────────

function _safeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {return {};}
    return value;
}

function _safeArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Compute the [start, end) window that captures certificates expiring on
 * exactly `daysBeforeExpiry` days from `now`. Window is a 24-hour bucket
 * around the target date (00:00 → next-day 00:00 in Bangkok, named
 * explicitly — the containers' process clock is UTC).
 */
function _expiryWindow(now, daysBeforeExpiry) {
    // A Bangkok day `daysBeforeExpiry` days after today's Bangkok day.
    const { year, month, day } = getZonedParts(now);
    const offset = Number.parseInt(daysBeforeExpiry, 10);
    const target = startOfLocalCalendarDay(year, month, day + offset);
    const next = startOfLocalCalendarDay(year, month, day + offset + 1);
    return { start: target, end: next };
}

/**
 * Build the carry-forward subset of formData from the original application.
 * We deliberately keep this narrow: farm info + cultivation_methods.
 * Documents, audit history, payment status and any per-cycle data are NOT
 * copied — those must be re-submitted for the new cycle.
 */
function _buildCarryForwardFormData(sourceFormData) {
    const src = _safeObject(sourceFormData);
    const carried = {};

    // Farm info — narrow allow-list of keys we know are stable across cycles.
    const FARM_KEYS = [
        'farmData', 'farmName', 'farmId', 'plantName', 'plantSpecies',
        'locationData', 'locationType', 'areaType',
        'productionData', 'plots', 'totalArea',
    ];
    for (const key of FARM_KEYS) {
        if (Object.prototype.hasOwnProperty.call(src, key)) {
            carried[key] = src[key];
        }
    }

    // Cultivation methods — first-class subset.
    if (src.cultivation_methods !== undefined) {
        carried.cultivation_methods = src.cultivation_methods;
    }
    if (src.cultivationMethods !== undefined) {
        carried.cultivationMethods = src.cultivationMethods;
    }
    if (src.cultivationMethod !== undefined) {
        carried.cultivationMethod = src.cultivationMethod;
    }

    return carried;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Create a renewal application for an existing certificate.
 *
 * Validates:
 *   - originalCertificateId exists and is not soft-deleted
 *   - certificate is ACTIVE (not expired / revoked / renewed/superseded)
 *   - certificate has NOT already passed expiryDate
 *   - the certificate is within the actor's holder scope (404 otherwise)
 *   - the actor holds SUBMIT_APPLICATION on the certificate's holder entity
 *     (operator ruling 2026-10-03: any such member may renew, not only the
 *     original filer; the renewal is filed under the source holder by the actor)
 *     (operator ruling 2026-10-03: a renewal is a submission); a certificate
 *     with no holder is refused APPLICATION_HOLDER_REQUIRED
 *
 * Creates:
 *   - A new Application (DRAFT) with:
 *       healthId       = original applicant's canonicalId
 *       organizationId = original application's organizationId
 *       formData       = carry-forward subset + renewalOf marker
 *
 * The applicant continues editing from DRAFT exactly as for a fresh
 * application — the only behavioural difference is the marker. The
 * workflow itself is unchanged.
 *
 * @param {object} args
 * @param {string} args.originalCertificateId  — Certificate.id
 * @param {string} args.actorId                — HEALTH user.id (must own cert)
 * @param {object} [args.holderScope]          — the renewals door's holder scope
 * @param {object} [args.prisma]               — injected prisma (tests)
 * @returns {Promise<{ applicationId: string, renewalOf: string, draftedAt: string }>}
 */
/**
 * Where a renewal enters the workflow, and why not one state later.
 *
 * The site-visit scheduling queue is AUDIT_FEE_PAID - audit-scheduling-service
 * exports it as SCHEDULING_QUEUE_STATUS, getSchedulingQueue selects on it and
 * assignAuditor refuses anything else. That is the state the ruling points at.
 *
 * A renewal is NOT created there. An application only reaches AUDIT_FEE_PAID
 * through a SETTLED payment: checkout-settlement-service maps the phase-2
 * checkout to it on a verified webhook, and payment-slip-service reaches it
 * when an accountant approves a slip. Creating a renewal directly in
 * AUDIT_FEE_PAID would carry it through the money gate without anyone paying -
 * a free certificate, arrived at by writing a string into a column.
 *
 * So a renewal starts one state earlier, at the payment gate itself. From here
 * the existing settlement paths carry it to AUDIT_FEE_PAID exactly as they
 * carry a new application: no new edge, and not one line of settlement code
 * changed (L3). What the renewal skips is everything BEFORE this gate - the
 * document fee and the document review.
 */
const RENEWAL_ENTRY_STATE = 'PENDING_AUDIT_FEE';

/**
 * The states a renewal no longer walks. Recorded on the application and in the
 * audit trail so the jump is a documented policy decision a reviewer can read
 * back, rather than an application that mysteriously starts in the middle.
 */
const RENEWAL_SKIPPED_STATES = Object.freeze([
    'SUBMITTED',
    'PENDING_DOC_FEE',
    'DOC_FEE_PAID',
    'ASSIGNED_FOR_REVIEW',
    'DOC_APPROVED',
]);

/** Cites the ruling that authorises the skip, so the row explains itself. */
const RENEWAL_SKIP_REASON = 'RENEWAL_FAST_PATH_OPERATOR_RULING_2026_08_22';

/**
 * Create the renewal of an ACTIVE certificate the actor filed, for a holder the actor may file for.
 *
 * R2 Task 8 fix round 1 (spec 2026-09-30 §3.2 + C3): the renewal is filed for the
 * SOURCE application's holder, and that is decided before anything is written —
 * no application, no quotation, no audit row:
 *   - the source names no holder → 400 APPLICATION_HOLDER_REQUIRED (never healed
 *     to the actor's personal entity; heal-null-holders.js places legacy rows);
 *   - the actor lacks SUBMIT_APPLICATION on the holder → 403 ENTITY_PERMISSION_DENIED
 *     (operator ruling 2026-10-03: a renewal is a submission; was `editIds` in R2 Task 8).
 * Both refusals write the APPLICATION_SUBMIT_DENIED audit row (application-submit-guard).
 * The holder is read through the certificate's own relation, so no read filter
 * on Application can hide a null-holder source and turn the refusal into a 500.
 *
 * R2 Task 12: the certificate is read within the actor's holder scope (spec
 * 2026-09-30 §3.1), so a certificate outside it (or with no holder) is 404
 * CERT_NOT_FOUND; the filer check and SUBMIT_APPLICATION then both apply.
 * @param {object} args
 * @param {{ readIds: string[], editIds: string[] }} args.holderScope — holderScope(req); required
 */
async function createRenewalApplication({ originalCertificateId, actorId, actorRole, holderScope, prisma: injectedPrisma } = {}) {
    if (!originalCertificateId) {
        throw makeError('VALIDATION_ERROR', 'originalCertificateId is required');
    }
    if (!actorId) {
        throw makeError('VALIDATION_ERROR', 'actorId is required');
    }
    if (!holderScope || !Array.isArray(holderScope.editIds)) {
        throw new TypeError('createRenewalApplication: holderScope (holderScope(req)) is required');
    }

    const prisma = resolvePrisma(injectedPrisma);
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const cert = await prisma.certificate.findFirst({
        where: {
            id: originalCertificateId,
            isDeleted: false,
            ...holderReadWhereIfScoped(holderScope, 'Certificate'),
        },
        select: {
            id: true,
            userId: true,
            applicationId: true,
            status: true,
            expiryDate: true,
            certificateNumber: true,
            farmId: true,
            organizationId: true,
            // The holder, through the relation (see the docblock).
            application: { select: { entityId: true } },
        },
    });

    if (!cert) {
        throw makeError('CERT_NOT_FOUND', 'Original certificate not found', 404, {
            originalCertificateId,
        });
    }

    // The holder decides before anything is written (R2 Task 8 fix round 1), and a
    // renewal is a submission (operator ruling 2026-10-03): the actor needs
    // SUBMIT_APPLICATION on the certificate's holder. Being the original filer, or
    // merely being able to edit for the holder, is not enough: a VIEWER, or a MANAGER
    // without the grant, may not file for the holder. Refusals write the same
    // APPLICATION_SUBMIT_DENIED audit row as the submit doors, against the source
    // application (no renewal row exists yet).
    const holderEntityId = cert.application?.entityId || null;
    const submitGuard = require('./application-submit-guard');
    const auditContext = {
        actorRole: actorRole || 'HEALTH',
        organizationId: cert.organizationId || null,
        route: 'POST /api/applications/renewals',
    };
    const sourceRef = { id: cert.applicationId, entityId: holderEntityId };
    if (!holderEntityId) {
        await submitGuard.recordSubmitDenial({
            userId: actorId, application: sourceRef, entityId: null, auditContext,
            status: 400, code: 'APPLICATION_HOLDER_REQUIRED', reason: 'renewal of a certificate with no holder',
        });
        throw makeError(
            'APPLICATION_HOLDER_REQUIRED',
            'ใบรับรองนี้ยังไม่ระบุผู้ถือ จึงต่ออายุไม่ได้ กรุณาติดต่อเจ้าหน้าที่เพื่อแก้ข้อมูลผู้ถือก่อน',
            400,
        );
    }
    // 403 ENTITY_PERMISSION_DENIED (SubmitGuardError, catalogue English message; the
    // renewals door answers with the single entityPermissionDeniedBody).
    await submitGuard.assertSubmitAllowed({ userId: actorId, application: sourceRef, auditContext });

    const status = String(cert.status || '').toLowerCase();
    if (status !== CERT_STATUS.ACTIVE) {
        throw makeError(
            'CERT_NOT_ACTIVE',
            `Cannot renew certificate in status "${cert.status}". Only ACTIVE certificates are renewable.`,
            409,
            { currentStatus: cert.status },
        );
    }

    const now = new Date();
    if (cert.expiryDate && new Date(cert.expiryDate).getTime() <= now.getTime()) {
        throw makeError(
            'CERT_ALREADY_EXPIRED',
            'Certificate has already expired; a new application is required',
            409,
            { expiryDate: cert.expiryDate },
        );
    }

    // Pull the source application so we can carry forward farm / cultivation
    // metadata. The source app is the one that the cert was issued from.
    const sourceApp = await prisma.application.findFirst({
        where: {
            id: cert.applicationId,
            isDeleted: false,
            ...holderReadWhereIfScoped(holderScope, 'Application'),
        },
        select: {
            id: true,
            healthId: true,
            entityId: true,
            organizationId: true,
            areaType: true,
            applicationNumber: true,
            formData: true,
        },
    });

    if (!sourceApp) {
        throw makeError(
            'SOURCE_APP_NOT_FOUND',
            'Certificate is not linked to a readable application',
            500,
        );
    }

    const carriedFormData = _buildCarryForwardFormData(sourceApp.formData);
    const renewalFormData = {
        ...carriedFormData,
        renewalOf: cert.id,
        renewalOfCertificateNumber: cert.certificateNumber,
        renewalOfExpiryDate: cert.expiryDate ? new Date(cert.expiryDate).toISOString() : null,
        renewalSourceApplicationId: sourceApp.id,
        workflowState: RENEWAL_ENTRY_STATE,
        workflowStateUpdatedAt: now.toISOString(),
        // W12 provenance. Written here as well as to the audit trail on purpose:
        // an audit-sink outage must degrade the trail, never erase the reason a
        // row that skipped document review is sitting at the payment gate.
        documentReviewSkipped: true,
        documentReviewSkipReason: RENEWAL_SKIP_REASON,
        workflowStatesSkipped: [...RENEWAL_SKIPPED_STATES],
        workflowEntryState: RENEWAL_ENTRY_STATE,
    };

    // Application.applicationNumber is unique. Pre-issue a renewal-prefixed
    // number so test asserts and admin searches are easy.
    //
    // W12: this used to say the applications-router consolidator
    // (ensureApplicationNumber) would normalise it on SUBMIT. A renewal no
    // longer passes through SUBMITTED, so nothing normalises it later and this
    // number is the one the applicant keeps. Left as-is deliberately - a
    // GACP-REN- prefix is more honest for a renewal than a new-application
    // number would be - and flagged in the W12 report for the operator.
    const yearBE = localYear(now) + 543; // Bangkok year
    const placeholderNumber = `GACP-REN-${yearBE}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // F-G4-64 — how many cultivation scopes this renewal is billed for, resolved
    // from the SAME formData every other money surface resolves it from.
    //
    // Until this line the renewal row carried no scope count at all. The legacy
    // wizard submit door stamped it for a new application (application-submission-
    // methods.js, deleted with /api/wizard in R2 Task 10); a renewal never passed
    // through it, so the column stayed NULL and `totalAreaTypes` took its schema
    // default of 1 (prisma/schema/application.prisma:80).
    //
    // That silence was not neutral, because the two ends of the renewal read it
    // differently:
    //   - the QUOTATION reads the stored column and, finding none, passes an
    //     EXPLICIT { scopeCount: 1 } (quotation-service.js:278), which
    //     resolveCultivationScopeCount honours OVER the declared cultivation
    //     methods (modules/billing/internal/fee-service.js:107-111);
    //   - the CHECKOUT passes no explicit count at all, so the same function
    //     derives it from formData.cultivationMethods
    //     (stripe-checkout-service.js:137; the cultivationScopeCount key on that
    //     feeContext is documented inert at :121-125).
    // A two-method renewal was therefore quoted 35,310 THB and charged 70,620.
    //
    // Stamping the column makes both ends read one number. It is a WRITE OF THE
    // COUNT, not a change to the price formula: the rate, the arithmetic and
    // buildPhaseFee are untouched, and a single-method renewal still resolves 1.
    const renewalScopeCount = resolveCultivationScopeCount(renewalFormData);

    // Operator ruling 2026-10-03: the renewal is filed by the member who renews it
    // (their own lists, notifications and payments), under the source holder.
    // Application.healthId is the FK to User.canonicalId.
    const actorUser = await prisma.user.findUnique({ where: { id: actorId }, select: { canonicalId: true } });
    const actorFilerKey = String(actorUser?.canonicalId || '').trim();
    if (!actorFilerKey) {
        throw makeError('VALIDATION_ERROR', 'The renewing account has no health identity', 400);
    }

    const createPayload = {
        healthId: actorFilerKey,
        submitterId: actorId,
        organizationId: sourceApp.organizationId,
        status: RENEWAL_ENTRY_STATE,
        applicationNumber: placeholderNumber,
        areaType: sourceApp.areaType || null,
        formData: renewalFormData,
        cultivationScopeCount: renewalScopeCount,
        // `totalAreaTypes` is the retired name for the same number, written in
        // step by every other writer (application-draft-query-methods.js; the
        // deleted application-submission-methods.js did too) so a process still serving the
        // previous image prices correctly. storedCultivationScopeCount falls
        // back to it (shared/application-scope.js:29); the contract migration
        // drops it.
        totalAreaTypes: renewalScopeCount,
        createdBy: actorId,
        updatedBy: actorId,
    };
    // The holder checked above (the source's own, never a default).
    createPayload.entityId = holderEntityId;

    // One renewal or replacement per certificate at a time (RENEWAL_ALREADY_IN_PROGRESS).
    // The check and the create run in one transaction behind a per-certificate advisory
    // lock, so two concurrent requests cannot both pass the check.
    const createOnce = async (tx) => {
        // The same key and order as every submit of a succession claim (submit guard).
        await submitGuard.lockCertificateSuccessions(tx, [cert.id]);
        const other = await submitGuard.findInFlightSuccession({ db: tx, certificateIds: [cert.id], holderScope });
        if (other) { return { inFlight: other }; }
        return { created: await tx.application.create({ data: createPayload }) };
    };
    const outcome = typeof prisma.$transaction === 'function'
        ? await prisma.$transaction(createOnce)
        : await createOnce(prisma);
    if (outcome.inFlight) {
        await submitGuard.recordSubmitDenial({
            userId: actorId, application: sourceRef, entityId: holderEntityId, auditContext,
            status: 409, code: submitGuard.RENEWAL_ALREADY_IN_PROGRESS,
            reason: `renewal while application ${outcome.inFlight.id} of the same certificate is in flight`,
        });
        const refusal = submitGuard.renewalInProgressError();
        throw makeError(refusal.code, refusal.message, 409);
    }
    const newApp = outcome.created;

    logger.info('[renewal-service] Renewal application created', {
        renewalApplicationId: newApp.id,
        originalCertificateId: cert.id,
        entryState: RENEWAL_ENTRY_STATE,
        actorId,
    });

    // F-G4-64 — a renewal never passes through either submit door, so neither
    // issueQuotationsForApplication call site (applications.js:1211,
    // application-review-revision-methods.js:317) fires for it. It enters at
    // PENDING_AUDIT_FEE, which is an M2-payable state, so with the acceptance
    // gate fail-closed an unquoted renewal could not be paid at all.
    // quotation-service already prices a renewal correctly (one PHASE_2
    // instalment at the renewal rate) — it was simply never called.
    //
    // Awaited and reported, not fire-and-forget (R3): the application row is
    // already committed and is NOT rolled back, but the caller is told, the
    // same way the submit door is told.
    //
    // Through the SAME helper the two submit doors use (fix round 1, reviewer
    // MAJOR M1). This block used to be hand-rolled here and did two thirds of
    // the job: it reported and it logged, but it wrote no QUOTATION_ISSUE_FAILED
    // audit row and paged no admin — so an unpayable renewal was invisible to
    // exactly the queue that would have to fix it. One failure, one helper, one
    // level of visibility on all three doors.
    //
    // `tx: prisma` is the client this function resolved at the top, not
    // quotation-service's module global. The application row was just created
    // on it and is not visible on another connection, so issuing elsewhere
    // would fail APPLICATION_NOT_FOUND and the log would blame issuance instead
    // of the client; it also keeps suites that inject a stub prisma off the
    // network. quotation-service._resolvePrisma honours `tx` and falls back to
    // the global, so nothing changes when nothing is injected.
    const { issueQuotationOnSubmit } = require('./quotation-issuance-on-submit');
    const quotationOutcome = await issueQuotationOnSubmit({
        application: newApp,
        actorId,
        // The route that reaches here is authenticateHealth-gated, so the actor
        // is always the HEALTH applicant who owns the certificate — the same
        // fallback the fast-path audit row below uses.
        actorRole: actorRole || 'HEALTH',
        tx: prisma,
        // The caller's holder scope, as the two submit doors pass it (spec §3.1).
        holderScope,
    });

    // W12 - the skip is a compliance event, so it goes in the audit trail, not
    // only in an application log line. Best-effort by the same contract
    // audit-scheduling-service and audit-onsite-service use: a compliance sink
    // that is down must not cost an applicant their renewal. The durable copy
    // of the same facts is on formData above, so nothing is lost if this fails.
    try {
        const {
            auditLogger,
            AuditCategory,
            AuditSeverity,
            ResourceType,
        } = require('../middleware/audit-logger');
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action: 'RENEWAL_FAST_PATH_ENTRY',
            severity: AuditSeverity.INFO,
            actorId,
            actorType: 'USER',
            // AuditLog.actorRole is NOT NULL in the schema (prisma/schema/
            // audit.prisma). Omitting it made the insert fail and the row was
            // silently swallowed by the best-effort catch below - caught by a
            // real press against the live database, not by the unit test,
            // because the test mocks the logger and never sees the schema.
            // The route that reaches here is authenticateHealth-gated, so the
            // actor is always the HEALTH applicant who owns the certificate.
            actorRole: actorRole || 'HEALTH',
            resourceType: ResourceType.APPLICATION,
            resourceId: newApp.id,
            organizationId: sourceApp.organizationId || null,
            metadata: {
                renewalOf: cert.id,
                renewalOfCertificateNumber: cert.certificateNumber,
                renewalSourceApplicationId: sourceApp.id,
                entryState: RENEWAL_ENTRY_STATE,
                documentReviewSkipped: true,
                documentReviewSkipReason: RENEWAL_SKIP_REASON,
                workflowStatesSkipped: [...RENEWAL_SKIPPED_STATES],
            },
        });
    } catch (auditErr) {
        logger.error('[renewal-service] fast-path audit row failed to write', {
            renewalApplicationId: newApp.id,
            error: auditErr?.message,
        });
    }

    return {
        applicationId: newApp.id,
        renewalOf: cert.id,
        renewalOfCertificateNumber: cert.certificateNumber,
        draftedAt: now.toISOString(),
        // { issued: true } or { issued: false, error: 'QUOTATION_ISSUE_FAILED' }.
        // The renewal exists either way; the caller decides what to say about a
        // renewal that has no price of record yet.
        quotation: quotationOutcome,
    };
}

/**
 * List active certificates expiring in *exactly* `daysBeforeExpiry` days.
 *
 * Used by the cron — one batch per cadence tier (60/30/15). Returns the
 * minimum projection the cron needs to dispatch a notification (userId
 * is critical, but we also surface farmName + expiryDate for templating).
 *
 * @param {object} args
 * @param {number} args.daysBeforeExpiry  — 60 / 30 / 15
 * @param {Date}   [args.now]             — clock injection (tests)
 * @param {number} [args.take]            — cap, default 500
 * @param {object} [args.prisma]
 * @returns {Promise<Array>}
 */
async function getApplicationsForRenewalReminder({ daysBeforeExpiry, now, take = 500, prisma: injectedPrisma } = {}) {
    const days = Number.parseInt(daysBeforeExpiry, 10);
    if (!Number.isFinite(days) || days <= 0) {
        throw makeError('VALIDATION_ERROR', 'daysBeforeExpiry must be a positive integer');
    }

    const prisma = resolvePrisma(injectedPrisma);
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const clock = now instanceof Date ? now : new Date();
    const { start, end } = _expiryWindow(clock, days);

    const rows = await prisma.certificate.findMany({
        where: {
            isDeleted: false,
            status: CERT_STATUS.ACTIVE,
            expiryDate: { gte: start, lt: end },
        },
        select: {
            id: true,
            userId: true,
            applicationId: true,
            certificateNumber: true,
            farmName: true,
            expiryDate: true,
        },
        orderBy: { expiryDate: 'asc' },
        take,
    });

    return rows;
}

/**
 * Idempotent marker that records a reminder dispatch on the certificate's
 * owning Application. Subsequent calls with the same (certificateId,
 * reminderType) pair return `{ alreadySent: true }` without writing.
 *
 * @param {object} args
 * @param {string} args.certificateId
 * @param {'D60'|'D30'|'D15'} args.reminderType
 * @param {string} [args.dispatchId]     — fanout dedupeKey or messageId
 * @param {Date}   [args.sentAt]
 * @param {object} [args.prisma]
 * @returns {Promise<{ alreadySent: boolean, reminderType: string, applicationId: string }>}
 */
async function markRenewalReminderSent({
    certificateId,
    reminderType,
    dispatchId,
    sentAt,
    prisma: injectedPrisma,
} = {}) {
    if (!certificateId) {
        throw makeError('VALIDATION_ERROR', 'certificateId is required');
    }
    const normalisedType = String(reminderType || '').toUpperCase();
    if (!REMINDER_TYPES[normalisedType]) {
        throw makeError(
            'VALIDATION_ERROR',
            `Invalid reminderType "${reminderType}". Expected one of D60 / D30 / D15.`,
        );
    }

    const prisma = resolvePrisma(injectedPrisma);
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const cert = await prisma.certificate.findFirst({
        where: { id: certificateId, isDeleted: false },
        select: { id: true, applicationId: true },
    });
    if (!cert) {
        throw makeError('CERT_NOT_FOUND', 'Certificate not found', 404);
    }

    const app = await prisma.application.findFirst({
        where: { id: cert.applicationId, isDeleted: false },
        select: { id: true, formData: true },
    });
    if (!app) {
        throw makeError('SOURCE_APP_NOT_FOUND', 'Application for certificate not found', 500);
    }

    const formData = _safeObject(app.formData);
    const existing = _safeArray(formData.renewalReminders);

    // Idempotency: collapse on (certId, reminderType). The cert is keyed
    // on the cert itself rather than the application because one
    // application could in theory host multiple certificates.
    const alreadyMatch = existing.find(
        (row) => row && row.type === normalisedType && row.certId === certificateId,
    );
    if (alreadyMatch) {
        return {
            alreadySent: true,
            reminderType: normalisedType,
            applicationId: app.id,
            sentAt: alreadyMatch.sentAt,
        };
    }

    const sentAtIso = (sentAt instanceof Date ? sentAt : new Date()).toISOString();
    const nextEntry = {
        type: normalisedType,
        certId: certificateId,
        sentAt: sentAtIso,
        ...(dispatchId ? { dispatchId } : {}),
    };
    const nextReminders = [...existing, nextEntry];

    await prisma.application.update({
        where: { id: app.id },
        data: {
            formData: {
                ...formData,
                renewalReminders: nextReminders,
            },
        },
    });

    logger.info('[renewal-service] Renewal reminder marked', {
        certificateId,
        reminderType: normalisedType,
        applicationId: app.id,
        dispatchId: dispatchId || null,
    });

    return {
        alreadySent: false,
        reminderType: normalisedType,
        applicationId: app.id,
        sentAt: sentAtIso,
    };
}

/**
 * Mark the OLD certificate SUPERSEDED when a renewal application reaches
 * CERTIFIED with a new certificate. Writes:
 *   - Certificate.status               = 'renewed'  (schema-supported value)
 *   - Certificate.renewedCertificateId = newCertId  (schema-supported FK column)
 *
 * AND on the new certificate side (best-effort, idempotent):
 *   - Certificate.previousCertificateId = oldCertId
 *
 * This is the single supersession path — call it from the certificate
 * issuance flow when application.formData.renewalOf is present.
 *
 * @param {object} args
 * @param {string} args.oldCertificateId
 * @param {string} args.newCertificateId
 * @param {string} [args.supersededAt]   — ISO; defaults to now
 * @param {object} [args.prisma]
 * @returns {Promise<{ oldCertificateId, newCertificateId, supersededAt }>}
 */
async function supersedeCertificate({
    oldCertificateId,
    newCertificateId,
    supersededAt,
    prisma: injectedPrisma,
} = {}) {
    if (!oldCertificateId) {throw makeError('VALIDATION_ERROR', 'oldCertificateId is required');}
    if (!newCertificateId) {throw makeError('VALIDATION_ERROR', 'newCertificateId is required');}
    if (oldCertificateId === newCertificateId) {
        throw makeError('VALIDATION_ERROR', 'oldCertificateId and newCertificateId must differ');
    }

    const prisma = resolvePrisma(injectedPrisma);
    if (!prisma) {
        throw makeError('DB_UNAVAILABLE', 'Prisma client unavailable', 503);
    }

    const supersededAtIso = supersededAt || new Date().toISOString();

    const [oldCert, newCert] = await Promise.all([
        prisma.certificate.findFirst({
            where: { id: oldCertificateId, isDeleted: false },
            select: { id: true, status: true, renewedCertificateId: true },
        }),
        prisma.certificate.findFirst({
            where: { id: newCertificateId, isDeleted: false },
            select: { id: true, previousCertificateId: true },
        }),
    ]);

    if (!oldCert) {throw makeError('CERT_NOT_FOUND', 'Old certificate not found', 404);}
    if (!newCert) {throw makeError('CERT_NOT_FOUND', 'New certificate not found', 404);}

    if (oldCert.status !== CERT_STATUS.RENEWED || oldCert.renewedCertificateId !== newCertificateId) {
        await prisma.certificate.update({
            where: { id: oldCertificateId },
            data: {
                status: CERT_STATUS.RENEWED,
                renewedCertificateId: newCertificateId,
            },
        });
    }
    if (newCert.previousCertificateId !== oldCertificateId) {
        await prisma.certificate.update({
            where: { id: newCertificateId },
            data: { previousCertificateId: oldCertificateId },
        });
    }

    logger.info('[renewal-service] Certificate superseded', {
        oldCertificateId,
        newCertificateId,
        supersededAt: supersededAtIso,
    });

    return {
        oldCertificateId,
        newCertificateId,
        supersededAt: supersededAtIso,
    };
}

/**
 * Provider-facing read: list certificates expiring inside a window.
 * Delegates to certificate-service.listExpiringActiveCertificates so the
 * "active + expiring" predicate stays single-sourced.
 *
 * @param {object} args
 * @param {number} [args.days]   — default 60
 * @param {number} [args.take]   — default 200
 * @returns {Promise<Array>}
 */
async function listUpcomingExpiry({ days = 60, take = 200 } = {}) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + Number.parseInt(days, 10) * 24 * 60 * 60 * 1000); // instant arithmetic
    return certificateService.listExpiringActiveCertificates({ now, cutoff, take });
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
    REMINDER_DAYS,
    REMINDER_TYPES,
    REMINDER_TYPE_BY_DAYS,
    CERT_STATUS,
    createRenewalApplication,
    getApplicationsForRenewalReminder,
    markRenewalReminderSent,
    supersedeCertificate,
    listUpcomingExpiry,
    // Pure helpers — exported for testability.
    _internals: {
        _buildCarryForwardFormData,
        _expiryWindow,
        _safeObject,
        _safeArray,
    },
};
