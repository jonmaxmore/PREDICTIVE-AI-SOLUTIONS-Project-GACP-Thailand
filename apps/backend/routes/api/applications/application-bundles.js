/**
 * Application Bundle Routes
 * GACP Requirement: ขอหลายใบรับรองพร้อมกัน (3 ใบ = 90,000 บาท)
 *
 * Schema alignment (2026-06): the ApplicationBundle model only persists
 * { bundleNumber, healthId, status, organizationId, applications }. Earlier
 * revisions of this router queried/wrote fields that no longer exist on the
 * model (`userId`, `bundleType`, `bundleName`, `totalFee`, `discount`,
 * `finalFee`, `paymentStatus`, `submittedAt`, `submittedBy`) and selected
 * non-existent Application relations (`farm`, `plantingCycles`). Every such
 * call raised a PrismaClientValidationError that the catch turned into a 500
 * — including the happy-path `GET /my`. Ownership is keyed on healthId (the
 * canonical FK used across the schema), matching the application listing
 * handlers. Fee figures have no columns to persist, so they are returned as a
 * non-persisted `pricingPreview`. organizationId is auto-injected by the
 * tenant prisma extension (ADR-014).
 */

const crypto = require('crypto');
const express = require('express');
// BE-EDGE-01: use the shared respondError (#314 pattern) so a Prisma
// validation/known error maps to the right 4xx instead of a blanket 500.
const { respondError, sendErrorResponse } = require('../../../shared/api-response');
const { lookup } = require('../../../shared/error-codes');
const router = express.Router();
const { prisma } = require('../../../services/prisma-database');
const { authenticateHealth } = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');
// R1a: import the canonical terminal set (SSOT) so a finished case (REJECTED /
// CERTIFIED / EXPIRED / CANCEL_EXPIRED) can never be re-linked or resurrected
// back to SUBMITTED via a bundle. Never re-declare state names here.
const { writeApplicationStatus, TERMINAL_STATUSES } = require('../../../services/application-status-writer');
// M1 (2026-08-15) — until now this door asked NOTHING about the entity behind
// each linked case, so enforcing the rule on POST /applications/submit alone
// would just move the traffic here (plan D4). Same guard, once per linked case.
const applicationService = require('../../../services/application-service');
// Spec 2026-09-30 §3.1 + ruling C8: a bundle stays owned by its filer
// (ApplicationBundle.healthId, no holder column). The by-id application lookup
// carries the holder fragment next to its filer pin; the included filings of
// a bundle read are left as they were in R1 (Task 9).
const { holderScope, r1ApplicationHolderOrPin, r1LegacyApplicantPin, r1HolderOrLegacy } = require('../../../services/holder-access');
const { assertSubmitAllowed, SubmitGuardError } = require('../../../services/application-submit-guard');
// M2a (2026-08-15) — every linked case is a first filing of its own, so each one
// is asked the document law separately (operator ruling G2, spec §3).
const {
    assertRequiredDocumentsPresent,
    buildRequirementSnapshot,
    isSubmitGateRefusal,
    respondSubmitGateRefusal,
    MODE_FIRST_SUBMIT,
} = require('../../../services/application-document-requirements');
const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../../../middleware/audit-logger');

// Per-application fee (THB). TRIPLE = 3 × 30,000 = 90,000.
const FEE_PER_APPLICATION = 30000;
const TRIPLE_BUNDLE_SIZE = 3;

// ApplicationBundle.healthId is an FK to User.canonicalId (schema:
// application.prisma `applicant User @relation(fields: [healthId], references:
// [canonicalId])`). canonicalId is the re-key TOKEN (DB-*Hmac-sourced, set by
// auth-middleware fetchIdentityFromDb), NOT the plaintext national ID — see
// shared/fk-token.js + middleware/auth-middleware.js:176-198 where
// req.user.healthId is the DECRYPTED plaintext and req.user.canonicalId is the
// token. We MUST prefer the token so (a) the bundle FK resolves against the
// re-keyed parent and (b) no plaintext 13-digit national ID ever lands in the
// application_bundles.healthId column. This single helper feeds BOTH
// applicationBundle.create AND every GET read filter (where:{healthId}), so the
// write key and the read key stay byte-for-byte consistent. The legacy fallback
// to req.user.healthId only covers pre-re-key sessions whose token column is
// null (flag OFF), where canonicalId == healthId anyway.
function normalizeHealthId(req) {
    return String(req.user?.canonicalId || req.user?.healthId || '').trim();
}

function buildBundleNumber() {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    // CSPRNG per the auth-hardening gate: no weak PRNG in runtime backend
    // code. 4 hex chars of crypto entropy as the collision tag.
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `BND-${timestamp}-${suffix}`;
}

function buildBundlePricing(applicationCount) {
    const safeCount = Math.max(0, Number.parseInt(String(applicationCount || 0), 10) || 0);
    const grandTotal = safeCount * FEE_PER_APPLICATION;
    return {
        applicationCount: safeCount,
        feePerApplication: FEE_PER_APPLICATION,
        grandTotal,
    };
}

function serializeBundle(bundle) {
    const applications = Array.isArray(bundle?.applications) ? bundle.applications : [];
    return {
        ...bundle,
        pricingPreview: buildBundlePricing(applications.length),
    };
}

const APPLICATION_SUMMARY_SELECT = {
    id: true,
    applicationNumber: true,
    serviceType: true,
    areaType: true,
    status: true,
};

async function getOwnedBundle(id, healthId, include = undefined) {
    return prisma.applicationBundle.findFirst({
        where: { id, healthId },
        include,
    });
}

// The add/remove doors write the application's bundleId, so in R1 the lookup
// keeps its filer pin AND carries the holder fragment (it can only narrow);
// Task 9 replaces the pin with the spec §3.3 owner-or-creator rule (C8).
async function getOwnedApplication(applicationId, healthId, scope) {
    return prisma.application.findFirst({
        where: {
            id: applicationId,
            // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere(scope, 'Application')).
            // OR form: neutral also when no entity context is bound (final review C1).
            ...r1ApplicationHolderOrPin(scope, { healthId }),
            isDeleted: false,
        },
    });
}

// R1a terminal-integrity gate. A bundle is an applicant-facing (authenticateHealth)
// path, so without this a caller could pull one of their OWN finished cases into a
// bundle and let the submit loop's writeApplicationStatus() shove it back to
// SUBMITTED. Membership test uses the writer's exported TERMINAL_STATUSES only.
function findTerminalApplication(applications) {
    const list = Array.isArray(applications) ? applications : [];
    return list.find((appRow) => appRow && TERMINAL_STATUSES.has(appRow.status)) || null;
}

// ARCH-01 (audit 2026-09-17) — the terminal gate above is not enough. A bundle
// only files drafts: its submit writes SUBMITTED onto every linked case, so a
// case that is still alive but already past DRAFT (paying a fee, under review,
// inside a revision/CAR deadline, APPROVED with a certificate minted) would be
// dragged back to the intake queue by its own applicant. Only DRAFT may be
// linked or submitted here. Terminal cases hit the terminal gate first and keep
// their more specific code.
const BUNDLE_LINKABLE_STATUS = 'DRAFT';

function findNonDraftApplication(applications) {
    const list = Array.isArray(applications) ? applications : [];
    return list.find((appRow) => appRow && appRow.status !== BUNDLE_LINKABLE_STATUS) || null;
}

// Reject the whole request with a catalogued row (code + messageEn + curated
// messageTh). Mirrors the consent.js idiom rather than respondError() because
// respondError's explicit-statusCode branch omits messageTh. No DB write has
// happened at any gate call site before this fires.
function respondBundleRefusal(res, req, catalogKey) {
    const row = lookup(catalogKey);
    return sendErrorResponse(res, req, {
        status: row.httpStatus,
        code: row.code,
        message: row.messageEn,
        messageTh: row.messageTh,
    });
}

// M1 — the audit context handed to the guard (see applications.js for the full
// note on why activeEntityId is recorded next to the entity actually checked).
function buildSubmitAuditContext(req) {
    return {
        actorType: 'USER',
        actorRole: req.user?.canonicalRole || req.user?.role || null,
        ipAddress: req.ip || null,
        userAgent: typeof req.get === 'function' ? req.get('user-agent') : null,
        organizationId: req.user?.organizationId || null,
        activeEntityId: req.activeEntity?.entityId || null,
        route: `${req.method} ${req.baseUrl || ''}${req.path || ''}`,
    };
}

// M1 (review M2) — a linked case that pre-dates Phase 66 carries a null
// entityId. Heal it from the caller's personal entity exactly as the /draft
// path does, then let the guard decide; otherwise those rows become
// permanently un-submittable through any door.
async function healLinkedApplicationEntityId(linkedApp, healthIdentity) {
    if (!linkedApp || linkedApp.entityId) { return linkedApp; }
    const personalEntity = await applicationService.findPersonalEntityForHealthIdentity(healthIdentity);
    if (!personalEntity?.id) { return linkedApp; }
    const healed = await applicationService.healDraftEntityColumns(linkedApp.id, {
        entityId: personalEntity.id,
        submitterId: healthIdentity?.userId || null,
    });
    return { ...linkedApp, entityId: healed?.entityId || personalEntity.id };
}

// M1 AC3 — the accepted act and the entity it was made for. Standalone
// `auditLogger.log()` AFTER the business transaction: it opens its own
// transaction and takes its own advisory lock (audit-logger.js:479,505-506),
// which must never be nested inside another interactive transaction.
async function logBundleSubmitAccepted({ req, bundleId, applicationId, entityId, actorId }) {
    const ctx = buildSubmitAuditContext(req);
    try {
        await auditLogger.log({
            category: AuditCategory.APPLICATION,
            action: 'APPLICATION_SUBMIT_ACCEPTED',
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
                activeEntityId: ctx.activeEntityId,
                permission: 'SUBMIT_APPLICATION',
                applicationId,
                bundleId,
                route: ctx.route,
            },
        });
    } catch (auditErr) {
        logger.warn(`[ApplicationBundle] accepted-audit write failed (non-fatal): ${auditErr?.message}`);
    }
}

// Get all bundles for current user
router.get('/my', authenticateHealth, async (req, res) => {
    try {
        const healthId = normalizeHealthId(req);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // R1: the included filings are not narrowed (the pre-R1 include was never
        // entity-scoped). Task 9 decides the bundle read (ruling C8).
        const bundles = await prisma.applicationBundle.findMany({
            where: { healthId },
            include: { applications: { select: APPLICATION_SUMMARY_SELECT } },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ success: true, data: bundles.map(serializeBundle) });
    } catch (error) {
        logger.error('[ApplicationBundle] Get error:', error);
        respondError(res, req, error, { log: false });
    }
});

// Get bundle by ID
router.get('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const healthId = normalizeHealthId(req);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const bundle = await getOwnedBundle(id, healthId, {
            applications: {
                select: { ...APPLICATION_SUMMARY_SELECT, createdAt: true, updatedAt: true },
            },
        });

        if (!bundle) {
            return res.status(404).json({ success: false, error: 'Bundle not found' });
        }

        res.json({ success: true, data: serializeBundle(bundle) });
    } catch (error) {
        logger.error('[ApplicationBundle] Get by ID error:', error);
        respondError(res, req, error, { log: false });
    }
});

// Create new bundle
router.post('/', authenticateHealth, async (req, res) => {
    try {
        const healthId = normalizeHealthId(req);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const { bundleType } = req.body || {};
        const requestedApplicationIds = Array.isArray(req.body?.applications)
            ? req.body.applications.filter((value) => typeof value === 'string' && value.trim())
            : [];

        // Input validation (bundleType is a request-shaping hint; it is not persisted).
        if (bundleType !== undefined && !['TRIPLE', 'CUSTOM'].includes(bundleType)) {
            return res.status(400).json({ success: false, error: 'Invalid bundle type' });
        }
        if (bundleType === 'TRIPLE' && requestedApplicationIds.length !== TRIPLE_BUNDLE_SIZE) {
            return res.status(400).json({ success: false, error: 'TRIPLE bundle requires exactly 3 applications' });
        }

        // Resolve the caller's OWN candidates first so the terminal gate can
        // reject the whole request BEFORE any row is written (no orphan bundle).
        let ownedCandidates = [];
        if (requestedApplicationIds.length > 0) {
            ownedCandidates = await prisma.application.findMany({
                where: {
                    id: { in: requestedApplicationIds },
                    // Spec 2026-09-30 §3.1; the bundle stays the filer's (ruling C8),
                    // so R1 keeps the pre-R1 healthId pin beside the fragment.
                    // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere): the pre-R1 pin decides.
                    ...r1HolderOrLegacy(await holderScope(req), 'Application', { healthId }),
                    ...r1LegacyApplicantPin({ healthId }),
                    isDeleted: false,
                },
                select: { id: true, status: true },
            });
            // R1a link-time gate: never fold a finished case into a fresh bundle.
            if (findTerminalApplication(ownedCandidates)) {
                return respondBundleRefusal(res, req, 'BUNDLE_TERMINAL_APPLICATION');
            }
            // ARCH-01 link-time gate: nor a live case that has left DRAFT.
            if (findNonDraftApplication(ownedCandidates)) {
                return respondBundleRefusal(res, req, 'BUNDLE_APPLICATION_NOT_DRAFT');
            }
        }

        const bundle = await prisma.applicationBundle.create({
            data: {
                bundleNumber: buildBundleNumber(),
                healthId,
                status: 'DRAFT',
            },
        });

        // Link only applications the caller actually owns (ignores foreign ids).
        if (ownedCandidates.length > 0) {
            await prisma.application.updateMany({
                where: { id: { in: ownedCandidates.map((row) => row.id) }, healthId, isDeleted: false },
                data: { bundleId: bundle.id },
            });
        }

        const hydratedBundle = await getOwnedBundle(bundle.id, healthId, {
            applications: { select: APPLICATION_SUMMARY_SELECT },
        });

        res.json({ success: true, data: serializeBundle(hydratedBundle) });
    } catch (error) {
        logger.error('[ApplicationBundle] Create error:', error);
        respondError(res, req, error, { log: false });
    }
});

// Add application to bundle
router.post('/:id/applications', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const { applicationId } = req.body || {};
        const healthId = normalizeHealthId(req);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        if (typeof applicationId !== 'string' || !applicationId.trim()) {
            return res.status(400).json({ success: false, error: 'applicationId is required' });
        }

        const bundle = await getOwnedBundle(id, healthId, {
            applications: { select: { id: true } },
        });
        if (!bundle) {
            return res.status(404).json({ success: false, error: 'Bundle not found' });
        }
        if (bundle.status !== 'DRAFT') {
            return res.status(400).json({ success: false, error: 'Cannot modify submitted bundle' });
        }
        if (bundle.applications.length >= TRIPLE_BUNDLE_SIZE) {
            return res.status(400).json({ success: false, error: 'Bundle is full (max 3 applications)' });
        }

        const application = await getOwnedApplication(applicationId, healthId, await holderScope(req));
        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }
        // R1a link-time gate: a finished case must not join a bundle.
        if (TERMINAL_STATUSES.has(application.status)) {
            return respondBundleRefusal(res, req, 'BUNDLE_TERMINAL_APPLICATION');
        }
        // ARCH-01 link-time gate: only a DRAFT may join.
        if (findNonDraftApplication([application])) {
            return respondBundleRefusal(res, req, 'BUNDLE_APPLICATION_NOT_DRAFT');
        }

        const updatedApp = await prisma.application.update({
            where: { id: applicationId },
            data: { bundleId: id },
        });

        res.json({ success: true, data: updatedApp });
    } catch (error) {
        logger.error('[ApplicationBundle] Add application error:', error);
        respondError(res, req, error, { log: false });
    }
});

// Remove application from bundle
router.delete('/:id/applications/:applicationId', authenticateHealth, async (req, res) => {
    try {
        const { id, applicationId } = req.params;
        const healthId = normalizeHealthId(req);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const bundle = await getOwnedBundle(id, healthId);
        if (!bundle) {
            return res.status(404).json({ success: false, error: 'Bundle not found' });
        }
        if (bundle.status !== 'DRAFT') {
            return res.status(400).json({ success: false, error: 'Cannot modify submitted bundle' });
        }

        const application = await getOwnedApplication(applicationId, healthId, await holderScope(req));
        if (!application || application.bundleId !== id) {
            return res.status(404).json({ success: false, error: 'Application not found in bundle' });
        }

        await prisma.application.update({
            where: { id: applicationId },
            data: { bundleId: null },
        });

        res.json({ success: true, message: 'Application removed from bundle' });
    } catch (error) {
        logger.error('[ApplicationBundle] Remove application error:', error);
        respondError(res, req, error, { log: false });
    }
});

// Submit bundle
router.post('/:id/submit', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const healthId = normalizeHealthId(req);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        // Audit-trail actor stays the User.id (persisted as Application.updatedBy),
        // matching every other status write; healthId is only the ownership key.
        const actorId = String(req.user?.id || healthId);

        // M1: `entityId` joins the projection — the guard below asks about the
        // entity each linked case names, and a select that omits it would hand
        // the guard `undefined` and refuse every bundle.
        // M2a: `formData` joins it too. This door had no formData read at all,
        // and it needs the column twice: to see the evidence already on the case
        // (draftDocuments) and to stamp the requirement snapshot back WITHOUT
        // replacing the applicant's blob (the writer overwrites the column, so a
        // stamp built from an unloaded formData would erase their answers).
        // ARCH-01: `version` joins it so the status write below is scoped to the
        // row this request judged (optimistic lock).
        const bundle = await getOwnedBundle(id, healthId, {
            applications: { select: { id: true, status: true, version: true, entityId: true, formData: true } },
        });
        if (!bundle) {
            return res.status(404).json({ success: false, error: 'Bundle not found' });
        }
        if (bundle.status !== 'DRAFT') {
            return res.status(400).json({ success: false, error: 'Bundle already submitted' });
        }
        if (bundle.applications.length === 0) {
            return res.status(400).json({ success: false, error: 'Bundle must have at least 1 application' });
        }
        // R1a submit-time gate: catch a case that turned terminal AFTER it was
        // linked. Runs before the bundle status write and the writer loop, so a
        // finished case is never resurrected to SUBMITTED. Reject the whole
        // submit, mutate nothing.
        if (findTerminalApplication(bundle.applications)) {
            return respondBundleRefusal(res, req, 'BUNDLE_TERMINAL_APPLICATION');
        }
        // ARCH-01 submit-time gate: a case that left DRAFT after it was linked
        // (the applicant filed it through the front door meanwhile) is refused
        // the same way. It runs before the entity heal below, which writes.
        if (findNonDraftApplication(bundle.applications)) {
            return respondBundleRefusal(res, req, 'BUNDLE_APPLICATION_NOT_DRAFT');
        }

        // M1 submit gate — asked for EVERY linked case, and asked BEFORE the
        // transaction opens (plan Task C2 Step 2b). Two reasons it cannot move
        // inside: the guard's FAILURE row is written through
        // `auditLogger.log()`, which opens its own transaction and takes an
        // advisory lock (audit-logger.js:479,505-506) — nesting that inside an
        // interactive transaction is pool contention at best — and a refusal
        // row that rolls back with the business write is not a record of
        // anything. Refusing one case refuses the whole bundle: a bundle is one
        // act, and half a submitted bundle is the split state the transaction
        // below exists to prevent.
        const healthIdentity = { userId: req.user?.id || null, healthId };
        const submitEntityByApplicationId = new Map();
        try {
            for (let i = 0; i < bundle.applications.length; i += 1) {
                const linkedApp = await healLinkedApplicationEntityId(bundle.applications[i], healthIdentity);
                bundle.applications[i] = linkedApp;
                const { entityId } = await assertSubmitAllowed({
                    userId: actorId,
                    application: linkedApp,
                    auditContext: { ...buildSubmitAuditContext(req), bundleId: id },
                    // The guard re-checks a RENEWAL/REPLACEMENT claim's certificate holder.
                    holderScope: await holderScope(req),
                });
                submitEntityByApplicationId.set(linkedApp.id, entityId);
            }
        } catch (guardErr) {
            if (guardErr instanceof SubmitGuardError) {
                return respondError(res, req, guardErr, { message: guardErr.message });
            }
            throw guardErr;
        }

        // M2a document law — asked for EVERY linked case, and BEFORE the
        // transaction, for the same reason the M1 guard is: refusing one case
        // refuses the whole bundle, and half a submitted bundle is exactly the
        // split state the transaction below exists to prevent. Each case is a
        // first filing ('first-submit'), so each gets its own stamp — the cases
        // in one bundle can belong to different holders and different plants.
        const requirementStampByApplicationId = new Map();
        try {
            for (const linkedApp of bundle.applications) {
                const { appliedRules } = await assertRequiredDocumentsPresent({
                    application: linkedApp,
                    mode: MODE_FIRST_SUBMIT,
                    holderScope: await holderScope(req),
                });
                requirementStampByApplicationId.set(linkedApp.id, buildRequirementSnapshot(appliedRules));
            }
        } catch (docErr) {
            if (isSubmitGateRefusal(docErr)) {
                return respondSubmitGateRefusal(res, docErr);
            }
            throw docErr;
        }

        // A0 / PR-A0-2 — the bundle flip and every case it contains are ONE
        // business act, so they get ONE transaction.
        //
        // Before this, the bundle row was flipped to SUBMITTED on the bare
        // client and the linked cases were then walked one implicit transaction
        // at a time. A failure part-way (a writer fence rejecting an edge, a
        // lock timeout, the process dying) left a SUBMITTED bundle holding cases
        // still in DRAFT — and, post-PR-A0-1, an audit trail that correctly
        // recorded only the prefix that made it. The applicant sees a submitted
        // bundle; the reviewer queue sees drafts; nothing retries.
        //
        // WHAT THIS TRANSACTION DOES AND DOES NOT GUARANTEE (PR-A0-2 audit
        // round 1, F4 — the previous wording claimed the audit rows were atomic
        // too, which is false):
        //   ATOMIC          — the bundle status flip and all N status UPDATEs.
        //   BEST-EFFORT     — the N canonical APPLICATION_STATUS_TRANSITION rows
        //                     and the work-activity rows. The writer emits both
        //                     behind a fail-OPEN SAVEPOINT fence
        //                     (application-status-writer.js `runFencedBestEffort`),
        //                     so an emission failure costs the row, not the hop:
        //                     a committed SUBMITTED case with no canonical row is
        //                     reachable by design until the fail-closed flip
        //                     scheduled in design-decision.md §2 (tension with
        //                     INVARIANT A0 clause (1) logged there as AMBIGUOUS A6).
        //
        // Bound work: the terminal-case gate above (R1a) already rejects the
        // whole submit before anything is written, and a bundle is a handful of
        // linked applications, so the transaction stays short.
        const updatedBundle = await prisma.$transaction(async (tx) => {
            const bundleRow = await tx.applicationBundle.update({
                where: { id },
                data: { status: 'SUBMITTED' },
                include: { applications: { select: APPLICATION_SUMMARY_SELECT } },
            });

            // Submit each linked application through the canonical writer for the audit trail.
            //
            // ARCH-01 — strict mode, not the writer's permissive default. This is
            // an applicant-reachable door and `fromStatus` is what this request
            // read, so the writer itself must refuse any edge other than
            // DRAFT→SUBMITTED (assertTransition) and must refuse a row that moved
            // since that read (expectedVersion → CONCURRENCY_CONFLICT). The DRAFT
            // gate above is the first fence; these two keep holding if it is ever
            // loosened or raced. The writer's global default is left as is here.
            for (const linkedApp of bundle.applications) {
                await writeApplicationStatus({
                    prisma: tx,
                    applicationId: linkedApp.id,
                    fromStatus: linkedApp.status,
                    toStatus: 'SUBMITTED',
                    actorId,
                    actorRole: 'HEALTH',
                    assertTransition: true,
                    expectedVersion: linkedApp.version,
                    reason: `BUNDLE_SUBMITTED:${id}`,
                    // M2a — the stamp rides the status write that already exists,
                    // inside this transaction: a case cannot become SUBMITTED
                    // without a record of the law it was judged by. The stored
                    // blob is spread FIRST because the writer replaces the whole
                    // column; stamping without it would delete the applicant's
                    // own answers.
                    additionalData: {
                        formData: {
                            ...(linkedApp.formData && typeof linkedApp.formData === 'object' ? linkedApp.formData : {}),
                            serverRequirementSnapshot: requirementStampByApplicationId.get(linkedApp.id) || null,
                        },
                    },
                });
            }

            return bundleRow;
        });

        // AC3 — one accepted row per case, naming the entity it was made for.
        for (const linkedApp of bundle.applications) {
            await logBundleSubmitAccepted({
                req,
                bundleId: id,
                applicationId: linkedApp.id,
                entityId: submitEntityByApplicationId.get(linkedApp.id) || null,
                actorId,
            });
        }

        res.json({ success: true, data: serializeBundle(updatedBundle) });
    } catch (error) {
        // ARCH-01 — a linked case moved between the gates and the write. The
        // transaction has rolled the bundle flip back; answer with the
        // catalogued 409 so the applicant reloads, not a 500.
        if (error?.code === 'CONCURRENCY_CONFLICT') {
            return respondBundleRefusal(res, req, 'CONCURRENCY_CONFLICT');
        }
        logger.error('[ApplicationBundle] Submit error:', error);
        respondError(res, req, error, { log: false });
    }
});

// Delete bundle
router.delete('/:id', authenticateHealth, async (req, res) => {
    try {
        const { id } = req.params;
        const healthId = normalizeHealthId(req);
        if (!healthId) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }

        const bundle = await getOwnedBundle(id, healthId);
        if (!bundle) {
            return res.status(404).json({ success: false, error: 'Bundle not found' });
        }
        if (bundle.status !== 'DRAFT') {
            return res.status(400).json({ success: false, error: 'Cannot delete submitted bundle' });
        }

        await prisma.application.updateMany({
            where: { bundleId: id },
            data: { bundleId: null },
        });

        await prisma.applicationBundle.delete({ where: { id } });

        res.json({ success: true, message: 'Bundle deleted' });
    } catch (error) {
        logger.error('[ApplicationBundle] Delete error:', error);
        respondError(res, req, error, { log: false });
    }
});

module.exports = router;
