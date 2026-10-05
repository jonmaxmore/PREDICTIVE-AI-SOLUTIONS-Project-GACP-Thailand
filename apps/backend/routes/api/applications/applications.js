/**
 * @swagger
 * tags:
 *   name: Applications
 *   description: Application submission and management
 */

/**
 * Application Routes (Refactored)
 *
 * This file was split from a 1,814-line monolith into focused modules:
 *
 * - helpers/application-constants.js — Constants, step definitions, pure utils
 * - helpers/application-payload-builders.js — API response payload builders
 * - helpers/applications-helpers.js — Health scope / actor identity helpers
 *
 * All API endpoints remain at their original paths. No breaking changes.
 *
 * @module routes/api/applications
 */

const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const crypto = require('crypto');
const applicationService = require('../../../services/application-service');
// Spec 2026-09-30 §3.1: applicant reads carry the holder fragment. holderScope
// is called inside each handler, after authentication.
const { holderScope } = require('../../../services/holder-access');
const { authenticateHealth: _authenticateHealthOnly, authenticateProvider: _authenticateProvider, authenticateAny: authenticateHealth } = require('../../../middleware/auth-middleware');
// Batch 11 (2026-05-16) — direct `prisma.X.method(...)` calls were
// migrated to applicationService methods. The `prisma` client is now
// imported only as a transaction handle for `writeApplicationStatus`
// (see ./applications-car.js for the canonical exception note).
const { prisma } = require('../../../services/prisma-database');
const _feeService = require('../../../services/fee-service');
const { areaTypeFromTicks, AREA_TYPE_UNDECLARED } = require('../../../shared/application-scope');
const storageService = require('../../../services/storage-service');
// F-G4-08 — the slots used to accept anything, including a 70-byte 1x1 PNG in a
// slot whose label says "รองรับ .pdf". This guard reads what is actually in the
// file; the rules it applies live in @gacp/validation/upload-rules, which the
// browser wizard imports as well so the two can never disagree.
const uploadContentGuard = require('../../../services/upload-content-guard');
const { ENTITY_PERMISSION_DENIED_EN } = require('../../../shared/entity-permission-denied');
// The draft-document storage (uploader, multer refusals, served URL, byte
// removal) is shared with the planting-attachment door (C4), so both doors write
// and remove files through one pipeline.
const {
    receiveDraftDocument,
    toUploadedFileUrl,
    unlinkStoredUpload,
} = require('../../../middleware/draft-document-upload');
const applicationDocumentSync = require('../../../services/application-document-sync');
// Document pre-check (2026-09-27) — queued after an upload is stored; warn-only.
const documentPrecheck = require('../../../services/document-precheck/service');
const { getCanonicalSlotId } = require('./validation-slot-utils');
const { assessPurposes } = require('../../../shared/certification-purposes');
const { respondPurposeInvalid, refusedDraftPurposeClaim } = require('../helpers/certification-purpose-doors');
const { writeApplicationStatus } = require('../../../services/application-status-writer');
// R2 M7 (D-6) — append-only per-round snapshot of the submitted formData.
const { snapshotCorrectionSubmission } = require('../../../services/correction-submission-version-service');
// Bug 6.5 — shared 5-working-day revision-deadline guard. The primary /submit
// RESUBMIT path previously skipped the deadline check that submitRevision
// enforces, letting an overdue applicant resubmit through the front door.
const { assertRevisionNotExpired } = require('../../../services/application-service/revision-deadline-guard');
// Tier 18 / B18-A (2026-05-16): on the initial SUBMITTED transition the
// application's quotation is issued. F-G4-64 R3 replaced the fire-and-forget
// call that used to live here with services/quotation-issuance-on-submit, which
// awaits, audits and reports the outcome; it is required at the call site
// because it is the only place in this file that needs it. The status writer is
// still on the no-touch list, so issuance still runs outside its transaction —
// the service is idempotent on (applicationId, issuerType), so a retry or
// replay returns the existing row rather than duplicating.
const { createNotification } = require('../../../services/notification-service');
const logger = require('../../../shared/logger');
const { normalizeRole, isProviderRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
// AUTH-09: PDPA ม.16 — consent must precede personal-data processing. The
// runtime gate (defined in consent-manager, fail-open, provider-bypassed) was
// previously wired to ZERO routes. Enforce it at the processing-entry point:
// application SUBMIT. Consent is captured at registration, so this passes for
// every properly-registered applicant and only blocks a consent-withdrawn user.
const { requireConsent } = require('../../../middleware/consent-manager');
// M1 (2026-08-15) — the certificate belongs to the farm, so the submit door
// asks whose farm this is. One guard for all four submit doors; it keys off the
// APPLICATION ROW's entityId (never a request header) and writes its
// own AuditLog FAILURE row on every refusal (plan D5/D7/D10).
const { assertSubmitAllowed, SubmitGuardError, lockAndAssertNoSuccessionInFlight } = require('../../../services/application-submit-guard');
// M2a (2026-08-15) — the mandatory-document law is DATA (operator ruling G2).
// This door asks it after the authority question and before any write: rights
// first, completeness second.
const {
    assertRequiredDocumentsPresent,
    buildRequirementSnapshot,
    isSubmitGateRefusal,
    respondSubmitGateRefusal,
    MODE_FIRST_SUBMIT,
    MODE_RESUBMIT,
} = require('../../../services/application-document-requirements');
const {
    resolveDeclarationsAcceptance,
    DECLARATIONS_REQUIRED,
} = require('../../../services/application-declarations-gate');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');

/**
 * V1-D D2 — explicit HEALTH-role gate.
 *
 * Five applicant-only routes (POST /draft, POST /submit, POST /prepare,
 * POST /draft-documents, DELETE /draft/:id) historically mounted the
 * `authenticateAny` middleware aliased as `authenticateHealth`. The alias
 * accepts BOTH provider and health tokens so staff can read shared
 * endpoints elsewhere, but for these five routes a provider token must
 * be rejected — they mutate applicant-owned drafts and would let an
 * admin/reviewer create/delete drafts in their own name.
 *
 * Pattern mirrors application-listing-handlers.js:57 — return 403 + a
 * machine-readable `code` so the frontend can branch on it. We log a
 * warn so the security team can see denied attempts in audit, but we do
 * NOT write to auditLog from the route per instinct I-003 (audit-log
 * calls must be in-transaction via auditLogger.logWithin; the service
 * layer covers that for successful writes).
 *
 * @param {object} req  Express request — req.user populated by authenticateAny
 * @param {object} res  Express response — 403 written when not health
 * @returns {boolean}   true if the request was rejected (caller must stop)
 */
function rejectIfNotHealthRole(req, res) {
    const rawRole = req.user?.canonicalRole || req.user?.role;
    const canonicalRole = normalizeRole(rawRole);
    if (canonicalRole === CANONICAL_ROLES.HEALTH) {
        return false;
    }
    // Provider role explicitly denied — log loud, return 403 with the
    // dedicated code so the UI / log-analyser can differentiate this
    // from a missing-token 401.
    logger.warn(
        `[Applications RBAC] HEALTH_ROLE_REQUIRED — denied ${req.method} ${req.originalUrl} ` +
        `for role=${canonicalRole || rawRole || 'UNKNOWN'} userId=${req.user?.id || 'unknown'} ` +
        `providerRole=${isProviderRole(rawRole)}`,
    );
    res.status(403).json({
        success: false,
        error: 'Forbidden',
        code: 'HEALTH_ROLE_REQUIRED',
        message: 'Only applicants (HEALTH role) can perform this action',
    });
    return true;
}
const { buildWorkflowEvent } = require('../../../shared/workflow-event-builder');
const { stripServerOwnedKeys } = require('../../../shared/form-data-ownership');
// Blocker F cleanup: the `_addWorkingDays`/`_loadHolidaySet` destructure of
// services/working-days-service was dead (those property names never existed
// in its exports); deadline WRITES now live on utils/working-days.
const {
    _mapHealthApplication,
    getHealthScopeOptions,
    _getActorIdentity,
} = require('../helpers/applications-helpers');

// Extracted modules
const {
    MASTER_STEPS,
    _AUDITOR_ROLES,
    _REJECTABLE_STATUSES,
    _REVISION_DECISION_TYPES,
    asObject,
    asArray,
    upper,
    ensureApplicationNumber,
    _isMissingApplicationCommentsTableError,
    mergeMasterSteps,
    pickWizardOwnedFormData,
} = require('../helpers/application-constants');
// F-APPV2-02 — the checked channel for the two law dimensions the allowlist may not carry.
const { resolveLawDimensions } = require('../../../services/application-law-dimensions');

const {
    _buildApplicationDetailPayload,
    _buildApplicationHistoryPayload,
    _buildTrackingPayload,
} = require('../helpers/application-payload-builders');

const {
    validateStep,
} = require('../../../validation/application-schemas');

// C2 fix — canonical submit validation. The legacy-vs-canonical decision
// (validateAllSteps vs validateCanonicalSubmission) and both validator calls
// now live in ONE shared function so the revision door
// (application-review-revision-methods.js) runs the identical gate instead
// of a second copy (Ruling 7, task-3 fix round 1) — see
// validation/application-submission-validator.js for the full rationale.
const {
    validateSubmissionPayload,
} = require('../../../validation/application-submission-validator');

// F-QA-06 — a certificate names the place it certifies by reading the FARM row, so a
// filing that reaches the department without one walks the whole line and is refused at
// the last gate (422 CERTIFICATE_FARM_LOCATION_MISSING). The field map that turns a
// filing's own answers into that row lives in ONE module, shared with the v1 wizard door.
const {
    materializeFarmForFiling,
} = require('../../../services/application-service/application-farm-materialization');
// Which era wrote this filing — read off the filing itself, the same marker the submit
// validator uses to choose which law judges it.
const { isKatorlor1Filing } = require('../../../validation/canonical-application-validator');
// ด่านจ่ายเงินที่คำขอไปหยุดรอ — ต่ออายุข้ามด่านตรวจเอกสาร (มติ operator 2026-09-07)
const { entryStateForSubmission } = require('../../../services/application-service/submission-entry-state');

// ช่องที่เจ้าหน้าที่ตรวจผ่านแล้ว แก้ไม่ได้ (operator 2026-09-11)
const {
    assertSlotNotAlreadyAccepted,
} = require('../../../services/application-document-review-service');

/**
 * คำตัดสินรายช่องของคำขอใบนี้ ในรูปที่ `assertSlotNotAlreadyAccepted` อ่านได้
 *
 * อ่านทุกรอบ ไม่ใช่เฉพาะรอบล่าสุดของ "คำขอ" — เพราะแต่ละช่องมีรอบของตัวเอง และช่องที่
 * ผ่านตั้งแต่รอบ 1 จะไม่มีแถวในรอบ 2 เลย · ตัวกติกาเป็นคนเลือกรอบล่าสุด "ต่อช่อง" เอง
 */
async function documentVerdictsOf(applicationId) {
    if (!prisma?.applicationDocumentReview) { return []; }
    return prisma.applicationDocumentReview.findMany({
        where: { applicationId },
        select: { slotId: true, verdict: true, round: true },
    });
}

// ติ๊ก N ลักษณะพื้นที่ → N เคส เลขอิสระ ผูกด้วย bundle (operator 2026-09-11)
const {
    fanOutByAreaType,
    FAN_OUT_NO_AREA_TYPE,
    FAN_OUT_BAD_AREA_TYPE,
} = require('../../../services/application-fan-out');

// F-G4-11 (2026-08-26) — the wizard's step-exit bar, server side. The address
// bar is one door into step N; these routes are the other, and until now only
// the browser had an opinion about which step a farmer had earned.
const {
    evaluateStepClaim,
    stepPrerequisiteMessage,
    LAST_FLOW_STEP,
} = require('../../../validation/wizard-step-prerequisites');

// F-G4-11 — Wizard step-prerequisite helpers
//
// A draft-save payload can carry wizard data in two shapes:
//   CANONICAL  — `formData: { plantId, applicantData, farmData, … }`, the whole
//                store, which is what the live wizard's autosave posts.
//   LEGACY     — `steps: { "7": {…} }`, or `step: 7` + `stepData: {…}`, data
//                scoped to one numbered step (mergeMasterSteps reads both).
// The two are refused differently and `legacyWrittenSteps` is what tells them
// apart: see the block inside POST /draft for why.

/**
 * The step numbers a payload writes step-SCOPED data into.
 * @param {object} payloadInput request body
 * @returns {number[]} master-step numbers, ascending
 */
function legacyWrittenSteps(payloadInput) {
    const payload = asObject(payloadInput);
    const written = new Set();

    for (const [stepKey, stepValue] of Object.entries(asObject(payload.steps))) {
        const stepNumber = Number.parseInt(String(stepKey).trim(), 10);
        if (Number.isFinite(stepNumber) && Object.keys(asObject(stepValue)).length > 0) {
            written.add(stepNumber);
        }
    }

    const explicitStep = Number.parseInt(String(payload.step || ''), 10);
    const stepData = asObject(payload.stepData || payload.data);
    if (Number.isFinite(explicitStep) && MASTER_STEPS.includes(explicitStep) && Object.keys(stepData).length > 0) {
        written.add(explicitStep);
    }

    return [...written].sort((a, b) => a - b);
}

/**
 * The wizard data a caller is holding: what the server has stored, with the
 * caller's own canonical blob laid over it.
 *
 * Reading the caller's blob is deliberate. POST /draft does not persist
 * `payload.formData` (only POST /prepare does), so the stored copy shows every
 * mid-wizard applicant as empty; judging a step claim by that alone would
 * refuse everyone. What the caller sends is not proof — it can lie — but a
 * caller who lies has to send a COMPLETE application to do it, which is no
 * longer skipping the wizard, and POST /submit still judges that data on its
 * own terms before anything is filed.
 *
 * @param {object} storedFormData application.formData
 * @param {object} payloadInput   request body
 * @returns {object} canonical formData to judge against
 */
function claimedWizardData(storedFormData, payloadInput) {
    const payload = asObject(payloadInput);
    return { ...asObject(storedFormData), ...asObject(payload.formData) };
}

/** The one refusal shape for a step whose prerequisites are unmet. */
function respondStepPrerequisiteUnmet(res, { requestedStep, allowedStep }) {
    return res.status(422).json({
        success: false,
        error: 'STEP_PREREQUISITE_UNMET',
        code: 'STEP_PREREQUISITE_UNMET',
        message: stepPrerequisiteMessage(requestedStep, allowedStep),
        requestedStep,
        allowedStep,
    });
}

// Shared DB Helpers

// Bug 2.3 — only these statuses may have their formData overwritten by the
// applicant-facing /prepare, /draft (autosave), and draft-document routes.
// findApplicationByIdForHealth carries NO status filter, so an owner could POST
// {applicationId} for an ASSIGNED_FOR_REVIEW (or any downstream) app and blank
// reviewer-facing data via a shallow formData spread while the status column
// stayed put. Gating the explicit-id resolve here protects all three routes
// uniformly. Canonical strings per workflow-transition-service WORKFLOW_STATES.
const { isApplicantEditable } = require('../../../constants/applicant-editable-statuses');

/**
 * autosave-lost-reply fix round 1 (C1): `{ saveSession, saveSeq }` from a draft save, or null.
 * The session is the wizard's random per-page id; the sequence a positive safe integer.
 */
function draftSaveClockFrom(payload) {
    const session = typeof payload.saveSession === 'string' ? payload.saveSession.trim() : '';
    const seq = Number(payload.saveSeq);
    if (!session || session.length > 64 || !/^[A-Za-z0-9-]+$/.test(session)) { return null; }
    if (!Number.isSafeInteger(seq) || seq < 1) { return null; }
    return { session, seq };
}

/** fix round 2: `{ saveSession, lastAppliedSeq }` from a submit, or null (same rules as a save clock). */
function submitClockFrom(payload) {
    return draftSaveClockFrom({ saveSession: payload.saveSession, saveSeq: payload.lastAppliedSeq });
}

/** The request error idiom (statusCode + machine-readable code → respondError maps it). */
function holderDoorError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

/**
 * The draft every applicant write door works on (spec 2026-09-30 §3.2).
 *
 *  - With an id: the caller's application, loaded within its holder scope
 *    (none → 404, never a fallback to another row; Review Focus 3: a membership
 *    revoked mid-draft), and its holder must be in `scope.editIds` (a holder the
 *    caller only reads → 403 ENTITY_PERMISSION_DENIED, R2 Task 9).
 *  - Without an id: the caller names the holder in `entityId`. Missing → 400
 *    APPLICATION_HOLDER_REQUIRED; not in `editIds` → 403
 *    ENTITY_PERMISSION_DENIED. There is no default holder. The caller's own open
 *    DRAFT on that holder is resumed (a first save whose reply was lost and is
 *    retried with no id must not mint a second draft); else a new one is created
 *    with `formData.applicantType = Entity.type`.
 *
 * `entityId` is never written after create (no re-homing, B11).
 * @param {{ userId: string, healthId: string }} healthIdentity
 * @param {object} reqUser
 * @param {object} options — the request payload (applicationId|draftId, entityId, serviceType, areaType, formData)
 * @param {{ readIds: string[], editIds: string[] }} scope — holderScope(req)
 */
async function findOrCreateApplicationForHealth(healthIdentity, reqUser, options, scope) {
    if (!scope || !Array.isArray(scope.editIds)) {
        throw new TypeError('findOrCreateApplicationForHealth: scope must be holderScope(req)');
    }
    const opts = asObject(options);
    const requestedId = String(opts.applicationId || opts.draftId || '').trim();
    const serviceType = String(opts.serviceType || 'new_application').trim() || 'new_application';
    // ไม่เติม 'OUTDOOR' ให้เองอีกแล้ว — ดู areaTypeFromTicks (operator 2026-09-11)
    const areaType = areaTypeFromTicks(asObject(opts.formData) || opts, String(opts.areaType || '').trim().toUpperCase() || AREA_TYPE_UNDECLARED);

    if (requestedId) {
        const application = await applicationService.findApplicationByIdForHealth(requestedId, { holderScope: scope });
        // Round 5 (staging-walk-0930): an explicit id that does not resolve FOR THIS
        // USER (a row outside the caller's holders, a soft-deleted one, none at all)
        // is refused before anything is written.
        if (!application) {
            throw holderDoorError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
        }
        // R2 Task 9 (spec §3.2 draft edits, §4 case 3): a holder the caller may read
        // but not edit (a VIEWER) is a refusal the caller can see, not a missing row.
        if (!scope.editIds.includes(application.entityId)) {
            throw holderDoorError(403, 'ENTITY_PERMISSION_DENIED', ENTITY_PERMISSION_DENIED_EN);
        }
        // Bug 2.3 guard: an explicit id in a non-applicant-editable status is
        // refused; the caller's formData must not overwrite reviewer-facing data.
        if (!isApplicantEditable(application.status)) {
            throw holderDoorError(409, 'APPLICATION_NOT_EDITABLE',
                `Application ${application.applicationNumber || requestedId} is not editable in status ${application.status}`);
        }
        return application;
    }

    const entityId = String(opts.entityId || '').trim();
    if (!entityId) {
        throw holderDoorError(400, 'APPLICATION_HOLDER_REQUIRED', 'The holder (entityId) of a new application is required');
    }
    if (!scope.editIds.includes(entityId)) {
        throw holderDoorError(403, 'ENTITY_PERMISSION_DENIED', ENTITY_PERMISSION_DENIED_EN);
    }

    const resumed = await applicationService.findLatestOpenDraftForHealth({
        holderScope: scope,
        submitterId: healthIdentity.userId,
        editIds: [entityId],
    });
    if (resumed) {
        return resumed;
    }

    const holder = await applicationService.findHolderEntity(entityId);
    if (!holder) {
        throw holderDoorError(403, 'ENTITY_PERMISSION_DENIED', ENTITY_PERMISSION_DENIED_EN);
    }
    return applicationService.createDraftForHealth({
        applicationNumber: ensureApplicationNumber('APP'),
        healthId: healthIdentity.healthId,
        entityId,
        submitterId: healthIdentity.userId || null,
        serviceType,
        areaType,
        status: 'DRAFT',
        formData: {
            steps: {},
            workflowState: 'DRAFT',
            // Server-owned (form-data-ownership): the declared type IS the holder's type,
            // so the paper and the holder can never disagree on a new filing.
            applicantType: holder.type,
        },
        workflowHistory: [
            buildWorkflowEvent({
                action: 'APPLICATION_DRAFT_CREATED',
                toStatus: 'DRAFT',
                toState: 'DRAFT',
                actorId: healthIdentity.userId,
                actorRole: reqUser?.canonicalRole || reqUser?.role || 'health',
            }),
        ],
    });
}

/**
 * Reads never create (spec 2026-09-30 §3.2): GET /draft-documents and DELETE
 * /draft-documents/:id name their draft. No `applicationId` → 400; a draft the
 * caller cannot edit, or none at all → 404 (findOrCreateApplicationForHealth's
 * id path, which never creates).
 */
async function loadNamedDraftForHealth(healthIdentity, reqUser, query, scope) {
    const q = asObject(query);
    const requestedId = String(q.applicationId || q.draftId || '').trim();
    if (!requestedId) {
        throw holderDoorError(400, 'VALIDATION_ERROR', 'applicationId is required');
    }
    return findOrCreateApplicationForHealth(healthIdentity, reqUser, { applicationId: requestedId }, scope);
}

// M1 — the context the submit guard stamps onto its audit rows. The entity the
// row names is the application's holder (onBehalfOfEntityId), never a workspace
// (spec 2026-09-30 §3.2 Submit: the workspace id field was dropped in R2 Task 9).
function buildSubmitAuditContext(req) {
    return {
        actorType: 'USER',
        actorRole: req.user?.canonicalRole || req.user?.role || null,
        ipAddress: req.ip || null,
        userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
        organizationId: req.user?.organizationId || null,
        route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
    };
}

// M1 AC3 — a submit that is ACCEPTED says in whose name it was made.
//
// The canonical status-transition row cannot carry it: `writeApplicationStatus`
// builds its audit envelope from a fixed six-field shape
// (application-status-writer.js:817-824) and takes no caller metadata, and that
// file is on the no-touch list. So the "in whose name" record is emitted here,
// AFTER the business transaction commits, through the same standalone
// `auditLogger.log()` the guard uses for refusals (own tx + own advisory lock —
// audit-logger.js:479,505-506). Emitting it inside the caller's transaction
// would risk a failed audit INSERT poisoning that transaction (Postgres 25P02)
// and turning an audit hiccup into a rolled-back submit. Best-effort by design:
// log() swallows its own errors (:526-541).
async function logSubmitAccepted({ req, applicationId, entityId, actorId, action, extraMetadata = {} }) {
    const ctx = buildSubmitAuditContext(req);
    try {
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action,
            severity: AuditSeverity.INFO,
            actorId: actorId || 'UNKNOWN',
            actorType: ctx.actorType,
            actorRole: ctx.actorRole || 'UNKNOWN',
            resourceType: ResourceType.APPLICATION,
            resourceId: applicationId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            organizationId: ctx.organizationId,
            result: 'SUCCESS',
            metadata: {
                onBehalfOfEntityId: entityId || null,
                permission: 'SUBMIT_APPLICATION',
                applicationId,
                route: ctx.route,
                ...extraMetadata,
            },
        });
    } catch (auditErr) {
        logger.warn(`[Applications Submit] accepted-audit write failed (non-fatal): ${auditErr?.message}`);
    }
}

/**
 * B3 — delete the bytes behind one `draftDocuments[]` entry.
 *
 * The entry only stores the served `fileUrl` (`/uploads/<...>`), so the disk
 * path is derived from it and then handed to storage-service's ONE containment
 * check, which is what refuses a `..`-poisoned record. Nothing outside the
 * uploads root is ever unlinked; a refusal is logged, not silently swallowed.
 *
 * Never throws: the records are already gone by the time this runs, so a missing
 * or already-unlinked file must not turn a successful delete into a 500.
 */
async function unlinkStoredDraftDocument(doc, applicationId, documentId) {
    await unlinkStoredUpload(doc?.fileUrl, {
        logPrefix: '[Applications Draft Documents Delete]',
        context: `application=${applicationId}, documentId=${documentId}`,
    });
}

// READINESS & CONFIG

router.get('/readiness', authenticateHealth, async (req, res) => {
    try {
        const userId = req.user?.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // Establishment + Document aren't actual Prisma models in the
        // current schema (verified 2026-05-03 via grep — no `model
        // Establishment` or `model Document` exists). The applicant
        // readiness snapshot defensively wraps those in optional access
        // (see application-service applicant-query methods).
        // Application.healthId FK references User.canonicalId — JWT no
        // longer carries `healthId` (closed batch 3, PDPA Phase D prep).
        const {
            user,
            farms,
            establishments,
            documents,
        } = await applicationService.getApplicantReadinessSnapshot(userId, {
            canonicalHealthId: req.user.canonicalId,
            holderScope: await holderScope(req),
        });

        const items = [];
        items.push({ id: 'profile', label: 'ข้อมูลโปรไฟล์ครบถ้วน', description: 'ชื่อ-นามสกุล, เลขบัตรประชาชน, ที่อยู่', ready: !!(user?.firstName && user?.lastName), actionHref: '/health/profile', actionLabel: 'แก้ไขโปรไฟล์' });
        items.push({ id: 'establishment', label: 'ลงทะเบียนสถานประกอบการ', description: 'มีข้อมูลสถานประกอบการและพิกัดที่ตั้ง', ready: establishments.length > 0, actionHref: '/health/establishments/new', actionLabel: 'ลงทะเบียนสถานประกอบการ' });
        items.push({ id: 'farm', label: 'ลงทะเบียนฟาร์ม/แปลงปลูก', description: 'มีข้อมูลฟาร์มและแปลงปลูกสมุนไพร', ready: farms.length > 0, actionHref: '/health/planting', actionLabel: 'ลงทะเบียนแปลงปลูก' });

        const sopDocs = Array.isArray(documents) ? documents.filter(d => d.type && d.type.toUpperCase().includes('SOP')) : [];
        items.push({ id: 'sop', label: 'เตรียม SOP (มาตรฐานการปฏิบัติงาน)', description: 'จัดทำ SOP การปลูก, เก็บเกี่ยว, ตากแห้ง, สุขลักษณะ', ready: sopDocs.length > 0, actionHref: '/health/sop-templates', actionLabel: 'ดาวน์โหลดแบบฟอร์ม SOP' });

        const generalDocs = Array.isArray(documents) ? documents.filter(d => !d.type?.toUpperCase().includes('SOP')) : [];
        items.push({ id: 'documents', label: 'เอกสารประกอบ', description: 'สำเนาบัตรประชาชน, ทะเบียนบ้าน, แผนที่สถานที่ปลูก', ready: generalDocs.length >= 2, actionHref: '/health/documents', actionLabel: 'จัดการเอกสาร' });

        const waterTestDocs = Array.isArray(documents) ? documents.filter(d => d.type && d.type.toUpperCase().includes('WATER')) : [];
        items.push({ id: 'water_test', label: 'ผลตรวจคุณภาพน้ำ', description: 'รายงานผลตรวจน้ำจากห้องปฏิบัติการที่ได้รับการรับรอง', ready: waterTestDocs.length > 0, actionHref: '/health/documents', actionLabel: 'อัปโหลดผลตรวจ' });

        const readyCount = items.filter(i => i.ready).length;
        return res.json({ success: true, data: { ready: readyCount === items.length, items, readyCount, totalCount: items.length } });
    } catch (error) {
        logger.error('[Readiness] Error:', error);
        return respondError(res, req, error, { message: 'Failed to check readiness' });
    }
});

router.get('/config', authenticateHealth, async (_req, res) => {
    return res.json({ success: true, data: { totalSteps: MASTER_STEPS.length, steps: MASTER_STEPS } });
});

// DRAFT CRUD

/**
 * @swagger
 * /api/applications/draft:
 *   post:
 *     tags: [Applications]
 *     summary: Create or upsert a DRAFT application (HEALTH role only)
 *     description: |
 *       Saves a wizard step payload onto the applicant's open draft, creating
 *       a fresh DRAFT row when one does not already exist. Provider tokens
 *       are rejected with HEALTH_ROLE_REQUIRED (V1-D D2 gate).
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               applicationId:
 *                 type: string
 *                 description: Existing draft id to upsert into
 *               serviceType:
 *                 type: string
 *                 example: new_application
 *               areaType:
 *                 type: string
 *                 example: OUTDOOR
 *               step:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 9
 *                 description: 1-9 master step being persisted
 *               certificationPurpose:
 *                 type: string
 *               certificationPurposes:
 *                 type: array
 *                 items:
 *                   type: string
 *               previousCertNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Draft saved; returns draftId + applicationNumber + per-step validation summary
 *       401:
 *         description: AUTH_ERROR — missing or invalid token
 *       403:
 *         description: HEALTH_ROLE_REQUIRED — provider tokens are rejected
 *       500:
 *         description: Failed to save application
 */
router.post('/draft', authenticateHealth, async (req, res) => {
    try {
        // V1-D D2: explicit HEALTH-role gate. The auth middleware is the
        // permissive `authenticateAny` alias; without this check a
        // provider token would create drafts as if it were an applicant.
        if (rejectIfNotHealthRole(req, res)) { return; }
        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const payload = asObject(req.body);
        // Operator ruling 2026-10-05 — a purpose the register has no licence for is refused
        // BEFORE anything is created or written, and never mapped to another word.
        const refusedPurpose = refusedDraftPurposeClaim(payload);
        if (refusedPurpose) { return respondPurposeInvalid(res, refusedPurpose); }
        // autosave-lost-reply fix round 1 (C1): the wizard's save clock, beside applicationId.
        // Read before anything is written; a malformed one is ignored (an older client).
        const saveClock = draftSaveClockFrom(payload);
        const serviceType = String(payload.serviceType || 'new_application').trim() || 'new_application';
        const areaType = areaTypeFromTicks(payload, String(payload.areaType || '').trim().toUpperCase() || AREA_TYPE_UNDECLARED);
        const draftScope = await holderScope(req);
        let application = await findOrCreateApplicationForHealth(healthIdentity, req.user, { ...payload, serviceType, areaType }, draftScope);

        // Fix round 2 (autosave-lost-reply): the merge is computed FROM the row it is written
        // over. With a save clock (every current wizard save) the row is re-read under its
        // lock inside the write, so a document upload or another save that committed after
        // the read above is merged, not overwritten. Without a clock (older clients) it is
        // the read above, as before.
        // Fix round 3 (M1): the certificate-derived law dimensions depend on the claim and the
        // caller, not on the locked row (`stored` only decides whether the plant is already
        // answered), so they are read here, outside any transaction.
        const lawResolved = await resolveLawDimensions({
            prisma,
            actorUserId: healthIdentity.userId,
            claimed: asObject(payload.formData),
            stored: asObject(application.formData),
            // A renewal is granted only for the filing's own holder, and only to a caller
            // who may submit for it (operator ruling 2026-10-03).
            filingEntityId: application.entityId ?? null,
            holderScope: await holderScope(req),
        });
        const computeDraftWrite = async (row) => {
            const mergedSteps = mergeMasterSteps(row.formData, payload);
            const submittedStep = Number.parseInt(String(payload.step || ''), 10);
            const formData = asObject(row.formData);

            // F-G4-11 — the API door. `step` is a claim about progress; a claim
            // that runs ahead of the data is not honoured. Two different refusals,
            // and the difference is deliberate:
            //
            //  - Step-SCOPED legacy data for an unearned step is REJECTED. That
            //    shape carries data belonging to one numbered step, so refusing it
            //    costs nothing that belongs to any other step.
            //  - The step CLAIM on a canonical whole-store save is CLAMPED, never
            //    rejected. The autosave posts the entire wizard on a 3-second
            //    debounce; rejecting it to punish a wrong number would throw away
            //    a farmer's typing. The data is written either way and
            //    `lastDraftStep` records only what was earned — so a resume can
            //    never be sent to a step the applicant has not reached, which is
            //    the harm a forged claim was worth.
            const stepClaim = evaluateStepClaim(claimedWizardData(formData, payload), payload.step);
            const unearnedLegacyStep = legacyWrittenSteps(payload).find((step) => step > stepClaim.allowedStep);
            if (unearnedLegacyStep !== undefined) {
                return { refusal: { requestedStep: unearnedLegacyStep, allowedStep: stepClaim.allowedStep } };
            }
            const earnedStep = Number.isFinite(submittedStep)
                ? Math.min(submittedStep, stepClaim.allowedStep)
                : null;

            // F-G4-14 — the autosave's payload is the application. It posts the
            // whole wizard store under `formData` every few seconds; this handler
            // used to read only `payload.steps`, so a farmer who filled eleven
            // document slots and reloaded found all of them empty. What the client
            // sends is written now — but through an ALLOWLIST, never a spread:
            // `formData` is one blob shared with the server's own facts (fees are
            // derived from it, and workflowState / audit outcome / assignment /
            // deadlines live in it), so a spread would let an applicant price and
            // advance their own application. pickWizardOwnedFormData names the
            // wizard's keys and drops everything else — see the list's header for
            // what governs it and where to add a new wizard field.
            //
            // Order matters: stored blob first, the applicant's own keys over it,
            // then the server's stamps last so nothing the client sent can shadow
            // them. Every key NOT on the allowlist keeps its stored value because
            // it never enters the spread at all.
            // F-APPV2-02 — the two answers step 1 asks that the allowlist may NOT carry.
            // `requestType` and `certScope` are server-owned because both can REMOVE
            // requirements, so they do not travel through pickWizardOwnedFormData; they go
            // through a resolver that CHECKS the claim first (a renewal or a replacement has
            // to name a live certificate this platform issued to this caller). It never
            // throws: an unproven claim resolves to NEW — the longer document list — with a
            // Thai notice, because the autosave fires every few seconds and a half-typed
            // certificate number must not cost the applicant their draft.
            // Fix round 3 (M1): resolved BEFORE the locked transaction (lawResolved below):
            // it reads the previous certificate on the global client, which inside the
            // transaction needs a second pooled connection while the lock holds the first.
            const law = lawResolved;

            const mergedFormData = {
                ...formData,
                ...pickWizardOwnedFormData(payload.formData),
                steps: mergedSteps,
                lastDraftStep: earnedStep !== null ? earnedStep : formData.lastDraftStep || null,
                lastDraftSavedAt: new Date().toISOString(),
                // After the allowlist on purpose — nothing the client sent may shadow the
                // dimension the server just decided.
                ...law.dimensions,
                // Server stamp, after the allowlist: the last save clock applied (C1). Absent
                // clock: the stored one stays as it was (it is in `formData` above).
                ...(saveClock ? { draftSaveClock: saveClock } : {}),
            };
            const workflowHistory = asArray(row.workflowHistory);
            const updateEvent = buildWorkflowEvent({
                action: 'APPLICATION_DRAFT_SAVED',
                actorId: healthIdentity.userId,
                actorRole: req.user.canonicalRole || req.user.role || 'health',
                // The history records the step that was EARNED, not the one that was
                // asked for, so the audit trail and `lastDraftStep` cannot disagree.
                metadata: { step: earnedStep },
            });

            const fd = asObject(mergedFormData);
            // Legacy single-purpose (kept for backward compat with existing queries/reports)
            const certPurpose = String(fd.certificationPurpose || payload.purpose || '').trim() || null;
            // New multi-select array: the first NON-EMPTY of payload / merged /
            // stored wins, then the legacy single is wrapped.
            // Bug 8.2: the old check was `Array.isArray(payload.certificationPurposes)`,
            // which treats an empty [] as "provided" and preferred it — so a draft-save
            // from a step that doesn't touch purposes (sending []) WIPED the applicant's
            // saved selection. A draft must not lose data.
            // F-G4-14 adds the STORED tier: now that `payload.formData` is written,
            // that same empty array can arrive INSIDE formData and reach `fd`, so
            // without this tier the fixed bug would come back through the new door.
            const purposeCandidates = [payload.certificationPurposes, fd.certificationPurposes, formData.certificationPurposes];
            const savedPurposes = purposeCandidates.find((entry) => Array.isArray(entry) && entry.length > 0);
            const certPurposes = savedPurposes || (certPurpose ? [certPurpose] : []);
            const prevCert = String(fd.previousCertNumber || '').trim() || null;
            const pdpaConsent = Boolean(fd.consentedPDPA);

            // Note: this endpoint patches form fields without changing application.status,
            // so we deliberately omit `status` from the data payload (the previous
            // `status: application.status` line was a no-op that triggered the
            // gacp/no-direct-application-status-write rule unnecessarily).
            return {
                data: {
                    serviceType: row.serviceType || serviceType,
                    // สิ่งที่ผู้ยื่นติ๊กในงวดบันทึกนี้ชนะเสมอ · ถัดมาคือสิ่งที่ผู้เรียกส่งมา
                    // แล้วจึงเป็นค่าเดิมของแถว — ไม่มีขั้นไหนประดิษฐ์คำขึ้นใหม่
                    areaType: areaTypeFromTicks(formData,
                        String(payload.areaType || row.areaType || areaType).trim().toUpperCase() || areaType),
                    certificationPurpose: certPurpose,
                    certificationPurposes: certPurposes,
                    previousCertNumber: prevCert,
                    consentedPDPA: pdpaConsent,
                    formData: { ...mergedFormData, certificationPurposes: certPurposes },
                    workflowHistory: [...workflowHistory, updateEvent],
                    updatedBy: healthIdentity.userId,
                },
                mergedSteps, submittedStep, earnedStep, stepClaim, law, mergedFormData,
            };
        };
        let built;
        if (saveClock) {
            const saved = await applicationService.saveApplicantDraftInOrder(application.id, saveClock, computeDraftWrite, { editIds: draftScope.editIds });
            built = saved.built;
            if (saved.row) { application = { ...application, ...saved.row }; }
        } else {
            built = await computeDraftWrite(application);
            if (!built.refusal) {
                application = await applicationService.updateApplicantDraftColumns(application.id, built.data);
            }
        }
        if (built.refusal) { return respondStepPrerequisiteUnmet(res, built.refusal); }
        const { mergedSteps, submittedStep, earnedStep, stepClaim, law, mergedFormData } = built;
        // Zod validation for submitted step (non-blocking warnings)
        let stepValidation = null;
        if (Number.isFinite(submittedStep) && submittedStep >= 1 && submittedStep <= 9) {
            const stepData = asObject(mergedSteps[String(submittedStep)]);
            stepValidation = validateStep(submittedStep, stepData);
        }

        res.json({
            success: true,
            data: {
                id: application.id,
                draftId: application.id,
                applicationNumber: application.applicationNumber,
                status: application.status,
                // F-G4-11 — what was actually recorded, plus the frontier the
                // server judged, so a client that asked for too much learns it
                // instead of silently believing the save agreed with it.
                savedStep: earnedStep,
                allowedStep: stepClaim.allowedStep,
                stepClamped: earnedStep !== null && Number.isFinite(submittedStep) && earnedStep !== submittedStep,
                stepsSaved: Object.keys(mergedSteps).length,
                // Non-blocking: the draft SAVED. This says whether the applicant's
                // ประเภทคำขอ answer was granted, and if not, what to fix before submitting.
                lawNotice: law.notice,
                requestType: mergedFormData.requestType || 'NEW',
                certScope: mergedFormData.certScope || 'PLANTING',
                validation: stepValidation ? {
                    step: submittedStep,
                    valid: stepValidation.success,
                    errors: stepValidation.errors || [],
                } : null,
            },
        });
    } catch (error) {
        logger.error('[Applications Draft] Error:', error);
        // AppAudit AC4 (2026-05-15): never echo raw error.message — it may contain
        // PII (Prisma unique-constraint violations name the column AND value).
        return respondError(res, req, error, { message: 'Failed to save application' });
    }
});

/**
 * @swagger
 * /api/applications/submit:
 *   post:
 *     tags: [Applications]
 *     summary: Submit a DRAFT for review (HEALTH role only)
 *     description: |
 *       Transitions the applicant's draft into the canonical review workflow.
 *       Supports the three resubmit paths: DRAFT → PENDING_DOC_FEE,
 *       REVISION_REQUESTED → ASSIGNED_FOR_REVIEW, CAR_PENDING → CAR_REVIEWING.
 *       Workspace capability SUBMIT_APPLICATION is enforced when an active
 *       entity is on the request.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               applicationId:
 *                 type: string
 *               draftId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Submitted (or already in a submitted state); returns id + applicationNumber + status + nextRequiredAction
 *       403:
 *         description: HEALTH_ROLE_REQUIRED or CAPABILITY_DENIED
 *       404:
 *         description: Application draft not found
 *       409:
 *         description: INVALID_STATUS_FOR_SUBMIT — current status cannot submit
 *       422:
 *         description: APPLICATION_INCOMPLETE — required wizard fields missing
 *       500:
 *         description: Failed to submit application
 */
router.post('/submit', authenticateHealth, requireConsent, async (req, res) => {
    try {
        // V1-D D2: HEALTH-role gate — providers must not submit.
        if (rejectIfNotHealthRole(req, res)) { return; }
        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const payload = asObject(req.body);
        const requestedId = String(payload.applicationId || payload.draftId || '').trim();

        // Spec 2026-09-30 §3.1: every applicant read this door makes carries the
        // caller's holder scope.
        const submitScope = await holderScope(req);
        const draft = await applicationService.findDraftForSubmit({
            applicationId: requestedId || null,
            healthId: healthIdentity.healthId,
            holderScope: submitScope,
        });
        if (!draft) { return res.status(404).json({ success: false, error: 'Application draft not found' }); }
        // autosave-lost-reply fix round 2: is what the server holds the last save THIS page
        // made? The wizard sends the clock of its last applied draft save. When the stored
        // clock differs, another page (another tab) has saved since, possibly older answers,
        // and filing now would file those. 409 DRAFT_NOT_LATEST, nothing written; the wizard
        // saves its current answers once and submits again. No clock sent (no save from this
        // page, or an older client): not checked, as before.
        const submitClock = submitClockFrom(payload);
        if (submitClock) {
            const storedClock = asObject(asObject(draft.formData).draftSaveClock);
            if (storedClock.session !== submitClock.session || Number(storedClock.seq) !== submitClock.seq) {
                return res.status(409).json({
                    success: false,
                    code: 'DRAFT_NOT_LATEST',
                    error: 'The stored draft is not the last save from this page',
                });
            }
        }

        // M1.5 H4 — one door, one judge (spec 2026-08-15-m1.5-hardening-design.md
        // §H4). The role-in-the-header gate that used to stand here is deleted:
        // it could not see GRANT rows, so it refused real grant holders. The
        // effective-permission engine decides alone. A null holder is refused by
        // the guard; it is never healed to the caller's personal entity
        // (spec 2026-09-30 §3.2 + C3: that heal could make a person the holder
        // of a company's filing — heal-null-holders.js places legacy rows).
        let onBehalfOfEntityId = null;
        try {
            ({ entityId: onBehalfOfEntityId } = await assertSubmitAllowed({
                userId: healthIdentity.userId,
                application: draft,
                auditContext: buildSubmitAuditContext(req),
                // The guard also re-checks a RENEWAL/REPLACEMENT claim's holder; its
                // certificate read carries this door's holder scope.
                holderScope: submitScope,
            }));
        } catch (guardErr) {
            if (guardErr instanceof SubmitGuardError) {
                return respondError(res, req, guardErr, { message: guardErr.message });
            }
            throw guardErr;
        }

        const currentStatus = upper(draft.status);
        if (currentStatus === 'PENDING_DOC_FEE') {
            // True no-op echo — the DB already holds this status, nothing to
            // write, nothing to audit.
            return res.json({ success: true, data: { id: draft.id, applicationNumber: draft.applicationNumber, status: 'PENDING_DOC_FEE' }, nextRequiredAction: 'PAY_PHASE_1' });
        }
        if (currentStatus === 'SUBMITTED') {
            // F-SUBMIT-ECHO-LIES fix (task-3, 2026-08-18) — Fix round 1 (Ruling 6):
            // this branch used to hardcode-echo status:'PENDING_DOC_FEE'/
            // nextRequiredAction:'PAY_PHASE_1' without writing anything — the DB
            // row stayed SUBMITTED and zero audit rows were produced (found by a
            // real-DB walk). The FIRST fix (self-heal: auto-advance to
            // PENDING_DOC_FEE here) was WRONG and has been reverted: the bundle
            // submit door (application-bundles.js:523-556) legitimately parks
            // member applications at bare SUBMITTED BY DESIGN — no hop 2, no
            // per-member quotations, because a bundle bills once, not per member.
            // The applicant id-lookup this route uses (findDraftForSubmit /
            // application-applicant-query-methods.js:196-215) carries no status
            // filter and cannot distinguish "stray front-door SUBMITTED" from "a
            // legitimate bundle member" — an auto-advance here would silently
            // pull a bundled member out of its bundle's billing model and mint it
            // an individual (unissued) PENDING_DOC_FEE with no back-edge
            // (workflow-transition-service.js ALLOWED_TRANSITIONS.PENDING_DOC_FEE
            // has no path home to SUBMITTED, :52) — irreversible bundle/member
            // divergence. The lie was the bug; the advance was never required.
            // Perform NO transition — answer with the REAL status this request
            // read from the DB, and an honest nextRequiredAction meaning
            // "still being processed", never a fabricated PAY_PHASE_1.
            return res.json({
                success: true,
                data: { id: draft.id, applicationNumber: draft.applicationNumber, status: 'SUBMITTED' },
                nextRequiredAction: 'WAIT_PROCESSING',
            });
        }

        // Resubmit support — Wave E.1-B (2026-05-03).
        //
        // The original whitelist `['REGISTERED', 'DRAFT']` rejected the
        // two legitimate resubmit paths the state machine allows:
        //   - REVISION_REQUESTED → ASSIGNED_FOR_REVIEW (applicant fixed
        //     issues flagged by document reviewer; goes back to reviewer
        //     queue, no re-payment needed)
        //   - CAR_PENDING → CAR_REVIEWING (applicant submits CAR; goes
        //     back to auditor for review)
        //
        // ALLOWED_TRANSITIONS in workflow-transition-service.js already
        // defines both edges. Without this fix, applicants who got a
        // revision request couldn't re-submit at all — they'd hit the
        // wizard, edit, click Submit, and get an opaque 409 with no
        // recovery path. Production-blocking UX gap.
        //
        // Map: currentStatus → { toStatus, action, message, nextAction }
        const RESUBMIT_TARGET = {
            DRAFT:               { toStatus: 'PENDING_DOC_FEE',     action: 'APPLICATION_SUBMITTED',  reason: 'APPLICATION_SUBMITTED → DOC_FEE_PAYMENT_REQUIRED', nextAction: 'PAY_PHASE_1',     msgTitle: 'ส่งคำขอสำเร็จ',          msgBody: 'ถูกส่งเข้าระบบแล้ว กรุณาชำระงวดที่ 1 ค่าบริการตรวจสอบเอกสาร' },
            REVISION_REQUESTED:  { toStatus: 'ASSIGNED_FOR_REVIEW', action: 'REVISION_RESUBMITTED',   reason: 'RESUBMIT_AFTER_REVISION',                          nextAction: 'WAIT_FOR_REVIEW', msgTitle: 'ส่งคำขอแก้ไขสำเร็จ',     msgBody: 'รอผู้ตรวจเอกสารพิจารณา' },
            CAR_PENDING:         { toStatus: 'CAR_REVIEWING',       action: 'CAR_RESUBMITTED',        reason: 'RESUBMIT_AFTER_CAR',                               nextAction: 'WAIT_FOR_REVIEW', msgTitle: 'ส่งหลักฐานการแก้ไขสำเร็จ',msgBody: 'รอผู้ตรวจสถานที่พิจารณา' },
        };
        const resubmitConfig = RESUBMIT_TARGET[currentStatus];
        if (!resubmitConfig) {
            return res.status(409).json({
                success: false,
                error: 'INVALID_STATUS_FOR_SUBMIT',
                message: `Cannot submit application from status ${draft.status}`,
                messageTh: `ไม่สามารถส่งคำขอจากสถานะ ${draft.status}`,
            });
        }

        // Bug 6.5: a REVISION_REQUESTED / CAR_PENDING resubmit must respect the
        // 5-working-day revision deadline (same rule submitRevision enforces).
        // Past the deadline the application EXPIRES here and the resubmit is
        // rejected — otherwise this front-door /submit path let overdue
        // applicants slip past the window submitRevision guards.
        if (currentStatus === 'REVISION_REQUESTED' || currentStatus === 'CAR_PENDING') {
            const { expired } = await assertRevisionNotExpired(draft, {
                prisma,
                actorUserId: healthIdentity.userId,
                actorRole: req.user.canonicalRole || req.user.role || 'health',
            });
            if (expired) {
                return res.status(400).json({
                    success: false,
                    error: 'Revision deadline exceeded. Application expired.',
                    code: 'REVISION_DEADLINE_EXCEEDED',
                });
            }
        }

        const currentFormData = asObject(draft.formData);
        const mergedSteps = mergeMasterSteps(currentFormData, payload);

        // Operator ruling 2026-10-05 — a filing is submitted only with a non-empty subset of the
        // three purposes a ภ.ท. licence backs. The draft door lets an unfinished list through;
        // this door does not.
        const purposeVerdict = assessPurposes(currentFormData.certificationPurposes);
        if (!purposeVerdict.ok) { return respondPurposeInvalid(res, purposeVerdict); }

        // C2 — validation is gated on the PAYLOAD SHAPE, not run blindly.
        // Ruling 7 (task-3 fix round 1): the legacy-vs-canonical decision and
        // both validator calls live in validateSubmissionPayload — the exact
        // gate the revision door's DRAFT leg now also runs, so an incomplete
        // filing cannot reach PENDING_DOC_FEE (and mint quotations) through
        // that door either. Both failure shapes still return the same
        // { errorsByStep } envelope the FE consumes.
        const validation = validateSubmissionPayload({ currentFormData, payload, application: draft });
        if (!validation.isValid) {
            return res.status(422).json({
                success: false,
                error: 'APPLICATION_INCOMPLETE',
                message: 'กรุณากรอกข้อมูลให้ครบถ้วนก่อนส่งคำขอ',
                errorsByStep: validation.errorsByStep,
                ...(validation.missingFields ? { missingFields: validation.missingFields } : {}),
            });
        }

        const nowIso = new Date().toISOString();
        const workflowHistory = asArray(draft.workflowHistory);

        // For DRAFT, the application passes through SUBMITTED before
        // landing in PENDING_DOC_FEE. The state machine defines this as TWO legal
        // edges (DRAFT→SUBMITTED, SUBMITTED→PENDING_DOC_FEE) and the frontend
        // status-mapping treats SUBMITTED ("ยื่นแล้ว, รอแจ้งชำระ") and
        // PENDING_DOC_FEE ("ชำระค่าธรรมเนียม") as distinct stages. WF-F5: the
        // status COLUMN must walk both hops too — previously it jumped straight
        // to PENDING_DOC_FEE (an illegal DRAFT→PENDING_DOC_FEE edge that only
        // survived because the writer doesn't assert transitions) while the
        // history already recorded the 2-event path, leaving column and history
        // inconsistent. For REVISION_REQUESTED / CAR_PENDING it stays a single
        // direct transition.
        const isInitialSubmit = currentStatus === 'DRAFT';

        // M2a — the document law (spec §3, AC1-3). This door is MIXED: the same
        // URL is the first filing and the two correction resubmits, so the mode
        // is taken from the predicate above rather than guessed from a status
        // inside the service (review H1).
        //
        //   DRAFT               → 'first-submit': read the rules in force NOW,
        //                         refuse what is missing, and stamp the set that
        //                         judged this filing onto formData below.
        //   REVISION_REQUESTED  → 'resubmit': judged by that stamp. A rule the
        //   CAR_PENDING           ministry files tomorrow must not 422 an
        //                         application that was compliant when filed (M-9).
        //
        // Placement: after the idempotent early return (an already-submitted
        // application answers 200 and is never re-judged), after the resubmit
        // target resolves, and before every write in this handler.
        let requirementStamp = null;
        try {
            const { appliedRules } = await assertRequiredDocumentsPresent({
                application: draft,
                mode: isInitialSubmit ? MODE_FIRST_SUBMIT : MODE_RESUBMIT,
                holderScope: submitScope,
            });
            if (isInitialSubmit) {
                requirementStamp = buildRequirementSnapshot(appliedRules);
            }
        } catch (docErr) {
            if (isSubmitGateRefusal(docErr)) {
                return respondSubmitGateRefusal(res, docErr);
            }
            throw docErr;
        }

        // กทล.๑ ส่วนที่ ๔ — nobody's filing is submitted without their certification,
        // and the platform writes the time itself. The client says only "accepted".
        // Placed AFTER the document gate on purpose: a filing missing papers should
        // hear about the papers first, since that is the longer piece of work.
        let declarationsAcceptedAt;
        try {
            ({ acceptedAt: declarationsAcceptedAt } = resolveDeclarationsAcceptance({
                formData: currentFormData,
                payload,
                isFirstSubmit: isInitialSubmit,
            }));
        } catch (declErr) {
            if (declErr && declErr.code === DECLARATIONS_REQUIRED) {
                return res.status(422).json({
                    success: false,
                    error: DECLARATIONS_REQUIRED,
                    code: DECLARATIONS_REQUIRED,
                    message: declErr.message,
                    // `message` is a reserved envelope key and is stripped from every
                    // non-2xx body by the browser client; messageTh survives.
                    messageTh: declErr.messageTh,
                });
            }
            throw declErr;
        }

        // เคสทั้งหมดที่การกดครั้งนี้สร้าง — ประกาศนอกทั้งทรานแซกชันและนอกทั้งสองขา เพราะการ
        // ออกใบเสนอราคา การแจ้งเตือน และคำตอบของประตู อยู่หลังทั้งคู่ · ขาเยื่นซ้ำไม่แตกเคส:
        // คำขอที่ถูกส่งกลับมาแก้ ถือลักษณะพื้นที่แบบเดียวมาตั้งแต่ตอนยื่นครั้งแรกแล้ว
        let submittedCases = [];
        let submittedBundleId = draft.bundleId ?? null;

        if (isInitialSubmit) {
            // A0 / PR-A0-2 — the two hops below are ONE business act ("the
            // applicant submitted"), so they get ONE transaction.
            //
            // Before this, each hop ran on the bare client and therefore in its
            // own implicit transaction (post-PR-A0-1 the writer opens a short
            // internal one so its UPDATE and its canonical audit row stay atomic
            // WITH EACH OTHER — application-status-writer.js:796-816). That fixed
            // the audit hole but not the pair: a failure on hop 2 committed hop 1,
            // parking the application in SUBMITTED with a committed
            // DRAFT→SUBMITTED audit row and no doc-fee leg — a state no reviewer
            // queue polls and the applicant cannot leave.
            //
            // WHAT THIS TRANSACTION DOES AND DOES NOT GUARANTEE — the honest
            // version (PR-A0-2 audit round 1, F4; an earlier revision of this
            // comment claimed everything below "lands or vanishes together",
            // which is false for the audit rows):
            //
            //   ATOMIC — either every one of these commits, or none does:
            //     • the two status UPDATEs (DRAFT→SUBMITTED, SUBMITTED→PENDING_DOC_FEE)
            //     • whatever work-activity rows the writer's fenced block manages
            //       to write (application-status-writer.js:1151+); they join this
            //       transaction and are discarded with it if it rolls back
            //
            //   BEST-EFFORT, NOT ATOMIC — can be absent while the hops commit:
            //     • the two canonical APPLICATION_STATUS_TRANSITION rows. The
            //       writer emits them behind a SAVEPOINT fence that is
            //       deliberately fail-OPEN (`runFencedBestEffort`): if an audit
            //       INSERT fails, the fence unwinds JUST that row and the status
            //       write still commits. So a committed hop with NO canonical row
            //       is a reachable state, by design, until the fail-closed flip
            //       that design-decision.md §2 schedules for the contract PR.
            //       (This is recorded as AMBIGUOUS A6 in design-decision.md —
            //       it is in tension with INVARIANT A0 clause (1) "+1 พอดี".)
            //     • the same is true of the work-activity rows: fenced, so a
            //       failure costs the rows, not the hops.
            //
            // Deliberately OUTSIDE this tx: the quotation issuance below — it is
            // fire-and-forget and idempotent by (applicationId, issuerType), so
            // pulling it in would trade a documented retry for a longer tx.
            //
            // ALSO IN THIS TRANSACTION, and deliberately: the Farm row (F-QA-06). It is
            // written FIRST so both hops can stamp the pointer to it, and it is
            // FAIL-CLOSED — if the farm write fails, the whole submit rolls back, the
            // filing stays DRAFT, and the farmer presses ยื่นคำขอ again. The alternative
            // (best-effort, submit stands without a farm) is exactly the state this fix
            // exists to end: a filing that satisfies documents, both payments,
            // scheduling, photographs and the 24-item checklist, and is then refused at
            // the certificate. Neither branch can leave a half-submitted filing: the two
            // hops are atomic with each other and with this write.
            let materializedFarmId = null;
            await prisma.$transaction(async (tx) => {
                // FIRST statement of the transaction: a RENEWAL/REPLACEMENT claim takes the
                // per-certificate advisory lock the renewal door takes, then refuses when
                // another filing of that certificate is in flight (409, nothing written).
                await lockAndAssertNoSuccessionInFlight(tx, {
                    application: draft, userId: healthIdentity.userId, holderScope: submitScope,
                    auditContext: buildSubmitAuditContext(req),
                });
                // The farm this filing is about. Only for filings the six-step กทล.๑
                // wizard wrote — a boundary, not a migration (the W14 lesson, one flow
                // over): a legacy-shaped filing states its site in the PREVIOUS
                // wizard's vocabulary, which certificate issuance already reads and
                // mints from (resolveFarmForCertificate), so minting one here would
                // change the meaning of filings already in flight to fix nothing.
                if (isKatorlor1Filing(currentFormData)) {
                    ({ farmId: materializedFarmId } = await materializeFarmForFiling({
                        client: tx,
                        formData: currentFormData,
                        ownerId: healthIdentity.userId,
                        // The application's own dimensions — the submit guard has
                        // already refused a null holder, and organizationId is NOT NULL on the row.
                        entityId: draft.entityId ?? null,
                        organizationId: draft.organizationId,
                    }));
                }

                // ── ติ๊ก N ลักษณะพื้นที่ → N เคส ────────────────────────────────
                // operator 2026-09-11: "ขอเป็น 3 รูปแบบ > คนส่งคิวงานต้องเห็นเอกสาร 3 ชุด
                // ไม่ใช่ 1 ชุดรวม 3 รูปแบบ (เลขงาน เลขเคส หรือเลข ticket ต้องไม่เหมือนกัน)"
                //
                // อยู่ **หลัง** การสร้างฟาร์ม และ **ใน** ทรานแซกชันเดียวกันโดยตั้งใจ:
                //   • หลัง เพราะที่ดินคือผืนเดียว ไม่ใช่สามผืน — ทุกเคสชี้ฟาร์มใบเดียวกัน
                //     และ materializedFarmId ต้องมีค่าแล้วก่อนฮ็อปแรกของเคสแรกจะประทับมัน
                //   • ใน เพราะถ้าการสร้างเคสที่สามล้มแล้วสองเคสแรกยังค้างอยู่ ผู้ยื่นจะเหลือ
                //     คำขอไม่ครบตามที่ติ๊ก และกดยื่นซ้ำให้ครบไม่ได้ (ร่างเดิมถูกหดไปแล้ว)
                //     ล้มทั้งยวง = ผู้ยื่นกดใหม่ได้ ซึ่งเป็นสถานะที่ซ่อมตัวเองได้
                //
                // ติ๊กเดียวไม่สร้าง bundle และคืนร่างเดิมใบเดียว ⇒ ลูปข้างล่างเดินรอบเดียว
                // และผู้ยื่นที่ขอรูปแบบเดียวไม่เห็นอะไรเปลี่ยนเลย
                //
                // กรองด้วย `isKatorlor1Filing` ด่านเดียวกับที่การสร้างฟาร์มข้างบนใช้ และด้วย
                // เหตุผลเดียวกัน — **ขอบเขต ไม่ใช่การย้ายข้อมูล** (บทเรียน W14): คำขอรูปเก่า
                // ระบุวิธีปลูกด้วยคำของวิซาร์ดรุ่นก่อน (`cultivationMethods` / `plots[].solarSystem`)
                // ไม่มี `farmData.areaTypes` ให้แตกเลย · ถ้าปล่อยให้ตัวแตกเคสตัดสินคำขอเหล่านั้น
                // มันจะปฏิเสธด้วย FAN_OUT_NO_AREA_TYPE — คือไปปิดประตูใส่คำขอที่ยื่นได้มาตลอด
                // เพื่อแก้ปัญหาที่คำขอเหล่านั้นไม่มี
                if (isKatorlor1Filing(currentFormData)) {
                    ({ cases: submittedCases, bundleId: submittedBundleId } = await fanOutByAreaType({
                        draft,
                        client: tx,
                    }));
                } else {
                    submittedCases = [draft];
                }

                for (const filingCase of submittedCases) {
                    // คำตอบของเคสนี้ — เหมือนต้นฉบับทุกอย่าง ยกเว้นถือลักษณะพื้นที่แบบเดียว
                    // (ตัวแตกเคสหดให้แล้วตอนเขียนแถว) · ประวัติเป็นของแถวนั้นจริง ๆ: เคสพี่น้อง
                    // ที่เพิ่งถูกสร้างไม่เคยมีเหตุการณ์ใดมาก่อน จะยืมประวัติของร่างเดิมไม่ได้
                    const caseFormData = asObject(filingCase.formData);
                    const caseHistory = asArray(filingCase.workflowHistory);
                    // Hop 1 — DRAFT → SUBMITTED. Carries the full form payload
                    // so a reader observing SUBMITTED sees the finalized steps.
                    await writeApplicationStatus({
                        prisma: tx,
                        applicationId: filingCase.id,
                        fromStatus: draft.status,
                        toStatus: 'SUBMITTED',
                        actorId: healthIdentity.userId,
                        actorRole: req.user.canonicalRole || req.user.role || 'health',
                        reason: 'APPLICATION_SUBMITTED',
                        additionalData: {
                            formData: {
                                ...caseFormData,
                                steps: mergedSteps,
                                // M2a — the law that judged this filing, stamped
                                // into the applicant's own blob (spread first, so
                                // nothing of theirs is lost) under a key listed in
                                // SERVER_OWNED_FORM_DATA_KEYS.
                                serverRequirementSnapshot: requirementStamp,
                                declarationsAcceptedAt,
                                // F-QA-06 — the farm this filing is about. The first thing
                                // certificate-service.resolveFarmForCertificate reads, and
                                // the reason a certificate can name where it applies.
                                ...(materializedFarmId ? { farmId: materializedFarmId } : {}),
                                workflowState: 'SUBMITTED',
                                workflowStateUpdatedAt: nowIso,
                                submittedAt: nowIso,
                            },
                            workflowHistory: [
                                ...caseHistory,
                                buildWorkflowEvent({ action: 'APPLICATION_SUBMITTED', fromStatus: draft.status, toStatus: 'SUBMITTED', actorId: healthIdentity.userId, actorRole: req.user.canonicalRole || req.user.role || 'health' }),
                            ],
                        },
                    });

                    // Hop 2 — SUBMITTED → PENDING_DOC_FEE (doc-fee payment required).
                    // WF-F4: this hop is an automatic system advance into phase-1
                    // billing, not a user action — the canonical dictionary §1.3 owns
                    // SUBMITTED->PENDING_DOC_FEE under `system`. actorId keeps the
                    // triggering applicant for traceability; actorRole is `system` so
                    // the audit trail (and any future strict-mode validation) reflects
                    // that the platform, not the applicant, performed the advance.
                    // ต่ออายุไปรอค่าตรวจพื้นที่โดยตรง ไม่ผ่านด่านตรวจเอกสาร (มติ operator 2026-09-07)
                    const entryState = entryStateForSubmission(caseFormData);
                    const entryReason = entryState === 'PENDING_AUDIT_FEE'
                        ? 'APPLICATION_SUBMITTED → AUDIT_FEE_PAYMENT_REQUIRED (renewal skips document review)'
                        : 'APPLICATION_SUBMITTED → DOC_FEE_PAYMENT_REQUIRED';
                    await writeApplicationStatus({
                        prisma: tx,
                        applicationId: filingCase.id,
                        fromStatus: 'SUBMITTED',
                        toStatus: entryState,
                        actorId: healthIdentity.userId,
                        actorRole: 'system',
                        reason: entryReason,
                        additionalData: {
                            formData: {
                                ...caseFormData,
                                steps: mergedSteps,
                                // Repeated, not redundant: this hop rebuilds
                                // formData from the PRE-submit copy, so a stamp
                                // written only on hop 1 would be erased by the very
                                // next statement in the same transaction.
                                serverRequirementSnapshot: requirementStamp,
                                declarationsAcceptedAt,
                                // Repeated for the same reason the requirement stamp above
                                // is: this hop rebuilds formData from the PRE-submit copy,
                                // so a key written only on hop 1 would be erased by the very
                                // next statement in the same transaction.
                                ...(materializedFarmId ? { farmId: materializedFarmId } : {}),
                                workflowState: entryState,
                                workflowStateUpdatedAt: nowIso,
                                submittedAt: nowIso,
                            },
                            workflowHistory: [
                                ...caseHistory,
                                buildWorkflowEvent({ action: 'APPLICATION_SUBMITTED', fromStatus: draft.status, toStatus: 'SUBMITTED', actorId: healthIdentity.userId, actorRole: req.user.canonicalRole || req.user.role || 'health' }),
                                buildWorkflowEvent({
                                    action: entryState === 'PENDING_AUDIT_FEE' ? 'AUDIT_FEE_PAYMENT_REQUIRED' : 'DOC_FEE_PAYMENT_REQUIRED',
                                    fromStatus: 'SUBMITTED', toStatus: entryState,
                                    actorId: healthIdentity.userId, actorRole: 'system',
                                }),
                            ],
                        },
                    });
                }
            });
        } else {
            // R2 M7 (D-6): the correction resubmit OVERWRITES Application.formData
            // (EXPAND — the column still holds the latest working copy). In the
            // SAME transaction we ALSO append an immutable
            // CorrectionSubmissionVersion so this round's submitted formData
            // survives the overwrite (keyed off the M3 round ledger). A duplicate
            // round submission (P2002) rolls the whole tx back — the previous
            // version is protected. This is the only correction resubmit branch;
            // the DRAFT initial-submit path above is left untouched.
            const resubmitFormData = {
                ...currentFormData,
                steps: mergedSteps,
                // Carried, not re-stamped: a resubmit stands on the acceptance
                // already recorded, and the gate above returns that same value.
                declarationsAcceptedAt,
                workflowState: resubmitConfig.toStatus,
                workflowStateUpdatedAt: nowIso,
            };
            await prisma.$transaction(async (tx) => {
                await writeApplicationStatus({
                    prisma: tx,
                    applicationId: draft.id,
                    fromStatus: draft.status,
                    toStatus: resubmitConfig.toStatus,
                    actorId: healthIdentity.userId,
                    actorRole: req.user.canonicalRole || req.user.role || 'health',
                    reason: resubmitConfig.reason,
                    additionalData: {
                        formData: resubmitFormData,
                        workflowHistory: [
                            ...workflowHistory,
                            buildWorkflowEvent({ action: resubmitConfig.action, fromStatus: draft.status, toStatus: resubmitConfig.toStatus, actorId: healthIdentity.userId, actorRole: req.user.canonicalRole || req.user.role || 'health' }),
                        ],
                    },
                });
                await snapshotCorrectionSubmission({
                    prisma: tx,
                    applicationId: draft.id,
                    fromStatus: currentStatus,
                    formDataSnapshot: resubmitFormData,
                });
            });
        }
        // ทุกเคสที่การกดครั้งนี้พาไปถึงปลายทาง · ขาเยื่นซ้ำไม่ผ่านตัวแตกเคส จึงเป็นใบเดิม
        // ใบเดียว — เขียนเป็น fallback ตรงนี้แทนที่จะแยกสองทางในทุกขั้นตอนข้างล่าง
        const caseIds = submittedCases.length > 0 ? submittedCases.map((c) => c.id) : [draft.id];
        const slices = [];
        for (const caseId of caseIds) {
            // ตามลำดับ ไม่ใช่ขนานกัน: ลำดับของ slices ต้องตรงกับ caseIds เป๊ะ เพราะ
            // ใบเสนอราคาและการแจ้งเตือนข้างล่างจับคู่กันด้วยดัชนี
            // eslint-disable-next-line no-await-in-loop
            slices.push(await applicationService.getApplicationSlice(caseId, {
                // `organizationId` is selected for the quotation-failure audit row
                // below. Without it the row falls back to tenant-context /
                // default-org resolution (middleware/audit-logger.js), so the one
                // record that says "this applicant cannot pay" would be filed under
                // the wrong tenant — on the door whose whole point is to be found.
                select: {
                    id: true, applicationNumber: true, status: true, organizationId: true,
                },
                holderScope: submitScope,
            }));
        }
        // คำตอบหลักยังเป็นร่างเดิมเสมอ — ตัวแตกเคสวางมันไว้เป็นเคสแรก และ id ที่ผู้ยื่น
        // (หรือลิงก์ที่เขาบุ๊กมาร์กไว้) ถืออยู่ ต้องยังชี้มาที่คำตอบนี้
        const updated = slices[0];

        // AC3 — the accepted act, and the entity it was made for.
        // ต่อเคส ไม่ใช่ต่อการกด — แต่ละเคสคือคำขอที่ถูกรับไว้หนึ่งใบ และผู้ตรวจสอบย้อนหลัง
        // ค้นด้วยเลขคำขอ ไม่ใช่ด้วย "ครั้งที่ผู้ยื่นกดปุ่ม"
        for (const slice of slices) {
            // eslint-disable-next-line no-await-in-loop
            await logSubmitAccepted({
                req,
                applicationId: slice.id,
                entityId: onBehalfOfEntityId,
                actorId: healthIdentity.userId,
                action: 'APPLICATION_SUBMIT_ACCEPTED',
                extraMetadata: {
                    fromStatus: currentStatus,
                    toStatus: resubmitConfig.toStatus,
                    ...(submittedBundleId ? { bundleId: submittedBundleId } : {}),
                },
            });
        }

        // Tier 18 / B18-A (2026-05-16) — auto-issue the application's
        // quotation on initial submit. The quotation-service is idempotent on
        // (applicationId, issuerType) so a retry caused by a transient DB error
        // or webhook replay does not duplicate.
        //
        // ONE quotation since W14 (quotation-service.js:563-578): the company
        // issues it and it carries the whole price — subtotal = ค่าบริการ,
        // vat = 7% of it, installments = [PHASE_1, PHASE_2]. The DTAM/PLATFORM
        // pair this comment used to describe survives only on pre-W14 rows.
        //
        // Resubmit paths (REVISION_REQUESTED / CAR_PENDING) skip this —
        // quotations are issued exactly once per application lifecycle.
        // F-G4-64 R3: AWAITED and reported. It used to be fire-and-forget with a
        // logger.warn, which was survivable while payment did not depend on the
        // quotation. It now does (services/billing/quotation-gate.js), so a
        // swallowed failure is an applicant who cannot pay and nobody told.
        // The already-committed status is NOT rolled back.
        //
        // A resubmit leg issues NOTHING and says so. It used to answer
        // { issued: true }, meaning "nothing to do here" — but a consumer reads
        // that as "this application has a price of record", and for the exact
        // applicant this change exists for (initial issuance failed, then a
        // revision resubmit) that sentence is false. `issued: null` is "not
        // known from this response"; the GET door is what answers the question.
        //
        // **หนึ่งใบต่อเคส ไม่ใช่หนึ่งใบต่อการกด** (operator 2026-09-11): "แก้ไขเป็นจ่ายเงิน
        // 3 ใบครับ เพราะ 3 ยอดรวมกันมันจะกระทบยอดกันยาก ระหว่างงวด 1 และงวด 2" ⇒ สาย
        // ใบเสนอราคา → ใบแจ้งหนี้ → ใบเสร็จ ของงวด 1 แนบกับของงวด 2 ได้ เพราะทั้งคู่ถือ
        // เลขคำขอเดียวกัน · ถ้าออกใบเดียวคลุมสามเคส จะไม่มีเลขใดผูกสองงวดเข้าด้วยกัน
        const quotationOutcomes = slices.map(() => ({ issued: null, reason: 'NOT_AN_ISSUANCE_LEG' }));
        if (isInitialSubmit) {
            const { issueQuotationOnSubmit } = require('../../../services/quotation-issuance-on-submit');
            for (let i = 0; i < slices.length; i += 1) {
                // eslint-disable-next-line no-await-in-loop
                quotationOutcomes[i] = await issueQuotationOnSubmit({
                    application: slices[i],
                    actorId: healthIdentity.userId,
                    actorRole: req.user.canonicalRole || req.user.role || 'health',
                    holderScope: submitScope,
                });
            }
        }
        const quotationOutcome = quotationOutcomes[0];

        // Applicant-facing notification — message + nextAction differ by
        // resubmit path. Routed through createNotification() so user
        // notification-channel preferences (email/SMS fanout) apply and
        // organizationId is resolved consistently regardless of caller
        // tenant context.
        //
        // ต่อเคส ไม่ใช่ต่อการกด · สามเคสคือสามใบแจ้งหนี้ที่ผู้ยื่นต้องจ่ายแยกกัน — ถ้าแจ้ง
        // ใบเดียวแล้วเอ่ยเลขเดียว ผู้ยื่นจะรู้จักคำขอของตัวเองแค่ใบเดียวจากสาม และอีกสองใบ
        // จะค้างรอชำระโดยไม่มีใครบอก · `applicationId` ในแต่ละใบพาไปที่หน้าชำระของเคสนั้น
        for (const slice of slices) {
            // eslint-disable-next-line no-await-in-loop
            await createNotification({
                userId: healthIdentity.userId,
                type: 'INFO',
                title: resubmitConfig.msgTitle,
                message: `คำขอเลขที่ ${slice.applicationNumber} ${resubmitConfig.msgBody}`,
                data: {
                    applicationId: slice.id,
                    applicationNumber: slice.applicationNumber,
                    action: resubmitConfig.action,
                    nextRequiredAction: resubmitConfig.nextAction,
                    fromStatus: currentStatus,
                    toStatus: resubmitConfig.toStatus,
                    ...(submittedBundleId ? { bundleId: submittedBundleId } : {}),
                },
            }).catch((notifyErr) => {
                logger.warn('[Applications Submit] notification failed:', notifyErr.message);
            });
        }

        // `quotation` tells the caller whether this application has a price of
        // record yet. { issued: false } is not a failed submission: the filing
        // stands, and the payments screen re-issues on read.
        return res.json({
            success: true,
            data: updated,
            nextRequiredAction: resubmitConfig.nextAction,
            quotation: quotationOutcome,
            // ทุกเคสที่การกดครั้งนี้สร้าง — `data` คือเคสแรกเสมอ ผู้เรียกรุ่นเก่าจึงไม่ต้อง
            // แก้อะไร แต่ผู้เรียกที่อ่านแค่ `data` จะเห็นคำขอเดียวจากสาม ⇒ ต้องมีที่ให้เห็น
            // ทั้งชุด · ติ๊กเดียว = อาเรย์ที่มีสมาชิกเดียวและ bundleId เป็น null
            cases: slices.map((slice, i) => ({
                id: slice.id,
                applicationNumber: slice.applicationNumber,
                status: slice.status,
                areaType: submittedCases[i] ? submittedCases[i].areaType : null,
                quotation: quotationOutcomes[i],
            })),
            bundleId: submittedBundleId,
        });
    } catch (error) {
        // ตัวแตกเคสปฏิเสธเพราะลักษณะพื้นที่ที่ติ๊กมาไม่ถูกต้อง — เป็นคำตอบต่อสิ่งที่ผู้ยื่นกรอก
        // ไม่ใช่ความผิดพลาดของระบบ · ปกติตัวตรวจคำขอกันไว้ก่อนถึงตรงนี้แล้ว แถวนี้คือชั้นสุดท้าย
        // ที่กันไม่ให้การกรอกผิดกลายเป็น 500 ที่ผู้ยื่นอ่านไม่ออกว่าต้องแก้อะไร
        if (error && (error.code === FAN_OUT_NO_AREA_TYPE || error.code === FAN_OUT_BAD_AREA_TYPE)) {
            return res.status(422).json({
                success: false,
                error: error.code,
                code: error.code,
                message: error.messageTh,
                messageTh: error.messageTh,
            });
        }
        if (error instanceof SubmitGuardError) {
            return respondError(res, req, error, { message: error.message });
        }
        logger.error('[Applications Submit] Error:', error);
        return respondError(res, req, error, { message: 'Failed to submit application' });
    }
});

router.post('/prepare', authenticateHealth, async (req, res) => {
    try {
        // V1-D D2: HEALTH-role gate — provider tokens denied.
        if (rejectIfNotHealthRole(req, res)) { return; }
        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        // B11: a body `entityId` never re-homes a draft, and never lands in formData.
        const { entityId: holderChoice, ...payload } = asObject(req.body);
        // same shared vocabulary check as POST /draft (fix round 4) — before anything is created
        const refusedPreparePurpose = refusedDraftPurposeClaim(payload);
        if (refusedPreparePurpose) { return respondPurposeInvalid(res, refusedPreparePurpose); }
        const application = await findOrCreateApplicationForHealth(healthIdentity, req.user,
            { ...payload, entityId: holderChoice }, await holderScope(req));
        const existingFormData = asObject(application.formData);
        const mergedSteps = mergeMasterSteps(existingFormData, payload);

        // F-G4-11 — /prepare accepts step-SCOPED legacy data (mergeMasterSteps
        // reads `steps: { "7": … }` here exactly as POST /draft does), so it is
        // a per-step door and gets the same refusal.
        //
        // What it deliberately does NOT do is refuse an INCOMPLETE application.
        // Completeness at this end of the wizard already has an owner: POST
        // /submit judges the whole canonical filing against a strictly higher
        // bar (validateCanonicalSubmission + the mandatory-document law) and
        // 422s with per-step errors. A second, looser completeness gate here
        // would be the same decision written twice (the project rules L4), and it would
        // change what this route accepts: `applications-prepare-active-entity`
        // and `applications-prepare-server-owned-fields` both exercise it with
        // deliberately partial payloads, because saving part of an application
        // is what it is for. Nothing is filed by preparing.
        const preparedFormData = { ...existingFormData, ...stripServerOwnedKeys(payload) };
        const prepareClaim = evaluateStepClaim(preparedFormData, LAST_FLOW_STEP);
        const unearnedPreparedStep = legacyWrittenSteps(payload).find((step) => step > prepareClaim.allowedStep);
        if (unearnedPreparedStep !== undefined) {
            return respondStepPrerequisiteUnmet(res, {
                requestedStep: unearnedPreparedStep,
                allowedStep: prepareClaim.allowedStep,
            });
        }

        const nowIso = new Date().toISOString();
        const workflowHistory = asArray(application.workflowHistory);

        // spec 2026-09-30 §3.2 (B11): /prepare never re-homes. `entityId` is chosen
        // at create and never written again; the body's `entityId` was taken out of
        // the payload above. (M1.5 H1: no Entity is ever materialised from the body.)

        // Review round 2 on main (operator ruling 2026-10-03) re-judged a RENEWAL or
        // REPLACEMENT claim when this door moved a draft to another holder. Under B11 it
        // never moves one, so a claim stays with the holder it was judged for, and the
        // submit guard re-checks it on every submit door (application-submit-guard).

        const updated = await applicationService.updateApplicantDraftColumns(application.id, {
            // stripServerOwnedKeys: formData is one blob shared by the wizard and
            // by staff/server writers, so spreading the raw body let an applicant
            // write the audit outcome, their own auditor assignment, their own CAR
            // and revision deadlines, and adminOverrides on their own application.
            // certificate-service reads formData.auditResult + auditedAt as proof
            // of a passing audit, so that pair in particular was a forgeable gate.
            // Stripping at the edge means existingFormData's server-owned values
            // survive the spread untouched.
            formData: { ...existingFormData, ...stripServerOwnedKeys(payload), steps: mergedSteps, lastPreparedAt: nowIso, workflowState: existingFormData.workflowState || application.status || 'DRAFT' },
            workflowHistory: [...workflowHistory, buildWorkflowEvent({ action: 'APPLICATION_PREPARED', actorId: healthIdentity.userId, actorRole: req.user.canonicalRole || req.user.role || 'health' })],
            updatedBy: healthIdentity.userId,
        }, {
            select: { id: true, applicationNumber: true, status: true },
        });

        return res.json({ success: true, data: updated });
    } catch (error) {
        logger.error('[Applications Prepare] Error:', error);
        return respondError(res, req, error, { message: 'Failed to prepare application' });
    }
});

router.post('/draft-documents', authenticateHealth, receiveDraftDocument, async (req, res) => {
    try {
        // V1-D D2: HEALTH-role gate — only applicants upload their own
        // draft documents.
        if (rejectIfNotHealthRole(req, res)) { return; }
        const payload = asObject(req.body);
        const slotId = String(payload.slotId || '').trim() || null;
        const uploadedFile = req.file;
        if (!uploadedFile) {
            // storage-service fileFilter rejects a spoofed/dangerous file via
            // cb(null,false) + a stashed reason (NOT a throw) so this returns a clean
            // 400 with the specific Thai reason instead of a 500 (drill fast-follow).
            if (req.uploadRejectionReason) {
                return res.status(400).json({ success: false, error: req.uploadRejectionCode || 'UPLOAD_REJECTED', message: req.uploadRejectionReason });
            }
            return res.status(400).json({ success: false, error: 'FILE_REQUIRED' });
        }

        // F-G4-08 — read what is actually in the file, and judge it against what
        // THIS slot accepts, before anything is created that would point at it.
        // The mimetype and the filename extension the fileFilter above checked
        // are both written by the sender; the leading bytes are not. A refused
        // file is unlinked, so a rejection leaves nothing behind.
        //
        // The Thai sentence goes in BOTH `error` and `message`: api-client reads
        // `error` for what it shows the user, and a farmer who somehow reaches
        // this door past the browser check must still be told the cause and the
        // next action, not "อัปโหลดไม่สำเร็จ".
        const contentVerdict = await uploadContentGuard.inspectStoredUpload(uploadedFile, slotId);
        if (!contentVerdict.ok) {
            await uploadContentGuard.discardRejectedUpload(uploadedFile);
            return res.status(400).json({
                success: false,
                error: contentVerdict.message,
                code: contentVerdict.code,
                message: contentVerdict.message,
            });
        }

        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        let application;
        try {
            application = await findOrCreateApplicationForHealth(healthIdentity, req.user, payload, await holderScope(req));
        } catch (holderErr) {
            // A refused draft (no holder named, a holder the caller may not edit, an
            // id that is not theirs) keeps no bytes: the stored file points at nothing.
            await uploadContentGuard.discardRejectedUpload(uploadedFile);
            throw holderErr;
        }

        const fileUrl = toUploadedFileUrl(uploadedFile);
        // multer decodes multipart filenames as latin1 → Thai filenames arrive
        // mojibake; recover the UTF-8 name before persisting/returning it (the
        // applicant sees this name back on the preview page).
        const safeFileName = storageService.decodeMultipartFilename(uploadedFile.originalname);
        const documentId = crypto.randomUUID();
        const stepKey = String(payload.stepKey || '').trim() || null;
        const nowIso = new Date().toISOString();
        const formData = asObject(application.formData);
        const existingDocs = asArray(formData.draftDocuments);
        // F-G4-15 — a slot holds one document, so a re-upload REPLACES the
        // entry that is there. Both sides go through the alias table
        // (validation-slot-utils): 'LICENSE_BT11' and 'license_bt11' are one
        // slot everywhere else in the system — in the mandatory-document
        // check, in the requirement snapshot, in application_documents — so a
        // raw string compare here was the one place where two spellings of
        // ภท.11 could sit in a farmer's list at the same time.
        //
        // An upload with no slotId replaces nothing: it belongs to no slot.
        const canonicalSlotId = slotId ? getCanonicalSlotId(slotId) : null;
        const filtered = canonicalSlotId
            ? existingDocs.filter((item) => getCanonicalSlotId(String(item?.slotId || '').trim()) !== canonicalSlotId)
            : existingDocs;

        // ช่องที่เจ้าหน้าที่กด "ผ่าน" แล้ว อัปทับไม่ได้ (operator 2026-09-11: "ถ้าเจ้าหน้าที่
        // ผ่านไปแล้ว ไม่สามารถกลับมาแก้เอกสารได้" · "ที่แก้ต้องเป็นเพราะยังไม่ผ่าน")
        //
        // ต้องอยู่ตรงนี้ ไม่ใช่ที่ isApplicantEditable (constants/applicant-editable-statuses.js): สถานะเป็นของ **ทั้งใบ** แต่เจ้าหน้าที่
        // ตัดสิน **รายช่อง** — คำขอที่ถูกตีกลับมีทั้งช่องที่ผ่านแล้วและช่องที่ต้องแก้อยู่ในใบเดียวกัน
        //
        // ไฟล์ถูกเขียนลงดิสก์โดย multer ไปแล้วตั้งแต่ก่อนเข้ามาถึงนี่ ⇒ ทิ้งให้เหมือนทาง
        // ที่ด่านตรวจเนื้อไฟล์ทำ ไม่งั้นการปฏิเสธจะทิ้งขยะไว้ทุกครั้ง
        try {
            assertSlotNotAlreadyAccepted({
                slotId: canonicalSlotId,
                reviews: await documentVerdictsOf(application.id),
            });
        } catch (lockErr) {
            if (lockErr && lockErr.code === 'DOCUMENT_SLOT_ALREADY_ACCEPTED') {
                await uploadContentGuard.discardRejectedUpload(uploadedFile);
                return res.status(409).json({
                    success: false,
                    error: lockErr.messageTh,
                    code: lockErr.code,
                    message: lockErr.messageTh,
                    messageTh: lockErr.messageTh,
                    slotId: lockErr.slotId,
                });
            }
            throw lockErr;
        }

        await applicationService.updateApplicantDraftColumns(application.id, {
            formData: { ...formData, draftDocuments: [...filtered, { documentId, fileName: safeFileName, fileUrl, mimeType: uploadedFile.mimetype, size: uploadedFile.size, slotId, stepKey, uploadedAt: nowIso }], lastDraftSavedAt: nowIso },
            updatedBy: healthIdentity.userId,
        });

        // Best-effort dual-write into the relational application_documents store
        // (the fraud-detection scan reads it). Never blocks the upload on failure.
        await applicationDocumentSync.syncApplicationDocument(prisma, {
            applicationId: application.id, documentId, slotId, stepKey,
            fileName: safeFileName, fileUrl, fileSize: uploadedFile.size,
            mimeType: uploadedFile.mimetype, uploadedBy: healthIdentity.userId,
            absolutePath: uploadedFile.path,
            // Its reads carry the holder scope (spec 2026-09-30 §3.1). It swallows
            // its own errors, so an unscoped read rejected by the witness in throw
            // mode would lose the row silently — the real-PG witness test checks it.
            holderScope: await holderScope(req),
        });

        // Document pre-check (warn-only, the officer decides): queue a local
        // check of this file for the in-scope slots. Never changes this
        // response — a failure here is logged and the upload stands.
        try {
            await documentPrecheck.enqueueForUpload({
                applicationId: application.id,
                organizationId: application.organizationId,
                documentId,
                slotId: canonicalSlotId,
                absPath: uploadedFile.path,
                mimeType: uploadedFile.mimetype,
            });
        } catch (precheckError) {
            logger.warn(`[Applications Draft Documents Upload] pre-check not queued (upload unaffected): ${precheckError.message}`);
        }

        return res.json({ success: true, data: { applicationId: application.id, draftId: application.id, documentId, fileName: safeFileName, fileUrl, mimeType: uploadedFile.mimetype, size: uploadedFile.size } });
    } catch (error) {
        logger.error('[Applications Draft Documents Upload] Error:', error);
        return respondError(res, req, error, { message: 'Failed to upload draft document' });
    }
});

router.get('/draft-documents', authenticateHealth, async (req, res) => {
    try {
        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const application = await loadNamedDraftForHealth(healthIdentity, req.user, req.query, await holderScope(req));
        const formData = asObject(application.formData);
        return res.json({ success: true, data: { applicationId: application.id, documents: asArray(formData.draftDocuments) } });
    } catch (error) {
        logger.error('[Applications Draft Documents List] Error:', error);
        return respondError(res, req, error, { message: 'Failed to list draft documents' });
    }
});

router.delete('/draft-documents/:documentId', authenticateHealth, async (req, res) => {
    try {
        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        const application = await loadNamedDraftForHealth(healthIdentity, req.user, req.query, await holderScope(req));
        const formData = asObject(application.formData);
        const existingDocs = asArray(formData.draftDocuments);
        const documentId = String(req.params.documentId || '').trim();
        const removedDocs = existingDocs.filter((item) => String(item?.documentId || '').trim() === documentId);
        const filtered = existingDocs.filter((item) => String(item?.documentId || '').trim() !== documentId);

        // ลบก็คือแก้ — ด่านเดียวกับการอัปทับ · ถ้าห้ามเปลี่ยนกระดาษที่ผ่านแล้ว แต่ยอมให้ลบทิ้ง
        // ช่องที่ผ่านแล้วจะกลายเป็นว่าง ทั้งที่มีแถว ACCEPTED ค้างอยู่ ซึ่งแย่กว่าการเปลี่ยน
        const verdicts = await documentVerdictsOf(application.id);
        for (const doc of removedDocs) {
            const removedSlot = String(doc?.slotId || '').trim();
            try {
                assertSlotNotAlreadyAccepted({
                    slotId: removedSlot ? getCanonicalSlotId(removedSlot) : null,
                    reviews: verdicts,
                });
            } catch (lockErr) {
                if (lockErr && lockErr.code === 'DOCUMENT_SLOT_ALREADY_ACCEPTED') {
                    return res.status(409).json({
                        success: false,
                        error: lockErr.messageTh,
                        code: lockErr.code,
                        message: lockErr.messageTh,
                        messageTh: lockErr.messageTh,
                        slotId: lockErr.slotId,
                    });
                }
                throw lockErr;
            }
        }

        await applicationService.updateApplicantDraftColumns(application.id, {
            formData: { ...formData, draftDocuments: filtered, lastDraftSavedAt: new Date().toISOString() },
            updatedBy: healthIdentity.userId,
        });

        // Keep the relational fraud-scan store in sync (best-effort).
        await applicationDocumentSync.removeApplicationDocument(prisma, application.id, documentId);

        // Document pre-check: the file's pre-check goes with the file —
        // SUPERSEDED, its page text and quoted snippets cleared. Same
        // discipline as the upload hook: never changes this response.
        if (removedDocs.length > 0) {
            try {
                await documentPrecheck.retireForDocument(documentId, {
                    applicationId: application.id,
                    organizationId: application.organizationId,
                });
            } catch (precheckError) {
                logger.warn(`[Applications Draft Documents Delete] pre-check not retired (delete unaffected): ${precheckError.message}`);
            }
        }

        // B3 — and remove the BYTES. Dropping the two records while leaving the
        // file on disk did not merely fail to delete it: the
        // `application_documents` row deleted above is the owner record
        // /uploads/application-drafts/* is authorized against, so the orphan it
        // left was readable by any logged-in user. The gate now fails closed
        // (middleware/uploads-access.js), but an applicant who presses delete on
        // a mis-attached ID-card scan is asking for the file to be gone, so
        // delete it. The path is derived from the
        // stored fileUrl and proved to live under the uploads root first, so a
        // poisoned record cannot turn this into an arbitrary file delete.
        await Promise.all(removedDocs.map((doc) => unlinkStoredDraftDocument(doc, application.id, documentId)));

        return res.json({ success: true, data: { applicationId: application.id, documentId, deleted: existingDocs.length !== filtered.length } });
    } catch (error) {
        logger.error('[Applications Draft Documents Delete] Error:', error);
        return respondError(res, req, error, { message: 'Failed to delete draft document' });
    }
});

/**
 * @swagger
 * /api/applications/draft:
 *   get:
 *     tags: [Applications]
 *     summary: Fetch the applicant's latest open DRAFT (HEALTH role)
 *     description: Returns the most recent open draft for the authenticated HEALTH user, or null when none exists.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Draft payload (data is null when no open draft exists)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     draftId:
 *                       type: string
 *                     applicationNumber:
 *                       type: string
 *                     areaType:
 *                       type: string
 *                     serviceType:
 *                       type: string
 *                     status:
 *                       type: string
 *                     formData:
 *                       type: object
 *                     steps:
 *                       type: object
 *       401:
 *         description: AUTH_ERROR — missing or invalid token
 *       500:
 *         description: Failed to fetch draft
 */
router.get('/draft', authenticateHealth, async (req, res) => {
    try {
        const healthIdentity = await applicationService.resolveHealthIdentity(req.user.id, getHealthScopeOptions(req.user));
        // Resume without an id (spec 2026-09-30 §3.2): the caller's OWN latest open
        // draft (submitterId = me) on a holder the caller may edit.
        const resumeScope = await holderScope(req);
        const draft = await applicationService.getLatestOpenDraftForApplicant({
            holderScope: resumeScope,
            submitterId: healthIdentity.userId,
            editIds: resumeScope.editIds,
        });
        if (!draft) { return res.json({ success: true, data: null }); }

        const formData = asObject(draft.formData);
        res.json({ success: true, data: { id: draft.id, draftId: draft.id, applicationNumber: draft.applicationNumber, areaType: draft.areaType, serviceType: draft.serviceType, entityId: draft.entityId ?? null, formData, steps: asObject(formData.steps), status: draft.status, createdAt: draft.createdAt, updatedAt: draft.updatedAt } });
    } catch (error) {
        logger.error('[Applications Draft GET] Error:', error);
        return respondError(res, req, error, { message: 'Failed to fetch draft' });
    }
});

router.delete('/draft/:id', authenticateHealth, async (req, res) => {
    try {
        // V1-D D2: HEALTH-role gate — provider tokens denied.
        if (rejectIfNotHealthRole(req, res)) { return; }
        const deleted = await applicationService.deleteDraft(req.user.id, req.params.id, {
            ...getHealthScopeOptions(req.user),
            holderScope: await holderScope(req),
        });
        return res.json({ success: true, data: { deleted: Boolean(deleted), draftId: deleted?.id || String(req.params.id || '').trim() || null } });
    } catch (error) {
        logger.error('[Applications Draft DELETE] Error:', error);
        return respondError(res, req, error, { message: 'Failed to delete draft' });
    }
});

// LISTING & TRACKING (extracted to application-listing-handlers.js)

const listingHandlers = require('./application-listing-handlers');
router.use('/', listingHandlers);

// WORKFLOW: REJECT, GET BY ID, REVISION, PDF (extracted to application-workflow-handlers.js)

const workflowHandlers = require('./application-workflow-handlers');
router.use('/', workflowHandlers);

// REQUIREMENTS: the one lens every surface reads (extracted to requirements.js)

const requirementsHandlers = require('./requirements');
router.use('/', requirementsHandlers);

module.exports = router;
